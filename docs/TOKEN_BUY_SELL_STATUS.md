# Token buy/sell panels (workstream 8) — branch status

## Delivered on `grok/token-buy-sell`

- `src/domains/token.js` — **STUB WIRING** (did not exist on main). Integer fluff units (1 display unit = 1000 fluff), `TOKEN_SUPPLY_CONFIG` single constant, `window.TumboToken` facade, `tumbo:token` CustomEvents, simulated quotes + 10 bps Void tithe on settle.
- `src/render/token-trade.js` — Buy (sMIMAS→TUMBO) and Sell (TUMBO→sMIMAS) `<aside>` consoles: amount input, quote + live expiry countdown, confirm with Void tithe line, receipt toast, minimize chip, drag + localStorage position, Escape close, mobile bottom sheet, **SIMULATED — not real money** labels everywhere. Null quote → clean empty state (never error wall).
- `tests/token-quote-expiry.test.mjs` — **12/12 pass** (quote expiry → re-quote; countdown zero disables confirm; expired confirm rejected + refresh; void tithe).

## Known issue (must fix before merge)

`src/render/feature-navigator.js` was accidentally truncated during an automated push. **Restore the full file from `main` (commit `93bdef3e…`) and re-apply the `token-buy` / `token-sell` FEATURE_DEFINITIONS + FEATURE_HANDOFF_LINKS entries** before merging.

`src/main.js` wiring (import, console mount, portal openers, feature select branches) is prepared locally but not yet on the remote branch due to file size limits in the automation path.

## Simulation boundary

Every surface is projection-only. No wallet, custody, signing, settlement, real money, or external transfer.
