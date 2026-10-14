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
- All 14 repository tests pass. The original report was written to
  `artifacts/v02-proof-report.json`; this preservation copy stores it as
  `reports/imported/v02-proof-report.json`. No external apps, credentials,
  network actions, arbitrary tools, or third-party code were used.

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

## v0.3 independent-review repair

- Repaired the evaluator: success now requires an accepted physical actuation
  of the gate whose resonance matches the accepted note's requested
  `target_hz`; opening an arbitrary gate no longer succeeds.
- Enforced the v0.3 tool-call, live-physics-step, virtual-probe-step and
  supplied-work budgets before or during consumption. A resource violation
  invalidates success. Virtual probe cost includes both gate and field-port
  drive work.
- Corrected the gate quartic force to `-4*q*x^3` for potential `q*x^4`, and
  routed reciprocal coupling through an internal-force channel so it is not
  counted as external supplied work. Signed balance work and positive budget
  work are reported separately.
- Added a measurement-only gate/frequency baseline and a strict policy-input
  whitelist excluding seed, resonance arrays, calibration, world snapshots,
  and detailed gate state. Checkpoint snapshots retain those fields only for
  deterministic restore, not as policy inputs.
- Added targeted regressions for all repairs, whole-system timestep
  refinement, and port-inclusive virtual work. No neural training was run.

## v0.3 virtual failure accounting repair

- A cloned diagnostic that crosses the virtual work budget now reports and
  charges the partial steps/work consumed before rejection. The live physical
  world remains unchanged because the probe still runs on cloned state.
- A virtual-step budget preflight rejection is covered separately and consumes
  no virtual steps or work. The charged values are included in the typed
  measurement result and policy observation whitelist.
- The evaluator contract is explicitly single-gate-only: an additional open
  gate invalidates an otherwise note-matched success. Added regressions cover
  both the accounting distinction and this success boundary. No training was
  run.

## v0.3 neural integration checkpoint

- Added `v03_model.py`: exactly four recurrent peripheral modules plus one
  structurally different gated recurrent center with differentiable 2 × 6
  addressable memory. The matched single-controller baseline receives the same
  encoded policy observations, memory shape, fixed tools/schedule, optimizer,
  and 180-step budget.
- Added `v03_neural_proof.py` and the contract
  `docs/EXPERIMENT_CONTRACT_V03_NEURAL.md`. The fixed first milestone is one
  zero-drive advance, exact note lookup, fixed diagnostic port 0, then a
  learned gate and explicit drive-frequency argument from the four declared
  frequencies. The model input audit found no seed, resonance array,
  snapshot, target, oracle, or evaluator keys.
- Disjoint splits contain 32 train, 16 validation, and 48 test episodes over
  disjoint complete worlds and disjoint note-goal IDs. Oracle actions are
  supervision labels only; evaluation makes zero oracle calls. Two full-model
  seeds (7, 17; optimizer 1007, 1017) and two control seeds (41, 43; optimizer
  1041, 1043) were all reported, with checkpoint selection by validation loss.
- The selected full model achieved 2/48 held-out authoritative successes
  (0.0417), versus 1/48 (0.0208) for the matched control. Wrong-note,
  shuffled-measurement, and neural-memory-erase interventions each also had
  2/48 successes; disabled actuation had 0/48. These interventions therefore
  do not establish causal dependence because the learned policy was weak.
  No superiority or generalization claim is made.
- All neural gradient checks passed (p0–p3, center, and initial memory),
  JSON model/runtime/episode replay passed, exact SQLite note/link restore
  passed, all 46 repository tests passed, and resource/residual accounting
  stayed within protocol budgets. The corrected timestep test now disables
  tick-window distractors for its undriven refinement comparison.
- Specific next hypothesis: the center needs a learned relational inductive
  bias, such as factorized note-frequency attention against the 4 × 4 response
  matrix or a bilinear row/column interaction, rather than a single small
  dense action head. That should be tested on the same split and budget; the
  current result is a failure to establish reliable neural action selection,
  not a reason to expose oracle state or change the evaluator.
- Reviewable result: `reports/generated/v03-neural-proof-report.json`; selected
  checkpoints: `storage/checkpoints/v03-neural-full-selected.json` and
  `storage/checkpoints/v03-neural-control-selected.json`. Re-run from this
  directory with:
  `PYTHONPATH=src python -m vevo_agents.v03_neural_proof --output reports/generated/v03-neural-proof-report.json`.

