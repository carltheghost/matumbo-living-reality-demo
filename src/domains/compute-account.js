/** Exact local demo compute-credit accounting; no money or billing authority. */
import {
  economicChecksum,
  sealEconomicMetadata,
  stableEconomicString
} from './economic-timeline.js?v=20261003-skin360';
export const COMPUTE_ACCOUNT_SCHEMA_VERSION = 2;
export const COMPUTE_ACCOUNT_SOURCE = 'matumbo-compute-account';
export const COMPUTE_ACCOUNT_BOUNDARY = 'Local demo-credit accounting only. No card charge, bank transfer, wallet, custody, settlement, subscription billing, or real balance exists.';
export const COMPUTE_UNITS_PER_USD = 100_000_000;
export function toComputeUnits(value, label = 'Amount') {
  const text = String(value ?? '').trim(),
    match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || text.length > 100) throw new Error(`${label} must be a finite non-negative decimal`);
  const exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw new Error(`${label} is out of range`);
  let digits = match[1] + (match[2] ?? ''),
    scale = 8 + exponent - (match[2]?.length ?? 0);
  while (scale < 0 && digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    scale++;
  }
  if (scale < 0) throw new Error(`${label} exceeds eight decimal places`);
  const result = BigInt(digits || '0') * 10n ** BigInt(scale);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds safe compute-credit units`);
  return Number(result);
}
export function fromComputeUnits(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid compute-credit units');
  return value / COMPUTE_UNITS_PER_USD;
}

function positive(value, label) {
  const units = toComputeUnits(value, label);
  if (!units) throw new Error(`${label} must be greater than zero`);
  return units;
}

function identifier(value, label) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 160) throw new Error(`${label} is required and must fit 160 characters`);
  return text;
}

function safeAdd(a, b) {
  const sum = a + b;
  if (!Number.isSafeInteger(sum) || sum < 0) throw new Error('Compute-credit total exceeds safe units');
  return sum;
}

export function createComputeAccount({
  startingCreditsUsd = 0,
  monthlyBudgetUsd = 100,
  perTaskBudgetUsd = 25,
  now = () => Date.now(),
  maxEvents = 10000
} = {}) {
  if (typeof now !== 'function' || !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 100000) throw new Error('Invalid compute account options');
  const initial = Object.freeze({
    startingUnits: toComputeUnits(startingCreditsUsd),
    monthlyUnits: positive(monthlyBudgetUsd, 'Monthly budget'),
    taskUnits: positive(perTaskBudgetUsd, 'Per-task budget')
  });
  if (initial.taskUnits > initial.monthlyUnits) throw new Error('Per-task budget cannot exceed monthly budget');
  let state = fresh(initial),
    replayAt = null;
  const preparedRewards = new WeakMap();
  let rewardCommitting = false;

  function mutationGuard() {
    if (rewardCommitting) throw new Error('Compute reward settlement is in progress; mutations cannot re-enter');
  }

  function fresh(config) {
    return {
      initial: config,
      balance: config.startingUnits,
      monthly: config.monthlyUnits,
      task: config.taskUnits,
      funding: new Map(),
      spends: new Map(),
      reservations: new Map(),
      refunds: new Map(),
      cancels: new Map(),
      rewards: new Map(),
      events: []
    };
  }

  function at() {
    const time = replayAt ?? Number(now());
    if (!Number.isSafeInteger(time) || time < 0 || Number.isNaN(new Date(time).getTime())) throw new Error('Invalid compute clock');
    return time;
  }

  function period(time = at()) {
    return new Date(time).toISOString().slice(0, 7);
  }

  function held() {
    return [...state.reservations.values()].filter(row => row.state === 'held').reduce((sum, row) => safeAdd(sum, row.units), 0);
  }

  function spent(month = null, task = null) {
    return [...state.spends.values()].filter(row => (!month || row.period === month) && (!task || row.taskId === task)).reduce((sum, row) => safeAdd(sum, row.units - row.refundedUnits), 0);
  }

  function reserved(month = null, task = null, exclude = null) {
    return [...state.reservations.values()].filter(row => row.state === 'held' && row.id !== exclude && (!month || row.period === month) && (!task || row.taskId === task)).reduce((sum, row) => safeAdd(sum, row.units), 0);
  }

  function capacity() {
    if (state.events.length >= maxEvents) throw new Error('Compute account history is full; export before continuing');
  }

  function push(type, args, time) {
    const base = {
      sequence: state.events.length + 1,
      type,
      source: COMPUTE_ACCOUNT_SOURCE,
      at: time,
      previousChecksum: state.events.at(-1)?.checksum ?? 'GENESIS',
      args: sealEconomicMetadata(args)
    };
    state.events.push(sealEconomicMetadata({
      ...base,
      checksum: economicChecksum(stableEconomicString(base))
    }));
  }

  function bound(map, key, request) {
    const old = map.get(key);
    if (!old) return null;
    if (stableEconomicString(old.request) !== stableEconomicString(request)) throw new Error('IDEM_MISMATCH: compute identifier belongs to another request');
    return old;
  }

  function requestSpend(input, time = at()) {
    return {
      spendId: identifier(input.spendId, 'spendId'),
      providerId: identifier(input.providerId ?? 'unknown', 'providerId'),
      taskId: identifier(input.taskId ?? input.spendId, 'taskId'),
      units: positive(input.amountUsd, 'Spend'),
      period: period(time)
    };
  }

  function spendCheck(request, {
    reservation = null
  } = {}) {
    const old = state.spends.get(request.spendId);
    if (old) {
      bound(state.spends, request.spendId, {
        ...request,
        period: old.request.period
      });
      return {
        accepted: false,
        duplicate: true,
        reason: 'duplicate-spend'
      };
    }
    const taskTotal = safeAdd(spent(null, request.taskId), reserved(null, request.taskId, reservation?.id));
    if (safeAdd(taskTotal, request.units) > state.task) return {
      accepted: false,
      duplicate: false,
      reason: 'per-task-budget'
    };
    const monthTotal = safeAdd(spent(request.period), reserved(request.period, null, reservation?.id));
    if (safeAdd(monthTotal, request.units) > state.monthly) return {
      accepted: false,
      duplicate: false,
      reason: 'monthly-budget'
    };
    if (request.units > state.balance - held() + (reservation?.units ?? 0)) return {
      accepted: false,
      duplicate: false,
      reason: 'insufficient-credits'
    };
    return {
      accepted: true,
      duplicate: false,
      reason: 'settled-local-demo'
    };
  }

  function setBudget(next = {}) {
    mutationGuard();
    const monthly = next.monthlyBudgetUsd === undefined ? state.monthly : positive(next.monthlyBudgetUsd, 'Monthly budget'),
      task = next.perTaskBudgetUsd === undefined ? state.task : positive(next.perTaskBudgetUsd, 'Per-task budget');
    if (task > monthly) throw new Error('Per-task budget cannot exceed monthly budget');
    const time = at();
    capacity();
    state.monthly = monthly;
    state.task = task;
    push('budget.updated', {
      monthlyBudgetUsd: fromComputeUnits(monthly),
      perTaskBudgetUsd: fromComputeUnits(task)
    }, time);
    return snapshot().budget;
  }

  function fundDemo({
    fundingId,
    amountUsd,
    reason = 'manual-demo-credit'
  } = {}) {
    mutationGuard();
    const key = identifier(fundingId, 'fundingId'),
      units = positive(amountUsd, 'Demo credit'),
      request = {
        units,
        reason: String(reason).slice(0, 120)
      };
    if (bound(state.funding, key, request)) return snapshot();
    const balance = safeAdd(state.balance, units),
      time = at();
    capacity();
    state.balance = balance;
    state.funding.set(key, {
      request
    });
    push('credits.demo-funded', {
      fundingId: key,
      amountUsd: fromComputeUnits(units),
      reason: request.reason
    }, time);
    return snapshot();
  }

  function preflightSpend(input = {}) {
    const request = requestSpend(input),
      result = spendCheck(request);
    return sealEconomicMetadata({
      ...result,
      amountUnits: request.units,
      period: request.period,
      snapshot: snapshot()
    });
  }

  function spendVerified(input = {}) {
    mutationGuard();
    const time = at(),
      request = requestSpend(input, time),
      check = spendCheck(request);
    if (!check.accepted) return sealEconomicMetadata({
      ...check,
      snapshot: snapshot()
    });
    capacity();
    state.balance -= request.units;
    state.spends.set(request.spendId, {
      request,
      ...request,
      refundedUnits: 0
    });
    push('credits.spent', {
      spendId: request.spendId,
      providerId: request.providerId,
      taskId: request.taskId,
      amountUsd: fromComputeUnits(request.units)
    }, time);
    return sealEconomicMetadata({
      ...check,
      snapshot: snapshot()
    });
  }

  function reserve({
    reservationId,
    taskId = reservationId,
    providerId = 'unknown',
    amountUsd
  } = {}) {
    mutationGuard();
    const key = identifier(reservationId, 'reservationId'),
      time = at(),
      request = {
        taskId: identifier(taskId, 'taskId'),
        providerId: identifier(providerId, 'providerId'),
        units: positive(amountUsd, 'Reservation')
      },
      old = bound(state.reservations, key, request);
    if (old) return sealEconomicMetadata({
      accepted: false,
      duplicate: true,
      reason: 'duplicate-reservation',
      reservation: old,
      snapshot: snapshot()
    });
    const check = spendCheck({
      ...request,
      spendId: `reservation:${key}`,
      period: period(time)
    });
    if (!check.accepted) return sealEconomicMetadata({
      ...check,
      snapshot: snapshot()
    });
    capacity();
    const reservation = {
      request,
      id: key,
      ...request,
      period: period(time),
      state: 'held'
    };
    state.reservations.set(key, reservation);
    push('credits.reserved', {
      reservationId: key,
      taskId: request.taskId,
      providerId: request.providerId,
      amountUsd: fromComputeUnits(request.units)
    }, time);
    return sealEconomicMetadata({
      accepted: true,
      duplicate: false,
      reason: 'reserved-local-demo',
      reservation,
      snapshot: snapshot()
    });
  }

  function settleReservation({
    reservationId,
    spendId,
    amountUsd
  } = {}) {
    mutationGuard();
    const key = identifier(reservationId, 'reservationId'),
      row = state.reservations.get(key);
    if (!row) throw new Error('Unknown compute reservation');
    const request = {
      spendId: identifier(spendId, 'spendId'),
      providerId: row.providerId,
      taskId: row.taskId,
      units: toComputeUnits(amountUsd, 'Final spend'),
      period: row.period
    };
    if (row.state === 'settled') {
      if (row.spendId !== request.spendId || row.settledUnits !== request.units) throw new Error('IDEM_MISMATCH: reservation was settled differently');
      return sealEconomicMetadata({
        accepted: false,
        duplicate: true,
        reason: 'duplicate-settlement',
        snapshot: snapshot()
      });
    }
    if (row.state !== 'held') throw new Error('Reservation is no longer held');
    if (request.units > row.units) return sealEconomicMetadata({
      accepted: false,
      duplicate: false,
      reason: 'reservation-overrun',
      snapshot: snapshot()
    });
    const check = spendCheck(request, {
      reservation: row
    });
    if (!check.accepted) return sealEconomicMetadata({
      ...check,
      snapshot: snapshot()
    });
    const time = at();
    capacity();
    state.balance -= request.units;
    state.spends.set(request.spendId, {
      request,
      ...request,
      reservationId: key,
      refundedUnits: 0
    });
    row.state = 'settled';
    row.spendId = request.spendId;
    row.settledUnits = request.units;
    push('credits.reservation-settled', {
      reservationId: key,
      spendId: request.spendId,
      amountUsd: fromComputeUnits(request.units)
    }, time);
    return sealEconomicMetadata({
      accepted: true,
      duplicate: false,
      reason: 'settled-local-demo',
      releasedUnits: row.units - request.units,
      snapshot: snapshot()
    });
  }

  function cancelReservation({
    reservationId,
    cancelId
  } = {}) {
    mutationGuard();
    const key = identifier(cancelId, 'cancelId'),
      request = {
        reservationId: identifier(reservationId, 'reservationId')
      };
    if (bound(state.cancels, key, request)) return sealEconomicMetadata({
      accepted: false,
      duplicate: true,
      reason: 'duplicate-cancellation',
      snapshot: snapshot()
    });
    const row = state.reservations.get(request.reservationId);
    if (!row || row.state !== 'held') throw new Error('Reservation is not held');
    const time = at();
    capacity();
    row.state = 'cancelled';
    state.cancels.set(key, {
      request
    });
    push('credits.reservation-cancelled', {
      ...request,
      cancelId: key
    }, time);
    return sealEconomicMetadata({
      accepted: true,
      duplicate: false,
      reason: 'cancelled-local-demo',
      snapshot: snapshot()
    });
  }

  function refund({
    spendId,
    refundId,
    amountUsd
  } = {}) {
    mutationGuard();
    const key = identifier(refundId, 'refundId'),
      spendKey = identifier(spendId, 'spendId'),
      row = state.spends.get(spendKey);
    if (!row) throw new Error('Unknown compute spend');
    if (row.rewardId) throw new Error('Funded reward protects this spend; explicit reward reconciliation is required before refund');
    const old = state.refunds.get(key),
      units = amountUsd === undefined ? (old?.request.units ?? row.units - row.refundedUnits) : positive(amountUsd, 'Refund'),
      request = {
        spendId: spendKey,
        units
      };
    if (bound(state.refunds, key, request)) return sealEconomicMetadata({
      accepted: false,
      duplicate: true,
      reason: 'duplicate-refund',
      snapshot: snapshot()
    });
    if (!units || units > row.units - row.refundedUnits) throw new Error('Refund exceeds remaining spend');
    const balance = safeAdd(state.balance, units),
      time = at();
    capacity();
    row.refundedUnits += units;
    state.balance = balance;
    state.refunds.set(key, {
      request
    });
    push('credits.refunded', {
      spendId: spendKey,
      refundId: key,
      amountUsd: fromComputeUnits(units)
    }, time);
    return sealEconomicMetadata({
      accepted: true,
      duplicate: false,
      reason: 'refunded-local-demo',
      snapshot: snapshot()
    });
  }

  function preflightRewardDebit({
    spendId,
    rewardId
  } = {}) {
    const spendKey = identifier(spendId, 'spendId'),
      rewardKey = identifier(rewardId, 'rewardId'),
      row = state.spends.get(spendKey);
    if (!row) throw new Error('Unknown compute spend');
    const prior = state.rewards.get(rewardKey);
    if (prior && prior !== spendKey) throw new Error('IDEM_MISMATCH: reward ID belongs to another compute debit');
    if (row.rewardId) {
      if (row.rewardId !== rewardKey) throw new Error('Compute debit already received its funded reward');
      return sealEconomicMetadata({
        accepted: false,
        duplicate: true,
        reason: 'duplicate-funded-reward',
        spendId: spendKey,
        rewardId: rewardKey
      });
    }
    if (!row.units || row.refundedUnits) throw new Error('A positive unrefunded compute debit is required for a funded reward');
    const time = at();
    capacity();
    const prepared = sealEconomicMetadata({
      accepted: true,
      duplicate: false,
      reason: 'ready-funded-reward',
      spendId: spendKey,
      rewardId: rewardKey,
      amountUnits: row.units,
      providerId: row.providerId,
      taskId: row.taskId,
      period: row.period
    });
    preparedRewards.set(prepared, {
      row,
      rewardId: rewardKey,
      at: time,
      eventCount: state.events.length
    });
    return prepared;
  }

  function protectPreparedReward(prepared) {
    const ticket = preparedRewards.get(prepared);
    if (!ticket || ticket.row !== state.spends.get(prepared.spendId) || ticket.eventCount !== state.events.length || ticket.row.rewardId || ticket.row.refundedUnits) throw new Error('Compute reward preparation is stale or forged');
    ticket.row.rewardId = ticket.rewardId;
    state.rewards.set(ticket.rewardId, prepared.spendId);
    push('credits.reward-protected', {
      spendId: prepared.spendId,
      rewardId: ticket.rewardId
    }, ticket.at);
    preparedRewards.delete(prepared);
    return sealEconomicMetadata({
      ...prepared,
      reason: 'funded-reward-protected',
      transferExecuted: false
    });
  }

  function commitPreparedRewardDebit(prepared, settle) {
    mutationGuard();
    const ticket = preparedRewards.get(prepared);
    if (!ticket || !prepared.accepted || ticket.row !== state.spends.get(prepared.spendId) || ticket.eventCount !== state.events.length || ticket.row.rewardId || ticket.row.refundedUnits) throw new Error('Compute reward preparation is stale or forged');
    if (typeof settle !== 'function' || settle.constructor?.name === 'AsyncFunction') throw new Error('Compute reward callback must be synchronous');
    rewardCommitting = true;
    try {
      const settlement = settle();
      if (settlement && typeof settlement.then === 'function') throw new Error('Compute reward callback must return synchronously');
      const protection = protectPreparedReward(prepared);
      return Object.freeze({
        protection,
        settlement
      });
    } finally {
      rewardCommitting = false;
    }
  }

  function snapshot() {
    const month = period(),
      heldUnits = held(),
      totalSpent = spent(),
      periodSpent = spent(month),
      periodReserved = reserved(month);
    return sealEconomicMetadata({
      schemaVersion: COMPUTE_ACCOUNT_SCHEMA_VERSION,
      source: COMPUTE_ACCOUNT_SOURCE,
      unitsPerUsd: COMPUTE_UNITS_PER_USD,
      balanceUnits: state.balance,
      balanceUsd: fromComputeUnits(state.balance),
      availableUnits: state.balance - heldUnits,
      availableBalanceUsd: fromComputeUnits(state.balance - heldUnits),
      reservedUnits: heldUnits,
      reservedUsd: fromComputeUnits(heldUnits),
      spentUsd: fromComputeUnits(totalSpent),
      spentUnits: totalSpent,
      period: month,
      periodSpentUnits: periodSpent,
      periodSpentUsd: fromComputeUnits(periodSpent),
      remainingMonthlyBudgetUsd: fromComputeUnits(Math.max(0, state.monthly - periodSpent - periodReserved)),
      budget: {
        monthlyBudgetUsd: fromComputeUnits(state.monthly),
        perTaskBudgetUsd: fromComputeUnits(state.task)
      },
      reservations: [...state.reservations.values()],
      spends: [...state.spends.values()],
      events: state.events,
      localOnly: true,
      simulation: true,
      externalTransfer: false,
      executable: false,
      cryptographicProof: false,
      boundary: COMPUTE_ACCOUNT_BOUNDARY
    });
  }

  function exportState() {
    return sealEconomicMetadata({
      schemaVersion: COMPUTE_ACCOUNT_SCHEMA_VERSION,
      source: COMPUTE_ACCOUNT_SOURCE,
      initial: state.initial,
      events: state.events,
      checksumType: 'fnv1a-32-demo',
      cryptographicProof: false
    });
  }

  function importState(input) {
    mutationGuard();
    const data = sealEconomicMetadata(input);
    if (data.schemaVersion !== COMPUTE_ACCOUNT_SCHEMA_VERSION || data.source !== COMPUTE_ACCOUNT_SOURCE || !Array.isArray(data.events) || data.events.length > maxEvents || !data.initial) throw new Error('Invalid compute account state');
    for (const field of ['startingUnits', 'monthlyUnits', 'taskUnits'])
      if (!Number.isSafeInteger(data.initial[field]) || data.initial[field] < (field === 'startingUnits' ? 0 : 1)) throw new Error('Invalid initial compute units');
    if (data.initial.taskUnits > data.initial.monthlyUnits) throw new Error('Invalid initial compute budget');
    const previous = state;
    state = fresh(data.initial);
    try {
      for (const event of data.events) {
        replayAt = event.at;
        const methods = {
            'budget.updated': setBudget,
            'credits.demo-funded': fundDemo,
            'credits.spent': spendVerified,
            'credits.reserved': reserve,
            'credits.reservation-settled': settleReservation,
            'credits.reservation-cancelled': cancelReservation,
            'credits.refunded': refund,
            'credits.reward-protected': args => protectPreparedReward(preflightRewardDebit(args))
          },
          method = methods[event.type];
        if (!method) throw new Error('Unknown compute account event');
        method(event.args);
        if (stableEconomicString(state.events.at(-1)) !== stableEconomicString(event)) throw new Error('Compute account replay checksum or transition is invalid');
      }
      replayAt = null;
      return snapshot();
    } catch (error) {
      state = previous;
      replayAt = null;
      throw error;
    }
  }
  return Object.freeze({
    setBudget,
    fundDemo,
    spendVerified,
    preflightSpend,
    reserve,
    settleReservation,
    cancelReservation,
    refund,
    preflightRewardDebit,
    commitPreparedRewardDebit,
    snapshot,
    exportState,
    importState
  });
}
export default Object.freeze({
  COMPUTE_ACCOUNT_SCHEMA_VERSION,
  COMPUTE_ACCOUNT_SOURCE,
  COMPUTE_ACCOUNT_BOUNDARY,
  COMPUTE_UNITS_PER_USD,
  toComputeUnits,
  fromComputeUnits,
  createComputeAccount
});
