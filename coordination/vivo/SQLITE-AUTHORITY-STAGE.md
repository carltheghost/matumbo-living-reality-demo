# Explicit SQLite authority backend (local candidate)

## Identity and scope

Additive store candidate based on mounted application
`be0f1cffb9a9bdee1ef225a9fbdb6e53f13364f0`.
Only new SQLite store, path checks, tests, native probe and this document are
owned by this stage. Existing FileAuthorityStore, canonical authority, application
selection, source imports, input-owned files and root/static deployment are
unchanged. No upload, PR, merge, deploy, software installation or ACL mutation.

## Integration contract

Use Node 24.19 or later within the Node 24 line, with the built-in `node:sqlite`.
The SQLite library must be at least 3.51.3; its version/source identity is recorded.
The tested Linux build is Node 24.19.0 / SQLite 3.53.3. This is an explicit backend,
never a fallback from JSON persistence and never a migrator or recovery reseed.

Import `SQLiteAuthorityStore` from `server/authority/sqlite-store.mjs` and call:

    const store = await SQLiteAuthorityStore.open({path, maxBytes: 64 * 1024 * 1024});
    try {
      const world = await LocalLeaseWorld.create({snapshot, store});
      // Keep store alive for the full runtime, then close in orderly shutdown.
    } finally {
      await store.close();
    }

`open` must complete before loading a world or releasing old leases. It acquires
and retains exclusive ownership even while idle between transactions. A second
process fails with STORE_BUSY. Each load is detached. `compareAndSwap(expected,
record)` stores the complete `vivo.lease-checkpoint/1` as a UTF-8 JSON-plus-newline
BLOB, including all Eyes, history, receipts, epochs and leases. The logical byte
limit includes that newline. Canonical hash and world validation remain the
canonical authority's responsibility; the store validates its own envelope,
codec, row/digest pairing, exact table schema and bounds. Array subclasses and
custom array prototypes are rejected before serialization, so inherited `toJSON`
cannot replace caller values.

`supportsCommitGuard === true`. Optional `compareAndSwap(expected, record,
{beforeCommit})` invokes a synchronous guard after DML, immediately before COMMIT,
with no asynchronous gap. A thrown guard is returned unchanged after confirmed
rollback; Promise/thenable results are rejected. Rollback failure is fatal.
Guard code must only validate and throw, never call back into this store.

The authority and any metering wrapper must publish memory, receipts or events
only after this method resolves. A thrown COMMIT can mean that data committed;
it never authorizes replay. A storage fault is latched permanently on that
instance (`fault`, `STORE_FAILED_CLOSED`). CAS conflict also latches because a
lifetime owner's expected record has diverged. Caller-data validation and a
confirmed guard rollback remain retryable. Runtime sweeps must not clear a store
fault. Close on failed world startup and shutdown; if close itself cannot finish,
terminate the owning process before permitting another runtime.

## Storage and ownership

The schema is one exact STRICT singleton table, with id=1, digest and full BLOB.
Application id and user version are validated. No unknown table, trigger, schema,
empty existing database, invalid codec, corruption or oversized record is
silently accepted. A newly initialized database whose first checkpoint was never
written is rejected on the next open. Recovery/discard of such an abandoned
synthetic or real file is an explicit operator decision.

A fresh database sets `locking_mode=EXCLUSIVE` before its first database/WAL
access. Existing files are first identified in a read-only transaction, including
the committed WAL view, exact schema and complete encoded record. That reader
stays open while a second connection acquires `BEGIN IMMEDIATE` and independently
revalidates identity and record. Only then is the reader closed and the writer
changed to `locking_mode=EXCLUSIVE`. Its exclusive transaction/idle ownership is
acquired before world load, restart release or readiness. A second SQL writer
cannot alter identity after the writer lock; a change during preflight is rejected
under that lock. WAL, FULL synchronous, trusted_schema=OFF, page size and length
limit are verified. Extension loading and double-quoted string literals are
disabled; defensive mode is enabled. Statements and SQL are fixed and values
are parameterized.

This corrects a reproduced refusal bug in the earlier candidate: merely opening
an unrelated crash-left WAL database read-write and then closing after STORE_SCHEMA
could checkpoint its main file and delete its WAL. The read-only guard now remains
alive while a rejected writer is rolled back and closed, preventing that final
checkpoint. Unknown/invalid stores preserve main, WAL and rollback-journal payload
bytes; no replacement, migration or reseeding occurs. SQLite may create or change
transient SHM lock/index metadata during a read-only WAL inspection. SHM byte
identity is therefore explicitly not promised. Do not mistake this transient
metadata exception for permission to rewrite database/WAL contents. A legitimate
early-crash authority whose identity exists only in WAL still recovers.

