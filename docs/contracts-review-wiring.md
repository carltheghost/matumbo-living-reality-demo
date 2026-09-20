# WIRING — Reality Lens Ω
Integrator merge order and riskiest seams.
All value remains SIMULATED TUMBO POINTS ONLY.

## Merge Order (first → last)
1. Lane 1 — Contract module hardening (outcome-contracts, contract-atelier, frozen-relics, contracts-markets)
   Lands the shared type surface and status vocabulary every other lane imports.
2. Lane 2 — Automatic contract creation from ESPN free feed
   Produces draft entries that conform to the draft shape. Depends on Lane 1 types only.
3. Lane 3 — Kalshi + Polymarket public read-only odds → simulated quotes
   Attaches QuoteIn arrays to drafts. Depends on draft ids from Lane 2 and freshness rule from the contract surface.
4. Lane 5 — Review-queue UI
   Consumes drafts + quotes and emits ReviewQueueEntry. Depends on Lanes 2 and 3 for data; Lane 1 for status constants.
5. Lane 4 — Contract tracking ledger (lifecycle, audit view, eternal-escrow grading)
   Accepts approved contracts, records outcomes, grades, and marks claimable. Depends on the full upstream graph and the claimable-forever law.
6. Lane 6 — This cross-review + connection map (docs/contract-integration-check.md, tests/contract-conformance.test.mjs, docs/contracts-review-wiring.md)
   Does not ship feature code; verifies the graph after the above land.

## Riskiest Integration Seams (verify with tests)
1. Draft shape ↔ Review queue entry shape
   Status rewrite (`draft` → `pending_review`) and identity preservation (`id`, `gameId`) must be exact.
   Test: contract-conformance "draft entry shape" + "review queue entry shape".
2. Quote freshness vs attachment time
   Quotes older than 15 minutes must be rejected before they reach the queue or the approved snapshot.
   Test: contract-conformance "quote shape and freshness rule".
3. Graded → Claimable transition
   `claim.expiresAt` must remain `null` forever; no accidental expiry or real-money settlement fields may appear.
   Test: contract-conformance "claimable-forever" + "simulated-points-only law".

## Integrator Checklist
- Run `node --test tests/contract-conformance.test.mjs` after each lane merge.
- Confirm no forbidden keys (`wallet`, `orderId`, `mainnet`, etc.) exist in any exported fixture or type.
- Confirm auto-create remains idempotent on `gameId` after Lane 2 and Lane 5 land.
- Confirm claimable contracts never set a non-null `expiresAt`.

## Known vocabulary gap (for the integrator)

This lane's canonical shape uses `startsAt` (ISO-8601 UTC) and a closed status
vocabulary `"draft" | "pending_review" | "active" | "graded" | "claimable" | "cancelled"`.
The real `src/domains/outcome-contracts.js` uses `draft → open → locked → graded → settled → claimed → voided`,
and the delivered auto-contracts lane emits `startTime` instead of `startsAt`.
Unify field names and map statuses during integration — the conformance suite
here pins the TARGET vocabulary all lanes must converge on.
