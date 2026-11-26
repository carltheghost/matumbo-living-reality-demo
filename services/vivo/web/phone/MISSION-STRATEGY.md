# Multi-stage mission strategy comparison

Builds on #177 (415/415 native/account tests, successful source desktop/mobile
scenario comparison). The inherited #175/#177 forecast browser regression
encountered AGENT_CAS_STALE after a nonzero recovery edit activated the root
spring solver. The actual controller correctly rejected the changed revision.
Move only the six no-op forecast receipt fixtures into a fresh stationary
world and verify their persisted journal and cleared grants after reload.
Keep the prior moving-world recovery, association and sparse forecast
assertions intact. No retries of uncertain operations, fabricated receipts,
or relaxation of CAS, permissions, or timeouts.

The new owner-only comparison selects saved mission tasks, using the existing
read-only current-vs-hypothetical unavailable-source selection. The structural
dependency depth and longest unfinished selected chain ignore already
completed prerequisites. Unfinished dependencies outside the selected set
remain hard blockers. Each simulated round proposes a maximum-cardinality
matching among currently dependency-ready tasks using the existing scenario
matcher. Hypothetical readiness is used only inside the strategy read API;
real recommendations and execution still use actual completed prerequisites.
The eligibility snapshot retains current native grants, workloads, attachments,
receipt conflicts and history. After each proposed round, assume successful
completion and release of only its simulated assignments for the next round.
No actual task, permission, receipt, reservation, or world is modified.
Do not fabricate future receipt evidence. Report unscheduled tasks and their
unmet/external dependencies, count of hypothetical rounds, and an outage
comparison. Rounds are unitless, not time estimates; this is a deterministic
feasibility heuristic, not an optimal schedule, cost estimate, calibrated
prediction, or authorization. Existing attached tasks are not assumed to end.
Per-task maximum-cardinality assignment can produce non-optimal global rounds.
All actions remain subject to fresh individual review.

Nine fixture checks executed the strategy helper in JavaScript with a
deterministic matching fixture, including a 16-task chain, dependency and
outage handling. Nine committed Node regression cases use the actual scenario
matcher, three further integration tests cover live scope/readiness gates,
and mounted desktop/mobile tests cover the owner controls and revised
forecast fixture. Hosted verification pending. Offline cache v39.
No deployment, merge or paid model/provider calls.
