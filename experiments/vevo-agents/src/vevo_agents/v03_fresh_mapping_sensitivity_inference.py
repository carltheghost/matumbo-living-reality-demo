"""Run the reviewed four-arm inspected-case sensitivity inference.

This module is review-gated and inference-only.  It replays the completed
baseline arm first, verifies exact action/probability compatibility against the
accepted baseline report, and only then permits the three predeclared
sensitivity arms.  Importing it performs no inference.
"""

from __future__ import annotations

from collections import defaultdict
import copy
import hashlib
import json
from pathlib import Path
import platform
import resource
import time

import numpy as np

from .v03_delayed_memory import (
    _hidden_observation_audit,
    _load_delayed_checkpoint,
    _strip_goal_bearing_note,
    run_delayed_episode,
)
from .v03_fresh_mapping_inference import (
    CANDIDATE_KEYS,
    EXPECTED_CASE_MANIFEST_SHA256 as BASE_EXPECTED_CASE_MANIFEST_SHA256,
    EXPECTED_WORLD_MANIFEST_SHA256 as BASE_EXPECTED_WORLD_MANIFEST_SHA256,
    FROZEN_INFERENCE_CHECKPOINTS,
    FrozenInferenceError,
    InferenceDeadlineExceeded,
    MODEL_CLASSES,
    _atomic_write_json,
    _atomic_write_text,
    _budget_check,
    _canonical_digest,
    _load_design,
    _metric_summary,
    _project_root,
    _source_sha,
    _validate_case_manifest,
    _validate_frozen_artifacts,
    score_case_result,
)
from .v03_fresh_mapping_preregistration import (
    PARTITION_DISJOINT_COUNTERFACTUAL,
    PARTITION_DISJOINT_NEVER,
    PARTITION_DISJOINT_PRIOR,
    PARTITION_SEEN_TRAINING,
)
from .v03_fresh_mapping_sensitivity_preregistration import (
    BASE_EVALUATION_REPORT_PATH,
    BASE_EVALUATION_REPORT_SHA256,
    BASE_EVALUATION_SUMMARY_PATH,
    BASE_EVALUATION_SUMMARY_SHA256,
    BASE_EVALUATION_SOURCE_SHA,
    BASELINE_HIDDEN_DELAY_STEPS,
    OUTPUT_PATH as SENSITIVITY_PREREGISTRATION_PATH,
    SENSITIVITY_EVALUATION_REPORT_PATH,
    SENSITIVITY_ARM_IDS,
    WALL_CLOCK_CAP_SECONDS,
    ADDITIONAL_MEMORY_CAP_KB,
    NOTE_FORMAT_VARIANT_TEMPLATE,
)
from .v03_model import NOTE_PAYLOAD_MASK_INDEX, encode_policy_observation
from .v03_protocol import CorrectedEpisode


DESIGN_PATH = str(SENSITIVITY_PREREGISTRATION_PATH)
EXPECTED_PREREGISTRATION_SOURCE_SHA = "b2dc10907da086bae99098dbb56d1de02aeafb52"
EXPECTED_DESIGN_FILE_SHA256 = "91985664d76422908589ff455ff0f14fdd90659ae13e058e7f6d0e12d344189f"
EXPECTED_BASE_EVALUATION_REPORT_SHA256 = BASE_EVALUATION_REPORT_SHA256
EXPECTED_CASE_MANIFEST_SHA256 = BASE_EXPECTED_CASE_MANIFEST_SHA256
EXPECTED_WORLD_MANIFEST_SHA256 = BASE_EXPECTED_WORLD_MANIFEST_SHA256

CANDIDATE_EVALUATION_ORDER = tuple(
    sorted(CANDIDATE_KEYS, key=("full-seed-107", "full-seed-117", "control-seed-141", "control-seed-143").index)
)
PARTITION_ORDER = (
    PARTITION_SEEN_TRAINING,
    PARTITION_DISJOINT_PRIOR,
    PARTITION_DISJOINT_NEVER,
    PARTITION_DISJOINT_COUNTERFACTUAL,
)
PARTITION_LABELS = {
    PARTITION_SEEN_TRAINING: "seen-training mapping; zero planned cases",
    PARTITION_DISJOINT_PRIOR: "training-disjoint previously inspected mapping; zero planned cases",
    PARTITION_DISJOINT_NEVER: "U mapping, now inspected; not fresh evidence",
    PARTITION_DISJOINT_COUNTERFACTUAL: "counterfactually exposed mapping, now inspected; not fresh evidence",
}


class SensitivityInferenceError(RuntimeError):
    """The sealed sensitivity design or baseline replay is not safe to use."""


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as exc:
        raise SensitivityInferenceError(f"cannot read artifact {path}: {exc}") from exc


