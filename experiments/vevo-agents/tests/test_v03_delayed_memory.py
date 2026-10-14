import json
import unittest

import numpy as np

from vevo_agents.v03_delayed_memory import (
    DELAYED_TRAIN_WORLD_SEEDS,
    HELDOUT_WORLD_SEEDS,
    HISTORICAL_WORLD_SEEDS,
    _prepare_delayed_episode,
    build_delayed_examples,
    make_heldout_specs,
    make_training_specs,
)
from vevo_agents.v03_model import (
    NOTE_FEATURE_END,
    NOTE_FEATURE_START,
    NOTE_PAYLOAD_MASK_INDEX,
    encode_policy_observation,
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


if __name__ == "__main__":
    unittest.main()
