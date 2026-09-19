import { findLeagueCatalogEntry } from "../data/league-catalog.js";

/**
 * Bounded public multi-sport scoreboard evidence.
 *
 * This adapter reads three fixed, browser-safe ESPN public scoreboards after
 * an explicit host request: English Premier League soccer, NBA basketball,
 * and NFL football.  The payload is reduced to provider-returned competition,
 * participant, score, status, time, venue, and source fields.  Fields that
 * are not part of this observation contract are deliberately dropped.  An
 * empty, malformed, timed-out, or failed provider remains unavailable; no
 * local rows are substituted.
 */

export const MULTI_SPORT_EVENTS_SCHEMA_VERSION = 1;
export const MULTI_SPORT_EVENTS_SOURCE = "public-multi-sport-scoreboard-evidence";
export const MULTI_SPORT_EVENTS_REPLAY_SOURCE = "public-multi-sport-scoreboard-replay";
export const MULTI_SPORT_EVENTS_DETAIL_SOURCE = "public-multi-sport-event-detail";
export const MULTI_SPORT_EVENTS_MAX_PROVIDERS = 3;
export const MULTI_SPORT_EVENTS_MAX_RECORDS_PER_PROVIDER = 12;
export const MULTI_SPORT_EVENTS_FETCH_TIMEOUT_MS = 9_000;
export const MULTI_SPORT_EVENTS_MAX_DETAIL_REQUESTS = 1;
export const MULTI_SPORT_EVENTS_MAX_DETAIL_PLAY_ROWS = 48;

export const MULTI_SPORT_EVENTS_BOUNDARY =
  "Public ESPN scoreboard responses are unverified research observations. Participant, score, status, time, venue, and competition fields may be missing or stale; completeness is a field-presence measure only and no outcome, performance, or executable authority is active.";

export const MULTI_SPORT_EVENTS_DETAIL_BOUNDARY =
  "Explicit ESPN public event-summary inspection only. Participant/player context, period or quarter rows, and play-by-play are shown only when returned by the provider; missing detail remains unavailable, completeness is field presence only, and no outcome, performance, betting, or executable authority is inferred.";

const ESPN_SCOREBOARD_BASE = "https://site.web.api.espn.com/apis/site/v2/sports";

/** Fixed endpoint allowlist. Do not turn URL query values into provider URLs. */
export const MULTI_SPORT_EVENTS_ENDPOINTS = Object.freeze([
  Object.freeze({
    id: "espn-soccer-eng1-scoreboard",
    provider: "ESPN public web API · English Premier League scoreboard",
    sport: "soccer",
    league: "eng.1",
    leagueLabel: "English Premier League",
    endpoint: `${ESPN_SCOREBOARD_BASE}/soccer/eng.1/scoreboard`,
  }),
  Object.freeze({
    id: "espn-basketball-nba-scoreboard",
    provider: "ESPN public web API · NBA scoreboard",
    sport: "basketball",
    league: "nba",
    leagueLabel: "National Basketball Association",
    endpoint: `${ESPN_SCOREBOARD_BASE}/basketball/nba/scoreboard`,
  }),
  Object.freeze({
    id: "espn-football-nfl-scoreboard",
    provider: "ESPN public web API · NFL scoreboard",
    sport: "football",
    league: "nfl",
    leagueLabel: "National Football League",
    endpoint: `${ESPN_SCOREBOARD_BASE}/football/nfl/scoreboard`,
  }),
]);

const freeze = (value) => Object.freeze(value);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = null) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function integer(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) ? candidate : fallback;
}

function number(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
}

function timestamp(value) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  return timestamp(value) ?? new Date().toISOString();
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return freeze(value);
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

function safeError(error) {
  if (error?.name === "AbortError" || /\babort(?:ed|ing)?\b/i.test(String(error?.message ?? ""))) {
    return "Provider request timed out before a usable response arrived.";
  }
  return String(error?.message ?? error ?? "provider unavailable").trim().slice(0, 180) || "provider unavailable";
}

function linksFrom(value) {
  const links = Array.isArray(value?.links) ? value.links : [];
  return links
    .map((link) => ({
      href: publicSourceUrl(link?.href ?? link?.url),
      rel: Array.isArray(link?.rel) ? link.rel.filter((entry) => typeof entry === "string") : [],
    }))
    .filter((link) => link.href);
}

function firstSourceUrl(...values) {
  const links = values.flatMap((value) => linksFrom(value));
  return links.find((link) => link.rel.includes("summary"))?.href
    ?? links.find((link) => link.rel.includes("event"))?.href
    ?? links[0]?.href
    ?? null;
}

function scoreDisplay(value) {
  if (value === null || value === undefined || value === "") return null;
  if (isRecord(value)) return text(value.displayValue ?? value.display ?? value.text ?? value.value);
  return String(value);
}

function normalizeStatus(competition, event) {
  const raw = isRecord(competition?.status) ? competition.status : isRecord(event?.status) ? event.status : {};
  const type = isRecord(raw.type) ? raw.type : {};
  const state = text(type.state ?? raw.state);
  const completed = typeof type.completed === "boolean"
    ? type.completed
    : typeof raw.completed === "boolean" ? raw.completed : null;
  const final = completed === true ? true : completed === false ? false : state === "post" ? true : state === "pre" ? false : null;
  const label = text(type.description ?? type.detail ?? type.shortDetail ?? type.name ?? raw.description ?? raw.state, "status unavailable");
  return {
    label,
    state,
    completed,
    final,
    clock: text(raw.displayClock ?? type.displayClock ?? raw.clock),
    period: integer(raw.period ?? type.period),
    source: completed !== null || state ? "provider-reported" : "unavailable",
  };
}

function normalizeParticipant(raw) {
  if (!isRecord(raw)) return null;
  const entity = isRecord(raw.team)
    ? raw.team
    : isRecord(raw.athlete) ? raw.athlete
      : isRecord(raw.player) ? raw.player
        : raw;
  const id = text(raw.id ?? entity.id ?? raw.uid);
  const name = text(
    entity.displayName
      ?? entity.fullName
      ?? entity.name
      ?? entity.location
      ?? raw.displayName
      ?? raw.name,
  );
  if (!id && !name) return null;
  const scoreRaw = raw.score ?? raw.points ?? raw.runs ?? raw.goals;
  const score = scoreDisplay(scoreRaw);
  const numericScore = number(scoreRaw);
  const curatedRank = isRecord(raw.curatedRank) ? integer(raw.curatedRank.current) : null;
  const country = text(entity.country ?? entity.countryName ?? entity.location);
  const records = Array.isArray(raw.records)
    ? raw.records.slice(0, 3).map((record) => ({
      name: text(record?.name),
      type: text(record?.type),
      summary: text(record?.summary),
    })).filter((record) => record.name || record.summary)
    : [];
  return {
    id,
    name,
    shortName: text(entity.shortDisplayName ?? entity.shortName ?? entity.abbreviation ?? raw.abbreviation),
    abbreviation: text(entity.abbreviation ?? raw.abbreviation),
    kind: text(raw.type ?? (raw.team ? "team" : raw.athlete || raw.player ? "player" : "participant"), "participant"),
    homeAway: text(raw.homeAway),
    winner: typeof raw.winner === "boolean" ? raw.winner : null,
    score,
    scoreValue: numericScore,
    scoreStatus: score !== null ? "provider-reported" : "unavailable",
    rank: curatedRank,
    rankStatus: curatedRank === null ? "unavailable" : "provider-reported",
    country,
    records,
  };
}

function normalizeLeaders(competition) {
  const groups = Array.isArray(competition?.leaders) ? competition.leaders : [];
  return groups.slice(0, 6).map((group) => ({
    name: text(group?.name),
    label: text(group?.displayName ?? group?.shortDisplayName),
    participants: (Array.isArray(group?.leaders) ? group.leaders : []).slice(0, 4).map((entry) => ({
      name: text(entry?.athlete?.displayName ?? entry?.athlete?.fullName ?? entry?.name),
      value: text(entry?.displayValue ?? entry?.value),
    })).filter((entry) => entry.name || entry.value),
  })).filter((group) => group.name || group.label || group.participants.length);
}

function normalizeCompetition(payload, endpoint, event, competition, retrievedAt, index) {
  const competitionId = text(competition?.id ?? event?.id);
  if (!competitionId) return null;
  const eventId = text(event?.id);
  const participants = (Array.isArray(competition?.competitors) ? competition.competitors : [])
    .map(normalizeParticipant)
    .filter(Boolean)
    .slice(0, 8);
  if (!participants.length) return null;
  const statusDetail = normalizeStatus(competition, event);
  const eventTime = timestamp(competition?.startDate ?? competition?.date ?? event?.date);
  const eventName = text(event?.name ?? event?.shortName);
  const sourceUrl = firstSourceUrl(competition, event) ?? endpoint.endpoint;
  const venueRaw = isRecord(competition?.venue)
    ? competition.venue
    : isRecord(event?.venue) ? event.venue : {};
  const address = isRecord(venueRaw.address) ? venueRaw.address : {};
  const venue = {
    id: text(venueRaw.id),
    name: text(venueRaw.fullName ?? venueRaw.displayName ?? venueRaw.name),
    city: text(address.city),
    state: text(address.state),
    country: text(address.country),
  };
  const league = isRecord(payload?.leagues?.[0]) ? payload.leagues[0] : {};
  const season = isRecord(event?.season) ? event.season : isRecord(competition?.season) ? competition.season : {};
  const week = isRecord(event?.week) ? integer(event.week.number) : integer(competition?.week?.number);
  const title = eventName
    ?? participants.map((participant) => participant.name).filter(Boolean).join(" vs ")
    ?? `${endpoint.leagueLabel} event ${competitionId}`;
  const checks = {
    sourceUrl: Boolean(sourceUrl),
    competition: Boolean(competitionId),
    participants: participants.length >= 2,
    status: statusDetail.source === "provider-reported",
    eventTime: Boolean(eventTime),
    scores: participants.some((participant) => participant.scoreStatus === "provider-reported"),
    venue: Boolean(venue.name),
  };
  const dataCompletenessScore = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  const dataCompletenessGrade = dataCompletenessScore >= 0.875 ? "A"
    : dataCompletenessScore >= 0.75 ? "B"
      : dataCompletenessScore >= 0.625 ? "C" : "D";
  const record = {
    id: `espn-multi-sport:${endpoint.sport}:${endpoint.league}:${text(event?.id, "event")}:${competitionId}:${index}`,
    providerId: endpoint.id,
    provider: endpoint.provider,
    sport: endpoint.sport,
    league: endpoint.league,
    eventId,
    leagueLabel: text(league.name ?? league.abbreviation, endpoint.leagueLabel),
    title,
    competition: {
      id: competitionId,
      name: eventName,
      round: text(competition?.round?.displayName ?? competition?.round?.name ?? event?.round?.displayName),
      type: text(competition?.type?.text ?? competition?.type?.abbreviation),
      season: text(season.slug ?? season.year),
      seasonYear: integer(season.year),
      week,
    },
    participants,
    // `teams` and `players` are explicit aliases for consumers that want a
    // domain-specific term; both remain provider-returned observations.
    teams: participants.filter((participant) => participant.kind === "team"),
    players: participants.filter((participant) => participant.kind === "player"),
    status: statusDetail.label,
    statusDetail,
    eventTime,
    eventTimeStatus: eventTime ? "provider-reported" : "unavailable",
    scoreStatus: participants.some((participant) => participant.scoreStatus === "provider-reported") ? "provider-reported" : "unavailable",
    scoreCount: participants.filter((participant) => participant.scoreStatus === "provider-reported").length,
    venue,
    leaders: normalizeLeaders(competition),
    sourceUrl,
    sourceObservedAt: retrievedAt,
    retrievedAt,
    dataCompletenessGrade,
    dataCompletenessScore: Number(dataCompletenessScore.toFixed(2)),
    dataCompletenessPercent: Math.round(dataCompletenessScore * 100),
    gradeKind: "data-completeness",
    completenessChecks: checks,
    sourceAttribution: "unverified ESPN public scoreboard metadata",
    providerAvailable: true,
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
  };
  return record;
}

