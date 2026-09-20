/**
 * Quote-expiry handling for simulated token buy/sell.
 * Follows package.json: node --test tests/*.test.mjs
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getQuote,
  isQuoteFresh,
  settle,
  fmt,
  balance,
  __resetLedgerForTests,
  TOKEN_SUPPLY_CONFIG,
  attachWindowFacade,
} from "../src/domains/token.js";

describe("token domain — quote expiry contract", () => {
  beforeEach(() => {
    __resetLedgerForTests();
  });

  it("fmt divides fluff by 1000", () => {
    assert.equal(fmt(1000), "1");
    assert.equal(fmt(2500), "2.5");
  });

  it("getQuote returns shaped quote with hash and expiry", () => {
    const now = 1_000_000;
    const q = getQuote({ action: "buy", amountIn: 1000, now });
    assert.ok(q);
    assert.equal(q.action, "buy");
    assert.equal(q.from, "sMIMAS");
    assert.equal(q.to, "TUMBO");
    assert.equal(q.amountIn, 1000);
    assert.equal(q.amountOut, 1000);
    assert.equal(q.expiresAt, now + TOKEN_SUPPLY_CONFIG.QUOTE_TTL_MS);
    assert.ok(typeof q.hash === "string" && q.hash.startsWith("qh_"));
  });

  it("getQuote sell routes TUMBO → sMIMAS", () => {
    const q = getQuote({ action: "sell", amountIn: 500, now: 1 });
    assert.ok(q);
    assert.equal(q.from, "TUMBO");
    assert.equal(q.to, "sMIMAS");
  });

  it("getQuote returns null for no-market sentinel amounts (never throws)", () => {
    const q = getQuote({ action: "buy", amountIn: 7777, now: 1 });
    assert.equal(q, null);
  });

  it("isQuoteFresh is false after expiry", () => {
    const now = 5_000;
    const q = getQuote({ action: "buy", amountIn: 100, now });
    assert.equal(isQuoteFresh(q, now + 1), true);
    assert.equal(isQuoteFresh(q, q.expiresAt), false);
    assert.equal(isQuoteFresh(q, q.expiresAt + 1), false);
  });

  it("settle rejects expired quote (confirming with expired quote is rejected)", () => {
    const now = 10_000;
    const q = getQuote({ action: "buy", amountIn: 1000, now });
    const result = settle("test-acct", q, { now: q.expiresAt + 50 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "quote-expired");
  });

  it("settle applies 10 bps Void tithe and reports on receipt tx", () => {
    const now = 20_000;
    const amountIn = 10_000;
    const q = getQuote({ action: "buy", amountIn, now });
    assert.ok(q);
    const beforeFrom = balance("test-acct", "sMIMAS");
    const beforeTo = balance("test-acct", "TUMBO");
    const result = settle("test-acct", q, { now: now + 100 });
    assert.equal(result.ok, true);
    assert.equal(result.tx.voidTitheBps, 10);
    const expectedTithe = Math.floor((amountIn * 10) / 10_000);
    assert.equal(result.tx.voidTithe, expectedTithe);
    assert.equal(result.tx.netOut, amountIn - expectedTithe);
    assert.equal(balance("test-acct", "sMIMAS"), beforeFrom - amountIn);
    assert.equal(balance("test-acct", "TUMBO"), beforeTo + result.tx.netOut);
  });

  it("attachWindowFacade exposes TumboToken", () => {
    const fake = {};
    attachWindowFacade(fake);
    assert.ok(fake.TumboToken);
    assert.equal(typeof fake.TumboToken.balance, "function");
    assert.equal(typeof fake.TumboToken.fmt, "function");
    assert.equal(typeof fake.TumboToken.on, "function");
  });
});

describe("token trade UI — quote expiry flows (DOM-free policy)", () => {
  function confirmPolicy(quote, now) {
    if (!quote || !isQuoteFresh(quote, now)) {
      return { action: "requote", confirmEnabled: false };
    }
    return { action: "open-confirm", confirmEnabled: true };
  }

  function countdownPolicy(quote, now) {
    const remaining = quote ? Math.max(0, quote.expiresAt - now) : 0;
    return {
      remaining,
      confirmEnabled: remaining > 0,
      label: remaining > 0 ? `Expires in ${Math.ceil(remaining / 1000)}s` : "Quote expired — re-quote required",
    };
  }

  function settlePolicy(quote, now, settleFn) {
    if (!isQuoteFresh(quote, now)) {
      const refreshed = getQuote({ action: quote?.action ?? "buy", amountIn: quote?.amountIn ?? 1000, now });
      return { rejected: true, refreshed, reason: "quote-expired" };
    }
    return { rejected: false, result: settleFn(quote, now) };
  }

  it("quote expiring before confirm triggers re-quote flow", () => {
    const now = 30_000;
    const q = getQuote({ action: "sell", amountIn: 2000, now });
    const afterExpiry = q.expiresAt + 1;
    const policy = confirmPolicy(q, afterExpiry);
    assert.equal(policy.action, "requote");
    assert.equal(policy.confirmEnabled, false);
    const next = getQuote({ action: "sell", amountIn: 2000, now: afterExpiry });
    assert.ok(next);
    assert.ok(isQuoteFresh(next, afterExpiry));
  });

  it("countdown reaching zero disables confirm", () => {
    const now = 40_000;
    const q = getQuote({ action: "buy", amountIn: 500, now });
    const mid = countdownPolicy(q, now + 1000);
    assert.equal(mid.confirmEnabled, true);
    const end = countdownPolicy(q, q.expiresAt);
    assert.equal(end.confirmEnabled, false);
    assert.match(end.label, /expired/i);
  });

  it("confirming with an expired quote is rejected and refreshes", () => {
    __resetLedgerForTests();
    const now = 50_000;
    const q = getQuote({ action: "buy", amountIn: 3000, now });
    const outcome = settlePolicy(q, q.expiresAt + 10, (quote, t) => settle("ui-acct", quote, { now: t }));
    assert.equal(outcome.rejected, true);
    assert.equal(outcome.reason, "quote-expired");
    assert.ok(outcome.refreshed);
    assert.ok(isQuoteFresh(outcome.refreshed, q.expiresAt + 10));
  });

  it("fresh confirm settles with void tithe line data available", () => {
    __resetLedgerForTests();
    const now = 60_000;
    const q = getQuote({ action: "buy", amountIn: 10_000, now });
    const outcome = settlePolicy(q, now + 50, (quote, t) => settle("ui-acct", quote, { now: t }));
    assert.equal(outcome.rejected, false);
    assert.equal(outcome.result.ok, true);
    assert.equal(outcome.result.tx.voidTitheBps, 10);
  });
});
