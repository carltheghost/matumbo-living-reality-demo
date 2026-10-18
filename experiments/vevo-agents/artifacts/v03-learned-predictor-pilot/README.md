# v0.3 learned public-observable predictor pilot

Status: implementation/configuration feasibility checkpoint only. No training, optimizer update, learned checkpoint, final-test metric, or closed-loop planning evaluation was run.

- Predictor schema: `vevo.v03.learned-observable-predictor.v1`
- Split manifest SHA-256: `e1942c5f06ab3745cb8864673df5ebcb3045f9b1e4b4ef2c8939efeb1a31c322`
- Training data: 8 complete trajectories and 88 windows; the manifest covers 32 trajectories and 352 windows across all split metadata.
- Existing upstream gate: the all-four-models `8/8` training gate remains required before development evaluation; this pilot does not rerun or claim that gate.
- Development cases: worlds 9300--9307, explicitly inspected development only; never fresh generalization.
- Final test: default materialization is closed; the 9400--9407 inputs were generated before this review and are recorded only as exposure history (the old `phase_shifted` condition was calibration-only), while replacement worlds 9500--9507 remain reserved.
- Final-test unlock: requires a reviewed, frozen selection artifact with a provenance hash.
- Old reports/checkpoints: untouched.

The CPU probe measures one complete train-world trajectory per paired geometry variant and performs forward plus reverse-mode loss/backward only; it performs zero optimizer updates. This is a micro/probe timing, not an end-to-end training estimate.
