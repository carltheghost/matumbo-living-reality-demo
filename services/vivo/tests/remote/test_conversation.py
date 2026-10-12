from __future__ import annotations

import asyncio
import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

try:
    from server.conversation import (
        ConversationConfig,
        ConversationError,
        ConversationAdapter,
        OpenAIResponsesProvider,
        ProviderError,
        RESPONSES_URL,
        SCHEMA,
        attach_conversation_routes,
        parse_provider_response,
        redact_secrets,
    )
except ModuleNotFoundError:
    from services.vivo.server.conversation import (
        ConversationConfig,
        ConversationError,
        ConversationAdapter,
        OpenAIResponsesProvider,
        ProviderError,
        RESPONSES_URL,
        SCHEMA,
        attach_conversation_routes,
        parse_provider_response,
        redact_secrets,
    )


TOKEN = "owner-test-conversation-token-0123456789"
ORIGIN = "https://vivo.test"


def companion():
    return {
        "id": "relic",
        "entityId": "relic",
        "name": "Relic",
        "role": "Keeper of the field",
        "description": "A bounded test companion.",
        "prompt": "Hold the thread.",
        "color": "ignored-client-decoration",
    }


def world(world_id="world-1"):
    return {
        "worldId": world_id,
        "branchId": "branch-1",
        "eyeId": "eye-1",
        "spaceId": "root",
        "dimension": 4,
        "entity": {"id": "relic", "name": "Relic", "q": [0, 0, 0, 0], "revision": 0},
    }


class MockProvider:
    def __init__(self, responses=None, *, wait_first=False):
        self.responses = list(responses or [{"output_text": "mock reply"}])
        self.calls = []
        self.first_called = asyncio.Event()
        self.release_first = asyncio.Event()
        self.wait_first = wait_first

    async def complete(self, payload, correlation_id):
        self.calls.append((payload, correlation_id))
        self.first_called.set()
        if self.wait_first and len(self.calls) == 1:
            await self.release_first.wait()
        return self.responses.pop(0)


