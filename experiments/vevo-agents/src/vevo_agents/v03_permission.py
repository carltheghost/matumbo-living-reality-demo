"""Fail-closed, in-memory permission authority for the v0.3 boundary.

This is a local proof implementation only: it has no production
authentication, durable store, outbox, credentials, or external effects.
It does make the execution boundary explicit: opaque authority-owned grants,
live delegation chains, immutable canonical actions, and a reservation state
machine of reserved -> started -> completed/unknown.
"""

from __future__ import annotations

import hashlib
import json
import math
import secrets
import threading
import time
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Callable, Mapping, Protocol

from .v03_specialist_interface import (
    CapabilityKind,
    ResourceEstimate,
    SystemBudgetReport,
    SystemResourceBudget,
    check_system_budget,
)


PERMISSION_CONTRACT_VERSION = "vevo.v03.permission.contract.v2"
PERMISSION_RESULT_SCHEMA = "vevo.v03.permission.result.v2"
ACTION_CANONICAL_SCHEMA = "vevo.v03.permission.action.v1"
EFFECT_FREE = "effect_free"
EFFECT_PROTECTED = "protected"
EFFECT_SAFETY_CRITICAL = "safety_critical"
EFFECT_CLASSES = frozenset({EFFECT_FREE, EFFECT_PROTECTED, EFFECT_SAFETY_CRITICAL})
GRANT_MODE_ONE_TIME = "one_time"
GRANT_MODE_SCOPED = "scoped"
GRANT_MODE_WORKSPACE_FULL_ACCESS = "workspace_full_access"
GRANT_MODES = (GRANT_MODE_ONE_TIME, GRANT_MODE_SCOPED, GRANT_MODE_WORKSPACE_FULL_ACCESS)
PERMISSION_STATUSES = ("pending", "approved", "denied", "expired", "revoked")
LOCAL_MEMORY_SCOPE = "local-memory"
NO_DESTINATION = "none"


class PermissionError(ValueError):
    """A fail-closed permission, binding, or state error."""


class ExecutionCancelled(PermissionError):
    """An adapter proved that invocation did not produce an effect."""

    def __init__(self, message: str, *, started: bool = False) -> None:
        super().__init__(message)
        self.started = started


def _nonempty(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise PermissionError(f"{label} must be a non-empty string")
    return value


def _nonnegative_int(value: Any, *, label: str) -> int:
    if type(value) is not int or value < 0:
        raise PermissionError(f"{label} must be a non-negative integer")
    return value


def _positive_int(value: Any, *, label: str) -> int:
    if type(value) is not int or value <= 0:
        raise PermissionError(f"{label} must be a positive integer")
    return value


def _finite_float(value: Any, *, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PermissionError(f"{label} must be finite")
    result = float(value)
    if not math.isfinite(result):
        raise PermissionError(f"{label} must be finite")
    return result


class _FrozenMapping(Mapping[str, Any]):
    __slots__ = ("_data",)

    def __init__(self, data: Mapping[str, Any]) -> None:
        self._data = MappingProxyType(dict(data))

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def __iter__(self):
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)

    def items(self):
        return self._data.items()

    def __repr__(self) -> str:
        return repr(self._data)


def _freeze_json(value: Any, *, label: str) -> Any:
    if value is None or isinstance(value, (str, bool)) or type(value) is int:
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise PermissionError(f"{label} must contain finite JSON data")
        return value
    if isinstance(value, Mapping):
        frozen: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise PermissionError(f"{label} object keys must be strings")
            frozen[key] = _freeze_json(item, label=f"{label}.{key}")
        return _FrozenMapping(frozen)
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_json(item, label=f"{label}[]") for item in value)
    raise PermissionError(f"{label} must be finite JSON data")


def _thaw_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw_json(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw_json(item) for item in value]
    return value


