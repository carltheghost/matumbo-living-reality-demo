import test from "node:test";
import assert from "node:assert/strict";
import {
  createAutoContracts,
  dedupeGames,
  gameToDraft,
  isUpcoming,
} from "../src/domains/auto-contracts.js";

const NOW = "2026-09-20T18:00:00.000Z";

function fakeGame({
  id,
  home = "Home FC",
  away = "Away FC",
  league = "Test League",
  start = "2026-09-20T20:00:00.000Z",
} = {}) {
  return {
    id,
    date: start,
    competitions: [
      {
        competitors: [
          {
            id: `${id}-home`,
            homeAway: "home",
            team: {
              displayName: home,
            },
          },
          {
            id: `${id}-away`,
            homeAway: "away",
            team: {
              displayName: away,
            },
          },
        ],
        league: {
          name: league,
        },
      },
    ],
  };
}

function fakeOutcomeContracts() {
  const calls = [];
  const factory = () => {
    return (draft) => {
      calls.push(draft);
      return Object.freeze({
        contractId: `contract:${draft.gameId}`,
        ...draft,
      });
    };
  };
  factory.calls = calls;
  return factory;
}

test("isUpcoming returns true for a future game", () => {
  const game = fakeGame({
    id: "future-1",
    start: "2026-09-20T20:00:00.000Z",
  });
  assert.equal(isUpcoming(game, NOW), true);
});

test("isUpcoming returns false for a game that has already started", () => {
  const game = fakeGame({
    id: "past-1",
    start: "2026-09-20T17:59:59.000Z",
  });
  assert.equal(isUpcoming(game, NOW), false);
});

test("isUpcoming returns false when the start time is missing", () => {
  const game = fakeGame({
    id: "no-time",
  });
  delete game.date;
  assert.equal(isUpcoming(game, NOW), false);
});

test("dedupeGames removes duplicate ids while preserving order", () => {
  const first = fakeGame({ id: "game-1" });
  const duplicate = fakeGame({ id: "game-1" });
  const second = fakeGame({ id: "game-2" });
  const result = dedupeGames(
    [first, duplicate, second],
    new Set(["already-seen"]),
  );
  assert.deepEqual(result, [first, second]);
});

test("dedupeGames excludes ids already present in seenIds", () => {
  const game = fakeGame({ id: "game-1" });
  const result = dedupeGames([game], new Set(["game-1"]));
  assert.deepEqual(result, []);
});

test("gameToDraft creates a review-queue proposal", () => {
  const game = fakeGame({
    id: "espn-123",
    home: "Boston FC",
    away: "New York FC",
    league: "Example League",
    start: "2026-09-20T20:00:00.000Z",
  });
  const draft = gameToDraft(game);
  assert.equal(draft.kind, "contract-review");
  assert.equal(draft.queue, "Contracts for your review");
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.gameId, "espn-123");
  assert.equal(draft.source, "ESPN_READ_ONLY");
  assert.equal(draft.simulationOnly, true);
  assert.equal(draft.execution, "NONE");
  assert.equal(draft.contractDraft.gameId, "espn-123");
  assert.equal(draft.contractDraft.league, "Example League");
  assert.equal(draft.contractDraft.teams.home, "Boston FC");
  assert.equal(draft.contractDraft.teams.away, "New York FC");
  assert.equal(draft.contractDraft.startTime, "2026-09-20T20:00:00.000Z");
  assert.equal(draft.contractDraft.asset, "TUMBO_POINTS_SIMULATED");
  assert.equal(draft.contractDraft.settlement, "projection-only");
});

