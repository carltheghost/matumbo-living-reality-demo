# Contract Flow — Reality Lens Ω

ESPN information integrated **where people already make contracts**: the
Contract Atelier. Not a side panel. Not a second app.

## The pipeline

```
ESPN scoreboard (read-only)
  → auto-draft (upcoming games only, idempotent on gameId)
  → optional read-only Kalshi + Polymarket quotes (15-min freshness)
  → "Contracts for your review" queue (existing Contract Atelier UI)
  → Tumbo approves (quote snapshot frozen at approval)
  → canonical outcome desk (real local simulated contract)
  → lifecycle ledger (proposed → open → active → graded → claimed)
  → deterministic grading when the event lands
  → award claimable FOREVER (expiresAt: null)
```

User-created contracts keep working exactly as before — drafts arrive
*alongside* manual contracts, never replacing them.

## Files

- `src/domains/contract-flow.js` — the integration controller
  (`createContractFlow`). Pure domain logic: ESPN record mapping,
  draft normalization (`startsAt`, canonical `draft` status), odds
  enrichment, review submission, approval-time quote freezing,
  grade-on-landing, claim-forever. No DOM. Resolves read-only network
  lazily so entry/render layers stay network-free (release boundary).
- `src/render/contract-atelier.js` — two integration seams, both optional:
  - `onContractApproved({ contract, proposal })` — fired after a review
    approval opens the book. A throwing hook can never unwind the approval.
  - `onScanRequested()` — async scan trigger. When wired, a
    "SCAN UPCOMING GAMES" button appears in the review section and reports
    honestly: queued count, partial-feed issues, or failure with the queue
    explicitly untouched.
  - The odds line rides in the proposal's `sourceNotes`, so it renders on
    the existing review card's SOURCES row with zero UI changes.
- `src/main.js` — creates one `createContractLedger()` and one
  `createContractFlow()` at startup, wires both hooks, then automatically
  scans on boot and every five minutes. Exposes
  `window.__TUMBO_CONTRACT_FLOW__`,
  `window.__TUMBO_CONTRACT_LEDGER__`, and
  `window.__TUMBO_AUTO_CONTRACTS__`.

## Invariants (all tested)

- Drafts carry `startsAt` (ISO) and canonical `draft` status.
- `gameId` is namespaced (`espn-multi-sport:…`) and idempotent — a second
  scan never re-drafts the same game.
- Only upcoming games draft; started/finished games are skipped.
- Odds quotes are read-only public GETs, simulated TUMBO points only
  (`simulated: true`, `realMoney: false`, `unit: "TUMBO_POINTS"`), valid
  shape required, older than 15 minutes rejected, team-name matched
  (never first-outcome), frozen at approval.
- Feed failure never blocks: drafts stay reviewable with an honest
  "odds unavailable" state; a failed scan leaves the queue exactly as it was.
- Grading is deterministic; the canonical desk rejects conflicting
  re-grades and double claims.
- `expiresAt: null` on every escrow — a win is claimable forever.
- Status dialects (review / ledger / hardening) normalize through
  `contract-status-vocab.js`; canonical desk statuses stay authoritative.

## Boundaries

- Simulated TUMBO points only. No wallet, no signing, no custody, no
  orders, no settlement authority, no mainnet — anywhere in the flow.
- ESPN, Kalshi, Polymarket are read-only sources. No keys.
- Three.js is projection only; the desk/ledger/queue hold authority.

## Operating it

1. Open the Contract Atelier and find "CONTRACTS FOR YOUR REVIEW".
2. Upcoming games are scanned automatically on boot and every five minutes;
   new drafts appear as review cards with the odds line on their SOURCES row.
3. SCAN UPCOMING GAMES remains available as an explicit manual refresh.
4. APPROVE opens the book (quote frozen into the ledger); EDIT adjusts;
   DISMISS returns the draft.
5. When the event lands, `flow.gradeOnLanding(contractId, { winner })`
   grades deterministically; winners claim via
   `flow.claimForever({ nftId })` — forever.

## Tests

- `tests/contract-flow.test.mjs` — 17 tests: mapping, normalization,
  odds attach/reject, idempotent scan, review submission, approval-time
  freezing, stale-quote honesty, grading, anti-double-grade, forever claim,
  anti-double-claim.
- `tests/contract-flow-atelier.test.mjs` — 6 tests: approval hook payload,
  hook failure can't unwind approval, scan button presence/behavior,
  honest scan failure, odds SOURCES row rendering.
- Full suite: `npm test` · entry check: `npm run check`.
