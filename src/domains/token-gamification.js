/**
 * TUMBO-SIM token gamification — the Infinite Burrow.
 *
 * Hunger Meter, Proof of Presence, Burrow Score, Supporter Ribbons, and a
 * simulated ranked leaderboard. Every value derives from the canonical
 * TUMBO-SIM ledger (src/domains/token.js) and the single config module
 * (src/domains/token-config.js); nothing here invents balances or supply.
 *
 * Integer math only. Starvation trims simulated rewards — never principal.
 * Simulated points only — never real money or wagering.
 */

import {
  FLUFF_PER_TUMBO,
  HUNGER_MAX,
  HUNGER_DECAY_PER_TICK,
  HUNGER_STARVATION_THRESHOLD,
  HUNGER_FEED,
  STARVED_REWARD_PENALTY_BPS,
  SCORE_PER_CHECKIN,
  SCORE_PER_TIP_TUMBO,
  SCORE_PER_LOCK_TUMBO,
  SCORE_RIBBON_BONUS,
  LEADERBOARD_SIZE,
  RIBBON_CAP,
} from "./token-config.js";
import { TumboLedger, TokenError, mulDivFloor } from "./token.js";

export const GAMIFICATION_VERSION = 1;
export const GAMIFICATION_SOURCE = "tumbo-token-gamification";
export const SIM_BOUNDARY_NOTE =
  "Simulated points only \u2014 never real money or wagering.";

/** Ledger ticks of decay settled by one explicit "a day passes" step. */
export const SIM_DAY_TICKS = 24;

/* ---------------- validation ---------------- */

function assertHunger(value, field = "hunger") {
  if (!Number.isSafeInteger(value) || value < 0 || value > HUNGER_MAX) {
    throw new TokenError(
      `${field} must be an integer 0..${HUNGER_MAX}`,
      "INVALID_HUNGER",
    );
  }
  return value;
}

function assertTicks(value, field = "ticks") {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TokenError(
      `${field} must be a safe non-negative integer`,
      "INVALID_TICKS",
    );
  }
  return value;
}

function clampHunger(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(HUNGER_MAX, Math.trunc(value)));
}

/* ---------------- Hunger Meter (pure) ---------------- */

/**
 * Exact integer decay: hunger drops HUNGER_DECAY_PER_TICK per elapsed ledger
 * tick, floored at 0. Never multiplies into unsafe-integer territory: any
 * elapsed span at/above the starvation bound returns 0 directly.
 */
export function hungerAfterDecay(hunger, ticksElapsed) {
  assertHunger(hunger);
  assertTicks(ticksElapsed, "ticksElapsed");
  if (ticksElapsed === 0) return hunger;
  if (ticksElapsed >= Math.ceil(HUNGER_MAX / HUNGER_DECAY_PER_TICK)) return 0;
  const decay = ticksElapsed * HUNGER_DECAY_PER_TICK;
  if (!Number.isSafeInteger(decay)) return 0;
  return Math.max(0, hunger - decay);
}

/** Feed the meter after a settled action; capped at HUNGER_MAX. */
export function hungerAfterFeed(hunger, action) {
  assertHunger(hunger);
  const feed = HUNGER_FEED[action] ?? 0;
  if (!Number.isSafeInteger(feed) || feed < 0) {
    throw new TokenError(`invalid feed for action: ${action}`, "INVALID_FEED");
  }
  return Math.min(HUNGER_MAX, hunger + feed);
}

/** Feed points granted by one settled action (0 for unknown actions). */
export function feedForAction(action) {
  return HUNGER_FEED[action] ?? 0;
}

/** Starving at or below the configured threshold. */
export function isStarved(hunger) {
  assertHunger(hunger);
  return hunger <= HUNGER_STARVATION_THRESHOLD;
}

/**
 * Starvation trims a simulated reward by STARVED_REWARD_PENALTY_BPS — exact
 * integer math via mulDivFloor. Principal is never an input here and can
 * never be reduced by this function.
 */
export function applyStarvedRewardPenalty(rewardFluff, hunger) {
  if (!Number.isSafeInteger(rewardFluff) || rewardFluff < 0) {
    throw new TokenError(
      "reward must be a safe non-negative integer fluff amount",
      "INVALID_AMOUNT",
    );
  }
  assertHunger(hunger);
  if (!isStarved(hunger)) {
    return { reward: rewardFluff, penalty: 0, starved: false };
  }
  const penalty = mulDivFloor(rewardFluff, STARVED_REWARD_PENALTY_BPS, 10000);
  return { reward: rewardFluff - penalty, penalty, starved: true };
}

