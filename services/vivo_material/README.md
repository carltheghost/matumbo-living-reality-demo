# Bounded 4D phase material

This additive implementation evolves an actual four-spatial-dimensional complex
field through the unmodified recovered numerical teacher. It is a material
proposal component, not a second authority or a completed Vivo release. It does
not alter the original solver, renderer, input/mailbox, host or lease authority.

## Implemented law and evidence

Teacher: `research/vivo-phase-fabric/viva_phase/solver.py`, SHA-256
`0580e63e9a7dac96b70ffd5ed559b2ccd063f0526066fe38bafa571ca0d27947`.
The file hash is checked before loading. No second numerical solver is substituted.
The equation, in dimensionless units, is

    i dψ/dt = (-½ Δ + V + g |ψ|²) ψ

All four spatial axes participate in the spectral Laplacian. The clock is separate.
Each persistent entity has one distinct field population and one unique membership.
Density is |ψ|². Centroids and rendered samples add no material mass.

An accepted full-dimensional target Q produces the smooth periodic compliant trap

    V(x) = s Σᵢ κ/kᵢ² [1 - cos(kᵢ(xᵢ - Qᵢ))],  kᵢ = 2π/Lᵢ
    s = min(1, Fmax / sqrt(Σᵢ(κ/kᵢ)²))

Thus the pointwise acceleration/force-per-unit-mass magnitude is bounded by Fmax.
Finite stiffness changes phase, flow and density through the field equation. It
never replaces density or a canonical position with Q. A released/expired grip
removes its potential; it does not delete matter or cancel existing dynamics.
Time-dependent potential changes supply signed work ∫ρ(Vnew−Vold)dV; the energy
residual measures splitting error after accounting for that work. There is no
hidden norm renormalization and no dissipative mechanism.

Entity q is the circular density centroid on each periodic axis. Entity v is its
instantaneous tangent computed from the semidiscrete density equation, not a
copied target or the average material momentum. `meanCurrentPerMass` is separately
reported, along with centroid coherence and high-frequency spectral mass. A field
with coherence below 0.015 rejects the entire proposal because its centroid is
no longer a defensible object position. A spectral-tail warning is reported above
0.01 high-frequency mass fraction. It is a warning, not an accuracy certificate.

Evidence lives in `evidence/`. Run from the repository root:

    python -m unittest discover -s services/vivo_material/tests -v
    node --test services/vivo_material/tests/codec.test.mjs
    python -m services.vivo_material.verify

The tests cover the independent four-axis analytic plane wave, exact comparison
to the frozen teacher for an independently composed trap, x4 density/current and
centroid response, bounded driving, temporal refinement, mass and energy behavior,
release, unique mass membership, observer immutability, atomic failed steps,
JSON restart and whole-trajectory replay, stale/injected authority inputs, and
Python/Node checkpoint hashing and adversarial schema/hash/alias validation. These are headless local CPU tests. They are not
browser, physical-device, public-network, spatial-convergence or helium tests.

## Supported configurations

- Exactly 4 spatial dimensions and intrinsic dimension 4
- Profile `phase`, analytic mode, defocusing coupling 0–10, no learned models
- Flat Cartesian periodic torus; each length 4–32 model units
- Even resolutions 8–16 per axis, maximum 262,144 total cells
- 1–4 distinct entity fields; default one 8⁴ field with initial mass 1
- Initial mass 0.01–100 per entity, initial velocity zero
- Fixed step chosen by host, 0.0001 ≤ dt ≤ 0.02; maximum 1,000,000 ticks
- 0 ≤ stiffness ≤ 4, 0 ≤ maximum force per unit mass ≤ 4, damping exactly 0
- Default domain coordinates [-4,4) on every axis; arbitrary 1,000-unit protocol
  coordinates are not silently mapped into this small field domain

