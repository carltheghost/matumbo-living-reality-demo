// TUMBO-SIM ledger core tests (part 01). Run: node --test tests/token-ledger.test.mjs
// Ported from the prototype suite; imports adapted to src/domains.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TumboLedger, LedgerError, SYS, fmtTumbo, FLUFF_PER_TUMBO, mulDivFloor,
         REVERSE_WINDOW_TICKS, GATE_ARBITER, GATE_SYSTEM } from "../src/domains/token.js";
import { sha256Hex } from "../src/domains/token-sha256.js";
import { BotPay, Pay402 } from "../src/domains/token-botpay.js";
import { saveFile, loadFile } from "../src/domains/token-store.js";

const T = (n) => n * FLUFF_PER_TUMBO; // TUMBO -> fluff

function funded(seed = 1, tumbo = 100_000) {
  const L = new TumboLedger({ seed });
  for (const u of ["u:alice", "u:bob", "u:carol"]) L.ensureAccount(u);
  const drip = L.faucetDrip({ to: "u:alice", amountTumbo: tumbo });
  L.receive({ intentTxId: drip.txId, by: "u:alice" });
  return L;
}
// advance n logical ticks with dust sends (balances effectively unchanged)
function advance(L, n, a = "u:alice", b = "u:bob") {
  for (let i = 0; i < n; i++)
    L.send({ from: a, to: b, amountFluff: 1, idem: `adv:${L._now()}:${i}:${Math.random()}` });
}