def _load_sensitivity_design(project_root: Path) -> tuple[dict, str]:
    path = project_root / DESIGN_PATH
    digest = _sha256_file(path)
    if digest != EXPECTED_DESIGN_FILE_SHA256:
        raise SensitivityInferenceError("sealed sensitivity preregistration digest does not match")
    try:
        design = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SensitivityInferenceError(f"cannot parse sensitivity preregistration: {exc}") from exc
    if design.get("schema") != "vevo.v03.neural-fresh-mapping-transfer-sensitivity-preregistration.v1":
        raise SensitivityInferenceError("sensitivity preregistration schema mismatch")
    if design.get("status") != "awaiting_independent_review_before_sensitivity_evaluation":
        raise SensitivityInferenceError("sensitivity evaluation is not review-gated")
    if design.get("source_sha_at_registration") != EXPECTED_PREREGISTRATION_SOURCE_SHA:
        raise SensitivityInferenceError("sensitivity preregistration source SHA mismatch")
    if design.get("evaluation_started") or design.get("sensitivity_cases_evaluated") != 0:
        raise SensitivityInferenceError("sensitivity preregistration already records an evaluation")
    return design, digest


def _load_baseline_report(project_root: Path, design: dict) -> dict:
    identity = design.get("baseline_evaluation_identity", {})
    path = project_root / BASE_EVALUATION_REPORT_PATH
    expected = identity.get("report_sha256")
    if expected != EXPECTED_BASE_EVALUATION_REPORT_SHA256 or _sha256_file(path) != expected:
        raise SensitivityInferenceError("completed baseline evaluation report digest changed")
    summary_path = project_root / BASE_EVALUATION_SUMMARY_PATH
    summary_expected = identity.get("summary_sha256")
    if summary_expected != BASE_EVALUATION_SUMMARY_SHA256 or _sha256_file(summary_path) != summary_expected:
        raise SensitivityInferenceError("completed baseline evaluation summary digest changed")
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SensitivityInferenceError(f"cannot parse completed baseline report: {exc}") from exc
    if (
        report.get("status") != "complete"
        or report.get("completed_case_count") != 16
        or report.get("completed_row_relabel_count") != 1536
        or report.get("source_sha") != BASE_EVALUATION_SOURCE_SHA
    ):
        raise SensitivityInferenceError("completed baseline report is not the accepted 16-case result")
    if report.get("failures"):
        raise SensitivityInferenceError("completed baseline report contains failures")
    if len(report.get("cases", [])) != 16:
        raise SensitivityInferenceError("completed baseline report case list is incomplete")
    return report


def _validate_sensitivity_design(
    design: dict,
    baseline_report: dict,
    base_design: dict,
) -> dict:
    cases = design.get("case_manifest")
    if not isinstance(cases, list) or len(cases) != 16:
        raise SensitivityInferenceError("sensitivity case manifest is not the sealed 16-case plan")
    if _canonical_digest(cases) != EXPECTED_CASE_MANIFEST_SHA256:
        raise SensitivityInferenceError("sensitivity case manifest digest does not match")
    if tuple(arm.get("id") for arm in design.get("arms", [])) != SENSITIVITY_ARM_IDS:
        raise SensitivityInferenceError("sensitivity arm order changed")
    candidate_checkpoints = design.get("frozen_candidate_checkpoints", {})
    base_candidate_checkpoints = {
        key: base_design.get("frozen_checkpoints", {}).get(key)
        for key in CANDIDATE_EVALUATION_ORDER
    }
    if set(candidate_checkpoints) != set(CANDIDATE_EVALUATION_ORDER):
        raise SensitivityInferenceError("sensitivity candidate checkpoint set changed")
    if _canonical_digest(candidate_checkpoints) != _canonical_digest(base_candidate_checkpoints):
        raise SensitivityInferenceError("sensitivity candidate checkpoint manifest changed")
    if design.get("normalization", {}).get("candidate_shared_row") != base_design.get("normalization", {}).get("candidate_shared_row"):
        raise SensitivityInferenceError("sensitivity normalization fixture changed")
    if design.get("metrics", {}).get("primary_evaluation_count") != 256:
        raise SensitivityInferenceError("sensitivity primary evaluation count changed")
    baseline_cases = baseline_report.get("cases", [])
    for expected, actual in zip(cases, baseline_cases):
        for field in ("case_index", "world_seed", "goal_index", "partition", "frequency_to_gate"):
            if expected.get(field) != actual.get(field):
                raise SensitivityInferenceError(f"baseline case identity mismatch in {field}")
    return {"cases": cases, "arms": design["arms"]}


def _arm_note_text(case: dict, arm: dict) -> str:
    if not arm["meaning_preserving_note_variant"]:
        return str(case["note_text"])
    return NOTE_FORMAT_VARIANT_TEMPLATE.format(
        goal_frequency=float(case["target_frequency_hz"]),
    )


def _arm_spec(case: dict, arm: dict) -> dict:
    return {
        "split": "fresh-mapping-transfer",
        "world_seed": int(case["world_seed"]),
        "goal_index": int(case["goal_index"]),
        "note_goal_id": str(case["note_goal_id"]),
        "note_text": _arm_note_text(case, arm),
        "gate_resonance_hz": list(case["gate_resonance_hz"]),
    }


