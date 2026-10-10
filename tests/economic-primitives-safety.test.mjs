import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createComputeAccount,
  toComputeUnits,
  fromComputeUnits
} from '../src/domains/compute-account.js';
import {
  createComputeExchangeLedger,
  normalizeUsageReceipt,
  selectProviderRoute
} from '../src/domains/compute-exchange.js';
import {
  createContributionVault
} from '../src/domains/contribution-vault.js';
import {
  createEconomicTimeline
} from '../src/domains/economic-timeline.js';
import {
  evaluateComputeEconomics
} from '../src/domains/compute-economics-policy.js';
import {
  createTokenEngine
} from '../src/domains/token.js';
const copy = value => JSON.parse(JSON.stringify(value));
const clock = Date.UTC(2026, 9, 3);

function account(options = {}) {
  const owner = createComputeAccount({
    now: () => clock,
    ...options
  });
  owner.fundDemo({
    fundingId: 'fund',
    amountUsd: 100
  });
  return owner;
}
const usage = (overrides = {}) => ({
  receiptId: 'usage',
  providerId: 'local',
  inputTokens: 3,
  outputTokens: 2,
  reportedCostUsd: 2,
  verified: true,
  ...overrides
});

test('eight-decimal credit amounts are exact, bounded and reject discarded digits', () => {
  assert.equal(toComputeUnits('0.00000001'), 1);
  assert.equal(toComputeUnits('1.0000000100'), 100000001);
  assert.equal(toComputeUnits(1e-8), 1);
  assert.equal(fromComputeUnits(100000001), 1.00000001);
  for (const invalid of [-1, Infinity, NaN, '0.000000001', '90071992.54740992']) assert.throws(() => toComputeUnits(invalid));
});
test('funding ID replay binds amount and never changes accepted history', () => {
  const owner = account(),
    before = owner.exportState();
  owner.fundDemo({
    fundingId: 'fund',
    amountUsd: 100
  });
  assert.deepEqual(owner.exportState(), before);
  assert.throws(() => owner.fundDemo({
    fundingId: 'fund',
    amountUsd: 90
  }), /IDEM_MISMATCH/);
  assert.deepEqual(owner.exportState(), before);
});
test('receipt preflight rejects changed duplicate before any credit debit', () => {
  const credits = account(),
    exchange = createComputeExchangeLedger();
  exchange.record(usage({
    reportedCostUsd: 0,
    verified: false
  }));
  const before = credits.exportState();
  assert.throws(() => exchange.preflightReceipt(usage()), /IDEM_MISMATCH/);
  assert.deepEqual(credits.exportState(), before);
  const original = usage({
      reportedCostUsd: 0,
      verified: false
    }),
    replay = exchange.record(original);
  assert.equal(replay.accepted, false);
  assert.equal(replay.reward.tumboSim, 0);
});
test('unchanged accepted receipt replay returns original sealed receipt and reward', () => {
  const owner = createComputeExchangeLedger(),
    first = owner.record(usage()),
    replay = owner.record(usage());
  assert.equal(replay.receipt, first.receipt);
  assert.equal(replay.reward, first.reward);
  assert.equal(owner.snapshot().totals.calls, 1);
  assert.equal(first.receipt.billingVerified, false);
  assert.equal(first.receipt.verificationBasis, 'declared-local-rehearsal');
});
test('invalid provider usage counts/cost fail closed rather than silently coercing evidence', () => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) assert.throws(() => normalizeUsageReceipt(usage({
    inputTokens: value
  })));
  assert.throws(() => normalizeUsageReceipt(usage({
    inputTokens: Number.MAX_SAFE_INTEGER,
    outputTokens: 1
  })));
  assert.throws(() => normalizeUsageReceipt(usage({
    reportedCostUsd: -1
  })));
});
test('finite latency caps reject unknown latency and explicit missing capability', () => {
  const selected = selectProviderRoute([{
    providerId: 'local',
    estimatedCostUsd: 1
  }], {
    maxLatencyMs: 1000
  });
  assert.equal(selected.selected, null);
  assert.equal(selected.rejected[0].reason, 'latency-cap');
  assert.equal(selectProviderRoute([{
    providerId: 'local',
    estimatedCostUsd: 1,
    meetsCapability: false
  }]).selected, null);
});
test('quote selection preserves model and quote identity', () => {
  const result = selectProviderRoute([{
    providerId: 'local',
    quoteId: 'quote1',
    model: 'local/text-stats',
    estimatedCostUsd: 1,
    estimatedLatencyMs: 5
  }]);
  assert.equal(result.selected.quoteId, 'quote1');
  assert.equal(result.selected.model, 'local/text-stats');
});
test('reservation atomically consumes available credits and task/month budgets', () => {
  const owner = account({
    monthlyBudgetUsd: 20,
    perTaskBudgetUsd: 12
  });
  assert.equal(owner.reserve({
    reservationId: 'a',
    taskId: 'task',
    amountUsd: 8
  }).accepted, true);
  assert.equal(owner.snapshot().availableBalanceUsd, 92);
  assert.equal(owner.snapshot().reservedUsd, 8);
  const before = owner.exportState();
  assert.equal(owner.reserve({
    reservationId: 'b',
    taskId: 'task',
    amountUsd: 5
  }).reason, 'per-task-budget');
  assert.deepEqual(owner.exportState(), before);
  assert.equal(owner.reserve({
    reservationId: 'b',
    taskId: 'other',
    amountUsd: 12
  }).accepted, true);
  assert.equal(owner.reserve({
    reservationId: 'c',
    taskId: 'third',
    amountUsd: 1
  }).reason, 'monthly-budget');
});
test('settlement releases unused hold, charges once, and rejects an overrun', () => {
  const owner = account();
  owner.reserve({
    reservationId: 'a',
    taskId: 'task',
    amountUsd: 10
  });
  const before = owner.exportState();
  assert.equal(owner.settleReservation({
    reservationId: 'a',
    spendId: 's',
    amountUsd: 11
  }).reason, 'reservation-overrun');
  assert.deepEqual(owner.exportState(), before);
  assert.equal(owner.settleReservation({
    reservationId: 'a',
    spendId: 's',
    amountUsd: 6
  }).releasedUnits, toComputeUnits(4));
  assert.equal(owner.snapshot().balanceUsd, 94);
  assert.equal(owner.snapshot().reservedUsd, 0);
  const settled = owner.exportState();
  assert.equal(owner.settleReservation({
    reservationId: 'a',
    spendId: 's',
    amountUsd: 6
  }).duplicate, true);
  assert.deepEqual(owner.exportState(), settled);
  assert.throws(() => owner.settleReservation({
    reservationId: 'a',
    spendId: 's',
    amountUsd: 5
  }), /IDEM_MISMATCH/);
});
test('zero-charge settlement releases reservation and records the job once', () => {
  const owner = account();
  owner.reserve({
    reservationId: 'a',
    amountUsd: 1
  });
  owner.settleReservation({
    reservationId: 'a',
    spendId: 'free',
    amountUsd: 0
  });
  assert.equal(owner.snapshot().balanceUsd, 100);
  assert.equal(owner.snapshot().reservedUsd, 0);
  assert.equal(owner.snapshot().spends[0].units, 0);
});
test('cancellation releases only its own hold and rejects identifier reuse', () => {
  const owner = account();
  owner.reserve({
    reservationId: 'a',
    amountUsd: 4
  });
  owner.reserve({
    reservationId: 'b',
    amountUsd: 6
  });
  owner.cancelReservation({
    reservationId: 'a',
    cancelId: 'cancel'
  });
  assert.equal(owner.snapshot().reservedUsd, 6);
  assert.equal(owner.cancelReservation({
    reservationId: 'a',
    cancelId: 'cancel'
  }).duplicate, true);
  assert.throws(() => owner.cancelReservation({
    reservationId: 'b',
    cancelId: 'cancel'
  }), /IDEM_MISMATCH/);
});
test('multiple receipts for one task cannot bypass the per-task cap', () => {
  const owner = account({
    perTaskBudgetUsd: 10
  });
  owner.spendVerified({
    spendId: 'a',
    taskId: 'same-task',
    amountUsd: 6
  });
  const before = owner.exportState();
  assert.equal(owner.preflightSpend({
    spendId: 'b',
    taskId: 'same-task',
    amountUsd: 5
  }).reason, 'per-task-budget');
  assert.deepEqual(owner.exportState(), before);
  assert.equal(owner.spendVerified({
    spendId: 'b',
    taskId: 'same-task',
    amountUsd: 5
  }).accepted, false);
});
test('calendar-month cap resets while lifetime receipts and task spending remain', () => {
  let time = Date.UTC(2026, 9, 31, 23, 59);
  const owner = account({
    monthlyBudgetUsd: 10,
    perTaskBudgetUsd: 10,
    now: () => time
  });
  owner.spendVerified({
    spendId: 'a',
    taskId: 'old',
    amountUsd: 10
  });
  assert.equal(owner.snapshot().remainingMonthlyBudgetUsd, 0);
  time = Date.UTC(2026, 10, 1);
  assert.equal(owner.snapshot().period, '2026-11');
  assert.equal(owner.snapshot().remainingMonthlyBudgetUsd, 10);
  assert.equal(owner.spendVerified({
    spendId: 'b',
    taskId: 'new',
    amountUsd: 10
  }).accepted, true);
  assert.equal(owner.snapshot().spentUsd, 20);
});
test('held work crossing a month settles against its original authorized period', () => {
  let time = Date.UTC(2026, 9, 31);
  const owner = account({
    monthlyBudgetUsd: 10,
    perTaskBudgetUsd: 10,
    now: () => time
  });
  owner.reserve({
    reservationId: 'a',
    amountUsd: 10
  });
  time = Date.UTC(2026, 10, 1);
  owner.settleReservation({
    reservationId: 'a',
    spendId: 's',
    amountUsd: 8
  });
  assert.equal(owner.snapshot().periodSpentUsd, 0);
  assert.equal(owner.snapshot().spentUsd, 8);
  assert.equal(owner.snapshot().remainingMonthlyBudgetUsd, 10);
});
test('refund is compensating, bounded, payload-bound and restores exact credits', () => {
  const owner = account();
  owner.spendVerified({
    spendId: 's',
    amountUsd: 8
  });
  owner.refund({
    spendId: 's',
    refundId: 'r',
    amountUsd: 3
  });
  assert.equal(owner.snapshot().balanceUsd, 95);
  assert.equal(owner.refund({
    spendId: 's',
    refundId: 'r',
    amountUsd: 3
  }).duplicate, true);
  assert.throws(() => owner.refund({
    spendId: 's',
    refundId: 'r',
    amountUsd: 4
  }), /IDEM_MISMATCH/);
  assert.throws(() => owner.refund({
    spendId: 's',
    refundId: 'too-much',
    amountUsd: 6
  }), /exceeds/);
  owner.refund({
    spendId: 's',
    refundId: 'remainder'
  });
  assert.equal(owner.snapshot().balanceUsd, 100);
  assert.equal(owner.snapshot().spentUsd, 0);
});
test('credit export restores reservations/spends/refunds and rejects corrupt replay atomically', () => {
  const original = account();
  original.reserve({
    reservationId: 'held',
    amountUsd: 4
  });
  original.spendVerified({
    spendId: 's',
    amountUsd: 3
  });
  original.refund({
    spendId: 's',
    refundId: 'r',
    amountUsd: 1
  });
  const restored = createComputeAccount({
    now: () => clock
  });
  restored.importState(copy(original.exportState()));
  assert.deepEqual(restored.snapshot(), original.snapshot());
  const before = restored.exportState(),
    bad = copy(before);
  bad.events[0].args.amountUsd = 90;
  assert.throws(() => restored.importState(bad));
  assert.deepEqual(restored.exportState(), before);
});
test('exchange import retains replay binding and rejects tampered state without erasure', () => {
  const owner = createComputeExchangeLedger();
  owner.record(usage());
  const restored = createComputeExchangeLedger();
  restored.importState(copy(owner.exportState()));
  assert.deepEqual(restored.snapshot(), owner.snapshot());
  assert.equal(restored.preflightReceipt(usage()).duplicate, true);
  const before = restored.exportState(),
    bad = copy(before);
  bad.receipts[0].reportedCostUsd = 100;
  assert.throws(() => restored.importState(bad));
  assert.deepEqual(restored.exportState(), before);
});
test('margin allocation conserves the minimum monetary unit with no negative residual', () => {
  const value = evaluateComputeEconomics({
    customerRevenueUsd: 1e-8,
    rewardBudgetRate: .5,
    treasuryReserveRate: .5,
    futureBurnBudgetRate: 0
  });
  assert.equal(value.retainedMarginUnits, 1);
  assert.equal(value.rewardBudgetUnits, 0);
  assert.equal(value.treasuryReserveUnits, 0);
  for (let units = 1; units < 501; units++) {
    const row = evaluateComputeEconomics({
      customerRevenueUsd: fromComputeUnits(units),
      rewardBudgetRate: .3333,
      treasuryReserveRate: .3333,
      futureBurnBudgetRate: .3333
    });
    assert.equal(row.rewardBudgetUnits + row.treasuryReserveUnits + row.futureBurnBudgetUnits + row.retainedMarginUnits, units);
    assert.ok(row.retainedMarginUnits >= 0);
  }
});
test('timeline payload is copied deeply and restored chain rejects corrupt ordering', () => {
  const timeline = createEconomicTimeline(),
    payload = {
      amount: 1,
      rows: [{
        value: 'original'
      }]
    };
  timeline.append({
    type: 'settled',
    payload
  });
  payload.rows[0].value = 'changed';
  assert.equal(timeline.snapshot().events[0].payload.rows[0].value, 'original');
  assert.equal(timeline.verify(), true);
  assert.throws(() => {
    timeline.snapshot().events[0].payload.amount = 9;
  });
  const restored = createEconomicTimeline();
  restored.importState(copy(timeline.exportState()));
  assert.deepEqual(restored.snapshot(), timeline.snapshot());
  const before = restored.exportState(),
    bad = copy(before);
  bad.events[0].payload.amount = 999;
  assert.throws(() => restored.importState(bad));
  assert.deepEqual(restored.exportState(), before);
});
test('timeline rejects cyclic, executable and non-finite metadata before append', () => {
  const owner = createEconomicTimeline(),
    cycle = {};
  cycle.self = cycle;
  for (const payload of [cycle, {
      run: () => 1
    }, {
      cost: Infinity
    }]) assert.throws(() => owner.append({
    type: 'bad',
    payload
  }));
  assert.equal(owner.snapshot().events.length, 0);
});
test('provider-specific consent binds acceptance and preserves one immutable entitlement', () => {
  const owner = createContributionVault({
    now: () => clock
  });
  owner.propose({
    contributionId: 'c',
    units: 100
  });
  assert.throws(() => owner.authorize('c', {
    scope: 'provider-specific'
  }), /providerId/);
  owner.authorize('c', {
    scope: 'provider-specific',
    providerId: 'local'
  });
  assert.throws(() => owner.accept('c', {
    evidenceId: 'e',
    providerId: 'openai'
  }), /does not match/);
  const accepted = owner.accept('c', {
    evidenceId: 'e',
    providerId: 'local'
  });
  assert.equal(accepted.record.rewardFluff, 100);
  assert.equal(owner.accept('c', {
    evidenceId: 'e',
    providerId: 'local'
  }).duplicate, true);
  owner.revoke('c');
  assert.throws(() => owner.authorize('c', {
    scope: 'provider-specific',
    providerId: 'local'
  }), /Revoked/);
  assert.equal(owner.preflightClaim({
    contributionId: 'c',
    claimId: 'claim'
  }).accepted, false);
});
test('acceptance evidence and reward claims cannot be reused across contributions', () => {
  const owner = createContributionVault({
    now: () => clock
  });
  for (const contributionId of ['a', 'b']) {
    owner.propose({
      contributionId
    });
    owner.authorize(contributionId);
  }
  owner.accept('a', {
    evidenceId: 'ea'
  });
  assert.throws(() => owner.accept('b', {
    evidenceId: 'ea'
  }), /already bound/);
  owner.accept('b', {
    evidenceId: 'eb'
  });
  owner.claimReward({
    contributionId: 'a',
    claimId: 'pay'
  });
  assert.equal(owner.claimReward({
    contributionId: 'a',
    claimId: 'pay'
  }).duplicate, true);
  assert.throws(() => owner.claimReward({
    contributionId: 'b',
    claimId: 'pay'
  }), /IDEM_MISMATCH/);
  assert.equal(owner.snapshot().claimedRewardTumboSim, .001);
});
test('retention expiration blocks acceptance and unclaimed entitlement payout', () => {
  let time = clock;
  const owner = createContributionVault({
    now: () => time
  });
  owner.propose({
    contributionId: 'a',
    retentionDays: 1
  });
  owner.authorize('a');
  owner.propose({
    contributionId: 'b',
    retentionDays: 1
  });
  owner.authorize('b');
  owner.accept('b', {
    evidenceId: 'b'
  });
  time += 86400000;
  assert.throws(() => owner.accept('a', {
    evidenceId: 'a'
  }), /expired/);
  assert.throws(() => owner.claimReward({
    contributionId: 'b',
    claimId: 'b'
  }), /expired/);
  assert.equal(owner.snapshot().contributions[1].rewardClaimable, false);
});
test('consent export replays accepted claims and rejects changed evidence atomically', () => {
  const owner = createContributionVault({
    now: () => clock
  });
  owner.propose({
    contributionId: 'c'
  });
  owner.authorize('c');
  owner.accept('c', {
    evidenceId: 'e'
  });
  owner.claimReward({
    contributionId: 'c',
    claimId: 'pay'
  });
  owner.revoke('c');
  const restored = createContributionVault({
    now: () => clock
  });
  restored.importState(copy(owner.exportState()));
  assert.deepEqual(restored.snapshot(), owner.snapshot());
  const before = restored.exportState(),
    bad = copy(before);
  bad.events[2].args.evidenceId = 'forged';
  assert.throws(() => restored.importState(bad));
  assert.deepEqual(restored.exportState(), before);
});
test('prepared claim fixes authorization time across expiry and rejects forged preparations', () => {
  let time = clock;
  const owner = createContributionVault({
    now: () => time
  });
  owner.propose({
    contributionId: 'c',
    retentionDays: 1
  });
  owner.authorize('c');
  owner.accept('c', {
    evidenceId: 'e'
  });
  time += 86400000 - 1;
  const prepared = owner.preflightClaim({
    contributionId: 'c',
    claimId: 'pay'
  });
  assert.throws(() => owner.commitPreparedClaim(copy(prepared), () => ({
    id: 'forged'
  })), /stale or forged/);
  time += 2;
  const result = owner.commitPreparedClaim(prepared, () => ({
    id: 'funded-receipt'
  }));
  assert.equal(result.claim.record.claimId, 'pay');
  assert.equal(owner.exportState().events.at(-1).at, clock + 86400000 - 1);
});
test('prepared claim blocks ledger-observer consent mutations during funded posting', () => {
  const owner = createContributionVault({
      now: () => clock
    }),
    engine = createTokenEngine();
  owner.propose({
    contributionId: 'c',
    units: 10
  });
  owner.authorize('c');
  owner.accept('c', {
    evidenceId: 'e'
  });
  owner.propose({
    contributionId: 'other'
  });
  owner.authorize('other');
  engine.faucet('u:source', 'TUMBO', 100, {
    idempotencyKey: 'source'
  });
  const blocked = [];
  engine.ledger.onCommit(() => {
    for (const change of [() => owner.revoke('c'), () => owner.accept('other', {
        evidenceId: 'other'
      }), () => owner.claimReward({
        contributionId: 'c',
        claimId: 'nested'
      })]) {
      try {
        change();
        blocked.push(false);
      } catch (error) {
        blocked.push(/cannot re-enter/.test(error.message));
      }
    }
  });
  const prepared = owner.preflightClaim({
    contributionId: 'c',
    claimId: 'pay'
  });
  const result = owner.commitPreparedClaim(prepared, () => engine.ledger.post([{
    account: 'u:source',
    asset: 'TUMBO',
    amount: -10
  }, {
    account: 'u:beneficiary',
    asset: 'TUMBO',
    amount: 10
  }], {
    idempotencyKey: 'funded-reward',
    action: 'reward'
  }));
  assert.deepEqual(blocked, [true, true, true]);
  assert.equal(result.claim.record.claimId, 'pay');
  assert.equal(owner.snapshot().contributions[0].state, 'accepted');
  assert.equal(engine.balance('u:beneficiary', 'TUMBO'), 10);
  assert.equal(engine.ledger.verifyChain().ok, true);
});
test('failed or asynchronous settlement does not consume a prepared entitlement', () => {
  const owner = createContributionVault({
    now: () => clock
  });
  owner.propose({
    contributionId: 'c'
  });
  owner.authorize('c');
  owner.accept('c', {
    evidenceId: 'e'
  });
  const prepared = owner.preflightClaim({
      contributionId: 'c',
      claimId: 'pay'
    }),
    before = owner.exportState();
  assert.throws(() => owner.commitPreparedClaim(prepared, () => {
    throw new Error('pool insufficient');
  }), /pool insufficient/);
  let invoked = false;
  assert.throws(() => owner.commitPreparedClaim(prepared, async () => {
    invoked = true;
  }), /synchronous/);
  assert.equal(invoked, false);
  assert.throws(() => owner.commitPreparedClaim(prepared, () => Promise.resolve({})), /synchronously/);
  assert.deepEqual(owner.exportState(), before);
  assert.equal(owner.preflightClaim({
    contributionId: 'c',
    claimId: 'pay'
  }).accepted, true);
});
test('funded compute reward locks observer refunds and durably protects exact spend', () => {
  const owner = account(),
    engine = createTokenEngine();
  owner.spendVerified({
    spendId: 's',
    providerId: 'local',
    taskId: 'job',
    amountUsd: 10
  });
  engine.faucet('u:source', 'TUMBO', 1000, {
    idempotencyKey: 'source'
  });
  let blocked = false;
  engine.ledger.onCommit(() => {
    try {
      owner.refund({
        spendId: 's',
        refundId: 'observer'
      });
    } catch (error) {
      blocked = /cannot re-enter/.test(error.message);
    }
  });
  const prepared = owner.preflightRewardDebit({
    spendId: 's',
    rewardId: 'reward'
  });
  assert.equal(prepared.amountUnits, toComputeUnits(10));
  assert.equal(prepared.providerId, 'local');
  const result = owner.commitPreparedRewardDebit(prepared, () => engine.ledger.post([{
    account: 'u:source',
    asset: 'TUMBO',
    amount: -1000
  }, {
    account: 'u:beneficiary',
    asset: 'TUMBO',
    amount: 1000
  }], {
    idempotencyKey: 'funded',
    action: 'compute-reward'
  }));
  assert.equal(blocked, true);
  assert.equal(result.protection.rewardId, 'reward');
  assert.throws(() => owner.refund({
    spendId: 's',
    refundId: 'direct'
  }), /reconciliation/);
  assert.equal(owner.preflightRewardDebit({
    spendId: 's',
    rewardId: 'reward'
  }).duplicate, true);
  const restored = createComputeAccount({
    now: () => clock
  });
  restored.importState(copy(owner.exportState()));
  assert.deepEqual(restored.snapshot(), owner.snapshot());
  assert.throws(() => restored.refund({
    spendId: 's',
    refundId: 'reload'
  }), /reconciliation/);
});
test('failed, asynchronous or stale funded-reward preparation cannot protect or debit credits', () => {
  const owner = account();
  owner.spendVerified({
    spendId: 's',
    amountUsd: 10
  });
  const prepared = owner.preflightRewardDebit({
      spendId: 's',
      rewardId: 'reward'
    }),
    before = owner.exportState();
  assert.throws(() => owner.commitPreparedRewardDebit(prepared, () => {
    throw new Error('reward pool empty');
  }), /reward pool empty/);
  let invoked = false;
  assert.throws(() => owner.commitPreparedRewardDebit(prepared, async () => {
    invoked = true;
  }), /synchronous/);
  assert.equal(invoked, false);
  assert.throws(() => owner.commitPreparedRewardDebit(copy(prepared), () => {
    invoked = true;
  }), /forged/);
  assert.deepEqual(owner.exportState(), before);
  owner.setBudget({
    monthlyBudgetUsd: 99
  });
  assert.throws(() => owner.commitPreparedRewardDebit(prepared, () => {
    invoked = true;
  }), /stale/);
  assert.equal(invoked, false);
  assert.equal(owner.refund({
    spendId: 's',
    refundId: 'refund'
  }).accepted, true);
});
test('partially refunded and zero-cost debits cannot earn funded compute rewards', () => {
  const owner = account();
  owner.spendVerified({
    spendId: 's',
    amountUsd: 10
  });
  owner.refund({
    spendId: 's',
    refundId: 'r',
    amountUsd: 1
  });
  assert.throws(() => owner.preflightRewardDebit({
    spendId: 's',
    rewardId: 'reward'
  }), /unrefunded/);
  owner.reserve({
    reservationId: 'free',
    amountUsd: 1
  });
  owner.settleReservation({
    reservationId: 'free',
    spendId: 'zero',
    amountUsd: 0
  });
  assert.throws(() => owner.preflightRewardDebit({
    spendId: 'zero',
    rewardId: 'free-reward'
  }), /positive/);
});

