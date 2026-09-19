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
export const LEAGUE_SCOREBOARD_SESSION_BUDGET = 90;
/** Maximum pacing-loop iterations before a broken clock forces an exit. */
export const LEAGUE_SCOREBOARD_PACE_GUARD_MAX = 40;
/** Pacing sleeps are chunked so a superseded turn bails out promptly. */
export const LEAGUE_SCOREBOARD_PACE_CHUNK_MS = 250;
export const LEAGUE_SCOREBOARD_CACHE_TTLS = Object.freeze({
  live: 45_000,
  settled: 600_000,
  empty: 180_000,
});

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

/* ------------------------------------------------------------------ */
/* Request-generation model.                                          */
/*                                                                    */
/* Every request() call opens a new network generation (networkEpoch  */
/* += 1) and synchronously aborts the previous generation's in-flight */
/* handle. A turn belongs to exactly one generation; it re-validates  */
/* its generation                                                     */
/*   - before starting network work (after waiting for its queue      */
/*     slot),                                                         */
/*   - after every pacing wait and every fetch/json await,             */
/*   - atomically with installing its AbortController, and            */
/*   - before promoting its envelope or writing to the cache.         */
/* A stale turn resolves a "superseded" envelope and never touches    */
/* the network again, never writes the cache, and never overwrites a  */
/* newer result. The render layer's independent requestSeq guard stays */
/* as the second line of defense.                                     */
/*                                                                    */
/* The queue slot is held until a turn fully settles — pacing,        */
/* budget, fetch, and envelope promotion all happen inside the turn.   */
/* There is no controller-free hole between "release the next turn"    */
/* and "start the fetch": the next turn cannot begin until this one   */
/* settles, and the previous turn's controller is aborted             */
/* synchronously inside request(), before the new turn is enqueued.   */
/*                                                                    */
/* Budget is charged at real network start (controller acquisition),  */
/* not at queue time, so rapid selection changes cannot burn the      */
/* session budget without ever touching the network.                  */
/* ------------------------------------------------------------------ */

/** True for abort/timeout/supersede failures, whatever shape they take. */
function isAbortLike(error) {
  if (!error) return false;
  const name = String(error?.name ?? "");
  if (name === "AbortError" || name === "TimeoutError" || name === "SupersededError") return true;
  return /\babort(?:ed|ing)?\b/i.test(String(error?.message ?? ""));
}

/** Honest envelope for a turn that lost its generation: never an error, never fabricated rows. */
function leagueSupersededEnvelope({ entry, dateParam, retrievedAt }) {
  return deepFreeze({
    ...leagueEnvelopeBase({ status: "superseded", entry, dateParam, retrievedAt }),
    superseded: true,
    liveFetch: false,
    empty: false,
    emptyReason: null,
    recordCount: 0,
    records: [],
    record: null,
    reason: "Superseded by a newer league request; no rows were fabricated.",
  });
}

/**
 * Bounded multi-provider league scoreboard fetcher (ESPN, TheSportsDB,
 * OpenLigaDB — fixtures/scores only; no odds, wagering, markets, or
 * predictions anywhere in this module).
 *
 * Request discipline (queue-global):
 *  - one in-flight network call at a time (FIFO slot),
 *  - >= minIntervalMs between network-call starts (default 1000ms),
 *  - provider-specific extra gap (TheSportsDB: 2000ms),
 *  - a newer request aborts the previous in-flight call; the superseded
 *    promise still resolves (status "superseded"), never drops,
 *  - 90-call session budget charged at real network start; past the
 *    budget the queue resolves a "throttled" envelope,
 *  - provider/league/season payloads cached with TTLs (live 45s, settled
 *    10min, empty 3min); day navigation over a cached season costs zero
 *    network calls.
 */
