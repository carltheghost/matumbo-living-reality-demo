# v0.1 bounded shared-metric geometry extension

**Title:** v0.1 shared 4D metric for message, memory, and query coordinates

## Metadata

- **Author:** Codex
- **Date:** 2026-10-18
- **Status:** implementation-ready, additive opt-in core path; default remains unchanged
- **Version:** `vevo.v03.hybrid-geometry.contract.v1`
- **Owner:** `vevo-agents`
- **Review gate:** source review before any training or default activation

## Context

The existing compact hybrid core has four-dimensional message/query/proposal coordinates and a 12-dimensional center state. This extension supplies one shared positive-definite coordinate metric for message, memory, query, key, and tension-residual coordinates. `V03HybridCore(geometry_enabled=True)` uses it in the actual attention and tension paths; the default core remains disabled and unchanged.

For a raw 4x4 matrix `B`, the metric MUST be exactly

```text
G = g_min I + (g_max - g_min) B^T B / (1 + ||B||_F^2)
```

with fixed untuned bounds `g_min = 0.5` and `g_max = 2.0`. The metric is a constant SPD matrix during each attention/refinement evaluation. It is a flat coordinate metric, not a curved manifold, not physical extra dimensions, and not a circle or hyperbolic expansion.

The implementation accepts only `max(abs(B)) <= 1.0e6`. This explicit domain
keeps the 16-entry square/sum, Gram products, and the local-autograd quotient
backward intermediates finite in float64. Shared attention and tension
coordinates are also bounded by `max(abs(coordinate)) <= 16.0` on both numeric
and Tensor paths.

The repository's `Tensor` constructor normalizes inputs to float64. Therefore,
Tensor helpers cannot recover whether an already-constructed value originated
as boolean; boolean provenance is rejected on NumPy inputs before Tensor
construction.

## Functional Requirements

- FR-1: The module MUST use dimension four for shared message, memory, query, key, and tension-proposal coordinates.
- FR-2: Numeric metric construction MUST implement the exact bounded SPD formula above, preserve symmetry, and return finite eigenvalues in `[0.5, 2.0]`.
- FR-3: Tensor metric construction MUST implement the same formula using the repository autograd Tensor operations, MUST expose gradients to raw `B`, and MUST reject raw values outside the finite backward-safe domain.
- FR-4: A learned attention inverse-temperature/distance coefficient MUST be bounded by a fixed `beta_max = 1.0` through a differentiable sigmoid parameterization; the same metric MUST be used for every attention distance penalty.
- FR-5: The metric MUST enter the attention logit as a negative bounded-beta multiple of squared metric distance, with an explicit exact no-distance ablation.
- FR-6: The metric MUST enter the proposal tension quadratic through `r_i^T G r_i`, with shared 4D residual coordinates, `n x 4 x 12` maps from the retained 12D center, and a fixed Euclidean anchor term. Numeric and Tensor energy functions MUST agree.
- FR-7: The curvature/Lipschitz audit MUST report `g_max * sum_i alpha_i ||W_i||_F^2 + lambda`, with nonnegative `alpha_i` and `lambda`, and projected refinement MUST keep the objective coefficients and metric frozen for all refinement steps.
- FR-8: Projected refinement MUST expose its energy trace, use the curvature audit to choose a stable step, and reject or report non-finite states without returning a truncated trace.
- FR-9: Identity-metric and no-distance ablations MUST be explicit, deterministic, and testable without changing the default hybrid core.
- FR-10: Geometry checkpoints MUST carry the exact schema/model version, bounds, raw matrix, and raw beta; incompatible version, shape, bounds, or non-finite values MUST be rejected before use.
- FR-11: The extension MUST remain separate from the tool-synthesis protocol and MUST not alter existing default seeds, weights, normalization, schedule, optimizer, historical reports, or checkpoints. The opt-in core state MUST carry explicit geometry schema/version compatibility metadata.

## Non-Functional Requirements

