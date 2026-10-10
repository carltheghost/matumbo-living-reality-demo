"""Reproduce the pinned, same-origin MediaPipe runtime and model assets.

No package scripts run. The npm archive is integrity checked before its explicit
runtime allowlist is extracted. Re-running verifies model hashes from the saved
manifest, so an upstream replacement cannot silently change a checked-in model.
"""
import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.0.1"
ARCHIVE = f"https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-{VERSION}.tgz"
# Exact npm registry integrity; kept separate from the artifact SHA256 manifest.
INTEGRITY = "rvRE2FmAZ6ZxKSw7wq+e+jQDpN3t1B/tD2mJz9SmAzb1msoDkd4dMoE4wAh8Z30Um0PQwLiHr9QtomhmXk3aUQ=="
VENDOR = ROOT / "vendor" / f"mediapipe-tasks-vision-{VERSION}"
MODELS = ROOT / "assets" / "models" / "vision"
MANIFEST = MODELS / "provenance.json"


def download(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def main():
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    archive = download(ARCHIVE)
    if base64.b64encode(hashlib.sha512(archive).digest()).decode() != INTEGRITY:
        raise RuntimeError("MediaPipe npm integrity mismatch")
    records = []

    def save(path, data, url):
        digest = hashlib.sha256(data).hexdigest()
        relative = path.relative_to(ROOT).as_posix()
        old = next((f for f in previous.get("files", []) if f["path"] == relative), None)
        if old and old["sha256"] != digest:
            raise RuntimeError(f"Pinned asset changed: {relative}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        records.append({"path": relative, "bytes": len(data), "sha256": digest, "source": url})
        print(f"{relative}: {len(data)} bytes {digest}")

    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            parts = member.name.split("/")
            if not member.isfile() or not parts or parts[0] != "package":
                continue
            relative = "/".join(parts[1:])
            allowed = relative in {"vision_bundle.mjs", "package.json", "README.md", "LICENSE"}
            allowed |= len(parts) == 3 and parts[1] == "wasm" and parts[2].endswith((".js", ".wasm"))
            if allowed and ".." not in parts:
                save(VENDOR / relative, tar.extractfile(member).read(), ARCHIVE)
    license_url = "https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE"
    license_data = download(license_url)
    if hashlib.sha256(license_data).hexdigest() != "8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8":
        raise RuntimeError("MediaPipe license notice changed; inspect it before updating")
    save(VENDOR / "LICENSE", license_data, license_url)
    for name in ("hand_landmarker", "face_landmarker"):
        url = f"https://storage.googleapis.com/mediapipe-models/{name}/{name}/float16/1/{name}.task"
        save(MODELS / f"{name}.task", download(url), url)
    MANIFEST.write_text(json.dumps({
        "runtime": {"package": "@mediapipe/tasks-vision", "version": VERSION,
                    "license": "Apache-2.0", "integrity": "sha512-" + INTEGRITY},
        "modelDocumentation": [
            "https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker",
            "https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker"],
        "files": records,
    }, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
