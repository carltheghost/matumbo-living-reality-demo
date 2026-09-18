/**
 * Bounded public population context adapter for the Launch Distribution
 * surface.
 *
 * The World Bank observations are contextual metadata only. They are kept
 * separate from the fictional TUMBO-SIM registry: a population observation
 * never creates a recipient, changes a percentage, or becomes an issuance,
 * wallet, transfer, or settlement instruction.
 */

export const POPULATION_CONTEXT_SCHEMA_VERSION = 1;
export const POPULATION_CONTEXT_SOURCE = "public-population-context-world-bank";
export const POPULATION_CONTEXT_PROVIDER = "World Bank Indicators API";
export const POPULATION_CONTEXT_ENDPOINT_BASE = "https://api.worldbank.org/v2";
export const POPULATION_CONTEXT_INDICATOR = "SP.POP.TOTL";
export const POPULATION_CONTEXT_INDICATOR_LABEL = "Population, total";
export const POPULATION_CONTEXT_DOCUMENTATION = "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation";
export const POPULATION_CONTEXT_START_YEAR = 2022;
export const POPULATION_CONTEXT_END_YEAR = 2024;
export const POPULATION_CONTEXT_MAX_YEARS = 3;
export const POPULATION_CONTEXT_MAX_ROWS = 18;
export const POPULATION_CONTEXT_FETCH_TIMEOUT_MS = 9_000;

/**
 * This is a fixed, representative context set, not a recipient list. The
 * labels describe why a context is visible in the demo and are deliberately
 * not used to infer allocation, identity, geography, or eligibility.
 */
export const POPULATION_CONTEXTS = Object.freeze([
  Object.freeze({ id: "population-context:usa", code: "USA", contextLabel: "North America context" }),
  Object.freeze({ id: "population-context:ken", code: "KEN", contextLabel: "East Africa context" }),
  Object.freeze({ id: "population-context:ind", code: "IND", contextLabel: "South Asia context" }),
  Object.freeze({ id: "population-context:bra", code: "BRA", contextLabel: "South America context" }),
  Object.freeze({ id: "population-context:nga", code: "NGA", contextLabel: "West Africa context" }),
  Object.freeze({ id: "population-context:deu", code: "DEU", contextLabel: "Europe context" }),
]);

export const POPULATION_CONTEXT_BOUNDARY =
  "World Bank population observations are contextual public metadata only. They are not recipient counts, allocation weights, eligibility, identity, geocoded community membership, issuance, price, wallet, transfer, custody, signing, or settlement data.";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeText(value, fallback = null, maxLength = 180) {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
  return normalized || fallback;
}

function safeError(error) {
  const message = safeText(error?.message ?? error, "provider unavailable", 220);
  if (error?.name === "AbortError" || /\babort(?:ed|ing)?\b/i.test(message)) {
    return "Provider request timed out before a usable population response arrived.";
  }
  return message;
}

function timestamp(value) {
  const candidate = safeText(value, null, 80);
  return candidate && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString()
    : null;
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  return timestamp(value) ?? new Date().toISOString();
}

function boundedYear(value, fallback) {
  return Number.isInteger(value) && value >= 1900 && value <= 2200 ? value : fallback;
}

function requestedYearRange(startYear = POPULATION_CONTEXT_START_YEAR, endYear = POPULATION_CONTEXT_END_YEAR) {
  const from = boundedYear(startYear, POPULATION_CONTEXT_START_YEAR);
  const to = boundedYear(endYear, POPULATION_CONTEXT_END_YEAR);
  const normalizedFrom = Math.min(from, to);
  const normalizedTo = Math.max(from, to);
  const boundedTo = Math.min(normalizedTo, normalizedFrom + POPULATION_CONTEXT_MAX_YEARS - 1);
  return Object.freeze({ from: normalizedFrom, to: boundedTo });
}

function endpointUrl() {
  const codes = POPULATION_CONTEXTS.map((context) => context.code).join(";");
  const years = requestedYearRange();
  const params = new URLSearchParams({
    format: "json",
    date: `${years.from}:${years.to}`,
    per_page: String(POPULATION_CONTEXT_MAX_ROWS),
    page: "1",
  });
  return `${POPULATION_CONTEXT_ENDPOINT_BASE}/country/${codes}/indicator/${POPULATION_CONTEXT_INDICATOR}?${params.toString()}`;
}

export const POPULATION_CONTEXT_ENDPOINT = endpointUrl();

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return Object.freeze(value);
}

function contextForCode(code) {
  const normalized = safeText(code, "", 8).toUpperCase();
  return POPULATION_CONTEXTS.find((context) => context.code === normalized) ?? null;
}

function parseYear(value) {
  const candidate = Number(value);
  return Number.isInteger(candidate) ? candidate : null;
}

function parsePopulation(value) {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") return null;
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null;
}

