# Vevo Agents — five-brain local proof

Vevo Agents is a separate user-owned research project. It is not a replacement
for, fork of, or deployment of the existing Vivo/Site work.

The first slice is deliberately narrow: a delayed-cue resonant-gate simulator
with four recurrent peripheral brains, one structurally different recurrent
central brain, differentiable addressable neural memory, one bounded typed
diagnostic tool, and an exact note/graph workspace carried by the same
checkpointable SIMFABRIC state. The exact workspace is backed by native
SQLite/FTS5 when available; no larger notes application is imported.

The architecture is frozen and reviewable in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The implementation is a
clearly labelled reconstruction of the recovered field coupling, not a claim
that the old FieldLab or NeuralEdgeLaw already constituted unified
intelligence. Provenance and limits are in
[`docs/PROVENANCE.md`](docs/PROVENANCE.md).

The additive interactive v0.2 architecture is in
[`docs/ARCHITECTURE_V02.md`](docs/ARCHITECTURE_V02.md). It runs the same
field/note/diagnostic/actuation loop during training and held-out evaluation;
the preserved evidence is `reports/imported/v02-proof-report.json`.

The corrected, not-yet-trained v0.3 protocol is in
[`docs/ARCHITECTURE_V03_CORRECTED.md`](docs/ARCHITECTURE_V03_CORRECTED.md).
It supersedes v0.2's integrated-proof claim while preserving v0.2's original
result: diagnostics are pure continuous measurements and runtime gate opening
comes only from integrated physical position/energy thresholds. Its field/gate
coupling is derived from one shared energy, virtual cloned-probe cost is
budgeted separately, and the actuator requires an explicit neural drive
frequency argument. The evaluator requires the opened gate to match the
note's requested physical resonance; runtime actuation remains goal-blind.
Signed external work is separate from positive supplied-work budgets, and the
policy observation whitelist excludes seed/resonance/checkpoint internals.

## Preserved repository run guide

Run these commands from `experiments/vevo-agents` in the repository root.
The commands below do not start training:

```sh
PYTHONPATH=src python -m unittest discover -s tests -v
PYTHONPATH=src python -m unittest tests.test_v03_protocol -v
```

The v0.1 and v0.2 proof commands below are optional reproduction commands and
perform their recorded optimization work; do not run them against a user's
active computer or treat them as acceptance of the preserved results:

```sh
PYTHONPATH=src python -m vevo_agents.proof --output reports/generated/v01-proof-report.json
PYTHONPATH=src python -c 'from vevo_agents.v02_proof import run_proof; run_proof(output_path="reports/generated/v02-proof-report.json")'
```

The project uses Python 3.11+ and NumPy. It does not open a server or require
credentials, a paid service, a network, or a live external action.

## v0.3 neural milestone

The v0.3 neural experiment contract is in
[`docs/EXPERIMENT_CONTRACT_V03_NEURAL.md`](docs/EXPERIMENT_CONTRACT_V03_NEURAL.md).
Its source is `src/vevo_agents/v03_model.py` and its bounded runner is
`src/vevo_agents/v03_neural_proof.py`. The report and selected checkpoints
are stored under `reports/generated/` and `storage/checkpoints/` respectively.
Run the declared experiment with:

```sh
PYTHONPATH=src python -m vevo_agents.v03_neural_proof \
  --output reports/generated/v03-neural-proof-report.json
```

The recorded run is a weak negative result (2/48 held-out successes for the
full model versus 1/48 for the matched control); see the report and progress
log for raw outcomes and the next hypothesis.

## v0.3 neural read-path repair

The bounded repair contract is in
[`docs/EXPERIMENT_CONTRACT_V03_NEURAL_REPAIR.md`](docs/EXPERIMENT_CONTRACT_V03_NEURAL_REPAIR.md),
with source in `src/vevo_agents/v03_neural_repair.py`. It repairs the unused
full-model content read, matches numeric/autograd memory semantics, and runs a
training-only two-world × four-goal microset. The recorded run used 1,000
updates per trial and four seeds; both selected models reached 8/8 training
physical successes, but no holdout or generalization claim is made. The
end-to-end audit and exact failure/ablation outcomes are in
`reports/generated/v03-neural-repair-report.json`.

Post-publication source-only corrections, including the retention confound,
are recorded in
[`docs/V03_NEURAL_REPAIR_POST_REVIEW.md`](docs/V03_NEURAL_REPAIR_POST_REVIEW.md).
They do not alter or retrain the preserved report/checkpoints.

Run the bounded repair only when explicitly reproducing its bounded experiment:

```sh
PYTHONPATH=src python -m vevo_agents.v03_neural_repair \
  --output reports/generated/v03-neural-repair-report.json \
  --wall-clock-cap 300
```

## Local storage and backup

The exact user-owned SQLite workspace path for this preserved copy is
`experiments/vevo-agents/storage/notes.sqlite3` when passed explicitly as
`NoteWorkspace("storage/notes.sqlite3")` from this directory. The current
proof episodes default to `:memory:` and therefore do not silently create this
file. Checkpoints belong in
`experiments/vevo-agents/storage/checkpoints/`; generated reports belong in
`experiments/vevo-agents/reports/generated/`, while imported historical reports
remain under `reports/imported/`.

Back up the mutable local state from the repository root with:

```sh
tar -C experiments/vevo-agents -czf /tmp/vevo-agents-storage-backup.tgz storage
```

The preservation bundle is source/report archival work, not a claim that the
experimental result is accepted or production-ready. See
[`docs/REPOSITORY_PRESERVATION.md`](docs/REPOSITORY_PRESERVATION.md) for the
copy manifest and provenance.

## State boundary

Exact documents, links, event history, world state, tool results, RNG/tick /
budget counters, and training metadata are durable authoritative state.
Peripheral hidden states, central hidden state, neural memory slots, and model
weights are learned/recurrent representations. A weight is not a document,
source file, universal program, or substitute for exact history.
