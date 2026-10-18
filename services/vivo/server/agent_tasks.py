"""Durable, bounded Vivo agent task runtime.

This module is the small server-side bridge between the existing authenticated
Vivo session and one real, deliberately boring tool.  It is not a provider
proxy, a council, a browser automation surface, or a general-purpose shell.

The only production tool reads one bundled JSON fixture and writes a
content-addressed artifact into the task database.  The verifier reads the
fixture again through a separate code path.  Fixture text is data only: it is
never parsed as instructions, permissions, or another tool call.
"""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import time
from typing import Any
from urllib.parse import urlsplit

try:
    import fcntl
except ImportError:  # pragma: no cover - the hosted runtime is POSIX-only.
    fcntl = None

from aiohttp import web


AGENT_TASK_SCHEMA = "vivo.agent-task/1"
AGENT_ARTIFACT_SCHEMA = "vivo.agent-artifact/1"
AGENT_VERIFICATION_SCHEMA = "vivo.agent-verification/1"
AGENT_TOOL_OUTPUT_SCHEMA = "vivo.agent-tool-output/1"

TASK_STATUSES = frozenset(
    {
        "queued",
        "running",
        "verifying",
        "succeeded",
        "cancel_requested",
        "cancelled",
        "blocked",
        "unavailable",
        "failed",
    }
)
TERMINAL_STATUSES = frozenset({"succeeded", "cancelled", "blocked", "unavailable", "failed"})
RESUMABLE_STATUSES = frozenset({"queued", "running", "verifying", "cancel_requested"})

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,96}$")
TASK_ID_RE = re.compile(r"^vivo-task-[A-Za-z0-9_-]{16,80}$")
SAMPLE_ID_RE = re.compile(r"^[a-z0-9-]{1,48}$")
MAX_BODY_BYTES = 16 * 1024
MAX_GOAL_CHARS = 280
MAX_EVENT_DATA_BYTES = 8 * 1024
MAX_FIXTURE_BYTES = 64 * 1024
MAX_ARTIFACT_BYTES = 32 * 1024
MAX_TASKS_TOTAL = 256
MAX_TASKS_PER_ACTOR = 32
MAX_QUEUE_DEPTH = 16
MAX_CONCURRENT_WORKERS = 2
MAX_EVENTS_PER_TASK = 64
# Admission threshold, not a hard total-byte ceiling. Existing stores may be
# larger after a committed write; new tasks are refused until an operator
# archives/removes data through a separate maintenance procedure.
MAX_TASK_STORE_BYTES = 8 * 1024 * 1024
SQLITE_SIDECARS = ("-wal", "-shm", "-journal")
AGENT_CAPABILITIES = frozenset({"sample.read"})

TOOL_CATALOG = (
    {
        "name": "vivo.sample.inspect",
        "permission": "sample.read",
        "description": "Read the bundled field sample and produce a digestable artifact.",
        "availability": "available",
    },
)
SAMPLE_FILES = {"field-baseline": "field-sample.json"}


class AgentTaskError(Exception):
    """Stable error code suitable for an authenticated task response."""

    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


class TaskUnavailable(AgentTaskError):
    pass


class TaskFailed(AgentTaskError):
    pass


class AgentTaskRuntimeError(RuntimeError):
    """Fail-closed startup error for ownership and private-storage checks."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _strict_json(text: str) -> Any:
    return json.loads(
        text,
        parse_constant=lambda value: (_ for _ in ()).throw(
            ValueError(f"non-finite JSON value: {value}")
        ),
    )


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _clone(value: Any) -> Any:
    return _strict_json(_canonical(value))


def _sha256(value: bytes | str) -> str:
    data = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(data).hexdigest()


def _bounded_text(value: Any, *, code: str, maximum: int, required: bool = False) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise AgentTaskError(code)
    text = value.strip()
    if (required and not text) or len(text) > maximum or any(ord(ch) < 32 for ch in text):
        raise AgentTaskError(code)
    return text


def _bounded_identifier(value: Any, *, code: str, pattern: re.Pattern[str], required: bool = False) -> str | None:
    text = _bounded_text(value, code=code, maximum=96, required=required)
    if text is not None and not pattern.fullmatch(text):
        raise AgentTaskError(code)
    return text


def _json_text(value: Any, *, code: str = "TASK_STORAGE_ERROR", maximum: int = MAX_EVENT_DATA_BYTES) -> str:
    try:
        text = _canonical(value)
    except (TypeError, ValueError):
        raise AgentTaskError(code, 500) from None
    if len(text.encode("utf-8")) > maximum:
        raise AgentTaskError(code, 500)
    return text


def _normalize_permissions(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 8:
        raise AgentTaskError("TASK_PERMISSIONS_INVALID")
    result: list[str] = []
    for permission in value:
        text = _bounded_text(permission, code="TASK_PERMISSIONS_INVALID", maximum=80, required=True)
        if text not in AGENT_CAPABILITIES:
            raise AgentTaskError("TASK_PERMISSIONS_INVALID")
        if text not in result:
            result.append(text)
    return sorted(result)


def validate_typed_tool_call(tool_call: Any, permissions: list[str] | tuple[str, ...] | set[str]) -> dict[str, Any]:
    """Validate a typed call against the task's immutable permission scope."""

    if not isinstance(tool_call, dict) or set(tool_call) != {"name", "arguments"}:
        raise AgentTaskError("TOOL_CALL_INVALID")
    name = tool_call.get("name")
    if name != "vivo.sample.inspect":
        raise AgentTaskError("TOOL_UNSUPPORTED")
    if "sample.read" not in set(permissions):
        raise AgentTaskError("TOOL_PERMISSION_REQUIRED")
    arguments = tool_call.get("arguments")
    if not isinstance(arguments, dict) or set(arguments) != {"sampleId"}:
        raise AgentTaskError("TOOL_ARGUMENTS_INVALID")
    sample_id = _bounded_identifier(
        arguments.get("sampleId"), code="TOOL_ARGUMENTS_INVALID", pattern=SAMPLE_ID_RE, required=True
    )
    if sample_id not in SAMPLE_FILES:
        raise AgentTaskError("TOOL_ARGUMENTS_INVALID")
    # Do not preserve arbitrary nested objects or text from a caller.  The
    # runtime receives exactly this small, typed value after validation.
    return {"name": name, "arguments": {"sampleId": sample_id}}


