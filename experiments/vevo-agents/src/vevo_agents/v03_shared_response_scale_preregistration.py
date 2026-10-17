"""Write the no-training preregistration for the shared-response-scale run."""

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
    _training_observations,
    build_delayed_examples,
    make_training_specs,
)
from .v03_model import (
    SHARED_RESPONSE_SCALING_METHOD,
    V03FiveBrain,
    V03SingleRecurrentMemory,
    fit_shared_max_abs_input_normalization,
)
from .v03_neural_repair import GRADIENT_CLIP_NORM, LEARNING_RATE


OUTPUT_PATH = Path("reports/generated/v03-neural-delayed-shared-response-scale-preregistration.json")
REPORT_PATH = "reports/generated/v03-neural-delayed-shared-response-scale-report.json"
CHECKPOINT_PREFIX = "v03-neural-delayed-shared-response-scale"
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
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def build_preregistration() -> dict:
    """Build a sealed design description without constructing trainable models."""

    training_examples = build_delayed_examples(make_training_specs())
    normalization = fit_shared_max_abs_input_normalization(_training_observations(training_examples))
    return {
        "schema": "vevo.v03.neural-delayed-shared-response-scale-preregistration.v1",
        "status": "awaiting_review_before_retraining",
        "source_sha_at_registration": _source_sha(),
        "question": "Does a train-only shared max-absolute scale for the 16 response coordinates improve delayed gate/frequency action selection without the legacy per-coordinate outlier amplification?",
        "hypothesis": "Replacing only the legacy response-block standardization with one positive train-fitted max-absolute scalar will preserve response ordering and reduce out-of-distribution response magnitudes on the eight new-world cases per seed; it is not expected to guarantee physical success or generalization.",
        "architecture": {
            "full_model_class": "V03FiveBrain",
            "control_model_class": "V03SingleRecurrentMemory",
            "full_brain_count": 5,
            "control_brain_count": 1,
            "full_parameter_count": int(V03FiveBrain(DELAYED_MODEL_SEEDS[0]).parameter_count()),
            "control_parameter_count": int(V03SingleRecurrentMemory(DELAYED_CONTROL_SEEDS[0]).parameter_count()),
            "architecture_unchanged": True,
            "historical_checkpoints_are_reference_only": True,
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
            "response_coordinate_count": 16,
            "response_scale": normalization["response_scaling"]["scale"],
            "centering": "none",
            "clipping": "none",
            "zero_invalid_fallback": normalization["response_scaling"]["zero_or_invalid_fallback_scale"],
            "normalization_digest": _digest(normalization),
            "normalization_fixture": normalization,
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
            "heldout_world_seeds": list(HELDOUT_WORLD_SEEDS),
            "development_world_seeds_inspected": list(HELDOUT_WORLD_SEEDS),
            "development_is_fresh_generalization": False,
            "development_label": "9300–9307 inspected development cases; never fresh generalization",
            "heldout_used_for_gradients": False,
            "heldout_used_for_hyperparameters": False,
            "heldout_used_for_checkpoint_selection": False,
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
            "post_outcome_retuning_or_restart": False,
            "exact_resume_required": False,
        },
        "compute_budget": {
            "single_process": True,
            "cpu_only": True,
            "wall_clock_cap_seconds_total": WALL_CLOCK_CAP_SECONDS,
            "deadline_enforcement": "cooperative",
            "deadline_overrun_possible": True,
            "deadline_overrun_note": "A currently running model operation or finalization can finish after the deadline; no asynchronous kill is used.",
            "elapsed_measurement_excludes_final_serialization": True,
            "elapsed_measurement_note": "The runner captures elapsed wall time before final JSON/Markdown serialization, so final filesystem serialization is outside that interval.",
            "one_blas_or_openmp_thread_guaranteed": False,
            "fixed_memory_ceiling_guaranteed": False,
            "bounded_trial_count": 4,
            "run_must_stop_for_review_if_cap_or_failure": True,
        },
        "training_gate": {
            "name": "all-four-models-8/8",
            "required_completed_trial_count": 4,
            "required_physical_successes_per_trial": len(training_examples),
            "description": "Development evaluation is permitted only when all four fixed trials complete within budget and each has 8/8 ordinary delayed training physical successes.",
            "development_is_not_fresh_generalization": True,
        },
        "runner_requirements": {
            "reload_new_checkpoints_before_evaluation": True,
            "verify_exact_serialized_normalization_before_evaluation": True,
            "verify_prediction_parity_before_evaluation": True,
            "include_development_loss": True,
            "include_per_case_historical_success_overlap": True,
            "write_markdown_summary": True,
            "deadline_checks_between_cases": True,
            "no_metrics_after_budget_exhaustion": True,
            "structured_partial_and_failure_reporting": True,
        },
        "separate_artifacts": {
            "report": REPORT_PATH,
            "summary": REPORT_PATH.replace(".json", ".md"),
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
            f"--checkpoint-prefix {CHECKPOINT_PREFIX}"
        ),
        "review_gates": [
            "Do not apply v2 normalization to any historical v1 checkpoint.",
            "Do not call the new result a repaired historical model; it is a separately retrained candidate.",
            "Refuse to overwrite the historical delayed-memory report or checkpoints.",
            "Verify serialized v2 normalization exactly round-trips before evaluating a trial.",
            "Report train/development gate, frequency, joint, physical success, development loss, and per-case historical success overlap.",
            "Label worlds 9300–9307 as inspected development cases, never fresh generalization.",
            "Do not use development outcomes for model selection, hyperparameters, or restarts.",
        ],
        "executed_trials": 0,
        "training_started": False,
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
        "response_scale": result["normalization"]["response_scale"],
        "execution_command_after_review": result["execution_command_after_review"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
