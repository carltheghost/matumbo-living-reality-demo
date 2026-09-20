/**
 * Token lifecycle tests (node:test).
 *
 * Covers the TUMBO-SIM lifecycle slice:
 *  - reverse within the bounded window posts a compensating journal
 *    (history is never edited)
 *  - reverse after window expiry fails closed
 *  - double-reverse is impossible (deterministic idempotency key)
 *  - cancel of a settled tx fails closed; cancel of pending works
 *  - chain-tamper detection via recomputed hashes and prevHash links
 *
 * Run: node --test tests/token-lifecycle.test.mjs
 * Simulation only — no real value, no network, no wallets.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  TOKEN_CONFIG,
  createTumboToken,
  fmtFluff,
  sha256Hex,
  TokenError,
  InsufficientFundsError,
  ReverseWindowExpiredError,
  AlreadyReversedError,
  CancelRejectedError,
  JournalNotFoundError,
} from "../src/domains/token.js";

const WINDOW = TOKEN_CONFIG.REVERSE_WINDOW_TICKS;

/** Fresh facade with u:alice funded from sys:treasury. */
function funded(aliceFluff = 50_000, asset = "TUMBO") {
  const t = createTumboToken();
  t.execute({
    action: "send",
    asset,
    from: "sys:treasury",
    to: "u:alice",
    amountFluff: aliceFluff,
    idempotencyKey: `fund-alice-${asset}`,
  });
  return t;
}

function tickForward(t, n, prefix = "tick") {
  for (let i = 0; i < n; i += 1) {
    t.execute({
      action: "send",
      from: "sys:treasury",
      to: "sys:faucet",
      amountFluff: 1,
      idempotencyKey: `${prefix}-${i}`,
    });
  }
}

test("facade contract: { ledger, balance, fmt, on } with integer fluff units", () => {
  const t = createTumboToken();
  assert.equal(typeof t.balance, "function");
  assert.equal(typeof t.fmt, "function");
  assert.equal(typeof t.on, "function");
  assert.ok(t.ledger, "ledger exposed");
  // Supply comes from the ONE config constant; both assets derive from it.
  assert.equal(t.balance("sys:treasury", "TUMBO"), TOKEN_CONFIG.SUPPLY_FLUFF);
  assert.equal(t.balance("sys:treasury", "sMIMAS"), TOKEN_CONFIG.SUPPLY_FLUFF);
  assert.equal(TOKEN_CONFIG.FLUFF_PER_UNIT, 1000, "1 TUMBO-SIM = 1000 fluff");
});

