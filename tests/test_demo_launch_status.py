"""Execute the launcher verifier against metadata fixtures without auth or inference."""
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "scripts" / "verify-demo-launch.ps1"
POWERSHELL = shutil.which("powershell.exe") or shutil.which("pwsh")
FINGERPRINT = hashlib.sha256(str(ROOT).replace("\\", "/").lower().rstrip("/").encode()).hexdigest()
# Synthetic markers are deliberately offered by the fixture in fields the verifier must omit.
PRIVATE_MARKER = "fixture-private-value-never-print"
GPT_STATUS = {
    "service": "matumbo-gpt-bridge", "credentialsInBrowser": False,
    "credentialStorage": "windows_dpapi", "storageWarning": None,
    "chatgpt": {
        "state": "signed_out", "authAvailable": True, "dependencyState": "ready",
        "planUsage": False, "verifiedAt": None, "accountLabel": PRIVATE_MARKER,
        "activeAccountId": PRIVATE_MARKER, "accounts": [{"id": PRIVATE_MARKER}],
        "error": {"message": PRIVATE_MARKER}, "access_token": PRIVATE_MARKER,
    },
    "openai": {"state": "key_needed", "verifiedAt": None, "api_key": PRIVATE_MARKER},
    "models": [{"id": PRIVATE_MARKER}], "refresh_token": PRIVATE_MARKER,
}


