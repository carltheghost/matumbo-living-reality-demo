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
GATE_QUARTIC_COEFFICIENT = 0.01
SUCCESS_TOLERANCE_HZ = 1e-6
TARGET_RE = re.compile(r"(?:^|[;\s])target_hz\s*=\s*([0-9]+(?:\.[0-9]+)?)")
PHASE_RE = re.compile(r"(?:^|[;\s])target_phase\s*=\s*(-?[0-9]+(?:\.[0-9]+)?)")

POLICY_NOTE_FIELDS = (
    "schema", "stage", "accepted", "note_id", "title", "text", "revision",
    "content_digest", "error",
)
POLICY_MEASUREMENT_FIELDS = (
    "schema", "stage", "accepted", "selected_port", "probe_frequencies",
    "channel_response", "probe_steps", "probe_work", "pure_measurement",
    "virtual_steps_total", "virtual_work_total", "virtual_step_budget",
    "virtual_work_budget", "resource_budget_ok", "virtual_steps_consumed",
    "virtual_work_consumed", "error",
)
POLICY_FEEDBACK_FIELDS = (
    "schema", "stage", "accepted", "selected_gate", "gate_opened",
    "drive_frequency", "work_delta", "work_budget", "tool_calls",
    "tool_budget", "tool_budget_ok", "virtual_steps", "virtual_work", "error",
)