/** Normalize only provider-returned competition rows; no placeholders. */
export function normalizeMultiSportScoreboard(payload, endpoint, retrievedAt, maxRecords = MULTI_SPORT_EVENTS_MAX_RECORDS_PER_PROVIDER) {
  if (!isRecord(payload) || !isRecord(endpoint)) return [];
  const events = Array.isArray(payload.events) ? payload.events : [];
  const records = [];
  const seen = new Set();
  for (const event of events) {
    if (records.length >= maxRecords) break;
    const competitions = Array.isArray(event?.competitions)
      ? event.competitions
      : Array.isArray(event?.groupings)
        ? event.groupings.flatMap((grouping) => Array.isArray(grouping?.competitions) ? grouping.competitions : [])
        : [];
    for (const competition of competitions) {
      if (records.length >= maxRecords) break;
      const competitionId = text(competition?.id ?? event?.id);
      if (!competitionId || seen.has(competitionId)) continue;
      seen.add(competitionId);
      const record = normalizeCompetition(payload, endpoint, event, competition, retrievedAt, records.length);
      if (record) records.push(record);
    }
  }
  return records;
}

function sourceStatus(endpoint, retrievedAt, values = {}) {
  return {
    id: endpoint.id,
    provider: endpoint.provider,
    endpoint: endpoint.endpoint,
    sport: endpoint.sport,
    league: endpoint.league,
    leagueLabel: endpoint.leagueLabel,
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

function validEndpoint(endpoint) {
  return MULTI_SPORT_EVENTS_ENDPOINTS.some((candidate) => (
    candidate.id === endpoint?.id && candidate.endpoint === endpoint?.endpoint
  ));
}

export function createUnavailableMultiSportEvents({
  retrievedAt = new Date().toISOString(),
  reason = "No public multi-sport scoreboard response is available in this session.",
} = {}) {
  const retrieved = nowIso(retrievedAt);
  return deepFreeze({
    schemaVersion: MULTI_SPORT_EVENTS_SCHEMA_VERSION,
    source: MULTI_SPORT_EVENTS_SOURCE,
    status: "unavailable",
    sports: MULTI_SPORT_EVENTS_ENDPOINTS.map((endpoint) => endpoint.sport),
    leagues: MULTI_SPORT_EVENTS_ENDPOINTS.map((endpoint) => endpoint.league),
    retrievedAt: retrieved,
    records: [],
    sources: MULTI_SPORT_EVENTS_ENDPOINTS.map((endpoint) => sourceStatus(endpoint, retrieved, {
      available: false,
      recordCount: 0,
      requestUrl: null,
      reason,
    })),
    recordCount: 0,
    providerCount: MULTI_SPORT_EVENTS_ENDPOINTS.length,
    availableProviderCount: 0,
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
    boundary: MULTI_SPORT_EVENTS_BOUNDARY,
    reason,
  });
}

/** Fetch the three fixed scoreboards after an explicit caller request. */
export async function fetchMultiSportEvents({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => new Date().toISOString(),
  maxRecordsPerProvider = MULTI_SPORT_EVENTS_MAX_RECORDS_PER_PROVIDER,
  maxProviders = MULTI_SPORT_EVENTS_MAX_PROVIDERS,
  timeoutMs = MULTI_SPORT_EVENTS_FETCH_TIMEOUT_MS,
  endpoints = MULTI_SPORT_EVENTS_ENDPOINTS,
} = {}) {
  const retrievedAt = nowIso(now);
  const boundedRecords = Number.isSafeInteger(maxRecordsPerProvider) && maxRecordsPerProvider > 0
    ? Math.min(maxRecordsPerProvider, MULTI_SPORT_EVENTS_MAX_RECORDS_PER_PROVIDER)
    : MULTI_SPORT_EVENTS_MAX_RECORDS_PER_PROVIDER;
  const boundedProviders = Number.isSafeInteger(maxProviders) && maxProviders > 0
    ? Math.min(maxProviders, MULTI_SPORT_EVENTS_MAX_PROVIDERS)
    : MULTI_SPORT_EVENTS_MAX_PROVIDERS;
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 60_000)
    : MULTI_SPORT_EVENTS_FETCH_TIMEOUT_MS;
  if (typeof fetchImpl !== "function") {
    return createUnavailableMultiSportEvents({ retrievedAt, reason: "Browser fetch is unavailable; no multi-sport rows were fabricated." });
  }
  const requested = Array.isArray(endpoints) ? endpoints.filter(validEndpoint) : [];
  const endpointList = (requested.length ? requested : [...MULTI_SPORT_EVENTS_ENDPOINTS]).slice(0, boundedProviders);
  const records = [];
  const sources = [];
  for (const endpoint of endpointList) {
    const requestUrl = publicSourceUrl(endpoint.endpoint);
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
      if (!response?.ok || typeof response.json !== "function") throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
      const payload = await response.json();
      const nextRecords = normalizeMultiSportScoreboard(payload, endpoint, retrievedAt, boundedRecords);
      if (!nextRecords.length) {
        sources.push(sourceStatus(endpoint, retrievedAt, {
          available: false,
          recordCount: 0,
          requestUrl,
          reason: "Provider returned no usable competition rows; no data was fabricated.",
        }));
        continue;
      }
      records.push(...nextRecords);
      sources.push(sourceStatus(endpoint, retrievedAt, {
        available: true,
        recordCount: nextRecords.length,
        requestUrl,
        reason: null,
      }));
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
  const availableProviderCount = sources.filter((source) => source.available === true).length;
  const limitedRecords = records.slice(0, boundedRecords * endpointList.length);
  const status = limitedRecords.length
    ? availableProviderCount === sources.length ? "ready" : "partial"
    : "unavailable";
  return deepFreeze({
    schemaVersion: MULTI_SPORT_EVENTS_SCHEMA_VERSION,
    source: MULTI_SPORT_EVENTS_SOURCE,
    status,
    sports: endpointList.map((endpoint) => endpoint.sport),
    leagues: endpointList.map((endpoint) => endpoint.league),
    retrievedAt,
    records: limitedRecords,
    sources,
    recordCount: limitedRecords.length,
    providerCount: sources.length,
    availableProviderCount,
    providerAvailable: availableProviderCount > 0,
    providerUnavailable: availableProviderCount === 0,
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
    boundary: MULTI_SPORT_EVENTS_BOUNDARY,
    reason: limitedRecords.length ? null : "No provider returned a usable competition row; no multi-sport rows were fabricated.",
  });
}

/**
 * Derive the single provider-owned event-summary URL used by explicit detail
 * inspection.  The event id is copied from the scoreboard response; callers
 * cannot turn a query-string value or arbitrary URL into a provider request.
 */
export function publicMultiSportEventDetailReference(record) {
  const endpoint = MULTI_SPORT_EVENTS_ENDPOINTS.find((candidate) => (
    candidate.sport === record?.sport && candidate.league === record?.league
  ));
  const eventId = text(record?.eventId);
  if (!endpoint || !eventId || !/^[A-Za-z0-9._:-]{1,120}$/.test(eventId)) return null;
  const candidate = `${ESPN_SCOREBOARD_BASE}/${endpoint.sport}/${endpoint.league}/summary?event=${encodeURIComponent(eventId)}`;
  return publicSourceUrl(candidate);
}

function detailCompetition(payload) {
  const candidates = [
    ...(Array.isArray(payload?.header?.competitions) ? payload.header.competitions : []),
    ...(Array.isArray(payload?.competitions) ? payload.competitions : []),
    ...(Array.isArray(payload?.event?.competitions) ? payload.event.competitions : []),
    ...(isRecord(payload?.competition) ? [payload.competition] : []),
  ];
  return candidates.find(isRecord) ?? null;
}

function detailCompetitors(payload) {
  const competition = detailCompetition(payload);
  const candidates = [
    ...(Array.isArray(competition?.competitors) ? competition.competitors : []),
    ...(Array.isArray(payload?.competitors) ? payload.competitors : []),
    ...(Array.isArray(payload?.header?.competitions?.[0]?.competitors) ? payload.header.competitions[0].competitors : []),
  ];
  const seen = new Set();
  return candidates.filter((candidate) => {
    const id = text(candidate?.id ?? candidate?.team?.id ?? candidate?.athlete?.id ?? candidate?.uid);
    const key = id ?? JSON.stringify(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return isRecord(candidate);
  }).slice(0, 16);
}

function detailParticipant(raw, fallbackKind = "participant", team = null) {
  if (!isRecord(raw)) return null;
  const entity = isRecord(raw.team)
    ? raw.team
    : isRecord(raw.athlete) ? raw.athlete
      : isRecord(raw.player) ? raw.player
        : raw;
  const id = text(raw.id ?? entity.id ?? raw.uid);
  const name = text(entity.displayName ?? entity.fullName ?? entity.name ?? entity.shortName ?? raw.displayName ?? raw.name);
  if (!id && !name) return null;
  const stats = Array.isArray(raw.stats)
    ? raw.stats
    : Array.isArray(raw.statistics) ? raw.statistics : [];
  const statLines = stats.slice(0, 10).map((stat) => {
    if (isRecord(stat)) {
      const label = text(stat.label ?? stat.name ?? stat.displayName ?? stat.abbreviation);
      const value = text(stat.displayValue ?? stat.value ?? stat.display);
      return label || value ? { label, value } : null;
    }
    return text(stat) ? { label: null, value: text(stat) } : null;
  }).filter(Boolean);
  return {
    id,
    name,
    kind: text(raw.type ?? (raw.athlete || raw.player ? "player" : raw.team ? "team" : fallbackKind), fallbackKind),
    teamId: text(team?.id ?? raw.team?.id),
    teamName: text(team?.displayName ?? team?.name ?? raw.team?.displayName ?? raw.team?.name),
    position: text(raw.position?.displayName ?? raw.position?.abbreviation ?? raw.position),
    jersey: text(raw.jersey ?? entity.jersey),
    status: text(raw.status?.type?.description ?? raw.status?.description ?? raw.status),
    statLines,
    providerReported: true,
  };
}

function detailPlayers(payload) {
  const players = [];
  const seen = new Set();
  const add = (raw, team = null) => {
    const normalized = detailParticipant(raw, "player", team);
    if (!normalized || normalized.kind === "team") return;
    const key = normalized.id ?? normalized.name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    players.push(normalized);
  };
  const groups = Array.isArray(payload?.boxscore?.players) ? payload.boxscore.players : [];
  groups.slice(0, 16).forEach((group) => {
    const team = isRecord(group?.team) ? group.team : null;
    const statistics = Array.isArray(group?.statistics) ? group.statistics : [];
    statistics.slice(0, 8).forEach((statGroup) => {
      const athletes = Array.isArray(statGroup?.athletes)
        ? statGroup.athletes
        : Array.isArray(statGroup?.players) ? statGroup.players : [];
      athletes.slice(0, 24).forEach((athlete) => {
        const row = isRecord(athlete) ? { ...athlete, stats: athlete.stats ?? statGroup.stats } : athlete;
        add(row, team);
      });
    });
    if (Array.isArray(group?.athletes)) group.athletes.slice(0, 24).forEach((athlete) => add(athlete, team));
  });
  const rosters = Array.isArray(payload?.rosters) ? payload.rosters : [];
  rosters.slice(0, 16).forEach((group) => {
    const team = isRecord(group?.team) ? group.team : null;
    const roster = Array.isArray(group?.roster) ? group.roster : [];
    roster.slice(0, 32).forEach((row) => add({ ...row, stats: row?.stats }, team));
  });
  const leaders = Array.isArray(payload?.leaders) ? payload.leaders : [];
  leaders.slice(0, 12).forEach((group) => {
    const team = isRecord(group?.team) ? group.team : null;
    const entries = Array.isArray(group?.leaders) ? group.leaders : [];
    entries.slice(0, 12).forEach((entry) => add({ ...entry, stats: [{ label: group?.displayName ?? group?.name, value: entry?.displayValue ?? entry?.value }], athlete: entry?.athlete }, team));
  });
  const direct = [
    ...(Array.isArray(payload?.players) ? payload.players : []),
    ...(Array.isArray(payload?.athletes) ? payload.athletes : []),
  ];
  direct.slice(0, 32).forEach((player) => add(player, null));
  return players.slice(0, 48);
}

function detailPeriods(payload) {
  const periods = new Map();
  detailCompetitors(payload).slice(0, 16).forEach((competitor) => {
    const participant = detailParticipant(competitor, "team");
    const linescores = Array.isArray(competitor?.linescores)
      ? competitor.linescores
      : Array.isArray(competitor?.lineScores) ? competitor.lineScores : [];
    linescores.slice(0, 16).forEach((line, index) => {
      const period = integer(line?.period ?? line?.periodNumber ?? line?.quarter ?? line?.number ?? line?.index, index + 1);
      if (period === null) return;
      const value = scoreDisplay(line?.displayValue ?? line?.value ?? line?.score ?? line?.points);
      const row = periods.get(period) ?? { period, label: text(line?.label ?? line?.name, `PERIOD ${period}`), scores: [] };
      if (participant && value !== null) row.scores.push({
        participantId: participant.id,
        participantName: participant.name,
        value,
        winner: typeof line?.winner === "boolean" ? line.winner : null,
      });
      periods.set(period, row);
    });
  });
  return [...periods.values()].map((period) => ({
    period: period.period,
    label: period.label,
    scores: period.scores.slice(0, 16),
    scoreCount: period.scores.length,
    status: period.scores.length ? "provider-reported" : "unavailable",
  })).filter((period) => period.scores.length);
}

const DETAIL_PLAY_KEYS = Object.freeze(["plays", "playByPlay", "commentary", "actions", "events", "items", "drive", "drives"]);

function detailPlayRows(value, rows = [], depth = 0) {
  if (depth > 4 || value === null || value === undefined || rows.length >= MULTI_SPORT_EVENTS_MAX_DETAIL_PLAY_ROWS) return rows;
  if (Array.isArray(value)) {
    value.slice(0, MULTI_SPORT_EVENTS_MAX_DETAIL_PLAY_ROWS).forEach((entry) => detailPlayRows(entry, rows, depth + 1));
    return rows;
  }
  if (!isRecord(value)) return rows;
  const nestedPlay = isRecord(value.play) ? value.play : {};
  const textValue = text(value.text ?? value.description ?? value.shortText ?? value.label ?? value.type?.text ?? value.result ?? value.outcome ?? nestedPlay.text ?? nestedPlay.description);
  const score = scoreDisplay(value.score ?? value.displayValue ?? value.value ?? value.points ?? nestedPlay.score);
  const period = integer(value.period ?? value.periodNumber ?? value.quarter ?? value.periodIndex ?? nestedPlay.period?.number ?? nestedPlay.period);
  const clock = text(value.clock?.displayValue ?? value.clock ?? value.displayClock ?? value.time?.displayValue ?? value.time ?? nestedPlay.clock?.displayValue ?? nestedPlay.clock);
  const hasSignal = Boolean(textValue || score || period !== null || clock);
  if (hasSignal && !/(odds|pickcenter|betting|predictor)/i.test(`${textValue ?? ""} ${value.type?.name ?? ""}`)) {
    rows.push({
      index: rows.length + 1,
      id: text(value.id ?? value.uid ?? value.sequence, `play-${rows.length + 1}`),
      kind: text(value.kind ?? value.type?.name ?? value.type ?? nestedPlay.type?.name ?? nestedPlay.type, "play"),
      text: textValue,
      period,
      quarter: integer(value.quarter, period),
      clock,
      score,
      participant: text(value.athlete?.displayName ?? value.player?.displayName ?? value.player?.name ?? value.team?.displayName ?? value.team?.name ?? nestedPlay.team?.displayName ?? nestedPlay.team?.name),
      providerReported: true,
    });
  }
  DETAIL_PLAY_KEYS.forEach((key) => {
    if (value[key] !== undefined) detailPlayRows(value[key], rows, depth + 1);
  });
  return rows;
}

function detailTimeline(payload) {
  const rows = [];
  DETAIL_PLAY_KEYS.forEach((key) => {
    if (payload?.[key] !== undefined) detailPlayRows(payload[key], rows);
  });
  if (!rows.length && payload?.header) DETAIL_PLAY_KEYS.forEach((key) => {
    if (payload.header?.[key] !== undefined) detailPlayRows(payload.header[key], rows);
  });
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.id}:${row.text ?? ""}:${row.clock ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MULTI_SPORT_EVENTS_MAX_DETAIL_PLAY_ROWS);
}

function detailCompleteness({ sourceUrl, record, detailStatus, participants, players, periods, timeline }) {
  const checks = {
    sourceUrl: Boolean(sourceUrl),
    event: Boolean(record?.eventId),
    participants: participants.length >= 2,
    playerContext: players.length > 0,
    status: detailStatus?.source === "provider-reported",
    periodDetail: periods.length > 0,
    playByPlay: timeline.length > 0,
  };
  const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  const grade = score >= 0.875 ? "A" : score >= 0.75 ? "B" : score >= 0.625 ? "C" : "D";
  return {
    checks,
    score: Number(score.toFixed(2)),
    percent: Math.round(score * 100),
    grade,
    gradeKind: "data-completeness",
  };
}

function detailSourceStatus({ sourceUrl, recordId, available, requestStatus, reason, retrievedAt }) {
  return {
    id: "espn-multi-sport-event-detail",
    provider: "ESPN public web API · event summary",
    endpoint: sourceUrl,
    recordId,
    available,
    requestStatus,
    reason: reason ?? null,
    retrievedAt,
    localOnly: true,
    simulation: true,
    externalSource: true,
    truthClaim: false,
    executable: false,
  };
}

function detailEnvelope(record, {
  status = "unavailable",
  requestStatus = "unavailable",
  sourceUrl = null,
  retrievedAt,
  participants = [],
  players = [],
  periods = [],
  timeline = [],
  detailStatus = null,
  reason = null,
  notes = [],
  requestCount = 0,
} = {}) {
  const allParticipants = participants.length ? participants : detailCompetitors(record?.providerDetailPayload ?? {});
  const completeness = detailCompleteness({ sourceUrl, record, detailStatus, participants: allParticipants, players, periods, timeline });
  const publicDetail = {
    schemaVersion: MULTI_SPORT_EVENTS_SCHEMA_VERSION,
    source: MULTI_SPORT_EVENTS_DETAIL_SOURCE,
    status,
    requestStatus,
    sourceUrl,
    participants: allParticipants,
    players,
    periods,
    periodStatus: periods.length ? "provider-reported" : "unavailable",
    timeline,
    timelineStatus: timeline.length ? "available" : "unavailable",
    timelineReason: timeline.length ? null : (reason ?? "Provider event summary returned no usable play-by-play rows."),
    notes: notes.slice(0, 8),
    detailCompletenessGrade: completeness.grade,
    detailCompletenessScore: completeness.score,
    detailCompletenessPercent: completeness.percent,
    completenessChecks: completeness.checks,
    gradeKind: completeness.gradeKind,
    requestCount,
    retrievedAt,
    localOnly: true,
    simulation: true,
    externalNetwork: requestCount > 0,
    externalSource: true,
    truthClaim: false,
    executable: false,
    boundary: MULTI_SPORT_EVENTS_DETAIL_BOUNDARY,
  };
  return {
    ...record,
    publicDetail,
    detailStatus: status,
    detailRequestStatus: requestStatus,
    detailSourceUrl: sourceUrl,
    detailCompletenessGrade: completeness.grade,
    detailCompletenessScore: completeness.score,
    detailCompletenessPercent: completeness.percent,
    detailCompletenessChecks: completeness.checks,
    localOnly: true,
    simulation: true,
    externalSource: true,
    truthClaim: false,
    executable: false,
  };
}

function unavailableMultiSportDetail(record, retrievedAt, reason, sourceUrl = null, requestStatus = "unavailable") {
  const nextRecord = record
    ? detailEnvelope(record, { status: "unavailable", requestStatus, sourceUrl, retrievedAt, reason })
    : null;
  return deepFreeze({
    schemaVersion: MULTI_SPORT_EVENTS_SCHEMA_VERSION,
    source: MULTI_SPORT_EVENTS_DETAIL_SOURCE,
    status: "unavailable",
    requestStatus,
    record: nextRecord,
    sourceUrl,
    detailSources: [],
    requestCount: 0,
    liveFetch: false,
    externalNetwork: false,
    externalSource: Boolean(record),
    localOnly: true,
    simulation: true,
    truthClaim: false,
    executable: false,
    boundary: MULTI_SPORT_EVENTS_DETAIL_BOUNDARY,
    reason,
  });
}

async function requestMultiSportDetail(fetchImpl, url, timeoutMs) {
  let timeoutHandle = null;
  let abortController = null;
  try {
    if (typeof globalThis.AbortController === "function") {
      abortController = new globalThis.AbortController();
      timeoutHandle = globalThis.setTimeout?.(() => abortController.abort(), timeoutMs) ?? null;
    }
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(abortController ? { signal: abortController.signal } : {}),
    });
    if (!response?.ok || typeof response.json !== "function") throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
    return response.json();
  } finally {
    if (timeoutHandle !== null) globalThis.clearTimeout?.(timeoutHandle);
  }
}

