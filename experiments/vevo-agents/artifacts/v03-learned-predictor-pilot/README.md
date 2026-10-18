# v0.3 learned public-observable predictor pilot

Status: implementation/configuration feasibility checkpoint only. No training, optimizer update, learned checkpoint, final-test metric, or closed-loop planning evaluation was run.

- Predictor schema: `vevo.v03.learned-observable-predictor.v1`
- Split manifest SHA-256: `2aff0b4e3dfddd96e6539e4ab2ec1307d84d700b4b3045b631bf70f3b6d83cca`
- Training data: 8 complete trajectories and 88 windows; the manifest covers 32 trajectories and 352 windows across all split metadata.
- Probe-based optimizer lower bound for six fits × 100 updates: `104.466` seconds; this excludes evaluation, checkpoint, and serialization overhead.
- Existing upstream gate: the all-four-models `8/8` training gate remains required before development evaluation; this pilot does not rerun or claim that gate.
- Development cases: worlds 9300--9307, explicitly inspected development only; never fresh generalization.
- Final test: default materialization is closed; the 9400--9407 inputs and prior direct world-9500 phase unit fixture are recorded only as exposure history, while genuinely fresh worlds 9600--9607 remain reserved.
- Final-test unlock: requires a digest-verified frozen selection artifact bound exactly to the manifest, config, and selected checkpoint files.
- Runner contract: six learned fits (geometry on/off × seeds 7, 17, 37), 100 equal updates per variant/seed, one shared 300-second cap, and one development evaluation boundary at update 100.
- Normalizer/checkpoint provenance: canonical mean/scale plus train-source digests are verified on reload; prediction parity is checked before development evaluation.
- Old reports/checkpoints: untouched.

The CPU probe measures one complete train-world trajectory per paired geometry variant and performs forward plus reverse-mode loss/backward only; it performs zero optimizer updates. This is a micro/probe timing, not an end-to-end training estimate.
