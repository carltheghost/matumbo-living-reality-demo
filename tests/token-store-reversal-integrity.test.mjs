import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenEngine, receiptChainHash, VOID_ACCOUNT, MARKET_MAKER, REVERSE_WINDOW_TICKS } from '../src/domains/token.js?v=20261003-complete8';
import { serializeTokenEngine, loadTokenEngine } from '../src/domains/token-store.js?v=20261003-complete8';
import { createEconomicKernel } from '../src/domains/economic-kernel.js?v=20261003-complete8';

function fixture() {
  const engine = createTokenEngine();
  const funded = engine.faucet('u:alice', 'TUMBO', 50000, { idempotencyKey: 'fund:alice' });
  return { engine, funded };
}

function transferFixture() {
  const f = fixture();
  const sent = f.engine.ledger.post([
    { account: 'u:alice', asset: 'TUMBO', amount: -100 },
    { account: 'u:bob', asset: 'TUMBO', amount: 100 },
  ], { idempotencyKey: 'ordinary-send', action: 'send', memo: 'Local transfer fixture' });
  const reversed = f.engine.reverse({ journalId: sent.id, actor: 'u:alice' });
  return { ...f, sent, reversed, packet: JSON.parse(serializeTokenEngine(f.engine)) };
}

// Recompute the checksum and matching request as a local snapshot author could.
// This distinguishes semantic lifecycle validation from checksum corruption.
function rewriteLast(packet, change) {
  const next = structuredClone(packet), row = next.journals.at(-1), oldKey = row.idempotencyKey;
  const requests = new Map(next.requests), request = JSON.parse(requests.get(oldKey));
  change(row, next);
  row.hash = receiptChainHash(row);
  request.postings = row.postings; request.action = row.action; request.memo = row.memo; request.links = row.links ?? null;
  requests.delete(oldKey); requests.set(row.idempotencyKey, JSON.stringify(request));
  next.requests = [...requests];
  // The canonical generic reversal is normally only in ledger journals. Keep
  // any public index entry coherent too, rather than relying on an index error.
  next.receipts = next.receipts.map(([key, receipt]) => receipt.id === row.id ? [row.idempotencyKey, { ...receipt, ...row }] : [key, receipt]);
  return JSON.stringify(next);
}

test('ordinary transfer reversal round-trips with exact balances, lifecycle owner and idempotent replay', () => {
  const f = transferFixture(), restored = loadTokenEngine(JSON.stringify(f.packet));
  assert.equal(restored.balance('u:alice', 'TUMBO'), 50000);
  assert.equal(restored.balance('u:bob', 'TUMBO'), 0);
  assert.equal(restored.ledger.verifyChain().ok, true);
  assert.deepEqual(restored.ledger._journals, f.engine.ledger._journals);
  assert.equal(restored._reversedJournalKeys.has(f.sent.idempotencyKey), true);
  const before = serializeTokenEngine(restored), count = restored.ledger.journalCount();
  assert.equal(restored.reverse({ idempotencyKey: f.sent.idempotencyKey }).id, f.reversed.id);
  assert.equal(restored.ledger.journalCount(), count);
  assert.equal(serializeTokenEngine(restored), before);
});

test('ordinary exchange reversal restores principal while preserving the Void tithe and exact market compensation after reload', () => {
  const f = fixture(), beforeVoid = f.engine.balance(VOID_ACCOUNT, 'TUMBO');
  const quote = f.engine.quote({ action: 'buy', from: 'u:alice', fromAsset: 'TUMBO', toAsset: 'sMIMAS', amountIn: 10000 });
  const trade = f.engine.execute(quote, { idempotencyKey: 'ordinary-buy' });
  const original = f.engine.ledger._receipts.get(trade.idempotencyKey), reversed = f.engine.reverse({ idempotencyKey: trade.idempotencyKey, actor: 'u:alice' });
  const tithe = original.postings.filter(row => row.account === VOID_ACCOUNT && row.amount > 0).reduce((n, row) => n + row.amount, 0);
  assert.ok(tithe > 0);
  assert.equal(reversed.postings.some(row => row.account === VOID_ACCOUNT && row.amount < 0), false);
  assert.equal(reversed.postings.some(row => row.account === MARKET_MAKER && row.asset === 'TUMBO' && row.amount === -tithe), true);
  const restored = loadTokenEngine(serializeTokenEngine(f.engine));
  assert.equal(restored.balance('u:alice', 'TUMBO'), 50000);
  assert.equal(restored.balance('u:alice', 'sMIMAS'), 0);
  assert.equal(restored.balance(VOID_ACCOUNT, 'TUMBO'), beforeVoid + tithe);
  assert.deepEqual(restored.ledger._receipts.get(reversed.idempotencyKey).postings, reversed.postings);
  assert.equal(restored.ledger.verifyChain().ok, true);
  assert.equal(restored.reverse({ journalId: original.id }).id, reversed.id);
});

