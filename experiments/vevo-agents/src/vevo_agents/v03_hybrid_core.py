"""Small untrained hybrid-core experiment for the v0.3 five-brain proof.

This module is deliberately an internal numerical core, not a policy service.
It reuses the existing four 8-unit recurrent peripherals, 12-unit center, and
2x6 addressable memory, then adds bounded oscillators, one masked attention
exchange, two fixed-objective tension refinements, and causal recipient-
specific feedback.  Typed executor permissions remain outside this module.

The oscillator state is two 2-D pairs per compartment.  Its exact
frozen-forcing update is evaluated with a small-dt series branch so the
``E - I`` cancellation is not used when ``dt`` is tiny.  The module exposes
numeric and Tensor paths only for structural tests; all weights are random
and untrained.
"""

from __future__ import annotations

import hashlib
import math
from typing import Any, Mapping, Sequence

import numpy as np

from .autograd import Tensor, concatenate, cos, exp, sigmoid, sin, softmax, sqrt, tanh
from .v03_model import LEGACY_GATE_HEAD, POLICY_VECTOR_DIM, V03FiveBrain


HYBRID_CORE_MODEL_VERSION = "vevo.v03.hybrid-core.v2"
HYBRID_CORE_SCHEMA = "vevo.v03.hybrid-core.runtime.v2"
HYBRID_CORE_PARAMETER_SCHEMA = "vevo.v03.hybrid-core.parameters.v2"

PERIPHERAL_COUNT = 4
PERIPHERAL_HIDDEN = 8
CENTER_HIDDEN = 12
MEMORY_SLOTS = 2
MEMORY_DIM = 6
COMPARTMENT_COUNT = PERIPHERAL_COUNT + 1
OSCILLATOR_PAIRS = 2
OSCILLATOR_DIM = 2
OSCILLATOR_COMPONENTS = OSCILLATOR_PAIRS * OSCILLATOR_DIM
MESSAGE_DIM = 4
ATTENTION_DIM = 4
TENSION_DIM = 4
TENSION_STATE_DIM = CENTER_HIDDEN
REFINEMENT_STEPS = 2

DEFAULT_DT = 0.05
MAX_SUPPORTED_DT = 0.25
OSCILLATOR_SMALL_DT = 1.0e-4
TIME_UNIT = "normalized recurrent-step time units"
OSCILLATOR_STATE_RADIUS = 1.0
TENSION_STATE_RADIUS = math.sqrt(12.0)
ATTENTION_LOGIT_BOUND = 8.0
TENSION_EPSILON = 1.0e-8

GAMMA_MIN = 0.05
GAMMA_MAX = 1.5
OMEGA_MAX = 3.0
ALPHA_MIN = 0.05
ALPHA_MAX = 1.5
LAMBDA_MIN = 0.05
LAMBDA_MAX = 1.5

INCREMENTAL_PARAMETER_CAP = 2500
HYBRID_PARAMETER_SEED_SALT = 0x48594252


class HybridCoreSnapshotError(ValueError):
    """A runtime snapshot is incompatible with the current untrained core."""


class HybridCoreParameterBudgetError(ValueError):
    """The explicitly bounded incremental architecture would exceed its cap."""


def _sigmoid_numeric(value: np.ndarray | float) -> np.ndarray | float:
    clipped = np.clip(value, -60.0, 60.0)
    return 1.0 / (1.0 + np.exp(-clipped))


def _softmax_numeric(value: np.ndarray) -> np.ndarray:
    value = np.asarray(value, dtype=np.float64)
    shifted = value - np.max(value)
    result = np.exp(shifted)
    return result / np.sum(result)


def _validate_dt(dt: float) -> float:
    if isinstance(dt, (bool, np.bool_)):
        raise ValueError("dt must be a finite non-negative scalar")
    try:
        value = float(dt)
    except (TypeError, ValueError) as exc:
        raise ValueError("dt must be a finite non-negative scalar") from exc
    if not math.isfinite(value) or value < 0.0 or value > MAX_SUPPORTED_DT:
        raise ValueError(
            f"dt must be finite and in [0, {MAX_SUPPORTED_DT}] {TIME_UNIT}"
        )
    return value


def _validate_vector(vector: Sequence[float] | np.ndarray) -> np.ndarray:
    result = np.asarray(vector, dtype=np.float64)
    if result.shape != (POLICY_VECTOR_DIM,) or not np.isfinite(result).all():
        raise ValueError(f"core input must be a finite vector of shape ({POLICY_VECTOR_DIM},)")
    return result.copy()


def _validate_presence(
    value: Sequence[float] | np.ndarray | None,
    width: int,
    *,
    name: str,
) -> np.ndarray:
    if value is None:
        return np.ones(width, dtype=np.float64)
    result = np.asarray(value, dtype=np.float64)
    if result.shape != (width,) or not np.isfinite(result).all():
        raise ValueError(f"{name} must be a finite binary mask of shape ({width},)")
    if not np.all((result == 0.0) | (result == 1.0)):
        raise ValueError(f"{name} must contain only 0/1 presence values")
    return result.copy()


def _validate_step_counter(value: Any, *, name: str = "step") -> int:
    if type(value) is not int or value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
    return value


def _validate_oscillator_pairs(value: np.ndarray, *, name: str = "oscillators") -> np.ndarray:
    value = np.asarray(value, dtype=np.float64)
    if not np.isfinite(value).all():
        raise ValueError(f"{name} must be finite")
    if value.ndim == 0 or value.shape[-1] != OSCILLATOR_DIM:
        raise ValueError(f"{name} must use 2-D oscillator pairs")
    if np.any(np.linalg.norm(value, axis=-1) > OSCILLATOR_STATE_RADIUS + 1e-9):
        raise ValueError(f"{name} contains a pair outside the unit disk")
    return value


def _project_numeric(value: np.ndarray, radius: float) -> np.ndarray:
    value = np.asarray(value, dtype=np.float64)
    norm = float(np.linalg.norm(value))
    if norm > radius:
        return value * (radius / norm)
    return value.copy()


def _project_tensor(value: Tensor, radius: float) -> Tensor:
    norm = sqrt((value * value).sum())
    if float(norm.data) > radius:
        return value * (radius / norm)
    return value


def _bounded_parameter_numeric(raw: np.ndarray, lower: float, upper: float) -> np.ndarray:
    return lower + (upper - lower) * _sigmoid_numeric(raw)


def _parameter_digest(
    base_params: Mapping[str, np.ndarray],
    hybrid_params: Mapping[str, np.ndarray],
) -> str:
    digest = hashlib.sha256()
    combined = {
        **{f"base.{name}": value for name, value in base_params.items()},
        **dict(hybrid_params),
    }
    for name in sorted(combined):
        value = np.ascontiguousarray(combined[name], dtype=np.float64)
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(value.shape).encode("ascii"))
        digest.update(b"\0")
        digest.update(value.tobytes())
    return digest.hexdigest()


def _oscillator_coefficients_numeric(
    gamma: float,
    omega: float,
    dt: float,
) -> tuple[float, float, float, float, float]:
    """Return exp(-gamma*dt), cos, sin, and stable forcing integrals."""

    if not math.isfinite(gamma) or gamma <= 0.0 or not math.isfinite(omega):
        raise ValueError("oscillator damping must be positive and finite")
    dt = _validate_dt(dt)
    if dt <= OSCILLATOR_SMALL_DT:
        # Integrals of exp(-gamma*s) cos(omega*s) and
        # exp(-gamma*s) sin(omega*s), through fifth order.  This avoids
        # subtracting nearly equal matrices in gamma A^-1 (E-I).
        t2 = dt * dt
        t3 = t2 * dt
        t4 = t3 * dt
        t5 = t4 * dt
        gamma2 = gamma * gamma
        gamma3 = gamma2 * gamma
        gamma4 = gamma2 * gamma2
        omega2 = omega * omega
        omega3 = omega2 * omega
        omega4 = omega2 * omega2
        i0 = (
            dt
            - gamma * t2 / 2.0
            + (gamma2 - omega2) * t3 / 6.0
            + (-gamma3 / 24.0 + gamma * omega2 / 8.0) * t4
            + (gamma4 / 120.0 - gamma2 * omega2 / 20.0 + omega4 / 120.0) * t5
        )
        i1 = (
            omega * t2 / 2.0
            - gamma * omega * t3 / 3.0
            + (gamma2 * omega / 8.0 - omega3 / 24.0) * t4
            + (-gamma3 * omega / 30.0 + gamma * omega3 / 30.0) * t5
        )
        return math.exp(-gamma * dt), math.cos(omega * dt), math.sin(omega * dt), i0, i1
    decay = math.exp(-gamma * dt)
    angle = omega * dt
    cosine = math.cos(angle)
    sine = math.sin(angle)
    q0 = decay * cosine - 1.0
    q1 = decay * sine
    denominator = gamma * gamma + omega * omega
    i0 = (-gamma * q0 + omega * q1) / denominator
    i1 = (-gamma * q1 - omega * q0) / denominator
    return decay, cosine, sine, i0, i1


