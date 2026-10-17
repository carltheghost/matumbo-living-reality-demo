import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import numpy as np

import vevo_agents.v03_fresh_mapping_inference as inference


class _SyntheticModel:
    """Small trace-only model for symmetry tests; it never loads a checkpoint."""

    def __init__(self, *, tie=False):
        self.tie = bool(tie)

    def initial_runtime(self):
        return 0

    def raw_step(self, runtime, observation):
        response = np.asarray(observation["measurement"]["channel_response"], dtype=np.float64)
        if self.tie:
            gate_probs = np.full(4, 0.25, dtype=np.float64)
        else:
            scores = response[:, 0]
            scores = scores - np.max(scores)
            gate_probs = np.exp(scores)
            gate_probs /= np.sum(gate_probs)
        return runtime + 1, {
            "gate_probs": gate_probs.tolist(),
            "frequency_probs": [0.1, 0.2, 0.3, 0.4],
            "retained_goal_context": [0.125, -0.25],
        }


def _synthetic_case():
    return {
        "case_index": 0,
        "world_seed": 20049,
        "goal_index": 1,
        "partition": "training_disjoint_never_inspected_mapping_new_world",
        "frequency_to_gate": [3, 2, 0, 1],
        "metadata_reference_gate": 2,
    }


def _synthetic_prepared():
    return {
        "policy_observations": [
            {"measurement": {"channel_response": np.eye(4).tolist()}},
            {"measurement": {"channel_response": np.asarray([
                [1.0, 0.0, 0.0, 0.0],
                [2.0, 0.0, 0.0, 0.0],
                [3.0, 0.0, 0.0, 0.0],
                [4.0, 0.0, 0.0, 0.0],
            ]).tolist()}},
        ],
    }


class _SyntheticSnapshot:
    def snapshot(self):
        return {"synthetic": True}


def _synthetic_runner_case():
    case = _synthetic_case()
    case.update({
        "note_goal_id": "delayed-train-goal-1",
        "note_text": "synthetic-note",
        "gate_resonance_hz": [0.55, 0.75, 0.95, 1.15],
    })
    return case


def _synthetic_runner_design(case):
    return {
        "source_sha_at_registration": "synthetic-source",
        "normalization": {"candidate_shared_row": {"fixture": {}}},
        "case_plan": {"cases": [case]},
    }


def _synthetic_runner_payload():
    return {
        "schema": "synthetic-checkpoint",
        "source_sha": "synthetic-source",
        "training": {"updates": 1000},
    }


def _synthetic_runner_run():
    return {
        "gate_probabilities": [0.1, 0.2, 0.6, 0.1],
        "frequency_probabilities": [0.1, 0.6, 0.2, 0.1],
        "final_action": {"gate": 2, "frequency_index": 1},
        "success": True,
    }


