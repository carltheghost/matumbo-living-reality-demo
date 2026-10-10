import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenEngine, TumboUserLedger, seedDemoWallet } from '../src/domains/token.js?v=20261003-skin360';
import { serializeTokenEngine, loadTokenEngine } from '../src/domains/token-store.js?v=20261003-skin360';
import { createEconomicRuntime, ECONOMIC_STORAGE_KEY } from '../src/domains/economic-runtime.js?v=20261003-skin360';
import { createEconomicKernel, economicDigest, ECONOMIC_POOLS } from '../src/domains/economic-kernel.js?v=20261003-skin360';
import { createTokenTransferLedger } from '../src/domains/token-transfers.js?v=20261003-skin360';
import { createTokenFacade } from '../src/domains/token-facade.js?v=20261003-skin360';
import { createEconomicWorldContribution } from '../src/domains/economic-world-projection.js?v=20261003-skin360';
const at = Date.UTC(2026, 9, 3);
const storage = () => { const rows = new Map(); return { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) }; };
function fixture(store = storage()) {
  const engine = createTokenEngine(), runtime = createEconomicRuntime({ engine, storage: store, clock: () => at });
  return { engine, runtime, store };
}
function publishAdopt(f) {
  const descriptor = f.runtime.designSession.preview('blue; grid; reduced motion').descriptor;
  const design = f.runtime.creator.registerDesign({ id: 'first', version: 1, creator: 'u:creator', category: 'layout', title: 'A calmer world', descriptor, parents: [], privacy: 'public', idempotencyKey: 'register' });
  f.runtime.creator.publish({ key: design.key, creator: 'u:creator', license: 'attribution', explicit: true, idempotencyKey: 'publish' });
  f.runtime.observeAdoption({ designKey: design.key, actor: 'u:visitor', sessionId: 'session', descriptorHash: design.descriptorHash });
  return design;
}
test('all ordinary token paths reject purpose escrow sweeps, including internal-authority options', () => {
  const { engine, runtime } = fixture();
  engine.faucet('u:you', 'TUMBO', 1000, { idempotencyKey: 'fund' });
  runtime.kernel.fundPool({ from: 'u:you', purpose: 'rewards', amountFluff: 100, idempotencyKey: 'pool' });
  const count = engine.ledger.journalCount(), facade = createTokenFacade(engine), transfer = createTokenTransferLedger({ engine });
  const legs = [{ account: ECONOMIC_POOLS.rewards, asset: 'TUMBO', amount: -10 }, { account: 'u:thief', asset: 'TUMBO', amount: 10 }];
  assert.throws(() => engine.ledger.post(legs, { idempotencyKey: 'raw', authority: 'internal', economicCustody: {} }), /owner-issued economic custody/);
  assert.throws(() => transfer.send({ from: ECONOMIC_POOLS.rewards, to: 'u:thief', asset: 'TUMBO', amountFluff: 10, idempotencyKey: 'transfer' }), /custody/);
  assert.throws(() => facade.execute('send', { from: ECONOMIC_POOLS.rewards, to: 'u:thief', amountFluff: 10, idempotencyKey: 'activity' }), /custody/);
  assert.throws(() => facade.execute('stake', { from: ECONOMIC_POOLS.rewards, amountFluff: 10, idempotencyKey: 'stake' }), /custody/);
  const quote = engine.quote({ action: 'exchange', from: ECONOMIC_POOLS.rewards, fromAsset: 'TUMBO', toAsset: 'sMIMAS', amountIn: 10 });
  assert.throws(() => engine.execute(quote, { idempotencyKey: 'quote' }), /custody/);
  assert.throws(() => engine.ledger.claimEconomicCustody(), /already has an owner/);
  assert.equal(engine.ledger.journalCount(), count); assert.equal(engine.balance('u:thief', 'TUMBO'), 0);
  assert.equal(runtime.kernel.proof().conserved, true); facade.dispose(); runtime.dispose();
});
test('creator funding, actual adoption, guarded payment and paired reload preserve exact receipts and reward ownership', () => {
  const f = fixture(); publishAdopt(f);
  f.engine.faucet('u:you', 'TUMBO', 1000, { idempotencyKey: 'fund' });
  f.runtime.kernel.fundPool({ from: 'u:you', purpose: 'rewards', amountFluff: 100, idempotencyKey: 'pool' });
  const plan = f.runtime.planCreatorPayout({ planId: 'plan', idempotencyKey: 'plan' });
  const result = f.runtime.settleCreatorPlan({ planId: plan.planId, idempotencyKey: 'settle' });
  assert.equal(result.settled, true); assert.equal(result.state, 'paid'); assert.equal(f.engine.balance('u:creator', 'TUMBO'), 10);
  assert.equal(f.runtime.settleCreatorPlan({ planId: plan.planId, idempotencyKey: 'settle' }), result);
  const before = f.runtime.snapshot(), proof = f.runtime.kernel.proof(); f.runtime.persist();
  const restored = fixture(f.store);
  assert.equal(restored.runtime.snapshot().restoreStatus, 'restored-validated-local-bundle');
  assert.equal(restored.runtime.kernel.engine, restored.engine);
  assert.equal(restored.runtime.snapshot().eventRoot, before.eventRoot); assert.equal(restored.runtime.kernel.proof().root, proof.root);
  assert.equal(restored.runtime.creator.snapshot().entitlements[0].state, 'paid');
  assert.throws(() => createTokenTransferLedger({ engine: restored.engine }).send({ from: ECONOMIC_POOLS.rewards, to: 'u:thief', asset: 'TUMBO', amountFluff: 1, idempotencyKey: 'reload-sweep' }), /custody/);
  f.runtime.dispose(); restored.runtime.dispose();
});
test('corrupt domain replay rolls back adoption and clock without replacing the active canonical owner', () => {
  const f = fixture(); f.runtime.advanceClock({ deltaMs: 60000, explicit: true, idempotencyKey: 'clock' });
  const body = JSON.parse(f.runtime.exportState()); delete body.digest;
  body.creator.events.push({ invalid: true });
  f.store.setItem(ECONOMIC_STORAGE_KEY, JSON.stringify({ ...body, digest: economicDigest(body) }));
  const fresh = fixture(f.store);
  assert.match(fresh.runtime.snapshot().restoreStatus, /stored-history-rejected/);
  assert.equal(fresh.engine.ledger.journalCount(), 4); assert.equal(fresh.runtime.now(), at);
  fresh.runtime.dispose(); f.runtime.dispose();
});
test('an already active token owner rejects replacement by an otherwise valid stored history', () => {
  const f = fixture(); f.runtime.persist();
  const engine = createTokenEngine(); engine.faucet('u:active', 'TUMBO', 123, { idempotencyKey: 'active' });
  const ledger = engine.ledger, runtime = createEconomicRuntime({ engine, storage: f.store, clock: () => at });
  assert.equal(engine.ledger, ledger); assert.equal(engine.balance('u:active', 'TUMBO'), 123);
  assert.match(runtime.snapshot().restoreStatus, /active token owner/); runtime.dispose(); f.runtime.dispose();
});
test('wallet initialization is idempotent both in memory and after canonical snapshot reload', () => {
  const engine = createTokenEngine(); seedDemoWallet(new TumboUserLedger(engine));
  const count = engine.ledger.journalCount(), balance = engine.balance('u:you', 'TUMBO');
  seedDemoWallet(new TumboUserLedger(engine)); assert.equal(engine.ledger.journalCount(), count);
  const restored = loadTokenEngine(serializeTokenEngine(engine)); seedDemoWallet(new TumboUserLedger(restored));
  assert.equal(restored.ledger.journalCount(), count); assert.equal(restored.balance('u:you', 'TUMBO'), balance);
});
test('read-only economic world projection carries designs and journal commitments without executable authority', () => {
  const f = fixture(); publishAdopt(f);
  const contribution = createEconomicWorldContribution(f.runtime.snapshot(), new Date(at).toISOString());
  assert.equal(contribution.capabilities[0].executable, false); assert.equal(contribution.capabilities[0].authority, 'none');
  assert.equal(contribution.entities.filter(row => row.kind === 'reviewed-creator-design').length, 1);
  assert.equal(contribution.entities.filter(row => row.kind === 'purpose-specific-funded-pool').length, 4);
  assert.equal(JSON.stringify(contribution).includes('rawPrompt'), false); f.runtime.dispose();
});
test('native journals and cancelled quote receipts stop before paired export capacity, while exact replays still work', () => {
  const engine = createTokenEngine(), kernel = createEconomicKernel({ engine, maxJournals: 5, maxQuotes: 1 });
  const funded = engine.faucet('u:you', 'TUMBO', 100, { idempotencyKey: 'fund' });
  const quote = engine.quote({ action: 'buy', from: 'u:you', fromAsset: 'TUMBO', toAsset: 'sMIMAS', amountIn: 10 });
  engine.cancelQuote(quote.id);
  assert.throws(() => engine.quote({ action: 'buy', from: 'u:you', fromAsset: 'TUMBO', toAsset: 'sMIMAS', amountIn: 10 }), /quote history is full/);
  assert.throws(() => engine.faucet('u:you', 'TUMBO', 1, { idempotencyKey: 'overflow' }), /history is full/);
  assert.throws(() => kernel.pay({ from: 'u:you', to: 'u:visitor', amountFluff: 1, idempotencyKey: 'overflow' }), /history is full/);
  assert.equal(engine.faucet('u:you', 'TUMBO', 100, { idempotencyKey: 'fund' }), funded);
  assert.equal(engine.ledger.journalCount(), 5); assert.equal(engine.balance('u:you', 'TUMBO'), 100);
  const restored = loadTokenEngine(serializeTokenEngine(engine));
  assert.equal(restored.ledger.journalCount(), 5); assert.equal(restored._cancelledQuoteIds.has(quote.id), true);
  kernel.dispose();
});
test('a rejected adoption rolls back its observation and a full observation store still permits exact usage replay', () => {
  const f = fixture(), design = publishAdopt(f), before = f.runtime.observations.size;
  assert.throws(() => f.runtime.observeAdoption({ designKey: design.key, actor: 'bad actor', sessionId: 'rejected', descriptorHash: design.descriptorHash }));
  assert.equal(f.runtime.observations.size, before);
  for (let i = before; i < 2500; i++) f.runtime.observations.set(`fixture:${i}`, {});
  assert.throws(() => f.runtime.observeAdoption({ designKey: design.key, actor: 'u:visitor', sessionId: 'new', descriptorHash: design.descriptorHash }), /observations are full/);
  assert.equal(f.runtime.observations.size, 2500);
  assert.equal(f.runtime.observeAdoption({ designKey: design.key, actor: 'u:visitor', sessionId: 'session', descriptorHash: design.descriptorHash }).duplicateObserved, true);
  f.runtime.dispose();
});
test('paired restoration rejects a retained clock offset after its command prefix was removed', () => {
  const f = fixture(); f.runtime.advanceClock({ deltaMs: 60000, explicit: true, idempotencyKey: 'clock' });
  const body = JSON.parse(f.runtime.exportState()); delete body.digest;
  const kernelBody = { format: body.kernel.format, commands: [], eventRoot: 'genesis' };
  body.kernel = { ...kernelBody, digest: economicDigest(kernelBody) };
  f.store.setItem(ECONOMIC_STORAGE_KEY, JSON.stringify({ ...body, digest: economicDigest(body) }));
  const fresh = fixture(f.store);
  assert.match(fresh.runtime.snapshot().restoreStatus, /clock differs from its command history/);
  assert.equal(fresh.runtime.now(), at); assert.equal(fresh.engine.ledger.journalCount(), 4);
  f.runtime.dispose(); fresh.runtime.dispose();
});
test('command metadata includes all four bundle wrappers before settlement and reloads at the exact nesting boundary', () => {
  const f = fixture(); f.engine.faucet('u:you', 'TUMBO', 100, { idempotencyKey: 'fund' });
  const nested = count => { let value = 0; for (let i = 0; i < count; i++) value = { child: value }; return value; };
  const count = f.engine.ledger.journalCount();
  assert.throws(() => f.runtime.kernel.pay({ from: 'u:you', to: 'u:creator', amountFluff: 1, nested: nested(14), idempotencyKey: 'deep' }), /deeply nested/);
  assert.equal(f.engine.ledger.journalCount(), count); assert.equal(f.engine.balance('u:creator', 'TUMBO'), 0);
  f.runtime.kernel.pay({ from: 'u:you', to: 'u:creator', amountFluff: 1, nested: nested(13), idempotencyKey: 'exact' });
  assert.equal(f.runtime.persist(), true);
  const restored = fixture(f.store);
  assert.equal(restored.runtime.snapshot().restoreStatus, 'restored-validated-local-bundle');
  assert.equal(restored.engine.balance('u:creator', 'TUMBO'), 1);
  f.runtime.dispose(); restored.runtime.dispose();
});
