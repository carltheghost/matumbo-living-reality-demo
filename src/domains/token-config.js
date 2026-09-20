/**
 * TUMBO-SIM token config — the ONE module that owns every tunable.
 *
 * Units: integer fluff. 1 TUMBO-SIM = 1,000 fluff. Exact integer math only.
 * No other module hardcodes a supply number, rate, cap, or weight.
 *
 * Nothing here is money: TUMBO-SIM is simulated demo points only — never
 * real money, wagering, custody, wallets, or chains.
 */

export const TOKEN_CONFIG_VERSION = 1;

/** Integer fluff per 1 TUMBO-SIM. */
export const FLUFF_PER_TUMBO = 1000;

/**
 * Total TUMBO supply in fluff (safe integer). Internal conservation anchor
 * only — never quoted publicly; the user has not chosen a public figure.
 */
export const TOKEN_TOTAL_SUPPLY = 1_000_000_000_000;

/** Total sMIMAS supply in fluff (safe integer). Internal only. */
export const SMIMAS_TOTAL_SUPPLY = 100_000_000_000;

/** TUMBO float allocated to the simulated market maker, in fluff. */
export const MARKET_TUMBO_FLOAT = 10_000_000_000;

/** sMIMAS float allocated to the simulated market maker, in fluff. */
export const MARKET_SMIMAS_FLOAT = 10_000_000_000;

/** Faucet bootstrap allocation, in fluff. */
export const FAUCET_BOOTSTRAP_FLUFF = 1_000_000_000;

/** Reverse window, in ledger ticks. */
export const REVERSE_WINDOW_TICKS = 1000;

/** Void tithe on market ops, in basis points (10 bps = 0.1%). */
export const VOID_TITHE_BPS = 10;

/** Quote time-to-live, in ledger ticks. */
export const QUOTE_TTL_TICKS = 50;

/** Supporter ribbon cap. Ribbons are free, non-transferable, non-monetized. */
export const RIBBON_CAP = 5000;

/** Fixed simulated market rate: 1 TUMBO = 100 sMIMAS (exact rational). */
export const MARKET_RATE = Object.freeze({ num: 100, den: 1 });

export const ASSETS = Object.freeze({
  TUMBO: Object.freeze({
    code: "TUMBO",
    label: "TUMBO-SIM",
    kind: "native",
    decimals: 3,
    simulation: true,
    note: "Simulated points only — never real money or wagering.",
  }),
  sMIMAS: Object.freeze({
    code: "sMIMAS",
    label: "sMIMAS (synthetic demo asset)",
    kind: "synthetic",
    decimals: 3,
    simulation: true,
    note: "Simulated points only — never real money or wagering.",
  }),
});

export const SYSTEM_ACCOUNTS = Object.freeze([
  "sys:treasury",
  "sys:faucet",
  "sys:escrow",
  "sys:vault",
  "sys:void",
  "sys:market",
]);

/** Faucet drip per account per simulated day, in fluff (50 TUMBO-SIM). */
export const FAUCET_DRIP_FLUFF = 50 * FLUFF_PER_TUMBO;
export const FAUCET_DRIPS_PER_DAY = 1;

/* ---------------- Infinite Burrow gamification ---------------- */

/** Hunger meter bounds, in integer points. */
export const HUNGER_MAX = 100;
export const HUNGER_DECAY_PER_TICK = 1;
/** At or below this level the burrow is starving: simulated rewards dip. */
export const HUNGER_STARVATION_THRESHOLD = 20;
/** Hunger feed per settled action (integer points). */
export const HUNGER_FEED = Object.freeze({
  presence: 30,
  "ribbon-claim": 15,
  tip: 6,
  lock: 12,
  stake: 8,
  deposit: 8,
  buy: 10,
  sell: 10,
  exchange: 10,
  send: 3,
  receive: 2,
  save: 4,
  deliver: 5,
  "hunger-tick": 0,
});
/**
 * Simulated-reward penalty while starved, in basis points of the reward.
 * Applies to simulated rewards only — never to principal.
 */
export const STARVED_REWARD_PENALTY_BPS = 500;

/** Burrow Score weights — a pure function of ledger history. */
export const SCORE_PER_CHECKIN = 25;
export const SCORE_PER_TIP_TUMBO = 1;
export const SCORE_PER_LOCK_TUMBO = 2;
export const SCORE_RIBBON_BONUS = 50;

export const LEADERBOARD_SIZE = 25;
