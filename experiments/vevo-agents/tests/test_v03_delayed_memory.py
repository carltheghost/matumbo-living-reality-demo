import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from vevo_agents.v03_delayed_memory import (
    CheckpointValidationError,
    DELAYED_TRAIN_WORLD_SEEDS,
    DeadlineExceeded,
    HELDOUT_WORLD_SEEDS,
    HISTORICAL_WORLD_SEEDS,
    _development_entry_shell,
    _finalize_development_entry,
    _finalize_untrained_reference_entry,
    _load_delayed_checkpoint,
    _run_case_batch,
    _save_delayed_checkpoint,
    _untrained_reference_entry_shell,
    _verify_prediction_parity,
    _prepare_delayed_episode,
    build_delayed_examples,
    make_heldout_specs,
    make_training_specs,
    run_experiment,
)
from vevo_agents.v03_model import (
    NOTE_FEATURE_END,
    NOTE_FEATURE_START,
    NOTE_PAYLOAD_MASK_INDEX,
    encode_policy_observation,
    fit_shared_max_abs_input_normalization,
    V03FiveBrain,
)


class V03DelayedMemoryScheduleTests(unittest.TestCase):
    def test_schedule_shows_note_once_and_hides_goal_payload(self):
        example = build_delayed_examples(make_training_specs()[:1])[0]
        self.assertEqual(len(example["policy_observations"]), 5)
        masks = [
            int(encode_policy_observation(observation)[NOTE_PAYLOAD_MASK_INDEX])
            for observation in example["policy_observations"]
        ]
        self.assertEqual(masks, [0, 1, 0, 0, 0])
        self.assertTrue(example["schedule_audit"]["note_shown_once"])
        self.assertTrue(example["schedule_audit"]["hidden_goal_bearing_fields_validated"])
        for observation in example["policy_observations"][2:]:
            self.assertNotIn("target_hz", json.dumps(observation, sort_keys=True))
            self.assertEqual(observation["note"]["text"], "")
            self.assertEqual(observation["note"]["content_digest"], "")

    def test_hidden_schedule_has_neutral_note_features_after_fit(self):
        examples = build_delayed_examples(make_training_specs())
        from vevo_agents.v03_model import fit_input_normalization, normalize_policy_vector

        normalization = fit_input_normalization([
            observation
            for example in examples
            for observation in example["policy_observations"]
        ])
        for example in examples:
            for observation in example["policy_observations"][2:]:
                normalized = normalize_policy_vector(
                    encode_policy_observation(observation), normalization
                )
                self.assertTrue(np.allclose(
                    normalized[NOTE_FEATURE_START:NOTE_FEATURE_END], 0.0
                ))

    def test_heldout_worlds_are_fixed_and_disjoint(self):
        self.assertEqual(DELAYED_TRAIN_WORLD_SEEDS, (9200, 9201))
        self.assertEqual(HELDOUT_WORLD_SEEDS, tuple(range(9300, 9308)))
        self.assertTrue(set(HELDOUT_WORLD_SEEDS).isdisjoint(HISTORICAL_WORLD_SEEDS))
        self.assertEqual(len(make_heldout_specs()), 32)

    def test_prepared_episode_has_five_declared_stages(self):
        episode, observations, audit = _prepare_delayed_episode(make_training_specs()[0])
        self.assertEqual(len(observations), 5)
        self.assertEqual(audit["policy_observation_count"], 5)
        self.assertEqual(audit["note_payload_masks"], [0, 1, 0, 0, 0])
        self.assertTrue(episode.measurement["accepted"])


