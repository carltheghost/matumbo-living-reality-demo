"""Exercise the usable package, its integrity manifest, and reproducible bytes."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class StaticPackageTests(unittest.TestCase):
    def test_fresh_builds_match_and_every_manifest_file_is_usable(self):
        with tempfile.TemporaryDirectory(prefix="matumbo-package-test-") as temporary:
            outputs = []
            for name in ("first", "second"):
                destination = Path(temporary) / name
                process = subprocess.run(
                    [sys.executable, str(ROOT / "scripts/package_demo.py"), str(destination)],
                    cwd=ROOT, capture_output=True, text=True, check=True,
                )
                result = json.loads(process.stdout)
                archive_path = Path(result["archive"])
                self.assertTrue(result["verified"])
                digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
                self.assertEqual(result["sha256"], digest)
                self.assertEqual((destination / "SHA256.txt").read_text().strip(),
                                 f"{digest} *{archive_path.name}")
                with zipfile.ZipFile(archive_path) as archive:
                    self.assertIsNone(archive.testzip())
                    manifest = json.loads(archive.read("manifest.json"))
                    self.assertEqual(manifest, json.loads((destination / "manifest.json").read_text()))
                    self.assertFalse(manifest["credentialsRequired"])
                    self.assertFalse(manifest["serverIncluded"])
                    self.assertFalse(manifest["externalDeployment"])
                    self.assertEqual(manifest["fileCount"], len(manifest["files"]))
                    self.assertEqual(len(archive.namelist()), result["fileCount"] + 1)
                    required = {"index.html", "src/main.js", "src/render/reality-assembly.js",
                                "src/render/youtube-surface.js", "vendor/three-r179.1/build/three.module.js"}
                    self.assertTrue(required.issubset(archive.namelist()))
                    for entry in manifest["files"]:
                        path = Path(entry["path"])
                        self.assertFalse(path.is_absolute())
                        self.assertNotIn("..", path.parts)
                        self.assertFalse(any(part.startswith(".") for part in path.parts)
                                         and entry["path"] != ".nojekyll")
                        self.assertNotIn(path.parts[0], ("tests", "scripts", "docs", "work"))
                        content = archive.read(entry["path"])
                        self.assertEqual(len(content), entry["bytes"])
                        self.assertEqual(hashlib.sha256(content).hexdigest(), entry["sha256"])
                outputs.append(archive_path.read_bytes())
            self.assertEqual(outputs[0], outputs[1], "ZIP bytes should not depend on output paths or source mtimes")
            rejected = subprocess.run(
                [sys.executable, str(ROOT / "scripts/package_demo.py"), str(Path(temporary) / "first")],
                cwd=ROOT, capture_output=True, text=True,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("existing archive will not be replaced", rejected.stderr)
            self.assertEqual((Path(temporary) / "first/matumbo-static-demo.zip").read_bytes(), outputs[0])


if __name__ == "__main__":
    unittest.main()
