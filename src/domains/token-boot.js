// token-boot.js — side-effect boot module for the TUMBO-SIM ledger core.
// Part of the TUMBO-SIM ledger core (src/domains).
//
// Imported once by the app entry (transitively, so the huge main bundle stays
// untouched). Responsibilities:
//   1. Load a persisted ledger (localStorage "tumbo.token.ledger.v1", strict
//      load). A corrupt/tampered snapshot is discarded and replaced with a
//      fresh ledger — silently, no console error.
//   2. Fund generic demo genesis accounts (u:visitor, b:guide) from sys:faucet
//      with explicit, fixed idempotency keys (re-boots replay safely).
//   3. verifyInvariants() before exposing anything.
//   4. Expose window.TumboToken = { ledger, balance, fmt, quote, execute, on }.
//   5. Wire every settled commit to document CustomEvent("tumbo:token") events
//      (receipt + balance-changed) and queue persistence in a microtask — never
//      synchronously inside the commit, because vault/escrow bookkeeping for
//      stake/deposit/intent actions may not be finished yet.
//
// Simulation only: TUMBO-SIM is a demo token. No real money, wagering, wallet
// custody, or chains are involved anywhere in this module.
import { TumboLedger, SYS } from "./token.js";
import { createTokenFacade } from "./token-facade.js";

const STORAGE_KEY = "tumbo.token.ledger.v1";
const GENESIS_IDEM = "genesis:demo-funding:v1";
const DEMO_ACCOUNTS = ["u:visitor", "b:guide"];
const DEMO_GRANT_TUMBO = 1000;

function storage() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; }
  catch { return null; }
}

function loadPersisted() {
  const ls = storage();
  if (!ls) return null;
  let raw = null;
  try { raw = ls.getItem(STORAGE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    return TumboLedger.load(raw); // strict: throws on tamper/corruption
  } catch {
    try { ls.removeItem(STORAGE_KEY); } catch { /* keep going in memory */ }
    return null; // corrupt snapshot: start fresh, silently
  }
}

function fundDemoGenesis(ledger) {
  for (const acct of DEMO_ACCOUNTS) ledger.ensureAccount(acct);
  // Fixed idempotency keys make re-boots replay-safe: funded once, ever.
  for (const acct of DEMO_ACCOUNTS) {
    const dripKey = `${GENESIS_IDEM}:${acct.slice(2)}`;
    const recvKey = `${GENESIS_IDEM}:recv:${acct.slice(2)}`;
    if (ledger.s.idem[dripKey] && ledger.s.idem[recvKey]) continue;
    const drip = ledger.faucetDrip({ to: acct, amountTumbo: DEMO_GRANT_TUMBO, idem: dripKey });
    ledger.receive({ intentTxId: drip.txId, by: acct, idem: recvKey });
  }
}

export function bootToken({ persist = true } = {}) {
  const ledger = loadPersisted() || new TumboLedger({ seed: 20260920 });
  fundDemoGenesis(ledger);
  ledger.verifyInvariants();

  const facade = createTokenFacade(ledger);

  let persistQueued = false;
  function queuePersist() {
    if (!persist || persistQueued) return;
    persistQueued = true;
    queueMicrotask(() => {
      persistQueued = false;
      const ls = storage();
      if (!ls) return;
      try { ls.setItem(STORAGE_KEY, ledger.serialize()); }
      catch { /* storage full/blocked: ledger keeps running in memory */ }
    });
  }

  // Every settled action: announce receipt + balance-changed events, then
  // persist. Deferred to a microtask so post-commit bookkeeping for
  // stake/deposit/intent actions is complete before the snapshot is taken.
  ledger.onCommit((receipt) => {
    facade._dispatchReceipt(receipt);
    queuePersist();
  });

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.TumboToken = {
      ledger,
      balance: facade.balance,
      fmt: facade.fmt,
      quote: facade.quote,
      execute: facade.execute,
      on: facade.on,
    };
  }
  return facade;
}

const api = bootToken();
export default api;
