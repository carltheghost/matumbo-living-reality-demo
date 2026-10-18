import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from vevo_agents.v03_learned_predictor import (
    ACTION_DRIVE_SCALE,
    CHECKPOINT_SCHEMA,
    DEVELOPMENT_WORLD_SEEDS,
    EvaluationReservationError,
    LearnedObservablePredictor,
    LinearObservableBaseline,
    NominalSimulatorBaseline,
    PersistenceBaseline,
    PredictorContractError,
    RolloutBoundsError,
    TrainOnlyNormalizer,
    build_examples,
    build_split_manifest,
    compute_audit,
    evaluate_examples,
    feasibility_probe,
    fit_train_normalizers,
    load_checkpoint,
    pilot_experiment_config,
    public_observation_to_vector,
    recursive_rollout,
    save_checkpoint,
    validate_public_state_vector,
    verify_split_manifest,
    write_pilot_artifacts,
)
from vevo_agents.physics import ResonantWorld
from vevo_agents.v03_simulator_planner import PublicObservation, candidate_actions


class LearnedPredictorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.train_examples = build_examples("train", include_test=False)
        cls.development_examples = build_examples("development", include_test=False)
        cls.state_normalizer, cls.target_normalizer = fit_train_normalizers(cls.train_examples)

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
            fit_train_normalizers(self.train_examples + self.development_examples[:1])

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
            self.train_examples[0],
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
        linear = LinearObservableBaseline().fit(self.train_examples)
        self.assertIsNotNone(linear.weight)
        with self.assertRaises(PredictorContractError):
            LinearObservableBaseline().predict(self.train_examples[0].history)

    def test_final_test_is_reserved_and_development_is_evaluable(self):
        model = LearnedObservablePredictor(init_seed=7, geometry_enabled=False)
        with self.assertRaises(EvaluationReservationError):
            evaluate_examples(model, build_examples("test"), split="test")
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
        self.assertEqual(len(result["metrics"]["per_component"]), 28)

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
            self.assertEqual(provenance["split_manifest_sha256"], "manifest-hash")

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

    def test_feasibility_probe_is_zero_update_and_train_only(self):
        result = feasibility_probe(repeats=1)
        self.assertEqual(result["status"], "probe_only_no_training")
        self.assertFalse(result["final_test_materialized"])
        self.assertEqual(result["timings"]["geometry_off"]["optimizer_updates"], 0)
        self.assertEqual(result["timings"]["geometry_on"]["data_split"], "train")

    def test_artifact_writer_creates_only_new_pilot_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "pilot"
            hashes = write_pilot_artifacts(output, repeats=1)
            self.assertEqual(
                set(hashes),
                {"experiment_config.json", "split_manifest.json", "cpu_feasibility.json", "README.md", "checkpoint_README.md"},
            )
            self.assertTrue((output / "experiment_config.json").exists())
            self.assertTrue((output / "split_manifest.json").exists())
            config = json.loads((output / "experiment_config.json").read_text())
            self.assertEqual(config["status"], "implementation_and_configuration_only_no_training")
            self.assertFalse(config["resource_budget"]["full_retraining_started"])


if __name__ == "__main__":
    unittest.main()