def _canonical_bytes(value: Any, *, label: str) -> bytes:
    try:
        return json.dumps(
            _thaw_json(value),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise PermissionError(f"{label} must be finite JSON data") from exc


@dataclass(frozen=True, slots=True)
class CapabilityDescriptor:
    name: str
    tool_version: str
    execution_kind: CapabilityKind
    effect_class: str
    workspace_id: str
    allowed_operations: tuple[str, ...]
    allowed_resource_scopes: tuple[str, ...]
    allowed_destinations: tuple[str, ...]
    max_input_bytes: int
    max_output_bytes: int
    max_spend_units: int
    resident_weight_bytes: int = 0
    resident_ram_bytes: int = 0
    max_latency_ms: int = 0
    cost_units: int = 0
    workspace_owned: bool = True
    requires_user_handoff: bool = False
    requires_per_action_confirmation: bool = False

    def __post_init__(self) -> None:
        _nonempty(self.name, label="capability name")
        _nonempty(self.tool_version, label="tool version")
        if self.execution_kind not in {
            "internal_learned_skill", "local_generated_tool", "external_tool_adapter", "specialist_model_adapter"
        }:
            raise PermissionError(f"unsupported execution kind: {self.execution_kind}")
        if self.effect_class not in EFFECT_CLASSES:
            raise PermissionError(f"unsupported effect class: {self.effect_class}")
        if self.effect_class == EFFECT_SAFETY_CRITICAL and not (
            self.requires_user_handoff or self.requires_per_action_confirmation
        ):
            raise PermissionError("safety-critical capability needs explicit handoff or per-action confirmation")
        _nonempty(self.workspace_id, label="workspace_id")
        for values, label in (
            (self.allowed_operations, "allowed_operations"),
            (self.allowed_resource_scopes, "allowed_resource_scopes"),
            (self.allowed_destinations, "allowed_destinations"),
        ):
            if not values or any(not isinstance(item, str) or not item for item in values):
                raise PermissionError(f"{label} must contain non-empty strings")
            if len(set(values)) != len(values):
                raise PermissionError(f"{label} must not contain duplicates")
        _positive_int(self.max_input_bytes, label="max_input_bytes")
        _positive_int(self.max_output_bytes, label="max_output_bytes")
        _nonnegative_int(self.max_spend_units, label="max_spend_units")
        for value, label in (
            (self.resident_weight_bytes, "resident_weight_bytes"),
            (self.resident_ram_bytes, "resident_ram_bytes"),
            (self.max_latency_ms, "max_latency_ms"),
            (self.cost_units, "cost_units"),
        ):
            _nonnegative_int(value, label=label)
        for value, label in (
            (self.workspace_owned, "workspace_owned"),
            (self.requires_user_handoff, "requires_user_handoff"),
            (self.requires_per_action_confirmation, "requires_per_action_confirmation"),
        ):
            if not isinstance(value, bool):
                raise PermissionError(f"{label} must be boolean")

    def estimate(self) -> ResourceEstimate:
        return ResourceEstimate(self.resident_weight_bytes, self.resident_ram_bytes, self.max_latency_ms, self.cost_units)

    def as_permissions(self) -> dict[str, Any]:
        return {
            "capability": self.name,
            "tool_version": self.tool_version,
            "effect_class": self.effect_class,
            "workspace_id": self.workspace_id,
            "operations": list(self.allowed_operations),
            "resource_scopes": list(self.allowed_resource_scopes),
            "destinations": list(self.allowed_destinations),
            "max_spend_units": self.max_spend_units,
        }


@dataclass(frozen=True, slots=True)
class Action:
    capability: str
    tool_version: str
    workspace_id: str
    operation: str
    resource_scope: str
    data_destination: str
    arguments: Mapping[str, Any]
    spend_units: int
    idempotency_key: str
    requester: str = ""
    resolved_resource: str = ""
    data_category: str = "unspecified"
    input_versions: Mapping[str, str] = field(default_factory=dict)
    _canonical: bytes = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        for value, label in (
            (self.capability, "capability"), (self.tool_version, "tool_version"),
            (self.workspace_id, "workspace_id"), (self.operation, "operation"),
            (self.resource_scope, "resource_scope"), (self.data_destination, "data_destination"),
            (self.idempotency_key, "idempotency_key"), (self.data_category, "data_category"),
        ):
            _nonempty(value, label=label)
        if self.requester:
            _nonempty(self.requester, label="requester")
        if self.resolved_resource:
            _nonempty(self.resolved_resource, label="resolved_resource")
        if not isinstance(self.arguments, Mapping) or not isinstance(self.input_versions, Mapping):
            raise PermissionError("arguments and input_versions must be mappings")
        _nonnegative_int(self.spend_units, label="spend_units")
        frozen_args = _freeze_json(self.arguments, label="arguments")
        frozen_versions = _freeze_json(self.input_versions, label="input_versions")
        if not isinstance(frozen_args, Mapping) or not isinstance(frozen_versions, Mapping):
            raise PermissionError("arguments and input_versions must be mappings")
        object.__setattr__(self, "arguments", frozen_args)
        object.__setattr__(self, "input_versions", frozen_versions)
        object.__setattr__(self, "_canonical", _canonical_bytes(self.canonical_mapping(), label="action"))

    def canonical_mapping(self) -> dict[str, Any]:
        return {
            "schema": ACTION_CANONICAL_SCHEMA,
            "workspace": self.workspace_id,
            "requester": self.requester,
            "capability": self.capability,
            "executor_version": self.tool_version,
            "operation": self.operation,
            "arguments": _thaw_json(self.arguments),
            "resolved_resource": self.resolved_resource or self.resource_scope,
            "resource_scope": self.resource_scope,
            "destination": self.data_destination,
            "data_category": self.data_category,
            "cost": {"spend_units": self.spend_units},
            "input_versions": _thaw_json(self.input_versions),
            "idempotency_key": self.idempotency_key,
        }

    @property
    def canonical_bytes(self) -> bytes:
        return self._canonical

    def requested_permissions(self) -> dict[str, Any]:
        return {
            "capability": self.capability, "tool_version": self.tool_version,
            "workspace_id": self.workspace_id, "operations": [self.operation],
            "resource_scopes": [self.resource_scope], "destinations": [self.data_destination],
            "spend_units": self.spend_units,
        }


def action_from_mapping(value: Mapping[str, Any]) -> Action:
    if not isinstance(value, Mapping):
        raise PermissionError("action must be a mapping")
    required = {"capability", "tool_version", "workspace_id", "operation", "resource_scope", "data_destination", "arguments", "spend_units", "idempotency_key"}
    optional = {"requester", "resolved_resource", "data_category", "input_versions"}
    if set(value) - optional != required:
        raise PermissionError("action has unexpected or missing fields; authorization is not action data")
    return Action(
        capability=value["capability"], tool_version=value["tool_version"], workspace_id=value["workspace_id"],
        operation=value["operation"], resource_scope=value["resource_scope"], data_destination=value["data_destination"],
        arguments=value["arguments"], spend_units=value["spend_units"], idempotency_key=value["idempotency_key"],
        requester=value.get("requester", ""), resolved_resource=value.get("resolved_resource", ""),
        data_category=value.get("data_category", "unspecified"), input_versions=value.get("input_versions", {}),
    )


def canonical_action_bytes(action: Action) -> bytes:
    if not isinstance(action, Action):
        raise PermissionError("action must be an Action")
    return action.canonical_bytes


def _canonical_without(action: Action, *excluded: str, requester: str | None = None) -> bytes:
    mapping = action.canonical_mapping()
    for key in excluded:
        mapping.pop(key, None)
    if requester is not None:
        mapping["requester"] = requester
    return _canonical_bytes(mapping, label="action")


def action_digest(action: Action, *, requester: str | None = None) -> str:
    return hashlib.sha256(action.canonical_bytes if requester is None else _canonical_without(action, requester=requester)).hexdigest()


def authorization_digest(action: Action, *, requester: str | None = None) -> str:
    return hashlib.sha256(_canonical_without(action, "idempotency_key", requester=requester)).hexdigest()


def stable_operation_id(action: Action, *, requester: str | None = None) -> str:
    return hashlib.sha256(_canonical_without(action, "idempotency_key", requester=requester)).hexdigest()


@dataclass(frozen=True, slots=True)
class GrantHandle:
    token: str


@dataclass(frozen=True, slots=True)
class DelegationContext:
    token: str


@dataclass(frozen=True, slots=True)
class PermissionState:
    status: str
    request_id: str
    action_digest: str
    reason: str
    requested_permissions: Mapping[str, Any]
    effective_permissions: Mapping[str, Any] | None = None
    exceptions: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.status not in PERMISSION_STATUSES:
            raise PermissionError(f"unsupported permission status: {self.status}")

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status, "request_id": self.request_id, "action_digest": self.action_digest,
            "reason": self.reason, "requested_permissions": dict(self.requested_permissions),
            "effective_permissions": dict(self.effective_permissions) if self.effective_permissions is not None else None,
            "exceptions": list(self.exceptions),
        }


