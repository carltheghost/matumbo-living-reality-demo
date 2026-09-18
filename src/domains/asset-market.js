/**
 * Public asset-market evidence adapter.
 *
 * This module reads one bounded, keyless CoinGecko market-data response for a
 * fixed peer set. It does not invent a TUMBO price or listing: TUMBO-SIM is a
 * local fictional display unit and is exposed separately as `unlisted`.
 * Provider data is research evidence only. No trading, wallet, custody,
 * signing, transfer, settlement, persistence, or external write path exists.
 */

export const ASSET_MARKET_SCHEMA_VERSION = 1;
export const ASSET_MARKET_SOURCE = "public-asset-market-evidence";
export const ASSET_MARKET_REPLAY_SOURCE = "public-asset-market-replay";
export const ASSET_MARKET_MAX_RECORDS = 4;
export const ASSET_MARKET_FETCH_TIMEOUT_MS = 9_000;

export const ASSET_MARKET_BOUNDARY =
  "CoinGecko market fields are unverified research observations, not a price feed, investment signal, trading instruction, or financial authority. TUMBO-SIM is a fictional local asset-token display unit with no CoinGecko listing or price; no wallet, custody, transfer, signing, settlement, or money authority is active.";

const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const COINGECKO_DOCS = "https://docs.coingecko.com/reference/coins-markets";

export const ASSET_MARKET_PEER_ASSETS = Object.freeze([
  Object.freeze({ id: "bitcoin", symbol: "BTC", label: "Bitcoin" }),
  Object.freeze({ id: "ethereum", symbol: "ETH", label: "Ethereum" }),
  Object.freeze({ id: "official-trump", symbol: "TRUMP", label: "Official Trump" }),
  Object.freeze({ id: "melania-meme", symbol: "MELANIA", label: "Melania Meme" }),
]);

export const ASSET_MARKET_PEER_ASSET_IDS = Object.freeze(ASSET_MARKET_PEER_ASSETS.map(({ id }) => id));

const peerIdSet = new Set(ASSET_MARKET_PEER_ASSET_IDS);

function endpointFor(assetIds = ASSET_MARKET_PEER_ASSET_IDS) {
  const ids = assetIds.filter((id) => peerIdSet.has(id)).join(",");
  const url = new URL(`${COINGECKO_API_BASE}/coins/markets`);
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("ids", ids);
  url.searchParams.set("order", "market_cap_desc");
  url.searchParams.set("per_page", String(ASSET_MARKET_MAX_RECORDS));
  url.searchParams.set("page", "1");
  url.searchParams.set("sparkline", "false");
  url.searchParams.set("price_change_percentage", "24h");
  return url.toString();
}

export const ASSET_MARKET_ENDPOINTS = Object.freeze([
  Object.freeze({
    id: "coingecko-coins-markets",
    provider: "CoinGecko public keyless API",
    endpoint: endpointFor(),
    documentation: COINGECKO_DOCS,
    format: "coins-markets",
    assetIds: ASSET_MARKET_PEER_ASSET_IDS,
  }),
]);

export const ASSET_MARKET_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "asset-market.public-read",
    label: "Read a bounded public market-data response",
    enabled: true,
    mode: "explicit-refresh",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "asset-market.inspect-provenance",
    label: "Inspect source, observed time, and field completeness",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "asset-market.tumbo-unlisted",
    label: "Show TUMBO-SIM as unlisted without a price",
    enabled: true,
    mode: "explicit-boundary",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "asset-market.no-trading",
    label: "Trade, buy, sell, or quote a market asset",
    enabled: false,
    mode: "denied",
    denied: true,
    authority: "none",
    simulationOnly: true,
    executable: false,
    reason: "This surface is evidence-only and has no trading or order authority.",
  }),
  Object.freeze({
    id: "asset-market.no-custody",
    label: "Connect a wallet or custody an asset",
    enabled: false,
    mode: "denied",
    denied: true,
    authority: "none",
    simulationOnly: true,
    executable: false,
    reason: "No wallet, account, custody, signing, or transfer path exists.",
  }),
  Object.freeze({
    id: "asset-market.no-persistence",
    label: "Persist or publish provider data",
    enabled: false,
    mode: "denied",
    denied: true,
    authority: "none",
    simulationOnly: true,
    executable: false,
    reason: "Data remains in the current page session only.",
  }),
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return Object.freeze(value);
}

function text(value, fallback = null) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
}

function safeNonNegativeNumber(value, fallback = null) {
  const candidate = finiteNumber(value, fallback);
  return candidate !== null && candidate >= 0 ? candidate : fallback;
}

