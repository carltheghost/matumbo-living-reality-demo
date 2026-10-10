"""OAuth, credential, streaming, and real loopback HTTP tests; no live inference.

Security tests intentionally require requirements-gpt.txt rather than skipping JWT checks.
"""
import base64
import hashlib
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, build_opener, urlopen
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

SPEC = importlib.util.spec_from_file_location("gpt_provider_bridge_test", Path(__file__).parents[1] / "scripts" / "provider_bridge.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)
gpt = bridge.gpt_bridge
PRIVATE = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PUBLIC = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(PRIVATE.public_key()))
PUBLIC.update(kid="fixture-signing-key", alg="RS256", use="sig")
CLIENT = "oaiapp_test_account"


def identity(expected_nonce, client=CLIENT, **changes):
    value = {"sub": "test-subject", "iss": gpt.ISSUER, "aud": client, "iat": int(time.time()),
             "exp": int(time.time()) + 3600, "nonce": expected_nonce, "email": "owner@example.test"}
    value.update(changes)
    return jwt.encode(value, PRIVATE, algorithm="RS256", headers={"kid": PUBLIC["kid"]})


class FakeTransport:
    def __init__(self):
        self.calls, self.inferences = [], []
        self.tokens, self.error = {}, None
        self.model_data = {"models": [{"slug": "gpt-test", "display_name": "Test model", "visibility": "list"},
                                      {"slug": "hidden", "visibility": "hide"}]}

    def json(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if url == gpt.DISCOVERY:
            return {"issuer": gpt.ISSUER, "authorization_endpoint": gpt.AUTHORIZE, "token_endpoint": gpt.TOKEN,
                    "jwks_uri": gpt.JWKS, "revocation_endpoint": gpt.REVOKE}
        if url == gpt.JWKS:
            return {"keys": [PUBLIC]}
        if url == gpt.TOKEN:
            if self.error:
                raise self.error
            return dict(self.tokens)
        if url == gpt.MODELS:
            return self.model_data
        if url == gpt.REVOKE:
            if self.error:
                raise self.error
            return {}
        raise AssertionError("Unexpected upstream endpoint")

    def infer(self, payload, bearer, cancelled):
        self.inferences.append((payload, bearer))
        if self.error:
            raise self.error
        return {"content": "A completed advisory answer.", "usage": {"input_tokens": 2, "output_tokens": 5, "total_tokens": 7, "secret": "excluded"}}


def fixture(store=None, api_key=""):
    transport = FakeTransport()
    state = gpt.GPTState(api_key=api_key, store=store or gpt.MemoryStore(), transport=transport)
    return state, transport


def start(state, transport, client=CLIENT, options=None, scopes=gpt.SCOPES, claim_changes=None):
    url = state.sign_in(options or {}, 8082)["authorizationUrl"]
    params = {key: values[0] for key, values in parse_qs(urlsplit(url).query).items()}
    transport.tokens = {"access_token": "access-secret", "refresh_token": "refresh-secret", "token_type": "Bearer",
                        "expires_in": 3600, "scope": scopes, "id_token": identity(params["nonce"], client, **(claim_changes or {}))}
    query = urlencode({"state": params["state"], "code": "authorization-code", "client_id": client})
    return params, query


def login(state, transport, **kwargs):
    params, query = start(state, transport, **kwargs)
    state.callback(query)
    return params, query


def prompt(provider="openai", model=""):
    return {"provider": provider, "model": model, "accountId": CLIENT if provider == "chatgpt" else None, "instructions": "Be concise.", "messages": [{"role": "user", "content": "Explain this."}]}


class AuthTests(unittest.TestCase):
    def test_initial_authorization_pkce_nonce_host_and_no_tokens(self):
        state, transport = fixture()
        params, _ = start(state, transport)
        pending = state.pending[params["state"]]
        self.assertEqual(params["client_id"], "dynamic_agent_client")
        self.assertEqual(params["agent_name_hint"], "maTumbo Reality Lens")
        self.assertEqual(params["redirect_uri"], "http://127.0.0.1:8082/api/gpt/callback")
        self.assertEqual(params["resource"], gpt.RESOURCE)
        self.assertEqual(params["scope"], gpt.SCOPES)
        self.assertEqual(params["code_challenge"], base64.urlsafe_b64encode(hashlib.sha256(pending["verifier"].encode()).digest()).decode().rstrip("="))
        self.assertNotIn("id_token_hint", params)
        self.assertFalse(transport.calls)

    def test_callback_validates_identity_scopes_and_public_status(self):
        state, transport = fixture()
        login(state, transport)
        status = state.status()
        self.assertEqual(status["chatgpt"]["state"], "signed_in")
        self.assertTrue(status["chatgpt"]["planUsage"])
        self.assertEqual(status["chatgpt"]["accounts"][0]["id"], CLIENT)
        self.assertNotIn("secret", json.dumps(status))
        self.assertFalse(status["credentialsInBrowser"])
        self.assertIsNone(status["chatgpt"]["verifiedAt"])
        self.assertFalse(transport.inferences)

    def test_state_missing_expired_replayed_and_declined(self):
        for variant in ("missing", "expired", "replayed", "declined"):
            with self.subTest(variant=variant):
                state, transport = fixture()
                params, query = start(state, transport)
                if variant == "missing":
                    query = "state=wrong&code=bad&client_id=" + CLIENT
                elif variant == "expired":
                    state.pending[params["state"]]["expires"] = 0
                elif variant == "replayed":
                    state.callback(query)
                    transport.calls.clear()
                else:
                    query = urlencode({"state": params["state"], "error": "access_denied"})
                with self.assertRaises(gpt.GPTError):
                    state.callback(query)
                self.assertFalse(any(url == gpt.TOKEN for url, _ in transport.calls))

    def test_duplicate_callback_fields_rejected(self):
        state, transport = fixture()
        _, query = start(state, transport)
        with self.assertRaises(gpt.GPTError):
            state.callback(query + "&code=other")
        self.assertFalse(transport.calls)

    def test_initial_callback_requires_issued_client_id(self):
        for client in ("", "dynamic_agent_client", "https://evil.test"):
            state, transport = fixture()
            params, _ = start(state, transport)
            with self.assertRaises(gpt.GPTError):
                state.callback(urlencode({"state": params["state"], "code": "code", "client_id": client}))
            self.assertFalse(transport.calls)

    def test_returning_account_reuses_client_host_and_rejects_different_client(self):
        state, transport = fixture()
        initial, _ = login(state, transport)
        second, query = start(state, transport)
        self.assertEqual(second["client_id"], CLIENT)
        self.assertEqual(initial["ext_agent_host_id"], second["ext_agent_host_id"])
        self.assertNotIn("agent_name_hint", second)
        self.assertNotEqual(initial["state"], second["state"])
        with self.assertRaises(gpt.GPTError):
            state.callback(query.replace(CLIENT, "oaiapp_other"))
        self.assertEqual(state.status()["chatgpt"]["activeAccountId"], CLIENT)

    def test_returning_callback_can_omit_client_id(self):
        state, transport = fixture()
        login(state, transport)
        _, query = start(state, transport)
        state.callback(query.replace("&client_id=" + CLIENT, ""))
        self.assertEqual(state.status()["chatgpt"]["state"], "signed_in")

    def test_signed_identity_change_cannot_replace_saved_account(self):
        state, transport = fixture()
        login(state, transport)
        _, query = start(state, transport, claim_changes={"sub": "another-person"})
        with self.assertRaises(gpt.GPTError) as error:
            state.callback(query)
        self.assertEqual(error.exception.code, "account_mismatch")
        self.assertEqual(state.data["accounts"][CLIENT]["subject"], "test-subject")

    def test_multiple_registrations_same_email_remain_separate(self):
        state, transport = fixture()
        login(state, transport)
        login(state, transport, client="oaiapp_second_workspace", options={"newAccount": True})
        status = state.status()["chatgpt"]
        self.assertEqual(len(status["accounts"]), 2)
        self.assertNotEqual(status["accounts"][0]["label"], status["accounts"][1]["label"])
        self.assertEqual(status["activeAccountId"], "oaiapp_second_workspace")
        login(state, transport, options={"accountId": CLIENT})
        self.assertEqual(state.status()["chatgpt"]["activeAccountId"], CLIENT)

    def test_identity_only_scope_does_not_allow_inference(self):
        state, transport = fixture()
        login(state, transport, scopes="openid email profile")
        self.assertEqual(state.status()["chatgpt"]["state"], "plan_disabled")
        with self.assertRaises(gpt.GPTError) as error:
            state.models()
        self.assertEqual(error.exception.code, "plan_disabled")
        params, _ = start(state, transport, options={"enablePlan": True})
        self.assertEqual(params["prompt"], "consent")
        self.assertIn("chatgpt.tokens.use.direct", params["scope"])

    def test_invalid_grant_retains_issued_id_for_next_attempt(self):
        state, transport = fixture()
        _, query = start(state, transport)
        transport.error = gpt.GPTError(400, "invalid_grant", "retry")
        with self.assertRaises(gpt.GPTError):
            state.callback(query)
        next_params, _ = start(state, transport)
        self.assertEqual(next_params["client_id"], CLIENT)
        self.assertNotIn("agent_name_hint", next_params)
        self.assertEqual(state.status()["chatgpt"]["state"], "signed_out")

    def test_dependency_missing_is_visible_without_blocking_api_status(self):
        state, _ = fixture(api_key="api-secret")
        with patch.object(state.verifier, "available", return_value=False):
            self.assertEqual(state.status()["chatgpt"]["dependencyState"], "dependency_needed")
            self.assertEqual(state.status()["openai"]["state"], "configured")
            with self.assertRaises(gpt.GPTError):
                state.sign_in({}, 8082)


class IdentityTests(unittest.TestCase):
    def test_signature_issuer_audience_expiry_nonce_and_subject_are_required(self):
        variants = [{"iss": "https://evil.test"}, {"aud": "wrong"}, {"exp": int(time.time()) - 30},
                    {"nonce": "wrong"}, {"sub": ""}, {"iat": int(time.time()) + 120}, {"azp": "other"}]
        for changes in variants:
            with self.subTest(changes=changes):
                verifier = gpt.IdentityVerifier(FakeTransport())
                with self.assertRaises(gpt.GPTError):
                    verifier.verify(identity("expected", **changes), CLIENT, "expected")
        other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        bad = jwt.encode({"iss": gpt.ISSUER, "aud": CLIENT, "sub": "x", "iat": int(time.time()), "exp": int(time.time()) + 10, "nonce": "expected"}, other_key, algorithm="RS256", headers={"kid": PUBLIC["kid"]})
        with self.assertRaises(gpt.GPTError):
            gpt.IdentityVerifier(FakeTransport()).verify(bad, CLIENT, "expected")

    def test_external_jwks_header_and_unsigned_token_are_rejected(self):
        claims = {"sub": "x", "aud": CLIENT, "iss": gpt.ISSUER, "iat": int(time.time()), "exp": int(time.time()) + 30, "nonce": "nonce"}
        for token in [jwt.encode(claims, "", algorithm="none"), jwt.encode(claims, PRIVATE, algorithm="RS256", headers={"kid": PUBLIC["kid"], "jku": "https://evil.test/jwks"})]:
            transport = FakeTransport()
            with self.assertRaises(gpt.GPTError):
                gpt.IdentityVerifier(transport).verify(token, CLIENT, "nonce")
            self.assertFalse(transport.calls)

    def test_jwks_is_cached_and_unfamiliar_kid_refreshes(self):
        transport = FakeTransport()
        verifier = gpt.IdentityVerifier(transport)
        verifier.verify(identity("nonce"), CLIENT, "nonce")
        verifier.verify(identity("nonce"), CLIENT, "nonce")
        self.assertEqual(sum(url == gpt.JWKS for url, _ in transport.calls), 1)
        token = jwt.encode({"sub": "x"}, PRIVATE, algorithm="RS256", headers={"kid": "unknown"})
        with self.assertRaises(gpt.GPTError):
            verifier.verify(token, CLIENT, "nonce")
        self.assertEqual(sum(url == gpt.JWKS for url, _ in transport.calls), 2)


class SessionTests(unittest.TestCase):
    def test_process_store_lock_blocks_competing_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = gpt.ProtectedStore(directory), gpt.ProtectedStore(directory)
            with first.transaction():
                with self.assertRaises(gpt.GPTError) as error:
                    with second.transaction():
                        self.fail("A competing writer acquired the token rotation lock")
            self.assertEqual(error.exception.code, "credentials_busy")
            with second.transaction():
                second.save({"safe": "record"})

    def test_protected_storage_roundtrip_host_identity_and_token_confidentiality(self):
        with tempfile.TemporaryDirectory() as directory:
            state, transport = fixture(gpt.ProtectedStore(directory))
            login(state, transport)
            raw = (Path(directory) / "credentials.bin").read_bytes()
            if os.name == "nt":
                self.assertNotIn(b"access-secret", raw)
                self.assertNotIn(b"refresh-secret", raw)
            else:
                self.assertEqual((Path(directory) / "credentials.bin").stat().st_mode & 0o777, 0o600)
            resumed, _ = fixture(gpt.ProtectedStore(directory))
            self.assertEqual(resumed.data["host_id"], state.data["host_id"])
            self.assertEqual(resumed.status()["chatgpt"]["state"], "signed_in")

    def test_storage_failure_falls_back_without_affecting_static_provider_startup(self):
        with patch.object(gpt, "ProtectedStore", side_effect=OSError("denied")):
            state = gpt.GPTState()
        self.assertEqual(state.status()["credentialStorage"], "session_only")
        self.assertIn("restart", state.status()["storageWarning"])

    def test_refresh_rotates_credentials_and_uses_original_client(self):
        state, transport = fixture()
        login(state, transport)
        state.data["accounts"][CLIENT]["expires_at"] = 0
        state.store.save(state.data)
        transport.tokens.update(access_token="new-access", refresh_token="new-refresh")
        transport.tokens.pop("id_token")
        state.models()
        request = [kwargs for url, kwargs in transport.calls if url == gpt.TOKEN][-1]
        self.assertEqual(request["data"]["client_id"], CLIENT)
        self.assertEqual(request["data"]["grant_type"], "refresh_token")
        self.assertNotIn("scope", request["data"])
        self.assertEqual(state.store.load()["accounts"][CLIENT]["refresh_token"], "new-refresh")
        self.assertEqual([kwargs for url, kwargs in transport.calls if url == gpt.MODELS][-1]["bearer"], "new-access")

    def test_second_process_reloads_rotated_token_instead_of_refreshing_stale_copy(self):
        store = gpt.MemoryStore()
        first, upstream = fixture(store)
        login(first, upstream)
        first.data["accounts"][CLIENT]["expires_at"] = 0
        store.save(first.data)
        second, second_upstream = fixture(store)
        upstream.tokens.update(access_token="rotated-access", refresh_token="rotated-refresh")
        upstream.tokens.pop("id_token")
        first.models()
        second.models()
        self.assertFalse(any(url == gpt.TOKEN for url, _ in second_upstream.calls))
        self.assertEqual(second_upstream.calls[-1][1]["bearer"], "rotated-access")

    def test_refresh_downgraded_scope_blocks_inference(self):
        state, transport = fixture()
        login(state, transport)
        state.data["accounts"][CLIENT]["expires_at"] = 0
        state.store.save(state.data)
        transport.tokens["scope"] = "openid profile email offline_access"
        transport.tokens.pop("id_token")
        with self.assertRaises(gpt.GPTError) as error:
            state.models()
        self.assertEqual(error.exception.code, "plan_disabled")

    def test_refresh_without_replacement_token_is_not_persisted(self):
        state, transport = fixture()
        login(state, transport)
        state.data["accounts"][CLIENT]["expires_at"] = 0
        state.store.save(state.data)
        transport.tokens.pop("id_token")
        transport.tokens.pop("refresh_token")
        transport.tokens["access_token"] = "unpaired-access"
        with self.assertRaises(gpt.GPTError) as error:
            state.models()
        self.assertEqual(error.exception.code, "missing_refresh_token")
        self.assertEqual(state.store.load()["accounts"][CLIENT]["access_token"], "access-secret")

    def test_terminal_refresh_clears_tokens_temporary_failure_preserves_them(self):
        for code, status in [("invalid_grant", 400), ("upstream_unreachable", 504)]:
            state, transport = fixture()
            login(state, transport)
            state.data["accounts"][CLIENT]["expires_at"] = 0
            state.store.save(state.data)
            transport.error = gpt.GPTError(status, code, "failed")
            with self.assertRaises(gpt.GPTError):
                state.models()
            saved = state.store.load()["accounts"][CLIENT]
            self.assertEqual("access_token" in saved, code != "invalid_grant")
            self.assertEqual(saved["client_id"], CLIENT)

    def test_signout_clears_only_selected_registration_and_reports_revocation(self):
        state, transport = fixture()
        login(state, transport)
        login(state, transport, client="oaiapp_other", options={"newAccount": True})
        result = state.disconnect({"accountId": CLIENT})
        self.assertTrue(result["remoteRevocationConfirmed"])
        self.assertNotIn("access_token", state.data["accounts"][CLIENT])
        self.assertIn("access_token", state.data["accounts"]["oaiapp_other"])
        self.assertEqual(state.data["accounts"][CLIENT]["client_id"], CLIENT)
        transport.error = gpt.GPTError(504, "network", "unreachable")
        result = state.disconnect({})
        self.assertFalse(result["remoteRevocationConfirmed"])
        self.assertIn("not confirmed", result["message"])
        self.assertNotIn("refresh_token", state.data["accounts"]["oaiapp_other"])


class ChatTests(unittest.TestCase):
    def test_stale_displayed_account_is_rejected_before_sending_history(self):
        state, transport = fixture()
        login(state, transport)
        state.models()
        login(state, transport, client="oaiapp_other", options={"newAccount": True})
        state.models()
        with self.assertRaises(gpt.GPTError) as error:
            state.chat(prompt("chatgpt", "gpt-test"))
        self.assertEqual(error.exception.code, "account_changed")
        self.assertFalse(transport.inferences)

    def test_optional_api_is_unverified_until_success_and_redacts_secret(self):
        state, transport = fixture(api_key="api-secret")
        self.assertEqual(state.status()["openai"]["state"], "configured")
        result = state.chat(prompt())
        self.assertEqual(result["provider"], "openai")
        self.assertEqual(state.status()["openai"]["state"], "verified")
        self.assertEqual(result["usage"], {"input_tokens": 2, "output_tokens": 5, "total_tokens": 7})
        payload, bearer = transport.inferences[0]
        self.assertEqual(bearer, "api-secret")
        self.assertEqual(payload["max_output_tokens"], 4096)
        self.assertFalse(payload["store"])
        self.assertTrue(payload["stream"])
        transport.infer = lambda *args: {"content": "echo api-secret"}
        self.assertEqual(state.chat(prompt())["content"], "echo [redacted]")

    def test_plan_uses_account_catalog_and_supported_responses_body(self):
        state, transport = fixture()
        login(state, transport)
        with self.assertRaises(gpt.GPTError):
            state.chat(prompt("chatgpt", "gpt-test"))
        self.assertEqual(len(state.models()["models"]), 1)
        state.chat(prompt("chatgpt", "gpt-test"))
        payload, bearer = transport.inferences[0]
        self.assertEqual(bearer, "access-secret")
        self.assertNotIn("max_output_tokens", payload)
        self.assertNotIn("previous_response_id", payload)
        self.assertNotIn("tools", payload)
        self.assertFalse(payload["store"])
        self.assertTrue(payload["stream"])
        self.assertEqual(state.status()["chatgpt"]["state"], "verified")

    def test_input_bounds_and_no_upstream_credentials_tools_or_arbitrary_model(self):
        state, transport = fixture(api_key="api-secret")
        invalid = [None, [], {**prompt(), "url": "https://evil.test"}, {**prompt(), "tools": []},
                   {**prompt(), "api_key": "evil"}, prompt("bad"), prompt("openai", "evil-model"),
                   {**prompt(), "instructions": "x" * 20001}, {**prompt(), "messages": [{"role": "system", "content": "x"}]},
                   {**prompt(), "messages": [{"role": "user", "content": "x" * 8001}]},
                   {**prompt(), "messages": [{"role": "user", "content": "x"}] * 21},
                   {**prompt(), "messages": [{"role": "assistant", "content": "x" * 16001}, {"role": "user", "content": "ok"}]}]
        for value in invalid:
            with self.subTest(kind=type(value).__name__):
                with self.assertRaises(gpt.GPTError):
                    state.chat(value)
        self.assertFalse(transport.inferences)

    def test_prior_long_assistant_text_is_valid_within_total_context_cap(self):
        state, _ = fixture(api_key="api-secret")
        value = prompt()
        value["messages"].insert(0, {"role": "assistant", "content": "x" * 15000})
        self.assertEqual(state.chat(value)["provider"], "openai")

    def test_one_inflight_rate_limit_and_error_cooldown(self):
        state, transport = fixture(api_key="api-secret")
        begin, end = threading.Event(), threading.Event()
        def slow(*args):
            begin.set()
            end.wait(2)
            return {"content": "answer"}
        transport.infer = slow
        thread = threading.Thread(target=lambda: state.chat(prompt()))
        thread.start()
        self.assertTrue(begin.wait(1))
        try:
            with self.assertRaises(gpt.GPTError) as error:
                state.chat(prompt())
            self.assertEqual(error.exception.code, "request_in_progress")
        finally:
            end.set()
            thread.join(2)
        transport.infer = FakeTransport().infer
        for _ in range(5):
            state.chat(prompt())
        with self.assertRaises(gpt.GPTError) as error:
            state.chat(prompt())
        self.assertEqual(error.exception.code, "local_rate_limit")
        state, transport = fixture(api_key="api-secret")
        transport.error = gpt.GPTError(429, "subscription_sharing_usage_limit_exceeded", "manage usage", 60)
        with self.assertRaises(gpt.GPTError):
            state.chat(prompt())
        with self.assertRaises(gpt.GPTError) as error:
            state.chat(prompt())
        self.assertEqual(error.exception.code, "provider_cooldown")
        self.assertEqual(len(transport.inferences), 1)
        self.assertIsNone(state.status()["openai"]["verifiedAt"])


class StreamTests(unittest.TestCase):
    def run_stream(self, events):
        raw = b"".join(("data: " + json.dumps(event) + "\n\n").encode() for event in events)
        class Response(io.BytesIO):
            headers = {"Content-Type": "text/event-stream"}
        transport = gpt.Transport()
        with patch.object(transport, "_open", return_value=Response(raw)):
            return transport.infer({"model": "test"}, "secret", threading.Event())

    def test_stream_requires_terminal_completed_event(self):
        delta = {"type": "response.output_text.delta", "delta": "Hello."}
        self.assertEqual(self.run_stream([delta, {"type": "response.completed", "response": {"usage": {"total_tokens": 3}}}])["content"], "Hello.")
        for tail in ([], [{"type": "response.incomplete"}], [{"type": "response.failed", "response": {"error": {"code": "subscription_sharing_usage_limit_exceeded"}}}]):
            with self.assertRaises(gpt.GPTError):
                self.run_stream([delta] + tail)

    def test_stream_output_limit_is_enforced(self):
        with self.assertRaises(gpt.GPTError) as error:
            self.run_stream([{"type": "response.output_text.delta", "delta": "x" * 16001}])
        self.assertEqual(error.exception.code, "output_limit")

    def test_transport_fixed_endpoints_no_redirect_and_form_token_exchange(self):
        class Response(io.BytesIO):
            pass
        class Opener:
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout
                return Response(b"{}")
        opener = Opener()
        with patch.object(gpt, "build_opener", return_value=opener) as build:
            gpt.Transport().json(gpt.TOKEN, data={"code": "a+b", "client_id": CLIENT}, form=True)
        self.assertIsInstance(build.call_args.args[0], gpt.NoRedirects)
        self.assertEqual(opener.request.full_url, gpt.TOKEN)
        self.assertIn(b"code=a%2Bb", opener.request.data)
        self.assertEqual(opener.timeout, 45)
        with self.assertRaises(gpt.GPTError):
            gpt.Transport().json("https://evil.test/token", bearer="secret")

    def test_upstream_error_keeps_safe_code_shape_requestid_without_raw_body(self):
        error = gpt.upstream_error(403, {"error": {"code": "subscription_sharing_unsupported_capability", "param": "tools", "message": "secret value"}}, {"x-request-id": "req_123"})
        self.assertEqual(error.status, 403)
        self.assertEqual(error.details["requestId"], "req_123")
        self.assertEqual(error.details["param"], "tools")
        self.assertNotIn("secret value", json.dumps(error.public()))
        self.assertEqual(gpt.upstream_error(503, {"detail": "private diagnostic"}).details["bodyShape"], "detail")


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "index.html").write_text("<html>Local Reality Lens</html>")
        self.state, self.transport = fixture(api_key="api-secret")
        self.server = bridge.create_server(self.root, 0, state=bridge.ProviderState(), gpt_state=self.state)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.temp.cleanup()

    def request(self, path, method="GET", value=None, headers=None, raw=None):
        supplied = {"Origin": self.base, "X-Matumbo-Gpt": "1", "Content-Type": "application/json"}
        supplied.update(headers or {})
        supplied = {k: v for k, v in supplied.items() if v is not None}
        data = raw if raw is not None else json.dumps(value).encode() if value is not None else None
        request = Request(self.base + path, data=data, method=method, headers=supplied)
        try:
            response = build_opener(gpt.NoRedirects()).open(request, timeout=3)
        except HTTPError as error:
            response = error
        with response:
            return response.code, response.headers, response.read()

    def test_status_static_and_nvidia_remain_available(self):
        for path in ("/", "/api/providers", "/api/health", "/api/gpt/status"):
            self.assertEqual(self.request(path)[0], 200)
        _, headers, body = self.request("/api/gpt/status")
        self.assertNotIn(b"api-secret", body)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertFalse(self.transport.calls)

    def test_exact_local_origin_custom_header_and_host_required(self):
        for headers in ({"Origin": "https://carltheghost.github.io"}, {"Origin": "http://127.0.0.1:8080"},
                        {"Origin": None}, {"X-Matumbo-Gpt": None}, {"Host": "evil.test"}, {"Sec-Fetch-Site": "cross-site"}):
            with self.subTest(headers=headers):
                self.assertEqual(self.request("/api/gpt/sign-in", "POST", {}, headers=headers)[0], 403)
        status, headers, _ = self.request("/api/gpt/status", headers={"Origin": "https://carltheghost.github.io"})
        self.assertEqual(status, 403)
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))
        self.assertFalse(self.transport.calls)
        self.assertFalse(self.transport.inferences)
        self.assertFalse(self.state.pending)

    def test_delayed_rejected_post_body_delivers_403_without_auth_or_inference(self):
        draining = threading.Event()
        original_discard = bridge.discard_rejected_body

        def observed_discard(*args):
            draining.set()
            return original_discard(*args)

        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            with patch.object(bridge, "discard_rejected_body", side_effect=observed_discard):
                client.putrequest("POST", "/api/gpt/sign-in")
                client.putheader("Origin", "https://carltheghost.github.io")
                client.putheader("Content-Type", "application/json")
                client.putheader("Content-Length", "2")
                client.endheaders()
                self.assertTrue(draining.wait(2))
                client.send(b"{}")
                response = client.getresponse()
                self.assertEqual(response.status, 403)
                self.assertEqual(json.loads(response.read())["error"]["code"], "local_page_required")
        finally:
            client.close()
        self.assertFalse(self.transport.calls)
        self.assertFalse(self.transport.inferences)
        self.assertFalse(self.state.pending)

    def test_post_routes_body_bounds_and_no_tokens_in_auth_url(self):
        status, _, raw = self.request("/api/gpt/sign-in", "POST", {})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)["authorizationUrl"].startswith(gpt.AUTHORIZE + "?"))
        self.assertNotIn(b"secret", raw)
        self.assertEqual(self.request("/api/gpt/chat", "POST", prompt())[0], 200)
        self.assertEqual(self.request("/api/gpt/chat", "POST", raw=b"x" * (gpt.MAX_BODY_BYTES + 1))[0], 413)
        self.assertEqual(self.request("/api/gpt/chat", "POST", raw=b"not json")[0], 400)
        self.assertEqual(self.request("/api/gpt/chat", "POST", {}, headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("/api/gpt/chat?extra=x", "POST", {})[0], 404)
        self.assertEqual(self.request("/api/gpt/disconnect", "POST", {})[0], 200)

    def test_callback_success_and_failure_redirect_without_code_query(self):
        params, query = start(self.state, self.transport)
        self.state.pending[params["state"]]["redirect"] = self.base + "/api/gpt/callback"
        status, headers, _ = self.request("/api/gpt/callback?" + query, headers={"Origin": None})
        self.assertEqual(status, 303)
        self.assertEqual(headers["Location"], "/?feature=web-ai&gpt_connected=1")
        self.assertEqual(headers["Referrer-Policy"], "no-referrer")
        status, headers, _ = self.request("/api/gpt/callback?" + query, headers={"Origin": None})
        self.assertEqual(status, 303)
        self.assertEqual(headers["Location"], "/?feature=web-ai&gpt_error=invalid_state")
        self.assertNotIn("authorization-code", headers["Location"])

    def test_models_cors_and_static_cannot_serve_credentials(self):
        login(self.state, self.transport)
        status, _, raw = self.request("/api/gpt/models")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["models"][0]["id"], "gpt-test")
        status, headers, _ = self.request("/api/gpt/chat", "OPTIONS")
        self.assertEqual(status, 204)
        self.assertIn("X-Matumbo-Gpt", headers["Access-Control-Allow-Headers"])
        for path in ("/scripts/gpt_bridge.py", "/requirements-gpt.txt", "/api/gpt/status?x=1", "/credentials.bin"):
            self.assertEqual(self.request(path)[0], 404)


if __name__ == "__main__":
    unittest.main()
