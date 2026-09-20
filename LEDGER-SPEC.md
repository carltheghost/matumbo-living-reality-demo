# TUMBO-SIM Ledger — Specification v1 (Simulation Only)

**Status:** design proposal for critique. **Simulation only** — no real money, no custody,
no signing, no wallets, no chains. All value is local demo points (`TUMBO-SIM`).

This spec implements the maTumbo v3 financial constitution (idea 56): one native coin,
truthful demo state, atomic double-entry value, EchoProof receipts, synthetic markets,
Arena contracts, Relics, AI autonomy gates — plus GPT's "Infinite Burrow" mechanics
(Hunger Meter sinks, Hibernation Vault fixed locks + Burrow Score, The Void burn history,
Proof of Presence) and simulated x402-style bot micropayments.

---

## 1. Units and assets

- **Base unit:** integer `fluff`. `1 TUMBO-SIM = 1,000 fluff`. All amounts are integers.
  Every amount must satisfy `Number.isSafeInteger` and be `>= 0` at the boundary.
  (A production port must use BigInt; the prototype asserts safe-integer range.)
- **Assets (fixed supply, simulation):**
  - `TUMBO` — the native sim coin. Supply: **420,000,000,000 TUMBO**
    (= 420,000,000,000,000 fluff), matching tokenomics v3 baseline under review.
  - `sMIMAS` — synthetic asset for the demo's synthetic market (Mimas futures,
    story-flavoured). Supply: **21,000,000 sMIMAS** (= 21,000,000,000 fluff),
    held at genesis by the `market` account. Never sold as real; pure demo.
- Display formatting divides by 1,000; hashes and math always use fluff.

## 2. Accounts

```
account = { id, kind: "user"|"bot"|"system", label, balances: {ASSET: int}, pockets?: … }
```

- **User/bot accounts:** `u:<name>`, `b:<name>`. Created empty (or via faucet drip).
- **System accounts (no human owner):**
  - `sys:treasury` — holds unallocated TUMBO; funds faucet + rewards.
  - `sys:faucet` — drip source for new users (rate-limited per tick).
  - `sys:escrow` — holds funds for PENDING two-phase intents (deliver, payreq).
  - `sys:vault` — holds Hibernation Vault deposits + generic locks + stakes.
  - `sys:void` — **The Void.** Burn sink. Only ever credited by burns; never debited.
    Visualized as permanent world history.
  - `sys:market` — synthetic-market maker; holds sMIMAS inventory + TUMBO float.
- **Savings pockets:** separate accounts `u:<name>:save:<goal>` owned by the same
  owner. Keeps double-entry clean (a pocket is just an account).

### Invariants (checked on EVERY commit; `verifyInvariants()` replays all)

1. **Non-negativity:** every `(account, asset)` balance `>= 0`, safe integer.
2. **Double-entry:** every committed journal's entries sum to **exactly 0 per asset**.
3. **Conservation:** `Σ balances(asset)` over ALL accounts (incl. `sys:void`) equals
   the recorded fixed supply for that asset. Burns move value to `sys:void`; they
   never destroy it from the books — the Void is auditable.
4. **Escrow integrity:** `sys:escrow` balance == Σ amounts of PENDING intents.
5. **Vault integrity:** `sys:vault` balance == Σ amounts of open locks/stakes/deposits.
6. **Chain integrity:** every EchoProof receipt's `hash` recomputes; `prevHash`
   links form one unbroken chain from genesis.
7. **Idempotency:** `idempotencyKey → txId` is a persisted bijection; replays return
   the original receipt, never a second journal. The replay comparison covers
   `refs` as well as action/actor/entries/meta, so reusing an idem across
   different intents or txs fails closed (`IDEM_MISMATCH`) instead of replaying
   the wrong receipt. Action methods with post-commit bookkeeping (intent
   records, state flips) skip those effects on replay — a replayed idem can
   never mutate the wrong intent's bookkeeping. Repeating a completed
   receive/confirm with the same idem is fail-closed (`INTENT_NOT_PENDING`).
   `reversedBy` is post-seal bookkeeping kept OUTSIDE the sealed refs (double
   reverse is already impossible: the reverse idem is deterministic).
8. **System-account firewall:** no journal may debit `sys:treasury`, `sys:market`,
   or `sys:faucet` unless it comes from a ledger-internal flow or carries the
   system gate; `sys:escrow`, `sys:vault`, and `sys:void` can be touched ONLY by
   ledger-internal flows (escrow holds, vault exits, burns). The check runs
   before any balance mutates.
