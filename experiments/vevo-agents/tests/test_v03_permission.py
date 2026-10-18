import threading
import unittest

from vevo_agents.v03_permission import (
    EFFECT_FREE,
    EFFECT_PROTECTED,
    EFFECT_SAFETY_CRITICAL,
    GRANT_MODE_ONE_TIME,
    GRANT_MODE_SCOPED,
    GRANT_MODE_WORKSPACE_FULL_ACCESS,
    LOCAL_MEMORY_SCOPE,
    Action,
    CancellationToken,
    CapabilityDescriptor,
    DelegationContext,
    ExecutionCancelled,
    GrantHandle,
    HarmlessFixtureExecutor,
    LocalTestAuthority,
    PermissionBroker,
    PermissionError,
    action_from_mapping,
)
from vevo_agents.v03_specialist_interface import ResourceEstimate, SystemResourceBudget


class FakeClock:
    def __init__(self, value=100.0):
        self.value = value

    def __call__(self):
        return self.value

    def advance(self, amount):
        self.value += amount


def capability(
    name="local-tool",
    *,
    effect_class=EFFECT_PROTECTED,
    execution_kind="local_generated_tool",
    workspace_id="workspace-a",
    workspace_owned=True,
    requires_user_handoff=False,
    requires_per_action_confirmation=False,
    operations=("read", "write"),
    scopes=("local", "remote"),
    destinations=("none", "fixture"),
    max_output_bytes=4096,
):
    return CapabilityDescriptor(
        name=name,
        tool_version="v1",
        execution_kind=execution_kind,
        effect_class=effect_class,
        workspace_id=workspace_id,
        allowed_operations=operations,
        allowed_resource_scopes=scopes,
        allowed_destinations=destinations,
        max_input_bytes=4096,
        max_output_bytes=max_output_bytes,
        max_spend_units=10,
        resident_weight_bytes=10,
        resident_ram_bytes=20,
        max_latency_ms=5,
        cost_units=1,
        workspace_owned=workspace_owned,
        requires_user_handoff=requires_user_handoff,
        requires_per_action_confirmation=requires_per_action_confirmation,
    )


def action(
    *,
    capability_name="local-tool",
    tool_version="v1",
    workspace_id="workspace-a",
    operation="read",
    resource_scope="local",
    data_destination="none",
    arguments=None,
    spend_units=1,
    idempotency_key="request-1",
    requester="",
):
    return Action(
        capability=capability_name,
        tool_version=tool_version,
        workspace_id=workspace_id,
        operation=operation,
        resource_scope=resource_scope,
        data_destination=data_destination,
        arguments={} if arguments is None else arguments,
        spend_units=spend_units,
        idempotency_key=idempotency_key,
        requester=requester,
    )


class BlockingExecutor(HarmlessFixtureExecutor):
    def __init__(self, descriptor):
        super().__init__(descriptor)
        self.started = threading.Event()
        self.release = threading.Event()

    def execute(self, action_value, cancellation):
        self.started.set()
        self.release.wait(2.0)
        return super().execute(action_value, cancellation)


class CancellingExecutor(HarmlessFixtureExecutor):
    def execute(self, action_value, cancellation):
        cancellation.cancel()
        raise ExecutionCancelled("fixture cancelled before side effect")


class StartCancellingToken(CancellationToken):
    """Cancel on the authority's atomic pre-dispatch recheck."""

    def __init__(self):
        super().__init__()
        self.reads = 0

    @property
    def cancelled(self):
        self.reads += 1
        return self.reads >= 3


class CapturingExecutor(HarmlessFixtureExecutor):
    def __init__(self, descriptor):
        super().__init__(descriptor)
        self.seen_action = None

    def execute(self, action_value, cancellation):
        self.seen_action = action_value
        return super().execute(action_value, cancellation)


class RaisingExecutor(HarmlessFixtureExecutor):
    def execute(self, action_value, cancellation):
        self.call_count += 1
        raise RuntimeError("adapter failed after dispatch")


class OversizedExecutor(HarmlessFixtureExecutor):
    def execute(self, action_value, cancellation):
        self.call_count += 1
        return {"payload": "x" * 200}


class RevokingExecutor(HarmlessFixtureExecutor):
    def __init__(self, descriptor, authority, grant):
        super().__init__(descriptor)
        self.authority = authority
        self.grant = grant

    def execute(self, action_value, cancellation):
        self.call_count += 1
        self.authority.revoke(self.grant, "revoked concurrently after dispatch")
        return {"effect": "fixture-completed"}