class VirtualProbeBudgetExceeded(RuntimeError):
    """A cloned probe stopped after consuming measurable virtual resources."""

    def __init__(self, error: str, *, steps: int, work: float):
        super().__init__(error)
        self.steps = int(steps)
        self.work = float(work)


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
        self.gate_supplied_work = 0.0
        self.gate_dissipated = 0.0
        self.physics_steps = 0
        self.initial_energy = self.energy()

    @property
    def gate_omega(self) -> np.ndarray:
        return 2.0 * math.pi * self.gate_resonance_hz

    def gate_energy(self) -> np.ndarray:
        omega = self.gate_omega
        return 0.5 * (self.gate_v**2 + omega**2 * self.gate_x**2) + GATE_QUARTIC_COEFFICIENT * self.gate_x**4

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
    def work_spent(self) -> float:
        """Monotone positive supplied work used by resource budgets."""

        return float(self.field.supplied_work + self.gate_supplied_work)

    @property
    def residual(self) -> float:
        return float(self.energy() - self.initial_energy - self.work + self.dissipated)

    def _step_unchecked(
        self,
        gate_drive=None,
        port_drives=None,
        external=None,
        *,
        count_work: bool = True,
        include_distractors: bool = True,
    ) -> dict:
        gate_drive = np.zeros(GATE_COUNT) if gate_drive is None else _finite_vector(gate_drive, GATE_COUNT, "gate drive", 2.0)
        port_drives = np.zeros(4) if port_drives is None else _finite_vector(port_drives, 4, "port drives", 0.2)
        external = np.zeros(4) if external is None else _finite_vector(external, 4, "external drive", 2.0)
        before = self.energy()
        # Both forces are derivatives of the same coupling energy
        # E_c = .5*K*sum((gate_x - field_u)^2).  The field receives
        # -dE_c/d(field_u) and the gates receive -dE_c/d(gate_x).
        field_coupling_force = self.COUPLING_K * (self.gate_x - self.field.u)
        self.field.step(
            port_drives,
            external=external,
            internal=field_coupling_force,
            include_cue=False,
            include_distractors=include_distractors,
        )
        omega = self.gate_omega
        gate_force = (
            self.COUPLING_K * (self.field.u - self.gate_x)
            + gate_drive
            - 0.085 * self.gate_v
            - omega**2 * self.gate_x
            - 4.0 * GATE_QUARTIC_COEFFICIENT * self.gate_x**3
        )
        self.gate_v += self.DT * gate_force
        self.gate_x += self.DT * self.gate_v
        self.gate_peak_abs = np.maximum(self.gate_peak_abs, np.abs(self.gate_x))
        self.gate_dissipated += self.DT * 0.085 * float(np.dot(self.gate_v, self.gate_v))
        if count_work:
            gate_work_delta = self.DT * float(np.dot(gate_drive, self.gate_v))
            self.gate_work += gate_work_delta
            self.gate_supplied_work += max(gate_work_delta, 0.0)
        self.physics_steps += 1
        return {
            "energy_before": before,
            "energy_after": self.energy(),
            "work": self.work,
            "work_spent": self.work_spent,
            "dissipated": self.dissipated,
            "residual": self.residual,
        }

    def step(
        self,
        gate_drive=None,
        port_drives=None,
        external=None,
        *,
        count_work: bool = True,
        physics_budget: int | None = None,
        work_budget: float | None = None,
        include_distractors: bool = True,
    ) -> dict:
        """Advance one step, refusing a bounded resource overrun."""

        if physics_budget is not None and self.physics_steps + 1 > physics_budget:
            raise RuntimeError("physics_step_budget_exceeded")
        if work_budget is None:
            return self._step_unchecked(
                gate_drive,
                port_drives,
                external,
                count_work=count_work,
                include_distractors=include_distractors,
            )
        trial = copy.deepcopy(self)
        result = trial._step_unchecked(
            gate_drive,
            port_drives,
            external,
            count_work=count_work,
            include_distractors=include_distractors,
        )
        if trial.work_spent > work_budget + 1e-12:
            raise RuntimeError("work_budget_exceeded")
        self.__dict__.update(trial.__dict__)
        return result

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
        work_budget: float | None = None,
        work_used: float = 0.0,
        steps_used: int = 0,
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
            probe_work += self.DT * float(
                np.sum(np.abs(gate_drive * trial.gate_v))
                + np.sum(np.abs(ports * trial.field.du))
            )
            probe_steps = steps_used + tick + 1
            if work_budget is not None and work_used + probe_work > work_budget + 1e-12:
                raise VirtualProbeBudgetExceeded(
                    "virtual_probe_work_budget_exceeded",
                    steps=probe_steps,
                    work=work_used + probe_work,
                )
            if tick >= steps // 2:
                omega = max(2.0 * math.pi * frequency, 1e-6)
                response_samples.append(np.sqrt(trial.gate_x**2 + (trial.gate_v / omega) ** 2))
        response = np.mean(np.asarray(response_samples), axis=0)
        return response, probe_work

    def measure_spectrum(
        self,
        *,
        port: int = 0,
        probe_frequencies=None,
        steps: int = 80,
        amplitude: float = 0.85,
        work_budget: float | None = None,
    ) -> dict:
        if type(port) is not int or not 0 <= port < 4:
            raise ValueError("probe port must be in [0, 3]")
        frequencies = PROBE_FREQUENCIES if probe_frequencies is None else np.asarray(probe_frequencies, dtype=np.float64)
        if frequencies.ndim != 1 or len(frequencies) == 0 or len(frequencies) > 4 or not np.isfinite(frequencies).all():
            raise ValueError("invalid probe frequencies")
        if type(steps) is not int or steps < 8 or steps * len(frequencies) * GATE_COUNT > self.MAX_DIAGNOSTIC_STEPS:
            raise ValueError("diagnostic step budget exceeded")
        matrix = np.zeros((GATE_COUNT, len(frequencies)), dtype=np.float64)
        probe_work = 0.0
        probe_steps = 0
        for gate in range(GATE_COUNT):
            for column, frequency in enumerate(frequencies):
                response, cost = self._probe_response(
                    float(frequency), gate=gate, port=port,
                    steps=steps, amplitude=amplitude,
                    work_budget=work_budget, work_used=probe_work,
                    steps_used=probe_steps,
                )
                matrix[gate, column] = response[gate]
                probe_work += cost
                probe_steps += steps
        return {
            "probe_frequencies": frequencies.tolist(),
            "channel_response": matrix.tolist(),
            "probe_steps": int(probe_steps),
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
        physics_budget: int | None = None,
    ) -> dict:
        if type(gate) is not int or not 0 <= gate < GATE_COUNT:
            raise ValueError("gate must be in [0, 3]")
        if not math.isfinite(float(frequency)) or not 0.2 < float(frequency) < 2.0:
            raise ValueError("actuation frequency outside bounded range")
        if type(steps) is not int or steps < 1:
            raise ValueError("actuation steps must be a positive integer")
        if physics_budget is not None and self.physics_steps + steps > physics_budget:
            return {
                "accepted": False,
                "selected_gate": gate,
                "gate_opened": False,
                "error": "physics_step_budget_exceeded",
                "work_spent": self.work_spent,
                "world_tick": int(self.field.tick),
            }
        before = self.energy()
        try:
            for _ in range(steps):
                phase = 2.0 * math.pi * frequency * (self.physics_steps + 1) * self.DT
                drive = np.zeros(GATE_COUNT, dtype=np.float64)
                drive[gate] = amplitude * math.sin(phase)
                self.step(
                    drive,
                    count_work=True,
                    physics_budget=physics_budget,
                    work_budget=work_budget,
                )
        except RuntimeError as exc:
            return {
                "accepted": False,
                "selected_gate": gate,
                "gate_opened": False,
                "error": str(exc),
                "energy_delta": float(self.energy() - before),
                "work_spent": self.work_spent,
                "world_tick": int(self.field.tick),
            }
        energy = self.gate_energy()
        opened = bool(
            self.gate_peak_abs[gate] >= self.POSITION_THRESHOLD
            and energy[gate] >= self.ENERGY_THRESHOLD
            and (work_budget is None or self.work_spent <= work_budget + 1e-12)
        )
        if opened:
            self.gate_open[gate] = True
        return {
            "accepted": True,
            "selected_gate": gate,
            "gate_opened": opened,
            "gate_position": float(self.gate_x[gate]),
            "gate_peak_abs": float(self.gate_peak_abs[gate]),
            "gate_velocity": float(self.gate_v[gate]),
            "gate_energy": float(energy[gate]),
            "energy_delta": float(self.energy() - before),
            "work_spent": self.work_spent,
            "work_balance": self.work,
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
            "gate_supplied_work": self.gate_supplied_work,
            "gate_dissipated": self.gate_dissipated,
            "physics_steps": self.physics_steps,
            "initial_energy": self.initial_energy,
        }

    @classmethod
    def restore(cls, state: dict) -> "ContinuousGateWorld":
        if state.get("schema") != "vevo.v03.continuous-gate-world.v1":
            raise ValueError("unsupported continuous gate world schema")
        field_state = copy.deepcopy(state["field"])
        # v0.3 snapshots deliberately omit the legacy ResonantWorld target;
        # the corrected field is neutral and therefore restores with target 0.
        field_state.setdefault("target", 0)
        obj = cls.__new__(cls)
        obj.seed = int(state["seed"])
        obj.field = ResonantWorld.restore(field_state)
        obj.gate_resonance_hz = _finite_vector(state["gate_resonance_hz"], GATE_COUNT, "gate resonance", 10.0)
        obj.gate_x = _finite_vector(state["gate_x"], GATE_COUNT, "gate position", 1e4)
        obj.gate_v = _finite_vector(state["gate_v"], GATE_COUNT, "gate velocity", 1e4)
        obj.gate_peak_abs = _finite_vector(state["gate_peak_abs"], GATE_COUNT, "gate peak", 1e4)
        obj.gate_open = np.asarray(state["gate_open"], dtype=bool).reshape(GATE_COUNT).copy()
        obj.gate_work = float(state["gate_work"])
        obj.gate_supplied_work = float(state["gate_supplied_work"])
        obj.gate_dissipated = float(state["gate_dissipated"])
        obj.physics_steps = int(state["physics_steps"])
        obj.initial_energy = float(state["initial_energy"])
        if not all(math.isfinite(value) for value in (
            obj.gate_work,
            obj.gate_supplied_work,
            obj.gate_dissipated,
            obj.initial_energy,
        )):
            raise ValueError("invalid gate energy accounting")
        if obj.gate_supplied_work < 0.0 or obj.gate_dissipated < 0.0 or obj.physics_steps < 0:
            raise ValueError("invalid gate world resources")
        return obj


