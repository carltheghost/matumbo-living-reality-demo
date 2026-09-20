# Token PR Cross-Review and Consolidation Plan

**Date:** 2026-09-20 | **Reviewer:** token-review workstream | **Baseline:** `docs/TOKEN-CONTRACT.md` on `main` (canonical v1): 1 TUMBO-SIM = 1,000 fluff; `REVERSE_WINDOW_TICKS`=1000; `VOID_TITHE_BPS`=10; `RIBBON_CAP`=5000; config in `src/domains/token-config.js`; accounts `u:<name>`/`b:<name>`/`sys:*`; idempotency keys + `IDEM_MISMATCH`; EchoProof hash chain; `tumbo:token`/`tumbo:tip` events; three.js r179.1 only; simulated labels everywhere.

## Verdicts

| PR | Branch | Verdict |
|----|--------|---------|
| #6 `agent/token-unified` — unified token core | **needs-work** — 1 required fix (`lock()` must target `sys:vault`), then ship |
| #1 `grok/token-docs` — docs + constitution wiring | **needs-work** — 3 constant values drift from canonical (3-line fix) |
| #5 `gpt/token-lifecycle` — reverse/cancel/history | **needs-work** — rebase onto #6's `token.js`; logic is solid |
| #2 `grok/token-buy-sell` — buy/sell panels | **needs-work** — restore truncated `feature-navigator.js`; delete stub `token.js`; rebase onto #6 |
| #9 `grok/token-social-ux` — social tipping + delivery | **ship-with-notes** — merge after #6; consolidate fallback ledger |
| #8 `grok/token-security` — adversarial test suite | **ship-with-notes** — merge after #6; fix 1 probe to expect `IDEM_MISMATCH` |
| #7 `grok/token-mobile` — mobile pass 390x844 | **ship** |
| #3 `gpt/token-exchange`, #4 `gpt/token-block-ui` | **superseded by #6 — close without merging** |

**Blockers:** none for real-money/wagering/custody language — all surfaces label themselves simulated. No secrets/keys in any diff.

## PR #6 — needs-work (1 required fix)

**Part-A invariants confirmed preserved:** exact BigInt `mulDivFloor`, 1 TUMBO-SIM = 1000 fluff (`token.js:10`,`:38`); idempotency keys required, replay returns original (`:209-213`); journals sum to 0/asset (`:233-235`), non-negativity (`:243-245`); `sys:void` never debited (`:223-228`), credited only via `_creditVoid` tithe|burn (`:248-254`); quote engine — hash recompute + expiry + single-execution + 10bps tithe (`:433-500`); `'tumbo:token'` CustomEvent (`:578-580`). Adapter: `'you'`→`'u:you'`, `'TUMBO-SIM'`→`'TUMBO'`, `FLUFF_PER_TUMBO_SIM=1000` (canonical); `simulation:true` everywhere. 3D (`token-block.js`): three.js only via injected pinned module; glass-style builders; small (0.95); draggable + localStorage; click/hover/double-click; minimize chip; 4 tabs, scrolling bodies; mobile MQ; simulated labels; try/catch `main.js` mount.

**Required fix:** `TumboUserLedger.lock()` → `sys:escrow` (~`:719`,`:913`); contract §4/invariant 5 require **`sys:vault`**. One-line fix.

**Follow-ups:** config in `token.js` `CONFIG` (`:35-51`), contract §2 wants `src/domains/token-config.js`; no `IDEM_MISMATCH` (`:209-213`) — port from `ledger-core`; no EchoProof hash chain (`:259-272`) — port #5's SHA-256; supply `10_000_000_000` vs #5's `1_000_000_000_000` — reconcile; float in `tumboSimToFluff` — use decimal strings; `_emitBoth` → private `_engine._emit`; `main.js` static imports — consider dynamic `import()`; **3D never verified on a WebGL device — required manual check (1440x900 + 390x844, zero console errors/overflow).**

## PR #1 — needs-work (value drift; keep canonical)

`src/domains/token-config.js`: `:35` `FLUFF_PER_TUMBO = 1_000_000` → **1,000**; `:38` `REVERSE_WINDOW_TICKS = 24*60` (1440) → **1000**; `:45` `VOID_TITHE_BPS = 50` → **10**. Three-line fix, then ship. Sweep `docs/TOKEN.md` too. (`TUMBO_MAX_SUPPLY = null` UNDECIDED is correct.)

