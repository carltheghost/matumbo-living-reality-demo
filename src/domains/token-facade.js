// token-facade.js - browser-facing facade over the canonical QuoteEngine.
// Part of the TUMBO-SIM ledger core (src/domains).
//
// Aligns to the canonical src/domains/token.js exports only:
//   QuoteEngine, TokenLedger, fmt, ensureTumboTokenFacade, engine, QuoteError.
//
// Events (document CustomEvent "tumbo:token", detail { type, ... }):
//   { type: "receipt", ... }
//   { type: "balance-changed", ... }
//
// Simulation only: TUMBO-SIM is a demo token. No real money, wagering, wallet
// custody, or chains.

import {
  engine as defaultEngine,
  fmt,
  QuoteError,
  ensureTumboTokenFacade,
  getTumboTokenFacade,
  TUMBO_TOKEN_EVENT,
  assertAccount,
  assertAsset,
  assertFluff,
  newId,
  isUserAccount,
} from "./token.js";

export const TOKEN_EVENT = TUMBO_TOKEN_EVENT;

/** Lightweight error aligned with prior facade callers. */
export class LedgerError extends Error {
  constructor(code, message) {
    super(message ? `${code}: ${message}` : String(code));
    this.name = "LedgerError";
    this.code = code;
  }
}

function doc() {
  return typeof document !== "undefined" ? document : null;
}

/**
 * Create a thin facade over a QuoteEngine (or the shared singleton).
 * API surface kept compatible with prior callers:
 *   { ledger, balance, fmt, quote, execute, on, engine }
 */
export function createTokenFacade(engineOrLedger = null) {
  let eng = defaultEngine;
  if (engineOrLedger && typeof engineOrLedger.quote === "function" && engineOrLedger.ledger) {
    eng = engineOrLedger;
  } else if (engineOrLedger && typeof engineOrLedger.post === "function") {
    eng = defaultEngine;
  }

  const subscribers = new Set();

  function notify(detail) {
    const d = doc();
    if (d) {
      try {
        d.dispatchEvent(new CustomEvent(TOKEN_EVENT, { detail }));
      } catch {
        /* DOM optional */
      }
    }
    for (const cb of [...subscribers]) {
      try {
        cb(detail);
      } catch {
        /* listener errors stay local */
      }
    }
  }

  const offReceipt = eng.on("receipt", (detail) => {
    notify({ type: "receipt", ...detail });
  });
  const offBalance = eng.on("balance-changed", (detail) => {
    notify({ type: "balance-changed", ...detail });
  });

  const api = {
    engine: eng,
    ledger: eng.ledger,
    balance: (account, asset = "TUMBO") => eng.balance(account, asset),
    fmt: (fluff) => fmt(fluff),
    quote: (args) => eng.quote(args),
    execute(actionOrQuote, args = {}) {
      if (actionOrQuote && typeof actionOrQuote === "object" && actionOrQuote.id && actionOrQuote.hash) {
        const key = args.idempotencyKey ?? args.idem;
        if (!key) throw new LedgerError("MISSING_IDEM", "execute requires args.idem / idempotencyKey");
        return eng.execute(actionOrQuote, { idempotencyKey: key });
      }
      const action = actionOrQuote;
      if (typeof action !== "string") {
        throw new LedgerError("UNKNOWN_ACTION", String(action));
      }
      const idem = args.idem ?? args.idempotencyKey;
      if (!idem) throw new LedgerError("MISSING_IDEM", "execute requires args.idem");

      if (action === "exchange" || action === "buy" || action === "sell") {
        const q = eng.quote({
          action,
          from: args.from,
          fromAsset: args.fromAsset ?? (action === "sell" ? "sMIMAS" : "TUMBO"),
          toAsset: args.toAsset ?? (action === "sell" ? "TUMBO" : "sMIMAS"),
          amountIn: args.amountIn ?? args.amount ?? args.amountFluff,
        });
        return eng.execute(q, { idempotencyKey: idem });
      }

      if (action === "faucet" || action === "faucetDrip") {
        const to = args.to ?? args.account;
        const amount =
          args.amount ??
          args.amountFluff ??
          (Number.isSafeInteger(args.amountTumbo) ? args.amountTumbo * 1000 : null);
        if (!to || !Number.isSafeInteger(amount) || amount <= 0) {
          throw new LedgerError("BAD_AMOUNT", "faucet needs to + positive amount");
        }
        return eng.faucet(to, args.asset ?? "TUMBO", amount, { idempotencyKey: idem });
      }

      if (action === "send" || action === "tip") {
        const from = args.from;
        const to = args.to;
        const asset = args.asset ?? "TUMBO";
        const amount = args.amountFluff ?? args.amount;
        assertAccount(from);
        assertAccount(to);
        assertAsset(asset);
        assertFluff(amount, "amount");
        if (amount <= 0) throw new LedgerError("BAD_AMOUNT", "amount must be positive");
        const journal = eng.ledger.post(
          [
            { account: from, asset, amount: -amount },
            { account: to, asset, amount },
          ],
          {
            idempotencyKey: idem,
            action,
            memo: args.memo ?? (action === "tip" ? "tip" : ""),
            authority: "internal",
          }
        );
        eng._emit?.("receipt", { receipt: journal });
        eng._emit?.("balance-changed", {
          account: from,
          asset,
          balance: eng.ledger.balance(from, asset),
        });
        eng._emit?.("balance-changed", {
          account: to,
          asset,
          balance: eng.ledger.balance(to, asset),
        });
        return journal;
      }

      if (action === "reverse") {
        return eng.reverse({
          idempotencyKey: idem,
          journalId: args.journalId ?? args.txId ?? null,
          actor: args.actor ?? "sim",
          memo: args.memo ?? null,
        });
      }

      if (action === "cancel") {
        return eng.cancelQuote(args.quoteId, { idempotencyKey: idem });
      }

      throw new LedgerError("UNKNOWN_ACTION", String(action));
    },
    on(evt, cb) {
      if (evt === "receipt" || evt === "balance-changed") {
        const wrapped = (detail) => {
          if (detail.type === evt || detail.type === undefined) cb(detail);
        };
        subscribers.add(wrapped);
        return () => {
          subscribers.delete(wrapped);
        };
      }
      const d = doc();
      if (d && (evt === TOKEN_EVENT || evt === "tumbo:token")) {
        const h = (e) => cb(e.detail);
        d.addEventListener(TOKEN_EVENT, h);
        return () => d.removeEventListener(TOKEN_EVENT, h);
      }
      throw new LedgerError("UNKNOWN_EVENT", String(evt));
    },
    destroy() {
      try {
        offReceipt?.();
        offBalance?.();
      } catch {
        /* ignore */
      }
      subscribers.clear();
    },
  };

  return api;
}

export function getOrCreateFacade({ seed = true } = {}) {
  const existing = getTumboTokenFacade();
  if (existing) return existing;
  return ensureTumboTokenFacade({ seed });
}

export { ensureTumboTokenFacade, getTumboTokenFacade, fmt, QuoteError };
export default createTokenFacade;