function safeInteger(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) ? candidate : fallback;
}

function timestamp(value) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function epochTimestamp(value) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return null;
  const date = new Date(candidate < 10_000_000_000 ? candidate * 1000 : candidate);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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

function safeError(error) {
  if (error?.name === "AbortError" || /\babort(?:ed|ing)?\b/i.test(String(error?.message ?? ""))) {
    return "CoinGecko request timed out before a usable response arrived.";
  }
  const message = text(error?.message ?? error, "CoinGecko provider unavailable");
  return message.slice(0, 180);
}

function normalizeAssetIds(value) {
  const requested = Array.isArray(value) ? value : ASSET_MARKET_PEER_ASSET_IDS;
  const ids = requested
    .map((id) => String(id).trim().toLowerCase())
    .filter((id) => peerIdSet.has(id));
  return ids.length ? [...new Set(ids)].slice(0, ASSET_MARKET_MAX_RECORDS) : [...ASSET_MARKET_PEER_ASSET_IDS];
}

function nativeTumboState() {
  return {
    id: "tumbo-sim",
    symbol: "TUMBO-SIM",
    name: "TUMBO-SIM",
    listingStatus: "unlisted",
    listed: false,
    marketDataAvailable: false,
    priceStatus: "not-provided",
    marketStatus: "not-a-market-instrument",
    source: "local asset-token declaration",
    note: "TUMBO-SIM is a fictional local display unit. CoinGecko is not queried for a TUMBO listing or price.",
    localOnly: true,
    simulation: true,
    externalSource: false,
    truthClaim: false,
    executable: false,
  };
}

function completenessFor(row) {
  const checks = {
    id: Boolean(text(row?.id)),
    name: Boolean(text(row?.name)),
    symbol: Boolean(text(row?.symbol)),
    currentPrice: finiteNumber(row?.current_price) !== null,
    marketCap: safeNonNegativeNumber(row?.market_cap) !== null,
    volume24h: safeNonNegativeNumber(row?.total_volume) !== null,
    observedAt: Boolean(timestamp(row?.last_updated)),
  };
  const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  const grade = score >= 1 ? "A" : score >= 0.86 ? "B" : score >= 0.7 ? "C" : "D";
  return {
    dataCompletenessGrade: grade,
    dataCompletenessScore: Number(score.toFixed(2)),
    dataCompletenessPercent: Math.round(score * 100),
    dataCompletenessBasis: "Presence of provider market fields only; not a trading, performance, or investment grade.",
    dataCompletenessChecks: checks,
  };
}

function normalizeMarketRow(row, retrievedAt, endpoint) {
  if (!isRecord(row) || !peerIdSet.has(text(row.id))) return null;
  const asset = ASSET_MARKET_PEER_ASSETS.find(({ id }) => id === row.id);
  if (!asset) return null;
  const lastUpdated = timestamp(row.last_updated);
  const record = {
    id: `coingecko:${asset.id}`,
    assetId: asset.id,
    symbol: text(row.symbol, asset.symbol).toUpperCase(),
    name: text(row.name, asset.label),
    label: asset.label,
    currency: "usd",
    currentPrice: safeNonNegativeNumber(row.current_price),
    marketCap: safeNonNegativeNumber(row.market_cap),
    marketCapRank: safeInteger(row.market_cap_rank),
    fullyDilutedValuation: safeNonNegativeNumber(row.fully_diluted_valuation),
    totalVolume24h: safeNonNegativeNumber(row.total_volume),
    high24h: safeNonNegativeNumber(row.high_24h),
    low24h: safeNonNegativeNumber(row.low_24h),
    priceChange24h: finiteNumber(row.price_change_24h),
    priceChangePercentage24h: finiteNumber(row.price_change_percentage_24h),
    marketCapChange24h: finiteNumber(row.market_cap_change_24h),
    marketCapChangePercentage24h: finiteNumber(row.market_cap_change_percentage_24h),
    circulatingSupply: safeNonNegativeNumber(row.circulating_supply),
    totalSupply: safeNonNegativeNumber(row.total_supply),
    maxSupply: safeNonNegativeNumber(row.max_supply),
    ath: safeNonNegativeNumber(row.ath),
    athChangePercentage: finiteNumber(row.ath_change_percentage),
    athDate: timestamp(row.ath_date),
    atl: safeNonNegativeNumber(row.atl),
    atlChangePercentage: finiteNumber(row.atl_change_percentage),
    atlDate: timestamp(row.atl_date),
    imageUrl: publicSourceUrl(row.image),
    sourceUrl: endpoint.endpoint,
    documentationUrl: endpoint.documentation,
    // `assetPageUrl` is the canonical presentation field. Keep the historical
    // `coinPageUrl` alias in the public projection so older consumers can still
    // resolve their saved CoinGecko links without bringing "coin" wording into
    // the maTumbo UI.
    assetPageUrl: publicSourceUrl(`https://www.coingecko.com/en/coins/${asset.id}`),
    coinPageUrl: publicSourceUrl(`https://www.coingecko.com/en/coins/${asset.id}`),
    sourceObservedAt: lastUpdated ?? retrievedAt,
    observedAtStatus: lastUpdated ? "provider-reported" : "unavailable",
    retrievedAt,
    externalSource: true,
    provider: endpoint.provider,
    providerId: endpoint.id,
    liveFetch: true,
    localOnly: true,
    simulation: true,
    truthClaim: false,
    uncertainty: 1,
    confidence: 0,
    complete: false,
    executable: false,
    ...completenessFor(row),
  };
  return record;
}

