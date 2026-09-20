# ledger-core — enforced financial invariants for maTumbo

**Lineage:** ported from TumboAgent PR #6 (`matumbo/` foundation slice, tag
`archive/pr-6-claude-matumbo-master-spec-mz1vv4`). The Python original is
preserved under that tag as the reference implementation and test oracle.
This module is a faithful JavaScript port of its *invariants* — the maTumbo
tree is JS-only, so nothing could be copied verbatim.

## What it adds (the tree had the shape, not the enforcement)

| Capability | Before | After |
|---|---|---|
| Integer money | plain JS numbers, `Number.isFinite` checks | `Money` — BigInt base units, 8dp, floats refused on the value path |
| Double-entry ledger | `prime_ledger_legs` table + float-epsilon balance check, client-mirrored state | `Ledger.post()` — atomic, balanced to exact zero, idempotent, guarded accounts |
| Event envelope | SIMFABRIC in-memory pub/sub bus (different thing) | content-addressed domain events (sha256), idempotency de-dup |
| EchoProof receipts | hash-chained *storage* + render | receipt *generator* producing chained, human-readable demo receipts |
| Permissions | SIMULATION_POLICY + two-admin flow | A0–A5 AI autonomy ladder with budget caps, human-approval gate at A4+ |
| Wallet | `wallet: false, custody: false` in policy | Quark Wallet realm: hold/send/request/escrow over the new ledger |

## Simulation-only boundary

Everything here is **simulated TUMBO points**. No real money, no real
custody, no signing, no settlement, no mainnet — the same law as the
tree's `SIMULATION_POLICY`. Every EchoProof receipt is stamped
`Local Demo Proof`. The Python original's "managed-custody" wording was
deliberately reworded to *simulated* custody on port. `demoGrant()` is the
DEMO funding door; in production it stays closed.

## Modules

- `money.js` — `Currency`, `Money` (BigInt, 8dp, currency-mismatch guards, explicit rounding, exact fee splits)
- `events.js` — content-addressed `createEvent`, `EventLog` (append-only, idempotent)
- `ledger.js` — `Ledger.post()` (atomic, exact-zero balance, idempotent replay, guarded accounts), `Posting`, `Account`
- `echoproof.js` — `EchoProof.issue()` hash-chained receipts, `verifyChain()` fully recomputes hashes
- `permissions.js` — `Role`, `PolicyEngine`, `Principal`, `AutonomyLevel` A0–A5, budget caps
- `assets.js` — `MAJOR_CRYPTOS` (9 demo-labeled major assets, 8dp)
- `wallet.js` — `QuarkWallet` (available/reserved/escrow buckets, send, payment requests, escrow lock/release)
- `index.js` — barrel re-export

## Usage

```js
import { Ledger, EchoProof, PolicyEngine, QuarkWallet, Principal, Role, Money } from "./index.js";

const wallet = new QuarkWallet(new Ledger(), new EchoProof());
const alice = new Principal("alice", Role.VERIFIED_HUMAN);
wallet.demoGrant(alice, Money.of("100"));   // DEMO funding only
wallet.send(alice, "bob", Money.of("40"));  // atomic, receipted
wallet.balance("alice").available.toString(); // "60.00000000 TUMBO"
```

## Tests

`tests/ledger-core.test.mjs` ports PR #6's invariant suite (~24 assertions):
no-float exactness, excess-precision rejection, currency guards, exact fee
splits, balance-to-zero, no-negative + atomicity, idempotent replay,
unknown accounts, autonomy gates, budget caps, wallet send/escrow/receipts,
payment requests, multi-asset independence, receipt-chain verification.

Run: `node --test tests/ledger-core.test.mjs`
