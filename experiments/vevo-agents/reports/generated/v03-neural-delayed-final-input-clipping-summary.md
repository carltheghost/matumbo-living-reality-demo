# Delayed-memory final-input clipping comparison

Status: `complete`  
Source commit at run: `433243f87160e8fc4e6277bcfea9dec7fe6491fa`  
Full evidence: `reports/generated/v03-neural-delayed-final-input-clipping-report.json`  

This is one frozen-weight, evaluation-only comparison. The baseline uses the saved normalized final input; the comparison clips only the 16 normalized channel-response coordinates to `[-3,+3]` at the final neural update. The four checkpoints, raw measurements, physics, schedule, normalization, and weights are shared. There was no training.

## Design and integrity

- Evaluations: `320/320`; CPU cap `300s`; additional-memory cap `524288 KB`.
- Baseline replay against prior factorial: `True`.
- Frozen model state unchanged: `True`.
- Historical reports/checkpoints byte-for-byte unchanged: `True`.
- Independent resonance reference checks: `True`; spectrum argmax agreed on `320/320` checks.

## Gate/frequency/joint/physical outcomes

| world set | checkpoint | condition | gate | frequency | joint | physical |
|---|---|---:|---:|---:|---:|---:|
| training_worlds_original_format | full-seed-107 | baseline | 100.00% | 100.00% | 100.00% | 8/8 |
| training_worlds_original_format | full-seed-107 | clip_response | 100.00% | 100.00% | 100.00% | 8/8 |
| training_worlds_original_format | full-seed-117 | baseline | 100.00% | 100.00% | 100.00% | 8/8 |
| training_worlds_original_format | full-seed-117 | clip_response | 100.00% | 100.00% | 100.00% | 8/8 |
| training_worlds_original_format | control-seed-141 | baseline | 100.00% | 100.00% | 100.00% | 8/8 |
| training_worlds_original_format | control-seed-141 | clip_response | 100.00% | 100.00% | 100.00% | 8/8 |
| training_worlds_original_format | control-seed-143 | baseline | 100.00% | 100.00% | 100.00% | 8/8 |
| training_worlds_original_format | control-seed-143 | clip_response | 100.00% | 100.00% | 100.00% | 8/8 |
| new_worlds_original_format | full-seed-107 | baseline | 28.12% | 68.75% | 21.88% | 7/32 |
| new_worlds_original_format | full-seed-107 | clip_response | 31.25% | 100.00% | 31.25% | 10/32 |
| new_worlds_original_format | full-seed-117 | baseline | 25.00% | 78.12% | 21.88% | 7/32 |
| new_worlds_original_format | full-seed-117 | clip_response | 31.25% | 100.00% | 31.25% | 10/32 |
| new_worlds_original_format | control-seed-141 | baseline | 12.50% | 68.75% | 12.50% | 4/32 |
| new_worlds_original_format | control-seed-141 | clip_response | 31.25% | 100.00% | 31.25% | 10/32 |
| new_worlds_original_format | control-seed-143 | baseline | 21.88% | 81.25% | 21.88% | 7/32 |
| new_worlds_original_format | control-seed-143 | clip_response | 31.25% | 100.00% | 31.25% | 10/32 |

## Paired transitions and action changes

Each row below is paired by world seed, goal index, and note goal ID. The JSON contains every paired row, every success transition, and every changed action.

| world set | checkpoint | n | success transitions (S→S / S→F / F→S / F→F) | gate changes | frequency changes | probability changes | pre-final state identical |
|---|---|---:|---|---:|---:|---:|---:|
| training_worlds_original_format | full-seed-107 | 8 | 8 / 0 / 0 / 0 | 0 | 0 | 0 | True |
| training_worlds_original_format | full-seed-117 | 8 | 8 / 0 / 0 / 0 | 0 | 0 | 0 | True |
| training_worlds_original_format | control-seed-141 | 8 | 8 / 0 / 0 / 0 | 0 | 0 | 0 | True |
| training_worlds_original_format | control-seed-143 | 8 | 8 / 0 / 0 / 0 | 0 | 0 | 0 | True |
| new_worlds_original_format | full-seed-107 | 32 | 7 / 0 / 3 / 22 | 8 | 10 | 32 | True |
| new_worlds_original_format | full-seed-117 | 32 | 6 / 1 / 4 / 21 | 17 | 7 | 32 | True |
| new_worlds_original_format | control-seed-141 | 32 | 3 / 1 / 7 / 21 | 17 | 10 | 32 | True |
| new_worlds_original_format | control-seed-143 | 32 | 7 / 0 / 3 / 22 | 10 | 6 | 32 | True |

## Clipping and saturation audit

