/** Local activity adapter. All financial postings use the unified QuoteEngine. */
import { createTokenEngine, assertAccount, isUserAccount, assertAsset, assertFluff } from './token.js?v=20261003-skin360';
import { FAUCET_DRIP_FLUFF, RIBBON_CAP } from './token-config.js?v=20261003-skin360';

export class TokenError extends Error {
  constructor(message, code = 'INVALID_PARAM') { super(message); this.name = 'TokenError'; this.code = code; }
}

export class TokenActivityLedger {
  constructor({ engine = null } = {}) {
    this.engine = engine ?? createTokenEngine();
    this.tick = 0; this.day = 1;
    this._rows = []; this._keys = new Map(); this._listeners = new Set();
    this._ribbons = new Map(); this._presence = new Set(); this._drips = new Set();
    for (const core of this.engine.ledger._journals) {
      if (!core.idempotencyKey.startsWith('activity:')) {
        const row = this._externalRow(core); if (row) this._rows.push(row);
        continue;
      }
      const request = JSON.parse(core.memo), idem = core.idempotencyKey.slice(9);
      if (request.action !== 'hunger-tick') this.tick += 1;
      const { refs, meta } = request;
      if (refs.day) this.day = Math.max(this.day, refs.day);
      if (request.action === 'receive') this._drips.add(`${refs.account}:${refs.day ?? this.day}`);
      if (request.action === 'presence') this._presence.add(`${refs.account}:${refs.day}`);
      if (request.action === 'ribbon-claim') this._ribbons.set(refs.account, meta.ribbonId);
      const receipt = Object.freeze({ ...core, entries: Object.freeze(core.postings.filter(p => p.amount).map(p => Object.freeze({ account: p.account, asset: p.asset, delta: p.amount }))), actor: refs.account ?? refs.from, gameplayTick: this.tick, refs: Object.freeze({ ...refs }), meta: Object.freeze({ ...meta }), simulation: true });
      this._rows.push(receipt); this._keys.set(idem, { request: core.memo, receipt });
    }
    // Other tools use this same financial owner. Their committed user actions
    // can feed the activity view without a second transaction or event wave.
    this.engine.on('receipt', ({ receipt }) => {
      if (this._rows.some(row => row.id === receipt.id)) return;
      const journal = this.engine.ledger._journals.find(row => row.id === receipt.id);
      if (!journal) return; // quote cancellation carries no financial posting
      const row = this._externalRow(journal); if (!row) return;
      this._rows.push(row);
      for (const callback of [...this._listeners]) { try { callback(row); } catch { /* observational activity only */ } }
    });
  }
  _externalRow(journal) {
    const debit = journal.postings.find(p => isUserAccount(p.account) && p.amount < 0);
    const credit = journal.postings.find(p => isUserAccount(p.account) && p.amount > 0);
    const actor = debit?.account ?? credit?.account;
    if (!actor) return null;
    const amount = debit ? -debit.amount : credit.amount;
    this.tick = Math.min(Number.MAX_SAFE_INTEGER, this.tick + 1);
    return Object.freeze({ ...journal, actor, gameplayTick: this.tick,
      entries: Object.freeze(journal.postings.filter(p => p.amount).map(p => Object.freeze({ account: p.account, asset: p.asset, delta: p.amount }))),
      refs: Object.freeze({ account: actor, from: actor, to: credit?.account, amount, asset: (debit ?? credit).asset }), meta: Object.freeze({}), simulation: true });
  }
  ensureAccount(account) {
    assertAccount(account);
    if (!isUserAccount(account)) throw new TokenError('activity requires a user or bot account');
    this.engine.ledger.openAccount(account, 'TUMBO');
    return account;
  }
  balance(account, asset = 'TUMBO') { return this.engine.balance(account, asset); }
  receipts() { return this._rows.slice(); }
  on(event, callback) {
    if (event !== 'receipt' || typeof callback !== 'function') throw new TokenError('unknown activity observer');
    this._listeners.add(callback); return () => this._listeners.delete(callback);
  }
  advanceTicks(ticks) { assertFluff(ticks, 'ticks'); const next = assertFluff(this.tick + ticks, 'tick'); this.tick = next; return this.tick; }
  advanceDay() { this.day = assertFluff(this.day + 1, 'day'); return this.day; }
  ribbonOf(account) { return this._ribbons.get(account) ?? null; }
  ribbonCount() { return this._ribbons.size; }
  conservation() {
    const totals = {};
    for (const asset of ['TUMBO', 'sMIMAS']) {
      totals[asset] = this.engine.ledger.accounts().filter(a => a.asset === asset && a.account !== 'sys:issuance')
        .reduce((n, a) => n + this.balance(a.account, asset), 0);
    }
    return totals;
  }
  verifyChain() { return this.engine.ledger.verifyChain().ok ? { ok: true } : { ok: false }; }
  _commit(action, refs, idem, postings, { meta = {}, actor = refs.account ?? refs.from, sameTick = false, after = null } = {}) {
    if (typeof idem !== 'string' || !idem.trim()) throw new TokenError('idempotency key is required', 'MISSING_IDEM');
    const request = JSON.stringify({ action, refs, meta });
    const prior = this._keys.get(idem);
    if (prior) {
      if (prior.request !== request) throw new TokenError('idempotency key belongs to another activity', 'IDEM_MISMATCH');
      return prior.receipt;
    }
    const nextTick = sameTick ? this.tick : assertFluff(this.tick + 1, 'tick');
    const core = this.engine.ledger.post(postings, { idempotencyKey: `activity:${idem}`, action, memo: request, authority: 'internal' });
    this.tick = nextTick;
    const receipt = Object.freeze({ ...core, entries: Object.freeze(core.postings.filter(p => p.amount !== 0).map(p => Object.freeze({ account: p.account, asset: p.asset, delta: p.amount }))), actor, gameplayTick: this.tick, refs: Object.freeze({ ...refs }), meta: Object.freeze({ ...meta }), simulation: true });
    this._rows.push(receipt); this._keys.set(idem, { request, receipt });
    if (after) after(receipt);
    for (const callback of this._listeners) { try { callback(receipt); } catch { /* observers cannot unwind a posting */ } }
    this.engine._emit('receipt', { receipt });
    for (const p of postings) this.engine._emit('balance-changed', { account: p.account, asset: p.asset, balance: this.balance(p.account, p.asset) });
    return receipt;
  }
  drip(account, asset = 'TUMBO', idem) {
    this.ensureAccount(account); assertAsset(asset);
    if (asset !== 'TUMBO') throw new TokenError('the demo faucet supplies TUMBO only');
    const prior = this._keys.get(idem);
    if (prior) return this._commit('receive', { account, amount: FAUCET_DRIP_FLUFF, asset, day: prior.receipt.refs.day }, idem, []);
    const dayKey = `${account}:${this.day}`;
    if (this._drips.has(dayKey)) throw new TokenError('daily faucet already claimed', 'FAUCET_COOLDOWN');
    return this._commit('receive', { account, amount: FAUCET_DRIP_FLUFF, asset, day: this.day }, idem,
      [{ account: 'sys:faucet', asset, amount: -FAUCET_DRIP_FLUFF }, { account, asset, amount: FAUCET_DRIP_FLUFF }],
      { after: () => this._drips.add(dayKey) });
  }
  act(action, args = {}, idem) {
    const account = this.ensureAccount(args.account ?? args.from);
    const asset = args.asset ?? 'TUMBO'; assertAsset(asset);
    const noop = [{ account, asset, amount: 0 }];
    if (action === 'presence') {
      const prior = this._keys.get(idem);
      if (prior) return this._commit(action, { account, day: args.day }, idem, noop, { meta: { day: args.day } });
      if (args.day !== this.day) throw new TokenError('presence day must match the current local day', 'BAD_DAY');
      const dayKey = `${account}:${this.day}`;
      if (this._presence.has(dayKey) && !this._keys.has(idem)) throw new TokenError('presence already recorded', 'PRESENCE_ALREADY_RECORDED');
      return this._commit(action, { account, day: this.day }, idem, noop, { meta: { day: this.day }, after: () => this._presence.add(dayKey) });
    }
    if (action === 'ribbon-claim') {
      if (this._ribbons.has(account) && !this._keys.has(idem)) throw new TokenError('ribbon already claimed', 'RIBBON_ALREADY_CLAIMED');
      if (this._ribbons.size >= RIBBON_CAP && !this._keys.has(idem)) throw new TokenError('ribbon cap reached', 'RIBBON_CAP');
      const ribbonId = this._keys.get(idem)?.receipt.meta.ribbonId ?? `ribbon-${this._ribbons.size + 1}`;
      return this._commit(action, { account }, idem, noop, { meta: { ribbonId, monetized: false, transferable: false }, after: () => this._ribbons.set(account, ribbonId) });
    }
    if (action === 'hunger-tick') {
      for (const value of [args.from, args.to]) if (!Number.isInteger(value) || value < 0 || value > 100) throw new TokenError('hunger must be 0..100');
      return this._commit(action, { account }, idem, noop, { sameTick: true, meta: { from: args.from, to: args.to } });
    }
    if (action === 'tip' || action === 'send') {
      const to = this.ensureAccount(args.to), amount = assertFluff(args.amount, 'amount');
      if (!amount) throw new TokenError('amount must be positive');
      if (typeof (args.memo ?? '') !== 'string' || (args.memo ?? '').length > 240) throw new TokenError('memo must be a string of at most 240 characters');
      return this._commit(action, { from: account, to, asset, amount, memo: args.memo ?? '' }, idem,
        [{ account, asset, amount: -amount }, { account: to, asset, amount }]);
    }
    if (action === 'lock') {
      const amount = assertFluff(args.amount, 'amount');
      if (!amount) throw new TokenError('amount must be positive');
      return this._commit(action, { account, asset, amount }, idem,
        [{ account, asset, amount: -amount }, { account: 'sys:vault', asset, amount }]);
    }
    throw new TokenError(`unsupported local activity ${action}`, 'UNKNOWN_ACTION');
  }
}

const adapters = new WeakMap();
export function activityForEngine(engine) {
  if (!adapters.has(engine)) adapters.set(engine, new TokenActivityLedger({ engine }));
  return adapters.get(engine);
}
