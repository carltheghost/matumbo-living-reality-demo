import test from "node:test";
import assert from "node:assert/strict";
import {
  mapEspnRecordToGame,
  normalizeDraft,
  describeOddsQuote,
  createContractFlow,
} from "../src/domains/contract-flow.js";
import { createOutcomeContracts } from "../src/domains/outcome-contracts.js";
import { createProposalQueue } from "../src/domains/bot-plaza.js";
import { createContractLedger } from "../src/domains/contract-ledger.js";
import { gameToDraft } from "../src/domains/auto-contracts.js";

// NOTE: the odds lane's attachOddsToDraft stamps freshness against the real
// clock, so the harness uses real time throughout (game starts +6h, quotes
// -60s) to keep every freshness check honest.
const nowFn = () => new Date();

function espnRecord(overrides = {}) {
  return {
    id: "espn-multi-sport:soccer:eng.1:123:456:0",
    league: "eng.1",
    leagueLabel: "English Premier League",
    title: "Arsenal vs Chelsea",
    status: "scheduled",
    eventTime: new Date(Date.now() + 6 * 3600_000).toISOString(),
    teams: [
      { name: "Arsenal", homeAway: "home" },
      { name: "Chelsea", homeAway: "away" },
    ],
    ...overrides,
  };
}

function fakeOddsFetch(markets) {
  return async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({ markets }),
  });
}

function flowHarness(overrides = {}) {
  const desk = createOutcomeContracts({ seed: "flow-test" });
  const proposalQueue = createProposalQueue({ storage: null, now: nowFn });
  const ledger = createContractLedger();
  const flow = createContractFlow({
    fetchEspnRecords: async () => [espnRecord()],
    outcomeDesk: desk,
    proposalQueue,
    ledger,
    fetchImpl: fakeOddsFetch([]),
    now: nowFn,
    ...overrides,
  });
  return { desk, proposalQueue, ledger, flow };
}

test("mapEspnRecordToGame maps the ESPN record shape", () => {
  const game = mapEspnRecordToGame(espnRecord());
  assert.equal(game.id, "espn-multi-sport:soccer:eng.1:123:456:0");
  assert.equal(game.home, "Arsenal");
  assert.equal(game.away, "Chelsea");
  assert.equal(game.homeTeam, "Arsenal");
  assert.equal(game.league.name, "English Premier League");
  assert.ok(game.date);
  assert.ok(Array.isArray(game.competitions[0].competitors));
});

test("mapEspnRecordToGame returns null for bad input", () => {
  assert.equal(mapEspnRecordToGame(null), null);
  assert.equal(mapEspnRecordToGame({}), null);
  assert.equal(mapEspnRecordToGame({ id: "" }), null);
});

test("normalizeDraft pins startsAt and canonical status", () => {
  const game = mapEspnRecordToGame(espnRecord());
  const proposal = gameToDraft(game);
  const draft = normalizeDraft(proposal, nowFn);
  assert.equal(draft.gameId, game.id);
  assert.deepEqual(draft.teams, { home: "Arsenal", away: "Chelsea" });
  assert.equal(draft.league, "English Premier League");
  assert.ok(draft.startsAt, "startsAt must be set from the lane startTime");
  assert.equal(draft.status, "draft");
  assert.equal(draft.source, "espn-auto");
  assert.ok(draft.createdAt);
});

test("describeOddsQuote renders an honest quote line", () => {
  const line = describeOddsQuote({
    source: "kalshi",
    outcome: "Yes",
    price: 0.62,
  });
  assert.match(line, /Kalshi/);
  assert.match(line, /62%/);
  assert.match(line, /simulated TUMBO points/);
  assert.equal(describeOddsQuote(null), null);
  assert.equal(describeOddsQuote({ price: 0 }), null);
  assert.equal(describeOddsQuote({ price: 1 }), null);
});

test("scanToday drafts upcoming games, idempotent on gameId", async () => {
  const { flow } = flowHarness();
  const first = await flow.scanToday();
  assert.equal(first.length, 1);
  assert.equal(first[0].gameId, "espn-multi-sport:soccer:eng.1:123:456:0");
  const second = await flow.scanToday();
  assert.equal(second.length, 0, "second scan must not re-draft the same game");
});

test("scanToday skips games that already started", async () => {
  const { flow } = flowHarness({
    fetchEspnRecords: async () => [
      espnRecord({ eventTime: new Date(Date.now() - 3600_000).toISOString() }),
    ],
  });
  const drafts = await flow.scanToday();
  assert.equal(drafts.length, 0);
});

