// TUMBO-SIM token facade tests (part 02). Run: node --test tests/token-facade.test.mjs
// Covers createTokenFacade: API surface, mandatory idempotency keys, event
// emission (receipt + balance-changed), replay suppression, action routing.
// NOTE: Node has no DOM here, so document CustomEvents are skipped and the
// in-process subscriber channel is asserted instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TumboLedger, LedgerError, SYS, fmtTumbo } from "../src/domains/token.js";
import { createTokenFacade, TOKEN_EVENT } from "../src/domains/token-facade.js";

const T = (n) => n * 1000; // TUMBO -> fluff

function funded(seed = 101, tumbo = 10_000) {
  const L = new TumboLedger({ seed });
  for (const u of ["u:alice", "u:bob"]) L.ensureAccount(u);
  const drip = L.faucetDrip({ to: "u:alice", amountTumbo: tumbo });
  L.receive({ intentTxId: drip.txId, by: "u:alice" });
  return L;
}

test("TOKEN_EVENT constant", () => {
  assert.equal(TOKEN_EVENT, "tumbo:token");
});

test("facade exposes ledger, balance, fmt, quote, execute, on", () => {
  const L = funded();
  const F = createTokenFacade(L);
  assert.equal(F.ledger, L);
  for (const k of ["balance", "fmt", "quote", "execute", "on"]) assert.equal(typeof F[k], "function");
  assert.equal(F.fmt(1500), fmtTumbo(1500));
  assert.equal(F.fmt(1500), "1.500");
  assert.equal(F.balance("u:alice"), L.balance("u:alice"));
  assert.equal(F.balance("u:alice", "sMIMAS"), 0);
  const q = F.quote({ assetIn: "TUMBO", assetOut: "sMIMAS" });
  assert.ok(q.qid);
});

test("execute requires args.idem (MISSING_IDEM)", () => {
  const F = createTokenFacade(funded());
  assert.throws(() => F.execute("send", { from: "u:alice", to: "u:bob", amountFluff: 1 }),
    (e) => e instanceof LedgerError && e.code === "MISSING_IDEM");
  assert.throws(() => F.execute("send"), (e) => e.code === "MISSING_IDEM");
});

test("execute rejects unknown actions", () => {
  const F = createTokenFacade(funded());
  assert.throws(() => F.execute("mint", { idem: "x" }), (e) => e.code === "UNKNOWN_ACTION");
});

test("execute send settles and emits receipt + balance-changed to subscribers", () => {
  const L = funded();
  const F = createTokenFacade(L);
  const seen = [];
  const offR = F.on("receipt", (d) => seen.push(d));
  const offB = F.on("balance-changed", (d) => seen.push(d));
  const a0 = L.balance("u:alice");
  const r = F.execute("send", { from: "u:alice", to: "u:bob", amountFluff: 2500, idem: "fx1" });
  assert.equal(r.action, "send");
  assert.equal(L.balance("u:alice"), a0 - 2500);
  assert.equal(L.balance("u:bob"), 2500);
  const receipts = seen.filter((d) => d.type === "receipt");
  const changes = seen.filter((d) => d.type === "balance-changed");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].txId, r.txId);
  assert.equal(receipts[0].action, "send");
  assert.equal(receipts[0].logicalTick, r.logicalTick);
  assert.deepEqual(changes.map((c) => c.account).sort(), ["u:alice", "u:bob"]);
  const alice = changes.find((c) => c.account === "u:alice");
  assert.equal(alice.delta, -2500);
  assert.equal(alice.balance, a0 - 2500);
  assert.equal(alice.asset, "TUMBO");
  assert.equal(alice.txId, r.txId);
  offR(); offB();
});

test("execute replay is idempotent: same receipt, no second event wave", () => {
  const L = funded();
  const F = createTokenFacade(L);
  let receipts = 0, changes = 0;
  F.on("receipt", () => receipts++);
  F.on("balance-changed", () => changes++);
  const r1 = F.execute("tip", { from: "u:alice", to: "u:bob", amountFluff: 100, idem: "fx2" });
  const r2 = F.execute("tip", { from: "u:alice", to: "u:bob", amountFluff: 100, idem: "fx2" });
  assert.equal(r1.txId, r2.txId);
  assert.equal(r1.hash, r2.hash);
  assert.equal(receipts, 1);
  assert.equal(changes, 2); // one per touched account, from the first settlement only
  assert.equal(L.s.journal.filter((j) => j.action === "tip").length, 1);
  assert.equal(L.balance("u:bob"), 100);
});

test("execute routes deliver -> deliverCreate and confirm -> deliverConfirm", () => {
  const L = funded();
  const F = createTokenFacade(L);
  const a0 = L.balance("u:alice");
  const d = F.execute("deliver", { from: "u:alice", to: "u:bob", amountFluff: 3000, idem: "fx3", contractId: "c1" });
  assert.equal(d.action, "deliverCreate");
  assert.equal(L.balance(SYS.escrow, "TUMBO"), 3000);
  const c = F.execute("confirm", { intentTxId: d.txId, by: "u:bob", idem: "fx4" });
  assert.equal(c.action, "deliverConfirm");
  assert.equal(L.balance("u:bob"), 3000);
  assert.equal(L.balance("u:alice"), a0 - 3000);
  assert.equal(L.balance(SYS.escrow, "TUMBO"), 0);
});

test("execute ledger errors propagate (no events on failure)", () => {
  const L = funded();
  const F = createTokenFacade(L);
  let n = 0;
  F.on("receipt", () => n++);
  assert.throws(() => F.execute("send", { from: "u:bob", to: "u:alice", amountFluff: T(50_000), idem: "fx6" }),
    (e) => e.code === "INSUFFICIENT_FUNDS");
  assert.equal(n, 0);
  assert.ok(L.verifyInvariants());
});

test("on() unsubscribe works; unknown event names throw", () => {
  const F = createTokenFacade(funded());
  let n = 0;
  const off = F.on("receipt", () => n++);
  off();
  F.execute("send", { from: "u:alice", to: "u:bob", amountFluff: 10, idem: "fx5" });
  assert.equal(n, 0);
  assert.throws(() => F.on("explode", () => {}), (e) => e.code === "UNKNOWN_EVENT");
});

test("facade works over a ledger with prior history (boot-like flow)", () => {
  const L = funded(102, 50_000);
  const F = createTokenFacade(L);
  L.ensureAccount("u:visitor");
  const drip = L.faucetDrip({ to: "u:visitor", amountTumbo: 1000, idem: "gen:visitor" });
  L.receive({ intentTxId: drip.txId, by: "u:visitor", idem: "gen:visitor:recv" });
  assert.equal(F.balance("u:visitor"), T(1000));
  const r = F.execute("tip", { from: "u:visitor", to: "u:alice", amountFluff: 500, idem: "fx7" });
  assert.equal(r.action, "tip");
  assert.equal(F.balance("u:visitor"), T(1000) - 500);
  assert.ok(L.verifyInvariants());
  assert.ok(L.verifyChain());
});
