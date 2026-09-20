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

## 3. Scan at boot

After the read-only sports-events dependencies have been initialized, perform
the first scan:

```js
await autoContracts.scanToday();
```

The scan:

1. Calls the existing fetchSportsEvents.
2. Keeps only games whose start time is still in the future.
3. Deduplicates by game id.
4. Creates one DRAFT proposal per upcoming game.
5. Stores those proposals in the automatic-contract review queue.

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

## 5. Run the scan on an interval

A lightweight periodic scan can be installed after boot:

```js
const AUTO_CONTRACT_SCAN_INTERVAL_MS = 5 * 60 * 1000;
const autoContractScanTimer = setInterval(async () => {
  try {
    await autoContracts.scanToday();
  } catch (error) {
    console.warn("Automatic contract scan failed.", error);
  }
}, AUTO_CONTRACT_SCAN_INTERVAL_MS);
```

The engine is idempotent by game id, so repeatedly scanning the same ESPN feed
does not create duplicate drafts.

If the application has an existing lifecycle/shutdown mechanism, clear the
interval there:

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
