/**
 * Token Lifecycle - built-in self-test (browser).
 *
 * Runs the core lifecycle scenarios against a fresh ledger and returns
 * [{name, ok, detail}] rows for the audit console (?selftest=1). Mirrors
 * tests/token-lifecycle.test.mjs so the browser and Node suites agree.
 *
 * SIMULATION ONLY - no real value, no network, no wallets.
 */

import {
  TOKEN_CONFIG,
  createTumboToken,
  fmtFluff,
  sha256Hex,
} from "../domains/token.js";

export function runTokenLifecycleSelfTest() {
  const rows = [];
  const check = (name, fn) => {
    try { fn(); rows.push({ name, ok: true }); }
    catch (err) { rows.push({ name, ok: false, detail: err && err.message }); }
  };
  const eq = (a, b, msg) => {
    if (a !== b) throw new Error((msg || "mismatch") + ": " + JSON.stringify(a) + " !== " + JSON.stringify(b));
  };
  const ok = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };
  const throwsCode = (fn, code) => {
    try { fn(); } catch (err) {
      if (err && err.code === code) return;
      throw new Error("expected code " + code + ", got " + (err && (err.code || err.message)));
    }
    throw new Error("expected throw with code " + code);
  };
  const fresh = () => createTumboToken();
  const fund = (t, acct, fluff, asset, key) =>
    t.execute({ action: "send", asset: asset || "TUMBO", from: "sys:treasury", to: acct, amountFluff: fluff, idempotencyKey: key });

  check("sha256 matches the standard test vector", () => {
    eq(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  check("facade exposes { ledger, balance, fmt, on }; supply from one config constant", () => {
    const t = fresh();
    ok(typeof t.balance === "function" && typeof t.fmt === "function" && typeof t.on === "function" && t.ledger);
    eq(t.balance("sys:treasury", "TUMBO"), TOKEN_CONFIG.SUPPLY_FLUFF);
    eq(t.balance("sys:treasury", "sMIMAS"), TOKEN_CONFIG.SUPPLY_FLUFF);
    eq(TOKEN_CONFIG.FLUFF_PER_UNIT, 1000);
  });

  check("fmt renders exact decimals without floats", () => {
    eq(fmtFluff(1500), "1.500 TUMBO-SIM");
    eq(fmtFluff(1), "0.001 TUMBO-SIM");
    eq(fmtFluff(0, "sMIMAS"), "0.000 sMIMAS-SIM");
  });

  check("send posts a balanced journal and moves balances", () => {
    const t = fresh();
    fund(t, "u:alice", 50000, "TUMBO", "st-f1");
    const res = t.execute({ action: "send", from: "u:alice", to: "u:bob", amountFluff: 1500, idempotencyKey: "st-s1" });
    eq(t.balance("u:bob"), 1500);
    eq(t.balance("u:alice"), 48500);
    const total = res.journal.postings.reduce((s, p) => s + BigInt(p.amountFluff), 0n);
    eq(total, 0n);
    eq(res.journal.state, "settled");
  });

  check("idempotency: replaying a key returns the original receipt", () => {
    const t = fresh();
    fund(t, "u:alice", 50000, "TUMBO", "st-f2");
    const p = { action: "tip", from: "u:alice", to: "u:bob", amountFluff: 700, idempotencyKey: "st-tip" };
    const first = t.execute(p);
    const count = t.ledger.journalCount;
    const again = t.execute(p);
    eq(again.replayed, true);
    eq(again.journal.journalId, first.journal.journalId);
    eq(t.ledger.journalCount, count);
    eq(t.balance("u:bob"), 700);
  });

  check("balances never go negative", () => {
    const t = fresh();
    fund(t, "u:alice", 1000, "TUMBO", "st-f3");
    throwsCode(() => t.execute({ action: "send", from: "u:alice", to: "u:bob", amountFluff: 1001, idempotencyKey: "st-od" }), "insufficient-funds");
    eq(t.balance("u:alice"), 1000);
  });

  check("sys:void is credited only by burns and never debited", () => {
    const t = fresh();
    fund(t, "u:alice", 50000, "TUMBO", "st-f4");
    t.execute({ action: "send", from: "u:alice", to: "sys:void", amountFluff: 500, idempotencyKey: "st-burn" });
    eq(t.balance("sys:void"), 500);
    throwsCode(() => t.execute({ action: "send", from: "sys:void", to: "u:bob", amountFluff: 1, idempotencyKey: "st-vd" }), "void-debit");
  });

  check("reverse within the window posts a compensating journal; history untouched", () => {
    const t = fresh();
    fund(t, "u:alice", 50000, "TUMBO", "st-f5");
    const tx = t.execute({ action: "send", from: "u:alice", to: "u:bob", amountFluff: 9000, idempotencyKey: "st-rev" });
    const before = JSON.stringify(tx.journal.postings);
    const rev = t.reverse(tx.journal.journalId);
    eq(rev.journal.action, "reverse");
    eq(rev.journal.linkedJournalId, tx.journal.journalId);
    eq(t.balance("u:bob"), 0);
    const orig = t.journalOf(tx.journal.journalId);
    eq(orig.state, "reversed");
    eq(JSON.stringify(orig.postings), before);
    ok(t.verifyChain());
  });

  check("double-reverse is impossible", () => {
    const t = fresh();
    fund(t, "u:alice", 50000, "TUMBO", "st-f6");
    const tx = t.execute({ action: "send", from: "u:alice", to: "u:bob", amountFluff: 3000, idempotencyKey: "st-drev" });
    const first = t.reverse(tx.journal.journalId);
    const replay = t.reverse(tx.journal.journalId);
    eq(replay.replayed, true);
    eq(replay.journal.journalId, first.journal.journalId);
    throwsCode(() => t.reverse(tx.journal.journalId, { idempotencyKey: "st-sneaky" }), "already-reversed");
    eq(t.balance("u:bob"), 0);
  });

  check("reverse after the window expires fails closed", () => {
    const t = fresh();
    fund(t, "u:alice", 50000, "TUMBO", "st-f7");
    const tx = t.execute({ action: "send", from: "u:alice", to: "u:bob", amountFluff: 2500, idempotencyKey: "st-old" });
    for (let i = 0; i < TOKEN_CONFIG.REVERSE_WINDOW_TICKS + 1; i += 1) {
      t.execute({ action: "send", from: "sys:treasury", to: "sys:faucet", amountFluff: 1, idempotencyKey: "st-age-" + i });
    }
    ok(t.tick() - tx.journal.tick > TOKEN_CONFIG.REVERSE_WINDOW_TICKS);
    throwsCode(() => t.reverse(tx.journal.journalId), "reverse-window-expired");
    eq(t.journalOf(tx.journal.journalId).state, "settled");
    eq(t.balance("u:bob"), 2500);
  });

  check("cancel of pending works; cancel of settled fails closed", () => {
    const t = fresh();
    fund(t, "u:alice", 50000, "TUMBO", "st-f8");
    const p = t.execute({ action: "send", from: "u:alice", to: "u:bob", amountFluff: 4000, idempotencyKey: "st-pend", settle: false });
    eq(p.journal.state, "pending");
    const c = t.cancel(p.journal.journalId);
    eq(c.journal.action, "cancel");
    eq(t.journalOf(p.journal.journalId).state, "cancelled");
    eq(t.balance("u:bob"), 0);
    const s = t.execute({ action: "send", from: "u:alice", to: "u:bob", amountFluff: 10, idempotencyKey: "st-set" });
    throwsCode(() => t.cancel(s.journal.journalId), "cancel-rejected");
    eq(t.journalOf(s.journal.journalId).state, "settled");
  });

  check("history filters by action / account / asset", () => {
    const t = fresh();
    fund(t, "u:alice", 100000, "TUMBO", "st-f9");
    fund(t, "u:alice", 9000, "sMIMAS", "st-f10");
    t.execute({ action: "tip", from: "u:alice", to: "u:bob", amountFluff: 111, idempotencyKey: "st-tipf" });
    t.execute({ action: "send", asset: "sMIMAS", from: "u:alice", to: "u:bob", amountFluff: 222, idempotencyKey: "st-smf" });
    eq(t.history({ action: "tip" }).total, 1);
    ok(t.history({ account: "u:alice" }).rows.every((r) => r.journalId === "genesis" || r.postings.some((p) => p.account === "u:alice")));
    ok(t.history({ asset: "sMIMAS" }).rows.every((r) => r.journalId === "genesis" || r.postings.some((p) => p.asset === "sMIMAS")));
  });

  check("chain verifies; receipt recompute + prevHash link; tamper detected", () => {
    const t = fresh();
    fund(t, "u:alice", 50000, "TUMBO", "st-f11");
    const tx = t.execute({ action: "send", from: "u:alice", to: "u:bob", amountFluff: 1234, idempotencyKey: "st-ch1" });
    ok(t.verifyChain());
    const v = t.verifyJournal(tx.journal.journalId);
    ok(v.ok && v.checks.length >= 6);
    const t2 = fresh();
    t2.execute({ action: "send", from: "sys:treasury", to: "u:alice", amountFluff: 10, idempotencyKey: "st-tf" });
    t2.ledger._receipts[1] = Object.assign({}, t2.ledger._receipts[1], { afterHash: "00".repeat(32) });
    ok(!t2.verifyChain());
  });

  return rows;
}
