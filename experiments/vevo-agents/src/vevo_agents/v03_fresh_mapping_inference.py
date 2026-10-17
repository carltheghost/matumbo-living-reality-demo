"""Run the frozen fresh mapping-transfer inference after independent review.

The runner consumes only the sealed preregistration and its eight frozen
checkpoints.  It never trains, fits normalization, selects cases from model
outcomes, writes checkpoints, or silently substitutes a case.  This module is
implemented for the later authorized run; importing it performs no inference.
"""

from __future__ import annotations

from collections import defaultdict
import copy
import hashlib
import itertools
import json
import math
from pathlib import Path
import platform
import resource
import subprocess
import tempfile
import time

import numpy as np

from .v03_delayed_memory import (
    _load_delayed_checkpoint,
    _prepare_delayed_episode,
    run_delayed_episode,
)
from .v03_fresh_mapping_preregistration import (
    FRESH_EVALUATION_REPORT_PATH,
    FRESH_EVALUATION_SUMMARY_PATH,
    FROZEN_INFERENCE_CHECKPOINTS,
    OUTPUT_PATH as PREREGISTRATION_PATH,
    PARTITION_DISJOINT_COUNTERFACTUAL,
    PARTITION_DISJOINT_PRIOR,
    PARTITION_DISJOINT_NEVER,
    PARTITION_SEEN_TRAINING,
    SCREENING_SOURCE_SHA,
    frequency_to_gate_mapping,
)
from .v03_model import (
    LEGACY_GATE_HEAD,
    SHARED_ROW_GATE_HEAD,
    V03FiveBrain,
    V03SingleRecurrentMemory,
)
from .v03_neural_proof import _goal_note
from .v03_protocol import PROBE_FREQUENCIES


DESIGN_PATH = str(PREREGISTRATION_PATH)
EXPECTED_PREREGISTRATION_SOURCE_SHA = "41bb6c1f10c993680cecd218eb6c74a0bf39947b"
EXPECTED_DESIGN_FILE_SHA256 = "497acbd812a5e30f6cfc25adef00bfcb4b8b83b2117c61174efac62e8fbb4a20"
EXPECTED_CASE_MANIFEST_SHA256 = "1ef809905ca01b7c4da6f30939bdf290e9c2c9538ca5297389f9fca6d1f96f63"
EXPECTED_WORLD_MANIFEST_SHA256 = "b0299c47bc109b4ad2bfdb9c527d4233ca532a362b3f9bf5cebee2d5a9fbb73f"
EXPECTED_CHECKPOINT_MANIFEST_SHA256 = "576509668f556238ae11bb405cc5788fe6c5e54e4226ef01a4d81d20a2ee1bb0"

PAIR_EVALUATION_ORDER = (
    "full-seed-107",
    "legacy-full-seed-107",
    "full-seed-117",
    "legacy-full-seed-117",
    "control-seed-141",
    "legacy-control-seed-141",
    "control-seed-143",
    "legacy-control-seed-143",
)
CANDIDATE_KEYS = frozenset({
    "full-seed-107",
    "full-seed-117",
    "control-seed-141",
    "control-seed-143",
})
LEGACY_KEYS = frozenset({
    "legacy-full-seed-107",
    "legacy-full-seed-117",
    "legacy-control-seed-141",
    "legacy-control-seed-143",
})
PAIR_KEYS = {
    "full-seed-107": "legacy-full-seed-107",
    "full-seed-117": "legacy-full-seed-117",
    "control-seed-141": "legacy-control-seed-141",
    "control-seed-143": "legacy-control-seed-143",
}
MODEL_CLASSES = {
    "V03FiveBrain": V03FiveBrain,
    "V03SingleRecurrentMemory": V03SingleRecurrentMemory,
}
ROW_TIE_TOLERANCE = 1e-12
ROW_PROBABILITY_ATOL = 1e-12
ROW_PROBABILITY_RTOL = 0.0
ADDITIONAL_MEMORY_CAP_KB = 512 * 1024


class FrozenInferenceError(RuntimeError):
    """The sealed design or frozen inputs cannot be used safely."""


class InferenceDeadlineExceeded(TimeoutError):
    """The cooperative wall-clock or memory cap stopped inference."""

    def __init__(self, phase: str, *, case_index: int | None = None, completed_cases: int = 0):
        self.phase = str(phase)
        self.case_index = None if case_index is None else int(case_index)
        self.completed_cases = int(completed_cases)
        suffix = "" if self.case_index is None else f" before case {self.case_index}"
        super().__init__(f"inference budget exhausted in {self.phase}{suffix}")


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    try:
        return _sha256_bytes(path.read_bytes())
    except OSError as exc:
        raise FrozenInferenceError(f"cannot read frozen artifact {path}: {exc}") from exc


