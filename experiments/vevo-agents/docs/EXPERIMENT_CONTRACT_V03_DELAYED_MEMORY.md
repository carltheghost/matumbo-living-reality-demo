# v0.3 delayed-memory experiment contract

Status: pre-run contract for one bounded cloud execution. This experiment is
an RNN delayed-memory prerequisite for later EvoCell fast-plastic-neuron work;
it is not a claim that the current RNN is a complete EvoCell.

## Fixed design

- Keep the current `V03FiveBrain` and `V03SingleRecurrentMemory` architectures,
  physics, optimizer equations, learning rate, gradient clipping, and matched
  parameter comparison unchanged.
- Use the corrected five-observation delayed schedule for both training and
  evaluation: advance before the note, show the note once, advance through two
  goal-independent delay observations, then run the diagnostic and final
  spectrum/action observation. After the note is shown, its `text` and
  `content_digest` are empty in every delayed and final observation. The hidden
  observations must contain no `target_hz` marker, and their normalized note
  feature block must be neutral zero.
- Train exactly eight labeled examples: worlds `(9200, 9201)` × goals `0..3`.
  Fit normalization only from these five-step training observations.
- Run exactly two initialization seeds per architecture: full `(107, 117)`;
  matched control `(141, 143)`. The optimizer seed is initialization seed plus
  `1000`. Each trial has at most `1,000` balanced size-one Adam-style updates;
  no retuning, restart, or post-outcome seed replacement is permitted.
- Use one CPU process and a `300` elapsed-second cap for the complete run.
  Record process CPU time separately from wall time and report any cap
  termination honestly.

## Required evidence

For every seed, report full-training loss, gate/frequency/joint accuracy,
physical success, and gate/frequency action distributions. On the same eight
training identities, evaluate ordinary recall and slot-0, slot-1, both-slot,
recurrent-only, and all-retained-state erasures for both architectures.
Validate paired world/goal identity and report all four outcome transitions,
probability changes, action changes, and net success effect. Causal erasure
evidence is interpreted only when that model's ordinary delayed recall has at
least one success; slot memory and recurrent state remain separate scopes.

Include untrained-policy and oracle-feasibility references, kept separate from
learned inference. Do not infer that five components are better merely from
their count.

If and only if all four trials complete within the cap and achieve `8/8`
ordinary delayed training success, evaluate once on the fixed inspected
development cases `(9300, 9301, 9302, 9303, 9304, 9305, 9306, 9307)` × goals
`0..3`. These worlds have already been inspected by preserved diagnostics; they
are never fresh generalization evidence. They are disjoint from prior recorded
v0.3 worlds `6300..6311`, `7100, 7101, 8300, 8301`; they are fixed before
execution and are never used for normalization, gradients, hyperparameters, or
checkpoint selection. Report world-clustered development limitations and
per-case overlap with the preserved historical delayed-memory success sets. If
the microset fails, stop at the declared diagnosis and do not expand compute or
change heads.

## Artifacts and boundaries

Write only new artifacts:

- `reports/generated/v03-neural-delayed-memory-report.json`
- `storage/checkpoints/v03-neural-delayed-memory-full-seed-107.json`
- `storage/checkpoints/v03-neural-delayed-memory-full-seed-117.json`
- `storage/checkpoints/v03-neural-delayed-memory-control-seed-141.json`
- `storage/checkpoints/v03-neural-delayed-memory-control-seed-143.json`

The historical reports and checkpoints remain unchanged. Exact optimizer resume
is unverified. No production, deployment, paid compute, credentials,
user-PC access, merge, or PR route is in scope.

Planned command:

```sh
PYTHONPATH=src python -m vevo_agents.v03_delayed_memory \
  --output reports/generated/v03-neural-delayed-memory-report.json \
  --wall-clock-cap 300
```
