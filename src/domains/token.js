// ============================================================================
// TUMBO-SIM Token Vault — Hibernation Vault + savings pockets
// ----------------------------------------------------------------------------
// Part 04 of the shared token workstream ("token vault").
//
// Pure module: no DOM, no three.js, no Node built-ins. Safe to import from a
// Node test runner and from browser ES modules alike.
//
// Units: integer fluff only. 1 TUMBO-SIM = 1000 fluff. Every amount is a safe
// integer >= 0 and every division uses exact BigInt-backed floor math.
//
// Assets: TUMBO, sMIMAS. Per-asset supply comes from the ONE constant
// TOKEN_VAULT_SUPPLY_FLUFF below — never hardcode or quote a supply number
// anywhere else.
//
// Accounts:
//   u:<name>               user
//   b:<name>               business
//   u:<name>:save:<goal>   savings pocket, owned by u:<name>. Pockets are
//                          ordinary accounts in the journal, which keeps
//                          double-entry clean.
//   sys:treasury | sys:faucet | sys:escrow | sys:vault | sys:void | sys:market
//
// Actions: stake | save | deposit | lock | unstake | withdraw
//   stake    u:<name> -> sys:vault             flexible term; accrues simulated
//                                              rewards while open
//   deposit  u:<name> -> sys:vault             flexible term; no rewards
//   lock     u:<name> -> sys:vault             fixed term; withdraw allowed
//                                              only at/after the unlock tick
//   save     u:<name> -> u:<name>:save:<goal>  savings pocket (not the vault)
//   unstake  closes a stake: principal back from sys:vault plus accrued
//            rewards, paid from sys:treasury's simulated rewards reserve
//   withdraw closes a lock (only once matured) or a deposit; or pulls funds
//            out of a savings pocket back to its owner
//
// Hibernation Vault: every stake/deposit/lock opens a "position" whose
// principal sits in sys:vault. Invariant (see assertVaultIntegrity):
//   balance(sys:vault) == SUM(principal of open positions)   (per asset)
// Rewards are paid from sys:treasury and are never parked in sys:vault, so
// the invariant is exact.
//
// Every mutation takes a client idempotency key; replays return the original
// receipt. Journals sum to 0 per asset (the genesis mint is the single
// audited exception); balances never go negative; sys:void is burn-only
// (never debited); sys:vault / sys:escrow move only through ledger-internal
// flows.
//
// Simulated TUMBO-SIM points only — never real money, wagering, wallets,
// custody, or chains. Every UI surface built on this module must label
// itself simulated.
// ============================================================================

// ---------------------------------------------------------------------------
// Config — the single source of truth for supply and vault economics.
// ---------------------------------------------------------------------------

export const TOKEN_VAULT_SUPPLY_FLUFF = 1000000000;
export const FLUFF_PER_TUMBO_SIM = 1000;
export const TOKEN_VAULT_ASSETS = Object.freeze(['TUMBO', 'sMIMAS']);
export const TOKEN_VAULT_SYSTEM_ACCOUNTS = Object.freeze({
  treasury: 'sys:treasury',
  faucet: 'sys:faucet',
  escrow: 'sys:escrow',
  vault: 'sys:vault',
  void: 'sys:void',
  market: 'sys:market',
});
export const TOKEN_VAULT_ACTIONS = Object.freeze(
  ['stake', 'save', 'deposit', 'lock', 'unstake', 'withdraw'],
);
// Simulated staking rewards: basis points of principal per tick, floored.
// reward = floor(principal * REWARD_BPS_PER_TICK * elapsedTicks / 10000)
export const TOKEN_VAULT_REWARD_BPS_PER_TICK = 5;
// Share (basis points) of the treasury boot allocation earmarked as the
// simulated staking-rewards reserve. Rewards stop accruing value once the
// reserve is exhausted; the reserve is never parked in sys:vault.
export const TOKEN_VAULT_REWARD_POOL_BPS = 2000;