| world set | checkpoint | condition | changed response coordinates | below -3 | above +3 | at bound after | only declared coordinates |
|---|---|---:|---:|---:|---:|---:|---:|
| training_worlds_original_format | full-seed-107 | baseline | 0 | 0 | 0 | 0 | True |
| training_worlds_original_format | full-seed-107 | clip_response | 0 | 0 | 0 | 0 | True |
| training_worlds_original_format | full-seed-117 | baseline | 0 | 0 | 0 | 0 | True |
| training_worlds_original_format | full-seed-117 | clip_response | 0 | 0 | 0 | 0 | True |
| training_worlds_original_format | control-seed-141 | baseline | 0 | 0 | 0 | 0 | True |
| training_worlds_original_format | control-seed-141 | clip_response | 0 | 0 | 0 | 0 | True |
| training_worlds_original_format | control-seed-143 | baseline | 0 | 0 | 0 | 0 | True |
| training_worlds_original_format | control-seed-143 | clip_response | 0 | 0 | 0 | 0 | True |
| new_worlds_original_format | full-seed-107 | baseline | 0 | 76 | 68 | 144 | True |
| new_worlds_original_format | full-seed-107 | clip_response | 144 | 76 | 68 | 144 | True |
| new_worlds_original_format | full-seed-117 | baseline | 0 | 76 | 68 | 144 | True |
| new_worlds_original_format | full-seed-117 | clip_response | 144 | 76 | 68 | 144 | True |
| new_worlds_original_format | control-seed-141 | baseline | 0 | 76 | 68 | 144 | True |
| new_worlds_original_format | control-seed-141 | clip_response | 144 | 76 | 68 | 144 | True |
| new_worlds_original_format | control-seed-143 | baseline | 0 | 76 | 68 | 144 | True |
| new_worlds_original_format | control-seed-143 | clip_response | 144 | 76 | 68 | 144 | True |

The 16 clipped feature indices are `140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155`. Baseline and clipped pre-final neural states are required to match exactly; clipping is no-op on the original training worlds in this run.

## Prior factorial aggregates

The prior report is preserved byte-for-byte and its compact aggregates are copied into the full JSON. The original-format rows below are the baseline replay reference; the prior report also contains the held-out-format factorial cells.

| prior cell | checkpoint | gate | frequency before→after spectrum | joint | physical | normalized response range |
|---|---|---:|---:|---:|---:|---|
| new_worlds_heldout_format | control-seed-141 | 12.50% | 0.00% → 68.75% | 12.50% | 4/32 | -113..224 |
| new_worlds_heldout_format | control-seed-143 | 21.88% | 0.00% → 81.25% | 21.88% | 7/32 | -113..224 |
| new_worlds_heldout_format | full-seed-107 | 28.12% | 100.00% → 68.75% | 21.88% | 7/32 | -113..224 |
| new_worlds_heldout_format | full-seed-117 | 25.00% | 100.00% → 78.12% | 21.88% | 7/32 | -113..224 |
| new_worlds_original_format | control-seed-141 | 12.50% | 0.00% → 68.75% | 12.50% | 4/32 | -113..224 |
| new_worlds_original_format | control-seed-143 | 21.88% | 0.00% → 81.25% | 21.88% | 7/32 | -113..224 |
| new_worlds_original_format | full-seed-107 | 28.12% | 100.00% → 68.75% | 21.88% | 7/32 | -113..224 |
| new_worlds_original_format | full-seed-117 | 25.00% | 100.00% → 78.12% | 21.88% | 7/32 | -113..224 |
| training_worlds_heldout_format | control-seed-141 | 100.00% | 0.00% → 100.00% | 100.00% | 8/8 | -1..1 |
| training_worlds_heldout_format | control-seed-143 | 100.00% | 0.00% → 100.00% | 100.00% | 8/8 | -1..1 |
| training_worlds_heldout_format | full-seed-107 | 100.00% | 100.00% → 100.00% | 100.00% | 8/8 | -1..1 |
| training_worlds_heldout_format | full-seed-117 | 100.00% | 100.00% → 100.00% | 100.00% | 8/8 | -1..1 |
| training_worlds_original_format | control-seed-141 | 100.00% | 0.00% → 100.00% | 100.00% | 8/8 | -1..1 |
| training_worlds_original_format | control-seed-143 | 100.00% | 0.00% → 100.00% | 100.00% | 8/8 | -1..1 |
| training_worlds_original_format | full-seed-107 | 100.00% | 100.00% → 100.00% | 100.00% | 8/8 | -1..1 |
| training_worlds_original_format | full-seed-117 | 100.00% | 100.00% → 100.00% | 100.00% | 8/8 | -1..1 |

## Interpretation boundary

These are previously inspected training and development worlds only. Clipping is a lossy diagnostic intervention, not a proven production fix; the result must not be generalized beyond these inspected worlds or treated as evidence of a safe deployment change.
