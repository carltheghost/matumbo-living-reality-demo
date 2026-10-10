#!/usr/bin/env python3
"""Stage exact PR #75 files in a disposable test checkout; never overwrite edits.

No Git writes, merges, reference updates, or application deployment. Dependencies
are read from a fixed commit and checked as Git blobs before being written.
"""
import hashlib
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
COMMIT = "8a10847009101ad08d6652b90608a63f18ac82f5"
BASE = f"https://raw.githubusercontent.com/carltheghost/matumbo-living-reality-demo/{COMMIT}/"
FILES = {
    "services/vivo/web/input/controller.mjs": "80f815e65fac89ae8e9d97e570f76c862c9fb61d",
    "services/vivo/tests/input/controller.test.mjs": "c3dd5dcc8424a5c67a4def22b8d252f63d628396",
}


def blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def main():
    pending = []
    for relative, expected in FILES.items():
        path = ROOT / relative
        if path.is_symlink() or any(p.is_symlink() for p in path.parents if p != ROOT):
            raise ValueError("Refusing symlink: " + relative)
        if path.exists():
            data = path.read_bytes()
        else:
            with urlopen(BASE + relative, timeout=30) as response:
                data = response.read(262145)
        if len(data) > 262144 or blob(data) != expected:
            raise ValueError("Dependency differs; refusing overwrite: " + relative)
        if not path.exists():
            pending.append((path, data))
        print(expected, relative)
    for path, data in pending:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as out:
            out.write(data)
    print("Verified exact PR #75 test dependency. No Git files staged or committed.")


if __name__ == "__main__":
    main()
