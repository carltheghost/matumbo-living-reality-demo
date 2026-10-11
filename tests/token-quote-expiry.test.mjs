/** Quote expiry and confirmation-policy coverage for the canonical engine. */

import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG,
  QuoteError,
  createTokenEngine,
  fmt,
  installFacade,
} from "../src/domains/token.js";

const isQuoteFresh = (quote, now = Date.now()) => Boolean(quote && now < quote.expiresAt);

function funded(amountFluff = 50_000) {
  const engine = createTokenEngine();
  engine.faucet("u:alice", "TUMBO", amountFluff, { idempotencyKey: "quote-fund" });
  return engine;
}

function getQuote(engine, { action = "buy", amountIn = 1000, ttlMs = CONFIG.quoteTtlMs } = {}) {
  return engine.quote({
    action,
    from: "u:alice",
    fromAsset: action === "sell" ? "sMIMAS" : "TUMBO",
    toAsset: action === "sell" ? "TUMBO" : "sMIMAS",
    amountIn,
    ttlMs,
  });
}

test("fmt formats fluff exactly in the canonical display contract", () => {
  assert.equal(fmt(1000), "1.000 TUMBO-SIM");
  assert.equal(fmt(2500), "2.500 TUMBO-SIM");
});

test("buy quotes include a signed hash, exact output, and wall-clock expiry", () => {
  const engine = createTokenEngine();
  const before = Date.now();
  const quote = getQuote(engine, { action: "buy", amountIn: 1000 });
  assert.equal(quote.action, "buy");
  assert.equal(quote.from, "u:alice");
  assert.equal(quote.to, "sys:market");
  assert.equal(quote.fromAsset, "TUMBO");
  assert.equal(quote.toAsset, "sMIMAS");
  assert.equal(quote.amountIn, 1000);
  assert.equal(quote.amountOut, 10_000);
  assert.ok(quote.expiresAt >= before + CONFIG.quoteTtlMs);
  assert.match(quote.hash, /^[0-9a-f]{16}$/);
});

test("sell quotes route sMIMAS into TUMBO", () => {
  const quote = getQuote(createTokenEngine(), { action: "sell", amountIn: 500 });
  assert.equal(quote.fromAsset, "sMIMAS");
  assert.equal(quote.toAsset, "TUMBO");
  assert.equal(quote.amountOut, 50);
});

test("unsupported or too-small market requests fail closed", () => {
  const engine = createTokenEngine();
  assert.throws(
    () => engine.quote({ action: "buy", from: "u:alice", fromAsset: "sMIMAS", toAsset: "TUMBO", amountIn: 7777 }),
    QuoteError,
  );
  assert.throws(
    () => engine.quote({ action: "sell", from: "u:alice", fromAsset: "sMIMAS", toAsset: "TUMBO", amountIn: 1 }),
    /rounds to zero/,
  );
});

test("isQuoteFresh is false at and after expiry", () => {
  const engine = createTokenEngine();
  const quote = getQuote(engine, { ttlMs: 1000 });
  assert.equal(isQuoteFresh(quote, quote.expiresAt - 1), true);
  assert.equal(isQuoteFresh(quote, quote.expiresAt), false);
  assert.equal(isQuoteFresh(quote, quote.expiresAt + 1), false);
});

test("executing an expired quote is rejected without moving funds", () => {
  const engine = funded(10_000);
  const quote = getQuote(engine, { ttlMs: -1 });
  const before = engine.balance("u:alice", "TUMBO");
  assert.equal(isQuoteFresh(quote), false);
  assert.throws(() => engine.execute(quote, { idempotencyKey: "expired" }), /expired/);
  assert.equal(engine.balance("u:alice", "TUMBO"), before);
  assert.equal(engine.ledger._journals.some((row) => row.idempotencyKey === "expired"), false);
});

