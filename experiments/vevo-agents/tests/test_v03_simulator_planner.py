import dataclasses
import json
import unittest
from unittest.mock import patch

from vevo_agents.physics import ResonantWorld
from vevo_agents.v03_simulator_planner import (
    ACTION_DURATION_TICKS,
    FULL_EPISODE_CANDIDATE_COUNT,
    FULL_EPISODE_VIRTUAL_PHYSICS_STEPS,
    MAX_ACTUAL_CYCLES,
    MAX_ACTUAL_PHYSICS_STEPS,
    MAX_VIRTUAL_CANDIDATES,
    MAX_VIRTUAL_PHYSICS_STEPS,
    PUBLIC_OBSERVATION_FIELDS,
    STRATEGIES,
    BoundedPlanner,
    EnvironmentChange,
    KnownSimulatorPredictor,
    PlanningGoal,
    PlannerBudgetError,
    PlannerError,
    PublicObservation,
    candidate_actions,
    compare_frozen_fixtures,
    default_fixture_specs,
    freeze_fixtures,
    render_markdown,
    run_changed_world_case,
    run_experiment,
    run_strategy,
    _execute_action,
)


class SimulatorPlannerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frozen = freeze_fixtures(default_fixture_specs())
        cls.reachable = tuple(fixture for fixture in cls.frozen if fixture.reachable)
        cls.unreachable = tuple(fixture for fixture in cls.frozen if not fixture.reachable)

    def test_action_set_and_two_step_virtual_budget_are_exact(self):
        actions = candidate_actions()
        self.assertEqual(len(actions), 5)
        self.assertEqual([action.name for action in actions], [
            "coast",
            "drive_positive_port_0",
            "drive_negative_port_0",
            "drive_positive_port_1",
            "drive_negative_port_1",
        ])
        self.assertEqual(actions[0].drive_vector, (0.0, 0.0, 0.0, 0.0))
        self.assertEqual(actions[1].drive_vector, (0.16, 0.0, 0.0, 0.0))
        self.assertEqual(actions[2].drive_vector, (-0.16, 0.0, 0.0, 0.0))
        observation = self.reachable[0].initial_observation
        forecast = BoundedPlanner().plan(
            observation,
            self.reachable[0].spec.goal,
            horizon=2,
            cycle=0,
        )
        self.assertEqual(forecast.candidate_count, 25)
        self.assertEqual(forecast.virtual_physics_steps, 100)
        self.assertEqual(forecast.planning_horizon, 2)
        self.assertEqual(forecast.feasible_candidate_count + forecast.rejected_candidate_count, 25)
        self.assertEqual(MAX_VIRTUAL_CANDIDATES, 100)
        self.assertEqual(MAX_VIRTUAL_PHYSICS_STEPS, 400)

    def test_hard_constraints_reject_intermediate_time_violations(self):
        observation = self.reachable[0].initial_observation
        goal = PlanningGoal(
            goal_id="one-action-time-cap",
            target_port=0,
            min_target_oscillator_energy=0.0,
            max_neighbor_oscillator_energy=1.0,
            min_node_separation_delta=0.0,
            max_time=observation.time + 0.035 + 1.0e-12,
            max_work=1.0,
            max_cycles=1,
        )
        with self.assertRaises(PlannerError):
            BoundedPlanner().plan(observation, goal, horizon=1, cycle=0)

    def test_virtual_budget_rejects_a_fifth_two_step_forecast_before_work(self):
        planner = BoundedPlanner()
        observation = self.reachable[0].initial_observation
        goal = self.reachable[0].spec.goal
        for cycle in range(4):
            planner.plan(observation, goal, horizon=2, cycle=cycle)
        with self.assertRaises(PlannerBudgetError):
            planner.plan(observation, goal, horizon=2, cycle=4)
        self.assertEqual(planner.budget.virtual_candidates, MAX_VIRTUAL_CANDIDATES)
        self.assertEqual(planner.budget.virtual_physics_steps, MAX_VIRTUAL_PHYSICS_STEPS)

    def test_public_observation_is_whitelisted_and_immutable(self):
        observation = self.reachable[0].initial_observation
        payload = observation.as_dict()
        self.assertEqual(
            set(payload),
            set(PUBLIC_OBSERVATION_FIELDS) | {"schema", "fixture_id", "cycle"},
        )
        for forbidden in ("target", "calibration", "omega", "hidden_target"):
            self.assertNotIn(forbidden, payload)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            observation.tick = observation.tick + 1
        mutable_displacements = list(observation.node_displacements)
        copied = PublicObservation(
            fixture_id=observation.fixture_id,
            cycle=observation.cycle,
            tick=observation.tick,
            time=observation.time,
            node_displacements=mutable_displacements,
            node_velocities=list(observation.node_velocities),
            oscillator_amplitudes=list(observation.oscillator_amplitudes),
            oscillator_velocities=list(observation.oscillator_velocities),
            local_oscillator_energies=list(observation.local_oscillator_energies),
            neighbor_amplitude_means=list(observation.neighbor_amplitude_means),
            total_energy=observation.total_energy,
            residual=observation.residual,
            supplied_work=observation.supplied_work,
        )
        mutable_displacements[0] = 99.0
        self.assertNotEqual(copied.node_displacements[0], 99.0)
        self.assertIsInstance(copied.node_displacements, tuple)
        with self.assertRaises(TypeError):
            copied.node_displacements[0] = 99.0
        changed = EnvironmentChange(0, [0.0, 0.0, 0.0, 0.0], "immutable input copy")
        self.assertIsInstance(changed.external_drive, tuple)

    def test_fixtures_are_frozen_before_comparison_with_separate_unreachable_case(self):
        self.assertEqual(len(self.reachable), 3)
        self.assertEqual(len(self.unreachable), 1)
        self.assertTrue(all(fixture.verification.witness for fixture in self.reachable))
        self.assertFalse(self.unreachable[0].verification.witness)
        self.assertTrue(all(fixture.verification.maximum_cycles_checked == MAX_ACTUAL_CYCLES for fixture in self.frozen))
        comparisons = compare_frozen_fixtures(self.frozen)
        self.assertEqual(set(comparisons), {fixture.spec.fixture_id for fixture in self.reachable})
        self.assertTrue(all(set(runs) == set(STRATEGIES) for runs in comparisons.values()))

    def test_predictor_is_known_simulator_not_neural_or_geometry_claim(self):
        predictor = KnownSimulatorPredictor()
        self.assertFalse(predictor.trained)
        self.assertFalse(predictor.neural_world_model)
        self.assertEqual(predictor.geometry_status, "neural_geometry_not_used")
        payload = predictor.as_dict()
        self.assertTrue(payload["uses_public_observation_whitelist"])
        self.assertEqual(payload["parameterization"], "nominal_not_calibrated")
        self.assertTrue(payload["mismatch_expected"])
        self.assertFalse(payload["actual_world_calibration_read"])
        self.assertFalse(payload["actual_world_target_read"])
        self.assertFalse(payload["physical_safety_guarantee"])

    def test_receding_horizon_replans_after_each_observation_and_stays_bounded(self):
        run = run_strategy(self.reachable[0], "receding_horizon")
        self.assertLessEqual(len(run.cycles), MAX_ACTUAL_CYCLES)
        self.assertEqual(run.terminal.status, "goal_reached")
        self.assertEqual(len(run.cycles), MAX_ACTUAL_CYCLES)
        self.assertEqual(run.budget.reserved_actual_cycles, len(run.cycles))
        self.assertEqual(run.budget.reserved_actual_physics_steps, len(run.cycles) * ACTION_DURATION_TICKS)
        self.assertEqual(run.budget.known_executed_physics_steps, len(run.cycles) * ACTION_DURATION_TICKS)
        self.assertEqual(run.budget.in_flight_uncertain_physics_steps, 0)
        self.assertEqual(run.budget.never_dispatched_physics_steps, 0)
        self.assertEqual(run.budget.virtual_candidates, 80)
        self.assertEqual(run.budget.virtual_physics_steps, 310)
        self.assertFalse(run.neural_world_model_used)
        self.assertEqual(run.restart_mode, "new_seeded_run")
        self.assertEqual([cycle.forecast.plan_cycle for cycle in run.cycles], [0, 1, 2, 3])
        self.assertEqual([cycle.forecast.horizon for cycle in run.cycles], [2, 2, 2, 1])
        self.assertEqual([cycle.forecast.candidate_count for cycle in run.cycles], [25, 25, 25, 5])
        self.assertTrue(all(cycle.action == cycle.forecast.actions[0] for cycle in run.cycles))
        self.assertTrue(all(cycle.forecast_residual.comparison_status == "compared" for cycle in run.cycles))
        self.assertTrue(all(dataclasses.is_dataclass(cycle) for cycle in run.cycles))

    def test_open_loop_reuses_forecast_while_greedy_can_reach_frozen_goal(self):
        greedy = run_strategy(self.reachable[0], "greedy")
        self.assertEqual(greedy.terminal.status, "goal_reached")
        self.assertLessEqual(len(greedy.cycles), MAX_ACTUAL_CYCLES)
        self.assertTrue(all(cycle.forecast.horizon == 1 for cycle in greedy.cycles))
        open_loop = run_strategy(self.reachable[0], "open_loop_full_episode")
        self.assertEqual(open_loop.strategy, "open_loop_full_episode")
        self.assertEqual(open_loop.cycles[0].forecast.plan_cycle, 0)
        self.assertTrue(all(cycle.forecast.plan_cycle == 0 for cycle in open_loop.cycles))
        self.assertFalse(open_loop.cycles[0].forecast.reused)
        self.assertTrue(all(cycle.forecast.reused for cycle in open_loop.cycles[1:]))
        self.assertEqual([cycle.forecast.horizon for cycle in open_loop.cycles], [4, 3, 2, 1])
        self.assertEqual(open_loop.budget.virtual_candidates, FULL_EPISODE_CANDIDATE_COUNT)
        self.assertEqual(open_loop.budget.virtual_physics_steps, FULL_EPISODE_VIRTUAL_PHYSICS_STEPS)
        self.assertTrue(all(cycle.action.name != "coast" for cycle in open_loop.cycles))

    def test_cancellation_is_terminal_and_does_not_try_an_alternate_action(self):
        run = run_strategy(self.reachable[0], "receding_horizon", cancel_before_cycle=0)
        self.assertEqual(run.terminal.status, "cancelled")
        self.assertTrue(run.terminal.alternatives_blocked)
        self.assertEqual(len(run.cycles), 1)
        self.assertEqual(run.cycles[0].result.status, "cancelled")
        self.assertEqual(run.cycles[0].result.tick_after, run.cycles[0].result.tick_before)
        self.assertEqual(run.budget.reserved_actual_cycles, 1)
        self.assertEqual(run.budget.reserved_actual_physics_steps, ACTION_DURATION_TICKS)
        self.assertEqual(run.budget.known_executed_physics_steps, 0)
        self.assertEqual(run.budget.in_flight_uncertain_physics_steps, 0)
        self.assertEqual(run.budget.never_dispatched_physics_steps, ACTION_DURATION_TICKS)
        self.assertEqual(run.cycles[0].forecast_residual.comparison_status, "cancelled_before_dispatch")

    def test_partial_effect_is_uncertain_and_does_not_continue(self):
        run = run_strategy(self.reachable[0], "receding_horizon", uncertain_after_ticks=1)
        self.assertEqual(run.terminal.status, "uncertain_outcome")
        self.assertTrue(run.terminal.alternatives_blocked)
        self.assertEqual(len(run.cycles), 1)
        self.assertEqual(run.cycles[0].result.status, "uncertain_outcome")
        self.assertEqual(
            run.cycles[0].result.tick_after,
            run.cycles[0].result.tick_before + 1,
        )
        self.assertEqual(run.budget.reserved_actual_cycles, 1)
        self.assertEqual(run.budget.known_executed_physics_steps, 1)
        self.assertEqual(run.budget.in_flight_uncertain_physics_steps, 0)
        self.assertEqual(run.budget.never_dispatched_physics_steps, 1)
        self.assertEqual(run.cycles[0].forecast_residual.comparison_status, "uncertain_outcome")

    def test_cancellation_after_first_tick_keeps_remainder_never_dispatched(self):
        run = run_strategy(self.reachable[0], "receding_horizon", cancel_after_ticks=1)
        result = run.cycles[0].result
        self.assertEqual(result.status, "uncertain_outcome")
        self.assertEqual(result.known_executed_ticks, 1)
        self.assertEqual(result.in_flight_uncertain_ticks, 0)
        self.assertEqual(result.never_dispatched_ticks, 1)
        self.assertEqual(run.budget.known_executed_physics_steps, 1)
        self.assertEqual(run.budget.in_flight_uncertain_physics_steps, 0)
        self.assertEqual(run.budget.never_dispatched_physics_steps, 1)

    def test_exception_on_first_tick_marks_only_that_tick_in_flight(self):
        world = ResonantWorld(seed=0)
        action = candidate_actions()[1]
        with patch.object(world, "step", side_effect=RuntimeError("first tick failure")):
            result = _execute_action(world, action, fixture_id="exception-first", cycle=0)
        self.assertEqual(result.status, "error")
        self.assertEqual(result.known_executed_ticks, 0)
        self.assertEqual(result.in_flight_uncertain_ticks, 1)
        self.assertEqual(result.never_dispatched_ticks, 1)

    def test_exception_on_second_tick_preserves_first_completed_tick(self):
        world = ResonantWorld(seed=0)
        action = candidate_actions()[1]
        original_step = world.step
        calls = 0

        def fail_second(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("second tick failure")
            return original_step(*args, **kwargs)

        with patch.object(world, "step", side_effect=fail_second):
            result = _execute_action(world, action, fixture_id="exception-second", cycle=0)
        self.assertEqual(result.status, "error")
        self.assertEqual(result.known_executed_ticks, 1)
        self.assertEqual(result.in_flight_uncertain_ticks, 1)
        self.assertEqual(result.never_dispatched_ticks, 0)

    def test_changed_world_case_is_recorded_and_receding_horizon_replans(self):
        change, runs = run_changed_world_case(self.reachable[0])
        self.assertEqual(change.cycle, 1)
        self.assertEqual(set(runs), set(STRATEGIES))
        receding = runs["receding_horizon"]
        self.assertTrue(any(cycle.result.environment_change_applied for cycle in receding.cycles))
        changed_cycle = next(cycle for cycle in receding.cycles if cycle.result.environment_change_applied)
        self.assertEqual(changed_cycle.cycle, 1)
        self.assertEqual(changed_cycle.forecast.plan_cycle, 1)
        self.assertEqual(receding.cycles[2].forecast.plan_cycle, 2)
        self.assertEqual(receding.cycles[2].forecast_residual.prediction_source, "fresh_forecast")

    def test_actual_neighbor_violation_is_terminal(self):
        change = EnvironmentChange(0, (0.0, 2.0, 2.0, 0.0), "development neighbor violation")
        run = run_strategy(self.reachable[0], "receding_horizon", environment_change=change)
        self.assertEqual(run.terminal.status, "constraint_violation")
        self.assertEqual(len(run.cycles), 1)
        result = run.cycles[0].result
        self.assertEqual(result.known_executed_ticks, 1)
        self.assertEqual(result.in_flight_uncertain_ticks, 0)
        self.assertEqual(result.never_dispatched_ticks, 1)

    def test_actual_tick_cap_stops_before_second_tick(self):
        world = ResonantWorld(seed=0)
        observation = PublicObservation.from_world(world, fixture_id="tick-cap", cycle=0)
        goal = PlanningGoal(
            goal_id="one-tick-time-cap",
            target_port=0,
            min_target_oscillator_energy=0.0,
            max_neighbor_oscillator_energy=1.0,
            min_node_separation_delta=0.0,
            max_time=observation.time + 0.5 * ResonantWorld.DT,
            max_work=1.0,
            max_cycles=1,
        )
        result = _execute_action(
            world,
            candidate_actions()[1],
            fixture_id="tick-cap",
            cycle=0,
            goal=goal,
        )
        self.assertEqual(result.status, "budget_exhausted")
        self.assertEqual(result.known_executed_ticks, 1)
        self.assertEqual(result.in_flight_uncertain_ticks, 0)
        self.assertEqual(result.never_dispatched_ticks, 1)
        self.assertEqual(result.tick_after, result.tick_before + 1)

    def test_forecast_residuals_are_serialized_separately_from_errors(self):
        run = run_strategy(self.reachable[0], "greedy")
        payload = run.as_dict()
        self.assertIn("forecast_residual", payload["cycles"][0])
        self.assertEqual(payload["errors"], [])
        residual = payload["cycles"][0]["forecast_residual"]
        self.assertIn("node_displacement_l2_error", residual)
        self.assertIn("residual_increment_abs_error", residual)
        self.assertAlmostEqual(
            residual["realized_residual_delta"],
            run.cycles[0].observation_after.residual - run.cycles[0].observation.residual,
        )

    def test_result_and_markdown_preserve_honest_claim_boundary(self):
        result = run_experiment()
        self.assertTrue(result["fixtures_frozen_before_comparison"])
        self.assertEqual(result["comparison_variant"], "corrected_bounded_comparison")
        self.assertTrue(result["original_results_retained"])
        self.assertEqual(len(result["reachable_fixtures"]), 3)
        self.assertEqual(len(result["unreachable_fixtures"]), 1)
        self.assertFalse(result["claims"]["trained_neural_world_model"])
        self.assertFalse(result["claims"]["geometry_ablation_run"])
        self.assertTrue(result["claims"]["predictor_mismatch_expected"])
        self.assertFalse(result["claims"]["physical_safety_guarantee"])
        self.assertFalse(result["claims"]["spatial_navigation_claim"])
        self.assertFalse(result["claims"]["strategy_superiority_claim"])
        self.assertEqual(result["claims"]["residual_role"], "diagnostic_measurement_only")
        self.assertFalse(result["claims"]["residuals_control_feedback"])
        self.assertEqual(result["bounds"]["virtual_physics_steps_semantics"], "worst_case_reserved_compute")
        markdown = render_markdown(result)
        self.assertIn("No physical-safety guarantee", markdown)
        self.assertIn("diagnostic measurements only", markdown)
        self.assertIn("worst-case reserved compute", markdown)
        encoded = json.dumps(result, sort_keys=True, allow_nan=False)
        self.assertIn('"two_step_candidate_count": 25', encoded)
        self.assertIn('"full_episode_candidate_count": 625', encoded)


if __name__ == "__main__":
    unittest.main()
