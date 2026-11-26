# Mission scenario comparison

The owner can compare the current assignment capacity of a saved mission
or standalone task against a hypothetical set of unavailable agent
sources. The existing native recommendation logic supplies eligible
candidate edges, including continuity and related completed task evidence.
No existing readiness, unresolved-receipt, current workload, attachment,
handoff capacity, or native tool permission gate is relaxed.

A deterministic augmenting-path matching algorithm maximizes the number
of distinct selected tasks that can receive distinct eligible sources
in this snapshot. At most one assignment per source is proposed, even if
multiple sessions are present. Candidate order follows the existing
recommendation order; matching maximizes count, not total preference or
evidence score. The alternative removes edges only. The report includes
baseline/alternative counts, suggested task/source pairs, existing blockers,
capacity contention, and lost capacity. It does not predict future
availability or completion, schedule subsequent stages, compare costs,
reserve work, change permissions, or execute anything. Hypothetical
exclusion does not stop agents, clear attachments or release outstanding
object reservations. Actual assignments still require the existing fresh
owner review and individual approval; this report is not an approval token.

Owner-only API reads the existing validated journal transaction and checks
world/branch and scope epoch before and after. No new model-facing tool,
database, provider call or persistent scenario state. The UI remains on
the existing task face; a selected planned task compares its saved group.
Native recommendation evidence is historical and may be sparse. Snapshot
results can become stale; recompute before acting.

Eight executable fixture checks ran in the JavaScript tool runtime
before creating the helper source from those exact functions, covering
maximum cardinality, source deduplication, outage, blocked tasks, invalid
input, immutability, and the 16-task limit. The Node test file includes
eight regression cases, plus three journal integration tests and extended
desktop/mobile mounted browser assertions, pending hosted execution.
Offline cache v38. No merge, production deployment or paid provider calls.