/**
 * Fetch one ESPN event summary only after an explicit selected-event action.
 * The default three-scoreboard refresh never calls this function.  All
 * participant/player, period/quarter, and play rows are reduced from this
 * provider response; absent fields stay empty and no betting/execution data is
 * admitted.
 */
export async function fetchMultiSportEventDetail({
  record = null,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => new Date().toISOString(),
  timeoutMs = MULTI_SPORT_EVENTS_FETCH_TIMEOUT_MS,
  maxRequests = MULTI_SPORT_EVENTS_MAX_DETAIL_REQUESTS,
} = {}) {
  const retrievedAt = nowIso(now);
  const sourceUrl = publicMultiSportEventDetailReference(record);
  if (!record || !sourceUrl) {
    return unavailableMultiSportDetail(record, retrievedAt, "No eligible ESPN event identifier was available for detail inspection.", sourceUrl, "not-requested");
  }
  if (typeof fetchImpl !== "function") {
    return unavailableMultiSportDetail(record, retrievedAt, "Browser fetch is unavailable; no provider detail was fabricated.", sourceUrl, "not-requested");
  }
  const boundedRequests = Number.isSafeInteger(maxRequests) && maxRequests >= 0
    ? Math.min(maxRequests, MULTI_SPORT_EVENTS_MAX_DETAIL_REQUESTS)
    : MULTI_SPORT_EVENTS_MAX_DETAIL_REQUESTS;
  if (boundedRequests < 1) {
    return unavailableMultiSportDetail(record, retrievedAt, "The explicit provider-detail request budget was zero; no detail request was made.", sourceUrl, "deferred");
  }
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 60_000)
    : MULTI_SPORT_EVENTS_FETCH_TIMEOUT_MS;
  let payload;
  try {
    payload = await requestMultiSportDetail(fetchImpl, sourceUrl, boundedTimeout);
  } catch (error) {
    const reason = `Provider event-summary request failed: ${safeError(error)}`;
    const result = unavailableMultiSportDetail(record, retrievedAt, reason, sourceUrl, "unavailable");
    return deepFreeze({ ...result, requestCount: 1, detailSources: [detailSourceStatus({ sourceUrl, recordId: record.id, available: false, requestStatus: "unavailable", reason, retrievedAt })], externalNetwork: true, liveFetch: true });
  }
  if (!isRecord(payload)) {
    const reason = "Provider event summary returned no usable JSON object.";
    const result = unavailableMultiSportDetail(record, retrievedAt, reason, sourceUrl, "unavailable");
    return deepFreeze({ ...result, requestCount: 1, detailSources: [detailSourceStatus({ sourceUrl, recordId: record.id, available: false, requestStatus: "unavailable", reason, retrievedAt })], externalNetwork: true, liveFetch: true });
  }
  const competition = detailCompetition(payload);
  const detailStatus = normalizeStatus(competition, payload?.header ?? payload);
  const participants = detailCompetitors(payload).map((candidate) => detailParticipant(candidate, "team")).filter(Boolean);
  const players = detailPlayers(payload);
  const periods = detailPeriods(payload);
  const timeline = detailTimeline(payload);
  const notes = Array.isArray(payload.notes)
    ? payload.notes.map((note) => text(note?.text ?? note?.description ?? note)).filter(Boolean)
    : [];
  const reason = timeline.length || periods.length
    ? null
    : "Provider event summary returned no usable play-by-play or period rows.";
  const nextRecord = detailEnvelope(record, {
    status: "available",
    requestStatus: "available",
    sourceUrl,
    retrievedAt,
    participants,
    players,
    periods,
    timeline,
    detailStatus,
    reason,
    notes,
    requestCount: 1,
  });
  return deepFreeze({
    schemaVersion: MULTI_SPORT_EVENTS_SCHEMA_VERSION,
    source: MULTI_SPORT_EVENTS_DETAIL_SOURCE,
    status: "ready",
    requestStatus: "available",
    record: nextRecord,
    sourceUrl,
    detailSources: [detailSourceStatus({ sourceUrl, recordId: record.id, available: true, requestStatus: "available", reason, retrievedAt })],
    requestCount: 1,
    liveFetch: true,
    externalNetwork: true,
    externalSource: true,
    localOnly: true,
    simulation: true,
    truthClaim: false,
    executable: false,
    boundary: MULTI_SPORT_EVENTS_DETAIL_BOUNDARY,
    reason,
  });
}

