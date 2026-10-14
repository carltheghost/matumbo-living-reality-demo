"""SIMFABRIC authoritative state, events, budgets and projection seam."""

from __future__ import annotations

from dataclasses import dataclass, field
import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

from .physics import ResonantWorld
from .workspace import NoteWorkspace


def json_safe(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [json_safe(item) for item in value]
    return value


@dataclass
class BudgetLedger:
    max_ticks: int = 160
    max_physics_steps: int = 512
    max_tool_calls: int = 2
    max_events: int = 1024
    max_note_bytes: int = 400_000
    max_checkpoint_bytes: int = 6_000_000
    ticks: int = 0
    physics_steps: int = 0
    tool_calls: int = 0

    def consume_tick(self) -> None:
        if self.ticks >= self.max_ticks:
            raise RuntimeError("tick budget exhausted")
        self.ticks += 1

    def consume_tool(self) -> None:
        if self.tool_calls >= self.max_tool_calls:
            raise RuntimeError("tool budget exhausted")
        self.tool_calls += 1

    def consume_physics(self, steps: int = 1) -> None:
        if type(steps) is not int or steps < 0 or self.physics_steps + steps > self.max_physics_steps:
            raise RuntimeError("physics-step budget exhausted")
        self.physics_steps += steps

    def snapshot(self) -> dict:
        return {
            "max_ticks": self.max_ticks,
            "max_physics_steps": self.max_physics_steps,
            "max_tool_calls": self.max_tool_calls,
            "max_events": self.max_events,
            "max_note_bytes": self.max_note_bytes,
            "max_checkpoint_bytes": self.max_checkpoint_bytes,
            "ticks": self.ticks,
            "physics_steps": self.physics_steps,
            "tool_calls": self.tool_calls,
        }

    @classmethod
    def restore(cls, state: dict) -> "BudgetLedger":
        allowed = {field.name for field in cls.__dataclass_fields__.values()}
        clean = {key: int(value) for key, value in state.items() if key in allowed}
        result = cls(**clean)
        if any(value < 0 for value in result.snapshot().values()):
            raise ValueError("negative budget")
        if result.ticks > result.max_ticks or result.tool_calls > result.max_tool_calls:
            raise ValueError("budget counters exceed limits")
        return result


@dataclass(frozen=True)
class TypedToolResult:
    schema: str
    tool: str
    accepted: bool
    tick: int
    payload: dict
    error: str | None = None

    def snapshot(self) -> dict:
        return {
            "schema": self.schema,
            "tool": self.tool,
            "accepted": self.accepted,
            "tick": self.tick,
            "payload": json_safe(self.payload),
            "error": self.error,
        }


class VevoState:
    """One portable checkpoint envelope for world, brains, memory and records."""

    SCHEMA = "vevo.state.v1"

    def __init__(
        self,
        *,
        world: dict,
        brains: dict,
        tool_results: list[dict],
        workspace: dict,
        events: list[dict],
        rng_state: dict,
        tick: int,
        budgets: dict,
        training: dict,
    ):
        self.schema = self.SCHEMA
        self.world = json_safe(world)
        self.brains = json_safe(brains)
        self.tool_results = json_safe(tool_results)
        self.workspace = json_safe(workspace)
        self.events = json_safe(events)
        self.rng_state = json_safe(rng_state)
        self.tick = int(tick)
        self.budgets = json_safe(budgets)
        self.training = json_safe(training)

    def snapshot(self) -> dict:
        return {
            "schema": self.schema,
            "world": copy.deepcopy(self.world),
            "brains": copy.deepcopy(self.brains),
            "tool_results": copy.deepcopy(self.tool_results),
            "workspace": copy.deepcopy(self.workspace),
            "events": copy.deepcopy(self.events),
            "rng_state": copy.deepcopy(self.rng_state),
            "tick": self.tick,
            "budgets": copy.deepcopy(self.budgets),
            "training": copy.deepcopy(self.training),
        }

    @classmethod
    def restore(cls, state: dict) -> "VevoState":
        if state.get("schema") != cls.SCHEMA:
            raise ValueError("unsupported Vevo state schema")
        return cls(
            world=state["world"],
            brains=state["brains"],
            tool_results=list(state["tool_results"]),
            workspace=state["workspace"],
            events=list(state["events"]),
            rng_state=state["rng_state"],
            tick=int(state["tick"]),
            budgets=state["budgets"],
            training=state["training"],
        )

    def digest(self) -> str:
        encoded = json.dumps(self.snapshot(), sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        return hashlib.sha256(encoded).hexdigest()


class SimFabricStore:
    """Canonical local state/event owner; renderer access is projection-only."""

    def __init__(self, world: ResonantWorld, *, seed: int = 0, budgets: BudgetLedger | None = None):
        self.world = world
        self.events: list[dict] = []
        self.tool_results: list[TypedToolResult] = []
        self.budgets = budgets or BudgetLedger()
        self.rng = np.random.default_rng(seed)
        self.workspace = NoteWorkspace(event_sink=self.append_event)
        self.append_event("fabric.created", {"seed": seed, "world_digest": world.digest()})

    @property
    def tick(self) -> int:
        return self.world.tick

    def append_event(self, event_type: str, payload: dict) -> dict:
        if not isinstance(event_type, str) or not event_type or not isinstance(payload, dict):
            raise ValueError("invalid event")
        if len(self.events) >= self.budgets.max_events:
            raise RuntimeError("event budget exhausted")
        event = {
            "schema": "vevo.simfabric.event.v1",
            "event_id": len(self.events) + 1,
            "tick": self.tick,
            "source": "simfabric",
            "type": event_type,
            "payload": json_safe(payload),
        }
        event["digest"] = hashlib.sha256(
            json.dumps(event, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        ).hexdigest()
        self.events.append(event)
        return event

    def ensure_event_capacity(self) -> None:
        if len(self.events) >= self.budgets.max_events:
            raise RuntimeError("event budget exhausted")

    def advance_world(self, port_drives=None, *, external=None, include_cue: bool = True) -> dict:
        # Reserve the event slot before consuming budgets or mutating the
        # authoritative world.  This makes a full event log a no-op failure.
        self.ensure_event_capacity()
        self.budgets.consume_tick()
        self.budgets.consume_physics(1)
        result = self.world.step(port_drives, external=external, include_cue=include_cue)
        self.append_event("world.advanced", result)
        return result

    def record_tool_result(self, result: TypedToolResult) -> None:
        self.ensure_event_capacity()
        self.tool_results.append(result)
        self.append_event("tool.result", result.snapshot())

    # The editor uses these SIMFABRIC-owned wrappers so document mutations and
    # world/tool events share one authoritative event path.
    def create_note(self, note_id: str, title: str, text: str):
        return self.workspace.create(note_id, title, text, self.tick)

    def edit_note(self, note_id: str, text: str, *, expected_revision: int):
        return self.workspace.edit(note_id, text, self.tick, expected_revision=expected_revision)

    def add_note_link(self, source_id: str, target_id: str):
        return self.workspace.add_link(source_id, target_id, self.tick)

    def note_projection(self) -> dict:
        return self.workspace.projection()

    def projection(self, traces: dict | None = None) -> dict:
        """Return a fresh read-only projection; no mutation methods are exposed."""

        return {
            "schema": "vevo.renderer-projection.v1",
            "tick": self.tick,
            "world": {
                "q": self.world.q.tolist(),
                "u": self.world.u.tolist(),
                "energy": self.world.energy(),
                "residual": self.world.residual,
            },
            "workspace": self.note_projection(),
            "events": copy.deepcopy(self.events[-32:]),
            "tool_results": [result.snapshot() for result in self.tool_results[-8:]],
            "traces": json_safe(traces or {}),
        }

    def checkpoint(self, *, brains: dict, training: dict | None = None) -> VevoState:
        return VevoState(
            world=self.world.snapshot(),
            brains=brains,
            tool_results=[result.snapshot() for result in self.tool_results],
            workspace=self.workspace.snapshot(),
            events=self.events,
            rng_state=self.rng.bit_generator.state,
            tick=self.tick,
            budgets=self.budgets.snapshot(),
            training=training or {},
        )

    @classmethod
    def from_checkpoint(cls, state: VevoState) -> "SimFabricStore":
        world = ResonantWorld.restore(state.world)
        store = cls(world, seed=0, budgets=BudgetLedger.restore(state.budgets))
        store.events = list(state.events)
        store.workspace.close()
        store.workspace = NoteWorkspace.restore(state.workspace, event_sink=store.append_event)
        store.tool_results = [
            TypedToolResult(
                schema=str(payload["schema"]),
                tool=str(payload["tool"]),
                accepted=bool(payload["accepted"]),
                tick=int(payload["tick"]),
                payload=dict(payload.get("payload", {})),
                error=payload.get("error"),
            )
            for payload in state.tool_results
        ]
        store.rng = np.random.default_rng()
        store.rng.bit_generator.state = state.rng_state
        if store.tick != state.tick:
            raise ValueError("checkpoint tick mismatch")
        return store

    def save(self, path: str | Path, *, brains: dict, training: dict | None = None) -> str:
        state = self.checkpoint(brains=brains, training=training)
        encoded = json.dumps(state.snapshot(), sort_keys=True, indent=2, allow_nan=False)
        if len(encoded.encode()) > self.budgets.max_checkpoint_bytes:
            raise RuntimeError("checkpoint byte budget exhausted")
        Path(path).write_text(encoded + "\n", encoding="utf-8")
        return state.digest()

    @staticmethod
    def load(path: str | Path) -> VevoState:
        return VevoState.restore(json.loads(Path(path).read_text(encoding="utf-8")))
