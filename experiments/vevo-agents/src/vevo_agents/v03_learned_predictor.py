"""Versioned learned public-observable predictor pilot contract and runner.

This module is a reviewable experiment boundary and an opt-in training runner.
It uses the existing four-peripheral/one-center hybrid core as a recurrent
representation and adds a small, explicitly trainable observable head.  The
world model is deliberately restricted to the public observation whitelist:
no target, calibration, natural frequency, seed, fixture goal, or future
target enters an input vector.

The implementation has three purposes before training is authorized:

* freeze a deterministic world/trajectory split and its hashes;
* make physical-unit loss, bounded recursive rollout, checkpoint, and
  evaluation semantics executable and testable; and
* measure a small CPU forward/backward feasibility probe without updating a
  parameter or reading the reserved final-test outcomes.

The concrete runner is deliberately separate from the command-line artifact
writer.  It can execute the preregistered six-fit development pilot under one
shared deadline, but this module does not invoke it during artifact creation.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, replace
import hashlib
import json
import math
from pathlib import Path
import platform
import sys
import time
from typing import Any, Mapping, Sequence

import numpy as np

from .autograd import Tensor, concatenate, sigmoid, tanh
from .physics import ResonantWorld
from .v03_hybrid_core import DEFAULT_DT, POLICY_VECTOR_DIM, V03HybridCore
from .v03_simulator_planner import (
    ACTION_DURATION_TICKS as PLANNER_ACTION_DURATION_TICKS,
    NODE_COUNT,
    PUBLIC_OBSERVATION_FIELDS,
    VALIDATED_PORTS,
    KnownSimulatorPredictor,
    PlannerAction,
    PublicObservation,
    candidate_actions,
)


LEARNED_PREDICTOR_SCHEMA = "vevo.v03.learned-observable-predictor.v1"
DATASET_SCHEMA = "vevo.v03.learned-observable-dataset.v1"
SPLIT_MANIFEST_SCHEMA = "vevo.v03.learned-observable-split-manifest.v1"
NORMALIZER_SCHEMA = "vevo.v03.learned-observable-normalizer.v1"
CHECKPOINT_SCHEMA = "vevo.v03.learned-observable-checkpoint.v1"
EVALUATION_SCHEMA = "vevo.v03.learned-observable-evaluation.v1"
ARTIFACT_SCHEMA = "vevo.v03.learned-observable-pilot-artifacts.v1"
SELECTION_ARTIFACT_SCHEMA = "vevo.v03.learned-observable-selection.v1"
PILOT_RUN_SCHEMA = "vevo.v03.learned-observable-pilot-run.v1"

HEAD_SEED_SALT = 0x4C504844
ACTION_SEED_SALT = 0x4143544E
MANIFEST_HASH_EXCLUSION = "manifest_sha256"
HEAD_NORMALIZED_LIMIT = 3.0
ACTION_DRIVE_SCALE = 0.20
MAX_ACTION_DURATION_TICKS = PLANNER_ACTION_DURATION_TICKS
HISTORY_LENGTH = 2
TRAJECTORY_ACTION_COUNT = 12
ROLL_OUT_HORIZONS = (2, 4)
TRAIN_UPDATES = 100
BATCH_SIZE = 1
LEARNING_RATE = 1.0e-3
EVAL_EVERY_UPDATES = 100
MAX_WALL_CLOCK_SECONDS = 300
PAIRED_INITIALIZATION_SEEDS = (7, 17, 37)
CONSTRAINT_NEIGHBOR_THRESHOLD = 0.25
CONSTRAINT_SUPPLIED_WORK_THRESHOLD = 0.25

# These eight worlds are explicitly inspected development cases, not a fresh
# generalization set.  They are kept separate from the train and test seeds.
TRAIN_WORLD_SEEDS = tuple(range(100, 108))
DEVELOPMENT_WORLD_SEEDS = tuple(range(9300, 9308))
# These worlds were materialized by the pre-review manifest implementation.
# They are retained only as exposure history; they are not eligible for the
# reviewed final test.  The replacement test worlds below are whole new worlds
# and have not been used for tuning.
EXPOSED_TEST_WORLD_SEEDS = tuple(range(9400, 9408))
TEST_WORLD_SEEDS = tuple(range(9500, 9508))

PUBLIC_STATE_FIELDS = (
    "node_displacements",
    "node_velocities",
    "oscillator_amplitudes",
    "oscillator_velocities",
    "local_oscillator_energies",
    "neighbor_amplitude_means",
    "total_energy",
    "residual",
    "supplied_work",
    "time",
)
PUBLIC_STATE_UNITS = {
    "node_displacements": "world-length units",
    "node_velocities": "world-length per simulator-time unit",
    "oscillator_amplitudes": "oscillator-amplitude units",
    "oscillator_velocities": "oscillator-amplitude per simulator-time unit",
    "local_oscillator_energies": "simulator energy units",
    "neighbor_amplitude_means": "oscillator-amplitude units",
    "total_energy": "simulator energy units",
    "residual": "simulator energy units",
    "supplied_work": "simulator work units",
    "time": "simulator-time units",
}
PUBLIC_STATE_DIM = NODE_COUNT * 6 + 4
ACTION_FEATURE_DIM = NODE_COUNT + 1
REPRESENTATION_DIM = 12 + 5 * 2 * 2 + 5 * 4
CORE_INPUT_STATE_START = 0
CORE_INPUT_ACTION_START = PUBLIC_STATE_DIM
CORE_INPUT_DURATION_INDEX = PUBLIC_STATE_DIM + NODE_COUNT
CORE_INPUT_FEATURE_DIM = PUBLIC_STATE_DIM + ACTION_FEATURE_DIM

# The simulator's public ``observe`` method bounds the six per-node fields to
# [-10, 10].  Accounting values are not clipped by this module; these are
# declared safety bounds used only to fail visibly when a prediction leaves
# the physical contract.
PUBLIC_STATE_ABS_LIMITS = np.asarray(
    [
        *([10.0] * (NODE_COUNT * 6)),
        1_000.0,
        1_000.0,
        1_000.0,
        1_000.0,
    ],
    dtype=np.float64,
)
LOCAL_ENERGY_START = NODE_COUNT * 4
LOCAL_ENERGY_STOP = LOCAL_ENERGY_START + NODE_COUNT
TOTAL_ENERGY_INDEX = LOCAL_ENERGY_STOP + NODE_COUNT
RESIDUAL_INDEX = TOTAL_ENERGY_INDEX + 1
SUPPLIED_WORK_INDEX = TOTAL_ENERGY_INDEX + 2
TIME_INDEX = TOTAL_ENERGY_INDEX + 3
NONNEGATIVE_OUTPUT_INDICES = (
    *range(LOCAL_ENERGY_START, LOCAL_ENERGY_STOP),
    TOTAL_ENERGY_INDEX,
    SUPPLIED_WORK_INDEX,
    TIME_INDEX,
)

HIDDEN_INPUT_NAMES = (
    "target",
    "hidden_target",
    "calibration",
    "omega",
    "natural_frequency",
    "seed",
    "fixture_goal",
    "future_target",
)


class PredictorContractError(ValueError):
    """Base error for a malformed or unsafe predictor contract."""


class NormalizerContractError(PredictorContractError):
    """A normalizer was fitted from a forbidden split or is incompatible."""


class CheckpointContractError(PredictorContractError):
    """A learned predictor checkpoint is incompatible or incomplete."""


class EvaluationReservationError(PredictorContractError):
    """Reserved final-test outcomes were requested before development freeze."""


class RolloutBoundsError(PredictorContractError):
    """A recursive prediction left the declared physical observable bounds."""


class EvaluationDeadlineError(PredictorContractError):
    """A shared evaluation/training budget expired before the next stage."""


@dataclass(frozen=True, slots=True)
class SharedDeadline:
    """One monotonic deadline shared by training, evaluation, and serialization."""

    deadline_monotonic: float
    clock: Any = time.monotonic

    def __post_init__(self) -> None:
        if not math.isfinite(float(self.deadline_monotonic)):
            raise PredictorContractError("shared deadline must be finite")
        if not callable(self.clock):
            raise PredictorContractError("shared deadline clock must be callable")

    @classmethod
    def from_seconds(cls, seconds: float, *, clock: Any = time.monotonic) -> "SharedDeadline":
        if not math.isfinite(float(seconds)) or seconds <= 0.0:
            raise PredictorContractError("shared deadline seconds must be positive and finite")
        return cls(float(clock()) + float(seconds), clock=clock)

    def expired(self) -> bool:
        return float(self.clock()) >= float(self.deadline_monotonic)

    def check(self, stage: str) -> None:
        if not stage:
            raise PredictorContractError("deadline stage must be non-empty")
        if self.expired():
            raise EvaluationDeadlineError(f"shared deadline exhausted at {stage}")


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _sha256(value: Any) -> str:
    payload = value if isinstance(value, bytes) else _canonical_bytes(value)
    return hashlib.sha256(payload).hexdigest()


def _is_sha256(value: Any) -> bool:
    text = str(value)
    return len(text) == 64 and all(char in "0123456789abcdef" for char in text)


def _finite_array(value: Any, shape: tuple[int, ...], *, name: str) -> np.ndarray:
    result = np.asarray(value, dtype=np.float64)
    if result.shape != shape or not np.isfinite(result).all():
        raise PredictorContractError(f"{name} must be finite with shape {shape}")
    return result.copy()


def _validate_no_hidden_fields(value: Any) -> None:
    """Reject hidden-world keys in serialized public data recursively."""

    if isinstance(value, Mapping):
        lowered = {str(key).lower() for key in value}
        leaked = sorted(key for key in HIDDEN_INPUT_NAMES if key in lowered)
        if leaked:
            raise PredictorContractError(f"hidden world field leaked into public data: {leaked}")
        for nested in value.values():
            _validate_no_hidden_fields(nested)
    elif isinstance(value, (list, tuple)):
        for nested in value:
            _validate_no_hidden_fields(nested)


def public_observation_to_vector(observation: PublicObservation) -> np.ndarray:
    """Encode only public physical observables; metadata is not a feature."""

    if not isinstance(observation, PublicObservation):
        raise PredictorContractError("expected a PublicObservation")
    vector = np.asarray(
        [
            *observation.node_displacements,
            *observation.node_velocities,
            *observation.oscillator_amplitudes,
            *observation.oscillator_velocities,
            *observation.local_oscillator_energies,
            *observation.neighbor_amplitude_means,
            observation.total_energy,
            observation.residual,
            observation.supplied_work,
            observation.time,
        ],
        dtype=np.float64,
    )
    validate_public_state_vector(vector, name="public observation")
    return vector


def validate_public_state_vector(value: Any, *, name: str = "public state") -> np.ndarray:
    result = _finite_array(value, (PUBLIC_STATE_DIM,), name=name)
    if np.any(np.abs(result) > PUBLIC_STATE_ABS_LIMITS + 1.0e-12):
        raise RolloutBoundsError(f"{name} leaves the declared public observable bounds")
    if np.any(result[LOCAL_ENERGY_START:LOCAL_ENERGY_STOP] < -1.0e-12):
        raise RolloutBoundsError(f"{name} contains negative local oscillator energy")
    if result[TOTAL_ENERGY_INDEX] < -1.0e-12:
        raise RolloutBoundsError(f"{name} contains negative total energy")
    if result[SUPPLIED_WORK_INDEX] < -1.0e-12:
        raise RolloutBoundsError(f"{name} contains negative supplied work")
    if result[TIME_INDEX] < -1.0e-12:
        raise RolloutBoundsError(f"{name} contains negative simulator time")
    return result.copy()


def public_vector_to_observation(
    vector: Sequence[float] | np.ndarray,
    *,
    prior: PublicObservation,
    duration_ticks: int = PLANNER_ACTION_DURATION_TICKS,
) -> PublicObservation:
    """Reconstruct a public observation for recursive input only.

    No hidden world is created and energy is never recomputed from a hidden
    frequency.  The public energy/work fields are copied from the vector.
    """

    state = validate_public_state_vector(vector, name="predicted public state")
    if type(duration_ticks) is not int or duration_ticks <= 0:
        raise PredictorContractError("duration_ticks must be a positive integer")
    return PublicObservation(
        fixture_id=prior.fixture_id,
        cycle=prior.cycle + 1,
        tick=prior.tick + duration_ticks,
        time=float(state[TIME_INDEX]),
        node_displacements=tuple(state[0:NODE_COUNT]),
        node_velocities=tuple(state[NODE_COUNT : 2 * NODE_COUNT]),
        oscillator_amplitudes=tuple(state[2 * NODE_COUNT : 3 * NODE_COUNT]),
        oscillator_velocities=tuple(state[3 * NODE_COUNT : 4 * NODE_COUNT]),
        local_oscillator_energies=tuple(state[LOCAL_ENERGY_START:LOCAL_ENERGY_STOP]),
        neighbor_amplitude_means=tuple(state[LOCAL_ENERGY_STOP : LOCAL_ENERGY_STOP + NODE_COUNT]),
        total_energy=float(state[TOTAL_ENERGY_INDEX]),
        residual=float(state[RESIDUAL_INDEX]),
        supplied_work=float(state[SUPPLIED_WORK_INDEX]),
    )


@dataclass(frozen=True, slots=True)
class WorldCondition:
    """A public split condition; calibration is never exposed as a feature."""

    name: str
    frequency_scale: float = 1.0
    phase_offset: float = 0.0

    def __post_init__(self) -> None:
        if not self.name:
            raise PredictorContractError("world condition name must be non-empty")
        if not math.isfinite(self.frequency_scale) or self.frequency_scale <= 0.0:
            raise PredictorContractError("world condition frequency scale is invalid")
        if not math.isfinite(self.phase_offset):
            raise PredictorContractError("world condition phase offset is invalid")

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "frequency_scale": self.frequency_scale,
            "phase_offset": self.phase_offset,
            "feature_visible": False,
        }


WORLD_CONDITIONS = {
    "base": WorldCondition("base"),
    "initial_phase_shifted": WorldCondition("initial_phase_shifted", phase_offset=0.35),
    "frequency_shifted": WorldCondition("frequency_shifted", frequency_scale=1.05),
}


@dataclass(frozen=True, slots=True)
class SplitSpec:
    name: str
    world_seeds: tuple[int, ...]
    condition_names: tuple[str, ...]
    role: str
    fresh_generalization: bool
    inspected_development: bool

    def __post_init__(self) -> None:
        if not self.name or not self.world_seeds or not self.condition_names:
            raise PredictorContractError("split spec is incomplete")
        if len(set(self.world_seeds)) != len(self.world_seeds):
            raise PredictorContractError("world seeds must be unique within a split")
        if any(seed < 0 or type(seed) is not int for seed in self.world_seeds):
            raise PredictorContractError("world seeds must be non-negative integers")
        if any(condition not in WORLD_CONDITIONS for condition in self.condition_names):
            raise PredictorContractError("split contains an unknown world condition")
        if self.inspected_development and self.fresh_generalization:
            raise PredictorContractError("inspected development cannot be fresh generalization")

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "world_seeds": list(self.world_seeds),
            "condition_names": list(self.condition_names),
            "role": self.role,
            "fresh_generalization": self.fresh_generalization,
            "inspected_development": self.inspected_development,
        }


PILOT_SPLITS = (
    SplitSpec("train", TRAIN_WORLD_SEEDS, ("base",), "parameter_fitting_only", False, False),
    SplitSpec(
        "development",
        DEVELOPMENT_WORLD_SEEDS,
        ("base",),
        "inspected_development_cases_only",
        False,
        True,
    ),
    SplitSpec(
        "test",
        TEST_WORLD_SEEDS,
        ("initial_phase_shifted", "frequency_shifted"),
        "reserved_final_generalization",
        True,
        False,
    ),
)


def split_spec(name: str) -> SplitSpec:
    for spec in PILOT_SPLITS:
        if spec.name == name:
            return spec
    raise PredictorContractError(f"unknown split {name}")


def _conditioned_world(seed: int, condition: WorldCondition) -> ResonantWorld:
    """Create an internal data-generation world without exposing hidden data."""

    world = ResonantWorld(seed=seed)
    calibration = dict(world.calibration)
    calibration["frequency_a"] *= condition.frequency_scale
    calibration["frequency_b"] *= condition.frequency_scale
    calibration["phase"] += condition.phase_offset
    if not (0.3 < calibration["frequency_a"] < 0.65):
        raise PredictorContractError("condition moved frequency_a outside simulator range")
    if not (0.62 < calibration["frequency_b"] < 0.92):
        raise PredictorContractError("condition moved frequency_b outside simulator range")
    if not -math.pi <= calibration["phase"] <= math.pi:
        raise PredictorContractError("condition moved phase outside simulator range")
    # This world is an internal generator.  Public serialization below uses
    # only PublicObservation, never target/calibration/omega/seed fields.
    world.calibration = calibration
    world.omega[0] = 2.0 * math.pi * calibration["frequency_a"]
    world.omega[1] = 2.0 * math.pi * calibration["frequency_b"]
    if condition.phase_offset:
        # Cue/distractor inputs are disabled for dataset trajectories, so a
        # calibration phase alone would have no physical effect.  Seed a
        # small public oscillator state with the declared phase instead.
        amplitude = 0.02
        world.u[0] = amplitude * math.sin(condition.phase_offset)
        world.du[0] = amplitude * math.cos(condition.phase_offset)
    return world


@dataclass(frozen=True, slots=True)
class PredictorFrame:
    """One public state/action record used by the recurrent predictor."""

    state: tuple[float, ...]
    action: tuple[float, ...]
    duration_ticks: int

    def __post_init__(self) -> None:
        validate_public_state_vector(self.state, name="frame state")
        action = _finite_array(self.action, (NODE_COUNT,), name="frame action")
        if np.any(np.abs(action) > ACTION_DRIVE_SCALE + 1.0e-12):
            raise PredictorContractError("frame action exceeds the public action bound")
        if type(self.duration_ticks) is not int or self.duration_ticks != MAX_ACTION_DURATION_TICKS:
            raise PredictorContractError("frame duration does not match the frozen action contract")
        object.__setattr__(self, "state", tuple(float(value) for value in self.state))
        object.__setattr__(self, "action", tuple(float(value) for value in action))

    def as_dict(self) -> dict[str, Any]:
        return {
            "state": list(self.state),
            "action": list(self.action),
            "duration_ticks": self.duration_ticks,
        }


@dataclass(frozen=True, slots=True)
class TransitionExample:
    split: str
    trajectory_id: str
    window_id: str
    world_seed: int
    condition_name: str
    history: tuple[PredictorFrame, ...]
    target_state: tuple[float, ...]

    def __post_init__(self) -> None:
        spec = split_spec(self.split)
        if self.world_seed not in spec.world_seeds:
            raise PredictorContractError("example world seed is outside its split")
        if self.condition_name not in spec.condition_names:
            raise PredictorContractError("example condition is outside its split")
        if len(self.history) != HISTORY_LENGTH:
            raise PredictorContractError("example history length is not frozen")
        validate_public_state_vector(self.target_state, name="example target state")
        object.__setattr__(self, "target_state", tuple(float(value) for value in self.target_state))

    def as_dict(self) -> dict[str, Any]:
        return {
            "split": self.split,
            "trajectory_id": self.trajectory_id,
            "window_id": self.window_id,
            "world_seed": self.world_seed,
            "condition_name": self.condition_name,
            "history": [frame.as_dict() for frame in self.history],
            "target_state": list(self.target_state),
        }


@dataclass(frozen=True, slots=True)
class Trajectory:
    split: str
    trajectory_id: str
    world_seed: int
    condition_name: str
    observations: tuple[tuple[float, ...], ...]
    actions: tuple[tuple[float, ...], ...]
    duration_ticks: int = MAX_ACTION_DURATION_TICKS

    def __post_init__(self) -> None:
        if len(self.observations) != len(self.actions) + 1:
            raise PredictorContractError("trajectory must have one more observation than action")
        if len(self.actions) < HISTORY_LENGTH:
            raise PredictorContractError("trajectory is shorter than frozen history length")
        for state in self.observations:
            validate_public_state_vector(state, name="trajectory state")
        for action in self.actions:
            action_array = _finite_array(action, (NODE_COUNT,), name="trajectory action")
            if np.any(np.abs(action_array) > ACTION_DRIVE_SCALE + 1.0e-12):
                raise PredictorContractError("trajectory action exceeds public action bound")

    def window_examples(self) -> tuple[TransitionExample, ...]:
        frames = tuple(
            PredictorFrame(self.observations[index], self.actions[index], self.duration_ticks)
            for index in range(len(self.actions))
        )
        examples = []
        for target_index in range(HISTORY_LENGTH - 1, len(self.actions)):
            examples.append(
                TransitionExample(
                    split=self.split,
                    trajectory_id=self.trajectory_id,
                    window_id=f"{self.trajectory_id}:window-{target_index:03d}",
                    world_seed=self.world_seed,
                    condition_name=self.condition_name,
                    history=frames[target_index - HISTORY_LENGTH + 1 : target_index + 1],
                    target_state=self.observations[target_index + 1],
                )
            )
        return tuple(examples)

    def public_digest(self) -> str:
        payload = {
            "split": self.split,
            "trajectory_id": self.trajectory_id,
            "world_seed": self.world_seed,
            "condition_name": self.condition_name,
            "observations": [list(value) for value in self.observations],
            "actions": [list(value) for value in self.actions],
            "duration_ticks": self.duration_ticks,
        }
        _validate_no_hidden_fields(payload)
        return _sha256(payload)


def _action_sequence(seed: int, condition_name: str) -> tuple[PlannerAction, ...]:
    condition_code = sum(ord(char) for char in condition_name)
    rng = np.random.default_rng(np.random.SeedSequence([seed, ACTION_SEED_SALT, condition_code]))
    actions = candidate_actions()
    return tuple(actions[int(index)] for index in rng.integers(0, len(actions), size=TRAJECTORY_ACTION_COUNT))


def generate_trajectory(
    spec: SplitSpec,
    seed: int,
    condition_name: str,
    *,
    reviewed_selection_artifact: Mapping[str, Any] | None = None,
    expected_split_manifest_sha256: str | None = None,
    expected_experiment_config_sha256: str | None = None,
    expected_selected_checkpoints: Sequence[Mapping[str, Any]] | None = None,
) -> Trajectory:
    if seed not in spec.world_seeds or condition_name not in spec.condition_names:
        raise PredictorContractError("trajectory request is outside its split specification")
    if spec.name == "test":
        _require_reviewed_final_test_access(
            reviewed_selection_artifact,
            expected_split_manifest_sha256=expected_split_manifest_sha256,
            expected_experiment_config_sha256=expected_experiment_config_sha256,
            expected_selected_checkpoints=expected_selected_checkpoints,
        )
    world = _conditioned_world(seed, WORLD_CONDITIONS[condition_name])
    fixture_id = f"pilot-{spec.name}-{condition_name}-world-{seed}"
    observations = [
        public_observation_to_vector(PublicObservation.from_world(world, fixture_id=fixture_id, cycle=0))
    ]
    action_records = []
    for cycle, action in enumerate(_action_sequence(seed, condition_name), start=1):
        action_records.append(tuple(action.drive_vector))
        for _ in range(action.duration_ticks):
            world.step(
                np.asarray(action.drive_vector, dtype=np.float64),
                include_cue=False,
                include_distractors=False,
            )
        observation = PublicObservation.from_world(world, fixture_id=fixture_id, cycle=cycle)
        _validate_no_hidden_fields(observation.as_dict())
        observations.append(public_observation_to_vector(observation))
    return Trajectory(
        split=spec.name,
        trajectory_id=f"{spec.name}:{condition_name}:world-{seed}",
        world_seed=seed,
        condition_name=condition_name,
        observations=tuple(tuple(float(value) for value in state) for state in observations),
        actions=tuple(action_records),
    )


def _canonical_checkpoint_bindings(value: Any, *, name: str) -> list[dict[str, Any]]:
    if not isinstance(value, (list, tuple)) or not value:
        raise EvaluationReservationError(f"{name} must be a non-empty checkpoint binding list")
    bindings = []
    identities = set()
    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            raise EvaluationReservationError(f"{name}[{index}] is not a mapping")
        binding = dict(item)
        for required in ("variant", "init_seed", "checkpoint_sha256"):
            if required not in binding or binding[required] in (None, ""):
                raise EvaluationReservationError(f"{name}[{index}] lacks {required}")
        try:
            binding["init_seed"] = int(binding["init_seed"])
        except (TypeError, ValueError) as exc:
            raise EvaluationReservationError(f"{name}[{index}] has an invalid init_seed") from exc
        checkpoint_sha = str(binding["checkpoint_sha256"])
        if not _is_sha256(checkpoint_sha):
            raise EvaluationReservationError(f"{name}[{index}] has an invalid checkpoint_sha256")
        binding["checkpoint_sha256"] = checkpoint_sha
        _validate_no_hidden_fields(binding)
        identity = (str(binding["variant"]), binding["init_seed"], checkpoint_sha)
        if identity in identities:
            raise EvaluationReservationError(f"{name}[{index}] duplicates a selected checkpoint")
        identities.add(identity)
        bindings.append(binding)
    return sorted(bindings, key=lambda item: _canonical_bytes(item))


def _verify_checkpoint_files(bindings: Sequence[Mapping[str, Any]]) -> None:
    for index, binding in enumerate(bindings):
        checkpoint_path = binding.get("checkpoint_path")
        if checkpoint_path in (None, ""):
            continue
        try:
            actual = hashlib.sha256(Path(str(checkpoint_path)).read_bytes()).hexdigest()
        except OSError as exc:
            raise EvaluationReservationError(
                f"selected checkpoint {index} cannot be read for provenance verification"
            ) from exc
        if actual != str(binding["checkpoint_sha256"]):
            raise EvaluationReservationError(f"selected checkpoint {index} file digest mismatch")


def selection_artifact_digest(artifact: Mapping[str, Any]) -> str:
    """Hash a frozen selection artifact without its self-referential digest."""

    if not isinstance(artifact, Mapping):
        raise EvaluationReservationError("selection artifact must be a mapping")
    body = dict(artifact)
    body.pop("artifact_sha256", None)
    return _sha256(body)


def build_frozen_selection_artifact(
    *,
    split_manifest_sha256: str,
    experiment_config_sha256: str,
    selected_checkpoints: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Create the canonical, provenance-bound artifact required for final test."""

    if not split_manifest_sha256 or not experiment_config_sha256:
        raise EvaluationReservationError("selection artifact provenance hashes are required")
    bindings = _canonical_checkpoint_bindings(selected_checkpoints, name="selected_checkpoints")
    for name, value in (
        ("split_manifest_sha256", split_manifest_sha256),
        ("experiment_config_sha256", experiment_config_sha256),
    ):
        text = str(value)
        if not _is_sha256(text):
            raise EvaluationReservationError(f"{name} is not a canonical SHA-256 digest")
    for binding in bindings:
        binding["split_manifest_sha256"] = str(split_manifest_sha256)
        binding["experiment_config_sha256"] = str(experiment_config_sha256)
    body = {
        "schema": SELECTION_ARTIFACT_SCHEMA,
        "status": "reviewed_and_frozen",
        "selection_frozen": True,
        "split_manifest_sha256": str(split_manifest_sha256),
        "experiment_config_sha256": str(experiment_config_sha256),
        "selected_checkpoints": bindings,
        "final_test_world_seeds": list(TEST_WORLD_SEEDS),
    }
    body["artifact_sha256"] = selection_artifact_digest(body)
    return body


