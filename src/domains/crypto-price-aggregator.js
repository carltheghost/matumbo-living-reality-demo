/**
 * Multi-source crypto price adapter and demo exchange-price calculator.
 *
 * External providers are read-only evidence sources. The demo never places
 * orders, signs transactions, holds custody, or settles real assets.
 * The exchange price is our deterministic local calculation from the
 * provider observations; it is not presented as an authoritative price.
 */

export const CRYPTO_PRICE_SCHEMA_VERSION = 1;
export const CRYPTO_PRICE_MAX_SOURCES = 8;
export const CRYPTO_PRICE_DEFAULT_SPREAD_BPS = 20;

const SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "coinbase",
    provider: "Coinbase",
    kind: "exchange-api",
    buildUrl: (symbol) => `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`,
    parse: (payload) => Number(payload?.data?.amount),
  }),
  Object.freeze({
    id: "kraken",
    provider: "Kraken",
    kind: "exchange-api",
    buildUrl: (symbol) => {
      const pair = symbol === "BTC" ? "XBTUSD" : `${symbol}USD`;
      return `https://api.kraken.com/0/public/Ticker?pair=${pair}`;
    },
    parse: (payload) => {
      const row = Object.values(payload?.result ?? {})[0];
      return Number(row?.c?.[0]);
    },
  }),
  Object.freeze({
    id: "bitstamp",
    provider: "Bitstamp",
    kind: "exchange-api",
    buildUrl: (symbol) => `https://www.bitstamp.net/api/v2/ticker/${symbol.toLowerCase()}usd/`,
    parse: (payload) => Number(payload?.last),
  }),
  Object.freeze({
    id: "binance",
    provider: "Binance",
    kind: "exchange-api",
    buildUrl: (symbol) => `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`,
    parse: (payload) => Number(payload?.price),
  }),
]);

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "").trim().toUpperCase();
}

function sourceStatus(source, price, error = null) {
  return Object.freeze({
    id: source.id,
    provider: source.provider,
    kind: source.kind,
    available: price !== null,
    price,
    error,
  });
}

export function calculateExchangePrice(observations, {
  spreadBps = CRYPTO_PRICE_DEFAULT_SPREAD_BPS,
  minSources = 2,
} = {}) {
  const valid = observations
    .map((entry) => ({ ...entry, price: finitePositive(entry?.price) }))
    .filter((entry) => entry.price !== null);

  if (valid.length < Math.max(1, Number(minSources) || 1)) {
    return Object.freeze({
      status: "insufficient-sources",
      sourceCount: valid.length,
      referencePrice: null,
      exchangePrice: null,
      bid: null,
      ask: null,
      spreadBps: Number(spreadBps) || 0,
      method: "median",
    });
  }

  const prices = valid.map((entry) => entry.price);
  const ordered = [...prices].sort((a, b) => a - b);
  const referencePrice = median(prices);

  // Reject extreme provider outliers before deriving our local quote.
  const q1 = percentile(ordered, 0.25);
  const q3 = percentile(ordered, 0.75);
  const iqr = q3 - q1;
  const lower = iqr > 0 ? q1 - 1.5 * iqr : q1;
  const upper = iqr > 0 ? q3 + 1.5 * iqr : q3;
  const inliers = valid.filter(({ price }) => price >= lower && price <= upper);
  const exchangePrice = median(inliers.map(({ price }) => price)) ?? referencePrice;
  const safeSpread = Math.max(0, Number(spreadBps) || 0) / 10_000;
  const bid = exchangePrice * (1 - safeSpread / 2);
  const ask = exchangePrice * (1 + safeSpread / 2);

  return Object.freeze({
    status: "ready",
    sourceCount: valid.length,
    inlierCount: inliers.length,
    referencePrice,
    exchangePrice,
    bid,
    ask,
    spreadBps: Number(spreadBps) || 0,
    method: "median-after-iqr-outlier-filter",
    sources: Object.freeze(valid.map(({ id, provider, price }) =>
      Object.freeze({ id, provider, price })
    )),
  });
}

export async function collectCryptoPrices({
  symbol,
  fetchImpl = globalThis.fetch,
  sources = SOURCE_DEFINITIONS,
  timeoutMs = 5_000,
} = {}) {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) throw new Error("A crypto symbol is required.");
  if (typeof fetchImpl !== "function") {
    return Object.freeze({
      schemaVersion: CRYPTO_PRICE_SCHEMA_VERSION,
      symbol: normalizedSymbol,
      status: "unavailable",
      observations: [],
      quote: calculateExchangePrice([]),
      sourceCount: 0,
    });
  }

  const selected = sources.slice(0, CRYPTO_PRICE_MAX_SOURCES);
  const observations = await Promise.all(selected.map(async (source) => {
    let timer = null;
    let controller = null;
    try {
      if (typeof AbortController === "function") {
        controller = new AbortController();
        timer = setTimeout(() => controller.abort(), timeoutMs);
      }
      const response = await fetchImpl(source.buildUrl(normalizedSymbol), {
        method: "GET",
        headers: { accept: "application/json" },
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response?.ok) throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
      const payload = await response.json();
      const price = finitePositive(source.parse(payload));
      if (price === null) throw new Error("Provider returned no usable price.");
      return sourceStatus(source, price);
    } catch (error) {
      return sourceStatus(source, null, String(error?.message ?? error).slice(0, 160));
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }));

  const quote = calculateExchangePrice(observations);
  return Object.freeze({
    schemaVersion: CRYPTO_PRICE_SCHEMA_VERSION,
    symbol: normalizedSymbol,
    status: quote.status,
    collectedAt: new Date().toISOString(),
    observations: Object.freeze(observations),
    quote,
    sourceCount: observations.filter((entry) => entry.available).length,
    boundary: "Read-only public exchange APIs feed a local demo calculation; no orders, custody, signing, transfer, or settlement are active.",
  });
}

export function listCryptoPriceSources() {
  return SOURCE_DEFINITIONS.map(({ id, provider, kind }) => Object.freeze({ id, provider, kind }));
}
