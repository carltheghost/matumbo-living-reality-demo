import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  MULTI_SPORT_EVENTS_ENDPOINTS,
  MULTI_SPORT_EVENTS_DETAIL_SOURCE,
  MULTI_SPORT_EVENTS_MAX_DETAIL_REQUESTS,
  MULTI_SPORT_EVENTS_MAX_RECORDS_PER_PROVIDER,
  createUnavailableMultiSportEvents,
  fetchMultiSportEventDetail,
  fetchMultiSportEvents,
  normalizeMultiSportScoreboard,
  publicMultiSportEventDetailReference,
  replayMultiSportEvents,
  summarizeMultiSportEvents,
} from "../src/domains/multi-sport-events.js";

const NOW = "2026-08-28T12:00:00.000Z";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function payload(endpoint, count = 1) {
  return {
    leagues: [{ id: endpoint.league, name: endpoint.leagueLabel }],
    events: Array.from({ length: count }, (_, index) => {
      const eventId = `${endpoint.sport}-${index + 1}`;
      const first = endpoint.sport === "soccer" ? "Crystal Palace" : endpoint.sport === "basketball" ? "Toronto Raptors" : "Baltimore Ravens";
      const second = endpoint.sport === "soccer" ? "Manchester City" : endpoint.sport === "basketball" ? "Miami Heat" : "Washington Commanders";
      const event = {
        id: eventId,
        name: `${second} at ${first}`,
        date: `2026-08-28T${String(12 + index).padStart(2, "0")}:00:00Z`,
        links: [{ rel: ["summary", "event"], href: `https://www.espn.com/${endpoint.league}/game/_/gameId/${eventId}` }],
        season: { year: 2026, slug: "2026-season" },
        competitions: [{
          id: `${eventId}-competition`,
          startDate: `2026-08-28T${String(12 + index).padStart(2, "0")}:00:00Z`,
          status: { period: 1, displayClock: "0:00", type: { name: "STATUS_SCHEDULED", state: "pre", completed: false, description: "Scheduled" } },
          venue: { id: "venue-1", fullName: "Test Stadium", address: { city: "London", state: "LDN", country: "England" } },
          type: { abbreviation: "STD" },
          competitors: [
            { id: "home-1", homeAway: "home", winner: false, score: "2", curatedRank: { current: 4 }, team: { displayName: first, abbreviation: "HOM" } },
            { id: "away-1", homeAway: "away", winner: false, score: "1", team: { displayName: second, abbreviation: "AWY" } },
          ],
          leaders: [{ name: "goals", displayName: "Goals", leaders: [{ displayValue: "2", athlete: { displayName: "Test Player" } }] }],
          odds: [{ provider: { name: "Ignored" }, details: "ignored" }],
          tickets: [{ summary: "Ignored" }],
        }],
      };
      return event;
    }),
  };
}

test("multi-sport fetch reads exactly the fixed soccer, NBA, and NFL scoreboards", async () => {
  const requested = [];
  const fetchImpl = async (url, options) => {
    requested.push({ url, options });
    const endpoint = MULTI_SPORT_EVENTS_ENDPOINTS.find((candidate) => candidate.endpoint === url);
    return response(payload(endpoint));
  };
  const snapshot = await fetchMultiSportEvents({ fetchImpl, now: NOW, maxRecordsPerProvider: 4, timeoutMs: 1000 });
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.providerCount, 3);
  assert.equal(snapshot.availableProviderCount, 3);
  assert.equal(snapshot.records.length, 3);
  assert.deepEqual(requested.map(({ url }) => url), MULTI_SPORT_EVENTS_ENDPOINTS.map((endpoint) => endpoint.endpoint));
  assert.ok(requested.every(({ url }) => url.startsWith("https://site.web.api.espn.com/apis/site/v2/sports/")));
  assert.ok(requested.every(({ options }) => options.method === "GET" && options.headers.accept === "application/json"));
  const soccer = snapshot.records.find((record) => record.sport === "soccer");
  assert.equal(soccer.league, "eng.1");
  assert.equal(soccer.participants[0].name, "Crystal Palace");
  assert.equal(soccer.participants[0].score, "2");
  assert.equal(soccer.participants[0].rank, 4);
  assert.equal(soccer.statusDetail.state, "pre");
  assert.equal(soccer.statusDetail.completed, false);
  assert.equal(soccer.eventTime, "2026-08-28T12:00:00Z");
  assert.equal(soccer.venue.name, "Test Stadium");
  assert.equal(soccer.leaders[0].participants[0].name, "Test Player");
  assert.equal(Object.hasOwn(soccer, "odds"), false);
  assert.equal(Object.hasOwn(soccer, "tickets"), false);
  assert.equal(Object.hasOwn(soccer, "broadcasts"), false);
  assert.equal(soccer.truthClaim, false);
  assert.equal(soccer.executable, false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.records[0]), true);
});

