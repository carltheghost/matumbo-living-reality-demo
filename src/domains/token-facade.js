// token-facade.js - browser-facing API over the canonical QuoteEngine.
//
// The facade is an adapter only: balances, journals, and lifecycle state stay
// owned by the QuoteEngine. Public send/tip calls are routed through the
// user-account activity adapter so UI input can never acquire system debit
// authority.

import {
  TumboUserLedger,
  fmt,
  ensureTumboTokenFacade,
  getTumboTokenFacade,
} from "./token.js";
import { activityForEngine, TokenError } from "./token-activity.js";
import { attachTokenVault } from "./token-vault.js";

export const TOKEN_EVENT = "tumbo:token";

export function createTokenFacade(owner = null) {
  const engine = typeof owner?.quote === "function" && typeof owner?.execute === "function" && owner?.ledger?.post
    ? owner
    : owner?.engine ?? owner?._engine;
  if (typeof engine?.ledger?.post !== "function" || typeof engine?.execute !== "function" || typeof engine?.on !== "function") {
    throw new TypeError("facade requires the canonical QuoteEngine API");
  }

  const wallet = owner?._engine === engine && typeof owner?.send === "function"
    ? owner
    : new TumboUserLedger(engine);
  const activity = activityForEngine(engine);
  const vault = attachTokenVault({ engine }).tokenVault;
  const listeners = new Map([
    ["receipt", new Set()],
    ["balance-changed", new Set()],
  ]);

  const notify = (type, detail) => {
    for (const callback of [...listeners.get(type)]) {
      try { callback({ type, ...detail }); } catch { /* observers cannot unwind a settlement */ }
    }
  };

  // The canonical engine owns document events. This adapter only exposes the
  // in-process channel, preventing multiple facades from duplicating DOM waves.
  const off = engine.on("receipt", ({ receipt }) => {
    const journal = engine.ledger._journals.find((row) => row.id === receipt.id) ?? receipt;
    const pairs = new Map();
    for (const leg of journal.postings ?? []) {
      const key = `${leg.account}|${leg.asset}`;
      const pair = pairs.get(key) ?? { account: leg.account, asset: leg.asset, delta: 0 };
      pair.delta += leg.amount;
      pairs.set(key, pair);
    }
    for (const pair of pairs.values()) {
      if (pair.delta) notify("balance-changed", {
        ...pair,
        balance: engine.balance(pair.account, pair.asset),
        txId: journal.id,
        action: journal.action,
      });
    }
    notify("receipt", {
      receipt,
      txId: journal.id,
      action: journal.action,
      hash: journal.hash,
      logicalTick: journal.tick,
    });
  });

  const keyOf = (args) => {
    const key = args.idempotencyKey ?? args.idem;
    if (typeof key !== "string" || !key.trim()) {
      throw new TokenError("execute requires a client idempotencyKey", "MISSING_IDEM");
    }
    return key.trim();
  };

  const api = {
    engine,
    ledger: wallet,
    tokenVault: vault,
    balance: (account, asset = "TUMBO") => wallet.balance(account, asset),
    fmt,
    quote: (args) => engine.quote(args),
    execute(action, args = {}) {
      if (action && typeof action === "object") return engine.execute(action, args);
      const key = keyOf(args);
      if (action === "send" || action === "tip") {
        // TokenActivityLedger.ensureAccount() accepts only u:/b: accounts;
        // no caller-provided system account can reach an internal debit post.
        return activity.act(action, {
          from: args.from,
          to: args.to,
          asset: args.asset ?? "TUMBO",
          amount: args.amountFluff ?? args.amount,
          memo: args.memo ?? "",
        }, key);
      }
      if (["stake", "deposit", "lock", "save"].includes(action)) {
        return vault[action]({ ...args, from: args.from ?? args.owner, idempotencyKey: key });
      }
      if (["unstake", "withdraw"].includes(action)) {
        return vault[action]({ ...args, idempotencyKey: key });
      }
      if (action === "faucet" || action === "faucetDrip") {
        const amount = args.amountFluff ?? args.amount ?? (Number.isSafeInteger(args.amountTumbo) ? args.amountTumbo * 1000 : null);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new TokenError("faucet needs a positive amount", "BAD_AMOUNT");
        return engine.faucet(args.to ?? args.account, args.asset ?? "TUMBO", amount, { idempotencyKey: key });
      }
      if (["exchange", "buy", "sell"].includes(action)) {
        const firmQuote = args.quote ?? engine.quote({
          action,
          from: args.from,
          fromAsset: args.fromAsset ?? (action === "sell" ? "sMIMAS" : "TUMBO"),
          toAsset: args.toAsset ?? (action === "sell" ? "TUMBO" : "sMIMAS"),
          amountIn: args.amountIn ?? args.amount ?? args.amountFluff,
        });
        return engine.execute(firmQuote, { idempotencyKey: key });
      }
      if (action === "reverse") return engine.reverse({ ...args, idempotencyKey: args.idempotencyKey ?? args.journalId ?? args.txId });
      if (action === "cancel") return engine.cancelQuote(args.quoteId, { idempotencyKey: key });
      throw new TokenError(`unsupported current token action ${String(action)}`, "UNKNOWN_ACTION");
    },
    on(event, callback) {
      if (!listeners.has(event) || typeof callback !== "function") {
        throw new TokenError("unknown event or invalid listener", "UNKNOWN_EVENT");
      }
      listeners.get(event).add(callback);
      return () => listeners.get(event).delete(callback);
    },
    reverse: (input) => engine.reverse(input),
    cancel: (id, options) => engine.cancelQuote(id, options),
    faucet: (...args) => engine.faucet(...args),
    verifyReceipt: (key) => engine.ledger.verifyReceipt(key),
    verifyChain: () => engine.ledger.verifyChain(),
    journalHistory: (filters) => engine.journalHistory(filters),
    tick: () => engine.ledger.tick,
    dispose() {
      off?.();
      for (const set of listeners.values()) set.clear();
    },
  };
  return Object.freeze(api);
}

export function getOrCreateFacade({ seed = true } = {}) {
  return getTumboTokenFacade() ?? ensureTumboTokenFacade({ seed });
}

export { fmt, TokenError };
export default createTokenFacade;
