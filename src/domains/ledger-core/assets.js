/**
 * Major crypto assets held by the Quark Wallet (ledger-core).
 *
 * Ported from TumboAgent PR #6 (`matumbo/core/assets.py`, tag
 * archive/pr-6-claude-matumbo-master-spec-mz1vv4).
 *
 * These are NOT new native coins — TUMBO remains the only native
 * cryptocurrency in maTumbo. Each entry here is a platform-held,
 * demo-labeled representation of a major external cryptocurrency, sharing
 * TUMBO's exact decimal-safe integer-base-unit model (8 dp).
 * In DEMO mode balances are seeded, never bridged to a real chain.
 * Real custody (deposit addresses, withdrawal, chain monitoring) does not
 * exist here — simulation-only.
 */

import { Currency } from "./money.js?v=20260922-cache2";

export const MAJOR_CRYPTOS = Object.freeze({
  BTC: new Currency("BTC", 8),
  ETH: new Currency("ETH", 8),
  BNB: new Currency("BNB", 8),
  SOL: new Currency("SOL", 8),
  XRP: new Currency("XRP", 8),
  ADA: new Currency("ADA", 8),
  DOGE: new Currency("DOGE", 8),
  DOT: new Currency("DOT", 8),
  LTC: new Currency("LTC", 8),
});
