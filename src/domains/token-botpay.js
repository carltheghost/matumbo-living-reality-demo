/**
 * Local simulated request → 402 challenge → payment → fulfillment.
 * QuoteEngine owns every balance and receipt. Tokens and open challenges stay
 * in memory; they are local capabilities, not network authentication/signing.
 */
import { assertAccount, assertFluff, newId } from './token.js?v=20261003-skin360';
import { FLUFF_PER_TUMBO } from './token-config.js?v=20261003-skin360';

export const DEFAULT_PRICING = Object.freeze({
  'cube.spawn': 50,
  'cube.message': 5,
  'cube.render': 20,
  'market.quote': 10,
  'arena.enter': 500,
  'travel.hop': 25,
  'presence.ping': 1,
});
export const BOT_SPEND_CAP_FLUFF = 10_000;
export const BOT_SPEND_WINDOW_TICKS = 10;
export const BOT_CHALLENGE_TTL_TICKS = 100;

export class BotPayError extends Error {
  constructor(code, message) { super(message); this.name = 'BotPayError'; this.code = code; }
}
export class Pay402 extends Error {
  constructor(challenge) {
    super(`402 Payment Required: ${challenge.resource} costs ${challenge.priceFluff} simulated fluff`);
    this.name = 'Pay402'; this.code = 402; this.challenge = challenge;
  }
}

function accountFor(botId) {
  if (typeof botId !== 'string') throw new BotPayError('BAD_BOT', 'bot ID must be a string');
  try { return assertAccount(`b:${botId}`); }
  catch { throw new BotPayError('BAD_BOT', 'bot ID must form a valid canonical bot account'); }
}
function resourceName(resource) {
  if (typeof resource !== 'string' || !resource.trim() || resource.length > 160 || /[\x00-\x1f]/.test(resource)) {
    throw new BotPayError('BAD_RESOURCE', 'resource must be a nonempty string of at most 160 characters');
  }
  return resource;
}
function safePrice(value, resource) {
  try { return assertFluff(value, 'priceFluff'); }
  catch { throw new BotPayError('BAD_PRICE', `invalid simulated price for ${resource}`); }
}
function freezeData(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}
function copyParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new BotPayError('BAD_PARAMS', 'params must be an object containing JSON data');
  }
  try {
    const raw = JSON.stringify(params);
    if (raw.length > 8192) throw new Error('params are too large');
    const copied = JSON.parse(raw);
    if (!copied || typeof copied !== 'object' || Array.isArray(copied)) throw new Error('invalid params');
    return freezeData(copied);
  } catch { throw new BotPayError('BAD_PARAMS', 'params must fit within 8192 characters of JSON data'); }
}

// ES module URLs can expose equivalent engine classes with different identity.
// Accept the complete canonical owner API, never a balance-only ledger facade.
function isCanonicalEngine(engine) {
  const ledger = engine?.ledger;
  return Boolean(engine && ledger &&
    ['quote', 'execute', 'faucet', 'balance', 'on', '_emit', 'journalHistory'].every(name => typeof engine[name] === 'function') &&
    ['post', 'openAccount', 'verifyChain', 'verifyReceipt', 'accounts', 'journalCount', 'onCommit'].every(name => typeof ledger[name] === 'function') &&
    Array.isArray(ledger._journals) && typeof ledger._receipts?.get === 'function' &&
    typeof engine._reversedJournalKeys?.has === 'function' && Number.isSafeInteger(ledger.tick) && ledger.tick >= 0 &&
    ['TUMBO', 'sMIMAS'].every(asset => Number.isSafeInteger(engine.config?.supply?.[asset]) && engine.config.supply[asset] > 0));
}

export class BotPay {
  #wallets = new Map();
  #challenges = new Map();

