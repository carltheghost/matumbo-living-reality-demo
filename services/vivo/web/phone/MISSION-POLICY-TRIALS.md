# Adaptive forecast policy review

The experiment journal can now optionally preregister a paired shadow-policy
trial at the same time as the original experiment. Explicit owner consent
and the attachment's current completed-task evidence grant are required.
The same historical forecast generates all three versioned policies:
baseline/1 (3 supporting tasks and strict majority), exploratory/1 (2 and
strict majority), selective/1 (4 and at least two thirds). They differ in
abstention thresholds, not the top object; no causal or skill claim.
The original baseline prediction is checked against the captured forecast.

Persist a bounded top-candidate aggregate and frozen decisions, not source
task IDs, receipt witnesses or session identities. The owner opts in to
sharing that aggregate with future attached agents. History remains in the
existing validated journal. Registration is atomic with the experiment,
before any journaled operation, and cannot be retroactively added.
The policy-set version, decisions and baseline match are validated on reads.
An unknown policy set fails closed; future policy versions must preserve
old evaluation semantics. No database, permission, or execution path changes.

All versions are evaluated on the same completed task using the existing
experiment observation rule. Pending, archived incomplete and inconclusive
trials are excluded from evaluated denominators and reported separately.
Report correct, incorrect, abstained, coverage, conditional accuracy,
and paired extra correct, extra incorrect, avoided incorrect and lost correct.
Utility is a declared design choice: correct +1, incorrect -2, abstain 0.
To identify a candidate for owner review, require at least 8 evaluated
trials, 4 predictions, no more incorrect suggestions than baseline,
and utility improvement of at least 2. Ties do not select a candidate.
This is a conservative descriptive decision gate, not a significance test
or validation on independent data. Baseline remains active; no automatic
promotion, rule mutation, provider call or model training. A later
owner-reviewed change must be separately tested on new observations.

Twelve executed fixture checks used the exact existing forecast and
experiment source modules. Synthetic selective and exploratory cases test
the review mechanism, not actual performance improvement. Three journal
integration tests and extended source/static desktop/mobile persistence
checks await hosted CI. Cache v42. No merge or production deployment.
