"""Run the interactive v0.2 proof and emit reviewable evidence."""

from __future__ import annotations

from collections import Counter
import copy
import hashlib
import json
from pathlib import Path
import resource
import time

import numpy as np

from .model import FiveBrain
from .physics import ResonantWorld, finite_difference_force_error
from .v02_model import V02Brain, V02SingleRecurrentNoMemory
from .v02_protocol import V02Episode, teacher_trace
from .workspace import NoteWorkspace


TRAIN_SEEDS = (24, 8, 16)
TRAIN_STEPS = 360
MODEL_SEEDS = (7, 17, 29)
CONTROL_SEEDS = (41, 43, 47)
OPTIMIZER_SEED_OFFSET = 1000


def _balanced_seeds(start: int, count: int) -> list[int]:
    """Return non-overlapping seeds balanced on the hidden cue target."""

    buckets = {0: [], 1: []}
    for seed in range(start, start + 2048):
        target = ResonantWorld(seed=seed).target
        buckets[target].append(seed)
    result = []
    counts = [0, 0]
    for _ in range(count):
        target = 0 if counts[0] <= counts[1] else 1
        result.append(buckets[target].pop(0))
        counts[target] += 1
    return result


def make_splits() -> dict[str, list[int]]:
    return {
        "train": _balanced_seeds(100, TRAIN_SEEDS[0]),
        "validation": _balanced_seeds(1000, TRAIN_SEEDS[1]),
        "test": _balanced_seeds(2000, TRAIN_SEEDS[2]),
    }


def _json_digest(value) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(payload).hexdigest()


def _donor_diagnostic(seed: int, avoid_gate: int) -> tuple[np.ndarray, dict, int]:
    """Create a valid typed result from another episode for shuffle tests."""

    for offset in range(1, 128):
        donor_seed = seed + 7000 + offset
        donor = V02Episode(donor_seed)
        donor.advance(np.zeros(4))
        donor.execute_note(donor.note_action())
        donor.advance(np.zeros(4))
        result = donor.execute_diagnostic(donor.diagnostic_action())
        if result.get("target_gate", -1) != avoid_gate:
            return donor.observation_vector(result), result, donor_seed
    raise RuntimeError("could not find a distinct diagnostic donor")


