/**
 * contract-ledger unit tests — DOM-free, node:test
 * SIMULATED TUMBO POINTS ONLY.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createContractLedger,
  applyLifecycleEvent,
  isClaimable,
  summarizeParticipantHistory,
  LIFECYCLE_STATUSES,
} from '../src/domains/contract-ledger.js';

describe('applyLifecycleEvent', () => {
  it('allows proposed → open', () => {
    assert.equal(applyLifecycleEvent('proposed', { type: 'status_change', toStatus: 'open' }), 'open');
  });

  it('allows active → graded via graded event', () => {
    assert.equal(applyLifecycleEvent('active', { type: 'graded' }), 'graded');
  });

  it('allows graded → claimed via claimed event', () => {
    assert.equal(applyLifecycleEvent('graded', { type: 'claimed' }), 'claimed');
  });

  it('rejects illegal transition', () => {
    assert.equal(applyLifecycleEvent('proposed', { type: 'status_change', toStatus: 'claimed' }), null);
  });

  it('reverse forces reversed', () => {
    assert.equal(applyLifecycleEvent('graded', { type: 'reversed' }), 'reversed');
  });

  it('unknown state is rejected', () => {
    assert.equal(applyLifecycleEvent('nope', { type: 'status_change', toStatus: 'open' }), null);
  });
});

describe('isClaimable', () => {
  const base = { type: 'graded', side: 'win', graded: true, claimed: false, expiresAt: null };

  it('eternal win is claimable at any future time', () => {
    assert.equal(isClaimable(base, Date.now()), true);
    assert.equal(isClaimable(base, Date.now() + 1000 * 60 * 60 * 24 * 365 * 50), true);
  });

  it('already claimed is not claimable', () => {
    assert.equal(isClaimable({ ...base, claimed: true }, Date.now()), false);
  });

  it('lose side is not claimable', () => {
    assert.equal(isClaimable({ ...base, side: 'lose' }, Date.now()), false);
  });

  it('expired entry is not claimable', () => {
    assert.equal(isClaimable({ ...base, expiresAt: Date.now() - 1000 }, Date.now()), false);
  });

  it('ungraded entry is not claimable', () => {
    assert.equal(isClaimable({ ...base, graded: false }, Date.now()), false);
  });
});

describe('summarizeParticipantHistory', () => {
  it('counts wins, losses, claims and points', () => {
    const entries = [
      { type: 'graded', participant: 'alice', side: 'win', graded: true, claimed: false, amount: 100 },
      { type: 'graded', participant: 'alice', side: 'lose', graded: true, amount: -50 },
      { type: 'claimed', participant: 'alice', amount: 100 },
      { type: 'graded', participant: 'bob', side: 'win', graded: true, claimed: false, amount: 200 },
    ];
    const s = summarizeParticipantHistory(entries, 'alice');
    assert.equal(s.wins, 1);
    assert.equal(s.losses, 1);
    assert.equal(s.claimed, 1);
    assert.equal(s.totalPoints, 50); // 100 claimed + (-50) loss
    assert.equal(s.openClaims, 1);
  });

  it('empty input returns zeroed summary', () => {
    const s = summarizeParticipantHistory([], 'alice');
    assert.deepEqual(s, { wins: 0, losses: 0, claimed: 0, totalPoints: 0, openClaims: 0 });
  });
});

describe('createContractLedger', () => {
  it('records created and tracks status', () => {
    const ledger = createContractLedger();
    const e = ledger.record({ contractId: 'c1', type: 'created', toStatus: 'proposed' });
    assert.ok(e);
    assert.equal(e.contractId, 'c1');
    assert.equal(ledger.getStatus('c1'), 'proposed');
  });

  it('rejects record without contractId', () => {
    const ledger = createContractLedger();
    assert.equal(ledger.record({ type: 'created' }), null);
  });

  it('lifecycle: proposed → open → active', () => {
    const ledger = createContractLedger();
    ledger.record({ contractId: 'c2', type: 'created', toStatus: 'proposed' });
    ledger.record({ contractId: 'c2', type: 'status_change', toStatus: 'open' });
    assert.equal(ledger.getStatus('c2'), 'open');
    ledger.record({ contractId: 'c2', type: 'status_change', toStatus: 'active' });
    assert.equal(ledger.getStatus('c2'), 'active');
  });

  it('illegal transition records audit but keeps status', () => {
    const ledger = createContractLedger();
    ledger.record({ contractId: 'c2b', type: 'created', toStatus: 'proposed' });
    ledger.record({ contractId: 'c2b', type: 'status_change', toStatus: 'claimed' });
    assert.equal(ledger.getStatus('c2b'), 'proposed');
    assert.equal(ledger.getHistory('c2b').length, 2);
  });

  it('gradeOnEventLanding is deterministic and anti-double-grade', () => {
    const ledger = createContractLedger();
    ledger.record({ contractId: 'c3', type: 'created', toStatus: 'proposed' });
    ledger.record({ contractId: 'c3', type: 'status_change', toStatus: 'open' });
    ledger.record({ contractId: 'c3', type: 'status_change', toStatus: 'active' });
    const contract = {
      id: 'c3',
      stake: 100,
      participants: [
        { id: 'alice', side: 'home' },
        { id: 'bob', side: 'away' },
      ],
    };
    const result = { winnerSide: 'home', eventId: 'evt-1' };
    const first = ledger.gradeOnEventLanding(contract, result);
    assert.equal(first.graded, true);
    assert.ok(first.entries.length >= 3); // status + 2 participants
    const second = ledger.gradeOnEventLanding(contract, result);
    assert.equal(second.graded, false);
    assert.equal(second.reason, 'already graded');
    const history = ledger.getHistory('c3');
    const wins = history.filter((e) => e.type === 'graded' && e.side === 'win');
    const losses = history.filter((e) => e.type === 'graded' && e.side === 'lose');
    assert.equal(wins.length, 1);
    assert.equal(wins[0].participant, 'alice');
    assert.equal(wins[0].amount, 100);
    assert.equal(wins[0].expiresAt, null);
    assert.equal(losses.length, 1);
    assert.equal(losses[0].participant, 'bob');
    assert.equal(losses[0].amount, -100);
    assert.equal(ledger.getStatus('c3'), 'graded');
  });

  it('claim pays simulated points and is anti-double-claim', () => {
    const ledger = createContractLedger();
    ledger.record({ contractId: 'c4', type: 'created', toStatus: 'proposed' });
    ledger.record({ contractId: 'c4', type: 'status_change', toStatus: 'active' });
    const contract = {
      id: 'c4',
      stake: 250,
      participants: [
        { id: 'carol', side: 'yes' },
        { id: 'dave', side: 'no' },
      ],
    };
    ledger.gradeOnEventLanding(contract, { winnerSide: 'yes' });
    const claim1 = ledger.claim('c4', 'carol');
    assert.equal(claim1.claimed, true);
    assert.equal(claim1.amount, 250);
    assert.equal(claim1.entry.type, 'claimed');
    const claim2 = ledger.claim('c4', 'carol');
    assert.equal(claim2.claimed, false);
    assert.equal(claim2.reason, 'already claimed');
  });

  it('loser cannot claim', () => {
    const ledger = createContractLedger();
    ledger.record({ contractId: 'c4b', type: 'created', toStatus: 'proposed' });
    ledger.record({ contractId: 'c4b', type: 'status_change', toStatus: 'active' });
    const contract = {
      id: 'c4b',
      stake: 250,
      participants: [
        { id: 'carol', side: 'yes' },
        { id: 'dave', side: 'no' },
      ],
    };
    ledger.gradeOnEventLanding(contract, { winnerSide: 'yes' });
    const claim = ledger.claim('c4b', 'dave');
    assert.equal(claim.claimed, false);
    assert.equal(claim.reason, 'no claimable win');
  });

  it('TIME-TRAVEL: win claimed far in the future still pays (eternal escrow)', () => {
    const ledger = createContractLedger();
    ledger.record({ contractId: 'c5', type: 'created', toStatus: 'proposed' });
    ledger.record({ contractId: 'c5', type: 'status_change', toStatus: 'active' });
    const contract = {
      id: 'c5',
      stake: 77,
      participants: [
        { id: 'eve', side: 'A' },
        { id: 'frank', side: 'B' },
      ],
    };
    ledger.gradeOnEventLanding(contract, { winnerSide: 'A' });
    const farFuture = Date.now() + 1000 * 60 * 60 * 24 * 365 * 100; // ~100 years
    const claim = ledger.claim('c5', 'eve', farFuture);
    assert.equal(claim.claimed, true);
    assert.equal(claim.amount, 77);
    assert.equal(claim.entry.payload.unit, 'TUMBO_POINTS');
    assert.equal(claim.entry.payload.simulated, true);
  });

  it('reverse and cancel append audit entries and never delete history', () => {
    const ledger = createContractLedger();
    ledger.record({ contractId: 'c6', type: 'created', toStatus: 'proposed' });
    ledger.record({ contractId: 'c6', type: 'status_change', toStatus: 'open' });
    const before = ledger.getHistory('c6').length;
    ledger.cancel('c6', 'user withdrew');
    const afterCancel = ledger.getHistory('c6');
    assert.equal(afterCancel.length, before + 1);
    assert.equal(afterCancel[afterCancel.length - 1].type, 'cancelled');
    assert.equal(ledger.getStatus('c6'), 'cancelled');
    // reverse on another contract
    ledger.record({ contractId: 'c7', type: 'created', toStatus: 'proposed' });
    ledger.record({ contractId: 'c7', type: 'status_change', toStatus: 'active' });
    const contract = { id: 'c7', stake: 10, participants: [{ id: 'x', side: 'yes' }] };
    ledger.gradeOnEventLanding(contract, { winnerSide: 'yes' });
    const h1 = ledger.getHistory('c7').length;
    ledger.reverse('c7', 'oracle correction');
    const h2 = ledger.getHistory('c7');
    assert.equal(h2.length, h1 + 1);
    assert.equal(h2[h2.length - 1].type, 'reversed');
    assert.equal(ledger.getStatus('c7'), 'reversed');
  });

  it('getAuditView filters by contractId, participant, from, to', () => {
    const ledger = createContractLedger();
    const t0 = 1_000_000;
    ledger.record({ contractId: 'c8', type: 'created', toStatus: 'proposed', ts: t0 });
    ledger.record({ contractId: 'c8', type: 'joined', participant: 'alice', ts: t0 + 100 });
    ledger.record({ contractId: 'c8', type: 'joined', participant: 'bob', ts: t0 + 200 });
    ledger.record({ contractId: 'c9', type: 'created', toStatus: 'proposed', ts: t0 + 300 });
    const allC8 = ledger.getAuditView({ contractId: 'c8' });
    assert.equal(allC8.length, 3);
    const aliceOnly = ledger.getAuditView({ contractId: 'c8', participant: 'alice' });
    assert.equal(aliceOnly.length, 1);
    assert.equal(aliceOnly[0].participant, 'alice');
    const ranged = ledger.getAuditView({ from: t0 + 150, to: t0 + 250 });
    assert.equal(ranged.length, 1);
    assert.equal(ranged[0].participant, 'bob');
  });

  it('history is frozen and chronological', () => {
    const ledger = createContractLedger();
    ledger.record({ contractId: 'c10', type: 'created', toStatus: 'proposed', ts: 300 });
    ledger.record({ contractId: 'c10', type: 'status_change', toStatus: 'open', ts: 100 });
    ledger.record({ contractId: 'c10', type: 'status_change', toStatus: 'active', ts: 200 });
    const hist = ledger.getHistory('c10');
    assert.equal(hist[0].ts, 100);
    assert.equal(hist[1].ts, 200);
    assert.equal(hist[2].ts, 300);
    assert.ok(Object.isFrozen(hist));
  });
});

describe('lifecycle constants', () => {
  it('exposes frozen status list', () => {
    assert.ok(Array.isArray(LIFECYCLE_STATUSES));
    assert.ok(LIFECYCLE_STATUSES.includes('graded'));
    assert.ok(Object.isFrozen(LIFECYCLE_STATUSES));
  });
});
