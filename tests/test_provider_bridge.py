"""Boundary and HTTP integration checks for the loopback NVIDIA bridge."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("provider_bridge", Path(__file__).parents[1] / "scripts" / "provider_bridge.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


def reply(prompt, key, model):
    return {"choices": [{"message": {"content": "Advisory reply."}}], "usage": {"total_tokens": 12, "secret": "hidden", "completion_tokens": -1}}


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
        self.server = bridge.create_server(self.root, port=0, state=self.state)
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
