"""Bounded simulated-futures planning over the local resonant world.

This module is deliberately a known-simulator planning prototype.  It is not a
trained neural world model, does not inspect the world's hidden target,
calibration, or natural frequencies, and does not create permission grants.
The actual executor uses :class:`~vevo_agents.physics.ResonantWorld`; the
forecast model reconstructs only the public observation whitelist and uses a
fixed nominal simulator parameterization.

The prototype is intentionally small and auditable:

* the action set is coast plus positive/negative bounded drives at ports 0/1;
* a two-action forecast has exactly 5**2 == 25 candidate sequences;
* virtual rollout accounting is separate from the four-cycle actual budget and
  the full-episode open-loop baseline has its own larger, explicit cost;
* only the first receding-horizon action is executed before a fresh observation;
* cancellation, execution errors, and uncertain effects are terminal and never
  bypassed by trying another action.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, replace
import hashlib
import itertools
import json
import math
from pathlib import Path
from typing import Any, Iterable, Literal, Sequence

import numpy as np

from .physics import ResonantWorld


PLANNER_SCHEMA = "vevo.v03.simulator-planner.v2"
PREDICTOR_SCHEMA = "vevo.v03.known-simulator-predictor.v2"
PUBLIC_OBSERVATION_SCHEMA = "vevo.v03.public-world-observation.v1"
VALIDATED_PORTS = (0, 1)
NODE_COUNT = ResonantWorld.NODES
ACTION_DURATION_TICKS = 2
ACTION_DRIVE_MAGNITUDE = 0.16
CANDIDATE_ACTION_COUNT = len(VALIDATED_PORTS) * 2 + 1
MAX_ACTION_HORIZON = 2
MAX_ACTUAL_CYCLES = 4
MAX_ACTUAL_PHYSICS_STEPS = MAX_ACTUAL_CYCLES * ACTION_DURATION_TICKS
TWO_STEP_CANDIDATE_COUNT = CANDIDATE_ACTION_COUNT**MAX_ACTION_HORIZON
MAX_VIRTUAL_CANDIDATES = MAX_ACTUAL_CYCLES * TWO_STEP_CANDIDATE_COUNT
MAX_VIRTUAL_PHYSICS_STEPS = MAX_VIRTUAL_CANDIDATES * MAX_ACTION_HORIZON * ACTION_DURATION_TICKS
FULL_EPISODE_OPEN_LOOP_HORIZON = MAX_ACTUAL_CYCLES
FULL_EPISODE_CANDIDATE_COUNT = CANDIDATE_ACTION_COUNT**FULL_EPISODE_OPEN_LOOP_HORIZON
FULL_EPISODE_VIRTUAL_PHYSICS_STEPS = (
    FULL_EPISODE_CANDIDATE_COUNT * FULL_EPISODE_OPEN_LOOP_HORIZON * ACTION_DURATION_TICKS
)
MAX_GREEDY_VIRTUAL_CANDIDATES = MAX_ACTUAL_CYCLES * CANDIDATE_ACTION_COUNT
MAX_GREEDY_VIRTUAL_PHYSICS_STEPS = MAX_GREEDY_VIRTUAL_CANDIDATES * ACTION_DURATION_TICKS
NOMINAL_CALIBRATION = {
    "frequency_a": 0.50,
    "frequency_b": 0.75,
    "phase": 0.0,
}
NOMINAL_OMEGA = (
    2.0 * math.pi * NOMINAL_CALIBRATION["frequency_a"],
    2.0 * math.pi * NOMINAL_CALIBRATION["frequency_b"],
    2.0 * math.pi,
    2.0 * math.pi * 1.2,
)

VIRTUAL_BUDGETS = {
    # Coast still performs one public diagnostic forecast per actual cycle;
    # that compute is charged rather than hidden.
    "coast": (MAX_ACTUAL_CYCLES, MAX_ACTUAL_CYCLES * ACTION_DURATION_TICKS),
    "greedy": (MAX_GREEDY_VIRTUAL_CANDIDATES, MAX_GREEDY_VIRTUAL_PHYSICS_STEPS),
    "open_loop_full_episode": (FULL_EPISODE_CANDIDATE_COUNT, FULL_EPISODE_VIRTUAL_PHYSICS_STEPS),
    "receding_horizon": (MAX_VIRTUAL_CANDIDATES, MAX_VIRTUAL_PHYSICS_STEPS),
}

PUBLIC_OBSERVATION_FIELDS = (
    "tick",
    "time",
    "node_displacements",
    "node_velocities",
    "oscillator_amplitudes",
    "oscillator_velocities",
    "local_oscillator_energies",
    "neighbor_amplitude_means",
    "total_energy",
    "residual",
    "supplied_work",
)


class PlannerError(ValueError):
    """Base error for invalid planner inputs or bounded execution failures."""


class PlannerBudgetError(PlannerError):
    """A virtual or actual planner budget cannot cover the requested work."""


def _finite(value: Any, *, name: str) -> float:
    if isinstance(value, (bool, np.bool_)):
        raise PlannerError(f"{name} must be a finite scalar")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise PlannerError(f"{name} must be a finite scalar") from exc
    if not math.isfinite(result):
        raise PlannerError(f"{name} must be a finite scalar")
    return result


def _finite_tuple(value: Iterable[Any], *, name: str, length: int) -> tuple[float, ...]:
    try:
        raw_values = tuple(value)
    except TypeError as exc:
        raise PlannerError(f"{name} must be an iterable of finite values") from exc
    values = tuple(_finite(item, name=name) for item in raw_values)
    if len(values) != length:
        raise PlannerError(f"{name} must have length {length}")
    return values


@dataclass(frozen=True, slots=True)
class PlannerAction:
    """One validated fixed-duration action from the public action set."""

    name: str
    port: int | None
    sign: int
    duration_ticks: int = ACTION_DURATION_TICKS
    drive_magnitude: float = ACTION_DRIVE_MAGNITUDE

    def __post_init__(self) -> None:
        if not self.name:
            raise PlannerError("action name must be non-empty")
        if self.port is None:
            if self.sign != 0 or self.name != "coast":
                raise PlannerError("coast must use the coast action identity")
        elif type(self.port) is not int or self.port not in VALIDATED_PORTS:
            raise PlannerError("action port is outside the validated action set")
        if self.port is not None and self.sign not in (-1, 1):
            raise PlannerError("driven actions must use sign -1 or +1")
        if type(self.duration_ticks) is not int or self.duration_ticks != ACTION_DURATION_TICKS:
            raise PlannerError("action duration is outside the fixed bounded duration")
        magnitude = _finite(self.drive_magnitude, name="drive_magnitude")
        if magnitude <= 0.0 or magnitude > 0.2:
            raise PlannerError("drive magnitude exceeds the simulator port bound")

    @property
    def drive_vector(self) -> tuple[float, ...]:
        values = [0.0] * NODE_COUNT
        if self.port is not None:
            values[self.port] = self.sign * self.drive_magnitude
        return tuple(values)

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": "vevo.v03.planner-action.v1",
            "name": self.name,
            "port": self.port,
            "sign": self.sign,
            "duration_ticks": self.duration_ticks,
            "drive_vector": list(self.drive_vector),
        }


def candidate_actions() -> tuple[PlannerAction, ...]:
    """Return the complete, deterministic five-action candidate set."""

    return (
        PlannerAction("coast", None, 0),
        PlannerAction("drive_positive_port_0", 0, 1),
        PlannerAction("drive_negative_port_0", 0, -1),
        PlannerAction("drive_positive_port_1", 1, 1),
        PlannerAction("drive_negative_port_1", 1, -1),
    )


@dataclass(frozen=True, slots=True)
class PublicObservation:
    """The only world fields admitted to planning and forecasting."""

    fixture_id: str
    cycle: int
    tick: int
    time: float
    node_displacements: tuple[float, ...]
    node_velocities: tuple[float, ...]
    oscillator_amplitudes: tuple[float, ...]
    oscillator_velocities: tuple[float, ...]
    local_oscillator_energies: tuple[float, ...]
    neighbor_amplitude_means: tuple[float, ...]
    total_energy: float
    residual: float
    supplied_work: float

    def __post_init__(self) -> None:
        if not self.fixture_id:
            raise PlannerError("observation fixture_id must be non-empty")
        if type(self.cycle) is not int or self.cycle < 0:
            raise PlannerError("observation cycle must be a non-negative integer")
        if type(self.tick) is not int or self.tick < 0:
            raise PlannerError("observation tick must be a non-negative integer")
        _finite(self.time, name="observation time")
        normalized: dict[str, tuple[float, ...]] = {}
        for field_name, value, name in (
            ("node_displacements", self.node_displacements, "node_displacements"),
            ("node_velocities", self.node_velocities, "node_velocities"),
            ("oscillator_amplitudes", self.oscillator_amplitudes, "oscillator_amplitudes"),
            ("oscillator_velocities", self.oscillator_velocities, "oscillator_velocities"),
            ("local_oscillator_energies", self.local_oscillator_energies, "local_oscillator_energies"),
            ("neighbor_amplitude_means", self.neighbor_amplitude_means, "neighbor_amplitude_means"),
        ):
            normalized[field_name] = _finite_tuple(value, name=name, length=NODE_COUNT)
        for field_name, value in normalized.items():
            object.__setattr__(self, field_name, value)
        for value, name in (
            (self.node_displacements, "node_displacements"),
            (self.node_velocities, "node_velocities"),
            (self.oscillator_amplitudes, "oscillator_amplitudes"),
            (self.oscillator_velocities, "oscillator_velocities"),
            (self.local_oscillator_energies, "local_oscillator_energies"),
            (self.neighbor_amplitude_means, "neighbor_amplitude_means"),
        ):
            if len(value) != NODE_COUNT or not all(math.isfinite(float(item)) for item in value):
                raise PlannerError(f"{name} must be finite with length {NODE_COUNT}")
        _finite(self.total_energy, name="observation total_energy")
        _finite(self.residual, name="observation residual")
        supplied_work = _finite(self.supplied_work, name="observation supplied_work")
        if supplied_work < 0.0:
            raise PlannerError("observation supplied_work must be non-negative")

    @classmethod
    def from_world(cls, world: ResonantWorld, *, fixture_id: str, cycle: int) -> "PublicObservation":
        raw = np.asarray(world.observe(), dtype=np.float64)
        if raw.shape != (NODE_COUNT, 6) or not np.isfinite(raw).all():
            raise PlannerError("world public observation has an invalid shape or non-finite value")
        return cls(
            fixture_id=fixture_id,
            cycle=cycle,
            tick=int(world.tick),
            time=float(world.tick * world.DT),
            node_displacements=tuple(float(item) for item in raw[:, 2]),
            node_velocities=tuple(float(item) for item in raw[:, 3]),
            oscillator_amplitudes=tuple(float(item) for item in raw[:, 0]),
            oscillator_velocities=tuple(float(item) for item in raw[:, 1]),
            local_oscillator_energies=tuple(float(item) for item in raw[:, 4]),
            neighbor_amplitude_means=tuple(float(item) for item in raw[:, 5]),
            total_energy=float(world.energy()),
            residual=float(world.residual),
            supplied_work=float(world.supplied_work),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": PUBLIC_OBSERVATION_SCHEMA,
            "fixture_id": self.fixture_id,
            "cycle": self.cycle,
            "tick": self.tick,
            "time": self.time,
            "node_displacements": list(self.node_displacements),
            "node_velocities": list(self.node_velocities),
            "oscillator_amplitudes": list(self.oscillator_amplitudes),
            "oscillator_velocities": list(self.oscillator_velocities),
            "local_oscillator_energies": list(self.local_oscillator_energies),
            "neighbor_amplitude_means": list(self.neighbor_amplitude_means),
            "total_energy": self.total_energy,
            "residual": self.residual,
            "supplied_work": self.supplied_work,
        }

    def digest(self) -> str:
        encoded = json.dumps(self.as_dict(), sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True, slots=True)
class PlanningGoal:
    """A public measurable goal combining geometry, energy, time, and work."""

    goal_id: str
    target_port: int
    min_target_oscillator_energy: float
    max_neighbor_oscillator_energy: float
    min_node_separation_delta: float
    max_time: float
    max_work: float
    max_cycles: int = MAX_ACTUAL_CYCLES

    def __post_init__(self) -> None:
        if not self.goal_id:
            raise PlannerError("goal_id must be non-empty")
        if type(self.target_port) is not int or self.target_port not in VALIDATED_PORTS:
            raise PlannerError("goal target_port must be one of the validated ports")
        for value, name in (
            (self.min_target_oscillator_energy, "min_target_oscillator_energy"),
            (self.max_neighbor_oscillator_energy, "max_neighbor_oscillator_energy"),
            (self.min_node_separation_delta, "min_node_separation_delta"),
            (self.max_time, "max_time"),
            (self.max_work, "max_work"),
        ):
            if _finite(value, name=name) < 0.0:
                raise PlannerError(f"{name} must be non-negative")
        if type(self.max_cycles) is not int or not 1 <= self.max_cycles <= MAX_ACTUAL_CYCLES:
            raise PlannerError("goal max_cycles exceeds the actual cycle budget")

    @property
    def neighbor_ports(self) -> tuple[int, ...]:
        return (1,) if self.target_port == 0 else (0, 2)

    def assess(self, observation: PublicObservation) -> "GoalAssessment":
        target_energy = observation.local_oscillator_energies[self.target_port]
        neighbor_energy = max(observation.local_oscillator_energies[index] for index in self.neighbor_ports)
        separation_delta = abs(observation.node_displacements[0] - observation.node_displacements[1])
        return GoalAssessment(
            target_energy=target_energy,
            neighbor_energy=neighbor_energy,
            separation_delta=separation_delta,
            time=observation.time,
            supplied_work=observation.supplied_work,
            target_energy_ok=target_energy >= self.min_target_oscillator_energy,
            neighbor_energy_ok=neighbor_energy <= self.max_neighbor_oscillator_energy,
            separation_ok=separation_delta >= self.min_node_separation_delta,
            time_ok=observation.time <= self.max_time + 1.0e-12,
            work_ok=observation.supplied_work <= self.max_work + 1.0e-12,
        )


@dataclass(frozen=True, slots=True)
class GoalAssessment:
    target_energy: float
    neighbor_energy: float
    separation_delta: float
    time: float
    supplied_work: float
    target_energy_ok: bool
    neighbor_energy_ok: bool
    separation_ok: bool
    time_ok: bool
    work_ok: bool

    @property
    def reached(self) -> bool:
        return all(
            (
                self.target_energy_ok,
                self.neighbor_energy_ok,
                self.separation_ok,
                self.time_ok,
                self.work_ok,
            )
        )

    @property
    def hard_constraints_ok(self) -> bool:
        """Return whether a forecast may remain in the candidate set."""

        return self.neighbor_energy_ok and self.time_ok and self.work_ok

    @property
    def hard_constraint_failures(self) -> tuple[str, ...]:
        failures: list[str] = []
        if not self.neighbor_energy_ok:
            failures.append("neighbor_energy")
        if not self.time_ok:
            failures.append("time")
        if not self.work_ok:
            failures.append("supplied_work")
        return tuple(failures)

    def score(self, goal: PlanningGoal) -> float:
        # These are hard planning constraints.  A candidate that violates one
        # is rejected instead of receiving a merely worse soft score.
        if not self.hard_constraints_ok:
            return math.inf
        target_scale = max(goal.min_target_oscillator_energy, 1.0e-12)
        neighbor_scale = max(goal.max_neighbor_oscillator_energy, 1.0e-12)
        separation_scale = max(goal.min_node_separation_delta, 1.0e-12)
        target_deficit = max(0.0, goal.min_target_oscillator_energy - self.target_energy) / target_scale
        neighbor_excess = max(0.0, self.neighbor_energy - goal.max_neighbor_oscillator_energy) / neighbor_scale
        separation_deficit = max(0.0, goal.min_node_separation_delta - self.separation_delta) / separation_scale
        resource_fraction = 0.05 * self.time / max(goal.max_time, 1.0e-12)
        resource_fraction += 0.05 * self.supplied_work / max(goal.max_work, 1.0e-12)
        return float(4.0 * target_deficit + 5.0 * neighbor_excess + 3.0 * separation_deficit + resource_fraction)

    def as_dict(self) -> dict[str, Any]:
        return {
            "target_energy": self.target_energy,
            "neighbor_energy": self.neighbor_energy,
            "separation_delta": self.separation_delta,
            "time": self.time,
            "supplied_work": self.supplied_work,
            "target_energy_ok": self.target_energy_ok,
            "neighbor_energy_ok": self.neighbor_energy_ok,
            "separation_ok": self.separation_ok,
            "time_ok": self.time_ok,
            "work_ok": self.work_ok,
            "hard_constraints_ok": self.hard_constraints_ok,
            "hard_constraint_failures": list(self.hard_constraint_failures),
            "reached": self.reached,
        }


@dataclass(frozen=True, slots=True)
class BudgetSnapshot:
    virtual_budget_kind: str
    actual_cycle_limit: int
    actual_physics_step_limit: int
    virtual_candidate_limit: int
    virtual_physics_step_limit: int
    reserved_actual_cycles: int
    reserved_actual_physics_steps: int
    known_executed_physics_steps: int
    unknown_outcome_physics_steps: int
    virtual_candidates: int
    virtual_physics_steps: int
    supplied_work: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "virtual_budget_kind": self.virtual_budget_kind,
            "actual_cycle_limit": self.actual_cycle_limit,
            "actual_physics_step_limit": self.actual_physics_step_limit,
            "virtual_candidate_limit": self.virtual_candidate_limit,
            "virtual_physics_step_limit": self.virtual_physics_step_limit,
            "reserved_actual_cycles": self.reserved_actual_cycles,
            "reserved_actual_physics_steps": self.reserved_actual_physics_steps,
            "known_executed_physics_steps": self.known_executed_physics_steps,
            "unknown_outcome_physics_steps": self.unknown_outcome_physics_steps,
            "virtual_candidates": self.virtual_candidates,
            "virtual_physics_steps": self.virtual_physics_steps,
            "supplied_work": self.supplied_work,
        }


class _BudgetState:
    def __init__(
        self,
        *,
        virtual_budget_kind: str = "receding_horizon",
        virtual_candidate_limit: int = MAX_VIRTUAL_CANDIDATES,
        virtual_physics_step_limit: int = MAX_VIRTUAL_PHYSICS_STEPS,
    ) -> None:
        if virtual_budget_kind not in VIRTUAL_BUDGETS:
            raise PlannerError(f"unknown virtual budget kind: {virtual_budget_kind}")
        if type(virtual_candidate_limit) is not int or virtual_candidate_limit < 0:
            raise PlannerError("virtual_candidate_limit must be a non-negative integer")
        if type(virtual_physics_step_limit) is not int or virtual_physics_step_limit < 0:
            raise PlannerError("virtual_physics_step_limit must be a non-negative integer")
        self.virtual_budget_kind = virtual_budget_kind
        self.virtual_candidate_limit = virtual_candidate_limit
        self.virtual_physics_step_limit = virtual_physics_step_limit
        self.reserved_actual_cycles = 0
        self.reserved_actual_physics_steps = 0
        self.known_executed_physics_steps = 0
        self.unknown_outcome_physics_steps = 0
        self.virtual_candidates = 0
        self.virtual_physics_steps = 0

    def reserve_virtual(self, candidates: int, physics_steps: int) -> None:
        if candidates < 0 or physics_steps < 0:
            raise PlannerError("virtual budget reservations must be non-negative")
        if self.virtual_candidates + candidates > self.virtual_candidate_limit:
            raise PlannerBudgetError("virtual candidate budget exhausted")
        if self.virtual_physics_steps + physics_steps > self.virtual_physics_step_limit:
            raise PlannerBudgetError("virtual physics-step budget exhausted")
        self.virtual_candidates += candidates
        self.virtual_physics_steps += physics_steps

    def reserve_actual(self) -> None:
        if self.reserved_actual_cycles >= MAX_ACTUAL_CYCLES:
            raise PlannerBudgetError("actual cycle budget exhausted")
        if self.reserved_actual_physics_steps + ACTION_DURATION_TICKS > MAX_ACTUAL_PHYSICS_STEPS:
            raise PlannerBudgetError("actual physics-step budget exhausted")
        self.reserved_actual_cycles += 1
        self.reserved_actual_physics_steps += ACTION_DURATION_TICKS

    def record_action_result(self, result: "ActionResult") -> None:
        self.known_executed_physics_steps += result.known_executed_ticks
        self.unknown_outcome_physics_steps += result.unknown_outcome_ticks

    def snapshot(self, supplied_work: float) -> BudgetSnapshot:
        return BudgetSnapshot(
            virtual_budget_kind=self.virtual_budget_kind,
            actual_cycle_limit=MAX_ACTUAL_CYCLES,
            actual_physics_step_limit=MAX_ACTUAL_PHYSICS_STEPS,
            virtual_candidate_limit=self.virtual_candidate_limit,
            virtual_physics_step_limit=self.virtual_physics_step_limit,
            reserved_actual_cycles=self.reserved_actual_cycles,
            reserved_actual_physics_steps=self.reserved_actual_physics_steps,
            known_executed_physics_steps=self.known_executed_physics_steps,
            unknown_outcome_physics_steps=self.unknown_outcome_physics_steps,
            virtual_candidates=self.virtual_candidates,
            virtual_physics_steps=self.virtual_physics_steps,
            supplied_work=float(supplied_work),
        )


@dataclass(frozen=True, slots=True)
class ForecastRecord:
    predictor_schema: str
    plan_cycle: int
    horizon: int
    candidate_count: int
    virtual_physics_steps: int
    actions: tuple[PlannerAction, ...]
    predicted_observations: tuple[PublicObservation, ...]
    predicted_assessments: tuple[GoalAssessment, ...]
    selected_index: int
    score: float
    planning_horizon: int | None = None
    feasible_candidate_count: int = 0
    rejected_candidate_count: int = 0
    rejection_counts: tuple[tuple[str, int], ...] = ()
    reused: bool = False

    def __post_init__(self) -> None:
        actions = tuple(self.actions)
        predicted_observations = tuple(self.predicted_observations)
        predicted_assessments = tuple(self.predicted_assessments)
        rejection_counts = tuple((str(name), int(count)) for name, count in self.rejection_counts)
        object.__setattr__(self, "actions", actions)
        object.__setattr__(self, "predicted_observations", predicted_observations)
        object.__setattr__(self, "predicted_assessments", predicted_assessments)
        object.__setattr__(self, "rejection_counts", rejection_counts)
        planning_horizon = self.horizon if self.planning_horizon is None else self.planning_horizon
        object.__setattr__(self, "planning_horizon", planning_horizon)
        if type(self.plan_cycle) is not int or self.plan_cycle < 0:
            raise PlannerError("forecast plan_cycle must be a non-negative integer")
        if type(self.horizon) is not int or not 1 <= self.horizon <= FULL_EPISODE_OPEN_LOOP_HORIZON:
            raise PlannerError("forecast horizon is outside the bounded range")
        if type(planning_horizon) is not int or not self.horizon <= planning_horizon <= FULL_EPISODE_OPEN_LOOP_HORIZON:
            raise PlannerError("forecast planning_horizon is outside the bounded range")
        if len(actions) != self.horizon:
            raise PlannerError("forecast action count must equal its execution horizon")
        if len(predicted_observations) != self.horizon or len(predicted_assessments) != self.horizon:
            raise PlannerError("forecast prediction lengths must equal its execution horizon")
        for value, name in (
            (self.candidate_count, "candidate_count"),
            (self.virtual_physics_steps, "virtual_physics_steps"),
            (self.feasible_candidate_count, "feasible_candidate_count"),
            (self.rejected_candidate_count, "rejected_candidate_count"),
        ):
            if type(value) is not int or value < 0:
                raise PlannerError(f"forecast {name} must be a non-negative integer")

    def as_dict(self) -> dict[str, Any]:
        return {
            "predictor_schema": self.predictor_schema,
            "plan_cycle": self.plan_cycle,
            "horizon": self.horizon,
            "planning_horizon": self.planning_horizon,
            "candidate_count": self.candidate_count,
            "feasible_candidate_count": self.feasible_candidate_count,
            "rejected_candidate_count": self.rejected_candidate_count,
            "rejection_counts": {name: count for name, count in self.rejection_counts},
            "virtual_physics_steps": self.virtual_physics_steps,
            "actions": [action.as_dict() for action in self.actions],
            "predicted_observations": [observation.as_dict() for observation in self.predicted_observations],
            "predicted_assessments": [assessment.as_dict() for assessment in self.predicted_assessments],
            "selected_index": self.selected_index,
            "score": self.score,
            "reused": self.reused,
        }


@dataclass(frozen=True, slots=True)
class ForecastResidual:
    """Public forecast-versus-realized residuals for one action cycle."""

    comparison_status: Literal[
        "compared",
        "cancelled_before_dispatch",
        "uncertain_outcome",
        "execution_error",
    ]
    prediction_source: Literal["fresh_forecast", "reused_forecast", "coast_diagnostic"]
    predicted_tick: int
    actual_tick: int
    predicted_time: float
    actual_time: float
    node_displacement_l2_error: float
    total_energy_abs_error: float
    residual_abs_error: float
    supplied_work_abs_error: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "comparison_status": self.comparison_status,
            "prediction_source": self.prediction_source,
            "predicted_tick": self.predicted_tick,
            "actual_tick": self.actual_tick,
            "predicted_time": self.predicted_time,
            "actual_time": self.actual_time,
            "node_displacement_l2_error": self.node_displacement_l2_error,
            "total_energy_abs_error": self.total_energy_abs_error,
            "residual_abs_error": self.residual_abs_error,
            "supplied_work_abs_error": self.supplied_work_abs_error,
        }


@dataclass(frozen=True, slots=True)
class ActionResult:
    status: Literal["executed", "cancelled", "uncertain_outcome", "error"]
    cycle: int
    action: PlannerAction
    tick_before: int
    tick_after: int
    energy_before: float
    energy_after: float
    supplied_work_delta: float
    environment_change_applied: bool
    known_executed_ticks: int
    unknown_outcome_ticks: int
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "cycle": self.cycle,
            "action": self.action.as_dict(),
            "tick_before": self.tick_before,
            "tick_after": self.tick_after,
            "energy_before": self.energy_before,
            "energy_after": self.energy_after,
            "supplied_work_delta": self.supplied_work_delta,
            "environment_change_applied": self.environment_change_applied,
            "known_executed_ticks": self.known_executed_ticks,
            "unknown_outcome_ticks": self.unknown_outcome_ticks,
            "error": self.error,
        }


@dataclass(frozen=True, slots=True)
class ErrorRecord:
    stage: str
    code: str
    message: str
    cycle: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "stage": self.stage,
            "code": self.code,
            "message": self.message,
            "cycle": self.cycle,
        }


@dataclass(frozen=True, slots=True)
class TerminalOutcome:
    status: Literal[
        "goal_reached",
        "budget_exhausted",
        "unreachable_fixture",
        "cancelled",
        "uncertain_outcome",
        "execution_error",
        "constraint_violation",
        "forecast_error",
    ]
    cycle: int
    reason: str
    alternatives_blocked: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "cycle": self.cycle,
            "reason": self.reason,
            "alternatives_blocked": self.alternatives_blocked,
        }


@dataclass(frozen=True, slots=True)
class CycleRecord:
    cycle: int
    observation: PublicObservation
    forecast: ForecastRecord
    action: PlannerAction
    result: ActionResult
    observation_after: PublicObservation
    forecast_residual: ForecastResidual
    error: ErrorRecord | None
    budget: BudgetSnapshot

    def as_dict(self) -> dict[str, Any]:
        return {
            "cycle": self.cycle,
            "observation": self.observation.as_dict(),
            "forecast": self.forecast.as_dict(),
            "action": self.action.as_dict(),
            "result": self.result.as_dict(),
            "observation_after": self.observation_after.as_dict(),
            "forecast_residual": self.forecast_residual.as_dict(),
            "error": self.error.as_dict() if self.error else None,
            "budget": self.budget.as_dict(),
        }


@dataclass(frozen=True, slots=True)
class PlanningRun:
    fixture_id: str
    strategy: str
    goal: PlanningGoal
    initial_observation: PublicObservation
    final_observation: PublicObservation
    cycles: tuple[CycleRecord, ...]
    errors: tuple[ErrorRecord, ...]
    terminal: TerminalOutcome
    budget: BudgetSnapshot
    restart_mode: Literal["new_seeded_run"] = "new_seeded_run"
    neural_world_model_used: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "cycles", tuple(self.cycles))
        object.__setattr__(self, "errors", tuple(self.errors))
        if self.restart_mode != "new_seeded_run":
            raise PlannerError("planner runs must restart from a new seeded world")

    @property
    def success(self) -> bool:
        return self.terminal.status == "goal_reached"

    def as_dict(self) -> dict[str, Any]:
        return {
            "fixture_id": self.fixture_id,
            "strategy": self.strategy,
            "goal": goal_as_dict(self.goal),
            "initial_observation": self.initial_observation.as_dict(),
            "final_observation": self.final_observation.as_dict(),
            "cycles": [cycle.as_dict() for cycle in self.cycles],
            "errors": [error.as_dict() for error in self.errors],
            "terminal": self.terminal.as_dict(),
            "budget": self.budget.as_dict(),
            "restart_mode": self.restart_mode,
            "success": self.success,
            "neural_world_model_used": self.neural_world_model_used,
        }


def goal_as_dict(goal: PlanningGoal) -> dict[str, Any]:
    return {
        "goal_id": goal.goal_id,
        "target_port": goal.target_port,
        "neighbor_ports": list(goal.neighbor_ports),
        "min_target_oscillator_energy": goal.min_target_oscillator_energy,
        "max_neighbor_oscillator_energy": goal.max_neighbor_oscillator_energy,
        "min_node_separation_delta": goal.min_node_separation_delta,
        "max_time": goal.max_time,
        "max_work": goal.max_work,
        "max_cycles": goal.max_cycles,
    }


@dataclass(frozen=True, slots=True)
class FixtureSpec:
    fixture_id: str
    seed: int
    goal: PlanningGoal
    warmup_ticks: int = 1

    def __post_init__(self) -> None:
        if not self.fixture_id:
            raise PlannerError("fixture_id must be non-empty")
        if type(self.seed) is not int or self.seed < 0:
            raise PlannerError("fixture seed must be a non-negative integer")
        if type(self.warmup_ticks) is not int or not 0 <= self.warmup_ticks <= 3:
            raise PlannerError("warmup_ticks must be in [0, 3]")


@dataclass(frozen=True, slots=True)
class FixtureVerification:
    status: Literal["reachable", "unreachable"]
    candidate_sequences: int
    maximum_cycles_checked: int
    witness: tuple[PlannerAction, ...]
    reason: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "witness", tuple(self.witness))
        if any(not isinstance(action, PlannerAction) for action in self.witness):
            raise PlannerError("fixture witness must contain planner actions")

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "candidate_sequences": self.candidate_sequences,
            "maximum_cycles_checked": self.maximum_cycles_checked,
            "witness": [action.as_dict() for action in self.witness],
            "reason": self.reason,
        }


@dataclass(frozen=True, slots=True)
class FrozenFixture:
    spec: FixtureSpec
    initial_observation: PublicObservation
    verification: FixtureVerification

    @property
    def reachable(self) -> bool:
        return self.verification.status == "reachable"

    def as_dict(self) -> dict[str, Any]:
        return {
            "fixture_id": self.spec.fixture_id,
            "seed": self.spec.seed,
            "warmup_ticks": self.spec.warmup_ticks,
            "goal": goal_as_dict(self.spec.goal),
            "initial_observation": self.initial_observation.as_dict(),
            "verification": self.verification.as_dict(),
        }


@dataclass(frozen=True, slots=True)
class EnvironmentChange:
    """A deterministic external world change used only by the control case."""

    cycle: int
    external_drive: tuple[float, ...]
    description: str

    def __post_init__(self) -> None:
        if type(self.cycle) is not int or self.cycle < 0:
            raise PlannerError("environment change cycle must be non-negative")
        object.__setattr__(
            self,
            "external_drive",
            _finite_tuple(self.external_drive, name="environment external_drive", length=NODE_COUNT),
        )
        if not self.description:
            raise PlannerError("environment change description must be non-empty")

    def as_dict(self) -> dict[str, Any]:
        return {
            "cycle": self.cycle,
            "external_drive": list(self.external_drive),
            "description": self.description,
        }


@dataclass(frozen=True, slots=True)
class KnownSimulatorPredictor:
    """Public-state predictor using fixed nominal simulator parameters.

    The actual fixture calibration and target remain hidden.  This predictor
    does not infer them from private state; its nominal mismatch is explicit
    in the serialized identity and must not be read as a safety guarantee.
    """

    predictor_schema: str = PREDICTOR_SCHEMA
    trained: bool = False
    neural_world_model: bool = False
    geometry_status: str = "neural_geometry_not_used"

    def _world_from_public_observation(self, observation: PublicObservation) -> ResonantWorld:
        world = ResonantWorld(seed=0, target=0, calibration=NOMINAL_CALIBRATION)
        world.q = world.base_q + np.asarray(observation.node_displacements, dtype=np.float64)
        world.v = np.asarray(observation.node_velocities, dtype=np.float64)
        world.u = np.asarray(observation.oscillator_amplitudes, dtype=np.float64)
        world.du = np.asarray(observation.oscillator_velocities, dtype=np.float64)
        world.omega = np.asarray(NOMINAL_OMEGA, dtype=np.float64)
        world.tick = observation.tick
        world.work = 0.0
        world.supplied_work = observation.supplied_work
        world.dissipated = 0.0
        world.initial_energy = world.energy()
        world.events = []
        return world

    def predict(self, observation: PublicObservation, actions: Sequence[PlannerAction]) -> PublicObservation:
        if len(actions) > FULL_EPISODE_OPEN_LOOP_HORIZON:
            raise PlannerError("predictor horizon exceeds the bounded horizon")
        world = self._world_from_public_observation(observation)
        for action in actions:
            if not isinstance(action, PlannerAction):
                raise PlannerError("predictor received an invalid action")
            for _ in range(action.duration_ticks):
                world.step(
                    np.asarray(action.drive_vector, dtype=np.float64),
                    include_cue=False,
                    include_distractors=False,
                )
        return PublicObservation.from_world(world, fixture_id=observation.fixture_id, cycle=observation.cycle + len(actions))

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": self.predictor_schema,
            "model_type": "known_mechanical_oscillator_simulator",
            "trained": self.trained,
            "neural_world_model": self.neural_world_model,
            "geometry_status": self.geometry_status,
            "uses_public_observation_whitelist": True,
            "parameterization": "nominal_not_calibrated",
            "parameter_source": "fixed_nominal_values_not_inferred_from_private_world_state",
            "nominal_calibration": dict(NOMINAL_CALIBRATION),
            "nominal_omega": list(NOMINAL_OMEGA),
            "actual_world_calibration_read": False,
            "actual_world_target_read": False,
            "mismatch_expected": True,
            "physical_safety_guarantee": False,
        }


def _world_for_fixture(fixture: FixtureSpec) -> ResonantWorld:
    world = ResonantWorld(seed=fixture.seed)
    for _ in range(fixture.warmup_ticks):
        world.step(np.zeros(NODE_COUNT), include_cue=False, include_distractors=False)
    return world


def _public_observation(world: ResonantWorld, fixture_id: str, cycle: int) -> PublicObservation:
    return PublicObservation.from_world(world, fixture_id=fixture_id, cycle=cycle)


def _run_actions_publicly(world: ResonantWorld, actions: Sequence[PlannerAction]) -> PublicObservation:
    for action in actions:
        for _ in range(action.duration_ticks):
            world.step(np.asarray(action.drive_vector), include_cue=False, include_distractors=False)
    return _public_observation(world, "fixture-verification", len(actions))


def verify_fixture_reachability(spec: FixtureSpec) -> FrozenFixture:
    """Verify and freeze reachability using public observations only."""

    initial_world = _world_for_fixture(spec)
    initial = _public_observation(initial_world, spec.fixture_id, 0)
    actions = candidate_actions()
    checked = 0
    for cycle_count in range(1, spec.goal.max_cycles + 1):
        for sequence in itertools.product(actions, repeat=cycle_count):
            checked += 1
            world = _world_for_fixture(spec)
            observation = _run_actions_publicly(world, sequence)
            if spec.goal.assess(observation).reached:
                return FrozenFixture(
                    spec=spec,
                    initial_observation=initial,
                    verification=FixtureVerification(
                        status="reachable",
                        candidate_sequences=checked,
                        maximum_cycles_checked=cycle_count,
                        witness=tuple(sequence),
                        reason="public observation verifier found a bounded witness",
                    ),
                )
    return FrozenFixture(
        spec=spec,
        initial_observation=initial,
        verification=FixtureVerification(
            status="unreachable",
            candidate_sequences=checked,
            maximum_cycles_checked=spec.goal.max_cycles,
            witness=(),
            reason="no candidate sequence satisfied the goal within the bounded verification horizon",
        ),
    )


def freeze_fixtures(specs: Sequence[FixtureSpec]) -> tuple[FrozenFixture, ...]:
    """Freeze fixture observations and reachability before any comparison run."""

    if not specs:
        raise PlannerError("at least one fixture is required")
    frozen = tuple(verify_fixture_reachability(spec) for spec in specs)
    if len({fixture.spec.fixture_id for fixture in frozen}) != len(frozen):
        raise PlannerError("fixture IDs must be unique")
    return frozen


class BoundedPlanner:
    """Select a bounded action sequence from public observations."""

    def __init__(self, predictor: KnownSimulatorPredictor | None = None, budget: _BudgetState | None = None):
        self.predictor = predictor or KnownSimulatorPredictor()
        self.budget = budget or _BudgetState()

    def coast_forecast(self, observation: PublicObservation, goal: PlanningGoal, cycle: int) -> ForecastRecord:
        """Charge the one-action coast diagnostic in the virtual budget."""

        action = candidate_actions()[0]
        self.budget.reserve_virtual(1, ACTION_DURATION_TICKS)
        predicted = self.predictor.predict(observation, (action,))
        assessment = goal.assess(predicted)
        return ForecastRecord(
            predictor_schema=self.predictor.predictor_schema,
            plan_cycle=cycle,
            horizon=1,
            candidate_count=1,
            virtual_physics_steps=ACTION_DURATION_TICKS,
            actions=(action,),
            predicted_observations=(predicted,),
            predicted_assessments=(assessment,),
            selected_index=0,
            score=assessment.score(goal),
            planning_horizon=1,
            feasible_candidate_count=int(assessment.hard_constraints_ok),
            rejected_candidate_count=int(not assessment.hard_constraints_ok),
            rejection_counts=tuple((name, 1) for name in assessment.hard_constraint_failures),
        )

    def plan(self, observation: PublicObservation, goal: PlanningGoal, *, horizon: int, cycle: int) -> ForecastRecord:
        if type(horizon) is not int or not 1 <= horizon <= FULL_EPISODE_OPEN_LOOP_HORIZON:
            raise PlannerError("planning horizon is outside the bounded range")
        actions = candidate_actions()
        sequences = tuple(itertools.product(actions, repeat=horizon))
        candidate_count = len(sequences)
        virtual_steps = candidate_count * horizon * ACTION_DURATION_TICKS
        self.budget.reserve_virtual(candidate_count, virtual_steps)
        best: tuple[float, int, tuple[PlannerAction, ...], tuple[PublicObservation, ...], tuple[GoalAssessment, ...]] | None = None
        rejection_counts: dict[str, int] = {}
        feasible_candidate_count = 0
        for sequence_index, sequence in enumerate(sequences):
            current = observation
            predicted: list[PublicObservation] = []
            assessments: list[GoalAssessment] = []
            valid = True
            for action in sequence:
                current = self.predictor.predict(current, (action,))
                predicted.append(current)
                assessment = goal.assess(current)
                assessments.append(assessment)
                if not assessment.hard_constraints_ok:
                    for failure in assessment.hard_constraint_failures:
                        rejection_counts[failure] = rejection_counts.get(failure, 0) + 1
                    valid = False
                    break
            if not valid:
                continue
            feasible_candidate_count += 1
            final_assessment = assessments[-1]
            # Stable enumeration order is the explicit tie-break: coast, then
            # positive/negative port 0, then positive/negative port 1.
            score = final_assessment.score(goal)
            if best is None or (score, sequence_index) < (best[0], best[1]):
                best = (score, sequence_index, sequence, tuple(predicted), tuple(assessments))
        if best is None:
            reasons = ", ".join(f"{name}={count}" for name, count in sorted(rejection_counts.items()))
            raise PlannerError(f"no hard-constraint-feasible candidate forecast ({reasons or 'unknown rejection'})")
        score, selected_index, sequence, predicted, assessments = best
        return ForecastRecord(
            predictor_schema=self.predictor.predictor_schema,
            plan_cycle=cycle,
            horizon=horizon,
            candidate_count=candidate_count,
            virtual_physics_steps=virtual_steps,
            actions=tuple(sequence),
            predicted_observations=predicted,
            predicted_assessments=assessments,
            selected_index=selected_index,
            score=score,
            planning_horizon=horizon,
            feasible_candidate_count=feasible_candidate_count,
            rejected_candidate_count=candidate_count - feasible_candidate_count,
            rejection_counts=tuple(sorted(rejection_counts.items())),
        )


def _action_from_forecast(forecast: ForecastRecord, *, sequence_index: int = 0) -> PlannerAction:
    if sequence_index < 0 or sequence_index >= len(forecast.actions):
        return candidate_actions()[0]
    return forecast.actions[sequence_index]


def _truncate_reused_forecast(
    forecast: ForecastRecord,
    *,
    consumed_actions: int,
    remaining_horizon: int,
) -> ForecastRecord:
    """Expose only the remaining open-loop actions at each actual cycle."""

    if not 1 <= remaining_horizon <= len(forecast.actions) - consumed_actions:
        raise PlannerError("reused forecast cannot be truncated to the remaining horizon")
    start = consumed_actions
    stop = start + remaining_horizon
    return replace(
        forecast,
        horizon=remaining_horizon,
        actions=forecast.actions[start:stop],
        predicted_observations=forecast.predicted_observations[start:stop],
        predicted_assessments=forecast.predicted_assessments[start:stop],
        candidate_count=0,
        feasible_candidate_count=0,
        rejected_candidate_count=0,
        rejection_counts=(),
        virtual_physics_steps=0,
        selected_index=0,
        reused=True,
    )


def _execute_action(
    world: ResonantWorld,
    action: PlannerAction,
    *,
    fixture_id: str,
    cycle: int,
    environment_change: EnvironmentChange | None = None,
    cancel_before: bool = False,
    cancel_after_ticks: int | None = None,
    uncertain_after_ticks: int | None = None,
) -> ActionResult:
    """Execute exactly one action; partial effects become terminal uncertainty."""

    tick_before = int(world.tick)
    energy_before = float(world.energy())
    work_before = float(world.supplied_work)
    if cancel_before:
        return ActionResult(
            status="cancelled",
            cycle=cycle,
            action=action,
            tick_before=tick_before,
            tick_after=tick_before,
            energy_before=energy_before,
            energy_after=energy_before,
            supplied_work_delta=0.0,
            environment_change_applied=False,
            known_executed_ticks=0,
            unknown_outcome_ticks=0,
            error="cancelled before action dispatch",
        )
    if cancel_after_ticks is not None and (type(cancel_after_ticks) is not int or cancel_after_ticks < 1):
        raise PlannerError("cancel_after_ticks must be a positive integer")
    if uncertain_after_ticks is not None and (type(uncertain_after_ticks) is not int or uncertain_after_ticks < 1):
        raise PlannerError("uncertain_after_ticks must be a positive integer")
    environment_applied = False
    ticks_done = 0
    try:
        for _ in range(action.duration_ticks):
            external = np.zeros(NODE_COUNT, dtype=np.float64)
            if environment_change is not None and environment_change.cycle == cycle:
                external = np.asarray(environment_change.external_drive, dtype=np.float64)
                environment_applied = True
            world.step(
                np.asarray(action.drive_vector, dtype=np.float64),
                external=external,
                include_cue=False,
                include_distractors=False,
            )
            ticks_done += 1
            if uncertain_after_ticks is not None and ticks_done >= uncertain_after_ticks:
                return ActionResult(
                    status="uncertain_outcome",
                    cycle=cycle,
                    action=action,
                    tick_before=tick_before,
                    tick_after=int(world.tick),
                    energy_before=energy_before,
                    energy_after=float(world.energy()),
                    supplied_work_delta=float(world.supplied_work - work_before),
                    environment_change_applied=environment_applied,
                    known_executed_ticks=ticks_done,
                    unknown_outcome_ticks=action.duration_ticks - ticks_done,
                    error="effect became uncertain after partial dispatch",
                )
            if cancel_after_ticks is not None and ticks_done >= cancel_after_ticks:
                return ActionResult(
                    status="uncertain_outcome",
                    cycle=cycle,
                    action=action,
                    tick_before=tick_before,
                    tick_after=int(world.tick),
                    energy_before=energy_before,
                    energy_after=float(world.energy()),
                    supplied_work_delta=float(world.supplied_work - work_before),
                    environment_change_applied=environment_applied,
                    known_executed_ticks=ticks_done,
                    unknown_outcome_ticks=action.duration_ticks - ticks_done,
                    error="cancellation arrived after dispatch began",
                )
    except Exception as exc:  # pragma: no cover - exercised through a test hook
        return ActionResult(
            status="error",
            cycle=cycle,
            action=action,
            tick_before=tick_before,
            tick_after=int(world.tick),
            energy_before=energy_before,
            energy_after=float(world.energy()),
            supplied_work_delta=float(world.supplied_work - work_before),
            environment_change_applied=environment_applied,
            known_executed_ticks=ticks_done,
            unknown_outcome_ticks=action.duration_ticks - ticks_done,
            error=str(exc),
        )
    return ActionResult(
        status="executed",
        cycle=cycle,
        action=action,
        tick_before=tick_before,
        tick_after=int(world.tick),
        energy_before=energy_before,
        energy_after=float(world.energy()),
        supplied_work_delta=float(world.supplied_work - work_before),
        environment_change_applied=environment_applied,
        known_executed_ticks=action.duration_ticks,
        unknown_outcome_ticks=0,
    )


def _precheck_action_budget(
    observation: PublicObservation,
    action: PlannerAction,
    goal: PlanningGoal,
) -> str | None:
    """Reject a pulse before dispatch when a deterministic bound is known."""

    projected_time = observation.time + action.duration_ticks * ResonantWorld.DT
    if projected_time > goal.max_time + 1.0e-12:
        return "deterministic elapsed-time budget would be exceeded before dispatch"
    # Supplied work is monotone.  A safe upper bound for an arbitrary external
    # disturbance is not available from the public observation, so only an
    # already-exhausted work budget is prechecked; realized work is checked
    # immediately after dispatch.
    if observation.supplied_work > goal.max_work + 1.0e-12:
        return "supplied-work budget was already exhausted before dispatch"
    return None


def _forecast_residual(
    forecast: ForecastRecord,
    realized: PublicObservation,
    result: ActionResult,
    *,
    prediction_source: Literal["fresh_forecast", "reused_forecast", "coast_diagnostic"],
) -> ForecastResidual:
    predicted = forecast.predicted_observations[0]
    status: Literal["compared", "cancelled_before_dispatch", "uncertain_outcome", "execution_error"]
    if result.status == "cancelled":
        status = "cancelled_before_dispatch"
    elif result.status == "uncertain_outcome":
        status = "uncertain_outcome"
    elif result.status == "error":
        status = "execution_error"
    else:
        status = "compared"
    displacement_error = float(
        np.linalg.norm(
            np.asarray(predicted.node_displacements, dtype=np.float64)
            - np.asarray(realized.node_displacements, dtype=np.float64)
        )
    )
    return ForecastResidual(
        comparison_status=status,
        prediction_source=prediction_source,
        predicted_tick=predicted.tick,
        actual_tick=realized.tick,
        predicted_time=predicted.time,
        actual_time=realized.time,
        node_displacement_l2_error=displacement_error,
        total_energy_abs_error=abs(predicted.total_energy - realized.total_energy),
        residual_abs_error=abs(predicted.residual - realized.residual),
        supplied_work_abs_error=abs(predicted.supplied_work - realized.supplied_work),
    )


STRATEGIES = ("coast", "greedy", "open_loop_full_episode", "receding_horizon")
STRATEGY_ALIASES = {"open_loop": "open_loop_full_episode"}
STRATEGY_LABELS = {
    "coast": "coast",
    "greedy": "one-step greedy",
    "open_loop_full_episode": "fair bounded full-episode open-loop baseline",
    "receding_horizon": "two-step receding horizon",
}


def _normalize_strategy(strategy: str) -> str:
    normalized = STRATEGY_ALIASES.get(strategy, strategy)
    if normalized not in STRATEGIES:
        raise PlannerError(f"unsupported strategy: {strategy}")
    return normalized


def run_strategy(
    fixture: FrozenFixture,
    strategy: Literal["coast", "greedy", "open_loop", "open_loop_full_episode", "receding_horizon"],
    *,
    environment_change: EnvironmentChange | None = None,
    cancel_before_cycle: int | None = None,
    cancel_after_ticks: int | None = None,
    uncertain_after_ticks: int | None = None,
) -> PlanningRun:
    """Run a bounded plan-act-observe loop from a new seeded world.

    A run never resumes a previous world.  The open-loop baseline plans the
    full remaining episode once and then exposes only the remaining suffix at
    each cycle, so it does not silently coast after a two-action plan.
    """

    if not fixture.reachable:
        raise PlannerError("unreachable fixtures are reported separately, not executed")
    normalized_strategy = _normalize_strategy(strategy)
    virtual_candidate_limit, virtual_physics_step_limit = VIRTUAL_BUDGETS[normalized_strategy]
    world = _world_for_fixture(fixture.spec)
    initial_observation = _public_observation(world, fixture.spec.fixture_id, 0)
    observation = initial_observation
    budget = _BudgetState(
        virtual_budget_kind=normalized_strategy,
        virtual_candidate_limit=virtual_candidate_limit,
        virtual_physics_step_limit=virtual_physics_step_limit,
    )
    planner = BoundedPlanner(budget=budget)
    cycles: list[CycleRecord] = []
    errors: list[ErrorRecord] = []
    open_loop_forecast: ForecastRecord | None = None
    terminal: TerminalOutcome | None = None

    for cycle in range(fixture.spec.goal.max_cycles):
        remaining_cycles = fixture.spec.goal.max_cycles - cycle
        if normalized_strategy == "coast":
            forecast = planner.coast_forecast(observation, fixture.spec.goal, cycle)
            prediction_source: Literal["fresh_forecast", "reused_forecast", "coast_diagnostic"] = "coast_diagnostic"
        elif normalized_strategy == "greedy":
            try:
                forecast = planner.plan(observation, fixture.spec.goal, horizon=1, cycle=cycle)
            except Exception as exc:
                error = ErrorRecord("forecast", "forecast_error", str(exc), cycle)
                errors.append(error)
                terminal = TerminalOutcome("forecast_error", cycle, str(exc), True)
                break
            prediction_source = "fresh_forecast"
        elif normalized_strategy == "open_loop_full_episode":
            if open_loop_forecast is None:
                try:
                    open_loop_forecast = planner.plan(
                        observation,
                        fixture.spec.goal,
                        horizon=remaining_cycles,
                        cycle=cycle,
                    )
                except Exception as exc:
                    error = ErrorRecord("forecast", "forecast_error", str(exc), cycle)
                    errors.append(error)
                    terminal = TerminalOutcome("forecast_error", cycle, str(exc), True)
                    break
                forecast = open_loop_forecast
            else:
                forecast = _truncate_reused_forecast(
                    open_loop_forecast,
                    consumed_actions=cycle,
                    remaining_horizon=remaining_cycles,
                )
            prediction_source = "fresh_forecast" if cycle == 0 else "reused_forecast"
        else:
            try:
                # The final cycle has one action remaining, so its forecast is
                # explicitly one-step rather than an overlong two-step plan.
                horizon = min(MAX_ACTION_HORIZON, remaining_cycles)
                forecast = planner.plan(observation, fixture.spec.goal, horizon=horizon, cycle=cycle)
            except Exception as exc:
                error = ErrorRecord("forecast", "forecast_error", str(exc), cycle)
                errors.append(error)
                terminal = TerminalOutcome("forecast_error", cycle, str(exc), True)
                break
            prediction_source = "fresh_forecast"

        action = _action_from_forecast(forecast)
        precheck_reason = _precheck_action_budget(observation, action, fixture.spec.goal)
        if precheck_reason is not None:
            error = ErrorRecord("precheck", "budget_exhausted", precheck_reason, cycle)
            errors.append(error)
            terminal = TerminalOutcome("budget_exhausted", cycle, precheck_reason, True)
            break
        cancel_before = cancel_before_cycle is not None and cycle == cancel_before_cycle
        try:
            budget.reserve_actual()
        except PlannerBudgetError as exc:
            terminal = TerminalOutcome("budget_exhausted", cycle, str(exc), True)
            break
        result = _execute_action(
            world,
            action,
            fixture_id=fixture.spec.fixture_id,
            cycle=cycle,
            environment_change=environment_change,
            cancel_before=cancel_before,
            cancel_after_ticks=cancel_after_ticks,
            uncertain_after_ticks=uncertain_after_ticks,
        )
        after = _public_observation(world, fixture.spec.fixture_id, cycle + 1)
        budget.record_action_result(result)
        residual = _forecast_residual(
            forecast,
            after,
            result,
            prediction_source=prediction_source,
        )
        error_record = None
        if result.error:
            error_record = ErrorRecord("execute", result.status, result.error, cycle)
            errors.append(error_record)
        budget_snapshot = budget.snapshot(after.supplied_work)
        cycles.append(
            CycleRecord(
                cycle,
                observation,
                forecast,
                action,
                result,
                after,
                residual,
                error_record,
                budget_snapshot,
            )
        )
        if result.status != "executed":
            terminal_status: Literal["cancelled", "uncertain_outcome", "execution_error"]
            terminal_status = "execution_error" if result.status == "error" else result.status
            terminal = TerminalOutcome(terminal_status, cycle, result.error or result.status, True)
            observation = after
            break
        assessment = fixture.spec.goal.assess(after)
        observation = after
        if not assessment.neighbor_energy_ok:
            terminal = TerminalOutcome(
                "constraint_violation",
                cycle,
                "actual neighbor energy exceeded the hard constraint after dispatch",
                True,
            )
            break
        if not assessment.time_ok or not assessment.work_ok:
            terminal = TerminalOutcome("budget_exhausted", cycle, "time or supplied-work budget exhausted", True)
            break
        if assessment.reached:
            terminal = TerminalOutcome("goal_reached", cycle, "all goal constraints satisfied", False)
            break

    if terminal is None:
        terminal = TerminalOutcome("budget_exhausted", len(cycles), "actual cycle budget exhausted", True)
    return PlanningRun(
        fixture_id=fixture.spec.fixture_id,
        strategy=normalized_strategy,
        goal=fixture.spec.goal,
        initial_observation=initial_observation,
        final_observation=observation,
        cycles=tuple(cycles),
        errors=tuple(errors),
        terminal=terminal,
        budget=budget.snapshot(observation.supplied_work),
        restart_mode="new_seeded_run",
    )


def _goal(goal_id: str, target_port: int, *, min_target_energy: float = 7.5e-4) -> PlanningGoal:
    return PlanningGoal(
        goal_id=goal_id,
        target_port=target_port,
        min_target_oscillator_energy=min_target_energy,
        max_neighbor_oscillator_energy=2.0e-4,
        min_node_separation_delta=1.0e-8,
        # The frozen development fixtures intentionally include one public
        # warmup tick before the four-cycle actual budget.  Keep that tick in
        # the elapsed-time constraint rather than accidentally invalidating
        # every otherwise reachable witness.
        max_time=(MAX_ACTUAL_PHYSICS_STEPS + 1) * ResonantWorld.DT,
        max_work=1.2e-3,
    )


def default_fixture_specs() -> tuple[FixtureSpec, ...]:
    """Return the deterministic development fixtures before reachability freeze."""

    return (
        FixtureSpec("planner-reachable-seed-0-port-0", 0, _goal("goal-port-0", 0)),
        FixtureSpec("planner-reachable-seed-1-port-1", 1, _goal("goal-port-1", 1)),
        FixtureSpec("planner-reachable-seed-2-port-0", 2, _goal("goal-port-0-seed-2", 0)),
        FixtureSpec("planner-unreachable-high-energy", 3, _goal("unreachable-energy", 0, min_target_energy=2.0)),
    )


def compare_frozen_fixtures(frozen: Sequence[FrozenFixture]) -> dict[str, dict[str, PlanningRun]]:
    """Compare all four strategies only after fixtures have been frozen."""

    comparisons: dict[str, dict[str, PlanningRun]] = {}
    for fixture in frozen:
        if not fixture.reachable:
            continue
        comparisons[fixture.spec.fixture_id] = {
            strategy: run_strategy(fixture, strategy) for strategy in STRATEGIES
        }
    return comparisons


def run_changed_world_case(fixture: FrozenFixture) -> tuple[EnvironmentChange, dict[str, PlanningRun]]:
    """Run the controlled perturbation against each strategy on one frozen fixture."""

    change = EnvironmentChange(
        cycle=1,
        external_drive=(0.0, 0.0, 0.10, 0.0),
        description="controlled positive neighbor-node disturbance at cycle 1",
    )
    return change, {strategy: run_strategy(fixture, strategy, environment_change=change) for strategy in STRATEGIES}


def _run_summary(run: PlanningRun) -> dict[str, Any]:
    return {
        "success": run.success,
        "terminal": run.terminal.as_dict(),
        "cycles": len(run.cycles),
        "actions": [cycle.action.name for cycle in run.cycles],
        "horizons": [cycle.forecast.horizon for cycle in run.cycles],
        "forecast_residual_statuses": [cycle.forecast_residual.comparison_status for cycle in run.cycles],
        "environment_changes": [
            cycle.cycle for cycle in run.cycles if cycle.result.environment_change_applied
        ],
        "virtual_candidates": run.budget.virtual_candidates,
        "virtual_physics_steps": run.budget.virtual_physics_steps,
    }


def run_experiment() -> dict[str, Any]:
    """Build deterministic evidence for the corrected bounded comparison."""

    predictor = KnownSimulatorPredictor()
    frozen = freeze_fixtures(default_fixture_specs())
    comparisons = compare_frozen_fixtures(frozen)
    reachable = [fixture for fixture in frozen if fixture.reachable]
    unreachable = [fixture for fixture in frozen if not fixture.reachable]
    changed_fixture = reachable[0]
    change, changed_runs = run_changed_world_case(changed_fixture)
    receding_changed = changed_runs["receding_horizon"]
    change_first_observable_cycle = change.cycle + 1
    return {
        "schema": PLANNER_SCHEMA,
        "comparison_variant": "corrected_bounded_comparison",
        "original_results_retained": {
            "json": "artifacts/v03-simulator-planner-results-original.json",
            "markdown": "artifacts/v03-simulator-planner-results-original.md",
        },
        "predictor": predictor.as_dict(),
        "observation_whitelist": list(PUBLIC_OBSERVATION_FIELDS),
        "action_space": [action.as_dict() for action in candidate_actions()],
        "bounds": {
            "validated_ports": list(VALIDATED_PORTS),
            "action_duration_ticks": ACTION_DURATION_TICKS,
            "drive_magnitude": ACTION_DRIVE_MAGNITUDE,
            "max_action_horizon": MAX_ACTION_HORIZON,
            "two_step_candidate_count": TWO_STEP_CANDIDATE_COUNT,
            "full_episode_open_loop_horizon": FULL_EPISODE_OPEN_LOOP_HORIZON,
            "full_episode_candidate_count": FULL_EPISODE_CANDIDATE_COUNT,
            "full_episode_virtual_physics_steps": FULL_EPISODE_VIRTUAL_PHYSICS_STEPS,
            "max_actual_cycles": MAX_ACTUAL_CYCLES,
            "max_actual_physics_steps": MAX_ACTUAL_PHYSICS_STEPS,
            "max_virtual_candidates": MAX_VIRTUAL_CANDIDATES,
            "max_virtual_physics_steps": MAX_VIRTUAL_PHYSICS_STEPS,
        },
        "strategy_definitions": {
            strategy: {
                "label": STRATEGY_LABELS[strategy],
                "virtual_budget_kind": strategy,
                "virtual_candidate_limit": VIRTUAL_BUDGETS[strategy][0],
                "virtual_physics_step_limit": VIRTUAL_BUDGETS[strategy][1],
            }
            for strategy in STRATEGIES
        },
        "fixtures_frozen_before_comparison": True,
        "fixtures": [fixture.as_dict() for fixture in frozen],
        "reachable_fixtures": [fixture.spec.fixture_id for fixture in reachable],
        "unreachable_fixtures": [fixture.spec.fixture_id for fixture in unreachable],
        "comparisons": {
            fixture_id: {strategy: run.as_dict() for strategy, run in runs.items()}
            for fixture_id, runs in comparisons.items()
        },
        "changed_world_case": {
            "fixture_id": changed_fixture.spec.fixture_id,
            "environment_change": change.as_dict(),
            "runs": {strategy: run.as_dict() for strategy, run in changed_runs.items()},
            "receding_horizon_replanned_after_change": [
                cycle.forecast.plan_cycle for cycle in receding_changed.cycles
            ],
            "change_execution_cycle": change.cycle,
            "change_first_observable_cycle": change_first_observable_cycle,
            "receding_horizon_plan_cycles_after_change_observable": [
                cycle.forecast.plan_cycle
                for cycle in receding_changed.cycles
                if cycle.forecast.plan_cycle >= change_first_observable_cycle
            ],
            "changed_world_observed_by_result": any(
                cycle.result.environment_change_applied for cycle in receding_changed.cycles
            ),
        },
        "claims": {
            "known_simulator_predictor": True,
            "trained_neural_world_model": False,
            "predictor_parameterization": "nominal_not_calibrated",
            "predictor_mismatch_expected": True,
            "physical_safety_guarantee": False,
            "neural_geometry_integration": "not_used",
            "geometry_ablation_run": False,
            "spatial_navigation_claim": False,
            "separation_threshold_interpretation": "1e-8 is a tiny development threshold, not meaningful navigation",
            "strategy_superiority_claim": False,
            "interpretation": "bounded development evidence only; strategy outcomes are reported without manufacturing superiority",
        },
    }


def render_markdown(result: dict[str, Any]) -> str:
    """Render a compact human-readable report without dropping structured evidence."""

    lines = [
        "# Bounded simulated-futures planner",
        "",
        "Corrected bounded comparison using a nominal mechanical/oscillator simulator predictor; not a trained neural world model.",
        "",
        f"- Comparison variant: `{result['comparison_variant']}`",
        f"- Original result retained: `{result['original_results_retained']['json']}` and `{result['original_results_retained']['markdown']}`",
        f"- Frozen before comparison: `{result['fixtures_frozen_before_comparison']}`",
        f"- Two-step candidates: `{result['bounds']['two_step_candidate_count']}`",
        f"- Full-episode open-loop candidates: `{result['bounds']['full_episode_candidate_count']}`",
        f"- Actual cycle limit: `{result['bounds']['max_actual_cycles']}`",
        f"- Virtual rollout candidate limit: `{result['bounds']['max_virtual_candidates']}`",
        f"- Predictor parameterization: `{result['claims']['predictor_parameterization']}`; mismatch expected: `{result['claims']['predictor_mismatch_expected']}`",
        f"- Neural geometry status: `{result['claims']['neural_geometry_integration']}`",
        "",
        "## Fixtures",
        "",
        "| Fixture | Reachability | Witness | Reason |",
        "|---|---|---|---|",
    ]
    for fixture in result["fixtures"]:
        verification = fixture["verification"]
        witness = ", ".join(item["name"] for item in verification["witness"]) or "—"
        lines.append(
            f"| `{fixture['fixture_id']}` | `{verification['status']}` | `{witness}` | {verification['reason']} |"
        )
    lines.extend(["", "## Strategy comparison on reachable fixtures", "", "| Fixture | Strategy | Success | Terminal | Horizons | Actions |", "|---|---|---:|---|---|---|"])
    for fixture_id, runs in result["comparisons"].items():
        for strategy, run in runs.items():
            summary = _run_summary_from_mapping(run)
            lines.append(
                f"| `{fixture_id}` | `{result['strategy_definitions'][strategy]['label']}` | `{summary['success']}` | `{summary['terminal']['status']}` | `{summary['horizons']}` | {', '.join(summary['actions']) or '—'} |"
            )
    changed = result["changed_world_case"]
    lines.extend(["", "## Controlled changed-world case", "", f"Fixture `{changed['fixture_id']}`: {changed['environment_change']['description']}.", "", "| Strategy | Success | Terminal | Horizons | Actions |", "|---|---:|---|---|---|"])
    for strategy, run in changed["runs"].items():
        summary = _run_summary_from_mapping(run)
        lines.append(
            f"| `{result['strategy_definitions'][strategy]['label']}` | `{summary['success']}` | `{summary['terminal']['status']}` | `{summary['horizons']}` | {', '.join(summary['actions']) or '—'} |"
        )
    lines.extend(
        [
            "",
            f"All receding-horizon plan cycles: `{changed['receding_horizon_replanned_after_change']}`; cycles after the cycle-1 change became observable: `{changed['receding_horizon_plan_cycles_after_change_observable']}` (first observable cycle `{changed['change_first_observable_cycle']}`).",
            "",
            "No physical-safety guarantee, meaningful spatial-navigation claim, neural/geometry benefit, or strategy-superiority claim is made. The full JSON preserves forecasts, forecast-versus-realized residuals, observations, results, errors, and budgets.",
            "",
        ]
    )
    return "\n".join(lines)


def _run_summary_from_mapping(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "success": run["success"],
        "terminal": run["terminal"],
        "actions": [cycle["action"]["name"] for cycle in run["cycles"]],
        "horizons": [cycle["forecast"]["horizon"] for cycle in run["cycles"]],
    }


def write_results(result: dict[str, Any], *, json_path: str | Path, markdown_path: str | Path) -> None:
    """Write deterministic JSON and Markdown evidence files."""

    json_target = Path(json_path)
    markdown_target = Path(markdown_path)
    json_target.parent.mkdir(parents=True, exist_ok=True)
    markdown_target.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(result, sort_keys=True, indent=2, allow_nan=False) + "\n"
    json_target.write_text(encoded, encoding="utf-8")
    markdown_target.write_text(render_markdown(result), encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the bounded known-simulator planner prototype.")
    parser.add_argument("--output-json", default="artifacts/v03-simulator-planner-results-corrected.json")
    parser.add_argument("--output-markdown", default="artifacts/v03-simulator-planner-results-corrected.md")
    args = parser.parse_args(argv)
    result = run_experiment()
    write_results(result, json_path=args.output_json, markdown_path=args.output_markdown)
    print(json.dumps({"json": str(args.output_json), "markdown": str(args.output_markdown), "schema": PLANNER_SCHEMA}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "ACTION_DRIVE_MAGNITUDE",
    "ACTION_DURATION_TICKS",
    "CANDIDATE_ACTION_COUNT",
    "FULL_EPISODE_CANDIDATE_COUNT",
    "FULL_EPISODE_OPEN_LOOP_HORIZON",
    "FULL_EPISODE_VIRTUAL_PHYSICS_STEPS",
    "MAX_GREEDY_VIRTUAL_CANDIDATES",
    "MAX_GREEDY_VIRTUAL_PHYSICS_STEPS",
    "ActionResult",
    "BudgetSnapshot",
    "BoundedPlanner",
    "EnvironmentChange",
    "ErrorRecord",
    "FixtureSpec",
    "FixtureVerification",
    "ForecastRecord",
    "ForecastResidual",
    "FrozenFixture",
    "GoalAssessment",
    "KnownSimulatorPredictor",
    "MAX_ACTION_HORIZON",
    "MAX_ACTUAL_CYCLES",
    "MAX_ACTUAL_PHYSICS_STEPS",
    "MAX_VIRTUAL_CANDIDATES",
    "MAX_VIRTUAL_PHYSICS_STEPS",
    "PREDICTOR_SCHEMA",
    "PLANNER_SCHEMA",
    "TWO_STEP_CANDIDATE_COUNT",
    "PUBLIC_OBSERVATION_FIELDS",
    "PublicObservation",
    "PlanningGoal",
    "PlanningRun",
    "PlannerAction",
    "PlannerBudgetError",
    "PlannerError",
    "STRATEGIES",
    "STRATEGY_LABELS",
    "TerminalOutcome",
    "candidate_actions",
    "compare_frozen_fixtures",
    "default_fixture_specs",
    "freeze_fixtures",
    "render_markdown",
    "run_changed_world_case",
    "run_experiment",
    "run_strategy",
    "verify_fixture_reachability",
    "write_results",
]
