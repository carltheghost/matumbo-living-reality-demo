# Complete exact original source import

Base: `84832d07ee21bef76c538be8f897b1be637bc3ca` (PR 76).
Branch: `vivo/complete-source-import-2026-10-11`.
This checkpoint imports all **109 runtime + 31 research archive members** byte-for-byte.
It adds the 96 runtime and 25 research members absent from the base. All 19 already
committed originals were identical; none were overwritten with different bytes.

## Provenance and preserved additions

`services/vivo/source-import.json` records each original path, byte length, SHA-256,
Git blob identity and source archive. Archives remain identified by their verified
original SHA-256s:

- Runtime: `6c5b0338f413385fd34934ce290fcc3459a33788c1de7f763316a89061d34a72`.
- Research: `adcda4383e98903a12711ceeaf6fef48ddfb60214e206a9f502339bdea50f278`.

The manifest separately lists the 14 already-committed additions within those trees,
including authority, host, contracts, integration tests and the historical stage-A
manifest. They are preserved, not represented as original archive members.
`modifiedOriginalOverlays` is empty. No original file differed at this checkpoint.
Historical reports, generated images, checkpoints and training data inside the ZIPs
remain historical artifacts, not new experiment or device results.

The seven vendor assets match the prior verified vendor-transfer manifest. The SIMD
and non-SIMD WASM blobs are `639e1896a631dcd49b39f9c76c908a99285e1bcf` and
`a6dd15a0976a36094f5299965ccc9f31003dcd05`. No substitute files or truncated blobs.

## Verification

Run from the repository root:

```sh
python scripts/vivo/verify_source_import.py
python scripts/vivo/test_source_import.py
python services/vivo/scripts/verify_integrity.py
python scripts/vivo/test_import_stage_a.py
sh services/vivo/scripts/test.sh
PYTHONPATH=research/vivo-phase-fabric python -m unittest discover -s research/vivo-phase-fabric/tests -p 'test_*.py' -v
node --test research/vivo-phase-fabric/tests/target-mailbox.test.mjs
node --test services/vivo/tests/integration/contracts.test.mjs
python -m unittest discover -s services/vivo/tests/integration -p 'test_*.py' -v
```

Fresh final-tree local results: **265 passing tests/checks**: 185 original runtime
and legacy, 26 phase, 9 mailbox, 17 contracts, 9 intake, 9 source-import/readiness,
and 10 verifier fixtures. The separate integrity checks match all 140 original
members and all 45 original packaged-integrity entries, before and after tests.
Raw logs and environment metadata are in `source-import-evidence/2026-10-11/`.

Local environment: Python 3.12.14, NumPy 2.3.5, aiohttp 3.14.4, Node 24.19.0.
The source-import workflow reruns with Python 3.13, Node 22 and original pinned
Python requirements (aiohttp 3.13.3 / NumPy 2.3.5). Check the exact commit's CI
result separately; local evidence is not a claim that remote CI passed.
The workflow explicitly selects Bash and sets `-euo pipefail` for every test/log
pipeline, so `tee` cannot hide failed tests.

## Readiness and next gate

Complete assets now have a real loopback `/readyz` assertion for HTTP 200, readable
model, open database and no missing assets. A separately constructed empty-asset
fixture still asserts HTTP 503 without deleting or rewriting original source files.
Both keep physical-device and public-deployment validation false.

This is source import and service readiness, **not app-wide integration**. Next:
mount the canonical authority/input/material flow and prove two participants shape
one persistent object through true extra coordinates, nested enter/edit/return,
independent Eyes and restart/reconnect. Browser, actual camera/phone, public-network,
new material training and deployment tests were not run here. Root landing, Pages
workflow and Chat 3 paths are untouched; no merge or deployment is performed.

Additive integration can retain this strict 140-member gate. If a later authorized
stage must change original runtime files, it must add an explicit derived-source
overlay record and verification: preserve original identities and checkpoint,
record current hashes and reasons, and reject undeclared differences. Do not quietly
replace original hashes or weaken the byte-integrity assertions.

The old `source-import-stage-a.json` is preserved as the historical 13-file backend
checkpoint; its focused test now handles a complete import and a deliberate missing-
asset fixture rather than assuming that this checkout lacks camera assets.