def verify_frozen_selection_artifact(
    artifact: Mapping[str, Any],
    *,
    expected_split_manifest_sha256: str | None = None,
    expected_experiment_config_sha256: str | None = None,
    expected_selected_checkpoints: Sequence[Mapping[str, Any]] | None = None,
) -> str:
    """Verify the digest and exact provenance binding of a frozen selection."""

    if not isinstance(artifact, Mapping):
        raise EvaluationReservationError("final-test selection artifact must be a mapping")
    if artifact.get("schema") != SELECTION_ARTIFACT_SCHEMA:
        raise EvaluationReservationError("final-test selection artifact schema is incompatible")
    if artifact.get("status") != "reviewed_and_frozen":
        raise EvaluationReservationError("final-test selection artifact is not reviewed_and_frozen")
    if artifact.get("selection_frozen") is not True:
        raise EvaluationReservationError("final-test selection artifact does not freeze selection")
    supplied_digest = artifact.get("artifact_sha256")
    actual_digest = selection_artifact_digest(artifact)
    if not isinstance(supplied_digest, str) or supplied_digest != actual_digest:
        raise EvaluationReservationError("final-test selection artifact digest mismatch")
    if list(artifact.get("final_test_world_seeds", [])) != list(TEST_WORLD_SEEDS):
        raise EvaluationReservationError("final-test selection artifact binds the wrong test worlds")
    actual_manifest = str(artifact.get("split_manifest_sha256", ""))
    actual_config = str(artifact.get("experiment_config_sha256", ""))
    if not _is_sha256(actual_manifest) or not _is_sha256(actual_config) or not _is_sha256(supplied_digest):
        raise EvaluationReservationError("final-test selection artifact has a non-canonical provenance digest")
    if expected_split_manifest_sha256 is not None and actual_manifest != str(expected_split_manifest_sha256):
        raise EvaluationReservationError("final-test selection artifact split manifest binding mismatch")
    if expected_experiment_config_sha256 is not None and actual_config != str(expected_experiment_config_sha256):
        raise EvaluationReservationError("final-test selection artifact experiment config binding mismatch")
    bindings = _canonical_checkpoint_bindings(
        artifact.get("selected_checkpoints"), name="selected_checkpoints"
    )
    for index, binding in enumerate(bindings):
        if binding.get("split_manifest_sha256") != actual_manifest:
            raise EvaluationReservationError(f"selected checkpoint {index} has a split manifest mismatch")
        if binding.get("experiment_config_sha256") != actual_config:
            raise EvaluationReservationError(f"selected checkpoint {index} has an experiment config mismatch")
    if expected_selected_checkpoints is not None:
        expected = _canonical_checkpoint_bindings(expected_selected_checkpoints, name="expected_selected_checkpoints")
        if _canonical_bytes(bindings) != _canonical_bytes(expected):
            raise EvaluationReservationError("final-test selection artifact checkpoint binding mismatch")
        _verify_checkpoint_files(expected)
    return actual_digest


def _require_reviewed_final_test_access(
    reviewed_selection_artifact: Mapping[str, Any] | None,
    *,
    expected_split_manifest_sha256: str | None = None,
    expected_experiment_config_sha256: str | None = None,
    expected_selected_checkpoints: Sequence[Mapping[str, Any]] | None = None,
) -> None:
    if expected_split_manifest_sha256 is None or expected_experiment_config_sha256 is None:
        raise EvaluationReservationError(
            "final-test materialization requires expected manifest and config provenance"
        )
    if expected_selected_checkpoints is None:
        raise EvaluationReservationError(
            "final-test materialization requires expected selected checkpoint provenance"
        )
    verify_frozen_selection_artifact(
        reviewed_selection_artifact,
        expected_split_manifest_sha256=expected_split_manifest_sha256,
        expected_experiment_config_sha256=expected_experiment_config_sha256,
        expected_selected_checkpoints=expected_selected_checkpoints,
    )


def build_trajectories(
    split: str,
    *,
    include_test: bool = False,
    reviewed_selection_artifact: Mapping[str, Any] | None = None,
    expected_split_manifest_sha256: str | None = None,
    expected_experiment_config_sha256: str | None = None,
    expected_selected_checkpoints: Sequence[Mapping[str, Any]] | None = None,
) -> tuple[Trajectory, ...]:
    if split == "test":
        if not include_test:
            raise EvaluationReservationError("final-test trajectory materialization is closed by default")
        _require_reviewed_final_test_access(
            reviewed_selection_artifact,
            expected_split_manifest_sha256=expected_split_manifest_sha256,
            expected_experiment_config_sha256=expected_experiment_config_sha256,
            expected_selected_checkpoints=expected_selected_checkpoints,
        )
    spec = split_spec(split)
    return tuple(
        generate_trajectory(
            spec,
            seed,
            condition_name,
            reviewed_selection_artifact=reviewed_selection_artifact,
            expected_split_manifest_sha256=expected_split_manifest_sha256,
            expected_experiment_config_sha256=expected_experiment_config_sha256,
            expected_selected_checkpoints=expected_selected_checkpoints,
        )
        for seed in spec.world_seeds
        for condition_name in spec.condition_names
    )


def build_examples(
    split: str,
    *,
    include_test: bool = False,
    reviewed_selection_artifact: Mapping[str, Any] | None = None,
    expected_split_manifest_sha256: str | None = None,
    expected_experiment_config_sha256: str | None = None,
    expected_selected_checkpoints: Sequence[Mapping[str, Any]] | None = None,
) -> tuple[TransitionExample, ...]:
    return tuple(
        example
        for trajectory in build_trajectories(
            split,
            include_test=include_test,
            reviewed_selection_artifact=reviewed_selection_artifact,
            expected_split_manifest_sha256=expected_split_manifest_sha256,
            expected_experiment_config_sha256=expected_experiment_config_sha256,
            expected_selected_checkpoints=expected_selected_checkpoints,
        )
        for example in trajectory.window_examples()
    )


def _component_names_and_units() -> tuple[tuple[str, ...], tuple[str, ...]]:
    names = []
    units = []
    for field in PUBLIC_STATE_FIELDS:
        if field in PUBLIC_STATE_FIELDS[:6]:
            names.extend(f"{field}[{index}]" for index in range(NODE_COUNT))
            units.extend(PUBLIC_STATE_UNITS[field] for _ in range(NODE_COUNT))
        else:
            names.append(field)
            units.append(PUBLIC_STATE_UNITS[field])
    return tuple(names), tuple(units)


def _manifest_trajectory_summary(trajectory: Trajectory) -> dict[str, Any]:
    examples = trajectory.window_examples()
    return {
        "trajectory_id": trajectory.trajectory_id,
        "split": trajectory.split,
        "world_seed": trajectory.world_seed,
        "condition_name": trajectory.condition_name,
        "public_trajectory_sha256": trajectory.public_digest(),
        "window_count": len(examples),
        "window_ids": [example.window_id for example in examples],
        "window_ids_sha256": _sha256([example.window_id for example in examples]),
        "feature_fields": list(PUBLIC_STATE_FIELDS) + ["action_drive_vector", "duration_ticks"],
        "hidden_fields_used_as_features": [],
        "materialized": True,
    }


