#!/bin/sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

PYTHON="${VIVO_PYTHON:-python3}"
command -v node >/dev/null 2>&1 || {
  echo 'Vivo remote requires Node.js 22 or newer.' >&2
  exit 1
}
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || {
  echo 'Vivo remote requires Node.js 22 or newer.' >&2
  exit 1
}
"$PYTHON" -c 'import aiohttp,numpy' >/dev/null 2>&1 || {
  echo 'Install services/vivo/requirements.txt in this Python environment.' >&2
  exit 1
}
if [ ! -f web/input/controller.mjs ]; then
  echo 'The exact staged Chat 3 input dependency is missing. From repository root run: python scripts/vivo/stage_input_dependency.py' >&2
  exit 1
fi
if [ -z "${VIVO_OWNER_TOKEN:-}" ] || [ "${#VIVO_OWNER_TOKEN}" -lt 32 ]; then
  echo 'Set VIVO_OWNER_TOKEN to at least 32 random characters. It is the owner capability and is never written by this launcher.' >&2
  exit 1
fi

# remote_application itself enforces TLS for every non-loopback bind. This
# wrapper deliberately does not invent certificates, weaken Origin, or print
# the owner capability.
PYTHONDONTWRITEBYTECODE=1 exec "$PYTHON" -m server.remote_application "$@"
