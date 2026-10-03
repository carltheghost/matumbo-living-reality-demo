import test from 'node:test';
import assert from 'node:assert/strict';
import { createContractAtelier, quoteBinaryTrade, normalizeContractLogic } from '../src/domains/contract-atelier.js';
const market = studio => studio.createContract({ type: 'yes_no', role: 'house', topic: 'custom', title: 'Bounded rehearsal', logic: 'result', houseMode: 'pool' });
test('incomplete house pool funding blocks trading without changing positions', () => {
  const studio = createContractAtelier(), contract = market(studio);
  studio.joinHousePool({ contractId: contract.id, participant: 'alice', capital: 30 });
  const before = studio.get(contract.id);
  assert.throws(() => studio.placeStake({ contractId: contract.id, participant: 'bob', side: 'YES', amount: 10 }), /funding/);
  assert.equal(studio.get(contract.id), before);
  studio.joinHousePool({ contractId: contract.id, participant: 'carl', capital: 70 });
  studio.placeStake({ contractId: contract.id, participant: 'bob', side: 'YES', amount: 10 });
  assert.equal(studio.get(contract.id).houseCapital, 100);
});
test('funding freezes before trading and sales require the position owner and available shares', () => {
  const studio = createContractAtelier(), contract = market(studio);
  const position = studio.placeStake({ contractId: contract.id, participant: 'alice', side: 'YES', amount: 10 });
  const before = studio.get(contract.id);
  assert.throws(() => studio.joinHousePool({ contractId: contract.id, participant: 'carl', capital: 100 }), /before trading/);
  assert.throws(() => studio.sellPosition({ contractId: contract.id, positionId: position.id, participant: 'carl', shares: 1 }), /owner/);
  assert.throws(() => studio.sellPosition({ contractId: contract.id, positionId: position.id, participant: 'alice', shares: 11 }));
  assert.equal(studio.get(contract.id), before);
});
test('house pool terminal allocations conserve both positive and negative model P&L cents', () => {
  for (const result of [true, false]) {
    const studio = createContractAtelier(), contract = market(studio);
    studio.joinHousePool({ contractId: contract.id, participant: 'alice', capital: 40 });
    studio.joinHousePool({ contractId: contract.id, participant: 'bob', capital: 60 });
    const position = studio.placeStake({ contractId: contract.id, participant: 'carl', side: 'YES', amount: 70 });
    studio.sellPosition({ contractId: contract.id, positionId: position.id, participant: 'carl', shares: 13 });
    const resolved = studio.resolveContract({ contractId: contract.id, facts: { result } });
    const sum = resolved.resolution.houseContributors.reduce((n, row) => n + Math.round(row.pnl * 100), 0);
    assert.equal(sum, Math.round(resolved.resolution.grossHousePnl * 100));
    assert.equal(resolved.resolution.payouts.reduce((n, row) => n + row.amount, 0), result ? 57 : 0);
  }
});
test('LMSR quotes stay finite at extreme supported quantities and reject an unrecoverable next state', () => {
  const quoted = quoteBinaryTrade({ qYes: 999_000, qNo: 0, side: 'YES', shares: 100, b: 0.01 });
  for (const field of ['grossCost', 'fee', 'totalCost', 'priceBefore', 'priceAfter']) assert.ok(Number.isFinite(quoted[field]));
  assert.throws(() => quoteBinaryTrade({ qYes: 1_000_000, side: 'YES', shares: 1 }), /range/);
});
test('contract creation rejects cyclic or excessively nested logic before consuming an id', () => {
  const first = createContractAtelier({ seed: 'atomic' }), second = createContractAtelier({ seed: 'atomic' });
  const cycle = { kind: 'and', conditions: [] }; cycle.conditions = ['result', cycle];
  assert.throws(() => normalizeContractLogic(cycle), /depth/);
  assert.throws(() => first.createContract({ type: 'yes_no', title: 'invalid', logic: cycle }), /depth/);
  assert.equal(market(first).id, market(second).id);
});
test('sub-cent stakes and fabricated YES/NO outcome objects are rejected atomically', () => {
  const studio = createContractAtelier(), contract = market(studio), before = studio.get(contract.id);
  assert.throws(() => studio.placeStake({ contractId: contract.id, side: 'YES', amount: 0.001 }));
  assert.throws(() => studio.createContract({ type: 'yes_no', title: 'fake', logic: 'x', outcomes: { length: 2, 0: 'YES', 1: 'NO' } }));
  assert.equal(studio.get(contract.id), before);
});
