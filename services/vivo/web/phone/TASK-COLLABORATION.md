# Shared missions: journal-scoped collaboration

This change extends the existing task journal, not a new mission database. Earlier v1 entries remain valid. The host can explicitly create a dependent task with `taskAccess.delegate(session, title, [taskId, ...])`, with one to four distinct earlier tasks in the same world/branch. The existing owner-facing task controls support selecting one prerequisite. Task creation grants no underlying world or neural permissions. Sessions are never automatically restored.

## Completion and handoff

A predecessor releases a dependent journaled edit only when the predecessor has been owner-closed, has at least one matching confirmed native receipt, has no pending or conflicting receipts, and all of its own prerequisites satisfy the same conditions. Known non-dispatches are retained as non-dispatches. This is receipt-backed closure, not proof that an arbitrary natural-language goal was accomplished. Read-only task.progress exposes only the attached task and direct owner-selected predecessor IDs, states, counts and confirmed receipt metadata. It does not share unrelated task titles, notes, memory, credentials or raw edit payloads. No agent can delegate or elevate permissions through task.progress.

Dependency IDs are immutable at creation and may reference earlier tasks only, which makes cycles invalid. The existing 16-task and 64-step-per-task limits remain.

## Object coordination

Atomic journal transactions reserve a (space, entity) pair while an attached task has a pending or conflicting native receipt. Older rows without a space ID conservatively reserve the entity ID across spaces. Independent objects can progress concurrently. Missing and conflicting receipts do not unlock the reservation. Closed tasks with unresolved evidence remain blocked until reconciliation where possible. This coordination only governs attached, journaled local edits; it is not a global world lock or an authorization boundary, and does not cover unattached edits, phone actions, paid providers, cross-origin/cross-device collaboration or already-dispatched operations.

## Evidence

Node 22.16.0: 29/29 targeted tests passed (14 new collaboration cases plus 15 unchanged task continuity cases). The three tested Git blob hashes were verified against the staged tree. Tests used transaction and native registry/receipt fixtures. The existing browser panel and shell version v28 are wired in source, but the mounted UI, real IndexedDB, live agents and offline upgrade remain unverified. No provider calls, merges, or deployments.

Run: node --test services/vivo/web/phone/tests/task-continuity.test.mjs services/vivo/web/phone/tests/task-collaboration.test.mjs