test("normalizer keeps provider competition rows bounded and drops records without participants", () => {
  const endpoint = MULTI_SPORT_EVENTS_ENDPOINTS[0];
  const raw = payload(endpoint, 4);
  raw.events.push({ id: "empty", competitions: [{ id: "empty-competition", competitors: [] }] });
  const records = normalizeMultiSportScoreboard(raw, endpoint, NOW, 2);
  assert.equal(records.length, 2);
  assert.equal(records.every((record) => record.providerId === endpoint.id), true);
  assert.equal(records.every((record) => record.participants.length === 2), true);
});

test("empty, malformed, and failed providers stay unavailable with no replacement rows", async () => {
  const snapshot = await fetchMultiSportEvents({
    fetchImpl: async (url) => {
      if (url.endsWith("soccer/eng.1/scoreboard")) return response({ events: [] });
      if (url.endsWith("basketball/nba/scoreboard")) return response({});
      throw new Error("offline");
    },
    now: NOW,
  });
  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.records.length, 0);
  assert.equal(snapshot.availableProviderCount, 0);
  assert.equal(snapshot.sources.every((source) => source.available === false), true);
  assert.match(snapshot.reason, /no provider returned|no multi-sport rows/i);
  const empty = createUnavailableMultiSportEvents({ retrievedAt: NOW });
  assert.deepEqual(empty.records, []);
  assert.equal(empty.externalNetwork, false);
});

test("one provider can fail without replacing the other provider observations", async () => {
  const snapshot = await fetchMultiSportEvents({
    fetchImpl: async (url) => {
      const endpoint = MULTI_SPORT_EVENTS_ENDPOINTS.find((candidate) => candidate.endpoint === url);
      if (endpoint.sport === "basketball") throw new Error("NBA unavailable");
      return response(payload(endpoint, 2));
    },
    now: NOW,
    maxRecordsPerProvider: 1,
  });
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.records.length, 2);
  assert.equal(new Set(snapshot.records.map((record) => record.sport)).size, 2);
  assert.equal(snapshot.sources.filter((source) => source.available).length, 2);
  assert.match(snapshot.sources.find((source) => source.sport === "basketball").reason, /NBA unavailable/);
});

test("summary and replay do not request providers again", async () => {
  let calls = 0;
  const snapshot = await fetchMultiSportEvents({
    fetchImpl: async (url) => {
      calls += 1;
      const endpoint = MULTI_SPORT_EVENTS_ENDPOINTS.find((candidate) => candidate.endpoint === url);
      return response(payload(endpoint));
    },
    now: NOW,
  });
  const summary = summarizeMultiSportEvents(snapshot);
  assert.equal(summary.recordCount, 3);
  assert.deepEqual(summary.sports, ["soccer", "basketball", "football"]);
  assert.equal(summary.scoreReportedCount, 3);
  const replay = replayMultiSportEvents(snapshot, snapshot.records[0].id, "test");
  assert.equal(calls, 3);
  assert.equal(replay.recordId, snapshot.records[0].id);
  assert.equal(replay.externalNetwork, false);
  assert.equal(replay.liveFetch, false);
});