test('restored reversals reject unknown and inconsistent original ID/key references despite recomputed integrity', () => {
  const f = transferFixture();
  for (const change of [
    row => { row.links.reverses = 'missing-journal'; },
    row => { row.links.reversesKey = 'missing-key'; },
    row => { row.links.reverses = 'missing-journal'; row.links.reversesKey = 'missing-key'; },
    row => { row.links.reverses = f.funded.id; },
    row => { row.links.reversesKey = f.funded.idempotencyKey; },
    row => { delete row.links.reverses; },
    row => { delete row.links.reversesKey; },
  ]) assert.throws(() => loadTokenEngine(rewriteLast(f.packet, change)), /revers|original|lifecycle/i);
});

test('restored reversal keys and compensation amounts remain bound to the actual original transfer', () => {
  const f = transferFixture();
  assert.throws(() => loadTokenEngine(rewriteLast(f.packet, row => { row.idempotencyKey = 'different-reversal-key'; })), /revers|original|lifecycle/i);
  assert.throws(() => loadTokenEngine(rewriteLast(f.packet, row => {
    row.postings = row.postings.map(posting => ({ ...posting, amount: posting.amount > 0 ? 99 : -99 }));
  })), /revers|compensat|posting/i);
  assert.throws(() => loadTokenEngine(rewriteLast(f.packet, row => {
    row.links.reverses = f.funded.id; row.links.reversesKey = f.funded.idempotencyKey;
    row.idempotencyKey = `reverse:${f.funded.idempotencyKey}`;
  })), /revers|compensat|posting/i);
});

test('economic payment legs cannot restore under a coherently named ordinary faucet reversal', () => {
  const f = fixture(), kernel = createEconomicKernel({ engine: f.engine, clock: () => 1791040000000 });
  try {
    const paid = kernel.pay({ from: 'u:alice', to: 'u:bob', amountFluff: 100, idempotencyKey: 'paid-economic-payment' });
    const original = f.engine.ledger._receipts.get(paid.receiptKey);
    // This exact shape bypassed the ownership-only restoration guard: the
    // declared faucet target is ordinary, while the postings undo a paid domain.
    f.engine.ledger.post(original.postings.map(leg => ({ ...leg, amount: -leg.amount })), {
      idempotencyKey: `reverse:${f.funded.idempotencyKey}`, action: 'reverse', memo: 'Misbound local snapshot fixture', authority: 'internal',
      links: { reverses: f.funded.id, reversesKey: f.funded.idempotencyKey, actor: 'u:alice' },
    });
    f.engine._reversedJournalKeys.add(f.funded.idempotencyKey);
    assert.equal(f.engine.balance('u:bob', 'TUMBO'), 0);
    assert.equal(kernel.snapshot().commandCount, 1);
    assert.equal(f.engine.ledger.verifyChain().ok, true);
    assert.throws(() => loadTokenEngine(serializeTokenEngine(f.engine)), /revers|compensat|posting/i);
  } finally { kernel.dispose(); }
});

