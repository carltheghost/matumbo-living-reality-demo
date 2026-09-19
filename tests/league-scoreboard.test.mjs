/**
 * Tests for the maTumbo "all leagues" Phase 2 scoreboard queue.
 *
 * Covers src/domains/multi-sport-events.js (league queue, date/format
 * helpers, status classifier, replay) and src/data/league-catalog.js.
 * Uses node's built-in test runner; no test framework dependency.
 *
 * Run: node --test tests/league-scoreboard.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert";
import {
  LEAGUE_SCOREBOARD_CACHE_TTLS,
  LEAGUE_SCOREBOARD_MIN_INTERVAL_MS,
  LEAGUE_SCOREBOARD_SESSION_BUDGET,
  LEAGUE_SCOREBOARD_SLUG_PATTERN,
  classifyScoreboardStatus,
  createLeagueScoreboardQueue,
  fetchMultiSportEvents,
  formatScoreboardDate,
  replayLeagueScoreboard,
} from "../src/domains/multi-sport-events.js";
import {
  LEAGUE_CATALOG,
  LEAGUE_UNAVAILABLE,
  findLeagueCatalogEntry,
  leagueCatalogRegions,
} from "../src/data/league-catalog.js";

/* ----------------------------- helpers -------------------------------- */

function makeClock(startIso = "2026-09-19T12:00:00.000Z") {
  let t = Date.parse(startIso);
  const now = () => new Date(t).toISOString();
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

function makeCompetition({ id, state = "pre", completed = false, description = "Scheduled", clock = null, period = null, date = "2026-09-19T14:00:00Z" }) {
  return {
    id,
    startDate: date,
    status: { type: { state, completed, description }, displayClock: clock, period },
    competitors: [
      { id: `${id}-home`, team: { displayName: "Home United", abbreviation: "HOM" }, score: "2", homeAway: "home" },
      { id: `${id}-away`, team: { displayName: "Away Rovers", abbreviation: "AWY" }, score: "1", homeAway: "away" },
    ],
    venue: { fullName: "Test Arena", address: { city: "Testville", country: "Testland" } },
    links: [],
  };
}

function makePayload(...competitions) {
  return {
    events: competitions.map((competition) => ({
      id: competition.id,
      date: competition.startDate,
      name: `Game ${competition.id}`,
      competitions: [competition],
    })),
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

/** Stub fetch that records calls and answers from a per-call body factory. */
function stubFetch(bodyFactory, { delayMs = 0 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const call = { url, init, startedAt: Date.now() };
    calls.push(call);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return bodyFactory(call);
  };
  return { fetchImpl, calls };
}

/** Stub fetch that hangs until its AbortSignal fires (for supersede tests). */
function abortableStubFetch(bodyFactory, { delayMs = 60 } = {}) {
  const calls = [];
  const fetchImpl = (url, init = {}) => {
    const call = { url, init, aborted: false };
    calls.push(call);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(bodyFactory(call)), delayMs);
      init.signal?.addEventListener("abort", () => {
        call.aborted = true;
        clearTimeout(timer);
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  };
  return { fetchImpl, calls };
}

const LIVE_PAYLOAD = () => makePayload(
  makeCompetition({ id: "live-1", state: "in", completed: false, description: "2nd Half", clock: "67'", period: 2 }),
);
const SETTLED_PAYLOAD = () => makePayload(
  makeCompetition({ id: "sched-1", state: "pre", completed: false, description: "Scheduled" }),
  makeCompetition({ id: "final-1", state: "post", completed: true, description: "Full Time" }),
);
const EMPTY_PAYLOAD = () => ({ events: [] });

/* ------------------------------ catalog -------------------------------- */

test("catalog: 83 frozen entries, no duplicate slugs, pattern-clean", () => {
  assert.strictEqual(LEAGUE_CATALOG.length, 83);
  assert.ok(Object.isFrozen(LEAGUE_CATALOG), "catalog array must be frozen");
  const slugs = new Set();
  for (const entry of LEAGUE_CATALOG) {
    assert.ok(Object.isFrozen(entry), `entry ${entry.slug} must be frozen`);
    assert.strictEqual(typeof entry.slug, "string");
    assert.strictEqual(typeof entry.label, "string");
    assert.strictEqual(typeof entry.region, "string");
    assert.ok(LEAGUE_SCOREBOARD_SLUG_PATTERN.test(entry.slug), `slug fails pattern: ${entry.slug}`);
    assert.ok(!slugs.has(entry.slug), `duplicate slug: ${entry.slug}`);
    slugs.add(entry.slug);
  }
});

test("catalog: region order is Popular first, International last, A-Z between", () => {
  const regions = leagueCatalogRegions();
  assert.strictEqual(regions[0], "Popular");
  assert.strictEqual(regions[regions.length - 1], "International");
  const middle = regions.slice(1, -1);
  assert.deepStrictEqual(middle, [...middle].sort((a, b) => a.localeCompare(b)));
  // Every catalog entry's region is represented exactly once in the order list.
  const entryRegions = new Set(LEAGUE_CATALOG.map((entry) => entry.region));
  assert.deepStrictEqual(new Set(regions), entryRegions);
});

test("catalog: lookup by slug; unknown slugs miss; unavailable list is informative", () => {
  const epl = findLeagueCatalogEntry("eng.1");
  assert.ok(epl);
  assert.strictEqual(epl.label, "EPL");
  assert.strictEqual(findLeagueCatalogEntry("conmebol.libertadores")?.region, "International");
  assert.strictEqual(findLeagueCatalogEntry("nope.nope"), null);
  assert.strictEqual(findLeagueCatalogEntry("ENG.1"), null, "lookup is case-sensitive");
  assert.ok(Array.isArray(LEAGUE_UNAVAILABLE) && LEAGUE_UNAVAILABLE.length > 0);
  for (const entry of LEAGUE_UNAVAILABLE) {
    assert.strictEqual(typeof entry.label, "string");
  }
});

test("slug pattern: accepts catalog shapes, rejects injection shapes", () => {
  assert.ok(LEAGUE_SCOREBOARD_SLUG_PATTERN.test("eng.1"));
  assert.ok(LEAGUE_SCOREBOARD_SLUG_PATTERN.test("conmebol.libertadores"));
  // "eng..1" passes the loose shape prefilter but is rejected by the exact
  // catalog lookup before any network call (see request-guard tests below).
  for (const bad of ["eng.1?x=1", "ENG.1", "eng 1", "../etc", "eng.1/", "e", ".1", "", "x".repeat(60)]) {
    assert.ok(!LEAGUE_SCOREBOARD_SLUG_PATTERN.test(bad), `pattern must reject: ${JSON.stringify(bad)}`);
  }
});

/* --------------------------- request guards ---------------------------- */

test("non-catalog slug rejects with zero fetch calls", async () => {
  const { fetchImpl, calls } = stubFetch(() => jsonResponse(SETTLED_PAYLOAD()));
  const queue = createLeagueScoreboardQueue({ fetchImpl, minIntervalMs: 0 });
  const badSlugs = ["not-a-league", "eng.1?x=1", "ENG.1", "../etc", "eng..1", "", null, undefined, 42, "x".repeat(60)];
  for (const slug of badSlugs) {
    await assert.rejects(
      () => queue.request({ slug, date: "20260919" }),
      /Unknown or invalid league slug/,
      `slug should reject: ${JSON.stringify(slug)}`,
    );
  }
  assert.strictEqual(calls.length, 0, "no network call may happen for rejected slugs");
});

test("invalid date rejects with zero fetch calls", async () => {
  const { fetchImpl, calls } = stubFetch(() => jsonResponse(SETTLED_PAYLOAD()));
  const queue = createLeagueScoreboardQueue({ fetchImpl, minIntervalMs: 0 });
  for (const date of ["20260230", "not-a-date", "2026-13-40", ""]) {
    await assert.rejects(
      () => queue.request({ slug: "eng.1", date }),
      /Invalid scoreboard date/,
      `date should reject: ${JSON.stringify(date)}`,
    );
  }
  assert.strictEqual(calls.length, 0);
});

test("valid request builds the expected ESPN URL", async () => {
  const { fetchImpl, calls } = stubFetch(() => jsonResponse(SETTLED_PAYLOAD()));
  const queue = createLeagueScoreboardQueue({ fetchImpl, minIntervalMs: 0 });
  const { envelope } = await queue.request({ slug: "eng.1", date: "20260919" });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(
    calls[0].url,
    "https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260919",
  );
  assert.strictEqual(envelope.league, "eng.1");
  assert.strictEqual(envelope.dateParam, "20260919");
});

/* --------------------- throttle: interval + abort ---------------------- */

test("throttle: min interval between network starts is >= 1000ms", async () => {
  assert.strictEqual(LEAGUE_SCOREBOARD_MIN_INTERVAL_MS, 1000);
  const { fetchImpl, calls } = stubFetch(() => jsonResponse(SETTLED_PAYLOAD()));
  const queue = createLeagueScoreboardQueue({ fetchImpl }); // default minIntervalMs
  await queue.request({ slug: "eng.1", date: "20260919" });
  await queue.request({ slug: "esp.1", date: "20260919" });
  assert.strictEqual(calls.length, 2);
  const gap = calls[1].startedAt - calls[0].startedAt;
  assert.ok(gap >= 1000, `expected >=1000ms between network starts, got ${gap}ms`);
});

test("throttle: second request aborts the first; superseded promise resolves", async () => {
  const { fetchImpl, calls } = abortableStubFetch(() => jsonResponse(SETTLED_PAYLOAD()));
  const queue = createLeagueScoreboardQueue({ fetchImpl, minIntervalMs: 0 });
  const first = queue.request({ slug: "eng.1", date: "20260919" });
  const second = queue.request({ slug: "esp.1", date: "20260919" });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].aborted, true, "first in-flight request must be aborted");
  assert.strictEqual(firstResult.envelope.status, "unavailable", "superseded promise resolves, never drops");
  assert.strictEqual(secondResult.envelope.status, "ready");
  assert.strictEqual(secondResult.envelope.league, "esp.1");
});

/* ------------------------------ caching -------------------------------- */

test("cache: identical request hits cache without a second fetch", async () => {
  const clock = makeClock();
  const { fetchImpl, calls } = stubFetch(() => jsonResponse(SETTLED_PAYLOAD()));
  const queue = createLeagueScoreboardQueue({ fetchImpl, minIntervalMs: 0, now: clock });
  const first = await queue.request({ slug: "eng.1", date: "20260919" });
  const second = await queue.request({ slug: "eng.1", date: "20260919" });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(first.fromCache, false);
  assert.strictEqual(second.fromCache, true);
  assert.deepStrictEqual(second.envelope, first.envelope);
  assert.strictEqual(queue.stats().cacheHits, 1);
});

test("cache: TTL expiry refetches (settled TTL = 10min)", async () => {
  assert.strictEqual(LEAGUE_SCOREBOARD_CACHE_TTLS.settled, 600_000);
  const clock = makeClock();
  const { fetchImpl, calls } = stubFetch(() => jsonResponse(SETTLED_PAYLOAD()));
  const queue = createLeagueScoreboardQueue({ fetchImpl, minIntervalMs: 0, now: clock });
  await queue.request({ slug: "eng.1", date: "20260919" });
  clock.advance(599_999);
  const cached = await queue.request({ slug: "eng.1", date: "20260919" });
  assert.strictEqual(cached.fromCache, true);
  assert.strictEqual(calls.length, 1);
  clock.advance(2); // 600_001ms total: past the settled TTL
  const refetched = await queue.request({ slug: "eng.1", date: "20260919" });
  assert.strictEqual(refetched.fromCache, false);
  assert.strictEqual(calls.length, 2);
});

test("cache: TTL selection — live 45s, settled 10min, empty 3min", async () => {
  assert.strictEqual(LEAGUE_SCOREBOARD_CACHE_TTLS.live, 45_000);
  assert.strictEqual(LEAGUE_SCOREBOARD_CACHE_TTLS.empty, 180_000);
  const clock = makeClock();
  const bodyFor = (call) => {
    if (call.url.includes("/soccer/eng.1/")) return jsonResponse(LIVE_PAYLOAD());
    if (call.url.includes("/soccer/esp.1/")) return jsonResponse(SETTLED_PAYLOAD());
    return jsonResponse(EMPTY_PAYLOAD());
  };
  const { fetchImpl, calls } = stubFetch(bodyFor);
  const queue = createLeagueScoreboardQueue({ fetchImpl, minIntervalMs: 0, now: clock });
  const date = "20260919";
  await queue.request({ slug: "eng.1", date }); // live -> 45s TTL
  await queue.request({ slug: "esp.1", date }); // settled -> 600s TTL
  const emptyResult = await queue.request({ slug: "fra.1", date }); // empty -> 180s TTL
  assert.strictEqual(emptyResult.envelope.status, "ready");
  assert.strictEqual(emptyResult.envelope.empty, true);
  assert.strictEqual(calls.length, 3);

  clock.advance(46_000);
  await queue.request({ slug: "eng.1", date });
  await queue.request({ slug: "esp.1", date });
  await queue.request({ slug: "fra.1", date });
  assert.strictEqual(calls.length, 4, "only the live entry should have expired at 46s");

  clock.advance(135_000); // 181s total
  await queue.request({ slug: "eng.1", date });
  await queue.request({ slug: "esp.1", date });
  await queue.request({ slug: "fra.1", date });
  assert.strictEqual(calls.length, 6, "live + empty should have expired at 181s");

  clock.advance(420_000); // 601s total
  await queue.request({ slug: "esp.1", date });
  assert.strictEqual(calls.length, 7, "settled entry should have expired at 601s");
});

test("cache: failed or aborted fetches are never cached", async () => {
  const clock = makeClock();
  let fail = true;
  const { fetchImpl, calls } = stubFetch(() => (
    fail ? { ok: false, status: 500, json: async () => ({}) } : jsonResponse(SETTLED_PAYLOAD())
  ));
  const queue = createLeagueScoreboardQueue({ fetchImpl, minIntervalMs: 0, now: clock });
  const first = await queue.request({ slug: "eng.1", date: "20260919" });
  assert.strictEqual(first.envelope.status, "unavailable");
  assert.strictEqual(first.fromCache, false);
  fail = false;
  const second = await queue.request({ slug: "eng.1", date: "20260919" });
  assert.strictEqual(calls.length, 2, "unavailable envelopes must not poison the cache");
  assert.strictEqual(second.envelope.status, "ready");
  assert.strictEqual(second.fromCache, false);
});

/* ------------------------------ budget --------------------------------- */

test("budget: past the session budget the queue resolves a throttled envelope", async () => {
  assert.strictEqual(LEAGUE_SCOREBOARD_SESSION_BUDGET, 90);
  const { fetchImpl, calls } = stubFetch(() => jsonResponse(SETTLED_PAYLOAD()));
  const queue = createLeagueScoreboardQueue({ fetchImpl, minIntervalMs: 0, sessionBudget: 2 });
  await queue.request({ slug: "eng.1", date: "20260919" });
  await queue.request({ slug: "esp.1", date: "20260919" });
  const { envelope, fromCache } = await queue.request({ slug: "fra.1", date: "20260919" });
  assert.strictEqual(calls.length, 2, "throttled request must not hit the network");
  assert.strictEqual(fromCache, false);
  assert.strictEqual(envelope.status, "throttled");
  assert.strictEqual(envelope.throttled, true);
  assert.strictEqual(envelope.reason, "Slow down — session request budget reached");
  assert.strictEqual(envelope.liveFetch, false);
  assert.strictEqual(queue.stats().throttledCount, 1);
  assert.strictEqual(queue.stats().budgetRemaining, 0);
});

/* --------------------------- envelope shapes --------------------------- */

test("empty league: status ready with empty=true and an honest reason", async () => {
  const { fetchImpl } = stubFetch(() => jsonResponse(EMPTY_PAYLOAD()));
  const queue = createLeagueScoreboardQueue({ fetchImpl, minIntervalMs: 0 });
  const { envelope } = await queue.request({ slug: "eng.1", date: "20260919" });
  assert.strictEqual(envelope.status, "ready");
  assert.strictEqual(envelope.empty, true);
  assert.strictEqual(envelope.recordCount, 0);
  assert.deepStrictEqual(envelope.records, []);
  assert.strictEqual(envelope.emptyReason, "No matches on this date · the season may be off");
  assert.strictEqual(envelope.providerAvailable, false);
  assert.strictEqual(envelope.availableProviderCount, 0);
});

test("formatScoreboardDate: edge cases", () => {
  assert.strictEqual(formatScoreboardDate("20260919"), "20260919");
  assert.strictEqual(formatScoreboardDate("2026-09-19"), "20260919");
  assert.strictEqual(formatScoreboardDate("2026-09-19T00:00:00Z"), "20260919");
  assert.strictEqual(formatScoreboardDate(new Date(Date.UTC(2026, 8, 19))), "20260919");
  assert.strictEqual(formatScoreboardDate("20260230"), null, "Feb 30 is not a real date");
  assert.strictEqual(formatScoreboardDate("2026-13-01"), null);
  assert.strictEqual(formatScoreboardDate("not-a-date"), null);
  assert.strictEqual(formatScoreboardDate(""), null);
  assert.strictEqual(formatScoreboardDate(null), null);
  assert.strictEqual(formatScoreboardDate(undefined), null);
  assert.strictEqual(formatScoreboardDate(new Date(Number.NaN)), null);
  assert.strictEqual(formatScoreboardDate("20261301"), null, "month 13 rejected");
});

test("classifyScoreboardStatus: defensive on weird shapes", () => {
  assert.strictEqual(classifyScoreboardStatus(null), "unknown");
  assert.strictEqual(classifyScoreboardStatus(undefined), "unknown");
  assert.strictEqual(classifyScoreboardStatus({}), "unknown");
  assert.strictEqual(classifyScoreboardStatus({ statusDetail: null }), "unknown");
  assert.strictEqual(classifyScoreboardStatus({ statusDetail: "live" }), "unknown");
  assert.strictEqual(classifyScoreboardStatus({ statusDetail: {} }), "unknown");
  assert.strictEqual(classifyScoreboardStatus({ statusDetail: { state: "in" } }), "live");
  assert.strictEqual(classifyScoreboardStatus({ statusDetail: { completed: true } }), "final");
  assert.strictEqual(classifyScoreboardStatus({ statusDetail: { state: "post" } }), "final");
  assert.strictEqual(classifyScoreboardStatus({ statusDetail: { state: "pre" } }), "scheduled");
  assert.strictEqual(classifyScoreboardStatus({ statusDetail: { completed: false } }), "scheduled");
});

test("replayLeagueScoreboard: deterministic and record-selecting", async () => {
  const { fetchImpl } = stubFetch(() => jsonResponse(SETTLED_PAYLOAD()));
  const queue = createLeagueScoreboardQueue({ fetchImpl, minIntervalMs: 0 });
  const { envelope } = await queue.request({ slug: "eng.1", date: "20260919" });
  assert.strictEqual(envelope.records.length, 2);
  const firstId = envelope.records[0].id;
  const secondId = envelope.records[1].id;

  const a = replayLeagueScoreboard(envelope, firstId);
  const b = replayLeagueScoreboard(envelope, firstId);
  assert.deepStrictEqual(a, b, "replay must be deterministic");
  assert.strictEqual(a.deterministic, true);
  assert.strictEqual(a.liveFetch, false);
  assert.strictEqual(a.recordId, firstId);
  assert.strictEqual(a.record.id, firstId);

  const picked = replayLeagueScoreboard(envelope, secondId);
  assert.strictEqual(picked.record.id, secondId);
  const fallback = replayLeagueScoreboard(envelope, "no-such-id");
  assert.strictEqual(fallback.record.id, firstId, "unknown id falls back to first record");
  const none = replayLeagueScoreboard(envelope);
  assert.strictEqual(none.record.id, firstId);

  const emptyReplay = replayLeagueScoreboard({ records: [], league: "eng.1", empty: true });
  assert.strictEqual(emptyReplay.record, null);
  assert.strictEqual(emptyReplay.recordId, null);
  assert.strictEqual(emptyReplay.empty, true);
});

/* --------------------------- regression -------------------------------- */

test("regression: original 3-provider fetchMultiSportEvents still works", async () => {
  const { fetchImpl, calls } = stubFetch((call) => {
    const league = call.url.includes("/basketball/") ? "nba" : call.url.includes("/football/") ? "nfl" : "eng.1";
    return jsonResponse(makePayload(makeCompetition({ id: `row-${league}` })));
  });
  const envelope = await fetchMultiSportEvents({ fetchImpl });
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(envelope.status, "ready");
  assert.strictEqual(envelope.providerCount, 3);
  assert.strictEqual(envelope.availableProviderCount, 3);
  assert.strictEqual(envelope.recordCount, 3);
  assert.deepStrictEqual(envelope.leagues, ["eng.1", "nba", "nfl"]);
  for (const record of envelope.records) {
    assert.ok(record.title);
    assert.ok(record.eventTime);
  }
});
