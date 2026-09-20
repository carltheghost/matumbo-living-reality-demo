/**
 * TUMBO-SIM token tunables — SINGLE SOURCE OF TRUTH.
 *
 * Every module that needs supply, fees, windows, or genesis ribbon limits
 * MUST import from this file. Do not hardcode those numbers elsewhere.
 *
 * Simulation only. No real money, no custody, no wallets, no signing.
 * Standing public commitment: "Simulated points only — never real money or wagering."
 */

/**
 * Constitutional max supply.
 * UNDECIDED — the user has not chosen a public supply figure.
 * Do not invent, quote, or render this value in any user-facing UI.
 * Keep null until an explicit product decision is recorded.
 */
export const TUMBO_MAX_SUPPLY = null;

/**
 * Demo / rehearsal fixture only (existing projection math for launch receipt
 * and distribution registry). This is NOT a public commitment and MUST NOT
 * be shown as "the" supply in UI copy. Used solely so deterministic
 * reconciliation tests and local projections continue to add up.
 */
export const DEMO_REHEARSAL_SUPPLY_UNITS = 1_000_000_000;

/** Total basis points for allocation schedules (100% = 10_000). */
export const TUMBO_TOTAL_BASIS_POINTS = 10_000;

/**
 * Micro-units per TUMBO-SIM (constitution draft uses 6 dp; ledger-core Money
 * currently uses 8). Prefer reading this constant rather than hardcoding.
 * "Fluff" = human-facing display scale for micro-actions.
 */
export const FLUFF_PER_TUMBO = 1_000_000; // 10^-6 style micro-units for micro-actions

/** Reverse window: sender may reverse a send/tip within this many sim ticks. */
export const REVERSE_WINDOW_TICKS = 24 * 60; // 24 sim-hours if 1 tick = 1 sim-minute

/**
 * Void tithe in basis points applied to market fees that route to the Void
 * (burn address). Example: half of a 1% market fee → 50 bps of the notional
 * if the fee is 100 bps total; adjust policy via this single knob.
 */
export const VOID_TITHE_BPS = 50;

/**
 * Genesis / Burrow Rights ribbon cap: maximum number of simulated genesis
 * passes claimable in the demo (Article 4 of the constitution draft).
 */
export const RIBBON_CAP = 5000;

/** Unit label used everywhere in the demo. */
export const TUMBO_UNIT = "TUMBO-SIM";

/** Symbol (display only). */
export const TUMBO_SYMBOL = "TUMBO";

/** Standing public commitment — include on every token UI surface. */
export const TUMBO_PUBLIC_COMMITMENT =
  "Simulated points only — never real money or wagering.";

/** Hard non-goals encoded from risk notes (do not implement). */
export const TUMBO_NON_GOALS = Object.freeze([
  "No fiat on/off ramps",
  "No real custody",
  "No real wallets or signing",
  "No real issuance, sale, or airdrop",
  "No redemption or buyback promises",
  "No convertibility to anything of real-world value",
]);

export default {
  TUMBO_MAX_SUPPLY,
  DEMO_REHEARSAL_SUPPLY_UNITS,
  TUMBO_TOTAL_BASIS_POINTS,
  FLUFF_PER_TUMBO,
  REVERSE_WINDOW_TICKS,
  VOID_TITHE_BPS,
  RIBBON_CAP,
  TUMBO_UNIT,
  TUMBO_SYMBOL,
  TUMBO_PUBLIC_COMMITMENT,
  TUMBO_NON_GOALS,
};
