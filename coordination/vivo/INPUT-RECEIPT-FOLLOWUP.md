# PR 76 follow-up: exact latest PR 75 and release-receipt convention

The disposable test dependency is now commit
`1d8b25adbcef63559b85c069029b4caf02216b41`, not the original `8a10847`.
All four worker files (controller, README, original test suite, transport-rejection
suite) are Git-blob pinned. No worker path is committed by this stage. CI runs
input alone and checks 90 passes plus each of the 25 named falsy cases, then runs
the composed authority/input/contract/mailbox suites with pipefail enabled.
A green count from the old controller is not evidence for this pin.

Accepted `grab.end` receipts from LocalLeaseWorld include the retained entity's
non-null integer revision. Releasing a lease does not delete that entity or
increment its material revision; acceptedSequence advances. The controller accepts
this convention. New fixtures use a nonzero revision, no-motion and final-target
4D/11D releases, duplicate receipt replay, and a deliberately nulled receipt
negative control. The generic receipt schema still permits null for other
operations. No shared schema or Chat 3 controller edits are made.

Timestamp rules are unchanged: preserve observedAt from capture, never callback
restamping, and offer the pointerup final target before end. Real camera,
persistent remote authority, nested worlds and material stepping remain separate
unfinished integration stages. No merge or deployment.
