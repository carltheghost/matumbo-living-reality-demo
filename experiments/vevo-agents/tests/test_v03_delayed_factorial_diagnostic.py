import json
from pathlib import Path
import unittest

import numpy as np

from vevo_agents.v03_delayed_factorial_diagnostic import (
    CELL_DEFINITIONS,
    NOTE_SUFFIX_RELATIVE_COLUMNS,
    _cell_specs,
    _diagnostic_stats,
    _factor_pair_summary,
    _normalization_audit,
    make_factorial_cells,
)
from vevo_agents.v03_delayed_memory import _prepare_delayed_episode
from vevo_agents.v03_model import V03FiveBrain


class V03DelayedFactorialDiagnosticTests(unittest.TestCase):
    def test_factorial_has_four_cells_and_320_model_evaluations(self):
        cells = make_factorial_cells()
        self.assertEqual(set(cells), {item["name"] for item in CELL_DEFINITIONS})
        self.assertEqual(sum(len(specs) for specs in cells.values()), 80)
        self.assertEqual(sum(len(specs) for specs in cells.values()) * 4, 320)
        self.assertEqual(len(cells["training_worlds_original_format"]), 8)
        self.assertEqual(len(cells["new_worlds_heldout_format"]), 32)

    def test_format_factor_changes_only_note_suffix(self):
        original = _cell_specs(CELL_DEFINITIONS[0])[0]
        heldout = _cell_specs(CELL_DEFINITIONS[1])[0]
        self.assertEqual(original["world_seed"], heldout["world_seed"])
        self.assertEqual(original["goal_index"], heldout["goal_index"])
        self.assertEqual(original["gate_resonance_hz"], heldout["gate_resonance_hz"])
        self.assertEqual(original["note_goal_id"], heldout["note_goal_id"])
        self.assertNotEqual(original["note_text"], heldout["note_text"])
        self.assertEqual(original["note_variant"], "delayed-train")
        self.assertEqual(heldout["note_variant"], "delayed-heldout")

    def test_saved_normalization_exposes_declared_hazards(self):
        path = Path("storage/checkpoints/v03-neural-delayed-memory-full-seed-107.json")
        payload = json.loads(path.read_text(encoding="utf-8"))
        model = V03FiveBrain(int(payload["seed"]))
        model.set_input_normalization(payload["normalization"])
        audit = _normalization_audit({"full": {"normalization": payload["normalization"]}})
        self.assertEqual(len(audit["note_suffix_columns"]), len(NOTE_SUFFIX_RELATIVE_COLUMNS))
        self.assertEqual(audit["gate1_response_scales"], [0.001] * 4)
        self.assertEqual(audit["normalization_counts"], {"note_bytes": 8, "spectrum": 8})

    def test_optional_forward_diagnostics_are_finite_and_non_mutating(self):
        spec = _cell_specs(CELL_DEFINITIONS[0])[0]
        _, observations, _ = _prepare_delayed_episode(spec)
        model = V03FiveBrain(107)
        runtime = model.initial_runtime()
        before = model.state_dict()
        runtime, trace = model.raw_step(runtime, observations[0], collect_diagnostics=True)
        self.assertIn("diagnostics", trace)
        self.assertTrue(np.isfinite(trace["diagnostics"]["center_candidate_pre"]).all())
        self.assertTrue(np.isfinite(trace["diagnostics"]["center_update_pre"]).all())
        self.assertEqual(model.state_dict(), before)

    def test_format_pair_summary_validates_identity_and_reports_transitions(self):
        base = {
            "world_seed": 9200,
            "goal_index": 0,
            "note_goal_id": "same",
            "note_variant": "delayed-train",
            "success": True,
            "final_action": {"gate": 1, "frequency_index": 0},
            "physical_reference_gate": 1,
            "target_frequency_index": 0,
            "gate_probabilities": [0.1, 0.9, 0.0, 0.0],
            "frequency_probabilities": [0.9, 0.1, 0.0, 0.0],
        }
        changed = dict(base)
        changed.update({
            "note_variant": "delayed-heldout",
            "success": False,
            "final_action": {"gate": 0, "frequency_index": 1},
            "gate_probabilities": [0.9, 0.1, 0.0, 0.0],
            "frequency_probabilities": [0.1, 0.9, 0.0, 0.0],
        })
        result = _factor_pair_summary([base], [changed], left_variant="delayed-train", right_variant="delayed-heldout")
        self.assertEqual(result["transitions"]["physical_success_to_failure"], 1)
        self.assertEqual(result["net_physical_success_change"], -1)
        self.assertEqual(result["probability_changes"], 1)
        self.assertTrue(result["identity_validation"])


if __name__ == "__main__":
    unittest.main()
