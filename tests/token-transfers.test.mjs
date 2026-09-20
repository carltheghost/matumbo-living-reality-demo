/**
 * token-transfers.test.mjs — Part 02 · tests for the TUMBO-SIM transfer engine.
 *
 * Run with: node --test tests/token-transfers.test.mjs
 * (repo script: npm test → node --test tests/*.test.mjs)
 *
 * Covers the shared contract: integer-fluff amounts, replay-safety (same
 * idempotency key twice = one journal + the original receipt),
 * insufficient-funds failure, two-phase deliver (hold → settle / cancel),
 * zero-sum journals, conservation, sys:void burn-only semantics, and
 * EchoProof-style receipt hash recomputation.
 *
 * Simulation-only: every balance asserted here is simulated demo points.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  createTokenTransferLedger,
  attachTokenTransfers,
  sha256Hex,
  canonicalJson,
  contentHash,
  fmtFluff,
  parseSimToFluff,
  FLUFF_PER_TUMBO_SIM,
  TOKEN_TRANSFER_SUPPLY_FLUFF,
  TOKEN_TRANSFER_ASSETS,
  TokenTransferError,
  InsufficientFundsError,
  IntentStateError,
  UnknownIntentError,
} from "../src/domains/token-transfers.js";

/** TUMBO-SIM → fluff. */
const T = (sim) => sim * FLUFF_PER_TUMBO_SIM;

function fundedLedger() {
  const ledger = createTokenTransferLedger();
  ledger.send({
    from: "sys:faucet", to: "u:alice", asset: "TUMBO",
    amountFluff: T(1000), idempotencyKey: "fund-alice-tumbo", actor: "system",
  });
  ledger.send({
    from: "sys:faucet", to: "u:alice", asset: "sMIMAS",
    amountFluff: T(500), idempotencyKey: "fund-alice-smimas", actor: "system",
  });
  return ledger;
}

// ---- hashing primitives -------------------------------------------------

