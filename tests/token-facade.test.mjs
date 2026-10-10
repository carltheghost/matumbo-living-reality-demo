/** Current facade contract. Legacy delivery routes live in token-transfers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenEngine, fmt, TumboUserLedger } from '../src/domains/token.js';
import { createTokenFacade, TOKEN_EVENT } from '../src/domains/token-facade.js';
const funded = () => { const engine = createTokenEngine(); engine.faucet('u:alice', 'TUMBO', 10_000_000, { idempotencyKey: 'fund' }); return engine; };
const send = { from: 'u:alice', to: 'u:bob', amountFluff: 2500, idempotencyKey: 'send' };
test('facade exposes canonical owner, wallet, exact formatting and firm quotes', () => {
  const engine = funded(), facade = createTokenFacade(engine);
  assert.equal(TOKEN_EVENT, 'tumbo:token'); assert.equal(facade.engine, engine); assert.equal(facade.ledger._engine, engine);
  assert.equal(facade.fmt(1500), fmt(1500)); assert.match(facade.fmt(1500), /1.500 TUMBO-SIM/);
  assert.equal(facade.balance('u:alice'), 10_000_000);
  assert.equal(facade.quote({ action: 'buy', from: 'u:alice', fromAsset: 'TUMBO', toAsset: 'sMIMAS', amountIn: 100 }).amountOut, 1000);
});
test('execute requires an idempotency key and rejects removed or unknown actions', () => {
  const facade = createTokenFacade(funded());
  assert.throws(() => facade.execute('send', { ...send, idempotencyKey: null }), e => e.code === 'MISSING_IDEM');
  assert.throws(() => facade.execute('mint', { idempotencyKey: 'mint' }), e => e.code === 'UNKNOWN_ACTION');
});
test('send settles and announces one receipt with two final account balances', () => {
  const facade = createTokenFacade(funded()), seen = [];
  facade.on('receipt', event => seen.push(event)); facade.on('balance-changed', event => seen.push(event));
  const receipt = facade.execute('send', send);
  assert.equal(facade.balance('u:alice'), 10_000_000 - 2500); assert.equal(facade.balance('u:bob'), 2500);
  assert.deepEqual(seen.map(e => e.type), ['balance-changed', 'balance-changed', 'receipt']);
  assert.equal(seen[2].txId, receipt.id); assert.equal(seen[2].logicalTick, receipt.tick);
  assert.deepEqual(seen.slice(0, 2).map(e => e.delta), [-2500, 2500]);
});
test('tip replay returns the original receipt and emits no duplicate wave', () => {
  const facade = createTokenFacade(funded()); let count = 0; facade.on('receipt', () => count++);
  const first = facade.execute('tip', send), second = facade.execute('tip', send);
  assert.equal(first, second); assert.equal(count, 1); assert.equal(facade.balance('u:bob'), 2500);
});
test('stake and withdrawal use shared vault balances and sealed receipt events', () => {
  const engine = funded(), facade = createTokenFacade(engine), seen = [];
  facade.on('receipt', e => seen.push(e));
  const stake = facade.execute('stake', { from: 'u:alice', amountFluff: 20_000, idempotencyKey: 'stake' });
  assert.equal(engine.balance('sys:vault', 'TUMBO'), 20_000); assert.equal(seen.length, 1); assert.equal(seen[0].txId, stake.id);
  facade.execute('unstake', { positionId: stake.position.id, owner: 'u:alice', idempotencyKey: 'exit' });
  assert.equal(facade.balance('u:alice'), 10_000_000); assert.equal(engine.balance('sys:vault', 'TUMBO'), 0);
});
test('failed transfer changes no balances, journals or event count', () => {
  const engine = funded(), facade = createTokenFacade(engine); let count = 0; facade.on('receipt', () => count++);
  const before = engine.ledger.journalCount();
  assert.throws(() => facade.execute('send', { ...send, from: 'u:bob', to: 'u:alice' }), /insufficient/);
  assert.equal(engine.ledger.journalCount(), before); assert.equal(facade.balance('u:alice'), 10_000_000); assert.equal(count, 0);
});
test('unsubscribe and disposal remove facade observers', () => {
  const engine = funded(), facade = createTokenFacade(engine); let count = 0;
  const off = facade.on('receipt', () => count++); off(); facade.execute('send', send); assert.equal(count, 0);
  facade.on('receipt', () => count++); facade.dispose(); engine.faucet('u:carl', 'TUMBO', 10, { idempotencyKey: 'later' }); assert.equal(count, 0);
  assert.throws(() => facade.on('explode', () => {}), e => e.code === 'UNKNOWN_EVENT');
});
test('direct wallet sends reach facade observers once, including across prior history', () => {
  const engine = funded(), wallet = new TumboUserLedger(engine), facade = createTokenFacade(wallet); let count = 0;
  facade.on('receipt', () => count++); wallet.send(send); wallet.send(send); assert.equal(count, 1);
  assert.equal(facade.balance('u:bob'), 2500); assert.equal(engine.ledger.verifyChain().ok, true);
});
test('multiple facades never dispatch duplicate document event waves', () => {
  const savedDoc = globalThis.document, savedEvent = globalThis.CustomEvent, events = [];
  globalThis.document = { dispatchEvent: e => events.push(e.detail) }; globalThis.CustomEvent = class { constructor(type, { detail }) { this.type = type; this.detail = detail; } };
  try {
    const engine = funded(); createTokenFacade(engine); createTokenFacade(engine); events.length = 0;
    createTokenFacade(engine).execute('send', send);
    assert.equal(events.filter(e => e.type === 'receipt').length, 1);
    assert.equal(events.filter(e => e.type === 'balance-changed').length, 2);
  } finally { globalThis.document = savedDoc; globalThis.CustomEvent = savedEvent; }
});
test('quote object execute uses the original engine and conserved multi-asset journal', () => {
  const engine = funded(), facade = createTokenFacade(engine);
  const quote = facade.quote({ action: 'buy', from: 'u:alice', fromAsset: 'TUMBO', toAsset: 'sMIMAS', amountIn: 1000 });
  const receipt = facade.execute(quote, { idempotencyKey: 'buy' });
  assert.equal(receipt.tithe, 1); assert.equal(facade.balance('u:alice', 'sMIMAS'), 10_000); assert.equal(facade.verifyChain().ok, true);
});
