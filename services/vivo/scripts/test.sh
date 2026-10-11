#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
python -m unittest discover -s tests -p 'test_*.py' -v
(cd legacy/numerical && python -m unittest test_reference -v)
node legacy/studio/tests/core.cjs
node legacy/studio/tests/viva-core.cjs
for file in web/*.js; do node --check "$file"; done
