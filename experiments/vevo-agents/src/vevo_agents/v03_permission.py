"""Bounded permission enforcement at the v0.3 execution boundary.

The module unifies internal learned skills, local generated tools, external
tool adapters, and specialist-model adapters under one capability check.  It
contains only an in-memory local test authority and a harmless fixture
executor.  No production identity, durable grant store, external call,
credential, filesystem, network, or account action is implemented here.

The model may propose an action, but it cannot mint or upgrade a grant.  The
authority owns grant state and performs atomic use/spend reservation.  A
constant or learned numerical operation is effect-free only when both its
declared capability and executor stay inside the local-memory boundary.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Mapping, Protocol, TypeAlias

from .v03_specialist_interface import (
    CapabilityKind,
    ResourceEstimate,
    SystemBudgetReport,
    SystemResourceBudget,
    check_system_budget,
)


PERMISSION_CONTRACT_VERSION = "vevo.v03.permission.contract.v1"
PERMISSION_RESULT_SCHEMA = "vevo.v03.permission.result.v1"
EFFECT_FREE = "effect_free"
EFFECT_PROTECTED = "protected"
EFFECT_SAFETY_CRITICAL = "safety_critical"
EFFECT_CLASSES = frozenset({EFFECT_FREE, EFFECT_PROTECTED, EFFECT_SAFETY_CRITICAL})
GRANT_MODE_ONE_TIME = "one_time"
GRANT_MODE_SCOPED = "scoped"
GRANT_MODE_WORKSPACE_FULL_ACCESS = "workspace_full_access"
GRANT_MODES = (
    GRANT_MODE_ONE_TIME,
    GRANT_MODE_SCOPED,
    GRANT_MODE_WORKSPACE_FULL_ACCESS,
)
PERMISSION_STATUSES = ("pending", "approved", "denied", "expired", "revoked")
LOCAL_MEMORY_SCOPE = "local-memory"
NO_DESTINATION = "none"


class PermissionError(ValueError):
    """A fail-closed permission or capability error."""


class ExecutionCancelled(PermissionError):
    """A cancellation was observed before or at fixture invocation."""


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


def _finite_json_bytes(value: Any, *, label: str) -> bytes:
    try:
        return json.dumps(
            value,
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
            "internal_learned_skill",
            "local_generated_tool",
            "external_tool_adapter",
            "specialist_model_adapter",
        }:
            raise PermissionError(f"unsupported execution kind: {self.execution_kind}")
        if self.effect_class not in EFFECT_CLASSES:
            raise PermissionError(f"unsupported effect class: {self.effect_class}")
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
        _nonnegative_int(self.resident_weight_bytes, label="resident_weight_bytes")
        _nonnegative_int(self.resident_ram_bytes, label="resident_ram_bytes")
        _nonnegative_int(self.max_latency_ms, label="max_latency_ms")
        _nonnegative_int(self.cost_units, label="cost_units")
        if not isinstance(self.workspace_owned, bool):
            raise PermissionError("workspace_owned must be boolean")
        if not isinstance(self.requires_user_handoff, bool):
            raise PermissionError("requires_user_handoff must be boolean")
        if not isinstance(self.requires_per_action_confirmation, bool):
            raise PermissionError("requires_per_action_confirmation must be boolean")

    def estimate(self) -> ResourceEstimate:
        return ResourceEstimate(
            self.resident_weight_bytes,
            self.resident_ram_bytes,
            self.max_latency_ms,
            self.cost_units,
        )

    def as_permissions(self) -> dict[str, Any]:
        return {
            "capability": self.name,
            "tool_version": self.tool_version,
            "execution_kind": self.execution_kind,
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

    def __post_init__(self) -> None:
        _nonempty(self.capability, label="capability")
        _nonempty(self.tool_version, label="tool_version")
        _nonempty(self.workspace_id, label="workspace_id")
        _nonempty(self.operation, label="operation")
        _nonempty(self.resource_scope, label="resource_scope")
        _nonempty(self.data_destination, label="data_destination")
        if not isinstance(self.arguments, Mapping):
            raise PermissionError("arguments must be a mapping")
        _nonnegative_int(self.spend_units, label="spend_units")
        _nonempty(self.idempotency_key, label="idempotency_key")
        _finite_json_bytes(self.canonical_mapping(), label="action")

    def canonical_mapping(self) -> dict[str, Any]:
        return {
            "capability": self.capability,
            "tool_version": self.tool_version,
            "workspace_id": self.workspace_id,
            "operation": self.operation,
            "resource_scope": self.resource_scope,
            "data_destination": self.data_destination,
            "arguments": dict(self.arguments),
            "spend_units": self.spend_units,
            "idempotency_key": self.idempotency_key,
        }

    def requested_permissions(self) -> dict[str, Any]:
        return {
            "capability": self.capability,
            "tool_version": self.tool_version,
            "workspace_id": self.workspace_id,
            "operations": [self.operation],
            "resource_scopes": [self.resource_scope],
            "destinations": [self.data_destination],
            "spend_units": self.spend_units,
        }


def action_from_mapping(value: Mapping[str, Any]) -> Action:
    if not isinstance(value, Mapping):
        raise PermissionError("action must be a mapping")
    required = {
        "capability",
        "tool_version",
        "workspace_id",
        "operation",
        "resource_scope",
        "data_destination",
        "arguments",
        "spend_units",
        "idempotency_key",
    }
    if set(value) != required:
        raise PermissionError("action has unexpected or missing fields; authorization is not action data")
    return Action(
        capability=value["capability"],
        tool_version=value["tool_version"],
        workspace_id=value["workspace_id"],
        operation=value["operation"],
        resource_scope=value["resource_scope"],
        data_destination=value["data_destination"],
        arguments=value["arguments"],
        spend_units=value["spend_units"],
        idempotency_key=value["idempotency_key"],
    )


def canonical_action_bytes(action: Action) -> bytes:
    if not isinstance(action, Action):
        raise PermissionError("action must be an Action")
    return _finite_json_bytes(action.canonical_mapping(), label="action")


def action_digest(action: Action) -> str:
    return hashlib.sha256(canonical_action_bytes(action)).hexdigest()


def authorization_digest(action: Action) -> str:
    """Digest permission-bearing action material, excluding replay identity."""

    mapping = action.canonical_mapping()
    mapping.pop("idempotency_key")
    return hashlib.sha256(_finite_json_bytes(mapping, label="authorization action")).hexdigest()


@dataclass(frozen=True, slots=True)
class GrantHandle:
    """Opaque authority token; the broker never treats its text as approval."""

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
            "status": self.status,
            "request_id": self.request_id,
            "action_digest": self.action_digest,
            "reason": self.reason,
            "requested_permissions": dict(self.requested_permissions),
            "effective_permissions": dict(self.effective_permissions)
            if self.effective_permissions is not None
            else None,
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
        return {
            "receipt_id": self.receipt_id,
            "action_digest": self.action_digest,
            "status": self.status,
            "reason": self.reason,
            "requested_at": self.requested_at,
            "completed_at": self.completed_at,
        }


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
            "schema": PERMISSION_RESULT_SCHEMA,
            "status": self.status,
            "action_digest": self.action_digest,
            "output_payload": self.output_payload,
            "error": dict(self.error) if self.error is not None else None,
            "requested_permissions": dict(self.requested_permissions),
            "effective_permissions": dict(self.effective_permissions)
            if self.effective_permissions is not None
            else None,
            "exceptions": list(self.exceptions),
            "audit": self.audit.as_dict(),
        }


class CancellationToken:
    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()


@dataclass(frozen=True, slots=True)
class DelegationContext:
    allowed_capabilities: frozenset[str]
    allowed_operations: frozenset[str]
    allowed_resource_scopes: frozenset[str]
    allowed_destinations: frozenset[str]
    allowed_workspaces: frozenset[str]
    remaining_spend_units: int
    _issuer: object = field(repr=False, compare=False)
    _budget_key: str = field(default="", repr=False, compare=False)

    def permits(self, action: Action) -> bool:
        return (
            action.capability in self.allowed_capabilities
            and action.operation in self.allowed_operations
            and action.resource_scope in self.allowed_resource_scopes
            and action.data_destination in self.allowed_destinations
            and action.workspace_id in self.allowed_workspaces
            and action.spend_units <= self.remaining_spend_units
        )

    def as_permissions(self) -> dict[str, Any]:
        return {
            "capabilities": sorted(self.allowed_capabilities),
            "operations": sorted(self.allowed_operations),
            "resource_scopes": sorted(self.allowed_resource_scopes),
            "destinations": sorted(self.allowed_destinations),
            "workspaces": sorted(self.allowed_workspaces),
            "remaining_spend_units": self.remaining_spend_units,
        }


class FixtureExecutor(Protocol):
    capability: str
    tool_version: str
    effect_class: str

    def execute(self, action: Action, cancellation: CancellationToken) -> Mapping[str, Any]:
        ...


class HarmlessFixtureExecutor:
    """In-memory executor used by tests; it cannot perform external effects."""

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
        return {
            "fixture": "harmless-local",
            "capability": self.capability,
            "tool_version": self.tool_version,
            "action_digest": action_digest(action),
        }


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

    def as_permissions(self) -> dict[str, Any]:
        return {
            "capability": self.capability,
            "tool_version": self.tool_version,
            "workspace_id": self.workspace_id,
            "operations": sorted(self.operations),
            "resource_scopes": sorted(self.resource_scopes),
            "destinations": sorted(self.destinations),
            "max_spend_units": self.max_spend_units,
            "approval_mode": self.approval_mode,
        }


@dataclass(frozen=True, slots=True)
class _AuthorityDecision:
    status: str
    reason: str
    reservation_id: str | None = None
    constraints: _GrantConstraints | None = None
    output_payload: Mapping[str, Any] | None = None
    audit: AuditReceipt | None = None


@dataclass(slots=True)
class _RequestRecord:
    request_id: str
    action: Action
    capability: CapabilityDescriptor
    proposer: str
    status: str = "pending"


@dataclass(slots=True)
class _GrantRecord:
    token: str
    request: _RequestRecord
    constraints: _GrantConstraints
    requested_digest: str
    exact_action: bool
    expires_at: float
    max_uses: int
    max_spend_units: int
    used_count: int = 0
    spent_units: int = 0
    status: str = "approved"
    reservations: dict[str, tuple[str, int, str]] = field(default_factory=dict)
    completed: dict[str, tuple[str, Mapping[str, Any], AuditReceipt]] = field(default_factory=dict)


class LocalTestAuthority:
    """A lock-protected in-memory authority for harmless tests only."""

    production_ready = False

    def __init__(self, clock: Callable[[], float] | None = None) -> None:
        self._clock = clock or time.time
        self._lock = threading.RLock()
        self._requests: dict[str, _RequestRecord] = {}
        self._grants: dict[str, _GrantRecord] = {}

    def submit(
        self,
        action: Action,
        capability: CapabilityDescriptor,
        proposer: str,
    ) -> PermissionState:
        _nonempty(proposer, label="proposer")
        self._validate_action_capability(action, capability)
        request_id = secrets.token_urlsafe(18)
        record = _RequestRecord(request_id, action, capability, proposer)
        with self._lock:
            self._requests[request_id] = record
        return PermissionState(
            "pending",
            request_id,
            action_digest(action),
            "awaiting independent authority approval",
            action.requested_permissions(),
        )

    def approve(
        self,
        request_id: str,
        approving_identity: str,
        expires_at: float,
        max_uses: int,
        max_spend_units: int,
        approval_mode: str,
        workspace_id: str,
    ) -> GrantHandle:
        _nonempty(approving_identity, label="approving_identity")
        if approval_mode not in GRANT_MODES:
            raise PermissionError(f"unsupported grant mode: {approval_mode}")
        if approval_mode == GRANT_MODE_ONE_TIME and max_uses != 1:
            raise PermissionError("one_time grants must have exactly one use")
        if not isinstance(expires_at, (int, float)) or expires_at <= self._clock():
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
            action = request.action
            capability = request.capability
            if approval_mode == GRANT_MODE_WORKSPACE_FULL_ACCESS:
                operations = frozenset(capability.allowed_operations)
                scopes = frozenset(capability.allowed_resource_scopes)
                destinations = frozenset(capability.allowed_destinations)
            else:
                operations = frozenset({action.operation})
                scopes = frozenset({action.resource_scope})
                destinations = frozenset({action.data_destination})
            token = secrets.token_urlsafe(32)
            grant_reference = hashlib.sha256(token.encode("utf-8")).hexdigest()[:24]
            constraints = _GrantConstraints(
                grant_reference,
                capability.name,
                capability.tool_version,
                capability.workspace_id,
                operations,
                scopes,
                destinations,
                max_spend_units,
                approval_mode,
                approving_identity,
            )
            self._grants[token] = _GrantRecord(
                token=token,
                request=request,
                constraints=constraints,
                requested_digest=authorization_digest(action),
                exact_action=approval_mode != GRANT_MODE_WORKSPACE_FULL_ACCESS,
                expires_at=float(expires_at),
                max_uses=max_uses,
                max_spend_units=max_spend_units,
            )
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
            return PermissionState(
                "denied",
                request.request_id,
                action_digest(request.action),
                reason,
                request.action.requested_permissions(),
            )

    def revoke(self, grant: GrantHandle, reason: str = "authority revoked") -> None:
        _nonempty(reason, label="reason")
        with self._lock:
            record = self._grants.get(self._token(grant))
            if record is None:
                raise PermissionError("unknown grant handle")
            record.status = "revoked"

    def state(self, grant: GrantHandle) -> PermissionState:
        with self._lock:
            record = self._grants.get(self._token(grant))
            if record is None:
                raise PermissionError("unknown grant handle")
            status = self._current_status(record, self._clock())
            return PermissionState(
                status,
                record.request.request_id,
                action_digest(record.request.action),
                f"grant is {status}",
                record.request.action.requested_permissions(),
                record.constraints.as_permissions(),
            )

    def delegation_constraints(self, grant: GrantHandle) -> _GrantConstraints:
        with self._lock:
            record = self._grants.get(self._token(grant))
            if record is None:
                raise PermissionError("unknown grant handle")
            if self._current_status(record, self._clock()) != "approved":
                raise PermissionError("grant is not currently approved")
            return record.constraints

    def reserve(
        self,
        grant: GrantHandle,
        action: Action,
        capability: CapabilityDescriptor,
        now: float,
        *,
        requires_user_handoff: bool,
        requires_per_action_confirmation: bool,
    ) -> _AuthorityDecision:
        with self._lock:
            record = self._grants.get(self._token(grant))
            if record is None:
                return _AuthorityDecision("denied", "unknown or forged grant handle")
            status = self._current_status(record, now)
            if status != "approved":
                return _AuthorityDecision(status, f"grant is {status}")
            if requires_user_handoff:
                return _AuthorityDecision("user_handoff_required", "policy requires user handoff")
            if requires_per_action_confirmation and record.constraints.approval_mode != GRANT_MODE_ONE_TIME:
                return _AuthorityDecision(
                    "per_action_approval_required",
                    "policy requires explicit one-time approval",
                )
            if not self._binding_allows(record, action, capability):
                return _AuthorityDecision("denied", "grant binding does not cover this action")
            key = action.idempotency_key
            completed = record.completed.get(key)
            digest = action_digest(action)
            if completed is not None:
                completed_digest, output, audit = completed
                if completed_digest != digest:
                    return _AuthorityDecision("denied", "idempotency key conflicts with action material")
                return _AuthorityDecision("idempotent_replay", "completed idempotent action", output_payload=output, audit=audit)
            if key in record.reservations:
                previous_digest, _, _ = record.reservations[key]
                if previous_digest != digest:
                    return _AuthorityDecision("denied", "idempotency key is in progress for another action")
                return _AuthorityDecision("pending", "idempotent action is already in progress")
            if record.used_count >= record.max_uses:
                return _AuthorityDecision("denied", "grant use limit exhausted")
            if record.spent_units + action.spend_units > record.max_spend_units:
                return _AuthorityDecision("denied", "grant spend limit exhausted")
            reservation_id = secrets.token_urlsafe(18)
            record.used_count += 1
            record.spent_units += action.spend_units
            record.reservations[key] = (digest, action.spend_units, reservation_id)
            return _AuthorityDecision(
                "reserved",
                "authority atomically reserved use and spend",
                reservation_id=reservation_id,
                constraints=record.constraints,
            )

    def commit(
        self,
        grant: GrantHandle,
        action: Action,
        reservation_id: str,
        output_payload: Mapping[str, Any],
        audit: AuditReceipt,
    ) -> None:
        _finite_json_bytes(output_payload, label="executor output")
        with self._lock:
            record = self._grants.get(self._token(grant))
            if record is None:
                raise PermissionError("unknown grant during commit")
            reservation = record.reservations.get(action.idempotency_key)
            if reservation is None or reservation[2] != reservation_id:
                raise PermissionError("reservation is missing or mismatched")
            del record.reservations[action.idempotency_key]
            record.completed[action.idempotency_key] = (action_digest(action), dict(output_payload), audit)

    def cancel(self, grant: GrantHandle, action: Action, reservation_id: str) -> None:
        with self._lock:
            record = self._grants.get(self._token(grant))
            if record is None:
                return
            reservation = record.reservations.get(action.idempotency_key)
            if reservation is None or reservation[2] != reservation_id:
                return
            del record.reservations[action.idempotency_key]
            record.used_count -= 1
            record.spent_units -= reservation[1]

    @staticmethod
    def _token(grant: GrantHandle) -> str:
        if not isinstance(grant, GrantHandle) or not isinstance(grant.token, str):
            return ""
        return grant.token

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

    @classmethod
    def _binding_allows(
        cls,
        record: _GrantRecord,
        action: Action,
        capability: CapabilityDescriptor,
    ) -> bool:
        cls._validate_action_capability(action, capability)
        constraints = record.constraints
        if action.workspace_id != constraints.workspace_id or not capability.workspace_owned:
            return False
        if action.operation not in constraints.operations:
            return False
        if action.resource_scope not in constraints.resource_scopes:
            return False
        if action.data_destination not in constraints.destinations:
            return False
        if record.exact_action and authorization_digest(action) != record.requested_digest:
            return False
        return True


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
    """Execution gate that trusts only injected authority decisions."""

    def __init__(
        self,
        authority: LocalTestAuthority,
        *,
        clock: Callable[[], float] | None = None,
        audit_log: AuditLog | None = None,
    ) -> None:
        self.authority = authority
        self._clock = clock or time.time
        self.audit_log = audit_log or AuditLog()
        self._capabilities: dict[str, CapabilityDescriptor] = {}
        self._executors: dict[str, FixtureExecutor] = {}
        self._context_issuer = object()
        self._delegation_lock = threading.Lock()
        self._delegation_spent: dict[str, int] = {}

    def register_capability(
        self,
        capability: CapabilityDescriptor,
        executor: FixtureExecutor | None = None,
    ) -> None:
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
        constraints = self.authority.delegation_constraints(grant)
        return self._context_from_constraints(constraints)

    def derive_child_context(
        self,
        parent: DelegationContext,
        child_grant: GrantHandle | None = None,
    ) -> DelegationContext:
        self._validate_context(parent)
        if child_grant is None:
            return parent
        child = self.context_for_grant(child_grant)
        return DelegationContext(
            allowed_capabilities=parent.allowed_capabilities & child.allowed_capabilities,
            allowed_operations=parent.allowed_operations & child.allowed_operations,
            allowed_resource_scopes=parent.allowed_resource_scopes & child.allowed_resource_scopes,
            allowed_destinations=parent.allowed_destinations & child.allowed_destinations,
            allowed_workspaces=parent.allowed_workspaces & child.allowed_workspaces,
            remaining_spend_units=min(parent.remaining_spend_units, child.remaining_spend_units),
            _issuer=self._context_issuer,
            _budget_key=parent._budget_key,
        )

    def execute(
        self,
        action: Action,
        grant: GrantHandle | None = None,
        *,
        parent: DelegationContext | None = None,
        cancellation: CancellationToken | None = None,
    ) -> ExecutionReceipt:
        now = float(self._clock())
        token = cancellation or CancellationToken()
        digest = action_digest(action)
        requested = action.requested_permissions()
        delegation_reserved = False
        if token.cancelled:
            return self._receipt("cancelled", action, requested, None, (), "cancelled before permission check", now)
        try:
            capability = self._get_capability(action)
            self._check_action_shape(action, capability)
        except PermissionError as exc:
            return self._receipt("denied", action, requested, None, (str(exc),), str(exc), now)
        if parent is not None:
            try:
                self._validate_context(parent)
            except PermissionError as exc:
                return self._receipt("denied", action, requested, None, (str(exc),), str(exc), now)
            if not parent.permits(action):
                return self._receipt(
                    "denied",
                    action,
                    requested,
                    parent.as_permissions(),
                    ("delegated context is an intersection and does not permit this action",),
                    "delegation scope denied",
                    now,
                )
        if self._effect_free_misclassified(action, capability):
            return self._receipt(
                "denied",
                action,
                requested,
                None,
                ("effect-free capability attempted a protected destination",),
                "effect boundary denied",
                now,
            )
        if parent is not None:
            if not self._reserve_delegation_spend(parent, action.spend_units):
                return self._receipt(
                    "denied",
                    action,
                    requested,
                    parent.as_permissions(),
                    ("delegated spend limit exhausted",),
                    "delegated spend limit exhausted",
                    now,
                )
            delegation_reserved = True
        if capability.effect_class == EFFECT_FREE:
            result = self._execute_effect_free(action, capability, token, requested, now)
            if delegation_reserved and result.status != "executed":
                self._release_delegation_spend(parent, action.spend_units)
            return result
        if grant is None:
            if delegation_reserved:
                self._release_delegation_spend(parent, action.spend_units)
            reason = "user_handoff_required" if capability.requires_user_handoff else "grant_required"
            status = "user_handoff_required" if capability.requires_user_handoff else "denied"
            return self._receipt(status, action, requested, None, (reason,), reason, now)
        decision = self.authority.reserve(
            grant,
            action,
            capability,
            now,
            requires_user_handoff=capability.requires_user_handoff,
            requires_per_action_confirmation=capability.requires_per_action_confirmation,
        )
        if decision.status != "reserved":
            if delegation_reserved:
                self._release_delegation_spend(parent, action.spend_units)
            effective = decision.constraints.as_permissions() if decision.constraints else None
            if decision.status == "idempotent_replay":
                return ExecutionReceipt(
                    "idempotent_replay",
                    digest,
                    decision.output_payload,
                    None,
                    requested,
                    effective,
                    (),
                    decision.audit
                    or self._audit(digest, "idempotent_replay", decision.reason, now, now),
                )
            return self._receipt(
                decision.status,
                action,
                requested,
                effective,
                (decision.reason,),
                decision.reason,
                now,
            )
        effective = decision.constraints.as_permissions() if decision.constraints else None
        if token.cancelled:
            self.authority.cancel(grant, action, decision.reservation_id or "")
            if delegation_reserved:
                self._release_delegation_spend(parent, action.spend_units)
            return self._receipt("cancelled", action, requested, effective, (), "cancelled before executor", now)
        executor = self._executors.get(capability.name)
        if executor is None:
            self.authority.cancel(grant, action, decision.reservation_id or "")
            if delegation_reserved:
                self._release_delegation_spend(parent, action.spend_units)
            return self._receipt(
                "unavailable_provider",
                action,
                requested,
                effective,
                ("no local fixture executor is registered",),
                "provider unavailable",
                now,
            )
        try:
            output = executor.execute(action, token)
            _finite_json_bytes(output, label="executor output")
        except ExecutionCancelled as exc:
            self.authority.cancel(grant, action, decision.reservation_id or "")
            if delegation_reserved:
                self._release_delegation_spend(parent, action.spend_units)
            return self._receipt("cancelled", action, requested, effective, (str(exc),), str(exc), now)
        except Exception as exc:  # fixture boundary is fail-closed in this stage
            self.authority.cancel(grant, action, decision.reservation_id or "")
            if delegation_reserved:
                self._release_delegation_spend(parent, action.spend_units)
            return self._receipt("failed", action, requested, effective, (str(exc),), "executor failed", now)
        completed_at = float(self._clock())
        audit = self._audit(digest, "executed", "authority-approved fixture execution", now, completed_at)
        try:
            self.authority.commit(grant, action, decision.reservation_id or "", output, audit)
        except PermissionError as exc:
            return self._receipt("failed", action, requested, effective, (str(exc),), "authority commit failed", completed_at)
        self.audit_log.append(audit)
        return ExecutionReceipt("executed", digest, dict(output), None, requested, effective, (), audit)

    def system_budget(
        self,
        controller: ResourceEstimate,
        capability_names: tuple[str, ...],
        budget: SystemResourceBudget,
    ) -> SystemBudgetReport:
        estimates = tuple(self._capabilities[name].estimate() for name in capability_names)
        return check_system_budget(controller, estimates, budget)

    def _execute_effect_free(
        self,
        action: Action,
        capability: CapabilityDescriptor,
        cancellation: CancellationToken,
        requested: Mapping[str, Any],
        now: float,
    ) -> ExecutionReceipt:
        executor = self._executors.get(capability.name)
        if executor is None:
            return self._receipt(
                "unavailable_provider",
                action,
                requested,
                capability.as_permissions(),
                ("no local effect-free executor is registered",),
                "provider unavailable",
                now,
            )
        if cancellation.cancelled:
            return self._receipt("cancelled", action, requested, capability.as_permissions(), (), "cancelled before executor", now)
        try:
            output = executor.execute(action, cancellation)
            _finite_json_bytes(output, label="executor output")
        except ExecutionCancelled as exc:
            return self._receipt("cancelled", action, requested, capability.as_permissions(), (str(exc),), str(exc), now)
        except Exception as exc:
            return self._receipt("failed", action, requested, capability.as_permissions(), (str(exc),), "executor failed", now)
        completed_at = float(self._clock())
        audit = self._audit(action_digest(action), "executed", "effect-free local fixture execution", now, completed_at)
        self.audit_log.append(audit)
        return ExecutionReceipt(
            "executed",
            action_digest(action),
            dict(output),
            None,
            requested,
            capability.as_permissions(),
            (),
            audit,
        )

    def _get_capability(self, action: Action) -> CapabilityDescriptor:
        capability = self._capabilities.get(action.capability)
        if capability is None:
            raise PermissionError("capability is not registered")
        return capability

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
        if executor.capability != capability.name or executor.tool_version != capability.tool_version:
            raise PermissionError("executor capability/version mismatch")
        if executor.effect_class != capability.effect_class:
            raise PermissionError("executor effect class mismatch")

    @staticmethod
    def _effect_free_misclassified(action: Action, capability: CapabilityDescriptor) -> bool:
        return capability.effect_class == EFFECT_FREE and (
            action.resource_scope != LOCAL_MEMORY_SCOPE or action.data_destination != NO_DESTINATION
        )

    def _reserve_delegation_spend(self, context: DelegationContext, spend_units: int) -> bool:
        if not context._budget_key:
            return False
        with self._delegation_lock:
            used = self._delegation_spent.get(context._budget_key, 0)
            if used + spend_units > context.remaining_spend_units:
                return False
            self._delegation_spent[context._budget_key] = used + spend_units
            return True

    def _release_delegation_spend(self, context: DelegationContext | None, spend_units: int) -> None:
        if context is None or not context._budget_key:
            return
        with self._delegation_lock:
            used = self._delegation_spent.get(context._budget_key, 0)
            remaining = used - spend_units
            if remaining > 0:
                self._delegation_spent[context._budget_key] = remaining
            else:
                self._delegation_spent.pop(context._budget_key, None)

    def _context_from_constraints(self, constraints: _GrantConstraints) -> DelegationContext:
        return DelegationContext(
            frozenset({constraints.capability}),
            constraints.operations,
            constraints.resource_scopes,
            constraints.destinations,
            frozenset({constraints.workspace_id}),
            constraints.max_spend_units,
            self._context_issuer,
            constraints.grant_reference,
        )

    def _validate_context(self, context: DelegationContext) -> None:
        if (
            not isinstance(context, DelegationContext)
            or context._issuer is not self._context_issuer
            or not context._budget_key
        ):
            raise PermissionError("delegation context is not issued by this broker")

    def _audit(self, digest: str, status: str, reason: str, start: float, end: float) -> AuditReceipt:
        return AuditReceipt(secrets.token_urlsafe(12), digest, status, reason, start, end)

    def _receipt(
        self,
        status: str,
        action: Action,
        requested: Mapping[str, Any],
        effective: Mapping[str, Any] | None,
        exceptions: tuple[str, ...],
        reason: str,
        now: float,
    ) -> ExecutionReceipt:
        audit = self._audit(action_digest(action), status, reason, now, float(self._clock()))
        self.audit_log.append(audit)
        return ExecutionReceipt(status, action_digest(action), None, {"code": status, "reason": reason}, requested, effective, exceptions, audit)


__all__ = [
    "Action",
    "AuditLog",
    "AuditReceipt",
    "CapabilityDescriptor",
    "CancellationToken",
    "DelegationContext",
    "EFFECT_CLASSES",
    "EFFECT_FREE",
    "EFFECT_PROTECTED",
    "EFFECT_SAFETY_CRITICAL",
    "ExecutionCancelled",
    "ExecutionReceipt",
    "FixtureExecutor",
    "GRANT_MODE_ONE_TIME",
    "GRANT_MODE_SCOPED",
    "GRANT_MODE_WORKSPACE_FULL_ACCESS",
    "GRANT_MODES",
    "GrantHandle",
    "HarmlessFixtureExecutor",
    "LOCAL_MEMORY_SCOPE",
    "LocalTestAuthority",
    "NO_DESTINATION",
    "PERMISSION_CONTRACT_VERSION",
    "PERMISSION_RESULT_SCHEMA",
    "PermissionBroker",
    "PermissionError",
    "PermissionState",
    "SystemBudgetReport",
    "SystemResourceBudget",
    "action_digest",
    "action_from_mapping",
    "authorization_digest",
    "canonical_action_bytes",
]