class V03DelayedMemoryRunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.examples = build_delayed_examples(make_training_specs())
        cls.normalization = fit_shared_max_abs_input_normalization([
            observation
            for example in cls.examples
            for observation in example["policy_observations"]
        ])

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
            "optimizer_first": {
                name: np.zeros_like(value)
                for name, value in model.params.items()
            },
            "optimizer_second": {
                name: np.zeros_like(value)
                for name, value in model.params.items()
            },
        }

    def test_new_checkpoint_reload_requires_exact_normalization_and_parity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "candidate.json"
            model = V03FiveBrain(107)
            model.set_input_normalization(self.normalization)
            _save_delayed_checkpoint(
                path,
                model,
                self._training_state(model),
                self.normalization,
                source_sha=None,
            )
            restored, payload = _load_delayed_checkpoint(
                path,
                model_class=V03FiveBrain,
                expected_label="full",
                expected_seed=107,
                expected_normalization=self.normalization,
                expected_source_sha=None,
            )
            self.assertEqual(payload["normalization"], self.normalization)
            parity = _verify_prediction_parity(model, restored, self.examples)
            self.assertTrue(parity["exact"])
            self.assertEqual(parity["checked_cases"], 8)

            restored.params["c.b_action_gate"][0] += 0.25
            with self.assertRaises(CheckpointValidationError):
                _verify_prediction_parity(model, restored, self.examples)

            malformed = json.loads(path.read_text(encoding="utf-8"))
            malformed["normalization"]["response_scaling"]["scale"] *= 2.0
            path.write_text(json.dumps(malformed), encoding="utf-8")
            with self.assertRaises(CheckpointValidationError):
                _load_delayed_checkpoint(
                    path,
                    model_class=V03FiveBrain,
                    expected_label="full",
                    expected_seed=107,
                    expected_normalization=self.normalization,
                    expected_source_sha=None,
                )

    def test_case_batch_cap_reports_completed_prefix_without_running_next_case(self):
        calls = []
        deadline = 0.0
        batch = _run_case_batch(
            make_training_specs()[:2],
            lambda spec, index: calls.append(index) or {"success": False},
            deadline=deadline,
            phase="test_case_batch",
        )
        self.assertEqual(batch["status"], "partial_wall_clock_cap")
        self.assertTrue(batch["budget_exhausted"])
        self.assertEqual(batch["completed_cases"], 0)
        self.assertEqual(calls, [])
        self.assertEqual(batch["next_case_index"], 0)

    @staticmethod
    def _development_entry(status="complete"):
        specs = make_heldout_specs()[:1]
        example = build_delayed_examples(specs)[0]
        spec = specs[0]
        run = {
            "split": spec["split"],
            "world_seed": spec["world_seed"],
            "goal_index": spec["goal_index"],
            "note_goal_id": spec["note_goal_id"],
            "success": False,
            "world_residual": 0.0,
            "failure_cause": "physical_gate_not_opened",
            "final_action": {
                "gate": int(example["target_gate"]),
                "frequency_index": int(example["target_frequency"]),
            },
            "development_loss": 1.0,
        }
        batch = {
            "status": status,
            "runs": [run],
            "completed_cases": 1,
            "expected_cases": 2,
            "failures": [],
        }
        trial = {"label": "full", "model_seed": 107}
        return (
            _development_entry_shell(trial, batch),
            specs,
            [example],
            run,
        )

    def test_development_direct_batch_cap_finalizes_status_and_preserves_prefix(self):
        for batch_status in ("partial_wall_clock_cap", "complete_budget_exhausted"):
            with self.subTest(batch_status=batch_status):
                entry, specs, examples, run = self._development_entry(batch_status)
                result = _finalize_development_entry(
                    entry,
                    development_specs=specs,
                    development_examples=examples,
                    model=object(),
                    historical_successes={(run["world_seed"], run["goal_index"]): False},
                    deadline=None,
                    phase_prefix="development_full-seed-107",
                )
                self.assertEqual(result["status"], "partial_wall_clock_cap")
                self.assertIsInstance(result["exception"], DeadlineExceeded)
                self.assertEqual(entry["status"], "partial_wall_clock_cap")
                self.assertEqual(entry["completed_cases"], 1)
                self.assertEqual(entry["runs"], [run])
                self.assertFalse(entry["comparison_complete"])
                self.assertNotIn("metrics", entry)
                self.assertTrue(all(
                    status == "unavailable_budget_exhausted"
                    for status in entry["derived_metrics_status"].values()
                ))

    def test_development_metric_timeout_preserves_completed_prefix(self):
        entry, specs, examples, run = self._development_entry()
        with patch(
            "vevo_agents.v03_delayed_memory._development_metrics",
            side_effect=DeadlineExceeded("development_metrics"),
        ):
            result = _finalize_development_entry(
                entry,
                development_specs=specs,
                development_examples=examples,
                model=object(),
                historical_successes={(run["world_seed"], run["goal_index"]): False},
                deadline=None,
                phase_prefix="development_full-seed-107",
            )
        self.assertEqual(result["status"], "partial_wall_clock_cap")
        self.assertEqual(entry["completed_cases"], 1)
        self.assertEqual(entry["derived_metrics_status"]["development_metrics"], "unavailable_budget_exhausted")
        self.assertFalse(entry["comparison_complete"])

    def test_development_summary_timeout_preserves_completed_prefix(self):
        entry, specs, examples, run = self._development_entry()
        with patch(
            "vevo_agents.v03_delayed_memory._run_summary",
            side_effect=DeadlineExceeded("development_summary"),
        ):
            result = _finalize_development_entry(
                entry,
                development_specs=specs,
                development_examples=examples,
                model=object(),
                historical_successes={(run["world_seed"], run["goal_index"]): False},
                deadline=None,
                phase_prefix="development_full-seed-107",
            )
        self.assertEqual(result["status"], "partial_wall_clock_cap")
        self.assertEqual(entry["derived_metrics_status"]["development_metrics"], "complete")
        self.assertEqual(entry["derived_metrics_status"]["summary"], "unavailable_budget_exhausted")
        self.assertEqual(entry["derived_metrics_status"]["world_clustered"], "unavailable_budget_exhausted")
        self.assertFalse(entry["comparison_complete"])

    def test_development_historical_overlap_timeout_preserves_completed_prefix(self):
        entry, specs, examples, run = self._development_entry()
        with patch(
            "vevo_agents.v03_delayed_memory._historical_success_overlap",
            side_effect=DeadlineExceeded("development_historical_overlap"),
        ):
            result = _finalize_development_entry(
                entry,
                development_specs=specs,
                development_examples=examples,
                model=object(),
                historical_successes={(run["world_seed"], run["goal_index"]): False},
                deadline=None,
                phase_prefix="development_full-seed-107",
            )
        self.assertEqual(result["status"], "partial_wall_clock_cap")
        self.assertEqual(entry["derived_metrics_status"]["development_metrics"], "complete")
        self.assertEqual(entry["derived_metrics_status"]["summary"], "complete")
        self.assertEqual(entry["derived_metrics_status"]["world_clustered"], "complete")
        self.assertEqual(entry["derived_metrics_status"]["historical_success_overlap"], "unavailable_budget_exhausted")
        self.assertFalse(entry["comparison_complete"])

    def test_untrained_reference_cap_preserves_completed_prefix_before_metrics(self):
        _, _, _, run = self._development_entry()
        batch = {
            "status": "partial_wall_clock_cap",
            "runs": [run],
            "completed_cases": 1,
            "expected_cases": 2,
            "failures": [{"phase": "untrained_reference_full", "error_type": "DeadlineExceeded"}],
        }
        entry = _untrained_reference_entry_shell(107, batch)
        result = _finalize_untrained_reference_entry(
            entry,
            model=object(),
            train_examples=[],
            deadline=None,
            phase_prefix="untrained_reference_full",
        )
        self.assertEqual(result["status"], "partial_wall_clock_cap")
        self.assertEqual(entry["status"], "partial_wall_clock_cap")
        self.assertEqual(entry["completed_cases"], 1)
        self.assertEqual(entry["runs"], [run])
        self.assertFalse(entry["comparison_complete"])
        self.assertNotIn("metrics", entry)
        self.assertEqual(entry["unavailable_metrics"], ["metrics", "physical_success", "summary"])

    def test_zero_cap_writes_structured_json_and_markdown_without_evaluation(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "candidate-report.json"
            report = run_experiment(
                output_path=output,
                wall_clock_cap=0.0,
                response_scaling="shared_max_abs",
                checkpoint_prefix="test-cap-candidate",
            )
            summary = output.with_suffix(".md")
            self.assertEqual(report["status"], "partial_wall_clock_cap")
            self.assertTrue(report["runtime"]["cap_termination"])
            self.assertEqual(report["checkpoint_reload"]["status"], "partial_wall_clock_cap")
            self.assertIn("evaluation_gate", report["training"])
            self.assertEqual(report["development"]["status"], "not_evaluated_wall_clock_cap")
            self.assertFalse(report["development"]["is_fresh_generalization"])
            self.assertTrue(output.exists())
            self.assertTrue(summary.exists())
            summary_text = summary.read_text(encoding="utf-8")
            self.assertIn("all four models must complete", summary_text)
            self.assertIn("never fresh generalization", summary_text)
            self.assertIn("cooperative", summary_text)
            self.assertTrue(report["runtime"]["deadline_overrun_possible"])
            self.assertTrue(report["runtime"]["elapsed_measurement_excludes_final_serialization"])
            self.assertTrue(report["runtime"]["single_process_not_single_thread_guarantee"])
            self.assertTrue(report["historical_artifacts"]["unchanged"])

    def test_historical_v1_checkpoint_prediction_compatibility(self):
        project_root = Path(__file__).resolve().parents[1]
        payload = json.loads(
            (project_root / "storage/checkpoints/v03-neural-delayed-memory-full-seed-107.json").read_text(
                encoding="utf-8"
            )
        )
        model = V03FiveBrain(int(payload["seed"]))
        model.load_state_dict(payload["state"])
        model.set_input_normalization(payload["normalization"])
        historical = json.loads(
            (project_root / "reports/generated/v03-neural-delayed-memory-report.json").read_text(
                encoding="utf-8"
            )
        )
        historical_runs = historical["retention"]["models"]["full-seed-107"]["ordinary"]["runs"]
        self.assertEqual(len(historical_runs), len(self.examples))
        for example, historical_run in zip(self.examples, historical_runs):
            prediction = model.predict(example["policy_observations"])
            self.assertEqual(prediction["gate"], historical_run["final_action"]["gate"])
            self.assertEqual(prediction["frequency_index"], historical_run["final_action"]["frequency_index"])
            np.testing.assert_array_equal(
                prediction["trace"]["gate_probs"],
                np.asarray(historical_run["gate_probabilities"], dtype=np.float64),
            )
            np.testing.assert_array_equal(
                prediction["trace"]["frequency_probs"],
                np.asarray(historical_run["frequency_probabilities"], dtype=np.float64),
            )


if __name__ == "__main__":
    unittest.main()
