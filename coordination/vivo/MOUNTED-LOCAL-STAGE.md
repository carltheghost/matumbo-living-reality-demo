# Mounted canonical local application checkpoint

## Composition and ownership

This stage derives from the exact original import local checkpoint
`837122ac853f99c5c4e89f3587d2545cea21c41c`, itself based on PR76
`84832d07ee21bef76c538be8f897b1be637bc3ca`. The reviewed PR77 host changes are
composed from `7aac7e51331bdfe2ec3e0bf80d4794ecdc8c1c04` and
`e1cb960703b4c56b6e5a04e72d81f63175262065`, including exact acquireCommandId
correlation. Root merged those reviewed changes separately into PR76.

PR75 input remains pinned at `9bfe8946151d4be3f302b99de205d80201fde0e3` and is
staged only as a hash-verified local test dependency. No input-owned files are
edited or committed by this stage. All 140 original source/research files and
all 45 packaged-integrity entries remain byte-identical. No root landing,
right-side dock or Pages deployment paths are changed.

## Actual application mounting

Run `services/vivo/start-canonical-local.sh --port 8766` after installing the
existing requirements and staging the exact input dependency. The additive
`server.local_application` entrypoint calls the original `server.app.make_app`,
then installs exact-path dispatch before the existing static handler. Original
security middleware remains outermost. The same original index is served with
an explicit local bootstrap replacement and its imported SHA-256 response
header. Original renderer, camera/worker, styles and geometry are reused.

The Python process supervises one Node canonical authority through private
stdin/stdout, without an internal network port. `/readyz` and `/api/local/ready`
probe both processes and the original service/assets. Only loopback binding is
supported. Local writes require loopback peer/Host, same Origin and a server-
allocated seat token. Two fixed local seats have independent saved Eyes; reload
rotation invalidates the previous token and releases its grips. No remote human
identity authentication or cross-device sharing is claimed.

The UI mounts source-aware input with capture timestamps, full-dimensional
frames, final samples, source-specific cancellation and explicit reconciliation.
Accepted and provisional target markers are distinct from accepted material
coordinates. Default mode remains stationary; explicit phase mode advances real fields. Saved nested 4D→11D entry/return, Eye basis/slices and state export
are available. Unsupported profiles/11D material, remote-share, legacy history/recording and
learning controls are honestly gated in this mode.

## Persistence and bounded capacity

Default private path: `services/vivo/data/canonical-local/canonical-world.json`.
Explicit `--material-phase` uses separate `canonical-phase.json`; no migration occurs.
Legacy comparison uses a separate `comparison.sqlite` in the same data folder.
Every accepted canonical operation passes through the existing FileAuthorityStore
CAS/fsync path before acknowledgment. Restart invalidates process sessions and
leases, while accepted state/history/Eyes remain. Foreign private Eye payloads
are redacted from exports; raw camera data and browser tokens are excluded.

Default maximum journal: 65,536 events, write threshold 65,526. The ten-event
cleanup reserve is conservatively allocated as four possible entity-lease
releases, two session closes, one sweep, one restart release and two serialized
admission/in-flight slots. Gates and mutations share one queue. Renewals and
new mutations stop at backpressure; releases/reconciliation/close stay possible.
There is an independent byte threshold below the 64 MiB store cap. Read-only
saved-seat admission after restart makes no canonical writes and preserves
inspection/export. No history is silently truncated. Long-running performance,
compaction/continuation and event-only replay are not certified.

## Executed evidence

- 320 Node tests passed across application adapters/runtime, reviewed authority,
  exact input, canonical contracts and original target mailbox; zero skips/fails.
- 38 application Python tests passed: 24 pump lifecycle/numerical checks and
  14 HTTP/process tests. Twelve use the actual CLI/Node processes; two targeted
  fault/race probes use the same factory and real HTTP.
- 39 phase-component Python tests and numerical verification passed. The composed
  actual entrypoint drove q4 from 0 to 0.0029035885497084024 at simulation t=0.08
  while an undriven field stayed at q4=0; mass was 2.999999999999983. This is
  finite numerical field response, not a target-to-position substitution.
