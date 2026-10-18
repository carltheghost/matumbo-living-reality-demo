import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from vevo_agents.v03_document_evidence import (
    DocumentBundleStore,
    DocumentEvidenceSession,
    DocumentIntegrityError,
    ForbiddenDocumentHandle,
    ProtocolViolation,
    make_task,
    run_observation_limited_policy,
    run_read_all_baseline,
)


BUNDLE = Path("storage/document_evidence")


def current_task(*, seed=7, action_budget=16):
    return make_task(
        "current-contract",
        ("doc-aurora", "doc-boreal", "doc-cinder"),
        (("renewal_date", "date"), ("account_owner", "person"), ("annual_limit", "number")),
        seed=seed,
        action_budget=action_budget,
    )


def missing_task(*, seed=7, action_budget=16):
    return make_task(
        "missing-support",
        ("doc-aurora", "doc-boreal", "doc-cinder"),
        (("support_contact", "email"), ("account_owner", "person"), ("annual_limit", "number")),
        seed=seed,
        action_budget=action_budget,
    )


def packet_from_features(requested, features, *, forged_value=None, bad_citation=False):
    by_field = {}
    for feature in features:
        by_field.setdefault(feature["field_id"], []).append(feature)
    entries = []
    conflicts = []
    for field in requested:
        field_id = field["field_id"] if isinstance(field, dict) else field.field_id
        value_type = field["value_type"] if isinstance(field, dict) else field.value_type
        candidates = sorted(
            [
                candidate for candidate in by_field.get(field_id, [])
                if candidate["value_type"] == value_type and candidate["revision_state"] == "current"
            ],
            key=lambda item: (item["revision"], item["published_at"], item["candidate_id"]),
            reverse=True,
        )
        chosen = candidates[0]
        citation = {
            "document_handle": chosen["document_handle"],
            "section_id": chosen["section_id"],
            "source_sha256": chosen["source_sha256"],
            "fact_digest": chosen["fact_digest"],
        }
        if bad_citation:
            citation["fact_digest"] = "0" * 64
        entries.append({
            "field_id": field_id,
            "candidate_id": chosen["candidate_id"],
            "value": chosen["value"] if forged_value is None or field_id != forged_value[0] else forged_value[1],
            "value_type": chosen["value_type"],
            "citation": citation,
        })
    return {"entries": entries, "missing_fields": [], "conflicts": conflicts}


class DocumentEvidenceProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = DocumentBundleStore.from_bundled()

    def test_bundle_is_bounded_and_handles_are_server_owned(self):
        self.assertEqual(len(self.store.document_handles), 6)
        for handle in self.store.document_handles:
            document = self.store.open_document(handle)
            self.assertLessEqual(len(document["sections"]), 4)
        with self.assertRaises(ForbiddenDocumentHandle):
            self.store.open_document("../doc-aurora")
        with self.assertRaises(ForbiddenDocumentHandle):
            self.store.open_document("/tmp/doc-aurora")
        with self.assertRaises(ForbiddenDocumentHandle):
            self.store.open_document("caller/path")
        with self.assertRaises(ProtocolViolation):
            make_task("bad", ("doc-aurora", "caller/path"), (("a", "date"), ("b", "person")))

    def test_initial_request_and_candidates_preserve_legitimate_field_identity(self):
        session = DocumentEvidenceSession(self.store, current_task())
        initial = session.start()
        self.assertEqual(
            [field["field_id"] for field in initial["requested_fields"]],
            ["renewal_date", "account_owner", "annual_limit"],
        )
        response = session.dispatch({
            "kind": "inspect_section",
            "document_handle": "doc-aurora",
            "section_id": "sec-terms",
        })
        self.assertEqual(response["status"], "section_observed")
        for candidate in response["candidates"]:
            self.assertIn("field_id", candidate)
            self.assertNotIn("fact_id", candidate)
            self.assertNotIn("target", candidate)
            self.assertNotIn("requested_fields", candidate)
            self.assertNotIn("source_path", candidate)
        self.assertEqual(response["schema"], "vevo.v03.document-evidence.response.v1")

    def test_candidate_order_is_seeded_and_ids_are_opaque(self):
        orders = []
        for seed in (1, 2):
            session = DocumentEvidenceSession(self.store, current_task(seed=seed))
            session.start()
            response = session.dispatch({
                "kind": "inspect_section",
                "document_handle": "doc-aurora",
                "section_id": "sec-terms",
            })
            orders.append([candidate["candidate_id"] for candidate in response["candidates"]])
        self.assertNotEqual(orders[0], orders[1])
        for candidate_id in orders[0] + orders[1]:
            self.assertRegex(candidate_id, r"^cand-[0-9a-f]{24}$")
            self.assertNotIn("aurora", candidate_id)
            self.assertNotIn("renewal", candidate_id)

    def test_observation_limited_expert_resolves_latest_current_values(self):
        session = DocumentEvidenceSession(self.store, current_task())
        result = run_observation_limited_policy(session)
        self.assertEqual(result["outcome"]["status"], "verified_complete")
        self.assertEqual(session.action_count, 16)
        selected = [session.evidence.get(candidate_id) for candidate_id in session.selected_candidate_ids]
        values = {record.field_id: record.value for record in selected}
        self.assertEqual(values["renewal_date"], "2028-06-30")
        self.assertEqual(values["account_owner"], "Noah Vale")
        self.assertEqual(values["annual_limit"], 150000.0)
        self.assertTrue(all("outcome" not in response or isinstance(response["outcome"], dict) for response in result["transcript"]))

    def test_paired_same_type_requests_use_exact_identity_and_unusual_sections(self):
        first = make_task(
            "paired-request-a",
            ("doc-aurora", "doc-boreal", "doc-cinder"),
            (("annual_limit", "number"), ("account_owner", "person")),
        )
        second = make_task(
            "paired-request-b",
            ("doc-aurora", "doc-boreal", "doc-cinder"),
            (("budget_floor", "number"), ("special_contact", "person")),
        )
        self.assertEqual(
            [field.value_type for field in first.requested_fields],
            [field.value_type for field in second.requested_fields],
        )
        first_session = DocumentEvidenceSession(self.store, first)
        second_session = DocumentEvidenceSession(self.store, second)
        first_result = run_observation_limited_policy(first_session)
        second_result = run_observation_limited_policy(second_session)
        self.assertEqual(first_result["outcome"]["status"], "verified_complete")
        self.assertEqual(second_result["outcome"]["status"], "verified_complete")
        second_values = {
            self_session.evidence.get(candidate_id).field_id: self_session.evidence.get(candidate_id).value
            for self_session in (second_session,)
            for candidate_id in self_session.selected_candidate_ids
        }
        self.assertEqual(second_values["budget_floor"], 100000.0)
        self.assertEqual(second_values["special_contact"], "Uma Reed")
        candidate_fields = [
            candidate["field_id"]
            for response in second_result["transcript"]
            for candidate in response.get("candidates", [])
        ]
        self.assertIn("alert_threshold", candidate_fields)
        self.assertIn("budget_floor", candidate_fields)
        self.assertNotIn("requested", second_result["transcript"][1]["candidates"][0])

    def test_equal_rank_conflict_finishes_with_both_verified_citations(self):
        task = make_task(
            "equal-rank-conflict",
            ("doc-aurora", "doc-cinder"),
            (("alert_threshold", "ratio"), ("account_owner", "person")),
        )
        session = DocumentEvidenceSession(self.store, task)
        result = run_observation_limited_policy(session)
        self.assertEqual(result["outcome"]["status"], "verified_conflict")
        conflict = result["outcome"]["verified_conflicts"][0]
        self.assertEqual(conflict["field_id"], "alert_threshold")
        self.assertEqual(len(conflict["citations"]), 2)
        self.assertEqual({citation["section_id"] for citation in conflict["citations"]}, {"sec-commercial"})
        self.assertTrue(all(citation["fact_digest"] for citation in conflict["citations"]))

    def test_read_all_baseline_uses_exact_sixteen_action_budget(self):
        session = DocumentEvidenceSession(self.store, current_task())
        result = run_read_all_baseline(session)
        self.assertEqual(result["outcome"]["status"], "verified_complete")
        self.assertEqual(session.action_count, 16)
        self.assertEqual(
            sum(response.get("status") == "section_observed" for response in result["transcript"]),
            12,
        )

    def test_missing_claim_requires_full_exploration_and_reports_honestly(self):
        session = DocumentEvidenceSession(self.store, missing_task())
        session.start()
        session.dispatch({
            "kind": "inspect_section",
            "document_handle": "doc-aurora",
            "section_id": "sec-contacts",
        })
        early = session.dispatch({
            "kind": "report_missing",
            "field_id": "support_contact",
            "packet": {"entries": [], "missing_fields": ["support_contact", "account_owner", "annual_limit"]},
        })
        self.assertEqual(early["status"], "inconclusive_insufficient_exploration")
        self.assertFalse(early["terminal"])
        full = DocumentEvidenceSession(self.store, missing_task())
        result = run_observation_limited_policy(full)
        self.assertEqual(result["outcome"]["status"], "verified_missing_facts")
        self.assertTrue(result["outcome"]["missing_fact_detection"])
        self.assertEqual(full.action_count, 15)

    def _collect_relevant_observations(self, session):
        session.start()
        features = []
        for handle, section_id in (
            ("doc-aurora", "sec-commercial"),
            ("doc-aurora", "sec-contacts"),
            ("doc-aurora", "sec-terms"),
            ("doc-boreal", "sec-commercial"),
            ("doc-boreal", "sec-contacts"),
            ("doc-boreal", "sec-terms"),
            ("doc-cinder", "sec-commercial"),
            ("doc-cinder", "sec-contacts"),
            ("doc-cinder", "sec-terms"),
        ):
            response = session.dispatch({"kind": "inspect_section", "document_handle": handle, "section_id": section_id})
            features.extend(response.get("candidates", []))
        return features

    def test_forged_value_and_citation_are_rejected(self):
        task = current_task()
        forged_session = DocumentEvidenceSession(self.store, task)
        features = self._collect_relevant_observations(forged_session)
        packet = packet_from_features(task.requested_fields, features, forged_value=("annual_limit", 1.0))
        for entry in packet["entries"]:
            forged_session.dispatch({"kind": "select_candidate", "candidate_id": entry["candidate_id"]})
        forged = forged_session.dispatch({"kind": "finish", "packet": packet})
        self.assertEqual(forged["status"], "verification_failed")
        self.assertTrue(forged["terminal"])
        self.assertNotIn("revision_field", forged["outcome"])
        self.assertNotIn("conflicting_field", forged["outcome"])
        citation_session = DocumentEvidenceSession(self.store, task)
        features = self._collect_relevant_observations(citation_session)
        packet = packet_from_features(task.requested_fields, features, bad_citation=True)
        for entry in packet["entries"]:
            citation_session.dispatch({"kind": "select_candidate", "candidate_id": entry["candidate_id"]})
        citation = citation_session.dispatch({"kind": "finish", "packet": packet})
        self.assertEqual(citation["status"], "verification_failed")
        self.assertTrue(citation["terminal"])

    def test_obsolete_or_non_latest_candidate_fails_revision_rule(self):
        task = make_task(
            "revision",
            ("doc-aurora", "doc-boreal"),
            (("renewal_date", "date"), ("annual_limit", "number")),
        )
        session = DocumentEvidenceSession(self.store, task)
        features = []
        session.start()
        for handle, section_id in (
            ("doc-aurora", "sec-terms"),
            ("doc-aurora", "sec-commercial"),
            ("doc-boreal", "sec-terms"),
            ("doc-boreal", "sec-commercial"),
        ):
            features.extend(session.dispatch({"kind": "inspect_section", "document_handle": handle, "section_id": section_id}).get("candidates", []))
        old = sorted(
            [candidate for candidate in features if candidate["value_type"] == "date"],
            key=lambda candidate: candidate["revision"],
        )[0]
        number = sorted(
            [candidate for candidate in features if candidate["value_type"] == "number"],
            key=lambda candidate: candidate["revision"],
            reverse=True,
        )[0]
        for candidate in (old, number):
            session.dispatch({"kind": "select_candidate", "candidate_id": candidate["candidate_id"]})
        packet = {
            "entries": [
                {
                    "field_id": "renewal_date",
                    "candidate_id": old["candidate_id"],
                    "value": old["value"],
                    "value_type": old["value_type"],
                    "citation": {key: old[key] for key in ("document_handle", "section_id", "source_sha256", "fact_digest")},
                },
                {
                    "field_id": "annual_limit",
                    "candidate_id": number["candidate_id"],
                    "value": number["value"],
                    "value_type": number["value_type"],
                    "citation": {key: number[key] for key in ("document_handle", "section_id", "source_sha256", "fact_digest")},
                },
            ],
            "missing_fields": [],
        }
        response = session.dispatch({"kind": "finish", "packet": packet})
        self.assertEqual(response["status"], "verification_failed")

    def test_unseen_newer_source_fact_cannot_be_omitted_from_revision_check(self):
        task = make_task(
            "unseen-newer",
            ("doc-aurora", "doc-boreal"),
            (("renewal_date", "date"), ("annual_limit", "number")),
        )
        session = DocumentEvidenceSession(self.store, task)
        session.start()
        features = []
        for handle, section_id in (
            ("doc-aurora", "sec-terms"),
            ("doc-aurora", "sec-commercial"),
            ("doc-boreal", "sec-commercial"),
        ):
            features.extend(session.dispatch({"kind": "inspect_section", "document_handle": handle, "section_id": section_id}).get("candidates", []))
        date_candidate = next(candidate for candidate in features if candidate["value_type"] == "date" and candidate["revision_state"] == "current")
        for candidate in (date_candidate,):
            session.dispatch({"kind": "select_candidate", "candidate_id": candidate["candidate_id"]})
        packet = packet_from_features(task.requested_fields, features)
        for entry in packet["entries"]:
            if entry["candidate_id"] not in session.selected_candidate_ids:
                session.dispatch({"kind": "select_candidate", "candidate_id": entry["candidate_id"]})
        response = session.dispatch({"kind": "finish", "packet": packet})
        self.assertEqual(response["status"], "verification_failed")

    def test_budget_exhaustion_is_structured_and_does_not_verify(self):
        session = DocumentEvidenceSession(self.store, current_task(action_budget=1))
        session.start()
        first = session.dispatch({
            "kind": "inspect_section",
            "document_handle": "doc-aurora",
            "section_id": "sec-commercial",
        })
        self.assertEqual(first["action_count"], 1)
        exhausted = session.dispatch({"kind": "finish", "packet": {"entries": [], "missing_fields": []}})
        self.assertEqual(exhausted["status"], "budget_exhausted")
        self.assertTrue(exhausted["terminal"])
        self.assertNotIn("source_citation_accuracy", exhausted)

    def test_malformed_nonfinite_action_is_rejected_without_exception(self):
        session = DocumentEvidenceSession(self.store, current_task())
        session.start()
        response = session.dispatch({"kind": "select_candidate", "candidate_id": float("nan")})
        self.assertEqual(response["status"], "invalid_action")
        self.assertEqual(session.action_count, 1)

    def test_duplicate_and_incomplete_actions_are_structured_failures(self):
        session = DocumentEvidenceSession(self.store, current_task())
        session.start()
        action = {"kind": "inspect_section", "document_handle": "doc-aurora", "section_id": "sec-commercial"}
        first = session.dispatch(action)
        duplicate = session.dispatch(action)
        self.assertEqual(first["status"], "section_observed")
        self.assertEqual(duplicate["status"], "duplicate_action")
        incomplete = session.dispatch({"kind": "finish", "packet": {"entries": [], "missing_fields": []}})
        self.assertEqual(incomplete["status"], "incomplete_packet")
        self.assertFalse(incomplete["terminal"])
        self.assertEqual(DocumentEvidenceSession.restore(self.store, current_task(), session.snapshot()).snapshot(), session.snapshot())

    def test_unselected_observed_candidate_cannot_complete(self):
        task = make_task(
            "selection",
            ("doc-aurora", "doc-boreal"),
            (("renewal_date", "date"), ("annual_limit", "number")),
        )
        session = DocumentEvidenceSession(self.store, task)
        features = self._collect_relevant_observations(session)
        packet = packet_from_features(task.requested_fields, features)
        response = session.dispatch({"kind": "finish", "packet": packet})
        self.assertEqual(response["status"], "incomplete_packet")

    def test_snapshot_restore_has_exact_restart_parity(self):
        task = current_task(seed=19)
        session = DocumentEvidenceSession(self.store, task)
        session.start()
        session.dispatch({"kind": "inspect_section", "document_handle": "doc-aurora", "section_id": "sec-commercial"})
        session.dispatch({"kind": "inspect_section", "document_handle": "doc-aurora", "section_id": "sec-terms"})
        snapshot = session.snapshot()
        restored = DocumentEvidenceSession.restore(self.store, task, snapshot)
        self.assertEqual(restored.snapshot(), snapshot)
        next_action = {"kind": "inspect_section", "document_handle": "doc-boreal", "section_id": "sec-commercial"}
        self.assertEqual(session.dispatch(next_action), restored.dispatch(next_action))
        self.assertEqual(session.snapshot(), restored.snapshot())

    def test_snapshot_replays_malformed_action_and_binds_request_scope(self):
        task = current_task(seed=21)
        session = DocumentEvidenceSession(self.store, task)
        session.start()
        session.dispatch({"kind": "select_candidate", "candidate_id": float("nan")})
        snapshot = session.snapshot()
        restored = DocumentEvidenceSession.restore(self.store, task, snapshot)
        self.assertEqual(restored.snapshot(), snapshot)
        changed_task = make_task(
            task.task_id,
            task.document_handles,
            (("renewal_date", "date"), ("budget_floor", "number"), ("annual_limit", "number")),
            seed=task.seed,
            action_budget=task.action_budget,
        )
        with self.assertRaises(ProtocolViolation):
            DocumentEvidenceSession.restore(self.store, changed_task, snapshot)
        changed_scope = make_task(
            task.task_id,
            ("doc-aurora", "doc-cinder", "doc-boreal"),
            (("renewal_date", "date"), ("account_owner", "person")),
            seed=task.seed,
            action_budget=task.action_budget,
        )
        with self.assertRaises(ProtocolViolation):
            DocumentEvidenceSession.restore(self.store, changed_scope, snapshot)

    def test_budget_exhaustion_snapshot_replays_transition(self):
        task = current_task(action_budget=1)
        session = DocumentEvidenceSession(self.store, task)
        session.start()
        session.dispatch({"kind": "inspect_section", "document_handle": "doc-aurora", "section_id": "sec-terms"})
        exhausted = session.dispatch({"kind": "finish", "packet": {"entries": [], "missing_fields": []}})
        self.assertEqual(exhausted["status"], "budget_exhausted")
        restored = DocumentEvidenceSession.restore(self.store, task, session.snapshot())
        self.assertEqual(restored.snapshot(), session.snapshot())
        self.assertEqual(restored.dispatch({"kind": "finish", "packet": {"entries": [], "missing_fields": []}})["status"], "already_terminal")

    def test_every_replayable_terminal_outcome_restores_exactly(self):
        terminal_sessions = []
        success = DocumentEvidenceSession(self.store, current_task(seed=31))
        run_observation_limited_policy(success)
        terminal_sessions.append(success)
        missing = DocumentEvidenceSession(self.store, missing_task(seed=32))
        run_observation_limited_policy(missing)
        terminal_sessions.append(missing)
        conflict_task = make_task(
            "terminal-conflict",
            ("doc-aurora", "doc-cinder"),
            (("alert_threshold", "ratio"), ("account_owner", "person")),
            seed=33,
        )
        conflict = DocumentEvidenceSession(self.store, conflict_task)
        run_observation_limited_policy(conflict)
        terminal_sessions.append(conflict)
        failed = DocumentEvidenceSession(self.store, current_task(seed=34))
        features = self._collect_relevant_observations(failed)
        packet = packet_from_features(current_task().requested_fields, features, forged_value=("annual_limit", 1.0))
        for entry in packet["entries"]:
            failed.dispatch({"kind": "select_candidate", "candidate_id": entry["candidate_id"]})
        self.assertEqual(failed.dispatch({"kind": "finish", "packet": packet})["status"], "verification_failed")
        terminal_sessions.append(failed)
        for session in terminal_sessions:
            restored = DocumentEvidenceSession.restore(self.store, session.task, session.snapshot())
            self.assertEqual(restored.snapshot(), session.snapshot())

    def test_source_change_blocks_verification_and_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / "document_evidence"
            shutil.copytree(BUNDLE, copied)
            store = DocumentBundleStore._from_server_root(copied)
            task = current_task()
            session = DocumentEvidenceSession(store, task)
            session.start()
            snapshot = session.snapshot()
            source = copied / "doc-aurora.json"
            source.write_bytes(source.read_bytes() + b"\n")
            response = session.dispatch({"kind": "inspect_section", "document_handle": "doc-aurora", "section_id": "sec-terms"})
            self.assertEqual(response["status"], "source_changed")
            with self.assertRaises(DocumentIntegrityError):
                DocumentEvidenceSession.restore(store, task, snapshot)

    def test_manifested_nonfinite_document_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / "document_evidence"
            shutil.copytree(BUNDLE, copied)
            source = copied / "doc-aurora.json"
            document = json.loads(source.read_text())
            document["sections"][1]["facts"][0]["value"] = float("nan")
            source.write_text(json.dumps(document, allow_nan=True, indent=2) + "\n")
            manifest_path = copied / "bundle_manifest.json"
            manifest = json.loads(manifest_path.read_text())
            for entry in manifest["documents"]:
                if entry["handle"] == "doc-aurora":
                    entry["sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
            store = DocumentBundleStore._from_server_root(copied)
            with self.assertRaises(DocumentIntegrityError):
                store.open_document("doc-aurora")


if __name__ == "__main__":
    unittest.main()
