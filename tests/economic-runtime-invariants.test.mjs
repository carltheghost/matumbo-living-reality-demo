import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTokenEngine
} from '../src/domains/token.js?v=20261003-complete8';
import {
  createEconomicRuntime,
  ECONOMIC_STORAGE_KEY
} from '../src/domains/economic-runtime.js?v=20261003-complete8';
import {
  economicDigest
} from '../src/domains/economic-kernel.js?v=20261003-complete8';
import {
  runLocalComputeTool
} from '../src/domains/compute-jobs.js?v=20261003-complete8';
import {
  economicChecksum,
  stableEconomicString
} from '../src/domains/economic-timeline.js?v=20261003-complete8';

const at = Date.UTC(2026, 9, 3);

function fixture(raw = null) {
  const rows = new Map(raw ? [
    [ECONOMIC_STORAGE_KEY, raw]
  ] : []);
  const storage = {
    getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value)
  };
  const engine = createTokenEngine(),
    runtime = createEconomicRuntime({
      engine,
      storage,
      clock: () => at
    });
  return {
    engine,
    runtime,
    storage
  };
}

function resign(bundle) {
  const {
    digest,
    ...body
  } = bundle;
  return JSON.stringify({
    ...body,
    digest: economicDigest(body)
  });
}

function reconcile(f, id = 'job', costUsd = '0.02') {
  f.runtime.compute.reserveTask({
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
  const tool = runLocalComputeTool('text-summary', 'A local tool runs. An explicit simulated charge follows.');
  f.runtime.compute.recordExecution({
    jobId: id,
    executionId: `execution:${id}`,
    mode: 'local-tool',
    inputTokens: 0,
    outputTokens: 0,
    outputHash: tool.outputHash,
    idempotencyKey: `execute:${id}`
  });
  return f.runtime.compute.reconcileTask({
    jobId: id,
    costUsd,
    billingMode: 'explicit-demo',
    explicit: true,
    idempotencyKey: `reconcile:${id}`
  });
}

function paidFixture() {
  const f = fixture();
  f.engine.faucet('u:you', 'TUMBO', 1000, {
    idempotencyKey: 'token-fund'
  });
  f.runtime.kernel.fundPool({
    from: 'u:you',
    purpose: 'rewards',
    amountFluff: 100,
    idempotencyKey: 'pool'
  });
  f.runtime.account.fundDemo({
    fundingId: 'credits',
    amountUsd: '10'
  });
  const job = reconcile(f);
  f.runtime.compute.claimIncentive({
    kind: 'compute',
    evidenceId: job.receiptId,
    beneficiary: 'u:you',
    idempotencyKey: 'usage-reward'
  });
  f.runtime.vault.propose({
    contributionId: 'consent',
    units: 5,
    purpose: 'aggregate rehearsal'
  });
  f.runtime.vault.authorize('consent');
  f.runtime.vault.accept('consent', {
    evidenceId: 'accepted-metadata'
  });
  f.runtime.compute.claimIncentive({
    kind: 'contribution',
    evidenceId: 'consent',
    beneficiary: 'u:you',
    idempotencyKey: 'consent-reward'
  });
  return f;
}

function assertRejected(raw, pattern) {
  const f = fixture(raw);
  assert.match(f.runtime.snapshot().restoreStatus, /stored-history-rejected/);
  assert.match(f.runtime.snapshot().restoreStatus, pattern);
  assert.equal(f.engine.ledger.journalCount(), 4, 'a rejected bundle must not replace the fresh canonical owner');
  assert.equal(f.engine.balance('u:you', 'TUMBO'), 0);
  assert.equal(f.runtime.account.snapshot().balanceUnits, 0);
  f.runtime.dispose();
}

test('paid compute and consent reload exactly once with protected debit and consumed entitlement', () => {
  const source = paidFixture(),
    count = source.engine.ledger.journalCount();
  const restored = fixture(source.runtime.exportState());
  assert.equal(restored.runtime.snapshot().restoreStatus, 'restored-validated-local-bundle');
  assert.equal(restored.engine.ledger.journalCount(), count);
  assert.deepEqual(restored.runtime.account.snapshot(), source.runtime.account.snapshot());
  assert.deepEqual(restored.runtime.compute.validateRestoredState(), {
    ok: true,
    jobCount: 1,
    claimCount: 2,
    canonicalChainValid: true
  });
  assert.equal(restored.runtime.vault.snapshot().contributions[0].claimId, 'consent-reward');
  assert.throws(() => restored.runtime.account.refund({
    spendId: 'job-usage:job',
    refundId: 'farm'
  }), /Funded reward protects/);
  source.runtime.dispose();
  restored.runtime.dispose();
});

test('a valid credit prefix missing only paid reward protection cannot restore', () => {
  const source = paidFixture(),
    bundle = JSON.parse(source.runtime.exportState());
  assert.equal(bundle.account.events.at(-1).type, 'credits.reward-protected');
  bundle.account.events.pop();
  assertRejected(resign(bundle), /paid usage claim lacks its protected exact credit debit/);
  source.runtime.dispose();
});

test('a valid consent prefix missing only consumed reward acknowledgement cannot restore', () => {
  const source = paidFixture(),
    bundle = JSON.parse(source.runtime.exportState());
  assert.equal(bundle.vault.events.at(-1).type, 'contribution.reward-claimed');
  bundle.vault.events.pop();
  assertRejected(resign(bundle), /paid contribution claim lacks its consumed immutable consent entitlement/);
  source.runtime.dispose();
});

test('a separately valid usage prefix cannot erase a settled job receipt', () => {
  const source = paidFixture(),
    bundle = JSON.parse(source.runtime.exportState());
  bundle.exchange.receipts.pop();
  const {
    schemaVersion,
    source: exchangeSource,
    rewardPolicy,
    receipts
  } = bundle.exchange;
  bundle.exchange.checksum = economicChecksum(stableEconomicString({
    schemaVersion,
    source: exchangeSource,
    rewardPolicy,
    receipts
  }));
  assertRejected(resign(bundle), /settled job usage receipt is missing|settled simulated cost receipt is required/);
  source.runtime.dispose();
});

test('a valid account prefix cannot turn a completed settled job back into held credit', () => {
  const source = fixture();
  source.runtime.account.fundDemo({
    fundingId: 'credits',
    amountUsd: '10'
  });
  reconcile(source);
  const bundle = JSON.parse(source.runtime.exportState());
  assert.equal(bundle.account.events.at(-1).type, 'credits.reservation-settled');
  bundle.account.events.pop();
  assertRejected(resign(bundle), /settled job reservation has different final charge/);
  source.runtime.dispose();
});

test('a valid kernel prefix cannot erase an unjournalled compute reservation owner', () => {
  const source = fixture();
  source.runtime.account.fundDemo({
    fundingId: 'credits',
    amountUsd: '10'
  });
  source.runtime.compute.reserveTask({
    jobId: 'held',
    providerId: 'local',
    model: 'text-summary',
    privacy: 'local-only',
    ceilingUsd: '0.05',
    taskHash: economicDigest({
      id: 'held'
    }),
    idempotencyKey: 'reserve:held'
  });
  const bundle = JSON.parse(source.runtime.exportState());
  bundle.kernel.commands = [];
  bundle.kernel.eventRoot = 'genesis';
  const {
    format,
    commands,
    eventRoot
  } = bundle.kernel;
  bundle.kernel.digest = economicDigest({
    format,
    commands,
    eventRoot
  });
  assertRejected(resign(bundle), /orphan job credit reservation/);
  source.runtime.dispose();
});

test('a valid credit prefix cannot erase a refunded job compensation', () => {
  const source = fixture();
  source.runtime.account.fundDemo({
    fundingId: 'credits',
    amountUsd: '10'
  });
  reconcile(source);
  source.runtime.compute.refundTask({
    jobId: 'job',
    idempotencyKey: 'refund'
  });
  const bundle = JSON.parse(source.runtime.exportState());
  assert.equal(bundle.account.events.at(-1).type, 'credits.refunded');
  bundle.account.events.pop();
  assertRejected(resign(bundle), /job refund state differs/);
  source.runtime.dispose();
});

test('legacy shared WebAI spend and receipt claims remain valid with exact debit protection', () => {
  const source = fixture();
  source.runtime.account.fundDemo({
    fundingId: 'credits',
    amountUsd: '10'
  });
  source.engine.faucet('u:you', 'TUMBO', 100, {
    idempotencyKey: 'tokens'
  });
  source.runtime.kernel.fundPool({
    from: 'u:you',
    purpose: 'rewards',
    amountFluff: 100,
    idempotencyKey: 'pool'
  });
  source.runtime.account.spendVerified({
    spendId: 'webai:usage',
    providerId: 'nvidia',
    taskId: 'webai:task',
    amountUsd: '0.02'
  });
  source.runtime.exchange.record({
    receiptId: 'webai:usage',
    providerId: 'nvidia',
    model: 'declared-model',
    inputTokens: 10,
    outputTokens: 20,
    reportedCostUsd: '0.02',
    verified: true
  });
  source.runtime.compute.claimIncentive({
    kind: 'compute',
    evidenceId: 'webai:usage',
    beneficiary: 'u:you',
    idempotencyKey: 'reward'
  });
  const restored = fixture(source.runtime.exportState());
  assert.equal(restored.runtime.snapshot().restoreStatus, 'restored-validated-local-bundle');
  assert.deepEqual(restored.runtime.compute.validateRestoredState(), {
    ok: true,
    jobCount: 0,
    claimCount: 1,
    canonicalChainValid: true
  });
  assert.throws(() => restored.runtime.account.refund({
    spendId: 'webai:usage',
    refundId: 'direct'
  }), /Funded reward protects/);
  assert.equal(restored.runtime.exchange.snapshot().receipts[0].billingVerified, false);
  source.runtime.dispose();
  restored.runtime.dispose();
});

test('pending and cancelled compute jobs retain their exact causal credit state on reload', () => {
  const source = fixture();
  source.runtime.account.fundDemo({
    fundingId: 'credits',
    amountUsd: '10'
  });
  for (const jobId of ['held', 'cancelled']) source.runtime.compute.reserveTask({
    jobId,
    providerId: 'local',
    model: 'text-summary',
    privacy: 'local-only',
    ceilingUsd: '0.05',
    taskHash: economicDigest({
      jobId
    }),
    idempotencyKey: `reserve:${jobId}`
  });
  source.runtime.compute.cancelTask({
    jobId: 'cancelled',
    idempotencyKey: 'cancel'
  });
  const restored = fixture(source.runtime.exportState());
  assert.equal(restored.runtime.snapshot().restoreStatus, 'restored-validated-local-bundle');
  assert.equal(restored.runtime.account.snapshot().reservedUsd, 0.05);
  assert.deepEqual(restored.runtime.compute.snapshot().jobs.map(row => row.status), ['reserved', 'cancelled']);
  assert.deepEqual(restored.runtime.account.snapshot(), source.runtime.account.snapshot());
  source.runtime.dispose();
  restored.runtime.dispose();
});

test('an independent kernel prefix cannot retain an unrecorded rehearsal clock change', () => {
  const source = fixture();
  source.runtime.advanceClock({
    deltaMs: 60000,
    explicit: true,
    idempotencyKey: 'advance'
  });
  const bundle = JSON.parse(source.runtime.exportState());
  bundle.kernel.commands = [];
  bundle.kernel.eventRoot = 'genesis';
  const {
    format,
    commands,
    eventRoot
  } = bundle.kernel;
  bundle.kernel.digest = economicDigest({
    format,
    commands,
    eventRoot
  });
  assertRejected(resign(bundle), /Rehearsal clock differs from its command history/);
  source.runtime.dispose();
});

test('accepted timeline events at the exact shared metadata bounds export and restore with the runtime', () => {
  const source = fixture();
  let payload = 0;
  for (let index = 0; index < 14; index++) payload = {
    child: payload
  };
  source.runtime.timeline.append({
    type: 'depth-limit',
    payload
  });
  source.runtime.timeline.append({
    type: 'row-limit',
    payload: Array(4000).fill(0)
  });
  source.runtime.timeline.append({
    type: 'field-limit',
    payload: Object.fromEntries(Array.from({
      length: 100
    }, (_, index) => [`key${index}`, 0]))
  });
  const restored = fixture(source.runtime.exportState());
  assert.equal(restored.runtime.snapshot().restoreStatus, 'restored-validated-local-bundle');
  assert.deepEqual(restored.runtime.timeline.snapshot(), source.runtime.timeline.snapshot());
  source.runtime.dispose();
  restored.runtime.dispose();
});
