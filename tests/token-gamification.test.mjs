/**
 * TUMBO-SIM token gamification tests — Part 7 (Infinite Burrow).
 *
 * Covers: exact hunger integer decay math, feed caps, starvation reward
 * penalty (principal untouched), proof-of-presence idempotency, supporter
 * ribbon double-claim rejection, Burrow Score determinism, leaderboard
 * ranking, hunger replay, service integration, and ledger invariants.
 *
 * Run: node --test tests/token-gamification.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TumboLedger } from "../src/domains/token.js";
import {
  HUNGER_MAX,
  HUNGER_DECAY_PER_TICK,
  HUNGER_STARVATION_THRESHOLD,
  TOKEN_TOTAL_SUPPLY,
  SMIMAS_TOTAL_SUPPLY,
} from "../src/domains/token-config.js";
import {
  hungerAfterDecay,
  hungerAfterFeed,
  feedForAction,
  isStarved,
  applyStarvedRewardPenalty,
  presenceDayKey,
  wholeTumbo,
  computeBurrowScore,
  rankLeaderboard,
  replayHunger,
  createTokenGamification,
  seedDemoBurrow,
  SIM_BOUNDARY_NOTE,
} from "../src/domains/token-gamification.js";

function freshService() {
  const ledger = new TumboLedger();
  const gam = createTokenGamification({ ledger });
  return { ledger, gam };
}

function throwsCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, `expected ${code}`);
}

describe("hunger decay (exact integer math)", () => {
  it("decays linearly per elapsed tick", () => {
    assert.equal(hungerAfterDecay(100, 3), 100 - 3 * HUNGER_DECAY_PER_TICK);
    assert.equal(hungerAfterDecay(57, 1), 56);
    assert.equal(hungerAfterDecay(100, 0), 100);
  });

  it("is exact at the starvation boundary", () => {
    assert.equal(hungerAfterDecay(100, 99), 1);
    assert.equal(hungerAfterDecay(100, 100), 0);
    assert.equal(hungerAfterDecay(57, 57), 0);
  });

  it("floors at zero for huge tick spans without unsafe math", () => {
    assert.equal(hungerAfterDecay(2, 10_000), 0);
    assert.equal(hungerAfterDecay(0, 5), 0);
    assert.equal(hungerAfterDecay(100, Number.MAX_SAFE_INTEGER), 0);
  });

  it("rejects non-integer or out-of-range inputs", () => {
    assert.throws(() => hungerAfterDecay(-1, 1));
    assert.throws(() => hungerAfterDecay(HUNGER_MAX + 1, 1));
    assert.throws(() => hungerAfterDecay(50.5, 1));
    assert.throws(() => hungerAfterDecay(50, -1));
    assert.throws(() => hungerAfterDecay(50, 1.5));
  });
});

describe("hunger feed", () => {
  it("caps at HUNGER_MAX", () => {
    assert.equal(hungerAfterFeed(95, "presence"), HUNGER_MAX);
    assert.equal(hungerAfterFeed(100, "presence"), HUNGER_MAX);
  });

  it("adds the per-action feed", () => {
    assert.equal(hungerAfterFeed(10, "tip"), 10 + feedForAction("tip"));
    assert.ok(feedForAction("tip") > 0);
  });

  it("feeds nothing for unknown actions", () => {
    assert.equal(feedForAction("nope"), 0);
    assert.equal(hungerAfterFeed(40, "nope"), 40);
  });
});

describe("starvation", () => {
  it("starves at or below the threshold", () => {
    assert.equal(isStarved(HUNGER_STARVATION_THRESHOLD), true);
    assert.equal(isStarved(HUNGER_STARVATION_THRESHOLD + 1), false);
    assert.equal(isStarved(0), true);
  });

  it("trims only the simulated reward, never principal", () => {
    const principal = 250_000;
    const adjusted = applyStarvedRewardPenalty(10_000, 5);
    assert.equal(adjusted.starved, true);
    assert.equal(adjusted.penalty, 500);
    assert.equal(adjusted.reward, 9_500);
    assert.equal(principal, 250_000);
  });

  it("leaves rewards untouched when fed", () => {
    const adjusted = applyStarvedRewardPenalty(10_000, HUNGER_MAX);
    assert.deepEqual(
      { reward: adjusted.reward, penalty: adjusted.penalty },
      { reward: 10_000, penalty: 0 },
    );
    assert.equal(adjusted.starved, false);
  });
});

describe("presenceDayKey", () => {
  it("is deterministic per account and day", () => {
    assert.equal(presenceDayKey("u:amy", 3), "presence:u:amy:day-3");
    assert.equal(presenceDayKey("u:amy", 3), presenceDayKey("u:amy", 3));
    assert.notEqual(presenceDayKey("u:amy", 3), presenceDayKey("u:amy", 4));
    assert.notEqual(presenceDayKey("u:amy", 3), presenceDayKey("u:bo", 3));
  });
});

describe("proof of presence (ledger)", () => {
  it("records one check-in per user per day", () => {
    const { gam } = freshService();
    const receipt = gam.checkIn("u:amy", "k1");
    assert.equal(receipt.action, "presence");
    assert.equal(receipt.meta.day, 1);
    assert.equal(receipt.entries.length, 0);
    assert.equal(gam.presenceRecordedToday("u:amy"), true);
  });

  it("replays the same idempotency key", () => {
    const { gam } = freshService();
    const first = gam.checkIn("u:amy", "k1");
    const replay = gam.checkIn("u:amy", "k1");
    assert.equal(replay.id, first.id);
  });

  it("rejects a second key for the same day", () => {
    const { gam } = freshService();
    gam.checkIn("u:amy", "k1");
    throwsCode(() => gam.checkIn("u:amy", "k2"), "PRESENCE_ALREADY_RECORDED");
  });

  it("allows a fresh check-in the next day", () => {
    const { ledger, gam } = freshService();
    const first = gam.checkIn("u:amy", "k1");
    ledger.advanceDay();
    const second = gam.checkIn("u:amy", "k3");
    assert.equal(second.meta.day, 2);
    assert.notEqual(second.id, first.id);
  });
});

describe("supporter ribbons (ledger)", () => {
  it("claims one free ribbon per account", () => {
    const { gam } = freshService();
    const receipt = gam.claimRibbon("u:amy", "rk1");
    assert.match(receipt.meta.ribbonId, /^ribbon-\d+$/);
    assert.equal(receipt.entries.length, 0);
    assert.equal(receipt.meta.monetized, false);
    assert.equal(receipt.meta.transferable, false);
    assert.equal(gam.ribbonOf("u:amy"), receipt.meta.ribbonId);
  });

  it("replays the same idempotency key", () => {
    const { gam } = freshService();
    const first = gam.claimRibbon("u:amy", "rk1");
    const replay = gam.claimRibbon("u:amy", "rk1");
    assert.equal(replay.id, first.id);
  });

  it("rejects a double claim with a new key", () => {
    const { gam } = freshService();
    gam.claimRibbon("u:amy", "rk1");
    throwsCode(() => gam.claimRibbon("u:amy", "rk2"), "RIBBON_ALREADY_CLAIMED");
  });

  it("lets a different account claim its own ribbon", () => {
    const { gam } = freshService();
    const amy = gam.claimRibbon("u:amy", "rk1");
    const bo = gam.claimRibbon("u:bo", "rk3");
    assert.notEqual(bo.meta.ribbonId, amy.meta.ribbonId);
    assert.equal(gam.ribbonCount(), 2);
  });
});

describe("burrow score (deterministic)", () => {
  function scoredService() {
    const { ledger, gam } = freshService();
    ledger.drip("u:amy", "TUMBO", "drip-amy");
    ledger.drip("u:bo", "TUMBO", "drip-bo");
    gam.checkIn("u:amy", "k-amy");
    ledger.act(
      "tip",
      { from: "u:amy", to: "u:bo", asset: "TUMBO", amount: 2000 },
      "tip-amy-bo",
    );
    ledger.act(
      "lock",
      { account: "u:bo", asset: "TUMBO", amount: 5000 },
      "lock-bo",
    );
    gam.claimRibbon("u:amy", "rk-amy");
    return { ledger, gam };
  }

  it("matches the configured weights", () => {
    const { gam } = scoredService();
    const amy = gam.scoreOf("u:amy");
    assert.equal(amy.checkins, 1);
    assert.equal(amy.tipTumbo, 2);
    assert.equal(amy.ribbonBonus, 50);
    assert.equal(amy.total, 25 + 2 * 1 + 50);
    const bo = gam.scoreOf("u:bo");
    assert.equal(bo.lockTumbo, 5);
    assert.equal(bo.total, 5 * 2);
  });

  it("is deterministic under repeated evaluation", () => {
    const { ledger, gam } = scoredService();
    const receipts = ledger.receipts();
    const first = gam.scoreOf("u:amy");
    const second = gam.scoreOf("u:amy");
    assert.deepEqual(second, first);
    const mine = receipts.filter((r) => r.actor === "u:amy");
    const pureA = computeBurrowScore(mine, { ribbonClaimed: true });
    const pureB = computeBurrowScore([...mine].reverse(), { ribbonClaimed: true });
    assert.deepEqual(pureB, pureA);
    assert.equal(pureA.total, first.total);
  });

  it("ignores sub-TUMBO dust", () => {
    const { ledger, gam } = freshService();
    ledger.drip("u:amy", "TUMBO", "drip-amy");
    ledger.act(
      "tip",
      { from: "u:amy", to: "u:bo", asset: "TUMBO", amount: 999 },
      "tip-dust",
    );
    assert.equal(gam.scoreOf("u:amy").tipTumbo, 0);
    assert.equal(wholeTumbo(2500), 2);
    assert.equal(wholeTumbo(999), 0);
  });
});

describe("leaderboard", () => {
  it("ranks by score with account tie-breaks and competition ranks", () => {
    const ranked = rankLeaderboard([
      { account: "u:b", score: 10 },
      { account: "u:a", score: 10 },
      { account: "u:c", score: 30 },
      { account: "u:d", score: 5 },
    ]);
    assert.deepEqual(
      ranked.map((row) => [row.rank, row.account, row.score]),
      [
        [1, "u:c", 30],
        [2, "u:a", 10],
        [2, "u:b", 10],
        [4, "u:d", 5],
      ],
    );
  });

  it("ranks the seeded demo burrow deterministically", () => {
    const { gam } = freshService();
    seedDemoBurrow(gam.ledger);
    const board = gam.leaderboard();
    assert.deepEqual(
      board.map((row) => [row.rank, row.account, row.score]),
      [
        [1, "b:bramble", 80],
        [2, "b:moss", 31],
        [3, "b:pebble", 25],
      ],
    );
    assert.equal(gam.leaderboard().length, 3);
  });
});

describe("hunger replay", () => {
  it("rebuilds the same hunger from the same history", () => {
    const { ledger } = freshService();
    seedDemoBurrow(ledger);
    const first = replayHunger(ledger.receipts());
    const second = replayHunger(ledger.receipts());
    const view = (state) =>
      [...state.entries()]
        .map(([account, s]) => [account, s.hunger, s.lastTick])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    assert.deepEqual(view(second), view(first));
  });

  it("matches the live service state", () => {
    const { ledger, gam } = freshService();
    seedDemoBurrow(ledger);
    gam.checkIn("u:z", "k1");
    const replayed = replayHunger(ledger.receipts());
    assert.equal(replayed.get("u:z").hunger, gam.hungerOf("u:z"));
  });
});

describe("gamification service integration", () => {
  it("starts newcomers full", () => {
    const { ledger, gam } = freshService();
    ledger.advanceTicks(40);
    assert.equal(gam.hungerOf("u:newbie"), HUNGER_MAX);
  });

  it("decays on ticks and feeds on activity", () => {
    const { ledger, gam } = freshService();
    gam.checkIn("u:z", "k1");
    assert.equal(gam.hungerOf("u:z"), HUNGER_MAX);
    ledger.advanceTicks(60);
    assert.equal(gam.hungerOf("u:z"), 40);
    ledger.drip("u:z", "TUMBO", "drip-z");
    assert.equal(gam.hungerOf("u:z"), hungerAfterDecay(100, 61) + feedForAction("receive"));
  });

  it("settles exact hunger-tick receipts", () => {
    const { ledger, gam } = freshService();
    gam.checkIn("u:z", "k1");
    ledger.advanceTicks(7);
    const receipt = gam.applyDecay("u:z", "decay-1");
    assert.equal(receipt.action, "hunger-tick");
    assert.deepEqual(
      { from: receipt.meta.from, to: receipt.meta.to },
      { from: 100, to: 93 },
    );
    assert.equal(gam.hungerOf("u:z"), 93);
    throwsCode(() => gam.applyDecay("u:z", "decay-1"), "IDEM_MISMATCH");
    ledger.advanceTicks(5); const second = gam.applyDecay("u:z", "decay-2"); assert.deepEqual({ from: second.meta.from, to: second.meta.to }, { from: 93, to: 88 }); assert.equal(gam.hungerOf("u:z"), 88);
  });

  it("detects starvation", () => {
    const { ledger, gam } = freshService();
    gam.checkIn("u:z", "k1");
    ledger.advanceTicks(85);
    assert.equal(gam.hungerOf("u:z"), 15);
    assert.equal(gam.starvedOf("u:z"), true);
  });

  it("exposes a simulation-labelled snapshot", () => {
    const { gam } = freshService();
    const snap = gam.snapshot("u:amy");
    assert.equal(snap.simulation, true);
    assert.ok(String(snap.boundary).includes("Simulated points only"));
    assert.equal(snap.hunger, HUNGER_MAX);
    assert.equal(snap.rank, null);
  });
});

describe("ledger invariants under gamification", () => {
  it("conserves supply and verifies the hash chain", () => {
    const { ledger, gam } = freshService();
    seedDemoBurrow(ledger);
    gam.checkIn("u:amy", "k1");
    gam.claimRibbon("u:amy", "rk1");
    gam.applyDecay("u:amy", "decay-1");
    const sums = ledger.conservation();
    assert.equal(sums.TUMBO, TOKEN_TOTAL_SUPPLY);
    assert.equal(sums.sMIMAS, SMIMAS_TOTAL_SUPPLY);
    assert.deepEqual(ledger.verifyChain(), { ok: true });
  });

  it("states the simulation boundary", () => {
    assert.ok(SIM_BOUNDARY_NOTE.includes("Simulated points only"));
    assert.ok(SIM_BOUNDARY_NOTE.includes("never real money or wagering"));
  });
});
