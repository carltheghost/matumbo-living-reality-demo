"""Train and evaluate the smallest neural v0.3 integration experiment."""

from __future__ import annotations

from collections import Counter
import copy
import hashlib
import json
import resource
from pathlib import Path
import time

import numpy as np

from .v03_model import V03FiveBrain, V03SingleRecurrentMemory
from .v03_protocol import CorrectedEpisode, PROBE_FREQUENCIES
from .workspace import NoteWorkspace


MODEL_SEEDS = (7, 17)
CONTROL_SEEDS = (41, 43)
TRAIN_STEPS = 180
LEARNING_RATE = 0.012
VALIDATION_EVERY = 30
GOAL_VARIANTS = {
    "train": ("train", 0.00),
    "validation": ("validation", 0.35),
    "test": ("test", -0.35),
}
WORLD_SEEDS = {
    "train": tuple(range(6100, 6108)),
    "validation": tuple(range(6200, 6204)),
    "test": tuple(range(6300, 6312)),
}


def _json_digest(value) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(payload).hexdigest()


def _goal_note(goal_index: int, variant: str, phase: float) -> str:
    frequency = float(PROBE_FREQUENCIES[goal_index])
    return (
        f"target_hz={frequency:.2f}; target_phase={phase:.2f}; "
        f"rule=max-response-at-target; variant={variant}"
    )


def _gate_resonances(world_seed: int) -> np.ndarray:
    rng = np.random.default_rng(world_seed + 19001)
    return PROBE_FREQUENCIES[rng.permutation(len(PROBE_FREQUENCIES))]


def _episode_spec(split: str, world_seed: int, goal_index: int) -> dict:
    variant, phase = GOAL_VARIANTS[split]
    return {
        "split": split,
        "world_seed": int(world_seed),
        "goal_index": int(goal_index),
        "note_goal_id": f"{variant}-goal-{goal_index}",
        "note_text": _goal_note(goal_index, variant, phase),
        "gate_resonance_hz": _gate_resonances(world_seed).tolist(),
    }


def make_splits() -> dict[str, list[dict]]:
    return {
        split: [
            _episode_spec(split, world_seed, goal_index)
            for world_seed in WORLD_SEEDS[split]
            for goal_index in range(len(PROBE_FREQUENCIES))
        ]
        for split in WORLD_SEEDS
    }


def _prepare_policy_observations(spec: dict) -> tuple[CorrectedEpisode, list[dict]]:
    """Run the fixed schedule and retain only policy-observation copies."""

    episode = CorrectedEpisode(
        int(spec["world_seed"]),
        note_text=str(spec["note_text"]),
        gate_resonance_hz=np.asarray(spec["gate_resonance_hz"], dtype=np.float64),
    )
    episode.advance(np.zeros(4, dtype=np.float64))
    observations = [copy.deepcopy(episode.policy_observation())]
    episode.execute_note()
    observations.append(copy.deepcopy(episode.policy_observation()))
    episode.execute_diagnostic(0)
    observations.append(copy.deepcopy(episode.policy_observation()))
    return episode, observations


def build_examples(specs: list[dict], *, include_labels: bool = True) -> list[dict]:
    examples = []
    for spec in specs:
        episode, observations = _prepare_policy_observations(spec)
        if not episode.measurement or not episode.measurement.get("accepted"):
            raise RuntimeError("fixed diagnostic did not produce an accepted measurement")
        example = {
            "spec": copy.deepcopy(spec),
            "policy_observations": observations,
            "input_digest": _json_digest(observations),
        }
        if include_labels:
            # This is supervision construction only.  The evaluator never
            # calls oracle_action and never passes this label to raw_step.
            example["target_gate"] = int(episode.oracle_action())
            example["target_frequency"] = int(spec["goal_index"])
        examples.append(example)
    return examples


