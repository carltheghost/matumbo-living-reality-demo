"""Static and local contract checks for the opt-in remote deployment recipe."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "compose.remote.yaml"
DOCKERFILE = ROOT / "Dockerfile.remote"
CADDYFILE = ROOT / "Caddyfile.remote"
ENV_EXAMPLE = ROOT / "docs" / "REMOTE-DEPLOYMENT.env.example"
LAUNCHER = ROOT / "start-canonical-remote.sh"


class RemoteDeploymentContractTests(unittest.TestCase):
    def test_recipe_is_separate_and_keeps_the_app_private(self):
        compose = COMPOSE.read_text()
        remote = compose.split("  https:", 1)[0]
        self.assertIn("dockerfile: services/vivo/Dockerfile.remote", remote)
        self.assertIn("context: ../..", remote)
        self.assertIn("- --origin", remote)
        self.assertIn("${VIVA_PUBLIC_ORIGIN:?Set the exact public HTTPS origin}", remote)
        self.assertIn("--cert", remote)
        self.assertIn("/run/secrets/vivo_backend_cert", remote)
        self.assertIn("--key", remote)
        self.assertIn("/run/secrets/vivo_backend_key", remote)
        self.assertIn("https://127.0.0.1:8768/healthz", remote)
        self.assertIn("cafile='/run/secrets/vivo_backend_ca'", remote)
        self.assertIn('expose:\n      - "8768"', remote)
        self.assertNotIn("\n    ports:", remote)
        self.assertIn("vivo-remote-data:/data", remote)
        self.assertIn("condition: service_healthy", compose)
        self.assertEqual(compose.count("stop_grace_period: 30s"), 2)

    def test_conversation_is_disabled_by_empty_key_and_limits_are_explicit(self):
        compose = COMPOSE.read_text()
        env_example = ENV_EXAMPLE.read_text()
        self.assertIn("OPENAI_API_KEY: ${OPENAI_API_KEY-}", compose)
        self.assertIn("OPENAI_API_KEY=\n", env_example)
        self.assertNotIn("sk-", env_example)
        for name, value in {
            "VIVO_CONVERSATION_TIMEOUT_SECONDS": "18",
            "VIVO_CONVERSATION_MAX_MESSAGE_CHARS": "400",
            "VIVO_CONVERSATION_MAX_OUTPUT_CHARS": "4000",
            "VIVO_CONVERSATION_MAX_HISTORY_MESSAGES": "24",
            "VIVO_CONVERSATION_MAX_HISTORY_CHARS": "12000",
            "VIVO_OPENAI_MAX_OUTPUT_TOKENS": "240",
            "VIVO_CONVERSATION_REQUESTS_PER_MINUTE": "12",
            "VIVO_CONVERSATION_MAX_SESSIONS": "256",
            "VIVO_CONVERSATION_MAX_SESSIONS_PER_IDENTITY": "32",
            "VIVO_CONVERSATION_MAX_BODY_BYTES": "16384",
        }.items():
            self.assertIn(f"{name}={value}", env_example)

    def test_remote_image_preserves_repository_relative_module_routes(self):
        dockerfile = DOCKERFILE.read_text()
        self.assertIn("FROM node:24.19.0-bookworm-slim", dockerfile)
        self.assertIn("COPY services/vivo/contracts /app/services/vivo/contracts", dockerfile)
        self.assertIn("COPY services/vivo/server /app/services/vivo/server", dockerfile)
        self.assertIn("COPY services/vivo/web /app/services/vivo/web", dockerfile)
        self.assertIn("COPY services/vivo_adaptive /app/services/vivo_adaptive", dockerfile)
        self.assertIn("COPY services/vivo_material /app/services/vivo_material", dockerfile)
        self.assertIn(
            "COPY research/vivo-phase-fabric/web/target-mailbox.mjs "
            "/app/research/vivo-phase-fabric/web/target-mailbox.mjs",
            dockerfile,
        )
        self.assertIn('ENTRYPOINT ["/app/services/vivo/start-canonical-remote.sh"]', dockerfile)

    def test_caddy_and_launcher_contracts_are_explicit(self):
        caddy = CADDYFILE.read_text()
        self.assertIn("{$VIVA_DOMAIN}", caddy)
        self.assertIn("reverse_proxy https://vivo-remote:8768", caddy)
        self.assertIn("tls_trust_pool file /run/secrets/vivo_backend_ca", caddy)
        self.assertIn("tls_server_name vivo-remote", caddy)
        subprocess.run(["sh", "-n", str(LAUNCHER)], check=True)
        self.assertIn("VIVO_OWNER_TOKEN", LAUNCHER.read_text())

    @unittest.skipUnless(
        shutil.which("openssl") and shutil.which("node"),
        "OpenSSL and Node.js are required for the TLS startup fixture",
    )
    def test_tls_bound_recipe_server_starts_and_stops(self):
        """Exercise the same non-loopback TLS binding used by Compose."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_dir = root / "data"
            data_dir.mkdir()
            ca_key = root / "ca.key"
            ca_cert = root / "ca.pem"
            server_key = root / "server.key"
            server_csr = root / "server.csr"
            server_cert = root / "server.pem"
            extensions = root / "server.ext"
            subprocess.run(
                [
                    "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                    "-days", "1", "-keyout", str(ca_key), "-out", str(ca_cert),
                    "-subj", "/CN=Vivo CI CA",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                [
                    "openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes",
                    "-keyout", str(server_key), "-out", str(server_csr),
                    "-subj", "/CN=vivo-remote",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            extensions.write_text("subjectAltName=DNS:vivo-remote,IP:127.0.0.1\n")
            subprocess.run(
                [
                    "openssl", "x509", "-req", "-in", str(server_csr),
                    "-CA", str(ca_cert), "-CAkey", str(ca_key), "-CAcreateserial",
                    "-out", str(server_cert), "-days", "1", "-sha256",
                    "-extfile", str(extensions),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]

            origin = f"https://127.0.0.1:{port}"
            token = "fixture-owner-token-0123456789abcdef"
            environment = os.environ.copy()
            environment.update(
                {
                    "OPENAI_API_KEY": "",
                    "PYTHONPATH": str(ROOT),
                    "VIVO_OWNER_TOKEN": token,
                }
            )
            process = subprocess.Popen(
                [
                    sys.executable, "-m", "server.remote_application",
                    "--host", "0.0.0.0", "--port", str(port),
                    "--data-dir", str(data_dir), "--origin", origin,
                    "--store", "posix", "--cert", str(server_cert),
                    "--key", str(server_key),
                ],
                cwd=ROOT,
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            context = ssl.create_default_context(cafile=str(ca_cert))
            try:
                deadline = time.monotonic() + 20
                last_error = None
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        break
                    try:
                        with urlopen(origin + "/healthz", context=context, timeout=2) as response:
                            health = json.load(response)
                        if response.status == 200 and health.get("ok") is True:
                            break
                    except Exception as error:  # startup race only
                        last_error = f"{type(error).__name__}: {error}"
                    time.sleep(0.25)
                else:
                    self.fail(f"TLS recipe server did not become healthy: {last_error}")
                self.assertIsNone(process.poll(), "TLS recipe server exited during startup")

                request = Request(
                    origin + "/api/conversation/status",
                    headers={"Origin": origin, "Authorization": f"Bearer {token}"},
                )
                with urlopen(request, context=context, timeout=3) as response:
                    status = json.load(response)
                self.assertFalse(status["available"])
                self.assertEqual(status["reason"], "provider-not-configured")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                stdout, stderr = process.communicate()
                self.assertEqual(
                    process.returncode,
                    0,
                    f"TLS recipe server did not stop cleanly: {stdout[-1000:]} {stderr[-1000:]}",
                )

    @unittest.skipUnless(shutil.which("docker"), "Docker is not available")
    def test_compose_renders_with_nonsecret_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "remote.env"
            env.write_text(
                "VIVA_DOMAIN=remote.example.test\n"
                "VIVA_PUBLIC_ORIGIN=https://remote.example.test\n"
                f"VIVO_BACKEND_CERT_FILE={Path(directory) / 'backend.crt'}\n"
                f"VIVO_BACKEND_KEY_FILE={Path(directory) / 'backend.key'}\n"
                f"VIVO_BACKEND_CA_FILE={Path(directory) / 'backend-ca.pem'}\n"
                "VIVO_OWNER_TOKEN=fixture-owner-token-0123456789abcdef\n"
                "OPENAI_API_KEY=\n"
            )
            for name in ("backend.crt", "backend.key", "backend-ca.pem"):
                (Path(directory) / name).write_text("fixture\n")
            result = subprocess.run(
                [
                    "docker", "compose", "--env-file", str(env),
                    "-f", str(COMPOSE), "config", "--format", "json",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            rendered = json.loads(result.stdout)
            remote = rendered["services"]["vivo-remote"]
            self.assertNotIn("ports", remote)
            self.assertEqual(remote["expose"], ["8768"])
            self.assertEqual(
                {item["source"] for item in remote["secrets"]},
                {"vivo_backend_ca", "vivo_backend_cert", "vivo_backend_key"},
            )
            self.assertEqual(remote["command"][remote["command"].index("--origin") + 1], "https://remote.example.test")
            self.assertEqual(
                [item["source"] for item in rendered["services"]["https"]["secrets"]],
                ["vivo_backend_ca"],
            )
            self.assertEqual(
                [port["published"] for port in rendered["services"]["https"]["ports"]],
                ["80", "443"],
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