class V03FreshMappingInferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1]
        cls.design = json.loads(
            (cls.root / inference.DESIGN_PATH).read_text(encoding="utf-8")
        )

    def test_score_and_row_relabel_contract_use_synthetic_trace_only(self):
        case = _synthetic_case()
        run = {
            "gate_probabilities": [0.1, 0.2, 0.6, 0.1],
            "frequency_probabilities": [0.1, 0.6, 0.2, 0.1],
            "final_action": {"gate": 2, "frequency_index": 1},
            "success": True,
        }
        scored = inference.score_case_result(case, run)
        self.assertTrue(scored["joint_correct"])
        self.assertTrue(scored["physical_success"])
        self.assertGreater(scored["joint_mean_loss"], 0.0)

        result = inference.row_relabel_result(
            _SyntheticModel(),
            case,
            _synthetic_prepared(),
            (2, 0, 3, 1),
        )
        self.assertTrue(result["gate_probability_passed"])
        self.assertTrue(result["frequency_probability_passed"])
        self.assertTrue(result["retained_context_unchanged"])
        self.assertEqual(result["selected_gate_remap_status"], "passed")

        tied = inference.row_relabel_result(
            _SyntheticModel(tie=True),
            case,
            _synthetic_prepared(),
            (2, 0, 3, 1),
        )
        self.assertEqual(tied["selected_gate_remap_status"], "not_applicable_tie")
        self.assertIsNone(tied["selected_gate_remap_passed"])

    def test_serialization_and_manifest_mismatch_are_rejected(self):
        tampered_case = copy.deepcopy(self.design)
        tampered_case["case_plan"]["cases"][0]["goal_index"] = 3
        with self.assertRaises(inference.FrozenInferenceError):
            inference._validate_case_manifest(tampered_case)

        tampered_artifacts = copy.deepcopy(self.design)
        tampered_artifacts["normalization"]["legacy_baseline"]["fixture"] = {"tampered": True}
        with self.assertRaises(inference.FrozenInferenceError):
            inference._validate_frozen_artifacts(tampered_artifacts, self.root)

    def test_budget_cap_writes_complete_partial_outputs_without_later_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "cap.json"
            report = inference.run_frozen_inference(
                output_path=output,
                wall_clock_cap=-1.0,
            )
            self.assertEqual(report["status"], "partial_wall_clock_cap")
            self.assertEqual(report["completed_case_count"], 0)
            self.assertEqual(report["cases"], [])
            self.assertEqual(
                report["derived_metrics_status"]["per_checkpoint"],
                "unavailable_budget_exhausted",
            )
            self.assertTrue(output.exists())
            summary = output.with_suffix(".md")
            self.assertTrue(summary.exists())
            summary_text = summary.read_text(encoding="utf-8")
            self.assertIn("partial_wall_clock_cap", summary_text)
            self.assertIn("no later metrics were computed", summary_text)
            self.assertIn("globally never-inspected mapping in U; U evidence", summary_text)
            self.assertIn("counterfactual row-relabel exposure; not U evidence", summary_text)

    def test_midcase_failure_retains_completed_checkpoint_prefix_and_identity(self):
        case = _synthetic_runner_case()
        calls = 0

        def synthetic_run(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise ValueError("synthetic mid-case checkpoint failure")
            return _synthetic_runner_run()

        design = _synthetic_runner_design(case)
        manifest = {"cases": [case], "world_order": [case["world_seed"]]}
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(inference, "_load_design", return_value=(design, "synthetic-design")), \
                mock.patch.object(inference, "_validate_case_manifest", return_value=manifest), \
                mock.patch.object(inference, "_validate_frozen_artifacts", return_value={
                    "checkpoint_manifest_sha256": "synthetic-checkpoints",
                    "normalization_digest": "synthetic-normalization",
                    "screening_artifacts_verified": True,
                }), \
                mock.patch.object(inference, "_load_delayed_checkpoint", return_value=(object(), _synthetic_runner_payload())), \
                mock.patch.object(inference, "_prepare_delayed_episode", return_value=(_SyntheticSnapshot(), [], {})), \
                mock.patch.object(inference, "run_delayed_episode", side_effect=synthetic_run):
            report = inference.run_frozen_inference(output_path=Path(directory) / "midcase.json")

        self.assertEqual(report["status"], "partial_failure")
        self.assertEqual(report["completed_case_count"], 0)
        self.assertEqual(report["partial_case_count"], 1)
        self.assertEqual(len(report["cases"]), 1)
        self.assertEqual(report["cases"][0]["completed_checkpoint_count"], 1)
        self.assertEqual(set(report["cases"][0]["results"]), {"full-seed-107"})
        failure = report["failures"][0]
        self.assertEqual(failure["case_index"], 0)
        self.assertEqual(failure["checkpoint"], "legacy-full-seed-107")
        self.assertNotIn("permutation", failure)

    def test_midpermutation_failure_retains_raw_row_prefix_and_identity(self):
        case = _synthetic_runner_case()
        row_calls = 0

        def synthetic_row(*args, **kwargs):
            nonlocal row_calls
            row_calls += 1
            if row_calls == 2:
                raise ValueError("synthetic mid-permutation failure")
            return {"case_index": 0, "permutation": [0, 1, 2, 3], "synthetic": True}

        design = _synthetic_runner_design(case)
        manifest = {"cases": [case], "world_order": [case["world_seed"]]}
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(inference, "_load_design", return_value=(design, "synthetic-design")), \
                mock.patch.object(inference, "_validate_case_manifest", return_value=manifest), \
                mock.patch.object(inference, "_validate_frozen_artifacts", return_value={
                    "checkpoint_manifest_sha256": "synthetic-checkpoints",
                    "normalization_digest": "synthetic-normalization",
                    "screening_artifacts_verified": True,
                }), \
                mock.patch.object(inference, "_load_delayed_checkpoint", return_value=(object(), _synthetic_runner_payload())), \
                mock.patch.object(inference, "_prepare_delayed_episode", return_value=(_SyntheticSnapshot(), [], {})), \
                mock.patch.object(inference, "run_delayed_episode", return_value=_synthetic_runner_run()), \
                mock.patch.object(inference, "row_relabel_result", side_effect=synthetic_row):
            report = inference.run_frozen_inference(output_path=Path(directory) / "midpermutation.json")

        self.assertEqual(report["status"], "partial_failure")
        self.assertEqual(report["completed_case_count"], 1)
        self.assertEqual(report["completed_row_relabel_count"], 1)
        self.assertEqual(len(report["row_relabel"]), 1)
        failure = report["failures"][0]
        self.assertEqual(failure["phase"], "row_relabel")
        self.assertEqual(failure["case_index"], 0)
        self.assertEqual(failure["checkpoint"], "full-seed-107")
        self.assertEqual(failure["permutation"], [0, 1, 3, 2])

    def test_derived_metric_stage_timeout_stops_between_stages(self):
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
        case_results = {
            key: [dict(record)]
            for key in inference.PAIR_EVALUATION_ORDER
        }
        stages = []

        def stop_after_mapping(stage):
            stages.append(stage)
            if stage == "after_per_mapping":
                raise inference.InferenceDeadlineExceeded(
                    "derived_metrics_after_per_mapping",
                    completed_cases=1,
                )

        with self.assertRaises(inference.InferenceDeadlineExceeded):
            inference._aggregate_results(case_results, stage_check=stop_after_mapping)
        self.assertEqual(
            stages,
            ["after_per_checkpoint", "after_per_world", "after_per_mapping"],
        )

    def test_preflight_failure_writes_structured_failure_and_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "failure.json"
            with mock.patch.object(inference, "DESIGN_PATH", "missing-sealed-design.json"):
                report = inference.run_frozen_inference(output_path=output)
            self.assertEqual(report["status"], "partial_failure")
            self.assertEqual(report["completed_case_count"], 0)
            self.assertEqual(report["completed_row_relabel_count"], 0)
            self.assertEqual(report["derived_metrics"], None)
            self.assertEqual(report["failures"][0]["phase"], "preflight_or_inference")
            self.assertTrue(output.exists())
            self.assertTrue(output.with_suffix(".md").exists())

    def test_partial_prefix_serializer_does_not_invent_incomplete_pairs(self):
        cases = [{"case_index": 0, "world_seed": 20049, "goal_index": 0, "partition": "p"}]
        complete = {
            key: [{"case_index": 0, "value": key}]
            for key in inference.PAIR_EVALUATION_ORDER
        }
        self.assertEqual(
            len(inference._case_prefix_records(cases, complete, 1)),
            1,
        )
        incomplete = copy.deepcopy(complete)
        incomplete[inference.PAIR_EVALUATION_ORDER[-1]] = []
        self.assertEqual(
            inference._case_prefix_records(cases, incomplete, 1),
            [],
        )

    def test_partition_aggregation_keeps_zero_count_partitions_explicit(self):
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
        case_results = {
            key: [dict(record)]
            for key in inference.PAIR_EVALUATION_ORDER
        }
        aggregate = inference._aggregate_results(case_results)
        partitions = aggregate["per_partition"][inference.PAIR_EVALUATION_ORDER[0]]
        self.assertEqual(partitions[record["partition"]]["n"], 1)
        self.assertEqual(partitions["seen_training_mapping_new_world"]["n"], 0)
        self.assertEqual(partitions["training_disjoint_previously_inspected_mapping_new_world"]["n"], 0)
        self.assertEqual(partitions["training_disjoint_counterfactual_exposed_mapping_new_world"]["n"], 0)


if __name__ == "__main__":
    unittest.main()
