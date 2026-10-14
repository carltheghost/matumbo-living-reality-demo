import copy
import json
import unittest

import numpy as np

from vevo_agents.v03_model import (
    NOTE_FEATURE_END,
    NOTE_FEATURE_START,
    NOTE_PAYLOAD_MASK_INDEX,
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
    _paired_ablation_summary,
    _replace_target_frequency,
    _validate_target_only_note_edit,
    mid_sequence_continuation_check,
    numeric_autograd_parity,
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

    def test_model_load_is_atomic_and_control_exposes_parameter_names(self):
        model = V03SingleRecurrentMemory(41)
        before = model.state_dict()
        malformed = copy.deepcopy(before)
        malformed["W_in"] = np.zeros((1, 1)).tolist()
        with self.assertRaises(ValueError):
            model.load_state_dict(malformed)
        self.assertEqual(model.state_dict(), before)
        self.assertEqual(set(model.parameter_names()), set(model.params))

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

    def test_wrong_note_replacement_is_equal_width_and_target_only(self):
        original = copy.deepcopy(self.example["policy_observations"][2])
        changed = copy.deepcopy(original)
        changed["note"]["text"] = _replace_target_frequency(original["note"]["text"], 1)
        _validate_target_only_note_edit(original, changed)
        self.assertEqual(
            len(original["note"]["text"].encode("utf-8")),
            len(changed["note"]["text"].encode("utf-8")),
        )

    def test_causal_ablation_requires_paired_outcome_probability_and_action(self):
        baseline = [{
            "success": True,
            "final_action": {"gate": 1, "frequency_index": 2},
            "gate_probabilities": [0.1, 0.9],
            "frequency_probabilities": [0.1, 0.2, 0.7],
        }]
        no_probability_change = [{
            "success": False,
            "final_action": {"gate": 0, "frequency_index": 1},
            "gate_probabilities": [0.1, 0.9],
            "frequency_probabilities": [0.1, 0.2, 0.7],
        }]
        summary = _paired_ablation_summary(baseline, no_probability_change)
        self.assertEqual(summary["paired_success_drop"], 1)
        self.assertEqual(summary["paired_action_changes"], 1)
        self.assertEqual(summary["paired_probability_changes"], 0)
        self.assertFalse(summary["causal_claim_eligible"])

        with_probability_change = copy.deepcopy(no_probability_change)
        with_probability_change[0]["gate_probabilities"] = [0.8, 0.2]
        summary = _paired_ablation_summary(baseline, with_probability_change)
        self.assertEqual(summary["paired_probability_changes"], 1)
        self.assertTrue(summary["causal_claim_eligible"])

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


if __name__ == "__main__":
    unittest.main()
