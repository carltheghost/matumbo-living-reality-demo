import json
import unittest

import numpy as np

from vevo_agents.v03_protocol import (
    ContinuousGateWorld,
    CorrectedEpisode,
    PROBE_FREQUENCIES,
    null_policy_action,
    null_rollout,
    oracle_rollout,
    pair_same_measurement_different_notes,
    pair_same_note_different_measurements,
    protocol_summary,
)


def _prepare(episode):
    episode.advance(np.zeros(4))
    note = episode.execute_note()
    measurement = episode.execute_diagnostic(0)
    return note, measurement


class CorrectedProtocolTests(unittest.TestCase):
    def test_exactly_five_brain_contract_and_no_answer_fields(self):
        summary = protocol_summary()
        self.assertEqual(summary["brains"]["total"], 5)
        self.assertEqual(summary["brains"]["peripheral"], 4)
        self.assertEqual(summary["brains"]["central"], 1)
        self.assertEqual(summary["answer_fields_in_measurement"], [])

        episode = CorrectedEpisode(3100)
        _, measurement = _prepare(episode)
        self.assertNotIn("target_gate", measurement)
        self.assertNotIn("diagnostic_ok", measurement)
        self.assertTrue(measurement["pure_measurement"])

    def test_diagnostic_is_pure_and_returns_continuous_matrix(self):
        episode = CorrectedEpisode(3100)
        episode.advance(np.zeros(4))
        episode.execute_note()
        before = json.dumps(episode.world.snapshot(), sort_keys=True)
        measurement = episode.execute_diagnostic(0)
        after = json.dumps(episode.world.snapshot(), sort_keys=True)
        self.assertEqual(before, after)
        matrix = np.asarray(measurement["channel_response"], dtype=float)
        self.assertEqual(matrix.shape, (4, len(PROBE_FREQUENCIES)))
        self.assertTrue(np.isfinite(matrix).all())
        self.assertGreater(measurement["probe_work"], 0.0)

    def test_same_measurements_different_notes_require_different_actions(self):
        first, second = pair_same_measurement_different_notes()
        _, m_first = _prepare(first)
        _, m_second = _prepare(second)
        np.testing.assert_allclose(m_first["channel_response"], m_second["channel_response"], rtol=0.0, atol=1e-12)
        self.assertNotEqual(first.oracle_action(), second.oracle_action())
        # Any note-blind policy receives the same matrix in both episodes.
        self.assertEqual(null_policy_action(m_first), null_policy_action(m_second))

    def test_same_note_different_measurements_require_different_actions(self):
        first, second = pair_same_note_different_measurements()
        _, m_first = _prepare(first)
        _, m_second = _prepare(second)
        self.assertFalse(np.allclose(m_first["channel_response"], m_second["channel_response"], atol=1e-6))
        self.assertNotEqual(first.oracle_action(), second.oracle_action())

    def test_oracle_opens_from_integrated_position_and_energy(self):
        episode = pair_same_measurement_different_notes()[0]
        result = oracle_rollout(episode)
        self.assertTrue(result["success"])
        self.assertTrue(result["result"]["gate_opened"])
        self.assertGreaterEqual(result["result"]["gate_peak_abs"], episode.world.POSITION_THRESHOLD)
        self.assertGreaterEqual(result["result"]["gate_energy"], episode.world.ENERGY_THRESHOLD)
        self.assertLessEqual(result["result"]["work_spent"], episode.WORK_BUDGET)
        self.assertLessEqual(episode.world.physics_steps, episode.MAX_PHYSICS_STEPS)

    def test_no_actuation_and_wrong_physical_drive_do_not_open(self):
        no_actuation = oracle_rollout(pair_same_measurement_different_notes()[0], enabled=False)
        self.assertFalse(no_actuation["success"])
        self.assertFalse(no_actuation["result"]["gate_opened"])

        wrong_drive = oracle_rollout(pair_same_measurement_different_notes()[0], wrong_drive=True)
        self.assertFalse(wrong_drive["success"])
        self.assertFalse(wrong_drive["result"]["gate_opened"])

    def test_missing_neural_drive_argument_is_rejected(self):
        episode = CorrectedEpisode(3100)
        episode.advance(np.zeros(4))
        episode.execute_note()
        episode.execute_diagnostic(0)
        result = episode.execute_actuation(episode.oracle_action())
        self.assertFalse(result["accepted"])
        self.assertEqual(result["error"], "missing_drive_frequency_argument")

    def test_randomized_oracle_blind_and_no_drive_cases(self):
        blind_failures = 0
        for seed in range(12):
            oracle = oracle_rollout(CorrectedEpisode(seed))
            self.assertTrue(oracle["success"], seed)
            self.assertLessEqual(oracle["measurement"]["virtual_steps_total"], CorrectedEpisode.VIRTUAL_STEP_BUDGET)
            self.assertLessEqual(oracle["measurement"]["virtual_work_total"], CorrectedEpisode.VIRTUAL_WORK_BUDGET)
            self.assertLessEqual(oracle["result"]["work_spent"], CorrectedEpisode.WORK_BUDGET)
            self.assertLessEqual(oracle["world"].physics_steps, CorrectedEpisode.MAX_PHYSICS_STEPS)

            blind = null_rollout(CorrectedEpisode(seed))
            blind_failures += int(not blind["success"])
            no_drive = oracle_rollout(CorrectedEpisode(seed), enabled=False)
            self.assertFalse(no_drive["success"])
        self.assertGreater(blind_failures, 0)

    def test_all_gates_can_open_without_a_hidden_target(self):
        world = ContinuousGateWorld(3500, gate_resonance_hz=PROBE_FREQUENCIES)
        for gate, frequency in enumerate(PROBE_FREQUENCIES):
            result = world.actuate_gate(gate, frequency=float(frequency), work_budget=2.0)
            self.assertTrue(result["gate_opened"], gate)
        self.assertTrue(np.all(world.gate_open))
        self.assertLessEqual(world.work, 2.0)

    def test_wrong_gate_does_not_open_under_correct_physical_drive(self):
        episode = CorrectedEpisode(
            3501,
            note_text="target_hz=0.55; target_phase=0.0; rule=max-response-at-target",
            gate_resonance_hz=PROBE_FREQUENCIES,
        )
        episode.advance(np.zeros(4))
        episode.execute_note()
        episode.execute_diagnostic(0)
        result = episode.execute_actuation(1, drive_frequency=0.55)
        self.assertFalse(result["gate_opened"])
        self.assertFalse(np.any(episode.world.gate_open))

    def test_parameter_sensitivity_and_numerical_stability(self):
        first = CorrectedEpisode(3300, gate_resonance_hz=np.asarray((0.55, 0.75, 0.95, 1.15)))
        second = CorrectedEpisode(3300, gate_resonance_hz=np.asarray((0.57, 0.75, 0.95, 1.15)))
        _, m_first = _prepare(first)
        _, m_second = _prepare(second)
        self.assertGreater(np.max(np.abs(np.asarray(m_first["channel_response"]) - np.asarray(m_second["channel_response"]))), 1e-4)
        result = oracle_rollout(CorrectedEpisode(3301))
        self.assertTrue(np.isfinite(result["world"].energy()))
        self.assertTrue(np.isfinite(result["world"].residual))
        self.assertLess(abs(result["world"].residual), 0.05)

    def test_shared_coupling_energy_has_reciprocal_forces(self):
        world = ContinuousGateWorld(3302, gate_resonance_hz=PROBE_FREQUENCIES)
        world.field.u[:] = [0.08, -0.03, 0.02, -0.06]
        world.gate_x[:] = [-0.02, 0.04, -0.01, 0.07]
        epsilon = 1e-6
        numeric_field = np.zeros(4)
        numeric_gate = np.zeros(4)
        for index in range(4):
            original = world.field.u[index]
            world.field.u[index] = original + epsilon
            plus = world.coupling_energy()
            world.field.u[index] = original - epsilon
            minus = world.coupling_energy()
            world.field.u[index] = original
            numeric_field[index] = -(plus - minus) / (2.0 * epsilon)

            original = world.gate_x[index]
            world.gate_x[index] = original + epsilon
            plus = world.coupling_energy()
            world.gate_x[index] = original - epsilon
            minus = world.coupling_energy()
            world.gate_x[index] = original
            numeric_gate[index] = -(plus - minus) / (2.0 * epsilon)
        np.testing.assert_allclose(
            numeric_field,
            world.COUPLING_K * (world.gate_x - world.field.u),
            rtol=0.0,
            atol=1e-9,
        )
        np.testing.assert_allclose(
            numeric_gate,
            world.COUPLING_K * (world.field.u - world.gate_x),
            rtol=0.0,
            atol=1e-9,
        )

    def test_exact_note_revision_is_authoritative(self):
        episode = CorrectedEpisode(3400)
        stale = episode.execute_note(expected_revision=0)
        self.assertFalse(stale["accepted"])
        current = episode.execute_note(expected_revision=1)
        self.assertTrue(current["accepted"])
        self.assertEqual(current["revision"], 1)


if __name__ == "__main__":
    unittest.main()
