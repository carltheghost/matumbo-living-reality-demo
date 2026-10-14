import copy
import json
import unittest

import numpy as np

from vevo_agents.v03_model import (
    POLICY_VECTOR_DIM,
    V03FiveBrain,
    V03SingleRecurrentMemory,
    encode_policy_observation,
)
from vevo_agents.v03_neural_proof import (
    build_examples,
    checkpoint_replay_check,
    gradient_checks,
    make_splits,
    policy_input_audit,
    run_episode,
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
        self.assertGreater(full.parameter_count(), control.parameter_count())
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
