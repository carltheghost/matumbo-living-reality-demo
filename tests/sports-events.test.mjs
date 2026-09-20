import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  SPORTS_EVENTS_ENDPOINTS,
  SPORTS_EVENTS_DETAIL_BASE,
  SPORTS_EVENTS_DETAIL_SOURCE,
  SPORTS_EVENTS_MAX_DETAIL_REQUESTS,
  SPORTS_EVENTS_SECONDARY_PROVIDER,
  createUnavailableSportsEvents,
  createSecondaryParityStatus,
  fetchSportsEventDetail,
  fetchSportsEvents,
  publicCompetitionDetailReference,
  replaySportsEvents,
  reconcileSportsResult,
  summarizeSportsEvents,
} from "../src/domains/sports-events.js";

const NOW = "2026-08-27T12:00:00.000Z";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function scoreboardPayload({ tour = "ATP", includeTimeline = false } = {}) {
  const athleteA = tour === "ATP"
    ? { id: "3623", displayName: "Jannik Sinner", shortName: "J. Sinner", flagAltText: "Italy", citizenshipCountry: "ITA" }
    : { id: "9044", displayName: "Iga Swiatek", shortName: "I. Swiatek", flagAltText: "Poland", citizenshipCountry: "POL" };
  const athleteB = tour === "ATP"
    ? { id: "2375", displayName: "Alexander Zverev", shortName: "A. Zverev", flagAltText: "Germany", citizenshipCountry: "GER" }
    : { id: "10032", displayName: "Aryna Sabalenka", shortName: "A. Sabalenka", flagAltText: "Belarus", citizenshipCountry: "BLR" };
  const competition = {
    id: "match-1",
    date: "2026-08-27T15:00:00Z",
    startDate: "2026-08-27T15:00:00Z",
    status: { period: 3, type: { name: "STATUS_FINAL", state: "post", completed: true, description: "Final" } },
    venue: { fullName: "Test Court", court: "Centre" },
    type: { text: tour === "ATP" ? "Men's Singles" : "Women's Singles" },
    round: { displayName: "Final" },
    competitors: [
      { id: athleteA.id, winner: true, linescores: [{ value: 6, winner: true }, { value: 4, winner: false }, { value: 6, winner: true }], athlete: athleteA },
      { id: athleteB.id, winner: false, linescores: [{ value: 3, winner: false }, { value: 6, winner: true }, { value: 2, winner: false }], athlete: athleteB },
    ],
  };
  if (includeTimeline) {
    competition.plays = [
      { id: "p1", period: 1, text: "Sinner holds serve", clock: "00:42" },
      { id: "p2", period: 1, text: "Zverev breaks", clock: "00:36" },
    ];
  }
  return {
    leagues: [{ name: tour }],
    events: [{
      id: "tournament-1",
      name: tour === "ATP" ? "Test Open" : "Test WTA Open",
      date: "2026-08-27T00:00:00Z",
      links: [{ rel: ["summary", "event"], href: `https://www.espn.com/tennis/scoreboard/${tour.toLowerCase()}/tournament-1` }],
      groupings: [{ grouping: { displayName: tour === "ATP" ? "Men's Singles" : "Women's Singles" }, competitions: [competition] }],
    }],
  };
}

function rankingsPayload(tour = "ATP") {
  const names = tour === "ATP"
    ? [["3623", "Jannik Sinner", 1], ["2375", "Alexander Zverev", 2]]
    : [["9044", "Iga Swiatek", 1], ["10032", "Aryna Sabalenka", 2]];
  return {
    rankings: [{
      id: "1",
      name: tour,
      ranks: names.map(([id, displayName, current]) => ({
        current,
        previous: current,
        points: 1000 - current,
        trend: "-",
        athlete: {
          id,
          displayName,
          shortname: displayName.slice(0, 1) + ". " + displayName.split(" ").slice(-1)[0],
          citizenshipCountry: tour === "ATP" ? (current === 1 ? "ITA" : "GER") : (current === 1 ? "POL" : "BLR"),
          links: [{ rel: ["playercard", "athlete"], href: `https://www.espn.com/tennis/player/_/id/${id}/profile` }],
          age: 25,
          active: true,
        },
      })),
    }],
  };
}

