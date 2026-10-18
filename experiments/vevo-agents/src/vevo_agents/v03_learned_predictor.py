"""Versioned learned public-observable predictor pilot contract.

This module is a reviewable experiment boundary, not a training runner.  It
uses the existing four-peripheral/one-center hybrid core as a recurrent
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

The actual optimizer loop is intentionally absent.  A later, separately
reviewed runner may consume :func:`pilot_experiment_config` and
:func:`save_checkpoint` after the source/configuration review.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
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

HEAD_SEED_SALT = 0x4C504844
ACTION_SEED_SALT = 0x4143544E
MANIFEST_HASH_EXCLUSION = "manifest_sha256"
HEAD_NORMALIZED_LIMIT = 3.0
ACTION_DRIVE_SCALE = 0.20
MAX_ACTION_DURATION_TICKS = PLANNER_ACTION_DURATION_TICKS
HISTORY_LENGTH = 2
TRAJECTORY_ACTION_COUNT = 12
ROLL_OUT_HORIZONS = (2, 4)
TRAIN_UPDATES = 1_000
BATCH_SIZE = 1
LEARNING_RATE = 1.0e-3
EVAL_EVERY_UPDATES = 100
MAX_WALL_CLOCK_SECONDS = 300
PAIRED_INITIALIZATION_SEEDS = (7, 17, 37)

# These eight worlds are explicitly inspected development cases, not a fresh
# generalization set.  They are kept separate from the train and test seeds.
TRAIN_WORLD_SEEDS = tuple(range(100, 108))
DEVELOPMENT_WORLD_SEEDS = tuple(range(9300, 9308))
TEST_WORLD_SEEDS = tuple(range(9400, 9408))

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


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _sha256(value: Any) -> str:
    payload = value if isinstance(value, bytes) else _canonical_bytes(value)
    return hashlib.sha256(payload).hexdigest()


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
    "phase_shifted": WorldCondition("phase_shifted", phase_offset=0.35),
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
        ("phase_shifted", "frequency_shifted"),
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


def generate_trajectory(spec: SplitSpec, seed: int, condition_name: str) -> Trajectory:
    if seed not in spec.world_seeds or condition_name not in spec.condition_names:
        raise PredictorContractError("trajectory request is outside its split specification")
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


def build_trajectories(split: str, *, include_test: bool = True) -> tuple[Trajectory, ...]:
    if split == "test" and not include_test:
        raise EvaluationReservationError("test trajectory materialization was disabled")
    spec = split_spec(split)
    return tuple(
        generate_trajectory(spec, seed, condition_name)
        for seed in spec.world_seeds
        for condition_name in spec.condition_names
    )


def build_examples(split: str, *, include_test: bool = True) -> tuple[TransitionExample, ...]:
    return tuple(
        example
        for trajectory in build_trajectories(split, include_test=include_test)
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
        for trajectory in build_trajectories(spec.name, include_test=True)
    ]
    summaries = [_manifest_trajectory_summary(trajectory) for trajectory in trajectories]
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
            "final_test_metrics_written": False,
            "final_test_data_used_for_cpu_feasibility": False,
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

    def as_dict(self) -> dict[str, Any]:
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

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "TrainOnlyNormalizer":
        return cls(
            tuple(payload["component_names"]),
            tuple(payload["units"]),
            tuple(payload["mean"]),
            tuple(payload["scale"]),
            str(payload["fit_split"]),
            int(payload["fit_sample_count"]),
            str(payload["train_value_sha256"]),
            str(payload.get("schema", "")),
        )


def fit_train_normalizers(
    examples: Sequence[TransitionExample],
) -> tuple[TrainOnlyNormalizer, TrainOnlyNormalizer]:
    if not examples or any(example.split != "train" for example in examples):
        raise NormalizerContractError("state/target normalizers require train-only examples")
    states = [frame.state for example in examples for frame in example.history]
    targets = [example.target_state for example in examples]
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
        raw = self.head_weight @ representation + self.head_bias
        prediction = _physical_prediction_numeric(raw, target_normalizer)
        validate_public_state_vector(prediction, name="predictor output")
        return prediction, next_runtime

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
        example: TransitionExample,
        *,
        state_normalizer: TrainOnlyNormalizer,
        target_normalizer: TrainOnlyNormalizer,
    ) -> tuple[float, dict[str, np.ndarray]]:
        """Physical-observable target loss and gradients; no optimizer update."""

        if example.split != "train":
            raise PredictorContractError("task-loss gradient probes require train examples")
        params = self.core.tensor_parameters(requires_grad=True)
        head_weight = Tensor(self.head_weight.copy(), requires_grad=True)
        head_bias = Tensor(self.head_bias.copy(), requires_grad=True)
        runtime = self.core.tensor_initial_runtime()
        trace = None
        for frame in example.history:
            runtime, trace = self.core.tensor_step(
                runtime,
                _core_input(frame, state_normalizer),
                dt=DEFAULT_DT,
                params=params,
            )
        if trace is None:
            raise PredictorContractError("cannot compute loss for empty history")
        representation = _tensor_representation(trace)
        raw = head_weight @ representation + head_bias
        physical_prediction = _physical_prediction_tensor(raw, target_normalizer)
        target_mean = Tensor(np.asarray(target_normalizer.mean, dtype=np.float64))
        target_scale = Tensor(np.asarray(target_normalizer.scale, dtype=np.float64))
        normalized_prediction = (physical_prediction - target_mean) / target_scale
        target = target_normalizer.transform(example.target_state)
        residual = normalized_prediction - target
        objective = (residual * residual).sum() / float(PUBLIC_STATE_DIM)
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
) -> None:
    """Save a complete, versioned checkpoint; not called by pilot setup."""

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
    temporary.write_text(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(target)


def load_checkpoint(
    path: str | Path,
) -> tuple[LearnedObservablePredictor, TrainOnlyNormalizer, TrainOnlyNormalizer, dict[str, Any]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("schema") != CHECKPOINT_SCHEMA:
        raise CheckpointContractError("checkpoint schema is incompatible")
    model = LearnedObservablePredictor(
        init_seed=int(payload["init_seed"]),
        geometry_enabled=bool(payload["geometry_enabled"]),
    )
    model.load_state_dict(payload)
    state_normalizer = TrainOnlyNormalizer.from_dict(payload["state_normalizer"])
    target_normalizer = TrainOnlyNormalizer.from_dict(payload["target_normalizer"])
    for key in ("split_manifest_sha256", "experiment_config_sha256"):
        if not payload.get(key):
            raise CheckpointContractError(f"checkpoint omits {key}")
    return model, state_normalizer, target_normalizer, dict(payload)


class PersistenceBaseline:
    name = "persistence"

    def predict(self, history: Sequence[PredictorFrame], **_: Any) -> np.ndarray:
        if not history:
            raise PredictorContractError("persistence baseline needs history")
        return validate_public_state_vector(history[-1].state, name="persistence output")


class LinearObservableBaseline:
    """Small public-state ridge baseline, fitted only on train examples."""

    name = "linear_public"

    def __init__(self, ridge: float = 1.0e-5):
        if not math.isfinite(ridge) or ridge <= 0.0:
            raise PredictorContractError("linear baseline ridge must be positive")
        self.ridge = ridge
        self.weight: np.ndarray | None = None

    @staticmethod
    def _features(history: Sequence[PredictorFrame]) -> np.ndarray:
        if len(history) != HISTORY_LENGTH:
            raise PredictorContractError("linear baseline history has the wrong length")
        frame = history[-1]
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

    def fit(self, examples: Sequence[TransitionExample]) -> "LinearObservableBaseline":
        if not examples or any(example.split != "train" for example in examples):
            raise PredictorContractError("linear baseline fitting requires train-only examples")
        x = np.vstack([self._features(example.history) for example in examples])
        y = np.vstack([example.target_state for example in examples])
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
        tick=0,
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
        "head_multiply_adds_per_prediction": PUBLIC_STATE_DIM * (REPRESENTATION_DIM + 1),
        "physics_ticks_per_dataset_action": MAX_ACTION_DURATION_TICKS,
        "rollout_horizons_actions": list(ROLL_OUT_HORIZONS),
        "batch_size": BATCH_SIZE,
        "training_updates_proposed": TRAIN_UPDATES,
        "paired_geometry_variants": 2,
        "paired_initialization_seeds": list(PAIRED_INITIALIZATION_SEEDS),
        "accounting_scope": "dataset generation, recurrent core forward, observable head, and recursive evaluation; no hidden simulator-frequency target calculation",
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
        "status": "implementation_and_configuration_only_no_training",
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
            "test_conditions": ["phase_shifted", "frequency_shifted"],
            "whole_trajectory_assignment": True,
            "no_overlapping_windows_across_splits": True,
            "final_test_reserved_until_development_freeze": True,
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
            "batch_size": BATCH_SIZE,
            "learning_rate": LEARNING_RATE,
            "optimizer": "fixed review proposal: bounded CPU update, implementation deferred until approval",
            "schedule": "existing core schedule unchanged",
            "same_data_updates_selection_geometry_on_off": True,
            "checkpoint_selection": "min_development_normalized_mse_then_min_development_rollout_rmse_then_lowest_init_seed",
            "checkpoint_directory": "storage/checkpoints/v03-learned-predictor-pilot/",
        },
        "rollout_evaluation": {
            "horizons_actions": list(ROLL_OUT_HORIZONS),
            "recursive": True,
            "teacher_forced_future_observations": False,
            "episode_runtime_reset": True,
            "out_of_bounds": "visible failure; no clipping or substitute predictor",
            "deadline_checks": "between cases and before metric aggregation; no metrics after budget exhaustion",
        },
        "metrics": {
            "per_component": ["mae", "rmse", "p50_abs", "p95_abs", "max_abs", "physical_unit"],
            "energy": ["target_energy_mae", "neighbor_energy_mae"],
            "supplied_work": ["mae"],
            "constraint_false_negative_rate": True,
            "closed_loop_planning_benefit": "deferred_and_separate_from_prediction_metrics",
        },
        "acceptance_thresholds": {
            "status": "proposed_before_training; development-only refinement must be frozen before final-test unlock",
            "paired_variant_comparison": "same seed and data; no geometry advantage inferred from unequal updates",
            "nonfinite_failures": 0,
            "rollout_bound_violations": 0,
            "one_step_normalized_rmse_max": 1.25,
            "rollout_horizon_2_normalized_rmse_max": 1.50,
            "rollout_horizon_4_normalized_rmse_max": 2.00,
            "target_or_neighbor_energy_mae_max": 0.25,
            "supplied_work_mae_max": 0.25,
            "constraint_false_negative_rate_max": 0.10,
        },
        "resource_budget": {
            "wall_clock_seconds": MAX_WALL_CLOCK_SECONDS,
            "cpu_only": True,
            "paid_resources": False,
            "credentials_or_network": False,
            "full_retraining_started": False,
        },
        "parameter_accounting": parameter_accounting(),
        "compute_audit": compute_audit(),
    }


def _prediction_metrics(predictions: Sequence[np.ndarray], targets: Sequence[np.ndarray]) -> dict[str, Any]:
    if len(predictions) != len(targets) or not predictions:
        raise PredictorContractError("prediction/target metric arrays are empty or mismatched")
    pred = np.vstack([validate_public_state_vector(value, name="metric prediction") for value in predictions])
    target = np.vstack([validate_public_state_vector(value, name="metric target") for value in targets])
    absolute = np.abs(pred - target)
    names, units = _component_names_and_units()
    per_component = {}
    for index, name in enumerate(names):
        values = absolute[:, index]
        per_component[name] = {
            "unit": units[index],
            "mae": float(values.mean()),
            "rmse": float(np.sqrt(np.mean((pred[:, index] - target[:, index]) ** 2))),
            "p50_abs": float(np.percentile(values, 50)),
            "p95_abs": float(np.percentile(values, 95)),
            "max_abs": float(values.max()),
        }
    target_energy = []
    neighbor_energy = []
    false_negatives = 0
    false_negative_denominator = 0
    for row_pred, row_target in zip(pred, target):
        for port in VALIDATED_PORTS:
            neighbors = (1,) if port == 0 else (0, 2)
            target_energy.append(abs(row_pred[LOCAL_ENERGY_START + port] - row_target[LOCAL_ENERGY_START + port]))
            neighbor_energy.extend(
                abs(row_pred[LOCAL_ENERGY_START + index] - row_target[LOCAL_ENERGY_START + index])
                for index in neighbors
            )
            actual_bad = (
                row_target[LOCAL_ENERGY_START + port] < 0.0
                or max(row_target[LOCAL_ENERGY_START + index] for index in neighbors) > 0.25
                or row_target[SUPPLIED_WORK_INDEX] > 0.25
            )
            predicted_ok = (
                row_pred[LOCAL_ENERGY_START + port] >= 0.0
                and max(row_pred[LOCAL_ENERGY_START + index] for index in neighbors) <= 0.25
                and row_pred[SUPPLIED_WORK_INDEX] <= 0.25
            )
            false_negatives += int(predicted_ok and actual_bad)
            false_negative_denominator += 1
    return {
        "schema": EVALUATION_SCHEMA,
        "sample_count": len(predictions),
        "per_component": per_component,
        "target_energy_mae": float(np.mean(target_energy)),
        "neighbor_energy_mae": float(np.mean(neighbor_energy)),
        "supplied_work_mae": float(np.mean(np.abs(pred[:, SUPPLIED_WORK_INDEX] - target[:, SUPPLIED_WORK_INDEX]))),
        "constraint_false_negative_rate": float(false_negatives / false_negative_denominator),
    }


@dataclass(frozen=True, slots=True)
class EvaluationCaseResult:
    window_id: str
    prediction: tuple[float, ...]
    target: tuple[float, ...]


def evaluate_examples(
    predictor: Any,
    examples: Sequence[TransitionExample],
    *,
    split: str,
    state_normalizer: TrainOnlyNormalizer | None = None,
    target_normalizer: TrainOnlyNormalizer | None = None,
    allow_final_test: bool = False,
    development_frozen: bool = False,
    deadline_monotonic: float | None = None,
) -> dict[str, Any]:
    if split == "test" and not (allow_final_test and development_frozen):
        raise EvaluationReservationError("final test is reserved until development choices are frozen")
    if split not in {"train", "development", "test"}:
        raise PredictorContractError("unknown evaluation split")
    if not examples or any(example.split != split for example in examples):
        raise PredictorContractError("evaluation examples do not match the requested split")
    results: list[EvaluationCaseResult] = []
    failures: list[dict[str, Any]] = []
    status = "complete"
    for index, example in enumerate(examples):
        if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
            status = "partial_deadline_exhausted"
            failures.append({"case_index": index, "window_id": example.window_id, "error": "deadline_exhausted"})
            break
        try:
            if isinstance(predictor, LearnedObservablePredictor):
                if state_normalizer is None or target_normalizer is None:
                    raise PredictorContractError("learned evaluation requires train-only normalizers")
                prediction = predictor.forward(
                    example.history,
                    state_normalizer=state_normalizer,
                    target_normalizer=target_normalizer,
                )
            else:
                prediction = predictor.predict(example.history)
            target = validate_public_state_vector(example.target_state, name="evaluation target")
            results.append(EvaluationCaseResult(example.window_id, tuple(prediction), tuple(target)))
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
        return {
            "schema": EVALUATION_SCHEMA,
            "split": split,
            "status": status,
            "cases_requested": len(examples),
            "cases_completed": len(results),
            "failures": failures,
            "metrics": None,
        }
    metrics = _prediction_metrics(
        [np.asarray(result.prediction) for result in results],
        [np.asarray(result.target) for result in results],
    )
    if isinstance(predictor, LearnedObservablePredictor) and target_normalizer is not None:
        normalized_errors = [
            target_normalizer.transform(result.prediction) - target_normalizer.transform(result.target)
            for result in results
        ]
        metrics["normalized_rmse"] = float(np.sqrt(np.mean(np.vstack(normalized_errors) ** 2)))
    return {
        "schema": EVALUATION_SCHEMA,
        "split": split,
        "status": status,
        "cases_requested": len(examples),
        "cases_completed": len(results),
        "failures": failures,
        "metrics": metrics,
    }


def recursive_rollout(
    predictor: Any,
    initial_history: Sequence[PredictorFrame],
    actions: Sequence[PlannerAction],
    *,
    state_normalizer: TrainOnlyNormalizer | None = None,
    target_normalizer: TrainOnlyNormalizer | None = None,
    horizon: int,
) -> tuple[np.ndarray, ...]:
    """Roll out recursively, feeding predictions rather than future targets."""

    if len(initial_history) != HISTORY_LENGTH:
        raise PredictorContractError("rollout initial history has the wrong length")
    if type(horizon) is not int or horizon not in ROLL_OUT_HORIZONS:
        raise PredictorContractError("rollout horizon is outside the preregistered set")
    if len(actions) < horizon:
        raise PredictorContractError("rollout action sequence is shorter than its horizon")
    history = list(initial_history)
    runtime = None
    predictions: list[np.ndarray] = []
    for action_index in range(horizon):
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
            frame_history = (history[-1], next_frame)
            history = list(frame_history)
        if isinstance(predictor, LearnedObservablePredictor):
            if state_normalizer is None or target_normalizer is None:
                raise PredictorContractError("learned rollout requires train-only normalizers")
            prediction, runtime = predictor.forward_with_runtime(
                frame_history,
                state_normalizer=state_normalizer,
                target_normalizer=target_normalizer,
                runtime=runtime,
            )
        else:
            prediction = predictor.predict(frame_history)
        validate_public_state_vector(prediction, name=f"rollout prediction {action_index}")
        predictions.append(prediction)
    return tuple(predictions)


def _timing_summary(values: Sequence[float]) -> dict[str, float]:
    array = _finite_array(values, (len(values),), name="timing values")
    return {
        "mean_seconds": float(array.mean()),
        "median_seconds": float(np.percentile(array, 50)),
        "p95_seconds": float(np.percentile(array, 95)),
        "max_seconds": float(array.max()),
    }


def feasibility_probe(*, repeats: int = 3) -> dict[str, Any]:
    """Measure forward/loss/backward time on train-world data only.

    No optimizer update is performed and no development/test trajectory is
    materialized by this function.
    """

    if type(repeats) is not int or repeats <= 0:
        raise PredictorContractError("feasibility repeats must be positive")
    train_examples = build_examples("train", include_test=False)
    probe_example = train_examples[0]
    state_normalizer, target_normalizer = fit_train_normalizers(train_examples)
    timings: dict[str, Any] = {}
    for geometry_enabled in (False, True):
        model = LearnedObservablePredictor(init_seed=PAIRED_INITIALIZATION_SEEDS[0], geometry_enabled=geometry_enabled)
        forward_seconds = []
        backward_seconds = []
        for _ in range(repeats):
            started = time.perf_counter()
            model.forward(
                probe_example.history,
                state_normalizer=state_normalizer,
                target_normalizer=target_normalizer,
            )
            forward_seconds.append(time.perf_counter() - started)
            started = time.perf_counter()
            model.loss_and_gradients(
                probe_example,
                state_normalizer=state_normalizer,
                target_normalizer=target_normalizer,
            )
            backward_seconds.append(time.perf_counter() - started)
        timings["geometry_on" if geometry_enabled else "geometry_off"] = {
            "forward_seconds": _timing_summary(forward_seconds),
            "loss_and_backward_seconds": _timing_summary(backward_seconds),
            "optimizer_updates": 0,
            "data_split": "train",
            "world_seed": probe_example.world_seed,
            "final_test_used": False,
        }
    estimated_seconds = sum(
        timings[name]["loss_and_backward_seconds"]["median_seconds"]
        * len(PAIRED_INITIALIZATION_SEEDS)
        * TRAIN_UPDATES
        for name in ("geometry_off", "geometry_on")
    )
    return {
        "schema": "vevo.v03.learned-observable-cpu-feasibility.v1",
        "status": "probe_only_no_training",
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "numpy": np.__version__,
        "repeats": repeats,
        "train_examples_materialized": len(train_examples),
        "probe_examples": 1,
        "final_test_materialized": False,
        "timings": timings,
        "estimate_formula": "paired_variants * paired_initialization_seeds * proposed_updates * median(loss_and_backward_seconds)",
        "proposed_paired_variants": 2,
        "proposed_paired_initialization_seeds": len(PAIRED_INITIALIZATION_SEEDS),
        "proposed_updates": TRAIN_UPDATES,
        "estimated_paired_training_seconds": float(estimated_seconds),
        "estimated_paired_training_minutes": float(estimated_seconds / 60.0),
        "estimated_within_wall_clock_budget": bool(estimated_seconds <= MAX_WALL_CLOCK_SECONDS),
        "estimate_excludes": ["development_evaluation", "checkpoint_serialization", "final_test"],
    }


def write_pilot_artifacts(output_dir: str | Path, *, repeats: int = 3) -> dict[str, str]:
    """Write only new review artifacts; no checkpoint or training output."""

    target = Path(output_dir)
    target.mkdir(parents=True, exist_ok=True)
    manifest = build_split_manifest()
    config = pilot_experiment_config(split_manifest_sha256=manifest[MANIFEST_HASH_EXCLUSION])
    timing = feasibility_probe(repeats=repeats)
    readme = (
        "# v0.3 learned public-observable predictor pilot\n\n"
        "Status: implementation/configuration feasibility checkpoint only. "
        "No training, optimizer update, learned checkpoint, final-test metric, "
        "or closed-loop planning evaluation was run.\n\n"
        f"- Predictor schema: `{LEARNED_PREDICTOR_SCHEMA}`\n"
        f"- Split manifest SHA-256: `{manifest[MANIFEST_HASH_EXCLUSION]}`\n"
        "- Development cases: worlds 9300--9307, explicitly inspected development only; never fresh generalization.\n"
        "- Final test: reserved; no final-test data was used in the CPU probe.\n"
        "- Old reports/checkpoints: untouched.\n\n"
        "The CPU probe measures one train-world example per paired geometry "
        "variant and performs forward plus reverse-mode loss/backward only; it "
        "performs zero optimizer updates.\n"
    )
    files: dict[str, Any] = {
        "experiment_config.json": config,
        "split_manifest.json": manifest,
        "cpu_feasibility.json": timing,
        "README.md": readme,
    }
    hashes: dict[str, str] = {}
    for name, value in files.items():
        path = target / name
        if isinstance(value, str):
            encoded = value
        else:
            encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
        path.write_text(encoded, encoding="utf-8")
        hashes[name] = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
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
    "DATASET_SCHEMA",
    "DEVELOPMENT_WORLD_SEEDS",
    "EvaluationReservationError",
    "HISTORY_LENGTH",
    "LEARNED_PREDICTOR_SCHEMA",
    "LearnedObservablePredictor",
    "LinearObservableBaseline",
    "NominalSimulatorBaseline",
    "PAIRED_INITIALIZATION_SEEDS",
    "PILOT_SPLITS",
    "PUBLIC_STATE_DIM",
    "PUBLIC_STATE_FIELDS",
    "PUBLIC_STATE_UNITS",
    "PersistenceBaseline",
    "PredictorContractError",
    "PredictorFrame",
    "RolloutBoundsError",
    "TrainOnlyNormalizer",
    "TransitionExample",
    "build_examples",
    "build_split_manifest",
    "compute_audit",
    "evaluate_examples",
    "feasibility_probe",
    "fit_train_normalizers",
    "generate_trajectory",
    "load_checkpoint",
    "pilot_experiment_config",
    "parameter_accounting",
    "public_observation_to_vector",
    "public_vector_to_observation",
    "recursive_rollout",
    "save_checkpoint",
    "split_spec",
    "validate_public_state_vector",
    "verify_split_manifest",
    "write_pilot_artifacts",
]
