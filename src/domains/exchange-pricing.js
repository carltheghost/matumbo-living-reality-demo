/**
 * Live exchange pricing engine.
 * Spot pricing is isolated from the prediction-contract domain.
 */
export const EXCHANGE_PRICING_VERSION = 1;
export const EXCHANGE_PRICING_ASSETS = Object.freeze([
  Object.freeze({ id: "bitcoin", symbol: "BTC", label: "Bitcoin" }),
  Object.freeze({ id: "ethereum", symbol: "ETH", label: "Ethereum" }),
  Object.freeze({ id: "solana", symbol: "SOL", label: "Solana" }),
  Object.freeze({ id: "xrp", symbol: "XRP", label: "XRP" }),
  Object.freeze({ id: "cardano", symbol: "ADA", label: "Cardano" }),
  Object.freeze({ id: "dogecoin", symbol: "DOGE", label: "Dogecoin" }),
  Object.freeze({ id: "avalanche", symbol: "AVAX", label: "Avalanche" }),
  Object.freeze({ id: "chainlink", symbol: "LINK", label: "Chainlink" }),
  Object.freeze({ id: "polkadot", symbol: "DOT", label: "Polkadot" }),
  Object.freeze({ id: "litecoin", symbol: "LTC", label: "Litecoin" }),
  Object.freeze({ id: "bitcoin-cash", symbol: "BCH", label: "Bitcoin Cash" }),
  Object.freeze({ id: "uniswap", symbol: "UNI", label: "Uniswap" }),
  Object.freeze({ id: "stellar", symbol: "XLM", label: "Stellar" }),
  Object.freeze({ id: "cosmos", symbol: "ATOM", label: "Cosmos" }),
  Object.freeze({ id: "ethereum-classic", symbol: "ETC", label: "Ethereum Classic" }),
  Object.freeze({ id: "near-protocol", symbol: "NEAR", label: "NEAR Protocol" }),
  Object.freeze({ id: "filecoin", symbol: "FIL", label: "Filecoin" }),
  Object.freeze({ id: "algorand", symbol: "ALGO", label: "Algorand" }),
  Object.freeze({ id: "internet-computer", symbol: "ICP", label: "Internet Computer" }),
  Object.freeze({ id: "hedera-hashgraph", symbol: "HBAR", label: "Hedera" }),
  Object.freeze({ id: "vechain", symbol: "VET", label: "VeChain" }),
  Object.freeze({ id: "the-sandbox", symbol: "SAND", label: "The Sandbox" }),
  Object.freeze({ id: "decentraland", symbol: "MANA", label: "Decentraland" }),
  Object.freeze({ id: "aave", symbol: "AAVE", label: "Aave" }),
  Object.freeze({ id: "maker", symbol: "MKR", label: "Maker" }),
  Object.freeze({ id: "synthetix-network-token", symbol: "SNX", label: "Synthetix" }),
  Object.freeze({ id: "curve-dao-token", symbol: "CRV", label: "Curve" }),
  Object.freeze({ id: "optimism", symbol: "OP", label: "Optimism" }),
  Object.freeze({ id: "arbitrum", symbol: "ARB", label: "Arbitrum" }),
  Object.freeze({ id: "injective-protocol", symbol: "INJ", label: "Injective" }),
  Object.freeze({ id: "sui", symbol: "SUI", label: "Sui" }),
  Object.freeze({ id: "sei-network", symbol: "SEI", label: "Sei" }),
  Object.freeze({ id: "pepe", symbol: "PEPE", label: "Pepe" }),
  Object.freeze({ id: "shiba-inu", symbol: "SHIB", label: "Shiba Inu" }),
  Object.freeze({ id: "tron", symbol: "TRX", label: "TRON" }),
  Object.freeze({ id: "the-open-network", symbol: "TON", label: "Toncoin" }),
  Object.freeze({ id: "monero", symbol: "XMR", label: "Monero" }),
  Object.freeze({ id: "aptos", symbol: "APT", label: "Aptos" }),
  Object.freeze({ id: "celestia", symbol: "TIA", label: "Celestia" }),
  Object.freeze({ id: "bonk", symbol: "BONK", label: "Bonk" }),
  Object.freeze({ id: "floki", symbol: "FLOKI", label: "FLOKI" }),
  Object.freeze({ id: "eos", symbol: "EOS", label: "EOS" }),
  Object.freeze({ id: "tezos", symbol: "XTZ", label: "Tezos" }),
  Object.freeze({ id: "zcash", symbol: "ZEC", label: "Zcash" })
]);

const SOURCES = Object.freeze([
  Object.freeze({ id: "coinbase", label: "Coinbase", base: "https://api.exchange.coinbase.com" }),
  Object.freeze({ id: "kraken", label: "Kraken", base: "https://api.kraken.com" }),
  Object.freeze({ id: "bitstamp", label: "Bitstamp", base: "https://www.bitstamp.net" }),
  Object.freeze({ id: "binance", label: "Binance", base: "https://api.binance.com" }),
]);

