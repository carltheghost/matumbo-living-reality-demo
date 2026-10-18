"""Typed local boundary for future internal or specialist capabilities.

The registry in this stage intentionally has no providers.  It can describe a
capability and account for its resource footprint, but a request returns an
explicit ``unavailable_provider`` result instead of fabricating a specialist
answer or making a live call.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal, Mapping


SPECIALIST_INTERFACE_SCHEMA = "vevo.v03.specialist-interface.v1"
SPECIALIST_RESULT_SCHEMA = "vevo.v03.specialist-result.v1"
CapabilityKind = Literal[
    "internal_learned_skill",
    "local_generated_tool",
    "external_tool_adapter",
    "specialist_model_adapter",
]
_CAPABILITY_KINDS = frozenset(
    {
        "internal_learned_skill",
        "local_generated_tool",
        "external_tool_adapter",
        "specialist_model_adapter",
    }
)


def _positive_integer(value: Any, *, label: str) -> int:
    if type(value) is not int or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _nonnegative_integer(value: Any, *, label: str) -> int:
    if type(value) is not int or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


@dataclass(frozen=True, slots=True)
class ResourceEstimate:
    weight_bytes: int
    resident_ram_bytes: int
    latency_ms: int
    cost_units: int

    def __post_init__(self) -> None:
        _nonnegative_integer(self.weight_bytes, label="weight_bytes")
        _nonnegative_integer(self.resident_ram_bytes, label="resident_ram_bytes")
        _nonnegative_integer(self.latency_ms, label="latency_ms")
        _nonnegative_integer(self.cost_units, label="cost_units")

    def as_dict(self) -> dict[str, int]:
        return {
            "weight_bytes": self.weight_bytes,
            "resident_ram_bytes": self.resident_ram_bytes,
            "latency_ms": self.latency_ms,
            "cost_units": self.cost_units,
        }


@dataclass(frozen=True, slots=True)
class SystemResourceBudget:
    max_weight_bytes: int
    max_resident_ram_bytes: int
    max_latency_ms: int
    max_cost_units: int

    def __post_init__(self) -> None:
        _positive_integer(self.max_weight_bytes, label="max_weight_bytes")
        _positive_integer(self.max_resident_ram_bytes, label="max_resident_ram_bytes")
        _positive_integer(self.max_latency_ms, label="max_latency_ms")
        _positive_integer(self.max_cost_units, label="max_cost_units")


@dataclass(frozen=True, slots=True)
class SpecialistCapability:
    name: str
    description: str
    input_schema: str
    output_schema: str
    max_input_bytes: int
    max_output_bytes: int
    max_latency_ms: int
    resident_weight_bytes: int
    resident_ram_bytes: int
    cost_units: int
    execution_kind: CapabilityKind = "specialist_model_adapter"

    def __post_init__(self) -> None:
        for value, label in (
            (self.name, "name"),
            (self.description, "description"),
            (self.input_schema, "input_schema"),
            (self.output_schema, "output_schema"),
        ):
            if not isinstance(value, str) or not value:
                raise ValueError(f"{label} must be a non-empty string")
        if self.execution_kind not in _CAPABILITY_KINDS:
            raise ValueError(f"execution_kind is unsupported: {self.execution_kind}")
        _positive_integer(self.max_input_bytes, label="max_input_bytes")
        _positive_integer(self.max_output_bytes, label="max_output_bytes")
        _nonnegative_integer(self.max_latency_ms, label="max_latency_ms")
        _nonnegative_integer(self.resident_weight_bytes, label="resident_weight_bytes")
        _nonnegative_integer(self.resident_ram_bytes, label="resident_ram_bytes")
        _nonnegative_integer(self.cost_units, label="cost_units")

    def estimate(self) -> ResourceEstimate:
        return ResourceEstimate(
            self.resident_weight_bytes,
            self.resident_ram_bytes,
            self.max_latency_ms,
            self.cost_units,
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": SPECIALIST_INTERFACE_SCHEMA,
            "execution_kind": self.execution_kind,
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "output_schema": self.output_schema,
            "max_input_bytes": self.max_input_bytes,
            "max_output_bytes": self.max_output_bytes,
            "max_latency_ms": self.max_latency_ms,
            "resident_weight_bytes": self.resident_weight_bytes,
            "resident_ram_bytes": self.resident_ram_bytes,
            "cost_units": self.cost_units,
        }


@dataclass(frozen=True, slots=True)
class SpecialistRequest:
    request_id: str
    capability: SpecialistCapability
    input_payload: Mapping[str, Any]
    budget: SystemResourceBudget

    def __post_init__(self) -> None:
        if not isinstance(self.request_id, str) or not self.request_id:
            raise ValueError("request_id must be a non-empty string")
        if not isinstance(self.input_payload, Mapping):
            raise ValueError("input_payload must be a mapping")


@dataclass(frozen=True, slots=True)
class SpecialistUsage:
    input_bytes: int
    estimated_output_bytes: int
    estimate: ResourceEstimate

    def __post_init__(self) -> None:
        _nonnegative_integer(self.input_bytes, label="input_bytes")
        _nonnegative_integer(self.estimated_output_bytes, label="estimated_output_bytes")

    def as_dict(self) -> dict[str, Any]:
        return {
            "input_bytes": self.input_bytes,
            "estimated_output_bytes": self.estimated_output_bytes,
            "estimate": self.estimate.as_dict(),
        }


@dataclass(frozen=True, slots=True)
class SpecialistResult:
    status: Literal["unavailable_provider", "budget_rejected"]
    request_id: str
    provider: str | None
    output_payload: Mapping[str, Any] | None
    error: Mapping[str, Any]
    verification: Mapping[str, Any]
    memory_feedback: Mapping[str, Any]
    usage: SpecialistUsage

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": SPECIALIST_RESULT_SCHEMA,
            "status": self.status,
            "request_id": self.request_id,
            "provider": self.provider,
            "output_payload": self.output_payload,
            "error": dict(self.error),
            "verification": dict(self.verification),
            "memory_feedback": dict(self.memory_feedback),
            "usage": self.usage.as_dict(),
        }


@dataclass(frozen=True, slots=True)
class SystemBudgetReport:
    allowed: bool
    totals: ResourceEstimate
    budget: SystemResourceBudget
    rejected_dimensions: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "totals": self.totals.as_dict(),
            "budget": {
                "max_weight_bytes": self.budget.max_weight_bytes,
                "max_resident_ram_bytes": self.budget.max_resident_ram_bytes,
                "max_latency_ms": self.budget.max_latency_ms,
                "max_cost_units": self.budget.max_cost_units,
            },
            "rejected_dimensions": list(self.rejected_dimensions),
        }


def check_system_budget(
    controller: ResourceEstimate,
    specialists: tuple[ResourceEstimate, ...],
    budget: SystemResourceBudget,
) -> SystemBudgetReport:
    estimates = (controller,) + tuple(specialists)
    totals = ResourceEstimate(
        weight_bytes=sum(item.weight_bytes for item in estimates),
        resident_ram_bytes=sum(item.resident_ram_bytes for item in estimates),
        latency_ms=sum(item.latency_ms for item in estimates),
        cost_units=sum(item.cost_units for item in estimates),
    )
    rejected = tuple(
        name
        for name, observed, limit in (
            ("weight_bytes", totals.weight_bytes, budget.max_weight_bytes),
            ("resident_ram_bytes", totals.resident_ram_bytes, budget.max_resident_ram_bytes),
            ("latency_ms", totals.latency_ms, budget.max_latency_ms),
            ("cost_units", totals.cost_units, budget.max_cost_units),
        )
        if observed > limit
    )
    return SystemBudgetReport(not rejected, totals, budget, rejected)


class LocalSpecialistRegistry:
    """Capability registry with no execution providers in Stage 1."""

    def __init__(self) -> None:
        self._capabilities: dict[str, SpecialistCapability] = {}

    def register_capability(self, capability: SpecialistCapability) -> None:
        if capability.name in self._capabilities:
            raise ValueError(f"capability already registered: {capability.name}")
        self._capabilities[capability.name] = capability

    def capability(self, name: str) -> SpecialistCapability | None:
        return self._capabilities.get(name)

    def request(self, request: SpecialistRequest) -> SpecialistResult:
        capability = self._capabilities.get(request.capability.name, request.capability)
        input_bytes = len(
            json.dumps(
                request.input_payload,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
        )
        usage = SpecialistUsage(
            input_bytes=input_bytes,
            estimated_output_bytes=capability.max_output_bytes,
            estimate=capability.estimate(),
        )
        if input_bytes > capability.max_input_bytes:
            return SpecialistResult(
                status="budget_rejected",
                request_id=request.request_id,
                provider=None,
                output_payload=None,
                error={
                    "code": "input_budget_exceeded",
                    "input_bytes": input_bytes,
                    "limit": capability.max_input_bytes,
                },
                verification={"status": "not_run", "reason": "request rejected before provider execution"},
                memory_feedback={"status": "budget_rejected", "request_id": request.request_id},
                usage=usage,
            )
        return SpecialistResult(
            status="unavailable_provider",
            request_id=request.request_id,
            provider=None,
            output_payload=None,
            error={
                "code": "unavailable_provider",
                "message": "no local specialist provider is registered for this capability",
                "capability": capability.name,
            },
            verification={"status": "not_run", "reason": "provider unavailable"},
            memory_feedback={"status": "unavailable_provider", "request_id": request.request_id},
            usage=usage,
        )


__all__ = [
    "CapabilityKind",
    "LocalSpecialistRegistry",
    "ResourceEstimate",
    "SPECIALIST_INTERFACE_SCHEMA",
    "SPECIALIST_RESULT_SCHEMA",
    "SpecialistCapability",
    "SpecialistRequest",
    "SpecialistResult",
    "SpecialistUsage",
    "SystemBudgetReport",
    "SystemResourceBudget",
    "check_system_budget",
]
