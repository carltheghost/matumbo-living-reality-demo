"""Run one bounded five-step delayed-memory v0.3 experiment.

This runner is intentionally separate from the historical repair runner.  It
keeps the existing model, optimizer, physics, and matched control unchanged,
but trains and evaluates on the corrected note-hidden delayed schedule.
"""

from __future__ import annotations

from collections import Counter
import copy
import hashlib
import json
import os
import platform
from pathlib import Path
import resource
import subprocess
import sys
import tempfile
import time

import numpy as np

from .v03_model import (
    GATE_HEAD_CHOICES,
    LEGACY_GATE_HEAD,
    SHARED_ROW_GATE_HEAD,
    NOTE_FEATURE_END,
    NOTE_FEATURE_START,
    NOTE_PAYLOAD_MASK_INDEX,
    V03FiveBrain,
    V03SingleRecurrentMemory,
    encode_policy_observation,
    fit_input_normalization,
    normalize_policy_vector,
    _validate_gate_head,
)
from .v03_neural_proof import (
    _atomic_write_json,
    _gate_resonances,
    _goal_note,
)
from .v03_neural_repair import (
    GRADIENT_CLIP_NORM,
    LEARNING_RATE,
    _adam_update,
    _apply_retention_erasure,
    _failure_cause,
    _json_digest,
    _paired_ablation_summary,
    _strip_goal_bearing_note,
)
from .v03_protocol import CorrectedEpisode, PROBE_FREQUENCIES


CONTRACT_PATH = "docs/EXPERIMENT_CONTRACT_V03_DELAYED_MEMORY.md"
REPORT_PATH = "reports/generated/v03-neural-delayed-memory-report.json"
SUMMARY_PATH = "reports/generated/v03-neural-delayed-memory-report.md"
CHECKPOINT_PREFIX = "v03-neural-delayed-memory"
HISTORICAL_DELAYED_REPORT_PATH = "reports/generated/v03-neural-delayed-memory-report.json"
PRECEDING_SHARED_SCALE_REPORT_PATH = "reports/generated/v03-neural-delayed-shared-response-scale-report.json"
PRECEDING_SHARED_SCALE_SUMMARY_PATH = "reports/generated/v03-neural-delayed-shared-response-scale-report.md"
PRECEDING_SHARED_SCALE_ARTIFACT_COMMIT = "c35c2e6729dc867b516de8229ddd99adb88bcc44"
PRECEDING_SHARED_SCALE_REPORT_SOURCE_SHA = "2d35c0b32c5fb844c94b3909506dbf361d0bc521"
PRECEDING_SHARED_SCALE_ARTIFACT_DIGESTS = {
    PRECEDING_SHARED_SCALE_REPORT_PATH: "0de230b2c3636b4205d9e819a4831588c1df2b259af700a45fc13df4a92f833c",
    PRECEDING_SHARED_SCALE_SUMMARY_PATH: "e8016b9434e2a6a9a3d60e369dbf5f6a797187d3fbb75bfc9b477ded66d9ba28",
    "storage/checkpoints/v03-neural-delayed-shared-response-scale-full-seed-107.json": "5fe3a3a07c2572a2f51cde5699de36af41f6f39263c601b8e130ebcfba9f6ea6",
    "storage/checkpoints/v03-neural-delayed-shared-response-scale-full-seed-117.json": "08775a56a4d31c8f7c2bce38aaac105a2169e73619c32aa0890270a3f7223c4d",
    "storage/checkpoints/v03-neural-delayed-shared-response-scale-control-seed-141.json": "27c195ddce0e7524a464ad28963849d97d90a437b783be0dc34344b24d750095",
    "storage/checkpoints/v03-neural-delayed-shared-response-scale-control-seed-143.json": "a1f622654e00a8195a202a29a3a70beae3cf1213d77e6900af9324b1d227e94c",
}

DELAYED_MODEL_SEEDS = (107, 117)
DELAYED_CONTROL_SEEDS = (141, 143)
DELAYED_TRAIN_WORLD_SEEDS = (9200, 9201)
DEVELOPMENT_WORLD_SEEDS = (9300, 9301, 9302, 9303, 9304, 9305, 9306, 9307)
# Kept as a source-compatibility alias for the pre-review runner.  These
# worlds are inspected development cases, not a fresh held-out/generalization
# set; new reports use the development label explicitly.
HELDOUT_WORLD_SEEDS = DEVELOPMENT_WORLD_SEEDS
HISTORICAL_WORLD_SEEDS = frozenset((*range(6300, 6312), 7100, 7101, 8300, 8301))
MAX_UPDATES = 1000
WALL_CLOCK_CAP_SECONDS = 300.0
RETENTION_DELAY_STEPS = 2
METRIC_STEPS = (1, 100, 250, 500, 750, 1000)

RETENTION_CONDITIONS = (
    ("ordinary", None, "none"),
    ("slot0_erase", "slot0", "memory_slot_0"),
    ("slot1_erase", "slot1", "memory_slot_1"),
    ("both_slots_erase", "both", "memory_slots_0_and_1"),
    ("recurrent_erase", "recurrent", "recurrent_state_only"),
    ("all_retained_state_erase", "all", "recurrent_state_and_memory"),
)


class DeadlineExceeded(TimeoutError):
    """The bounded runner reached its deadline before a phase completed."""

    def __init__(self, phase: str, *, case_index: int | None = None, completed_cases: int = 0):
        self.phase = str(phase)
        self.case_index = None if case_index is None else int(case_index)
        self.completed_cases = int(completed_cases)
        suffix = ""
        if self.case_index is not None:
            suffix = f" before case {self.case_index}"
        super().__init__(f"wall-clock cap in {self.phase}{suffix}")


class CheckpointValidationError(ValueError):
    """A newly generated checkpoint cannot be safely reloaded for evaluation."""


def _deadline_expired(deadline: float | None) -> bool:
    return deadline is not None and time.perf_counter() >= float(deadline)


def _check_deadline(
    deadline: float | None,
    phase: str,
    *,
    case_index: int | None = None,
    completed_cases: int = 0,
) -> None:
    if _deadline_expired(deadline):
        raise DeadlineExceeded(
            phase,
            case_index=case_index,
            completed_cases=completed_cases,
        )


def _exception_record(exc: Exception, *, phase: str, case_index: int | None = None, spec: dict | None = None) -> dict:
    record = {
        "phase": str(phase),
        "error_type": type(exc).__name__,
        "error": str(exc),
    }
    if case_index is not None:
        record["case_index"] = int(case_index)
    if spec is not None:
        record["identity"] = {
            "split": str(spec.get("split")),
            "world_seed": int(spec.get("world_seed")),
            "goal_index": int(spec.get("goal_index")),
            "note_goal_id": str(spec.get("note_goal_id")),
        }
    return record


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _source_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _source_sha() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=_source_root(),
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _spec(world_seed: int, goal_index: int, split: str) -> dict:
    return {
        "split": str(split),
        "world_seed": int(world_seed),
        "goal_index": int(goal_index),
        "note_goal_id": f"{split}-goal-{goal_index}",
        "note_text": _goal_note(goal_index, split, 0.0),
        "gate_resonance_hz": _gate_resonances(world_seed).tolist(),
    }


def make_training_specs() -> list[dict]:
    return [
        _spec(world_seed, goal_index, "delayed-train")
        for world_seed in DELAYED_TRAIN_WORLD_SEEDS
        for goal_index in range(len(PROBE_FREQUENCIES))
    ]


def make_development_specs() -> list[dict]:
    if set(DEVELOPMENT_WORLD_SEEDS) & HISTORICAL_WORLD_SEEDS:
        raise AssertionError("development world seeds overlap historical reports")
    return [
        _spec(world_seed, goal_index, "delayed-heldout")
        for world_seed in DEVELOPMENT_WORLD_SEEDS
        for goal_index in range(len(PROBE_FREQUENCIES))
    ]


def make_heldout_specs() -> list[dict]:
    """Compatibility wrapper for callers of the pre-review runner."""

    return make_development_specs()


def _hidden_observation_audit(observation: dict) -> dict:
    note = observation.get("note")
    if not isinstance(note, dict):
        raise AssertionError("hidden delayed observation must retain typed note metadata")
    encoded = encode_policy_observation(observation)
    serialized = json.dumps(observation, sort_keys=True, separators=(",", ":"))
    text_empty = note.get("text", "") == ""
    digest_empty = note.get("content_digest", "") == ""
    target_marker_absent = "target_hz" not in serialized
    payload_mask_zero = bool(encoded[NOTE_PAYLOAD_MASK_INDEX] == 0.0)
    if not text_empty or not digest_empty or not target_marker_absent or not payload_mask_zero:
        raise AssertionError("hidden delayed observation still contains goal-bearing note payload")
    return {
        "note_payload_present_mask": int(encoded[NOTE_PAYLOAD_MASK_INDEX]),
        "text_empty": bool(text_empty),
        "content_digest_empty": bool(digest_empty),
        "target_marker_absent": bool(target_marker_absent),
        "payload_mask_zero": bool(payload_mask_zero),
    }


def _prepare_delayed_episode(spec: dict) -> tuple[CorrectedEpisode, list[dict], dict]:
    episode = CorrectedEpisode(
        int(spec["world_seed"]),
        note_text=str(spec["note_text"]),
        gate_resonance_hz=np.asarray(spec["gate_resonance_hz"], dtype=np.float64),
    )
    observations = []
    episode.advance(np.zeros(4, dtype=np.float64))
    observations.append(("before_note", copy.deepcopy(episode.policy_observation())))

    note_result = episode.execute_note()
    if not note_result.get("accepted"):
        raise RuntimeError("delayed schedule note lookup failed")
    observations.append(("note_shown_once", copy.deepcopy(episode.policy_observation())))

    hidden_audits = []
    for index in range(RETENTION_DELAY_STEPS):
        episode.advance(np.zeros(4, dtype=np.float64))
        hidden = _strip_goal_bearing_note(episode.policy_observation())
        hidden_audits.append(_hidden_observation_audit(hidden))
        observations.append((f"goal_independent_delay_{index + 1}", hidden))

    episode.execute_diagnostic(0)
    if not episode.measurement or not episode.measurement.get("accepted"):
        raise RuntimeError("delayed schedule diagnostic failed")
    final_hidden = _strip_goal_bearing_note(episode.policy_observation())
    hidden_audits.append(_hidden_observation_audit(final_hidden))
    observations.append(("spectrum_and_action", final_hidden))

    stage_names = [name for name, _ in observations]
    policy_observations = [observation for _, observation in observations]
    payload_masks = [
        int(encode_policy_observation(observation)[NOTE_PAYLOAD_MASK_INDEX])
        for observation in policy_observations
    ]
    if stage_names != [
        "before_note",
        "note_shown_once",
        "goal_independent_delay_1",
        "goal_independent_delay_2",
        "spectrum_and_action",
    ]:
        raise AssertionError("unexpected delayed schedule stages")
    if payload_masks != [0, 1, 0, 0, 0]:
        raise AssertionError("the delayed schedule must expose note payload exactly once")
    return episode, policy_observations, {
        "stage_names": stage_names,
        "policy_observation_count": len(policy_observations),
        "note_payload_masks": payload_masks,
        "note_shown_once": payload_masks.count(1) == 1,
        "hidden_rows": hidden_audits,
        "hidden_goal_bearing_fields_validated": all(
            item["text_empty"]
            and item["content_digest_empty"]
            and item["target_marker_absent"]
            and item["payload_mask_zero"]
            for item in hidden_audits
        ),
    }


