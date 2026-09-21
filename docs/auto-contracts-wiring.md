# Automatic Contract Creation Wiring

Reality Lens Ω projection-only wiring.

The prediction place automatically turns upcoming games from the existing
read-only multi-sport feed into DRAFT proposal entries. The proposals enter the
same persisted **Contracts for your review** queue used by Contract Atelier.

Nothing in this flow places a bet, moves money, signs a transaction, connects a
wallet, settles a contract, or writes to mainnet.

## Runtime wiring

`src/main.js` creates the shared `createContractFlow()` with:

- the existing `fetchMultiSportEvents()` read-only feed;
- the shared outcome desk;
- the shared persisted proposal queue;
- the lifecycle ledger.

After Contract Atelier is mounted, the entry point starts the automatic scan:

```js
void runAutomaticContractScan();
```

It then refreshes every five minutes:

```js
const AUTO_CONTRACT_SCAN_INTERVAL_MS = 5 * 60 * 1000;
window.setInterval(() => {
  void runAutomaticContractScan();
}, AUTO_CONTRACT_SCAN_INTERVAL_MS);
```

The scan is serialized so overlapping timer ticks cannot create concurrent
contract batches.

## Automatic pipeline

Each scan:

1. Fetches the existing read-only multi-sport events.
2. Keeps only games whose start time is still in the future.
3. Maps the event into the auto-contract draft shape.
4. Enriches the draft with optional read-only Kalshi/Polymarket quotes.
5. Rejects stale quotes while keeping the draft usable.
6. Submits one proposal per game to the persisted review queue.
7. Leaves approval, opening, grading, and claiming to the existing Contract
   Atelier/outcome-desk lifecycle.

The proposal queue is the source of truth for the review surface, so automatic
drafts appear alongside manually created contracts.

## Idempotency and retry behavior

The flow has two layers of deduplication:

- an in-memory `gameId` guard prevents duplicate work during one page session;
- the persisted proposal queue is checked by `eventId`, preventing duplicate
  proposals after a page reload.

Transient draft-construction or proposal-submission failures remove the game
from the in-memory guard, so the next five-minute scan can retry it.

Dismissed/expired proposals remain historical queue records and are still
recognized by `eventId`; the automatic engine does not silently recreate them.

## Manual refresh

The existing **SCAN UPCOMING GAMES** button remains available. It calls the
same `contractFlow.scanAndQueue()` path as the automatic timer.

For diagnostics, the entry point exposes:

```js
window.__TUMBO_AUTO_CONTRACTS__.scanNow()
window.__TUMBO_AUTO_CONTRACTS__.getLastScan()
```

`getLastScan()` contains the latest `{ proposals, drafts, errors }` result.

## Data boundary

```
ESPN / multi-sport read-only feed
        |
        v
contractFlow.scanAndQueue()
        |
        v
upcoming games
        |
        v
gameToDraft()
        |
        v
simulated TUMBO Points DRAFT
        |
        v
persisted "Contracts for your review"
        |
        v
approval in Contract Atelier
        |
        v
canonical local outcome desk
```

The final boundary is deliberately:

- NO REAL MONEY
- NO WALLET
- NO SIGNING
- NO CUSTODY
- NO SETTLEMENT
- NO MAINNET

## Tests

`tests/contract-flow.test.mjs` covers:

- upcoming-game mapping and idempotency;
- persisted deduplication across a simulated page reload;
- retry after transient proposal submission failure;
- odds enrichment and stale-feed handling;
- review submission and approval-time quote freezing;
- deterministic grading and anti-double-grade;
- forever claims and anti-double-claim.

Run the project test suite with:

```bash
npm test
```