## v0.3 neural read-path repair and regression audit

- Preserved the historical `dd34d67` source/report/checkpoints and added the
  separate repair contract `docs/EXPERIMENT_CONTRACT_V03_NEURAL_REPAIR.md`.
  The repaired full model still has exactly four peripheral recurrent modules
  plus one distinct gated recurrent center. The center now consumes a
  content-addressed prior-memory read before its recurrent update and a
  separate post-write content read in the action heads; address/value/gate
  parameters remain bounded write paths. Numeric and reverse-mode paths are
  identical. The historical selected checkpoints used `HIDDEN=45`
  (11,133 parameters) versus 11,127 for the full model.
- Added training-only present-modality normalization and explicit note,
  spectrum, and feedback masks. Titles over 32 UTF-8 bytes or note text over
  96 UTF-8 bytes are rejected at the neural boundary while exact SQLite text
  remains intact; no silent prefix is treated as a complete instruction.
- Added boundary repairs and tests for instance-specific reduced-budget
  restore, deep-detached policy/snapshot projections, atomic event-budget
  failures, exact nonempty disk-workspace restore rejection, atomic parameter
  loading, supported/unsupported autograd matmul primitives, and actual
  mid-sequence neural continuation after runtime restore.
- The capped repair run used two worlds × four goals, balanced size-one
  minibatches,
  1,000 updates per trial, seeds full `(7,17)` and control `(41,43)`, and
  completed in 105.60 wall-clock seconds with 41,048 KB peak RSS. Both selected
  models reached 8/8 training-world physical successes and 1.0 frequency,
  gate, and joint accuracy; this is an overfit microset result, not a
  holdout/generalization result.
- The evaluator audit passed input-whitelist, all-five-module paths,
  finite-difference gradients with distinct nonzero memory slots, exact
  numeric/autograd parity, optimizer movement, typed tool arguments/results,
  checkpoint normalization/Adam-state persistence, replay, and budget
  checks. Retention baseline after note stripping/delay succeeded on 2/8
  selected-full cases; slot erase was also 2/8 and recurrent/all-state erase
  1/8, so no broad memory-causality claim is made. Wrong-note and coherent
  matrix-row-permutation interventions changed only their declared payload;
  resource-only intervention was separate.
- Deterministic oracle feasibility was 8/8 on the microset and 8/8 on the
  freshly constructed unlabeled future inputs. Future inputs were not used
  for optimization. The old report's constant gate-3/1.15 policy and
  identical ablation trajectories are recorded as a historical audit
  correction, not rewritten.
- The post-review source-only repository regression suite runs 64 tests. The
  reviewable historical artifacts remain:
  `reports/generated/v03-neural-repair-report.json`,
  `storage/checkpoints/v03-neural-repair-full-selected.json`, and
  `storage/checkpoints/v03-neural-repair-control-selected.json`.

## v0.3 post-publication source-only review corrections

- No training was rerun and the published repair JSON/checkpoints remain
  preserved historical artifacts. Its retention result (2/8 baseline, with
  slot/recurrent/all-state comparisons) is now explicitly classified as an
  out-of-distribution schedule confound, not a clean memory-necessity result:
  the hidden note kept a note object and therefore `note_present=1`, while
  present-note normalization converted the cleared payload into large
  negative features.
- Added a separate `note_payload_present` neural mask. Hidden payloads now
  normalize to neutral zeros while a valid empty stored note remains distinct
  through its authoritative content digest. Future retention code enumerates
  slot 0, slot 1, both slots, recurrent-only, all-state, and matched-control
  comparisons; causal eligibility requires paired outcome, probability, and
  action changes, not merely one baseline success.
- Wrong-note donors now replace only the equal-width `target_hz` substring;
  source/variant/metadata/other bytes are asserted unchanged. Physics event
  snapshots/restores are recursively detached. Zero deny-all v0.3 budgets
  round-trip and retain rejection behavior.
- Legacy SIMFABRIC advance/tool budget reservations are now prevalidated and
  atomic across event, tick, physics, and tool counters. Regression coverage
  includes exhausted physics/event budgets and nested projection/history
  mutation isolation.
- Checkpoints now persist shuffle order and next minibatch position in
  addition to optimizer moments/RNG, but exact trainer resume remains
  explicitly unverified. The historical 105.60-second figure is wall-clock
  time, not CPU time; the future oracle feasibility reference is not a sealed
  untouched test set.