def _policy_keys(value) -> set[str]:
    if isinstance(value, dict):
        result = set(value)
        for child in value.values():
            result.update(_policy_keys(child))
        return result
    if isinstance(value, list):
        result = set()
        for child in value:
            result.update(_policy_keys(child))
        return result
    return set()


def policy_input_audit(examples: list[dict]) -> dict:
    forbidden = {
        "seed", "gate_resonance_hz", "calibration", "world_snapshot", "target",
        "target_gate", "oracle", "gate_x", "gate_v", "gate_energy", "q", "u", "du",
    }
    observed = set()
    for example in examples:
        for observation in example["policy_observations"]:
            observed.update(_policy_keys(observation))
    return {
        "forbidden_keys": sorted(forbidden),
        "observed_keys": sorted(observed),
        "forbidden_observed": sorted(forbidden.intersection(observed)),
        "passed": not forbidden.intersection(observed),
    }


def _wrong_note_text(spec: dict) -> str:
    wrong_goal = (int(spec["goal_index"]) + 1) % len(PROBE_FREQUENCIES)
    variant, phase = GOAL_VARIANTS[spec["split"]]
    return _goal_note(wrong_goal, f"intervention-{variant}", phase)


def _donor_measurement(spec: dict) -> dict:
    donor_spec = _episode_spec(
        "test",
        int(spec["world_seed"]) + 9000,
        int(spec["goal_index"]),
    )
    _, observations = _prepare_policy_observations(donor_spec)
    return copy.deepcopy(observations[2]["measurement"])


def _spec_key(spec: dict) -> tuple[str, int, str]:
    return (str(spec["split"]), int(spec["world_seed"]), str(spec["note_goal_id"]))


def _prepare_evaluation(spec: dict, *, include_donor: bool = False) -> dict:
    episode, observations = _prepare_policy_observations(spec)
    prepared = {
        "episode_snapshot": episode.snapshot(),
        "policy_observations": observations,
    }
    if include_donor:
        prepared["donor_measurement"] = _donor_measurement(spec)
    return prepared


def prepare_evaluations(specs: list[dict], *, include_donors: bool = False) -> dict:
    return {
        _spec_key(spec): _prepare_evaluation(spec, include_donor=include_donors)
        for spec in specs
    }


