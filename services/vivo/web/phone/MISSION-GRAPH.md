# Shared mission dependencies (journal v2)

Extends the existing native task journal with owner-selected prerequisite IDs
and explicit receipt-backed completion. A new task can depend on up to 15
existing tasks in its current world/branch. The existing 16-task, 64-step and
16-handoff bounds remain. Dependencies are immutable after creation; missing
references, cycles and invalid completion records fail closed. Migration keeps
all v1 tasks, handoffs and receipt metadata, and never assumes that archived
work was completed. A v1 client cannot open the v2 journal. No new storage
database, model, provider or action authority.

An attached dependent's journaled native edit is blocked until every direct
prerequisite is explicitly completed by the owner with at least one confirmed
native receipt and no pending/conflicting receipt. Completion seals that
journal; ordinary close/archival is distinct and does not unblock successors.
The existing task.progress tool exposes only explicitly linked direct
prerequisite status and completed receipt metadata. Historical fingerprints
are local evidence, not external authentication or permission. There is no
automatic scheduling, provider activation, task delegation or action replay.
Native unjournaled edits remain independently governed by existing grants.
This release does not infer success from a model response or certify task
objective semantics.

Prior baseline PR #157: all six hosted workflows passed, 274 Node tests with
zero failures/skips; actual desktop/mobile handoff persistence passed on both
source and static routes. Local Node tests for the new pure dependency module:
10/10 passed. Eight additional journal integration regressions and mounted
desktop/mobile dependency, completion and reload checks are included in CI;
fresh full hosted results required. No paid provider calls, deployment or merge.
