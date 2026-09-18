/**
 * Public World Events evidence adapter.
 *
 * This module can read explicitly requested, public JSON endpoints without a
 * credential. It never fills gaps with fixtures: an unavailable provider,
 * missing source URL, malformed payload, or missing event time remains
 * visibly unavailable. Records are observations for research/demo use only,
 * not a complete event ledger or a determination that an event occurred.
 */

export const WORLD_EVENTS_SCHEMA_VERSION = 1;
export const WORLD_EVENTS_SOURCE = "public-world-events-evidence";
export const WORLD_EVENTS_REPLAY_SOURCE = "public-world-events-replay";
export const WORLD_EVENTS_DEFAULT_QUERY = "(violence OR conflict OR attack OR brutality OR displacement)";
export const WORLD_EVENTS_MAX_QUERY_LENGTH = 160;
export const WORLD_EVENTS_MAX_RECORDS = 12;
// A provider that stalls must not make the whole projection look frozen. The
// host still sees that source as unavailable; the other public sources can
// finish and render their own evidence.
export const WORLD_EVENTS_FETCH_TIMEOUT_MS = 9000;

export const WORLD_EVENTS_BOUNDARY =
  "Public-source world-event records are unverified research observations. Coverage, attribution, event time, and completeness are not guaranteed. The brutality field is a title-language signal only, never a verified severity, casualty, or violence determination; no provider, truth, identity, violence response, money, or executable authority is active.";

// This is deliberately a small, reviewable title-language screen. It gives the
// cube projection a visible signal for words that appear in a public headline,
// while refusing to turn a headline into a claim about what happened or how
// severe it was. The numeric level is a presentation intensity, not a score of
// real-world harm.
export const WORLD_EVENTS_BRUTALITY_SIGNAL_TERMS = Object.freeze([
  Object.freeze({ level: 3, band: "explicit-language", terms: ["brutal", "massacre", "atrocit", "torture", "execution"] }),
  Object.freeze({ level: 2, band: "violence-language", terms: ["attack", "assault", "bomb", "strike", "clash", "kill", "combat"] }),
  Object.freeze({ level: 1, band: "conflict-context", terms: ["war", "conflict", "crisis", "displace", "refugee", "humanitarian", "relief", "aid"] }),
]);

// These bands are a presentation vocabulary for the returned title-language
// signal. They deliberately avoid names such as "severity" or "brutality
// score": a headline keyword is not evidence that harm occurred or how much
// harm occurred.
export const WORLD_EVENTS_SIGNAL_FIELD_BANDS = Object.freeze([
  Object.freeze({ id: "none", label: "NO TITLE SIGNAL", level: 0, color: "#6b8791" }),
  Object.freeze({ id: "context", label: "CONFLICT CONTEXT", level: 1, color: "#ffbd68" }),
  Object.freeze({ id: "violence", label: "VIOLENCE LANGUAGE", level: 2, color: "#ff6f85" }),
  Object.freeze({ id: "explicit", label: "EXPLICIT LANGUAGE", level: 3, color: "#ffd2dc" }),
]);

// These broad buckets keep the map projection honest. They are coordinate
// cells, not countries, regions, or geocoded locations. A returned provider
// coordinate is assigned to one cell; a record without coordinates is never
// placed by inference.
export const WORLD_EVENTS_MAP_CELL_LATITUDE_BANDS = Object.freeze([
  Object.freeze({ id: "north", label: "NORTH", min: 30, max: 90, range: "30°N–90°N" }),
  Object.freeze({ id: "equatorial", label: "EQUATORIAL", min: -30, max: 30, range: "30°S–30°N" }),
  Object.freeze({ id: "south", label: "SOUTH", min: -90, max: -30, range: "90°S–30°S" }),
]);

export const WORLD_EVENTS_MAP_CELL_LONGITUDE_BANDS = Object.freeze([
  Object.freeze({ id: "west", label: "WEST", min: -180, max: -60, range: "180°W–60°W" }),
  Object.freeze({ id: "central", label: "CENTRAL", min: -60, max: 60, range: "60°W–60°E" }),
  Object.freeze({ id: "east", label: "EAST", min: 60, max: 180, range: "60°E–180°E" }),
]);

export const WORLD_EVENTS_ENDPOINTS = Object.freeze([
  Object.freeze({
    id: "gdelt-doc",
    provider: "GDELT DOC 2.0",
    endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
    documentation: "https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/",
    format: "gdelt-doc",
  }),
  Object.freeze({
    id: "nyt-world-rss",
    provider: "The New York Times · World RSS",
    endpoint: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    documentation: "https://www.nytimes.com/rss",
    format: "rss-xml",
  }),
  Object.freeze({
    id: "usgs-earthquakes",
    provider: "USGS Earthquake Hazards Program",
    endpoint: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
    documentation: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
    format: "usgs-geojson",
  }),
  Object.freeze({
    id: "nasa-eonet",
    provider: "NASA EONET",
    endpoint: "https://eonet.gsfc.nasa.gov/api/v3/events",
    documentation: "https://eonet.gsfc.nasa.gov/docs/v3",
    format: "nasa-eonet",
  }),
]);

// ReliefWeb now requires an approved appname. It remains an explicit opt-in
// endpoint only; the default refresh never invents or sends an app identity.
export const WORLD_EVENTS_OPTIONAL_ENDPOINTS = Object.freeze([
  Object.freeze({
    id: "reliefweb-reports",
    provider: "ReliefWeb API v2",
    endpoint: "https://api.reliefweb.int/v2/reports",
    documentation: "https://apidoc.reliefweb.int/index.html",
    format: "reliefweb-v2-reports",
    appNameRequired: true,
  }),
]);

// A separate, structured humanitarian read keeps population observations out
// of the headline/event stream.  UNHCR documents this API as open to all with
// no special credentials.  The host asks only for the latest few annual rows;
// it never treats a population total as a conflict event, severity, or truth
// claim.  Keep this list separate from WORLD_EVENTS_ENDPOINTS so the existing
// GDELT/NYT/USGS/NASA records and provider counts remain unchanged.
export const WORLD_EVENTS_HUMANITARIAN_ENDPOINTS = Object.freeze([
  Object.freeze({
    id: "unhcr-population",
    provider: "UNHCR Refugee Data Finder",
    endpoint: "https://api.unhcr.org/population/v1/population/",
    documentation: "https://www.unhcr.org/refugee-statistics/insights/explainers/forcibly-displaced-api.html",
    format: "unhcr-population",
    category: "humanitarian",
    credentialsRequired: false,
  }),
]);

// Alias for hosts that describe this rail as a structured provider rather than
// a humanitarian provider.  Both names point to the same frozen allowlist.
export const WORLD_EVENTS_STRUCTURED_ENDPOINTS = WORLD_EVENTS_HUMANITARIAN_ENDPOINTS;

export const WORLD_EVENTS_HUMANITARIAN_BOUNDARY =
  "UNHCR annual population observations are structured humanitarian data, not conflict-event records. Provider-reported metrics, year, and named dimensions remain visible; severity, intensity, casualties, truth, geocoding, and completeness are unknown or unavailable unless the provider explicitly supplies them.";

