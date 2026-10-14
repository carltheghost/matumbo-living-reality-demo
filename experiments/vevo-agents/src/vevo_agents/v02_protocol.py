"""Interactive v0.2 note -> diagnostic -> gate protocol.

This module deliberately keeps exact SQLite state and randomized mapping
outside learned weights. The center receives only typed, authorized results;
the evaluator measures the authoritative gate state after execution.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math

import numpy as np

from .physics import ResonantWorld
from .workspace import NoteWorkspace


TOOL_DIM = 8
STAGES = ("note", "diagnostic", "actuation")
ACTION_NAMES = tuple(f"choice_{i}" for i in range(4))


def _stable_seed(*parts) -> int:
    raw = ":".join(str(part) for part in parts).encode()
    return int.from_bytes(hashlib.sha256(raw).digest()[:8], "little")


def _digest_bit(text: str, index: int) -> float:
    digest = hashlib.sha256(text.encode()).digest()
    return float((digest[index] & 1) != 0)


@dataclass(frozen=True)
class Mapping:
    note_id: str
    revision: int
    diagnostic_port: int
    target_gate: int
    calibration_frequency: float
    mapping_seed: int


class V02Episode:
    """One interactive episode with exact notes and a hidden gate objective."""

    WORK_BUDGET = 0.30
    MAX_PHYSICS_STEPS = 64

    def __init__(self, seed: int, *, stale: bool = False, wrong_note: bool = False):
        if type(seed) is not int or seed < 0:
            raise ValueError("seed must be a non-negative integer")
        self.seed = seed
        self.world = ResonantWorld(seed=seed)
        self.workspace = NoteWorkspace()
        self.workspace.create("key/0", "Cue key zero", "resonance-key:0", 0)
        self.workspace.create("key/1", "Cue key one", "resonance-key:1", 0)
        # Revision changes are exact SQLite edits, not learned state.
        if seed % 2:
            self.workspace.edit("key/0", "resonance-key:0\nrevision-note", 1, expected_revision=1)
        else:
            self.workspace.edit("key/1", "resonance-key:1\nrevision-note", 1, expected_revision=1)
        self.true_key = int(self.world.target)
        self.true_note_id = f"key/{self.true_key}"
        self.current_revision = self._revision(self.true_note_id)
        self.stale = stale
        self.wrong_note = wrong_note
        self.gate_open = [False] * 4
        self.physics_steps = 0
        self.work_spent = 0.0
        self.events: list[dict] = []
        self.last_lookup: dict | None = None
        self.last_diagnostic: dict | None = None
        self.last_result: dict | None = None

    def _revision(self, note_id: str) -> int:
        row = self.workspace.conn.execute(
            "SELECT revision FROM documents WHERE note_id = ?", (note_id,)
        ).fetchone()
        if row is None:
            raise KeyError(note_id)
        return int(row[0])

    def _mapping(self, note_id: str, revision: int) -> Mapping:
        rng = np.random.default_rng(_stable_seed(self.seed, note_id, revision))
        port = int(rng.integers(0, 4))
        gate = int(rng.integers(0, 4))
        base = float(self.world.omega[port] / (2.0 * math.pi))
        frequency = base + float(rng.uniform(-0.008, 0.008))
        return Mapping(note_id, revision, port, gate, frequency, _stable_seed(self.seed, note_id, revision))

    @property
    def true_mapping(self) -> Mapping:
        return self._mapping(self.true_note_id, self.current_revision)

    def note_action(self) -> int:
        return self.true_key

    def diagnostic_action(self) -> int:
        return self.true_mapping.diagnostic_port

    def actuation_action(self) -> int:
        return self.true_mapping.target_gate

    def advance(self, port_drives=None, *, field_feedback: bool = True) -> np.ndarray:
        drives = np.zeros(4) if port_drives is None or not field_feedback else np.asarray(port_drives, dtype=float)
        # A short three-step cue prelude gives the local field a measurable
        # resonant trace.  Later advances occur after the cue and expose only
        # recurrent field/distractors.
        steps = 3 if self.world.tick == 0 else 1
        for _ in range(steps):
            self.world.step(drives if _ == steps - 1 else np.zeros(4), include_cue=self.world.tick < self.world.CUE_TICKS)
            self.physics_steps += 1
            self.events.append({"type": "field.advance", "tick": self.world.tick, "drive_norm": float(np.linalg.norm(drives if _ == steps - 1 else np.zeros(4)))})
        return self.world.observe()

    def _note_result(self, requested_key: int) -> dict:
        requested_id = f"key/{int(requested_key)}"
        current_revision = self._revision(requested_id)
        requested_revision = current_revision - 1 if self.stale else current_revision
        if requested_revision != current_revision:
            result = {
                "schema": "vevo.v02.note-result.v1",
                "stage": "note",
                "accepted": False,
                "note_id": requested_id,
                "requested_revision": requested_revision,
                "current_revision": current_revision,
                "stale": True,
                "error": "stale_revision",
                "requested_key": int(requested_key),
            }
        else:
            mapping = self._mapping(requested_id, current_revision)
            document = self.workspace.conn.execute(
                "SELECT title, text FROM documents WHERE note_id = ?", (requested_id,)
            ).fetchone()
            content_digest = hashlib.sha256((document[0] + "\n" + document[1]).encode()).hexdigest()
            result = {
                "schema": "vevo.v02.note-result.v1",
                "stage": "note",
                "accepted": True,
                "note_id": requested_id,
                "revision": current_revision,
                "content_digest": content_digest,
                "diagnostic_port": mapping.diagnostic_port,
                "calibration_frequency": mapping.calibration_frequency,
                "mapping_seed": mapping.mapping_seed,
                "requested_key": int(requested_key),
                # target_gate is intentionally withheld until diagnostic.
            }
        self.last_lookup = result
        self.events.append({"type": "note.lookup", **result})
        return result

    def execute_note(self, requested_key: int) -> dict:
        if requested_key not in (0, 1):
            return {"schema": "vevo.v02.note-result.v1", "stage": "note", "accepted": False, "error": "bad_key"}
        # Intervention mode injects the wrong authoritative note regardless of
        # which key the policy requests; the policy still emits its ordinary
        # requested key and cannot learn the executor override away.
        if self.wrong_note:
            requested_key = 1 - self.true_key
        return self._note_result(requested_key)

    def execute_diagnostic(self, selected_port: int) -> dict:
        if type(selected_port) is not int or not 0 <= selected_port < 4:
            return {"schema": "vevo.v02.diagnostic-result.v1", "stage": "diagnostic", "accepted": False, "error": "bad_port"}
        lookup = self.last_lookup or {}
        if not lookup.get("accepted"):
            result = {"schema": "vevo.v02.diagnostic-result.v1", "stage": "diagnostic", "accepted": False, "diagnostic_ok": False, "error": "note_unavailable"}
            self.last_diagnostic = result
            return result
        note_id = lookup["note_id"]
        revision = int(lookup["revision"])
        mapping = self._mapping(note_id, revision)
        frequency = float(lookup["calibration_frequency"])
        before_work = self.work_spent
        before_energy = self.world.energy()
        for _ in range(6):
            drive = np.zeros(4)
            drive[selected_port] = 0.72 * math.sin(2.0 * math.pi * frequency * (self.world.tick + 1) * self.world.DT)
            self.world.step(np.zeros(4), external=drive, include_cue=False)
            self.physics_steps += 1
            self.work_spent += 0.72 * self.world.DT
        port_ok = selected_port == mapping.diagnostic_port
        note_is_true = note_id == self.true_note_id and revision == self.current_revision
        signal = float(abs(self.world.u[selected_port]) + 0.35 * abs(self.world.du[selected_port]))
        diagnostic_ok = bool(port_ok and note_is_true and self.work_spent <= self.WORK_BUDGET)
        result = {
            "schema": "vevo.v02.diagnostic-result.v1",
            "stage": "diagnostic",
            "accepted": True,
            "selected_port": selected_port,
            "calibration_frequency": frequency,
            "response_gain": signal,
            "work_delta": self.work_spent - before_work,
            "energy_delta": float(self.world.energy() - before_energy),
            "diagnostic_ok": diagnostic_ok,
            # The target gate becomes observable only after this diagnostic.
            "target_gate": mapping.target_gate if diagnostic_ok else -1,
            "world_tick": self.world.tick,
        }
        self.last_diagnostic = result
        self.events.append({"type": "diagnostic.run", **result})
        return result

    def execute_actuation(self, selected_gate: int, *, enabled: bool = True) -> dict:
        if type(selected_gate) is not int or not 0 <= selected_gate < 4:
            return {"schema": "vevo.v02.actuation-result.v1", "stage": "actuation", "accepted": False, "gate_opened": False, "error": "bad_gate"}
        diagnostic = self.last_diagnostic or {}
        before = self.world.energy()
        if enabled:
            drive = np.zeros(4)
            drive[selected_gate] = 0.45
            self.world.step(np.zeros(4), external=drive, include_cue=False)
            self.physics_steps += 1
            self.work_spent += 0.45 * self.world.DT
        opened = bool(
            enabled
            and diagnostic.get("diagnostic_ok") is True
            and selected_gate == self.true_mapping.target_gate
            and self.work_spent <= self.WORK_BUDGET
        )
        if opened:
            self.gate_open[self.true_mapping.target_gate] = True
        result = {
            "schema": "vevo.v02.actuation-result.v1",
            "stage": "actuation",
            "accepted": enabled,
            "selected_gate": selected_gate,
            "gate_opened": opened,
            "work_spent": self.work_spent,
            "work_budget": self.WORK_BUDGET,
            "energy_delta": float(self.world.energy() - before),
            "world_tick": self.world.tick,
        }
        self.last_result = result
        self.events.append({"type": "gate.actuate", **result})
        return result

    def execute(self, stage: int, action: int, *, actuation_enabled: bool = True) -> dict:
        if stage == 0:
            return self.execute_note(action)
        if stage == 1:
            return self.execute_diagnostic(action)
        if stage == 2:
            return self.execute_actuation(action, enabled=actuation_enabled)
        raise ValueError("invalid stage")

    def observation_vector(self, result: dict | None) -> np.ndarray:
        if not result:
            return np.zeros(TOOL_DIM)
        stage = result.get("stage")
        if stage == "note":
            port = int(result.get("diagnostic_port", -1))
            return np.array([
                float(result.get("accepted", False)),
                float(result.get("stale", False)),
                *[float(port == index) for index in range(4)],
                float(result.get("revision", 0)) / 3.0,
                float(result.get("calibration_frequency", 0.0)),
            ])
        if stage == "diagnostic":
            gate = int(result.get("target_gate", -1))
            return np.array([
                float(result.get("accepted", False)),
                float(result.get("diagnostic_ok", False)),
                *[float(gate == index) for index in range(4)],
                float(result.get("response_gain", 0.0)),
                float(result.get("work_delta", 0.0)),
            ])
        return np.zeros(TOOL_DIM)

    def success(self) -> bool:
        return bool(self.gate_open[self.true_mapping.target_gate])

    def snapshot(self) -> dict:
        return {
            "schema": "vevo.v02.episode.v1",
            "seed": self.seed,
            "world": self.world.snapshot(),
            "workspace": self.workspace.snapshot(),
            "true_key": self.true_key,
            "true_revision": self.current_revision,
            "gate_open": list(self.gate_open),
            "physics_steps": self.physics_steps,
            "work_spent": self.work_spent,
            "events": list(self.events),
            "stale": self.stale,
            "wrong_note": self.wrong_note,
            "last_lookup": self.last_lookup,
            "last_diagnostic": self.last_diagnostic,
            "last_result": self.last_result,
        }

    @classmethod
    def restore(cls, state: dict) -> "V02Episode":
        if state.get("schema") != "vevo.v02.episode.v1":
            raise ValueError("unsupported v0.2 episode schema")
        obj = cls.__new__(cls)
        obj.seed = int(state["seed"])
        obj.world = ResonantWorld.restore(state["world"])
        obj.workspace = NoteWorkspace.restore(state["workspace"])
        obj.true_key = int(state["true_key"])
        obj.true_note_id = f"key/{obj.true_key}"
        obj.current_revision = int(state["true_revision"])
        obj.stale = bool(state.get("stale", False))
        obj.wrong_note = bool(state.get("wrong_note", False))
        obj.gate_open = [bool(value) for value in state.get("gate_open", [False] * 4)]
        obj.physics_steps = int(state.get("physics_steps", obj.world.tick))
        obj.work_spent = float(state.get("work_spent", 0.0))
        obj.events = list(state.get("events", []))
        obj.last_lookup = state.get("last_lookup")
        obj.last_diagnostic = state.get("last_diagnostic")
        obj.last_result = state.get("last_result")
        return obj


def teacher_trace(agent, seed: int, *, stale: bool = False, wrong_note: bool = False) -> dict:
    """Interactive teacher-forced trace; field/tool transitions are real."""

    episode = V02Episode(seed, stale=stale, wrong_note=wrong_note)
    runtime = agent.initial_runtime()
    drives = np.zeros(4)
    observations = []
    stages = []
    tools = []
    targets = [episode.note_action(), episode.diagnostic_action(), episode.actuation_action()]
    results = []
    for stage, target in enumerate(targets):
        observation = episode.advance(drives)
        observations.append(observation)
        stages.append(stage)
        tool = episode.observation_vector(results[-1] if results else None)
        tools.append(tool)
        runtime, trace = agent.raw_step(runtime, observation, stage, tool)
        drives = trace["port_drives"]
        result = episode.execute(stage, target)
        results.append(result)
    return {
        "seed": seed,
        "observations": np.asarray(observations),
        "stages": np.asarray(stages, dtype=int),
        "tools": np.asarray(tools),
        "targets": np.asarray(targets, dtype=int),
        "episode": episode,
        "results": results,
    }