def build_delayed_examples(specs: list[dict], *, include_labels: bool = True) -> list[dict]:
    examples = []
    for spec in specs:
        episode, observations, schedule_audit = _prepare_delayed_episode(spec)
        example = {
            "spec": copy.deepcopy(spec),
            "policy_observations": observations,
            "input_digest": _json_digest(observations),
            "schedule_audit": schedule_audit,
        }
        if include_labels:
            example["target_gate"] = int(episode.oracle_action())
            example["target_frequency"] = int(spec["goal_index"])
        examples.append(example)
    return examples


def _prepared_by_identity(specs: list[dict]) -> dict[tuple[str, int, str], dict]:
    prepared = {}
    for spec in specs:
        episode, observations, schedule_audit = _prepare_delayed_episode(spec)
        key = (str(spec["split"]), int(spec["world_seed"]), str(spec["note_goal_id"]))
        prepared[key] = {
            "episode_snapshot": episode.snapshot(),
            "policy_observations": observations,
            "schedule_audit": schedule_audit,
        }
    return prepared


def _spec_identity(spec: dict) -> tuple[str, int, str]:
    return (str(spec["split"]), int(spec["world_seed"]), str(spec["note_goal_id"]))


def _training_observations(examples: list[dict]) -> list[dict]:
    return [observation for example in examples for observation in example["policy_observations"]]


def _validate_hidden_normalization(examples: list[dict], normalization: dict) -> dict:
    hidden_rows = 0
    violations = []
    max_abs = 0.0
    for example in examples:
        for observation in example["policy_observations"][2:]:
            hidden_rows += 1
            raw = encode_policy_observation(observation)
            normalized = normalize_policy_vector(raw, normalization)
            current_max = float(np.max(np.abs(normalized[NOTE_FEATURE_START:NOTE_FEATURE_END])))
            max_abs = max(max_abs, current_max)
            if raw[NOTE_PAYLOAD_MASK_INDEX] != 0.0 or not np.allclose(
                normalized[NOTE_FEATURE_START:NOTE_FEATURE_END], 0.0, rtol=0.0, atol=0.0
            ):
                violations.append(example["spec"]["note_goal_id"])
    return {
        "hidden_rows": int(hidden_rows),
        "violations": violations,
        "max_abs_normalized_hidden_note": max_abs,
        "passed": not violations and max_abs == 0.0,
    }


def _prediction_metrics(
    model,
    examples: list[dict],
    *,
    include_loss: bool = True,
    loss_key: str = "full_training_loss",
    deadline: float | None = None,
    phase: str = "prediction_metrics",
) -> dict:
    predictions = []
    for index, example in enumerate(examples):
        _check_deadline(deadline, phase, case_index=index, completed_cases=index)
        prediction = model.predict(example["policy_observations"])
        if include_loss:
            _check_deadline(deadline, phase, case_index=index, completed_cases=index)
        predictions.append(prediction)
    if deadline is not None and _deadline_expired(deadline):
        raise DeadlineExceeded(phase, completed_cases=len(predictions))
    gates = [int(item["gate"]) for item in predictions]
    frequencies = [int(item["frequency_index"]) for item in predictions]
    target_gates = [int(example["target_gate"]) for example in examples]
    target_frequencies = [int(example["target_frequency"]) for example in examples]
    result = {
        "n": len(examples),
        "gate_accuracy": float(np.mean(np.asarray(gates) == np.asarray(target_gates))),
        "frequency_accuracy": float(np.mean(np.asarray(frequencies) == np.asarray(target_frequencies))),
        "joint_accuracy": float(np.mean(
            (np.asarray(gates) == np.asarray(target_gates))
            & (np.asarray(frequencies) == np.asarray(target_frequencies))
        )),
        "gate_action_histogram": dict(sorted(Counter(gates).items())),
        "frequency_action_histogram": dict(sorted(Counter(frequencies).items())),
        "joint_action_histogram": dict(sorted(Counter(f"{gate}:{frequency}" for gate, frequency in zip(gates, frequencies)).items())),
    }
    if include_loss:
        losses = []
        for index, example in enumerate(examples):
            _check_deadline(deadline, phase, case_index=index, completed_cases=index)
            losses.append(model.loss_only(
                example["policy_observations"],
                target_gate=example["target_gate"],
                target_frequency=example["target_frequency"],
            ))
        if deadline is not None and _deadline_expired(deadline):
            raise DeadlineExceeded(phase, completed_cases=len(examples))
        result[loss_key] = float(np.mean(losses))
    return result


def _train_delayed(model, examples: list[dict], *, seed: int, start_time: float, deadline: float) -> dict:
    first = {name: np.zeros_like(value) for name, value in model.params.items()}
    second = {name: np.zeros_like(value) for name, value in model.params.items()}
    rng = np.random.default_rng(seed)
    order = np.arange(len(examples), dtype=np.int64)
    history = []
    parameter_before = {name: value.copy() for name, value in model.params.items()}
    updates = 0
    stopped_reason = None
    for step in range(1, MAX_UPDATES + 1):
        if _deadline_expired(deadline):
            stopped_reason = "wall_clock_cap"
            break
        if (step - 1) % len(order) == 0:
            rng.shuffle(order)
        example = examples[int(order[(step - 1) % len(order)])]
        loss, gradients, _, _ = model.loss_and_gradients(
            example["policy_observations"],
            target_gate=example["target_gate"],
            target_frequency=example["target_frequency"],
        )
        gradient_norm, clip_scale = _adam_update(
            model, gradients, first, second, step, LEARNING_RATE
        )
        updates = step
        # The update itself may consume the remaining budget.  Never start a
        # metric pass after that point; the checkpoint still records the
        # completed optimizer update and the cap is reported structurally.
        if _deadline_expired(deadline):
            stopped_reason = "wall_clock_cap"
            break
        if step in METRIC_STEPS:
            try:
                metrics = _prediction_metrics(
                    model,
                    examples,
                    deadline=deadline,
                    phase=f"training_metrics_step_{step}",
                )
            except DeadlineExceeded:
                stopped_reason = "wall_clock_cap"
                break
            metrics.update({
                "step": int(step),
                "last_batch_loss": float(loss),
                "gradient_norm": gradient_norm,
                "clip_scale": clip_scale,
                "elapsed_seconds": time.perf_counter() - start_time,
            })
            history.append(metrics)
    parameter_delta = float(np.sqrt(sum(
        np.sum((model.params[name] - value) ** 2)
        for name, value in parameter_before.items()
    )))
    return {
        "updates": int(updates),
        "history": history,
        "parameter_delta_l2": parameter_delta,
        "optimizer_first": first,
        "optimizer_second": second,
        "rng_state": rng.bit_generator.state,
        "shuffle_order": order.tolist(),
        "next_minibatch_index": int(updates % len(order)),
        "next_cycle_requires_shuffle": bool(updates % len(order) == 0),
        "stopped_reason": stopped_reason,
    }


def _run_summary(
    runs: list[dict],
    *,
    deadline: float | None = None,
    phase: str = "run_summary",
) -> dict:
    failures = Counter()
    successes = 0
    residuals = []
    for index, item in enumerate(runs):
        _check_deadline(deadline, phase, case_index=index, completed_cases=index)
        failures[item.get("failure", item.get("failure_cause"))] += 1
        successes += int(bool(item["success"]))
        residuals.append(abs(item["world_residual"]))
    _check_deadline(deadline, phase, completed_cases=len(runs))
    failures.pop(None, None)
    return {
        "n": len(runs),
        "successes": int(successes),
        "success_rate": float(successes / len(runs)) if runs else 0.0,
        "failures": dict(sorted(failures.items())),
        "max_abs_world_residual": float(max(residuals, default=0.0)),
    }


def _validate_run_identities(runs: list[dict], specs: list[dict]) -> None:
    expected = [_spec_identity(spec) for spec in specs]
    actual = [
        (str(run["split"]), int(run["world_seed"]), str(run["note_goal_id"]))
        for run in runs
    ]
    if actual != expected:
        raise ValueError("delayed episode identities do not match the declared paired specs")


def run_delayed_episode(model, spec: dict, *, erasure: str | None = None, prepared: dict | None = None) -> dict:
    if prepared is None:
        prepared = _prepared_by_identity([spec])[_spec_identity(spec)]
    episode = CorrectedEpisode.restore(json.loads(json.dumps(prepared["episode_snapshot"], sort_keys=True)))
    observations = prepared["policy_observations"]
    runtime = model.initial_runtime()
    rows = []
    trace = None
    for index, observation in enumerate(observations):
        if index == len(observations) - 1:
            _apply_retention_erasure(model, runtime, erasure)
        runtime, trace = model.raw_step(runtime, observation)
        row = {
            "stage": prepared["schedule_audit"]["stage_names"][index],
            "policy_input_digest": _json_digest(observation),
        }
        if index >= 2:
            row.update(prepared["schedule_audit"]["hidden_rows"][index - 2])
        rows.append(row)
    gate, frequency, frequency_index = model.action_from_trace(trace)
    result = episode.execute_actuation(gate, drive_frequency=frequency)
    rows[-1].update({
        "selected_gate": int(gate),
        "selected_frequency_index": int(frequency_index),
        "selected_frequency": float(frequency),
        "gate_probabilities": np.asarray(trace["gate_probs"], dtype=np.float64).tolist(),
        "frequency_probabilities": np.asarray(trace["frequency_probs"], dtype=np.float64).tolist(),
        "result_schema": result.get("schema"),
        "result_accepted": bool(result.get("accepted")),
    })
    return {
        "split": spec["split"],
        "world_seed": int(spec["world_seed"]),
        "goal_index": int(spec["goal_index"]),
        "note_goal_id": spec["note_goal_id"],
        "condition": "ordinary_delayed" if erasure is None else f"{erasure}_delayed_erase",
        "success": bool(episode.success()),
        "failure_cause": _failure_cause(episode),
        "final_action": {
            "gate": int(gate),
            "frequency": float(frequency),
            "frequency_index": int(frequency_index),
        },
        "gate_probabilities": np.asarray(trace["gate_probs"], dtype=np.float64).tolist(),
        "frequency_probabilities": np.asarray(trace["frequency_probs"], dtype=np.float64).tolist(),
        "rows": rows,
        "schedule_audit": prepared["schedule_audit"],
        "note_hidden_validated": bool(prepared["schedule_audit"]["hidden_goal_bearing_fields_validated"]),
        "tool_calls": int(episode.tool_calls),
        "virtual_steps": int(episode.virtual_steps),
        "virtual_work": float(episode.virtual_work),
        "live_work_spent": float(episode.world.work_spent),
        "physics_steps": int(episode.world.physics_steps),
        "world_residual": float(episode.world.residual),
        "world_work": float(episode.world.work),
        "world_dissipated": float(episode.world.dissipated),
        "authoritative_note_digest": episode.workspace.digest(),
    }