export function replayMultiSportEvents(snapshot, recordId = null, method = "local-replay") {
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  const record = records.find((candidate) => candidate?.id === recordId) ?? records[0] ?? null;
  return deepFreeze({
    schemaVersion: MULTI_SPORT_EVENTS_SCHEMA_VERSION,
    source: MULTI_SPORT_EVENTS_REPLAY_SOURCE,
    action: "replay",
    method: text(method, "local-replay"),
    recordId: record?.id ?? null,
    record,
    recordCount: records.length,
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
    boundary: MULTI_SPORT_EVENTS_BOUNDARY,
  });
}

export function summarizeMultiSportEvents(input = null) {
  const value = isRecord(input) ? input : createUnavailableMultiSportEvents();
  const records = Array.isArray(value.records) ? value.records : [];
  const sources = Array.isArray(value.sources) ? value.sources : [];
  const sports = [...new Set(records.map((record) => record?.sport).filter(Boolean))];
  const leagues = [...new Set(records.map((record) => record?.league).filter(Boolean))];
  const researchSummary = Object.fromEntries([...new Set(records.map((record) => record?.sport).filter(Boolean))].map((sport) => {
    const rows = records.filter((record) => record?.sport === sport);
    return [sport, { eventCount: rows.length, scoreReportedCount: rows.filter((r) => r?.scoreStatus === "provider-reported").length, statusReportedCount: rows.filter((r) => r?.status && r.status !== "unavailable").length, timeReportedCount: rows.filter((r) => r?.eventTime).length, completenessAverage: rows.length ? Math.round(rows.reduce((sum, r) => sum + (Number(r?.dataCompletenessPercent) || 0), 0) / rows.length) : 0 }];
  }));
  return deepFreeze({
    schemaVersion: MULTI_SPORT_EVENTS_SCHEMA_VERSION,
    source: MULTI_SPORT_EVENTS_SOURCE,
    status: text(value.status, records.length ? "ready" : "unavailable"),
    sports: sports.length ? sports : (Array.isArray(value.sports) ? value.sports : []),
    leagues: leagues.length ? leagues : (Array.isArray(value.leagues) ? value.leagues : []),
    retrievedAt: timestamp(value.retrievedAt),
    records,
    researchSummary,
    sources,
    recordCount: records.length,
    providerCount: sources.length,
    availableProviderCount: sources.filter((source) => source?.available === true).length,
    scoreReportedCount: records.filter((record) => record?.scoreStatus === "provider-reported").length,
    participantReportedCount: records.filter((record) => Array.isArray(record?.participants) && record.participants.length > 0).length,
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
    boundary: text(value.boundary, MULTI_SPORT_EVENTS_BOUNDARY),
    reason: text(value.reason, records.length ? null : "No public multi-sport data is available; no rows were fabricated."),
  });
}

export default fetchMultiSportEvents;

/* ------------------------------------------------------------------ */
/* "All leagues" single-league scoreboard queue (Phase 2).            */
/*                                                                    */
/* Additive-only: nothing above this line was changed. The 3-provider */
/* refresh path keeps working byte-identically.                       */
/* ------------------------------------------------------------------ */

export const MULTI_SPORT_EVENTS_LEAGUE_MAX_RECORDS = 120;
export const LEAGUE_SCOREBOARD_MIN_INTERVAL_MS = 1000;
export const LEAGUE_SCOREBOARD_CACHE_TTLS = Object.freeze({
  live: 45_000,
  settled: 600_000,
  empty: 180_000,
});
export const LEAGUE_SCOREBOARD_SESSION_BUDGET = 90;

/**
 * Slug allowlist shape. The catalog itself is the allowlist: a slug must
 * both match this shape AND be a catalog entry before any network call.
 * (The contract's `{2,4}` first segment was widened to `{2,8}` because the
 * probe-verified catalog contains `conmebol.libertadores` / `conmebol.sudamericana`.)
 */
export const LEAGUE_SCOREBOARD_SLUG_PATTERN = /^[a-z]{2,8}\.[a-z0-9_.]{1,40}$/;

/**
 * Normalize a scoreboard date to "YYYYMMDD" in UTC, or null when invalid.
 * Accepts a Date, an ISO-8601-ish string (any offset), or a bare YYYYMMDD
 * string (validated as a real calendar date).
 */
