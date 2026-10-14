"""Closed, typed, permission-checked local tool executor."""

from __future__ import annotations

from .fabric import SimFabricStore, TypedToolResult


ACTION_TO_SLOT = {"probe_a": 0, "probe_b": 1}
ALLOWED_ACTIONS = frozenset((*ACTION_TO_SLOT, "noop"))


class PermissionPolicy:
    """Code-level boundary; neural weights cannot modify this policy."""

    allowed_tools = frozenset({"resonance_probe"})
    external_network = False
    external_shell = False
    credentials = False

    @classmethod
    def permits(cls, tool: str) -> bool:
        return tool in cls.allowed_tools and not cls.external_network and not cls.external_shell and not cls.credentials


class ToolExecutor:
    def __init__(self, store: SimFabricStore):
        self.store = store

    def execute(self, action: str) -> TypedToolResult:
        # Every action records one authoritative event.  Reserve that slot
        # before any budget/world mutation so a full event log is atomic.
        self.store.ensure_event_capacity()
        if action not in ALLOWED_ACTIONS:
            result = TypedToolResult(
                schema="vevo.tool.result.v1",
                tool="unknown",
                accepted=False,
                tick=self.store.tick,
                payload={},
                error="action_not_allowlisted",
            )
            self.store.record_tool_result(result)
            return result
        if action == "noop":
            result = TypedToolResult(
                schema="vevo.tool.noop.v1",
                tool="noop",
                accepted=True,
                tick=self.store.tick,
                payload={"observed": True},
            )
            self.store.record_tool_result(result)
            return result
        self.store.budgets.consume_tool()
        tool = "resonance_probe"
        if not PermissionPolicy.permits(tool):
            result = TypedToolResult(
                schema="vevo.tool.result.v1",
                tool=tool,
                accepted=False,
                tick=self.store.tick,
                payload={},
                error="permission_denied",
            )
            self.store.record_tool_result(result)
            return result
        slot = ACTION_TO_SLOT[action]
        # The tool's eight local integration steps are part of the same
        # explicit compute budget as the outer neural loop.
        self.store.budgets.consume_physics(8)
        payload = self.store.world.apply_probe(slot)
        result = TypedToolResult(
            schema=payload.pop("schema"),
            tool=payload.pop("tool"),
            accepted=True,
            tick=self.store.tick,
            payload=payload,
        )
        self.store.record_tool_result(result)
        return result


def result_vector(result: TypedToolResult | None) -> list[float]:
    """Bounded typed feedback vector consumed by the central brain."""

    if result is None:
        return [0.0, 0.0, 0.0, 0.0]
    payload = result.payload
    return [
        1.0 if result.accepted else -1.0,
        float(payload.get("response_gain", 0.0)),
        float(payload.get("energy_delta", 0.0)),
        float(payload.get("probe_slot", -1.0)) / 2.0,
    ]
