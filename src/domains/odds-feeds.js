/**
 * maTumbo Living Reality Ω
 * Odds Integration
 *
 * Read-only public market-data adapters for Kalshi and Polymarket.
 *
 * IMPORTANT:
 * - These feeds provide informational market probabilities only.
 * - TUMBO contracts remain simulated points.
 * - No wallet, signing, custody, order placement, settlement, or mainnet
 *   functionality exists in this module.
 * - No API keys are accepted or transmitted.
 */

const KALSHI_MARKETS_URL =
  "https://api.elections.kalshi.com/trade-api/v2/markets";

const POLYMARKET_MARKETS_URL =
  "https://gamma-api.polymarket.com/markets";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_QUOTE_AGE_MS = 15 * 60 * 1000;

const SOURCES = Object.freeze({
  KALSHI: "kalshi",
  POLYMARKET: "polymarket",
});

function asObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  return null;
}

function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function clampTimestamp(value) {
  const parsed = parseTimestamp(value);
  return parsed !== null ? new Date(parsed).toISOString() : null;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function getMarketArray(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }

  const object = asObject(raw);

  if (!object) {
    return [];
  }

  if (Array.isArray(object.markets)) {
    return object.markets;
  }

  if (Array.isArray(object.data)) {
    return object.data;
  }

  if (asObject(object.data) && Array.isArray(object.data.markets)) {
    return object.data.markets;
  }

  return [];
}

function uniqueOutcomes(outcomes) {
  const seen = new Set();
  const result = [];

  for (const outcome of outcomes) {
    const name = asNonEmptyString(outcome?.name);
    const price = toFiniteNumber(outcome?.price);

    if (!name || price === null || price <= 0 || price >= 1) {
      continue;
    }

    const key = name.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({
      name,
      price,
    });
  }

  return result;
}

function kalshiPrice(market) {
  const directProbability = toFiniteNumber(
    market?.yes_price ??
      market?.yesPrice ??
      market?.yes_probability ??
      market?.yesProbability
  );

  if (
    directProbability !== null &&
    directProbability > 0 &&
    directProbability < 1
  ) {
    return directProbability;
  }

  const yesBid = toFiniteNumber(market?.yes_bid ?? market?.yesBid);
  const yesAsk = toFiniteNumber(market?.yes_ask ?? market?.yesAsk);

  if (
    yesBid !== null &&
    yesAsk !== null &&
    yesBid >= 0 &&
    yesAsk <= 100 &&
    yesBid <= yesAsk
  ) {
    const midpoint = (yesBid + yesAsk) / 2 / 100;

    if (midpoint > 0 && midpoint < 1) {
      return midpoint;
    }
  }

  const lastPrice = toFiniteNumber(
    market?.last_price ??
      market?.lastPrice ??
      market?.last_trade_price ??
      market?.lastTradePrice
  );

  if (lastPrice !== null && lastPrice > 0 && lastPrice < 1) {
    return lastPrice;
  }

  return null;
}

function polymarketPrice(market) {
  const object = asObject(market);

  if (!object) {
    return null;
  }

  const directPrice = toFiniteNumber(
    object.lastTradePrice ??
      object.last_trade_price ??
      object.lastPrice ??
      object.bestBid
  );

  if (directPrice !== null && directPrice > 0 && directPrice < 1) {
    return directPrice;
  }

  const outcomePrices = parseMaybeJson(
    object.outcomePrices ?? object.outcome_prices
  );

  if (Array.isArray(outcomePrices)) {
    for (const rawPrice of outcomePrices) {
      const price = toFiniteNumber(rawPrice);

      if (price !== null && price > 0 && price < 1) {
        return price;
      }
    }
  }

  return null;
}

function kalshiQuestion(market) {
  return asNonEmptyString(
    market?.title ?? market?.question ?? market?.name ?? market?.ticker
  );
}

function polymarketQuestion(market) {
  return asNonEmptyString(
    market?.question ?? market?.title ?? market?.name ?? market?.slug
  );
}

function normalizeKalshiMarket(market) {
  const object = asObject(market);

  if (!object) {
    return null;
  }

  const marketId = asNonEmptyString(
    object.ticker ?? object.id ?? object.market_id
  );
  const question = kalshiQuestion(object);
  const price = kalshiPrice(object);

  if (!marketId || !question || price === null) {
    return null;
  }

  const updatedAt = clampTimestamp(
    object.updated_time ??
      object.updatedTime ??
      object.last_updated_time ??
      object.lastUpdatedAt ??
      object.close_time ??
      object.closeTime
  );

  return {
    marketId,
    question,
    outcomes: uniqueOutcomes([
      { name: "Yes", price },
      { name: "No", price: 1 - price },
    ]),
    updatedAt,
    source: SOURCES.KALSHI,
  };
}