export function formatScoreboardDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = value.getUTCMonth() + 1;
    const d = value.getUTCDate();
    return `${String(y).padStart(4, "0")}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  }
  const candidate = text(value);
  if (!candidate) return null;
  if (/^\d{8}$/.test(candidate)) {
    const y = Number(candidate.slice(0, 4));
    const m = Number(candidate.slice(4, 6));
    const d = Number(candidate.slice(6, 8));
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
    return candidate;
  }
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatScoreboardDate(parsed);
}

/**
 * Classify a normalized scoreboard record as live / final / scheduled /
 * unknown from record.statusDetail. Defensive: unknown or partial status
 * shapes degrade to "unknown", never to a fabricated state.
 */
export function classifyScoreboardStatus(record) {
  const detail = isRecord(record) ? (isRecord(record.statusDetail) ? record.statusDetail : null) : null;
  const state = detail ? text(detail.state) : null;
  const completed = detail ? detail.completed : undefined;
  if (completed === true || state === "post") return "final";
  if (state === "in") return "live";
  if (state === "pre" || completed === false) return "scheduled";
  return "unknown";
}

const LEAGUE_SCOREBOARD_EMPTY_REASON = "No matches on this date · the season may be off";
const LEAGUE_SCOREBOARD_BUDGET_REASON = "Slow down — session request budget reached";

function leagueNowMs(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : Date.now();
  } catch {
    return Date.now();
  }
}

function leagueSourceStatus(endpointLike, retrievedAt, values) {
  return sourceStatus(endpointLike, retrievedAt, values);
}

function leagueEndpointLike(entry, dateParam) {
  return Object.freeze({
    id: `espn-league:${entry.slug}`,
    provider: `ESPN public web API · ${entry.espnName} scoreboard`,
    sport: "soccer",
    league: entry.slug,
    leagueLabel: entry.label,
    endpoint: `${ESPN_SCOREBOARD_BASE}/soccer/${entry.slug}/scoreboard?dates=${dateParam}`,
  });
}

function leagueEnvelopeBase({ status, entry, dateParam, retrievedAt }) {
  return {
    schemaVersion: MULTI_SPORT_EVENTS_SCHEMA_VERSION,
    source: MULTI_SPORT_EVENTS_SOURCE,
    status,
    sports: ["soccer"],
    leagues: [entry.slug],
    league: entry.slug,
    leagueLabel: entry.label,
    dateParam,
    retrievedAt,
    records: [],
    sources: [],
    recordCount: 0,
    providerCount: 1,
    availableProviderCount: 0,
    providerAvailable: false,
    providerUnavailable: true,
    empty: false,
    emptyReason: null,
    throttled: false,
    fromCache: false,
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
    boundary: MULTI_SPORT_EVENTS_BOUNDARY,
    reason: null,
  };
}

async function leagueSleep(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => globalThis.setTimeout?.(resolve, ms) ?? resolve());
}

/**
 * Bounded multi-provider league scoreboard fetcher (ESPN, TheSportsDB,
 * OpenLigaDB — fixtures/scores only; no odds, wagering, markets, or
 * predictions anywhere in this module).
 *
 * Mandatory guards (never turn UI input into a URL):
 *  - slug must match LEAGUE_SCOREBOARD_SLUG_PATTERN AND be a catalog entry;
 *    otherwise the request promise rejects with no network call.
 *  - single in-flight network request globally; a newly scheduled request
 *    aborts the previous one via AbortController. The slot is released the
 *    moment a fetch starts, so a follow-up request does not wait for the
 *    previous fetch to finish — it aborts it, waits out the min-interval,
 *    then fetches. The superseded promise still resolves (as an
 *    unavailable envelope); nothing is dropped silently.
 *  - at least minIntervalMs between network-call starts, plus any
 *    provider-specific gap (TheSportsDB: 2000ms); requests queue, never drop.
 *  - cache keys come from the provider registry, not from the slug shape:
 *    ESPN `${slug}:${YYYYMMDD}` (one day of scoreboard data), TheSportsDB
 *    `tsdb:<ids>:<season>` (whole season; day envelopes derive from it),
 *    OpenLigaDB `openligadb:<league>:<year>` (whole season; day envelopes
 *    derive from it). TTLs: 45s when any record is live, 10min when all
 *    records are final/scheduled, 3min when zero records. Only ready
 *    envelopes are cached — failed or aborted ones never are.
 *  - session network-call budget (reserved at request time, fail closed);
 *    multi-id providers reserve one unit per HTTP call; past budget,
 *    resolve a throttled envelope with no fetch.
 */
export function createLeagueScoreboardQueue({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => new Date().toISOString(),
  minIntervalMs = LEAGUE_SCOREBOARD_MIN_INTERVAL_MS,
  sessionBudget = LEAGUE_SCOREBOARD_SESSION_BUDGET,
  cacheTtls = LEAGUE_SCOREBOARD_CACHE_TTLS,
  timeoutMs = MULTI_SPORT_EVENTS_FETCH_TIMEOUT_MS,
} = {}) {
  const cache = new Map();
  const boundedInterval = Number.isFinite(Number(minIntervalMs)) && Number(minIntervalMs) >= 0
    ? Number(minIntervalMs)
    : LEAGUE_SCOREBOARD_MIN_INTERVAL_MS;
  const boundedBudget = Number.isSafeInteger(sessionBudget) && sessionBudget > 0 ? sessionBudget : LEAGUE_SCOREBOARD_SESSION_BUDGET;
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 60_000)
    : MULTI_SPORT_EVENTS_FETCH_TIMEOUT_MS;
  const ttls = {
    live: Number.isFinite(Number(cacheTtls?.live)) ? Number(cacheTtls.live) : 45_000,
    settled: Number.isFinite(Number(cacheTtls?.settled)) ? Number(cacheTtls.settled) : 600_000,
    empty: Number.isFinite(Number(cacheTtls?.empty)) ? Number(cacheTtls.empty) : 180_000,
  };
  // The slot promise resolves the moment the current holder STARTS its
  // network call, so a follow-up request can abort the in-flight fetch and
  // claim the slot without waiting for the previous fetch to finish.
  let slotTail = Promise.resolve();
  let inFlightController = null;
  let lastNetworkStartMs = -Infinity;
  // Per-provider last network-start timestamps for provider-specific
  // minimum gaps (e.g. TheSportsDB's 2000ms for its 30 req/min free tier),
  // applied on top of the queue-global minIntervalMs.
  const lastProviderStartMs = new Map();
  let networkCalls = 0;
  let cacheHits = 0;
  let throttledCount = 0;
  let pendingCount = 0;

  function ttlFor(records) {
    if (!records.length) return ttls.empty;
    return records.some((record) => classifyScoreboardStatus(record) === "live") ? ttls.live : ttls.settled;
  }

  function throttledEnvelope(entry, dateParam, retrievedAt) {
    return deepFreeze({
      ...leagueEnvelopeBase({ status: "throttled", entry, dateParam, retrievedAt }),
      providerCount: 0,
      throttled: true,
      liveFetch: false,
      externalNetwork: false,
      reason: LEAGUE_SCOREBOARD_BUDGET_REASON,
    });
  }

  function request({ slug, date } = {}) {
    const entry = typeof slug === "string"
      && LEAGUE_SCOREBOARD_SLUG_PATTERN.test(slug)
      ? findLeagueCatalogEntry(slug)
      : null;
    if (!entry) {
      return Promise.reject(new Error(`Unknown or invalid league slug: ${String(slug ?? "").slice(0, 80)}`));
    }
    let provider;
    try {
      provider = leagueProviderFor(entry);
    } catch (error) {
      return Promise.reject(error);
    }
    const dateParam = date === undefined || date === null ? formatScoreboardDate(now()) : formatScoreboardDate(date);
    if (!dateParam) {
      return Promise.reject(new Error(`Invalid scoreboard date: ${String(date ?? "").slice(0, 80)}`));
    }
    const key = provider.cacheKey(entry, dateParam);
    if (!key) {
      return Promise.reject(new Error(`League provider cannot address this request: ${String(entry.slug).slice(0, 80)}`));
    }
    const cached = cache.get(key);
    if (cached && leagueNowMs(now) < cached.expiresAtMs) {
      cacheHits += 1;
      return Promise.resolve({ envelope: provider.cachedEnvelope(entry, dateParam, cached), fromCache: true });
    }
    if (cached) cache.delete(key);
    if (typeof fetchImpl !== "function") {
      const retrievedAt = nowIso(now);
      const envelope = deepFreeze({
        ...leagueEnvelopeBase({ status: "unavailable", entry, dateParam, retrievedAt }),
        reason: "Browser fetch is unavailable; no league scoreboard rows were fabricated.",
      });
      return Promise.resolve({ envelope, fromCache: false });
    }
    // Budget is reserved at request time so concurrent bursts cannot
    // overshoot; a superseded request keeps its reservation (fail closed).
    if (networkCalls >= boundedBudget) {
      throttledCount += 1;
      const envelope = throttledEnvelope(entry, dateParam, nowIso(now));
      return Promise.resolve({ envelope, fromCache: false });
    }
    networkCalls += 1;
    const myTurn = slotTail;
    let releaseMyTurn = null;
    slotTail = new Promise((resolve) => { releaseMyTurn = resolve; });
    // One network-call slot shared by every provider. The abort, the
    // min-interval wait, and the slot release all happen in the turn's
    // first microtask in exactly this order (like the original
    // single-league code): a follow-up turn aborts a genuinely in-flight
    // fetch, never a controller whose fetch has not started yet.
    // beginNetwork() must stay synchronous and run before the provider's
    // first await for the same reason — an extra async boundary would let
    // the next turn abort a signal before its fetch is even called.
    //
    // The wait covers both the queue-global minIntervalMs and the
    // provider-specific gap (TheSportsDB: 2000ms). Multi-call turns
    // (TheSportsDB leagues with several ids) reuse paceNextCall() before
    // each additional call so every start is paced, not just the first.
    async function paceNextCall() {
      const providerGap = Number(provider?.minIntervalMs) > 0 ? Number(provider.minIntervalMs) : 0;
      const lastProviderStart = lastProviderStartMs.has(provider.id)
        ? lastProviderStartMs.get(provider.id)
        : Number.NEGATIVE_INFINITY;
      const waitMs = Math.max(
        boundedInterval - (leagueNowMs(now) - lastNetworkStartMs),
        providerGap - (leagueNowMs(now) - lastProviderStart),
        0,
      );
      if (waitMs > 0) await leagueSleep(waitMs);
      const startMs = leagueNowMs(now);
      lastNetworkStartMs = startMs;
      lastProviderStartMs.set(provider.id, startMs);
    }
    function beginNetwork() {
      const controller = typeof globalThis.AbortController === "function" ? new globalThis.AbortController() : null;
      inFlightController = controller;
      const timeoutHandle = controller && typeof globalThis.setTimeout === "function"
        ? globalThis.setTimeout(() => controller.abort(), boundedTimeout)
        : null;
      return {
        controller,
        signal: controller ? controller.signal : undefined,
        done() {
          if (timeoutHandle !== null && timeoutHandle !== undefined) globalThis.clearTimeout?.(timeoutHandle);
          if (inFlightController === controller) inFlightController = null;
        },
      };
    }
    const ctx = {
      nowIso: () => nowIso(now),
      fetchImpl,
      boundedTimeout,
      // Extra network calls inside one turn (a provider with several league
      // ids) reserve their own budget; the first call uses the request-time
      // reservation above.
      reserveNetworkCall: () => {
        if (networkCalls >= boundedBudget) {
          throttledCount += 1;
          return false;
        }
        networkCalls += 1;
        return true;
      },
      throttled: (throttledEntry, throttledDateParam) => throttledEnvelope(throttledEntry, throttledDateParam, nowIso(now)),
      beginNetwork,
      paceNextCall,
      // The currently registered in-flight controller. A multi-call turn
      // checks this before each additional call: if a newer turn has
      // superseded this one, it bails out instead of starting work that
      // would clobber the newer turn's abort handle.
      inFlight: () => inFlightController,
      // Only ready envelopes are cached: a superseded (aborted) or failed
      // request must never poison the cache with an "unavailable" snapshot.
      cachePut: (cacheKey, envelope) => {
        if (envelope?.status === "ready") {
          cache.set(cacheKey, {
            envelope,
            expiresAtMs: leagueNowMs(now) + ttlFor(envelope.records),
          });
        }
      },
    };
    return myTurn.then(async () => {
      pendingCount += 1;
      try {
        // A newly scheduled network call supersedes the previous in-flight
        // one via AbortController; the superseded promise still resolves
        // (as an unavailable envelope), it is never dropped silently.
        if (inFlightController && typeof inFlightController.abort === "function") {
          try { inFlightController.abort(); } catch { /* defensive */ }
        }
        await paceNextCall();
        if (releaseMyTurn) releaseMyTurn();
        return await provider.fetchTurn({ entry, dateParam, key, ctx });
      } finally {
        pendingCount -= 1;
      }
    });
  }

  function stats() {
    return deepFreeze({
      networkCalls,
      budget: boundedBudget,
      budgetRemaining: Math.max(0, boundedBudget - networkCalls),
      cacheSize: cache.size,
      cacheHits,
      throttledCount,
      inFlight: inFlightController !== null,
      pending: pendingCount,
    });
  }

  function clear() {
    cache.clear();
    networkCalls = 0;
    cacheHits = 0;
    throttledCount = 0;
    pendingCount = 0;
    lastNetworkStartMs = -Infinity;
    lastProviderStartMs.clear();
    slotTail = Promise.resolve();
    if (inFlightController && typeof inFlightController.abort === "function") {
      try { inFlightController.abort(); } catch { /* defensive */ }
    }
    inFlightController = null;
  }

  return { request, stats, clear };
}

/** Deterministic local replay of a league scoreboard snapshot. No network. */
export function replayLeagueScoreboard(snapshot, recordId = null, method = "local-replay") {
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  const record = records.find((candidate) => candidate?.id === recordId) ?? records[0] ?? null;
  return deepFreeze({
    schemaVersion: MULTI_SPORT_EVENTS_SCHEMA_VERSION,
    source: MULTI_SPORT_EVENTS_REPLAY_SOURCE,
    action: "replay",
    method: text(method, "local-replay"),
    league: text(snapshot?.league),
    leagueLabel: text(snapshot?.leagueLabel),
    dateParam: text(snapshot?.dateParam),
    empty: snapshot?.empty === true,
    recordId: record?.id ?? null,
    record,
    recordCount: records.length,
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
    boundary: MULTI_SPORT_EVENTS_BOUNDARY,
  });
}


/* ------------------------------------------------------------------ */
/* Multi-provider league scoreboard registry (Phase 2 extension).      */
/*                                                                    */
/* The catalog tags every entry with provider "espn" | "thesportsdb"  */
/* | "openligadb" | "sportscore". createLeagueScoreboardQueue's       */
/* request() dispatches to the entry's provider fetcher; all pacing,  */
/* budget, abort, and cache discipline stays global and shared.        */
/* Project law: fixtures/scores only — no odds, wagering, markets,    */
/* predictions, or real-money content from any source.                */
/* ------------------------------------------------------------------ */

/** Provider ids the catalog may tag entries with. */
export const LEAGUE_PROVIDER_IDS = Object.freeze(["espn", "thesportsdb", "openligadb", "sportscore"]);

const LEAGUE_PROVIDER_DISPLAY = Object.freeze({
  espn: "ESPN",
  thesportsdb: "TheSportsDB",
  openligadb: "OpenLigaDB",
  sportscore: "SportScore",
});

/** Display name for a provider id ("thesportsdb" -> "TheSportsDB"); null when unknown. */
export function leagueProviderLabel(providerId) {
  return typeof providerId === "string" ? (LEAGUE_PROVIDER_DISPLAY[providerId] ?? null) : null;
}

const THESPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/3";
export const THESPORTSDB_ATTRIBUTION = "TheSportsDB public API";
const OPENLIGADB_BASE = "https://api.openligadb.de";
export const OPENLIGADB_ATTRIBUTION = "OpenLigaDB";

/**
 * Compute the TheSportsDB season string for a YYYYMMDD date.
 * european: month >= 7 -> "y-y+1", else "y-1-y". calendar: "y".
 * Returns null when the date or season type is unusable.
 */
export function tsdbSeasonString(entry, dateParam) {
  const digits = /^\d{8}$/.test(String(dateParam ?? "")) ? String(dateParam) : null;
  if (!digits) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  if (month < 1 || month > 12) return null;
  if (entry?.seasonType === "european") {
    return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  }
  if (entry?.seasonType === "calendar") return `${year}`;
  return null;
}

function tsdbLeagueIds(entry) {
  const ids = Array.isArray(entry?.tsdbIds) ? entry.tsdbIds : [];
  return ids.filter((id) => Number.isSafeInteger(id) && id > 0);
}

/** Cache key for a whole TheSportsDB season payload: `tsdb:{ids}:{season}`. */
export function tsdbSeasonCacheKey(entry, dateParam) {
  const season = tsdbSeasonString(entry, dateParam);
  const ids = tsdbLeagueIds(entry);
  if (!season || !ids.length) return null;
  return `tsdb:${ids.join(",")}:${season}`;
}

/** eventsseason URL for one league id + season; null when inputs are unsafe. */
export function tsdbSeasonUrl(tsdbId, season) {
  if (!Number.isSafeInteger(tsdbId) || tsdbId <= 0) return null;
  if (!/^\d{4}(-\d{4})?$/.test(String(season ?? ""))) return null;
  return `${THESPORTSDB_BASE}/eventsseason.php?id=${tsdbId}&s=${season}`;
}

function tsdbParticipant(name, homeAway, scoreRaw, otherScoreRaw) {
  const clean = text(name);
  if (!clean) return null;
  const score = integer(scoreRaw, null);
  const other = integer(otherScoreRaw, null);
  return {
    id: null,
    name: clean,
    shortName: null,
    abbreviation: null,
    kind: "team",
    homeAway,
    winner: score !== null && other !== null ? score > other : null,
    score: score === null ? null : String(score),
    scoreValue: score,
    scoreStatus: score === null ? "unavailable" : "provider-reported",
    rank: null,
    rankStatus: "unavailable",
    country: null,
    records: [],
  };
}

/**
 * Normalize one TheSportsDB season event into the shared record shape.
 * Status rule: scores present -> final; no scores and date >= today ->
 * scheduled; no scores and date < today -> unknown. Never "live": the
 * free tier has no live scores, so live is never claimed.
 */
export function normalizeTsdbSeasonEvent(event, {
  entry,
  season,
  retrievedAt,
  index = 0,
  todayIso = new Date().toISOString().slice(0, 10),
} = {}) {
  if (!isRecord(event) || !isRecord(entry)) return null;
  const idEvent = text(event.idEvent);
  const homeName = text(event.strHomeTeam);
  const awayName = text(event.strAwayTeam);
  if (!idEvent || !homeName || !awayName) return null;
  const homeScore = integer(event.intHomeScore, null);
  const awayScore = integer(event.intAwayScore, null);
  const scored = homeScore !== null && awayScore !== null;
  const dateEvent = /^\d{4}-\d{2}-\d{2}$/.test(String(event.dateEvent ?? "")) ? String(event.dateEvent) : null;
  const statusDetail = scored
    ? { label: "Final", state: "post", completed: true, final: true, clock: null, period: null, source: "provider-reported" }
    : dateEvent && dateEvent >= todayIso
      ? { label: "Scheduled", state: "pre", completed: false, final: false, clock: null, period: null, source: "provider-reported" }
      : { label: "status unavailable", state: null, completed: null, final: null, clock: null, period: null, source: "unavailable" };
  const participants = [
    tsdbParticipant(homeName, "home", event.intHomeScore, event.intAwayScore),
    tsdbParticipant(awayName, "away", event.intAwayScore, event.intHomeScore),
  ].filter(Boolean);
  if (participants.length !== 2) return null;
  const eventTime = timestamp(event.strTimestamp)
    ?? timestamp(dateEvent && text(event.strTime) ? `${dateEvent}T${text(event.strTime)}` : null);
  const venue = {
    id: null,
    name: text(event.strVenue),
    city: null,
    state: null,
    country: null,
  };
  const title = text(event.strEvent) ?? `${homeName} vs ${awayName}`;
  const checks = {
    sourceUrl: false, // TheSportsDB exposes no safe per-event page; null by design.
    competition: true,
    participants: participants.length >= 2,
    status: statusDetail.source === "provider-reported",
    eventTime: Boolean(eventTime),
    scores: participants.some((participant) => participant.scoreStatus === "provider-reported"),
    venue: Boolean(venue.name),
  };
  const dataCompletenessScore = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  const dataCompletenessGrade = dataCompletenessScore >= 0.875 ? "A"
    : dataCompletenessScore >= 0.75 ? "B"
      : dataCompletenessScore >= 0.625 ? "C" : "D";
  return {
    id: `thesportsdb:${entry.slug}:${idEvent}`,
    providerId: `thesportsdb-league:${entry.slug}`,
    provider: `${THESPORTSDB_ATTRIBUTION} · ${entry.label} season`,
    sport: "soccer",
    league: entry.slug,
    eventId: idEvent,
    leagueLabel: entry.label,
    title,
    competition: {
      id: idEvent,
      name: text(event.strEvent),
      round: text(event.strRound),
      type: null,
      season: text(season),
      seasonYear: integer(String(season ?? "").slice(0, 4)),
      week: null,
    },
    participants,
    teams: participants,
    players: [],
    status: statusDetail.label,
    statusDetail,
    eventTime,
    eventTimeStatus: eventTime ? "provider-reported" : "unavailable",
    scoreStatus: scored ? "provider-reported" : "unavailable",
    scoreCount: participants.filter((participant) => participant.scoreStatus === "provider-reported").length,
    venue,
    leaders: [],
    // No safe per-event URL on TheSportsDB; the season endpoint is recorded
    // on the envelope source instead.
    sourceUrl: null,
    sourceObservedAt: retrievedAt,
    retrievedAt,
    // Provider-local calendar date for client-side day filtering.
    dayParam: dateEvent ? dateEvent.replaceAll("-", "") : null,
    dataCompletenessGrade,
    dataCompletenessScore: Number(dataCompletenessScore.toFixed(2)),
    dataCompletenessPercent: Math.round(dataCompletenessScore * 100),
    gradeKind: "data-completeness",
    completenessChecks: checks,
    sourceAttribution: THESPORTSDB_ATTRIBUTION,
    providerAvailable: true,
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
  };
}

/** Normalize a whole eventsseason payload; provider rows only, no placeholders. */
export function normalizeTsdbSeasonEvents(payload, { entry, season, retrievedAt } = {}) {
  if (!isRecord(payload) || !isRecord(entry)) return [];
  const events = Array.isArray(payload.events) ? payload.events : [];
  return events
    .map((event, index) => normalizeTsdbSeasonEvent(event, { entry, season, retrievedAt, index }))
    .filter(Boolean);
}

function tsdbSourceLike(entry, season, requestUrl) {
  return Object.freeze({
    id: `thesportsdb:${entry.slug}`,
    provider: `${THESPORTSDB_ATTRIBUTION} · ${entry.label} season ${season ?? "unknown"}`,
    sport: "soccer",
    league: entry.slug,
    leagueLabel: entry.label,
    endpoint: requestUrl ?? `${THESPORTSDB_BASE}/eventsseason.php`,
  });
}

/** Day envelope derived from a cached (or fresh) whole-season record list. */
export function tsdbDayEnvelope({ entry, dateParam, season, seasonRecords, retrievedAt, requestUrl = null, reasons = [] }) {
  const records = (Array.isArray(seasonRecords) ? seasonRecords : []).filter((record) => record?.dayParam === dateParam);
  const empty = records.length === 0;
  const available = !empty;
  return deepFreeze({
    ...leagueEnvelopeBase({ status: "ready", entry, dateParam, retrievedAt }),
    records,
    sources: [leagueSourceStatus(tsdbSourceLike(entry, season, requestUrl), retrievedAt, {
      available,
      recordCount: records.length,
      requestUrl,
      reason: empty ? (reasons[0] ?? LEAGUE_SCOREBOARD_EMPTY_REASON) : null,
    })],
    recordCount: records.length,
    availableProviderCount: available ? 1 : 0,
    providerAvailable: available,
    providerUnavailable: !available,
    empty,
    emptyReason: empty ? LEAGUE_SCOREBOARD_EMPTY_REASON : null,
    reason: empty ? LEAGUE_SCOREBOARD_EMPTY_REASON : null,
  });
}

function tsdbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason }) {
  return deepFreeze({
    ...leagueEnvelopeBase({ status: "unavailable", entry, dateParam, retrievedAt }),
    sources: [leagueSourceStatus(tsdbSourceLike(entry, tsdbSeasonString(entry, dateParam), null), retrievedAt, {
      available: false,
      recordCount: 0,
      requestUrl: null,
      reason,
    })],
    reason,
  });
}

/**
 * TheSportsDB fetch turn: fetch each league id's eventsseason payload for
 * the requested date's season (each network call keeps the shared pacing /
 * budget discipline via ctx), cache the whole season, then filter by date
 * client-side. Day navigation over a cached season costs zero network.
 */
async function thesportsdbLeagueTurn({ entry, dateParam, key, ctx }) {
  const retrievedAt = ctx.nowIso();
  const season = tsdbSeasonString(entry, dateParam);
  const ids = tsdbLeagueIds(entry);
  if (!season || !ids.length) {
    return {
      envelope: tsdbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason: "TheSportsDB league entry has no usable season or league id; no rows were fabricated." }),
      fromCache: false,
    };
  }
  const seasonRecords = [];
  const reasons = [];
  const requestUrls = [];
  let lastNet = null;
  let anyGroupSucceeded = false;
  for (let index = 0; index < ids.length; index += 1) {
    const requestUrl = publicSourceUrl(tsdbSeasonUrl(ids[index], season));
    if (!requestUrl) {
      reasons.push(`id ${ids[index]}: ineligible URL`);
      continue;
    }
    // The first network call uses the request-time budget reservation; any
    // additional league id (e.g. RFEF's two groups) reserves its own.
    if (index > 0 && !ctx.reserveNetworkCall()) break;
    if (index > 0) {
      // Every group start is paced like a turn start (global + TheSportsDB
      // 2000ms), so multi-id turns cannot burst past the rate limit.
      await ctx.paceNextCall();
      // Re-check AFTER the pacing wait, not before it: a newer turn may have
      // started during the wait, aborted this turn's registered handle, and
      // registered its own. Continuing here would install a second in-flight
      // controller, clobber the newer turn's abort handle, and run a
      // redundant fetch — violating the one-in-flight law. The superseded
      // promise resolves unavailable instead.
      const superseded = lastNet?.signal?.aborted
        || (ctx.inFlight() !== null && ctx.inFlight() !== lastNet?.controller);
      if (superseded) {
        if (lastNet) lastNet.done();
        return {
          envelope: tsdbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason: "Superseded by a newer league request before all groups loaded; no rows were fabricated." }),
          fromCache: false,
        };
      }
    }
    requestUrls.push(requestUrl);
    const net = ctx.beginNetwork();
    lastNet = net;
    try {
      const response = await ctx.fetchImpl(requestUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        ...(net.signal ? { signal: net.signal } : {}),
      });
      if (!response?.ok || typeof response.json !== "function") throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
      const payload = await response.json();
      const events = Array.isArray(payload?.events) ? payload.events : [];
      anyGroupSucceeded = true;
      if (!events.length) reasons.push(`id ${ids[index]}: season ${season} returned no events`);
      events.forEach((event) => {
        const record = normalizeTsdbSeasonEvent(event, { entry, season, retrievedAt, index: seasonRecords.length });
        if (record) seasonRecords.push(record);
      });
    } catch (error) {
      const reason = safeError(error);
      reasons.push(`id ${ids[index]}: ${reason}`);
      // A supersede abort ends the turn like the ESPN path: the promise
      // resolves unavailable and nothing is cached.
      if (error?.name === "AbortError" || /\babort(?:ed|ing)?\b/i.test(String(error?.message ?? ""))) {
        net.done();
        return { envelope: tsdbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason }), fromCache: false };
      }
    }
    // Note: net.done() is intentionally deferred until the turn's network
    // is fully finished (after the loop) so the abort handle stays
    // registered — and supersede stays observable — between groups.
  }
  if (lastNet) lastNet.done();
  if (!anyGroupSucceeded) {
    // Every group failed (HTTP/parse/abort): this is an outage, not an
    // empty season — resolve unavailable and never cache the failure.
    const detail = reasons[0] ?? "request failed for every group id";
    return {
      envelope: tsdbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason: `TheSportsDB request failed: ${detail}` }),
      fromCache: false,
    };
  }
  if (!requestUrls.length) {
    return {
      envelope: tsdbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason: reasons[0] ?? "TheSportsDB request could not be addressed." }),
      fromCache: false,
    };
  }
  // Cache the whole season payload (ready only); day envelopes are derived.
  const seasonEnvelope = deepFreeze({
    ...leagueEnvelopeBase({ status: "ready", entry, dateParam: null, retrievedAt }),
    season,
    tsdbIds: ids,
    records: seasonRecords,
    sources: [leagueSourceStatus(tsdbSourceLike(entry, season, requestUrls[0]), retrievedAt, {
      available: seasonRecords.length > 0,
      recordCount: seasonRecords.length,
      requestUrl: requestUrls[0],
      reason: seasonRecords.length ? null : (reasons[0] ?? LEAGUE_SCOREBOARD_EMPTY_REASON),
    })],
    recordCount: seasonRecords.length,
  });
  ctx.cachePut(key, seasonEnvelope);
  return {
    envelope: tsdbDayEnvelope({ entry, dateParam, season, seasonRecords, retrievedAt, requestUrl: requestUrls[0], reasons }),
    fromCache: false,
  };
}

/* ------------------------------ OpenLigaDB ------------------------------ */

/** Season for OpenLigaDB is the year of the requested date. */
export function openLigaDbSeasonString(entry, dateParam) {
  const year = String(dateParam ?? "").slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

/** Cache key for a whole OpenLigaDB season payload. */
export function openLigaDbSeasonCacheKey(entry, dateParam) {
  const season = openLigaDbSeasonString(entry, dateParam);
  const league = text(entry?.oldbLeague)?.toLowerCase() ?? null;
  if (!season || !league || !/^[a-z0-9]{1,24}$/.test(league)) return null;
  return `openligadb:${league}:${season}`;
}

/** getmatchdata URL; null when inputs are unsafe. */
export function openLigaDbSeasonUrl(oldbLeague, season) {
  const league = text(oldbLeague)?.toLowerCase() ?? null;
  if (!league || !/^[a-z0-9]{1,24}$/.test(league)) return null;
  if (!/^\d{4}$/.test(String(season ?? ""))) return null;
  return `${OPENLIGADB_BASE}/getmatchdata/${league}/${season}`;
}

/**
 * Normalize one OpenLigaDB match into the shared record shape.
 * matchIsFinished -> final; otherwise scheduled when the date is today or
 * later, unknown when past without a result. Scores come from the
 * "Endergebnis" result row when present.
 */
export function normalizeOpenLigaDbMatch(match, {
  entry,
  season,
  retrievedAt,
  index = 0,
  todayIso = new Date().toISOString().slice(0, 10),
} = {}) {
  if (!isRecord(match) || !isRecord(entry)) return null;
  const homeName = text(match.team1?.teamName);
  const awayName = text(match.team2?.teamName);
  if (!homeName || !awayName) return null;
  const matchId = text(match.matchID ?? match.id, `match-${index + 1}`);
  const results = Array.isArray(match.matchResults) ? match.matchResults : [];
  const finalResult = results.find((row) => /endergebnis/i.test(String(row?.resultName ?? "")))
    ?? results[results.length - 1] ?? null;
  const homeScore = integer(finalResult?.pointsTeam1, null);
  const awayScore = integer(finalResult?.pointsTeam2, null);
  const finished = match.matchIsFinished === true;
  const matchDateTime = text(match.matchDateTime);
  const datePart = /^\d{4}-\d{2}-\d{2}/.test(matchDateTime ?? "") ? matchDateTime.slice(0, 10) : null;
  const statusDetail = finished
    ? { label: "Final", state: "post", completed: true, final: true, clock: null, period: null, source: "provider-reported" }
    : datePart && datePart >= todayIso
      ? { label: "Scheduled", state: "pre", completed: false, final: false, clock: null, period: null, source: "provider-reported" }
      : { label: "status unavailable", state: null, completed: null, final: null, clock: null, period: null, source: "unavailable" };
  const participants = [
    tsdbParticipant(homeName, "home", homeScore, awayScore),
    tsdbParticipant(awayName, "away", awayScore, homeScore),
  ].filter(Boolean);
  if (participants.length !== 2) return null;
  const eventTime = timestamp(match.matchDateTimeUTC) ?? timestamp(matchDateTime);
  const location = isRecord(match.location) ? match.location : {};
  const venue = {
    id: null,
    name: text(location.locationName),
    city: text(location.locationCity),
    state: null,
    country: null,
  };
  const checks = {
    sourceUrl: false,
    competition: true,
    participants: participants.length >= 2,
    status: statusDetail.source === "provider-reported",
    eventTime: Boolean(eventTime),
    scores: participants.some((participant) => participant.scoreStatus === "provider-reported"),
    venue: Boolean(venue.name),
  };
  const dataCompletenessScore = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  const dataCompletenessGrade = dataCompletenessScore >= 0.875 ? "A"
    : dataCompletenessScore >= 0.75 ? "B"
      : dataCompletenessScore >= 0.625 ? "C" : "D";
  return {
    id: `openligadb:${entry.slug}:${matchId}`,
    providerId: `openligadb-league:${entry.slug}`,
    provider: `${OPENLIGADB_ATTRIBUTION} · ${entry.label} season`,
    sport: "soccer",
    league: entry.slug,
    eventId: matchId,
    leagueLabel: entry.label,
    title: `${homeName} vs ${awayName}`,
    competition: {
      id: matchId,
      name: text(match.group?.groupName),
      round: text(match.group?.groupName),
      type: null,
      season: text(season),
      seasonYear: integer(season),
      week: integer(match.group?.groupOrderID),
    },
    participants,
    teams: participants,
    players: [],
    status: statusDetail.label,
    statusDetail,
    eventTime,
    eventTimeStatus: eventTime ? "provider-reported" : "unavailable",
    scoreStatus: participants.some((p) => p.scoreStatus === "provider-reported") ? "provider-reported" : "unavailable",
    scoreCount: participants.filter((p) => p.scoreStatus === "provider-reported").length,
    venue,
    leaders: [],
    sourceUrl: null,
    sourceObservedAt: retrievedAt,
    retrievedAt,
    // Provider-local calendar date for client-side day filtering.
    dayParam: datePart ? datePart.replaceAll("-", "") : null,
    dataCompletenessGrade,
    dataCompletenessScore: Number(dataCompletenessScore.toFixed(2)),
    dataCompletenessPercent: Math.round(dataCompletenessScore * 100),
    gradeKind: "data-completeness",
    completenessChecks: checks,
    sourceAttribution: OPENLIGADB_ATTRIBUTION,
    providerAvailable: true,
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
  };
}

/** Normalize a whole getmatchdata payload; provider rows only, no placeholders. */
export function normalizeOpenLigaDbMatches(payload, { entry, season, retrievedAt } = {}) {
  if (!isRecord(entry)) return [];
  const matches = Array.isArray(payload) ? payload : [];
  return matches
    .map((match, index) => normalizeOpenLigaDbMatch(match, { entry, season, retrievedAt, index }))
    .filter(Boolean);
}

function openLigaDbSourceLike(entry, season, requestUrl) {
  return Object.freeze({
    id: `openligadb:${entry.slug}`,
    provider: `${OPENLIGADB_ATTRIBUTION} · ${entry.label} season ${season ?? "unknown"}`,
    sport: "soccer",
    league: entry.slug,
    leagueLabel: entry.label,
    endpoint: requestUrl ?? `${OPENLIGADB_BASE}/getmatchdata`,
  });
}

/** Day envelope derived from a cached (or fresh) whole-season match list. */
export function openLigaDbDayEnvelope({ entry, dateParam, season, seasonRecords, retrievedAt, requestUrl = null, reasons = [] }) {
  const records = (Array.isArray(seasonRecords) ? seasonRecords : []).filter((record) => record?.dayParam === dateParam);
  const empty = records.length === 0;
  const available = !empty;
  return deepFreeze({
    ...leagueEnvelopeBase({ status: "ready", entry, dateParam, retrievedAt }),
    records,
    sources: [leagueSourceStatus(openLigaDbSourceLike(entry, season, requestUrl), retrievedAt, {
      available,
      recordCount: records.length,
      requestUrl,
      reason: empty ? (reasons[0] ?? LEAGUE_SCOREBOARD_EMPTY_REASON) : null,
    })],
    recordCount: records.length,
    availableProviderCount: available ? 1 : 0,
    providerAvailable: available,
    providerUnavailable: !available,
    empty,
    emptyReason: empty ? LEAGUE_SCOREBOARD_EMPTY_REASON : null,
    reason: empty ? LEAGUE_SCOREBOARD_EMPTY_REASON : null,
  });
}

function openLigaDbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason }) {
  return deepFreeze({
    ...leagueEnvelopeBase({ status: "unavailable", entry, dateParam, retrievedAt }),
    sources: [leagueSourceStatus(openLigaDbSourceLike(entry, openLigaDbSeasonString(entry, dateParam), null), retrievedAt, {
      available: false,
      recordCount: 0,
      requestUrl: null,
      reason,
    })],
    reason,
  });
}

/** OpenLigaDB fetch turn: one getmatchdata call per season, cached whole. */
async function openLigaDbLeagueTurn({ entry, dateParam, key, ctx }) {
  const retrievedAt = ctx.nowIso();
  const season = openLigaDbSeasonString(entry, dateParam);
  const requestUrl = publicSourceUrl(openLigaDbSeasonUrl(entry?.oldbLeague, season));
  if (!requestUrl) {
    return {
      envelope: openLigaDbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason: "OpenLigaDB league entry has no usable season; no rows were fabricated." }),
      fromCache: false,
    };
  }
  const net = ctx.beginNetwork();
  try {
    const response = await ctx.fetchImpl(requestUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(net.signal ? { signal: net.signal } : {}),
    });
    if (!response?.ok || typeof response.json !== "function") throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
    const payload = await response.json();
    const seasonRecords = normalizeOpenLigaDbMatches(payload, { entry, season, retrievedAt });
    const reasons = seasonRecords.length ? [] : ["OpenLigaDB returned no usable matches for this season"];
    const seasonEnvelope = deepFreeze({
      ...leagueEnvelopeBase({ status: "ready", entry, dateParam: null, retrievedAt }),
      season,
      records: seasonRecords,
      sources: [leagueSourceStatus(openLigaDbSourceLike(entry, season, requestUrl), retrievedAt, {
        available: seasonRecords.length > 0,
        recordCount: seasonRecords.length,
        requestUrl,
        reason: seasonRecords.length ? null : reasons[0],
      })],
      recordCount: seasonRecords.length,
    });
    ctx.cachePut(key, seasonEnvelope);
    return {
      envelope: openLigaDbDayEnvelope({ entry, dateParam, season, seasonRecords, retrievedAt, requestUrl, reasons }),
      fromCache: false,
    };
  } catch (error) {
    const reason = safeError(error);
    return {
      envelope: openLigaDbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason: `OpenLigaDB request failed: ${reason}` }),
      fromCache: false,
    };
  } finally {
    net.done();
  }
}

/* ------------------------------ ESPN turn --------------------------------- */

/**
 * ESPN fetch turn: the original single-league scoreboard fetch, now behind
 * the provider registry. Uses the request-time budget reservation; the
 * shared pacing/abort/timeout discipline arrives via ctx.
 */
async function espnLeagueTurn({ entry, dateParam, key, ctx }) {
  const retrievedAt = ctx.nowIso();
  const endpointLike = leagueEndpointLike(entry, dateParam);
  const requestUrl = publicSourceUrl(endpointLike.endpoint);
  const base = () => leagueEnvelopeBase({ status: "unavailable", entry, dateParam, retrievedAt });
  if (!requestUrl) {
    return {
      envelope: deepFreeze({
        ...base(),
        sources: [leagueSourceStatus(endpointLike, retrievedAt, {
          available: false,
          recordCount: 0,
          requestUrl: null,
          reason: "Only documented HTTPS public endpoints are eligible.",
        })],
        reason: "Only documented HTTPS public endpoints are eligible.",
      }),
      fromCache: false,
    };
  }
  const net = ctx.beginNetwork();
  try {
    const response = await ctx.fetchImpl(requestUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(net.signal ? { signal: net.signal } : {}),
    });
    if (!response?.ok || typeof response.json !== "function") throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
    const payload = await response.json();
    const records = normalizeMultiSportScoreboard(payload, endpointLike, retrievedAt, MULTI_SPORT_EVENTS_LEAGUE_MAX_RECORDS);
    const empty = records.length === 0;
    const available = !empty;
    const envelope = deepFreeze({
      ...base(),
      status: "ready",
      records,
      sources: [leagueSourceStatus(endpointLike, retrievedAt, {
        available,
        recordCount: records.length,
        requestUrl,
        reason: empty ? LEAGUE_SCOREBOARD_EMPTY_REASON : null,
      })],
      recordCount: records.length,
      availableProviderCount: available ? 1 : 0,
      providerAvailable: available,
      providerUnavailable: !available,
      empty,
      emptyReason: empty ? LEAGUE_SCOREBOARD_EMPTY_REASON : null,
      reason: empty ? LEAGUE_SCOREBOARD_EMPTY_REASON : null,
    });
    // Only cache ready envelopes: a superseded (aborted) or failed
    // request must never poison the cache with an "unavailable" snapshot.
    if (envelope.status === "ready") ctx.cachePut(key, envelope);
    return { envelope, fromCache: false };
  } catch (error) {
    const reason = safeError(error);
    return {
      envelope: deepFreeze({
        ...base(),
        sources: [leagueSourceStatus(endpointLike, retrievedAt, {
          available: false,
          recordCount: 0,
          requestUrl,
          reason,
        })],
        reason,
      }),
      fromCache: false,
    };
  } finally {
    net.done();
  }
}

/* --------------------------- provider registry ---------------------------- */

const LEAGUE_PROVIDERS = Object.freeze({
  espn: Object.freeze({
    id: "espn",
    // Extra minimum gap between this provider's own network-call starts,
    // on top of the queue-global minIntervalMs. TheSportsDB's free tier
    // allows ~30 requests/minute, hence 2000ms.
    minIntervalMs: 0,
    cacheKey: (entry, dateParam) => `${entry.slug}:${dateParam}`,
    cachedEnvelope: (entry, dateParam, cached) => cached.envelope,
    fetchTurn: espnLeagueTurn,
  }),
  thesportsdb: Object.freeze({
    id: "thesportsdb",
    minIntervalMs: 2000,
    cacheKey: (entry, dateParam) => tsdbSeasonCacheKey(entry, dateParam),
    cachedEnvelope: (entry, dateParam, cached) => tsdbDayEnvelope({
      entry,
      dateParam,
      season: cached.envelope.season,
      seasonRecords: cached.envelope.records,
      retrievedAt: cached.envelope.retrievedAt,
      requestUrl: cached.envelope.sources?.[0]?.requestUrl ?? null,
    }),
    fetchTurn: thesportsdbLeagueTurn,
  }),
  openligadb: Object.freeze({
    id: "openligadb",
    minIntervalMs: 0,
    cacheKey: (entry, dateParam) => openLigaDbSeasonCacheKey(entry, dateParam),
    cachedEnvelope: (entry, dateParam, cached) => openLigaDbDayEnvelope({
      entry,
      dateParam,
      season: cached.envelope.season,
      seasonRecords: cached.envelope.records,
      retrievedAt: cached.envelope.retrievedAt,
      requestUrl: cached.envelope.sources?.[0]?.requestUrl ?? null,
    }),
    fetchTurn: openLigaDbLeagueTurn,
  }),
});

/**
 * Resolve the provider fetcher for a catalog entry. Catalog entries
 * without a provider tag default to ESPN (the original single-provider
 * behavior). Throws for unknown provider ids — request() turns that
 * into a rejected promise with zero network calls.
 */
export function leagueProviderFor(entry) {
  const providerId = typeof entry?.provider === "string" && entry.provider ? entry.provider : "espn";
  const provider = LEAGUE_PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown league provider: ${String(providerId).slice(0, 40)}`);
  return provider;
}
