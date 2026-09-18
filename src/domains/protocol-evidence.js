/**
 * Public protocol TVL evidence adapter.
 *
 * This adapter reads the free DeFiLlama current-TVL endpoint for a small,
 * documented protocol allowlist. The values are provider observations only:
 * they are deliberately kept separate from maTumbo's fictional contract and
 * pool scenarios and cannot create a quote, position, transfer, or settlement
 * instruction.
 */

export const PROTOCOL_EVIDENCE_SCHEMA_VERSION = 1;
export const PROTOCOL_EVIDENCE_SOURCE = "public-protocol-tvl-evidence";
export const PROTOCOL_EVIDENCE_PROVIDER = "DeFiLlama public API";
export const PROTOCOL_EVIDENCE_TIMEOUT_MS = 9_000;
export const PROTOCOL_EVIDENCE_MAX_PROTOCOLS = 4;

export const PROTOCOL_EVIDENCE_ENDPOINTS = Object.freeze([
  Object.freeze({
    id: "defillama-aave-tvl",
    slug: "aave",
    name: "Aave",
    endpoint: "https://api.llama.fi/tvl/aave",
    sourceUrl: "https://defillama.com/protocol/aave",
  }),
  Object.freeze({
    id: "defillama-uniswap-tvl",
    slug: "uniswap",
    name: "Uniswap",
    endpoint: "https://api.llama.fi/tvl/uniswap",
    sourceUrl: "https://defillama.com/protocol/uniswap",
  }),
  Object.freeze({
    id: "defillama-lido-tvl",
    slug: "lido",
    name: "Lido",
    endpoint: "https://api.llama.fi/tvl/lido",
    sourceUrl: "https://defillama.com/protocol/lido",
  }),
  Object.freeze({
    id: "defillama-maker-tvl",
    slug: "makerdao",
    name: "Maker",
    endpoint: "https://api.llama.fi/tvl/makerdao",
    sourceUrl: "https://defillama.com/protocol/makerdao",
  }),
]);

export const PROTOCOL_EVIDENCE_BOUNDARY =
  "Public DeFiLlama TVL observations are unverified and may be stale or methodology-dependent. They are not a quote, contract fact, reserve attestation, investment signal, or proof of solvency; no wallet, trade, custody, signing, transfer, or settlement authority is active.";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = null) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function timestamp(value) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  return timestamp(value) ?? new Date().toISOString();
}

function safeError(error) {
  const message = text(error?.message ?? error, "provider unavailable");
  return message.slice(0, 180);
}

function publicUrl(value, { host = null } = {}) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (host && parsed.hostname.toLowerCase() !== host) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function endpointUrl(endpoint) {
  return publicUrl(endpoint?.endpoint, { host: "api.llama.fi" });
}

