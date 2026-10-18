# v0.3 Hybrid Core: Waves, Attention, Tension, and Time

Status: implemented as a small untrained numerical experiment on branch
`experiments/vevo-agents-hybrid-core-2026-10-18`. This document describes the
core construction and its structural tests; it is not a training result,
competence claim, or production-integration proposal.

## Scope and boundary

The module is `src/vevo_agents/v03_hybrid_core.py`. It accepts one finite
normalized policy vector of the existing v0.3 width and returns recurrent,
oscillator, attention, tension, feedback, and time state. It does not inspect
an episode, documents, a world, or an executor. Typed actions, permissions,
and authoritative state remain outside the numerical core.

The unchanged backbone is:

```text
four independent 8-unit recurrent peripherals
                 │ four scalar legacy backbone messages
                 ▼
        distinct 12-unit recurrent center ──► learned 2×6 memory
```

The hybrid additions are attached after each backbone step. Previous bounded
feedback is injected into the next backbone step, so the feedback edge is
causal rather than a same-step shortcut:

```text
backbone states ─► 2 oscillator pairs/compartment ─► five 4-D messages
       │                                                  │
       └────────────── two memory slots ─────────────────┘
                              │
                   one masked six-token attention
                              │
                    12-D two-step tension solve
                              │
                 bounded recipient-specific feedback
                              └──► next recurrent step
```

There is one 12-D center, not five interchangeable centers. The four
peripheral parameter sets are distinct random parameters, but the architecture
does not assign semantic specialization to a peripheral.

The dimension labels are intentionally separate:

| Dimension role | Current coordinates | Meaning |
| --- | --- | --- |
| latent | 4×8 peripheral states, 12-D center, 2×6 memory, `(5,2,2)` oscillator state | internal recurrent and wave state |
| display/communication | 4-D messages, 4-D attention query/context, 4-D feedback | bounded interfaces between core mechanisms; no UI or renderer authority |
| modeled dynamics | each oscillator's Cartesian `(x,y)` disk and cumulative normalized time | internal numerical coordinates and time only; neither is a measurement of the external world |

The 6-D memory slots are projected into the shared 4-D attention value/key
space. No current module claims that a display coordinate is a physical
coordinate or that a latent coordinate is directly observable.

## Time and oscillator construction

Each of the five compartments has two 2-D oscillator pairs, so the internal
oscillator state has shape `(5, 2, 2)`. A pair uses

\[
A=-\gamma I+\omega J,\qquad
J=\begin{bmatrix}0&-1\\1&0\end{bmatrix},
\]

with strictly positive bounded damping and bounded learned angular frequency:

```text
gamma = 0.05 + (1.50 - 0.05) sigmoid(gamma_raw)
omega = 3.00 tanh(omega_raw)
```

The forcing is bounded before it enters the oscillator:

\[
u=\frac{v}{\sqrt{1+\lVert v\rVert^2}}.
\]

For held-constant forcing, the update is

\[
z_{t+dt}=e^{A dt}z_t+\gamma A^{-1}(e^{A dt}-I)u.
\]

The implementation evaluates the 2-D exponential in its damped rotation form.
For `dt <= 1e-4`, it evaluates the two forcing integrals with a fifth-order
series instead of subtracting nearly equal matrices. `dt` is finite,
non-negative, and supported through `0.25` normalized recurrent-step time
units; the default is `0.05`. The core carries an explicit cumulative `time`
state and advances it by `dt`.

For bounded initial `z` and bounded held forcing, the exact frozen-forcing
update preserves the unit-ball bound. This statement is only about that
isolated oscillator update; it is not a claim about whole-network gradient
stability. The core uses Cartesian quadratures. It does not use `atan2`.

The old magnitude-only observation cannot identify oscillator phase. The full
`(x, y)` state is therefore retained internally; no external physical phase is
retroactively inferred from an old magnitude-only measurement. The oscillator
coordinates are latent numerical quadratures, not physical measurements.

## Attention exchange

The single attention exchange has six tokens:

| Token group | Count | Input | Bounded output |
| --- | ---: | --- | --- |
| peripheral messages | 4 | 4-D message | `tanh(Kx)`, `tanh(Vx)` in 4-D |
| memory slots | 2 | 6-D slot | `tanh(Kx)`, `tanh(Vx)` in 4-D |

The center and the current central 4-D message supply a bounded query through
separate learned maps. This makes the central oscillator path causal: central
oscillator state → central message → query → attention context. Binary module
and memory presence masks set illegal token logits to a masked sentinel and
zero their values. If all six tokens are absent, both numeric and Tensor paths
return explicit all-zero weights and context. Legal-token logits are bounded
with a scaled `tanh`; values and query/key projections are bounded. The
returned attention weights and context are recipient-neutral;
recipient-specific feedback is produced afterward.

## Tension and refinement

The four peripheral 4-D messages are proposals `p_i`. Each learned `W_i` maps
the 12-D center variable `c` to proposal space. The refinement objective is

\[
E(c)=\frac12\sum_i \alpha_i\lVert W_i c-p_i\rVert^2
     +\frac12\lambda\lVert c-c_{prior}\rVert^2,
\]

