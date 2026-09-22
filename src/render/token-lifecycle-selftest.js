/**
 * Token Lifecycle - built-in self-test (browser), on the unified token core.
 *
 * Runs the core lifecycle scenarios against a FRESH engine (never the shared
 * singleton) and returns [{name, ok, detail}] rows for the audit console
 * (?selftest=1). Mirrors tests/token-lifecycle-unified.test.mjs so the
 * browser and Node suites agree.
 *
 * SIMULATION ONLY - no real value, no network, no wallets.
 */

import {
  REVERSE_WINDOW_TICKS,
  ASSETS,
  fmt,
  fnv1a64Hex,
  QuoteError,
  AlreadyReversedError,
  ReverseWindowExpiredError,
  CancelRejectedError,
  JournalNotFoundError,
} from "../domains/token.js?v=20260922-cache2";

/**
 * @param {() => import("../domains/token.js").QuoteEngine} engineFactory
 */
export function runTokenLifecycleSelfTest(engineFactory) {
  const rows = [];
  const check = (name, fn) => {
    try { fn(); rows.push({ name, ok: true }); }
    catch (err) { rows.push({ name, ok: false, detail: err && err.message }); }
  };
  const eq = (a, b, msg) => {
    if (a !== b) throw new Error((msg || "mismatch") + ": " + JSON.stringify(a) + " !== " + JSON.stringify(b));
  };
  const ok = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
  const throws = (fn, Cls, msg) => {
    try { fn(); } catch (err) {
      if (err instanceof Cls) return;
      throw new Error((msg || "wrong error") + ": expected " + Cls.name + ", got " + (err && err.constructor && err.constructor.name) + " (" + (err && err.message) + ")");
    }
    throw new Error((msg || "expected throw") + ": expected " + Cls.name + ", nothing thrown");
  };
  const fresh = () => engineFactory();
  const fund = (eng, acct, fluff, asset, key) =>
    eng.faucet(acct, asset || "TUMBO", fluff, { idempotencyKey: key });
  const send = (eng, from, to, fluff, key) =>
    eng.ledger.post(
      [{ account: from, asset: "TUMBO", amount: -fluff }, { account: to, asset: "TUMBO", amount: fluff }],
      { idempotencyKey: key, action: "send" }
    );

  check("fnv1a64Hex matches the pinned test vector", () => {
    eq(fnv1a64Hex("abc"), "e71fa2190541574b");
    eq(fnv1a64Hex("abc"), fnv1a64Hex("abc"));
  });

  check("engine boots with 4 genesis journals; tick starts at 4", () => {
    const eng = fresh();
    eq(eng.ledger.tick, 4);
    eq(eng.ledger.journalCount(), 4);
    const genesis = eng.journalHistory({ action: "genesis", limit: 10 });
    eq(genesis.total, 4);
    ok(genesis.rows.every((r) => r.action === "genesis"));
  });

  check("faucet funds a user; balance + fmt are exact", () => {
    const eng = fresh();
    fund(eng, "u:alice", 50000, "TUMBO", "st-f1");
    eq(eng.balance("u:alice", "TUMBO"), 50000);
    eq(fmt(1500), "1.500 TUMBO-SIM");
    eq(fmt(1), "0.001 TUMBO-SIM");
    eq(ASSETS.join(","), "TUMBO,sMIMAS");
  });

  check("send posts a balanced journal and moves balances", () => {
    const eng = fresh();
    fund(eng, "u:alice", 50000, "TUMBO", "st-f2");
    const r = send(eng, "u:alice", "u:bob", 1500, "st-s1");
    eq(eng.balance("u:bob", "TUMBO"), 1500);
    eq(eng.balance("u:alice", "TUMBO"), 48500);
    const total = r.postings.reduce((s, p) => s + p.amount, 0);
    eq(total, 0);
    eq(r.action, "send");
  });

  check("idempotency: replaying a key returns the original receipt", () => {
    const eng = fresh();
    fund(eng, "u:alice", 50000, "TUMBO", "st-f3");
    const first = send(eng, "u:alice", "u:bob", 700, "st-tip");
    const count = eng.ledger.journalCount();
    const again = send(eng, "u:alice", "u:bob", 700, "st-tip");
    eq(again.id, first.id);
    eq(eng.ledger.journalCount(), count);
    eq(eng.balance("u:bob", "TUMBO"), 700);
  });

  check("balances never go negative", () => {
    const eng = fresh();
    fund(eng, "u:alice", 1000, "TUMBO", "st-f4");
    throws(() => send(eng, "u:alice", "u:bob", 1001, "st-od"), Error);
    eq(eng.balance("u:alice", "TUMBO"), 1000);
  });

  check("sys:void is never debited", () => {
    const eng = fresh();
    fund(eng, "u:alice", 50000, "TUMBO", "st-f5");
    throws(() => eng.ledger.post(
      [{ account: "sys:void", asset: "TUMBO", amount: -1 }, { account: "u:bob", asset: "TUMBO", amount: 1 }],
      { idempotencyKey: "st-vd", action: "send" }
    ), Error);
  });

  check("reverse within the window posts a compensating journal; history untouched", () => {
    const eng = fresh();
    fund(eng, "u:alice", 50000, "TUMBO", "st-f6");
    const tx = send(eng, "u:alice", "u:bob", 9000, "st-rev");
    const before = JSON.stringify(tx.postings);
    const rev = eng.reverse({ idempotencyKey: "st-rev" });
    eq(rev.action, "reverse");
    eq(rev.links.reverses, tx.id);
    eq(eng.balance("u:bob", "TUMBO"), 0);
    eq(JSON.stringify(tx.postings), before);
    ok(eng.ledger.verifyChain().ok);
  });

  check("double-reverse is idempotent; reverse of a reversal is rejected", () => {
    const eng = fresh();
    fund(eng, "u:alice", 50000, "TUMBO", "st-f7");
    const tx = send(eng, "u:alice", "u:bob", 3000, "st-drev");
    const first = eng.reverse({ idempotencyKey: "st-drev" });
    const replay = eng.reverse({ idempotencyKey: "st-drev" });
    eq(replay.id, first.id);
    eq(eng.balance("u:bob", "TUMBO"), 0);
    throws(() => eng.reverse({ idempotencyKey: first.idempotencyKey }), QuoteError);
  });

  check("reverse of unknown / genesis journals fails closed", () => {
    const eng = fresh();
    throws(() => eng.reverse({ idempotencyKey: "nope:missing" }), JournalNotFoundError);
    throws(() => eng.reverse({ journalId: "rcpt_missing" }), JournalNotFoundError);
    throws(() => eng.reverse({ idempotencyKey: "genesis:tumbo-supply" }), QuoteError);
  });

  check("reverse after the window expires fails closed", () => {
    const eng = fresh();
    const r = fund(eng, "u:alice", 200000, "TUMBO", "st-old");
    for (let i = 0; i < REVERSE_WINDOW_TICKS + 1; i += 1) {
      send(eng, "u:alice", "u:bob", 1, "st-age-" + i);
    }
    ok(eng.ledger.tick - r.tick > REVERSE_WINDOW_TICKS);
    throws(() => eng.reverse({ idempotencyKey: "st-old" }), ReverseWindowExpiredError);
    eq(eng.balance("u:alice", "TUMBO"), 200000 - (REVERSE_WINDOW_TICKS + 1));
  });

  check("cancel pending quote works; executing a cancelled quote fails closed", () => {
    const eng = fresh();
    fund(eng, "u:alice", 50000, "TUMBO", "st-f8");
    const q = eng.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1000 });
    const rec = eng.cancelQuote(q.id, { idempotencyKey: "st-cancel-1" });
    eq(rec.cancelled, true);
    throws(() => eng.execute(q, { idempotencyKey: "st-exec-cancelled" }), QuoteError);
  });

  check("cancel of an executed quote fails closed; double-cancel is idempotent", () => {
    const eng = fresh();
    fund(eng, "u:alice", 50000, "TUMBO", "st-f9");
    const q = eng.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1000 });
    eng.execute(q, { idempotencyKey: "st-exec-1" });
    throws(() => eng.cancelQuote(q.id), CancelRejectedError);
    const q2 = eng.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 10 });
    const c1 = eng.cancelQuote(q2.id, { idempotencyKey: "st-cancel-2" });
    const c2 = eng.cancelQuote(q2.id, { idempotencyKey: "st-cancel-2" });
    eq(c2.id, c1.id);
    throws(() => eng.cancelQuote("q_unknown"), QuoteError);
  });

  check("history filters by action / account / asset; no genesis bypass", () => {
    const eng = fresh();
    fund(eng, "u:alice", 100000, "TUMBO", "st-f10");
    // The faucet holds TUMBO only; sMIMAS funding comes from the market
    // maker through the internal-authority path (same as genesis).
    eng.ledger.post(
      [{ account: "sys:market", asset: "sMIMAS", amount: -9000 }, { account: "u:alice", asset: "sMIMAS", amount: 9000 }],
      { idempotencyKey: "st-f11", action: "faucet", memo: "test sMIMAS funding", authority: "internal" }
    );
    send(eng, "u:alice", "u:bob", 111, "st-tipf");
    eng.ledger.post(
      [{ account: "u:alice", asset: "sMIMAS", amount: -222 }, { account: "u:bob", asset: "sMIMAS", amount: 222 }],
      { idempotencyKey: "st-smf", action: "send" }
    );
    eq(eng.journalHistory({ action: "faucet" }).total, 2);
    const byAcct = eng.journalHistory({ account: "u:alice", limit: 1000 });
    ok(byAcct.rows.every((r) => r.postings.some((p) => p.account === "u:alice")),
      "genesis rows must not bypass the account filter");
    const byAsset = eng.journalHistory({ asset: "sMIMAS", limit: 1000 });
    ok(byAsset.rows.every((r) => r.postings.some((p) => p.asset === "sMIMAS")));
    ok(byAsset.rows.length >= 2);
  });

  check("chain verifies; receipt recompute + prevHash link; tamper detected", () => {
    const eng = fresh();
    fund(eng, "u:alice", 50000, "TUMBO", "st-f12");
    const tx = send(eng, "u:alice", "u:bob", 1234, "st-ch1");
    ok(eng.ledger.verifyChain().ok);
    const v = eng.ledger.verifyReceipt(tx.id);
    ok(v.ok && v.checks.length >= 3);
    const bad = fresh();
    fund(bad, "u:alice", 10, "TUMBO", "st-tf");
    const journals = bad.ledger._journals;
    journals[journals.length - 1] = Object.assign({}, journals[journals.length - 1], { hash: "00".repeat(32) });
    ok(!bad.ledger.verifyChain().ok);
  });

  check("REVERSE_WINDOW_TICKS is the canonical 1000", () => {
    eq(REVERSE_WINDOW_TICKS, 1000);
  });

  return rows;
}
