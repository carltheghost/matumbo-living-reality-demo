"""Run the smallest delayed-cue five-brain proof and write evidence."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import resource
import tempfile
import time

import numpy as np

from .controls import SingleRecurrentNoMemory
from .fabric import BudgetLedger, SimFabricStore
from .model import ACTION_NAMES, FiveBrain
from .physics import ResonantWorld, finite_difference_force_error, make_episode_observations
from .tools import ACTION_TO_SLOT, ToolExecutor, result_vector
from .workspace import NoteWorkspace


HORIZON = 25
CUE_END = 4


@dataclass
class Episode:
    seed: int
    observations: np.ndarray
    target: int


def make_balanced_dataset(start_seed: int, per_class: int) -> list[Episode]:
    episodes: list[Episode] = []
    counts = [0, 0]
    seed = start_seed
    while min(counts) < per_class:
        observations, target, _ = make_episode_observations(seed, horizon=HORIZON)
        if counts[target] < per_class:
            episodes.append(Episode(seed, observations, target))
            counts[target] += 1
        seed += 1
    episodes.sort(key=lambda episode: episode.seed)
    return episodes


def as_pairs(episodes: list[Episode]) -> list[tuple[np.ndarray, int]]:
    return [(episode.observations, episode.target) for episode in episodes]


def _trace_digest(values: list[dict]) -> str:
    encoded = json.dumps(values, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def _run_live_episode(
    model: FiveBrain,
    episode: Episode,
    *,
    memory_erase: bool = False,
    tool_result_shuffle: bool = False,
    brain_to_field_off: bool = False,
    field_to_brain_off: bool = False,
    action_override: str | None = None,
    checkpoint_at: int | None = None,
) -> dict:
    """Run the actual world/brain/tool loop, without exposing target to model."""

    world = ResonantWorld(seed=episode.seed)
    store = SimFabricStore(world, seed=episode.seed + 500, budgets=BudgetLedger(max_ticks=160, max_tool_calls=2))
    executor = ToolExecutor(store)
    runtime = model.initial_runtime()
    previous_drives = np.zeros(world.NODES, dtype=np.float64)
    world_trace: list[dict] = []
    neural_trace: list[dict] = []
    last_result = None
    checkpoint_digest = None
    pre_action_digest = None
    action = "noop"
    for tick in range(HORIZON):
        store.advance_world(
            np.zeros(world.NODES) if brain_to_field_off else previous_drives,
            include_cue=True,
        )
        observation = world.observe()
        if field_to_brain_off and tick >= CUE_END:
            observation = np.zeros_like(observation)
        if memory_erase and tick >= CUE_END:
            runtime["memory"].fill(0.0)
        feedback = None if last_result is None else result_vector(last_result)
        if tool_result_shuffle and feedback is not None:
            feedback = np.asarray([feedback[0], feedback[3], feedback[1], feedback[2]], dtype=np.float64)
        runtime, trace = model._raw_step(runtime, observation, feedback)
        if brain_to_field_off:
            trace["port_drives"] = np.zeros(world.NODES, dtype=np.float64)
        previous_drives = np.asarray(trace["port_drives"], dtype=np.float64)
        neural_trace.append(
            {
                "tick": tick,
                "messages": trace["messages"].tolist(),
                "memory_norm": float(np.linalg.norm(runtime["memory"])),
                "central_norm": float(np.linalg.norm(runtime["central"])),
                "action_probs": trace["action_probs"].tolist(),
            }
        )
        world_trace.append(
            {
                "tick": world.tick,
                "q": world.q.tolist(),
                "u": world.u.tolist(),
                "energy": world.energy(),
            }
        )
        if checkpoint_at is not None and tick == checkpoint_at:
            state = store.checkpoint(
                brains=model.brain_snapshot(runtime),
                training={"model_parameters": model.state_dict(), "optimizer_step": 0},
            )
            checkpoint_digest = state.digest()
    if action_override is None:
        action = model.action_from_trace(trace)
    else:
        action = action_override
    pre_action_digest = world.digest()
    result = executor.execute(action)
    last_result = result

    # One additional feedback tick demonstrates that the typed result re-enters
    # the same central recurrent/memory computation after the mutation.
    store.advance_world(previous_drives if not brain_to_field_off else np.zeros(world.NODES), include_cue=False)
    feedback_obs = world.observe()
    feedback = result_vector(result)
    if tool_result_shuffle:
        feedback = np.asarray([feedback[0], feedback[3], feedback[1], feedback[2]], dtype=np.float64)
    if field_to_brain_off:
        feedback_obs = np.zeros_like(feedback_obs)
    if memory_erase:
        runtime["memory"].fill(0.0)
    feedback_runtime, feedback_trace = model._raw_step(runtime, feedback_obs, feedback)
    post_feedback_vector = np.concatenate(
        [feedback_runtime["central"], feedback_runtime["memory"].reshape(-1)]
    )
    mutated = pre_action_digest != world.digest()
    selected_slot = ACTION_TO_SLOT.get(action)
    return {
        "seed": episode.seed,
        "target": episode.target,
        "action": action,
        "selected_slot": selected_slot,
        "success": bool(selected_slot is not None and selected_slot == episode.target),
        "tool_accepted": bool(result.accepted),
        "tool_payload": result.payload,
        "world_mutated": mutated,
        "pre_action_digest": pre_action_digest,
        "post_action_digest": world.digest(),
        "world_trace": world_trace,
        "neural_trace": neural_trace,
        "post_feedback_vector": post_feedback_vector.tolist(),
        "feedback_trace": {
            "action_probs": feedback_trace["action_probs"].tolist(),
            "memory_norm": float(np.linalg.norm(feedback_runtime["memory"])),
        },
        "trajectory_digest": _trace_digest(world_trace),
        "checkpoint_digest": checkpoint_digest,
        "world_residual": world.residual,
        "world_work": world.work,
        "world_dissipated": world.dissipated,
        "budget": store.budgets.snapshot(),
        "store": store,
        "runtime": runtime,
    }


def evaluate_live(model: FiveBrain, episodes: list[Episode], **kwargs) -> dict:
    runs = [_run_live_episode(model, episode, **kwargs) for episode in episodes]
    return {
        "accuracy": float(np.mean([run["success"] for run in runs])) if runs else 0.0,
        "mutation_rate": float(np.mean([run["world_mutated"] for run in runs])) if runs else 0.0,
        "mean_response_gain": float(np.mean([run["tool_payload"].get("response_gain", 0.0) for run in runs])) if runs else 0.0,
        "mean_work": float(np.mean([run["world_work"] for run in runs])) if runs else 0.0,
        "mean_dissipated": float(np.mean([run["world_dissipated"] for run in runs])) if runs else 0.0,
        "mean_abs_residual": float(np.mean([abs(run["world_residual"]) for run in runs])) if runs else 0.0,
        "max_abs_residual": float(np.max([abs(run["world_residual"]) for run in runs])) if runs else 0.0,
        "runs": runs,
    }


def gradient_checks(model: FiveBrain, episode: Episode) -> dict:
    loss, gradients, memory_gradient, _ = model.loss_and_gradients(episode.observations, episode.target)
    checks = {}
    epsilon = 1e-5
    selected = ["p0.W_in", "p1.W_in", "p2.W_in", "p3.W_in", "c.W_in"]
    for name in selected:
        index = (0, 0)
        plus = model.clone()
        minus = model.clone()
        plus.params[name][index] += epsilon
        minus.params[name][index] -= epsilon
        plus_loss, _, _, _ = plus.loss_and_gradients(episode.observations, episode.target)
        minus_loss, _, _, _ = minus.loss_and_gradients(episode.observations, episode.target)
        numeric = (plus_loss - minus_loss) / (2.0 * epsilon)
        analytic = float(gradients[name][index])
        checks[name] = {
            "analytic": analytic,
            "finite_difference": numeric,
            "absolute_error": abs(analytic - numeric),
            "relative_error": abs(analytic - numeric) / max(1e-8, abs(analytic) + abs(numeric)),
            "gradient_norm": float(np.linalg.norm(gradients[name])),
        }
    memory = np.zeros((model.MEMORY_SLOTS, model.MEMORY_DIM), dtype=np.float64)
    memory_index = (0, 0)
    plus_memory = memory.copy()
    minus_memory = memory.copy()
    plus_memory[memory_index] += epsilon
    minus_memory[memory_index] -= epsilon
    plus_loss, _, _, _ = model.loss_and_gradients(episode.observations, episode.target, initial_memory=plus_memory)
    minus_loss, _, _, _ = model.loss_and_gradients(episode.observations, episode.target, initial_memory=minus_memory)
    numeric = (plus_loss - minus_loss) / (2.0 * epsilon)
    analytic = float(memory_gradient[memory_index])
    checks["memory.initial"] = {
        "analytic": analytic,
        "finite_difference": numeric,
        "absolute_error": abs(analytic - numeric),
        "relative_error": abs(analytic - numeric) / max(1e-8, abs(analytic) + abs(numeric)),
        "gradient_norm": float(np.linalg.norm(memory_gradient)),
    }
    return {"loss": loss, "checks": checks, "all_within_1e-3": all(item["relative_error"] < 1e-3 for item in checks.values())}


def workspace_checkpoint_check() -> dict:
    store = SimFabricStore(ResonantWorld(seed=900), seed=901)
    store.create_note("architecture", "Architecture", "Four brains link to [[proof]].")
    store.create_note("proof", "Proof", "Delayed cue and exact history.")
    store.edit_note("architecture", "Four brains link to [[proof]] and preserve exact notes.", expected_revision=1)
    store.add_note_link("proof", "architecture")
    before = store.workspace.digest()
    assert store.workspace.search("exact notes", exact=True) == [{"note_id": "architecture", "title": "Architecture", "revision": 2}]
    assert store.workspace.backlinks("architecture") == ["proof"]
    checkpoint = store.checkpoint(brains={"brain_count": 5}, training={"step": 0})
    restored = SimFabricStore.from_checkpoint(checkpoint)
    after = restored.workspace.digest()
    with tempfile.TemporaryDirectory(prefix="vevo-notes-") as directory:
        db_path = Path(directory) / "notes.sqlite3"
        disk_workspace = NoteWorkspace(str(db_path))
        disk_workspace.create("persisted", "Persisted", "SQLite exact memory", 0)
        disk_workspace.close()
        reopened = NoteWorkspace(str(db_path))
        disk_persistence = reopened.search("SQLite exact memory", exact=True)
        reopened.close()
    return {
        "before_digest": before,
        "after_digest": after,
        "same_digest": before == after,
        "search": restored.workspace.search("exact notes", exact=True),
        "projection": restored.projection()["workspace"],
        "event_types": [event["type"] for event in restored.events],
        "disk_persistence": disk_persistence,
    }


def checkpoint_replay_check(model: FiveBrain, episode: Episode) -> dict:
    def run_until(store, runtime, previous_drives, start_tick, end_tick):
        for _tick in range(start_tick, end_tick + 1):
            store.advance_world(previous_drives, include_cue=True)
            runtime, trace = model._raw_step(runtime, store.world.observe(), np.zeros(4))
            previous_drives = np.asarray(trace["port_drives"], dtype=np.float64)
        return runtime, previous_drives

    original_store = SimFabricStore(
        ResonantWorld(seed=episode.seed),
        seed=episode.seed + 500,
        budgets=BudgetLedger(max_ticks=160, max_tool_calls=2),
    )
    original_runtime, original_drives = run_until(
        original_store, model.initial_runtime(), np.zeros(4), 0, 12
    )
    state = original_store.checkpoint(
        brains=model.brain_snapshot(original_runtime),
        training={"model_parameters": model.state_dict(), "optimizer_step": 0},
    )
    with tempfile.TemporaryDirectory(prefix="vevo-checkpoint-") as directory:
        path = Path(directory) / "state.json"
        original_store.save(path, brains=model.brain_snapshot(original_runtime), training=state.training)
        loaded = SimFabricStore.load(path)
        restored = SimFabricStore.from_checkpoint(loaded)
        replay_model = model.clone()
        replay_model.load_state_dict(loaded.training["model_parameters"])
        replay_runtime = replay_model.restore_runtime(loaded.brains)
        # Continue both the original and restored trajectories from the exact
        # checkpoint. This tests replay, not merely JSON round-tripping.
        original_runtime, _ = run_until(original_store, original_runtime, original_drives, 13, HORIZON - 1)
        replay_runtime, _ = run_until(restored, replay_runtime, original_drives, 13, HORIZON - 1)
        original_action = model.action_from_trace(model._raw_step(original_runtime, original_store.world.observe(), np.zeros(4))[1])
        replay_action = replay_model.action_from_trace(replay_model._raw_step(replay_runtime, restored.world.observe(), np.zeros(4))[1])
        original_result = ToolExecutor(original_store).execute(original_action)
        replay_result = ToolExecutor(restored).execute(replay_action)
        replay_digest = restored.world.digest()
        original_digest = original_store.world.digest()
    return {
        "checkpoint_digest": state.digest(),
        "loaded_digest": loaded.digest(),
        "state_roundtrip_equal": state.digest() == loaded.digest(),
        "continuation_equal": original_action == replay_action and original_digest == replay_digest and original_result.payload == replay_result.payload,
        "original_action": original_action,
        "replay_action": replay_action,
        "original_world_digest": original_digest,
        "continued_world_digest": replay_digest,
        "brain_count": loaded.brains.get("brain_count"),
    }


def _train_models(train_episodes, validation_episodes, *, steps: int, seeds: list[int]) -> tuple[FiveBrain, list[dict]]:
    train_pairs = as_pairs(train_episodes)
    validation_pairs = as_pairs(validation_episodes)
    reports = []
    best_model = None
    best_loss = float("inf")
    for seed in seeds:
        model = FiveBrain(seed)
        start = time.perf_counter()
        result = model.train(
            train_pairs,
            validation_pairs,
            steps=steps,
            learning_rate=0.012,
            seed=seed + 1000,
            validation_every=max(30, steps // 6),
        )
        elapsed = time.perf_counter() - start
        report = {
            "model_seed": seed,
            "optimizer_seed": seed + 1000,
            "parameter_count": model.parameter_count(),
            "optimizer_steps": result.optimizer_steps,
            "best_step": result.best_step,
            "best_validation_loss": result.best_validation_loss,
            "history": result.history,
            "wall_seconds": elapsed,
        }
        reports.append(report)
        if result.best_validation_loss < best_loss:
            best_model = result.model.clone()
            best_loss = result.best_validation_loss
    assert best_model is not None
    return best_model, reports


def run_proof(output: str | Path = "artifacts/proof-report.json") -> dict:
    started = time.perf_counter()
    failures: list[str] = []
    train_episodes = make_balanced_dataset(1000, 35)
    validation_episodes = make_balanced_dataset(2000, 10)
    test_episodes = make_balanced_dataset(3000, 20)
    model, training_reports = _train_models(train_episodes, validation_episodes, steps=360, seeds=[7, 17, 29])
    gradient_report = gradient_checks(model, validation_episodes[0])

    world_forces = ResonantWorld(seed=77)
    world_forces.q += np.asarray([0.03, -0.02, 0.025, -0.01])
    world_forces.u[:] = np.asarray([0.13, -0.09, 0.07, -0.04])
    force_error = finite_difference_force_error(world_forces)
    workspace_report = workspace_checkpoint_check()
    replay_report = checkpoint_replay_check(model, test_episodes[0])

    normal = evaluate_live(model, test_episodes)
    memory_erased = evaluate_live(model, test_episodes, memory_erase=True)
    field_off = evaluate_live(model, test_episodes, field_to_brain_off=True)
    ports_off = evaluate_live(model, test_episodes, brain_to_field_off=True)
    shuffled_runs = [_run_live_episode(model, episode, tool_result_shuffle=True) for episode in test_episodes]
    tool_feedback_delta = []
    for plain, shuffled in zip(normal["runs"], shuffled_runs):
        tool_feedback_delta.append(
            float(np.linalg.norm(np.asarray(plain["post_feedback_vector"]) - np.asarray(shuffled["post_feedback_vector"])))
        )

    def trajectory_delta(left_runs, right_runs):
        distances = []
        for left, right in zip(left_runs, right_runs):
            for left_tick, right_tick in zip(left["world_trace"], right["world_trace"]):
                distances.append(
                    float(
                        np.linalg.norm(np.asarray(left_tick["q"]) - np.asarray(right_tick["q"]))
                        + np.linalg.norm(np.asarray(left_tick["u"]) - np.asarray(right_tick["u"]))
                    )
                )
        return float(np.mean(distances)) if distances else 0.0

    single = SingleRecurrentNoMemory(seed=41)
    single_train_start = time.perf_counter()
    single_train_report = single.train(as_pairs(train_episodes), as_pairs(validation_episodes), steps=360, learning_rate=0.012, seed=1041)
    single_train_report["wall_seconds"] = time.perf_counter() - single_train_start
    single_runs = []
    for episode in test_episodes:
        # The control's one output is deliberately not granted four learned
        # field ports; it still gets the same world/cue/tool/tick budget.
        world = ResonantWorld(seed=episode.seed)
        previous = np.zeros(4)
        hidden = np.zeros(single.HIDDEN)
        for _ in range(HORIZON):
            world.step(previous)
            hidden, logits, probs = single._step(hidden, world.observe())
            trace = {"action_probs": probs}
        action = ACTION_NAMES[int(np.argmax(trace["action_probs"]))]
        before = world.digest()
        control_store = SimFabricStore(world, seed=episode.seed + 700, budgets=BudgetLedger(max_ticks=160, max_tool_calls=2))
        control_result = ToolExecutor(control_store).execute(action)
        single_runs.append({"success": ACTION_TO_SLOT.get(action) == episode.target, "action": action, "mutated": before != world.digest(), "gain": control_result.payload.get("response_gain", 0.0)})
    fixed = evaluate_live(model, test_episodes, action_override="probe_a")
    controls = {
        "full_4_plus_1": {key: normal[key] for key in ("accuracy", "mutation_rate", "mean_response_gain", "mean_work", "mean_dissipated", "mean_abs_residual", "max_abs_residual")},
        "single_recurrent_no_memory": {
            "parameter_count": single.parameter_count(),
            "optimizer_steps": 360,
            "validation": single_train_report,
            "accuracy": float(np.mean([run["success"] for run in single_runs])),
            "mutation_rate": float(np.mean([run["mutated"] for run in single_runs])),
        },
        "fixed_tool_probe_a": {key: fixed[key] for key in ("accuracy", "mutation_rate", "mean_response_gain", "mean_work", "mean_dissipated", "mean_abs_residual", "max_abs_residual")},
        "memory_erase_ablation": {key: memory_erased[key] for key in ("accuracy", "mutation_rate", "mean_response_gain", "mean_work", "mean_dissipated", "mean_abs_residual")},
    }

    report = {
        "schema": "vevo.proof-report.v1",
        "architecture": "docs/ARCHITECTURE.md",
        "exact_brains": {"peripheral": 4, "central": 1, "total": model.brain_count},
        "model": {
            "parameter_count": model.parameter_count(),
            "peripheral_hidden": model.PERIPH_HIDDEN,
            "central_hidden": model.CENTRAL_HIDDEN,
            "memory_slots": model.MEMORY_SLOTS,
            "memory_dim": model.MEMORY_DIM,
            "action_names": list(ACTION_NAMES),
        },
        "data": {
            "train_episodes": len(train_episodes),
            "validation_episodes": len(validation_episodes),
            "test_episodes": len(test_episodes),
            "train_targets": [sum(episode.target == target for episode in train_episodes) for target in (0, 1)],
            "validation_targets": [sum(episode.target == target for episode in validation_episodes) for target in (0, 1)],
            "test_targets": [sum(episode.target == target for episode in test_episodes) for target in (0, 1)],
            "horizon": HORIZON,
            "cue_ticks": ResonantWorld.CUE_TICKS,
            "holdout_policy": "independent seeded whole trajectories; test does not select weights",
        },
        "training": training_reports,
        "controls": controls,
        "budgets": {
            "configured_and_observed": normal["runs"][0]["budget"] if normal["runs"] else {},
            "note_byte_budget": 400_000,
            "checkpoint_byte_budget": 6_000_000,
        },
        "evaluation_evidence": [
            {
                "seed": run["seed"],
                "target_after_run": run["target"],
                "action": run["action"],
                "success_after_run": run["success"],
                "world_mutated": run["world_mutated"],
                "response_gain": run["tool_payload"].get("response_gain", 0.0),
                "energy_delta": run["tool_payload"].get("energy_delta", 0.0),
                "work": run["world_work"],
                "dissipated": run["world_dissipated"],
                "residual": run["world_residual"],
                "trajectory_digest": run["trajectory_digest"],
            }
            for run in normal["runs"]
        ],
        "interventions": {
            "memory_erase": {key: memory_erased[key] for key in ("accuracy", "mutation_rate", "mean_response_gain", "mean_work", "mean_dissipated", "mean_abs_residual")},
            "field_to_brain_off": {key: field_off[key] for key in ("accuracy", "mutation_rate", "mean_response_gain", "mean_work", "mean_dissipated", "mean_abs_residual")},
            "brain_to_field_off": {key: ports_off[key] for key in ("accuracy", "mutation_rate", "mean_response_gain", "mean_work", "mean_dissipated", "mean_abs_residual", "max_abs_residual")},
            "tool_result_shuffle": {
                "mean_post_feedback_state_delta": float(np.mean(tool_feedback_delta)),
                "max_post_feedback_state_delta": float(np.max(tool_feedback_delta)),
                "paired_episode_count": len(tool_feedback_delta),
            },
            "brain_to_field_trajectory_delta": trajectory_delta(normal["runs"], ports_off["runs"]),
            "field_to_brain_trajectory_delta": trajectory_delta(normal["runs"], field_off["runs"]),
        },
        "numerical_checks": {
            "finite_difference_force_max_error": force_error,
            "gradient_checks": gradient_report,
            "workspace_checkpoint": workspace_report,
            "save_reload_replay": replay_report,
        },
        "resource": {
            "wall_seconds_total": time.perf_counter() - started,
            "max_rss_kb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "dependency": "Python standard library + NumPy; no network/credentials",
            "failure_count": len(failures),
            "failures": failures,
        },
        "limits": [
            "Synthetic local episodes only; no physical device or web tool.",
            "The correct action is evaluated against hidden episode metadata after execution; it is never returned by the tool.",
            "The field is a bounded reconstructed four-node energy model, not the old NeuralEdgeLaw or a Gross–Pitaevskii intelligence claim.",
            "Weights and neural memory do not replace exact notes, permissions, history or executable code.",
        ],
    }
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    return report


def main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("artifacts/proof-report.json"))
    args = parser.parse_args(argv)
    report = run_proof(args.output)
    print(json.dumps({
        "output": str(args.output),
        "accuracy": report["controls"]["full_4_plus_1"]["accuracy"],
        "force_error": report["numerical_checks"]["finite_difference_force_max_error"],
        "gradient_ok": report["numerical_checks"]["gradient_checks"]["all_within_1e-3"],
        "replay_ok": report["numerical_checks"]["save_reload_replay"]["state_roundtrip_equal"],
        "wall_seconds": report["resource"]["wall_seconds_total"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
