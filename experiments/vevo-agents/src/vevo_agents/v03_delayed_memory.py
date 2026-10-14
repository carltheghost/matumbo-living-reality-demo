"""Run one bounded five-step delayed-memory v0.3 experiment.

This runner is intentionally separate from the historical repair runner.  It
keeps the existing model, optimizer, physics, and matched control unchanged,
but trains and evaluates on the corrected note-hidden delayed schedule.
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

from .v03_model import (
    NOTE_FEATURE_END,
    NOTE_FEATURE_START,
    NOTE_PAYLOAD_MASK_INDEX,
    V03FiveBrain,
    V03SingleRecurrentMemory,
    encode_policy_observation,
    fit_input_normalization,
    normalize_policy_vector,
)
from .v03_neural_proof import (
    _atomic_write_json,
    _gate_resonances,
    _goal_note,
)
from .v03_neural_repair import (
    GRADIENT_CLIP_NORM,
    LEARNING_RATE,
    _adam_update,
    _apply_retention_erasure,
    _failure_cause,
    _json_digest,
    _paired_ablation_summary,
    _strip_goal_bearing_note,
)
from .v03_protocol import CorrectedEpisode, PROBE_FREQUENCIES


CONTRACT_PATH = "docs/EXPERIMENT_CONTRACT_V03_DELAYED_MEMORY.md"
REPORT_PATH = "reports/generated/v03-neural-delayed-memory-report.json"
CHECKPOINT_PREFIX = "v03-neural-delayed-memory"

DELAYED_MODEL_SEEDS = (107, 117)
DELAYED_CONTROL_SEEDS = (141, 143)
DELAYED_TRAIN_WORLD_SEEDS = (9200, 9201)
HELDOUT_WORLD_SEEDS = (9300, 9301, 9302, 9303, 9304, 9305, 9306, 9307)
HISTORICAL_WORLD_SEEDS = frozenset((*range(6300, 6312), 7100, 7101, 8300, 8301))
MAX_UPDATES = 1000
WALL_CLOCK_CAP_SECONDS = 300.0
RETENTION_DELAY_STEPS = 2
METRIC_STEPS = (1, 100, 250, 500, 750, 1000)

RETENTION_CONDITIONS = (
    ("ordinary", None, "none"),
    ("slot0_erase", "slot0", "memory_slot_0"),
    ("slot1_erase", "slot1", "memory_slot_1"),
    ("both_slots_erase", "both", "memory_slots_0_and_1"),
    ("recurrent_erase", "recurrent", "recurrent_state_only"),
    ("all_retained_state_erase", "all", "recurrent_state_and_memory"),
)


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _source_root() -> Path:
    return Path(__file__).resolve().parents[4]


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


def _spec(world_seed: int, goal_index: int, split: str) -> dict:
    return {
        "split": str(split),
        "world_seed": int(world_seed),
        "goal_index": int(goal_index),
        "note_goal_id": f"{split}-goal-{goal_index}",
        "note_text": _goal_note(goal_index, split, 0.0),
        "gate_resonance_hz": _gate_resonances(world_seed).tolist(),
    }


def make_training_specs() -> list[dict]:
    return [
        _spec(world_seed, goal_index, "delayed-train")
        for world_seed in DELAYED_TRAIN_WORLD_SEEDS
        for goal_index in range(len(PROBE_FREQUENCIES))
    ]


def make_heldout_specs() -> list[dict]:
    if set(HELDOUT_WORLD_SEEDS) & HISTORICAL_WORLD_SEEDS:
        raise AssertionError("held-out world seeds overlap historical reports")
    return [
        _spec(world_seed, goal_index, "delayed-heldout")
        for world_seed in HELDOUT_WORLD_SEEDS
        for goal_index in range(len(PROBE_FREQUENCIES))
    ]


def _hidden_observation_audit(observation: dict) -> dict:
    note = observation.get("note")
    if not isinstance(note, dict):
        raise AssertionError("hidden delayed observation must retain typed note metadata")
    encoded = encode_policy_observation(observation)
    serialized = json.dumps(observation, sort_keys=True, separators=(",", ":"))
    text_empty = note.get("text", "") == ""
    digest_empty = note.get("content_digest", "") == ""
    target_marker_absent = "target_hz" not in serialized
    payload_mask_zero = bool(encoded[NOTE_PAYLOAD_MASK_INDEX] == 0.0)
    if not text_empty or not digest_empty or not target_marker_absent or not payload_mask_zero:
        raise AssertionError("hidden delayed observation still contains goal-bearing note payload")
    return {
        "note_payload_present_mask": int(encoded[NOTE_PAYLOAD_MASK_INDEX]),
        "text_empty": bool(text_empty),
        "content_digest_empty": bool(digest_empty),
        "target_marker_absent": bool(target_marker_absent),
        "payload_mask_zero": bool(payload_mask_zero),
    }


def _prepare_delayed_episode(spec: dict) -> tuple[CorrectedEpisode, list[dict], dict]:
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
        raise RuntimeError("delayed schedule note lookup failed")
    observations.append(("note_shown_once", copy.deepcopy(episode.policy_observation())))

    hidden_audits = []
    for index in range(RETENTION_DELAY_STEPS):
        episode.advance(np.zeros(4, dtype=np.float64))
        hidden = _strip_goal_bearing_note(episode.policy_observation())
        hidden_audits.append(_hidden_observation_audit(hidden))
        observations.append((f"goal_independent_delay_{index + 1}", hidden))

    episode.execute_diagnostic(0)
    if not episode.measurement or not episode.measurement.get("accepted"):
        raise RuntimeError("delayed schedule diagnostic failed")
    final_hidden = _strip_goal_bearing_note(episode.policy_observation())
    hidden_audits.append(_hidden_observation_audit(final_hidden))
    observations.append(("spectrum_and_action", final_hidden))

    stage_names = [name for name, _ in observations]
    policy_observations = [observation for _, observation in observations]
    payload_masks = [
        int(encode_policy_observation(observation)[NOTE_PAYLOAD_MASK_INDEX])
        for observation in policy_observations
    ]
    if stage_names != [
        "before_note",
        "note_shown_once",
        "goal_independent_delay_1",
        "goal_independent_delay_2",
        "spectrum_and_action",
    ]:
        raise AssertionError("unexpected delayed schedule stages")
    if payload_masks != [0, 1, 0, 0, 0]:
        raise AssertionError("the delayed schedule must expose note payload exactly once")
    return episode, policy_observations, {
        "stage_names": stage_names,
        "policy_observation_count": len(policy_observations),
        "note_payload_masks": payload_masks,
        "note_shown_once": payload_masks.count(1) == 1,
        "hidden_rows": hidden_audits,
        "hidden_goal_bearing_fields_validated": all(
            item["text_empty"]
            and item["content_digest_empty"]
            and item["target_marker_absent"]
            and item["payload_mask_zero"]
            for item in hidden_audits
        ),
    }


def build_delayed_examples(specs: list[dict], *, include_labels: bool = True) -> list[dict]:
    examples = []
    for spec in specs:
        episode, observations, schedule_audit = _prepare_delayed_episode(spec)
        example = {
            "spec": copy.deepcopy(spec),
            "policy_observations": observations,
            "input_digest": _json_digest(observations),
            "schedule_audit": schedule_audit,
        }
        if include_labels:
            example["target_gate"] = int(episode.oracle_action())
            example["target_frequency"] = int(spec["goal_index"])
        examples.append(example)
    return examples


def _prepared_by_identity(specs: list[dict]) -> dict[tuple[str, int, str], dict]:
    prepared = {}
    for spec in specs:
        episode, observations, schedule_audit = _prepare_delayed_episode(spec)
        key = (str(spec["split"]), int(spec["world_seed"]), str(spec["note_goal_id"]))
        prepared[key] = {
            "episode_snapshot": episode.snapshot(),
            "policy_observations": observations,
            "schedule_audit": schedule_audit,
        }
    return prepared


def _spec_identity(spec: dict) -> tuple[str, int, str]:
    return (str(spec["split"]), int(spec["world_seed"]), str(spec["note_goal_id"]))


def _training_observations(examples: list[dict]) -> list[dict]:
    return [observation for example in examples for observation in example["policy_observations"]]


def _validate_hidden_normalization(examples: list[dict], normalization: dict) -> dict:
    hidden_rows = 0
    violations = []
    max_abs = 0.0
    for example in examples:
        for observation in example["policy_observations"][2:]:
            hidden_rows += 1
            raw = encode_policy_observation(observation)
            normalized = normalize_policy_vector(raw, normalization)
            current_max = float(np.max(np.abs(normalized[NOTE_FEATURE_START:NOTE_FEATURE_END])))
            max_abs = max(max_abs, current_max)
            if raw[NOTE_PAYLOAD_MASK_INDEX] != 0.0 or not np.allclose(
                normalized[NOTE_FEATURE_START:NOTE_FEATURE_END], 0.0, rtol=0.0, atol=0.0
            ):
                violations.append(example["spec"]["note_goal_id"])
    return {
        "hidden_rows": int(hidden_rows),
        "violations": violations,
        "max_abs_normalized_hidden_note": max_abs,
        "passed": not violations and max_abs == 0.0,
    }


def _prediction_metrics(model, examples: list[dict], *, include_loss: bool = True) -> dict:
    predictions = [model.predict(example["policy_observations"]) for example in examples]
    gates = [int(item["gate"]) for item in predictions]
    frequencies = [int(item["frequency_index"]) for item in predictions]
    target_gates = [int(example["target_gate"]) for example in examples]
    target_frequencies = [int(example["target_frequency"]) for example in examples]
    result = {
        "n": len(examples),
        "gate_accuracy": float(np.mean(np.asarray(gates) == np.asarray(target_gates))),
        "frequency_accuracy": float(np.mean(np.asarray(frequencies) == np.asarray(target_frequencies))),
        "joint_accuracy": float(np.mean(
            (np.asarray(gates) == np.asarray(target_gates))
            & (np.asarray(frequencies) == np.asarray(target_frequencies))
        )),
        "gate_action_histogram": dict(sorted(Counter(gates).items())),
        "frequency_action_histogram": dict(sorted(Counter(frequencies).items())),
        "joint_action_histogram": dict(sorted(Counter(f"{gate}:{frequency}" for gate, frequency in zip(gates, frequencies)).items())),
    }
    if include_loss:
        result["full_training_loss"] = float(np.mean([
            model.loss_only(
                example["policy_observations"],
                target_gate=example["target_gate"],
                target_frequency=example["target_frequency"],
            )
            for example in examples
        ]))
    return result


def _train_delayed(model, examples: list[dict], *, seed: int, start_time: float, deadline: float) -> dict:
    first = {name: np.zeros_like(value) for name, value in model.params.items()}
    second = {name: np.zeros_like(value) for name, value in model.params.items()}
    rng = np.random.default_rng(seed)
    order = np.arange(len(examples), dtype=np.int64)
    history = []
    parameter_before = {name: value.copy() for name, value in model.params.items()}
    updates = 0
    stopped_reason = None
    for step in range(1, MAX_UPDATES + 1):
        if time.perf_counter() >= deadline:
            stopped_reason = "wall_clock_cap"
            break
        if (step - 1) % len(order) == 0:
            rng.shuffle(order)
        example = examples[int(order[(step - 1) % len(order)])]
        loss, gradients, _, _ = model.loss_and_gradients(
            example["policy_observations"],
            target_gate=example["target_gate"],
            target_frequency=example["target_frequency"],
        )
        gradient_norm, clip_scale = _adam_update(
            model, gradients, first, second, step, LEARNING_RATE
        )
        updates = step
        if step in METRIC_STEPS:
            metrics = _prediction_metrics(model, examples)
            metrics.update({
                "step": int(step),
                "last_batch_loss": float(loss),
                "gradient_norm": gradient_norm,
                "clip_scale": clip_scale,
                "elapsed_seconds": time.perf_counter() - start_time,
            })
            history.append(metrics)
    parameter_delta = float(np.sqrt(sum(
        np.sum((model.params[name] - value) ** 2)
        for name, value in parameter_before.items()
    )))
    return {
        "updates": int(updates),
        "history": history,
        "parameter_delta_l2": parameter_delta,
        "optimizer_first": first,
        "optimizer_second": second,
        "rng_state": rng.bit_generator.state,
        "shuffle_order": order.tolist(),
        "next_minibatch_index": int(updates % len(order)),
        "next_cycle_requires_shuffle": bool(updates % len(order) == 0),
        "stopped_reason": stopped_reason,
    }


def _run_summary(runs: list[dict]) -> dict:
    failures = Counter(item.get("failure", item.get("failure_cause")) for item in runs)
    failures.pop(None, None)
    return {
        "n": len(runs),
        "successes": int(sum(bool(item["success"]) for item in runs)),
        "success_rate": float(np.mean([item["success"] for item in runs])) if runs else 0.0,
        "failures": dict(sorted(failures.items())),
        "max_abs_world_residual": float(max((abs(item["world_residual"]) for item in runs), default=0.0)),
    }


def _validate_run_identities(runs: list[dict], specs: list[dict]) -> None:
    expected = [_spec_identity(spec) for spec in specs]
    actual = [
        (str(run["split"]), int(run["world_seed"]), str(run["note_goal_id"]))
        for run in runs
    ]
    if actual != expected:
        raise ValueError("delayed episode identities do not match the declared paired specs")


def run_delayed_episode(model, spec: dict, *, erasure: str | None = None, prepared: dict | None = None) -> dict:
    if prepared is None:
        prepared = _prepared_by_identity([spec])[_spec_identity(spec)]
    episode = CorrectedEpisode.restore(json.loads(json.dumps(prepared["episode_snapshot"], sort_keys=True)))
    observations = prepared["policy_observations"]
    runtime = model.initial_runtime()
    rows = []
    trace = None
    for index, observation in enumerate(observations):
        if index == len(observations) - 1:
            _apply_retention_erasure(model, runtime, erasure)
        runtime, trace = model.raw_step(runtime, observation)
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
    return {
        "split": spec["split"],
        "world_seed": int(spec["world_seed"]),
        "goal_index": int(spec["goal_index"]),
        "note_goal_id": spec["note_goal_id"],
        "condition": "ordinary_delayed" if erasure is None else f"{erasure}_delayed_erase",
        "success": bool(episode.success()),
        "failure_cause": _failure_cause(episode),
        "final_action": {
            "gate": int(gate),
            "frequency": float(frequency),
            "frequency_index": int(frequency_index),
        },
        "gate_probabilities": np.asarray(trace["gate_probs"], dtype=np.float64).tolist(),
        "frequency_probabilities": np.asarray(trace["frequency_probs"], dtype=np.float64).tolist(),
        "rows": rows,
        "schedule_audit": prepared["schedule_audit"],
        "note_hidden_validated": bool(prepared["schedule_audit"]["hidden_goal_bearing_fields_validated"]),
        "tool_calls": int(episode.tool_calls),
        "virtual_steps": int(episode.virtual_steps),
        "virtual_work": float(episode.virtual_work),
        "live_work_spent": float(episode.world.work_spent),
        "physics_steps": int(episode.world.physics_steps),
        "world_residual": float(episode.world.residual),
        "world_work": float(episode.world.work),
        "world_dissipated": float(episode.world.dissipated),
        "authoritative_note_digest": episode.workspace.digest(),
    }


def _oracle_delayed_run(spec: dict, prepared: dict) -> dict:
    episode = CorrectedEpisode.restore(json.loads(json.dumps(prepared["episode_snapshot"], sort_keys=True)))
    gate = int(episode.oracle_action())
    frequency_index = int(spec["goal_index"])
    frequency = float(PROBE_FREQUENCIES[frequency_index])
    result = episode.execute_actuation(gate, drive_frequency=frequency)
    return {
        "split": spec["split"],
        "world_seed": int(spec["world_seed"]),
        "goal_index": int(spec["goal_index"]),
        "note_goal_id": spec["note_goal_id"],
        "success": bool(episode.success()),
        "failure": None if episode.success() else "oracle_reference_failed",
        "final_action": {"gate": gate, "frequency_index": frequency_index},
        "schedule_audit": prepared["schedule_audit"],
        "note_hidden_validated": bool(prepared["schedule_audit"]["hidden_goal_bearing_fields_validated"]),
        "result_schema": result.get("schema"),
        "physics_steps": int(episode.world.physics_steps),
        "world_residual": float(episode.world.residual),
    }


def _save_delayed_checkpoint(path: Path, model, training: dict, normalization: dict, source_sha: str | None) -> str:
    if path.exists():
        raise FileExistsError(f"refusing to overwrite checkpoint: {path}")
    payload = {
        "schema": "vevo.v03.neural-delayed-memory-checkpoint.v1",
        "contract_path": CONTRACT_PATH,
        "source_sha": source_sha,
        "model_class": type(model).__name__,
        "seed": int(model.seed),
        "brain_count": int(model.brain_count),
        "parameter_count": int(model.parameter_count()),
        "memory_shape": list(model.central_memory_shape),
        "normalization": copy.deepcopy(normalization),
        "schedule": {
            "policy_observation_count": 5,
            "retention_delay_steps": RETENTION_DELAY_STEPS,
            "note_payload_masks": [0, 1, 0, 0, 0],
        },
        "state": model.state_dict(),
        "training": {
            "updates": int(training["updates"]),
            "stopped_reason": training["stopped_reason"],
            "rng_state": training["rng_state"],
            "shuffle_order": training["shuffle_order"],
            "next_minibatch_index": int(training["next_minibatch_index"]),
            "next_cycle_requires_shuffle": bool(training["next_cycle_requires_shuffle"]),
            "optimizer_first": {name: value.tolist() for name, value in training["optimizer_first"].items()},
            "optimizer_second": {name: value.tolist() for name, value in training["optimizer_second"].items()},
        },
    }
    _atomic_write_json(path, payload)
    return _json_digest(payload)


def _trial_key(label: str, seed: int) -> str:
    return f"{label}-seed-{int(seed)}"


def _world_clustered_metrics(runs: list[dict]) -> list[dict]:
    clusters = []
    for world_seed in HELDOUT_WORLD_SEEDS:
        cluster = [run for run in runs if int(run["world_seed"]) == int(world_seed)]
        clusters.append({
            "world_seed": int(world_seed),
            "n": len(cluster),
            "physical_successes": int(sum(bool(run["success"]) for run in cluster)),
            "success_rate": float(np.mean([run["success"] for run in cluster])) if cluster else 0.0,
            "goal_results": [
                {
                    "goal_index": int(run["goal_index"]),
                    "success": bool(run["success"]),
                    "gate": int(run["final_action"]["gate"]),
                    "frequency_index": int(run["final_action"]["frequency_index"]),
                }
                for run in cluster
            ],
        })
    return clusters


def _historical_digests(project_root: Path) -> dict[str, str]:
    paths = (
        "reports/generated/v03-neural-proof-report.json",
        "reports/generated/v03-neural-repair-report.json",
        "storage/checkpoints/v03-neural-full-selected.json",
        "storage/checkpoints/v03-neural-control-selected.json",
        "storage/checkpoints/v03-neural-repair-full-selected.json",
        "storage/checkpoints/v03-neural-repair-control-selected.json",
    )
    return {
        path: _sha256_file(project_root / path)
        for path in paths
    }


def run_experiment(*, output_path: str | Path = REPORT_PATH, wall_clock_cap: float = WALL_CLOCK_CAP_SECONDS) -> dict:
    start_wall = time.perf_counter()
    start_cpu = time.process_time()
    deadline = start_wall + float(wall_clock_cap)
    output = Path(output_path)
    if output.exists():
        raise FileExistsError(f"refusing to overwrite report: {output}")
    project_root = Path(__file__).resolve().parents[2]
    source_sha = _source_sha()
    contract_file = project_root / CONTRACT_PATH
    historical_before = _historical_digests(project_root)
    train_specs = make_training_specs()
    heldout_specs = make_heldout_specs()
    train_examples = build_delayed_examples(train_specs)
    normalization = fit_input_normalization(_training_observations(train_examples))
    hidden_normalization = _validate_hidden_normalization(train_examples, normalization)
    prepared_train = _prepared_by_identity(train_specs)
    failures = []
    cap_termination = False
    trial_models = []
    trial_records = []
    checkpoint_records = {}

    expected_trials = [
        (V03FiveBrain, "full", seed) for seed in DELAYED_MODEL_SEEDS
    ] + [
        (V03SingleRecurrentMemory, "control", seed) for seed in DELAYED_CONTROL_SEEDS
    ]
    for model_class, label, model_seed in expected_trials:
        key = _trial_key(label, model_seed)
        if time.perf_counter() >= deadline:
            cap_termination = True
            failures.append(f"wall-clock cap before training {key}")
            trial_records.append({
                "label": label,
                "model_seed": int(model_seed),
                "optimizer_seed": int(model_seed + 1000),
                "status": "not_run_wall_clock_cap",
            })
            continue
        model = model_class(model_seed)
        model.set_input_normalization(normalization)
        training = _train_delayed(
            model,
            train_examples,
            seed=model_seed + 1000,
            start_time=start_wall,
            deadline=deadline,
        )
        if training["stopped_reason"]:
            cap_termination = True
            failures.append(f"{key}: {training['stopped_reason']}")
        checkpoint_path = project_root / "storage" / "checkpoints" / f"{CHECKPOINT_PREFIX}-{label}-seed-{model_seed}.json"
        checkpoint_digest = _save_delayed_checkpoint(checkpoint_path, model, training, normalization, source_sha)
        checkpoint_records[key] = {
            "path": str(checkpoint_path.relative_to(project_root)),
            "digest": checkpoint_digest,
        }
        trial_models.append({
            "key": key,
            "label": label,
            "model_seed": int(model_seed),
            "optimizer_seed": int(model_seed + 1000),
            "model": model,
            "training": training,
        })
        trial_records.append({
            "key": key,
            "label": label,
            "model_seed": int(model_seed),
            "optimizer_seed": int(model_seed + 1000),
            "status": "trained",
            "parameter_count": int(model.parameter_count()),
            "brain_count": int(model.brain_count),
            "updates": int(training["updates"]),
            "stopped_reason": training["stopped_reason"],
            "parameter_delta_l2": float(training["parameter_delta_l2"]),
            "history": training["history"],
        })

    oracle_runs = []
    references = {"oracle_feasibility": {}, "untrained": {}}
    retention = {}
    if not cap_termination:
        oracle_runs = [_oracle_delayed_run(spec, prepared_train[_spec_identity(spec)]) for spec in train_specs]
        references["oracle_feasibility"] = {
            "training_microset": {
                "runs": oracle_runs,
                "summary": _run_summary(oracle_runs),
            },
        }

    for trial in trial_models:
        key = trial["key"]
        model = trial["model"]
        prediction_metrics = _prediction_metrics(model, train_examples)
        retention_entry = {
            "architecture": trial["label"],
            "model_seed": trial["model_seed"],
            "ordinary": None,
            "conditions": {},
            "causal_interpretation_allowed": False,
            "status": "not_run_wall_clock_cap" if cap_termination else "pending",
        }
        if cap_termination:
            retention[key] = retention_entry
            trial["training_metrics"] = prediction_metrics
            continue
        baseline_runs = [
            run_delayed_episode(
                model,
                spec,
                prepared=prepared_train[_spec_identity(spec)],
            )
            for spec in train_specs
        ]
        _validate_run_identities(baseline_runs, train_specs)
        ordinary_summary = _run_summary(baseline_runs)
        retention_entry["ordinary"] = {
            "state_scope": "none",
            "runs": baseline_runs,
            "summary": ordinary_summary,
        }
        retention_entry["causal_interpretation_allowed"] = bool(ordinary_summary["successes"] > 0)
        retention_entry["causal_interpretation_reason"] = (
            "ordinary delayed recall has at least one success"
            if retention_entry["causal_interpretation_allowed"]
            else "ordinary delayed recall has zero successes; causal erasure evidence is not interpreted"
        )
        prediction_metrics["physical_success"] = int(ordinary_summary["successes"])
        prediction_metrics["physical_success_rate"] = float(ordinary_summary["success_rate"])
        prediction_metrics["ordinary_run_summary"] = ordinary_summary
        for condition, erasure, state_scope in RETENTION_CONDITIONS[1:]:
            if time.perf_counter() >= deadline:
                cap_termination = True
                failures.append(f"wall-clock cap during retention {key}/{condition}")
                retention_entry["status"] = "partial_wall_clock_cap"
                break
            runs = [
                run_delayed_episode(
                    model,
                    spec,
                    erasure=erasure,
                    prepared=prepared_train[_spec_identity(spec)],
                )
                for spec in train_specs
            ]
            _validate_run_identities(runs, train_specs)
            retention_entry["conditions"][condition] = {
                "state_scope": state_scope,
                "runs": runs,
                "summary": _run_summary(runs),
                "paired_ablation": _paired_ablation_summary(baseline_runs, runs),
            }
        retention_entry["status"] = "complete" if not cap_termination else retention_entry["status"]
        retention[key] = retention_entry
        trial["training_metrics"] = prediction_metrics

    if not cap_termination:
        for label, model_class, seed in (
            ("full", V03FiveBrain, DELAYED_MODEL_SEEDS[0]),
            ("control", V03SingleRecurrentMemory, DELAYED_CONTROL_SEEDS[0]),
        ):
            model = model_class(seed)
            model.set_input_normalization(normalization)
            reference_runs = [
                run_delayed_episode(
                    model,
                    spec,
                    prepared=prepared_train[_spec_identity(spec)],
                )
                for spec in train_specs
            ]
            references["untrained"][label] = {
                "model_seed": int(seed),
                "updates": 0,
                "metrics": _prediction_metrics(model, train_examples),
                "physical_success": int(sum(bool(run["success"]) for run in reference_runs)),
                "runs": reference_runs,
                "summary": _run_summary(reference_runs),
            }

    completed_trial_records = [
        trial for trial in trial_models
        if trial.get("training", {}).get("stopped_reason") is None
    ]
    all_four_delayed_training_success = bool(
        len(completed_trial_records) == 4
        and all(
            trial.get("training_metrics", {}).get("physical_success") == len(train_specs)
            for trial in completed_trial_records
        )
        and not cap_termination
    )
    heldout = {
        "status": "not_evaluated",
        "reason": (
            "requires all four completed trials to achieve 8/8 delayed training success"
        ),
        "world_seeds": list(HELDOUT_WORLD_SEEDS),
        "goal_count_per_world": len(PROBE_FREQUENCIES),
        "runs": {},
    }
    if all_four_delayed_training_success:
        heldout_examples = build_delayed_examples(heldout_specs)
        prepared_heldout = _prepared_by_identity(heldout_specs)
        heldout["status"] = "evaluated_once"
        heldout["reason"] = None
        heldout["normalization_source"] = "delayed training microset only"
        heldout["used_for_gradients"] = False
        heldout["used_for_hyperparameters"] = False
        heldout["used_for_checkpoint_selection"] = False
        for trial in trial_models:
            if time.perf_counter() >= deadline:
                cap_termination = True
                failures.append(f"wall-clock cap before held-out evaluation {trial['key']}")
                heldout["status"] = "partial_wall_clock_cap"
                break
            runs = [
                run_delayed_episode(
                    trial["model"],
                    spec,
                    prepared=prepared_heldout[_spec_identity(spec)],
                )
                for spec in heldout_specs
            ]
            _validate_run_identities(runs, heldout_specs)
            metrics = _prediction_metrics(trial["model"], heldout_examples, include_loss=False)
            metrics["physical_success"] = int(sum(bool(run["success"]) for run in runs))
            metrics["physical_success_rate"] = float(np.mean([run["success"] for run in runs]))
            heldout["runs"][trial["key"]] = {
                "architecture": trial["label"],
                "model_seed": trial["model_seed"],
                "metrics": metrics,
                "runs": runs,
                "summary": _run_summary(runs),
                "world_clustered": _world_clustered_metrics(runs),
            }

    if not all_four_delayed_training_success and not cap_termination:
        heldout["reason"] = "microset failed the 8/8 criterion; stopped at diagnosis without held-out expansion"

    historical_after = _historical_digests(project_root)
    runtime_wall = time.perf_counter() - start_wall
    runtime_cpu = time.process_time() - start_cpu
    trial_by_key = {trial["key"]: trial for trial in trial_models}
    for trial_record in trial_records:
        trial = trial_by_key.get(trial_record.get("key"))
        if trial is not None:
            trial_record["training_metrics"] = trial.get("training_metrics")
    report = {
        "schema": "vevo.v03.neural-delayed-memory-report.v1",
        "contract_path": CONTRACT_PATH,
        "source_sha": source_sha,
        "command": " ".join(sys.argv),
        "architecture": {
            "full_model": "V03FiveBrain",
            "matched_control": "V03SingleRecurrentMemory",
            "full_brains": 5,
            "control_brains": 1,
            "full_parameter_count": int(V03FiveBrain(DELAYED_MODEL_SEEDS[0]).parameter_count()),
            "control_parameter_count": int(V03SingleRecurrentMemory(DELAYED_CONTROL_SEEDS[0]).parameter_count()),
            "comparison_note": "No five-component superiority claim is made from component count.",
        },
        "schedule": {
            "policy_observation_count": 5,
            "stages": [
                "before_note",
                "note_shown_once",
                "goal_independent_delay_1",
                "goal_independent_delay_2",
                "spectrum_and_action",
            ],
            "note_payload_masks": [0, 1, 0, 0, 0],
            "hidden_note_validation": {
                "training": hidden_normalization,
                "all_training_examples_note_shown_once": all(
                    example["schedule_audit"]["note_shown_once"] for example in train_examples
                ),
            },
        },
        "data": {
            "training_world_seeds": list(DELAYED_TRAIN_WORLD_SEEDS),
            "training_example_count": len(train_examples),
            "goals_per_world": len(PROBE_FREQUENCIES),
            "training_input_digest": _json_digest(_training_observations(train_examples)),
            "normalization_fit_scope": "five-step delayed training observations only",
            "normalization": normalization,
            "heldout_world_seeds_predeclared": list(HELDOUT_WORLD_SEEDS),
            "heldout_world_seeds_disjoint_from_historical": not (set(HELDOUT_WORLD_SEEDS) & HISTORICAL_WORLD_SEEDS),
        },
        "optimizer": {
            "method": "balanced size-one minibatches with the existing Adam-style reverse-mode update",
            "learning_rate": float(LEARNING_RATE),
            "gradient_clip_norm": float(GRADIENT_CLIP_NORM),
            "max_updates_per_trial": MAX_UPDATES,
            "exact_resume_verified": False,
            "post_outcome_retuning_or_restart": False,
        },
        "training": {
            "full_model_seeds": list(DELAYED_MODEL_SEEDS),
            "control_seeds": list(DELAYED_CONTROL_SEEDS),
            "trials": trial_records,
            "all_four_delayed_training_success_8_of_8": all_four_delayed_training_success,
            "microset_diagnosis": "passed 8/8 for all four trials" if all_four_delayed_training_success else "at least one trial did not reach 8/8; no held-out expansion",
        },
        "retention": {
            "conditions": [
                {"name": name, "erasure": erasure, "state_scope": scope}
                for name, erasure, scope in RETENTION_CONDITIONS
            ],
            "models": retention,
            "pair_identity_validation": "world_seed, goal_index, and note_goal_id validated for every ordinary/ablation pair",
        },
        "references": references,
        "heldout": heldout,
        "checkpoints": checkpoint_records,
        "historical_artifacts": {
            "before": historical_before,
            "after": historical_after,
            "unchanged": historical_before == historical_after,
        },
        "limitations": [
            "This is a bounded delayed-memory RNN experiment, not a complete EvoCell or general agent.",
            "Causal erasure evidence is interpreted only after ordinary delayed recall succeeds for the same model.",
            "Slot-memory and recurrent-state erasures are distinct interventions; all-state combines them.",
            "The held-out set, when evaluated, is one fixed fresh world cluster and does not establish broad generalization.",
            "The fixed schedule does not establish learned tool selection or complete tool-result writeback learning.",
            "Exact optimizer resume remains unverified.",
            "No user-PC, production, deployment, paid compute, credentials, merge, or PR action was used.",
        ],
        "runtime": {
            "wall_clock_cap_seconds": float(wall_clock_cap),
            "wall_clock_seconds": float(runtime_wall),
            "process_cpu_seconds": float(runtime_cpu),
            "single_cpu_process": True,
            "python": platform.python_version(),
            "max_rss_kb": int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss),
            "cap_termination": bool(cap_termination),
            "within_wall_clock_cap": bool(runtime_wall <= float(wall_clock_cap)),
            "failures": failures,
        },
    }
    _atomic_write_json(output, report)
    return report


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=REPORT_PATH)
    parser.add_argument("--wall-clock-cap", type=float, default=WALL_CLOCK_CAP_SECONDS)
    args = parser.parse_args()
    report = run_experiment(output_path=args.output, wall_clock_cap=args.wall_clock_cap)
    print(json.dumps({
        "schema": report["schema"],
        "source_sha": report["source_sha"],
        "all_four_delayed_training_success_8_of_8": report["training"]["all_four_delayed_training_success_8_of_8"],
        "heldout_status": report["heldout"]["status"],
        "runtime": report["runtime"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
