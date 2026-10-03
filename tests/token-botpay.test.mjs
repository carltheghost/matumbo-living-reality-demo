import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenEngine, TumboUserLedger, CONFIG } from '../src/domains/token.js';
import { createTokenEngine as createVersionedEngine } from '../src/domains/token.js?v=20261003-skin360';
import { createTokenFacade } from '../src/domains/token-facade.js';
import { serializeTokenEngine, loadTokenEngine } from '../src/domains/token-store.js';
import { BotPay, Pay402, BOT_CHALLENGE_TTL_TICKS, BOT_SPEND_CAP_FLUFF } from '../src/domains/token-botpay.js';

function setup(fluff = 50_000, options = {}) {
  const engine = createTokenEngine();
  const pay = new BotPay(engine, options);
  pay.registerBot('courier'); pay.registerBot('gallery');
  if (fluff) engine.faucet('b:courier', 'TUMBO', fluff, { idempotencyKey: 'setup:fund' });
  return { engine, pay, authToken: pay.issueToken('courier'), serviceToken: pay.issueToken('gallery') };
}
function challenge(pay, args = {}) {
  try { pay.request({ fromBot: 'courier', service: 'gallery', resource: 'cube.render', ...args }); }
  catch (error) { assert.ok(error instanceof Pay402); assert.equal(error.code, 402); return error.challenge; }
  assert.fail('priced requests must issue a local 402 challenge');
}
function assertCode(fn, code) { assert.throws(fn, error => error.code === code); }
function snapshot(engine) {
  return { tick: engine.ledger.tick, count: engine.ledger.journalCount(), balances: engine.ledger.accounts().map(row => ({ ...row, balance: engine.balance(row.account, row.asset) })) };
}
function advance(engine, count) {
  for (let i = 0; i < count; i++) engine.ledger.post([{ account: 'u:clock', asset: 'TUMBO', amount: 0 }], {
    idempotencyKey: `clock:${engine.ledger.tick}`, action: 'presence',
  });
}

test('BotPay accepts the canonical engine, facade, and wallet without another balance owner', () => {
  const engine = createTokenEngine(), wallet = new TumboUserLedger(engine), facade = createTokenFacade(engine);
  for (const owner of [engine, wallet, facade]) {
    const pay = new BotPay(owner);
    assert.equal(pay.engine, engine); assert.equal(pay.ledger, engine.ledger);
    assert.throws(() => { pay.engine = createTokenEngine(); }, TypeError);
  }
  assert.throws(() => new BotPay({ ledger: engine.ledger }), /canonical QuoteEngine/);
  facade.dispose();
});

test('plain and cache-versioned canonical owners share the same payment contract', () => {
  for (const createEngine of [createTokenEngine, createVersionedEngine]) {
    const engine = createEngine(), pay = new BotPay({ engine });
    pay.registerBot('courier'); pay.registerBot('gallery');
    engine.faucet('b:courier', 'TUMBO', 40, { idempotencyKey: 'version:fund' });
    const ch = challenge(pay), receipt = pay.pay({ challengeId: ch.challengeId, authToken: pay.issueToken('courier') });
    assert.equal(pay.engine, engine); assert.equal(pay.ledger, engine.ledger);
    assert.equal(engine.balance('b:courier', 'TUMBO'), 20);
    assert.equal(engine.balance('b:gallery', 'TUMBO'), 20);
    assert.equal(engine.ledger.verifyReceipt(receipt.id).ok, true);
    assert.equal(pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash }).status, 200);
    assertCode(() => pay.pay({ challengeId: ch.challengeId, authToken: pay.issueToken('courier') }), 'UNKNOWN_CHALLENGE');
  }
});

test('partial owner APIs are rejected before retaining an engine or mutating its journal', () => {
  const engine = createTokenEngine(), before = snapshot(engine);
  const missingEmit = Object.create(engine); missingEmit._emit = undefined;
  const missingReplay = Object.create(engine); missingReplay.ledger = { ...engine.ledger, post: engine.ledger.post };
  for (const owner of [{ ledger: engine.ledger, balance: engine.balance }, { engine: missingEmit }, { _engine: missingReplay }]) {
    assert.throws(() => new BotPay(owner), /canonical QuoteEngine/);
  }
  assert.deepEqual(snapshot(engine), before);
});

test('registration is unfunded by default and local tokens do not enter snapshots', () => {
  const engine = createTokenEngine(), pay = new BotPay(engine), tick = engine.ledger.tick;
  assert.deepEqual(pay.registerBot('constructor'), { botId: 'constructor', accountId: 'b:constructor' });
  assert.equal(engine.balance('b:constructor', 'TUMBO'), 0);
  assert.equal(engine.ledger.tick, tick);
  const token = pay.issueToken('constructor');
  assert.match(token, /^simtok_/); assert.equal(pay.issueToken('constructor'), token);
  assert.equal(serializeTokenEngine(engine).includes(token), false);
  assertCode(() => pay.registerBot('constructor'), 'BOT_EXISTS');
  assertCode(() => pay.issueToken('missing'), 'UNKNOWN_BOT');
});

