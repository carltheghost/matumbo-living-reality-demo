// TUMBO-SIM Token Vault — test suite (part 04 of the token workstream).
// Run with: node --test tests/token-vault.test.mjs   (also via `npm test`)
//
// Covers: boot/conservation, exact-integer rewards, early-withdrawal refusal,
// double-release rejection, idempotent replays, savings-pocket ownership,
// the vault integrity invariant, input validation, and receipt-chain proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTokenVaultLedger,
  attachTokenVault,
  fmtTokenFluff,
  parseTumboSim,
  mulDivFloor,
  sha256HexAscii,
  pocketOwner,
  pocketAccount,
  TOKEN_VAULT_SUPPLY_FLUFF,
  TOKEN_VAULT_REWARD_BPS_PER_TICK,
  InvalidInputError,
  UnknownAssetError,
  UnknownAccountError,
  InsufficientFundsError,
  PositionNotFoundError,
  PositionStateError,
  LockNotMaturedError,
} from '../src/domains/token.js';

let keyN = 0;
const key = () => `test-key-${++keyN}`;
const grant = (to, asset, amountFluff) => ({ to, asset, amountFluff });

function fresh(extraGrants = []) {
  return createTokenVaultLedger({
    initialGrants: [
      grant('u:alice', 'TUMBO', 5_000_000),
      grant('u:alice', 'sMIMAS', 2_000_000),
      grant('u:mallory', 'TUMBO', 2_000_000),
      ...extraGrants,
    ],
  });
}

test('boots with conservation, an empty vault, and a funded rewards reserve', () => {
  const v = fresh();
  assert.equal(v.tick(), 0);
  assert.equal(v.vaultBalance('TUMBO'), 0);
  assert.equal(v.vaultBalance('sMIMAS'), 0);
  assert.equal(v.assertVaultIntegrity(), true);
  assert.equal(v.assertConservation(), true);
  const totals = v.conservationTotals();
  assert.equal(totals.TUMBO, TOKEN_VAULT_SUPPLY_FLUFF);
  assert.equal(totals.sMIMAS, TOKEN_VAULT_SUPPLY_FLUFF);
  assert.ok(v.rewardsReserveOf('TUMBO') > 0);
  assert.ok(v.rewardsReserveOf('sMIMAS') > 0);
  assert.equal(v.balance('u:alice', 'TUMBO'), 5_000_000);
});

test('vendored sha256 matches the FIPS-180 test vector', () => {
  assert.equal(
    sha256HexAscii('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('stake / deposit / lock move principal into sys:vault and keep integrity', () => {
  const v = fresh();
  const s = v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 1_000_000, idempotencyKey: key() });
  assert.equal(s.position.kind, 'stake');
  assert.equal(s.position.status, 'open');
  const d = v.deposit({ from: 'u:alice', asset: 'TUMBO', amountFluff: 500_000, idempotencyKey: key() });
  assert.equal(d.position.kind, 'deposit');
  const l = v.lock({ from: 'u:alice', asset: 'sMIMAS', amountFluff: 250_000, unlockTick: 100, idempotencyKey: key() });
  assert.equal(l.position.unlockTick, 100);
  assert.equal(v.vaultBalance('TUMBO'), 1_500_000);
  assert.equal(v.vaultBalance('sMIMAS'), 250_000);
  assert.equal(v.assertVaultIntegrity(), true);
  assert.equal(v.assertVaultIntegrity('TUMBO'), true);
  assert.equal(v.assertConservation(), true);
  // journals are zero-sum per asset
  for (const j of v.journals()) {
    if (j.mint) continue;
    const sums = {};
    for (const leg of j.legs) sums[leg.asset] = (sums[leg.asset] || 0) + leg.amount;
    for (const sum of Object.values(sums)) assert.equal(sum, 0);
  }
});

test('idempotent replay returns the original receipt without double-applying', () => {
  const v = fresh();
  const k = key();
  const r1 = v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 1_000_000, idempotencyKey: k });
  const r2 = v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 1_000_000, idempotencyKey: k });
  assert.ok(r1 === r2);
  assert.equal(v.openPositions({ owner: 'u:alice' }).length, 1);
  assert.equal(v.vaultBalance('TUMBO'), 1_000_000);
  assert.equal(v.balance('u:alice', 'TUMBO'), 4_000_000);
  // tick replay likewise
  const t1 = v.advanceTick({ ticks: 10, idempotencyKey: key() });
  assert.equal(t1.extra.toTick, 10);
  const tk = key();
  v.advanceTick({ ticks: 5, idempotencyKey: tk });
  const replay = v.advanceTick({ ticks: 5, idempotencyKey: tk });
  assert.equal(replay.extra.toTick, 15);
  assert.equal(v.tick(), 15);
});

