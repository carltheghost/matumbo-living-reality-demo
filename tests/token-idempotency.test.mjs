// TUMBO-SIM token idempotency + event-wave regression tests (part 03).
// Run: node --test tests/token-idempotency.test.mjs
//
// Covers the audit fixes (2026-09-20):
//   - exactly one event wave per settlement (facade onCommit subscription;
//     no double-dispatch via boot; direct ledger commits emit too)
//   - wrapper-returning actions (stake/deposit/lock/withdraw) emit well-formed
//     receipt waves
//   - faucetDrip / grantPop honor explicit client idempotency keys
//   - vault exits (unstake/slash/withdraw/unlock) replay the original receipt
//     on explicit-key retry; withdraw never double-credits Burrow Score
//   - boot funds u:visitor + b:guide (b:guide has kind "bot")
import { test } from "node:test";
import assert from "node:assert/strict";
import { TumboLedger, SYS, GATE_SYSTEM, GATE_ARBITER } from "../src/domains/token.js";
import { createTokenFacade } from "../src/domains/token-facade.js";
import { bootToken } from "../src/domains/token-boot.js";

const T = (n) => n * 1000; // TUMBO -> fluff

function funded(seed = 201, tumbo = 100_000) {
  const L = new TumboLedger({ seed });
  for (const u of ["u:alice", "u:bob"]) L.ensureAccount(u);
  const drip = L.faucetDrip({ to: "u:alice", amountTumbo: tumbo });
  L.receive({ intentTxId: drip.txId, by: "u:alice" });
  return L;
}
function advance(L, n, a = "u:alice", b = "u:bob") {
  for (let i = 0; i < n; i++)
    L.send({ from: a, to: b, amountFluff: 1, idem: `adv-idem:${L._now()}:${i}` });
}

test("event wave: direct ledger commit (bypassing execute) emits exactly one wave", () => {
  const L = funded();
  const F = createTokenFacade(L);
  let receipts = 0, changes = 0;
  F.on("receipt", () => receipts++);
  F.on("balance-changed", () => changes++);
  const r = L.send({ from: "u:alice", to: "u:bob", amountFluff: 100, idem: "direct-wave-1" });
  assert.equal(r.action, "send");
  assert.equal(receipts, 1);
  assert.equal(changes, 2);
});

test("event wave: execute(stake) returns wrapper; the wave carries the sealed receipt", () => {
  const L = funded();
  const F = createTokenFacade(L);
  const seen = [];
  F.on("receipt", (d) => seen.push(d));
  F.on("balance-changed", (d) => seen.push(d));
  const out = F.execute("stake", { owner: "u:alice", contractId: "arena-9", amountFluff: T(100), idem: "fx-stake-1" });
  assert.ok(out.receipt, "stake returns a wrapper holding the sealed receipt");
  assert.ok(out.stakeId, "stake returns the stake id");
  assert.equal(out.receipt.action, "stake");
  const receipts = seen.filter((d) => d.type === "receipt");
  const changes = seen.filter((d) => d.type === "balance-changed");
  assert.equal(receipts.length, 1, "exactly one receipt event");
  assert.equal(receipts[0].txId, out.receipt.txId);
  assert.equal(receipts[0].action, "stake");
  assert.ok(receipts[0].hash);
  assert.deepEqual(changes.map((c) => c.account).sort(), [SYS.vault, "u:alice"]);
  const vault = changes.find((c) => c.account === SYS.vault);
  assert.equal(vault.delta, T(100));
  assert.equal(vault.balance, T(100));
  assert.ok(L.verifyInvariants());
});

test("event wave: execute replay emits no second wave", () => {
  const L = funded();
  const F = createTokenFacade(L);
  let receipts = 0;
  F.on("receipt", () => receipts++);
  F.execute("send", { from: "u:alice", to: "u:bob", amountFluff: 50, idem: "fx-replay-1" });
  F.execute("send", { from: "u:alice", to: "u:bob", amountFluff: 50, idem: "fx-replay-1" });
  assert.equal(receipts, 1);
});

test("boot: demo genesis funds visitor+guide; b:guide is kind bot; one wave via execute", () => {
  const F = bootToken({ persist: false });
  assert.equal(F.balance("u:visitor"), T(1000));
  assert.equal(F.balance("b:guide"), T(1000));
  assert.equal(F.ledger.s.accounts["u:visitor"].kind, "user");
  assert.equal(F.ledger.s.accounts["b:guide"].kind, "bot");
  assert.ok(F.ledger.verifyInvariants());
  // The boot wiring (facade onCommit + persistence-only boot listener) emits
  // exactly one wave for an execute() call — no double-dispatch.
  let receipts = 0, changes = 0;
  F.on("receipt", () => receipts++);
  F.on("balance-changed", () => changes++);
  const r = F.execute("send", { from: "u:visitor", to: "b:guide", amountFluff: 100, idem: "boot-wave-1" });
  assert.equal(r.action, "send");
  assert.equal(receipts, 1);
  assert.equal(changes, 2);
  assert.ok(F.ledger.verifyInvariants());
});

