"""Corrected v0.3 protocol: note-conditioned continuous gate physics.

This module is intentionally additive.  The earlier v0.2 staged result remains
unchanged; v0.3 removes its answer leakage and discrete gate-label shortcut.
The diagnostic is a pure bounded measurement query.  Runtime actuation never
reads an evaluator target and opens a gate only after continuous position and
energy thresholds are crossed.
"""

from __future__ import annotations

from dataclasses import dataclass
import copy
import hashlib
import json
import math
import re

import numpy as np

from .physics import ResonantWorld
from .workspace import NoteWorkspace


PERIPHERAL_BRAINS = 4
CENTRAL_BRAINS = 1
TOTAL_BRAINS = PERIPHERAL_BRAINS + CENTRAL_BRAINS
GATE_COUNT = 4
PROBE_FREQUENCIES = np.asarray((0.55, 0.75, 0.95, 1.15), dtype=np.float64)
TARGET_RE = re.compile(r"(?:^|[;\s])target_hz\s*=\s*([0-9]+(?:\.[0-9]+)?)")
PHASE_RE = re.compile(r"(?:^|[;\s])target_phase\s*=\s*(-?[0-9]+(?:\.[0-9]+)?)")


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _finite_vector(value, size: int, name: str, bound: float = 1e6) -> np.ndarray:
    result = np.asarray(value, dtype=np.float64)
    if result.shape != (size,) or not np.isfinite(result).all() or np.max(np.abs(result), initial=0.0) > bound:
        raise ValueError(f"invalid {name}")
    return result.copy()


@dataclass(frozen=True)
class NoteInstruction:
    note_id: str
    revision: int
    target_hz: float
    target_phase: float
    content_digest: str


