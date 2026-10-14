"""Bounded frozen-checkpoint diagnosis of delayed-memory generalization.

This module performs no optimization.  It loads the four published delayed
memory checkpoints, reproduces the two already-published cells first, and
then evaluates the declared 2x2 world/format factorial.  The optional forward
trace instrumentation lives in ``v03_model`` and is default-off for all
ordinary model use.
"""

from __future__ import annotations

from collections import Counter
import copy
import hashlib
import json
import platform
from pathlib import Path
import resource
import subprocess
import sys
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
from .v03_protocol import CorrectedEpisode, PROBE_FREQUENCIES


REPORT_PATH = "reports/generated/v03-neural-delayed-factorial-diagnostic-report.json"
PUBLISHED_REPORT_PATH = "reports/generated/v03-neural-delayed-memory-report.json"
CPU_TIME_CAP_SECONDS = 300.0
ADDITIONAL_MEMORY_CAP_KB = 512 * 1024
NOTE_SUFFIX_RELATIVE_COLUMNS = (85, 86)

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
        "name": "training_worlds_heldout_format",
        "world_set": "training_worlds",
        "world_seeds": (9200, 9201),
        "variant": "delayed-heldout",
    },
    {
        "name": "new_worlds_original_format",
        "world_set": "new_worlds",
        "world_seeds": (9300, 9301, 9302, 9303, 9304, 9305, 9306, 9307),
        "variant": "delayed-train",
    },
    {
        "name": "new_worlds_heldout_format",
        "world_set": "new_worlds",
        "world_seeds": (9300, 9301, 9302, 9303, 9304, 9305, 9306, 9307),
        "variant": "delayed-heldout",
    },
)

REPRODUCTION_CELLS = {
    "training_worlds_original_format": "retention_training_worlds",
    "new_worlds_heldout_format": "heldout_new_worlds",
}


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


