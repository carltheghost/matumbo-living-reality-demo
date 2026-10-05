"""Verify the distributable voice kit rather than only its source file list."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class VoiceKitTests(unittest.TestCase):
    def build(self, output: Path) -> dict:
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts/build_voice_kit.py"), "--output", str(output)],
            cwd=ROOT, capture_output=True, text=True, check=True,
        )
        return json.loads(result.stdout)

    def test_archive_is_reproducible_and_all_payload_hashes_match(self):
        with tempfile.TemporaryDirectory(prefix="matumbo-voice-kit-") as temporary:
            first = self.build(Path(temporary) / "first")
            second = self.build(Path(temporary) / "second")
            first_bytes = Path(first["archive"]).read_bytes()
            self.assertEqual(first_bytes, Path(second["archive"]).read_bytes())
            digest = hashlib.sha256(first_bytes).hexdigest()
            self.assertEqual(digest, first["sha256"])
            self.assertTrue(first["verified"])
            checksum = Path(first["archive"]).with_name("SHA256.txt").read_text().strip()
            self.assertEqual(checksum, f"{digest} *{Path(first['archive']).name}")
            with zipfile.ZipFile(first["archive"]) as archive:
                self.assertIsNone(archive.testzip())
                manifest = json.loads(archive.read("manifest.json"))
                self.assertEqual(manifest, json.loads(Path(first["manifest"]).read_text()))
                self.assertFalse(manifest["credentialsIncluded"])
                self.assertFalse(manifest["serverIncluded"])
                self.assertFalse(manifest["remoteDeliveryIncluded"])
                expected = {item["path"] for item in manifest["files"]}
                self.assertEqual(set(archive.namelist()), expected | {"manifest.json"})
                self.assertEqual(len(expected), manifest["fileCount"])
                self.assertTrue({"index.js", "package.json", "README.md", "examples/index.html",
                                 "LICENSE", "src/render/voice-session.js", "src/render/voice-dictation.css",
                                 "src/domains/voice-message.js"}.issubset(expected))
                self.assertFalse(any("bridge" in name or "room-workspace" in name or ".env" in name for name in expected))
                for item in manifest["files"]:
                    path = Path(item["path"])
                    self.assertFalse(path.is_absolute())
                    self.assertNotIn("..", path.parts)
                    self.assertFalse(any(part.startswith(".") for part in path.parts))
                    content = archive.read(item["path"])
                    self.assertEqual(len(content), item["bytes"])
                    self.assertEqual(hashlib.sha256(content).hexdigest(), item["sha256"])
                    if item["origin"] == "source":
                        self.assertEqual(content, (ROOT / path).read_bytes())

    def test_extracted_package_runs_its_own_node_tests_without_repo_imports(self):
        node = shutil.which("node")
        self.assertIsNotNone(node, "Node is required to verify the extracted browser package")
        with tempfile.TemporaryDirectory(prefix="matumbo-voice-adoption-") as temporary:
            result = self.build(Path(temporary) / "build")
            extracted = Path(temporary) / "extracted"
            with zipfile.ZipFile(result["archive"]) as archive:
                archive.extractall(extracted)
            package = json.loads((extracted / "package.json").read_text())
            self.assertEqual(package["name"], "@matumbo/browser-voice")
            self.assertTrue(package["private"])
            self.assertNotIn("dependencies", package)
            process = subprocess.run(
                [node, "--test", *[str(path) for path in sorted((extracted / "tests").glob("*.test.mjs"))]],
                cwd=extracted, capture_output=True, text=True,
            )
            self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertIn("portable encrypted envelope round trips", process.stdout)
            self.assertIn("voice factories never capture automatically", process.stdout)

    def test_existing_deliverable_is_not_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="matumbo-voice-retain-") as temporary:
            output = Path(temporary)
            first = self.build(output)
            original = Path(first["archive"]).read_bytes()
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts/build_voice_kit.py"), "--output", str(output)],
                cwd=ROOT, capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("will not be replaced", result.stderr)
            self.assertEqual(Path(first["archive"]).read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
