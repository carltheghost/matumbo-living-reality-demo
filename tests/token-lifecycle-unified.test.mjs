/**
 * Token lifecycle (Part C) tests — ported semantics from the token-lifecycle
 * workstream, running against the unified core.
 *
 * Covers: reverse happy path + balance restoration, double-reverse
 * idempotency, reversal-of-reversal rejection, unknown/genesis rejection,
 * reverse-window expiry, Void-tithe absorption on market reversal,
 * cancel pending quote -> execute fails closed, cancel settled quote fails
 * closed, double-cancel idempotency, unknown-quote cancel, tick accounting,
 * receipt hash chain + tamper detection, journalHistory filters (no genesis
 * bypass), reverse/balance-changed events, adapter reverse(), and the new
 * facade surface.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createTokenEngine,
  TumboUserLedger,
  ensureTumboTokenFacade,
  QuoteError,
  AlreadyReversedError,
  ReverseWindowExpiredError,
  CancelRejectedError,
  JournalNotFoundError,
  REVERSE_WINDOW_TICKS,
  VOID_ACCOUNT,
  receiptChainHash,
} from "../src/domains/token.js";

const ALICE = "u:alice";
const BOB = "u:bob";

function fundedEngine(aliceFluff = 100_000) {
  const eng = createTokenEngine();
  const receipt = eng.faucet(ALICE, "TUMBO", aliceFluff, { idempotencyKey: "test:faucet-alice" });
  return { eng, faucetReceipt: receipt };
}

test("REVERSE_WINDOW_TICKS is the canonical 1000", () => {
  assert.equal(REVERSE_WINDOW_TICKS, 1000);
});

test("tick starts at 4 after genesis and bumps per committed journal", () => {
  const eng = createTokenEngine();
  assert.equal(eng.ledger.tick, 4);
  eng.faucet(ALICE, "TUMBO", 1000, { idempotencyKey: "t:1" });
  assert.equal(eng.ledger.tick, 5);
});

test("reverse happy path restores balances and links the reversal", () => {
  const { eng, faucetReceipt } = fundedEngine(50_000);
  const before = eng.balance(ALICE, "TUMBO");
  assert.equal(before, 50_000);

  const rev = eng.reverse({ idempotencyKey: faucetReceipt.idempotencyKey });
  assert.equal(rev.action, "reverse");
  assert.equal(rev.links.reverses, faucetReceipt.id);
  assert.equal(rev.links.reversesKey, faucetReceipt.idempotencyKey);
  assert.equal(eng.balance(ALICE, "TUMBO"), 0);
  assert.equal(eng.balance("sys:faucet", "TUMBO"), 500_000_000);

  // History was not edited: both journals are still listed.
  const hist = eng.journalHistory({});
  assert.ok(hist.rows.some((r) => r.id === faucetReceipt.id));
  assert.ok(hist.rows.some((r) => r.id === rev.id));
});

test("double-reverse is idempotent: same receipt, no extra fund movement", () => {
  const { eng, faucetReceipt } = fundedEngine(50_000);
  const first = eng.reverse({ idempotencyKey: faucetReceipt.idempotencyKey });
  const tickAfter = eng.ledger.tick;
  const second = eng.reverse({ idempotencyKey: faucetReceipt.idempotencyKey });
  assert.equal(second.id, first.id);
  assert.equal(eng.ledger.tick, tickAfter, "idempotent reverse must not post again");
  assert.equal(eng.balance(ALICE, "TUMBO"), 0);
});

test("reverse of a reversal is rejected", () => {
  const { eng, faucetReceipt } = fundedEngine(50_000);
  const rev = eng.reverse({ idempotencyKey: faucetReceipt.idempotencyKey });
  assert.throws(() => eng.reverse({ idempotencyKey: rev.idempotencyKey }), QuoteError);
});

test("reverse of unknown journal throws JournalNotFoundError", () => {
  const eng = createTokenEngine();
  assert.throws(() => eng.reverse({ idempotencyKey: "nope:missing" }), JournalNotFoundError);
  assert.throws(() => eng.reverse({ journalId: "rcpt_missing" }), JournalNotFoundError);
});

test("reverse of genesis journal is rejected", () => {
  const eng = createTokenEngine();
  assert.throws(() => eng.reverse({ idempotencyKey: "genesis:tumbo-supply" }), QuoteError);
});

test("reverse by journal id also works", () => {
  const { eng, faucetReceipt } = fundedEngine(10_000);
  const rev = eng.reverse({ journalId: faucetReceipt.id });
  assert.equal(rev.action, "reverse");
  assert.equal(eng.balance(ALICE, "TUMBO"), 0);
});

test("reverse window expiry fails closed after 1000 ticks", () => {
  const eng = createTokenEngine();
  const r = eng.faucet(ALICE, "TUMBO", 200_000, { idempotencyKey: "w:fund" });
  // Advance 1001 journals: 1 fluff per send, alice -> bob.
  for (let i = 0; i < 1001; i++) {
    eng.ledger.post(
      [
        { account: ALICE, asset: "TUMBO", amount: -1 },
        { account: BOB, asset: "TUMBO", amount: 1 },
      ],
      { idempotencyKey: `w:send:${i}`, action: "send" }
    );
  }
  const age = eng.ledger.tick - r.tick;
  assert.ok(age > REVERSE_WINDOW_TICKS, `expected age ${age} > 1000`);
  assert.throws(() => eng.reverse({ idempotencyKey: "w:fund" }), ReverseWindowExpiredError);
});

test("market reversal absorbs the Void tithe; sys:void is never debited", () => {
  const eng = createTokenEngine();
  eng.faucet(ALICE, "TUMBO", 100_000, { idempotencyKey: "v:fund" });
  const q = eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 10_000 });
  const exec = eng.execute(q);
  const voidAfterTrade = eng.balance(VOID_ACCOUNT, "TUMBO");
  assert.ok(voidAfterTrade > 0, "trade paid the tithe");

  const rev = eng.reverse({ idempotencyKey: exec.idempotencyKey });
  assert.equal(rev.action, "reverse");
  // Alice is fully restored on both legs...
  assert.equal(eng.balance(ALICE, "TUMBO"), 100_000);
  assert.equal(eng.balance(ALICE, "sMIMAS"), 0);
  // ...the tithe stays in the void (never debited), the market absorbed it.
  assert.equal(eng.balance(VOID_ACCOUNT, "TUMBO"), voidAfterTrade);
  assert.ok(!rev.postings.some((p) => p.account === VOID_ACCOUNT && p.amount < 0));
});

test("cancel pending quote: execute then fails closed", () => {
  const eng = createTokenEngine();
  eng.faucet(ALICE, "TUMBO", 50_000, { idempotencyKey: "c:fund" });
  const q = eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 5_000 });
  const rec = eng.cancelQuote(q.id);
  assert.equal(rec.cancelled, true);
  assert.equal(rec.quoteId, q.id);
  assert.throws(() => eng.execute(q), CancelRejectedError);
});

test("cancel settled quote fails closed", () => {
  const eng = createTokenEngine();
  eng.faucet(ALICE, "TUMBO", 50_000, { idempotencyKey: "cs:fund" });
  const q = eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 5_000 });
  eng.execute(q);
  assert.throws(() => eng.cancelQuote(q.id), CancelRejectedError);
});

test("double-cancel is idempotent", () => {
  const eng = createTokenEngine();
  eng.faucet(ALICE, "TUMBO", 50_000, { idempotencyKey: "dc:fund" });
  const q = eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 5_000 });
  const first = eng.cancelQuote(q.id);
  const second = eng.cancelQuote(q.id);
  assert.equal(second.id, first.id);
});

test("cancel unknown quote throws QuoteError", () => {
  const eng = createTokenEngine();
  assert.throws(() => eng.cancelQuote("q_missing"), QuoteError);
});

test("reverse emits receipt and balance-changed events", () => {
  const { eng, faucetReceipt } = fundedEngine(20_000);
  const seen = [];
  eng.on("receipt", ({ receipt }) => seen.push(["receipt", receipt.action]));
  eng.on("balance-changed", (d) => seen.push(["balance-changed", d.account]));
  eng.reverse({ idempotencyKey: faucetReceipt.idempotencyKey });
  assert.ok(seen.some(([t, a]) => t === "receipt" && a === "reverse"));
  assert.ok(seen.some(([t, a]) => t === "balance-changed" && a === ALICE));
});

test("verifyChain passes on a live ledger", () => {
  const { eng } = fundedEngine(10_000);
  eng.ledger.post(
    [{ account: ALICE, asset: "TUMBO", amount: -100 }, { account: BOB, asset: "TUMBO", amount: 100 }],
    { idempotencyKey: "h:1", action: "send" }
  );
  const res = eng.ledger.verifyChain();
  assert.equal(res.ok, true);
  assert.equal(res.count, eng.ledger.journalCount());
});

test("verifyChain detects tampering with a stored journal", () => {
  const { eng } = fundedEngine(10_000);
  const target = eng.ledger._journals[2];
  eng.ledger._journals[2] = {
    ...target,
    postings: target.postings.map((p) => ({ ...p, amount: p.amount + 1 })),
  };
  const res = eng.ledger.verifyChain();
  assert.equal(res.ok, false);
  assert.equal(res.at, target.id);
});

test("verifyReceipt detects a tampered receipt and passes a clean one", () => {
  const { eng } = fundedEngine(10_000);
  const clean = eng.ledger._journals[eng.ledger._journals.length - 1];
  assert.equal(eng.ledger.verifyReceipt(clean.id).ok, true);
  assert.equal(eng.ledger.verifyReceipt(clean.idempotencyKey).ok, true);

  eng.ledger._journals[eng.ledger._journals.length - 1] = {
    ...clean,
    postings: clean.postings.map((p) => ({ ...p, amount: p.amount + 7 })),
  };
  assert.equal(eng.ledger.verifyReceipt(clean.id).ok, false);
  assert.equal(eng.ledger.verifyReceipt("rcpt_missing").ok, false);
});

test("receiptChainHash binds every field", () => {
  const { eng, faucetReceipt } = fundedEngine(5_000);
  assert.equal(faucetReceipt.hash, receiptChainHash(faucetReceipt));
  assert.equal(typeof faucetReceipt.prevHash, "string");
  assert.ok(faucetReceipt.tick > 0);
});

test("journalHistory filters: account filter excludes non-matching journals", () => {
  const eng = createTokenEngine();
  eng.faucet(ALICE, "TUMBO", 30_000, { idempotencyKey: "jh:fund" });
  eng.ledger.post(
    [{ account: ALICE, asset: "TUMBO", amount: -500 }, { account: BOB, asset: "TUMBO", amount: 500 }],
    { idempotencyKey: "jh:send", action: "send" }
  );
  // No carol journals exist: the genesis bypass bug must NOT leak rows in.
  const carol = eng.journalHistory({ account: "u:carol" });
  assert.equal(carol.total, 0);

  const alice = eng.journalHistory({ account: ALICE });
  assert.ok(alice.total >= 2);
  assert.ok(alice.rows.every((r) => r.postings.some((p) => p.account === ALICE)));

  const genesis = eng.journalHistory({ action: "genesis" });
  assert.equal(genesis.total, 4);

  const smimas = eng.journalHistory({ asset: "sMIMAS" });
  assert.ok(smimas.rows.every((r) => r.postings.some((p) => p.asset === "sMIMAS")));

  const all = eng.journalHistory({});
  assert.ok(all.rows[0].tick > all.rows[all.rows.length - 1].tick, "newest first");

  const paged = eng.journalHistory({ limit: 2, offset: 1 });
  assert.equal(paged.rows.length, 2);
  assert.equal(paged.total, all.total);
});

test("adapter reverse() convenience restores the wallet balance", () => {
  const ledger = new TumboUserLedger(createTokenEngine());
  ledger._engine.faucet("u:you", "TUMBO", 10_000, { idempotencyKey: "ar:fund" });
  ledger.send({ to: "alice", amountFluff: 1_000, idempotencyKey: "ar:send" });
  assert.equal(ledger.balance("you"), 9_000);
  const rev = ledger.reverse("ar:send");
  assert.equal(rev.action, "reverse");
  assert.equal(ledger.balance("you"), 10_000);
});

test("facade exposes the Part C lifecycle surface", () => {
  const f = ensureTumboTokenFacade({ seed: true });
  for (const name of ["reverse", "cancel", "verifyReceipt", "verifyChain", "journalHistory", "tick"]) {
    assert.equal(typeof f[name], "function", `facade.${name} should be a function`);
  }
  assert.ok(typeof f.tick() === "number" && f.tick() > 0);
  assert.equal(f.verifyChain().ok, true);
  assert.ok(f.journalHistory({}).total > 0);
});

test("facade reverse + cancel end to end on the shared engine", () => {
  const f = ensureTumboTokenFacade({ seed: true });
  const key = `e2e:send:${Date.now()}`;
  f.ledger._engine.faucet("u:e2e", "TUMBO", 20_000, { idempotencyKey: `${key}:fund` });
  const before = f.engine.balance("u:e2e", "TUMBO");
  f.engine.ledger.post(
    [{ account: "u:e2e", asset: "TUMBO", amount: -2_000 }, { account: "u:e2e2", asset: "TUMBO", amount: 2_000 }],
    { idempotencyKey: key, action: "send" }
  );
  f.reverse({ idempotencyKey: key });
  assert.equal(f.engine.balance("u:e2e", "TUMBO"), before);

  const q = f.quote({ action: "buy", from: "u:e2e", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1_000 });
  const rec = f.cancel(q.id);
  assert.equal(rec.cancelled, true);
  assert.throws(() => f.execute(q), CancelRejectedError);
});
