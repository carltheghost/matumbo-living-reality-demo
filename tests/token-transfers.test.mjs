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
import { createTokenEngine, CONFIG } from '../src/domains/token.js';
import { createTokenEngine as createVersionedEngine } from '../src/domains/token.js?v=20261003-complete8';
import { createTokenFacade } from '../src/domains/token-facade.js';
import { serializeTokenEngine, loadTokenEngine } from '../src/domains/token-store.js';

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
  ledger.fundDemo({ to: "u:alice", amountFluff: T(1000), idempotencyKey: "fund-alice-tumbo" });
  // Explicit fixture funding for cross-asset tests. The UI cannot debit the
  // market account; ordinary sMIMAS acquisition uses canonical quotes.
  ledger.engine.ledger.post([
    { account: 'sys:market', asset: 'sMIMAS', amount: -T(500) },
    { account: 'u:alice', asset: 'sMIMAS', amount: T(500) },
  ], { idempotencyKey: 'fixture:smimas', action: 'fixture-funding', authority: 'internal' });
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
  assert.equal(parseSimToFluff('9007199254740.991'), Number.MAX_SAFE_INTEGER);
  assert.throws(() => parseSimToFluff('9007199254740.992'), TokenTransferError);
});

// ---- boot + conservation --------------------------------------------------

