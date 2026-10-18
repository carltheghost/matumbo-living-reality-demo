import unittest

import numpy as np

from vevo_agents.v03_document_evidence import DocumentBundleStore, DocumentEvidenceSession, make_task
from vevo_agents.v03_document_policy import (
    DOCUMENT_ACTIONS,
    DOCUMENT_CANDIDATE_FEATURE_DIM,
    DOCUMENT_MEMORY_SHAPE,
    DOCUMENT_REQUEST_FEATURE_DIM,
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
        self.assertEqual(set(specification["legal_action_schemas"]), set(DOCUMENT_ACTIONS))
        self.assertFalse(specification["gate_outputs_are_document_actions"])
        self.assertFalse(specification["neural_model_available"])
        self.assertTrue(specification["variable_candidate_set"])
        self.assertTrue(specification["phase_rules"]["initial_request_only"])
        self.assertTrue(specification["phase_rules"]["latest_tool_response_visible"])
        self.assertIn("remaining_action_budget", specification["phase_rules"]["latest_tool_response_fields"])
        self.assertEqual(
            specification["recurrent_snapshot_contract"]["types"]["memory"],
            "finite_float[2,6]",
        )
        self.assertEqual(specification["ordered_date_features"], ["ordinal_days", "year", "month", "day"])
        self.assertFalse(specification["provenance_digests_as_scalar_features"])
        self.assertFalse(specification["arbitrary_value_hashes_as_scalar_features"])

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
            "field_id": "renewal_date",
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
        self.assertEqual(encoded.shape, (1, DOCUMENT_CANDIDATE_FEATURE_DIM))
        self.assertTrue(np.isfinite(encoded).all())
        self.assertEqual(encoder.encode_candidates([]).shape, (0, DOCUMENT_CANDIDATE_FEATURE_DIM))
        with self.assertRaises(Exception):
            encoder.encode_candidates([{**candidates[0], "requested": True}], requested_field_ids=("renewal_date",))

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
        self.assertEqual(encoded["request_types"].shape, (2, DOCUMENT_REQUEST_FEATURE_DIM))
        self.assertEqual(encoded["candidates"].shape[1], DOCUMENT_CANDIDATE_FEATURE_DIM)

    def test_request_field_identity_and_candidate_identity_are_not_type_only(self):
        encoder = DocumentObservationEncoder()
        request_a = [
            {"field_id": "annual_limit", "value_type": "number", "revision_rule": "latest_non_obsolete"},
            {"field_id": "account_owner", "value_type": "person", "revision_rule": "latest_non_obsolete"},
        ]
        request_b = [
            {"field_id": "budget_floor", "value_type": "number", "revision_rule": "latest_non_obsolete"},
            {"field_id": "on_call_contact", "value_type": "person", "revision_rule": "latest_non_obsolete"},
        ]
        self.assertFalse(np.array_equal(encoder.encode_request_types(request_a), encoder.encode_request_types(request_b)))
        candidate_a = {"schema": "vevo.v03.document-evidence.candidate.v1", "candidate_id": "cand-a", "field_id": "annual_limit", "document_handle": "doc-a", "section_id": "sec-a", "section_kind": "commercial", "value_type": "number", "value": 1.0, "revision": 1, "revision_state": "current", "published_at": "2026-01-01", "conflict_group": None, "source_sha256": "a" * 64, "fact_digest": "b" * 64}
        candidate_b = {**candidate_a, "candidate_id": "cand-b", "field_id": "budget_floor", "value": 1.0}
        self.assertFalse(np.array_equal(encoder.encode_candidates([candidate_a]), encoder.encode_candidates([candidate_b])))

    def test_provenance_digests_do_not_become_scalar_semantic_features(self):
        encoder = DocumentObservationEncoder()
        candidate = {"schema": "vevo.v03.document-evidence.candidate.v1", "candidate_id": "cand-a", "field_id": "renewal_date", "document_handle": "doc-a", "section_id": "sec-a", "section_kind": "terms", "value_type": "date", "value": "2027-01-01", "revision": 1, "revision_state": "current", "published_at": "2026-01-01", "conflict_group": None, "source_sha256": "a" * 64, "fact_digest": "b" * 64}
        changed = {**candidate, "source_sha256": "c" * 64, "fact_digest": "d" * 64}
        np.testing.assert_array_equal(encoder.encode_candidates([candidate]), encoder.encode_candidates([changed]))


if __name__ == "__main__":
    unittest.main()