def run_episode(model, spec: dict, interventions: dict | None = None, *, prepared: dict | None = None) -> dict:
    """Run one evaluator episode without oracle calls or hidden input."""

    interventions = {} if interventions is None else dict(interventions)
    prepared = _prepare_evaluation(spec) if prepared is None else prepared
    episode = CorrectedEpisode.restore(copy.deepcopy(prepared["episode_snapshot"]))
    policy_observations = prepared["policy_observations"]
    runtime = model.initial_runtime()
    rows = []
    final_action = None

    for stage, base_policy_input in enumerate(policy_observations):
        policy_input = copy.deepcopy(base_policy_input)
        if interventions.get("wrong_note") and stage >= 1 and policy_input.get("note") is not None:
            policy_input["note"]["text"] = _wrong_note_text(spec)
        if interventions.get("shuffle_measurement") and stage == 2:
            donor_measurement = prepared.get("donor_measurement")
            if donor_measurement is None:
                donor_measurement = _donor_measurement(spec)
            policy_input["measurement"] = copy.deepcopy(donor_measurement)
        if interventions.get("memory_erase") and stage == 2:
            runtime = model.copy_runtime(runtime)
            runtime["memory"].fill(0.0)
        runtime, neural = model.raw_step(
            runtime,
            policy_input,
            erase_memory_before_action=bool(interventions.get("memory_erase") and stage == 2),
        )
        gate, drive_frequency, frequency_index = model.action_from_trace(neural)
        if stage == 0:
            result = episode.note_result or {"schema": "vevo.v03.note-result.v1", "accepted": False}
        elif stage == 1:
            # Initial milestone: probe scheduling is fixed and executor-owned;
            # this typed result was produced in the prepared authoritative
            # checkpoint before the neural action run.
            result = episode.measurement or {"schema": "vevo.v03.measurement-result.v1", "accepted": False}
        else:
            final_action = {
                "gate": int(gate),
                "frequency": float(drive_frequency),
                "frequency_index": int(frequency_index),
            }
            result = episode.execute_actuation(
                int(gate),
                enabled=not bool(interventions.get("disable_actuation")),
                drive_frequency=float(drive_frequency),
            )
        rows.append({
            "stage": stage,
            "selected_gate": int(gate),
            "selected_frequency": float(drive_frequency),
            "selected_frequency_index": int(frequency_index),
            "gate_probabilities": np.asarray(neural["gate_probs"]).tolist(),
            "frequency_probabilities": np.asarray(neural["frequency_probs"]).tolist(),
            "policy_input_digest": _json_digest(policy_input),
            "result_schema": result.get("schema", "vevo.v03.unknown"),
            "result_accepted": bool(result.get("accepted", False)),
            "result_error": result.get("error"),
        })

    success = bool(episode.success())
    if success:
        failure = None
    elif interventions.get("disable_actuation"):
        failure = "actuation_disabled"
    elif interventions.get("wrong_note"):
        failure = "wrong_note_input"
    elif interventions.get("shuffle_measurement"):
        failure = "shuffled_measurement_input"
    elif interventions.get("memory_erase"):
        failure = "neural_memory_erased"
    elif not episode.measurement or not episode.measurement.get("accepted"):
        failure = "diagnostic_failed"
    elif not episode.last_result or not episode.last_result.get("gate_opened"):
        failure = "physical_gate_not_opened"
    else:
        failure = "note_or_action_mismatch"
    return {
        "split": spec["split"],
        "world_seed": int(spec["world_seed"]),
        "note_goal_id": spec["note_goal_id"],
        "goal_index": int(spec["goal_index"]),
        "success": success,
        "failure": failure,
        "final_action": final_action,
        "rows": rows,
        "tool_calls": int(episode.tool_calls),
        "virtual_steps": int(episode.virtual_steps),
        "virtual_work": float(episode.virtual_work),
        "live_work_spent": float(episode.world.work_spent),
        "physics_steps": int(episode.world.physics_steps),
        "world_residual": float(episode.world.residual),
        "world_work": float(episode.world.work),
        "world_dissipated": float(episode.world.dissipated),
        "trajectory_digest": _json_digest(episode.snapshot()),
        "workspace_digest": episode.workspace.digest(),
    }


def _summary(runs: list[dict]) -> dict:
    failures = Counter(run["failure"] for run in runs if run["failure"] is not None)
    return {
        "n": len(runs),
        "successes": int(sum(bool(run["success"]) for run in runs)),
        "success_rate": float(np.mean([run["success"] for run in runs])) if runs else 0.0,
        "raw_successes": [bool(run["success"]) for run in runs],
        "failures": dict(sorted(failures.items())),
        "mean_live_work_spent": float(np.mean([run["live_work_spent"] for run in runs])) if runs else 0.0,
        "max_live_work_spent": float(max((run["live_work_spent"] for run in runs), default=0.0)),
        "max_physics_steps": int(max((run["physics_steps"] for run in runs), default=0)),
        "max_abs_world_residual": float(max((abs(run["world_residual"]) for run in runs), default=0.0)),
        "trajectory_digests": [run["trajectory_digest"] for run in runs],
    }


def evaluate(model, specs: list[dict], interventions: dict | None = None, *, prepared: dict | None = None) -> dict:
    runs = [
        run_episode(
            model,
            spec,
            interventions,
            prepared=None if prepared is None else prepared[_spec_key(spec)],
        )
        for spec in specs
    ]
    return {"summary": _summary(runs), "runs": runs}