def _fixture_summary(sample: dict[str, Any], sample_id: str) -> dict[str, Any]:
    if sample.get("schema") != "vivo.sample/1" or sample.get("id") != sample_id:
        raise TaskFailed("TOOL_OUTPUT_INVALID", 500)
    dimension = sample.get("dimension")
    if type(dimension) is not int or not 2 <= dimension <= 11:
        raise TaskFailed("TOOL_OUTPUT_INVALID", 500)
    entities = sample.get("entities")
    if not isinstance(entities, list) or not 1 <= len(entities) <= 32:
        raise TaskFailed("TOOL_OUTPUT_INVALID", 500)
    entity_ids: list[str] = []
    for entity in entities:
        if not isinstance(entity, dict):
            raise TaskFailed("TOOL_OUTPUT_INVALID", 500)
        entity_id = entity.get("id")
        name = entity.get("name")
        coordinates = entity.get("coordinates")
        if (
            not isinstance(entity_id, str)
            or not SAMPLE_ID_RE.fullmatch(entity_id)
            or entity_id in entity_ids
            or not isinstance(name, str)
            or not name.strip()
            or not isinstance(coordinates, list)
            or len(coordinates) != dimension
            or any(type(value) not in (int, float) for value in coordinates)
        ):
            raise TaskFailed("TOOL_OUTPUT_INVALID", 500)
        entity_ids.append(entity_id)
    annotation = sample.get("annotation", "")
    if not isinstance(annotation, str) or len(annotation) > 512:
        raise TaskFailed("TOOL_OUTPUT_INVALID", 500)
    return {
        "schema": sample["schema"],
        "id": sample["id"],
        "title": _bounded_text(sample.get("title"), code="TOOL_OUTPUT_INVALID", maximum=160, required=True),
        "dimension": dimension,
        "entityIds": entity_ids,
        "entityCount": len(entity_ids),
        # This is explicitly labelled data in the artifact. It is never fed
        # back into validation, permissions, or execution.
        "annotation": annotation,
    }