const SYS = TOKEN_VAULT_SYSTEM_ACCOUNTS;
const SYS_NAMES = new Set(Object.values(SYS));

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TokenVaultError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TokenVaultError';
    this.code = code || 'token_vault_error';
  }
}
export class InvalidInputError extends TokenVaultError {
  constructor(message) { super(message, 'invalid_input'); this.name = 'InvalidInputError'; }
}
export class UnknownAssetError extends TokenVaultError {
  constructor(asset) { super(`unknown asset: ${String(asset)}`, 'unknown_asset'); this.name = 'UnknownAssetError'; }
}
export class UnknownAccountError extends TokenVaultError {
  constructor(account) { super(`unknown account: ${String(account)}`, 'unknown_account'); this.name = 'UnknownAccountError'; }
}
export class InsufficientFundsError extends TokenVaultError {
  constructor(account, asset) { super(`insufficient ${asset} in ${account}`, 'insufficient_funds'); this.name = 'InsufficientFundsError'; }
}
export class IdempotencyKeyError extends TokenVaultError {
  constructor() { super('idempotencyKey must be a non-empty string of at most 128 chars', 'bad_idempotency_key'); this.name = 'IdempotencyKeyError'; }
}
export class PositionNotFoundError extends TokenVaultError {
  constructor(id) { super(`unknown position: ${String(id)}`, 'position_not_found'); this.name = 'PositionNotFoundError'; }
}
export class PositionStateError extends TokenVaultError {
  constructor(message) { super(message, 'position_state'); this.name = 'PositionStateError'; }
}
export class LockNotMaturedError extends TokenVaultError {
  constructor(id, unlockTick, tick) {
    super(`position ${id} is locked until tick ${unlockTick} (current tick ${tick})`, 'lock_not_matured');
    this.name = 'LockNotMaturedError';
  }
}
export class VaultIntegrityError extends TokenVaultError {
  constructor(asset, vaultBalance, openPrincipal) {
    super(`vault integrity breach for ${asset}: sys:vault=${vaultBalance} but open positions sum to ${openPrincipal}`, 'vault_integrity');
    this.name = 'VaultIntegrityError';
  }
}
export class ConservationError extends TokenVaultError {
  constructor(asset, total, supply) {
    super(`conservation breach for ${asset}: total=${total} supply=${supply}`, 'conservation');
    this.name = 'ConservationError';
  }
}
export class SystemAccountError extends TokenVaultError {
  constructor(message) { super(message, 'system_account'); this.name = 'SystemAccountError'; }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const GOAL_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const POCKET_RE = /^u:([a-z0-9][a-z0-9._-]{0,63}):save:([a-z0-9][a-z0-9._-]{0,31})$/;
const USER_RE = /^u:[a-z0-9][a-z0-9._-]{0,63}$/;
const BUSINESS_RE = /^b:[a-z0-9][a-z0-9._-]{0,63}$/;
const SEP = '\u0001';

export function isValidAsset(asset) {
  return asset === 'TUMBO' || asset === 'sMIMAS';
}
export function assertAsset(asset) {
  if (!isValidAsset(asset)) throw new UnknownAssetError(asset);
  return asset;
}
/** Owner (u:<name>) of a savings pocket, or null when not a pocket. */
export function pocketOwner(account) {
  if (typeof account !== 'string') return null;
  const m = POCKET_RE.exec(account);
  return m ? `u:${m[1]}` : null;
}
export function isPocketAccount(account) { return pocketOwner(account) !== null; }
export function isUserAccount(account) {
  return typeof account === 'string' && !isPocketAccount(account) && USER_RE.test(account);
}
export function isBusinessAccount(account) {
  return typeof account === 'string' && BUSINESS_RE.test(account);
}
export function isSystemAccount(account) { return SYS_NAMES.has(account); }
export function isValidAccount(account) {
  return isUserAccount(account) || isBusinessAccount(account) ||
    isSystemAccount(account) || isPocketAccount(account);
}
export function assertAccount(account) {
  if (!isValidAccount(account)) throw new UnknownAccountError(account);
  return account;
}
export function assertUserAccount(account) {
  if (!isUserAccount(account)) throw new UnknownAccountError(account);
  return account;
}
export function assertGoal(goal) {
  if (typeof goal !== 'string' || !GOAL_RE.test(goal)) {
    throw new InvalidInputError(`invalid savings goal: ${String(goal)}`);
  }
  return goal;
}
export function pocketAccount(owner, goal) {
  assertUserAccount(owner);
  assertGoal(goal);
  return `${owner}:save:${goal}`;
}

export function isSafeInt(n) { return typeof n === 'number' && Number.isSafeInteger(n); }
export function assertSafeInt(n, what) {
  if (!isSafeInt(n)) throw new InvalidInputError(`${what || 'value'} must be a safe integer`);
  return n;
}
export function assertPositiveFluff(amount) {
  assertSafeInt(amount, 'amountFluff');
  if (amount <= 0) throw new InvalidInputError('amountFluff must be a positive safe integer');
  return amount;
}
export function assertTick(tick, what) {
  assertSafeInt(tick, what || 'tick');
  if (tick < 0) throw new InvalidInputError(`${what || 'tick'} must be >= 0`);
  return tick;
}
export function assertIdempotencyKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > 128) {
    throw new IdempotencyKeyError();
  }
  return key;
}

