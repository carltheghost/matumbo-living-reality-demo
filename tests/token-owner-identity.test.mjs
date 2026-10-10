/** Browser facade ownership: layer preservation, fail-closed conflicts, force. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenFacade } from '../src/domains/token-facade.js';
import { attachTokenVault } from '../src/domains/token-vault.js';
import { attachTokenTransfers } from '../src/domains/token-transfers.js';

let graphId = 0;
async function withFreshWindow(run) {
  const previous = globalThis.window;
  const core = await import(`../src/domains/token.js?owner-regression=${++graphId}`);
  try {
    globalThis.window = {};
    await run(core, globalThis.window);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

test('ensure and get retain matching layers after base creation without a second seed', async () => {
  await withFreshWindow(core => {
    const base = core.ensureTumboTokenFacade();
    const layered = attachTokenTransfers(attachTokenVault(base));
    globalThis.window.TumboToken = layered;
    const count = core.engine.ledger.journalCount();
    assert.equal(core.ensureTumboTokenFacade(), layered);
    assert.equal(core.getTumboTokenFacade(), layered);
    assert.equal(globalThis.window.TumboToken, layered);
    assert.equal(core.engine.ledger.journalCount(), count);
    assert.equal(layered.tokenVault.engine, core.engine);
    assert.equal(layered.tokenTransfers.engine, core.engine);
    layered.send({ from: 'u:you', to: 'u:alice', asset: 'TUMBO', amountFluff: 100, idempotencyKey: 'owner:send' });
    assert.equal(base.balance('u:alice'), 100);
    assert.equal(layered.verifyChain().ok, true);
  });
});

test('a matching layer installed before first ensure is returned without replacement or funding', async () => {
  await withFreshWindow(core => {
    const base = createTokenFacade(core.engine), layered = attachTokenTransfers(base);
    const count = core.engine.ledger.journalCount();
    globalThis.window.TumboToken = layered;
    assert.equal(core.ensureTumboTokenFacade(), layered);
    assert.equal(core.getTumboTokenFacade(), layered);
    assert.equal(globalThis.window.TumboToken, layered);
    assert.equal(core.engine.ledger.journalCount(), count);
    base.dispose();
  });
});

test('conflicting initial owner fails before seeding and explicit forced install can replace it', async () => {
  await withFreshWindow(core => {
    const foreign = createTokenFacade(core.createTokenEngine());
    globalThis.window.TumboToken = foreign;
    const count = core.engine.ledger.journalCount();
    assert.throws(() => core.ensureTumboTokenFacade(), /different token engine/);
    assert.equal(globalThis.window.TumboToken, foreign);
    assert.equal(core.engine.ledger.journalCount(), count);
    const installed = core.installFacade(globalThis.window, { force: true });
    assert.equal(installed.engine, core.engine);
    assert.equal(globalThis.window.TumboToken, installed);
    assert.equal(core.ensureTumboTokenFacade(), installed);
    assert.equal(installed.balance('u:you'), 95_500);
    foreign.dispose();
  });
});

test('conflicts after singleton creation cannot return a stale base or overwrite the current owner', async () => {
  await withFreshWindow(core => {
    core.ensureTumboTokenFacade();
    const foreign = createTokenFacade(core.createTokenEngine());
    globalThis.window.TumboToken = foreign;
    const count = core.engine.ledger.journalCount();
    assert.throws(() => core.ensureTumboTokenFacade(), /different token engine/);
    assert.throws(() => core.getTumboTokenFacade(), /different token engine/);
    assert.equal(globalThis.window.TumboToken, foreign);
    assert.equal(core.engine.ledger.journalCount(), count);
    foreign.dispose();
  });
});

test('unforced installation preserves an existing target as before', async () => {
  await withFreshWindow(core => {
    const existing = { owner: 'other-target' }, target = { TumboToken: existing };
    assert.equal(core.installFacade(target), existing);
    assert.equal(target.TumboToken, existing);
    assert.equal(core.engine.ledger.journalCount(), 4);
  });
});

test('forcing another target does not strip the browser same-owner adapter layer', async () => {
  await withFreshWindow(core => {
    const base = core.ensureTumboTokenFacade(), layered = attachTokenTransfers(base);
    globalThis.window.TumboToken = layered;
    const target = { TumboToken: { owner: 'other-target' } }, count = core.engine.ledger.journalCount();
    assert.equal(core.installFacade(target, { force: true }), base);
    assert.equal(target.TumboToken, base);
    assert.equal(globalThis.window.TumboToken, layered);
    assert.equal(core.ensureTumboTokenFacade(), layered);
    assert.equal(core.engine.ledger.journalCount(), count);
  });
});

test('partial same-engine window facades fail before seed or replacement', async () => {
  await withFreshWindow(core => {
    const partial = { engine: core.engine, ledger: core.engine.ledger };
    globalThis.window.TumboToken = partial;
    assert.throws(() => core.ensureTumboTokenFacade(), /complete shared owner API/);
    assert.equal(globalThis.window.TumboToken, partial);
    assert.equal(core.engine.ledger.journalCount(), 4);
  });
});

test('a cached base republishes into an empty window without another financial mutation', async () => {
  await withFreshWindow(core => {
    const base = core.ensureTumboTokenFacade(), count = core.engine.ledger.journalCount();
    delete globalThis.window.TumboToken;
    assert.equal(core.ensureTumboTokenFacade(), base);
    assert.equal(globalThis.window.TumboToken, base);
    assert.equal(core.engine.ledger.journalCount(), count);
  });
});