class ContinuousGateWorld:
    """A bounded field plus four continuously integrated resonant gates."""

    DT = ResonantWorld.DT
    GATE_COUNT = GATE_COUNT
    MAX_DIAGNOSTIC_STEPS = GATE_COUNT * 4 * 80
    ACTUATION_STEPS = 80
    COUPLING_K = 0.78
    POSITION_THRESHOLD = 0.050
    ENERGY_THRESHOLD = 0.075

    def __init__(self, seed: int, gate_resonance_hz=None):
        if type(seed) is not int or seed < 0:
            raise ValueError("seed must be a non-negative integer")
        self.seed = seed
        # The recovered field is reused as a neutral four-channel substrate.
        # It is advanced without its old target cue; v0.3 has no runtime goal
        # label in the field or actuator.
        self.field = ResonantWorld(seed=seed, target=0)
        if gate_resonance_hz is None:
            rng = np.random.default_rng(seed + 19001)
            gate_resonance_hz = PROBE_FREQUENCIES[rng.permutation(GATE_COUNT)]
        self.gate_resonance_hz = _finite_vector(gate_resonance_hz, GATE_COUNT, "gate resonance", 10.0)
        if np.any(self.gate_resonance_hz <= 0.2) or np.any(self.gate_resonance_hz >= 2.0):
            raise ValueError("gate resonance outside bounded range")
        self.gate_x = np.zeros(GATE_COUNT, dtype=np.float64)
        self.gate_v = np.zeros(GATE_COUNT, dtype=np.float64)
        self.gate_peak_abs = np.zeros(GATE_COUNT, dtype=np.float64)
        self.gate_open = np.zeros(GATE_COUNT, dtype=bool)
        self.gate_work = 0.0
        self.gate_dissipated = 0.0
        self.physics_steps = 0
        self.initial_energy = self.energy()

    @property
    def gate_omega(self) -> np.ndarray:
        return 2.0 * math.pi * self.gate_resonance_hz

    def gate_energy(self) -> np.ndarray:
        omega = self.gate_omega
        return 0.5 * (self.gate_v**2 + omega**2 * self.gate_x**2) + 0.01 * self.gate_x**4

    def energy(self) -> float:
        return float(
            self.field.energy()
            + np.sum(self.gate_energy())
            + self.coupling_energy()
        )

    def coupling_energy(self) -> float:
        """Shared edge energy between field displacement and gate position."""

        return 0.5 * self.COUPLING_K * float(np.sum((self.gate_x - self.field.u) ** 2))

    @property
    def dissipated(self) -> float:
        return float(self.field.dissipated + self.gate_dissipated)

    @property
    def work(self) -> float:
        return float(self.field.work + self.gate_work)

    @property
    def residual(self) -> float:
        return float(self.energy() - self.initial_energy - self.work + self.dissipated)

    def step(self, gate_drive=None, port_drives=None, external=None, *, count_work: bool = True) -> dict:
        gate_drive = np.zeros(GATE_COUNT) if gate_drive is None else _finite_vector(gate_drive, GATE_COUNT, "gate drive", 2.0)
        port_drives = np.zeros(4) if port_drives is None else _finite_vector(port_drives, 4, "port drives", 0.2)
        external = np.zeros(4) if external is None else _finite_vector(external, 4, "external drive", 2.0)
        before = self.energy()
        # Both forces are derivatives of the same coupling energy
        # E_c = .5*K*sum((gate_x - field_u)^2).  The field receives
        # -dE_c/d(field_u) and the gates receive -dE_c/d(gate_x).
        field_coupling_force = self.COUPLING_K * (self.gate_x - self.field.u)
        field_external = external + field_coupling_force
        self.field.step(port_drives, external=field_external, include_cue=False)
        omega = self.gate_omega
        gate_force = (
            self.COUPLING_K * (self.field.u - self.gate_x)
            + gate_drive
            - 0.085 * self.gate_v
            - omega**2 * self.gate_x
            - 0.02 * self.gate_x**3
        )
        self.gate_v += self.DT * gate_force
        self.gate_x += self.DT * self.gate_v
        self.gate_peak_abs = np.maximum(self.gate_peak_abs, np.abs(self.gate_x))
        self.gate_dissipated += self.DT * 0.085 * float(np.dot(self.gate_v, self.gate_v))
        if count_work:
            positive_power = np.maximum(gate_drive * self.gate_v, 0.0)
            self.gate_work += self.DT * float(np.sum(positive_power))
        self.physics_steps += 1
        return {
            "energy_before": before,
            "energy_after": self.energy(),
            "work": self.work,
            "dissipated": self.dissipated,
            "residual": self.residual,
        }

    def observe(self) -> np.ndarray:
        field_obs = self.field.observe()
        gate_obs = np.column_stack((self.gate_x, self.gate_v, self.gate_energy()))
        return np.concatenate((field_obs, gate_obs), axis=1)

    def _probe_response(
        self,
        frequency: float,
        *,
        gate: int,
        port: int,
        steps: int,
        amplitude: float,
    ) -> tuple[np.ndarray, float]:
        trial = copy.deepcopy(self)
        response_samples = []
        probe_work = 0.0
        for tick in range(steps):
            phase = 2.0 * math.pi * frequency * (trial.physics_steps + 1) * self.DT
            scalar_drive = amplitude * math.sin(phase)
            gate_drive = np.zeros(GATE_COUNT, dtype=np.float64)
            gate_drive[gate] = scalar_drive
            ports = np.zeros(4, dtype=np.float64)
            ports[port] = 0.06 * math.sin(phase)
            trial.step(gate_drive, ports, count_work=False)
            probe_work += self.DT * float(np.sum(np.abs(gate_drive * trial.gate_v)))
            if tick >= steps // 2:
                omega = max(2.0 * math.pi * frequency, 1e-6)
                response_samples.append(np.sqrt(trial.gate_x**2 + (trial.gate_v / omega) ** 2))
        response = np.mean(np.asarray(response_samples), axis=0)
        return response, probe_work

    def measure_spectrum(self, *, port: int = 0, probe_frequencies=None, steps: int = 80, amplitude: float = 0.85) -> dict:
        if type(port) is not int or not 0 <= port < 4:
            raise ValueError("probe port must be in [0, 3]")
        frequencies = PROBE_FREQUENCIES if probe_frequencies is None else np.asarray(probe_frequencies, dtype=np.float64)
        if frequencies.ndim != 1 or len(frequencies) == 0 or len(frequencies) > 4 or not np.isfinite(frequencies).all():
            raise ValueError("invalid probe frequencies")
        if type(steps) is not int or steps < 8 or steps * len(frequencies) * GATE_COUNT > self.MAX_DIAGNOSTIC_STEPS:
            raise ValueError("diagnostic step budget exceeded")
        matrix = np.zeros((GATE_COUNT, len(frequencies)), dtype=np.float64)
        probe_work = 0.0
        for gate in range(GATE_COUNT):
            for column, frequency in enumerate(frequencies):
                response, cost = self._probe_response(
                    float(frequency), gate=gate, port=port,
                    steps=steps, amplitude=amplitude,
                )
                matrix[gate, column] = response[gate]
                probe_work += cost
        return {
            "probe_frequencies": frequencies.tolist(),
            "channel_response": matrix.tolist(),
            "probe_steps": int(steps * len(frequencies) * GATE_COUNT),
            "probe_work": float(probe_work),
            "pure_measurement": True,
            "world_tick": int(self.field.tick),
        }

    def actuate_gate(
        self,
        gate: int,
        *,
        frequency: float,
        amplitude: float = 0.35,
        steps: int = ACTUATION_STEPS,
        work_budget: float | None = None,
    ) -> dict:
        if type(gate) is not int or not 0 <= gate < GATE_COUNT:
            raise ValueError("gate must be in [0, 3]")
        if not math.isfinite(float(frequency)) or not 0.2 < float(frequency) < 2.0:
            raise ValueError("actuation frequency outside bounded range")
        before = self.energy()
        for _ in range(steps):
            phase = 2.0 * math.pi * frequency * (self.physics_steps + 1) * self.DT
            drive = np.zeros(GATE_COUNT, dtype=np.float64)
            drive[gate] = amplitude * math.sin(phase)
            self.step(drive, count_work=True)
        energy = self.gate_energy()
        opened = bool(
            self.gate_peak_abs[gate] >= self.POSITION_THRESHOLD
            and energy[gate] >= self.ENERGY_THRESHOLD
            and (work_budget is None or self.work <= work_budget)
        )
        if opened:
            self.gate_open[gate] = True
        return {
            "selected_gate": gate,
            "gate_opened": opened,
            "gate_position": float(self.gate_x[gate]),
            "gate_peak_abs": float(self.gate_peak_abs[gate]),
            "gate_velocity": float(self.gate_v[gate]),
            "gate_energy": float(energy[gate]),
            "energy_delta": float(self.energy() - before),
            "work_spent": self.work,
            "world_tick": int(self.field.tick),
        }

    def snapshot(self) -> dict:
        field_state = self.field.snapshot()
        # The neutral field implementation contains a fixed internal target
        # used only by its old distractor generator; do not expose it as a v0.3
        # task label in the corrected runtime snapshot.
        field_state.pop("target", None)
        return {
            "schema": "vevo.v03.continuous-gate-world.v1",
            "seed": self.seed,
            "field": field_state,
            "gate_resonance_hz": self.gate_resonance_hz.tolist(),
            "gate_x": self.gate_x.tolist(),
            "gate_v": self.gate_v.tolist(),
            "gate_peak_abs": self.gate_peak_abs.tolist(),
            "gate_open": self.gate_open.tolist(),
            "gate_work": self.gate_work,
            "gate_dissipated": self.gate_dissipated,
            "physics_steps": self.physics_steps,
            "initial_energy": self.initial_energy,
        }


