# Delayed-memory shared-response-scale candidate

Status: `complete`
Source commit: `d8a41bfe6e7e38d5319438f2c7171006b2349e51`
JSON report: `reports/generated/v03-neural-shared-row-bundled-screening-report.json`

This artifact is a bounded, separately retrained candidate. Its primary per-case overlap baseline is the immediately preceding shared-response-scale legacy-head report; the original v1 comparison is retained separately.

## Evaluation gate and scope

- Gate head: `shared_row_scorer`.
- Existing gate: all four models must complete within budget and each must reach 8/8 delayed training physical successes before any development-case evaluation (`True`).
- Development worlds: `9300, 9301, 9302, 9303, 9304, 9305, 9306, 9307`; these are previously inspected development cases, never fresh generalization evidence.
- Checkpoint reload/parity gate: `passed`.
- Historical artifacts unchanged byte-for-byte: `True`.
- Primary historical overlap reference: `reports/generated/v03-neural-delayed-shared-response-scale-report.json` at artifact commit `c35c2e6729dc867b516de8229ddd99adb88bcc44`.

## Training results

| trial | status | updates | train loss | gate | frequency | joint | physical |
|---|---|---:|---:|---:|---:|---:|---:|
| full-seed-107 | trained | 1000 | 0.004163 | 1.000000 | 1.000000 | 1.000000 | 8/8 |
| full-seed-117 | trained | 1000 | 0.002819 | 1.000000 | 1.000000 | 1.000000 | 8/8 |
| control-seed-141 | trained | 1000 | 0.005355 | 1.000000 | 1.000000 | 1.000000 | 8/8 |
| control-seed-143 | trained | 1000 | 0.005358 | 1.000000 | 1.000000 | 1.000000 | 8/8 |

## Development cases

The development section is intentionally not named or interpreted as a fresh held-out/generalization set. It reports loss and per-case overlap against the preserved historical delayed-memory report.

| trial | status | n | development loss | gate | frequency | joint | physical | historical overlap |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| full-seed-107 | complete | 32 | 0.004231 | 1.000000 | 1.000000 | 1.000000 | 32/32 | 10 |
| full-seed-117 | complete | 32 | 0.002856 | 1.000000 | 1.000000 | 1.000000 | 32/32 | 10 |
| control-seed-141 | complete | 32 | 0.005387 | 1.000000 | 1.000000 | 1.000000 | 32/32 | 10 |
| control-seed-143 | complete | 32 | 0.005394 | 1.000000 | 1.000000 | 1.000000 | 32/32 | 10 |

## Runtime and failures

- Wall-clock cap: `300.0` seconds; elapsed: `82.99047148299996`; CPU: `82.838969823`.
- Cap termination: `False`; within cap: `True`.
- Deadline enforcement: `cooperative`; an in-flight model operation or finalization may finish after the cap: `True`.
- Final JSON/Markdown serialization is outside the reported elapsed interval: `True`.
- Single CPU process does not guarantee one BLAS/OpenMP thread or a fixed memory ceiling: `True`.
- Structured failures: `0`.

No PC training, production deployment, paid compute, credentials, merge, or PR action is part of this artifact.