test("public tennis fetch normalizes ATP/WTA matches, rankings, sets, profile data, and explicit timeline state", async () => {
  const requested = [];
  const fetchImpl = async (url, options) => {
    requested.push({ url, options });
    if (url.endsWith("/atp/rankings")) return response(rankingsPayload("ATP"));
    if (url.endsWith("/wta/rankings")) return response(rankingsPayload("WTA"));
    if (url.endsWith("/atp/scoreboard")) return response(scoreboardPayload({ tour: "ATP", includeTimeline: true }));
    if (url.endsWith("/wta/scoreboard")) return response(scoreboardPayload({ tour: "WTA" }));
    return response({}, 404);
  };
  const snapshot = await fetchSportsEvents({ fetchImpl, now: NOW, maxRecords: 4, timeoutMs: 1000 });
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.records.length, 2);
  assert.equal(snapshot.rankings.length, 4);
  assert.equal(requested.length, 4);
  assert.ok(requested.every(({ url }) => url.startsWith("https://")));
  assert.ok(requested.every(({ options }) => options.method === "GET" && options.headers.accept === "application/json"));

  const atp = snapshot.records.find((record) => record.tour === "ATP");
  assert.equal(atp.players[0].name, "Jannik Sinner");
  assert.equal(atp.players[0].rank, 1);
  assert.equal(atp.players[0].rankStatus, "provider-reported");
  assert.match(atp.players[0].rankSourceUrl, /\/atp\/rankings$/);
  assert.equal(atp.players[0].profileUrl, "https://www.espn.com/tennis/player/_/id/3623/profile");
  assert.deepEqual(atp.setScores[0].scores.map((score) => score.value), [6, 3]);
  assert.equal(atp.setScores.every((set) => set.dataCompletenessGrade === "A"), true);
  assert.equal(atp.setScores.every((set) => set.scoreStatus === "complete"), true);
  assert.equal(atp.setScoreCompleteness.status, "complete");
  assert.equal(atp.timelineStatus, "available");
  assert.equal(atp.timeline.points.length, 2);
  assert.equal(atp.resultReconciliation.status, "consistent");
  assert.equal(atp.resultReconciliation.conflictCount, 0);
  assert.match(atp.dataCompletenessGrade, /^[A-D]$/);
  assert.match(atp.basis, /not a player rating|betting grade/i);

  const wta = snapshot.records.find((record) => record.tour === "WTA");
  assert.equal(wta.timelineStatus, "unavailable");
  assert.match(wta.timelineReason, /did not include/i);
  assert.equal(wta.players[1].rank, 2);
  assert.equal(wta.statusDetail.completed, true);
  // Unknown provider fields such as odds are not copied into the normalized record.
  assert.equal(Object.hasOwn(atp, "odds"), false);
  assert.equal(Object.hasOwn(atp, "betting"), false);
});