function polymarketOutcomes(market) {
  const object = asObject(market);
  const outcomes = [];

  if (!object) {
    return outcomes;
  }

  const names = parseMaybeJson(object.outcomes ?? object.outcomeNames);
  const prices = parseMaybeJson(object.outcomePrices ?? object.outcome_prices);

  if (Array.isArray(names) && Array.isArray(prices)) {
    const count = Math.min(names.length, prices.length);

    for (let index = 0; index < count; index += 1) {
      outcomes.push({
        name: names[index],
        price: prices[index],
      });
    }

    return outcomes;
  }

  const singlePrice = polymarketPrice(object);

  if (singlePrice !== null) {
    outcomes.push({ name: "Yes", price: singlePrice });
  }

  return outcomes;
}

function normalizePolymarketMarket(market) {
  const object = asObject(market);

  if (!object) {
    return null;
  }

  const marketId = asNonEmptyString(
    object.id ?? object.conditionId ?? object.condition_id ?? object.slug
  );
  const question = polymarketQuestion(object);
  const outcomes = uniqueOutcomes(polymarketOutcomes(object));

  if (!marketId || !question || outcomes.length === 0) {
    return null;
  }

  const updatedAt = clampTimestamp(
    object.updatedAt ??
      object.updated_at ??
      object.updatedTime ??
      object.lastUpdated ??
      object.endDate ??
      object.end_date
  );

  return {
    marketId,
    question,
    outcomes,
    updatedAt,
    source: SOURCES.POLYMARKET,
  };
}

function normalizeOddsMarkets(raw, source) {
  const markets = getMarketArray(raw);
  const normalized = [];

  for (const market of markets) {
    let entry = null;

    if (source === SOURCES.KALSHI) {
      entry = normalizeKalshiMarket(market);
    } else if (source === SOURCES.POLYMARKET) {
      entry = normalizePolymarketMarket(market);
    } else {
      console.warn("Unknown odds source; skipping normalization:", source);
      return [];
    }

    if (entry) {
      normalized.push(entry);
    }
  }

  return normalized;
}

async function fetchJson({ fetch, url, timeoutMs }) {
  const effectiveFetch = fetch;
  const effectiveTimeout =
    typeof timeoutMs === "number" && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_TIMEOUT_MS;

  if (typeof effectiveFetch !== "function") {
    throw new Error("A fetch function is required to read public odds.");
  }

  const controller = new AbortController();
  let timeoutId = null;

  try {
    timeoutId = setTimeout(
      () => controller.abort(),
      effectiveTimeout
    );

    const response = await effectiveFetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response || typeof response.ok !== "boolean") {
      throw new Error("Odds feed returned an unreadable response.");
    }

    if (!response.ok) {
      const status =
        typeof response.status === "number" ? response.status : "unknown";
      throw new Error(`Odds feed HTTP failure: ${status}`);
    }

    return await response.json();
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`Odds feed request timed out: ${url}`);
    }

    throw error;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

async function fetchKalshiOdds({ fetch, timeoutMs } = {}) {
  try {
    const raw = await fetchJson({
      fetch,
      url: KALSHI_MARKETS_URL,
      timeoutMs,
    });
    const markets = normalizeOddsMarkets(raw, SOURCES.KALSHI);

    if (markets.length === 0) {
      return createUnavailableOdds("Kalshi returned no usable markets.");
    }

    return {
      available: true,
      markets,
      source: SOURCES.KALSHI,
      reason: null,
    };
  } catch (error) {
    console.warn("Kalshi odds feed unavailable:", error?.message ?? error);
    return createUnavailableOdds("Kalshi odds feed unavailable.");
  }
}

async function fetchPolymarketOdds({ fetch, timeoutMs } = {}) {
  const url = `${POLYMARKET_MARKETS_URL}?active=true&closed=false&limit=500&offset=0`;

  try {
    const raw = await fetchJson({ fetch, url, timeoutMs });
    const markets = normalizeOddsMarkets(raw, SOURCES.POLYMARKET);

    if (markets.length === 0) {
      return createUnavailableOdds("Polymarket returned no usable markets.");
    }

    return {
      available: true,
      markets,
      source: SOURCES.POLYMARKET,
      reason: null,
    };
  } catch (error) {
    console.warn("Polymarket odds feed unavailable:", error?.message ?? error);
    return createUnavailableOdds("Polymarket odds feed unavailable.");
  }
}

function createUnavailableOdds(reason) {
  return {
    available: false,
    marketId: null,
    question: null,
    outcomes: [],
    updatedAt: null,
    source: null,
    reason: asNonEmptyString(reason) ?? "Odds unavailable.",
  };
}

function isFreshQuote(quote, now) {
  const object = asObject(quote);

  if (!object) {
    return false;
  }

  const nowMs =
    typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  const updatedMs = parseTimestamp(object.updatedAt);

  if (updatedMs === null) {
    return false;
  }

  if (updatedMs > nowMs) {
    return false;
  }

  return nowMs - updatedMs <= MAX_QUOTE_AGE_MS;
}