test("sha256 known vectors", () => {
  assert.equal(sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("genesis: supplies conserved, chain verifies, void starts empty", () => {
  const L = new TumboLedger({ seed: 42 });
  assert.equal(L.balance(SYS.void, "TUMBO"), 0);
  assert.ok(L.verifyInvariants());
  assert.ok(L.verifyChain());
  assert.equal(L.s.receipts[0].prevHash, "TUMBO-GENESIS");
  assert.equal(L.circulating("TUMBO"), 420_000_000_000 * FLUFF_PER_TUMBO);
});

test("send: balances move, atomic on insufficient funds", () => {
  const L = funded();
  const a0 = L.balance("u:alice"), b0 = L.balance("u:bob");
  L.send({ from: "u:alice", to: "u:bob", amountFluff: T(100), idem: "s1" });
  assert.equal(L.balance("u:alice"), a0 - T(100));
  assert.equal(L.balance("u:bob"), b0 + T(100));
  assert.throws(() => L.send({ from: "u:bob", to: "u:alice", amountFluff: T(10_000_000), idem: "s2" }),
    (e) => e.code === "INSUFFICIENT_FUNDS");
  assert.equal(L.balance("u:bob"), b0 + T(100)); // unchanged: all-or-nothing
  assert.throws(() => L.send({ from: "u:alice", to: "u:bob", amountFluff: 0, idem: "s3" }),
    (e) => e.code === "BAD_AMOUNT");
});

test("idempotency: replay returns original receipt; mismatch rejected", () => {
  const L = funded();
  const r1 = L.send({ from: "u:alice", to: "u:bob", amountFluff: T(5), idem: "idem-1" });
  const r2 = L.send({ from: "u:alice", to: "u:bob", amountFluff: T(5), idem: "idem-1" });
  assert.equal(r1.txId, r2.txId);
  assert.equal(r1.hash, r2.hash);
  assert.equal(L.balance("u:bob"), T(5)); // credited exactly once
  assert.throws(() => L.send({ from: "u:alice", to: "u:bob", amountFluff: T(6), idem: "idem-1" }),
    (e) => e.code === "IDEM_MISMATCH");
});

test("reverse send within window restores balances", () => {
  const L = funded();
  const a0 = L.balance("u:alice"), b0 = L.balance("u:bob");
  const r = L.send({ from: "u:alice", to: "u:bob", amountFluff: T(50), idem: "rs1" });
  const rev = L.reverse({ txId: r.txId, by: "u:alice" });
  assert.equal(rev.action, "reverse");
  assert.equal(L.balance("u:alice"), a0);
  assert.equal(L.balance("u:bob"), b0);
  assert.equal(L.tx(r.txId).state, "reversed");
  assert.equal(L.tx(r.txId).reversedBy, rev.txId);
});

test("reverse: double-reverse, reverse-of-reverse, and closed window all fail", () => {
  const L = funded();
  const r = L.send({ from: "u:alice", to: "u:bob", amountFluff: T(50), idem: "rr1" });
  const rev = L.reverse({ txId: r.txId, by: "u:alice" });
  assert.throws(() => L.reverse({ txId: r.txId, by: "u:alice" }), (e) => e.code === "ALREADY_REVERSED");
  assert.throws(() => L.reverse({ txId: rev.txId, by: "u:alice" }), (e) => e.code === "NO_CHAIN");

  const L2 = new TumboLedger({ seed: 9, strict: false });
  for (const u of ["u:alice", "u:bob"]) L2.ensureAccount(u);
  const d = L2.faucetDrip({ to: "u:alice", amountTumbo: 50_000 });
  L2.receive({ intentTxId: d.txId, by: "u:alice" });
  const r2 = L2.send({ from: "u:alice", to: "u:bob", amountFluff: T(10), idem: "rr2" });
  advance(L2, REVERSE_WINDOW_TICKS + 5);
  assert.throws(() => L2.reverse({ txId: r2.txId, by: "u:alice" }), (e) => e.code === "WINDOW_CLOSED");
  L2.verifyInvariants();
});

test("reverse fails closed when recipient already spent the funds", () => {
  const L = funded();
  const r = L.send({ from: "u:alice", to: "u:bob", amountFluff: T(50), idem: "sp1" });
  L.send({ from: "u:bob", to: "u:carol", amountFluff: T(50), idem: "sp2" }); // bob spends it
  assert.throws(() => L.reverse({ txId: r.txId, by: "u:alice" }), (e) => e.code === "INSUFFICIENT_FUNDS");
});

test("tip: sender can NEVER reverse; arbiter can with gate", () => {
  const L = funded();
  const r = L.tip({ from: "u:alice", to: "u:bob", amountFluff: T(7), idem: "tip1", memo: "great cube!" });
  assert.equal(L.tx(r.txId).action, "tip");
  assert.throws(() => L.reverse({ txId: r.txId, by: "u:alice" }), (e) => e.code === "NOT_AUTHORIZED");
  assert.throws(() => L.reverse({ txId: r.txId, by: "sys:arbiter" }), (e) => e.code === "GATE_DENIED");
  const b0 = L.balance("u:bob");
  L.reverse({ txId: r.txId, by: "sys:arbiter", gate: GATE_ARBITER });
  assert.equal(L.balance("u:bob"), b0 - T(7));
});

test("payreq/receive: pending inbound, wrong-claimer rejected, issuer cancel", () => {
  const L = funded();
  const a0 = L.balance("u:alice");
  const q = L.payreq({ issuer: "u:alice", recipient: "u:bob", amountFluff: T(20), idem: "pq1" });
  assert.equal(L.tx(q.txId).state, "pending");
  assert.equal(L.balance(SYS.escrow, "TUMBO"), T(20)); // hold visible in escrow
  assert.throws(() => L.receive({ intentTxId: q.txId, by: "u:carol" }), (e) => e.code === "NOT_RECIPIENT");
  // issuer cancels instead
  const c = L.cancel({ intentTxId: q.txId, by: "u:alice" });
  assert.equal(c.action, "cancel");
  assert.equal(L.balance("u:alice"), a0); // refunded
  assert.equal(L.balance(SYS.escrow, "TUMBO"), 0);
  // double cancel is idempotent
  const c2 = L.cancel({ intentTxId: q.txId, by: "u:alice" });
  assert.equal(c2.txId, c.txId);
  assert.throws(() => L.receive({ intentTxId: q.txId, by: "u:bob" }), (e) => e.code === "INTENT_NOT_PENDING");
});

test("receive settles; arbiter reverse restores to the issuer", () => {
  const L = funded();
  const a0 = L.balance("u:alice");
  const q = L.payreq({ issuer: "u:alice", recipient: "u:bob", amountFluff: T(20), idem: "pq2" });
  const rc = L.receive({ intentTxId: q.txId, by: "u:bob" });
  assert.equal(L.balance("u:bob"), T(20));
  assert.throws(() => L.cancel({ intentTxId: q.txId, by: "u:alice" }), (e) => e.code === "USE_REVERSE");
  L.reverse({ txId: rc.txId, by: "sys:arbiter", gate: GATE_ARBITER });
  assert.equal(L.balance("u:bob"), 0);
  assert.equal(L.balance("u:alice"), a0); // back to issuer, not stranded in escrow
  assert.equal(L.balance(SYS.escrow, "TUMBO"), 0);
});

test("deliver: escrow -> confirm -> settled; cancel only pre-confirm", () => {
  const L = funded();
  const a0 = L.balance("u:alice");
  const d = L.deliverCreate({ from: "u:alice", to: "u:bob", amountFluff: T(30), idem: "dl1", contractId: "arena-7" });
  assert.equal(L.balance(SYS.escrow, "TUMBO"), T(30));
  assert.throws(() => L.deliverConfirm({ intentTxId: d.txId, by: "u:carol" }), (e) => e.code === "NOT_RECIPIENT");
  const cf = L.deliverConfirm({ intentTxId: d.txId, by: "u:bob" });
  assert.equal(L.balance("u:bob"), T(30));
  assert.throws(() => L.cancel({ intentTxId: d.txId, by: "u:alice" }), (e) => e.code === "USE_REVERSE");
  assert.throws(() => L.deliverConfirm({ intentTxId: d.txId, by: "u:bob" }), (e) => e.code === "INTENT_NOT_PENDING");
  // arbiter reversal of the confirm restores the ORIGINAL SENDER
  L.reverse({ txId: cf.txId, by: "sys:arbiter", gate: GATE_ARBITER });
  assert.equal(L.balance("u:alice"), a0);
  assert.equal(L.balance("u:bob"), 0);
});

test("deliver: sender cancels pre-confirm; escrow leg not directly reversible", () => {
  const L = funded();
  const a0 = L.balance("u:alice");
  const d = L.deliverCreate({ from: "u:alice", to: "u:bob", amountFluff: T(30), idem: "dl2" });
  L.cancel({ intentTxId: d.txId, by: "u:alice" });
  assert.equal(L.balance("u:alice"), a0);
  assert.throws(() => L.reverse({ txId: d.txId, by: "sys:arbiter", gate: GATE_ARBITER }),
    (e) => e.code === "NOT_SETTLED");
});

test("exchange/buy/sell: math, void tithe, quote expiry, slippage, no direct reverse", () => {
  const L = funded();
  const q = L.quote({ assetIn: "TUMBO", assetOut: "sMIMAS" });
  const b = L.buy({ by: "u:alice", amountInFluff: T(1000), quote: q, idem: "buy1" });
  // 1000 TUMBO -> 1 sMIMAS; 10bps tithe = 1 TUMBO burned
  assert.equal(L.balance("u:alice", "sMIMAS"), 1 * FLUFF_PER_TUMBO);
  assert.equal(L.voidBurned("TUMBO"), T(1));
  assert.equal(b.meta.voidTithe, String(T(1)));

  const q2 = L.quote({ assetIn: "sMIMAS", assetOut: "TUMBO" });
  const s = L.sell({ by: "u:alice", assetIn: "sMIMAS", amountInFluff: 1 * FLUFF_PER_TUMBO, quote: q2, idem: "sell1" });
  assert.equal(s.meta.amountOut, String(T(1000)));
  assert.equal(L.balance("u:alice", "sMIMAS"), 0);
  // counter-trade returned ~999 TUMBO (tithe again); no direct reverse allowed
  assert.throws(() => L.reverse({ txId: b.txId, by: "u:alice" }), (e) => e.code === "NOT_REVERSIBLE");

  // expired quote
  const q3 = L.quote({ assetIn: "TUMBO", assetOut: "sMIMAS" });
  advance(L, 51);
  assert.throws(() => L.buy({ by: "u:alice", amountInFluff: T(10), quote: q3, idem: "buyX" }),
    (e) => e.code === "QUOTE_EXPIRED");

  // oracle moves beyond slippage guard
  const q4 = L.quote({ assetIn: "TUMBO", assetOut: "sMIMAS" });
  L.setRate({ pair: "TUMBO/sMIMAS", num: 2, den: 1000, gate: GATE_SYSTEM });
  assert.throws(() => L.buy({ by: "u:alice", amountInFluff: T(10), quote: q4, idem: "buyY" }),
    (e) => e.code === "SLIPPAGE");
  assert.throws(() => L.setRate({ pair: "TUMBO/sMIMAS", num: 1, den: 1000, gate: "bogus" }),
    (e) => e.code === "GATE_DENIED");
});

test("stake: early unstake blocked; unstake after unlock; slash burns", () => {
  const L = funded();
  const a0 = L.balance("u:alice");
  const { stakeId } = L.stake({ owner: "u:alice", contractId: "arena-1", amountFluff: T(500), unlockInTicks: 10, idem: "st1" });
  assert.equal(L.balance(SYS.vault, "TUMBO"), T(500));
  assert.throws(() => L.unstake({ stakeId, by: "u:alice" }), (e) => e.code === "STAKE_LOCKED");
  assert.throws(() => L.unstake({ stakeId, by: "u:bob" }), (e) => e.code === "NOT_OWNER");
  advance(L, 11);
  L.unstake({ stakeId, by: "u:alice" });
  assert.equal(L.balance("u:alice"), a0 - 11); // dust from time-advance sends
  assert.equal(L.balance(SYS.vault, "TUMBO"), 0);

  // slash path: 20% (2000 bps) burned to the Void
  const s2 = L.stake({ owner: "u:alice", contractId: "arena-2", amountFluff: T(1000), unlockInTicks: 100, slashBps: 2000, idem: "st2" });
  const v0 = L.voidBurned("TUMBO");
  assert.throws(() => L.slash({ stakeId: s2.stakeId, gate: "nope" }), (e) => e.code === "GATE_DENIED");
  L.slash({ stakeId: s2.stakeId, gate: GATE_ARBITER });
  assert.equal(L.voidBurned("TUMBO"), v0 + T(200));
  assert.equal(L.balance("u:alice"), a0 - 11 - T(200)); // remainder released
  assert.throws(() => L.unstake({ stakeId: s2.stakeId, by: "u:alice" }), (e) => e.code === "STAKE_CLOSED");
});

test("deposit (Hibernation Vault): NO early exit; withdraw at maturity + Burrow Score", () => {
  const L = funded();
  const a0 = L.balance("u:alice");
  const { depositId } = L.deposit({ owner: "u:alice", amountFluff: T(2000), termTicks: 20, idem: "dep1" });
  assert.throws(() => L.withdraw({ depositId, by: "u:alice" }), (e) => e.code === "VAULT_SEALED");
  assert.throws(() => L.reverse({ txId: L.tx(L.s.deposits[depositId].txId).id, by: "u:alice" }),
    (e) => e.code === "NOT_REVERSIBLE");
  advance(L, 21);
  const { burrowScore } = L.withdraw({ depositId, by: "u:alice" });
  assert.equal(L.balance("u:alice"), a0 - 21); // dust from time-advance sends
  assert.ok(burrowScore > 0, "Burrow Score accrues");
  assert.equal(L.s.burrowScore["u:alice"], burrowScore);
});

test("lock/unlock: sealed until tick, then releases", () => {
  const L = funded();
  const a0 = L.balance("u:alice");
  const { lockId } = L.lock({ owner: "u:alice", amountFluff: T(300), unlockInTicks: 8, idem: "lk1" });
  assert.throws(() => L.unlock({ lockId, by: "u:alice" }), (e) => e.code === "LOCK_SEALED");
  assert.throws(() => L.unlock({ lockId, by: "u:bob" }), (e) => e.code === "NOT_OWNER");
  advance(L, 9);
  L.unlock({ lockId, by: "u:alice" });
  assert.equal(L.balance("u:alice"), a0 - 9); // dust from time-advance sends
});

test("save: pocket move; owner reverses anytime, even after ages", () => {
  const L = new TumboLedger({ seed: 3, strict: false });
  for (const u of ["u:alice", "u:bob"]) L.ensureAccount(u);
  const d = L.faucetDrip({ to: "u:alice", amountTumbo: 20_000 });
  L.receive({ intentTxId: d.txId, by: "u:alice" });
  const a0 = L.balance("u:alice");
  const r = L.save({ owner: "u:alice", goal: "moon-trip", amountFluff: T(1000), idem: "sv1" });
  assert.equal(L.balance("u:alice:save:moon-trip"), T(1000));
  assert.equal(L.balance("u:alice"), a0 - T(1000));
  advance(L, REVERSE_WINDOW_TICKS + 50); // save has NO window
  assert.throws(() => L.reverse({ txId: r.txId, by: "u:bob" }), (e) => e.code === "NOT_AUTHORIZED");
  L.reverse({ txId: r.txId, by: "u:alice" });
  assert.equal(L.balance("u:alice"), a0 - (REVERSE_WINDOW_TICKS + 50)); // dust
  L.verifyInvariants();
});

test("sweep cancels expired intents (gate-required)", () => {
  const L = funded();
  const a0 = L.balance("u:alice");
  const q = L.payreq({ issuer: "u:alice", recipient: "u:bob", amountFluff: T(15), expiresInTicks: 5, idem: "pqX" });
  assert.throws(() => L.sweep({ gate: "nope" }), (e) => e.code === "GATE_DENIED");
  advance(L, 6);
  const out = L.sweep({ gate: GATE_SYSTEM });
  assert.equal(out.length, 1);
  assert.equal(L.tx(q.txId).state, "cancelled");
  assert.equal(L.balance("u:alice"), a0 - 6); // dust from time-advance sends
  assert.equal(L.balance(SYS.escrow, "TUMBO"), 0);
});

test("faucet drip + proof-of-presence grant, both claimed via receive", () => {
  const L = funded();
  L.ensureAccount("u:dave");
  const drip = L.faucetDrip({ to: "u:dave", amountTumbo: 1000 });
  L.receive({ intentTxId: drip.txId, by: "u:dave" });
  assert.equal(L.balance("u:dave"), T(1000));
  assert.throws(() => L.faucetDrip({ to: "u:dave", amountTumbo: 1000 }), (e) => e.code === "FAUCET_COOLDOWN");

  const g = L.grantPop({ to: "u:dave", achievement: "first-district", gate: GATE_SYSTEM });
  assert.throws(() => L.grantPop({ to: "u:dave", achievement: "first-district", gate: GATE_SYSTEM }),
    (e) => e.code === "POP_CLAIMED");
  assert.throws(() => L.grantPop({ to: "u:dave", achievement: "x", gate: "bad" }), (e) => e.code === "GATE_DENIED");
  L.receive({ intentTxId: g.txId, by: "u:dave" });
  assert.equal(L.balance("u:dave"), T(1250));
});

test("tamper with any receipt breaks chain verification", () => {
  const L = funded();
  L.send({ from: "u:alice", to: "u:bob", amountFluff: T(1), idem: "tp1" });
  L.s.receipts[2].hash = "00".repeat(32);
  assert.throws(() => L.verifyChain(), (e) => e.code === "INVARIANT_CHAIN");
});

test("persistence round-trip + determinism: same seed + same ops = same ledger", async () => {
  const run = (seed) => {
    const L = new TumboLedger({ seed });
    for (const u of ["u:alice", "u:bob"]) L.ensureAccount(u);
    const d = L.faucetDrip({ to: "u:alice", amountTumbo: 5000 });
    L.receive({ intentTxId: d.txId, by: "u:alice" });
    L.send({ from: "u:alice", to: "u:bob", amountFluff: T(123), idem: "det1" });
    L.tip({ from: "u:bob", to: "u:alice", amountFluff: T(1), idem: "det2" });
    return L;
  };
  const A = run(777), B = run(777);
  assert.equal(A.serialize(), B.serialize());
  assert.equal(A.s.receipts.at(-1).hash, B.s.receipts.at(-1).hash);

  const fs = await import("node:fs");
  const path = "/tmp/tumbo-ledger-test.json";
  await saveFile(A, path);
  const C = await loadFile(path);
  assert.equal(C.serialize(), A.serialize());
  assert.ok(C.verifyInvariants());
  fs.unlinkSync(path);
});

// ---------------- x402 bot payments ----------------
function botSetup() {
  const L = funded(11, 200_000);
  const pay = new BotPay(L);
  pay.registerBot("courier", { initialTumbo: 50, gate: GATE_SYSTEM });
  pay.registerBot("gallery", { initialTumbo: 5, gate: GATE_SYSTEM });
  return { L, pay };
}
function get402(pay, args) {
  try { pay.request(args); assert.fail("expected 402"); }
  catch (e) { assert.ok(e instanceof Pay402); assert.equal(e.code, 402); return e.challenge; }
}

test("x402: request -> 402 -> pay -> 200 fulfill", () => {
  const { L, pay } = botSetup();
  const tok = pay.issueToken("courier");
  const ch = get402(pay, { fromBot: "courier", service: "gallery", resource: "cube.render" });
  assert.equal(ch.priceFluff, 20);
  const g0 = L.balance("b:gallery");
  const rc = pay.pay({ challengeId: ch.challengeId, authToken: tok });
  assert.equal(rc.action, "tip");
  assert.equal(L.balance("b:gallery"), g0 + 20);
  const res = pay.fulfill({ challengeId: ch.challengeId, receiptHash: rc.hash,
    handler: () => ({ frame: 1 }) });
  assert.equal(res.status, 200);
  assert.deepEqual(res.result, { frame: 1 });
  // receipt is a real EchoProof receipt in the chain
  assert.ok(L.verifyChain());
});

test("x402: free resource needs no payment; bad auth/nonce/expiry rejected", () => {
  const { L, pay } = botSetup();
  const free = pay.request({ fromBot: "courier", service: "gallery", resource: "unpriced.thing" });
  assert.equal(free.free, true);

  const tok = pay.issueToken("courier");
  const ch = get402(pay, { fromBot: "courier", service: "gallery", resource: "cube.message" });
  assert.throws(() => pay.pay({ challengeId: ch.challengeId, authToken: "wrong" }),
    (e) => e.code === "BAD_AUTH");
  const rc = pay.pay({ challengeId: ch.challengeId, authToken: tok });
  assert.throws(() => pay.pay({ challengeId: ch.challengeId, authToken: tok }),
    (e) => e.code === "NONCE_REUSED");
  assert.throws(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: "00".repeat(32) }),
    (e) => e.code === "RECEIPT_MISMATCH");

  // expired challenge
  const L2 = new TumboLedger({ seed: 12, strict: false });
  const pay2 = new BotPay(L2);
  pay2.registerBot("courier", { initialTumbo: 500, gate: GATE_SYSTEM });
  pay2.registerBot("gallery");
  const tok2 = pay2.issueToken("courier");
  const ch2 = get402(pay2, { fromBot: "courier", service: "gallery", resource: "arena.enter" });
  // advance 101 ticks with dust sends between funded accounts
  for (const u of ["u:alice", "u:bob"]) L2.ensureAccount(u);
  const fd = L2.faucetDrip({ to: "u:alice", amountTumbo: 10_000 });
  L2.receive({ intentTxId: fd.txId, by: "u:alice" });
  for (let i = 0; i < 101; i++) L2.send({ from: "u:alice", to: "u:bob", amountFluff: 1, idem: `e${i}` });
  assert.throws(() => pay2.pay({ challengeId: ch2.challengeId, authToken: tok2 }),
    (e) => e.code === "CHALLENGE_EXPIRED");
});

test("x402: spend velocity cap stops rapid drains", () => {
  const { pay } = botSetup();
  const tok = pay.issueToken("courier");
  pay.setPrice({ service: "gallery", resource: "cube.message", priceFluff: 6000,
                  authToken: pay.issueToken("gallery") });
  const c1 = get402(pay, { fromBot: "courier", service: "gallery", resource: "cube.message" });
  pay.pay({ challengeId: c1.challengeId, authToken: tok }); // 6000 ok
  const c2 = get402(pay, { fromBot: "courier", service: "gallery", resource: "cube.message" });
  assert.throws(() => pay.pay({ challengeId: c2.challengeId, authToken: tok }),
    (e) => e.code === "SPEND_CAP");
  assert.throws(() => pay.setPrice({ service: "gallery", resource: "cube.message",
    priceFluff: -5, authToken: pay.issueToken("gallery") }), (e) => e.code === "BAD_PRICE");
});

test("fmtTumbo display helper", () => {
  assert.equal(fmtTumbo(T(1)), "1.000");
  assert.equal(fmtTumbo(1500), "1.500");
});

// ---------------- adversarial regression tests (audit 2026-09-20) ----------------

test("REGRESSION forged quote cannot drain the market (UNKNOWN_QUOTE)", () => {
  const L = funded(21, 200_000);
  const evil = { qid: "q:forged", pair: "TUMBO/sMIMAS", num: 1_000_000, den: 1, expiresTick: 999_999_999 };
  assert.throws(() => L.buy({ by: "u:alice", assetIn: "TUMBO", assetOut: "sMIMAS",
    amountInFluff: T(21), quote: evil }), (e) => e.code === "UNKNOWN_QUOTE");
  assert.equal(L.balance(SYS.market, "sMIMAS"), 21_000_000 * FLUFF_PER_TUMBO); // inventory untouched
  const q = L.quote({ assetIn: "TUMBO", assetOut: "sMIMAS" }); // honest registry quote works
  const r = L.buy({ by: "u:alice", assetIn: "TUMBO", assetOut: "sMIMAS", amountInFluff: T(1), quote: q });
  assert.equal(r.action, "buy");
});

test("REGRESSION slippage tolerance is hard-capped (caller cannot widen it)", () => {
  const L = funded(22, 200_000);
  const q = L.quote({ assetIn: "TUMBO", assetOut: "sMIMAS" }); // stored terms = old rate
  L.setRate({ pair: "TUMBO/sMIMAS", num: 11, den: 10000, gate: GATE_SYSTEM }); // oracle +10% = 1000 bps
  assert.throws(() => L.buy({ by: "u:alice", assetIn: "TUMBO", assetOut: "sMIMAS",
    amountInFluff: T(1), quote: q, maxSlippageBps: 1_000_000 }), (e) => e.code === "SLIPPAGE");
});

test("REGRESSION system-account firewall: ungated moves fail, gated work", () => {
  const L = funded(23, 200_000);
  assert.throws(() => L.send({ from: SYS.treasury, to: "u:alice", amountFluff: 1000, idem: "fw1" }),
    (e) => e.code === "GATE_DENIED");
  assert.throws(() => L.tip({ from: SYS.faucet, to: "u:alice", amountFluff: 1000, idem: "fw2" }),
    (e) => e.code === "GATE_DENIED");
  assert.throws(() => L.send({ from: "u:alice", to: SYS.escrow, amountFluff: 1000, idem: "fw3" }),
    (e) => e.code === "SYSTEM_ACCOUNT");
  assert.throws(() => L.send({ from: "u:alice", to: SYS.vault, amountFluff: 1000, idem: "fw4" }),
    (e) => e.code === "SYSTEM_ACCOUNT");
  assert.throws(() => L.send({ from: "u:alice", to: SYS.void, amountFluff: 1000, idem: "fw5" }),
    (e) => e.code === "SYSTEM_ACCOUNT");
  assert.ok(!("fw1" in L.s.idem)); // failed attempts leave no residue
  const before = L.balance(SYS.treasury, "TUMBO");
  L.send({ from: "u:alice", to: SYS.treasury, amountFluff: 1000, idem: "fw6" }); // donations allowed
  assert.equal(L.balance(SYS.treasury, "TUMBO"), before + 1000);
  L.send({ from: SYS.treasury, to: "u:alice", amountFluff: 1000, idem: "fw7", gate: GATE_SYSTEM });
  assert.equal(L.balance(SYS.treasury, "TUMBO"), before);
});

test("REGRESSION bot registration cannot self-fund from the faucet", () => {
  const L = funded(24, 200_000);
  const pay = new BotPay(L);
  assert.throws(() => pay.registerBot("greedy", { initialTumbo: 1_000_000 }),
    (e) => e.code === "GATE_DENIED");
  assert.equal(L.balance("b:greedy", "TUMBO"), 0);
  pay.registerBot("funded", { initialTumbo: 7, gate: GATE_SYSTEM });
  assert.equal(L.balance("b:funded", "TUMBO"), T(7));
});

test("REGRESSION failed commit rolls back: no partial state, ledger stays usable", () => {
  const L = funded(25, 200_000);
  const bA = L.balance("u:alice", "TUMBO"), bB = L.balance("u:bob", "TUMBO");
  const snap = { j: L.s.journal.length, r: L.s.receipts.length, seq: L.s.seq, clock: L._now() };
  const orig = L.verifyInvariants.bind(L);
  L.verifyInvariants = () => { throw new LedgerError("INVARIANT_X", "simulated post-commit failure"); };
  assert.throws(() => L.send({ from: "u:alice", to: "u:bob", amountFluff: 1000, idem: "rb1" }),
    (e) => e.code === "INVARIANT_X");
  L.verifyInvariants = orig;
  assert.equal(L.balance("u:alice", "TUMBO"), bA);
  assert.equal(L.balance("u:bob", "TUMBO"), bB);
  assert.equal(L.s.journal.length, snap.j);
  assert.equal(L.s.receipts.length, snap.r);
  assert.equal(L.s.seq, snap.seq);
  assert.equal(L._now(), snap.clock);
  assert.ok(!("rb1" in L.s.idem));
  L.send({ from: "u:alice", to: "u:bob", amountFluff: 1000, idem: "rb2" }); // still usable
  assert.equal(L.balance("u:bob", "TUMBO"), bB + 1000);
});

test("REGRESSION hand-edited balances fail load (journal replay binding)", () => {
  const L = funded(26, 200_000);
  L.send({ from: "u:alice", to: "u:bob", amountFluff: T(5), idem: "rp1" });
  const doc = JSON.parse(L.serialize());
  doc.accounts["u:bob"].balances.TUMBO -= T(5);   // supply-preserving off-journal edit
  doc.accounts["u:alice"].balances.TUMBO += T(5);
  assert.throws(() => TumboLedger.load(JSON.stringify(doc)), (e) => e.code === "INVARIANT_REPLAY");
  assert.ok(TumboLedger.load(L.serialize()).verifyInvariants()); // untouched loads fine
});

test("REGRESSION only the service bot sets its own prices", () => {
  const L = funded(27, 200_000);
  const pay = new BotPay(L);
  pay.registerBot("courier", { initialTumbo: 50, gate: GATE_SYSTEM });
  pay.registerBot("gallery", { initialTumbo: 5, gate: GATE_SYSTEM });
  const gtok = pay.issueToken("gallery");
  const ctok = pay.issueToken("courier");
  assert.throws(() => pay.setPrice({ service: "gallery", resource: "cube.message",
    priceFluff: 1, authToken: ctok }), (e) => e.code === "BAD_AUTH");
  pay.setPrice({ service: "gallery", resource: "cube.message", priceFluff: 6000, authToken: gtok });
  assert.equal(pay.priceFor("gallery", "cube.message"), 6000);
  const L2 = TumboLedger.load(L.serialize()); // overrides persist with the ledger
  const pay2 = new BotPay(L2); pay2.wallets = pay.wallets; // wallets are memory-only by design
  assert.equal(pay2.priceFor("gallery", "cube.message"), 6000);
});

test("REGRESSION fulfill re-checks expiry (paid but stale challenge)", () => {
  const L = funded(28, 200_000);
  const pay = new BotPay(L);
  pay.registerBot("courier", { initialTumbo: 50, gate: GATE_SYSTEM });
  pay.registerBot("gallery", { initialTumbo: 5, gate: GATE_SYSTEM });
  const tok = pay.issueToken("courier");
  const ch = get402(pay, { fromBot: "courier", service: "gallery", resource: "cube.render" });
  const r = pay.pay({ challengeId: ch.challengeId, authToken: tok }); // paid in time
  advance(L, 101); // challenge expires (100-tick TTL)
  assert.throws(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: r.hash }),
    (e) => e.code === "CHALLENGE_EXPIRED");
});

