#!/usr/bin/env python3
"""Stage exact simulated-economy bytes inside the Vivo phone SW scope.

The phone Pages route cannot rely on imports outside services/vivo/web/ while
offline. This script mirrors the canonical source-shaped modules into that
scope and records their content hashes. Existing staged files are never
overwritten: a mismatch is an explicit integration error, not a silent fork.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "services/vivo/web/phone/vendor/economy/manifest.json"
FILES = (
    ("src/domains/simulated-economy.js", "services/vivo/web/phone/vendor/economy/src/domains/simulated-economy.js"),
    ("src/domains/token.js", "services/vivo/web/phone/vendor/economy/src/domains/token.js"),
    ("src/domains/token-config.js", "services/vivo/web/phone/vendor/economy/src/domains/token-config.js"),
    ("src/domains/token-store.js", "services/vivo/web/phone/vendor/economy/src/domains/token-store.js"),
    ("src/render/simulated-economy-panel.js", "services/vivo/web/phone/vendor/economy/src/render/simulated-economy-panel.js"),
)


def git_blob(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode("ascii")
    return hashlib.sha1(header + data).hexdigest()


def entry(source: str, staged: str, data: bytes) -> dict[str, object]:
    return {
        "source": source,
        "staged": staged,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "gitBlob": git_blob(data),
    }


def safe_read(path: Path, label: str) -> bytes:
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents if parent != ROOT):
        raise ValueError(f"refusing symlink in economy dependency path: {label}")
    if not path.is_file():
        raise ValueError(f"missing economy dependency: {label}")
    return path.read_bytes()


def ensure_exact(path: Path, expected: bytes, label: str, check_only: bool) -> None:
    if path.exists():
        actual = safe_read(path, label)
        if actual != expected:
            raise ValueError(f"staged economy dependency differs from canonical source: {label}")
        return
    if check_only:
        raise ValueError(f"staged economy dependency is missing: {label}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(expected)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify staged files without creating missing files")
    args = parser.parse_args()

    entries = []
    for source, staged in FILES:
        source_path = ROOT / source
        staged_path = ROOT / staged
        data = safe_read(source_path, source)
        ensure_exact(staged_path, data, staged, args.check)
        entries.append(entry(source, staged, data))

    manifest_value = {
        "schema": "vivo.phone.simulated-economy-stage/1",
        "canonicalRoot": "src",
        "files": entries,
    }
    manifest_data = (json.dumps(manifest_value, indent=2, sort_keys=False) + "\n").encode("utf-8")
    if MANIFEST.exists():
        if safe_read(MANIFEST, str(MANIFEST.relative_to(ROOT))) != manifest_data:
            raise ValueError("staged economy manifest differs from canonical dependency bytes")
    elif args.check:
        raise ValueError("staged economy manifest is missing")
    else:
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_bytes(manifest_data)

    print(json.dumps({"check": args.check, **manifest_value}, indent=2))


if __name__ == "__main__":
    main()
