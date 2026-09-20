// token-facade.js — window.TumboToken: browser-facing facade over TumboLedger.
// Part of the TUMBO-SIM ledger core (src/domains).
//
// A shared event layer so every token zone (guide tips, BotPay, arena stakes,
// vault deposits, ...) emits identical events and offers the same query/execute
// surface. Wraps a TumboLedger instance; the ledger itself stays DOM-free.
//
// Events (document CustomEvent "tumbo:token", detail { type, ... }):
//   { type: "receipt", txId, action, hash, logicalTick }                — every settled action
//   { type: "balance-changed", account, asset, balance, delta, txId }   — per touched account×asset
//
// Facade API (also exposed as window.TumboToken by token-boot.js):
//   { ledger, balance(account, asset?), fmt(fluff), quote(args),
//     execute(action, args), on(evt, cb) }
//   execute() requires args.idem (LedgerError MISSING_IDEM otherwise).
//   "deliver" routes to deliverCreate; confirm delivery via action "confirm"
//   (deliverConfirm).
//
// Event model: the facade subscribes once to ledger.onCommit() and announces
// every settled commit as exactly one event wave (balance-changed events, then
// the receipt). Idempotent replays never emit — _commitInner returns before
// _emitCommit when the idem key was already seen — so there is no second wave
// to suppress. Direct ledger commits (bypassing execute) emit the same wave.
import { LedgerError, fmtTumbo } from "./token.js";

export const TOKEN_EVENT = "tumbo:token";

function doc() { return typeof document !== "undefined" ? document : null; }

function emit(detail) {
  const d = doc();
  if (!d) return;
  d.dispatchEvent(new CustomEvent(TOKEN_EVENT, { detail }));
}

// Aggregate receipt entries into unique account×asset pairs with net deltas.
function touchedPairs(entries) {
  const map = new Map();
  for (const e of entries || []) {
    const k = `${e.account}\0${e.asset}`;
    const p = map.get(k) || { account: e.account, asset: e.asset, delta: 0 };
    p.delta += Number(e.delta);
    map.set(k, p);
  }
  return [...map.values()];
}

// Per-action routing. Each handler receives (ledger, args) and returns the
// ledger result (a sealed receipt, or a wrapper like { receipt, stakeId }).
// Extra args (e.g. a facade-required idem on gate-only methods) are ignored
// by the ledger methods that do not need them.
const EXECUTE = {
  send:       (L, a) => L.send(a),
  tip:        (L, a) => L.tip(a),
  receive:    (L, a) => L.receive(a),
  cancel:     (L, a) => L.cancel(a),
  deliver:    (L, a) => L.deliverCreate(a),   // create the delivery intent
  confirm:    (L, a) => L.deliverConfirm(a),  // recipient confirms delivery
  reverse:    (L, a) => L.reverse(a),
  exchange:   (L, a) => L.exchange(a),
  buy:        (L, a) => L.buy(a),
  sell:       (L, a) => L.sell(a),
  stake:      (L, a) => L.stake(a),
  unstake:    (L, a) => L.unstake(a),
  slash:      (L, a) => L.slash(a),
  deposit:    (L, a) => L.deposit(a),
  withdraw:   (L, a) => L.withdraw(a),
  lock:       (L, a) => L.lock(a),
  unlock:     (L, a) => L.unlock(a),
  save:       (L, a) => L.save(a),
  payreq:     (L, a) => L.payreq(a),
  faucetDrip: (L, a) => L.faucetDrip(a),
  grantPop:   (L, a) => L.grantPop(a),
};

export function createTokenFacade(ledger) {
  const subscribers = new Set();

  function notify(detail) {
    emit(detail);
    for (const cb of [...subscribers]) { try { cb(detail); } catch { /* listener errors stay local */ } }
  }

  // Emit one "receipt" event plus one "balance-changed" event per unique
  // touched account×asset. Balance events go first so listeners can act on the
  // receipt knowing balances are already final.
  function dispatchReceipt(receipt) {
    for (const p of touchedPairs(receipt.entries || [])) {
      notify({
        type: "balance-changed",
        account: p.account, asset: p.asset,
        balance: ledger.balance(p.account, p.asset),
        delta: p.delta, txId: receipt.txId, action: receipt.action,
      });
    }
    notify({
      type: "receipt",
      txId: receipt.txId, action: receipt.action,
      hash: receipt.hash, logicalTick: receipt.logicalTick,
      meta: receipt.meta ? { ...receipt.meta } : {},
    });
  }

  // Single subscription: every settled commit emits exactly one wave, whether
  // it arrived via execute() or a direct ledger call. The receipt handed to
  // onCommit is always the sealed receipt — wrapper-returning actions
  // (stake/deposit/lock/withdraw) cannot produce a malformed wave.
  ledger.onCommit(dispatchReceipt);

  const api = {
    ledger,
    balance: (account, asset = "TUMBO") => ledger.balance(account, asset),
    fmt: (fluff) => fmtTumbo(fluff),
    quote: (args) => ledger.quote(args),
    execute(action, args = {}) {
      const handler = EXECUTE[action];
      if (!handler) throw new LedgerError("UNKNOWN_ACTION", String(action));
      if (!args.idem) throw new LedgerError("MISSING_IDEM", "execute requires args.idem");
      return handler(ledger, args);
    },
    on(evt, cb) {
      // "receipt" / "balance-changed": in-process subscription (works without a DOM).
      // "tumbo:token": document-level CustomEvent subscription.
      if (evt === "receipt" || evt === "balance-changed") {
        const wrapped = (detail) => { if (detail.type === evt) cb(detail); };
        subscribers.add(wrapped);
        return () => { subscribers.delete(wrapped); };
      }
      const d = doc();
      if (d && evt === TOKEN_EVENT) {
        const h = (e) => cb(e.detail);
        d.addEventListener(TOKEN_EVENT, h);
        return () => d.removeEventListener(TOKEN_EVENT, h);
      }
      throw new LedgerError("UNKNOWN_EVENT", String(evt));
    },
  };

  return api;
}
