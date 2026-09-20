/**
 * Token system-account firewall tests.
 *
 * Run: node --test tests/*.test.mjs
 *
 * Adversarial probes against the unified core (PR #6):
 * - direct ledger.post() cannot debit any sys:* account without authority
 * - the wallet adapter send() cannot be aimed at sys:* accounts
 * - internal engine paths (genesis, faucet, lock/unlock, quote settlement,
 *   reverse) still work with authority:"internal"
 * - sys:void is never debited, even with authority
 * Shared invariants (nonnegativity, per-asset Σ0, conservation) are asserted
 * after every probe.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createTokenEngine,
  TumboUserLedger,
  QuoteError,
} from "../src/domains/token.js";

const SYS_ACCOUNTS = ["sys:treasury", "sys:escrow", "sys:vault", "sys:market", "sys:faucet"];

function funded() {
  const eng = createTokenEngine();
  eng.faucet("u:alice", "TUMBO", 100_000_000, { idempotencyKey: "fw:fund-alice" });
  return eng;
}

function checkInvariants(ledger, label) {
  const totals = new Map();
  for (const [k, v] of ledger._balances) {
    const [acct] = k.split("|");
    // sys:issuance is the one intentionally negative account (opened with
    // allowNegative); everything else must stay nonnegative.
    if (acct !== "sys:issuance") {
      assert.ok(v >= 0, `${label}: negative balance ${k} = ${v}`);
    }
    const [, asset] = k.split("|");
    assert.ok(asset, `${label}: malformed balance key ${k}`);
    totals.set(asset, (totals.get(asset) ?? 0) + v);
  }
  for (const j of ledger._journals) {
    const sums = new Map();
    for (const p of j.postings) {
      sums.set(p.asset, (sums.get(p.asset) ?? 0) + p.amount);
    }
    for (const [asset, sum] of sums) {
      assert.equal(sum, 0, `${label}: journal ${j.id} does not sum to zero for ${asset}`);
    }
  }
}

describe("system-account firewall", () => {
  it("direct post() cannot debit any sys:* account without authority", () => {
    const eng = funded();
    for (const sys of SYS_ACCOUNTS) {
      // fund the sys account via an internal path first (faucet pays users only,
      // so seed through the engine's own internal posting)
      eng.ledger.post(
        [
          { account: "u:alice", asset: "TUMBO", amount: -1000 },
          { account: sys, asset: "TUMBO", amount: 1000 },
        ],
        { idempotencyKey: `fw:seed-${sys}`, action: "test-seed", authority: "internal" }
      );
      const beforeSys = eng.balance(sys, "TUMBO");
      const beforeAttacker = eng.balance("u:mallory", "TUMBO");
      assert.throws(
        () =>
          eng.ledger.post(
            [
              { account: sys, asset: "TUMBO", amount: -1000 },
              { account: "u:mallory", asset: "TUMBO", amount: 1000 },
            ],
            { idempotencyKey: `fw:drain-${sys}`, action: "attack" }
          ),
        /requires internal authority/,
        `expected firewall to block debit of ${sys}`
      );
      assert.equal(eng.balance(sys, "TUMBO"), beforeSys, `${sys} unchanged`);
      assert.equal(eng.balance("u:mallory", "TUMBO"), beforeAttacker, "attacker unchanged");
    }
    checkInvariants(eng.ledger, "firewall-probe");
  });

  it("same posting succeeds with authority:\"internal\"", () => {
    const eng = funded();
    eng.ledger.post(
      [
        { account: "u:alice", asset: "TUMBO", amount: -1000 },
        { account: "sys:escrow", asset: "TUMBO", amount: 1000 },
      ],
      { idempotencyKey: "fw:seed2", action: "test-seed", authority: "internal" }
    );
    const journal = eng.ledger.post(
      [
        { account: "sys:escrow", asset: "TUMBO", amount: -1000 },
        { account: "u:mallory", asset: "TUMBO", amount: 1000 },
      ],
      { idempotencyKey: "fw:internal-ok", action: "internal-op", authority: "internal" }
    );
    assert.ok(journal && journal.id, "internal posting commits");
    assert.equal(eng.balance("u:mallory", "TUMBO"), 1000);
    checkInvariants(eng.ledger, "internal-authority");
  });

  it("sys:void is never debited, even with authority", () => {
    const eng = funded();
    assert.throws(
      () =>
        eng.ledger.post(
          [
            { account: "sys:void", asset: "TUMBO", amount: -1 },
            { account: "u:mallory", asset: "TUMBO", amount: 1 },
          ],
          { idempotencyKey: "fw:void-debit", action: "attack", authority: "internal" }
        ),
      /never debited/
    );
    checkInvariants(eng.ledger, "void-firewall");
  });

  it("adapter send() cannot debit or credit sys:* accounts", () => {
    const eng = funded();
    const wallet = new TumboUserLedger(eng);
    assert.throws(
      () => wallet.send({ from: "sys:escrow", to: "alice", asset: "TUMBO-SIM", amountFluff: 100, idempotencyKey: "fw:s1" }),
      /user accounts/
    );
    assert.throws(
      () => wallet.send({ from: "alice", to: "sys:escrow", asset: "TUMBO-SIM", amountFluff: 100, idempotencyKey: "fw:s2" }),
      /user accounts/
    );
    assert.throws(
      () => wallet.send({ from: "sys:treasury", to: "alice", asset: "TUMBO-SIM", amountFluff: 100, idempotencyKey: "fw:s3" }),
      /user accounts/
    );
    assert.equal(eng.balance("sys:escrow", "TUMBO"), 0, "escrow untouched");
    assert.equal(eng.balance("sys:treasury", "TUMBO") > 0, true, "treasury intact");
    checkInvariants(eng.ledger, "adapter-send-guard");
  });

  it("internal engine flows still work: faucet, lock/unlock, quote settlement", () => {
    const eng = createTokenEngine();
    const wallet = new TumboUserLedger(eng);
    eng.faucet("u:alice", "TUMBO", 50_000_000, { idempotencyKey: "fw:flow-faucet" });
    const lock = wallet.lock({ acct: "alice", asset: "TUMBO-SIM", amountFluff: 1_000_000, label: "test lock" });
    assert.equal(eng.balance("sys:escrow", "TUMBO"), 1_000_000, "escrow credited by lock");
    const released = wallet.unlock(lock.id);
    assert.equal(released.status, "released");
    assert.equal(eng.balance("sys:escrow", "TUMBO"), 0, "escrow released by unlock");
    assert.equal(wallet.balance("alice", "TUMBO-SIM"), 50_000_000, "alice whole");

    // quote settlement debits sys:market and tithes sys:void
    const beforeVoid = eng.balance("sys:void", "TUMBO");
    const q = eng.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1_000_000 });
    const r = eng.execute(q, { idempotencyKey: "fw:flow-trade" });
    assert.ok(r && r.id, "quote executed");
    assert.ok(eng.balance("sys:void", "TUMBO") > beforeVoid, "void tithe collected");
    checkInvariants(eng.ledger, "internal-flows");
  });

  it("reverse of a lock still works through the internal path", () => {
    const eng = createTokenEngine();
    const wallet = new TumboUserLedger(eng);
    eng.faucet("u:alice", "TUMBO", 50_000_000, { idempotencyKey: "fw:rev-faucet" });
    const lock = wallet.lock({ acct: "alice", asset: "TUMBO-SIM", amountFluff: 2_000_000, label: "reversible" });
    const lockJournal = eng.ledger._journals.find((j) => j.id === lock.id);
    assert.ok(lockJournal, "lock journal found");
    // Reverse by the engine (internal authority): compensating journal debits escrow back.
    const rev = eng.reverse({ idempotencyKey: "fw:rev-lock", journalId: lock.id, actor: "u:alice" });
    assert.ok(rev && rev.id, "reversal posted");
    assert.equal(eng.balance("sys:escrow", "TUMBO"), 0, "escrow restored by reversal");
    assert.equal(wallet.balance("alice", "TUMBO-SIM"), 50_000_000, "alice restored by reversal");
    checkInvariants(eng.ledger, "reverse-flow");
  });
});
