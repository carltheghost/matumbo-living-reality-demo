# Mission orchestrator — advisory assignment

The same native task journal and owner controls now offer recommendations for detached,
ready tasks. Candidates must have an active local registered session with both actual
world-read and world-edit tool grants, zero recorded active native operations/contacts,
and no current local task attachment or pending assignment. The deterministic order is
current owner continuity, relevant confirmed changed receipts in this world/branch,
then available explicitly shared numeric memory, then stable source/session identity.
Receipt counts are bounded historical observations, not measured intelligence or
a provider success rate. Unknown workloads are excluded. No provider calls or remote
agent identities are assumed. The system does not claim cross-device workload visibility.

Owner approval rechecks exact task epoch, session generation, world/branch and scope
epoch, readiness, local attachment and fresh candidate rank in the same existing journal
transaction. No new database, automatic native grants, external accounts, task execution
or replay. A different owner uses the existing verified handoff history; the original
source attribution remains intact. The original unjournaled native tools retain their
existing permission rules. A stored recommendation is not an action capability.

The previous #158 hosted unit suite passed 292/292; two mounted jobs failed in the new
browser test because it attempted to read task progress before attachment completed.
This revision uses explicit busy-state completion barriers and awaited progress reads
instead of asynchronous wait_for_function predicates. Browser checks retain all graph
assertions and additionally exercise recommendation review, stale candidate rejection,
approved transfer, receipt preservation and reload on source and static routes.

Local Node 22.16.0: 8/8 ranking tests passed against the exact helper/test blobs.
Six new journal integration tests and updated mounted browser tests require fresh CI.
Cache v31 includes the new helper. No deployment, merge or paid provider use.
