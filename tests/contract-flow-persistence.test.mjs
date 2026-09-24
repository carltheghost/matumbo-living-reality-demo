import test from 'node:test';
import assert from 'node:assert/strict';
import { createContractFlow, CONTRACT_FLOW_STORAGE_KEY } from '../src/domains/contract-flow.js';
import { createPersistentContractWorkspace } from '../src/domains/outcome-persistence.js';
import { createContractLedger } from '../src/domains/contract-ledger.js';
import { createProposalQueue } from '../src/domains/bot-plaza.js';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const EVENT = 'espn-multi-sport:soccer:eng.1:123:123:0';
function harness() {
  let now = NOW;
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const clock = () => now;
  function load() {
    const workspace = createPersistentContractWorkspace({ storage, now: clock });
    const queue = createProposalQueue({ storage, now: clock });
    const flow = createContractFlow({ storage, now: clock, outcomeDesk: workspace.outcomeDesk, proposalQueue: queue, ledger: createContractLedger(), fetchEspnRecords: async () => [], fetchImpl: async () => ({ ok: false }) });
    return { workspace, queue, flow };
  }
  const first = load();
  const proposal = first.queue.submitProposal({ botId: 'scout', botName: 'Scout' }, { title: 'Home v Away', eventLabel: 'Home v Away', eventId: EVENT, outcomes: ['HOME', 'AWAY'], expiresAt: new Date(NOW + 60000).toISOString() });
  return { ...first, load, storage, values, proposal, advance: (ms) => { now += ms; }, record: () => ({ id: EVENT, providerAvailable: true, liveFetch: true, sourceUrl: 'https://site.api.espn.com/event/123', retrievedAt: new Date(now).toISOString(), statusDetail: { completed: true, final: true }, participants: [{ name: 'HOME', winner: true, scoreValue: 2 }, { name: 'AWAY', winner: false, scoreValue: 1 }] }) };
}
test('approved binding plus joins survive reload and automatically lock, grade and settle once', () => {
  const h = harness();
  const { contract } = h.flow.approveProposal(h.proposal);
  h.workspace.outcomeDesk.join({ contractId: contract.id, participant: 'alice', outcome: 'HOME', stakeAmount: 10, idempotencyKey: 'alice' });
  h.workspace.outcomeDesk.join({ contractId: contract.id, participant: 'bob', outcome: 'AWAY', stakeAmount: 10, idempotencyKey: 'bob' });
  const approvedAt = h.flow.getApprovedBindings()[0].approvedAt;
  h.advance(60001);
  let restored = h.load();
  assert.equal(restored.flow.getApprovedBindings()[0].approvedAt, approvedAt);
  assert.equal(restored.queue.getProposals().find(p => p.id === h.proposal.id).status, 'approved');
  assert.equal(restored.flow.reconcileApprovedContracts([h.record()]).graded.length, 1);
  assert.equal(restored.workspace.outcomeDesk.get(contract.id).status, 'settled');
  const nft = restored.workspace.outcomeDesk.listNfts()[0];
  restored = h.load();
  assert.equal(restored.flow.reconcileApprovedContracts([h.record()]).graded.length, 0);
  assert.equal(restored.workspace.outcomeDesk.listNfts().length, 1);
  assert.equal(restored.workspace.vault.getRelic(nft.relicId).award.awardNftId, nft.id);
  const claim = restored.flow.claimForever({ nftId: nft.id, idempotencyKey: 'forever', participant: 'alice' });
  assert.equal(claim.claimed, true);
  restored = h.load();
  assert.deepEqual(restored.flow.claimForever({ nftId: nft.id, idempotencyKey: 'forever', participant: 'alice' }).receipt, claim.receipt);
  assert.equal(restored.workspace.outcomeDesk.listEscrows()[0].expiresAt, null);
});
test('binding persistence failure leaves proposal pending; retry reuses durable keyed book', () => {
  const h = harness();
  const write = h.storage.setItem;
  h.storage.setItem = (key, value) => { if (key === CONTRACT_FLOW_STORAGE_KEY) throw new Error('approval quota'); write(key, value); };
  assert.throws(() => h.flow.approveProposal(h.proposal), /approval quota/);
  assert.equal(h.queue.getProposals().find(p => p.id === h.proposal.id).status, 'pending');
  assert.equal(h.flow.getApprovedBindings().length, 0);
  assert.equal(h.workspace.outcomeDesk.list().filter(c => c.eventId === EVENT).length, 1);
  assert.equal(h.flow.getPersistenceStatus().status, 'error');
  h.storage.setItem = write;
  const restored = h.load();
  const { contract } = restored.flow.approveProposal(restored.queue.getProposals().find(p => p.id === h.proposal.id));
  assert.equal(restored.workspace.outcomeDesk.list().filter(c => c.eventId === EVENT).length, 1);
  assert.equal(restored.flow.getApprovedBindings()[0].contractId, contract.id);
  restored.flow.approveProposal(h.proposal);
  assert.equal(restored.workspace.outcomeDesk.list().filter(c => c.eventId === EVENT).length, 1);
});
test('corrupt or mismatched saved approval identity never authorizes a book and remains intact', () => {
  const h = harness(); h.flow.approveProposal(h.proposal);
  const original = h.values.get(CONTRACT_FLOW_STORAGE_KEY);
  const mutations = [
    state => { state.schemaVersion = 999; },
    state => { state.bindings[0].contractId = 'wrong-book'; },
    state => { state.bindings[0].book.outcomes = ['WRONG', 'OTHER']; },
    state => { state.bindings[0].gameId = 'espn-multi-sport:other'; },
    state => { state.bindings[0].simulation = false; },
    state => { state.bindings.push(state.bindings[0]); },
  ];
  for (const mutate of mutations) {
    const state = JSON.parse(original); mutate(state); const value = JSON.stringify(state);
    h.values.set(CONTRACT_FLOW_STORAGE_KEY, value);
    assert.throws(() => h.load(), /approval restore failed/);
    assert.equal(h.values.get(CONTRACT_FLOW_STORAGE_KEY), value);
  }
});
test('flow stale-tab check holds automatic grading before any domain mutation', () => {
  const h = harness(); h.flow.approveProposal(h.proposal);
  const stale = h.load();
  const original = h.values.get(CONTRACT_FLOW_STORAGE_KEY);
  h.values.set(CONTRACT_FLOW_STORAGE_KEY, `${original} `);
  const result = stale.flow.reconcileApprovedContracts([h.record()]);
  assert.match(result.errors[0].reason, /Another tab/);
  assert.equal(stale.workspace.outcomeDesk.listNfts().length, 0);
});
test('expired proposal cannot create a newly approved book', () => {
  const h = harness(); h.advance(60001);
  assert.throws(() => h.flow.approveProposal(h.proposal), /expired/);
  assert.equal(h.workspace.outcomeDesk.list().filter(c => c.eventId === EVENT).length, 0);
});