test('denied auto funding leaves no account/token/journal and registration remains usable', () => {
  const engine = createTokenEngine(), pay = new BotPay(engine), before = snapshot(engine);
  assertCode(() => pay.registerBot('greedy', { initialTumbo: 1000, gate: 'system' }), 'GATE_DENIED');
  assert.deepEqual(snapshot(engine), before);
  assertCode(() => pay.issueToken('greedy'), 'UNKNOWN_BOT');
  assert.throws(() => { pay.allowSimulationFunding = true; }, TypeError);
  pay.registerBot('greedy'); assert.equal(engine.balance('b:greedy', 'TUMBO'), 0);
});

test('invalid bot IDs and unsafe initial amounts fail before registration mutates the engine', () => {
  const engine = createTokenEngine(), pay = new BotPay(engine, { allowSimulationFunding: true }), before = snapshot(engine);
  for (const bot of ['', '__proto__', 'sys:faucet', 'bot with spaces', 1]) assertCode(() => pay.registerBot(bot), 'BAD_BOT');
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assertCode(() => pay.registerBot('retry', { initialTumbo: amount }), 'BAD_AMOUNT');
  assert.deepEqual(snapshot(engine), before);
  pay.registerBot('retry'); assert.ok(pay.issueToken('retry'));
});

test('explicit local funding posts exact canonical fluff once and faucet failure is atomic', () => {
  const engine = createTokenEngine(), pay = new BotPay(engine, { allowSimulationFunding: true });
  const faucet = engine.balance('sys:faucet', 'TUMBO');
  pay.registerBot('funded', { initialTumbo: 7 });
  assert.equal(engine.balance('b:funded', 'TUMBO'), 7000);
  assert.equal(engine.balance('sys:faucet', 'TUMBO'), faucet - 7000);
  assert.equal(engine.ledger.verifyChain().ok, true);
  const poor = createTokenEngine({ ...CONFIG, faucetTumbo: 50 }), poorPay = new BotPay(poor, { allowSimulationFunding: true }), before = snapshot(poor);
  assert.throws(() => poorPay.registerBot('retry', { initialTumbo: 1 }), /insufficient funds/);
  assert.deepEqual(snapshot(poor), before); assertCode(() => poorPay.issueToken('retry'), 'UNKNOWN_BOT');
  poorPay.registerBot('retry');
});