test("a fresh ledger conserves the configured supply per asset", () => {
  const ledger = createTokenTransferLedger();
  assert.equal(ledger.assertConservation(), true);
  for (const asset of TOKEN_TRANSFER_ASSETS) {
    assert.equal(ledger.totalSupply(asset), TOKEN_TRANSFER_SUPPLY_FLUFF[asset]);
  }
  assert.equal(ledger.journalCount(), 4, 'canonical genesis is journaled');
  assert.equal(ledger.engine.ledger, ledger.ledger);
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
  const sum = journal.postings.reduce((total, leg) => total + leg.amount, 0);
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
  assert.equal(ledger.receipts().length, journalsBefore + 1 - 4, 'receipt view omits genesis');
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
  ledger.fundDemo({ to: "u:dave", amountFluff: T(5), idempotencyKey: "mix-5" });
  ledger.burn({ from: "u:carol", asset: "TUMBO", amountFluff: T(2), idempotencyKey: "mix-6" });
  for (const journal of ledger.journals()) {
    const sums = new Map();
    for (const leg of journal.postings) sums.set(leg.asset, (sums.get(leg.asset) ?? 0) + leg.amount);
    assert.equal([...sums.values()].every(sum => sum === 0), true, `journal ${journal.id} must sum to zero per asset`);
  }
  for (const asset of TOKEN_TRANSFER_ASSETS) {
    let total = 0;
    const seen = new Set();
    for (const journal of ledger.journals()) {
      for (const leg of journal.postings) {
        if (leg.asset !== asset || leg.account === 'sys:issuance' || seen.has(leg.account)) continue;
        seen.add(leg.account);
        total += ledger.balance(leg.account, asset);
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
  assert.equal(r1.sequence, r1.tick - 1);
  assert.equal(r2.sequence, r1.sequence + 1);
  assert.equal(r2.prevHash, r1.hash, 'chain linkage is the canonical receipt linkage');
  const v1 = ledger.verifyReceipt(r1.receiptId);
  assert.equal(v1.ok, true);
  assert.deepEqual(Object.keys(v1.checks).sort(), ['balanced-postings', 'canonical-record', 'hash', 'prevHash-link', 'tick-order']);
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
  assert.equal(receipt.journalId, receipt.id);
  assert.match(receipt.hash, /^[0-9a-f]{16}$/);
  assert.match(receipt.prevHash, /^[0-9a-f]{16}$/);
  assert.equal(ledger.engine.ledger.verifyReceipt(receipt.id).ok, true);
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
  assert.equal(facade.balance("sys:faucet", "TUMBO"), CONFIG.faucetTumbo);
  assert.equal(facade.fmt(1234), '1.234 TUMBO-SIM');
  const events = [];
  const off = facade.on("receipt", (detail) => events.push(detail));
  const receipt = facade.fundDemo({
    to: "u:erin",
    amountFluff: T(20), idempotencyKey: "facade-1",
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].receipt.id, receipt.receiptId);
  off();
  assert.equal(facade.tokenTransfers.balance("u:erin", "TUMBO"), T(20));
  facade.dispose();
});

test("attachTokenTransfers layers a frozen canonical facade without clobbering it", () => {
  const engine = createTokenEngine(), base = createTokenFacade(engine);
  const existing = Object.freeze({ ...base, custom: true });
  const facade = attachTokenTransfers(existing);
  assert.notEqual(facade, existing);
  assert.equal(facade.balance, existing.balance);
  assert.equal(facade.balance("u:x", "TUMBO"), 0);
  assert.equal(facade.custom, true);
  assert.equal(typeof facade.send, "function");
  assert.equal(existing.tokenTransfers, undefined);
  assert.equal(facade.tokenTransfers.engine, engine);
  assert.equal(facade.engine, engine);
  assert.equal(Object.isFrozen(facade), true);
  base.dispose();
});

test('plain and cache-versioned engine owners retain one ledger through transfer attachment', () => {
  for (const createEngine of [createTokenEngine, createVersionedEngine]) {
    const engine = createEngine(), base = createTokenFacade(engine), layered = attachTokenTransfers(base, { engine });
    const ledger = createTokenTransferLedger({ engine: { _engine: engine } });
    layered.fundDemo({ to: 'u:alice', amountFluff: 100, idempotencyKey: 'version:fund' });
    const receipt = ledger.send({ from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'version:send' });
    assert.equal(layered.engine, engine); assert.equal(ledger.ledger, engine.ledger);
    assert.equal(base.balance('u:alice', 'TUMBO'), 90);
    assert.equal(layered.tokenTransfers.balance('u:bob', 'TUMBO'), 10);
    assert.equal(engine.ledger.verifyReceipt(receipt.id).ok, true);
    assert.equal(ledger.send({ from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'version:send' }).id, receipt.id);
    assert.equal(attachTokenTransfers(layered), layered);
    base.dispose();
  }
});

test('transfer constructors reject incomplete owner contracts without touching balances or browser ownership', () => {
  const engine = createTokenEngine(), count = engine.ledger.journalCount(), previous = globalThis.window;
  const partial = Object.create(engine); partial.faucet = undefined;
  try {
    const marker = {}; globalThis.window = { TumboToken: marker };
    for (const owner of [{ ledger: engine.ledger, balance: engine.balance }, { engine: partial }]) {
      assert.throws(() => createTokenTransferLedger({ engine: owner }), /canonical QuoteEngine/);
      assert.throws(() => attachTokenTransfers(owner), /canonical QuoteEngine/);
      assert.throws(() => attachTokenTransfers(null, { engine: owner }), /canonical QuoteEngine/);
    }
    assert.equal(globalThis.window.TumboToken, marker);
    assert.equal(engine.ledger.journalCount(), count);
    assert.equal(engine.balance('u:alice', 'TUMBO'), 0);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

function state(ledger) {
  return { count: ledger.journalCount(), tick: ledger.engine.ledger.tick, receipts: ledger.receipts(),
    accounts: ledger.engine.ledger.accounts().map(row => ({ ...row, balance: ledger.balance(row.account, row.asset) })), intents: ledger.intents() };
}
function assertCode(fn, code) { assert.throws(fn, error => error.code === code); }

test('ordinary transfers cannot debit system balances or fabricate faucet sMIMAS', () => {
  const ledger = fundedLedger(), before = state(ledger);
  for (const from of ['sys:faucet', 'sys:treasury', 'sys:market', 'sys:escrow', 'sys:vault']) {
    for (const action of ['send', 'receive', 'tip', 'deliverHold', 'burn']) assertCode(() => ledger[action]({
      from, to: 'u:thief', asset: 'TUMBO', amountFluff: 1, actor: 'system', idempotencyKey: `${from}:${action}`,
    }), 'SYSTEM_DEBIT');
  }
  assertCode(() => ledger.send({ from: 'sys:void', to: 'u:thief', asset: 'TUMBO', amountFluff: 1, idempotencyKey: 'void-debit' }), 'VOID_DEBIT');
  assert.throws(() => ledger.send({ from: 'u:alice', to: 'sys:void', asset: 'TUMBO', amountFluff: 1, idempotencyKey: 'fake-burn' }), TokenTransferError);
  assert.throws(() => ledger.fundDemo({ to: 'u:thief', asset: 'sMIMAS', amountFluff: 1, idempotencyKey: 'fake-smimas' }), TokenTransferError);
  assert.deepEqual(state(ledger), before);
});

test('reusing a send key with different action, recipient, amount, memo, or actor fails atomically', () => {
  const ledger = fundedLedger(), args = { from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'bound-send' };
  const receipt = ledger.send(args), before = state(ledger);
  for (const change of [{ to: 'u:carol' }, { amountFluff: 11 }, { memo: 'changed' }, { actor: 'u:bob' }, { asset: 'sMIMAS' }]) {
    assertCode(() => ledger.send({ ...args, ...change }), 'IDEM_MISMATCH');
  }
  assertCode(() => ledger.tip(args), 'IDEM_MISMATCH');
  assert.equal(ledger.send(args), receipt); assert.deepEqual(state(ledger), before);
});

test('hold idempotency binds the intended recipient, rather than only the escrow posting', () => {
  const ledger = fundedLedger(), args = { from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'bound-hold' };
  const receipt = ledger.deliverHold(args), before = state(ledger);
  assert.equal(receipt.links.recipient, 'u:bob');
  assertCode(() => ledger.deliverHold({ ...args, to: 'u:carol' }), 'IDEM_MISMATCH');
  assert.deepEqual(state(ledger), before); assert.equal(ledger.getIntent(receipt.intentId).to, 'u:bob');
});

test('settlement keys cannot replay a different intent and cancel retries bind reason/memo', () => {
  const ledger = fundedLedger();
  const first = ledger.deliverHold({ from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'first-intent' });
  const second = ledger.deliverHold({ from: 'u:alice', to: 'u:carol', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'second-intent' });
  const settled = ledger.deliverSettle({ intentId: first.intentId, idempotencyKey: 'bound-settle' });
  const before = state(ledger);
  assertCode(() => ledger.deliverSettle({ intentId: second.intentId, idempotencyKey: 'bound-settle' }), 'IDEM_MISMATCH');
  assert.deepEqual(state(ledger), before); assert.equal(ledger.getIntent(second.intentId).status, 'held');
  assert.equal(ledger.deliverSettle({ intentId: first.intentId, idempotencyKey: 'bound-settle' }), settled);
  const args = { intentId: second.intentId, idempotencyKey: 'bound-cancel', reason: 'change of plan', memo: 'local' };
  const cancelled = ledger.deliverCancel(args), after = state(ledger);
  assert.equal(ledger.deliverCancel(args), cancelled);
  assertCode(() => ledger.deliverCancel({ ...args, reason: 'different' }), 'IDEM_MISMATCH');
  assert.deepEqual(state(ledger), after);
});

test('second adapters and canonical snapshot reloads reconstruct held and closed intents without another ledger', () => {
  const ledger = fundedLedger(), hold = ledger.deliverHold({ from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'reload-hold' });
  const sibling = createTokenTransferLedger({ engine: ledger.engine });
  assert.equal(sibling.ledger, ledger.ledger); assert.deepEqual(sibling.getIntent(hold.intentId), ledger.getIntent(hold.intentId));
  const restored = loadTokenEngine(serializeTokenEngine(ledger.engine)), adapter = createTokenTransferLedger({ engine: restored });
  assert.deepEqual(adapter.getIntent(hold.intentId), ledger.getIntent(hold.intentId));
  const settled = adapter.deliverSettle({ intentId: hold.intentId, idempotencyKey: 'reload-settle' });
  assert.equal(restored.balance('u:bob', 'TUMBO'), 10); assert.equal(adapter.balance('sys:escrow', 'TUMBO'), 0);
  const restoredAgain = loadTokenEngine(serializeTokenEngine(restored)), again = createTokenTransferLedger({ engine: restoredAgain });
  assert.equal(again.getIntent(hold.intentId).status, 'settled');
  const tick = restoredAgain.ledger.tick;
  assert.equal(again.deliverSettle({ intentId: hold.intentId, idempotencyKey: 'reload-settle' }).id, settled.id);
  assert.equal(restoredAgain.ledger.tick, tick); assert.equal(again.assertConservation(), true);
});

test('reentrant settlement sees the canonical closed intent and cannot drain another hold', () => {
  const ledger = fundedLedger();
  const hold = ledger.deliverHold({ from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'reentry-hold' });
  const other = ledger.deliverHold({ from: 'u:alice', to: 'u:carol', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'reentry-other' });
  const attempts = [];
  const off = ledger.engine.ledger.onCommit(row => { if (row.links?.phase === 'settle') {
    try { ledger.deliverSettle({ intentId: hold.intentId, idempotencyKey: 'reentry-again' }); } catch (error) { attempts.push(error.code); }
  } });
  ledger.deliverSettle({ intentId: hold.intentId, idempotencyKey: 'reentry-settle' }); off();
  assert.deepEqual(attempts, ['INTENT_STATE']); assert.equal(ledger.balance('u:bob', 'TUMBO'), 10);
  assert.equal(ledger.balance('sys:escrow', 'TUMBO'), 10); assert.equal(ledger.getIntent(other.intentId).status, 'held');
});

test('a reversed hold cannot consume another intent, and reversing settlement restores a held intent', () => {
  const ledger = fundedLedger();
  const first = ledger.deliverHold({ from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'reverse-hold' });
  const second = ledger.deliverHold({ from: 'u:alice', to: 'u:carol', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'reverse-other' });
  ledger.engine.reverse({ journalId: first.id });
  const before = state(ledger); assert.equal(ledger.getIntent(first.intentId).status, 'reversed');
  assert.throws(() => ledger.deliverSettle({ intentId: first.intentId, idempotencyKey: 'after-reverse-hold' }), IntentStateError);
  assert.deepEqual(state(ledger), before);
  const settled = ledger.deliverSettle({ intentId: second.intentId, idempotencyKey: 'reverse-settle' });
  ledger.engine.reverse({ journalId: settled.id });
  assert.equal(ledger.getIntent(second.intentId).status, 'held'); assert.equal(ledger.balance('sys:escrow', 'TUMBO'), 10);
  ledger.deliverCancel({ intentId: second.intentId, idempotencyKey: 'cancel-reversed-settle' });
  assert.equal(ledger.balance('sys:escrow', 'TUMBO'), 0); assert.equal(ledger.assertConservation(), true);
});

test('underfunded escrow cannot settle one intent by consuming another held reservation', () => {
  const ledger = fundedLedger();
  const first = ledger.deliverHold({ from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'cover-first' });
  ledger.deliverHold({ from: 'u:alice', to: 'u:carol', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'cover-second' });
  // Simulate an independently authorized local owner moving escrow. The
  // transfer adapter must detect that its reservations are no longer covered.
  ledger.engine.ledger.post([
    { account: 'sys:escrow', asset: 'TUMBO', amount: -10 }, { account: 'u:external', asset: 'TUMBO', amount: 10 },
  ], { idempotencyKey: 'fixture:escrow-withdrawal', action: 'fixture', authority: 'internal' });
  const before = state(ledger);
  assert.throws(() => ledger.deliverSettle({ intentId: first.intentId, idempotencyKey: 'cover-settle' }), InsufficientFundsError);
  assert.throws(() => ledger.deliverCancel({ intentId: first.intentId, idempotencyKey: 'cover-cancel' }), InsufficientFundsError);
  assert.deepEqual(state(ledger), before);
});

test('canonical receipt aliases cannot hide tampering and corrupt chains block mutations', () => {
  const ledger = fundedLedger(), receipt = ledger.send({ from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'verify-bound' });
  assert.equal(ledger.verifyReceipt(receipt).ok, true);
  assert.equal(ledger.verifyReceipt({ ...receipt, summary: 'forged title' }).ok, false);
  assert.equal(ledger.verifyReceipt({ ...receipt, postings: [{ account: 'u:bob', asset: 'TUMBO', amount: 1000 }] }).ok, false);
  const index = ledger.engine.ledger._journals.findIndex(row => row.id === receipt.id);
  ledger.engine.ledger._journals[index] = { ...ledger.engine.ledger._journals[index], memo: 'tampered' };
  assert.equal(ledger.verifyReceipt(receipt.id).ok, false);
  const count = ledger.journalCount();
  assertCode(() => ledger.send({ from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 1, idempotencyKey: 'invalid-chain-send' }), 'INVALID_CHAIN');
  assertCode(() => ledger.fundDemo({ to: 'u:alice', amountFluff: 1, idempotencyKey: 'invalid-chain-fund' }), 'INVALID_CHAIN');
  assert.equal(ledger.journalCount(), count);
});

test('layered facade shares engine balances/events across canonical operations and attaches once', () => {
  const engine = createTokenEngine(), base = createTokenFacade(engine), layered = attachTokenTransfers(base), seen = [];
  assert.equal(layered.engine, base.engine); assert.equal(layered.tokenTransfers.ledger, engine.ledger);
  assert.equal(attachTokenTransfers(layered), layered);
  const off = base.on('receipt', event => seen.push(event));
  layered.fundDemo({ to: 'u:alice', amountFluff: 100, idempotencyKey: 'layer:fund' });
  layered.send({ from: 'u:alice', to: 'u:bob', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'layer:send' });
  base.execute('send', { from: 'u:bob', to: 'u:carol', amountFluff: 5, idempotencyKey: 'layer:base-send' });
  assert.equal(seen.length, 3); assert.equal(base.balance('u:alice', 'TUMBO'), 90);
  assert.equal(layered.tokenTransfers.balance('u:carol', 'TUMBO'), 5);
  assert.equal(layered.tokenTransfers.receipts().some(row => row.id === seen[2].receipt.id), true);
  off(); base.dispose();
});

test('attachment replaces only the matching browser facade and rejects missing/conflicting owners', () => {
  const engine = createTokenEngine(), base = createTokenFacade(engine), previous = globalThis.window;
  try {
    globalThis.window = { TumboToken: base };
    const layered = attachTokenTransfers(base);
    assert.equal(globalThis.window.TumboToken, layered); assert.equal(base.tokenTransfers, undefined);
    assert.equal(attachTokenTransfers(layered), layered);
    assert.throws(() => attachTokenTransfers(base, { engine: createTokenEngine() }), /must match/);
    assert.throws(() => attachTokenTransfers({ balance: () => 42 }), /canonical QuoteEngine/);
    assert.throws(() => createTokenTransferLedger({ engine: {} }), /canonical QuoteEngine/);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; base.dispose(); }
});

test('demo funding is explicit, TUMBO-only, bound to the canonical client key, and atomic on exhaustion', () => {
  const engine = createTokenEngine({ ...CONFIG, faucetTumbo: 10 }), ledger = createTokenTransferLedger({ engine });
  const args = { to: 'u:alice', amountFluff: 10, idempotencyKey: 'last-funding' };
  const receipt = ledger.fundDemo(args), before = state(ledger);
  assert.equal(ledger.fundDemo(args).id, receipt.id); assert.deepEqual(state(ledger), before);
  assertCode(() => ledger.fundDemo({ ...args, to: 'u:bob' }), 'IDEM_MISMATCH');
  assert.throws(() => ledger.fundDemo({ to: 'u:bob', amountFluff: 1, idempotencyKey: 'empty-faucet' }), /insufficient funds/);
  assert.deepEqual(state(ledger), before); assert.equal(ledger.balance('u:bob', 'TUMBO'), 0);
});