// ---------------- code-review regression tests (audit #2, 2026-09-20) ----------------

test("REGRESSION idem reuse across intents fails closed (IDEM_MISMATCH, H1)", () => {
  const L = funded(31, 200_000);
  L.payreq({ issuer: "u:alice", recipient: "u:bob", amountFluff: T(10), idem: "pq-dup" });
  // same idem, DIFFERENT payload (refs differ) => must not replay the wrong receipt
  assert.throws(() => L.payreq({ issuer: "u:alice", recipient: "u:carol", amountFluff: T(10), idem: "pq-dup" }),
    (e) => e.code === "IDEM_MISMATCH");
  // receive: same idem across two intents fails closed too
  const q1 = L.payreq({ issuer: "u:alice", recipient: "u:bob", amountFluff: T(5), idem: "pq-a" });
  const q2 = L.payreq({ issuer: "u:alice", recipient: "u:bob", amountFluff: T(5), idem: "pq-b" });
  const r1 = L.receive({ intentTxId: q1.txId, by: "u:bob", idem: "recvX" });
  assert.throws(() => L.receive({ intentTxId: q2.txId, by: "u:bob", idem: "recvX" }),
    (e) => e.code === "IDEM_MISMATCH");
  // q2 is untouched: still pending, funds still escrowed, ledger consistent
  assert.equal(L.s.intents[q2.txId].state, "pending");
  assert.ok(L.verifyInvariants());
  // same-intent retry after settlement is fail-closed (no phantom receipt)
  assert.throws(() => L.receive({ intentTxId: q1.txId, by: "u:bob", idem: "recvX" }),
    (e) => e.code === "INTENT_NOT_PENDING");
  assert.equal(L.s.intents[q1.txId].settleTx, r1.txId); // bookkeeping untouched
  assert.ok(L.verifyInvariants());
});