test("draftContractsForGames creates one draft for every unseen game", () => {
  const outcomeContracts = fakeOutcomeContracts();
  const autoContracts = createAutoContracts({
    fetchSportsEvents: async () => [],
    createOutcomeContracts: outcomeContracts,
    now: () => new Date(NOW),
  });
  const games = [
    fakeGame({ id: "game-1" }),
    fakeGame({ id: "game-2" }),
    fakeGame({ id: "game-3" }),
  ];
  const drafts = autoContracts.draftContractsForGames(games);
  assert.equal(drafts.length, 3);
  assert.deepEqual(
    drafts.map((draft) => draft.gameId),
    ["game-1", "game-2", "game-3"],
  );
  assert.equal(outcomeContracts.calls.length, 3);
});

test("scanning twice is idempotent", async () => {
  const games = [fakeGame({ id: "game-1" }), fakeGame({ id: "game-2" })];
  const outcomeContracts = fakeOutcomeContracts();
  let fetchCount = 0;
  const autoContracts = createAutoContracts({
    fetchSportsEvents: async () => {
      fetchCount += 1;
      return games;
    },
    createOutcomeContracts: outcomeContracts,
    now: () => new Date(NOW),
  });
  const first = await autoContracts.scanToday();
  const second = await autoContracts.scanToday();
  assert.equal(fetchCount, 2);
  assert.equal(first.length, 2);
  assert.equal(second.length, 0);
  assert.equal(autoContracts.getDrafts().length, 2);
  assert.equal(outcomeContracts.calls.length, 2);
});

test("scanToday only creates contracts for upcoming games", async () => {
  const outcomeContracts = fakeOutcomeContracts();
  const autoContracts = createAutoContracts({
    fetchSportsEvents: async () => [
      fakeGame({
        id: "past-game",
        start: "2026-09-20T17:00:00.000Z",
      }),
      fakeGame({
        id: "future-game",
        start: "2026-09-20T20:00:00.000Z",
      }),
    ],
    createOutcomeContracts: outcomeContracts,
    now: () => new Date(NOW),
  });
  const drafts = await autoContracts.scanToday();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].gameId, "future-game");
  assert.equal(outcomeContracts.calls.length, 1);
});

test("getDrafts returns a snapshot and cannot mutate internal state", () => {
  const autoContracts = createAutoContracts({
    fetchSportsEvents: async () => [],
    createOutcomeContracts: fakeOutcomeContracts(),
    now: () => new Date(NOW),
  });
  autoContracts.draftContractsForGames([fakeGame({ id: "game-1" })]);
  const drafts = autoContracts.getDrafts();
  assert.equal(drafts.length, 1);
  assert.notEqual(drafts, autoContracts.getDrafts());
  assert.throws(() => {
    drafts.push(fakeGame({ id: "illegal" }));
  }, TypeError);
  assert.equal(autoContracts.getDrafts().length, 1);
});

test("clearDrafts resets both drafts and idempotency state", () => {
  const autoContracts = createAutoContracts({
    fetchSportsEvents: async () => [],
    createOutcomeContracts: fakeOutcomeContracts(),
    now: () => new Date(NOW),
  });
  const game = fakeGame({ id: "game-1" });
  assert.equal(autoContracts.draftContractsForGames([game]).length, 1);
  assert.equal(autoContracts.getDrafts().length, 1);
  autoContracts.clearDrafts();
  assert.equal(autoContracts.getDrafts().length, 0);
  assert.equal(autoContracts.draftContractsForGames([game]).length, 1);
});

test("all generated contracts remain simulation-only", () => {
  const autoContracts = createAutoContracts({
    fetchSportsEvents: async () => [],
    createOutcomeContracts: fakeOutcomeContracts(),
    now: () => new Date(NOW),
  });
  const [draft] = autoContracts.draftContractsForGames([
    fakeGame({ id: "simulation-1" }),
  ]);
  assert.equal(draft.simulationOnly, true);
  assert.equal(draft.execution, "NONE");
  assert.equal(draft.contractDraft.simulationOnly, true);
  assert.equal(draft.contractDraft.asset, "TUMBO_POINTS_SIMULATED");
  assert.equal(draft.contractDraft.source, "ESPN_READ_ONLY");
  assert.equal(draft.contractDraft.settlement, "projection-only");
});