test("scanAndQueue does not duplicate a persisted game proposal after a reload", async () => {
  const state = new Map();
  const storage = {
    getItem(key) {
      return state.get(key) ?? null;
    },
    setItem(key, value) {
      state.set(key, value);
    },
  };

  const firstQueue = createProposalQueue({ storage, now: nowFn });
  const first = createContractFlow({
    fetchEspnRecords: async () => [espnRecord()],
    outcomeDesk: createOutcomeContracts({ seed: "persisted-first" }),
    proposalQueue: firstQueue,
    ledger: createContractLedger(),
    fetchImpl: fakeOddsFetch([]),
    now: nowFn,
  });
  const firstResult = await first.scanAndQueue();
  assert.equal(firstResult.proposals.length, 1);

  const secondQueue = createProposalQueue({ storage, now: nowFn });
  const second = createContractFlow({
    fetchEspnRecords: async () => [espnRecord()],
    outcomeDesk: createOutcomeContracts({ seed: "persisted-second" }),
    proposalQueue: secondQueue,
    ledger: createContractLedger(),
    fetchImpl: fakeOddsFetch([]),
    now: nowFn,
  });
  const secondResult = await second.scanAndQueue();
  assert.equal(secondResult.proposals.length, 0, "reload must not create a duplicate");
  assert.equal(
    secondQueue.getProposals({ status: "pending" }).filter(
      (proposal) => proposal.eventId === "espn-multi-sport:soccer:eng.1:123:456:0",
    ).length,
    1,
  );
});

test("scanAndQueue retries a game after transient proposal submission failure", async () => {
  let submitCalls = 0;
  const proposalQueue = {
    getProposals: () => [],
    submitProposal() {
      submitCalls += 1;
      if (submitCalls === 1) throw new Error("temporary queue failure");
      return { id: "proposal:retry:1" };
    },
  };
  const flow = createContractFlow({
    fetchEspnRecords: async () => [espnRecord()],
    outcomeDesk: createOutcomeContracts({ seed: "retry" }),
    proposalQueue,
    ledger: createContractLedger(),
    fetchImpl: fakeOddsFetch([]),
    now: nowFn,
  });

  const first = await flow.scanAndQueue();
  assert.equal(first.proposals.length, 0);
  const second = await flow.scanAndQueue();
  assert.equal(second.proposals.length, 1);
  assert.equal(submitCalls, 2);
});

test("enrichWithOdds attaches a fresh simulated quote", async () => {
  const quoteTime = new Date(Date.now() - 60_000).toISOString();
  const { flow } = flowHarness({
    fetchImpl: fakeOddsFetch([
      {
        ticker: "ARS-CHE",
        title: "Arsenal vs Chelsea",
        yes_price: 0.62,
        updated_time: quoteTime,
      },
    ]),
  });
  const drafts = await flow.scanToday();
  const enriched = await flow.enrichWithOdds(drafts);
  assert.equal(enriched.length, 1);
  assert.ok(enriched[0].oddsQuote, "quote should attach");
  assert.equal(enriched[0].oddsQuote.simulated, true);
  assert.equal(enriched[0].oddsQuote.realMoney, false);
  assert.equal(enriched[0].oddsQuote.unit, "TUMBO_POINTS");
  assert.equal(enriched[0].oddsUnavailable, null);
});

test("enrichWithOdds keeps drafts usable when feeds fail", async () => {
  const { flow } = flowHarness({
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  const drafts = await flow.scanToday();
  const enriched = await flow.enrichWithOdds(drafts);
  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].oddsQuote, null);
  assert.ok(enriched[0].oddsUnavailable, "honest unavailable state required");
});

test("submitForReview lands proposals in the atelier queue with the odds line", async () => {
  const quoteTime = new Date(Date.now() - 60_000).toISOString();
  const { flow, proposalQueue } = flowHarness({
    fetchImpl: fakeOddsFetch([
      { ticker: "ARS-CHE", title: "Arsenal vs Chelsea", yes_price: 0.62, updated_time: quoteTime },
    ]),
  });
  const drafts = await flow.scanToday();
  const enriched = await flow.enrichWithOdds(drafts);
  const proposals = flow.submitForReview(enriched);
  assert.equal(proposals.length, 1);
  const pending = proposalQueue.getProposals().filter((p) => p.status === "pending");
  assert.equal(pending.length, 1);
  assert.match(pending[0].sourceNotes, /Kalshi 62%/);
  assert.match(pending[0].researchNotes, /English Premier League/);
  assert.deepEqual(pending[0].outcomes, ["Arsenal", "Chelsea"]);
  // Sidecar holds the frozen quote for approval time.
  assert.ok(flow.quoteForProposal(proposals[0].id));
});

