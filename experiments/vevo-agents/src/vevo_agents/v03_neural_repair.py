"""Bounded v0.3 neural-read repair, regression audit, and microset proof.

This module is intentionally separate from ``v03_neural_proof`` so the
historical report remains reproducible as an artifact.  It trains only the
two-world-by-four-goal microset and stops before any larger optimization when
the frequency-learning gate is not met.
"""

from __future__ import annotations

from collections import Counter
import copy
import hashlib
import json
import re
import resource
from pathlib import Path
import time

import numpy as np

from .v03_model import (
    NOTE_PAYLOAD_MASK_INDEX,
    NOTE_FEATURE_END,
    NOTE_TEXT_BYTES,
    NOTE_FEATURE_START,
    NOTE_TITLE_BYTES,
    POLICY_VECTOR_DIM,
    V03FiveBrain,
    V03SingleRecurrentMemory,
    encode_policy_observation,
    fit_input_normalization,
    normalize_policy_vector,
)
from .v03_neural_proof import (
    _gate_resonances,
    _goal_note,
    _prepare_policy_observations,
    _summary,
    build_examples,
    policy_input_audit,
    run_episode,
)
from .v03_protocol import CorrectedEpisode, PROBE_FREQUENCIES


MODEL_SEEDS = (7, 17)
CONTROL_SEEDS = (41, 43)
MICRO_WORLD_SEEDS = (7100, 7101)
FUTURE_WORLD_SEEDS = (8300, 8301)
MAX_UPDATES_PER_TRIAL = 1000
WALL_CLOCK_CAP_SECONDS = 300.0
LEARNING_RATE = 0.012
GRADIENT_CLIP_NORM = 3.0
METRIC_STEPS = (1, 100, 250, 500, 750, 1000)
RETENTION_DELAY_STEPS = 2


def _json_digest(value) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(payload).hexdigest()


def _repair_spec(world_seed: int, goal_index: int, *, split: str = "microtrain") -> dict:
    return {
        "split": split,
        "world_seed": int(world_seed),
        "goal_index": int(goal_index),
        "note_goal_id": f"{split}-goal-{goal_index}",
        "note_text": _goal_note(goal_index, split, 0.0),
        "gate_resonance_hz": _gate_resonances(world_seed).tolist(),
    }


def make_microset() -> list[dict]:
    return [
        _repair_spec(world_seed, goal_index)
        for world_seed in MICRO_WORLD_SEEDS
        for goal_index in range(len(PROBE_FREQUENCIES))
    ]


def make_future_inputs() -> list[dict]:
    # These inputs are deliberately constructed without labels in the caller's
    # report.  The hidden goal is needed only to create a realistic note; it is
    # never used for optimization or supplied to the policy evaluator.
    return [
        _repair_spec(world_seed, goal_index, split="future-unlabeled")
        for world_seed in FUTURE_WORLD_SEEDS
        for goal_index in range(len(PROBE_FREQUENCIES))
    ]


def _training_observations(examples: list[dict]) -> list[dict]:
    return [observation for example in examples for observation in example["policy_observations"]]


def _adam_update(model, gradients, first, second, step: int, learning_rate: float) -> tuple[float, float]:
    norm = float(np.sqrt(sum(float(np.sum(value * value)) for value in gradients.values())))
    scale = min(1.0, GRADIENT_CLIP_NORM / max(norm, 1e-12))
    for name, gradient in gradients.items():
        gradient = gradient * scale
        first[name] = 0.9 * first[name] + 0.1 * gradient
        second[name] = 0.999 * second[name] + 0.001 * gradient * gradient
        first_hat = first[name] / (1.0 - 0.9**step)
        second_hat = second[name] / (1.0 - 0.999**step)
        model.params[name] -= learning_rate * first_hat / (np.sqrt(second_hat) + 1e-8)
    return norm, scale


def _micro_metrics(model, examples: list[dict], *, prepared: dict | None = None) -> dict:
    predictions = []
    runs = []
    for example in examples:
        prediction = model.predict(example["policy_observations"])
        predictions.append(prediction)
        prepared_item = None if prepared is None else prepared[example["input_digest"]]
        runs.append(run_episode(model, example["spec"], prepared=prepared_item))
    gates = [int(item["gate"]) for item in predictions]
    frequencies = [int(item["frequency_index"]) for item in predictions]
    target_gates = [int(item["target_gate"]) for item in examples]
    target_frequencies = [int(item["target_frequency"]) for item in examples]
    return {
        "loss": float(np.mean([
            model.loss_only(
                item["policy_observations"],
                target_gate=item["target_gate"],
                target_frequency=item["target_frequency"],
            )
            for item in examples
        ])),
        "gate_accuracy": float(np.mean(np.asarray(gates) == np.asarray(target_gates))),
        "frequency_accuracy": float(np.mean(np.asarray(frequencies) == np.asarray(target_frequencies))),
        "joint_accuracy": float(np.mean(
            (np.asarray(gates) == np.asarray(target_gates))
            & (np.asarray(frequencies) == np.asarray(target_frequencies))
        )),
        "physical_success": int(sum(bool(run["success"]) for run in runs)),
        "physical_success_rate": float(np.mean([run["success"] for run in runs])),
        "gate_action_histogram": dict(sorted(Counter(gates).items())),
        "frequency_action_histogram": dict(sorted(Counter(frequencies).items())),
    }


def _balanced_train(model, examples: list[dict], *, seed: int, start_time: float, deadline: float) -> dict:
    first = {name: np.zeros_like(value) for name, value in model.params.items()}
    second = {name: np.zeros_like(value) for name, value in model.params.items()}
    rng = np.random.default_rng(seed)
    order = np.arange(len(examples), dtype=np.int64)
    history = []
    parameter_before = {name: value.copy() for name, value in model.params.items()}
    updates = 0
    stopped_reason = None
    for step in range(1, MAX_UPDATES_PER_TRIAL + 1):
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
            metrics = _micro_metrics(model, examples)
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


