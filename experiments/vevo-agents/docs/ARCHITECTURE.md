# Vevo Agents architecture v0.1

Status: architecture-first design freeze for the smallest proof. This document
is self-contained so it can be reviewed or transferred without access to the
working tree.

## 1. Purpose and boundaries

Vevo Agents is one integrated local system, not a collection of tool bots and
not a display layer around physics. The first implementation tests one narrow
claim: a trainable five-brain recurrent loop can retain a short field cue,
select a bounded resonance diagnostic after a delay, receive the typed result
back through the same neural loop, and leave an observable local world trace.

The proof does not claim consciousness, a world model, universal tool use,
general intelligence, physical extra dimensions, or production readiness. It
does not add web tools, autonomous growth, remote execution, credentials,
network access, arbitrary shell powers, or a live deployment. Future hierarchy
and a previous exploratory cap of 21 total brains are design questions only;
the proof contains exactly four peripheral brains plus one central brain.

## 2. The five brains

The initial neural population is exactly:

| ID | Kind | Role | State | Port |
|---|---|---|---|---|
| P0 | peripheral recurrent | local field port 0 | recurrent tanh state | bounded drive to field node 0 |
| P1 | peripheral recurrent | local field port 1 | recurrent tanh state | bounded drive to field node 1 |
| P2 | peripheral recurrent | local field port 2 / distractor | recurrent tanh state | bounded drive to field node 2 |
| P3 | peripheral recurrent | local field port 3 / distractor | recurrent tanh state | bounded drive to field node 3 |
| C | central recurrent + differentiable memory | integration, memory, action and feedback | recurrent state plus addressable slots | bounded proposal to executor |

P0–P3 use the same peripheral family but have independent parameters and
states. C is structurally different: it performs content-addressed reads and
gated writes to neural memory, then emits an action distribution. C is still a
brain in the loop; the tool executor is deterministic infrastructure, not a
hidden sixth brain.

The center reads peripheral messages, its own recurrent state, the differentiable
memory read, bounded observations, and typed tool results. It updates its
recurrent state and memory, then proposes one action from a closed allowlist.
There is no privileged answer label, target ID, hidden simulator state, or
direct memory lookup exposed to the center.

## 3. One checkpointable state

`VevoState` is the single save/reload unit. A checkpoint contains:

1. `schema_version`, episode ID, monotonic tick, deterministic RNG state,
   numeric budgets, and training/optimizer state;
2. `world`: positions, velocities, oscillator amplitudes/velocities, edge
   parameters, calibration values, work, damping, energy and residual;
3. four peripheral recurrent states and the central recurrent state;
4. central differentiable memory slots, address/key state and write metadata;
5. the typed tool-result stream, including accepted/rejected results and
   bounded payloads;
6. SIMFABRIC authoritative documents, graph links, append-only events and
   replay metadata;
7. model parameters and training counters when a training checkpoint is
   requested.

Arrays are serialized as finite JSON lists in the proof so the artifact is
portable and inspectable. Restore validates schema, shapes, finite values,
budgets, IDs, action names, and event order. RNG state is restored rather than
reseeded. A replay uses the same state and future action sequence and compares
digests/trajectories.

### Exact state versus learned representation

| Durable and authoritative | Learned/recurrent representation |
|---|---|
| exact note text, note IDs, revisions, links and event history | P0–P3 hidden states |
| world coordinates, oscillator values, edge law parameters and budgets | C recurrent state |
| typed tool results and permission decisions | C memory slots/read weights |
| RNG/tick/training counters and checkpoint schema | all neural weights and optimizer moments |

The exact workspace is not compressed into weights. Learned representations
may retrieve or summarize it later, but weights cannot replace documents,
history, permissions, or a universal ability to execute code.

## 4. SIMFABRIC and the renderer

SIMFABRIC is the authoritative state/event layer. It owns deterministic event
ordering, document/graph mutations, world mutations, typed result insertion,
budget accounting, checkpoint/replay and provenance. Each event records a
schema, tick, source, type, payload and digest. The proof uses local events;
no external bus or network is implied.

The renderer adapter receives a read-only projection of world traces, neural
activity summaries, workspace index data and event metadata. It cannot mutate
authoritative state, execute tools, edit documents, or change permissions.
This preserves the same principle as the existing Living Reality work: a
projection may visualize canonical state but is not the canonical authority.

## 5. Field/geometry coupling

The proof uses a small reconstructed mechanical/oscillator field. For each
edge `(i,j)`, with `r = |q_j-q_i|`, `du = u_j-u_i`,

`C(r) = kappa * w * exp[-alpha * (r-r0)]`

`E_edge = 0.5*k*w*(r-r0)^2 + 0.5*C(r)*du^2`.

The oscillator exchange and mechanical forces are both derived from this same
edge energy:

`dE/ddu = C(r)*du`,

`dE/dr = k*w*(r-r0) - 0.5*alpha*C(r)*du^2`.

Equal-and-opposite pair forces use `dE/dr` along the edge direction. External
neural port drives are bounded impulses to oscillator acceleration and are
tracked as work. Damping is explicit and tracked. The proof reports finite
difference force error, energy/work/damping accounting and the numerical
residual; it does not claim exact conservation under damping or finite-step
integration.

