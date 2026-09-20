/**
 * Token exchange / quote engine tests.
 *
 * Run: npm test   (node --test tests/*.test.mjs)
 *
 * Covers the token workstream contract: forged-quote rejection,
 * expired-quote rejection, double-execution of one quote id, rounding
 * conservation across many market ops, the 10 bps Void tithe, idempotent
 * replays, exact mulDivFloor math, journal invariants, the sys:void
 * debit/credit rules, fmt(), and 'tumbo:token' event emission.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG,
  ASSETS,
  MARKET_MAKER,
  VOID_ACCOUNT,
  TokenLedger,
  TumboUserLedger,
  QuoteEngine,
  QuoteError,
  createTokenEngine,
  mulDivFloor,
  fmt,
  quoteHash,
  installFacade,
} from "../src/domains/token.js";

const ALICE = "u:alice";
const BOB = "u:bob";

function fundedEngine() {
  const eng = createTokenEngine();
  assert.ok(eng instanceof QuoteEngine);
  eng.faucet(ALICE, "TUMBO", 100_000_000, { idempotencyKey: "fund:alice" });
  eng.faucet(BOB, "TUMBO", 50_000_000, { idempotencyKey: "fund:bob" });
  return eng;
}

function snapshotAll(eng) {
  const snap = new Map();
  for (const { account, asset } of eng.ledger.accounts()) {
    snap.set(`${account}|${asset}`, eng.balance(account, asset));
  }
  return snap;
}

describe("token exchange: genesis and market maker", () => {
  it("seeds the market maker with sMIMAS inventory and a TUMBO float", () => {
    const eng = createTokenEngine();
    assert.equal(eng.balance(MARKET_MAKER, "sMIMAS"), CONFIG.supply.sMIMAS);
    assert.equal(eng.balance(MARKET_MAKER, "TUMBO"), CONFIG.marketFloatTumbo);
    assert.equal(
      eng.balance("sys:treasury", "TUMBO"),
      CONFIG.supply.TUMBO - CONFIG.marketFloatTumbo - CONFIG.faucetTumbo
    );
  });
});

describe("token exchange: buy / sell / exchange", () => {
  it("buy settles with the 10 bps Void tithe", () => {
    const eng = fundedEngine();
    const q = eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 100_000 });
    assert.equal(q.to, MARKET_MAKER);
    assert.equal(q.amountOut, 1_000_000); // 1 TUMBO = 10 sMIMAS
    assert.match(q.hash, /^[0-9a-f]{16}$/);
    const r = eng.execute(q);
    assert.equal(r.action, "buy");
    assert.equal(r.quoteId, q.id);
    assert.equal(r.tithe, 100); // floor(100_000 * 10 / 10_000)
    assert.equal(eng.balance(ALICE, "TUMBO"), 100_000_000 - 100_000);
    assert.equal(eng.balance(ALICE, "sMIMAS"), 1_000_000);
    assert.equal(eng.balance(VOID_ACCOUNT, "TUMBO"), 100);
    assert.equal(eng.balance(MARKET_MAKER, "TUMBO"), CONFIG.marketFloatTumbo + 99_900);
    assert.equal(eng.balance(MARKET_MAKER, "sMIMAS"), CONFIG.supply.sMIMAS - 1_000_000);
  });

  it("sell uses the reciprocal price and tithes in sMIMAS", () => {
    const eng = fundedEngine();
    eng.execute(eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 100_000 }));
    const r = eng.execute(
      eng.quote({ action: "sell", from: ALICE, fromAsset: "sMIMAS", toAsset: "TUMBO", amountIn: 50_000 })
    );
    assert.equal(r.amountOut, 5_000);
    assert.equal(r.tithe, 50);
    assert.equal(eng.balance(VOID_ACCOUNT, "sMIMAS"), 50);
    assert.equal(eng.balance(ALICE, "TUMBO"), 100_000_000 - 100_000 + 5_000);
  });

  it("exchange works in both directions", () => {
    const eng = fundedEngine();
    const r1 = eng.execute(
      eng.quote({ action: "exchange", from: BOB, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 77_777 })
    );
    assert.equal(r1.amountOut, 777_770);
    const r2 = eng.execute(
      eng.quote({ action: "exchange", from: BOB, fromAsset: "sMIMAS", toAsset: "TUMBO", amountIn: 70_000 })
    );
    assert.equal(r2.amountOut, 7_000);
  });
});

describe("token exchange: hardened quotes", () => {
  it("rejects a forged quote (tampered amountOut)", () => {
    const eng = fundedEngine();
    const q = eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 100_000 });
    const forged = { ...q, amountOut: q.amountOut + 1 };
    assert.throws(() => eng.execute(forged), /tampered|hash mismatch/);
    assert.equal(eng.balance(ALICE, "TUMBO"), 100_000_000); // funds untouched
  });

  it("rejects a forged quote (retargeted debit account)", () => {
    const eng = fundedEngine();
    const q = eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 100_000 });
    assert.notEqual(quoteHash({ ...q, from: BOB }), q.hash);
    assert.throws(() => eng.execute({ ...q, from: BOB }), /tampered|hash mismatch/);
  });

  it("rejects an expired quote", () => {
    const eng = fundedEngine();
    const q = eng.quote({
      action: "buy",
      from: ALICE,
      fromAsset: "TUMBO",
      toAsset: "sMIMAS",
      amountIn: 10_000,
      ttlMs: -1,
    });
    assert.ok(q.expiresAt <= Date.now());
    assert.throws(() => eng.execute(q), QuoteError);
    assert.throws(() => eng.execute(q), /expired/);
    assert.equal(eng.balance(ALICE, "TUMBO"), 100_000_000);
  });

  it("double-execution of one quote id returns the original receipt and moves funds once", () => {
    const eng = fundedEngine();
    const q = eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 100_000 });
    const r1 = eng.execute(q);
    const afterFirst = {
      tumbo: eng.balance(ALICE, "TUMBO"),
      smimas: eng.balance(ALICE, "sMIMAS"),
      void: eng.balance(VOID_ACCOUNT, "TUMBO"),
    };
    const r2 = eng.execute(q);
    assert.equal(r2, r1); // the identical receipt object
    assert.equal(r2.id, r1.id);
    assert.equal(eng.balance(ALICE, "TUMBO"), afterFirst.tumbo);
    assert.equal(eng.balance(ALICE, "sMIMAS"), afterFirst.smimas);
    assert.equal(eng.balance(VOID_ACCOUNT, "TUMBO"), afterFirst.void);
    // A new idempotency key cannot re-execute the consumed quote.
    assert.throws(() => eng.execute(q, { idempotencyKey: "another-key" }), /already been executed/);
  });

  it("replays with a repeated idempotency key return the original receipt", () => {
    const eng = fundedEngine();
    const q = eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 20_000 });
    const r1 = eng.execute(q, { idempotencyKey: "client-key-1" });
    const mid = eng.balance(ALICE, "TUMBO");
    const r2 = eng.execute(q, { idempotencyKey: "client-key-1" });
    assert.equal(r2, r1);
    assert.equal(eng.balance(ALICE, "TUMBO"), mid);
  });

  it("quote() validates its inputs", () => {
    const eng = fundedEngine();
    assert.throws(
      () => eng.quote({ action: "swap", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 10 }),
      /action must be/
    );
    assert.throws(
      () => eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "TUMBO", amountIn: 10 }),
      /must differ/
    );
    assert.throws(
      () => eng.quote({ action: "buy", from: ALICE, fromAsset: "sMIMAS", toAsset: "TUMBO", amountIn: 10 }),
      /TUMBO -> sMIMAS only/
    );
    assert.throws(
      () => eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 0 }),
      /positive/
    );
    assert.throws(
      () => eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1.5 }),
      TypeError
    );
    // Dust: the output rounds to zero fluff.
    assert.throws(
      () => eng.quote({ action: "sell", from: ALICE, fromAsset: "sMIMAS", toAsset: "TUMBO", amountIn: 5 }),
      /rounds to zero/
    );
    assert.throws(() => eng.execute(null), /quote is required/);
  });

  it("quote failures are QuoteErrors", () => {
    const eng = fundedEngine();
    assert.throws(
      () => eng.quote({ action: "nope", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 10 }),
      QuoteError
    );
  });
});

describe("token exchange: conservation and ledger invariants", () => {
  it("conserves funds across many market ops (rounding-safe)", () => {
    const eng = fundedEngine();
    const before = snapshotAll(eng);
    const buyAmounts = [1, 3, 7, 999, 1_000, 12_345, 100_000, 999_999];
    for (const amountIn of buyAmounts) {
      eng.execute(eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn }));
    }
    for (const amountIn of [500, 25_000]) {
      eng.execute(eng.quote({ action: "sell", from: ALICE, fromAsset: "sMIMAS", toAsset: "TUMBO", amountIn }));
    }
    eng.execute(eng.quote({ action: "exchange", from: BOB, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 77_777 }));

    for (const asset of ASSETS) {
      let delta = 0;
      for (const { account, asset: a } of eng.ledger.accounts()) {
        if (a !== asset) continue;
        delta += eng.balance(account, asset) - (before.get(`${account}|${asset}`) ?? 0);
      }
      assert.equal(delta, 0, `conservation violated for ${asset}: net delta ${delta}`);
    }
    for (const { account, asset } of eng.ledger.accounts()) {
      const b = eng.balance(account, asset);
      if (account === "sys:issuance") {
        assert.ok(b <= 0, `issuance mirror must stay non-positive: ${b}`);
      } else {
        assert.ok(b >= 0, `${account} ${asset} went negative: ${b}`);
      }
    }
  });

  it("rejects journals that do not sum to zero", () => {
    const eng = createTokenEngine();
    assert.throws(
      () =>
        eng.ledger.post([{ account: ALICE, asset: "TUMBO", amount: 10 }], {
          idempotencyKey: "unbalanced",
          action: "test",
        }),
      /sum to zero/
    );
  });

  it("never debits sys:void and credits it only via tithes/burns", () => {
    const eng = createTokenEngine();
    assert.throws(
      () =>
        eng.ledger.post(
          [
            { account: VOID_ACCOUNT, asset: "TUMBO", amount: -1 },
            { account: ALICE, asset: "TUMBO", amount: 1 },
          ],
          { idempotencyKey: "void-debit", action: "test" }
        ),
      /never debited/
    );
    assert.throws(
      () =>
        eng.ledger.post(
          [
            { account: MARKET_MAKER, asset: "TUMBO", amount: -1 },
            { account: VOID_ACCOUNT, asset: "TUMBO", amount: 1 },
          ],
          { idempotencyKey: "void-credit", action: "test" }
        ),
      /only by tithes or burns/
    );
  });

  it("never lets balances go negative", () => {
    const eng = fundedEngine();
    eng.execute(eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 100_000_000 }));
    assert.equal(eng.balance(ALICE, "TUMBO"), 0);
    const q = eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1 });
    assert.throws(() => eng.execute(q), /insufficient funds/);
  });
});

describe("token exchange: exact integer math", () => {
  it("mulDivFloor is exact where float math loses funds", () => {
    // 134217727 * 134217729 = 2^54 - 1 exactly, but float64 rounds the
    // intermediate product up to 2^54, so naive float math overpays by 1.
    assert.equal(mulDivFloor(134217727, 134217729, 4), 4_503_599_627_370_495);
    assert.equal(Number((134217727n * 134217729n) / 4n), 4_503_599_627_370_495);
    assert.notEqual(Math.floor((134217727 * 134217729) / 4), 4_503_599_627_370_495);
    assert.equal(mulDivFloor(10, 3, 4), 7); // floor(7.5)
    assert.equal(mulDivFloor(0, 123, 456), 0);
    assert.throws(() => mulDivFloor(1.5, 2, 3), TypeError);
    assert.throws(() => mulDivFloor(-1, 2, 3), TypeError);
    assert.throws(() => mulDivFloor(1, 2, 0), TypeError);
  });
});

describe("token exchange: formatting and facade", () => {
  it("fmt() renders fluff as TUMBO-SIM", () => {
    assert.equal(fmt(1000), "1.000 TUMBO-SIM");
    assert.equal(fmt(5), "0.005 TUMBO-SIM");
    assert.equal(fmt(0), "0.000 TUMBO-SIM");
    assert.equal(fmt(1_234_567), "1,234.567 TUMBO-SIM");
    assert.throws(() => fmt(1.5), TypeError);
  });

  it("installFacade exposes the window.TumboToken contract", () => {
    const target = {};
    const api = installFacade(target, { force: true });
    assert.equal(target.TumboToken, api);
    // Unified contract: facade.ledger is the wallet-facing user ledger;
    // the hardened double-entry ledger lives at facade.engine.ledger.
    assert.ok(api.ledger instanceof TumboUserLedger);
    assert.ok(api.engine.ledger instanceof TokenLedger);
    assert.equal(typeof api.balance, "function");
    assert.equal(typeof api.fmt, "function");
    assert.equal(typeof api.on, "function");
    assert.equal(typeof api.quote, "function");
    assert.equal(typeof api.execute, "function");
  });
});

describe("token exchange: events", () => {
  it("emits receipt and balance-changed events on settle", () => {
    const eng = fundedEngine();
    const seen = [];
    const off = eng.on("receipt", ({ receipt }) => seen.push(["receipt", receipt.action]));
    eng.on("balance-changed", (d) => seen.push(["balance-changed", d.account, d.asset]));
    eng.execute(eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 10_000 }));
    off();
    assert.ok(seen.some(([t]) => t === "receipt"), "expected a receipt event");
    const changed = seen.filter(([t]) => t === "balance-changed");
    assert.ok(changed.length >= 4, `expected balance-changed events, got ${changed.length}`);
    assert.ok(changed.some(([, acct, asset]) => acct === ALICE && asset === "sMIMAS"));
    assert.ok(changed.some(([, acct, asset]) => acct === VOID_ACCOUNT && asset === "TUMBO"));
  });

  it("dispatches document CustomEvent('tumbo:token') on settle in DOM environments", () => {
    const dispatched = [];
    const realDocument = globalThis.document;
    const realCustomEvent = globalThis.CustomEvent;
    globalThis.document = { dispatchEvent: (e) => dispatched.push(e) };
    globalThis.CustomEvent = class FakeEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
    try {
      const eng = fundedEngine();
      eng.execute(eng.quote({ action: "buy", from: ALICE, fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 10_000 }));
    } finally {
      globalThis.document = realDocument;
      globalThis.CustomEvent = realCustomEvent;
    }
    assert.ok(dispatched.length > 0, "expected tumbo:token events");
    assert.ok(dispatched.every((e) => e.type === "tumbo:token"));
    assert.ok(dispatched.some((e) => e.detail?.type === "receipt"));
    assert.ok(dispatched.some((e) => e.detail?.type === "balance-changed"));
  });
});
