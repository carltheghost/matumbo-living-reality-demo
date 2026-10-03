/** Vault positions and savings pockets over the unified local token ledger. */
import { createTokenEngine, assertAccount, assertAsset, assertFluff, CONFIG, mulDivFloor, fmt, fnv1a64Hex } from './token.js?v=20261003-complete8';
import { sha256Hex } from './token-sha256.js?v=20261003-complete8';
export { mulDivFloor };
export const sha256HexAscii = sha256Hex;
export const TOKEN_VAULT_SUPPLY_FLUFF = CONFIG.supply;
export const TOKEN_VAULT_REWARD_BPS_PER_TICK = 5;
export class InvalidInputError extends Error {}
export class UnknownAssetError extends InvalidInputError {}
export class UnknownAccountError extends InvalidInputError {}
export class InsufficientFundsError extends InvalidInputError {}
export class PositionNotFoundError extends InvalidInputError {}
export class PositionStateError extends InvalidInputError {}
export class LockNotMaturedError extends PositionStateError {}
const freeze = object => Object.freeze(object);
export const fmtTokenFluff = fmt;
export function parseTumboSim(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) throw new InvalidInputError('amount needs at most three decimals');
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new InvalidInputError('amount exceeds the integer range');
  return Number(amount);
}
function user(value) {
  try { assertAccount(value); } catch { throw new UnknownAccountError('invalid owner account'); }
  if (!/^(u|b):/.test(value)) throw new UnknownAccountError('vault owner must be a user or bot');
  return value;
}
function asset(value) { try { return assertAsset(value); } catch { throw new UnknownAssetError('unknown asset'); } }
function positive(value) { try { assertFluff(value); } catch { throw new InvalidInputError('amount must be a positive safe integer'); } if (!value) throw new InvalidInputError('amount must be positive'); return value; }
export function pocketAccount(owner, goal) {
  user(owner);
  if (typeof goal !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(goal)) throw new InvalidInputError('invalid savings goal');
  return `${owner}:save:${goal}`;
}
export function pocketOwner(pocket) {
  const match = /^(u:[a-z0-9][a-z0-9_-]{0,63}|b:[a-z0-9][a-z0-9_-]{0,63}):save:[a-z0-9][a-z0-9_-]{0,31}$/i.exec(pocket);
  if (!match) throw new UnknownAccountError('invalid savings pocket');
  return match[1];
}
const corePocket = pocket => `u:save_${sha256Hex(pocket).slice(0, 48)}`;

