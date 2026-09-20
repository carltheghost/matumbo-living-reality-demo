import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CRYPTO_ASSETS,
  CUSTOM_COIN_LIMIT,
  CUSTOM_COINS_PER_CREATOR_LIMIT,
  CREATE_MAX_IN_WINDOW,
  createSimulatedExchange,
} from "../src/domains/simulated-exchange.js";

test("crypto catalog includes BTC, ETH and XRP plus a broad set", () => {
  const symbols = DEFAULT_CRYPTO_ASSETS.map((asset) => asset.symbol);
  assert.ok(symbols.includes("BTC"));
  assert.ok(symbols.includes("ETH"));
  assert.ok(symbols.includes("XRP"));
  assert.ok(symbols.length >= 16);
});

test("custom coin registry enforces a global and per-creator cap", () => {
  const exchange = createSimulatedExchange({
    now: () => 1_000_000,
  });

  let created = 0;
  for (let i = 0; i < CUSTOM_COINS_PER_CREATOR_LIMIT; i += 1) {
    exchange.createCoin({
      creatorId: "alice",
      symbol: "A" + String(i).padStart(2, "0"),
      name: "Alice Coin " + i,
    });
    created += 1;
  }
  assert.equal(created, CUSTOM_COINS_PER_CREATOR_LIMIT);
  assert.throws(
    () =>
      exchange.createCoin({
        creatorId: "alice",
        symbol: "AX",
        name: "Alice Extra",
      }),
    /creator-coin-limit/,
  );
  assert.equal(exchange.getCoinRegistrySnapshot().maxCustomCoins, CUSTOM_COIN_LIMIT);
});

test("create rate limit blocks bursts before the per-creator cap", () => {
  let now = 2_000_000;
  const exchange = createSimulatedExchange({ now: () => now });

  for (let i = 0; i < CREATE_MAX_IN_WINDOW; i += 1) {
    exchange.createCoin({
      creatorId: "bob",
      symbol: "B" + String(i + 1),
      name: "Bob Coin " + i,
    });
    now += 61_000;
  }

  now += 1_000;
  assert.throws(
    () =>
      exchange.createCoin({
        creatorId: "bob",
        symbol: "BX",
        name: "Bob Burst Coin",
      }),
    /creator-cooldown|create-rate-limit/,
  );
});

test("reserved symbols and duplicate definitions are blocked", () => {
  const exchange = createSimulatedExchange({ now: () => 3_000_000 });
  assert.throws(
    () =>
      exchange.createCoin({
        creatorId: "alice",
        symbol: "BTC",
        name: "Fake Bitcoin",
      }),
    /reserved-symbol/,
  );

  exchange.createCoin({
    creatorId: "alice",
    symbol: "MAT",
    name: "Matumbo",
    description: "same",
  });
  assert.throws(
    () =>
      exchange.createCoin({
        creatorId: "alice2",
        symbol: "MAT",
        name: "Matumbo",
        description: "same",
      }),
    /duplicate-coin-definition|symbol/,
  );
});

test("order guard blocks self trades and out-of-band previews", () => {
  const exchange = createSimulatedExchange({ now: () => 4_000_000 });
  assert.throws(
    () =>
      exchange.previewOrder({
        actor: "alice",
        makerActor: "alice",
        symbol: "XRP",
        units: 10,
        referencePrice: 1,
        currentPrice: 1,
      }),
    /self-trade-blocked/,
  );
  assert.throws(
    () =>
      exchange.previewOrder({
        actor: "alice",
        symbol: "XRP",
        units: 10,
        referencePrice: 2,
        currentPrice: 1,
      }),
    /price-band-block/,
  );
});

test("normal order returns preview-only and never settles", () => {
  const exchange = createSimulatedExchange({ now: () => 5_000_000 });
  const order = exchange.previewOrder({
    actor: "alice",
    symbol: "XRP",
    side: "buy",
    units: 5,
    referencePrice: 1,
    currentPrice: 1,
  });
  assert.equal(order.status, "preview-only");
  assert.equal(order.executable, false);
  assert.equal(order.settled, false);
});
