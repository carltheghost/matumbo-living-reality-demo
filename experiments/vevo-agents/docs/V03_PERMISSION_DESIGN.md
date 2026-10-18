# v0.3 permission enforcement design

## Implemented boundary

`v03_permission.py` unifies four capability kinds at one execution boundary:

- internal learned skills;
- local generated executable tools;
- external tool adapters; and
- specialist-model adapters.

The descriptor carries effect class, exact tool version, named workspace, operation/resource/destination scopes, and resource estimates. A pure numerical internal capability can run without a grant only when its action is local-memory-only and both descriptor and fixture executor declare `effect_free`. An internal label never exempts filesystem, network, account, or other protected effects.

Actions are canonical finite JSON and digest all material fields. The authority binding uses the semantic action digest (idempotency key excluded from permission identity), while the full action digest remains in audit and replay records. Authorization fields are not action data: a model-supplied `approved: true` is rejected at the mapping boundary and cannot create a grant. The broker accepts only an opaque handle issued by the injected authority. The local authority is intentionally test-only (`production_ready = false`); no production identity, durable persistence, credential, external provider, or live call exists.

## Grant modes and effective policy

The local test authority exposes three explicit modes: `one_time`, `scoped`, and `workspace_full_access`. The last is the product’s full-permission choice, but only for the named authority-owned workspace and the capability’s declared supported operations/resources. It is finite by expiry, use, and spend limits, visible in the effective-permissions receipt, auditable, and revocable; it is not globally unrestricted.

Receipts preserve requested permissions separately from effective permissions and list exceptions. System safety floors, workspace ownership, out-of-workspace resources, mandatory per-action confirmation, and user handoff cannot be overridden by the broad mode. Safety-critical policy returns an explicit handoff or per-action outcome rather than treating a blanket user choice as a universal override.

## Reservation, delegation, and audit

The authority performs check-and-use reservation under one lock. It binds approving identity, capability/version, action or workspace scope, operation, destination, expiry, use/spend limits, approval mode, and revocation state. Idempotency keys replay completed identical actions, reject material conflicts, and report in-progress duplicates without a second fixture call. Cancellation before invocation releases the reservation; fixture cancellation cannot claim that a side effect was undone.

Delegated contexts are broker-issued and intersect capabilities, operations, scopes, destinations, workspaces, and remaining spend. They never union or expand authority. Each outcome receives an audit receipt without exposing grant secrets; denied, pending, expired, revoked, cancelled, unavailable, and budget-rejected paths do not run a fixture.

## Unimplemented production scope

The only executor is an in-memory harmless fixture. External tool and specialist adapters are represented by typed capability descriptors and return `unavailable_provider` when no fixture is registered. Production authentication, grant persistence, identity binding, distributed reservations, live calls, user-account changes, and learned routing remain explicitly pending. This foundation is permission plumbing, not a claim of secure production authorization.