def _oracle_delayed_run(spec: dict, prepared: dict) -> dict:
    episode = CorrectedEpisode.restore(json.loads(json.dumps(prepared["episode_snapshot"], sort_keys=True)))
    gate = int(episode.oracle_action())
    frequency_index = int(spec["goal_index"])
    frequency = float(PROBE_FREQUENCIES[frequency_index])
    result = episode.execute_actuation(gate, drive_frequency=frequency)
    return {
        "split": spec["split"],
        "world_seed": int(spec["world_seed"]),
        "goal_index": int(spec["goal_index"]),
        "note_goal_id": spec["note_goal_id"],
        "success": bool(episode.success()),
        "failure": None if episode.success() else "oracle_reference_failed",
        "final_action": {"gate": gate, "frequency_index": frequency_index},
        "schedule_audit": prepared["schedule_audit"],
        "note_hidden_validated": bool(prepared["schedule_audit"]["hidden_goal_bearing_fields_validated"]),
        "result_schema": result.get("schema"),
        "physics_steps": int(episode.world.physics_steps),
        "world_residual": float(episode.world.residual),
    }


def _save_delayed_checkpoint(path: Path, model, training: dict, normalization: dict, source_sha: str | None) -> str:
    if path.exists():
        raise FileExistsError(f"refusing to overwrite checkpoint: {path}")
    payload = {
        "schema": "vevo.v03.neural-delayed-memory-checkpoint.v1",
        "contract_path": CONTRACT_PATH,
        "source_sha": source_sha,
        "model_class": type(model).__name__,
        "seed": int(model.seed),
        "gate_head": str(getattr(model, "gate_head", LEGACY_GATE_HEAD)),
        "brain_count": int(model.brain_count),
        "parameter_count": int(model.parameter_count()),
        "memory_shape": list(model.central_memory_shape),
        "normalization": copy.deepcopy(normalization),
        "schedule": {
            "policy_observation_count": 5,
            "retention_delay_steps": RETENTION_DELAY_STEPS,
            "note_payload_masks": [0, 1, 0, 0, 0],
        },
        "state": model.state_dict(),
        "training": {
            "updates": int(training["updates"]),
            "stopped_reason": training["stopped_reason"],
            "rng_state": training["rng_state"],
            "shuffle_order": training["shuffle_order"],
            "next_minibatch_index": int(training["next_minibatch_index"]),
            "next_cycle_requires_shuffle": bool(training["next_cycle_requires_shuffle"]),
            "optimizer_first": {name: value.tolist() for name, value in training["optimizer_first"].items()},
            "optimizer_second": {name: value.tolist() for name, value in training["optimizer_second"].items()},
        },
    }
    _atomic_write_json(path, payload)
    return _json_digest(payload)


def _canonical_json(value):
    """Return a JSON-only value with deterministic key ordering."""

    return json.loads(json.dumps(value, sort_keys=True, allow_nan=False))


def _validate_checkpoint_optimizer_state(model, training: dict) -> None:
    required = {
        "updates",
        "stopped_reason",
        "rng_state",
        "shuffle_order",
        "next_minibatch_index",
        "next_cycle_requires_shuffle",
        "optimizer_first",
        "optimizer_second",
    }
    if not isinstance(training, dict) or not required.issubset(training):
        raise CheckpointValidationError("checkpoint training state is incomplete")
    for field in ("optimizer_first", "optimizer_second"):
        moments = training.get(field)
        if not isinstance(moments, dict) or set(moments) != set(model.params):
            raise CheckpointValidationError(f"checkpoint {field} parameter names do not match")
        for name, current in model.params.items():
            value = np.asarray(moments[name], dtype=np.float64)
            if value.shape != current.shape or not np.isfinite(value).all():
                raise CheckpointValidationError(f"checkpoint {field} has invalid parameter {name}")
    if type(training.get("updates")) is not int or training["updates"] < 0:
        raise CheckpointValidationError("checkpoint update count is invalid")
    if not isinstance(training.get("shuffle_order"), list):
        raise CheckpointValidationError("checkpoint shuffle order is invalid")
    if type(training.get("next_minibatch_index")) is not int or training["next_minibatch_index"] < 0:
        raise CheckpointValidationError("checkpoint minibatch position is invalid")
    if type(training.get("next_cycle_requires_shuffle")) is not bool:
        raise CheckpointValidationError("checkpoint shuffle-cycle flag is invalid")


def _load_delayed_checkpoint(
    path: str | Path,
    *,
    model_class,
    expected_label: str,
    expected_seed: int,
    expected_normalization: dict,
    expected_source_sha: str | None = None,
    expected_gate_head: str | None = None,
) -> tuple[object, dict]:
    """Load a new candidate checkpoint with strict schema and normalization checks.

    Historical v1 checkpoints are deliberately not accepted here.  They remain
    readable through their original model/normalization path and are used only
    as immutable compatibility references.
    """

    checkpoint_path = Path(path)
    try:
        payload = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CheckpointValidationError(f"cannot read checkpoint {checkpoint_path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise CheckpointValidationError("checkpoint root must be an object")
    if payload.get("schema") != "vevo.v03.neural-delayed-memory-checkpoint.v1":
        raise CheckpointValidationError("checkpoint schema is not the delayed-memory candidate schema")
    if payload.get("model_class") != model_class.__name__:
        raise CheckpointValidationError("checkpoint model class does not match the trial")
    if type(payload.get("seed")) is not int or int(payload["seed"]) != int(expected_seed):
        raise CheckpointValidationError("checkpoint model seed does not match the trial")
    if payload.get("contract_path") != CONTRACT_PATH:
        raise CheckpointValidationError("checkpoint contract path does not match")
    try:
        saved_gate_head = _validate_gate_head(payload.get("gate_head", LEGACY_GATE_HEAD))
    except (TypeError, ValueError) as exc:
        raise CheckpointValidationError(f"checkpoint gate head is invalid: {exc}") from exc
    if expected_gate_head is not None:
        try:
            expected_gate_head = _validate_gate_head(expected_gate_head)
        except (TypeError, ValueError) as exc:
            raise CheckpointValidationError(f"expected gate head is invalid: {exc}") from exc
        if saved_gate_head != expected_gate_head:
            raise CheckpointValidationError("checkpoint gate head does not match the trial")
    if expected_source_sha is not None and payload.get("source_sha") != expected_source_sha:
        raise CheckpointValidationError("checkpoint source SHA does not match the current run")
    expected_normalization = _canonical_json(expected_normalization)
    serialized_normalization = payload.get("normalization")
    if not isinstance(serialized_normalization, dict):
        raise CheckpointValidationError("checkpoint normalization is missing")
    serialized_normalization = _canonical_json(serialized_normalization)
    if serialized_normalization != expected_normalization:
        raise CheckpointValidationError("checkpoint normalization does not exactly match the fitted run normalization")
    if payload.get("brain_count") != int(model_class(expected_seed, gate_head=saved_gate_head).brain_count):
        raise CheckpointValidationError("checkpoint brain count does not match the trial")
    if payload.get("memory_shape") != list(model_class(expected_seed, gate_head=saved_gate_head).central_memory_shape):
        raise CheckpointValidationError("checkpoint memory shape does not match the trial")

    model = model_class(int(expected_seed), gate_head=saved_gate_head)
    state = payload.get("state")
    if not isinstance(state, dict):
        raise CheckpointValidationError("checkpoint model state is missing")
    try:
        model.load_state_dict(state)
        model.set_input_normalization(serialized_normalization)
    except (TypeError, ValueError) as exc:
        raise CheckpointValidationError(f"checkpoint model state is invalid: {exc}") from exc
    if payload.get("parameter_count") != int(model.parameter_count()):
        raise CheckpointValidationError("checkpoint parameter count does not match the model")
    if model.normalization_state() != expected_normalization:
        raise CheckpointValidationError("loaded model normalization is not an exact serialized round-trip")
    _validate_checkpoint_optimizer_state(model, payload.get("training"))
    return model, payload


def _prediction_signature(prediction: dict) -> dict:
    """Convert a prediction trace to a strict JSON-comparable signature."""

    def convert(value):
        if isinstance(value, np.ndarray):
            return convert(value.tolist())
        if isinstance(value, np.generic):
            return convert(value.item())
        if isinstance(value, dict):
            return {str(key): convert(value[key]) for key in sorted(value)}
        if isinstance(value, (list, tuple)):
            return [convert(item) for item in value]
        if isinstance(value, float) and not np.isfinite(value):
            raise CheckpointValidationError("prediction trace contains a non-finite value")
        return value

    return convert(prediction)


def _verify_prediction_parity(
    original_model,
    reloaded_model,
    examples: list[dict],
    *,
    deadline: float | None = None,
) -> dict:
    """Verify exact prediction traces before any physical evaluation."""

    original_digest_parts = []
    reloaded_digest_parts = []
    checked = 0
    for index, example in enumerate(examples):
        _check_deadline(deadline, "checkpoint_prediction_parity", case_index=index, completed_cases=checked)
        original = _prediction_signature(original_model.predict(example["policy_observations"]))
        reloaded = _prediction_signature(reloaded_model.predict(example["policy_observations"]))
        original_digest_parts.append(original)
        reloaded_digest_parts.append(reloaded)
        if original != reloaded:
            raise CheckpointValidationError(
                f"prediction parity mismatch for training case {index} ({example['spec']['note_goal_id']})"
            )
        checked += 1
    _check_deadline(deadline, "checkpoint_prediction_parity", completed_cases=checked)
    return {
        "status": "passed",
        "checked_cases": int(checked),
        "exact": True,
        "original_prediction_digest": _json_digest(original_digest_parts),
        "reloaded_prediction_digest": _json_digest(reloaded_digest_parts),
    }


def _trial_key(label: str, seed: int) -> str:
    return f"{label}-seed-{int(seed)}"


def _world_clustered_metrics(runs: list[dict], *, deadline: float | None = None) -> list[dict]:
    clusters = []
    for index, world_seed in enumerate(DEVELOPMENT_WORLD_SEEDS):
        _check_deadline(deadline, "development_world_cluster", case_index=index, completed_cases=index)
        cluster = [run for run in runs if int(run["world_seed"]) == int(world_seed)]
        clusters.append({
            "world_seed": int(world_seed),
            "n": len(cluster),
            "physical_successes": int(sum(bool(run["success"]) for run in cluster)),
            "success_rate": float(np.mean([run["success"] for run in cluster])) if cluster else 0.0,
            "goal_results": [
                {
                    "goal_index": int(run["goal_index"]),
                    "success": bool(run["success"]),
                    "gate": int(run["final_action"]["gate"]),
                    "frequency_index": int(run["final_action"]["frequency_index"]),
                }
                for run in cluster
            ],
        })
    _check_deadline(deadline, "development_world_cluster", completed_cases=len(clusters))
    return clusters


def _run_case_batch(
    specs: list[dict],
    case_runner,
    *,
    deadline: float | None,
    phase: str,
) -> dict:
    """Run cases in order and stop at the first cap or case failure."""

    runs = []
    failures = []
    for index, spec in enumerate(specs):
        try:
            _check_deadline(deadline, phase, case_index=index, completed_cases=len(runs))
            run = case_runner(spec, index)
        except DeadlineExceeded as exc:
            failures.append(_exception_record(exc, phase=phase, case_index=index, spec=spec))
            return {
                "status": "partial_wall_clock_cap",
                "runs": runs,
                "failures": failures,
                "completed_cases": len(runs),
                "expected_cases": len(specs),
                "next_case_index": index,
                "budget_exhausted": True,
            }
        except Exception as exc:  # Structured failure; the run stops for review.
            failures.append(_exception_record(exc, phase=phase, case_index=index, spec=spec))
            return {
                "status": "partial_failure",
                "runs": runs,
                "failures": failures,
                "completed_cases": len(runs),
                "expected_cases": len(specs),
                "next_case_index": index,
                "budget_exhausted": False,
            }
        runs.append(run)
        if _deadline_expired(deadline):
            if index + 1 < len(specs):
                failures.append(_exception_record(
                    DeadlineExceeded(phase, case_index=index + 1, completed_cases=len(runs)),
                    phase=phase,
                    case_index=index + 1,
                    spec=specs[index + 1],
                ))
                return {
                    "status": "partial_wall_clock_cap",
                    "runs": runs,
                    "failures": failures,
                    "completed_cases": len(runs),
                    "expected_cases": len(specs),
                    "next_case_index": index + 1,
                    "budget_exhausted": True,
                }
            return {
                "status": "complete_budget_exhausted",
                "runs": runs,
                "failures": failures,
                "completed_cases": len(runs),
                "expected_cases": len(specs),
                "next_case_index": None,
                "budget_exhausted": True,
            }
    return {
        "status": "complete",
        "runs": runs,
        "failures": failures,
        "completed_cases": len(runs),
        "expected_cases": len(specs),
        "next_case_index": None,
        "budget_exhausted": False,
    }


def _case_id(world_seed: int, goal_index: int) -> str:
    return f"world-{int(world_seed)}/goal-{int(goal_index)}"


def _historical_reference_specs() -> dict[str, dict]:
    return {
        "preceding_shared_response_scale": {
            "path": PRECEDING_SHARED_SCALE_REPORT_PATH,
            "sections": ("development", "heldout"),
            "artifact_commit": PRECEDING_SHARED_SCALE_ARTIFACT_COMMIT,
            "report_source_sha": PRECEDING_SHARED_SCALE_REPORT_SOURCE_SHA,
            "role": "primary comparison baseline: immediately preceding shared-scale legacy-head report",
        },
        "original_v1": {
            "path": HISTORICAL_DELAYED_REPORT_PATH,
            "sections": ("heldout", "development"),
            "artifact_commit": None,
            "report_source_sha": None,
            "role": "retained original-v1 historical comparison",
        },
    }


def _load_historical_successes(path: Path, sections: tuple[str, ...]) -> tuple[dict[str, dict[tuple[int, int], bool]], dict | None]:
    if not path.exists():
        return {}, None
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}, None
    for section in sections:
        section_value = report.get(section)
        if not isinstance(section_value, dict) or not isinstance(section_value.get("runs"), dict):
            continue
        result = {}
        for key, trial in section_value["runs"].items():
            cases = {}
            for run in trial.get("runs", []):
                try:
                    cases[(int(run["world_seed"]), int(run["goal_index"]))] = bool(run["success"])
                except (KeyError, TypeError, ValueError):
                    continue
            if cases:
                result[str(key)] = cases
        if result:
            return result, report
    return {}, report