- The HTTP-host probe uses actual LocalTransport + GripHost + exact PR75 over the
  running launcher for final samples, hand/touch isolation, stale-final cleanup,
  accepted-but-lost acquisition reply reconciliation and material-coordinate honesty.
- 9 original import/readiness probes and 4 module-route HTTP checks passed.
- The complete original test script passed, plus 26 original phase tests and
  10 import-verifier negative fixtures. Original source/package hashes rechecked.

These are unit, numerical, subprocess and real loopback HTTP results. Browser
interaction remains pending: the available cloud browser returned connection
refused for the executor's local review server. No physical camera, mobile
latency, native-browser interaction or public deployment is certified by these
checks. Temporary review servers were stopped. No merge/deploy occurred here.

## Accepted phase-material boundary

The separately reviewed component `ed82a931` and authority hook `e32fa1d` are
composed with a trusted threaded pump. `--material-phase` creates an explicit
4D phase seed with three fields, each 8⁴ cells, domain lengths 8, mass 1 and coupling 1.
It starts paused; authenticated local editors may Run/Pause at at most two wall
steps per second, each dt=.02. The original renderer displays accepted field
centroids; it is not a density surface visualizer. Time remains separate.

The versioned `vivo.lease-material/1` protocol retains strict generic behavior.
An acquired phase lease remembers its last input receipt revision, material
coverage and structural invariants. Only material-only intervening revisions may
be covered; duplicates replay the original receipt, while reacquisition requires
a fresh current revision/epoch. Source/session/target ordering and expiry remain.

Private capture and apply are inaccessible through public RPC. Commit rechecks
sequence/hash, field/revisions, targets, all current leases and actual expiry.
The POSIX store checks the final guard after temp-file fsync immediately before
synchronous rename, then requires directory fsync before publication. Field,
q/v/revisions, time, accepted hash/history and retained diagnostic provenance are
one atomic record. Failed guards leave the prior record unchanged.

Full current fields are stored once; bounded material events omit field blobs.
Public requests remain 64 KiB, trusted phase framing is separately bounded at 4 MiB.
Pause fences in-flight results; capacity pauses clear run intent and preserve
read-only inspection/export/restart. Response runtime revisions prevent a delayed
status response from reversing a newer Pause display at the same accepted sequence.
No history truncation or event-only replay/import is introduced.

11D dynamics, other material profiles, learned responses, spatial convergence,
long-horizon numerical fidelity, surface/deformation visualization and physical
validation remain open gates. Native Windows storage is a separate scoped effort
and is not part of this POSIX material checkpoint.

## Publication and hosting

This checkpoint is locally assembled. Source publication is controlled by the
parent and was paused following a cancelled upload. Do not route around that
pause by publishing the imported tree elsewhere. GitHub Pages cannot execute
this Python+Node application; the existing landing/deployment workflow is intact.
A portable local runtime package may be prepared for the user's authorized
computer, with exact manifest hashes, without claiming a public backend.

## Independent-review fixes

The initial b6205cd mount was blocked by three independently reproduced wrapper
failures. The corrective stage adds connection-bound ApplicationInputs with a
final-conversion cleanup boundary, retained uncertain keys and all-key explicit
reconciliation. It bounds both fetch and response-body time, fences old polling,
preview and Eye callbacks by connection generation, and preserves resume tokens
when downgrading an exhausted seat to read-only. HTTP admission is shape-checked
before pipe writes; UTF-8 serialization is size-checked outside process-failure
handling so malformed/expanded data cannot kill the authority. Private-pipe send,
drain and response now share a finite deadline.

The actual authorized desktop is Windows; Node directory fsync failed EPERM in
a disposable probe. This mount now fails closed on native Windows before writes.
No WSL workaround or software installation is implied. A separately reviewed
transactional adapter is needed for a usable native Windows runtime.
