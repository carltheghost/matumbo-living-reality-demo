/**
 * Public tennis evidence adapter.
 *
 * The adapter reads the browser-friendly, no-key ESPN public JSON surfaces for
 * ATP/WTA scoreboards and rankings. It intentionally stops at observation:
 * there are no odds, picks, recommendations, wagering, money, credentials,
 * persistence, or external writes. A missing set, rank, profile field, or
 * point-by-point timeline remains unavailable instead of being inferred.
 */

export const SPORTS_EVENTS_SCHEMA_VERSION = 1;
export const SPORTS_EVENTS_SOURCE = "public-tennis-events-evidence";
export const SPORTS_EVENTS_REPLAY_SOURCE = "public-tennis-events-replay";
export const SPORTS_EVENTS_MAX_RECORDS = 12;
export const SPORTS_EVENTS_MAX_RANKINGS = 250;
export const SPORTS_EVENTS_MAX_TIMELINE_POINTS = 80;
export const SPORTS_EVENTS_MAX_TIMELINE_REQUESTS = 8;
export const SPORTS_EVENTS_FETCH_TIMEOUT_MS = 9_000;
export const SPORTS_EVENTS_SECONDARY_SOURCE = "public-tennis-events-secondary-parity";
export const SPORTS_EVENTS_DETAIL_SOURCE = "public-tennis-event-detail";
export const SPORTS_EVENTS_MAX_DETAIL_REQUESTS = 3;
export const SPORTS_EVENTS_DETAIL_BASE = "https://sports.core.api.espn.com/v2/sports/tennis/leagues";

export const SPORTS_EVENTS_BOUNDARY =
  "Public ESPN tennis responses are unverified research observations. Set scores, player profiles, rankings, status, and timelines can be missing or stale; winner flags and final/completion state are shown only when provider-reported or directly represented by provider state. Per-set and match data-completeness grades are not player ratings, predictions, or betting signals, and no financial or executable authority is active.";

/**
 * The secondary-source gate is deliberately explicit. A documented,
 * browser-safe, credential-free independent tennis endpoint has not passed the
 * current verification gate, so no second provider is requested and no rows
 * are fabricated to make parity appear available.
 */
export const SPORTS_EVENTS_SECONDARY_PROVIDER = Object.freeze({
  id: "independent-tennis-source-unavailable",
  provider: "Independent public tennis source",
  endpoint: null,
  protocol: "HTTPS public read · verification gate",
  status: "unavailable",
  availability: "not-configured",
  reason: "No documented browser-safe credential-free secondary endpoint passed verification; independent parity was not requested.",
  fields: Object.freeze([
    "match",
    "players",
    "rankings",
    "status",
    "final",
    "winner",
    "setScores",
    "timeline",
  ]),
});

const ESPN_WEB_BASE = "https://site.web.api.espn.com/apis/site/v2/sports/tennis";

/** Documented public endpoints used by the default refresh. */
export const SPORTS_EVENTS_ENDPOINTS = Object.freeze([
  Object.freeze({
    id: "espn-atp-scoreboard",
    provider: "ESPN public web API · ATP scoreboard",
    endpoint: `${ESPN_WEB_BASE}/atp/scoreboard`,
    format: "scoreboard",
    tour: "ATP",
  }),
  Object.freeze({
    id: "espn-wta-scoreboard",
    provider: "ESPN public web API · WTA scoreboard",
    endpoint: `${ESPN_WEB_BASE}/wta/scoreboard`,
    format: "scoreboard",
    tour: "WTA",
  }),
  Object.freeze({
    id: "espn-atp-rankings",
    provider: "ESPN public web API · ATP rankings",
    endpoint: `${ESPN_WEB_BASE}/atp/rankings`,
    format: "rankings",
    tour: "ATP",
  }),
  Object.freeze({
    id: "espn-wta-rankings",
    provider: "ESPN public web API · WTA rankings",
    endpoint: `${ESPN_WEB_BASE}/wta/rankings`,
    format: "rankings",
    tour: "WTA",
  }),
]);

const freeze = (value) => Object.freeze(value);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = null) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
}

function integer(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) ? candidate : fallback;
}

function timestamp(value) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  return timestamp(value) ?? new Date().toISOString();
}

function publicSourceUrl(value) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Return the fail-closed parity contract for a normalized ESPN match. This is
 * intentionally a status object, not a synthetic provider result: until an
 * independent source passes the endpoint/CORS/provenance gate, every parity
 * field remains unavailable and no secondary network request is made.
 */
export function createSecondaryParityStatus(record = null) {
  const players = Array.isArray(record?.players)
    ? record.players
    : Array.isArray(record?.competitors) ? record.competitors : [];
  const matchId = text(record?.matchId ?? record?.match?.id ?? record?.id);
  const observedAt = timestamp(record?.sourceObservedAt ?? record?.retrievedAt);
  const context = Object.freeze({
    recordId: text(record?.id),
    matchId,
    eventTime: timestamp(record?.eventTime),
    playerIds: Object.freeze(players.map((player) => text(player?.id)).filter(Boolean)),
    playerNames: Object.freeze(players.map((player) => text(player?.name ?? player?.displayName)).filter(Boolean)),
    observedAt,
  });
  const fieldReason = SPORTS_EVENTS_SECONDARY_PROVIDER.reason;
  const fields = Object.freeze(SPORTS_EVENTS_SECONDARY_PROVIDER.fields.map((id) => Object.freeze({
    id,
    status: "unavailable",
    agreement: "unavailable",
    reason: fieldReason,
  })));
  return deepFreeze({
    schemaVersion: SPORTS_EVENTS_SCHEMA_VERSION,
    source: SPORTS_EVENTS_SECONDARY_SOURCE,
    providerId: SPORTS_EVENTS_SECONDARY_PROVIDER.id,
    provider: SPORTS_EVENTS_SECONDARY_PROVIDER.provider,
    endpoint: SPORTS_EVENTS_SECONDARY_PROVIDER.endpoint,
    protocol: SPORTS_EVENTS_SECONDARY_PROVIDER.protocol,
    status: "unavailable",
    availability: SPORTS_EVENTS_SECONDARY_PROVIDER.availability,
    reason: fieldReason,
    context,
    fields,
    compared: false,
    agreement: "unavailable",
    conflictCount: 0,
    retrievedAt: null,
    observedAt,
    liveFetch: false,
    externalNetwork: false,
    externalSource: false,
    localOnly: true,
    simulation: true,
    truthClaim: false,
    executable: false,
    boundary: "Independent parity is unavailable until a documented browser-safe credential-free source passes verification; ESPN remains the sole provider and no match rows are fabricated.",
  });
}

// ESPN core responses currently expose `$ref` values with an `http` scheme
// even though the same public resource is served over HTTPS. Upgrade only
// that provider-owned reference; all network requests remain HTTPS-only.
function publicReference(value) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" && /(?:^|\.)espn\.com$/i.test(parsed.hostname)) parsed.protocol = "https:";
    return publicSourceUrl(parsed.toString());
  } catch {
    return null;
  }
}

function safeError(error) {
  if (error?.name === "AbortError" || /\babort(?:ed|ing)?\b/i.test(String(error?.message ?? ""))) {
    return "Provider request timed out before a usable response arrived.";
  }
  const message = text(error?.message ?? error, "provider unavailable");
  return message.slice(0, 180);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return Object.freeze(value);
}

function linksFrom(value) {
  const links = Array.isArray(value?.links) ? value.links : [];
  return links
    .map((link) => ({
      href: publicSourceUrl(link?.href ?? link?.url),
      rel: Array.isArray(link?.rel) ? link.rel.filter((entry) => typeof entry === "string") : [],
      text: text(link?.text ?? link?.shortText),
    }))
    .filter((link) => link.href);
}

function firstLink(value, preferred = []) {
  const links = linksFrom(value);
  for (const relation of preferred) {
    const match = links.find((link) => link.rel.includes(relation));
    if (match) return match.href;
  }
  return links[0]?.href ?? null;
}

function athleteCountry(raw, fallback = {}) {
  const flag = isRecord(raw?.flag) ? raw.flag : {};
  const country = text(
    raw?.flagAltText
      ?? raw?.country
      ?? raw?.countryName
      ?? raw?.citizenshipCountry
      ?? flag.alt
      ?? flag.text,
    fallback.country ?? null,
  );
  const countryCode = text(
    raw?.countryCode
      ?? raw?.citizenshipCountryCode
      ?? raw?.citizenshipCountry,
    fallback.countryCode ?? null,
  );
  return {
    country,
    countryCode,
    flagUrl: publicSourceUrl(flag.href ?? flag.url),
    status: country || countryCode ? "provider-reported" : "unavailable",
  };
}

function referenceFrom(value) {
  if (typeof value === "string") return publicReference(value);
  if (!isRecord(value)) return null;
  return publicReference(value.href ?? value.url ?? value.$ref);
}

