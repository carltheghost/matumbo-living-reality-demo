"""Frozen diagnostics for the shared response-row gate-head review.

This module never trains, sweeps, or edits the saved candidate checkpoints.  It
replays the four saved shared-response-scale candidates on the predeclared
training microset and inspected development cases, then applies a final-step
response-row permutation counterfactual.  The counterfactual is deliberately
limited to the final response hook: it does not establish whole-trajectory
slot causality or a generalization result.
"""

from __future__ import annotations

from copy import deepcopy
from itertools import combinations
import hashlib
import json
from pathlib import Path

import numpy as np

from .v03_delayed_memory import (
    _atomic_write_json,
    _atomic_write_text,
    HISTORICAL_DELAYED_REPORT_PATH,
    PRECEDING_SHARED_SCALE_ARTIFACT_COMMIT,
    PRECEDING_SHARED_SCALE_ARTIFACT_DIGESTS,
    PRECEDING_SHARED_SCALE_REPORT_PATH,
    PRECEDING_SHARED_SCALE_REPORT_SOURCE_SHA,
    build_delayed_examples,
    make_development_specs,
    make_training_specs,
)
from .v03_model import (
    ACTION_DIM,
    LEGACY_GATE_HEAD,
    RESPONSE_FEATURE_END,
    RESPONSE_FEATURE_START,
    SHARED_ROW_GATE_HEAD,
    SHARED_ROW_FEATURE_DIM,
    V03FiveBrain,
    V03SingleRecurrentMemory,
    encode_policy_observation,
    normalize_policy_vector,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
INPUT_REPORT_PATH = PROJECT_ROOT / PRECEDING_SHARED_SCALE_REPORT_PATH
OUTPUT_REPORT_PATH = PROJECT_ROOT / "reports/generated/v03-neural-shared-row-diagnostic-report.json"
OUTPUT_SUMMARY_PATH = PROJECT_ROOT / "reports/generated/v03-neural-shared-row-diagnostic-report.md"
RESPONSE_ROW_PERMUTATION = (1, 2, 3, 0)
DIAGNOSTIC_CASE_LABEL = "9300–9307 inspected development cases; never fresh generalization"
CHECKPOINT_KEYS = (
    "full-seed-107",
    "full-seed-117",
    "control-seed-141",
    "control-seed-143",
)
MODEL_CLASSES = {
    "V03FiveBrain": V03FiveBrain,
    "V03SingleRecurrentMemory": V03SingleRecurrentMemory,
}


def _digest(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    ).hexdigest()


def _file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _case_id(world_seed: int, goal_index: int) -> str:
    return f"{int(world_seed)}:{int(goal_index)}"


def _case_key(example: dict) -> tuple[int, int]:
    spec = example["spec"]
    return int(spec["world_seed"]), int(spec["goal_index"])


def _sorted_cases(examples: list[dict]) -> list[dict]:
    return sorted(examples, key=_case_key)


def _json_float(value: float) -> float:
    return float(np.asarray(value, dtype=np.float64))


def _load_saved_model(report: dict, key: str):
    checkpoint_record = report["checkpoints"][key]
    checkpoint_path = PROJECT_ROOT / checkpoint_record["path"]
    payload = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    model_class = MODEL_CLASSES[payload["model_class"]]
    model = model_class(
        int(payload["seed"]),
        gate_head=payload.get("gate_head", LEGACY_GATE_HEAD),
    )
    model.load_state_dict(payload["state"])
    model.set_input_normalization(report["data"]["normalization"])
    return model, payload, checkpoint_path


def _prediction_table(model, examples: list[dict]) -> dict[tuple[int, int], dict]:
    table = {}
    for example in _sorted_cases(examples):
        prediction = model.predict(example["policy_observations"])
        table[_case_key(example)] = prediction
    return table


def _frequency_to_gate(table: dict[tuple[int, int], dict], examples: list[dict]) -> dict[str, list[int]]:
    grouped: dict[int, dict[int, int]] = {}
    for example in _sorted_cases(examples):
        world_seed, goal_index = _case_key(example)
        grouped.setdefault(world_seed, {})[goal_index] = int(table[(world_seed, goal_index)]["gate"])
    return {
        str(world_seed): [int(goals[index]) for index in sorted(goals)]
        for world_seed, goals in sorted(grouped.items())
    }


def _target_frequency_to_gate(examples: list[dict]) -> dict[str, list[int]]:
    grouped: dict[int, dict[int, int]] = {}
    for example in _sorted_cases(examples):
        world_seed, goal_index = _case_key(example)
        grouped.setdefault(world_seed, {})[goal_index] = int(example["target_gate"])
    return {
        str(world_seed): [int(goals[index]) for index in sorted(goals)]
        for world_seed, goals in sorted(grouped.items())
    }


def _confusion(table: dict[tuple[int, int], dict], examples: list[dict]) -> dict:
    overall = np.zeros((ACTION_DIM, ACTION_DIM), dtype=np.int64)
    by_goal = {
        str(goal): np.zeros((ACTION_DIM, ACTION_DIM), dtype=np.int64)
        for goal in range(ACTION_DIM)
    }
    for example in _sorted_cases(examples):
        key = _case_key(example)
        target = int(example["target_gate"])
        predicted = int(table[key]["gate"])
        overall[target, predicted] += 1
        by_goal[str(int(example["target_frequency"]))][target, predicted] += 1
    return {
        "labels": {"rows": "target_gate", "columns": "predicted_gate"},
        "overall": overall.tolist(),
        "by_goal": {goal: matrix.tolist() for goal, matrix in by_goal.items()},
    }


def _confidence_record(probabilities: list[float], target: int, selected: int) -> dict:
    values = np.asarray(probabilities, dtype=np.float64)
    order = np.argsort(-values, kind="stable")
    top = int(order[0])
    second = int(order[1])
    return {
        "top_index": top,
        "top_probability": _json_float(values[top]),
        "second_index": second,
        "second_probability": _json_float(values[second]),
        "margin": _json_float(values[top] - values[second]),
        "target_index": int(target),
        "target_probability": _json_float(values[int(target)]),
        "selected_index": int(selected),
        "selected_probability": _json_float(values[int(selected)]),
        "unique_top_within_1e-12": bool(np.count_nonzero(np.isclose(values, values[top], atol=1e-12, rtol=0.0)) == 1),
    }


def _aggregate_confidence(records: list[dict]) -> dict:
    if not records:
        return {"count": 0}
    result = {"count": len(records)}
    for name in ("top_probability", "margin", "target_probability", "selected_probability"):
        values = np.asarray([record[name] for record in records], dtype=np.float64)
        result[name] = {
            "mean": _json_float(np.mean(values)),
            "min": _json_float(np.min(values)),
            "max": _json_float(np.max(values)),
        }
    return result


def _confidence_by_scope(model, examples: list[dict], table: dict) -> dict:
    cases = []
    by_goal = {str(goal): [] for goal in range(ACTION_DIM)}
    for example in _sorted_cases(examples):
        world_seed, goal_index = _case_key(example)
        prediction = table[(world_seed, goal_index)]
        gate = _confidence_record(
            prediction["trace"]["gate_probs"].tolist(),
            int(example["target_gate"]),
            int(prediction["gate"]),
        )
        frequency = _confidence_record(
            prediction["trace"]["frequency_probs"].tolist(),
            int(example["target_frequency"]),
            int(prediction["frequency_index"]),
        )
        record = {
            "case_id": _case_id(world_seed, goal_index),
            "goal_index": int(goal_index),
            "gate": gate,
            "frequency": frequency,
        }
        cases.append(record)
        by_goal[str(goal_index)].append(record)
    return {
        "cases": cases,
        "aggregate": {
            "gate": _aggregate_confidence([record["gate"] for record in cases]),
            "frequency": _aggregate_confidence([record["frequency"] for record in cases]),
        },
        "by_goal": {
            goal: {
                "gate": _aggregate_confidence([record["gate"] for record in records]),
                "frequency": _aggregate_confidence([record["frequency"] for record in records]),
            }
            for goal, records in by_goal.items()
        },
    }


def _prediction_compatibility(model, report_runs: list[dict], table: dict) -> dict:
    exact_actions = 0
    exact_gate_probabilities = 0
    exact_frequency_probabilities = 0
    max_gate_diff = 0.0
    max_frequency_diff = 0.0
    for run in report_runs:
        key = (int(run["world_seed"]), int(run["goal_index"]))
        prediction = table[key]
        expected_action = run["predicted_action"]
        exact_actions += int(
            int(expected_action["gate"]) == int(prediction["gate"])
            and int(expected_action["frequency_index"]) == int(prediction["frequency_index"])
        )
        expected_gate = np.asarray(run["gate_probabilities"], dtype=np.float64)
        expected_frequency = np.asarray(run["frequency_probabilities"], dtype=np.float64)
        actual_gate = np.asarray(prediction["trace"]["gate_probs"], dtype=np.float64)
        actual_frequency = np.asarray(prediction["trace"]["frequency_probs"], dtype=np.float64)
        exact_gate_probabilities += int(np.array_equal(expected_gate, actual_gate))
        exact_frequency_probabilities += int(np.array_equal(expected_frequency, actual_frequency))
        max_gate_diff = max(max_gate_diff, _json_float(np.max(np.abs(expected_gate - actual_gate))))
        max_frequency_diff = max(max_frequency_diff, _json_float(np.max(np.abs(expected_frequency - actual_frequency))))
    return {
        "case_count": len(report_runs),
        "exact_action_matches": exact_actions,
        "exact_gate_probability_matches": exact_gate_probabilities,
        "exact_frequency_probability_matches": exact_frequency_probabilities,
        "max_abs_gate_probability_difference": max_gate_diff,
        "max_abs_frequency_probability_difference": max_frequency_diff,
        "passed": exact_actions == len(report_runs)
        and exact_gate_probabilities == len(report_runs)
        and exact_frequency_probabilities == len(report_runs),
    }


def _development_success_sets(report: dict) -> dict[str, set[str]]:
    for section_name in ("development", "heldout"):
        section = report.get(section_name)
        if not isinstance(section, dict) or not isinstance(section.get("runs"), dict):
            continue
        return {
            key: {
                _case_id(run["world_seed"], run["goal_index"])
                for run in trial.get("runs", [])
                if bool(run.get("success"))
            }
            for key, trial in section["runs"].items()
        }
    return {}


def _set_overlap(candidate: set[str], reference: set[str]) -> dict:
    intersection = candidate & reference
    union = candidate | reference
    return {
        "candidate_count": len(candidate),
        "reference_count": len(reference),
        "intersection": sorted(intersection),
        "intersection_count": len(intersection),
        "union_count": len(union),
        "jaccard": float(len(intersection) / len(union)) if union else 1.0,
    }


def _success_overlap(report: dict) -> dict:
    success_sets = {}
    report_sets = _development_success_sets(report)
    for key in CHECKPOINT_KEYS:
        success_sets[key] = set(report_sets.get(key, set()))
    pairwise = {}
    for left, right in combinations(CHECKPOINT_KEYS, 2):
        intersection = success_sets[left] & success_sets[right]
        union = success_sets[left] | success_sets[right]
        pairwise[f"{left}__{right}"] = {
            "intersection": sorted(intersection),
            "intersection_count": len(intersection),
            "union_count": len(union),
            "jaccard": float(len(intersection) / len(union)) if union else 1.0,
        }
    all_intersection = set.intersection(*(success_sets[key] for key in CHECKPOINT_KEYS))
    result = {
        "success_sets": {key: sorted(value) for key, value in success_sets.items()},
        "success_counts": {key: len(value) for key, value in success_sets.items()},
        "pairwise": pairwise,
        "all_four_intersection": sorted(all_intersection),
        "all_four_intersection_count": len(all_intersection),
        "primary_reference": {
            "name": "preceding_shared_response_scale",
            "path": PRECEDING_SHARED_SCALE_REPORT_PATH,
            "artifact_commit": PRECEDING_SHARED_SCALE_ARTIFACT_COMMIT,
            "report_source_sha": PRECEDING_SHARED_SCALE_REPORT_SOURCE_SHA,
            "self_reference": True,
            "comparison_note": "The saved shared-scale candidates are the immediately preceding legacy-head baseline; no trained shared-row candidate exists yet.",
        },
        "original_v1_comparison": {},
        "historical_overlap_from_saved_report": {
            key: report.get("development", {}).get("runs", {}).get(key, {}).get("historical_success_overlap")
            for key in CHECKPOINT_KEYS
        },
    }
    original_path = PROJECT_ROOT / HISTORICAL_DELAYED_REPORT_PATH
    if original_path.exists():
        try:
            original_report = json.loads(original_path.read_text(encoding="utf-8"))
            original_sets = _development_success_sets(original_report)
            result["original_v1_comparison"] = {
                "path": HISTORICAL_DELAYED_REPORT_PATH,
                "self_reference": False,
                "reference_report_source_sha": original_report.get("source_sha"),
                "by_model": {
                    key: _set_overlap(success_sets[key], set(original_sets.get(key, set())))
                    for key in CHECKPOINT_KEYS
                },
            }
        except (OSError, json.JSONDecodeError):
            result["original_v1_comparison"] = {
                "path": HISTORICAL_DELAYED_REPORT_PATH,
                "available": False,
            }
    return result


def _model_agreement(tables: dict[str, dict], examples: list[dict]) -> dict:
    records = []
    for example in _sorted_cases(examples):
        key = _case_key(example)
        gates = {name: int(table[key]["gate"]) for name, table in tables.items()}
        frequencies = {name: int(table[key]["frequency_index"]) for name, table in tables.items()}
        records.append({
            "case_id": _case_id(*key),
            "gate_by_model": gates,
            "frequency_by_model": frequencies,
            "all_gate_agree": len(set(gates.values())) == 1,
            "all_frequency_agree": len(set(frequencies.values())) == 1,
        })
    return {
        "case_count": len(records),
        "all_gate_agreement_count": sum(record["all_gate_agree"] for record in records),
        "all_frequency_agreement_count": sum(record["all_frequency_agree"] for record in records),
        "records": records,
    }


def _permuted_example(example: dict) -> dict:
    result = deepcopy(example)
    final = result["policy_observations"][-1]
    response = np.asarray(final["measurement"]["channel_response"], dtype=np.float64)
    final["measurement"]["channel_response"] = response[list(RESPONSE_ROW_PERMUTATION)].tolist()
    return result


def _permutation_case(model, example: dict) -> dict:
    observations = example["policy_observations"]
    permuted = _permuted_example(example)["policy_observations"]
    runtime = model.initial_runtime()
    for observation in observations[:-1]:
        runtime, _ = model.raw_step(runtime, observation)
    baseline_runtime, baseline_trace = model.raw_step(runtime, observations[-1])
    permuted_runtime, permuted_trace = model.raw_step(runtime, permuted[-1])
    base_gate = np.asarray(baseline_trace["gate_probs"], dtype=np.float64)
    new_gate = np.asarray(permuted_trace["gate_probs"], dtype=np.float64)
    base_frequency = np.asarray(baseline_trace["frequency_probs"], dtype=np.float64)
    new_frequency = np.asarray(permuted_trace["frequency_probs"], dtype=np.float64)
    expected_gate = base_gate[list(RESPONSE_ROW_PERMUTATION)]
    unique_top = np.count_nonzero(np.isclose(base_gate, np.max(base_gate), atol=1e-12, rtol=0.0)) == 1
    expected_selected = RESPONSE_ROW_PERMUTATION.index(int(np.argmax(base_gate))) if unique_top else None
    baseline_hidden = np.asarray(baseline_runtime.get("hidden", baseline_runtime.get("central")), dtype=np.float64)
    permuted_hidden = np.asarray(permuted_runtime.get("hidden", permuted_runtime.get("central")), dtype=np.float64)
    post_hidden_diff = _json_float(np.max(np.abs(permuted_hidden - baseline_hidden)))
    post_memory_diff = _json_float(
        np.max(np.abs(np.asarray(permuted_runtime["memory"]) - np.asarray(baseline_runtime["memory"])))
    )
    result = {
        "case_id": _case_id(*_case_key(example)),
        "gate_head": model.gate_head,
        "permutation": list(RESPONSE_ROW_PERMUTATION),
        "baseline_gate": int(np.argmax(base_gate)),
        "permuted_gate": int(np.argmax(new_gate)),
        "baseline_frequency_index": int(np.argmax(base_frequency)),
        "permuted_frequency_index": int(np.argmax(new_frequency)),
        "gate_probability_linf_vs_expected_permutation": _json_float(np.max(np.abs(new_gate - expected_gate))),
        "frequency_probability_linf_vs_baseline": _json_float(np.max(np.abs(new_frequency - base_frequency))),
        "baseline_gate_unique_top": bool(unique_top),
        "expected_permuted_gate_if_unique": expected_selected,
        "post_response_hidden_linf": post_hidden_diff,
        "post_response_memory_linf": post_memory_diff,
        "retained_context_linf": None,
        "row_feature_linf_vs_expected_permutation": None,
        "gate_permutation_check_applicable": model.gate_head == SHARED_ROW_GATE_HEAD,
        "frequency_invariance_check_applicable": model.gate_head == SHARED_ROW_GATE_HEAD,
        "selected_gate_permutation_status": (
            "not_applicable_legacy"
            if model.gate_head != SHARED_ROW_GATE_HEAD
            else ("not_applicable_tie" if expected_selected is None else "pending")
        ),
    }
    if model.gate_head == SHARED_ROW_GATE_HEAD:
        retained_base = np.asarray(baseline_trace["retained_goal_context"], dtype=np.float64)
        retained_new = np.asarray(permuted_trace["retained_goal_context"], dtype=np.float64)
        row_base = np.asarray(baseline_trace["row_features"], dtype=np.float64)
        row_new = np.asarray(permuted_trace["row_features"], dtype=np.float64)
        result["retained_context_linf"] = _json_float(np.max(np.abs(retained_new - retained_base)))
        result["row_feature_linf_vs_expected_permutation"] = _json_float(
            np.max(np.abs(row_new - row_base[list(RESPONSE_ROW_PERMUTATION)]))
        )
        result["gate_permutation_passed"] = bool(np.allclose(new_gate, expected_gate, atol=1e-12, rtol=0.0))
        result["frequency_invariance_passed"] = bool(np.allclose(new_frequency, base_frequency, atol=1e-12, rtol=0.0))
        result["retained_context_invariant_passed"] = bool(np.array_equal(retained_new, retained_base))
        result["row_feature_permutation_passed"] = bool(np.array_equal(row_new, row_base[list(RESPONSE_ROW_PERMUTATION)]))
        result["selected_gate_permutation_passed"] = None if expected_selected is None else (
            int(np.argmax(new_gate)) == expected_selected
        )
        if expected_selected is not None:
            result["selected_gate_permutation_status"] = (
                "passed" if result["selected_gate_permutation_passed"] else "failed"
            )
    return result


def _permutation_summary(model, examples: list[dict]) -> dict:
    cases = [_permutation_case(model, example) for example in _sorted_cases(examples)]
    shared = model.gate_head == SHARED_ROW_GATE_HEAD
    if shared:
        return {
            "scope": "final_response_hook_only",
            "case_count": len(cases),
            "cases": cases,
            "gate_permutation_pass_count": sum(case["gate_permutation_passed"] for case in cases),
            "frequency_invariance_pass_count": sum(case["frequency_invariance_passed"] for case in cases),
            "retained_context_invariant_pass_count": sum(case["retained_context_invariant_passed"] for case in cases),
            "row_feature_permutation_pass_count": sum(case["row_feature_permutation_passed"] for case in cases),
            "selected_gate_permutation_pass_count": sum(
                case["selected_gate_permutation_passed"] is True for case in cases
            ),
            "selected_gate_permutation_not_applicable_count": sum(
                case["selected_gate_permutation_status"] == "not_applicable_tie" for case in cases
            ),
            "max_gate_probability_linf": max(case["gate_probability_linf_vs_expected_permutation"] for case in cases),
            "max_frequency_probability_linf": max(case["frequency_probability_linf_vs_baseline"] for case in cases),
            "max_retained_context_linf": max(case["retained_context_linf"] for case in cases),
        }
    return {
        "scope": "legacy_final_action_head_counterfactual_reference",
        "case_count": len(cases),
        "cases": cases,
        "note": "The legacy per-gate action matrix is included as a frozen reference; its output is not expected to obey row permutation symmetry.",
    }


def _preprocessing_symmetry(examples: list[dict], normalization: dict) -> dict:
    checks = []
    for example in _sorted_cases(examples):
        original = example["policy_observations"][-1]
        permuted = _permuted_example(example)["policy_observations"][-1]
        raw_original = encode_policy_observation(original)
        raw_permuted = encode_policy_observation(permuted)
        normalized_original = normalize_policy_vector(raw_original, normalization)
        normalized_permuted = normalize_policy_vector(raw_permuted, normalization)
        expected_rows = normalized_original[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END].reshape(
            ACTION_DIM, SHARED_ROW_FEATURE_DIM
        )[list(RESPONSE_ROW_PERMUTATION)]
        non_response = np.concatenate((
            normalized_original[:RESPONSE_FEATURE_START],
            normalized_original[RESPONSE_FEATURE_END:],
        ))
        non_response_permuted = np.concatenate((
            normalized_permuted[:RESPONSE_FEATURE_START],
            normalized_permuted[RESPONSE_FEATURE_END:],
        ))
        checks.append({
            "case_id": _case_id(*_case_key(example)),
            "non_response_invariant": bool(np.array_equal(non_response, non_response_permuted)),
            "response_row_permutation": bool(np.array_equal(
                normalized_permuted[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END].reshape(
                    ACTION_DIM, SHARED_ROW_FEATURE_DIM
                ),
                expected_rows,
            )),
        })
    return {
        "normalization_schema": normalization.get("schema"),
        "shared_scale_method": normalization.get("response_scaling", {}).get("method"),
        "case_count": len(checks),
        "non_response_invariant_count": sum(check["non_response_invariant"] for check in checks),
        "response_row_permutation_count": sum(check["response_row_permutation"] for check in checks),
        "checks": checks,
    }


def _architecture_audit() -> dict:
    legacy_full = V03FiveBrain(107, gate_head=LEGACY_GATE_HEAD)
    shared_full = V03FiveBrain(107, gate_head=SHARED_ROW_GATE_HEAD)
    legacy_control = V03SingleRecurrentMemory(141, gate_head=LEGACY_GATE_HEAD)
    shared_control = V03SingleRecurrentMemory(141, gate_head=SHARED_ROW_GATE_HEAD)
    full_common = set(legacy_full.params) & set(shared_full.params)
    control_common = set(legacy_control.params) & set(shared_control.params)
    return {
        "shared_gate_head": {
            "full": shared_full.gate_head_audit(),
            "control": shared_control.gate_head_audit(),
        },
        "parameter_counts": {
            "full_legacy": legacy_full.parameter_count(),
            "full_shared": shared_full.parameter_count(),
            "full_delta": shared_full.parameter_count() - legacy_full.parameter_count(),
            "control_legacy": legacy_control.parameter_count(),
            "control_shared": shared_control.parameter_count(),
            "control_delta": shared_control.parameter_count() - legacy_control.parameter_count(),
        },
        "initialization_compatibility": {
            "full_common_parameters_exact_match": all(
                np.array_equal(legacy_full.params[name], shared_full.params[name])
                for name in full_common
            ),
            "control_common_parameters_exact_match": all(
                np.array_equal(legacy_control.params[name], shared_control.params[name])
                for name in control_common
            ),
            "frequency_head_raw_parameters_exact_match": bool(
                np.array_equal(legacy_full.params["c.W_action_frequency"], shared_full.params["c.W_action_frequency"])
                and np.array_equal(legacy_control.params["W_action_frequency"], shared_control.params["W_action_frequency"])
            ),
            "shared_head_stream": "independent architecture-specific stream",
            "main_stream_legacy_gate_draws_reserved": True,
        },
        "changed_parameter_names": {
            "full_removed": sorted(set(legacy_full.parameter_names()) - set(shared_full.parameter_names())),
            "full_added": sorted(set(shared_full.parameter_names()) - set(legacy_full.parameter_names())),
            "control_removed": sorted(set(legacy_control.params) - set(shared_control.params)),
            "control_added": sorted(set(shared_control.params) - set(legacy_control.params)),
        },
        "row_shared_parameter_shapes": {
            "full_W_shared_row_context": list(shared_full.params["c.W_shared_row_context"].shape),
            "full_w_shared_row": list(shared_full.params["c.w_shared_row"].shape),
            "full_b_shared_row": list(shared_full.params["c.b_shared_row"].shape),
            "control_W_shared_row_context": list(shared_control.params["W_shared_row_context"].shape),
            "control_w_shared_row": list(shared_control.params["w_shared_row"].shape),
            "control_b_shared_row": list(shared_control.params["b_shared_row"].shape),
        },
        "frequency_and_phase_scope": {
            "goal_conditioning": "bilinear interaction between each current response row and retained pre-final central-plus-memory context",
            "retained_frequency_information": "The retained context can carry frequency/goal information encoded during the note and delay; no evaluator gate or frequency label is supplied to inference.",
            "current_observation_to_shared_gate": "Only the current 4x4 response rows enter the shared gate scorer directly; the final post-response recurrent state is not used by the shared action heads.",
            "current_frequency_features": "No separate current frequency index is injected into the scorer. The shared frequency head also uses the retained pre-final context.",
            "bundled_action_head_context_redesign": True,
            "phase_or_time_signal_added": False,
            "phase_or_time_claim": "Magnitude-only response measurements are not converted into an invented phase or time signal.",
            "trajectory_scope": "final response hook only; this does not claim full-trajectory slot causality",
        },
    }


def _artifact_integrity(report: dict, checkpoint_paths: dict[str, Path]) -> dict:
    historical_expected = report["historical_artifacts"]["before"]
    historical_current = {}
    missing = []
    for relative_path in historical_expected:
        path = PROJECT_ROOT / relative_path
        if not path.exists():
            missing.append(relative_path)
        else:
            historical_current[relative_path] = _file_digest(path)
    checkpoint_digests = {
        key: _file_digest(path)
        for key, path in checkpoint_paths.items()
    }
    preceding_current = {
        relative_path: _file_digest(PROJECT_ROOT / relative_path)
        for relative_path in PRECEDING_SHARED_SCALE_ARTIFACT_DIGESTS
        if (PROJECT_ROOT / relative_path).exists()
    }
    return {
        "historical_expected_before": historical_expected,
        "historical_current_before": historical_current,
        "historical_missing": missing,
        "historical_matches_recorded_before": historical_current == historical_expected,
        "preceding_shared_scale_baseline": {
            "artifact_commit": PRECEDING_SHARED_SCALE_ARTIFACT_COMMIT,
            "report_source_sha": PRECEDING_SHARED_SCALE_REPORT_SOURCE_SHA,
            "expected_digests": PRECEDING_SHARED_SCALE_ARTIFACT_DIGESTS,
            "current_digests": preceding_current,
            "all_expected_files_present": set(preceding_current) == set(PRECEDING_SHARED_SCALE_ARTIFACT_DIGESTS),
            "matches_expected": preceding_current == PRECEDING_SHARED_SCALE_ARTIFACT_DIGESTS,
        },
        "input_checkpoint_digests_before": checkpoint_digests,
    }


def _markdown(report: dict) -> str:
    architecture = report["architecture"]
    training_maps = report["training_world_frequency_to_gate"]
    lines = [
        "# Frozen shared-row scorer diagnostic",
        "",
        f"Status: `{report['status']}`",
        f"Input report: `{report['input_report_path']}`",
        "",
        "This is a frozen source/evidence diagnostic. It does not train, sweep, select checkpoints, or claim fresh generalization.",
        "",
        "## Shortcut evidence",
        "",
        f"- Training-world target frequency→gate maps: `{json.dumps(training_maps['target'], sort_keys=True)}`.",
        f"- All four models agree with the target map on the training microset: `{json.dumps({key: value['matches_target'] for key, value in training_maps['models'].items()}, sort_keys=True)}`.",
        f"- All-four development success overlap: `{report['success_set_overlap']['all_four_intersection_count']}` cases.",
        f"- Primary historical baseline: `{report['success_set_overlap']['primary_reference']['path']}` at `{report['success_set_overlap']['primary_reference']['artifact_commit']}`; original v1 is retained as a secondary comparison.",
        "",
        "## Architecture and symmetry",
        "",
        f"- Full parameter count legacy/shared: `{architecture['parameter_counts']['full_legacy']}` / `{architecture['parameter_counts']['full_shared']}` (delta `{architecture['parameter_counts']['full_delta']}`).",
        f"- Control parameter count legacy/shared: `{architecture['parameter_counts']['control_legacy']}` / `{architecture['parameter_counts']['control_shared']}` (delta `{architecture['parameter_counts']['control_delta']}`).",
        f"- Preprocessing non-response invariance: `{report['preprocessing_symmetry']['non_response_invariant_count']}/{report['preprocessing_symmetry']['case_count']}`; response-row permutation: `{report['preprocessing_symmetry']['response_row_permutation_count']}/{report['preprocessing_symmetry']['case_count']}`.",
        f"- Common body/frequency initialization exact across legacy/shared variants: full `{architecture['initialization_compatibility']['full_common_parameters_exact_match']}`, control `{architecture['initialization_compatibility']['control_common_parameters_exact_match']}`; frequency raw parameters `{architecture['initialization_compatibility']['frequency_head_raw_parameters_exact_match']}`.",
        "- This is a bundled action-head/context redesign, not a pure single-factor ablation: the shared gate changes and the frequency head moves to pre-final retained context.",
        "- The shared head uses one bilinear scorer across rows. Its retained context is pre-final recurrent state plus memory read, so the final row permutation does not alter that context.",
        "- The diagnostic scope is the final response hook only; it is not a full-trajectory slot-causality claim.",
        "",
        "## Frozen row-permutation result",
        "",
    ]
    for key in CHECKPOINT_KEYS:
        item = report["models"][key]["row_permutation"]
        if item["scope"] == "final_response_hook_only":
            lines.append(
                f"- `{key}`: gate permutation `{item['gate_permutation_pass_count']}/{item['case_count']}`, frequency invariant `{item['frequency_invariance_pass_count']}/{item['case_count']}`, retained context invariant `{item['retained_context_invariant_pass_count']}/{item['case_count']}`, max gate L∞ `{item['max_gate_probability_linf']:.3g}`."
            )
        else:
            lines.append(f"- `{key}`: legacy reference; row symmetry not expected (`{item['scope']}`).")
    lines.extend([
        "",
        "Structural shared-head replay (freshly initialized, untrained; not a performance result):",
    ])
    for key, item in report["shared_head_structural_permutation"].items():
        permutation = item["row_permutation"]
        lines.append(
            f"- `{key}`: gate permutation `{permutation['gate_permutation_pass_count']}/{permutation['case_count']}`, frequency invariant `{permutation['frequency_invariance_pass_count']}/{permutation['case_count']}`, retained context invariant `{permutation['retained_context_invariant_pass_count']}/{permutation['case_count']}`."
        )
    lines.extend([
        "",
        "## Frequency, phase, and time scope",
        "",
        "- Frequency/goal information can be carried in retained state from the note and delay; no evaluator reference gate or frequency label is fed to inference.",
        "- No separate current frequency index, phase signal, or time signal is synthesized. Magnitude-only response measurements remain magnitude-only.",
        "",
        "Historical artifacts and input checkpoint bytes were checked before/after diagnostic execution; no existing artifact is rewritten.",
        "",
    ])
    return "\n".join(lines)


def run_diagnostic(
    *,
    input_report_path: str | Path = INPUT_REPORT_PATH,
    output_report_path: str | Path = OUTPUT_REPORT_PATH,
) -> dict:
    input_report_path = Path(input_report_path)
    output_report_path = Path(output_report_path)
    summary_path = output_report_path.with_suffix(".md")
    if output_report_path.exists() or summary_path.exists():
        raise FileExistsError("refusing to overwrite shared-row diagnostic artifacts")
    report = json.loads(input_report_path.read_text(encoding="utf-8"))
    if report.get("schema") != "vevo.v03.neural-delayed-memory-report.v2":
        raise ValueError("unexpected input report schema")
    if tuple(report["data"]["development_world_seeds_inspected"]) != tuple(range(9300, 9308)):
        raise ValueError("input report does not use the predeclared inspected development worlds")

    train_examples = build_delayed_examples(make_training_specs())
    development_examples = build_delayed_examples(make_development_specs())
    checkpoint_paths = {
        key: PROJECT_ROOT / report["checkpoints"][key]["path"]
        for key in CHECKPOINT_KEYS
    }
    integrity = _artifact_integrity(report, checkpoint_paths)
    models = {}
    tables = {"training": {}, "development": {}}
    model_reports = {}
    shared_head_structural = {}
    for key in CHECKPOINT_KEYS:
        model, payload, checkpoint_path = _load_saved_model(report, key)
        if model.parameter_count() != int(payload["parameter_count"]):
            raise ValueError(f"parameter count mismatch for {key}")
        if model.normalization_state() != report["data"]["normalization"]:
            raise ValueError(f"normalization mismatch for {key}")
        models[key] = model
        train_table = _prediction_table(model, train_examples)
        development_table = _prediction_table(model, development_examples)
        tables["training"][key] = train_table
        tables["development"][key] = development_table
        report_runs = report["development"]["runs"][key]["runs"]
        model_reports[key] = {
            "checkpoint_path": str(checkpoint_path.relative_to(PROJECT_ROOT)),
            "checkpoint_parameter_count": int(payload["parameter_count"]),
            "saved_checkpoint_gate_head": payload.get("gate_head", LEGACY_GATE_HEAD),
            "loaded_gate_head": model.gate_head,
            "training_world_frequency_to_gate": _frequency_to_gate(train_table, train_examples),
            "development_world_frequency_to_gate": _frequency_to_gate(development_table, development_examples),
            "training_per_goal_confusion": _confusion(train_table, train_examples),
            "development_per_goal_confusion": _confusion(development_table, development_examples),
            "training_confidence_margins": _confidence_by_scope(model, train_examples, train_table),
            "development_confidence_margins": _confidence_by_scope(model, development_examples, development_table),
            "development_prediction_compatibility": _prediction_compatibility(model, report_runs, development_table),
            "row_permutation": _permutation_summary(model, development_examples),
        }
        shared_model = MODEL_CLASSES[payload["model_class"]](
            int(payload["seed"]),
            gate_head=SHARED_ROW_GATE_HEAD,
        )
        shared_model.set_input_normalization(report["data"]["normalization"])
        shared_head_structural[key] = {
            "status": "untrained_structural_replay_only",
            "gate_head_audit": shared_model.gate_head_audit(),
            "parameter_count": int(shared_model.parameter_count()),
            "row_permutation": _permutation_summary(shared_model, development_examples),
        }

    target_training_map = _target_frequency_to_gate(train_examples)
    training_models = {}
    for key in CHECKPOINT_KEYS:
        predicted = model_reports[key]["training_world_frequency_to_gate"]
        training_models[key] = {
            "predicted": predicted,
            "matches_target": predicted == target_training_map,
        }

    historical_after = {
        relative_path: _file_digest(PROJECT_ROOT / relative_path)
        for relative_path in integrity["historical_expected_before"]
        if (PROJECT_ROOT / relative_path).exists()
    }
    checkpoint_after = {key: _file_digest(path) for key, path in checkpoint_paths.items()}
    integrity["historical_current_after"] = historical_after
    integrity["historical_unchanged"] = integrity["historical_current_before"] == historical_after
    integrity["input_checkpoint_digests_after"] = checkpoint_after
    integrity["input_checkpoints_unchanged"] = integrity["input_checkpoint_digests_before"] == checkpoint_after
    preceding_after = {
        relative_path: _file_digest(PROJECT_ROOT / relative_path)
        for relative_path in PRECEDING_SHARED_SCALE_ARTIFACT_DIGESTS
        if (PROJECT_ROOT / relative_path).exists()
    }
    integrity["preceding_shared_scale_baseline"]["current_digests_after"] = preceding_after
    integrity["preceding_shared_scale_baseline"]["unchanged"] = (
        integrity["preceding_shared_scale_baseline"]["current_digests"] == preceding_after
    )

    result = {
        "schema": "vevo.v03.neural-shared-row-diagnostic-report.v1",
        "status": "complete",
        "input_report_path": str(input_report_path),
        "input_report_source_sha": report.get("source_sha"),
        "classification": DIAGNOSTIC_CASE_LABEL,
        "fresh_generalization_claim": False,
        "training_worlds": list(report["data"]["training_world_seeds"]),
        "development_worlds_inspected": list(report["data"]["development_world_seeds_inspected"]),
        "architecture": _architecture_audit(),
        "training_world_frequency_to_gate": {
            "target": target_training_map,
            "models": training_models,
        },
        "models": model_reports,
        "shared_head_structural_permutation": shared_head_structural,
        "model_agreement": {
            "training": _model_agreement(tables["training"], train_examples),
            "development": _model_agreement(tables["development"], development_examples),
        },
        "success_set_overlap": _success_overlap(report),
        "preprocessing_symmetry": _preprocessing_symmetry(development_examples, report["data"]["normalization"]),
        "artifact_integrity": integrity,
        "limitations": [
            "Frozen replay only; no training, sweep, tuning, checkpoint selection, or fresh evaluation was run.",
            "The row permutation counterfactual changes only the final measurement response rows and tests the final response hook.",
            "The permutation result does not establish whole-trajectory slot causality or a generalization result.",
            "No phase/time mechanism is added; magnitude-only observations do not support an invented phase signal.",
        ],
    }
    _atomic_write_json(output_report_path, result)
    _atomic_write_text(summary_path, _markdown(result))
    return result


def main() -> None:
    result = run_diagnostic()
    print(json.dumps({
        "schema": result["schema"],
        "status": result["status"],
        "output_report_path": str(OUTPUT_REPORT_PATH),
        "historical_unchanged": result["artifact_integrity"]["historical_unchanged"],
        "input_checkpoints_unchanged": result["artifact_integrity"]["input_checkpoints_unchanged"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
