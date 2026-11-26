# Associative mission reasoning

Verified baseline #170: 375/375 hosted tests, all six workflows, exact
cross-mission recall and grant isolation in source/static desktop/mobile
Chromium.

The new neural.missionTrace tool uses the existing owner-selected completed
mission recall grant and its exact target attachment. It constructs a bounded
bipartite graph of known space/entity addresses and completed task IDs.
Object-to-task and task-to-object edges carry an original confirmed receipt
witness; task-to-task edges are explicitly declared prerequisites, in either
direction with distinct relation labels. Both sides of each dependency must
be shared. Unknown-space and non-dispatched evidence are excluded. No path
may traverse an unshared task. No inference from similar names, inferred
causes, operation payloads, or external provider data.

Deterministic breadth-first search returns one shortest path within 1–8
hops, default 6. The selected simple path is then encoded and replayed
through the existing ConstructiveMemory four-bank forward pass: bank 0
observed-in, 1 observed-object, 2 prerequisite-of, 3 depends-on. This is an
exact circuit readout check, not independent verification of causal truth.
The graph search is conventional code, not a trained neural model. The
temporary circuit does not replace the owner numeric memory or persist
addresses. Every hop carries the recorded receipt or dependency witness.
No causal proof, predicted success, action authority or automatic replay.
Absence of a shared bounded path is not proof of unrelated objects.

The existing session, attachment epoch, world/branch and revoke fences
apply to both recall tools. The owner panel shows the actual path and
matches the returned target task and attachment epoch before rendering it.
Local same-page trust boundaries are unchanged; no remote account identity,
cross-device memory or semantic reasoning is claimed.

Local Node v22.16.0: 11/11 pure association tests passed using the exact
existing ConstructiveMemory blob d2bb41bb6eca3409c897aef26ccb47deaa2052c4.
Helper/test hashes b4c5b9f528c3828b2d9228331254a3f4aa4c0b6c and
d6d16e2f1674a7f268f2ac9480d716bea9384319. Capacity fixture searched 960
receipt entries. Four additional journal tests and expanded desktop/mobile
source/static browser acceptance require fresh CI. Cache v36. No paid
provider calls, merge or deployment.