def _prepare_sensitivity_episode(spec: dict, *, hidden_delay_steps: int) -> tuple[CorrectedEpisode, list[dict], dict]:
    """Prepare a fixed-contract episode with only the predeclared delay count changed."""

    if int(hidden_delay_steps) not in (2, 4, 8):
        raise SensitivityInferenceError("hidden delay count is outside the sealed arm set")
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
        raise SensitivityInferenceError("sensitivity note lookup failed")
    observations.append(("note_shown_once", copy.deepcopy(episode.policy_observation())))
    hidden_audits = []
    for index in range(int(hidden_delay_steps)):
        episode.advance(np.zeros(4, dtype=np.float64))
        hidden = _strip_goal_bearing_note(episode.policy_observation())
        hidden_audits.append(_hidden_observation_audit(hidden))
        observations.append((f"goal_independent_delay_{index + 1}", hidden))
    episode.execute_diagnostic(0)
    if not episode.measurement or not episode.measurement.get("accepted"):
        raise SensitivityInferenceError("sensitivity diagnostic failed")
    final_hidden = _strip_goal_bearing_note(episode.policy_observation())
    hidden_audits.append(_hidden_observation_audit(final_hidden))
    observations.append(("spectrum_and_action", final_hidden))
    stage_names = [name for name, _ in observations]
    policy_observations = [observation for _, observation in observations]
    payload_masks = [
        int(encode_policy_observation(observation)[NOTE_PAYLOAD_MASK_INDEX])
        for observation in policy_observations
    ]
    expected_masks = [0, 1, *([0] * int(hidden_delay_steps)), 0]
    if payload_masks != expected_masks:
        raise SensitivityInferenceError("sensitivity note payload masks changed")
    return episode, policy_observations, {
        "stage_names": stage_names,
        "policy_observation_count": len(policy_observations),
        "note_payload_masks": payload_masks,
        "note_shown_once": payload_masks.count(1) == 1,
        "hidden_rows": hidden_audits,
        "hidden_delay_steps": int(hidden_delay_steps),
        "hidden_goal_bearing_fields_validated": all(
            item["text_empty"]
            and item["content_digest_empty"]
            and item["target_marker_absent"]
            and item["payload_mask_zero"]
            for item in hidden_audits
        ),
    }


def _action_signature(run: dict) -> dict:
    action = run.get("final_action", {})
    return {
        "gate": int(action["gate"]),
        "frequency_index": int(action["frequency_index"]),
        "frequency": float(action["frequency"]),
        "gate_probabilities": list(run["gate_probabilities"]),
        "frequency_probabilities": list(run["frequency_probabilities"]),
    }


def _case_report(report: dict, case: dict) -> dict:
    for existing in report["cases"]:
        if int(existing["case_index"]) == int(case["case_index"]):
            return existing
    record = {
        "case_index": int(case["case_index"]),
        "world_seed": int(case["world_seed"]),
        "goal_index": int(case["goal_index"]),
        "partition": str(case["partition"]),
        "frequency_to_gate": list(case["frequency_to_gate"]),
        "arms": {},
    }
    report["cases"].append(record)
    return record


def _arm_case_report(report: dict, case: dict, arm: dict) -> dict:
    case_record = _case_report(report, case)
    arm_id = str(arm["id"])
    if arm_id not in case_record["arms"]:
        case_record["arms"][arm_id] = {
            "hidden_delay_steps": int(arm["hidden_delay_steps"]),
            "note_mode": str(arm["note_mode"]),
            "results": {},
            "completed_checkpoint_count": 0,
            "checkpoint_results_complete": False,
        }
    return case_record["arms"][arm_id]


def _attach_arm_checkpoint_result(
    report: dict,
    arm_case_record: dict,
    checkpoint: str,
    result: dict,
) -> None:
    """Attach a fully derived result for legacy/test callers.

    The live runner uses :func:`_attach_raw_arm_checkpoint_result` immediately
    after inference, then calls this function only after all replay and budget
    gates for derived scoring have passed.  Keeping this compatibility helper
    complete makes synthetic fixture tests concise without weakening the raw
    result durability rule.
    """

    if checkpoint in arm_case_record["results"]:
        existing = arm_case_record["results"][checkpoint]
        if not existing.get("raw_inference_complete"):
            raise SensitivityInferenceError(f"duplicate sensitivity checkpoint result: {checkpoint}")
        existing.update(copy.deepcopy(result))
        existing["raw_inference_complete"] = True
        existing["derived_fields_complete"] = True
        return
    raw_run = copy.deepcopy(result.get("raw_run", result))
    arm_case_record["results"][checkpoint] = {
        "raw_run": raw_run,
        "raw_inference_complete": True,
        "derived_fields_complete": True,
        **copy.deepcopy(result),
    }
    arm_case_record["results"][checkpoint]["raw_run"] = raw_run
    arm_case_record["completed_checkpoint_count"] = len(arm_case_record["results"])
    arm_case_record["checkpoint_results_complete"] = (
        arm_case_record["completed_checkpoint_count"] == len(CANDIDATE_EVALUATION_ORDER)
    )
    report["completed_primary_evaluations"] += 1


