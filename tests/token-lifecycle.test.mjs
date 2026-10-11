/** Canonical token lifecycle regressions.
 *
 * The retired generic pending-transaction facade is intentionally not used
 * here. Lifecycle coverage follows the current local simulation contract:
 * journal reversal is bounded by ledger ticks, market quotes can be
 * cancelled before execution, and settled quotes fail closed on cancellation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG,
  CancelRejectedError,
  QuoteError,
  REVERSE_WINDOW_TICKS,
  ReverseWindowExpiredError,
  TumboUserLedger,
  createTokenEngine,
  fmt,
} from "../src/domains/token.js";
import { sha256Hex } from "../src/domains/token-sha256.js";

const funded = (amountFluff = 50_000) => {
  const engine = createTokenEngine();
  engine.faucet("u:alice", "TUMBO", amountFluff, { idempotencyKey: "fund-alice" });
  return engine;
};

const walletSend = (engine, amountFluff, idempotencyKey, memo = "") => new TumboUserLedger(engine).send({
  from: "alice",
  to: "bob",
  asset: "TUMBO-SIM",
  amountFluff,
  idempotencyKey,
  memo,
});

const journalFor = (engine, idempotencyKey) => engine.ledger._journals.find((row) => row.idempotencyKey === idempotencyKey);

function tickForward(engine, count, prefix = "tick") {
  for (let index = 0; index < count; index += 1) {
    engine.ledger.post(
      [{ account: "sys:treasury", asset: "TUMBO", amount: 0 }],
      { idempotencyKey: `${prefix}-${index}`, action: "tick", authority: "internal" },
    );
  }
}

test("canonical engine exposes the simulation lifecycle owner and configured supply", () => {
  const engine = createTokenEngine();
  assert.equal(typeof engine.balance, "function");
  assert.equal(typeof engine.on, "function");
  assert.ok(engine.ledger);
  assert.deepEqual(engine.config.supply, CONFIG.supply);
  assert.equal(engine.ledger.verifyChain().ok, true);
  assert.equal(engine.ledger.tick, 4, "genesis commits four canonical journals");
});

test("sha256 matches the standard test vector", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("fmt renders exact integer fluff", () => {
  assert.equal(fmt(1500), "1.500 TUMBO-SIM");
  assert.equal(fmt(1), "0.001 TUMBO-SIM");
  assert.equal(fmt(0), "0.000 TUMBO-SIM");
});

test("wallet sends post a balanced journal and move balances", () => {
  const engine = funded();
  const before = engine.balance("u:alice", "TUMBO");
  const receipt = walletSend(engine, 1500, "send-1");
  const journal = journalFor(engine, "send-1");
  assert.equal(receipt.duplicate, false);
  assert.equal(journal.action, "send");
  assert.equal(engine.balance("u:alice", "TUMBO"), before - 1500);
  assert.equal(engine.balance("u:bob", "TUMBO"), 1500);
  const sums = new Map();
  for (const posting of journal.postings) sums.set(posting.asset, (sums.get(posting.asset) ?? 0) + posting.amount);
  assert.equal(sums.get("TUMBO"), 0);
});

test("wallet send replay returns the original receipt without a second journal", () => {
  const engine = funded();
  const wallet = new TumboUserLedger(engine);
  const first = wallet.send({ from: "alice", to: "bob", amountFluff: 700, idempotencyKey: "send-once", memo: "tip" });
  const count = engine.ledger.journalCount();
  const replay = wallet.send({ from: "alice", to: "bob", amountFluff: 700, idempotencyKey: "send-once", memo: "tip" });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.id, first.id);
  assert.equal(engine.ledger.journalCount(), count);
  assert.equal(engine.balance("u:bob", "TUMBO"), 700);
});

test("insufficient wallet sends fail atomically", () => {
  const engine = funded(1000);
  assert.throws(
    () => walletSend(engine, 1001, "overdraft"),
    (error) => error.code === "insufficient-simulated-funds",
  );
  assert.equal(engine.balance("u:alice", "TUMBO"), 1000);
  assert.equal(journalFor(engine, "overdraft"), undefined);
});

test("sys:void is credited only by an authorized burn and never debited", () => {
  const engine = funded();
  engine.ledger.post(
    [
      { account: "u:alice", asset: "TUMBO", amount: -500 },
      { account: "sys:void", asset: "TUMBO", amount: 500 },
    ],
    { idempotencyKey: "burn-1", action: "burn", voidCreditReason: "burn", authority: "internal" },
  );
  assert.equal(engine.balance("sys:void", "TUMBO"), 500);
  assert.throws(
    () => engine.ledger.post(
      [
        { account: "sys:void", asset: "TUMBO", amount: -1 },
        { account: "u:bob", asset: "TUMBO", amount: 1 },
      ],
      { idempotencyKey: "void-debit", action: "attack", authority: "internal" },
    ),
    /never debited/,
  );
});

test("market quote settlement remains balanced across both assets", () => {
  const engine = funded(100_000);
  const quote = engine.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 2000 });
  const receipt = engine.execute(quote, { idempotencyKey: "market-1" });
  assert.equal(receipt.action, "buy");
  const sums = new Map();
  for (const posting of receipt.postings) sums.set(posting.asset, (sums.get(posting.asset) ?? 0) + posting.amount);
  assert.equal(sums.get("TUMBO"), 0);
  assert.equal(sums.get("sMIMAS"), 0);
  assert.equal(engine.balance("u:alice", "sMIMAS"), 20_000);
});

test("reverse within the window posts a compensating journal without editing history", () => {
  const engine = funded();
  walletSend(engine, 9000, "reversible");
  const original = journalFor(engine, "reversible");
  const originalPostings = JSON.stringify(original.postings);
  const aliceBefore = engine.balance("u:alice", "TUMBO");
  const reversal = engine.reverse({ journalId: original.id, actor: "u:alice" });
  assert.equal(reversal.action, "reverse");
  assert.equal(reversal.links.reverses, original.id);
  assert.equal(engine.balance("u:alice", "TUMBO"), aliceBefore + 9000);
  assert.equal(engine.balance("u:bob", "TUMBO"), 0);
  assert.equal(JSON.stringify(original.postings), originalPostings);
  assert.equal(engine.ledger.verifyChain().ok, true);
});

test("double reverse is deterministic and cannot compensate twice", () => {
  const engine = funded();
  walletSend(engine, 3000, "double-reverse");
  const original = journalFor(engine, "double-reverse");
  const first = engine.reverse({ journalId: original.id });
  const count = engine.ledger.journalCount();
  const replay = engine.reverse({ journalId: original.id });
  assert.equal(replay.id, first.id);
  assert.equal(engine.ledger.journalCount(), count);
  assert.equal(engine.balance("u:bob", "TUMBO"), 0);
});

test("reverse after the bounded window expires fails closed", () => {
  const engine = funded();
  walletSend(engine, 2500, "too-old");
  const original = journalFor(engine, "too-old");
  tickForward(engine, REVERSE_WINDOW_TICKS + 1, "age");
  assert.ok(engine.ledger.tick - original.tick > REVERSE_WINDOW_TICKS);
  assert.throws(() => engine.reverse({ journalId: original.id }), ReverseWindowExpiredError);
  assert.equal(engine.balance("u:bob", "TUMBO"), 2500);
  assert.equal(engine.ledger._journals.some((row) => row.action === "reverse" && row.links?.reverses === original.id), false);
});

test("reverse at exactly the bounded window still succeeds", () => {
  const engine = funded();
  walletSend(engine, 2500, "boundary");
  const original = journalFor(engine, "boundary");
  tickForward(engine, REVERSE_WINDOW_TICKS, "edge");
  assert.equal(engine.ledger.tick - original.tick, REVERSE_WINDOW_TICKS);
  const reversal = engine.reverse({ journalId: original.id });
  assert.equal(reversal.action, "reverse");
  assert.equal(engine.balance("u:bob", "TUMBO"), 0);
});

test("pending quote cancellation is idempotent and blocks later execution", () => {
  const engine = funded();
  const quote = engine.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1000 });
  const cancellation = engine.cancelQuote(quote.id, { idempotencyKey: "cancel-pending" });
  assert.equal(cancellation.kind, "cancellation");
  assert.equal(cancellation.cancelled, true);
  assert.equal(engine.cancelQuote(quote.id, { idempotencyKey: "cancel-pending" }), cancellation);
  assert.throws(() => engine.execute(quote, { idempotencyKey: "cancelled-execution" }), CancelRejectedError);
});

test("settled quote cancellation fails closed", () => {
  const engine = funded();
  const quote = engine.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1000 });
  engine.execute(quote, { idempotencyKey: "settled-quote" });
  const aliceAfter = engine.balance("u:alice", "TUMBO");
  assert.throws(() => engine.cancelQuote(quote.id, { idempotencyKey: "cancel-settled" }), CancelRejectedError);
  assert.equal(engine.balance("u:alice", "TUMBO"), aliceAfter);
});

test("executing one quote under a new key after settlement fails closed", () => {
  const engine = funded();
  const quote = engine.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1000 });
  const first = engine.execute(quote, { idempotencyKey: "quote-once" });
  assert.equal(engine.execute(quote, { idempotencyKey: "quote-once" }), first);
  assert.throws(() => engine.execute(quote, { idempotencyKey: "quote-again" }), QuoteError);
});

test("journal history filters by action, account, and asset", () => {
  const engine = funded(100_000);
  walletSend(engine, 111, "history-send");
  const quote = engine.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1000 });
  engine.execute(quote, { idempotencyKey: "history-buy" });
  const sends = engine.journalHistory({ action: "send" });
  assert.equal(sends.total, 1);
  assert.equal(sends.rows[0].idempotencyKey, "history-send");
  const alice = engine.journalHistory({ account: "u:alice" });
  assert.ok(alice.total >= 3);
  assert.ok(alice.rows.every((row) => row.postings.some((posting) => posting.account === "u:alice")));
  const smimas = engine.journalHistory({ asset: "sMIMAS" });
  assert.ok(smimas.total >= 2);
  assert.ok(smimas.rows.every((row) => row.postings.some((posting) => posting.asset === "sMIMAS")));
});

test("receipt chain verification detects tampered journal fields", () => {
  const engine = funded();
  walletSend(engine, 1234, "chain-1");
  assert.equal(engine.ledger.verifyChain().ok, true);
  const index = engine.ledger._journals.findIndex((row) => row.idempotencyKey === "chain-1");
  const victim = engine.ledger._journals[index];
  engine.ledger._journals[index] = { ...victim, hash: "0000000000000000" };
  assert.equal(engine.ledger.verifyChain().ok, false);

  const tamperedPostings = funded();
  walletSend(tamperedPostings, 1234, "chain-2");
  const postingIndex = tamperedPostings.ledger._journals.findIndex((row) => row.idempotencyKey === "chain-2");
  const postingVictim = tamperedPostings.ledger._journals[postingIndex];
  tamperedPostings.ledger._journals[postingIndex] = {
    ...postingVictim,
    postings: postingVictim.postings.map((posting, offset) => offset === 0 ? { ...posting, amount: posting.amount - 1 } : posting),
  };
  assert.equal(tamperedPostings.ledger.verifyChain().ok, false);
});

test("unknown journals and accounts fail loudly", () => {
  const engine = createTokenEngine();
  assert.throws(() => engine.reverse({ journalId: "missing" }), /unknown journal/);
  assert.throws(() => engine.cancelQuote("missing"), /unknown quote/);
  assert.throws(
    () => engine.quote({ action: "buy", from: "hacker", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1 }),
    /account/,
  );
});

test("events fire for market receipts and balance changes", () => {
  const engine = funded();
  const seen = [];
  const offReceipt = engine.on("receipt", ({ receipt }) => seen.push(["receipt", receipt.action]));
  const offBalance = engine.on("balance-changed", ({ account }) => seen.push(["balance-changed", account]));
  const quote = engine.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 500 });
  engine.execute(quote, { idempotencyKey: "evt-1" });
  offReceipt();
  offBalance();
  assert.ok(seen.some(([kind, action]) => kind === "receipt" && action === "buy"));
  assert.ok(seen.some(([kind, account]) => kind === "balance-changed" && account === "u:alice"));
});