9. **Journal replay binding:** live balances must equal a fresh replay of the
   whole journal from the genesis opening balances. Serialized state edited
   outside the journal is rejected on load/verify.
10. **Journal↔receipt linkage:** journal and receipt logs stay 1:1; every
    receipt's hash recomputes from its journal tx (entries, refs, and meta are
    all sealed — receipt body v2); the chain tip hash is pinned in state, so
    tail truncation of either log is detected.
11. **Transactional commits:** if anything fails between the first mutation and
    the receipt, ALL state (balances, journal, receipts, clock, seq, idempotency
    map, chain tip) is restored — a failed commit is invisible and the ledger
    never wedges.
12. **Exact money math:** all multiplications/divisions on money use exact
    integer arithmetic (`mulDivFloor`, BigInt-backed) — float `Math.floor(a*b/c)`
    is off by ±1 past 2^53 and is never used on funds.

## 3. Journal and state machine

### 3.1 Transaction record

```
tx = {
  id: "tx-<seq>",            // deterministic, seq = commit order
  idem: "<idempotency key>", // client-supplied; replay-safe
  action: "send"|"receive"|"exchange"|"buy"|"sell"|"deliver"|"tip"|
          "stake"|"save"|"deposit"|"lock"|"reverse"|"cancel"|"unstake"|
          "withdraw"|"slash"|"sweep",
  actor: "<account id | sys>",
  state: "pending"|"settled"|"cancelled"|"reversed",
  entries: [{account, asset, delta}],   // signed fluff, Σ==0 per asset
  refs: { reverses?: txId, cancels?: txId, intentOf?: txId },   // reversedBy lives on the tx object, not in sealed refs
  meta: { …action-specific… },
  createdTick, settledTick|null
}
```

State transitions only move forward:
`pending → settled | cancelled`; `settled → reversed` (via a NEW compensating tx;
the original is never edited or deleted).

### 3.2 The 13 actions

| # | Action | Settlement | Counterparty model |
|---|--------|-----------|-------------------|
| 1 | `send` | instant | push: debit sender → credit recipient |
| 2 | `receive` | two-phase | settles a PENDING inbound (payreq/faucet/reward) |
| 3 | `exchange` | instant | atomic swap via `sys:market` at quoted price |
| 4 | `buy` | instant | `exchange` with TUMBO→synthetic (alias) |
| 5 | `sell` | instant | `exchange` with synthetic→TUMBO (alias) |
| 6 | `deliver` | two-phase | escrow: sender→`sys:escrow`→(confirm)→recipient |
| 7 | `tip` | instant | like send, flagged social; sender-irreversible |
| 8 | `stake` | instant lock | into Arena contract; slashable; unlock-gated |
| 9 | `save` | instant | owner pocket move; owner-reversible anytime |
| 10 | `deposit` | instant lock | Hibernation Vault: fixed term, NO early exit |
| 11 | `lock` | instant lock | generic time/condition lock primitive |
| 12 | `reverse` | meta | compensating journal vs a settled tx |
| 13 | `cancel` | meta | voids a PENDING intent, returns escrow |

### 3.3 Per-action rules

**SEND** — entries: `[{sender,-a},{recipient,+a}]`, fee 0.
Reverse: sender or arbiter, within `REVERSE_WINDOW` (1,000 ticks), full amount only,
fails closed if recipient balance < amount. Reversal burns nothing (fee was 0).

**RECEIVE** — settles a PENDING inbound created by `payreq` (payment request),
faucet drip, or reward grant. `receive(intentId)` moves `sys:escrow→recipient`,
state settled. Issuer may `cancel` while pending. Expiry: pending intents carry
`expiresTick`; the `sweep` (system) cancels expired ones.

**EXCHANGE / BUY / SELL** — atomic: debit buyer assetIn → `sys:market`,
credit `sys:market` assetOut → buyer, minus the **Void tithe** (default 10 bps of
the TUMBO leg, burned to `sys:void` — the Hunger Meter sink, always shown in UX).
Executed against a **ledger-issued quote**: `quote()` stores terms in a
quote registry keyed by `qid` (default ids come from a persisted counter, so
quoting consumes no PRNG and reads stay reads); `_execSwap` honors ONLY the stored terms looked
up by `qid` — a caller-supplied quote object is a reference, never terms, so a
fabricated quote is rejected (`UNKNOWN_QUOTE`). Fails if the quote expired or
the oracle rate moved beyond `maxSlippageBps`; tolerance is hard-capped at
500 bps (callers can tighten, never widen). **No direct reverse** — the
documented reversal path is a counter-trade at the then-current price (user's
risk, disclosed).

