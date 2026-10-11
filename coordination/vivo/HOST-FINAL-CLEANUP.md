# Main-owned final-frame cleanup

Parent: `7610dcfe18c38860e93dbb7d1e0efa0ffaf8a259`.
The exact disposable input dependency remains PR 75 commit
`9bfe8946151d4be3f302b99de205d80201fde0e3` with all 102 input tests.
No Chat 3, shared-contract, source-import, renderer or camera edits.

GripHost.end now stops renewal and capture before inspecting its final sample.
An invalid frame, failed frame validation, rejected original timestamp or throwing
frame/timestamp getter takes the source-specific cancellation/reconciliation path.
It reports FINAL_SAMPLE_REJECTED after confirmed cleanup; if cleanup itself cannot
be confirmed it reports FINAL_SAMPLE_CLEANUP_UNCONFIRMED and leaves the stream
blocked. A stale observation is not re-stamped and the final target is not claimed
to have been accepted. Other source grips are not cancelled. Valid final targets
still precede grab.end, with their original observedAt preserved.

Sixteen new tests use the real LocalLeaseWorld and the exact pinned controller.
With corrected host-task timing in the test fixture, the unchanged host failed
12 cases and passed four controls. The fix passes all 16. Fresh composed local
results: 213 Node, four loopback HTTP, nine evidence-verifier tests, no failures
or skips. The 102 input tests are already INCLUDED in the 213. CI results must
be verified independently. Raw initial fixture logs and the corrected baseline
run are retained in the conversation evidence, not relabelled as product failures.

This closes the thrown-final-frame cleanup gap in the host module, not physical
camera validation or mounted pointerup wiring. No full original import, remote
authentication, material stepping/learning, merged integration, deployment or
end-to-end device acceptance is claimed. The next source stage still must import
the original remaining runtime/research bytes and prove complete-package readiness.