test('constructor rejects unsafe pricing, invalid funding flags, and TTLs below 100', () => {
  const engine = createTokenEngine();
  for (const price of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assertCode(() => new BotPay(engine, { pricing: { render: price } }), 'BAD_PRICE');
  for (const ttl of [99, 0, 100.5, Infinity]) assert.throws(() => new BotPay(engine, { challengeTtlTicks: ttl }), /at least 100/);
  assert.throws(() => new BotPay(engine, { allowSimulationFunding: 'yes' }), /boolean/);
  const pay = new BotPay(engine, { challengeTtlTicks: 200 }); pay.registerBot('courier');
  assert.equal(challenge(pay).expiresTick - engine.ledger.tick, 200);
});

test('only the service token can override safe prices; overrides survive canonical snapshots', () => {
  const { engine, pay, authToken, serviceToken } = setup();
  assertCode(() => pay.setPrice({ service: 'gallery', resource: 'cube.render', priceFluff: 12, authToken }), 'BAD_AUTH');
  assert.equal(engine.botPricing, undefined);
  for (const priceFluff of [-1, 0.1, Infinity, Number.MAX_SAFE_INTEGER + 1]) assertCode(() => pay.setPrice({ service: 'gallery', resource: 'cube.render', priceFluff, authToken: serviceToken }), 'BAD_PRICE');
  pay.setPrice({ service: 'gallery', resource: 'cube.render', priceFluff: 12, authToken: serviceToken });
  assert.equal(pay.priceFor('gallery', 'cube.render'), 12);
  const restored = loadTokenEngine(serializeTokenEngine(engine));
  assert.equal(new BotPay(restored).priceFor('gallery', 'cube.render'), 12);
  assert.equal(serializeTokenEngine(engine).includes(serviceToken), false);
});

test('unpriced resources are free without touching balances or inheriting prototype values', () => {
  const { engine, pay } = setup(), before = snapshot(engine), params = { nested: { view: 1 } };
  const result = pay.request({ fromBot: 'courier', service: 'gallery', resource: 'constructor', params });
  assert.equal(result.free, true); params.nested.view = 2; assert.equal(result.params.nested.view, 1);
  assert.deepEqual(snapshot(engine), before);
  assertCode(() => pay.request({ fromBot: 'missing', service: 'gallery', resource: 'free' }), 'UNKNOWN_BOT');
});

test('challenge terms and nested params are copied and immutable, with at least 100 canonical ticks', () => {
  const { engine, pay } = setup(), params = { nested: { frame: 1 } };
  const ch = challenge(pay, { params });
  assert.equal(ch.expiresTick - engine.ledger.tick, BOT_CHALLENGE_TTL_TICKS);
  params.nested.frame = 2; assert.equal(ch.params.nested.frame, 1);
  assert.throws(() => { ch.priceFluff = 0; }, TypeError);
  assert.throws(() => { ch.params.nested.frame = 3; }, TypeError);
  assertCode(() => pay.request({ fromBot: 'courier', service: 'courier', resource: 'cube.render' }), 'SELF_PAYMENT');
});

test('request validates resource/params without creating accounts or posting funds', () => {
  const { engine, pay } = setup(), before = snapshot(engine);
  for (const resource of ['', '\n', 'x'.repeat(161), 1]) assertCode(() => pay.request({ fromBot: 'courier', service: 'gallery', resource }), 'BAD_RESOURCE');
  const cycle = {}; cycle.self = cycle;
  for (const params of [null, [], cycle, { text: 'x'.repeat(8200) }]) assertCode(() => pay.request({ fromBot: 'courier', service: 'gallery', resource: 'cube.render', params }), 'BAD_PARAMS');
  assert.deepEqual(snapshot(engine), before);
});

test('402 payment and fulfillment use one canonical journal, exact balances, nonce, and facade events', () => {
  const { engine, pay, authToken } = setup(), facade = createTokenFacade(engine), events = [];
  facade.on('receipt', event => events.push(event));
  const ch = challenge(pay), tick = engine.ledger.tick;
  const receipt = pay.pay({ challengeId: ch.challengeId, authToken });
  assert.equal(receipt.tick, tick + 1); assert.equal(receipt.action, 'tip');
  assert.equal(receipt.memo, `x402:${ch.nonce}`);
  assert.equal(receipt.links.botPayChallenge, ch.challengeId);
  assert.deepEqual(receipt.postings, [
    { account: 'b:courier', asset: 'TUMBO', amount: -20 },
    { account: 'b:gallery', asset: 'TUMBO', amount: 20 },
  ]);
  assert.equal(engine.balance('b:courier', 'TUMBO'), 49_980); assert.equal(facade.balance('b:gallery', 'TUMBO'), 20);
  assert.equal(events.length, 1); assert.equal(events[0].receipt.id, receipt.id);
  assert.equal(engine.ledger.verifyReceipt(receipt.id).ok, true); assert.equal(engine.ledger.verifyChain().ok, true);
  const fulfilled = pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash, handler: paid => ({ payment: paid.paymentTx, frame: 1 }) });
  assert.equal(fulfilled.status, 200); assert.deepEqual(fulfilled.result, { payment: receipt.id, frame: 1 });
  assert.equal(serializeTokenEngine(engine).includes(authToken), false); facade.dispose();
});

test('bad auth, insufficient funds, and unpaid fulfillment preserve the pending challenge and journal', () => {
  const { engine, pay, authToken } = setup(0), ch = challenge(pay), before = snapshot(engine);
  assertCode(() => pay.pay({ challengeId: ch.challengeId, authToken: 'wrong' }), 'BAD_AUTH');
  assertCode(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: 'none' }), 'UNPAID');
  assert.throws(() => pay.pay({ challengeId: ch.challengeId, authToken }), /insufficient funds/);
  assert.deepEqual(snapshot(engine), before);
  engine.faucet('b:courier', 'TUMBO', 20, { idempotencyKey: 'retry:fund' });
  const receipt = pay.pay({ challengeId: ch.challengeId, authToken });
  assert.equal(pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash }).status, 200);
});

test('double/reentrant payment cannot debit twice or bypass the canonical spend cap', () => {
  const { engine, pay, authToken } = setup(), ch = challenge(pay), attempts = [];
  const off = engine.ledger.onCommit(row => { if (row.action === 'tip') {
    try { pay.pay({ challengeId: ch.challengeId, authToken }); } catch (error) { attempts.push(error.code); }
  } });
  const receipt = pay.pay({ challengeId: ch.challengeId, authToken }), before = snapshot(engine);
  off(); assert.deepEqual(attempts, ['NONCE_REUSED']);
  assertCode(() => pay.pay({ challengeId: ch.challengeId, authToken }), 'NONCE_REUSED');
  assert.deepEqual(snapshot(engine), before); assert.equal(engine.balance('b:gallery', 'TUMBO'), 20);
  assert.equal(pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash }).status, 200);
});

