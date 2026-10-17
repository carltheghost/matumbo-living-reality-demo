import hashlib
import json
from pathlib import Path
import unittest

from vevo_agents.v03_fresh_mapping_preregistration import (
    FRESH_EVALUATION_REPORT_PATH,
    FRESH_MAPPING_LIMIT,
    FRESH_WORLDS_PER_MAPPING,
    FROZEN_INFERENCE_CHECKPOINTS,
    KNOWN_PRIOR_WORLD_SEEDS,
    NORMALIZATION_DIGEST,
    PARTITION_DISJOINT_COUNTERFACTUAL,
    PARTITION_DISJOINT_NEVER,
    SCREENING_ARTIFACT_COMMIT,
    SCREENING_SOURCE_SHA,
    build_preregistration,
    frequency_to_gate_mapping,
)


class V03FreshMappingPreregistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = build_preregistration()
        cls.root = Path(__file__).resolve().parents[1]

    def test_source_only_and_no_fresh_outcomes(self):
        self.assertEqual(
            self.plan["status"],
            "awaiting_independent_review_before_fresh_evaluation",
        )
        self.assertTrue(self.plan["scope_boundary"]["source_only"])
        self.assertTrue(self.plan["scope_boundary"]["no_new_training"])
        self.assertTrue(self.plan["scope_boundary"]["no_fresh_case_evaluation"])
        self.assertTrue(self.plan["scope_boundary"]["no_candidate_outcomes_inspected_on_fresh_worlds"])
        self.assertFalse(self.plan["training_started"])
        self.assertFalse(self.plan["evaluation_started"])
        self.assertEqual(self.plan["fresh_cases_evaluated"], 0)
        self.assertFalse(self.plan["fresh_model_outcomes_loaded"])
        self.assertFalse((self.root / FRESH_EVALUATION_REPORT_PATH).exists())

    def test_checkpoint_manifest_freezes_candidate_and_legacy_pairs(self):
        self.assertEqual(len(FROZEN_INFERENCE_CHECKPOINTS), 8)
        self.assertEqual(
            set(self.plan["paired_inference"]["candidate_checkpoint_family"]),
            {"full-seed-107", "full-seed-117", "control-seed-141", "control-seed-143"},
        )
        self.assertEqual(
            set(self.plan["paired_inference"]["legacy_baseline_checkpoint_family"]),
            {"legacy-full-seed-107", "legacy-full-seed-117", "legacy-control-seed-141", "legacy-control-seed-143"},
        )
        for key, frozen in FROZEN_INFERENCE_CHECKPOINTS.items():
            path = self.root / frozen["path"]
            self.assertEqual(
                hashlib.sha256(path.read_bytes()).hexdigest(),
                frozen["digest"],
                key,
            )
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload.get("source_sha"), frozen["expected_source_sha"])
            self.assertEqual(payload.get("gate_head", "legacy_action_matrix"), frozen["expected_gate_head"])
            self.assertEqual(payload["training"]["updates"], 1000)
            self.assertEqual(self.plan["frozen_checkpoints"][key]["current_digest"], frozen["digest"])
        self.assertEqual(self.plan["frozen_screening_identity"]["artifact_commit"], SCREENING_ARTIFACT_COMMIT)
        self.assertEqual(self.plan["frozen_screening_identity"]["source_sha"], SCREENING_SOURCE_SHA)
        self.assertFalse(self.plan["frozen_screening_identity"]["output_filename_deviation"]["hidden_source_change"])

    def test_normalization_is_frozen_and_not_fit_during_inference(self):
        normalization = self.plan["normalization"]
        self.assertEqual(normalization["candidate_shared_row"]["digest"], NORMALIZATION_DIGEST)
        self.assertEqual(normalization["legacy_baseline"]["digest"], NORMALIZATION_DIGEST)
        self.assertTrue(normalization["candidate_and_baseline_digests_equal"])
        self.assertTrue(normalization["fit_at_preregistration_only"])
        self.assertFalse(normalization["fit_during_fresh_evaluation"])
        self.assertTrue(self.plan["paired_inference"]["candidate_and_baseline_use_frozen_checkpoint_payload_normalization"])
        self.assertFalse(self.plan["paired_inference"]["candidate_and_baseline_normalization_fitting_during_evaluation"])

    def test_complete_inventory_distinguishes_training_and_global_freshness(self):
        inventory = self.plan["mapping_inventory"]
        self.assertEqual(inventory["all_feasible_mapping_count"], 24)
        self.assertEqual(inventory["prior_inspected_mapping_count"], 22)
        self.assertEqual(inventory["training_disjoint_mapping_count"], 22)
        self.assertEqual(inventory["explicit_override_record_count"], 15)
        self.assertEqual(inventory["non_bijective_override_count"], 1)
        self.assertEqual(inventory["counterfactual_exposed_mapping_count"], 1)
        self.assertEqual(inventory["globally_unseen_mapping_count"], 1)
        self.assertFalse(inventory["physical_exposure_census_claim"])
        self.assertIn("conservative", inventory["mapping_provenance_status"])
        self.assertIn("not_an_exact_physical_exposure_census", inventory["mapping_provenance_status"])
        training = {tuple(item) for item in inventory["candidate_training_mapping_tuples"]}
        globally_unseen = {tuple(item) for item in inventory["globally_unseen_mapping_tuples"]}
        counterfactual = {tuple(item) for item in inventory["counterfactual_exposed_mapping_tuples"]}
        self.assertEqual(training, {(3, 0, 1, 2), (0, 2, 1, 3)})
        self.assertEqual(globally_unseen, {(3, 2, 0, 1)})
        self.assertEqual(counterfactual, {(1, 2, 3, 0)})
        self.assertTrue(training.isdisjoint(globally_unseen))
        self.assertEqual(
            len(set(tuple(item) for item in inventory["prior_inspected_mapping_tuples"]) | globally_unseen | counterfactual),
            24,
        )

    def test_selection_is_metadata_only_bounded_and_frozen(self):
        selection = self.plan["fresh_world_selection"]
        worlds = selection["worlds"]
        self.assertEqual(selection["selected_mapping_count"], 1)
        self.assertEqual(selection["lexicographic_mapping_limit_K"], FRESH_MAPPING_LIMIT)
        self.assertEqual(selection["worlds_per_mapping"], FRESH_WORLDS_PER_MAPPING)
        self.assertEqual([item["world_seed"] for item in worlds], [20021, 20023, 20049, 20050])
        self.assertTrue(selection["selection_uses_model_outcomes"] is False)
        self.assertTrue(all(item["world_seed"] not in KNOWN_PRIOR_WORLD_SEEDS for item in worlds))
        self.assertEqual(
            [item["partition"] for item in worlds],
            [PARTITION_DISJOINT_COUNTERFACTUAL, PARTITION_DISJOINT_COUNTERFACTUAL,
             PARTITION_DISJOINT_NEVER, PARTITION_DISJOINT_NEVER],
        )
        self.assertEqual(selection["partition_counts"][PARTITION_DISJOINT_NEVER], 2)
        self.assertEqual(selection["partition_counts"][PARTITION_DISJOINT_COUNTERFACTUAL], 2)
        self.assertEqual(selection["preserved_supplemental_mapping_tuples"], [[1, 2, 3, 0]])
        self.assertEqual(selection["preserved_supplemental_worlds"], [20021, 20023])
        self.assertEqual(
            {tuple(item["frequency_to_gate"]) for item in worlds},
            {(1, 2, 3, 0), (3, 2, 0, 1)},
        )
        for item in worlds:
            self.assertEqual(
                frequency_to_gate_mapping(item["world_seed"]),
                tuple(item["frequency_to_gate"]),
            )
        self.assertTrue(worlds[0]["mapping_was_counterfactual_exposed"])
        self.assertFalse(worlds[2]["mapping_was_counterfactual_exposed"])

    def test_case_manifest_preserves_original_protocol_and_pair_counts(self):
        case_plan = self.plan["case_plan"]
        self.assertEqual(case_plan["world_count"], 4)
        self.assertEqual(case_plan["goals_per_world"], 4)
        self.assertEqual(case_plan["case_count"], 16)
        self.assertEqual(len(case_plan["cases"]), 16)
        self.assertEqual(self.plan["protocol"]["note_payload_masks"], [0, 1, 0, 0, 0])
        self.assertTrue(self.plan["protocol"]["physics_goal_measurement_protocol_unchanged"])
        self.assertTrue(self.plan["protocol"]["no_wording_or_delay_factor_in_this_evaluation"])
        for case in case_plan["cases"]:
            self.assertEqual(case["note_goal_id"], f"delayed-train-goal-{case['goal_index']}")
            self.assertIn("target_hz=", case["note_text"])
            self.assertIn("variant=delayed-train", case["note_text"])
            self.assertEqual(
                case["metadata_reference_gate"],
                case["frequency_to_gate"][case["goal_index"]],
            )
        self.assertEqual(self.plan["resource_budget"]["frozen_checkpoint_count"], 8)
        self.assertEqual(self.plan["resource_budget"]["primary_model_evaluations"], 128)
        self.assertEqual(self.plan["resource_budget"]["maximum_cases_per_checkpoint"], 64)
        self.assertEqual(self.plan["resource_budget"]["maximum_primary_evaluations_if_U_is_large"], 512)

    def test_row_relabel_contract_and_failure_cap_reporting_are_frozen(self):
        row = self.plan["row_relabel_consistency"]
        self.assertEqual(row["permutation_count"], 24)
        self.assertEqual(len(row["permutations"]), 24)
        self.assertIn("baseline_gate_probs[p]", row["expected_gate_probability"])
        self.assertIn("p.index", row["expected_selected_gate"])
        self.assertEqual(row["near_tie_selected_gate_status"], "not_applicable_tie; do not count as a selected-index pass")
        self.assertEqual(row["row_relabel_checkpoint_family"], "candidate shared-row checkpoints only; legacy per-gate baseline is retained for paired primary metrics, not expected to satisfy shared-row equivariance")
        failure = self.plan["failure_and_cap_reporting"]
        self.assertIn("partial_wall_clock_cap", failure["allowed_statuses"])
        self.assertIn("partial_failure", failure["allowed_statuses"])
        self.assertTrue(failure["record_completed_case_prefix"])
        self.assertTrue(failure["do_not_compute_later_metrics_after_cap_or_failure"])
        self.assertTrue(self.plan["resource_budget"]["no_metrics_after_budget_exhaustion"])


if __name__ == "__main__":
    unittest.main()