function validateQuoteShape(quote) {
  const object = asObject(quote);

  if (!object) {
    return false;
  }

  if (!asNonEmptyString(object.marketId)) {
    return false;
  }

  if (!asNonEmptyString(object.question)) {
    return false;
  }

  if (!asNonEmptyString(object.outcome)) {
    return false;
  }

  const price = toFiniteNumber(object.price);

  if (price === null || price <= 0 || price >= 1) {
    return false;
  }

  if (!asNonEmptyString(object.source)) {
    return false;
  }

  if (parseTimestamp(object.updatedAt) === null) {
    return false;
  }

  return true;
}

function quoteFromMarket(market, outcomeName) {
  const object = asObject(market);

  if (!object || !Array.isArray(object.outcomes)) {
    return null;
  }

  const wanted = asNonEmptyString(outcomeName);
  const outcome = object.outcomes.find((entry) => {
    if (!wanted) {
      return true;
    }

    return (
      asNonEmptyString(entry?.name)?.toLowerCase() === wanted.toLowerCase()
    );
  });

  if (!outcome) {
    return null;
  }

  const price = toFiniteNumber(outcome.price);

  if (price === null || price <= 0 || price >= 1) {
    return null;
  }

  return {
    marketId: object.marketId ?? null,
    question: object.question ?? null,
    outcome: outcome.name,
    price,
    updatedAt: object.updatedAt ?? null,
    source: object.source ?? null,
    unit: "TUMBO_POINTS",
    simulated: true,
    realMoney: false,
  };
}

function extractGameText(game) {
  const object = asObject(game);

  if (!object) {
    return "";
  }

  const parts = [
    object.title,
    object.name,
    object.event,
    object.eventName,
    object.home,
    object.homeTeam,
    object.home_team,
    object.away,
    object.awayTeam,
    object.away_team,
    object.description,
  ];

  return parts
    .filter((part) => typeof part === "string" && part.trim() !== "")
    .join(" ");
}

function tokenize(text) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function gameTeamNames(game) {
  const object = asObject(game);

  if (!object) {
    return [];
  }

  const names = [
    object.home,
    object.homeTeam,
    object.home_team,
    object.away,
    object.awayTeam,
    object.away_team,
  ];

  return names.filter(
    (name) => typeof name === "string" && name.trim().length > 0
  );
}

function matchMarketToGame(markets, game) {
  if (!Array.isArray(markets) || markets.length === 0) {
    return null;
  }

  const gameText = extractGameText(game);
  const gameTokens = new Set(tokenize(gameText));

  if (gameTokens.size === 0) {
    return null;
  }

  const teams = gameTeamNames(game).map((name) => name.toLowerCase());
  let best = null;
  let bestScore = 0;

  for (const market of markets) {
    const question = asNonEmptyString(market?.question);

    if (!question) {
      continue;
    }

    const questionTokens = new Set(tokenize(question));
    let overlap = 0;

    for (const token of gameTokens) {
      if (questionTokens.has(token)) {
        overlap += 1;
      }
    }

    if (overlap === 0) {
      continue;
    }

    let teamHits = 0;

    for (const team of teams) {
      if (team && question.toLowerCase().includes(team)) {
        teamHits += 1;
      }
    }

    const score = overlap + teamHits * 3;

    if (score > bestScore) {
      bestScore = score;
      best = market;
    }
  }

  if (!best || bestScore < 2) {
    return null;
  }

  return best;
}

function attachOddsToDraft(draft, odds) {
  const draftObject = asObject(draft) ?? {};
  const oddsObject = asObject(odds) ?? {};
  const markets = Array.isArray(oddsObject.markets) ? oddsObject.markets : [];

  const base = {
    ...draftObject,
    oddsQuote: null,
    oddsUnavailable:
      asNonEmptyString(oddsObject.reason) ?? "No market matched this draft.",
  };

  if (markets.length === 0) {
    return base;
  }

  const market = matchMarketToGame(markets, draftObject.game ?? draftObject);

  if (!market) {
    return base;
  }

  const quote = quoteFromMarket(
    market,
    oddsObject.outcome ?? draftObject.predictedOutcome ?? null
  );

  if (!quote) {
    return base;
  }

  if (!validateQuoteShape(quote)) {
    console.warn("Rejected malformed odds quote for draft.");
    return {
      ...base,
      oddsUnavailable: "Rejected malformed odds quote.",
    };
  }

  if (!isFreshQuote(quote, Date.now())) {
    console.warn("Rejected stale odds quote for draft.");
    return {
      ...base,
      oddsUnavailable: "Rejected stale odds quote.",
    };
  }

  return {
    ...draftObject,
    oddsQuote: quote,
    oddsUnavailable: null,
  };
}

export {
  attachOddsToDraft,
  createUnavailableOdds,
  fetchKalshiOdds,
  fetchPolymarketOdds,
  isFreshQuote,
  matchMarketToGame,
  normalizeOddsMarkets,
  validateQuoteShape,
};

export const ODDS_CONSTANTS = Object.freeze({
  KALSHI_MARKETS_URL,
  POLYMARKET_MARKETS_URL,
  MAX_QUOTE_AGE_MS,
  DEFAULT_TIMEOUT_MS,
});
