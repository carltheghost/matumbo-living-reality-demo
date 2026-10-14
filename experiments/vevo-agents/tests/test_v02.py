import unittest

import numpy as np

from vevo_agents.v02_model import V02Brain, V02SingleRecurrentNoMemory
from vevo_agents.v02_proof import gradient_checks, interactive_run
from vevo_agents.v02_protocol import V02Episode, teacher_trace


class ProtocolV02Tests(unittest.TestCase):
    def test_exact_revision_and_mapping_gate_are_executor_owned(self):
        episode = V02Episode(2000)
        episode.advance()
        note = episode.execute_note(episode.note_action())
        self.assertTrue(note["accepted"])
        self.assertEqual(note["revision"], episode.current_revision)
        self.assertNotIn("target_gate", note)
        episode.advance()
        diagnostic = episode.execute_diagnostic(episode.diagnostic_action())
        self.assertTrue(diagnostic["diagnostic_ok"])
        self.assertIn("target_gate", diagnostic)
        episode.advance()
        result = episode.execute_actuation(episode.actuation_action())
        self.assertTrue(result["gate_opened"])
        self.assertTrue(episode.success())

    def test_wrong_and_stale_notes_cannot_be_learned_around(self):
        stale = V02Episode(2000, stale=True)
        stale.advance()
        stale_result = stale.execute_note(stale.note_action())
        self.assertFalse(stale_result["accepted"])
        stale.advance()
        self.assertFalse(stale.execute_diagnostic(stale.diagnostic_action())["diagnostic_ok"])

        wrong = V02Episode(2000, wrong_note=True)
        wrong.advance()
        wrong_result = wrong.execute_note(wrong.note_action())
        self.assertTrue(wrong_result["accepted"])
        self.assertNotEqual(wrong_result["note_id"], wrong.true_note_id)
        wrong.advance()
        self.assertFalse(wrong.execute_diagnostic(wrong.diagnostic_action())["diagnostic_ok"])

    def test_teacher_trace_uses_real_interactive_field_and_tools(self):
        model = V02Brain(7)
        trace = teacher_trace(model, 2001)
        self.assertEqual(trace["observations"].shape, (3, 4, 6))
        self.assertEqual(trace["tools"].shape, (3, 8))
        self.assertEqual(trace["targets"].shape, (3,))
        self.assertTrue(trace["episode"].success())
        self.assertNotIn("target_gate", trace["results"][0])
        self.assertIn("target_gate", trace["results"][1])


class ModelV02Tests(unittest.TestCase):
    def test_four_peripherals_and_distinct_center(self):
        model = V02Brain(7)
        self.assertEqual(model.brain_count, 5)
        self.assertEqual(model.parameter_count(), 625)
        self.assertEqual(V02SingleRecurrentNoMemory(41).parameter_count(), 625)

    def test_all_brain_and_memory_gradients_are_finite(self):
        report = gradient_checks(V02Brain(17), 2000)
        self.assertTrue(report["all_within_1e-3"])
        self.assertEqual(
            set(report["checks"]),
            {"p0.W_in", "p1.W_in", "p2.W_in", "p3.W_in", "c.W_in", "memory.initial"},
        )

    def test_snapshot_reload_replays_exact_episode_state(self):
        episode = V02Episode(2002)
        episode.advance(np.zeros(4))
        restored = V02Episode.restore(episode.snapshot())
        self.assertEqual(episode.snapshot(), restored.snapshot())


class InterventionV02Tests(unittest.TestCase):
    def test_actuation_disable_is_authoritative(self):
        run = interactive_run(V02Brain(7), 2000, {"disable_actuation": True})
        self.assertFalse(run["success"])
        self.assertEqual(run["failure"], "actuation_disabled")
        self.assertFalse(run["rows"][-1]["result"]["gate_opened"])


if __name__ == "__main__":
    unittest.main()
