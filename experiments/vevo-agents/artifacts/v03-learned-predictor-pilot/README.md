# v0.3 learned public-observable predictor pilot

Status: implementation/configuration feasibility checkpoint only. No training, optimizer update, learned checkpoint, final-test metric, or closed-loop planning evaluation was run.

- Predictor schema: `vevo.v03.learned-observable-predictor.v1`
- Split manifest SHA-256: `c886edad40989713d4b1a7abb857b18f60c387d711d8233db853f9eecabfcec7`
- Development cases: worlds 9300--9307, explicitly inspected development only; never fresh generalization.
- Final test: reserved; no final-test data was used in the CPU probe.
- Old reports/checkpoints: untouched.

The CPU probe measures one train-world example per paired geometry variant and performs forward plus reverse-mode loss/backward only; it performs zero optimizer updates.