def _unmaterialized_trajectory_summary(spec: SplitSpec, seed: int, condition_name: str) -> dict[str, Any]:
    trajectory_id = f"{spec.name}:{condition_name}:world-{seed}"
    window_ids = [
        f"{trajectory_id}:window-{index:03d}"
        for index in range(HISTORY_LENGTH - 1, TRAJECTORY_ACTION_COUNT)
    ]
    return {
        "trajectory_id": trajectory_id,
        "split": spec.name,
        "world_seed": seed,
        "condition_name": condition_name,
        "public_trajectory_sha256": None,
        "window_count": len(window_ids),
        "window_ids": window_ids,
        "window_ids_sha256": _sha256(window_ids),
        "feature_fields": list(PUBLIC_STATE_FIELDS) + ["action_drive_vector", "duration_ticks"],
        "hidden_fields_used_as_features": [],
        "materialized": False,
    }


def verify_split_manifest(manifest: Mapping[str, Any]) -> str:
    if manifest.get("schema") != SPLIT_MANIFEST_SCHEMA:
        raise PredictorContractError("unsupported split manifest schema")
    if [item["name"] for item in manifest.get("split_definitions", [])] != [spec.name for spec in PILOT_SPLITS]:
        raise PredictorContractError("split definitions are not in the frozen order")
    seed_sets = [set(item["world_seeds"]) for item in manifest["split_definitions"]]
    if any(left & right for index, left in enumerate(seed_sets) for right in seed_sets[index + 1 :]):
        raise PredictorContractError("world seeds overlap across splits")
    trajectory_ids = [item["trajectory_id"] for item in manifest.get("trajectories", [])]
    if len(trajectory_ids) != len(set(trajectory_ids)):
        raise PredictorContractError("trajectory ids are not unique")
    window_to_split: dict[str, str] = {}
    for item in manifest["trajectories"]:
        if item["split"] == "test":
            if item.get("materialized") is not False or item.get("public_trajectory_sha256") is not None:
                raise PredictorContractError("reserved test trajectory was materialized in the default manifest")
        elif item.get("materialized") is not True or not item.get("public_trajectory_sha256"):
            raise PredictorContractError("train/development trajectory summary is incomplete")
        for window_id in item.get("window_ids", []):
            prior = window_to_split.setdefault(window_id, item["split"])
            if prior != item["split"]:
                raise PredictorContractError("overlapping window id crosses split boundary")
    if not manifest.get("no_overlapping_windows_across_splits", False):
        raise PredictorContractError("manifest does not assert disjoint windows")
    expected_hash = manifest.get(MANIFEST_HASH_EXCLUSION)
    body = dict(manifest)
    body.pop(MANIFEST_HASH_EXCLUSION, None)
    actual_hash = _sha256(body)
    if expected_hash != actual_hash:
        raise PredictorContractError("split manifest hash is not self-consistent")
    return actual_hash


def build_split_manifest() -> dict[str, Any]:
    trajectories = [
        trajectory
        for spec in PILOT_SPLITS
        if spec.name != "test"
        for trajectory in build_trajectories(spec.name, include_test=False)
    ]
    summaries = [_manifest_trajectory_summary(trajectory) for trajectory in trajectories]
    test_spec = split_spec("test")
    summaries.extend(
        _unmaterialized_trajectory_summary(test_spec, seed, condition_name)
        for seed in test_spec.world_seeds
        for condition_name in test_spec.condition_names
    )
    manifest: dict[str, Any] = {
        "schema": SPLIT_MANIFEST_SCHEMA,
        "dataset_schema": DATASET_SCHEMA,
        "history_length": HISTORY_LENGTH,
        "trajectory_action_count": TRAJECTORY_ACTION_COUNT,
        "action_duration_ticks": MAX_ACTION_DURATION_TICKS,
        "split_definitions": [spec.as_dict() for spec in PILOT_SPLITS],
        "initial_development_fixtures": [
            {
                "world_label": f"world-{seed}",
                "world_seed": seed,
                "role": "inspected_development_case",
                "fresh_generalization": False,
                "split": "development",
            }
            for seed in DEVELOPMENT_WORLD_SEEDS
        ],
        "world_conditions": [condition.as_dict() for condition in WORLD_CONDITIONS.values()],
        "trajectories": summaries,
        "no_overlapping_windows_across_splits": True,
        "test_access": {
            "reserved_until": "development_selection_and_acceptance_frozen",
            "default_materialization": "closed",
            "unlock_requires_reviewed_selection_artifact": True,
            "current_final_test_materialized": False,
            "final_test_metrics_written": False,
            "final_test_data_used_for_cpu_feasibility": False,
            "historical_pre_review_exposure": {
                "inputs_generated": True,
                "world_seeds": list(EXPOSED_TEST_WORLD_SEEDS),
                "conditions": ["phase_shifted", "frequency_shifted"],
                "phase_condition_effect": "pre-review phase_shifted changed calibration only while cues/distractors were disabled; the replacement initial_phase_shifted condition seeds a public oscillator state",
                "metrics_written": False,
                "tuning_use_evidence": "no evidence of tuning to those outcomes was found; they are not treated as fresh final-test evidence",
                "replacement_worlds_required": True,
            },
            "replacement_world_seeds": list(TEST_WORLD_SEEDS),
        },
    }
    manifest["trajectory_summary_sha256"] = _sha256(summaries)
    manifest["window_ids_sha256"] = _sha256(sorted(item for summary in summaries for item in summary["window_ids"]))
    manifest[MANIFEST_HASH_EXCLUSION] = _sha256(manifest)
    verify_split_manifest(manifest)
    return manifest


@dataclass(frozen=True, slots=True)
class TrainOnlyNormalizer:
    """Per-component train-only mean/scale normalizer with provenance."""

    component_names: tuple[str, ...]
    units: tuple[str, ...]
    mean: tuple[float, ...]
    scale: tuple[float, ...]
    fit_split: str
    fit_sample_count: int
    train_value_sha256: str
    schema: str = NORMALIZER_SCHEMA

    def __post_init__(self) -> None:
        count = len(self.component_names)
        if self.schema != NORMALIZER_SCHEMA:
            raise NormalizerContractError("unsupported normalizer schema")
        if len(self.units) != count or len(self.mean) != count or len(self.scale) != count:
            raise NormalizerContractError("normalizer component lengths do not match")
        if self.fit_split != "train" or self.fit_sample_count <= 0:
            raise NormalizerContractError("normalizer must be fitted from non-empty train data")
        mean = _finite_array(self.mean, (count,), name="normalizer mean")
        scale = _finite_array(self.scale, (count,), name="normalizer scale")
        if np.any(scale <= 0.0):
            raise NormalizerContractError("normalizer scales must be positive")
        object.__setattr__(self, "mean", tuple(float(value) for value in mean))
        object.__setattr__(self, "scale", tuple(float(value) for value in scale))

    @classmethod
    def fit(
        cls,
        values: Sequence[Sequence[float] | np.ndarray],
        *,
        component_names: Sequence[str],
        units: Sequence[str],
        split: str,
    ) -> "TrainOnlyNormalizer":
        if split != "train":
            raise NormalizerContractError("normalizer fitting is permitted only on the train split")
        matrix = np.asarray(values, dtype=np.float64)
        if matrix.ndim != 2 or matrix.shape[0] == 0 or matrix.shape[1] != len(component_names):
            raise NormalizerContractError("normalizer fit matrix has the wrong shape")
        if not np.isfinite(matrix).all():
            raise NormalizerContractError("normalizer fit matrix is non-finite")
        mean = matrix.mean(axis=0)
        scale = matrix.std(axis=0)
        # A tiny positive floor preserves near-zero physical components (for
        # example the initially quiet oscillator slots) without making their
        # normalized targets spuriously order-one.
        scale = np.where(scale < 1.0e-6, 1.0e-6, scale)
        return cls(
            tuple(component_names),
            tuple(units),
            tuple(float(value) for value in mean),
            tuple(float(value) for value in scale),
            "train",
            int(matrix.shape[0]),
            _sha256(matrix.tolist()),
        )

    def transform(self, value: Sequence[float] | np.ndarray) -> np.ndarray:
        vector = _finite_array(value, (len(self.mean),), name="normalizer input")
        result = (vector - np.asarray(self.mean)) / np.asarray(self.scale)
        if not np.isfinite(result).all():
            raise NormalizerContractError("normalizer produced a non-finite value")
        return result

    def inverse(self, value: Sequence[float] | np.ndarray) -> np.ndarray:
        vector = _finite_array(value, (len(self.mean),), name="normalizer output")
        result = vector * np.asarray(self.scale) + np.asarray(self.mean)
        if not np.isfinite(result).all():
            raise NormalizerContractError("normalizer inverse produced a non-finite value")
        return result

    def _provenance_payload(self) -> dict[str, Any]:
        """Return the canonical payload whose digest binds this normalizer.

        ``train_value_sha256`` identifies the source training observations, but
        it is not sufficient on its own: a checkpoint can otherwise carry a
        modified mean or scale while retaining the source-data digest.  The
        provenance digest therefore covers both the fitted parameters and the
        training-data provenance.
        """

        return {
            "schema": self.schema,
            "component_names": list(self.component_names),
            "units": list(self.units),
            "mean": list(self.mean),
            "scale": list(self.scale),
            "fit_split": self.fit_split,
            "fit_sample_count": self.fit_sample_count,
            "train_value_sha256": self.train_value_sha256,
        }

    @property
    def provenance_sha256(self) -> str:
        return _sha256(self._provenance_payload())

    def as_dict(self) -> dict[str, Any]:
        payload = self._provenance_payload()
        payload["provenance_sha256"] = self.provenance_sha256
        return payload

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "TrainOnlyNormalizer":
        normalizer = cls(
            tuple(payload["component_names"]),
            tuple(payload["units"]),
            tuple(payload["mean"]),
            tuple(payload["scale"]),
            str(payload["fit_split"]),
            int(payload["fit_sample_count"]),
            str(payload["train_value_sha256"]),
            str(payload.get("schema", "")),
        )
        supplied_digest = payload.get("provenance_sha256")
        if not isinstance(supplied_digest, str) or supplied_digest != normalizer.provenance_sha256:
            raise NormalizerContractError("normalizer provenance digest mismatch")
        return normalizer


def fit_train_normalizers(
    trajectories: Sequence[Trajectory],
) -> tuple[TrainOnlyNormalizer, TrainOnlyNormalizer]:
    if not trajectories or any(
        not isinstance(trajectory, Trajectory) or trajectory.split != "train"
        for trajectory in trajectories
    ):
        raise NormalizerContractError("state/target normalizers require train-only trajectories")
    # Each physical observation/action is included once.  Overlapping
    # transition windows are not used to weight normalization statistics.
    states = [state for trajectory in trajectories for state in trajectory.observations[:-1]]
    targets = [state for trajectory in trajectories for state in trajectory.observations[1:]]
    names, units = _component_names_and_units()
    return (
        TrainOnlyNormalizer.fit(states, component_names=names, units=units, split="train"),
        TrainOnlyNormalizer.fit(targets, component_names=names, units=units, split="train"),
    )


def _core_input(frame: PredictorFrame, state_normalizer: TrainOnlyNormalizer) -> np.ndarray:
    if len(state_normalizer.mean) != PUBLIC_STATE_DIM:
        raise PredictorContractError("state normalizer has the wrong dimension")
    vector = np.zeros(POLICY_VECTOR_DIM, dtype=np.float64)
    vector[CORE_INPUT_STATE_START : CORE_INPUT_STATE_START + PUBLIC_STATE_DIM] = state_normalizer.transform(frame.state)
    vector[CORE_INPUT_ACTION_START : CORE_INPUT_ACTION_START + NODE_COUNT] = (
        np.asarray(frame.action, dtype=np.float64) / ACTION_DRIVE_SCALE
    )
    vector[CORE_INPUT_DURATION_INDEX] = frame.duration_ticks / MAX_ACTION_DURATION_TICKS
    if not np.isfinite(vector).all():
        raise PredictorContractError("core input encoding is non-finite")
    return vector


def _numeric_representation(trace: Mapping[str, Any]) -> np.ndarray:
    result = np.concatenate(
        (
            np.asarray(trace["integrated_central"], dtype=np.float64).reshape(-1),
            np.asarray(trace["oscillators"], dtype=np.float64).reshape(-1),
            np.asarray(trace["feedback"], dtype=np.float64).reshape(-1),
        )
    )
    if result.shape != (REPRESENTATION_DIM,) or not np.isfinite(result).all():
        raise PredictorContractError("hybrid representation is non-finite or has the wrong shape")
    return result


def _tensor_representation(trace: Mapping[str, Any]) -> Tensor:
    result = concatenate(
        (
            trace["integrated_central"].reshape(-1),
            trace["oscillators"].reshape(-1),
            trace["feedback"].reshape(-1),
        ),
        axis=0,
    )
    if result.data.shape != (REPRESENTATION_DIM,) or not np.isfinite(result.data).all():
        raise PredictorContractError("tensor hybrid representation is non-finite or has the wrong shape")
    return result


def _positive_upper(normalizer: TrainOnlyNormalizer, index: int) -> float:
    mean = float(normalizer.mean[index])
    scale = float(normalizer.scale[index])
    upper = max(mean + 6.0 * scale, 1.0e-6)
    upper = min(upper, float(PUBLIC_STATE_ABS_LIMITS[index]))
    if not math.isfinite(upper) or upper <= 0.0:
        raise PredictorContractError("non-negative output bound is invalid")
    return upper


def _stable_sigmoid_numeric(value: np.ndarray) -> np.ndarray:
    clipped = np.clip(np.asarray(value, dtype=np.float64), -60.0, 60.0)
    result = 1.0 / (1.0 + np.exp(-clipped))
    if not np.isfinite(result).all():
        raise PredictorContractError("bounded observable activation is non-finite")
    return result


def _physical_prediction_numeric(raw: np.ndarray, normalizer: TrainOnlyNormalizer) -> np.ndarray:
    raw = _finite_array(raw, (PUBLIC_STATE_DIM,), name="head logits")
    normalized = np.tanh(raw) * HEAD_NORMALIZED_LIMIT
    physical = normalizer.inverse(normalized)
    for index in NONNEGATIVE_OUTPUT_INDICES:
        # This is a deliberate differentiable positive output parameterization,
        # not post-hoc clipping or a substitute predictor.
        physical[index] = _positive_upper(normalizer, index) * _stable_sigmoid_numeric(raw[index])
    if not np.isfinite(physical).all():
        raise PredictorContractError("physical observable output is non-finite")
    return physical


def _physical_prediction_tensor(raw: Tensor, normalizer: TrainOnlyNormalizer) -> Tensor:
    normalized = tanh(raw) * HEAD_NORMALIZED_LIMIT
    mean = Tensor(np.asarray(normalizer.mean, dtype=np.float64))
    scale = Tensor(np.asarray(normalizer.scale, dtype=np.float64))
    physical_unbounded = normalized * scale + mean
    rows = []
    for index in range(PUBLIC_STATE_DIM):
        if index in NONNEGATIVE_OUTPUT_INDICES:
            rows.append((sigmoid(raw[index]) * _positive_upper(normalizer, index)).reshape(1))
        else:
            rows.append(physical_unbounded[index].reshape(1))
    physical = concatenate(rows, axis=0)
    if not np.isfinite(physical.data).all():
        raise PredictorContractError("tensor physical observable output is non-finite")
    return physical


def _model_parameter_digest(core: V03HybridCore, head_weight: np.ndarray, head_bias: np.ndarray) -> str:
    payload = {
        "core": core.parameter_digest(),
        "head_weight": np.ascontiguousarray(head_weight, dtype=np.float64).tobytes().hex(),
        "head_bias": np.ascontiguousarray(head_bias, dtype=np.float64).tobytes().hex(),
    }
    return _sha256(payload)


def _ordered_trajectory_examples(
    trajectory_or_examples: Trajectory | Sequence[TransitionExample],
) -> tuple[TransitionExample, ...]:
    if isinstance(trajectory_or_examples, Trajectory):
        examples = trajectory_or_examples.window_examples()
    else:
        examples = tuple(trajectory_or_examples)
    if not examples or not all(isinstance(example, TransitionExample) for example in examples):
        raise PredictorContractError("a non-empty trajectory or transition-example sequence is required")
    trajectory_ids = {example.trajectory_id for example in examples}
    if len(trajectory_ids) != 1:
        raise PredictorContractError("one recurrent loss must receive exactly one trajectory")
    if any(example.split != "train" for example in examples):
        raise PredictorContractError("task-loss gradient probes require train examples")
    ordered = tuple(sorted(examples, key=lambda example: example.window_id))
    if tuple(example.window_id for example in ordered) != tuple(example.window_id for example in examples):
        raise PredictorContractError("trajectory examples must be in chronological window order")
    return ordered


