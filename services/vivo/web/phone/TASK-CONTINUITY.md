# Native agent task continuity

Owner-created, world/branch-local task journals record a SHA-256 fingerprint and operation ID before an attached native world edit. Only matching native operation receipts confirm steps. Missing receipts remain pending; mismatched fingerprints become conflicts. A task's next journaled edit is blocked while unresolved evidence remains. Receipt eviction is not evidence of failure.

The existing native session registry still controls permissions and executes edits. The journal does not issue grants, replace the engine's idempotency checks, restore session attachments, or execute stored work. The read-only task.progress tool is available only to an explicitly attached active session. A restored task must be attached again to the same source identity and current session generation. IndexedDB is same-origin browser storage, not a secure cross-user or cross-device account store. Closing the journal preserves all evidence, including unresolved steps. Detaching the journal does not stop an agent or revoke its underlying world-edit grant.

Limits: 16 task records and 64 steps per task per world/branch. No automatic deletion or archiving. Native receipts remain bounded by the engine's existing receipt retention. A prior journal claim is fenced by the attachment epoch, but a native operation already dispatched cannot be undone by detachment or cross-tab reattachment. Unattached edits and other native tool types continue through their existing paths; this is not global action deduplication.

Validation: 15 Node tests passed with a transactional in-memory store and synthetic native registry/receipt fixtures. Production IndexedDB reload, mounted browser UI, full native engine integration, and service-worker migration remain unverified. The local browser navigation was blocked by the environment's administrator policy. No live model or provider invocation was performed.

Run: node --test services/vivo/web/phone/tests/task-continuity.test.mjs
