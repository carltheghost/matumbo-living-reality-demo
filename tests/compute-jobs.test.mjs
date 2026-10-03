import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTokenEngine
} from '../src/domains/token.js?v=20261003-complete8';
import {
  createEconomicKernel,
  economicDigest,
  ECONOMIC_POOLS
} from '../src/domains/economic-kernel.js?v=20261003-complete8';
import {
  createComputeJobs,
  runLocalComputeTool
} from '../src/domains/compute-jobs.js?v=20261003-complete8';
import {
  createComputeAccount
} from '../src/domains/compute-account.js?v=20261003-complete8';
import {
  createComputeExchangeLedger
} from '../src/domains/compute-exchange.js?v=20261003-complete8';
import {
  createContributionVault
} from '../src/domains/contribution-vault.js?v=20261003-complete8';
const at = Date.UTC(2026, 9, 3);

function fixture() {
  const engine = createTokenEngine(),
    kernel = createEconomicKernel({
      engine,
      clock: () => at
    });
  const account = createComputeAccount({
      now: () => at
    }),
    exchange = createComputeExchangeLedger(),
    contributions = createContributionVault({
      now: () => at
    });
  const jobs = createComputeJobs(kernel, {
    account,
    exchange,
    contributions
  });
  account.fundDemo({
    fundingId: 'fund',
    amountUsd: '10'
  });
  return {
    engine,
    kernel,
    account,
    exchange,
    contributions,
    jobs
  };
}

