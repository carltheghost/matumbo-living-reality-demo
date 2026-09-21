# Automatic Contract Creation Wiring

Reality Lens Ω projection-only wiring.

The automatic contract engine turns upcoming games from the existing read-only
sports-events feed into DRAFT proposal entries. Nothing in this flow places a
bet, moves money, signs a transaction, connects a wallet, settles a contract,
or writes to mainnet.

## 1. Import the engine

Add this import beside the existing domain imports at the application's boot
entry point:

```js
import { createAutoContracts } from "./domains/auto-contracts.js";
```

## 2. Create the automatic-contract engine

Use the existing domain dependencies already owned by the application:

```js
const autoContracts = createAutoContracts({
  fetchSportsEvents,
  createOutcomeContracts,
  now: () => new Date(),
});
```

The now dependency is injectable so tests and replay environments can provide
a deterministic clock.

## 3. Scan automatically at boot

The application now performs an initial read-only scan automatically after the
Contract Atelier is wired, so the prediction place populates itself without a
button press:

```js
void contractFlow.scanAndQueue();
```

The automatic scan:

1. Calls the existing read-only multi-sport feed.
2. Keeps only games whose start time is still in the future.
3. Deduplicates by game id and against the persisted proposal queue.
4. Creates one DRAFT proposal per upcoming game.
5. Places those proposals in the existing "Contracts for your review" queue.

No execution occurs during this scan.

## 4. Add the drafts to the bot-plaza review queue

Whenever the application builds the proposal-review queue, append the generated
drafts before passing the queue to the existing rankProposalsForReview:

```js
const proposalQueue = [
  ...existingProposalQueue,
  ...autoContracts.getDrafts(),
];
const rankedReviewQueue = rankProposalsForReview(proposalQueue);
```

The resulting entries already carry:

```
kind: "contract-review"
type: "contract-review"
queue: "Contracts for your review"
status: "DRAFT"
createdBy: "auto-contracts"
simulationOnly: true
execution: "NONE"
source: "ESPN_READ_ONLY"
```

They therefore enter the existing bot-plaza review path as review proposals,
not executable actions.

## 5. Keep scanning automatically

The app refreshes upcoming prediction contracts every five minutes:

```js
const AUTO_CONTRACT_SCAN_INTERVAL_MS = 5 * 60 * 1000;
const automaticContractScanTimer = window.setInterval(() => {
  void runAutomaticContractScan();
}, AUTO_CONTRACT_SCAN_INTERVAL_MS);
```

The scan is serialized while one request is in flight, and the queue is checked
for an existing `eventId` before a new proposal is created. This prevents
duplicates during repeated scans and after page reloads.

The timer is cleared on `pagehide`:


```js
clearInterval(autoContractScanTimer);
```

## 6. Keep the review queue connected to the UI

The review surface should read the current queue from:

```js
autoContracts.getDrafts()
```

and combine it with the application's other proposal entries before calling:

```js
rankProposalsForReview(queue)
```

Do not call a wallet API, signing API, payment API, settlement API, blockchain
RPC, or mainnet transaction API from this integration.

## 7. Data boundary

The intended data flow is:

```
ESPN read-only feed
        |
        v
fetchSportsEvents()
        |
        v
scanToday()
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
"Contracts for your review"
        |
        v
rankProposalsForReview()
        |
        v
human/bot review surface
```

The final boundary is deliberately projection-only:

```
NO REAL MONEY
NO WALLET
NO SIGNING
NO CUSTODY
NO SETTLEMENT
NO MAINNET
```

## 8. Tests

Run the lane tests with:

```bash
node --test tests/auto-contracts.test.mjs
```

The tests use fake ESPN events and a fake outcome-contract factory, so they do
not require a browser, DOM, network access, wallet, or blockchain connection.
