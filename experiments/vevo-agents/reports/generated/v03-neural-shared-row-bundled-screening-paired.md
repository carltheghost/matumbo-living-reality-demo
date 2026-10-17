# v03 shared-row bundled screening: paired comparison

Candidate report: `reports/generated/v03-neural-shared-row-bundled-screening-report.json`
Candidate source: `d8a41bfe6e7e38d5319438f2c7171006b2349e51`
Primary baseline: `reports/generated/v03-neural-delayed-shared-response-scale-report.json` at artifact commit `c35c2e6729dc867b516de8229ddd99adb88bcc44` (legacy action head, shared response scale).

This is one preregistered four-trial screening comparison: fixed seeds 107, 117, 141, and 143; 1,000 updates per trial; unchanged optimizer/data; `shared_max_abs` normalization; `shared_row_scorer` gate head. Worlds 9300–9307 are explicitly inspected development cases, never fresh generalization evidence. The candidate is a bundled action-head/context redesign: it is not a pure single-factor causal comparison.

## Execution and preservation

- Status: `complete`; all four trials reached the existing 8/8 training gate.
- Wall-clock cap: `300.0` seconds; measured wall time: `82.990471483` seconds; CPU time: `82.838969823` seconds.
- Termination: normal; cap termination `false`; failures `0`.
- Checkpoint reload: passed for all four trials; exact serialized normalization and exact prediction parity passed for 8/8 training cases per trial.
- Historical reports/checkpoints: unchanged byte-for-byte; the c35c2e baseline report, Markdown summary, and four checkpoints matched their preregistered SHA-256 digests.

## Training metrics

| trial | candidate frequency | c35c2e frequency | candidate gate | c35c2e gate | candidate joint | c35c2e joint | candidate physical | c35c2e physical | candidate loss | c35c2e loss | loss delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| full-seed-107 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 8/8 | 8/8 | 0.004162522353 | 0.005912334066 | -0.001749811714 |
| full-seed-117 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 8/8 | 8/8 | 0.002819232026 | 0.005710272614 | -0.002891040588 |
| control-seed-141 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 8/8 | 8/8 | 0.005354843408 | 0.008390689688 | -0.003035846280 |
| control-seed-143 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 8/8 | 8/8 | 0.005358067620 | 0.008459357140 | -0.003101289520 |
| mean | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 8/8 | 8/8 | 0.004423666352 | 0.007118163377 | -0.002694497026 |

## Development metrics

| trial | candidate frequency | c35c2e frequency | candidate gate | c35c2e gate | candidate joint | c35c2e joint | candidate physical | c35c2e physical | candidate loss | c35c2e loss | loss delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| full-seed-107 | 1.0000 | 1.0000 | 1.0000 | 0.3125 | 1.0000 | 0.3125 | 32/32 | 10/32 | 0.004231325571 | 2.404613690079 | -2.400382364508 |
| full-seed-117 | 1.0000 | 1.0000 | 1.0000 | 0.3125 | 1.0000 | 0.3125 | 32/32 | 10/32 | 0.002856180620 | 2.706883348501 | -2.704027167881 |
| control-seed-141 | 1.0000 | 1.0000 | 1.0000 | 0.3125 | 1.0000 | 0.3125 | 32/32 | 10/32 | 0.005387155663 | 2.780423587232 | -2.775036431570 |
| control-seed-143 | 1.0000 | 1.0000 | 1.0000 | 0.3125 | 1.0000 | 0.3125 | 32/32 | 10/32 | 0.005393712040 | 3.005765052740 | -3.000371340700 |
| mean | 1.0000 | 1.0000 | 1.0000 | 0.3125 | 1.0000 | 0.3125 | 32/32 | 10/32 | 0.004467093473 | 2.724421419638 | -2.719954326165 |

## Paired development gains and losses

Each row pairs the same trial, world, and goal case with the c35c2e baseline. `Gain` means candidate true / baseline false; `loss` means candidate false / baseline true; `tie` means equal outcome.

| trial | gate gain/loss/tie | frequency gain/loss/tie | joint gain/loss/tie | physical gain/loss/tie |
|---|---:|---:|---:|---:|
| full-seed-107 | 22/0/10 | 0/0/32 | 22/0/10 | 22/0/10 |
| full-seed-117 | 22/0/10 | 0/0/32 | 22/0/10 | 22/0/10 |
| control-seed-141 | 22/0/10 | 0/0/32 | 22/0/10 | 22/0/10 |
| control-seed-143 | 22/0/10 | 0/0/32 | 22/0/10 | 22/0/10 |

These are paired outcomes on inspected development cases only. They do not establish fresh generalization, and they do not isolate a single-factor causal effect because both the shared action-head parameterization and the frequency-head retained-context input change together.