test("REGRESSION receipt<->journal linkage: truncation and tamper detected (M2)", () => {
  const L = funded(32, 200_000);
  L.send({ from: "u:alice", to: "u:bob", amountFluff: T(3), idem: "lk1" });
  // tail truncation of receipts
  const L2 = TumboLedger.load(L.serialize());
  L2.s.receipts.pop();
  assert.throws(() => L2.verifyInvariants(), (e) => e.code === "INVARIANT_LINK");
  // receipt entry tamper: the receipt's sealed hash no longer matches its body.
  // The journal is clean, so journal->receipt linkage holds; the violation is
  // the receipt's own chain integrity -> INVARIANT_CHAIN (via verifyChain).
  const L3 = TumboLedger.load(L.serialize());
  L3.s.receipts[2].entries[0].delta = "1";
  assert.throws(() => L3.verifyInvariants(), (e) => e.code === "INVARIANT_CHAIN");
  // journal refs tamper (rewriting reversedBy / intentOf)
  const L4 = TumboLedger.load(L.serialize());
  L4.s.journal[2].refs.intentOf = "tx-999999";
  assert.throws(() => L4.verifyInvariants(), (e) => e.code === "INVARIANT_LINK");
  // journal entry tamper is caught (replay diverges)
  const L5 = TumboLedger.load(L.serialize());
  L5.s.journal[2].entries[1].delta += 1;
  assert.throws(() => L5.verifyInvariants(), (e) => e.code === "INVARIANT_REPLAY");
});

