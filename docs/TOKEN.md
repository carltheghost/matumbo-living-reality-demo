# TUMBO-SIM — Token System (Simulation Only)

**Standing public commitment:**

> Simulated points only — never real money or wagering.

This document describes the in-demo token system for maTumbo. Everything here is local, simulated, and non-custodial. There is no real issuance, no real wallets, no signing, no fiat rails, and no convertibility to anything of real-world value.

---

## What TUMBO-SIM is

**TUMBO-SIM** is the unit of *doing things* inside the maTumbo demo. It is earned by presence, spent on world actions, and moved between people and bots — all inside the glass. It is a mascot with a ledger, not a promise of anything outside the demo.

- **Label:** Always shown as TUMBO-SIM (or clearly marked simulated).
- **Scope:** Demo state only. No screen may imply convertibility to fiat, crypto, prizes, or real-world value.
- **Source of truth for tunables:** `src/domains/token-config.js` (supply constant, fluff scale, reverse window, Void tithe, ribbon cap).

Public supply figure: **undecided**. Do not invent or display a max-supply number in UI. The constitutional draft discusses options; product has not chosen a public figure.

---

## Accounts and the ledger

- **One coin, one ledger.** TUMBO-SIM is the single native unit of account in the sim.
- **Atomic double-entry.** Every state change debits one account and credits one account (or the Void). Value is created only by mint (from the world-rewards bucket, ≤ cap) and destroyed only by burn (to the Void).
- **Conservation.** Sum of balances + locked + staked + Void burned equals minted, and minted never exceeds the configured cap.
- **Append-only log.** Balances are derived by folding the event log. Nothing is edited or deleted; reversals are compensating entries.
- **Integer micro-units.** Amounts are integers (no float drift). See `FLUFF_PER_TUMBO` in token-config for the micro-unit scale used for micro-actions.
- **Deterministic and local.** Same seed + same action sequence = same state. No network, no oracles, no real signing. Replayable for tests.

---

## EchoProof receipts

Every executed action emits an **EchoProof** receipt:

`receipt_id = hash(prev_receipt_hash ‖ actor ‖ action ‖ params ‖ sim_timestamp ‖ nonce)`

Receipts chain (each commits to the previous), so history is tamper-evident. They are shown in-world and can be exported in audit dumps. A receipt proves what happened *in the demo*, nothing more. Receipts are labeled simulated.

---

## The 13 actions

All actions settle against the ledger invariants and emit EchoProof receipts.

### Peer movement

1. **send** — Transfer TUMBO-SIM to another account. Zero tax. Cooldown / per-wallet caps only during a short launch window if enabled.
2. **receive** — Inbound credit on send finality. Receivers can auto-reject from in-world blocklisted addresses.
3. **tip** — A send with social metadata (message, context). Minimum 1 micro-unit; zero tax; feeds Proof of Presence leaderboards.

### Market (sim-credits only)

4. **buy** — Purchase TUMBO-SIM from the in-world AMM using sim-credits. Deterministic constant-product quote. Fee split: part to Void (burn), part to treasury.
5. **sell** — Sell TUMBO-SIM back to the pool. Same fee split, plus any launch-window decaying exit fee. No real-world redemption exists or is implied.
6. **exchange** — Swap TUMBO-SIM for other in-world assets (Relics, Arena stakes, bot compute) at posted sim rates. Atomic: both legs settle or neither does.

### Conditional / bot money (x402-style)

7. **deliver** — Escrowed transfer released on condition. In-sim flow for bots/agents: request → quote in TUMBO-SIM → authorize from deposit escrow → verify → release with EchoProof.
8. **deposit** — Move funds into an escrow earmarked for a named counterparty or bot. Funds stay the depositor’s until deliver or cancel.

### Time and yield (no infinite APY)

9. **stake** — Deposit into the **Hibernation Vault** for a fixed term. Rewards come from a fixed world-rewards tranche, never minted on demand. Early exit forfeits rewards (principal returns). Accrues **Burrow Score** (non-transferable reputation weight).
10. **save** — Earmarked balance, instant withdraw, no yield. Pure budgeting.
11. **lock** — Time-lock any balance with a visible unlock schedule (vesting, commitments, Arena contracts).

### Undo

12. **reverse** — Within the reverse window (`REVERSE_WINDOW_TICKS` in token-config), the sender may open a reversal of a send or tip; executes as a compensating entry only if funds are still unencumbered at the receiver. Otherwise the request expires with a receipt explaining why.
13. **cancel** — Voids a pending, unexecuted intent (open deliver escrows, unfilled limit orders, unclaimed tips). No compensating entry needed. Always free for the intent’s creator.

---

## Hunger Meter, Vault, Void, Proof of Presence

- **Void** — The burn address. Every burn is permanent world history (visualized in-world). Burn culture as lore, not price manipulation.
- **Hunger Meter** — Activity-linked sinks (market fee split, micro-fee on exchange, world-spending sinks such as Arena entry and bot compute). Sinks scale with activity; they are never allowed to exceed inflow from the world-rewards bucket over a rolling window (auditor-enforced) so the economy cannot be sink-starved.
- **Hibernation Vault** — Fixed-term staking with fixed reward tranches and Burrow Score accrual. No infinite APY.
- **Proof of Presence** — Distinct meaningful in-world actions earn activity weight (and can gate genesis-style experiments). Anti-farm: diminishing returns on repeated identical actions. Never minted on a pure timer.

Tunables for Void tithe (bps), reverse window, and genesis ribbon cap live in `src/domains/token-config.js`.

---

## Hard non-goals (from risk notes)

These are intentionally **not** implemented and must not be added to the demo:

- No fiat on/off ramps
- No real custody
- No real wallets or signing
- No real issuance, sale, or airdrop
- No redemption or buyback promises
- No convertibility to anything of real-world value

Mascot framing is culture, not a legal shield. Simulation tonight; any real token would be a separate project with licensed counsel, entity, and compliance — not authorized by this document or the demo.

---

## Where the numbers live

| Concern | Location |
|--------|----------|
| Tunables (supply constant, fluff, reverse window, Void tithe, ribbon cap) | `src/domains/token-config.js` |
| Launch allocation projection (demo fixture) | `src/domains/asset-token.js` |
| Aggregate recipient registry | `src/domains/distribution-registry.js` |
| Decimal-safe Money helper | `src/domains/ledger-core/money.js` |
| EchoProof / ledger core | `src/domains/ledger-core/` |
| Launch rehearsal receipt UI | `src/render/launch-receipt.js` |

**Public max supply is undecided (`TUMBO_MAX_SUPPLY = null`).** Demo projection math may use an internal rehearsal fixture for reconciliation only; that fixture is not a public commitment and must not be presented as “the” supply in user-facing copy.

---

*Informational only. Not legal advice. Simulation-first; no real token designed or authorized.*
