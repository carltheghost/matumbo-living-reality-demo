# Vivo worker interface freeze v1

`services/vivo/contracts/interfaces.d.ts` is the shared API vocabulary;
`validate.mjs` is the canonical executable envelope/target/receipt guard.
Do not redefine these types independently in a worker module. Python wire bindings
must match the same fixtures. Need a contract change? Send Chat 1 a concrete delta
first; no silent signature changes. The old `viva-shared/1` data is migrated by an
explicit adapter, not renamed destructively.

## Authority and identity (Chat 2)

`Authority.open(options) -> Session`, `getSnapshot() -> detached Snapshot`,
`submit(Command) -> Promise<Receipt>`, `subscribe(fn) -> unsubscribe`, `close()`.
Implement the same API for local and remote modes. Bind actor identity to the
session, not a client-supplied actor field. Ownership, idempotency, stale revision,
lease renewal/expiry, viewer permission, bounds and safe rejection are mandatory.

New command kinds: `grab.begin`, `grab.target`, `grab.end`, `space.enter`,
`space.exit`, `world.fork`. Expected revision is per entity for grabs and per world
for fork; navigation validates stable entity/space and its own observer return
stack, and must not rewrite another Eye. Do not increment entity material revision
for a camera/view update. Receipts identify an authority, accepted sequence and
state hash. `grab.begin` returns `result.leaseId`; entry returns the accepted
space/frame reference in `result`. The authoritative actor comes from Session.
State hash refers to the authority's documented persisted codec; provide cross-
language golden fixtures before clients recompute it. Duplicate IDs with different bodies reject; identical retries return
the prior result. Ambiguous transport timeout requires reconciliation, not replay
of a relative move. Implement durable lineage, nested-space identity and hashes.

The baseline types are a minimum contract, NOT permission to bypass runtime
validation. Reject unsupported dimensions/materials before allocation. Validate
snapshot/entity/atlas bounds before restoring or publishing shared state.

## Targets and input (Chat 3)

InputController: `begin({entity,leaseId,source,inputEpoch})`,
`offer(Frame,observedAt)`, `end(reason)`, `cancel(reason)`, `dispose()`.

Absolute target payload: `entityId, leaseId, source, inputEpoch, targetSeq,
dimension, chart, q, sampleAgeMs`. Source is explicit. Full-D vector and chart are
required. Observed time is a LOCAL monotonic timestamp; sampleAgeMs is computed
locally at SEND. Never compare two devices' monotonic clocks. Authority validates
lease/epoch/sequence and uses its own receipt clock. Claimed age alone is not proof
of sensor quality. 150ms is an initial client rejection budget, not a latency claim.

Keep one in-flight target + newest unsent target. Preview is labelled provisional,
not accepted state. Touch state must not be cancelled by hand loss. Validate frame
transforms before offering targets. Do not send `grab_target` to old relative `move`.

Reuse the exact recovered `research/vivo-phase-fabric/web/target-mailbox.mjs` and its
9 tests as a reference; its send object is NOT the v1 wire envelope. Add a wrapper,
with receipt/revision translation. It lacks lease termination/final-release barriers,
so implement those. On end preserve the final valid target when feasible, then send
release; on loss discard stale motion and release. A cancelled in-flight command may
already be accepted: reconcile it. Preserve existing calibration, worker and lighting
rules through adapters. Raw hand/camera observations must not enter the shared log.

## Material dynamics / learning (Chat 4)

MaterialDriver: `capabilities()`, `step(MaterialStep)->MaterialProposal`,
`checkpoint()`, `restore(checkpoint)` as typed in interfaces.d.ts.

The authority invokes a bounded fixed-step material driver with accepted grips. The
driver proposes field and coordinate/velocity changes plus diagnostics. It must not
allocate IDs, grant permissions, enter worlds, emit accepted history or modify Eyes.
Main/authority validates and commits proposals. Local prediction never becomes a
second competing shared authority. Worker must expose when a requested law/dimension
is unsupported, not fall back to a decorative shader.

Reuse `viva_phase.Grid/PhaseField` from `research/vivo-phase-fabric/viva_phase`.
That solver is a bounded flat-periodic complex field; it is not a curved helium-film
solver. The 4D solver tests include full-axis kinetic terms, norm, time refinement,
checkpointing and independent slices. Actual dynamics need coupling to object grips,
material membership, bounded actuator work and accepted records. No double mass
counting of density + visual tracers. State carries domain/intrinsic dimension and
model/law hashes. Keep existing route guidance, but do not call it material learning.

Each learned role (material, intent, room) has teacher/data split, baseline, numerical
invariants, model hash, rollout checks, promotion criteria and rollback. Never retrain
weights inside the render loop or independently on each client. Supply analytic,
learned, and shadow mode. Mark learned rollout unaccepted until independent tests.

## Main integration / rendering (Chat 1)

Own existing `server/app.py`, `web/shared.js`, `web/render.js`, `web/index.html`,
bridge, asset bootstrap, entry points, contracts and workflow changes. Workers supply
module factories and integration instructions, not competing edits to these files.
Main performs surgical hook changes preserving exports and prior tests.

Renderer accepts `Snapshot + own Eye + separate provisionalTargets + capabilities`.
Never derive canonical coordinates, object existence or authority from a projected
pixel. Splitting/merging material preserves lineage and inner-space handles. Own
Eye return stack survives nested entry. An outside-slice participant is not deleted.
Input, physics, rendering, inference, network and persistence run separately. Reduce
visual samples before starving input; report measured p50/p95, not FPS as input delay.

## Independent gate (Chat 5)

Evidence labels: unit, synthetic-video, in-process, real-loopback-TCP/TLS,
browser-mocked-transport, native-browser-network, physical-device, public-network.
Never aggregate a blocked or skipped probe as a pass. Gate local-first zero-network
use, two authorities' implementations of the same contract, two independent Eyes,
latest-target under delay, input-source isolation, true x4/x11 physics, nested
enter/edit/return, duplicate/stale/conflicting edits, disconnect/restart/replay,
lineage/material state persistence, learned-vs-analytic comparison, glare/dark
failure handling, actual-device latency, camera privacy and intended hosting.

No deployment until code/asset digests and relevant checks match the release commit.
Publish feature PRs only; Tumbo authorizes merges. Existing Pages remains comparison.
