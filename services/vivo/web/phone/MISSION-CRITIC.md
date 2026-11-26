# Mission strategy critic

Verified #179 baseline: 427/427 hosted core tests; source/static desktop and
mobile strategy and repaired forecast fixture assertions passed. A later
static material-contact test timed out and was requested for rerun.

The new owner-only reviewer recomputes rankings and strategy from the same
validated journal transaction, retaining actual permissions, workload,
attachments, unresolved receipts, and history. It independently audits each
wave: no repeated task/source, no same-wave prerequisite, no ineligible
source, no missing task partition, incorrect count or premature stopping.
Actual task state never changes. The reviewer uses hypothetical readiness
only within this read-only scheduling analysis, not for agent actions.

For fully schedulable selections, a lower bound combines unfinished
dependency depth, total task count / distinct eligible sources (rounded
up), and the largest sole-source mandatory load. If the heuristic meets
that bound, the minimum is proved *conditional on this abstract model*.
Otherwise, for up to ten unfinished tasks, exact breadth-first search over
completed-task masks enumerates matchable ready subsets using the existing
scenario matcher and returns a minimum-round schedule. Larger missions
retain the heuristic and explicitly report unproved optimality. A five-task
fixture shows the earlier greedy schedule's four rounds improve to three.
The reviewer also reports assignments with no related completed-task
evidence and tests up to 16 single-source outages. Stress-case round
differences use the prior heuristic, not a separate exact optimization.

This is scheduling metacognition, not proof of intelligence or real-world
completion. Assumes fixed eligibility, equal abstract rounds, successful
completion, reusable source slots. No time, probability, cost, object
conflict, or execution safety simulation. Related receipts are descriptive,
not quality guarantees. No mutation, model tool, new grants, or new store.
Reports remain scoped to the owner and rechecked against world/branch epoch.

Ten direct fixture checks executed using the actual pinned strategy
3823ea683f847d5fd9c463edcec775509f12c41b and scenario
9d102562564a83225c6e740f607c753e8306aed7 modules. An independent recursive
oracle agreed on 64 baseline/outage cases across 32 small DAGs: 39
schedulable and 25 blocked; the 16-of-20-source stress limit was also tested.
Twelve committed Node cases, three journal integration tests and extended
desktop/mobile browser assertions (including 4-to-3 exact improvement)
await fresh hosted CI. Cache v40. No paid provider calls, merge or deploy.
