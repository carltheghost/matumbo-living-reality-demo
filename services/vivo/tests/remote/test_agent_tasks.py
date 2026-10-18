from __future__ import annotations

import asyncio
import json
import os
import shutil
import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

try:
    from server.agent_tasks import (
        AGENT_TASK_SCHEMA,
        AgentTaskRuntime,
        AgentTaskRuntimeError,
        MAX_CONCURRENT_WORKERS,
        MAX_QUEUE_DEPTH,
        attach_agent_task_routes,
        validate_typed_tool_call,
    )
except ModuleNotFoundError:
    from services.vivo.server.agent_tasks import (
        AGENT_TASK_SCHEMA,
        AgentTaskRuntime,
        AgentTaskRuntimeError,
        MAX_CONCURRENT_WORKERS,
        MAX_QUEUE_DEPTH,
        attach_agent_task_routes,
        validate_typed_tool_call,
    )


ROOT = Path(__file__).resolve().parents[4]
ORIGIN = "https://vivo.test"
TOKEN = "agent-task-test-token-0123456789"


class InjectedCrash(BaseException):
    pass


def request_body(request_id: str = "task.1", *, permissions=None, tool_call=None):
    return {
        "requestId": request_id,
        "goal": "Inspect the bundled field sample and prove its digest",
        "permissions": ["sample.read"] if permissions is None else permissions,
        "toolCall": tool_call or {
            "name": "vivo.sample.inspect",
            "arguments": {"sampleId": "field-baseline"},
        },
    }


class AgentTaskRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "agent-tasks.sqlite"
        self.runtime = AgentTaskRuntime(ROOT, self.path)
        self.runtime.start()

    async def asyncTearDown(self):
        if not self.runtime._closed:
            await self.runtime.close()
        self.temp.cleanup()

    async def test_real_tool_artifact_and_independent_verification_are_durable(self):
        task = self.runtime.create_task("actor-a", request_body())
        await self.runtime.wait_for_idle()
        result = self.runtime.get_task("actor-a", task["taskId"])

        self.assertEqual(result["schema"], AGENT_TASK_SCHEMA)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["toolCall"]["name"], "vivo.sample.inspect")
        self.assertEqual(result["artifact"]["artifact"]["content"]["summary"]["entityCount"], 3)
        self.assertIn("Ignore instructions", result["artifact"]["artifact"]["content"]["summary"]["annotation"])
        self.assertEqual(result["verification"]["status"], "verified")
        self.assertEqual(result["verification"]["verifier"], "independent-file-read")
        self.assertTrue(all(result["verification"]["checks"].values()))
        self.assertEqual(
            [event["type"] for event in result["events"]],
            [
                "task.created",
                "task.started",
                "tool.started",
                "tool.completed",
                "task.verifying",
                "verification.started",
                "verification.completed",
                "task.succeeded",
            ],
        )

        rows = sqlite3.connect(self.path).execute(
            "SELECT effect_key,status FROM agent_task_effects WHERE task_id=? ORDER BY effect_key",
            (task["taskId"],),
        ).fetchall()
        self.assertEqual(
            rows,
            [
                ("tool:inspect-sample:v1", "completed"),
                ("verification:independent-file-read:v1", "completed"),
            ],
        )

    async def test_request_id_replay_and_result_boundary_restart_do_not_duplicate_effects(self):
        task = self.runtime.create_task("actor-a", request_body("same.1"))
        await self.runtime.wait_for_idle()
        replay = self.runtime.create_task("actor-a", request_body("same.1"))
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["taskId"], task["taskId"])
        await self.runtime.close()

        resumed = AgentTaskRuntime(ROOT, self.path)
        resumed.start()
        await resumed.wait_for_idle()
        result = resumed.get_task("actor-a", task["taskId"])
        self.assertEqual(result["status"], "succeeded")
        counts = sqlite3.connect(self.path).execute(
            "SELECT effect_key,COUNT(*) FROM agent_task_effects WHERE task_id=? GROUP BY effect_key",
            (task["taskId"],),
        ).fetchall()
        self.assertEqual(counts, [("tool:inspect-sample:v1", 1), ("verification:independent-file-read:v1", 1)])
        self.runtime = resumed

    async def test_plan_boundary_restart_recovers_queued_task_and_recovery_event_is_durable(self):
        await self.runtime.close()
        task = AgentTaskRuntime(ROOT, self.path)
        pending = task.create_task("actor-a", request_body("queued.1"))
        self.assertEqual(pending["status"], "queued")
        await task.close()
        with sqlite3.connect(self.path) as database:
            database.execute("UPDATE agent_tasks SET status='running' WHERE task_id=?", (pending["taskId"],))

        resumed = AgentTaskRuntime(ROOT, self.path)
        resumed.start()
        await resumed.wait_for_idle()
        result = resumed.get_task("actor-a", pending["taskId"])
        self.assertEqual(result["status"], "succeeded")
        self.assertTrue(any(event["type"] == "task.recovered" for event in result["events"]))
        self.runtime = resumed

    async def test_incomplete_succeeded_state_is_reconciled_before_it_can_be_reported(self):
        await self.runtime.close()
        runtime = AgentTaskRuntime(ROOT, self.path)
        task = runtime.create_task("actor-a", request_body("incomplete-success"))
        await runtime.close()
        with sqlite3.connect(self.path) as database:
            database.execute(
                "UPDATE agent_tasks SET status='succeeded',artifact_json=?,verification_json=? WHERE task_id=?",
                (json.dumps({"forged": True}), json.dumps({"status": "verified"}), task["taskId"]),
            )
        resumed = AgentTaskRuntime(ROOT, self.path)
        self.assertEqual(resumed.get_task("actor-a", task["taskId"])["status"], "queued")
        resumed.start()
        await resumed.wait_for_idle()
        result = resumed.get_task("actor-a", task["taskId"])
        self.assertEqual(result["status"], "succeeded")
        self.assertNotEqual(result["artifact"], {"forged": True})
        self.assertTrue(any(event["type"] == "task.reconciled" for event in result["events"]))
        self.runtime = resumed

    def _copy_fixture_root(self) -> Path:
        fixture_root = Path(self.temp.name) / "fixtures"
        fixture_root.mkdir()
        shutil.copy2(ROOT / "services/vivo/tasks/fixtures/field-sample.json", fixture_root / "field-sample.json")
        return fixture_root

    async def test_partial_old_record_resets_dependent_verification_when_fixture_changes(self):
        fixture_root = self._copy_fixture_root()
        await self.runtime.close()
        runtime = AgentTaskRuntime(ROOT, self.path, fixture_root=fixture_root)
        runtime.start()
        task = runtime.create_task("actor-a", request_body("partial-old-record"))
        await runtime.wait_for_idle()
        original = runtime.get_task("actor-a", task["taskId"])
        await runtime.close()

        fixture_path = fixture_root / "field-sample.json"
        changed = json.loads(fixture_path.read_text())
        changed["annotation"] = "Changed trusted fixture data"
        fixture_path.write_text(json.dumps(changed, sort_keys=True) + "\n")
        with sqlite3.connect(self.path) as database:
            # Simulate the old partial boundary: the tool effect and its
            # dependent verification committed, but the task artifact did not.
            database.execute(
                "UPDATE agent_tasks SET status='succeeded',artifact_json=NULL WHERE task_id=?",
                (task["taskId"],),
            )

        resumed = AgentTaskRuntime(ROOT, self.path, fixture_root=fixture_root)
        repaired = resumed.get_task("actor-a", task["taskId"])
        self.assertEqual(repaired["status"], "queued")
        self.assertIsNone(repaired["artifact"])
        self.assertIsNone(repaired["verification"])
        self.assertTrue(any(event["type"] == "task.reconciled" for event in repaired["events"]))
        self.assertEqual(
            sqlite3.connect(self.path).execute(
                "SELECT effect_key,status,output_json FROM agent_task_effects WHERE task_id=? ORDER BY effect_key",
                (task["taskId"],),
            ).fetchall(),
            [
                ("tool:inspect-sample:v1", "started", None),
                ("verification:independent-file-read:v1", "started", None),
            ],
        )
        resumed.start()
        await resumed.wait_for_idle()
        result = resumed.get_task("actor-a", task["taskId"])
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(
            result["artifact"]["artifact"]["content"]["summary"]["annotation"],
            changed["annotation"],
        )
        self.assertEqual(result["verification"]["status"], "verified")
        self.assertNotEqual(result["verification"]["sourceSha256"], original["verification"]["sourceSha256"])
        self.runtime = resumed

    async def test_reconciliation_preserves_cancel_request_during_partial_repair(self):
        fixture_root = self._copy_fixture_root()
        await self.runtime.close()
        runtime = AgentTaskRuntime(ROOT, self.path, fixture_root=fixture_root)
        runtime.start()
        task = runtime.create_task("actor-a", request_body("partial-cancel"))
        await runtime.wait_for_idle()
        await runtime.close()
        with sqlite3.connect(self.path) as database:
            database.execute(
                "UPDATE agent_tasks SET status='succeeded',artifact_json=NULL,cancel_requested=1 WHERE task_id=?",
                (task["taskId"],),
            )

        resumed = AgentTaskRuntime(ROOT, self.path, fixture_root=fixture_root)
        repaired = resumed.get_task("actor-a", task["taskId"])
        self.assertEqual(repaired["status"], "queued")
        self.assertTrue(repaired["cancelRequested"])
        self.assertTrue(
            any(
                event["type"] == "task.reconciled" and event["data"]["cancelRequested"]
                for event in repaired["events"]
            )
        )
        resumed.start()
        await resumed.wait_for_idle()
        result = resumed.get_task("actor-a", task["taskId"])
        self.assertEqual(result["status"], "cancelled")
        self.assertTrue(result["cancelRequested"])
        self.assertIsNone(result["artifact"])
        self.assertIsNone(result["verification"])
        self.runtime = resumed

    async def test_queued_cancellation_has_no_tool_effect(self):
        await self.runtime.close()
        runtime = AgentTaskRuntime(ROOT, self.path)
        task = runtime.create_task("actor-a", request_body("cancel.queued"))
        cancelled = runtime.cancel_task("actor-a", task["taskId"])
        self.assertEqual(cancelled["status"], "cancelled")
        runtime.start()
        await runtime.wait_for_idle()
        result = runtime.get_task("actor-a", task["taskId"])
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(
            sqlite3.connect(self.path).execute(
                "SELECT COUNT(*) FROM agent_task_effects WHERE task_id=?", (task["taskId"],)
            ).fetchone()[0],
            0,
        )
        self.runtime = runtime

    async def test_running_cancellation_stops_before_read_and_keeps_boundary_explicit(self):
        entered = asyncio.Event()
        release = asyncio.Event()

        async def before_tool(_task_id, _call):
            entered.set()
            await release.wait()

        await self.runtime.close()
        runtime = AgentTaskRuntime(ROOT, self.path, before_tool=before_tool)
        runtime.start()
        task = runtime.create_task("actor-a", request_body("cancel.running"))
        await entered.wait()
        requested = runtime.cancel_task("actor-a", task["taskId"])
        self.assertTrue(requested["cancelRequested"])
        release.set()
        await runtime.wait_for_idle()
        result = runtime.get_task("actor-a", task["taskId"])
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(result["error"], "TASK_CANCELLED")
        self.assertTrue(any(event["type"] == "task.cancelled" for event in result["events"]))
        self.runtime = runtime

    async def test_invalid_typed_calls_are_blocked_and_fixture_instructions_cannot_grant_permission(self):
        with self.assertRaisesRegex(Exception, "TOOL_PERMISSION_REQUIRED"):
            validate_typed_tool_call(
                {"name": "vivo.sample.inspect", "arguments": {"sampleId": "field-baseline"}}, []
            )
        blocked = self.runtime.create_task(
            "actor-a",
            request_body(
                "blocked.1",
                permissions=[],
                tool_call={"name": "vivo.sample.inspect", "arguments": {"sampleId": "field-baseline"}},
            ),
        )
        self.assertEqual(blocked["status"], "blocked")
        self.assertEqual(blocked["error"], "TOOL_PERMISSION_REQUIRED")

        extra_argument = self.runtime.create_task(
            "actor-a",
            request_body(
                "blocked.2",
                tool_call={
                    "name": "vivo.sample.inspect",
                    "arguments": {"sampleId": "field-baseline", "permissions": ["sample.write"]},
                },
            ),
        )
        self.assertEqual(extra_argument["status"], "blocked")
        self.assertEqual(extra_argument["error"], "TOOL_ARGUMENTS_INVALID")

        allowed = self.runtime.create_task("actor-a", request_body("allowed.1"))
        await self.runtime.wait_for_idle()
        result = self.runtime.get_task("actor-a", allowed["taskId"])
        self.assertEqual(result["permissions"], ["sample.read"])
        self.assertNotIn("sample.write", json.dumps(result))
        self.assertEqual(result["status"], "succeeded")

    async def test_missing_fixture_is_unavailable_not_false_success(self):
        await self.runtime.close()
        runtime = AgentTaskRuntime(ROOT, self.path, fixture_root=Path(self.temp.name) / "missing")
        runtime.start()
        task = runtime.create_task("actor-a", request_body("unavailable.1"))
        await runtime.wait_for_idle()
        result = runtime.get_task("actor-a", task["taskId"])
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["error"], "TOOL_FIXTURE_UNAVAILABLE")
        self.assertIsNone(result["artifact"])
        self.runtime = runtime

    async def test_independent_verifier_rejects_tampered_tool_output(self):
        original = self.runtime._execute_sample_tool

        def tampered(task_id, call):
            value = original(task_id, call)
            value["artifact"]["content"]["summary"]["entityCount"] = 99
            return value

        self.runtime._execute_sample_tool = tampered
        task = self.runtime.create_task("actor-a", request_body("verify.1"))
        await self.runtime.wait_for_idle()
        result = self.runtime.get_task("actor-a", task["taskId"])
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error"], "VERIFIER_REJECTED_OUTPUT")

    async def _run_fault_case(self, label: str, index: int):
        directory = Path(self.temp.name) / f"fault-{index}"
        directory.mkdir()
        path = directory / "agent-tasks.sqlite"
        runtime = AgentTaskRuntime(ROOT, path)
        task = runtime.create_task("actor-a", request_body(f"fault.{index}"))
        tripped = False

        def inject(observed):
            nonlocal tripped
            if not tripped and observed == label:
                tripped = True
                runtime._started = False
                raise InjectedCrash(label)

        runtime._write_hook = inject
        runtime.start()
        await runtime.wait_for_idle()
        self.assertTrue(tripped, label)
        before_restart = runtime.get_task("actor-a", task["taskId"])
        self.assertNotEqual(before_restart["status"], "succeeded", label)
        await runtime.close()

        resumed = AgentTaskRuntime(ROOT, path)
        resumed.start()
        await resumed.wait_for_idle()
        result = resumed.get_task("actor-a", task["taskId"])
        self.assertEqual(result["status"], "succeeded", label)
        self.assertIsNotNone(result["artifact"], label)
        self.assertEqual(result["verification"]["status"], "verified", label)
        event_types = [event["type"] for event in result["events"]]
        for event_type in (
            "task.created",
            "task.started",
            "tool.started",
            "tool.completed",
            "task.verifying",
            "verification.started",
            "verification.completed",
            "task.succeeded",
        ):
            self.assertEqual(event_types.count(event_type), 1, (label, event_types))
        with sqlite3.connect(path) as database:
            self.assertEqual(
                database.execute(
                    "SELECT effect_key,status,COUNT(*) FROM agent_task_effects WHERE task_id=? GROUP BY effect_key,status ORDER BY effect_key",
                    (task["taskId"],),
                ).fetchall(),
                [
                    ("tool:inspect-sample:v1", "completed", 1),
                    ("verification:independent-file-read:v1", "completed", 1),
                ],
            )
        await resumed.close()

    async def test_every_effect_and_terminal_write_boundary_recovers_atomically(self):
        # A failure after any one write must roll back the whole boundary. The
        # next process can then replay the fixed read-only effect by its key.
        labels = [
            "task.status:running",
            "event.task.started",
            "effect.insert:tool",
            "event.tool.started",
            "effect.complete:tool",
            "task.artifact",
            "event.tool.completed",
            "task.status:verifying",
            "event.task.verifying",
            "effect.insert:verification",
            "event.verification.started",
            "effect.complete:verification",
            "task.verification",
            "event.verification.completed",
            "task.status:succeeded",
            "event.task.succeeded",
        ]
        for index, label in enumerate(labels):
            await self._run_fault_case(label, index)

    async def test_create_and_blocked_events_are_atomic(self):
        cases = [
            ("task.insert", request_body("create-fault")),
            ("event.task.created", request_body("create-fault")),
            (
                "event.task.blocked",
                request_body(
                    "blocked-fault",
                    tool_call={"name": "vivo.sample.inspect", "arguments": {"sampleId": "not-allowed"}},
                ),
            ),
        ]
        for index, (label, payload) in enumerate(cases):
            directory = Path(self.temp.name) / f"create-fault-{index}"
            directory.mkdir()
            runtime = AgentTaskRuntime(ROOT, directory / "agent-tasks.sqlite")

            def inject(observed, expected=label):
                if observed == expected:
                    raise InjectedCrash(expected)

            runtime._write_hook = inject
            with self.assertRaises(InjectedCrash):
                runtime.create_task("actor-a", payload)
            with sqlite3.connect(runtime.database_path) as database:
                self.assertEqual(database.execute("SELECT COUNT(*) FROM agent_tasks").fetchone()[0], 0)
                self.assertEqual(database.execute("SELECT COUNT(*) FROM agent_task_events").fetchone()[0], 0)
            await runtime.close()

    async def test_cancellation_request_and_terminal_writes_are_atomic(self):
        labels = [
            "task.cancel.requested",
            "event.task.cancel.requested",
            "task.status:cancelled",
            "event.task.cancelled",
        ]
        for index, label in enumerate(labels):
            directory = Path(self.temp.name) / f"cancel-fault-{index}"
            directory.mkdir()
            path = directory / "agent-tasks.sqlite"
            runtime = AgentTaskRuntime(ROOT, path)
            task = runtime.create_task("actor-a", request_body(f"cancel-fault.{index}"))

            def inject(observed, expected=label):
                if observed == expected:
                    raise InjectedCrash(expected)

            runtime._write_hook = inject
            with self.assertRaises(InjectedCrash):
                runtime.cancel_task("actor-a", task["taskId"])
            await runtime.close()

            resumed = AgentTaskRuntime(ROOT, path)
            resumed.start()
            await resumed.wait_for_idle()
            result = resumed.get_task("actor-a", task["taskId"])
            self.assertEqual(result["status"], "succeeded", label)
            self.assertNotIn("task.cancelled", [event["type"] for event in result["events"]])
            await resumed.close()

    async def test_second_runtime_fails_closed_before_recovery(self):
        with self.assertRaisesRegex(AgentTaskRuntimeError, "TASK_RUNTIME_ALREADY_OWNED"):
            AgentTaskRuntime(ROOT, self.path)

    async def test_private_database_and_sidecars_fail_closed(self):
        await self.runtime.close()
        cases = []

        insecure_dir = Path(self.temp.name) / "insecure-dir"
        insecure_dir.mkdir(mode=0o700)
        insecure_dir.chmod(0o755)
        cases.append((insecure_dir / "agent-tasks.sqlite", "TASK_STORE_PRIVATE_PATH"))

        insecure_file_dir = Path(self.temp.name) / "insecure-file"
        insecure_file_dir.mkdir(mode=0o700)
        insecure_file = insecure_file_dir / "agent-tasks.sqlite"
        insecure_file.write_bytes(b"")
        insecure_file.chmod(0o644)
        cases.append((insecure_file, "TASK_STORE_PRIVATE_PATH"))

        sidecar_dir = Path(self.temp.name) / "symlink-sidecar"
        sidecar_dir.mkdir(mode=0o700)
        sidecar_db = sidecar_dir / "agent-tasks.sqlite"
        sidecar_db.write_bytes(b"")
        os.symlink(sidecar_db, f"{sidecar_db}-wal")
        cases.append((sidecar_db, "TASK_STORE_PRIVATE_PATH"))

        symlink_dir = Path(self.temp.name) / "symlink-db"
        symlink_dir.mkdir(mode=0o700)
        target = symlink_dir / "target.sqlite"
        target.write_bytes(b"")
        link = symlink_dir / "agent-tasks.sqlite"
        os.symlink(target, link)
        cases.append((link, "TASK_STORE_PRIVATE_PATH"))

        for path, code in cases:
            with self.assertRaisesRegex(AgentTaskRuntimeError, code):
                AgentTaskRuntime(ROOT, path)
        insecure_dir.chmod(0o700)

    async def test_worker_and_queue_admission_are_bounded(self):
        await self.runtime.close()
        entered = asyncio.Event()
        release = asyncio.Event()
        entered_count = 0

        async def before_tool(_task_id, _call):
            nonlocal entered_count
            entered_count += 1
            if entered_count == MAX_CONCURRENT_WORKERS:
                entered.set()
            await release.wait()

        runtime = AgentTaskRuntime(ROOT, self.path, before_tool=before_tool)
        runtime.start()
        tasks = [runtime.create_task("actor-a", request_body(f"bounded.{index}")) for index in range(3)]
        await entered.wait()
        self.assertEqual(len(runtime._workers), MAX_CONCURRENT_WORKERS)
        self.assertEqual(runtime.get_task("actor-a", tasks[-1]["taskId"])["status"], "queued")
        release.set()
        await runtime.wait_for_idle()
        self.assertTrue(all(runtime.get_task("actor-a", task["taskId"])["status"] == "succeeded" for task in tasks))
        await runtime.close()

        queue_dir = Path(self.temp.name) / "queue-cap"
        queue_dir.mkdir()
        queued = AgentTaskRuntime(ROOT, queue_dir / "agent-tasks.sqlite")
        for index in range(MAX_QUEUE_DEPTH):
            self.assertEqual(
                queued.create_task("actor-a", request_body(f"queue.{index}"))["status"],
                "queued",
            )
        with self.assertRaisesRegex(Exception, "TASK_OVERLOADED"):
            queued.create_task("actor-a", request_body("queue.overload"))
        await queued.close()

    async def test_extra_capability_names_are_rejected(self):
        with self.assertRaisesRegex(Exception, "TASK_PERMISSIONS_INVALID"):
            self.runtime.create_task(
                "actor-a",
                request_body("extra-capability", permissions=["sample.read", "sample.write"]),
            )


class AgentTaskRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.runtime = AgentTaskRuntime(ROOT, Path(self.temp.name) / "agent-tasks.sqlite")
        self.runtime.start()
        self.app = web.Application()
        attach_agent_task_routes(
            self.app,
            runtime=self.runtime,
            origin=ORIGIN,
            authenticate=lambda token: {"actor": "remote.owner"} if token == TOKEN else (_ for _ in ()).throw(ValueError()),
            identity_for_token=lambda _token, principal: principal["actor"],
            provider_status=lambda: {"available": False, "reason": "provider-not-configured"},
        )
        self.server = TestServer(self.app)
        self.client = TestClient(self.server)
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        await self.runtime.close()
        self.temp.cleanup()

    def headers(self, *, origin=ORIGIN):
        return {"Authorization": f"Bearer {TOKEN}", "Origin": origin}

    async def test_authenticated_routes_expose_provider_unavailable_and_task_evidence(self):
        status = await self.client.get("/api/agent/status", headers=self.headers())
        self.assertEqual(status.status, 200)
        status_json = await status.json()
        self.assertEqual(status_json["schema"], AGENT_TASK_SCHEMA)
        self.assertFalse(status_json["conversation"]["available"])
        self.assertEqual(status_json["transport"], "bearer-authenticated-http")
        self.assertEqual(status_json["limits"]["maxConcurrentWorkers"], 2)
        self.assertIn("not a hard total-byte ceiling", status_json["limits"]["storageLimitSemantics"])

        created = await self.client.post(
            "/api/agent/tasks",
            headers={**self.headers(), "Content-Type": "application/json"},
            data=json.dumps(request_body("route.1")),
        )
        self.assertEqual(created.status, 201)
        task = await created.json()
        await self.runtime.wait_for_idle()
        detail = await self.client.get(f"/api/agent/tasks/{task['taskId']}", headers=self.headers())
        self.assertEqual((await detail.json())["status"], "succeeded")

        denied = await self.client.get("/api/agent/tasks", headers={"Authorization": f"Bearer {TOKEN}"})
        self.assertEqual(denied.status, 403)

    async def test_invalid_args_are_persisted_as_blocked_and_request_replay_is_idempotent(self):
        body = request_body(
            "route-blocked",
            tool_call={"name": "vivo.sample.inspect", "arguments": {"sampleId": "not-allowed"}},
        )
        first = await self.client.post(
            "/api/agent/tasks",
            headers={**self.headers(), "Content-Type": "application/json"},
            data=json.dumps(body),
        )
        self.assertEqual(first.status, 201)
        blocked = await first.json()
        self.assertEqual(blocked["status"], "blocked")
        replay = await self.client.post(
            "/api/agent/tasks",
            headers={**self.headers(), "Content-Type": "application/json"},
            data=json.dumps(body),
        )
        self.assertEqual(replay.status, 200)
        self.assertTrue((await replay.json())["replayed"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
