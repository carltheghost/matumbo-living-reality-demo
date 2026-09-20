/**
 * ledger-core invariant tests.
 *
 * Ports the assertion suite from TumboAgent PR #6
 * (tests/test_money.py, test_ledger.py, test_permissions_and_diagnostics.py,
 *  test_wallet.py — tag archive/pr-6-claude-matumbo-master-spec-mz1vv4)
 * plus coverage for the content-addressed event envelope and the
 * EchoProof hash chain.
 *
 * Run: node --test tests/ledger-core.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  Money,
  Currency,
  TUMBO,
  CurrencyMismatchError,
  PrecisionError,
  createEvent,
  EventLog,
  contentHash,
  Ledger,
  Posting,
  InsufficientFundsError,
  UnbalancedTransactionError,
  UnknownAccountError,
  EchoProof,
  Receipt,
  DEMO_STAMP,
  Principal,
  PolicyEngine,
  Role,
  AutonomyLevel,
  PermissionDenied,
  MAJOR_CRYPTOS,
  QuarkWallet,
  subAccount,
} from "../src/domains/ledger-core/index.js";

// ---------------- money ----------------

describe("money: no floats, exact integer base units", () => {
  it("converts human amounts exactly", () => {
    assert.equal(Money.of("1").units, 100_000_000n);
    assert.equal(Money.of("0.00000001").units, 1n);
    assert.equal(Money.of("1.5").units, 150_000_000n);
  });

  it("rejects excess precision instead of truncating", () => {
    assert.throws(() => Money.of("0.000000001"), PrecisionError); // 9dp > 8dp
  });

  it("add/sub are exact (the 0.1 + 0.2 float trap)", () => {
    const a = Money.of("0.1");
    const b = Money.of("0.2");
    assert.ok(a.add(b).equals(Money.of("0.3")));
    assert.equal(a.add(b).toHumanString(), "0.30000000");
  });

  it("refuses Numbers on the value path", () => {
    assert.throws(() => Money.of(1), TypeError);
    assert.throws(() => Money.of(0.1), TypeError);
    assert.throws(() => new Money(5, TUMBO), TypeError);
    assert.throws(() => new Money(true, TUMBO), TypeError);
  });

  it("guards currency mismatch", () => {
    const fake = new Currency("FAKE", 8);
    assert.throws(() => Money.of("1").add(new Money(1n, fake)), CurrencyMismatchError);
  });

  it("splitFee conserves value exactly", () => {
    const total = Money.of("100");
    const { fee, remainder } = total.splitFee("0.003"); // 0.3%
    assert.ok(fee.add(remainder).equals(total)); // nothing created or lost
    assert.ok(fee.equals(Money.of("0.3")));
  });

  it("scale uses explicit rounding modes", () => {
    const m = Money.of("1"); // 100_000_000 units
    // 1 TUMBO * 0.333333335 = 33,333,333.5 base units
    assert.equal(m.scale("0.333333335").units, 33333334n); // half-up (default)
    assert.equal(m.scale("0.333333335", "down").units, 33333333n);
    // 1 TUMBO * 0.000000005 = 0.5 base units -> tie rounds away from zero
    assert.equal(m.scale("0.000000005").units, 1n);
    assert.equal(m.scale("0.000000005", "down").units, 0n);
  });

  it("renders human strings with full precision", () => {
    assert.equal(Money.of("1.5").toString(), "1.50000000 TUMBO");
    assert.equal(Money.of("-2").toString(), "-2.00000000 TUMBO");
  });
});

// ---------------- events ----------------

describe("events: content-addressed envelope", () => {
  it("identical payloads hash identically (deterministic)", () => {
    const h1 = contentHash({ b: 2, a: 1 });
    const h2 = contentHash({ a: 1, b: 2 });
    assert.equal(h1, h2);
    assert.equal(h1.length, 64);
  });

  it("identical events get identical eventIds", () => {
    const base = {
      eventType: "ledger.transaction",
      aggregateId: "k1",
      realm: "test",
      actorId: "x",
      payload: { a: 1 },
      idempotencyKey: "k1",
      occurredAt: 1726848000000,
    };
    const e1 = createEvent(base);
    const e2 = createEvent(base);
    assert.equal(e1.eventId, e2.eventId);
    assert.notEqual(e1.correlationId, e2.correlationId); // ids differ per instance
  });

  it("event log de-duplicates by idempotency key", () => {
    const log = new EventLog();
    const e1 = log.append(
      createEvent({
        eventType: "t", aggregateId: "a", realm: "r", actorId: "x",
        idempotencyKey: "dup", occurredAt: 1,
      })
    );
    const e2 = log.append(
      createEvent({
        eventType: "t", aggregateId: "a", realm: "r", actorId: "x",
        idempotencyKey: "dup", occurredAt: 1,
      })
    );
    assert.equal(e1.eventId, e2.eventId);
    assert.equal(e1.sequenceNumber, 0);
    assert.equal(log.length, 1);
  });

  it("assigns monotonic sequence numbers", () => {
    const log = new EventLog();
    const mk = (k) =>
      createEvent({ eventType: "t", aggregateId: "a", realm: "r", actorId: "x", idempotencyKey: k, occurredAt: 1 });
    const a = log.append(mk("k1"));
    const b = log.append(mk("k2"));
    assert.equal(a.sequenceNumber, 0);
    assert.equal(b.sequenceNumber, 1);
    assert.equal(log.replay().length, 2);
  });
});

// ---------------- ledger ----------------

describe("ledger: atomic double-entry", () => {
  const makeLedger = () => {
    const lg = new Ledger();
    lg.openAccount("system", TUMBO, true);
    lg.openAccount("alice");
    lg.openAccount("bob");
    return lg;
  };
  const fund = (lg, who, amount) =>
    lg.post(
      [new Posting("system", Money.of(amount).neg()), new Posting(who, Money.of(amount))],
      { realm: "test", actorId: "system", idempotencyKey: `fund-${who}-${amount}` }
    );

  it("rejects unbalanced transactions", () => {
    const lg = makeLedger();
    assert.throws(
      () =>
        lg.post([new Posting("alice", Money.of("5"))], {
          realm: "test", actorId: "x", idempotencyKey: "k1",
        }),
      UnbalancedTransactionError
    );
  });

  it("blocks negative balances and stays atomic on failure", () => {
    const lg = makeLedger();
    fund(lg, "alice", "10");
    assert.throws(
      () =>
        lg.post(
          [new Posting("alice", Money.of("11").neg()), new Posting("bob", Money.of("11"))],
          { realm: "test", actorId: "alice", idempotencyKey: "overspend" }
        ),
      InsufficientFundsError
    );
    // atomicity: the failed post left balances untouched
    assert.ok(lg.balance("alice").equals(Money.of("10")));
    assert.ok(lg.balance("bob").equals(Money.zero()));
  });

  it("always sums to zero (trial balance)", () => {
    const lg = makeLedger();
    fund(lg, "alice", "100");
    lg.post(
      [new Posting("alice", Money.of("30").neg()), new Posting("bob", Money.of("30"))],
      { realm: "test", actorId: "alice", idempotencyKey: "t1" }
    );
    assert.ok(lg.trialBalance().isZero);
  });

  it("idempotent replay is a no-op returning the original event", () => {
    const lg = makeLedger();
    fund(lg, "alice", "50");
    const postings = () => [
      new Posting("alice", Money.of("5").neg()),
      new Posting("bob", Money.of("5")),
    ];
    const ev1 = lg.post(postings(), { realm: "test", actorId: "alice", idempotencyKey: "same" });
    const afterFirst = lg.balance("bob");
    const ev2 = lg.post(postings(), { realm: "test", actorId: "alice", idempotencyKey: "same" });
    assert.equal(ev1.eventId, ev2.eventId);
    assert.ok(lg.balance("bob").equals(afterFirst)); // not double-applied
    assert.equal(lg.log.length, 2); // fund + one transaction
  });

  it("rejects unknown accounts", () => {
    const lg = makeLedger();
    assert.throws(
      () =>
        lg.post(
          [new Posting("ghost", Money.of("1")), new Posting("alice", Money.of("1").neg())],
          { realm: "test", actorId: "x", idempotencyKey: "k" }
        ),
      UnknownAccountError
    );
  });

  it("lets the issuance account go negative by design", () => {
    const lg = makeLedger();
    fund(lg, "alice", "7");
    assert.ok(lg.balance("system").isNegative);
    assert.ok(lg.trialBalance().isZero);
  });
});

// ---------------- echoproof ----------------

describe("echoproof: hash-chained demo receipts", () => {
  it("issues receipts stamped Local Demo Proof", () => {
    const ep = new EchoProof();
    const r = ep.issue({
      actorId: "alice", realm: "quark_wallet", reference: "ref1",
      action: "send", summary: "Sent 1 TUMBO",
      beforeState: { a: 1 }, afterState: { a: 0 }, payload: { x: 1 },
    });
    assert.ok(r instanceof Receipt);
    assert.equal(r.stamp, DEMO_STAMP);
    assert.ok(r.human().includes("Local Demo Proof"));
    assert.equal(r.sequence, 0);
  });

  it("verifyChain passes on an intact chain", () => {
    const ep = new EchoProof();
    for (let i = 0; i < 3; i++) {
      ep.issue({
        actorId: "a", realm: "r", reference: `r${i}`, action: "act",
        summary: `step ${i}`, beforeState: { i }, afterState: { i: i + 1 },
        payload: { i },
      });
    }
    assert.equal(ep.all().length, 3);
    assert.ok(ep.verifyChain());
  });

  it("verifyChain detects a tampered receipt", () => {
    const ep = new EchoProof();
    ep.issue({
      actorId: "a", realm: "r", reference: "r0", action: "act",
      summary: "s", beforeState: { i: 0 }, afterState: { i: 1 }, payload: {},
    });
    ep.issue({
      actorId: "a", realm: "r", reference: "r1", action: "act",
      summary: "s", beforeState: { i: 1 }, afterState: { i: 2 }, payload: {},
    });
    // tamper with the internal state backing receipt #1
    ep._states[1].afterState = { i: 999 };
    assert.equal(ep.verifyChain(), false);
  });
});

// ---------------- permissions ----------------

describe("permissions: autonomy ladder and budgets", () => {
  it("agent below the required autonomy cannot move money", () => {
    const pol = new PolicyEngine();
    const agent = new Principal("bot", Role.AI_AGENT, {
      autonomy: AutonomyLevel.A1_SUGGEST, budgetUnits: 10_000n,
    });
    assert.throws(
      () => pol.authorizeAction(agent, "reversible_money", { amountUnits: 1n }),
      PermissionDenied
    );
  });

  it("high-impact money always needs a human approval token", () => {
    const pol = new PolicyEngine();
    const agent = new Principal("bot", Role.AI_AGENT, {
      autonomy: AutonomyLevel.A4_EXECUTE_GUARDED, budgetUnits: 1_000_000n,
    });
    assert.throws(
      () => pol.authorizeAction(agent, "high_impact_money", { amountUnits: 1n }),
      PermissionDenied
    );
    pol.authorizeAction(agent, "high_impact_money", {
      amountUnits: 1n, approvalToken: "human-signed-xyz",
    }); // with a token it is allowed
  });

  it("budgets are enforced and tracked", () => {
    const pol = new PolicyEngine();
    const agent = new Principal("bot", Role.AI_AGENT, {
      autonomy: AutonomyLevel.A3_EXECUTE_REVERSIBLE, budgetUnits: 100n,
    });
    pol.authorizeAction(agent, "reversible_money", { amountUnits: 60n });
    assert.equal(agent.remainingBudget, 40n);
    assert.throws(
      () => pol.authorizeAction(agent, "reversible_money", { amountUnits: 50n }),
      PermissionDenied
    );
  });

  it("role capabilities gate wallet actions", () => {
    const pol = new PolicyEngine();
    const guest = new Principal("g", Role.GUEST);
    const human = new Principal("h", Role.VERIFIED_HUMAN);
    assert.equal(pol.can(guest, "wallet.send"), false);
    assert.equal(pol.can(human, "wallet.send"), true);
    assert.equal(pol.can(guest, "wallet.read"), true);
    assert.throws(() => pol.require(guest, "admin.act"), PermissionDenied);
  });
});

// ---------------- wallet ----------------

describe("quark wallet: simulated-custody vertical slice", () => {
  const makeWallet = () => new QuarkWallet(new Ledger(), new EchoProof(), new PolicyEngine());
  const alice = () => new Principal("alice", Role.VERIFIED_HUMAN);

  it("send moves funds and conserves the total", () => {
    const w = makeWallet();
    const a = alice();
    w.demoGrant(a, Money.of("100"));
    w.send(a, "bob", Money.of("40"));
    assert.ok(w.balance("alice").available.equals(Money.of("60")));
    assert.ok(w.balance("bob").available.equals(Money.of("40")));
    assert.ok(w.ledger.trialBalance().isZero);
  });

  it("guest cannot send", () => {
    const w = makeWallet();
    const guest = new Principal("g", Role.GUEST);
    assert.throws(() => w.send(guest, "bob", Money.of("1")), PermissionDenied);
  });

  it("cannot spend escrowed funds", () => {
    const w = makeWallet();
    const a = alice();
    w.demoGrant(a, Money.of("10"));
    w.escrowLock(a, Money.of("8"));
    assert.ok(w.balance("alice").available.equals(Money.of("2")));
    assert.ok(w.balance("alice").escrow.equals(Money.of("8")));
    assert.throws(() => w.send(a, "bob", Money.of("5")), InsufficientFundsError);
  });

  it("escrow release pays the counterparty", () => {
    const w = makeWallet();
    const a = alice();
    w.demoGrant(a, Money.of("10"));
    w.escrowLock(a, Money.of("10"));
    w.escrowRelease(a, "bob", Money.of("10"));
    assert.ok(w.balance("alice").escrow.isZero);
    assert.ok(w.balance("bob").available.equals(Money.of("10")));
    assert.ok(w.ledger.trialBalance().isZero);
  });

  it("every action carries a demo-stamped receipt", () => {
    const w = makeWallet();
    const r = w.demoGrant(alice(), Money.of("1"));
    assert.equal(r.stamp, DEMO_STAMP);
    assert.ok(r.human().includes("Local Demo Proof"));
  });

  it("payment request flow pays once", () => {
    const w = makeWallet();
    const a = alice();
    const bob = new Principal("bob", Role.MERCHANT);
    w.demoGrant(a, Money.of("20"));
    const req = w.requestPayment(bob, "alice", Money.of("7"));
    assert.equal(req.status, "open");
    w.payRequest(a, req.requestId);
    assert.ok(w.balance("bob").available.equals(Money.of("7")));
    assert.throws(() => w.payRequest(a, req.requestId), Error); // cannot pay twice
  });

  it("only the requested payer can settle a request", () => {
    const w = makeWallet();
    const bob = new Principal("bob", Role.MERCHANT);
    const mallory = new Principal("mallory", Role.VERIFIED_HUMAN);
    const req = w.requestPayment(bob, "alice", Money.of("7"));
    assert.throws(() => w.payRequest(mallory, req.requestId), Error);
  });

  it("wallet holds nine major cryptos", () => {
    assert.equal(Object.keys(MAJOR_CRYPTOS).length, 9);
    const w = makeWallet();
    const a = alice();
    for (const currency of Object.values(MAJOR_CRYPTOS)) {
      w.demoGrant(a, Money.of("1.5", currency));
    }
    const balances = w.multiBalance(a.principalId, Object.values(MAJOR_CRYPTOS));
    assert.deepEqual(new Set(Object.keys(balances)), new Set(Object.keys(MAJOR_CRYPTOS)));
    for (const [code, bal] of Object.entries(balances)) {
      assert.ok(bal.available.equals(Money.of("1.5", MAJOR_CRYPTOS[code])));
    }
  });

  it("multi-asset balances are independent ledgers", () => {
    const w = makeWallet();
    const a = alice();
    const btc = MAJOR_CRYPTOS.BTC;
    const eth = MAJOR_CRYPTOS.ETH;
    w.demoGrant(a, Money.of("2", btc));
    w.demoGrant(a, Money.of("50", eth));
    w.send(a, "bob", Money.of("1", btc));
    assert.ok(w.balance("alice", btc).available.equals(Money.of("1", btc)));
    assert.ok(w.balance("alice", eth).available.equals(Money.of("50", eth))); // untouched
    assert.ok(w.balance("bob", btc).available.equals(Money.of("1", btc)));
    assert.ok(w.balance("bob", eth).available.isZero);
    assert.ok(w.ledger.trialBalance().isZero); // TUMBO ledger (default)
    assert.ok(w.ledger.trialBalance(btc).isZero);
    assert.ok(w.ledger.trialBalance(eth).isZero);
  });

  it("TUMBO account keys stay unprefixed for backward compatibility", () => {
    assert.equal(subAccount("alice", "available", TUMBO), "wallet:alice:available");
    assert.equal(subAccount("alice", "available", MAJOR_CRYPTOS.BTC), "wallet:alice:BTC:available");
  });

  it("escrow lock and release work per asset", () => {
    const w = makeWallet();
    const a = alice();
    const sol = MAJOR_CRYPTOS.SOL;
    w.demoGrant(a, Money.of("10", sol));
    w.escrowLock(a, Money.of("4", sol));
    assert.ok(w.balance("alice", sol).available.equals(Money.of("6", sol)));
    assert.ok(w.balance("alice", sol).escrow.equals(Money.of("4", sol)));
    w.escrowRelease(a, "bob", Money.of("4", sol));
    assert.ok(w.balance("alice", sol).escrow.isZero);
    assert.ok(w.balance("bob", sol).available.equals(Money.of("4", sol)));
  });
});