function collectDetailReferences(...values) {
  const references = [];
  const seen = new Set();
  const add = (value) => {
    const reference = referenceFrom(value);
    if (reference && !seen.has(reference)) {
      seen.add(reference);
      references.push(reference);
    }
  };
  const walk = (value, depth = 0) => {
    if (depth > 3 || value === null || value === undefined) return;
    add(value);
    if (Array.isArray(value)) {
      value.slice(0, 32).forEach((entry) => walk(entry, depth + 1));
      return;
    }
    if (!isRecord(value)) return;
    linksFrom(value).forEach(add);
    ["summary", "details", "athlete", "linescores", "timeline", "playByPlay", "plays", "events", "points", "actions", "items", "sets", "games"].forEach((key) => walk(value[key], depth + 1));
  };
  values.forEach((value) => walk(value));
  return references.slice(0, 12);
}

function isTimelineReference(value) {
  const reference = publicReference(value);
  if (!reference) return false;
  try {
    const parsed = new URL(reference);
    if (!/(?:^|\.)espn\.com$/i.test(parsed.hostname)) return false;
    const path = parsed.pathname.toLowerCase();
    if (/(?:odds|betting|pickcenter)/i.test(`${path}${parsed.search}`)) return false;
    return /(?:\/plays?(?:\/|$)|\/play[-_]?by[-_]?play(?:\/|$)|\/timeline(?:\/|$)|\/commentary(?:\/|$)|\/summary(?:\/|$)|\/competitions\/[^/]+$)/i.test(path);
  } catch {
    return false;
  }
}

/**
 * Build the bounded ESPN core competition detail URL from identifiers that
 * were returned by the scoreboard. This is an explicit inspection surface;
 * the normal scoreboard refresh never requests it. Keeping the construction
 * here makes the provider lineage visible while still rejecting arbitrary
 * user-supplied URLs and non-ATP/WTA records.
 */
export function publicCompetitionDetailReference(record) {
  const tour = text(record?.tour).toLowerCase();
  const eventId = text(record?.tournament?.id);
  const matchId = text(record?.matchId ?? record?.match?.id);
  if (!['atp', 'wta'].includes(tour) || !eventId || !matchId) return null;
  const candidate = `${SPORTS_EVENTS_DETAIL_BASE}/${tour}/events/${encodeURIComponent(eventId)}/competitions/${encodeURIComponent(matchId)}?lang=en&region=us`;
  return isTimelineReference(candidate) ? candidate : null;
}

