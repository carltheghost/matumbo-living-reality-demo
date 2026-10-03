#!/usr/bin/env bash
# Shared by GitHub Pages and local release verification. Copy browser assets
# explicitly, so development sources and credentials never enter the artifact.
set -euo pipefail
task_repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_pages_output="${1:-dist}"
cd "$task_repo_root"
mkdir -p "$task_pages_output"
cp -R src vendor assets "$task_pages_output/"
cp favicon.svg .nojekyll "$task_pages_output/"
find . -maxdepth 1 -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' \) -exec cp {} "$task_pages_output/" \;
printf '%s\n' 'maTumbo Living Reality deployment' > "$task_pages_output/health.txt"
python3 - "$task_pages_output" <<'PY'
from pathlib import Path
import sys
page = Path(sys.argv[1]) / 'index.html'
html = page.read_text(encoding='utf-8')
marker = '<script type="module">import("./src/render/reality-25-bridge.js?v=20260922-directional3").catch((error)=>{try{console.warn("[reality25] optional surface degraded:",error);}catch{}});</script>'
if marker not in html:
    html = html.replace('</body>', f'{marker}</body>')
page.write_text(html, encoding='utf-8')
PY
