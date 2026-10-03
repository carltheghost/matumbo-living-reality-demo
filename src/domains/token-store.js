/** Local canonical-engine snapshots. Hashes detect corruption, not signatures. */
import { createTokenEngine, TokenLedger, CONFIG } from './token.js?v=20261003-complete8';
export const TOKEN_STORAGE_KEY = 'tumbo.token.engine.v2';
const ownerEngine = owner => typeof owner?.quote === 'function' && typeof owner?.execute === 'function' && owner?.ledger?.post ? owner : owner?.engine ?? owner?._engine;
export function serializeTokenEngine(owner) {
  const engine = ownerEngine(owner);
  if (typeof engine?.ledger?.verifyChain !== 'function' || !engine?._issuedQuotes || !engine?.config) throw new TypeError('store requires the canonical QuoteEngine API');
  if (!engine.ledger.verifyChain().ok) throw new Error('cannot persist an invalid receipt chain');
  return JSON.stringify({
    format: 'tumbo-token-engine-v2', config: engine.config,
    journals: engine.ledger._journals, requests: [...engine.ledger._requestKeys],
    issued: [...engine._issuedQuotes], executed: [...engine._executedQuoteIds],
    cancelled: [...engine._cancelledQuoteIds], reversed: [...engine._reversedJournalKeys],
    receipts: [...engine._receipts], botPricing: engine.botPricing ?? {},
  });
}
export function loadTokenEngine(raw, { config = CONFIG } = {}) {
  const data = JSON.parse(raw);
  const fields = new Set(['format', 'config', 'journals', 'requests', 'issued', 'executed', 'cancelled', 'reversed', 'receipts', 'botPricing']);
  if (!data || typeof data !== 'object' || Object.keys(data).some(key => !fields.has(key))) throw new Error('unrecognized token snapshot field');
  if (data?.format !== 'tumbo-token-engine-v2' || JSON.stringify(data.config) !== JSON.stringify(config)) throw new Error('unsupported token snapshot or configuration');
  if (!Array.isArray(data.journals) || !Array.isArray(data.requests) || !Array.isArray(data.issued)) throw new Error('malformed token snapshot');
  const engine = createTokenEngine(config), baseline = engine.ledger._journals;
  const restored = new TokenLedger();
  // An offline candidate replays historical purpose postings; its temporary
  // handle is released before the validated ledger is exposed to a runtime.
  const economicCustody = restored.claimEconomicCustody();
  restored.openAccount('sys:issuance', 'TUMBO', { allowNegative: true });
  restored.openAccount('sys:issuance', 'sMIMAS', { allowNegative: true });
  const requests = new Map(data.requests), ids = new Set();
  if (requests.size !== data.requests.length || requests.size !== data.journals.length) throw new Error('snapshot request index does not match journals');
  for (const [index, row] of data.journals.entries()) {
    if (!row || row.tick !== index + 1 || typeof row.id !== 'string' || ids.has(row.id) || restored._receipts.has(row.idempotencyKey)) throw new Error('invalid token journal order or identity');
    ids.add(row.id);
    const request = JSON.parse(requests.get(row.idempotencyKey) ?? 'null');
    if (!request || JSON.stringify(request.postings) !== JSON.stringify(row.postings) || request.action !== row.action || request.memo !== row.memo || JSON.stringify(request.links ?? null) !== JSON.stringify(row.links ?? null)) throw new Error('journal request does not match receipt');
    if (index < baseline.length && (row.action !== 'genesis' || row.idempotencyKey !== baseline[index].idempotencyKey || JSON.stringify(row.postings) !== JSON.stringify(baseline[index].postings))) throw new Error('snapshot genesis differs from canonical supply');
    if (index >= baseline.length && row.action === 'genesis') throw new Error('duplicate genesis is forbidden');
    restored.post(row.postings, { ...request, idempotencyKey: row.idempotencyKey, economicCustody });
    const sealed = Object.freeze({ ...row, postings: Object.freeze(row.postings.map(leg => Object.freeze({ ...leg }))), ...(row.links ? { links: Object.freeze({ ...row.links }) } : {}) });
    restored._journals[index] = sealed; restored._receipts.set(row.idempotencyKey, sealed);
    restored._lastReceiptHash = sealed.hash;
  }
  if (data.journals.length < baseline.length || !restored.verifyChain().ok) throw new Error('token receipt chain is corrupt');
  restored.releaseEconomicCustody(economicCustody);
  engine.ledger = restored;
  engine._issuedQuotes = new Map(data.issued);
  for (const [id, hash] of engine._issuedQuotes) if (typeof id !== 'string' || !/^q_/.test(id) || typeof hash !== 'string' || !/^[0-9a-f]{16}$/.test(hash)) throw new Error('malformed issued quote registry');
  engine._issuedQuoteIds = new Set(engine._issuedQuotes.keys());
  for (const [target, source] of [['_executedQuoteIds', 'executed'], ['_cancelledQuoteIds', 'cancelled'], ['_reversedJournalKeys', 'reversed']]) {
    if (!Array.isArray(data[source])) throw new Error('malformed lifecycle registry');
    engine[target] = new Set(data[source]);
  }
  if (!Array.isArray(data.receipts)) throw new Error('malformed receipt registry');
  engine._receipts = new Map(data.receipts);
  if (engine._receipts.size !== data.receipts.length) throw new Error('duplicate receipt registry keys');
  for (const [key, receipt] of engine._receipts) {
    const journal = restored._receipts.get(key);
    if (receipt?.idempotencyKey !== key || (receipt.kind !== 'cancellation' && (!journal || journal.id !== receipt.id || journal.hash !== receipt.hash || journal.action !== receipt.action || journal.tick !== receipt.tick))) throw new Error('receipt index differs from journal');
    if (receipt.kind === 'cancellation') {
      if (!engine._cancelledQuoteIds.has(receipt.quoteId) || !engine._issuedQuotes.has(receipt.quoteId)) throw new Error('cancellation registry differs from its receipts');
    } else if (receipt.quoteId) {
      if (!engine._executedQuoteIds.has(receipt.quoteId) || !engine._issuedQuotes.has(receipt.quoteId)) throw new Error('execution registry differs from its receipts');
      const paid = journal.postings.find(leg => leg.account === receipt.from && leg.asset === receipt.fromAsset && leg.amount < 0);
      const received = journal.postings.find(leg => leg.account === receipt.from && leg.asset === receipt.toAsset && leg.amount > 0);
      const tithe = journal.postings.filter(leg => leg.account === 'sys:void').reduce((n, leg) => n + leg.amount, 0);
      if (paid?.amount !== -receipt.amountIn || received?.amount !== receipt.amountOut || tithe !== receipt.tithe || receipt.to !== 'sys:market') throw new Error('quote receipt metadata differs from settled amounts');
    }
    engine._receipts.set(key, Object.freeze({ ...receipt, ...(journal ? { postings: journal.postings } : {}) }));
  }
  for (const id of [...engine._executedQuoteIds, ...engine._cancelledQuoteIds]) {
    if (!engine._issuedQuotes.has(id) || (engine._executedQuoteIds.has(id) && engine._cancelledQuoteIds.has(id)) || ![...engine._receipts.values()].some(receipt => receipt.quoteId === id)) throw new Error('unbound quote lifecycle registry entry');
  }
  for (const key of engine._reversedJournalKeys) {
    if (!restored._receipts.has(key) || restored._receipts.get(`reverse:${key}`)?.links?.reversesKey !== key) throw new Error('reversal registry differs from journals');
  }
  const pricing = data.botPricing ?? {};
  for (const price of Object.values(pricing)) if (!Number.isSafeInteger(price) || price < 0) throw new Error('invalid local service pricing');
  engine.botPricing = { ...pricing };
  return engine;
}
function localStore() { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
export class LedgerStore {
  static save(owner) { const raw = serializeTokenEngine(owner); localStore()?.setItem(TOKEN_STORAGE_KEY, raw); return raw; }
  static load(options = {}) { const raw = localStore()?.getItem(TOKEN_STORAGE_KEY); return raw ? loadTokenEngine(raw, options) : null; }
  static clear() { localStore()?.removeItem(TOKEN_STORAGE_KEY); }
}
export async function saveFile(owner, path) { const fs = await import('node:fs/promises'); await fs.writeFile(path, serializeTokenEngine(owner), 'utf8'); }
export async function loadFile(path, options = {}) { const fs = await import('node:fs/promises'); return loadTokenEngine(await fs.readFile(path, 'utf8'), options); }