test("REGRESSION receipt meta is an independent copy (M3)", () => {
  const L = funded(33, 200_000);
  const r = L.send({ from: "u:alice", to: "u:bob", amountFluff: T(1), idem: "mc1", memo: "hi" });
  const tx = L.tx(r.txId);
  assert.notEqual(r.meta, tx.meta);           // not aliased...
  assert.deepEqual(r.meta, tx.meta);          // ...but equal content
  tx.meta.memo = "mutated-after-seal";        // post-commit journal edit...
  assert.equal(r.meta.memo, "hi");            // ...does not touch the receipt
  assert.ok(L.verifyChain());                 // receipt still verifies on its own
});

test("REGRESSION money math is exact past 2^53 (L1)", () => {
  // float Math.floor(100000000000004*9999/10000) = 99990000000004, exact = ...003
  assert.equal(mulDivFloor(100000000000004, 9999, 10000), 99990000000003);
  const L = funded(34, 200_000);
  const amt = 100000000000004; // 100M TUMBO: treasury-funded (gated)
  L.send({ from: SYS.treasury, to: "u:alice", amountFluff: amt, idem: "whale", gate: GATE_SYSTEM });
  L.stake({ owner: "u:alice", contractId: "arena:x", amountFluff: amt, slashBps: 9999, idem: "stx" });
  const before = L.balance(SYS.vault, "TUMBO");
  L.slash({ stakeId: `stake-tx-000004`, gate: GATE_ARBITER });
  assert.equal(L.balance(SYS.void, "TUMBO"), 99990000000003); // exact, not float-off-by-one
  assert.equal(L.balance(SYS.vault, "TUMBO"), before - amt); // books still balance
});

