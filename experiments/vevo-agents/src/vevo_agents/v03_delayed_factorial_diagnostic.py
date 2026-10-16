"""Bounded frozen-checkpoint comparison for a delayed-memory input hazard.

This module performs no optimization.  It loads the four frozen delayed-memory
checkpoints, exactly replays the original-format rows from the prior factorial
diagnostic, and evaluates one predeclared intervention: clipping only the 16
normalized channel-response coordinates at the final neural update to
``[-3, +3]``.  The optional forward-trace instrumentation and the
evaluation-only input hook are default-off for ordinary model use.
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

from .v03_delayed_memory import (
    _goal_note,
    _gate_resonances,
    _prepare_delayed_episode,
)
from .v03_model import (
    NOTE_TEXT_FEATURE_START,
    NOTE_PAYLOAD_MASK_INDEX,
    SPECTRUM_FEATURE_END,
    SPECTRUM_FEATURE_START,
    V03FiveBrain,
    V03SingleRecurrentMemory,
    encode_policy_observation,
    normalize_policy_vector,
)
from .v03_neural_proof import _atomic_write_json
from .v03_neural_repair import _failure_cause, _json_digest
from .v03_protocol import CorrectedEpisode, PROBE_FREQUENCIES, SUCCESS_TOLERANCE_HZ


REPORT_PATH = "reports/generated/v03-neural-delayed-final-input-clipping-report.json"
SUMMARY_PATH = "reports/generated/v03-neural-delayed-final-input-clipping-summary.md"
PRIOR_FACTORIAL_REPORT_PATH = "reports/generated/v03-neural-delayed-factorial-diagnostic-report.json"
CPU_TIME_CAP_SECONDS = 300.0
ADDITIONAL_MEMORY_CAP_KB = 512 * 1024
NOTE_SUFFIX_RELATIVE_COLUMNS = (85, 86)
CLIP_BOUND = 3.0
CHANNEL_RESPONSE_FEATURE_INDICES = tuple(
    range(SPECTRUM_FEATURE_START + 4, SPECTRUM_FEATURE_END)
)
COMPARISON_CONDITIONS = ("baseline", "clip_response")

CHECKPOINT_PATHS = {
    "full-seed-107": "storage/checkpoints/v03-neural-delayed-memory-full-seed-107.json",
    "full-seed-117": "storage/checkpoints/v03-neural-delayed-memory-full-seed-117.json",
    "control-seed-141": "storage/checkpoints/v03-neural-delayed-memory-control-seed-141.json",
    "control-seed-143": "storage/checkpoints/v03-neural-delayed-memory-control-seed-143.json",
}

MODEL_CLASSES = {
    "V03FiveBrain": V03FiveBrain,
    "V03SingleRecurrentMemory": V03SingleRecurrentMemory,
}

CELL_DEFINITIONS = (
    {
        "name": "training_worlds_original_format",
        "world_set": "training_worlds",
        "world_seeds": (9200, 9201),
        "variant": "delayed-train",
    },
    {
        "name": "new_worlds_original_format",
        "world_set": "new_worlds",
        "world_seeds": (9300, 9301, 9302, 9303, 9304, 9305, 9306, 9307),
        "variant": "delayed-train",
    },
)


class DiagnosticBudgetExceeded(RuntimeError):
    """The frozen diagnostic reached its CPU or additional-memory bound."""


class DiagnosticBudget:
    def __init__(self, *, cpu_cap_seconds: float, baseline_rss_kb: int):
        self.start_cpu = time.process_time()
        self.start_wall = time.perf_counter()
        self.cpu_cap_seconds = float(cpu_cap_seconds)
        self.baseline_rss_kb = int(baseline_rss_kb)
        self.evaluations = 0

    def check(self, context: str) -> None:
        cpu_seconds = time.process_time() - self.start_cpu
        max_rss_kb = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        additional_kb = max(0, max_rss_kb - self.baseline_rss_kb)
        if cpu_seconds > self.cpu_cap_seconds:
            raise DiagnosticBudgetExceeded(f"CPU-time cap exceeded during {context}")
        if additional_kb > ADDITIONAL_MEMORY_CAP_KB:
            raise DiagnosticBudgetExceeded(f"additional-memory cap exceeded during {context}")

    def begin_evaluation(self, context: str) -> None:
        self.check(context)
        self.evaluations += 1

    def runtime(self) -> dict:
        max_rss_kb = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        return {
            "cpu_seconds": float(time.process_time() - self.start_cpu),
            "wall_clock_seconds": float(time.perf_counter() - self.start_wall),
            "cpu_time_cap_seconds": self.cpu_cap_seconds,
            "max_rss_kb": max_rss_kb,
            "baseline_rss_kb": self.baseline_rss_kb,
            "additional_high_water_kb": max(0, max_rss_kb - self.baseline_rss_kb),
            "additional_memory_cap_kb": ADDITIONAL_MEMORY_CAP_KB,
            "within_cpu_cap": bool(time.process_time() - self.start_cpu <= self.cpu_cap_seconds),
            "within_additional_memory_cap": bool(max(0, max_rss_kb - self.baseline_rss_kb) <= ADDITIONAL_MEMORY_CAP_KB),
            "evaluations_started": int(self.evaluations),
            "single_cpu_process": True,
            "python": platform.python_version(),
        }


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _source_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


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


def _make_spec(world_set: str, world_seed: int, goal_index: int, variant: str) -> dict:
    return {
        "split": f"factorial-{world_set}",
        "world_set": world_set,
        "world_seed": int(world_seed),
        "goal_index": int(goal_index),
        "note_goal_id": f"factorial-{world_set}-goal-{goal_index}",
        "note_variant": variant,
        "note_text": _goal_note(goal_index, variant, 0.0),
        "gate_resonance_hz": _gate_resonances(world_seed).tolist(),
    }


def _cell_specs(cell: dict) -> list[dict]:
    return [
        _make_spec(cell["world_set"], world_seed, goal_index, cell["variant"])
        for world_seed in cell["world_seeds"]
        for goal_index in range(len(PROBE_FREQUENCIES))
    ]


def make_factorial_cells() -> dict[str, list[dict]]:
    return {cell["name"]: _cell_specs(cell) for cell in CELL_DEFINITIONS}


def _prior_replay_specs(cell: dict) -> list[dict]:
    """Recreate the exact identity labels used by the prior report rows."""

    if cell["name"] != "training_worlds_original_format":
        return _cell_specs(cell)
    return [
        {
            "split": cell["variant"],
            "world_set": cell["world_set"],
            "world_seed": int(world_seed),
            "goal_index": int(goal_index),
            "note_goal_id": f"{cell['variant']}-goal-{goal_index}",
            "note_variant": cell["variant"],
            "note_text": _goal_note(goal_index, cell["variant"], 0.0),
            "gate_resonance_hz": _gate_resonances(world_seed).tolist(),
        }
        for world_seed in cell["world_seeds"]
        for goal_index in range(len(PROBE_FREQUENCIES))
    ]


def _cache_key(spec: dict) -> tuple[int, int, str]:
    return int(spec["world_seed"]), int(spec["goal_index"]), str(spec["note_variant"])


def _identity(spec: dict) -> tuple[int, int, str]:
    return int(spec["world_seed"]), int(spec["goal_index"]), str(spec["note_goal_id"])


def _authoritative_resonance_gate(gate_resonance_hz, target_hz: float) -> int:
    """Return the unique physical gate whose resonance matches the note target.

    This is intentionally independent of the measured response matrix and of
    every policy input.  It is an evaluator/reference calculation over the
    authoritative world resonance constants only.
    """

    resonances = np.asarray(gate_resonance_hz, dtype=np.float64)
    if resonances.shape != (4,) or not np.isfinite(resonances).all():
        raise ValueError("invalid gate resonance reference")
    matches = np.isclose(
        resonances,
        float(target_hz),
        rtol=0.0,
        atol=SUCCESS_TOLERANCE_HZ,
    )
    if int(np.count_nonzero(matches)) != 1:
        raise ValueError("target resonance must match exactly one authoritative gate")
    return int(np.flatnonzero(matches)[0])


def _clip_response_coordinates(vector: np.ndarray) -> np.ndarray:
    """Evaluation-only hook for the one predeclared final-update intervention."""

    result = np.asarray(vector, dtype=np.float64).copy()
    indices = np.asarray(CHANNEL_RESPONSE_FEATURE_INDICES, dtype=np.int64)
    result[indices] = np.clip(result[indices], -CLIP_BOUND, CLIP_BOUND)
    return result


def _prepare_cache(specs: list[dict], cache: dict, budget: DiagnosticBudget | None = None) -> None:
    for spec in specs:
        key = _cache_key(spec)
        if key in cache:
            continue
        if budget is not None:
            budget.check(f"physical preparation {key}")
        episode, observations, schedule_audit = _prepare_delayed_episode(spec)
        snapshot = episode.snapshot()
        restored = CorrectedEpisode.restore(json.loads(json.dumps(snapshot, sort_keys=True)))
        frequencies = np.asarray(restored.measurement["probe_frequencies"], dtype=np.float64)
        matrix = np.asarray(restored.measurement["channel_response"], dtype=np.float64)
        target_hz = float(PROBE_FREQUENCIES[int(spec["goal_index"])])
        target_column = int(np.argmin(np.abs(frequencies - target_hz)))
        spectrum_argmax_gate = int(np.argmax(matrix[:, target_column]))
        authoritative_resonance_gate = _authoritative_resonance_gate(
            restored.world.gate_resonance_hz,
            target_hz,
        )
        if authoritative_resonance_gate != _authoritative_resonance_gate(
            spec["gate_resonance_hz"],
            target_hz,
        ):
            raise AssertionError("spec and restored world resonance references differ")
        cache[key] = {
            "episode_snapshot": snapshot,
            "policy_observations": observations,
            "schedule_audit": schedule_audit,
            "raw_response": matrix.tolist(),
            "probe_frequencies": frequencies.tolist(),
            "target_column": target_column,
            "spectrum_argmax_gate": spectrum_argmax_gate,
            "authoritative_resonance_gate": authoritative_resonance_gate,
            "target_frequency_hz": target_hz,
            "gate_resonance_hz": restored.world.gate_resonance_hz.tolist(),
        }


def _load_frozen_models(project_root: Path) -> dict[str, dict]:
    models = {}
    for key, relative_path in CHECKPOINT_PATHS.items():
        path = project_root / relative_path
        payload = json.loads(path.read_text(encoding="utf-8"))
        model_class = MODEL_CLASSES[payload["model_class"]]
        model = model_class(int(payload["seed"]))
        model.load_state_dict(payload["state"])
        model.set_input_normalization(payload["normalization"])
        models[key] = {
            "key": key,
            "path": relative_path,
            "file_sha256": _sha256_file(path),
            "payload_schema": payload["schema"],
            "source_sha": payload.get("source_sha"),
            "model": model,
            "model_class": payload["model_class"],
            "label": "full" if payload["model_class"] == "V03FiveBrain" else "control",
            "seed": int(payload["seed"]),
            "parameter_count": int(payload["parameter_count"]),
            "normalization": copy.deepcopy(payload["normalization"]),
            "normalization_digest": _json_digest(payload["normalization"]),
            "state_digest_before": _json_digest(model.state_dict()),
            "updates": int(payload.get("training", {}).get("updates", -1)),
        }
    return models


def _range(values) -> dict:
    values = [float(value) for value in values]
    if not values:
        return {"min": None, "max": None, "mean": None, "n": 0}
    return {
        "min": float(min(values)),
        "max": float(max(values)),
        "mean": float(np.mean(values)),
        "n": len(values),
    }


def _stats(values, *, tanh_saturation: bool = False, sigmoid_saturation: bool = False) -> dict:
    array = np.asarray(values, dtype=np.float64).reshape(-1)
    if array.size == 0:
        return {"min": None, "max": None, "mean": None, "abs_max": None, "n": 0}
    result = {
        "min": float(np.min(array)),
        "max": float(np.max(array)),
        "mean": float(np.mean(array)),
        "abs_max": float(np.max(np.abs(array))),
        "n": int(array.size),
    }
    if tanh_saturation:
        result["tanh_abs_ge_0.99_fraction"] = float(np.mean(np.abs(np.tanh(array)) >= 0.99))
    if sigmoid_saturation:
        sigmoid = 1.0 / (1.0 + np.exp(-np.clip(array, -700.0, 700.0)))
        result["sigmoid_le_0.01_or_ge_0.99_fraction"] = float(
            np.mean((sigmoid <= 0.01) | (sigmoid >= 0.99))
        )
    return result


def _diagnostic_stats(model, trace: dict) -> dict:
    diagnostic = trace["diagnostics"]
    if isinstance(model, V03FiveBrain):
        preactivation = {
            "peripheral_hidden_pre": _stats(diagnostic["peripheral_pre"], tanh_saturation=True),
            "peripheral_message_pre": _stats(diagnostic["peripheral_message_pre"], tanh_saturation=True),
            "center_candidate_pre": _stats(diagnostic["center_candidate_pre"], tanh_saturation=True),
            "center_update_pre": _stats(diagnostic["center_update_pre"], sigmoid_saturation=True),
            "write_gate_pre": _stats(diagnostic["write_gate_pre"], sigmoid_saturation=True),
            "action_gate_logits": _stats(diagnostic["action_gate_logits"]),
            "action_frequency_logits": _stats(diagnostic["action_frequency_logits"]),
        }
        hidden_norms = {
            "central": float(np.linalg.norm(trace["central"])),
            **{
                f"peripheral_{index}": float(np.linalg.norm(value))
                for index, value in enumerate(trace["peripheral"])
            },
        }
    else:
        preactivation = {
            "hidden_pre": _stats(diagnostic["hidden_pre"], tanh_saturation=True),
            "write_gate_pre": _stats(diagnostic["write_gate_pre"], sigmoid_saturation=True),
            "action_gate_logits": _stats(diagnostic["action_gate_logits"]),
            "action_frequency_logits": _stats(diagnostic["action_frequency_logits"]),
        }
        hidden_norms = {"hidden": float(np.linalg.norm(trace["hidden"]))}
    memory = np.asarray(trace["memory"], dtype=np.float64)
    return {
        "frequency_probabilities": np.asarray(trace["frequency_probs"], dtype=np.float64).tolist(),
        "frequency_argmax": int(np.argmax(trace["frequency_probs"])),
        "gate_probabilities": np.asarray(trace["gate_probs"], dtype=np.float64).tolist(),
        "recurrent_hidden_norms": hidden_norms,
        "memory_slot_norms": np.linalg.norm(memory, axis=1).tolist(),
        "memory_total_norm": float(np.linalg.norm(memory)),
        "preactivation": preactivation,
    }


def _final_input_audit(
    normalized_before: np.ndarray,
    normalized_after: np.ndarray,
    *,
    condition: str,
    pre_final_state_digest: str,
) -> dict:
    delta = np.asarray(normalized_after, dtype=np.float64) - np.asarray(normalized_before, dtype=np.float64)
    response_indices = np.asarray(CHANNEL_RESPONSE_FEATURE_INDICES, dtype=np.int64)
    all_indices = np.arange(normalized_before.size, dtype=np.int64)
    changed = np.flatnonzero(delta != 0.0)
    non_response = np.setdiff1d(all_indices, response_indices, assume_unique=True)
    response_before = normalized_before[response_indices]
    response_after = normalized_after[response_indices]
    return {
        "condition": condition,
        "hook_applied": condition == "clip_response",
        "hook_name": None if condition == "baseline" else "clip_16_normalized_channel_response_coordinates",
        "clip_bound": float(CLIP_BOUND),
        "feature_dimension": int(normalized_before.size),
        "response_feature_indices": [int(index) for index in response_indices],
        "normalized_input_digest_before_hook": _json_digest(normalized_before.tolist()),
        "normalized_input_digest_after_hook": _json_digest(normalized_after.tolist()),
        "normalized_response_before_hook": response_before.tolist(),
        "normalized_response_after_hook": response_after.tolist(),
        "normalized_response_delta": (response_after - response_before).tolist(),
        "changed_feature_indices": [int(index) for index in changed],
        "changed_coordinate_count": int(changed.size),
        "below_clip_bound_count": int(np.count_nonzero(response_before < -CLIP_BOUND)),
        "above_clip_bound_count": int(np.count_nonzero(response_before > CLIP_BOUND)),
        # This is intentionally named at-or-beyond: the predicate includes
        # values strictly beyond the bound as well as values exactly on it.
        "at_or_beyond_clip_bound_after_count": int(np.count_nonzero(np.abs(response_after) >= CLIP_BOUND)),
        "max_abs_non_response_delta": float(np.max(np.abs(delta[non_response]), initial=0.0)),
        "max_abs_response_delta": float(np.max(np.abs(delta[response_indices]), initial=0.0)),
        "only_declared_coordinates_changed": bool(np.all(delta[non_response] == 0.0)),
        "pre_final_state_digest": pre_final_state_digest,
    }


def _instrumented_episode(
    model_record: dict,
    spec: dict,
    prepared: dict,
    budget: DiagnosticBudget,
    *,
    condition: str = "baseline",
) -> dict:
    if condition not in COMPARISON_CONDITIONS:
        raise ValueError(f"unsupported frozen comparison condition: {condition}")
    model = model_record["model"]
    budget.begin_evaluation(
        f"{model_record['key']}:{spec['world_seed']}:{spec['goal_index']}:{spec['note_variant']}:{condition}"
    )
    episode = CorrectedEpisode.restore(json.loads(json.dumps(prepared["episode_snapshot"], sort_keys=True)))
    runtime = model.initial_runtime()
    stages = []
    rows = []
    final_observation = prepared["policy_observations"][-1]
    final_vector = encode_policy_observation(final_observation)
    normalized_before = normalize_policy_vector(final_vector, model.normalization_state())
    normalized_after = (
        _clip_response_coordinates(normalized_before)
        if condition == "clip_response"
        else normalized_before.copy()
    )
    pre_final_state_digest = None
    for index, observation in enumerate(prepared["policy_observations"]):
        is_final_update = index == len(prepared["policy_observations"]) - 1
        if is_final_update:
            pre_final_state_digest = _json_digest(model.brain_snapshot(runtime))
        hook = _clip_response_coordinates if is_final_update and condition == "clip_response" else None
        runtime, trace = model.raw_step(
            runtime,
            observation,
            collect_diagnostics=True,
            evaluation_only_input_hook=hook,
        )
        stage = _diagnostic_stats(model, trace)
        stage["stage"] = prepared["schedule_audit"]["stage_names"][index]
        stage["stage_index"] = index
        stages.append(stage)
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
    raw_matrix = np.asarray(prepared["raw_response"], dtype=np.float64)
    raw_response = raw_matrix.reshape(-1)
    shown_vector = encode_policy_observation(prepared["policy_observations"][1])
    shown_normalized = normalize_policy_vector(shown_vector, model.normalization_state())
    suffix_values = {}
    for relative in NOTE_SUFFIX_RELATIVE_COLUMNS:
        absolute = NOTE_TEXT_FEATURE_START + relative
        suffix_values[str(relative)] = {
            "absolute_feature_index": absolute,
            "raw": float(shown_vector[absolute]),
            "normalized": float(shown_normalized[absolute]),
        }
    reference_gate = int(prepared["authoritative_resonance_gate"])
    reference_matches_spectrum = reference_gate == int(prepared["spectrum_argmax_gate"])
    return {
        "model_key": model_record["key"],
        "model_class": model_record["model_class"],
        "model_seed": model_record["seed"],
        "condition": condition,
        "split": spec["split"],
        "world_set": spec["world_set"],
        "world_seed": int(spec["world_seed"]),
        "goal_index": int(spec["goal_index"]),
        "note_goal_id": spec["note_goal_id"],
        "note_variant": spec["note_variant"],
        "success": bool(episode.success()),
        "failure_cause": _failure_cause(episode),
        "final_action": {
            "gate": int(gate),
            "frequency": float(frequency),
            "frequency_index": int(frequency_index),
        },
        "physical_reference_gate": reference_gate,
        "authoritative_resonance_gate": reference_gate,
        "authoritative_resonance_hz": float(prepared["gate_resonance_hz"][reference_gate]),
        "target_frequency_hz": float(prepared["target_frequency_hz"]),
        "spectrum_argmax_gate": int(prepared["spectrum_argmax_gate"]),
        "spectrum_argmax_matches_authoritative_reference": bool(reference_matches_spectrum),
        "target_column": int(prepared["target_column"]),
        "target_frequency_index": int(spec["goal_index"]),
        "gate_probabilities": np.asarray(trace["gate_probs"], dtype=np.float64).tolist(),
        "frequency_probabilities": np.asarray(trace["frequency_probs"], dtype=np.float64).tolist(),
        "frequency_probabilities_before_spectrum": stages[-2]["frequency_probabilities"],
        "frequency_probabilities_after_spectrum": stages[-1]["frequency_probabilities"],
        "rows": rows,
        "schedule_audit": prepared["schedule_audit"],
        "stages": stages,
        "raw_response": raw_response.tolist(),
        "normalized_response": normalized_after[list(CHANNEL_RESPONSE_FEATURE_INDICES)].tolist(),
        "normalized_response_before_hook": normalized_before[list(CHANNEL_RESPONSE_FEATURE_INDICES)].tolist(),
        "final_input_audit": _final_input_audit(
            normalized_before,
            normalized_after,
            condition=condition,
            pre_final_state_digest=str(pre_final_state_digest),
        ),
        "note_suffix_columns": suffix_values,
        "note_hidden_validated": bool(prepared["schedule_audit"]["hidden_goal_bearing_fields_validated"]),
        "tool_calls": int(episode.tool_calls),
        "physics_steps": int(episode.world.physics_steps),
        "virtual_steps": int(episode.virtual_steps),
        "virtual_work": float(episode.virtual_work),
        "live_work_spent": float(episode.world.work_spent),
        "world_residual": float(episode.world.residual),
        "world_work": float(episode.world.work),
        "world_dissipated": float(episode.world.dissipated),
        "authoritative_note_digest": episode.workspace.digest(),
    }


def _aggregate_stage_diagnostics(runs: list[dict]) -> list[dict]:
    if not runs:
        return []
    stage_count = len(runs[0]["stages"])
    result = []
    for index in range(stage_count):
        stages = [run["stages"][index] for run in runs]
        frequency = np.asarray([stage["frequency_probabilities"] for stage in stages], dtype=np.float64)
        hidden_keys = sorted({key for stage in stages for key in stage["recurrent_hidden_norms"]})
        hidden_ranges = {
            key: _range([stage["recurrent_hidden_norms"].get(key, 0.0) for stage in stages])
            for key in hidden_keys
        }
        memory_slot_count = len(stages[0]["memory_slot_norms"])
        memory_ranges = [
            _range([stage["memory_slot_norms"][slot] for stage in stages])
            for slot in range(memory_slot_count)
        ]
        preactivation_keys = sorted({key for stage in stages for key in stage["preactivation"]})
        preactivation = {}
        for key in preactivation_keys:
            values = [stage["preactivation"][key] for stage in stages if key in stage["preactivation"]]
            preactivation[key] = {
                "min": float(min(item["min"] for item in values)),
                "max": float(max(item["max"] for item in values)),
                "mean_of_means": float(np.mean([item["mean"] for item in values])),
                "abs_max": float(max(item["abs_max"] for item in values)),
                "saturation_fractions": {
                    field: float(np.mean([item[field] for item in values]))
                    for field in (
                        "tanh_abs_ge_0.99_fraction",
                        "sigmoid_le_0.01_or_ge_0.99_fraction",
                    )
                    if field in values[0]
                },
            }
        result.append({
            "stage_index": index,
            "stage": stages[0]["stage"],
            "frequency_probability_ranges": [_range(frequency[:, column]) for column in range(frequency.shape[1])],
            "frequency_probability_means": np.mean(frequency, axis=0).tolist(),
            "hidden_norm_ranges": hidden_ranges,
            "memory_slot_norm_ranges": memory_ranges,
            "preactivation_ranges": preactivation,
        })
    return result


def _frequency_memory_degradation(runs: list[dict]) -> dict:
    if not runs:
        return {}
    before = np.asarray([
        run["stages"][-2]["frequency_probabilities"] for run in runs
    ], dtype=np.float64)
    after = np.asarray([
        run["stages"][-1]["frequency_probabilities"] for run in runs
    ], dtype=np.float64)
    targets = np.asarray([run["target_frequency_index"] for run in runs], dtype=np.int64)
    before_target = before[np.arange(len(runs)), targets]
    after_target = after[np.arange(len(runs)), targets]
    before_argmax = np.argmax(before, axis=1)
    after_argmax = np.argmax(after, axis=1)
    delta = after_target - before_target
    before_accuracy = before_argmax == targets
    after_accuracy = after_argmax == targets
    mean_delta = float(np.mean(delta))
    if mean_delta < -1e-12 and np.mean(after_accuracy) < np.mean(before_accuracy):
        interpretation = "aggregate target-frequency probability and accuracy decreased after spectrum"
    elif mean_delta > 1e-12 and np.mean(after_accuracy) > np.mean(before_accuracy):
        interpretation = "aggregate target-frequency probability and accuracy increased after spectrum"
    else:
        interpretation = "mixed or no aggregate frequency-memory degradation"
    return {
        "stage_before_spectrum": runs[0]["stages"][-2]["stage"],
        "stage_after_spectrum": runs[0]["stages"][-1]["stage"],
        "target_probability_before": _range(before_target),
        "target_probability_after": _range(after_target),
        "target_probability_delta": _range(delta),
        "before_frequency_accuracy": float(np.mean(before_accuracy)),
        "after_frequency_accuracy": float(np.mean(after_accuracy)),
        "argmax_changed_count": int(np.sum(before_argmax != after_argmax)),
        "decreased_target_probability_count": int(np.sum(delta < -1e-12)),
        "increased_target_probability_count": int(np.sum(delta > 1e-12)),
        "interpretation": interpretation,
    }


def _clipping_summary(runs: list[dict]) -> dict:
    audits = [run["final_input_audit"] for run in runs]
    if not audits:
        return {}
    changed = np.asarray([audit["changed_coordinate_count"] for audit in audits], dtype=np.int64)
    below = np.asarray([audit["below_clip_bound_count"] for audit in audits], dtype=np.int64)
    above = np.asarray([audit["above_clip_bound_count"] for audit in audits], dtype=np.int64)
    at_or_beyond = np.asarray(
        [audit["at_or_beyond_clip_bound_after_count"] for audit in audits], dtype=np.int64
    )
    response_before = np.asarray(
        [audit["normalized_response_before_hook"] for audit in audits], dtype=np.float64
    )
    response_after = np.asarray(
        [audit["normalized_response_after_hook"] for audit in audits], dtype=np.float64
    )
    return {
        "condition": audits[0]["condition"],
        "clip_bound": float(CLIP_BOUND),
        "response_feature_indices": list(CHANNEL_RESPONSE_FEATURE_INDICES),
        "changed_coordinate_total": int(np.sum(changed)),
        "changed_coordinate_range": _range(changed),
        "below_clip_bound_total": int(np.sum(below)),
        "above_clip_bound_total": int(np.sum(above)),
        "at_or_beyond_clip_bound_after_total": int(np.sum(at_or_beyond)),
        "clipped_coordinate_fraction": float(np.sum(changed) / (len(audits) * len(CHANNEL_RESPONSE_FEATURE_INDICES))),
        "all_only_declared_coordinates_changed": all(
            bool(audit["only_declared_coordinates_changed"]) for audit in audits
        ),
        "response_before_range": _range(response_before.reshape(-1)),
        "response_after_range": _range(response_after.reshape(-1)),
        "response_coordinate_before_ranges": [
            _range(response_before[:, index]) for index in range(response_before.shape[1])
        ],
        "response_coordinate_after_ranges": [
            _range(response_after[:, index]) for index in range(response_after.shape[1])
        ],
        "response_coordinate_changed_counts": [
            int(np.count_nonzero(response_before[:, index] != response_after[:, index]))
            for index in range(response_before.shape[1])
        ],
    }


def _cell_summary(cell: dict, model_record: dict, runs: list[dict]) -> dict:
    reference_gates = np.asarray([run["physical_reference_gate"] for run in runs], dtype=np.int64)
    model_gates = np.asarray([run["final_action"]["gate"] for run in runs], dtype=np.int64)
    model_frequencies = np.asarray([run["final_action"]["frequency_index"] for run in runs], dtype=np.int64)
    target_frequencies = np.asarray([run["target_frequency_index"] for run in runs], dtype=np.int64)
    raw = np.asarray([run["raw_response"] for run in runs], dtype=np.float64)
    normalized = np.asarray([run["normalized_response"] for run in runs], dtype=np.float64)
    raw_coordinates = []
    normalized_coordinates = []
    for column in range(raw.shape[1]):
        raw_coordinates.append(_range(raw[:, column]))
        normalized_coordinates.append(_range(normalized[:, column]))
    suffix = {}
    for relative in NOTE_SUFFIX_RELATIVE_COLUMNS:
        values = [run["note_suffix_columns"][str(relative)] for run in runs]
        suffix[str(relative)] = {
            "absolute_feature_index": values[0]["absolute_feature_index"],
            "raw_range": _range([item["raw"] for item in values]),
            "normalized_range": _range([item["normalized"] for item in values]),
        }
    failures = Counter(run["failure_cause"] for run in runs if run["failure_cause"])
    return {
        "cell": cell["name"],
        "world_set": cell["world_set"],
        "world_seeds": list(cell["world_seeds"]),
        "note_variant": cell["variant"],
        "condition": runs[0]["condition"] if runs else None,
        "n": len(runs),
        "gate_accuracy_vs_physical_reference": float(np.mean(model_gates == reference_gates)),
        "frequency_accuracy": float(np.mean(model_frequencies == target_frequencies)),
        "joint_accuracy": float(np.mean((model_gates == reference_gates) & (model_frequencies == target_frequencies))),
        "physical_successes": int(sum(bool(run["success"]) for run in runs)),
        "physical_success_rate": float(np.mean([run["success"] for run in runs])),
        "gate_action_histogram": dict(sorted(Counter(model_gates.tolist()).items())),
        "frequency_action_histogram": dict(sorted(Counter(model_frequencies.tolist()).items())),
        "failure_counts": dict(sorted(failures.items())),
        "spectrum_argmax_matches_physical_reference": int(sum(
            run["spectrum_argmax_gate"] == run["physical_reference_gate"] for run in runs
        )),
        "model_gate_matches_spectrum_argmax": int(sum(
            run["final_action"]["gate"] == run["spectrum_argmax_gate"] for run in runs
        )),
        "raw_response_range": _range(raw.reshape(-1)),
        "normalized_response_range": _range(normalized.reshape(-1)),
        "raw_response_coordinate_ranges": raw_coordinates,
        "normalized_response_coordinate_ranges": normalized_coordinates,
        "note_suffix_columns_85_86": suffix,
        "clipping_audit": _clipping_summary(runs),
        "stage_diagnostics": _aggregate_stage_diagnostics(runs),
        "final_stage_preactivation_ranges": _aggregate_stage_diagnostics(runs)[-1]["preactivation_ranges"],
        "frequency_memory_degradation": _frequency_memory_degradation(runs),
        "hidden_note_validation": all(bool(run["note_hidden_validated"]) for run in runs),
        "runs": runs,
        "model_key": model_record["key"],
    }


def _factor_pair_summary(left: list[dict], right: list[dict], *, left_variant: str, right_variant: str) -> dict:
    if len(left) != len(right):
        raise ValueError("factorial pair lengths differ")
    transitions = {
        "physical_success_to_success": 0,
        "physical_success_to_failure": 0,
        "physical_failure_to_success": 0,
        "physical_failure_to_failure": 0,
    }
    gate_changes = frequency_changes = joint_changes = probability_changes = 0
    left_gate_correct = []
    right_gate_correct = []
    left_frequency_correct = []
    right_frequency_correct = []
    left_joint_correct = []
    right_joint_correct = []
    paired_runs = []
    changed_actions = []
    success_transitions = []
    pre_final_state_equal = []
    only_declared_coordinates_changed = []
    changed_coordinate_counts = []
    for lrun, rrun in zip(left, right):
        lidentity = (int(lrun["world_seed"]), int(lrun["goal_index"]), str(lrun["note_goal_id"]))
        ridentity = (int(rrun["world_seed"]), int(rrun["goal_index"]), str(rrun["note_goal_id"]))
        if lidentity != ridentity:
            raise ValueError(f"factorial pair identity mismatch: {lidentity} != {ridentity}")
        left_label = lrun.get("condition", lrun["note_variant"])
        right_label = rrun.get("condition", rrun["note_variant"])
        if left_label != left_variant or right_label != right_variant:
            raise ValueError("frozen comparison labels do not match")
        if "condition" in lrun or "condition" in rrun:
            if lrun["note_variant"] != rrun["note_variant"]:
                raise ValueError("paired runs changed the note variant")
        elif left_variant == right_variant and lrun["note_variant"] != rrun["note_variant"]:
            raise ValueError("paired runs changed the note variant")
        lsuccess = bool(lrun["success"])
        rsuccess = bool(rrun["success"])
        if lsuccess and rsuccess:
            transitions["physical_success_to_success"] += 1
        elif lsuccess and not rsuccess:
            transitions["physical_success_to_failure"] += 1
        elif not lsuccess and rsuccess:
            transitions["physical_failure_to_success"] += 1
        else:
            transitions["physical_failure_to_failure"] += 1
        gate_changes += int(lrun["final_action"]["gate"] != rrun["final_action"]["gate"])
        frequency_changes += int(lrun["final_action"]["frequency_index"] != rrun["final_action"]["frequency_index"])
        lgate = lrun["final_action"]["gate"] == lrun["physical_reference_gate"]
        rgate = rrun["final_action"]["gate"] == rrun["physical_reference_gate"]
        lfreq = lrun["final_action"]["frequency_index"] == lrun["target_frequency_index"]
        rfreq = rrun["final_action"]["frequency_index"] == rrun["target_frequency_index"]
        left_gate_correct.append(lgate)
        right_gate_correct.append(rgate)
        left_frequency_correct.append(lfreq)
        right_frequency_correct.append(rfreq)
        left_joint_correct.append(lgate and lfreq)
        right_joint_correct.append(rgate and rfreq)
        joint_changes += int((lgate and lfreq) != (rgate and rfreq))
        probability_changes += int(
            not np.allclose(lrun["gate_probabilities"], rrun["gate_probabilities"], rtol=0.0, atol=1e-12)
            or not np.allclose(lrun["frequency_probabilities"], rrun["frequency_probabilities"], rtol=0.0, atol=1e-12)
        )
        left_audit = lrun.get("final_input_audit", {})
        right_audit = rrun.get("final_input_audit", {})
        pre_state_equal = (
            left_audit.get("pre_final_state_digest", "__legacy_missing__")
            == right_audit.get("pre_final_state_digest", "__legacy_missing__")
        )
        declared_only = bool(right_audit.get("only_declared_coordinates_changed", True))
        changed_coordinate_count = int(right_audit.get("changed_coordinate_count", 0))
        pre_final_state_equal.append(pre_state_equal)
        only_declared_coordinates_changed.append(declared_only)
        changed_coordinate_counts.append(changed_coordinate_count)
        transition = (
            "physical_success_to_success" if lsuccess and rsuccess else
            "physical_success_to_failure" if lsuccess and not rsuccess else
            "physical_failure_to_success" if not lsuccess and rsuccess else
            "physical_failure_to_failure"
        )
        success_transitions.append({
            "world_seed": int(lrun["world_seed"]),
            "goal_index": int(lrun["goal_index"]),
            "note_goal_id": lrun["note_goal_id"],
            "transition": transition,
            "baseline_success": lsuccess,
            "comparison_success": rsuccess,
        })
        paired = {
            "world_seed": int(lrun["world_seed"]),
            "goal_index": int(lrun["goal_index"]),
            "note_goal_id": lrun["note_goal_id"],
            "success_transition": transition,
            "baseline_action": lrun["final_action"],
            "comparison_action": rrun["final_action"],
            "baseline_gate_probabilities": lrun["gate_probabilities"],
            "comparison_gate_probabilities": rrun["gate_probabilities"],
            "baseline_frequency_probabilities": lrun["frequency_probabilities"],
            "comparison_frequency_probabilities": rrun["frequency_probabilities"],
            "baseline_frequency_probabilities_before_spectrum": lrun.get(
                "frequency_probabilities_before_spectrum", lrun["frequency_probabilities"]
            ),
            "baseline_frequency_probabilities_after_spectrum": lrun.get(
                "frequency_probabilities_after_spectrum", lrun["frequency_probabilities"]
            ),
            "comparison_frequency_probabilities_before_spectrum": rrun.get(
                "frequency_probabilities_before_spectrum", rrun["frequency_probabilities"]
            ),
            "comparison_frequency_probabilities_after_spectrum": rrun.get(
                "frequency_probabilities_after_spectrum", rrun["frequency_probabilities"]
            ),
            "baseline_final_input_digest": left_audit.get("normalized_input_digest_before_hook"),
            "comparison_final_input_digest": right_audit.get("normalized_input_digest_after_hook"),
            "pre_final_state_identical": pre_state_equal,
            "only_declared_coordinates_changed": declared_only,
            "gate_changed": bool(lrun["final_action"]["gate"] != rrun["final_action"]["gate"]),
            "frequency_changed": bool(lrun["final_action"]["frequency_index"] != rrun["final_action"]["frequency_index"]),
            "joint_correctness_changed": bool((lgate and lfreq) != (rgate and rfreq)),
            "probability_linf": float(max(
                np.max(np.abs(np.asarray(lrun["gate_probabilities"]) - np.asarray(rrun["gate_probabilities"])), initial=0.0),
                np.max(np.abs(np.asarray(lrun["frequency_probabilities"]) - np.asarray(rrun["frequency_probabilities"])), initial=0.0),
            )),
            "clipped_feature_indices": right_audit.get("changed_feature_indices", []),
            "clipped_response_before": right_audit.get("normalized_response_before_hook", []),
            "clipped_response_after": right_audit.get("normalized_response_after_hook", []),
        }
        paired_runs.append(paired)
        if paired["gate_changed"] or paired["frequency_changed"]:
            changed_actions.append(paired)
    return {
        "left_variant": left_variant,
        "right_variant": right_variant,
        "n": len(left),
        "transitions": transitions,
        "net_physical_success_change": transitions["physical_failure_to_success"] - transitions["physical_success_to_failure"],
        "gate_accuracy_left": float(np.mean(left_gate_correct)),
        "gate_accuracy_right": float(np.mean(right_gate_correct)),
        "frequency_accuracy_left": float(np.mean(left_frequency_correct)),
        "frequency_accuracy_right": float(np.mean(right_frequency_correct)),
        "joint_accuracy_left": float(np.mean(left_joint_correct)),
        "joint_accuracy_right": float(np.mean(right_joint_correct)),
        "gate_action_changes": int(gate_changes),
        "frequency_action_changes": int(frequency_changes),
        "joint_correctness_changes": int(joint_changes),
        "probability_changes": int(probability_changes),
        "pre_final_state_identical_count": int(sum(pre_final_state_equal)),
        "pre_final_state_identical": bool(all(pre_final_state_equal)),
        "only_declared_coordinates_changed_count": int(sum(only_declared_coordinates_changed)),
        "only_declared_coordinates_changed": bool(all(only_declared_coordinates_changed)),
        "changed_coordinate_count_total": int(sum(changed_coordinate_counts)),
        "clipping_noop": bool(all(count == 0 for count in changed_coordinate_counts)),
        "success_transitions": success_transitions,
        "changed_actions": changed_actions,
        "paired_runs": paired_runs,
        "identity_validation": True,
    }


def _reproduction_projection(run: dict) -> dict:
    return {
        "split": run["split"],
        "world_seed": int(run["world_seed"]),
        "goal_index": int(run["goal_index"]),
        "note_goal_id": run["note_goal_id"],
        "success": bool(run["success"]),
        "failure_cause": run["failure_cause"],
        "final_action": run["final_action"],
        "physical_reference_gate": run["physical_reference_gate"],
        "spectrum_argmax_gate": run["spectrum_argmax_gate"],
        "target_column": run["target_column"],
        "target_frequency_index": run["target_frequency_index"],
        "gate_probabilities": run["gate_probabilities"],
        "frequency_probabilities": run["frequency_probabilities"],
        "rows": [
            {
                key: row[key]
                for key in (
                    "stage",
                    "policy_input_digest",
                    "selected_gate",
                    "selected_frequency_index",
                    "selected_frequency",
                    "gate_probabilities",
                    "frequency_probabilities",
                )
                if key in row
            }
            for row in run["rows"]
        ] if "rows" in run else [],
        "tool_calls": int(run["tool_calls"]),
        "virtual_steps": int(run["virtual_steps"]),
        "virtual_work": float(run["virtual_work"]),
        "live_work_spent": float(run["live_work_spent"]),
        "physics_steps": int(run["physics_steps"]),
        "world_residual": float(run["world_residual"]),
        "world_work": float(run["world_work"]),
        "world_dissipated": float(run["world_dissipated"]),
        "raw_response": run["raw_response"],
        "normalized_response": run["normalized_response"],
        "authoritative_note_digest": run["authoritative_note_digest"],
    }


def _expected_prior_factorial_runs(report: dict, model_key: str, cell_name: str) -> list[dict]:
    try:
        return report["cells"][cell_name][model_key]["runs"]
    except KeyError as exc:
        raise ValueError(f"prior factorial report is missing {cell_name}/{model_key}") from exc


def _reproduce_cell(
    model_record: dict,
    cell_name: str,
    specs: list[dict],
    cache: dict,
    prior_factorial_report: dict,
    budget: DiagnosticBudget,
) -> dict:
    actual_runs = [
        _instrumented_episode(
            model_record,
            spec,
            cache[_cache_key(spec)],
            budget,
            condition="baseline",
        )
        for spec in specs
    ]
    expected_runs = _expected_prior_factorial_runs(
        prior_factorial_report,
        model_record["key"],
        cell_name,
    )
    mismatches = []
    for index, (actual, expected) in enumerate(zip(actual_runs, expected_runs)):
        actual_digest = _json_digest(_reproduction_projection(actual))
        expected_digest = _json_digest(_reproduction_projection(expected))
        if actual_digest != expected_digest:
            mismatches.append({
                "index": index,
                "identity": [actual["world_seed"], actual["goal_index"], actual["note_goal_id"]],
                "actual_digest": actual_digest,
                "expected_digest": expected_digest,
            })
    return {
        "model_key": model_record["key"],
        "cell": cell_name,
        "source_report_cell": cell_name,
        "n": len(actual_runs),
        "passed": not mismatches and len(actual_runs) == len(expected_runs),
        "mismatches": mismatches,
        "runs": actual_runs,
    }


def _historical_files(project_root: Path, output_relative: str) -> list[str]:
    paths = []
    for pattern in (
        "reports/generated/*.json",
        "reports/imported/*.json",
        "storage/checkpoints/*.json",
    ):
        paths.extend(str(path.relative_to(project_root)) for path in sorted(project_root.glob(pattern)))
    return [path for path in paths if path != output_relative]


def _historical_digests(project_root: Path, paths: list[str]) -> dict[str, str]:
    return {path: _sha256_file(project_root / path) for path in paths}


def _normalization_audit(models: dict[str, dict]) -> dict:
    first = next(iter(models.values()))["normalization"]
    same = all(item["normalization"] == first for item in models.values())
    scales = np.asarray(first["scale"], dtype=np.float64)
    means = np.asarray(first["mean"], dtype=np.float64)
    response_start = SPECTRUM_FEATURE_START + 4
    gate1_indices = list(range(response_start + 4, response_start + 8))
    suffix = []
    for relative in NOTE_SUFFIX_RELATIVE_COLUMNS:
        absolute = NOTE_TEXT_FEATURE_START + relative
        suffix.append({
            "relative_note_text_byte": relative,
            "absolute_feature_index": absolute,
            "training_mean": float(means[absolute]),
            "training_scale": float(scales[absolute]),
        })
    return {
        "all_checkpoints_share_saved_normalization": same,
        "schema": first["schema"],
        "note_suffix_columns": suffix,
        "gate1_response_feature_indices": gate1_indices,
        "gate1_response_scales": [float(scales[index]) for index in gate1_indices],
        "spectrum_response_scales": [float(value) for value in scales[response_start:SPECTRUM_FEATURE_END]],
        "normalization_counts": first.get("counts"),
    }


def _compact_prior_aggregates(prior_report: dict) -> dict:
    aggregates = {}
    for cell_name, model_results in prior_report.get("cells", {}).items():
        aggregates[cell_name] = {}
        for model_key, summary in model_results.items():
            degradation = summary.get("frequency_memory_degradation", {})
            aggregates[cell_name][model_key] = {
                "n": summary.get("n"),
                "gate_accuracy_vs_physical_reference": summary.get("gate_accuracy_vs_physical_reference"),
                "frequency_accuracy": summary.get("frequency_accuracy"),
                "joint_accuracy": summary.get("joint_accuracy"),
                "physical_successes": summary.get("physical_successes"),
                "physical_success_rate": summary.get("physical_success_rate"),
                "raw_response_range": summary.get("raw_response_range"),
                "normalized_response_range": summary.get("normalized_response_range"),
                "frequency_before_spectrum_accuracy": degradation.get("before_frequency_accuracy"),
                "frequency_after_spectrum_accuracy": degradation.get("after_frequency_accuracy"),
                "frequency_target_probability_before": degradation.get("target_probability_before"),
                "frequency_target_probability_after": degradation.get("target_probability_after"),
                "spectrum_argmax_matches_physical_reference": summary.get(
                    "spectrum_argmax_matches_physical_reference"
                ),
            }
    return aggregates


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


def _percent(value: float | None) -> str:
    return "n/a" if value is None else f"{100.0 * float(value):.2f}%"


def _summary_markdown(report: dict) -> str:
    lines = [
        "# Delayed-memory final-input clipping comparison",
        "",
        f"Status: `{report['status']}`  ",
        f"Source commit at run: `{report['source_sha']}`  ",
        f"Full evidence: `{report['report_path']}`  ",
        "",
        "This is one frozen-weight, evaluation-only comparison. The baseline uses the saved normalized final input; the comparison clips only the 16 normalized channel-response coordinates to `[-3,+3]` at the final neural update. The four checkpoints, raw measurements, physics, schedule, normalization, and weights are shared. There was no training.",
        "",
        "## Design and integrity",
        "",
        f"- Evaluations: `{report['factorial_design']['actual_total_evaluations']}/{report['factorial_design']['expected_total_evaluations']}`; CPU cap `{report['runtime']['cpu_time_cap_seconds']:.0f}s`; additional-memory cap `{report['runtime']['additional_memory_cap_kb']} KB`.",
        f"- Baseline replay against prior factorial: `{report['reproduction']['passed']}`.",
        f"- Frozen model state unchanged: `{all(item.get('state_unchanged', False) for item in report['frozen_checkpoints'].values())}`.",
        f"- Historical reports/checkpoints byte-for-byte unchanged: `{report['historical_artifacts']['unchanged_byte_for_byte']}`.",
        f"- Independent resonance reference checks: `{report['reference_checks']['all_runs_use_independent_reference']}`; spectrum argmax agreed on `{report['reference_checks']['spectrum_argmax_matches_authoritative']}/{report['reference_checks']['reference_checks_run']}` checks.",
        "",
        "## Gate/frequency/joint/physical outcomes",
        "",
        "| world set | checkpoint | condition | gate | frequency | joint | physical |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    for cell in report["factorial_design"]["cells"]:
        cell_name = cell["name"]
        for model_key in CHECKPOINT_PATHS:
            for condition in COMPARISON_CONDITIONS:
                summary = report["cells"].get(cell_name, {}).get(model_key, {}).get(condition)
                if summary is None:
                    continue
                lines.append(
                    f"| {cell_name} | {model_key} | {condition} | {_percent(summary['gate_accuracy_vs_physical_reference'])} | {_percent(summary['frequency_accuracy'])} | {_percent(summary['joint_accuracy'])} | {summary['physical_successes']}/{summary['n']} |"
                )
    lines.extend([
        "",
        "## Paired transitions and action changes",
        "",
        "Each row below is paired by world seed, goal index, and note goal ID. The JSON contains every paired row, every success transition, and every changed action.",
        "",
        "| world set | checkpoint | n | success transitions (S→S / S→F / F→S / F→F) | gate changes | frequency changes | probability changes | pre-final state identical |",
        "|---|---|---:|---|---:|---:|---:|---:|",
    ])
    for cell in report["factorial_design"]["cells"]:
        cell_name = cell["name"]
        for model_key in CHECKPOINT_PATHS:
            pair = report["comparison"]["paired_results"].get(f"{model_key}:{cell_name}")
            if pair is None:
                continue
            transitions = pair["transitions"]
            lines.append(
                f"| {cell_name} | {model_key} | {pair['n']} | {transitions['physical_success_to_success']} / {transitions['physical_success_to_failure']} / {transitions['physical_failure_to_success']} / {transitions['physical_failure_to_failure']} | {pair['gate_action_changes']} | {pair['frequency_action_changes']} | {pair['probability_changes']} | {pair['pre_final_state_identical']} |"
            )
    lines.extend([
        "",
        "## Clipping and saturation audit",
        "",
        "| world set | checkpoint | condition | changed response coordinates | below -3 | above +3 | at-or-beyond ±3 after | only declared coordinates |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ])
    for cell in report["factorial_design"]["cells"]:
        cell_name = cell["name"]
        for model_key in CHECKPOINT_PATHS:
            for condition in COMPARISON_CONDITIONS:
                summary = report["cells"].get(cell_name, {}).get(model_key, {}).get(condition)
                if summary is None:
                    continue
                clipping = summary["clipping_audit"]
                lines.append(
                    f"| {cell_name} | {model_key} | {condition} | {clipping['changed_coordinate_total']} | {clipping['below_clip_bound_total']} | {clipping['above_clip_bound_total']} | {clipping['at_or_beyond_clip_bound_after_total']} | {clipping['all_only_declared_coordinates_changed']} |"
                )
    lines.extend([
        "",
        "The 16 clipped feature indices are `" + ", ".join(str(index) for index in CHANNEL_RESPONSE_FEATURE_INDICES) + "`. Baseline and clipped pre-final neural states are required to match exactly; clipping is no-op on the original training worlds in this run.",
        "",
        "## Prior factorial aggregates",
        "",
        "The prior report is preserved byte-for-byte and its compact aggregates are copied into the full JSON. The original-format rows below are the baseline replay reference; the prior report also contains the held-out-format factorial cells.",
        "",
        "| prior cell | checkpoint | gate | frequency before→after spectrum | joint | physical | normalized response range |",
        "|---|---|---:|---:|---:|---:|---|",
    ])
    for cell_name, model_results in report["prior_factorial"]["aggregates"].items():
        for model_key, summary in model_results.items():
            lines.append(
                f"| {cell_name} | {model_key} | {_percent(summary['gate_accuracy_vs_physical_reference'])} | {_percent(summary['frequency_before_spectrum_accuracy'])} → {_percent(summary['frequency_after_spectrum_accuracy'])} | {_percent(summary['joint_accuracy'])} | {summary['physical_successes']}/{summary['n']} | {summary['normalized_response_range']['min']:.3g}..{summary['normalized_response_range']['max']:.3g} |"
            )
    lines.extend([
        "",
        "## Interpretation boundary",
        "",
        "These are previously inspected training and development worlds only. Clipping is a lossy diagnostic intervention, not a proven production fix; the result must not be generalized beyond these inspected worlds or treated as evidence of a safe deployment change.",
        "",
    ])
    return "\n".join(lines)


def run_diagnostic(*, output_path: str | Path = REPORT_PATH, cpu_time_cap: float = CPU_TIME_CAP_SECONDS) -> dict:
    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"refusing to overwrite diagnostic report: {output}")
    summary = Path(SUMMARY_PATH) if output.name == Path(REPORT_PATH).name else output.with_suffix(".md")
    if summary.exists():
        raise FileExistsError(f"refusing to overwrite diagnostic summary: {summary}")
    project_root = _project_root()
    source_sha = _source_sha()
    baseline_rss_kb = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    budget = DiagnosticBudget(cpu_cap_seconds=cpu_time_cap, baseline_rss_kb=baseline_rss_kb)
    try:
        output_relative = str(output.resolve().relative_to(project_root.resolve()))
    except ValueError:
        output_relative = str(output)
    historical_paths = _historical_files(project_root, output_relative)
    historical_before = _historical_digests(project_root, historical_paths)
    prior_factorial_report = json.loads(
        (project_root / PRIOR_FACTORIAL_REPORT_PATH).read_text(encoding="utf-8")
    )
    models = _load_frozen_models(project_root)
    normalization_audit = _normalization_audit(models)
    cells = make_factorial_cells()
    comparison_specs = {
        cell["name"]: _prior_replay_specs(cell)
        for cell in CELL_DEFINITIONS
    }
    all_specs = [spec for specs in comparison_specs.values() for spec in specs]
    cache = {}
    _prepare_cache(all_specs, cache, budget)
    cache_stats = {
        "unique_physical_preparations": len(cache),
        "model_condition_evaluation_uses_expected": len(cache) * len(models) * len(COMPARISON_CONDITIONS),
        "reuse_factor": len(models),
        "identical_preparations_reused_across_checkpoints": True,
        "raw_measurements_reused_across_conditions": True,
    }
    reproduction = {}
    cell_results = {}
    failures = []
    reproduction_passed = True
    baseline_runs = {}
    clipped_runs = {}
    try:
        for cell in CELL_DEFINITIONS:
            cell_name = cell["name"]
            for model_key, model_record in models.items():
                result = _reproduce_cell(
                    model_record,
                    cell_name,
                    comparison_specs[cell_name],
                    cache,
                    prior_factorial_report,
                    budget,
                )
                reproduction[f"{model_key}:{cell_name}"] = {
                    key: value for key, value in result.items() if key != "runs"
                }
                baseline_runs[(cell_name, model_key)] = result["runs"]
                cell_results.setdefault(cell_name, {}).setdefault(model_key, {})["baseline"] = _cell_summary(
                    next(item for item in CELL_DEFINITIONS if item["name"] == cell_name),
                    model_record,
                    result["runs"],
                )
                cell_results[cell_name][model_key]["baseline"]["reproduction_source"] = "prior_factorial_report"
                if not result["passed"]:
                    reproduction_passed = False
        if not reproduction_passed:
            failures.append("prior factorial baseline replay mismatch; clipping comparison stopped")
        else:
            for cell in CELL_DEFINITIONS:
                for model_key, model_record in models.items():
                    runs = [
                        _instrumented_episode(
                            model_record,
                            spec,
                            cache[_cache_key(spec)],
                            budget,
                            condition="clip_response",
                        )
                        for spec in comparison_specs[cell["name"]]
                    ]
                    clipped_runs[(cell["name"], model_key)] = runs
                    cell_results.setdefault(cell["name"], {}).setdefault(model_key, {})["clip_response"] = _cell_summary(
                        cell,
                        model_record,
                        runs,
                    )
                    cell_results[cell["name"]][model_key]["clip_response"]["reproduction_source"] = "new_frozen_comparison"
    except DiagnosticBudgetExceeded as exc:
        failures.append(str(exc))
    except Exception as exc:
        failures.append(f"diagnostic_exception: {type(exc).__name__}: {exc}")

    paired_results = {}
    if reproduction_passed and not failures and len(clipped_runs) == len(CELL_DEFINITIONS) * len(models):
        for cell in CELL_DEFINITIONS:
            for model_key in models:
                paired_results[f"{model_key}:{cell['name']}"] = _factor_pair_summary(
                    baseline_runs[(cell["name"], model_key)],
                    clipped_runs[(cell["name"], model_key)],
                    left_variant="baseline",
                    right_variant="clip_response",
                )
        all_baseline = [
            run
            for cell in CELL_DEFINITIONS
            for model_key in models
            for run in baseline_runs[(cell["name"], model_key)]
        ]
        all_clipped = [
            run
            for cell in CELL_DEFINITIONS
            for model_key in models
            for run in clipped_runs[(cell["name"], model_key)]
        ]
        paired_results["all_checkpoints:all_worlds"] = _factor_pair_summary(
            all_baseline,
            all_clipped,
            left_variant="baseline",
            right_variant="clip_response",
        )

    training_outputs_unchanged = None
    if all(
        (cell["name"], model_key) in baseline_runs and (cell["name"], model_key) in clipped_runs
        for cell in CELL_DEFINITIONS[:1]
        for model_key in models
    ):
        training_outputs_unchanged = all(
            pair["transitions"] == {
                "physical_success_to_success": pair["n"],
                "physical_success_to_failure": 0,
                "physical_failure_to_success": 0,
                "physical_failure_to_failure": 0,
            }
            and pair["gate_action_changes"] == 0
            and pair["frequency_action_changes"] == 0
            and pair["probability_changes"] == 0
            and pair["changed_coordinate_count_total"] == 0
            and pair["clipping_noop"]
            and pair["pre_final_state_identical"]
            for key, pair in paired_results.items()
            if key.endswith(":training_worlds_original_format")
        )

    for model_record in models.values():
        model_record["state_digest_after"] = _json_digest(model_record["model"].state_dict())
        model_record["state_unchanged"] = model_record["state_digest_before"] == model_record["state_digest_after"]
        if not model_record["state_unchanged"]:
            failures.append(f"frozen checkpoint state changed for {model_record['key']}")

    historical_after = _historical_digests(project_root, historical_paths)
    comparison_evaluations = sum(len(runs) for runs in baseline_runs.values()) + sum(
        len(runs) for runs in clipped_runs.values()
    )
    all_runs = [
        run
        for runs in (*baseline_runs.values(), *clipped_runs.values())
        for run in runs
    ]
    reference_checks_run = len(all_runs)
    reference_matches = sum(
        bool(run["spectrum_argmax_matches_authoritative_reference"]) for run in all_runs
    )
    models_unchanged = all(bool(record["state_unchanged"]) for record in models.values())
    status = "complete" if (
        reproduction_passed
        and not failures
        and comparison_evaluations == 320
        and training_outputs_unchanged is True
        and models_unchanged
        and historical_before == historical_after
    ) else (
        "reproduction_mismatch" if not reproduction_passed else "partial_diagnostic"
    )
    report = {
        "schema": "vevo.v03.neural-delayed-final-input-clipping-report.v1",
        "status": status,
        "source_sha": source_sha,
        "command": " ".join(sys.argv),
        "report_path": str(output),
        "summary_path": str(summary),
        "prior_factorial_report": PRIOR_FACTORIAL_REPORT_PATH,
        "hypotheses": {
            "spectrum_gate1": "saved training normalization has 0.001 scale for all four row-1/gate-1 response coordinates because both training worlds place that resonance at 0.95",
            "intervention": "clip only the 16 normalized channel-response coordinates to [-3,+3] at the final neural update",
            "status": "one bounded frozen-weight comparison; no threshold sweep",
        },
        "factorial_design": {
            "cells": [
                {
                    "name": cell["name"],
                    "world_set": cell["world_set"],
                    "world_seeds": list(cell["world_seeds"]),
                    "note_variant": cell["variant"],
                    "episode_count_per_checkpoint": len(cells[cell["name"]]),
                }
                for cell in CELL_DEFINITIONS
            ],
            "checkpoint_count": len(models),
            "comparison_conditions": list(COMPARISON_CONDITIONS),
            "expected_total_evaluations": 320,
            "actual_total_evaluations": comparison_evaluations,
            "changed_factor_only": "evaluation condition at the final neural update; baseline and clip share world, goal, note, raw measurement, physics, schedule, checkpoint, normalization, and weights",
            "intervention_count": 1,
            "intervention_name": "final_normalized_channel_response_clip",
            "intervention_coordinate_count": len(CHANNEL_RESPONSE_FEATURE_INDICES),
            "intervention_feature_indices": list(CHANNEL_RESPONSE_FEATURE_INDICES),
            "intervention_bound": float(CLIP_BOUND),
            "development_data_warning": "training worlds 9200–9201 and already-inspected development worlds 9300–9307 are not fresh test evidence",
        },
        "frozen_checkpoints": {
            key: {
                item: value
                for item, value in record.items()
                if item not in {"model", "normalization"}
            }
            for key, record in models.items()
        },
        "normalization_audit": normalization_audit,
        "physical_preparation_cache": cache_stats,
        "reproduction": {
            "required_before_comparison": True,
            "passed": reproduction_passed,
            "cells": reproduction,
        },
        "cells": cell_results,
        "comparison": {
            "name": "final_normalized_response_clip",
            "baseline": "saved normalized final input",
            "intervention": "clip only 16 normalized channel-response coordinates to [-3,+3]",
            "paired_results": paired_results,
            "training_outputs_unchanged": training_outputs_unchanged,
        },
        "reference_checks": {
            "reference_definition": "unique authoritative gate resonance matching the note target frequency, independent of measured response and policy inputs",
            "oracle_action_used_by_diagnostic": False,
            "reference_checks_run": reference_checks_run,
            "spectrum_argmax_matches_authoritative": reference_matches,
            "all_runs_use_independent_reference": all(
                "authoritative_resonance_gate" in run and "physical_reference_gate" in run
                for run in all_runs
            ),
            "all_reference_gates_are_unique_and_target_matched": all(
                np.isclose(
                    run["authoritative_resonance_hz"],
                    run["target_frequency_hz"],
                    rtol=0.0,
                    atol=SUCCESS_TOLERANCE_HZ,
                )
                for run in all_runs
            ),
        },
        "prior_factorial": {
            "path": PRIOR_FACTORIAL_REPORT_PATH,
            "sha256": _sha256_file(project_root / PRIOR_FACTORIAL_REPORT_PATH),
            "schema": prior_factorial_report.get("schema"),
            "status": prior_factorial_report.get("status"),
            "aggregates": _compact_prior_aggregates(prior_factorial_report),
            "paired_format_effects": prior_factorial_report.get("paired_format_effects", {}),
        },
        "limitations": [
            "This applies only to the previously inspected training and development worlds; it is not fresh generalization evidence.",
            "Clipping is lossy and is not a proven production fix.",
            "Preactivation saturation is descriptive instrumentation, not proof of optimization causality.",
            "The physical evaluator remains authoritative; model gate/frequency accuracy is not a consciousness or general-agent claim.",
            "No optimizer, new training, GPU, dependency, production, merge, deployment, or PR action was used.",
        ],
        "historical_artifacts": {
            "paths": historical_paths,
            "before": historical_before,
            "after": historical_after,
            "unchanged_byte_for_byte": historical_before == historical_after,
        },
        "runtime": {
            **budget.runtime(),
            "failures": failures,
            "baseline_replay_stop_on_mismatch": True,
        },
    }
    _atomic_write_json(output, report)
    _atomic_write_text(summary, _summary_markdown(report))
    return report


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=REPORT_PATH)
    parser.add_argument("--cpu-time-cap", type=float, default=CPU_TIME_CAP_SECONDS)
    args = parser.parse_args()
    report = run_diagnostic(output_path=args.output, cpu_time_cap=args.cpu_time_cap)
    print(json.dumps({
        "schema": report["schema"],
        "status": report["status"],
        "source_sha": report["source_sha"],
        "reproduction_passed": report["reproduction"]["passed"],
        "actual_total_evaluations": report["factorial_design"]["actual_total_evaluations"],
        "runtime": report["runtime"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
