import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from vevo_agents import v03_fresh_mapping_sensitivity_inference as inference
from vevo_agents.v03_fresh_mapping_sensitivity_preregistration import build_preregistration


class V03FreshMappingSensitivityInferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = build_preregistration()

    def test_declared_delay_variants_preserve_note_mask_contract(self):
        case = self.plan["case_manifest"][0]
        for arm in self.plan["arms"]:
            with self.subTest(arm=arm["id"]):
                spec = inference._arm_spec(case, arm)
                episode, observations, audit = inference._prepare_sensitivity_episode(
                    spec,
                    hidden_delay_steps=arm["hidden_delay_steps"],
                )
                delay = int(arm["hidden_delay_steps"])
                self.assertTrue(episode.measurement["accepted"])
                self.assertEqual(len(observations), delay + 3)
                self.assertEqual(audit["note_payload_masks"], [0, 1, *([0] * delay), 0])
                self.assertTrue(audit["note_shown_once"])
                self.assertTrue(audit["hidden_goal_bearing_fields_validated"])
                self.assertEqual(audit["hidden_delay_steps"], delay)

        original = inference._arm_spec(case, self.plan["arms"][0])
        variant = inference._arm_spec(case, self.plan["arms"][3])
        self.assertNotEqual(original["note_text"], variant["note_text"])
        self.assertIn("target_hz=", variant["note_text"])
        self.assertIn("rule=max-response-at-target", variant["note_text"])

    def test_action_signature_is_prediction_compatibility_sensitive(self):
        run = {
            "final_action": {"gate": 2, "frequency_index": 1, "frequency": 0.75},
            "gate_probabilities": [0.1, 0.2, 0.6, 0.1],
            "frequency_probabilities": [0.1, 0.6, 0.2, 0.1],
        }
        self.assertEqual(inference._action_signature(run), inference._action_signature(copy.deepcopy(run)))
        changed = copy.deepcopy(run)
        changed["frequency_probabilities"][1] += 1e-15
        self.assertNotEqual(inference._action_signature(run), inference._action_signature(changed))

    def test_partial_case_prefix_retains_only_completed_checkpoint_results(self):
        report = inference._empty_report(Path("synthetic.json"), "synthetic-source")
        case = self.plan["case_manifest"][0]
        arm = self.plan["arms"][0]
        arm_case = inference._arm_case_report(report, case, arm)
        result = {"case_index": int(case["case_index"]), "joint_correct": True}
        inference._attach_arm_checkpoint_result(report, arm_case, "full-seed-107", result)
        self.assertEqual(report["completed_primary_evaluations"], 1)
        self.assertEqual(arm_case["completed_checkpoint_count"], 1)
        self.assertFalse(arm_case["checkpoint_results_complete"])
        self.assertEqual(set(arm_case["results"]), {"full-seed-107"})
        self.assertEqual(len(report["cases"]), 1)

    def test_metric_stage_cap_stops_before_later_aggregation(self):
        record = {
            "case_index": 0,
            "world_seed": 20049,
            "frequency_to_gate": [3, 2, 0, 1],
            "partition": "training_disjoint_never_inspected_mapping_new_world",
            "gate_correct": True,
            "frequency_correct": True,
            "joint_correct": True,
            "physical_success": True,
            "gate_loss": 0.1,
            "frequency_loss": 0.2,
            "joint_mean_loss": 0.15,
        }
        records = {key: [dict(record)] for key in inference.CANDIDATE_EVALUATION_ORDER}
        stages = []

        def stop_after_world(stage):
            stages.append(stage)
            if stage == "after_per_world":
                raise inference.InferenceDeadlineExceeded("synthetic_metric_cap", completed_cases=1)

        with self.assertRaises(inference.InferenceDeadlineExceeded):
            inference._metric_groups(records, stage_check=stop_after_world)
        self.assertEqual(stages, ["after_per_checkpoint", "after_per_world"])

    def test_cap_writes_structured_json_and_markdown_without_model_outcomes(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "sensitivity-cap.json"
            report = inference.run_sensitivity_inference(
                output_path=output,
                wall_clock_cap=-1.0,
            )
            self.assertEqual(report["status"], "partial_wall_clock_cap")
            self.assertEqual(report["completed_primary_evaluations"], 0)
            self.assertEqual(report["cases"], [])
            self.assertEqual(report["derived_metrics"], None)
            self.assertEqual(report["derived_metrics_status"], "unavailable_budget_exhausted")
            self.assertEqual(report["checkpoint_reload"]["status"], "partial_wall_clock_cap")
            self.assertEqual(report["baseline_action_replay"]["status"], "partial")
            self.assertFalse(report["sensitivity_model_outcomes_loaded"])
            self.assertEqual(report["failures"][0]["phase"], "checkpoint_reload")
            self.assertTrue(output.exists())
            self.assertTrue(output.with_suffix(".md").exists())
            summary = output.with_suffix(".md").read_text(encoding="utf-8")
            self.assertIn("partial_wall_clock_cap", summary)
            self.assertIn("not fresh mapping evidence", summary)
            self.assertIn("Derived metrics", summary)

    def test_serialized_preregistration_mismatch_writes_complete_failure_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "sensitivity-failure.json"
            with patch.object(inference, "EXPECTED_DESIGN_FILE_SHA256", "tampered"):
                report = inference.run_sensitivity_inference(output_path=output)
            self.assertEqual(report["status"], "partial_failure")
            self.assertEqual(report["completed_primary_evaluations"], 0)
            self.assertIsNone(report["derived_metrics"])
            self.assertEqual(report["failures"][0]["phase"], "preflight_or_inference")
            self.assertTrue(output.exists())
            self.assertTrue(output.with_suffix(".md").exists())


if __name__ == "__main__":
    unittest.main()
