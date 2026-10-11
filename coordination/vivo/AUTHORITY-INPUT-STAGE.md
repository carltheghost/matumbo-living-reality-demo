# Main-owned authority/input integration ports | 2026-10-10

Independent stage while atomic full-source publication remains blocked. Parent:
c60fdc5734d071a867ba519cf0b02c408c929121 (observed concurrent backend-only import).
This work is isolated on vivo/chat1-authority-input-2026-10-10 and targets the main
integration branch. Do not merge or deploy. No original 0.8.1 bytes, contracts,
Chat 3 files, comparison page, or Pages workflow are modified by this stage.

## Implemented

- `LocalLeaseWorld` accepts canonical `grab.begin`, `grab.target`, `grab.end`.
  Host admission is local/privileged; actor identity is bound to returned client
  closures, never a command payload. Exclusive leases, source/epoch/revision/
  target ordering, idempotent command IDs, renewal, expiry and owner-specific
  reconciliation are enforced. Receipt state hashes use SHA-256.
- Every accepted command is atomically stored with its journal and receipt before
  acknowledgement. The injected store must provide transactional compare-and-swap.
  `MemoryAuthorityStore` is explicitly volatile. Checkpoint export/load is tested;
  disk persistence, cross-tab admission locks and remote authentication are NOT
  implemented. A restarted authority revokes old process-local leases.
- Targets are stored as full-dimensional constraints; they do NOT directly change
  entity coordinates, field values, velocity or simulation time. MaterialDriver
  integration remains the next stage. Existing space/entity identities are
  preserved; nested enter/exit and world.fork return NOT_IMPLEMENTED, not fake success.
- `GripHost` consumes the real unmodified PR #75 controller. It acquires a checked
  lease before begin, schedules renewal separately, forwards full Frames, isolates
  per-key previews, offers the final captured sample before end, and connects
  failures/late outcomes to actual owner-specific reconciliation. No intent replay
  or automatic resume after uncertain outcomes. Camera-loss cancellation is source-specific.
- Opt-in Python routes expose exactly five JS modules with correct relative-import
  addresses and MIME type. They do not expose the repository, private server files,
  research data, or automatically mount into the legacy app.

## Dependency and ownership

PR #75 remains unmerged. Its exact controller Git blob is
80f815e65fac89ae8e9d97e570f76c862c9fb61d at commit
8a10847009101ad08d6652b90608a63f18ac82f5.
`stage_input_dependency.py` fetches pinned worker sources only into a disposable
CI test checkout, checking hashes and refusing existing edits. They are not part
of this commit. This is test composition, not a merge/cherry-pick.

## Execute

```sh
python scripts/vivo/stage_input_dependency.py
node --test services/vivo/tests/authority/*.test.mjs services/vivo/tests/input/*.test.mjs services/vivo/tests/integration/contracts.test.mjs research/vivo-phase-fabric/tests/target-mailbox.test.mjs
python -m unittest discover -s services/vivo/tests/authority -p 'test_*.py' -v
```

Local evidence: 41 new Node tests with the exact worker controller; four actual
loopback HTTP tests. CI also executes the pinned worker's 65 existing tests and
unchanged contract/mailbox tests. Check CI results rather than assume success.

## Import-transfer probe

Original SIMD WASM: 9,423,986 bytes; SHA-256
f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc;
Git blob 639e1896a631dcd49b39f9c76c908a99285e1bcf.
Full base64 is 12,565,316 characters. The connected create_blob action accepts
an inline string only, not a file/stream or an append/chunk handle. No full-size
request was submitted, and no GitHub maximum-size rejection is established.
A detached 64-byte prefix probe through create_blob(encoding=base64) succeeded,
returning the independently computed blob e65106156f96a9fe5f199a42b620a9493fe30777.
This is NOT the full WASM and is attached to no runtime tree. Git transport still
fails to resolve github.com in the execution environment. Complete atomic 109-file
import remains pending; this stage does not publish any subset of that archive.

## Remaining gates

Transactional device storage; canonical remote protocol; expiry/admission across
reconnects; nested-world/Eye transitions; material stepping and evaluated learned
responses; actual entrypoint/renderer/camera wiring; public and device acceptance.
Local admission is not remote authentication. Main's tests are not an independent
external review. No calibrated gaze, camera speed-up, complete room behavior,
physical device, public URL, merge or deployment claim.