function run(f, jobId = 'job', costUsd = '0.02') {
  const request = {
    jobId,
    providerId: 'local',
    model: 'text-summary',
    privacy: 'local-only',
    ceilingUsd: '0.05',
    taskHash: economicDigest({
      text: 'Hello'
    }),
    idempotencyKey: `reserve:${jobId}`
  };
  f.jobs.reserveTask(request);
  const tool = runLocalComputeTool('text-summary', 'Hello Tumbo. This is a real local tool.');
  f.jobs.recordExecution({
    jobId,
    executionId: `run:${economicDigest({ jobId }).slice(0, 32)}`,
    mode: 'local-tool',
    inputTokens: 0,
    outputTokens: 0,
    outputHash: tool.outputHash,
    idempotencyKey: `exec:${jobId}`
  });
  return f.jobs.reconcileTask({
    jobId,
    costUsd,
    billingMode: 'explicit-demo',
    explicit: true,
    idempotencyKey: `settle:${jobId}`
  });
}
test('real local tool runs behind reservation and reconciliation releases unused credit', () => {
  const f = fixture();
  const row = run(f);
  assert.equal(row.status, 'settled-demo');
  assert.equal(f.account.snapshot().balanceUsd, 9.98);
  assert.equal(f.account.snapshot().reservedUsd, 0);
  assert.equal(f.exchange.snapshot().totals.calls, 1);
  assert.equal(f.exchange.snapshot().receipts[0].billingVerified, false);
  assert.equal(runLocalComputeTool('text-summary', 'Hello Tumbo.').words, 2);
});
test('privacy gate rejects external reservations and overrun leaves credits held and unchanged', () => {
  const f = fixture();
  assert.throws(() => f.jobs.reserveTask({
    jobId: 'bad',
    providerId: 'nvidia',
    model: 'model',
    privacy: 'local-only',
    ceilingUsd: '1',
    taskHash: economicDigest({
      x: 1
    }),
    idempotencyKey: 'bad'
  }), /Local-only/);
  f.jobs.reserveTask({
    jobId: 'held',
    providerId: 'local',
    model: 'text-summary',
    privacy: 'local-only',
    ceilingUsd: '0.05',
    taskHash: economicDigest({
      x: 1
    }),
    idempotencyKey: 'held'
  });
  f.jobs.recordExecution({
    jobId: 'held',
    executionId: 'run',
    mode: 'local-tool',
    inputTokens: 0,
    outputTokens: 0,
    outputHash: economicDigest({
      result: 1
    }),
    idempotencyKey: 'run'
  });
  assert.throws(() => f.jobs.reconcileTask({
    jobId: 'held',
    costUsd: '0.06',
    billingMode: 'explicit-demo',
    explicit: true,
    idempotencyKey: 'too-much'
  }), /ceiling/);
  assert.equal(f.account.snapshot().balanceUsd, 10);
  assert.equal(f.account.snapshot().reservedUsd, .05);
  f.jobs.cancelTask({
    jobId: 'held',
    idempotencyKey: 'cancel'
  });
  assert.equal(f.account.snapshot().reservedUsd, 0);
});
test('free reconciled work earns no reward and never becomes a provider billing claim', () => {
  const f = fixture();
  const row = run(f, 'free', '0');
  assert.equal(f.account.snapshot().balanceUsd, 10);
  assert.equal(f.account.snapshot().reservedUsd, 0);
  assert.throws(() => f.jobs.claimIncentive({
    kind: 'compute',
    evidenceId: row.receiptId,
    beneficiary: 'u:you',
    idempotencyKey: 'free-reward'
  }), /cost receipt/);
});
test('compute reward is a real finite canonical pool transfer, once per evidence', () => {
  const f = fixture();
  const row = run(f);
  assert.throws(() => f.jobs.claimIncentive({
    kind: 'compute',
    evidenceId: row.receiptId,
    beneficiary: 'u:you',
    idempotencyKey: 'unfunded'
  }), /insufficient/);
  f.engine.faucet('u:you', 'TUMBO', 1000, {
    idempotencyKey: 'token-fund'
  });
  f.kernel.fundPool({
    from: 'u:you',
    purpose: 'rewards',
    amountFluff: 100,
    idempotencyKey: 'rewards'
  });
  const input = {
    kind: 'compute',
    evidenceId: row.receiptId,
    beneficiary: 'u:you',
    idempotencyKey: 'paid'
  };
  const claim = f.jobs.claimIncentive(input);
  assert.equal(claim.amountFluff, 2);
  assert.equal(f.kernel.balance(ECONOMIC_POOLS.rewards), 98);
  assert.equal(f.kernel.balance('u:you'), 902);
  assert.equal(f.jobs.claimIncentive(input), claim);
  assert.throws(() => f.jobs.claimIncentive({
    ...input,
    idempotencyKey: 'farm'
  }), /already/);
  assert.throws(() => f.jobs.refundTask({
    jobId: 'job',
    idempotencyKey: 'refund'
  }), /paid usage reward/);
  assert.throws(() => f.account.refund({
    spendId: row.receiptId,
    refundId: 'direct-refund'
  }), /Funded reward protects/);
  assert.equal(f.kernel.proof().conserved, true);
});
test('refund restores credits and blocks subsequent reward eligibility', () => {
  const f = fixture();
  const row = run(f);
  f.jobs.refundTask({
    jobId: 'job',
    idempotencyKey: 'refund'
  });
  assert.equal(f.account.snapshot().balanceUsd, 10);
  assert.throws(() => f.jobs.claimIncentive({
    kind: 'compute',
    evidenceId: row.receiptId,
    beneficiary: 'u:you',
    idempotencyKey: 'claim'
  }), /Refunded/);
});
test('accepted metadata contribution consumes its entitlement only after a funded journal', () => {
  const f = fixture();
  f.contributions.propose({
    contributionId: 'contribution',
    category: 'task-pattern',
    units: 3,
    purpose: 'aggregate product research',
    retentionDays: 30
  });
  f.contributions.authorize('contribution', {
    scope: 'aggregate-only',
    allowTraining: false,
    allowResearch: true
  });
  f.contributions.accept('contribution', {
    evidenceId: 'consent-evidence'
  });
  const input = {
    kind: 'contribution',
    evidenceId: 'contribution',
    beneficiary: 'u:you',
    idempotencyKey: 'claim'
  };
  assert.throws(() => f.jobs.claimIncentive(input), /insufficient/);
  assert.equal(f.contributions.preflightClaim({
    contributionId: 'contribution',
    claimId: 'claim'
  }).accepted, true);
  f.engine.faucet('u:you', 'TUMBO', 10, {
    idempotencyKey: 'fund-token'
  });
  f.kernel.fundPool({
    from: 'u:you',
    purpose: 'rewards',
    amountFluff: 10,
    idempotencyKey: 'pool'
  });
  const result = f.jobs.claimIncentive(input);
  assert.equal(result.amountFluff, 3);
  assert.equal(f.contributions.snapshot().contributions[0].claimId, 'claim');
});

test('cross-stream validation covers held, cancelled, free, paid, and refunded job transitions', () => {
  const f = fixture();
  const request = id => ({
    jobId: id,
    providerId: 'local',
    model: 'text-summary',
    privacy: 'local-only',
    ceilingUsd: '0.05',
    taskHash: economicDigest({
      id
    }),
    idempotencyKey: `reserve:${id}`
  });
  f.jobs.reserveTask(request('held'));
  f.jobs.reserveTask(request('cancelled'));
  f.jobs.cancelTask({
    jobId: 'cancelled',
    idempotencyKey: 'cancel'
  });
  run(f, 'free', '0');
  run(f, 'refunded');
  f.jobs.refundTask({
    jobId: 'refunded',
    idempotencyKey: 'refund'
  });
  const paid = run(f, 'paid');
  f.engine.faucet('u:you', 'TUMBO', 100, {
    idempotencyKey: 'fund-token'
  });
  f.kernel.fundPool({
    from: 'u:you',
    purpose: 'rewards',
    amountFluff: 100,
    idempotencyKey: 'pool'
  });
  f.jobs.claimIncentive({
    kind: 'compute',
    evidenceId: paid.receiptId,
    beneficiary: 'u:you',
    idempotencyKey: 'reward'
  });
  assert.deepEqual(f.jobs.validateRestoredState(), {
    ok: true,
    jobCount: 5,
    claimCount: 1,
    canonicalChainValid: true
  });
});

