/** Local canonical-engine snapshots. Hashes detect corruption; registries are
 * cross-checked against journal evidence before a snapshot becomes live. */
import { createTokenEngine, CONFIG, MARKET_ACTIONS, mulDivFloor, quoteHash, receiptChainHash } from "./token.js";

export const TOKEN_STORAGE_KEY = "tumbo.token.engine.v2";

const ownerEngine = (owner) => typeof owner?.quote === "function" && typeof owner?.execute === "function" && owner?.ledger?.post
  ? owner
  : owner?.engine ?? owner?._engine ?? owner;

function localStore() {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

function assertCanonicalEngine(engine) {
  if (!engine?.ledger?.verifyChain || !engine?._issuedQuoteIds || !engine?.config) {
    throw new TypeError("store requires the canonical QuoteEngine API");
  }
  if (!engine.ledger.verifyChain().ok) throw new Error("cannot persist an invalid receipt chain");
  return engine;
}

function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function asUniqueStringSet(value, field) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`malformed token snapshot: ${field}`);
  const set = new Set(value);
  if (set.size !== value.length) throw new Error(`duplicate token snapshot registry entry: ${field}`);
  return set;
}
function exactSet(a, b, label) {
  if (a.size !== b.size || [...a].some((entry) => !b.has(entry))) throw new Error(`token snapshot ${label} disagrees with journal evidence`);
}

export function serializeTokenEngine(owner) {
  const engine = assertCanonicalEngine(ownerEngine(owner));
  return JSON.stringify({
    format: "tumbo-token-engine-v2",
    config: engine.config,
    journals: engine.ledger._journals,
    requests: [...(engine.ledger._requestKeys ?? [])],
    issued: [...engine._issuedQuoteIds],
    issuedQuotes: [...(engine._issuedQuotes ?? [])],
    executed: [...engine._executedQuoteIds],
    cancelled: [...engine._cancelledQuoteIds],
    reversed: [...engine._reversedJournalKeys],
    receipts: [...engine._receipts],
    botPricing: engine.botPricing ?? {},
  });
}

function derivedRequest(row) {
  const hasTithe = row.postings.some((posting) => posting.account === "sys:void" && posting.amount > 0);
  return JSON.stringify({
    postings: row.postings,
    action: row.action,
    memo: row.memo ?? "",
    voidCreditReason: hasTithe ? "tithe" : null,
    links: row.links ?? null,
    authority: "internal",
  });
}

function sealJournal(engine, row, index, request) {
  if (!row || !Array.isArray(row.postings) || typeof row.idempotencyKey !== "string" || typeof row.id !== "string") {
    throw new Error("malformed token journal");
  }
  if (row.hash !== receiptChainHash(row)) throw new Error("token journal hash mismatch");
  const generated = engine.ledger.post(row.postings, { ...JSON.parse(request), idempotencyKey: row.idempotencyKey });
  if (generated.action !== row.action || generated.idempotencyKey !== row.idempotencyKey) throw new Error("token journal request mismatch");
  const sealed = Object.freeze({
    ...row,
    postings: Object.freeze(row.postings.map((posting) => Object.freeze({ ...posting }))),
    ...(row.links ? { links: Object.freeze({ ...row.links }) } : {}),
  });
  engine.ledger._journals[index] = sealed;
  engine.ledger._receipts.set(row.idempotencyKey, sealed);
  engine.ledger._requestKeys.set(row.idempotencyKey, request);
  engine.ledger._lastReceiptHash = sealed.hash;
}

function validateIssuedQuotes(data, engine) {
  const issued = asUniqueStringSet(data.issued, "issued");
  if (!Array.isArray(data.issuedQuotes)) {
    if (issued.size) throw new Error("token snapshot is missing the issued quote registry");
    return { issued, quotes: new Map() };
  }
  const quotes = new Map();
  for (const entry of data.issuedQuotes) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !entry[1] || typeof entry[1] !== "object") {
      throw new Error("malformed issued quote registry");
    }
    const [id, quote] = entry;
    if (quotes.has(id) || quote.id !== id || quote.hash !== quoteHash(quote)) throw new Error("malformed issued quote registry");
    engine._validateQuoteShape(quote);
    quotes.set(id, Object.freeze({ ...quote }));
  }
  exactSet(issued, new Set(quotes.keys()), "issued quotes");
  return { issued, quotes };
}

function quoteIdFromSettlementJournal(journal) {
  if (!MARKET_ACTIONS.includes(journal.action)) return null;
  const prefix = "quote ";
  if (typeof journal.memo !== "string" || !journal.memo.startsWith(prefix) || journal.memo.length <= prefix.length) {
    throw new Error("market settlement journal has no canonical quote identity");
  }
  return journal.memo.slice(prefix.length);
}

