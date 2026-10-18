import unittest

import numpy as np

from vevo_agents.v03_document_evidence import DocumentBundleStore, DocumentEvidenceSession, make_task
from vevo_agents.v03_document_policy import (
    DOCUMENT_ACTIONS,
    DOCUMENT_CANDIDATE_FEATURE_DIM,
    DOCUMENT_MEMORY_SHAPE,
    DOCUMENT_MODEL_INPUT_DIM,
    DOCUMENT_REQUEST_FEATURE_DIM,
    DocumentEpisodeIdentity,
    DocumentNeuralPolicyUnavailable,
    DocumentObservationEncoder,
    DocumentPolicyInterface,
)


def candidate_template(**overrides):
    candidate = {
        "schema": "vevo.v03.document-evidence.candidate.v1",
        "candidate_id": "cand-a",
        "field_id": "renewal_date",
        "document_handle": "doc-a",
        "section_id": "sec-a",
        "section_kind": "terms",
        "value_type": "date",
        "value": "2027-01-01",
        "revision": 1,
        "revision_state": "current",
        "published_at": "2026-01-01",
        "conflict_group": None,
        "source_sha256": "a" * 64,
        "fact_digest": "b" * 64,
    }
    candidate.update(overrides)
    return candidate


class DocumentPolicyInterfaceTests(unittest.TestCase):
    def test_interface_preserves_five_brains_memory_and_typed_snapshot_contract(self):
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
        self.assertTrue(specification["forward_available_for_structural_audit"])
        self.assertFalse(specification["decision_service_available"])
        self.assertTrue(specification["variable_candidate_set"])
        self.assertTrue(specification["phase_rules"]["initial_request_only"])
        self.assertTrue(specification["phase_rules"]["latest_tool_response_visible"])
        self.assertIn("remaining_action_budget", specification["phase_rules"]["latest_tool_response_fields"])
        types = specification["recurrent_snapshot_contract"]["types"]
        self.assertEqual(types["memory"], "finite_float[2,6]")
        self.assertEqual(types["peripheral_hidden_states"], "finite_float[4,8]")
        self.assertEqual(types["central_hidden_state"], "finite_float[12]")
        self.assertFalse(specification["identity_encoding"]["candidate_position_feature"])
        self.assertEqual(specification["ordered_date_features"], ["ordinal_days", "year", "month", "day"])
        self.assertFalse(specification["provenance_digests_as_scalar_features"])
        self.assertFalse(specification["arbitrary_value_hashes_as_scalar_features"])

    def test_neural_decision_is_explicitly_unavailable_but_structural_scorer_is_finite(self):
        interface = DocumentPolicyInterface()
        with self.assertRaises(DocumentNeuralPolicyUnavailable):
            interface.select_action({"phase": "request"})
        self.assertEqual(interface.candidate_scorer.score([]).shape, (0,))

    def test_variable_candidate_encoder_has_no_request_labels_and_supports_empty_set(self):
        encoder = DocumentObservationEncoder()
        identity = DocumentEpisodeIdentity("test-episode", ("doc-aurora",), (("doc-aurora", "sec-terms"),))
        candidate = candidate_template(
            candidate_id="cand-000000000000000000000000",
            document_handle="doc-aurora",
            section_id="sec-terms",
            value_type="date",
            value="2027-12-31",
            revision=4,
            conflict_group="renewal-date",
        )
        encoded = encoder.encode_candidates([candidate], requested_field_ids=("renewal_date",), identity=identity)
        self.assertEqual(encoded.shape, (1, DOCUMENT_CANDIDATE_FEATURE_DIM))
        self.assertTrue(np.isfinite(encoded).all())
        self.assertEqual(encoder.encode_candidates([]).shape, (0, DOCUMENT_CANDIDATE_FEATURE_DIM))
        with self.assertRaises(Exception):
            encoder.encode_candidates([{**candidate, "requested": True}], requested_field_ids=("renewal_date",), identity=identity)

    def test_real_observation_can_be_encoded_without_private_store_access(self):
        store = DocumentBundleStore.from_bundled()
        task = make_task("encode", ("doc-aurora", "doc-boreal"), (("renewal_date", "date"), ("account_owner", "person")))
        session = DocumentEvidenceSession(store, task)
        initial = session.start()
        identity = DocumentEpisodeIdentity.from_request(initial)
        response = session.dispatch({"kind": "inspect_section", "document_handle": "doc-aurora", "section_id": "sec-terms"})
        interface = DocumentPolicyInterface()
        encoded = interface.encode_observation(
            requested_fields=initial["requested_fields"],
            candidates=response["candidates"],
            requested_field_ids=("renewal_date", "account_owner"),
            latest_response=response,
            remaining_action_budget=response["remaining_action_budget"],
            identity=identity,
        )
        self.assertEqual(encoded["request_types"].shape, (2, DOCUMENT_REQUEST_FEATURE_DIM))
        self.assertEqual(encoded["candidates"].shape[1], DOCUMENT_CANDIDATE_FEATURE_DIM)
        self.assertEqual(encoded["model_input"].shape, (DOCUMENT_MODEL_INPUT_DIM,))

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
        identity = DocumentEpisodeIdentity("identity-test", ("doc-a",), (("doc-a", "sec-a"),))
        candidate_a = candidate_template(
            candidate_id="cand-a",
            field_id="annual_limit",
            document_handle="doc-a",
            section_id="sec-a",
            section_kind="commercial",
            value_type="number",
            value=1.0,
        )
        candidate_b = {**candidate_a, "candidate_id": "cand-b", "field_id": "budget_floor"}
        self.assertFalse(
            np.array_equal(
                encoder.encode_candidates([candidate_a], identity=identity),
                encoder.encode_candidates([candidate_b], identity=identity),
            )
        )

    def test_provenance_digests_do_not_become_scalar_semantic_features(self):
        encoder = DocumentObservationEncoder()
        identity = DocumentEpisodeIdentity("digest-test", ("doc-a",), (("doc-a", "sec-a"),))
        candidate = candidate_template(candidate_id="cand-a")
        changed = {**candidate, "source_sha256": "c" * 64, "fact_digest": "d" * 64}
        np.testing.assert_array_equal(
            encoder.encode_candidates([candidate], identity=identity),
            encoder.encode_candidates([changed], identity=identity),
        )

    def test_candidate_encoding_is_permutation_equivariant_and_catalog_stable(self):
        encoder = DocumentObservationEncoder()
        identity = DocumentEpisodeIdentity(
            "catalog-episode",
            ("doc-b", "doc-a"),
            (("doc-b", "sec-b"), ("doc-a", "sec-a")),
        )
        first = candidate_template(candidate_id="cand-a", field_id="annual_limit", document_handle="doc-a", section_id="sec-a", section_kind="commercial", value_type="number", value=10.0)
        second = {**first, "candidate_id": "cand-b", "field_id": "budget_floor", "document_handle": "doc-b", "section_id": "sec-b", "value": 20.0}
        baseline = encoder.encode_candidates([first, second], identity=identity)
        permuted = encoder.encode_candidates([second, first], identity=identity)
        np.testing.assert_array_equal(permuted, baseline[[1, 0]])
        separate = encoder.encode_candidates([first], identity=identity)
        np.testing.assert_array_equal(separate[0], baseline[0])
        self.assertFalse(np.array_equal(baseline[0], baseline[1]))

    def test_untrained_forward_is_candidate_permutation_equivariant(self):
        interface = DocumentPolicyInterface(seed=11)
        identity = DocumentEpisodeIdentity("forward-permutation", ("doc-a", "doc-b"), (("doc-a", "sec-a"), ("doc-b", "sec-b")))
        first = candidate_template(candidate_id="cand-a", field_id="annual_limit", document_handle="doc-a", section_id="sec-a", section_kind="commercial", value_type="number", value=10.0)
        second = {**first, "candidate_id": "cand-b", "field_id": "budget_floor", "document_handle": "doc-b", "section_id": "sec-b", "value": 20.0}
        request = [{"field_id": "annual_limit", "value_type": "number", "revision_rule": "latest_non_obsolete"}]
        baseline = interface.model.make_observation(requested_fields=request, candidates=[first, second], identity=identity)
        permuted = interface.model.make_observation(requested_fields=request, candidates=[second, first], identity=identity)
        first_output = interface.forward(baseline)
        second_output = interface.forward(permuted)
        np.testing.assert_array_equal(first_output["fixed_action_logits"], second_output["fixed_action_logits"])
        np.testing.assert_array_equal(first_output["candidate_scores"], second_output["candidate_scores"][::-1])

    def test_long_utf8_inputs_are_rejected_or_preserved_without_truncation(self):
        encoder = DocumentObservationEncoder()
        request = [{"field_id": "a" * 129, "value_type": "number", "revision_rule": "latest_non_obsolete"}]
        with self.assertRaises(Exception):
            encoder.encode_request_types(request)
        identity = DocumentEpisodeIdentity("unicode", ("doc-a",), (("doc-a", "sec-a"),))
        candidate = candidate_template(candidate_id="cand-unicode", field_id="label", section_kind="overview", value_type="enum", value="合同✓")
        encoded = encoder.encode_candidates([candidate], identity=identity)
        self.assertTrue(np.isfinite(encoded).all())
        with self.assertRaises(Exception):
            encoder.encode_candidates([{**candidate, "value": "✓" * 200}], identity=identity)

    def test_untrained_forward_shapes_gradients_and_runtime_snapshot_parity(self):
        store = DocumentBundleStore.from_bundled()
        task = make_task("neural-structural", ("doc-aurora", "doc-boreal"), (("renewal_date", "date"), ("account_owner", "person")))
        session = DocumentEvidenceSession(store, task)
        initial = session.start()
        identity = DocumentEpisodeIdentity.from_request(initial)
        response = session.dispatch({"kind": "inspect_section", "document_handle": "doc-aurora", "section_id": "sec-terms"})
        interface = DocumentPolicyInterface(seed=19)
        observation = interface.model.make_observation(
            requested_fields=initial["requested_fields"],
            candidates=response["candidates"],
            latest_response=response,
            remaining_action_budget=response["remaining_action_budget"],
            identity=identity,
        )
        result = interface.forward(observation)
        self.assertEqual(result["fixed_action_logits"].shape, (4,))
        self.assertEqual(result["candidate_scores"].shape, (len(response["candidates"]),))
        self.assertTrue(np.isfinite(result["fixed_action_logits"]).all())
        self.assertTrue(np.isfinite(result["candidate_scores"]).all())
        snapshot = interface.model.snapshot_runtime(result["runtime"])
        restored = interface.model.restore_runtime(snapshot)
        continued = interface.forward(observation, runtime=restored)
        repeated = interface.forward(observation, runtime=result["runtime"])
        np.testing.assert_array_equal(continued["fixed_action_logits"], repeated["fixed_action_logits"])
        np.testing.assert_array_equal(continued["candidate_scores"], repeated["candidate_scores"])
        loss, gradients, initial_memory_gradient, trace = interface.loss_and_gradients([observation], target_action="finish")
        self.assertTrue(np.isfinite(loss))
        self.assertTrue(np.isfinite(initial_memory_gradient).all())
        self.assertEqual(len(trace), 1)
        self.assertTrue(all(np.isfinite(value).all() for value in gradients.values()))
        candidate_target = {"kind": "select_candidate", "candidate_id": response["candidates"][0]["candidate_id"]}
        candidate_loss, candidate_gradients, _, _ = interface.loss_and_gradients([observation], target_action=candidate_target)
        self.assertTrue(np.isfinite(candidate_loss))
        self.assertGreater(float(np.max(np.abs(candidate_gradients["c.w_candidate_row"]))), 0.0)

    def test_runtime_identity_and_state_isolation(self):
        interface = DocumentPolicyInterface(seed=23)
        identity_a = DocumentEpisodeIdentity("episode-a", ("doc-a",), (("doc-a", "sec-a"),))
        identity_b = DocumentEpisodeIdentity("episode-b", ("doc-b",), (("doc-b", "sec-b"),))
        request = [{"field_id": "label", "value_type": "enum", "revision_rule": "latest_non_obsolete"}]
        response = {"schema": "vevo.v03.document-evidence.response.v1", "status": "request", "remaining_action_budget": 2}
        obs_a = interface.model.make_observation(requested_fields=request, candidates=[], latest_response=response, remaining_action_budget=2, identity=identity_a)
        obs_b = interface.model.make_observation(requested_fields=request, candidates=[], latest_response=response, remaining_action_budget=2, identity=identity_b)
        first = interface.forward(obs_a)
        second = interface.forward(obs_b)
        np.testing.assert_array_equal(first["fixed_action_logits"], second["fixed_action_logits"])
        with self.assertRaises(Exception):
            interface.forward(obs_b, runtime=first["runtime"])


if __name__ == "__main__":
    unittest.main()