export const WORLD_EVENTS_HUMANITARIAN_METRIC_FIELDS = Object.freeze([
  "refugees",
  "asylum_seekers",
  "returned_refugees",
  "idps",
  "returned_idps",
  "stateless",
  "ooc",
  "oip",
  "hst",
]);

export const WORLD_EVENTS_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "world-events.public-read",
    label: "Read explicitly requested public evidence",
    mode: "public-read-only",
    enabled: true,
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "world-events.inspect-local",
    label: "Inspect source URL, observed time, uncertainty, and event-time status",
    mode: "local-projection",
    enabled: true,
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "world-events.provider-refresh",
    label: "Refresh public providers on explicit request",
    mode: "explicit-refresh",
    enabled: true,
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "world-events.no-provider-credentials",
    label: "Provider credentials or private-source access",
    mode: "denied",
    enabled: false,
    denied: true,
    authority: "none",
    simulationOnly: true,
    executable: false,
    reason: "Only documented public URLs are eligible; credentials and private scraping are not supported.",
  }),
  Object.freeze({
    id: "world-events.no-violence-execution",
    label: "Execute violence response or identity action",
    mode: "denied",
    enabled: false,
    denied: true,
    authority: "none",
    simulationOnly: true,
    executable: false,
    reason: "This is an evidence readout, not an emergency, identity, or response system.",
  }),
  Object.freeze({
    id: "world-events.no-persistence",
    label: "Persist or publish fetched records",
    mode: "denied",
    enabled: false,
    denied: true,
    authority: "none",
    simulationOnly: true,
    executable: false,
    reason: "Fetched data remains in the current page session only.",
  }),
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  if (!isRecord(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

function text(value, fallback = null) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** Keep user-steerable public queries short, visible, and URL-safe. */
export function normalizeWorldEventsQuery(value) {
  const candidate = text(value, WORLD_EVENTS_DEFAULT_QUERY)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WORLD_EVENTS_MAX_QUERY_LENGTH)
    .trim();
  return candidate || WORLD_EVENTS_DEFAULT_QUERY;
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

function timestamp(value) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function epochTimestamp(value) {
  if (!Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? timestamp(date.toISOString()) : null;
}

function coordinatePair(value) {
  if (isRecord(value)) {
    return coordinatePair([value.longitude, value.latitude]);
  }
  if (Array.isArray(value)) {
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)
      && longitude >= -180 && longitude <= 180
      && latitude >= -90 && latitude <= 90) {
      return { longitude, latitude };
    }
    for (const child of value) {
      const nested = coordinatePair(child);
      if (nested) return nested;
    }
  }
  return null;
}

function geographicCoverage(records) {
  const returned = Array.isArray(records) ? records : [];
  const mappedCount = returned.filter((record) => Boolean(coordinatePair(record?.coordinates))).length;
  const mapUnavailableCount = Math.max(returned.length - mappedCount, 0);
  return {
    status: returned.length === 0
      ? "unavailable"
      : mapUnavailableCount === 0
        ? "mapped"
        : mappedCount === 0
          ? "map-unavailable"
          : "partial",
    returnedRecordCount: returned.length,
    mappedCount,
    mapUnavailableCount,
    basis: "Provider-returned bounded coordinates only; no geocoding or place inference is performed.",
  };
}

function signalCoverage(records) {
  const returned = Array.isArray(records) ? records : [];
  const signalCount = returned.filter((record) => Number(record?.brutalityLanguageSignal?.level) > 0).length;
  const noSignalCount = Math.max(returned.length - signalCount, 0);
  const explicitSignalCount = returned.filter((record) => Number(record?.brutalityLanguageSignal?.level) >= 3).length;
  return {
    status: returned.length === 0 ? "unavailable" : "available",
    returnedRecordCount: returned.length,
    signalCount,
    noSignalCount,
    explicitSignalCount,
    basis: "Existing title-language signal only; this is not a verified severity, casualty, or violence determination.",
  };
}

/**
 * Derive a compact global signal field from records already returned by the
 * public providers. This is intentionally a pure read-model helper: it never
 * fetches, geocodes, fills a missing band, or upgrades a headline into a
 * real-world harm claim. The renderer can use the immutable counts to build a
 * block field and an accessible summary without inventing rows.
 */
export function summarizeWorldEventSignalField(records = []) {
  const returned = Array.isArray(records) ? records : [];
  const bands = WORLD_EVENTS_SIGNAL_FIELD_BANDS.map((band) => {
    const bandRecords = returned.filter((record) => {
      const level = Number(record?.brutalityLanguageSignal?.level);
      return (Number.isFinite(level) ? Math.max(0, Math.min(3, level)) : 0) === band.level;
    });
    return {
      ...band,
      recordCount: bandRecords.length,
      recordIds: bandRecords.map((record) => record?.id).filter((id) => typeof id === "string" && id.trim()),
    };
  });
  const mappedCount = returned.filter((record) => coordinatePair(record?.coordinates)).length;
  const mapUnavailableCount = Math.max(returned.length - mappedCount, 0);
  const providerCounts = new Map();
  returned.forEach((record) => {
    const providerId = text(record?.providerId, "unknown-provider");
    providerCounts.set(providerId, (providerCounts.get(providerId) ?? 0) + 1);
  });
  return deepFreeze({
    schemaVersion: WORLD_EVENTS_SCHEMA_VERSION,
    source: `${WORLD_EVENTS_SOURCE}:signal-field`,
    recordCount: returned.length,
    bands,
    signalRecordCount: returned.filter((record) => Number(record?.brutalityLanguageSignal?.level) > 0).length,
    mappedCount,
    mapUnavailableCount,
    providerCounts: [...providerCounts.entries()].map(([providerId, recordCount]) => ({ providerId, recordCount })),
    basis: "Derived only from provider-returned records, title-language keywords, and provider coordinates; no severity, casualty, truth, geocoding, or completeness claim.",
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    providerCredentials: false,
    truthClaim: false,
    executable: false,
  });
}

function mapCellBand(value, bands) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return bands.find((band, index) => numeric >= band.min
    && (index === bands.length - 1 ? numeric <= band.max : numeric < band.max)) ?? null;
}

/**
 * Resolve a provider-returned coordinate to a coarse map cell. The returned
 * label describes only latitude/longitude buckets; it is deliberately not a
 * country, city, conflict zone, or geocoded place claim.
 */
export function worldEventMapCell(record) {
  const coordinates = coordinatePair(record?.coordinates ?? record);
  if (!coordinates) return null;
  const latitudeBand = mapCellBand(coordinates.latitude, WORLD_EVENTS_MAP_CELL_LATITUDE_BANDS);
  const longitudeBand = mapCellBand(coordinates.longitude, WORLD_EVENTS_MAP_CELL_LONGITUDE_BANDS);
  if (!latitudeBand || !longitudeBand) return null;
  return deepFreeze({
    id: `${latitudeBand.id}:${longitudeBand.id}`,
    label: `${latitudeBand.label} · ${longitudeBand.label}`,
    latitudeBand: latitudeBand.id,
    longitudeBand: longitudeBand.id,
    latitudeRange: latitudeBand.range,
    longitudeRange: longitudeBand.range,
    basis: "Provider-returned coordinates assigned to a broad latitude/longitude bucket; no geocoding or place inference is performed.",
  });
}