/* ---------------- Proof of Presence ---------------- */

/** Deterministic idempotency-key helper for one daily check-in. */
export function presenceDayKey(account, day) {
  if (typeof account !== "string" || account.trim() === "") {
    throw new TokenError("account must be a non-empty string", "INVALID_PARAM");
  }
  if (!Number.isSafeInteger(day) || day < 1) {
    throw new TokenError("day must be a safe integer >= 1", "INVALID_PARAM");
  }
  return `presence:${account.trim()}:day-${day}`;
}

/* ---------------- Burrow Score (pure) ---------------- */

/** Whole TUMBO-SIM units in a fluff amount; sub-TUMBO dust scores nothing. */
export function wholeTumbo(fluff) {
  if (!Number.isSafeInteger(fluff) || fluff < 0) {
    throw new TokenError(
      "fluff must be a safe non-negative integer",
      "INVALID_AMOUNT",
    );
  }
  return Math.trunc(fluff / FLUFF_PER_TUMBO);
}

function receiptAmountFluff(receipt) {
  const amount = receipt?.refs?.amount;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

/**
 * Pure deterministic Burrow Score over ledger receipts. Order-independent:
 * check-ins count, tips and locks score per whole TUMBO-SIM moved, and a
 * claimed ribbon adds the configured bonus. Re-evaluating the same history
 * always yields the same score.
 */
export function computeBurrowScore(receipts, { ribbonClaimed = false } = {}) {
  let checkins = 0;
  let tipFluff = 0;
  let lockFluff = 0;
  for (const receipt of receipts ?? []) {
    if (!receipt || typeof receipt !== "object") continue;
    if (receipt.action === "presence") checkins += 1;
    else if (receipt.action === "tip") tipFluff += receiptAmountFluff(receipt);
    else if (receipt.action === "lock") lockFluff += receiptAmountFluff(receipt);
  }
  const tipTumbo = wholeTumbo(tipFluff);
  const lockTumbo = wholeTumbo(lockFluff);
  const ribbonBonus = ribbonClaimed ? SCORE_RIBBON_BONUS : 0;
  const total =
    checkins * SCORE_PER_CHECKIN +
    tipTumbo * SCORE_PER_TIP_TUMBO +
    lockTumbo * SCORE_PER_LOCK_TUMBO +
    ribbonBonus;
  return Object.freeze({
    total,
    checkins,
    tipTumbo,
    lockTumbo,
    ribbonBonus,
    weights: Object.freeze({
      perCheckin: SCORE_PER_CHECKIN,
      perTipTumbo: SCORE_PER_TIP_TUMBO,
      perLockTumbo: SCORE_PER_LOCK_TUMBO,
      ribbonBonus: SCORE_RIBBON_BONUS,
    }),
  });
}

/* ---------------- simulated leaderboard ---------------- */

/**
 * Deterministic ranking: score descending, ties broken by account id
 * ascending, standard competition ranks (1, 2, 2, 4). Simulated only.
 */
export function rankLeaderboard(entries, { size = LEADERBOARD_SIZE } = {}) {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new TokenError(
      "leaderboard size must be a safe integer >= 1",
      "INVALID_PARAM",
    );
  }
  const clean = (entries ?? []).map((entry) => {
    if (!entry || typeof entry.account !== "string" || entry.account.trim() === "") {
      throw new TokenError("leaderboard entries need an account", "INVALID_PARAM");
    }
    if (!Number.isSafeInteger(entry.score) || entry.score < 0) {
      throw new TokenError(
        "leaderboard scores must be safe non-negative integers",
        "INVALID_PARAM",
      );
    }
    return { account: entry.account.trim(), score: entry.score };
  });
  clean.sort(
    (a, b) =>
      b.score - a.score || (a.account < b.account ? -1 : a.account > b.account ? 1 : 0),
  );
  const ranked = [];
  let lastScore = null;
  let lastRank = 0;
  clean.forEach((entry, index) => {
    const rank = entry.score === lastScore ? lastRank : index + 1;
    lastScore = entry.score;
    lastRank = rank;
    ranked.push(Object.freeze({ rank, account: entry.account, score: entry.score }));
  });
  return Object.freeze(ranked.slice(0, size));
}

