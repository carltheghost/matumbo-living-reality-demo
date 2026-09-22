// token-boot.js — side-effect boot module for the TUMBO-SIM ledger core.
// Part of the TUMBO-SIM ledger core (src/domains).
//
// Aligns to the canonical src/domains/token.js only (ensureTumboTokenFacade,
// engine, TokenLedger, fmt). Simulation only — no real money, wagering,
// wallet custody, or chains.

import {
  ensureTumboTokenFacade,
  getTumboTokenFacade,
  engine,
  fmt,
  assertAccount,
  assertFluff,
  newId,
} from "./token.js";
import { createTokenFacade } from "./token-facade.js";

const STORAGE_KEY = "tumbo.token.ledger.v1";
const GENESIS_IDEM = "genesis:demo-funding:v1";
const DEMO_ACCOUNTS = ["u:visitor", "b:guide"];
const DEMO_GRANT_FLUFF = 1000 * 1000; // 1000 TUMBO-SIM in fluff

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function fundDemoGenesis(eng) {
  for (const acct of DEMO_ACCOUNTS) {
    try {
      assertAccount(acct);
    } catch {
      continue;
    }
    const dripKey = `${GENESIS_IDEM}:${acct.slice(2)}`;
    // Idempotent faucet: re-boots replay safely via ledger receipt map.
    try {
      eng.faucet(acct, "TUMBO", DEMO_GRANT_FLUFF, { idempotencyKey: dripKey });
    } catch {
      /* already funded or insufficient faucet float — best-effort */
    }
  }
}

/**
 * Boot the shared token surface.
 * Returns a facade { ledger, balance, fmt, quote, execute, on, engine }.
 */
export function bootToken({ persist = true, seed = true } = {}) {
  // Prefer the canonical shared facade (seeds demo wallet when seed=true).
  const canonical = ensureTumboTokenFacade({ seed });
  const eng = canonical.engine ?? engine;

  // Fund generic demo accounts used by older surfaces (idempotent).
  fundDemoGenesis(eng);

  const facade = createTokenFacade(eng);

  // Optional persistence of a minimal snapshot (best-effort, non-blocking).
  let persistQueued = false;
  function queuePersist() {
    if (!persist || persistQueued) return;
    persistQueued = true;
    queueMicrotask(() => {
      persistQueued = false;
      const ls = storage();
      if (!ls) return;
      try {
        const tip = eng.ledger?.verifyChain?.() ?? null;
        ls.setItem(
          STORAGE_KEY,
          JSON.stringify({
            v: 1,
            tick: eng.ledger?.tick ?? 0,
            tip: tip?.tip ?? null,
            simulation: true,
          })
        );
      } catch {
        /* storage full/blocked: keep running in memory */
      }
    });
  }

  eng.on("receipt", () => queuePersist());

  if (typeof window !== "undefined") {
    window.TumboToken = {
      ledger: eng.ledger,
      balance: (acct, asset) => eng.balance(acct, asset),
      fmt,
      quote: (args) => eng.quote(args),
      execute: (q, opts) => eng.execute(q, opts),
      on: (evt, cb) => eng.on(evt, cb),
      engine: eng,
      faucet: (to, asset, amount, opts) => eng.faucet(to, asset, amount, opts),
      reverse: (input) => eng.reverse(input),
      cancel: (quoteId, opts) => eng.cancelQuote(quoteId, opts),
      verifyReceipt: (id) => eng.ledger.verifyReceipt(id),
      verifyChain: () => eng.ledger.verifyChain(),
    };
  }

  return facade;
}

const api = bootToken();
export default api;
export { ensureTumboTokenFacade, getTumboTokenFacade };