class V03PermissionTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.authority = LocalTestAuthority(self.clock)
        self.broker = PermissionBroker(self.authority, clock=self.clock)
        self.descriptor = capability()
        self.executor = HarmlessFixtureExecutor(self.descriptor)
        self.broker.register_capability(self.descriptor, self.executor)

    def approve(self, action_value, *, mode=GRANT_MODE_SCOPED, max_uses=3, max_spend=10):
        pending = self.broker.request_approval(action_value, "neural-proposer")
        return self.authority.approve(
            pending.request_id,
            "authenticated-test-user",
            self.clock() + 50.0,
            max_uses,
            max_spend,
            mode,
            action_value.workspace_id,
        )

    def test_capability_kinds_and_effect_free_boundary(self):
        kinds = (
            "internal_learned_skill",
            "local_generated_tool",
            "external_tool_adapter",
            "specialist_model_adapter",
        )
        for index, kind in enumerate(kinds):
            descriptor = capability(
                name=f"kind-{index}",
                execution_kind=kind,
                effect_class=EFFECT_PROTECTED,
            )
            self.broker.register_capability(descriptor, HarmlessFixtureExecutor(descriptor))
        unsafe = capability(
            name="misclassified",
            effect_class=EFFECT_FREE,
            execution_kind="internal_learned_skill",
            scopes=(LOCAL_MEMORY_SCOPE,),
            destinations=("filesystem",),
        )
        unsafe_executor = HarmlessFixtureExecutor(unsafe)
        self.broker.register_capability(unsafe, unsafe_executor)
        result = self.broker.execute(
            action(
                capability_name="misclassified",
                resource_scope=LOCAL_MEMORY_SCOPE,
                data_destination="filesystem",
            )
        )
        self.assertEqual(result.status, "denied")
        self.assertEqual(unsafe_executor.call_count, 0)

        numerical = capability(
            name="pure-numerical",
            effect_class=EFFECT_FREE,
            execution_kind="internal_learned_skill",
            operations=("compute",),
            scopes=(LOCAL_MEMORY_SCOPE,),
            destinations=("none",),
        )
        numerical_executor = HarmlessFixtureExecutor(numerical)
        self.broker.register_capability(numerical, numerical_executor)
        pure_result = self.broker.execute(
            action(
                capability_name="pure-numerical",
                operation="compute",
                resource_scope=LOCAL_MEMORY_SCOPE,
                data_destination="none",
            )
        )
        self.assertEqual(pure_result.status, "executed")
        self.assertEqual(numerical_executor.call_count, 1)

    def test_forged_approval_and_model_approved_field_fail_closed(self):
        protected = action(arguments={"approved": True})
        denied = self.broker.execute(protected)
        self.assertEqual(denied.status, "denied")
        self.assertEqual(self.executor.call_count, 0)
        with self.assertRaises(PermissionError):
            action_from_mapping({**protected.canonical_mapping(), "approved": True})
        forged = self.broker.execute(protected, GrantHandle("looks-approved"))
        self.assertEqual(forged.status, "denied")
        self.assertEqual(self.executor.call_count, 0)

    def test_pending_approved_denied_expired_and_revoked_are_distinct(self):
        pending_action = action(idempotency_key="pending")
        pending = self.broker.request_approval(pending_action, "neural-proposer")
        self.assertEqual(pending.status, "pending")
        self.assertEqual(self.broker.execute(pending_action).status, "denied")
        denied = self.authority.deny(pending.request_id)
        self.assertEqual(denied.status, "denied")

        approved_action = action(idempotency_key="approved")
        grant = self.approve(approved_action)
        self.assertEqual(self.authority.state(grant).status, "approved")
        approved_receipt = self.broker.execute(approved_action, grant)
        self.assertEqual(approved_receipt.status, "executed")
        self.assertEqual(approved_receipt.audit.action_digest, approved_receipt.action_digest)
        self.assertTrue(self.broker.audit_log.entries())

        expired_action = action(idempotency_key="expired")
        expired_grant = self.approve(expired_action)
        self.clock.advance(100.0)
        self.assertEqual(self.broker.execute(expired_action, expired_grant).status, "expired")

        self.clock.value = 100.0
        revoked_action = action(idempotency_key="revoked")
        revoked_grant = self.approve(revoked_action)
        self.authority.revoke(revoked_grant)
        self.assertEqual(self.broker.execute(revoked_action, revoked_grant).status, "revoked")

    def test_exact_grant_binding_rejects_material_changes(self):
        original = action(arguments={"value": 1}, idempotency_key="exact")
        grant = self.approve(original, mode=GRANT_MODE_ONE_TIME, max_uses=1)
        changed_arguments = action(arguments={"value": 2}, idempotency_key="exact")
        changed_scope = action(resource_scope="remote", arguments={"value": 1}, idempotency_key="exact")
        changed_destination = action(data_destination="fixture", arguments={"value": 1}, idempotency_key="exact")
        for changed in (changed_arguments, changed_scope, changed_destination):
            with self.subTest(changed=changed):
                self.assertEqual(self.broker.execute(changed, grant).status, "denied")
        changed_version = action(tool_version="v2", arguments={"value": 1}, idempotency_key="exact")
        self.assertEqual(self.broker.execute(changed_version, grant).status, "denied")
        self.assertEqual(self.executor.call_count, 0)

    def test_atomic_use_race_idempotency_and_spend_limit(self):
        descriptor = capability(name="raced")
        executor = BlockingExecutor(descriptor)
        broker = PermissionBroker(self.authority, clock=self.clock)
        broker.register_capability(descriptor, executor)
        action_value = action(capability_name="raced", idempotency_key="race")
        grant = self._approve_with(broker, action_value, max_uses=1, max_spend=2)
        results = []

        first = threading.Thread(target=lambda: results.append(broker.execute(action_value, grant)))
        first.start()
        self.assertTrue(executor.started.wait(1.0))
        second_result = broker.execute(action_value, grant)
        executor.release.set()
        first.join(2.0)
        results.append(second_result)
        self.assertEqual(executor.call_count, 1)
        self.assertIn("executed", {result.status for result in results})
        self.assertIn("pending", {result.status for result in results})
        replay = broker.execute(action_value, grant)
        self.assertEqual(replay.status, "idempotent_replay")
        self.assertEqual(executor.call_count, 1)
        over = action(capability_name="raced", spend_units=3, idempotency_key="over")
        self.assertEqual(broker.execute(over, grant).status, "denied")

    def _approve_with(self, broker, action_value, *, mode=GRANT_MODE_SCOPED, max_uses=3, max_spend=10):
        pending = broker.request_approval(action_value, "neural-proposer")
        return self.authority.approve(
            pending.request_id,
            "authenticated-test-user",
            self.clock() + 50.0,
            max_uses,
            max_spend,
            mode,
            action_value.workspace_id,
        )

    def test_cancellation_releases_reservation_without_side_effect(self):
        cancellable = capability(name="cancellable")
        executor = CancellingExecutor(cancellable)
        broker = PermissionBroker(self.authority, clock=self.clock)
        broker.register_capability(cancellable, executor)
        value = action(capability_name="cancellable", idempotency_key="cancel")
        grant = self._approve_with(broker, value, max_uses=1, max_spend=2)
        token = CancellationToken()
        token.cancel()
        self.assertEqual(broker.execute(value, grant, cancellation=token).status, "cancelled")
        self.assertEqual(executor.call_count, 0)
        result = broker.execute(value, grant)
        self.assertEqual(result.status, "cancelled")
        self.assertEqual(executor.call_count, 0)

    def test_cancellation_is_rechecked_atomically_before_dispatch_intent(self):
        descriptor = capability(name="start-cancellable")
        executor = HarmlessFixtureExecutor(descriptor)
        broker = PermissionBroker(self.authority, clock=self.clock)
        broker.register_capability(descriptor, executor)
        value = action(capability_name="start-cancellable", idempotency_key="start-cancel")
        grant = self._approve_with(broker, value, max_uses=1, max_spend=2)

        cancelled = broker.execute(value, grant, cancellation=StartCancellingToken())
        self.assertEqual(cancelled.status, "cancelled")
        self.assertEqual(executor.call_count, 0)

        retry = broker.execute(value, grant)
        self.assertEqual(retry.status, "executed")
        self.assertEqual(executor.call_count, 1)

    def test_nested_delegation_is_intersection_and_cannot_escalate(self):
        broad_action = action(idempotency_key="broad")
        broad_grant = self.approve(broad_action, mode=GRANT_MODE_WORKSPACE_FULL_ACCESS, max_spend=2)
        parent = self.broker.context_for_grant(broad_grant)
        narrow_action = action(operation="read", resource_scope="local", idempotency_key="narrow")
        narrow_grant = self.approve(narrow_action, mode=GRANT_MODE_SCOPED, max_spend=10)
        child = self.broker.derive_child_context(parent, narrow_grant)
        child_permissions = self.broker.delegation_permissions(child)
        self.assertEqual(child_permissions["operations"], ["read"])
        self.assertEqual(child_permissions["remaining_spend_units"], 2)
        self.assertEqual(self.broker.execute(narrow_action, narrow_grant, parent=child).status, "executed")
        second = action(operation="read", resource_scope="local", idempotency_key="narrow-2")
        self.assertEqual(self.broker.execute(second, narrow_grant, parent=child).status, "executed")
        third = action(operation="read", resource_scope="local", idempotency_key="narrow-3")
        self.assertEqual(self.broker.execute(third, narrow_grant, parent=child).status, "denied")
        escalation = action(operation="write", resource_scope="remote", data_destination="fixture", idempotency_key="escalate")
        self.assertEqual(self.broker.execute(escalation, broad_grant, parent=child).status, "denied")
        forged_context = DelegationContext("forged-context")
        self.assertEqual(self.broker.execute(escalation, broad_grant, parent=forged_context).status, "denied")

    def test_delegated_effect_free_execution_cannot_cross_capability_scope(self):
        pure = capability(
            name="pure-delegated",
            effect_class=EFFECT_FREE,
            execution_kind="internal_learned_skill",
            operations=("compute",),
            scopes=(LOCAL_MEMORY_SCOPE,),
            destinations=("none",),
        )
        pure_executor = HarmlessFixtureExecutor(pure)
        self.broker.register_capability(pure, pure_executor)

        parent_action = action(idempotency_key="protected-parent")
        parent_grant = self.approve(parent_action, mode=GRANT_MODE_WORKSPACE_FULL_ACCESS, max_spend=2)
        parent = self.broker.context_for_grant(parent_grant)
        pure_action = action(
            capability_name="pure-delegated",
            operation="compute",
            resource_scope=LOCAL_MEMORY_SCOPE,
            data_destination="none",
            idempotency_key="pure-cross-capability",
        )

        result = self.broker.execute(pure_action, parent=parent)
        self.assertEqual(result.status, "denied")
        self.assertEqual(pure_executor.call_count, 0)

    def test_workspace_full_access_is_bounded_and_reports_requested_vs_effective(self):
        first = action(idempotency_key="full-read")
        grant = self.approve(first, mode=GRANT_MODE_WORKSPACE_FULL_ACCESS, max_uses=3, max_spend=5)
        broader = action(
            operation="write",
            resource_scope="remote",
            data_destination="fixture",
            arguments={"value": 2},
            idempotency_key="full-write",
        )
        result = self.broker.execute(broader, grant)
        self.assertEqual(result.status, "executed")
        self.assertEqual(result.requested_permissions["operations"], ["write"])
        self.assertEqual(set(result.effective_permissions["operations"]), {"read", "write"})
        outside = action(workspace_id="workspace-b", idempotency_key="outside")
        self.assertEqual(self.broker.execute(outside, grant).status, "denied")

        not_owned = capability(name="not-owned", workspace_owned=False)
        broker = PermissionBroker(self.authority, clock=self.clock)
        broker.register_capability(not_owned, HarmlessFixtureExecutor(not_owned))
        not_owned_action = action(capability_name="not-owned", idempotency_key="ownership")
        pending = broker.request_approval(not_owned_action, "neural-proposer")
        with self.assertRaises(PermissionError):
            self.authority.approve(
                pending.request_id,
                "authenticated-test-user",
                self.clock() + 20,
                1,
                1,
                GRANT_MODE_WORKSPACE_FULL_ACCESS,
                "workspace-a",
            )

    def test_workspace_full_access_still_expires_and_revokes(self):
        expiring_action = action(idempotency_key="full-expire")
        expiring = self.approve(expiring_action, mode=GRANT_MODE_WORKSPACE_FULL_ACCESS)
        self.clock.advance(100.0)
        self.assertEqual(self.broker.execute(expiring_action, expiring).status, "expired")
        self.clock.value = 100.0
        revoked_action = action(idempotency_key="full-revoke")
        revoked = self.approve(revoked_action, mode=GRANT_MODE_WORKSPACE_FULL_ACCESS)
        self.authority.revoke(revoked)
        self.assertEqual(self.broker.execute(revoked_action, revoked).status, "revoked")

    def test_safety_floor_and_per_action_confirmation_cannot_be_overridden(self):
        safety = capability(
            name="safety",
            effect_class=EFFECT_SAFETY_CRITICAL,
            requires_per_action_confirmation=True,
        )
        safety_executor = HarmlessFixtureExecutor(safety)
        broker = PermissionBroker(self.authority, clock=self.clock)
        broker.register_capability(safety, safety_executor)
        value = action(capability_name="safety", idempotency_key="safety-full")
        full_grant = self._approve_with(broker, value, mode=GRANT_MODE_WORKSPACE_FULL_ACCESS)
        result = broker.execute(value, full_grant)
        self.assertEqual(result.status, "per_action_approval_required")
        self.assertEqual(safety_executor.call_count, 0)
        handoff = capability(
            name="handoff",
            effect_class=EFFECT_SAFETY_CRITICAL,
            requires_user_handoff=True,
        )
        handoff_executor = HarmlessFixtureExecutor(handoff)
        broker.register_capability(handoff, handoff_executor)
        handoff_action = action(capability_name="handoff", idempotency_key="handoff")
        handoff_grant = self._approve_with(broker, handoff_action, mode=GRANT_MODE_ONE_TIME, max_uses=1)
        handoff_result = broker.execute(handoff_action, handoff_grant)
        self.assertEqual(handoff_result.status, "user_handoff_required")
        self.assertEqual(handoff_executor.call_count, 0)

    def test_ambiguous_safety_and_nonfinite_expiry_fail_closed(self):
        with self.assertRaises(PermissionError):
            capability(name="ambiguous-safety", effect_class=EFFECT_SAFETY_CRITICAL)
        value = action(idempotency_key="nan-expiry")
        pending = self.broker.request_approval(value, "neural-proposer")
        with self.assertRaises(PermissionError):
            self.authority.approve(
                pending.request_id,
                "authenticated-test-user",
                float("nan"),
                1,
                1,
                GRANT_MODE_ONE_TIME,
                value.workspace_id,
            )

    def test_nested_action_payload_is_immutable_and_exact(self):
        descriptor = capability(name="capture")
        executor = CapturingExecutor(descriptor)
        broker = PermissionBroker(self.authority, clock=self.clock)
        broker.register_capability(descriptor, executor)
        nested = {"inner": {"value": 1}, "items": [1]}
        value = action(
            capability_name="capture",
            arguments=nested,
            idempotency_key="immutable",
        )
        canonical = value.canonical_bytes
        grant = self._approve_with(broker, value, mode=GRANT_MODE_ONE_TIME, max_uses=1)
        nested["inner"]["value"] = 99
        nested["items"].append(2)
        result = broker.execute(value, grant)
        self.assertEqual(result.status, "executed")
        self.assertEqual(executor.seen_action.arguments["inner"]["value"], 1)
        self.assertEqual(executor.seen_action.arguments["items"], (1,))
        self.assertEqual(value.canonical_bytes, canonical)
        with self.assertRaises(TypeError):
            executor.seen_action.arguments["inner"] = {"value": 2}

    def test_parent_revoke_and_expiry_are_live_not_snapshot(self):
        parent_value = action(idempotency_key="parent-live")
        parent_pending = self.broker.request_approval(parent_value, "neural-proposer")
        parent_grant = self.authority.approve(
            parent_pending.request_id,
            "authenticated-test-user",
            self.clock() + 5,
            3,
            3,
            GRANT_MODE_WORKSPACE_FULL_ACCESS,
            parent_value.workspace_id,
        )
        child_value = action(idempotency_key="child-live")
        child_grant = self.approve(child_value, max_uses=2, max_spend=10)
        parent_context = self.broker.context_for_grant(parent_grant)
        child_context = self.broker.derive_child_context(parent_context, child_grant)
        self.authority.revoke(parent_grant)
        self.assertEqual(self.broker.execute(child_value, child_grant, parent=child_context).status, "revoked")

        self.clock.value = 100.0
        parent_value = action(idempotency_key="parent-expiry")
        parent_pending = self.broker.request_approval(parent_value, "neural-proposer")
        parent_grant = self.authority.approve(
            parent_pending.request_id,
            "authenticated-test-user",
            self.clock() + 5,
            3,
            3,
            GRANT_MODE_WORKSPACE_FULL_ACCESS,
            parent_value.workspace_id,
        )
        child_value = action(idempotency_key="child-expiry")
        child_grant = self.approve(child_value, max_uses=2, max_spend=10)
        child_context = self.broker.derive_child_context(self.broker.context_for_grant(parent_grant), child_grant)
        self.clock.advance(6)
        self.assertEqual(self.broker.execute(child_value, child_grant, parent=child_context).status, "expired")

    def test_generic_executor_failure_is_unknown_and_not_retried(self):
        descriptor = capability(name="uncertain")
        executor = RaisingExecutor(descriptor)
        broker = PermissionBroker(self.authority, clock=self.clock)
        broker.register_capability(descriptor, executor)
        value = action(capability_name="uncertain", idempotency_key="unknown")
        grant = self._approve_with(broker, value, max_uses=2, max_spend=2)
        first = broker.execute(value, grant)
        second = broker.execute(value, grant)
        self.assertEqual(first.status, "uncertain_outcome")
        self.assertEqual(second.status, "uncertain_outcome")
        self.assertEqual(executor.call_count, 1)
        changed = action(capability_name="uncertain", arguments={"changed": True}, idempotency_key="unknown")
        self.assertEqual(broker.execute(changed, grant).status, "denied")

    def test_output_cap_after_dispatch_is_unknown_and_no_blind_rerun(self):
        descriptor = capability(name="oversized", max_output_bytes=32)
        executor = OversizedExecutor(descriptor)
        broker = PermissionBroker(self.authority, clock=self.clock)
        broker.register_capability(descriptor, executor)
        value = action(capability_name="oversized", idempotency_key="oversized")
        grant = self._approve_with(broker, value, max_uses=2, max_spend=2)
        self.assertEqual(broker.execute(value, grant).status, "uncertain_outcome")
        self.assertEqual(broker.execute(value, grant).status, "uncertain_outcome")
        self.assertEqual(executor.call_count, 1)

    def test_revoke_after_start_is_visible_without_undoing_effect(self):
        descriptor = capability(name="post-start")
        value = action(capability_name="post-start", idempotency_key="post-start")
        pending = self.authority.submit(value, descriptor, "neural-proposer")
        grant = self.authority.approve(
            pending.request_id,
            "authenticated-test-user",
            self.clock() + 50,
            2,
            2,
            GRANT_MODE_SCOPED,
            value.workspace_id,
        )
        executor = RevokingExecutor(descriptor, self.authority, grant)
        broker = PermissionBroker(self.authority, clock=self.clock)
        broker.register_capability(descriptor, executor)
        result = broker.execute(value, grant)
        self.assertEqual(result.status, "executed")
        self.assertIn("revoked_after_start_cannot_undo_effect", result.exceptions)
        self.assertEqual(broker.execute(value, grant).status, "idempotent_replay")
        self.assertEqual(executor.call_count, 1)

    def test_authority_advertises_non_durable_prototype_state(self):
        status = self.authority.durability_status()
        self.assertFalse(status["durable"])
        self.assertFalse(status["crash_recovery"])
        self.assertFalse(status["outbox"])

    def test_unavailable_external_adapter_and_total_budget(self):
        external = capability(
            name="external",
            execution_kind="external_tool_adapter",
            effect_class=EFFECT_PROTECTED,
        )
        broker = PermissionBroker(self.authority, clock=self.clock)
        broker.register_capability(external)
        broker.register_capability(self.descriptor, self.executor)
        external_action = action(capability_name="external", idempotency_key="external")
        grant = self._approve_with(broker, external_action)
        result = broker.execute(external_action, grant)
        self.assertEqual(result.status, "unavailable_provider")
        self.assertFalse(self.authority.production_ready)
        report = broker.system_budget(
            ResourceEstimate(100, 100, 10, 2),
            ("local-tool", "external"),
            SystemResourceBudget(200, 200, 30, 10),
        )
        self.assertTrue(report.allowed)
        self.assertEqual(report.totals.weight_bytes, 120)


if __name__ == "__main__":
    unittest.main()
