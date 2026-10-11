// token-boot.js - side-effect boot for the shared TUMBO-SIM owner.
//
// Persistence is a validated full-engine snapshot. A legacy key is read only
// through an explicit migration path and is never deleted or overwritten until
// the migrated snapshot has loaded and verified successfully.

import {
  engine as sharedEngine,
  seedDemoWallet,
  TumboUserLedger,
} from "./token.js";
import { createTokenFacade } from "./token-facade.js";
import {
  LedgerStore,
  TOKEN_STORAGE_KEY,
  loadTokenEngine,
  adoptTokenEngine,
} from "./token-store.js";

export const LEGACY_STORAGE_KEY = "tumbo.token.ledger.v1";
const DEMO_ACCOUNTS = ["u:visitor", "b:guide"];
const DEMO_GRANT_FLUFF = 1000 * 1000;
const booted = new WeakMap();

function storage() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; }
  catch { return null; }
}

function migrateLegacySnapshot(raw) {
  const data = JSON.parse(raw);
  // Some builds temporarily wrote a v2 document under the v1 key while the
  // storage namespace was being moved. It is safe to promote that document;
  // old metadata-only {v,tick,tip} records are deliberately rejected.
  if (data?.format === "tumbo-token-engine-v2") return JSON.stringify(data);
  if (data?.v === 2 && data?.engine?.format === "tumbo-token-engine-v2") return JSON.stringify(data.engine);
  throw new Error("legacy token snapshot has no supported full-engine payload");
}

export function restorePersisted(owner) {
  const ls = storage();
  if (!ls) return { owner, status: "in-memory" };
  let current = null;
  try { current = ls.getItem(TOKEN_STORAGE_KEY); } catch { return { owner, status: "storage-unavailable" }; }
  if (current) {
    try {
      const restored = loadTokenEngine(current);
      return { owner: adoptTokenEngine(owner, restored), status: "restored-local-snapshot" };
    } catch {
      // Preserve the invalid document for diagnostics/recovery. A later
      // successful boot must not silently replace evidence of corruption.
      return { owner, status: "invalid-local-snapshot-skipped" };
    }
  }

  let legacy = null;
  try { legacy = ls.getItem(LEGACY_STORAGE_KEY); } catch { return { owner, status: "storage-unavailable" }; }
  if (!legacy) return { owner, status: "in-memory" };
  try {
    const migratedRaw = migrateLegacySnapshot(legacy);
    const restored = loadTokenEngine(migratedRaw);
    // Promote only after parse, schema, journal, and lifecycle validation all
    // succeed. Keep the original legacy value untouched for rollback.
    ls.setItem(TOKEN_STORAGE_KEY, migratedRaw);
    return { owner: adoptTokenEngine(owner, restored), status: "migrated-legacy-snapshot" };
  } catch {
    return { owner, status: "legacy-snapshot-skipped" };
  }
}

function fundDemoGenesis(engine) {
  for (const account of DEMO_ACCOUNTS) {
    try {
      engine.faucet(account, "TUMBO", DEMO_GRANT_FLUFF, {
        idempotencyKey: `genesis:demo-funding:v2:${account}`,
      });
    } catch {
      // Reboots replay the fixed request or leave an already-funded account
      // unchanged when the local faucet has no remaining demo float.
    }
  }
}

export function bootToken({ persist = true, engine = null, seed = true, install = true } = {}) {
  const supplied = engine ?? sharedEngine;
  if (booted.has(supplied)) return booted.get(supplied);

  let owner = supplied;
  let storageStatus = "in-memory";
  if (!engine && supplied.ledger.journalCount() === 4 && !(typeof window !== "undefined" && window.TumboToken?.engine)) {
    const restored = restorePersisted(supplied);
    owner = restored.owner;
    storageStatus = restored.status;
  }

  if (seed) seedDemoWallet(new TumboUserLedger(owner));
  fundDemoGenesis(owner);
  if (!owner.ledger.verifyChain().ok) throw new Error("token boot rejected an invalid chain");

  const facade = createTokenFacade(owner);
  let queued = false;
  const queuePersist = () => {
    if (!persist || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      try { LedgerStore.save(owner); } catch { /* blocked/full local storage is non-fatal */ }
    });
  };
  const off = owner.on("receipt", queuePersist);
  const api = Object.freeze({
    ...facade,
    storageStatus,
    dispose() { off?.(); facade.dispose(); booted.delete(supplied); },
  });
  booted.set(supplied, api);
  if (install && typeof window !== "undefined" && !window.TumboToken) window.TumboToken = api;
  return api;
}

const api = bootToken();
export default api;
export { LedgerStore, TOKEN_STORAGE_KEY, loadTokenEngine };