def interactive_run(agent, seed: int, interventions: dict | None = None) -> dict:
    """Run one actual field -> note -> tool -> neural action episode."""

    interventions = {} if interventions is None else dict(interventions)
    episode = V02Episode(
        seed,
        stale=bool(interventions.get("stale_note", False)),
        wrong_note=bool(interventions.get("wrong_note", False)),
    )
    runtime = agent.initial_runtime()
    drives = np.zeros(4, dtype=np.float64)
    previous_result = None
    rows = []
    donor_meta = None
    targets = [episode.note_action(), episode.diagnostic_action(), episode.actuation_action()]
    for stage in range(3):
        field_feedback = not bool(interventions.get("field_feedback_off", False))
        observation = episode.advance(drives, field_feedback=field_feedback)
        policy_observation = observation.copy()
        if not field_feedback and stage >= 1:
            policy_observation.fill(0.0)
        if bool(interventions.get("memory_erase", False)) and "memory" in runtime and stage >= 1:
            runtime["memory"].fill(0.0)
        tool_vector = episode.observation_vector(previous_result)
        if stage == 2 and bool(interventions.get("shuffle_diagnostic", False)):
            tool_vector, donor_result, donor_seed = _donor_diagnostic(seed, episode.true_mapping.target_gate)
            donor_meta = {
                "seed": donor_seed,
                "target_gate": int(donor_result["target_gate"]),
                "current_target_gate": int(episode.true_mapping.target_gate),
            }
        runtime, neural = agent.raw_step(
            runtime,
            policy_observation,
            stage,
            tool_vector,
            ablate=interventions.get("ablate_brain"),
            erase_memory_before_action=bool(interventions.get("memory_erase", False) and stage == 2),
        )
        selected = agent.action_from_trace(neural)
        if stage == 1 and "fixed_diagnostic_port" in interventions:
            selected = int(interventions["fixed_diagnostic_port"])
        if stage == 2 and "fixed_gate" in interventions:
            selected = int(interventions["fixed_gate"])
        result = episode.execute(
            stage,
            selected,
            actuation_enabled=not bool(interventions.get("disable_actuation", False)),
        )
        rows.append({
            "stage": stage,
            "target_action": int(targets[stage]),
            "selected_action": int(selected),
            "action_probs": np.asarray(neural["action_probs"]).tolist(),
            "tool_vector": np.asarray(tool_vector).tolist(),
            "result": result,
            "observation_norm": float(np.linalg.norm(policy_observation)),
            "port_drive_norm": float(np.linalg.norm(neural["port_drives"])),
        })
        drives = np.asarray(neural["port_drives"], dtype=np.float64)
        previous_result = result

    success = episode.success()
    if success:
        failure = None
    elif interventions.get("disable_actuation"):
        failure = "actuation_disabled"
    elif interventions.get("stale_note"):
        failure = "stale_note"
    elif interventions.get("wrong_note"):
        failure = "wrong_note"
    elif interventions.get("shuffle_diagnostic"):
        failure = "shuffled_diagnostic"
    elif not rows[1]["result"].get("diagnostic_ok", False):
        failure = "diagnostic_failed"
    else:
        failure = "wrong_gate"
    return {
        "seed": seed,
        "success": success,
        "failure": failure,
        "targets": targets,
        "selected_actions": [row["selected_action"] for row in rows],
        "rows": rows,
        "work_spent": float(episode.work_spent),
        "work_budget": episode.WORK_BUDGET,
        "physics_steps": episode.physics_steps,
        "physics_budget": episode.MAX_PHYSICS_STEPS,
        "world_residual": float(episode.world.residual),
        "world_work": float(episode.world.work),
        "world_dissipated": float(episode.world.dissipated),
        "trajectory_digest": _json_digest(episode.snapshot()),
        "donor": donor_meta,
        "snapshot": episode.snapshot(),
    }


def _summary(runs: list[dict]) -> dict:
    failures = Counter(run["failure"] for run in runs if run["failure"] is not None)
    return {
        "n": len(runs),
        "successes": int(sum(bool(run["success"]) for run in runs)),
        "success_rate": float(np.mean([run["success"] for run in runs])) if runs else 0.0,
        "failures": dict(sorted(failures.items())),
        "mean_work_spent": float(np.mean([run["work_spent"] for run in runs])) if runs else 0.0,
        "max_work_spent": float(max((run["work_spent"] for run in runs), default=0.0)),
        "max_physics_steps": int(max((run["physics_steps"] for run in runs), default=0)),
        "max_abs_world_residual": float(max((abs(run["world_residual"]) for run in runs), default=0.0)),
        "trajectory_digests": [run["trajectory_digest"] for run in runs],
    }


def evaluate(agent, seeds: list[int], interventions: dict | None = None) -> dict:
    runs = [interactive_run(agent, seed, interventions) for seed in seeds]
    return {"summary": _summary(runs), "runs": runs}


def train_trials(model_class, seeds: tuple[int, ...], splits: dict[str, list[int]], *, steps: int) -> tuple[object, list[dict]]:
    trials = []
    for model_seed in seeds:
        model = model_class(model_seed)
        result = model.train(
            splits["train"],
            splits["validation"],
            steps=steps,
            seed=model_seed + OPTIMIZER_SEED_OFFSET,
        )
        trials.append({
            "model_seed": model_seed,
            "optimizer_seed": model_seed + OPTIMIZER_SEED_OFFSET,
            "parameter_count": model.parameter_count(),
            "brain_count": model.brain_count,
            "best_step": result.best_step,
            "best_validation_loss": result.best_validation_loss,
            "history": result.history,
            "model": model,
        })
    best = min(trials, key=lambda item: item["best_validation_loss"])
    return best["model"], trials