class CorrectedEpisode:
    """Exact note + pure measurement + continuous gate actuation episode."""

    WORK_BUDGET = 1.20
    MAX_PHYSICS_STEPS = 96
    VIRTUAL_STEP_BUDGET = ContinuousGateWorld.MAX_DIAGNOSTIC_STEPS
    VIRTUAL_WORK_BUDGET = 7.00
    MAX_TOOL_CALLS = 3

    def __init__(self, seed: int, *, note_text: str | None = None, gate_resonance_hz=None):
        self.seed = seed
        self.world = ContinuousGateWorld(seed, gate_resonance_hz=gate_resonance_hz)
        self.workspace = NoteWorkspace()
        if note_text is None:
            target_hz = float(PROBE_FREQUENCIES[seed % len(PROBE_FREQUENCIES)])
            note_text = f"target_hz={target_hz:.6f}; target_phase=0.0; rule=max-response-at-target"
        self.workspace.create("instruction", "Resonant instruction", note_text, 0)
        self.note_result: dict | None = None
        self.measurement: dict | None = None
        self.last_result: dict | None = None
        self.events: list[dict] = []
        self.tool_calls = 0
        self.virtual_steps = 0
        self.virtual_work = 0.0

    def _parse_note(self) -> NoteInstruction:
        if self.note_result is None or not self.note_result.get("accepted"):
            raise RuntimeError("accepted note is required")
        text = str(self.note_result["text"])
        target_match = TARGET_RE.search(text)
        phase_match = PHASE_RE.search(text)
        if target_match is None:
            raise ValueError("note has no target_hz instruction")
        target_hz = float(target_match.group(1))
        target_phase = 0.0 if phase_match is None else float(phase_match.group(1))
        if not 0.2 < target_hz < 2.0 or not -math.pi <= target_phase <= math.pi:
            raise ValueError("note instruction outside bounded range")
        return NoteInstruction(
            note_id=str(self.note_result["note_id"]),
            revision=int(self.note_result["revision"]),
            target_hz=target_hz,
            target_phase=target_phase,
            content_digest=str(self.note_result["content_digest"]),
        )

    def advance(self, port_drives=None) -> np.ndarray:
        self.world.step(port_drives=port_drives)
        self.events.append({"type": "field.advance", "tick": self.world.field.tick})
        return self.world.observe()

    def execute_note(self, note_id: str = "instruction", *, expected_revision: int | None = None) -> dict:
        self.tool_calls += 1
        row = self.workspace.conn.execute(
            "SELECT note_id, title, text, revision FROM documents WHERE note_id = ?", (note_id,)
        ).fetchone()
        if row is None:
            result = {"schema": "vevo.v03.note-result.v1", "stage": "note", "accepted": False, "error": "missing_note"}
        elif expected_revision is not None and int(expected_revision) != int(row["revision"]):
            result = {
                "schema": "vevo.v03.note-result.v1",
                "stage": "note",
                "accepted": False,
                "note_id": note_id,
                "current_revision": int(row["revision"]),
                "error": "stale_revision",
            }
        else:
            content_digest = _digest(str(row["title"]) + "\n" + str(row["text"]))
            result = {
                "schema": "vevo.v03.note-result.v1",
                "stage": "note",
                "accepted": True,
                "note_id": str(row["note_id"]),
                "title": str(row["title"]),
                "text": str(row["text"]),
                "revision": int(row["revision"]),
                "content_digest": content_digest,
            }
        self.note_result = result
        self.events.append({"type": "note.lookup", **result})
        return result

    def execute_diagnostic(self, selected_port: int = 0) -> dict:
        self.tool_calls += 1
        if self.note_result is None or not self.note_result.get("accepted"):
            result = {
                "schema": "vevo.v03.measurement-result.v1",
                "stage": "diagnostic",
                "accepted": False,
                "pure_measurement": True,
                "error": "note_unavailable",
            }
        else:
            measured = self.world.measure_spectrum(port=selected_port)
            self.virtual_steps += int(measured["probe_steps"])
            self.virtual_work += float(measured["probe_work"])
            within_budget = bool(
                self.virtual_steps <= self.VIRTUAL_STEP_BUDGET
                and self.virtual_work <= self.VIRTUAL_WORK_BUDGET
            )
            result = {
                "schema": "vevo.v03.measurement-result.v1",
                "stage": "diagnostic",
                "accepted": True,
                "selected_port": int(selected_port),
                **measured,
                "virtual_steps_total": self.virtual_steps,
                "virtual_work_total": self.virtual_work,
                "virtual_step_budget": self.VIRTUAL_STEP_BUDGET,
                "virtual_work_budget": self.VIRTUAL_WORK_BUDGET,
                "resource_budget_ok": within_budget,
            }
            if not within_budget:
                result["accepted"] = False
                result["error"] = "virtual_probe_budget_exceeded"
        self.measurement = result
        self.events.append({"type": "diagnostic.measurement", **result})
        return result

    def execute_actuation(
        self,
        selected_gate: int,
        *,
        enabled: bool = True,
        drive_frequency: float | None = None,
    ) -> dict:
        self.tool_calls += 1
        if type(selected_gate) is not int or not 0 <= selected_gate < GATE_COUNT:
            result = {
                "schema": "vevo.v03.actuation-result.v1",
                "stage": "actuation",
                "accepted": False,
                "gate_opened": False,
                "error": "bad_gate",
            }
            self.last_result = result
            return result
        if self.measurement is None or not self.measurement.get("accepted"):
            result = {
                "schema": "vevo.v03.actuation-result.v1",
                "stage": "actuation",
                "accepted": False,
                "gate_opened": False,
                "error": "measurement_unavailable",
            }
            self.last_result = result
            return result
        if drive_frequency is None:
            result = {
                "schema": "vevo.v03.actuation-result.v1",
                "stage": "actuation",
                "accepted": False,
                "gate_opened": False,
                "error": "missing_drive_frequency_argument",
            }
            self.last_result = result
            return result
        frequency = float(drive_frequency)
        before_work = self.world.work
        if enabled:
            physical = self.world.actuate_gate(
                selected_gate,
                frequency=frequency,
                work_budget=self.WORK_BUDGET,
            )
        else:
            physical = {
                "selected_gate": int(selected_gate),
                "gate_opened": False,
                "gate_position": float(self.world.gate_x[selected_gate]),
                "gate_peak_abs": float(self.world.gate_peak_abs[selected_gate]),
                "gate_velocity": float(self.world.gate_v[selected_gate]),
                "gate_energy": float(self.world.gate_energy()[selected_gate]),
                "energy_delta": 0.0,
                "work_spent": self.world.work,
                "world_tick": int(self.world.field.tick),
            }
        # No target label, mapping equality or diagnostic answer participates
        # here.  `gate_opened` is solely a continuous world-state threshold.
        result = {
            "schema": "vevo.v03.actuation-result.v1",
            "stage": "actuation",
            "accepted": bool(enabled),
            "drive_frequency": frequency,
            "work_delta": float(self.world.work - before_work),
            "work_budget": self.WORK_BUDGET,
            "tool_calls": self.tool_calls,
            "tool_budget": self.MAX_TOOL_CALLS,
            "tool_budget_ok": self.tool_calls <= self.MAX_TOOL_CALLS,
            "virtual_steps": self.virtual_steps,
            "virtual_work": self.virtual_work,
            **physical,
        }
        self.last_result = result
        self.events.append({"type": "gate.actuate", **result})
        return result

    def oracle_action(self) -> int:
        """Evaluator-only action: note target property x measured spectrum."""

        instruction = self._parse_note()
        if self.measurement is None or not self.measurement.get("accepted"):
            raise RuntimeError("measurement is required")
        frequencies = np.asarray(self.measurement["probe_frequencies"], dtype=np.float64)
        matrix = np.asarray(self.measurement["channel_response"], dtype=np.float64)
        column = int(np.argmin(np.abs(frequencies - instruction.target_hz)))
        return int(np.argmax(matrix[:, column]))

    def success(self) -> bool:
        return bool(np.any(self.world.gate_open))

    def snapshot(self) -> dict:
        return {
            "schema": "vevo.v03.corrected-episode.v1",
            "seed": self.seed,
            "world": self.world.snapshot(),
            "workspace": self.workspace.snapshot(),
            "note_result": self.note_result,
            "measurement": self.measurement,
            "last_result": self.last_result,
            "resources": {
                "tool_calls": self.tool_calls,
                "tool_budget": self.MAX_TOOL_CALLS,
                "virtual_steps": self.virtual_steps,
                "virtual_step_budget": self.VIRTUAL_STEP_BUDGET,
                "virtual_work": self.virtual_work,
                "virtual_work_budget": self.VIRTUAL_WORK_BUDGET,
                "live_physics_steps": self.world.physics_steps,
                "live_physics_budget": self.MAX_PHYSICS_STEPS,
                "live_work": self.world.work,
                "live_work_budget": self.WORK_BUDGET,
            },
            "events": list(self.events),
        }


