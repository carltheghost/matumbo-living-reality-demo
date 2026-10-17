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
The only real tool reads the bundled
`services/vivo/tasks/fixtures/field-sample.json`; it does not run a shell,
fetch a URL, call a model, mutate a world, or interpret fixture text as
instructions. The tool records a content digest and artifact, then an
independent file-read verifier recomputes both before the task can succeed.
The fixture is a deterministic test/sample input, not live intelligence.

Tasks, ordered events, and effect records are stored in a private SQLite
database in the configured remote `--data-dir` using WAL and FULL synchronous
durability. Startup recovery re-queues interrupted plan/tool/result work;
effect keys make reconciliation idempotent, so a restart at a boundary does
not duplicate the tool or verifier effect. A task may end as `succeeded`,
`cancelled`, `blocked`, `unavailable`, or `failed`; a cancellation request is
honored at the next safe boundary.

The UI displays the task state, typed tool, artifact/evidence, verification
status, and event journal. It also displays the independent conversation
provider status. This branch does not configure credentials or make a live
provider request. A Pages/static build cannot run these routes and remains an
honest unavailable surface.

## Routes

All routes require the already-admitted bearer and exact same-origin proof:

* `GET /api/agent/status`
* `GET /api/agent/tasks`
* `POST /api/agent/tasks`
* `GET /api/agent/tasks/{taskId}`
* `POST /api/agent/tasks/{taskId}/cancel`

The next integration step is an authorized HTTPS host with a persistent
private volume, followed by a non-production live provider/device check. No
host, credential, billing change, deployment, or merge is part of this
change.
