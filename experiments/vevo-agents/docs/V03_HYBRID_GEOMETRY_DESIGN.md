# v0.3 shared geometry extension design

## Implemented boundary

`v03_hybrid_geometry.py` is an additive, separately versioned module. It uses shared four-dimensional coordinates for message, memory, query, key, and tension-proposal calculations. The metric is constructed from the fixed formula

```text
G = 0.5 I + 1.5 B^T B / (1 + ||B||_F^2)
```

so it is symmetric positive definite with fixed eigenbounds `[0.5, 2.0]`. The learned raw beta is mapped through a sigmoid into `[0, 1]`. Attention subtracts the bounded beta times squared metric distance; tension uses the same metric in every proposal residual quadratic. Numeric and local-autograd paths share the same coordinate order and formula.

Projected tension refinement freezes metric and objective coefficients, uses the prescribed curvature upper bound, and records a complete energy/state trace. Identity-metric and exact no-distance flags are explicit ablations. Geometry snapshots contain schema, model version, bounds, and raw parameters, and incompatible snapshots are rejected.

## Integration boundary

The existing `V03HybridCore` remains unchanged and does not enable this module by default. Integrating it later would require an explicit source-review decision about where the shared metric enters existing attention and tension paths, followed by checkpoint/version decisions. This stage does not retrain or run a sweep.

The SPD matrix is a constant flat coordinate metric during an evaluation. It is not a curved manifold, a geodesic or connection model, a physical extra dimension, a circle, or a hyperbolic expansion.

## Evidence and limits

The development tests cover exact formula/eigen bounds, numeric/autograd parity, gradients, beta bounds, attention distance effects, tension energy/refinement, identity/no-distance ablations, and checkpoint version rejection. They are explicit numerical development cases only. No competence, learning, or generalization claim is made.