## PR #5 — needs-work (rebase onto #6)

Logic is faithful (compensating journals, 1000-tick window, deterministic reverse/cancel keys, no double-reverse, cancel fails closed, SHA-256 `verifyChain`/`verifyJournal`, `simulation:true`, `sys:void` never debited). **Blockers:** second `src/domains/token.js` (exports `TOKEN_CONFIG`; #6 exports `CONFIG`); `token-lifecycle.js:16` imports `TOKEN_CONFIG` → breaks under #6; supply `1_000_000_000_000` vs #6 `10_000_000_000`; its `lock`→`sys:escrow` (must be `sys:vault`); no `IDEM_MISMATCH`. **Path:** merge #6, rebase #5 — port lifecycle onto unified core, fix import, keep console + tests.

## PR #2 — needs-work

`docs/TOKEN_BUY_SELL_STATUS.md:9-13`: `feature-navigator.js` truncated by bad push — restore; `main.js` wiring not in PR. Fourth `src/domains/token.js` (STUB, 1:1 quotes, `amt % 7777` quirk) — delete, rewire panels to #6's quote engine (stub lacks idempotency + single-execution). Reconcile #7's "no buy/sell surfaces" copy.

## PR #9 — ship-with-notes

Two-phase deliver (escrow → receiver-confirm/sender-cancel), idempotent tips, EchoProof receipts + prevHash chain, `'tumbo:tip'` `{postId, author, amountFluff}` per contract, `FLUFF_PER_TUMBO=1000`, `simulation:true`, defensive `window.TumboToken` layering. Renderer: three.js glass cube, small, pose persisted, chip, scrolling body, mobile MQ, simulated labels. After #6: consolidate fallback mini-ledger (`token-social-ux.js:110-443`); FNV-1a → SHA-256; no `IDEM_MISMATCH`; `onHover()` stub, no cube 3D-drag (minor).

## PR #8 — ship-with-notes

Strong adversarial suite (forged/replay/expired quotes, cross-intent idempotency, sys firewall, double-release, bad amounts, tamper, double-reverse), honest PASS/FAIL/SKIP. After #6. Fix: cross-intent probe must expect `IDEM_MISMATCH` (contract §5), not "return original receipt".

## PR #7 — ship

2 files, ≤700px only: `token-mobile.css` + `<link>` in `index.html`. Documented zero-overflow/44px targets. Ship as-is.

## Branches without PRs

- `gpt/token-ledger-core`: reference spec/prototype, canonical values, has `IDEM_MISMATCH` + chain + firewall + `lock`→`sys:vault`. Don't merge as root files — port pieces into unified core. Spec quotes 420B TUMBO/21M sMIMAS (contract: undecided) — mark provisional.
- `gpt/token-transfers`: 5th standalone ledger + UI + tests + CI (green). PR after #6, port engine onto unified core.
- `gpt/token-vault`, `gpt/token-gamification`: empty. `grok/token-ticker`: no commits. Build on unified core post-#6.

## Consolidation plan

1. **Ledgers (5→1):** #6 `token.js` canonical. Absorb #5's chain+reverse/cancel, `ledger-core`'s `IDEM_MISMATCH`+gates, transfers engine. Delete #2's stub, #5's variant, #9's fallback (or document).
2. **Config (2→1):** #1's `token-config.js` (fixed) is single source; #6's `CONFIG` imports from it.
3. **Hash (3→1):** standardize #5's `sha256Hex`; replace #9's FNV-1a.
4. **Supply:** reconcile `#6:10_000_000_000` vs `#5:1_000_000_000_000` vs spec 420B (contract: undecided — keep out of UI).
5. **Facade:** one `window.TumboToken` installer (#6's + `reverse`/`cancel`/`verifyChain`).

## Merge order

1. #1 (3-line fix) + #7 — independent. 2. #6 (`lock()` fix + WebGL check) — foundation; close #3/#4. 3. #8 (after #6; fix probe). 4. #9 (after #6; consolidate). 5. #5 (after #6; rebase). 6. #2 (after #6; restore + rewire). 7. Follow-ups: transfers PR, `ledger-core` ports, vault/gamification/ticker.
