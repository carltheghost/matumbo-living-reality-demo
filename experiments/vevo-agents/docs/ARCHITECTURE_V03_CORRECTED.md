# v0.3 corrected protocol review

This is an additive correction. The v0.2 staged tool-following experiment and
its original report remain preserved; its 14/16 result is explicitly
superseded as an integrated-intelligence proof because its diagnostic emitted a
target gate and its actuator used discrete label equality.

## Boundary

The initial neural contract remains exactly four recurrent peripheral brains
and one structurally different recurrent center. The eventual center must
address, write and read neural memory, select bounded tool arguments, encode
typed results and update its next decision in the same recurrent computation.
This review stage intentionally does not train that core yet.

Deterministic code owns exact SQLite documents/revisions, parsing of the note's
declared resonant property, the bounded world integrator, permissions, budgets,
and checkpoint/event storage. Learned state is not an archive of exact notes or
source code.

## Corrected task

1. The exact SQLite note contains a target resonant property such as
   `target_hz=0.95`; it does not name a gate.
2. A pure diagnostic runs a fixed bounded frequency sweep in cloned physical
   state. It returns only probe frequencies, a four-channel continuous response
   matrix, probe cost and world tick. It returns no target gate,
   `diagnostic_ok`, argmax, or answer label. The live episode is unchanged by
   this measurement.
3. The future neural center must retain the note instruction in memory and
   combine it with the raw measurement before selecting a gate. The intended
   final readout is a joint function of note-memory read and measurement read,
   not a note-blind maximum over all channels.
4. The neural policy supplies a bounded drive frequency, intended to satisfy
   the note's resonant-property instruction. The actuator drives the selected
   gate at that supplied frequency. Four
   continuous gate oscillators are coupled to the recovered field and expose
   position, velocity and energy. A gate opens only when its integrated peak
   position and energy cross thresholds within the work/step budget. No
   evaluator target or answer equality is consulted by runtime actuation.

The evaluator's success predicate is note-conditioned: it requires the
accepted actuation result to open the gate whose physical resonance matches
the requested `target_hz` within the stated tolerance. Opening any gate is not
success. This check is evaluator bookkeeping after the run; the actuator and
future policy input do not receive the hidden gate-resonance array or seed.
The review protocol is deliberately single-gate-only: after the one actuation
slot, any additional open gate invalidates success. This makes the success
contract explicit instead of relying on the current actuator implementation to
make extra openings impossible.

The field/gate coupling is reciprocal. It uses the shared energy
`E_c = .5*K*sum((gate_x - field_u)^2)`: the field receives
`K*(gate_x - field_u)` and the gates receive `K*(field_u - gate_x)`. The
coupling energy is included in total energy and residual accounting; it is not
an unaccounted one-way field drive.

The spectrum query is a bounded virtual simulator probe: 4 gates × 4 probe
frequencies × 80 cloned integration steps (1,280 virtual steps by default).
Virtual probe steps/work are counted in separate simulator-tool budgets even
though the live world snapshot is unchanged. Probe work includes both gate
drive and field-port drive supplied work. Live actuation has its own
physics/work budgets, and calls/steps are rejected before consumption when
their counters are exhausted; supplied work is enforced during each step. If a
cloned probe crosses the virtual work budget during a step, the consumed
partial steps and work are charged to the episode and returned as typed
feedback. A virtual-step preflight rejection occurs before any probe work and
therefore consumes zero virtual resources.

Signed external work is kept separately for the whole-system energy balance.
The reciprocal field/gate coupling is an internal force and is not added to
that external-work ledger. Positive supplied work is the monotone resource
quantity used for budgets.

The actuator requires an explicit bounded `drive_frequency` argument. It does
not parse the note to supply a missing argument; omitting the argument is
rejected. A future neural center must emit both the gate choice and this
frequency argument, with the exact note remaining available as neural input.

The policy-facing observation is an explicit whitelist of exact note fields,
raw diagnostic frequencies/response matrix, typed feedback summaries and
resource counters. It excludes checkpoint-only `seed`, `gate_resonance_hz`,
`calibration`, world snapshots, and detailed gate position/velocity/energy.

## Nontriviality evidence

The deterministic oracle selects the channel maximizing the measured response
at the frequency specified by the note. Paired fixtures demonstrate both
directions of dependence:

- identical physical measurements with different valid note frequencies require
  different gates;
- identical note text with different physical channel spectra require different
  gates.

The null policy takes the largest measured response anywhere and chooses both
the gate and drive frequency from that measurement; it receives no note. Tests
also cover note-conditioned success, pre-consumption tool/physics/work budget
rejection, pure-measurement state equality, no actuation, wrong physical drive,
port-inclusive virtual work, reciprocal coupling and quartic finite
differences, internal-work separation, timestep refinement, residual
stability, parameter sensitivity, exact revision checks, randomized
oracle/blind/no-drive cases, policy-key whitelisting, wrong-gate and
all-gates-open controls, and the five-brain contract.
These are solvability/nontriviality tests, not neural-training claims.
