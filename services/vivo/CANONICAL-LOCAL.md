# Vivo canonical local application stage

This is an additive mount of the imported 0.8.1 application, not a replacement
renderer or a simulated material-motion demo. All 140 imported source/research
files remain byte-identical. The original Python app, `index.html`, renderer,
camera/worker and numerical solver are retained unchanged.

## Run on your own computer

Requires Python 3.11+ with `services/vivo/requirements.txt`, Node.js 22+, and a
modern browser. No cloud account, paid service, persistent API credential or
internet connection is needed after code/dependencies/assets are installed.
From the complete repository:

```sh
python -m pip install -r services/vivo/requirements.txt
python scripts/vivo/stage_input_dependency.py
services/vivo/start-canonical-local.sh --port 8766
```

Use a virtual environment if appropriate. The dependency-staging step verifies
exact immutable PR75 file hashes and refuses to overwrite different files; it is
needed while the input feature remains unmerged. It does not commit those files.
The launcher never installs software automatically.

Open `http://127.0.0.1:8766/local/` for the primary **Full Studio**. This is the
original browser-local field/universe model: browser checkpoints and JSON exports
are explicit Studio actions, and it has no automatic local-authority admission.
The optional **Shared object / Echo** panel is an explicit projection bridge;
open `http://127.0.0.1:8766/local/?vivoAuthority=1&seat=one` to connect it to
local seat one, and use `seat=two` in a second tab. It maps only Studio node 055
to the accepted root `relic` binding. Publish, apply, and offline-fork actions
are explicit; a local Studio edit is never silently merged or overwritten.
Its local camera adapter initializes hand tracking from the vendored Field Lab
runtime/model; head-pointer mode is explicitly unavailable because no face
landmarker model is included. Camera permission remains opt-in.

For the separate accepted backend preview, open
`http://127.0.0.1:8766/local/accepted/`. Choose Seat one. Open a second browser
tab at the same `/local/accepted/` URL and choose Seat two. The two seats are
local host admission, not verified human identities. Only one active session is
allowed per seat. Reloading/resuming a saved seat rotates its token, releases
prior grips and retains its accepted Eye. Tokens are kept in tab sessionStorage,
never in the checkpoint. A server restart invalidates all old tokens;
explicitly clear/reopen the expired seat if the UI asks.

The Studio and accepted preview retain intentionally separate state models. Studio
browser saves/history/video and JSON exports do not become accepted backend
state automatically. The optional bridge carries only the versioned Echo
projection binding through the authority; it does not copy Studio velocities,
edges, laws, material checkpoints, camera state, or Eye state. Conversely,
accepted preview history/export does not restore the whole Studio field. In
`--store memory` uses a session-only accepted world and binding; its accepted
state is session-only and resets with the server; POSIX/SQLite modes persist
accepted state in their private backend files.

The accepted preview's **Fork offline branch** action is an explicit, downloaded
handoff from the current accepted checkpoint. It preserves object IDs, nested
space IDs, laws, model metadata and the parent checkpoint hash, then gives the
branch a distinct world/authority identity; it never appends offline edits to
the shared history. Material bytes are intentionally not included in this
public branch descriptor, so a fork starts paused for authority/geometry work
and needs a separately reviewed material-host export before material evolution
can resume. Reconnection/merge is not automatic.

For direct Python invocation on a supported POSIX environment:

```sh
cd services/vivo
python -m server.local_application --port 8766 --data-dir /absolute/private/path
```

The command binds only `127.0.0.1`. It deliberately has no public-bind flag.

For a real browser preview without backend world/checkpoint/database files, opt
into the explicit session-only backend. Do not pass `--data-dir` in this mode:

```sh
services/vivo/start-canonical-local.sh --store memory --material-phase --port 8766
```

The session-only label in the UI is a hard capability boundary: accepted world,
Eye, lease, history and phase state exist only while this local server process
runs. A fresh process starts from a fresh world and rejects old tab tokens. The
guarantee is scoped to backend world/checkpoint/database files; normal
OS/browser writes are outside it. Tab-scoped `sessionStorage` tokens may help a
reload reconnect to the same process, but are not durable world storage. A
manual state export is a user download for evidence only; it is not imported or
reloaded automatically.

## What is mounted