def train_trials(model_class, seeds: tuple[int, ...], train_examples: list[dict], validation_examples: list[dict], *, steps: int) -> tuple[object, list[dict]]:
    trials = []
    for model_seed in seeds:
        model = model_class(model_seed)
        result = model.train(
            train_examples,
            validation_examples,
            steps=steps,
            learning_rate=LEARNING_RATE,
            seed=model_seed + 1000,
            validation_every=VALIDATION_EVERY,
        )
        trials.append({
            "model_seed": int(model_seed),
            "optimizer_seed": int(model_seed + 1000),
            "parameter_count": model.parameter_count(),
            "brain_count": model.brain_count,
            "memory_shape": list(model.central_memory_shape),
            "best_step": int(result.best_step),
            "best_validation_loss": float(result.best_validation_loss),
            "best_validation_accuracy": float(result.best_validation_accuracy),
            "history": result.history,
            "model": model,
        })
    best = min(trials, key=lambda item: item["best_validation_loss"])
    return best["model"], trials


def gradient_checks(model, example: dict) -> dict:
    observations = example["policy_observations"]
    loss, gradients, memory_gradient, _ = model.loss_and_gradients(
        observations,
        target_gate=example["target_gate"],
        target_frequency=example["target_frequency"],
    )
    epsilon = 1e-5
    checks = {}
    names = [name for name in model.parameter_names() if name.endswith("W_in")]
    for name in names:
        plus = model.clone()
        minus = model.clone()
        index = (0, 0)
        plus.params[name][index] += epsilon
        minus.params[name][index] -= epsilon
        plus_loss = plus.loss_only(observations, target_gate=example["target_gate"], target_frequency=example["target_frequency"])
        minus_loss = minus.loss_only(observations, target_gate=example["target_gate"], target_frequency=example["target_frequency"])
        numeric = (plus_loss - minus_loss) / (2.0 * epsilon)
        analytic = float(gradients[name][index])
        checks[name] = {
            "analytic": analytic,
            "finite_difference": numeric,
            "relative_error": abs(analytic - numeric) / max(1e-8, abs(analytic) + abs(numeric)),
            "gradient_norm": float(np.linalg.norm(gradients[name])),
        }
    initial = np.zeros(model.central_memory_shape, dtype=np.float64)
    plus_initial = initial.copy()
    minus_initial = initial.copy()
    plus_initial[0, 0] += epsilon
    minus_initial[0, 0] -= epsilon
    plus_loss = model.loss_and_gradients(
        observations,
        target_gate=example["target_gate"],
        target_frequency=example["target_frequency"],
        initial_memory=plus_initial,
    )[0]
    minus_loss = model.loss_and_gradients(
        observations,
        target_gate=example["target_gate"],
        target_frequency=example["target_frequency"],
        initial_memory=minus_initial,
    )[0]
    numeric = (plus_loss - minus_loss) / (2.0 * epsilon)
    analytic = float(memory_gradient[0, 0])
    checks["memory.initial"] = {
        "analytic": analytic,
        "finite_difference": numeric,
        "relative_error": abs(analytic - numeric) / max(1e-8, abs(analytic) + abs(numeric)),
        "gradient_norm": float(np.linalg.norm(memory_gradient)),
    }
    return {
        "loss": float(loss),
        "checks": checks,
        "all_finite": all(np.isfinite(item["analytic"]) and np.isfinite(item["finite_difference"]) for item in checks.values()),
        "all_brain_paths_nonzero": all(item["gradient_norm"] > 1e-12 for name, item in checks.items() if name != "memory.initial"),
        "all_within_1e-3": all(item["relative_error"] < 1e-3 for item in checks.values()),
    }


