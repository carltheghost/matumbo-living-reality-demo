/** Shared local runtime. All surfaces see the same credits, creator records and token owner. */
import {
  createEconomicKernel,
  economicJson,
  economicDigest,
  ECONOMIC_POOLS
} from './economic-kernel.js?v=20261003-skin360';
import {
  createEconomicFinance
} from './economic-finance.js?v=20261003-skin360';
import {
  createComputeJobs
} from './compute-jobs.js?v=20261003-skin360';
import {
  createComputeAccount
} from './compute-account.js?v=20261003-skin360';
import {
  createComputeExchangeLedger
} from './compute-exchange.js?v=20261003-skin360';
import {
  createContributionVault
} from './contribution-vault.js?v=20261003-skin360';
import {
  createEconomicTimeline
} from './economic-timeline.js?v=20261003-skin360';
import {
  createCreatorEconomy,
  createDesignSession
} from './creator-economy.js?v=20261003-skin360';
import {
  serializeTokenEngine,
  loadTokenEngine
} from './token-store.js?v=20261003-skin360';

export const ECONOMIC_STORAGE_KEY = 'matumbo.ourplace.economic-runtime.v1';
const CORE_FIELDS = ['ledger', '_receipts', '_issuedQuotes', '_issuedQuoteIds', '_executedQuoteIds', '_cancelledQuoteIds', '_reversedJournalKeys', 'botPricing'];
const same = (a, b) => economicDigest(a) === economicDigest(b);
// Browser persistence belongs to the domain owner, never to scene projections.
function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
export function createEconomicRuntime({
  engine,
  storage = browserStorage(),
  clock = () => Date.now(),
  onChange = null,
  restore = true
} = {}) {
  const suppliedClock = clock;
  let clockOffsetMs = 0;
  clock = () => suppliedClock() + clockOffsetMs;
  let storeStatus = 'in-memory',
    restoreStatus = 'no-stored-bundle',
    saving = false,
    disposed = false;

  function build(owner, saved = null) {
    const observations = new Map();
    if (saved)
      for (const row of saved.observations ?? []) {
        const {
          commitment,
          ...body
        } = economicJson(row);
        if (economicDigest(body) !== commitment || observations.has(body.evidenceId)) throw new Error('Invalid local adoption observation');
        observations.set(body.evidenceId, row);
      }
    const kernel = createEconomicKernel({
        engine: owner,
        clock
      }),
      account = createComputeAccount({
        now: clock,
        maxEvents: 4000
      });
    const advanceClock = kernel.register('clock.advance', (input, ctx) => {
      if (input.explicit !== true || !Number.isSafeInteger(input.deltaMs) || input.deltaMs < 1 || input.deltaMs > 86400000) throw new Error('Explicit rehearsal clock advance must be between 1ms and one day');
      if (!ctx.restoring) {
        if (clockOffsetMs + input.deltaMs > 31536000000) throw new Error('Rehearsal clock limit reached');
        clockOffsetMs += input.deltaMs;
      }
      return {
        deltaMs: input.deltaMs,
        authority: 'local-rehearsal-clock',
        realTimeChanged: false
      };
    });
    const exchange = createComputeExchangeLedger({
        maxReceipts: 2000
      }),
      vault = createContributionVault({
        now: clock,
        maxContributions: 500
      }),
      timeline = createEconomicTimeline({
        maxEvents: 4000
      }),
      designSession = createDesignSession();
    const creator = createCreatorEconomy({
      settlementJournalCount: () => owner.ledger.journalCount(),
      observationVerifier: input => {
        const row = observations.get(input.evidenceId);
        return Boolean(row && ['designKey', 'actor', 'sessionId', 'period', 'kind'].every(field => row[field] === input[field]));
      },
      payoutVerifier: (receipt, plan) => {
        const actual = owner.ledger._journals.find(row => row.id === receipt.id);
        return Boolean(actual && owner.ledger.verifyReceipt(actual.id).ok && actual.hash === receipt.hash &&
          same(actual.postings.map(leg => ({
            account: leg.account,
            asset: leg.asset,
            delta: String(leg.amount)
          })), plan.entries));
      },
    });
    const finance = createEconomicFinance(kernel),
      compute = createComputeJobs(kernel, {
        account,
        exchange,
        contributions: vault
      });
    const settleCreatorPlan = kernel.register('creator.settle', (input, ctx) => {
      const plan = creator.snapshot().payoutPlans.find(row => row.planId === input.planId);
      if (!plan || (!ctx.restoring && plan.state !== 'planned')) throw new Error('An unsettled funded creator payout plan is required');
      if (plan.fundingAccount !== ECONOMIC_POOLS.rewards || !plan.totalFluff || creator.snapshot().historyLength >= 2500) throw new Error('Creator plan has no available purpose-specific authority');
      const postings = plan.entries.map(leg => ({
        account: leg.account,
        asset: leg.asset,
        amount: Number(leg.delta)
      }));
      if (postings.some(leg => !Number.isSafeInteger(leg.amount)) || postings.reduce((sum, leg) => sum + leg.amount, 0) !== 0) throw new Error('Creator payout allocation is not exact');
      let receipt;
      const settle = () => (receipt = ctx.post(postings, {
        links: {
          planId: plan.planId,
          planHash: plan.planHash
        }
      }));
      const settled = ctx.restoring ? (settle(), plan) : creator.commitPayout({
        planId: plan.planId,
        explicit: true,
        idempotencyKey: `ack:${ctx.key}`
      }, settle);
      return {
        planId: plan.planId,
        amountFluff: plan.totalFluff,
        state: settled.state,
        settled: settled.state === 'paid',
        reconciliationRequired: settled.state === 'reconciliation-required',
        receiptId: receipt?.id ?? null,
        receiptKey: receipt?.idempotencyKey ?? null,
        receiptHash: receipt?.hash ?? null,
        simulation: true
      };
    });
    kernel.project('creator', () => creator.snapshot());
    if (saved) {
      account.importState(saved.account);
      exchange.importState(saved.exchange);
      vault.importState(saved.vault);
      timeline.importState(saved.timeline);
      designSession.restore(JSON.stringify(saved.designSession));
      creator.restore(JSON.stringify(saved.creator));
      kernel.restore(JSON.stringify(saved.kernel));
      compute.validateRestoredState();
    }
    return {
      kernel,
      account,
      exchange,
      vault,
      timeline,
      creator,
      designSession,
      finance,
      compute,
      observations,
      settleCreatorPlan,
      advanceClock
    };
  }
  let parts;
  if (restore && storage) {
    const originalCore = Object.fromEntries(CORE_FIELDS.map(key => [key, engine[key]]));
    const originalOffset = clockOffsetMs;
    let adopted = false;
    try {
      const raw = storage.getItem(ECONOMIC_STORAGE_KEY);
      if (raw) {
        if (raw.length > 16_000_000) throw new Error('Local economic snapshot is oversized');
        const data = JSON.parse(raw),
          {
            digest,
            ...body
          } = data;
        if (data.format !== 'matumbo-economic-runtime-v1' || economicDigest(body) !== digest) throw new Error('Local economic bundle is corrupt');
        if (!Number.isSafeInteger(data.clockOffsetMs) || data.clockOffsetMs < 0 || data.clockOffsetMs > 31536000000) throw new Error('Invalid rehearsal clock');
        const recordedOffset = (data.kernel?.commands ?? []).filter(row => row.type === 'clock.advance').reduce((sum, row) => {
          if (!Number.isSafeInteger(row.input?.deltaMs) || row.input.deltaMs < 1 || row.input.deltaMs > 86400000 || sum + row.input.deltaMs > 31536000000) throw new Error('Invalid rehearsal clock history');
          return sum + row.input.deltaMs;
        }, 0);
        if (recordedOffset !== data.clockOffsetMs) throw new Error('Rehearsal clock differs from its command history');
        clockOffsetMs = data.clockOffsetMs;
        if (engine.ledger.journalCount() !== 4) throw new Error('A current active token owner cannot be replaced by stored history');
        const candidate = loadTokenEngine(JSON.stringify(data.token), {
          config: engine.config
        });
        const validated = build(candidate, data);
        validated.kernel.dispose();
        // Only after every domain and receipt has validated may the one owner adopt the stored state.
        for (const key of CORE_FIELDS) engine[key] = candidate[key];
        adopted = true;
        parts = build(engine, data);
        restoreStatus = storeStatus = 'restored-validated-local-bundle';
      }
    } catch (error) {
      if (adopted)
        for (const key of CORE_FIELDS) engine[key] = originalCore[key];
      clockOffsetMs = originalOffset;
      restoreStatus = storeStatus = `stored-history-rejected: ${error.message}`;
    }
  }
  parts ??= build(engine);

  function exportState() {
    const body = {
      format: 'matumbo-economic-runtime-v1',
      clockOffsetMs,
      token: JSON.parse(serializeTokenEngine(engine)),
      kernel: JSON.parse(parts.kernel.exportState()),
      account: parts.account.exportState(),
      exchange: parts.exchange.exportState(),
      vault: parts.vault.exportState(),
      timeline: parts.timeline.exportState(),
      creator: JSON.parse(parts.creator.serialize()),
      designSession: JSON.parse(parts.designSession.serialize()),
      observations: [...parts.observations.values()]
    };
    return JSON.stringify({
      ...body,
      digest: economicDigest(body)
    });
  }

  function persist() {
    if (disposed) return false;
    try {
      if (!storage) return false;
      storage.setItem(ECONOMIC_STORAGE_KEY, exportState());
      storeStatus = 'saved-local-bundle';
      return true;
    } catch (error) {
      storeStatus = `storage-unavailable: ${error.message}`;
      return false;
    }
  }

  function changed() {
    if (saving || disposed) return;
    saving = true;
    queueMicrotask(() => {
      saving = false;
      persist();
      try {
        onChange?.(snapshot());
      } catch {
        /* Read-only projection observer. */ }
    });
  }
  const offKernel = parts.kernel.onEvent(changed),
    offLedger = engine.ledger.onCommit(changed);

  function observeAdoption({
    designKey,
    actor,
    sessionId,
    descriptorHash,
    kind = 'adoption'
  }) {
    const design = parts.creator.snapshot().designs.find(row => row.key === designKey);
    if (!design || design.descriptorHash !== descriptorHash) throw new Error('Applied design must match its registered version');
    const period = new Date(clock()).toISOString().slice(0, 10),
      evidenceId = `apply:${economicDigest({ designKey, actor, sessionId, period, kind }).slice(0, 32)}`;
    const body = economicJson({
      evidenceId,
      designKey,
      actor,
      sessionId,
      period,
      kind,
      descriptorHash,
      authority: 'local-browser-observation',
      at: clock()
    });
    const duplicateObserved = parts.observations.has(evidenceId);
    if (!duplicateObserved && parts.observations.size >= 2500) throw new Error('Local adoption observations are full; export before starting a new rehearsal');
    if (!duplicateObserved) parts.observations.set(evidenceId, economicJson({
      ...body,
      commitment: economicDigest(body)
    }));
    let result;
    try {
      result = parts.creator.recordUsage({
        usageId: evidenceId,
        designKey,
        actor,
        sessionId,
        period,
        kind,
        evidenceId,
        idempotencyKey: `usage:${evidenceId}`
      });
    } catch (error) {
      if (!duplicateObserved) parts.observations.delete(evidenceId);
      throw error;
    }
    changed();
    return economicJson({
      ...result,
      duplicateObserved
    });
  }

  function planCreatorPayout({
    period = new Date(clock()).toISOString().slice(0, 10),
    planId,
    idempotencyKey
  }) {
    const prior = parts.creator.snapshot().payoutPlans.find(row => row.planId === planId);
    if (prior) {
      if (prior.period !== period) throw new Error('Payout plan belongs to another period');
      return prior;
    }
    const plan = parts.creator.planPayout({
      planId,
      period,
      fundingAccount: ECONOMIC_POOLS.rewards,
      availableFluff: parts.kernel.balance(ECONOMIC_POOLS.rewards),
      idempotencyKey
    });
    changed();
    return plan;
  }

  function snapshot() {
    return economicJson({
      ...parts.kernel.snapshot(),
      storageStatus: storeStatus,
      restoreStatus,
      rehearsalTime: clock(),
      clockOffsetMs,
      designSession: parts.designSession.snapshot(),
      adoptionAuthority: 'local-browser-observations; public identity and anti-Sybil adapter unavailable',
      publishAuthority: 'reviewed portable local design package; public registry adapter unavailable'
    });
  }
  return Object.freeze({
    ...parts,
    observeAdoption,
    planCreatorPayout,
    snapshot,
    exportState,
    persist,
    changed,
    now: clock,
    dispose() {
      if (disposed) return;
      persist();
      disposed = true;
      offKernel();
      offLedger();
      parts.kernel.dispose();
    }
  });
}