const median = (values) => {
  const a = [...values].sort((x,y) => x-y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
};
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const stableUsd = (currency) => currency === "USD" || currency === "USDT" || currency === "USDC" ? 1 : null;
const iso = (value) => {
  const d = value ? new Date(value) : new Date();
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
};

function normalizeObservation(source, asset, price, quoteCurrency, observedAt) {
  const raw = num(price);
  const conversion = stableUsd(quoteCurrency);
  if (!asset || raw === null || raw <= 0 || conversion === null) return null;
  return Object.freeze({
    sourceId: source.id, source: source.label, assetId: asset.id, symbol: asset.symbol,
    rawPrice: raw, quoteCurrency, quoteToUsd: conversion, priceUsd: raw * conversion, observedAt: iso(observedAt),
  });
}

async function json(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, signal });
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
  return response.json();
}

async function mapLimit(items, limit, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { result[index] = await worker(items[index]); } catch { result[index] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, run));
  return result;
}

const pairFor = {
  BTC:"XBTUSD",ETH:"ETHUSD",SOL:"SOLUSD",XRP:"XRPUSD",ADA:"ADAUSD",DOGE:"DOGEUSD",AVAX:"AVAXUSD",LINK:"LINKUSD",
  DOT:"DOTUSD",LTC:"LTCUSD",BCH:"BCHUSD",UNI:"UNIUSD",XLM:"XLMUSD",ATOM:"ATOMUSD",ETC:"ETCUSD",NEAR:"NEARUSD",
  FIL:"FILUSD",ALGO:"ALGOUSD",ICP:"ICPUSD",HBAR:"HBARUSD",VET:"VETUSD",SAND:"SANDUSD",MANA:"MANAUSD",AAVE:"AAVEUSD",
  MKR:"MKRUSD",SNX:"SNXUSD",CRV:"CRVUSD",OP:"OPUSD",ARB:"ARBUSD",INJ:"INJUSD",SUI:"SUIUSD",SEI:"SEIUSD",PEPE:"PEPEUSD",
  SHIB:"SHIBUSD",TRX:"TRXUSD",TON:"TONUSD",XMR:"XMRUSD",APT:"APTUSD",TIA:"TIAUSD",BONK:"BONKUSD",FLOKI:"FLOKIUSD",
  EOS:"EOSUSD",XTZ:"XTZUSD",ZEC:"ZECUSD"
};
const assetMap = new Map(EXCHANGE_PRICING_ASSETS.map(x => [x.symbol, x]));
const source = {
  coinbase:{id:"coinbase",label:"Coinbase",base:"https://api.exchange.coinbase.com"},
  kraken:{id:"kraken",label:"Kraken",base:"https://api.kraken.com"},
  bitstamp:{id:"bitstamp",label:"Bitstamp",base:"https://www.bitstamp.net"},
  binance:{id:"binance",label:"Binance",base:"https://api.binance.com"}
};

async function coinbase(fetchImpl, assets, signal) {
  return (await mapLimit(assets, 8, async asset => {
    const row = await json(fetchImpl, `${source.coinbase.base}/products/${asset.symbol}-USD/ticker`, signal);
    return normalizeObservation(source.coinbase, asset, row?.price, "USD", row?.time);
  })).filter(Boolean);
}
async function bitstamp(fetchImpl, assets, signal) {
  return (await mapLimit(assets, 8, async asset => {
    const row = await json(fetchImpl, `${source.bitstamp.base}/api/v2/ticker/${asset.symbol.toLowerCase()}usd/`, signal);
    return normalizeObservation(source.bitstamp, asset, row?.last, "USD", row?.timestamp ? Number(row.timestamp)*1000 : null);
  })).filter(Boolean);
}
async function kraken(fetchImpl, assets, signal) {
  const pairs = assets.map(x => pairFor[x.symbol]).filter(Boolean).join(",");
  const payload = await json(fetchImpl, `${source.kraken.base}/0/public/Ticker?pair=${encodeURIComponent(pairs)}`, signal);
  const result = payload?.result ?? {};
  return assets.map(asset => {
    const pair = pairFor[asset.symbol];
    const key = Object.keys(result).find(k => k === pair || k.replace("/","") === pair);
    return normalizeObservation(source.kraken, asset, key ? result[key]?.c?.[0] : null, "USD");
  }).filter(Boolean);
}
async function binance(fetchImpl, assets, signal) {
  const payload = await json(fetchImpl, `${source.binance.base}/api/v3/ticker/price`, signal);
  const wanted = new Map(assets.map(asset => [`${asset.symbol}USDT`, asset]));
  return (Array.isArray(payload) ? payload : []).map(row => normalizeObservation(source.binance, wanted.get(row?.symbol), row?.price, "USDT")).filter(Boolean);
}

