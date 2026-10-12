"""Static and local contract checks for the opt-in remote deployment recipe."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


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
        self.assertIn(
            "COPY research/vivo-phase-fabric/web/target-mailbox.mjs "
            "/app/research/vivo-phase-fabric/web/target-mailbox.mjs",
            dockerfile,
        )
        self.assertIn('ENTRYPOINT ["/app/services/vivo/start-canonical-remote.sh"]', dockerfile)

    def test_caddy_and_launcher_contracts_are_explicit(self):
        caddy = CADDYFILE.read_text()
        self.assertIn("{$VIVA_DOMAIN}", caddy)
        self.assertIn("reverse_proxy vivo-remote:8768", caddy)
        subprocess.run(["sh", "-n", str(LAUNCHER)], check=True)
        self.assertIn("VIVO_OWNER_TOKEN", LAUNCHER.read_text())

    @unittest.skipUnless(shutil.which("docker"), "Docker is not available")
    def test_compose_renders_with_nonsecret_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "remote.env"
            env.write_text(
                "VIVA_DOMAIN=remote.example.test\n"
                "VIVA_PUBLIC_ORIGIN=https://remote.example.test\n"
                "VIVO_OWNER_TOKEN=fixture-owner-token-0123456789abcdef\n"
                "OPENAI_API_KEY=\n"
            )
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
            self.assertEqual(remote["command"][remote["command"].index("--origin") + 1], "https://remote.example.test")
            self.assertEqual(
                [port["published"] for port in rendered["services"]["https"]["ports"]],
                ["80", "443"],
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