test("endpoint contract is fixed, HTTPS-only, bounded, and authority-free", async () => {
  assert.equal(MULTI_SPORT_EVENTS_ENDPOINTS.length, 3);
  assert.ok(MULTI_SPORT_EVENTS_ENDPOINTS.every((endpoint) => endpoint.endpoint.startsWith("https://site.web.api.espn.com/apis/site/v2/sports/")));
  assert.equal(MULTI_SPORT_EVENTS_MAX_RECORDS_PER_PROVIDER, 12);
  const source = await readFile(new URL("../src/domains/multi-sport-events.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /authorization|api[_-]?key|client[_-]?secret/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|WebSocket/i);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.match(source, /MULTI_SPORT_EVENTS_MAX_RECORDS_PER_PROVIDER/);
  assert.match(source, /MULTI_SPORT_EVENTS_FETCH_TIMEOUT_MS/);
});

test("explicit multi-sport detail follows one provider-owned summary URL and normalizes players, periods, plays, and grade", async () => {
  const record = {
    id: "espn-multi-sport:basketball:nba:event-1:competition-1:0",
    providerId: "espn-basketball-nba-scoreboard",
    sport: "basketball",
    league: "nba",
    eventId: "event-1",
    competition: { id: "competition-1" },
    participants: [{ id: "home", name: "Home Team" }, { id: "away", name: "Away Team" }],
  };
  const detailUrl = publicMultiSportEventDetailReference(record);
  assert.equal(detailUrl, "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=event-1");
  const requested = [];
  const result = await fetchMultiSportEventDetail({
    record,
    now: NOW,
    fetchImpl: async (url) => {
      requested.push(url);
      return response({
        header: {
          competitions: [{
            id: "competition-1",
            status: { period: 3, displayClock: "04:12", type: { state: "in", completed: false, description: "In Progress" } },
            competitors: [
              { id: "home", team: { id: "home", displayName: "Home Team" }, linescores: [{ period: 1, value: 28 }, { period: 2, value: 31 }] },
              { id: "away", team: { id: "away", displayName: "Away Team" }, linescores: [{ period: 1, value: 24 }, { period: 2, value: 29 }] },
            ],
          }],
        },
        boxscore: {
          players: [{ team: { id: "home", displayName: "Home Team" }, statistics: [{ athletes: [{ athlete: { id: "player-1", displayName: "Player One" }, stats: [{ name: "PTS", value: "24" }, { name: "REB", value: "7" }] }] }] }],
        },
        plays: [
          { id: "play-1", period: 3, clock: "04:12", text: "Player One makes jumper", team: { displayName: "Home Team" }, score: "63-59" },
          { id: "play-2", period: 3, clock: "03:55", text: "Away Team turnover" },
        ],
        notes: [{ text: "Provider summary note" }],
      });
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.source, MULTI_SPORT_EVENTS_DETAIL_SOURCE);
  assert.equal(result.requestCount, 1);
  assert.equal(result.requestCount <= MULTI_SPORT_EVENTS_MAX_DETAIL_REQUESTS, true);
  assert.deepEqual(requested, [detailUrl]);
  assert.equal(result.record.publicDetail.status, "available");
  assert.equal(result.record.publicDetail.players[0].name, "Player One");
  assert.equal(result.record.publicDetail.players[0].teamName, "Home Team");
  assert.deepEqual(result.record.publicDetail.periods.map((period) => period.period), [1, 2]);
  assert.equal(result.record.publicDetail.timeline.length, 2);
  assert.equal(result.record.publicDetail.timeline[0].period, 3);
  assert.equal(result.record.publicDetail.detailCompletenessGrade, "A");
  assert.equal(result.record.publicDetail.detailCompletenessPercent, 100);
  assert.equal(result.record.truthClaim, false);
  assert.equal(result.record.executable, false);
  assert.equal(requested.some((url) => /odds|betting|pickcenter|predictor/i.test(url)), false);
});

test("multi-sport detail keeps provider-empty periods and play-by-play unavailable without fabricated rows", async () => {
  const record = {
    id: "espn-multi-sport:soccer:eng.1:event-2:competition-2:0",
    providerId: "espn-soccer-eng1-scoreboard",
    sport: "soccer",
    league: "eng.1",
    eventId: "event-2",
    competition: { id: "competition-2" },
    participants: [{ id: "home", name: "Home" }, { id: "away", name: "Away" }],
  };
  const result = await fetchMultiSportEventDetail({
    record,
    now: NOW,
    fetchImpl: async () => response({ header: { competitions: [{ id: "competition-2", status: { type: { state: "pre", completed: false, description: "Scheduled" } }, competitors: [] }] } }),
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.record.publicDetail.players, []);
  assert.deepEqual(result.record.publicDetail.periods, []);
  assert.deepEqual(result.record.publicDetail.timeline, []);
  assert.equal(result.record.publicDetail.timelineStatus, "unavailable");
  assert.equal(result.record.publicDetail.periodStatus, "unavailable");
  assert.equal(result.record.publicDetail.detailCompletenessGrade, "D");
  assert.match(result.reason, /no usable play-by-play or period/i);
});

test("multi-sport detail refuses missing or unsafe provider identifiers before network access", async () => {
  let calls = 0;
  const result = await fetchMultiSportEventDetail({
    record: { sport: "basketball", league: "nba", eventId: "https://example.invalid", competition: { id: "x" } },
    fetchImpl: async () => { calls += 1; return response({}); },
  });
  assert.equal(publicMultiSportEventDetailReference(result.record), null);
  assert.equal(calls, 0);
  assert.equal(result.requestCount, 0);
  assert.equal(result.status, "unavailable");
  assert.equal(result.record.publicDetail.timeline.length, 0);
});
test("research summary is field-presence only and grouped by sport", async () => {
  const { summarizeMultiSportEvents } = await import("../src/domains/multi-sport-events.js");
  const summary = summarizeMultiSportEvents({ records: [
    { sport: "soccer", league: "eng.1", scoreStatus: "provider-reported", status: "STATUS_FINAL", eventTime: "2026", dataCompletenessPercent: 80 },
    { sport: "soccer", league: "eng.1", scoreStatus: "unavailable", status: "unavailable", dataCompletenessPercent: 20 },
  ], sources: [] });
  assert.deepEqual(summary.researchSummary.soccer, { eventCount: 2, scoreReportedCount: 1, statusReportedCount: 1, timeReportedCount: 1, completenessAverage: 50 });
  assert.doesNotMatch(JSON.stringify(summary.researchSummary), /odds|wager|prediction|probability/i);
});