function normalizeRecord(row, index, retrievedAt, requestUrl, years) {
  if (!isRecord(row)) return null;
  const code = safeText(row.countryiso3code, "", 8).toUpperCase();
  const context = contextForCode(code);
  const year = parseYear(row.date);
  const value = parsePopulation(row.value);
  const indicatorId = safeText(row.indicator?.id, "", 80);
  if (!context || !year || year < years.from || year > years.to || indicatorId !== POPULATION_CONTEXT_INDICATOR || value === null) return null;
  const providerCountryName = safeText(row.country?.value, null, 120);
  return {
    id: `worldbank:population:${context.code}:${year}`,
    kind: "public-population-context-observation",
    provider: POPULATION_CONTEXT_PROVIDER,
    source: POPULATION_CONTEXT_SOURCE,
    contextId: context.id,
    contextCode: context.code,
    contextLabel: context.contextLabel,
    countryName: providerCountryName,
    indicator: POPULATION_CONTEXT_INDICATOR,
    indicatorLabel: POPULATION_CONTEXT_INDICATOR_LABEL,
    year,
    population: value,
    unit: "people",
    retrievedAt,
    requestUrl,
    publicSource: true,
    metadataOnly: true,
    contextualOnly: true,
    recipientCount: false,
    allocationWeight: false,
    eligibility: false,
    geocoded: false,
    identityResolution: false,
    issuance: false,
    wallet: false,
    transfer: false,
    custody: false,
    signing: false,
    settlement: false,
    executable: false,
    simulation: true,
    localOnly: true,
  };
}

function contextStatus(context, retrievedAt, records = [], reason = null) {
  const contextRecords = records
    .filter((record) => record.contextCode === context.code)
    .sort((left, right) => right.year - left.year);
  const latest = contextRecords[0] ?? null;
  return {
    id: context.id,
    contextCode: context.code,
    contextLabel: context.contextLabel,
    provider: POPULATION_CONTEXT_PROVIDER,
    indicator: POPULATION_CONTEXT_INDICATOR,
    status: latest ? "provider-reported" : "unavailable",
    recordCount: contextRecords.length,
    latestYear: latest?.year ?? null,
    latestPopulation: latest?.population ?? null,
    countryName: latest?.countryName ?? null,
    reason: latest ? null : reason,
    contextualOnly: true,
    recipientCount: false,
    allocationWeight: false,
    geocoded: false,
    identityResolution: false,
    simulation: true,
    localOnly: true,
    executable: false,
  };
}

function unavailableStatuses(retrievedAt, reason) {
  return POPULATION_CONTEXTS.map((context) => contextStatus(context, retrievedAt, [], reason));
}

function envelope({
  retrievedAt,
  requestUrl = POPULATION_CONTEXT_ENDPOINT,
  records = [],
  contextStatuses = unavailableStatuses(retrievedAt, "No public population observation is available; no fallback rows were fabricated."),
  status = "unavailable",
  providerAvailable = false,
  externalNetwork = false,
  reason = null,
} = {}) {
  const years = requestedYearRange();
  const availableCount = records.length;
  const availableContextCount = new Set(records.map((record) => record.contextCode)).size;
  return deepFreeze({
    schemaVersion: POPULATION_CONTEXT_SCHEMA_VERSION,
    source: POPULATION_CONTEXT_SOURCE,
    provider: POPULATION_CONTEXT_PROVIDER,
    endpoint: POPULATION_CONTEXT_ENDPOINT,
    requestUrl,
    documentation: POPULATION_CONTEXT_DOCUMENTATION,
    indicator: POPULATION_CONTEXT_INDICATOR,
    indicatorLabel: POPULATION_CONTEXT_INDICATOR_LABEL,
    requestedYears: years,
    contexts: POPULATION_CONTEXTS,
    status,
    retrievedAt: safeText(retrievedAt, new Date().toISOString(), 80),
    records,
    contextStatuses,
    returnedCount: records.length,
    availableCount,
    contextCount: POPULATION_CONTEXTS.length,
    availableContextCount,
    unavailableCount: Math.max(POPULATION_CONTEXTS.length - new Set(records.map((record) => record.contextCode)).size, 0),
    providerAvailable: providerAvailable === true,
    providerUnavailable: providerAvailable !== true,
    liveFetch: externalNetwork === true,
    externalNetwork: externalNetwork === true,
    externalSource: true,
    publicSource: true,
    metadataOnly: true,
    contextualOnly: true,
    recipientCount: false,
    allocationWeight: false,
    geocoded: false,
    identityResolution: false,
    issuance: false,
    wallet: false,
    transfer: false,
    custody: false,
    signing: false,
    settlement: false,
    executable: false,
    simulation: true,
    localOnly: true,
    truthClaim: false,
    boundary: POPULATION_CONTEXT_BOUNDARY,
    reason: reason ?? null,
  });
}

export function buildWorldBankPopulationUrl() {
  return POPULATION_CONTEXT_ENDPOINT;
}