def _canonical_digest(value) -> str:
    return _sha256_bytes(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    )


def _source_sha() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=_project_root().parents[1],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _rss_kb() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)


def _budget_check(
    *,
    deadline: float,
    baseline_rss_kb: int,
    additional_memory_cap_kb: int,
    phase: str,
    case_index: int | None = None,
    completed_cases: int = 0,
) -> None:
    if time.perf_counter() >= deadline:
        raise InferenceDeadlineExceeded(phase, case_index=case_index, completed_cases=completed_cases)
    additional_kb = max(0, _rss_kb() - int(baseline_rss_kb))
    if additional_kb > int(additional_memory_cap_kb):
        raise InferenceDeadlineExceeded(phase, case_index=case_index, completed_cases=completed_cases)


def _load_design(project_root: Path) -> tuple[dict, str]:
    path = project_root / DESIGN_PATH
    if _sha256_file(path) != EXPECTED_DESIGN_FILE_SHA256:
        raise FrozenInferenceError("sealed preregistration file digest does not match")
    try:
        design = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FrozenInferenceError(f"cannot parse sealed preregistration: {exc}") from exc
    if design.get("schema") != "vevo.v03.neural-fresh-mapping-transfer-preregistration.v1":
        raise FrozenInferenceError("sealed preregistration schema mismatch")
    if design.get("status") != "awaiting_independent_review_before_fresh_evaluation":
        raise FrozenInferenceError("fresh evaluation is not review-gated in the sealed record")
    if design.get("source_sha_at_registration") != EXPECTED_PREREGISTRATION_SOURCE_SHA:
        raise FrozenInferenceError("sealed preregistration source SHA mismatch")
    if design.get("evaluation_started") or design.get("fresh_cases_evaluated") != 0:
        raise FrozenInferenceError("sealed preregistration already records fresh evaluation")
    return design, _sha256_file(path)


def _validate_case_manifest(design: dict) -> dict:
    case_plan = design.get("case_plan")
    if not isinstance(case_plan, dict):
        raise FrozenInferenceError("case plan is missing")
    cases = case_plan.get("cases")
    if not isinstance(cases, list) or len(cases) != int(case_plan.get("case_count", -1)):
        raise FrozenInferenceError("case plan count is invalid")
    if _canonical_digest(cases) != EXPECTED_CASE_MANIFEST_SHA256:
        raise FrozenInferenceError("case manifest digest does not match the sealed record")
    worlds = design["fresh_world_selection"].get("worlds")
    if _canonical_digest(worlds) != EXPECTED_WORLD_MANIFEST_SHA256:
        raise FrozenInferenceError("world manifest digest does not match the sealed record")
    if len(cases) != 16 or int(case_plan.get("world_count")) != 4:
        raise FrozenInferenceError("fresh case manifest is not the sealed 16-case plan")
    if [int(case["case_index"]) for case in cases] != list(range(len(cases))):
        raise FrozenInferenceError("case indices are not contiguous")
    world_order = []
    for case in cases:
        world_seed = int(case["world_seed"])
        if not world_order or world_order[-1] != world_seed:
            world_order.append(world_seed)
        if int(case["goal_index"]) not in range(4):
            raise FrozenInferenceError("case goal index is outside the fixed four-goal protocol")
        mapping = tuple(int(value) for value in case["frequency_to_gate"])
        if frequency_to_gate_mapping(world_seed) != mapping:
            raise FrozenInferenceError("case mapping does not match simulator metadata")
        if int(case["metadata_reference_gate"]) != mapping[int(case["goal_index"])]:
            raise FrozenInferenceError("case metadata reference gate is inconsistent")
        expected_note = _goal_note(int(case["goal_index"]), "delayed-train", 0.0)
        if case.get("note_text") != expected_note:
            raise FrozenInferenceError("case note text is not the sealed original format")
        if case.get("note_goal_id") != f"delayed-train-goal-{int(case['goal_index'])}":
            raise FrozenInferenceError("case note identity changed")
    for offset in range(0, len(cases), 4):
        if [int(case["goal_index"]) for case in cases[offset:offset + 4]] != [0, 1, 2, 3]:
            raise FrozenInferenceError("case order is not balanced goal-major within each world")
    if set(world_order) != {int(world["world_seed"]) for world in worlds}:
        raise FrozenInferenceError("case worlds do not match the sealed world manifest")
    if any(int(case["world_seed"]) in set(design["fresh_world_selection"]["excluded_world_seeds"]) for case in cases):
        raise FrozenInferenceError("case manifest includes an excluded prior world")
    return {"cases": cases, "world_order": world_order}


