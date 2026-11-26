# Prospective mission experiment journal

The experimental layer preregisters two to four distinct exact next-object
hypotheses in an existing attached task before its first journaled operation
(including not-dispatched or uncertain steps). First hypothesis is primary.
One immutable registration per task through the trusted journal API, with
registration source and attachment epoch. No new database, authority,
external timestamp, signature, or training. A new experiment needs a new task.

An explicitly opted-in capture can record the current historical forecast
computed from the task attachment's current owner-granted completed source
tasks. The journal retains only suggestion, abstention reason, matching
task count and supporting task count, not grant or private task IDs, receipt
witnesses or session identities. The owner explicitly consents to the
summary being visible to future task attachments. No new permission is
created; the grant must still be current at the transaction's capture.
Registrations survive handoff/reload; recall grants never resume automatically.

Upon explicit completion, the same observation rule as mission forecasting
checks all confirmed exact cue occurrences and their immediately following
journal entries. Consistent known next object supports matching hypotheses
and contradicts the others. A terminal cue contradicts object predictions.
Absent cue, inconsistent transitions, unknown space or non-dispatched next
entry remain inconclusive; do not bridge gaps. Pending or archived incomplete
tasks are not scored. Original confirmed receipt IDs, revisions, digests
and sources are retained. Derived summaries count one task, not each edit;
primary correctness, captured forecast correctness, abstention and
inconclusive outcomes are separate. No automated execution, hypothesis
revision, causal intervention, statistical independence or probability
calibration is claimed. Local journal order is not causal order; a
participant can know the hypothesis, choose the next operation or omit
work. This is an observable prospective comparison under a local trust
model, not a blinded controlled trial or tamper-proof preregistration.

Owner view and task.progress expose only the appropriate journal scope.
Existing dependency, identity, CAS and evidence gates remain unchanged.
Twelve executable checks ran against the actual forecast implementation
with the shared observation rule. Committed Node cases and five journal
integration tests plus extended desktop/mobile browser checks await fresh
hosted CI. The browser fixture registers a forecast, reloads, records a
different confirmed next object, checks the incorrect forecast is preserved,
and reloads the completed result. It is synthetic, not an accuracy benchmark.
Cache v41. No paid provider calls, merge or deployment.