def _attach_raw_arm_checkpoint_result(
    report: dict,
    arm_case_record: dict,
    checkpoint: str,
    raw_run: dict,
) -> dict:
    """Durably attach one completed inference before any derived work.

    A cooperative deadline can fire after a model returns but before replay
    comparison or scoring.  The raw prediction is therefore the first thing
    written into the in-memory report prefix; derived fields are intentionally
    added later and may remain unavailable.
    """

    if checkpoint in arm_case_record["results"]:
        raise SensitivityInferenceError(f"duplicate sensitivity checkpoint result: {checkpoint}")
    record = {
        "raw_run": copy.deepcopy(raw_run),
        "raw_inference_complete": True,
        "derived_fields_complete": False,
    }
    arm_case_record["results"][checkpoint] = record
    arm_case_record["completed_checkpoint_count"] = len(arm_case_record["results"])
    arm_case_record["checkpoint_results_complete"] = (
        arm_case_record["completed_checkpoint_count"] == len(CANDIDATE_EVALUATION_ORDER)
    )
    report["completed_primary_evaluations"] += 1
    return record


def _complete_arm_checkpoint_result(
    arm_case_record: dict,
    checkpoint: str,
    derived_result: dict,
) -> None:
    """Append derived scoring fields without replacing the durable raw run."""

    if checkpoint not in arm_case_record["results"]:
        raise SensitivityInferenceError(f"missing raw sensitivity checkpoint result: {checkpoint}")
    record = arm_case_record["results"][checkpoint]
    if not record.get("raw_inference_complete"):
        raise SensitivityInferenceError(f"raw sensitivity checkpoint result is incomplete: {checkpoint}")
    raw_run = record["raw_run"]
    record.update(copy.deepcopy(derived_result))
    record["raw_run"] = raw_run
    record["raw_inference_complete"] = True
    record["derived_fields_complete"] = True


def _refresh_arm_progress(report: dict, arm_id: str, *, status: str | None = None) -> None:
    """Reflect all retained raw prefixes, including terminal failure prefixes."""

    arm_status = report["arms"][str(arm_id)]
    if status is not None:
        arm_status["status"] = str(status)
    arm_status["completed_case_count"] = sum(
        bool(case_record.get("arms", {}).get(str(arm_id), {}).get("checkpoint_results_complete"))
        for case_record in report["cases"]
    )
    arm_status["completed_evaluations"] = sum(
        len(case_record.get("arms", {}).get(str(arm_id), {}).get("results", {}))
        for case_record in report["cases"]
    )


def _failure_record(exc: Exception, *, phase: str, arm: dict | None = None, case: dict | None = None, checkpoint: str | None = None) -> dict:
    result = {
        "phase": str(phase),
        "error_type": type(exc).__name__,
        "error": str(exc),
    }
    if arm is not None:
        result["arm_id"] = str(arm["id"])
    if case is not None:
        result.update({
            "case_index": int(case["case_index"]),
            "world_seed": int(case["world_seed"]),
            "goal_index": int(case["goal_index"]),
        })
    if checkpoint is not None:
        result["checkpoint"] = str(checkpoint)
    return result


def _metric_groups(records: dict[str, list[dict]], *, stage_check=None) -> dict:
    result = {"per_checkpoint": {}, "per_world": {}, "per_mapping": {}, "per_partition": {}}
    for key, values in records.items():
        result["per_checkpoint"][key] = _metric_summary(values)
    if stage_check is not None:
        stage_check("after_per_checkpoint")
    for key, values in records.items():
        grouped = defaultdict(list)
        for value in values:
            grouped[str(value["world_seed"])].append(value)
        result["per_world"][key] = {group: _metric_summary(rows) for group, rows in sorted(grouped.items())}
    if stage_check is not None:
        stage_check("after_per_world")
    for key, values in records.items():
        grouped = defaultdict(list)
        for value in values:
            grouped[str(tuple(value["frequency_to_gate"]))].append(value)
        result["per_mapping"][key] = {group: _metric_summary(rows) for group, rows in sorted(grouped.items())}
    if stage_check is not None:
        stage_check("after_per_mapping")
    for key, values in records.items():
        grouped = defaultdict(list)
        for value in values:
            grouped[str(value["partition"])].append(value)
        result["per_partition"][key] = {
            partition: _metric_summary(grouped.get(partition, []))
            for partition in PARTITION_ORDER
        }
    if stage_check is not None:
        stage_check("after_per_partition")
    return result


def _empty_report(output: Path, source_sha: str | None) -> dict:
    return {
        "schema": "vevo.v03.neural-fresh-mapping-transfer-sensitivity-inference.v1",
        "status": "partial_failure",
        "source_sha": source_sha,
        "preregistration_path": DESIGN_PATH,
        "report_path": str(output),
        "summary_path": str(output.with_suffix(".md")),
        "evaluation_started": True,
        "sensitivity_model_outcomes_loaded": False,
        "expected_case_count": 16,
        "expected_primary_evaluations": 256,
        "completed_primary_evaluations": 0,
        "cases": [],
        "checkpoint_reload": {"status": "not_started", "trials": {}},
        "baseline_action_replay": {
            "status": "not_started",
            "expected_pairs": 64,
            "checked_pairs": 0,
            "exact_action_pairs": 0,
            "exact_probability_pairs": 0,
            "checks": [],
        },
        "arms": {arm_id: {"status": "not_started", "completed_case_count": 0, "completed_evaluations": 0} for arm_id in SENSITIVITY_ARM_IDS},
        "derived_metrics": None,
        "derived_metrics_status": "unavailable_due_to_failure",
        "failures": [],
    }