test('stakes accrue simulated rewards with exact integer math', () => {
  const v = fresh();
  const reserveBefore = v.rewardsReserveOf('TUMBO');
  const staked = v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 1_000_000, idempotencyKey: key() });
  const pid = staked.position.id;
  v.advanceTick({ ticks: 200, idempotencyKey: key() });
  // expected = floor(1_000_000 * 5 * 200 / 10000) = 100_000
  const expected = mulDivFloor(1_000_000, TOKEN_VAULT_REWARD_BPS_PER_TICK * 200, 10000);
  assert.equal(expected, 100_000);
  assert.equal(v.estimateRewards(pid), expected);
  const done = v.unstake({ positionId: pid, idempotencyKey: key() });
  assert.equal(done.extra.elapsedTicks, 200);
  assert.equal(done.extra.grossRewardFluff, expected);
  assert.equal(done.extra.rewardPaidFluff, expected);
  assert.equal(done.position.status, 'closed');
  assert.equal(done.position.rewardPaidFluff, expected);
  assert.equal(v.balance('u:alice', 'TUMBO'), 5_000_000 + expected);
  assert.equal(v.vaultBalance('TUMBO'), 0);
  assert.equal(v.rewardsReserveOf('TUMBO'), reserveBefore - expected);
  assert.equal(v.assertVaultIntegrity(), true);
  assert.equal(v.assertConservation(), true);
});

test('unstake with no elapsed ticks pays no reward but still closes', () => {
  const v = fresh();
  const s = v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 1_000_000, idempotencyKey: key() });
  const done = v.unstake({ positionId: s.position.id, idempotencyKey: key() });
  assert.equal(done.extra.rewardPaidFluff, 0);
  assert.equal(v.balance('u:alice', 'TUMBO'), 5_000_000);
});

test('early withdrawal of a lock is refused before the unlock tick', () => {
  const v = fresh();
  const l = v.lock({ from: 'u:alice', asset: 'TUMBO', amountFluff: 500_000, unlockTick: 50, idempotencyKey: key() });
  const pid = l.position.id;
  assert.throws(() => v.withdraw({ positionId: pid, idempotencyKey: key() }), LockNotMaturedError);
  v.advanceTick({ ticks: 49, idempotencyKey: key() });
  assert.equal(v.tick(), 49);
  assert.throws(() => v.withdraw({ positionId: pid, idempotencyKey: key() }), LockNotMaturedError);
  v.advanceTick({ ticks: 1, idempotencyKey: key() });
  const done = v.withdraw({ positionId: pid, idempotencyKey: key() });
  assert.equal(done.position.status, 'closed');
  assert.equal(v.balance('u:alice', 'TUMBO'), 5_000_000);
  assert.equal(v.vaultBalance('TUMBO'), 0);
  assert.equal(v.assertVaultIntegrity(), true);
});

test('double release is rejected; replay of the release key is safe', () => {
  const v = fresh();
  const d = v.deposit({ from: 'u:alice', asset: 'TUMBO', amountFluff: 100_000, idempotencyKey: key() });
  const pid = d.position.id;
  const k1 = key();
  const r1 = v.withdraw({ positionId: pid, idempotencyKey: k1 });
  assert.equal(r1.position.status, 'closed');
  // a fresh key on a closed position is a double-release attempt: reject
  assert.throws(() => v.withdraw({ positionId: pid, idempotencyKey: key() }), PositionStateError);
  // replaying the original release key returns the original receipt, no-op
  const r2 = v.withdraw({ positionId: pid, idempotencyKey: k1 });
  assert.ok(r1 === r2);
  assert.equal(v.balance('u:alice', 'TUMBO'), 5_000_000);
  assert.equal(v.vaultBalance('TUMBO'), 0);
  assert.equal(v.assertVaultIntegrity(), true);
  assert.equal(v.assertConservation(), true);
});

test('double unstake is rejected; replay of the unstake key is safe', () => {
  const v = fresh();
  const s = v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 200_000, idempotencyKey: key() });
  const pid = s.position.id;
  const k1 = key();
  const r1 = v.unstake({ positionId: pid, idempotencyKey: k1 });
  assert.throws(() => v.unstake({ positionId: pid, idempotencyKey: key() }), PositionStateError);
  assert.ok(v.unstake({ positionId: pid, idempotencyKey: k1 }) === r1);
  assert.equal(v.balance('u:alice', 'TUMBO'), 5_000_000);
});