test('timeline events respect the shared bundle row, field, and wrapper-depth limits before append', () => {
  const timeline = createEconomicTimeline();
  assert.throws(() => timeline.append({
    type: 'rows',
    payload: Array(4001).fill(0)
  }), /rows exceed/);
  assert.throws(() => timeline.append({
    type: 'fields',
    payload: Object.fromEntries(Array.from({
      length: 101
    }, (_, index) => [`key${index}`, 0]))
  }), /fields exceed/);
  let deep = 0;
  for (let index = 0; index < 15; index++) deep = {
    child: deep
  };
  assert.throws(() => timeline.append({
    type: 'deep',
    payload: deep
  }), /nesting exceeds/);
  assert.throws(() => timeline.append({
    type: 'sparse',
    payload: Array(2)
  }), /missing entries/);
  assert.throws(() => timeline.append({
    type: 'x'.repeat(8193)
  }), /text exceeds/);
  assert.throws(() => timeline.append({
    type: 'source',
    source: 'x'.repeat(8193)
  }), /text exceeds/);
  assert.equal(timeline.snapshot().events.length, 0);
  assert.equal(timeline.verify(), true);
});

test('timeline export budget rejects an oversized event and aggregate append without losing accepted history', () => {
  const timeline = createEconomicTimeline({
    maxExportChars: 1000
  });
  const first = timeline.append({
    type: 'first',
    payload: {
      value: 'x'.repeat(200)
    }
  });
  const before = timeline.exportState();
  assert.throws(() => timeline.append({
    type: 'large',
    payload: {
      value: 'x'.repeat(800)
    }
  }), /export capacity/);
  assert.deepEqual(timeline.exportState(), before);
  assert.equal(timeline.snapshot().events[0], first);
  assert.ok(JSON.stringify(before).length <= 1000);
  const large = createEconomicTimeline();
  assert.throws(() => large.append({
    type: 'aggregate',
    payload: Array(130).fill('x'.repeat(8192))
  }), /export capacity/);
  assert.equal(large.snapshot().events.length, 0);
});

test('timeline import rejects a valid but over-budget chain atomically and preserves strict replay', () => {
  const large = createEconomicTimeline();
  large.append({
    type: 'large',
    payload: {
      value: 'x'.repeat(1500)
    }
  });
  const small = createEconomicTimeline({
    maxExportChars: 1000
  });
  small.append({
    type: 'kept',
    payload: {
      value: 1
    }
  });
  const before = small.exportState();
  assert.throws(() => small.importState(large.exportState()), /export capacity/);
  assert.deepEqual(small.exportState(), before);
  const restored = createEconomicTimeline({
    maxExportChars: 1000
  });
  assert.deepEqual(restored.importState(before), before);
});
