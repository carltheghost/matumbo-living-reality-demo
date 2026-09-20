# TUMBO-SIM Token Contract — Canonical v1

**Status:** canonical. Every token builder (GPT 1–7, Grok 8–14) builds to this.
**Simulation only** — TUMBO-SIM is local demo points. Never real money, never
wagering, never custody, never chains, never real wallets. Every user-facing
surface labels itself simulated.

## 1. Units and math

- Base unit: integer **fluff**. `1 TUMBO-SIM = 1,000 fluff`.
- Every amount: `Number.isSafeInteger` and `>= 0` at every boundary.
- Money math uses exact integer arithmetic (`mulDivFloor`, BigInt-backed) —
  never float on funds.
- Display: divide by 1,000, format to 3 decimals. Hashes and math use fluff.

## 2. Assets and config

- Assets: `TUMBO` (native), `sMIMAS` (synthetic demo asset).
- All tunables live in **one** config module, `src/domains/token-config.js`:
  `TOKEN_TOTAL_SUPPLY`, `FLUFF_PER_TUMBO`, `REVERSE_WINDOW_TICKS` (1000),
  `VOID_TITHE_BPS` (10), `RIBBON_CAP` (5000), asset metadata.
- No module hardcodes a supply number. No UI quotes a total supply figure
  publicly — the user has not chosen one.

## 3. Accounts

- User/bot: `u:<name>`, `b:<name>`. Created empty or via faucet drip.
- System (no human owner):
  - `sys:treasury` — unallocated TUMBO; funds faucet + rewards.
  - `sys:faucet` — drip source (rate-limited).
  - `sys:escrow` — PENDING two-phase intents (deliver).
  - `sys:vault` — Hibernation Vault deposits, locks, stakes.
  - `sys:void` — The Void. Credited only by burns/tithes. **Never debited.**
  - `sys:market` — market maker; sMIMAS inventory + TUMBO float.
- Savings pockets: `u:<name>:save:<goal>` — separate accounts, same owner.

## 4. Actions

`send | receive | exchange | buy | sell | deliver | tip | stake | save |
deposit | lock | reverse | cancel | unstake | withdraw`
Meta events: `presence` (daily check-in), `ribbon-claim`, `hunger-tick`.

- `deliver` is two-phase: `sys:escrow` hold → receiver confirms or sender cancels.
- `reverse` posts a compensating journal within the reverse window; history is
  never edited. `cancel` only applies to PENDING intents.
- `lock`/`stake`/`deposit` move funds to `sys:vault` with unlock ticks;
  early withdrawal is refused.

## 5. Idempotency and EchoProof receipts

- Every mutation takes a client-supplied **idempotency key** (string, required).
- Replays return the **original receipt** — never a second journal.
- Reusing a key across different intents fails closed (`IDEM_MISMATCH`).
- Every settled action yields an EchoProof receipt:
  `{ id, idem, action, actor, state, entries:[{account, asset, delta}],
     refs, meta, tick, seq, hash, prevHash }`.
- `hash` recomputes from the sealed body; `prevHash` chains unbroken from
  genesis. Any client can verify a receipt independently.

## 6. Invariants (checked on every commit)

1. Non-negativity: every `(account, asset)` balance `>= 0`, safe integer.
2. Double-entry: every journal's entries sum to exactly `0` per asset.
3. Conservation: Σ balances per asset (incl. `sys:void`) equals recorded supply.
4. Escrow integrity: `sys:escrow` balance == Σ PENDING intent amounts.
5. Vault integrity: `sys:vault` balance == Σ open locks/stakes/deposits.
6. Chain integrity: receipts form one unbroken hash chain from genesis.
7. System-account firewall: `sys:treasury`/`sys:market`/`sys:faucet` debited only
   by ledger-internal flows or the system gate; `sys:escrow`/`sys:vault`/
   `sys:void` touched only by ledger-internal flows.

## 7. Quote contract (exchange/buy/sell)

- Quote: `{ id, action, from, to, amountIn, amountOut, expiresAt, hash }`.
- `amountOut` computed with exact integer math; `hash` covers all fields.
- Execution recomputes and compares — forged, tampered, or expired quotes are
  rejected. One quote id executes at most once.
- Market ops pay the 10 bps Void tithe to `sys:void`.

## 8. Facade — `window.TumboToken`

```js
window.TumboToken = {
  ledger,                                   // TumboLedger instance
  config,                                   // token-config.js contents
  balance(accountId, asset) -> fluff,       // integer
  fmt(fluff) -> string,                     // "1.234" TUMBO-SIM
  ensureAccount(id, kind, label),
  act(action, params, idemKey) -> receipt,  // send|tip|stake|... (core)
  quote(action, params) -> quote,           // exchange/buy/sell
  executeQuote(quoteId, idemKey) -> receipt,
  reverse(txId, idemKey) -> receipt,
  cancel(intentId, idemKey) -> receipt,
  verifyReceipt(txId) -> { ok, reason? },
  verifyChain() -> { ok, badSeq? },
  on(evt, cb), off(evt, cb)                 // 'balance-changed' | 'receipt'
}
```

Every settled action also emits:
`document.dispatchEvent(new CustomEvent('tumbo:token',
{ detail: { type: 'balance-changed' | 'receipt', tx, receipt } }))`.

Social tipping bridge: `document` CustomEvent `'tumbo:tip'`
`{ detail: { postId, author, amountFluff } }` — the social block emits, the
token social-UX module listens.

## 9. Gamification

- **Hunger Meter:** per-user decaying meter (integer ticks); activity feeds it;
  starvation reduces simulated reward rates only — never touches principal.
- **Proof of Presence:** one idempotency-keyed `presence` meta-event per
  user per day.
- **Burrow Score:** pure deterministic function of ledger history
  (check-ins, tips, locks).
- **Supporter Ribbons:** 5,000 free, non-transferable, one per account,
  recorded on ledger. No monetization, ever.
- **Leaderboard:** Burrow Score ranked, simulated.

## 10. Design laws (all builders, all surfaces)

- One cube style: translucent blue glass cubes with connection lines,
  translucent from the first frame.
- **All 3D in three.js** — repo-pinned r179.1 via the import map. No other 3D
  library, no raw-WebGL cubes, no CSS-3D fakes.
- Everything small by default, opening only on interaction.
- Everything draggable in full 3D; positions remembered (localStorage).
- Single click selects, hover peeks, double-click/double-tap enters the
  block world.
- Minimize collapses to a small translucent chip.
- Fewer panel tabs; every panel body scrolls.
- Desktop 1440×900 and mobile 390×844.
- **Zero real console errors. Zero mobile overflow.** No error walls —
  offline/empty states degrade gracefully.
- "Simulated points only — never real money or wagering." on every token surface.

## 11. Acceptance checklist (per part)

- [ ] Branch from main, PR opened, never merged by the builder.
- [ ] Builds to this contract — no drift (naming, units, events, receipts).
- [ ] Tests: happy path + fail-closed paths (insufficient funds, replays,
      forgeries, expired quotes, double-release, tamper).
- [ ] Live check: desktop 1440×900 + mobile 390×844, zero console errors,
      zero overflow.
- [ ] Every user-facing string labels TUMBO-SIM as simulated.
- [ ] No secrets, keys, credentials, or real-money language anywhere.
