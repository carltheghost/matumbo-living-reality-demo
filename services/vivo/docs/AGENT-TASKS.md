# Vivo bounded agent tasks

The canonical remote Vivo process exposes a small, durable task path at
`/api/agent/*`. It is deliberately separate from the optional conversation
provider and from the simulation-only council code.

After the existing owner or invitation bearer is admitted over the remote
WebSocket, the State sheet can submit one bounded task:

```text
goal: operator note, capped at 280 characters
permissions: [sample.read]
toolCall: {name: "vivo.sample.inspect", arguments: {sampleId: "field-baseline"}}
```

The server validates the typed call and exact permission set before execution.
The only real tool reads the bundled, trusted server-owned fixture at
`services/vivo/tasks/fixtures/field-sample.json`; this local POSIX fixture is
treated as immutable task input for the single process that owns the private
runtime lock. It does not run a shell, fetch a URL, call a model, mutate a
world, or interpret fixture text as instructions. The tool records a content
digest and artifact, then an independent file-read verifier recomputes both
before the task can succeed. The fixture is a deterministic test/sample input,
not live intelligence.

Tasks, ordered events, and effect records are stored in a private SQLite
database in the configured remote `--data-dir` using WAL and FULL synchronous
durability. Startup recovery re-queues interrupted plan/tool/result work;
effect keys make reconciliation idempotent, so a restart at a boundary does
not duplicate the tool or verifier effect. A task may end as `succeeded`,
`cancelled`, `blocked`, `unavailable`, or `failed`; a cancellation request is
honored at the next safe boundary. The runtime holds an exclusive private lock
sidecar before recovery; a second process fails closed. Database, WAL/SHM/journal,
and lock paths must be regular, owner-private, non-symlink files in an
owner-private directory. Existing incomplete success records are re-queued
instead of being reported as successful without evidence.

The UI displays the task state, typed tool, artifact/evidence, verification
status, and event journal. It also displays the independent conversation
provider status. This branch does not configure credentials or make a live
provider request. A Pages/static build cannot run these routes and remains an
honest unavailable surface.

The task routes are bearer-authenticated HTTP routes after the existing
WebSocket admission; they are not a server-verified active WebSocket admission
channel. The fixed sample task accepts only `sample.read`, and fixture text is
never a capability source. Verification means an independent reread and digest
recomputation, not an independent semantic model. If cancellation is durably
requested before a terminal error transition, cancellation wins at that safe
boundary; once a terminal transition commits, a later cancel is recorded as
ignored.

## Routes

All routes require the already-admitted bearer and exact same-origin proof:

* `GET /api/agent/status`
* `GET /api/agent/tasks`
* `POST /api/agent/tasks`
* `GET /api/agent/tasks/{taskId}`
* `POST /api/agent/tasks/{taskId}/cancel`

Admission is bounded to 2 concurrent workers, 16 queued tasks, 32 tasks per
actor, 256 durable tasks total, 64 events per task, and an 8 MiB task-store
admission threshold. The byte threshold is checked before admitting a new
task; it is not a hard total-byte ceiling for already committed SQLite/WAL
state. Overload and quota return explicit errors. There is no automatic
retention or deletion: an operator must export/archive data and remove it
through a separately reviewed maintenance procedure.

The next integration step is an authorized HTTPS host with a persistent
private volume, followed by a non-production live provider/device check. No
host, credential, billing change, deployment, or merge is part of this
change.
