# v0.3 Document-Evidence Benchmark Preregistration

Status: **awaiting_document_policy_review_before_training**

This artifact freezes the bounded first-real-task protocol before any
document-policy training or evaluation. The current neural model is
explicitly unavailable; deterministic baselines and verifier tests are the
only executable decisions in this branch.

## Split status and feasible first-model scope

- This is **not yet a frozen evaluation split**: development protocol fixtures
  exist, but the training generator and held-out task manifest are pending
  implementation.
- Whole document and template families are specified as separate.
- No instance overlap is permitted. Seeded candidate order is implemented;
  randomized document IDs and catalog order are planned for a future held-out
  generator.
- The development protocol manifest has three documents and three cases. The
  train scope has one reserved `training-contract` document but no materialized
  cases. The held-out `legacy-appendix` scope has two reserved documents and two
  proposed seeds, with no materialized task outcomes.
- Checked-in seeds 9300–9302 are development protocol cases, not fresh
  generalization evidence; held-out outcomes are not inspected.

For the first model task only, exhaustive inspection is bounded to at most two
documents, four sections per document, two requested fields, and four selected
candidates. The worst case is 8 inspect + 4 select + 1 completion/verifier = 13
policy actions within the 16-action budget. The full six-document maximum would
require 29 policy actions and is not used for first-model training. A legitimate
coverage-index variant is deferred until explicitly implemented.

## Metrics and gate

The preregistered metrics are source-citation accuracy, verified success,
false completions, tool calls, missing-fact detection, and restart parity.
Inference costs are recorded separately from end-to-end action, server, and
wall-time costs. A new document encoder, training run, and reviewed checkpoint
are required. Existing gate weights and gate outputs are not used as document
actions.

The Jev comparator is unverified and interface-only. It requires identical
initial requests, observations, legal actions, feedback, and history access,
public or synthetic data, fixed adapters, development-only tuning, zero
retries, and declared timeouts. This branch performs no live calls, uses no
credentials, and contains no invented results. Training and evaluation remain
blocked pending source review.