export function createTokenVaultLedger({ engine = null, initialGrants = [] } = {}) {
  const core = engine ?? createTokenEngine();
  const positions = new Map(), pockets = new Set(), requests = new Map();
  let localTick = 0;
  const reserveAccount = code => code === 'TUMBO' ? 'sys:treasury' : 'sys:market';
  const balance = (account, code = 'TUMBO') => core.balance(account.includes(':save:') ? corePocket(account) : account, code);
  function checkKey(key) { if (typeof key !== 'string' || !key.trim()) throw new InvalidInputError('idempotencyKey is required'); }
  function replay(key, request) {
    checkKey(key);
    const existing = requests.get(key);
    if (!existing) return null;
    if (existing.request !== JSON.stringify(request)) {
      const error = new InvalidInputError('IDEM_MISMATCH: key belongs to another vault request'); error.code = 'IDEM_MISMATCH'; throw error;
    }
    return existing.result;
  }
  function post(action, key, request, postings, extra = {}, position = null) {
    let journal;
    try { journal = core.ledger.post(postings, { idempotencyKey: `vault:${key}`, action, memo: JSON.stringify(request), authority: 'internal' }); }
    catch (error) { if (/insufficient/.test(error.message)) throw new InsufficientFundsError(error.message); throw error; }
    const result = freeze({ ...journal, position, extra: freeze(extra), proof: freeze({ hash: journal.hash, prevHash: journal.prevHash }), simulation: true });
    requests.set(key, { request: JSON.stringify(request), result });
    core._emit('receipt', { receipt: result });
    for (const leg of postings) core._emit('balance-changed', { account: leg.account, asset: leg.asset, balance: core.balance(leg.account, leg.asset) });
    return result;
  }
  // Rebuild auxiliary ownership from the canonical journal. Financial balances
  // come only from the engine; reopening the adapter never posts another grant.
  for (const journal of core.ledger._journals) {
    if (!journal.idempotencyKey.startsWith('vault:')) continue;
    const request = JSON.parse(journal.memo);
    const key = journal.idempotencyKey.slice(6), kind = request.kind ?? journal.action;
    let position = null, extra = {};
    if (kind === 'tick') { localTick += request.ticks; extra = { toTick: localTick }; }
    if (['stake', 'deposit', 'lock'].includes(kind)) {
      position = freeze({ id: `vault:${fnv1a64Hex(key)}`, owner: user(request.from), asset: asset(request.asset ?? 'TUMBO'), amountFluff: positive(request.amountFluff), kind, status: 'open', openedTick: localTick, unlockTick: kind === 'lock' ? request.unlockTick : null, rewardPaidFluff: 0 });
      positions.set(position.id, position);
    }
    if (['unstake', 'withdraw'].includes(kind) && request.positionId) {
      const previous = positions.get(request.positionId);
      if (!previous) throw new PositionNotFoundError('stored vault close has no opening position');
      const reward = journal.postings.filter(leg => leg.account === previous.owner && leg.amount > 0).reduce((n, leg) => n + leg.amount, 0) - previous.amountFluff;
      position = freeze({ ...previous, status: 'closed', rewardPaidFluff: reward, closedTick: localTick });
      positions.set(position.id, position);
      extra = { elapsedTicks: localTick - previous.openedTick, grossRewardFluff: reward, rewardPaidFluff: reward };
    }
    if (['save', 'withdraw'].includes(kind) && request.goal) {
      const pocket = pocketAccount(request.owner ?? request.from, request.goal), code = asset(request.asset ?? 'TUMBO');
      pockets.add(`${pocket}|${code}`); extra = { pocket };
    }
    const result = freeze({ ...journal, position, extra: freeze(extra), proof: freeze({ hash: journal.hash, prevHash: journal.prevHash }), simulation: true });
    requests.set(key, { request: journal.memo, result });
  }
  initialGrants.forEach((grant, index) => {
    const account = user(grant.to), code = asset(grant.asset), amount = positive(grant.amountFluff);
    const key = `grant:${index}:${account}:${code}`;
    if (replay(key, grant)) return;
    post('grant', key, grant, [
      { account: reserveAccount(code), asset: code, amount: -amount }, { account, asset: code, amount },
    ]);
  });
  function open(kind, input = {}) {
    const prior = replay(input.idempotencyKey, { kind, ...input }); if (prior) return prior;
    const owner = user(input.from), code = asset(input.asset ?? 'TUMBO'), amount = positive(input.amountFluff);
    if (kind === 'lock' && (!Number.isSafeInteger(input.unlockTick) || input.unlockTick <= localTick)) throw new InvalidInputError('unlockTick must be a future tick');
    const position = freeze({ id: `vault:${fnv1a64Hex(input.idempotencyKey)}`, owner, asset: code, amountFluff: amount, kind, status: 'open', openedTick: localTick, unlockTick: kind === 'lock' ? input.unlockTick : null, rewardPaidFluff: 0 });
    const result = post(kind, input.idempotencyKey, { kind, ...input }, [{ account: owner, asset: code, amount: -amount }, { account: 'sys:vault', asset: code, amount }], {}, position);
    positions.set(position.id, position); return result;
  }
  function estimateRewards(id) {
    const position = positions.get(id); if (!position) throw new PositionNotFoundError('unknown position');
    return position.kind === 'stake' && position.status === 'open' ? mulDivFloor(position.amountFluff, TOKEN_VAULT_REWARD_BPS_PER_TICK * (localTick - position.openedTick), 10000) : 0;
  }
  function close(kind, input = {}) {
    const prior = replay(input.idempotencyKey, { kind, ...input }); if (prior) return prior;
    const position = positions.get(input.positionId); if (!position) throw new PositionNotFoundError('unknown position');
    const opening = [...requests.values()].find(row => row.result.position?.id === position.id && ['stake', 'deposit', 'lock'].includes(row.result.action));
    if (opening && core._reversedJournalKeys.has(opening.result.idempotencyKey)) throw new PositionStateError('opening position was reversed');
    if (input.owner && input.owner !== position.owner) throw new UnknownAccountError('position belongs to another owner');
    if (position.status !== 'open' || (kind === 'unstake') !== (position.kind === 'stake')) throw new PositionStateError('position cannot be closed with this action');
    if (position.kind === 'lock' && localTick < position.unlockTick) throw new LockNotMaturedError('lock is not mature');
    const reward = estimateRewards(position.id), source = reserveAccount(position.asset);
    const legs = [{ account: 'sys:vault', asset: position.asset, amount: -position.amountFluff }, { account: position.owner, asset: position.asset, amount: position.amountFluff }];
    if (reward) legs.push({ account: source, asset: position.asset, amount: -reward }, { account: position.owner, asset: position.asset, amount: reward });
    const closed = freeze({ ...position, status: 'closed', rewardPaidFluff: reward, closedTick: localTick });
    const result = post(kind, input.idempotencyKey, { kind, ...input }, legs, { elapsedTicks: localTick - position.openedTick, grossRewardFluff: reward, rewardPaidFluff: reward }, closed);
    positions.set(position.id, closed); return result;
  }
  function pocketMove(kind, input) {
    const prior = replay(input.idempotencyKey, { kind, ...input }); if (prior) return prior;
    const owner = user(input.owner ?? input.from), pocket = pocketAccount(owner, input.goal), code = asset(input.asset ?? 'TUMBO'), amount = positive(input.amountFluff), savings = corePocket(pocket);
    const from = kind === 'save' ? owner : savings, to = kind === 'save' ? savings : owner;
    const result = post(kind, input.idempotencyKey, { kind, ...input }, [{ account: from, asset: code, amount: -amount }, { account: to, asset: code, amount }], { pocket });
    pockets.add(`${pocket}|${code}`); return result;
  }
  function conservationTotals() {
    return Object.fromEntries(['TUMBO', 'sMIMAS'].map(code => [code, core.ledger.accounts().filter(row => row.asset === code && row.account !== 'sys:issuance').reduce((total, row) => total + core.balance(row.account, code), 0)]));
  }
  function vaultIntegrity() {
    return freeze(Object.fromEntries(['TUMBO', 'sMIMAS'].map(code => {
      const openPrincipal = [...positions.values()].filter(p => p.status === 'open' && p.asset === code).reduce((n, p) => n + p.amountFluff, 0);
      const vaultBalance = balance('sys:vault', code);
      // Other shared-core owners may also reserve funds here. This adapter
      // verifies coverage of its own positions, never claims their ownership.
      return [code, freeze({ openPrincipal, vaultBalance, ok: vaultBalance >= openPrincipal })];
    })));
  }
  return freeze({
    engine: core, tick: () => localTick, balance,
    stake: input => open('stake', input), deposit: input => open('deposit', input), lock: input => open('lock', input), unstake: input => close('unstake', input),
    withdraw: (input = {}) => {
      if (input.positionId) return close('withdraw', input);
      if (input.owner && input.goal) return pocketMove('withdraw', input);
      throw new InvalidInputError('withdraw needs a position or owner and goal');
    },
    save: input => pocketMove('save', input), estimateRewards,
    advanceTick(input = {}) {
      const prior = replay(input.idempotencyKey, { kind: 'tick', ...input }); if (prior) return prior;
      positive(input.ticks); assertFluff(localTick + input.ticks, 'tick');
      const toTick = localTick + input.ticks;
      const result = post('tick', input.idempotencyKey, { kind: 'tick', ...input }, [{ account: 'sys:vault', asset: 'TUMBO', amount: 0 }], { toTick });
      localTick = toTick; return result;
    },
    openPositions: ({ owner = null, kind = null } = {}) => [...positions.values()].filter(p => p.status === 'open' && (!owner || p.owner === owner) && (!kind || p.kind === kind)),
    pocketsOf: owner => [...pockets].filter(p => pocketOwner(p.split('|')[0]) === owner).map(entry => { const [pocket, asset] = entry.split('|'); return freeze({ pocket, owner, asset, balance: balance(pocket, asset) }); }),
    vaultBalance: code => balance('sys:vault', code), rewardsReserveOf: code => balance(reserveAccount(code), code),
    vaultIntegrity, assertVaultIntegrity: code => code ? vaultIntegrity()[code].ok : Object.values(vaultIntegrity()).every(row => row.ok),
    conservationTotals, assertConservation: () => Object.entries(conservationTotals()).every(([code, total]) => total === core.config.supply[code]),
    journals: () => core.ledger._journals.map(row => freeze({ ...row, legs: row.postings })),
    receipts: () => core.ledger._journals.map(row => freeze({ ...row, proof: freeze({ hash: row.hash, prevHash: row.prevHash }) })),
    verifyReceiptChain: () => core.ledger.verifyChain().ok,
    on: (...args) => core.on(...args),
    onEvent: callback => core.on('receipt', callback),
  });
}

