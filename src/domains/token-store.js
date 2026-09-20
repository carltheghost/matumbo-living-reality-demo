// token-store.js — LedgerStore persistence for the TUMBO-SIM ledger core.
// Browser: localStorage. Node: file path. No network. Ever.
import { TumboLedger } from "./token.js";

const KEY = "tumbo-ledger-v1";

export class LedgerStore {
  static save(ledger) {
    const json = ledger.serialize();
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, json);
    return json;
  }
  static load({ strict = true } = {}) {
    if (typeof localStorage === "undefined") throw new Error("no localStorage in this environment");
    const json = localStorage.getItem(KEY);
    if (!json) return null;
    return TumboLedger.load(json, { strict });
  }
  static clear() {
    if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
  }
}

// Node helper: file-backed persistence for tests/demos.
export async function saveFile(ledger, path) {
  const fs = await import("node:fs");
  fs.writeFileSync(path, ledger.serialize());
}
export async function loadFile(path, { strict = true } = {}) {
  const fs = await import("node:fs");
  return TumboLedger.load(fs.readFileSync(path, "utf8"), { strict });
}