/* ---------------- hunger replay (pure) ---------------- */

/**
 * Rebuild per-account hunger purely from receipt history: newcomers arrive
 * full, every receipt decays the actor by elapsed ticks then feeds per
 * action, and hunger-tick receipts settle absolute values. Deterministic.
 */
export function replayHunger(receipts) {
  const state = new Map();
  for (const receipt of receipts ?? []) {
    if (!receipt || typeof receipt !== "object") continue;
    const tick =
      Number.isSafeInteger(receipt.tick) && receipt.tick >= 0 ? receipt.tick : 0;
    if (receipt.action === "hunger-tick") {
      const account = receipt.refs?.account ?? receipt.actor;
      if (typeof account !== "string" || account === "") continue;
      state.set(account, { hunger: clampHunger(receipt.meta?.to), lastTick: tick });
      continue;
    }
    const actor = receipt.actor;
    if (typeof actor !== "string" || actor === "" || actor.startsWith("sys:"))
      continue;
    const prev = state.get(actor);
    const lastTick = prev ? prev.lastTick : tick;
    const decayed = hungerAfterDecay(
      prev ? prev.hunger : HUNGER_MAX,
      Math.max(0, tick - lastTick),
    );
    const feed = HUNGER_FEED[receipt.action] ?? 0;
    state.set(actor, {
      hunger: Math.min(HUNGER_MAX, decayed + feed),
      lastTick: tick,
    });
  }
  return state;
}

/* ---------------- gamification service ---------------- */

export class TokenGamification {
  constructor({ ledger = null } = {}) {
    this._ledger = ledger instanceof TumboLedger ? ledger : new TumboLedger();
    this._state = replayHunger(this._ledger.receipts());
    this._unsub = this._ledger.on("receipt", (receipt) =>
      this._noteReceipt(receipt),
    );
  }

  get ledger() {
    return this._ledger;
  }

  _key(account) {
    if (typeof account !== "string" || account.trim() === "") {
      throw new TokenError("account must be a non-empty string", "INVALID_PARAM");
    }
    return account.trim();
  }

  _noteReceipt(receipt) {
    if (!receipt || typeof receipt !== "object") return;
    const tick =
      Number.isSafeInteger(receipt.tick) && receipt.tick >= 0
        ? receipt.tick
        : this._ledger.tick;
    if (receipt.action === "hunger-tick") {
      const account = receipt.refs?.account ?? receipt.actor;
      if (typeof account !== "string" || account === "") return;
      this._state.set(account, {
        hunger: clampHunger(receipt.meta?.to),
        lastTick: tick,
      });
      return;
    }
    const actor = receipt.actor;
    if (typeof actor !== "string" || actor === "" || actor.startsWith("sys:"))
      return;
    const prev = this._state.get(actor);
    const lastTick = prev ? prev.lastTick : tick;
    const decayed = hungerAfterDecay(
      prev ? prev.hunger : HUNGER_MAX,
      Math.max(0, tick - lastTick),
    );
    const feed = HUNGER_FEED[receipt.action] ?? 0;
    this._state.set(actor, {
      hunger: Math.min(HUNGER_MAX, decayed + feed),
      lastTick: tick,
    });
  }

  /** Current hunger; newcomers arrive full, tracked users decay lazily. */
  hungerOf(account) {
    const acct = this._key(account);
    const prev = this._state.get(acct);
    if (!prev) return HUNGER_MAX;
    return hungerAfterDecay(
      prev.hunger,
      Math.max(0, this._ledger.tick - prev.lastTick),
    );
  }

  starvedOf(account) {
    return isStarved(this.hungerOf(account));
  }

  /** Daily proof-of-presence check-in (one per user per day). */
  checkIn(account, idemKey) {
    const acct = this._key(account);
    return this._ledger.act(
      "presence",
      { account: acct, day: this._ledger.day },
      idemKey,
    );
  }

  presenceRecordedToday(account) {
    const acct = this._key(account);
    const day = this._ledger.day;
    return this._ledger
      .receipts()
      .some(
        (receipt) =>
          receipt.action === "presence" &&
          receipt.actor === acct &&
          receipt.meta?.day === day,
      );
  }

  /** Free, non-transferable, non-monetized supporter ribbon (1/account). */
  claimRibbon(account, idemKey) {
    const acct = this._key(account);
    return this._ledger.act("ribbon-claim", { account: acct }, idemKey);
  }