def gradient_checks(model: V02Brain, seed: int) -> dict:
    trace = teacher_trace(model, seed)
    loss, gradients, memory_gradient, _ = model.loss_and_gradients(trace)
    epsilon = 1e-5
    checks = {}
    for name in ("p0.W_in", "p1.W_in", "p2.W_in", "p3.W_in", "c.W_in"):
        index = (0, 0)
        plus = model.clone()
        minus = model.clone()
        plus.params[name][index] += epsilon
        minus.params[name][index] -= epsilon
        plus_loss = plus.loss_and_gradients(trace)[0]
        minus_loss = minus.loss_and_gradients(trace)[0]
        numeric = (plus_loss - minus_loss) / (2.0 * epsilon)
        analytic = float(gradients[name][index])
        checks[name] = {
            "analytic": analytic,
            "finite_difference": numeric,
            "relative_error": abs(analytic - numeric) / max(1e-8, abs(analytic) + abs(numeric)),
            "gradient_norm": float(np.linalg.norm(gradients[name])),
        }
    initial = np.zeros((model.MEMORY_SLOTS, model.MEMORY_DIM), dtype=np.float64)
    index = (0, 0)
    plus_initial = initial.copy()
    minus_initial = initial.copy()
    plus_initial[index] += epsilon
    minus_initial[index] -= epsilon
    plus_loss = model.loss_and_gradients(trace, initial_memory=plus_initial)[0]
    minus_loss = model.loss_and_gradients(trace, initial_memory=minus_initial)[0]
    numeric = (plus_loss - minus_loss) / (2.0 * epsilon)
    analytic = float(memory_gradient[index])
    checks["memory.initial"] = {
        "analytic": analytic,
        "finite_difference": numeric,
        "relative_error": abs(analytic - numeric) / max(1e-8, abs(analytic) + abs(numeric)),
        "gradient_norm": float(np.linalg.norm(memory_gradient)),
    }
    return {
        "seed": seed,
        "loss": loss,
        "checks": checks,
        "all_within_1e-3": all(item["relative_error"] < 1e-3 for item in checks.values()),
    }


def checkpoint_replay_check(model: V02Brain, seed: int) -> dict:
    original = interactive_run(model, seed)
    serialized = json.loads(json.dumps(model.state_dict(), sort_keys=True))
    reloaded = V02Brain(model.seed)
    reloaded.load_state_dict(serialized)
    replay = interactive_run(reloaded, seed)
    episode = V02Episode(seed)
    restored = V02Episode.restore(json.loads(json.dumps(episode.snapshot(), sort_keys=True)))
    return {
        "model_state_roundtrip": _json_digest(model.state_dict()) == _json_digest(serialized),
        "episode_state_roundtrip": _json_digest(episode.snapshot()) == _json_digest(restored.snapshot()),
        "replay_same_actions": original["selected_actions"] == replay["selected_actions"],
        "replay_same_success": original["success"] == replay["success"],
        "replay_same_trajectory": original["trajectory_digest"] == replay["trajectory_digest"],
    }


def workspace_check() -> dict:
    workspace = NoteWorkspace()
    workspace.create("a", "A", "exact [[b]]", 0)
    workspace.create("b", "B", "delayed cue", 0)
    workspace.edit("a", "exact [[b]] revision two", 1, expected_revision=1)
    return {
        "fts5": workspace.fts_enabled,
        "search": workspace.search("revision two", exact=True),
        "outgoing": workspace.outgoing("a"),
        "events": [event["type"] for event in workspace.events],
        "snapshot_schema": workspace.snapshot()["schema"],
    }


def _compact_runs(result: dict) -> dict:
    compact = copy.deepcopy(result)
    for run in compact.get("runs", []):
        run.pop("snapshot", None)
        for row in run.get("rows", []):
            row.pop("action_probs", None)
            row.pop("tool_vector", None)
    return compact


