# Geometry and learned behavior

Spatial dimension and time are separate. Every object coordinate vector has D components, D in 3..11. The extra axes affect distance, motion, slice intersections and flat-ball contact. Internal learned features are not spatial axes.

Built-ins are Euclidean space, S² x R^(D-2), T² x R^(D-2), and a bounded Möbius strip x R^(D-2). Sphere stereographic charts transition using inversion and its tangent Jacobian. Torus angles wrap. Möbius seam crossing flips the transverse coordinate and tangent component. The movement solver normalizes the requested direction using g(q), then integrates the geodesic equation with RK4 and chart transitions.

Custom metrics accept safe arithmetic expressions in a single bounded chart, not Python code. AST size, expression length, powers and numeric domains are bounded. Every metric evaluation checks symmetry, positive definiteness and conditioning. Specifying a smooth positive metric gives a usable local Riemannian model. It does not supply an arbitrary global atlas, certify a Calabi–Yau metric, or prove complete geodesics. Registering another atlas requires chart domains, transition maps/Jacobians and tests. General exact geodesic distance, arbitrary curved solid-body collisions and mixed-dimensional portals are not implemented.

The visible surface/guidance grid is a 20 x 14 sampled 2D working submanifold with extra coordinates zero. This avoids pretending to allocate a dense 11D grid on a phone. Entity and observer state still retains all D coordinates. Visualization of product-space height as a 3D offset is not generally an isometric embedding. The observer's displayed overview is a navigation map, not unrestricted sensing.

The guide uses metric-aware graph edge costs and a 369-parameter MLP trained on a specified synthetic teacher:

`1 + 0.4 curvature_proxy^2 + 1.8 crowd + 0.35 noise^2 + 0.25 roughness`.

Curvature input is a declared feature/proxy, not a measured curvature tensor. Training and evaluation use synthetic examples, not private people or camera records. Outputs are bounded to 1..4. Local min-plus/Bellman updates propagate destination cost through permitted neighbors. Blocking a cell resets and rebuilds the distributed potential. The graph relaxer is explicit; only the cost rule is learned. No result silently moves a user or commits an object edit.

Model choice uses validation, not test data. The report includes a stronger fitted quadratic baseline, which is essentially exact for this teacher and outperforms the neural net. The experiment establishes working learned computation, not a reason to prefer neural approximations to available exact formulas. Analytic and off modes expose that comparison.

Weights are pinned and hashed. A restored checkpoint with a different version is rejected rather than recomputed under an undisclosed law. There is no online weight mutation, free-form architecture emergence or general room intelligence in this slice.

Research context (not claims of reproduced full systems):
- https://proceedings.mlr.press/v139/satorras21a.html
- https://proceedings.mlr.press/v119/sanchez-gonzalez20a.html
- https://distill.pub/2020/growing-ca/
- https://geomstats.github.io/notebooks/09_practical_methods__implement_your_own_riemannian_geometry.html

The previous spring/oscillator numerical reference and its trained force model are retained unchanged under `legacy/numerical` and `server/reference.py`. They are not mislabeled as the active shared-room guidance network.
