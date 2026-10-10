"""Run every JavaScript test file using the same paths on Windows and Linux."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
files = sorted(path.relative_to(ROOT).as_posix() for path in (ROOT / "tests").glob("*.test.mjs"))
if not files:
    raise RuntimeError("No JavaScript tests found.")
# Each file owns an isolated process; bound contention for real launcher tests.
concurrency = min(4, os.cpu_count() or 1)
sys.exit(subprocess.run(["node", "--test", f"--test-concurrency={concurrency}", *files], cwd=ROOT).returncode)