/** Parse "12.345" TUMBO-SIM into exact integer fluff. No floats involved. */
export function parseTumboSim(text) {
  if (typeof text !== 'string') throw new InvalidInputError('amount must be a string like "12.345"');
  const t = text.trim();
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(t);
  if (!m) throw new InvalidInputError(`invalid TUMBO-SIM amount: ${text}`);
  const fluff = Number(m[1]) * FLUFF_PER_TUMBO_SIM + Number((m[2] || '').padEnd(3, '0'));
  if (!Number.isSafeInteger(fluff) || fluff <= 0) throw new InvalidInputError(`invalid TUMBO-SIM amount: ${text}`);
  return fluff;
}

/** Exact integer math: floor(a * b / c) via BigInt. Inputs and output are safe ints. */
export function mulDivFloor(a, b, c) {
  assertSafeInt(a, 'a'); assertSafeInt(b, 'b');
  assertSafeInt(c, 'c');
  if (c <= 0) throw new InvalidInputError('divisor must be positive');
  if (a < 0 || b < 0) throw new InvalidInputError('mulDivFloor inputs must be >= 0');
  const r = (BigInt(a) * BigInt(b)) / BigInt(c);
  const n = Number(r);
  if (!Number.isSafeInteger(n)) throw new InvalidInputError('mulDivFloor result is not a safe integer');
  return n;
}

// ---------------------------------------------------------------------------
// Canonical JSON + pure-JS SHA-256 (receipt hash chain). Exported so that
// third-party verifiers can recompute proof hashes without reimplementing.
// ---------------------------------------------------------------------------

