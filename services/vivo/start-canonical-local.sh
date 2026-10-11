#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
command -v node >/dev/null 2>&1 || { echo 'Install Node.js 22 or newer from nodejs.org, then retry.' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || { echo 'Node.js 22 or newer is required.' >&2; exit 1; }
PYTHON="${VIVO_PYTHON:-python3}"
"$PYTHON" -c 'import aiohttp,numpy' || { echo 'Install this service requirements.txt into your Python environment, then retry.' >&2; exit 1; }
if [ ! -f web/input/controller.mjs ]; then
  echo 'Exact PR75 input dependency is missing. From repository root run: python scripts/vivo/stage_input_dependency.py' >&2
  exit 1
fi
PYTHONDONTWRITEBYTECODE=1 exec "$PYTHON" -m server.local_application "$@"
