/** Replay/event regressions for the unified local token owner. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenEngine, TumboUserLedger, quoteHash, receiptChainHash } from '../src/domains/token.js';
import { createTokenFacade } from '../src/domains/token-facade.js';
import { bootToken } from '../src/domains/token-boot.js';
import { TokenActivityLedger } from '../src/domains/token-activity.js';
import { createTokenVaultLedger } from '../src/domains/token-vault.js';
import { serializeTokenEngine, loadTokenEngine } from '../src/domains/token-store.js';
const funded = () => { const e = createTokenEngine(); e.faucet('u:alice', 'TUMBO', 1_000_000, { idempotencyKey: 'fund' }); return e; };
const send = { from: 'u:alice', to: 'u:bob', amountFluff: 1000, idempotencyKey: 'send' };
test('direct wallet send bypassing facade execute produces one final event wave', () => {
  const engine = funded(), wallet = new TumboUserLedger(engine), facade = createTokenFacade(wallet); const seen = [];
  facade.on('receipt', e => seen.push(e)); facade.on('balance-changed', e => seen.push(e)); wallet.send(send);
  assert.equal(seen.filter(e => e.type === 'receipt').length, 1); assert.equal(seen.filter(e => e.type === 'balance-changed').length, 2);
});
test('vault open and explicit exit replay announce sealed canonical receipts once', () => {
  const engine = funded(), facade = createTokenFacade(engine), seen = []; facade.on('receipt', e => seen.push(e));
  const open = facade.execute('stake', { from: 'u:alice', amountFluff: 100_000, idempotencyKey: 'stake' });
  const args = { positionId: open.position.id, owner: 'u:alice', idempotencyKey: 'exit' };
  const first = facade.execute('unstake', args), second = facade.execute('unstake', args);
  assert.equal(first, second); assert.equal(seen.length, 2); assert.equal(seen[0].txId, open.id); assert.equal(seen[1].txId, first.id);
  assert.equal(engine.balance('sys:vault', 'TUMBO'), 0); assert.equal(facade.balance('u:alice'), 1_000_000);
});
test('boot funds visitor and guide once on the same canonical owner', () => {
  const engine = createTokenEngine(), first = bootToken({ engine, persist: false, install: false });
  const count = engine.ledger.journalCount(), second = bootToken({ engine, persist: false, install: false });
  assert.equal(first, second); assert.equal(first.engine, engine); assert.equal(first.balance('u:visitor'), 1_000_000); assert.equal(first.balance('b:guide'), 1_000_000); assert.equal(engine.ledger.journalCount(), count);
  let events = 0; first.on('receipt', () => events++); first.execute('send', { ...send, from: 'u:visitor', to: 'b:guide' }); assert.equal(events, 1);
});
test('faucet retry returns original without another credit or event', () => {
  const engine = funded(); let events = 0; engine.on('receipt', () => events++);
  const first = engine.faucet('u:bob', 'TUMBO', 2000, { idempotencyKey: 'drip' }), second = engine.faucet('u:bob', 'TUMBO', 2000, { idempotencyKey: 'drip' });
  assert.equal(first, second); assert.equal(events, 1); assert.equal(engine.balance('u:bob', 'TUMBO'), 2000);
});
for (const [field, value] of [['to', 'u:other'], ['amount', 3000], ['asset', 'sMIMAS']]) test(`faucet reused key binds ${field}`, () => {
  const engine = funded(); engine.faucet('u:bob', 'TUMBO', 2000, { idempotencyKey: 'drip' }); const args = { to: 'u:bob', amount: 2000, asset: 'TUMBO', [field]: value };
  assert.throws(() => engine.faucet(args.to, args.asset, args.amount, { idempotencyKey: 'drip' }), e => e.code === 'IDEM_MISMATCH');
});
test('activity presence and ribbon are bounded free metadata, with safe explicit retries', () => {
  const activity = new TokenActivityLedger({ engine: funded() });
  const first = activity.act('presence', { account: 'u:alice', day: 1 }, 'presence'); assert.equal(activity.act('presence', { account: 'u:alice', day: 1 }, 'presence'), first);
  assert.throws(() => activity.act('presence', { account: 'u:alice', day: 1 }, 'other'), e => e.code === 'PRESENCE_ALREADY_RECORDED');
  const ribbon = activity.act('ribbon-claim', { account: 'u:alice' }, 'ribbon'); assert.equal(activity.act('ribbon-claim', { account: 'u:alice' }, 'ribbon'), ribbon);
  assert.throws(() => activity.act('ribbon-claim', { account: 'u:alice' }, 'ribbon-again'), e => e.code === 'RIBBON_ALREADY_CLAIMED');
  assert.equal(activity.balance('u:alice'), 1_000_000); assert.equal(receiptChainHash(ribbon), ribbon.hash);
});
test('vault release with another key remains closed and failed release is atomic', () => {
  const engine = funded(), vault = createTokenVaultLedger({ engine });
  const open = vault.deposit({ from: 'u:alice', amountFluff: 5000, idempotencyKey: 'deposit' });
  vault.withdraw({ positionId: open.position.id, owner: 'u:alice', idempotencyKey: 'release' }); const count = engine.ledger.journalCount();
  assert.throws(() => vault.withdraw({ positionId: open.position.id, idempotencyKey: 'again' }), /closed|cannot/); assert.equal(engine.ledger.journalCount(), count);
});
test('vault positions and replay ownership survive canonical snapshot roundtrip', () => {
  const engine = funded(), vault = createTokenVaultLedger({ engine });
  const opened = vault.stake({ from: 'u:alice', amountFluff: 100_000, idempotencyKey: 'stake' });
  vault.advanceTick({ ticks: 10, idempotencyKey: 'clock' });
  const loaded = loadTokenEngine(serializeTokenEngine(engine)), restored = createTokenVaultLedger({ engine: loaded });
  assert.equal(restored.openPositions()[0].id, opened.position.id); assert.equal(restored.tick(), 10);
  const first = restored.unstake({ positionId: opened.position.id, owner: 'u:alice', idempotencyKey: 'exit' });
  assert.equal(first.extra.rewardPaidFluff, 500); assert.equal(loaded.balance('u:alice', 'TUMBO'), 1_000_500);
  const secondLoaded = loadTokenEngine(serializeTokenEngine(loaded)), secondVault = createTokenVaultLedger({ engine: secondLoaded });
  assert.equal(secondVault.unstake({ positionId: opened.position.id, owner: 'u:alice', idempotencyKey: 'exit' }).id, first.id);
  assert.equal(secondLoaded.balance('u:alice', 'TUMBO'), 1_000_500);
});
test('wallet lock survives reload, while a reversed lock cannot release someone else’s principal', () => {
  const engine = funded(), wallet = new TumboUserLedger(engine), lock = wallet.lock({ acct: 'u:alice', amountFluff: 5000 });
  const restored = loadTokenEngine(serializeTokenEngine(engine)), restoredWallet = new TumboUserLedger(restored);
  restoredWallet.unlock(lock.id); assert.equal(restored.balance('u:alice', 'TUMBO'), 1_000_000);
  const another = wallet.lock({ acct: 'u:alice', amountFluff: 10_000 }); engine.reverse({ journalId: lock.id });
  const before = engine.balance('sys:vault', 'TUMBO'); assert.throws(() => wallet.unlock(lock.id), /reversed/); assert.equal(engine.balance('sys:vault', 'TUMBO'), before); assert.equal(before, another.amountFluff);
});
test('wallet replay after reload suppresses a second event wave', () => {
  const engine = funded(); new TumboUserLedger(engine).send(send); const loaded = loadTokenEngine(serializeTokenEngine(engine));
  let count = 0; loaded.on('receipt', () => count++); const receipt = new TumboUserLedger(loaded).send(send);
  assert.equal(receipt.duplicate, true); assert.equal(count, 0); assert.equal(loaded.balance('u:bob', 'TUMBO'), 1000);
});
test('cancel replay binds quote identity rather than just a reused key', () => {
  const engine = funded(), args = { action: 'buy', from: 'u:alice', fromAsset: 'TUMBO', toAsset: 'sMIMAS', amountIn: 1000 };
  const first = engine.quote(args), second = engine.quote(args); engine.cancelQuote(first.id, { idempotencyKey: 'cancel' });
  assert.throws(() => engine.cancelQuote(second.id, { idempotencyKey: 'cancel' }), e => e.code === 'IDEM_MISMATCH'); assert.equal(engine._cancelledQuoteIds.has(second.id), false);
});
test('quote execution replay rejects another quote or rehashed modified intent', () => {
  const engine = funded(), args = { action: 'buy', from: 'u:alice', fromAsset: 'TUMBO', toAsset: 'sMIMAS', amountIn: 1000 };
  const quote = engine.quote(args); engine.execute(quote, { idempotencyKey: 'trade' });
  const altered = { ...quote, amountOut: quote.amountOut + 1 }; altered.hash = quoteHash(altered);
  assert.throws(() => engine.execute(altered, { idempotencyKey: 'trade' }), e => e.code === 'IDEM_MISMATCH');
  assert.throws(() => engine.execute(engine.quote(args), { idempotencyKey: 'trade' }), e => e.code === 'IDEM_MISMATCH');
});
test('activity tick overflow leaves the old clock and chain unchanged', () => {
  const activity = new TokenActivityLedger({ engine: funded() }); activity.advanceTicks(Number.MAX_SAFE_INTEGER - activity.tick);
  assert.throws(() => activity.advanceTicks(1)); assert.equal(activity.tick, Number.MAX_SAFE_INTEGER); assert.equal(activity.verifyChain().ok, true);
});
test('an activity commit after clock overflow is rejected before its journal posts', () => {
  const engine = funded(), activity = new TokenActivityLedger({ engine }); activity.advanceTicks(Number.MAX_SAFE_INTEGER - activity.tick);
  const before = serializeTokenEngine(engine);
  assert.throws(() => activity.act('presence', { account: 'u:alice', day: 1 }, 'overflow'));
  assert.equal(serializeTokenEngine(engine), before);
});
test('activity replay restores external wallet history and bounded daily claims', () => {
  const engine = funded(), wallet = new TumboUserLedger(engine), activity = new TokenActivityLedger({ engine });
  wallet.lock({ acct: 'u:alice', amountFluff: 5000 });
  const first = activity.drip('u:alice', 'TUMBO', 'drip-day-1'); activity.act('presence', { account: 'u:alice', day: 1 }, 'day-1');
  activity.advanceDay(); activity.drip('u:alice', 'TUMBO', 'drip-day-2'); activity.act('presence', { account: 'u:alice', day: 2 }, 'day-2');
  assert.equal(activity.drip('u:alice', 'TUMBO', 'drip-day-1'), first);
  const loaded = loadTokenEngine(serializeTokenEngine(engine)), restored = new TokenActivityLedger({ engine: loaded });
  assert.equal(restored.day, 2); assert.equal(restored.receipts().filter(row => row.action === 'lock').length, 1);
  assert.throws(() => restored.drip('u:alice', 'TUMBO', 'another-day-2'), e => e.code === 'FAUCET_COOLDOWN');
  assert.equal(restored.act('presence', { account: 'u:alice', day: 1 }, 'day-1').id, activity.act('presence', { account: 'u:alice', day: 1 }, 'day-1').id);
});