function publicCompetitionPlaysReference(detailUrl) {
  if (!isTimelineReference(detailUrl)) return null;
  try {
    const parsed = new URL(detailUrl);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/plays`;
    return isTimelineReference(parsed.toString()) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function collectTimelineReferences(...values) {
  return collectDetailReferences(...values).filter(isTimelineReference).slice(0, 4);
}

const TIMELINE_CHILD_KEYS = Object.freeze([
  "points",
  "plays",
  "events",
  "actions",
  "items",
  "sets",
  "games",
  "gamePoints",
  "pointByPoint",
]);

function displayScore(value) {
  if (isRecord(value)) {
    const direct = text(value.displayValue ?? value.display ?? value.text ?? value.description ?? value.value);
    if (direct) return direct;
    const compact = Object.values(value)
      .filter((entry) => typeof entry === "string" || typeof entry === "number")
      .slice(0, 4)
      .map((entry) => String(entry))
      .join("-");
    return compact || null;
  }
  return text(value);
}

function timelineContext(value, inherited = {}) {
  const set = integer(value?.set ?? value?.setNumber ?? value?.setIndex ?? value?.period ?? value?.periodNumber, inherited.set ?? null);
  const game = integer(value?.game ?? value?.gameNumber ?? value?.gameIndex, inherited.game ?? null);
  const point = integer(value?.point ?? value?.pointNumber, inherited.point ?? null);
  return { set, game, point };
}

function childTimelineContext(key, value, inherited) {
  const context = { ...inherited };
  const numberValue = integer(value?.number ?? value?.index ?? value?.sequence);
  if (key === "sets" && numberValue !== null) context.set = numberValue;
  if (key === "games" && numberValue !== null) context.game = numberValue;
  if (["points", "plays", "events", "actions", "items", "gamePoints", "pointByPoint"].includes(key) && numberValue !== null) context.point = numberValue;
  return context;
}

function hasTimelineSignal(value, context) {
  if (!isRecord(value)) return false;
  const eventText = text(value.text ?? value.description ?? value.shortText ?? value.label ?? value.result ?? value.outcome);
  const typedText = text(value.type?.text);
  const score = displayScore(value.score ?? value.displayValue ?? value.value);
  const identifier = text(value.id ?? value.uid ?? value.sequence);
  const hasTimelineContext = context.set !== null || context.game !== null || context.point !== null || value.period !== undefined || value.set !== undefined || value.game !== undefined || value.point !== undefined;
  return Boolean(eventText || (typedText && hasTimelineContext) || score || (identifier && hasTimelineContext));
}

function flattenTimelineEntries(value, inherited = {}, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.slice(0, SPORTS_EVENTS_MAX_TIMELINE_POINTS * 4)
      .flatMap((entry) => flattenTimelineEntries(entry, inherited, depth + 1));
  }
  if (!isRecord(value)) return [];
  const context = timelineContext(value, inherited);
  const entries = hasTimelineSignal(value, context) ? [{ value, context }] : [];
  TIMELINE_CHILD_KEYS.forEach((key) => {
    if (Array.isArray(value[key])) {
      value[key].slice(0, SPORTS_EVENTS_MAX_TIMELINE_POINTS * 4).forEach((entry) => {
        entries.push(...flattenTimelineEntries(entry, childTimelineContext(key, entry, context), depth + 1));
      });
    }
  });
  return entries;
}

function timelineEntries(raw) {
  const candidates = [raw?.timeline, raw?.playByPlay, raw?.plays, raw?.actions, raw?.events, raw?.items, raw];
  for (const candidate of candidates) {
    const entries = flattenTimelineEntries(candidate);
    if (entries.length) return entries;
  }
  return [];
}

function scoreValue(value) {
  if (isRecord(value)) {
    return number(value.value ?? value.score ?? value.points, null);
  }
  return number(value, null);
}

function scoreWinner(value) {
  return isRecord(value) && typeof value.winner === "boolean" ? value.winner : null;
}

function normalizeTimeline(raw, detailReferences, unavailableReason = "The public scoreboard payload did not include a point-by-point timeline.") {
  const candidates = timelineEntries(raw);
  if (!Array.isArray(candidates) || !candidates.length) {
    return {
      status: "unavailable",
      available: false,
      reason: unavailableReason,
      points: [],
      references: detailReferences,
    };
  }
  const points = candidates.slice(0, SPORTS_EVENTS_MAX_TIMELINE_POINTS).map(({ value: point, context }, index) => {
    if (!isRecord(point)) return null;
    const set = integer(point.set ?? point.setNumber ?? point.setIndex ?? point.period ?? point.periodNumber, context.set);
    const game = integer(point.game ?? point.gameNumber ?? point.gameIndex, context.game);
    const pointNumber = integer(point.point ?? point.pointNumber, context.point);
    return {
      index: index + 1,
      id: text(point.id ?? point.uid ?? point.sequence, `point-${index + 1}`),
      kind: text(point.kind ?? point.level ?? point.type?.name ?? point.type, game !== null ? "game" : set !== null && pointNumber === null ? "set" : "point"),
      text: text(point.text ?? point.description ?? point.shortText ?? point.label ?? point.result ?? point.outcome ?? point.type?.text),
      period: integer(point.period ?? point.periodNumber, set),
      set,
      game,
      point: pointNumber,
      clock: text(point.clock ?? point.time ?? point.displayClock),
      score: displayScore(point.score ?? point.displayValue ?? point.value),
      athlete: text(point.athlete?.displayName ?? point.player?.displayName ?? point.player?.name),
      sourceUrl: publicReference(point.$ref ?? point.href ?? point.url),
    };
  }).filter((point) => point && (point.text || point.score || point.period !== null));
  if (!points.length) {
    return {
      status: "unavailable",
      available: false,
      reason: "A provider timeline field was present, but it contained no usable point records.",
      points: [],
      references: detailReferences,
    };
  }
  return {
    status: "available",
    available: true,
    reason: null,
    points,
    references: detailReferences,
  };
}

function rankLookupKey(tour, id) {
  const normalizedId = text(id);
  return normalizedId ? `${String(tour ?? "").toUpperCase()}:${normalizedId}` : null;
}

function normalizeRankings(payload, endpoint, retrievedAt, lookup) {
  const rankingRows = Array.isArray(payload?.rankings)
    ? payload.rankings
    : Array.isArray(payload?.availableRankings)
      ? payload.availableRankings
      : [];
  const flattened = [];
  rankingRows.forEach((ranking) => {
    const ranks = Array.isArray(ranking?.ranks) ? ranking.ranks : [];
    ranks.slice(0, SPORTS_EVENTS_MAX_RANKINGS).forEach((row) => {
      const athlete = isRecord(row?.athlete) ? row.athlete : {};
      const athleteId = text(athlete.id ?? row?.athleteId);
      const displayName = text(athlete.displayName ?? athlete.fullName ?? athlete.shortname);
      if (!athleteId || !displayName) return;
      const profileUrl = firstLink(athlete, ["playercard", "athlete", "overview"]);
      const country = athleteCountry(athlete);
      const normalized = {
        id: athleteId,
        tour: endpoint.tour,
        rank: integer(row?.current),
        rankStatus: Number.isSafeInteger(integer(row?.current)) ? "provider-reported" : "unavailable",
        previousRank: integer(row?.previous),
        points: number(row?.points),
        trend: text(row?.trend),
        athlete: {
          id: athleteId,
          name: displayName,
          shortName: text(athlete.shortname ?? athlete.shortName),
          country: country.country,
          countryCode: country.countryCode,
          countryStatus: country.status,
          flagUrl: country.flagUrl,
          age: integer(athlete.age),
          active: typeof athlete.active === "boolean" ? athlete.active : null,
          profileUrl,
        },
        sourceUrl: profileUrl ?? endpoint.endpoint,
        rankingSourceUrl: endpoint.endpoint,
        retrievedAt,
        provider: endpoint.provider,
        localOnly: true,
        simulation: true,
        executable: false,
      };
      flattened.push(normalized);
      const key = rankLookupKey(endpoint.tour, athleteId);
      if (key && !lookup.has(key)) lookup.set(key, normalized);
    });
  });
  return flattened;
}

function normalizeLineScore(value) {
  const score = isRecord(value) ? value : { value };
  const scoreValueResult = scoreValue(score);
  const tiebreak = integer(
    score.tiebreak
      ?? score.tieBreak
      ?? score.tiebreakScore
      ?? score.tb,
  );
  const winner = scoreWinner(score);
  return {
    value: scoreValueResult,
    displayValue: scoreValueResult === null ? null : text(score.displayValue ?? score.display ?? String(scoreValueResult), String(scoreValueResult)),
    tiebreak,
    tiebreakStatus: tiebreak === null ? "unavailable" : "provider-reported",
    winner,
    winnerStatus: winner === null ? "unavailable" : "provider-reported",
    scoreStatus: scoreValueResult === null ? "unavailable" : "provider-reported",
  };
}

function normalizeAthlete(competitor, tour, lookup) {
  const raw = isRecord(competitor?.athlete) ? competitor.athlete : competitor;
  const id = text(competitor?.id ?? raw?.id);
  const ranking = lookup.get(rankLookupKey(tour, id));
  const profileUrl = firstLink(raw, ["playercard", "athlete", "overview"]) ?? ranking?.athlete?.profileUrl ?? null;
  const name = text(raw?.displayName ?? raw?.fullName ?? raw?.shortName ?? raw?.shortname);
  const linescores = Array.isArray(competitor?.linescores) ? competitor.linescores : [];
  const country = athleteCountry(raw, ranking?.athlete);
  const winner = typeof competitor?.winner === "boolean" ? competitor.winner : null;
  const setDetails = linescores.map(normalizeLineScore);
  return {
    id,
    name,
    fullName: text(raw?.fullName ?? raw?.displayName ?? ranking?.athlete?.name),
    shortName: text(raw?.shortName ?? raw?.shortname),
    country: country.country,
    countryCode: country.countryCode,
    countryStatus: country.status,
    flagUrl: country.flagUrl ?? ranking?.athlete?.flagUrl ?? null,
    profileUrl,
    rank: ranking?.rank ?? null,
    rankStatus: ranking?.rankStatus ?? (Number.isSafeInteger(ranking?.rank) ? "provider-reported" : "unavailable"),
    rankSourceUrl: ranking?.rankingSourceUrl ?? null,
    rankRetrievedAt: ranking?.retrievedAt ?? null,
    rankingPoints: ranking?.points ?? null,
    previousRank: ranking?.previousRank ?? null,
    trend: ranking?.trend ?? null,
    age: integer(raw?.age ?? ranking?.athlete?.age),
    winner,
    winnerStatus: winner === null ? "unavailable" : "provider-reported",
    setDetails,
    // Keep the compact arrays for the existing set projection while the
    // richer line-score objects retain provider tiebreak/status metadata.
    setValues: setDetails.map((line) => line.value),
    setWinner: setDetails.map((line) => line.winner),
  };
}

function setCompleteness(players, setIndex) {
  const valuesPresent = players.filter((player) => Number.isFinite(player.setValues[setIndex])).length;
  const expectedPlayers = players.length >= 2 ? 2 : players.length;
  const score = expectedPlayers > 0 ? Math.min(valuesPresent, expectedPlayers) / expectedPlayers : 0;
  const winnerFlagsPresent = players.filter((player) => typeof player.setWinner[setIndex] === "boolean").length;
  const status = expectedPlayers === 0
    ? "unavailable"
    : valuesPresent >= expectedPlayers
      ? "complete"
      : valuesPresent > 0
        ? "partial"
        : "unavailable";
  return {
    dataCompletenessGrade: score >= 1 ? "A" : score >= 0.5 ? "C" : "D",
    dataCompletenessScore: Number(score.toFixed(2)),
    dataCompletenessPercent: Math.round(score * 100),
    scoreStatus: status,
    scoreCount: valuesPresent,
    expectedScoreCount: expectedPlayers,
    missingScoreCount: Math.max(expectedPlayers - valuesPresent, 0),
    winnerFlagCount: winnerFlagsPresent,
    winnerFlagStatus: winnerFlagsPresent >= expectedPlayers && expectedPlayers > 0
      ? "provider-reported"
      : winnerFlagsPresent > 0
        ? "partial"
        : "unavailable",
    basis: "Set score presence only; this is not a player rating, prediction, or betting grade.",
    checks: Object.freeze({
      playerCount: players.length >= 2,
      scoreValues: valuesPresent >= expectedPlayers && expectedPlayers > 0,
    }),
  };
}

function completionDetail(statusType, state, label) {
  const explicitCompleted = typeof statusType?.completed === "boolean" ? statusType.completed : null;
  const completed = explicitCompleted ?? (state === "post" ? true : state === "pre" || state === "in" ? false : null);
  const completionStatus = completed === true
    ? "final"
    : state === "in"
      ? "in-progress"
      : state === "pre"
        ? "scheduled"
        : completed === false
          ? "not-complete"
          : "unavailable";
  return {
    code: text(statusType?.name ?? statusType?.id),
    label: label ?? "status unavailable",
    state: state ?? "unavailable",
    completed,
    final: completed === null ? null : completed,
    completionStatus,
    source: label || state || explicitCompleted !== null ? "provider-reported" : "unavailable",
    completedSource: explicitCompleted !== null
      ? "provider-reported"
      : state
        ? "provider-state"
        : "unavailable",
    period: integer(statusType?.period),
  };
}

function setScoreCompleteness(setScores) {
  const providedSets = Array.isArray(setScores) ? setScores.length : 0;
  const completeSets = (setScores ?? []).filter((set) => set?.scoreStatus === "complete").length;
  const partialSets = (setScores ?? []).filter((set) => set?.scoreStatus === "partial").length;
  const unavailableSets = Math.max(providedSets - completeSets - partialSets, 0);
  const status = providedSets === 0
    ? "unavailable"
    : completeSets === providedSets
      ? "complete"
      : completeSets || partialSets
        ? "partial"
        : "unavailable";
  return {
    status,
    source: providedSets ? "provider-reported" : "unavailable",
    providedSets,
    completeSets,
    partialSets,
    unavailableSets,
    basis: "Per-set score presence only; set count and completeness are not a player rating, prediction, or betting grade.",
  };
}

/**
 * Compare the provider-returned result fields with one another without
 * pretending that a second source or a match official has been consulted.
 * The result is a bounded internal-consistency readout: unavailable means
 * the provider did not expose enough fields to check, while conflict means
 * two fields in the same normalized response disagree.
 */
export function reconcileSportsResult({
  players = [],
  setScores = [],
  statusDetail = {},
  completion = {},
} = {}) {
  const playerRows = Array.isArray(players) ? players : [];
  const sets = Array.isArray(setScores) ? setScores : [];
  const uniquePlayerKeys = new Set(playerRows
    .map((player) => text(player?.id ?? player?.name))
    .filter(Boolean));
  const playerPair = playerRows.length === 0
    ? { status: "unavailable", detail: "No provider competitor rows were returned." }
    : playerRows.length !== 2
      ? { status: "conflict", detail: `Provider returned ${playerRows.length} competitor rows; singles reconciliation expects two.` }
      : uniquePlayerKeys.size !== playerRows.length
        ? { status: "conflict", detail: "Provider competitor identifiers are not unique." }
        : { status: "consistent", detail: "Two unique provider competitor rows are present." };

  const matchWinnerFlags = playerRows
    .map((player) => player?.winner)
    .filter((value) => typeof value === "boolean");
  const matchWinner = matchWinnerFlags.length === 0
    ? { status: "unavailable", detail: "The provider did not expose a match winner flag." }
    : matchWinnerFlags.length !== playerRows.length
      ? { status: "partial", detail: `Winner flag present for ${matchWinnerFlags.length}/${playerRows.length} provider competitors.` }
      : matchWinnerFlags.filter(Boolean).length === 1
        ? { status: "consistent", detail: "Exactly one provider competitor is marked winner." }
        : { status: "conflict", detail: "Provider match winner flags do not identify exactly one winner." };

  let scoreValueChecks = 0;
  let scoreValueConflicts = 0;
  let scoreWinnerChecks = 0;
  let scoreWinnerConflicts = 0;
  for (const set of sets) {
    const scores = Array.isArray(set?.scores) ? set.scores : [];
    if (!scores.length) continue;
    const numericScores = scores.map((score) => score?.value).filter((value) => Number.isFinite(value));
    const observedCount = numericScores.length;
    const expectedCount = Number.isSafeInteger(set?.expectedScoreCount) ? set.expectedScoreCount : scores.length;
    if (Number.isSafeInteger(set?.scoreCount) || Number.isSafeInteger(set?.expectedScoreCount) || set?.scoreStatus) {
      scoreValueChecks += 1;
      const declaredCountMatches = !Number.isSafeInteger(set?.scoreCount) || set.scoreCount === observedCount;
      const declaredStatusMatches = set?.scoreStatus === "complete"
        ? observedCount === expectedCount
        : set?.scoreStatus === "partial"
          ? observedCount > 0 && observedCount < expectedCount
          : set?.scoreStatus === "unavailable"
            ? observedCount === 0
            : true;
      if (!declaredCountMatches || !declaredStatusMatches) scoreValueConflicts += 1;
    }
    const winnerFlags = scores.map((score) => score?.winner).filter((value) => typeof value === "boolean");
    if (winnerFlags.length) {
      scoreWinnerChecks += 1;
      const winnerCount = winnerFlags.filter(Boolean).length;
      if (winnerCount > 1) {
        scoreWinnerConflicts += 1;
      } else if (winnerCount === 1 && numericScores.length === scores.length) {
        const max = Math.max(...numericScores);
        const maxIndexes = numericScores.reduce((indexes, value, index) => {
          if (value === max) indexes.push(index);
          return indexes;
        }, []);
        const winnerIndex = scores.findIndex((score) => score?.winner === true);
        if (maxIndexes.length === 1 && winnerIndex !== maxIndexes[0]) scoreWinnerConflicts += 1;
      }
    }
  }
  const setScoresCheck = sets.length === 0
    ? { status: "unavailable", detail: "No provider set-score rows were returned." }
    : scoreValueChecks === 0
      ? { status: "unavailable", detail: "Set rows do not expose enough declared score metadata to reconcile." }
      : scoreValueConflicts > 0
        ? { status: "conflict", detail: `${scoreValueConflicts}/${scoreValueChecks} set score declarations disagree with observed values.` }
        : { status: scoreValueChecks === sets.length ? "consistent" : "partial", detail: `${scoreValueChecks}/${sets.length} set score declarations agree with observed values.` };
  const setWinnersCheck = scoreWinnerChecks === 0
    ? { status: "unavailable", detail: "The provider did not expose set winner flags." }
    : scoreWinnerConflicts > 0
      ? { status: "conflict", detail: `${scoreWinnerConflicts}/${scoreWinnerChecks} set winner declarations disagree with set scores.` }
      : { status: scoreWinnerChecks === sets.length ? "consistent" : "partial", detail: `${scoreWinnerChecks}/${sets.length} set winner declarations are internally consistent.` };

  const explicitCompletionFlags = [
    statusDetail?.completed,
    statusDetail?.final,
    completion?.completed,
    completion?.final,
  ].filter((value) => typeof value === "boolean");
  const completionCheck = explicitCompletionFlags.length === 0
    ? { status: "unavailable", detail: "The provider did not expose explicit completion/final flags." }
    : new Set(explicitCompletionFlags).size > 1
      ? { status: "conflict", detail: "Provider completion and final flags disagree." }
      : { status: "consistent", detail: `Provider completion/final flags agree (${explicitCompletionFlags[0] ? "complete" : "not complete"}).` };

  const checks = { playerPair, matchWinner, setScores: setScoresCheck, setWinners: setWinnersCheck, completion: completionCheck };
  const statuses = Object.values(checks).map((check) => check.status);
  const conflictCount = statuses.filter((status) => status === "conflict").length;
  const availableCheckCount = statuses.filter((status) => status !== "unavailable").length;
  const consistentCheckCount = statuses.filter((status) => status === "consistent").length;
  const partialCheckCount = statuses.filter((status) => status === "partial").length;
  const status = conflictCount > 0
    ? "conflict"
    : availableCheckCount === 0
      ? "unavailable"
      : partialCheckCount > 0 || availableCheckCount < statuses.length
        ? "partial"
        : "consistent";
  return {
    status,
    checks,
    checkCount: statuses.length,
    availableCheckCount,
    consistentCheckCount,
    partialCheckCount,
    conflictCount,
    unavailableCheckCount: statuses.filter((entry) => entry === "unavailable").length,
    basis: "Internal consistency across one provider response only; this is not independent verification, a player rating, a prediction, or a betting signal.",
    localOnly: true,
    simulation: true,
    externalSource: true,
    truthClaim: false,
    executable: false,
  };
}

function matchCompleteness({ tournament, sourceUrl, eventTime, status, players, setScores, timeline }) {
  const checks = {
    sourceUrl: Boolean(sourceUrl),
    tournament: Boolean(tournament),
    eventTime: Boolean(eventTime),
    status: Boolean(status),
    players: players.length >= 2 && players.every((player) => player.name),
    setScores: setScores.length > 0,
    playerRanks: players.length >= 2 && players.every((player) => Number.isSafeInteger(player.rank)),
    timeline: timeline.status === "available",
  };
  const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  const dataCompletenessGrade = score >= 0.875 ? "A" : score >= 0.75 ? "B" : score >= 0.625 ? "C" : "D";
  return {
    dataCompletenessGrade,
    dataCompletenessScore: Number(score.toFixed(2)),
    dataCompletenessPercent: Math.round(score * 100),
    basis: "Match field/provenance completeness only; this is not a player rating, prediction, or betting grade.",
    checks,
  };
}

function normalizeScoreboard(payload, endpoint, retrievedAt, lookup, maxRecords) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const records = [];
  const seen = new Set();
  for (const event of events) {
    if (records.length >= maxRecords) break;
    const tournament = text(event?.name ?? event?.shortName);
    const eventLinks = linksFrom(event);
    const tournamentUrl = firstLink(event, ["summary", "event", "bracket"]);
    const groupings = Array.isArray(event?.groupings) ? event.groupings : [];
    for (const grouping of groupings) {
      const competitions = Array.isArray(grouping?.competitions) ? grouping.competitions : [];
      for (const competition of competitions) {
        if (records.length >= maxRecords) break;
        const competitionId = text(competition?.id);
        if (!competitionId || seen.has(competitionId)) continue;
        seen.add(competitionId);
        const players = (Array.isArray(competition?.competitors) ? competition.competitors : [])
          .map((competitor) => normalizeAthlete(competitor, endpoint.tour, lookup))
          .filter((player) => player.id || player.name);
        const setCount = players.reduce((count, player) => Math.max(count, player.setValues.length), 0);
        const setScores = Array.from({ length: setCount }, (_, setIndex) => {
          const completeness = setCompleteness(players, setIndex);
          return {
            set: setIndex + 1,
            scores: players.map((player) => ({
              athleteId: player.id,
              athleteName: player.name,
              value: Number.isFinite(player.setValues[setIndex]) ? player.setValues[setIndex] : null,
              displayValue: player.setDetails[setIndex]?.displayValue ?? "—",
              tiebreak: player.setDetails[setIndex]?.tiebreak ?? null,
              tiebreakStatus: player.setDetails[setIndex]?.tiebreakStatus ?? "unavailable",
              winner: player.setWinner[setIndex] ?? null,
              winnerStatus: player.setDetails[setIndex]?.winnerStatus ?? "unavailable",
              scoreStatus: player.setDetails[setIndex]?.scoreStatus ?? "unavailable",
            })),
            ...completeness,
          };
        });
        const statusType = isRecord(competition?.status?.type) ? competition.status.type : {};
        const status = text(statusType.description ?? statusType.detail ?? statusType.shortDetail ?? statusType.name ?? competition?.status?.state);
        const state = text(statusType.state ?? competition?.status?.state);
        const completion = completionDetail(statusType, state, status);
        completion.period = integer(competition?.status?.period);
        const eventTime = timestamp(competition?.startDate ?? competition?.date ?? event?.date);
        const detailReferences = collectDetailReferences(
          event?.$ref,
          competition?.$ref,
          eventLinks,
          competition?.links,
          competition?.competitors?.flatMap((competitor) => [competitor?.$ref, competitor?.athlete?.$ref]),
        );
        const timelineReferences = collectTimelineReferences(
          competition?.timeline,
          competition?.playByPlay,
          competition?.plays,
          competition?.actions,
          competition?.events,
          competition?.commentary,
          competition?.summary,
          competition?.details,
          competition?.$ref,
        );
        const sourceUrl = tournamentUrl ?? eventLinks[0]?.href ?? endpoint.endpoint;
        const timeline = normalizeTimeline(competition, detailReferences);
        const completeness = matchCompleteness({
          tournament,
          sourceUrl,
          eventTime,
          status,
          players,
          setScores,
          timeline,
        });
        const setScoreSummary = setScoreCompleteness(setScores);
        const resultReconciliation = reconcileSportsResult({
          players,
          setScores,
          statusDetail: completion,
          completion,
        });
        const record = {
          id: `espn-tennis:${endpoint.tour.toLowerCase()}:${text(event?.id, "event")}:${competitionId}`,
          providerId: endpoint.id,
          provider: endpoint.provider,
          sport: "tennis",
          tour: endpoint.tour,
          tournament: {
            id: text(event?.id),
            name: tournament,
            label: tournament,
            sourceUrl: tournamentUrl,
          },
          match: {
            id: competitionId,
            round: text(competition?.round?.displayName ?? competition?.round?.name),
            type: text(competition?.type?.text ?? grouping?.grouping?.displayName),
            venue: text(competition?.venue?.fullName),
            court: text(competition?.venue?.court),
          },
          title: tournament ? `${tournament} · ${players.map((player) => player.name ?? "Unnamed player").join(" vs ")}` : `Tennis match · ${competitionId}`,
          players: players.map(({ setValues, setWinner, setDetails, ...player }) => player),
          // These aliases keep the host's cube/readout seam compatible with
          // the earlier sports packet while the richer `players` and
          // `statusDetail` objects remain the canonical normalized fields.
          competitors: players.map(({ setValues, setWinner, setDetails, ...player }) => ({
            ...player,
            displayName: player.name,
          })),
          matchId: competitionId,
          status: status ?? "status unavailable",
          statusDetail: completion,
          completionStatus: completion.completionStatus,
          completion: {
            status: completion.completionStatus,
            completed: completion.completed,
            final: completion.final,
            source: completion.source,
          },
          eventTime,
          eventTimeStatus: eventTime ? "provider-reported" : "unavailable",
          eventTimeBasis: eventTime ? "ESPN scoreboard competition date" : "The public scoreboard did not provide a usable match time.",
          setScores,
          setScoreStatus: setScores.length ? "provider-reported" : "unavailable",
          setScoreCompleteness: setScoreSummary,
          resultReconciliation,
          timeline,
          timelineStatus: timeline.status,
          timelineReason: timeline.reason,
          detailReferences,
          timelineReferences,
          timelineRequestStatus: timeline.status === "available" ? "inline" : timelineReferences.length ? "pending" : "not-requested",
          timelineRequestReason: timeline.status === "available" || timelineReferences.length
            ? null
            : "No provider-returned public timeline reference was supplied.",
          sourceUrl,
          sourceObservedAt: retrievedAt,
          retrievedAt,
          ...completeness,
          dataGrade: completeness.dataCompletenessGrade,
          gradeKind: "data-completeness",
          uncertainty: 1,
          confidence: 0,
          sourceAttribution: "unverified ESPN public scoreboard metadata",
          truthClaim: false,
          externalSource: true,
          providerAvailable: true,
          complete: false,
          localOnly: true,
          simulation: true,
          executable: false,
        };
        records.push(record);
      }
    }
  }
  return records;
}

async function requestPublicJson(fetchImpl, requestUrl, timeoutMs) {
  if (!isTimelineReference(requestUrl)) throw new Error("Provider timeline reference is not an eligible HTTPS ESPN API URL.");
  let timeoutHandle = null;
  let abortController = null;
  try {
    if (typeof globalThis.AbortController === "function") {
      abortController = new globalThis.AbortController();
      timeoutHandle = globalThis.setTimeout?.(() => abortController.abort(), timeoutMs) ?? null;
    }
    const response = await fetchImpl(requestUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(abortController ? { signal: abortController.signal } : {}),
    });
    if (!response?.ok || typeof response.json !== "function") throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
    return await response.json();
  } finally {
    if (timeoutHandle !== null) globalThis.clearTimeout?.(timeoutHandle);
  }
}

function timelineRecordWithResult(record, timeline, requestUrl, requestStatus, requestReason = null, detailReferences = []) {
  const mergedReferences = [...new Set([
    ...(Array.isArray(record.detailReferences) ? record.detailReferences : []),
    ...(Array.isArray(detailReferences) ? detailReferences : []),
    requestUrl,
  ].filter(Boolean))].slice(0, 12);
  const nextTimeline = {
    ...timeline,
    sourceUrl: requestUrl,
    requestStatus,
  };
  const completeness = matchCompleteness({
    tournament: record.tournament?.name ?? record.tournament?.label,
    sourceUrl: record.sourceUrl,
    eventTime: record.eventTime,
    status: record.status,
    players: Array.isArray(record.players) ? record.players : [],
    setScores: Array.isArray(record.setScores) ? record.setScores : [],
    timeline: nextTimeline,
  });
  return {
    ...record,
    timeline: nextTimeline,
    timelineStatus: nextTimeline.status,
    timelineReason: nextTimeline.reason,
    timelineSourceUrl: requestUrl,
    timelineRequestStatus: requestStatus,
    timelineRequestReason: requestReason,
    detailReferences: mergedReferences,
    ...completeness,
    dataGrade: completeness.dataCompletenessGrade,
  };
}

async function enrichTimelineRecords(records, fetchImpl, timeoutMs, maxRequests, retrievedAt) {
  const timelineSources = [];
  const requestedReferences = new Set();
  const payloadCache = new Map();
  let requestCount = 0;
  const enrichedRecords = [];
  for (const record of records) {
    const references = Array.isArray(record?.timelineReferences)
      ? record.timelineReferences.filter(isTimelineReference).slice(0, 4)
      : [];
    if (!references.length) {
      enrichedRecords.push({
        ...record,
        timelineRequestStatus: record?.timelineStatus === "available" ? "inline" : "not-requested",
        timelineRequestReason: record?.timelineStatus === "available" ? null : "No provider-returned public timeline reference was supplied.",
      });
      continue;
    }
    const queue = [...references];
    const queued = new Set(queue);
    let nextRecord = record;
    let resolved = false;
    let attempted = false;
    let lastReason = "The provider-returned timeline detail contained no usable points.";
    while (queue.length && requestCount < maxRequests) {
      const requestUrl = queue.shift();
      if (!requestUrl || requestedReferences.has(requestUrl)) continue;
      queued.delete(requestUrl);
      requestedReferences.add(requestUrl);
      attempted = true;
      requestCount += 1;
      let payload;
      let requestError = null;
      if (payloadCache.has(requestUrl)) {
        const cached = payloadCache.get(requestUrl);
        payload = cached.payload;
        requestError = cached.error;
      } else {
        try {
          payload = await requestPublicJson(fetchImpl, requestUrl, timeoutMs);
          payloadCache.set(requestUrl, { payload, error: null });
        } catch (error) {
          requestError = safeError(error);
          payloadCache.set(requestUrl, { payload: null, error: requestError });
        }
      }
      if (requestError) {
        lastReason = `Provider timeline request failed: ${requestError}`;
        timelineSources.push({
          url: requestUrl,
          recordId: record.id,
          available: false,
          requestStatus: "unavailable",
          reason: lastReason,
          retrievedAt,
          localOnly: true,
          simulation: true,
          externalSource: true,
          truthClaim: false,
          executable: false,
        });
        continue;
      }
      const detailReferences = collectDetailReferences(payload);
      const timeline = normalizeTimeline(
        payload,
        [...new Set([...(record.detailReferences ?? []), ...detailReferences, requestUrl])].slice(0, 12),
        "The provider-returned timeline detail did not include usable point records.",
      );
      const childReferences = collectTimelineReferences(payload);
      childReferences.forEach((childReference) => {
        if (!requestedReferences.has(childReference) && !queued.has(childReference) && childReference !== requestUrl) {
          queue.push(childReference);
          queued.add(childReference);
        }
      });
      timelineSources.push({
        url: requestUrl,
        recordId: record.id,
        available: timeline.available,
        requestStatus: timeline.available ? "available" : "unavailable",
        reason: timeline.reason,
        pointCount: timeline.points.length,
        retrievedAt,
        localOnly: true,
        simulation: true,
        externalSource: true,
        truthClaim: false,
        executable: false,
      });
      if (timeline.available) {
        nextRecord = timelineRecordWithResult(record, timeline, requestUrl, "available", null, detailReferences);
        resolved = true;
        break;
      }
      lastReason = timeline.reason;
    }
    if (!resolved) {
      const requestStatus = attempted ? "unavailable" : "deferred";
      nextRecord = {
        ...record,
        timelineRequestStatus: requestStatus,
        timelineRequestReason: attempted
          ? lastReason
          : "The bounded public timeline-request budget was exhausted before this reference was requested.",
      };
    }
    enrichedRecords.push(nextRecord);
  }
  return { records: enrichedRecords, timelineSources, requestCount };
}

function detailSource({ url, kind, recordId, available, requestStatus, reason, pointCount = 0, retrievedAt }) {
  return {
    url,
    kind,
    recordId,
    available: available === true,
    requestStatus,
    reason: reason ?? null,
    pointCount,
    retrievedAt,
    localOnly: true,
    simulation: true,
    externalSource: true,
    truthClaim: false,
    executable: false,
  };
}

function detailRecordEnvelope(record, {
  status,
  requestStatus,
  sourceUrl,
  references = [],
  timeline,
  timelineSourceUrl = null,
  timelineReason = null,
  commentaryAvailable = null,
  liveAvailable = null,
  summaryAvailable = null,
  notes = [],
  requestCount = 0,
  retrievedAt,
} = {}) {
  const mergedReferences = [...new Set([
    ...(Array.isArray(record?.detailReferences) ? record.detailReferences : []),
    ...references,
    sourceUrl,
    timelineSourceUrl,
  ].filter(Boolean))].slice(0, 12);
  const normalizedTimeline = timeline ?? {
    status: "unavailable",
    available: false,
    reason: timelineReason ?? "The provider detail did not include a usable point-by-point timeline.",
    points: [],
    references: mergedReferences,
  };
  const effectiveTimeline = normalizedTimeline.status === "available" || record?.timeline?.available !== true
    ? normalizedTimeline
    : record.timeline;
  const publicDetail = {
    schemaVersion: SPORTS_EVENTS_SCHEMA_VERSION,
    source: SPORTS_EVENTS_DETAIL_SOURCE,
    status,
    requestStatus,
    sourceUrl,
    references: mergedReferences,
    commentaryAvailable,
    commentaryStatus: commentaryAvailable === true ? "provider-reported" : "unavailable",
    liveAvailable,
    liveStatus: liveAvailable === true ? "provider-reported" : "unavailable",
    summaryAvailable,
    notes: Object.freeze(notes.slice(0, 8)),
    timeline: normalizedTimeline,
    timelineStatus: normalizedTimeline.status,
    timelineReason: normalizedTimeline.reason,
    timelineSourceUrl,
    timelineRequestStatus: normalizedTimeline.status === "available" ? "available" : requestStatus,
    requestCount,
    retrievedAt,
    localOnly: true,
    simulation: true,
    externalNetwork: requestCount > 0,
    externalSource: true,
    truthClaim: false,
    executable: false,
    boundary: "Explicit ESPN public competition detail only. Point-by-point data is shown only when the provider returns usable plays/events; no scores, points, rankings, or commentary are inferred.",
  };
  let nextRecord = {
    ...record,
    detailReferences: mergedReferences,
    publicDetail,
    timeline: effectiveTimeline,
    timelineStatus: effectiveTimeline.status,
    localOnly: true,
    simulation: true,
    externalSource: true,
    truthClaim: false,
    executable: false,
  };
  if (normalizedTimeline.status === "available") {
    nextRecord = timelineRecordWithResult(
      nextRecord,
      normalizedTimeline,
      timelineSourceUrl ?? sourceUrl,
      "available",
      null,
      mergedReferences,
    );
    nextRecord.publicDetail = publicDetail;
  } else {
    nextRecord.timelineRequestStatus = requestStatus;
    nextRecord.timelineRequestReason = timelineReason ?? normalizedTimeline.reason;
    nextRecord.timelineReason = timelineReason ?? normalizedTimeline.reason;
  }
  return nextRecord;
}

function unavailableDetailResult(record, retrievedAt, reason, sourceUrl = null, requestStatus = "unavailable") {
  const requestCount = 0;
  const nextRecord = record
    ? detailRecordEnvelope(record, {
      status: "unavailable",
      requestStatus,
      sourceUrl,
      timelineReason: reason,
      requestCount,
      retrievedAt,
    })
    : null;
  return deepFreeze({
    schemaVersion: SPORTS_EVENTS_SCHEMA_VERSION,
    source: SPORTS_EVENTS_DETAIL_SOURCE,
    status: "unavailable",
    requestStatus,
    record: nextRecord,
    sourceUrl,
    timelineSources: [],
    requestCount,
    liveFetch: false,
    externalNetwork: false,
    externalSource: Boolean(record),
    localOnly: true,
    simulation: true,
    truthClaim: false,
    executable: false,
    boundary: "Explicit ESPN public competition detail only; unavailable responses remain empty and no point-level data is fabricated.",
    reason,
  });
}

/**
 * Fetch one provider-returned competition detail document on explicit user
 * inspection. The normal scoreboard refresh does not call this function.
 * At most one competition document and one provider-reported plays document
 * are requested; an empty/failed plays response remains visibly unavailable.
 */
export async function fetchSportsEventDetail({
  record = null,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  timeoutMs = SPORTS_EVENTS_FETCH_TIMEOUT_MS,
  maxRequests = SPORTS_EVENTS_MAX_DETAIL_REQUESTS,
} = {}) {
  const retrievedAt = nowIso(now);
  const sourceUrl = publicCompetitionDetailReference(record);
  if (!record || !sourceUrl) {
    return unavailableDetailResult(record, retrievedAt, "No eligible ATP/WTA provider identifiers were available for detail inspection.", sourceUrl, "not-requested");
  }
  if (typeof fetchImpl !== "function") {
    return unavailableDetailResult(record, retrievedAt, "Browser fetch is unavailable; no provider detail was fabricated.", sourceUrl, "not-requested");
  }
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 60_000)
    : SPORTS_EVENTS_FETCH_TIMEOUT_MS;
  const boundedRequests = Number.isSafeInteger(maxRequests) && maxRequests >= 0
    ? Math.min(maxRequests, SPORTS_EVENTS_MAX_DETAIL_REQUESTS)
    : SPORTS_EVENTS_MAX_DETAIL_REQUESTS;
  if (boundedRequests < 1) {
    return unavailableDetailResult(record, retrievedAt, "The explicit provider-detail request budget was zero; no detail request was made.", sourceUrl, "deferred");
  }

  const sources = [];
  let requestCount = 0;
  let payload;
  try {
    requestCount += 1;
    payload = await requestPublicJson(fetchImpl, sourceUrl, boundedTimeout);
  } catch (error) {
    const reason = `Provider competition detail request failed: ${safeError(error)}`;
    sources.push(detailSource({ url: sourceUrl, kind: "competition-detail", recordId: record.id, available: false, requestStatus: "unavailable", reason, retrievedAt }));
    const result = unavailableDetailResult(record, retrievedAt, reason, sourceUrl, "unavailable");
    return deepFreeze({ ...result, requestCount, timelineSources: sources, externalNetwork: true, liveFetch: true });
  }
  if (!isRecord(payload)) {
    const reason = "Provider competition detail returned no usable JSON object.";
    sources.push(detailSource({ url: sourceUrl, kind: "competition-detail", recordId: record.id, available: false, requestStatus: "unavailable", reason, retrievedAt }));
    const result = unavailableDetailResult(record, retrievedAt, reason, sourceUrl, "unavailable");
    return deepFreeze({ ...result, requestCount, timelineSources: sources, externalNetwork: true, liveFetch: true });
  }
  const references = [...new Set([
    ...(Array.isArray(record.detailReferences) ? record.detailReferences : []),
    sourceUrl,
    ...collectDetailReferences(payload),
  ].filter(Boolean))].slice(0, 12);
  const detailTimelineReason = payload.commentaryAvailable === false
    ? "Provider competition detail reports commentary/play-by-play unavailable."
    : "Provider competition detail did not include usable point-by-point events.";
  let timeline = normalizeTimeline(payload, references, detailTimelineReason);
  let timelineSourceUrl = timeline.available ? sourceUrl : null;
  let timelineReason = timeline.reason;
  sources.push(detailSource({
    url: sourceUrl,
    kind: "competition-detail",
    recordId: record.id,
    available: true,
    requestStatus: "available",
    pointCount: timeline.points.length,
    reason: timeline.available ? null : detailTimelineReason,
    retrievedAt,
  }));

  // ESPN exposes point feeds only when the provider marks commentary/live
  // detail as available. Do not probe odds, predictions, or arbitrary refs.
  const shouldRequestPlays = !timeline.available
    && requestCount < boundedRequests
    && (payload.commentaryAvailable === true || payload.liveAvailable === true);
  const playsUrl = shouldRequestPlays ? publicCompetitionPlaysReference(sourceUrl) : null;
  if (playsUrl) {
    requestCount += 1;
    try {
      const playsPayload = await requestPublicJson(fetchImpl, playsUrl, boundedTimeout);
      const playsReferences = collectDetailReferences(playsPayload);
      const merged = [...new Set([...references, playsUrl, ...playsReferences])].slice(0, 12);
      timeline = normalizeTimeline(playsPayload, merged, "Provider play-by-play endpoint returned no usable point records.");
      timelineSourceUrl = timeline.available ? playsUrl : null;
      timelineReason = timeline.reason;
      sources.push(detailSource({
        url: playsUrl,
        kind: "play-by-play",
        recordId: record.id,
        available: timeline.available,
        requestStatus: timeline.available ? "available" : "unavailable",
        pointCount: timeline.points.length,
        reason: timeline.available ? null : timeline.reason,
        retrievedAt,
      }));
    } catch (error) {
      timelineReason = `Provider play-by-play request failed: ${safeError(error)}`;
      sources.push(detailSource({ url: playsUrl, kind: "play-by-play", recordId: record.id, available: false, requestStatus: "unavailable", reason: timelineReason, retrievedAt }));
    }
  }

  const notes = Array.isArray(payload.notes)
    ? payload.notes.map((note) => text(note?.text ?? note?.description)).filter(Boolean)
    : [];
  const nextRecord = detailRecordEnvelope(record, {
    status: "available",
    requestStatus: "available",
    sourceUrl,
    references,
    timeline,
    timelineSourceUrl,
    timelineReason,
    commentaryAvailable: typeof payload.commentaryAvailable === "boolean" ? payload.commentaryAvailable : null,
    liveAvailable: typeof payload.liveAvailable === "boolean" ? payload.liveAvailable : null,
    summaryAvailable: typeof payload.summaryAvailable === "boolean" ? payload.summaryAvailable : null,
    notes,
    requestCount,
    retrievedAt,
  });
  return deepFreeze({
    schemaVersion: SPORTS_EVENTS_SCHEMA_VERSION,
    source: SPORTS_EVENTS_DETAIL_SOURCE,
    status: "ready",
    requestStatus: "available",
    record: nextRecord,
    sourceUrl,
    timelineSources: sources,
    requestCount,
    liveFetch: true,
    externalNetwork: true,
    externalSource: true,
    localOnly: true,
    simulation: true,
    truthClaim: false,
    executable: false,
    boundary: "Explicit ESPN public competition detail only. Point-by-point data is shown only when the provider returns usable plays/events; no scores, points, rankings, or commentary are inferred.",
    reason: timeline.available ? null : timelineReason,
  });
}

function sourceStatus(endpoint, retrievedAt, values = {}) {
  return {
    id: endpoint.id,
    provider: endpoint.provider,
    endpoint: endpoint.endpoint,
    format: endpoint.format,
    tour: endpoint.tour,
    retrievedAt,
    ...values,
    localOnly: true,
    simulation: true,
    externalSource: true,
    truthClaim: false,
    complete: false,
    executable: false,
  };
}

export function createUnavailableSportsEvents({
  retrievedAt = new Date().toISOString(),
  reason = "No public ESPN tennis response is available in this session.",
} = {}) {
  const retrieved = nowIso(retrievedAt);
  return deepFreeze({
    schemaVersion: SPORTS_EVENTS_SCHEMA_VERSION,
    source: SPORTS_EVENTS_SOURCE,
    status: "unavailable",
    sport: "tennis",
    tours: ["ATP", "WTA"],
    retrievedAt: retrieved,
    records: [],
    rankings: [],
    sources: SPORTS_EVENTS_ENDPOINTS.map((endpoint) => sourceStatus(endpoint, retrieved, {
      available: false,
      recordCount: 0,
      reason,
    })),
    secondaryParity: createSecondaryParityStatus(),
    timelineSources: [],
    timelineRequestCount: 0,
    providerAvailable: false,
    providerUnavailable: true,
    liveFetch: false,
    externalNetwork: false,
    externalSource: true,
    localOnly: true,
    simulation: true,
    complete: false,
    truthClaim: false,
    confidence: 0,
    uncertainty: 1,
    executable: false,
    boundary: SPORTS_EVENTS_BOUNDARY,
    reason,
  });
}

/**
 * Fetch scoreboards and rankings after an explicit caller request. Fetch is
 * injectable for tests so no fixtures or network dependency are required in
 * the test suite. Requests are sequential, bounded, HTTPS-only, and isolated
 * per provider.
 */
export async function fetchSportsEvents({
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  tours = ["ATP", "WTA"],
  maxRecords = SPORTS_EVENTS_MAX_RECORDS,
  timeoutMs = SPORTS_EVENTS_FETCH_TIMEOUT_MS,
  maxTimelineRequests = SPORTS_EVENTS_MAX_TIMELINE_REQUESTS,
  endpoints = SPORTS_EVENTS_ENDPOINTS,
} = {}) {
  const retrievedAt = nowIso(now);
  const boundedMax = Number.isSafeInteger(maxRecords) && maxRecords > 0
    ? Math.min(maxRecords, SPORTS_EVENTS_MAX_RECORDS)
    : SPORTS_EVENTS_MAX_RECORDS;
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 60_000)
    : SPORTS_EVENTS_FETCH_TIMEOUT_MS;
  const boundedTimelineRequests = Number.isSafeInteger(maxTimelineRequests) && maxTimelineRequests >= 0
    ? Math.min(maxTimelineRequests, SPORTS_EVENTS_MAX_TIMELINE_REQUESTS)
    : SPORTS_EVENTS_MAX_TIMELINE_REQUESTS;
  if (typeof fetchImpl !== "function") {
    return createUnavailableSportsEvents({ retrievedAt, reason: "Browser fetch is unavailable; no tennis data was fabricated." });
  }

  const lookup = new Map();
  const records = [];
  const rankings = [];
  const sources = [];
  // Rankings are read first so the scoreboard normalizer can enrich the
  // provider-returned athlete names with the matching current rank without
  // issuing a second request or inventing a local ranking.
  const requestedTours = Array.isArray(tours)
    ? tours.map((tour) => String(tour).toUpperCase()).filter((tour) => tour === "ATP" || tour === "WTA")
    : typeof tours === "string"
      ? [tours.toUpperCase()].filter((tour) => tour === "ATP" || tour === "WTA")
      : ["ATP", "WTA"];
  const normalizedTours = requestedTours.length ? [...new Set(requestedTours)] : ["ATP", "WTA"];
  const endpointList = (Array.isArray(endpoints) ? endpoints.slice(0, SPORTS_EVENTS_ENDPOINTS.length) : [...SPORTS_EVENTS_ENDPOINTS])
    .filter((endpoint) => normalizedTours.includes(String(endpoint?.tour ?? "").toUpperCase()))
    .sort((left, right) => (left?.format === "rankings" ? -1 : 0) - (right?.format === "rankings" ? -1 : 0));

  for (const endpoint of endpointList) {
    const requestUrl = publicSourceUrl(endpoint?.endpoint);
    if (!requestUrl) {
      sources.push(sourceStatus(endpoint, retrievedAt, {
        available: false,
        recordCount: 0,
        requestUrl: null,
        reason: "Only documented HTTPS public endpoints are eligible.",
      }));
      continue;
    }
    let timeoutHandle = null;
    let abortController = null;
    try {
      if (typeof globalThis.AbortController === "function") {
        abortController = new globalThis.AbortController();
        timeoutHandle = globalThis.setTimeout?.(() => abortController.abort(), boundedTimeout) ?? null;
      }
      const response = await fetchImpl(requestUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        ...(abortController ? { signal: abortController.signal } : {}),
      });
      if (!response?.ok || typeof response.json !== "function") {
        throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
      }
      const payload = await response.json();
      if (endpoint.format === "rankings") {
        const nextRankings = normalizeRankings(payload, endpoint, retrievedAt, lookup);
        rankings.push(...nextRankings);
        sources.push(sourceStatus(endpoint, retrievedAt, {
          available: true,
          recordCount: nextRankings.length,
          requestUrl,
          reason: nextRankings.length ? null : "Provider returned no usable ranking rows.",
        }));
      } else {
        const perEndpointMax = Math.max(1, Math.ceil(boundedMax / 2));
        const nextRecords = normalizeScoreboard(payload, endpoint, retrievedAt, lookup, perEndpointMax);
        records.push(...nextRecords);
        sources.push(sourceStatus(endpoint, retrievedAt, {
          available: true,
          recordCount: nextRecords.length,
          requestUrl,
          reason: nextRecords.length ? null : "Provider returned no usable match records.",
        }));
      }
    } catch (error) {
      sources.push(sourceStatus(endpoint, retrievedAt, {
        available: false,
        recordCount: 0,
        requestUrl,
        reason: safeError(error),
      }));
    } finally {
      if (timeoutHandle !== null) globalThis.clearTimeout?.(timeoutHandle);
    }
  }

  const timelineResult = await enrichTimelineRecords(
    records.slice(0, boundedMax),
    fetchImpl,
    boundedTimeout,
    boundedTimelineRequests,
    retrievedAt,
  );
  const limitedRecords = timelineResult.records.slice(0, boundedMax);
  const availableCount = sources.filter((source) => source.available === true).length;
  const scoreboardSources = sources.filter((source) => source.format === "scoreboard");
  const scoreboardAvailable = scoreboardSources.some((source) => source.available === true);
  const status = limitedRecords.length
    ? availableCount === sources.length ? "ready" : "partial"
    : scoreboardAvailable ? "partial" : "unavailable";
  return deepFreeze({
    schemaVersion: SPORTS_EVENTS_SCHEMA_VERSION,
    source: SPORTS_EVENTS_SOURCE,
    status,
    sport: "tennis",
    tours: normalizedTours,
    retrievedAt,
    records: limitedRecords,
    rankings: rankings.slice(0, SPORTS_EVENTS_MAX_RANKINGS * 2),
    sources,
    secondaryParity: createSecondaryParityStatus(limitedRecords[0] ?? null),
    timelineSources: timelineResult.timelineSources,
    timelineRequestCount: timelineResult.requestCount,
    providerAvailable: availableCount > 0,
    providerUnavailable: availableCount === 0,
    liveFetch: true,
    externalNetwork: true,
    externalSource: true,
    localOnly: true,
    simulation: true,
    complete: false,
    truthClaim: false,
    confidence: 0,
    uncertainty: 1,
    executable: false,
    boundary: SPORTS_EVENTS_BOUNDARY,
    reason: limitedRecords.length
      ? null
      : "No scoreboard provider returned a usable match; no tennis rows were fabricated.",
  });
}

export function replaySportsEvents(snapshot, recordId = null, method = "local-replay") {
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  const record = records.find((candidate) => candidate?.id === recordId) ?? records[0] ?? null;
  return deepFreeze({
    schemaVersion: SPORTS_EVENTS_SCHEMA_VERSION,
    source: SPORTS_EVENTS_REPLAY_SOURCE,
    action: "replay",
    method: text(method, "local-replay"),
    recordId: record?.id ?? null,
    record,
    recordCount: records.length,
    secondaryParity: createSecondaryParityStatus(record),
    retrievedAt: timestamp(snapshot?.retrievedAt),
    localOnly: true,
    simulation: true,
    deterministic: true,
    providerAvailable: snapshot?.providerAvailable === true,
    providerUnavailable: snapshot?.providerAvailable !== true,
    liveFetch: false,
    externalNetwork: false,
    externalSource: Boolean(record),
    truthClaim: false,
    executable: false,
    boundary: SPORTS_EVENTS_BOUNDARY,
  });
}

export function summarizeSportsEvents(input = null) {
  const value = isRecord(input) ? input : createUnavailableSportsEvents();
  const records = Array.isArray(value.records) ? value.records : [];
  const rankings = Array.isArray(value.rankings) ? value.rankings : [];
  const sources = Array.isArray(value.sources)
    ? value.sources
    : SPORTS_EVENTS_ENDPOINTS.map((endpoint) => sourceStatus(endpoint, value.retrievedAt, { available: false, recordCount: 0, reason: "No fetch performed." }));
  const timelineSources = Array.isArray(value.timelineSources) ? value.timelineSources : [];
  const secondaryParity = isRecord(value.secondaryParity)
    ? value.secondaryParity
    : createSecondaryParityStatus(records[0] ?? null);
  const tours = [...new Set(records.map((record) => record?.tour).filter(Boolean))];
  const setCount = records.reduce((total, record) => total + (Array.isArray(record?.setScores) ? record.setScores.length : 0), 0);
  const setCompleteCount = records.reduce((total, record) => {
    const detail = record?.setScoreCompleteness;
    if (Number.isSafeInteger(detail?.completeSets)) return total + detail.completeSets;
    const sets = Array.isArray(record?.setScores) ? record.setScores : [];
    return total + sets.filter((set) => set?.scoreStatus === "complete" || set?.dataCompletenessGrade === "A").length;
  }, 0);
  const setPartialCount = records.reduce((total, record) => {
    const detail = record?.setScoreCompleteness;
    if (Number.isSafeInteger(detail?.partialSets)) return total + detail.partialSets;
    const sets = Array.isArray(record?.setScores) ? record.setScores : [];
    return total + sets.filter((set) => set?.scoreStatus === "partial").length;
  }, 0);
  const setUnavailableCount = records.reduce((total, record) => {
    const detail = record?.setScoreCompleteness;
    if (Number.isSafeInteger(detail?.unavailableSets)) return total + detail.unavailableSets;
    const sets = Array.isArray(record?.setScores) ? record.setScores : [];
    return total + sets.filter((set) => set?.scoreStatus === "unavailable" || (!set?.scoreStatus && set?.dataCompletenessGrade !== "A")).length;
  }, 0);
  const timelineCount = records.filter((record) => record?.timelineStatus === "available" || record?.timeline?.available === true).length;
  const reconciliationCounts = records.reduce((counts, record) => {
    const status = text(record?.resultReconciliation?.status, "unavailable");
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, { consistent: 0, partial: 0, conflict: 0, unavailable: 0 });
  return deepFreeze({
    schemaVersion: SPORTS_EVENTS_SCHEMA_VERSION,
    source: SPORTS_EVENTS_SOURCE,
    status: text(value.status, records.length ? "ready" : "unavailable"),
    sport: "tennis",
    tours: tours.length ? tours : ["ATP", "WTA"],
    retrievedAt: timestamp(value.retrievedAt),
    records,
    rankings,
    sources,
    secondaryParity,
    recordCount: records.length,
    rankingCount: rankings.length,
    setCount,
    setCompleteCount,
    setPartialCount,
    setUnavailableCount,
    setScoreCompleteness: {
      providedSets: setCount,
      completeSets: setCompleteCount,
      partialSets: setPartialCount,
      unavailableSets: setUnavailableCount,
      status: setCount === 0 ? "unavailable" : setCompleteCount === setCount ? "complete" : setCompleteCount || setPartialCount ? "partial" : "unavailable",
      basis: "Per-set score presence only; no player rating, prediction, or betting grade.",
    },
    timelineAvailableCount: timelineCount,
    availableProviderCount: sources.filter((source) => source?.available === true).length,
    providerCount: sources.length,
    timelineSources,
    timelineSourceCount: timelineSources.length,
    timelineRequestCount: integer(value.timelineRequestCount, timelineSources.length),
    timelineUnavailableCount: records.filter((record) => record?.timelineStatus !== "available").length,
    reconciliationConsistentCount: reconciliationCounts.consistent,
    reconciliationPartialCount: reconciliationCounts.partial,
    reconciliationConflictCount: reconciliationCounts.conflict,
    reconciliationUnavailableCount: reconciliationCounts.unavailable,
    reconciliation: {
      consistent: reconciliationCounts.consistent,
      partial: reconciliationCounts.partial,
      conflict: reconciliationCounts.conflict,
      unavailable: reconciliationCounts.unavailable,
      basis: "Internal consistency across one provider response only; no independent source or truth claim.",
    },
    providerAvailable: value.providerAvailable === true,
    providerUnavailable: value.providerUnavailable !== false,
    liveFetch: value.liveFetch === true,
    externalNetwork: value.externalNetwork === true,
    externalSource: value.externalSource === true,
    localOnly: true,
    simulation: true,
    complete: false,
    truthClaim: false,
    confidence: 0,
    uncertainty: 1,
    executable: false,
    boundary: text(value.boundary, SPORTS_EVENTS_BOUNDARY),
    reason: text(value.reason, records.length ? null : "No scoreboard data is available; no tennis rows were fabricated."),
  });
}

export default fetchSportsEvents;
