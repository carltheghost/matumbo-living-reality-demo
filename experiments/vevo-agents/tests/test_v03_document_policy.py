import unittest

import numpy as np

from vevo_agents.autograd import Tensor
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
        self.assertEqual(specification["imitation_loss"]["aggregation"], "mean_per_step")
        self.assertTrue(specification["phase_rules"]["requested_fields_rejected_after_step_zero"])

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
        initial_encoded = interface.encode_observation(
            requested_fields=initial["requested_fields"],
            candidates=[],
            remaining_action_budget=initial["remaining_action_budget"],
            identity=identity,
            phase="initial_request",
        )
        encoded = interface.encode_observation(
            candidates=response["candidates"],
            requested_field_ids=("renewal_date", "account_owner"),
            latest_response=response,
            remaining_action_budget=response["remaining_action_budget"],
            identity=identity,
            phase="tool_response",
        )
        self.assertEqual(initial_encoded["request_types"].shape, (2, DOCUMENT_REQUEST_FEATURE_DIM))
        self.assertIsNone(encoded["request_types"])
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
        initial_observation = interface.model.make_observation(
            requested_fields=initial["requested_fields"],
            candidates=[],
            remaining_action_budget=initial["remaining_action_budget"],
            identity=identity,
            phase="initial_request",
        )
        observation = interface.model.make_observation(
            candidates=response["candidates"],
            latest_response=response,
            remaining_action_budget=response["remaining_action_budget"],
            identity=identity,
            phase="tool_response",
        )
        initial_result = interface.forward(initial_observation)
        result = interface.forward(observation, runtime=initial_result["runtime"])
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
        inspect_target = {"kind": "inspect_section", "document_handle": "doc-aurora", "section_id": "sec-terms"}
        select_target = {"kind": "select_candidate", "candidate_id": response["candidates"][0]["candidate_id"]}
        loss, gradients, initial_memory_gradient, trace = interface.loss_and_gradients(
            [initial_observation, observation], target_actions=[inspect_target, select_target]
        )
        self.assertTrue(np.isfinite(loss))
        self.assertTrue(np.isfinite(initial_memory_gradient).all())
        self.assertEqual(len(trace), 2)
        self.assertTrue(all(np.isfinite(step["loss"]) for step in trace))
        self.assertTrue(all(np.isfinite(value).all() for value in gradients.values()))
        self.assertGreater(float(np.max(np.abs(gradients["c.w_candidate_row"]))), 0.0)
        self.assertGreater(float(np.max(np.abs(gradients["c.W_candidate_bilinear"]))), 0.0)
        self.assertGreater(float(np.max(np.abs(gradients["c.W_in"]))), 0.0)
        self.assertGreater(float(np.max(np.abs(gradients["c.W_value"]))), 0.0)

    def test_runtime_identity_and_state_isolation(self):
        interface = DocumentPolicyInterface(seed=23)
        identity_a = DocumentEpisodeIdentity("episode-a", ("doc-a",), (("doc-a", "sec-a"),))
        identity_b = DocumentEpisodeIdentity("episode-b", ("doc-b",), (("doc-b", "sec-b"),))
        request = [{"field_id": "label", "value_type": "enum", "revision_rule": "latest_non_obsolete"}]
        obs_a = interface.model.make_observation(requested_fields=request, candidates=[], remaining_action_budget=2, identity=identity_a, phase="initial_request")
        obs_b = interface.model.make_observation(requested_fields=request, candidates=[], remaining_action_budget=2, identity=identity_b, phase="initial_request")
        first = interface.forward(obs_a)
        second = interface.forward(obs_b)
        np.testing.assert_array_equal(first["fixed_action_logits"], second["fixed_action_logits"])
        with self.assertRaises(Exception):
            interface.forward(obs_b, runtime=first["runtime"])

    def test_requested_fields_are_rejected_after_step_zero(self):
        interface = DocumentPolicyInterface(seed=29)
        identity = DocumentEpisodeIdentity("phase-test", ("doc-a",), (("doc-a", "sec-a"),))
        request = [{"field_id": "label", "value_type": "enum", "revision_rule": "latest_non_obsolete"}]
        initial = interface.model.make_observation(requested_fields=request, candidates=[], identity=identity, phase="initial_request")
        first = interface.forward(initial)
        response = {"schema": "vevo.v03.document-evidence.response.v1", "phase": "tool_response", "status": "section_observed", "terminal": False}
        with self.assertRaises(Exception):
            interface.model.make_observation(requested_fields=request, candidates=[], latest_response=response, identity=identity, phase="tool_response")
        subsequent = interface.model.make_observation(candidates=[], latest_response=response, identity=identity, phase="tool_response")
        with self.assertRaises(Exception):
            interface.forward({**subsequent, "requested_fields": []}, runtime=first["runtime"])

    def test_snapshot_binds_actual_parameter_digest_not_only_seed_and_shapes(self):
        interface = DocumentPolicyInterface(seed=37)
        identity = DocumentEpisodeIdentity("digest-runtime", ("doc-a",), (("doc-a", "sec-a"),))
        request = [{"field_id": "label", "value_type": "enum", "revision_rule": "latest_non_obsolete"}]
        observation = interface.model.make_observation(requested_fields=request, candidates=[], identity=identity, phase="initial_request")
        result = interface.forward(observation)
        snapshot = interface.model.snapshot_runtime(result["runtime"])
        changed = DocumentPolicyInterface(seed=37)
        changed.model.params = {name: value.copy() for name, value in interface.model.params.items()}
        changed.model.params["c.W_action"][0, 0] += 1e-9
        with self.assertRaises(Exception):
            changed.model.restore_runtime(snapshot)
        self.assertNotEqual(snapshot["model_identity"]["parameter_digest"], changed.model.model_identity()["parameter_digest"])

    def test_context_candidate_interaction_reverses_ranking_and_has_numeric_autograd_parity(self):
        interface = DocumentPolicyInterface(seed=31)
        model = interface.model
        model.params["c.w_candidate_row"][:] = 0.0
        model.params["c.w_candidate_context"][:] = 0.0
        model.params["c.b_candidate"][:] = 0.0
        model.params["c.W_candidate_bilinear"][:] = 0.0
        model.params["c.W_candidate_bilinear"][0, 0] = 1.0
        model.params["c.W_candidate_bilinear"][1, 1] = 1.0
        rows = np.zeros((2, model.encoder.candidate_feature_dim), dtype=np.float64)
        rows[0, 0] = 1.0
        rows[1, 1] = 1.0
        context_a = np.zeros(model.CENTER_HIDDEN + model.MEMORY_DIM, dtype=np.float64)
        context_b = context_a.copy()
        context_a[0] = 2.0
        context_b[1] = 2.0
        scores_a = model._candidate_scores_from_rows(rows, context_a)
        scores_b = model._candidate_scores_from_rows(rows, context_b)
        self.assertGreater(scores_a[0], scores_a[1])
        self.assertGreater(scores_b[1], scores_b[0])

        identity = DocumentEpisodeIdentity("interaction-parity", ("doc-a",), (("doc-a", "sec-a"),))
        first = candidate_template(candidate_id="cand-a", document_handle="doc-a", section_id="sec-a")
        second = {**first, "candidate_id": "cand-b", "field_id": "other", "value": "2028-01-01"}
        request = [{"field_id": "renewal_date", "value_type": "date", "revision_rule": "latest_non_obsolete"}]
        observation = model.make_observation(requested_fields=request, candidates=[first, second], identity=identity, phase="initial_request")
        _, gradients, _, _ = model.loss_and_gradients([observation], target_action={"kind": "select_candidate", "candidate_id": "cand-a"})
        epsilon = 1e-6
        original = model.params["c.W_candidate_bilinear"][0, 0]
        model.params["c.W_candidate_bilinear"][0, 0] = original + epsilon
        plus = model.loss_only([observation], target_action={"kind": "select_candidate", "candidate_id": "cand-a"})
        model.params["c.W_candidate_bilinear"][0, 0] = original - epsilon
        minus = model.loss_only([observation], target_action={"kind": "select_candidate", "candidate_id": "cand-a"})
        model.params["c.W_candidate_bilinear"][0, 0] = original
        finite_difference = (plus - minus) / (2.0 * epsilon)
        self.assertAlmostEqual(float(gradients["c.W_candidate_bilinear"][0, 0]), finite_difference, places=5)

        vector = model.encoder.encode_policy_input(requested_fields=request, candidates=[first, second], identity=identity)
        rows = model.encoder.encode_candidates([first, second], requested_field_ids=["renewal_date"], identity=identity)
        _, numeric_result = model._numeric_forward(model.initial_runtime(identity=identity), vector, rows)
        tensor_params = {name: Tensor(value.copy(), requires_grad=False) for name, value in model.params.items()}
        tensor_runtime = {
            "peripheral": [Tensor(np.zeros(model.PERIPH_HIDDEN)) for _ in range(model.PERIPHERALS)],
            "central": Tensor(np.zeros(model.CENTER_HIDDEN)),
            "memory": Tensor(np.zeros(model.central_memory_shape)),
        }
        _, _, tensor_candidate_logits, _ = model._tensor_forward(tensor_runtime, vector, rows, tensor_params)
        np.testing.assert_allclose(
            numeric_result["candidate_scores"],
            np.asarray([logit.data[0] for logit in tensor_candidate_logits], dtype=np.float64),
            rtol=1e-12,
            atol=1e-12,
        )

    def test_legal_action_candidates_are_exact_and_mask_consumed_state(self):
        store = DocumentBundleStore.from_bundled()
        task = make_task("typed-actions", ("doc-aurora", "doc-boreal"), (("renewal_date", "date"), ("account_owner", "person")))
        session = DocumentEvidenceSession(store, task)
        initial = session.start()
        identity = DocumentEpisodeIdentity.from_request(initial)
        interface = DocumentPolicyInterface(seed=41)
        initial_observation = interface.model.make_observation(
            requested_fields=initial["requested_fields"], candidates=[], identity=identity, phase="initial_request"
        )
        initial_result = interface.forward(initial_observation)
        inspect_options = [option for option in initial_result["legal_action_candidates"] if option["kind"] == "inspect_section"]
        self.assertEqual(len(inspect_options), len(identity.section_keys))
        self.assertTrue(all({"document_handle", "section_id", "score"}.issubset(option) for option in inspect_options))
        self.assertFalse(any(option["kind"] == "select_candidate" for option in initial_result["legal_action_candidates"]))
        self.assertFalse(any(option["kind"] in {"finish", "report_missing", "report_conflict"} for option in initial_result["legal_action_candidates"]))

        response = session.dispatch({"kind": "inspect_section", "document_handle": "doc-aurora", "section_id": "sec-terms"})
        observation = interface.model.make_observation(
            candidates=response["candidates"], latest_response=response, remaining_action_budget=response["remaining_action_budget"], identity=identity, phase="tool_response"
        )
        result = interface.forward(observation, runtime=initial_result["runtime"])
        self.assertFalse(any(
            option.get("kind") == "inspect_section"
            and option.get("document_handle") == "doc-aurora"
            and option.get("section_id") == "sec-terms"
            for option in result["legal_action_candidates"]
        ))
        candidate_id = response["candidates"][0]["candidate_id"]
        self.assertTrue(any(option.get("kind") == "select_candidate" and option.get("candidate_id") == candidate_id for option in result["legal_action_candidates"]))
        selected_response = session.dispatch({"kind": "select_candidate", "candidate_id": candidate_id})
        selected_observation = interface.model.make_observation(
            candidates=[], latest_response=selected_response, remaining_action_budget=selected_response["remaining_action_budget"], identity=identity, phase="tool_response"
        )
        selected_result = interface.forward(selected_observation, runtime=result["runtime"])
        self.assertFalse(any(option.get("kind") == "select_candidate" and option.get("candidate_id") == candidate_id for option in selected_result["legal_action_candidates"]))


if __name__ == "__main__":
    unittest.main()