function escapeForHash(str) {
  return str.replace(/[\u0080-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export function canonicalJson(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidInputError('cannot hash non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(escapeForHash(value));
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  throw new InvalidInputError('cannot hash value of this type');
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256HexAscii(ascii) {
  if (typeof ascii !== 'string' || /[^\x00-\x7f]/.test(ascii)) {
    throw new InvalidInputError('sha256HexAscii needs an ASCII string');
  }
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const bytes = [];
  for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 0xff);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0x00);
  const hi = Math.floor(bitLen / 0x100000000); const lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
    (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
  const w = new Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let b = 0; b < bytes.length; b += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[b + i * 4] << 24) | (bytes[b + i * 4 + 1] << 16) |
        (bytes[b + i * 4 + 2] << 8) | bytes[b + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0; let bb = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
    Object.freeze(obj);
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Vault ledger factory
// ---------------------------------------------------------------------------

export function createTokenVaultLedger(options = {}) {
  const supplyFluff = options.supplyFluff !== undefined
    ? assertPositiveFluff(options.supplyFluff)
    : TOKEN_VAULT_SUPPLY_FLUFF;

  const balances = new Map(); // `${asset}<U+0001>${account}` -> fluff
  const journals = [];
  const receipts = [];
  const idem = new Map(); // idempotencyKey -> frozen receipt
  const positions = new Map(); // positionId -> position (mutable internally)
  const listeners = new Set();

  let currentTick = 0;
  let journalSeq = 0;
  let positionSeq = 0;
  let lastHash = 'GENESIS';
  const rewardsReserve = { TUMBO: 0, sMIMAS: 0 };

  const bkey = (asset, account) => `${asset}${SEP}${account}`;
  const splitKey = (k) => {
    const sep = k.indexOf(SEP);
    return { asset: k.slice(0, sep), account: k.slice(sep + 1) };
  };

  function emit(evt) {
    for (const cb of [...listeners]) {
      try { cb(evt); } catch { /* listener errors never break the ledger */ }
    }
  }

  // --- journal ---------------------------------------------------------------
  function postJournal(action, key, legs, opts = {}) {
    if (!Array.isArray(legs) || legs.length < 2) {
      throw new InvalidInputError('a journal needs at least two legs');
    }
    for (const leg of legs) {
      assertAccount(leg.account);
      assertAsset(leg.asset);
      assertSafeInt(leg.amount, 'leg amount');
      if (leg.amount === 0) throw new InvalidInputError('journal legs must be non-zero');
      if (leg.account === SYS.void && leg.amount < 0) {
        throw new SystemAccountError('sys:void is burn-only: it can never be debited');
      }
      if ((leg.account === SYS.vault || leg.account === SYS.escrow) && !opts.internal) {
        throw new SystemAccountError(`${leg.account} moves only through ledger-internal flows`);
      }
    }
    // Zero-sum per asset. The genesis mint is the single audited exception:
    // it is where the configured supply enters the books.
    if (!opts.mint) {
      const sums = new Map();
      for (const leg of legs) sums.set(leg.asset, (sums.get(leg.asset) || 0) + leg.amount);
      for (const [asset, sum] of sums) {
        if (sum !== 0) throw new TokenVaultError(`journal does not sum to 0 for ${asset}`, 'journal_imbalance');
      }
    }
    // Apply atomically: validate every resulting balance first.
    const next = new Map();
    for (const leg of legs) {
      const k = bkey(leg.asset, leg.account);
      const nb = (balances.get(k) || 0) + leg.amount;
      if (!Number.isSafeInteger(nb) || nb < 0) {
        throw new InsufficientFundsError(leg.account, leg.asset);
      }
      next.set(k, nb);
    }
    for (const [k, nb] of next) balances.set(k, nb);
    const entry = deepFreeze({
      seq: ++journalSeq,
      tick: currentTick,
      action,
      key,
      legs: legs.map((l) => ({ account: l.account, asset: l.asset, amount: l.amount })),
      memo: opts.memo || null,
      mint: !!opts.mint,
    });
    journals.push(entry);
    for (const leg of legs) {
      emit({
        type: 'balance-changed',
        account: leg.account,
        asset: leg.asset,
        balance: balances.get(bkey(leg.asset, leg.account)),
        tick: currentTick,
      });
    }
    return entry;
  }

  // --- receipts ----------------------------------------------------------------
  function issueReceipt(action, key, entries, position, extra) {
    const body = {
      v: 1,
      action,
      key,
      tick: currentTick,
      journals: entries.map((e) => e.seq),
      position: position ? publicPosition(position) : null,
      extra: extra || null,
      integrity: {
        vault: vaultIntegrity(),
        conservation: conservationTotals(),
      },
      proof: { alg: 'sha256', prevHash: lastHash },
    };
    const hash = sha256HexAscii(canonicalJson(body));
    const receipt = deepFreeze({ ...body, proof: { alg: 'sha256', prevHash: lastHash, hash } });
    lastHash = hash;
    receipts.push(receipt);
    idem.set(key, receipt);
    emit({ type: 'receipt', receipt });
    return receipt;
  }

  function idempotent(key, fn) {
    assertIdempotencyKey(key);
    if (idem.has(key)) return idem.get(key);
    return fn();
  }

  // --- positions -----------------------------------------------------------------
  function newPosition(kind, owner, asset, principal, extra) {
    positionSeq += 1;
    const pos = {
      id: `vault:${String(positionSeq).padStart(4, '0')}`,
      kind,
      owner,
      asset,
      principal,
      status: 'open',
      openedTick: currentTick,
      unlockTick: extra.unlockTick !== undefined ? extra.unlockTick : null,
      lastAccrualTick: kind === 'stake' ? currentTick : null,
      closedTick: null,
      rewardPaidFluff: 0,
    };
    positions.set(pos.id, pos);
    emit({ type: 'vault', position: publicPosition(pos) });
    return pos;
  }

  function getOpenPosition(id) {
    const pos = positions.get(id);
    if (!pos) throw new PositionNotFoundError(id);
    if (pos.status !== 'open') throw new PositionStateError(`position ${id} is already ${pos.status}`);
    return pos;
  }

  function publicPosition(pos) {
    return JSON.parse(JSON.stringify({
      id: pos.id,
      kind: pos.kind,
      owner: pos.owner,
      asset: pos.asset,
      principal: pos.principal,
      status: pos.status,
      openedTick: pos.openedTick,
      unlockTick: pos.unlockTick,
      lastAccrualTick: pos.lastAccrualTick,
      closedTick: pos.closedTick,
      rewardPaidFluff: pos.rewardPaidFluff,
    }));
  }

  // --- rewards -------------------------------------------------------------------
  // Exact integer math: floor(principal * REWARD_BPS_PER_TICK * elapsed / 10000)
  function grossReward(principal, elapsedTicks) {
    if (elapsedTicks <= 0) return 0;
    return mulDivFloor(principal, TOKEN_VAULT_REWARD_BPS_PER_TICK * elapsedTicks, 10000);
  }

  // --- reads -----------------------------------------------------------------------
  function balance(account, asset) {
    assertAccount(account);
    assertAsset(asset);
    return balances.get(bkey(asset, account)) || 0;
  }

  function openPrincipalByAsset() {
    const sums = { TUMBO: 0, sMIMAS: 0 };
    for (const pos of positions.values()) {
      if (pos.status === 'open') sums[pos.asset] += pos.principal;
    }
    return sums;
  }

  function vaultIntegrity() {
    const open = openPrincipalByAsset();
    const report = {};
    for (const asset of TOKEN_VAULT_ASSETS) {
      const vaultBalance = balance(SYS.vault, asset);
      report[asset] = { vaultBalance, openPrincipal: open[asset], ok: vaultBalance === open[asset] };
    }
    return deepFreeze(report);
  }

  function conservationTotals() {
    const totals = { TUMBO: 0, sMIMAS: 0 };
    for (const [k, v] of balances) {
      totals[splitKey(k).asset] += v;
    }
    return deepFreeze(totals);
  }

  // --- mutations ---------------------------------------------------------------------
  function stake({ from, asset, amountFluff, idempotencyKey, memo }) {
    return idempotent(idempotencyKey, () => {
      assertAccount(from);
      assertAsset(asset);
      assertPositiveFluff(amountFluff);
      const entry = postJournal('stake', idempotencyKey, [
        { account: from, asset, amount: -amountFluff },
        { account: SYS.vault, asset, amount: amountFluff },
      ], { internal: true, memo });
      const pos = newPosition('stake', from, asset, amountFluff, {});
      return issueReceipt('stake', idempotencyKey, [entry], pos, null);
    });
  }

  function deposit({ from, asset, amountFluff, idempotencyKey, memo }) {
    return idempotent(idempotencyKey, () => {
      assertAccount(from);
      assertAsset(asset);
      assertPositiveFluff(amountFluff);
      const entry = postJournal('deposit', idempotencyKey, [
        { account: from, asset, amount: -amountFluff },
        { account: SYS.vault, asset, amount: amountFluff },
      ], { internal: true, memo });
      const pos = newPosition('deposit', from, asset, amountFluff, {});
      return issueReceipt('deposit', idempotencyKey, [entry], pos, null);
    });
  }

  function lock({ from, asset, amountFluff, unlockTick, idempotencyKey, memo }) {
    return idempotent(idempotencyKey, () => {
      assertAccount(from);
      assertAsset(asset);
      assertPositiveFluff(amountFluff);
      assertTick(unlockTick, 'unlockTick');
      if (unlockTick <= currentTick) {
        throw new InvalidInputError(`unlockTick (${unlockTick}) must be after the current tick (${currentTick})`);
      }
      const entry = postJournal('lock', idempotencyKey, [
        { account: from, asset, amount: -amountFluff },
        { account: SYS.vault, asset, amount: amountFluff },
      ], { internal: true, memo });
      const pos = newPosition('lock', from, asset, amountFluff, { unlockTick });
      return issueReceipt('lock', idempotencyKey, [entry], pos, null);
    });
  }

  function unstake({ positionId, idempotencyKey, memo }) {
    return idempotent(idempotencyKey, () => {
      const pos = getOpenPosition(positionId);
      if (pos.kind !== 'stake') {
        throw new PositionStateError(`position ${positionId} is a ${pos.kind}; close it with withdraw`);
      }
      const elapsed = currentTick - pos.lastAccrualTick;
      const gross = grossReward(pos.principal, elapsed);
      const paid = Math.min(gross, rewardsReserve[pos.asset]);
      rewardsReserve[pos.asset] -= paid;
      const legs = [
        { account: SYS.vault, asset: pos.asset, amount: -pos.principal },
        { account: pos.owner, asset: pos.asset, amount: pos.principal },
      ];
      if (paid > 0) {
        legs.push(
          { account: SYS.treasury, asset: pos.asset, amount: -paid },
          { account: pos.owner, asset: pos.asset, amount: paid },
        );
      }
      const entry = postJournal('unstake', idempotencyKey, legs, { internal: true, memo });
      pos.status = 'closed';
      pos.closedTick = currentTick;
      pos.lastAccrualTick = currentTick;
      pos.rewardPaidFluff = paid;
      emit({ type: 'vault', position: publicPosition(pos) });
      return issueReceipt('unstake', idempotencyKey, [entry], pos, {
        elapsedTicks: elapsed,
        grossRewardFluff: gross,
        rewardPaidFluff: paid,
        rewardsReserveLeftFluff: rewardsReserve[pos.asset],
      });
    });
  }

  // withdraw closes a vault position (lock/deposit) or pulls funds out of a
  // savings pocket: withdraw({ positionId, ... }) or
  // withdraw({ owner, goal, asset, amountFluff, ... })
  function withdraw(args) {
    const { idempotencyKey } = args || {};
    return idempotent(idempotencyKey, () => {
      if (args.positionId !== undefined && args.positionId !== null) {
        return withdrawPosition(args);
      }
      if (args.owner !== undefined || args.goal !== undefined) {
        return withdrawPocket(args);
      }
      throw new InvalidInputError('withdraw needs positionId or owner+goal');
    });
  }

  function withdrawPosition({ positionId, idempotencyKey, memo }) {
    const pos = getOpenPosition(positionId);
    if (pos.kind === 'stake') {
      throw new PositionStateError(`position ${positionId} is a stake; close it with unstake`);
    }
    if (pos.kind === 'lock' && currentTick < pos.unlockTick) {
      throw new LockNotMaturedError(positionId, pos.unlockTick, currentTick);
    }
    const entry = postJournal('withdraw', idempotencyKey, [
      { account: SYS.vault, asset: pos.asset, amount: -pos.principal },
      { account: pos.owner, asset: pos.asset, amount: pos.principal },
    ], { internal: true, memo });
    pos.status = 'closed';
    pos.closedTick = currentTick;
    emit({ type: 'vault', position: publicPosition(pos) });
    return issueReceipt('withdraw', idempotencyKey, [entry], pos, null);
  }

  function withdrawPocket({ owner, goal, asset, amountFluff, idempotencyKey, memo }) {
    const pocket = pocketAccount(owner, goal);
    assertAsset(asset);
    assertPositiveFluff(amountFluff);
    const entry = postJournal('withdraw', idempotencyKey, [
      { account: pocket, asset, amount: -amountFluff },
      { account: owner, asset, amount: amountFluff },
    ], { memo });
    return issueReceipt('withdraw', idempotencyKey, [entry], null, { pocket });
  }

  function save({ from, goal, asset, amountFluff, idempotencyKey, memo }) {
    return idempotent(idempotencyKey, () => {
      assertUserAccount(from);
      const pocket = pocketAccount(from, goal);
      assertAsset(asset);
      assertPositiveFluff(amountFluff);
      const entry = postJournal('save', idempotencyKey, [
        { account: from, asset, amount: -amountFluff },
        { account: pocket, asset, amount: amountFluff },
      ], { memo });
      return issueReceipt('save', idempotencyKey, [entry], null, { pocket });
    });
  }

  function advanceTick({ ticks, idempotencyKey }) {
    return idempotent(idempotencyKey, () => {
      assertSafeInt(ticks, 'ticks');
      if (ticks < 1) throw new InvalidInputError('ticks must be a positive safe integer');
      const fromTick = currentTick;
      currentTick += ticks;
      if (!Number.isSafeInteger(currentTick)) throw new InvalidInputError('tick overflow');
      emit({ type: 'tick', fromTick, toTick: currentTick, tick: currentTick });
      return issueReceipt('tick', idempotencyKey, [], null, { fromTick, toTick: currentTick });
    });
  }

  // --- invariant checks ------------------------------------------------------------------
  function assertVaultIntegrity(onlyAsset) {
    const report = vaultIntegrity();
    const assets = onlyAsset ? [assertAsset(onlyAsset)] : TOKEN_VAULT_ASSETS;
    for (const asset of assets) {
      const r = report[asset];
      if (!r.ok) throw new VaultIntegrityError(asset, r.vaultBalance, r.openPrincipal);
    }
    return true;
  }

  function assertConservation() {
    const totals = conservationTotals();
    for (const asset of TOKEN_VAULT_ASSETS) {
      if (totals[asset] !== supplyFluff) throw new ConservationError(asset, totals[asset], supplyFluff);
    }
    return true;
  }

  function verifyReceiptChain() {
    let prev = 'GENESIS';
    for (const r of receipts) {
      if (r.proof.prevHash !== prev) return false;
      const { proof, ...body } = r;
      const recomputed = sha256HexAscii(canonicalJson({ ...body, proof: { alg: 'sha256', prevHash: proof.prevHash } }));
      if (recomputed !== proof.hash) return false;
      prev = proof.hash;
    }
    return true;
  }

  // --- genesis -----------------------------------------------------------------------------
  (function boot() {
    const minted = {};
    const legs = [];
    for (const asset of TOKEN_VAULT_ASSETS) {
      const faucetShare = Math.floor(supplyFluff / 4);
      const treasuryShare = supplyFluff - faucetShare;
      rewardsReserve[asset] = Math.floor((treasuryShare * TOKEN_VAULT_REWARD_POOL_BPS) / 10000);
      legs.push({ account: SYS.faucet, asset, amount: faucetShare });
      legs.push({ account: SYS.treasury, asset, amount: treasuryShare });
      minted[asset] = supplyFluff;
    }
    const entry = postJournal('genesis', 'genesis', legs, { internal: true, mint: true });
    issueReceipt('genesis', 'genesis', [entry], null, {
      minted,
      rewardsReserveFluff: { ...rewardsReserve },
    });
    const grants = Array.isArray(options.initialGrants) ? options.initialGrants : [];
    for (const g of grants) {
      assertUserAccount(g.to);
      assertAsset(g.asset);
      assertPositiveFluff(g.amountFluff);
      postJournal('genesis', `genesis:grant:${g.to}:${g.asset}`, [
        { account: SYS.faucet, asset: g.asset, amount: -g.amountFluff },
        { account: g.to, asset: g.asset, amount: g.amountFluff },
      ], { internal: true, memo: 'simulated demo grant' });
    }
  })();

  // --- public API ----------------------------------------------------------------------------
  const api = {
    // meta
    config() {
      return deepFreeze({
        supplyFluff,
        fluffPerTumboSim: FLUFF_PER_TUMBO_SIM,
        assets: [...TOKEN_VAULT_ASSETS],
        rewardBpsPerTick: TOKEN_VAULT_REWARD_BPS_PER_TICK,
        rewardPoolBps: TOKEN_VAULT_REWARD_POOL_BPS,
      });
    },
    tick: () => currentTick,
    // reads
    balance,
    balancesOf(account) {
      assertAccount(account);
      const out = {};
      for (const asset of TOKEN_VAULT_ASSETS) out[asset] = balance(account, asset);
      return out;
    },
    vaultBalance(asset) { return balance(SYS.vault, assertAsset(asset)); },
    rewardsReserveOf(asset) { assertAsset(asset); return rewardsReserve[asset]; },
    position(id) {
      const pos = positions.get(id);
      return pos ? publicPosition(pos) : null;
    },
    positionsOf(owner) {
      assertAccount(owner);
      return [...positions.values()]
        .filter((p) => p.owner === owner)
        .sort((a, b) => b.openedTick - a.openedTick)
        .map(publicPosition);
    },
    openPositions(filter = {}) {
      return [...positions.values()]
        .filter((p) => p.status === 'open')
        .filter((p) => !filter.owner || p.owner === filter.owner)
        .filter((p) => !filter.kind || p.kind === filter.kind)
        .filter((p) => !filter.asset || p.asset === filter.asset)
        .sort((a, b) => a.openedTick - b.openedTick)
        .map(publicPosition);
    },
    pocketsOf(owner) {
      assertUserAccount(owner);
      const out = [];
      for (const [k, v] of balances) {
        const { asset, account } = splitKey(k);
        if (v > 0 && pocketOwner(account) === owner) out.push({ pocket: account, asset, balance: v });
      }
      return out.sort((a, b) => (a.pocket < b.pocket ? -1 : a.pocket > b.pocket ? 1 : 0));
    },
    estimateRewards(positionId) {
      const pos = positions.get(positionId);
      if (!pos) throw new PositionNotFoundError(positionId);
      if (pos.kind !== 'stake' || pos.status !== 'open') return 0;
      const gross = grossReward(pos.principal, currentTick - pos.lastAccrualTick);
      return Math.min(gross, rewardsReserve[pos.asset]);
    },
    // mutations
    stake,
    deposit,
    lock,
    save,
    unstake,
    withdraw,
    advanceTick,
    // invariants
    vaultIntegrity,
    assertVaultIntegrity,
    conservationTotals,
    assertConservation,
    verifyReceiptChain,
    trialBalance() {
      const rows = [];
      for (const [k, v] of balances) {
        const { asset, account } = splitKey(k);
        rows.push({ asset, account, balance: v });
      }
      return rows.sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : a.asset < b.asset ? -1 : 1));
    },
    journals() { return journals.map((j) => JSON.parse(JSON.stringify(j))); },
    receipts() { return [...receipts]; },
    receiptByKey(key) { return idem.get(key) || null; },
    onEvent(cb) {
      if (typeof cb !== 'function') throw new InvalidInputError('listener must be a function');
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return deepFreeze(api);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** Format integer fluff as "1,234.567 TUMBO-SIM" (en-US). */
export function fmtTokenFluff(fluff) {
  assertSafeInt(fluff, 'fluff');
  if (fluff < 0) throw new InvalidInputError('fluff must be >= 0');
  const whole = Math.floor(fluff / FLUFF_PER_TUMBO_SIM);
  const frac = String(fluff % FLUFF_PER_TUMBO_SIM).padStart(3, '0');
  return `${whole.toLocaleString('en-US')}.${frac} TUMBO-SIM`;
}

// ---------------------------------------------------------------------------
// Facade adapter — plugs the vault into window.TumboToken without clobbering
// fields another workstream already installed.
// ---------------------------------------------------------------------------

export function attachTokenVault(facade, options = {}) {
  const target = facade && typeof facade === 'object' ? facade : {};
  const engine = options.engine && typeof options.engine.stake === 'function'
    ? options.engine
    : createTokenVaultLedger(options);
  if (!target.ledger) target.ledger = engine;
  if (!target.tokenVault) target.tokenVault = engine;
  if (typeof target.balance !== 'function') {
    target.balance = (account, asset) => engine.balance(account, asset);
  }
  if (typeof target.fmt !== 'function') {
    target.fmt = (fluff) => fmtTokenFluff(fluff);
  }
  const forward = (evt) => {
    try {
      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
        document.dispatchEvent(new CustomEvent('tumbo:token', { detail: { type: evt.type, ...evt } }));
      }
    } catch { /* never break the ledger for a DOM failure */ }
  };
  engine.onEvent(forward);
  if (typeof target.on !== 'function') {
    target.on = (evtName, cb) => {
      if (typeof cb !== 'function') throw new InvalidInputError('listener must be a function');
      return engine.onEvent((evt) => { if (evt.type === evtName) cb(evt); });
    };
  }
  return target;
}