function expectedQuotePostings(quote, engine) {
  const tithe = mulDivFloor(quote.amountIn, engine.config.titheBps, engine.config.titheDenominator);
  const postings = [
    { account: quote.from, asset: quote.fromAsset, amount: -quote.amountIn },
    { account: "sys:market", asset: quote.fromAsset, amount: quote.amountIn - tithe },
  ];
  if (tithe > 0) postings.push({ account: "sys:void", asset: quote.fromAsset, amount: tithe });
  postings.push(
    { account: "sys:market", asset: quote.toAsset, amount: -quote.amountOut },
    { account: quote.from, asset: quote.toAsset, amount: quote.amountOut },
  );
  return postings;
}

function validateQuoteSettlement(journal, receipt, quoteId, quote, engine) {
  if (!quote || quote.id !== quoteId || quote.hash !== quoteHash(quote)) {
    throw new Error("quote settlement has no matching issued quote");
  }
  engine._validateQuoteShape(quote);
  if (quote.action !== journal.action || receipt.quoteId !== quoteId || receipt.action !== quote.action ||
      receipt.from !== quote.from || receipt.to !== quote.to || receipt.fromAsset !== quote.fromAsset ||
      receipt.toAsset !== quote.toAsset || receipt.amountIn !== quote.amountIn || receipt.amountOut !== quote.amountOut) {
    throw new Error("quote settlement identity differs from journal evidence");
  }
  const expected = expectedQuotePostings(quote, engine);
  const expectedTithe = expected.find((leg) => leg.account === "sys:void")?.amount ?? 0;
  if (!sameJson(journal.postings, expected) || receipt.tithe !== expectedTithe) {
    throw new Error("quote settlement postings differ from issued quote");
  }
}

function validateReceiptRegistry(data, journals, issued, executed, cancelled, quotes, engine) {
  if (!Array.isArray(data.receipts)) throw new Error("malformed receipt registry");
  const receipts = new Map();
  const derivedExecuted = new Set();
  const derivedCancelled = new Set();
  const normalReceiptKeys = new Set();
  const settlementQuoteIds = new Map();
  const seenSettlementQuoteIds = new Set();
  for (const [key, journal] of journals) {
    const quoteId = quoteIdFromSettlementJournal(journal);
    if (quoteId) {
      if (seenSettlementQuoteIds.has(quoteId)) throw new Error("quote settlement appears more than once in journal evidence");
      seenSettlementQuoteIds.add(quoteId);
      settlementQuoteIds.set(key, quoteId);
    }
  }
  for (const entry of data.receipts) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !entry[1] || typeof entry[1] !== "object") {
      throw new Error("malformed receipt registry");
    }
    const [key, receipt] = entry;
    if (receipts.has(key) || receipt.idempotencyKey !== key) throw new Error("duplicate or mismatched receipt registry key");
    if (receipt.kind === "cancellation") {
      if (typeof receipt.quoteId !== "string" || !receipt.cancelled) throw new Error("malformed cancellation receipt");
      if (!issued.has(receipt.quoteId)) throw new Error("cancellation references an unknown quote");
      derivedCancelled.add(receipt.quoteId);
      receipts.set(key, Object.freeze({ ...receipt }));
      continue;
    }
    const journal = journals.get(key);
    if (!journal || receipt.id !== journal.id || receipt.hash !== journal.hash || receipt.action !== journal.action || receipt.tick !== journal.tick) {
      throw new Error("receipt registry differs from journal evidence");
    }
    if (receipt.kind !== "receipt" || !sameJson(receipt.postings, journal.postings)) throw new Error("receipt postings differ from journal evidence");
    normalReceiptKeys.add(key);
    const settlementQuoteId = settlementQuoteIds.get(key);
    if (settlementQuoteId) {
      if (!issued.has(settlementQuoteId) || !executed.has(settlementQuoteId)) throw new Error("quote settlement has an unbound lifecycle registry");
      validateQuoteSettlement(journal, receipt, settlementQuoteId, quotes.get(settlementQuoteId), engine);
      derivedExecuted.add(settlementQuoteId);
    } else if (receipt.quoteId !== undefined && receipt.quoteId !== null) {
      throw new Error("non-settlement receipt has quote identity");
    }
    receipts.set(key, Object.freeze({ ...receipt, postings: journal.postings }));
  }
  const registryJournalKeys = new Set([...journals.values()]
    .filter((journal) => ["faucet", "exchange", "buy", "sell"].includes(journal.action))
    .map((journal) => journal.idempotencyKey));
  exactSet(registryJournalKeys, normalReceiptKeys, "receipts");
  exactSet(executed, derivedExecuted, "executed quotes");
  exactSet(cancelled, derivedCancelled, "cancelled quotes");
  exactSet(new Set(settlementQuoteIds.values()), derivedExecuted, "settlement quote identities");
  return receipts;
}