def _markdown_value(value) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.6g}"
    return str(value)


def _summary_markdown(report: dict) -> str:
    lines = [
        "# v0.3 inspected-case mapping-transfer sensitivity inference",
        "",
        f"- Status: `{report.get('status')}`",
        f"- Completed primary evaluations: `{report.get('completed_primary_evaluations', 0)}/{report.get('expected_primary_evaluations', 256)}`",
        f"- Baseline action replay: `{report.get('baseline_action_replay', {}).get('status')}` ({report.get('baseline_action_replay', {}).get('checked_pairs', 0)}/64 pairs)",
        "",
        "All cases are now-inspected robustness cases, not fresh mapping evidence.",
        "The U and counterfactual-exposed partitions remain separate.",
        "",
        "## Resources and stopping",
        "",
        f"- Wall-clock: `{_markdown_value(report.get('runtime', {}).get('wall_clock_seconds'))}` / `{_markdown_value(report.get('runtime', {}).get('wall_clock_cap_seconds'))}` seconds.",
        f"- Additional memory: `{_markdown_value(report.get('runtime', {}).get('additional_high_water_kb'))}` / `{_markdown_value(report.get('runtime', {}).get('additional_memory_cap_kb'))}` KiB.",
        f"- Checkpoint normalization exact: `{report.get('preflight', {}).get('normalization_exact')}`.",
        "",
        "## Partition counts",
        "",
        "| partition | label | case records retained |",
        "|---|---|---:|",
    ]
    partition_counts = defaultdict(int)
    for case in report.get("cases", []):
        partition_counts[str(case.get("partition"))] += 1
    for partition in PARTITION_ORDER:
        label = PARTITION_LABELS[partition]
        lines.append(f"| {partition} | {label} | {partition_counts.get(partition, 0)} |")
    lines.extend(["", "## Baseline replay", ""])
    replay = report.get("baseline_action_replay", {})
    lines.append(
        f"Exact action pairs: `{replay.get('exact_action_pairs', 0)}/{replay.get('expected_pairs', 64)}`; "
        f"exact probability pairs: `{replay.get('exact_probability_pairs', 0)}/{replay.get('expected_pairs', 64)}`."
    )
    if report.get("failures"):
        lines.extend(["", "## Failures", ""])
        lines.extend(
            f"- `{item.get('phase')}` arm `{item.get('arm_id', 'n/a')}` case `{item.get('case_index', 'n/a')}` checkpoint `{item.get('checkpoint', 'n/a')}`: {item.get('error')}"
            for item in report["failures"]
        )
    if report.get("derived_metrics") is not None:
        lines.extend(["", "## Per-arm per-checkpoint metrics", "", "| arm | checkpoint | n | gate accuracy | frequency accuracy | joint accuracy | physical success | joint loss |", "|---|---|---:|---:|---:|---:|---:|---:|"])
        for arm_id in SENSITIVITY_ARM_IDS:
            for checkpoint, metrics in sorted(report["derived_metrics"][arm_id]["per_checkpoint"].items()):
                lines.append(
                    f"| {arm_id} | {checkpoint} | {_markdown_value(metrics.get('n'))} | "
                    f"{_markdown_value(metrics.get('gate_accuracy'))} | {_markdown_value(metrics.get('frequency_accuracy'))} | "
                    f"{_markdown_value(metrics.get('joint_accuracy'))} | {_markdown_value(metrics.get('physical_success'))} | "
                    f"{_markdown_value(metrics.get('joint_mean_loss'))} |"
                )
        lines.extend(["", "## Per-arm partition metrics", "", "| arm | checkpoint | partition | n | joint accuracy | physical success | joint loss |", "|---|---|---|---:|---:|---:|---:|"])
        for arm_id in SENSITIVITY_ARM_IDS:
            for checkpoint in sorted(report["derived_metrics"][arm_id]["per_partition"]):
                for partition, metrics in report["derived_metrics"][arm_id]["per_partition"][checkpoint].items():
                    lines.append(
                        f"| {arm_id} | {checkpoint} | {partition} | {_markdown_value(metrics.get('n'))} | "
                        f"{_markdown_value(metrics.get('joint_accuracy'))} | {_markdown_value(metrics.get('physical_success'))} | "
                        f"{_markdown_value(metrics.get('joint_mean_loss'))} |"
                    )
    else:
        lines.extend(["", "## Derived metrics", "", "Unavailable because the run stopped before the derived-metrics stage."])
    return "\n".join(lines) + "\n"