test('savings pockets are separate accounts owned by the same user', () => {
  const v = fresh();
  assert.equal(pocketOwner('u:alice:save:bike'), 'u:alice');
  assert.equal(pocketAccount('u:alice', 'bike'), 'u:alice:save:bike');
  const s = v.save({ from: 'u:alice', goal: 'bike', asset: 'TUMBO', amountFluff: 300_000, idempotencyKey: key() });
  assert.equal(s.extra.pocket, 'u:alice:save:bike');
  assert.equal(v.balance('u:alice:save:bike', 'TUMBO'), 300_000);
  assert.equal(v.balance('u:alice', 'TUMBO'), 4_700_000);
  // mallory cannot touch alice's pocket: her own pocket is empty -> insufficient
  assert.throws(
    () => v.withdraw({ owner: 'u:mallory', goal: 'bike', asset: 'TUMBO', amountFluff: 300_000, idempotencyKey: key() }),
    InsufficientFundsError,
  );
  // alice withdraws from her own pocket
  const w = v.withdraw({ owner: 'u:alice', goal: 'bike', asset: 'TUMBO', amountFluff: 100_000, idempotencyKey: key() });
  assert.equal(w.extra.pocket, 'u:alice:save:bike');
  assert.equal(v.balance('u:alice:save:bike', 'TUMBO'), 200_000);
  assert.equal(v.balance('u:alice', 'TUMBO'), 4_800_000);
  const pockets = v.pocketsOf('u:alice');
  assert.equal(pockets.length, 1);
  assert.equal(pockets[0].pocket, 'u:alice:save:bike');
  // pockets never touch the vault
  assert.equal(v.vaultBalance('TUMBO'), 0);
  assert.equal(v.assertVaultIntegrity(), true);
  assert.equal(v.assertConservation(), true);
});

test('vault integrity invariant holds across mixed multi-asset operations', () => {
  const v = fresh();
  v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 1_000_000, idempotencyKey: key() });
  v.lock({ from: 'u:alice', asset: 'TUMBO', amountFluff: 400_000, unlockTick: 30, idempotencyKey: key() });
  v.deposit({ from: 'u:mallory', asset: 'TUMBO', amountFluff: 700_000, idempotencyKey: key() });
  v.stake({ from: 'u:alice', asset: 'sMIMAS', amountFluff: 900_000, idempotencyKey: key() });
  v.save({ from: 'u:alice', goal: 'trip', asset: 'sMIMAS', amountFluff: 100_000, idempotencyKey: key() });
  assert.equal(v.assertVaultIntegrity(), true);
  v.advanceTick({ ticks: 40, idempotencyKey: key() });
  const locks = v.openPositions({ kind: 'lock' });
  v.withdraw({ positionId: locks[0].id, idempotencyKey: key() });
  const stakes = v.openPositions({ kind: 'stake' });
  for (const p of stakes) v.unstake({ positionId: p.id, idempotencyKey: key() });
  assert.equal(v.assertVaultIntegrity(), true);
  assert.equal(v.assertConservation(), true);
  const report = v.vaultIntegrity();
  assert.equal(report.TUMBO.ok, true);
  assert.equal(report.sMIMAS.ok, true);
  // only mallory's deposit remains open
  assert.equal(report.TUMBO.openPrincipal, 700_000);
  assert.equal(v.vaultBalance('TUMBO'), 700_000);
});

