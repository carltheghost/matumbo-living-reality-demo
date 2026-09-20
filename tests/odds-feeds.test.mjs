import test from "node:test";
import assert from "node:assert/strict";
import {
  attachOddsToDraft,
  createUnavailableOdds,
  fetchKalshiOdds,
  fetchPolymarketOdds,
  isFreshQuote,
  matchMarketToGame,
  normalizeOddsMarkets,
  validateQuoteShape,
} from "../src/domains/odds-feeds.js";

function makeResponse({ ok = true, status = 200, json }) {
  return {
    ok,
    status,
    json: async () => json,
  };
}

function makeFetch(handler) {
  const calls = [];

  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (options.signal?.aborted) {
      const error = new Error("Aborted");
      error.name = "AbortError";
      throw error;
    }

    return handler({ url, options, calls });
  };

  fakeFetch.calls = calls;
  return fakeFetch;
}

const NOW = 1_800_000_000_000;

function freshQuote(overrides = {}) {
  return {
    marketId: "KALSHI-1",
    question: "Will the Springfield Isotopes win?",
    outcome: "Yes",
    price: 0.62,
    updatedAt: new Date(NOW - 60_000).toISOString(),
    source: "kalshi",
    ...overrides,
  };
}

test("fetchKalshiOdds normalizes public markets with a fake fetch", async () => {
  const fakeFetch = makeFetch(() =>
    makeResponse({
      json: {
        markets: [
          {
            ticker: "ISOTOPES-WIN",
            title: "Will the Springfield Isotopes win?",
            yes_price: 62,
            yes_bid: 60,
            yes_ask: 64,
            updated_time: "2026-09-20T17:30:00.000Z",
          },
        ],
      },
    })
  );

  const result = await fetchKalshiOdds({ fetch: fakeFetch, timeoutMs: 1000 });

  assert.equal(result.available, true);
  assert.equal(result.source, "kalshi");
  assert.equal(result.markets.length, 1);
  assert.equal(result.markets[0].marketId, "ISOTOPES-WIN");
  assert.equal(
    result.markets[0].question,
    "Will the Springfield Isotopes win?"
  );
  assert.deepEqual(result.markets[0].outcomes, [
    { name: "Yes", price: 0.62 },
    { name: "No", price: 0.38 },
  ]);
  assert.equal(fakeFetch.calls.length, 1);
  assert.match(fakeFetch.calls[0].url, /\/markets/);
  assert.equal(fakeFetch.calls[0].options.method, "GET");
});

test("fetchKalshiOdds converts HTTP failure into unavailable odds", async () => {
  const fakeFetch = makeFetch(() => makeResponse({ ok: false, status: 503, json: {} }));

  const result = await fetchKalshiOdds({ fetch: fakeFetch });

  assert.equal(result.available, false);
  assert.deepEqual(result.markets ?? result.outcomes, result.outcomes ?? []);
  assert.match(result.reason ?? "", /unavailable/i);
});

test("fetchKalshiOdds converts timeout/abort into unavailable odds", async () => {
  const fakeFetch = makeFetch(() => {
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
  });

  const result = await fetchKalshiOdds({ fetch: fakeFetch, timeoutMs: 5 });

  assert.equal(result.available, false);
  assert.match(result.reason ?? "", /unavailable/i);
});

test("fetchPolymarketOdds normalizes Gamma markets with a fake fetch", async () => {
  const fakeFetch = makeFetch(() =>
    makeResponse({
      json: {
        data: {
          markets: [
            {
              id: "poly-1",
              question: "Will the Shelbyville Sharks win?",
              outcomes: JSON.stringify(["Yes", "No"]),
              outcomePrices: JSON.stringify(["0.41", "0.59"]),
              updatedAt: "2026-09-20T17:45:00.000Z",
            },
          ],
        },
      },
    })
  );

  const result = await fetchPolymarketOdds({ fetch: fakeFetch });

  assert.equal(result.available, true);
  assert.equal(result.source, "polymarket");
  assert.equal(result.markets.length, 1);
  assert.equal(result.markets[0].marketId, "poly-1");
  assert.deepEqual(result.markets[0].outcomes, [
    { name: "Yes", price: 0.41 },
    { name: "No", price: 0.59 },
  ]);
  assert.match(fakeFetch.calls[0].url, /gamma-api\.polymarket\.com/);
});

