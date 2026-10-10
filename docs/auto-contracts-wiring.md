# Contract Creation Wiring

Reality Lens Ω projection-only wiring.

The contract engine can turn upcoming games from the read-only sports-events
feed into DRAFT proposal entries. It reads public feeds only after the person
presses **Scan** in Contract Atelier or **Refresh evidence** in the review
surface. Opening the app, reconnecting, and returning to a tab do not start
provider requests. Nothing in this flow places a bet, moves money, signs a
transaction, connects a wallet, settles a contract, or writes to mainnet.

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

## 3. Scan only after a visible request

Connect the existing visible controls to the scan function:

```js
onScanRequested: () => contractFlow.scanAndQueue(),
onRefreshEvidence: ({ contractId }) => contractFlow.scanAndQueue(),
```

The scan:

1. Calls the existing fetchSportsEvents.
2. Keeps only games whose start time is still in the future.
3. Deduplicates by game id.
4. Creates one DRAFT proposal per upcoming game.
5. Stores those proposals in the automatic-contract review queue.

Do not call the scan during boot, on a timer, or in online, pageshow, or
visibilitychange handlers. Coalesce simultaneous button presses into the same
in-flight request. No execution occurs during a scan.

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

## 5. Keep the local simulation separate from public reads

The local contract simulation may keep its one-second deterministic tick. That
tick operates only on already loaded local state; it must not call public feeds.
Do not install a periodic provider scan. A user can request another read from
either visible control when current evidence is needed.

For Kalshi, the local bridge reads open, non-multivariate markets only. This
avoids the zero-quote bundle records at the top of the unfiltered feed. Current
dollar-denominated bid, ask, and last-price fields are already probabilities
and must not be converted to cents. The bridge remains a fixed, read-only,
short-cached route; user scans are the only trigger.

The engine remains idempotent by game id, so a requested repeat scan does not
create duplicate drafts.

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
