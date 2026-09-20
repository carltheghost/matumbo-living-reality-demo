# Contract Ledger Wiring Guide

Lane: CONTRACT TRACKING (lifecycle, history, audit view, eternal-escrow grading).
Branch: `lane/contracts-ledger-grok`.
Module: `src/domains/contract-ledger.js` · Tests: `tests/contract-ledger.test.mjs`.

Source of truth for contract *state* remains `src/domains/outcome-contracts.js`.
This ledger is an append-only tracking / audit layer on top. Do not rewrite outcome-contracts.js.

## Iron Law

SIMULATED TUMBO POINTS ONLY. No real money, no wallet, no signing, no custody, no settlement, no mainnet. Projection-only.

## Create the ledger

```js
import { createContractLedger } from './domains/contract-ledger.js';

const ledger = createContractLedger();
```

Hold one ledger instance for the app session (or per Reality Lens Ω projection context).

## Where to call record()

| Moment | Suggested call |
|---|---|
| Contract created | `ledger.record({ contractId, type: 'created', toStatus: 'proposed', payload: { ...contractSnapshot } })` |
| Participant joined | `ledger.record({ contractId, type: 'joined', participant, payload: { side } })` |
| Status advanced (open / active) | `ledger.record({ contractId, type: 'status_change', toStatus: 'open' \| 'active' })` |
| After grading (optional mirror) | grading already records via gradeOnEventLanding; extra notes use `type: 'audit_note'` |
| After successful claim | claim path records `type: 'claimed'` internally; UI may also log `audit_note` |

Never delete or mutate prior entries. Reverse and cancel only append.

## Where to call gradeOnEventLanding

Call exactly once when a game / market event result lands and the contract is ready to settle:

```js
// Inside the result-landing handler (e.g. after outcome-contracts marks the event resolved)
const gradeResult = ledger.gradeOnEventLanding(contract, {
  winnerSide: result.winnerSide, // or winnerId
  eventId: result.eventId,
  scores: result.scores,
});

if (gradeResult.graded) {
  // project simulated Tumbo point deltas into UI / Reality Lens Ω overlays
  // winners: positive amount, losers: negative amount
  // claimable forever — do not set UI expiry
}
```

Anti-double-grade is enforced inside the ledger. Safe to call defensively; second call returns `{ graded: false, reason: 'already graded' }`.

## Claiming (eternal escrow)

```js
const claimResult = ledger.claim(contractId, participantId, nowMs);
// claimResult.claimed === true → pay simulated Tumbo points (projection only)
// wins remain claimable with expiresAt: null even decades later
```

## Audit view

```js
const trail = ledger.getAuditView({
  contractId, // optional
  participant, // optional
  from, // optional unix ms
  to, // optional unix ms
});
// frozen, chronological array of ledger entries
```

## Reverse / cancel

```js
ledger.reverse(contractId, 'oracle correction');
ledger.cancel(contractId, 'user withdrew before open');
```

Both append an audit entry and update status. History is retained forever.

## Pure helpers (unit-testable, DOM-free)

- `applyLifecycleEvent(state, event)`
- `isClaimable(ledgerEntry, now)`
- `summarizeParticipantHistory(entries, participant)`

Import from `src/domains/contract-ledger.js` directly in tests or projection code.

## Integration checklist

1. Instantiate ledger once near outcome-contracts bootstrap.
2. On every contract create / join / status change → `record()`.
3. On event result landing → `gradeOnEventLanding(contract, result)`.
4. On user claim action → `ledger.claim(...)`.
5. Audit UI / Reality Lens Ω history panel → `getAuditView` / `getHistory`.
6. Never pass real currency, wallet addresses, or signing payloads into this module.

## Status mapping note (for the integrator)

The ledger's tracking lifecycle (`proposed → open → active → graded → claimed`, plus `reversed` / `cancelled`)
is intentionally looser than `outcome-contracts.js` (`draft → open → locked → graded → settled → claimed → voided`).
When wiring them together, map ledger events to the canonical statuses:
`proposed`↔`draft`, `active`↔`locked`, ledger `claimed`↔ canonical `settled→claimed`,
ledger `cancelled`↔ canonical `voided`, ledger `reversed` = audit-only override.