export function loadTokenEngine(raw, { config = CONFIG } = {}) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const allowed = new Set([
    "format", "config", "journals", "requests", "issued", "issuedQuotes", "executed", "cancelled",
    "reversed", "receipts", "botPricing",
  ]);
  if (!data || typeof data !== "object" || Object.keys(data).some((key) => !allowed.has(key))) throw new Error("unrecognized token snapshot field");
  if (data.format !== "tumbo-token-engine-v2" || !sameJson(data.config, config)) throw new Error("unsupported token snapshot or configuration");
  if (!Array.isArray(data.journals)) throw new Error("malformed token snapshot: journals");
  const engine = createTokenEngine(config);
  const baseline = engine.ledger._journals.slice();
  if (data.journals.length < baseline.length) throw new Error("token snapshot omits canonical genesis");

  const requests = new Map();
  if (data.requests !== undefined) {
    if (!Array.isArray(data.requests)) throw new Error("malformed token snapshot: requests");
    for (const entry of data.requests) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string" || requests.has(entry[0])) throw new Error("malformed token request registry");
      requests.set(entry[0], entry[1]);
    }
  }

  const journals = new Map();
  const ids = new Set();
  let previousHash = "genesis";
  for (let index = 0; index < data.journals.length; index += 1) {
    const row = data.journals[index];
    if (!row || typeof row.id !== "string" || ids.has(row.id) || journals.has(row.idempotencyKey) || row.tick !== index + 1 || row.prevHash !== previousHash) {
      throw new Error("invalid token journal order or identity");
    }
    ids.add(row.id); journals.set(row.idempotencyKey, row);
    if (index < baseline.length) {
      const expected = baseline[index];
      if (row.action !== expected.action || row.idempotencyKey !== expected.idempotencyKey || !sameJson(row.postings, expected.postings)) {
        throw new Error("snapshot genesis differs from canonical supply");
      }
    } else if (row.action === "genesis") {
      throw new Error("duplicate genesis is forbidden");
    }
    if (row.hash !== receiptChainHash(row)) throw new Error("token journal hash mismatch");
    previousHash = row.hash;
  }

  for (let index = 0; index < data.journals.length; index += 1) {
    const row = data.journals[index];
    const request = requests.get(row.idempotencyKey) ?? derivedRequest(row);
    const parsed = JSON.parse(request);
    if (!sameJson(parsed.postings, row.postings) || parsed.action !== row.action || parsed.memo !== (row.memo ?? "") || !sameJson(parsed.links ?? null, row.links ?? null)) {
      throw new Error("journal request does not match receipt");
    }
    sealJournal(engine, row, index, request);
  }
  if (!engine.ledger.verifyChain().ok) throw new Error("token receipt chain is corrupt");

  const { issued, quotes } = validateIssuedQuotes(data, engine);
  const executed = asUniqueStringSet(data.executed, "executed");
  const cancelled = asUniqueStringSet(data.cancelled, "cancelled");
  const reversed = asUniqueStringSet(data.reversed, "reversed");
  if ([...executed, ...cancelled].some((id) => !issued.has(id)) || [...executed].some((id) => cancelled.has(id))) {
    throw new Error("token snapshot lifecycle registry is inconsistent");
  }
  const receiptRegistry = validateReceiptRegistry(data, journals, issued, executed, cancelled, quotes, engine);

  const derivedReversed = new Set(data.journals.filter((row) => row.action === "reverse" && row.links?.reversesKey).map((row) => row.links.reversesKey));
  exactSet(reversed, derivedReversed, "reversed journals");
  for (const key of reversed) {
    const reversal = journals.get(`reverse:${key}`);
    if (!reversal || reversal.links?.reversesKey !== key) throw new Error("reversal registry differs from journals");
  }

  const pricing = data.botPricing ?? {};
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) throw new Error("invalid local service pricing");
  for (const price of Object.values(pricing)) if (!Number.isSafeInteger(price) || price < 0) throw new Error("invalid local service pricing");

  engine._issuedQuoteIds = issued;
  engine._issuedQuotes = quotes;
  engine._executedQuoteIds = executed;
  engine._cancelledQuoteIds = cancelled;
  engine._reversedJournalKeys = reversed;
  engine._receipts = receiptRegistry;
  engine.botPricing = { ...pricing };
  return engine;
}

/** Adopt a validated snapshot into the already-exported shared owner. */
export function adoptTokenEngine(target, source) {
  if (!target || !source || target === source) return target ?? source;
  assertCanonicalEngine(source);
  target.config = source.config;
  target.ledger = source.ledger;
  target._issuedQuoteIds = source._issuedQuoteIds;
  target._issuedQuotes = source._issuedQuotes;
  target._executedQuoteIds = source._executedQuoteIds;
  target._cancelledQuoteIds = source._cancelledQuoteIds;
  target._reversedJournalKeys = source._reversedJournalKeys;
  target._receipts = source._receipts;
  target.botPricing = source.botPricing;
  return target;
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
  static clear() { localStore()?.removeItem(TOKEN_STORAGE_KEY); }
}

export async function saveFile(owner, path) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(path, serializeTokenEngine(owner), "utf8");
}

export async function loadFile(path, options = {}) {
  const fs = await import("node:fs/promises");
  return loadTokenEngine(await fs.readFile(path, "utf8"), options);
}
