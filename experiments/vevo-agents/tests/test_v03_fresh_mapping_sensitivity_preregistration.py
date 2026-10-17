import unittest

from vevo_agents.v03_fresh_mapping_sensitivity_preregistration import (
    BASE_EVALUATION_REPORT_SHA256,
    BASE_EVALUATION_SOURCE_SHA,
    BASELINE_HIDDEN_DELAY_STEPS,
    NOTE_FORMAT_VARIANT_TEMPLATE,
    SENSITIVITY_ARM_IDS,
    SENSITIVITY_DELAY_STEPS,
    build_preregistration,
)


class V03FreshMappingSensitivityPreregistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = build_preregistration()

    def test_source_only_review_gate_has_no_variant_outcomes(self):
        self.assertEqual(
            self.plan["status"],
            "awaiting_independent_review_before_sensitivity_evaluation",
        )
        self.assertTrue(self.plan["scope_boundary"]["source_only"])
        self.assertTrue(self.plan["scope_boundary"]["inference_only"])
        self.assertTrue(self.plan["scope_boundary"]["no_new_training"])
        self.assertTrue(self.plan["scope_boundary"]["not_fresh_mapping_evidence"])
        self.assertTrue(self.plan["scope_boundary"]["not_general_agent_evidence"])
        self.assertFalse(self.plan["evaluation_started"])
        self.assertEqual(self.plan["sensitivity_cases_evaluated"], 0)
        self.assertFalse(self.plan["sensitivity_model_outcomes_loaded"])

    def test_four_arms_and_primary_count_are_exactly_frozen(self):
        self.assertEqual(
            [arm["id"] for arm in self.plan["arms"]],
            list(SENSITIVITY_ARM_IDS),
        )
        self.assertEqual(
            [arm["hidden_delay_steps"] for arm in self.plan["arms"]],
            [2, 4, 8, 2],
        )
        self.assertEqual(
            [arm["hidden_delay_steps_relative_to_current_two"] for arm in self.plan["arms"]],
            [0, 2, 6, 0],
        )
        self.assertEqual(SENSITIVITY_DELAY_STEPS, (2, 4, 8))
        self.assertEqual(BASELINE_HIDDEN_DELAY_STEPS, 2)
        self.assertEqual(self.plan["metrics"]["primary_evaluation_count"], 256)
        self.assertEqual(self.plan["resource_budget"]["primary_evaluations"], 256)
        self.assertEqual(self.plan["baseline_action_replay"]["expected_case_checkpoint_pairs"], 64)
        self.assertEqual(
            self.plan["protocol_contract"]["note_payload_masks_baseline"],
            [0, 1, 0, 0, 0],
        )
        self.assertEqual(
            self.plan["arms"][3]["note_format_template"],
            NOTE_FORMAT_VARIANT_TEMPLATE,
        )

    def test_partitions_are_separate_and_now_inspected(self):
        manifest = self.plan["case_manifest"]
        self.assertEqual(len(manifest), 16)
        self.assertEqual(
            self.plan["case_partitions"]["training_disjoint_never_inspected_mapping_new_world"]["case_count"],
            8,
        )
        self.assertEqual(
            self.plan["case_partitions"]["training_disjoint_counterfactual_exposed_mapping_new_world"]["case_count"],
            8,
        )
        for partition in self.plan["case_partitions"].values():
            self.assertTrue(partition["now_inspected"])
            self.assertFalse(partition["fresh_mapping_evidence"])
        self.assertEqual(
            self.plan["baseline_evaluation_identity"]["report_sha256"],
            BASE_EVALUATION_REPORT_SHA256,
        )
        self.assertEqual(
            self.plan["baseline_evaluation_identity"]["source_sha"],
            BASE_EVALUATION_SOURCE_SHA,
        )

    def test_stopping_and_local_demo_contract_are_explicit(self):
        budget = self.plan["resource_budget"]
        self.assertTrue(budget["no_retry_tuning_or_arm_substitution"])
        self.assertTrue(budget["no_metrics_after_budget_exhaustion"])
        self.assertIn("before each case", budget["deadline_checks"])
        self.assertIn("between arms", budget["deadline_checks"])
        self.assertTrue(self.plan["failure_and_cap_reporting"]["preserve_baseline_replay_prefix"])
        self.assertTrue(self.plan["failure_and_cap_reporting"]["do_not_execute_variants_after_baseline_replay_mismatch"])
        self.assertEqual(
            self.plan["local_only_demo_integration_outline"]["status"],
            "outline_only_not_executed",
        )
        self.assertFalse(self.plan["local_only_demo_integration_outline"]["general_agent_claim"])


if __name__ == "__main__":
    unittest.main()