def null_policy_action(measurement: dict) -> int:
    """A note-blind baseline that takes the largest response anywhere."""

    matrix = np.asarray(measurement["channel_response"], dtype=np.float64)
    return int(np.argmax(np.max(matrix, axis=1)))


def oracle_rollout(episode: CorrectedEpisode, *, enabled: bool = True, wrong_drive: bool = False) -> dict:
    """Deterministic solvability oracle; not a trainable policy."""

    episode.advance(np.zeros(4))
    note = episode.execute_note()
    measurement = episode.execute_diagnostic(0)
    action = episode.oracle_action()
    instruction = episode._parse_note()
    drive_frequency = instruction.target_hz + (0.31 if wrong_drive else 0.0)
    result = episode.execute_actuation(action, enabled=enabled, drive_frequency=drive_frequency)
    return {
        "note": note,
        "measurement": measurement,
        "oracle_action": action,
        "result": result,
        "success": episode.success(),
        "world": episode.world,
    }


def null_rollout(episode: CorrectedEpisode) -> dict:
    episode.advance(np.zeros(4))
    note = episode.execute_note()
    measurement = episode.execute_diagnostic(0)
    action = null_policy_action(measurement)
    # The baseline ignores both note content and its target frequency.
    result = episode.execute_actuation(action, drive_frequency=float(PROBE_FREQUENCIES[-1]))
    return {"note": note, "measurement": measurement, "null_action": action, "result": result, "success": episode.success()}