test("provider player flags, rank provenance, per-set gaps, and final status stay explicit", async () => {
  const payload = scoreboardPayload({ tour: "ATP" });
  const competition = payload.events[0].groupings[0].competitions[0];
  competition.competitors[0].athlete = {
    id: "3623",
    displayName: "Jannik Sinner",
    fullName: "Jannik Sinner",
    shortName: "J. Sinner",
    flag: { alt: "Italy", href: "https://a.espncdn.com/i/teamlogos/countries/500/ita.png" },
    links: [{ rel: ["playercard", "athlete"], href: "https://www.espn.com/tennis/player/_/id/3623/jannik-sinner" }],
  };
  competition.competitors[1].athlete = {
    id: "2375",
    displayName: "Alexander Zverev",
    fullName: "Alexander Zverev",
    shortName: "A. Zverev",
    flag: { alt: "Germany", href: "https://a.espncdn.com/i/teamlogos/countries/500/ger.png" },
    links: [{ rel: ["playercard", "athlete"], href: "https://www.espn.com/tennis/player/_/id/2375/alexander-zverev" }],
  };
  competition.competitors[0].linescores = [
    { value: 6, winner: true },
    { value: 7, tiebreak: 8, winner: true },
  ];
  competition.competitors[1].linescores = [
    { value: 4, winner: false },
    { winner: false },
  ];
  const snapshot = await fetchSportsEvents({
    tours: "ATP",
    now: NOW,
    maxRecords: 1,
    maxTimelineRequests: 0,
    fetchImpl: async (url) => {
      if (url.endsWith("/atp/rankings")) return response({ rankings: [] });
      if (url.endsWith("/atp/scoreboard")) return response(payload);
      return response({}, 404);
    },
  });
  const record = snapshot.records[0];
  assert.equal(record.statusDetail.completionStatus, "final");
  assert.equal(record.statusDetail.completed, true);
  assert.equal(record.statusDetail.final, true);
  assert.equal(record.statusDetail.source, "provider-reported");
  assert.equal(record.completion.status, "final");
  assert.equal(record.players[0].country, "Italy");
  assert.equal(record.players[0].countryStatus, "provider-reported");
  assert.equal(record.players[0].flagUrl, "https://a.espncdn.com/i/teamlogos/countries/500/ita.png");
  assert.equal(record.players[0].rank, null);
  assert.equal(record.players[0].rankStatus, "unavailable");
  assert.equal(record.setScores[1].scores[0].tiebreak, 8);
  assert.equal(record.setScores[1].scores[1].value, null);
  assert.equal(record.setScores[0].scoreStatus, "complete");
  assert.equal(record.setScores[1].scoreStatus, "partial");
  assert.equal(record.setScores[1].scoreCount, 1);
  assert.equal(record.setScores[1].expectedScoreCount, 2);
  assert.equal(record.setScores[1].missingScoreCount, 1);
  assert.equal(record.setScoreCompleteness.completeSets, 1);
  assert.equal(record.setScoreCompleteness.partialSets, 1);
  assert.equal(record.setScoreCompleteness.status, "partial");
  assert.equal(record.timelineStatus, "unavailable");
  assert.deepEqual(record.timeline.points, []);
});

test("provider failures are isolated and no fixture rows replace an unavailable scoreboard", async () => {
  const snapshot = await fetchSportsEvents({
    fetchImpl: async (url) => {
      if (url.endsWith("/atp/rankings")) return response(rankingsPayload("ATP"));
      if (url.endsWith("/atp/scoreboard")) return response(scoreboardPayload({ tour: "ATP" }));
      throw new Error("offline provider");
    },
    now: NOW,
    maxRecords: 4,
  });
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.sources.filter((source) => source.available).length, 2);
  assert.equal(snapshot.records[0].tour, "ATP");

  const empty = createUnavailableSportsEvents({ retrievedAt: NOW });
  assert.equal(empty.records.length, 0);
  assert.equal(empty.rankings.length, 0);
  assert.match(empty.reason, /No public ESPN/i);
  const unavailable = await fetchSportsEvents({ fetchImpl: async () => { throw new Error("offline"); }, now: NOW });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.records.length, 0);
  assert.equal(unavailable.providerUnavailable, true);
});

test("summary and replay preserve source provenance without refetching", async () => {
  let calls = 0;
  const snapshot = await fetchSportsEvents({
    fetchImpl: async (url) => {
      calls += 1;
      if (url.endsWith("/atp/rankings")) return response(rankingsPayload("ATP"));
      if (url.endsWith("/wta/rankings")) return response(rankingsPayload("WTA"));
      if (url.endsWith("/atp/scoreboard")) return response(scoreboardPayload({ tour: "ATP" }));
      return response(scoreboardPayload({ tour: "WTA" }));
    },
    now: NOW,
    maxRecords: 4,
  });
  const summary = summarizeSportsEvents(snapshot);
  assert.equal(summary.recordCount, 2);
  assert.equal(summary.rankingCount, 4);
  assert.equal(summary.setCount, 6);
  assert.equal(summary.timelineAvailableCount, 0);
  assert.equal(summary.reconciliationConsistentCount, 2);
  assert.equal(summary.reconciliationConflictCount, 0);
  assert.deepEqual(summary.tours, ["ATP", "WTA"]);
  const replay = replaySportsEvents(snapshot, snapshot.records[0].id, "test");
  assert.equal(calls, 4);
  assert.equal(replay.recordId, snapshot.records[0].id);
  assert.equal(replay.externalNetwork, false);
  assert.equal(replay.liveFetch, false);
  assert.equal(replay.record.dataCompletenessGrade, snapshot.records[0].dataCompletenessGrade);
});