function sourceStatus(endpoint, retrievedAt, values = {}) {
  return {
    id: endpoint.id,
    provider: endpoint.provider,
    endpoint: endpoint.endpoint,
    documentation: endpoint.documentation,
    format: endpoint.format,
    requestedAssetIds: endpoint.assetIds,
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

async function requestJson(fetchImpl, endpoint, timeoutMs) {
  const requestUrl = publicSourceUrl(endpoint?.endpoint);
  const requestHost = requestUrl ? new URL(requestUrl).hostname.toLowerCase() : "";
  if (!requestUrl || !(requestHost === "coingecko.com" || requestHost.endsWith(".coingecko.com"))) {
    throw new Error("Only the documented HTTPS CoinGecko public endpoint is eligible.");
  }
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
    return { payload: await response.json(), requestUrl };
  } finally {
    if (timeoutHandle !== null) globalThis.clearTimeout?.(timeoutHandle);
  }
}

export function createUnavailableAssetMarketEvidence({
  retrievedAt = new Date().toISOString(),
  reason = "No public CoinGecko market response is available in this session.",
} = {}) {
  const retrieved = nowIso(retrievedAt);
  return deepFreeze({
    schemaVersion: ASSET_MARKET_SCHEMA_VERSION,
    source: ASSET_MARKET_SOURCE,
    status: "unavailable",
    currency: "usd",
    retrievedAt: retrieved,
    nativeAsset: nativeTumboState(),
    requestedAssetIds: ASSET_MARKET_PEER_ASSET_IDS,
    returnedAssetIds: [],
    missingAssetIds: ASSET_MARKET_PEER_ASSET_IDS,
    records: [],
    sources: ASSET_MARKET_ENDPOINTS.map((endpoint) => sourceStatus(endpoint, retrieved, {
      available: false,
      recordCount: 0,
      returnedAssetIds: [],
      missingAssetIds: ASSET_MARKET_PEER_ASSET_IDS,
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
    capabilities: ASSET_MARKET_CAPABILITIES,
    boundary: ASSET_MARKET_BOUNDARY,
    reason,
  });
}

/**
 * Fetch the fixed CoinGecko peer set after an explicit caller request.
 * Missing slugs and provider failures stay visible; no local row replaces
 * them, and TUMBO-SIM remains a separate unlisted declaration.
 */
export async function fetchAssetMarketEvidence({
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  timeoutMs = ASSET_MARKET_FETCH_TIMEOUT_MS,
  assetIds = ASSET_MARKET_PEER_ASSET_IDS,
  endpoint = ASSET_MARKET_ENDPOINTS[0],
} = {}) {
  const retrievedAt = nowIso(now);
  const normalizedAssetIds = normalizeAssetIds(assetIds);
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 60_000)
    : ASSET_MARKET_FETCH_TIMEOUT_MS;
  if (typeof fetchImpl !== "function") {
    return createUnavailableAssetMarketEvidence({ retrievedAt, reason: "Browser fetch is unavailable; no market rows were fabricated." });
  }
  const requestEndpoint = endpoint?.endpoint === ASSET_MARKET_ENDPOINTS[0].endpoint && normalizedAssetIds.length === ASSET_MARKET_PEER_ASSET_IDS.length
    ? endpoint
    : {
      ...ASSET_MARKET_ENDPOINTS[0],
      endpoint: endpointFor(normalizedAssetIds),
      assetIds: normalizedAssetIds,
    };
  let payload = null;
  let requestUrl = null;
  let errorReason = null;
  try {
    ({ payload, requestUrl } = await requestJson(fetchImpl, requestEndpoint, boundedTimeout));
  } catch (error) {
    errorReason = safeError(error);
  }
  const rows = Array.isArray(payload) ? payload : [];
  const records = rows
    .map((row) => normalizeMarketRow(row, retrievedAt, requestEndpoint))
    .filter(Boolean)
    .filter((record, index, all) => all.findIndex((candidate) => candidate.assetId === record.assetId) === index)
    .filter((record) => normalizedAssetIds.includes(record.assetId))
    .slice(0, ASSET_MARKET_MAX_RECORDS);
  const returnedAssetIds = records.map((record) => record.assetId);
  const missingAssetIds = normalizedAssetIds.filter((id) => !returnedAssetIds.includes(id));
  const available = !errorReason && Array.isArray(payload);
  const sourceReason = errorReason
    ?? (!Array.isArray(payload) ? "Provider returned a malformed market response; no rows were fabricated." : missingAssetIds.length ? `Provider response omitted: ${missingAssetIds.join(", ")}.` : null);
  const source = sourceStatus(requestEndpoint, retrievedAt, {
    available,
    recordCount: records.length,
    returnedAssetIds,
    missingAssetIds,
    requestUrl,
    reason: sourceReason,
  });
  const status = records.length
    ? missingAssetIds.length || errorReason ? "partial" : "ready"
    : "unavailable";
  return deepFreeze({
    schemaVersion: ASSET_MARKET_SCHEMA_VERSION,
    source: ASSET_MARKET_SOURCE,
    status,
    currency: "usd",
    retrievedAt,
    nativeAsset: nativeTumboState(),
    requestedAssetIds: normalizedAssetIds,
    returnedAssetIds,
    missingAssetIds,
    records,
    sources: [source],
    providerAvailable: available,
    providerUnavailable: !available,
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
    capabilities: ASSET_MARKET_CAPABILITIES,
    boundary: ASSET_MARKET_BOUNDARY,
    reason: status === "unavailable"
      ? sourceReason ?? "No CoinGecko peer rows were returned; no market data was fabricated."
      : null,
  });
}

export function replayAssetMarketEvidence(snapshot, recordId = null, method = "local-replay") {
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  const record = records.find((candidate) => candidate?.id === recordId) ?? records[0] ?? null;
  return deepFreeze({
    schemaVersion: ASSET_MARKET_SCHEMA_VERSION,
    source: ASSET_MARKET_REPLAY_SOURCE,
    action: "replay",
    method: text(method, "local-replay"),
    recordId: record?.id ?? null,
    record,
    recordCount: records.length,
    nativeAsset: snapshot?.nativeAsset ?? nativeTumboState(),
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
    boundary: ASSET_MARKET_BOUNDARY,
  });
}

export function summarizeAssetMarketEvidence(input = null) {
  const value = isRecord(input) ? input : createUnavailableAssetMarketEvidence();
  const records = Array.isArray(value.records) ? value.records : [];
  const sources = Array.isArray(value.sources) ? value.sources : [];
  const requestedAssetIds = normalizeAssetIds(value.requestedAssetIds);
  const returnedAssetIds = records.map((record) => record?.assetId).filter(Boolean);
  return deepFreeze({
    schemaVersion: ASSET_MARKET_SCHEMA_VERSION,
    source: ASSET_MARKET_SOURCE,
    status: text(value.status, records.length ? "ready" : "unavailable"),
    currency: text(value.currency, "usd"),
    retrievedAt: timestamp(value.retrievedAt),
    nativeAsset: value.nativeAsset ?? nativeTumboState(),
    requestedAssetIds,
    returnedAssetIds,
    missingAssetIds: requestedAssetIds.filter((id) => !returnedAssetIds.includes(id)),
    records,
    sources,
    recordCount: records.length,
    completeRecordCount: records.filter((record) => ["A", "B"].includes(record?.dataCompletenessGrade)).length,
    availableProviderCount: sources.filter((source) => source?.available === true).length,
    providerCount: sources.length,
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
    capabilities: value.capabilities ?? ASSET_MARKET_CAPABILITIES,
    boundary: text(value.boundary, ASSET_MARKET_BOUNDARY),
    reason: text(value.reason, records.length ? null : "No CoinGecko market rows are available; no data was fabricated."),
  });
}

export default fetchAssetMarketEvidence;
