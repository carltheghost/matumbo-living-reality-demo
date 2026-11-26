# Shared mission planner

The verified #160 baseline passed all six hosted workflows (306 tests, no
failures/skips), including desktop/mobile dependency and advisory assignment
on both mounted source and static routes.

The new owner-facing plan compiler accepts an objective and explicitly supplied
subtasks with stable aliases, registered initial source IDs and prerequisite
aliases. The existing face also offers a deterministic native-edit example.
It is not a general natural-language decomposition model. Topological layers
indicate dependency parallelism, not a guarantee of simultaneous agent
capacity or completion time. Unknown sources, cycles, dangling dependencies,
capacity overflow and malformed plans reject before task creation.

Preview is detached and host-held. Save checks the reviewed world/branch,
scope epoch, exact session generations and capacity in the existing IndexedDB
journal transaction. The entire batch is inserted as ordinary detached tasks
with canonical prerequisite IDs and bounded group metadata. Preview tokens
are transient and single-use; a lost commit response is inspected via the
saved journal, not automatically retried. Plan metadata is advisory grouping
on the existing v2 journal; there is no new database or action authority.
The current 16-task scope limit still applies. Group size, IDs and membership
are validated. A summary distinguishes ready, blocked, completed, closed
incomplete and unresolved tasks. Initial owner preferences never grant native
permissions. Existing recommendation, assignment, handoff, receipt and
completion rules control execution. External agents, model-driven replanning
and cross-device synchronization are not implemented.

Local Node v22.16.0: 12/12 planner helper tests passed; exact Git blob hashes
589dcb9580f2b65c4982829b57ab04c454190068 and
e2cfef976c639064f0ce545c2f9adc886f2e2638. Eight new journal integration tests
and desktop/mobile mounted browser regressions are included for fresh CI.
Cache v32 includes the planner. No provider calls, merge or deployment.