export function createLeagueScoreboardQueue({
  fetchImpl = (...args) => globalThis.fetch(...args),
  minIntervalMs = LEAGUE_SCOREBOARD_MIN_INTERVAL_MS,
  sessionBudget = LEAGUE_SCOREBOARD_SESSION_BUDGET,
  fetchTimeoutMs = MULTI_SPORT_EVENTS_FETCH_TIMEOUT_MS,
  cacheTtls = LEAGUE_SCOREBOARD_CACHE_TTLS,
  now = () => new Date().toISOString(),
} = {}) {
  const boundedInterval = Number.isFinite(Number(minIntervalMs)) && Number(minIntervalMs) >= 0
    ? Number(minIntervalMs)
    : LEAGUE_SCOREBOARD_MIN_INTERVAL_MS;
  const boundedBudget = Number.isSafeInteger(sessionBudget) && sessionBudget > 0 ? sessionBudget : LEAGUE_SCOREBOARD_SESSION_BUDGET;
  const boundedTimeout = Number.isFinite(Number(fetchTimeoutMs)) && Number(fetchTimeoutMs) > 0
    ? Number(fetchTimeoutMs)
    : MULTI_SPORT_EVENTS_FETCH_TIMEOUT_MS;
  const ttls = {
    live: Number.isFinite(Number(cacheTtls?.live)) ? Number(cacheTtls.live) : 45_000,
    settled: Number.isFinite(Number(cacheTtls?.settled)) ? Number(cacheTtls.settled) : 600_000,
    empty: Number.isFinite(Number(cacheTtls?.empty)) ? Number(cacheTtls.empty) : 180_000,
  };

  // Monotonic request generation. Bumped synchronously in request(); a
  // turn whose generation no longer matches is stale and must stop.
  let networkEpoch = 0;
  // The single registered network handle: { controller, epoch }. Null
  // when nothing is in flight. Abort ownership follows the generation,
  // not a mutable "current controller" variable.
  let inFlight = null;
  // FIFO slot chain. Each turn runs after the previous turn's promise
  // fully settles; the slot is held across pacing, budget, fetch, and
  // envelope promotion — never released before the fetch starts.
  let slotTail = Promise.resolve();

  let networkCalls = 0;
  let throttledCount = 0;
  let cacheHits = 0;
  let pendingCount = 0;
  let lastNetworkStartMs = Number.NEGATIVE_INFINITY;
  const lastProviderStartMs = new Map();
  const cache = new Map();

  // TTL selection from the envelope's own records: 45s when any record
  // is live, 10min when all records are final/scheduled, 3min when the
  // envelope carries zero records.
  function ttlForEnvelope(envelope) {
    const records = Array.isArray(envelope?.records) ? envelope.records : [];
    if (!records.length) return ttls.empty;
    return records.some((record) => classifyScoreboardStatus(record) === "live") ? ttls.live : ttls.settled;
  }

  function cacheGet(cacheKey) {
    if (cacheKey === null || cacheKey === undefined) return null;
    const hit = cache.get(cacheKey);
    if (!hit) return null;
    if (leagueNowMs(now) - leagueNowMs(hit.storedAt) > hit.ttlMs) {
      cache.delete(cacheKey);
      return null;
    }
    return hit;
  }

  function cacheSet(cacheKey, envelope) {
    cache.set(cacheKey, { envelope, storedAt: now(), ttlMs: ttlForEnvelope(envelope) });
  }

  // Generation-guarded cache write: a stale turn's envelope is dropped
  // even when well-formed. Only the newest generation commits.
  function cachePut(cacheKey, envelope, myEpoch) {
    if (myEpoch !== networkEpoch) return false;
    if (!envelope || envelope.status !== "ready") return false;
    cacheSet(cacheKey, envelope);
    return true;
  }

  // Budget is charged here — at real network start — and nowhere else.
  function reserveNetworkCall() {
    if (networkCalls >= boundedBudget) {
      throttledCount += 1;
      return false;
    }
    networkCalls += 1;
    return true;
  }

  /**
   * Deadline-loop pacing. Loops until the queue's own clock reads past
   * the global and provider deadlines plus a 1ms guard, so a ~999ms gap
   * can never ship (ms-resolution clocks truncate; setTimeout may fire
   * ~1ms early). Bounded: chunked sleeps re-check the generation every
   * iteration (a stale turn bails instead of resurrecting), an iteration
   * cap exits on a frozen clock, and a backwards clock exits immediately
   * — pacing can never livelock. Returns false when the turn lost its
   * generation mid-wait.
   */
  async function paceNextCall(providerId, providerGapMs, myEpoch) {
    const providerGap = Number(providerGapMs) > 0 ? Number(providerGapMs) : 0;
    let guard = 0;
    let lastSeenMs = Number.NEGATIVE_INFINITY;
    for (;;) {
      if (myEpoch !== networkEpoch) return false;
      const nowMs = leagueNowMs(now);
      if (!Number.isFinite(nowMs)) return true; // unreadable clock: never hang the queue
      if (nowMs < lastSeenMs) return true; // clock ran backwards: exit safely, keep availability
      lastSeenMs = nowMs;
      const lastProviderStart = lastProviderStartMs.has(providerId)
        ? lastProviderStartMs.get(providerId)
        : Number.NEGATIVE_INFINITY;
      const globalDeadline = boundedInterval > 0
        ? lastNetworkStartMs + boundedInterval + 1
        : Number.NEGATIVE_INFINITY;
      const providerDeadline = providerGap > 0
        ? lastProviderStart + providerGap + 1
        : Number.NEGATIVE_INFINITY;
      const deadline = Math.max(globalDeadline, providerDeadline);
      if (nowMs >= deadline) break;
      guard += 1;
      if (guard > LEAGUE_SCOREBOARD_PACE_GUARD_MAX) return true; // frozen clock: exit, never spin
      await leagueSleep(Math.min(Math.max(deadline - nowMs, 0), LEAGUE_SCOREBOARD_PACE_CHUNK_MS));
    }
    const startMs = leagueNowMs(now);
    lastNetworkStartMs = startMs;
    lastProviderStartMs.set(providerId, startMs);
    return true;
  }

  /**
   * Install this turn's AbortController and watchdog, atomically with the
   * generation check: a stale turn gets null instead of a controller, so
   * it can never clobber the newer generation's abort handle. Returns
   * null for a stale turn (the turn must bail, not fetch).
   */
  function acquireNetwork(myEpoch) {
    if (myEpoch !== networkEpoch) return null;
    const controller = typeof globalThis.AbortController === "function" ? new globalThis.AbortController() : null;
    let timeoutId = null;
    if (controller && typeof globalThis.setTimeout === "function") {
      timeoutId = globalThis.setTimeout(() => {
        // Timeout aborts carry a TimeoutError reason so they stay
        // distinguishable from supersede aborts downstream.
        try {
          controller.abort(typeof DOMException === "function"
            ? new DOMException("League request timed out", "TimeoutError")
            : new Error("League request timed out"));
        } catch { /* defensive: abort must never throw */ }
      }, boundedTimeout);
      if (timeoutId !== null && timeoutId !== undefined && typeof timeoutId.unref === "function") timeoutId.unref();
    }
    const handle = { controller, epoch: myEpoch };
    inFlight = handle;
    return {
      controller,
      signal: controller ? controller.signal : undefined,
      done() {
        if (timeoutId !== null && timeoutId !== undefined) globalThis.clearTimeout?.(timeoutId);
        if (inFlight === handle) inFlight = null;
      },
    };
  }

  /**
   * The single atomic network-start path used by EVERY actual HTTP request
   * in every provider turn: generation gate -> pacing (re-checks the
   * generation every chunk; false means superseded mid-wait) -> budget
   * charge at real network start -> controller acquisition. There is no
   * await between the budget charge and the controller install, so a stale
   * turn can never burn budget for a fetch it will not make.
   *
   * Returns the network handle, the string "throttled" when the session
   * budget is exhausted (the provider must not fetch), or null when the
   * turn lost its generation (the turn must bail, not fetch).
   */
  async function beginNetworkCall(providerId, providerGapMs, myEpoch) {
    if (myEpoch !== networkEpoch) return null;
    if (!await paceNextCall(providerId, providerGapMs, myEpoch)) return null;
    if (!reserveNetworkCall()) return "throttled";
    return acquireNetwork(myEpoch);
  }

  function throttledEnvelope({ entry, dateParam, retrievedAt }) {
    return deepFreeze({
      ...leagueEnvelopeBase({ status: "throttled", entry, dateParam, retrievedAt }),
      providerCount: 0,
      throttled: true,
      reason: "Slow down — session request budget reached",
      liveFetch: false,
      externalNetwork: false,
      empty: false,
      recordCount: 0,
      records: [],
      record: null,
    });
  }

  async function runRequestTurn({ entry, dateParam, provider, myEpoch }) {
    pendingCount += 1;
    try {
      // Gate 1: a newer request() may have arrived while this turn waited
      // for its slot. A stale turn never starts network work.
      if (myEpoch !== networkEpoch) {
        return { envelope: leagueSupersededEnvelope({ entry, dateParam, retrievedAt: now() }), fromCache: false };
      }
      const ctx = {
        nowIso: () => nowIso(now),
        fetchImpl,
        turnStale: () => myEpoch !== networkEpoch,
        // The single atomic network-start path every real HTTP request
        // goes through: generation gate -> pacing -> budget charge at real
        // network start -> controller install.
        beginNetworkCall: () => beginNetworkCall(provider.id, provider.minIntervalMs, myEpoch),
        throttledEnvelope: () => throttledEnvelope({ entry, dateParam, retrievedAt: now() }),
        supersededEnvelope: () => leagueSupersededEnvelope({ entry, dateParam, retrievedAt: now() }),
        cacheGet,
        cachePut: (cacheKey, envelope) => cachePut(cacheKey, envelope, myEpoch),
      };
      const result = await provider.fetchTurn({ entry, dateParam, key: provider.cacheKey(entry, dateParam), ctx });
      // Gate 2: envelope promotion is generation-guarded. A provider turn
      // that was superseded mid-flight — or whose fetch ignored the abort
      // signal and resolved anyway — must not overwrite the newer result.
      if (myEpoch !== networkEpoch) {
        return { envelope: leagueSupersededEnvelope({ entry, dateParam, retrievedAt: now() }), fromCache: false };
      }
      return result;
    } finally {
      pendingCount = Math.max(0, pendingCount - 1);
    }
  }

  function request({ slug, date } = {}) {
    const entry = findLeagueCatalogEntry(slug);
    if (!entry) return Promise.reject(new Error(`Unknown or invalid league slug: ${String(slug).slice(0, 80)}`));
    const dateParam = formatScoreboardDate(date);
    if (!dateParam) return Promise.reject(new Error(`Invalid scoreboard date: ${String(date).slice(0, 40)}`));
    let provider;
    try {
      provider = leagueProviderFor(entry);
    } catch (error) {
      return Promise.reject(error);
    }
    if (typeof fetchImpl !== "function") {
      const envelope = deepFreeze({
        ...leagueEnvelopeBase({ status: "unavailable", entry, dateParam, retrievedAt: now() }),
        reason: "Browser fetch is unavailable; no league scoreboard rows were fabricated.",
      });
      return Promise.resolve({ envelope, fromCache: false });
    }

    // Open a new network generation synchronously: every older uncached
    // turn is superseded as of this line, and a genuinely in-flight fetch
    // is aborted right here — before the new turn is even enqueued — so a
    // stale turn can never resurrect between "slot released" and "fetch
    // started". There is no controller-free hole.
    networkEpoch += 1;
    const myEpoch = networkEpoch;
    const previousFlight = inFlight;
    if (previousFlight?.controller && typeof previousFlight.controller.abort === "function") {
      try {
        previousFlight.controller.abort(typeof DOMException === "function"
          ? new DOMException("Superseded by a newer league request", "SupersededError")
          : new Error("Superseded by a newer league request"));
      } catch { /* abort must never throw out of request() */ }
    }

    const key = provider.cacheKey(entry, dateParam);
    const cached = cacheGet(key);
    if (cached) {
      cacheHits += 1;
      return Promise.resolve({ envelope: provider.cachedEnvelope(entry, dateParam, cached), fromCache: true });
    }

    // FIFO: the turn runs after the previous turn's promise fully
    // settles. The slot is held across pacing, budget, fetch, and
    // envelope promotion — it is released only when the turn settles, so
    // the next turn cannot install a controller "too early".
    const runTurn = () => runRequestTurn({ entry, dateParam, provider, myEpoch });
    const previous = slotTail;
    let release = null;
    slotTail = new Promise((resolve) => { release = resolve; });
    return previous.then(runTurn, runTurn).finally(() => { release(); });
  }

  function stats() {
    return deepFreeze({
      networkCalls,
      budget: boundedBudget,
      budgetRemaining: Math.max(0, boundedBudget - networkCalls),
      cacheSize: cache.size,
      cacheHits,
      throttledCount,
      inFlight: inFlight !== null,
      pending: pendingCount,
    });
  }

  function clear() {
    cache.clear();
    networkCalls = 0;
    cacheHits = 0;
    throttledCount = 0;
    pendingCount = 0;
    lastNetworkStartMs = Number.NEGATIVE_INFINITY;
    lastProviderStartMs.clear();
    slotTail = Promise.resolve();
    // A cleared queue starts a fresh generation: late turns from before
    // the clear resolve superseded instead of promoting stale envelopes.
    networkEpoch += 1;
    const previousFlight = inFlight;
    if (previousFlight?.controller && typeof previousFlight.controller.abort === "function") {
      try { previousFlight.controller.abort(); } catch { /* defensive */ }
    }
    inFlight = null;
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
  // Per-league season start month (1-12), measured from TheSportsDB's own
  // season payloads — the old hard-coded July flip was wrong for
  // calendar leagues, southern-hemisphere schedules, and split seasons.
  // Defaults to 7 for european-style leagues without measured metadata.
  const startMonth = Number.isSafeInteger(entry?.seasonStartMonth) && entry.seasonStartMonth >= 1 && entry.seasonStartMonth <= 12
    ? entry.seasonStartMonth
    : 7;
  if (entry?.seasonType === "european") {
    return month >= startMonth ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  }
  if (entry?.seasonType === "calendar") return `${year}`;
  return null;
}

/**
 * The season key immediately before the given key, in the catalog's own
 * label style ("2026-2027" -> "2025-2026", "2026" -> "2025"). Used for the
 * one-step adjacent-season retry when a primary season key returns no
 * events; null when the key shape is unrecognized so nothing is guessed.
 */
export function tsdbAdjacentSeason(season) {
  const key = String(season ?? "");
  let match = key.match(/^(\d{4})-(\d{4})$/);
  if (match) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (end === start + 1) return `${start - 1}-${end - 1}`;
    return null;
  }
  match = key.match(/^(\d{4})$/);
  if (match) return `${Number(match[1]) - 1}`;
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
    // The season key that actually served the payload (may be the
    // adjacent key when the primary came back empty).
    season: season ?? null,
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
/**
 * Fetch every group id for one TheSportsDB season key. Each group start is
 * paced and budget-reserved like a turn start. Returns { stale: true }
 * when the turn lost its generation (a newer request arrived) — the
 * caller must bail without touching the network or the cache again.
 * Abort-shaped failures resolve here as { aborted: true } with the
 * reason preserved: timeout aborts (fetch watchdog) and supersede aborts
 * (newer request) both end the turn cleanly, never as a rejection.
 */
async function fetchTsdbSeasonGroups({ entry, season, ids, retrievedAt, ctx }) {
  const seasonRecords = [];
  const reasons = [];
  const requestUrls = [];
  let anyGroupOk = false;
  let throttled = false;
  for (let index = 0; index < ids.length; index += 1) {
    // Stale turns never resurrect: check before every group, not just at
    // turn start. request() bumps the generation and aborts the in-flight
    // handle synchronously, so this observes it promptly.
    if (ctx.turnStale()) return { stale: true };
    const requestUrl = publicSourceUrl(tsdbSeasonUrl(ids[index], season));
    if (!requestUrl) {
      reasons.push(`id ${ids[index]}: ineligible URL`);
      continue;
    }
    // Every group — first or extra — starts through the single atomic
    // path: pacing, budget charge at real network start, controller.
    // "throttled" stops the group loop and serves the groups honestly
    // fetched so far; null means this turn lost its generation mid-wait.
    const net = await ctx.beginNetworkCall();
    if (net === "throttled") {
      throttled = true;
      break;
    }
    if (!net) return { stale: true };
    requestUrls.push(requestUrl);
    try {
      const response = await ctx.fetchImpl(requestUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        ...(net.signal ? { signal: net.signal } : {}),
      });
      if (ctx.turnStale()) return { stale: true };
      if (!response?.ok || typeof response.json !== "function") throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
      const payload = await response.json();
      if (ctx.turnStale()) return { stale: true };
      const events = Array.isArray(payload?.events) ? payload.events : [];
      anyGroupOk = true;
      if (!events.length) reasons.push(`id ${ids[index]}: season ${season} returned no events`);
      for (const event of events) {
        if (ctx.turnStale()) return { stale: true };
        const record = normalizeTsdbSeasonEvent(event, { entry, season, retrievedAt, index: seasonRecords.length });
        if (record) seasonRecords.push(record);
      }
    } catch (error) {
      const reason = isAbortLike(error)
        ? (ctx.turnStale()
          ? "Superseded by a newer league request; no rows were fabricated."
          : "TheSportsDB request timed out before a usable response arrived.")
        : safeError(error);
      reasons.push(`id ${ids[index]}: ${reason}`);
      if (isAbortLike(error)) {
        return { stale: ctx.turnStale(), aborted: true, reason, reasons, requestUrls, seasonRecords, anyGroupOk };
      }
    } finally {
      net.done();
    }
  }
  return { stale: ctx.turnStale(), aborted: false, reason: null, reasons, requestUrls, seasonRecords, anyGroupOk, throttled };
}