def _published_spec(world_set: str, world_seed: int, goal_index: int, variant: str) -> dict:
    split = variant
    return {
        "split": split,
        "world_set": world_set,
        "world_seed": int(world_seed),
        "goal_index": int(goal_index),
        "note_goal_id": f"{split}-goal-{goal_index}",
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


def _published_cell_specs(cell_name: str) -> list[dict]:
    cell = next(item for item in CELL_DEFINITIONS if item["name"] == cell_name)
    return [
        _published_spec(cell["world_set"], world_seed, goal_index, cell["variant"])
        for world_seed in cell["world_seeds"]
        for goal_index in range(len(PROBE_FREQUENCIES))
    ]


def make_factorial_cells() -> dict[str, list[dict]]:
    return {cell["name"]: _cell_specs(cell) for cell in CELL_DEFINITIONS}


def _cache_key(spec: dict) -> tuple[int, int, str]:
    return int(spec["world_seed"]), int(spec["goal_index"]), str(spec["note_variant"])


def _identity(spec: dict) -> tuple[int, int, str]:
    return int(spec["world_seed"]), int(spec["goal_index"]), str(spec["note_goal_id"])


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
        oracle_gate = int(restored.oracle_action())
        cache[key] = {
            "episode_snapshot": snapshot,
            "policy_observations": observations,
            "schedule_audit": schedule_audit,
            "raw_response": matrix.tolist(),
            "probe_frequencies": frequencies.tolist(),
            "target_column": target_column,
            "spectrum_argmax_gate": spectrum_argmax_gate,
            "oracle_gate": oracle_gate,
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


def _instrumented_episode(model_record: dict, spec: dict, prepared: dict, budget: DiagnosticBudget) -> dict:
    model = model_record["model"]
    budget.begin_evaluation(f"{model_record['key']}:{spec['world_seed']}:{spec['goal_index']}:{spec['note_variant']}")
    episode = CorrectedEpisode.restore(json.loads(json.dumps(prepared["episode_snapshot"], sort_keys=True)))
    runtime = model.initial_runtime()
    stages = []
    rows = []
    for index, observation in enumerate(prepared["policy_observations"]):
        runtime, trace = model.raw_step(runtime, observation, collect_diagnostics=True)
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
    final_vector = encode_policy_observation(prepared["policy_observations"][-1])
    normalized_vector = normalize_policy_vector(final_vector, model.normalization_state())
    raw_response = raw_matrix.reshape(-1)
    normalized_response = normalized_vector[SPECTRUM_FEATURE_START + 4:SPECTRUM_FEATURE_END]
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
    return {
        "model_key": model_record["key"],
        "model_class": model_record["model_class"],
        "model_seed": model_record["seed"],
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
        "physical_reference_gate": int(prepared["oracle_gate"]),
        "spectrum_argmax_gate": int(prepared["spectrum_argmax_gate"]),
        "target_column": int(prepared["target_column"]),
        "target_frequency_index": int(spec["goal_index"]),
        "gate_probabilities": np.asarray(trace["gate_probs"], dtype=np.float64).tolist(),
        "frequency_probabilities": np.asarray(trace["frequency_probs"], dtype=np.float64).tolist(),
        "rows": rows,
        "schedule_audit": prepared["schedule_audit"],
        "stages": stages,
        "raw_response": raw_response.tolist(),
        "normalized_response": normalized_response.tolist(),
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


def _cell_summary(cell: dict, model_record: dict, runs: list[dict]) -> dict:
    oracle_gates = np.asarray([run["physical_reference_gate"] for run in runs], dtype=np.int64)
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
        "n": len(runs),
        "gate_accuracy_vs_physical_reference": float(np.mean(model_gates == oracle_gates)),
        "frequency_accuracy": float(np.mean(model_frequencies == target_frequencies)),
        "joint_accuracy": float(np.mean((model_gates == oracle_gates) & (model_frequencies == target_frequencies))),
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
    for lrun, rrun in zip(left, right):
        lidentity = (int(lrun["world_seed"]), int(lrun["goal_index"]))
        ridentity = (int(rrun["world_seed"]), int(rrun["goal_index"]))
        if lidentity != ridentity:
            raise ValueError(f"factorial pair identity mismatch: {lidentity} != {ridentity}")
        if lrun["note_variant"] != left_variant or rrun["note_variant"] != right_variant:
            raise ValueError("factorial pair format labels do not match")
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
        "authoritative_note_digest": run["authoritative_note_digest"],
    }


def _expected_published_runs(report: dict, model_key: str, source_cell: str) -> list[dict]:
    if source_cell == "retention_training_worlds":
        return report["retention"]["models"][model_key]["ordinary"]["runs"]
    if source_cell == "heldout_new_worlds":
        return report["heldout"]["runs"][model_key]["runs"]
    raise ValueError(f"unknown published source cell: {source_cell}")


def _reproduce_cell(
    model_record: dict,
    cell_name: str,
    specs: list[dict],
    cache: dict,
    published_report: dict,
    budget: DiagnosticBudget,
) -> dict:
    actual_runs = [
        _instrumented_episode(model_record, spec, cache[_cache_key(spec)], budget)
        for spec in specs
    ]
    expected_runs = _expected_published_runs(published_report, model_record["key"], REPRODUCTION_CELLS[cell_name])
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
        "source_report_cell": REPRODUCTION_CELLS[cell_name],
        "n": len(actual_runs),
        "passed": not mismatches and len(actual_runs) == len(expected_runs),
        "mismatches": mismatches,
        "runs": actual_runs,
    }


def _historical_files(project_root: Path, output_relative: str) -> list[str]:
    paths = []
    for pattern in ("reports/generated/*.json", "storage/checkpoints/*.json"):
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


def run_diagnostic(*, output_path: str | Path = REPORT_PATH, cpu_time_cap: float = CPU_TIME_CAP_SECONDS) -> dict:
    start_wall = time.perf_counter()
    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"refusing to overwrite diagnostic report: {output}")
    project_root = _project_root()
    source_sha = _source_sha()
    baseline_rss_kb = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    budget = DiagnosticBudget(cpu_cap_seconds=cpu_time_cap, baseline_rss_kb=baseline_rss_kb)
    historical_paths = _historical_files(project_root, str(output.relative_to(project_root)) if output.is_absolute() else str(output))
    historical_before = _historical_digests(project_root, historical_paths)
    published_report = json.loads((project_root / PUBLISHED_REPORT_PATH).read_text(encoding="utf-8"))
    models = _load_frozen_models(project_root)
    normalization_audit = _normalization_audit(models)
    cells = make_factorial_cells()
    all_specs = [spec for specs in cells.values() for spec in specs]
    cache = {}
    _prepare_cache(all_specs, cache, budget)
    cache_stats = {
        "unique_physical_preparations": len(cache),
        "model_evaluation_uses_expected": len(cache) * len(models),
        "reuse_factor": len(models),
        "identical_preparations_reused_across_checkpoints": True,
    }
    reproduction = {}
    cell_results = {}
    failures = []
    reproduction_passed = True
    try:
        for cell_name in REPRODUCTION_CELLS:
            pub_specs = _published_cell_specs(cell_name)
            for model_key, model_record in models.items():
                result = _reproduce_cell(model_record, cell_name, pub_specs, cache, published_report, budget)
                reproduction[f"{model_key}:{cell_name}"] = {
                    key: value for key, value in result.items() if key != "runs"
                }
                cell_results.setdefault(cell_name, {})[model_key] = _cell_summary(
                    next(item for item in CELL_DEFINITIONS if item["name"] == cell_name),
                    model_record,
                    result["runs"],
                )
                cell_results[cell_name][model_key]["reproduction_source"] = "published_report"
                if not result["passed"]:
                    reproduction_passed = False
        if not reproduction_passed:
            failures.append("published reproduction mismatch; factorial expansion stopped")
        else:
            for cell in CELL_DEFINITIONS:
                if cell["name"] in REPRODUCTION_CELLS:
                    continue
                for model_key, model_record in models.items():
                    runs = [
                        _instrumented_episode(model_record, spec, cache[_cache_key(spec)], budget)
                        for spec in cells[cell["name"]]
                    ]
                    cell_results.setdefault(cell["name"], {})[model_key] = _cell_summary(cell, model_record, runs)
                    cell_results[cell["name"]][model_key]["reproduction_source"] = "new_factorial_evaluation"
    except DiagnosticBudgetExceeded as exc:
        failures.append(str(exc))
    except Exception as exc:
        failures.append(f"diagnostic_exception: {type(exc).__name__}: {exc}")

    paired_formats = {}
    if reproduction_passed and not failures:
        for model_key in models:
            paired_formats[f"{model_key}:training_worlds"] = _factor_pair_summary(
                cell_results["training_worlds_original_format"][model_key]["runs"],
                cell_results["training_worlds_heldout_format"][model_key]["runs"],
                left_variant="delayed-train",
                right_variant="delayed-heldout",
            )
            paired_formats[f"{model_key}:new_worlds"] = _factor_pair_summary(
                cell_results["new_worlds_original_format"][model_key]["runs"],
                cell_results["new_worlds_heldout_format"][model_key]["runs"],
                left_variant="delayed-train",
                right_variant="delayed-heldout",
            )

    for model_record in models.values():
        model_record["state_digest_after"] = _json_digest(model_record["model"].state_dict())
        model_record["state_unchanged"] = model_record["state_digest_before"] == model_record["state_digest_after"]
        if not model_record["state_unchanged"]:
            failures.append(f"frozen checkpoint state changed for {model_record['key']}")

    historical_after = _historical_digests(project_root, historical_paths)
    factorial_evaluations = sum(
        len(model_results.get("runs", []))
        for cell in cell_results.values()
        for model_results in cell.values()
    )
    status = "complete" if reproduction_passed and not failures and factorial_evaluations == 320 else (
        "reproduction_mismatch" if not reproduction_passed else "partial_diagnostic"
    )
    report = {
        "schema": "vevo.v03.neural-delayed-factorial-diagnostic-report.v1",
        "status": status,
        "source_sha": source_sha,
        "command": " ".join(sys.argv),
        "published_report": PUBLISHED_REPORT_PATH,
        "hypotheses": {
            "note_suffix": "heldout suffix activates relative note-text byte columns 85/86 that were zero in delayed-train normalization rows",
            "spectrum_gate1": "training spectrum normalization has 0.001 scale for all four row-1/gate-1 response coordinates because both training worlds place that resonance at 0.95",
            "status": "hazards tested independently; neither is treated as causal before this diagnostic",
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
            "expected_total_evaluations": 320,
            "actual_total_evaluations": factorial_evaluations,
            "changed_factor_only": "note variant suffix; world seed, goal, resonance, schedule, checkpoint, and normalization are otherwise fixed",
            "development_data_warning": "all prior training/held-out worlds in this diagnostic were previously inspected and are not fresh test evidence",
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
            "required_before_expansion": True,
            "passed": reproduction_passed,
            "cells": reproduction,
        },
        "cells": cell_results,
        "paired_format_effects": paired_formats,
        "limitations": [
            "This diagnoses previously inspected worlds; it is not fresh generalization evidence.",
            "The factorial changes only note-format suffix, so it cannot isolate other distribution shifts.",
            "Preactivation saturation is descriptive instrumentation, not proof of optimization causality.",
            "The physical evaluator remains authoritative; model gate/frequency accuracy is not a consciousness or general-agent claim.",
            "No optimization, training, architectural change, GPU, dependency, production, merge, deployment, or PR action was used.",
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
            "reproduction_stop_on_mismatch": True,
        },
    }
    _atomic_write_json(output, report)
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
