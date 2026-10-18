import unittest

import numpy as np

from vevo_agents.v03_document_evidence import DocumentBundleStore, DocumentEvidenceSession, make_task
from vevo_agents.v03_document_policy import (
    DOCUMENT_ACTIONS,
    DOCUMENT_MEMORY_SHAPE,
    DocumentNeuralPolicyUnavailable,
    DocumentObservationEncoder,
    DocumentPolicyInterface,
    VariableCandidateScorer,
)


class DocumentPolicyInterfaceTests(unittest.TestCase):
    def test_interface_preserves_five_brains_memory_and_non_mapping_contract(self):
        interface = DocumentPolicyInterface()
        specification = interface.specification()
        self.assertEqual(specification["peripheral_count"], 4)
        self.assertEqual(specification["central_count"], 1)
        self.assertEqual(specification["total_brains"], 5)
        self.assertEqual(tuple(specification["memory_shape"]), DOCUMENT_MEMORY_SHAPE)
        self.assertEqual(tuple(specification["action_vocabulary"]), DOCUMENT_ACTIONS)
        self.assertFalse(specification["gate_outputs_are_document_actions"])
        self.assertFalse(specification["neural_model_available"])
        self.assertTrue(specification["variable_candidate_set"])

    def test_neural_decision_is_explicitly_unavailable(self):
        interface = DocumentPolicyInterface()
        with self.assertRaises(DocumentNeuralPolicyUnavailable):
            interface.select_action({"phase": "request"})
        with self.assertRaises(DocumentNeuralPolicyUnavailable):
            interface.candidate_scorer.score([])

    def test_variable_candidate_encoder_has_no_request_labels_and_supports_empty_set(self):
        encoder = DocumentObservationEncoder()
        candidates = [{
            "schema": "vevo.v03.document-evidence.candidate.v1",
            "candidate_id": "cand-000000000000000000000000",
            "document_handle": "doc-aurora",
            "section_id": "sec-terms",
            "section_kind": "terms",
            "value_type": "date",
            "value": "2027-12-31",
            "revision": 4,
            "revision_state": "current",
            "published_at": "2026-09-15",
            "conflict_group": "renewal-date",
            "source_sha256": "a" * 64,
            "fact_digest": "b" * 64,
        }]
        encoded = encoder.encode_candidates(candidates, requested_field_ids=("renewal_date",))
        self.assertEqual(encoded.shape, (1, 16))
        self.assertTrue(np.isfinite(encoded).all())
        self.assertEqual(encoder.encode_candidates([]).shape, (0, 16))
        with self.assertRaises(Exception):
            encoder.encode_candidates([{**candidates[0], "field_id": "renewal_date"}], requested_field_ids=("renewal_date",))

    def test_real_observation_can_be_encoded_without_private_store_access(self):
        store = DocumentBundleStore.from_bundled()
        task = make_task(
            "encode",
            ("doc-aurora", "doc-boreal"),
            (("renewal_date", "date"), ("account_owner", "person")),
        )
        session = DocumentEvidenceSession(store, task)
        initial = session.start()
        response = session.dispatch({"kind": "inspect_section", "document_handle": "doc-aurora", "section_id": "sec-terms"})
        interface = DocumentPolicyInterface()
        encoded = interface.encode_observation(
            requested_fields=initial["requested_fields"],
            candidates=response["candidates"],
            requested_field_ids=("renewal_date", "account_owner"),
        )
        self.assertEqual(encoded["request_types"].shape, (2, 2))
        self.assertEqual(encoded["candidates"].shape[1], 16)


if __name__ == "__main__":
    unittest.main()