class AgentTaskRuntime:
    """SQLite-backed task/event/effect store with restart reconciliation."""

    def __init__(
        self,
        repository_root: str | Path,
        database_path: str | Path,
        *,
        fixture_root: str | Path | None = None,
        now: Callable[[], float] = time.time,
        before_tool: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
    ) -> None:
        self.repository_root = Path(repository_root).resolve()
        self.fixture_root = Path(fixture_root or self.repository_root / "services/vivo/tasks/fixtures").resolve()
        # Keep the database path lexical until the no-symlink checks have run.
        # Resolving it here would turn a private-path violation into a different
        # path and would let SQLite follow a database or sidecar symlink.
        self.database_path = Path(os.path.abspath(os.fspath(database_path)))
        self.now = now
        self.before_tool = before_tool
        self._workers: dict[str, asyncio.Task[Any]] = {}
        self._started = False
        self._closed = False
        self._tx_depth = 0
        self._write_hook: Callable[[str], None] | None = None
        self._lock_fd: int | None = None
        self._lock_path = Path(f"{self.database_path}.lock")
        self.db: sqlite3.Connection | None = None
        try:
            self._validate_storage_paths()
            self._acquire_process_lock()
            self.db = self._open_database()
            # Repair states left by older/non-atomic runtimes before recovery
            # can schedule them. A repaired task is replayed by effect key.
            self._reconcile_incomplete_tasks()
            self._recover_interrupted_tasks()
        except BaseException:
            if self.db is not None:
                try:
                    self.db.close()
                except Exception:
                    pass
                self.db = None
            self._release_process_lock()
            raise

    def _runtime_error(self, code: str) -> AgentTaskRuntimeError:
        return AgentTaskRuntimeError(code)

    @staticmethod
    def _safe_owner() -> int:
        if os.name == "nt" or not hasattr(os, "getuid"):
            raise AgentTaskRuntimeError("TASK_STORE_PRIVACY_UNAVAILABLE")
        return os.getuid()

    def _validate_private_directory(self, directory: Path) -> None:
        owner = self._safe_owner()
        if not directory.is_absolute():
            raise self._runtime_error("TASK_STORE_PRIVATE_PATH")
        current = Path(directory.anchor)
        for part in directory.parts[1:]:
            current /= part
            try:
                info = os.lstat(current)
            except OSError as error:
                raise self._runtime_error("TASK_STORE_PRIVATE_PATH") from error
            if stat.S_ISLNK(info.st_mode):
                raise self._runtime_error("TASK_STORE_PRIVATE_PATH")
        try:
            info = os.lstat(directory)
        except OSError as error:
            raise self._runtime_error("TASK_STORE_PRIVATE_PATH") from error
        if (
            not stat.S_ISDIR(info.st_mode)
            or info.st_uid != owner
            or stat.S_IMODE(info.st_mode) & 0o077
        ):
            raise self._runtime_error("TASK_STORE_PRIVATE_PATH")

    def _validate_storage_file(self, path: Path, *, required: bool = False) -> bool:
        owner = self._safe_owner()
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            if required:
                raise self._runtime_error("TASK_STORE_PRIVATE_PATH")
            return False
        except OSError as error:
            raise self._runtime_error("TASK_STORE_PRIVATE_PATH") from error
        if (
            stat.S_ISLNK(info.st_mode)
            or not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or info.st_uid != owner
            or stat.S_IMODE(info.st_mode) & 0o077
        ):
            raise self._runtime_error("TASK_STORE_PRIVATE_PATH")
        return True

    def _validate_storage_paths(self) -> None:
        if not self.database_path.is_absolute() or not self.database_path.name:
            raise self._runtime_error("TASK_STORE_PRIVATE_PATH")
        try:
            self.database_path.relative_to(self.repository_root)
        except ValueError:
            pass
        else:
            raise self._runtime_error("TASK_STORE_IN_CHECKOUT")
        self._validate_private_directory(self.database_path.parent)
        main_exists = self._validate_storage_file(self.database_path)
        sidecar_exists = False
        for suffix in SQLITE_SIDECARS:
            sidecar_exists = self._validate_storage_file(Path(f"{self.database_path}{suffix}")) or sidecar_exists
        # An orphan WAL/journal is not a recoverable task store. Refuse it
        # rather than letting SQLite decide which data to attach.
        if sidecar_exists and not main_exists:
            raise self._runtime_error("TASK_STORE_ORPHAN_SIDECAR")
        self._validate_storage_file(self._lock_path)

    def _prepare_database_file(self) -> None:
        flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(self.database_path, flags, 0o600)
        except FileExistsError:
            self._validate_storage_file(self.database_path, required=True)
            return
        except OSError as error:
            raise self._runtime_error("TASK_STORE_PRIVATE_PATH") from error
        try:
            info = os.fstat(descriptor)
            owner = self._safe_owner()
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_nlink != 1
                or info.st_uid != owner
                or stat.S_IMODE(info.st_mode) & 0o077
            ):
                raise self._runtime_error("TASK_STORE_PRIVATE_PATH")
        finally:
            os.close(descriptor)

    def _acquire_process_lock(self) -> None:
        if fcntl is None:
            raise self._runtime_error("TASK_RUNTIME_OWNERSHIP_UNAVAILABLE")
        # The lock is a separate private sidecar so a second Python runtime
        # cannot recover the same task journal while the first still owns it.
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(self._lock_path, flags, 0o600)
        except OSError as error:
            raise self._runtime_error("TASK_STORE_PRIVATE_PATH") from error
        try:
            self._validate_storage_file(self._lock_path, required=True)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise self._runtime_error("TASK_RUNTIME_ALREADY_OWNED") from error
            except OSError as error:
                raise self._runtime_error("TASK_RUNTIME_OWNERSHIP") from error
            try:
                os.fchmod(descriptor, 0o600)
            except OSError as error:
                raise self._runtime_error("TASK_STORE_PRIVATE_PATH") from error
            self._lock_fd = descriptor
        except BaseException:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            except OSError:
                pass
            os.close(descriptor)
            raise

    def _release_process_lock(self) -> None:
        descriptor = self._lock_fd
        self._lock_fd = None
        if descriptor is None:
            return
        try:
            if fcntl is not None:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
        except OSError:
            pass
        try:
            os.close(descriptor)
        except OSError:
            pass

    @contextmanager
    def _transaction(self):
        outer = self._tx_depth == 0
        if outer:
            assert self.db is not None
            self.db.execute("BEGIN IMMEDIATE")
        self._tx_depth += 1
        try:
            yield
        except BaseException:
            self._tx_depth -= 1
            if outer:
                try:
                    assert self.db is not None
                    self.db.execute("ROLLBACK")
                except Exception:
                    pass
            raise
        else:
            self._tx_depth -= 1
            if outer:
                try:
                    assert self.db is not None
                    self.db.execute("COMMIT")
                except BaseException:
                    try:
                        assert self.db is not None
                        self.db.execute("ROLLBACK")
                    except Exception:
                        pass
                    raise

    def _write(self, label: str, sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Cursor:
        assert self.db is not None
        result = self.db.execute(sql, params)
        if self._write_hook is not None:
            self._write_hook(label)
        return result

    def _storage_bytes(self) -> int:
        total = 0
        for path in (self.database_path, *(Path(f"{self.database_path}{suffix}") for suffix in SQLITE_SIDECARS)):
            try:
                total += os.lstat(path).st_size
            except FileNotFoundError:
                continue
            except OSError as error:
                raise self._runtime_error("TASK_STORE_PRIVATE_PATH") from error
        return total

    def _open_database(self) -> sqlite3.Connection:
        self._prepare_database_file()
        connection = sqlite3.connect(self.database_path, isolation_level=None, check_same_thread=False)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA foreign_keys=ON")
        # SQLite may have materialized a WAL/SHM sidecar while selecting WAL;
        # validate those paths before any application schema write.
        self._validate_storage_paths()
        connection.execute(
            """CREATE TABLE IF NOT EXISTS agent_tasks(
                task_id TEXT PRIMARY KEY,
                actor_id TEXT NOT NULL,
                request_id TEXT NOT NULL,
                request_fingerprint TEXT NOT NULL,
                goal TEXT NOT NULL,
                permissions_json TEXT NOT NULL,
                tool_call_json TEXT NOT NULL,
                status TEXT NOT NULL,
                error_code TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                artifact_json TEXT,
                verification_json TEXT,
                version INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                UNIQUE(actor_id, request_id)
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS agent_task_events(
                task_id TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                event_key TEXT NOT NULL,
                event_type TEXT NOT NULL,
                data_json TEXT NOT NULL,
                created_at REAL NOT NULL,
                PRIMARY KEY(task_id, sequence),
                UNIQUE(task_id, event_key),
                FOREIGN KEY(task_id) REFERENCES agent_tasks(task_id) ON DELETE CASCADE
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS agent_task_effects(
                task_id TEXT NOT NULL,
                effect_key TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                output_json TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                PRIMARY KEY(task_id, effect_key),
                FOREIGN KEY(task_id) REFERENCES agent_tasks(task_id) ON DELETE CASCADE
            )"""
        )
        self._validate_storage_paths()
        return connection

    def _reconcile_incomplete_tasks(self) -> None:
        assert self.db is not None
        rows = self.db.execute(
            """SELECT task_id,status,artifact_json,verification_json,tool_call_json,
                      permissions_json,cancel_requested
                 FROM agent_tasks"""
        ).fetchall()
        for task_id, status, artifact_json, verification_json, tool_call_json, permissions_json, cancel_requested in rows:
            tool = self.db.execute(
                "SELECT status,output_json FROM agent_task_effects WHERE task_id=? AND effect_key=?",
                (task_id, "tool:inspect-sample:v1"),
            ).fetchone()
            verification = self.db.execute(
                "SELECT status,output_json FROM agent_task_effects WHERE task_id=? AND effect_key=?",
                (task_id, "verification:independent-file-read:v1"),
            ).fetchone()
            tool_effect_completed = bool(tool and tool[0] == "completed")
            verification_effect_completed = bool(verification and verification[0] == "completed")
            stored_artifact = self._decode_record(artifact_json)
            stored_verification = self._decode_record(verification_json)
            tool_output = self._decode_record(tool[1] if tool else None)
            verification_output = self._decode_record(verification[1] if verification else None)
            normalized_call = None
            try:
                normalized_call = validate_typed_tool_call(
                    _strict_json(tool_call_json), _strict_json(permissions_json)
                )
            except (AgentTaskError, TypeError, ValueError):
                pass

            expected_verification = None
            tool_evidence_valid = bool(
                tool_effect_completed
                and tool_output is not None
                and stored_artifact is not None
                and normalized_call is not None
                and stored_artifact == tool_output
            )
            if tool_evidence_valid:
                try:
                    # Re-read the trusted, server-owned fixture so an old
                    # completed record cannot survive a changed fixture.
                    expected_verification = self._verify_sample_output(
                        task_id, normalized_call, tool_output
                    )
                except AgentTaskError:
                    tool_evidence_valid = False
            verification_evidence_valid = bool(
                tool_evidence_valid
                and verification_effect_completed
                and verification_output is not None
                and stored_verification is not None
                and verification_output == stored_verification
                and expected_verification is not None
                and verification_output == expected_verification
            )
            # Any invalidated tool evidence invalidates dependent verification
            # too. Otherwise a regenerated artifact could be paired with an
            # old verification digest and reach a false success state.
            reset_tool = bool(tool and not tool_evidence_valid and tool_effect_completed)
            reset_verification = bool(
                verification
                and not verification_evidence_valid
                and (verification_effect_completed or reset_tool)
            )
            clear_artifact = bool(artifact_json) and not tool_evidence_valid
            clear_verification = bool(verification_json) and not verification_evidence_valid
            evidence_repaired = reset_tool or reset_verification or clear_artifact or clear_verification
            incomplete_success = status == "succeeded" and not (
                tool_evidence_valid and verification_evidence_valid
            )
            if evidence_repaired or incomplete_success:
                with self._transaction():
                    if reset_tool:
                        self._write(
                            "effect.reconcile:tool",
                            "UPDATE agent_task_effects SET status='started',output_json=NULL,updated_at=? WHERE task_id=? AND effect_key=?",
                            (self.now(), task_id, "tool:inspect-sample:v1"),
                        )
                    if clear_artifact:
                        self._write(
                            "task.reconcile:artifact",
                            "UPDATE agent_tasks SET artifact_json=NULL,updated_at=?,version=version+1 WHERE task_id=?",
                            (self.now(), task_id),
                        )
                    if reset_verification:
                        self._write(
                            "effect.reconcile:verification",
                            "UPDATE agent_task_effects SET status='started',output_json=NULL,updated_at=? WHERE task_id=? AND effect_key=?",
                            (self.now(), task_id, "verification:independent-file-read:v1"),
                        )
                    if clear_verification:
                        self._write(
                            "task.reconcile:verification",
                            "UPDATE agent_tasks SET verification_json=NULL,updated_at=?,version=version+1 WHERE task_id=?",
                            (self.now(), task_id),
                        )
                    self._write(
                        "task.reconcile:status",
                        "UPDATE agent_tasks SET status='queued',error_code=NULL,updated_at=?,version=version+1 WHERE task_id=?",
                        (self.now(), task_id),
                    )
                    self._append_event(
                        task_id,
                        "task.reconciled",
                        {
                            "fromStatus": status,
                            "resume": True,
                            "missingEvidence": bool(incomplete_success),
                            "toolEvidenceReset": reset_tool,
                            "verificationEvidenceReset": reset_verification,
                            "cancelRequested": bool(cancel_requested),
                        },
                        event_key="task.reconciled",
                    )
                continue
            if status == "succeeded":
                terminal = self.db.execute(
                    "SELECT 1 FROM agent_task_events WHERE task_id=? AND event_key='task.succeeded'",
                    (task_id,),
                ).fetchone()
                if not terminal and artifact_json and verification_json:
                    with self._transaction():
                        self._append_event(
                            task_id,
                            "task.succeeded",
                            {"verified": True, "reconciled": True},
                            event_key="task.succeeded",
                        )

    @staticmethod
    def _decode_record(value: str | None) -> Any:
        if not value:
            return None
        try:
            return _strict_json(value)
        except (TypeError, ValueError):
            return None

    def _recover_interrupted_tasks(self) -> None:
        assert self.db is not None
        rows = self.db.execute(
            "SELECT task_id,status FROM agent_tasks WHERE status IN ('running','verifying','cancel_requested')"
        ).fetchall()
        for task_id, status in rows:
            # A process can stop at any plan/tool/result boundary. The effect
            # table makes completed boundaries replayable; queued recovery is
            # only a scheduler state, not a second effect.
            with self._transaction():
                self._write(
                    "task.recover:status",
                    "UPDATE agent_tasks SET status='queued', updated_at=?, version=version+1 WHERE task_id=?",
                    (self.now(), task_id),
                )
                self._append_event(
                    task_id,
                    "task.recovered",
                    {"fromStatus": status, "resume": True},
                    event_key="task.recovered",
                )

    def start(self) -> None:
        if self._closed:
            raise RuntimeError("agent task runtime is closed")
        self._started = True
        self._pump()

    async def close(self) -> None:
        self._started = False
        workers = list(self._workers.values())
        if workers:
            await asyncio.gather(*workers, return_exceptions=True)
        self._workers.clear()
        if not self._closed:
            try:
                if self.db is not None:
                    self.db.close()
            finally:
                self.db = None
                self._release_process_lock()
                self._closed = True

    def _schedule(self, task_id: str) -> None:
        if (
            self._closed
            or not self._started
            or task_id in self._workers
            or len(self._workers) >= MAX_CONCURRENT_WORKERS
        ):
            return
        task = asyncio.create_task(self._run(task_id))
        self._workers[task_id] = task

        def done(_task: asyncio.Task[Any]) -> None:
            self._workers.pop(task_id, None)
            self._pump()

        task.add_done_callback(done)

    def _pump(self) -> None:
        if self._closed or not self._started or self.db is None:
            return
        slots = MAX_CONCURRENT_WORKERS - len(self._workers)
        if slots <= 0:
            return
        rows = self.db.execute(
            "SELECT task_id FROM agent_tasks WHERE status='queued' ORDER BY created_at,task_id LIMIT ?",
            (MAX_QUEUE_DEPTH,),
        ).fetchall()
        for (task_id,) in rows:
            if len(self._workers) >= MAX_CONCURRENT_WORKERS:
                break
            self._schedule(task_id)

    async def wait_for_idle(self) -> None:
        while self._workers or (
            self._started
            and self.db is not None
            and self.db.execute("SELECT 1 FROM agent_tasks WHERE status='queued' LIMIT 1").fetchone()
        ):
            self._pump()
            if not self._workers:
                break
            await asyncio.gather(*list(self._workers.values()), return_exceptions=True)

    @staticmethod
    def _row_to_dict(row: sqlite3.Row | tuple[Any, ...]) -> dict[str, Any]:
        (
            task_id,
            actor_id,
            request_id,
            request_fingerprint,
            goal,
            permissions_json,
            tool_call_json,
            status,
            error_code,
            cancel_requested,
            artifact_json,
            verification_json,
            version,
            created_at,
            updated_at,
        ) = row
        return {
            "taskId": task_id,
            "actorId": actor_id,
            "requestId": request_id,
            "requestFingerprint": request_fingerprint,
            "goal": goal,
            "permissions": _strict_json(permissions_json),
            "toolCall": _strict_json(tool_call_json),
            "status": status,
            "error": error_code,
            "cancelRequested": bool(cancel_requested),
            "artifact": _strict_json(artifact_json) if artifact_json else None,
            "verification": _strict_json(verification_json) if verification_json else None,
            "version": version,
            "createdAt": created_at,
            "updatedAt": updated_at,
        }

    def _load(self, task_id: str) -> dict[str, Any] | None:
        assert self.db is not None
        row = self.db.execute(
            """SELECT task_id,actor_id,request_id,request_fingerprint,goal,permissions_json,
                      tool_call_json,status,error_code,cancel_requested,artifact_json,
                      verification_json,version,created_at,updated_at
                 FROM agent_tasks WHERE task_id=?""",
            (task_id,),
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def _append_event(self, task_id: str, event_type: str, data: Mapping[str, Any], *, event_key: str) -> None:
        assert self.db is not None
        data_json = _json_text(dict(data))
        existing = self.db.execute(
            "SELECT sequence FROM agent_task_events WHERE task_id=? AND event_key=?",
            (task_id, event_key),
        ).fetchone()
        if existing:
            return
        event_count = self.db.execute(
            "SELECT COUNT(*) FROM agent_task_events WHERE task_id=?", (task_id,)
        ).fetchone()[0]
        if event_count >= MAX_EVENTS_PER_TASK:
            raise AgentTaskError("TASK_EVENT_QUOTA", 507)
        sequence = self.db.execute(
            "SELECT COALESCE(MAX(sequence),0)+1 FROM agent_task_events WHERE task_id=?", (task_id,)
        ).fetchone()[0]
        self._write(
            f"event.{event_type}",
            "INSERT INTO agent_task_events(task_id,sequence,event_key,event_type,data_json,created_at) VALUES(?,?,?,?,?,?)",
            (task_id, sequence, event_key, event_type, data_json, self.now()),
        )

    def _events(self, task_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT sequence,event_type,data_json,created_at FROM agent_task_events WHERE task_id=? ORDER BY sequence",
            (task_id,),
        ).fetchall()
        return [
            {
                "sequence": sequence,
                "type": event_type,
                "data": _strict_json(data_json),
                "createdAt": created_at,
            }
            for sequence, event_type, data_json, created_at in rows
        ]

    def _view(self, task: dict[str, Any], *, include_events: bool = True) -> dict[str, Any]:
        value = {
            "schema": AGENT_TASK_SCHEMA,
            "taskId": task["taskId"],
            "requestId": task["requestId"],
            "goal": task["goal"],
            "permissions": list(task["permissions"]),
            "toolCall": _clone(task["toolCall"]),
            "status": task["status"],
            "error": task["error"],
            "cancelRequested": task["cancelRequested"],
            "artifact": _clone(task["artifact"]) if task["artifact"] else None,
            "verification": _clone(task["verification"]) if task["verification"] else None,
            "version": task["version"],
            "createdAt": task["createdAt"],
            "updatedAt": task["updatedAt"],
        }
        if include_events:
            value["events"] = self._events(task["taskId"])
        return value

    def _transition(
        self,
        task_id: str,
        status: str,
        *,
        error_code: str | None = None,
        event_type: str,
        event_key: str,
        data: Mapping[str, Any] | None = None,
    ) -> None:
        if status not in TASK_STATUSES:
            raise AgentTaskError("TASK_STORAGE_ERROR", 500)
        with self._transaction():
            self._write(
                f"task.status:{status}",
                "UPDATE agent_tasks SET status=?,error_code=?,updated_at=?,version=version+1 WHERE task_id=?",
                (status, error_code, self.now(), task_id),
            )
            self._append_event(task_id, event_type, data or {"status": status}, event_key=event_key)

    def _task_row_for_actor(self, actor_id: str, task_id: str) -> dict[str, Any]:
        task = self._load(task_id)
        if not task or task["actorId"] != actor_id:
            raise AgentTaskError("TASK_NOT_FOUND", 404)
        return task

    def _check_admission(self, actor_id: str, status: str) -> None:
        assert self.db is not None
        if self._storage_bytes() >= MAX_TASK_STORE_BYTES:
            raise AgentTaskError("TASK_STORAGE_QUOTA", 507)
        if self.db.execute("SELECT COUNT(*) FROM agent_tasks").fetchone()[0] >= MAX_TASKS_TOTAL:
            raise AgentTaskError("TASK_STORAGE_QUOTA", 507)
        if self.db.execute("SELECT COUNT(*) FROM agent_tasks WHERE actor_id=?", (actor_id,)).fetchone()[0] >= MAX_TASKS_PER_ACTOR:
            raise AgentTaskError("TASK_ACTOR_QUOTA", 429)
        if status == "queued" and self.db.execute(
            "SELECT COUNT(*) FROM agent_tasks WHERE status='queued'"
        ).fetchone()[0] >= MAX_QUEUE_DEPTH:
            raise AgentTaskError("TASK_OVERLOADED", 429)

    def create_task(self, actor_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(actor_id, str) or not actor_id:
            raise AgentTaskError("AUTH_REQUIRED", 401)
        if not isinstance(payload, Mapping):
            raise AgentTaskError("REQUEST_INVALID")
        request_id = _bounded_identifier(payload.get("requestId"), code="REQUEST_ID_INVALID", pattern=REQUEST_ID_RE, required=True)
        goal = _bounded_text(payload.get("goal"), code="TASK_GOAL_INVALID", maximum=MAX_GOAL_CHARS, required=True)
        permissions = _normalize_permissions(payload.get("permissions"))
        tool_call = payload.get("toolCall")
        if tool_call is None:
            tool_call = {"name": "vivo.sample.inspect", "arguments": {"sampleId": "field-baseline"}}
        fingerprint = _sha256(
            _canonical({"requestId": request_id, "goal": goal, "permissions": permissions, "toolCall": tool_call})
        )
        status = "queued"
        error_code = None
        try:
            normalized_call = validate_typed_tool_call(tool_call, permissions)
        except AgentTaskError as error:
            # Invalid task-scoped calls are durable blocked tasks. The user can
            # inspect the reason without the server ever attempting the tool.
            normalized_call = _clone(tool_call) if isinstance(tool_call, dict) else {"invalid": True}
            status = "blocked"
            error_code = error.code
        replayed = False
        task_id: str
        with self._transaction():
            # Request lookup and insertion share one write transaction. The
            # UNIQUE(actor_id, request_id) constraint is the final retry fence.
            assert self.db is not None
            previous = self.db.execute(
                "SELECT task_id,request_fingerprint FROM agent_tasks WHERE actor_id=? AND request_id=?",
                (actor_id, request_id),
            ).fetchone()
            if previous:
                if previous[1] != fingerprint:
                    raise AgentTaskError("REQUEST_ID_REUSED", 409)
                task_id = previous[0]
                replayed = True
            else:
                self._check_admission(actor_id, status)
                created = self.now()
                task_id = "vivo-task-" + secrets.token_urlsafe(18).replace("-", "_")
                while self._load(task_id) is not None:
                    task_id = "vivo-task-" + secrets.token_urlsafe(18).replace("-", "_")
                self._write(
                    "task.insert",
                    """INSERT INTO agent_tasks(task_id,actor_id,request_id,request_fingerprint,goal,
                              permissions_json,tool_call_json,status,error_code,cancel_requested,
                              artifact_json,verification_json,version,created_at,updated_at)
                           VALUES(?,?,?,?,?,?,?,?,?,0,NULL,NULL,0,?,?)""",
                    (
                        task_id,
                        actor_id,
                        request_id,
                        fingerprint,
                        goal,
                        _json_text(permissions),
                        _json_text(normalized_call),
                        status,
                        error_code,
                        created,
                        created,
                    ),
                )
                self._append_event(
                    task_id,
                    "task.created",
                    {"goal": goal, "permissions": permissions, "tool": normalized_call.get("name")},
                    event_key="task.created",
                )
                if status == "blocked":
                    self._append_event(
                        task_id,
                        "task.blocked",
                        {"code": error_code},
                        event_key="task.blocked",
                    )
        task = self._load(task_id)
        assert task is not None
        if replayed:
            if self._started and task["status"] == "queued":
                self._pump()
            return {**self._view(task), "replayed": True}
        if status == "queued":
            self._pump()
        return self._view(task)

    def list_tasks(self, actor_id: str) -> list[dict[str, Any]]:
        assert self.db is not None
        rows = self.db.execute(
            """SELECT task_id,actor_id,request_id,request_fingerprint,goal,permissions_json,
                      tool_call_json,status,error_code,cancel_requested,artifact_json,
                      verification_json,version,created_at,updated_at
                 FROM agent_tasks WHERE actor_id=? ORDER BY created_at DESC LIMIT 32""",
            (actor_id,),
        ).fetchall()
        return [self._view(self._row_to_dict(row), include_events=False) for row in rows]

    def get_task(self, actor_id: str, task_id: str) -> dict[str, Any]:
        if not TASK_ID_RE.fullmatch(task_id or ""):
            raise AgentTaskError("TASK_NOT_FOUND", 404)
        return self._view(self._task_row_for_actor(actor_id, task_id))

    def cancel_task(self, actor_id: str, task_id: str) -> dict[str, Any]:
        self._task_row_for_actor(actor_id, task_id)
        queued = False
        with self._transaction():
            task = self._task_row_for_actor(actor_id, task_id)
            if task["status"] in TERMINAL_STATUSES:
                self._append_event(
                    task_id,
                    "task.cancel.ignored",
                    {"status": task["status"]},
                    event_key=f"task.cancel.ignored:{task['version']}",
                )
            else:
                self._write(
                    "task.cancel.requested",
                    "UPDATE agent_tasks SET cancel_requested=1,updated_at=?,version=version+1 WHERE task_id=?",
                    (self.now(), task_id),
                )
                self._append_event(task_id, "task.cancel.requested", {}, event_key="task.cancel.requested")
                task = self._load(task_id)
                assert task is not None
                queued = task["status"] == "queued"
                if queued:
                    self._mark_cancelled(task_id, "queued")
        if not queued:
            self._pump()
        return self._view(self._load(task_id) or task)

    def _mark_cancelled(self, task_id: str, phase: str) -> None:
        task = self._load(task_id)
        if not task or task["status"] in TERMINAL_STATUSES:
            return
        self._transition(
            task_id,
            "cancelled",
            error_code="TASK_CANCELLED",
            event_type="task.cancelled",
            event_key="task.cancelled",
            data={"phase": phase, "artifactPreserved": bool(task["artifact"])},
        )

    def _get_effect(self, task_id: str, effect_key: str) -> dict[str, Any] | None:
        assert self.db is not None
        row = self.db.execute(
            "SELECT kind,status,output_json,created_at,updated_at FROM agent_task_effects WHERE task_id=? AND effect_key=?",
            (task_id, effect_key),
        ).fetchone()
        if not row:
            return None
        return {
            "kind": row[0],
            "status": row[1],
            "output": _strict_json(row[2]) if row[2] else None,
            "createdAt": row[3],
            "updatedAt": row[4],
        }

    def _claim_effect(self, task_id: str, effect_key: str, kind: str) -> dict[str, Any]:
        with self._transaction():
            effect = self._get_effect(task_id, effect_key)
            event_type = "tool.started" if kind == "tool" else "verification.started"
            if effect:
                # Repair an older journal that allocated an effect but not its
                # start event. New allocations are atomic with this event.
                self._append_event(
                    task_id,
                    event_type,
                    {"effectKey": effect_key, "kind": kind},
                    event_key=f"{kind}.started",
                )
                return effect
            now = self.now()
            self._write(
                f"effect.insert:{kind}",
                "INSERT INTO agent_task_effects(task_id,effect_key,kind,status,output_json,created_at,updated_at) VALUES(?,?,?,'started',NULL,?,?)",
                (task_id, effect_key, kind, now, now),
            )
            self._append_event(
                task_id,
                event_type,
                {"effectKey": effect_key, "kind": kind},
                event_key=f"{kind}.started",
            )
            return self._get_effect(task_id, effect_key) or {"kind": kind, "status": "started", "output": None}

    def _complete_effect(
        self,
        task_id: str,
        effect_key: str,
        kind: str,
        output: dict[str, Any],
    ) -> None:
        output_json = _json_text(output, maximum=MAX_ARTIFACT_BYTES)
        with self._transaction():
            effect = self._get_effect(task_id, effect_key)
            if not effect or effect["kind"] != kind:
                raise AgentTaskError("TASK_STORAGE_ERROR", 500)
            if effect["status"] == "completed":
                if effect["output"] == output:
                    return
                raise AgentTaskError("TASK_STORAGE_ERROR", 500)
            now = self.now()
            self._write(
                f"effect.complete:{kind}",
                "UPDATE agent_task_effects SET status='completed',output_json=?,updated_at=? WHERE task_id=? AND effect_key=?",
                (output_json, now, task_id, effect_key),
            )
            if kind == "tool":
                self._write(
                    "task.artifact",
                    "UPDATE agent_tasks SET artifact_json=?,updated_at=?,version=version+1 WHERE task_id=?",
                    (output_json, now, task_id),
                )
                event_type, event_key = "tool.completed", "tool.completed"
            else:
                self._write(
                    "task.verification",
                    "UPDATE agent_tasks SET verification_json=?,updated_at=?,version=version+1 WHERE task_id=?",
                    (output_json, now, task_id),
                )
                event_type, event_key = "verification.completed", "verification.completed"
            self._append_event(
                task_id,
                event_type,
                {"effectKey": effect_key, "status": "completed"},
                event_key=event_key,
            )

    def _fixture_path(self, sample_id: str) -> Path:
        relative = SAMPLE_FILES.get(sample_id)
        if relative is None:
            raise TaskFailed("TOOL_ARGUMENTS_INVALID")
        path = (self.fixture_root / relative).resolve()
        try:
            path.relative_to(self.fixture_root)
        except ValueError:
            raise TaskFailed("TOOL_FIXTURE_UNAVAILABLE", 503) from None
        try:
            info = os.lstat(path)
        except OSError:
            raise TaskUnavailable("TOOL_FIXTURE_UNAVAILABLE", 503)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise TaskUnavailable("TOOL_FIXTURE_UNAVAILABLE", 503)
        return path

    def _read_sample_for_tool(self, sample_id: str) -> tuple[bytes, dict[str, Any]]:
        path = self._fixture_path(sample_id)
        try:
            with path.open("rb") as stream:
                raw = stream.read(MAX_FIXTURE_BYTES + 1)
        except OSError:
            raise TaskUnavailable("TOOL_FIXTURE_UNAVAILABLE", 503) from None
        if len(raw) > MAX_FIXTURE_BYTES:
            raise TaskFailed("TOOL_FIXTURE_TOO_LARGE", 500)
        try:
            sample = _strict_json(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, TypeError):
            raise TaskFailed("TOOL_OUTPUT_INVALID", 500) from None
        if not isinstance(sample, dict):
            raise TaskFailed("TOOL_OUTPUT_INVALID", 500)
        return raw, sample

    def _execute_sample_tool(self, task_id: str, tool_call: dict[str, Any]) -> dict[str, Any]:
        sample_id = tool_call["arguments"]["sampleId"]
        raw, sample = self._read_sample_for_tool(sample_id)
        summary = _fixture_summary(sample, sample_id)
        source = {
            "relativePath": "services/vivo/tasks/fixtures/field-sample.json",
            "bytes": len(raw),
            "sha256": _sha256(raw),
        }
        content = {
            "schema": AGENT_ARTIFACT_SCHEMA,
            "artifactId": f"{task_id}:artifact",
            "tool": tool_call["name"],
            "sampleId": sample_id,
            "source": source,
            "summary": summary,
            "dataTrust": "untrusted-fixture-data",
        }
        artifact_json = _canonical(content)
        artifact = {"content": content, "sha256": _sha256(artifact_json)}
        return {
            "schema": AGENT_TOOL_OUTPUT_SCHEMA,
            "toolCall": _clone(tool_call),
            "source": source,
            "artifact": artifact,
        }

    def _verify_sample_output(
        self, task_id: str, tool_call: dict[str, Any], output: dict[str, Any]
    ) -> dict[str, Any]:
        """Re-read and verify without calling the production tool function."""

        sample_id = tool_call["arguments"]["sampleId"]
        path = self._fixture_path(sample_id)
        try:
            with path.open("rb") as stream:
                raw = stream.read(MAX_FIXTURE_BYTES + 1)
        except (OSError, UnicodeDecodeError, ValueError, TypeError):
            raise TaskUnavailable("VERIFIER_SOURCE_UNAVAILABLE", 503) from None
        if len(raw) > MAX_FIXTURE_BYTES:
            raise TaskFailed("VERIFIER_SOURCE_TOO_LARGE", 500)
        try:
            sample = _strict_json(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, TypeError):
            raise TaskUnavailable("VERIFIER_SOURCE_UNAVAILABLE", 503) from None
        if not isinstance(sample, dict):
            raise TaskFailed("VERIFIER_REJECTED_OUTPUT", 500)
        expected_summary = _fixture_summary(sample, sample_id)
        expected_source = {
            "relativePath": "services/vivo/tasks/fixtures/field-sample.json",
            "bytes": len(raw),
            "sha256": _sha256(raw),
        }
        artifact = output.get("artifact") if isinstance(output, dict) else None
        content = artifact.get("content") if isinstance(artifact, dict) else None
        if not isinstance(artifact, dict) or not isinstance(content, dict):
            raise TaskFailed("VERIFIER_REJECTED_OUTPUT", 500)
        expected_content = {
            "schema": AGENT_ARTIFACT_SCHEMA,
            "artifactId": f"{task_id}:artifact",
            "tool": "vivo.sample.inspect",
            "sampleId": sample_id,
            "source": expected_source,
            "summary": expected_summary,
            "dataTrust": "untrusted-fixture-data",
        }
        checks = {
            "sourceDigest": content.get("source") == expected_source,
            "summary": content.get("summary") == expected_summary,
            "artifactDigest": artifact.get("sha256") == _sha256(_canonical(content)),
            "toolType": output.get("schema") == AGENT_TOOL_OUTPUT_SCHEMA
            and output.get("toolCall") == tool_call,
            "artifactContent": content == expected_content,
        }
        if not all(checks.values()):
            raise TaskFailed("VERIFIER_REJECTED_OUTPUT", 500)
        return {
            "schema": AGENT_VERIFICATION_SCHEMA,
            "status": "verified",
            "verifier": "independent-file-read",
            "checks": checks,
            "sourceSha256": expected_source["sha256"],
            "artifactSha256": artifact["sha256"],
            "note": "Fixture annotation was treated as data; no instruction or permission was executed.",
        }

    def _cancel_requested(self, task_id: str) -> bool:
        assert self.db is not None
        row = self.db.execute("SELECT cancel_requested FROM agent_tasks WHERE task_id=?", (task_id,)).fetchone()
        return bool(row and row[0])

    def _finish_error(self, task_id: str, status: str, error_code: str, event_type: str) -> None:
        # Cancellation wins at a safe boundary if its durable request was
        # recorded before the terminal transition. Once a terminal transition
        # commits, cancel_task records an explicit ignored event instead.
        if self._cancel_requested(task_id):
            self._mark_cancelled(task_id, "error-boundary")
            return
        self._transition(
            task_id,
            status,
            error_code=error_code,
            event_type=event_type,
            event_key=event_type,
            data={"code": error_code},
        )

    async def _run(self, task_id: str) -> None:
        task = self._load(task_id)
        if not task or task["status"] in TERMINAL_STATUSES:
            return
        if self._cancel_requested(task_id):
            self._mark_cancelled(task_id, "before-start")
            return
        self._transition(
            task_id,
            "running",
            event_type="task.started",
            event_key="task.started",
            data={"resume": task["status"] != "queued"},
        )
        await asyncio.sleep(0)
        if self._cancel_requested(task_id):
            self._mark_cancelled(task_id, "before-tool")
            return
        try:
            task = self._load(task_id)
            if not task:
                return
            tool_call = validate_typed_tool_call(task["toolCall"], task["permissions"])
            tool_effect_key = "tool:inspect-sample:v1"
            effect = self._claim_effect(task_id, tool_effect_key, "tool")
            if effect["status"] == "completed" and effect["output"] is not None:
                if task["artifact"] != effect["output"]:
                    raise TaskFailed("VERIFIER_REJECTED_OUTPUT", 500)
                output = effect["output"]
            elif effect["status"] == "completed":
                raise TaskFailed("VERIFIER_REJECTED_OUTPUT", 500)
            else:
                if self.before_tool is not None:
                    await self.before_tool(task_id, _clone(tool_call))
                if self._cancel_requested(task_id):
                    self._mark_cancelled(task_id, "before-tool-effect")
                    return
                output = await asyncio.to_thread(self._execute_sample_tool, task_id, tool_call)
                self._complete_effect(task_id, tool_effect_key, "tool", output)
            if self._cancel_requested(task_id):
                self._mark_cancelled(task_id, "after-tool")
                return
            self._transition(
                task_id,
                "verifying",
                event_type="task.verifying",
                event_key="task.verifying",
                data={"effectKey": tool_effect_key},
            )
            await asyncio.sleep(0)
            if self._cancel_requested(task_id):
                self._mark_cancelled(task_id, "before-verification")
                return
            verification_effect_key = "verification:independent-file-read:v1"
            verification_effect = self._claim_effect(task_id, verification_effect_key, "verification")
            if verification_effect["status"] == "completed" and verification_effect["output"] is not None:
                current = self._load(task_id)
                if not current or current["artifact"] != output or current["verification"] != verification_effect["output"]:
                    raise TaskFailed("VERIFIER_REJECTED_OUTPUT", 500)
                expected = await asyncio.to_thread(self._verify_sample_output, task_id, tool_call, output)
                if verification_effect["output"] != expected:
                    raise TaskFailed("VERIFIER_REJECTED_OUTPUT", 500)
                verification = verification_effect["output"]
            elif verification_effect["status"] == "completed":
                raise TaskFailed("VERIFIER_REJECTED_OUTPUT", 500)
            else:
                verification = await asyncio.to_thread(self._verify_sample_output, task_id, tool_call, output)
                self._complete_effect(task_id, verification_effect_key, "verification", verification)
            if self._cancel_requested(task_id):
                self._mark_cancelled(task_id, "after-verification")
                return
            self._transition(
                task_id,
                "succeeded",
                event_type="task.succeeded",
                event_key="task.succeeded",
                data={"verified": verification.get("status") == "verified"},
            )
        except asyncio.CancelledError:
            raise
        except TaskUnavailable as error:
            self._finish_error(task_id, "unavailable", error.code, "task.unavailable")
        except (AgentTaskError, TaskFailed) as error:
            self._finish_error(task_id, "failed", error.code, "task.failed")
        except Exception:
            # Do not expose filesystem, SQLite, or provider-adjacent details.
            self._finish_error(task_id, "failed", "TASK_RUNTIME_FAILED", "task.failed")


def _error_response(code: str, status: int) -> web.Response:
    return web.json_response(
        {"schema": AGENT_TASK_SCHEMA, "status": "error", "error": code},
        status=status,
        headers={"Cache-Control": "no-store"},
    )


def attach_agent_task_routes(
    app: web.Application,
    *,
    runtime: AgentTaskRuntime,
    origin: str,
    authenticate: Callable[[str], Any],
    identity_for_token: Callable[[str, Any], str],
    provider_status: Callable[[], Mapping[str, Any]] | None = None,
) -> None:
    """Install exact-origin, bearer-authenticated task routes."""

    configured_netloc = urlsplit(origin).netloc.lower()

    def origin_allowed(request: web.Request) -> bool:
        if request.headers.get("Origin") == origin:
            return True
        return (
            request.method == "GET"
            and request.headers.get("Origin") is None
            and request.headers.get("Sec-Fetch-Site") == "same-origin"
            and request.host.lower() == configured_netloc
        )

    async def authorize(request: web.Request) -> str | None:
        if not origin_allowed(request):
            return None
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer ") or not 20 <= len(header[7:]) <= 256:
            return None
        token = header[7:]
        try:
            principal = authenticate(token)
            identity = identity_for_token(token, principal)
        except Exception:
            return None
        return identity if isinstance(identity, str) and identity else None

    async def read_body(request: web.Request) -> dict[str, Any] | None:
        if request.content_type != "application/json":
            return None
        if request.content_length is not None and request.content_length > MAX_BODY_BYTES:
            return None
        try:
            raw = await request.read()
            if len(raw) > MAX_BODY_BYTES:
                return None
            value = _strict_json(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, TypeError, json.JSONDecodeError):
            return None
        return value if isinstance(value, dict) else None

    async def status(request: web.Request) -> web.Response:
        identity = await authorize(request)
        if not origin_allowed(request):
            return _error_response("ORIGIN_NOT_ALLOWED", 403)
        if identity is None:
            return _error_response("AUTH_REQUIRED", 401)
        provider = dict(provider_status() or {}) if provider_status else {"available": False, "reason": "not-mounted"}
        return web.json_response(
            {
                "schema": AGENT_TASK_SCHEMA,
                "status": "ready",
                "available": True,
                "persistence": "sqlite-wal-full",
                "transport": "bearer-authenticated-http",
                "limits": {
                    "maxConcurrentWorkers": MAX_CONCURRENT_WORKERS,
                    "maxQueuedTasks": MAX_QUEUE_DEPTH,
                    "maxTasksPerActor": MAX_TASKS_PER_ACTOR,
                    "maxTasksTotal": MAX_TASKS_TOTAL,
                    "maxStoreBytes": MAX_TASK_STORE_BYTES,
                    "storageLimitSemantics": "admission-threshold; not a hard total-byte ceiling",
                    "retention": "operator-managed; no automatic deletion",
                },
                "toolCatalog": [dict(tool) for tool in TOOL_CATALOG],
                "conversation": provider,
            },
            headers={"Cache-Control": "no-store"},
        )

    async def list_tasks(request: web.Request) -> web.Response:
        identity = await authorize(request)
        if not origin_allowed(request):
            return _error_response("ORIGIN_NOT_ALLOWED", 403)
        if identity is None:
            return _error_response("AUTH_REQUIRED", 401)
        if request.query:
            return _error_response("REQUEST_INVALID", 400)
        return web.json_response(
            {"schema": AGENT_TASK_SCHEMA, "status": "ready", "tasks": runtime.list_tasks(identity)},
            headers={"Cache-Control": "no-store"},
        )

    async def create_task(request: web.Request) -> web.Response:
        identity = await authorize(request)
        if not origin_allowed(request):
            return _error_response("ORIGIN_NOT_ALLOWED", 403)
        if identity is None:
            return _error_response("AUTH_REQUIRED", 401)
        body = await read_body(request)
        if body is None or set(body) - {"requestId", "goal", "permissions", "toolCall"}:
            return _error_response("REQUEST_INVALID", 400)
        try:
            task = runtime.create_task(identity, body)
        except AgentTaskError as error:
            return _error_response(error.code, error.status)
        return web.json_response(task, status=200 if task.get("replayed") else 201, headers={"Cache-Control": "no-store"})

    async def get_task(request: web.Request) -> web.Response:
        identity = await authorize(request)
        if not origin_allowed(request):
            return _error_response("ORIGIN_NOT_ALLOWED", 403)
        if identity is None:
            return _error_response("AUTH_REQUIRED", 401)
        try:
            task = runtime.get_task(identity, request.match_info.get("task_id", ""))
        except AgentTaskError as error:
            return _error_response(error.code, error.status)
        return web.json_response(task, headers={"Cache-Control": "no-store"})

    async def cancel_task(request: web.Request) -> web.Response:
        identity = await authorize(request)
        if not origin_allowed(request):
            return _error_response("ORIGIN_NOT_ALLOWED", 403)
        if identity is None:
            return _error_response("AUTH_REQUIRED", 401)
        try:
            task = runtime.cancel_task(identity, request.match_info.get("task_id", ""))
        except AgentTaskError as error:
            return _error_response(error.code, error.status)
        return web.json_response(task, headers={"Cache-Control": "no-store"})

    app.router.add_get("/api/agent/status", status)
    app.router.add_get("/api/agent/tasks", list_tasks)
    app.router.add_post("/api/agent/tasks", create_task)
    app.router.add_get("/api/agent/tasks/{task_id}", get_task)
    app.router.add_post("/api/agent/tasks/{task_id}/cancel", cancel_task)