const sharedVaults = new WeakMap();
export function attachTokenVault(existing = null, options = {}) {
  const existingEngine = existing?.engine ?? existing?.tokenVault?.engine ?? null;
  const suppliedEngine = options.engine ?? null;
  if (existingEngine && suppliedEngine && existingEngine !== suppliedEngine) {
    throw new TypeError('vault engine must match the existing facade owner');
  }
  const engine = suppliedEngine ?? existingEngine;
  if (engine && (typeof engine.balance !== 'function' || typeof engine.on !== 'function' || typeof engine.ledger?.onCommit !== 'function')) {
    throw new TypeError('vault requires the canonical QuoteEngine API');
  }
  if (existing?.tokenVault && existing.tokenVault.engine !== engine) {
    throw new TypeError('vault adapter must match the existing facade owner');
  }
  if (!existingEngine && existing && ['ledger', 'balance', 'on', 'quote', 'execute'].some(name => name in existing)) {
    throw new TypeError('existing financial facade must identify its canonical QuoteEngine');
  }
  const tokenVault = existing?.tokenVault ?? (engine && sharedVaults.get(engine)) ?? createTokenVaultLedger({ ...options, engine });
  sharedVaults.set(tokenVault.engine, tokenVault);
  return Object.freeze({
    ledger: tokenVault.engine.ledger, balance: (...args) => tokenVault.balance(...args), fmt: fmtTokenFluff, on: (...args) => tokenVault.on(...args),
    ...(existing ?? {}), engine: tokenVault.engine, tokenVault,
  });
}