test("faucetDrip: explicit idem retry returns the original receipt (no second drip)", () => {
  const L = funded();
  L.ensureAccount("u:dave");
  const r1 = L.faucetDrip({ to: "u:dave", amountTumbo: 1000, idem: "faucet:dave:explicit" });
  const jlen = L.s.journal.length;
  const r2 = L.faucetDrip({ to: "u:dave", amountTumbo: 1000, idem: "faucet:dave:explicit" });
  assert.equal(r1.txId, r2.txId);
  assert.equal(r1.hash, r2.hash);
  assert.equal(L.s.journal.length, jlen, "replay appends no journal entry");
  assert.equal(L.s.intents[r1.txId].state, "pending", "the pending intent was not duplicated");
  assert.ok(L.verifyInvariants());
});

test("grantPop: same explicit idem replays; different key or no key is POP_CLAIMED", () => {
  const L = funded();
  L.ensureAccount("u:dave");
  const g1 = L.grantPop({ to: "u:dave", achievement: "first-cube", gate: GATE_SYSTEM, idem: "pop:dave:explicit" });
  const jlen = L.s.journal.length;
  const g2 = L.grantPop({ to: "u:dave", achievement: "first-cube", gate: GATE_SYSTEM, idem: "pop:dave:explicit" });
  assert.equal(g1.txId, g2.txId);
  assert.equal(L.s.journal.length, jlen, "replay appends no journal entry");
  // a different key for the same achievement is a duplicate claim, not a replay
  assert.throws(() => L.grantPop({ to: "u:dave", achievement: "first-cube", gate: GATE_SYSTEM, idem: "pop:dave:other" }),
    (e) => e.code === "POP_CLAIMED");
  // no explicit key: duplicate claim still rejected (existing behavior)
  assert.throws(() => L.grantPop({ to: "u:dave", achievement: "first-cube", gate: GATE_SYSTEM }),
    (e) => e.code === "POP_CLAIMED");
  assert.ok(L.verifyInvariants());
});

test("vault exits: explicit-idem retry returns the original receipt", () => {
  const L = funded();
  // unstake
  const { stakeId } = L.stake({ owner: "u:alice", contractId: "c-r1", amountFluff: T(100), unlockInTicks: 5, idem: "st-r1" });
  advance(L, 6);
  const u1 = L.unstake({ stakeId, by: "u:alice", idem: "unstake:explicit:1" });
  const u2 = L.unstake({ stakeId, by: "u:alice", idem: "unstake:explicit:1" });
  assert.equal(u1.txId, u2.txId);
  assert.equal(u1.hash, u2.hash);
  // slash
  const s = L.stake({ owner: "u:alice", contractId: "c-r2", amountFluff: T(100), idem: "st-r2" });
  const sl1 = L.slash({ stakeId: s.stakeId, gate: GATE_ARBITER, idem: "slash:explicit:1" });
  const sl2 = L.slash({ stakeId: s.stakeId, gate: GATE_ARBITER, idem: "slash:explicit:1" });
  assert.equal(sl1.txId, sl2.txId);
  // unlock
  const lk = L.lock({ owner: "u:alice", amountFluff: T(50), unlockInTicks: 5, idem: "lk-r1" });
  advance(L, 6);
  const k1 = L.unlock({ lockId: lk.lockId, by: "u:alice", idem: "unlock:explicit:1" });
  const k2 = L.unlock({ lockId: lk.lockId, by: "u:alice", idem: "unlock:explicit:1" });
  assert.equal(k1.txId, k2.txId);
  assert.ok(L.verifyInvariants());
});

test("withdraw replay does not double-credit Burrow Score", () => {
  const L = funded();
  const { depositId } = L.deposit({ owner: "u:alice", amountFluff: T(200), termTicks: 5, idem: "dep-r1" });
  advance(L, 6);
  const w1 = L.withdraw({ depositId, by: "u:alice", idem: "withdraw:explicit:1" });
  const score1 = L.s.burrowScore["u:alice"];
  assert.ok(score1 > 0);
  const w2 = L.withdraw({ depositId, by: "u:alice", idem: "withdraw:explicit:1" });
  assert.equal(w1.receipt.txId, w2.receipt.txId);
  assert.equal(w2.burrowScore, score1);
  assert.equal(L.s.burrowScore["u:alice"], score1, "Burrow Score credited exactly once");
  assert.ok(L.verifyInvariants());
});

test("vault exits without explicit idem still fail closed on a closed position", () => {
  const L = funded();
  const { stakeId } = L.stake({ owner: "u:alice", contractId: "c-r3", amountFluff: T(100), unlockInTicks: 5, idem: "st-r3" });
  advance(L, 6);
  L.unstake({ stakeId, by: "u:alice" }); // default key
  assert.throws(() => L.unstake({ stakeId, by: "u:alice" }), (e) => e.code === "STAKE_CLOSED");
  assert.ok(L.verifyInvariants());
});
