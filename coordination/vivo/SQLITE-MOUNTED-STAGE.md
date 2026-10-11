# Explicit SQLite mounted application candidate

## Commit boundary and scope

- Base POSIX/phase candidate: `5c7b8e664243afa71c2b6962c084362f16a0659e`.
- Unmodified SQLite component source: `45fa8aaa43d36830369ecb0091a51e69cc1f2361`.
- Component cherry-pick on this branch: `2e64c19`.
- Isolated branch: `newvivo-sqlite-mount`.
- Separate application commit owns the selector/lifecycle, Python bridge, focused
  tests/shared test helpers, CI composition and these additive usage/evidence docs.

The approved POSIX worktree remains at its exact original commit. No imported
source, PR75 input, SQLite store/path-policy module, shared wire contract, root
landing or static deployment is changed by the application commit. No upload,
publication, merge, deploy, dependency installation or ACL modification was done.

## Runtime changes

`MountedRuntime.open({path, store: 'sqlite', ...})` and Python
`make_local_app(directory, store='sqlite', ...)` explicitly select the backend.
The CLI has `--store {posix,sqlite}`, default `posix`. SQLite is imported lazily,
so Node 22's POSIX path does not load it. SQLite itself enforces Node 24.19+ within
Node 24 and its minimum bundled SQLite version. The exact same authority and
material proposal path are retained, including the narrow 8^4 mounted profile.

The metering wrapper awaits backend ownership before its first load. It forwards
both the real `supportsCommitGuard` capability and `compareAndSwap` options.
Neither its record/byte counter nor the authority publishes before CAS resolves.
Store ownership persists until after session cleanup; failed startup closes it.
A first close failure is fatal and terminates the owning CLI process rather than
trusting the store's idempotent subsequent close or `closed` flag.

A fatal backend fault is separately latched. Ready returns false, HTTP readiness
returns 503, the journal reports read-only and all non-readiness/shutdown operations
are unavailable. Material evolution stops. Timer sweeps skip all further writes
and cannot erase storage uncertainty. Restart loads the actual committed record;
there is no replay of an uncertain request. Ordinary confirmed final-guard rollback
is retryable and does not poison the owner.

SQLite canonical files are separately named `canonical-world.sqlite` and
`canonical-phase.sqlite`; a fresh file is refused beside the corresponding legacy
JSON checkpoint. No migration, fallback, reseed or deletion is supplied. Both use
the same 64 MiB logical checkpoint bound and existing event/byte cleanup reserves.

Python SQLite mode requires an existing absolute directory outside the checkout,
does not call mkdir for that path and retains its lexical path for Node's complete
ancestor/reparse/privacy checks. The original comparison app receives `:memory:`;
there is no persistent legacy write before Node privacy validation. Readiness labels
the comparison as volatile memory. POSIX comparison behavior is unchanged, and the
default POSIX route still rejects Windows before any application writes.

## Verification (2026-10-11, Linux)

Environment: Node 24.19.0 / SQLite 3.53.3; Python 3.12.14 / NumPy 2.3.5 /
aiohttp 3.14.4. Evidence classes are deterministic synthetic backend/fault injection,
actual subprocess ownership, actual Python-to-Node private pipe, and real loopback
HTTP. No physical device, native Windows, browser display or public hosting claim.

- 351 composed Node tests pass, no skips: existing 320 plus 22 component and nine
  SQLite mounted tests.
- 58 application Python tests pass, including all 38 original scenarios and 20
  additional SQLite HTTP parity/privacy/fault checks.
- 39 material component Python tests pass.
- Numerical verifier passes; its limits on spatial/physical validation remain.
- Nine source-import HTTP/asset/readiness tests pass.
- All 140 original members verify byte-identical (109 runtime + 31 research).
- YAML parses, changed workflow shell blocks parse with bash, and diff whitespace
  checks pass. No hosted CI run or installation of another Node version occurred.

Important regression details:

1. A second actual mounted process fails STORE_BUSY before world load/restart
   release, leaving the first owner's complete checkpoint unchanged.
2. Abrupt mounted owner exit preserves Eye/history; the next owner appends exactly
   one restart-release and does not reseed accepted state.
3. Both ordinary and phase HTTP scenarios reuse existing helpers/implementations.
   Phase restart checks complete field bytes, q, v and both independent Eyes;
   pause, nested return, input-host, capacity/read-only and public-size gates recur.
4. The final guard test runs a real numerical proposal through MountedRuntime,
   its metering wrapper and SQLite. It advances the authority clock only after
   actual UPDATE DML, observes ROLLBACK with no COMMIT, and proves byte-identical
   full accepted checkpoint (including fields, receipts, epochs, material lease
   coverage and history) and zero observer publication.
