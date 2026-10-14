import unittest

import numpy as np

from vevo_agents.controls import SingleRecurrentNoMemory
from vevo_agents.fabric import BudgetLedger, SimFabricStore
from vevo_agents.model import FiveBrain
from vevo_agents.physics import ResonantWorld, finite_difference_force_error, make_episode_observations
from vevo_agents.proof import Episode, gradient_checks, workspace_checkpoint_check
from vevo_agents.tools import ToolExecutor


class PhysicsTests(unittest.TestCase):
    def test_shared_edge_energy_has_finite_difference_force(self):
        world = ResonantWorld(seed=71)
        world.q += np.array([0.02, -0.01, 0.03, -0.025])
        world.u[:] = [0.1, -0.08, 0.04, -0.02]
        self.assertLess(finite_difference_force_error(world), 1e-6)

    def test_probe_mutates_world_and_does_not_leak_target(self):
        world = ResonantWorld(seed=72)
        before = world.digest()
        result = world.apply_probe(1)
        self.assertNotEqual(before, world.digest())
        self.assertNotIn("target", result)
        self.assertEqual(result["tool"], "resonance_probe")


class WorkspaceTests(unittest.TestCase):
    def test_sqlite_notes_revisions_links_and_exact_search_survive_checkpoint(self):
        result = workspace_checkpoint_check()
        self.assertTrue(result["same_digest"])
        self.assertEqual(result["search"][0]["note_id"], "architecture")
        self.assertEqual(result["disk_persistence"][0]["note_id"], "persisted")
        self.assertIn("document.edited", result["event_types"])
        self.assertTrue(result["projection"]["fts5"])


class NeuralTests(unittest.TestCase):
    def setUp(self):
        self.observations, self.target, _ = make_episode_observations(81)
        self.model = FiveBrain(7)

    def test_exactly_four_peripherals_and_one_center(self):
        self.assertEqual(self.model.brain_count, 5)
        self.assertEqual(self.model.parameter_count(), 569)

    def test_gradients_reach_all_brains_and_initial_memory(self):
        report = gradient_checks(self.model, Episode(81, self.observations, self.target))
        self.assertTrue(report["all_within_1e-3"])
        self.assertEqual(set(report["checks"]), {"p0.W_in", "p1.W_in", "p2.W_in", "p3.W_in", "c.W_in", "memory.initial"})

    def test_single_control_is_parameter_matched_but_has_no_memory(self):
        control = SingleRecurrentNoMemory(41)
        self.assertEqual(control.parameter_count(), 591)
        self.assertEqual(control.run_sequence(self.observations)[1][-1]["action_probs"].shape, (3,))


class BoundaryTests(unittest.TestCase):
    def test_unknown_action_is_typed_rejection(self):
        store = SimFabricStore(ResonantWorld(seed=90), seed=91, budgets=BudgetLedger())
        result = ToolExecutor(store).execute("run_shell")
        self.assertFalse(result.accepted)
        self.assertEqual(result.error, "action_not_allowlisted")
        self.assertEqual(result.schema, "vevo.tool.result.v1")


if __name__ == "__main__":
    unittest.main()
