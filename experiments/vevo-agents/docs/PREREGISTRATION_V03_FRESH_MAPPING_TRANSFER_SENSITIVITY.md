# v0.3 inspected-case fresh-mapping transfer sensitivity preregistration

Status: `awaiting_independent_review_before_sensitivity_evaluation`

This is a source-only, inference-only robustness design over the 16 cases that
have now been inspected by the completed frozen mapping-transfer evaluation.
It is not a fresh-mapping or generalization study. No variant outcome is
loaded or executed while writing this record.

The machine-readable preregistration is
`reports/generated/v03-neural-fresh-mapping-transfer-sensitivity-preregistration.json`.
It is sealed to source commit `4d99c285286a668c3dacbe51fa68ac3c877f620a` and
file SHA-256
`90e9d06290b9f249e2e93240327e01b79b5cc2613854c8d12550a479e64d175b`.

## Frozen baseline and cases

The completed baseline is frozen by the following identities:

- baseline evaluation: `reports/generated/v03-neural-fresh-mapping-transfer-evaluation.json`
- baseline report SHA-256: `960d39ed8e13b0713509f7829b186b980ebfe1c989ca6ee4fa33bb83d77f97e4`
- baseline source SHA: `19f317e19de203dd0bb1142c4a347ac30e183332`
- case manifest SHA-256: `1ef809905ca01b7c4da6f30939bdf290e9c2c9538ca5297389f9fca6d1f96f63`
- world manifest SHA-256: `b0299c47bc109b4ad2bfdb9c527d4233ca532a362b3f9bf5cebee2d5a9fbb73f`

The same four worlds and four goals are used in every arm:

| exposure partition | worlds | mapping | cases | interpretation |
|---|---|---|---:|---|
| U mapping, now inspected | `20049, 20050` | `(3,2,0,1)` | 8 | robustness only; no longer fresh evidence |
| counterfactually exposed mapping, now inspected | `20021, 20023` | `(1,2,3,0)` | 8 | robustness only; not U evidence |

The conservative mapping-provenance caveat from the baseline preregistration
remains in force: the prior exclusion union is not an exact physical exposure
census.

## Fixed arms

The current delayed protocol has exactly two hidden goal-independent delay
observations after the one shown note and before the spectrum/action
observation. The delay count below is total hidden delay observations, not an
additional count:

| arm | hidden delay steps | relative to current two | note format |
|---|---:|---:|---|
| `baseline_existing_delay` | 2 | 0 | original `delayed-train` note |
| `hidden_delay_4` | 4 | +2 | original `delayed-train` note |
| `hidden_delay_8` | 8 | +6 | original `delayed-train` note |
| `note_format_variant_baseline_delay` | 2 | 0 | fixed field-reordered semantic equivalent |

The note-format variant is exactly:

```text
target_hz={goal_frequency:.2f}; rule=max-response-at-target; target_phase=0.00; variant=delayed-train
```

It changes field order only. It preserves target frequency, target phase,
selection rule, and variant meaning. There are no wording sweeps, delay
sweeps, tuning choices, retries, or outcome-based substitutions.

All arms use the same `CorrectedEpisode`, probe frequencies, four goals,
resonance metadata, actuation, work/physics/tool/virtual budgets, four frozen
candidate checkpoints, and exact train-only checkpoint normalization. No
normalization is fitted during sensitivity inference.

The design has `16 × 4 checkpoints × 4 arms = 256` primary inference
evaluations. The baseline arm must first replay the completed baseline actions
and probabilities exactly for all 64 case/checkpoint pairs. Any mismatch stops
the run before the three variant arms.

## Reporting and stopping

Every arm reports gate, frequency, joint, physical-success, and loss metrics
per checkpoint, world, mapping, and exposure partition. The two eight-case
partitions remain separate and are explicitly labelled as now-inspected
robustness cases. Results are never pooled into a fresh-mapping claim.

The runner uses one CPU process, a 300-second wall-clock cap, and a 512 MiB
additional-memory threshold. It checks the budget before every arm, case, and
checkpoint evaluation, between arms, between derived-metric stages, and before
marking the report complete. Completed arm/case/checkpoint prefixes and the
baseline replay prefix are retained on failure or cap; no later metrics are
computed after exhaustion.

## Minimal local-only demo outline

After sensitivity review, an accepted frozen candidate policy may be shown in
a minimal local `CorrectedEpisode` demo under the exact reviewed note, delay,
measurement, action, and resource contract. The demo would use only the
existing policy-observation whitelist and the bounded local resonance
diagnostic. It would not fit, adapt, mutate checkpoints, add tools, access
credentials, perform external actions, or present a general agent. This is an
outline only; it is not executed by this preregistration.

No PC training, paid resources, merge, deploy, or PR action is part of this
stage.