where `alpha_i` and `lambda` are positive bounded parameters. At the start of
each step, the current base center plus a bounded attention projection is
projected into the state ball and copied as the contextual `c_prior`; there is
no static learned prior parameter. The initial point and the frozen prior are
therefore feasible in both numeric and Tensor paths. The objective
coefficients are copied/frozen for exactly two refinement steps. Each step uses
the analytic gradient

\[
\nabla E(c)=\sum_i\alpha_i W_i^T(W_i c-p_i)+\lambda(c-c_{prior})
\]

and step size

\[
\eta=\frac{1}{\sum_i\alpha_i\lVert W_i\rVert_F^2+\lambda+\epsilon}.
\]

The result is projected to the radius `sqrt(12)`. Tests assert fixed-objective
energy non-increase, outside-ball numeric/Tensor parity, and finite analytic
gradients. This is a structural constraint-refinement mechanism, not a factual
verifier and not an unqualified agreement loss.

## Causal feedback and state

The causal order within one step is:

```text
legacy backbone step (reads all modules and memory)
  → oscillator updates and five messages
  → six-token masked attention
  → contextual two-step tension refinement
  → bounded integration of base center and refined center
  → hybrid write of the integrated center into current memory
  → bounded recipient-specific feedback for the next backbone step
```

The integrated center becomes the next runtime center, and the hybrid memory
write consumes that same integrated center. The existing backbone memory write
still occurs inside the legacy backbone step before this hybrid write. Current
module/memory masks scope only the hybrid attention and tension computations;
they do not erase modules or memory from the legacy backbone, which continues
to read the full input and memory state.

The refined center is mapped to a bounded 4-D signal, combined with the
attention context, and passed through a distinct output map for each of the
five recipients. The resulting `(5, 4)` feedback is injected through
recipient-specific bounded maps into the next step's peripheral/center
recurrent states. Current-step outputs do not feed the current-step backbone.

Snapshots bind the complete recurrent, memory, oscillator, feedback, presence,
step, and cumulative-time state to the model version and a digest of both
backbone and incremental parameters. They are runtime-state snapshots, not
weight or optimizer checkpoints. Restoring after a parameter mutation or
schema/state mismatch is rejected. All weights are explicitly
`random_untrained`.

This file describes the numerical core only. No task loss, document-loss
adapter, or integrated action head is available here; the unchanged legacy
backbone action/gate head is retained only as a comparator boundary and is not
claimed as a hybrid-core decision service.

## Incremental parameter budget

The proposed construction cap applies only to new hybrid parameters, not the
existing recurrent/memory backbone:

| Quantity | Count |
| --- | ---: |
| existing v0.3 backbone | 11,183 |
| incremental hybrid parameters | 1,185 |
| incremental cap | 2,500 |
| total object parameters | 12,368 |

The constructor checks this budget and raises an explicit budget error if a
future edit exceeds it; it never silently grows past the cap.

## Geometry extension (conditional, not implemented)

The first implemented core uses shared 4-D message/memory/query coordinates
with the ordinary Euclidean metric. A later geometry experiment may use a
shared bounded SPD metric

\[
G=g_{min}I+(g_{max}-g_{min})\frac{B^TB}{1+\lVert B\rVert_F^2},
\]

with proposed untuned bounds `g_min=0.5`, `g_max=2.0`, applying the same metric
to an attention distance penalty and the quadratic tension residual. Its
curvature/Lipschitz bookkeeping would use
`g_max * sum(alpha_i ||W_i||_F^2) + lambda`. A constant SPD metric is flat
learned geometry, not discovered curvature. The current oscillator pairs are
disks, not circles. An explicit amplitude-plus-unit-circle phase
parameterization is a separate design requiring separate proofs. Hyperbolic
geometry is conditional on a later hierarchy-bearing task. None of these
extensions changes the current implementation or its tests.

## Structural tests and planned learning benchmarks

Implemented tests cover oscillator `dt=0` identity, damping decay,
fixed-forcing split-step composition, small-`dt` stability, pair-wise unit-disk
bounds, attention masks and message influence, all-absent numeric/Tensor
attention parity, central and peripheral downstream connectivity,
fixed-objective tension energy non-increase from an outside-ball start,
outside-ball numeric/Tensor tension parity, analytic tension gradients,
numeric/Tensor step parity including integrated center/memory, exact binary
masks, legacy-backbone mask scope, finite differences reaching
frequency/damping/attention/tension/memory parameters, state isolation,
fractional-step rejection, JSON serialization, and snapshot next-step parity.

The following are planned ablations/learning benchmarks only; they were not
run and no training or held-out outcome evaluation is implied:

| Ablation | Status |
| --- | --- |
| existingcore | planned baseline comparison |
| fullhybrid | planned |
| omega0 matchedcapacity | planned |
| uniformattention | planned |
| norefine | planned |
| closedfeedback | planned |
| memory versus recurrent erasure | planned |

The existing unresolved document issue remains recorded outside this module:
the averaged linear conflict-set scorer cannot uniquely prefer complete
3/4-member conflict sets over all pairs. This core work does not expand the
document supported scope or claim to solve that issue.

## Explicit non-claims

This module is not a full Transformer; it has one small masked attention
exchange and no Transformer stack. It is not trained, does not select actions,
and does not demonstrate factual correctness, generalization, or production
readiness.
