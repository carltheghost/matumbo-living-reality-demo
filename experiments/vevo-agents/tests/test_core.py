import tempfile
import unittest

import numpy as np

from vevo_agents.controls import SingleRecurrentNoMemory
from vevo_agents.autograd import Tensor
from vevo_agents.fabric import BudgetLedger, SimFabricStore
from vevo_agents.model import FiveBrain
from vevo_agents.physics import ResonantWorld, finite_difference_force_error, make_episode_observations
from vevo_agents.proof import Episode, gradient_checks, workspace_checkpoint_check
from vevo_agents.tools import ToolExecutor
from vevo_agents.workspace import NoteWorkspace


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

    def test_world_snapshot_and_restore_deep_detach_event_history(self):
        world = ResonantWorld(seed=73)
        world.step(np.zeros(world.NODES))
        before_digest = world.digest()
        snapshot = world.snapshot()
        snapshot["events"][0]["energy"] = -999.0
        snapshot["q"][0] = -999.0
        self.assertEqual(world.digest(), before_digest)

        restored = ResonantWorld.restore(world.snapshot())
        restored_digest = restored.digest()
        restored_snapshot = restored.snapshot()
        restored_snapshot["events"][0]["energy"] = -998.0
        self.assertEqual(restored.digest(), restored_digest)


class WorkspaceTests(unittest.TestCase):
    def test_sqlite_notes_revisions_links_and_exact_search_survive_checkpoint(self):
        result = workspace_checkpoint_check()
        self.assertTrue(result["same_digest"])
        self.assertEqual(result["search"][0]["note_id"], "architecture")
        self.assertEqual(result["disk_persistence"][0]["note_id"], "persisted")
        self.assertIn("document.edited", result["event_types"])
        self.assertTrue(result["projection"]["fts5"])

    def test_disk_restore_rejects_nonempty_target_instead_of_merging(self):
        source = NoteWorkspace()
        source.create("source", "Source", "exact source", 0)
        snapshot = source.snapshot()
        with tempfile.TemporaryDirectory() as directory:
            path = f"{directory}/workspace.sqlite"
            target = NoteWorkspace(path)
            target.create("unrelated", "Unrelated", "must remain", 0)
            target.close()
            with self.assertRaises(ValueError):
                NoteWorkspace.restore(snapshot, db_path=path)
            reopened = NoteWorkspace(path)
            self.assertEqual(reopened.search("must remain", exact=True)[0]["note_id"], "unrelated")
            reopened.close()
        source.close()


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

    def test_autograd_supported_matmul_and_broadcast_memory_write(self):
        left = Tensor([[0.2, -0.3, 0.4], [0.5, -0.6, 0.7]], requires_grad=True)
        vector = Tensor([0.8, -0.9, 1.0], requires_grad=True)
        matrix = Tensor([[0.1, -0.2], [0.3, -0.4], [0.5, -0.6]], requires_grad=True)
        # Keep the supported 2-D@2-D path explicit and independent of NumPy
        # view magic; the engine intentionally has no .T convenience.
        result = (left @ vector).sum() + (vector @ matrix).sum() + (left @ Tensor([[0.2, 0.1], [-0.1, 0.3], [0.4, -0.2]])).sum()
        result.backward()
        self.assertTrue(np.isfinite(left.grad).all())
        self.assertTrue(np.isfinite(vector.grad).all())
        self.assertTrue(np.isfinite(matrix.grad).all())

        memory = Tensor(np.asarray([[0.1, -0.2, 0.3], [-0.4, 0.5, -0.6]]), requires_grad=True)
        weights = Tensor(np.asarray([[0.25], [0.75]]), requires_grad=True)
        value = Tensor(np.asarray([[0.7, -0.8, 0.9]]), requires_grad=True)
        write = memory + weights * (value - memory)
        write.sum().backward()
        self.assertEqual(memory.grad.shape, memory.data.shape)
        self.assertTrue(np.isfinite(memory.grad).all())

    def test_autograd_rejects_unsupported_dot_and_batched_matmul(self):
        with self.assertRaises(NotImplementedError):
            Tensor([1.0, 2.0]) @ Tensor([3.0, 4.0])
        with self.assertRaises(NotImplementedError):
            Tensor(np.zeros((2, 2, 2))) @ Tensor(np.zeros((2, 2, 2)))


class BoundaryTests(unittest.TestCase):
    def test_unknown_action_is_typed_rejection(self):
        store = SimFabricStore(ResonantWorld(seed=90), seed=91, budgets=BudgetLedger())
        result = ToolExecutor(store).execute("run_shell")
        self.assertFalse(result.accepted)
        self.assertEqual(result.error, "action_not_allowlisted")
        self.assertEqual(result.schema, "vevo.tool.result.v1")

    def test_event_budget_rejection_is_atomic_before_world_mutation(self):
        store = SimFabricStore(
            ResonantWorld(seed=92),
            seed=93,
            budgets=BudgetLedger(max_events=1),
        )
        before_world = store.world.digest()
        before_budgets = store.budgets.snapshot()
        before_events = list(store.events)
        with self.assertRaises(RuntimeError):
            store.advance_world(np.zeros(4))
        self.assertEqual(store.world.digest(), before_world)
        self.assertEqual(store.budgets.snapshot(), before_budgets)
        self.assertEqual(store.events, before_events)

    def test_exhausted_physics_budget_rejection_is_atomic(self):
        store = SimFabricStore(
            ResonantWorld(seed=96),
            seed=97,
            budgets=BudgetLedger(max_physics_steps=0),
        )
        before_world = store.world.digest()
        before_budgets = store.budgets.snapshot()
        with self.assertRaises(RuntimeError):
            store.advance_world(np.zeros(4))
        self.assertEqual(store.world.digest(), before_world)
        self.assertEqual(store.budgets.snapshot(), before_budgets)

    def test_exhausted_event_budget_rejects_tool_probe_atomically(self):
        store = SimFabricStore(
            ResonantWorld(seed=98),
            seed=99,
            budgets=BudgetLedger(max_events=1),
        )
        before_world = store.world.digest()
        before_budgets = store.budgets.snapshot()
        before_events = list(store.events)
        with self.assertRaises(RuntimeError):
            ToolExecutor(store).execute("probe_a")
        self.assertEqual(store.world.digest(), before_world)
        self.assertEqual(store.budgets.snapshot(), before_budgets)
        self.assertEqual(store.events, before_events)

    def test_renderer_projection_deep_detaches_nested_event_payloads(self):
        store = SimFabricStore(ResonantWorld(seed=94), seed=95, budgets=BudgetLedger())
        before_digest = store.checkpoint(brains={}, training={}).digest()
        projection = store.projection()
        projection["events"][0]["payload"]["seed"] = -1
        self.assertEqual(store.events[0]["payload"]["seed"], 95)
        self.assertEqual(store.checkpoint(brains={}, training={}).digest(), before_digest)


if __name__ == "__main__":
    unittest.main()