test("settlement reports the exact Void tithe and output", () => {
  const engine = funded(10_000);
  const quote = getQuote(engine, { action: "buy", amountIn: 10_000 });
  const beforeVoid = engine.balance("sys:void", "TUMBO");
  const receipt = engine.execute(quote, { idempotencyKey: "settle" });
  assert.equal(receipt.tithe, 10);
  assert.equal(receipt.amountOut, 100_000);
  assert.equal(engine.balance("sys:void", "TUMBO"), beforeVoid + 10);
  assert.equal(engine.balance("u:alice", "TUMBO"), 0);
  assert.equal(engine.balance("u:alice", "sMIMAS"), 100_000);
});

test("installFacade exposes the canonical TumboToken surface", () => {
  const fake = {};
  const facade = installFacade(fake, { force: true });
  assert.equal(fake.TumboToken, facade);
  assert.equal(typeof facade.balance, "function");
  assert.equal(typeof facade.fmt, "function");
  assert.equal(typeof facade.on, "function");
  assert.equal(typeof facade.quote, "function");
  assert.equal(typeof facade.execute, "function");
});

function confirmPolicy(quote, now) {
  if (!isQuoteFresh(quote, now)) return { action: "requote", confirmEnabled: false };
  return { action: "open-confirm", confirmEnabled: true };
}

function countdownPolicy(quote, now) {
  const remaining = quote ? Math.max(0, quote.expiresAt - now) : 0;
  return {
    remaining,
    confirmEnabled: remaining > 0,
    label: remaining > 0 ? `Expires in ${Math.ceil(remaining / 1000)}s` : "Quote expired - re-quote required",
  };
}

function settlePolicy(quote, now, settleFn, reQuoteFn) {
  if (!isQuoteFresh(quote, now)) {
    return { rejected: true, refreshed: reQuoteFn(), reason: "quote-expired" };
  }
  return { rejected: false, result: settleFn(quote, now) };
}

test("quote expiring before confirm triggers a re-quote flow", () => {
  const engine = createTokenEngine();
  const quote = getQuote(engine, { action: "sell", amountIn: 2000, ttlMs: 10 });
  const afterExpiry = quote.expiresAt;
  const policy = confirmPolicy(quote, afterExpiry);
  assert.equal(policy.action, "requote");
  assert.equal(policy.confirmEnabled, false);
  const next = getQuote(engine, { action: "sell", amountIn: 2000 });
  assert.ok(isQuoteFresh(next, afterExpiry));
});

test("countdown reaching zero disables confirm", () => {
  const quote = getQuote(createTokenEngine(), { ttlMs: 1000 });
  const mid = countdownPolicy(quote, quote.expiresAt - 1);
  assert.equal(mid.confirmEnabled, true);
  const end = countdownPolicy(quote, quote.expiresAt);
  assert.equal(end.confirmEnabled, false);
  assert.match(end.label, /expired/i);
});

test("expired confirmation rejects and refreshes the quote", () => {
  const engine = funded();
  const quote = getQuote(engine, { ttlMs: -1, amountIn: 3000 });
  const expiredAt = quote.expiresAt;
  const outcome = settlePolicy(
    quote,
    expiredAt + 10,
    (candidate) => engine.execute(candidate, { idempotencyKey: "ui-expired" }),
    () => getQuote(engine, { amountIn: quote.amountIn }),
  );
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, "quote-expired");
  assert.ok(outcome.refreshed);
  assert.ok(isQuoteFresh(outcome.refreshed, expiredAt + 10));
});

test("fresh confirmation settles with tithe data available", () => {
  const engine = funded(10_000);
  const quote = getQuote(engine, { amountIn: 10_000 });
  const outcome = settlePolicy(
    quote,
    quote.expiresAt - 1,
    (candidate) => engine.execute(candidate, { idempotencyKey: "ui-fresh" }),
    () => getQuote(engine, { amountIn: quote.amountIn }),
  );
  assert.equal(outcome.rejected, false);
  assert.equal(outcome.result.tithe, 10);
});