The upper-resolution bound is an allocation bound, not a frame-rate guarantee.
Local measurements in the JSON report show 16⁴ takes substantially longer than
8⁴. Keep input, rendering, physics and persistence separately scheduled and use a
worker/thread for numerical work. No input latency is inferred from step timings.

Only `phase` is implemented. `stable`, `elastic`, `viscous`, `surface`, `adaptive`,
other dimensions (including 11D), curved metrics, nonperiodic boundaries, damping,
learned/shadow mode and unsupported resolutions are rejected explicitly. A 4D test
does not validate 11D material. This is not a helium two-fluid model, a liquid
surface model, a solid elasticity law, or intelligence. Training, held-out whole
trajectory evaluation, strong baselines and promotion/rollback remain separate
unimplemented stages. Spatial convergence and long-horizon fidelity remain gates;
conserved mass alone is insufficient evidence of accuracy.

## Public Python API

    from services.vivo_material import PhaseMaterialDriver, AcceptedMaterialAdapter

`PhaseMaterialDriver.initialize(space, shape=(8,8,8,8), lengths=(8,8,8,8),
mass=1, coupling=1, simulation_time=0)` returns a driver. Initialization accepts
only a declared supported space:

    dimension = intrinsicDimension = 4
    law = {"id": "vivo.phase.periodic-compliant", "version": "1"}
    atlasId = "atlas.periodic-cartesian.v1"
    metricId = "metric.flat-euclidean.v1"
    topologyId = "topology.periodic-torus.v1"
    modelHashes = []

Each entity must have `materialProfile: "phase"`, four q/v coordinates, a stable
id/chart, a nonnegative revision and exactly one unique `fieldMembership` id. No
object IDs, roles, permissions, nested handles, lineage or Eyes are allocated or
changed by this component. Adding/removing/splitting fields is rejected pending
an explicit mass-disposition and lineage mechanism. Releasing a lease is supported.

`checkpoint()` returns detached candidate state; `restore(checkpoint)` validates
codec, model/law/reference versions, allocation, hash, mass, q/v against actual
field observables, then atomically replaces driver-local state.

`step(MaterialStep)` implements the frozen contract vocabulary (`space`,
`fieldState`, `grips`, `dt`, `tick`, `randomState: "deterministic:none"`,
`mode: "analytic"`). It returns a `MaterialProposal` with fieldState,
entityUpdates, diagnostics, lawVersion, modelHashes and randomState. Additional
fieldDiagnostics disclose numerical measurements. All entities are validated and
computed before candidate state changes. The driver itself does NOT authenticate
grips: production must use the trusted adapter below. A driver's latest candidate
is not accepted merely because step or checkpoint succeeds.

`observe(entity_id, axes, fixed)` returns detached density and phase slices from
the driver checkpoint. Supply every hidden coordinate index; viewing never evolves
or changes the field. Production observation must construct the driver from the
last accepted checkpoint, not an in-flight proposal.

## Trusted authority adapter and atomic acceptance

Construct once in the private host:

    adapter = AcceptedMaterialAdapter(read_authority,
        world_id="world.1", authority_id="authority.1", space_id="space.phase")

`read_authority()` is a host-provided callable returning one coherent capture:

    {"snapshot": canonical_snapshot,
     "constraints": authority.constraints(),
     "authorityTimeMs": authority_clock_now}

Never expose that callback, or accept this capture from an HTTP/client request.
The snapshot must identify the expected authority/world, and the selected space's
`field` must contain `codec: "vivo.material.phase/1"` and `hash: checkpoint.digest`.
Initialization of that field descriptor/checkpoint must be committed by the owner.

    proposal = adapter.propose(accepted_checkpoint,
        expected_sequence=snapshot["acceptedSequence"],
        expected_state_hash=snapshot["stateHash"], dt=0.02, tick=next_tick)