  ribbonOf(account) {
    return this._ledger.ribbonOf(this._key(account));
  }

  ribbonCount() {
    return this._ledger.ribbonCount();
  }

  ribbonCap() {
    return RIBBON_CAP;
  }

  /**
   * Settle accrued tick decay into a hunger-tick meta receipt:
   * from = last settled hunger, to = hunger decayed to the current tick.
   * Exact integer math; the receipt keeps the history auditable.
   */
  applyDecay(account, idemKey) {
    const acct = this._key(account);
    const prev = this._state.get(acct) ?? {
      hunger: HUNGER_MAX,
      lastTick: this._ledger.tick,
    };
    const from = prev.hunger;
    const to = hungerAfterDecay(
      from,
      Math.max(0, this._ledger.tick - prev.lastTick),
    );
    return this._ledger.act("hunger-tick", { account: acct, from, to }, idemKey);
  }

  scoreOf(account) {
    const acct = this._key(account);
    const mine = this._ledger.receipts().filter((r) => r.actor === acct);
    return computeBurrowScore(mine, {
      ribbonClaimed: this._ledger.ribbonOf(acct) != null,
    });
  }

  /** Simulated ranked leaderboard over every non-system actor. */
  leaderboard({ size = LEADERBOARD_SIZE } = {}) {
    const actors = new Set();
    for (const receipt of this._ledger.receipts()) {
      if (receipt.actor && !receipt.actor.startsWith("sys:")) {
        actors.add(receipt.actor);
      }
    }
    return rankLeaderboard(
      [...actors].map((account) => ({
        account,
        score: this.scoreOf(account).total,
      })),
      { size },
    );
  }

  snapshot(account) {
    const acct = this._key(account);
    const hunger = this.hungerOf(acct);
    const score = this.scoreOf(acct);
    const board = this.leaderboard();
    return Object.freeze({
      account: acct,
      hunger,
      starved: isStarved(hunger),
      score,
      ribbon: this.ribbonOf(acct),
      ribbonsClaimed: this.ribbonCount(),
      ribbonCap: RIBBON_CAP,
      presenceToday: this.presenceRecordedToday(acct),
      rank: board.find((row) => row.account === acct)?.rank ?? null,
      tick: this._ledger.tick,
      day: this._ledger.day,
      simulation: true,
      boundary: SIM_BOUNDARY_NOTE,
    });
  }

  destroy() {
    if (typeof this._unsub === "function") this._unsub();
    this._unsub = null;
  }
}

export function createTokenGamification(options = {}) {
  return new TokenGamification(options);
}

/* ---------------- demo seed (idempotent) ---------------- */

const DEMO_BOTS = Object.freeze(["b:bramble", "b:moss", "b:pebble"]);

export function demoBotAccounts() {
  return [...DEMO_BOTS];
}

function attempt(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * Seed a tiny simulated burrow so the ranked leaderboard is demonstrable
 * on first open. Fixed idempotency keys make every step replay-safe.
 * Simulation only.
 */
export function seedDemoBurrow(ledger) {
  if (!(ledger instanceof TumboLedger)) {
    throw new TokenError("seedDemoBurrow needs a TumboLedger", "INVALID_PARAM");
  }
  const seeded = [];
  for (const bot of DEMO_BOTS) {
    const drip = attempt(() => ledger.drip(bot, "TUMBO", `tg-seed-drip-${bot}-d1`));
    if (drip) seeded.push(drip);
    const presence = attempt(() =>
      ledger.act("presence", { account: bot, day: 1 }, `tg-seed-presence-${bot}-d1`),
    );
    if (presence) seeded.push(presence);
  }
  const tip = attempt(() =>
    ledger.act(
      "tip",
      { from: "b:bramble", to: "b:moss", asset: "TUMBO", amount: 5000 },
      "tg-seed-tip-bramble-moss",
    ),
  );
  if (tip) seeded.push(tip);
  const lock = attempt(() =>
    ledger.act(
      "lock",
      { account: "b:moss", asset: "TUMBO", amount: 3000 },
      "tg-seed-lock-moss",
    ),
  );
  if (lock) seeded.push(lock);
  const ribbon = attempt(() =>
    ledger.act("ribbon-claim", { account: "b:bramble" }, "tg-seed-ribbon-bramble"),
  );
  if (ribbon) seeded.push(ribbon);
  return seeded;
}

export default TokenGamification;
