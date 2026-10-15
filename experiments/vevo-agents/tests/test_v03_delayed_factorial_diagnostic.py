import json
from pathlib import Path
import unittest

import numpy as np

from vevo_agents.v03_delayed_factorial_diagnostic import (
    CHANNEL_RESPONSE_FEATURE_INDICES,
    CELL_DEFINITIONS,
    CLIP_BOUND,
    NOTE_SUFFIX_RELATIVE_COLUMNS,
    _authoritative_resonance_gate,
    _cell_specs,
    _clip_response_coordinates,
    _diagnostic_stats,
    _factor_pair_summary,
    _normalization_audit,
    _prepare_cache,
    make_factorial_cells,
)
from vevo_agents.v03_delayed_memory import _prepare_delayed_episode
from vevo_agents.v03_model import POLICY_VECTOR_DIM, V03FiveBrain
from vevo_agents.v03_protocol import CorrectedEpisode


class V03DelayedFactorialDiagnosticTests(unittest.TestCase):
    def test_comparison_has_two_world_cells_and_320_total_evaluations(self):
        cells = make_factorial_cells()
        self.assertEqual(set(cells), {item["name"] for item in CELL_DEFINITIONS})
        self.assertEqual(len(CELL_DEFINITIONS), 2)
        self.assertEqual(sum(len(specs) for specs in cells.values()), 40)
        self.assertEqual(sum(len(specs) for specs in cells.values()) * 4 * 2, 320)
        self.assertEqual(len(cells["training_worlds_original_format"]), 8)
        self.assertEqual(len(cells["new_worlds_original_format"]), 32)

    def test_single_declared_intervention_targets_only_16_response_coordinates(self):
        vector = np.linspace(-8.0, 8.0, POLICY_VECTOR_DIM, dtype=np.float64)
        clipped = _clip_response_coordinates(vector)
        changed = set(np.flatnonzero(clipped != vector).tolist())
        self.assertEqual(changed, set(CHANNEL_RESPONSE_FEATURE_INDICES))
        self.assertTrue(np.all(np.abs(clipped[list(CHANNEL_RESPONSE_FEATURE_INDICES)]) <= CLIP_BOUND))

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

    def test_authoritative_reference_is_independent_of_spectrum_argmax_and_oracle(self):
        self.assertEqual(_authoritative_resonance_gate([0.55, 0.95, 0.75, 1.15], 0.95), 1)
        self.assertNotEqual(
            _authoritative_resonance_gate([0.55, 0.95, 0.75, 1.15], 0.95),
            int(np.argmax([0.0, 0.0, 0.0, 1.0])),
        )
        spec = _cell_specs(CELL_DEFINITIONS[0])[0]
        cache = {}
        original = CorrectedEpisode.oracle_action
        try:
            CorrectedEpisode.oracle_action = lambda self: (_ for _ in ()).throw(
                AssertionError("diagnostic must not call oracle_action")
            )
            _prepare_cache([spec], cache)
        finally:
            CorrectedEpisode.oracle_action = original
        prepared = cache[(spec["world_seed"], spec["goal_index"], spec["note_variant"])]
        self.assertEqual(
            prepared["authoritative_resonance_gate"],
            _authoritative_resonance_gate(spec["gate_resonance_hz"], 0.55),
        )
        self.assertIn("spectrum_argmax_gate", prepared)

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
