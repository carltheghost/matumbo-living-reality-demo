# Critical-path audit of Viva 0.8.1

## Scope

Input: the conversation attachment `matumbo-viva-build-081-source.zip`. This is not
an audit of the latest GitHub branch or the deployed site, and it is not a complete
security review. Exact artifact/file hashes and code excerpts are preserved in
`reports/source-audit.json`. Original files were not modified.

## 1. Guidance is not material dynamics

`server/adaptive.py`, lines 13 onward, defines a synthetic comfort-cost teacher.
`RoomRule.predict()` learns that cost. `Guidance` propagates shortest-route costs
through a neighbor graph using Bellman-style relaxation.

`server/app.py` line 130 advances `r.guide.step(3)`. It does not advance a liquid,
complex order parameter, pressure field, momentum field, or deformable body.

This is a legitimate narrow wayfinding model, but its location in the architecture
must remain distinct from material intelligence. Relabel it as guidance instead of
using its activity shading as evidence of a thinking physical substrate.

`server/reference.py` does contain `NeuralWaveField` (line 242), but the live room
module imports `HyperBall` from that file, not this wave integrator. Having wave
code in a package is different from running it in the user-facing workshop.

## 2. Object dragging is kinematic and can discard input

`web/shared.js` line 40 returns from `moveDirection` while `S.moving` is true.
That flag is cleared after an awaited server acknowledgement. Line 42 further
limits drag submissions to intervals of at least 55 milliseconds.

The touch path (line 52) can advance its remembered pointer position while the
movement branch is blocked. The hand path (line 70) similarly updates `handPoint`
after offering a delta that may have been discarded. The newest coordinates are
therefore not necessarily retained as the user's desired target.

On the server, the movement command updates a coordinate with `geometry.move()`
then assigns it to the entity at line 263. This is chart-aware kinematic movement,
not force-driven deformation or flow. The endpoint performs useful full-D overlap
checks for flat HyperBalls; preserve those checks in a new control path.

**Required replacement:** explicit grab ownership; a latest absolute target;
local provisional response; validated force/constraint-driven integration;
sequenced shared reconciliation. Keep the existing move endpoint for compatibility
and introduce a separate capability-checked target endpoint.

The included `TargetMailbox` tests part of this transport contract. It is not a
complete interaction repair and is not wired into the live browser.

## 3. Render frequency is explicitly limited

`web/shared.js` line 98 skips drawing until at least 31 milliseconds have elapsed.
On a typical 60 Hz callback schedule this normally draws every other frame. That
is independent of hand inference time or GPU power. The drag interval also imposes
an upper submission rate of roughly 18.2 Hz before network delays.

These are code-level bottlenecks, not a measured diagnosis of the user's current
phone session. Blindly removing limits can overload a phone. Separate input,
fixed-step physics, inference, rendering, network snapshots, and disk recording,
then adapt decorative rendering first. Measure each stage.

## 4. More object coordinates do not imply a volumetric material field

`server/geometry.py` line 166 samples a two-parameter surface grid. Extra components
of the field-grid coordinates start at zero. Objects can move in additional axes;
that is a real coordinate feature, but the guidance mesh is not a volumetric sample
of all 4–11 dimensions.

Use a declared intrinsic domain for each field. A 2D surface field embedded in a
9D world remains a 2D field. A volume field needs sampling or a function representation
that responds to every relevant coordinate. Never silently substitute one for the other.

## 5. Server readiness still gates the shared workspace

`web/shared.js` checks `/readyz` and disables create/join on failure. This protects
against pretending a static page runs a backend, but it does not implement local-first
personal worlds. The current README explicitly requires a running server.

Introduce a `LocalAuthority` and `RemoteAuthority` implementing the same session API.
Local worlds must remain distinct from a stale shared replica after disconnection.
Fork offline work explicitly; do not silently write into a shared history without
its authority. Reconnect through revision-aware reconciliation.

## Preserve

Keep entity and region IDs, existing camera/worker and touch adapters, manual Eye
navigation, recorded history, the Studio bridge, full-D overlap validation, grab
leases, input ownership, invitation expiry, and existing exports. Do not overwrite
these with another standalone visual scene and call it integration.