test('receipt mismatch and bad handler do not consume a correctly paid challenge', () => {
  const { engine, pay, authToken } = setup(), ch = challenge(pay), receipt = pay.pay({ challengeId: ch.challengeId, authToken }), before = snapshot(engine);
  assertCode(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: 'wrong' }), 'RECEIPT_MISMATCH');
  assertCode(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash, handler: 1 }), 'BAD_HANDLER');
  assert.deepEqual(snapshot(engine), before);
  pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash });
  assertCode(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash }), 'UNKNOWN_CHALLENGE');
});

test('fulfillment consumes before invoking a reentrant or throwing local handler', () => {
  const { pay, authToken } = setup(), ch = challenge(pay), receipt = pay.pay({ challengeId: ch.challengeId, authToken });
  assert.throws(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash, handler: () => {
    assertCode(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash }), 'UNKNOWN_CHALLENGE');
    throw new Error('local handler failed');
  } }), /local handler failed/);
  assertCode(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash }), 'UNKNOWN_CHALLENGE');
});

test('the 10,000 fluff spend cap survives a second adapter and a canonical snapshot reload', () => {
  const { engine, pay, authToken, serviceToken } = setup();
  pay.setPrice({ service: 'gallery', resource: 'cube.render', priceFluff: 6000, authToken: serviceToken });
  const first = challenge(pay); pay.pay({ challengeId: first.challengeId, authToken });
  for (const owner of [engine, loadTokenEngine(serializeTokenEngine(engine))]) {
    const next = new BotPay(owner); next.registerBot('courier');
    const ch = challenge(next), before = snapshot(owner);
    assertCode(() => next.pay({ challengeId: ch.challengeId, authToken: next.issueToken('courier') }), 'SPEND_CAP');
    assert.deepEqual(snapshot(owner), before);
  }
  assert.equal(BOT_SPEND_CAP_FLUFF, 10_000);
});

test('spend cap has an exact rolling 10-tick boundary and permits the full cap', () => {
  const { engine, pay, authToken, serviceToken } = setup();
  pay.setPrice({ service: 'gallery', resource: 'cube.render', priceFluff: 10_000, authToken: serviceToken });
  const first = challenge(pay); pay.pay({ challengeId: first.challengeId, authToken });
  const second = challenge(pay); advance(engine, 8);
  assertCode(() => pay.pay({ challengeId: second.challengeId, authToken }), 'SPEND_CAP');
  advance(engine, 1); const receipt = pay.pay({ challengeId: second.challengeId, authToken });
  assert.equal(receipt.postings[1].amount, 10_000);
});

test('expired/final-tick payments fail without charging and paid challenges re-check expiry', () => {
  const { engine, pay, authToken } = setup(), ch = challenge(pay);
  advance(engine, 99); const before = snapshot(engine);
  assertCode(() => pay.pay({ challengeId: ch.challengeId, authToken }), 'CHALLENGE_EXPIRED');
  assert.deepEqual(snapshot(engine), before);
  const fresh = challenge(pay), receipt = pay.pay({ challengeId: fresh.challengeId, authToken });
  advance(engine, 99);
  assertCode(() => pay.fulfill({ challengeId: fresh.challengeId, receiptHash: receipt.hash }), 'CHALLENGE_EXPIRED');
});

test('reversed payment remains a valid journal but cannot fulfill a resource', () => {
  const { engine, pay, authToken } = setup(), ch = challenge(pay), receipt = pay.pay({ challengeId: ch.challengeId, authToken });
  engine.reverse({ journalId: receipt.id });
  assert.equal(engine.balance('b:courier', 'TUMBO'), 50_000); assert.equal(engine.balance('b:gallery', 'TUMBO'), 0);
  assert.equal(engine.ledger.verifyChain().ok, true);
  assertCode(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash }), 'PAYMENT_REVERSED');
});

test('tampering with the canonical receipt chain fails fulfillment without running the handler', () => {
  const { engine, pay, authToken } = setup(), ch = challenge(pay), receipt = pay.pay({ challengeId: ch.challengeId, authToken });
  const index = engine.ledger._journals.findIndex(row => row.id === receipt.id);
  engine.ledger._journals[index] = { ...receipt, memo: 'tampered' };
  let calls = 0;
  assertCode(() => pay.fulfill({ challengeId: ch.challengeId, receiptHash: receipt.hash, handler: () => { calls++; } }), 'INVALID_RECEIPT');
  assert.equal(calls, 0);
});