- Existing index/layout, original WebGL/Canvas renderer and local camera worker
- Frozen absolute-input controller via GripHost and allowlisted ESM routes
- Canonical LocalLeaseWorld behind a private supervised Node stdin/stdout pipe
- Default POSIX atomic FileAuthorityStore, with explicit optional SQLite and session-only memory backends
- Canonical state remains separate from the original legacy comparison
- Two session-bound local actors; separate Eye coordinates, basis and slice
- Explicit mapped root 4D → inner 11D entry and exact outer-Eye return
- Explicit `vivo.offline-branch/1` fork receipt and downloadable checkpoint handoff
- Versioned `vivo.studio-binding/1` registry with separate CAS projection publish and canonical commit/apply actions
- Full Studio bridge keeps two accepted Eyes independent and exposes capability-gated AR/VR checks without starting a session
- Full-dimensional accepted grip targets with capture-time freshness checks
- Distinct provisional and accepted target markers; solid marks use accepted entity coordinates
- Final pointer/hand samples, source-specific loss cleanup and explicit reconcile
- Durable checkpoint confirmation for POSIX/SQLite and sanitized state export

In POSIX/SQLite modes, each accepted operation is saved before acknowledgment. In
memory mode, each accepted operation is committed atomically to the in-process
session store before acknowledgment and is discarded when the process stops. The local server enforces
loopback peer/Host and exact Origin for mutation. No forwarded identity is trusted.
Raw camera frames, hand landmarks and head-tracking claims never enter the
authority bridge. The bridge's AR/VR button is capability inspection only; it
does not start camera or WebXR sessions. `Publish selected` advances only the
Studio binding projection. `Commit canonical` is separately capability-gated,
requires editor authority plus global/binding/entity CAS, preserves non-q
entity state, and is rejected for material-owned bindings with
`STUDIO_MATERIAL_BOUNDARY`. Memory-mode commits are process-session only;
POSIX/SQLite commits are durable after checkpoint acknowledgment.

## Honest capability boundaries

Default mode retains stationary objects and reports material dynamics false. An
explicit experimental phase mode connects the recovered numerical teacher through
an authority-owned atomic commit:

```sh
services/vivo/start-canonical-local.sh --material-phase --port 8766 --data-dir /absolute/private/path
```

This uses a separate `canonical-phase.json`, never migrates `canonical-world.json`,
and starts paused. In Saved state, choose **Run experimental 4D phase**. Either
seat can pause the shared clock; each Eye remains independent. The root's three
persistent objects each have one real 8⁴ complex phase field. Solid renderer marks
are their accepted density centroids, not liquid surfaces. Grip potentials drive
actual field evolution, never teleport q to a target. Targets must stay inside
−4 ≤ x < 4 on all four axes. The numerical step is 0.02 simulation seconds at at
most two wall-clock steps per second; this is deliberately slow, not real-time.
Mass, energy, splitting residual and clock are visible. Export includes the last
accepted field checkpoint and bounded event evidence; no public replay/import API
is supplied. A numerical fault stops evolution visibly, preserving accepted state.

The material lease extension is explicitly versioned `vivo.lease-material/1`.
Physics-only revisions retain bounded input-receipt continuity; structural changes,
lease/session/source/epoch mismatches and stale targets remain fenced. Material
capture/proposal operations exist only on the supervised private pipe. Public RPC
stays limited to 64 KiB; only trusted material framing permits up to 4 MiB.

The 11D nested material, learning and remote multiplayer remain unavailable.
Nested entry is an explicit mapped transition, not continuous portal rendering.
The 11D Eye has eleven actual coordinate values; this is not evidence of 11D
material dynamics. Phase spatial convergence, long-horizon accuracy and physical
validation remain open gates. The model is not helium, solid elasticity or a
learned material law.

The original shared 0.8.1 application remains at `/legacy`. Its relative-move
protocol and learned route guidance are a comparison, not the canonical material
or identity implementation. The original Studio remains separately reachable at
`/studio.html`. No automatic migration or merging of their worlds occurs.

## Persistence and shutdown

Default private files are `services/vivo/data/canonical-local/canonical-world.json`
and `comparison.sqlite` (phase mode instead uses `canonical-phase.json`). Use `--data-dir` for a different private folder outside
the web directory. One Python process supervises exactly one Node authority.
Readiness probes both. Stop the launcher normally to release local sessions.

The explicit `--store memory` mode does not create or write a data directory,
canonical checkpoint, comparison database, or SQLite sidecar. It uses the same
authority, lease, nested-Eye and material guards with a process-local
`MemoryAuthorityStore`; it never silently falls back to POSIX or SQLite.

The checkpoint contains accepted snapshot/history and separate Eyes; it is not
an event-only replay engine. Existing lock directories after a crash must be
inspected by an operator; the application never steals them. POSIX atomic/fsync
semantics are tested. Native Windows is explicitly blocked before writes: the
actual Node 24 probe fails directory fsync with EPERM. The optional SQLite adapter
has a separate strict privacy/native acceptance gate, described below. There is no
silent fallback or durability downgrade.