test('interrupted grade-to-settle persists awards and resumes settlement on reload without reminting', () => {
  const h = harness();
  const { contract } = h.flow.approveProposal(h.proposal);
  h.workspace.outcomeDesk.join({ contractId: contract.id, participant: 'alice', outcome: 'HOME', stakeAmount: 10 });
  h.advance(60001);
  const writer = h.storage.setItem;
  h.storage.setItem = (key, value) => {
    const state = JSON.parse(value);
    if (state.commands?.at(-1)?.operation === 'desk.settle') throw new Error('settlement quota');
    writer(key, value);
  };
  const report = h.flow.reconcileApprovedContracts([h.record()]);
  assert.match(report.errors[0].reason, /settlement quota/);
  assert.equal(h.workspace.outcomeDesk.get(contract.id).status, 'graded');
  assert.equal(h.workspace.outcomeDesk.listNfts().length, 1);
  h.storage.setItem = writer;
  const restored = h.load();
  assert.equal(restored.flow.reconcileApprovedContracts([]).graded[0].resumedSettlement, true);
  assert.equal(restored.workspace.outcomeDesk.get(contract.id).status, 'settled');
  assert.equal(restored.workspace.outcomeDesk.listNfts().length, 1);
  assert.equal(restored.workspace.vault.listRelics().length, 1);
});