/**
 * TheSportsDB fetch turn: fetch each league id's eventsseason payload for
 * the requested date's season (each network call keeps the shared pacing /
 * budget discipline via ctx), cache the whole season, then filter by date
 * client-side. Day navigation over a cached season costs zero network.
 *
 * Season resolution: the primary key comes from the catalog's measured
 * seasonStartMonth/seasonType metadata. When the primary key returns no
 * events, the turn retries once against the adjacent season key (previous
 * year / previous year-pair, in the catalog's own label style) before
 * reporting an honest empty — TheSportsDB's key naming is not uniform
 * across calendar leagues, southern-hemisphere schedules, and cups. The
 * retry is paced and budget-reserved like any other network call; an
 * empty result for a mismatched key is never cached as valid.
 */
async function thesportsdbLeagueTurn({ entry, dateParam, key, ctx }) {
  const retrievedAt = ctx.nowIso();
  const primarySeason = tsdbSeasonString(entry, dateParam);
  const ids = tsdbLeagueIds(entry);
  if (!primarySeason || !ids.length) {
    return {
      envelope: tsdbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason: "TheSportsDB league entry has no usable season or league id; no rows were fabricated." }),
      fromCache: false,
    };
  }
  const seasonCandidates = [primarySeason];
  const adjacentSeason = tsdbAdjacentSeason(primarySeason);
  if (adjacentSeason && adjacentSeason !== primarySeason) seasonCandidates.push(adjacentSeason);

  let lastReasons = [];
  for (const season of seasonCandidates) {
    if (ctx.turnStale()) {
      return { envelope: leagueSupersededEnvelope({ entry, dateParam, retrievedAt }), fromCache: false };
    }
    const fetched = await fetchTsdbSeasonGroups({ entry, season, ids, retrievedAt, ctx });
    if (fetched.stale) {
      return { envelope: leagueSupersededEnvelope({ entry, dateParam, retrievedAt }), fromCache: false };
    }
    if (fetched.aborted) {
      // A current-generation abort (fetch watchdog timeout, or a
      // supersede that landed mid-flight): resolve cleanly, never cache,
      // never fabricate. The queue's generation guard promotes a stale
      // turn's outcome to the superseded envelope.
      return {
        envelope: tsdbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason: `TheSportsDB request ended before all groups loaded: ${fetched.reason}` }),
        fromCache: false,
      };
    }
    lastReasons = fetched.reasons;
    if (fetched.throttled && !fetched.anyGroupOk) {
      // The session budget ran out before this season's first group
      // started: throttled, not an outage — nothing was fetched, nothing
      // is fabricated, nothing is cached.
      return { envelope: ctx.throttledEnvelope(), fromCache: false };
    }
    if (!fetched.anyGroupOk) {
      // Every group failed for this season key (HTTP/parse): this is an
      // outage, not a wrong-key signal — resolve unavailable without
      // retrying the adjacent key, and never cache the failure.
      const detail = fetched.reasons[0] ?? "request failed for every group id";
      return {
        envelope: tsdbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason: `TheSportsDB request failed: ${detail}` }),
        fromCache: false,
      };
    }
    if (fetched.seasonRecords.length > 0) {
      const seasonEnvelope = deepFreeze({
        ...leagueEnvelopeBase({ status: "ready", entry, dateParam: null, retrievedAt }),
        season,
        requestedSeason: season === primarySeason ? null : primarySeason,
        tsdbIds: ids,
        records: fetched.seasonRecords,
        sources: [leagueSourceStatus(tsdbSourceLike(entry, season, fetched.requestUrls[0]), retrievedAt, {
          available: true,
          recordCount: fetched.seasonRecords.length,
          requestUrl: fetched.requestUrls[0] ?? null,
          reason: null,
        })],
        recordCount: fetched.seasonRecords.length,
      });
      // Cached under the primary key so day navigation stays cache-only
      // even when the adjacent season served the payload.
      if (key) ctx.cachePut(key, seasonEnvelope);
      return {
        envelope: tsdbDayEnvelope({ entry, dateParam, season, seasonRecords: fetched.seasonRecords, retrievedAt, requestUrl: fetched.requestUrls[0] ?? null, reasons: fetched.reasons }),
        fromCache: false,
      };
    }
    // Groups succeeded but the season key returned zero events — the
    // wrong-key signal. Try the adjacent key next.
  }
  // Every reachable candidate season came back with zero events: honest
  // empty day. Cached under the primary key (empty TTL) so day navigation
  // over an off-season league costs zero network — the in-turn adjacent
  // retry already ruled out the wrong-key case, so this empty is
  // trustworthy.
  const emptySeasonEnvelope = deepFreeze({
    ...leagueEnvelopeBase({ status: "ready", entry, dateParam: null, retrievedAt }),
    season: primarySeason,
    requestedSeason: null,
    tsdbIds: ids,
    records: [],
    sources: [leagueSourceStatus(tsdbSourceLike(entry, primarySeason, null), retrievedAt, {
      available: false,
      recordCount: 0,
      requestUrl: null,
      reason: lastReasons[0] ?? LEAGUE_SCOREBOARD_EMPTY_REASON,
    })],
    recordCount: 0,
    empty: true,
    emptyReason: LEAGUE_SCOREBOARD_EMPTY_REASON,
  });
  if (key) ctx.cachePut(key, emptySeasonEnvelope);
  return {
    envelope: tsdbDayEnvelope({ entry, dateParam, season: primarySeason, seasonRecords: [], retrievedAt, requestUrl: null, reasons: lastReasons }),
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
  // Single atomic network start: generation gate, pacing, budget charge
  // at real network start, controller install. "throttled" means the
  // session budget is spent — no fetch. null means this turn lost its
  // generation — bail, never fetch.
  const net = await ctx.beginNetworkCall();
  if (net === "throttled") {
    return { envelope: ctx.throttledEnvelope(), fromCache: false };
  }
  if (!net) {
    return { envelope: ctx.supersededEnvelope(), fromCache: false };
  }
  try {
    const response = await ctx.fetchImpl(requestUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(net.signal ? { signal: net.signal } : {}),
    });
    if (ctx.turnStale()) {
      return { envelope: leagueSupersededEnvelope({ entry, dateParam, retrievedAt }), fromCache: false };
    }
    if (!response?.ok || typeof response.json !== "function") throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
    const payload = await response.json();
    if (ctx.turnStale()) {
      return { envelope: leagueSupersededEnvelope({ entry, dateParam, retrievedAt }), fromCache: false };
    }
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
    // Abort-shaped failures (supersede or the fetch watchdog) resolve
    // cleanly as unavailable — never an unhandled rejection, never a
    // stuck loading state. The queue's generation guard promotes a stale
    // turn to the superseded envelope on the way out.
    const abortReason = isAbortLike(error)
      ? (ctx.turnStale()
        ? "Superseded by a newer league request; no rows were fabricated."
        : "OpenLigaDB request timed out before a usable response arrived.")
      : null;
    const reason = abortReason ?? safeError(error);
    const failureReason = abortReason ? reason : `OpenLigaDB request failed: ${reason}`;
    return {
      envelope: openLigaDbUnavailableEnvelope({ entry, dateParam, retrievedAt, reason: failureReason }),
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
  // Single atomic network start: generation gate, pacing, budget charge
  // at real network start, controller install. "throttled" means the
  // session budget is spent — no fetch. null means this turn lost its
  // generation — bail, never fetch.
  const net = await ctx.beginNetworkCall();
  if (net === "throttled") {
    return { envelope: ctx.throttledEnvelope(), fromCache: false };
  }
  if (!net) {
    return { envelope: ctx.supersededEnvelope(), fromCache: false };
  }
  try {
    const response = await ctx.fetchImpl(requestUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(net.signal ? { signal: net.signal } : {}),
    });
    if (ctx.turnStale()) {
      return { envelope: leagueSupersededEnvelope({ entry, dateParam, retrievedAt }), fromCache: false };
    }
    if (!response?.ok || typeof response.json !== "function") throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
    const payload = await response.json();
    if (ctx.turnStale()) {
      return { envelope: leagueSupersededEnvelope({ entry, dateParam, retrievedAt }), fromCache: false };
    }
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
    // (cachePut is also generation-guarded: a stale turn never writes.)
    if (envelope.status === "ready") ctx.cachePut(key, envelope);
    return { envelope, fromCache: false };
  } catch (error) {
    // Abort-shaped failures (supersede or the fetch watchdog) resolve
    // cleanly as unavailable — never an unhandled rejection, never a
    // stuck loading state. The queue's generation guard promotes a stale
    // turn to the superseded envelope on the way out.
    const abortReason = isAbortLike(error)
      ? (ctx.turnStale()
        ? "Superseded by a newer league request; no rows were fabricated."
        : "ESPN request timed out before a usable response arrived.")
      : null;
    // Non-abort failures keep the historical bare-reason shape.
    const failureReason = abortReason ?? safeError(error);
    return {
      envelope: deepFreeze({
        ...base(),
        sources: [leagueSourceStatus(endpointLike, retrievedAt, {
          available: false,
          recordCount: 0,
          requestUrl,
          reason: failureReason,
        })],
        reason: failureReason,
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