@dataclass(frozen=True, slots=True)
class AuditReceipt:
    receipt_id: str
    action_digest: str
    status: str
    reason: str
    requested_at: float
    completed_at: float

    def as_dict(self) -> dict[str, Any]:
        return {"receipt_id": self.receipt_id, "action_digest": self.action_digest, "status": self.status, "reason": self.reason, "requested_at": self.requested_at, "completed_at": self.completed_at}


@dataclass(frozen=True, slots=True)
class ExecutionReceipt:
    status: str
    action_digest: str
    output_payload: Mapping[str, Any] | None
    error: Mapping[str, Any] | None
    requested_permissions: Mapping[str, Any]
    effective_permissions: Mapping[str, Any] | None
    exceptions: tuple[str, ...]
    audit: AuditReceipt

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": PERMISSION_RESULT_SCHEMA, "status": self.status, "action_digest": self.action_digest,
            "output_payload": self.output_payload, "error": dict(self.error) if self.error is not None else None,
            "requested_permissions": dict(self.requested_permissions),
            "effective_permissions": dict(self.effective_permissions) if self.effective_permissions is not None else None,
            "exceptions": list(self.exceptions), "audit": self.audit.as_dict(),
        }


class CancellationToken:
    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()


class FixtureExecutor(Protocol):
    capability: str
    tool_version: str
    effect_class: str

    def execute(self, action: Action, cancellation: CancellationToken) -> Mapping[str, Any]:
        ...


class HarmlessFixtureExecutor:
    def __init__(self, capability: CapabilityDescriptor) -> None:
        self.capability = capability.name
        self.tool_version = capability.tool_version
        self.effect_class = capability.effect_class
        self.call_count = 0
        self._lock = threading.Lock()

    def execute(self, action: Action, cancellation: CancellationToken) -> Mapping[str, Any]:
        if cancellation.cancelled:
            raise ExecutionCancelled("cancelled before harmless fixture invocation")
        with self._lock:
            if cancellation.cancelled:
                raise ExecutionCancelled("cancelled before harmless fixture side effect")
            self.call_count += 1
        return {"fixture": "harmless-local", "capability": self.capability, "tool_version": self.tool_version, "action_digest": action_digest(action)}


class AuthorityStore(Protocol):
    """Future durable transaction/store interface; not implemented here."""

    durable: bool

    def transaction(self, operation: str, payload: Mapping[str, Any]) -> Mapping[str, Any]:
        ...


@dataclass(frozen=True, slots=True)
class _GrantConstraints:
    grant_reference: str
    capability: str
    tool_version: str
    workspace_id: str
    operations: frozenset[str]
    resource_scopes: frozenset[str]
    destinations: frozenset[str]
    max_spend_units: int
    approval_mode: str
    approving_identity: str
    exceptions: tuple[str, ...] = ()

    def as_permissions(self) -> dict[str, Any]:
        return {
            "capability": self.capability, "tool_version": self.tool_version, "workspace_id": self.workspace_id,
            "operations": sorted(self.operations), "resource_scopes": sorted(self.resource_scopes),
            "destinations": sorted(self.destinations), "max_spend_units": self.max_spend_units,
            "grant_mode": self.approval_mode, "approval_mode": self.approval_mode, "exceptions": list(self.exceptions),
        }


@dataclass(slots=True)
class _RequestRecord:
    request_id: str
    action: Action
    capability: CapabilityDescriptor
    proposer: str
    bound_action_digest: str
    status: str = "pending"


@dataclass(slots=True)
class _GrantRecord:
    token: str
    request: _RequestRecord
    constraints: _GrantConstraints
    expires_at: float
    max_uses: int
    max_spend_units: int
    used_count: int = 0
    spent_units: int = 0
    status: str = "approved"


@dataclass(slots=True)
class _DelegationRecord:
    token: str
    grant_tokens: tuple[str, ...]


@dataclass(slots=True)
class _Reservation:
    reservation_id: str
    key: tuple[str, str]
    action_digest: str
    operation_id: str
    action_bytes: bytes
    chain: tuple[str, ...]
    spend_units: int
    state: str = "reserved"
    dispatch_intent: bool = False
    started_at: float | None = None
    reason: str = ""


@dataclass(frozen=True, slots=True)
class _AuthorityDecision:
    status: str
    reason: str
    reservation_id: str | None = None
    constraints: _GrantConstraints | None = None
    output_payload: Mapping[str, Any] | None = None
    audit: AuditReceipt | None = None
    exceptions: tuple[str, ...] = ()