test("endpoint contract stays HTTPS-only, bounded, and credential-free", async () => {
  assert.equal(SPORTS_EVENTS_ENDPOINTS.length, 4);
  assert.ok(SPORTS_EVENTS_ENDPOINTS.every((endpoint) => endpoint.endpoint.startsWith("https://site.web.api.espn.com/")));
  const source = await readFile(new URL("../src/domains/sports-events.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /authorization|api[_-]?key|client[_-]?secret/i);
  assert.match(source, /SPORTS_EVENTS_MAX_RECORDS/);
  assert.match(source, /SPORTS_EVENTS_FETCH_TIMEOUT_MS/);
  assert.match(source, /timeline.*unavailable|unavailable[\s\S]*timeline/i);
});

test("secondary parity stays an explicit unavailable contract until an independent source passes verification", async () => {
  assert.equal(SPORTS_EVENTS_SECONDARY_PROVIDER.status, "unavailable");
  assert.equal(SPORTS_EVENTS_SECONDARY_PROVIDER.availability, "not-configured");
  assert.equal(SPORTS_EVENTS_SECONDARY_PROVIDER.endpoint, null);
  const status = createSecondaryParityStatus({
    id: "espn-tennis:atp:event:match",
    matchId: "match-1",
    eventTime: NOW,
    retrievedAt: NOW,
    players: [{ id: "one", name: "Player One" }, { id: "two", name: "Player Two" }],
  });
  assert.equal(status.compared, false);
  assert.equal(status.agreement, "unavailable");
  assert.equal(status.context.matchId, "match-1");
  assert.equal(status.context.playerNames.join(" vs "), "Player One vs Player Two");
  assert.equal(status.fields.length, SPORTS_EVENTS_SECONDARY_PROVIDER.fields.length);
  assert.ok(status.fields.every((field) => field.status === "unavailable" && field.agreement === "unavailable"));
  assert.equal(status.externalNetwork, false);
  assert.match(status.reason, /no documented browser-safe credential-free secondary endpoint/i);

  const requested = [];
  const snapshot = await fetchSportsEvents({
    tours: "ATP",
    now: NOW,
    maxRecords: 1,
    fetchImpl: async (url) => {
      requested.push(url);
      if (url.endsWith("/atp/rankings")) return response(rankingsPayload("ATP"));
      if (url.endsWith("/atp/scoreboard")) return response(scoreboardPayload({ tour: "ATP" }));
      return response({}, 404);
    },
  });
  assert.equal(snapshot.secondaryParity.status, "unavailable");
  assert.equal(snapshot.secondaryParity.compared, false);
  assert.equal(snapshot.secondaryParity.endpoint, null);
  assert.equal(requested.length, 2);
  assert.ok(requested.every((url) => url.includes("site.web.api.espn.com")));
});

test("nested public timeline containers are normalized and tour filters accept a single tour", async () => {
  const payload = scoreboardPayload({ tour: "ATP" });
  payload.events[0].groupings[0].competitions[0].timeline = {
    events: [{ sequence: 1, period: 2, description: "Sinner wins the point", displayValue: "15-0" }],
  };
  const requested = [];
  const snapshot = await fetchSportsEvents({
    tours: "ATP",
    now: NOW,
    maxRecords: 4,
    fetchImpl: async (url) => {
      requested.push(url);
      if (url.endsWith("/atp/rankings")) return response(rankingsPayload("ATP"));
      if (url.endsWith("/atp/scoreboard")) return response(payload);
      return response({}, 404);
    },
  });
  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.tours, ["ATP"]);
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.records[0].timeline.available, true);
  assert.equal(snapshot.records[0].timeline.points[0].text, "Sinner wins the point");
  assert.ok(requested.every((url) => url.includes("/atp/")));
});

