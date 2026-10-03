/** Budgeted compute jobs and funded incentives on the shared economic owner. */
import {
  COMPUTE_PROVIDERS,
  normalizeUsageReceipt,
  estimateTumboSimReward
} from './compute-exchange.js?v=20261003-skin360';
import {
  toComputeUnits
} from './compute-account.js?v=20261003-skin360';
import {
  ECONOMIC_POOLS,
  economicActor,
  economicInteger,
  economicJson,
  economicDigest
} from './economic-kernel.js?v=20261003-skin360';
const safeId = (value, name = 'identity', maximum = 120) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]+$/.test(value) || value.length > maximum) throw new TypeError(`A bounded ${name} of at most ${maximum} characters is required`);
  return value;
};
const SCALE = 100_000_000n;
const moneyUnits = value => {
  return BigInt(toComputeUnits(value, 'Cost'));
};
const ensureAccepted = result => {
  if (!result?.accepted) throw new Error(`Compute credits blocked: ${result?.reason ?? 'unknown'}`);
};

export function createComputeJobs(kernel, {
  account,
  exchange,
  contributions,
  dailyRewardCapFluff = 1000
} = {}) {
  if (!account?.reserve || !exchange?.preflightReceipt || !contributions?.snapshot) throw new TypeError('Compute jobs require the shared guarded account, exchange and consent vault');
  economicInteger(dailyRewardCapFluff, 'daily incentive cap');
  const jobs = new Map(),
    claims = new Map(),
    rewardTotals = new Map();
  const getJob = id => {
    const row = jobs.get(id);
    if (!row) throw new Error('Unknown compute job');
    return row;
  };
  const reserveTask = kernel.register('compute.reserve', (input, ctx) => {
    const jobId = safeId(input.jobId, 'jobId');
    if (jobs.has(jobId)) throw new Error('Compute job already exists');
    const provider = COMPUTE_PROVIDERS.find(item => item.id === input.providerId);
    if (!provider) throw new Error('Unknown provider');
    if (!['local-only', 'external-allowed'].includes(input.privacy)) throw new Error('Choose an explicit privacy policy');
    if (input.privacy === 'local-only' && provider.id !== 'local') throw new Error('Local-only privacy forbids external execution');
    const ceilingUnits = moneyUnits(input.ceilingUsd);
    if (!ceilingUnits) throw new Error('A positive cost ceiling is required');
    if (!/^[0-9a-f]{64}$/.test(input.taskHash ?? '')) throw new Error('Task metadata must be a hash; private prompt is not retained');
    const model = String(input.model ?? '').trim();
    if (!model || model.length > 120) throw new Error('A model or tool identity of at most 120 characters is required');
    const reservationId = `job:${jobId}`;
    if (!ctx.restoring) ensureAccepted(account.reserve({
      reservationId,
      taskId: jobId,
      providerId: provider.id,
      amountUsd: Number(ceilingUnits) / Number(SCALE)
    }));
    const row = economicJson({
      jobId,
      providerId: provider.id,
      model,
      privacy: input.privacy,
      taskHash: input.taskHash,
      ceilingUsd: Number(ceilingUnits) / Number(SCALE),
      reservationId,
      status: 'reserved',
      reservedAt: ctx.now,
      execution: null,
      receiptId: null,
      externalBillingVerified: false
    });
    jobs.set(jobId, row);
    return row;
  });
  const recordExecution = kernel.register('compute.execution', (input, ctx) => {
    const row = getJob(safeId(input.jobId));
    if (row.status !== 'reserved') throw new Error('Only a reserved job can record execution');
    const mode = input.mode;
    if (!['local-tool', 'provider-response', 'demo-run'].includes(mode)) throw new Error('Unknown execution evidence mode');
    if (mode === 'local-tool' && row.providerId !== 'local') throw new Error('Local tool evidence cannot impersonate an external provider');
    if (mode === 'provider-response' && row.privacy === 'local-only') throw new Error('Local-only job cannot accept an external response');
    const execution = economicJson({
      executionId: safeId(input.executionId),
      mode,
      inputTokens: economicInteger(input.inputTokens, 'input tokens', {
        positive: false
      }),
      outputTokens: economicInteger(input.outputTokens, 'output tokens', {
        positive: false
      }),
      outputHash: input.outputHash,
      completedAt: ctx.now,
      billingVerified: false
    });
    if (!/^[0-9a-f]{64}$/.test(execution.outputHash ?? '')) throw new Error('Execution needs an output commitment, without raw private text');
    const next = economicJson({
      ...row,
      status: 'completed-awaiting-billing',
      execution
    });
    jobs.set(row.jobId, next);
    return next;
  });
  const reconcileTask = kernel.register('compute.reconcile', (input, ctx) => {
    const row = getJob(safeId(input.jobId));
    if (row.status !== 'completed-awaiting-billing') throw new Error('Completed execution is required before reconciliation');
    if (input.billingMode !== 'explicit-demo' || input.explicit !== true) throw new Error('Only explicit simulated billing is available; live provider billing requires an authenticated billing adapter');
    const costUnits = moneyUnits(input.costUsd);
    if (costUnits > moneyUnits(row.ceilingUsd)) throw new Error('Simulated charge must be within the reserved ceiling');
    const receiptId = `job-usage:${row.jobId}`;
    const receipt = normalizeUsageReceipt({
      receiptId,
      providerId: row.providerId,
      model: row.model,
      inputTokens: row.execution.inputTokens,
      outputTokens: row.execution.outputTokens,
      reportedCostUsd: Number(costUnits) / Number(SCALE),
      verified: costUnits > 0n
    });
    if (!ctx.restoring) {
      const preflight = exchange.preflightReceipt(receipt);
      if (!preflight.accepted) throw new Error(`Usage receipt blocked: ${preflight.reason}`);
      ensureAccepted(account.settleReservation({
        reservationId: row.reservationId,
        spendId: receiptId,
        amountUsd: receipt.reportedCostUsd
      }));
      exchange.record(receipt);
    }
    const next = economicJson({
      ...row,
      status: 'settled-demo',
      receiptId,
      costUsd: receipt.reportedCostUsd,
      billingMode: 'explicit-demo',
      externalBillingVerified: false,
      settledAt: ctx.now
    });
    jobs.set(row.jobId, next);
    return next;
  });
  const cancelTask = kernel.register('compute.cancel', (input, ctx) => {
    const row = getJob(safeId(input.jobId));
    if (!['reserved', 'completed-awaiting-billing'].includes(row.status)) throw new Error('Only an unsettled job can release its reservation');
    if (!ctx.restoring) ensureAccepted(account.cancelReservation({
      reservationId: row.reservationId,
      cancelId: ctx.key
    }));
    const next = economicJson({
      ...row,
      status: 'cancelled',
      cancelledAt: ctx.now
    });
    jobs.set(row.jobId, next);
    return next;
  });
  const refundTask = kernel.register('compute.refund', (input, ctx) => {
    const row = getJob(safeId(input.jobId));
    if (row.status !== 'settled-demo') throw new Error('Only a settled demo job can be refunded');
    if (claims.has(`compute:${row.receiptId}`)) throw new Error('A paid usage reward must be reviewed before refund; automatic reward farming is blocked');
    if (!ctx.restoring) ensureAccepted(account.refund({
      spendId: row.receiptId,
      refundId: ctx.key
    }));
    const next = economicJson({
      ...row,
      status: 'refunded',
      refundedAt: ctx.now
    });
    jobs.set(row.jobId, next);
    return next;
  });
  const claimIncentive = kernel.register('incentive.claim', (input, ctx) => {
    const beneficiary = economicActor(input.beneficiary),
      kind = input.kind;
    if (!['compute', 'contribution'].includes(kind)) throw new Error('Unknown incentive channel');
    // Compute protection adds "compute:" to its 160-character credit identity.
    // Consent consumes the command key, so its full 160-character record ID fits.
    const evidenceId = safeId(input.evidenceId, 'evidenceId', kind === 'compute' ? 152 : 160);
    const claimId = `${kind}:${evidenceId}`;
    if (claims.has(claimId)) throw new Error('Evidence already received its funded reward');
    let amountFluff, preparedContribution = null,
      preparedDebit = null;
    if (kind === 'compute') {
      const receipt = exchange.snapshot().receipts.find(item => item.receiptId === evidenceId);
      if (!receipt?.verified || !receipt.reportedCostUsd) throw new Error('A settled simulated cost receipt is required; raw token counts do not earn rewards');
      const creditEvents = account.snapshot().events;
      const credit = creditEvents.find(item => ['credits.spent', 'credits.reservation-settled'].includes(item.type) && item.args?.spendId === evidenceId);
      if (!credit) throw new Error('Receipt has no matching funded credit debit');
      const spend = account.snapshot().spends.find(row => row.spendId === evidenceId);
      if (!spend || spend.providerId !== receipt.providerId || BigInt(spend.units) !== moneyUnits(receipt.reportedCostUsd)) throw new Error('Usage provider and amount do not match the exact credit debit');
      const job = [...jobs.values()].find(item => item.receiptId === evidenceId);
      if (!ctx.restoring && (job?.status === 'refunded' || creditEvents.some(item => item.type === 'credits.refunded' && item.args?.spendId === evidenceId))) throw new Error('Refunded usage cannot receive a reward');
      const policy = exchange.snapshot().rewardPolicy,
        eligibility = estimateTumboSimReward(receipt, policy);
      if (!eligibility.eligible) throw new Error(`Usage is not incentive-eligible: ${eligibility.reason}`);
      amountFluff = Number(moneyUnits(receipt.reportedCostUsd) * 1000n / moneyUnits(policy.usdPerTumboSim));
      if (!ctx.restoring) {
        preparedDebit = account.preflightRewardDebit({
          spendId: evidenceId,
          rewardId: claimId
        });
        ensureAccepted(preparedDebit);
      }
    } else {
      const record = contributions.snapshot().contributions.find(item => item.contributionId === evidenceId);
      if (!record || (!ctx.restoring && (record.state !== 'accepted' || record.consent?.revoked))) throw new Error('Active accepted metadata consent is required');
      if (!ctx.restoring) {
        preparedContribution = contributions.preflightClaim({
          contributionId: evidenceId,
          claimId: ctx.key
        });
        ensureAccepted(preparedContribution);
      }
      amountFluff = record.rewardFluff;
    }
    economicInteger(amountFluff, 'earned reward');
    const period = new Date(ctx.now).toISOString().slice(0, 10),
      capKey = `${beneficiary}|${period}`;
    const total = (rewardTotals.get(capKey) ?? 0) + amountFluff;
    if (total > dailyRewardCapFluff) throw new Error('Daily funded incentive cap reached');
    const settle = () => ctx.post([{
      account: ECONOMIC_POOLS.rewards,
      asset: 'TUMBO',
      amount: -amountFluff
    }, {
      account: beneficiary,
      asset: 'TUMBO',
      amount: amountFluff
    }], {
      links: {
        claimId,
        policy: 'bounded-demo-incentive-v1'
      }
    });
    const receipt = preparedContribution ? contributions.commitPreparedClaim(preparedContribution, settle).settlement :
      preparedDebit ? account.commitPreparedRewardDebit(preparedDebit, settle).settlement : settle();
    const claim = economicJson({
      claimId,
      beneficiary,
      amountFluff,
      period,
      receiptId: receipt.id,
      receiptKey: receipt.idempotencyKey,
      provenance: 'local-rehearsal-evidence',
      externalBillingVerified: false
    });
    claims.set(claimId, claim);
    rewardTotals.set(capKey, total);
    return claim;
  });

  function snapshot() {
    return economicJson({
      jobs: [...jobs.values()],
      claims: [...claims.values()],
      dailyRewardCapFluff,
      credits: account.snapshot(),
      usage: exchange.snapshot(),
      consent: contributions.snapshot(),
      obligations: [...jobs.values()].filter(row => ['reserved', 'completed-awaiting-billing'].includes(row.status))
        .map(row => ({
          kind: 'compute-credit-reservation',
          jobId: row.jobId,
          denomination: 'demo-USD',
          amountUsd: row.ceilingUsd
        })),
      liveBillingAdapter: 'unavailable',
      simulation: true
    });
  }
  /** Independent valid prefixes are insufficient: reconcile their causal links. */
  function validateRestoredState() {
    const credits = account.snapshot(),
      usage = exchange.snapshot(),
      consent = contributions.snapshot();
    const reservations = new Map(credits.reservations.map(row => [row.id, row]));
    const spends = new Map(credits.spends.map(row => [row.spendId, row]));
    const receipts = new Map(usage.receipts.map(row => [row.receiptId, row]));
    const consentRecords = new Map(consent.contributions.map(row => [row.contributionId, row]));
    const fail = message => {
      throw new Error(`Compute restored streams disagree: ${message}`);
    };
    if (!kernel.engine.ledger.verifyChain().ok) fail('canonical ledger integrity is invalid');
    for (const row of jobs.values()) {
      const hold = reservations.get(row.reservationId);
      if (!hold || hold.id !== `job:${row.jobId}` || hold.providerId !== row.providerId || hold.taskId !== row.jobId || BigInt(hold.units) !== moneyUnits(row.ceilingUsd)) fail('job has no matching exact credit reservation');
      if (['reserved', 'completed-awaiting-billing'].includes(row.status)) {
        if (hold.state !== 'held' || row.receiptId !== null || spends.has(`job-usage:${row.jobId}`) || receipts.has(`job-usage:${row.jobId}`)) fail('pending job reservation is not held or already has settlement evidence');
      } else if (row.status === 'cancelled') {
        if (hold.state !== 'cancelled' || row.receiptId !== null || spends.has(`job-usage:${row.jobId}`) || receipts.has(`job-usage:${row.jobId}`)) fail('cancelled job retained a hold or settlement');
      } else if (['settled-demo', 'refunded'].includes(row.status)) {
        const spend = spends.get(row.receiptId),
          receipt = receipts.get(row.receiptId),
          cost = moneyUnits(row.costUsd);
        if (row.receiptId !== `job-usage:${row.jobId}` || hold.state !== 'settled' || hold.spendId !== row.receiptId || BigInt(hold.settledUnits) !== cost) fail('settled job reservation has different final charge');
        if (!spend || spend.reservationId !== hold.id || spend.taskId !== row.jobId || spend.providerId !== row.providerId || BigInt(spend.units) !== cost) fail('settled job has no matching exact credit debit');
        if (!receipt || receipt.providerId !== row.providerId || receipt.model !== row.model || moneyUnits(receipt.reportedCostUsd) !== cost || receipt.inputTokens !== row.execution?.inputTokens || receipt.outputTokens !== row.execution?.outputTokens || receipt.verified !== (cost > 0n) || receipt.billingVerified !== false) fail('settled job usage receipt is missing or differs from executed work');
        if (row.status === 'refunded' ? spend.refundedUnits !== spend.units : spend.refundedUnits !== 0) fail('job refund state differs from its credit compensation');
        if (row.status === 'refunded' && claims.has(`compute:${row.receiptId}`)) fail('refunded job retained a funded reward');
      } else fail('unknown compute job state');
    }
    for (const row of reservations.values())
      if (row.id.startsWith('job:') && !jobs.has(row.id.slice(4))) fail('orphan job credit reservation');
    for (const row of receipts.values())
      if (row.receiptId.startsWith('job-usage:') && !jobs.has(row.receiptId.slice(10))) fail('orphan job usage receipt');
    for (const row of spends.values()) {
      if (row.spendId.startsWith('job-usage:') && !jobs.has(row.spendId.slice(10))) fail('orphan job credit debit');
      if (row.rewardId && !claims.has(row.rewardId)) fail('protected debit has no corresponding funded reward claim');
    }
    const kernelEvents = kernel.snapshot().events;
    for (const claim of claims.values()) {
      const canonical = kernel.engine.ledger._journals.find(row => row.idempotencyKey === claim.receiptKey);
      if (!canonical || canonical.id !== claim.receiptId || !kernel.engine.ledger.verifyReceipt(canonical.id).ok || canonical.action !== 'economic:incentive.claim' || canonical.links?.metadataHash !== economicDigest({
          claimId: claim.claimId,
          policy: 'bounded-demo-incentive-v1'
        })) fail('funded claim has no valid matching canonical receipt');
      if (!kernelEvents.some(event => event.type === 'incentive.claim' && event.key === canonical.links?.commandKey && event.receiptKeys.length === 1 && event.receiptKeys[0] === claim.receiptKey && event.receiptHashes[0] === canonical.hash)) fail('funded claim has no exact kernel command ancestry');
      const expected = [{
        account: ECONOMIC_POOLS.rewards,
        asset: 'TUMBO',
        amount: -claim.amountFluff
      }, {
        account: claim.beneficiary,
        asset: 'TUMBO',
        amount: claim.amountFluff
      }];
      const sortLegs = legs => legs.map(leg => ({
          account: leg.account,
          asset: leg.asset,
          amount: leg.amount
        }))
        .sort((a, b) => `${a.account}|${a.asset}`.localeCompare(`${b.account}|${b.asset}`, 'en'));
      if (JSON.stringify(sortLegs(canonical.postings)) !== JSON.stringify(sortLegs(expected))) fail('funded claim canonical postings differ from its exact amount and beneficiary');
      if (claim.period !== new Date(kernelEvents.find(event => event.key === canonical.links.commandKey).at).toISOString().slice(0, 10)) fail('reward budget period differs from its canonical command');
      if (claim.claimId.startsWith('compute:')) {
        const evidenceId = claim.claimId.slice(8),
          receipt = receipts.get(evidenceId),
          spend = spends.get(evidenceId);
        if (!receipt || !spend || spend.rewardId !== claim.claimId || spend.refundedUnits || spend.providerId !== receipt.providerId || BigInt(spend.units) !== moneyUnits(receipt.reportedCostUsd)) fail('paid usage claim lacks its protected exact credit debit');
        const policy = usage.rewardPolicy,
          eligible = estimateTumboSimReward(receipt, policy);
        const amount = Number(moneyUnits(receipt.reportedCostUsd) * 1000n / moneyUnits(policy.usdPerTumboSim));
        if (!eligible.eligible || amount !== claim.amountFluff) fail('paid usage claim differs from the configured incentive policy');
      } else if (claim.claimId.startsWith('contribution:')) {
        const record = consentRecords.get(claim.claimId.slice(13));
        if (!record?.everAccepted || !record.acceptedEvidenceId || record.claimId !== canonical.links.commandKey || record.rewardFluff !== claim.amountFluff) fail('paid contribution claim lacks its consumed immutable consent entitlement');
      } else fail('unknown funded claim channel');
    }
    for (const record of consentRecords.values())
      if (record.claimId && !claims.has(`contribution:${record.contributionId}`)) fail('consumed consent entitlement has no corresponding funded claim');
    return Object.freeze({
      ok: true,
      jobCount: jobs.size,
      claimCount: claims.size,
      canonicalChainValid: true
    });
  }
  kernel.project('compute', snapshot);
  return Object.freeze({
    reserveTask,
    recordExecution,
    reconcileTask,
    cancelTask,
    refundTask,
    claimIncentive,
    snapshot,
    validateRestoredState
  });
}

/** A real bounded local tool. It does not pretend to be model inference. */
export function runLocalComputeTool(tool, text) {
  if (tool !== 'text-summary') throw new Error('Unknown installed local tool');
  if (typeof text !== 'string' || text.length > 4000) throw new Error('Local tool accepts up to 4,000 characters');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Object.freeze({
    tool,
    kind: 'deterministic-local-tool',
    words,
    characters: text.length,
    summary: text.trim().split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 600),
    outputHash: economicDigest({
      tool,
      words,
      text
    }),
    externalNetwork: false
  });
}