def _historical_development_successes(project_root: Path) -> dict[str, dict[str, dict[tuple[int, int], bool]]]:
    """Read the primary shared-scale baseline and retain the original-v1 comparison."""

    result = {}
    for source, spec in _historical_reference_specs().items():
        successes, _ = _load_historical_successes(project_root / spec["path"], spec["sections"])
        result[source] = successes
    return result


def _historical_reference_metadata(project_root: Path) -> dict[str, dict]:
    metadata = {}
    for source, spec in _historical_reference_specs().items():
        path = project_root / spec["path"]
        _, report = _load_historical_successes(path, spec["sections"])
        metadata[source] = {
            "path": spec["path"],
            "role": spec["role"],
            "available": report is not None,
            "report_source_sha": None if report is None else report.get("source_sha"),
            "expected_report_source_sha": spec["report_source_sha"],
            "artifact_commit": spec["artifact_commit"],
            "expected_artifact_commit": spec["artifact_commit"],
        }
    return metadata


def _historical_success_overlap(
    candidate_runs: list[dict],
    historical_runs: dict[tuple[int, int], bool] | None,
    *,
    deadline: float | None = None,
) -> dict:
    """Return all per-case candidate/legacy success comparisons."""

    candidate = {
        (int(run["world_seed"]), int(run["goal_index"])): bool(run["success"])
        for run in candidate_runs
    }
    historical = {} if historical_runs is None else dict(historical_runs)
    keys = sorted(set(candidate) | set(historical))
    per_case = []
    candidate_successes = set()
    historical_successes = set()
    intersection = set()
    for index, key in enumerate(keys):
        _check_deadline(deadline, "development_historical_overlap", case_index=index, completed_cases=index)
        candidate_success = candidate.get(key)
        historical_success = historical.get(key)
        case = {
            "case_id": _case_id(*key),
            "world_seed": int(key[0]),
            "goal_index": int(key[1]),
            "candidate_success": candidate_success,
            "historical_success": historical_success,
            "success_match": (
                None if candidate_success is None or historical_success is None
                else bool(candidate_success == historical_success)
            ),
            "success_overlap": bool(candidate_success and historical_success),
        }
        per_case.append(case)
        if candidate_success:
            candidate_successes.add(key)
        if historical_success:
            historical_successes.add(key)
        if candidate_success and historical_success:
            intersection.add(key)
    _check_deadline(deadline, "development_historical_overlap", completed_cases=len(keys))
    union = candidate_successes | historical_successes
    return {
        "historical_available": bool(historical_runs is not None),
        "candidate_case_count": len(candidate),
        "historical_case_count": len(historical),
        "candidate_count": len(candidate_successes),
        "historical_count": len(historical_successes),
        "intersection": [_case_id(*key) for key in sorted(intersection)],
        "intersection_count": len(intersection),
        "candidate_only": [_case_id(*key) for key in sorted(candidate_successes - historical_successes)],
        "historical_only": [_case_id(*key) for key in sorted(historical_successes - candidate_successes)],
        "union_count": len(union),
        "jaccard": float(len(intersection) / len(union)) if union else 1.0,
        "per_case": per_case,
    }


def _development_case_record(model, example: dict, spec: dict, prepared: dict, *, deadline: float | None, index: int) -> dict:
    _check_deadline(deadline, "development_case", case_index=index, completed_cases=index)
    prediction = model.predict(example["policy_observations"])
    development_loss = model.loss_only(
        example["policy_observations"],
        target_gate=example["target_gate"],
        target_frequency=example["target_frequency"],
    )
    _check_deadline(deadline, "development_case", case_index=index, completed_cases=index)
    run = run_delayed_episode(model, spec, prepared=prepared)
    run["development_loss"] = float(development_loss)
    run["predicted_action"] = {
        "gate": int(prediction["gate"]),
        "frequency_index": int(prediction["frequency_index"]),
    }
    return run


_DEVELOPMENT_DERIVED_STAGES = (
    "development_metrics",
    "summary",
    "world_clustered",
    "historical_success_overlap",
)
_UNTRAINED_DERIVED_STAGES = (
    "metrics",
    "physical_success",
    "summary",
)


def _development_entry_shell(trial: dict, batch: dict) -> dict:
    """Create the report entry before calculating any derived metrics."""

    return {
        "architecture": trial["label"],
        "model_seed": trial["model_seed"],
        "status": batch["status"],
        "runs": batch["runs"],
        "completed_cases": batch["completed_cases"],
        "expected_cases": batch["expected_cases"],
        "failures": batch["failures"],
        "comparison_complete": False,
        "derived_metrics_status": {
            stage: "not_run"
            for stage in _DEVELOPMENT_DERIVED_STAGES
        },
        "unavailable_metrics": list(_DEVELOPMENT_DERIVED_STAGES),
    }


def _mark_development_entry_unavailable(
    entry: dict,
    *,
    status: str,
    unavailable_from: int = 0,
    reason: str,
    failure: dict | None = None,
) -> None:
    """Mark raw evidence as partial without implying a complete comparison."""

    unavailable = list(_DEVELOPMENT_DERIVED_STAGES[unavailable_from:])
    for stage in unavailable:
        entry["derived_metrics_status"][stage] = (
            "unavailable_budget_exhausted"
            if status == "partial_wall_clock_cap"
            else "unavailable_due_to_failure"
        )
    entry["unavailable_metrics"] = unavailable
    entry["status"] = status
    entry["comparison_complete"] = False
    entry["comparison_note"] = reason
    if failure is not None:
        entry["failure"] = failure


def _untrained_reference_entry_shell(seed: int, batch: dict, *, gate_head: str = LEGACY_GATE_HEAD) -> dict:
    """Create the untrained-reference report entry before derived metrics."""

    return {
        "model_seed": int(seed),
        "gate_head": str(gate_head),
        "updates": 0,
        "status": batch["status"],
        "runs": batch["runs"],
        "completed_cases": batch["completed_cases"],
        "expected_cases": batch["expected_cases"],
        "failures": batch["failures"],
        "comparison_complete": False,
        "derived_metrics_status": {
            stage: "not_run"
            for stage in _UNTRAINED_DERIVED_STAGES
        },
        "unavailable_metrics": list(_UNTRAINED_DERIVED_STAGES),
    }


def _mark_untrained_reference_entry_unavailable(
    entry: dict,
    *,
    status: str,
    unavailable_from: int = 0,
    reason: str,
    failure: dict | None = None,
) -> None:
    """Keep a raw reference prefix without implying complete derived evidence."""

    unavailable = list(_UNTRAINED_DERIVED_STAGES[unavailable_from:])
    for stage in unavailable:
        entry["derived_metrics_status"][stage] = (
            "unavailable_budget_exhausted"
            if status == "partial_wall_clock_cap"
            else "unavailable_due_to_failure"
        )
    entry["unavailable_metrics"] = unavailable
    entry["status"] = status
    entry["comparison_complete"] = False
    entry["comparison_note"] = reason
    if failure is not None:
        entry["failure"] = failure