test("provider-returned public detail references are fetched once and nested set/game/point fields are preserved", async () => {
  const payload = scoreboardPayload({ tour: "ATP" });
  payload.events[0].groupings[0].competitions[0].$ref = "http://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/events/tournament-1/competitions/match-1?lang=en&region=us";
  const requested = [];
  const snapshot = await fetchSportsEvents({
    tours: "ATP",
    now: NOW,
    maxRecords: 4,
    fetchImpl: async (url) => {
      requested.push(url);
      if (url.endsWith("/atp/rankings")) return response(rankingsPayload("ATP"));
      if (url.endsWith("/atp/scoreboard")) return response(payload);
      if (url.startsWith("https://sports.core.api.espn.com/")) {
        return response({
          sets: [{ number: 1, games: [{ number: 2, points: [
            { number: 1, id: "point-1", description: "Sinner wins the point", displayValue: "15-0" },
            { number: 2, id: "point-2", description: "Zverev levels the game", displayValue: "15-15" },
          ] }] }],
        });
      }
      return response({}, 404);
    },
  });
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.records.length, 1);
  assert.equal(requested.length, 3);
  assert.equal(requested[2].startsWith("https://sports.core.api.espn.com/"), true);
  const record = snapshot.records[0];
  assert.equal(record.timeline.available, true);
  assert.equal(record.timeline.points.length, 2);
  assert.deepEqual(record.timeline.points.map((point) => [point.set, point.game, point.point]), [[1, 2, 1], [1, 2, 2]]);
  assert.equal(record.timeline.points[0].text, "Sinner wins the point");
  assert.equal(record.timeline.points[1].score, "15-15");
  assert.equal(record.timelineRequestStatus, "available");
  assert.equal(snapshot.timelineRequestCount, 1);
  assert.equal(snapshot.timelineSources[0].available, true);
  assert.match(record.dataCompletenessGrade, /^[A-B]$/);
});

test("timeline request budget and unsafe references fail closed without inventing points", async () => {
  const payload = scoreboardPayload({ tour: "ATP" });
  payload.events[0].groupings[0].competitions[0].$ref = "https://example.invalid/tennis/plays/match-1";
  let calls = 0;
  const snapshot = await fetchSportsEvents({
    tours: "ATP",
    maxTimelineRequests: 0,
    now: NOW,
    fetchImpl: async (url) => {
      calls += 1;
      if (url.endsWith("/atp/rankings")) return response(rankingsPayload("ATP"));
      if (url.endsWith("/atp/scoreboard")) return response(payload);
      return response({}, 404);
    },
  });
  assert.equal(calls, 2);
  assert.equal(snapshot.records[0].timeline.available, false);
  assert.equal(snapshot.records[0].timeline.points.length, 0);
  assert.equal(snapshot.records[0].timelineRequestStatus, "not-requested");
  assert.equal(snapshot.timelineRequestCount, 0);
  assert.equal(snapshot.timelineSources.length, 0);
});

