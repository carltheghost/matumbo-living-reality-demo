# Progress log

## 2026-10-14 UTC

- Created isolated `/workspace/vevo-agents` repository on branch
  `work/vevo-agents`.
- Inspected prior repositories read-only. No Vivo/Site files changed.
- Wrote the self-contained architecture and provenance artifacts before
  implementation.
- Added the five-brain recurrent core, differentiable central memory,
  checkpointable SIMFABRIC state, bounded typed tool, recovered edge-energy
  reconstruction, and native SQLite/FTS5 exact-note workspace.
- Proof report: 0.90 held-out live accuracy; 1.30e-11 maximum finite-difference
  force error; all five brain groups plus initial memory finite-difference
  gradients within 1e-3 relative error; save/reload continuation replay equal.
- Seven standard-library unit tests pass. Full proof used three model seeds,
  360 optimizer steps per seed, 70 train / 20 validation / 40 test episodes,
  19.9 seconds wall time and 81,608 KB maximum resident set in this run.
- Parent-provided license findings were incorporated: no third-party notes app
  code; SQLite is native and exact records remain authoritative over FTS5 and
  learned representations.

## v0.2 interactive proof checkpoint

- Preserved v0.1 unchanged at tag `v0.1-frozen`; v0.2 is additive under
  `v02_protocol.py`, `v02_model.py`, `v02_proof.py`, and `tests/test_v02.py`.
- Protocol is a real three-stage loop: three-step field cue, current SQLite
  note revision lookup, randomized calibrated diagnostic, then bounded physical
  gate actuation. Success is authoritative gate mutation, not action-label
  agreement. The final gate action reads the differentiable memory written by
  the diagnostic result.
- Full v0.2 model: exactly four recurrent peripherals plus one distinct
  recurrent center, 625 parameters. Matched no-memory recurrent control: 625
  parameters. Full model seed 7 / optimizer seed 1007 was selected by held-out
  validation loss (0.1335816962) after 360 steps; test was not used for model
  selection.
- Disjoint balanced splits: 24 train, 8 validation, 16 test seeds (12/12,
  4/4, 8/8 target balance). Held-out real gate success was 14/16 (0.875) for
  both the full model and matched control; this small task does not establish
  an advantage over the control.
- Interventions on the same 16 held-out seeds: wrong note 0/16, stale revision
  0/16, shuffled diagnostic result 0/16, memory erase 3/16, actuation disabled
  0/16, field-feedback removal 13/16, peripheral ablations p0 14/16, p1
  8/16, p2 14/16, p3 14/16, center ablation 1/16, and fixed diagnostic/gate
  0/16. Memory erase is intentionally reported as a partial failure mode, not
  a claim of universal memory necessity.
- Numerical checks: shared-edge force error 1.3994e-11; all selected
  peripheral/center/initial-memory gradient relative errors <1e-3; model and
  episode save/reload/replay equal; normal episodes stayed within 0.30 work
  and 12/64 physics steps; maximum normal absolute world residual was
  0.0066757. Runtime was 11.63 seconds and 45,228 KB maximum RSS in this run.
- All 14 repository tests pass. The report is written to
  `artifacts/v02-proof-report.json` (ignored generated artifact); no external
  apps, credentials, network actions, arbitrary tools, or third-party code
  were used.

## v0.3 corrected-protocol review gate

- v0.2 is now explicitly classified as a limited staged tool-following
  experiment. Its original source, result and report are preserved unchanged;
  the claim that it demonstrated integrated physical gate reasoning is
  superseded, not rewritten.
- Added `v03_protocol.py` and `tests/test_v03_protocol.py` without training.
  The corrected diagnostic is pure: it probes cloned continuous state and
  returns only a four-channel response matrix over fixed frequencies, probe
  cost and tick. It has no `target_gate`, `diagnostic_ok`, argmax or answer
  field.
- Added continuous four-gate position/velocity/energy dynamics coupled to the
  recovered field. Runtime actuation does not access an evaluator target or
  compare labels. A gate opens only after integrated peak position and energy
  thresholds cross within the work and physics budgets.
- Deterministic paired evidence passes: identical measurements with different
  note target frequencies require different oracle gates; identical note text
  with different physical spectra require different oracle gates. A null policy
  that ignores the note cannot satisfy the first pair. Pure-measurement state
  equality, no-actuation, wrong physical drive, work accounting, residual
  stability, parameter sensitivity and exact revision tests also pass.
- No v0.3 neural training has started. Parent review must approve this honest
  world/measurement protocol before integrating the five-brain memory/tool
  loop and training it.

## v0.3 review corrections

- Corrected the field/gate dynamics to derive both directions from the shared
  coupling energy `E_c=.5*K*sum((gate_x-field_u)^2)`, including that term in
  total energy and residual accounting. A reciprocal finite-difference test
  passes.
- The pure diagnostic now probes each gate at each frequency in cloned state:
  4 gates × 4 frequencies × 80 steps = 1,280 virtual steps. Virtual steps and
  probe work are counted against separate simulator-tool budgets and reported
  separately from live physics/work; the live world remains unchanged.
- Actuation now requires an explicit `drive_frequency` argument. Missing
  frequency is rejected; the executor no longer reads the note to fill a
  neural action argument. Oracle and null policies supply the argument
  explicitly.
- Added randomized oracle/blind/no-drive cases, wrong-gate and all-gates-open
  controls, and missing-action-argument coverage. The corrected suite has 13
  tests and passes; the full repository suite has 27 passing tests.
- The requested Library export is blocked: the Library skill/package is not
  available in this environment. No bypass or alternate export was attempted.
  Reviewable delivery is the clean branch commit/tag
  `v0.3-protocol-review-r2` (`b15169b`) plus the source/tests/docs in the
  shared workspace; the earlier `v0.3-protocol-review` tag remains the
  pre-correction baseline.