def run_sensitivity_inference(
    *,
    output_path: str | Path = SENSITIVITY_EVALUATION_REPORT_PATH,
    wall_clock_cap: float = WALL_CLOCK_CAP_SECONDS,
    additional_memory_cap_kb: int = ADDITIONAL_MEMORY_CAP_KB,
) -> dict:
    """Run the sealed sensitivity plan after independent review authorization."""

    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"refusing to overwrite sensitivity report: {output}")
    project_root = _project_root()
    start_wall = time.perf_counter()
    start_cpu = time.process_time()
    deadline = start_wall + float(wall_clock_cap)
    baseline_rss_kb = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    report = _empty_report(output, _source_sha())
    report.update({
        "wall_clock_cap_seconds": float(wall_clock_cap),
        "additional_memory_cap_kb": int(additional_memory_cap_kb),
        "evaluation_order": {
            "arm_order": list(SENSITIVITY_ARM_IDS),
            "checkpoint_order": list(CANDIDATE_EVALUATION_ORDER),
            "case_order": "sealed now-inspected case manifest order",
        },
    })
    failures = []
    case_results = {
        arm_id: {key: [] for key in CANDIDATE_EVALUATION_ORDER}
        for arm_id in SENSITIVITY_ARM_IDS
    }
    cases = []
    arms = []
    active_arm = None
    active_case = None
    active_checkpoint = None
    status = "partial_failure"
    try:
        design, design_sha = _load_sensitivity_design(project_root)
        baseline_report = _load_baseline_report(project_root, design)
        base_design, base_design_sha = _load_design(project_root)
        base_manifest = _validate_case_manifest(base_design)
        artifact_validation = _validate_frozen_artifacts(base_design, project_root)
        manifest = _validate_sensitivity_design(design, baseline_report, base_design)
        cases = manifest["cases"]
        arms = manifest["arms"]
        report["preregistration_sha256"] = design_sha
        report["preflight"] = {
            "sensitivity_design_sha256": design_sha,
            "baseline_design_sha256": base_design_sha,
            "baseline_report_sha256": EXPECTED_BASE_EVALUATION_REPORT_SHA256,
            "case_manifest_sha256": EXPECTED_CASE_MANIFEST_SHA256,
            "world_manifest_sha256": EXPECTED_WORLD_MANIFEST_SHA256,
            "normalization_exact": True,
            "normalization_digest": artifact_validation["normalization_digest"],
            "frozen_artifacts_verified": artifact_validation["screening_artifacts_verified"],
            "base_case_count": len(base_manifest["cases"]),
        }
        planned_counts = defaultdict(int)
        for case in cases:
            planned_counts[str(case["partition"])] += 1
        report["planned_case_partition_counts"] = dict(planned_counts)
        models = {}
        for key in CANDIDATE_EVALUATION_ORDER:
            _budget_check(
                deadline=deadline,
                baseline_rss_kb=baseline_rss_kb,
                additional_memory_cap_kb=additional_memory_cap_kb,
                phase="checkpoint_reload",
            )
            frozen = FROZEN_INFERENCE_CHECKPOINTS[key]
            model, payload = _load_delayed_checkpoint(
                project_root / frozen["path"],
                model_class=MODEL_CLASSES[frozen["model_class"]],
                expected_label=frozen["label"],
                expected_seed=frozen["seed"],
                expected_normalization=base_design["normalization"]["candidate_shared_row"]["fixture"],
                expected_source_sha=frozen["expected_source_sha"],
                expected_gate_head=frozen["expected_gate_head"],
            )
            models[key] = model
            report["checkpoint_reload"]["trials"][key] = {
                "status": "passed",
                "normalization_exact": True,
                "payload_schema": payload["schema"],
                "source_sha": payload["source_sha"],
                "updates": payload["training"]["updates"],
            }
        report["checkpoint_reload"]["status"] = "passed"
        report["sensitivity_model_outcomes_loaded"] = True

        baseline_arm = arms[0]
        report["baseline_action_replay"]["status"] = "running"
        report["arms"][baseline_arm["id"]]["status"] = "running"
        for index, case in enumerate(cases):
            active_arm = baseline_arm
            active_case = case
            active_checkpoint = None
            _budget_check(
                deadline=deadline,
                baseline_rss_kb=baseline_rss_kb,
                additional_memory_cap_kb=additional_memory_cap_kb,
                phase="baseline_replay_case",
                case_index=index,
                completed_cases=index,
            )
            arm_case = _arm_case_report(report, case, baseline_arm)
            try:
                spec = _arm_spec(case, baseline_arm)
                episode, observations, schedule_audit = _prepare_sensitivity_episode(
                    spec, hidden_delay_steps=baseline_arm["hidden_delay_steps"]
                )
                prepared = {
                    "episode_snapshot": episode.snapshot(),
                    "policy_observations": observations,
                    "schedule_audit": schedule_audit,
                }
                expected_case = baseline_report["cases"][index]
                for key in CANDIDATE_EVALUATION_ORDER:
                    active_checkpoint = key
                    _budget_check(
                        deadline=deadline,
                        baseline_rss_kb=baseline_rss_kb,
                        additional_memory_cap_kb=additional_memory_cap_kb,
                        phase="baseline_replay_checkpoint",
                        case_index=index,
                        completed_cases=index,
                    )
                    run = run_delayed_episode(models[key], spec, prepared=prepared)
                    _attach_raw_arm_checkpoint_result(report, arm_case, key, run)
                    _budget_check(
                        deadline=deadline,
                        baseline_rss_kb=baseline_rss_kb,
                        additional_memory_cap_kb=additional_memory_cap_kb,
                        phase="baseline_replay_before_scoring",
                        case_index=index,
                        completed_cases=index,
                    )
                    expected_run = expected_case["results"][key]["raw_run"]
                    action_exact = _action_signature(run) == _action_signature(expected_run)
                    replay_check = {
                        "case_index": int(case["case_index"]),
                        "world_seed": int(case["world_seed"]),
                        "goal_index": int(case["goal_index"]),
                        "checkpoint": key,
                        "action_exact": bool(action_exact),
                        "probability_exact": bool(
                            run["gate_probabilities"] == expected_run["gate_probabilities"]
                            and run["frequency_probabilities"] == expected_run["frequency_probabilities"]
                        ),
                        "actual_run": copy.deepcopy(run),
                        "expected_run": copy.deepcopy(expected_run),
                    }
                    report["baseline_action_replay"]["checks"].append(replay_check)
                    report["baseline_action_replay"]["checked_pairs"] += 1
                    report["baseline_action_replay"]["exact_action_pairs"] += int(action_exact)
                    report["baseline_action_replay"]["exact_probability_pairs"] += int(replay_check["probability_exact"])
                    if not action_exact:
                        raise SensitivityInferenceError("baseline action replay mismatch")
                    scored = score_case_result(case, run)
                    _budget_check(
                        deadline=deadline,
                        baseline_rss_kb=baseline_rss_kb,
                        additional_memory_cap_kb=additional_memory_cap_kb,
                        phase="baseline_replay_before_attachment",
                        case_index=index,
                        completed_cases=index,
                    )
                    scored.update({
                        "arm_id": baseline_arm["id"],
                        "hidden_delay_steps": baseline_arm["hidden_delay_steps"],
                        "note_mode": baseline_arm["note_mode"],
                    })
                    _complete_arm_checkpoint_result(arm_case, key, scored)
                    case_results[baseline_arm["id"]][key].append(scored)
                arm_case["checkpoint_results_complete"] = True
            except InferenceDeadlineExceeded as exc:
                failures.append(_failure_record(exc, phase=exc.phase, arm=baseline_arm, case=case, checkpoint=active_checkpoint))
                raise
            except Exception as exc:
                failures.append(_failure_record(exc, phase="baseline_action_replay", arm=baseline_arm, case=case, checkpoint=active_checkpoint))
                raise
        report["baseline_action_replay"]["status"] = "passed"
        report["arms"][baseline_arm["id"]].update({
            "status": "complete",
            "completed_case_count": len(cases),
            "completed_evaluations": len(cases) * len(CANDIDATE_EVALUATION_ORDER),
        })

        for arm in arms[1:]:
            report["arms"][arm["id"]]["status"] = "running"
            for index, case in enumerate(cases):
                active_arm = arm
                active_case = case
                active_checkpoint = None
                _budget_check(
                    deadline=deadline,
                    baseline_rss_kb=baseline_rss_kb,
                    additional_memory_cap_kb=additional_memory_cap_kb,
                    phase="sensitivity_case",
                    case_index=index,
                    completed_cases=index,
                )
                arm_case = _arm_case_report(report, case, arm)
                try:
                    spec = _arm_spec(case, arm)
                    episode, observations, schedule_audit = _prepare_sensitivity_episode(
                        spec, hidden_delay_steps=arm["hidden_delay_steps"]
                    )
                    prepared = {
                        "episode_snapshot": episode.snapshot(),
                        "policy_observations": observations,
                        "schedule_audit": schedule_audit,
                    }
                    for key in CANDIDATE_EVALUATION_ORDER:
                        active_checkpoint = key
                        _budget_check(
                            deadline=deadline,
                            baseline_rss_kb=baseline_rss_kb,
                            additional_memory_cap_kb=additional_memory_cap_kb,
                            phase="sensitivity_checkpoint",
                            case_index=index,
                            completed_cases=index,
                        )
                        run = run_delayed_episode(models[key], spec, prepared=prepared)
                        _attach_raw_arm_checkpoint_result(report, arm_case, key, run)
                        _budget_check(
                            deadline=deadline,
                            baseline_rss_kb=baseline_rss_kb,
                            additional_memory_cap_kb=additional_memory_cap_kb,
                            phase="sensitivity_before_scoring",
                            case_index=index,
                            completed_cases=index,
                        )
                        scored = score_case_result(case, run)
                        _budget_check(
                            deadline=deadline,
                            baseline_rss_kb=baseline_rss_kb,
                            additional_memory_cap_kb=additional_memory_cap_kb,
                            phase="sensitivity_before_attachment",
                            case_index=index,
                            completed_cases=index,
                        )
                        scored.update({
                            "arm_id": arm["id"],
                            "hidden_delay_steps": arm["hidden_delay_steps"],
                            "note_mode": arm["note_mode"],
                        })
                        _complete_arm_checkpoint_result(arm_case, key, scored)
                        case_results[arm["id"]][key].append(scored)
                    arm_case["checkpoint_results_complete"] = True
                except InferenceDeadlineExceeded as exc:
                    failures.append(_failure_record(exc, phase=exc.phase, arm=arm, case=case, checkpoint=active_checkpoint))
                    raise
                except Exception as exc:
                    failures.append(_failure_record(exc, phase="sensitivity_case", arm=arm, case=case, checkpoint=active_checkpoint))
                    raise
            report["arms"][arm["id"]].update({
                "status": "complete",
                "completed_case_count": len(cases),
                "completed_evaluations": len(cases) * len(CANDIDATE_EVALUATION_ORDER),
            })

        _budget_check(
            deadline=deadline,
            baseline_rss_kb=baseline_rss_kb,
            additional_memory_cap_kb=additional_memory_cap_kb,
            phase="derived_metrics_entry",
            completed_cases=len(cases),
        )
        derived = {}
        for arm_index, arm in enumerate(arms):
            arm_id = arm["id"]

            def stage_check(stage: str, *, arm_id=arm_id, arm_index=arm_index):
                _budget_check(
                    deadline=deadline,
                    baseline_rss_kb=baseline_rss_kb,
                    additional_memory_cap_kb=additional_memory_cap_kb,
                    phase=f"derived_metrics_{arm_id}_{stage}",
                    completed_cases=arm_index,
                )

            derived[arm_id] = _metric_groups(case_results[arm_id], stage_check=stage_check)
            _budget_check(
                deadline=deadline,
                baseline_rss_kb=baseline_rss_kb,
                additional_memory_cap_kb=additional_memory_cap_kb,
                phase=f"between_arm_derived_metrics_{arm_id}",
                completed_cases=arm_index + 1,
            )
        _budget_check(
            deadline=deadline,
            baseline_rss_kb=baseline_rss_kb,
            additional_memory_cap_kb=additional_memory_cap_kb,
            phase="derived_metrics_before_complete",
            completed_cases=len(cases),
        )
        report["derived_metrics"] = derived
        report["derived_metrics_status"] = "complete"
        status = "complete"
    except InferenceDeadlineExceeded as exc:
        if not failures:
            failures.append(_failure_record(
                exc,
                phase=exc.phase,
                arm=active_arm,
                case=active_case,
                checkpoint=active_checkpoint,
            ))
        status = "partial_wall_clock_cap" if time.perf_counter() >= deadline else "partial_memory_cap"
        if exc.phase.startswith("checkpoint_reload"):
            report["checkpoint_reload"]["status"] = status
        if active_arm is not None and not (
            exc.phase.startswith("derived_metrics_")
            or exc.phase.startswith("between_arm_derived_metrics_")
        ):
            _refresh_arm_progress(report, active_arm["id"], status=status)
        report["baseline_action_replay"]["status"] = (
            report["baseline_action_replay"]["status"]
            if report["baseline_action_replay"]["status"] == "passed"
            else "partial"
        )
        report["derived_metrics_status"] = "unavailable_budget_exhausted"
    except Exception as exc:
        if not failures:
            failures.append(_failure_record(
                exc,
                phase="preflight_or_inference",
                arm=active_arm,
                case=active_case,
                checkpoint=active_checkpoint,
            ))
        status = "partial_failure"
        if report["baseline_action_replay"]["status"] == "running":
            report["baseline_action_replay"]["status"] = "partial"
        if active_arm is not None:
            _refresh_arm_progress(report, active_arm["id"], status="partial_failure")
        report["derived_metrics_status"] = "unavailable_due_to_failure"

    report["status"] = status
    report["failures"] = failures
    report["runtime"] = {
        "wall_clock_cap_seconds": float(wall_clock_cap),
        "wall_clock_seconds": float(time.perf_counter() - start_wall),
        "process_cpu_seconds": float(time.process_time() - start_cpu),
        "additional_memory_cap_kb": int(additional_memory_cap_kb),
        "max_rss_kb": int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss),
        "baseline_rss_kb": int(baseline_rss_kb),
        "additional_high_water_kb": max(0, int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) - baseline_rss_kb),
        "within_wall_clock_cap": bool(time.perf_counter() - start_wall <= wall_clock_cap),
        "single_cpu_process": True,
        "python": platform.python_version(),
    }
    _atomic_write_json(output, report)
    _atomic_write_text(output.with_suffix(".md"), _summary_markdown(report))
    return report


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=SENSITIVITY_EVALUATION_REPORT_PATH)
    parser.add_argument("--wall-clock-cap", type=float, default=WALL_CLOCK_CAP_SECONDS)
    parser.add_argument("--additional-memory-cap-kb", type=int, default=ADDITIONAL_MEMORY_CAP_KB)
    args = parser.parse_args()
    report = run_sensitivity_inference(
        output_path=args.output,
        wall_clock_cap=args.wall_clock_cap,
        additional_memory_cap_kb=args.additional_memory_cap_kb,
    )
    print(json.dumps({
        "schema": report["schema"],
        "status": report["status"],
        "completed_primary_evaluations": report["completed_primary_evaluations"],
        "baseline_action_replay": report["baseline_action_replay"]["status"],
        "failures": len(report["failures"]),
        "runtime": report.get("runtime"),
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
