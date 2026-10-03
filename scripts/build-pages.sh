#!/usr/bin/env bash
# Shared cross-platform implementation; deployable browser assets only.
set -euo pipefail
task_repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$task_repo_root"
python3 scripts/build_pages.py "${1:-dist}"