def run_proof(*, output_path: str | Path = "artifacts/v02-proof-report.json", steps: int = TRAIN_STEPS) -> dict:
    start = time.perf_counter()
    splits = make_splits()
    full_model, full_trials = train_trials(V02Brain, MODEL_SEEDS, splits, steps=steps)
    control_model, control_trials = train_trials(V02SingleRecurrentNoMemory, CONTROL_SEEDS, splits, steps=steps)
    test = splits["test"]
    normal = evaluate(full_model, test)
    intervention_specs = {
        "wrong_note": {"wrong_note": True},
        "stale_note": {"stale_note": True},
        "shuffle_diagnostic": {"shuffle_diagnostic": True},
        "memory_erase": {"memory_erase": True},
        "actuation_disabled": {"disable_actuation": True},
        "field_feedback_off": {"field_feedback_off": True},
        "ablate_p0": {"ablate_brain": 0},
        "ablate_p1": {"ablate_brain": 1},
        "ablate_p2": {"ablate_brain": 2},
        "ablate_p3": {"ablate_brain": 3},
        "ablate_center": {"ablate_brain": "center"},
        "fixed_diagnostic_and_gate": {"fixed_diagnostic_port": 0, "fixed_gate": 0},
    }
    interventions = {name: _compact_runs(evaluate(full_model, test, spec)) for name, spec in intervention_specs.items()}
    control_eval = evaluate(control_model, test)
    fixed_tool = interventions["fixed_diagnostic_and_gate"]
    finite_world = ResonantWorld(seed=707)
    finite_world.q += np.array([0.02, -0.01, 0.03, -0.025])
    finite_world.u[:] = [0.1, -0.08, 0.04, -0.02]
    report = {
        "schema": "vevo.v02.proof-report.v1",
        "scope": "interactive delayed-cue note revision -> calibrated diagnostic -> physical gate",
        "architecture": {
            "peripheral_brains": 4,
            "central_brains": 1,
            "total_brains": full_model.brain_count,
            "full_parameter_count": full_model.parameter_count(),
            "control_parameter_count": control_model.parameter_count(),
            "central_memory": "2 differentiable slots x 4 values",
            "exact_state": ["world", "SQLite notes/revisions", "mapping", "typed results", "events", "budgets"],
            "learned_state": ["five recurrent states", "weights", "differentiable memory"],
        },
        "protocol": {
            "stages": ["note_lookup", "diagnostic_calibration", "gate_actuation"],
            "success": "authoritative gate_open[target_gate] is true within work budget",
            "work_budget": V02Episode.WORK_BUDGET,
            "physics_step_budget": V02Episode.MAX_PHYSICS_STEPS,
            "tool_calls": 3,
            "no_privileged_target_input": True,
        },
        "splits": {
            "train": splits["train"],
            "validation": splits["validation"],
            "test": splits["test"],
            "target_balance": {
                split: [int(sum(ResonantWorld(seed=seed).target == target for seed in seeds)) for target in (0, 1)]
                for split, seeds in splits.items()
            },
        },
        "training": {
            "steps_per_trial": steps,
            "full_trials": [{key: value for key, value in trial.items() if key != "model"} for trial in full_trials],
            "matched_no_memory_trials": [{key: value for key, value in trial.items() if key != "model"} for trial in control_trials],
        },
        "normal": _compact_runs(normal),
        "interventions": interventions,
        "matched_control": _compact_runs(control_eval),
        "fixed_tool_control": fixed_tool,
        "checks": {
            "field_force_finite_difference_error": finite_difference_force_error(finite_world),
            "gradient_checks": gradient_checks(full_model, splits["test"][0]),
            "checkpoint_replay": checkpoint_replay_check(full_model, splits["test"][1]),
            "workspace": workspace_check(),
        },
        "budgets": {
            "normal_all_within_work": all(run["work_spent"] <= V02Episode.WORK_BUDGET for run in normal["runs"]),
            "normal_all_within_physics": all(run["physics_steps"] <= V02Episode.MAX_PHYSICS_STEPS for run in normal["runs"]),
        },
        "runtime": {
            "seconds": time.perf_counter() - start,
            "max_rss_kb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "failures": [],
        },
    }
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return report


def main() -> None:
    report = run_proof()
    print(json.dumps({
        "schema": report["schema"],
        "normal": report["normal"]["summary"],
        "matched_control": report["matched_control"]["summary"],
        "runtime": report["runtime"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