**DELIVER** — `deliver.create`: sender→`sys:escrow` (PENDING, hold record).
`deliver.confirm` (recipient or oracle): escrow→recipient (SETTLED).
`cancel` (sender or arbiter, pre-confirm): escrow→sender (CANCELLED).
Post-settle: arbiter-only `reverse` within window, recipient-balance-sufficient.

**TIP** — like SEND but `meta.social=true`. **Sender cannot reverse, ever.**
Arbiter may reverse within window for fraud (gate-required).

**STAKE** — `stake(contractId, amount, unlockTick, slashBps)`: owner→`sys:vault`,
stake record `{status:active}`. `unstake`: after `unlockTick` (or after contract
resolution), vault→owner. `slash`: on adverse Arena resolution, `slashBps` of the
stake → `sys:void` (burn, permanent), remainder released. No arbitrary reverse;
exit only via unstake/slash.

**SAVE** — owner→`u:owner:save:<goal>`. `reverse` by owner anytime, FULL amount only;
to withdraw partially, save in chunks and reverse individual chunks. Each
reverse is itself a tx. No window, no arbiter.

**DEPOSIT** (Hibernation Vault) — owner→`sys:vault` with `maturityTick`; **no early
withdrawal, no cancel, no reverse, ever**. `withdraw` after maturity: vault→owner.
Accrues **Burrow Score** (non-transferable): `score += amount_fluff * ticksLocked / 1e6`
credited at withdraw, shown on profile. Proof-of-Presence rewards are separate
grants (see §6).