@unittest.skipUnless(POWERSHELL, "PowerShell is required to execute the launcher verifier.")
class DemoLaunchStatusTests(unittest.TestCase):
    def setUp(self):
        self.gpt_status = deepcopy(GPT_STATUS)
        self.requests = []
        self.health = {"service": "matumbo-provider-bridge", "healthy": True,
                       "rootFingerprint": FINGERPRINT, "featureCount": 36,
                       "instanceId": "a" * 32, "storage": "browser-local-projection"}
        self.providers = {"service": "matumbo-provider-bridge", "credentialsInBrowser": False,
                          "providers": [{"id": "nvidia", "state": "key_needed"}]}
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                fixture.requests.append(("GET", self.path))
                payload = {"/api/health": fixture.health, "/api/providers": fixture.providers,
                           "/api/gpt/status": fixture.gpt_status}.get(self.path)
                if self.path.startswith("/api/") and payload is None:
                    self.send_error(405, "This fixture only permits read-only status.")
                    return
                body = json.dumps(payload).encode() if payload is not None else b"/* fixture asset */"
                self.send_response(200)
                self.send_header("Content-Type", "application/json" if payload is not None else "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                fixture.requests.append(("POST", self.path))
                self.send_error(405, "Launcher verification cannot mutate credentials or infer.")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(2)

    def verify(self, *, success=True):
        # The command itself is constant code; only the fixture port is interpolated.
        command = ("& '" + str(VERIFIER).replace("'", "''") + "' -StaticPort "
                   + str(self.server.server_port) + " | ConvertTo-Json -Depth 6 -Compress")
        result = subprocess.run([POWERSHELL, "-NoProfile", "-NonInteractive", "-ExecutionPolicy",
                                 "Bypass", "-Command", command], cwd=ROOT,
                                capture_output=True, text=True, timeout=20)
        self.assertNotIn(PRIVATE_MARKER, result.stdout + result.stderr)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0)
        return result

    def test_signed_out_launcher_is_verified_without_claiming_a_cloud_reply(self):
        result = self.verify()
        self.assertTrue(result["verified"])
        self.assertEqual(result["nvidia"], "key_needed")
        self.assertFalse(result["credentialsInBrowser"])
        gpt = result["gpt"]
        self.assertEqual(gpt["credentialStorage"], "windows_dpapi")
        self.assertFalse(gpt["storageWarningPresent"])
        self.assertTrue(gpt["statusReadOnly"])
        self.assertFalse(gpt["authenticationStarted"])
        self.assertFalse(gpt["inferenceAttempted"])
        self.assertEqual(gpt["chatgpt"]["state"], "signed_out")
        self.assertTrue(gpt["chatgpt"]["authAvailable"])
        self.assertEqual(gpt["chatgpt"]["dependencyState"], "ready")
        self.assertFalse(gpt["chatgpt"]["ready"])
        self.assertFalse(gpt["openai"]["ready"])
        self.assertFalse(gpt["chatgpt"]["cloudReplyVerified"])
        self.assertFalse(gpt["openai"]["cloudReplyVerified"])
        self.assertIsNone(gpt["chatgpt"]["verifiedAt"])
        self.assertEqual({path for method, path in self.requests if path.startswith("/api/")},
                         {"/api/health", "/api/providers", "/api/gpt/status"})
        self.assertTrue(all(method == "GET" for method, _ in self.requests))
        self.assertIn(("GET", "/src/render/web-ai.js"), self.requests)
        self.assertIn(("GET", "/src/render/my-gpt.js"), self.requests)

    def test_credentials_ready_remains_distinct_from_completed_cloud_reply(self):
        self.gpt_status["chatgpt"].update(state="signed_in", planUsage=True)
        self.gpt_status["openai"]["state"] = "configured"
        gpt = self.verify()["gpt"]
        for provider in ("chatgpt", "openai"):
            self.assertTrue(gpt[provider]["ready"])
            self.assertFalse(gpt[provider]["cloudReplyVerified"])
            self.assertIsNone(gpt[provider]["verifiedAt"])

    def test_previously_completed_reply_timestamp_is_reported_without_new_inference(self):
        for provider in ("chatgpt", "openai"):
            self.gpt_status[provider].update(state="verified", verifiedAt="2026-10-05T08:30:00.123456Z")
        self.gpt_status["chatgpt"]["planUsage"] = True
        gpt = self.verify()["gpt"]
        for provider in ("chatgpt", "openai"):
            self.assertTrue(gpt[provider]["ready"])
            self.assertTrue(gpt[provider]["cloudReplyVerified"])
            self.assertEqual(gpt[provider]["verifiedAt"], "2026-10-05T08:30:00.1234560Z")
        self.assertTrue(all(method == "GET" for method, _ in self.requests))

    def test_auth_dependency_and_session_storage_warning_are_visible_without_message_text(self):
        self.gpt_status["chatgpt"].update(authAvailable=False, dependencyState="dependency_needed")
        self.gpt_status.update(credentialStorage="session_only", storageWarning=PRIVATE_MARKER)
        gpt = self.verify()["gpt"]
        self.assertFalse(gpt["chatgpt"]["authAvailable"])
        self.assertEqual(gpt["chatgpt"]["dependencyState"], "dependency_needed")
        self.assertEqual(gpt["credentialStorage"], "session_only")
        self.assertTrue(gpt["storageWarningPresent"])

    def test_reauthorization_and_disabled_plan_do_not_claim_readiness(self):
        for state in ("reauth_required", "plan_disabled"):
            with self.subTest(state=state):
                self.gpt_status["chatgpt"].update(state=state, planUsage=False)
                chatgpt = self.verify()["gpt"]["chatgpt"]
                self.assertEqual(chatgpt["state"], state)
                self.assertFalse(chatgpt["ready"])
                self.assertFalse(chatgpt["cloudReplyVerified"])

    def test_wrong_checkout_stops_before_provider_or_gpt_status(self):
        self.health["rootFingerprint"] = "b" * 64
        result = self.verify(success=False)
        self.assertIn("does not serve this Reality Lens checkout", result.stderr)
        self.assertEqual(self.requests, [("GET", "/api/health")])

    def test_untrusted_states_service_dates_or_browser_credentials_fail_without_reflection(self):
        variants = [
            ("service", PRIVATE_MARKER), ("credentialStorage", PRIVATE_MARKER),
            ("credentialsInBrowser", True),
        ]
        for name, value in variants:
            with self.subTest(field=name):
                self.gpt_status = deepcopy(GPT_STATUS)
                self.gpt_status[name] = value
                self.verify(success=False)
        for name, value in [("state", PRIVATE_MARKER), ("verifiedAt", PRIVATE_MARKER),
                            ("dependencyState", PRIVATE_MARKER), ("authAvailable", "true"),
                            ("authAvailable", False), ("planUsage", "false")]:
            with self.subTest(chatgpt_field=name):
                self.gpt_status = deepcopy(GPT_STATUS)
                self.gpt_status["chatgpt"][name] = value
                self.verify(success=False)


if __name__ == "__main__":
    unittest.main()
