import json
from pathlib import Path
import unittest

from vevo_agents.v03_document_benchmark import (
    PREREG_SCHEMA,
    PREREG_STATUS,
    build_benchmark_preregistration,
    document_evidence_tasks,
    render_preregistration_markdown,
)


class DocumentBenchmarkPreregistrationTests(unittest.TestCase):
    def test_preregistration_is_review_gated_and_has_no_executed_model(self):
        spec = build_benchmark_preregistration()
        self.assertEqual(spec["schema"], PREREG_SCHEMA)
        self.assertEqual(spec["status"], PREREG_STATUS)
        self.assertFalse(spec["training_started"])
        self.assertFalse(spec["evaluation_started"])
        self.assertFalse(spec["model_available"])
        self.assertFalse(spec["jev_comparator"]["live_calls"])
        self.assertFalse(spec["jev_comparator"]["credentials"])
        self.assertIsNone(spec["jev_comparator"]["results"])

    def test_split_separates_whole_families_and_cases_are_development_only(self):
        spec = build_benchmark_preregistration()
        split = spec["frozen_split"]
        self.assertFalse(split["frozen"])
        self.assertEqual(split["status"], "partial_scope_pending_generators")
        self.assertTrue(split["whole_document_and_template_family_separation"])
        self.assertTrue(split["no_instance_overlap"])
        self.assertTrue(split["randomized_document_ids"])
        self.assertTrue(split["randomized_candidate_order"])
        self.assertEqual(split["development"]["case_seeds"], [9300, 9301, 9302])
        self.assertEqual(split["test"]["case_seeds"], [9400, 9401])
        self.assertEqual(split["train"]["document_count"], 1)
        self.assertEqual(split["development"]["document_count"], 3)
        self.assertEqual(split["test"]["document_count"], 2)
        self.assertEqual(split["train"]["manifest_status"], "pending_implementation")
        self.assertEqual(split["test"]["manifest_status"], "pending_implementation")
        self.assertIsNone(split["train"]["case_count"])
        self.assertIsNone(split["test"]["case_count"])
        self.assertEqual(split["randomized_candidate_order"]["status"], "implemented")
        self.assertEqual(split["randomized_document_ids"]["status"], "planned")
        self.assertEqual(split["randomized_catalog_order"]["status"], "planned")
        self.assertFalse(split["test"]["outcomes_materialized"])
        development_handles = set(split["development"]["document_handles"])
        test_handles = set(split["test"]["document_handles"])
        self.assertTrue(development_handles.isdisjoint(test_handles))
        self.assertTrue(all(
            set(case["document_handles"]).issubset(development_handles)
            for case in spec["development_cases"]
        ))

    def test_metrics_costs_and_document_interface_are_preregistered(self):
        spec = build_benchmark_preregistration()
        self.assertEqual(
            spec["metrics"],
            [
                "source_citation_accuracy",
                "verified_success",
                "false_completions",
                "tool_calls",
                "missing_fact_detection",
                "restart_parity",
            ],
        )
        self.assertTrue(spec["cost_accounting"]["separate_inference_and_end_to_end_costs"])
        interface = spec["document_policy_interface"]
        self.assertEqual(interface["peripheral_count"], 4)
        self.assertEqual(interface["central_count"], 1)
        self.assertEqual(interface["memory_shape"], [2, 6])
        self.assertTrue(interface["new_encoder_required"])
        self.assertTrue(interface["new_training_required"])
        self.assertEqual(spec["selection_rule"]["scope"], "development_only")
        self.assertEqual(spec["selection_rule"]["minimum_thresholds"]["source_citation_accuracy"], 1.0)
        self.assertEqual(spec["case_generation"]["minimum_documents_per_case"], 2)
        self.assertEqual(spec["case_generation"]["maximum_documents_per_case"], 6)
        self.assertEqual(spec["case_generation"]["maximum_sections_per_document"], 4)
        self.assertEqual(spec["case_generation"]["action_budget"], 16)
        self.assertFalse(spec["case_generation"]["task_manifest_materialized"])
        feasible = spec["first_model_task_scope"]
        self.assertTrue(feasible["exhaustive_inspection_required"])
        self.assertEqual(feasible["worst_case_budget_accounting"]["total_policy_action_calls"], 13)
        self.assertTrue(feasible["worst_case_budget_accounting"]["feasible_within_budget"])
        self.assertEqual(feasible["current_general_protocol_maximum"]["total_policy_action_calls"], 29)
        self.assertTrue(feasible["current_general_protocol_maximum"]["exceeds_action_budget"])
        self.assertEqual(spec["jev_comparator"]["eligibility"], "unverified")
        self.assertTrue(spec["jev_comparator"]["same_initial_request"])
        self.assertTrue(spec["jev_comparator"]["same_feedback"])
        self.assertEqual(spec["jev_comparator"]["retries"], 0)

    def test_tasks_have_bounded_shape_and_no_expected_answer_fields(self):
        tasks = document_evidence_tasks()
        self.assertEqual([task.seed for task in tasks], [9300, 9301, 9302])
        for task in tasks:
            self.assertLessEqual(len(task.document_handles), 6)
            self.assertLessEqual(len(task.requested_fields), 3)
            self.assertEqual(task.action_budget, 16)
        serialized = json.dumps(build_benchmark_preregistration(), sort_keys=True)
        for forbidden in ("expected_value", "oracle", "answer", "prediction"):
            self.assertNotIn(forbidden, serialized.lower())

    def test_markdown_report_states_model_unavailable_and_no_jev_results(self):
        markdown = render_preregistration_markdown(build_benchmark_preregistration())
        self.assertIn("awaiting_document_policy_review_before_training", markdown)
        self.assertIn("not fresh generalization evidence", markdown)
        self.assertIn("unmaterialized", markdown)
        self.assertIn("no live calls", markdown)
        self.assertIn("existing gate weights", markdown)

    def test_checked_in_markdown_has_the_same_review_gate(self):
        report = Path("docs/V03_DOCUMENT_EVIDENCE_BENCHMARK_PREREGISTRATION.md").read_text()
        self.assertIn("awaiting_document_policy_review_before_training", report)
        self.assertIn("9300–9302", report)

    def test_checked_in_json_is_generated_from_current_source_contract(self):
        artifact = Path("reports/generated/v03-document-evidence-benchmark-preregistration.json")
        self.assertTrue(artifact.exists())
        self.assertEqual(json.loads(artifact.read_text()), build_benchmark_preregistration())


if __name__ == "__main__":
    unittest.main()
