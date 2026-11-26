# Mission forecast: task-balanced historical next-object evidence

Baseline #172: 390/390 core tests and actual source/static desktop/mobile
association tests passed. The separate mounted application workflow had
two failures: FINAL_TARGET_STALE in the Node 22 HTTP input controller
test and a Microsoft package repository signature error during Chromium
installation. A targeted rerun was requested; no security check or
input-controller timing contract is weakened here.

The new neural.missionForecast read tool uses only completed tasks within
the existing explicitly granted attachment-bound recall set. The current
known space/entity pair is a cue. For every confirmed cue entry, inspect
the immediately following journal entry in that task. An absent following
entry is terminal (end of the recorded task), and an unknown space or
non-dispatched entry is unknown. Do not bridge gaps or join different
tasks. Journal order is recorded operation order, not causal proof.
Multiple inconsistent outcomes within one task are ambiguous. Each
distinct task contributes at most one vote, not one per repeated edit.

The candidate report includes task counts, original receipt pairs, and
the observed share of all matching tasks. The loose lower/upper share
bounds assume none/all of the ambiguous and unknown tasks might support
the candidate; they are not a confidence interval. Terminal tasks
remain separate. Suggest an object to inspect only when at least three
distinct tasks support it and support is a strict majority of all
matching tasks, including terminal/ambiguous/unknown outcomes.
This fixed policy is deliberately conservative, not statistically
calibrated. A suggestion is not a command or guarantee of success.

Retrospective leave-one-task-out removes an entire task, predicts from
the remaining matching tasks, and reports eligible, evaluated, correct,
and abstained cases. Only consistent next-object and terminal outcomes
are eligible for retrospective comparison; an object suggestion on a
terminal case is wrong. No independent or time-ordered prospective
validation, population inference, causal claim or prediction probability.
Completed-task selection bias and correlated task histories remain.
No neural weight training or new authority. No unshared evidence or
automatic action dispatch. The existing scope/epoch/grant fences and
owner task/agent selection apply.

Local Node 22.16.0: 10/10 pure forecast tests passed. Exact helper/test
hashes bda7cd1d6c880410568e61cbb5abb22b49d7b347 and
9fc5920419e408233953f8cd040e32c122105ce7. Capacity fixture covers 15 tasks
and 960 entries; synthetic holdout examples test correctness and
abstention mechanics, not real-world predictive accuracy. Four further
journal regressions and expanded desktop/mobile source/static browser
tests await fresh hosted CI. Cache v37. No merge, deployment or paid calls.
