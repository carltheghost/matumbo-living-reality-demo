# v0.3 neural integration repair contract

Status: proposed and executable on the isolated repair branch only. This
document supersedes neither `EXPERIMENT_CONTRACT_V03_NEURAL.md` nor its
generated report; those remain historical artifacts. It defines the bounded
repair experiment and the claims that may be made from it.

## Purpose and boundary

The repair answers one narrow question: after a content-addressed prior-memory
read is actually connected to the recurrent policy and the numeric/autograd
implementations are made identical, can the five-brain policy overfit a small
delayed-cue training microset under the same local executor and budgets?

The initial system is exactly five neural modules: four recurrent peripheral
modules and one structurally different recurrent center. The center contains
the differentiable addressable memory, learned tool/action selection, and
feedback-driven state update. Deterministic SIMFABRIC code remains the
authority for permissions, budgets, document/graph/event history, world
mutation, tool execution, and success evaluation. Those constraints cannot be
learned away. No network, shell, arbitrary tool, growth, credentials,
production deployment, or third-party/proprietary code is in scope.

The policy receives only copies of typed, whitelisted policy observations. It
does not receive a world snapshot, target label, oracle answer, parsed matrix
column, gate resonance, or privileged simulator state. Exact notes, links,
history, events, and checkpoints remain authoritative documents/store state;
neural activations, memory slots, weights, and learned retrieval are not a
replacement for those durable records.

## Checkpointable state model

One checkpointable state is treated as the product of:

1. authoritative SIMFABRIC world/field and geometry state;
2. four peripheral recurrent states;
3. the central recurrent state;
4. differentiable addressable central memory with two six-dimensional slots;
5. typed note, measurement, actuation, and feedback results;
6. the user-owned document/graph/event workspace;
7. RNG state, tick, tool/physics/virtual-work budgets, and training/optimizer
   state.

The renderer, if present, reads traces and never becomes an authority. The
future note/graph workspace will use the same state/event/checkpoint model:
exact note text, links, revisions, and search remain deterministic first;
learned retrieval is an additional bounded proposal mechanism, not an
implicit rewrite of documents or a claim of universal code-in-weights ability.

## Coupled physical substrate claim

The available FieldLab reconstruction uses one edge energy

`C(r)=kappa*w*exp[-alpha*(r-r0)]`

`E=.5*k*w*(r-r0)^2 + .5*C(r)*(u_j-u_i)^2`.

Oscillator exchange and mechanical forces are both derived from this energy;
bounded neural ports apply drives and changed field/geometry returns through
typed observations. The existing 321-parameter NeuralEdgeLaw is only a narrow
constitutive law, and the dense Gross–Pitaevskii phase solver is an untrained
teacher. Neither is called unified intelligence by this experiment.

## Repair semantics

For each recurrent step, the full center first computes a content key from its
prior central state and reads the prior memory by softmax similarity. That
`read_before` vector is concatenated into the center input before the gated
recurrent update. A separate content-addressed read after the bounded write is
fed to the action heads. Address weights control the write only; value and
write-gate parameters control the write only. The control has one recurrent
controller and the same two-slot memory/tool/action semantics; its action
memory feature combines the pre- and post-write content reads without adding a
privileged answer head. Numeric execution and reverse-mode autograd must use
the same equations.

The encoder retains the exact bounded byte/matrix representation and adds
explicit note, spectrum, and feedback presence masks. Present note and
spectrum features may be normalized only with statistics fitted from the
training microset; missing features remain zero and their masks remain
authoritative. No normalization statistic, label, or selection rule may be
fit from future inputs.

Authoritative SQLite text is preserved in full. If UTF-8 encoding of a title
or note exceeds its declared neural window (32 or 96 bytes), policy encoding
rejects the observation explicitly; it never silently trains or acts on a
prefix that could hide a target instruction.

## Smallest proof and fixed schedule

The first run contains exactly two training worlds × four target goals, with
the note available during training. Training uses balanced minibatches,
two model seeds per architecture, at most 1,000 optimizer updates per trial,
and a five-minute wall-clock cap for the entire experiment. Every checkpoint
logs full-microset loss, gate accuracy, frequency accuracy, joint accuracy,
physical success, and gate/frequency action histograms. If frequency learning
does not succeed on this training-only microset, the run stops at diagnosis;
no larger split or claimed holdout is substituted.

The fixed executor schedule is explicit: one zero-drive field advance, one
note lookup, one short goal-independent delay when the retention variant is
enabled, one deterministic diagnostic at port 0, then one neural gate/frequency
actuation. The diagnostic is the only tool. It returns the full typed
measurement and consumes the declared virtual budgets; the neural action must
pass through the real local world mutation and the observed outcome.

If the frequency criterion succeeds, retention evaluation shows the note once,
strips all goal-bearing note fields before the short delay, then supplies the
spectrum and final action. Separate interventions erase one memory slot, only
recurrent states, or all retained neural state while leaving authoritative
goals/documents unchanged. Wrong-note and shuffled-measurement interventions
change only the target payload and use donors whose deterministic reference
action differs; the donor-condition fact is reported separately from the
actual failure cause.

Future inputs are freshly constructed and unlabeled. Their split names or
goal IDs do not establish unseen semantic goals. No future input is used for
optimization. A deterministic oracle-feasibility reference and an untrained
random reference use the same evaluator and budgets, with oracle labels kept
outside policy input and reference scoring explicitly separated from learned
results.

## Required checks and reporting

Before interpreting behavior, verify finite-difference agreement and nonzero
gradients using distinct nonzero memory slots for: content read/key, write
address, write value, write gate, recurrent parameters, action parameters,
goal-byte input parameters, and initial memory. Also verify numeric/autograd
trace parity, save/reload/replay, and budget accounting. Compare the full
five-brain model with the one-controller matched control at approximately
equal parameter count (`HIDDEN=45`, about 11,133 parameters for the control;
the full model is about 11k after its center-read input).

The report must state actual parameter counts, data construction, splits,
seeds, optimizer updates, normalization provenance, CPU time/memory, all
failures, numerical residual/work/damping, and exact artifact digests. It must
not claim consciousness, world-best behavior, universal ability, or
99.9999%-level performance. Historical constant-policy/audit findings are
reported as corrections to the old artifact, not silently rewritten.

## Explicit architecture gaps for later work

This repair is not a complete EvoCell or general agent. A later primitive may
evaluate a slow recurrent weight `W` plus a fast plastic operator `P`, learned
forget/reset and optional phase/topology terms, but it must specify and test
the timestep, episode boundary, restart persistence, clipping, and checkpoint
semantics. It must also trace the complete action loop: learned bounded tool
proposal -> permission-checked executor -> typed outcome/error/cost -> the
same recurrent/memory update. Addressed slots and fast plastic recurrence
must be measured separately. Peripherals' causal contribution, center
feedback, and any growth/hierarchy require their own interventions. No such
mechanism is silently inferred from the current slot memory or renamed as
complete intelligence here.