def _validate_frozen_artifacts(design: dict, project_root: Path) -> dict:
    screening = design.get("frozen_screening_identity", {})
    for relative_path, expected_digest in screening.get("output_digests", {}).items():
        if _sha256_file(project_root / relative_path) != expected_digest:
            raise FrozenInferenceError(f"screening artifact digest changed: {relative_path}")
    checkpoints = design.get("frozen_checkpoints")
    if not isinstance(checkpoints, dict) or set(checkpoints) != set(FROZEN_INFERENCE_CHECKPOINTS):
        raise FrozenInferenceError("frozen checkpoint key set changed")
    if _canonical_digest(checkpoints) != EXPECTED_CHECKPOINT_MANIFEST_SHA256:
        raise FrozenInferenceError("checkpoint manifest digest does not match the sealed record")
    normalizations = design.get("normalization", {})
    candidate_normalization = normalizations.get("candidate_shared_row", {}).get("fixture")
    legacy_normalization = normalizations.get("legacy_baseline", {}).get("fixture")
    if candidate_normalization is None or candidate_normalization != legacy_normalization:
        raise FrozenInferenceError("candidate and baseline normalization fixtures differ")
    if normalizations.get("fit_during_fresh_evaluation") is not False:
        raise FrozenInferenceError("sealed design permits normalization fitting during inference")
    verified = {}
    for key in PAIR_EVALUATION_ORDER:
        frozen = checkpoints[key]
        expected = FROZEN_INFERENCE_CHECKPOINTS[key]
        path = project_root / frozen["path"]
        file_digest = _sha256_file(path)
        if file_digest != expected["digest"] or file_digest != frozen["current_digest"]:
            raise FrozenInferenceError(f"checkpoint file digest changed: {key}")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise FrozenInferenceError(f"cannot parse checkpoint {key}: {exc}") from exc
        if _canonical_digest(payload) != expected["payload_digest"]:
            raise FrozenInferenceError(f"checkpoint payload digest changed: {key}")
        actual_gate_head = payload.get("gate_head", LEGACY_GATE_HEAD)
        if actual_gate_head != expected["expected_gate_head"]:
            raise FrozenInferenceError(f"checkpoint gate head changed: {key}")
        if payload.get("source_sha") != expected["expected_source_sha"]:
            raise FrozenInferenceError(f"checkpoint source SHA changed: {key}")
        if payload.get("normalization") != candidate_normalization:
            raise FrozenInferenceError(f"checkpoint normalization changed: {key}")
        if _canonical_digest(payload["normalization"]) != frozen["normalization_digest"]:
            raise FrozenInferenceError(f"checkpoint normalization digest changed: {key}")
        if payload.get("training", {}).get("updates") != 1000:
            raise FrozenInferenceError(f"checkpoint update count changed: {key}")
        verified[key] = {
            "file_digest": file_digest,
            "payload_digest": _canonical_digest(payload),
            "gate_head": actual_gate_head,
            "source_sha": payload["source_sha"],
            "normalization_digest": _canonical_digest(payload["normalization"]),
            "updates": payload["training"]["updates"],
        }
    return {
        "screening_artifacts_verified": True,
        "checkpoint_manifest_sha256": _canonical_digest(checkpoints),
        "normalization_digest": _canonical_digest(candidate_normalization),
        "checkpoints": verified,
    }


def _case_spec(case: dict) -> dict:
    return {
        "split": "fresh-mapping-transfer",
        "world_seed": int(case["world_seed"]),
        "goal_index": int(case["goal_index"]),
        "note_goal_id": str(case["note_goal_id"]),
        "note_text": str(case["note_text"]),
        "gate_resonance_hz": list(case["gate_resonance_hz"]),
    }


def _cross_entropy(probabilities, target: int) -> float:
    values = np.asarray(probabilities, dtype=np.float64)
    if values.shape != (4,) or not np.isfinite(values).all() or np.any(values < 0.0):
        raise FrozenInferenceError("model probability vector is invalid")
    if not np.isclose(float(np.sum(values)), 1.0, atol=1e-12, rtol=0.0):
        raise FrozenInferenceError("model probability vector does not sum to one")
    return float(-math.log(max(float(values[int(target)]), np.finfo(np.float64).tiny)))


