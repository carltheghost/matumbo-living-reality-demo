# Adaptive mission recovery

Prior verified baseline #163 passed 326/326 hosted tests and all six workflows,
including source/static desktop/mobile plan creation, completion, and reload.

The existing journal now exposes owner-side blocker diagnosis. It traverses only
the selected prerequisite closure and deduplicates shared causes. A pending or
conflicting native receipt is not permission to retry. A closed-incomplete task
can be explicitly reopened only with no unresolved receipts and a valid review.
Reopening increments the task epoch, records the original source, reason and
historical receipt counts, and retains task identity, dependencies, plan group,
all receipt steps and handoffs. A completed task cannot reopen. There are at most
16 recovery records per task; the original journal limits are unchanged.

Diagnosis can suggest a candidate after reopening by using the existing
orchestrator's current local grants, workload, related changed receipts and
scoped numeric memory availability. This is an advisory alternative, not a
capability grant or an authenticated external agent identity. Review and
assignment are separate. No mission dependency is rewritten or bypassed;
successors still require explicit receipt-backed completion. No automatic
action replay, recovery, task completion, model call or conflict override.
The same journal and native agent face are reused, not a new store or engine.

The transient host-held recovery review is single-use and rechecks scope epoch
and exact task snapshot inside the existing journal transaction. Invalid or
stale review, failed storage, unresolved receipts and exhausted history fail
closed. Recovery history is validated against receipt prefixes and handoff
epochs. Optional metadata is compatible with the existing v2 journal; older
clients cannot initiate recovery but preserve the fields through ordinary
journal transactions. Local history is evidence, not remote authentication.

Local Node v22.16.0: 12/12 pure recovery tests passed; exact helper and test
Git blobs 3c17939213a88e77ab2117f00fc2a2d56deab16e and
f4da5a9e7bfacae9a498ea92b5faaf40505e5bc7. Six new journal integration tests
and source/static desktop/mobile mounted tests are included for fresh CI.
Offline shell v33. No provider calls, merge, production deployment or
cross-device synchronization. No semantic Neural Memory lookup is fabricated.