test("explicit detail inspection follows only provider competition and eligible plays references", async () => {
  const record = {
    id: "espn-tennis:atp:tournament-1:match-1",
    tour: "ATP",
    tournament: { id: "tournament-1", name: "Test Open" },
    match: { id: "match-1" },
    matchId: "match-1",
    players: [{ id: "3623", name: "Jannik Sinner" }, { id: "2375", name: "Alexander Zverev" }],
    setScores: [],
    detailReferences: [],
    timeline: { status: "unavailable", available: false, points: [], reason: "not loaded" },
    timelineStatus: "unavailable",
  };
  const detailUrl = publicCompetitionDetailReference(record);
  assert.equal(detailUrl, `${SPORTS_EVENTS_DETAIL_BASE}/atp/events/tournament-1/competitions/match-1?lang=en&region=us`);
  const requested = [];
  const result = await fetchSportsEventDetail({
    record,
    now: NOW,
    fetchImpl: async (url) => {
      requested.push(url);
      if (url === detailUrl) {
        return response({
          $ref: detailUrl.replace("https://", "http://"),
          commentaryAvailable: true,
          liveAvailable: false,
          summaryAvailable: true,
          notes: [{ text: "Provider detail note" }],
          odds: { $ref: "https://sports.core.api.espn.com/v2/odds/should-not-be-requested" },
        });
      }
      if (url === `${SPORTS_EVENTS_DETAIL_BASE}/atp/events/tournament-1/competitions/match-1/plays?lang=en&region=us`) {
        return response({ items: [
          { sequence: 1, period: 1, game: 2, point: 1, description: "Sinner wins the point", displayValue: "15-0" },
          { sequence: 2, period: 1, game: 2, point: 2, description: "Zverev levels the game", displayValue: "15-15" },
        ] });
      }
      return response({}, 404);
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.source, SPORTS_EVENTS_DETAIL_SOURCE);
  assert.equal(result.requestCount, 2);
  assert.equal(result.requestCount <= SPORTS_EVENTS_MAX_DETAIL_REQUESTS, true);
  assert.deepEqual(requested, [detailUrl, `${SPORTS_EVENTS_DETAIL_BASE}/atp/events/tournament-1/competitions/match-1/plays?lang=en&region=us`]);
  assert.equal(result.record.publicDetail.status, "available");
  assert.equal(result.record.publicDetail.commentaryAvailable, true);
  assert.equal(result.record.publicDetail.notes[0], "Provider detail note");
  assert.equal(result.record.timelineStatus, "available");
  assert.equal(result.record.timeline.points.length, 2);
  assert.deepEqual(result.record.timeline.points.map((point) => [point.set, point.game, point.point]), [[1, 2, 1], [1, 2, 2]]);
  assert.equal(result.timelineSources.length, 2);
  assert.equal(result.timelineSources[1].kind, "play-by-play");
  assert.equal(result.timelineSources[1].available, true);
  assert.equal(result.record.truthClaim, false);
  assert.equal(result.record.executable, false);
  assert.equal(requested.some((url) => /odds|betting|pickcenter/i.test(url)), false);
});

test("provider detail remains honest when commentary is unavailable or the request fails", async () => {
  const record = {
    id: "espn-tennis:wta:tournament-2:match-2",
    tour: "WTA",
    tournament: { id: "tournament-2" },
    matchId: "match-2",
    players: [{ id: "1", name: "Player One" }, { id: "2", name: "Player Two" }],
    detailReferences: [],
  };
  const detailUrl = publicCompetitionDetailReference(record);
  const requested = [];
  const unavailable = await fetchSportsEventDetail({
    record,
    now: NOW,
    fetchImpl: async (url) => {
      requested.push(url);
      return response({ $ref: detailUrl, commentaryAvailable: false, liveAvailable: false, summaryAvailable: true });
    },
  });
  assert.equal(unavailable.status, "ready");
  assert.equal(unavailable.requestCount, 1);
  assert.deepEqual(requested, [detailUrl]);
  assert.equal(unavailable.record.publicDetail.commentaryStatus, "unavailable");
  assert.equal(unavailable.record.timelineStatus, "unavailable");
  assert.equal(unavailable.record.timeline.points.length, 0);
  assert.match(unavailable.record.timelineRequestReason, /commentary\/play-by-play unavailable/i);
  assert.equal(unavailable.timelineSources.length, 1);
  assert.equal(unavailable.timelineSources[0].available, true);

  const failed = await fetchSportsEventDetail({ record, now: NOW, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.requestCount, 1);
  assert.equal(failed.externalNetwork, true);
  assert.equal(failed.record.publicDetail.status, "unavailable");
  assert.equal(failed.record.timeline.points.length, 0);
  assert.match(failed.reason, /detail request failed/i);
});

test("result reconciliation reports agreement and provider-field conflicts without inventing a second source", () => {
  const consistent = reconcileSportsResult({
    players: [{ id: "a", name: "Player A", winner: true }, { id: "b", name: "Player B", winner: false }],
    setScores: [{
      set: 1,
      scores: [{ athleteId: "a", value: 6, winner: true }, { athleteId: "b", value: 3, winner: false }],
      scoreCount: 2,
      expectedScoreCount: 2,
      scoreStatus: "complete",
    }],
    statusDetail: { completed: true, final: true },
    completion: { completed: true, final: true },
  });
  assert.equal(consistent.status, "consistent");
  assert.equal(consistent.conflictCount, 0);
  assert.equal(consistent.availableCheckCount, 5);
  assert.match(consistent.basis, /one provider response only/i);

  const conflict = reconcileSportsResult({
    players: [{ id: "a", name: "Player A", winner: true }, { id: "b", name: "Player B", winner: true }],
    setScores: [{
      set: 1,
      scores: [{ athleteId: "a", value: 6, winner: false }, { athleteId: "b", value: 3, winner: true }],
      scoreCount: 1,
      expectedScoreCount: 2,
      scoreStatus: "complete",
    }],
    statusDetail: { completed: true, final: false },
    completion: { completed: true, final: true },
  });
  assert.equal(conflict.status, "conflict");
  assert.ok(conflict.conflictCount >= 3);
  assert.equal(conflict.truthClaim, false);
  assert.equal(conflict.executable, false);
});