/**
 * Aggregate only the returned mapped records into broad coordinate cells.
 * Empty cells are omitted so the projection cannot look like it contains
 * events that no provider actually returned.
 */
export function summarizeWorldEventMapCells(records = []) {
  const returned = Array.isArray(records) ? records : [];
  const cells = new Map();
  returned.forEach((record) => {
    const cell = worldEventMapCell(record);
    if (!cell) return;
    const existing = cells.get(cell.id) ?? {
      ...cell,
      recordCount: 0,
      recordIds: [],
      providerCounts: new Map(),
      signalCounts: [0, 0, 0, 0],
      maxSignalLevel: 0,
    };
    existing.recordCount += 1;
    if (typeof record?.id === "string" && record.id.trim()) existing.recordIds.push(record.id);
    const providerId = text(record?.providerId, "unknown-provider");
    existing.providerCounts.set(providerId, (existing.providerCounts.get(providerId) ?? 0) + 1);
    const rawLevel = Number(record?.brutalityLanguageSignal?.level);
    const level = Number.isFinite(rawLevel) ? Math.max(0, Math.min(3, rawLevel)) : 0;
    existing.signalCounts[level] += 1;
    existing.maxSignalLevel = Math.max(existing.maxSignalLevel, level);
    cells.set(cell.id, existing);
  });
  const mappedRecordCount = [...cells.values()].reduce((sum, cell) => sum + cell.recordCount, 0);
  const mapUnavailableCount = Math.max(returned.length - mappedRecordCount, 0);
  const normalizedCells = [...cells.values()].map((cell) => ({
    id: cell.id,
    label: cell.label,
    latitudeBand: cell.latitudeBand,
    longitudeBand: cell.longitudeBand,
    latitudeRange: cell.latitudeRange,
    longitudeRange: cell.longitudeRange,
    recordCount: cell.recordCount,
    recordIds: cell.recordIds,
    providerCounts: [...cell.providerCounts.entries()].map(([providerId, recordCount]) => ({ providerId, recordCount })),
    signalCounts: cell.signalCounts,
    signalRecordCount: cell.signalCounts.slice(1).reduce((sum, count) => sum + count, 0),
    explicitSignalCount: cell.signalCounts[3],
    maxSignalLevel: cell.maxSignalLevel,
    basis: cell.basis,
  }));
  const latitudeOrder = new Map(WORLD_EVENTS_MAP_CELL_LATITUDE_BANDS.map((band, index) => [band.id, index]));
  const longitudeOrder = new Map(WORLD_EVENTS_MAP_CELL_LONGITUDE_BANDS.map((band, index) => [band.id, index]));
  normalizedCells.sort((left, right) => {
    const rowDelta = (latitudeOrder.get(left.latitudeBand) ?? 99) - (latitudeOrder.get(right.latitudeBand) ?? 99);
    return rowDelta || ((longitudeOrder.get(left.longitudeBand) ?? 99) - (longitudeOrder.get(right.longitudeBand) ?? 99));
  });
  return deepFreeze({
    schemaVersion: WORLD_EVENTS_SCHEMA_VERSION,
    source: `${WORLD_EVENTS_SOURCE}:map-cells`,
    recordCount: returned.length,
    mappedRecordCount,
    mapUnavailableCount,
    activeCellCount: normalizedCells.length,
    cells: normalizedCells,
    basis: "Derived only from provider-returned bounded coordinates and title-language signal bands; cells are not geocoded places and do not claim severity, casualty, truth, or completeness.",
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    providerCredentials: false,
    truthClaim: false,
    executable: false,
  });
}

/**
 * Build a presentation-only Reality / Brutality readout from the same rows
 * and provider statuses already returned by World Pulse. This is deliberately
 * an index, not a second event stream: it exposes title-language bands,
 * provider coverage, map-cell coverage, and record ids that the renderer can
 * focus or inspect. It never scores harm, infers casualties, geocodes a row,
 * or upgrades a headline into a truth claim.
 */
export function summarizeWorldEventRealityBrutality(records = [], sources = []) {
  const returned = Array.isArray(records) ? records : [];
  const providerStatuses = Array.isArray(sources) ? sources : [];
  const signalField = summarizeWorldEventSignalField(returned);
  const mapCells = summarizeWorldEventMapCells(returned);
  const bands = signalField.bands.map((band) => ({
    id: band.id,
    label: band.label,
    level: band.level,
    color: band.color,
    recordCount: band.recordCount,
    recordIds: band.recordIds,
  }));
  const providerCoverage = providerStatuses.map((source) => ({
    id: text(source?.id, "unknown-provider"),
    provider: text(source?.provider, text(source?.id, "unknown provider")),
    available: source?.available === true,
    recordCount: Number.isSafeInteger(source?.recordCount) && source.recordCount >= 0 ? source.recordCount : 0,
    reason: text(source?.reason, null),
  }));
  const signalRecordCount = bands
    .filter((band) => band.level > 0)
    .reduce((sum, band) => sum + band.recordCount, 0);
  const violenceSignalCount = bands
    .filter((band) => band.level >= 2)
    .reduce((sum, band) => sum + band.recordCount, 0);
  const explicitSignalCount = bands.find((band) => band.level === 3)?.recordCount ?? 0;
  return deepFreeze({
    schemaVersion: WORLD_EVENTS_SCHEMA_VERSION,
    source: `${WORLD_EVENTS_SOURCE}:reality-brutality`,
    kind: "world-events-reality-brutality-readout",
    recordCount: returned.length,
    providerCount: providerCoverage.length,
    availableProviderCount: providerCoverage.filter((source) => source.available).length,
    unavailableProviderCount: providerCoverage.filter((source) => !source.available).length,
    providerCoverage,
    providerRecordCounts: signalField.providerCounts,
    bands,
    signalRecordCount,
    contextualSignalCount: bands.find((band) => band.level === 1)?.recordCount ?? 0,
    violenceSignalCount,
    explicitSignalCount,
    mappedCount: signalField.mappedCount,
    mapUnavailableCount: signalField.mapUnavailableCount,
    activeMapCellCount: mapCells.activeCellCount,
    mapCells: mapCells.cells,
    focusRecordIds: returned.map((record) => record?.id).filter((id) => typeof id === "string" && id.trim()),
    realityStatus: returned.length ? "PUBLIC OBSERVATIONS RETURNED" : "NO PUBLIC OBSERVATIONS RETURNED",
    brutalitySignalStatus: explicitSignalCount > 0
      ? "EXPLICIT TITLE-LANGUAGE SIGNAL PRESENT"
      : signalRecordCount > 0
        ? "TITLE-LANGUAGE SIGNAL PRESENT"
        : "NO TITLE-LANGUAGE SIGNAL",
    basis: "Derived only from returned provider rows, title-language bands, provider statuses, and provider coordinates. This is not a verified brutality, severity, casualty, truth, attribution, or completeness measure.",
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    providerCredentials: false,
    truthClaim: false,
    executable: false,
  });
}

