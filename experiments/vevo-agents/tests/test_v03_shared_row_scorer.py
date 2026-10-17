import copy
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from vevo_agents.v03_delayed_memory import (
    _load_delayed_checkpoint,
    _save_delayed_checkpoint,
    _training_observations,
    build_delayed_examples,
    make_development_specs,
    make_training_specs,
)
from vevo_agents.v03_model import (
    ACTION_DIM,
    LEGACY_GATE_HEAD,
    RESPONSE_FEATURE_END,
    RESPONSE_FEATURE_START,
    SHARED_RESPONSE_INPUT_NORMALIZATION_SCHEMA,
    SHARED_ROW_FEATURE_DIM,
    SHARED_ROW_GATE_HEAD,
    V03FiveBrain,
    V03SingleRecurrentMemory,
    _shared_row_gate_logits,
    fit_input_normalization,
    fit_shared_max_abs_input_normalization,
)
from vevo_agents.v03_shared_row_diagnostic import run_diagnostic
from vevo_agents.v03_shared_row_scorer_preregistration import build_preregistration


class V03SharedRowScorerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.training_examples = build_delayed_examples(make_training_specs())
        cls.development_examples = build_delayed_examples(make_development_specs())
        cls.normalization = fit_shared_max_abs_input_normalization(
            _training_observations(cls.training_examples)
        )

    def _shared_models(self):
        return (
            V03FiveBrain(107, gate_head=SHARED_ROW_GATE_HEAD),
            V03SingleRecurrentMemory(141, gate_head=SHARED_ROW_GATE_HEAD),
        )

    @staticmethod
    def _training_state(model):
        rng = np.random.default_rng(1107)
        return {
            "updates": 0,
            "stopped_reason": None,
            "rng_state": rng.bit_generator.state,
            "shuffle_order": list(range(8)),
            "next_minibatch_index": 0,
            "next_cycle_requires_shuffle": True,
            "optimizer_first": {name: np.zeros_like(value) for name, value in model.params.items()},
            "optimizer_second": {name: np.zeros_like(value) for name, value in model.params.items()},
        }

    def test_shared_head_parameter_delta_and_audit(self):
        full_legacy = V03FiveBrain(107)
        control_legacy = V03SingleRecurrentMemory(141)
        for model, legacy, context_dim in (
            (self._shared_models()[0], full_legacy, 18),
            (self._shared_models()[1], control_legacy, 51),
        ):
            self.assertEqual(model.parameter_count(), legacy.parameter_count() + 1)
            self.assertNotIn("W_action_gate", model.params)
            self.assertNotIn("b_action_gate", model.params)
            prefix = "c." if isinstance(model, V03FiveBrain) else ""
            self.assertEqual(model.params[prefix + "W_shared_row_context"].shape, (4, context_dim))
            self.assertEqual(model.params[prefix + "w_shared_row"].shape, (4,))
            self.assertEqual(model.params[prefix + "b_shared_row"].shape, (1,))
            audit = model.gate_head_audit()
            self.assertTrue(audit["shared_row_scorer"])
            self.assertFalse(audit["per_gate_parameters"])
            self.assertFalse(audit["evaluator_labels_in_inference"])
            self.assertTrue(audit["frequency_uses_retained_context"])
            legacy_common = legacy.params.keys() & model.params.keys()
            self.assertTrue(all(np.array_equal(legacy.params[name], model.params[name]) for name in legacy_common))
            frequency_name = "c.W_action_frequency" if isinstance(model, V03FiveBrain) else "W_action_frequency"
            self.assertTrue(np.array_equal(legacy.params[frequency_name], model.params[frequency_name]))

    def test_bilinear_head_changes_ranking_with_retained_context(self):
        params = {
            "W_shared_row_context": np.zeros((4, 2), dtype=np.float64),
            "w_shared_row": np.zeros(4, dtype=np.float64),
            "b_shared_row": np.zeros(1, dtype=np.float64),
        }
        params["W_shared_row_context"][0, 0] = 1.0
        params["W_shared_row_context"][1, 1] = 1.0
        rows = np.zeros((ACTION_DIM, SHARED_ROW_FEATURE_DIM), dtype=np.float64)
        rows[0, 0] = 1.0
        rows[1, 1] = 1.0
        first_context = np.asarray([2.0, 0.0])
        second_context = np.asarray([0.0, 2.0])
        first = _shared_row_gate_logits(params, rows, first_context, prefix="")
        second = _shared_row_gate_logits(params, rows, second_context, prefix="")
        self.assertEqual(int(np.argmax(first)), 0)
        self.assertEqual(int(np.argmax(second)), 1)
        self.assertFalse(np.array_equal(first, second))

    def test_shared_head_requires_v2_normalization(self):
        legacy = fit_input_normalization(_training_observations(self.training_examples))
        self.assertEqual(self.normalization["schema"], SHARED_RESPONSE_INPUT_NORMALIZATION_SCHEMA)
        for model in self._shared_models():
            with self.assertRaises(ValueError):
                model.set_input_normalization(legacy)
            model.set_input_normalization(self.normalization)
            self.assertEqual(model.normalization_state(), self.normalization)

    def test_preregistration_is_review_gated_and_bundled(self):
        plan = build_preregistration()
        self.assertEqual(plan["status"], "awaiting_review_before_retraining")
        self.assertFalse(plan["training_started"])
        self.assertEqual(plan["executed_trials"], 0)
        self.assertEqual(plan["comparison_design"]["fixed_trial_count"], 4)
        self.assertFalse(plan["comparison_design"]["pure_single_factor_claim"])
        self.assertTrue(plan["comparison_design"]["bundled_action_head_context_redesign"])
        self.assertTrue(plan["comparison_design"]["no_unreviewed_additional_factors"])
        self.assertTrue(plan["comparison_design"]["no_sweep_or_tuning"])
        self.assertIn("--gate-head shared_row_scorer", plan["execution_command_after_review"])
        self.assertTrue(plan["training_gate"]["explicitly_existing_gate"])
        self.assertFalse(plan["head_input_and_information_scope"]["phase_or_time_signal_added"])
        self.assertTrue(plan["architecture"]["legacy_checkpoints_unchanged"])
        self.assertTrue(plan["architecture"]["common_initialization"]["full"]["common_parameters_exact_match"])
        self.assertEqual(
            plan["historical_reference"]["primary"]["artifact_commit"],
            "c35c2e6729dc867b516de8229ddd99adb88bcc44",
        )

    def test_gradients_reach_shared_row_parameters(self):
        example = self.training_examples[0]
        for model in self._shared_models():
            model.set_input_normalization(self.normalization)
            loss, gradients, _, trace = model.loss_and_gradients(
                example["policy_observations"],
                target_gate=example["target_gate"],
                target_frequency=example["target_frequency"],
            )
            self.assertTrue(np.isfinite(loss))
            self.assertTrue(np.isfinite(gradients["W_shared_row_context"]).all() if "W_shared_row_context" in gradients else np.isfinite(gradients["c.W_shared_row_context"]).all())
            context_name = "W_shared_row_context" if "W_shared_row_context" in gradients else "c.W_shared_row_context"
            row_name = "w_shared_row" if "w_shared_row" in gradients else "c.w_shared_row"
            self.assertGreater(float(np.max(np.abs(gradients[context_name]))), 0.0)
            self.assertGreater(float(np.max(np.abs(gradients[row_name]))), 0.0)
            self.assertEqual(len(trace), 5)

    def test_shared_head_finite_difference_and_upstream_retained_context_gradient(self):
        example = self.training_examples[0]
        model = V03FiveBrain(107, gate_head=SHARED_ROW_GATE_HEAD)
        model.set_input_normalization(self.normalization)
        _, gradients, _, _ = model.loss_and_gradients(
            example["policy_observations"],
            target_gate=example["target_gate"],
            target_frequency=example["target_frequency"],
        )
        self.assertGreater(float(np.max(np.abs(gradients["c.W_in"]))), 0.0)
        parameter_name = "c.W_shared_row_context"
        index = np.unravel_index(
            int(np.argmax(np.abs(gradients[parameter_name]))),
            gradients[parameter_name].shape,
        )
        original = float(model.params[parameter_name][index])
        epsilon = 1e-5
        try:
            model.params[parameter_name][index] = original + epsilon
            plus = model.loss_only(
                example["policy_observations"],
                target_gate=example["target_gate"],
                target_frequency=example["target_frequency"],
            )
            model.params[parameter_name][index] = original - epsilon
            minus = model.loss_only(
                example["policy_observations"],
                target_gate=example["target_gate"],
                target_frequency=example["target_frequency"],
            )
        finally:
            model.params[parameter_name][index] = original
        finite_difference = (plus - minus) / (2.0 * epsilon)
        analytic = float(gradients[parameter_name][index])
        self.assertAlmostEqual(finite_difference, analytic, delta=max(1e-5, abs(analytic) * 2e-4))

    def test_final_response_permutation_preserves_shared_head_contract(self):
        example = self.development_examples[0]
        permutation = (1, 2, 3, 0)
        for model in self._shared_models():
            model.set_input_normalization(self.normalization)
            runtime = model.initial_runtime()
            for observation in example["policy_observations"][:-1]:
                runtime, _ = model.raw_step(runtime, observation)
            _, baseline = model.raw_step(runtime, example["policy_observations"][-1])
            permuted = copy.deepcopy(example["policy_observations"][-1])
            response = np.asarray(permuted["measurement"]["channel_response"])
            permuted["measurement"]["channel_response"] = response[list(permutation)].tolist()
            _, counterfactual = model.raw_step(runtime, permuted)
            np.testing.assert_allclose(
                counterfactual["gate_probs"],
                np.asarray(baseline["gate_probs"])[list(permutation)],
                atol=1e-12,
                rtol=0.0,
            )
            np.testing.assert_array_equal(counterfactual["frequency_probs"], baseline["frequency_probs"])
            np.testing.assert_array_equal(
                counterfactual["retained_goal_context"], baseline["retained_goal_context"]
            )
            np.testing.assert_array_equal(
                counterfactual["row_features"],
                np.asarray(baseline["row_features"])[list(permutation)],
            )

    def test_shared_checkpoint_roundtrip_and_gate_head_mismatch(self):
        model = V03FiveBrain(107, gate_head=SHARED_ROW_GATE_HEAD)
        model.set_input_normalization(self.normalization)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "shared.json"
            _save_delayed_checkpoint(
                path,
                model,
                self._training_state(model),
                self.normalization,
                source_sha=None,
            )
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["gate_head"], SHARED_ROW_GATE_HEAD)
            restored, loaded = _load_delayed_checkpoint(
                path,
                model_class=V03FiveBrain,
                expected_label="full",
                expected_seed=107,
                expected_normalization=self.normalization,
                expected_source_sha=None,
                expected_gate_head=SHARED_ROW_GATE_HEAD,
            )
            self.assertEqual(restored.gate_head, SHARED_ROW_GATE_HEAD)
            self.assertEqual(loaded["normalization"], self.normalization)
            np.testing.assert_array_equal(
                model.predict(self.training_examples[0]["policy_observations"])["trace"]["gate_probs"],
                restored.predict(self.training_examples[0]["policy_observations"])["trace"]["gate_probs"],
            )
            with self.assertRaises(ValueError):
                _load_delayed_checkpoint(
                    path,
                    model_class=V03FiveBrain,
                    expected_label="full",
                    expected_seed=107,
                    expected_normalization=self.normalization,
                    expected_source_sha=None,
                    expected_gate_head=LEGACY_GATE_HEAD,
                )

    def test_frozen_diagnostic_output_is_complete_and_preserves_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagnostic.json"
            result = run_diagnostic(output_report_path=output)
            self.assertEqual(result["status"], "complete")
            self.assertFalse(result["fresh_generalization_claim"])
            self.assertTrue(result["artifact_integrity"]["historical_unchanged"])
            self.assertTrue(result["artifact_integrity"]["input_checkpoints_unchanged"])
            self.assertTrue(result["artifact_integrity"]["preceding_shared_scale_baseline"]["matches_expected"])
            self.assertEqual(
                result["success_set_overlap"]["primary_reference"]["artifact_commit"],
                "c35c2e6729dc867b516de8229ddd99adb88bcc44",
            )
            self.assertEqual(
                result["preprocessing_symmetry"]["response_row_permutation_count"],
                result["preprocessing_symmetry"]["case_count"],
            )
            for key, item in result["shared_head_structural_permutation"].items():
                permutation = item["row_permutation"]
                self.assertEqual(permutation["gate_permutation_pass_count"], 32)
                self.assertEqual(permutation["frequency_invariance_pass_count"], 32)
            self.assertTrue(output.exists())
            self.assertTrue(output.with_suffix(".md").exists())
            self.assertIn("shared-row scorer diagnostic", output.with_suffix(".md").read_text())


if __name__ == "__main__":
    unittest.main()