test("handleContractApproved freezes a fresh quote into the ledger", async () => {
  const quoteTime = new Date(Date.now() - 60_000).toISOString();
  const { flow, ledger, proposalQueue } = flowHarness({
    fetchImpl: fakeOddsFetch([
      { ticker: "ARS-CHE", title: "Arsenal vs Chelsea", yes_price: 0.62, updated_time: quoteTime },
    ]),
  });
  const drafts = await flow.scanToday();
  const enriched = await flow.enrichWithOdds(drafts);
  const [proposal] = flow.submitForReview(enriched);
  const contract = { id: "oct:test:0001" };
  const result = flow.handleContractApproved({ contract, proposal });
  assert.equal(result.contractId, "oct:test:0001");
  assert.ok(result.quote, "fresh quote must freeze at approval");
  assert.equal(result.quoteStatus, "frozen-at-approval");
  assert.equal(result.quote.simulated, true);
});

test("handleContractApproved records unavailable honestly when the quote is stale", async () => {
  const staleTime = new Date(Date.now() - 60 * 60_000).toISOString();
  const { flow } = flowHarness({
    fetchImpl: fakeOddsFetch([
      { ticker: "ARS-CHE", title: "Arsenal vs Chelsea", yes_price: 0.62, updated_time: staleTime },
    ]),
  });
  const drafts = await flow.scanToday();
  const enriched = await flow.enrichWithOdds(drafts);
  assert.equal(enriched[0].oddsQuote, null, "stale quote must be rejected at attach");
  const [proposal] = flow.submitForReview(enriched);
  const result = flow.handleContractApproved({ contract: { id: "oct:test:0002" }, proposal });
  assert.equal(result.quote, null);
  assert.equal(result.quoteStatus, "unavailable-at-approval");
});

test("gradeOnLanding grades through the canonical desk", async () => {
  const { flow, desk } = flowHarness();
  const contract = desk.createContract({
    eventId: "g1",
    eventLabel: "Arsenal vs Chelsea",
    outcomes: ["Arsenal", "Chelsea"],
    creator: "user",
    status: "open",
  });
  const result = flow.gradeOnLanding(contract.id, { winner: "arsenal" });
  assert.equal(result.graded, true);
  const graded = desk.get(contract.id);
  // Canonical desk auto-settles at grade time (escrow fully accounted).
  assert.equal(graded.status, "settled");
  assert.ok(graded.grading, "deterministic grading attached");
});

test("gradeOnLanding refuses a second grade with a different result", async () => {
  const { flow, desk } = flowHarness();
  const contract = desk.createContract({
    eventId: "g1",
    eventLabel: "Arsenal vs Chelsea",
    outcomes: ["Arsenal", "Chelsea"],
    creator: "user",
    status: "open",
  });
  flow.gradeOnLanding(contract.id, { winner: "arsenal" });
  const again = flow.gradeOnLanding(contract.id, { winner: "chelsea" });
  assert.equal(again.graded, false);
});

test("claimForever claims once and never sets an expiry", async () => {
  const { flow, desk } = flowHarness();
  const contract = desk.createContract({
    eventId: "g1",
    eventLabel: "Arsenal vs Chelsea",
    outcomes: ["Arsenal", "Chelsea"],
    creator: "user",
    status: "open",
  });
  desk.join({ contractId: contract.id, participant: "tumbo", outcome: "ARSENAL", stakeAmount: 50 });
  flow.gradeOnLanding(contract.id, { winner: "arsenal" });
  const nftId = desk.get(contract.id).grading.nftIds[0];
  assert.ok(nftId, "expected a minted award nft for the winner");
  const first = flow.claimForever({ nftId, participant: "tumbo" });
  assert.equal(first.claimed, true);
  const escrow = desk.listEscrows().find((entry) => entry.id === first.receipt.escrowId);
  assert.ok(escrow, "expected the linked eternal escrow");
  assert.equal(escrow.expiresAt, null, "claimable forever: expiresAt null");
  const second = flow.claimForever({ nftId, participant: "tumbo" });
  assert.equal(second.claimed, false, "anti-double-claim");
});

test("createContractFlow validates its dependencies", () => {
  assert.throws(() => createContractFlow({}), /fetchEspnRecords/);
  assert.throws(
    () => createContractFlow({ fetchEspnRecords: async () => [] }),
    /outcome desk/,
  );
});