class LocalTestAuthority:
    """Lock-protected authority prototype; it is explicitly not crash durable."""

    production_ready = False
    durable = False
    storage_kind = "in_memory_prototype"

    def __init__(self, clock: Callable[[], float] | None = None) -> None:
        self._clock = clock or time.time
        self._lock = threading.RLock()
        self._requests: dict[str, _RequestRecord] = {}
        self._grants: dict[str, _GrantRecord] = {}
        self._delegations: dict[str, _DelegationRecord] = {}
        self._reservations: dict[str, _Reservation] = {}
        self._idempotency: dict[tuple[str, str], tuple[str, str, str]] = {}
        self._receipts: dict[str, ExecutionReceipt] = {}

    def durability_status(self) -> dict[str, Any]:
        return {"durable": False, "storage_kind": self.storage_kind, "crash_recovery": False, "outbox": False, "production_ready": False}

    def submit(self, action: Action, capability: CapabilityDescriptor, proposer: str) -> PermissionState:
        _nonempty(proposer, label="proposer")
        self._validate_action_capability(action, capability)
        request_id = secrets.token_urlsafe(18)
        bound_digest = action_digest(action, requester=action.requester or proposer)
        record = _RequestRecord(request_id, action, capability, proposer, bound_digest)
        with self._lock:
            self._requests[request_id] = record
        return PermissionState("pending", request_id, bound_digest, "awaiting independent authority approval", action.requested_permissions())

    def approve(self, request_id: str, approving_identity: str, expires_at: float, max_uses: int, max_spend_units: int, approval_mode: str, workspace_id: str) -> GrantHandle:
        _nonempty(approving_identity, label="approving_identity")
        if approval_mode not in GRANT_MODES:
            raise PermissionError(f"unsupported grant mode: {approval_mode}")
        if approval_mode == GRANT_MODE_ONE_TIME and max_uses != 1:
            raise PermissionError("one_time grants must have exactly one use")
        expiry = _finite_float(expires_at, label="expires_at")
        if expiry <= self._clock():
            raise PermissionError("expires_at must be in the future")
        _positive_int(max_uses, label="max_uses")
        _nonnegative_int(max_spend_units, label="max_spend_units")
        with self._lock:
            request = self._requests.get(request_id)
            if request is None:
                raise PermissionError("unknown approval request")
            if request.status != "pending":
                raise PermissionError(f"request is not pending: {request.status}")
            if workspace_id != request.capability.workspace_id:
                request.status = "denied"
                raise PermissionError("workspace ownership or scope mismatch")
            if not request.capability.workspace_owned:
                request.status = "denied"
                raise PermissionError("authority does not own this workspace")
            if max_spend_units > request.capability.max_spend_units:
                request.status = "denied"
                raise PermissionError("grant spend limit exceeds capability limit")
            capability = request.capability
            if approval_mode == GRANT_MODE_WORKSPACE_FULL_ACCESS:
                operations, scopes, destinations = (frozenset(capability.allowed_operations), frozenset(capability.allowed_resource_scopes), frozenset(capability.allowed_destinations))
            else:
                operations, scopes, destinations = (frozenset({request.action.operation}), frozenset({request.action.resource_scope}), frozenset({request.action.data_destination}))
            token = secrets.token_urlsafe(32)
            constraints = _GrantConstraints(hashlib.sha256(token.encode()).hexdigest()[:24], capability.name, capability.tool_version, capability.workspace_id, operations, scopes, destinations, max_spend_units, approval_mode, approving_identity)
            self._grants[token] = _GrantRecord(token, request, constraints, expiry, max_uses, max_spend_units)
            request.status = "approved"
            return GrantHandle(token)

    def deny(self, request_id: str, reason: str = "authority denied") -> PermissionState:
        _nonempty(reason, label="reason")
        with self._lock:
            request = self._requests.get(request_id)
            if request is None:
                raise PermissionError("unknown approval request")
            if request.status != "pending":
                raise PermissionError(f"request is not pending: {request.status}")
            request.status = "denied"
            return PermissionState("denied", request.request_id, request.bound_action_digest, reason, request.action.requested_permissions())

    def revoke(self, grant: GrantHandle, reason: str = "authority revoked") -> None:
        _nonempty(reason, label="reason")
        with self._lock:
            self._grant(grant).status = "revoked"

    def state(self, grant: GrantHandle) -> PermissionState:
        with self._lock:
            record = self._grant(grant)
            status = self._current_status(record, self._clock())
            return PermissionState(status, record.request.request_id, record.request.bound_action_digest, f"grant is {status}", record.request.action.requested_permissions(), record.constraints.as_permissions())

    def context_for_grant(self, grant: GrantHandle) -> DelegationContext:
        with self._lock:
            self._grant(grant)
            token = secrets.token_urlsafe(24)
            self._delegations[token] = _DelegationRecord(token, (grant.token,))
            return DelegationContext(token)

    def create_delegation(self, parent: DelegationContext | GrantHandle, child_grant: GrantHandle) -> DelegationContext:
        with self._lock:
            chain = self._delegation_chain(parent)
            child = self._grant(child_grant)
            combined = chain if child.token in chain else chain + (child.token,)
            token = secrets.token_urlsafe(24)
            self._delegations[token] = _DelegationRecord(token, combined)
            return DelegationContext(token)

    def delegation_permissions(self, context: DelegationContext) -> dict[str, Any]:
        with self._lock:
            chain = self._delegation_chain(context)
            constraints = self._live_intersection(chain, self._clock(), allow_nonlive=True)
            if constraints is None:
                raise PermissionError("delegation has no live grants")
            remaining = min(max(0, self._grants[token].max_spend_units - self._grants[token].spent_units) for token in chain)
            result = constraints.as_permissions()
            result.update({"remaining_spend_units": remaining, "ancestor_count": len(chain)})
            return result

    def delegation_constraints(self, grant: GrantHandle) -> _GrantConstraints:
        with self._lock:
            record = self._grant(grant)
            if self._current_status(record, self._clock()) != "approved":
                raise PermissionError("grant is not currently approved")
            return record.constraints

    def reserve(self, grant: GrantHandle, action: Action, capability: CapabilityDescriptor, now: float, *, requires_user_handoff: bool, requires_per_action_confirmation: bool, parent: DelegationContext | None = None) -> _AuthorityDecision:
        with self._lock:
            try:
                chain = self._reservation_chain(grant, parent)
            except PermissionError as exc:
                return _AuthorityDecision("denied", str(exc))
            requester = action.requester or self._grants[chain[0]].request.proposer
            digest = action_digest(action, requester=requester)
            key = (requester, action.idempotency_key)
            prior = self._idempotency.get(key)
            if prior is not None:
                prior_digest, prior_state, prior_reservation = prior
                if prior_digest != digest:
                    return _AuthorityDecision("denied", "idempotency key conflicts with action material")
                if prior_state == "completed":
                    receipt = self._receipts[prior_reservation]
                    return _AuthorityDecision(
                        "idempotent_replay",
                        "completed idempotent action",
                        output_payload=receipt.output_payload,
                        audit=receipt.audit,
                    )
                if prior_state == "unknown":
                    return _AuthorityDecision("uncertain_outcome", "idempotent action has an unresolved outcome; blind rerun is blocked")
                return _AuthorityDecision("pending", "idempotent action is already in progress")
            if requires_user_handoff:
                return _AuthorityDecision("user_handoff_required", "policy requires user handoff")
            if requires_per_action_confirmation and any(self._grants[token].constraints.approval_mode != GRANT_MODE_ONE_TIME for token in chain):
                return _AuthorityDecision("per_action_approval_required", "policy requires explicit one-time approval")
            chain_status = self._chain_status(chain, now)
            if chain_status != "approved":
                return _AuthorityDecision(chain_status, f"grant is {chain_status}")
            constraints = self._live_intersection(chain, now)
            if constraints is None:
                return _AuthorityDecision("denied", "delegation scope is not live")
            if not self._binding_allows(chain, action, capability, requester):
                return _AuthorityDecision("denied", "grant binding does not cover this action")
            if any(self._grants[token].used_count >= self._grants[token].max_uses for token in chain):
                return _AuthorityDecision("denied", "grant use limit exhausted")
            if any(self._grants[token].spent_units + action.spend_units > self._grants[token].max_spend_units for token in chain):
                return _AuthorityDecision("denied", "grant spend limit exhausted")
            reservation_id = secrets.token_urlsafe(18)
            reservation = _Reservation(reservation_id, key, digest, stable_operation_id(action, requester=requester), _canonical_without(action, requester=requester), chain, action.spend_units)
            for token in chain:
                record = self._grants[token]
                record.used_count += 1
                record.spent_units += action.spend_units
            self._reservations[reservation_id] = reservation
            self._idempotency[key] = (digest, "reserved", reservation_id)
            return _AuthorityDecision("reserved", "authority atomically reserved all live ancestors and leaf", reservation_id, constraints)

    def mark_started(self, grant: GrantHandle, action: Action, reservation_id: str, now: float, cancellation: CancellationToken | None = None) -> _AuthorityDecision:
        with self._lock:
            reservation = self._reservations.get(reservation_id)
            if reservation is None or reservation.state != "reserved":
                return _AuthorityDecision("denied", "reservation is missing or no longer reserved")
            if reservation.action_digest != action_digest(action, requester=reservation.key[0]) or reservation.action_bytes != _canonical_without(action, requester=reservation.key[0]):
                return _AuthorityDecision("denied", "canonical action changed before start")
            if grant.token not in reservation.chain:
                return _AuthorityDecision("denied", "grant is not part of reservation chain")
            constraints = self._live_intersection(reservation.chain, now)
            if constraints is None:
                self._cancel_locked(reservation)
                return _AuthorityDecision("denied", "authority was revoked or expired before execution start")
            if cancellation is not None and cancellation.cancelled:
                self._cancel_locked(reservation)
                return _AuthorityDecision("cancelled", "cancelled before dispatch intent")
            reservation.state = "started"
            reservation.dispatch_intent = True
            reservation.started_at = now
            return _AuthorityDecision("started", "dispatch intent recorded before executor invocation", constraints=constraints)

    def commit(self, grant: GrantHandle, action: Action, reservation_id: str, output_payload: Mapping[str, Any], audit: AuditReceipt, now: float) -> tuple[bool, tuple[str, ...]]:
        with self._lock:
            reservation = self._reservations.get(reservation_id)
            if reservation is None or reservation.state != "started" or grant.token not in reservation.chain:
                raise PermissionError("started reservation is missing or mismatched")
            if reservation.action_digest != action_digest(action, requester=reservation.key[0]) or reservation.action_bytes != _canonical_without(action, requester=reservation.key[0]):
                raise PermissionError("canonical action changed at commit")
            current = self._live_intersection(reservation.chain, now, allow_nonlive=True)
            exceptions = ("revoked_after_start_cannot_undo_effect",) if current is None else ()
            reservation.state = "completed"
            self._idempotency[reservation.key] = (reservation.action_digest, "completed", reservation_id)
            self._receipts[reservation_id] = ExecutionReceipt("executed", reservation.action_digest, dict(output_payload), None, action.requested_permissions(), current.as_permissions() if current else None, exceptions, audit)
            return True, exceptions

    def mark_uncertain(self, grant: GrantHandle, action: Action, reservation_id: str, reason: str, audit: AuditReceipt) -> None:
        with self._lock:
            reservation = self._reservations.get(reservation_id)
            if reservation is None or reservation.state != "started" or grant.token not in reservation.chain:
                raise PermissionError("started reservation is missing or mismatched")
            if reservation.action_digest != action_digest(action, requester=reservation.key[0]):
                raise PermissionError("action changed while marking unknown")
            reservation.state = "unknown"
            reservation.reason = reason
            self._idempotency[reservation.key] = (reservation.action_digest, "unknown", reservation_id)

    def cancel(self, grant: GrantHandle, action: Action, reservation_id: str) -> None:
        with self._lock:
            reservation = self._reservations.get(reservation_id)
            if reservation is not None and grant.token in reservation.chain and reservation.state == "reserved":
                self._cancel_locked(reservation)

    def _cancel_locked(self, reservation: _Reservation) -> None:
        for token in reservation.chain:
            record = self._grants[token]
            record.used_count -= 1
            record.spent_units -= reservation.spend_units
        self._idempotency.pop(reservation.key, None)
        self._reservations.pop(reservation.reservation_id, None)

    def _grant(self, grant: GrantHandle) -> _GrantRecord:
        token = self._token(grant)
        record = self._grants.get(token)
        if record is None:
            raise PermissionError("unknown or forged grant handle")
        return record

    def _delegation_chain(self, value: DelegationContext | GrantHandle) -> tuple[str, ...]:
        if isinstance(value, GrantHandle):
            self._grant(value)
            return (value.token,)
        if not isinstance(value, DelegationContext) or value.token not in self._delegations:
            raise PermissionError("delegation context is unknown or forged")
        return self._delegations[value.token].grant_tokens

    def _reservation_chain(self, grant: GrantHandle, parent: DelegationContext | None) -> tuple[str, ...]:
        leaf = self._grant(grant)
        if parent is None:
            return (leaf.token,)
        chain = self._delegation_chain(parent)
        return chain if leaf.token in chain else chain + (leaf.token,)

    def validate_delegation(self, context: DelegationContext) -> None:
        """Validate only authority ownership; liveness is checked at reserve/start."""

        with self._lock:
            self._delegation_chain(context)

    def _chain_status(self, chain: tuple[str, ...], now: float) -> str:
        statuses = [self._current_status(self._grants[token], now) for token in chain]
        if "revoked" in statuses:
            return "revoked"
        if "expired" in statuses:
            return "expired"
        if any(status != "approved" for status in statuses):
            return "denied"
        return "approved"

    def _live_intersection(self, chain: tuple[str, ...], now: float, *, allow_nonlive: bool = False) -> _GrantConstraints | None:
        records = [self._grants[token] for token in chain]
        if not allow_nonlive and any(self._current_status(record, now) != "approved" for record in records):
            return None
        if any(self._current_status(record, now) in {"revoked", "expired"} for record in records):
            return None
        first = records[0].constraints
        operations, scopes, destinations = set(first.operations), set(first.resource_scopes), set(first.destinations)
        max_spend = first.max_spend_units
        exceptions = list(first.exceptions)
        for record in records[1:]:
            constraints = record.constraints
            operations &= constraints.operations
            scopes &= constraints.resource_scopes
            destinations &= constraints.destinations
            max_spend = min(max_spend, constraints.max_spend_units)
            exceptions.extend(item for item in constraints.exceptions if item not in exceptions)
        return _GrantConstraints(first.grant_reference, first.capability, first.tool_version, first.workspace_id, frozenset(operations), frozenset(scopes), frozenset(destinations), max_spend, "delegated_intersection" if len(records) > 1 else first.approval_mode, first.approving_identity, tuple(exceptions))

    def _binding_allows(self, chain: tuple[str, ...], action: Action, capability: CapabilityDescriptor, requester: str) -> bool:
        self._validate_action_capability(action, capability)
        effective = self._live_intersection(chain, self._clock())
        if effective is None or action.workspace_id != effective.workspace_id or not capability.workspace_owned:
            return False
        if action.operation not in effective.operations or action.resource_scope not in effective.resource_scopes or action.data_destination not in effective.destinations:
            return False
        if action.requester and action.requester != requester:
            return False
        leaf = self._grants[chain[-1]]
        if leaf.constraints.approval_mode == GRANT_MODE_ONE_TIME and authorization_digest(action, requester=requester) != authorization_digest(leaf.request.action, requester=leaf.request.proposer):
            return False
        return True

    @staticmethod
    def _token(grant: GrantHandle) -> str:
        return grant.token if isinstance(grant, GrantHandle) and isinstance(grant.token, str) else ""

    @staticmethod
    def _current_status(record: _GrantRecord, now: float) -> str:
        if record.status == "revoked":
            return "revoked"
        if now >= record.expires_at:
            record.status = "expired"
            return "expired"
        return record.status

    @staticmethod
    def _validate_action_capability(action: Action, capability: CapabilityDescriptor) -> None:
        if action.capability != capability.name or action.tool_version != capability.tool_version:
            raise PermissionError("action capability/version does not match descriptor")


