/** Optional local token boot. The mounted app keeps its shared canonical owner. */
import { engine as sharedEngine } from './token.js?v=20261003-complete8';
import { createTokenFacade } from './token-facade.js?v=20261003-complete8';
import { LedgerStore } from './token-store.js?v=20261003-complete8';
const booted = new WeakMap();
export function bootToken({ persist = true, engine = null, install = true } = {}) {
  // Never replace a mounted owner with an unrelated historical prototype.
  const owner = engine ?? globalThis.window?.TumboToken?.engine ?? sharedEngine;
  if (booted.has(owner)) return booted.get(owner);
  let storageStatus = 'in-memory';
  if (persist && !engine && !globalThis.window?.TumboToken?.engine && owner.ledger.journalCount() === 4) {
    try {
      const restored = LedgerStore.load();
      if (restored) {
        for (const key of ['ledger', '_receipts', '_issuedQuotes', '_issuedQuoteIds', '_executedQuoteIds', '_cancelledQuoteIds', '_reversedJournalKeys', 'botPricing']) owner[key] = restored[key];
        storageStatus = 'restored-local-snapshot';
      }
    } catch { storageStatus = 'invalid-local-snapshot-skipped'; }
  }
  for (const account of ['u:visitor', 'b:guide']) owner.faucet(account, 'TUMBO', 1_000_000, { idempotencyKey: `genesis:demo-funding:v2:${account}` });
  if (!owner.ledger.verifyChain().ok) throw new Error('token boot rejected an invalid chain');
  const facade = createTokenFacade(owner);
  let queued = false;
  const off = owner.ledger.onCommit(() => {
    if (!persist || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; try { LedgerStore.save(owner); } catch { /* local storage may be blocked */ } });
  });
  const api = Object.freeze({ ...facade, storageStatus, dispose() { off(); facade.dispose(); booted.delete(owner); } });
  booted.set(owner, api);
  if (install && typeof window !== 'undefined' && !window.TumboToken) window.TumboToken = api;
  return api;
}
// Main explicitly installs the unified owner; importing this file has no effects.
export default bootToken;
