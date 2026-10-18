# v0.3 Document-Evidence Benchmark Preregistration

Status: **awaiting_document_policy_review_before_training**

This artifact freezes the bounded first-real-task protocol before any
document-policy training or evaluation. The current neural model is
explicitly unavailable; deterministic baselines and verifier tests are the
only executable decisions in this branch.

## Frozen split

- Whole document and template families are separated.
- No instance overlap is permitted; document IDs and candidate order are
  randomized.
- Development families are `supplier-agreement` and `operations-handbook`.
- `legacy-appendix` is held out for future test work.
- Checked-in seeds 9300–9302 are development protocol cases, not fresh
  generalization evidence.

## Metrics and gate

The preregistered metrics are source-citation accuracy, verified success,
false completions, tool calls, missing-fact detection, and restart parity.
Inference costs are recorded separately from end-to-end action, server, and
wall-time costs. A new document encoder, training run, and reviewed checkpoint
are required. Existing gate weights and gate outputs are not used as document
actions.

The Jev comparator is an interface only: this branch performs no live calls,
uses no credentials, and contains no invented results. Training and evaluation
remain blocked pending source review.