5. Before-COMMIT and after-COMMIT faults keep readiness false/read-only across
   multiple actual timer sweeps. A test-only child preload also injects a real
   post-COMMIT exception through the complete HTTP bridge; readiness remains 503
   and restart recovers the committed Eye exactly without replay.
6. A real CLI close-failure injection returns STORE_CLOSE_FAILED and exits 1;
   another process can then acquire the saved store. A failed acquired-world
   validation releases ownership without rewriting or repairing that checkpoint.
7. Missing/insecure/checkout/symlink paths and existing JSON are refused without
   canonical/comparison writes; no permissions are repaired.

Reproduce the aggregate gates from the checkout (after staging the exact input
blobs using the existing immutable-dependency script):

```sh
node --test services/vivo/tests/application/*.test.mjs services/vivo/tests/authority/*.test.mjs services/vivo/tests/material-authority/*.test.mjs services/vivo/tests/input/*.test.mjs services/vivo/tests/integration/contracts.test.mjs services/vivo_material/tests/*.test.mjs research/vivo-phase-fabric/tests/target-mailbox.test.mjs
python -m unittest discover -s services/vivo/tests/application -p 'test_*.py' -v
python -m unittest discover -s services/vivo_material/tests -v
python -m services.vivo_material.verify
python scripts/vivo/test_import_stage_a.py
python scripts/vivo/verify_source_import.py
```

Raw logs are handed to the integration owner with the commit. The unmerged input
files remain untracked and match the existing immutable PR75 blob manifest.

## CI composition

`vivo-application.yml` has Node 22 and Node 24.19.0 matrix jobs. Node 24.19 runs
all composed/application/material/input/SQLite Node and Python scenarios and
unchanged original-source/numerical gates. Node 22 preserves all POSIX coverage,
excluding only the named SQLite modules `sqlite-runtime.test.mjs`,
`sqlite-store.test.mjs` and `test_sqlite_entrypoint.py`. This is backend selection,
not skipped SQLite verification; every excluded module runs in the full 24.19 job.
The existing Node 22 authority/input job is in `vivo-runtime.yml` (there is no
`vivo-authority.yml` in this tree); its authority glob likewise excludes only
`sqlite-store.test.mjs`. Artifact names include Node versions to avoid collisions.
The installed executables are Node 24, so this stage cannot claim a fresh local
Node 22 execution; the Node 22 job has been configured but not run remotely.

## Remaining gates

Standalone SQLite review is not native application acceptance. Strict native
Windows private-directory/DACL inspection is still blocked by additional SIDs on
the inspected task folder. Do not weaken it or describe Windows launch as working.
A separately approved private path, actual exact-adapter native probe, Python/Node
HTTP launch, disk high-water/large-checkpoint latency, and independent combined
candidate review remain required. Physical DB+WAL size is not bounded to the
logical 64 MiB checkpoint size. No native latency/power-loss guarantees are made.


## Startup-preservation correction

The exact `97c468ff` candidate passed its aggregate tests but independent review
found a refusal-side physical mutation: opening an unrelated crash-left WAL store
returned STORE_SCHEMA while changing main bytes from 4096 to 8192 and deleting a
12392-byte WAL. No logical SQL data loss was demonstrated. That candidate is not
certified for release. The isolated correction adds a retained read-only identity
transaction followed by writer-locked revalidation and a tested handoff to the
same lifetime exclusive owner. A refused writer is closed before the guard reader.
Main/WAL/rollback-journal payloads are preserved; transient SHM metadata may change.
The SQLite component document gives the precise boundary and official references.

Eight additional regressions cover foreign WAL, absent SHM, wrong version, extra
table, a foreign hot rollback journal, valid first-checkpoint identity present only in WAL, a separate SQL writer
changing identity between the two checks, and array-subclass serialization. The
last issue is a direct exported-store codec issue; no HTTP reachability was found
because the mounted authority clones its input. Its correction rejects custom
array prototypes before transaction or `toJSON` execution. PR75 and authority
contracts remain unchanged.

Correction reruns on Linux: 359 composed Node tests (30 SQLite component), all
58 application Python checks, 39 material Python checks, nine import checks,
numerical verification and all 140 exact original hashes pass. No test is skipped.
The unchanged main/WAL payload assertions above cover the previously failing
boundary; they do not claim unchanged SHM bytes or native Windows certification.
Independent review of this corrected identity and portable extraction remain
separate acceptance steps.