test("fetchPolymarketOdds returns unavailable when no usable markets exist", async () => {
  const fakeFetch = makeFetch(() => makeResponse({ json: { markets: [] } }));

  const result = await fetchPolymarketOdds({ fetch: fakeFetch });

  assert.equal(result.available, false);
});

test("fetch functions never send keys or credentials", async () => {
  const fakeFetch = makeFetch(() => makeResponse({ json: { markets: [] } }));

  await fetchKalshiOdds({ fetch: fakeFetch });
  await fetchPolymarketOdds({ fetch: fakeFetch });

  for (const call of fakeFetch.calls) {
    assert.equal(call.options.method, "GET");
    assert.ok(!call.options.headers, "no headers should be sent");
    assert.ok(!call.options.body, "no body should be sent");
  }
});

test("normalizeOddsMarkets rejects an unknown source", () => {
  const result = normalizeOddsMarkets({ markets: [] }, "nope");
  assert.deepEqual(result, []);
});

test("createUnavailableOdds builds an honest no-market state", () => {
  const result = createUnavailableOdds("feed down");

  assert.equal(result.available, false);
  assert.equal(result.marketId, null);
  assert.equal(result.question, null);
  assert.deepEqual(result.outcomes, []);
  assert.equal(result.updatedAt, null);
  assert.equal(result.source, null);
  assert.equal(result.reason, "feed down");
});

test("isFreshQuote accepts a recent quote", () => {
  assert.equal(isFreshQuote(freshQuote(), NOW), true);
});

test("isFreshQuote rejects quotes older than 15 minutes", () => {
  const quote = freshQuote({
    updatedAt: new Date(NOW - 16 * 60 * 1000).toISOString(),
  });

  assert.equal(isFreshQuote(quote, NOW), false);
});

test("isFreshQuote rejects future timestamps", () => {
  const quote = freshQuote({
    updatedAt: new Date(NOW + 60_000).toISOString(),
  });

  assert.equal(isFreshQuote(quote, NOW), false);
});

test("isFreshQuote rejects malformed quotes", () => {
  assert.equal(isFreshQuote(null, NOW), false);
  assert.equal(isFreshQuote({}, NOW), false);
  assert.equal(isFreshQuote({ updatedAt: "not-a-date" }, NOW), false);
});

test("validateQuoteShape accepts a well-formed quote", () => {
  assert.equal(validateQuoteShape(freshQuote()), true);
});

test("validateQuoteShape rejects malformed quotes", () => {
  assert.equal(validateQuoteShape(null), false);
  assert.equal(validateQuoteShape({}), false);
  assert.equal(
    validateQuoteShape(freshQuote({ marketId: "" })),
    false
  );
  assert.equal(
    validateQuoteShape(freshQuote({ question: null })),
    false
  );
});

test("validateQuoteShape rejects impossible prices", () => {
  assert.equal(validateQuoteShape(freshQuote({ price: 0 })), false);
  assert.equal(validateQuoteShape(freshQuote({ price: 1 })), false);
  assert.equal(validateQuoteShape(freshQuote({ price: -0.2 })), false);
  assert.equal(validateQuoteShape(freshQuote({ price: 1.5 })), false);
  assert.equal(validateQuoteShape(freshQuote({ price: NaN })), false);
});

test("matchMarketToGame finds a conservative match", () => {
  const markets = [
    {
      marketId: "1",
      question: "Will the Springfield Isotopes win the championship?",
      outcomes: [{ name: "Yes", price: 0.62 }],
      updatedAt: new Date(NOW).toISOString(),
      source: "kalshi",
    },
    {
      marketId: "2",
      question: "Will it rain in Shelbyville tomorrow?",
      outcomes: [{ name: "Yes", price: 0.2 }],
      updatedAt: new Date(NOW).toISOString(),
      source: "kalshi",
    },
  ];

  const game = {
    title: "Springfield Isotopes championship game",
    home: "Springfield Isotopes",
    away: "Shelbyville Sharks",
  };

  const match = matchMarketToGame(markets, game);

  assert.equal(match?.marketId, "1");
});