The adapter re-reads its trusted owner, derives grips only from active accepted
leases, validates their full-dimensional frame, metadata, bounds, uniqueness and
entity revision, and rejects stale sequence/hash/time/checkpoint provenance. A
client cannot pass a grip, snapshot or claimed accepted receipt to this API.
Expired/missing constraints mean no force. Canonical lease authority remains
responsible for authentic session/actor binding and monotonically accepting epochs
and target sequences; this component does not invent a second authentication layer.

The proposal includes `worldId`, `authorityId`, `spaceId`, `baseSequence`,
`baseStateHash`, `baseFieldDigest`, `baseEntityRevisions`, `acceptedLeaseProofs`,
`constraintDigest`, `capturedAtMs`, dt and tick. Proofs exclude private session
capabilities. The word "proof" means captured accepted provenance; it is not a
signature or client authorization credential.

Before changing accepted state, the parent's authority-owned serialized commit
must independently:

1. Recheck world/authority/space, base sequence/state hash, base field hash, and
   every entity revision. Reject a proposal raced by a new target, release,
   expiry, navigation or another accepted change. Capture and commit must share
   the real authority clock; recheck every used lease is still active.
2. Compare the proposal's lease metadata/targets with current accepted constraints;
   reject injected, changed, removed or expired constraints. A matching base state
   hash alone does not prove a wall-clock lease is still alive.
3. Validate supported law/domain/dimension/profile, field checksum and bounded
   payload, exact entity set/IDs/charts, next tick/time, finite q/v/mass/diagnostics,
   and proposed revisions exactly one above base. The private solver is a trusted
   computation service; do not accept material proposals from public clients.
4. Atomically persist the new material checkpoint together with updated entity
   q/v/revisions, `space.field.hash`, simulationTime and accepted event/hash.
   Only then publish accepted snapshots. Failed CAS/persistence leaves the prior
   checkpoint authoritative; discard the candidate and capture fresh state.
5. On restart, restore the accepted field checkpoint. Existing authority restart
   semantics revoke process-local leases. The next field step removes any old
   actuator potential and records that signed work; it does not reset the field.

This patch deliberately does not add that shared authority hook or enable the
app's material capability. The parent/app owner performs that separately reviewed
integration. Every material step advances entity material revision, so input
must consume updated accepted snapshots/receipts and correctly handle stale
revision races. Do not weaken canonical stale-revision validation to mask them.

## Cross-language checkpoint hash

Checkpoint schema is `vivo.material.phase/1`, hash codec
`vivo.f64-json-sha256/1`. Complex field bytes are C-order little-endian complex128
(real/imag float64 pairs); potentials are C-order little-endian float64, base64.
No pickle or compressed archive is accepted. State includes grid/domain, clock,
law/model/reference versions, stable membership, original mass and current q/v.

For hashing, omit `digest` and recursively encode every value with an unambiguous
type tag: `['number', '<little-endian IEEE754 double hex>']`, `['string', value]`,
`['boolean', value]`, `['null']`, `['array', encodedItems]`, or
`['object', [[key, encodedValue], ...]]`. Object keys are ASCII, maximum 128
characters, sorted lexicographically. Negative zero is normalized to zero.
Numeric magnitudes cannot exceed 2^53−1. Compact ASCII JSON of the typed tree is
SHA-256 hashed. Traversal rejects cycles, depth above 32, over 10,000 nodes or
more than 16 Mi UTF-16 code units of string payload. Checkpoint/record keys are exact.
This prevents structural type collisions and Python/Node number/key rendering
differences. `codec.mjs` exports `materialDigest(value)` and
`verifyMaterialDigest(checkpoint)` for the Node host. Hash verification alone is
not semantic validation or authorization. The cross-language tests include real
stepped fields, exponent notation, Unicode and numeric-looking object keys.

Replay equality is established for the same recorded accepted target trajectory,
NumPy version and tested CPU environment. Bitwise cross-platform FFT equivalence
is not claimed. Field state, model/law versions and work diagnostics must accompany
accepted history; observer selections must not become material input.
