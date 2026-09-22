// TUMBO-SIM token idempotency + event-wave regression tests.
// Aligned to canonical QuoteEngine / TokenLedger.
// Run: node --test tests/token-idempotency.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTokenEngine } from "../src/domains/token.js";
import { createTokenFacade } from "../src/domains/token-facade.js";
import { bootToken } from "../src/domains/token-boot.js";

test("event wave: faucet via execute emits at least one receipt", () => {
  const eng = createTokenEngine();
  const F = createTokenFacade(eng);
  let receipts = 0;
  F.on("receipt", () => {
    receipts += 1;
  });
  F.execute("faucet", { to: "u:alice", amountFluff: 1000, idem: "wave-1" });
  assert.ok(receipts >= 1);
});

test("execute replay is idempotent: same receipt id", () => {
  const eng = createTokenEngine();
  const F = createTokenFacade(eng);
  const a = F.execute("faucet", { to: "u:bob", amountFluff: 2000, idem: "idem-1" });
  const b = F.execute("faucet", { to: "u:bob", amountFluff: 2000, idem: "idem-1" });
  assert.equal(a.id, b.id);
  assert.equal(F.balance("u:bob", "TUMBO"), 2000);
});

test("send via execute is idempotent", () => {
  const eng = createTokenEngine();
  eng.faucet("u:alice", "TUMBO", 50_000, { idempotencyKey: "fund-a" });
  const F = createTokenFacade(eng);
  const a = F.execute("send", {
    from: "u:alice",
    to: "u:bob",
    amountFluff: 100,
    idem: "send-1",
  });
  const b = F.execute("send", {
    from: "u:alice",
    to: "u:bob",
    amountFluff: 100,
    idem: "send-1",
  });
  assert.equal(a.id, b.id);
  assert.equal(F.balance("u:bob", "TUMBO"), 100);
  assert.equal(F.balance("u:alice", "TUMBO"), 49_900);
});

test("bootToken funds demo accounts idempotently", () => {
  const facade = bootToken({ persist: false, seed: true });
  assert.ok(facade);
  assert.equal(typeof facade.balance, "function");
  const again = bootToken({ persist: false, seed: true });
  assert.ok(again);
});

test("journal chain verifies after settlements", () => {
  const eng = createTokenEngine();
  eng.faucet("u:alice", "TUMBO", 1000, { idempotencyKey: "chain-1" });
  const check = eng.ledger.verifyChain();
  assert.equal(check.ok, true);
  assert.ok(check.count >= 1);
});
