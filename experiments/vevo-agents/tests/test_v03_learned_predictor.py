import hashlib
import copy
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from vevo_agents.v03_learned_predictor import (
    ACTION_DRIVE_SCALE,
    CHECKPOINT_SCHEMA,
    LOCAL_ENERGY_START,
    RESIDUAL_INDEX,
    SUPPLIED_WORK_INDEX,
    TIME_INDEX,
    WORLD_CONDITIONS,
    DEVELOPMENT_WORLD_SEEDS,
    EvaluationDeadlineError,
    EvaluationReservationError,
    LearnedObservablePredictor,
    LinearObservableBaseline,
    NominalSimulatorBaseline,
    PersistenceBaseline,
    NormalizerContractError,
    PredictorContractError,
    RolloutBoundsError,
    SharedDeadline,
    TrainOnlyNormalizer,
    build_examples,
    build_frozen_selection_artifact,
    build_trajectories,
    build_split_manifest,
    compute_audit,
    evaluate_examples,
    evaluate_paired_variants,
    feasibility_probe,
    fit_train_normalizers,
    load_checkpoint,
    pilot_experiment_config,
    public_observation_to_vector,
    recursive_rollout,
    run_pilot_training,
    save_checkpoint,
    selection_artifact_digest,
    select_development_checkpoint,
    validate_public_state_vector,
    verify_split_manifest,
    verify_frozen_selection_artifact,
    write_pilot_artifacts,
    _prediction_metrics,
    _conditioned_world,
)
from vevo_agents.physics import ResonantWorld
from vevo_agents.v03_simulator_planner import PublicObservation, candidate_actions


class LearnedPredictorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.train_trajectories = build_trajectories("train", include_test=False)
        cls.development_trajectories = build_trajectories("development", include_test=False)
        cls.train_examples = build_examples("train", include_test=False)
        cls.development_examples = build_examples("development", include_test=False)
        cls.state_normalizer, cls.target_normalizer = fit_train_normalizers(cls.train_trajectories)

    def test_public_vector_is_physical_only_and_excludes_metadata(self):
        world = ResonantWorld(seed=100)
        observation = PublicObservation.from_world(world, fixture_id="public-test", cycle=0)
        vector = public_observation_to_vector(observation)
        self.assertEqual(vector.shape, (28,))
        self.assertNotIn("target", observation.as_dict())
        self.assertNotIn("calibration", observation.as_dict())
        self.assertNotIn("omega", observation.as_dict())
        self.assertEqual(len(self.state_normalizer.component_names), 28)

    def test_split_manifest_is_hashed_disjoint_and_labels_9300_cases(self):
        manifest = build_split_manifest()
        self.assertEqual(verify_split_manifest(manifest), manifest["manifest_sha256"])
        self.assertEqual(
            [item["world_seed"] for item in manifest["initial_development_fixtures"]],
            list(DEVELOPMENT_WORLD_SEEDS),
        )
        self.assertTrue(all(not item["fresh_generalization"] for item in manifest["initial_development_fixtures"]))
        self.assertEqual({item["split"] for item in manifest["trajectories"]}, {"train", "development", "test"})
        test_summaries = [item for item in manifest["trajectories"] if item["split"] == "test"]
        self.assertEqual(len(test_summaries), 16)
        self.assertTrue(all(item["materialized"] is False for item in test_summaries))
        self.assertTrue(all(item["public_trajectory_sha256"] is None for item in test_summaries))
        self.assertEqual(manifest["test_access"]["replacement_world_seeds"], list(range(9500, 9508)))
        self.assertEqual(
            manifest["test_access"]["historical_pre_review_exposure"]["world_seeds"],
            list(range(9400, 9408)),
        )
        self.assertEqual(
            manifest["test_access"]["historical_pre_review_exposure"]["conditions"],
            ["phase_shifted", "frequency_shifted"],
        )
        windows = {}
        for trajectory in manifest["trajectories"]:
            for window in trajectory["window_ids"]:
                self.assertNotIn(window, windows)
                windows[window] = trajectory["split"]

    def test_normalizers_are_train_only_and_units_are_explicit(self):
        self.assertEqual(self.state_normalizer.fit_split, "train")
        self.assertEqual(self.target_normalizer.fit_split, "train")
        self.assertEqual(self.state_normalizer.units[0], "world-length units")
        with self.assertRaises(PredictorContractError):
            TrainOnlyNormalizer.fit(
                [self.development_examples[0].target_state],
                component_names=self.target_normalizer.component_names,
                units=self.target_normalizer.units,
                split="development",
            )
        with self.assertRaises(PredictorContractError):
            fit_train_normalizers(self.train_trajectories + self.development_trajectories[:1])

    def test_model_has_actual_head_and_geometry_pair_is_same_contract(self):
        off = LearnedObservablePredictor(init_seed=7, geometry_enabled=False)
        on = LearnedObservablePredictor(init_seed=7, geometry_enabled=True)
        self.assertEqual(off.head_weight.shape, (28, 52))
        self.assertEqual(off.parameter_count, off.core.parameter_count() + 28 * 52 + 28)
        self.assertNotEqual(off.parameter_digest(), on.parameter_digest())
        self.assertEqual(off.model_identity()["head"]["output_dim"], 28)
        self.assertEqual(off.model_identity()["input_contract"]["hidden_fields_used"], [])
        self.assertFalse(off.model_identity()["competence_claim"])

    def test_loss_is_public_physical_observable_loss_and_has_head_gradients(self):
        model = LearnedObservablePredictor(init_seed=7, geometry_enabled=False)
        loss, gradients = model.loss_and_gradients(
            self.train_trajectories[0],
            state_normalizer=self.state_normalizer,
            target_normalizer=self.target_normalizer,
        )
        self.assertTrue(np.isfinite(loss))
        self.assertIn("predictor.head_weight", gradients)
        self.assertIn("predictor.head_bias", gradients)
        self.assertEqual(gradients["predictor.head_weight"].shape, (28, 52))
        self.assertTrue(np.isfinite(gradients["predictor.head_weight"]).all())

    def test_prediction_head_is_conditioned_on_public_action(self):
        model = LearnedObservablePredictor(init_seed=7, geometry_enabled=False)
        history = list(self.train_examples[0].history)
        coast = candidate_actions()[0]
        drive = candidate_actions()[1]
        coast_history = tuple(history[:-1]) + (
            type(history[-1])(history[-1].state, tuple(coast.drive_vector), coast.duration_ticks),
        )
        drive_history = tuple(history[:-1]) + (
            type(history[-1])(history[-1].state, tuple(drive.drive_vector), drive.duration_ticks),
        )
        coast_prediction = model.forward(
            coast_history,
            state_normalizer=self.state_normalizer,
            target_normalizer=self.target_normalizer,
        )
        drive_prediction = model.forward(
            drive_history,
            state_normalizer=self.state_normalizer,
            target_normalizer=self.target_normalizer,
        )
        self.assertGreater(float(np.linalg.norm(coast_prediction - drive_prediction)), 0.0)
        self.assertEqual(ACTION_DRIVE_SCALE, 0.20)

    def test_sequential_trajectory_contract_consumes_each_frame_once(self):
        model = LearnedObservablePredictor(init_seed=7, geometry_enabled=False)
        calls = 0
        original_step = model.core.step

        def counted_step(*args, **kwargs):
            nonlocal calls
            calls += 1
            return original_step(*args, **kwargs)

        model.core.step = counted_step
        predictions, _ = model.forward_trajectory(
            self.train_trajectories[0],
            state_normalizer=self.state_normalizer,
            target_normalizer=self.target_normalizer,
        )
        self.assertEqual(len(predictions), 11)
        self.assertEqual(calls, len(self.train_trajectories[0].actions))

    def test_recursive_rollout_consumes_initial_context_once(self):
        model = LearnedObservablePredictor(init_seed=7, geometry_enabled=False)
        calls = 0
        original_step = model.core.step

        def counted_step(*args, **kwargs):
            nonlocal calls
            calls += 1
            return original_step(*args, **kwargs)

        model.core.step = counted_step
        recursive_rollout(
            model,
            self.train_examples[0].history,
            candidate_actions(),
            state_normalizer=self.state_normalizer,
            target_normalizer=self.target_normalizer,
            horizon=4,
        )
        self.assertEqual(calls, 2 + 3)

    def test_initial_phase_condition_changes_public_state(self):
        # Use an inspected development seed for the physics unit check; the
        # 9500--9507 final-test range remains metadata-only and unmaterialized.
        base_world = _conditioned_world(9300, WORLD_CONDITIONS["base"])
        phase_world = _conditioned_world(9300, WORLD_CONDITIONS["initial_phase_shifted"])
        base = public_observation_to_vector(PublicObservation.from_world(base_world, fixture_id="base", cycle=0))
        phase = public_observation_to_vector(PublicObservation.from_world(phase_world, fixture_id="phase", cycle=0))
        self.assertGreater(float(np.linalg.norm(base - phase)), 0.0)

    def test_nonfinite_and_out_of_bounds_values_fail_visibly(self):
        with self.assertRaises(PredictorContractError):
            validate_public_state_vector(np.full(28, np.nan))
        bad = np.zeros(28, dtype=np.float64)
        bad[26] = -1.0
        with self.assertRaises(RolloutBoundsError):
            validate_public_state_vector(bad)
        bad = np.zeros(28, dtype=np.float64)
        bad[16] = -1.0
        with self.assertRaises(RolloutBoundsError):
            validate_public_state_vector(bad)

    def test_recursive_rollout_does_not_use_future_targets(self):
        model = LearnedObservablePredictor(init_seed=7, geometry_enabled=False)
        actions = candidate_actions()
        first = recursive_rollout(
            model,
            self.train_examples[0].history,
            actions,
            state_normalizer=self.state_normalizer,
            target_normalizer=self.target_normalizer,
            horizon=2,
        )
        altered_history = list(self.train_examples[0].history)
        altered_history[0] = type(altered_history[0])(
            altered_history[0].state,
            altered_history[0].action,
            altered_history[0].duration_ticks,
        )
        second = recursive_rollout(
            model,
            tuple(altered_history),
            actions,
            state_normalizer=self.state_normalizer,
            target_normalizer=self.target_normalizer,
            horizon=2,
        )
        np.testing.assert_allclose(first[0], second[0])
        self.assertEqual(len(first), 2)

    def test_baselines_are_public_variants(self):
        persistence = PersistenceBaseline().predict(self.train_examples[0].history)
        nominal = NominalSimulatorBaseline().predict(self.train_examples[0].history)
        np.testing.assert_allclose(persistence, self.train_examples[0].history[-1].state)
        self.assertEqual(nominal.shape, (28,))
        linear = LinearObservableBaseline().fit(self.train_trajectories)
        self.assertIsNotNone(linear.weight)
        with self.assertRaises(PredictorContractError):
            LinearObservableBaseline().predict(self.train_examples[0].history)

    def test_nominal_baseline_preserves_cumulative_clock_and_residual(self):
        state = np.asarray(self.train_examples[0].history[-1].state, dtype=np.float64).copy()
        state[TIME_INDEX] = 0.14
        state[RESIDUAL_INDEX] = 0.12
        frame = type(self.train_examples[0].history[-1])(
            tuple(state),
            self.train_examples[0].history[-1].action,
            self.train_examples[0].history[-1].duration_ticks,
        )
        output = NominalSimulatorBaseline().predict((frame,))
        self.assertAlmostEqual(output[TIME_INDEX], 0.14 + 2 * ResonantWorld.DT, places=12)
        self.assertGreater(abs(float(output[RESIDUAL_INDEX])), 0.05)

    def test_final_test_is_reserved_and_development_is_evaluable(self):
        model = LearnedObservablePredictor(init_seed=7, geometry_enabled=False)
        with self.assertRaises(EvaluationReservationError):
            build_examples("test")
        with self.assertRaises(EvaluationReservationError):
            build_trajectories("test", include_test=True, reviewed_selection_artifact={"status": "draft"})
        result = evaluate_examples(
            model,
            self.development_examples[:1],
            split="development",
            state_normalizer=self.state_normalizer,
            target_normalizer=self.target_normalizer,
        )
        self.assertEqual(result["status"], "complete")
        self.assertIsNotNone(result["metrics"])
        self.assertIn("per_component", result["metrics"])
        self.assertIn("normalized_per_component", result["metrics"])
        self.assertEqual(len(result["metrics"]["per_component"]), 28)

    def test_constraint_false_negative_denominator_is_actual_violation_count(self):
        safe = np.zeros(28, dtype=np.float64)
        safe[TIME_INDEX] = 0.1
        no_violation = _prediction_metrics([safe], [safe], target_normalizer=self.target_normalizer)
        self.assertEqual(no_violation["constraint_violation_count"], 0)
        self.assertIsNone(no_violation["constraint_false_negative_rate"])
        violated = safe.copy()
        violated[LOCAL_ENERGY_START + 1] = 0.3
        false_negative = _prediction_metrics([safe], [violated], target_normalizer=self.target_normalizer)
        self.assertEqual(false_negative["constraint_violation_count"], 1)
        self.assertEqual(false_negative["constraint_false_negative_count"], 1)
        self.assertEqual(false_negative["constraint_false_negative_rate"], 1.0)

    def test_optimizer_updates_exactly_the_frozen_parameter_set(self):
        model = LearnedObservablePredictor(init_seed=7, geometry_enabled=True)
        _, gradients = model.loss_and_gradients(
            self.train_trajectories[0],
            state_normalizer=self.state_normalizer,
            target_normalizer=self.target_normalizer,
        )
        before = model.parameter_digest()
        update = model.apply_gradients(gradients)
        self.assertEqual(update["optimizer"], "sgd")
        self.assertNotEqual(model.parameter_digest(), before)
        with self.assertRaises(PredictorContractError):
            model.apply_gradients({name: value for name, value in gradients.items() if name != "predictor.head_bias"})

    def test_optimizer_stages_all_parameters_before_rejecting_late_invalid_gradient(self):
        model = LearnedObservablePredictor(init_seed=7, geometry_enabled=True)
        _, gradients = model.loss_and_gradients(
            self.train_trajectories[0],
            state_normalizer=self.state_normalizer,
            target_normalizer=self.target_normalizer,
        )
        before = model.parameter_digest()
        gradients["predictor.head_weight"] = gradients["predictor.head_weight"].copy()
        gradients["predictor.head_weight"][0, 0] = np.nan
        with self.assertRaises(PredictorContractError):
            model.apply_gradients(gradients)
        self.assertEqual(model.parameter_digest(), before)

    def test_normalizer_provenance_binds_mean_scale_and_training_source(self):
        payload = self.state_normalizer.as_dict()
        tampered = dict(payload)
        tampered["mean"] = list(payload["mean"])
        tampered["mean"][0] += 1.0
        with self.assertRaises(NormalizerContractError):
            TrainOnlyNormalizer.from_dict(tampered)
        tampered_source = dict(payload)
        tampered_source["train_value_sha256"] = "0" * 64
        with self.assertRaises(NormalizerContractError):
            TrainOnlyNormalizer.from_dict(tampered_source)

    def test_representative_core_and_geometry_gradients_match_finite_difference(self):
        model = LearnedObservablePredictor(init_seed=7, geometry_enabled=True)
        trajectory = self.train_trajectories[0]
        _, gradients = model.loss_and_gradients(
            trajectory,
            state_normalizer=self.state_normalizer,
            target_normalizer=self.target_normalizer,
        )
        for parameter_name in ("base.p0.W_in", "base.c.W_in", "h.geometry.raw_B"):
            epsilon = 1.0e-5

            def perturbed_loss(delta):
                clone = copy.deepcopy(model)
                if parameter_name.startswith("base."):
                    array = clone.core.base.params[parameter_name[5:]]
                else:
                    array = clone.core.params[parameter_name]
                array.flat[0] += delta
                return clone.loss_and_gradients(
                    trajectory,
                    state_normalizer=self.state_normalizer,
                    target_normalizer=self.target_normalizer,
                )[0]

            numerical = (perturbed_loss(epsilon) - perturbed_loss(-epsilon)) / (2.0 * epsilon)
            analytic = float(gradients[parameter_name].flat[0])
            scale = max(1.0e-6, abs(numerical), abs(analytic))
            self.assertLess(abs(numerical - analytic) / scale, 5.0e-2, parameter_name)

    def test_deadline_returns_structured_partial_without_metrics(self):
        result = evaluate_examples(
            PersistenceBaseline(),
            self.development_examples[:2],
            split="development",
            deadline_monotonic=0.0,
        )
        self.assertEqual(result["status"], "partial_deadline_exhausted")
        self.assertEqual(result["metrics"], None)
        self.assertEqual(result["cases_completed"], 0)
        shared = SharedDeadline(0.0, clock=lambda: 1.0)
        result = evaluate_examples(
            PersistenceBaseline(),
            self.development_examples[:2],
            split="development",
            target_normalizer=self.target_normalizer,
            deadline=shared,
        )
        self.assertEqual(result["status"], "partial_deadline_exhausted")
        self.assertEqual(result["metrics"], None)

    def test_paired_deadline_invalidates_both_variants_for_selection(self):
        result = evaluate_paired_variants(
            {"geometry_off": PersistenceBaseline(), "geometry_on": PersistenceBaseline()},
            self.development_examples[:1],
            split="development",
            target_normalizer=self.target_normalizer,
            deadline=SharedDeadline(0.0, clock=lambda: 1.0),
        )
        self.assertEqual(result["status"], "incomplete_shared_deadline")
        self.assertFalse(result["selection_eligible"])
        self.assertEqual(result["variants"]["geometry_off"]["metrics"], None)

    def test_deadline_is_checked_across_recursive_rollout_save_load_and_selection(self):
        expired = SharedDeadline(0.0, clock=lambda: 1.0)
        with self.assertRaises(EvaluationDeadlineError):
            recursive_rollout(
                PersistenceBaseline(),
                self.train_examples[0].history,
                candidate_actions(),
                horizon=2,
                deadline=expired,
            )
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "checkpoint.json"
            model = LearnedObservablePredictor(init_seed=7, geometry_enabled=False)
            save_checkpoint(
                path,
                model,
                state_normalizer=self.state_normalizer,
                target_normalizer=self.target_normalizer,
                split_manifest_sha256="manifest-hash",
                experiment_config_sha256="config-hash",
            )
            with self.assertRaises(EvaluationDeadlineError):
                load_checkpoint(path, deadline=expired)
        with self.assertRaises(EvaluationDeadlineError):
            select_development_checkpoint(
                [{"status": "complete", "development_normalized_mse": 1.0, "development_rollout_rmse": 1.0, "init_seed": 7}],
                deadline=expired,
            )

    def test_frozen_selection_digest_and_exact_provenance_binding(self):
        binding = {
            "variant": "learned_geometry_off",
            "init_seed": 7,
            "checkpoint_sha256": "c" * 64,
            "state_normalizer_provenance_sha256": self.state_normalizer.provenance_sha256,
            "target_normalizer_provenance_sha256": self.target_normalizer.provenance_sha256,
        }
        artifact = build_frozen_selection_artifact(
            split_manifest_sha256="a" * 64,
            experiment_config_sha256="b" * 64,
            selected_checkpoints=[binding],
        )
        self.assertEqual(selection_artifact_digest(artifact), artifact["artifact_sha256"])
        self.assertEqual(
            verify_frozen_selection_artifact(
                artifact,
                expected_split_manifest_sha256="a" * 64,
                expected_experiment_config_sha256="b" * 64,
                expected_selected_checkpoints=[artifact["selected_checkpoints"][0]],
            ),
            artifact["artifact_sha256"],
        )
        tampered = dict(artifact)
        tampered["experiment_config_sha256"] = "d" * 64
        with self.assertRaises(EvaluationReservationError):
            verify_frozen_selection_artifact(tampered)
        with self.assertRaises(EvaluationReservationError):
            verify_frozen_selection_artifact(
                artifact,
                expected_split_manifest_sha256="e" * 64,
                expected_experiment_config_sha256="b" * 64,
                expected_selected_checkpoints=[artifact["selected_checkpoints"][0]],
            )

    def test_runner_timeout_is_structured_without_starting_optimization(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = run_pilot_training(
                Path(temporary) / "checkpoints",
                deadline=SharedDeadline(0.0, clock=lambda: 1.0),
            )
        self.assertEqual(result["status"], "incomplete_shared_deadline")
        self.assertEqual(result["pairs"], [])
        self.assertFalse(result["final_test_materialized"])
        self.assertIsNone(result["selection"])

    def test_case_failure_is_structured_and_metrics_are_omitted(self):
        class FailingBaseline:
            def predict(self, history):
                raise ValueError("synthetic predictor failure")

        result = evaluate_examples(
            FailingBaseline(),
            self.development_examples[:1],
            split="development",
            target_normalizer=self.target_normalizer,
        )
        self.assertEqual(result["status"], "partial_case_failure")
        self.assertEqual(result["metrics"], None)
        self.assertEqual(result["failures"][0]["type"], "ValueError")

    def test_checkpoint_round_trip_contains_full_system_and_provenance(self):
        model = LearnedObservablePredictor(init_seed=17, geometry_enabled=True)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "checkpoint.json"
            save_checkpoint(
                path,
                model,
                state_normalizer=self.state_normalizer,
                target_normalizer=self.target_normalizer,
                split_manifest_sha256="manifest-hash",
                experiment_config_sha256="config-hash",
                selection={"split": "development", "frozen": False},
            )
            payload = json.loads(path.read_text())
            self.assertEqual(payload["schema"], CHECKPOINT_SCHEMA)
            self.assertIn("core_base_params", payload)
            self.assertIn("core_hybrid_params", payload)
            self.assertIn("head_weight", payload)
            restored, state, target, provenance = load_checkpoint(path)
            self.assertEqual(restored.parameter_digest(), model.parameter_digest())
            self.assertEqual(state.train_value_sha256, self.state_normalizer.train_value_sha256)
            self.assertEqual(target.train_value_sha256, self.target_normalizer.train_value_sha256)
            self.assertEqual(state.provenance_sha256, self.state_normalizer.provenance_sha256)
            self.assertEqual(target.provenance_sha256, self.target_normalizer.provenance_sha256)
            self.assertEqual(provenance["split_manifest_sha256"], "manifest-hash")
            with self.assertRaises(PredictorContractError):
                load_checkpoint(path, expected_split_manifest_sha256="wrong-manifest")
            with self.assertRaises(PredictorContractError):
                load_checkpoint(path, expected_state_normalizer_sha256="wrong-normalizer")

            tampered_path = Path(temporary) / "tampered-normalizer.json"
            tampered_payload = json.loads(path.read_text())
            tampered_payload["state_normalizer"]["scale"][0] *= 2.0
            tampered_path.write_text(json.dumps(tampered_payload, sort_keys=True, separators=(",", ":")) + "\n")
            with self.assertRaises(NormalizerContractError):
                load_checkpoint(tampered_path)

    def test_checkpoint_serialization_mismatch_is_rejected(self):
        model = LearnedObservablePredictor(init_seed=7, geometry_enabled=False)
        payload = model.state_dict()
        payload["model_schema"] = "wrong"
        with self.assertRaises(PredictorContractError):
            model.load_state_dict(payload)

    def test_compute_audit_is_exact_and_head_is_counted(self):
        audit = compute_audit()
        self.assertEqual(audit["core_steps_per_one_step_prediction"], 2)
        self.assertEqual(audit["head_multiply_adds_per_prediction"], 28 * 53)
        self.assertEqual(audit["paired_initialization_seeds"], [7, 17, 37])
        config = pilot_experiment_config(split_manifest_sha256=build_split_manifest()["manifest_sha256"])
        self.assertEqual(config["compute_audit"]["training_trajectory_count"], 8)
        self.assertEqual(config["compute_audit"]["training_window_count"], 88)
        self.assertEqual(config["compute_audit"]["manifest_total_window_count"], 352)
        self.assertEqual(config["training"]["optimizer"], "sgd")
        self.assertEqual(config["training"]["updates"], 100)
        self.assertEqual(config["training"]["fit_count"], 6)
        self.assertEqual(config["training"]["eval_every_updates"], 100)
        self.assertEqual(config["training"]["upstream_training_gate"]["existing_all_four_models_training_success"], "8/8")
        self.assertIsNone(config["acceptance_thresholds"]["constraint_thresholds"]["zero_violation_rate"])

    def test_feasibility_probe_is_zero_update_and_train_only(self):
        result = feasibility_probe(repeats=1)
        self.assertEqual(result["status"], "probe_only_no_training")
        self.assertFalse(result["final_test_materialized"])
        self.assertEqual(result["timings"]["geometry_off"]["optimizer_updates"], 0)
        self.assertEqual(result["timings"]["geometry_on"]["data_split"], "train")
        self.assertEqual(result["train_trajectories_materialized"], 8)
        self.assertEqual(result["train_windows_materialized"], 88)
        self.assertTrue(result["not_end_to_end_training_estimate"])
        self.assertGreater(result["probe_based_six_fit_optimizer_seconds"], 0.0)
        self.assertEqual(result["runner_budget"]["updates_per_variant_seed"], 100)

    def test_artifact_writer_creates_only_new_pilot_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "pilot"
            hashes = write_pilot_artifacts(output, repeats=1)
            self.assertEqual(
                set(hashes),
                {"experiment_config.json", "split_manifest.json", "cpu_feasibility.json", "README.md", "runner_review.md", "checkpoint_README.md"},
            )
            self.assertTrue((output / "experiment_config.json").exists())
            self.assertTrue((output / "split_manifest.json").exists())
            config = json.loads((output / "experiment_config.json").read_text())
            self.assertEqual(config["status"], "runner_implemented_configuration_only_no_training")
            self.assertFalse(config["resource_budget"]["full_retraining_started"])


if __name__ == "__main__":
    unittest.main()