test('input validation rejects bad amounts, accounts, assets, and ticks', () => {
  const v = fresh();
  assert.throws(() => v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 0, idempotencyKey: key() }), InvalidInputError);
  assert.throws(() => v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: -5, idempotencyKey: key() }), InvalidInputError);
  assert.throws(() => v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 1.5, idempotencyKey: key() }), InvalidInputError);
  assert.throws(() => v.stake({ from: 'u:BAD NAME', asset: 'TUMBO', amountFluff: 10, idempotencyKey: key() }), UnknownAccountError);
  assert.throws(() => v.stake({ from: 'u:alice', asset: 'BTC', amountFluff: 10, idempotencyKey: key() }), UnknownAssetError);
  assert.throws(() => v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 5_000_001, idempotencyKey: key() }), InsufficientFundsError);
  assert.throws(() => v.lock({ from: 'u:alice', asset: 'TUMBO', amountFluff: 10, unlockTick: 0, idempotencyKey: key() }), InvalidInputError);
  assert.throws(() => v.withdraw({ positionId: 'vault:9999', idempotencyKey: key() }), PositionNotFoundError);
  assert.throws(() => v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 10, idempotencyKey: '' }), InvalidInputError);
  assert.throws(() => v.advanceTick({ ticks: 0, idempotencyKey: key() }), InvalidInputError);
  assert.throws(() => v.save({ from: 'u:alice', goal: 'BAD GOAL', asset: 'TUMBO', amountFluff: 10, idempotencyKey: key() }), InvalidInputError);
  assert.throws(() => v.withdraw({ idempotencyKey: key() }), InvalidInputError);
  // kind routing: withdraw cannot close a stake, unstake cannot close a lock
  const s = v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 10, idempotencyKey: key() });
  assert.throws(() => v.withdraw({ positionId: s.position.id, idempotencyKey: key() }), PositionStateError);
  const l = v.lock({ from: 'u:alice', asset: 'TUMBO', amountFluff: 10, unlockTick: 5, idempotencyKey: key() });
  assert.throws(() => v.unstake({ positionId: l.position.id, idempotencyKey: key() }), PositionStateError);
});

test('sMIMAS stakes accrue rewards from the sMIMAS reserve', () => {
  const v = fresh();
  const before = v.rewardsReserveOf('sMIMAS');
  const s = v.stake({ from: 'u:alice', asset: 'sMIMAS', amountFluff: 2_000_000, idempotencyKey: key() });
  v.advanceTick({ ticks: 50, idempotencyKey: key() });
  const expected = mulDivFloor(2_000_000, TOKEN_VAULT_REWARD_BPS_PER_TICK * 50, 10000);
  const done = v.unstake({ positionId: s.position.id, idempotencyKey: key() });
  assert.equal(done.extra.rewardPaidFluff, expected);
  assert.equal(v.balance('u:alice', 'sMIMAS'), 2_000_000 + expected);
  assert.equal(v.rewardsReserveOf('sMIMAS'), before - expected);
  assert.equal(v.assertConservation(), true);
});

test('receipt hash chain verifies end to end', () => {
  const v = fresh();
  v.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 100_000, idempotencyKey: key() });
  v.save({ from: 'u:alice', goal: 'g', asset: 'TUMBO', amountFluff: 50_000, idempotencyKey: key() });
  v.advanceTick({ ticks: 3, idempotencyKey: key() });
  assert.equal(v.verifyReceiptChain(), true);
  const rs = v.receipts();
  assert.ok(rs.length >= 4);
  for (let i = 1; i < rs.length; i++) assert.equal(rs[i].proof.prevHash, rs[i - 1].proof.hash);
  assert.equal(rs[0].proof.prevHash, 'GENESIS');
});

test('facade adapter exposes the shared TumboToken contract without clobbering', () => {
  const existing = { custom: 1 };
  const facade = attachTokenVault(existing, {
    initialGrants: [grant('u:alice', 'TUMBO', 1_000)],
  });
  assert.equal(facade.custom, 1);
  assert.ok(facade.ledger);
  assert.ok(facade.tokenVault);
  assert.equal(facade.balance('u:alice', 'TUMBO'), 1_000);
  assert.equal(facade.fmt(1234567), '1,234.567 TUMBO-SIM');
  const seen = [];
  const off = facade.on('receipt', (evt) => seen.push(evt.receipt.action));
  facade.tokenVault.stake({ from: 'u:alice', asset: 'TUMBO', amountFluff: 500, idempotencyKey: key() });
  assert.deepEqual(seen, ['stake']);
  off();
  // does not clobber pre-installed fields
  const keep = { ledger: { tag: 'other' }, balance: () => 42, fmt: () => 'x', on: () => 7 };
  const f2 = attachTokenVault(keep, {});
  assert.equal(f2.ledger.tag, 'other');
  assert.equal(f2.balance(), 42);
  assert.equal(f2.fmt(), 'x');
  assert.equal(f2.on(), 7);
  assert.ok(f2.tokenVault);
});

test('formatting and parsing round-trip exactly', () => {
  assert.equal(fmtTokenFluff(0), '0.000 TUMBO-SIM');
  assert.equal(fmtTokenFluff(1234567), '1,234.567 TUMBO-SIM');
  assert.equal(parseTumboSim('12.345'), 12345);
  assert.equal(parseTumboSim('7'), 7000);
  assert.equal(parseTumboSim('0.001'), 1);
  assert.throws(() => parseTumboSim('1.2345'), InvalidInputError);
  assert.throws(() => parseTumboSim('abc'), InvalidInputError);
});