test("sha256Hex matches the standard test vectors", () => {
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("canonicalJson is deterministic regardless of key order", () => {
  assert.equal(canonicalJson({ b: 1, a: { y: 2, x: 1 } }), '{"a":{"x":1,"y":2},"b":1}');
  assert.equal(contentHash({ b: 1, a: 1 }), contentHash({ a: 1, b: 1 }));
});

// ---- amount helpers ------------------------------------------------------

test("fmtFluff formats with exact integer math", () => {
  assert.equal(fmtFluff(1234), "1.234 TUMBO-SIM");
  assert.equal(fmtFluff(2000), "2.000 TUMBO-SIM");
  assert.equal(fmtFluff(5), "0.005 TUMBO-SIM");
  assert.equal(fmtFluff(0), "0.000 TUMBO-SIM");
});

test("parseSimToFluff parses decimals exactly, never via float", () => {
  assert.equal(parseSimToFluff("1.234"), 1234);
  assert.equal(parseSimToFluff("2"), 2000);
  assert.equal(parseSimToFluff("0.005"), 5);
  assert.equal(parseSimToFluff("  3.5 "), 3500);
  assert.throws(() => parseSimToFluff("1.2345"), TokenTransferError);
  assert.throws(() => parseSimToFluff("-1"), TokenTransferError);
  assert.throws(() => parseSimToFluff("abc"), TokenTransferError);
  assert.throws(() => parseSimToFluff(""), TokenTransferError);
});

// ---- boot + conservation --------------------------------------------------

test("a fresh ledger conserves the configured supply per asset", () => {
  const ledger = createTokenTransferLedger();
  assert.equal(ledger.assertConservation(), true);
  for (const asset of TOKEN_TRANSFER_ASSETS) {
    assert.equal(ledger.totalSupply(asset), TOKEN_TRANSFER_SUPPLY_FLUFF[asset]);
  }
  assert.equal(ledger.journalCount(), 0);
  assert.deepEqual(ledger.receipts(), []);
});

// ---- send -----------------------------------------------------------------

test("send moves funds and journals exactly zero per asset", () => {
  const ledger = fundedLedger();
  const journalsBefore = ledger.journalCount();
  const receipt = ledger.send({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(250), idempotencyKey: "send-1", actor: "u:alice",
  });
  assert.equal(receipt.action, "send");
  assert.equal(ledger.balance("u:alice", "TUMBO"), T(750));
  assert.equal(ledger.balance("u:bob", "TUMBO"), T(250));
  assert.equal(ledger.journalCount(), journalsBefore + 1);
  const journal = ledger.journals().at(-1);
  const sum = journal.legs.reduce((total, leg) => total + leg.delta, 0);
  assert.equal(sum, 0);
  assert.equal(ledger.assertConservation(), true);
});

test("replay-safety: the same idempotency key twice yields one journal and the original receipt", () => {
  const ledger = fundedLedger();
  const journalsBefore = ledger.journalCount();
  const first = ledger.send({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(100), idempotencyKey: "replay-key-1", actor: "u:alice",
  });
  const second = ledger.send({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(100), idempotencyKey: "replay-key-1", actor: "u:alice",
  });
  assert.deepEqual(second, first);
  assert.equal(second.receiptId, first.receiptId);
  assert.equal(ledger.journalCount(), journalsBefore + 1);
  assert.equal(ledger.receipts().length, journalsBefore + 1);
  assert.equal(ledger.balance("u:alice", "TUMBO"), T(900));
  assert.equal(ledger.balance("u:bob", "TUMBO"), T(100));
});

test("insufficient funds fails atomically: no journal, no balance change", () => {
  const ledger = fundedLedger();
  const journalsBefore = ledger.journalCount();
  const aliceBefore = ledger.balance("u:alice", "TUMBO");
  const bobBefore = ledger.balance("u:bob", "TUMBO");
  assert.throws(
    () => ledger.send({
      from: "u:alice", to: "u:bob", asset: "TUMBO",
      amountFluff: T(1001), idempotencyKey: "overspend-1", actor: "u:alice",
    }),
    InsufficientFundsError,
  );
  assert.equal(ledger.journalCount(), journalsBefore);
  assert.equal(ledger.balance("u:alice", "TUMBO"), aliceBefore);
  assert.equal(ledger.balance("u:bob", "TUMBO"), bobBefore);
  assert.equal(ledger.assertConservation(), true);
});

test("every mutation requires a client idempotency key", () => {
  const ledger = fundedLedger();
  assert.throws(() => ledger.send({
    from: "u:alice", to: "u:bob", asset: "TUMBO", amountFluff: T(1),
  }), TokenTransferError);
  assert.throws(() => ledger.send({
    from: "u:alice", to: "u:bob", asset: "TUMBO", amountFluff: T(1), idempotencyKey: "   ",
  }), TokenTransferError);
});

test("amounts must be positive safe integers (fluff)", () => {
  const ledger = fundedLedger();
  for (const bad of [0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "100"]) {
    assert.throws(() => ledger.send({
      from: "u:alice", to: "u:bob", asset: "TUMBO", amountFluff: bad, idempotencyKey: `bad-${String(bad)}`,
    }), TokenTransferError, `amount ${String(bad)} should be rejected`);
  }
});

test("accounts are validated: u:/b:/sys: only", () => {
  const ledger = fundedLedger();
  assert.throws(() => ledger.send({
    from: "alice", to: "u:bob", asset: "TUMBO", amountFluff: T(1), idempotencyKey: "acct-1",
  }), TokenTransferError);
  assert.throws(() => ledger.send({
    from: "u:alice", to: "sys:nope", asset: "TUMBO", amountFluff: T(1), idempotencyKey: "acct-2",
  }), TokenTransferError);
  assert.throws(() => ledger.send({
    from: "u:alice", to: "u:alice", asset: "TUMBO", amountFluff: T(1), idempotencyKey: "acct-3",
  }), TokenTransferError);
  assert.throws(() => ledger.send({
    from: "u:alice", to: "u:bob", asset: "NOPE", amountFluff: T(1), idempotencyKey: "acct-4",
  }), TokenTransferError);
});

// ---- receive + tip ----------------------------------------------------------

test("receive credits the recipient and records the recipient as actor", () => {
  const ledger = fundedLedger();
  const receipt = ledger.receive({
    from: "u:alice", to: "u:bob", asset: "sMIMAS",
    amountFluff: T(50), idempotencyKey: "recv-1",
  });
  assert.equal(receipt.action, "receive");
  assert.equal(receipt.actorId, "u:bob");
  assert.equal(ledger.balance("u:bob", "sMIMAS"), T(50));
  assert.equal(ledger.balance("u:alice", "sMIMAS"), T(450));
});

test("tip moves funds with a tip receipt", () => {
  const ledger = fundedLedger();
  const receipt = ledger.tip({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(25), idempotencyKey: "tip-1", memo: "great demo",
  });
  assert.equal(receipt.action, "tip");
  assert.equal(ledger.balance("u:bob", "TUMBO"), T(25));
  assert.equal(ledger.balance("u:alice", "TUMBO"), T(975));
});

// ---- deliver: two-phase intents ----------------------------------------------

test("deliver hold locks funds in sys:escrow and opens a held intent", () => {
  const ledger = fundedLedger();
  const receipt = ledger.deliverHold({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(300), idempotencyKey: "deliver-1",
  });
  assert.equal(receipt.action, "deliver");
  assert.equal(receipt.phase, "hold");
  assert.ok(receipt.intentId);
  assert.equal(ledger.balance("u:alice", "TUMBO"), T(700));
  assert.equal(ledger.balance("sys:escrow", "TUMBO"), T(300));
  assert.equal(ledger.balance("u:bob", "TUMBO"), T(0));
  const intent = ledger.getIntent(receipt.intentId);
  assert.equal(intent.status, "held");
  assert.equal(intent.from, "u:alice");
  assert.equal(intent.to, "u:bob");
  assert.equal(intent.amountFluff, T(300));
});

test("deliver hold is replay-safe: same key returns the original receipt and intent", () => {
  const ledger = fundedLedger();
  const first = ledger.deliverHold({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(300), idempotencyKey: "deliver-replay-1",
  });
  const journalsBefore = ledger.journalCount();
  const second = ledger.deliverHold({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(300), idempotencyKey: "deliver-replay-1",
  });
  assert.deepEqual(second, first);
  assert.equal(ledger.journalCount(), journalsBefore);
  assert.equal(ledger.intents().length, 1);
});

test("deliver settle releases escrow to the recipient", () => {
  const ledger = fundedLedger();
  const hold = ledger.deliverHold({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(300), idempotencyKey: "deliver-settle-1",
  });
  const settle = ledger.deliverSettle({ intentId: hold.intentId, idempotencyKey: "settle-1" });
  assert.equal(settle.action, "deliver");
  assert.equal(settle.phase, "settle");
  assert.equal(ledger.balance("sys:escrow", "TUMBO"), T(0));
  assert.equal(ledger.balance("u:bob", "TUMBO"), T(300));
  assert.equal(ledger.balance("u:alice", "TUMBO"), T(700));
  assert.equal(ledger.getIntent(hold.intentId).status, "settled");
  assert.equal(ledger.assertConservation(), true);
});

test("deliver settle is idempotent: the same settle key returns the original receipt", () => {
  const ledger = fundedLedger();
  const hold = ledger.deliverHold({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(300), idempotencyKey: "deliver-settle-replay-1",
  });
  const first = ledger.deliverSettle({ intentId: hold.intentId, idempotencyKey: "settle-replay-1" });
  const journalsBefore = ledger.journalCount();
  const second = ledger.deliverSettle({ intentId: hold.intentId, idempotencyKey: "settle-replay-1" });
  assert.deepEqual(second, first);
  assert.equal(ledger.journalCount(), journalsBefore);
  assert.equal(ledger.balance("u:bob", "TUMBO"), T(300));
});

test("deliver cancel returns escrowed funds to the sender", () => {
  const ledger = fundedLedger();
  const hold = ledger.deliverHold({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(300), idempotencyKey: "deliver-cancel-1",
  });
  const cancel = ledger.deliverCancel({ intentId: hold.intentId, idempotencyKey: "cancel-1", reason: "demo cancel" });
  assert.equal(cancel.phase, "cancel");
  assert.equal(ledger.balance("sys:escrow", "TUMBO"), T(0));
  assert.equal(ledger.balance("u:alice", "TUMBO"), T(1000));
  assert.equal(ledger.balance("u:bob", "TUMBO"), T(0));
  assert.equal(ledger.getIntent(hold.intentId).status, "cancelled");
});

test("settling or cancelling a non-held intent fails", () => {
  const ledger = fundedLedger();
  const hold = ledger.deliverHold({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(100), idempotencyKey: "deliver-state-1",
  });
  ledger.deliverSettle({ intentId: hold.intentId, idempotencyKey: "settle-state-1" });
  assert.throws(() => ledger.deliverSettle({ intentId: hold.intentId, idempotencyKey: "settle-state-2" }), IntentStateError);
  assert.throws(() => ledger.deliverCancel({ intentId: hold.intentId, idempotencyKey: "cancel-state-1" }), IntentStateError);
  assert.throws(() => ledger.deliverSettle({ intentId: "deliver:missing", idempotencyKey: "settle-state-3" }), UnknownIntentError);
});

// ---- burns + sys:void ---------------------------------------------------------

test("burn credits sys:void and conserves supply", () => {
  const ledger = fundedLedger();
  const receipt = ledger.burn({
    from: "u:alice", asset: "TUMBO", amountFluff: T(100), idempotencyKey: "burn-1",
  });
  assert.equal(receipt.action, "burn");
  assert.equal(ledger.balance("sys:void", "TUMBO"), T(100));
  assert.equal(ledger.balance("u:alice", "TUMBO"), T(900));
  assert.equal(ledger.assertConservation(), true);
});

// ---- journal invariants --------------------------------------------------------

test("every journal sums to exactly zero and conservation holds after mixed activity", () => {
  const ledger = fundedLedger();
  ledger.send({ from: "u:alice", to: "u:bob", asset: "TUMBO", amountFluff: T(100), idempotencyKey: "mix-1" });
  ledger.tip({ from: "u:bob", to: "u:carol", asset: "TUMBO", amountFluff: T(10), idempotencyKey: "mix-2" });
  const hold = ledger.deliverHold({ from: "u:alice", to: "u:bob", asset: "sMIMAS", amountFluff: T(50), idempotencyKey: "mix-3" });
  ledger.deliverSettle({ intentId: hold.intentId, idempotencyKey: "mix-4" });
  ledger.receive({ from: "sys:faucet", to: "u:dave", asset: "TUMBO", amountFluff: T(5), idempotencyKey: "mix-5" });
  ledger.burn({ from: "u:carol", asset: "TUMBO", amountFluff: T(2), idempotencyKey: "mix-6" });
  for (const journal of ledger.journals()) {
    const sum = journal.legs.reduce((total, leg) => total + leg.delta, 0);
    assert.equal(sum, 0, `journal ${journal.journalId} must sum to zero`);
  }
  for (const asset of TOKEN_TRANSFER_ASSETS) {
    let total = 0;
    const seen = new Set();
    for (const journal of ledger.journals()) {
      if (journal.asset !== asset) continue;
      for (const leg of journal.legs) {
        if (seen.has(leg.acct)) continue;
        seen.add(leg.acct);
        total += ledger.balance(leg.acct, asset);
      }
    }
    for (const acct of ["sys:treasury", "sys:faucet", "sys:escrow", "sys:vault", "sys:void", "sys:market"]) {
      if (seen.has(acct)) continue;
      total += ledger.balance(acct, asset);
    }
    assert.ok(total <= TOKEN_TRANSFER_SUPPLY_FLUFF[asset], "tracked total cannot exceed supply");
  }
  assert.equal(ledger.assertConservation(), true);
  assert.equal(ledger.verifyChain(), true);
});

// ---- receipts -------------------------------------------------------------------

test("receipts are hash-chained and recompute cleanly", () => {
  const ledger = fundedLedger();
  const r1 = ledger.send({ from: "u:alice", to: "u:bob", asset: "TUMBO", amountFluff: T(10), idempotencyKey: "rcpt-1" });
  const r2 = ledger.tip({ from: "u:bob", to: "u:carol", asset: "TUMBO", amountFluff: T(3), idempotencyKey: "rcpt-2" });
  assert.equal(r1.sequence, 2);
  assert.equal(r2.sequence, 3);
  assert.equal(r2.beforeHash === r1.afterHash, false);
  const v1 = ledger.verifyReceipt(r1.receiptId);
  assert.equal(v1.ok, true);
  assert.deepEqual(Object.keys(v1.checks).sort(), ["afterHash", "beforeHash", "linkage", "payloadHash", "sequence"]);
  for (const check of Object.values(v1.checks)) assert.equal(check, true);
  assert.equal(ledger.verifyReceipt(r2.receiptId).ok, true);
  assert.equal(ledger.verifyChain(), true);
  assert.equal(r1.stamp, "TUMBO-SIM \u00b7 Local Demo Proof");
  assert.equal(r1.simulation, true);
});

test("receipts carry the idempotency reference and touched accounts", () => {
  const ledger = fundedLedger();
  const receipt = ledger.send({
    from: "u:alice", to: "u:bob", asset: "TUMBO",
    amountFluff: T(7), idempotencyKey: "rcpt-accounts-1", actor: "u:alice", memo: "hello",
  });
  assert.equal(receipt.reference, "rcpt-accounts-1");
  assert.deepEqual([...receipt.accounts].sort(), ["u:alice", "u:bob"]);
  assert.ok(receipt.journalId.startsWith("journal:"));
  assert.ok(typeof receipt.beforeHash === "string" && receipt.beforeHash.length === 64);
  assert.ok(typeof receipt.afterHash === "string" && receipt.afterHash.length === 64);
  assert.ok(typeof receipt.payloadHash === "string" && receipt.payloadHash.length === 64);
});

// ---- events ----------------------------------------------------------------------

test("engine events fire receipt then balance-changed per touched account", () => {
  const ledger = fundedLedger();
  const seen = [];
  const off = ledger.onEvent((evt) => seen.push(evt));
  ledger.send({ from: "u:alice", to: "u:bob", asset: "TUMBO", amountFluff: T(11), idempotencyKey: "evt-1" });
  off();
  assert.equal(seen[0].type, "receipt");
  assert.equal(seen[0].receipt.action, "send");
  const balanceEvents = seen.filter((e) => e.type === "balance-changed");
  assert.equal(balanceEvents.length, 2);
  assert.deepEqual(balanceEvents.map((e) => e.account).sort(), ["u:alice", "u:bob"]);
  assert.equal(balanceEvents.find((e) => e.account === "u:bob").balanceFluff, T(11));
});

// ---- facade ------------------------------------------------------------------------

test("attachTokenTransfers provides the contract-shaped facade without a DOM", () => {
  const facade = attachTokenTransfers(null);
  assert.equal(typeof facade.balance, "function");
  assert.equal(typeof facade.fmt, "function");
  assert.equal(typeof facade.on, "function");
  assert.equal(facade.balance("sys:faucet", "TUMBO"), TOKEN_TRANSFER_SUPPLY_FLUFF.TUMBO / 4);
  assert.equal(facade.fmt(1234), "1.234 TUMBO-SIM");
  const events = [];
  const off = facade.on("receipt", (detail) => events.push(detail));
  const receipt = facade.send({
    from: "sys:faucet", to: "u:erin", asset: "TUMBO",
    amountFluff: T(20), idempotencyKey: "facade-1",
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].receipt.receiptId, receipt.receiptId);
  off();
  assert.equal(facade.tokenTransfers.balance("u:erin", "TUMBO"), T(20));
});

test("attachTokenTransfers never clobbers an existing facade surface", () => {
  const existing = { balance: () => 42, custom: true };
  const facade = attachTokenTransfers(existing);
  assert.equal(facade.balance("u:x", "TUMBO"), 42);
  assert.equal(facade.custom, true);
  assert.equal(typeof facade.send, "function");
});