def _finalize_untrained_reference_entry(
    entry: dict,
    *,
    model,
    train_examples: list[dict],
    deadline: float | None,
    phase_prefix: str,
) -> dict:
    """Derive untrained-reference metrics after raw runs are report-visible."""

    if entry["status"] != "complete":
        status = (
            "partial_wall_clock_cap"
            if entry["status"] in {"partial_wall_clock_cap", "complete_budget_exhausted"}
            else "partial_failure"
        )
        exc = (
            DeadlineExceeded(phase_prefix, completed_cases=entry["completed_cases"])
            if status == "partial_wall_clock_cap"
            else RuntimeError("untrained reference case batch failed")
        )
        _mark_untrained_reference_entry_unavailable(
            entry,
            status=status,
            reason="completed case prefix retained; derived reference metrics are unavailable",
            failure=_exception_record(exc, phase=phase_prefix),
        )
        return {"status": status, "exception": exc}

    stages = list(_UNTRAINED_DERIVED_STAGES)
    try:
        _check_deadline(deadline, f"{phase_prefix}_metrics", completed_cases=entry["completed_cases"])
        entry["metrics"] = _prediction_metrics(
            model,
            train_examples,
            deadline=deadline,
            phase=f"{phase_prefix}_metrics",
        )
        entry["derived_metrics_status"]["metrics"] = "complete"

        _check_deadline(deadline, f"{phase_prefix}_physical_success", completed_cases=entry["completed_cases"])
        entry["physical_success"] = int(sum(bool(run["success"]) for run in entry["runs"]))
        entry["derived_metrics_status"]["physical_success"] = "complete"

        _check_deadline(deadline, f"{phase_prefix}_summary", completed_cases=entry["completed_cases"])
        entry["summary"] = _run_summary(
            entry["runs"],
            deadline=deadline,
            phase=f"{phase_prefix}_summary",
        )
        entry["derived_metrics_status"]["summary"] = "complete"
    except DeadlineExceeded as exc:
        failed_stage = next(
            (
                index
                for index, stage in enumerate(stages)
                if entry["derived_metrics_status"][stage] == "not_run"
            ),
            len(stages) - 1,
        )
        failure = _exception_record(exc, phase=exc.phase, case_index=exc.case_index)
        _mark_untrained_reference_entry_unavailable(
            entry,
            status="partial_wall_clock_cap",
            unavailable_from=failed_stage,
            reason="completed case batch retained; later reference metrics stopped at the wall-clock cap",
            failure=failure,
        )
        return {"status": "partial_wall_clock_cap", "exception": exc}
    except Exception as exc:
        failed_stage = next(
            (
                index
                for index, stage in enumerate(stages)
                if entry["derived_metrics_status"][stage] == "not_run"
            ),
            len(stages) - 1,
        )
        failure = _exception_record(exc, phase=f"{phase_prefix}_derived_metrics")
        _mark_untrained_reference_entry_unavailable(
            entry,
            status="partial_failure",
            unavailable_from=failed_stage,
            reason="completed case batch retained; later reference metrics stopped after a failure",
            failure=failure,
        )
        return {"status": "partial_failure", "exception": exc}

    entry["unavailable_metrics"] = []
    entry["comparison_complete"] = True
    entry["status"] = "complete"
    entry["comparison_note"] = "complete untrained reference metrics for the training microset"
    return {"status": "complete", "exception": None}


def _finalize_development_entry(
    entry: dict,
    *,
    development_specs: list[dict],
    development_examples: list[dict],
    model,
    historical_successes: dict[tuple[int, int], bool] | None,
    deadline: float | None,
    phase_prefix: str,
    historical_successes_by_source: dict[str, dict[tuple[int, int], bool]] | None = None,
) -> dict:
    """Derive development metrics after raw runs are already report-visible."""

    if entry["status"] != "complete":
        status = (
            "partial_wall_clock_cap"
            if entry["status"] in {"partial_wall_clock_cap", "complete_budget_exhausted"}
            else "partial_failure"
        )
        exc = (
            DeadlineExceeded(phase_prefix, completed_cases=entry["completed_cases"])
            if status == "partial_wall_clock_cap"
            else RuntimeError("development case batch failed")
        )
        _mark_development_entry_unavailable(
            entry,
            status=status,
            reason="completed case prefix retained; derived comparison metrics are unavailable",
            failure=_exception_record(exc, phase=phase_prefix),
        )
        return {"status": status, "exception": exc}

    stages = list(_DEVELOPMENT_DERIVED_STAGES)
    try:
        _check_deadline(deadline, f"{phase_prefix}_identity_validation", completed_cases=entry["completed_cases"])
        _validate_run_identities(entry["runs"], development_specs)
        _check_deadline(deadline, f"{phase_prefix}_metrics", completed_cases=entry["completed_cases"])
        entry["metrics"] = _development_metrics(
            model,
            development_examples,
            entry["runs"],
            deadline=deadline,
        )
        entry["derived_metrics_status"]["development_metrics"] = "complete"

        _check_deadline(deadline, f"{phase_prefix}_summary", completed_cases=entry["completed_cases"])
        entry["summary"] = _run_summary(
            entry["runs"],
            deadline=deadline,
            phase=f"{phase_prefix}_summary",
        )
        entry["derived_metrics_status"]["summary"] = "complete"

        entry["world_clustered"] = _world_clustered_metrics(
            entry["runs"],
            deadline=deadline,
        )
        entry["derived_metrics_status"]["world_clustered"] = "complete"

        primary_overlap = _historical_success_overlap(
            entry["runs"],
            historical_successes,
            deadline=deadline,
        )
        entry["historical_success_overlap"] = primary_overlap
        source_overlaps = {"preceding_shared_response_scale": primary_overlap}
        for source, source_successes in sorted((historical_successes_by_source or {}).items()):
            if source == "preceding_shared_response_scale":
                continue
            _check_deadline(
                deadline,
                f"{phase_prefix}_historical_overlap_{source}",
                completed_cases=entry["completed_cases"],
            )
            source_overlaps[source] = _historical_success_overlap(
                entry["runs"],
                source_successes,
                deadline=deadline,
            )
        entry["historical_success_overlap_by_source"] = source_overlaps
        entry["derived_metrics_status"]["historical_success_overlap"] = "complete"
    except DeadlineExceeded as exc:
        failed_stage = next(
            (
                index
                for index, stage in enumerate(stages)
                if entry["derived_metrics_status"][stage] == "not_run"
            ),
            len(stages) - 1,
        )
        failure = _exception_record(exc, phase=exc.phase, case_index=exc.case_index)
        _mark_development_entry_unavailable(
            entry,
            status="partial_wall_clock_cap",
            unavailable_from=failed_stage,
            reason="completed case batch retained; later derived metrics stopped at the wall-clock cap",
            failure=failure,
        )
        return {"status": "partial_wall_clock_cap", "exception": exc}
    except Exception as exc:
        failed_stage = next(
            (
                index
                for index, stage in enumerate(stages)
                if entry["derived_metrics_status"][stage] == "not_run"
            ),
            len(stages) - 1,
        )
        failure = _exception_record(exc, phase=f"{phase_prefix}_derived_metrics")
        _mark_development_entry_unavailable(
            entry,
            status="partial_failure",
            unavailable_from=failed_stage,
            reason="completed case batch retained; later derived metrics stopped after a failure",
            failure=failure,
        )
        return {"status": "partial_failure", "exception": exc}

    entry["unavailable_metrics"] = []
    entry["comparison_complete"] = True
    entry["status"] = "complete"
    entry["comparison_note"] = "complete development comparison for the inspected cases"
    return {"status": "complete", "exception": None}


def _development_metrics(model, examples: list[dict], runs: list[dict], *, deadline: float | None) -> dict:
    _check_deadline(deadline, "development_metrics", completed_cases=len(runs))
    if len(runs) != len(examples):
        raise ValueError("development metrics require a complete case batch")
    gates = []
    frequencies = []
    target_gates = []
    target_frequencies = []
    successes = 0
    losses = []
    for index, (example, run) in enumerate(zip(examples, runs)):
        _check_deadline(deadline, "development_metrics", case_index=index, completed_cases=index)
        gates.append(int(run["final_action"]["gate"]))
        frequencies.append(int(run["final_action"]["frequency_index"]))
        target_gates.append(int(example["target_gate"]))
        target_frequencies.append(int(example["target_frequency"]))
        successes += int(bool(run["success"]))
        losses.append(float(run["development_loss"]))
    _check_deadline(deadline, "development_metrics", completed_cases=len(runs))
    return {
        "n": len(runs),
        "gate_accuracy": float(np.mean(np.asarray(gates) == np.asarray(target_gates))),
        "frequency_accuracy": float(np.mean(np.asarray(frequencies) == np.asarray(target_frequencies))),
        "joint_accuracy": float(np.mean(
            (np.asarray(gates) == np.asarray(target_gates))
            & (np.asarray(frequencies) == np.asarray(target_frequencies))
        )),
        "physical_success": int(successes),
        "physical_success_rate": float(successes / len(runs)) if runs else 0.0,
        "development_loss": float(np.mean(losses)) if losses else 0.0,
        "gate_action_histogram": dict(sorted(Counter(gates).items())),
        "frequency_action_histogram": dict(sorted(Counter(frequencies).items())),
        "joint_action_histogram": dict(sorted(Counter(f"{gate}:{frequency}" for gate, frequency in zip(gates, frequencies)).items())),
    }


def _historical_digests(project_root: Path) -> dict[str, str]:
    paths = (
        "reports/generated/v03-neural-proof-report.json",
        "reports/generated/v03-neural-repair-report.json",
        "reports/generated/v03-neural-delayed-memory-report.json",
        "reports/generated/v03-neural-delayed-factorial-diagnostic-report.json",
        "reports/generated/v03-neural-delayed-final-input-clipping-report.json",
        "reports/generated/v03-neural-delayed-final-input-clipping-summary.md",
        "storage/checkpoints/v03-neural-full-selected.json",
        "storage/checkpoints/v03-neural-control-selected.json",
        "storage/checkpoints/v03-neural-repair-full-selected.json",
        "storage/checkpoints/v03-neural-repair-control-selected.json",
        "storage/checkpoints/v03-neural-delayed-memory-full-seed-107.json",
        "storage/checkpoints/v03-neural-delayed-memory-full-seed-117.json",
        "storage/checkpoints/v03-neural-delayed-memory-control-seed-141.json",
        "storage/checkpoints/v03-neural-delayed-memory-control-seed-143.json",
        *PRECEDING_SHARED_SCALE_ARTIFACT_DIGESTS.keys(),
    )
    return {
        path: _sha256_file(project_root / path)
        for path in paths
    }


def _summary_path(output_path: Path) -> Path:
    return output_path.with_suffix(".md") if output_path.suffix == ".json" else Path(f"{output_path}.md")


