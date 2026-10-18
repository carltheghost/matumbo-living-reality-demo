"""Bounded shared 4D metric geometry for the v0.3 hybrid experiments.

This is an additive proof module.  It provides numeric and local-autograd
helpers for a single bounded SPD coordinate metric shared by message, memory,
query, key, and tension-proposal coordinates.  The existing hybrid core does
not enable this module by default, and no historical checkpoint is rewritten.

The metric is a constant SPD matrix during each evaluation.  It is flat
coordinate geometry, not a curved manifold and not physical extra dimensions.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import numpy as np

from .autograd import Tensor, concatenate, sigmoid


GEOMETRY_CONTRACT_VERSION = "vevo.v03.hybrid-geometry.contract.v1"
GEOMETRY_MODEL_VERSION = "vevo.v03.hybrid-geometry.v1"
GEOMETRY_SNAPSHOT_SCHEMA = "vevo.v03.hybrid-geometry.snapshot.v1"
SHARED_GEOMETRY_DIM = 4
G_MIN = 0.5
G_MAX = 2.0
BETA_MAX = 1.0
REFINEMENT_RADIUS = 2.0
MAX_REFINEMENT_STEPS = 64
GEOMETRY_EPSILON = 1.0e-12
# The raw metric formula squares and sums 16 entries and its Tensor quotient
# backward path also squares the denominator.  This bound keeps every forward
# product, Gram sum, and quotient-backward intermediate comfortably finite in
# float64 for both the numeric and local-autograd implementations.
MAX_SAFE_RAW_B_ABS = 1.0e6
MAX_COORDINATE_ABS = 16.0


class GeometryError(ValueError):
    """Base error for invalid or non-finite geometry data."""


class GeometrySnapshotError(GeometryError):
    """A checkpoint is incompatible with this geometry version."""


def _finite_scalar(value: Any, *, name: str) -> float:
    if isinstance(value, (bool, np.bool_)):
        raise GeometryError(f"{name} must be a finite scalar")
    if isinstance(value, np.ndarray) and value.shape == ():
        value = value.item()
    if isinstance(value, np.generic):
        value = value.item()
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise GeometryError(f"{name} must be a finite scalar") from exc
    if not math.isfinite(result):
        raise GeometryError(f"{name} must be a finite scalar")
    return result


def _finite_array(value: Any, *, name: str, shape: tuple[int, ...]) -> np.ndarray:
    raw = np.asarray(value)
    if raw.dtype.kind == "b":
        raise GeometryError(f"{name} must not be a boolean array")
    result = np.asarray(value, dtype=np.float64)
    if result.shape != shape or not np.isfinite(result).all():
        raise GeometryError(f"{name} must be finite with shape {shape}")
    return result.copy()


def _validate_raw_metric(raw_B: Any) -> np.ndarray:
    result = _finite_array(raw_B, name="raw_B", shape=(SHARED_GEOMETRY_DIM, SHARED_GEOMETRY_DIM))
    if np.max(np.abs(result), initial=0.0) > MAX_SAFE_RAW_B_ABS:
        raise GeometryError("raw_B is too large for safe bounded metric arithmetic")
    return result


def _validate_coordinate(value: Any, *, name: str) -> np.ndarray:
    result = _finite_array(value, name=name, shape=(SHARED_GEOMETRY_DIM,))
    if np.any(np.abs(result) > MAX_COORDINATE_ABS):
        raise GeometryError(f"{name} exceeds the bounded coordinate contract")
    return result


def _validate_coordinates(value: Any, *, name: str) -> np.ndarray:
    raw = np.asarray(value)
    if raw.dtype.kind == "b":
        raise GeometryError(f"{name} must not be a boolean array")
    result = np.asarray(value, dtype=np.float64)
    if result.ndim != 2 or result.shape[1] != SHARED_GEOMETRY_DIM or not np.isfinite(result).all():
        raise GeometryError(f"{name} must be finite with shape (n, {SHARED_GEOMETRY_DIM})")
    if np.any(np.abs(result) > MAX_COORDINATE_ABS):
        raise GeometryError(f"{name} exceeds the bounded coordinate contract")
    return result.copy()


def _validate_metric_numeric(metric: Any) -> np.ndarray:
    result = _finite_array(
        metric,
        name="metric",
        shape=(SHARED_GEOMETRY_DIM, SHARED_GEOMETRY_DIM),
    )
    if not np.allclose(result, result.T, rtol=0.0, atol=1.0e-12):
        raise GeometryError("metric must be symmetric")
    eigenvalues = np.linalg.eigvalsh(result)
    if np.min(eigenvalues) < G_MIN - 1.0e-10 or np.max(eigenvalues) > G_MAX + 1.0e-10:
        raise GeometryError("metric eigenvalues exceed fixed bounds")
    if np.min(eigenvalues) <= 0.0:
        raise GeometryError("metric must be positive definite")
    return result.copy()


def bounded_spd_metric_numeric(raw_B: Any) -> np.ndarray:
    """Construct the exact bounded SPD metric from a finite 4x4 raw matrix."""

    B = _validate_raw_metric(raw_B)
    denominator = 1.0 + float(np.sum(B * B))
    gram = B.T @ B
    metric = G_MIN * np.eye(SHARED_GEOMETRY_DIM) + (G_MAX - G_MIN) * gram / denominator
    return (metric + metric.T) * 0.5


def bounded_spd_metric_tensor(raw_B: Tensor) -> Tensor:
    """Autograd equivalent of :func:`bounded_spd_metric_numeric`."""

    if not isinstance(raw_B, Tensor) or raw_B.shape != (SHARED_GEOMETRY_DIM, SHARED_GEOMETRY_DIM):
        raise GeometryError("raw_B must be a Tensor with shape (4, 4)")
    if raw_B.data.dtype.kind == "b":
        raise GeometryError("raw_B must not be a boolean array")
    if not np.isfinite(raw_B.data).all():
        raise GeometryError("raw_B must be finite")
    if np.max(np.abs(raw_B.data), initial=0.0) > MAX_SAFE_RAW_B_ABS:
        raise GeometryError("raw_B is too large for safe bounded metric arithmetic")
    denominator = 1.0 + (raw_B * raw_B).sum()
    gram = raw_B.T @ raw_B
    identity = Tensor(np.eye(SHARED_GEOMETRY_DIM), requires_grad=False)
    return G_MIN * identity + (G_MAX - G_MIN) * gram / denominator


def identity_metric() -> np.ndarray:
    """Return the explicit Euclidean ablation metric."""

    return np.eye(SHARED_GEOMETRY_DIM, dtype=np.float64)


def bounded_beta_numeric(raw_beta: Any) -> float:
    raw = _finite_scalar(raw_beta, name="raw_beta")
    clipped = float(np.clip(raw, -60.0, 60.0))
    return BETA_MAX / (1.0 + math.exp(-clipped))


def bounded_beta_tensor(raw_beta: Tensor) -> Tensor:
    if not isinstance(raw_beta, Tensor) or raw_beta.data.shape != ():
        raise GeometryError("raw_beta must be a scalar Tensor")
    if not np.isfinite(raw_beta.data).all():
        raise GeometryError("raw_beta must be finite")
    return BETA_MAX * sigmoid(raw_beta)


def _validate_base_logits(base_logits: Any, count: int) -> np.ndarray:
    if base_logits is None:
        result = np.zeros(count, dtype=np.float64)
    else:
        raw = np.asarray(base_logits)
        if raw.dtype.kind == "b":
            raise GeometryError("base_logits must not be a boolean array")
        result = np.asarray(base_logits, dtype=np.float64)
    if result.shape != (count,) or not np.isfinite(result).all():
        raise GeometryError(f"base_logits must be finite with shape ({count},)")
    return result.copy()


def metric_attention_logits_numeric(
    query: Any,
    keys: Any,
    metric: Any,
    raw_beta: Any,
    base_logits: Any = None,
    *,
    distance_enabled: bool = True,
) -> np.ndarray:
    """Add one shared bounded metric distance penalty to attention logits."""

    query_value = _validate_coordinate(query, name="query")
    key_values = _validate_coordinates(keys, name="keys")
    metric_value = _validate_metric_numeric(metric)
    base = _validate_base_logits(base_logits, key_values.shape[0])
    if not isinstance(distance_enabled, bool):
        raise GeometryError("distance_enabled must be boolean")
    if not distance_enabled:
        return base
    beta = bounded_beta_numeric(raw_beta)
    delta = key_values - query_value
    distances = np.einsum("ni,ij,nj->n", delta, metric_value, delta)
    distances = np.maximum(distances, 0.0)
    return base - beta * distances


def _tensor_matrix(value: Tensor, *, name: str, shape: tuple[int, ...]) -> Tensor:
    if not isinstance(value, Tensor) or value.shape != shape:
        raise GeometryError(f"{name} must be a Tensor with shape {shape}")
    if value.data.dtype.kind == "b":
        raise GeometryError(f"{name} must not be a boolean array")
    if not np.isfinite(value.data).all():
        raise GeometryError(f"{name} must be finite")
    return value


def _validate_tensor_coordinates(value: Tensor, *, name: str) -> Tensor:
    if np.any(np.abs(value.data) > MAX_COORDINATE_ABS):
        raise GeometryError(f"{name} exceeds the bounded coordinate contract")
    return value


def metric_attention_logits_tensor(
    query: Tensor,
    keys: Tensor,
    metric: Tensor,
    raw_beta: Tensor,
    base_logits: Tensor | None = None,
    *,
    distance_enabled: bool = True,
) -> Tensor:
    """Autograd attention logits using the same shared metric formula."""

    query_value = _validate_tensor_coordinates(
        _tensor_matrix(query, name="query", shape=(SHARED_GEOMETRY_DIM,)),
        name="query",
    )
    if not isinstance(keys, Tensor) or keys.data.ndim != 2 or keys.shape[1] != SHARED_GEOMETRY_DIM:
        raise GeometryError(f"keys must be a Tensor with shape (n, {SHARED_GEOMETRY_DIM})")
    key_values = _validate_tensor_coordinates(
        _tensor_matrix(keys, name="keys", shape=(keys.shape[0], SHARED_GEOMETRY_DIM)),
        name="keys",
    )
    metric_value = _tensor_matrix(
        metric,
        name="metric",
        shape=(SHARED_GEOMETRY_DIM, SHARED_GEOMETRY_DIM),
    )
    _validate_metric_numeric(metric_value.data)
    beta = bounded_beta_tensor(raw_beta)
    if not isinstance(distance_enabled, bool):
        raise GeometryError("distance_enabled must be boolean")
    if base_logits is not None:
        base = _tensor_matrix(base_logits, name="base_logits", shape=(key_values.shape[0],))
    else:
        base = None
    logits: list[Tensor] = []
    for index in range(key_values.shape[0]):
        base_value = Tensor(0.0) if base is None else base[index]
        if not distance_enabled:
            logits.append(base_value.reshape(1))
            continue
        delta = key_values[index] - query_value
        weighted = delta @ metric_value
        distance = (weighted * delta).sum()
        logits.append((base_value - beta * distance).reshape(1))
    if not logits:
        return Tensor(np.zeros(0, dtype=np.float64))
    return concatenate(logits, axis=0)


def _validate_tension_inputs(
    state: Any,
    proposals: Any,
    maps: Any,
    alpha: Any,
    lambda_value: Any,
    prior: Any,
    metric: Any,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, float, np.ndarray, np.ndarray]:
    raw_state = np.asarray(state)
    if raw_state.dtype.kind == "b":
        raise GeometryError("state must not be a boolean array")
    state_value = np.asarray(state, dtype=np.float64)
    if state_value.ndim != 1 or state_value.size == 0 or not np.isfinite(state_value).all():
        raise GeometryError("state must be finite with a non-empty 1-D shape")
    proposal_values = _validate_coordinates(proposals, name="proposals")
    raw_maps = np.asarray(maps)
    if raw_maps.dtype.kind == "b":
        raise GeometryError("maps must not be a boolean array")
    map_values = np.asarray(maps, dtype=np.float64)
    if map_values.shape != (proposal_values.shape[0], SHARED_GEOMETRY_DIM, state_value.shape[0]):
        raise GeometryError("maps must have shape (n, 4, state_dim) matching proposals")
    if not np.isfinite(map_values).all():
        raise GeometryError("maps must be finite")
    raw_alpha = np.asarray(alpha)
    if raw_alpha.dtype.kind == "b":
        raise GeometryError("alpha must not be a boolean array")
    alpha_values = np.asarray(alpha, dtype=np.float64)
    if alpha_values.shape != (proposal_values.shape[0],) or not np.isfinite(alpha_values).all():
        raise GeometryError("alpha must have shape (n,) and be finite")
    if np.any(alpha_values < 0.0):
        raise GeometryError("alpha must be nonnegative")
    lambda_float = _finite_scalar(lambda_value, name="lambda_value")
    if lambda_float < 0.0:
        raise GeometryError("lambda_value must be nonnegative")
    raw_prior = np.asarray(prior)
    if raw_prior.dtype.kind == "b":
        raise GeometryError("prior must not be a boolean array")
    prior_value = np.asarray(prior, dtype=np.float64)
    if prior_value.shape != state_value.shape or not np.isfinite(prior_value).all():
        raise GeometryError("prior must match the finite state shape")
    metric_value = _validate_metric_numeric(metric)
    return (
        state_value,
        proposal_values,
        map_values.copy(),
        alpha_values.copy(),
        lambda_float,
        prior_value,
        metric_value,
    )


def metric_tension_energy_numeric(
    state: Any,
    proposals: Any,
    maps: Any,
    alpha: Any,
    lambda_value: Any,
    prior: Any,
    metric: Any,
) -> float:
    """Evaluate the shared-metric proposal tension plus Euclidean anchor."""

    state_value, proposal_values, map_values, alpha_values, lambda_float, prior_value, metric_value = (
        _validate_tension_inputs(state, proposals, maps, alpha, lambda_value, prior, metric)
    )
    energy = 0.0
    for coefficient, proposal, map_value in zip(alpha_values, proposal_values, map_values):
        residual = map_value @ state_value - proposal
        energy += 0.5 * float(coefficient) * float(residual @ metric_value @ residual)
    anchor = state_value - prior_value
    energy += 0.5 * lambda_float * float(anchor @ anchor)
    if not math.isfinite(energy):
        raise GeometryError("tension energy is non-finite")
    return float(energy)


def metric_tension_energy_tensor(
    state: Tensor,
    proposals: Tensor,
    maps: Tensor,
    alpha: Tensor,
    lambda_value: Any,
    prior: Tensor,
    metric: Tensor,
) -> Tensor:
    """Autograd tension energy using one shared metric for every residual."""

    if not isinstance(state, Tensor) or state.data.ndim != 1 or state.data.size == 0:
        raise GeometryError("state must be a non-empty 1-D Tensor")
    if not np.isfinite(state.data).all():
        raise GeometryError("state must be finite")
    state_value = state
    if not isinstance(proposals, Tensor) or proposals.data.ndim != 2 or proposals.shape[1] != SHARED_GEOMETRY_DIM:
        raise GeometryError(f"proposals must be a Tensor with shape (n, {SHARED_GEOMETRY_DIM})")
    proposal_values = _validate_tensor_coordinates(
        _tensor_matrix(
            proposals,
            name="proposals",
            shape=(proposals.shape[0], SHARED_GEOMETRY_DIM),
        ),
        name="proposals",
    )
    if not isinstance(maps, Tensor) or maps.data.ndim != 3 or maps.shape[0] != proposals.shape[0]:
        raise GeometryError("maps and proposals must have the same count")
    map_values = _tensor_matrix(
        maps,
        name="maps",
        shape=(proposals.shape[0], SHARED_GEOMETRY_DIM, state.shape[0]),
    )
    alpha_values = _tensor_matrix(alpha, name="alpha", shape=(proposals.shape[0],))
    prior_value = _tensor_matrix(prior, name="prior", shape=(state.shape[0],))
    metric_value = _tensor_matrix(
        metric,
        name="metric",
        shape=(SHARED_GEOMETRY_DIM, SHARED_GEOMETRY_DIM),
    )
    _validate_metric_numeric(metric_value.data)
    if isinstance(lambda_value, Tensor):
        if lambda_value.shape != () or not np.isfinite(lambda_value.data).all():
            raise GeometryError("lambda_value must be a finite scalar Tensor")
        lambda_tensor = lambda_value
        lambda_float = float(lambda_value.data)
    else:
        lambda_float = _finite_scalar(lambda_value, name="lambda_value")
        lambda_tensor = Tensor(lambda_float)
    if lambda_float < 0.0:
        raise GeometryError("lambda_value must be nonnegative")
    if np.any(alpha_values.data < 0.0):
        raise GeometryError("alpha must be nonnegative")
    energy = Tensor(0.0)
    for index in range(proposal_values.shape[0]):
        residual = map_values[index] @ state_value - proposal_values[index]
        weighted = residual @ metric_value
        quadratic = (weighted * residual).sum()
        energy = energy + 0.5 * alpha_values[index] * quadratic
    anchor = state_value - prior_value
    energy = energy + 0.5 * lambda_tensor * (anchor * anchor).sum()
    if not np.isfinite(energy.data).all():
        raise GeometryError("tension energy is non-finite")
    return energy


def curvature_upper_bound(maps: Any, alpha: Any, lambda_value: Any) -> float:
    """Return the prescribed fixed-objective curvature/Lipschitz bound."""

    raw_maps = np.asarray(maps)
    if raw_maps.dtype.kind == "b":
        raise GeometryError("maps must not be a boolean array")
    map_values = np.asarray(maps, dtype=np.float64)
    if map_values.ndim != 3 or map_values.shape[1] != SHARED_GEOMETRY_DIM:
        raise GeometryError("maps must have shape (n, 4, state_dim)")
    if not np.isfinite(map_values).all():
        raise GeometryError("maps must be finite")
    raw_alpha = np.asarray(alpha)
    if raw_alpha.dtype.kind == "b":
        raise GeometryError("alpha must not be a boolean array")
    alpha_values = np.asarray(alpha, dtype=np.float64)
    if alpha_values.shape != (map_values.shape[0],) or not np.isfinite(alpha_values).all():
        raise GeometryError("alpha must have shape (n,) and be finite")
    if np.any(alpha_values < 0.0):
        raise GeometryError("alpha must be nonnegative")
    lambda_float = _finite_scalar(lambda_value, name="lambda_value")
    if lambda_float < 0.0:
        raise GeometryError("lambda_value must be nonnegative")
    result = G_MAX * float(np.sum(alpha_values * np.sum(map_values * map_values, axis=(1, 2)))) + lambda_float
    if not math.isfinite(result):
        raise GeometryError("curvature bound is non-finite")
    return float(result)


def _project_state(value: np.ndarray, radius: float) -> np.ndarray:
    norm = float(np.linalg.norm(value))
    if norm > radius:
        return value * (radius / norm)
    return value.copy()


@dataclass(frozen=True, slots=True)
class GeometryRefinementTrace:
    states: tuple[np.ndarray, ...]
    energies: tuple[float, ...]
    curvature_bound: float
    step_size: float
    objective_frozen: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "states": [state.tolist() for state in self.states],
            "energies": list(self.energies),
            "curvature_bound": self.curvature_bound,
            "step_size": self.step_size,
            "objective_frozen": self.objective_frozen,
        }


def _tension_gradient_numeric(
    state: np.ndarray,
    proposals: np.ndarray,
    maps: np.ndarray,
    alpha: np.ndarray,
    lambda_value: float,
    prior: np.ndarray,
    metric: np.ndarray,
) -> np.ndarray:
    gradient = np.zeros(state.shape[0], dtype=np.float64)
    for coefficient, proposal, map_value in zip(alpha, proposals, maps):
        residual = map_value @ state - proposal
        gradient += coefficient * (map_value.T @ (metric @ residual))
    gradient += lambda_value * (state - prior)
    return gradient


def refine_tension_numeric(
    state: Any,
    proposals: Any,
    maps: Any,
    alpha: Any,
    lambda_value: Any,
    prior: Any,
    metric: Any,
    *,
    steps: int = 2,
    radius: float | None = None,
) -> tuple[np.ndarray, GeometryRefinementTrace]:
    """Run bounded projected refinement against one frozen metric objective."""

    if type(steps) is not int or steps < 0 or steps > MAX_REFINEMENT_STEPS:
        raise GeometryError(f"steps must be an integer in [0, {MAX_REFINEMENT_STEPS}]")
    radius_value = math.sqrt(float(np.asarray(state).size)) if radius is None else _finite_scalar(radius, name="radius")
    if radius_value <= 0.0:
        raise GeometryError("radius must be positive")
    state_value, proposal_values, map_values, alpha_values, lambda_float, prior_value, metric_value = (
        _validate_tension_inputs(state, proposals, maps, alpha, lambda_value, prior, metric)
    )
    state_value = _project_state(state_value, radius_value)
    curvature = curvature_upper_bound(map_values, alpha_values, lambda_float)
    step_size = 0.0 if curvature <= GEOMETRY_EPSILON else 0.5 / curvature
    states = [state_value.copy()]
    energies = [
        metric_tension_energy_numeric(
            state_value,
            proposal_values,
            map_values,
            alpha_values,
            lambda_float,
            prior_value,
            metric_value,
        )
    ]
    for _ in range(steps):
        gradient = _tension_gradient_numeric(
            state_value,
            proposal_values,
            map_values,
            alpha_values,
            lambda_float,
            prior_value,
            metric_value,
        )
        if not np.isfinite(gradient).all():
            raise GeometryError("refinement gradient is non-finite")
        candidate = _project_state(state_value - step_size * gradient, radius_value)
        candidate_energy = metric_tension_energy_numeric(
            candidate,
            proposal_values,
            map_values,
            alpha_values,
            lambda_float,
            prior_value,
            metric_value,
        )
        if candidate_energy > energies[-1] + 1.0e-10:
            raise GeometryError("fixed-objective refinement increased energy")
        state_value = candidate
        states.append(state_value.copy())
        energies.append(candidate_energy)
    return state_value.copy(), GeometryRefinementTrace(
        states=tuple(states),
        energies=tuple(energies),
        curvature_bound=curvature,
        step_size=step_size,
        objective_frozen=True,
    )


@dataclass(frozen=True, slots=True)
class GeometrySnapshot:
    schema: str
    model_version: str
    g_min: float
    g_max: float
    beta_max: float
    raw_B: np.ndarray
    raw_beta: float

    def as_mapping(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "model_version": self.model_version,
            "g_min": self.g_min,
            "g_max": self.g_max,
            "beta_max": self.beta_max,
            "raw_B": self.raw_B.tolist(),
            "raw_beta": self.raw_beta,
        }


def _canonical_snapshot_bytes(value: Mapping[str, Any]) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise GeometrySnapshotError("snapshot is not canonically serializable") from exc


def serialize_geometry_snapshot(raw_B: Any, raw_beta: Any) -> bytes:
    matrix = _validate_raw_metric(raw_B)
    beta = _finite_scalar(raw_beta, name="raw_beta")
    return _canonical_snapshot_bytes(
        GeometrySnapshot(
            GEOMETRY_SNAPSHOT_SCHEMA,
            GEOMETRY_MODEL_VERSION,
            G_MIN,
            G_MAX,
            BETA_MAX,
            matrix,
            beta,
        ).as_mapping()
    )


def _snapshot_document(document: bytes | str | Mapping[str, Any]) -> Mapping[str, Any]:
    if isinstance(document, bytes):
        try:
            document = document.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise GeometrySnapshotError("snapshot bytes must be UTF-8") from exc
    if isinstance(document, str):
        try:
            value = json.loads(document)
        except (TypeError, ValueError) as exc:
            raise GeometrySnapshotError("snapshot is not valid JSON") from exc
    elif isinstance(document, Mapping):
        value = dict(document)
    else:
        raise GeometrySnapshotError("snapshot must be bytes, str, or mapping")
    if not isinstance(value, dict):
        raise GeometrySnapshotError("snapshot must be a JSON object")
    return value


def restore_geometry_snapshot(document: bytes | str | Mapping[str, Any]) -> GeometrySnapshot:
    value = _snapshot_document(document)
    required = {"schema", "model_version", "g_min", "g_max", "beta_max", "raw_B", "raw_beta"}
    if set(value) != required:
        raise GeometrySnapshotError("snapshot has unexpected or missing fields")
    if value["schema"] != GEOMETRY_SNAPSHOT_SCHEMA or value["model_version"] != GEOMETRY_MODEL_VERSION:
        raise GeometrySnapshotError("snapshot version is incompatible")
    if value["g_min"] != G_MIN or value["g_max"] != G_MAX or value["beta_max"] != BETA_MAX:
        raise GeometrySnapshotError("snapshot bounds are incompatible")
    matrix = _validate_raw_metric(value["raw_B"])
    beta = _finite_scalar(value["raw_beta"], name="raw_beta")
    return GeometrySnapshot(
        GEOMETRY_SNAPSHOT_SCHEMA,
        GEOMETRY_MODEL_VERSION,
        G_MIN,
        G_MAX,
        BETA_MAX,
        matrix,
        beta,
    )


__all__ = [
    "BETA_MAX",
    "G_MAX",
    "G_MIN",
    "GEOMETRY_CONTRACT_VERSION",
    "GEOMETRY_MODEL_VERSION",
    "GEOMETRY_SNAPSHOT_SCHEMA",
    "MAX_COORDINATE_ABS",
    "MAX_SAFE_RAW_B_ABS",
    "GeometryError",
    "GeometryRefinementTrace",
    "GeometrySnapshot",
    "GeometrySnapshotError",
    "REFINEMENT_RADIUS",
    "SHARED_GEOMETRY_DIM",
    "bounded_beta_numeric",
    "bounded_beta_tensor",
    "bounded_spd_metric_numeric",
    "bounded_spd_metric_tensor",
    "curvature_upper_bound",
    "identity_metric",
    "metric_attention_logits_numeric",
    "metric_attention_logits_tensor",
    "metric_tension_energy_numeric",
    "metric_tension_energy_tensor",
    "refine_tension_numeric",
    "restore_geometry_snapshot",
    "serialize_geometry_snapshot",
]