def score_case_result(case: dict, run: dict) -> dict:
    """Score one completed model run using only sealed metadata targets."""

    target_gate = int(case["metadata_reference_gate"])
    target_frequency = int(case["goal_index"])
    action = run.get("final_action", {})
    gate = int(action["gate"])
    frequency = int(action["frequency_index"])
    gate_loss = _cross_entropy(run["gate_probabilities"], target_gate)
    frequency_loss = _cross_entropy(run["frequency_probabilities"], target_frequency)
    return {
        "case_index": int(case["case_index"]),
        "world_seed": int(case["world_seed"]),
        "goal_index": target_frequency,
        "partition": str(case["partition"]),
        "frequency_to_gate": list(case["frequency_to_gate"]),
        "target_gate": target_gate,
        "target_frequency_index": target_frequency,
        "gate": gate,
        "frequency_index": frequency,
        "gate_loss": gate_loss,
        "frequency_loss": frequency_loss,
        "joint_mean_loss": float((gate_loss + frequency_loss) / 2.0),
        "gate_correct": bool(gate == target_gate),
        "frequency_correct": bool(frequency == target_frequency),
        "joint_correct": bool(gate == target_gate and frequency == target_frequency),
        "physical_success": bool(run["success"]),
        "failure_cause": run.get("failure_cause"),
        "raw_run": run,
    }


def _replay_final_trace(model, observations: list[dict], final_observation: dict | None = None) -> dict:
    runtime = model.initial_runtime()
    for observation in observations[:-1]:
        runtime, _ = model.raw_step(runtime, observation)
    final = observations[-1] if final_observation is None else final_observation
    _, trace = model.raw_step(runtime, final)
    return trace


def _permuted_observation(observation: dict, permutation: tuple[int, ...]) -> dict:
    result = copy.deepcopy(observation)
    response = np.asarray(result["measurement"]["channel_response"], dtype=np.float64)
    if response.shape != (4, 4):
        raise FrozenInferenceError("final response matrix is not 4x4")
    result["measurement"]["channel_response"] = response[list(permutation)].tolist()
    return result


def row_relabel_result(model, case: dict, prepared: dict, permutation: tuple[int, ...]) -> dict:
    """Check probability equivariance and selected-gate remapping for one p."""

    observations = prepared["policy_observations"]
    baseline_trace = _replay_final_trace(model, observations)
    permuted_trace = _replay_final_trace(
        model,
        observations,
        _permuted_observation(observations[-1], permutation),
    )
    baseline_gate = np.asarray(baseline_trace["gate_probs"], dtype=np.float64)
    permuted_gate = np.asarray(permuted_trace["gate_probs"], dtype=np.float64)
    baseline_frequency = np.asarray(baseline_trace["frequency_probs"], dtype=np.float64)
    permuted_frequency = np.asarray(permuted_trace["frequency_probs"], dtype=np.float64)
    gate_probability_passed = bool(np.allclose(
        permuted_gate,
        baseline_gate[list(permutation)],
        atol=ROW_PROBABILITY_ATOL,
        rtol=ROW_PROBABILITY_RTOL,
    ))
    frequency_probability_passed = bool(np.allclose(
        permuted_frequency,
        baseline_frequency,
        atol=ROW_PROBABILITY_ATOL,
        rtol=ROW_PROBABILITY_RTOL,
    ))
    baseline_context = np.asarray(baseline_trace["retained_goal_context"], dtype=np.float64)
    permuted_context = np.asarray(permuted_trace["retained_goal_context"], dtype=np.float64)
    context_unchanged = bool(np.array_equal(baseline_context, permuted_context))
    top = float(np.max(baseline_gate))
    tied = np.flatnonzero(np.abs(baseline_gate - top) <= ROW_TIE_TOLERANCE)
    if len(tied) == 1:
        baseline_selected = int(tied[0])
        expected_selected = int(permutation.index(baseline_selected))
        actual_selected = int(np.argmax(permuted_gate))
        selected_status = "passed" if actual_selected == expected_selected else "failed"
        selected_passed = bool(actual_selected == expected_selected)
    else:
        baseline_selected = None
        expected_selected = None
        actual_selected = None
        selected_status = "not_applicable_tie"
        selected_passed = None
    return {
        "case_index": int(case["case_index"]),
        "world_seed": int(case["world_seed"]),
        "goal_index": int(case["goal_index"]),
        "permutation": [int(value) for value in permutation],
        "gate_probability_passed": gate_probability_passed,
        "frequency_probability_passed": frequency_probability_passed,
        "retained_context_unchanged": context_unchanged,
        "baseline_selected_gate": baseline_selected,
        "expected_remapped_gate": expected_selected,
        "actual_remapped_gate": actual_selected,
        "selected_gate_remap_status": selected_status,
        "selected_gate_remap_passed": selected_passed,
    }