class AuditLog:
    def __init__(self) -> None:
        self._entries: list[AuditReceipt] = []
        self._lock = threading.Lock()

    def append(self, receipt: AuditReceipt) -> None:
        with self._lock:
            self._entries.append(receipt)

    def entries(self) -> tuple[AuditReceipt, ...]:
        with self._lock:
            return tuple(self._entries)


class PermissionBroker:
    def __init__(self, authority: LocalTestAuthority, *, clock: Callable[[], float] | None = None, audit_log: AuditLog | None = None) -> None:
        self.authority = authority
        self._clock = clock or time.time
        self.audit_log = audit_log or AuditLog()
        self._capabilities: dict[str, CapabilityDescriptor] = {}
        self._executors: dict[str, FixtureExecutor] = {}

    def register_capability(self, capability: CapabilityDescriptor, executor: FixtureExecutor | None = None) -> None:
        if capability.name in self._capabilities:
            raise PermissionError(f"capability already registered: {capability.name}")
        if executor is not None:
            self._validate_executor(capability, executor)
        self._capabilities[capability.name] = capability
        if executor is not None:
            self._executors[capability.name] = executor

    def request_approval(self, action: Action, proposer: str) -> PermissionState:
        capability = self._get_capability(action)
        self._check_action_shape(action, capability)
        return self.authority.submit(action, capability, proposer)

    def context_for_grant(self, grant: GrantHandle) -> DelegationContext:
        return self.authority.context_for_grant(grant)

    def derive_child_context(self, parent: DelegationContext, child_grant: GrantHandle | None = None) -> DelegationContext:
        self._validate_context(parent)
        return parent if child_grant is None else self.authority.create_delegation(parent, child_grant)

    def delegation_permissions(self, context: DelegationContext) -> dict[str, Any]:
        self._validate_context(context)
        return self.authority.delegation_permissions(context)

    def execute(self, action: Action, grant: GrantHandle | None = None, *, parent: DelegationContext | None = None, cancellation: CancellationToken | None = None) -> ExecutionReceipt:
        now = float(self._clock())
        token = cancellation or CancellationToken()
        requested = action.requested_permissions()
        if token.cancelled:
            return self._receipt("cancelled", action, requested, None, (), "cancelled before permission check", now)
        try:
            capability = self._get_capability(action)
            self._check_action_shape(action, capability)
        except PermissionError as exc:
            return self._receipt("denied", action, requested, None, (str(exc),), str(exc), now)
        effective: Mapping[str, Any] | None = None
        if parent is not None:
            try:
                self._validate_context(parent)
            except PermissionError as exc:
                return self._receipt("denied", action, requested, None, (str(exc),), str(exc), now)
            try:
                effective = self.authority.delegation_permissions(parent)
            except PermissionError:
                # Expiry/revocation is intentionally left for the authority's
                # reserve path so it can return the precise live status.
                effective = None
            if effective is not None and not self._delegation_scope_allows(effective, action):
                return self._receipt(
                    "denied",
                    action,
                    requested,
                    effective,
                    ("delegated context does not permit this action",),
                    "delegation scope denied",
                    now,
                )
        if self._effect_free_misclassified(action, capability):
            return self._receipt("denied", action, requested, effective, ("effect-free capability attempted a protected destination",), "effect boundary denied", now)
        if capability.effect_class == EFFECT_FREE:
            return self._execute_effect_free(action, capability, token, requested, effective, now)
        if grant is None:
            reason = "user_handoff_required" if capability.requires_user_handoff else "grant_required"
            return self._receipt("user_handoff_required" if capability.requires_user_handoff else "denied", action, requested, effective, (reason,), reason, now)
        decision = self.authority.reserve(grant, action, capability, now, requires_user_handoff=capability.requires_user_handoff, requires_per_action_confirmation=capability.requires_per_action_confirmation, parent=parent)
        if decision.status != "reserved":
            effective = decision.constraints.as_permissions() if decision.constraints else effective
            if decision.status == "idempotent_replay":
                return ExecutionReceipt("idempotent_replay", action_digest(action), decision.output_payload, None, requested, effective, decision.exceptions, decision.audit or self._audit(action_digest(action), "idempotent_replay", decision.reason, now, now))
            return self._receipt(decision.status, action, requested, effective, decision.exceptions or (decision.reason,), decision.reason, now)
        reservation_id = decision.reservation_id or ""
        effective = decision.constraints.as_permissions() if decision.constraints else effective
        if token.cancelled:
            self.authority.cancel(grant, action, reservation_id)
            return self._receipt("cancelled", action, requested, effective, (), "cancelled before executor", now)
        executor = self._executors.get(capability.name)
        if executor is None:
            self.authority.cancel(grant, action, reservation_id)
            return self._receipt("unavailable_provider", action, requested, effective, ("no local fixture executor is registered",), "provider unavailable", now)
        start = self.authority.mark_started(grant, action, reservation_id, float(self._clock()), token)
        if start.status != "started":
            return self._receipt(start.status, action, requested, effective, (start.reason,), start.reason, now)
        effective = start.constraints.as_permissions() if start.constraints else effective
        try:
            output = executor.execute(action, token)
            if not isinstance(output, Mapping):
                raise PermissionError("executor output must be a mapping")
            output_bytes = _canonical_bytes(output, label="executor output")
            if len(output_bytes) > capability.max_output_bytes:
                raise PermissionError("executor output exceeds capability output limit")
        except ExecutionCancelled as exc:
            if exc.started:
                return self._unknown(grant, action, reservation_id, requested, effective, str(exc), now)
            self.authority.cancel(grant, action, reservation_id)
            return self._receipt("cancelled", action, requested, effective, (str(exc),), str(exc), now)
        except Exception as exc:
            return self._unknown(grant, action, reservation_id, requested, effective, str(exc), now)
        completed_at = float(self._clock())
        audit = self._audit(action_digest(action), "executed", "authority-approved fixture execution", now, completed_at)
        try:
            _, exceptions = self.authority.commit(grant, action, reservation_id, output, audit, completed_at)
        except PermissionError as exc:
            try:
                self.authority.mark_uncertain(grant, action, reservation_id, str(exc), audit)
            except PermissionError:
                pass
            return self._receipt("uncertain_outcome", action, requested, effective, (str(exc),), "authority commit failed after dispatch", completed_at)
        self.audit_log.append(audit)
        error = {"code": "post_start_policy_change", "reason": exceptions[0]} if exceptions else None
        return ExecutionReceipt("executed", action_digest(action), dict(output), error, requested, effective, exceptions, audit)

    def system_budget(self, controller: ResourceEstimate, capability_names: tuple[str, ...], budget: SystemResourceBudget) -> SystemBudgetReport:
        return check_system_budget(controller, tuple(self._capabilities[name].estimate() for name in capability_names), budget)

    def _execute_effect_free(self, action: Action, capability: CapabilityDescriptor, cancellation: CancellationToken, requested: Mapping[str, Any], effective: Mapping[str, Any] | None, now: float) -> ExecutionReceipt:
        executor = self._executors.get(capability.name)
        if executor is None:
            return self._receipt("unavailable_provider", action, requested, capability.as_permissions(), ("no local effect-free executor is registered",), "provider unavailable", now)
        if cancellation.cancelled:
            return self._receipt("cancelled", action, requested, capability.as_permissions(), (), "cancelled before executor", now)
        try:
            output = executor.execute(action, cancellation)
            if not isinstance(output, Mapping):
                raise PermissionError("executor output must be a mapping")
            if len(_canonical_bytes(output, label="executor output")) > capability.max_output_bytes:
                raise PermissionError("executor output exceeds capability output limit")
        except ExecutionCancelled as exc:
            return self._receipt("cancelled", action, requested, capability.as_permissions(), (str(exc),), str(exc), now)
        except Exception as exc:
            return self._receipt("failed", action, requested, capability.as_permissions(), (str(exc),), "executor failed", now)
        completed_at = float(self._clock())
        audit = self._audit(action_digest(action), "executed", "effect-free local fixture execution", now, completed_at)
        self.audit_log.append(audit)
        return ExecutionReceipt("executed", action_digest(action), dict(output), None, requested, effective or capability.as_permissions(), (), audit)

    def _unknown(self, grant: GrantHandle, action: Action, reservation_id: str, requested: Mapping[str, Any], effective: Mapping[str, Any] | None, reason: str, now: float) -> ExecutionReceipt:
        audit = self._audit(action_digest(action), "unknown", "executor outcome is unresolved", now, float(self._clock()))
        self.authority.mark_uncertain(grant, action, reservation_id, reason, audit)
        self.audit_log.append(audit)
        return ExecutionReceipt("uncertain_outcome", action_digest(action), None, {"code": "uncertain_outcome", "reason": reason}, requested, effective, (reason, "blind rerun blocked by idempotency state"), audit)

    def _get_capability(self, action: Action) -> CapabilityDescriptor:
        if action.capability not in self._capabilities:
            raise PermissionError("capability is not registered")
        return self._capabilities[action.capability]

    @staticmethod
    def _check_action_shape(action: Action, capability: CapabilityDescriptor) -> None:
        if action.tool_version != capability.tool_version:
            raise PermissionError("tool version mismatch")
        if action.workspace_id != capability.workspace_id:
            raise PermissionError("workspace is outside the capability")
        if action.operation not in capability.allowed_operations:
            raise PermissionError("operation is outside the capability")
        if action.resource_scope not in capability.allowed_resource_scopes:
            raise PermissionError("resource scope is outside the capability")
        if action.data_destination not in capability.allowed_destinations:
            raise PermissionError("data destination is outside the capability")
        if action.spend_units > capability.max_spend_units:
            raise PermissionError("action exceeds capability spend limit")
        if len(canonical_action_bytes(action)) > capability.max_input_bytes:
            raise PermissionError("action exceeds capability input limit")

    @staticmethod
    def _validate_executor(capability: CapabilityDescriptor, executor: FixtureExecutor) -> None:
        for name in ("capability", "tool_version", "effect_class", "execute"):
            if not hasattr(executor, name):
                raise PermissionError(f"executor is missing required field: {name}")
        if executor.capability != capability.name or executor.tool_version != capability.tool_version or executor.effect_class != capability.effect_class:
            raise PermissionError("executor capability/version/effect mismatch")

    @staticmethod
    def _effect_free_misclassified(action: Action, capability: CapabilityDescriptor) -> bool:
        return capability.effect_class == EFFECT_FREE and (action.resource_scope != LOCAL_MEMORY_SCOPE or action.data_destination != NO_DESTINATION)

    def _validate_context(self, context: DelegationContext) -> None:
        if not isinstance(context, DelegationContext):
            raise PermissionError("delegation context is not authority-issued")
        self.authority.validate_delegation(context)

    @staticmethod
    def _delegation_scope_allows(effective: Mapping[str, Any], action: Action) -> bool:
        return (
            effective.get("capability") == action.capability
            and action.workspace_id == effective.get("workspace_id")
            and action.operation in effective.get("operations", ())
            and action.resource_scope in effective.get("resource_scopes", ())
            and action.data_destination in effective.get("destinations", ())
            and action.spend_units <= int(effective.get("remaining_spend_units", 0))
        )

    def _audit(self, digest: str, status: str, reason: str, start: float, end: float) -> AuditReceipt:
        return AuditReceipt(secrets.token_urlsafe(12), digest, status, reason, start, end)

    def _receipt(self, status: str, action: Action, requested: Mapping[str, Any], effective: Mapping[str, Any] | None, exceptions: tuple[str, ...], reason: str, now: float) -> ExecutionReceipt:
        audit = self._audit(action_digest(action), status, reason, now, float(self._clock()))
        self.audit_log.append(audit)
        return ExecutionReceipt(status, action_digest(action), None, {"code": status, "reason": reason}, requested, effective, exceptions, audit)


__all__ = [
    "ACTION_CANONICAL_SCHEMA", "Action", "AuditLog", "AuditReceipt", "AuthorityStore", "CapabilityDescriptor", "CancellationToken", "DelegationContext", "EFFECT_CLASSES", "EFFECT_FREE", "EFFECT_PROTECTED", "EFFECT_SAFETY_CRITICAL", "ExecutionCancelled", "ExecutionReceipt", "FixtureExecutor", "GRANT_MODE_ONE_TIME", "GRANT_MODE_SCOPED", "GRANT_MODE_WORKSPACE_FULL_ACCESS", "GRANT_MODES", "GrantHandle", "HarmlessFixtureExecutor", "LOCAL_MEMORY_SCOPE", "LocalTestAuthority", "NO_DESTINATION", "PERMISSION_CONTRACT_VERSION", "PERMISSION_RESULT_SCHEMA", "PermissionBroker", "PermissionError", "PermissionState", "SystemBudgetReport", "SystemResourceBudget", "action_digest", "action_from_mapping", "authorization_digest", "canonical_action_bytes", "stable_operation_id",
]
