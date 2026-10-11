#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install -r requirements.txt
printf '\nOpen http://localhost:8765 in a desktop browser. Phone cameras require HTTPS.\n'
exec .venv/bin/python -m server
