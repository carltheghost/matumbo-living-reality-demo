# Delayed-memory shared-response-scale candidate

Status: `complete`  
Source commit: `2d35c0b32c5fb844c94b3909506dbf361d0bc521`  
JSON report: `reports/generated/v03-neural-delayed-shared-response-scale-report.json`  

This artifact is a bounded, separately retrained candidate. It does not rewrite or replace the historical v1 report/checkpoints.

## Evaluation gate and scope

- Existing gate: all four models must complete within budget and each must reach 8/8 delayed training physical successes before any development-case evaluation (`True`).
- Development worlds: `9300, 9301, 9302, 9303, 9304, 9305, 9306, 9307`; these are previously inspected development cases, never fresh generalization evidence.
- Checkpoint reload/parity gate: `passed`.
- Historical artifacts unchanged byte-for-byte: `True`.

## Training results

| trial | status | updates | train loss | gate | frequency | joint | physical |
|---|---|---:|---:|---:|---:|---:|---:|
| full-seed-107 | trained | 1000 | 0.005912 | 1.000000 | 1.000000 | 1.000000 | 8/8 |
| full-seed-117 | trained | 1000 | 0.005710 | 1.000000 | 1.000000 | 1.000000 | 8/8 |
| control-seed-141 | trained | 1000 | 0.008391 | 1.000000 | 1.000000 | 1.000000 | 8/8 |
| control-seed-143 | trained | 1000 | 0.008459 | 1.000000 | 1.000000 | 1.000000 | 8/8 |

## Development cases

The development section is intentionally not named or interpreted as a fresh held-out/generalization set. It reports loss and per-case overlap against the preserved historical delayed-memory report.

| trial | status | n | development loss | gate | frequency | joint | physical | historical overlap |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| full-seed-107 | complete | 32 | 2.404614 | 0.312500 | 1.000000 | 0.312500 | 10/32 | 6 |
| full-seed-117 | complete | 32 | 2.706883 | 0.312500 | 1.000000 | 0.312500 | 10/32 | 6 |
| control-seed-141 | complete | 32 | 2.780424 | 0.312500 | 1.000000 | 0.312500 | 10/32 | 2 |
| control-seed-143 | complete | 32 | 3.005765 | 0.312500 | 1.000000 | 0.312500 | 10/32 | 6 |

## Runtime and failures

- Wall-clock cap: `300.0` seconds; elapsed: `47.68180843899995`; CPU: `47.823878156999996`.
- Cap termination: `False`; within cap: `True`.
- Deadline enforcement: `cooperative`; an in-flight model operation or finalization may finish after the cap: `True`.
- Final JSON/Markdown serialization is outside the reported elapsed interval: `True`.
- Single CPU process does not guarantee one BLAS/OpenMP thread or a fixed memory ceiling: `True`.
- Structured failures: `0`.

No PC training, production deployment, paid compute, credentials, merge, or PR action is part of this artifact.