test('restored reversal compensation cannot substitute another balanced account or asset', () => {
  const f = transferFixture();
  assert.throws(() => loadTokenEngine(rewriteLast(f.packet, row => {
    row.postings = row.postings.map(posting => ({ ...posting, account: posting.amount > 0 ? 'u:thief' : posting.account }));
  })), /revers|compensat|posting/i);
  assert.throws(() => loadTokenEngine(rewriteLast(f.packet, row => {
    row.postings = row.postings.map(posting => ({ ...posting, amount: -posting.amount }));
  })), /revers|compensat|posting/i);
  assert.throws(() => loadTokenEngine(rewriteLast(f.packet, row => {
    row.postings = row.postings.map(posting => ({ ...posting, asset: 'sMIMAS' }));
  })), /revers|compensat|posting/i);
});

test('a reversal cannot name a previous lifecycle reversal as its original after snapshot reload', () => {
  const f = transferFixture();
  f.engine.ledger.post(f.reversed.postings.map(posting => ({ ...posting, amount: -posting.amount })), {
    idempotencyKey: `reverse:${f.reversed.idempotencyKey}`, action: 'reverse', memo: 'Nested lifecycle fixture',
    links: { reverses: f.reversed.id, reversesKey: f.reversed.idempotencyKey, actor: 'u:alice' },
  });
  f.engine._reversedJournalKeys.add(f.reversed.idempotencyKey);
  assert.throws(() => loadTokenEngine(serializeTokenEngine(f.engine)), /revers|lifecycle/i);
});

test('a reversal cannot name canonical genesis as its original or an unissued registry owner', () => {
  const f = transferFixture(), genesis = f.packet.journals[0];
  assert.throws(() => loadTokenEngine(rewriteLast(f.packet, (row, packet) => {
    row.links.reverses = genesis.id; row.links.reversesKey = genesis.idempotencyKey;
    row.idempotencyKey = `reverse:${genesis.idempotencyKey}`; packet.reversed = [genesis.idempotencyKey];
  })), /revers|genesis/i);
  const corrupt = structuredClone(f.packet); corrupt.reversed.push('unissued-original');
  assert.throws(() => loadTokenEngine(JSON.stringify(corrupt)), /reversal registry/i);
});

test('snapshot reversal lifecycle preserves the exact tick window and rejects a balanced late compensation', () => {
  for (const extraTicks of [REVERSE_WINDOW_TICKS, REVERSE_WINDOW_TICKS + 1]) {
    const f = fixture();
    const sent = f.engine.ledger.post([
      { account: 'u:alice', asset: 'TUMBO', amount: -100 },
      { account: 'u:bob', asset: 'TUMBO', amount: 100 },
    ], { idempotencyKey: 'aging-send', action: 'send' });
    for (let index = 0; index < extraTicks; index++) {
      const from = index % 2 ? 'u:bob' : 'u:alice', to = index % 2 ? 'u:alice' : 'u:bob';
      f.engine.ledger.post([{ account: from, asset: 'TUMBO', amount: -1 }, { account: to, asset: 'TUMBO', amount: 1 }], { idempotencyKey: `aging-tick:${index}`, action: 'send' });
    }
    if (extraTicks === REVERSE_WINDOW_TICKS) {
      f.engine.reverse({ journalId: sent.id });
      const restored = loadTokenEngine(serializeTokenEngine(f.engine));
      assert.equal(restored.balance('u:alice', 'TUMBO'), 50000);
      assert.equal(restored.balance('u:bob', 'TUMBO'), 0);
      assert.equal(restored.ledger.verifyChain().ok, true);
    } else {
      // A crafted snapshot has correct legs and a valid target but cannot
      // acquire a reversal that the live canonical lifecycle already refuses.
      assert.throws(() => f.engine.reverse({ journalId: sent.id }), /window expired/);
      f.engine.ledger.post(sent.postings.map(posting => ({ ...posting, amount: -posting.amount })), {
        idempotencyKey: `reverse:${sent.idempotencyKey}`, action: 'reverse',
        links: { reverses: sent.id, reversesKey: sent.idempotencyKey, actor: 'u:alice' },
      });
      f.engine._reversedJournalKeys.add(sent.idempotencyKey);
      assert.equal(f.engine.ledger.verifyChain().ok, true);
      assert.throws(() => loadTokenEngine(serializeTokenEngine(f.engine)), /lifecycle|window/i);
    }
  }
});
