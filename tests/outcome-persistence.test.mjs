import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentContractWorkspace, CONTRACT_WORKSPACE_STORAGE_KEY } from '../src/domains/outcome-persistence.js';

const NOW = Date.parse('2026-09-24T12:00:00Z');
function harness() {
  let now = NOW;
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const options = { storage, now: () => now };
  return { workspace: createPersistentContractWorkspace(options), options, values, storage, advance: (ms = 1) => { now += ms; } };
}
function book(workspace) {
  const desk = workspace.outcomeDesk;
  const contract = desk.createContract({ eventId: 'event:1', eventLabel: 'Home v Away', outcomes: ['HOME', 'AWAY'], creator: 'owner', status: 'draft' });
  desk.publish({ contractId: contract.id });
  desk.join({ contractId: contract.id, participant: 'alice', outcome: 'HOME', stakeAmount: 10, idempotencyKey: 'alice:1' });
  desk.join({ contractId: contract.id, participant: 'bob', outcome: 'AWAY', stakeAmount: 10, idempotencyKey: 'bob:1' });
  return contract;
}
test('shared journal preserves standalone relics, draft/publish/joins/lock/settle and award identity through reload', () => {
  const h = harness();
  const standalone = h.workspace.vault.mintRelic({ name: 'Memory', origin: 'manual', creator: 'alice', holder: 'alice', terms: { note: 'Keep this core' } });
  h.workspace.vault.annotate({ relicId: standalone.id, note: 'First day' });
  const contract = book(h.workspace);
  h.workspace.outcomeDesk.lock({ contractId: contract.id });
  let restored = createPersistentContractWorkspace(h.options);
  assert.equal(restored.outcomeDesk.get(contract.id).status, 'locked');
  assert.equal(restored.outcomeDesk.get(contract.id).stakes.length, 2);
  assert.equal(restored.vault.getRelic(standalone.id).life.annotations.length, 1);
  restored.outcomeDesk.recordResult({ contractId: contract.id, result: 'HOME' });
  restored.outcomeDesk.settle({ contractId: contract.id });
  const nft = restored.outcomeDesk.listNfts()[0];
  assert.equal(restored.vault.getRelic(nft.relicId).award.awardNftId, nft.id);
  restored = createPersistentContractWorkspace(h.options);
  assert.equal(restored.outcomeDesk.get(contract.id).status, 'settled');
  assert.equal(restored.outcomeDesk.listEscrows()[0].expiresAt, null);
  assert.equal(restored.outcomeDesk.listNfts().length, 1);
  assert.equal(restored.vault.listRelics().length, 2);
  const journal = restored.exportState();
  restored.outcomeDesk.recordResult({ contractId: contract.id, result: 'HOME' });
  restored.outcomeDesk.settle({ contractId: contract.id });
  assert.equal(restored.exportState(), journal);
});
test('join/claim/transfer idempotency ledgers survive reload and claims pay once', () => {
  const h = harness(), contract = book(h.workspace);
  let restored = createPersistentContractWorkspace(h.options);
  restored.outcomeDesk.join({ contractId: contract.id, participant: 'alice', outcome: 'HOME', stakeAmount: 10, idempotencyKey: 'alice:1' });
  assert.equal(restored.outcomeDesk.get(contract.id).stakes.length, 2);
  assert.throws(() => restored.outcomeDesk.join({ contractId: contract.id, participant: 'alice', outcome: 'HOME', stakeAmount: 11, idempotencyKey: 'alice:1' }), /idempotency/);
  restored.outcomeDesk.recordResult({ contractId: contract.id, result: 'HOME' });
  const nft = restored.outcomeDesk.listNfts()[0];
  restored.outcomeDesk.transferAward({ nftId: nft.id, toHolder: 'charlie', idempotencyKey: 'move:1' });
  restored = createPersistentContractWorkspace(h.options);
  restored.outcomeDesk.transferAward({ nftId: nft.id, toHolder: 'charlie', idempotencyKey: 'move:1' });
  assert.equal(restored.outcomeDesk.getNft(nft.id).transfers.length, 1);
  const claim = restored.outcomeDesk.claimAward({ nftId: nft.id, idempotencyKey: 'claim:1' });
  restored = createPersistentContractWorkspace(h.options);
  assert.deepEqual(restored.outcomeDesk.claimAward({ nftId: nft.id, idempotencyKey: 'claim:1' }), claim);
  assert.throws(() => restored.outcomeDesk.claimAward({ nftId: nft.id }), /already been claimed/);
  assert.equal(restored.outcomeDesk.get(contract.id).status, 'claimed');
  assert.equal(restored.vault.getRelic(nft.relicId).life.claimed, true);
  assert.equal(restored.vault.getRelic(nft.relicId).life.holder, 'charlie');
});
test('vault award actions stay connected to desk authority and reject orphaning resets', () => {
  const h = harness(), contract = book(h.workspace);
  h.workspace.outcomeDesk.recordResult({ contractId: contract.id, result: 'HOME' });
  const nft = h.workspace.outcomeDesk.listNfts()[0];
  h.workspace.vault.recordRelicTransfer({ relicId: nft.relicId, toHolder: 'new-holder' });
  assert.equal(h.workspace.outcomeDesk.getNft(nft.id).holder, 'new-holder');
  assert.throws(() => h.workspace.vault.recordRelicClaim({ relicId: nft.relicId, holder: 'thief', amount: 20 }), /holder/);
  h.workspace.vault.recordRelicClaim({ relicId: nft.relicId, holder: 'new-holder', amount: 20 });
  assert.equal(h.workspace.outcomeDesk.getNft(nft.id).claimed, true);
  assert.throws(() => h.workspace.vault.reset(), /parity/);
  assert.throws(() => h.workspace.outcomeDesk.reset(), /orphan/);
  assert.equal(h.workspace.outcomeDesk.listNfts().length, 1);
  assert.doesNotThrow(() => createPersistentContractWorkspace(h.options));
});
test('quota failure during nested award/relic creation swaps neither domain and retry mints exactly once', () => {
  const h = harness(), contract = book(h.workspace);
  const before = h.workspace.exportState();
  const writer = h.storage.setItem;
  h.storage.setItem = () => { throw new Error('quota denied'); };
  assert.throws(() => h.workspace.outcomeDesk.recordResult({ contractId: contract.id, result: 'HOME' }), /held.*quota/);
  assert.equal(h.workspace.exportState(), before);
  assert.equal(h.workspace.outcomeDesk.get(contract.id).status, 'open');
  assert.equal(h.workspace.outcomeDesk.listNfts().length, 0);
  assert.equal(h.workspace.vault.listRelics().length, 0);
  assert.equal(h.workspace.getPersistenceStatus().status, 'error');
  h.storage.setItem = writer;
  h.workspace.outcomeDesk.recordResult({ contractId: contract.id, result: 'HOME' });
  assert.equal(h.workspace.outcomeDesk.listNfts().length, 1);
  assert.equal(h.workspace.vault.listRelics().length, 1);
  assert.equal(h.workspace.getPersistenceStatus().status, 'ok');
});
test('corrupt/skewed/tampered journal is rejected without changing stored bytes', () => {
  const h = harness(), contract = book(h.workspace);
  h.workspace.outcomeDesk.recordResult({ contractId: contract.id, result: 'HOME' });
  const original = h.workspace.exportState();
  const mutations = [
    (state) => { state.schemaVersion = 999; },
    (state) => { state.commands[0].operation = 'desk.claimAward'; },
    (state) => { state.commands[2].input.stakeAmount = 1000; },
    (state) => { state.commands[0].resultDigest = 'fake'; },
    (state) => { state.stateDigest = 'fake'; },
    (state) => { state.commands.at(-1).seq = 1; },
    (state) => { state.commands.at(-1).at = NOW - 1; },
  ];
  for (const change of mutations) {
    const state = JSON.parse(original); change(state);
    const value = JSON.stringify(state); h.values.set(CONTRACT_WORKSPACE_STORAGE_KEY, value);
    assert.throws(() => createPersistentContractWorkspace(h.options), /restore failed/);
    assert.equal(h.values.get(CONTRACT_WORKSPACE_STORAGE_KEY), value);
  }
  h.values.set(CONTRACT_WORKSPACE_STORAGE_KEY, '{bad');
  assert.throws(() => createPersistentContractWorkspace(h.options), /restore failed/);
});
test('stale tabs cannot overwrite and stable domain proxies follow validated reload', () => {
  const h = harness();
  const other = createPersistentContractWorkspace(h.options);
  const stableDesk = other.outcomeDesk, stableVault = other.vault;
  const contract = book(h.workspace);
  assert.throws(() => other.outcomeDesk.lock({ contractId: contract.id }), /Another tab/);
  other.reloadFromStorage();
  assert.equal(other.outcomeDesk, stableDesk); assert.equal(other.vault, stableVault);
  assert.equal(stableDesk.get(contract.id).stakes.length, 2);
  other.outcomeDesk.lock({ contractId: contract.id });
  assert.throws(() => h.workspace.outcomeDesk.recordResult({ contractId: contract.id, result: 'HOME' }), /Another tab/);
});
test('void/refund and no-stake settlement persist without changing canonical outcome behavior', () => {
  const h = harness(), contract = book(h.workspace);
  h.workspace.outcomeDesk.void({ contractId: contract.id, reason: 'Cancelled event' });
  const empty = h.workspace.outcomeDesk.createContract({ eventId: 'empty', eventLabel: 'Empty', outcomes: ['A', 'B'], creator: 'owner' });
  h.workspace.outcomeDesk.recordResult({ contractId: empty.id, result: 'A' });
  const restored = createPersistentContractWorkspace(h.options);
  assert.equal(restored.outcomeDesk.get(contract.id).status, 'voided');
  assert.equal(restored.outcomeDesk.get(contract.id).grading.kind, 'refund');
  assert.equal(restored.outcomeDesk.get(empty.id).status, 'settled');
  assert.equal(restored.outcomeDesk.get(empty.id).grading.kind, 'no_stakes');
});
test('current-time relic aging is a read-only projection and does not invalidate durable replay', () => {
  const h = harness();
  const relic = h.workspace.vault.mintRelic({ name: 'Long-lived', origin: 'manual', creator: 'a', holder: 'a' });
  h.advance(365 * 86400000);
  h.workspace.vault.getRelic(relic.id);
  h.workspace.vault.annotate({ relicId: relic.id, note: 'A year later' });
  assert.doesNotThrow(() => createPersistentContractWorkspace(h.options));
});

test('storage read denial holds both domain mutation and reports a visible persistence error', () => {
  const h = harness();
  h.storage.getItem = () => { throw new Error('read denied'); };
  assert.throws(() => h.workspace.vault.mintRelic({ name: 'Blocked', origin: 'manual', creator: 'a', holder: 'a' }), /held.*read denied/);
  assert.equal(h.workspace.getPersistenceStatus().status, 'error');
  assert.equal(h.workspace.vault.listRelics().length, 0);
});

test('long provider event identities stay exact through book creation and durable replay', () => {
  const h = harness();
  const eventId = 'espn-multi-sport:basketball:mens-college-basketball:401123456:401123456:0';
  assert.ok(eventId.length > 64);
  const contract = h.workspace.outcomeDesk.createContract({ eventId, eventLabel: 'College game', outcomes: ['HOME', 'AWAY'], creator: 'owner' });
  assert.equal(contract.eventId, eventId);
  assert.equal(createPersistentContractWorkspace(h.options).outcomeDesk.get(contract.id).eventId, eventId);
  assert.throws(() => h.workspace.outcomeDesk.createContract({ eventId: 'x'.repeat(161), eventLabel: 'Invalid identity', outcomes: ['A', 'B'], creator: 'owner' }), /without truncation/);
});