def pair_same_measurement_different_notes() -> tuple[CorrectedEpisode, CorrectedEpisode]:
    gates = np.asarray((0.55, 0.75, 0.95, 1.15), dtype=np.float64)
    return (
        CorrectedEpisode(3100, note_text="target_hz=0.55; target_phase=0.0; rule=max-response-at-target", gate_resonance_hz=gates),
        CorrectedEpisode(3100, note_text="target_hz=1.15; target_phase=0.0; rule=max-response-at-target", gate_resonance_hz=gates),
    )


def pair_same_note_different_measurements() -> tuple[CorrectedEpisode, CorrectedEpisode]:
    note = "target_hz=0.55; target_phase=0.0; rule=max-response-at-target"
    return (
        CorrectedEpisode(3200, note_text=note, gate_resonance_hz=np.asarray((0.55, 0.75, 0.95, 1.15))),
        CorrectedEpisode(3200, note_text=note, gate_resonance_hz=np.asarray((0.75, 0.55, 0.95, 1.15))),
    )


def protocol_summary() -> dict:
    return {
        "schema": "vevo.v03.corrected-protocol.v1",
        "brains": {"peripheral": PERIPHERAL_BRAINS, "central": CENTRAL_BRAINS, "total": TOTAL_BRAINS},
        "note_target": "resonant frequency property, not gate ID",
        "measurement": "pure four-channel continuous response matrix over fixed probe frequencies",
        "actuation": "integrated gate position and energy threshold",
        "runtime_target_access": False,
        "answer_fields_in_measurement": [],
    }