test("REGRESSION setRate rejects non-integer/extreme rates (L2)", () => {
  const L = funded(35, 200_000);
  assert.throws(() => L.setRate({ pair: "TUMBO/sMIMAS", num: 1.5, den: 1000, gate: GATE_SYSTEM }),
    (e) => e.code === "UNSAFE_AMOUNT");
  assert.throws(() => L.setRate({ pair: "TUMBO/sMIMAS", num: Infinity, den: 1000, gate: GATE_SYSTEM }),
    (e) => e.code === "UNSAFE_AMOUNT");
  assert.throws(() => L.setRate({ pair: "TUMBO/sMIMAS", num: 0, den: 1000, gate: GATE_SYSTEM }),
    (e) => e.code === "BAD_RATE");
  assert.throws(() => L.setRate({ pair: "TUMBO/sMIMAS", num: 2e15, den: 1, gate: GATE_SYSTEM }),
    (e) => e.code === "BAD_RATE");
  L.setRate({ pair: "TUMBO/sMIMAS", num: 11, den: 10000, gate: GATE_SYSTEM }); // sane rate works
  assert.equal(L.s.oracle["TUMBO/sMIMAS"].num, 11);
});

test("REGRESSION strict flag survives persistence (L5)", () => {
  const L = new TumboLedger({ seed: 36, strict: false });
  const L2 = TumboLedger.load(L.serialize());
  assert.equal(L2.strict, false);
  const L3 = new TumboLedger({ seed: 36, strict: true });
  assert.equal(TumboLedger.load(L3.serialize()).strict, true);
});