This is deliberately not the dense Gross–Pitaevskii phase solver and not the
old 321-parameter `NeuralEdgeLaw`. Those are separate recovered experiments;
the latter is a narrow constitutive law and lacks the complete oscillator /
pressure feedback loop. The proof's kernel is a clearly labelled
reconstruction from the stated edge-energy contract.

## 6. Neural loop and action boundary

At every tick:

1. the deterministic field advances using the previous bounded port drives;
2. each peripheral reads only its local field observation and updates its
   recurrent state/output;
3. C receives the four peripheral messages, its recurrent state, the current
   differentiable memory read and any typed tool result;
4. C writes memory through a differentiable content-addressed key, softmax
   slot weights, bounded write gate and bounded value;
5. C proposes `probe_a`, `probe_b`, or `noop` with bounded arguments;
6. deterministic executor permission/budget checks run before the tool;
7. the allowlisted resonance diagnostic may mutate the local world and returns
   a typed result; the result is appended to SIMFABRIC and fed into the next
   center tick;
8. SIMFABRIC appends an event and the renderer may read a projection trace.

Permissions and sandbox enforcement are code-level gates. No learned output
can bypass them. An invalid action is rejected and produces a typed rejection
result, not an arbitrary exception or shell call.

## 7. Smallest proof protocol

Each episode creates four oscillator nodes and an episode-specific calibration
containing two candidate natural frequencies. A brief bounded cue drives one
of the candidate resonators. The cue disappears. A delay contains distractor
drives and field evolution. The calibration is not a fixed absolute frequency
that can be hard-coded across episodes.

At the decision tick the trained center chooses `probe_a`, `probe_b`, or
`noop`. The deterministic diagnostic applies a short sinusoidal probe using
the episode's calibrated frequency for the chosen slot, mutates local
oscillator/geometry state, and returns only typed measured fields such as
probe slot, calibrated frequency, gain, energy delta and post-probe digest.
It does not return the hidden target label. The evaluator compares the
observed physical outcome against the episode target after the run.

The proof uses independent train/validation/test episode seeds, whole
trajectory holdouts and multiple training seeds. Validation selects the
checkpoint; test trajectories never select weights or thresholds. It records
parameter counts, data splits, seeds, update steps, wall-clock time,
memory budget, tool budgets, work/damping/residual and failures.

## 8. Controls and paired interventions

The report compares the same episode sets and update/tick/tool budgets for:

- full 4+1 architecture with memory and the intended learned tool-selection
  interface (the bounded v0.3 repair schedule fixes the tool choice);
- a parameter-budget-matched single recurrent architecture with its own
  differentiable memory integration;
- a no-memory ablation of the recurrent center;
- a fixed-tool control that always probes slot A.

On identical test episodes it runs paired interventions:

- `memory_erase`: zero central slots during the delay;
- `tool_result_shuffle`: permute typed measurement fields before feedback and
  compare the post-tool neural state/trace against the unshuffled run;
- `brain_to_field_off`: force neural port drives to zero and report changed
  field trajectory/work while preserving the external cue;
- `field_to_brain_off`: replace post-cue field observations with zeros and
  report action accuracy/trace change.

These are causal diagnostics, not proofs of consciousness or generality.

## 9. Knowledge workspace

The same SIMFABRIC state contains a small exact-note workspace: user-owned
documents with stable IDs, exact text, revisions, created/updated ticks,
outgoing `[[note-id]]` links, backlinks, deterministic exact search, and
append-only edit/link events. The runnable store uses Python's native SQLite
with an FTS5 index when the local SQLite build provides it; the canonical
records are still the SQLite documents/links/events, not the derived index.
SIMFABRIC editor wrappers route document mutations into the same authoritative
event path as world/tool events and enforce revision checks. The workspace is
Obsidian-like only in the narrow sense of notes/links/editor/search: it copies
no Obsidian implementation or proprietary code. Retrieval is initially
deterministic and exact. Learned retrieval can be added later as a consumer of
the exact store; it must not replace or rewrite authoritative documents without
an explicit evidence-bearing event.

## 10. Resource and safety envelope

The proof is CPU-scale, low-memory, local-only and bounded by explicit tick,
tool-call, event, document and serialized-state budgets. No arbitrary shell,
web, network, credential, account, paid compute, production deployment or
third-party code is present. Third-party alternatives remain undecided pending
the parent's license research.

## 11. Acceptance criteria

The slice is accepted only if all of these are reported, not merely asserted:

1. architecture text and provenance are reviewable;
2. exact 4+1 count is enforced by construction and checkpoint validation;
3. edge forces match finite differences within the stated tolerance;
4. gradients are checked against finite differences for P0, P1, P2, P3, C
   and initial memory;
5. normal save/reload/replay matches;
6. paired interventions and equal-budget controls run on shared holdouts;
7. no privileged target leaks into observations or tool results;
8. actual counts, seeds, compute, budgets, work/damping/residuals and failures
   are recorded;
9. exact notes/links/search survive checkpoint and renderer projection remains
   read-only.