test("sha256 matches the standard test vector", () => {
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("fmt renders exact decimals without floats", () => {
  assert.equal(fmtFluff(1500), "1.500 TUMBO-SIM");
  assert.equal(fmtFluff(1), "0.001 TUMBO-SIM");
  assert.equal(fmtFluff(0, "sMIMAS"), "0.000 sMIMAS-SIM");
});

test("send posts a balanced journal and moves balances", () => {
  const t = funded();
  const before = t.balance("u:alice");
  const res = t.execute({
    action: "send",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 1500,
    idempotencyKey: "send-1",
  });
  assert.equal(res.replayed, false);
  assert.equal(res.journal.state, "settled");
  assert.equal(t.balance("u:alice"), before - 1500);
  assert.equal(t.balance("u:bob"), 1500);
  const sums = new Map();
  for (const p of res.journal.postings) {
    sums.set(p.asset, (sums.get(p.asset) ?? 0n) + BigInt(p.amountFluff));
  }
  for (const total of sums.values()) assert.equal(total, 0n, "journal sums to 0 per asset");
});

test("idempotency: replaying a key returns the original receipt", () => {
  const t = funded();
  const first = t.execute({
    action: "tip",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 700,
    idempotencyKey: "tip-once",
  });
  const count = t.ledger.journalCount;
  const again = t.execute({
    action: "tip",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 700,
    idempotencyKey: "tip-once",
  });
  assert.equal(again.replayed, true);
  assert.equal(again.journal.journalId, first.journal.journalId);
  assert.equal(again.receipt.payloadHash, first.receipt.payloadHash);
  assert.equal(t.ledger.journalCount, count, "no duplicate journal");
  assert.equal(t.balance("u:bob"), 700, "balance moved only once");
});

test("balances never go negative", () => {
  const t = funded(1000);
  assert.throws(
    () =>
      t.execute({
        action: "send",
        from: "u:alice",
        to: "u:bob",
        amountFluff: 1001,
        idempotencyKey: "overdraft",
      }),
    InsufficientFundsError
  );
  assert.equal(t.balance("u:alice"), 1000, "failed tx moved nothing");
});

test("sys:void is credited only by burns and never debited", () => {
  const t = funded();
  t.execute({
    action: "send",
    from: "u:alice",
    to: "sys:void",
    amountFluff: 500,
    idempotencyKey: "burn-1",
  });
  assert.equal(t.balance("sys:void"), 500);
  assert.throws(
    () =>
      t.execute({
        action: "send",
        from: "sys:void",
        to: "u:bob",
        amountFluff: 100,
        idempotencyKey: "void-debit",
      }),
    (err) => err instanceof TokenError && err.code === "void-debit"
  );
});

test("exchange is a balanced multi-asset journal", () => {
  const t = funded(100_000, "TUMBO");
  t.execute({
    action: "send",
    asset: "sMIMAS",
    from: "sys:treasury",
    to: "u:bob",
    amountFluff: 100_000,
    idempotencyKey: "fund-bob-smimas",
  });
  const res = t.execute({
    action: "exchange",
    asset: "TUMBO",
    assetB: "sMIMAS",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 2000,
    amountBFluff: 4000,
    idempotencyKey: "xchg-1",
  });
  const sums = new Map();
  for (const p of res.journal.postings) {
    sums.set(p.asset, (sums.get(p.asset) ?? 0n) + BigInt(p.amountFluff));
  }
  assert.equal(sums.get("TUMBO"), 0n);
  assert.equal(sums.get("sMIMAS"), 0n);
  assert.equal(t.balance("u:alice", "sMIMAS"), 4000);
  assert.equal(t.balance("u:bob", "TUMBO"), 2000);
});

test("reverse within the window posts a compensating journal, never edits history", () => {
  const t = funded();
  const tx = t.execute({
    action: "send",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 9000,
    idempotencyKey: "reversible",
  });
  const originalPostings = JSON.stringify(tx.journal.postings);
  const aliceBefore = t.balance("u:alice");
  const rev = t.reverse(tx.journal.journalId);
  assert.equal(rev.journal.action, "reverse");
  assert.equal(rev.journal.linkedJournalId, tx.journal.journalId);
  assert.equal(t.balance("u:alice"), aliceBefore + 9000, "funds restored");
  assert.equal(t.balance("u:bob"), 0);
  const original = t.journalOf(tx.journal.journalId);
  assert.equal(original.state, "reversed");
  assert.equal(original.reversedBy, rev.journal.journalId);
  assert.equal(JSON.stringify(original.postings), originalPostings, "original postings untouched");
  // The reversal itself is a balanced journal.
  const sum = rev.journal.postings.reduce((s, p) => s + BigInt(p.amountFluff), 0n);
  assert.equal(sum, 0n);
  assert.ok(t.verifyChain(), "chain still verifies after reversal");
});

test("double-reverse is impossible", () => {
  const t = funded();
  const tx = t.execute({
    action: "send",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 3000,
    idempotencyKey: "double-rev",
  });
  const first = t.reverse(tx.journal.journalId);
  // Same deterministic key replays the original reversal.
  const replay = t.reverse(tx.journal.journalId);
  assert.equal(replay.replayed, true);
  assert.equal(replay.journal.journalId, first.journal.journalId);
  // A fresh key against an already-reversed tx throws.
  assert.throws(() => t.reverse(tx.journal.journalId, { idempotencyKey: "sneaky" }), AlreadyReversedError);
  assert.equal(t.balance("u:bob"), 0, "no second compensation applied");
});

test("reverse after the window expires fails closed", () => {
  const t = funded();
  const tx = t.execute({
    action: "send",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 2500,
    idempotencyKey: "too-old",
  });
  tickForward(t, WINDOW + 1, "age");
  const age = t.tick() - tx.journal.tick;
  assert.ok(age > WINDOW, `aged ${age} ticks past the ${WINDOW}-tick window`);
  assert.throws(() => t.reverse(tx.journal.journalId), ReverseWindowExpiredError);
  const original = t.journalOf(tx.journal.journalId);
  assert.equal(original.state, "settled", "original tx untouched");
  assert.equal(t.balance("u:bob"), 2500, "no compensation posted");
});

test("reverse at exactly the window boundary still succeeds", () => {
  const t = funded();
  const tx = t.execute({
    action: "send",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 2500,
    idempotencyKey: "boundary",
  });
  tickForward(t, WINDOW, "edge");
  assert.equal(t.tick() - tx.journal.tick, WINDOW);
  const rev = t.reverse(tx.journal.journalId);
  assert.equal(rev.journal.action, "reverse");
  assert.equal(t.balance("u:bob"), 0);
});

test("cancel of a pending tx posts a compensating journal", () => {
  const t = funded();
  const tx = t.execute({
    action: "send",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 4000,
    idempotencyKey: "pending-1",
    settle: false,
  });
  assert.equal(tx.journal.state, "pending");
  const res = t.cancel(tx.journal.journalId);
  assert.equal(res.journal.action, "cancel");
  assert.equal(res.journal.linkedJournalId, tx.journal.journalId);
  assert.equal(t.journalOf(tx.journal.journalId).state, "cancelled");
  assert.equal(t.balance("u:bob"), 0, "pending effects voided");
  assert.ok(t.verifyChain());
});

test("cancel of a settled tx fails closed", () => {
  const t = funded();
  const tx = t.execute({
    action: "send",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 4000,
    idempotencyKey: "settled-1",
  });
  assert.equal(tx.journal.state, "settled");
  assert.throws(() => t.cancel(tx.journal.journalId), CancelRejectedError);
  assert.equal(t.journalOf(tx.journal.journalId).state, "settled", "tx untouched");
  assert.equal(t.balance("u:bob"), 4000, "balances untouched");
});

test("settle moves pending -> settled; double settle throws", () => {
  const t = funded();
  const tx = t.execute({
    action: "send",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 100,
    idempotencyKey: "pend-settle",
    settle: false,
  });
  assert.equal(t.settle(tx.journal.journalId).state, "settled");
  assert.throws(() => t.settle(tx.journal.journalId), TokenError);
});

test("history filters by action, account, and asset", () => {
  const t = funded(100_000, "TUMBO");
  t.execute({
    action: "send",
    asset: "sMIMAS",
    from: "sys:treasury",
    to: "u:alice",
    amountFluff: 9000,
    idempotencyKey: "fund-smimas",
  });
  t.execute({
    action: "tip",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 111,
    idempotencyKey: "tip-f",
  });
  t.execute({
    action: "send",
    asset: "sMIMAS",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 222,
    idempotencyKey: "smimas-f",
  });
  const tips = t.history({ action: "tip" });
  assert.equal(tips.total, 1);
  const alice = t.history({ account: "u:alice" });
  assert.ok(alice.total >= 3, "alice appears in several journals");
  assert.ok(alice.rows.every((r) => r.postings.some((p) => p.account === "u:alice")));
  const smimas = t.history({ asset: "sMIMAS" });
  assert.ok(smimas.total >= 2);
  assert.ok(smimas.rows.every((r) => r.postings.some((p) => p.asset === "sMIMAS")));
  const pending = t.history({ state: "pending" });
  assert.equal(pending.total, 0, "everything auto-settled");
});

test("receipt chain verifies; tampering is detected", () => {
  const t = funded();
  t.execute({
    action: "send",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 1234,
    idempotencyKey: "chain-1",
  });
  assert.ok(t.verifyChain(), "pristine chain verifies");
  const tx = t.history({ action: "send", account: "u:bob" }).rows[0];
  const v = t.verifyJournal(tx.journalId);
  assert.equal(v.ok, true);
  assert.ok(v.checks.length >= 5, "hash + prevHash checks present");

  // Tamper with a stored receipt hash: detection must fail closed.
  const tampered = createTumboToken();
  tampered.execute({
    action: "send",
    from: "sys:treasury",
    to: "u:alice",
    amountFluff: 10,
    idempotencyKey: "tamper-fund",
  });
  const victim = tampered.ledger._receipts[1];
  tampered.ledger._receipts[1] = { ...victim, afterHash: "00".repeat(32) };
  assert.equal(tampered.verifyChain(), false, "tampered afterHash detected");

  // Tamper with retained state: recomputation must fail.
  const tampered2 = createTumboToken();
  tampered2.execute({
    action: "send",
    from: "sys:treasury",
    to: "u:alice",
    amountFluff: 10,
    idempotencyKey: "tamper-fund-2",
  });
  tampered2.ledger._receiptStates[1].afterState["u:alice"]["TUMBO"] = "999999";
  assert.equal(tampered2.verifyChain(), false, "tampered state detected");
});

test("unknown journals and accounts fail loudly", () => {
  const t = createTumboToken();
  assert.throws(() => t.reverse("tx-999999"), JournalNotFoundError);
  assert.throws(() => t.cancel("nope"), JournalNotFoundError);
  assert.throws(
    () =>
      t.execute({
        action: "send",
        from: "hacker",
        to: "u:bob",
        amountFluff: 1,
        idempotencyKey: "bad-acct",
      }),
    (err) => err.code === "unknown-account"
  );
});

test("events fire for receipts and balance changes", () => {
  const t = funded();
  const seen = [];
  t.on("receipt", (e) => seen.push(["receipt", e.receipt.action]));
  t.on("balance-changed", (e) => seen.push(["balance-changed", e.account, e.asset, e.balance]));
  t.execute({
    action: "send",
    from: "u:alice",
    to: "u:bob",
    amountFluff: 500,
    idempotencyKey: "evt-1",
  });
  assert.ok(seen.some((s) => s[0] === "receipt" && s[1] === "send"));
  const bobEvt = seen.find((s) => s[0] === "balance-changed" && s[1] === "u:bob");
  assert.ok(bobEvt, "bob balance-changed fired");
  assert.equal(bobEvt[3], 500);
});