function nowIso(now) {
  const candidate = typeof now === "function" ? now() : now;
  const parsed = timestamp(candidate);
  return parsed ?? new Date().toISOString();
}

function safeError(error) {
  if (error?.name === "AbortError" || /\babort(?:ed|ing)?\b/i.test(String(error?.message ?? ""))) {
    return "Provider request timed out before a usable response arrived.";
  }
  const message = text(error?.message ?? error, "provider unavailable");
  return message.slice(0, 180);
}

function parseGdeltTime(value) {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{14}$/.test(raw)) {
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}.000Z`;
    return timestamp(iso);
  }
  // GDELT currently emits the documented UTC form YYYYMMDDTHHMMSSZ.
  if (/^\d{8}T\d{6}Z$/.test(raw)) {
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}.000Z`;
    return timestamp(iso);
  }
  return null;
}

function parseReliefwebTime(value) {
  if (isRecord(value)) return timestamp(value.created ?? value.date ?? value.value);
  return timestamp(value);
}

function titleTokens(title) {
  return String(title ?? "").toLowerCase().match(/[a-z]+/g) ?? [];
}

function titleHasTerm(title, term) {
  const normalizedTerm = String(term ?? "").toLowerCase().trim();
  if (!normalizedTerm) return false;
  const tokens = titleTokens(title);
  // Short words such as "war" must be whole tokens: substring matching would
  // incorrectly classify "warning" as conflict language. Longer terms may
  // match their ordinary inflections (attack/attacks, kill/killing, etc.).
  return tokens.some((token) => normalizedTerm.length <= 3
    ? token === normalizedTerm
    : token === normalizedTerm || token.startsWith(normalizedTerm));
}

function titleHasAnyTerm(title, terms) {
  return terms.some((term) => titleHasTerm(title, term));
}

function classifyTitle(title) {
  if (titleHasAnyTerm(title, ["brutal", "massacre", "atrocit", "torture"])) return "violence / brutality mention";
  if (titleHasAnyTerm(title, ["attack", "assault", "bomb", "strike", "clash", "kill", "combat"])) return "violence / conflict mention";
  if (titleHasAnyTerm(title, ["displace", "refugee", "humanitarian", "relief", "aid"])) return "humanitarian / displacement mention";
  if (titleHasAnyTerm(title, ["war", "conflict", "crisis"])) return "conflict mention";
  return "public-source event mention";
}

function createBrutalityLanguageSignal(title) {
  const match = WORLD_EVENTS_BRUTALITY_SIGNAL_TERMS.find((entry) => entry.terms.some((term) => titleHasTerm(title, term)));
  const matchedTerms = match
    ? match.terms.filter((term) => titleHasTerm(title, term)).slice(0, 4)
    : [];
  const level = match?.level ?? 0;
  const band = match?.band ?? "none";
  return {
    level,
    band,
    label: level === 3
      ? "explicit brutality language"
      : level === 2
        ? "violence language"
        : level === 1
          ? "conflict context"
          : "no brutality language signal",
    matchedTerms,
    basis: "Non-authoritative keyword screen over the provider title only; this is not a verified severity, casualty, or violence determination.",
  };
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function xmlTagText(xml, tag) {
  const match = String(xml ?? "").match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? text(decodeXml(match[1])) : null;
}

function rssItems(payload) {
  const xml = String(payload ?? "");
  if (typeof globalThis.DOMParser === "function") {
    try {
      const documentRoot = new globalThis.DOMParser().parseFromString(xml, "application/xml");
      if (documentRoot.querySelector("parsererror")) return [];
      return [...documentRoot.querySelectorAll("item")].map((item) => ({
        title: text(item.querySelector("title")?.textContent),
        sourceUrl: text(item.querySelector("link")?.textContent),
        sourceObservedAt: text(item.querySelector("pubDate")?.textContent),
        rawId: text(item.querySelector("guid")?.textContent),
      }));
    } catch {
      return [];
    }
  }
  // Node smoke/tests do not ship a DOM implementation. This intentionally
  // narrow item parser handles the public RSS fields without evaluating any
  // markup or trusting HTML content.
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1];
    return {
      title: xmlTagText(item, "title"),
      sourceUrl: xmlTagText(item, "link"),
      sourceObservedAt: xmlTagText(item, "pubDate"),
      rawId: xmlTagText(item, "guid"),
    };
  });
}

function recordBase({
  id,
  providerId,
  provider,
  sourceUrl,
  title,
  sourceObservedAt,
  retrievedAt,
  rawId,
  eventTime = null,
  eventTimeStatus = "unavailable",
  eventTimeBasis = "The public response did not provide a verified event-occurrence timestamp.",
  coordinates = null,
}) {
  return {
    id,
    providerId,
    provider,
    sourceUrl,
    title,
    rawId: rawId ?? null,
    retrievedAt,
    sourceObservedAt,
    eventTime,
    eventTimeStatus,
    eventTimeBasis: eventTimeBasis ?? (eventTime
      ? "The public response supplied an event-occurrence timestamp without an independently verified occurrence claim."
      : "The public response did not provide a verified event-occurrence timestamp."),
    classification: classifyTitle(title),
    classificationBasis: "non-authoritative title-keyword screen",
    brutalityLanguageSignal: createBrutalityLanguageSignal(title),
    coordinates: coordinatePair(coordinates),
    geographyStatus: coordinatePair(coordinates) ? "provider-reported" : "unavailable",
    geographyBasis: coordinatePair(coordinates)
      ? "The public response supplied a coordinate pair for presentation only."
      : "The public response did not supply a usable coordinate pair.",
    confidence: 0,
    uncertainty: 1,
    confidenceBasis: "No provider confidence score was supplied; treat this observation as unverified.",
    sourceAttribution: "unverified public source metadata",
    externalSource: true,
    providerAvailable: true,
    truthClaim: false,
    complete: false,
    localOnly: true,
    simulation: true,
    executable: false,
  };
}

function normalizeGdeltPayload(payload, retrievedAt, maxRecords) {
  const articles = Array.isArray(payload?.articles) ? payload.articles : [];
  return articles.slice(0, maxRecords).map((article, index) => {
    const sourceUrl = publicSourceUrl(article?.url);
    const title = text(article?.title);
    if (!sourceUrl || !title) return null;
    const sourceObservedAt = parseGdeltTime(article?.seendate);
    return recordBase({
      id: `gdelt-doc:${sourceUrl}`,
      providerId: "gdelt-doc",
      provider: "GDELT DOC 2.0",
      sourceUrl,
      title,
      sourceObservedAt,
      retrievedAt,
      rawId: text(article?.url, `article-${index + 1}`),
    });
  }).filter(Boolean);
}