- NFR-1: The module MUST use NumPy and the repository's existing local autograd implementation only; no network, provider, credential, or paid resource is permitted.
- NFR-2: Numeric and Tensor paths MUST be deterministic for identical inputs and MUST use the same formula and coordinate ordering.
- NFR-3: Every public numeric or Tensor input MUST be finite and shape-checked; boolean, ragged, non-finite, wrong-dimensional, mismatched-count, out-of-contract coordinate, and unsafe raw-magnitude inputs MUST fail explicitly before arithmetic.
- NFR-4: The metric MUST be bounded by construction; callers MUST NOT tune `g_min`, `g_max`, or `beta_max` through runtime arguments.
- NFR-5: A constant SPD metric MUST be documented as flat geometry. The implementation MUST NOT imply curvature, physical extra dimensions, circle expansion, or hyperbolic expansion.
- NFR-6: Checkpoint serialization MUST be canonical and version-sensitive; a failed restore MUST not mutate a caller's arrays.

## Acceptance Criteria

### AC-1: Shared coordinate dimension (FR-1)

Given finite message, memory, query, key, proposal, and residual coordinates, when the geometry helpers validate them, then every shared coordinate MUST have width four; the core center remains 12D and its tension maps MUST have shape `n x 4 x 12`; incompatible widths/counts MUST fail before arithmetic.

### AC-2: Exact bounded SPD formula (FR-2, NFR-4)

Given a finite raw 4x4 matrix `B` within the explicit `1.0e6` absolute-entry domain, when the numeric constructor runs, then its result MUST equal the stated formula, be symmetric to floating-point tolerance, and have eigenvalues between `0.5` and `2.0`. Values outside that domain MUST be rejected before squaring.

### AC-3: Numeric/autograd metric parity (FR-2, FR-3, NFR-2)

Given the same raw matrix, when numeric and Tensor metric constructors run, then their matrix data MUST agree to tight tolerance and a scalar loss through the Tensor metric MUST produce finite nonzero raw-matrix gradients.

### AC-4: Bounded learned beta (FR-4)

Given finite raw beta values including large positive and negative values, when beta is parameterized, then numeric and Tensor beta MUST be finite, differentiable in the interior, and within `[0.0, 1.0]`.

### AC-5: Metric attention distance effect (FR-5)

Given a query and two keys at different metric distances, when metric attention logits are computed with positive beta, then the farther key MUST receive the larger negative distance penalty. With the exact no-distance ablation, adding the metric distance MUST not change base logits.

### AC-6: Tension energy parity (FR-6)

Given shared 4D proposals, 4x4 proposal maps, nonnegative weights, a prior, lambda, and a valid metric, when numeric and Tensor tension energies are computed, then their scalar values MUST agree and the Tensor path MUST expose finite gradients through state, metric, and maps.

### AC-7: Curvature bound and frozen projected refinement (FR-7, FR-8)

Given a fixed metric, objective coefficients, and initial state, when projected refinement runs for a bounded number of steps, then the reported curvature bound MUST equal the specified expression, the objective inputs MUST remain unchanged, the state MUST remain inside the projection radius, and the fixed-objective energy trace MUST be non-increasing within tolerance.

### AC-8: Identity and no-distance ablations (FR-9)

Given the identity metric and a no-distance flag, when the attention and tension helpers run, then identity results MUST match Euclidean results and no-distance logits MUST match base logits exactly.

### AC-9: Checkpoint version safety (FR-10, NFR-6)

Given a valid geometry snapshot, when it is serialized and restored, then raw parameters and schema metadata MUST round-trip exactly. Given a wrong schema, model version, bound, shape, or non-finite raw value, when restore is attempted, then it MUST fail before returning a metric.

### AC-10: Baseline separation (FR-11, NFR-5)

Given the existing hybrid-core source, reports, and checkpoints, when the geometry module and tests are added, then those historical files MUST remain byte-for-byte unchanged and the default hybrid-core constructor MUST retain its previous behavior.

### AC-11: Opt-in integrated core path (FR-6, FR-11)

Given `V03HybridCore(geometry_enabled=True)`, when one numeric and one Tensor step run with the same state and parameters, then attention, tension refinement, center, and memory outputs MUST agree to numerical tolerance and the same single derived metric MUST be used by both branches. The opt-in snapshot MUST reject an incompatible geometry version.

## Edge Cases