test("REGRESSION quote() consumes no PRNG; default ids stay deterministic (L4)", () => {
  const mk = () => { const L = new TumboLedger({ seed: 37 }); L.ensureAccount("u:a"); L.ensureAccount("u:b"); return L; };
  const A = mk(), B = mk();
  A.faucetDrip({ to: "u:a", amountTumbo: 5000 }); A.receive({ intentTxId: A.s.journal[1].id, by: "u:a" });
  B.faucetDrip({ to: "u:a", amountTumbo: 5000 }); B.receive({ intentTxId: B.s.journal[1].id, by: "u:a" });
  A.quote({ assetIn: "TUMBO", assetOut: "sMIMAS" }); // read-only-ish call on A only
  A.send({ from: "u:a", to: "u:b", amountFluff: 7 }); // default idem on both
  B.send({ from: "u:a", to: "u:b", amountFluff: 7 });
  assert.equal(A.s.journal[3].idem, B.s.journal[3].idem); // quote did not shift idem stream
});

test("REGRESSION fulfill rejects forged memo prefix (L7)", () => {
  const L = funded(38, 200_000);
  const pay = new BotPay(L);
  pay.registerBot("courier", { initialTumbo: 50, gate: GATE_SYSTEM });
  pay.registerBot("gallery", { initialTumbo: 5, gate: GATE_SYSTEM });
  const ch = get402(pay, { fromBot: "courier", service: "gallery", resource: "cube.render" });
  const r = pay.pay({ challengeId: ch.challengeId, authToken: pay.issueToken("courier") });
  const stored = L.s.receipts.find(x => x.txId === r.txId); // attacker prefixes the memo
  stored.meta.memo = "forged-prefix-" + stored.meta.memo;
  assert.throws(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: r.hash }),
    (e) => e.code === "NONCE_MISMATCH");
});

