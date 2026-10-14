# v0.3 neural repair post-publication review

This is a source-and-regression correction only. No training was rerun after
the published repair artifact
`reports/generated/v03-neural-repair-report.json` (SHA-256
`3ce2499a0a7d1ad493e8dfa75f9ed7967ef6fd981d97fe01f23ee166644dad24`). The
published report and both checkpoints remain preserved for historical review.

The current corrected source has 11,183 parameters in the five-brain model and
11,178 in the matched single-controller model. These counts were verified
without retraining; the published artifact retains its historical counts.

## Retention result correction

The published retention baseline of 2/8, and its slot/recurrent/all-state
comparisons, must not be read as a clean memory-necessity result. The old
retention intervention left a typed note object present while clearing its
goal-bearing text and digest. The encoder therefore reported `note_present=1`
and present-note normalization produced large out-of-distribution negative
features. The source now carries a separate `note_payload_present` mask and
uses neutral zeros for hidden note features. A future retention run must test
slot 0, slot 1, both slots, recurrent-only, all-state, and matched-control
pairs; causal eligibility requires paired outcome, probability, and action
changes.

## Other focused repairs

- `ResonantWorld.snapshot()` and `restore()` deep-detach nested event history.
- `CorrectedEpisode.restore()` accepts valid zero deny-all limits and preserves
  their rejection behavior without permitting widened limits.
- Wrong-note donor interventions replace only the equal-width `target_hz`
  substring; all other policy fields and encoded bytes are asserted unchanged.
- Legacy SIMFABRIC advance/tool operations prevalidate multi-budget reservations
  before mutation; exhausted event/physics budgets are atomic failures.
- Checkpoints persist optimizer moments, RNG, shuffle order, and next example
  position. Exact trainer resume is still unverified; inference replay is the
  only checkpoint behavior previously executed.
- The fixed schedule still learns only gate/frequency output. It does not
  establish learned general tool selection or a complete tool-result writeback
  loop.
- The historical runtime value is wall-clock time, not CPU time. Future oracle
  feasibility was intentionally inspected separately, so those inputs are not
  a sealed untouched test set.

## Verification

The source-only verification command was:

```sh
PYTHONPATH=src python -m py_compile src/vevo_agents/*.py
PYTHONPATH=src python -m unittest discover -s tests -q
```

It completed with 64 tests passing and no training or report regeneration.
