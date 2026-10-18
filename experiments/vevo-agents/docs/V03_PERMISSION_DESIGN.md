# v0.3 permission enforcement design

## Implemented boundary

`v03_permission.py` unifies four capability kinds at one execution boundary:

- internal learned skills;
- local generated executable tools;
- external tool adapters; and
- specialist-model adapters.

The descriptor carries effect class, exact tool version, named workspace, operation/resource/destination scopes, and resource estimates. A pure numerical internal capability can run without a grant only when its action is local-memory-only and both descriptor and fixture executor declare `effect_free`. An internal label never exempts filesystem, network, account, or other protected effects.

Actions are deeply frozen at construction and carry versioned canonical finite JSON containing workspace, requester, capability/executor version, operation, arguments, resolved resource, destination, data category, cost, input versions, and idempotency identity. The authority binds a full action digest and a separate stable operation identity; a model-supplied `approved: true` is rejected at the mapping boundary and cannot create a grant. The broker accepts only opaque identifiers issued by the injected authority. The local authority is intentionally test-only (`production_ready = false`, `durable = false`); no production identity, durable persistence, credential, external provider, or live call exists.

## Grant modes and effective policy

The local test authority exposes three explicit modes: `one_time`, `scoped`, and `workspace_full_access`. `scoped` permits repeated actions inside the approved operation/resource/destination scope; `one_time` binds the complete approved action. The last is the product’s full-permission choice, but only for the named authority-owned workspace and the capability’s declared supported operations/resources. Every mode is finite by expiry, use, and spend limits, visible in the effective-permissions receipt, auditable, and revocable; it is not globally unrestricted.

Receipts preserve requested permissions separately from effective permissions and list exceptions. System safety floors, workspace ownership, out-of-workspace resources, mandatory per-action confirmation, and user handoff cannot be overridden by the broad mode. Safety-critical policy returns an explicit handoff or per-action outcome rather than treating a blanket user choice as a universal override.

## Reservation, delegation, and audit

The authority performs check-and-use reservation under one lock. It binds approving identity, capability/version, action or workspace scope, operation, destination, expiry, use/spend limits, approval mode, and revocation state. A durable-ready reservation state machine records `reserved`, `started` (including dispatch intent), `completed`, or `unknown`; the current implementation is explicitly in-memory and not crash durable. Idempotency keys replay completed identical actions, reject material conflicts, and report in-progress or unknown duplicates without a second fixture call. A generic exception after invocation retains the reservation and yields `uncertain_outcome`; only an adapter-proven pre-effect cancellation releases it.

Delegated contexts contain only an opaque authority-owned identifier. The authority resolves every ancestor and leaf grant live at reservation and immediately before start, and atomically charges all ancestors plus the leaf from one shared ledger. They never union or expand authority; revocation or expiry before start blocks execution, while policy changes after start cannot undo an already-dispatched effect and are recorded in the receipt. Each outcome receives an audit receipt without exposing grant secrets; denied, pending, expired, revoked, cancelled, unavailable, and budget-rejected paths do not run a fixture.

## Unimplemented production scope

The only executor is an in-memory harmless fixture. External tool and specialist adapters are represented by typed capability descriptors and return `unavailable_provider` when no fixture is registered. Production authentication, grant persistence, identity binding, distributed reservations, live calls, user-account changes, and learned routing remain explicitly pending. This foundation is permission plumbing, not a claim of secure production authorization.