export function createUnavailablePopulationContext({
  retrievedAt = new Date().toISOString(),
  reason = "No public World Bank population refresh has completed; no fallback or fictional population rows were fabricated.",
} = {}) {
  const retrieved = nowIso(retrievedAt);
  return envelope({
    retrievedAt: retrieved,
    records: [],
    contextStatuses: unavailableStatuses(retrieved, safeText(reason, "Public population context is unavailable; no fallback rows were fabricated.", 240)),
    status: "unavailable",
    providerAvailable: false,
    externalNetwork: false,
    reason: safeText(reason, "Public population context is unavailable; no fallback rows were fabricated.", 240),
  });
}

/**
 * Read one fixed, bounded World Bank population envelope after an explicit
 * caller request. No caller-controlled URL, country list, year range, or
 * provider identity is accepted.
 */
export async function fetchPopulationContext({
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  timeoutMs = POPULATION_CONTEXT_FETCH_TIMEOUT_MS,
} = {}) {
  const retrievedAt = nowIso(now);
  const requestUrl = buildWorldBankPopulationUrl();
  if (typeof fetchImpl !== "function") {
    return createUnavailablePopulationContext({
      retrievedAt,
      reason: "Browser fetch is unavailable; no fallback population rows were fabricated.",
    });
  }
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 60_000)
    : POPULATION_CONTEXT_FETCH_TIMEOUT_MS;
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
    const years = requestedYearRange();
    const rows = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : null;
    if (!rows) throw new Error("World Bank returned an invalid indicator envelope.");
    const records = rows
      .map((row, index) => normalizeRecord(row, index, retrievedAt, requestUrl, years))
      .filter(Boolean)
      .filter((record, index, all) => all.findIndex((candidate) => candidate.id === record.id) === index)
      .slice(0, POPULATION_CONTEXT_MAX_ROWS);
    const statuses = POPULATION_CONTEXTS.map((context) => contextStatus(
      context,
      retrievedAt,
      records,
      "World Bank returned no usable observation for this context and year window; no fallback rows were fabricated.",
    ));
    const status = records.length === 0
      ? "unavailable"
      : statuses.some((entry) => entry.status === "unavailable") ? "partial" : "ready";
    const providerReason = records.length
      ? null
      : "World Bank returned no usable SP.POP.TOTL observations for the fixed context set; no fallback rows were fabricated.";
    return envelope({
      retrievedAt,
      requestUrl,
      records,
      contextStatuses: statuses,
      status,
      providerAvailable: records.length > 0,
      externalNetwork: true,
      reason: providerReason,
    });
  } catch (error) {
    const reason = `World Bank population context is unavailable: ${safeError(error)}`;
    return envelope({
      retrievedAt,
      requestUrl,
      records: [],
      contextStatuses: unavailableStatuses(retrievedAt, reason),
      status: "unavailable",
      providerAvailable: false,
      externalNetwork: false,
      reason,
    });
  } finally {
    if (timeoutHandle !== null) globalThis.clearTimeout?.(timeoutHandle);
  }
}

export function summarizePopulationContext(input = null) {
  const value = isRecord(input) ? input : createUnavailablePopulationContext();
  const records = Array.isArray(value.records) ? value.records : [];
  const statuses = Array.isArray(value.contextStatuses) ? value.contextStatuses : [];
  return deepFreeze({
    schemaVersion: POPULATION_CONTEXT_SCHEMA_VERSION,
    source: POPULATION_CONTEXT_SOURCE,
    provider: POPULATION_CONTEXT_PROVIDER,
    indicator: POPULATION_CONTEXT_INDICATOR,
    requestedYears: requestedYearRange(),
    status: safeText(value.status, records.length ? "ready" : "unavailable"),
    retrievedAt: timestamp(value.retrievedAt),
    records,
    contextStatuses: statuses,
    recordCount: records.length,
    contextCount: POPULATION_CONTEXTS.length,
    availableContextCount: statuses.filter((entry) => entry?.status === "provider-reported").length,
    providerAvailable: value.providerAvailable === true,
    providerUnavailable: value.providerUnavailable !== false,
    liveFetch: value.liveFetch === true,
    externalNetwork: value.externalNetwork === true,
    externalSource: true,
    publicSource: true,
    metadataOnly: true,
    contextualOnly: true,
    recipientCount: false,
    allocationWeight: false,
    geocoded: false,
    identityResolution: false,
    issuance: false,
    wallet: false,
    transfer: false,
    custody: false,
    signing: false,
    settlement: false,
    executable: false,
    simulation: true,
    localOnly: true,
    truthClaim: false,
    boundary: safeText(value.boundary, POPULATION_CONTEXT_BOUNDARY, 420),
    reason: safeText(value.reason, records.length ? null : "No public population observations are available; no fallback rows were fabricated.", 260),
  });
}

export default fetchPopulationContext;