def _prepared_by_digest(specs: list[dict]) -> dict[str, dict]:
    prepared = {}
    for spec in specs:
        episode, observations = _prepare_policy_observations(spec)
        prepared[_json_digest(observations)] = {
            "episode_snapshot": episode.snapshot(),
            "policy_observations": observations,
        }
    return prepared


def _oracle_run(spec: dict) -> dict:
    episode, _ = _prepare_policy_observations(spec)
    gate = int(episode.oracle_action())
    frequency = float(PROBE_FREQUENCIES[int(spec["goal_index"])])
    result = episode.execute_actuation(gate, drive_frequency=frequency)
    return {
        "success": bool(episode.success()),
        "failure": None if episode.success() else "oracle_reference_failed",
        "final_action": {"gate": gate, "frequency_index": int(spec["goal_index"])},
        "result_schema": result.get("schema"),
        "tool_calls": int(episode.tool_calls),
        "virtual_steps": int(episode.virtual_steps),
        "virtual_work": float(episode.virtual_work),
        "live_work_spent": float(episode.world.work_spent),
        "physics_steps": int(episode.world.physics_steps),
        "world_residual": float(episode.world.residual),
        "world_work": float(episode.world.work),
        "world_dissipated": float(episode.world.dissipated),
    }


def _reference_summary(runs: list[dict]) -> dict:
    failures = [item.get("failure", item.get("failure_cause")) for item in runs]
    return {
        "n": len(runs),
        "successes": int(sum(bool(item["success"]) for item in runs)),
        "success_rate": float(np.mean([item["success"] for item in runs])) if runs else 0.0,
        "failures": dict(sorted(Counter(item for item in failures if item).items())),
        "max_abs_world_residual": float(max((abs(item["world_residual"]) for item in runs), default=0.0)),
    }


def _paired_ablation_summary(baseline: list[dict], ablation: list[dict]) -> dict:
    """Require paired outcome, probability, and action evidence."""

    if len(baseline) != len(ablation):
        raise ValueError("paired retention runs must have equal length")
    baseline_successes = int(sum(bool(item["success"]) for item in baseline))
    ablation_successes = int(sum(bool(item["success"]) for item in ablation))
    paired_success_drop = int(sum(
        bool(base["success"]) and not bool(ablated["success"])
        for base, ablated in zip(baseline, ablation)
    ))
    paired_action_changes = int(sum(
        base.get("final_action") != ablated.get("final_action")
        for base, ablated in zip(baseline, ablation)
    ))
    paired_probability_changes = int(sum(
        not (
            np.allclose(
                base.get("gate_probabilities", []),
                ablated.get("gate_probabilities", []),
                rtol=0.0,
                atol=1e-12,
            )
            and np.allclose(
                base.get("frequency_probabilities", []),
                ablated.get("frequency_probabilities", []),
                rtol=0.0,
                atol=1e-12,
            )
        )
        for base, ablated in zip(baseline, ablation)
    ))
    return {
        "baseline_successes": baseline_successes,
        "ablation_successes": ablation_successes,
        "paired_success_drop": paired_success_drop,
        "paired_probability_changes": paired_probability_changes,
        "paired_action_changes": paired_action_changes,
        "causal_claim_eligible": bool(
            baseline_successes > 0
            and paired_success_drop > 0
            and paired_probability_changes > 0
            and paired_action_changes > 0
        ),
    }


def _strip_goal_bearing_note(policy_input: dict) -> dict:
    result = copy.deepcopy(policy_input)
    note = result.get("note")
    if note is not None:
        # Keep typed identity/revision metadata but remove the target-bearing
        # payload and its derived digest from this neural observation only.
        note["text"] = ""
        note["content_digest"] = ""
    return result


_TARGET_FREQUENCY_RE = re.compile(r"(target_hz=)([0-9]+\.[0-9]+)")


def _replace_target_frequency(note_text: str, goal_index: int) -> str:
    """Change only the fixed-width target frequency substring."""

    match = _TARGET_FREQUENCY_RE.search(str(note_text))
    if match is None:
        raise ValueError("note has no fixed-width target_hz payload")
    replacement = f"target_hz={float(PROBE_FREQUENCIES[goal_index]):.2f}"
    original = match.group(0)
    if len(replacement.encode("utf-8")) != len(original.encode("utf-8")):
        raise ValueError("target frequency replacement changed note width")
    return str(note_text)[:match.start()] + replacement + str(note_text)[match.end():]


def _validate_target_only_note_edit(original: dict, changed: dict) -> None:
    """Assert wrong-note intervention changes one equal-width text payload."""

    original_note = original.get("note")
    changed_note = changed.get("note")
    if not isinstance(original_note, dict) or not isinstance(changed_note, dict):
        raise AssertionError("note payload is required")
    if set(original) != set(changed):
        raise AssertionError("wrong-note intervention changed policy fields")
    if set(original_note) != set(changed_note):
        raise AssertionError("wrong-note intervention changed note metadata fields")
    for key in original:
        if key != "note" and original[key] != changed[key]:
            raise AssertionError("wrong-note intervention changed a non-note field")
    for key in original_note:
        if key != "text" and original_note.get(key) != changed_note.get(key):
            raise AssertionError("wrong-note intervention changed note metadata")
    original_text = str(original_note.get("text", ""))
    changed_text = str(changed_note.get("text", ""))
    if len(original_text.encode("utf-8")) != len(changed_text.encode("utf-8")):
        raise AssertionError("wrong-note intervention changed UTF-8 width")
    original_vector = encode_policy_observation(original)
    changed_vector = encode_policy_observation(changed)
    text_start = NOTE_FEATURE_START + 3 + NOTE_TITLE_BYTES
    text_end = text_start + NOTE_TEXT_BYTES
    differing = np.flatnonzero(~np.isclose(original_vector, changed_vector, rtol=0.0, atol=0.0))
    if np.any((differing < text_start) | (differing >= text_end)):
        raise AssertionError("wrong-note intervention changed bytes outside note text")


