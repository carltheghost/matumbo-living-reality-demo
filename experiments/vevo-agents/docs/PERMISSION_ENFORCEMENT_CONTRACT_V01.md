# v0.1 bounded permission enforcement contract

**Title:** v0.1 permission and capability enforcement at the execution boundary

## Metadata

- **Author:** Codex
- **Date:** 2026-10-18
- **Status:** implementation-ready, local test-authority only
- **Version:** `vevo.v03.permission.contract.v2`
- **Owner:** `vevo-agents`
- **Review gate:** security source review before any production authority or executor is connected

## Context

The hybrid system may eventually propose internal learned skills, local generated executable tools, external tool adapters, or specialist-model adapters. Those categories share one execution boundary but must not be conflated. A numerical learned operation can be effect-free; calling an internal capability does not exempt filesystem, network, account, or other protected effects from permission checks. A generated tool is executable code only through a registered executor and does not gain authority by being generated.

This stage implements a bounded permission broker with an injected authority interface. The only concrete authority is an in-memory local test authority, and the only concrete executor is a harmless in-memory fixture. Production authentication, durable grant storage, external tool calls, specialist calls, and real account actions are explicitly pending. The broker does not treat model-supplied `approved: true` or any other action field as authorization.

## Functional Requirements

- FR-1: The capability descriptor MUST identify one execution kind: `internal_learned_skill`, `local_generated_tool`, `external_tool_adapter`, or `specialist_model_adapter`, plus effect class, tool version, named workspace, allowed operations, resource scopes, destinations, and resource limits.
- FR-2: The immutable versioned canonical action MUST bind workspace, requester, capability name, exact executor version, operation, complete arguments, resolved resource, destination, data category, cost, input versions, and idempotency key. Unknown authorization fields, including `approved`, MUST be rejected rather than interpreted.
- FR-3: A neural proposer MAY submit an action or approval request, but only the injected authority MAY issue an opaque grant handle. The broker MUST never manufacture, upgrade, or accept a model-created grant.
- FR-4: Protected effects MUST default deny without an authority-approved grant. Safety-critical effects MUST produce an explicit `user_handoff_required` or `per_action_approval_required` policy outcome; a general blanket grant MUST not bypass that policy.
- FR-5: A trusted grant MUST bind an authenticated approving identity to the full immutable action digest, a distinct stable operation identity, capability/tool version, operation, resource scope, data destination, use limit, spend limit, expiry, approval mode, and revocation state.
- FR-5a: The product MUST expose explicit grant modes `one_time`, `scoped`, and `workspace_full_access`. `workspace_full_access` MUST mean full supported access only within a named workspace owned by the authority, with visible effective scope, explicit user approval, expiry, revocation, and audit. It MUST NOT mean globally unrestricted access.
- FR-5b: Requested permissions and effective permissions MUST be reported separately, with explicit exceptions for system safety floors, denied ownership, mandatory per-action confirmation, and user handoff. A broad workspace grant MUST NOT override those exceptions.
- FR-6: Permission states MUST remain distinct: `pending`, `approved`, `denied`, `expired`, and `revoked`. A state transition MUST be auditable and an invalid or forged handle MUST not become approved.
- FR-7: The broker MUST recheck authority, exact canonical action bytes, scope, limits, expiry, revocation, and cancellation immediately before executor invocation. The authority MUST record dispatch intent before invocation and reserve use/spend atomically across every live ancestor and the leaf so concurrent callers cannot double-use a grant.
- FR-8: Execution MUST support idempotency keys, cancellation before effects, complete audit receipts, and explicit `reserved`, `started`, `completed`, and `unknown` outcomes. An idempotency-key collision with different action material MUST fail closed; an unknown outcome MUST survive expiry/reapproval and block blind rerun.
- FR-9: Nested or delegated calls MUST carry only opaque authority-owned identifiers. The authority MUST resolve the live intersection of parent and child grant capabilities, operations, scopes, destinations, expiry, revocation, use, and shared spend. Delegation MUST never union or expand authority, and generated tools MUST not approve themselves or escalate capabilities.
- FR-10: The first executor set MUST be harmless local fixtures. Internal pure numerical capabilities MAY run without a grant only when their descriptor and executor both declare effect-free behavior and the action remains local-memory-only. Any protected destination remains subject to a grant, regardless of execution kind.
- FR-11: Resource accounting MUST include the controller and every resident or called capability, including weights/RAM, latency, input/output bytes, uses, and spend where applicable. A small controller MUST not be represented as the total system cost.
- FR-12: The permission module MUST provide explicit seams for a durable transactional authority/store without claiming that the current in-memory implementation authenticates identities, survives crashes, or grants real access.

## Non-Functional Requirements