def _oscillator_coefficients_tensor(
    gamma: Tensor,
    omega: Tensor,
    dt: float,
) -> tuple[Tensor, Tensor, Tensor, Tensor, Tensor]:
    dt = _validate_dt(dt)
    if dt <= OSCILLATOR_SMALL_DT:
        t2 = dt * dt
        t3 = t2 * dt
        t4 = t3 * dt
        t5 = t4 * dt
        gamma2 = gamma * gamma
        gamma3 = gamma2 * gamma
        gamma4 = gamma2 * gamma2
        omega2 = omega * omega
        omega3 = omega2 * omega
        omega4 = omega2 * omega2
        i0 = (
            dt
            - gamma * t2 / 2.0
            + (gamma2 - omega2) * t3 / 6.0
            + (-gamma3 / 24.0 + gamma * omega2 / 8.0) * t4
            + (gamma4 / 120.0 - gamma2 * omega2 / 20.0 + omega4 / 120.0) * t5
        )
        i1 = (
            omega * t2 / 2.0
            - gamma * omega * t3 / 3.0
            + (gamma2 * omega / 8.0 - omega3 / 24.0) * t4
            + (-gamma3 * omega / 30.0 + gamma * omega3 / 30.0) * t5
        )
        return exp(-gamma * dt), cos(omega * dt), sin(omega * dt), i0, i1
    decay = exp(-gamma * dt)
    angle = omega * dt
    cosine = cos(angle)
    sine = sin(angle)
    q0 = decay * cosine - 1.0
    q1 = decay * sine
    denominator = gamma * gamma + omega * omega
    i0 = (-gamma * q0 + omega * q1) / denominator
    i1 = (-gamma * q1 - omega * q0) / denominator
    return decay, cosine, sine, i0, i1


def advance_oscillator(
    z: Sequence[float] | np.ndarray,
    forcing: Sequence[float] | np.ndarray,
    gamma: float,
    omega: float,
    dt: float,
) -> np.ndarray:
    """Advance one 2-D oscillator with held-constant bounded forcing.

    The dynamics are ``dz/dt = (-gamma I + omega J) z + gamma u`` where
    ``u = forcing / sqrt(1 + ||forcing||^2)``.  The update is the exact
    frozen-forcing exponential update, with a stable small-dt integral branch.
    """

    z = np.asarray(z, dtype=np.float64)
    forcing = np.asarray(forcing, dtype=np.float64)
    if z.shape != (2,) or forcing.shape != (2,) or not np.isfinite(z).all() or not np.isfinite(forcing).all():
        raise ValueError("oscillator state and forcing must be finite 2-D vectors")
    if float(np.linalg.norm(z)) > OSCILLATOR_STATE_RADIUS + 1e-9:
        raise ValueError("oscillator state must be inside the unit disk")
    decay, cosine, sine, i0, i1 = _oscillator_coefficients_numeric(gamma, omega, dt)
    u = forcing / math.sqrt(1.0 + float(np.dot(forcing, forcing)))
    result = np.asarray(
        [
            decay * (cosine * z[0] - sine * z[1]) + gamma * (i0 * u[0] - i1 * u[1]),
            decay * (sine * z[0] + cosine * z[1]) + gamma * (i1 * u[0] + i0 * u[1]),
        ],
        dtype=np.float64,
    )
    if float(np.linalg.norm(result)) > OSCILLATOR_STATE_RADIUS + 1e-9:
        raise ValueError("oscillator update exceeded the unit disk")
    return result


def _advance_oscillator_tensor(
    z: Tensor,
    forcing: Tensor,
    gamma: Tensor,
    omega: Tensor,
    dt: float,
) -> Tensor:
    if z.data.shape != (OSCILLATOR_DIM,) or not np.isfinite(z.data).all():
        raise ValueError("oscillator state must be a finite 2-D tensor")
    if float(np.linalg.norm(z.data)) > OSCILLATOR_STATE_RADIUS + 1e-9:
        raise ValueError("oscillator state must be inside the unit disk")
    decay, cosine, sine, i0, i1 = _oscillator_coefficients_tensor(gamma, omega, dt)
    u = forcing / sqrt(1.0 + (forcing * forcing).sum())
    result = concatenate(
        (
            (decay * (cosine * z[0] - sine * z[1]) + gamma * (i0 * u[0] - i1 * u[1])).reshape(1),
            (decay * (sine * z[0] + cosine * z[1]) + gamma * (i1 * u[0] + i0 * u[1])).reshape(1),
        ),
        axis=0,
    )
    if not np.isfinite(result.data).all() or float(np.linalg.norm(result.data)) > OSCILLATOR_STATE_RADIUS + 1e-9:
        raise ValueError("oscillator update exceeded the unit disk")
    return result


def _attention_logit_numeric(value: float) -> float:
    return float(ATTENTION_LOGIT_BOUND * np.tanh(value / ATTENTION_LOGIT_BOUND))


def _attention_logit_tensor(value: Tensor) -> Tensor:
    return ATTENTION_LOGIT_BOUND * tanh(value / ATTENTION_LOGIT_BOUND)


