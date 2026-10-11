/** Local persistence for the canonical TUMBO-SIM QuoteEngine. */
import { createTokenEngine, CONFIG } from './token.js?v=20261003-complete8';

export const TOKEN_STORAGE_KEY = 'tumbo.token.engine.v2';

function ownerEngine(owner) {
  if (owner?.ledger?.post && typeof owner?.quote === 'function' && typeof owner?.execute === 'function') {
    return owner.engine ?? owner;
  }
  return owner?.engine ?? owner?._engine ?? null;
}
function localStore() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

function assertCanonicalEngine(engine) {
  if (!engine?.ledger?.verifyChain || !engine?._issuedQuoteIds || !engine?.config) {
    throw new TypeError('store requires the canonical QuoteEngine API');
  }
  if (!engine.ledger.verifyChain().ok) throw new Error('cannot persist an invalid receipt chain');
  return engine;
}

/**
 * Serialize the engine's append-only journals and quote lifecycle registries.
 * The snapshot is local simulation state; it is never a wallet or credential.
 */
export function serializeTokenEngine(owner) {
  const engine = assertCanonicalEngine(ownerEngine(owner));
  return JSON.stringify({
    format: 'tumbo-token-engine-v2',
    config: engine.config,
    journals: engine.ledger._journals,
    issued: [...engine._issuedQuoteIds],
    executed: [...engine._executedQuoteIds],
    cancelled: [...engine._cancelledQuoteIds],
    reversed: [...engine._reversedJournalKeys],
    receipts: [...engine._receipts],
    botPricing: engine.botPricing ?? {},
  });
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function restoreJournal(engine, row) {
  if (!row || !Array.isArray(row.postings) || typeof row.idempotencyKey !== 'string') {
    throw new Error('malformed token journal');
  }
  const hasVoidCredit = row.postings.some((posting) => posting.account === 'sys:void' && posting.amount > 0);
  const generated = engine.ledger.post(row.postings, {
    idempotencyKey: row.idempotencyKey,
    action: row.action,
    memo: row.memo ?? '',
    links: row.links ?? null,
    voidCreditReason: hasVoidCredit ? 'tithe' : null,
    authority: 'internal',
  });
  const sealed = Object.freeze({
    ...row,
    postings: Object.freeze(row.postings.map((posting) => Object.freeze({ ...posting }))),
    ...(row.links ? { links: Object.freeze({ ...row.links }) } : {}),
  });
  const index = engine.ledger._journals.length - 1;
  engine.ledger._journals[index] = sealed;
  engine.ledger._receipts.set(row.idempotencyKey, sealed);
  engine.ledger._lastReceiptHash = sealed.hash;
  return generated;
}

function restoreSealedJournal(engine, row, index) {
  const sealed = Object.freeze({
    ...row,
    postings: Object.freeze(row.postings.map((posting) => Object.freeze({ ...posting }))),
    ...(row.links ? { links: Object.freeze({ ...row.links }) } : {}),
  });
  engine.ledger._journals[index] = sealed;
  engine.ledger._receipts.set(row.idempotencyKey, sealed);
  engine.ledger._lastReceiptHash = sealed.hash;
}

export function loadTokenEngine(raw, { config = CONFIG } = {}) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const allowed = new Set([
    'format', 'config', 'journals', 'issued', 'executed', 'cancelled',
    'reversed', 'receipts', 'botPricing',
  ]);
  if (!data || typeof data !== 'object' || Object.keys(data).some((key) => !allowed.has(key))) {
    throw new Error('unrecognized token snapshot field');
  }
  if (data.format !== 'tumbo-token-engine-v2' || !sameJson(data.config, config)) {
    throw new Error('unsupported token snapshot or configuration');
  }
  for (const field of ['journals', 'issued', 'executed', 'cancelled', 'reversed', 'receipts']) {
    if (!Array.isArray(data[field])) throw new Error(`malformed token snapshot: ${field}`);
  }

  const engine = createTokenEngine(config);
  const baseline = engine.ledger._journals.slice();
  if (data.journals.length < baseline.length) throw new Error('token snapshot omits canonical genesis');
  for (let index = 0; index < baseline.length; index += 1) {
    const saved = data.journals[index];
    const expected = baseline[index];
    if (!saved || saved.tick !== index + 1 ||
        saved.action !== expected.action ||
        saved.idempotencyKey !== expected.idempotencyKey ||
        !sameJson(saved.postings, expected.postings)) {
      throw new Error('snapshot genesis differs from canonical supply');
    }
    restoreSealedJournal(engine, saved, index);
  }

  // The factory already applied genesis. Replay only user journals so account
  // balances are rebuilt through the same invariant checks as live posting.
  for (const row of data.journals.slice(baseline.length)) restoreJournal(engine, row);
  if (!engine.ledger.verifyChain().ok) throw new Error('token receipt chain is corrupt');

  engine._issuedQuoteIds = new Set(data.issued);
  engine._executedQuoteIds = new Set(data.executed);
  engine._cancelledQuoteIds = new Set(data.cancelled);
  engine._reversedJournalKeys = new Set(data.reversed);
  engine._receipts = new Map(data.receipts);
  if (engine._receipts.size !== data.receipts.length) throw new Error('duplicate receipt registry key');
  const pricing = data.botPricing ?? {};
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) throw new Error('invalid local service pricing');
  for (const price of Object.values(pricing)) {
    if (!Number.isSafeInteger(price) || price < 0) throw new Error('invalid local service pricing');
  }
  engine.botPricing = { ...pricing };
  return engine;
}

export class LedgerStore {
  static save(owner) {
    const raw = serializeTokenEngine(owner);
    localStore()?.setItem(TOKEN_STORAGE_KEY, raw);
    return raw;
  }
  static load(options = {}) {
    const raw = localStore()?.getItem(TOKEN_STORAGE_KEY);
    return raw ? loadTokenEngine(raw, options) : null;
  }
  static clear() {
    localStore()?.removeItem(TOKEN_STORAGE_KEY);
  }
}

export async function saveFile(owner, path) {
  const fs = await import('node:fs/promises');
  await fs.writeFile(path, serializeTokenEngine(owner), 'utf8');
}

export async function loadFile(path, options = {}) {
  const fs = await import('node:fs/promises');
  return loadTokenEngine(await fs.readFile(path, 'utf8'), options);
}