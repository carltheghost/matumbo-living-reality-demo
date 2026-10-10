import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTokenEngine } from '../src/domains/token.js?v=20261003-skin360';
import { serializeTokenEngine, loadTokenEngine } from '../src/domains/token-store.js?v=20261003-skin360';
import { sha256Hex } from '../src/domains/token-sha256.js?v=20261003-skin360';
import { createEconomicKernel, ECONOMIC_POOLS, economicJson, economicDigest } from '../src/domains/economic-kernel.js?v=20261003-skin360';
function fixture() {
  const engine = createTokenEngine();
  engine.faucet('u:you', 'TUMBO', 100000, { idempotencyKey: 'test-fund' });
  return { engine, kernel: createEconomicKernel({ engine, clock: () => 1791040000000 }) };
}
test('SHA-256 economic commitments match standard UTF-8 including emoji and broken surrogates', () => {
  for (const text of ['', 'abc', 'Tumbo Ω', 'Ourplace 🌍🧑🏾‍💻', '\ud800', '\udc00']) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'));
  }
});
test('funded purpose pools preserve supply and reject system-authority bypass', () => {
  const { engine, kernel } = fixture();
  kernel.fundPool({ from: 'u:you', purpose: 'rewards', amountFluff: 5000, idempotencyKey: 'pool' });
  assert.equal(engine.balance('u:you', 'TUMBO'), 95000);
  assert.equal(kernel.balance(ECONOMIC_POOLS.rewards), 5000);
  assert.throws(() => kernel.fundPool({ from: 'sys:treasury', purpose: 'rewards', amountFluff: 5000, idempotencyKey: 'bad' }), /participant/);
  const bypass = kernel.register('test.bypass', (_input, { post }) => post([{ account: 'sys:issuance', asset: 'TUMBO', amount: -10 }, { account: 'u:you', asset: 'TUMBO', amount: 10 }]));
  assert.throws(() => bypass({ idempotencyKey: 'bypass' }), /system/);
  assert.equal(kernel.proof().conserved, true);
  assert.equal(kernel.snapshot().commandCount, 1);
});
test('economic command replay is bound to the entire payload and insufficient payments are atomic', () => {
  const { engine, kernel } = fixture();
  const input = { from: 'u:you', to: 'u:creator', amountFluff: 1250, idempotencyKey: 'pay' };
  const receipt = kernel.pay(input), count = engine.ledger.journalCount();
  assert.equal(kernel.pay({ ...input }), receipt);
  assert.equal(engine.ledger.journalCount(), count);
  assert.throws(() => kernel.pay({ ...input, amountFluff: 2000 }), /IDEM_MISMATCH/);
  assert.throws(() => kernel.pay({ ...input, amountFluff: 999999, idempotencyKey: 'too-big' }), /insufficient/);
  assert.equal(engine.balance('u:creator', 'TUMBO'), 1250);
  assert.equal(kernel.snapshot().commandCount, 1);
  assert.equal(engine.ledger.verifyChain().ok, true);
});
test('explicit reserve burn is irreversible and never debits Void', () => {
  const { engine, kernel } = fixture();
  kernel.fundPool({ from: 'u:you', purpose: 'reserve', amountFluff: 1000, idempotencyKey: 'reserve' });
  assert.throws(() => kernel.burnReserve({ amountFluff: 100, idempotencyKey: 'deny' }), /explicit/);
  kernel.burnReserve({ amountFluff: 100, explicit: true, idempotencyKey: 'burn' });
  assert.equal(engine.balance('sys:void', 'TUMBO'), 100);
  assert.equal(kernel.proof().conserved, true);
});
test('proof commits amounts and liabilities, while exposing no external-anchor claim', () => {
  const { kernel } = fixture();
  let liability = 0;
  kernel.project('loan', () => ({ obligations: [{ kind: 'loan', amountFluff: liability }] }));
  const before = kernel.proof(); liability = 100;
  const after = kernel.proof();
  assert.equal(before.root, after.root);
  assert.notEqual(before.liabilityRoot, after.liabilityRoot);
  kernel.pay({ from: 'u:you', to: 'u:creator', amountFluff: 1, idempotencyKey: 'one' });
  assert.notEqual(after.root, kernel.proof().root);
  assert.equal(after.externalAnchor, null);
  assert.equal(after.sums.TUMBO, after.expected.TUMBO);
});
test('paired ledger and economic history restore exactly without funding twice', () => {
  const { engine, kernel } = fixture();
  kernel.fundPool({ from: 'u:you', purpose: 'rewards', amountFluff: 5000, idempotencyKey: 'pool' });
  kernel.pay({ from: 'u:you', to: 'u:creator', amountFluff: 25, idempotencyKey: 'pay' });
  kernel.fundPool({ from: 'u:you', purpose: 'rewards', amountFluff: 5000, idempotencyKey: 'pool2' });
  const restoredEngine = loadTokenEngine(serializeTokenEngine(engine));
  const restored = createEconomicKernel({ engine: restoredEngine, clock: () => 1 });
  const count = restoredEngine.ledger.journalCount(); restored.restore(kernel.exportState());
  assert.equal(restored.snapshot().eventRoot, kernel.snapshot().eventRoot);
  assert.equal(restored.balance(ECONOMIC_POOLS.rewards), 10000);
  assert.equal(restoredEngine.ledger.journalCount(), count);
  assert.deepEqual(restored.proof(), kernel.proof());
});
test('corrupt snapshots and missing paired receipts fail before importing commands', () => {
  const { kernel } = fixture();
  kernel.pay({ from: 'u:you', to: 'u:creator', amountFluff: 25, idempotencyKey: 'pay' });
  const raw = JSON.parse(kernel.exportState()); raw.commands[0].input.amountFluff = 26;
  const fresh = fixture().kernel;
  assert.throws(() => fresh.restore(JSON.stringify(raw)), /integrity/);
  const { digest, ...body } = raw; raw.digest = economicDigest(body);
  assert.throws(() => fresh.restore(JSON.stringify(raw)), /missing.*canonical journal/);
  assert.equal(fresh.snapshot().commandCount, 0);
});
test('metadata is deeply sealed, finite and bounded; re-entry cannot settle twice', () => {
  const input = { nested: [{ amount: 1 }] }, sealed = economicJson(input);
  input.nested[0].amount = 2; assert.equal(sealed.nested[0].amount, 1);
  assert.throws(() => economicJson({ amount: Infinity }), /finite/);
  const { kernel } = fixture();
  const recurse = kernel.register('test.recursion', () => kernel.pay({ from: 'u:you', to: 'u:creator', amountFluff: 1, idempotencyKey: 'nested' }));
  assert.throws(() => recurse({ idempotencyKey: 'outer' }), /re-enter/);
  assert.equal(kernel.snapshot().commandCount, 0);
});
test('export byte and nesting budgets are checked before a command can move value', () => {
  const engine = createTokenEngine(); engine.faucet('u:you', 'TUMBO', 100, { idempotencyKey: 'fund' });
  const kernel = createEconomicKernel({ engine, maxCommandChars: 1600 });
  const request = { from: 'u:you', to: 'u:creator', amountFluff: 1, idempotencyKey: 'one' };
  const paid = kernel.pay(request), count = engine.ledger.journalCount();
  assert.throws(() => kernel.pay({ ...request, idempotencyKey: 'two' }), /export budget is full/);
  assert.equal(kernel.pay(request), paid); assert.equal(engine.ledger.journalCount(), count);
  let nested = {}; for (let i = 0; i < 16; i++) nested = { nested };
  assert.throws(() => kernel.pay({ ...request, idempotencyKey: 'deep', nested }), /deeply nested/);
  assert.equal(engine.balance('u:creator', 'TUMBO'), 1); assert.doesNotThrow(() => kernel.exportState());
  kernel.dispose();
});
