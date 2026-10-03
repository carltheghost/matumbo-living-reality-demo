/** Canonical ledger regressions. Prototype gate/oracle APIs are retired;
 * delivery, vault and BotPay behavior have dedicated domain suites. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTokenEngine, CONFIG, TumboUserLedger, quoteHash, receiptChainHash, mulDivFloor, fmt } from '../src/domains/token.js';
import { createTokenVaultLedger } from '../src/domains/token-vault.js';
import { TokenActivityLedger } from '../src/domains/token-activity.js';
import { TokenGamification } from '../src/domains/token-gamification.js';
import { sha256Hex } from '../src/domains/token-sha256.js';
import { serializeTokenEngine, loadTokenEngine, saveFile, loadFile, LedgerStore, TOKEN_STORAGE_KEY } from '../src/domains/token-store.js';
const funded = () => { const engine = createTokenEngine(); engine.faucet('u:alice', 'TUMBO', 10_000_000, { idempotencyKey: 'fund' }); return engine; };
const quote = engine => engine.quote({ action: 'buy', from: 'u:alice', fromAsset: 'TUMBO', toAsset: 'sMIMAS', amountIn: 1000 });
const totals = engine => Object.fromEntries(['TUMBO', 'sMIMAS'].map(asset => [asset, engine.ledger.accounts().filter(a => a.asset === asset && a.account !== 'sys:issuance').reduce((n, a) => n + engine.balance(a.account, asset), 0)]));
test('SHA-256 known vectors remain a separate corruption-detection utility', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
test('genesis derives both conserved supplies from canonical config', () => {
  const engine = createTokenEngine(); assert.deepEqual(totals(engine), CONFIG.supply);
  assert.equal(engine.balance('sys:void', 'TUMBO'), 0); assert.equal(engine.balance('sys:issuance', 'TUMBO'), -CONFIG.supply.TUMBO); assert.equal(engine.ledger.verifyChain().ok, true);
});
test('insufficient send leaves balances, account inventory, clock and journal intact', () => {
  const engine = funded(), before = serializeTokenEngine(engine), accounts = engine.ledger.accounts();
  assert.throws(() => new TumboUserLedger(engine).send({ from: 'u:empty', to: 'u:new', amountFluff: 100, idempotencyKey: 'fail' }), /insufficient/);
  assert.equal(serializeTokenEngine(engine), before); assert.deepEqual(engine.ledger.accounts(), accounts);
  new TumboUserLedger(engine).send({ from: 'u:alice', to: 'u:bob', amountFluff: 100, idempotencyKey: 'good' }); assert.equal(engine.balance('u:bob', 'TUMBO'), 100);
});
test('every account leg applies atomically after the complete balanced journal validates', () => {
  const engine = funded(); const count = engine.ledger.journalCount();
  assert.throws(() => engine.ledger.post([{ account: 'u:alice', asset: 'TUMBO', amount: -5 }, { account: 'u:bob', asset: 'TUMBO', amount: 4 }], { idempotencyKey: 'bad' }), /sum/);
  assert.equal(engine.ledger.journalCount(), count); assert.equal(engine.balance('u:alice', 'TUMBO'), 10_000_000);
});
test('low-level replay binds memo, action, account, asset and exact posting amounts', () => {
  const engine = funded(), postings = [{ account: 'u:alice', asset: 'TUMBO', amount: -10 }, { account: 'u:bob', asset: 'TUMBO', amount: 10 }], options = { idempotencyKey: 'same', action: 'send', memo: 'one' };
  const first = engine.ledger.post(postings, options); assert.equal(engine.ledger.post(postings, options), first);
  for (const change of [{ memo: 'two' }, { action: 'tip' }, { authority: 'internal' }]) assert.throws(() => engine.ledger.post(postings, { ...options, ...change }), e => e.code === 'IDEM_MISMATCH');
  assert.throws(() => engine.ledger.post([{ ...postings[0], amount: -11 }, { ...postings[1], amount: 11 }], options), e => e.code === 'IDEM_MISMATCH');
});
test('reverse restores an unspent send without editing earlier receipts', () => {
  const engine = funded(); const wallet = new TumboUserLedger(engine), send = wallet.send({ from: 'u:alice', to: 'u:bob', amountFluff: 1000, idempotencyKey: 'send' });
  const old = engine.ledger._journals.slice(); const reversal = engine.reverse({ journalId: send.id });
  assert.equal(engine.balance('u:alice', 'TUMBO'), 10_000_000); assert.deepEqual(engine.ledger._journals.slice(0, old.length), old); assert.equal(reversal.links.reverses, send.id); assert.equal(engine.ledger.verifyChain().ok, true);
});
test('reverse fails atomically when recipient already spent the funds', () => {
  const engine = funded(), wallet = new TumboUserLedger(engine); wallet.send({ from: 'u:alice', to: 'u:bob', amountFluff: 1000, idempotencyKey: 'first' }); wallet.send({ from: 'u:bob', to: 'u:carl', amountFluff: 1000, idempotencyKey: 'spent' });
  const before = serializeTokenEngine(engine); assert.throws(() => engine.reverse({ idempotencyKey: 'first' }), /insufficient/); assert.equal(serializeTokenEngine(engine), before);
});
test('caller cannot forge a quote by recomputing its public hash', () => {
  const engine = funded(), original = quote(engine), forged = { ...original, amountOut: original.amountOut * 100 };
  forged.hash = quoteHash(forged); const before = serializeTokenEngine(engine);
  assert.throws(() => engine.execute(forged), /issued|tampered/); assert.equal(serializeTokenEngine(engine), before);
});
test('an honest quote issued by another engine has no local execution authority', () => {
  const owner = funded(), other = funded(); const offered = quote(owner);
  assert.throws(() => other.execute(offered), /issued/); assert.equal(other.balance('u:alice', 'sMIMAS'), 0);
});
test('market rate config is bounded, validated and independently frozen', () => {
  for (const price of [{ num: 0, den: 1 }, { num: 1.1, den: 1 }, { num: 1, den: 0 }, { num: 1_000_001, den: 1 }]) assert.throws(() => createTokenEngine({ ...CONFIG, price }));
  assert.throws(() => createTokenEngine({ ...CONFIG, titheBps: 10_001 })); assert.throws(() => createTokenEngine({ ...CONFIG, quoteTtlMs: 0 }));
  const price = { num: 10, den: 1 }, engine = createTokenEngine({ ...CONFIG, price }); price.num = 99; assert.equal(engine.config.price.num, 10); assert.ok(Object.isFrozen(engine.config.price));
});
test('system-account firewall applies to direct posts and wallet locks', () => {
  const engine = funded(), wallet = new TumboUserLedger(engine), before = serializeTokenEngine(engine);
  assert.throws(() => engine.ledger.post([{ account: 'sys:treasury', asset: 'TUMBO', amount: -1 }, { account: 'u:alice', asset: 'TUMBO', amount: 1 }], { idempotencyKey: 'steal' }), /authority/);
  assert.throws(() => wallet.lock({ acct: 'sys:treasury', amountFluff: 1000 }), /user|bot/); assert.equal(serializeTokenEngine(engine), before);
});
test('void is never debited and unauthorized credits remain rejected', () => {
  const engine = funded(); engine.execute(quote(engine));
  assert.throws(() => engine.ledger.post([{ account: 'sys:void', asset: 'TUMBO', amount: -1 }, { account: 'u:alice', asset: 'TUMBO', amount: 1 }], { idempotencyKey: 'steal-void', authority: 'internal' }), /never debited/);
  assert.throws(() => engine.ledger.post([{ account: 'u:alice', asset: 'TUMBO', amount: -1 }, { account: 'sys:void', asset: 'TUMBO', amount: 1 }], { idempotencyKey: 'bad-credit' }), /only/);
});
test('distinct firm quote ids settle identical amounts as distinct trades', () => {
  const engine = funded(), first = quote(engine), second = quote(engine);
  assert.notEqual(first.id, second.id); engine.execute(first); engine.execute(second); assert.equal(engine.balance('u:alice', 'sMIMAS'), 20_000); assert.deepEqual(totals(engine), CONFIG.supply);
});
test('receipt links participate in the audit hash and are independent copies', () => {
  const engine = funded(), links = { actor: 'local' };
  const receipt = engine.ledger.post([{ account: 'u:alice', asset: 'TUMBO', amount: 0 }], { idempotencyKey: 'links', links }); links.actor = 'changed';
  assert.equal(receipt.links.actor, 'local'); assert.equal(receiptChainHash(receipt), receipt.hash); assert.notEqual(receiptChainHash({ ...receipt, links: { actor: 'changed' } }), receipt.hash);
});
test('fund multiplication uses exact integers above the floating-point product range', () => {
  const a = Number.MAX_SAFE_INTEGER, b = 19, c = 20; assert.equal(mulDivFloor(a, b, c), Number(BigInt(a) * BigInt(b) / BigInt(c)));
  assert.throws(() => mulDivFloor(a, 2, 1), RangeError); assert.throws(() => mulDivFloor(1, 1, 0)); assert.equal(fmt(1500), '1.500 TUMBO-SIM');
});
test('snapshot restores balances, journal identities, pending quotes and safe settlement replay', () => {
  const engine = funded(), offered = quote(engine), loaded = loadTokenEngine(serializeTokenEngine(engine));
  assert.deepEqual(totals(loaded), CONFIG.supply); assert.equal(serializeTokenEngine(loaded), serializeTokenEngine(engine));
  const first = loaded.execute(offered, { idempotencyKey: 'buy' }), reloaded = loadTokenEngine(serializeTokenEngine(loaded));
  assert.equal(reloaded.execute(offered, { idempotencyKey: 'buy' }).id, first.id); assert.equal(reloaded.balance('u:alice', 'sMIMAS'), 10_000); assert.equal(reloaded.ledger.verifyChain().ok, true);
});
test('snapshot restores cancellation and reversal without enabling a replayed trade', () => {
  const engine = funded(), pending = quote(engine); engine.cancelQuote(pending.id); const active = quote(engine); engine.execute(active, { idempotencyKey: 'buy' }); engine.reverse({ idempotencyKey: 'buy' });
  const loaded = loadTokenEngine(serializeTokenEngine(engine)); assert.throws(() => loaded.execute(pending), /cancelled/); const count = loaded.ledger.journalCount(); loaded.reverse({ idempotencyKey: 'buy' }); assert.equal(loaded.ledger.journalCount(), count); assert.deepEqual(totals(loaded), CONFIG.supply);
});
const corruptions = {
  'invented balance field': data => { data.balances = { 'u:alice': 999 }; },
  'edited canonical supply': data => { data.config.supply.TUMBO++; },
  'truncated genesis': data => { data.journals.shift(); },
  'edited posting': data => { data.journals.at(-1).postings[0].amount++; },
  'edited receipt hash': data => { data.journals.at(-1).hash = '0000000000000000'; },
  'edited tick': data => { data.journals.at(-1).tick++; },
  'broken previous link': data => { data.journals.at(-1).prevHash = 'broken'; },
  'duplicate receipt id': data => { data.journals.at(-1).id = data.journals[0].id; },
  'request intent mismatch': data => { data.requests.at(-1)[1] = '{}'; },
  'duplicate request key': data => { data.requests.push(data.requests[0]); },
  'receipt-journal mismatch': data => { data.receipts.at(-1)[1].action = 'fake'; },
  'execution registry omission': data => { data.executed = []; },
  'invented reversed key': data => { data.reversed.push('unknown'); },
  'quote receipt altered amount': data => { data.receipts.at(-1)[1].amountOut++; },
  'negative bot price': data => { data.botPricing.service = -1; },
};
for (const [name, corrupt] of Object.entries(corruptions)) test(`local load rejects ${name}`, () => {
  const engine = funded(); engine.execute(quote(engine), { idempotencyKey: 'buy' }); const data = JSON.parse(serializeTokenEngine(engine)); corrupt(data);
  assert.throws(() => loadTokenEngine(JSON.stringify(data))); assert.equal(engine.ledger.verifyChain().ok, true);
});
test('file snapshots round-trip exact state and leave no temporary artifacts', async () => {
  const path = await mkdtemp(join(tmpdir(), 'tumbo-token-')); try { const engine = funded(), target = join(path, 'engine.json'); await saveFile(engine, target); const loaded = await loadFile(target); assert.equal(serializeTokenEngine(loaded), serializeTokenEngine(engine)); }
  finally { await rm(path, { recursive: true, force: true }); }
});
test('localStorage snapshots use the canonical v2 namespace and clear explicitly', () => {
  const previous = globalThis.localStorage, memory = new Map(); globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  try { const engine = funded(); LedgerStore.save(engine); assert.ok(memory.has(TOKEN_STORAGE_KEY)); assert.equal(LedgerStore.load().balance('u:alice', 'TUMBO'), 10_000_000); LedgerStore.clear(); assert.equal(LedgerStore.load(), null); }
  finally { globalThis.localStorage = previous; }
});
test('a failed vault exit leaves principal and journal untouched', () => {
  const engine = funded(), vault = createTokenVaultLedger({ engine }); const position = vault.lock({ from: 'u:alice', amountFluff: 10_000, unlockTick: 10, idempotencyKey: 'lock' }); const before = serializeTokenEngine(engine);
  assert.throws(() => vault.withdraw({ positionId: position.position.id, owner: 'u:bob', idempotencyKey: 'wrong' }), /owner/); assert.throws(() => vault.withdraw({ positionId: position.position.id, owner: 'u:alice', idempotencyKey: 'early' }), /mature/); assert.equal(serializeTokenEngine(engine), before);
});
test('reversing a vault opening cannot release another participant’s principal', () => {
  const engine = funded(), vault = createTokenVaultLedger({ engine }); const first = vault.deposit({ from: 'u:alice', amountFluff: 10_000, idempotencyKey: 'first' }); vault.deposit({ from: 'u:alice', amountFluff: 20_000, idempotencyKey: 'second' }); engine.reverse({ journalId: first.id });
  const before = serializeTokenEngine(engine); assert.throws(() => vault.withdraw({ positionId: first.position.id, idempotencyKey: 'withdraw-reversed' }), /reversed/); assert.equal(serializeTokenEngine(engine), before); assert.equal(engine.balance('sys:vault', 'TUMBO'), 20_000);
});
test('activity observes shared wallet/vault commits without reposting financial balances', () => {
  const engine = funded(), activity = new TokenActivityLedger({ engine }), gam = new TokenGamification({ ledger: activity }); const count = engine.ledger.journalCount();
  new TumboUserLedger(engine).lock({ acct: 'u:alice', amountFluff: 5000 });
  assert.equal(engine.ledger.journalCount(), count + 1); assert.ok(gam.snapshot('u:alice').score.total > 0); assert.equal(activity.receipts().filter(row => row.action === 'lock').length, 1);
});
test('throwing document dispatch never unwinds a committed action or causes duplicate credit', () => {
  const doc = globalThis.document, Event = globalThis.CustomEvent; globalThis.document = { dispatchEvent() { throw new Error('observer'); } }; globalThis.CustomEvent = class {};
  try { const engine = funded(); const first = engine.faucet('u:bob', 'TUMBO', 1000, { idempotencyKey: 'one' }); assert.equal(engine.faucet('u:bob', 'TUMBO', 1000, { idempotencyKey: 'one' }), first); assert.equal(engine.balance('u:bob', 'TUMBO'), 1000); }
  finally { globalThis.document = doc; globalThis.CustomEvent = Event; }
});
