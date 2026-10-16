# Preregistration: delayed-memory shared response scale

Status: `awaiting_review_before_retraining`. No trial has been run and no
historical checkpoint has been loaded with the new normalization.

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
  each (8 examples). Held-out worlds `9300–9307` are evaluation-only.
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

## Predeclared artifacts and review gates

The future run must write only these new artifacts:

- `reports/generated/v03-neural-delayed-shared-response-scale-report.json`
- `reports/generated/v03-neural-delayed-shared-response-scale-report.md`
- `storage/checkpoints/v03-neural-delayed-shared-response-scale-full-seed-{107,117}.json`
- `storage/checkpoints/v03-neural-delayed-shared-response-scale-control-seed-{141,143}.json`

The future report must include per-seed train/held-out gate, frequency, joint,
physical success, loss, and per-case success-set overlap. Held-out outcomes may
not select checkpoints, tune hyperparameters, or trigger retries. Historical
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
