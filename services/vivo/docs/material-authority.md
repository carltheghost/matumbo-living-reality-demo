# Host-only atomic phase acceptance, protocol v1

This additive protocol is explicitly `vivo.lease-material/1`. Ordinary
`LocalLeaseWorld.create()` retains strict revision rules. Opt-in phase clients use
the receipt-cursor transitions below; client ports never expose material capture
or apply. No HTTP/client material-proposal endpoint is added. Only a trusted private host
may instantiate the phase solver, capture its inputs, and submit its output.

## Factory, capture, commit

Create a new explicitly seeded world:

```js
const world = await LocalLeaseWorld.create({
  snapshot, store, now,
  materialProtocol: 'vivo.lease-material/1',
  materialInitial: {spaceId, checkpoint}
});
```

The snapshot's selected space must already have the supported 4D phase law,
geometry, unique entity fields, checkpoint-derived q/v and matching field hash.
Initialization does not silently migrate or replace an existing world. Restore
uses the same `materialProtocol` and store, omits `materialInitial`, and validates
the persisted checkpoint against the canonical snapshot. A legacy record cannot
be opted in on restore, and a phase record cannot be restored in generic mode.

`await world.captureMaterial(spaceId)` returns a detached coherent queued capture:

- `snapshot`: current accepted canonical snapshot
- `constraints`: current active targeted leases, including private session binding
- `authorityTimeMs`: actual authority clock sampled during that capture
- `checkpoint`: last accepted complete phase checkpoint
- `diagnostics`, `fieldDiagnostics`: latest accepted measurements, or null / []

`await world.applyMaterialProposal(proposal)` validates and atomically persists the
trusted Python adapter's `vivo.material-proposal.local/1` envelope, returning an
accepted snapshot only after persistence succeeds. The adapter defaults are fixed
for this protocol: maxForce 2, stiffness 2, damping 0. The private host constructs
only that default adapter, identified as `vivo.phase.adapter-default/1`. Hosts must
not substitute a configured actuator or claim another material profile under this
version. Recorded actuator values declare this trusted-host configuration; they
are not independently inferred from field bytes. Node caps the reported force
bound at 2, while Python/host identity owns exact stiffness and solver semantics.

The proposal must match the current world/authority/space, accepted sequence/hash,
field digest, exact entity revisions, and exact currently active accepted lease
proofs. A matching snapshot hash does not bypass wall-clock expiry. Shape, geometry,
law/teacher/model identity, members, codec/hash, bounded finite field bytes, mass,
time/tick, update IDs/charts, exact q/v agreement with the checkpoint and revision
increments of exactly one are independently checked. All supported-space entities
advance every accepted material tick. Node does not reimplement the FFT solver or
claim that an arbitrary hash-valid field is a verified physical solution: the
private Python driver owns the numerical evolution/centroid/energy semantics.

A target outside the selected checkpoint's half-open periodic domain rejects with
`MATERIAL_DOMAIN`; it is not wrapped or clamped and does not poison the accepted
constraint. Existing release/reconciliation remains available.

## Opt-in input revision transitions

Each newly acquired material-space lease records:

- `inputReceiptRevision = entity.revision`
- `materialCoverageRevision = entity.revision`
- `materialInvariant`, a fingerprint of entity identity/structure (everything
  except q/v/revision), world/authority identity, and space structure/geometry/law/
  model/field identity (everything except entities and field.hash)

New `grab.begin` always requires the strict current entity revision. An alive
lease remains held even for another controller in the same session. Acquisition
never inherits any prior lease's receipt cursor or coverage.

`grab.target` requires intact invariant and coverage at the current revision.
Its expected revision can be either the current revision or that lease's last
input receipt revision. On acceptance only its input receipt cursor advances to
the entity revision returned in that receipt. A current-revision target cannot
repair a structural or external-revision gap; it rejects `LEASE_INVALIDATED`.

A material step increments the entity revision by one. Coverage advances only
when prior coverage exactly equals the pre-step revision and the invariant is
unchanged. The input receipt cursor stays fixed across any number of material
steps. Capture and material commit reject an invalidated lease, so its old target
cannot continue driving a changed entity. No external gap is blessed.

`grab.end` may release with the strict current revision, or the last receipt
revision while invariant and coverage remain intact. Structural gaps reject stale
release; strict release or reconciliation can clean up. Session, acquisition ID,
source, input epoch, target ordering and lease expiry fences otherwise remain as
before. Stale-by-age input still rejects at command validation.

An identical duplicate command returns its ORIGINAL saved receipt before current
revision validation, even after a newer target or release/reacquisition. It never
changes either cursor or a newly acquired lease. Reusing its ID with a different
body still rejects. Process-local receipt/session capabilities do not become
valid after restart.

## Persistence and commit fence

Full current field bytes live once at `state.material.checkpoint`, alongside
`protocol` and `spaceId`, inside the ordinary private authority record. They are
not appended to every accepted event. The record digest commits all private state;
the snapshot hash commits the field digest plus canonical entities, leases and
Eyes. Material acceptance updates field, q/v/revisions, simulation time, lease
coverage, accepted sequence/event and both hashes as one save. Failed CAS or a
rejected commit guard leaves the previous record, cursors and published snapshot
unchanged. Existing process-restart semantics revoke leases without resetting the
accepted field or Eyes.

Material stores must explicitly declare `supportsCommitGuard === true` and support
`compareAndSwap(expectedDigest, record, {beforeCommit})`. The synchronous callback
must run at the last reversible transaction point immediately before mutation /
COMMIT, with no intervening await. Its exception must leave the old accepted
record in place and preserve the error. A thenable callback result is rejected.
The memory store implements this; durable adapters must implement the same fence.
An adapter that does not claim support is refused in material mode. The host
trusts the selected store's truthful implementation of its declared capability.

Material events are strictly below 64 KiB and contain input lease provenance,
base/output field hashes, the complete proposal digest, fixed actuator, teacher/
law versions, entity q/v/revisions, tick/time, and bounded numerical diagnostics.
They do not contain field arrays or private session capabilities. Their trajectory
supports audit and reproducibility against retained initial checkpoints; event-only
full field replay/import is not implemented. Same accepted target/release replay
is tested against the actual Python driver on this CPU/runtime. Cross-platform
bitwise FFT equivalence is not claimed.

Recoverable capture races are `MATERIAL_STALE_AUTHORITY`,
`MATERIAL_STALE_FIELD`, `MATERIAL_STALE_REVISION`, and
`MATERIAL_STALE_CONSTRAINTS`. Discard the proposal and capture again. Other
validation, clock, solver or persistence errors require host fault handling; do
not endlessly retry a malformed proposal or an invalidated lease.

## Verification and scope

Run from the repository root with the approved PR75 input overlay mounted:

```sh
node --test services/vivo/tests/authority/*.test.mjs
node --test services/vivo/tests/material-authority/*.test.mjs
python -m unittest discover -s services/vivo_material/tests -v
node --test services/vivo_material/tests/codec.test.mjs
```

These are in-process Node/Python authority/numerical tests. Existing observer,
nested-world and generic input behavior remains covered by its original suite.
Only bounded analytic phase in four spatial dimensions is supported. Other
profiles, learned/shadow material, 11D material, public deployment, camera/device
latency and physical fidelity are not validated or advertised by this change.
