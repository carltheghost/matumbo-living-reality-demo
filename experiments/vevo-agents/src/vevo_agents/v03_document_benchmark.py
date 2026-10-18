"""Frozen preregistration and comparator contract for document evidence.

The preregistration is source-only.  It records the split, task requests,
metrics, costs, and a future Jev comparator interface without running a model,
training, evaluation sweep, live calls, or credentialed actions.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from .v03_document_evidence import DocumentBundleStore, DocumentTask, make_task


PREREG_SCHEMA = "vevo.v03.document-evidence-benchmark-preregistration.v1"
PREREG_STATUS = "awaiting_document_policy_review_before_training"
STATIC_PREREG_RELATIVE_PATH = Path("reports/generated/v03-document-evidence-benchmark-preregistration.json")
MARKDOWN_REPORT_RELATIVE_PATH = Path("docs/V03_DOCUMENT_EVIDENCE_BENCHMARK_PREREGISTRATION.md")
TRAIN_DOCUMENT_HANDLES = ("doc-echo",)
DEVELOPMENT_DOCUMENT_HANDLES = ("doc-aurora", "doc-boreal", "doc-cinder")
TEST_DOCUMENT_HANDLES = ("doc-delta", "doc-foxtrot")
DEVELOPMENT_CASE_SEEDS = (9300, 9301, 9302)
TEST_CASE_SEEDS = (9400, 9401)


def document_evidence_tasks() -> tuple[DocumentTask, ...]:
    """Return the fixed development requests; no expected answers are stored."""

    return (
        make_task(
            "task-current-contract",
            ("doc-aurora", "doc-boreal", "doc-cinder"),
            (("renewal_date", "date"), ("account_owner", "person"), ("annual_limit", "number")),
            seed=9300,
        ),
        make_task(
            "task-missing-support",
            ("doc-aurora", "doc-boreal", "doc-cinder"),
            (("support_contact", "email"), ("account_owner", "person"), ("annual_limit", "number")),
            seed=9301,
        ),
        make_task(
            "task-conflict-history",
            ("doc-aurora", "doc-cinder"),
            (("alert_threshold", "ratio"), ("account_owner", "person")),
            seed=9302,
        ),
    )


def _task_request(task: DocumentTask) -> dict[str, Any]:
    return {
        "task_id": task.task_id,
        "document_handles": list(task.document_handles),
        "requested_fields": [
            {
                "field_id": field.field_id,
                "value_type": field.value_type,
                "revision_rule": field.revision_rule,
            }
            for field in task.requested_fields
        ],
        "action_budget": task.action_budget,
    }


def _bundle_identity(store: DocumentBundleStore) -> dict[str, Any]:
    documents = []
    for handle in store.document_handles:
        entry = store.manifest_entry(handle)
        document = store.open_document(handle)
        documents.append({
            "handle": handle,
            "document_id": entry["document_id"],
            "sha256": entry["sha256"],
            "template_family": document["template_family"],
            "layout_id": document["layout_id"],
            "version": document["version"],
            "section_count": len(document["sections"]),
        })
    return {
        "bundle_id": store.bundle_id,
        "manifest_schema": "vevo.v03.document-evidence.bundle-manifest.v1",
        "documents": documents,
    }


def _scope_manifest(store: DocumentBundleStore, handles: tuple[str, ...], *, scope: str) -> dict[str, Any]:
    documents = []
    for handle in handles:
        document = store.open_document(handle)
        entry = store.manifest_entry(handle)
        documents.append({
            "handle": handle,
            "document_id": entry["document_id"],
            "template_family": document["template_family"],
            "layout_id": document["layout_id"],
            "sha256": entry["sha256"],
        })
    return {
        "manifest_id": f"document-evidence-{scope}-manifest-v1",
        "scope": scope,
        "document_handles": list(handles),
        "document_count": len(handles),
        "template_family_count": len({document["template_family"] for document in documents}),
        "template_families": sorted({document["template_family"] for document in documents}),
        "layout_ids": sorted({document["layout_id"] for document in documents}),
        "documents": documents,
    }


def build_benchmark_preregistration(store: DocumentBundleStore | None = None) -> dict[str, Any]:
    """Build the review artifact without materializing labels or predictions."""

    bundle = store or DocumentBundleStore.from_bundled()
    bundle.verify_integrity()
    tasks = document_evidence_tasks()
    return {
        "schema": PREREG_SCHEMA,
        "status": PREREG_STATUS,
        "created_for_branch": "experiments/vevo-agents-document-evidence-2026-10-18",
        "training_started": False,
        "evaluation_started": False,
        "model_available": False,
        "model_status": {
            "available": False,
            "reason": "requires new document encoder, training, and reviewed checkpoint",
            "existing_v03_gate_checkpoint_reused": False,
            "gate_outputs_mapped_to_document_actions": False,
        },
        "bundle": _bundle_identity(bundle),
        "frozen_split": {
            "whole_document_and_template_family_separation": True,
            "no_instance_overlap": True,
            "randomized_candidate_order": {
                "status": "implemented",
                "scope": "seeded_observed_candidates_within_an_episode",
            },
            "randomized_document_ids": {
                "status": "planned",
                "claim": "future held-out generator only; fixed server handles remain in this proof",
            },
            "randomized_catalog_order": {
                "status": "planned",
                "claim": "future held-out generator only; current manifests preserve declared order",
            },
            "unseen_instances_layouts_conflicts": {
                "status": "planned",
                "claim": "not proven because no held-out outcomes are materialized",
            },
            "train": {
                **_scope_manifest(bundle, TRAIN_DOCUMENT_HANDLES, scope="train"),
                "case_count": 0,
                "generator": "future-public-or-synthetic-document-generator-v1",
            },
            "development": {
                **_scope_manifest(bundle, DEVELOPMENT_DOCUMENT_HANDLES, scope="development"),
                "case_count": len(DEVELOPMENT_CASE_SEEDS),
                "case_seeds": list(DEVELOPMENT_CASE_SEEDS),
                "generator": "fixed-manifest-request-v1",
            },
            "test": {
                **_scope_manifest(bundle, TEST_DOCUMENT_HANDLES, scope="test"),
                "case_count": len(TEST_CASE_SEEDS),
                "case_seeds": list(TEST_CASE_SEEDS),
                "generator": "unseen-layout-conflict-generator-v1",
                "outcomes_materialized": False,
            },
        },
        "case_generation": {
            "schema": "vevo.v03.document-evidence.case-generator.v1",
            "minimum_documents_per_case": 2,
            "maximum_documents_per_case": 6,
            "maximum_sections_per_document": 4,
            "requested_field_count": {"minimum": 2, "maximum": 3},
            "action_budget": 16,
            "development_cases_are_protocol_cases_not_generalization": True,
            "held_out_test_outcomes_are_not_inspected": True,
        },
        "development_cases": [_task_request(task) for task in tasks],
        "metrics": [
            "source_citation_accuracy",
            "verified_success",
            "false_completions",
            "tool_calls",
            "missing_fact_detection",
            "restart_parity",
        ],
        "cost_accounting": {
            "inference": ["policy_steps", "model_forward_calls"],
            "end_to_end": ["action_calls", "server_verification_calls", "wall_time_seconds", "latency_seconds", "monetary_cost"],
            "separate_inference_and_end_to_end_costs": True,
        },
        "selection_rule": {
            "scope": "development_only",
            "primary_metric": "verified_success",
            "minimum_thresholds": {
                "source_citation_accuracy": 1.0,
                "false_completion_rate": 0.0,
                "missing_fact_detection": 1.0,
                "restart_parity": 1.0,
            },
            "tie_breakers": ["false_completion_rate", "action_calls", "end_to_end_latency_seconds"],
            "model_selection_status": "not_run_model_unavailable",
        },
        "document_policy_interface": {
            "backend": "v03-five-brain-addressable-memory-interface",
            "peripheral_count": 4,
            "central_count": 1,
            "memory_shape": [2, 6],
            "variable_candidate_scorer": True,
            "new_encoder_required": True,
            "new_training_required": True,
        },
        "jev_comparator": {
            "interface": "jev-document-evidence-v1",
            "eligibility": "unverified",
            "eligibility_reason": "no authorized Jev version or interface has been verified in this branch",
            "same_typed_tasks": True,
            "same_evidence_store": True,
            "same_action_budget": True,
            "same_initial_request": True,
            "same_observations": True,
            "same_legal_actions": True,
            "same_feedback": True,
            "same_history_access": True,
            "adapters": {"task": "typed-task-v1", "evidence": "verified-evidence-packet-v1", "policy": "document-policy-v1"},
            "tuning_split": "development_only",
            "data_policy": "public_or_synthetic_only",
            "retries": 0,
            "timeouts": {"per_case_seconds": 30, "per_action_seconds": 2},
            "latency_cost_accounting": {"inference": True, "end_to_end": True, "monetary_cost": True},
            "live_calls": False,
            "credentials": False,
            "invented_results": False,
            "results": None,
        },
        "prohibitions": {
            "training": True,
            "evaluation_sweep": True,
            "live_external_calls": True,
            "credentials": True,
            "deployment": True,
            "reuse_existing_gate_weights_as_document_policy": True,
        },
    }


def render_preregistration_markdown(spec: Mapping[str, Any]) -> str:
    """Render a concise review artifact without answer labels or predictions."""

    bundle = spec["bundle"]
    split = spec["frozen_split"]
    lines = [
        "# v0.3 Document-Evidence Benchmark Preregistration",
        "",
        f"Status: **{spec['status']}**",
        "",
        "This artifact freezes the bounded first-real-task protocol before any document-policy training or evaluation. The current neural model is explicitly unavailable; deterministic baselines and verifier tests are the only executable decisions in this branch.",
        "",
        "## Scope",
        "",
        f"- Bundle: `{bundle['bundle_id']}` ({len(bundle['documents'])} manifest-addressed documents).",
        "- Each task uses 2–6 documents, at most four sections per document, 2–3 requested fields, and a 16-action budget.",
        "- Candidate observations contain typed values and provenance but do not reinsert requested-field labels or hidden answers.",
        "- Completion requires exact source digests, explicit candidate selection, and the `latest_non_obsolete` rule; missing claims require complete section exploration.",
        "",
        "## Frozen split",
        "",
        f"- Whole-document/template-family separation: `{split['whole_document_and_template_family_separation']}`.",
        f"- No instance overlap: `{split['no_instance_overlap']}`; seeded candidate order is implemented, while randomized IDs/catalog order are planned for a future generator.",
        f"- Development manifest: `{split['development']['manifest_id']}` with {split['development']['document_count']} documents and {split['development']['case_count']} cases.",
        f"- Held-out test manifest: `{split['test']['manifest_id']}` with {split['test']['document_count']} documents and {split['test']['case_count']} unmaterialized cases.",
        "- The checked-in 9300–9302 cases are development protocol cases, not fresh generalization evidence; held-out outcomes are not inspected.",
        "",
        "## Metrics and accounting",
        "",
        "- Metrics: source-citation accuracy, verified success, false completions, tool calls, missing-fact detection, and restart parity.",
        "- Inference costs (policy steps and model forward calls) remain separate from end-to-end action/server/wall-time costs.",
        "- The Jev comparator is unverified and interface-only: public/synthetic data, fixed adapters, zero retries, declared timeouts, no live calls, credentials, or invented results.",
        "",
        "## Model gate",
        "",
        "- New document encoders, training, and a reviewed checkpoint are required.",
        "- The existing four gate outputs are not mapped to document actions, and existing gate weights are not reused.",
        "- Training and evaluation remain blocked pending source review.",
        "",
    ]
    return "\n".join(lines)


__all__ = [
    "MARKDOWN_REPORT_RELATIVE_PATH",
    "PREREG_SCHEMA",
    "PREREG_STATUS",
    "STATIC_PREREG_RELATIVE_PATH",
    "build_benchmark_preregistration",
    "document_evidence_tasks",
    "render_preregistration_markdown",
]
