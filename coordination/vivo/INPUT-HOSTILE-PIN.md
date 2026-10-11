# PR 76: pin the hostile-object input follow-up

Parent: `5ca4e0e09ea55ee5e1cb9396f4eb392a6c000e5e`.
Exact PR 75 input dependency: `9bfe8946151d4be3f302b99de205d80201fde0e3`.

The disposable integration checkout now verifies all five worker-file Git blobs,
including the new rejection-description suite. The controller and all three input
suites are staged from that immutable commit, never a moving branch. No worker
files are added or modified in the published diff.

The evidence verifier requires a single 102-test TAP plan, 102 passing named
results, zero failure/cancel/skip/TODO counts, all 25 falsy cases and all twelve
exact hostile-object names: null-prototype, message-getter and toString crossed
with sync/async and grab.target/grab.end. Missing or substituted tests cannot be
hidden behind matching summary counts. Nine verifier tests provide negative
controls, including removing each of the 12 hostile and 25 falsy cases.

Fresh local test composition: 102 input tests; 197 composed Node tests (the 102
are INCLUDED, not added twice); four real loopback HTTP tests; nine evidence-gate
tests. All passed without failures/skips. The 197 include the four real
LocalLeaseWorld/GripController accepted-release fixtures and 24 nested/durable
tests. Historical 185+4 figures belong to the older input pin.

CI must run and its logs must be checked separately before claiming these as CI
results. Pipeline failure propagation remains enabled. The reproduction artifact
includes the new verifier tests and the exact staged worker files.

Accepted grab.end keeps the existing entity and returns its integer revision.
Release does not increment material revision; acceptedSequence advances. That
convention and the deliberate null-receipt negative control remain unchanged.

Still unfinished: full original source import into PR 74, GripHost final-frame
exception cleanup, mounted app/camera/renderer wiring, authenticated remote
authority, material dynamics/learning, and full two-person nested-world
acceptance. Seven full vendor blobs were already uploaded separately, but they
are not a complete application import. No merge, deployment or ownership change.