class V03HybridCore:
    """An untrained five-compartment recurrent/oscillator hybrid core.

    The existing ``V03FiveBrain`` remains the recurrent/memory backbone.  The
    incremental parameter set is intentionally independent and budgeted; it
    does not alter old model classes or typed executor contracts.
    """

    PERIPHERALS = PERIPHERAL_COUNT
    PERIPH_HIDDEN = PERIPHERAL_HIDDEN
    CENTER_HIDDEN = CENTER_HIDDEN
    MEMORY_SLOTS = MEMORY_SLOTS
    MEMORY_DIM = MEMORY_DIM
    COMPARTMENTS = COMPARTMENT_COUNT
    OSCILLATOR_PAIRS = OSCILLATOR_PAIRS
    MESSAGE_DIM = MESSAGE_DIM
    ATTENTION_DIM = ATTENTION_DIM
    TENSION_DIM = TENSION_DIM

    def __init__(self, seed: int = 7):
        if type(seed) is not int or seed < 0:
            raise ValueError("core seed must be a non-negative integer")
        self.seed = seed
        self.base = V03FiveBrain(seed, gate_head=LEGACY_GATE_HEAD)
        rng = np.random.default_rng(np.random.SeedSequence([seed, HYBRID_PARAMETER_SEED_SALT]))
        self.params: dict[str, np.ndarray] = {}

        def normal(name: str, shape: tuple[int, ...], scale: float) -> None:
            self.params[name] = rng.normal(0.0, scale, shape).astype(np.float64)

        # Two oscillator pairs (four coordinates) per compartment.  Each
        # peripheral has its own map; no specialization is assumed.
        normal("h.oscillator_gamma_raw", (COMPARTMENT_COUNT, OSCILLATOR_PAIRS), 0.20)
        normal("h.oscillator_omega_raw", (COMPARTMENT_COUNT, OSCILLATOR_PAIRS), 0.25)
        for index in range(PERIPHERAL_COUNT):
            normal(f"h.W_osc_force_p{index}", (OSCILLATOR_COMPONENTS, PERIPHERAL_HIDDEN), 0.12)
            normal(f"h.W_message_p{index}", (MESSAGE_DIM, PERIPHERAL_HIDDEN + OSCILLATOR_COMPONENTS), 0.12)
            self.params[f"h.b_message_p{index}"] = np.zeros(MESSAGE_DIM, dtype=np.float64)
            normal(f"h.W_feedback_in_p{index}", (PERIPHERAL_HIDDEN, MESSAGE_DIM), 0.12)
        normal("h.W_osc_force_c", (OSCILLATOR_COMPONENTS, CENTER_HIDDEN), 0.12)
        normal("h.W_message_c", (MESSAGE_DIM, CENTER_HIDDEN + OSCILLATOR_COMPONENTS), 0.12)
        self.params["h.b_message_c"] = np.zeros(MESSAGE_DIM, dtype=np.float64)
        normal("h.W_feedback_in_c", (CENTER_HIDDEN, MESSAGE_DIM), 0.12)

        # One six-token attention exchange: four message tokens and two
        # memory-slot tokens.  Q/K/V are bounded at the operation boundary.
        normal("h.W_query", (ATTENTION_DIM, CENTER_HIDDEN), 0.12)
        normal("h.W_query_central_message", (ATTENTION_DIM, MESSAGE_DIM), 0.12)
        normal("h.W_key_message", (ATTENTION_DIM, MESSAGE_DIM), 0.12)
        normal("h.W_value_message", (ATTENTION_DIM, MESSAGE_DIM), 0.12)
        normal("h.W_key_memory", (ATTENTION_DIM, MEMORY_DIM), 0.12)
        normal("h.W_value_memory", (ATTENTION_DIM, MEMORY_DIM), 0.12)

        # Recipient-specific bounded feedback is applied to the next base
        # recurrent step, preserving causal direction.
        normal("h.W_attention_to_tension", (TENSION_STATE_DIM, ATTENTION_DIM), 0.12)
        normal("h.W_tension_feedback", (MESSAGE_DIM, TENSION_STATE_DIM), 0.12)
        normal("h.W_feedback_out", (COMPARTMENT_COUNT, MESSAGE_DIM, ATTENTION_DIM), 0.12)
        self.params["h.b_feedback_out"] = np.zeros((COMPARTMENT_COUNT, MESSAGE_DIM), dtype=np.float64)

        # Four R4 proposals use the four bounded messages.  Coefficients are
        # frozen across the two refinement steps within one call.
        for index in range(PERIPHERAL_COUNT):
            normal(f"h.W_tension_{index}", (TENSION_DIM, CENTER_HIDDEN), 0.12)
        self.params["h.alpha_raw"] = np.zeros(PERIPHERAL_COUNT, dtype=np.float64)
        self.params["h.lambda_raw"] = np.zeros(1, dtype=np.float64)

        audit = self.parameter_budget_audit()
        if not audit["within_cap"]:
            raise HybridCoreParameterBudgetError(
                f"incremental hybrid parameter count {audit['incremental_parameter_count']} "
                f"exceeds cap {INCREMENTAL_PARAMETER_CAP}"
            )

    @property
    def brain_count(self) -> int:
        return self.base.brain_count

    @property
    def central_memory_shape(self) -> tuple[int, int]:
        return (MEMORY_SLOTS, MEMORY_DIM)

    def incremental_parameter_count(self) -> int:
        return int(sum(value.size for value in self.params.values()))

    def parameter_count(self) -> int:
        return self.base.parameter_count() + self.incremental_parameter_count()

    def parameter_budget_audit(self) -> dict[str, Any]:
        incremental = self.incremental_parameter_count()
        return {
            "cap": INCREMENTAL_PARAMETER_CAP,
            "incremental_parameter_count": incremental,
            "base_parameter_count": self.base.parameter_count(),
            "total_parameter_count": self.base.parameter_count() + incremental,
            "within_cap": incremental <= INCREMENTAL_PARAMETER_CAP,
            "cap_scope": "new hybrid parameters only; existing recurrent/memory backbone excluded",
        }

    def parameter_digest(self) -> str:
        return _parameter_digest(self.base.params, self.params)

    def model_identity(self) -> dict[str, Any]:
        return {
            "schema": HYBRID_CORE_PARAMETER_SCHEMA,
            "model_version": HYBRID_CORE_MODEL_VERSION,
            "seed": self.seed,
            "architecture": "four-8-unit-recurrent-peripherals-plus-12-unit-center-2x6-memory-oscillator-attention-tension",
            "base_architecture": "existing-v03-five-brain-recurrent-addressable-memory",
            "brain_count": self.brain_count,
            "peripheral_hidden": PERIPHERAL_HIDDEN,
            "center_hidden": CENTER_HIDDEN,
            "memory_shape": [MEMORY_SLOTS, MEMORY_DIM],
            "oscillator_shape": [COMPARTMENT_COUNT, OSCILLATOR_PAIRS, OSCILLATOR_DIM],
            "message_dim": MESSAGE_DIM,
            "attention_token_count": PERIPHERAL_COUNT + MEMORY_SLOTS,
            "tension_proposal_dim": TENSION_DIM,
            "tension_state_dim": TENSION_STATE_DIM,
            "tension_refinement_steps": REFINEMENT_STEPS,
            "time_unit": TIME_UNIT,
            "supported_dt": [0.0, MAX_SUPPORTED_DT],
            "parameter_digest": self.parameter_digest(),
            "parameter_budget": self.parameter_budget_audit(),
            "weights_status": "random_untrained",
            "competence_claim": False,
            "decision_service_available": False,
            "task_loss_available": False,
            "base_action_head": "legacy-comparator-only; no integrated task action adapter",
            "runtime_snapshot_is_weights_checkpoint": False,
        }

    def initial_runtime(
        self,
        *,
        memory: Sequence[Sequence[float]] | np.ndarray | None = None,
        module_presence: Sequence[float] | np.ndarray | None = None,
        memory_presence: Sequence[float] | np.ndarray | None = None,
    ) -> dict[str, Any]:
        if memory is None:
            memory_array = np.zeros(self.central_memory_shape, dtype=np.float64)
        else:
            memory_array = np.asarray(memory, dtype=np.float64)
            if memory_array.shape != self.central_memory_shape or not np.isfinite(memory_array).all():
                raise ValueError("initial memory has the wrong shape or is non-finite")
            memory_array = memory_array.copy()
        return {
            "peripheral": [np.zeros(PERIPHERAL_HIDDEN, dtype=np.float64) for _ in range(PERIPHERAL_COUNT)],
            "central": np.zeros(CENTER_HIDDEN, dtype=np.float64),
            "memory": memory_array,
            "oscillators": np.zeros(
                (COMPARTMENT_COUNT, OSCILLATOR_PAIRS, OSCILLATOR_DIM),
                dtype=np.float64,
            ),
            "feedback": np.zeros((COMPARTMENT_COUNT, MESSAGE_DIM), dtype=np.float64),
            "time": 0.0,
            "step": 0,
            "module_presence": _validate_presence(module_presence, PERIPHERAL_COUNT, name="module_presence"),
            "memory_presence": _validate_presence(memory_presence, MEMORY_SLOTS, name="memory_presence"),
        }

    @staticmethod
    def _copy_runtime(runtime: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "peripheral": [np.asarray(value, dtype=np.float64).copy() for value in runtime["peripheral"]],
            "central": np.asarray(runtime["central"], dtype=np.float64).copy(),
            "memory": np.asarray(runtime["memory"], dtype=np.float64).copy(),
            "oscillators": np.asarray(runtime["oscillators"], dtype=np.float64).copy(),
            "feedback": np.asarray(runtime["feedback"], dtype=np.float64).copy(),
            "time": float(runtime["time"]),
            "step": _validate_step_counter(runtime["step"]),
            "module_presence": np.asarray(runtime["module_presence"], dtype=np.float64).copy(),
            "memory_presence": np.asarray(runtime["memory_presence"], dtype=np.float64).copy(),
        }

    def _validate_runtime(self, runtime: Mapping[str, Any]) -> None:
        if not isinstance(runtime, Mapping):
            raise ValueError("hybrid runtime must be a mapping")
        peripheral = runtime.get("peripheral")
        if not isinstance(peripheral, list) or len(peripheral) != PERIPHERAL_COUNT:
            raise ValueError("hybrid runtime must contain four peripheral states")
        for value in peripheral:
            array = np.asarray(value, dtype=np.float64)
            if array.shape != (PERIPHERAL_HIDDEN,) or not np.isfinite(array).all():
                raise ValueError("invalid peripheral state")
        for key, shape in (
            ("central", (CENTER_HIDDEN,)),
            ("memory", self.central_memory_shape),
            ("oscillators", (COMPARTMENT_COUNT, OSCILLATOR_PAIRS, OSCILLATOR_DIM)),
            ("feedback", (COMPARTMENT_COUNT, MESSAGE_DIM)),
        ):
            array = np.asarray(runtime.get(key), dtype=np.float64)
            if array.shape != shape or not np.isfinite(array).all():
                raise ValueError(f"invalid hybrid runtime field {key}")
        _validate_oscillator_pairs(
            np.asarray(runtime["oscillators"], dtype=np.float64),
            name="oscillators",
        )
        if np.any(np.abs(np.asarray(runtime["feedback"], dtype=np.float64)) > 1.0 + 1e-9):
            raise ValueError("feedback exceeds its bounded contract")
        time_value = float(runtime.get("time"))
        if not math.isfinite(time_value) or time_value < 0.0:
            raise ValueError("hybrid runtime time is invalid")
        _validate_step_counter(runtime.get("step"), name="hybrid runtime step")
        _validate_presence(runtime.get("module_presence"), PERIPHERAL_COUNT, name="module_presence")
        _validate_presence(runtime.get("memory_presence"), MEMORY_SLOTS, name="memory_presence")

    def _validate_tensor_runtime(self, runtime: Mapping[str, Any]) -> None:
        """Validate a runtime whose state values may be eager ``Tensor`` objects."""

        if not isinstance(runtime, Mapping):
            raise ValueError("hybrid tensor runtime must be a mapping")
        peripheral = runtime.get("peripheral")
        if not isinstance(peripheral, list) or len(peripheral) != PERIPHERAL_COUNT:
            raise ValueError("hybrid tensor runtime must contain four peripheral states")

        def payload(value: Any) -> np.ndarray:
            return value.data.copy() if isinstance(value, Tensor) else np.asarray(value, dtype=np.float64)

        for value in peripheral:
            array = payload(value)
            if array.shape != (PERIPHERAL_HIDDEN,) or not np.isfinite(array).all():
                raise ValueError("invalid tensor peripheral state")
        for key, shape in (
            ("central", (CENTER_HIDDEN,)),
            ("memory", self.central_memory_shape),
            ("oscillators", (COMPARTMENT_COUNT, OSCILLATOR_PAIRS, OSCILLATOR_DIM)),
            ("feedback", (COMPARTMENT_COUNT, MESSAGE_DIM)),
        ):
            array = payload(runtime.get(key))
            if array.shape != shape or not np.isfinite(array).all():
                raise ValueError(f"invalid tensor runtime field {key}")
        _validate_oscillator_pairs(payload(runtime["oscillators"]), name="tensor oscillators")
        if np.any(np.abs(payload(runtime["feedback"])) > 1.0 + 1e-9):
            raise ValueError("tensor feedback exceeds its bounded contract")
        time_value = float(runtime.get("time"))
        if not math.isfinite(time_value) or time_value < 0.0:
            raise ValueError("hybrid tensor runtime time is invalid")
        _validate_step_counter(runtime.get("step"), name="hybrid tensor runtime step")
        _validate_presence(runtime.get("module_presence"), PERIPHERAL_COUNT, name="module_presence")
        _validate_presence(runtime.get("memory_presence"), MEMORY_SLOTS, name="memory_presence")

    def _gamma_omega_numeric(self) -> tuple[np.ndarray, np.ndarray]:
        gamma = _bounded_parameter_numeric(self.params["h.oscillator_gamma_raw"], GAMMA_MIN, GAMMA_MAX)
        omega = OMEGA_MAX * np.tanh(self.params["h.oscillator_omega_raw"])
        return np.asarray(gamma, dtype=np.float64), np.asarray(omega, dtype=np.float64)

    @staticmethod
    def _gamma_omega_tensor(params: Mapping[str, Tensor]) -> tuple[Tensor, Tensor]:
        gamma = GAMMA_MIN + (GAMMA_MAX - GAMMA_MIN) * sigmoid(params["h.oscillator_gamma_raw"])
        omega = OMEGA_MAX * tanh(params["h.oscillator_omega_raw"])
        return gamma, omega

    def _inject_feedback_numeric(self, runtime: Mapping[str, Any]) -> dict[str, Any]:
        base_runtime = {
            "peripheral": [np.asarray(value, dtype=np.float64).copy() for value in runtime["peripheral"]],
            "central": np.asarray(runtime["central"], dtype=np.float64).copy(),
            "memory": np.asarray(runtime["memory"], dtype=np.float64).copy(),
        }
        for index in range(PERIPHERAL_COUNT):
            base_runtime["peripheral"][index] += np.tanh(
                self.params[f"h.W_feedback_in_p{index}"] @ runtime["feedback"][index]
            )
        base_runtime["central"] += np.tanh(
            self.params["h.W_feedback_in_c"] @ runtime["feedback"][PERIPHERAL_COUNT]
        )
        return base_runtime

    @staticmethod
    def _attention_numeric(
        messages: np.ndarray,
        memory: np.ndarray,
        central: np.ndarray,
        central_message: np.ndarray,
        module_presence: np.ndarray,
        memory_presence: np.ndarray,
        params: Mapping[str, np.ndarray],
    ) -> dict[str, np.ndarray]:
        messages = np.asarray(messages, dtype=np.float64).reshape(PERIPHERAL_COUNT, MESSAGE_DIM)
        memory = np.asarray(memory, dtype=np.float64).reshape(MEMORY_SLOTS, MEMORY_DIM)
        central = np.asarray(central, dtype=np.float64).reshape(CENTER_HIDDEN)
        central_message = np.asarray(central_message, dtype=np.float64).reshape(MESSAGE_DIM)
        module_presence = _validate_presence(module_presence, PERIPHERAL_COUNT, name="module_presence")
        memory_presence = _validate_presence(memory_presence, MEMORY_SLOTS, name="memory_presence")
        query = np.tanh(
            params["h.W_query"] @ central
            + params["h.W_query_central_message"] @ central_message
        )
        keys = []
        values = []
        presence = []
        for index in range(PERIPHERAL_COUNT):
            keys.append(np.tanh(params["h.W_key_message"] @ messages[index]))
            values.append(np.tanh(params["h.W_value_message"] @ messages[index]))
            presence.append(float(module_presence[index]))
        for index in range(MEMORY_SLOTS):
            keys.append(np.tanh(params["h.W_key_memory"] @ memory[index]))
            values.append(np.tanh(params["h.W_value_memory"] @ memory[index]))
            presence.append(float(memory_presence[index]))
        if not any(presence):
            zeros = np.zeros(PERIPHERAL_COUNT + MEMORY_SLOTS, dtype=np.float64)
            return {
                "query": query,
                "keys": np.asarray(keys, dtype=np.float64),
                "values": np.zeros((PERIPHERAL_COUNT + MEMORY_SLOTS, ATTENTION_DIM), dtype=np.float64),
                "raw_logits": zeros.copy(),
                "bounded_logits": zeros.copy(),
                "masked_logits": np.full_like(zeros, -1.0e9),
                "weights": zeros,
                "context": np.zeros(ATTENTION_DIM, dtype=np.float64),
            }
        raw_logits = np.asarray(
            [float(np.dot(query, key) / math.sqrt(ATTENTION_DIM)) for key in keys],
            dtype=np.float64,
        )
        bounded_logits = np.asarray([_attention_logit_numeric(value) for value in raw_logits], dtype=np.float64)
        masked_logits = bounded_logits.copy()
        bounded_values = np.asarray(values, dtype=np.float64) * np.asarray(presence, dtype=np.float64)[:, None]
        for index, is_present in enumerate(presence):
            if not is_present:
                masked_logits[index] = -1.0e9
        shifted = masked_logits - np.max(masked_logits)
        weights = np.exp(shifted)
        weights /= np.sum(weights)
        context = np.sum(weights[:, None] * bounded_values, axis=0)
        return {
            "query": query,
            "keys": np.asarray(keys, dtype=np.float64),
            "values": bounded_values,
            "raw_logits": raw_logits,
            "bounded_logits": bounded_logits,
            "masked_logits": masked_logits,
            "weights": weights,
            "context": context,
        }

    @staticmethod
    def _attention_tensor(
        messages: Sequence[Tensor],
        memory: Tensor,
        central: Tensor,
        central_message: Tensor,
        module_presence: np.ndarray,
        memory_presence: np.ndarray,
        params: Mapping[str, Tensor],
    ) -> dict[str, Any]:
        module_presence = _validate_presence(module_presence, PERIPHERAL_COUNT, name="module_presence")
        memory_presence = _validate_presence(memory_presence, MEMORY_SLOTS, name="memory_presence")
        query = tanh(
            params["h.W_query"] @ central
            + params["h.W_query_central_message"] @ central_message
        )
        keys: list[Tensor] = []
        values: list[Tensor] = []
        presence = [float(value) for value in module_presence] + [float(value) for value in memory_presence]
        for index, message in enumerate(messages):
            keys.append(tanh(params["h.W_key_message"] @ message))
            values.append(tanh(params["h.W_value_message"] @ message) * presence[index])
        for index in range(MEMORY_SLOTS):
            slot = memory[index]
            keys.append(tanh(params["h.W_key_memory"] @ slot))
            values.append(tanh(params["h.W_value_memory"] @ slot) * presence[PERIPHERAL_COUNT + index])
        key_trace = concatenate([key.reshape(1, ATTENTION_DIM) for key in keys], axis=0)
        value_trace = concatenate([value.reshape(1, ATTENTION_DIM) for value in values], axis=0)
        if not any(presence):
            zeros = Tensor(np.zeros(PERIPHERAL_COUNT + MEMORY_SLOTS, dtype=np.float64))
            return {
                "query": query,
                "keys": key_trace,
                "values": Tensor(np.zeros((PERIPHERAL_COUNT + MEMORY_SLOTS, ATTENTION_DIM), dtype=np.float64)),
                "raw_logits": zeros,
                "bounded_logits": Tensor(np.zeros(PERIPHERAL_COUNT + MEMORY_SLOTS, dtype=np.float64)),
                "masked_logits": Tensor(np.full(PERIPHERAL_COUNT + MEMORY_SLOTS, -1.0e9, dtype=np.float64)),
                "weights": zeros,
                "context": Tensor(np.zeros(ATTENTION_DIM, dtype=np.float64)),
            }
        raw_logits = concatenate(
            [((query * key).sum() / math.sqrt(ATTENTION_DIM)).reshape(1) for key in keys],
            axis=0,
        )
        bounded_logits = _attention_logit_tensor(raw_logits)
        masked_logits = concatenate(
            [
                bounded_logits[index].reshape(1)
                if present
                else Tensor(np.asarray([-1.0e9], dtype=np.float64))
                for index, present in enumerate(presence)
            ],
            axis=0,
        )
        weights = softmax(masked_logits)
        context = Tensor(np.zeros(ATTENTION_DIM, dtype=np.float64))
        for index in range(PERIPHERAL_COUNT + MEMORY_SLOTS):
            context = context + weights[index] * value_trace[index]
        return {
            "query": query,
            "keys": key_trace,
            "values": value_trace,
            "raw_logits": raw_logits,
            "bounded_logits": bounded_logits,
            "masked_logits": masked_logits,
            "weights": weights,
            "context": context,
        }

    def _tension_coefficients_numeric(
        self,
        module_presence: np.ndarray,
        contextual_prior: np.ndarray,
    ) -> dict[str, Any]:
        weights = [np.asarray(self.params[f"h.W_tension_{index}"], dtype=np.float64).copy() for index in range(PERIPHERAL_COUNT)]
        alpha = _bounded_parameter_numeric(self.params["h.alpha_raw"], ALPHA_MIN, ALPHA_MAX)
        effective_alpha = np.asarray(alpha, dtype=np.float64) * np.asarray(module_presence, dtype=np.float64)
        lambda_value = float(
            LAMBDA_MIN
            + (LAMBDA_MAX - LAMBDA_MIN)
            * _sigmoid_numeric(self.params["h.lambda_raw"])[0]
        )
        return {
            "weights": weights,
            "alpha": np.asarray(alpha, dtype=np.float64),
            "effective_alpha": effective_alpha,
            "lambda": lambda_value,
            "prior": np.asarray(contextual_prior, dtype=np.float64).copy(),
        }

    @staticmethod
    def _tension_energy_numeric(
        c: np.ndarray,
        proposals: np.ndarray,
        coefficients: Mapping[str, Any],
    ) -> float:
        energy = 0.5 * float(coefficients["lambda"]) * float(
            np.dot(c - coefficients["prior"], c - coefficients["prior"])
        )
        for index, weight in enumerate(coefficients["weights"]):
            residual = weight @ c - proposals[index]
            energy += 0.5 * float(coefficients["effective_alpha"][index]) * float(np.dot(residual, residual))
        return float(energy)

    @staticmethod
    def _tension_gradient_numeric(
        c: np.ndarray,
        proposals: np.ndarray,
        coefficients: Mapping[str, Any],
    ) -> np.ndarray:
        gradient = float(coefficients["lambda"]) * (c - coefficients["prior"])
        for index, weight in enumerate(coefficients["weights"]):
            residual = weight @ c - proposals[index]
            gradient = gradient + float(coefficients["effective_alpha"][index]) * (weight.T @ residual)
        return np.asarray(gradient, dtype=np.float64)

    def refine_tension(
        self,
        proposals: Sequence[Sequence[float]] | np.ndarray,
        c_prior_input: Sequence[float] | np.ndarray,
        *,
        module_presence: Sequence[float] | np.ndarray | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        """Run the two fixed-objective projected constraint refinements."""

        proposals_array = np.asarray(proposals, dtype=np.float64)
        if proposals_array.shape != (PERIPHERAL_COUNT, TENSION_DIM) or not np.isfinite(proposals_array).all():
            raise ValueError("tension proposals must be a finite (4, 4) array")
        c = np.asarray(c_prior_input, dtype=np.float64)
        if c.shape != (TENSION_STATE_DIM,) or not np.isfinite(c).all():
            raise ValueError("tension initial state must be a finite 12-D center vector")
        mask = _validate_presence(module_presence, PERIPHERAL_COUNT, name="module_presence")
        c = _project_numeric(c, TENSION_STATE_RADIUS)
        coefficients = self._tension_coefficients_numeric(mask, c)
        energies = [self._tension_energy_numeric(c, proposals_array, coefficients)]
        gradients = []
        step_size = 1.0 / (
            sum(
                float(coefficients["effective_alpha"][index]) * float(np.sum(weight * weight))
                for index, weight in enumerate(coefficients["weights"])
            )
            + float(coefficients["lambda"])
            + TENSION_EPSILON
        )
        for _ in range(REFINEMENT_STEPS):
            gradient = self._tension_gradient_numeric(c, proposals_array, coefficients)
            gradients.append(gradient.copy())
            c = _project_numeric(c - step_size * gradient, TENSION_STATE_RADIUS)
            energies.append(self._tension_energy_numeric(c, proposals_array, coefficients))
        return c, {
            "objective_coefficients": {
                "alpha": coefficients["alpha"].copy(),
                "effective_alpha": coefficients["effective_alpha"].copy(),
                "lambda": float(coefficients["lambda"]),
                "prior": coefficients["prior"].copy(),
                "weights": [weight.copy() for weight in coefficients["weights"]],
            },
            "energies": energies,
            "gradients": gradients,
            "step_size": float(step_size),
            "refinement_steps": REFINEMENT_STEPS,
        }

    @staticmethod
    def _tension_coefficients_tensor(
        params: Mapping[str, Tensor],
        module_presence: np.ndarray,
        contextual_prior: Tensor,
    ) -> dict[str, Any]:
        weights = [params[f"h.W_tension_{index}"] for index in range(PERIPHERAL_COUNT)]
        alpha = ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * sigmoid(params["h.alpha_raw"])
        effective_alpha = alpha * Tensor(module_presence)
        lambda_value = LAMBDA_MIN + (LAMBDA_MAX - LAMBDA_MIN) * sigmoid(params["h.lambda_raw"])[0]
        return {
            "weights": weights,
            "alpha": alpha,
            "effective_alpha": effective_alpha,
            "lambda": lambda_value,
            "prior": contextual_prior,
        }

    @staticmethod
    def _tension_energy_tensor(c: Tensor, proposals: Sequence[Tensor], coefficients: Mapping[str, Any]) -> Tensor:
        residual_prior = c - coefficients["prior"]
        energy = 0.5 * coefficients["lambda"] * (residual_prior * residual_prior).sum()
        for index, weight in enumerate(coefficients["weights"]):
            residual = weight @ c - proposals[index]
            energy = energy + 0.5 * coefficients["effective_alpha"][index] * (residual * residual).sum()
        return energy

    @staticmethod
    def _tension_gradient_tensor(c: Tensor, proposals: Sequence[Tensor], coefficients: Mapping[str, Any]) -> Tensor:
        gradient = coefficients["lambda"] * (c - coefficients["prior"])
        for index, weight in enumerate(coefficients["weights"]):
            residual = weight @ c - proposals[index]
            gradient = gradient + coefficients["effective_alpha"][index] * (weight.T @ residual)
        return gradient

    def _refine_tension_tensor(
        self,
        proposals: Sequence[Tensor],
        c_prior_input: Tensor,
        module_presence: np.ndarray,
        params: Mapping[str, Tensor],
    ) -> tuple[Tensor, dict[str, Any]]:
        module_presence = _validate_presence(module_presence, PERIPHERAL_COUNT, name="module_presence")
        c = _project_tensor(c_prior_input, TENSION_STATE_RADIUS)
        coefficients = self._tension_coefficients_tensor(params, module_presence, c)
        energies = [self._tension_energy_tensor(c, proposals, coefficients)]
        gradients: list[Tensor] = []
        lipschitz = Tensor(np.zeros(1, dtype=np.float64))
        for index, weight in enumerate(coefficients["weights"]):
            lipschitz = lipschitz + coefficients["effective_alpha"][index] * (weight * weight).sum()
        step_size = 1.0 / (lipschitz[0] + coefficients["lambda"] + TENSION_EPSILON)
        for _ in range(REFINEMENT_STEPS):
            gradient = self._tension_gradient_tensor(c, proposals, coefficients)
            gradients.append(gradient)
            c = _project_tensor(c - step_size * gradient, TENSION_STATE_RADIUS)
            energies.append(self._tension_energy_tensor(c, proposals, coefficients))
        return c, {
            "objective_coefficients": coefficients,
            "energies": energies,
            "gradients": gradients,
            "step_size": step_size,
            "refinement_steps": REFINEMENT_STEPS,
        }

    @staticmethod
    def _integrate_center_numeric(base_central: np.ndarray, refined_central: np.ndarray) -> np.ndarray:
        """Blend the refined center into the current bounded recurrent state."""

        return np.tanh(0.5 * np.asarray(base_central, dtype=np.float64) + 0.5 * np.asarray(refined_central, dtype=np.float64))

    def _hybrid_memory_write_numeric(
        self,
        memory: np.ndarray,
        integrated_central: np.ndarray,
    ) -> tuple[np.ndarray, dict[str, np.ndarray | float]]:
        """Write the integrated center into the existing learned memory maps."""

        address = _softmax_numeric(self.base.params["c.W_addr"] @ integrated_central)
        gate = float(_sigmoid_numeric(self.base.params["c.W_write_gate"] @ integrated_central + self.base.params["c.b_write_gate"])[0])
        value = np.tanh(self.base.params["c.W_value"] @ integrated_central + self.base.params["c.b_value"])
        updated = np.asarray(memory, dtype=np.float64) + gate * address[:, None] * (value[None, :] - memory)
        return updated, {
            "address": address,
            "gate": gate,
            "value": value,
        }

    @staticmethod
    def _hybrid_memory_write_tensor(
        memory: Tensor,
        integrated_central: Tensor,
        params: Mapping[str, Tensor],
    ) -> tuple[Tensor, dict[str, Tensor]]:
        address = softmax(params["c.W_addr"] @ integrated_central)
        gate = sigmoid(params["c.W_write_gate"] @ integrated_central + params["c.b_write_gate"])[0]
        value = tanh(params["c.W_value"] @ integrated_central + params["c.b_value"])
        updated = memory + gate * address.reshape(MEMORY_SLOTS, 1) * (value.reshape(1, MEMORY_DIM) - memory)
        return updated, {
            "address": address,
            "gate": gate,
            "value": value,
        }

    def _feedback_numeric(self, tension: np.ndarray, attention_context: np.ndarray) -> np.ndarray:
        tension_signal = np.tanh(self.params["h.W_tension_feedback"] @ np.asarray(tension, dtype=np.float64))
        combined = np.tanh(tension_signal + np.asarray(attention_context, dtype=np.float64))
        return np.asarray(
            [
                np.tanh(self.params["h.W_feedback_out"][index] @ combined + self.params["h.b_feedback_out"][index])
                for index in range(COMPARTMENT_COUNT)
            ],
            dtype=np.float64,
        )

    @staticmethod
    def _feedback_tensor(tension: Tensor, attention_context: Tensor, params: Mapping[str, Tensor]) -> Tensor:
        tension_signal = tanh(params["h.W_tension_feedback"] @ tension)
        combined = tanh(tension_signal + attention_context)
        rows = [
            tanh(params["h.W_feedback_out"][index] @ combined + params["h.b_feedback_out"][index]).reshape(1, MESSAGE_DIM)
            for index in range(COMPARTMENT_COUNT)
        ]
        return concatenate(rows, axis=0)

    def step(
        self,
        runtime: Mapping[str, Any],
        vector: Sequence[float] | np.ndarray,
        *,
        dt: float = DEFAULT_DT,
        module_presence: Sequence[float] | np.ndarray | None = None,
        memory_presence: Sequence[float] | np.ndarray | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Advance one causal numeric step of the hybrid core."""

        self._validate_runtime(runtime)
        vector = _validate_vector(vector)
        dt = _validate_dt(dt)
        module_mask = _validate_presence(
            runtime["module_presence"] if module_presence is None else module_presence,
            PERIPHERAL_COUNT,
            name="module_presence",
        )
        memory_mask = _validate_presence(
            runtime["memory_presence"] if memory_presence is None else memory_presence,
            MEMORY_SLOTS,
            name="memory_presence",
        )
        injected_base = self._inject_feedback_numeric(runtime)
        base_next, base_trace = self.base._numeric_forward(injected_base, vector)
        gamma, omega = self._gamma_omega_numeric()
        oscillators = np.zeros((COMPARTMENT_COUNT, OSCILLATOR_PAIRS, OSCILLATOR_DIM), dtype=np.float64)
        forcing = np.zeros((COMPARTMENT_COUNT, OSCILLATOR_COMPONENTS), dtype=np.float64)
        compartment_states = list(base_next["peripheral"]) + [base_next["central"]]
        force_maps = [self.params[f"h.W_osc_force_p{index}"] for index in range(PERIPHERAL_COUNT)] + [self.params["h.W_osc_force_c"]]
        for compartment, state in enumerate(compartment_states):
            forcing[compartment] = force_maps[compartment] @ state
            for pair in range(OSCILLATOR_PAIRS):
                start = pair * OSCILLATOR_DIM
                oscillators[compartment, pair] = advance_oscillator(
                    runtime["oscillators"][compartment, pair],
                    forcing[compartment, start : start + OSCILLATOR_DIM],
                    float(gamma[compartment, pair]),
                    float(omega[compartment, pair]),
                    dt,
                )
        messages = np.zeros((COMPARTMENT_COUNT, MESSAGE_DIM), dtype=np.float64)
        for index in range(PERIPHERAL_COUNT):
            messages[index] = np.tanh(
                self.params[f"h.W_message_p{index}"]
                @ np.concatenate((base_next["peripheral"][index], oscillators[index].reshape(-1)))
                + self.params[f"h.b_message_p{index}"]
            )
        messages[PERIPHERAL_COUNT] = np.tanh(
            self.params["h.W_message_c"]
            @ np.concatenate((base_next["central"], oscillators[PERIPHERAL_COUNT].reshape(-1)))
            + self.params["h.b_message_c"]
        )
        attention = self._attention_numeric(
            messages[:PERIPHERAL_COUNT],
            base_next["memory"],
            base_next["central"],
            messages[PERIPHERAL_COUNT],
            module_mask,
            memory_mask,
            self.params,
        )
        proposals = messages[:PERIPHERAL_COUNT] * module_mask[:, None]
        contextual_prior = base_next["central"] + np.tanh(
            self.params["h.W_attention_to_tension"] @ attention["context"]
        )
        tension, tension_trace = self.refine_tension(
            proposals,
            contextual_prior,
            module_presence=module_mask,
        )
        integrated_central = self._integrate_center_numeric(base_next["central"], tension)
        integrated_memory, hybrid_memory_trace = self._hybrid_memory_write_numeric(
            base_next["memory"],
            integrated_central,
        )
        feedback = self._feedback_numeric(tension, attention["context"])
        next_runtime = {
            "peripheral": [value.copy() for value in base_next["peripheral"]],
            "central": integrated_central,
            "memory": integrated_memory,
            "oscillators": oscillators,
            "feedback": feedback,
            "time": float(runtime["time"]) + dt,
            "step": _validate_step_counter(runtime["step"]) + 1,
            "module_presence": module_mask,
            "memory_presence": memory_mask,
        }
        self._validate_runtime(next_runtime)
        trace = {
            "time": next_runtime["time"],
            "dt": dt,
            "base": base_trace,
            "oscillators": oscillators.copy(),
            "forcing": forcing,
            "gamma": gamma.copy(),
            "omega": omega.copy(),
            "messages": messages.copy(),
            "attention": attention,
            "contextual_prior": contextual_prior.copy(),
            "tension": tension_trace,
            "tension_refined": tension.copy(),
            "integrated_central": integrated_central.copy(),
            "integrated_memory": integrated_memory.copy(),
            "hybrid_memory_write": hybrid_memory_trace,
            "feedback": feedback.copy(),
            "module_presence": module_mask.copy(),
            "memory_presence": memory_mask.copy(),
            "mask_scope": "hybrid_attention_and_tension_only",
        }
        return next_runtime, trace

    def tensor_parameters(self, *, requires_grad: bool = True) -> dict[str, Tensor]:
        return {
            **{
                f"base.{name}": Tensor(value.copy(), requires_grad=requires_grad)
                for name, value in self.base.params.items()
            },
            **{
                name: Tensor(value.copy(), requires_grad=requires_grad)
                for name, value in self.params.items()
            },
        }

    def tensor_initial_runtime(
        self,
        *,
        memory: Sequence[Sequence[float]] | np.ndarray | None = None,
        module_presence: Sequence[float] | np.ndarray | None = None,
        memory_presence: Sequence[float] | np.ndarray | None = None,
    ) -> dict[str, Any]:
        numeric = self.initial_runtime(
            memory=memory,
            module_presence=module_presence,
            memory_presence=memory_presence,
        )
        return {
            "peripheral": [Tensor(value) for value in numeric["peripheral"]],
            "central": Tensor(numeric["central"]),
            "memory": Tensor(numeric["memory"]),
            "oscillators": Tensor(numeric["oscillators"]),
            "feedback": Tensor(numeric["feedback"]),
            "time": numeric["time"],
            "step": numeric["step"],
            "module_presence": numeric["module_presence"],
            "memory_presence": numeric["memory_presence"],
        }

    @staticmethod
    def _tensor_base_runtime(runtime: Mapping[str, Any], params: Mapping[str, Tensor]) -> dict[str, Any]:
        peripheral = []
        for index in range(PERIPHERAL_COUNT):
            peripheral.append(
                runtime["peripheral"][index]
                + tanh(params[f"h.W_feedback_in_p{index}"] @ runtime["feedback"][index])
            )
        central = runtime["central"] + tanh(params["h.W_feedback_in_c"] @ runtime["feedback"][PERIPHERAL_COUNT])
        return {
            "peripheral": peripheral,
            "central": central,
            "memory": runtime["memory"],
        }

    def _tensor_step(
        self,
        runtime: Mapping[str, Any],
        vector: Sequence[float] | np.ndarray,
        *,
        dt: float,
        module_presence: np.ndarray,
        memory_presence: np.ndarray,
        params: Mapping[str, Tensor],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        self._validate_tensor_runtime(runtime)
        vector = _validate_vector(vector)
        dt = _validate_dt(dt)
        base_params = {name[5:]: value for name, value in params.items() if name.startswith("base.")}
        injected_base = self._tensor_base_runtime(runtime, params)
        base_next, _, _, base_trace = self.base._tensor_forward(
            injected_base,
            vector,
            base_params,
        )
        gamma, omega = self._gamma_omega_tensor(params)
        oscillators_rows: list[Tensor] = []
        forcing_rows: list[Tensor] = []
        compartment_states = list(base_next["peripheral"]) + [base_next["central"]]
        force_maps = [params[f"h.W_osc_force_p{index}"] for index in range(PERIPHERAL_COUNT)] + [params["h.W_osc_force_c"]]
        for compartment, state in enumerate(compartment_states):
            forcing = force_maps[compartment] @ state
            forcing_rows.append(forcing)
            pairs = []
            for pair in range(OSCILLATOR_PAIRS):
                start = pair * OSCILLATOR_DIM
                pairs.append(
                    _advance_oscillator_tensor(
                        runtime["oscillators"][compartment, pair],
                        forcing[start : start + OSCILLATOR_DIM],
                        gamma[compartment, pair],
                        omega[compartment, pair],
                        dt,
                    ).reshape(1, OSCILLATOR_DIM)
                )
            oscillators_rows.append(concatenate(pairs, axis=0))
        oscillators = concatenate([row.reshape(1, OSCILLATOR_PAIRS, OSCILLATOR_DIM) for row in oscillators_rows], axis=0)
        messages = []
        for index in range(PERIPHERAL_COUNT):
            input_row = concatenate(
                (base_next["peripheral"][index], oscillators[index].reshape(OSCILLATOR_COMPONENTS)),
                axis=0,
            )
            messages.append(
                tanh(params[f"h.W_message_p{index}"] @ input_row + params[f"h.b_message_p{index}"])
            )
        center_input = concatenate(
            (base_next["central"], oscillators[PERIPHERAL_COUNT].reshape(OSCILLATOR_COMPONENTS)),
            axis=0,
        )
        messages.append(tanh(params["h.W_message_c"] @ center_input + params["h.b_message_c"]))
        attention = self._attention_tensor(
            messages[:PERIPHERAL_COUNT],
            base_next["memory"],
            base_next["central"],
            messages[PERIPHERAL_COUNT],
            module_presence,
            memory_presence,
            params,
        )
        proposals = [messages[index] * float(module_presence[index]) for index in range(PERIPHERAL_COUNT)]
        contextual_prior = base_next["central"] + tanh(
            params["h.W_attention_to_tension"] @ attention["context"]
        )
        tension, tension_trace = self._refine_tension_tensor(
            proposals,
            contextual_prior,
            module_presence,
            params,
        )
        integrated_central_tensor = tanh(
            0.5 * base_next["central"] + 0.5 * tension
        )
        integrated_memory, hybrid_memory_trace = self._hybrid_memory_write_tensor(
            base_next["memory"],
            integrated_central_tensor,
            base_params,
        )
        feedback = self._feedback_tensor(tension, attention["context"], params)
        next_runtime = {
            "peripheral": base_next["peripheral"],
            "central": integrated_central_tensor,
            "memory": integrated_memory,
            "oscillators": oscillators,
            "feedback": feedback,
            "time": float(runtime["time"]) + dt,
            "step": _validate_step_counter(runtime["step"]) + 1,
            "module_presence": module_presence.copy(),
            "memory_presence": memory_presence.copy(),
        }
        return next_runtime, {
            "time": next_runtime["time"],
            "dt": dt,
            "base": base_trace,
            "oscillators": oscillators,
            "forcing": forcing_rows,
            "gamma": gamma,
            "omega": omega,
            "messages": messages,
            "attention": attention,
            "contextual_prior": contextual_prior,
            "tension": tension_trace,
            "tension_refined": tension,
            "integrated_central": integrated_central_tensor,
            "integrated_memory": integrated_memory,
            "hybrid_memory_write": hybrid_memory_trace,
            "feedback": feedback,
            "module_presence": module_presence.copy(),
            "memory_presence": memory_presence.copy(),
            "mask_scope": "hybrid_attention_and_tension_only",
        }

    def tensor_step(
        self,
        runtime: Mapping[str, Any],
        vector: Sequence[float] | np.ndarray,
        *,
        dt: float = DEFAULT_DT,
        module_presence: Sequence[float] | np.ndarray | None = None,
        memory_presence: Sequence[float] | np.ndarray | None = None,
        params: Mapping[str, Tensor] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Advance the same core with existing eager reverse-mode tensors."""

        self._validate_tensor_runtime(runtime)
        if params is None:
            params = self.tensor_parameters(requires_grad=True)
        module_mask = _validate_presence(
            runtime["module_presence"] if module_presence is None else module_presence,
            PERIPHERAL_COUNT,
            name="module_presence",
        )
        memory_mask = _validate_presence(
            runtime["memory_presence"] if memory_presence is None else memory_presence,
            MEMORY_SLOTS,
            name="memory_presence",
        )
        return self._tensor_step(
            runtime,
            vector,
            dt=dt,
            module_presence=module_mask,
            memory_presence=memory_mask,
            params=params,
        )

    @staticmethod
    def _probe_array(shape: tuple[int, ...], start: float) -> np.ndarray:
        return np.linspace(start, start + 0.17, int(np.prod(shape)), dtype=np.float64).reshape(shape)

    def loss_and_gradients(
        self,
        vectors: Sequence[Sequence[float] | np.ndarray],
        *,
        dt: float = DEFAULT_DT,
        initial_runtime: Mapping[str, Any] | None = None,
    ) -> tuple[float, dict[str, np.ndarray], list[dict[str, Any]]]:
        """Return a deterministic structural gradient probe, never a train loss.

        The scalar combines bounded internal states with fixed probes so
        finite-difference tests can reach oscillator, attention, tension, and
        memory parameters.  It is not a factual target or an agreement loss.
        """

        if not vectors:
            raise ValueError("at least one vector is required")
        dt = _validate_dt(dt)
        params = self.tensor_parameters(requires_grad=True)
        if initial_runtime is None:
            runtime = self.tensor_initial_runtime()
        else:
            self._validate_runtime(initial_runtime)
            runtime = {
                "peripheral": [Tensor(value) for value in initial_runtime["peripheral"]],
                "central": Tensor(initial_runtime["central"]),
                "memory": Tensor(initial_runtime["memory"]),
                "oscillators": Tensor(initial_runtime["oscillators"]),
                "feedback": Tensor(initial_runtime["feedback"]),
                "time": float(initial_runtime["time"]),
                "step": _validate_step_counter(initial_runtime["step"]),
                "module_presence": np.asarray(initial_runtime["module_presence"], dtype=np.float64).copy(),
                "memory_presence": np.asarray(initial_runtime["memory_presence"], dtype=np.float64).copy(),
            }
        objective = Tensor(0.0)
        traces = []
        attention_probe = Tensor(self._probe_array((ATTENTION_DIM,), 0.13))
        tension_probe = Tensor(self._probe_array((TENSION_STATE_DIM,), 0.19))
        central_probe = Tensor(self._probe_array((CENTER_HIDDEN,), 0.21))
        feedback_probe = Tensor(self._probe_array((COMPARTMENT_COUNT, MESSAGE_DIM), 0.23))
        memory_probe = Tensor(self._probe_array(self.central_memory_shape, 0.29))
        for vector in vectors:
            runtime, trace = self.tensor_step(runtime, vector, dt=dt, params=params)
            traces.append(trace)
            objective = objective + 0.17 * (trace["attention"]["context"] * attention_probe).sum()
            objective = objective + 0.19 * (trace["tension_refined"] * tension_probe).sum()
            objective = objective + 0.11 * (trace["integrated_central"] * central_probe).sum()
            objective = objective + 0.13 * (trace["feedback"] * feedback_probe).sum()
            objective = objective + 0.07 * (trace["integrated_memory"] * memory_probe).sum()
        objective = objective / float(len(vectors))
        objective.backward()
        gradients = {name: value.grad.copy() for name, value in params.items()}
        if not math.isfinite(float(objective.data)) or not all(np.isfinite(value).all() for value in gradients.values()):
            raise ValueError("hybrid gradient probe produced a non-finite result")
        return float(objective.data), gradients, traces

    def loss_only(
        self,
        vectors: Sequence[Sequence[float] | np.ndarray],
        *,
        dt: float = DEFAULT_DT,
        initial_runtime: Mapping[str, Any] | None = None,
    ) -> float:
        return self.loss_and_gradients(vectors, dt=dt, initial_runtime=initial_runtime)[0]

    def snapshot_runtime(self, runtime: Mapping[str, Any]) -> dict[str, Any]:
        self._validate_runtime(runtime)
        return {
            "schema": HYBRID_CORE_SCHEMA,
            "model_version": HYBRID_CORE_MODEL_VERSION,
            "parameter_digest": self.parameter_digest(),
            "parameter_budget": self.parameter_budget_audit(),
            "base_runtime": {
                "peripheral": [np.asarray(value, dtype=np.float64).tolist() for value in runtime["peripheral"]],
                "central": np.asarray(runtime["central"], dtype=np.float64).tolist(),
                "memory": np.asarray(runtime["memory"], dtype=np.float64).tolist(),
            },
            "oscillators": np.asarray(runtime["oscillators"], dtype=np.float64).tolist(),
            "feedback": np.asarray(runtime["feedback"], dtype=np.float64).tolist(),
            "time": float(runtime["time"]),
            "step": _validate_step_counter(runtime["step"]),
            "module_presence": np.asarray(runtime["module_presence"], dtype=np.float64).tolist(),
            "memory_presence": np.asarray(runtime["memory_presence"], dtype=np.float64).tolist(),
        }

    def restore_runtime(self, snapshot: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(snapshot, Mapping) or snapshot.get("schema") != HYBRID_CORE_SCHEMA:
            raise HybridCoreSnapshotError("unsupported hybrid runtime snapshot")
        if snapshot.get("model_version") != HYBRID_CORE_MODEL_VERSION:
            raise HybridCoreSnapshotError("hybrid runtime model version mismatch")
        if snapshot.get("parameter_digest") != self.parameter_digest():
            raise HybridCoreSnapshotError("hybrid runtime parameter digest mismatch")
        base = snapshot.get("base_runtime")
        if not isinstance(base, Mapping):
            raise HybridCoreSnapshotError("hybrid runtime base state is missing")
        try:
            runtime = {
                "peripheral": [np.asarray(value, dtype=np.float64).reshape(PERIPHERAL_HIDDEN).copy() for value in base["peripheral"]],
                "central": np.asarray(base["central"], dtype=np.float64).reshape(CENTER_HIDDEN).copy(),
                "memory": np.asarray(base["memory"], dtype=np.float64).reshape(self.central_memory_shape).copy(),
                "oscillators": np.asarray(snapshot["oscillators"], dtype=np.float64).reshape(
                    COMPARTMENT_COUNT, OSCILLATOR_PAIRS, OSCILLATOR_DIM
                ).copy(),
                "feedback": np.asarray(snapshot["feedback"], dtype=np.float64).reshape(
                    COMPARTMENT_COUNT, MESSAGE_DIM
                ).copy(),
                "time": float(snapshot["time"]),
                "step": _validate_step_counter(snapshot["step"], name="snapshot step"),
                "module_presence": np.asarray(snapshot["module_presence"], dtype=np.float64).reshape(PERIPHERAL_COUNT).copy(),
                "memory_presence": np.asarray(snapshot["memory_presence"], dtype=np.float64).reshape(MEMORY_SLOTS).copy(),
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise HybridCoreSnapshotError("hybrid runtime snapshot has invalid state shapes") from exc
        try:
            self._validate_runtime(runtime)
        except (TypeError, ValueError) as exc:
            raise HybridCoreSnapshotError("hybrid runtime snapshot contains invalid state") from exc
        return runtime


__all__ = [
    "ALPHA_MAX",
    "ALPHA_MIN",
    "ATTENTION_DIM",
    "ATTENTION_LOGIT_BOUND",
    "CENTER_HIDDEN",
    "COMPARTMENT_COUNT",
    "DEFAULT_DT",
    "GAMMA_MAX",
    "GAMMA_MIN",
    "HYBRID_CORE_MODEL_VERSION",
    "HYBRID_CORE_SCHEMA",
    "HybridCoreParameterBudgetError",
    "HybridCoreSnapshotError",
    "INCREMENTAL_PARAMETER_CAP",
    "LAMBDA_MAX",
    "LAMBDA_MIN",
    "MAX_SUPPORTED_DT",
    "MEMORY_DIM",
    "MEMORY_SLOTS",
    "MESSAGE_DIM",
    "OMEGA_MAX",
    "OSCILLATOR_COMPONENTS",
    "OSCILLATOR_PAIRS",
    "OSCILLATOR_SMALL_DT",
    "PERIPHERAL_COUNT",
    "PERIPHERAL_HIDDEN",
    "REFINEMENT_STEPS",
    "TENSION_STATE_RADIUS",
    "TENSION_STATE_DIM",
    "TIME_UNIT",
    "V03HybridCore",
    "advance_oscillator",
]
