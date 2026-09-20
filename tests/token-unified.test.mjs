import test from "node:test";
import assert from "node:assert/strict";
import {
  createTokenEngine,
  TumboUserLedger,
  seedDemoWallet,
  ensureTumboTokenFacade,
  getTumboTokenFacade,
  toCoreAccount,
  toDisplayAccount,
  toCoreAsset,
  toDisplayAsset,
  tumboSimToFluff,
  formatSimAmount,
  newIdempotencyKey,
  TUMBO_TOKEN_EVENT,
  TUMBO_TOKEN_ASSET,
  TUMBO_TOKEN_DEFAULT_ACCOUNT,
} from "../src/domains/token.js";

function freshLedger() {
  return new TumboUserLedger(createTokenEngine());
}

test("display mapping", () => {
  assert.equal(toCoreAccount("you"), "u:you");
  assert.equal(toCoreAccount("Alice"), "u:alice");
  assert.equal(toCoreAccount("u:bob"), "u:bob");
  assert.equal(toCoreAccount("sys:market"), "sys:market");
  assert.equal(toDisplayAccount("u:you"), "you");
  assert.equal(toDisplayAccount("u:alice"), "alice");
  assert.equal(toCoreAsset("TUMBO-SIM"), "TUMBO");
  assert.equal(toCoreAsset("sMIMAS"), "sMIMAS");
  assert.equal(toDisplayAsset("TUMBO"), "TUMBO-SIM");
  assert.equal(TUMBO_TOKEN_ASSET, "TUMBO-SIM");
  assert.equal(TUMBO_TOKEN_DEFAULT_ACCOUNT, "you");
  assert.equal(TUMBO_TOKEN_EVENT, "tumbo:token");
});

test("amount helpers", () => {
  assert.equal(tumboSimToFluff("1.250"), 1250);
  assert.equal(tumboSimToFluff(2), 2000);
  assert.equal(formatSimAmount(1250), "1.250");
  assert.throws(() => tumboSimToFluff("-1"), TypeError);
  assert.ok(newIdempotencyKey().startsWith("tumbo-send-"));
});

test("demo seed", () => {
  const ledger = freshLedger();
  seedDemoWallet(ledger);
  assert.equal(ledger.balance("you", "TUMBO-SIM"), 120500 - 25000);
  assert.equal(ledger.vault("you", "TUMBO-SIM").totalLockedFluff, 25000);
  // core engine sees the same funds under canonical names
  assert.equal(ledger._engine.balance("u:you", "TUMBO"), 95500);
});

test("send moves funds and is idempotent", () => {
  const ledger = freshLedger();
  seedDemoWallet(ledger);
  const before = ledger.balance("you", "TUMBO-SIM");
  const r1 = ledger.send({ to: "alice", amountFluff: 1000, idempotencyKey: "k-1", memo: "hi" });
  assert.equal(r1.kind, "send");
  assert.equal(r1.to, "alice");
  assert.equal(r1.amountFluff, 1000);
  assert.equal(r1.duplicate, false);
  assert.equal(ledger.balance("you", "TUMBO-SIM"), before - 1000);
  assert.equal(ledger.balance("alice", "TUMBO-SIM"), 1000);
  const r2 = ledger.send({ to: "alice", amountFluff: 1000, idempotencyKey: "k-1" });
  assert.equal(r2.duplicate, true);
  assert.equal(r2.id, r1.id);
  assert.equal(ledger.balance("you", "TUMBO-SIM"), before - 1000); // no double move
});

test("send validates", () => {
  const ledger = freshLedger();
  seedDemoWallet(ledger);
  assert.throws(() => ledger.send({ to: "alice", amountFluff: 0 }), TypeError);
  assert.throws(() => ledger.send({ to: "alice", amountFluff: 999999999 }), /insufficient-simulated-funds/);
  assert.throws(() => ledger.send({ to: "", amountFluff: 10 }), TypeError);
});

test("lock / vault / unlock roundtrip", () => {
  const ledger = freshLedger();
  seedDemoWallet(ledger);
  const spendable = ledger.balance("you", "TUMBO-SIM");
  const entry = ledger.lock({ amountFluff: 5000, label: "test lock" });
  assert.equal(entry.status, "locked");
  assert.equal(ledger.balance("you", "TUMBO-SIM"), spendable - 5000);
  assert.equal(ledger.vault("you", "TUMBO-SIM").totalLockedFluff, 25000 + 5000);
  const released = ledger.unlock(entry.id);
  assert.equal(released.status, "released");
  assert.equal(ledger.balance("you", "TUMBO-SIM"), spendable);
  assert.throws(() => ledger.unlock("nope"), /unknown-lock/);
});

test("future lock cannot release early", () => {
  const ledger = freshLedger();
  seedDemoWallet(ledger);
  const entry = ledger.lock({ amountFluff: 1000, unlocksAt: "2030-01-01T00:00:00.000Z" });
  assert.throws(() => ledger.unlock(entry.id), /lock-not-matured/);
});

test("history records activity", () => {
  const ledger = freshLedger();
  seedDemoWallet(ledger);
  ledger.send({ to: "bob", amountFluff: 250, idempotencyKey: "k-h" });
  const items = ledger.history({ limit: 50 });
  assert.ok(items.length >= 3); // faucet-credit + lock + send
  assert.equal(items[0].kind, "send");
  assert.equal(items[0].to, "bob");
  assert.ok(items.every((r) => r.simulation === true));
});

test("accounts lists user wallets", () => {
  const ledger = freshLedger();
  seedDemoWallet(ledger);
  ledger.send({ to: "carol", amountFluff: 100, idempotencyKey: "k-a" });
  const rows = ledger.accounts();
  const you = rows.find((r) => r.acct === "you");
  assert.ok(you);
  assert.equal(you.asset, "TUMBO-SIM");
  assert.equal(you.balanceFluff, ledger.balance("you", "TUMBO-SIM"));
  assert.ok(rows.every((r) => !r.acct.startsWith("sys:")));
});

test("events fire on send", () => {
  const ledger = freshLedger();
  seedDemoWallet(ledger);
  let receiptSeen = null;
  let changedSeen = null;
  const off1 = ledger.on("receipt", (d) => { receiptSeen = d; });
  const off2 = ledger.on("balance-changed", (d) => { changedSeen = d; });
  ledger.send({ to: "dave", amountFluff: 300, idempotencyKey: "k-e" });
  assert.ok(receiptSeen && (receiptSeen.receipt || receiptSeen.tx));
  assert.ok(changedSeen);
  off1(); off2();
});

test("facade contract", () => {
  const facade = ensureTumboTokenFacade({ seed: true });
  assert.ok(facade.ledger instanceof TumboUserLedger);
  assert.equal(typeof facade.balance, "function");
  assert.equal(typeof facade.fmt, "function");
  assert.equal(typeof facade.on, "function");
  assert.equal(typeof facade.quote, "function");
  assert.equal(typeof facade.execute, "function");
  assert.equal(facade, getTumboTokenFacade());
  assert.ok(facade.fmt(1500).includes("TUMBO-SIM"));
});

test("hardened core still intact behind the adapter", () => {
  const ledger = freshLedger();
  // quote engine reachable through the adapter's engine
  const q = ledger._engine.quote({ action: "buy", from: "u:trader", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1000 });
  assert.ok(q.hash);
  assert.throws(() => ledger._engine.execute({ ...q, amountOut: q.amountOut + 1 }), /tampered/);
});