class CorrectedEpisode:
    """Exact note + pure measurement + continuous gate actuation episode."""

    WORK_BUDGET = 1.20
    MAX_PHYSICS_STEPS = 96
    VIRTUAL_STEP_BUDGET = ContinuousGateWorld.MAX_DIAGNOSTIC_STEPS
    VIRTUAL_WORK_BUDGET = 7.00
    MAX_TOOL_CALLS = 3
    SINGLE_GATE_ONLY = True

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

    def _reserve_tool(self, schema: str, stage: str) -> tuple[bool, dict | None]:
        if self.tool_calls >= self.MAX_TOOL_CALLS:
            result = {
                "schema": schema,
                "stage": stage,
                "accepted": False,
                "error": "tool_budget_exceeded",
                "tool_calls": self.tool_calls,
                "tool_budget": self.MAX_TOOL_CALLS,
            }
            self.events.append({"type": "tool.rejected", **result})
            return False, result
        self.tool_calls += 1
        return True, None

    @staticmethod
    def _project_policy_fields(result: dict | None, fields: tuple[str, ...]) -> dict | None:
        if result is None:
            return None
        return {key: copy.deepcopy(result[key]) for key in fields if key in result}

    def policy_observation(self) -> dict:
        """Whitelist note/spectrum/tool feedback; omit checkpoint-only internals."""

        return {
            "schema": "vevo.v03.policy-observation.v1",
            "note": self._project_policy_fields(self.note_result, POLICY_NOTE_FIELDS),
            "measurement": self._project_policy_fields(self.measurement, POLICY_MEASUREMENT_FIELDS),
            "feedback": self._project_policy_fields(self.last_result, POLICY_FEEDBACK_FIELDS),
            "resources": {
                "tool_calls": self.tool_calls,
                "tool_budget": self.MAX_TOOL_CALLS,
                "virtual_steps": self.virtual_steps,
                "virtual_step_budget": self.VIRTUAL_STEP_BUDGET,
                "virtual_work": self.virtual_work,
                "virtual_work_budget": self.VIRTUAL_WORK_BUDGET,
            },
        }

    def advance(self, port_drives=None) -> np.ndarray:
        self.world.step(
            port_drives=port_drives,
            physics_budget=self.MAX_PHYSICS_STEPS,
            work_budget=self.WORK_BUDGET,
        )
        self.events.append({"type": "field.advance", "tick": self.world.field.tick})
        return self.world.observe()

    def execute_note(self, note_id: str = "instruction", *, expected_revision: int | None = None) -> dict:
        allowed, rejection = self._reserve_tool("vevo.v03.note-result.v1", "note")
        if not allowed:
            self.note_result = rejection
            return rejection
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
        allowed, rejection = self._reserve_tool("vevo.v03.measurement-result.v1", "diagnostic")
        if not allowed:
            rejection["pure_measurement"] = True
            self.measurement = rejection
            return rejection
        if self.note_result is None or not self.note_result.get("accepted"):
            result = {
                "schema": "vevo.v03.measurement-result.v1",
                "stage": "diagnostic",
                "accepted": False,
                "pure_measurement": True,
                "error": "note_unavailable",
            }
        else:
            if type(selected_port) is not int or not 0 <= selected_port < 4:
                result = {
                    "schema": "vevo.v03.measurement-result.v1",
                    "stage": "diagnostic",
                    "accepted": False,
                    "pure_measurement": True,
                    "error": "bad_probe_port",
                }
            else:
                probe_steps = 80 * len(PROBE_FREQUENCIES) * GATE_COUNT
                if self.virtual_steps + probe_steps > self.VIRTUAL_STEP_BUDGET:
                    result = {
                        "schema": "vevo.v03.measurement-result.v1",
                        "stage": "diagnostic",
                        "accepted": False,
                        "pure_measurement": True,
                        "error": "virtual_probe_step_budget_exceeded",
                        "virtual_steps_total": self.virtual_steps,
                        "virtual_step_budget": self.VIRTUAL_STEP_BUDGET,
                    }
                else:
                    try:
                        measured = self.world.measure_spectrum(
                            port=selected_port,
                            work_budget=self.VIRTUAL_WORK_BUDGET - self.virtual_work,
                        )
                    except VirtualProbeBudgetExceeded as exc:
                        self.virtual_steps += exc.steps
                        self.virtual_work += exc.work
                        within_budget = bool(
                            self.virtual_steps <= self.VIRTUAL_STEP_BUDGET
                            and self.virtual_work <= self.VIRTUAL_WORK_BUDGET
                        )
                        result = {
                            "schema": "vevo.v03.measurement-result.v1",
                            "stage": "diagnostic",
                            "accepted": False,
                            "pure_measurement": True,
                            "error": str(exc),
                            "virtual_steps_consumed": exc.steps,
                            "virtual_work_consumed": exc.work,
                            "virtual_steps_total": self.virtual_steps,
                            "virtual_work_total": self.virtual_work,
                            "virtual_step_budget": self.VIRTUAL_STEP_BUDGET,
                            "virtual_work_budget": self.VIRTUAL_WORK_BUDGET,
                            "resource_budget_ok": within_budget,
                        }
                    except RuntimeError as exc:
                        result = {
                            "schema": "vevo.v03.measurement-result.v1",
                            "stage": "diagnostic",
                            "accepted": False,
                            "pure_measurement": True,
                            "error": str(exc),
                            "virtual_steps_total": self.virtual_steps,
                            "virtual_work_total": self.virtual_work,
                            "virtual_step_budget": self.VIRTUAL_STEP_BUDGET,
                            "virtual_work_budget": self.VIRTUAL_WORK_BUDGET,
                            "resource_budget_ok": False,
                        }
                    else:
                        self.virtual_steps += int(measured["probe_steps"])
                        self.virtual_work += float(measured["probe_work"])
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
                            "resource_budget_ok": True,
                        }
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
        allowed, rejection = self._reserve_tool("vevo.v03.actuation-result.v1", "actuation")
        if not allowed:
            self.last_result = rejection
            return rejection
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
        if self.world.physics_steps + self.world.ACTUATION_STEPS > self.MAX_PHYSICS_STEPS:
            result = {
                "schema": "vevo.v03.actuation-result.v1",
                "stage": "actuation",
                "accepted": False,
                "gate_opened": False,
                "error": "physics_step_budget_exceeded",
                "physics_steps": self.world.physics_steps,
                "physics_budget": self.MAX_PHYSICS_STEPS,
            }
            self.last_result = result
            return result
        if self.world.work_spent > self.WORK_BUDGET + 1e-12:
            result = {
                "schema": "vevo.v03.actuation-result.v1",
                "stage": "actuation",
                "accepted": False,
                "gate_opened": False,
                "error": "work_budget_exceeded",
                "work_spent": self.world.work_spent,
                "work_budget": self.WORK_BUDGET,
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
            try:
                physical = self.world.actuate_gate(
                    selected_gate,
                    frequency=frequency,
                    work_budget=self.WORK_BUDGET,
                    physics_budget=self.MAX_PHYSICS_STEPS,
                )
            except ValueError as exc:
                physical = {
                    "accepted": False,
                    "selected_gate": int(selected_gate),
                    "gate_opened": False,
                    "error": str(exc),
                    "work_spent": self.world.work_spent,
                    "world_tick": int(self.world.field.tick),
                }
        else:
            physical = {
                "accepted": False,
                "selected_gate": int(selected_gate),
                "gate_opened": False,
                "gate_position": float(self.world.gate_x[selected_gate]),
                "gate_peak_abs": float(self.world.gate_peak_abs[selected_gate]),
                "gate_velocity": float(self.world.gate_v[selected_gate]),
                "gate_energy": float(self.world.gate_energy()[selected_gate]),
                "energy_delta": 0.0,
                "work_spent": self.world.work_spent,
                "world_tick": int(self.world.field.tick),
            }
        # No target label, mapping equality or diagnostic answer participates
        # here.  `gate_opened` is solely a continuous world-state threshold.
        result = {
            "schema": "vevo.v03.actuation-result.v1",
            "stage": "actuation",
            "accepted": bool(enabled and physical.get("accepted", False)),
            "drive_frequency": frequency,
            "work_delta": float(self.world.work - before_work),
            "work_spent": self.world.work_spent,
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
        if self.tool_calls > self.MAX_TOOL_CALLS:
            return False
        if self.virtual_steps > self.VIRTUAL_STEP_BUDGET or self.virtual_work > self.VIRTUAL_WORK_BUDGET:
            return False
        if self.world.physics_steps > self.MAX_PHYSICS_STEPS or self.world.work_spent > self.WORK_BUDGET + 1e-12:
            return False
        if self.last_result is None or not self.last_result.get("accepted") or not self.last_result.get("gate_opened"):
            return False
        if self.SINGLE_GATE_ONLY and int(np.count_nonzero(self.world.gate_open)) != 1:
            return False
        try:
            instruction = self._parse_note()
        except (RuntimeError, ValueError, KeyError, TypeError):
            return False
        matching_gate = np.isclose(
            self.world.gate_resonance_hz,
            instruction.target_hz,
            rtol=0.0,
            atol=SUCCESS_TOLERANCE_HZ,
        )
        selected_gate = self.last_result.get("selected_gate")
        if type(selected_gate) is not int or not 0 <= selected_gate < GATE_COUNT:
            return False
        return bool(self.world.gate_open[selected_gate] and matching_gate[selected_gate])

    def snapshot(self) -> dict:
        return {
            "schema": "vevo.v03.corrected-episode.v1",
            "seed": self.seed,
            "world": self.world.snapshot(),
            "workspace": self.workspace.snapshot(),
            "note_result": copy.deepcopy(self.note_result),
            "measurement": copy.deepcopy(self.measurement),
            "last_result": copy.deepcopy(self.last_result),
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
                "live_work_spent": self.world.work_spent,
                "live_work_budget": self.WORK_BUDGET,
            },
            "events": copy.deepcopy(self.events),
        }

    @classmethod
    def restore(cls, state: dict) -> "CorrectedEpisode":
        if state.get("schema") != "vevo.v03.corrected-episode.v1":
            raise ValueError("unsupported corrected episode schema")
        obj = cls.__new__(cls)
        obj.seed = int(state["seed"])
        obj.world = ContinuousGateWorld.restore(state["world"])
        obj.workspace = NoteWorkspace.restore(state["workspace"])
        obj.note_result = copy.deepcopy(state.get("note_result"))
        obj.measurement = copy.deepcopy(state.get("measurement"))
        obj.last_result = copy.deepcopy(state.get("last_result"))
        obj.events = copy.deepcopy(state.get("events", []))
        resources = state.get("resources", {})
        # Preserve instance-specific reduced limits.  A checkpoint may narrow
        # a budget for a sandboxed continuation, but it may never use restore
        # to silently widen the class contract.
        limit_specs = (
            ("MAX_TOOL_CALLS", "tool_budget", int, 0),
            ("VIRTUAL_STEP_BUDGET", "virtual_step_budget", int, 0),
            ("VIRTUAL_WORK_BUDGET", "virtual_work_budget", float, 0.0),
            ("MAX_PHYSICS_STEPS", "live_physics_budget", int, 0),
            ("WORK_BUDGET", "live_work_budget", float, 0.0),
        )
        for attr, key, converter, minimum in limit_specs:
            default = getattr(cls, attr)
            raw = resources.get(key, default)
            try:
                value = converter(raw)
            except (TypeError, ValueError, OverflowError):
                raise ValueError(f"invalid episode limit: {key}") from None
            if isinstance(raw, bool) or not math.isfinite(float(value)):
                raise ValueError(f"invalid episode limit: {key}")
            if converter is int and float(value) != float(raw):
                raise ValueError(f"invalid episode limit: {key}")
            if value < minimum or value > default:
                raise ValueError(f"episode restore cannot loosen or remove limit: {key}")
            setattr(obj, attr, value)
        obj.tool_calls = int(resources.get("tool_calls", 0))
        obj.virtual_steps = int(resources.get("virtual_steps", 0))
        obj.virtual_work = float(resources.get("virtual_work", 0.0))
        if obj.tool_calls < 0 or obj.virtual_steps < 0 or obj.virtual_work < 0.0:
            raise ValueError("invalid episode resources")
        return obj


def measurement_only_action(measurement: dict) -> tuple[int, float]:
    """Select both gate and drive frequency from the raw measurement only."""

    matrix = np.asarray(measurement["channel_response"], dtype=np.float64)
    frequencies = np.asarray(measurement["probe_frequencies"], dtype=np.float64)
    flat_index = int(np.argmax(matrix))
    gate, column = np.unravel_index(flat_index, matrix.shape)
    return int(gate), float(frequencies[column])


def null_policy_action(measurement: dict) -> int:
    """A note-blind baseline that takes the largest measured response."""

    return measurement_only_action(measurement)[0]


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
    action, drive_frequency = measurement_only_action(measurement)
    # The baseline ignores both note content and its target frequency.
    result = episode.execute_actuation(action, drive_frequency=drive_frequency)
    return {
        "note": note,
        "measurement": measurement,
        "null_action": action,
        "null_drive_frequency": drive_frequency,
        "result": result,
        "success": episode.success(),
    }


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
        "single_gate_only": CorrectedEpisode.SINGLE_GATE_ONLY,
        "policy_input_whitelist": {
            "note": list(POLICY_NOTE_FIELDS),
            "measurement": list(POLICY_MEASUREMENT_FIELDS),
            "feedback": list(POLICY_FEEDBACK_FIELDS),
            "excluded_checkpoint_fields": ["seed", "gate_resonance_hz", "calibration", "world_snapshot"],
        },
    }
