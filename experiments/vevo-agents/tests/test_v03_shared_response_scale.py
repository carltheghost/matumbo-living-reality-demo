import copy
import json
from pathlib import Path
import unittest

import numpy as np

from vevo_agents.v03_delayed_memory import _training_observations, build_delayed_examples, make_training_specs
from vevo_agents.v03_delayed_factorial_diagnostic import (
    CHANNEL_RESPONSE_FEATURE_INDICES,
    _final_input_audit,
)
from vevo_agents.v03_shared_response_scale_preregistration import build_preregistration
from vevo_agents.v03_model import (
    POLICY_VECTOR_DIM,
    RESPONSE_FEATURE_END,
    RESPONSE_FEATURE_START,
    SHARED_RESPONSE_INPUT_NORMALIZATION_SCHEMA,
    V03FiveBrain,
    _fit_shared_max_abs_scale,
    encode_policy_observation,
    fit_input_normalization,
    fit_shared_max_abs_input_normalization,
    normalize_policy_vector,
)


class V03SharedResponseScaleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.examples = build_delayed_examples(make_training_specs())
        cls.observations = _training_observations(cls.examples)

    def test_fit_uses_only_the_observations_supplied_as_training_data(self):
        baseline = fit_shared_max_abs_input_normalization(self.observations)
        heldout = copy.deepcopy(self.examples[0]["policy_observations"][-1])
        heldout["measurement"]["channel_response"] = (np.ones((4, 4)) * 9.0).tolist()
        refit_with_heldout = fit_shared_max_abs_input_normalization(self.observations + [heldout])
        self.assertNotEqual(
            baseline["response_scaling"]["scale"],
            refit_with_heldout["response_scaling"]["scale"],
        )
        # The actual train-only fit is unchanged by a held-out object that is
        # never supplied to it; the explicit fit scope is part of the artifact.
        train_only_again = fit_shared_max_abs_input_normalization(list(self.observations))
        self.assertEqual(baseline, train_only_again)
        self.assertEqual(
            baseline["response_scaling"]["fit_scope"],
            "present training observations only",
        )

    def test_shared_response_block_has_no_centering_or_clipping(self):
        normalization = fit_shared_max_abs_input_normalization(self.observations)
        self.assertEqual(normalization["schema"], SHARED_RESPONSE_INPUT_NORMALIZATION_SCHEMA)
        self.assertEqual(
            normalization["response_scaling"]["feature_indices"],
            list(range(RESPONSE_FEATURE_START, RESPONSE_FEATURE_END)),
        )
        response_mean = np.asarray(normalization["mean"])[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END]
        self.assertTrue(np.array_equal(response_mean, np.zeros(16)))

        observation = copy.deepcopy(self.examples[0]["policy_observations"][-1])
        observation["measurement"]["channel_response"] = (
            np.asarray([[10.0, -10.0, 2.0, -2.0]] * 4).tolist()
        )
        raw = encode_policy_observation(observation)
        normalized = normalize_policy_vector(raw, normalization)
        expected = raw[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END] / normalization["response_scaling"]["scale"]
        np.testing.assert_array_equal(
            normalized[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END], expected
        )
        self.assertGreater(float(np.max(np.abs(normalized[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END]))), 3.0)

    def test_positive_shared_scale_preserves_every_response_ordering(self):
        normalization = fit_shared_max_abs_input_normalization(self.observations)
        observation = self.examples[0]["policy_observations"][-1]
        raw = encode_policy_observation(observation)
        normalized = normalize_policy_vector(raw, normalization)
        raw_matrix = raw[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END].reshape(4, 4)
        normalized_matrix = normalized[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END].reshape(4, 4)
        for column in range(4):
            np.testing.assert_array_equal(
                np.argsort(-raw_matrix[:, column], kind="stable"),
                np.argsort(-normalized_matrix[:, column], kind="stable"),
            )

    def test_measurement_mask_zeroes_response_without_leakage(self):
        normalization = fit_shared_max_abs_input_normalization(self.observations)
        hidden = self.examples[0]["policy_observations"][0]
        raw = encode_policy_observation(hidden)
        self.assertEqual(raw[1], 0.0)
        normalized = normalize_policy_vector(raw, normalization)
        self.assertTrue(np.array_equal(
            normalized[RESPONSE_FEATURE_START:RESPONSE_FEATURE_END], np.zeros(16)
        ))

    def test_zero_and_invalid_fit_values_have_explicit_finite_fallbacks(self):
        zero = _fit_shared_max_abs_scale(np.zeros(16))
        self.assertEqual(zero["scale"], 1.0)
        self.assertEqual(zero["fallback"], "unit_scale_all_finite_values_zero")
        invalid = _fit_shared_max_abs_scale(np.asarray([np.nan, np.inf, -np.inf]))
        self.assertEqual(invalid["scale"], 1.0)
        self.assertEqual(invalid["fallback"], "unit_scale_no_finite_values")
        model = V03FiveBrain(107)
        with self.assertRaises(ValueError):
            normalize_policy_vector(np.full(POLICY_VECTOR_DIM, np.nan), fit_shared_max_abs_input_normalization(self.observations))
        model.set_input_normalization(fit_shared_max_abs_input_normalization(self.observations))
        self.assertEqual(model.normalization_state(), fit_shared_max_abs_input_normalization(self.observations))

    def test_json_roundtrip_and_legacy_checkpoint_behavior(self):
        normalization = fit_shared_max_abs_input_normalization(self.observations)
        roundtrip = json.loads(json.dumps(normalization, sort_keys=True))
        self.assertEqual(roundtrip, normalization)

        checkpoint_path = Path("storage/checkpoints/v03-neural-delayed-memory-full-seed-107.json")
        payload = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        self.assertEqual(payload["normalization"]["schema"], "vevo.v03.input-normalization.v1")
        legacy = V03FiveBrain(int(payload["seed"]))
        legacy.load_state_dict(payload["state"])
        legacy.set_input_normalization(payload["normalization"])
        observation = self.examples[0]["policy_observations"][-1]
        prediction_before = legacy.predict([observation])
        restored = V03FiveBrain(int(payload["seed"]))
        restored.load_state_dict(payload["state"])
        restored.set_input_normalization(json.loads(json.dumps(payload["normalization"])))
        prediction_after = restored.predict([observation])
        np.testing.assert_array_equal(
            prediction_before["trace"]["gate_probs"], prediction_after["trace"]["gate_probs"]
        )
        np.testing.assert_array_equal(
            prediction_before["trace"]["frequency_probs"], prediction_after["trace"]["frequency_probs"]
        )
        self.assertEqual(legacy.normalization_state(), payload["normalization"])

    def test_preregistration_is_separate_and_has_no_executed_trials(self):
        plan = build_preregistration()
        self.assertEqual(plan["status"], "awaiting_review_before_retraining")
        self.assertFalse(plan["training_started"])
        self.assertEqual(plan["executed_trials"], 0)
        self.assertEqual(len(plan["seeds"]["trials"]), 4)
        self.assertIn("--response-scaling shared_max_abs", plan["execution_command_after_review"])
        self.assertEqual(plan["compute_budget"]["deadline_enforcement"], "cooperative")
        self.assertTrue(plan["compute_budget"]["deadline_overrun_possible"])
        self.assertTrue(plan["compute_budget"]["elapsed_measurement_excludes_final_serialization"])
        self.assertFalse(plan["compute_budget"]["one_blas_or_openmp_thread_guaranteed"])
        self.assertFalse(plan["compute_budget"]["fixed_memory_ceiling_guaranteed"])
        self.assertTrue(all(
            "shared-response-scale" in path
            for path in plan["separate_artifacts"]["checkpoint_paths"]
        ))

    def test_clip_audit_labels_at_or_beyond_bound_correctly(self):
        before = np.zeros(POLICY_VECTOR_DIM, dtype=np.float64)
        before[list(CHANNEL_RESPONSE_FEATURE_INDICES)[:3]] = [-3.0, 3.0, 4.0]
        after = before.copy()
        after[list(CHANNEL_RESPONSE_FEATURE_INDICES)] = np.clip(
            after[list(CHANNEL_RESPONSE_FEATURE_INDICES)], -3.0, 3.0
        )
        audit = _final_input_audit(
            before,
            after,
            condition="clip_response",
            pre_final_state_digest="test",
        )
        self.assertEqual(audit["at_or_beyond_clip_bound_after_count"], 3)
        self.assertNotIn("at_clip_bound_after_count", audit)


if __name__ == "__main__":
    unittest.main()
