"""Small differentiable policies for the corrected v0.3 protocol.

The policy boundary is intentionally narrow: callers pass only the dictionary
returned by ``CorrectedEpisode.policy_observation()``.  The encoder does not
inspect an episode or a world.  The full policy has four recurrent peripheral
modules and one gated recurrent center with differentiable addressable memory;
the control has one recurrent controller with the same input, memory, tools,
and optimizer budget.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import math

import numpy as np

from .autograd import Tensor, concatenate, log, sigmoid, softmax, tanh
from .v03_protocol import PROBE_FREQUENCIES


NOTE_TITLE_BYTES = 32
NOTE_TEXT_BYTES = 96
MEMORY_SLOTS = 2
MEMORY_DIM = 6
ACTION_DIM = 4
PERIPHERAL_COUNT = 4

# The first four features are explicit modality/payload masks.  They replace
# the old stage one-hot: a note may be present while its goal-bearing payload
# is intentionally hidden, and that state must not be normalized as a present
# target-bearing note.
NOTE_MASK_INDEX = 0
SPECTRUM_MASK_INDEX = 1
FEEDBACK_MASK_INDEX = 2
NOTE_PAYLOAD_MASK_INDEX = 3
NOTE_FEATURE_START = 4
NOTE_METADATA_FEATURE_END = NOTE_FEATURE_START + 3
NOTE_BYTE_FEATURE_START = NOTE_METADATA_FEATURE_END
NOTE_BYTE_FEATURE_END = NOTE_BYTE_FEATURE_START + NOTE_TITLE_BYTES + NOTE_TEXT_BYTES
NOTE_FEATURE_END = NOTE_BYTE_FEATURE_END
NOTE_TEXT_FEATURE_START = NOTE_BYTE_FEATURE_START + NOTE_TITLE_BYTES
NOTE_TARGET_FREQUENCY_BYTE_INDEX = NOTE_TEXT_FEATURE_START + len("target_hz=")
SPECTRUM_FEATURE_START = NOTE_FEATURE_END + 1
SPECTRUM_FEATURE_END = SPECTRUM_FEATURE_START + 4 + 16
RESPONSE_FEATURE_START = SPECTRUM_FEATURE_START + 4
RESPONSE_FEATURE_END = SPECTRUM_FEATURE_END
RESPONSE_FEATURE_INDICES = tuple(range(RESPONSE_FEATURE_START, RESPONSE_FEATURE_END))
SPECTRUM_FREQUENCY_FEATURE_INDICES = tuple(range(SPECTRUM_FEATURE_START, RESPONSE_FEATURE_START))
LEGACY_INPUT_NORMALIZATION_SCHEMA = "vevo.v03.input-normalization.v1"
SHARED_RESPONSE_INPUT_NORMALIZATION_SCHEMA = "vevo.v03.input-normalization.v2"
SHARED_RESPONSE_SCALING_METHOD = "shared_max_abs"
LEGACY_GATE_HEAD = "legacy_action_matrix"
SHARED_ROW_GATE_HEAD = "shared_row_scorer"
GATE_HEAD_CHOICES = (LEGACY_GATE_HEAD, SHARED_ROW_GATE_HEAD)
SHARED_ROW_FEATURE_DIM = 4
SHARED_ROW_HEAD_RNG_SALT_FULL = 0x5EED5101
SHARED_ROW_HEAD_RNG_SALT_CONTROL = 0x5EED5102


def _byte_block(value: str, width: int) -> list[float]:
    """Encode exact visible text bytes within the declared neural window.

    Authoritative storage may contain longer Unicode text, but a policy input
    that cannot be represented in full is rejected rather than silently
    presenting a misleading prefix to the neural computation.
    """

    encoded = str(value).encode("utf-8")
    if len(encoded) > width:
        raise ValueError(f"text exceeds bounded neural input window of {width} UTF-8 bytes")
    result = np.zeros(width, dtype=np.float64)
    if encoded:
        result[: len(encoded)] = np.frombuffer(encoded, dtype=np.uint8).astype(np.float64) / 255.0
    return result.tolist()


def _number(value, scale: float = 1.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(number):
        return 0.0
    return float(np.clip(number / scale, -10.0, 10.0))


def _note_payload_available(note: dict, note_present: bool) -> bool:
    """Distinguish a hidden payload from a valid empty note.

    Retention interventions clear both text and content digest.  A genuinely
    empty stored note still has its authoritative non-empty content digest,
    so it remains a valid payload-bearing note rather than being conflated
    with the hidden intervention.
    """

    if not note_present:
        return False
    return bool(str(note.get("text", "")) or str(note.get("content_digest", "")))


def _stage_from_policy(policy_observation: dict) -> int:
    note = policy_observation.get("note")
    measurement = policy_observation.get("measurement")
    if note is None:
        return 0
    if measurement is None:
        return 1
    return 2


def encode_policy_observation(policy_observation: dict) -> np.ndarray:
    """Turn only the whitelisted typed policy observation into model input.

    In particular, this function never accepts an episode or raw world array.
    The note text is carried as bounded bytes and the diagnostic matrix is
    carried without reducing it to an evaluator answer or argmax.
    """

    if not isinstance(policy_observation, dict):
        raise TypeError("policy observation must be a dictionary")
    if policy_observation.get("schema") != "vevo.v03.policy-observation.v1":
        raise ValueError("unsupported policy observation schema")
    note = policy_observation.get("note") or {}
    measurement = policy_observation.get("measurement") or {}
    feedback = policy_observation.get("feedback") or {}
    resources = policy_observation.get("resources") or {}
    values: list[float] = []

    # Presence is distinct from acceptance.  A rejected typed result is still
    # an observed modality and must not be confused with an absent result.
    note_present = policy_observation.get("note") is not None
    values.extend([
        float(note_present),
        float(policy_observation.get("measurement") is not None),
        float(policy_observation.get("feedback") is not None),
        float(_note_payload_available(note, note_present)),
    ])

    note_text = str(note.get("text", ""))
    values.extend([
        _number(note.get("accepted", False)),
        _number(note.get("revision", 0), 4.0),
        _number(len(note_text.encode("utf-8")), float(NOTE_TEXT_BYTES)),
    ])
    values.extend(_byte_block(str(note.get("title", "")), NOTE_TITLE_BYTES))
    values.extend(_byte_block(note_text, NOTE_TEXT_BYTES))

    frequencies = np.asarray(measurement.get("probe_frequencies", np.zeros(4)), dtype=np.float64)
    if frequencies.shape != (4,):
        frequencies = np.zeros(4, dtype=np.float64)
    matrix = np.asarray(measurement.get("channel_response", np.zeros((4, 4))), dtype=np.float64)
    if matrix.shape != (4, 4):
        matrix = np.zeros((4, 4), dtype=np.float64)
    matrix = np.nan_to_num(matrix, nan=0.0, posinf=10.0, neginf=-10.0)
    values.extend([_number(measurement.get("accepted", False))])
    values.extend(np.clip(frequencies / 2.0, -10.0, 10.0).tolist())
    values.extend(np.clip(matrix.reshape(-1), -10.0, 10.0).tolist())
    values.extend([
        _number(measurement.get("probe_steps", 0), 1280.0),
        _number(measurement.get("probe_work", 0.0), 7.0),
        _number(measurement.get("pure_measurement", False)),
        _number(measurement.get("virtual_steps_total", 0), 1280.0),
        _number(measurement.get("virtual_work_total", 0.0), 7.0),
        _number(measurement.get("resource_budget_ok", False)),
    ])

    values.extend([
        _number(feedback.get("accepted", False)),
        _number(feedback.get("gate_opened", False)),
        _number(feedback.get("drive_frequency", 0.0), 2.0),
        _number(feedback.get("work_delta", 0.0), 1.2),
        _number(feedback.get("work_budget", 0.0), 1.2),
        _number(feedback.get("tool_calls", 0), 3.0),
        _number(feedback.get("tool_budget", 0), 3.0),
        _number(feedback.get("tool_budget_ok", False)),
        _number(feedback.get("virtual_steps", 0), 1280.0),
        _number(feedback.get("virtual_work", 0.0), 7.0),
    ])

    values.extend([
        _number(resources.get("tool_calls", 0), 3.0),
        _number(resources.get("tool_budget", 0), 3.0),
        _number(resources.get("virtual_steps", 0), 1280.0),
        _number(resources.get("virtual_step_budget", 0), 1280.0),
        _number(resources.get("virtual_work", 0.0), 7.0),
        _number(resources.get("virtual_work_budget", 0.0), 7.0),
    ])
    result = np.asarray(values, dtype=np.float64)
    if result.shape != (POLICY_VECTOR_DIM,) or not np.isfinite(result).all():
        raise ValueError("invalid encoded policy observation")
    return result


POLICY_VECTOR_DIM = 4 + 3 + NOTE_TITLE_BYTES + NOTE_TEXT_BYTES + 1 + 4 + 16 + 6 + 10 + 6


def _fit_present_group_statistics(
    raw: np.ndarray,
    *,
    mask_index: int,
    columns: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, int]:
    """Fit the historical per-column statistics for one masked modality."""

    mean = np.zeros(POLICY_VECTOR_DIM, dtype=np.float64)
    scale = np.ones(POLICY_VECTOR_DIM, dtype=np.float64)
    present = raw[:, mask_index] > 0.5
    count = int(np.count_nonzero(present))
    if not np.any(present):
        return mean, scale, count
    selected = raw[present][:, columns]
    mean[columns] = np.mean(selected, axis=0)
    spread = np.std(selected, axis=0)
    # Constant columns should remain on their original scale.  Using a
    # tiny epsilon for a constant revision/byte column would amplify an
    # ordinary future change by 1,000x.
    constant = np.isclose(spread, 0.0, rtol=0.0, atol=1e-12)
    scale[columns] = np.where(constant, 1.0, np.maximum(spread, 1e-3))
    return mean, scale, count


def _fit_shared_max_abs_scale(values: np.ndarray) -> dict:
    """Fit one finite max-absolute response scale with explicit fallbacks.

    This helper intentionally does not center, clip, or fit one scale per
    response coordinate.  Invalid values are excluded from the fit and are
    counted.  An all-invalid or all-zero fit uses a unit scale so inference
    remains finite and deterministic; inference itself fails closed if a
    non-finite vector reaches the normalization boundary.
    """

    array = np.asarray(values, dtype=np.float64).reshape(-1)
    finite = np.isfinite(array)
    finite_values = array[finite]
    invalid_count = int(np.count_nonzero(~finite))
    if finite_values.size == 0:
        return {
            "scale": 1.0,
            "max_abs": 0.0,
            "finite_coordinate_count": 0,
            "invalid_coordinate_count": invalid_count,
            "fallback": "unit_scale_no_finite_values",
        }
    max_abs = float(np.max(np.abs(finite_values)))
    if not math.isfinite(max_abs) or max_abs <= 0.0:
        return {
            "scale": 1.0,
            "max_abs": 0.0 if not math.isfinite(max_abs) else max_abs,
            "finite_coordinate_count": int(finite_values.size),
            "invalid_coordinate_count": invalid_count,
            "fallback": "unit_scale_all_finite_values_zero",
        }
    return {
        "scale": max_abs,
        "max_abs": max_abs,
        "finite_coordinate_count": int(finite_values.size),
        "invalid_coordinate_count": invalid_count,
        "fallback": None,
    }


def fit_shared_max_abs_input_normalization(policy_observations: list[dict]) -> dict:
    """Fit training-only normalization with one shared response-block scale.

    Note-byte and probe-frequency features retain the established masked
    statistics.  The 16 response coordinates are the exception: their mean
    is exactly zero and all are divided by one max-absolute scale fitted over
    the finite response values from present training measurements only.
    """

    if not policy_observations:
        raise ValueError("policy observations are required for normalization")
    raw = np.stack([encode_policy_observation(item) for item in policy_observations])
    mean = np.zeros(POLICY_VECTOR_DIM, dtype=np.float64)
    scale = np.ones(POLICY_VECTOR_DIM, dtype=np.float64)
    note_mean, note_scale, note_count = _fit_present_group_statistics(
        raw,
        mask_index=NOTE_PAYLOAD_MASK_INDEX,
        columns=np.arange(NOTE_BYTE_FEATURE_START, NOTE_BYTE_FEATURE_END),
    )
    mean[NOTE_BYTE_FEATURE_START:NOTE_BYTE_FEATURE_END] = note_mean[
        NOTE_BYTE_FEATURE_START:NOTE_BYTE_FEATURE_END
    ]
    scale[NOTE_BYTE_FEATURE_START:NOTE_BYTE_FEATURE_END] = note_scale[
        NOTE_BYTE_FEATURE_START:NOTE_BYTE_FEATURE_END
    ]
    frequency_mean, frequency_scale, spectrum_count = _fit_present_group_statistics(
        raw,
        mask_index=SPECTRUM_MASK_INDEX,
        columns=np.arange(SPECTRUM_FEATURE_START, RESPONSE_FEATURE_START),
    )
    mean[SPECTRUM_FEATURE_START:RESPONSE_FEATURE_START] = frequency_mean[
        SPECTRUM_FEATURE_START:RESPONSE_FEATURE_START
    ]
    scale[SPECTRUM_FEATURE_START:RESPONSE_FEATURE_START] = frequency_scale[
        SPECTRUM_FEATURE_START:RESPONSE_FEATURE_START
    ]
    present = raw[:, SPECTRUM_MASK_INDEX] > 0.5
    response_values = raw[present][:, np.asarray(RESPONSE_FEATURE_INDICES, dtype=np.int64)]
    response_fit = _fit_shared_max_abs_scale(response_values)
    response_scale = float(response_fit["scale"])
    return {
        "schema": SHARED_RESPONSE_INPUT_NORMALIZATION_SCHEMA,
        "mean": mean.tolist(),
        "scale": scale.tolist(),
        "counts": {
            "note_bytes": int(note_count),
            "spectrum": int(spectrum_count),
            "response": int(np.count_nonzero(present)),
        },
        "normalized_groups": {
            "note_bytes": [int(NOTE_BYTE_FEATURE_START), int(NOTE_BYTE_FEATURE_END)],
            "spectrum": [int(SPECTRUM_FEATURE_START), int(SPECTRUM_FEATURE_END)],
            "spectrum_frequencies": [int(SPECTRUM_FEATURE_START), int(RESPONSE_FEATURE_START)],
            "response": [int(RESPONSE_FEATURE_START), int(RESPONSE_FEATURE_END)],
        },
        "response_scaling": {
            "method": SHARED_RESPONSE_SCALING_METHOD,
            "feature_indices": [int(index) for index in RESPONSE_FEATURE_INDICES],
            "scale": response_scale,
            "max_abs": float(response_fit["max_abs"]),
            "fit_scope": "present training observations only",
            "fit_observation_count": int(np.count_nonzero(present)),
            "finite_coordinate_count": int(response_fit["finite_coordinate_count"]),
            "invalid_coordinate_count": int(response_fit["invalid_coordinate_count"]),
            "fallback": response_fit["fallback"],
            "zero_or_invalid_fallback_scale": 1.0,
            "centering": "none",
            "clipping": "none",
        },
    }


def fit_input_normalization(
    policy_observations: list[dict],
    *,
    response_scaling: str = "legacy_per_coordinate",
) -> dict:
    """Fit present-modality statistics from training observations only.

    The returned plain dictionary is checkpoint-friendly and deliberately
    keeps the modality masks, note metadata, and acceptance/resource fields
    untouched.  Only note byte payload features and measured spectrum values
    are standardized.
    """

    if response_scaling == SHARED_RESPONSE_SCALING_METHOD:
        return fit_shared_max_abs_input_normalization(policy_observations)
    if response_scaling != "legacy_per_coordinate":
        raise ValueError(f"unsupported response scaling mode: {response_scaling}")
    if not policy_observations:
        raise ValueError("policy observations are required for normalization")
    raw = np.stack([encode_policy_observation(item) for item in policy_observations])
    mean = np.zeros(POLICY_VECTOR_DIM, dtype=np.float64)
    scale = np.ones(POLICY_VECTOR_DIM, dtype=np.float64)
    counts = {}
    groups = {
        "note_bytes": (NOTE_PAYLOAD_MASK_INDEX, np.arange(NOTE_BYTE_FEATURE_START, NOTE_BYTE_FEATURE_END)),
        "spectrum": (SPECTRUM_MASK_INDEX, np.arange(SPECTRUM_FEATURE_START, SPECTRUM_FEATURE_END)),
    }
    for name, (mask_index, columns) in groups.items():
        present = raw[:, mask_index] > 0.5
        counts[name] = int(np.count_nonzero(present))
        if not np.any(present):
            continue
        selected = raw[present][:, columns]
        mean[columns] = np.mean(selected, axis=0)
        spread = np.std(selected, axis=0)
        # Constant columns should remain on their original scale.  Using a
        # tiny epsilon for a constant revision/byte column would amplify an
        # ordinary future change by 1,000x.
        constant = np.isclose(spread, 0.0, rtol=0.0, atol=1e-12)
        scale[columns] = np.where(constant, 1.0, np.maximum(spread, 1e-3))
    return {
        "schema": LEGACY_INPUT_NORMALIZATION_SCHEMA,
        "mean": mean.tolist(),
        "scale": scale.tolist(),
        "counts": counts,
        "normalized_groups": {
            "note_bytes": [int(NOTE_BYTE_FEATURE_START), int(NOTE_BYTE_FEATURE_END)],
            "spectrum": [int(SPECTRUM_FEATURE_START), int(SPECTRUM_FEATURE_END)],
        },
    }


def normalize_policy_vector(vector: np.ndarray, normalization: dict | None) -> np.ndarray:
    if normalization is None:
        result = np.asarray(vector, dtype=np.float64)
        if result.shape != (POLICY_VECTOR_DIM,) or not np.isfinite(result).all():
            raise ValueError("invalid policy vector")
        return result
    schema = normalization.get("schema")
    if schema not in {LEGACY_INPUT_NORMALIZATION_SCHEMA, SHARED_RESPONSE_INPUT_NORMALIZATION_SCHEMA}:
        raise ValueError("unsupported input normalization schema")
    mean = np.asarray(normalization.get("mean"), dtype=np.float64)
    scale = np.asarray(normalization.get("scale"), dtype=np.float64)
    if mean.shape != (POLICY_VECTOR_DIM,) or scale.shape != (POLICY_VECTOR_DIM,):
        raise ValueError("invalid input normalization shape")
    if not np.isfinite(mean).all() or not np.isfinite(scale).all() or np.any(scale <= 0.0):
        raise ValueError("invalid input normalization values")
    result = np.asarray(vector, dtype=np.float64).copy()
    if result.shape != (POLICY_VECTOR_DIM,) or not np.isfinite(result).all():
        raise ValueError("invalid policy vector")
    note_payload_available = result[NOTE_PAYLOAD_MASK_INDEX] > 0.5
    spectrum_present = result[SPECTRUM_MASK_INDEX] > 0.5
    note_columns = slice(NOTE_FEATURE_START, NOTE_FEATURE_END)
    note_byte_columns = slice(NOTE_BYTE_FEATURE_START, NOTE_BYTE_FEATURE_END)
    spectrum_columns = slice(SPECTRUM_FEATURE_START, SPECTRUM_FEATURE_END)
    if schema == SHARED_RESPONSE_INPUT_NORMALIZATION_SCHEMA:
        response_scaling = normalization.get("response_scaling")
        if not isinstance(response_scaling, dict) or response_scaling.get("method") != SHARED_RESPONSE_SCALING_METHOD:
            raise ValueError("invalid shared response scaling metadata")
        if response_scaling.get("feature_indices") != [int(index) for index in RESPONSE_FEATURE_INDICES]:
            raise ValueError("invalid shared response feature indices")
        response_scale = float(response_scaling.get("scale", 0.0))
        if not math.isfinite(response_scale) or response_scale <= 0.0:
            raise ValueError("invalid shared response scale")
    if note_payload_available:
        result[note_byte_columns] = (result[note_byte_columns] - mean[note_byte_columns]) / scale[note_byte_columns]
    else:
        result[note_columns] = 0.0
    if spectrum_present:
        if schema == SHARED_RESPONSE_INPUT_NORMALIZATION_SCHEMA:
            frequency_columns = np.asarray(SPECTRUM_FREQUENCY_FEATURE_INDICES, dtype=np.int64)
            response_columns = np.asarray(RESPONSE_FEATURE_INDICES, dtype=np.int64)
            result[frequency_columns] = (
                result[frequency_columns] - mean[frequency_columns]
            ) / scale[frequency_columns]
            # The response block is deliberately only divided by a single
            # train-fitted scalar: no per-coordinate centering or clipping.
            result[response_columns] = result[response_columns] / response_scale
        else:
            result[spectrum_columns] = (result[spectrum_columns] - mean[spectrum_columns]) / scale[spectrum_columns]
    else:
        result[spectrum_columns] = 0.0
    if not np.isfinite(result).all():
        raise ValueError("normalized policy observation is non-finite")
    return result


def _model_vector(policy_observation: dict, normalization: dict | None) -> np.ndarray:
    return normalize_policy_vector(encode_policy_observation(policy_observation), normalization)


def _apply_evaluation_only_input_hook(vector: np.ndarray, hook) -> np.ndarray:
    """Apply a validated frozen-evaluation input hook to a normalized vector.

    Training and autograd paths never call this helper.  The hook receives a
    copy, so it cannot mutate the caller's vector or model state, and it must
    return the same finite policy-vector shape.
    """

    if hook is None:
        return vector
    transformed = np.asarray(hook(np.asarray(vector, dtype=np.float64).copy()), dtype=np.float64)
    if transformed.shape != (POLICY_VECTOR_DIM,) or not np.isfinite(transformed).all():
        raise ValueError("evaluation-only input hook returned an invalid policy vector")
    return transformed.copy()


def _validate_gate_head(gate_head: str) -> str:
    if gate_head not in GATE_HEAD_CHOICES:
        raise ValueError(f"unsupported gate head: {gate_head}")
    return str(gate_head)


def _shared_row_head_rng(seed: int, *, architecture_salt: int) -> np.random.Generator:
    """Use an independent stream so shared-head additions do not shift body/frequency draws."""

    return np.random.default_rng(np.random.SeedSequence([int(seed), int(architecture_salt)]))


def _validate_shared_row_normalization(gate_head: str, normalization: dict | None) -> None:
    """Require a row-symmetric response preprocessing path for the shared head."""

    if gate_head != SHARED_ROW_GATE_HEAD or normalization is None:
        return
    if normalization.get("schema") != SHARED_RESPONSE_INPUT_NORMALIZATION_SCHEMA:
        raise ValueError("shared row scorer requires shared-response normalization")
    response_scaling = normalization.get("response_scaling")
    if not isinstance(response_scaling, dict) or response_scaling.get("method") != SHARED_RESPONSE_SCALING_METHOD:
        raise ValueError("shared row scorer requires shared max-absolute response scaling")
    if response_scaling.get("feature_indices") != [int(index) for index in RESPONSE_FEATURE_INDICES]:
        raise ValueError("shared row scorer requires the declared response feature block")


def _shared_row_gate_logits(
    params: dict[str, np.ndarray],
    row_features: np.ndarray,
    retained_context: np.ndarray,
    *,
    prefix: str,
) -> np.ndarray:
    """Score every response row with one shared bilinear goal-conditioned function."""

    rows = np.asarray(row_features, dtype=np.float64).reshape(ACTION_DIM, SHARED_ROW_FEATURE_DIM)
    context = np.asarray(retained_context, dtype=np.float64).reshape(-1)
    return (
        rows @ params[prefix + "W_shared_row_context"] @ context
        + rows @ params[prefix + "w_shared_row"]
        + params[prefix + "b_shared_row"]
    )


def _shared_row_gate_logits_tensor(
    params: dict[str, Tensor],
    row_features: Tensor,
    retained_context: Tensor,
    *,
    prefix: str,
) -> Tensor:
    """Autograd equivalent of :func:`_shared_row_gate_logits`."""

    return (
        row_features @ params[prefix + "W_shared_row_context"] @ retained_context
        + row_features @ params[prefix + "w_shared_row"]
        + params[prefix + "b_shared_row"]
    )


@dataclass
class V03TrainResult:
    model: object
    best_step: int
    best_validation_loss: float
    best_validation_accuracy: float
    history: list[dict]
    optimizer_steps: int


def _validate_examples(examples: list[dict]) -> None:
    if not examples:
        raise ValueError("examples are required")
    for example in examples:
        observations = example.get("policy_observations")
        if not isinstance(observations, list) or not observations:
            raise ValueError("each example needs one or more policy observations")
        if type(example.get("target_gate")) is not int or not 0 <= example["target_gate"] < ACTION_DIM:
            raise ValueError("invalid target gate")
        if type(example.get("target_frequency")) is not int or not 0 <= example["target_frequency"] < ACTION_DIM:
            raise ValueError("invalid target frequency")
        for observation in observations:
            encode_policy_observation(observation)


def _state_copy(state: dict) -> dict:
    return {name: np.asarray(value, dtype=np.float64).copy() for name, value in state.items()}


def _adam_train(
    model,
    train_examples: list[dict],
    validation_examples: list[dict],
    *,
    steps: int,
    learning_rate: float,
    seed: int,
    validation_every: int,
) -> V03TrainResult:
    _validate_examples(train_examples)
    _validate_examples(validation_examples)
    if type(steps) is not int or steps < 1:
        raise ValueError("steps must be positive")
    rng = np.random.default_rng(seed)
    first = {name: np.zeros_like(value) for name, value in model.params.items()}
    second = {name: np.zeros_like(value) for name, value in model.params.items()}
    best_state = model.state_dict()
    best_validation = float("inf")
    best_accuracy = 0.0
    best_step = 0
    history = []
    for step in range(1, steps + 1):
        example = train_examples[int(rng.integers(0, len(train_examples)))]
        loss, gradients, _, _ = model.loss_and_gradients(
            example["policy_observations"],
            target_gate=example["target_gate"],
            target_frequency=example["target_frequency"],
        )
        norm = math.sqrt(sum(float(np.sum(value * value)) for value in gradients.values()))
        scale = min(1.0, 3.0 / max(norm, 1e-12))
        for name, gradient in gradients.items():
            gradient = gradient * scale
            first[name] = 0.9 * first[name] + 0.1 * gradient
            second[name] = 0.999 * second[name] + 0.001 * gradient * gradient
            first_hat = first[name] / (1.0 - 0.9**step)
            second_hat = second[name] / (1.0 - 0.999**step)
            model.params[name] -= learning_rate * first_hat / (np.sqrt(second_hat) + 1e-8)
        if step == 1 or step % validation_every == 0 or step == steps:
            validation_losses = []
            joint_accuracy = []
            for item in validation_examples:
                validation_losses.append(model.loss_only(
                    item["policy_observations"],
                    target_gate=item["target_gate"],
                    target_frequency=item["target_frequency"],
                ))
                prediction = model.predict(item["policy_observations"])
                joint_accuracy.append(float(
                    prediction["gate"] == item["target_gate"]
                    and prediction["frequency_index"] == item["target_frequency"]
                ))
            validation_loss = float(np.mean(validation_losses))
            validation_accuracy = float(np.mean(joint_accuracy))
            history.append({
                "step": step,
                "train_loss": float(loss),
                "validation_loss": validation_loss,
                "validation_accuracy": validation_accuracy,
                "gradient_norm": float(norm),
            })
            if validation_loss < best_validation:
                best_validation = validation_loss
                best_accuracy = validation_accuracy
                best_step = step
                best_state = model.state_dict()
    model.load_state_dict(best_state)
    return V03TrainResult(model, best_step, best_validation, best_accuracy, history, steps)


class V03FiveBrain:
    """Four recurrent peripherals and a gated memory center."""

    PERIPHERALS = PERIPHERAL_COUNT
    PERIPH_HIDDEN = 8
    CENTER_HIDDEN = 12
    MEMORY_SLOTS = MEMORY_SLOTS
    MEMORY_DIM = MEMORY_DIM
    ACTION_DIM = ACTION_DIM

    def __init__(self, seed: int = 7, *, gate_head: str = LEGACY_GATE_HEAD):
        if type(seed) is not int or seed < 0:
            raise ValueError("model seed must be a non-negative integer")
        self.seed = seed
        self.gate_head = _validate_gate_head(gate_head)
        self.input_normalization: dict | None = None
        rng = np.random.default_rng(seed)
        self.params: dict[str, np.ndarray] = {}

        def normal(name: str, shape: tuple[int, ...], scale: float) -> None:
            self.params[name] = rng.normal(0.0, scale, shape).astype(np.float64)

        for brain in range(self.PERIPHERALS):
            prefix = f"p{brain}."
            normal(prefix + "W_in", (self.PERIPH_HIDDEN, POLICY_VECTOR_DIM), 0.08)
            normal(prefix + "W_rec", (self.PERIPH_HIDDEN, self.PERIPH_HIDDEN), 0.14)
            self.params[prefix + "b"] = np.zeros(self.PERIPH_HIDDEN, dtype=np.float64)
            normal(prefix + "W_msg", (1, self.PERIPH_HIDDEN), 0.22)
            self.params[prefix + "b_msg"] = np.zeros(1, dtype=np.float64)

        center_input = POLICY_VECTOR_DIM + self.PERIPHERALS + self.MEMORY_DIM
        normal("c.W_in", (self.CENTER_HIDDEN, center_input), 0.08)
        normal("c.W_rec", (self.CENTER_HIDDEN, self.CENTER_HIDDEN), 0.10)
        normal("c.W_gate_in", (self.CENTER_HIDDEN, center_input), 0.06)
        normal("c.W_gate_rec", (self.CENTER_HIDDEN, self.CENTER_HIDDEN), 0.08)
        self.params["c.b"] = np.zeros(self.CENTER_HIDDEN, dtype=np.float64)
        self.params["c.b_gate"] = np.zeros(self.CENTER_HIDDEN, dtype=np.float64)
        normal("c.W_key", (self.MEMORY_DIM, self.CENTER_HIDDEN), 0.12)
        normal("c.W_addr", (self.MEMORY_SLOTS, self.CENTER_HIDDEN), 0.12)
        normal("c.W_write_gate", (1, self.CENTER_HIDDEN), 0.10)
        self.params["c.b_write_gate"] = np.array([-0.35], dtype=np.float64)
        normal("c.W_value", (self.MEMORY_DIM, self.CENTER_HIDDEN), 0.12)
        self.params["c.b_value"] = np.zeros(self.MEMORY_DIM, dtype=np.float64)
        action_input = self.CENTER_HIDDEN + self.MEMORY_DIM
        if self.gate_head == LEGACY_GATE_HEAD:
            normal("c.W_action_gate", (self.ACTION_DIM, action_input), 0.16)
        else:
            # Reserve the legacy gate-matrix draws on the main stream so all
            # shared parameters outside the controlled head retain their
            # legacy initialization.  The replacement head has its own stream.
            rng.normal(0.0, 0.16, (self.ACTION_DIM, action_input))
            head_rng = _shared_row_head_rng(
                self.seed,
                architecture_salt=SHARED_ROW_HEAD_RNG_SALT_FULL,
            )
            self.params["c.W_shared_row_context"] = head_rng.normal(
                0.0, 0.16, (SHARED_ROW_FEATURE_DIM, action_input)
            ).astype(np.float64)
            self.params["c.w_shared_row"] = head_rng.normal(
                0.0, 0.16, (SHARED_ROW_FEATURE_DIM,)
            ).astype(np.float64)
            self.params["c.b_shared_row"] = np.zeros(1, dtype=np.float64)
        normal("c.W_action_frequency", (self.ACTION_DIM, action_input), 0.16)
        if self.gate_head == LEGACY_GATE_HEAD:
            self.params["c.b_action_gate"] = np.zeros(self.ACTION_DIM, dtype=np.float64)
        self.params["c.b_action_frequency"] = np.zeros(self.ACTION_DIM, dtype=np.float64)

    @property
    def brain_count(self) -> int:
        return self.PERIPHERALS + 1

    @property
    def central_memory_shape(self) -> tuple[int, int]:
        return (self.MEMORY_SLOTS, self.MEMORY_DIM)

    def parameter_count(self) -> int:
        return int(sum(value.size for value in self.params.values()))

    def parameter_names(self) -> list[str]:
        return list(self.params)

    def state_dict(self) -> dict:
        return {name: value.tolist() for name, value in self.params.items()}

    def set_input_normalization(self, normalization: dict | None) -> None:
        # Validate and copy so a later caller cannot mutate a trained model's
        # preprocessing state through a shared dictionary.
        if normalization is None:
            self.input_normalization = None
            return
        _validate_shared_row_normalization(self.gate_head, normalization)
        normalize_policy_vector(np.zeros(POLICY_VECTOR_DIM, dtype=np.float64), normalization)
        self.input_normalization = deepcopy(normalization)

    def gate_head_audit(self) -> dict:
        """Describe the selected action head without exposing evaluator labels."""

        action_input = self.CENTER_HIDDEN + self.MEMORY_DIM
        return {
            "gate_head": self.gate_head,
            "shared_row_scorer": self.gate_head == SHARED_ROW_GATE_HEAD,
            "row_feature_shape": [ACTION_DIM, SHARED_ROW_FEATURE_DIM],
            "retained_context_dim": action_input,
            "retained_context_source": "pre-final central state plus pre-final memory read",
            "response_rows_are_current_observation_only": True,
            "per_gate_parameters": False if self.gate_head == SHARED_ROW_GATE_HEAD else True,
            "evaluator_labels_in_inference": False,
            "frequency_uses_retained_context": self.gate_head == SHARED_ROW_GATE_HEAD,
            "frequency_head_input": "pre-final retained context" if self.gate_head == SHARED_ROW_GATE_HEAD else "post-response action features",
            "initialization_stream": "independent shared-head stream with legacy body/frequency draws reserved" if self.gate_head == SHARED_ROW_GATE_HEAD else "legacy parameter stream",
            "legacy_common_parameter_initialization_preserved": True,
            "final_response_hook_scope": "current response rows only; earlier retained state is unchanged",
        }

    def normalization_state(self) -> dict | None:
        return None if self.input_normalization is None else deepcopy(self.input_normalization)

    def load_state_dict(self, state: dict) -> None:
        if set(state) != set(self.params):
            raise ValueError("model parameter names do not match")
        validated = {}
        for name, current in self.params.items():
            candidate = np.asarray(state[name], dtype=np.float64)
            if candidate.shape != current.shape or not np.isfinite(candidate).all():
                raise ValueError(f"invalid parameter {name}")
            validated[name] = candidate.copy()
        for name, candidate in validated.items():
            self.params[name][...] = candidate

    def clone(self) -> "V03FiveBrain":
        result = V03FiveBrain(self.seed, gate_head=self.gate_head)
        result.load_state_dict(self.state_dict())
        result.input_normalization = self.normalization_state()
        return result

    def initial_runtime(self, *, memory=None) -> dict:
        return {
            "peripheral": [np.zeros(self.PERIPH_HIDDEN, dtype=np.float64) for _ in range(self.PERIPHERALS)],
            "central": np.zeros(self.CENTER_HIDDEN, dtype=np.float64),
            "memory": np.zeros(self.central_memory_shape, dtype=np.float64)
            if memory is None else np.asarray(memory, dtype=np.float64).copy(),
        }

    @staticmethod
    def copy_runtime(runtime: dict) -> dict:
        return {
            "peripheral": [np.asarray(value, dtype=np.float64).copy() for value in runtime["peripheral"]],
            "central": np.asarray(runtime["central"], dtype=np.float64).copy(),
            "memory": np.asarray(runtime["memory"], dtype=np.float64).copy(),
        }

    def _numeric_forward(
        self,
        runtime: dict,
        vector: np.ndarray,
        *,
        ablate=None,
        erase_memory_before_action=False,
        collect_diagnostics: bool = False,
    ) -> tuple[dict, dict]:
        runtime = self.copy_runtime(runtime)
        messages = []
        peripheral = []
        peripheral_pre = []
        peripheral_message_pre = []
        for brain in range(self.PERIPHERALS):
            prefix = f"p{brain}."
            if ablate == brain:
                hidden = np.zeros(self.PERIPH_HIDDEN, dtype=np.float64)
                message = 0.0
                hidden_pre = np.zeros(self.PERIPH_HIDDEN, dtype=np.float64)
                message_pre = np.zeros(1, dtype=np.float64)
            else:
                hidden_pre = (
                    self.params[prefix + "W_in"] @ vector
                    + self.params[prefix + "W_rec"] @ runtime["peripheral"][brain]
                    + self.params[prefix + "b"]
                )
                hidden = np.tanh(hidden_pre)
                message_pre = self.params[prefix + "W_msg"] @ hidden + self.params[prefix + "b_msg"]
                message = float(np.tanh(message_pre)[0])
            peripheral.append(hidden)
            messages.append(message)
            peripheral_pre.append(np.asarray(hidden_pre, dtype=np.float64).copy())
            peripheral_message_pre.append(np.asarray(message_pre, dtype=np.float64).copy())
        messages_array = np.asarray(messages, dtype=np.float64)
        memory_before = runtime["memory"]
        prior_key = np.tanh(self.params["c.W_key"] @ runtime["central"])
        read_weights_before = _softmax((memory_before @ prior_key) / 0.75)
        read_before = read_weights_before @ memory_before
        retained_context = np.concatenate((runtime["central"], read_before))
        center_input = np.concatenate((vector, messages_array, read_before))
        center_candidate_pre = np.zeros(self.CENTER_HIDDEN, dtype=np.float64)
        center_update_pre = np.zeros(self.CENTER_HIDDEN, dtype=np.float64)
        update = np.zeros(self.CENTER_HIDDEN, dtype=np.float64)
        if ablate == "center":
            central = np.zeros(self.CENTER_HIDDEN, dtype=np.float64)
        else:
            center_candidate_pre = (
                self.params["c.W_in"] @ center_input
                + self.params["c.W_rec"] @ runtime["central"]
                + self.params["c.b"]
            )
            center_update_pre = (
                self.params["c.W_gate_in"] @ center_input
                + self.params["c.W_gate_rec"] @ runtime["central"]
                + self.params["c.b_gate"]
            )
            candidate = np.tanh(center_candidate_pre)
            update = 1.0 / (1.0 + np.exp(-center_update_pre))
            central = update * candidate + (1.0 - update) * runtime["central"]
        key = np.tanh(self.params["c.W_key"] @ central)
        write_weights = _softmax(self.params["c.W_addr"] @ central)
        write_gate_pre = self.params["c.W_write_gate"] @ central + self.params["c.b_write_gate"]
        write_gate = float(_sigmoid(write_gate_pre)[0])
        write_value = np.tanh(self.params["c.W_value"] @ central + self.params["c.b_value"])
        memory = memory_before + write_gate * write_weights[:, None] * (write_value[None, :] - memory_before)
        if erase_memory_before_action:
            memory = np.zeros_like(memory)
        read_weights_after = _softmax((memory @ key) / 0.75)
        read_after = read_weights_after @ memory
        action_features = np.concatenate((central, read_after))
        if self.gate_head == SHARED_ROW_GATE_HEAD:
            row_features = vector[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END].reshape(
                ACTION_DIM, SHARED_ROW_FEATURE_DIM
            )
            action_gate_logits = _shared_row_gate_logits(
                self.params,
                row_features,
                retained_context,
                prefix="c.",
            )
            action_frequency_logits = (
                self.params["c.W_action_frequency"] @ retained_context
                + self.params["c.b_action_frequency"]
            )
        else:
            action_gate_logits = self.params["c.W_action_gate"] @ action_features + self.params["c.b_action_gate"]
            action_frequency_logits = self.params["c.W_action_frequency"] @ action_features + self.params["c.b_action_frequency"]
        gate_probs = _softmax(action_gate_logits)
        frequency_probs = _softmax(action_frequency_logits)
        next_runtime = {"peripheral": peripheral, "central": central, "memory": memory}
        trace = {
            "messages": messages_array,
            "peripheral": [value.copy() for value in peripheral],
            "central": central.copy(),
            "memory": memory.copy(),
            "read_weights_before": read_weights_before.copy(),
            "read_before": read_before.copy(),
            "read_weights": read_weights_after.copy(),
            "read_after": read_after.copy(),
            "gate_probs": gate_probs,
            "frequency_probs": frequency_probs,
            "drive_frequency": float(PROBE_FREQUENCIES[int(np.argmax(frequency_probs))]),
        }
        if self.gate_head == SHARED_ROW_GATE_HEAD:
            trace.update({
                "gate_head": self.gate_head,
                "retained_goal_context": retained_context.copy(),
                "row_features": row_features.copy(),
                "shared_row_gate_logits": np.asarray(action_gate_logits, dtype=np.float64).copy(),
            })
        if collect_diagnostics:
            trace["diagnostics"] = {
                "peripheral_pre": peripheral_pre,
                "peripheral_message_pre": peripheral_message_pre,
                "center_candidate_pre": center_candidate_pre.copy(),
                "center_update_pre": center_update_pre.copy(),
                "center_update_gate": update.copy(),
                "write_gate_pre": np.asarray(write_gate_pre, dtype=np.float64).copy(),
                "action_gate_logits": np.asarray(action_gate_logits, dtype=np.float64).copy(),
                "action_frequency_logits": np.asarray(action_frequency_logits, dtype=np.float64).copy(),
            }
        return next_runtime, trace

    def raw_step(
        self,
        runtime: dict,
        policy_observation: dict,
        *,
        ablate=None,
        erase_memory_before_action=False,
        collect_diagnostics: bool = False,
        evaluation_only_input_hook=None,
    ) -> tuple[dict, dict]:
        vector = _model_vector(policy_observation, self.input_normalization)
        vector = _apply_evaluation_only_input_hook(vector, evaluation_only_input_hook)
        return self._numeric_forward(
            runtime,
            vector,
            ablate=ablate,
            erase_memory_before_action=erase_memory_before_action,
            collect_diagnostics=collect_diagnostics,
        )

    def action_from_trace(self, trace: dict) -> tuple[int, float, int]:
        frequency_index = int(np.argmax(trace["frequency_probs"]))
        return int(np.argmax(trace["gate_probs"])), float(PROBE_FREQUENCIES[frequency_index]), frequency_index

    def predict(self, policy_observations: list[dict]) -> dict:
        runtime = self.initial_runtime()
        trace = None
        for observation in policy_observations:
            runtime, trace = self.raw_step(runtime, observation)
        if trace is None:
            raise ValueError("policy observations are required")
        gate, frequency, frequency_index = self.action_from_trace(trace)
        return {"gate": gate, "frequency": frequency, "frequency_index": frequency_index, "trace": trace}

    def brain_snapshot(self, runtime: dict) -> dict:
        return {
            "brain_count": self.brain_count,
            "peripheral": [value.tolist() for value in runtime["peripheral"]],
            "central": runtime["central"].tolist(),
            "memory": runtime["memory"].tolist(),
        }

    def restore_runtime(self, state: dict) -> dict:
        if int(state.get("brain_count", -1)) != self.brain_count:
            raise ValueError("checkpoint does not contain exactly five brains")
        runtime = self.initial_runtime()
        if len(state["peripheral"]) != self.PERIPHERALS:
            raise ValueError("wrong peripheral count")
        runtime["peripheral"] = [
            np.asarray(value, dtype=np.float64).reshape(self.PERIPH_HIDDEN).copy()
            for value in state["peripheral"]
        ]
        runtime["central"] = np.asarray(state["central"], dtype=np.float64).reshape(self.CENTER_HIDDEN).copy()
        runtime["memory"] = np.asarray(state["memory"], dtype=np.float64).reshape(self.central_memory_shape).copy()
        values = runtime["peripheral"] + [runtime["central"], runtime["memory"]]
        if not all(np.isfinite(value).all() for value in values):
            raise ValueError("non-finite neural state")
        return runtime

    def _tensor_forward(self, runtime: dict, vector: np.ndarray, params: dict[str, Tensor], *, initial_memory: Tensor | None = None):
        peripheral = runtime["peripheral"]
        central = runtime["central"]
        memory = runtime["memory"] if initial_memory is None else initial_memory
        messages = []
        next_peripheral = []
        for brain in range(self.PERIPHERALS):
            prefix = f"p{brain}."
            hidden = tanh(
                params[prefix + "W_in"] @ Tensor(vector)
                + params[prefix + "W_rec"] @ peripheral[brain]
                + params[prefix + "b"]
            )
            next_peripheral.append(hidden)
            messages.append(tanh(params[prefix + "W_msg"] @ hidden + params[prefix + "b_msg"]))
        messages_tensor = concatenate(messages, axis=0)
        prior_key = tanh(params["c.W_key"] @ central)
        read_weights_before = softmax((memory @ prior_key) / 0.75)
        read_before = read_weights_before @ memory
        retained_context = concatenate((central, read_before), axis=0)
        center_input = concatenate((Tensor(vector), messages_tensor, read_before), axis=0)
        candidate = tanh(
            params["c.W_in"] @ center_input
            + params["c.W_rec"] @ central
            + params["c.b"]
        )
        update = sigmoid(
            params["c.W_gate_in"] @ center_input
            + params["c.W_gate_rec"] @ central
            + params["c.b_gate"]
        )
        central = update * candidate + (1.0 - update) * central
        key = tanh(params["c.W_key"] @ central)
        write_weights = softmax(params["c.W_addr"] @ central)
        write_gate = sigmoid(params["c.W_write_gate"] @ central + params["c.b_write_gate"])
        write_value = tanh(params["c.W_value"] @ central + params["c.b_value"])
        memory = memory + write_gate * write_weights.reshape(self.MEMORY_SLOTS, 1) * (
            write_value.reshape(1, self.MEMORY_DIM) - memory
        )
        read_weights_after = softmax((memory @ key) / 0.75)
        read_after = read_weights_after @ memory
        action_features = concatenate((central, read_after), axis=0)
        if self.gate_head == SHARED_ROW_GATE_HEAD:
            row_features = Tensor(
                vector[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END].reshape(
                    ACTION_DIM, SHARED_ROW_FEATURE_DIM
                )
            )
            action_gate_logits = _shared_row_gate_logits_tensor(
                params,
                row_features,
                retained_context,
                prefix="c.",
            )
            action_frequency_logits = params["c.W_action_frequency"] @ retained_context + params["c.b_action_frequency"]
        else:
            action_gate_logits = params["c.W_action_gate"] @ action_features + params["c.b_action_gate"]
            action_frequency_logits = params["c.W_action_frequency"] @ action_features + params["c.b_action_frequency"]
        gate_probs = softmax(action_gate_logits)
        frequency_probs = softmax(action_frequency_logits)
        return {
            "peripheral": next_peripheral,
            "central": central,
            "memory": memory,
        }, gate_probs, frequency_probs, {
            "read_weights_before": read_weights_before,
            "read_before": read_before,
            "read_weights_after": read_weights_after,
            "read_after": read_after,
        }

    def loss_and_gradients(
        self,
        policy_observations: list[dict],
        *,
        target_gate: int,
        target_frequency: int,
        initial_memory=None,
    ) -> tuple[float, dict[str, np.ndarray], np.ndarray, list[dict]]:
        _validate_examples([{
            "policy_observations": policy_observations,
            "target_gate": int(target_gate),
            "target_frequency": int(target_frequency),
        }])
        vectors = [_model_vector(item, self.input_normalization) for item in policy_observations]
        params = {name: Tensor(value.copy(), requires_grad=True) for name, value in self.params.items()}
        runtime = {
            "peripheral": [Tensor(np.zeros(self.PERIPH_HIDDEN)) for _ in range(self.PERIPHERALS)],
            "central": Tensor(np.zeros(self.CENTER_HIDDEN)),
            "memory": Tensor(
                np.zeros(self.central_memory_shape, dtype=np.float64)
                if initial_memory is None else np.asarray(initial_memory, dtype=np.float64),
                requires_grad=True,
            ),
        }
        initial_memory_tensor = runtime["memory"]
        if runtime["memory"].data.shape != self.central_memory_shape:
            raise ValueError("invalid initial memory")
        trace = []
        gate_probs = frequency_probs = None
        for vector in vectors:
            runtime, gate_probs, frequency_probs, memory_trace = self._tensor_forward(runtime, vector, params)
            trace.append({
                "gate_probs": gate_probs.data.copy(),
                "frequency_probs": frequency_probs.data.copy(),
                "memory": runtime["memory"].data.copy(),
                "central": runtime["central"].data.copy(),
                "peripheral": [item.data.copy() for item in runtime["peripheral"]],
                **{name: value.data.copy() for name, value in memory_trace.items()},
            })
        gate_target = np.zeros(self.ACTION_DIM, dtype=np.float64)
        gate_target[int(target_gate)] = 1.0
        frequency_target = np.zeros(self.ACTION_DIM, dtype=np.float64)
        frequency_target[int(target_frequency)] = 1.0
        total = -(
            Tensor(gate_target) * log(gate_probs + 1e-12)
        ).sum() - (
            Tensor(frequency_target) * log(frequency_probs + 1e-12)
        ).sum()
        total = total / 2.0 + 0.0002 * (params["c.W_rec"] * params["c.W_rec"]).sum()
        total.backward()
        gradients = {name: tensor.grad.copy() for name, tensor in params.items()}
        return float(total.data), gradients, initial_memory_tensor.grad.copy(), trace

    def loss_only(self, policy_observations: list[dict], *, target_gate: int, target_frequency: int) -> float:
        return self.loss_and_gradients(
            policy_observations,
            target_gate=target_gate,
            target_frequency=target_frequency,
        )[0]

    def train(self, train_examples: list[dict], validation_examples: list[dict], **kwargs) -> V03TrainResult:
        return _adam_train(self, train_examples, validation_examples, **kwargs)


class V03SingleRecurrentMemory:
    """Matched-observation/memory/tool baseline with one recurrent controller."""

    # Keep the control approximately parameter-matched to the repaired
    # five-brain model while retaining the same memory/tool interface.
    HIDDEN = 45
    MEMORY_SLOTS = MEMORY_SLOTS
    MEMORY_DIM = MEMORY_DIM
    ACTION_DIM = ACTION_DIM

    def __init__(self, seed: int = 41, *, gate_head: str = LEGACY_GATE_HEAD):
        if type(seed) is not int or seed < 0:
            raise ValueError("model seed must be a non-negative integer")
        self.seed = seed
        self.gate_head = _validate_gate_head(gate_head)
        rng = np.random.default_rng(seed)
        self.input_normalization: dict | None = None
        self.params = {
            "W_in": rng.normal(0.0, 0.08, (self.HIDDEN, POLICY_VECTOR_DIM)).astype(np.float64),
            "W_rec": rng.normal(0.0, 0.10, (self.HIDDEN, self.HIDDEN)).astype(np.float64),
            "b": np.zeros(self.HIDDEN, dtype=np.float64),
            "W_key": rng.normal(0.0, 0.12, (self.MEMORY_DIM, self.HIDDEN)).astype(np.float64),
            "W_addr": rng.normal(0.0, 0.12, (self.MEMORY_SLOTS, self.HIDDEN)).astype(np.float64),
            "W_write_gate": rng.normal(0.0, 0.10, (1, self.HIDDEN)).astype(np.float64),
            "b_write_gate": np.array([-0.35], dtype=np.float64),
            "W_value": rng.normal(0.0, 0.12, (self.MEMORY_DIM, self.HIDDEN)).astype(np.float64),
            "b_value": np.zeros(self.MEMORY_DIM, dtype=np.float64),
        }
        action_input = self.HIDDEN + self.MEMORY_DIM
        if self.gate_head == LEGACY_GATE_HEAD:
            self.params["W_action_gate"] = rng.normal(0.0, 0.16, (self.ACTION_DIM, action_input)).astype(np.float64)
        else:
            rng.normal(0.0, 0.16, (self.ACTION_DIM, action_input))
            head_rng = _shared_row_head_rng(
                self.seed,
                architecture_salt=SHARED_ROW_HEAD_RNG_SALT_CONTROL,
            )
            self.params["W_shared_row_context"] = head_rng.normal(
                0.0, 0.16, (SHARED_ROW_FEATURE_DIM, action_input)
            ).astype(np.float64)
            self.params["w_shared_row"] = head_rng.normal(
                0.0, 0.16, (SHARED_ROW_FEATURE_DIM,)
            ).astype(np.float64)
            self.params["b_shared_row"] = np.zeros(1, dtype=np.float64)
        self.params["W_action_frequency"] = rng.normal(0.0, 0.16, (self.ACTION_DIM, action_input)).astype(np.float64)
        if self.gate_head == LEGACY_GATE_HEAD:
            self.params["b_action_gate"] = np.zeros(self.ACTION_DIM, dtype=np.float64)

        self.params["b_action_frequency"] = np.zeros(self.ACTION_DIM, dtype=np.float64)
    @property
    def brain_count(self) -> int:
        return 1

    @property
    def central_memory_shape(self) -> tuple[int, int]:
        return (self.MEMORY_SLOTS, self.MEMORY_DIM)

    def parameter_count(self) -> int:
        return int(sum(value.size for value in self.params.values()))

    def state_dict(self) -> dict:
        return {name: value.tolist() for name, value in self.params.items()}

    def set_input_normalization(self, normalization: dict | None) -> None:
        if normalization is None:
            self.input_normalization = None
            return
        _validate_shared_row_normalization(self.gate_head, normalization)
        normalize_policy_vector(np.zeros(POLICY_VECTOR_DIM, dtype=np.float64), normalization)
        self.input_normalization = deepcopy(normalization)

    def gate_head_audit(self) -> dict:
        """Describe the selected action head without exposing evaluator labels."""

        action_input = self.HIDDEN + self.MEMORY_DIM
        return {
            "gate_head": self.gate_head,
            "shared_row_scorer": self.gate_head == SHARED_ROW_GATE_HEAD,
            "row_feature_shape": [ACTION_DIM, SHARED_ROW_FEATURE_DIM],
            "retained_context_dim": action_input,
            "retained_context_source": "pre-final hidden state plus pre-final memory read",
            "response_rows_are_current_observation_only": True,
            "per_gate_parameters": False if self.gate_head == SHARED_ROW_GATE_HEAD else True,
            "evaluator_labels_in_inference": False,
            "frequency_uses_retained_context": self.gate_head == SHARED_ROW_GATE_HEAD,
            "frequency_head_input": "pre-final retained context" if self.gate_head == SHARED_ROW_GATE_HEAD else "post-response action features",
            "initialization_stream": "independent shared-head stream with legacy body/frequency draws reserved" if self.gate_head == SHARED_ROW_GATE_HEAD else "legacy parameter stream",
            "legacy_common_parameter_initialization_preserved": True,
            "final_response_hook_scope": "current response rows only; earlier retained state is unchanged",
        }

    def normalization_state(self) -> dict | None:
        return None if self.input_normalization is None else deepcopy(self.input_normalization)

    def clone(self) -> "V03SingleRecurrentMemory":
        result = V03SingleRecurrentMemory(self.seed, gate_head=self.gate_head)
        result.load_state_dict(self.state_dict())
        result.input_normalization = self.normalization_state()
        return result

    def load_state_dict(self, state: dict) -> None:
        if set(state) != set(self.params):
            raise ValueError("model parameter names do not match")
        validated = {}
        for name, current in self.params.items():
            candidate = np.asarray(state[name], dtype=np.float64)
            if candidate.shape != current.shape or not np.isfinite(candidate).all():
                raise ValueError(f"invalid parameter {name}")
            validated[name] = candidate.copy()
        for name, candidate in validated.items():
            self.params[name][...] = candidate

    def parameter_names(self) -> list[str]:
        return list(self.params)

    def initial_runtime(self, *, memory=None) -> dict:
        return {
            "hidden": np.zeros(self.HIDDEN, dtype=np.float64),
            "memory": np.zeros(self.central_memory_shape, dtype=np.float64)
            if memory is None else np.asarray(memory, dtype=np.float64).copy(),
        }

    @staticmethod
    def copy_runtime(runtime: dict) -> dict:
        return {
            "hidden": np.asarray(runtime["hidden"], dtype=np.float64).copy(),
            "memory": np.asarray(runtime["memory"], dtype=np.float64).copy(),
        }

    @staticmethod
    def _softmax(value: np.ndarray) -> np.ndarray:
        return _softmax(value)

    def raw_step(
        self,
        runtime: dict,
        policy_observation: dict,
        *,
        ablate=None,
        erase_memory_before_action=False,
        collect_diagnostics: bool = False,
        evaluation_only_input_hook=None,
    ) -> tuple[dict, dict]:
        del ablate
        vector = _model_vector(policy_observation, self.input_normalization)
        vector = _apply_evaluation_only_input_hook(vector, evaluation_only_input_hook)
        runtime = self.copy_runtime(runtime)
        memory_before = runtime["memory"]
        prior_key = np.tanh(self.params["W_key"] @ runtime["hidden"])
        read_weights_before = _softmax((memory_before @ prior_key) / 0.75)
        read_before = read_weights_before @ memory_before
        retained_context = np.concatenate((runtime["hidden"], read_before))
        hidden_pre = self.params["W_in"] @ vector + self.params["W_rec"] @ runtime["hidden"] + self.params["b"]
        hidden = np.tanh(hidden_pre)
        key = np.tanh(self.params["W_key"] @ hidden)
        write_weights = _softmax(self.params["W_addr"] @ hidden)
        write_gate_pre = self.params["W_write_gate"] @ hidden + self.params["b_write_gate"]
        write_gate = float(_sigmoid(write_gate_pre)[0])
        write_value = np.tanh(self.params["W_value"] @ hidden + self.params["b_value"])
        memory = runtime["memory"] + write_gate * write_weights[:, None] * (write_value[None, :] - runtime["memory"])
        if erase_memory_before_action:
            memory = np.zeros_like(memory)
        read_weights_after = _softmax((memory @ key) / 0.75)
        read_after = read_weights_after @ memory
        action_memory = read_before + read_after
        action_features = np.concatenate((hidden, action_memory))
        if self.gate_head == SHARED_ROW_GATE_HEAD:
            row_features = vector[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END].reshape(
                ACTION_DIM, SHARED_ROW_FEATURE_DIM
            )
            action_gate_logits = _shared_row_gate_logits(
                self.params,
                row_features,
                retained_context,
                prefix="",
            )
            action_frequency_logits = (
                self.params["W_action_frequency"] @ retained_context
                + self.params["b_action_frequency"]
            )
        else:
            action_gate_logits = self.params["W_action_gate"] @ action_features + self.params["b_action_gate"]
            action_frequency_logits = self.params["W_action_frequency"] @ action_features + self.params["b_action_frequency"]
        gate_probs = _softmax(action_gate_logits)
        frequency_probs = _softmax(action_frequency_logits)
        trace = {
            "hidden": hidden.copy(),
            "memory": memory.copy(),
            "read_weights_before": read_weights_before.copy(),
            "read_before": read_before.copy(),
            "read_weights": read_weights_after.copy(),
            "read_weights_after": read_weights_after.copy(),
            "read_after": read_after.copy(),
            "gate_probs": gate_probs,
            "frequency_probs": frequency_probs,
            "drive_frequency": float(PROBE_FREQUENCIES[int(np.argmax(frequency_probs))]),
        }
        if self.gate_head == SHARED_ROW_GATE_HEAD:
            trace.update({
                "gate_head": self.gate_head,
                "retained_goal_context": retained_context.copy(),
                "row_features": row_features.copy(),
                "shared_row_gate_logits": np.asarray(action_gate_logits, dtype=np.float64).copy(),
            })
        if collect_diagnostics:
            trace["diagnostics"] = {
                "hidden_pre": np.asarray(hidden_pre, dtype=np.float64).copy(),
                "write_gate_pre": np.asarray(write_gate_pre, dtype=np.float64).copy(),
                "action_gate_logits": np.asarray(action_gate_logits, dtype=np.float64).copy(),
                "action_frequency_logits": np.asarray(action_frequency_logits, dtype=np.float64).copy(),
            }
        return {"hidden": hidden, "memory": memory}, trace

    def action_from_trace(self, trace: dict) -> tuple[int, float, int]:
        frequency_index = int(np.argmax(trace["frequency_probs"]))
        return int(np.argmax(trace["gate_probs"])), float(PROBE_FREQUENCIES[frequency_index]), frequency_index

    def predict(self, policy_observations: list[dict]) -> dict:
        runtime = self.initial_runtime()
        trace = None
        for observation in policy_observations:
            runtime, trace = self.raw_step(runtime, observation)
        if trace is None:
            raise ValueError("policy observations are required")
        gate, frequency, frequency_index = self.action_from_trace(trace)
        return {"gate": gate, "frequency": frequency, "frequency_index": frequency_index, "trace": trace}

    def brain_snapshot(self, runtime: dict) -> dict:
        return {"brain_count": 1, "hidden": runtime["hidden"].tolist(), "memory": runtime["memory"].tolist()}

    def restore_runtime(self, state: dict) -> dict:
        if int(state.get("brain_count", -1)) != 1:
            raise ValueError("checkpoint does not contain one controller")
        runtime = self.initial_runtime()
        runtime["hidden"] = np.asarray(state["hidden"], dtype=np.float64).reshape(self.HIDDEN).copy()
        runtime["memory"] = np.asarray(state["memory"], dtype=np.float64).reshape(self.central_memory_shape).copy()
        if not np.isfinite(runtime["hidden"]).all() or not np.isfinite(runtime["memory"]).all():
            raise ValueError("non-finite controller state")
        return runtime

    def loss_and_gradients(
        self,
        policy_observations: list[dict],
        *,
        target_gate: int,
        target_frequency: int,
        initial_memory=None,
    ) -> tuple[float, dict[str, np.ndarray], np.ndarray, list[dict]]:
        _validate_examples([{
            "policy_observations": policy_observations,
            "target_gate": int(target_gate),
            "target_frequency": int(target_frequency),
        }])
        vectors = [_model_vector(item, self.input_normalization) for item in policy_observations]
        params = {name: Tensor(value.copy(), requires_grad=True) for name, value in self.params.items()}
        hidden = Tensor(np.zeros(self.HIDDEN))
        memory = Tensor(
            np.zeros(self.central_memory_shape, dtype=np.float64)
            if initial_memory is None else np.asarray(initial_memory, dtype=np.float64),
            requires_grad=True,
        )
        initial_memory_tensor = memory
        if memory.data.shape != self.central_memory_shape:
            raise ValueError("invalid initial memory")
        trace = []
        gate_probs = frequency_probs = None
        for vector in vectors:
            prior_key = tanh(params["W_key"] @ hidden)
            read_weights_before = softmax((memory @ prior_key) / 0.75)
            read_before = read_weights_before @ memory
            retained_context = concatenate((hidden, read_before), axis=0)
            hidden = tanh(params["W_in"] @ Tensor(vector) + params["W_rec"] @ hidden + params["b"])
            key = tanh(params["W_key"] @ hidden)
            write_weights = softmax(params["W_addr"] @ hidden)
            write_gate = sigmoid(params["W_write_gate"] @ hidden + params["b_write_gate"])
            write_value = tanh(params["W_value"] @ hidden + params["b_value"])
            memory = memory + write_gate * write_weights.reshape(self.MEMORY_SLOTS, 1) * (
                write_value.reshape(1, self.MEMORY_DIM) - memory
            )
            read_weights_after = softmax((memory @ key) / 0.75)
            read_after = read_weights_after @ memory
            action_memory = read_before + read_after
            action_features = concatenate((hidden, action_memory), axis=0)
            if self.gate_head == SHARED_ROW_GATE_HEAD:
                row_features = Tensor(
                    np.asarray(vector[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END]).reshape(
                        ACTION_DIM, SHARED_ROW_FEATURE_DIM
                    )
                )
                action_gate_logits = _shared_row_gate_logits_tensor(
                    params,
                    row_features,
                    retained_context,
                    prefix="",
                )
                action_frequency_logits = params["W_action_frequency"] @ retained_context + params["b_action_frequency"]
            else:
                action_gate_logits = params["W_action_gate"] @ action_features + params["b_action_gate"]
                action_frequency_logits = params["W_action_frequency"] @ action_features + params["b_action_frequency"]
            gate_probs = softmax(action_gate_logits)
            frequency_probs = softmax(action_frequency_logits)
            trace.append({
                "gate_probs": gate_probs.data.copy(),
                "frequency_probs": frequency_probs.data.copy(),
                "memory": memory.data.copy(),
                "hidden": hidden.data.copy(),
                "read_weights_before": read_weights_before.data.copy(),
                "read_before": read_before.data.copy(),
                "read_weights_after": read_weights_after.data.copy(),
                "read_after": read_after.data.copy(),
            })
        gate_target = np.zeros(self.ACTION_DIM, dtype=np.float64)
        gate_target[int(target_gate)] = 1.0
        frequency_target = np.zeros(self.ACTION_DIM, dtype=np.float64)
        frequency_target[int(target_frequency)] = 1.0
        total = -(
            Tensor(gate_target) * log(gate_probs + 1e-12)
        ).sum() - (
            Tensor(frequency_target) * log(frequency_probs + 1e-12)
        ).sum()
        total = total / 2.0 + 0.0002 * (params["W_rec"] * params["W_rec"]).sum()
        total.backward()
        return (
            float(total.data),
            {name: tensor.grad.copy() for name, tensor in params.items()},
            initial_memory_tensor.grad.copy(),
            trace,
        )

    def loss_only(self, policy_observations: list[dict], *, target_gate: int, target_frequency: int) -> float:
        return self.loss_and_gradients(
            policy_observations,
            target_gate=target_gate,
            target_frequency=target_frequency,
        )[0]

    def train(self, train_examples: list[dict], validation_examples: list[dict], **kwargs) -> V03TrainResult:
        return _adam_train(self, train_examples, validation_examples, **kwargs)


def _softmax(value: np.ndarray) -> np.ndarray:
    shifted = np.asarray(value, dtype=np.float64) - np.max(value)
    result = np.exp(shifted)
    return result / np.sum(result)


def _sigmoid(value: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.asarray(value, dtype=np.float64)))
