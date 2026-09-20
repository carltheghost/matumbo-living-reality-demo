# Odds Integration Wiring — Reality Lens Ω

## Purpose

`src/domains/odds-feeds.js` is a read-only odds adapter.

Kalshi and Polymarket public market data is used only as an informational
probability quote attached to simulated TUMBO-point contract drafts.

The odds feed does not create, fund, sign, submit, settle, custody, or
execute any real-money position.

## 1. Fetch after auto-contract drafts exist

The integrator should call the feed after the existing auto-contract draft
pipeline has produced its game/contract drafts.

Conceptually:

    auto-contract drafts
            |
            v
       odds fetch
       /        \
    Kalshi    Polymarket
       \        /
        normalized markets
              |
              v
       attachOddsToDraft()
              |
              v
       simulated contracts
              |
              v
       Reality Lens Ω projection

Do not make odds fetching part of contract creation itself. A contract draft
must be able to exist when either public feed is unavailable.

Example:

    const kalshi = await fetchKalshiOdds({
      fetch,
      timeoutMs: 10_000,
    });

    const polymarket = await fetchPolymarketOdds({
      fetch,
      timeoutMs: 10_000,
    });

    const kalshiMarkets = kalshi.available
      ? kalshi.markets
      : [];

    const polymarketMarkets = polymarket.available
      ? polymarket.markets
      : [];

    const allMarkets = [
      ...kalshiMarkets,
      ...polymarketMarkets,
    ];

    const draftsWithOdds = drafts.map((draft) =>
      attachOddsToDraft(draft, {
        markets: allMarkets,
      })
    );

The actual integrator should preserve the repository's existing draft
pipeline and state-management conventions rather than creating a second
contract system.

## 2. Quote attachment

`attachOddsToDraft(draft, odds)` performs the safety checks before an odds
quote enters a draft.

The flow is:

    draft
      |
      v
    find matching public market
      |
      v
    select outcome
      |
      v
    validate quote shape
      |
      v
    validate price: 0 < price < 1
      |
      v
    validate timestamp
      |
      v
    reject if older than 15 minutes
      |
      v
    attach simulated quote

A successful quote has this conceptual shape:

    {
      marketId: "...",
      question: "...",
      outcome: "...",
      price: 0.62,
      updatedAt: "...",
      source: "kalshi",
      unit: "TUMBO_POINTS",
      simulated: true,
      realMoney: false
    }

`price` is a probability-style value between zero and one. It is not a
dollar balance, account balance, wager amount, or settlement amount.

The module deliberately rejects prices equal to zero or one.

## 3. Freshness

Quotes older than 15 minutes are rejected.

The helper is:

    isFreshQuote(quote, now)

The freshness check also rejects timestamps in the future.

This prevents an old cached market value from silently becoming a current
contract quote.

## 4. Matching

The helper:

    matchMarketToGame(markets, game)

uses the game's team/event text and the market question.

Matching is intentionally conservative. If the evidence is insufficient,
the function returns `null`.

The integrator should treat `null` as "no verified market match", not as a
reason to invent a probability.

## 5. No-market rendering

A missing feed and a missing game market are normal states.

`createUnavailableOdds(reason)` produces an explicit unavailable object:

    {
      available: false,
      marketId: null,
      question: null,
      outcomes: [],
      updatedAt: null,
      source: null,
      reason: "..."
    }

The Reality Lens Ω projection should render this as an unavailable/informational
state using the existing contract UI language.

It should NOT:

- substitute 50%
- copy the previous quote indefinitely
- infer a quote from another game
- turn unavailable into a bet
- show an unavailable quote as a real market price

The existing Block World visuals should remain unchanged.

## 6. Feed failure behavior

Both fetch functions convert HTTP failures, network failures, empty market
responses, and timeout/abort failures into an unavailable odds state.

The contract draft itself should remain usable as a simulated TUMBO-point
draft.

A feed failure must not prevent the rest of the Living Reality system from
loading.

## 7. Security boundary

The odds module is intentionally limited to public read operations.

Allowed:

- HTTP GET
- public market discovery
- public probability/price data
- normalization
- matching
- freshness validation
- simulated TUMBO-point quote attachment

Not implemented:

- API keys
- authorization credentials
- wallet addresses
- private keys
- signing
- order creation
- order cancellation
- deposits
- withdrawals
- custody
- settlement
- redemption
- mainnet transactions
- real-money balances

No caller should add those responsibilities to this module.

## 8. Testing

Tests are DOM-free and must never contact Kalshi or Polymarket.

Run:

    node --test tests/odds-feeds.test.mjs

The test suite supplies fake fetch functions and fake API responses.

When changing the adapter, preserve the fake-fetch boundary so the tests
remain deterministic and cannot accidentally submit network requests.

## 9. Current public API assumptions

Kalshi is consumed through its public markets REST endpoint.

Polymarket is consumed through its public Gamma markets endpoint.

The adapter normalizes provider-specific fields into:

    {
      marketId,
      question,
      outcomes,
      updatedAt,
      source
    }

Provider-specific API changes should be isolated inside
`src/domains/odds-feeds.js`; callers should consume only the normalized shape.

## 10. Architectural rule

The data flow is strictly:

    PUBLIC ODDS
        |
        v
    normalized market data
        |
        v
    validated quote
        |
        v
    SIMULATED TUMBO POINTS
        |
        v
    Reality Lens Ω projection

Never reverse this relationship.

TUMBO points do not become a representation of ownership of Kalshi or
Polymarket contracts, and a public market quote does not authorize any
external transaction.