def _metric_summary(records: list[dict]) -> dict:
    if not records:
        return {"n": 0}
    return {
        "n": len(records),
        "gate_accuracy": float(np.mean([record["gate_correct"] for record in records])),
        "frequency_accuracy": float(np.mean([record["frequency_correct"] for record in records])),
        "joint_accuracy": float(np.mean([record["joint_correct"] for record in records])),
        "physical_success": int(sum(record["physical_success"] for record in records)),
        "physical_success_rate": float(np.mean([record["physical_success"] for record in records])),
        "gate_loss": float(np.mean([record["gate_loss"] for record in records])),
        "frequency_loss": float(np.mean([record["frequency_loss"] for record in records])),
        "joint_mean_loss": float(np.mean([record["joint_mean_loss"] for record in records])),
    }


def _group_metrics(records: list[dict], key_fn, *, required_keys=()) -> dict:
    grouped = defaultdict(list)
    for record in records:
        grouped[key_fn(record)].append(record)
    for key in required_keys:
        grouped.setdefault(key, [])
    return {
        str(key): _metric_summary(group)
        for key, group in sorted(grouped.items(), key=lambda item: str(item[0]))
    }


def _paired_comparison(case_results: dict[str, list[dict]]) -> dict:
    comparisons = {}
    for candidate_key, legacy_key in PAIR_KEYS.items():
        candidate = {record["case_index"]: record for record in case_results[candidate_key]}
        legacy = {record["case_index"]: record for record in case_results[legacy_key]}
        if list(candidate) != list(legacy):
            raise FrozenInferenceError(f"paired case order mismatch: {candidate_key} vs {legacy_key}")
        metric_pairs = {}
        for metric in ("gate_correct", "frequency_correct", "joint_correct", "physical_success"):
            gains = sum(bool(candidate[index][metric]) and not bool(legacy[index][metric]) for index in candidate)
            losses = sum(not bool(candidate[index][metric]) and bool(legacy[index][metric]) for index in candidate)
            ties = sum(bool(candidate[index][metric]) == bool(legacy[index][metric]) for index in candidate)
            metric_pairs[metric] = {
                "candidate_count": int(sum(bool(candidate[index][metric]) for index in candidate)),
                "legacy_count": int(sum(bool(legacy[index][metric]) for index in candidate)),
                "gain": int(gains),
                "loss": int(losses),
                "tie": int(ties),
            }
        metric_pairs["loss_delta_candidate_minus_legacy"] = {
            field: float(np.mean([
                candidate[index][field] - legacy[index][field]
                for index in candidate
            ]))
            for field in ("gate_loss", "frequency_loss", "joint_mean_loss")
        }
        comparisons[candidate_key] = {
            "legacy_key": legacy_key,
            "case_count": len(candidate),
            "metrics": metric_pairs,
        }
    return comparisons


def _aggregate_results(case_results: dict[str, list[dict]]) -> dict:
    result = {"per_checkpoint": {}, "per_world": {}, "per_mapping": {}, "per_partition": {}}
    for key, records in case_results.items():
        result["per_checkpoint"][key] = _metric_summary(records)
        result["per_world"][key] = _group_metrics(records, lambda record: record["world_seed"])
        result["per_mapping"][key] = _group_metrics(records, lambda record: tuple(record["frequency_to_gate"]))
        result["per_partition"][key] = _group_metrics(
            records,
            lambda record: record["partition"],
            required_keys=(
                PARTITION_SEEN_TRAINING,
                PARTITION_DISJOINT_PRIOR,
                PARTITION_DISJOINT_NEVER,
                PARTITION_DISJOINT_COUNTERFACTUAL,
            ),
        )
    result["paired_candidate_vs_legacy"] = _paired_comparison(case_results)
    return result