- NFR-1: The default policy MUST be deny for protected and safety-critical effects.
- NFR-2: Grant tokens and authority decisions MUST be opaque to the model and must be validated by the injected authority, not by a caller-supplied boolean or dictionary.
- NFR-3: Check, dispatch-intent recording, and reservation MUST be atomic within the local authority; no check-then-use race may permit concurrent double consumption.
- NFR-4: Canonical action serialization MUST be deterministic, deeply immutable, finite JSON with sorted keys and no truncation. Material argument, requester, destination, scope, operation, input-version, or tool-version changes MUST change the action digest.
- NFR-5: Denied, expired, revoked, pending, cancelled, and budget-rejected actions MUST invoke no executor side effect.
- NFR-6: The implementation MUST use local standard-library primitives only and MUST not access network, filesystem, shell, process, credentials, external providers, or account permissions.
- NFR-7: Audit records MUST expose outcome and action digest without exposing grant secrets; the audit log MUST be append-only within the local test implementation.
- NFR-8: Production authority, durable storage, crash recovery, authenticated identity, outbox dispatch, and real executor adapters MUST be marked pending rather than approximated by insecure local logic.

## Acceptance Criteria

### AC-1: Capability classification and effect boundary (FR-1, FR-10)

Given descriptors for an internal learned skill, local generated tool, external tool adapter, and specialist-model adapter, when they are registered, then their execution kinds and effect classes MUST remain explicit. Given an internal descriptor that claims effect-free execution but targets a filesystem or network destination, when execution is attempted, then it MUST be denied before the fixture runs.

### AC-2: Canonical action and forged approval rejection (FR-2, FR-3, NFR-2, NFR-4)

Given a valid action, when it is canonicalized, then its digest MUST include complete arguments, exact tool version, scope, operation, destination, spend, and idempotency key. Given an action mapping containing `approved: true`, a forged grant handle, or an unknown authorization field, when it reaches the broker, then it MUST fail closed without executor activity.

### AC-3: Pending, approval, denial, expiry, and revocation states (FR-4, FR-5, FR-6)

Given a protected action, when approval is requested, then its state MUST be `pending` and no executor MUST run. Given a local authority approval, denial, expiry, or revocation, when the same action is attempted, then the broker MUST report the matching distinct state and MUST not collapse it into success or generic denial.

### AC-4: Exact grant binding and material changes (FR-5, FR-5a, FR-7)

Given an approved grant bound to one action, when its arguments, destination, scope, operation, or tool version changes, then the authority recheck MUST reject the request before execution. A matching complete action MUST remain eligible until an independent limit, expiry, revocation, or cancellation applies.

### AC-5: Atomic use and spend limits (FR-5, FR-7, NFR-3)

Given a grant with one remaining use and a finite spend limit, when two concurrent callers race to execute the exact action, then at most one executor call MUST occur and the other result MUST be a typed in-progress, limit, or replay outcome. Given a request over the spend limit, then no reservation or side effect MUST occur.

### AC-6: Idempotency and cancellation (FR-8, NFR-5)

Given a completed action with an idempotency key, when the same canonical action is submitted again, then the broker MUST return an idempotent replay without a second executor call. Given the same key with changed material, then it MUST fail closed. Given cancellation before reservation or after reservation but before executor invocation, then the reservation MUST be cancelled and no executor side effect MUST occur. Given a generic executor exception after dispatch, then the outcome MUST be `uncertain_outcome`, the reservation/use/spend MUST remain held, and a same-key retry MUST not invoke the executor again.

### AC-7: Nested intersection and no escalation (FR-9)

Given a parent context permitting capability A, operation `read`, scope `local`, destination `none`, and spend 5, when a child requests a broader operation, scope, destination, capability, or spend, then the child MUST be denied. Given a child grant narrower than the parent, then the derived context MUST be the set intersection and never the union. The context object MUST contain no copied permission fields; revoking or expiring any ancestor after derivation MUST be observed at the next reservation/start check.

### AC-8: Safety-critical policy outcome (FR-4)

Given a safety-critical action and a general grant, when execution is attempted, then the broker MUST return `user_handoff_required` or `per_action_approval_required` and MUST not execute. Only an explicit per-action authority result MAY satisfy that policy; a blanket user permission flag MUST not override it.

### AC-9: Audit receipts and denial side effects (FR-7, FR-8, NFR-7)

Given any request outcome, when it completes, then an audit receipt MUST record action digest, outcome, timing, and reason without grant secrets. Given denied, expired, revoked, pending, cancelled, or budget-rejected requests, then the harmless fixture counter MUST remain unchanged.

### AC-10: Resource accounting and unavailable production seams (FR-11, FR-12, NFR-8)

Given a controller estimate and multiple capability estimates, when the system budget is checked, then totals MUST include all components. Given the production authority or executor adapter seam, when inspected, then it MUST be explicitly unavailable/pending and MUST not claim authenticated access or live execution.

### AC-11: Workspace full-access mode and effective exceptions (FR-5a, FR-5b)