def center_input_dependency_check(model, example: dict) -> dict:
    observations = example["policy_observations"]
    runtime = model.initial_runtime()
    for observation in observations[:2]:
        runtime, _ = model.raw_step(runtime, observation)
    _, original = model.raw_step(runtime, observations[2])

    changed_note = copy.deepcopy(observations[2])
    changed_note["note"]["text"] = "target_hz=1.15; target_phase=0.00; rule=max-response-at-target"
    _, note_trace = model.raw_step(runtime, changed_note)

    changed_measurement = copy.deepcopy(observations[2])
    changed_measurement["measurement"]["channel_response"] = np.zeros((4, 4)).tolist()
    _, measurement_trace = model.raw_step(runtime, changed_measurement)
    return {
        "note_changes_center": bool(not np.allclose(original["central"], note_trace["central"])),
        "measurement_changes_center": bool(not np.allclose(original["central"], measurement_trace["central"])),
    }


def checkpoint_replay_check(model, spec: dict) -> dict:
    original = run_episode(model, spec)
    serialized_model = json.loads(json.dumps(model.state_dict(), sort_keys=True))
    reloaded = type(model)(model.seed)
    reloaded.load_state_dict(serialized_model)
    replay = run_episode(reloaded, spec)

    episode, observations = _prepare_policy_observations(spec)
    runtime = model.initial_runtime()
    for observation in observations:
        runtime, _ = model.raw_step(runtime, observation)
    runtime_state = json.loads(json.dumps(model.brain_snapshot(runtime), sort_keys=True))
    restored_runtime = model.restore_runtime(runtime_state)

    episode_state = json.loads(json.dumps(episode.snapshot(), sort_keys=True))
    restored_episode = CorrectedEpisode.restore(episode_state)
    episode_snapshot_equal = _json_digest(episode_state) == _json_digest(restored_episode.snapshot())
    final_gate = int(original["final_action"]["gate"])
    final_frequency = float(original["final_action"]["frequency"])
    episode_result = episode.execute_actuation(final_gate, drive_frequency=final_frequency)
    restored_result = restored_episode.execute_actuation(final_gate, drive_frequency=final_frequency)
    return {
        "model_state_roundtrip": _json_digest(model.state_dict()) == _json_digest(serialized_model),
        "replay_same_actions": [row["selected_gate"] for row in original["rows"]] == [row["selected_gate"] for row in replay["rows"]],
        "replay_same_frequencies": [row["selected_frequency_index"] for row in original["rows"]] == [row["selected_frequency_index"] for row in replay["rows"]],
        "replay_same_success": original["success"] == replay["success"],
        "replay_same_trajectory": original["trajectory_digest"] == replay["trajectory_digest"],
        "runtime_state_roundtrip": _json_digest(model.brain_snapshot(runtime)) == _json_digest(model.brain_snapshot(restored_runtime)),
        "episode_snapshot_roundtrip": episode_snapshot_equal,
        "episode_continuation_equal": _json_digest(episode.snapshot()) == _json_digest(restored_episode.snapshot()),
        "continuation_results_equal": episode_result == restored_result,
    }


def workspace_check() -> dict:
    workspace = NoteWorkspace()
    workspace.create("a", "A", "exact [[b]]", 0)
    workspace.create("b", "B", "delayed cue", 0)
    workspace.edit("a", "exact [[b]] revision two", 1, expected_revision=1)
    before = workspace.snapshot()
    restored = NoteWorkspace.restore(json.loads(json.dumps(before, sort_keys=True)))
    return {
        "fts5": workspace.fts_enabled,
        "search": workspace.search("revision two", exact=True),
        "outgoing": workspace.outgoing("a"),
        "backlinks": workspace.backlinks("b"),
        "events": [event["type"] for event in workspace.events],
        "snapshot_schema": before["schema"],
        "restore_equal": before == restored.snapshot(),
        "digest_equal": workspace.digest() == restored.digest(),
    }


def _trial_metadata(trials: list[dict]) -> list[dict]:
    return [{key: value for key, value in trial.items() if key != "model"} for trial in trials]


