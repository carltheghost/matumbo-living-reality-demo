import json
import unittest

import numpy as np

from vevo_agents.v03_protocol import (
    ContinuousGateWorld,
    CorrectedEpisode,
    GATE_QUARTIC_COEFFICIENT,
    PROBE_FREQUENCIES,
    measurement_only_action,
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

    def test_success_requires_the_note_matched_physical_gate(self):
        wrong_goal = CorrectedEpisode(
            3502,
            note_text="target_hz=0.75; target_phase=0.0; rule=max-response-at-target",
            gate_resonance_hz=PROBE_FREQUENCIES,
        )
        _prepare(wrong_goal)
        wrong_result = wrong_goal.execute_actuation(0, drive_frequency=0.55)
        self.assertTrue(wrong_result["gate_opened"])
        self.assertFalse(wrong_goal.success())

        right_goal = CorrectedEpisode(
            3503,
            note_text="target_hz=0.55; target_phase=0.0; rule=max-response-at-target",
            gate_resonance_hz=PROBE_FREQUENCIES,
        )
        _prepare(right_goal)
        right_result = right_goal.execute_actuation(0, drive_frequency=0.55)
        self.assertTrue(right_result["gate_opened"])
        self.assertTrue(right_goal.success())

    def test_additional_gate_opening_invalidates_single_gate_success(self):
        episode = CorrectedEpisode(
            3516,
            note_text="target_hz=0.55; target_phase=0.0; rule=max-response-at-target",
            gate_resonance_hz=PROBE_FREQUENCIES,
        )
        _prepare(episode)
        result = episode.execute_actuation(0, drive_frequency=0.55)
        self.assertTrue(result["gate_opened"])
        self.assertTrue(episode.success())
        episode.world.gate_open[1] = True
        self.assertFalse(episode.success())

    def test_tool_budget_rejects_before_a_fourth_tool_call(self):
        episode = CorrectedEpisode(3504)
        episode.advance(np.zeros(4))
        episode.execute_note()
        episode.execute_diagnostic(0)
        episode.execute_actuation(episode.oracle_action(), drive_frequency=0.55)
        before = episode.world.snapshot()
        result = episode.execute_note()
        self.assertFalse(result["accepted"])
        self.assertEqual(result["error"], "tool_budget_exceeded")
        self.assertEqual(episode.tool_calls, episode.MAX_TOOL_CALLS)
        self.assertEqual(before, episode.world.snapshot())

    def test_physics_budget_rejects_before_actuation_consumption(self):
        episode = CorrectedEpisode(3505)
        _prepare(episode)
        episode.world.physics_steps = episode.MAX_PHYSICS_STEPS - 1
        before = episode.world.snapshot()
        result = episode.execute_actuation(0, drive_frequency=0.55)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["error"], "physics_step_budget_exceeded")
        self.assertEqual(before, episode.world.snapshot())
        self.assertFalse(episode.success())

    def test_work_budget_rejects_before_actuation_consumption(self):
        episode = CorrectedEpisode(3506)
        _prepare(episode)
        episode.world.gate_supplied_work = episode.WORK_BUDGET
        before = episode.world.snapshot()
        result = episode.execute_actuation(0, drive_frequency=0.55)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["error"], "work_budget_exceeded")
        self.assertEqual(before, episode.world.snapshot())
        self.assertFalse(episode.success())

    def test_live_work_budget_stops_actuation_before_crossing_limit(self):
        episode = CorrectedEpisode(3506)
        _prepare(episode)
        episode.WORK_BUDGET = 0.0
        result = episode.execute_actuation(0, drive_frequency=0.55)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["error"], "work_budget_exceeded")
        self.assertLessEqual(episode.world.work_spent, episode.WORK_BUDGET)
        self.assertFalse(episode.success())

    def test_virtual_work_budget_is_enforced_during_cloned_probe_steps(self):
        episode = CorrectedEpisode(3507)
        episode.advance(np.zeros(4))
        episode.execute_note()
        episode.VIRTUAL_WORK_BUDGET = 0.0
        before = episode.world.snapshot()
        result = episode.execute_diagnostic(0)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["error"], "virtual_probe_work_budget_exceeded")
        self.assertGreater(result["virtual_steps_consumed"], 0)
        self.assertGreater(result["virtual_work_consumed"], 0.0)
        self.assertEqual(episode.virtual_steps, result["virtual_steps_total"])
        self.assertEqual(episode.virtual_work, result["virtual_work_total"])
        self.assertGreater(episode.virtual_steps, 0)
        self.assertGreater(episode.virtual_work, 0.0)
        self.assertFalse(result["resource_budget_ok"])
        self.assertEqual(before, episode.world.snapshot())

    def test_virtual_step_preflight_rejects_without_consumption(self):
        episode = CorrectedEpisode(3515)
        episode.advance(np.zeros(4))
        episode.execute_note()
        episode.virtual_steps = episode.VIRTUAL_STEP_BUDGET
        before = episode.world.snapshot()
        result = episode.execute_diagnostic(0)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["error"], "virtual_probe_step_budget_exceeded")
        self.assertEqual(episode.virtual_steps, episode.VIRTUAL_STEP_BUDGET)
        self.assertEqual(episode.virtual_work, 0.0)
        self.assertNotIn("virtual_steps_consumed", result)
        self.assertEqual(before, episode.world.snapshot())

    def test_virtual_probe_work_includes_field_port_drive(self):
        world = ContinuousGateWorld(3507, gate_resonance_hz=PROBE_FREQUENCIES)
        measurement = world.measure_spectrum(amplitude=0.0)
        self.assertGreater(measurement["probe_work"], 0.0)

    def test_gate_quartic_force_matches_total_gate_potential(self):
        world = ContinuousGateWorld(3508, gate_resonance_hz=PROBE_FREQUENCIES)
        world.field.u[:] = [0.08, -0.03, 0.02, -0.06]
        world.gate_x[:] = [-0.02, 0.04, -0.01, 0.07]
        world.gate_v[:] = 0.0
        epsilon = 1e-6

        def potential():
            omega = world.gate_omega
            self_energy = 0.5 * float(np.sum(omega**2 * world.gate_x**2))
            self_energy += GATE_QUARTIC_COEFFICIENT * float(np.sum(world.gate_x**4))
            return self_energy + world.coupling_energy()

        numeric = np.zeros(4)
        for index in range(4):
            original = world.gate_x[index]
            world.gate_x[index] = original + epsilon
            plus = potential()
            world.gate_x[index] = original - epsilon
            minus = potential()
            world.gate_x[index] = original
            numeric[index] = -(plus - minus) / (2.0 * epsilon)
        analytic = (
            world.COUPLING_K * (world.field.u - world.gate_x)
            - world.gate_omega**2 * world.gate_x
            - 4.0 * GATE_QUARTIC_COEFFICIENT * world.gate_x**3
        )
        np.testing.assert_allclose(numeric, analytic, rtol=0.0, atol=1e-9)

    def test_internal_coupling_is_not_external_or_supplied_work(self):
        world = ContinuousGateWorld(3509, gate_resonance_hz=PROBE_FREQUENCIES)
        world.field.u[:] = [0.08, -0.03, 0.02, -0.06]
        world.gate_x[:] = [-0.02, 0.04, -0.01, 0.07]
        world.step()
        self.assertAlmostEqual(world.field.work, 0.0, places=14)
        self.assertAlmostEqual(world.field.supplied_work, 0.0, places=14)
        self.assertAlmostEqual(world.work, 0.0, places=14)
        self.assertAlmostEqual(world.work_spent, 0.0, places=14)
        self.assertTrue(np.isfinite(world.residual))

    def test_whole_system_balance_improves_with_timestep_refinement(self):
        def run(dt, steps):
            world = ContinuousGateWorld(3512, gate_resonance_hz=PROBE_FREQUENCIES)
            world.DT = dt
            world.field.DT = dt
            world.field.u[:] = [0.08, -0.03, 0.02, -0.06]
            world.gate_x[:] = [-0.02, 0.04, -0.01, 0.07]
            world.initial_energy = world.energy()
            for _ in range(steps):
                world.step()
            return abs(world.residual)

        coarse = run(0.035, 40)
        refined = run(0.0175, 80)
        self.assertLess(refined, coarse * 0.8)

    def test_measurement_only_policy_selects_gate_and_frequency(self):
        first, second = pair_same_note_different_measurements()
        _, first_measurement = _prepare(first)
        _, second_measurement = _prepare(second)
        first_action = measurement_only_action(first_measurement)
        second_action = measurement_only_action(second_measurement)
        self.assertEqual(first_action, (0, 0.55))
        self.assertEqual(second_action, (1, 0.55))
        self.assertEqual(null_policy_action(first_measurement), first_action[0])
        blind = null_rollout(CorrectedEpisode(3510))
        self.assertEqual(blind["result"]["drive_frequency"], blind["null_drive_frequency"])

    def test_policy_observation_excludes_checkpoint_only_internals(self):
        episode = CorrectedEpisode(3511)
        _prepare(episode)
        policy = episode.policy_observation()

        def keys(value):
            if isinstance(value, dict):
                output = set(value)
                for child in value.values():
                    output.update(keys(child))
                return output
            if isinstance(value, list):
                output = set()
                for child in value:
                    output.update(keys(child))
                return output
            return set()

        policy_keys = keys(policy)
        for forbidden in ("seed", "gate_resonance_hz", "calibration", "world_snapshot", "gate_position", "gate_velocity", "gate_energy"):
            self.assertNotIn(forbidden, policy_keys)
        self.assertIn("channel_response", policy["measurement"])
        self.assertIn("text", policy["note"])

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