function normalizeTvl(payload) {
  const candidate = isRecord(payload) ? payload.tvl ?? payload.value : payload;
  if (typeof candidate === "boolean" || candidate === null || candidate === undefined || candidate === "") return null;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function sourceStatus(endpoint, retrievedAt, values = {}) {
  return Object.freeze({
    id: endpoint.id,
    slug: endpoint.slug,
    name: endpoint.name,
    provider: PROTOCOL_EVIDENCE_PROVIDER,
    endpoint: endpoint.endpoint,
    sourceUrl: endpoint.sourceUrl,
    metric: "current protocol TVL",
    unit: "USD",
    retrievedAt,
    ...values,
    localOnly: true,
    simulation: true,
    externalSource: true,
    truthClaim: false,
    executable: false,
  });
}

function recordFrom(endpoint, retrievedAt, values = {}) {
  return Object.freeze({
    id: `defillama-tvl:${endpoint.slug}`,
    providerId: endpoint.id,
    provider: PROTOCOL_EVIDENCE_PROVIDER,
    protocolSlug: endpoint.slug,
    protocolName: endpoint.name,
    metric: "current protocol TVL",
    unit: "USD",
    endpoint: endpoint.endpoint,
    sourceUrl: endpoint.sourceUrl,
    retrievedAt,
    currentTvl: null,
    status: "unavailable",
    reason: "No provider value has been returned in this session.",
    ...values,
    localOnly: true,
    simulation: true,
    liveFetch: values.liveFetch === true,
    externalNetwork: values.liveFetch === true,
    externalSource: true,
    truthClaim: false,
    executable: false,
  });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return Object.freeze(value);
}

export function createUnavailableProtocolEvidence({
  retrievedAt = new Date().toISOString(),
  reason = "No public protocol TVL response is available in this session.",
} = {}) {
  const retrieved = nowIso(retrievedAt);
  const records = PROTOCOL_EVIDENCE_ENDPOINTS.slice(0, PROTOCOL_EVIDENCE_MAX_PROTOCOLS)
    .map((endpoint) => recordFrom(endpoint, retrieved, { reason }));
  return deepFreeze({
    schemaVersion: PROTOCOL_EVIDENCE_SCHEMA_VERSION,
    source: PROTOCOL_EVIDENCE_SOURCE,
    provider: PROTOCOL_EVIDENCE_PROVIDER,
    metric: "current protocol TVL",
    unit: "USD",
    status: "unavailable",
    retrievedAt: retrieved,
    records,
    sources: PROTOCOL_EVIDENCE_ENDPOINTS.slice(0, PROTOCOL_EVIDENCE_MAX_PROTOCOLS)
      .map((endpoint) => sourceStatus(endpoint, retrieved, { available: false, value: null, reason })),
    availableCount: 0,
    unavailableCount: records.length,
    providerAvailable: false,
    providerUnavailable: true,
    liveFetch: false,
    externalNetwork: false,
    externalSource: true,
    localOnly: true,
    simulation: true,
    truthClaim: false,
    executable: false,
    boundary: PROTOCOL_EVIDENCE_BOUNDARY,
    reason,
  });
}

/**
 * Read the current TVL for the fixed public protocol list after an explicit
 * caller request. A failed or malformed provider remains visible as an
 * unavailable row; no local value is substituted.
 */
export async function fetchProtocolEvidence({
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  timeoutMs = PROTOCOL_EVIDENCE_TIMEOUT_MS,
  endpoints = PROTOCOL_EVIDENCE_ENDPOINTS,
} = {}) {
  const retrievedAt = nowIso(now);
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 60_000)
    : PROTOCOL_EVIDENCE_TIMEOUT_MS;
  const endpointList = (Array.isArray(endpoints) ? endpoints : [...PROTOCOL_EVIDENCE_ENDPOINTS])
    .slice(0, PROTOCOL_EVIDENCE_MAX_PROTOCOLS);
  if (typeof fetchImpl !== "function") {
    return createUnavailableProtocolEvidence({ retrievedAt, reason: "Browser fetch is unavailable; no protocol value was fabricated." });
  }

  const records = [];
  const sources = [];
  let availableCount = 0;
  for (const endpoint of endpointList) {
    const requestUrl = endpointUrl(endpoint);
    if (!requestUrl) {
      const reason = "Only documented HTTPS DeFiLlama endpoints are eligible.";
      records.push(recordFrom(endpoint, retrievedAt, { liveFetch: true, reason }));
      sources.push(sourceStatus(endpoint, retrievedAt, { available: false, value: null, reason }));
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
      const value = normalizeTvl(payload);
      if (value === null) throw new Error("Provider returned no finite non-negative TVL value.");
      availableCount += 1;
      records.push(recordFrom(endpoint, retrievedAt, {
        currentTvl: value,
        status: "provider-reported",
        reason: null,
        liveFetch: true,
      }));
      sources.push(sourceStatus(endpoint, retrievedAt, {
        available: true,
        value,
        reason: null,
      }));
    } catch (error) {
      const reason = error?.name === "AbortError"
        ? "Provider request timed out before a usable TVL value arrived."
        : safeError(error);
      records.push(recordFrom(endpoint, retrievedAt, { liveFetch: true, reason }));
      sources.push(sourceStatus(endpoint, retrievedAt, { available: false, value: null, reason }));
    } finally {
      if (timeoutHandle !== null) globalThis.clearTimeout?.(timeoutHandle);
    }
  }

  const unavailableCount = Math.max(records.length - availableCount, 0);
  const status = availableCount === 0 ? "unavailable" : unavailableCount ? "partial" : "ready";
  return deepFreeze({
    schemaVersion: PROTOCOL_EVIDENCE_SCHEMA_VERSION,
    source: PROTOCOL_EVIDENCE_SOURCE,
    provider: PROTOCOL_EVIDENCE_PROVIDER,
    metric: "current protocol TVL",
    unit: "USD",
    status,
    retrievedAt,
    records,
    sources,
    availableCount,
    unavailableCount,
    providerAvailable: availableCount > 0,
    providerUnavailable: availableCount === 0,
    liveFetch: true,
    externalNetwork: true,
    externalSource: true,
    localOnly: true,
    simulation: true,
    truthClaim: false,
    executable: false,
    boundary: PROTOCOL_EVIDENCE_BOUNDARY,
    reason: availableCount ? null : "No public protocol endpoint returned a usable TVL value; no rows were fabricated.",
  });
}

export function summarizeProtocolEvidence(input = null) {
  const value = isRecord(input) ? input : createUnavailableProtocolEvidence();
  const records = Array.isArray(value.records) ? value.records : [];
  const sources = Array.isArray(value.sources) ? value.sources : [];
  const availableCount = Number.isSafeInteger(value.availableCount)
    ? value.availableCount
    : records.filter((record) => record?.status === "provider-reported" && Number.isFinite(record?.currentTvl)).length;
  const unavailableCount = Number.isSafeInteger(value.unavailableCount)
    ? value.unavailableCount
    : Math.max(records.length - availableCount, 0);
  return deepFreeze({
    schemaVersion: PROTOCOL_EVIDENCE_SCHEMA_VERSION,
    source: PROTOCOL_EVIDENCE_SOURCE,
    provider: PROTOCOL_EVIDENCE_PROVIDER,
    metric: "current protocol TVL",
    unit: "USD",
    status: text(value.status, records.length && availableCount ? "partial" : "unavailable"),
    retrievedAt: timestamp(value.retrievedAt),
    records,
    sources,
    recordCount: records.length,
    availableCount,
    unavailableCount,
    providerCount: sources.length,
    providerAvailable: value.providerAvailable === true,
    providerUnavailable: value.providerUnavailable !== false,
    liveFetch: value.liveFetch === true,
    externalNetwork: value.externalNetwork === true,
    externalSource: true,
    localOnly: true,
    simulation: true,
    truthClaim: false,
    executable: false,
    boundary: text(value.boundary, PROTOCOL_EVIDENCE_BOUNDARY),
    reason: text(value.reason, records.length ? null : "No public protocol TVL data is available; no values were fabricated."),
  });
}

export default fetchProtocolEvidence;