test("REGRESSION failed vault exit rolls back journal too (H2)", () => {
  const L = funded(39, 200_000);
  const { stakeId } = L.stake({ owner: "u:alice", contractId: "c9", amountFluff: T(100),
    unlockInTicks: 5, idem: "st9" });
  advance(L, 6); // past unlockTick so unstake reaches the commit path
  const origHash = L.s.receipts[2].hash;
  L.s.receipts[2].hash = "tampered"; // corrupt the chain under the vault exit
  const jlen = L.s.journal.length, rlen = L.s.receipts.length;
  assert.throws(() => L.unstake({ stakeId, by: "u:alice" }),
    (e) => e.code === "INVARIANT_LINK" || e.code === "INVARIANT_CHAIN"); // tamper caught mid-commit
  assert.equal(L.s.journal.length, jlen);   // no phantom journal from the failed exit
  assert.equal(L.s.receipts.length, rlen);
  assert.ok(!Object.keys(L.s.idem).some(k => k.startsWith("unstake:"))); // no idem residue
  assert.equal(L.s.stakes[stakeId].status, "active"); // hold untouched
  L.s.receipts[2].hash = origHash; // repair the tamper the honest way
  assert.ok(L.verifyInvariants()); // ledger fully healthy: the failed exit left nothing
});

/* ================= residual-finding regressions (3rd audit) ================= */

test("REGRESSION N3: default swap idem has entropy — two identical buys are two trades", () => {
  const L = funded();
  const q = L.quote({ assetIn: "TUMBO", assetOut: "sMIMAS" });
  const n0 = L.s.journal.length;
  const b1 = L.buy({ by: "u:alice", amountInFluff: T(100), quote: q });
  const b2 = L.buy({ by: "u:alice", amountInFluff: T(100), quote: q });
  assert.notEqual(b1.txId, b2.txId); // not a silent replay
  assert.equal(L.s.journal.length, n0 + 2);
  // explicit idem still gives idempotent replay
  const b3 = L.buy({ by: "u:alice", amountInFluff: T(50), quote: q, idem: "buy-explicit" });
  const b4 = L.buy({ by: "u:alice", amountInFluff: T(50), quote: q, idem: "buy-explicit" });
  assert.equal(b3.txId, b4.txId);
  assert.ok(L.verifyInvariants());
});

test("REGRESSION N4: quote idem squatting rejected (QUOTE_EXISTS)", () => {
  const L = funded();
  L.quote({ assetIn: "TUMBO", assetOut: "sMIMAS", idem: "mine" });
  assert.throws(() => L.quote({ assetIn: "TUMBO", assetOut: "sMIMAS", idem: "mine" }),
    (e) => e.code === "QUOTE_EXISTS");
  assert.ok(L.verifyInvariants());
});

test("REGRESSION N5: corrupt oracle fails LOAD with a clean LedgerError (INVARIANT_ORACLE)", () => {
  const L = funded();
  const obj = JSON.parse(L.serialize());
  obj.oracle["TUMBO/sMIMAS"].den = 0; // hand-edited save file
  assert.throws(() => TumboLedger.load(JSON.stringify(obj)),
    (e) => e.code === "INVARIANT_ORACLE"); // not a raw RangeError from division
});

test("REGRESSION N1: Burrow Score overflow throws BEFORE fund release", () => {
  const L = funded();
  advance(L, 11); // before the deposit: alice still has funds for dust sends
  const { depositId } = L.deposit({ owner: "u:alice", amountFluff: L.balance("u:alice", "TUMBO"),
    maturityTicks: 10, idem: "depN1" }); // 100k TUMBO: score math overflows at huge held
  const vault0 = L.balance(SYS.vault, "TUMBO"), j0 = L.s.journal.length;
  L.s.clock = 2e15; // simulate extreme elapsed ticks
  assert.throws(() => L.withdraw({ depositId, by: "u:alice" }), (e) => e.code === "UNSAFE_AMOUNT");
  assert.equal(L.s.deposits[depositId].status, "locked"); // nothing mutated
  assert.equal(L.balance(SYS.vault, "TUMBO"), vault0);
  assert.equal(L.s.journal.length, j0);
  assert.ok(!L.s.burrowScore["u:alice"]); // no partial score credit
});
