/**
 * Top-20 crypto exchange catalog.
 *
 * This is a market/catalog layer, not custody or a real-money exchange.
 * Provider prices and ranks are read separately through asset-market.js.
 * No wallet, signing, settlement, or external order execution is exposed.
 */
export const CRYPTO_EXCHANGE_CATALOG_VERSION = 1;
export const CRYPTO_EXCHANGE_SOURCE = "top20-crypto-market-catalog";
export const CRYPTO_EXCHANGE_BOUNDARY =
  "Top-20 crypto assets are exposed as simulated exchange/catalog instruments. Public market evidence may be refreshed separately; this demo has no wallet, custody, signing, withdrawal, deposit, or real-money settlement.";

export const TOP_20_CRYPTO_ASSETS = Object.freeze([
  ["bitcoin","BTC","Bitcoin"],["ethereum","ETH","Ethereum"],["tether","USDT","Tether"],
  ["binancecoin","BNB","BNB"],["ripple","XRP","XRP"],["usd-coin","USDC","USD Coin"],
  ["solana","SOL","Solana"],["tron","TRX","TRON"],["zcash","ZEC","Zcash"],
  ["figure-heloc","FIGR_HELOC","Figure Heloc"],["hyperliquid","HYPE","Hyperliquid"],
  ["dogecoin","DOGE","Dogecoin"],["monero","XMR","Monero"],["rain","RAIN","Rain"],
  ["whitebit-token","WBT","WhiteBIT Coin"],["usds","USDS","USDS"],
  ["chainlink","LINK","Chainlink"],["cardano","ADA","Cardano"],
  ["leo-token","LEO","LEO Token"],["stellar","XLM","Stellar"],
].map(([id,symbol,name], index) => Object.freeze({
  rank: index + 1, id, symbol, name, enabled: true,
  quoteAssets: Object.freeze(["USDT","USDC"]),
  tradingMode: "simulated",
  custody: false, settlement: false, executable: false,
})));

export const TOP_20_CRYPTO_IDS = Object.freeze(TOP_20_CRYPTO_ASSETS.map((asset) => asset.id));

export function createCryptoExchangeCatalogContribution({ updatedAt = new Date().toISOString() } = {}) {
  return Object.freeze({
    id: "crypto-exchange-top20",
    source: CRYPTO_EXCHANGE_SOURCE,
    schemaVersion: CRYPTO_EXCHANGE_CATALOG_VERSION,
    updatedAt,
    assetCount: TOP_20_CRYPTO_ASSETS.length,
    assets: TOP_20_CRYPTO_ASSETS,
    quoteAssets: Object.freeze(["USDT","USDC"]),
    capabilities: Object.freeze({
      browse: true,
      marketEvidenceRefresh: true,
      simulatedQuote: true,
      realOrderExecution: false,
      custody: false,
      withdrawal: false,
      deposit: false,
      signing: false,
      settlement: false,
    }),
    boundary: CRYPTO_EXCHANGE_BOUNDARY,
    localOnly: true,
    simulation: true,
    executable: false,
  });
}
