from __future__ import annotations

import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

try:
    from server.agent_tasks import (
        AGENT_TASK_SCHEMA,
        AgentTaskRuntime,
        attach_agent_task_routes,
        validate_typed_tool_call,
    )
except ModuleNotFoundError:
    from services.vivo.server.agent_tasks import (
        AGENT_TASK_SCHEMA,
        AgentTaskRuntime,
        attach_agent_task_routes,
        validate_typed_tool_call,
    )


ROOT = Path(__file__).resolve().parents[4]
ORIGIN = "https://vivo.test"
TOKEN = "agent-task-test-token-0123456789"


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
