"""Write a source-only preregistration for inspected-case delay sensitivity.

This module freezes four inference-only arms over the already completed
16-case mapping-transfer manifest.  It does not load model weights, prepare a
variant episode, or execute any sensitivity outcome.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

from .v03_fresh_mapping_inference import (
    EXPECTED_CASE_MANIFEST_SHA256,
    EXPECTED_WORLD_MANIFEST_SHA256,
)
from .v03_fresh_mapping_preregistration import (
    FRESH_EVALUATION_REPORT_PATH,
    FRESH_EVALUATION_SUMMARY_PATH,
    FROZEN_CANDIDATE_CHECKPOINTS,
    OUTPUT_PATH as FRESH_PREREGISTRATION_PATH,
    PARTITION_DISJOINT_COUNTERFACTUAL,
    PARTITION_DISJOINT_NEVER,
    PARTITION_DISJOINT_PRIOR,
    PARTITION_SEEN_TRAINING,
)
from .v03_protocol import CorrectedEpisode, PROBE_FREQUENCIES


OUTPUT_PATH = Path("reports/generated/v03-neural-fresh-mapping-transfer-sensitivity-preregistration.json")
DOC_PATH = Path("docs/PREREGISTRATION_V03_FRESH_MAPPING_TRANSFER_SENSITIVITY.md")
SENSITIVITY_EVALUATION_REPORT_PATH = "reports/generated/v03-neural-fresh-mapping-transfer-sensitivity-evaluation.json"
SENSITIVITY_EVALUATION_SUMMARY_PATH = "reports/generated/v03-neural-fresh-mapping-transfer-sensitivity-evaluation.md"

BASE_PREREGISTRATION_PATH = str(FRESH_PREREGISTRATION_PATH)
BASE_EVALUATION_REPORT_PATH = FRESH_EVALUATION_REPORT_PATH
BASE_EVALUATION_SUMMARY_PATH = FRESH_EVALUATION_SUMMARY_PATH
BASE_PREREGISTRATION_SHA256 = "e6007b00c892d1da142f2da80c31edd673e367474e8d46fc0fac90c3e500bc32"
BASE_EVALUATION_REPORT_SHA256 = "960d39ed8e13b0713509f7829b186b980ebfe1c989ca6ee4fa33bb83d77f97e4"
BASE_EVALUATION_SUMMARY_SHA256 = "b1d6502e5642fbd7a553c7ee1f4a6f92b99144f80863dff345962d4ddd7cf951"
BASE_EVALUATION_SOURCE_SHA = "19f317e19de203dd0bb1142c4a347ac30e183332"

BASELINE_HIDDEN_DELAY_STEPS = 2
SENSITIVITY_DELAY_STEPS = (2, 4, 8)
SENSITIVITY_ARM_IDS = (
    "baseline_existing_delay",
    "hidden_delay_4",
    "hidden_delay_8",
    "note_format_variant_baseline_delay",
)
NOTE_FORMAT_VARIANT_TEMPLATE = (
    "target_hz={goal_frequency:.2f}; rule=max-response-at-target; "
    "target_phase=0.00; variant=delayed-train"
)
SENSITIVITY_PARTITION_LABELS = {
    PARTITION_SEEN_TRAINING: "seen-training mapping; zero planned cases",
    PARTITION_DISJOINT_PRIOR: "training-disjoint previously inspected mapping; zero planned cases",
    PARTITION_DISJOINT_NEVER: "globally never-inspected U mapping, now inspected by baseline; not fresh evidence",
    PARTITION_DISJOINT_COUNTERFACTUAL: "counterfactually exposed mapping, now inspected by baseline; not fresh evidence",
}
ADDITIONAL_MEMORY_CAP_KB = 512 * 1024
WALL_CLOCK_CAP_SECONDS = 300.0


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


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


def _digest(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    ).hexdigest()


def _file_digest(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def _json_copy(value):
    return json.loads(json.dumps(value, sort_keys=True, allow_nan=False))


def _load_base_design_and_report() -> tuple[dict, dict]:
    root = _project_root()
    prereg_path = root / BASE_PREREGISTRATION_PATH
    report_path = root / BASE_EVALUATION_REPORT_PATH
    summary_path = root / BASE_EVALUATION_SUMMARY_PATH
    if _file_digest(prereg_path) != BASE_PREREGISTRATION_SHA256:
        raise AssertionError("completed baseline preregistration digest changed")
    if _file_digest(report_path) != BASE_EVALUATION_REPORT_SHA256:
        raise AssertionError("completed baseline evaluation report digest changed")
    if _file_digest(summary_path) != BASE_EVALUATION_SUMMARY_SHA256:
        raise AssertionError("completed baseline evaluation summary digest changed")
    design = json.loads(prereg_path.read_text(encoding="utf-8"))
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("status") != "complete":
        raise AssertionError("sensitivity acceptance requires a complete baseline evaluation")
    if report.get("completed_case_count") != 16 or report.get("completed_row_relabel_count") != 1536:
        raise AssertionError("sensitivity acceptance requires the complete baseline case and row checks")
    if report.get("failures"):
        raise AssertionError("sensitivity acceptance requires a baseline with no failures")
    if report.get("source_sha") != BASE_EVALUATION_SOURCE_SHA:
        raise AssertionError("completed baseline evaluation source SHA changed")
    return design, report


def _case_manifest(base_design: dict, baseline_report: dict) -> list[dict]:
    cases = _json_copy(base_design["case_plan"]["cases"])
    if len(cases) != 16 or _digest(cases) != EXPECTED_CASE_MANIFEST_SHA256:
        raise AssertionError("baseline case manifest is not the accepted 16-case manifest")
    worlds = base_design["fresh_world_selection"]["worlds"]
    if _digest(worlds) != EXPECTED_WORLD_MANIFEST_SHA256:
        raise AssertionError("baseline world manifest is not the accepted world manifest")
    report_cases = baseline_report.get("cases")
    if not isinstance(report_cases, list) or len(report_cases) != len(cases):
        raise AssertionError("baseline report case count does not match the frozen manifest")
    for expected, actual in zip(cases, report_cases):
        for field in ("case_index", "world_seed", "goal_index", "partition", "frequency_to_gate"):
            if actual.get(field) != expected.get(field):
                raise AssertionError(f"baseline report case identity changed for {field}")
    return cases


def _partition_summary(cases: list[dict]) -> dict:
    result = {}
    for partition in (
        PARTITION_SEEN_TRAINING,
        PARTITION_DISJOINT_PRIOR,
        PARTITION_DISJOINT_NEVER,
        PARTITION_DISJOINT_COUNTERFACTUAL,
    ):
        selected = [case for case in cases if case["partition"] == partition]
        result[partition] = {
            "label": SENSITIVITY_PARTITION_LABELS[partition],
            "case_count": len(selected),
            "world_seeds": sorted({int(case["world_seed"]) for case in selected}),
            "mapping_tuples": sorted({
                tuple(int(value) for value in case["frequency_to_gate"])
                for case in selected
            }),
            "now_inspected": True,
            "fresh_mapping_evidence": False,
        }
    return result


def _arm_definitions(base_design: dict) -> list[dict]:
    original_template = str(base_design["protocol"]["note_format_template"])
    arms = [
        {
            "arm_index": 0,
            "id": "baseline_existing_delay",
            "label": "baseline existing two hidden delays",
            "hidden_delay_steps": BASELINE_HIDDEN_DELAY_STEPS,
            "hidden_delay_steps_relative_to_current_two": 0,
            "note_mode": "original_delayed_train_note",
            "note_format_template": original_template,
            "meaning_preserving_note_variant": False,
        },
        {
            "arm_index": 1,
            "id": "hidden_delay_4",
            "label": "four hidden delay steps",
            "hidden_delay_steps": 4,
            "hidden_delay_steps_relative_to_current_two": 2,
            "note_mode": "original_delayed_train_note",
            "note_format_template": original_template,
            "meaning_preserving_note_variant": False,
        },
        {
            "arm_index": 2,
            "id": "hidden_delay_8",
            "label": "eight hidden delay steps",
            "hidden_delay_steps": 8,
            "hidden_delay_steps_relative_to_current_two": 6,
            "note_mode": "original_delayed_train_note",
            "note_format_template": original_template,
            "meaning_preserving_note_variant": False,
        },
        {
            "arm_index": 3,
            "id": "note_format_variant_baseline_delay",
            "label": "fixed meaning-preserving note-format variant with baseline delay",
            "hidden_delay_steps": BASELINE_HIDDEN_DELAY_STEPS,
            "hidden_delay_steps_relative_to_current_two": 0,
            "note_mode": "reordered_semantic_fields",
            "note_format_template": NOTE_FORMAT_VARIANT_TEMPLATE,
            "meaning_preserving_note_variant": True,
        },
    ]
    if tuple(item["id"] for item in arms) != SENSITIVITY_ARM_IDS:
        raise AssertionError("sensitivity arm order changed")
    return arms


def build_preregistration() -> dict:
    """Build the source-only, review-gated sensitivity design."""

    base_design, baseline_report = _load_base_design_and_report()
    cases = _case_manifest(base_design, baseline_report)
    arms = _arm_definitions(base_design)
    candidate_keys = sorted(FROZEN_CANDIDATE_CHECKPOINTS)
    case_partitions = _partition_summary(cases)
    normalization = _json_copy(base_design["normalization"]["candidate_shared_row"])
    return {
        "schema": "vevo.v03.neural-fresh-mapping-transfer-sensitivity-preregistration.v1",
        "status": "awaiting_independent_review_before_sensitivity_evaluation",
        "source_sha_at_registration": _source_sha(),
        "training_started": False,
        "evaluation_started": False,
        "sensitivity_cases_evaluated": 0,
        "sensitivity_model_outcomes_loaded": False,
        "question": (
            "How robust are the accepted frozen candidate policies on the now-inspected 16-case "
            "mapping-transfer manifest under predeclared delay-count and note-format sensitivity arms?"
        ),
        "scope_boundary": {
            "source_only": True,
            "inference_only": True,
            "no_new_training": True,
            "no_normalization_fitting": True,
            "same_four_candidate_checkpoints_only": True,
            "same_16_now_inspected_cases_only": True,
            "same_goals_physics_and_budgets": True,
            "prior_exposure_partitions_reported_separately": True,
            "not_fresh_mapping_evidence": True,
            "not_general_agent_evidence": True,
            "no_variant_outcomes_loaded_at_preregistration": True,
        },
        "baseline_evaluation_identity": {
            "report_path": BASE_EVALUATION_REPORT_PATH,
            "report_sha256": BASE_EVALUATION_REPORT_SHA256,
            "summary_path": BASE_EVALUATION_SUMMARY_PATH,
            "summary_sha256": BASE_EVALUATION_SUMMARY_SHA256,
            "source_sha": BASE_EVALUATION_SOURCE_SHA,
            "preregistration_path": BASE_PREREGISTRATION_PATH,
            "preregistration_sha256": BASE_PREREGISTRATION_SHA256,
            "case_manifest_sha256": EXPECTED_CASE_MANIFEST_SHA256,
            "world_manifest_sha256": EXPECTED_WORLD_MANIFEST_SHA256,
            "status": "complete",
            "case_count": 16,
            "candidate_checkpoint_count": len(candidate_keys),
            "baseline_primary_evaluations": 64,
            "baseline_row_relabel_checks": 1536,
        },
        "frozen_candidate_checkpoints": {
            key: _json_copy(base_design["frozen_checkpoints"][key])
            for key in candidate_keys
        },
        "normalization": {
            "candidate_shared_row": normalization,
            "fit_during_sensitivity_evaluation": False,
            "exact_checkpoint_payload_normalization_required": True,
        },
        "case_manifest": cases,
        "case_partitions": case_partitions,
        "arms": arms,
        "protocol_contract": {
            "episode_class": "CorrectedEpisode",
            "baseline_hidden_delay_steps": BASELINE_HIDDEN_DELAY_STEPS,
            "delay_definition": (
                "hidden goal-independent observations after the one shown note and before the "
                "spectrum/action observation; current baseline has exactly two"
            ),
            "note_payload_masks_baseline": [0, 1, 0, 0, 0],
            "same_probe_frequencies_hz": [float(value) for value in PROBE_FREQUENCIES],
            "same_work_budget": float(CorrectedEpisode.WORK_BUDGET),
            "same_max_physics_steps": int(CorrectedEpisode.MAX_PHYSICS_STEPS),
            "same_tool_budget": int(CorrectedEpisode.MAX_TOOL_CALLS),
            "same_virtual_step_budget": int(CorrectedEpisode.VIRTUAL_STEP_BUDGET),
            "same_virtual_work_budget": float(CorrectedEpisode.VIRTUAL_WORK_BUDGET),
            "same_goal_indices": list(range(len(PROBE_FREQUENCIES))),
            "same_gate_resonance_metadata": True,
            "same_action_and_success_scoring": True,
            "same_checkpoint_normalization": True,
        },
        "baseline_action_replay": {
            "required_before_variant_arms": True,
            "source_report_path": BASE_EVALUATION_REPORT_PATH,
            "source_report_sha256": BASE_EVALUATION_REPORT_SHA256,
            "candidate_checkpoint_keys": candidate_keys,
            "expected_case_checkpoint_pairs": 64,
            "compare_exact_fields": [
                "final_action.gate",
                "final_action.frequency_index",
                "final_action.frequency",
                "gate_probabilities",
                "frequency_probabilities",
            ],
            "on_mismatch": "stop_before_variant_arms_and_write_structured_partial_failure",
            "model_outcomes_used_for_arm_selection": False,
        },
        "metrics": {
            "primary_evaluation_count": 16 * len(candidate_keys) * len(arms),
            "per_arm": "report all four arms separately",
            "per_checkpoint": "gate, frequency, joint accuracy, physical success, and losses",
            "per_world": "aggregate the four goals for each of the four now-inspected worlds",
            "per_mapping": "aggregate each of the two exposed mapping tuples separately",
            "per_partition": "report U-now-inspected and counterfactual-exposed-now-inspected partitions separately",
            "paired_candidate_vs_legacy": False,
            "baseline_action_replay": "exact action/probability compatibility check against the completed baseline report",
            "fresh_mapping_claim": False,
        },
        "resource_budget": {
            "wall_clock_cap_seconds": WALL_CLOCK_CAP_SECONDS,
            "additional_memory_cap_kb": ADDITIONAL_MEMORY_CAP_KB,
            "single_cpu_process": True,
            "primary_evaluations": 256,
            "baseline_action_replay_pairs": 64,
            "maximum_delay_steps": 8,
            "no_retry_tuning_or_arm_substitution": True,
            "deadline_checks": [
                "before each arm",
                "before each case",
                "before each checkpoint evaluation",
                "between arms",
                "before each derived metric stage",
                "before marking the report complete",
            ],
            "no_metrics_after_budget_exhaustion": True,
        },
        "failure_and_cap_reporting": {
            "allowed_statuses": [
                "not_started",
                "complete",
                "partial_wall_clock_cap",
                "partial_memory_cap",
                "partial_failure",
            ],
            "preserve_completed_arm_case_checkpoint_prefix": True,
            "preserve_baseline_replay_prefix": True,
            "record_case_checkpoint_arm_identity": True,
            "record_failure_phase_identity_and_exception": True,
            "do_not_compute_later_metrics_after_cap_or_failure": True,
            "do_not_execute_variants_after_baseline_replay_mismatch": True,
        },
        "local_only_demo_integration_outline": {
            "status": "outline_only_not_executed",
            "accepted_policy": "one of the exact frozen candidate checkpoints after sensitivity review",
            "runtime": "single local CorrectedEpisode with the exact reviewed note, delay, measurement, action, and resource contract",
            "inputs": "only the existing policy observation whitelist; no evaluator targets or world internals",
            "tools": "existing bounded local resonance diagnostic only",
            "adaptation": "none; no fitting, online learning, tool expansion, or checkpoint mutation",
            "general_agent_claim": False,
            "new_permissions_or_external_actions": False,
        },
        "review_gates": [
            "Do not execute any sensitivity arm before independent review of this source-only record.",
            "Run baseline action replay first and stop before variants on any mismatch.",
            "Keep the 16 cases and all four candidate checkpoints fixed; no fresh cases or substitutions.",
            "Treat all cases as now-inspected robustness cases, not fresh mapping or generalization evidence.",
            "Keep the U and counterfactual-exposed prior partitions separate in every report.",
            "Keep exact train-only checkpoint normalization; fit nothing during sensitivity inference.",
            "Do not alter architecture, seeds, optimizer, schedule contract, physics, budgets, or checkpoints.",
        ],
        "prohibited_actions": [
            "new training",
            "PC training",
            "fresh mapping claims",
            "general-agent presentation",
            "new paid resources",
            "credentials or account permission changes",
            "merge",
            "deploy",
            "PR creation",
        ],
    }


def _atomic_write(path: Path, text: str) -> None:
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


def write_preregistration(*, output_path: str | Path = OUTPUT_PATH) -> dict:
    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"refusing to overwrite preregistration: {output}")
    result = build_preregistration()
    _atomic_write(output, json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(OUTPUT_PATH))
    args = parser.parse_args()
    result = write_preregistration(output_path=args.output)
    print(json.dumps({
        "schema": result["schema"],
        "status": result["status"],
        "evaluation_started": result["evaluation_started"],
        "sensitivity_cases_evaluated": result["sensitivity_cases_evaluated"],
        "primary_evaluations": result["metrics"]["primary_evaluation_count"],
        "arms": [arm["id"] for arm in result["arms"]],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