- EC-1: A zero raw matrix MUST produce `0.5 I`, not an unbounded or singular matrix.
- EC-2: A raw matrix with very large unsafe finite entries MUST be rejected before `B^T B`; accepted finite values remain within the fixed upper eigenbound.
- EC-2a: An accepted raw matrix at the `1.0e6` boundary MUST have finite numeric and Tensor forward values and finite raw-matrix gradients.
- EC-3: A zero-dimensional, 3D, 5D, ragged, or non-finite matrix MUST be rejected.
- EC-4: A metric with an asymmetric perturbation MUST be rejected by metric validation rather than silently symmetrized at the public boundary.
- EC-5: A zero-length key list MUST return an empty logit vector with no fabricated attention mass.
- EC-6: Equal-distance keys MUST receive equal distance penalties when base logits are equal.
- EC-7: Beta raw saturation MUST remain finite and bounded; no division by beta is permitted.
- EC-8: Negative alpha, negative lambda, or mismatched proposal/map counts MUST be rejected.
- EC-9: A projection boundary hit MUST be represented in the refinement trace and MUST not mutate the initial state.
- EC-10: A checkpoint with changed bounds is incompatible even if its raw matrix is numerically valid.
- EC-11: Identity metric is a flat metric; it MUST not be described as zero curvature learned by a manifold expansion.
- EC-12: No-distance attention is an ablation, not a second learned coordinate system.

## API Contracts

This is a local Python API and intentionally has no HTTP endpoint.

```text
bounded_spd_metric_numeric(raw_B: array4x4) -> array4x4
bounded_spd_metric_tensor(raw_B: Tensor) -> Tensor
bounded_beta_numeric(raw_beta: float) -> float
bounded_beta_tensor(raw_beta: Tensor) -> Tensor
metric_attention_logits_numeric(query, keys, metric, raw_beta, base_logits=None,
                                distance_enabled=True) -> array
metric_attention_logits_tensor(query, keys, metric, raw_beta, base_logits=None,
                               distance_enabled=True) -> Tensor
metric_tension_energy_numeric(state, proposals, maps, alpha, lambda_value,
                              prior, metric) -> float
metric_tension_energy_tensor(state, proposals, maps, alpha, lambda_value,
                             prior, metric) -> Tensor
refine_tension_numeric(state, proposals, maps, alpha, lambda_value, prior,
                       metric, steps=2, radius=None) -> (array, RefinementTrace)
serialize_geometry_snapshot(raw_B, raw_beta) -> bytes
restore_geometry_snapshot(document) -> GeometrySnapshot
```

## Data Models

| Model | Required fields | Invariants |
| --- | --- | --- |
| Raw geometry | `B`, `raw_beta` | `B` is finite 4x4; beta is finite scalar |
| Metric | `G`, bounds, dimension | Symmetric SPD; dimension four; eigenvalues in fixed bounds |
| Attention trace | query, keys, metric, beta, logits | One shared metric and bounded beta; no-distance is explicit |
| Tension objective | 12D state, `n x 4` proposals, `n x 4 x 12` maps, alpha, lambda, prior, metric | Fixed coefficients during refinement; alpha/lambda nonnegative; proposal/map counts match |
| Refinement trace | states, energies, curvature bound, step size | Complete trace; projected states; non-increasing fixed objective |
| Geometry snapshot | schema, model version, bounds, raw matrix, raw beta | Exact version and bounds required for restore |

## Out of Scope

- OS-1: Changing the existing hybrid-core default path or retrofitting geometry into historical checkpoints; the reviewed opt-in path is additive only.
- OS-2: Training, tuning, or selecting a learned metric, beta, or routing policy.
- OS-3: A curved manifold, nonconstant connection, geodesic integrator, physical extra dimensions, circle expansion, or hyperbolic expansion.
- OS-4: External model/tool calls, credentials, network access, paid resources, or provider setup.
- OS-5: Large training or evaluation sweeps; tests are explicit numerical development cases only.
- OS-6: Reusing gate-feature semantics or response normalization as a substitute for the shared coordinate metric.
- OS-7: Merging geometry with the bounded tool-synthesis grammar; both interfaces remain independently versioned.
