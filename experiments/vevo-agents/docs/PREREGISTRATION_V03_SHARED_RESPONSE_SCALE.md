# Preregistration: delayed-memory shared response scale

Status: `awaiting_review_before_retraining`. No trial has been run and no
historical checkpoint has been loaded with the new normalization. The runner
must first reload each newly written candidate checkpoint, verify an exact
serialized normalization round-trip, and verify prediction parity before any
physical evaluation.

The machine-readable design is
`reports/generated/v03-neural-delayed-shared-response-scale-preregistration.json`.

## Question and hypothesis

Question: does replacing the legacy per-coordinate standardization of the 16
channel-response coordinates with one train-fitted positive max-absolute scalar
improve delayed gate/frequency action selection without out-of-distribution
response magnitudes?

Hypothesis: the shared scalar preserves every response-column ordering and
keeps the new-world response block on the scale learned from the two training
worlds. This is a normalization candidate, not a claim that physical success
or generalization is guaranteed.

## Fixed design

- Existing `V03FiveBrain` and `V03SingleRecurrentMemory` classes; no architecture,
  physics, evaluator, schedule, or action-boundary changes.
- Four trials: full seeds `107,117`; matched-control seeds `141,143`.
  Optimizer seed is `model_seed + 1000`.
- Five-step delayed schedule: before note, note shown once, two goal-independent
  delay steps, then spectrum/action. Training is worlds `9200,9201`, four goals
  each (8 examples). Worlds `9300–9307` are already-inspected development
  cases, evaluation-only, and never fresh generalization evidence.
- Existing balanced size-one minibatch Adam-style update, learning rate `0.012`,
  gradient clip norm `3.0`, exactly `1000` updates per trial, with metrics at
  `1,100,250,500,750,1000`.
- One single-process CPU run with a total 300-second wall-clock cap. Stop and
  report if the cap or any trial failure occurs; no restart or outcome-based
  retuning.

## Normalization rule

Fit only on present measurements from the eight training examples. Compute one
scalar `max(abs(response))` over all 16 response coordinates; the current
training-only fixture is `0.2555065496401963`. Divide every response coordinate
by that scalar. Do not subtract a response mean, fit per-coordinate scales, or
clip response values. Invalid/non-finite fit values are excluded and counted;
an all-invalid or all-zero fit has an explicit unit-scale fallback, while a
non-finite inference vector fails closed.

Note-byte and probe-frequency preprocessing remains the established masked
normalization. The saved v1 historical normalization remains supported exactly;
v2 normalization is serialized separately and must not be applied to old
weights.

## Existing training gate and runner review gates

Development evaluation is permitted only if all four fixed trials complete
within the cap and each reaches `8/8` ordinary delayed training physical
successes. This is the existing all-four-models `8/8` gate; it is not relaxed
by the response-scale candidate. A cap or failure stops the run for review and
the JSON/Markdown output must report the completed prefix and structured
failure without running later metrics.

Before evaluating a trial, the runner must reload its new candidate checkpoint,
require exact v2 normalization equality, and compare the reloaded prediction
trace to the in-memory prediction exactly. Training/development loss and
per-case success overlap with the preserved historical report must be present
in the output. The Markdown summary is a separate artifact, and the
9300–9307 rows must be labelled inspected development cases rather than a fresh
holdout or generalization claim.

## Predeclared artifacts and review gates

The future run must write only these new artifacts:

- `reports/generated/v03-neural-delayed-shared-response-scale-report.json`
- `reports/generated/v03-neural-delayed-shared-response-scale-report.md`
- `storage/checkpoints/v03-neural-delayed-shared-response-scale-full-seed-{107,117}.json`
- `storage/checkpoints/v03-neural-delayed-shared-response-scale-control-seed-{141,143}.json`

The future report must include per-seed train/development gate, frequency,
joint, physical success, development loss, and per-case historical success
overlap. Development outcomes may not select checkpoints, tune hyperparameters,
or trigger retries. Historical
reports/checkpoints must remain byte-for-byte unchanged. The future result must
be described as a separately retrained candidate, never as a repair of the
preserved weights.

After review, the exact bounded command is:

```sh
PYTHONPATH=src python -m vevo_agents.v03_delayed_memory \
  --output reports/generated/v03-neural-delayed-shared-response-scale-report.json \
  --wall-clock-cap 300 \
  --response-scaling shared_max_abs \
  --checkpoint-prefix v03-neural-delayed-shared-response-scale
```

This command is intentionally not being run in this task.