**LOCK** — generic: owner→`sys:vault` with `{unlockTick}` or `{condition}`.
`unlock` when satisfied. Standalone locks: no cancel. (Locks created inside
deliver/stake/deposit are governed by those actions' rules.)

**REVERSE** — creates compensating tx `R` with `refs.reverses = T`, entries =
negation of T's entries, minus non-refundable sinks (void tithe stays burned).
Sets `T.state = reversed` and `T.reversedBy = R` (post-seal bookkeeping, outside sealed refs). Authorization matrix:

| Original | Who may reverse | Window | Notes |
|---|---|---|---|
| send | sender, arbiter | 1,000 ticks | fails if recipient can't cover |
| tip | arbiter only | 1,000 ticks | fraud path; gate-required |
| receive | arbiter only | 1,000 ticks | issuer uses cancel pre-settle |
| exchange/buy/sell | — | — | counter-trade only |
| deliver | arbiter only | 1,000 ticks | pre-confirm: sender cancels |
| stake | — | — | unstake/slash only |
| save | owner | none | anytime, full only (save in chunks for partials) |
| deposit | — | — | never; withdraw at maturity |
| lock | — | — | unlock at condition |

Hard rules: a `reverse` tx cannot itself be reversed; a `cancel` cannot be reversed;
a reversed tx cannot be reversed again; reversing a cancelled/pending tx is an error
(use cancel).

**CANCEL** — only for `pending` intents. Creator (or arbiter) → escrow returns to
creator, state `cancelled`, compensating journal emitted. Cancelling a settled tx
is an error (`USE_REVERSE`); cancelling twice returns the original receipt
(idempotent).

### 3.4 Authorization (simulation)

Actors are account ids. Sensitive paths require capabilities:
- `arbiter.*` requires passing the gate token `gate:arbiter:v1` (models idea 56's
  AI autonomy gates; in the demo this is a UI-confirmed, logged step — never silent).
- Oracle rates must be positive safe integers ≤ 1e15 (`setRate` rejects floats,
  `Infinity`, and extremes at the boundary).
- Treasury/market/faucet debits, and any touch of escrow/vault/void, require
  `gate:system:v1` OR a ledger-internal flow (faucet drips, intent settlement,
  market swaps against registry quotes, vault exits, burns) — the internal flows
  are authorized by construction and enforced centrally in the commit path, so
  public `send`/`tip` can never move system funds on their own.
- No cryptography, no real signatures — capabilities are explicit sim constructs.

## 4. EchoProof receipts (body v2)

Every committed transition emits exactly one receipt, appended to a hash chain:

```
receipt = {
  v: 2, seq, txId, action, actor, idem,
  entries: [{account, asset, delta}],   // deltas as decimal strings
  refs,                                 // sealed alongside entries+meta (v2)
  prevHash, logicalTick, meta,           // meta/refs are deep copies at seal
  hash
}
hash = SHA256_HEX(canonical({v,seq,txId,action,actor,idem,entries,refs,prevHash,logicalTick,meta}))
```

- `canonical`: JSON with sorted keys, no whitespace; deltas as strings (no float).
- `prevHash` of receipt 0 = `"TUMBO-GENESIS"`.
- Wall-clock time is **excluded** from the hash (display-only, attached outside).
  Only the logical tick is hashed → fully deterministic replays.
- `verifyChain()` recomputes every hash and link; any tamper breaks verification.
- Receipts are the ONLY proof surfaced in UX ("EchoProof #<seq>").

## 5. Determinism, persistence

- Seeded PRNG (mulberry32); seed persisted; all ids/nonces derive from it.
- Logical clock: `tick` increments once per committed transition. No `Date.now()`
  inside hashed state.
- `LedgerStore`: `serialize()` → JSON (BigInt-free by construction); browser:
  `localStorage["tumbo-ledger-v1"]`; Node: file or memory. `load()` restores
  accounts, journal, receipts, idem map, holds, locks, stakes, deposits, clock,
  PRNG state. Export/import for demo reset.

## 6. Infinite Burrow mechanics (sim)

- **Hunger Meter:** the 10 bps Void tithe on market ops + per-action bot fees
  (§7). A meter in UX shows cumulative burned vs circulating.
- **Hibernation Vault:** `deposit` (fixed term, Burrow Score, no early exit).
- **The Void:** `sys:void` balance + burn history; every burn is a receipt.
- **Proof of Presence:** distinct meaningful in-world actions (first visit to a
  district, completing a delivery, winning an Arena bout) grant one-time TUMBO
  from treasury via `receive`-style claimable rewards. One claim per
  (account, achievement) — enforced by idempotency keys
  `pop:<account>:<achievement>`.

## 7. Bot x402-style payments (simulated)

No HTTP, no stablecoins, no real signing. Models the x402 pattern
(request → 402 challenge → pay → 200) as local calls between bot wallets:

```
BotPay.request({fromBot, service, resource, params})
  → 402 challenge {challengeId, resource, priceFluff, payTo, nonce, expiresTick}
BotPay.pay({challengeId, authToken})        // ledger tip fromBot→payTo, memo=nonce
  → payment receipt (EchoProof #seq)
BotPay.fulfill({challengeId, receiptHash}) // verifies: nonce unused, not expired,
                                           // payment settled; memo must EXACTLY equal
                                           // `x402:<nonce>` (suffix matches rejected)
  → 200 {result}  | 402 {error}
```

- `BotWallet { botId, accountId, authToken }`; authToken is a sim secret checked
  in-memory (never logged, never hashed into receipts).
- **Pricing registry** (fluff, per call; defaults, service-overridable):
  `cube.spawn 50, cube.message 5, cube.render 20, market.quote 10, arena.enter 500,
   travel.hop 25, presence.ping 1`. Overrides are PER SERVICE
  (`ledger.s.botPricing["service:resource"]`) and may be set ONLY by that
  service's own bot presenting its authToken — no bot can price another's menu.
  Overrides persist with the ledger.
- **Bot funding is gated:** `registerBot({initialTumbo})` with `initialTumbo > 0`
  requires the system gate; registration alone never draws from the faucet.
- Replay protection: nonce single-use; challenge expiry enforced at BOTH pay
  and fulfill; per-bot per-tick spend cap (anti-drain: default 10,000 fluff/tick).
- **Sim boundaries (explicit):** `authToken` is a sim-model capability (who
  registered the bot), not a real auth boundary; the spend cap is a bot-flow
  velocity control, not a ledger invariant — a bot calling the ledger directly
  bypasses it by construction, same as a user bypassing a UI limit.
- Every bot payment is a normal ledger `tip`/`send` → full EchoProof + reversibility
  rules apply (tips: arbiter-only reverse).

## 8. What this spec deliberately excludes

Real money, fiat, banks, card rails, real wallets, key custody, signatures,
on-chain settlement, DEX/CEX listing, securities framing — none of it. The
prototype cannot be pointed at a chain; there is no chain adapter by design.