function normalizeRssPayload(payload, retrievedAt, maxRecords) {
  return rssItems(payload).slice(0, maxRecords).map((item, index) => {
    const sourceUrl = publicSourceUrl(item.sourceUrl);
    const title = text(item.title);
    if (!sourceUrl || !title) return null;
    return recordBase({
      id: `nyt-world-rss:${item.rawId ?? sourceUrl}`,
      providerId: "nyt-world-rss",
      provider: "The New York Times · World RSS",
      sourceUrl,
      title,
      sourceObservedAt: epochTimestamp(Date.parse(item.sourceObservedAt ?? "")),
      retrievedAt,
      rawId: item.rawId ?? `rss-item-${index + 1}`,
    });
  }).filter(Boolean);
}

function normalizeUsGSPayload(payload, retrievedAt, maxRecords) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  return features.slice(0, maxRecords).map((feature, index) => {
    const properties = isRecord(feature?.properties) ? feature.properties : {};
    const sourceUrl = publicSourceUrl(properties.url ?? properties.detail);
    const title = text(properties.title);
    if (!sourceUrl || !title) return null;
    const eventTime = epochTimestamp(properties.time);
    const coordinates = coordinatePair(feature?.geometry?.coordinates);
    return recordBase({
      id: `usgs-earthquakes:${text(feature?.id, `event-${index + 1}`)}`,
      providerId: "usgs-earthquakes",
      provider: "USGS Earthquake Hazards Program",
      sourceUrl,
      title,
      sourceObservedAt: eventTime,
      eventTime,
      eventTimeStatus: eventTime ? "provider-reported" : "unavailable",
      eventTimeBasis: eventTime ? "USGS feature.properties.time" : null,
      retrievedAt,
      rawId: text(feature?.id, `event-${index + 1}`),
      coordinates,
    });
  }).filter(Boolean);
}

function normalizeNasaPayload(payload, retrievedAt, maxRecords) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events.slice(0, maxRecords).map((event, index) => {
    const sources = Array.isArray(event?.sources) ? event.sources : [];
    const sourceUrl = publicSourceUrl(sources.find((source) => publicSourceUrl(source?.url))?.url);
    const title = text(event?.title);
    if (!sourceUrl || !title) return null;
    const geometry = Array.isArray(event?.geometry) ? event.geometry : [];
    const eventPoint = geometry.find((point) => timestamp(point?.date) || coordinatePair(point?.coordinates));
    const eventTime = timestamp(eventPoint?.date);
    const coordinates = coordinatePair(eventPoint?.coordinates);
    return recordBase({
      id: `nasa-eonet:${text(event?.id, `event-${index + 1}`)}`,
      providerId: "nasa-eonet",
      provider: "NASA EONET",
      sourceUrl,
      title,
      sourceObservedAt: eventTime,
      eventTime,
      eventTimeStatus: eventTime ? "provider-reported" : "unavailable",
      eventTimeBasis: eventTime ? "NASA EONET event geometry date" : null,
      retrievedAt,
      rawId: text(event?.id, `event-${index + 1}`),
      coordinates,
    });
  }).filter(Boolean);
}

function normalizeReliefWebPayload(payload, retrievedAt, maxRecords) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.slice(0, maxRecords).map((row, index) => {
    const fields = isRecord(row?.fields) ? row.fields : {};
    const sourceUrl = publicSourceUrl(fields.url ?? row?.links?.self ?? row?.href);
    const title = text(fields.title ?? row?.title);
    if (!sourceUrl || !title) return null;
    const sourceObservedAt = parseReliefwebTime(fields.date ?? fields.date_created ?? row?.date);
    return recordBase({
      id: `reliefweb-reports:${text(row?.id, `report-${index + 1}`)}`,
      providerId: "reliefweb-reports",
      provider: "ReliefWeb API v2",
      sourceUrl,
      title,
      sourceObservedAt,
      retrievedAt,
      rawId: text(row?.id, `report-${index + 1}`),
    });
  }).filter(Boolean);
}