def _atomic_write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
        temporary.replace(path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(text)
            handle.flush()
        temporary.replace(path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def _case_prefix_records(
    cases: list[dict],
    case_results: dict[str, list[dict]],
    completed_cases: int,
) -> list[dict]:
    """Serialize only the fully completed raw case prefix."""

    records = []
    for index, case in enumerate(cases[:int(completed_cases)]):
        if any(index >= len(case_results[key]) for key in PAIR_EVALUATION_ORDER):
            break
        records.append({
            "case_index": int(case["case_index"]),
            "world_seed": int(case["world_seed"]),
            "goal_index": int(case["goal_index"]),
            "partition": case["partition"],
            "results": {
                key: case_results[key][index]
                for key in PAIR_EVALUATION_ORDER
            },
        })
    return records


def _markdown_value(value) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.6g}"
    return str(value)


def _evaluation_summary_markdown(report: dict) -> str:
    """Render a compact status/output summary without inventing partial metrics."""

    lines = [
        "# v0.3 fresh mapping-transfer inference",
        "",
        f"- Status: `{report.get('status', 'unknown')}`",
        f"- Evaluation started: `{report.get('evaluation_started')}`",
        f"- Frozen model outcomes loaded: `{report.get('fresh_model_outcomes_loaded')}`",
        f"- Completed primary cases: `{report.get('completed_case_count', 0)}/{report.get('expected_case_count', 16)}`",
        f"- Completed row-relabel checks: `{report.get('completed_row_relabel_count', 0)}/{report.get('expected_row_relabel_count', 1536)}`",
        "",
        "The case manifest is the sealed source-only plan. No checkpoint is fitted",
        "or mutated during inference. If a cap or failure occurs, later aggregate",
        "metrics are intentionally omitted.",
        "",
        "## Failures",
        "",
    ]
    failures = report.get("failures", [])
    if failures:
        lines.extend(
            f"- `{item.get('phase')}` `{item.get('error_type')}`: {item.get('error')}"
            for item in failures
        )
    else:
        lines.append("- None recorded.")
    statuses = report.get("derived_metrics_status", {})
    if report.get("derived_metrics") is not None and all(
        value == "complete" for value in statuses.values()
    ):
        lines.extend(["", "## Per-checkpoint metrics", "", "| checkpoint | n | joint accuracy | physical success | joint loss |", "|---|---:|---:|---:|---:|"])
        for key, metrics in sorted(report["derived_metrics"].get("per_checkpoint", {}).items()):
            lines.append(
                f"| {key} | {_markdown_value(metrics.get('n'))} | "
                f"{_markdown_value(metrics.get('joint_accuracy'))} | "
                f"{_markdown_value(metrics.get('physical_success'))} | "
                f"{_markdown_value(metrics.get('joint_mean_loss'))} |"
            )
    else:
        lines.extend([
            "",
            "## Derived metrics",
            "",
            "Unavailable because the run did not reach the derived-metrics stage;",
            "no later metrics were computed after the cap or failure.",
        ])
    return "\n".join(lines) + "\n"


def _failure_record(exc: Exception, *, phase: str, case: dict | None = None) -> dict:
    record = {
        "phase": str(phase),
        "error_type": type(exc).__name__,
        "error": str(exc),
    }
    if case is not None:
        record["case_index"] = int(case["case_index"])
        record["world_seed"] = int(case["world_seed"])
        record["goal_index"] = int(case["goal_index"])
    return record


def _empty_report(output_path: Path, *, source_sha: str | None, design_sha: str | None) -> dict:
    return {
        "schema": "vevo.v03.neural-fresh-mapping-transfer-inference.v1",
        "status": "partial_failure",
        "source_sha": source_sha,
        "preregistration_path": DESIGN_PATH,
        "preregistration_sha256": design_sha,
        "report_path": str(output_path),
        "summary_path": str(output_path.with_suffix(".md")),
        "evaluation_started": True,
        "fresh_model_outcomes_loaded": False,
        "completed_case_count": 0,
        "expected_case_count": 16,
        "completed_row_relabel_count": 0,
        "expected_row_relabel_count": 1536,
        "cases": [],
        "row_relabel": [],
        "derived_metrics": None,
        "failures": [],
        "derived_metrics_status": {
            "per_checkpoint": "unavailable_due_to_failure",
            "per_world": "unavailable_due_to_failure",
            "per_mapping": "unavailable_due_to_failure",
            "per_partition": "unavailable_due_to_failure",
            "paired_candidate_vs_legacy": "unavailable_due_to_failure",
        },
    }


def run_frozen_inference(
    *,
    output_path: str | Path = FRESH_EVALUATION_REPORT_PATH,
    wall_clock_cap: float = 300.0,
    additional_memory_cap_kb: int = ADDITIONAL_MEMORY_CAP_KB,
) -> dict:
    """Run the sealed paired fresh-world inference after review authorization."""

    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"refusing to overwrite inference report: {output}")
    project_root = _project_root()
    start_wall = time.perf_counter()
    start_cpu = time.process_time()
    deadline = start_wall + float(wall_clock_cap)
    baseline_rss_kb = _rss_kb()
    source_sha = _source_sha()
    design_sha = None
    report = _empty_report(output, source_sha=source_sha, design_sha=None)
    report.update({
        "wall_clock_cap_seconds": float(wall_clock_cap),
        "additional_memory_cap_kb": int(additional_memory_cap_kb),
        "checkpoint_reload": {"status": "not_started", "trials": {}},
        "evaluation_order": {
            "case_order": "sealed case manifest order, world-major then goals 0..3",
            "checkpoint_order": list(PAIR_EVALUATION_ORDER),
            "paired_case_major": True,
        },
    })
    failures = []
    case_results = {key: [] for key in PAIR_EVALUATION_ORDER}
    row_results = []
    cases = []
    status = "partial_failure"
    try:
        design, design_sha = _load_design(project_root)
        report["preregistration_sha256"] = design_sha
        manifest = _validate_case_manifest(design)
        artifact_validation = _validate_frozen_artifacts(design, project_root)
        report["preflight"] = {
            "design_sha256": design_sha,
            "source_sha_at_registration": design["source_sha_at_registration"],
            "manifest_case_sha256": EXPECTED_CASE_MANIFEST_SHA256,
            "manifest_world_sha256": EXPECTED_WORLD_MANIFEST_SHA256,
            "checkpoint_manifest_sha256": artifact_validation["checkpoint_manifest_sha256"],
            "normalization_digest": artifact_validation["normalization_digest"],
            "screening_artifacts_verified": artifact_validation["screening_artifacts_verified"],
        }
        models = {}
        for key in PAIR_EVALUATION_ORDER:
            _budget_check(
                deadline=deadline,
                baseline_rss_kb=baseline_rss_kb,
                additional_memory_cap_kb=additional_memory_cap_kb,
                phase="checkpoint_reload",
                completed_cases=0,
            )
            frozen = FROZEN_INFERENCE_CHECKPOINTS[key]
            model, payload = _load_delayed_checkpoint(
                project_root / frozen["path"],
                model_class=MODEL_CLASSES[frozen["model_class"]],
                expected_label=frozen["label"],
                expected_seed=frozen["seed"],
                expected_normalization=design["normalization"]["candidate_shared_row"]["fixture"],
                expected_source_sha=frozen["expected_source_sha"],
                expected_gate_head=frozen["expected_gate_head"],
            )
            models[key] = model
            report["checkpoint_reload"]["trials"][key] = {
                "status": "passed",
                "normalization_exact": True,
                "payload_schema": payload["schema"],
                "gate_head": frozen["expected_gate_head"],
                "source_sha": payload["source_sha"],
                "updates": payload["training"]["updates"],
            }
        report["checkpoint_reload"]["status"] = "passed"
        report["fresh_model_outcomes_loaded"] = True
        cases = manifest["cases"]
        for index, case in enumerate(cases):
            _budget_check(
                deadline=deadline,
                baseline_rss_kb=baseline_rss_kb,
                additional_memory_cap_kb=additional_memory_cap_kb,
                phase="primary_case",
                case_index=index,
                completed_cases=index,
            )
            spec = _case_spec(case)
            try:
                prepared = _prepare_delayed_episode(spec)
                per_checkpoint = {}
                for key in PAIR_EVALUATION_ORDER:
                    _budget_check(
                        deadline=deadline,
                        baseline_rss_kb=baseline_rss_kb,
                        additional_memory_cap_kb=additional_memory_cap_kb,
                        phase="primary_checkpoint_pair",
                        case_index=index,
                        completed_cases=index,
                    )
                    run = run_delayed_episode(models[key], spec, prepared={
                        "episode_snapshot": prepared[0].snapshot(),
                        "policy_observations": prepared[1],
                        "schedule_audit": prepared[2],
                    })
                    per_checkpoint[key] = score_case_result(case, run)
                for key in PAIR_EVALUATION_ORDER:
                    case_results[key].append(per_checkpoint[key])
            except InferenceDeadlineExceeded:
                raise
            except Exception as exc:
                failures.append(_failure_record(exc, phase="primary_case", case=case))
                break
        completed_cases = len(case_results[PAIR_EVALUATION_ORDER[0]])
        report["completed_case_count"] = completed_cases
        report["cases"] = _case_prefix_records(cases, case_results, completed_cases)
        if failures:
            raise FrozenInferenceError("primary case failure stopped the sealed prefix")
        if completed_cases != len(cases):
            raise InferenceDeadlineExceeded("primary_case", completed_cases=completed_cases)
        for case_index, case in enumerate(cases):
            _budget_check(
                deadline=deadline,
                baseline_rss_kb=baseline_rss_kb,
                additional_memory_cap_kb=additional_memory_cap_kb,
                phase="row_relabel_case",
                case_index=case_index,
                completed_cases=case_index,
            )
            spec = _case_spec(case)
            prepared = _prepare_delayed_episode(spec)
            prepared_record = {
                "episode_snapshot": prepared[0].snapshot(),
                "policy_observations": prepared[1],
                "schedule_audit": prepared[2],
            }
            for key in sorted(CANDIDATE_KEYS, key=PAIR_EVALUATION_ORDER.index):
                for permutation in itertools.permutations(range(4)):
                    _budget_check(
                        deadline=deadline,
                        baseline_rss_kb=baseline_rss_kb,
                        additional_memory_cap_kb=additional_memory_cap_kb,
                        phase="row_relabel_check",
                        case_index=case_index,
                        completed_cases=case_index,
                    )
                    row_results.append({
                        "checkpoint": key,
                        **row_relabel_result(models[key], case, prepared_record, tuple(permutation)),
                    })
        report["completed_row_relabel_count"] = len(row_results)
        report["row_relabel"] = row_results
        _budget_check(
            deadline=deadline,
            baseline_rss_kb=baseline_rss_kb,
            additional_memory_cap_kb=additional_memory_cap_kb,
            phase="derived_metrics",
            completed_cases=len(cases),
        )
        report["derived_metrics"] = _aggregate_results(case_results)
        report["derived_metrics_status"] = {
            "per_checkpoint": "complete",
            "per_world": "complete",
            "per_mapping": "complete",
            "per_partition": "complete",
            "paired_candidate_vs_legacy": "complete",
        }
        status = "complete"
    except InferenceDeadlineExceeded as exc:
        failures.append(_failure_record(exc, phase=exc.phase))
        status = "partial_wall_clock_cap" if time.perf_counter() >= deadline else "partial_memory_cap"
        report["completed_case_count"] = len(case_results[PAIR_EVALUATION_ORDER[0]])
        report["completed_row_relabel_count"] = len(row_results)
        report["cases"] = _case_prefix_records(
            cases,
            case_results,
            report["completed_case_count"],
        )
        report["row_relabel"] = row_results
        report["derived_metrics_status"] = {
            "per_checkpoint": "unavailable_budget_exhausted",
            "per_world": "unavailable_budget_exhausted",
            "per_mapping": "unavailable_budget_exhausted",
            "per_partition": "unavailable_budget_exhausted",
            "paired_candidate_vs_legacy": "unavailable_budget_exhausted",
        }
    except Exception as exc:
        if not failures:
            failures.append(_failure_record(exc, phase="preflight_or_inference"))
        status = "partial_failure"
        report["completed_case_count"] = len(case_results[PAIR_EVALUATION_ORDER[0]])
        report["completed_row_relabel_count"] = len(row_results)
        report["cases"] = _case_prefix_records(
            cases,
            case_results,
            report["completed_case_count"],
        )
        report["derived_metrics_status"] = {
            "per_checkpoint": "unavailable_due_to_failure",
            "per_world": "unavailable_due_to_failure",
            "per_mapping": "unavailable_due_to_failure",
            "per_partition": "unavailable_due_to_failure",
            "paired_candidate_vs_legacy": "unavailable_due_to_failure",
        }
    report["status"] = status
    report["failures"] = failures
    report["runtime"] = {
        "wall_clock_cap_seconds": float(wall_clock_cap),
        "wall_clock_seconds": float(time.perf_counter() - start_wall),
        "process_cpu_seconds": float(time.process_time() - start_cpu),
        "additional_memory_cap_kb": int(additional_memory_cap_kb),
        "max_rss_kb": _rss_kb(),
        "baseline_rss_kb": int(baseline_rss_kb),
        "additional_high_water_kb": max(0, _rss_kb() - baseline_rss_kb),
        "within_wall_clock_cap": bool(time.perf_counter() - start_wall <= wall_clock_cap),
        "single_cpu_process": True,
        "python": platform.python_version(),
    }
    report["summary_path"] = str(output.with_suffix(".md"))
    _atomic_write_json(output, report)
    _atomic_write_text(output.with_suffix(".md"), _evaluation_summary_markdown(report))
    return report


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=FRESH_EVALUATION_REPORT_PATH)
    parser.add_argument("--wall-clock-cap", type=float, default=300.0)
    parser.add_argument("--additional-memory-cap-kb", type=int, default=ADDITIONAL_MEMORY_CAP_KB)
    args = parser.parse_args()
    report = run_frozen_inference(
        output_path=args.output,
        wall_clock_cap=args.wall_clock_cap,
        additional_memory_cap_kb=args.additional_memory_cap_kb,
    )
    print(json.dumps({
        "schema": report["schema"],
        "status": report["status"],
        "completed_case_count": report.get("completed_case_count"),
        "completed_row_relabel_count": report.get("completed_row_relabel_count"),
        "failures": len(report.get("failures", [])),
        "runtime": report.get("runtime"),
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
