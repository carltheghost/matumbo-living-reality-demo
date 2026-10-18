"""Frozen preregistration and comparator contract for document evidence.

The preregistration is source-only.  It records the split, task requests,
metrics, costs, and a future Jev comparator interface without running a model,
training, evaluation sweep, live calls, or credentialed actions.
"""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
from typing import Any, Mapping, Sequence

from .v03_document_evidence import DocumentBundleStore, DocumentTask, make_task


PREREG_SCHEMA = "vevo.v03.document-evidence-benchmark-preregistration.v1"
PREREG_STATUS = "awaiting_document_policy_review_before_training"
STATIC_PREREG_RELATIVE_PATH = Path("reports/generated/v03-document-evidence-benchmark-preregistration.json")
MARKDOWN_REPORT_RELATIVE_PATH = Path("docs/V03_DOCUMENT_EVIDENCE_BENCHMARK_PREREGISTRATION.md")


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
            ("doc-aurora", "doc-boreal", "doc-cinder"),
            (("renewal_date", "date"), ("annual_limit", "number")),
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
            "randomized_document_ids": True,
            "randomized_candidate_order": True,
            "unseen_instances_layouts_conflicts": True,
            "train": {
                "template_families": ["reserved-document-training-family-not-yet-admitted"],
                "document_handles": [],
            },
            "development": {
                "template_families": ["supplier-agreement", "operations-handbook"],
                "document_handles": ["doc-aurora", "doc-boreal", "doc-cinder"],
                "case_seeds": [9300, 9301, 9302],
            },
            "test": {
                "template_families": ["legacy-appendix"],
                "document_handles": ["doc-delta"],
                "case_seeds": [],
            },
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
            "end_to_end": ["action_calls", "server_verification_calls", "wall_time_seconds"],
            "separate_inference_and_end_to_end_costs": True,
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
            "interface": "typed-task-evidence-packet-budget-comparator-v1",
            "same_typed_tasks": True,
            "same_evidence_store": True,
            "same_action_budget": True,
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
        f"- No instance overlap: `{split['no_instance_overlap']}`; document IDs and candidate order are randomized.",
        f"- Development families: `{', '.join(split['development']['template_families'])}`.",
        f"- Held-out test family: `{', '.join(split['test']['template_families'])}`.",
        "- The checked-in cases are development protocol cases, not fresh generalization evidence.",
        "",
        "## Metrics and accounting",
        "",
        "- Metrics: source-citation accuracy, verified success, false completions, tool calls, missing-fact detection, and restart parity.",
        "- Inference costs (policy steps and model forward calls) remain separate from end-to-end action/server/wall-time costs.",
        "- The Jev comparator is an interface only: no live calls, credentials, or invented results.",
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
