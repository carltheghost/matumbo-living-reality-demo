# v0.3 Document-Evidence Benchmark Preregistration

Status: **awaiting_document_policy_review_before_training**

This artifact freezes the bounded first-real-task protocol before any document-policy training or evaluation. The current neural model is explicitly unavailable; deterministic baselines and verifier tests are the only executable decisions in this branch.

## Scope

- Bundle: `document-evidence-fixture-bundle-2026-10-18` (6 manifest-addressed documents).
- Each task uses 2–6 documents, at most four sections per document, 2–3 requested fields, and a 16-action budget.
- Candidate observations contain typed values and provenance but do not reinsert requested-field labels or hidden answers.
- Completion requires exact source digests, explicit candidate selection, and the `latest_non_obsolete` rule; missing claims require complete section exploration.

## Split status and feasible first-model scope

- Split status: **partial_scope_pending_generators**; this is not a frozen evaluation split because the train and held-out task generators/manifests are still pending.
- Whole-document/template-family separation is specified as `True`.
- No instance overlap: `True`; seeded candidate order is implemented, while randomized IDs/catalog order are planned for a future generator.
- Development protocol manifest: `document-evidence-development-manifest-v1` with 3 documents and 3 checked-in cases.
- Train task generator status: `pending_implementation`; no empty train case set is presented as frozen evaluation.
- Held-out task manifest status: `pending_implementation`; 2 proposed seeds have no materialized (unmaterialized) outcomes.
- The checked-in 9300–9302 cases are inspected development protocol cases, not fresh generalization evidence; held-out outcomes are not inspected.
- First-model feasible scope: at most two documents, four sections each, two requested fields, and four selected candidates. Worst case is 1 catalog read + 8 inspections + 4 selections + 2 explicit dispositions + 1 completion/verifier action = 16 policy actions; a coverage-index variant is deferred.
- The general 6-document/4-section protocol maximum would require 33 policy actions (including one explicit disposition per requested field) in the exhaustive baseline and is not used for first-model training.
- Scenario and layout families are separated before any trace generation; deterministic development seeds are recorded, while train/held-out outcomes remain unmaterialized.

## Metrics and accounting

- Metrics: source-citation accuracy, verified success, false completions, tool calls, missing-fact detection, and restart parity.
- Inference costs (policy steps and model forward calls) remain separate from end-to-end action/server/wall-time costs.
- The Jev comparator is unverified and interface-only: public/synthetic data, fixed adapters, zero retries, declared timeouts, no live calls, credentials, or invented results.

## Model gate

- New document encoders, training, and a reviewed checkpoint are required.
- The existing four gate outputs are not mapped to document actions, and existing gate weights are not reused.
- Training and evaluation remain blocked pending source review.