function nonNegativeProviderNumber(value) {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function providerDimension(row, nameKey, isoKey, idKey) {
  const name = text(row?.[nameKey]);
  const iso = text(row?.[isoKey]);
  const id = text(row?.[idKey]);
  const usable = [name, iso, id].some((value) => value && value !== "-" && value.toLowerCase() !== "all");
  if (!usable) return null;
  return {
    name: name && name !== "-" ? name : null,
    code: iso && iso !== "-" ? iso : null,
    providerId: id && id !== "-" ? id : null,
  };
}

function unhcrGeography(row) {
  const origin = providerDimension(row, "coo_name", "coo_iso", "coo_id");
  const asylum = providerDimension(row, "coa_name", "coa_iso", "coa_id");
  const hasNamedDimension = Boolean(origin || asylum);
  return {
    origin,
    asylum,
    status: hasNamedDimension ? "provider-reported" : "unavailable",
    basis: hasNamedDimension
      ? "UNHCR supplied the named origin/asylum dimension; no geocoding or place inference is performed."
      : "The UNHCR aggregate row did not supply a named origin or asylum geography.",
  };
}

/**
 * Normalize UNHCR's annual population rows as a separate humanitarian rail.
 * The API reports population measures, not event severity.  Keep the annual
 * year and any named dimensions exactly as supplied, leave occurrence time
 * and intensity unknown, and never turn a count into a violence claim.
 */
function normalizeUnhcrPayload(payload, retrievedAt, maxRecords, sourceUrl) {
  const rows = Array.isArray(payload?.items) ? payload.items : [];
  return rows.slice(0, maxRecords).map((row, index) => {
    if (!isRecord(row)) return null;
    const yearNumeric = Number(row.year);
    const year = Number.isInteger(yearNumeric) && yearNumeric >= 1900 && yearNumeric <= 2200
      ? yearNumeric
      : null;
    const geography = unhcrGeography(row);
    const metrics = Object.fromEntries(WORLD_EVENTS_HUMANITARIAN_METRIC_FIELDS.map((field) => [
      field,
      nonNegativeProviderNumber(row[field]),
    ]));
    const suppliedMetricCount = Object.values(metrics).filter((value) => value !== null).length;
    if (year === null && suppliedMetricCount === 0) return null;
    const dimensionKey = [
      geography.origin?.code ?? geography.origin?.name ?? "aggregate",
      geography.asylum?.code ?? geography.asylum?.name ?? "aggregate",
    ].join(":");
    const providerRecordId = `unhcr-population:${year ?? "unknown"}:${dimensionKey}`;
    return {
      id: providerRecordId,
      providerId: "unhcr-population",
      provider: "UNHCR Refugee Data Finder",
      sourceUrl: publicSourceUrl(sourceUrl),
      title: "Annual forced-displacement population observation",
      rawId: text(row.id, `unhcr-row-${index + 1}`),
      retrievedAt,
      observedYear: year,
      sourceObservedAt: null,
      eventTime: null,
      eventTimeStatus: "unavailable",
      eventTimeBasis: "UNHCR supplied an annual reference year, not an event-occurrence timestamp.",
      geography,
      geographyStatus: geography.status,
      geographyBasis: geography.basis,
      metrics,
      metricFields: WORLD_EVENTS_HUMANITARIAN_METRIC_FIELDS,
      suppliedMetricCount,
      severity: null,
      severityStatus: "unknown",
      severityBasis: "UNHCR did not report a severity field for this population row.",
      intensity: null,
      intensityStatus: "unknown",
      intensityBasis: "UNHCR did not report an intensity field for this population row.",
      titleLanguageSignal: null,
      providerAvailable: true,
      externalSource: true,
      truthClaim: false,
      complete: false,
      confidence: 0,
      uncertainty: 1,
      localOnly: true,
      simulation: true,
      executable: false,
    };
  }).filter(Boolean);
}

function endpointUrl(endpoint, { query, maxRecords, appName, referenceYear = null }) {
  const url = new URL(endpoint.endpoint);
  if (endpoint.id === "gdelt-doc") {
    url.searchParams.set("query", query);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", String(maxRecords));
    url.searchParams.set("sort", "datedesc");
  } else if (endpoint.id === "nasa-eonet") {
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", String(maxRecords));
  } else if (endpoint.id === "unhcr-population" || endpoint.format === "unhcr-population") {
    url.searchParams.set("limit", String(maxRecords));
    url.searchParams.set("page", "1");
    // The provider's annual dataset can lag the current calendar year. A
    // bounded two-year look-back plus the current year exposes the provider's
    // own latest rows without guessing a missing year or fetching history.
    const year = Number.isInteger(referenceYear) ? referenceYear : new Date().getUTCFullYear();
    url.searchParams.set("yearFrom", String(Math.max(1900, year - 2)));
    url.searchParams.set("yearTo", String(year));
  } else if (endpoint.id === "reliefweb-reports" || endpoint.format === "reliefweb-v2-reports") {
    if (endpoint.appNameRequired && !text(appName)) throw new Error("ReliefWeb requires an explicitly configured approved appname");
    if (text(appName)) url.searchParams.set("appname", text(appName));
    url.searchParams.set("limit", String(maxRecords));
    url.searchParams.set("query[value]", query);
    url.searchParams.set("fields[include][]", "title");
    url.searchParams.set("fields[include][]", "url");
    url.searchParams.set("fields[include][]", "date");
    url.searchParams.set("fields[include][]", "source");
  }
  return url.toString();
}

function sourceStatus(endpoint, retrievedAt, values = {}) {
  return {
    id: endpoint.id,
    provider: endpoint.provider,
    endpoint: endpoint.endpoint,
    documentation: endpoint.documentation,
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

function humanitarianEnvelope({
  retrievedAt,
  records = [],
  sources = [],
  status = "unavailable",
  reason = null,
  liveFetch = false,
  externalNetwork = false,
} = {}) {
  const returned = Array.isArray(records) ? records : [];
  const providerRows = Array.isArray(sources) ? sources : [];
  const availableProviderCount = providerRows.filter((source) => source?.available === true).length;
  const namedGeographyCount = returned.filter((record) => record?.geographyStatus === "provider-reported").length;
  return deepFreeze({
    schemaVersion: WORLD_EVENTS_SCHEMA_VERSION,
    source: `${WORLD_EVENTS_SOURCE}:humanitarian`,
    providerId: "unhcr-population",
    provider: "UNHCR Refugee Data Finder",
    status,
    records: returned,
    recordCount: returned.length,
    sources: providerRows,
    providerCount: providerRows.length,
    availableProviderCount,
    providerAvailable: availableProviderCount > 0,
    providerUnavailable: availableProviderCount === 0,
    namedGeographyCount,
    geographyStatus: returned.length === 0
      ? "unavailable"
      : namedGeographyCount === returned.length
        ? "provider-reported"
        : namedGeographyCount === 0
          ? "unavailable"
          : "partial",
    observedYearStatus: returned.some((record) => Number.isInteger(record?.observedYear))
      ? "provider-reported"
      : "unavailable",
    severityStatus: "unknown",
    intensityStatus: "unknown",
    severityBasis: "UNHCR does not report an event severity field in this population endpoint.",
    intensityBasis: "UNHCR does not report an event intensity field in this population endpoint.",
    liveFetch,
    externalNetwork,
    externalSource: true,
    localOnly: true,
    simulation: true,
    truthClaim: false,
    complete: false,
    confidence: 0,
    uncertainty: 1,
    executable: false,
    boundary: WORLD_EVENTS_HUMANITARIAN_BOUNDARY,
    reason: reason ?? (returned.length ? null : "UNHCR returned no structured population rows; no data was fabricated."),
  });
}

function unavailableHumanitarianEnvelope(retrievedAt, reason = "No humanitarian provider response is available in this session.") {
  return humanitarianEnvelope({
    retrievedAt,
    records: [],
    sources: WORLD_EVENTS_HUMANITARIAN_ENDPOINTS.map((endpoint) => sourceStatus(endpoint, retrievedAt, {
      available: false,
      recordCount: 0,
      reason,
    })),
    status: "unavailable",
    reason,
  });
}

/** Return an honest empty state; no synthetic event records are inserted. */
export function createUnavailableWorldEvents({
  retrievedAt = new Date().toISOString(),
  query = WORLD_EVENTS_DEFAULT_QUERY,
  reason = "No public provider response is available in this session.",
} = {}) {
  const retrieved = nowIso(retrievedAt);
  return deepFreeze({
    schemaVersion: WORLD_EVENTS_SCHEMA_VERSION,
    source: WORLD_EVENTS_SOURCE,
    status: "unavailable",
    query: normalizeWorldEventsQuery(query),
    retrievedAt: retrieved,
    records: [],
    brutalityLanguageSignalCount: 0,
    explicitBrutalityLanguageSignalCount: 0,
    brutalitySignalBasis: "Title-language presentation signal only; not a verified brutality, severity, casualty, or violence determination.",
    geographicCoverage: geographicCoverage([]),
    signalCoverage: signalCoverage([]),
    signalField: summarizeWorldEventSignalField([]),
    mapCells: summarizeWorldEventMapCells([]),
    realityBrutality: summarizeWorldEventRealityBrutality([], WORLD_EVENTS_ENDPOINTS.map((endpoint) => ({
      id: endpoint.id,
      provider: endpoint.provider,
      available: false,
      recordCount: 0,
      reason,
    }))),
    sources: WORLD_EVENTS_ENDPOINTS.map((endpoint) => sourceStatus(endpoint, retrieved, {
      available: false,
      recordCount: 0,
      reason,
    })),
    humanitarian: unavailableHumanitarianEnvelope(retrieved, reason),
    humanitarianRecords: [],
    humanitarianSources: WORLD_EVENTS_HUMANITARIAN_ENDPOINTS.map((endpoint) => sourceStatus(endpoint, retrieved, {
      available: false,
      recordCount: 0,
      reason,
    })),
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
    boundary: WORLD_EVENTS_BOUNDARY,
    reason,
  });
}

/**
 * Fetch public event evidence only after an explicit caller request. The
 * function accepts an injected fetch implementation so tests can model both
 * online and offline providers without contacting the network.
 */
export async function fetchWorldEvents({
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  query = WORLD_EVENTS_DEFAULT_QUERY,
  maxRecords = WORLD_EVENTS_MAX_RECORDS,
  timeoutMs = WORLD_EVENTS_FETCH_TIMEOUT_MS,
  appName = null,
  endpoints = undefined,
  // The structured humanitarian rail is opt-out when the primary endpoint
  // list is the default. Tests/hosts that provide a custom primary list can
  // pass an explicit array (or []) to keep their request surface bounded.
  structuredEndpoints = undefined,
} = {}) {
  const retrievedAt = nowIso(now);
  const boundedMax = Number.isSafeInteger(maxRecords) && maxRecords > 0
    ? Math.min(maxRecords, WORLD_EVENTS_MAX_RECORDS)
    : WORLD_EVENTS_MAX_RECORDS;
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 60_000)
    : WORLD_EVENTS_FETCH_TIMEOUT_MS;
  const normalizedQuery = normalizeWorldEventsQuery(query);
  if (typeof fetchImpl !== "function") {
    return createUnavailableWorldEvents({ retrievedAt, query: normalizedQuery, reason: "Browser fetch is unavailable; no local fallback data was fabricated." });
  }

  const records = [];
  const sources = [];
  const requestedEndpoints = Array.isArray(endpoints) ? endpoints : WORLD_EVENTS_ENDPOINTS;
  const requestedHumanitarianEndpoints = structuredEndpoints === undefined
    ? (Array.isArray(endpoints) ? [] : WORLD_EVENTS_HUMANITARIAN_ENDPOINTS)
    : (Array.isArray(structuredEndpoints) ? structuredEndpoints : []);
  const usableEndpointCount = requestedEndpoints.filter((endpoint) => isRecord(endpoint)
    && text(endpoint.endpoint)
    && text(endpoint.id)
    && !(endpoint.appNameRequired && !text(appName))).length;
  const perEndpointMax = Math.max(1, Math.ceil(boundedMax / Math.max(1, usableEndpointCount)));
  // Read each public endpoint concurrently. A slow provider must not starve
  // the other feeds: every request still has its own bounded timeout and the
  // final records/statuses are flattened in allowlist order for deterministic
  // projection and tests.
  const endpointResults = await Promise.all(requestedEndpoints.map(async (endpoint) => {
    if (!isRecord(endpoint) || !text(endpoint.endpoint) || !text(endpoint.id)) return null;
    if (endpoint.appNameRequired && !text(appName)) {
      // Do not contact endpoints that require an identity the caller did not
      // explicitly supply. The unavailable row is evidence of the gate, not
      // fabricated provider data.
      return {
        records: [],
        source: sourceStatus(endpoint, retrievedAt, {
          available: false,
          skipped: true,
          recordCount: 0,
          reason: "Skipped: this provider requires an explicitly configured approved appname.",
        }),
      };
    }
    let requestUrl = null;
    try {
      requestUrl = endpointUrl(endpoint, {
        query: normalizedQuery,
        maxRecords: perEndpointMax,
        appName: text(appName),
        referenceYear: Number.parseInt(retrievedAt.slice(0, 4), 10),
      });
      if (new URL(requestUrl).protocol !== "https:") {
        throw new Error("Only documented HTTPS public endpoints are eligible");
      }
    } catch (error) {
      return {
        records: [],
        source: sourceStatus(endpoint, retrievedAt, {
          available: false,
          recordCount: 0,
          requestUrl,
          reason: safeError(error),
        }),
      };
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
        headers: {
          accept: endpoint.format === "rss-xml"
            ? "application/rss+xml, application/xml, text/xml"
            : "application/json",
        },
        ...(abortController ? { signal: abortController.signal } : {}),
      });
      const expectsText = endpoint.format === "rss-xml";
      if (!response?.ok || (expectsText
        ? typeof response.text !== "function"
        : typeof response.json !== "function")) {
        throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
      }
      const payload = expectsText ? await response.text() : await response.json();
      const next = endpoint.format === "gdelt-doc"
        ? normalizeGdeltPayload(payload, retrievedAt, perEndpointMax)
        : endpoint.format === "rss-xml"
          ? normalizeRssPayload(payload, retrievedAt, perEndpointMax)
          : endpoint.format === "usgs-geojson"
            ? normalizeUsGSPayload(payload, retrievedAt, perEndpointMax)
            : endpoint.format === "nasa-eonet"
              ? normalizeNasaPayload(payload, retrievedAt, perEndpointMax)
              : normalizeReliefWebPayload(payload, retrievedAt, perEndpointMax);
      return {
        records: next,
        source: sourceStatus(endpoint, retrievedAt, {
          available: true,
          recordCount: next.length,
          requestUrl,
          reason: next.length ? null : "Provider returned no rows with both a source URL and title.",
        }),
      };
    } catch (error) {
      return {
        records: [],
        source: sourceStatus(endpoint, retrievedAt, {
          available: false,
          recordCount: 0,
          requestUrl,
          reason: safeError(error),
        }),
      };
    } finally {
      if (timeoutHandle !== null) globalThis.clearTimeout?.(timeoutHandle);
    }
  }));
  for (const result of endpointResults) {
    if (!result) continue;
    records.push(...result.records);
    sources.push(result.source);
  }

  // Structured humanitarian data is fetched and reported on its own rail so
  // annual population observations never become headline/event records or
  // title-language brutality signals. No optional credentials are accepted.
  const humanitarianRecords = [];
  const humanitarianSources = [];
  const humanitarianResults = await Promise.all(requestedHumanitarianEndpoints.map(async (endpoint) => {
    if (!isRecord(endpoint) || !text(endpoint.endpoint) || !text(endpoint.id)) return null;
    let requestUrl = null;
    try {
      requestUrl = endpointUrl(endpoint, {
        query: normalizedQuery,
        maxRecords: boundedMax,
        appName: null,
        referenceYear: Number.parseInt(retrievedAt.slice(0, 4), 10),
      });
      if (new URL(requestUrl).protocol !== "https:") {
        throw new Error("Only documented HTTPS public endpoints are eligible");
      }
    } catch (error) {
      return {
        records: [],
        source: sourceStatus(endpoint, retrievedAt, {
          available: false,
          recordCount: 0,
          requestUrl,
          reason: safeError(error),
        }),
      };
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
      const next = endpoint.format === "unhcr-population"
        ? normalizeUnhcrPayload(payload, retrievedAt, boundedMax, requestUrl)
        : [];
      return {
        records: next,
        source: sourceStatus(endpoint, retrievedAt, {
          available: true,
          recordCount: next.length,
          requestUrl,
          reason: next.length ? null : "Provider returned no structured population rows.",
        }),
      };
    } catch (error) {
      return {
        records: [],
        source: sourceStatus(endpoint, retrievedAt, {
          available: false,
          recordCount: 0,
          requestUrl,
          reason: safeError(error),
        }),
      };
    } finally {
      if (timeoutHandle !== null) globalThis.clearTimeout?.(timeoutHandle);
    }
  }));
  for (const result of humanitarianResults) {
    if (!result) continue;
    humanitarianRecords.push(...result.records);
    humanitarianSources.push(result.source);
  }
  const limitedRecords = records.slice(0, boundedMax);
  const limitedHumanitarianRecords = humanitarianRecords.slice(0, boundedMax);
  const availableCount = sources.filter((source) => source.available).length;
  const availableHumanitarianCount = humanitarianSources.filter((source) => source.available).length;
  const geographicSummary = geographicCoverage(limitedRecords);
  const signalSummary = signalCoverage(limitedRecords);
  const status = limitedRecords.length
    ? availableCount === sources.length ? "ready" : "partial"
    : "unavailable";
  return deepFreeze({
    schemaVersion: WORLD_EVENTS_SCHEMA_VERSION,
    source: WORLD_EVENTS_SOURCE,
    status,
    query: normalizedQuery,
    retrievedAt,
    records: limitedRecords,
    brutalityLanguageSignalCount: limitedRecords.filter((record) => Number(record?.brutalityLanguageSignal?.level) > 0).length,
    explicitBrutalityLanguageSignalCount: limitedRecords.filter((record) => Number(record?.brutalityLanguageSignal?.level) >= 3).length,
    brutalitySignalBasis: "Title-language presentation signal only; not a verified brutality, severity, casualty, or violence determination.",
    geographicCoverage: geographicSummary,
    signalCoverage: signalSummary,
    signalField: summarizeWorldEventSignalField(limitedRecords),
    mapCells: summarizeWorldEventMapCells(limitedRecords),
    realityBrutality: summarizeWorldEventRealityBrutality(limitedRecords, sources),
    sources,
    humanitarian: humanitarianEnvelope({
      retrievedAt,
      records: limitedHumanitarianRecords,
      sources: humanitarianSources,
      status: limitedHumanitarianRecords.length
        ? availableHumanitarianCount === humanitarianSources.length ? "ready" : "partial"
        : "unavailable",
      reason: limitedHumanitarianRecords.length
        ? null
        : humanitarianSources.length
          ? "UNHCR returned no structured population rows; no data was fabricated."
          : "No structured humanitarian provider was requested; no data was fabricated.",
      liveFetch: humanitarianSources.length > 0,
      externalNetwork: humanitarianSources.length > 0,
    }),
    humanitarianRecords: limitedHumanitarianRecords,
    humanitarianSources,
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
    boundary: WORLD_EVENTS_BOUNDARY,
    reason: limitedRecords.length ? null : "No provider returned a usable source URL and title; no data was fabricated.",
  });
}