The default journal permits 65,536 events, with writes stopped at 65,526. Ten
cleanup slots cover four entity leases, two sessions, one expiry sweep, one restart
release and two in-flight/admission outcomes. A separate 64 MiB checkpoint cap
reserves twelve × 64 KiB of byte headroom. Material fields are stored once in the
current checkpoint; events retain bounded measurements/provenance, not field blobs.
The event cap alone therefore does not promise a session duration. At the 2 Hz
material limit, physics alone consumes at most 7,200 events per wall hour; input,
renewals and Eye movement add records, and byte backpressure may arrive first.
The journal preserves accepted records with explicit event/byte backpressure.
Capacity and remaining budget appear in Saved state. New writes become read-only
before cleanup headroom is consumed; history is never silently truncated. Saved
seats may be admitted read-only to inspect/export after restart. Long-running
compaction/continuation and sustained high-rate journal performance remain gates.

## Explicit SQLite backend (separate candidate)

The POSIX backend remains the default. Select SQLite deliberately:

```sh
services/vivo/start-canonical-local.sh --store sqlite --data-dir /absolute/existing/private/directory --port 8766
# Add --material-phase for the separate, initially paused 4D phase world.
```

SQLite requires Node **24.19 or later within the Node 24 line**, with its bundled
SQLite library at least 3.51.3. Supply an already-existing private directory outside
the entire checkout, including paths that a root static server could expose. The
launcher does not create that directory or change permissions. Strict path,
file/sidecar and privacy checks run in Node before any canonical write. A rejected
path leaves no comparison database: in SQLite mode the original comparison uses
volatile in-memory SQLite, exposed as `legacyComparisonPersistence: volatile memory`
in readiness. The original comparison's data does not survive a restart in this mode.
The POSIX comparison database behavior is unchanged.

Existing SQLite files are identified read-only and revalidated under a writer lock
before lifetime ownership and world loading. A refused unknown store keeps its
main/WAL payload bytes; SQLite may update transient SHM lock/index metadata during
that inspection. Main-file headers alone are not used to reject a valid crash-left
WAL checkpoint.

Canonical files are `canonical-world.sqlite` and `canonical-phase.sqlite`, separate
from JSON and comparison data. There is no migration or automatic recovery/reseed.
A new SQLite file beside the corresponding existing canonical JSON file is refused;
choose a distinct approved private directory for an explicitly new world.

The SQLite owner is acquired before world loading or restart lease release and is
held until shutdown finishes session cleanup. Another process cannot read, replace
or restart-release that owner's world. SQLite uses WAL/FULL and complete checkpoints
with the same 64 MiB logical limit and event/byte backpressure. A final synchronous
lease check runs after SQL DML immediately before COMMIT. A fault during storage
permanently closes readiness and further operations on that runtime; timer sweeps
never clear it. The server returns readiness 503 rather than representing stale
memory as a confirmed durable state. Restart must inspect/recover the actual saved
checkpoint; it must not replay an uncertain request. A failed store close terminates
the owning Node process, even if a later close call would appear to succeed.

Readiness/capabilities identify `SQLite WAL/FULL exclusive checkpoint`. No private
path or Node TCP listener is exposed. Normal shutdown closes the store after phase
pump/session cleanup. A startup validation failure also closes an acquired owner.

These checks are Linux synthetic backend and real loopback HTTP evidence. Native
Windows usability is **not accepted**: actual strict DACL/private-directory validation
is still blocked by extra SIDs on the inspected task folder. Do not weaken the gate,
change ACLs automatically, or infer support from portable SQLite tests. A separately
approved native path, exact adapter probe, full Python/Node launch and disk/latency
checks remain necessary. Near-capacity full-checkpoint costs and 64 MiB logical versus
physical DB/WAL size limits are documented in
`coordination/vivo/SQLITE-AUTHORITY-STAGE.md`.

## Verification and deployment contract

`tests/application/test_entrypoint.py` launches the actual Python module, which
launches the actual Node child; it checks the mounted HTML/ESM graph, HTTP guards,
two canonical clients, nested Eyes, target honesty and process restart persistence.
This is real loopback HTTP evidence, not browser/device/public-network evidence.
Adapter and Node-runtime tests cover other deterministic boundaries separately.

GitHub Pages cannot execute this Python+Node service. The existing Pages landing
and deployment workflow are unchanged. Public hosting would need a separately
reviewed runtime, persistent storage, HTTPS and authenticated remote admission.
The original static Studio can remain a comparison fallback; it does not promise
this canonical shared/durable feature set. No paid hosting is provisioned here.
