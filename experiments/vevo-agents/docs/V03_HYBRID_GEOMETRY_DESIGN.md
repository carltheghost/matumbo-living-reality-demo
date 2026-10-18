# v0.3 shared geometry extension design

## Implemented boundary

`v03_hybrid_geometry.py` is an additive, separately versioned module. `V03HybridCore(geometry_enabled=True)` now opts into the actual attention and tension paths while the default constructor remains byte-compatible with the historical path. It uses shared four-dimensional coordinates for message, memory, query, key, and tension-proposal residuals; the existing 12-dimensional center is retained and tension maps are `n x 4 x 12`. The metric is constructed from the fixed formula

```text
G = 0.5 I + 1.5 B^T B / (1 + ||B||_F^2)
```

so it is symmetric positive definite with fixed eigenbounds `[0.5, 2.0]`. The learned raw beta is mapped through a sigmoid into `[0, 1]`. Attention subtracts the bounded beta times squared metric distance; tension uses the same metric in every proposal residual quadratic. Numeric and local-autograd paths share the same coordinate order and formula.

Projected tension refinement freezes metric and objective coefficients, uses the prescribed curvature upper bound, and records a complete energy/state trace. The core creates a small nonzero raw `B` and one `SharedGeometryParameters` object; the same derived `G` object is passed to attention and tension in both numeric and Tensor paths. Identity-metric and exact no-distance flags remain external ablations. Geometry snapshots contain schema/version compatibility metadata, and incompatible snapshots are rejected.

## Integration boundary

The default `V03HybridCore` path remains unchanged and geometry is not enabled unless explicitly requested. The opt-in path is a structural integration only; it does not retrain or run a sweep. The core's normal 12D center, 4D messages, memory shape, seeds, and optimizer-independent random initialization remain intact.

The SPD matrix is a constant flat coordinate metric during an evaluation. It is not a curved manifold, a geodesic or connection model, a physical extra dimension, a circle, or a hyperbolic expansion. Unsafe raw `B` magnitudes and out-of-contract coordinates are rejected before arithmetic.

## Evidence and limits

The development tests cover exact formula/eigen bounds, numeric/autograd parity, gradients, beta bounds, attention distance effects, dynamic 12D-map validation, unsafe/boolean inputs, integrated numeric/Tensor core parity, downstream finite differences, identity/no-distance ablations, and checkpoint version rejection. They are explicit numerical development cases only. No competence, learning, or generalization claim is made.