/** Replay a selected fetched observation without performing another request. */
export function replayWorldEventEvidence(snapshot, recordId = null, method = "local-replay") {
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  const record = records.find((candidate) => candidate?.id === recordId) ?? records[0] ?? null;
  return deepFreeze({
    schemaVersion: WORLD_EVENTS_SCHEMA_VERSION,
    source: WORLD_EVENTS_REPLAY_SOURCE,
    action: "replay",
    method: text(method, "local-replay"),
    recordId: record?.id ?? null,
    record,
    recordCount: records.length,
    query: normalizeWorldEventsQuery(snapshot?.query),
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
    confidence: 0,
    uncertainty: 1,
    executable: false,
    boundary: WORLD_EVENTS_BOUNDARY,
  });
}

/** Pure summary for renderer hosts; it preserves empty/offline states. */
export function summarizeWorldEvents(input = null) {
  const value = isRecord(input) ? input : createUnavailableWorldEvents();
  const records = Array.isArray(value.records) ? value.records : [];
  const sources = Array.isArray(value.sources) ? value.sources : WORLD_EVENTS_ENDPOINTS.map((endpoint) => sourceStatus(endpoint, value.retrievedAt, { available: false, recordCount: 0, reason: "No fetch performed." }));
  const rawHumanitarian = isRecord(value.humanitarian) ? value.humanitarian : null;
  const humanitarianRecords = Array.isArray(value.humanitarianRecords)
    ? value.humanitarianRecords
    : Array.isArray(rawHumanitarian?.records) ? rawHumanitarian.records : [];
  const humanitarianSources = Array.isArray(value.humanitarianSources)
    ? value.humanitarianSources
    : Array.isArray(rawHumanitarian?.sources)
      ? rawHumanitarian.sources
      : WORLD_EVENTS_HUMANITARIAN_ENDPOINTS.map((endpoint) => sourceStatus(endpoint, value.retrievedAt, {
        available: false,
        recordCount: 0,
        reason: "No structured humanitarian fetch performed.",
      }));
  const humanitarian = humanitarianEnvelope({
    retrievedAt: timestamp(value.retrievedAt) ?? nowIso(value.retrievedAt),
    records: humanitarianRecords,
    sources: humanitarianSources,
    status: text(rawHumanitarian?.status, humanitarianRecords.length ? "ready" : "unavailable"),
    reason: text(rawHumanitarian?.reason, humanitarianRecords.length ? null : "No structured humanitarian data is available; no data was fabricated."),
    liveFetch: rawHumanitarian?.liveFetch === true || (value.liveFetch === true && humanitarianSources.length > 0),
    externalNetwork: rawHumanitarian?.externalNetwork === true || (value.externalNetwork === true && humanitarianSources.length > 0),
  });
  const geographicSummary = geographicCoverage(records);
  const signalSummary = signalCoverage(records);
  return deepFreeze({
    schemaVersion: WORLD_EVENTS_SCHEMA_VERSION,
    source: WORLD_EVENTS_SOURCE,
    status: text(value.status, records.length ? "ready" : "unavailable"),
    query: normalizeWorldEventsQuery(value.query),
    retrievedAt: timestamp(value.retrievedAt),
    records,
    sources,
    recordCount: records.length,
    providerCount: sources.length,
    availableProviderCount: sources.filter((source) => source?.available === true).length,
    brutalityLanguageSignalCount: records.filter((record) => Number(record?.brutalityLanguageSignal?.level) > 0).length,
    explicitBrutalityLanguageSignalCount: records.filter((record) => Number(record?.brutalityLanguageSignal?.level) >= 3).length,
    brutalitySignalBasis: "Title-language presentation signal only; not a verified brutality, severity, casualty, or violence determination.",
    geographicCoverage: geographicSummary,
    signalCoverage: signalSummary,
    signalField: summarizeWorldEventSignalField(records),
    mapCells: summarizeWorldEventMapCells(records),
    realityBrutality: summarizeWorldEventRealityBrutality(records, sources),
    humanitarian,
    humanitarianRecords: humanitarian.records,
    humanitarianSources: humanitarian.sources,
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
    boundary: WORLD_EVENTS_BOUNDARY,
    reason: text(value.reason, records.length ? null : "No provider data is available; no data was fabricated."),
  });
}

export default fetchWorldEvents;