The handoff relies on SQLite's documented [WAL read-only behavior](https://www.sqlite.org/wal.html#read_only_databases)
and [normal-to-exclusive locking transition](https://www.sqlite.org/pragma.html#pragma_locking_mode),
with separate-process regressions for actual lock retention and rejection. It is
not protection against a same-user process bypassing SQLite locks by replacing
files or tampering with the private directory.

Opening an existing identified store writes the identical format-version marker
inside a transaction to allocate its WAL before readiness. This permits checking
the actual created sidecar's privacy before any application state is admitted.
It never modifies the canonical record. There is no fallible maintenance, stat
or cleanup step after a successful CAS COMMIT before the caller sees success.

Physical WAL maintenance is separate from accepted event retention. Automatic
checkpointing and a journal-size retention target are configured, but the 64 MiB
logical checkpoint limit is not a 64 MiB disk-space guarantee. DB allocation has
a separate safety bound; DB + WAL, temporary work and free-space headroom must
be measured on the intended drive. No manual sidecar removal is performed.

A separate Linux maximum-size experiment committed two exact 67,108,864-byte
records and reopened the final digest successfully. Measured DB size was
67,182,592 bytes and WAL high water 67,588,632 bytes. CAS took 433 ms for the
first maximum-size record and 850 ms to replace it. These are one local synthetic
measurement, not native disk or interactive-latency guarantees; near-capacity
full-checkpoint latency is a material integration/performance limit.

## Path/privacy requirements

Supply a pre-existing private directory outside the entire checkout tree, which
may be served by a root static server. No parent directory is created by the
store. Keep comparison.sqlite and legacy JSON separate; runtime integration must
explicitly refuse an accidental fresh backend beside a legacy world.

Native Windows requires an absolute conventional drive-letter path, fixed local
NTFS volume, and a real hard-disk-volume device mapping. UNC, network, device,
SUBST, alternate-stream syntax, ambiguous/reserved names, traversal, reparse
points/junction ancestors, hardlinks and unsafe main/WAL/SHM/journal targets are
rejected. The full parent chain is checked; existing files must be single-link
regular files. Paths longer than the conservative 240-character limit are
unsupported in this version.

The read-only PowerShell probe obtains the current user's SID, raw owner/DACL
and inheritance evidence. The private directory and files may allow only that
user, SYSTEM and Administrators, and must provide the user full effective access.
The parent must carry full file-and-directory inheritance for the user; broad
inherit-only grants are rejected too. Ancestors may have broad read/traverse
access, but may not permit untrusted deletion/ownership/ACL replacement.
TrustedInstaller is accepted only on ancestors. Null/unsupported DACL evidence,
unsupported ACE types, any private-object deny ACE, reparse points and unknown
volume evidence fail closed. This conservative policy does not attempt to infer
group membership to reconcile allow/deny combinations.
Actual DB and sidecar privacy is checked at startup inside the transaction.

There is no chmod, icacls, Set-Acl, execution-policy override or automatic security
repair. If PowerShell policy prevents the read-only inspection, startup fails;
do not bypass that policy. User/admin processes are trusted. Path prechecks do
not claim to defend against a malicious same-user/admin path-replacement race.
No backup/encryption/privacy guarantee beyond these access checks is implied.

Non-Windows execution is available for explicit synthetic/backend tests with an
existing UID-owned 0700-style parent and private regular files. It does not
change the default POSIX FileAuthorityStore.

## Verification and remaining gates

Run focused checks:

    node --test services/vivo/tests/authority/sqlite-store.test.mjs

168 tests pass on Linux across existing authority/POSIX durability/application
runtime and the new backend. The input dependency was staged only for testing
from exact PR75 `9bfe8946151d4be3f302b99de205d80201fde0e3`, with matching blob
identity, and is not part of this change. The 22 new SQLite tests cover: exact checkpoint roundtrip; WAL/FULL/lifetime ownership;
distinct-process read/write/start denial while idle; explicit close/reopen; stale
CAS fatal latch; strict schema, codec, malformed/corrupt/oversize refusal; exact
byte boundary; Windows lexical/SID/DACL fixtures; symlink/junction/hardlink/path
refusal; independent Eyes/history and restart-release; synchronous guard ordering
and rollback; simulated disk-full/COMMIT-before/COMMIT-after/rollback failures;
forced termination before COMMIT, after COMMIT before receipt, after ACK and
during three large-BLOB writes. Crash recovery validates complete old/new records.

Run the portable gate only in the authorized native environment:

    node services/vivo/tests/authority/sqlite-native-probe.mjs --native --directory ABSOLUTE_AUTHORIZED_PRIVATE_DIRECTORY

The directory is inspected before creating synthetic children. The probe returns
metadata only: OS/architecture/Node, SQLite identity/compile options, verified
settings, exact reopen, integrity and test counts. It never accesses real world
data. It cleans only its newly created synthetic directory after success, retains
failed synthetic evidence, and refuses unsafe privacy without repairing it.
`--synthetic` labels non-Windows runs honestly. An insecure `/tmp` parent was
verified to be refused; a private Linux test parent passed all checks.

Native Windows execution has **not yet been performed by this stage**. A separate
read-only desktop inspection found extra Modify SIDs and sandbox-group read
access on the authorized validation directory; it fails the private-state gate.
Do not weaken the gate or treat public synthetic SQLite compatibility tests as
private-adapter acceptance. A suitable private directory or separately approved
security setup remains required. Before
calling the Windows application usable, require independent review, actual
Windows native probe success, final selector integration tests, real Python to
Node application entrypoint, HTTP/static-file privacy checks, startup/shutdown
and lease/history/Eye/backpressure tests in the combined candidate. Native
high-water disk-space and large-record latency remain separate gates. Process
kill tests are not power-loss or physical-disk-fault certification.

## Primary references

- https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html
- https://www.sqlite.org/wal.html#use_of_wal_without_shared_memory
- https://www.sqlite.org/wal.html#the_wal_reset_bug
- https://www.sqlite.org/pragma.html#pragma_synchronous
- https://www.sqlite.org/howtocorrupt.html
- https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points
- https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.filesystemaccessrule
- https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.filesystemrights
