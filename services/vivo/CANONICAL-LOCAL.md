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

Open `http://127.0.0.1:8766/`. Choose Seat one. Open a second browser tab and choose
Seat two. The two seats are local host admission, not verified human identities.
Only one active session is allowed per seat. Reloading/resuming a saved seat
rotates its token, releases prior grips and retains its accepted Eye. Tokens are
kept in tab sessionStorage, never in the checkpoint. A server restart invalidates
all old tokens; explicitly clear/reopen the expired seat if the UI asks.

For direct Python invocation on a supported POSIX environment:

```sh
cd services/vivo
python -m server.local_application --port 8766 --data-dir /absolute/private/path
```

The command binds only `127.0.0.1`. It deliberately has no public-bind flag.

## What is mounted

- Existing index/layout, original WebGL/Canvas renderer and local camera worker
- Frozen absolute-input controller via GripHost and allowlisted ESM routes
- Canonical LocalLeaseWorld behind a private supervised Node stdin/stdout pipe
- Existing POSIX atomic FileAuthorityStore, separate from legacy SQLite state
- Two session-bound local actors; separate saved Eye coordinates, basis and slice
- Explicit mapped root 4D → inner 11D entry and exact outer-Eye return
- Full-dimensional accepted grip targets with capture-time freshness checks
- Distinct provisional and accepted target markers; solid marks use accepted entity coordinates
- Final pointer/hand samples, source-specific loss cleanup and explicit reconcile
- Durable checkpoint confirmation and sanitized state export

Each accepted operation is saved before acknowledgment. The local server enforces
loopback peer/Host and exact Origin for mutation. No forwarded identity is trusted.
Raw camera frames and hand landmarks never enter the authority bridge.

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

The checkpoint contains accepted snapshot/history and separate Eyes; it is not
an event-only replay engine. Existing lock directories after a crash must be
inspected by an operator; the application never steals them. POSIX atomic/fsync
semantics are tested. Native Windows is explicitly blocked before writes: the
actual Node 24 probe fails directory fsync with EPERM. A separately reviewed
compatible storage adapter is required; there is no silent durability downgrade.

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
