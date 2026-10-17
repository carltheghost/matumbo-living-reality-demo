"""Write the no-training preregistration for the shared row scorer.

The artifact produced here is a sealed design record.  It does not construct
or train a candidate checkpoint and it refuses to overwrite an existing file.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

from .v03_delayed_memory import (
    DELAYED_CONTROL_SEEDS,
    DELAYED_MODEL_SEEDS,
    DELAYED_TRAIN_WORLD_SEEDS,
    HELDOUT_WORLD_SEEDS,
    MAX_UPDATES,
    METRIC_STEPS,
    RETENTION_DELAY_STEPS,
    WALL_CLOCK_CAP_SECONDS,
    _training_observations,
    build_delayed_examples,
    make_training_specs,
)
from .v03_model import (
    GATE_HEAD_CHOICES,
    LEGACY_GATE_HEAD,
    RESPONSE_FEATURE_END,
    RESPONSE_FEATURE_START,
    SHARED_RESPONSE_SCALING_METHOD,
    SHARED_ROW_FEATURE_DIM,
    SHARED_ROW_GATE_HEAD,
    V03FiveBrain,
    V03SingleRecurrentMemory,
    fit_shared_max_abs_input_normalization,
)
from .v03_neural_repair import GRADIENT_CLIP_NORM, LEARNING_RATE


OUTPUT_PATH = Path("reports/generated/v03-neural-shared-row-scorer-preregistration.json")
REPORT_PATH = "reports/generated/v03-neural-shared-row-scorer-report.json"
SUMMARY_PATH = "reports/generated/v03-neural-shared-row-scorer-report.md"
CHECKPOINT_PREFIX = "v03-neural-shared-row-scorer"


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


def build_preregistration() -> dict:
    """Build the single, review-gated paired comparison design."""

    training_examples = build_delayed_examples(make_training_specs())
    normalization = fit_shared_max_abs_input_normalization(_training_observations(training_examples))
    full_legacy = V03FiveBrain(DELAYED_MODEL_SEEDS[0], gate_head=LEGACY_GATE_HEAD)
    full_shared = V03FiveBrain(DELAYED_MODEL_SEEDS[0], gate_head=SHARED_ROW_GATE_HEAD)
    control_legacy = V03SingleRecurrentMemory(DELAYED_CONTROL_SEEDS[0], gate_head=LEGACY_GATE_HEAD)
    control_shared = V03SingleRecurrentMemory(DELAYED_CONTROL_SEEDS[0], gate_head=SHARED_ROW_GATE_HEAD)
    return {
        "schema": "vevo.v03.neural-shared-row-scorer-preregistration.v1",
        "status": "awaiting_review_before_retraining",
        "source_sha_at_registration": _source_sha(),
        "training_started": False,
        "executed_trials": 0,
        "question": "Does replacing the legacy per-gate action matrix with one shared bilinear response-row scorer improve delayed gate selection while preserving row permutation symmetry and the existing frequency objective?",
        "hypothesis": "A single row-shared bilinear scorer conditioned on retained pre-final state will reduce the four-slot shortcut by forcing the same row scoring rule across physical response rows; this is a structural hypothesis, not a guarantee of physical success, causal slot use, phase inference, or fresh generalization.",
        "comparison_design": {
            "name": "one paired legacy-versus-shared-row-head comparison",
            "candidate_gate_head": SHARED_ROW_GATE_HEAD,
            "baseline_gate_head": LEGACY_GATE_HEAD,
            "paired_units": "same model class, model seed, optimizer seed, training examples, schedule, objective, and 1000-update budget",
            "fixed_trial_count": 4,
            "no_additional_factors": True,
            "no_sweep_or_tuning": True,
            "expanded_training_mappings": "deferred to a later separately reviewed design; this comparison uses only worlds 9200 and 9201",
        },
        "architecture": {
            "full_model_class": "V03FiveBrain",
            "control_model_class": "V03SingleRecurrentMemory",
            "full_brain_count": 5,
            "control_brain_count": 1,
            "legacy_gate_head": LEGACY_GATE_HEAD,
            "shared_gate_head": SHARED_ROW_GATE_HEAD,
            "full_legacy_parameter_count": int(full_legacy.parameter_count()),
            "full_shared_parameter_count": int(full_shared.parameter_count()),
            "full_parameter_delta": int(full_shared.parameter_count() - full_legacy.parameter_count()),
            "control_legacy_parameter_count": int(control_legacy.parameter_count()),
            "control_shared_parameter_count": int(control_shared.parameter_count()),
            "control_parameter_delta": int(control_shared.parameter_count() - control_legacy.parameter_count()),
            "shared_row_feature_shape": [4, SHARED_ROW_FEATURE_DIM],
            "full_retained_context_dim": 18,
            "control_retained_context_dim": 51,
            "shared_parameters": {
                "full": {
                    "W_shared_row_context": [SHARED_ROW_FEATURE_DIM, 18],
                    "w_shared_row": [SHARED_ROW_FEATURE_DIM],
                    "b_shared_row": [1],
                },
                "control": {
                    "W_shared_row_context": [SHARED_ROW_FEATURE_DIM, 51],
                    "w_shared_row": [SHARED_ROW_FEATURE_DIM],
                    "b_shared_row": [1],
                },
            },
            "parameter_change_explanation": "The legacy 4xcontext action matrix plus 4-vector bias is replaced by one row-shared bilinear context matrix, one row-feature vector, and one scalar bias. The scalar bias is common to every row and cancels in the gate softmax; it is retained for a stable serialized head schema.",
            "same_scoring_weights_per_physical_row": True,
            "per_gate_bias_or_embedding": False,
            "legacy_checkpoints_unchanged": True,
        },
        "head_input_and_information_scope": {
            "retained_context": "pre-final recurrent central/hidden state concatenated with the pre-final memory read",
            "row_features": "the current 4x4 response matrix, represented as four 4-feature rows",
            "row_invariant_context": True,
            "current_final_post_response_state_used_by_shared_head": False,
            "frequency_information": "Goal-frequency information may be carried in the retained state from the note and delay; inference receives no evaluator target, reference gate, or frequency label.",
            "current_frequency_index_injected": False,
            "phase_or_time_signal_added": False,
            "phase_or_time_statement": "Magnitude-only response measurements are not transformed into an invented phase or time signal.",
            "temporal_scope": "The retained state is recurrent, but the preregistration makes no slot-causality claim beyond the final response-hook permutation test.",
        },
        "normalization": {
            "mode": SHARED_RESPONSE_SCALING_METHOD,
            "schema": normalization["schema"],
            "fit_scope": "training observations from worlds 9200 and 9201 only",
            "fit_world_seeds": list(DELAYED_TRAIN_WORLD_SEEDS),
            "fit_goals_per_world": 4,
            "fit_example_count": len(training_examples),
            "fit_observation_count": len(_training_observations(training_examples)),
            "fit_response_observation_count": normalization["response_scaling"]["fit_observation_count"],
            "response_feature_indices": list(range(RESPONSE_FEATURE_START, RESPONSE_FEATURE_END)),
            "response_scale": normalization["response_scaling"]["scale"],
            "centering": "none",
            "clipping": "none",
            "normalization_digest": _digest(normalization),
            "normalization_fixture": normalization,
            "legacy_normalization_rejected_for_candidate": True,
        },
        "schedule": {
            "name": "five-step delayed-memory schedule",
            "stages": [
                "before_note",
                "note_shown_once",
                "goal_independent_delay_1",
                "goal_independent_delay_2",
                "spectrum_and_action",
            ],
            "retention_delay_steps": RETENTION_DELAY_STEPS,
            "note_payload_masks": [0, 1, 0, 0, 0],
            "training_world_seeds": list(DELAYED_TRAIN_WORLD_SEEDS),
            "goals_per_world": 4,
            "training_examples": len(training_examples),
            "development_world_seeds_inspected": list(HELDOUT_WORLD_SEEDS),
            "development_is_fresh_generalization": False,
            "development_label": "9300–9307 inspected development cases; never fresh generalization",
            "development_used_for_gradients": False,
            "development_used_for_hyperparameters": False,
            "development_used_for_checkpoint_selection": False,
        },
        "seeds": {
            "full_model_seeds": list(DELAYED_MODEL_SEEDS),
            "control_seeds": list(DELAYED_CONTROL_SEEDS),
            "optimizer_seed_rule": "model_seed + 1000",
            "trials": [
                {
                    "label": "full",
                    "model_class": "V03FiveBrain",
                    "model_seed": int(seed),
                    "optimizer_seed": int(seed + 1000),
                }
                for seed in DELAYED_MODEL_SEEDS
            ] + [
                {
                    "label": "control",
                    "model_class": "V03SingleRecurrentMemory",
                    "model_seed": int(seed),
                    "optimizer_seed": int(seed + 1000),
                }
                for seed in DELAYED_CONTROL_SEEDS
            ],
        },
        "optimizer": {
            "method": "existing balanced size-one minibatch Adam-style reverse-mode update",
            "learning_rate": float(LEARNING_RATE),
            "gradient_clip_norm": float(GRADIENT_CLIP_NORM),
            "updates_per_trial": int(MAX_UPDATES),
            "metric_steps": list(METRIC_STEPS),
            "objective": "existing gate and frequency cross-entropy plus existing recurrent-weight regularization",
            "auxiliary_loss": False,
            "schedule_unchanged": True,
            "optimizer_unchanged": True,
            "post_outcome_retuning_or_restart": False,
        },
        "compute_budget": {
            "single_process": True,
            "cpu_only": True,
            "wall_clock_cap_seconds_total": float(WALL_CLOCK_CAP_SECONDS),
            "deadline_enforcement": "cooperative",
            "deadline_checks": ["between_updates", "between_cases", "between_derived_metric_stages"],
            "no_metrics_after_budget_exhaustion": True,
            "deadline_overrun_possible": True,
            "bounded_trial_count": 4,
            "run_must_stop_for_review_if_cap_or_failure": True,
        },
        "training_gate": {
            "name": "all-four-models-8/8",
            "required_completed_trial_count": 4,
            "required_physical_successes_per_trial": len(training_examples),
            "description": "Development evaluation is permitted only when all four fixed candidate trials complete within budget and each reaches 8/8 ordinary delayed training physical successes.",
            "explicitly_existing_gate": True,
            "development_is_not_fresh_generalization": True,
        },
        "runner_requirements": {
            "selectable_gate_head": True,
            "reload_new_checkpoints_before_evaluation": True,
            "verify_exact_serialized_normalization_before_evaluation": True,
            "verify_prediction_parity_before_evaluation": True,
            "include_development_loss": True,
            "include_per_case_historical_success_overlap": True,
            "write_markdown_summary": True,
            "deadline_checks_between_cases": True,
            "no_metrics_after_budget_exhaustion": True,
            "structured_partial_and_failure_reporting": True,
            "gradient_tests_required_before_training": True,
            "row_permutation_tests_required_before_training": True,
            "serialization_tests_required_before_training": True,
            "preprocessing_symmetry_audit_required_before_training": True,
            "no_evaluator_labels_in_inference": True,
        },
        "frozen_diagnostic_before_training": {
            "required": True,
            "input_report": "reports/generated/v03-neural-delayed-shared-response-scale-report.json",
            "scope": "training-world confusion/maps, model agreement, confidence/margins, success-set overlap, and final-response-hook row permutation on inspected development cases",
            "trained_shared_checkpoint_required": False,
            "untrained_structural_shared_head_replay_is_not_performance_evidence": True,
        },
        "separate_artifacts": {
            "report": REPORT_PATH,
            "summary": SUMMARY_PATH,
            "checkpoint_prefix": CHECKPOINT_PREFIX,
            "checkpoint_paths": [
                f"storage/checkpoints/{CHECKPOINT_PREFIX}-{label}-seed-{seed}.json"
                for label, seeds in (("full", DELAYED_MODEL_SEEDS), ("control", DELAYED_CONTROL_SEEDS))
                for seed in seeds
            ],
            "historical_artifacts_must_remain_byte_for_byte": True,
        },
        "execution_command_after_review": (
            "PYTHONPATH=src python -m vevo_agents.v03_delayed_memory "
            f"--output {REPORT_PATH} --wall-clock-cap {int(WALL_CLOCK_CAP_SECONDS)} "
            f"--response-scaling {SHARED_RESPONSE_SCALING_METHOD} "
            f"--gate-head {SHARED_ROW_GATE_HEAD} --checkpoint-prefix {CHECKPOINT_PREFIX}"
        ),
        "review_gates": [
            "Do not run the execution command until source review and the frozen diagnostic/tests are accepted.",
            "Do not apply v2 normalization to any historical v1 checkpoint.",
            "Do not call the candidate a repaired historical model; it is a separately retrained candidate.",
            "Refuse to overwrite the historical delayed-memory report or checkpoints.",
            "Verify serialized v2 normalization exactly round-trips before evaluating a trial.",
            "Report train/development gate, frequency, joint, physical success, development loss, and per-case historical success overlap.",
            "Label worlds 9300–9307 as inspected development cases, never fresh generalization.",
            "Do not use development outcomes for model selection, hyperparameters, or restarts.",
            "Do not add phase, time, frequency-selective resonance, or other unreviewed mechanisms to this paired comparison.",
            "Preserve architecture, seeds, schedule, optimizer, objective, and shared-scale preprocessing outside the controlled action head.",
        ],
        "allowed_actions": [
            "source review",
            "unit/integration tests",
            "frozen diagnostic replay",
            "one bounded paired retraining after explicit review",
        ],
        "prohibited_actions": [
            "PC training",
            "new paid resources",
            "credentials or account permission changes",
            "merge",
            "deploy",
            "PR creation",
            "expanded training mappings in this comparison",
        ],
        "allowed_gate_head_choices": list(GATE_HEAD_CHOICES),
    }


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(text)
            handle.flush()
        temporary.replace(path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def write_preregistration(*, output_path: str | Path = OUTPUT_PATH) -> dict:
    output = _project_root() / Path(output_path)
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
        "training_started": result["training_started"],
        "executed_trials": result["executed_trials"],
        "execution_command_after_review": result["execution_command_after_review"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