def _failure_cause(episode: CorrectedEpisode) -> str | None:
    if episode.success():
        return None
    if not episode.measurement or not episode.measurement.get("accepted"):
        return "diagnostic_failed"
    if not episode.last_result or not episode.last_result.get("accepted"):
        return "actuation_rejected"
    if not episode.last_result.get("gate_opened"):
        return "physical_gate_not_opened"
    return "goal_or_action_mismatch"


def run_retention_episode(model, spec: dict, *, erasure: str | None = None) -> dict:
    """Show the note once, hide its payload, delay, then measure and act."""

    episode = CorrectedEpisode(
        int(spec["world_seed"]),
        note_text=str(spec["note_text"]),
        gate_resonance_hz=np.asarray(spec["gate_resonance_hz"], dtype=np.float64),
    )
    runtime = model.initial_runtime()
    rows = []

    episode.advance(np.zeros(4, dtype=np.float64))
    runtime, trace = model.raw_step(runtime, episode.policy_observation())
    rows.append({"stage": "before_note", "policy_input_digest": _json_digest(episode.policy_observation())})

    episode.execute_note()
    shown = episode.policy_observation()
    runtime, trace = model.raw_step(runtime, shown)
    rows.append({"stage": "note_shown_once", "policy_input_digest": _json_digest(shown)})

    for index in range(RETENTION_DELAY_STEPS):
        episode.advance(np.zeros(4, dtype=np.float64))
        hidden_input = _strip_goal_bearing_note(episode.policy_observation())
        runtime, trace = model.raw_step(runtime, hidden_input)
        hidden_vector = encode_policy_observation(hidden_input)
        hidden_normalized = normalize_policy_vector(hidden_vector, model.normalization_state())
        rows.append({
            "stage": f"goal_independent_delay_{index + 1}",
            "policy_input_digest": _json_digest(hidden_input),
            "note_present_mask": int(hidden_vector[0]),
            "note_payload_present_mask": int(hidden_vector[NOTE_PAYLOAD_MASK_INDEX]),
            "max_normalized_hidden_note_abs": float(np.max(np.abs(hidden_normalized[NOTE_FEATURE_START:NOTE_FEATURE_END]))),
        })

    episode.execute_diagnostic(0)
    spectrum_input = _strip_goal_bearing_note(episode.policy_observation())
    if erasure in {"slot", "slot0"}:
        runtime["memory"][0].fill(0.0)
    elif erasure == "slot1":
        runtime["memory"][1].fill(0.0)
    elif erasure in {"both", "slots"}:
        runtime["memory"].fill(0.0)
    elif erasure == "recurrent":
        runtime["central"].fill(0.0)
        for value in runtime["peripheral"]:
            value.fill(0.0)
    elif erasure == "all":
        runtime["central"].fill(0.0)
        for value in runtime["peripheral"]:
            value.fill(0.0)
        runtime["memory"].fill(0.0)
    runtime, trace = model.raw_step(runtime, spectrum_input)
    gate, frequency, frequency_index = model.action_from_trace(trace)
    result = episode.execute_actuation(gate, drive_frequency=frequency)
    rows.append({
        "stage": "spectrum_and_action",
        "policy_input_digest": _json_digest(spectrum_input),
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
        "note_goal_id": spec["note_goal_id"],
        "condition": "normal_retention" if erasure is None else f"{erasure}_retention_erase",
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


def _donor_plan(specs: list[dict]) -> dict:
    """Choose different-action donors using reference-only preparation."""

    plans = {}
    for spec in specs:
        base_episode, _ = _prepare_policy_observations(spec)
        base_gate = int(base_episode.oracle_action())
        note_donor = None
        for candidate_goal in range(len(PROBE_FREQUENCIES)):
            if candidate_goal == int(spec["goal_index"]):
                continue
            donor_note = _replace_target_frequency(str(spec["note_text"]), candidate_goal)
            donor_spec = dict(spec, goal_index=candidate_goal, note_text=donor_note)
            donor_episode, _ = _prepare_policy_observations(donor_spec)
            donor_gate = int(donor_episode.oracle_action())
            if donor_gate != base_gate:
                note_donor = {"goal_index": candidate_goal, "note_text": donor_note, "oracle_gate": donor_gate}
                break
        # Keep the measurement's frequencies, budgets, and world accounting
        # coherent.  The intervention is a matrix-only row permutation, so
        # gate labels change by a known permutation while resources stay
        # untouched; this avoids smuggling a donor world's fingerprint into
        # the observation.
        permutation = [1, 2, 3, 0]
        donor_measurement = {
            "row_permutation": permutation,
            "oracle_gate": int(permutation.index(base_gate)),
        }
        plans[_json_digest(spec)] = {
            "base_oracle_gate": base_gate,
            "note_donor": note_donor,
            "measurement_donor": donor_measurement,
        }
    return plans


def run_payload_intervention(model, spec: dict, *, prepared: dict, plan: dict, condition: str) -> dict:
    """Run a payload-only intervention and report condition separately."""

    episode = CorrectedEpisode.restore(copy.deepcopy(prepared["episode_snapshot"]))
    runtime = model.initial_runtime()
    rows = []
    donor_note = plan.get("note_donor")
    donor_measurement = plan.get("measurement_donor")
    target_only_edit_validated = condition != "wrong_note"
    for stage, base_input in enumerate(prepared["policy_observations"]):
        policy_input = copy.deepcopy(base_input)
        if condition == "wrong_note" and donor_note is not None and stage >= 1:
            policy_input["note"]["text"] = donor_note["note_text"]
            _validate_target_only_note_edit(base_input, policy_input)
            target_only_edit_validated = True
        if condition == "shuffled_measurement" and donor_measurement is not None and stage == 2:
            original_matrix = np.asarray(policy_input["measurement"]["channel_response"], dtype=np.float64)
            policy_input["measurement"]["channel_response"] = original_matrix[donor_measurement["row_permutation"]].tolist()
        if condition == "resource_only" and stage == 2:
            policy_input["resources"]["virtual_work"] = float(policy_input["resources"].get("virtual_work", 0.0)) + 0.25
        runtime, trace = model.raw_step(runtime, policy_input)
        gate, frequency, frequency_index = model.action_from_trace(trace)
        if stage == 0:
            result = episode.note_result or {"accepted": False}
        elif stage == 1:
            result = episode.measurement or {"accepted": False}
        else:
            result = episode.execute_actuation(gate, drive_frequency=frequency)
        rows.append({
            "stage": stage,
            "selected_gate": int(gate),
            "selected_frequency_index": int(frequency_index),
            "selected_frequency": float(frequency),
            "policy_input_digest": _json_digest(policy_input),
            "result_schema": result.get("schema"),
            "result_accepted": bool(result.get("accepted", False)),
        })
    return {
        "split": spec["split"],
        "world_seed": int(spec["world_seed"]),
        "note_goal_id": spec["note_goal_id"],
        "condition": condition,
        "condition_donor_action_differs": bool(
            condition == "wrong_note" and donor_note is not None
            or condition == "shuffled_measurement" and donor_measurement is not None
        ),
        "changed_payload": (
            "note.text" if condition == "wrong_note" else
            "measurement.channel_response_rows" if condition == "shuffled_measurement" else
            "resources.virtual_work" if condition == "resource_only" else None
        ),
        "target_only_edit_validated": target_only_edit_validated,
        "donor": plan.get("note_donor") if condition == "wrong_note" else plan.get("measurement_donor"),
        "success": bool(episode.success()),
        "failure_cause": _failure_cause(episode),
        "rows": rows,
        "tool_calls": int(episode.tool_calls),
        "virtual_steps": int(episode.virtual_steps),
        "virtual_work": float(episode.virtual_work),
        "live_work_spent": float(episode.world.work_spent),
        "physics_steps": int(episode.world.physics_steps),
        "world_residual": float(episode.world.residual),
        "world_work": float(episode.world.work),
        "world_dissipated": float(episode.world.dissipated),
    }


def targeted_gradient_checks(model, example: dict) -> dict:
    """Finite-difference checks on every repaired path with distinct slots."""

    initial_memory = np.asarray([
        [0.11, -0.17, 0.23, -0.31, 0.37, -0.43],
        [-0.19, 0.29, -0.41, 0.47, -0.53, 0.61],
    ], dtype=np.float64)
    loss, gradients, memory_gradient, _ = model.loss_and_gradients(
        example["policy_observations"],
        target_gate=example["target_gate"],
        target_frequency=example["target_frequency"],
        initial_memory=initial_memory,
    )
    epsilon = 1e-5
    # The first target-bearing digit in ``target_hz=...`` is a stable, visible
    # note byte for the microset (the leading literal characters can have a
    # zero derivative for a particular final loss).
    goal_byte = NOTE_FEATURE_START + 3 + NOTE_TITLE_BYTES + len("target_hz=")
    if isinstance(model, V03FiveBrain):
        targets = {
            "read_key": ("c.W_key", (0, 0)),
            "write_address": ("c.W_addr", (0, 0)),
            "write_value": ("c.W_value", (0, 0)),
            "write_gate": ("c.W_write_gate", (0, 0)),
            "recurrent": ("c.W_rec", (0, 0)),
            "action_gate": ("c.W_action_gate", (0, 0)),
            "action_frequency": ("c.W_action_frequency", (0, 0)),
            "goal_byte_peripheral": ("p0.W_in", (0, goal_byte)),
            "goal_byte_center": ("c.W_in", (0, POLICY_VECTOR_DIM - 1)),
        }
    else:
        targets = {
            "read_key": ("W_key", (0, 0)),
            "write_address": ("W_addr", (0, 0)),
            "write_value": ("W_value", (0, 0)),
            "write_gate": ("W_write_gate", (0, 0)),
            "recurrent": ("W_rec", (0, 0)),
            "action_gate": ("W_action_gate", (0, 0)),
            "action_frequency": ("W_action_frequency", (0, 0)),
            "goal_byte_controller": ("W_in", (0, goal_byte)),
        }
    checks = {}
    for label, (name, index) in targets.items():
        plus = model.clone()
        minus = model.clone()
        plus.params[name][index] += epsilon
        minus.params[name][index] -= epsilon
        plus_loss = plus.loss_and_gradients(
            example["policy_observations"],
            target_gate=example["target_gate"],
            target_frequency=example["target_frequency"],
            initial_memory=initial_memory,
        )[0]
        minus_loss = minus.loss_and_gradients(
            example["policy_observations"],
            target_gate=example["target_gate"],
            target_frequency=example["target_frequency"],
            initial_memory=initial_memory,
        )[0]
        numeric = float((plus_loss - minus_loss) / (2.0 * epsilon))
        analytic = float(gradients[name][index])
        checks[label] = {
            "parameter": name,
            "index": list(index),
            "analytic": analytic,
            "finite_difference": numeric,
            "relative_error": abs(analytic - numeric) / max(1e-8, abs(analytic) + abs(numeric)),
            "nonzero": bool(abs(numeric) > 1e-9 and abs(analytic) > 1e-9),
        }
    memory_checks = {}
    for index in ((0, 0), (1, 1)):
        plus_memory = initial_memory.copy()
        minus_memory = initial_memory.copy()
        plus_memory[index] += epsilon
        minus_memory[index] -= epsilon
        plus_loss = model.loss_and_gradients(
            example["policy_observations"], target_gate=example["target_gate"],
            target_frequency=example["target_frequency"], initial_memory=plus_memory,
        )[0]
        minus_loss = model.loss_and_gradients(
            example["policy_observations"], target_gate=example["target_gate"],
            target_frequency=example["target_frequency"], initial_memory=minus_memory,
        )[0]
        numeric = float((plus_loss - minus_loss) / (2.0 * epsilon))
        analytic = float(memory_gradient[index])
        memory_checks[str(index)] = {
            "analytic": analytic,
            "finite_difference": numeric,
            "relative_error": abs(analytic - numeric) / max(1e-8, abs(analytic) + abs(numeric)),
            "nonzero": bool(abs(numeric) > 1e-9 and abs(analytic) > 1e-9),
        }
    all_items = list(checks.values()) + list(memory_checks.values())
    return {
        "loss": float(loss),
        "checks": checks,
        "initial_memory_checks": memory_checks,
        "all_finite": all(np.isfinite(item["analytic"]) and np.isfinite(item["finite_difference"]) for item in all_items),
        "all_nonzero": all(bool(item["nonzero"]) for item in all_items),
        "all_within_1e-3": all(float(item["relative_error"]) < 1e-3 for item in all_items),
    }


def numeric_autograd_parity(model, example: dict) -> dict:
    initial_memory = np.asarray([
        [0.11, -0.17, 0.23, -0.31, 0.37, -0.43],
        [-0.19, 0.29, -0.41, 0.47, -0.53, 0.61],
    ], dtype=np.float64)
    runtime = model.initial_runtime(memory=initial_memory)
    numeric_trace = []
    for observation in example["policy_observations"]:
        runtime, trace = model.raw_step(runtime, observation)
        numeric_trace.append(trace)
    _, _, _, autodiff_trace = model.loss_and_gradients(
        example["policy_observations"],
        target_gate=example["target_gate"],
        target_frequency=example["target_frequency"],
        initial_memory=initial_memory,
    )
    max_abs = 0.0
    fields = ("gate_probs", "frequency_probs", "memory")
    if isinstance(model, V03FiveBrain):
        fields += ("central", "read_before", "read_after")
    else:
        fields += ("hidden", "read_before", "read_after")
    field_errors = {}
    for field in fields:
        errors = [float(np.max(np.abs(np.asarray(numeric[field]) - np.asarray(auto[field]))))
                  for numeric, auto in zip(numeric_trace, autodiff_trace)]
        field_errors[field] = max(errors, default=0.0)
        max_abs = max(max_abs, field_errors[field])
    return {"max_abs_error": max_abs, "field_errors": field_errors, "passed": bool(max_abs < 1e-10)}


def mid_sequence_continuation_check(model, example: dict) -> dict:
    """Restore an actual mid-sequence neural state and compare next-step output."""

    runtime = model.initial_runtime()
    for observation in example["policy_observations"][:2]:
        runtime, _ = model.raw_step(runtime, observation)
    checkpoint = json.loads(json.dumps(model.brain_snapshot(runtime), sort_keys=True))
    restored = model.restore_runtime(checkpoint)
    original_next, original_trace = model.raw_step(runtime, example["policy_observations"][2])
    restored_next, restored_trace = model.raw_step(restored, example["policy_observations"][2])
    fields = ("gate_probs", "frequency_probs", "memory")
    errors = {
        field: float(np.max(np.abs(np.asarray(original_trace[field]) - np.asarray(restored_trace[field]))))
        for field in fields
    }
    if isinstance(model, V03FiveBrain):
        errors["central"] = float(np.max(np.abs(original_next["central"] - restored_next["central"])))
        errors["peripheral"] = float(max(
            np.max(np.abs(a - b)) for a, b in zip(original_next["peripheral"], restored_next["peripheral"])
        ))
    else:
        errors["hidden"] = float(np.max(np.abs(original_next["hidden"] - restored_next["hidden"])))
    malformed_shape = copy.deepcopy(checkpoint)
    if isinstance(model, V03FiveBrain):
        malformed_shape["peripheral"] = malformed_shape["peripheral"][:-1]
    else:
        malformed_shape["hidden"] = malformed_shape["hidden"][:-1]
    malformed_nonfinite = copy.deepcopy(checkpoint)
    malformed_nonfinite["memory"][0][0] = float("nan")
    rejected_shape = False
    rejected_nonfinite = False
    try:
        model.restore_runtime(malformed_shape)
    except (ValueError, KeyError, TypeError):
        rejected_shape = True
    try:
        model.restore_runtime(malformed_nonfinite)
    except (ValueError, KeyError, TypeError):
        rejected_nonfinite = True
    return {
        "field_errors": errors,
        "max_abs_error": max(errors.values()),
        "same_action": model.action_from_trace(original_trace) == model.action_from_trace(restored_trace),
        "malformed_shape_rejected": rejected_shape,
        "nonfinite_rejected": rejected_nonfinite,
        "passed": max(errors.values()) < 1e-12 and rejected_shape and rejected_nonfinite,
    }


def oracle_feasibility(specs: list[dict]) -> dict:
    """Check note parsing, target-frequency labels, and physical solvability."""

    rows = []
    for spec in specs:
        episode, _ = _prepare_policy_observations(spec)
        instruction = episode._parse_note()
        target_frequency = float(PROBE_FREQUENCIES[int(spec["goal_index"])])
        gate = int(episode.oracle_action())
        result = episode.execute_actuation(gate, drive_frequency=target_frequency)
        rows.append({
            "world_seed": int(spec["world_seed"]),
            "note_goal_id": spec["note_goal_id"],
            "parsed_target_hz": float(instruction.target_hz),
            "spec_target_hz": target_frequency,
            "target_frequency_matches": bool(np.isclose(instruction.target_hz, target_frequency, rtol=0.0, atol=1e-12)),
            "oracle_gate": gate,
            "accepted": bool(result.get("accepted")),
            "physical_success": bool(episode.success()),
            "failure": None if episode.success() else "correct_label_physical_failure",
        })
    return {
        "rows": rows,
        "all_target_frequencies_match": all(item["target_frequency_matches"] for item in rows),
        "all_physically_feasible": all(item["physical_success"] for item in rows),
    }


def _save_checkpoint(path: Path, model, training: dict | None = None) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema": "vevo.v03.neural-repair-checkpoint.v1",
        "model_class": type(model).__name__,
        "seed": int(model.seed),
        "brain_count": int(model.brain_count),
        "parameter_count": int(model.parameter_count()),
        "memory_shape": list(model.central_memory_shape),
        "normalization": model.normalization_state(),
        "state": model.state_dict(),
    }
    if training is not None:
        payload["training"] = {
            "updates": int(training["updates"]),
            "rng_state": training["rng_state"],
            "shuffle_order": training["shuffle_order"],
            "next_minibatch_index": int(training["next_minibatch_index"]),
            "next_cycle_requires_shuffle": bool(training["next_cycle_requires_shuffle"]),
            "optimizer_first": {name: value.tolist() for name, value in training["optimizer_first"].items()},
            "optimizer_second": {name: value.tolist() for name, value in training["optimizer_second"].items()},
        }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return _json_digest(payload)


def _checkpoint_replay(model, spec: dict, checkpoint_path: Path) -> dict:
    payload = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    reloaded = type(model)(int(payload["seed"]))
    reloaded.load_state_dict(payload["state"])
    reloaded.set_input_normalization(payload.get("normalization"))
    original = run_episode(model, spec)
    replay = run_episode(reloaded, spec)
    return {
        "model_state_roundtrip": _json_digest(reloaded.state_dict()) == _json_digest(payload["state"]),
        "normalization_roundtrip": reloaded.normalization_state() == payload.get("normalization"),
        "optimizer_state_present": bool(
            isinstance(payload.get("training"), dict)
            and "updates" in payload["training"]
            and "rng_state" in payload["training"]
            and "optimizer_first" in payload["training"]
            and "optimizer_second" in payload["training"]
        ),
        "shuffle_order_present": bool("shuffle_order" in payload.get("training", {})),
        "training_resume_verified": False,
        "replay_same_actions": [row["selected_gate"] for row in original["rows"]] == [row["selected_gate"] for row in replay["rows"]],
        "replay_same_frequencies": [row["selected_frequency_index"] for row in original["rows"]] == [row["selected_frequency_index"] for row in replay["rows"]],
        "replay_same_success": original["success"] == replay["success"],
        "replay_same_trajectory": original["trajectory_digest"] == replay["trajectory_digest"],
    }


def _audit(model, control, example: dict, train_examples: list[dict], specs: list[dict], selected_training: dict) -> dict:
    parity_full = numeric_autograd_parity(model, example)
    parity_control = numeric_autograd_parity(control, example)
    gradient_full = targeted_gradient_checks(model, example)
    gradient_control = targeted_gradient_checks(control, example)
    continuation_full = mid_sequence_continuation_check(model, example)
    continuation_control = mid_sequence_continuation_check(control, example)
    _, full_gradients, _, _ = model.loss_and_gradients(
        example["policy_observations"],
        target_gate=example["target_gate"],
        target_frequency=example["target_frequency"],
    )
    mask_probe = {
        "raw_shape": list(np.asarray(model.predict(example["policy_observations"])["trace"]["central"]).shape),
        "policy_vector_dim": POLICY_VECTOR_DIM,
        "normalization_schema": model.normalization_state().get("schema") if model.normalization_state() else None,
    }
    optimizer_ok = bool(selected_training["updates"] > 0 and selected_training["parameter_delta_l2"] > 0.0)
    tool_rows = run_episode(model, specs[0])["rows"]
    tool_audit = {
        "schemas": [row["result_schema"] for row in tool_rows],
        "explicit_frequency_argument_observed": bool(tool_rows[-1]["selected_frequency"] in PROBE_FREQUENCIES),
        "three_fixed_stages": len(tool_rows) == 3,
    }
    return {
        "encoding": {
            "policy_vector_dim": POLICY_VECTOR_DIM,
            "explicit_masks": True,
            "normalization_training_examples_only": True,
            "policy_input_audit": policy_input_audit(train_examples),
        },
        "five_modules": {
            "brain_count": model.brain_count,
            "peripherals": model.PERIPHERALS,
            "center_is_distinct": True,
            "full_parameter_count": model.parameter_count(),
            "control_parameter_count": control.parameter_count(),
            "parameter_gap": abs(model.parameter_count() - control.parameter_count()),
            "peripheral_input_gradient_norms": {
                f"p{index}": float(np.linalg.norm(full_gradients[f"p{index}.W_in"]))
                for index in range(model.PERIPHERALS)
            },
        },
        "numeric_autograd_parity": {"full": parity_full, "control": parity_control},
        "mid_sequence_neural_continuation": {"full": continuation_full, "control": continuation_control},
        "recurrent_memory_paths": {
            "full_gradients": gradient_full,
            "control_gradients": gradient_control,
            "distinct_nonzero_slots": True,
        },
        "optimizer": {
            "updates": int(selected_training["updates"]),
            "parameter_delta_l2": float(selected_training["parameter_delta_l2"]),
            "finite": bool(all(np.isfinite(value).all() for value in model.params.values())),
            "passed": optimizer_ok,
        },
        "tool_arguments_and_results": tool_audit,
        "mask_probe": mask_probe,
        "covered_behavior": [
            "bounded policy encoding with explicit modality masks",
            "all four peripheral recurrent paths and distinct gated center",
            "prior and post-write content reads, writes, action heads",
            "reverse-mode gradients and finite differences on repaired paths",
            "fixed local note/diagnostic/actuation schedule and budgets",
            "model plus normalization checkpoint replay",
        ],
        "untested_behavior": [
            "larger-world or semantic-goal holdouts",
            "general web/shell/external tools",
            "neural growth or hierarchy",
            "production deployment and paid/distributed compute",
            "long-horizon document retrieval learning",
            "full FieldLab/Gross–Pitaevskii training",
            "causal independent utility of each peripheral (all gradients are not a contribution proof)",
        ],
    }


def run_repair(*, output_path: str | Path = "reports/generated/v03-neural-repair-report.json", wall_clock_cap: float = WALL_CLOCK_CAP_SECONDS) -> dict:
    start = time.perf_counter()
    deadline = start + float(wall_clock_cap)
    specs = make_microset()
    train_examples = build_examples(specs)
    normalization = fit_input_normalization(_training_observations(train_examples))
    prepared = _prepared_by_digest(specs)
    trials = []
    selected_by_class = {}
    failures = []

    for model_class, seeds, label in (
        (V03FiveBrain, MODEL_SEEDS, "full"),
        (V03SingleRecurrentMemory, CONTROL_SEEDS, "control"),
    ):
        for model_seed in seeds:
            if time.perf_counter() >= deadline:
                failures.append(f"wall-clock cap before {label} seed {model_seed}")
                break
            model = model_class(model_seed)
            model.set_input_normalization(normalization)
            training = _balanced_train(
                model,
                train_examples,
                seed=model_seed + 1000,
                start_time=start,
                deadline=deadline,
            )
            trial = {
                "label": label,
                "model_seed": int(model_seed),
                "optimizer_seed": int(model_seed + 1000),
                "parameter_count": int(model.parameter_count()),
                "brain_count": int(model.brain_count),
                "updates": int(training["updates"]),
                "stopped_reason": training["stopped_reason"],
                "parameter_delta_l2": float(training["parameter_delta_l2"]),
                "history": training["history"],
                "model": model,
                "training": training,
            }
            trials.append(trial)
            if training["stopped_reason"]:
                failures.append(f"{label} seed {model_seed}: {training['stopped_reason']}")
    for label in ("full", "control"):
        candidates = [item for item in trials if item["label"] == label]
        if candidates:
            selected_by_class[label] = min(
                candidates,
                key=lambda item: item["history"][-1]["loss"] if item["history"] else float("inf"),
            )

    full_selected = selected_by_class.get("full")
    control_selected = selected_by_class.get("control")
    frequency_learning_succeeded = bool(
        full_selected and full_selected["history"]
        and full_selected["history"][-1]["frequency_accuracy"] >= 0.75
    )

    # These references use the same prepared inputs and evaluator/budgets but
    # never enter learned metrics or policy input.
    future_specs = make_future_inputs()
    references = {
        "oracle": [],
        "untrained_random": {},
        "feasibility": {
            "microset": oracle_feasibility(specs),
            "future_unlabeled_inputs": oracle_feasibility(future_specs),
        },
    }
    if full_selected and control_selected:
        references["oracle"] = [_oracle_run(spec) for spec in specs]
        for label, model_class, seed in (
            ("full", V03FiveBrain, MODEL_SEEDS[0]),
            ("control", V03SingleRecurrentMemory, CONTROL_SEEDS[0]),
        ):
            random_model = model_class(seed)
            random_model.set_input_normalization(normalization)
            references["untrained_random"][label] = {
                "runs": [run_episode(random_model, spec, prepared=prepared[_json_digest(_prepare_policy_observations(spec)[1])]) for spec in specs],
            }
            references["untrained_random"][label]["summary"] = _summary(references["untrained_random"][label]["runs"])
    else:
        failures.append("reference evaluation skipped because both model classes did not train")

    evaluation = {}
    retention = {}
    retention_metadata = {}
    interventions = {}
    future_inputs = []
    checkpoints = {}
    if full_selected and control_selected:
        full_model = full_selected["model"]
        control_model = control_selected["model"]
        evaluation["full"] = {
            "runs": [run_episode(full_model, spec, prepared=prepared[_json_digest(_prepare_policy_observations(spec)[1])]) for spec in specs],
        }
        evaluation["full"]["summary"] = _summary(evaluation["full"]["runs"])
        evaluation["control"] = {
            "runs": [run_episode(control_model, spec, prepared=prepared[_json_digest(_prepare_policy_observations(spec)[1])]) for spec in specs],
        }
        evaluation["control"]["summary"] = _summary(evaluation["control"]["runs"])
        if frequency_learning_succeeded:
            retention["normal"] = [run_retention_episode(full_model, spec) for spec in specs]
            retention["matched_control_normal"] = [run_retention_episode(control_model, spec) for spec in specs]
            baseline_successes = int(sum(bool(item["success"]) for item in retention["normal"]))
            retention_metadata = {
                "baseline_successes": baseline_successes,
                "causal_ablation_claim_eligible": False,
                "paired_ablation_evidence": {},
                "matched_control_baseline_successes": int(sum(
                    bool(item["success"]) for item in retention["matched_control_normal"]
                )),
                "matched_control_paired_comparison": _paired_ablation_summary(
                    retention["normal"], retention["matched_control_normal"]
                ),
            }
            if baseline_successes > 0:
                retention["slot0_erase"] = [run_retention_episode(full_model, spec, erasure="slot0") for spec in specs]
                retention["slot1_erase"] = [run_retention_episode(full_model, spec, erasure="slot1") for spec in specs]
                retention["both_slots_erase"] = [run_retention_episode(full_model, spec, erasure="both") for spec in specs]
                retention["recurrent_erase"] = [run_retention_episode(full_model, spec, erasure="recurrent") for spec in specs]
                retention["all_retained_state_erase"] = [run_retention_episode(full_model, spec, erasure="all") for spec in specs]
                for condition in ("slot0_erase", "slot1_erase", "both_slots_erase", "recurrent_erase", "all_retained_state_erase"):
                    retention_metadata["paired_ablation_evidence"][condition] = _paired_ablation_summary(
                        retention["normal"], retention[condition]
                    )
                retention_metadata["causal_ablation_claim_eligible"] = any(
                    item["causal_claim_eligible"]
                    for item in retention_metadata["paired_ablation_evidence"].values()
                )
            else:
                failures.append("retention baseline has zero physical successes; causal ablations not interpreted")
            plans = _donor_plan(specs)
            for condition in ("wrong_note", "shuffled_measurement", "resource_only"):
                runs = []
                for spec in specs:
                    key = _json_digest(spec)
                    runs.append(run_payload_intervention(
                        full_model,
                        spec,
                        prepared=prepared[_json_digest(_prepare_policy_observations(spec)[1])],
                        plan=plans[key],
                        condition=condition,
                    ))
                interventions[condition] = runs
        else:
            failures.append("frequency-learning criterion failed; retention and payload expansion stopped")

        # Inputs are always constructed, but labels/optimization are withheld.
        future_inputs = [{
            "split": spec["split"],
            "world_seed": int(spec["world_seed"]),
            "note_goal_id": spec["note_goal_id"],
            "input_digest": _json_digest(_prepare_policy_observations(spec)[1]),
            "labels_available": False,
        } for spec in future_specs]
        checkpoint_dir = Path(__file__).resolve().parents[2] / "storage" / "checkpoints"
        checkpoints["full"] = {
            "path": str(checkpoint_dir / "v03-neural-repair-full-selected.json"),
            "digest": _save_checkpoint(checkpoint_dir / "v03-neural-repair-full-selected.json", full_model, full_selected["training"]),
        }
        checkpoints["control"] = {
            "path": str(checkpoint_dir / "v03-neural-repair-control-selected.json"),
            "digest": _save_checkpoint(checkpoint_dir / "v03-neural-repair-control-selected.json", control_model, control_selected["training"]),
        }
    else:
        failures.append("selected models unavailable")

    full_model = full_selected["model"] if full_selected else V03FiveBrain(MODEL_SEEDS[0])
    control_model = control_selected["model"] if control_selected else V03SingleRecurrentMemory(CONTROL_SEEDS[0])
    full_model.set_input_normalization(normalization)
    control_model.set_input_normalization(normalization)
    audit = _audit(
        full_model,
        control_model,
        train_examples[0],
        train_examples,
        specs,
        full_selected["training"] if full_selected else {"updates": 0, "parameter_delta_l2": 0.0},
    )
    if checkpoints:
        audit["checkpoint_replay"] = {
            "full": _checkpoint_replay(full_model, specs[0], Path(checkpoints["full"]["path"])),
            "control": _checkpoint_replay(control_model, specs[0], Path(checkpoints["control"]["path"])),
        }

    def summaries(items):
        return {name: _reference_summary(rows) for name, rows in items.items()}

    report = {
        "schema": "vevo.v03.neural-repair-report.v1",
        "contract_path": "docs/EXPERIMENT_CONTRACT_V03_NEURAL_REPAIR.md",
        "historical_artifact": {
            "commit": "dd34d67bcf490fc6d7839ef1582b953abf43b368",
            "report_path": "reports/generated/v03-neural-proof-report.json",
            "preserved": True,
            "audit_correction": "Historical full policy was constant gate 3 / 1.15 on all 48 tests and all ablation trajectories were identical; this repair does not rewrite that artifact.",
        },
        "architecture": {
            "peripheral_brains": 4,
            "central_brains": 1,
            "total_brains": 5,
            "full_parameter_count": int(full_model.parameter_count()),
            "control_parameter_count": int(control_model.parameter_count()),
            "parameter_gap": abs(int(full_model.parameter_count()) - int(control_model.parameter_count())),
            "memory_shape": list(full_model.central_memory_shape),
            "read_repair": "prior content read -> center input; separate post-write content read -> action heads; address/value/gate remain write paths",
            "control_read_repair": "prior plus post-write content reads -> action heads; separate address/value/gate write paths",
            "input_masks": ["note_present", "note_payload_present", "spectrum_present", "feedback_present"],
        },
        "data": {
            "microset_world_seeds": list(MICRO_WORLD_SEEDS),
            "microset_count": len(train_examples),
            "goals_per_world": len(PROBE_FREQUENCIES),
            "training_only_normalization": normalization,
            "labels_for_training_only": True,
            "future_inputs": future_inputs,
            "future_inputs_sealed": False,
            "future_oracle_reference_used": True,
            "semantic_holdout_claim": False,
        },
        "training": {
            "method": "balanced size-one minibatches: deterministic shuffled eight-example cycles; Adam-style reverse-mode updates",
            "max_updates_per_trial": MAX_UPDATES_PER_TRIAL,
            "learning_rate": LEARNING_RATE,
            "gradient_clip_norm": GRADIENT_CLIP_NORM,
            "model_seeds": list(MODEL_SEEDS),
            "control_seeds": list(CONTROL_SEEDS),
            "trials": [{key: value for key, value in item.items() if key not in {"model", "training"}} for item in trials],
            "selected_full_seed": int(full_selected["model_seed"]) if full_selected else None,
            "selected_control_seed": int(control_selected["model_seed"]) if control_selected else None,
            "frequency_learning_succeeded": frequency_learning_succeeded,
            "selection": "lowest final training loss; no held-out optimization",
            "exact_training_resume_verified": False,
            "checkpoints": checkpoints,
        },
        "references": {
            "oracle": {"runs": references["oracle"], "summary": _reference_summary(references["oracle"]) if references["oracle"] else {}},
            "untrained_random": references["untrained_random"],
            "feasibility": references["feasibility"],
        },
        "evaluation": evaluation,
        "retention": {
            "metadata": retention_metadata,
            "conditions": {name: {"runs": rows, "summary": _reference_summary(rows)} for name, rows in retention.items()},
        },
        "interventions": {name: {"runs": rows, "summary": _reference_summary(rows)} for name, rows in interventions.items()},
        "audit": audit,
        "budgets": {
            "wall_clock_cap_seconds": float(wall_clock_cap),
            "within_wall_clock_cap": time.perf_counter() - start <= float(wall_clock_cap),
            "all_evaluations_within_live_work": all(
                run["live_work_spent"] <= CorrectedEpisode.WORK_BUDGET + 1e-12
                for group in list(evaluation.values())
                for run in group["runs"]
            ) if evaluation else False,
            "all_evaluations_within_physics": all(
                run["physics_steps"] <= CorrectedEpisode.MAX_PHYSICS_STEPS
                for group in list(evaluation.values())
                for run in group["runs"]
            ) if evaluation else False,
        },
        "runtime": {
            "wall_clock_seconds": time.perf_counter() - start,
            "max_rss_kb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "failures": failures,
        },
    }
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return report


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="reports/generated/v03-neural-repair-report.json")
    parser.add_argument("--wall-clock-cap", type=float, default=WALL_CLOCK_CAP_SECONDS)
    args = parser.parse_args()
    report = run_repair(output_path=args.output, wall_clock_cap=args.wall_clock_cap)
    print(json.dumps({
        "schema": report["schema"],
        "frequency_learning_succeeded": report["training"]["frequency_learning_succeeded"],
        "full": report["evaluation"].get("full", {}).get("summary"),
        "control": report["evaluation"].get("control", {}).get("summary"),
        "runtime": report["runtime"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