def _atomic_write_text(path: Path, text: str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def _markdown_value(value, *, digits: int = 6) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def _markdown_summary(report: dict) -> str:
    runtime = report.get("runtime", {})
    training = report.get("training", {})
    development = report.get("development", {})
    lines = [
        "# Delayed-memory shared-response-scale candidate",
        "",
        f"Status: `{report.get('status', 'unknown')}`  ",
        f"Source commit: `{report.get('source_sha')}`  ",
        f"JSON report: `{report.get('report_path')}`  ",
        "",
        "This artifact is a bounded, separately retrained candidate. Its primary per-case overlap baseline is the immediately preceding shared-response-scale legacy-head report; the original v1 comparison is retained separately.",
        "",
        "## Evaluation gate and scope",
        "",
        f"- Gate head: `{report.get('gate_head', report.get('architecture', {}).get('gate_head', LEGACY_GATE_HEAD))}`.",
        f"- Existing gate: all four models must complete within budget and each must reach 8/8 delayed training physical successes before any development-case evaluation (`{training.get('all_four_delayed_training_success_8_of_8')}`).",
        f"- Development worlds: `{', '.join(str(seed) for seed in report.get('data', {}).get('development_world_seeds_inspected', DEVELOPMENT_WORLD_SEEDS))}`; these are previously inspected development cases, never fresh generalization evidence.",
        f"- Checkpoint reload/parity gate: `{report.get('checkpoint_reload', {}).get('status', 'not completed')}`.",
        f"- Historical artifacts unchanged byte-for-byte: `{report.get('historical_artifacts', {}).get('unchanged')}`.",
        f"- Primary historical overlap reference: `{report.get('historical_comparisons', {}).get('primary_report_path')}` at artifact commit `{report.get('historical_comparisons', {}).get('primary_artifact_commit')}`.",
        "",
        "## Training results",
        "",
        "| trial | status | updates | train loss | gate | frequency | joint | physical |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for trial in training.get("trials", []):
        metrics = trial.get("training_metrics") or {}
        lines.append(
            f"| {trial.get('key', 'unknown')} | {trial.get('status', 'unknown')} | {_markdown_value(trial.get('updates'))} | {_markdown_value(metrics.get('full_training_loss'))} | {_markdown_value(metrics.get('gate_accuracy'))} | {_markdown_value(metrics.get('frequency_accuracy'))} | {_markdown_value(metrics.get('joint_accuracy'))} | {_markdown_value(metrics.get('physical_success'))}/8 |"
        )
    lines.extend([
        "",
        "## Development cases",
        "",
        "The development section is intentionally not named or interpreted as a fresh held-out/generalization set. It reports loss and per-case overlap against the preserved historical delayed-memory report.",
        "",
        "| trial | status | n | development loss | gate | frequency | joint | physical | historical overlap |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for key, value in development.get("runs", {}).items():
        metrics = value.get("metrics") or {}
        overlap = value.get("historical_success_overlap") or {}
        lines.append(
            f"| {key} | {value.get('status', 'unknown')} | {_markdown_value(metrics.get('n', value.get('completed_cases')))} | {_markdown_value(metrics.get('development_loss'))} | {_markdown_value(metrics.get('gate_accuracy'))} | {_markdown_value(metrics.get('frequency_accuracy'))} | {_markdown_value(metrics.get('joint_accuracy'))} | {_markdown_value(metrics.get('physical_success'))}/32 | {_markdown_value(overlap.get('intersection_count'))} |"
        )
    lines.extend([
        "",
        "## Runtime and failures",
        "",
        f"- Wall-clock cap: `{runtime.get('wall_clock_cap_seconds')}` seconds; elapsed: `{runtime.get('wall_clock_seconds')}`; CPU: `{runtime.get('process_cpu_seconds')}`.",
        f"- Cap termination: `{runtime.get('cap_termination')}`; within cap: `{runtime.get('within_wall_clock_cap')}`.",
        f"- Deadline enforcement: `{runtime.get('deadline_enforcement')}`; an in-flight model operation or finalization may finish after the cap: `{runtime.get('deadline_overrun_possible')}`.",
        f"- Final JSON/Markdown serialization is outside the reported elapsed interval: `{runtime.get('elapsed_measurement_excludes_final_serialization')}`.",
        f"- Single CPU process does not guarantee one BLAS/OpenMP thread or a fixed memory ceiling: `{runtime.get('single_process_not_single_thread_guarantee')}`.",
        f"- Structured failures: `{len(runtime.get('failures', []))}`.",
    ])
    for failure in runtime.get("failures", []):
        lines.append(f"  - `{failure.get('phase', 'unknown')}`: {failure.get('error', failure)}")
    lines.extend([
        "",
        "No PC training, production deployment, paid compute, credentials, merge, or PR action is part of this artifact.",
        "",
    ])
    return "\n".join(lines)


def run_experiment(
    *,
    output_path: str | Path = REPORT_PATH,
    wall_clock_cap: float = WALL_CLOCK_CAP_SECONDS,
    response_scaling: str = "legacy_per_coordinate",
    checkpoint_prefix: str = CHECKPOINT_PREFIX,
    gate_head: str = LEGACY_GATE_HEAD,
) -> dict:
    start_wall = time.perf_counter()
    start_cpu = time.process_time()
    wall_clock_cap = float(wall_clock_cap)
    if not np.isfinite(wall_clock_cap):
        raise ValueError("wall-clock cap must be finite")
    deadline = start_wall + wall_clock_cap
    output = Path(output_path)
    summary_output = _summary_path(output)
    if output.exists():
        raise FileExistsError(f"refusing to overwrite report: {output}")
    if summary_output.exists():
        raise FileExistsError(f"refusing to overwrite report summary: {summary_output}")
    if Path(checkpoint_prefix).name != checkpoint_prefix:
        raise ValueError("checkpoint prefix must be a single filename component")
    gate_head = _validate_gate_head(gate_head)

    project_root = Path(__file__).resolve().parents[2]
    source_sha = _source_sha()
    historical_before = _historical_digests(project_root)
    failures = []
    cap_termination = False
    fatal_failure = False

    def stop_with(exc: Exception, *, phase: str, case_index: int | None = None, spec: dict | None = None) -> None:
        nonlocal cap_termination, fatal_failure
        failures.append(_exception_record(exc, phase=phase, case_index=case_index, spec=spec))
        if isinstance(exc, DeadlineExceeded) or _deadline_expired(deadline):
            cap_termination = True
        else:
            fatal_failure = True

    train_specs = make_training_specs()
    development_specs = make_development_specs()
    train_examples = build_delayed_examples(train_specs)
    normalization = fit_input_normalization(
        _training_observations(train_examples),
        response_scaling=response_scaling,
    )
    hidden_normalization = _validate_hidden_normalization(train_examples, normalization)
    prepared_train = _prepared_by_identity(train_specs)
    historical_successes_by_source = _historical_development_successes(project_root)
    historical_successes = historical_successes_by_source.get("preceding_shared_response_scale", {})
    historical_reference_metadata = _historical_reference_metadata(project_root)
    trial_models = []
    trial_records = []
    checkpoint_records = {}
    checkpoint_reload = {
        "status": "pending",
        "normalization_exact_required": True,
        "prediction_parity_required": True,
        "trials": {},
    }

    expected_trials = [
        (V03FiveBrain, "full", seed) for seed in DELAYED_MODEL_SEEDS
    ] + [
        (V03SingleRecurrentMemory, "control", seed) for seed in DELAYED_CONTROL_SEEDS
    ]

    for trial_index, (model_class, label, model_seed) in enumerate(expected_trials):
        key = _trial_key(label, model_seed)
        checkpoint_path: Path | None = None
        base_record = {
            "key": key,
            "label": label,
            "model_seed": int(model_seed),
            "optimizer_seed": int(model_seed + 1000),
        }
        if cap_termination or fatal_failure:
            base_record["status"] = "not_run_wall_clock_cap" if cap_termination else "not_run_prior_failure"
            trial_records.append(base_record)
            continue
        try:
            _check_deadline(deadline, "training_trial", case_index=trial_index, completed_cases=trial_index)
            model = model_class(model_seed, gate_head=gate_head)
            model.set_input_normalization(normalization)
            training = _train_delayed(
                model,
                train_examples,
                seed=model_seed + 1000,
                start_time=start_wall,
                deadline=deadline,
            )
            if training["stopped_reason"]:
                stop_with(
                    DeadlineExceeded("training_trial", case_index=trial_index, completed_cases=trial_index),
                    phase="training_trial",
                )
            checkpoint_path = project_root / "storage" / "checkpoints" / f"{checkpoint_prefix}-{label}-seed-{model_seed}.json"
            checkpoint_digest = _save_delayed_checkpoint(checkpoint_path, model, training, normalization, source_sha)
            checkpoint_record = {
                "path": str(checkpoint_path.relative_to(project_root)),
                "digest": checkpoint_digest,
                "status": "written",
            }
            checkpoint_records[key] = checkpoint_record
            base_record.update({
                "status": "partial_wall_clock_cap" if training["stopped_reason"] else "trained",
                "parameter_count": int(model.parameter_count()),
                "brain_count": int(model.brain_count),
                "updates": int(training["updates"]),
                "stopped_reason": training["stopped_reason"],
                "parameter_delta_l2": float(training["parameter_delta_l2"]),
                "history": training["history"],
            })
            if training["stopped_reason"]:
                trial_records.append(base_record)
                continue
            _check_deadline(deadline, "checkpoint_reload", case_index=trial_index, completed_cases=trial_index)
            reloaded_model, payload = _load_delayed_checkpoint(
                checkpoint_path,
                model_class=model_class,
                expected_label=label,
                expected_seed=model_seed,
                expected_normalization=normalization,
                expected_source_sha=source_sha,
                expected_gate_head=gate_head,
            )
            parity = _verify_prediction_parity(
                model,
                reloaded_model,
                train_examples,
                deadline=deadline,
            )
            checkpoint_record["reload"] = {
                "status": "passed",
                "normalization_exact": True,
                "payload_schema": payload["schema"],
                "prediction_parity": parity,
            }
            checkpoint_reload["trials"][key] = checkpoint_record["reload"]
            trial_models.append({
                "key": key,
                "label": label,
                "model_seed": int(model_seed),
                "optimizer_seed": int(model_seed + 1000),
                "model": reloaded_model,
                "training": training,
            })
            trial_records.append(base_record)
        except DeadlineExceeded as exc:
            stop_with(exc, phase=exc.phase, case_index=exc.case_index)
            base_record["status"] = "partial_wall_clock_cap"
            base_record["failure"] = _exception_record(exc, phase=exc.phase, case_index=exc.case_index)
            trial_records.append(base_record)
        except Exception as exc:
            failure_phase = "checkpoint_reload" if checkpoint_path is not None else "training_trial"
            stop_with(exc, phase=failure_phase)
            base_record["status"] = "failed"
            base_record["failure"] = _exception_record(exc, phase=failure_phase)
            checkpoint_reload["trials"][key] = {
                "status": "failed",
                "error_type": type(exc).__name__,
                "error": str(exc),
            }
            trial_records.append(base_record)

    if cap_termination:
        checkpoint_reload["status"] = "partial_wall_clock_cap"
    elif fatal_failure:
        checkpoint_reload["status"] = "failed"
    elif len(checkpoint_reload["trials"]) == len(expected_trials):
        checkpoint_reload["status"] = "passed"
    else:
        checkpoint_reload["status"] = "partial_failure"

    references = {"oracle_feasibility": {}, "untrained": {}}
    retention = {}
    development = {
        "status": "not_evaluated",
        "reason": "requires the all-four-models 8/8 training gate",
        "world_seeds": list(DEVELOPMENT_WORLD_SEEDS),
        "goal_count_per_world": len(PROBE_FREQUENCIES),
        "classification": "inspected_development_cases",
        "is_fresh_generalization": False,
        "fresh_generalization_claim": False,
        "normalization_source": "training microset only",
        "used_for_gradients": False,
        "used_for_hyperparameters": False,
        "used_for_checkpoint_selection": False,
        "runs": {},
    }

    if not cap_termination and not fatal_failure:
        oracle_batch = _run_case_batch(
            train_specs,
            lambda spec, index: _oracle_delayed_run(spec, prepared_train[_spec_identity(spec)]),
            deadline=deadline,
            phase="oracle_feasibility",
        )
        references["oracle_feasibility"] = {
            "status": oracle_batch["status"],
            "training_microset": {
                "runs": oracle_batch["runs"],
                "completed_cases": oracle_batch["completed_cases"],
                "expected_cases": oracle_batch["expected_cases"],
                "failures": oracle_batch["failures"],
            },
        }
        if oracle_batch["status"] == "complete":
            try:
                _check_deadline(deadline, "oracle_feasibility_summary", completed_cases=oracle_batch["completed_cases"])
                references["oracle_feasibility"]["training_microset"]["summary"] = _run_summary(
                    oracle_batch["runs"],
                    deadline=deadline,
                    phase="oracle_feasibility_summary",
                )
            except DeadlineExceeded as exc:
                stop_with(exc, phase=exc.phase, case_index=exc.case_index)
        else:
            if oracle_batch["budget_exhausted"]:
                stop_with(DeadlineExceeded("oracle_feasibility", completed_cases=oracle_batch["completed_cases"]), phase="oracle_feasibility")
            else:
                stop_with(RuntimeError("oracle feasibility case batch failed"), phase="oracle_feasibility")

    for trial in trial_models:
        key = trial["key"]
        retention_entry = {
            "architecture": trial["label"],
            "model_seed": trial["model_seed"],
            "ordinary": None,
            "conditions": {},
            "causal_interpretation_allowed": False,
            "status": "not_run_prior_failure" if (cap_termination or fatal_failure) else "pending",
        }
        if cap_termination or fatal_failure:
            retention[key] = retention_entry
            continue
        model = trial["model"]
        try:
            prediction_metrics = _prediction_metrics(
                model,
                train_examples,
                deadline=deadline,
                phase=f"training_metrics_{key}",
            )
            baseline_batch = _run_case_batch(
                train_specs,
                lambda spec, index: run_delayed_episode(
                    model,
                    spec,
                    prepared=prepared_train[_spec_identity(spec)],
                ),
                deadline=deadline,
                phase=f"retention_ordinary_{key}",
            )
            retention_entry["ordinary"] = {
                "state_scope": "none",
                "runs": baseline_batch["runs"],
                "completed_cases": baseline_batch["completed_cases"],
                "expected_cases": baseline_batch["expected_cases"],
                "failures": baseline_batch["failures"],
            }
            if baseline_batch["status"] != "complete":
                retention_entry["status"] = baseline_batch["status"]
                if baseline_batch["budget_exhausted"]:
                    stop_with(DeadlineExceeded(f"retention_ordinary_{key}", completed_cases=baseline_batch["completed_cases"]), phase=f"retention_ordinary_{key}")
                else:
                    stop_with(RuntimeError("ordinary retention case batch failed"), phase=f"retention_ordinary_{key}")
                retention[key] = retention_entry
                break
            _validate_run_identities(baseline_batch["runs"], train_specs)
            _check_deadline(deadline, f"retention_ordinary_summary_{key}", completed_cases=len(train_specs))
            ordinary_summary = _run_summary(
                baseline_batch["runs"],
                deadline=deadline,
                phase=f"retention_ordinary_summary_{key}",
            )
            retention_entry["ordinary"]["summary"] = ordinary_summary
            retention_entry["causal_interpretation_allowed"] = bool(ordinary_summary["successes"] > 0)
            retention_entry["causal_interpretation_reason"] = (
                "ordinary delayed recall has at least one success"
                if retention_entry["causal_interpretation_allowed"]
                else "ordinary delayed recall has zero successes; causal erasure evidence is not interpreted"
            )
            prediction_metrics["physical_success"] = int(ordinary_summary["successes"])
            prediction_metrics["physical_success_rate"] = float(ordinary_summary["success_rate"])
            prediction_metrics["ordinary_run_summary"] = ordinary_summary
            trial["training_metrics"] = prediction_metrics

            for condition, erasure, state_scope in RETENTION_CONDITIONS[1:]:
                condition_batch = _run_case_batch(
                    train_specs,
                    lambda spec, index, erasure=erasure: run_delayed_episode(
                        model,
                        spec,
                        erasure=erasure,
                        prepared=prepared_train[_spec_identity(spec)],
                    ),
                    deadline=deadline,
                    phase=f"retention_{key}_{condition}",
                )
                condition_record = {
                    "state_scope": state_scope,
                    "runs": condition_batch["runs"],
                    "completed_cases": condition_batch["completed_cases"],
                    "expected_cases": condition_batch["expected_cases"],
                    "failures": condition_batch["failures"],
                }
                if condition_batch["status"] != "complete":
                    retention_entry["conditions"][condition] = condition_record
                    retention_entry["status"] = condition_batch["status"]
                    if condition_batch["budget_exhausted"]:
                        stop_with(DeadlineExceeded(f"retention_{key}_{condition}", completed_cases=condition_batch["completed_cases"]), phase=f"retention_{key}_{condition}")
                    else:
                        stop_with(RuntimeError("retention condition case batch failed"), phase=f"retention_{key}_{condition}")
                    break
                _validate_run_identities(condition_batch["runs"], train_specs)
                _check_deadline(deadline, f"retention_{key}_{condition}_summary", completed_cases=len(train_specs))
                condition_record["summary"] = _run_summary(
                    condition_batch["runs"],
                    deadline=deadline,
                    phase=f"retention_{key}_{condition}_summary",
                )
                _check_deadline(deadline, f"retention_{key}_{condition}_pairing", completed_cases=len(train_specs))
                paired_ablation = _paired_ablation_summary(
                    baseline_batch["runs"], condition_batch["runs"]
                )
                _check_deadline(deadline, f"retention_{key}_{condition}_pairing", completed_cases=len(train_specs))
                condition_record["paired_ablation"] = paired_ablation
                retention_entry["conditions"][condition] = condition_record
            if not cap_termination and not fatal_failure:
                retention_entry["status"] = "complete"
            retention[key] = retention_entry
        except DeadlineExceeded as exc:
            stop_with(exc, phase=exc.phase, case_index=exc.case_index)
            retention_entry["status"] = "partial_wall_clock_cap"
            retention[key] = retention_entry
            break
        except Exception as exc:
            stop_with(exc, phase=f"retention_{key}")
            retention_entry["status"] = "failed"
            retention_entry["failure"] = _exception_record(exc, phase=f"retention_{key}")
            retention[key] = retention_entry
            break

    if not cap_termination and not fatal_failure:
        for label, model_class, seed in (
            ("full", V03FiveBrain, DELAYED_MODEL_SEEDS[0]),
            ("control", V03SingleRecurrentMemory, DELAYED_CONTROL_SEEDS[0]),
        ):
            try:
                _check_deadline(deadline, "untrained_reference", completed_cases=len(references["untrained"]))
                model = model_class(seed, gate_head=gate_head)
                model.set_input_normalization(normalization)
                reference_batch = _run_case_batch(
                    train_specs,
                    lambda spec, index: run_delayed_episode(
                        model,
                        spec,
                        prepared=prepared_train[_spec_identity(spec)],
                    ),
                    deadline=deadline,
                    phase=f"untrained_reference_{label}",
                )
                entry = _untrained_reference_entry_shell(seed, reference_batch, gate_head=gate_head)
                # Make the raw completed prefix visible before calculating any
                # derived metric, so a cap cannot erase evidence already run.
                references["untrained"][label] = entry
                finalized = _finalize_untrained_reference_entry(
                    entry,
                    model=model,
                    train_examples=train_examples,
                    deadline=deadline,
                    phase_prefix=f"untrained_reference_{label}",
                )
                if finalized["status"] == "complete":
                    _check_deadline(
                        deadline,
                        f"untrained_reference_{label}_complete",
                        completed_cases=entry["completed_cases"],
                    )
                if finalized["status"] != "complete":
                    exc = finalized["exception"]
                    failure_phase = (
                        exc.phase
                        if isinstance(exc, DeadlineExceeded)
                        else f"untrained_reference_{label}_derived_metrics"
                    )
                    stop_with(
                        exc,
                        phase=failure_phase,
                        case_index=exc.case_index if isinstance(exc, DeadlineExceeded) else None,
                    )
                    break
            except DeadlineExceeded as exc:
                stop_with(exc, phase=exc.phase, case_index=exc.case_index)
                break
            except Exception as exc:
                stop_with(exc, phase=f"untrained_reference_{label}")
                break

    completed_trial_records = [
        trial for trial in trial_models
        if trial.get("training", {}).get("stopped_reason") is None
    ]
    all_four_delayed_training_success = bool(
        len(completed_trial_records) == 4
        and all(
            trial.get("training_metrics", {}).get("physical_success") == len(train_specs)
            for trial in completed_trial_records
        )
        and not cap_termination
        and not fatal_failure
    )

    if all_four_delayed_training_success:
        try:
            _check_deadline(deadline, "development_preparation", completed_cases=0)
            development_examples = build_delayed_examples(development_specs)
            prepared_development = _prepared_by_identity(development_specs)
            development["status"] = "evaluating_inspected_cases"
            development["reason"] = None
            for trial in trial_models:
                if cap_termination or fatal_failure:
                    break
                examples_by_identity = {
                    _spec_identity(example["spec"]): example
                    for example in development_examples
                }
                batch = _run_case_batch(
                    development_specs,
                    lambda spec, index, trial=trial: _development_case_record(
                        trial["model"],
                        examples_by_identity[_spec_identity(spec)],
                        spec,
                        prepared_development[_spec_identity(spec)],
                        deadline=deadline,
                        index=index,
                    ),
                    deadline=deadline,
                    phase=f"development_cases_{trial['key']}",
                )
                entry = _development_entry_shell(trial, batch)
                # Attach raw runs before any derived metric or summary work.
                development["runs"][trial["key"]] = entry
                finalized = _finalize_development_entry(
                    entry,
                    development_specs=development_specs,
                    development_examples=development_examples,
                    model=trial["model"],
                    historical_successes=historical_successes.get(trial["key"]),
                    deadline=deadline,
                    phase_prefix=f"development_{trial['key']}",
                    historical_successes_by_source={
                        source: source_runs.get(trial["key"], {})
                        for source, source_runs in historical_successes_by_source.items()
                    },
                )
                if finalized["status"] == "complete":
                    _check_deadline(
                        deadline,
                        f"development_{trial['key']}_complete",
                        completed_cases=entry["completed_cases"],
                    )
                if finalized["status"] != "complete":
                    development["status"] = finalized["status"]
                    development["reason"] = entry["comparison_note"]
                    exc = finalized["exception"]
                    failure_phase = (
                        exc.phase
                        if isinstance(exc, DeadlineExceeded)
                        else f"development_{trial['key']}_derived_metrics"
                    )
                    stop_with(
                        exc,
                        phase=failure_phase,
                        case_index=exc.case_index if isinstance(exc, DeadlineExceeded) else None,
                    )
                    break
            if not cap_termination and not fatal_failure:
                development["status"] = "complete"
        except DeadlineExceeded as exc:
            stop_with(exc, phase=exc.phase, case_index=exc.case_index)
            development["status"] = "partial_wall_clock_cap"
        except Exception as exc:
            stop_with(exc, phase="development_preparation")
            development["status"] = "partial_failure"
    elif cap_termination:
        development["status"] = "not_evaluated_wall_clock_cap"
        development["reason"] = "deadline or earlier partial phase prevented the all-four-models 8/8 gate"
    elif fatal_failure:
        development["status"] = "not_evaluated_prior_failure"
        development["reason"] = "earlier structured failure prevented the all-four-models 8/8 gate"
    else:
        development["reason"] = "microset failed the all-four-models 8/8 criterion; stopped at diagnosis without development expansion"

    if not all_four_delayed_training_success and development["status"] == "not_evaluated":
        development["reason"] = "microset failed the all-four-models 8/8 criterion; stopped at diagnosis without development expansion"

    # Preserve the old top-level name for readers of the pre-review runner,
    # while making the new report's primary classification unambiguously
    # inspected development rather than fresh generalization.
    heldout_compatibility = copy.deepcopy(development)
    heldout_compatibility["compatibility_alias"] = "development"
    heldout_compatibility["deprecated_label"] = True

    historical_after = _historical_digests(project_root)
    runtime_wall = time.perf_counter() - start_wall
    runtime_cpu = time.process_time() - start_cpu
    trial_by_key = {trial["key"]: trial for trial in trial_models}
    for trial_record in trial_records:
        trial = trial_by_key.get(trial_record.get("key"))
        if trial is not None:
            trial_record["training_metrics"] = trial.get("training_metrics")

    if cap_termination:
        report_status = "partial_wall_clock_cap"
    elif fatal_failure:
        report_status = "failed"
    else:
        report_status = "complete"
    report = {
        "schema": "vevo.v03.neural-delayed-memory-report.v2",
        "status": report_status,
        "contract_path": CONTRACT_PATH,
        "source_sha": source_sha,
        "gate_head": gate_head,
        "command": " ".join(sys.argv),
        "report_path": str(output),
        "summary_path": str(summary_output),
        "architecture": {
            "full_model": "V03FiveBrain",
            "matched_control": "V03SingleRecurrentMemory",
            "gate_head": gate_head,
            "full_brains": 5,
            "control_brains": 1,
            "full_parameter_count": int(V03FiveBrain(DELAYED_MODEL_SEEDS[0], gate_head=gate_head).parameter_count()),
            "control_parameter_count": int(V03SingleRecurrentMemory(DELAYED_CONTROL_SEEDS[0], gate_head=gate_head).parameter_count()),
            "comparison_note": "This is a bundled final action-head/context redesign: the shared row gate and the pre-final frequency-head input change together; no pure single-factor claim is made.",
            "frequency_head_input": "pre-final retained context" if gate_head == SHARED_ROW_GATE_HEAD else "post-response action features",
            "common_parameter_initialization_preserved": gate_head == SHARED_ROW_GATE_HEAD,
            "shared_head_initialization_stream": "independent architecture-specific stream; legacy body/frequency draws reserved" if gate_head == SHARED_ROW_GATE_HEAD else "legacy parameter stream",
        },
        "schedule": {
            "policy_observation_count": 5,
            "stages": [
                "before_note",
                "note_shown_once",
                "goal_independent_delay_1",
                "goal_independent_delay_2",
                "spectrum_and_action",
            ],
            "note_payload_masks": [0, 1, 0, 0, 0],
            "hidden_note_validation": {
                "training": hidden_normalization,
                "all_training_examples_note_shown_once": all(
                    example["schedule_audit"]["note_shown_once"] for example in train_examples
                ),
            },
        },
        "data": {
            "training_world_seeds": list(DELAYED_TRAIN_WORLD_SEEDS),
            "training_example_count": len(train_examples),
            "goals_per_world": len(PROBE_FREQUENCIES),
            "training_input_digest": _json_digest(_training_observations(train_examples)),
            "normalization_fit_scope": "five-step delayed training observations only",
            "response_scaling_mode": response_scaling,
            "normalization": normalization,
            "development_world_seeds_inspected": list(DEVELOPMENT_WORLD_SEEDS),
            "development_world_seeds_predeclared": list(DEVELOPMENT_WORLD_SEEDS),
            "development_is_fresh_generalization": False,
            "development_label": "9300–9307 inspected development cases; never fresh generalization",
            "development_world_seeds_disjoint_from_historical": not (set(DEVELOPMENT_WORLD_SEEDS) & HISTORICAL_WORLD_SEEDS),
        },
        "optimizer": {
            "method": "balanced size-one minibatches with the existing Adam-style reverse-mode update",
            "learning_rate": float(LEARNING_RATE),
            "gradient_clip_norm": float(GRADIENT_CLIP_NORM),
            "max_updates_per_trial": MAX_UPDATES,
            "exact_resume_verified": False,
            "post_outcome_retuning_or_restart": False,
        },
        "training": {
            "full_model_seeds": list(DELAYED_MODEL_SEEDS),
            "control_seeds": list(DELAYED_CONTROL_SEEDS),
            "trials": trial_records,
            "all_four_delayed_training_success_8_of_8": all_four_delayed_training_success,
            "evaluation_gate": {
                "name": "all-four-models-8/8",
                "required_completed_trial_count": 4,
                "required_physical_successes_per_trial": len(train_specs),
                "description": "Development evaluation is permitted only when all four fixed trials complete within budget and each has 8/8 ordinary delayed training physical successes.",
                "met": all_four_delayed_training_success,
            },
            "microset_diagnosis": "passed 8/8 for all four trials" if all_four_delayed_training_success else "at least one trial did not reach 8/8; no development expansion",
        },
        "checkpoint_reload": checkpoint_reload,
        "retention": {
            "conditions": [
                {"name": name, "erasure": erasure, "state_scope": scope}
                for name, erasure, scope in RETENTION_CONDITIONS
            ],
            "models": retention,
            "pair_identity_validation": "world_seed, goal_index, and note_goal_id validated for every ordinary/ablation pair",
        },
        "references": references,
        "historical_comparisons": {
            "primary_source": "preceding_shared_response_scale",
            "primary_report_path": PRECEDING_SHARED_SCALE_REPORT_PATH,
            "primary_artifact_commit": PRECEDING_SHARED_SCALE_ARTIFACT_COMMIT,
            "primary_report_source_sha": PRECEDING_SHARED_SCALE_REPORT_SOURCE_SHA,
            "sources": historical_reference_metadata,
            "original_v1_retained_as_secondary": True,
        },
        "development": development,
        "heldout": heldout_compatibility,
        "checkpoints": checkpoint_records,
        "historical_artifacts": {
            "before": historical_before,
            "after": historical_after,
            "unchanged": historical_before == historical_after,
        },
        "limitations": [
            "This is a bounded delayed-memory RNN experiment, not a complete EvoCell or general agent.",
            "Causal erasure evidence is interpreted only after ordinary delayed recall succeeds for the same model.",
            "Slot-memory and recurrent-state erasures are distinct interventions; all-state combines them.",
            "Worlds 9300–9307 are previously inspected development cases and never fresh generalization evidence.",
            "The fixed schedule does not establish learned tool selection or complete tool-result writeback learning.",
            "Exact optimizer resume remains unverified.",
            "The 300-second cap is a cooperative wall-clock deadline: checks occur between updates, cases, and derived-metric stages, so an in-flight model operation or finalization can overrun it; no asynchronous kill is used.",
            "The reported elapsed wall time is captured before final JSON/Markdown serialization, so final filesystem serialization is outside that measured interval.",
            "Single-process CPU execution does not guarantee one BLAS/OpenMP thread or a fixed memory ceiling.",
            "No user-PC, production, deployment, paid compute, credentials, merge, or PR action was used.",
        ],
        "runtime": {
            "wall_clock_cap_seconds": float(wall_clock_cap),
            "wall_clock_seconds": float(runtime_wall),
            "process_cpu_seconds": float(runtime_cpu),
            "single_cpu_process": True,
            "single_process_not_single_thread_guarantee": True,
            "fixed_memory_ceiling": False,
            "deadline_enforcement": "cooperative",
            "deadline_overrun_possible": True,
            "deadline_overrun_note": "A currently running model operation or finalization can finish after the deadline; the runner records the cap at a subsequent cooperative check.",
            "elapsed_measurement_excludes_final_serialization": True,
            "elapsed_measurement_note": "wall_clock_seconds is captured before final JSON/Markdown serialization; final filesystem serialization can therefore run outside the reported elapsed interval.",
            "python": platform.python_version(),
            "max_rss_kb": int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss),
            "cap_termination": bool(cap_termination),
            "within_wall_clock_cap": bool(runtime_wall <= wall_clock_cap),
            "failures": failures,
        },
    }
    _atomic_write_json(output, report)
    _atomic_write_text(summary_output, _markdown_summary(report))
    return report


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=REPORT_PATH)
    parser.add_argument("--wall-clock-cap", type=float, default=WALL_CLOCK_CAP_SECONDS)
    parser.add_argument(
        "--response-scaling",
        choices=("legacy_per_coordinate", "shared_max_abs"),
        default="legacy_per_coordinate",
    )
    parser.add_argument("--gate-head", choices=GATE_HEAD_CHOICES, default=LEGACY_GATE_HEAD)
    parser.add_argument("--checkpoint-prefix", default=CHECKPOINT_PREFIX)
    args = parser.parse_args()
    report = run_experiment(
        output_path=args.output,
        wall_clock_cap=args.wall_clock_cap,
        response_scaling=args.response_scaling,
        checkpoint_prefix=args.checkpoint_prefix,
        gate_head=args.gate_head,
    )
    print(json.dumps({
        "schema": report["schema"],
        "source_sha": report["source_sha"],
        "all_four_delayed_training_success_8_of_8": report["training"]["all_four_delayed_training_success_8_of_8"],
        "development_status": report["development"]["status"],
        "heldout_status_compatibility_alias": report["heldout"]["status"],
        "runtime": report["runtime"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
