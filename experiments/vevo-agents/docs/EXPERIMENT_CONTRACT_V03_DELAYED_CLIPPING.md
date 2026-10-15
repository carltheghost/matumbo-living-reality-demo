# v0.3 delayed-memory final-input clipping comparison

Status: bounded frozen-weight evaluation only. This contract does not alter
the historical factorial report, delayed-memory checkpoints, training code,
normalization statistics, or physics.

## Question and single intervention

The comparison asks whether the inspected delayed-memory outcomes change when
the final neural update receives a bounded version of the already-normalized
channel-response block. There is exactly one intervention:

- baseline: saved final normalized input;
- comparison: clip only the 16 normalized channel-response coordinates to
  `[-3,+3]` through the evaluation-only input hook on the final neural update.

The raw measurement, all other features, earlier recurrent updates, physical
episode, schedule, saved normalization, frozen weights, and four checkpoints
are identical within each pair. There is no threshold sweep, optimizer, GPU,
dependency, or new training.

## Fixed evaluation set and budget

The four delayed-memory checkpoints are evaluated on the original
`delayed-train` note format for training worlds `9200–9201` and the already
inspected development worlds `9300–9307`, across all four goal frequencies.
That is 40 world/goal inputs × 4 checkpoints × 2 conditions = exactly 320
evaluations. The run is single-process CPU-only, capped at 300 CPU seconds and
512 MiB additional resident memory.

## Required integrity checks

The runner must first replay every baseline row against the corresponding
original-format row in
`reports/generated/v03-neural-delayed-factorial-diagnostic-report.json`.
It must verify unchanged frozen state, exact paired pre-final neural states,
no differences outside the 16 declared coordinates, no-op clipping and
unchanged outputs on the training worlds, and byte-for-byte preservation of
all historical reports and checkpoints.

The physical reference is independent of policy inputs and measured-spectrum
argmax: it is the unique authoritative gate resonance matching the note target
frequency. `oracle_action()` is not part of diagnostic preparation. The report
also records every spectrum/reference agreement or disagreement.

## Interpretation boundary

The report must include gate, frequency, joint, and physical outcomes; all
paired success transitions; changed actions; before/after frequency
probabilities; clipping and recurrent saturation; the 16 coordinates; and
independent reference checks. The results apply only to these previously
inspected worlds. Clipping is lossy and is not a proven production fix.

Run from this directory with:

```sh
PYTHONPATH=src python -m vevo_agents.v03_delayed_factorial_diagnostic \
  --output reports/generated/v03-neural-delayed-final-input-clipping-report.json \
  --cpu-time-cap 300
```

The command writes the full evidence report and the adjacent compact
`v03-neural-delayed-final-input-clipping-summary.md` summary, and refuses to
overwrite either file or any historical artifact.