test("matchMarketToGame returns null when evidence is insufficient", () => {
  const markets = [
    {
      marketId: "9",
      question: "Will it rain tomorrow?",
      outcomes: [{ name: "Yes", price: 0.2 }],
      updatedAt: new Date(NOW).toISOString(),
      source: "kalshi",
    },
  ];

  assert.equal(
    matchMarketToGame(markets, { title: "Springfield Isotopes game" }),
    null
  );
  assert.equal(matchMarketToGame([], { title: "x" }), null);
  assert.equal(matchMarketToGame(markets, null), null);
});

test("attachOddsToDraft attaches a fresh simulated quote", () => {
  const originalNow = Date.now;
  Date.now = () => NOW;

  try {
    const draft = {
      id: "draft-1",
      game: {
        title: "Springfield Isotopes win?",
        home: "Springfield Isotopes",
        away: "Shelbyville Sharks",
      },
    };

    const odds = {
      markets: [
        {
          marketId: "KALSHI-1",
          question: "Will the Springfield Isotopes win?",
          outcomes: [{ name: "Yes", price: 0.62 }],
          updatedAt: new Date(NOW - 60_000).toISOString(),
          source: "kalshi",
        },
      ],
    };

    const result = attachOddsToDraft(draft, odds);

    assert.ok(result.oddsQuote);
    assert.equal(result.oddsQuote.price, 0.62);
    assert.equal(result.oddsQuote.unit, "TUMBO_POINTS");
    assert.equal(result.oddsQuote.simulated, true);
    assert.equal(result.oddsQuote.realMoney, false);
    assert.equal(result.oddsUnavailable, null);
  } finally {
    Date.now = originalNow;
  }
});

test("attachOddsToDraft rejects a stale quote", () => {
  const originalNow = Date.now;
  Date.now = () => NOW;

  try {
    const draft = {
      id: "draft-2",
      game: { title: "Springfield Isotopes win?", home: "Springfield Isotopes" },
    };

    const odds = {
      markets: [
        {
          marketId: "KALSHI-2",
          question: "Will the Springfield Isotopes win?",
          outcomes: [{ name: "Yes", price: 0.7 }],
          updatedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
          source: "kalshi",
        },
      ],
    };

    const result = attachOddsToDraft(draft, odds);

    assert.equal(result.oddsQuote, null);
    assert.match(result.oddsUnavailable ?? "", /stale/i);
  } finally {
    Date.now = originalNow;
  }
});

test("attachOddsToDraft rejects impossible prices", () => {
  const originalNow = Date.now;
  Date.now = () => NOW;

  try {
    const draft = {
      id: "draft-3",
      game: { title: "Springfield Isotopes win?", home: "Springfield Isotopes" },
    };

    for (const badPrice of [0, 1, -0.5, 2]) {
      const odds = {
        markets: [
          {
            marketId: "KALSHI-3",
            question: "Will the Springfield Isotopes win?",
            outcomes: [{ name: "Yes", price: badPrice }],
            updatedAt: new Date(NOW - 60_000).toISOString(),
            source: "kalshi",
          },
        ],
      };

      const result = attachOddsToDraft(draft, odds);

      assert.equal(
        result.oddsQuote,
        null,
        `price ${badPrice} should be rejected`
      );
    }
  } finally {
    Date.now = originalNow;
  }
});

test("attachOddsToDraft keeps drafts usable when no market matches", () => {
  const draft = { id: "draft-4", game: { title: "Obscure exhibition game" } };
  const odds = { markets: [], reason: "feed down" };

  const result = attachOddsToDraft(draft, odds);

  assert.equal(result.oddsQuote, null);
  assert.equal(result.id, "draft-4");
  assert.ok(result.oddsUnavailable);
});

test("attachOddsToDraft never creates a real-money quote", () => {
  const originalNow = Date.now;
  Date.now = () => NOW;

  try {
    const draft = {
      id: "draft-5",
      game: { title: "Springfield Isotopes win?", home: "Springfield Isotopes" },
    };

    const odds = {
      markets: [
        {
          marketId: "KALSHI-5",
          question: "Will the Springfield Isotopes win?",
          outcomes: [{ name: "Yes", price: 0.55 }],
          updatedAt: new Date(NOW - 30_000).toISOString(),
          source: "kalshi",
        },
      ],
    };

    const result = attachOddsToDraft(draft, odds);

    assert.equal(result.oddsQuote.simulated, true);
    assert.equal(result.oddsQuote.realMoney, false);
    assert.equal(result.oddsQuote.unit, "TUMBO_POINTS");
  } finally {
    Date.now = originalNow;
  }
});