Given a user-approved `workspace_full_access` grant for an authority-owned workspace, when a supported in-workspace action is requested, then the receipt MUST show the requested and effective permissions separately and may execute within the grant limits. Given an out-of-workspace action, revoked/expired grant, safety-floor action, mandatory per-action confirmation, or user-handoff action, when the same broad grant is used, then the effective permissions MUST exclude that action and execution MUST be denied or handed off.

## Edge Cases

- EC-1: A forged handle with a valid-looking token string is not a grant and MUST be rejected by the injected authority.
- EC-2: `approved: true` in model-supplied arguments or mappings is ordinary untrusted input and MUST never authorize an action.
- EC-3: A grant for tool version `v1` MUST not authorize `v2`, even when the operation name is unchanged.
- EC-3a: `workspace_full_access` is bounded to its named authority-owned workspace and MUST not authorize another workspace or resource owner.
- EC-4: A changed nested argument, data destination, resource scope, or spend value is a material action change.
- EC-5: A grant at exact expiry is expired; clock movement MUST not resurrect it.
- EC-6: Revocation wins over remaining uses and spend.
- EC-7: A duplicate idempotency key with identical action is replay; the same key with a changed digest is a conflict.
- EC-7a: Changing only the idempotency key does not change semantic permission scope, but it does create a distinct replay record and consumes a separately bounded use/spend reservation.
- EC-8: A cancellation after a fixture has started MUST be reported according to executor semantics; it MUST not falsely claim that a side effect was undone.
- EC-9: A child call cannot add a capability, operation, destination, scope, or spend limit to its parent context.
- EC-10: An internal effect-free numerical operation with a filesystem/network destination is misclassified and MUST be denied.
- EC-11: An unavailable external adapter is a typed unavailable/pending provider outcome, not a fabricated specialist result.
- EC-12: A safety-critical action always has an explicit user-handoff/per-action policy outcome.
- EC-13: Requested permission can be broader than effective permission; the receipt MUST preserve both and list the exception.

## API Contracts

This is a local Python API and intentionally has no HTTP endpoint.

```text
canonical_action_bytes(action: Action) -> bytes
action_digest(action: Action) -> str
request_approval(action: Action, proposer: str) -> PermissionState
execute(action: Action, grant: GrantHandle | None,
        parent: DelegationContext | None, cancellation: CancellationToken | None)
        -> ExecutionReceipt
LocalTestAuthority.submit(action, proposer) -> PermissionState
LocalTestAuthority.approve(request_id, approving_identity, expires_at,
                           max_uses, max_spend_units, approval_mode,
                           workspace_id) -> GrantHandle
```

The authority and executor are injected interfaces. The broker never exposes a production authentication implementation. A `GrantHandle` is opaque to callers and is trusted only after authority validation.

## Data Models

| Model | Required fields | Invariants |
| --- | --- | --- |
| Capability descriptor | kind, effect class, name, tool version, workspace, operations, scopes, destinations, limits | Exact version/effect identity; workspace is authority-owned; no protected effect-free destination |
| Action | capability, version, workspace, operation, scope, destination, arguments, spend, idempotency key | Canonical finite JSON; no authorization fields; all material fields digest-bound |
| Permission state | request id, status, action digest, reason | Status is pending/approved/denied/expired/revoked and transitions are explicit |
| Grant handle | opaque authority-issued token | Caller cannot mint approval by constructing a matching-looking mapping |
| Delegation context | opaque authority-owned identifier only | Live ancestor chain is resolved by the authority; no permission snapshot is trusted |
| Reservation | authority-owned reservation id, operation id, action digest, canonical bytes, chain, dispatch intent, state | Atomically consumes shared ancestor/leaf use/spend and transitions reserved/started/completed/unknown |
| Execution receipt | status, action digest, requested/effective permissions, exceptions, output/error, audit receipt | No receipt claims success without executor invocation and authority commit |
| Audit receipt | id, digest, outcome, reason, timestamps | Append-only local record; no grant secret |
| Resource estimate | weights/RAM/latency/bytes/cost | Totals include controller and all capabilities |

## Out of Scope

- OS-1: Production authentication, authorization, durable grant storage, identity verification, secrets management, or account permission changes.
- OS-2: Live filesystem, network, shell, process, external-tool, specialist-model, payment, or account execution.
- OS-3: A neural router, a model-generated approval grant, or a rule table relabeled as learned routing.
- OS-4: Treating internal learned numerical operations as executable code or allowing them to bypass effect checks.
- OS-5: Automatic user-permission overrides for safety-critical actions; those require explicit policy outcomes and future user handoff.
- OS-6: Distributed consensus or cross-process reservation beyond the local test authority lock.
- OS-7: Changes to the existing hybrid core, geometry module, tool grammar, historical reports, or checkpoints.
- OS-8: Crash durability, transactional persistence, outbox dispatch, and reconciliation of unknown external outcomes; the current store reports these as unavailable.
