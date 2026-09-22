// TUMBO-SIM token facade tests — aligned to canonical QuoteEngine.
// Run: node --test tests/token-facade.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTokenEngine, fmt, ensureTumboTokenFacade } from "../src/domains/token.js";
import { createTokenFacade, LedgerError, TOKEN_EVENT } from "../src/domains/token-facade.js";

test("createTokenFacade exposes balance/fmt/quote/execute/on", () => {
  const eng = createTokenEngine();
  eng.faucet("u:alice", "TUMBO", 10_000, { idempotencyKey: "fund-alice" });
  const F = createTokenFacade(eng);
  assert.equal(F.balance("u:alice", "TUMBO"), 10_000);
  assert.match(F.fmt(1500), /1\.500/);
  assert.equal(typeof F.quote, "function");
  assert.equal(typeof F.execute, "function");
  assert.equal(typeof F.on, "function");
});

test("execute faucet is idempotent", () => {
  const eng = createTokenEngine();
  const F = createTokenFacade(eng);
  const a = F.execute("faucet", {
    to: "u:bob",
    amountFluff: 5000,
    idem: "facade-faucet-1",
  });
  const b = F.execute("faucet", {
    to: "u:bob",
    amountFluff: 5000,
    idem: "facade-faucet-1",
  });
  assert.equal(a.id, b.id);
  assert.equal(F.balance("u:bob", "TUMBO"), 5000);
});

test("execute requires idem", () => {
  const eng = createTokenEngine();
  const F = createTokenFacade(eng);
  assert.throws(
    () => F.execute("faucet", { to: "u:carol", amountFluff: 100 }),
    (e) => e instanceof LedgerError && e.code === "MISSING_IDEM",
  );
});

test("on(receipt) receives settlement events", () => {
  const eng = createTokenEngine();
  const F = createTokenFacade(eng);
  let seen = 0;
  const off = F.on("receipt", () => {
    seen += 1;
  });
  F.execute("faucet", { to: "u:dave", amountFluff: 1000, idem: "evt-1" });
  assert.ok(seen >= 1);
  off();
});

test("ensureTumboTokenFacade returns shared surface", () => {
  const a = ensureTumboTokenFacade({ seed: true });
  const b = ensureTumboTokenFacade({ seed: true });
  assert.equal(a, b);
  assert.equal(typeof a.balance, "function");
  assert.equal(typeof a.fmt, "function");
});

test("TOKEN_EVENT constant is tumbo:token", () => {
  assert.equal(TOKEN_EVENT, "tumbo:token");
});

test("fmt helper formats fluff", () => {
  assert.match(fmt(0), /0\.000/);
  assert.match(fmt(1000), /1\.000/);
});
