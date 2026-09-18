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
  fetchImpl = globalThis.fetch,
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
  fetchImpl = globalThis.fetch,
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