function filterOutliers(observations) {
  const center = median(observations.map(x => x.priceUsd));
  if (center === null) return { kept: [], rejected: [], median: null, mad: null, threshold: null };
  const mad = median(observations.map(x => Math.abs(x.priceUsd - center))) ?? 0;
  const threshold = Math.max(center * 0.02, mad * 3);
  const kept = observations.filter(x => Math.abs(x.priceUsd - center) <= threshold);
  return { kept, rejected: observations.filter(x => !kept.includes(x)), median: center, mad, threshold };
}

function quoteFor(asset, observations) {
  const filtered = filterOutliers(observations);
  const referencePriceUsd = median(filtered.kept.map(x => x.priceUsd));
  const venueSpreadUsd = filtered.kept.length ? Math.max(...filtered.kept.map(x=>x.priceUsd)) - Math.min(...filtered.kept.map(x=>x.priceUsd)) : null;
  const halfSpread = referencePriceUsd === null ? null : Math.max(referencePriceUsd * 0.0015, (venueSpreadUsd ?? 0) * 0.35);
  const sourceIds = [...new Set(filtered.kept.map(x => x.sourceId))];
  return Object.freeze({
    id:`exchange:${asset.symbol.toLowerCase()}`, assetId:asset.id, symbol:asset.symbol, name:asset.label, currency:"USD",
    observations:Object.freeze(observations), acceptedObservations:Object.freeze(filtered.kept), rejectedObservations:Object.freeze(filtered.rejected),
    sourceIds:Object.freeze(sourceIds), sourceCount:sourceIds.length, sourcesExpected:4,
    referencePriceUsd, bidUsd:referencePriceUsd === null ? null : referencePriceUsd-halfSpread,
    askUsd:referencePriceUsd === null ? null : referencePriceUsd+halfSpread,
    spreadUsd:referencePriceUsd === null ? null : halfSpread*2, venueSpreadUsd,
    outlierCount:filtered.rejected.length, updatedAt:observations.length ? observations.map(x=>x.observedAt).sort().at(-1) : null,
    status:referencePriceUsd === null ? "unavailable" : sourceIds.length === 4 ? "healthy" : "partial",
    priceMethod:"median-after-outlier-filter"
  });
}

export function createUnavailableExchangeBoard(reason = "No live exchange observations are loaded.") {
  return Object.freeze({
    version:EXCHANGE_PRICING_VERSION, status:"unavailable", retrievedAt:new Date().toISOString(),
    sources:SOURCES.map(x=>Object.freeze({...x,status:"unavailable",reason})),
    assets:EXCHANGE_PRICING_ASSETS.map(x=>quoteFor(x,[])), assetCount:EXCHANGE_PRICING_ASSETS.length,
    healthyAssetCount:0, partialAssetCount:0, unavailableAssetCount:EXCHANGE_PRICING_ASSETS.length,
    boundary:"Spot exchange pricing only. Prediction contracts are maintained by a separate adapter-driven domain."
  });
}

export async function fetchExchangeBoard({ fetchImpl=globalThis.fetch, timeoutMs=12000 } = {}) {
  if (typeof fetchImpl !== "function") return createUnavailableExchangeBoard("Browser fetch is unavailable.");
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const assets = EXCHANGE_PRICING_ASSETS;
  const jobs = [coinbase(fetchImpl,assets,controller?.signal),kraken(fetchImpl,assets,controller?.signal),bitstamp(fetchImpl,assets,controller?.signal),binance(fetchImpl,assets,controller?.signal)];
  const results = await Promise.allSettled(jobs);
  if (timer) clearTimeout(timer);
  const all = results.flatMap(x => x.status === "fulfilled" ? x.value : []);
  const assetsWithQuotes = assets.map(asset => quoteFor(asset, all.filter(x=>x.assetId===asset.id)));
  const sources = [
    [source.coinbase,results[0]],[source.kraken,results[1]],[source.bitstamp,results[2]],[source.binance,results[3]]
  ].map(([src,result]) => Object.freeze({
    ...src,status:result.status==="fulfilled"?"ready":"unavailable",
    observationCount:result.status==="fulfilled"?result.value.length:0,
    error:result.status==="rejected"?String(result.reason?.message??result.reason):null
  }));
  return Object.freeze({
    version:EXCHANGE_PRICING_VERSION,status:assetsWithQuotes.some(x=>x.referencePriceUsd!==null)?"ready":"unavailable",
    retrievedAt:new Date().toISOString(),sourceCount:4,sources:Object.freeze(sources),assets:Object.freeze(assetsWithQuotes),
    assetCount:44,healthyAssetCount:assetsWithQuotes.filter(x=>x.status==="healthy").length,
    partialAssetCount:assetsWithQuotes.filter(x=>x.status==="partial").length,unavailableAssetCount:assetsWithQuotes.filter(x=>x.status==="unavailable").length,
    boundary:"Spot exchange pricing only. Prediction contracts are maintained by a separate adapter-driven domain."
  });
}

export const summarizeExchangeBoard = (board) => board ?? createUnavailableExchangeBoard();