class LearnedObservablePredictor:
    """Existing hybrid core plus a trainable public-state prediction head."""

    def __init__(self, *, init_seed: int, geometry_enabled: bool):
        if type(init_seed) is not int or init_seed < 0:
            raise PredictorContractError("predictor init_seed must be a non-negative integer")
        if not isinstance(geometry_enabled, bool):
            raise PredictorContractError("geometry_enabled must be boolean")
        self.init_seed = init_seed
        self.geometry_enabled = geometry_enabled
        self.core = V03HybridCore(init_seed, geometry_enabled=geometry_enabled)
        rng = np.random.default_rng(np.random.SeedSequence([init_seed, HEAD_SEED_SALT]))
        self.head_weight = rng.normal(0.0, 0.01, size=(PUBLIC_STATE_DIM, REPRESENTATION_DIM)).astype(np.float64)
        self.head_bias = np.zeros(PUBLIC_STATE_DIM, dtype=np.float64)
        self._validate_head()

    def _validate_head(self) -> None:
        if self.head_weight.shape != (PUBLIC_STATE_DIM, REPRESENTATION_DIM) or not np.isfinite(self.head_weight).all():
            raise CheckpointContractError("predictor head weight is invalid")
        if self.head_bias.shape != (PUBLIC_STATE_DIM,) or not np.isfinite(self.head_bias).all():
            raise CheckpointContractError("predictor head bias is invalid")

    @property
    def parameter_count(self) -> int:
        return self.core.parameter_count() + int(self.head_weight.size + self.head_bias.size)

    def parameter_audit(self) -> dict[str, Any]:
        core_audit = self.core.parameter_budget_audit()
        head_count = int(self.head_weight.size + self.head_bias.size)
        return {
            "core_base_parameter_count": core_audit["base_parameter_count"],
            "core_incremental_parameter_count": core_audit["incremental_parameter_count"],
            "head_parameter_count": head_count,
            "total_trainable_parameter_count": self.parameter_count,
            "head_shape": [PUBLIC_STATE_DIM, REPRESENTATION_DIM],
            "parameter_count_formula": "core_base + core_incremental + (public_state_dim * representation_dim) + public_state_dim",
            "core_incremental_cap_preserved": core_audit["within_cap"],
        }

    def parameter_digest(self) -> str:
        return _model_parameter_digest(self.core, self.head_weight, self.head_bias)

    def model_identity(self) -> dict[str, Any]:
        return {
            "schema": LEARNED_PREDICTOR_SCHEMA,
            "model_type": "hybrid_core_public_observable_predictor",
            "core_identity": self.core.model_identity(),
            "geometry_enabled": self.geometry_enabled,
            "head": {
                "input_representation_dim": REPRESENTATION_DIM,
                "output_dim": PUBLIC_STATE_DIM,
                "activation": "tanh_bounded_normalized_observable_output",
                "normalized_output_limit": HEAD_NORMALIZED_LIMIT,
                "uses_public_observable_targets": True,
            },
            "input_contract": {
                "state_fields": list(PUBLIC_STATE_FIELDS),
                "action_drive_scale": ACTION_DRIVE_SCALE,
                "duration_ticks": MAX_ACTION_DURATION_TICKS,
                "history_length": HISTORY_LENGTH,
                "hidden_fields_used": [],
            },
            "parameter_digest": self.parameter_digest(),
            "weights_status": "random_untrained",
            "competence_claim": False,
            "closed_loop_planning_benefit_evaluated": False,
        }

    def _forward_representation(
        self,
        history: Sequence[PredictorFrame],
        *,
        state_normalizer: TrainOnlyNormalizer,
        runtime: Mapping[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        if len(history) != HISTORY_LENGTH:
            raise PredictorContractError("predictor history has the wrong length")
        current_runtime = self.core.initial_runtime() if runtime is None else runtime
        trace = None
        for frame in history:
            current_runtime, trace = self.core.step(
                current_runtime,
                _core_input(frame, state_normalizer),
                dt=DEFAULT_DT,
            )
        if trace is None:
            raise PredictorContractError("predictor received an empty history")
        return _numeric_representation(trace), current_runtime

    def _predict_from_representation(
        self,
        representation: np.ndarray,
        *,
        target_normalizer: TrainOnlyNormalizer,
    ) -> np.ndarray:
        raw = self.head_weight @ representation + self.head_bias
        prediction = _physical_prediction_numeric(raw, target_normalizer)
        validate_public_state_vector(prediction, name="predictor output")
        return prediction

    def forward_with_runtime(
        self,
        history: Sequence[PredictorFrame],
        *,
        state_normalizer: TrainOnlyNormalizer,
        target_normalizer: TrainOnlyNormalizer,
        runtime: Mapping[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        representation, next_runtime = self._forward_representation(
            history,
            state_normalizer=state_normalizer,
            runtime=runtime,
        )
        return self._predict_from_representation(
            representation,
            target_normalizer=target_normalizer,
        ), next_runtime

    def forward_frame_with_runtime(
        self,
        frame: PredictorFrame,
        *,
        state_normalizer: TrainOnlyNormalizer,
        target_normalizer: TrainOnlyNormalizer,
        runtime: Mapping[str, Any],
    ) -> tuple[np.ndarray, dict[str, Any]]:
        """Consume exactly one new trajectory frame from an existing runtime."""

        next_runtime, trace = self.core.step(
            runtime,
            _core_input(frame, state_normalizer),
            dt=DEFAULT_DT,
        )
        return self._predict_from_representation(
            _numeric_representation(trace),
            target_normalizer=target_normalizer,
        ), next_runtime

    def forward_trajectory(
        self,
        trajectory: Trajectory,
        *,
        state_normalizer: TrainOnlyNormalizer,
        target_normalizer: TrainOnlyNormalizer,
    ) -> tuple[tuple[np.ndarray, ...], dict[str, Any]]:
        """Consume one trajectory once, with one runtime reset per episode.

        The first two frames prime the recurrent context.  Every later frame
        is consumed exactly once.  This is the same contract used by the
        trajectory loss and recursive rollout; overlapping two-frame windows
        are never reprocessed while a runtime is carried forward.
        """

        examples = trajectory.window_examples()
        if not examples:
            raise PredictorContractError("trajectory has no evaluation windows")
        runtime = self.core.initial_runtime()
        predictions: list[np.ndarray] = []
        prediction, runtime = self.forward_with_runtime(
            examples[0].history,
            state_normalizer=state_normalizer,
            target_normalizer=target_normalizer,
            runtime=runtime,
        )
        predictions.append(prediction)
        for example in examples[1:]:
            prediction, runtime = self.forward_frame_with_runtime(
                example.history[-1],
                state_normalizer=state_normalizer,
                target_normalizer=target_normalizer,
                runtime=runtime,
            )
            predictions.append(prediction)
        return tuple(predictions), runtime

    def forward(
        self,
        history: Sequence[PredictorFrame],
        *,
        state_normalizer: TrainOnlyNormalizer,
        target_normalizer: TrainOnlyNormalizer,
    ) -> np.ndarray:
        return self.forward_with_runtime(
            history,
            state_normalizer=state_normalizer,
            target_normalizer=target_normalizer,
        )[0]

    def loss_and_gradients(
        self,
        trajectory_or_examples: Trajectory | Sequence[TransitionExample],
        *,
        state_normalizer: TrainOnlyNormalizer,
        target_normalizer: TrainOnlyNormalizer,
    ) -> tuple[float, dict[str, np.ndarray]]:
        """Sequential physical-observable loss; no optimizer update.

        A trajectory resets the recurrent runtime once.  Its first two
        context frames are consumed once, then each subsequent window adds
        only its new final frame.  This prevents an overlapping window from
        being fed twice through a carried recurrent state.
        """

        examples = _ordered_trajectory_examples(trajectory_or_examples)
        params = self.core.tensor_parameters(requires_grad=True)
        head_weight = Tensor(self.head_weight.copy(), requires_grad=True)
        head_bias = Tensor(self.head_bias.copy(), requires_grad=True)
        runtime = self.core.tensor_initial_runtime()
        target_mean = Tensor(np.asarray(target_normalizer.mean, dtype=np.float64))
        target_scale = Tensor(np.asarray(target_normalizer.scale, dtype=np.float64))
        objective = Tensor(0.0)
        for index, example in enumerate(examples):
            frames = example.history if index == 0 else (example.history[-1],)
            trace = None
            for frame in frames:
                runtime, trace = self.core.tensor_step(
                    runtime,
                    _core_input(frame, state_normalizer),
                    dt=DEFAULT_DT,
                    params=params,
                )
            if trace is None:
                raise PredictorContractError("cannot compute loss for empty trajectory frame set")
            representation = _tensor_representation(trace)
            raw = head_weight @ representation + head_bias
            physical_prediction = _physical_prediction_tensor(raw, target_normalizer)
            normalized_prediction = (physical_prediction - target_mean) / target_scale
            target = target_normalizer.transform(example.target_state)
            residual = normalized_prediction - target
            objective = objective + (residual * residual).sum() / float(PUBLIC_STATE_DIM)
        objective = objective / float(len(examples))
        objective.backward()
        if not math.isfinite(float(objective.data)):
            raise PredictorContractError("observable loss is non-finite")
        gradients = {
            **{name: value.grad.copy() for name, value in params.items()},
            "predictor.head_weight": head_weight.grad.copy(),
            "predictor.head_bias": head_bias.grad.copy(),
        }
        if not all(np.isfinite(value).all() for value in gradients.values()):
            raise PredictorContractError("observable loss gradient is non-finite")
        return float(objective.data), gradients

    def apply_gradients(
        self,
        gradients: Mapping[str, np.ndarray],
        *,
        learning_rate: float = LEARNING_RATE,
        deadline: SharedDeadline | None = None,
    ) -> dict[str, Any]:
        """Apply the frozen plain-SGD update to every trainable parameter.

        The method deliberately requires an exact parameter-key match so a
        forgotten core or geometry parameter cannot silently remain frozen.
        Every gradient and resulting value is validated and staged before any
        live parameter is mutated.  This prevents a late invalid gradient or
        deadline from exposing a partial update.  It performs no clipping,
        momentum, schedule change, or selection.
        """

        if not math.isfinite(float(learning_rate)) or learning_rate <= 0.0:
            raise PredictorContractError("learning_rate must be positive and finite")
        if deadline is not None:
            deadline.check("before_optimizer_update")
        expected = {
            *(f"base.{name}" for name in self.core.base.params),
            *self.core.params.keys(),
            "predictor.head_weight",
            "predictor.head_bias",
        }
        if set(gradients) != expected:
            missing = sorted(expected - set(gradients))
            extra = sorted(set(gradients) - expected)
            raise PredictorContractError(
                f"optimizer gradient keys do not match trainable parameters; missing={missing}, extra={extra}"
            )
        parameter_arrays: dict[str, np.ndarray] = {
            **{f"base.{name}": value for name, value in self.core.base.params.items()},
            **self.core.params,
            "predictor.head_weight": self.head_weight,
            "predictor.head_bias": self.head_bias,
        }
        staged: dict[str, np.ndarray] = {}
        for name in sorted(expected):
            if deadline is not None:
                deadline.check(f"before_optimizer_stage_{name}")
            gradient = _finite_array(gradients[name], parameter_arrays[name].shape, name=f"gradient {name}")
            updated = parameter_arrays[name] - float(learning_rate) * gradient
            if not np.isfinite(updated).all():
                raise PredictorContractError(f"optimizer update for {name} is non-finite")
            staged[name] = updated
        if deadline is not None:
            deadline.check("before_optimizer_commit")
        for name in sorted(expected):
            parameter_arrays[name][...] = staged[name]
        self._validate_head()
        return {
            "optimizer": "sgd",
            "learning_rate": float(learning_rate),
            "updated_parameter_count": len(expected),
            "updated_element_count": int(sum(value.size for value in parameter_arrays.values())),
            "commit_atomic_after_validation": True,
        }

    def state_dict(self) -> dict[str, Any]:
        return {
            "schema": CHECKPOINT_SCHEMA,
            "model_schema": LEARNED_PREDICTOR_SCHEMA,
            "init_seed": self.init_seed,
            "geometry_enabled": self.geometry_enabled,
            "core_base_params": {name: value.tolist() for name, value in self.core.base.params.items()},
            "core_hybrid_params": {name: value.tolist() for name, value in self.core.params.items()},
            "head_weight": self.head_weight.tolist(),
            "head_bias": self.head_bias.tolist(),
            "parameter_digest": self.parameter_digest(),
        }

    def load_state_dict(self, payload: Mapping[str, Any]) -> None:
        if payload.get("schema") != CHECKPOINT_SCHEMA or payload.get("model_schema") != LEARNED_PREDICTOR_SCHEMA:
            raise CheckpointContractError("checkpoint schema is incompatible")
        if int(payload.get("init_seed", -1)) != self.init_seed or bool(payload.get("geometry_enabled")) != self.geometry_enabled:
            raise CheckpointContractError("checkpoint initialization identity does not match model")
        base = payload.get("core_base_params")
        hybrid = payload.get("core_hybrid_params")
        if not isinstance(base, Mapping) or not isinstance(hybrid, Mapping):
            raise CheckpointContractError("checkpoint omits core parameters")
        if set(base) != set(self.core.base.params) or set(hybrid) != set(self.core.params):
            raise CheckpointContractError("checkpoint core parameter names do not match")
        for name, value in base.items():
            self.core.base.params[name] = _finite_array(value, self.core.base.params[name].shape, name=f"checkpoint base {name}")
        for name, value in hybrid.items():
            self.core.params[name] = _finite_array(value, self.core.params[name].shape, name=f"checkpoint hybrid {name}")
        self.head_weight = _finite_array(
            payload.get("head_weight"),
            (PUBLIC_STATE_DIM, REPRESENTATION_DIM),
            name="checkpoint head weight",
        )
        self.head_bias = _finite_array(payload.get("head_bias"), (PUBLIC_STATE_DIM,), name="checkpoint head bias")
        expected = str(payload.get("parameter_digest", ""))
        if expected != self.parameter_digest():
            raise CheckpointContractError("checkpoint parameter digest mismatch")


def save_checkpoint(
    path: str | Path,
    model: LearnedObservablePredictor,
    *,
    state_normalizer: TrainOnlyNormalizer,
    target_normalizer: TrainOnlyNormalizer,
    split_manifest_sha256: str,
    experiment_config_sha256: str,
    selection: Mapping[str, Any] | None = None,
    deadline: SharedDeadline | None = None,
) -> str:
    """Save a complete, versioned checkpoint and return its file digest."""

    if deadline is not None:
        deadline.check("checkpoint_save_start")
    if not split_manifest_sha256 or not experiment_config_sha256:
        raise CheckpointContractError("checkpoint provenance hashes are required")
    payload = {
        **model.state_dict(),
        "state_normalizer": state_normalizer.as_dict(),
        "target_normalizer": target_normalizer.as_dict(),
        "split_manifest_sha256": split_manifest_sha256,
        "experiment_config_sha256": experiment_config_sha256,
        "selection": dict(selection or {}),
        "checkpoint_status": "trained_checkpoint",
    }
    _validate_no_hidden_fields(payload)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
    if deadline is not None:
        deadline.check("checkpoint_save_before_write")
    try:
        temporary.write_text(encoded, encoding="utf-8")
        if deadline is not None:
            deadline.check("checkpoint_save_before_replace")
        temporary.replace(target)
    except EvaluationDeadlineError:
        if temporary.exists():
            temporary.unlink()
        raise
    if deadline is not None:
        deadline.check("checkpoint_save_after_replace")
    return hashlib.sha256(target.read_bytes()).hexdigest()


def load_checkpoint(
    path: str | Path,
    *,
    expected_split_manifest_sha256: str | None = None,
    expected_experiment_config_sha256: str | None = None,
    expected_state_normalizer_sha256: str | None = None,
    expected_target_normalizer_sha256: str | None = None,
    expected_state_normalizer_provenance_sha256: str | None = None,
    expected_target_normalizer_provenance_sha256: str | None = None,
    expected_checkpoint_sha256: str | None = None,
    deadline: SharedDeadline | None = None,
) -> tuple[LearnedObservablePredictor, TrainOnlyNormalizer, TrainOnlyNormalizer, dict[str, Any]]:
    if deadline is not None:
        deadline.check("checkpoint_load_start")
    checkpoint_path = Path(path)
    raw = checkpoint_path.read_bytes()
    checkpoint_sha256 = hashlib.sha256(raw).hexdigest()
    if expected_checkpoint_sha256 is not None and str(expected_checkpoint_sha256) != checkpoint_sha256:
        raise CheckpointContractError(
            f"checkpoint file digest mismatch: expected {expected_checkpoint_sha256}, got {checkpoint_sha256}"
        )
    if deadline is not None:
        deadline.check("checkpoint_load_after_read")
    payload = json.loads(raw.decode("utf-8"))
    if payload.get("schema") != CHECKPOINT_SCHEMA:
        raise CheckpointContractError("checkpoint schema is incompatible")
    if deadline is not None:
        deadline.check("checkpoint_load_before_model")
    model = LearnedObservablePredictor(
        init_seed=int(payload["init_seed"]),
        geometry_enabled=bool(payload["geometry_enabled"]),
    )
    model.load_state_dict(payload)
    if deadline is not None:
        deadline.check("checkpoint_load_after_model")
    state_normalizer = TrainOnlyNormalizer.from_dict(payload["state_normalizer"])
    target_normalizer = TrainOnlyNormalizer.from_dict(payload["target_normalizer"])
    if deadline is not None:
        deadline.check("checkpoint_load_after_normalizers")
    for key in ("split_manifest_sha256", "experiment_config_sha256"):
        if not payload.get(key):
            raise CheckpointContractError(f"checkpoint omits {key}")
    expected_provenance = {
        "split_manifest_sha256": expected_split_manifest_sha256,
        "experiment_config_sha256": expected_experiment_config_sha256,
        "state_normalizer_sha256": expected_state_normalizer_sha256,
        "target_normalizer_sha256": expected_target_normalizer_sha256,
    }
    actual_provenance = {
        "split_manifest_sha256": payload.get("split_manifest_sha256"),
        "experiment_config_sha256": payload.get("experiment_config_sha256"),
        "state_normalizer_sha256": state_normalizer.provenance_sha256,
        "target_normalizer_sha256": target_normalizer.provenance_sha256,
    }
    expected_provenance["state_normalizer_sha256"] = (
        expected_state_normalizer_provenance_sha256
        if expected_state_normalizer_provenance_sha256 is not None
        else expected_state_normalizer_sha256
    )
    expected_provenance["target_normalizer_sha256"] = (
        expected_target_normalizer_provenance_sha256
        if expected_target_normalizer_provenance_sha256 is not None
        else expected_target_normalizer_sha256
    )
    for name, expected in expected_provenance.items():
        if expected is not None and str(expected) != str(actual_provenance[name]):
            raise CheckpointContractError(
                f"checkpoint {name} mismatch: expected {expected}, got {actual_provenance[name]}"
            )
    if deadline is not None:
        deadline.check("checkpoint_load_complete")
    returned_payload = dict(payload)
    returned_payload["checkpoint_sha256"] = checkpoint_sha256
    returned_payload["state_normalizer_provenance_sha256"] = state_normalizer.provenance_sha256
    returned_payload["target_normalizer_provenance_sha256"] = target_normalizer.provenance_sha256
    return model, state_normalizer, target_normalizer, returned_payload


def select_development_checkpoint(
    records: Sequence[Mapping[str, Any]],
    *,
    deadline: SharedDeadline | None = None,
) -> dict[str, Any]:
    """Select one complete development record using the preregistered key."""

    if not records:
        raise PredictorContractError("development checkpoint selection needs at least one record")
    if deadline is not None:
        deadline.check("selection_start")
    prepared: list[tuple[tuple[float, float, int], Mapping[str, Any]]] = []
    for index, record in enumerate(records):
        if deadline is not None:
            deadline.check(f"selection_record_{index}")
        if not isinstance(record, Mapping) or record.get("status") != "complete":
            raise PredictorContractError("incomplete development records cannot be selected")
        try:
            normalized_mse = float(record["development_normalized_mse"])
            rollout_rmse = float(record["development_rollout_rmse"])
            init_seed = int(record["init_seed"])
        except (KeyError, TypeError, ValueError) as exc:
            raise PredictorContractError("development selection record is missing frozen metrics") from exc
        if not all(math.isfinite(value) for value in (normalized_mse, rollout_rmse)) or init_seed < 0:
            raise PredictorContractError("development selection record contains invalid metrics")
        prepared.append(((normalized_mse, rollout_rmse, init_seed), record))
    selected = dict(min(prepared, key=lambda item: item[0])[1])
    if deadline is not None:
        deadline.check("selection_complete")
    return selected


class PersistenceBaseline:
    name = "persistence"

    def predict(self, history: Sequence[PredictorFrame], **_: Any) -> np.ndarray:
        if not history:
            raise PredictorContractError("persistence baseline needs history")
        return validate_public_state_vector(history[-1].state, name="persistence output")


class LinearObservableBaseline:
    """Small public-state ridge baseline, fitted only on train trajectories."""

    name = "linear_public"

    def __init__(self, ridge: float = 1.0e-5):
        if not math.isfinite(ridge) or ridge <= 0.0:
            raise PredictorContractError("linear baseline ridge must be positive")
        self.ridge = ridge
        self.weight: np.ndarray | None = None

    @staticmethod
    def _features_from_frame(frame: PredictorFrame) -> np.ndarray:
        result = np.asarray(
            [
                *frame.state,
                *np.asarray(frame.action, dtype=np.float64) / ACTION_DRIVE_SCALE,
                frame.duration_ticks / MAX_ACTION_DURATION_TICKS,
                1.0,
            ],
            dtype=np.float64,
        )
        if not np.isfinite(result).all():
            raise PredictorContractError("linear baseline features are non-finite")
        return result

    @classmethod
    def _features(cls, history: Sequence[PredictorFrame]) -> np.ndarray:
        if not history:
            raise PredictorContractError("linear baseline history is empty")
        return cls._features_from_frame(history[-1])

    def fit(self, trajectories: Sequence[Trajectory]) -> "LinearObservableBaseline":
        if not trajectories or any(
            not isinstance(trajectory, Trajectory) or trajectory.split != "train"
            for trajectory in trajectories
        ):
            raise PredictorContractError("linear baseline fitting requires train-only trajectories")
        rows = [
            (PredictorFrame(trajectory.observations[index], trajectory.actions[index], trajectory.duration_ticks), trajectory.observations[index + 1])
            for trajectory in trajectories
            for index in range(len(trajectory.actions))
        ]
        x = np.vstack([self._features_from_frame(frame) for frame, _ in rows])
        y = np.vstack([target for _, target in rows])
        if not np.isfinite(x).all() or not np.isfinite(y).all():
            raise PredictorContractError("linear baseline fit data is non-finite")
        gram = x.T @ x + self.ridge * np.eye(x.shape[1], dtype=np.float64)
        self.weight = np.linalg.solve(gram, x.T @ y)
        if not np.isfinite(self.weight).all():
            raise PredictorContractError("linear baseline fit produced non-finite weights")
        return self

    def predict(self, history: Sequence[PredictorFrame], **_: Any) -> np.ndarray:
        if self.weight is None:
            raise PredictorContractError("linear baseline must be fitted before prediction")
        return validate_public_state_vector(self._features(history) @ self.weight, name="linear baseline output")


def _observation_from_state(state: Sequence[float], *, fixture_id: str = "nominal-baseline") -> PublicObservation:
    vector = validate_public_state_vector(state, name="nominal baseline input")
    return PublicObservation(
        fixture_id=fixture_id,
        cycle=0,
        tick=int(round(float(vector[TIME_INDEX]) / ResonantWorld.DT)),
        time=float(vector[TIME_INDEX]),
        node_displacements=tuple(vector[:NODE_COUNT]),
        node_velocities=tuple(vector[NODE_COUNT : 2 * NODE_COUNT]),
        oscillator_amplitudes=tuple(vector[2 * NODE_COUNT : 3 * NODE_COUNT]),
        oscillator_velocities=tuple(vector[3 * NODE_COUNT : 4 * NODE_COUNT]),
        local_oscillator_energies=tuple(vector[LOCAL_ENERGY_START:LOCAL_ENERGY_STOP]),
        neighbor_amplitude_means=tuple(vector[LOCAL_ENERGY_STOP : LOCAL_ENERGY_STOP + NODE_COUNT]),
        total_energy=float(vector[TOTAL_ENERGY_INDEX]),
        residual=float(vector[RESIDUAL_INDEX]),
        supplied_work=float(vector[SUPPLIED_WORK_INDEX]),
    )


class NominalSimulatorBaseline:
    name = "nominal_simulator"

    def __init__(self) -> None:
        self.predictor = KnownSimulatorPredictor()

    def predict(self, history: Sequence[PredictorFrame], **_: Any) -> np.ndarray:
        if not history:
            raise PredictorContractError("nominal simulator baseline needs history")
        frame = history[-1]
        action = _action_from_drive(frame.action, frame.duration_ticks)
        prior = _observation_from_state(frame.state)
        predicted = self.predictor.predict_action_ticks(prior, action)[-1]
        # This target representation is still the public observation; no
        # private nominal omega is used to calculate the evaluation target.
        predicted = replace(
            predicted,
            cycle=prior.cycle + 1,
            tick=prior.tick + action.duration_ticks,
            time=prior.time + action.duration_ticks * ResonantWorld.DT,
            # The nominal predictor starts its residual accounting at the
            # supplied public residual.  Restore the cumulative prior value.
            residual=prior.residual + predicted.residual,
        )
        return public_observation_to_vector(predicted)


def _action_from_drive(action: Sequence[float], duration_ticks: int) -> PlannerAction:
    drive = _finite_array(action, (NODE_COUNT,), name="baseline action")
    for candidate in candidate_actions():
        if candidate.duration_ticks == duration_ticks and np.array_equal(drive, np.asarray(candidate.drive_vector)):
            return candidate
    raise PredictorContractError("action is outside the frozen public action set")


def compute_audit() -> dict[str, Any]:
    return {
        "history_length": HISTORY_LENGTH,
        "core_steps_per_one_step_prediction": HISTORY_LENGTH,
        "core_steps_per_sequential_trajectory": TRAJECTORY_ACTION_COUNT,
        "head_multiply_adds_per_prediction": PUBLIC_STATE_DIM * (REPRESENTATION_DIM + 1),
        "physics_ticks_per_dataset_action": MAX_ACTION_DURATION_TICKS,
        "rollout_horizons_actions": list(ROLL_OUT_HORIZONS),
        "batch_size": BATCH_SIZE,
        "training_updates_proposed": TRAIN_UPDATES,
        "training_trajectory_count": len(TRAIN_WORLD_SEEDS),
        "training_window_count": len(TRAIN_WORLD_SEEDS) * (TRAJECTORY_ACTION_COUNT - HISTORY_LENGTH + 1),
        "manifest_total_trajectory_count": 32,
        "manifest_total_window_count": 32 * (TRAJECTORY_ACTION_COUNT - HISTORY_LENGTH + 1),
        "paired_geometry_variants": 2,
        "paired_initialization_seeds": list(PAIRED_INITIALIZATION_SEEDS),
        "timing_scope": "one trajectory forward and loss/backward probe only; no extrapolated six-fit estimate",
        "end_to_end_training_estimate": None,
        "timing_note": "The concrete runner records actual elapsed wall time; the probe is not a six-fit estimate.",
        "accounting_scope": "dataset generation, recurrent core forward, observable head, optimizer contract, and recursive evaluation; no hidden simulator-frequency target calculation",
    }


def parameter_accounting() -> dict[str, Any]:
    """Return exact learned/core/baseline parameter counts before training."""

    geometry_off = LearnedObservablePredictor(init_seed=PAIRED_INITIALIZATION_SEEDS[0], geometry_enabled=False)
    geometry_on = LearnedObservablePredictor(init_seed=PAIRED_INITIALIZATION_SEEDS[0], geometry_enabled=True)
    return {
        "learned_geometry_off": geometry_off.parameter_audit(),
        "learned_geometry_on": geometry_on.parameter_audit(),
        "persistence": {"trainable_parameter_count": 0, "fixed_parameter_count": 0},
        "linear_public": {
            "trainable_parameter_count": (PUBLIC_STATE_DIM + NODE_COUNT + 1 + 1) * PUBLIC_STATE_DIM,
            "feature_dimension_including_bias": PUBLIC_STATE_DIM + NODE_COUNT + 1 + 1,
            "output_dimension": PUBLIC_STATE_DIM,
        },
        "nominal_simulator": {
            "trainable_parameter_count": 0,
            "parameterization": "fixed_nominal_public-baseline; not part of learned-core parameter budget",
        },
    }


def pilot_experiment_config(*, split_manifest_sha256: str) -> dict[str, Any]:
    if not split_manifest_sha256:
        raise PredictorContractError("split manifest hash is required")
    return {
        "schema": ARTIFACT_SCHEMA,
        "predictor_schema": LEARNED_PREDICTOR_SCHEMA,
        "dataset_schema": DATASET_SCHEMA,
        "core_model_version": "vevo.v03.hybrid-core.v2",
        "status": "runner_implemented_configuration_only_no_training",
        "architecture_unchanged": True,
        "five_brain_core": {
            "peripheral_brains": 4,
            "central_brains": 1,
            "peripheral_hidden": 8,
            "central_hidden": 12,
            "memory_shape": [2, 6],
            "geometry_ablation": "same_core_geometry_enabled_true_false",
        },
        "input_contract": {
            "public_state_fields": list(PUBLIC_STATE_FIELDS),
            "public_observation_whitelist": list(PUBLIC_OBSERVATION_FIELDS),
            "state_dimension": PUBLIC_STATE_DIM,
            "action_dimension": NODE_COUNT,
            "action_drive_scale": ACTION_DRIVE_SCALE,
            "duration_ticks": MAX_ACTION_DURATION_TICKS,
            "history_length": HISTORY_LENGTH,
            "hidden_fields_used": [],
            "future_target_used": False,
        },
        "target_contract": {
            "target": "next public observable state after the supplied action duration",
            "loss_space": "normalized physical observable components; metrics inverse-transform to physical units",
            "energy_source": "public local_oscillator_energies and total_energy components; never recomputed from hidden frequencies",
            "units": dict(PUBLIC_STATE_UNITS),
        },
        "normalization": {
            "fit_split": "train_only",
            "state_and_target_normalizers": "separate per-component mean/std; target metrics inverse-transform to physical units",
            "scale_floor": 1.0e-6,
            "test_or_development_values_used_for_fit": False,
        },
        "split_manifest_sha256": split_manifest_sha256,
        "split_policy": {
            "train_worlds": list(TRAIN_WORLD_SEEDS),
            "development_worlds": list(DEVELOPMENT_WORLD_SEEDS),
            "development_label": "worlds 9300-9307 are inspected development cases only, never fresh generalization",
            "test_worlds": list(TEST_WORLD_SEEDS),
            "test_conditions": ["initial_phase_shifted", "frequency_shifted"],
            "whole_trajectory_assignment": True,
            "no_overlapping_windows_across_splits": True,
            "final_test_reserved_until_development_freeze": True,
            "default_test_materialization": "closed",
            "reviewed_selection_artifact_required": True,
            "historical_pre_review_exposure": {
                "world_seeds": list(EXPOSED_TEST_WORLD_SEEDS),
                "conditions": ["phase_shifted", "frequency_shifted"],
                "phase_condition_effect": "pre-review phase_shifted changed calibration only while cues/distractors were disabled; the replacement initial_phase_shifted condition seeds a public oscillator state",
                "metrics_written": False,
                "fresh_final_test_evidence": False,
            },
            "replacement_worlds": list(TEST_WORLD_SEEDS),
        },
        "recurrent_contract": {
            "training_unit": "one_complete_trajectory",
            "trajectory_runtime_reset": True,
            "history_length": HISTORY_LENGTH,
            "first_context_frames_consumed_once": True,
            "subsequent_frames_consumed_once": True,
            "overlapping_windows_reprocessed_with_carried_runtime": False,
            "recursive_rollout_uses_same_contract": True,
        },
        "action_coverage": {
            "candidate_action_count": len(candidate_actions()),
            "action_names": [action.name for action in candidate_actions()],
            "trajectory_action_count": TRAJECTORY_ACTION_COUNT,
            "action_sampling": "deterministic_seeded_uniform_choice_from_five_public_actions",
        },
        "variants": [
            {"name": "learned_geometry_on", "kind": "learned_observable_head", "geometry_enabled": True},
            {"name": "learned_geometry_off", "kind": "learned_observable_head", "geometry_enabled": False},
            {"name": "persistence", "kind": "public_baseline"},
            {"name": "linear_public", "kind": "public_baseline_fitted_on_train_only"},
            {"name": "nominal_simulator", "kind": "public_nominal_simulator_baseline"},
        ],
        "training": {
            "paired_initialization_seeds": list(PAIRED_INITIALIZATION_SEEDS),
            "updates": TRAIN_UPDATES,
            "fit_count": len(PAIRED_INITIALIZATION_SEEDS) * 2,
            "updates_per_variant_seed": TRAIN_UPDATES,
            "batch_size": BATCH_SIZE,
            "learning_rate": LEARNING_RATE,
            "optimizer": "sgd",
            "update_rule": "parameter := parameter - learning_rate * reverse_mode_gradient",
            "gradient_parameter_set": "all_core_and_head_parameters_exact_key_match",
            "schedule": "existing core schedule unchanged",
            "trajectory_schedule": "deterministic frozen train-trajectory order repeated modulo update index; identical for both paired geometries",
            "eval_every_updates": EVAL_EVERY_UPDATES,
            "evaluation_cadence_rationale": "one development boundary after the frozen 100-update budget; minimizes overhead under the shared 300-second cap",
            "runner": "run_pilot_training",
            "runner_invoked_for_artifact_generation": False,
            "same_data_updates_selection_geometry_on_off": True,
            "checkpoint_selection": "min_development_normalized_mse_then_min_development_rollout_rmse_then_lowest_init_seed",
            "checkpoint_directory": "storage/checkpoints/v03-learned-predictor-pilot/",
            "paired_variant_timeout_policy": "shared_deadline; mark both paired variants incomplete when either cannot finish the paired evaluation boundary",
            "incomplete_run_status": "incomplete_shared_deadline_no_selection_or_final_test",
            "training_data": {
                "trajectory_count": len(TRAIN_WORLD_SEEDS),
                "window_count": len(TRAIN_WORLD_SEEDS) * (TRAJECTORY_ACTION_COUNT - HISTORY_LENGTH + 1),
            },
            "upstream_training_gate": {
                "required_before_development_evaluation": True,
                "existing_all_four_models_training_success": "8/8",
                "gate_scope": "pre-existing repair gate; this pilot does not claim to satisfy or rerun it",
            },
        },
        "rollout_evaluation": {
            "horizons_actions": list(ROLL_OUT_HORIZONS),
            "recursive": True,
            "teacher_forced_future_observations": False,
            "episode_runtime_reset": True,
            "out_of_bounds": "visible failure; no clipping or substitute predictor",
            "deadline_checks": "shared hard deadline between training/evaluation cases, before and after aggregation, checkpoint reload, and serialization; no metrics after budget exhaustion",
        },
        "metrics": {
            "per_component": ["mae", "rmse", "p50_abs", "p95_abs", "max_abs", "physical_unit"],
            "energy": ["target_energy_mae", "neighbor_energy_mae"],
            "supplied_work": ["mae"],
            "constraint_false_negative_rate": True,
            "closed_loop_planning_benefit": "deferred_and_separate_from_prediction_metrics",
        },
        "acceptance_thresholds": {
            "status": "frozen_before_training; development-only rationale and coverage are recorded; final-test unlock still requires review",
            "paired_variant_comparison": "same seed and data; no geometry advantage inferred from unequal updates",
            "nonfinite_failures": 0,
            "rollout_bound_violations": 0,
            "one_step_normalized_rmse_max": 1.25,
            "rollout_horizon_2_normalized_rmse_max": 1.50,
            "rollout_horizon_4_normalized_rmse_max": 2.00,
            "target_or_neighbor_energy_mae_max": 0.25,
            "supplied_work_mae_max": 0.25,
            "constraint_false_negative_rate_max": 0.10,
            "constraint_thresholds": {
                "max_neighbor_energy": CONSTRAINT_NEIGHBOR_THRESHOLD,
                "max_supplied_work": CONSTRAINT_SUPPLIED_WORK_THRESHOLD,
                "denominator": "actual violation count",
                "zero_violation_rate": None,
                "rationale": "development-only safety screen for the inspected cases; not tuned on reserved final-test outcomes",
            },
        },
        "resource_budget": {
            "wall_clock_seconds": MAX_WALL_CLOCK_SECONDS,
            "cpu_only": True,
            "paid_resources": False,
            "credentials_or_network": False,
            "full_retraining_started": False,
            "pilot_runner_invoked": False,
            "hard_deadline_shared_across_training_evaluation_serialization": True,
            "paired_timeout_is_incomplete_not_success": True,
        },
        "parameter_accounting": parameter_accounting(),
        "compute_audit": compute_audit(),
    }


def _prediction_metrics(
    predictions: Sequence[np.ndarray],
    targets: Sequence[np.ndarray],
    *,
    target_normalizer: TrainOnlyNormalizer | None = None,
    deadline: SharedDeadline | None = None,
) -> dict[str, Any]:
    if len(predictions) != len(targets) or not predictions:
        raise PredictorContractError("prediction/target metric arrays are empty or mismatched")
    pred = np.vstack([validate_public_state_vector(value, name="metric prediction") for value in predictions])
    target = np.vstack([validate_public_state_vector(value, name="metric target") for value in targets])
    absolute = np.abs(pred - target)
    names, units = _component_names_and_units()
    per_component = {}
    for index, name in enumerate(names):
        if deadline is not None:
            deadline.check(f"metric_component_{index}")
        values = absolute[:, index]
        per_component[name] = {
            "unit": units[index],
            "mae": float(values.mean()),
            "rmse": float(np.sqrt(np.mean((pred[:, index] - target[:, index]) ** 2))),
            "p50_abs": float(np.percentile(values, 50)),
            "p95_abs": float(np.percentile(values, 95)),
            "max_abs": float(values.max()),
        }
    normalized_per_component: dict[str, dict[str, Any]] | None = None
    normalized_rmse: float | None = None
    if target_normalizer is not None:
        normalized = np.vstack(
            [
                target_normalizer.transform(row_pred) - target_normalizer.transform(row_target)
                for row_pred, row_target in zip(pred, target)
            ]
        )
        normalized_per_component = {}
        for index, name in enumerate(names):
            if deadline is not None:
                deadline.check(f"normalized_metric_component_{index}")
            values = np.abs(normalized[:, index])
            normalized_per_component[name] = {
                "unit": "train-normalized dimensionless units",
                "mae": float(values.mean()),
                "rmse": float(np.sqrt(np.mean(normalized[:, index] ** 2))),
                "p50_abs": float(np.percentile(values, 50)),
                "p95_abs": float(np.percentile(values, 95)),
                "max_abs": float(values.max()),
            }
        normalized_rmse = float(np.sqrt(np.mean(normalized**2)))
    target_energy = []
    neighbor_energy = []
    false_negatives = 0
    actual_violation_count = 0
    for row_index, (row_pred, row_target) in enumerate(zip(pred, target)):
        if deadline is not None:
            deadline.check(f"constraint_metric_case_{row_index}")
        for port in VALIDATED_PORTS:
            neighbors = (1,) if port == 0 else (0, 2)
            target_energy.append(abs(row_pred[LOCAL_ENERGY_START + port] - row_target[LOCAL_ENERGY_START + port]))
            neighbor_energy.extend(
                abs(row_pred[LOCAL_ENERGY_START + index] - row_target[LOCAL_ENERGY_START + index])
                for index in neighbors
            )
            actual_bad = (
                row_target[LOCAL_ENERGY_START + port] < 0.0
                or max(row_target[LOCAL_ENERGY_START + index] for index in neighbors) > CONSTRAINT_NEIGHBOR_THRESHOLD
                or row_target[SUPPLIED_WORK_INDEX] > CONSTRAINT_SUPPLIED_WORK_THRESHOLD
            )
            predicted_ok = (
                row_pred[LOCAL_ENERGY_START + port] >= 0.0
                and max(row_pred[LOCAL_ENERGY_START + index] for index in neighbors) <= CONSTRAINT_NEIGHBOR_THRESHOLD
                and row_pred[SUPPLIED_WORK_INDEX] <= CONSTRAINT_SUPPLIED_WORK_THRESHOLD
            )
            if actual_bad:
                actual_violation_count += 1
                false_negatives += int(predicted_ok)
    false_negative_rate = (
        float(false_negatives / actual_violation_count) if actual_violation_count else None
    )
    metrics = {
        "schema": EVALUATION_SCHEMA,
        "sample_count": len(predictions),
        "per_component": per_component,
        "target_energy_mae": float(np.mean(target_energy)),
        "neighbor_energy_mae": float(np.mean(neighbor_energy)),
        "supplied_work_mae": float(np.mean(np.abs(pred[:, SUPPLIED_WORK_INDEX] - target[:, SUPPLIED_WORK_INDEX]))),
        "constraint_violation_count": actual_violation_count,
        "constraint_false_negative_count": false_negatives,
        "constraint_false_negative_rate": false_negative_rate,
        "constraint_false_negative_denominator": "actual_violation_count",
    }
    if target_normalizer is not None:
        metrics.update(
            {
                "normalized_rmse": normalized_rmse,
                "normalized_per_component": normalized_per_component,
                "target_normalizer_train_value_sha256": target_normalizer.train_value_sha256,
            }
        )
    return metrics


@dataclass(frozen=True, slots=True)
class EvaluationCaseResult:
    window_id: str
    prediction: tuple[float, ...]
    target: tuple[float, ...]


def _verify_evaluation_provenance(
    expected_provenance: Mapping[str, Any] | None,
    checkpoint_provenance: Mapping[str, Any] | None,
) -> None:
    if expected_provenance is None:
        return
    if not isinstance(checkpoint_provenance, Mapping):
        raise CheckpointContractError("evaluation expected provenance lacks a loaded checkpoint binding")
    for name, expected in expected_provenance.items():
        if expected is None:
            continue
        if name not in checkpoint_provenance or str(checkpoint_provenance[name]) != str(expected):
            raise CheckpointContractError(
                f"evaluation checkpoint provenance mismatch for {name}: "
                f"expected {expected}, got {checkpoint_provenance.get(name)}"
            )


def evaluate_examples(
    predictor: Any,
    examples: Sequence[TransitionExample],
    *,
    split: str,
    state_normalizer: TrainOnlyNormalizer | None = None,
    target_normalizer: TrainOnlyNormalizer | None = None,
    allow_final_test: bool = False,
    development_frozen: bool = False,
    deadline: SharedDeadline | None = None,
    deadline_monotonic: float | None = None,
    checkpoint_provenance: Mapping[str, Any] | None = None,
    expected_provenance: Mapping[str, Any] | None = None,
    reviewed_selection_artifact: Mapping[str, Any] | None = None,
    expected_split_manifest_sha256: str | None = None,
    expected_experiment_config_sha256: str | None = None,
    expected_selected_checkpoints: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    if split == "test" and not (allow_final_test and development_frozen):
        raise EvaluationReservationError("final test is reserved until development choices are frozen")
    if split not in {"train", "development", "test"}:
        raise PredictorContractError("unknown evaluation split")
    if not examples or any(example.split != split for example in examples):
        raise PredictorContractError("evaluation examples do not match the requested split")
    if deadline is not None and deadline_monotonic is not None:
        raise PredictorContractError("pass either deadline or deadline_monotonic, not both")
    if deadline is None and deadline_monotonic is not None:
        deadline = SharedDeadline(float(deadline_monotonic))
    if split == "test":
        _require_reviewed_final_test_access(
            reviewed_selection_artifact,
            expected_split_manifest_sha256=expected_split_manifest_sha256,
            expected_experiment_config_sha256=expected_experiment_config_sha256,
            expected_selected_checkpoints=expected_selected_checkpoints,
        )
    if isinstance(predictor, LearnedObservablePredictor):
        if split == "test" and (
            not expected_provenance
            or any(
                name not in expected_provenance
                for name in (
                    "split_manifest_sha256",
                    "experiment_config_sha256",
                    "checkpoint_sha256",
                    "state_normalizer_sha256",
                    "target_normalizer_sha256",
                )
            )
        ):
            raise EvaluationReservationError(
                "final-test learned evaluation requires expected checkpoint provenance"
            )
        _verify_evaluation_provenance(expected_provenance, checkpoint_provenance)

    def partial_result(status: str, failures: list[dict[str, Any]], completed: int) -> dict[str, Any]:
        return {
            "schema": EVALUATION_SCHEMA,
            "split": split,
            "status": status,
            "cases_requested": len(examples),
            "cases_completed": completed,
            "failures": failures,
            "metrics": None,
        }

    if deadline is not None:
        try:
            deadline.check("evaluation_start")
        except EvaluationDeadlineError as exc:
            return partial_result(
                "partial_deadline_exhausted",
                [{"stage": "evaluation_start", "error": str(exc), "type": type(exc).__name__}],
                0,
            )
    if target_normalizer is None:
        raise PredictorContractError("all predictor metrics require the train-only target normalizer")
    results: list[EvaluationCaseResult] = []
    failures: list[dict[str, Any]] = []
    status = "complete"
    recurrent_runtimes: dict[str, Mapping[str, Any]] = {}
    recurrent_last_window: dict[str, int] = {}
    for index, example in enumerate(examples):
        if deadline is not None:
            try:
                deadline.check(f"before_case_{index}")
            except EvaluationDeadlineError as exc:
                status = "partial_deadline_exhausted"
                failures.append(
                    {
                        "case_index": index,
                        "window_id": example.window_id,
                        "stage": "before_case",
                        "error": str(exc),
                        "type": type(exc).__name__,
                    }
                )
                break
        try:
            if isinstance(predictor, LearnedObservablePredictor):
                if state_normalizer is None or target_normalizer is None:
                    raise PredictorContractError("learned evaluation requires train-only normalizers")
                try:
                    window_index = int(example.window_id.rsplit(":window-", 1)[1])
                except (IndexError, ValueError) as exc:
                    raise PredictorContractError("evaluation window id has no numeric suffix") from exc
                if example.trajectory_id not in recurrent_runtimes:
                    prediction, runtime = predictor.forward_with_runtime(
                        example.history,
                        state_normalizer=state_normalizer,
                        target_normalizer=target_normalizer,
                        runtime=None,
                    )
                else:
                    expected_window = recurrent_last_window[example.trajectory_id] + 1
                    if window_index != expected_window:
                        raise PredictorContractError(
                            f"recurrent evaluation windows are not chronological: expected {expected_window}, got {window_index}"
                        )
                    prediction, runtime = predictor.forward_frame_with_runtime(
                        example.history[-1],
                        state_normalizer=state_normalizer,
                        target_normalizer=target_normalizer,
                        runtime=recurrent_runtimes[example.trajectory_id],
                    )
                recurrent_runtimes[example.trajectory_id] = runtime
                recurrent_last_window[example.trajectory_id] = window_index
            else:
                prediction = predictor.predict(example.history)
            target = validate_public_state_vector(example.target_state, name="evaluation target")
            results.append(EvaluationCaseResult(example.window_id, tuple(prediction), tuple(target)))
        except EvaluationDeadlineError as exc:
            failures.append(
                {
                    "case_index": index,
                    "window_id": example.window_id,
                    "stage": "case",
                    "error": str(exc),
                    "type": type(exc).__name__,
                }
            )
            status = "partial_deadline_exhausted"
            break
        except (PredictorContractError, ValueError, FloatingPointError) as exc:
            failures.append(
                {
                    "case_index": index,
                    "window_id": example.window_id,
                    "error": str(exc),
                    "type": type(exc).__name__,
                }
            )
            status = "partial_case_failure"
            break
    # Do not aggregate partial results as if the requested evaluation finished.
    if status != "complete":
        return partial_result(status, failures, len(results))
    try:
        if deadline is not None:
            deadline.check("before_metric_aggregation")
        metrics = _prediction_metrics(
            [np.asarray(result.prediction) for result in results],
            [np.asarray(result.target) for result in results],
            target_normalizer=target_normalizer,
            deadline=deadline,
        )
        if deadline is not None:
            deadline.check("after_metric_aggregation")
    except EvaluationDeadlineError as exc:
        failures.append({"stage": "metric_aggregation", "error": str(exc), "type": type(exc).__name__})
        return partial_result("partial_deadline_exhausted", failures, len(results))
    except (PredictorContractError, ValueError, FloatingPointError) as exc:
        failures.append({"stage": "metric_aggregation", "error": str(exc), "type": type(exc).__name__})
        return partial_result("partial_metric_failure", failures, len(results))
    return {
        "schema": EVALUATION_SCHEMA,
        "split": split,
        "status": status,
        "cases_requested": len(examples),
        "cases_completed": len(results),
        "failures": failures,
        "metrics": metrics,
    }


def evaluate_paired_variants(
    predictors: Mapping[str, Any],
    examples: Sequence[TransitionExample],
    *,
    split: str,
    state_normalizer: TrainOnlyNormalizer | None = None,
    target_normalizer: TrainOnlyNormalizer | None = None,
    deadline: SharedDeadline,
    allow_final_test: bool = False,
    development_frozen: bool = False,
    checkpoint_provenance: Mapping[str, Mapping[str, Any]] | None = None,
    expected_provenance: Mapping[str, Any] | None = None,
    reviewed_selection_artifact: Mapping[str, Any] | None = None,
    expected_split_manifest_sha256: str | None = None,
    expected_experiment_config_sha256: str | None = None,
    expected_selected_checkpoints: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Evaluate paired variants under one deadline and selection boundary."""

    if len(predictors) != 2:
        raise PredictorContractError("paired evaluation requires exactly two variants")
    if not isinstance(deadline, SharedDeadline):
        raise PredictorContractError("paired evaluation requires one SharedDeadline")
    variants: dict[str, Any] = {}
    for name in sorted(predictors):
        try:
            deadline.check(f"before_paired_variant_{name}")
            variant_expected_provenance = expected_provenance
            if isinstance(expected_provenance, Mapping) and isinstance(expected_provenance.get(name), Mapping):
                variant_expected_provenance = expected_provenance[name]
            result = evaluate_examples(
                predictors[name],
                examples,
                split=split,
                state_normalizer=state_normalizer,
                target_normalizer=target_normalizer,
                allow_final_test=allow_final_test,
                development_frozen=development_frozen,
                deadline=deadline,
                checkpoint_provenance=(checkpoint_provenance or {}).get(name),
                expected_provenance=variant_expected_provenance,
                reviewed_selection_artifact=reviewed_selection_artifact,
                expected_split_manifest_sha256=expected_split_manifest_sha256,
                expected_experiment_config_sha256=expected_experiment_config_sha256,
                expected_selected_checkpoints=expected_selected_checkpoints,
            )
        except EvaluationDeadlineError as exc:
            result = {
                "schema": EVALUATION_SCHEMA,
                "split": split,
                "status": "partial_deadline_exhausted",
                "cases_requested": len(examples),
                "cases_completed": 0,
                "failures": [{"stage": "paired_variant", "error": str(exc), "type": type(exc).__name__}],
                "metrics": None,
            }
        variants[name] = result
        if result.get("status") != "complete":
            return {
                "schema": EVALUATION_SCHEMA,
                "status": "incomplete_shared_deadline",
                "selection_eligible": False,
                "paired_variant_timeout_policy": "one incomplete variant invalidates the pair",
                "variants": variants,
            }
    try:
        deadline.check("after_paired_variants")
    except EvaluationDeadlineError as exc:
        return {
            "schema": EVALUATION_SCHEMA,
            "status": "incomplete_shared_deadline",
            "selection_eligible": False,
            "paired_variant_timeout_policy": "one incomplete variant invalidates the pair",
            "failures": [{"stage": "paired_boundary", "error": str(exc), "type": type(exc).__name__}],
            "variants": variants,
        }
    return {
        "schema": EVALUATION_SCHEMA,
        "status": "complete",
        "selection_eligible": True,
        "paired_variant_timeout_policy": "one incomplete variant invalidates the pair",
        "variants": variants,
    }


def recursive_rollout(
    predictor: Any,
    initial_history: Sequence[PredictorFrame],
    actions: Sequence[PlannerAction],
    *,
    state_normalizer: TrainOnlyNormalizer | None = None,
    target_normalizer: TrainOnlyNormalizer | None = None,
    horizon: int,
    deadline: SharedDeadline | None = None,
) -> tuple[np.ndarray, ...]:
    """Roll out recursively, feeding predictions rather than future targets."""

    if len(initial_history) != HISTORY_LENGTH:
        raise PredictorContractError("rollout initial history has the wrong length")
    if type(horizon) is not int or horizon not in ROLL_OUT_HORIZONS:
        raise PredictorContractError("rollout horizon is outside the preregistered set")
    if len(actions) < horizon:
        raise PredictorContractError("rollout action sequence is shorter than its horizon")
    if deadline is not None:
        deadline.check("rollout_start")
    history = list(initial_history)
    runtime = None
    predictions: list[np.ndarray] = []
    for action_index in range(horizon):
        if deadline is not None:
            deadline.check(f"rollout_before_case_{action_index}")
        frame_history: tuple[PredictorFrame, ...] | None = None
        next_frame: PredictorFrame | None = None
        if action_index == 0:
            # The initial public history supplies context, while the caller's
            # first action is the action actually being forecast.  This keeps
            # action conditioning explicit rather than silently reusing the
            # historical action stored in the last context frame.
            current_frame = PredictorFrame(
                history[-1].state,
                tuple(actions[0].drive_vector),
                actions[0].duration_ticks,
            )
            frame_history = (history[-2], current_frame)
            history = list(frame_history)
        else:
            next_frame = PredictorFrame(
                tuple(predictions[-1]),
                tuple(actions[action_index].drive_vector),
                actions[action_index].duration_ticks,
            )
            history = [history[-1], next_frame]
        if isinstance(predictor, LearnedObservablePredictor):
            if state_normalizer is None or target_normalizer is None:
                raise PredictorContractError("learned rollout requires train-only normalizers")
            if action_index == 0:
                assert frame_history is not None
                prediction, runtime = predictor.forward_with_runtime(
                    frame_history,
                    state_normalizer=state_normalizer,
                    target_normalizer=target_normalizer,
                    runtime=runtime,
                )
            else:
                assert next_frame is not None and runtime is not None
                prediction, runtime = predictor.forward_frame_with_runtime(
                    next_frame,
                    state_normalizer=state_normalizer,
                    target_normalizer=target_normalizer,
                    runtime=runtime,
                )
        else:
            assert frame_history is not None or next_frame is not None
            if frame_history is None:
                frame_history = tuple(history)
            prediction = predictor.predict(frame_history)
        validate_public_state_vector(prediction, name=f"rollout prediction {action_index}")
        predictions.append(prediction)
        if deadline is not None:
            deadline.check(f"rollout_after_case_{action_index}")
    if deadline is not None:
        deadline.check("rollout_complete")
    return tuple(predictions)


def _runner_failure(stage: str, exc: BaseException, **fields: Any) -> dict[str, Any]:
    failure = {
        "stage": stage,
        "error": str(exc),
        "type": type(exc).__name__,
    }
    failure.update(fields)
    return failure


def _checkpoint_file_sha256(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _checkpoint_provenance(
    payload: Mapping[str, Any],
    *,
    checkpoint_sha256: str,
) -> dict[str, Any]:
    required = (
        "split_manifest_sha256",
        "experiment_config_sha256",
        "state_normalizer_sha256",
        "target_normalizer_sha256",
    )
    provenance = {
        "split_manifest_sha256": payload.get("split_manifest_sha256"),
        "experiment_config_sha256": payload.get("experiment_config_sha256"),
        "state_normalizer_sha256": payload.get("state_normalizer_provenance_sha256"),
        "target_normalizer_sha256": payload.get("target_normalizer_provenance_sha256"),
        "checkpoint_sha256": checkpoint_sha256,
    }
    if any(provenance[name] in (None, "") for name in required):
        raise CheckpointContractError("loaded checkpoint provenance is incomplete")
    return provenance


def _check_prediction_parity(
    original: LearnedObservablePredictor,
    restored: LearnedObservablePredictor,
    example: TransitionExample,
    *,
    state_normalizer: TrainOnlyNormalizer,
    target_normalizer: TrainOnlyNormalizer,
    restored_state_normalizer: TrainOnlyNormalizer,
    restored_target_normalizer: TrainOnlyNormalizer,
    deadline: SharedDeadline,
) -> dict[str, Any]:
    deadline.check("checkpoint_prediction_parity_before")
    original_prediction = original.forward(
        example.history,
        state_normalizer=state_normalizer,
        target_normalizer=target_normalizer,
    )
    deadline.check("checkpoint_prediction_parity_after_original")
    restored_prediction = restored.forward(
        example.history,
        state_normalizer=restored_state_normalizer,
        target_normalizer=restored_target_normalizer,
    )
    deadline.check("checkpoint_prediction_parity_after_reload")
    if not np.array_equal(original_prediction, restored_prediction):
        raise CheckpointContractError("checkpoint prediction parity mismatch")
    original_digest = _sha256(np.asarray(original_prediction, dtype=np.float64).tolist())
    restored_digest = _sha256(np.asarray(restored_prediction, dtype=np.float64).tolist())
    return {
        "status": "passed",
        "exact": True,
        "checked_window_id": example.window_id,
        "original_prediction_sha256": original_digest,
        "reloaded_prediction_sha256": restored_digest,
    }


def _evaluate_development_model(
    model: LearnedObservablePredictor,
    development_trajectories: Sequence[Trajectory],
    development_examples: Sequence[TransitionExample],
    *,
    state_normalizer: TrainOnlyNormalizer,
    target_normalizer: TrainOnlyNormalizer,
    checkpoint_provenance: Mapping[str, Any],
    expected_provenance: Mapping[str, Any],
    deadline: SharedDeadline,
) -> dict[str, Any]:
    """Evaluate one reloaded learned predictor without touching final test."""

    one_step = evaluate_examples(
        model,
        development_examples,
        split="development",
        state_normalizer=state_normalizer,
        target_normalizer=target_normalizer,
        deadline=deadline,
        checkpoint_provenance=checkpoint_provenance,
        expected_provenance=expected_provenance,
    )
    if one_step.get("status") != "complete":
        return {
            "status": one_step.get("status", "partial_case_failure"),
            "one_step": one_step,
            "rollout": None,
            "metrics": None,
            "failures": list(one_step.get("failures", [])),
        }

    predictions_by_horizon: dict[int, list[np.ndarray]] = {horizon: [] for horizon in ROLL_OUT_HORIZONS}
    targets_by_horizon: dict[int, list[np.ndarray]] = {horizon: [] for horizon in ROLL_OUT_HORIZONS}
    failures: list[dict[str, Any]] = []
    for trajectory_index, trajectory in enumerate(development_trajectories):
        try:
            deadline.check(f"development_rollout_before_trajectory_{trajectory_index}")
            first_history = trajectory.window_examples()[0].history
            actions = tuple(
                _action_from_drive(action, trajectory.duration_ticks)
                for action in trajectory.actions[1:]
            )
            for horizon in ROLL_OUT_HORIZONS:
                deadline.check(f"development_rollout_before_horizon_{trajectory_index}_{horizon}")
                predictions = recursive_rollout(
                    model,
                    first_history,
                    actions,
                    state_normalizer=state_normalizer,
                    target_normalizer=target_normalizer,
                    horizon=horizon,
                    deadline=deadline,
                )
                targets = trajectory.observations[HISTORY_LENGTH : HISTORY_LENGTH + horizon]
                predictions_by_horizon[horizon].extend(predictions)
                targets_by_horizon[horizon].extend(np.asarray(target, dtype=np.float64) for target in targets)
                deadline.check(f"development_rollout_after_horizon_{trajectory_index}_{horizon}")
        except EvaluationDeadlineError as exc:
            failures.append(_runner_failure("development_rollout", exc, trajectory_index=trajectory_index))
            return {
                "status": "partial_deadline_exhausted",
                "one_step": one_step,
                "rollout": None,
                "metrics": None,
                "failures": failures,
            }
        except (PredictorContractError, ValueError, FloatingPointError) as exc:
            failures.append(_runner_failure("development_rollout", exc, trajectory_index=trajectory_index))
            return {
                "status": "partial_case_failure",
                "one_step": one_step,
                "rollout": None,
                "metrics": None,
                "failures": failures,
            }

    try:
        deadline.check("development_rollout_before_metric_aggregation")
        rollout_metrics: dict[str, Any] = {}
        squared_rmse: list[float] = []
        for horizon in ROLL_OUT_HORIZONS:
            metric = _prediction_metrics(
                predictions_by_horizon[horizon],
                targets_by_horizon[horizon],
                target_normalizer=target_normalizer,
                deadline=deadline,
            )
            rollout_metrics[str(horizon)] = metric
            squared_rmse.append(float(metric["normalized_rmse"]) ** 2)
        deadline.check("development_rollout_after_metric_aggregation")
    except EvaluationDeadlineError as exc:
        return {
            "status": "partial_deadline_exhausted",
            "one_step": one_step,
            "rollout": None,
            "metrics": None,
            "failures": [_runner_failure("development_rollout_metric_aggregation", exc)],
        }
    except (PredictorContractError, ValueError, FloatingPointError) as exc:
        return {
            "status": "partial_metric_failure",
            "one_step": one_step,
            "rollout": None,
            "metrics": None,
            "failures": [_runner_failure("development_rollout_metric_aggregation", exc)],
        }
    return {
        "status": "complete",
        "one_step": one_step,
        "rollout": rollout_metrics,
        "metrics": {
            "development_normalized_mse": float(one_step["metrics"]["normalized_rmse"]) ** 2,
            "development_rollout_rmse": float(math.sqrt(np.mean(squared_rmse))),
            "one_step_normalized_rmse": float(one_step["metrics"]["normalized_rmse"]),
        },
        "failures": failures,
    }


def run_pilot_training(
    checkpoint_dir: str | Path,
    *,
    deadline: SharedDeadline | None = None,
    wall_clock_seconds: float = MAX_WALL_CLOCK_SECONDS,
) -> dict[str, Any]:
    """Run the frozen six-fit development pilot under one shared deadline.

    This function is executable but is intentionally not called by
    :func:`write_pilot_artifacts`.  It materializes train/development data
    only, performs exactly 100 updates for each geometry/seed pair when the
    shared cap permits, reloads each candidate before development evaluation,
    and never opens the reserved final-test split.
    """

    if deadline is not None and not isinstance(deadline, SharedDeadline):
        raise PredictorContractError("runner deadline must be a SharedDeadline")
    shared_deadline = deadline or SharedDeadline.from_seconds(wall_clock_seconds)
    checkpoint_root = Path(checkpoint_dir)
    result: dict[str, Any] = {
        "schema": PILOT_RUN_SCHEMA,
        "status": "not_started",
        "wall_clock_seconds": float(wall_clock_seconds),
        "updates_per_variant": TRAIN_UPDATES,
        "evaluation_every_updates": EVAL_EVERY_UPDATES,
        "paired_initialization_seeds": list(PAIRED_INITIALIZATION_SEEDS),
        "final_test_materialized": False,
        "final_test_selection_artifact": None,
        "pairs": [],
        "selection": None,
        "failures": [],
    }
    try:
        shared_deadline.check("runner_start")
        manifest = build_split_manifest()
        shared_deadline.check("after_split_manifest")
        config = pilot_experiment_config(split_manifest_sha256=manifest[MANIFEST_HASH_EXCLUSION])
        config_hash = _sha256(config)
        shared_deadline.check("after_experiment_config")
        train_trajectories = build_trajectories("train", include_test=False)
        development_trajectories = build_trajectories("development", include_test=False)
        shared_deadline.check("after_train_development_materialization")
        train_examples = tuple(
            example for trajectory in train_trajectories for example in trajectory.window_examples()
        )
        development_examples = tuple(
            example for trajectory in development_trajectories for example in trajectory.window_examples()
        )
        state_normalizer, target_normalizer = fit_train_normalizers(train_trajectories)
        shared_deadline.check("after_train_normalization")
        result["split_manifest_sha256"] = manifest[MANIFEST_HASH_EXCLUSION]
        result["experiment_config_sha256"] = config_hash
        result["normalizer_provenance"] = {
            "state_normalizer_sha256": state_normalizer.provenance_sha256,
            "target_normalizer_sha256": target_normalizer.provenance_sha256,
        }
        result["training_data"] = {
            "trajectory_count": len(train_trajectories),
            "window_count": len(train_examples),
            "development_trajectory_count": len(development_trajectories),
            "development_window_count": len(development_examples),
        }
    except EvaluationDeadlineError as exc:
        result["status"] = "incomplete_shared_deadline"
        result["failures"].append(_runner_failure("runner_setup", exc))
        return result
    except (PredictorContractError, ValueError, FloatingPointError) as exc:
        result["status"] = "partial_failure"
        result["failures"].append(_runner_failure("runner_setup", exc))
        return result

    common_expected_provenance = {
        "split_manifest_sha256": manifest[MANIFEST_HASH_EXCLUSION],
        "experiment_config_sha256": config_hash,
        "state_normalizer_sha256": state_normalizer.provenance_sha256,
        "target_normalizer_sha256": target_normalizer.provenance_sha256,
    }
    selection_records: list[dict[str, Any]] = []
    for seed in PAIRED_INITIALIZATION_SEEDS:
        pair: dict[str, Any] = {
            "init_seed": seed,
            "status": "not_started",
            "updates_completed": 0,
            "variants": {},
            "failures": [],
        }
        models = {
            "learned_geometry_off": LearnedObservablePredictor(init_seed=seed, geometry_enabled=False),
            "learned_geometry_on": LearnedObservablePredictor(init_seed=seed, geometry_enabled=True),
        }
        try:
            for update_index in range(1, TRAIN_UPDATES + 1):
                shared_deadline.check(f"before_paired_update_seed_{seed}_{update_index}")
                trajectory = train_trajectories[(update_index - 1) % len(train_trajectories)]
                gradients: dict[str, dict[str, np.ndarray]] = {}
                losses: dict[str, float] = {}
                for name in ("learned_geometry_off", "learned_geometry_on"):
                    shared_deadline.check(f"before_gradient_seed_{seed}_{update_index}_{name}")
                    losses[name], gradients[name] = models[name].loss_and_gradients(
                        trajectory,
                        state_normalizer=state_normalizer,
                        target_normalizer=target_normalizer,
                    )
                    shared_deadline.check(f"after_gradient_seed_{seed}_{update_index}_{name}")
                # Both gradients have been fully computed before either model
                # is committed.  The per-model update itself stages all
                # parameters before mutating them.
                shared_deadline.check(f"before_paired_commit_seed_{seed}_{update_index}")
                update_info = {}
                for name in ("learned_geometry_off", "learned_geometry_on"):
                    update_info[name] = models[name].apply_gradients(
                        gradients[name],
                        learning_rate=LEARNING_RATE,
                    )
                pair["updates_completed"] = update_index
                pair["last_update_losses"] = losses
                pair["last_update"] = update_info
                shared_deadline.check(f"after_paired_update_seed_{seed}_{update_index}")

            shared_deadline.check(f"before_checkpoint_boundary_seed_{seed}")
            loaded_models: dict[str, LearnedObservablePredictor] = {}
            loaded_normalizers: dict[str, tuple[TrainOnlyNormalizer, TrainOnlyNormalizer]] = {}
            loaded_provenance: dict[str, dict[str, Any]] = {}
            parity: dict[str, Any] = {}
            for name in ("learned_geometry_off", "learned_geometry_on"):
                checkpoint_path = checkpoint_root / f"{name}-seed-{seed}.json"
                checkpoint_sha256 = save_checkpoint(
                    checkpoint_path,
                    models[name],
                    state_normalizer=state_normalizer,
                    target_normalizer=target_normalizer,
                    split_manifest_sha256=manifest[MANIFEST_HASH_EXCLUSION],
                    experiment_config_sha256=config_hash,
                    selection={"split": "development", "selection_frozen": False, "init_seed": seed, "variant": name},
                    deadline=shared_deadline,
                )
                restored, restored_state, restored_target, payload = load_checkpoint(
                    checkpoint_path,
                    expected_split_manifest_sha256=manifest[MANIFEST_HASH_EXCLUSION],
                    expected_experiment_config_sha256=config_hash,
                    expected_state_normalizer_provenance_sha256=state_normalizer.provenance_sha256,
                    expected_target_normalizer_provenance_sha256=target_normalizer.provenance_sha256,
                    expected_checkpoint_sha256=checkpoint_sha256,
                    deadline=shared_deadline,
                )
                loaded_models[name] = restored
                loaded_normalizers[name] = (restored_state, restored_target)
                loaded_provenance[name] = _checkpoint_provenance(
                    payload,
                    checkpoint_sha256=checkpoint_sha256,
                )
                parity[name] = _check_prediction_parity(
                    models[name],
                    restored,
                    train_examples[0],
                    state_normalizer=state_normalizer,
                    target_normalizer=target_normalizer,
                    restored_state_normalizer=restored_state,
                    restored_target_normalizer=restored_target,
                    deadline=shared_deadline,
                )
                shared_deadline.check(f"after_checkpoint_reload_seed_{seed}_{name}")

            evaluations: dict[str, Any] = {}
            pair_status = "complete"
            for name in ("learned_geometry_off", "learned_geometry_on"):
                shared_deadline.check(f"before_development_evaluation_seed_{seed}_{name}")
                expected = {**common_expected_provenance, "checkpoint_sha256": loaded_provenance[name]["checkpoint_sha256"]}
                evaluations[name] = _evaluate_development_model(
                    loaded_models[name],
                    development_trajectories,
                    development_examples,
                    state_normalizer=loaded_normalizers[name][0],
                    target_normalizer=loaded_normalizers[name][1],
                    checkpoint_provenance=loaded_provenance[name],
                    expected_provenance=expected,
                    deadline=shared_deadline,
                )
                if evaluations[name].get("status") != "complete":
                    pair_status = "incomplete_shared_deadline" if evaluations[name].get("status") == "partial_deadline_exhausted" else "partial_failure"
                    break
            shared_deadline.check(f"after_development_pair_seed_{seed}")
            pair["parity"] = parity
            pair["evaluations"] = evaluations
            pair["checkpoints"] = {
                name: {
                    "path": str(checkpoint_root / f"{name}-seed-{seed}.json"),
                    "checkpoint_sha256": loaded_provenance[name]["checkpoint_sha256"],
                    "provenance": loaded_provenance[name],
                }
                for name in loaded_provenance
            }
            if pair_status != "complete":
                pair["status"] = pair_status
                pair["failures"].extend(
                    failure
                    for evaluation in evaluations.values()
                    for failure in evaluation.get("failures", [])
                )
                result["pairs"].append(pair)
                result["status"] = pair_status
                if pair["failures"]:
                    result["failures"].extend(pair["failures"])
                else:
                    result["failures"].append(
                        {
                            "stage": "paired_development_evaluation",
                            "error": "paired evaluation incomplete",
                            "type": pair_status,
                            "init_seed": seed,
                        }
                    )
                break
            pair["status"] = "complete"
            result["pairs"].append(pair)
            for name, evaluation in evaluations.items():
                selection_records.append(
                    {
                        "status": "complete",
                        "variant": name,
                        "init_seed": seed,
                        "development_normalized_mse": evaluation["metrics"]["development_normalized_mse"],
                        "development_rollout_rmse": evaluation["metrics"]["development_rollout_rmse"],
                        "checkpoint_sha256": loaded_provenance[name]["checkpoint_sha256"],
                        "checkpoint_path": str(checkpoint_root / f"{name}-seed-{seed}.json"),
                        "state_normalizer_provenance_sha256": state_normalizer.provenance_sha256,
                        "target_normalizer_provenance_sha256": target_normalizer.provenance_sha256,
                        "split_manifest_sha256": manifest[MANIFEST_HASH_EXCLUSION],
                        "experiment_config_sha256": config_hash,
                    }
                )
        except EvaluationDeadlineError as exc:
            pair["status"] = "incomplete_shared_deadline"
            pair["failures"].append(_runner_failure("paired_training_or_serialization", exc, init_seed=seed))
            result["pairs"].append(pair)
            result["status"] = "incomplete_shared_deadline"
            result["failures"].append(pair["failures"][-1])
            break
        except (PredictorContractError, ValueError, FloatingPointError) as exc:
            pair["status"] = "partial_failure"
            pair["failures"].append(_runner_failure("paired_training_or_serialization", exc, init_seed=seed))
            result["pairs"].append(pair)
            result["status"] = "partial_failure"
            result["failures"].append(pair["failures"][-1])
            break

    if result["status"] == "not_started" or all(pair.get("status") == "complete" for pair in result["pairs"]):
        try:
            shared_deadline.check("before_development_selection")
            selected = select_development_checkpoint(selection_records, deadline=shared_deadline)
            result["selection"] = {
                "status": "development_selected",
                "selected_record": selected,
                "final_test_unlocked": False,
                "selection_artifact": None,
            }
            shared_deadline.check("after_development_selection")
            result["status"] = "complete_development_pilot_final_test_closed"
        except EvaluationDeadlineError as exc:
            result["status"] = "incomplete_shared_deadline"
            result["failures"].append(_runner_failure("development_selection", exc))
        except (PredictorContractError, ValueError, FloatingPointError) as exc:
            result["status"] = "partial_failure"
            result["failures"].append(_runner_failure("development_selection", exc))
    result["selection_records"] = selection_records
    result["selection_eligible"] = result["status"] == "complete_development_pilot_final_test_closed"
    return result


def _timing_summary(values: Sequence[float]) -> dict[str, float]:
    array = _finite_array(values, (len(values),), name="timing values")
    return {
        "mean_seconds": float(array.mean()),
        "median_seconds": float(np.percentile(array, 50)),
        "p95_seconds": float(np.percentile(array, 95)),
        "max_seconds": float(array.max()),
    }


def feasibility_probe(*, repeats: int = 3, deadline: SharedDeadline | None = None) -> dict[str, Any]:
    """Measure one-trajectory forward/loss/backward time on train data only.

    No optimizer update is performed and no development/test trajectory is
    materialized by this function.  The result is deliberately a micro/probe
    timing, not an end-to-end six-fit training estimate.
    """

    if type(repeats) is not int or repeats <= 0:
        raise PredictorContractError("feasibility repeats must be positive")
    train_trajectories = build_trajectories("train", include_test=False)
    probe_trajectory = train_trajectories[0]
    state_normalizer, target_normalizer = fit_train_normalizers(train_trajectories)
    timings: dict[str, Any] = {}
    for geometry_enabled in (False, True):
        model = LearnedObservablePredictor(init_seed=PAIRED_INITIALIZATION_SEEDS[0], geometry_enabled=geometry_enabled)
        forward_seconds = []
        backward_seconds = []
        for _ in range(repeats):
            if deadline is not None:
                deadline.check(f"feasibility_before_geometry_{geometry_enabled}")
            started = time.perf_counter()
            model.forward_trajectory(
                probe_trajectory,
                state_normalizer=state_normalizer,
                target_normalizer=target_normalizer,
            )
            forward_seconds.append(time.perf_counter() - started)
            started = time.perf_counter()
            model.loss_and_gradients(
                probe_trajectory,
                state_normalizer=state_normalizer,
                target_normalizer=target_normalizer,
            )
            backward_seconds.append(time.perf_counter() - started)
        if deadline is not None:
            deadline.check(f"feasibility_after_geometry_{geometry_enabled}")
        timings["geometry_on" if geometry_enabled else "geometry_off"] = {
            "forward_seconds": _timing_summary(forward_seconds),
            "loss_and_backward_seconds": _timing_summary(backward_seconds),
            "optimizer_updates": 0,
            "data_split": "train",
            "world_seed": probe_trajectory.world_seed,
            "trajectory_id": probe_trajectory.trajectory_id,
            "windows_in_probe": len(probe_trajectory.window_examples()),
            "final_test_used": False,
        }
    probe_optimizer_seconds = float(
        len(PAIRED_INITIALIZATION_SEEDS)
        * TRAIN_UPDATES
        * sum(
            timings[key]["loss_and_backward_seconds"]["mean_seconds"]
            for key in ("geometry_off", "geometry_on")
        )
    )
    return {
        "schema": "vevo.v03.learned-observable-cpu-feasibility.v1",
        "status": "probe_only_no_training",
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "numpy": np.__version__,
        "repeats": repeats,
        "train_trajectories_materialized": len(train_trajectories),
        "train_windows_materialized": len(train_trajectories) * (TRAJECTORY_ACTION_COUNT - HISTORY_LENGTH + 1),
        "probe_trajectories": 1,
        "probe_windows": len(probe_trajectory.window_examples()),
        "final_test_materialized": False,
        "timings": timings,
        "probe_scope": "one complete train trajectory per geometry variant; forward plus reverse-mode loss/backward only",
        "not_end_to_end_training_estimate": True,
        "end_to_end_training_estimate": None,
        "probe_based_six_fit_optimizer_seconds": probe_optimizer_seconds,
        "timing_note": "Probe-based optimizer lower bound only; excludes paired overhead, development evaluation, checkpoint reload, and serialization. The runner reports actual elapsed time when explicitly invoked.",
        "runner_budget": {
            "fit_count": len(PAIRED_INITIALIZATION_SEEDS) * 2,
            "updates_per_variant_seed": TRAIN_UPDATES,
            "eval_every_updates": EVAL_EVERY_UPDATES,
            "shared_wall_clock_seconds": MAX_WALL_CLOCK_SECONDS,
        },
        "estimate_excludes": ["all_optimizer_updates", "paired_initialization_seed_sweep", "development_evaluation", "checkpoint_reload", "serialization", "final_test"],
    }


def write_pilot_artifacts(output_dir: str | Path, *, repeats: int = 3) -> dict[str, str]:
    """Write only new review artifacts; no checkpoint or training output."""

    deadline = SharedDeadline.from_seconds(MAX_WALL_CLOCK_SECONDS)
    target = Path(output_dir)
    target.mkdir(parents=True, exist_ok=True)
    deadline.check("serialization_start")
    manifest = build_split_manifest()
    deadline.check("after_manifest_generation")
    config = pilot_experiment_config(split_manifest_sha256=manifest[MANIFEST_HASH_EXCLUSION])
    deadline.check("after_config_generation")
    timing = feasibility_probe(repeats=repeats, deadline=deadline)
    deadline.check("after_feasibility_probe")
    readme = (
        "# v0.3 learned public-observable predictor pilot\n\n"
        "Status: implementation/configuration feasibility checkpoint only. "
        "No training, optimizer update, learned checkpoint, final-test metric, "
        "or closed-loop planning evaluation was run.\n\n"
        f"- Predictor schema: `{LEARNED_PREDICTOR_SCHEMA}`\n"
        f"- Split manifest SHA-256: `{manifest[MANIFEST_HASH_EXCLUSION]}`\n"
        "- Training data: 8 complete trajectories and 88 windows; the manifest covers 32 trajectories and 352 windows across all split metadata.\n"
        f"- Probe-based optimizer lower bound for six fits × 100 updates: `{timing['probe_based_six_fit_optimizer_seconds']:.3f}` seconds; this excludes evaluation, checkpoint, and serialization overhead.\n"
        "- Existing upstream gate: the all-four-models `8/8` training gate remains required before development evaluation; this pilot does not rerun or claim that gate.\n"
        "- Development cases: worlds 9300--9307, explicitly inspected development only; never fresh generalization.\n"
        "- Final test: default materialization is closed; the 9400--9407 inputs were generated before this review and are recorded only as exposure history (the old `phase_shifted` condition was calibration-only), while replacement worlds 9500--9507 remain reserved.\n"
        "- Final-test unlock: requires a digest-verified frozen selection artifact bound exactly to the manifest, config, and selected checkpoint files.\n"
        "- Runner contract: six learned fits (geometry on/off × seeds 7, 17, 37), 100 equal updates per variant/seed, one shared 300-second cap, and one development evaluation boundary at update 100.\n"
        "- Normalizer/checkpoint provenance: canonical mean/scale plus train-source digests are verified on reload; prediction parity is checked before development evaluation.\n"
        "- Old reports/checkpoints: untouched.\n\n"
        "The CPU probe measures one complete train-world trajectory per paired "
        "geometry variant and performs forward plus reverse-mode loss/backward "
        "only; it performs zero optimizer updates. This is a micro/probe timing, "
        "not an end-to-end training estimate.\n"
    )
    runner_review = (
        "# Learned predictor runner source review\n\n"
        "Status: concrete runner implemented; it was not invoked for this artifact.\n\n"
        f"- Scope: six learned fits (geometry on/off × seeds `{', '.join(str(seed) for seed in PAIRED_INITIALIZATION_SEEDS)}`), "
        f"exactly `{TRAIN_UPDATES}` equal SGD updates per variant/seed, and evaluation at update `{EVAL_EVERY_UPDATES}`.\n"
        f"- Budget: one cooperative shared `{MAX_WALL_CLOCK_SECONDS}`-second deadline across setup, paired updates, development cases, "
        "checkpoint save/reload, parity, aggregation, selection, and serialization.\n"
        "- Paired timeout: an incomplete variant invalidates the pair; no selection or final-test access is emitted.\n"
        "- Checkpoint safety: normalizer digests cover canonical mean/scale plus training-source provenance; reloaded predictions require exact parity.\n"
        "- Optimizer safety: all gradients and updated arrays are validated before an atomic parameter commit.\n"
        "- Final test: replacement worlds 9500--9507 remain metadata-only and closed; a canonical digest-bound frozen selection artifact is required.\n"
        "- Development: worlds 9300--9307 are inspected development cases only, never fresh generalization.\n"
        f"- Timing: the probe-based optimizer lower bound is `{timing['probe_based_six_fit_optimizer_seconds']:.3f}` seconds before overhead; an invoked runner must report actual elapsed time.\n"
        "- Historical reports and checkpoints were not modified.\n"
    )
    files: dict[str, Any] = {
        "experiment_config.json": config,
        "split_manifest.json": manifest,
        "cpu_feasibility.json": timing,
        "README.md": readme,
        "runner_review.md": runner_review,
    }
    hashes: dict[str, str] = {}
    for name, value in files.items():
        deadline.check(f"serialization_before_{name}")
        path = target / name
        if isinstance(value, str):
            encoded = value
        else:
            encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
        path.write_text(encoded, encoding="utf-8")
        hashes[name] = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    deadline.check("serialization_after_pilot_files")
    checkpoint_dir = target.parent.parent / "storage" / "checkpoints" / "v03-learned-predictor-pilot"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_readme = checkpoint_dir / "README.md"
    if not checkpoint_readme.exists():
        checkpoint_readme.write_text(
            "# Learned predictor pilot checkpoints\n\n"
            "No checkpoint has been created. Training is gated on source/configuration review.\n",
            encoding="utf-8",
        )
    hashes["checkpoint_README.md"] = hashlib.sha256(checkpoint_readme.read_bytes()).hexdigest()
    return hashes


def _cli() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-pilot-artifacts", type=Path, required=True)
    parser.add_argument("--feasibility-repeats", type=int, default=3)
    args = parser.parse_args()
    print(json.dumps(write_pilot_artifacts(args.write_pilot_artifacts, repeats=args.feasibility_repeats), sort_keys=True, indent=2))


if __name__ == "__main__":
    _cli()


__all__ = [
    "ACTION_DRIVE_SCALE",
    "ARTIFACT_SCHEMA",
    "CHECKPOINT_SCHEMA",
    "CONSTRAINT_NEIGHBOR_THRESHOLD",
    "CONSTRAINT_SUPPLIED_WORK_THRESHOLD",
    "DATASET_SCHEMA",
    "DEVELOPMENT_WORLD_SEEDS",
    "EvaluationDeadlineError",
    "EvaluationReservationError",
    "HISTORY_LENGTH",
    "LEARNED_PREDICTOR_SCHEMA",
    "LearnedObservablePredictor",
    "LinearObservableBaseline",
    "NominalSimulatorBaseline",
    "NormalizerContractError",
    "PAIRED_INITIALIZATION_SEEDS",
    "PILOT_RUN_SCHEMA",
    "PILOT_SPLITS",
    "PUBLIC_STATE_DIM",
    "PUBLIC_STATE_FIELDS",
    "PUBLIC_STATE_UNITS",
    "PersistenceBaseline",
    "PredictorContractError",
    "PredictorFrame",
    "RolloutBoundsError",
    "SELECTION_ARTIFACT_SCHEMA",
    "SharedDeadline",
    "TrainOnlyNormalizer",
    "TransitionExample",
    "build_examples",
    "build_frozen_selection_artifact",
    "build_trajectories",
    "build_split_manifest",
    "compute_audit",
    "evaluate_examples",
    "evaluate_paired_variants",
    "feasibility_probe",
    "fit_train_normalizers",
    "generate_trajectory",
    "load_checkpoint",
    "pilot_experiment_config",
    "parameter_accounting",
    "public_observation_to_vector",
    "public_vector_to_observation",
    "recursive_rollout",
    "run_pilot_training",
    "save_checkpoint",
    "selection_artifact_digest",
    "select_development_checkpoint",
    "split_spec",
    "validate_public_state_vector",
    "verify_split_manifest",
    "verify_frozen_selection_artifact",
    "write_pilot_artifacts",
]
