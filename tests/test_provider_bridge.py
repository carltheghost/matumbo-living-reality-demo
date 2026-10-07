"""Boundary and HTTP integration checks for the loopback NVIDIA bridge."""
import importlib.util
from concurrent.futures import ThreadPoolExecutor
import http.client
import io
import json
from pathlib import Path
import queue
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location("provider_bridge", Path(__file__).parents[1] / "scripts" / "provider_bridge.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


def reply(prompt, key, model):
    return {"choices": [{"message": {"content": "Advisory reply."}}], "usage": {"total_tokens": 12, "secret": "hidden", "completion_tokens": -1}}


class RejectedBodyDrainTests(unittest.TestCase):
    def test_only_declared_bytes_are_discarded_without_parsing(self):
        stream = io.BytesIO(b"not-json-next-request")
        connection = Mock()
        connection.gettimeout.return_value = None
        bridge.discard_rejected_body(stream, connection, {"Content-Length": "8"})
        self.assertEqual(stream.tell(), 8)
        self.assertEqual(stream.read(), b"-next-request")
        self.assertIsNone(connection.settimeout.call_args.args[0])

    def test_total_deadline_bounds_slow_trickles_and_restores_socket_timeout(self):
        stream, connection = Mock(), Mock()
        stream.read1.return_value = b"x"
        connection.gettimeout.return_value = 10
        with patch.object(bridge.time, "monotonic", side_effect=[0, 8, 9.5, 10.1]):
            bridge.discard_rejected_body(stream, connection, {"Content-Length": "3"})
        self.assertEqual(stream.read1.call_count, 2)
        self.assertEqual([call.args[0] for call in connection.settimeout.call_args_list], [2, .5, 10])

    def test_ambiguous_invalid_or_oversized_framing_is_not_drained(self):
        for headers in [{}, {"Content-Length": "invalid"}, {"Content-Length": "-1"},
                        {"Content-Length": str(bridge.MAX_REJECTED_BODY_DRAIN_BYTES + 1)},
                        {"Content-Length": "2", "Transfer-Encoding": "chunked"}]:
            with self.subTest(headers=headers):
                stream, connection = Mock(), Mock()
                bridge.discard_rejected_body(stream, connection, headers)
                stream.read1.assert_not_called()
                connection.gettimeout.assert_not_called()

    def test_sender_timeout_does_not_replace_the_rejection_or_extend_its_budget(self):
        stream, connection = Mock(), Mock()
        stream.read1.side_effect = TimeoutError()
        connection.gettimeout.return_value = .1
        with patch.object(bridge.time, "monotonic", side_effect=[0, .025]):
            bridge.discard_rejected_body(stream, connection, {"Content-Length": "2"})
        self.assertAlmostEqual(connection.settimeout.call_args_list[0].args[0], .075)
        self.assertEqual(connection.settimeout.call_args.args[0], .1)


class ProviderStateTests(unittest.TestCase):
    def test_status_does_not_expose_key_or_send_request(self):
        state = bridge.ProviderState("unit-test-secret", requester=lambda *args: self.fail("Unexpected inference"))
        status = state.status()
        self.assertEqual(status["providers"][0]["state"], "configured")
        self.assertIsNone(status["providers"][0]["verifiedAt"])
        self.assertNotIn("unit-test-secret", json.dumps(status))
        self.assertFalse(status["credentialsInBrowser"])

    def test_missing_key_is_visible_and_cannot_send(self):
        state = bridge.ProviderState()
        self.assertEqual(state.status()["providers"][0]["state"], "key_needed")
        with self.assertRaises(bridge.BridgeError) as caught:
            state.chat({"prompt": "Explain this."})
        self.assertEqual(caught.exception.code, "key_needed")

    def test_success_is_verified_and_usage_is_bounded(self):
        state = bridge.ProviderState("unit-test-secret", requester=reply)
        result = state.chat({"prompt": "Explain this."})
        self.assertEqual(result["content"], "Advisory reply.")
        self.assertEqual(result["usage"], {"total_tokens": 12})
        self.assertTrue(result["advisory"])
        self.assertEqual(state.status()["providers"][0]["state"], "verified")

    def test_returned_key_is_redacted(self):
        state = bridge.ProviderState("unit-test-secret", requester=lambda prompt, key, model: {"choices": [{"message": {"content": "echo " + key}}]})
        self.assertEqual(state.chat({"prompt": "Explain."})["content"], "echo [redacted]")

    def test_input_cannot_select_upstream_model_tools_or_credentials(self):
        state = bridge.ProviderState("unit-test-secret", requester=reply)
        for value in [{"prompt": "a", "model": "evil/model"}, {"prompt": "a", "api_key": "x"}, {"prompt": "a", "url": "https://evil.example"}, {"prompt": "a", "tools": []}, {"prompt": ""}, {"prompt": " "}, {"prompt": 1}, {"prompt": "x" * 4001}, [], None]:
            with self.subTest(value_type=type(value).__name__):
                with self.assertRaises(bridge.BridgeError):
                    state.chat(value)

    def test_configured_model_must_be_a_catalog_id(self):
        for value in ["https://evil.example/model", "foo", "vendor/model?key=x", "vendor/model\r\nSecret:x"]:
            with self.assertRaises(ValueError):
                bridge.ProviderState(model=value)

    def test_six_requests_per_minute_then_recovery(self):
        clock = [10.0]
        state = bridge.ProviderState("unit-test-secret", requester=reply, clock=lambda: clock[0])
        for _ in range(6):
            state.chat({"prompt": "Explain."})
        with self.assertRaises(bridge.BridgeError) as caught:
            state.chat({"prompt": "Explain."})
        self.assertEqual(caught.exception.code, "local_rate_limit")
        clock[0] += 61
        self.assertEqual(state.chat({"prompt": "Explain."})["provider"], "nvidia")

    def test_upstream_cooldown_and_error_remain_visible(self):
        clock = [10.0]
        calls = []
        def rejected(*args):
            calls.append(1)
            raise bridge.BridgeError(429, "provider_rate_limited", "Try later.", 60)
        state = bridge.ProviderState("unit-test-secret", requester=rejected, clock=lambda: clock[0])
        with self.assertRaises(bridge.BridgeError):
            state.chat({"prompt": "Explain."})
        self.assertEqual(state.status()["providers"][0]["state"], "error")
        with self.assertRaises(bridge.BridgeError) as caught:
            state.chat({"prompt": "Explain."})
        self.assertEqual(caught.exception.code, "provider_cooldown")
        self.assertEqual(len(calls), 1)

    def test_one_in_flight_request(self):
        started, finish = threading.Event(), threading.Event()
        def slow(*args):
            started.set()
            finish.wait(2)
            return reply(*args)
        state = bridge.ProviderState("unit-test-secret", requester=slow)
        worker = threading.Thread(target=lambda: state.chat({"prompt": "Explain."}))
        worker.start()
        self.assertTrue(started.wait(1))
        try:
            with self.assertRaises(bridge.BridgeError) as caught:
                state.chat({"prompt": "Explain."})
            self.assertEqual(caught.exception.code, "request_in_progress")
        finally:
            finish.set()
            worker.join(2)
        self.assertFalse(state.in_flight)

    def test_empty_and_malformed_answers_are_not_verified(self):
        for response in [{}, [], {"choices": []}, {"choices": [{"message": {"content": None}}]}]:
            state = bridge.ProviderState("unit-test-secret", requester=lambda *args: response)
            with self.assertRaises(bridge.BridgeError):
                state.chat({"prompt": "Explain."})
            self.assertIsNone(state.verified_at)
            self.assertFalse(state.in_flight)

    def test_upstream_uses_fixed_https_route_bounded_payload_and_no_redirects(self):
        captured = []
        class Response:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def read(self, limit):
                self.limit = limit
                return json.dumps(reply(None, None, None)).encode()
        class Opener:
            def open(self, request, timeout):
                captured.append((request, timeout))
                return Response()
        with patch.object(bridge, "build_opener", return_value=Opener()) as opener:
            bridge.nvidia_request("Explain this.", "unit-test-secret", bridge.DEFAULT_MODEL)
        self.assertIsInstance(opener.call_args.args[0], bridge.NoRedirects)
        request, timeout = captured[0]
        self.assertEqual(request.full_url, bridge.UPSTREAM)
        self.assertEqual(timeout, 45)
        self.assertEqual(request.get_header("Authorization"), "Bearer unit-test-secret")
        payload = json.loads(request.data)
        self.assertFalse(payload["stream"])
        self.assertEqual(payload["max_tokens"], 2048)
        self.assertEqual(payload["reasoning_budget"], 256)
        self.assertNotIn("tools", payload)

    def test_upstream_errors_do_not_relay_sensitive_response_bodies(self):
        from io import BytesIO
        class Opener:
            def open(self, request, timeout):
                raise HTTPError(bridge.UPSTREAM, 401, "raw secret unit-test-secret", {}, BytesIO(b"secret"))
        with patch.object(bridge, "build_opener", return_value=Opener()):
            with self.assertRaises(bridge.BridgeError) as caught:
                bridge.nvidia_request("Explain this.", "unit-test-secret", bridge.DEFAULT_MODEL)
        self.assertEqual(caught.exception.code, "key_rejected")
        self.assertNotIn("unit-test-secret", caught.exception.message)


class PublicMarketStateTests(unittest.TestCase):
    def test_kalshi_public_read_uses_fixed_https_get_without_credentials(self):
        class Response:
            def __init__(self, body):
                self.body = body
                self.headers = Mock()
                self.headers.get_content_type.return_value = "application/json"
                self.read_limit = None
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, limit):
                self.read_limit = limit
                return self.body

        body = json.dumps({"markets": [{"ticker": "KX-TEST"}], "cursor": ""}).encode()
        response = Response(body)
        captured = []
        class Opener:
            def open(self, request, timeout):
                captured.append((request, timeout))
                return response
        with patch.object(bridge, "build_opener", return_value=Opener()) as make_opener:
            result = bridge.kalshi_markets_request()
        request, timeout = captured[0]
        self.assertEqual(result["markets"][0]["ticker"], "KX-TEST")
        self.assertEqual(
            bridge.KALSHI_MARKETS_UPSTREAM,
            "https://external-api.kalshi.com/trade-api/v2/markets?limit=100&status=open&mve_filter=exclude",
        )
        self.assertIsInstance(make_opener.call_args.args[0], bridge.NoRedirects)
        self.assertEqual(request.full_url, bridge.KALSHI_MARKETS_UPSTREAM)
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertIsNone(request.get_header("Authorization"))
        self.assertEqual(timeout, bridge.PUBLIC_MARKET_TIMEOUT_SECONDS)
        self.assertEqual(response.read_limit, bridge.PUBLIC_MARKET_MAX_BYTES + 1)

    def test_kalshi_public_read_rejects_oversized_and_malformed_payloads(self):
        class Response:
            def __init__(self, body):
                self.body = body
                self.headers = Mock()
                self.headers.get_content_type.return_value = "application/json"
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, limit): return self.body[:limit]

        for body, code in [
            (b"x" * (bridge.PUBLIC_MARKET_MAX_BYTES + 1), "public_source_too_large"),
            (b"{\"missingMarkets\":[]}", "public_source_invalid"),
        ]:
            with self.subTest(code=code):
                with patch.object(bridge, "build_opener", return_value=type("Opener", (), {"open": lambda _, *args, **kwargs: Response(body)})()):
                    with self.assertRaises(bridge.BridgeError) as caught:
                        bridge.kalshi_markets_request()
                self.assertEqual(caught.exception.code, code)

    def test_cache_coalesces_reads_and_enforces_six_per_minute(self):
        now = [0]
        calls = []
        state = bridge.PublicMarketState(
            requester=lambda: calls.append(now[0]) or {"markets": [{"ticker": "KX-TEST"}]},
            clock=lambda: now[0],
            cache_seconds=0,
        )
        for _ in range(bridge.LOCAL_LIMIT_PER_MINUTE):
            state.kalshi_markets()
        self.assertEqual(len(calls), bridge.LOCAL_LIMIT_PER_MINUTE)
        with self.assertRaises(bridge.BridgeError) as caught:
            state.kalshi_markets()
        self.assertEqual(caught.exception.code, "local_rate_limit")
        self.assertEqual(len(calls), bridge.LOCAL_LIMIT_PER_MINUTE)

        cache_state = bridge.PublicMarketState(
            requester=lambda: calls.append("cached") or {"markets": [{"ticker": "KX-TEST"}]},
            clock=lambda: 0,
        )
        cache_state.kalshi_markets()
        cache_state.kalshi_markets()
        self.assertEqual(calls.count("cached"), 1, "nearby tabs reuse the short-lived response")


class BridgeHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "src").mkdir()
        (self.root / "index.html").write_text("<html>Reality Lens</html>", encoding="utf-8")
        (self.root / "src" / "app.js").write_text("export const ok=true;", encoding="utf-8")
        (self.root / "mobile-chrome.js").write_text("export const mobile=true;", encoding="utf-8")
        (self.root / "mobile-layout.css").write_text("body{margin:0}", encoding="utf-8")
        (self.root / "assets").mkdir()
        (self.root / "assets" / "avatar.glb").write_bytes(b"glTF")
        (self.root / ".env").write_text("never-publish-this", encoding="utf-8")
        (self.root / "package.json").write_text("{}", encoding="utf-8")
        self.state = bridge.ProviderState("unit-test-secret", requester=reply)
        self.server = bridge.create_server(self.root, port=0, state=self.state,
            gpt_state=bridge.gpt_bridge.GPTState(store=bridge.gpt_bridge.MemoryStore()))
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(2)
        self.temp.cleanup()

    def request(self, path, method="GET", data=None, headers=None):
        request = Request(self.base + path, method=method, data=data, headers=headers or {})
        try:
            response = urlopen(request, timeout=2)
        except HTTPError as error:
            response = error
        with response:
            return response.code, response.headers, response.read()

    def test_status_and_static_assets(self):
        status, headers, raw = self.request("/api/providers")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["service"], "matumbo-provider-bridge")
        self.assertNotIn(b"unit-test-secret", raw)
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_kalshi_public_read_is_allowlisted_read_only_and_supports_pages_pna(self):
        fixture = {"markets": [{"ticker": "KX-TEST"}], "cursor": ""}
        self.server.public_market_state = bridge.PublicMarketState(requester=lambda: fixture)
        status, headers, raw = self.request(bridge.KALSHI_MARKETS_ROUTE)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), fixture)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn(b"unit-test-secret", raw)

        status, _, _ = self.request(bridge.KALSHI_MARKETS_ROUTE + "?url=https://evil.example")
        self.assertEqual(status, 404, "clients cannot choose an upstream URL")
        status, _, _ = self.request(bridge.KALSHI_MARKETS_ROUTE, method="POST", data=b"{}", headers={"Content-Type": "application/json"})
        self.assertEqual(status, 404, "the connector has no write method")

        status, headers, _ = self.request(bridge.KALSHI_MARKETS_ROUTE, method="OPTIONS", headers={
            "Origin": bridge.PUBLIC_ORIGIN,
            "Access-Control-Request-Private-Network": "true",
        })
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], bridge.PUBLIC_ORIGIN)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertIsNone(headers.get("Access-Control-Allow-Credentials"))

    def test_local_vision_runtime_and_models_have_browser_mime_types(self):
        assets = {
            "vendor/mediapipe-tasks-vision-1.0.1/vision_bundle.mjs": "text/javascript",
            "vendor/mediapipe-tasks-vision-1.0.1/wasm/vision_wasm_internal.wasm": "application/wasm",
            "assets/models/vision/hand_landmarker.task": "application/octet-stream",
        }
        for path, mime in assets.items():
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"test-fixture")
            status, headers, body = self.request("/" + path)
            self.assertEqual(status, 200, path)
            self.assertEqual(headers["Content-Type"].split(";")[0], mime, path)
        self.assertEqual(self.request("/vendor/private/config.mjs")[0], 404)

    def test_pending_local_module_burst_fits_the_accept_queue(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        self.assertEqual(self.server.request_queue_size, 128)
        dispatch_entered, release_dispatch = threading.Event(), threading.Event()
        connected = queue.Queue()
        original_dispatch = self.server.process_request

        def paused_dispatch(request, address):
            dispatch_entered.set()
            release_dispatch.wait(5)
            return original_dispatch(request, address)

        def request_asset(_):
            client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
            try:
                client.request("GET", "/src/app.js")
                connected.put(True)
                response = client.getresponse()
                return response.status, response.read()
            finally:
                client.close()

        # Pause accepting after the first connection. All 32 clients must connect
        # and send before dispatch resumes, exercising the OS pending queue.
        with patch.object(self.server, "process_request", side_effect=paused_dispatch):
            with ThreadPoolExecutor(max_workers=32) as clients:
                pending = [clients.submit(request_asset, index) for index in range(32)]
                try:
                    self.assertTrue(dispatch_entered.wait(2))
                    for _ in range(32):
                        self.assertTrue(connected.get(timeout=2))
                finally:
                    release_dispatch.set()
                results = [future.result(timeout=5) for future in pending]
        self.assertEqual(results, [(200, b"export const ok=true;")] * 32)

    def test_health_proves_instance_and_root_without_paths_credentials_or_false_readiness(self):
        status, _, raw = self.request('/api/health')
        health = json.loads(raw)
        self.assertEqual(status, 200)
        self.assertFalse(health['healthy'])
        self.assertEqual(health['featureCount'], 0)
        self.assertEqual(len(health['rootFingerprint']), 64)
        self.assertEqual(len(health['instanceId']), 32)
        self.assertNotIn(str(self.root), raw.decode())
        self.assertNotIn('unit-test-secret', raw.decode())
        (self.root / 'src' / 'main.js').write_text('export const ready=true;')
        (self.root / 'src' / 'render').mkdir()
        (self.root / 'src' / 'render' / 'feature-navigator.js').write_text('export const FEATURE_DEFINITIONS = Object.freeze([\n  id: "one",\n  id: "two",\n]);')
        _, _, updated = self.request('/api/health')
        refreshed = json.loads(updated)
        self.assertTrue(refreshed['healthy'])
        self.assertEqual(refreshed['featureCount'], 2)
        self.assertEqual(refreshed['instanceId'], health['instanceId'])
        self.assertEqual(self.request("/")[0], 200)
        self.assertIn("javascript", self.request("/src/app.js")[1]["Content-Type"])
        self.assertEqual(self.request("/mobile-chrome.js")[0], 200)
        self.assertEqual(self.request("/mobile-layout.css")[0], 200)
        self.assertEqual(self.request("/assets/avatar.glb")[0], 200)

    def test_secrets_and_source_outside_public_assets_are_hidden(self):
        for path in ["/.env", "/package.json", "/scripts/provider_bridge.py", "/.git/config", "/src/../.env", "/src/%2e%2e/.env", "/src/%5c..%5c.env", "/src/app.js:stream", "/api/providers?key=x"]:
            self.assertEqual(self.request(path)[0], 404, path)

    def test_untrusted_host_and_origin_are_rejected(self):
        self.assertEqual(self.request("/api/providers", headers={"Host": "evil.example"})[0], 403)
        status, headers, raw = self.request("/api/providers", headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403)
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))

    def test_public_pages_cors_and_private_network_preflight(self):
        origin = "https://carltheghost.github.io"
        status, headers, _ = self.request("/api/providers", method="OPTIONS", headers={"Origin": origin, "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertIsNone(headers.get("Access-Control-Allow-Credentials"))

    def test_post_json_and_route_restrictions(self):
        self.assertEqual(self.request("/api/nvidia/chat", method="POST", data=b"prompt=hello")[0], 415)
        headers = {"Content-Type": "application/json"}
        self.assertEqual(self.request("/api/nvidia/chat", method="POST", data=b"not json", headers=headers)[0], 400)
        self.assertEqual(self.request("/api/nvidia/chat", method="POST", data=b"x" * 20001, headers=headers)[0], 413)
        self.assertEqual(self.request("/api/arbitrary", method="POST", data=b"{}", headers=headers)[0], 404)
        status, _, raw = self.request("/api/nvidia/chat", method="POST", data=json.dumps({"prompt": "Explain this."}).encode(), headers=headers)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["content"], "Advisory reply.")

    def test_symlink_containment(self):
        outside = self.root.parent / (self.root.name + "-outside.js")
        outside.write_text("secret", encoding="utf-8")
        try:
            try:
                (self.root / "src" / "escape.js").symlink_to(outside)
            except OSError:
                self.skipTest("Host does not allow symlink creation.")
            self.assertEqual(self.request("/src/escape.js")[0], 404)
        finally:
            outside.unlink()


if __name__ == "__main__":
    unittest.main()