class ConversationAdapterTests(unittest.IsolatedAsyncioTestCase):
    def config(self, **overrides):
        values = {
            "api_key": "test-provider-key",
            "timeout_seconds": 0.2,
            "max_message_chars": 40,
            "max_output_chars": 80,
            "max_history_messages": 6,
            "max_history_chars": 200,
            "requests_per_minute": 30,
        }
        values.update(overrides)
        return ConversationConfig(**values)

    async def ask(self, adapter, *, identity="actor-a", request_id="req.1", generation=1, text="hello", world_value=None):
        return await adapter.respond(
            identity=identity,
            request_id=request_id,
            generation=generation,
            message=text,
            companion=companion(),
            world=world_value or world(),
        )

    async def test_provider_response_parsing_collects_all_text_and_never_executes_tools(self):
        body = {
            "output": [
                {"type": "reasoning", "summary": []},
                {"type": "function_call", "name": "mutate_world", "arguments": "{}"},
                {"type": "message", "content": [
                    {"type": "output_text", "text": "first"},
                    {"type": "refusal", "refusal": "ignored"},
                ]},
                {"type": "message", "content": [{"type": "output_text", "text": "second"}]},
            ],
        }
        self.assertEqual(parse_provider_response(body), "first\nsecond")
        with self.assertRaises(ProviderError) as error:
            parse_provider_response({"output": [{"type": "function_call", "name": "mutate_world"}]})
        self.assertEqual(error.exception.code, "PROVIDER_NO_TEXT")

    async def test_request_reply_correlation_idempotency_and_bounded_payload(self):
        provider = MockProvider([{"output_text": "real mock output"}])
        adapter = ConversationAdapter(self.config(), provider=provider)
        first = await self.ask(adapter)
        second = await self.ask(adapter)
        self.assertEqual(first["schema"], SCHEMA)
        self.assertEqual(first["requestId"], "req.1")
        self.assertEqual(first["conversationId"], second["conversationId"])
        self.assertEqual(first, second)
        self.assertEqual(len(provider.calls), 1)
        payload, correlation_id = provider.calls[0]
        self.assertEqual(payload["model"], "gpt-6-luna")
        self.assertFalse(payload["store"])
        self.assertNotIn("tools", payload)
        self.assertTrue(correlation_id.startswith("vivo-"))
        self.assertIn('"worldId":"world-1"', payload["input"][0]["content"])
        self.assertNotIn("ignored-client-decoration", payload["input"][0]["content"])

        with self.assertRaises(ConversationError) as error:
            await self.ask(adapter, text="different")
        self.assertEqual(error.exception.code, "REQUEST_ID_REUSED")

    async def test_responses_transport_has_fixed_destination_and_keeps_key_server_side(self):
        seen = {}

        async def transport(payload, headers, correlation_id):
            seen.update({"payload": payload, "headers": headers, "correlation": correlation_id})
            return {"output_text": "transport reply"}

        config = self.config(api_key="dummy-server-only-key")
        provider = OpenAIResponsesProvider(config, transport=transport)
        adapter = ConversationAdapter(config, provider=provider)
        result = await self.ask(adapter, request_id="transport.1")
        self.assertEqual(result["text"], "transport reply")
        self.assertEqual(RESPONSES_URL, "https://api.openai.com/v1/responses")
        self.assertEqual(seen["headers"]["Authorization"], "Bearer dummy-server-only-key")
        self.assertFalse(any("Authorization" in str(value) for value in result.values()))
        self.assertEqual(seen["payload"]["store"], False)

    async def test_identity_and_world_scope_do_not_share_history(self):
        provider = MockProvider([
            {"output_text": "a reply"},
            {"output_text": "b reply"},
            {"output_text": "other world reply"},
        ])
        adapter = ConversationAdapter(self.config(), provider=provider)
        a = await self.ask(adapter, identity="actor-a", request_id="a.1", text="private-a")
        b = await self.ask(adapter, identity="actor-b", request_id="b.1", text="private-b")
        other_world = await self.ask(adapter, identity="actor-a", request_id="a.2", text="other", world_value=world("world-2"))
        self.assertNotEqual(a["conversationId"], b["conversationId"])
        self.assertNotEqual(a["conversationId"], other_world["conversationId"])
        self.assertNotIn("private-a", provider.calls[1][0]["input"][-1]["content"])
        self.assertNotIn("private-a", provider.calls[2][0]["input"][0]["content"])

    async def test_unavailable_mode_is_honest_and_never_falls_back(self):
        adapter = ConversationAdapter(ConversationConfig(api_key=None))
        self.assertFalse(adapter.status()["available"])
        self.assertEqual(adapter.status()["reason"], "provider-not-configured")
        with self.assertRaises(ConversationError) as error:
            await self.ask(adapter)
        self.assertEqual(error.exception.code, "CONVERSATION_UNAVAILABLE")

    async def test_limits_redaction_and_output_cap(self):
        provider = MockProvider([{"output_text": "x" * 1000}])
        adapter = ConversationAdapter(self.config(), provider=provider)
        with self.assertRaises(ConversationError) as error:
            await self.ask(adapter, text="x" * 41)
        self.assertEqual(error.exception.code, "MESSAGE_INVALID")
        result = await self.ask(adapter, request_id="cap.1")
        self.assertEqual(len(result["text"]), 80)
        with self.assertRaises(ConversationError) as error:
            await self.ask(adapter, request_id="cap.2", world_value={**world(), "dimension": 4, "entity": {"id": "relic", "name": "bad", "q": [999]}})
        self.assertEqual(error.exception.code, "WORLD_CONTEXT_INVALID")
        diagnostic = redact_secrets("Authorization: Bearer sk-test-secret and api_key=sk-test-secret")
        self.assertNotIn("sk-test-secret", diagnostic)
        self.assertIn("[REDACTED]", diagnostic)

    async def test_stop_selection_and_navigation_abort_do_not_commit_a_turn(self):
        for reason in ("conversation-stopped", "selection-changed", "navigation-changed"):
            provider = MockProvider([{"output_text": "should not commit"}], wait_first=True)
            adapter = ConversationAdapter(self.config(timeout_seconds=2), provider=provider)
            task = asyncio.create_task(self.ask(adapter, request_id=f"abort.{reason}"))
            await provider.first_called.wait()
            task.cancel(reason)
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertEqual(len(adapter.store._states), 1)
            state = next(iter(adapter.store._states.values()))
            self.assertEqual(state.history, [])

    async def test_timeout_returns_stable_error(self):
        provider = MockProvider([{"output_text": "late"}], wait_first=True)
        adapter = ConversationAdapter(self.config(timeout_seconds=0.01), provider=provider)
        task = asyncio.create_task(self.ask(adapter, request_id="timeout.1"))
        await provider.first_called.wait()
        with self.assertRaises(ConversationError) as error:
            await task
        self.assertEqual(error.exception.code, "PROVIDER_TIMEOUT")

    async def test_newer_generation_suppresses_stale_provider_reply(self):
        provider = MockProvider([
            {"output_text": "stale"},
            {"output_text": "current"},
        ], wait_first=True)
        adapter = ConversationAdapter(self.config(timeout_seconds=2), provider=provider)
        old = asyncio.create_task(self.ask(adapter, request_id="generation.1", generation=1, text="old"))
        await provider.first_called.wait()
        new = asyncio.create_task(self.ask(adapter, request_id="generation.2", generation=2, text="new"))
        await asyncio.sleep(0)
        provider.release_first.set()
        with self.assertRaises(ConversationError) as error:
            await old
        self.assertEqual(error.exception.code, "STALE_GENERATION")
        current = await new
        self.assertEqual(current["generation"], 2)
        self.assertEqual(current["text"], "current")
        state = next(iter(adapter.store._states.values()))
        self.assertEqual([item[1] for item in state.history], ["new", "current"])


class ConversationRouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.provider = MockProvider([{"output_text": "route reply"}])
        self.adapter = ConversationAdapter(ConversationConfig(api_key="test-provider-key"), provider=self.provider)
        app = web.Application()

        class Principal:
            actor_id = "remote.owner"

        attach_conversation_routes(
            app,
            adapter=self.adapter,
            origin=ORIGIN,
            authenticate=lambda token: Principal() if token == TOKEN else (_ for _ in ()).throw(ValueError("bad token")),
            identity_for_token=lambda token, principal: f"{principal.actor_id}:{token}",
        )
        self.server = TestServer(app)
        self.client = TestClient(self.server)
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        await self.adapter.close()

    def headers(self, *, origin=ORIGIN, token=TOKEN):
        return {"Origin": origin, "Authorization": "Bearer " + token}

    async def test_origin_and_authorization_are_required(self):
        response = await self.client.get("/api/conversation/status", headers={"Origin": ORIGIN})
        self.assertEqual(response.status, 401)
        response = await self.client.get("/api/conversation/status", headers=self.headers(origin="https://attacker.test"))
        self.assertEqual(response.status, 403)

    async def test_status_and_respond_echo_correlation(self):
        response = await self.client.get("/api/conversation/status", headers=self.headers())
        self.assertEqual(response.status, 200)
        self.assertTrue((await response.json())["available"])
        response = await self.client.post(
            "/api/conversation/respond",
            headers={**self.headers(), "Content-Type": "application/json"},
            json={"requestId": "route.1", "generation": 3, "message": "hello", "companion": companion(), "world": world()},
        )
        self.assertEqual(response.status, 200)
        body = await response.json()
        self.assertEqual(body["requestId"], "route.1")
        self.assertEqual(body["generation"], 3)
        self.assertEqual(body["text"], "route reply")

    async def test_unavailable_route_is_not_scripted(self):
        unavailable = ConversationAdapter(ConversationConfig(api_key=None))
        app = web.Application()
        class Principal:
            actor_id = "remote.owner"
        attach_conversation_routes(
            app,
            adapter=unavailable,
            origin=ORIGIN,
            authenticate=lambda token: Principal(),
            identity_for_token=lambda token, principal: "owner",
        )
        server = TestServer(app)
        client = TestClient(server)
        await client.start_server()
        try:
            response = await client.get("/api/conversation/status", headers=self.headers())
            self.assertEqual(response.status, 200)
            self.assertEqual((await response.json())["status"], "unavailable")
            response = await client.post(
                "/api/conversation/respond",
                headers={**self.headers(), "Content-Type": "application/json"},
                json={"requestId": "off.1", "message": "hello", "companion": companion(), "world": world()},
            )
            self.assertEqual(response.status, 503)
            self.assertEqual((await response.json())["error"], "CONVERSATION_UNAVAILABLE")
        finally:
            await client.close()
            await unavailable.close()


if __name__ == "__main__":
    unittest.main()