test('direct credit compensation cannot silently diverge from a settled job projection', () => {
  const f = fixture(),
    job = run(f);
  f.account.refund({
    spendId: job.receiptId,
    refundId: 'off-owner-refund'
  });
  assert.throws(() => f.jobs.validateRestoredState(), /job refund state differs/);
});

test('owner validation rejects orphan job reservations and standalone consumed consent', () => {
  const f = fixture();
  f.account.reserve({
    reservationId: 'job:orphan',
    taskId: 'orphan',
    providerId: 'local',
    amountUsd: '0.05'
  });
  assert.throws(() => f.jobs.validateRestoredState(), /orphan job credit reservation/);
  const other = fixture();
  other.contributions.propose({
    contributionId: 'standalone',
    units: 3,
    purpose: 'aggregate rehearsal'
  });
  other.contributions.authorize('standalone');
  other.contributions.accept('standalone', {
    evidenceId: 'accepted'
  });
  other.contributions.claimReward({
    contributionId: 'standalone',
    claimId: 'unfunded-consumption'
  });
  assert.throws(() => other.jobs.validateRestoredState(), /consumed consent entitlement has no corresponding funded claim/);
});

test('maximum-length job identity completes its reserve, reconciliation, and protected reward lifecycle', () => {
  const f = fixture(),
    jobId = 'j'.repeat(120),
    job = run(f, jobId);
  assert.equal(job.receiptId.length, 130);
  f.engine.faucet('u:you', 'TUMBO', 10, {
    idempotencyKey: 'tokens'
  });
  f.kernel.fundPool({
    from: 'u:you',
    purpose: 'rewards',
    amountFluff: 10,
    idempotencyKey: 'pool'
  });
  const claim = f.jobs.claimIncentive({
    kind: 'compute',
    evidenceId: job.receiptId,
    beneficiary: 'u:you',
    idempotencyKey: 'reward'
  });
  assert.equal(claim.amountFluff, 2);
  assert.equal(f.jobs.validateRestoredState().ok, true);
  assert.throws(() => f.jobs.claimIncentive({
    kind: 'compute',
    evidenceId: 'x'.repeat(153),
    beneficiary: 'u:you',
    idempotencyKey: 'too-long'
  }), /at most 152/);
});

test('the full bounded contribution identity remains claimable and over-bound evidence is rejected', () => {
  const f = fixture(),
    contributionId = 'c'.repeat(160);
  f.contributions.propose({
    contributionId,
    units: 3,
    purpose: 'aggregate rehearsal'
  });
  f.contributions.authorize(contributionId);
  f.contributions.accept(contributionId, {
    evidenceId: 'accepted'
  });
  f.engine.faucet('u:you', 'TUMBO', 10, {
    idempotencyKey: 'tokens'
  });
  f.kernel.fundPool({
    from: 'u:you',
    purpose: 'rewards',
    amountFluff: 10,
    idempotencyKey: 'pool'
  });
  const claim = f.jobs.claimIncentive({
    kind: 'contribution',
    evidenceId: contributionId,
    beneficiary: 'u:you',
    idempotencyKey: 'reward'
  });
  assert.equal(claim.amountFluff, 3);
  assert.equal(f.jobs.validateRestoredState().ok, true);
  assert.throws(() => f.jobs.claimIncentive({
    kind: 'contribution',
    evidenceId: 'c'.repeat(161),
    beneficiary: 'u:you',
    idempotencyKey: 'too-long'
  }), /at most 160/);
});

test('model identity cannot be silently truncated by reconciliation after a credit hold', () => {
  const f = fixture();
  assert.throws(() => f.jobs.reserveTask({
    jobId: 'model',
    providerId: 'local',
    model: 'm'.repeat(121),
    privacy: 'local-only',
    ceilingUsd: '0.05',
    taskHash: economicDigest({
      x: 1
    }),
    idempotencyKey: 'reserve'
  }), /at most 120/);
  assert.equal(f.account.snapshot().reservedUnits, 0);
  assert.equal(f.jobs.snapshot().jobs.length, 0);
  f.jobs.reserveTask({
    jobId: 'model',
    providerId: 'local',
    model: 'm'.repeat(120),
    privacy: 'local-only',
    ceilingUsd: '0.05',
    taskHash: economicDigest({
      x: 1
    }),
    idempotencyKey: 'reserve'
  });
  f.jobs.recordExecution({
    jobId: 'model',
    executionId: 'execution',
    mode: 'local-tool',
    inputTokens: 0,
    outputTokens: 0,
    outputHash: economicDigest({
      output: 1
    }),
    idempotencyKey: 'execute'
  });
  f.jobs.reconcileTask({
    jobId: 'model',
    costUsd: '0.02',
    billingMode: 'explicit-demo',
    explicit: true,
    idempotencyKey: 'reconcile'
  });
  assert.equal(f.jobs.validateRestoredState().ok, true);
});