  constructor(owner, { pricing = DEFAULT_PRICING, allowSimulationFunding = false, challengeTtlTicks = BOT_CHALLENGE_TTL_TICKS } = {}) {
    const engine = isCanonicalEngine(owner) ? owner : owner?.engine ?? owner?._engine;
    if (!isCanonicalEngine(engine)) throw new TypeError('BotPay requires the canonical QuoteEngine, facade, or wallet');
    if (typeof allowSimulationFunding !== 'boolean') throw new TypeError('allowSimulationFunding must be a boolean');
    if (!Number.isSafeInteger(challengeTtlTicks) || challengeTtlTicks < BOT_CHALLENGE_TTL_TICKS) {
      throw new TypeError('challengeTtlTicks must be a safe integer of at least 100');
    }
    if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) throw new TypeError('pricing must be an object');
    const prices = Object.create(null);
    for (const [resource, price] of Object.entries(pricing)) prices[resourceName(resource)] = safePrice(price, resource);
    Object.defineProperties(this, {
      engine: { value: engine, enumerable: true },
      ledger: { value: engine.ledger, enumerable: true },
      pricing: { value: Object.freeze(prices), enumerable: true },
      allowSimulationFunding: { value: allowSimulationFunding, enumerable: true },
      challengeTtlTicks: { value: challengeTtlTicks, enumerable: true },
    });
  }

  registerBot(botId, { initialTumbo = 0 } = {}) {
    const accountId = accountFor(botId);
    if (this.#wallets.has(botId)) throw new BotPayError('BOT_EXISTS', botId);
    let fluff;
    try { assertFluff(initialTumbo, 'initialTumbo'); fluff = assertFluff(initialTumbo * FLUFF_PER_TUMBO, 'initial fluff'); }
    catch { throw new BotPayError('BAD_AMOUNT', 'initialTumbo must convert to a nonnegative safe integer amount'); }
    if (fluff && !this.allowSimulationFunding) {
      throw new BotPayError('GATE_DENIED', 'local simulation funding must be enabled explicitly by the BotPay owner');
    }
    // Preflight all options before creating an account/token. Faucet failure
    // leaves registration untouched, so the same bot ID can be retried.
    if (fluff) this.engine.faucet(accountId, 'TUMBO', fluff, { idempotencyKey: newId('bot-fund') });
    else this.ledger.openAccount(accountId, 'TUMBO');
    this.#wallets.set(botId, Object.freeze({ accountId, authToken: newId('simtok') }));
    return Object.freeze({ botId, accountId });
  }

  issueToken(botId) {
    const wallet = this.#wallets.get(botId);
    if (!wallet) throw new BotPayError('UNKNOWN_BOT', String(botId));
    return wallet.authToken;
  }

  setPrice({ service, resource, priceFluff, authToken }) {
    accountFor(service); resourceName(resource);
    const wallet = this.#wallets.get(service);
    if (!wallet || wallet.authToken !== authToken) throw new BotPayError('BAD_AUTH', 'only the service bot may set its own prices');
    safePrice(priceFluff, resource);
    // This metadata follows existing canonical-engine snapshot persistence.
    // It owns no balances; a rejected override cannot modify stored pricing.
    this.engine.botPricing = { ...(this.engine.botPricing ?? {}), [`${service}:${resource}`]: priceFluff };
    return priceFluff;
  }

  priceFor(service, resource) {
    accountFor(service); resourceName(resource);
    const key = `${service}:${resource}`, overrides = this.engine.botPricing ?? {};
    const price = Object.hasOwn(overrides, key) ? overrides[key] : this.pricing[resource] ?? 0;
    return safePrice(price, resource);
  }

  request({ fromBot, service, resource, params = {} }) {
    accountFor(fromBot); const payTo = accountFor(service); resourceName(resource);
    if (!this.#wallets.has(fromBot)) throw new BotPayError('UNKNOWN_BOT', fromBot);
    const priceFluff = this.priceFor(service, resource), data = copyParams(params);
    if (!priceFluff) return Object.freeze({ free: true, resource, service, params: data });
    if (fromBot === service) throw new BotPayError('SELF_PAYMENT', 'a paid service requires a different bot account');
    const expiresTick = this.ledger.tick + this.challengeTtlTicks;
    if (!Number.isSafeInteger(expiresTick)) throw new BotPayError('BAD_EXPIRY', 'challenge expiry exceeds the safe integer range');
    const challenge = Object.freeze({
      challengeId: newId('ch'), resource, service, params: data, priceFluff,
      payTo, nonce: newId('nonce'), fromBot, expiresTick, used: false,
    });
    this.#challenges.set(challenge.challengeId, { challenge, phase: 'pending', receipt: null });
    throw new Pay402(challenge);
  }

  #state(challengeId) {
    const state = this.#challenges.get(challengeId);
    if (!state) throw new BotPayError('UNKNOWN_CHALLENGE', String(challengeId));
    return state;
  }

  #checkExpiry(challenge, tick = this.ledger.tick) {
    if (tick >= challenge.expiresTick) throw new BotPayError('CHALLENGE_EXPIRED', challenge.challengeId);
  }

  pay({ challengeId, authToken }) {
    const state = this.#state(challengeId), challenge = state.challenge;
    if (state.phase !== 'pending') throw new BotPayError('NONCE_REUSED', 'challenge already paid or being paid');
    // A payment itself advances the canonical clock. Do not debit on the
    // final tick when fulfillment would immediately be expired.
    const paymentTick = this.ledger.tick + 1;
    this.#checkExpiry(challenge, paymentTick);
    const wallet = this.#wallets.get(challenge.fromBot);
    if (!wallet || wallet.authToken !== authToken) throw new BotPayError('BAD_AUTH', 'bot auth failed');
    // Count recent canonical journals, so another adapter/reload cannot reset
    // the spend cap. There is no separate balance or mutable spend ledger.
    let spent = 0n;
    for (const receipt of this.engine.journalHistory({ limit: BOT_SPEND_WINDOW_TICKS }).rows) {
      if (receipt.tick <= paymentTick - BOT_SPEND_WINDOW_TICKS || receipt.action !== 'tip' || !receipt.idempotencyKey.startsWith('x402:')) continue;
      for (const posting of receipt.postings) {
        if (posting.account === wallet.accountId && posting.asset === 'TUMBO' && posting.amount < 0) spent += BigInt(-posting.amount);
      }
    }
    if (spent + BigInt(challenge.priceFluff) > BigInt(BOT_SPEND_CAP_FLUFF)) {
      throw new BotPayError('SPEND_CAP', 'bot spend cap hit within the last 10 canonical ticks');
    }
    state.phase = 'paying'; // Commit observers cannot reenter this payment.
    let receipt;
    try {
      receipt = this.ledger.post([
        { account: wallet.accountId, asset: 'TUMBO', amount: -challenge.priceFluff },
        { account: challenge.payTo, asset: 'TUMBO', amount: challenge.priceFluff },
      ], {
        idempotencyKey: `x402:${challengeId}`, action: 'tip', memo: `x402:${challenge.nonce}`,
        links: { botPayChallenge: challengeId, fromBot: challenge.fromBot, service: challenge.service, resource: challenge.resource },
      });
    } catch (error) { state.phase = 'pending'; throw error; }
    state.receipt = receipt; state.phase = 'paid';
    this.engine._emit('receipt', { receipt });
    for (const posting of receipt.postings) this.engine._emit('balance-changed', {
      account: posting.account, asset: posting.asset, balance: this.engine.balance(posting.account, posting.asset),
    });
    return receipt;
  }

  fulfill({ challengeId, receiptHash, handler }) {
    const state = this.#state(challengeId), challenge = state.challenge, receipt = state.receipt;
    if (state.phase !== 'paid' || !receipt) throw new BotPayError('UNPAID', '402: payment required first');
    this.#checkExpiry(challenge);
    if (receipt.hash !== receiptHash) throw new BotPayError('RECEIPT_MISMATCH', 'receipt does not match challenge payment');
    if (!this.ledger.verifyReceipt(receipt.id).ok || !this.ledger.verifyChain().ok) {
      throw new BotPayError('INVALID_RECEIPT', 'canonical payment receipt failed verification');
    }
    if (receipt.memo !== `x402:${challenge.nonce}` || receipt.links?.botPayChallenge !== challengeId) {
      throw new BotPayError('NONCE_MISMATCH', 'payment is not bound to this challenge');
    }
    const debit = receipt.postings.find(row => row.account === `b:${challenge.fromBot}` && row.asset === 'TUMBO');
    const credit = receipt.postings.find(row => row.account === challenge.payTo && row.asset === 'TUMBO');
    if (receipt.postings.length !== 2 || debit?.amount !== -challenge.priceFluff || credit?.amount !== challenge.priceFluff) {
      throw new BotPayError('UNDERPAID', 'canonical amount differs from the challenge price');
    }
    if (this.engine._reversedJournalKeys.has(receipt.idempotencyKey) || this.engine.journalHistory({ action: 'reverse', limit: 1000 }).rows.some(row => row.links?.reverses === receipt.id)) {
      throw new BotPayError('PAYMENT_REVERSED', 'reversed payment cannot fulfill a resource');
    }
    if (handler !== undefined && typeof handler !== 'function') throw new BotPayError('BAD_HANDLER', 'handler must be a local function');
    // Consume before invoking local code. A reentrant/throwing handler cannot
    // serve the same paid challenge twice.
    this.#challenges.delete(challengeId);
    const paidChallenge = Object.freeze({ ...challenge, used: true, paymentTx: receipt.id });
    return { status: 200, resource: challenge.resource, service: challenge.service,
      result: handler ? handler(paidChallenge) : { ok: true } };
  }
}