def _save_checkpoint(path: Path, model) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema": "vevo.v03.neural-checkpoint.v1",
        "model_class": type(model).__name__,
        "seed": int(model.seed),
        "brain_count": int(model.brain_count),
        "parameter_count": int(model.parameter_count()),
        "memory_shape": list(model.central_memory_shape),
        "state": model.state_dict(),
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return _json_digest(payload)


def run_proof(*, output_path: str | Path = "reports/generated/v03-neural-proof-report.json", steps: int = TRAIN_STEPS) -> dict:
    start = time.perf_counter()
    splits = make_splits()
    train_examples = build_examples(splits["train"])
    validation_examples = build_examples(splits["validation"])
    test_examples = build_examples(splits["test"])
    full_model, full_trials = train_trials(
        V03FiveBrain,
        MODEL_SEEDS,
        train_examples,
        validation_examples,
        steps=steps,
    )
    control_model, control_trials = train_trials(
        V03SingleRecurrentMemory,
        CONTROL_SEEDS,
        train_examples,
        validation_examples,
        steps=steps,
    )
    test_specs = [example["spec"] for example in test_examples]
    prepared_test = prepare_evaluations(test_specs, include_donors=True)
    normal = evaluate(full_model, test_specs, prepared=prepared_test)
    control_eval = evaluate(control_model, test_specs, prepared=prepared_test)
    intervention_specs = {
        "wrong_note": {"wrong_note": True},
        "shuffled_measurement": {"shuffle_measurement": True},
        "neural_memory_erase": {"memory_erase": True},
        "actuation_disabled": {"disable_actuation": True},
    }
    interventions = {
        name: evaluate(full_model, test_specs, intervention, prepared=prepared_test)
        for name, intervention in intervention_specs.items()
    }

    output = Path(output_path)
    checkpoint_dir = Path(__file__).resolve().parents[2] / "storage" / "checkpoints"
    full_checkpoint = _save_checkpoint(checkpoint_dir / "v03-neural-full-selected.json", full_model)
    control_checkpoint = _save_checkpoint(checkpoint_dir / "v03-neural-control-selected.json", control_model)
    report = {
        "schema": "vevo.v03.neural-proof-report.v1",
        "scope": "note-plus-spectrum physical action selection on corrected v0.3",
        "contract_path": "docs/EXPERIMENT_CONTRACT_V03_NEURAL.md",
        "architecture": {
            "peripheral_brains": full_model.PERIPHERALS,
            "central_brains": 1,
            "total_brains": full_model.brain_count,
            "full_parameter_count": full_model.parameter_count(),
            "control_parameter_count": control_model.parameter_count(),
            "full_memory_shape": list(full_model.central_memory_shape),
            "control_memory_shape": list(control_model.central_memory_shape),
            "full_center": "gated recurrent state plus differentiable key/address/value memory",
            "control": "single recurrent controller with matched observations/memory/tools/budget",
            "policy_input": "copies of CorrectedEpisode.policy_observation() only",
        },
        "protocol": {
            "fixed_schedule": ["zero-drive advance", "instruction note lookup", "diagnostic port 0", "neural gate/frequency actuation"],
            "probe_frequencies": PROBE_FREQUENCIES.tolist(),
            "learned_action": ["gate choice", "explicit drive_frequency argument"],
            "executor_validates_action": True,
            "oracle_calls_during_evaluation": 0,
            "success": "authoritative CorrectedEpisode.success() within protocol budgets",
            "gradient_boundary": "neural recurrent/memory/action computation only; simulator/tools/store/evaluator outside gradient",
        },
        "splits": {
            "train_world_seeds": list(WORLD_SEEDS["train"]),
            "validation_world_seeds": list(WORLD_SEEDS["validation"]),
            "test_world_seeds": list(WORLD_SEEDS["test"]),
            "train_goal_ids": sorted({spec["note_goal_id"] for spec in splits["train"]}),
            "validation_goal_ids": sorted({spec["note_goal_id"] for spec in splits["validation"]}),
            "test_goal_ids": sorted({spec["note_goal_id"] for spec in splits["test"]}),
            "counts": {name: len(items) for name, items in splits.items()},
            "complete_worlds_disjoint": not (
                set(WORLD_SEEDS["train"]) & set(WORLD_SEEDS["validation"])
                or set(WORLD_SEEDS["train"]) & set(WORLD_SEEDS["test"])
                or set(WORLD_SEEDS["validation"]) & set(WORLD_SEEDS["test"])
            ),
            "goal_ids_disjoint": not (
                {spec["note_goal_id"] for spec in splits["train"]} & {spec["note_goal_id"] for spec in splits["validation"]}
                or {spec["note_goal_id"] for spec in splits["train"]} & {spec["note_goal_id"] for spec in splits["test"]}
                or {spec["note_goal_id"] for spec in splits["validation"]} & {spec["note_goal_id"] for spec in splits["test"]}
            ),
        },
        "training": {
            "method": "behavior cloning; final gate/frequency cross-entropy; Adam-style reverse-mode updates",
            "steps_per_trial": int(steps),
            "learning_rate": LEARNING_RATE,
            "validation_every": VALIDATION_EVERY,
            "gradient_clip_norm": 3.0,
            "full_trials": _trial_metadata(full_trials),
            "matched_control_trials": _trial_metadata(control_trials),
            "selected_full_model_seed": int(full_model.seed),
            "selected_control_model_seed": int(control_model.seed),
            "oracle_labels_only_for_supervision": True,
            "checkpoint_selection": "minimum validation loss",
            "checkpoints": {
                "full": {"path": str(checkpoint_dir / "v03-neural-full-selected.json"), "digest": full_checkpoint},
                "control": {"path": str(checkpoint_dir / "v03-neural-control-selected.json"), "digest": control_checkpoint},
            },
        },
        "input_audit": policy_input_audit(train_examples + validation_examples + test_examples),
        "normal": normal,
        "interventions": interventions,
        "matched_control": control_eval,
        "checks": {
            "gradient_checks": gradient_checks(full_model, test_examples[0]),
            "center_input_dependency": center_input_dependency_check(full_model, test_examples[0]),
            "checkpoint_replay": checkpoint_replay_check(full_model, test_specs[1]),
            "workspace": workspace_check(),
            "test_examples_have_accepted_measurements": all(
                bool(example["policy_observations"][2]["measurement"].get("accepted"))
                for example in test_examples
            ),
        },
        "budgets": {
            "normal_all_within_live_work": all(run["live_work_spent"] <= CorrectedEpisode.WORK_BUDGET + 1e-12 for run in normal["runs"]),
            "normal_all_within_physics": all(run["physics_steps"] <= CorrectedEpisode.MAX_PHYSICS_STEPS for run in normal["runs"]),
            "normal_all_within_virtual_steps": all(run["virtual_steps"] <= CorrectedEpisode.VIRTUAL_STEP_BUDGET for run in normal["runs"]),
            "normal_all_within_virtual_work": all(run["virtual_work"] <= CorrectedEpisode.VIRTUAL_WORK_BUDGET + 1e-12 for run in normal["runs"]),
        },
        "runtime": {
            "seconds": time.perf_counter() - start,
            "max_rss_kb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "failures": [],
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return report


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="reports/generated/v03-neural-proof-report.json")
    parser.add_argument("--steps", type=int, default=TRAIN_STEPS)
    args = parser.parse_args()
    report = run_proof(output_path=args.output, steps=args.steps)
    print(json.dumps({
        "schema": report["schema"],
        "normal": report["normal"]["summary"],
        "matched_control": report["matched_control"]["summary"],
        "interventions": {name: value["summary"] for name, value in report["interventions"].items()},
        "runtime": report["runtime"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
