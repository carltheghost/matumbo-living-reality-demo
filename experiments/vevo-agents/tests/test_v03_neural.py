import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import numpy as np

from vevo_agents.v03_model import (
    NOTE_FEATURE_END,
    NOTE_FEATURE_START,
    NOTE_BYTE_FEATURE_END,
    NOTE_BYTE_FEATURE_START,
    NOTE_PAYLOAD_MASK_INDEX,
    NOTE_TARGET_FREQUENCY_BYTE_INDEX,
    POLICY_VECTOR_DIM,
    V03FiveBrain,
    V03SingleRecurrentMemory,
    encode_policy_observation,
    fit_input_normalization,
    normalize_policy_vector,
)
from vevo_agents.v03_neural_proof import (
    build_examples,
    checkpoint_replay_check,
    gradient_checks,
    make_splits,
    policy_input_audit,
    run_episode,
)
from vevo_agents.v03_neural_repair import (
    _save_checkpoint,
    _paired_ablation_summary,
    _replace_target_frequency,
    _validate_target_only_note_edit,
    mid_sequence_continuation_check,
    numeric_autograd_parity,
    run_retention_episode,
    targeted_gradient_checks,
)
from vevo_agents.v03_protocol import CorrectedEpisode


class V03NeuralIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.splits = make_splits()
        cls.example = build_examples(cls.splits["train"][:1])[0]

    def test_five_brain_and_matched_memory_contract(self):
        full = V03FiveBrain(7)
        control = V03SingleRecurrentMemory(41)
        self.assertEqual(full.brain_count, 5)
        self.assertEqual(full.PERIPHERALS, 4)
        self.assertEqual(full.central_memory_shape, control.central_memory_shape)
        self.assertEqual(full.ACTION_DIM, control.ACTION_DIM)
        self.assertEqual(full.parameter_count(), 11183)
        self.assertEqual(control.parameter_count(), 11178)
        self.assertLessEqual(abs(full.parameter_count() - control.parameter_count()), 16)
        self.assertEqual(encode_policy_observation(self.example["policy_observations"][2]).shape, (POLICY_VECTOR_DIM,))

    def test_policy_input_contains_note_and_matrix_but_no_privileged_keys(self):
        audit = policy_input_audit([self.example])
        self.assertTrue(audit["passed"])
        final = self.example["policy_observations"][2]
        self.assertEqual(np.asarray(final["measurement"]["channel_response"]).shape, (4, 4))
        self.assertIn("target_hz", final["note"]["text"])
        self.assertEqual(len(encode_policy_observation(final)), POLICY_VECTOR_DIM)

    def test_center_receives_note_and_measurement_before_final_action(self):
        model = V03FiveBrain(7)
        observations = self.example["policy_observations"]
        runtime = model.initial_runtime()
        for observation in observations[:2]:
            runtime, _ = model.raw_step(runtime, observation)
        original_runtime, original_trace = model.raw_step(runtime, observations[2])

        changed_note = copy.deepcopy(observations[2])
        changed_note["note"]["text"] = "target_hz=1.15; target_phase=0.00; rule=max-response-at-target"
        _, note_trace = model.raw_step(runtime, changed_note)

        changed_measurement = copy.deepcopy(observations[2])
        changed_measurement["measurement"]["channel_response"] = np.zeros((4, 4)).tolist()
        _, measurement_trace = model.raw_step(runtime, changed_measurement)

        self.assertTrue(np.isfinite(original_runtime["central"]).all())
        self.assertFalse(np.allclose(original_trace["central"], note_trace["central"]))
        self.assertFalse(np.allclose(original_trace["central"], measurement_trace["central"]))

    def test_gradients_reach_all_peripherals_center_and_initial_memory(self):
        report = gradient_checks(V03FiveBrain(7), self.example)
        self.assertTrue(report["all_finite"])
        self.assertTrue(report["all_brain_paths_nonzero"])
        self.assertTrue(report["all_within_1e-3"])
        self.assertEqual(
            set(report["checks"]),
            {"p0.W_in", "p1.W_in", "p2.W_in", "p3.W_in", "c.W_in", "memory.initial"},
        )

    def test_repaired_read_write_paths_parity_and_mid_sequence_restore(self):
        full = V03FiveBrain(7)
        control = V03SingleRecurrentMemory(41)
        for model in (full, control):
            gradients = targeted_gradient_checks(model, self.example)
            self.assertTrue(gradients["all_finite"])
            self.assertTrue(gradients["all_nonzero"])
            self.assertTrue(gradients["all_within_1e-3"])
            self.assertTrue(numeric_autograd_parity(model, self.example)["passed"])
            continuation = mid_sequence_continuation_check(model, self.example)
            self.assertTrue(continuation["passed"])

        spec = self.splits["test"][0]
        episode = CorrectedEpisode(
            spec["world_seed"],
            note_text=spec["note_text"],
            gate_resonance_hz=np.asarray(spec["gate_resonance_hz"]),
        )
        five_step_observations = []
        episode.advance(np.zeros(4))
        five_step_observations.append(copy.deepcopy(episode.policy_observation()))
        episode.execute_note()
        five_step_observations.append(copy.deepcopy(episode.policy_observation()))
        for _ in range(2):
            episode.advance(np.zeros(4))
            hidden = copy.deepcopy(episode.policy_observation())
            hidden["note"]["text"] = ""
            hidden["note"]["content_digest"] = ""
            five_step_observations.append(hidden)
        episode.execute_diagnostic(0)
        final_hidden = copy.deepcopy(episode.policy_observation())
        final_hidden["note"]["text"] = ""
        final_hidden["note"]["content_digest"] = ""
        five_step_observations.append(final_hidden)
        five_step_example = {
            "policy_observations": five_step_observations,
            "target_gate": int(episode.oracle_action()),
            "target_frequency": int(spec["goal_index"]),
        }
        self.assertEqual(len(five_step_observations), 5)
        for model in (V03FiveBrain(7), V03SingleRecurrentMemory(41)):
            parity = numeric_autograd_parity(model, five_step_example)
            self.assertEqual(parity["sequence_length"], 5)
            self.assertTrue(parity["passed"])
            if isinstance(model, V03FiveBrain):
                self.assertIn("peripheral", parity["field_errors"])

    def test_model_load_is_atomic_and_control_exposes_parameter_names(self):
        for model in (V03FiveBrain(7), V03SingleRecurrentMemory(41)):
            before = model.state_dict()
            malformed = copy.deepcopy(before)
            early_name = model.parameter_names()[0]
            malformed[early_name] = (np.asarray(malformed[early_name], dtype=np.float64) + 1.0).tolist()
            late_name = model.parameter_names()[-1]
            malformed[late_name] = np.zeros((1, 1)).tolist()
            self.assertFalse(np.array_equal(malformed[early_name], before[early_name]))
            with self.assertRaises(ValueError):
                model.load_state_dict(malformed)
            self.assertEqual(model.state_dict(), before)
            self.assertEqual(set(model.parameter_names()), set(model.params))

    def test_checkpoint_save_preserves_prior_file_on_replace_failure(self):
        model = V03FiveBrain(7)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            path.write_text("prior-checkpoint", encoding="utf-8")
            with mock.patch("vevo_agents.v03_neural_proof.os.replace", side_effect=OSError("simulated interruption")):
                with self.assertRaises(OSError):
                    _save_checkpoint(path, model)
            self.assertEqual(path.read_text(encoding="utf-8"), "prior-checkpoint")
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_hidden_note_payload_has_neutral_normalized_features(self):
        observations = self.example["policy_observations"]
        normalization = fit_input_normalization(observations)
        hidden = copy.deepcopy(observations[2])
        hidden["note"]["text"] = ""
        hidden["note"]["content_digest"] = ""
        raw_hidden = encode_policy_observation(hidden)
        self.assertEqual(raw_hidden[0], 1.0)
        self.assertEqual(raw_hidden[NOTE_PAYLOAD_MASK_INDEX], 0.0)
        normalized_hidden = normalize_policy_vector(raw_hidden, normalization)
        self.assertTrue(np.allclose(normalized_hidden[NOTE_FEATURE_START:NOTE_FEATURE_END], 0.0))

        empty_valid = copy.deepcopy(hidden)
        empty_valid["note"]["content_digest"] = "authoritative-empty-note-digest"
        raw_empty = encode_policy_observation(empty_valid)
        self.assertEqual(raw_empty[NOTE_PAYLOAD_MASK_INDEX], 1.0)

        revised = copy.deepcopy(observations[2])
        revised["note"]["revision"] = 4
        raw_revised = encode_policy_observation(revised)
        normalized_revised = normalize_policy_vector(raw_revised, normalization)
        revision_index = NOTE_FEATURE_START + 1
        self.assertEqual(normalized_revised[revision_index], raw_revised[revision_index])
        raw_training = np.stack([encode_policy_observation(item) for item in observations])
        present_note_rows = raw_training[raw_training[:, NOTE_PAYLOAD_MASK_INDEX] > 0.5]
        self.assertGreater(len(present_note_rows), 0)
        scales = np.asarray(normalization["scale"])
        for index in range(NOTE_BYTE_FEATURE_START, NOTE_BYTE_FEATURE_END):
            if np.isclose(np.std(present_note_rows[:, index]), 0.0, rtol=0.0, atol=1e-12):
                self.assertEqual(scales[index], 1.0)

    def test_goal_byte_offsets_target_note_digit_for_center_and_controller(self):
        observation = self.example["policy_observations"][2]
        text = observation["note"]["text"]
        digit_index = text.index("target_hz=") + len("target_hz=")
        encoded = encode_policy_observation(observation)
        self.assertEqual(
            encoded[NOTE_TARGET_FREQUENCY_BYTE_INDEX],
            ord(text[digit_index]) / 255.0,
        )
        full_checks = targeted_gradient_checks(V03FiveBrain(7), self.example)["checks"]
        control_checks = targeted_gradient_checks(V03SingleRecurrentMemory(41), self.example)["checks"]
        self.assertEqual(full_checks["goal_byte_center"]["index"], [0, NOTE_TARGET_FREQUENCY_BYTE_INDEX])
        self.assertEqual(control_checks["goal_byte_controller"]["index"], [0, NOTE_TARGET_FREQUENCY_BYTE_INDEX])

    def test_wrong_note_replacement_is_equal_width_and_target_only(self):
        original = copy.deepcopy(self.example["policy_observations"][2])
        changed = copy.deepcopy(original)
        changed["note"]["text"] = _replace_target_frequency(original["note"]["text"], 1)
        _validate_target_only_note_edit(original, changed)
        self.assertEqual(
            len(original["note"]["text"].encode("utf-8")),
            len(changed["note"]["text"].encode("utf-8")),
        )
        variant_changed = copy.deepcopy(original)
        variant_changed["note"]["text"] = original["note"]["text"].replace("rule=max", "rule=min")
        self.assertEqual(
            len(original["note"]["text"].encode("utf-8")),
            len(variant_changed["note"]["text"].encode("utf-8")),
        )
        with self.assertRaises(AssertionError):
            _validate_target_only_note_edit(original, variant_changed)

    def test_causal_ablation_requires_paired_outcome_probability_and_action(self):
        baseline = [{
            "success": True,
            "split": "test",
            "world_seed": 1,
            "goal_index": 0,
            "note_goal_id": "test-goal-0",
            "final_action": {"gate": 1, "frequency_index": 2},
            "gate_probabilities": [0.1, 0.9],
            "frequency_probabilities": [0.1, 0.2, 0.7],
        }]
        no_probability_change = [{
            "success": False,
            "split": "test",
            "world_seed": 1,
            "goal_index": 0,
            "note_goal_id": "test-goal-0",
            "final_action": {"gate": 0, "frequency_index": 1},
            "gate_probabilities": [0.1, 0.9],
            "frequency_probabilities": [0.1, 0.2, 0.7],
        }]
        summary = _paired_ablation_summary(baseline, no_probability_change)
        self.assertEqual(summary["paired_success_drop"], 1)
        self.assertEqual(summary["paired_action_changes"], 1)
        self.assertEqual(summary["paired_probability_changes"], 0)
        self.assertEqual(summary["transition_counts"], {
            "success_to_success": 0,
            "success_to_failure": 1,
            "failure_to_success": 0,
            "failure_to_failure": 0,
        })
        self.assertEqual(summary["net_success_change"], -1)
        self.assertFalse(summary["causal_claim_eligible"])

        with_probability_change = copy.deepcopy(no_probability_change)
        with_probability_change[0]["gate_probabilities"] = [0.8, 0.2]
        summary = _paired_ablation_summary(baseline, with_probability_change)
        self.assertEqual(summary["paired_probability_changes"], 1)
        self.assertTrue(summary["causal_claim_eligible"])

        architecture_summary = _paired_ablation_summary(
            baseline,
            with_probability_change,
            causal_intervention=False,
        )
        self.assertNotIn("causal_claim_eligible", architecture_summary)

        reordered = copy.deepcopy(with_probability_change)
        reordered[0]["world_seed"] = 2
        with self.assertRaises(ValueError):
            _paired_ablation_summary(baseline, reordered)

    def test_episode_snapshot_restore_and_neural_replay(self):
        spec = self.splits["test"][0]
        episode = CorrectedEpisode(
            spec["world_seed"],
            note_text=spec["note_text"],
            gate_resonance_hz=np.asarray(spec["gate_resonance_hz"]),
        )
        episode.advance(np.zeros(4))
        episode.execute_note()
        episode.execute_diagnostic(0)
        restored = CorrectedEpisode.restore(json.loads(json.dumps(episode.snapshot(), sort_keys=True)))
        self.assertEqual(episode.snapshot(), restored.snapshot())
        report = checkpoint_replay_check(V03FiveBrain(7), spec)
        self.assertTrue(all(report.values()))

    def test_fixed_schedule_executor_and_interventions_are_authoritative(self):
        spec = self.splits["test"][0]
        model = V03FiveBrain(7)
        normal = run_episode(model, spec)
        disabled = run_episode(model, spec, {"disable_actuation": True})
        wrong = run_episode(model, spec, {"wrong_note": True})
        shuffled = run_episode(model, spec, {"shuffle_measurement": True})
        erased = run_episode(model, spec, {"memory_erase": True})
        self.assertEqual(normal["tool_calls"], 3)
        self.assertEqual(normal["physics_steps"], 81)
        self.assertFalse(disabled["success"])
        self.assertFalse(wrong["success"])
        self.assertFalse(shuffled["success"])
        self.assertFalse(erased["success"])
        self.assertEqual(disabled["failure"], "actuation_disabled")
        self.assertEqual(wrong["failure"], "wrong_note_input")
        self.assertEqual(shuffled["failure"], "shuffled_measurement_input")
        self.assertEqual(erased["failure"], "neural_memory_erased")

    def test_retention_erasures_cover_both_runtime_architectures(self):
        spec = self.splits["test"][0]
        cases = (
            (None, "normal_retention"),
            ("slot0", "slot0_retention_erase"),
            ("slot1", "slot1_retention_erase"),
            ("both", "both_retention_erase"),
            ("recurrent", "recurrent_retention_erase"),
            ("all", "all_retention_erase"),
        )
        for model_class, seed in ((V03FiveBrain, 7), (V03SingleRecurrentMemory, 41)):
            captured = {}
            for erasure, expected_condition in cases:
                model = model_class(seed)
                observed_runtimes = []
                original_raw_step = model.raw_step

                def capture_runtime(runtime, policy_observation, *args, **kwargs):
                    observed_runtimes.append(model.copy_runtime(runtime))
                    return original_raw_step(runtime, policy_observation, *args, **kwargs)

                with mock.patch.object(model, "raw_step", side_effect=capture_runtime):
                    result = run_retention_episode(model, spec, erasure=erasure)
                self.assertEqual(result["condition"], expected_condition)
                self.assertEqual(len(observed_runtimes), 5)
                captured[erasure] = observed_runtimes[-1]

            baseline = captured[None]
            self.assertGreater(float(np.max(np.abs(baseline["memory"]))), 0.0)

            def recurrent_values(runtime):
                if model_class is V03FiveBrain:
                    return [runtime["central"], *runtime["peripheral"]]
                return [runtime["hidden"]]

            for erasure in ("slot0", "slot1", "both"):
                for before, after in zip(recurrent_values(baseline), recurrent_values(captured[erasure])):
                    np.testing.assert_array_equal(after, before)
            for current in recurrent_values(captured["recurrent"]):
                self.assertTrue(np.all(current == 0.0))
            for current in recurrent_values(captured["all"]):
                self.assertTrue(np.all(current == 0.0))

            np.testing.assert_array_equal(captured["slot0"]["memory"][0], 0.0)
            np.testing.assert_array_equal(captured["slot1"]["memory"][1], 0.0)
            np.testing.assert_array_equal(captured["slot0"]["memory"][1], baseline["memory"][1])
            np.testing.assert_array_equal(captured["slot1"]["memory"][0], baseline["memory"][0])
            np.testing.assert_array_equal(captured["both"]["memory"], 0.0)
            np.testing.assert_array_equal(captured["recurrent"]["memory"], baseline["memory"])
            np.testing.assert_array_equal(captured["all"]["memory"], 0.0)


if __name__ == "__main__":
    unittest.main()
