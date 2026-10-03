/** One local economic coordinator over the existing canonical TUMBO engine.
 * Domain modules own obligations and policies; this module owns command identity,
 * funded transfers, receipts, persistence references and aggregate commitments.
 * A browser rehearsal never acquires custody, signing or external settlement authority.
 */
import {
  sha256Hex
} from './token-sha256.js?v=20261003-complete8';

export const ECONOMIC_KERNEL_SOURCE = 'matumbo-economic-kernel';
export const ECONOMIC_KERNEL_FORMAT = 'matumbo-economic-kernel-v1';
export const ECONOMIC_POOLS = Object.freeze({
  rewards: 'b:economic-rewards',
  reserve: 'b:economic-reserve',
  insurance: 'b:economic-insurance',
  operations: 'b:economic-operations',
});
export function economicInteger(value, label = 'amount', {
  positive = true
} = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new RangeError(`${label} must be an exact ${positive ? 'positive' : 'non-negative'} integer`);
  return value;
}
export function economicActor(value) {
  if (typeof value !== 'string' || !/^[ub]:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) || /^b:econ(?:omic)?-/.test(value)) throw new TypeError('A participant account is required');
  return value;
}
/** Canonical bounded JSON rejects silent NaN/Infinity conversion and prototypes. */
export function economicJson(value, depth = 0) {
  if (depth > 18) throw new RangeError('Economic metadata is too deeply nested');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Economic metadata needs finite numbers');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 131072) throw new RangeError('Economic metadata is too long');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 4000) throw new RangeError('Economic metadata has too many rows');
    return Object.freeze(value.map(item => economicJson(item, depth + 1)));
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort();
    if (keys.length > 100) throw new RangeError('Economic metadata has too many fields');
    const output = {};
    for (const key of keys) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('Unsafe economic metadata key');
      output[key] = economicJson(value[key], depth + 1);
    }
    return Object.freeze(output);
  }
  throw new TypeError('Economic metadata must be plain JSON');
}
export const economicDigest = value => sha256Hex(JSON.stringify(economicJson(value)));
const uniqueKey = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,180}$/.test(value)) throw new TypeError('A bounded client idempotencyKey is required');
  return value;
};
const addExact = (a, b) => {
  const n = a + b;
  if (!Number.isSafeInteger(n)) throw new RangeError('Aggregate exceeds exact integer range');
  return n;
};

/** Merkle-sum commits to both account balances and aggregate quantities. */
export function createEconomicProof(engine, obligations = []) {
  if (!engine?.ledger?.verifyChain?.().ok) throw new Error('Cannot prove an invalid canonical ledger');
  const accounts = [...engine.ledger.accounts()].filter(row => row.account !== 'sys:issuance')
    .sort((a, b) => `${a.account}|${a.asset}`.localeCompare(`${b.account}|${b.asset}`, 'en'));
  let nodes = accounts.map(row => {
    const amountFluff = economicInteger(engine.balance(row.account, row.asset), 'balance', {
      positive: false
    });
    const sums = {
      TUMBO: row.asset === 'TUMBO' ? amountFluff : 0,
      sMIMAS: row.asset === 'sMIMAS' ? amountFluff : 0
    };
    return {
      hash: economicDigest({
        leaf: {
          ...row,
          amountFluff
        },
        sums
      }),
      sums
    };
  });
  const leaves = accounts.map(row => ({
    ...row,
    amountFluff: engine.balance(row.account, row.asset)
  }));
  if (!nodes.length) nodes = [{
    hash: economicDigest({
      empty: true
    }),
    sums: {
      TUMBO: 0,
      sMIMAS: 0
    }
  }];
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i],
        right = nodes[i + 1];
      if (!right) {
        next.push(left);
        continue;
      }
      const sums = {
        TUMBO: addExact(left.sums.TUMBO, right.sums.TUMBO),
        sMIMAS: addExact(left.sums.sMIMAS, right.sums.sMIMAS)
      };
      next.push({
        hash: economicDigest({
          left: left.hash,
          right: right.hash,
          sums
        }),
        sums
      });
    }
    nodes = next;
  }
  const root = nodes[0],
    expected = {
      TUMBO: engine.config.supply.TUMBO,
      sMIMAS: engine.config.supply.sMIMAS
    };
  const liabilities = economicJson(obligations);
  return economicJson({
    algorithm: 'SHA-256 Merkle-sum',
    root: root.hash,
    sums: root.sums,
    expected,
    conserved: root.sums.TUMBO === expected.TUMBO && root.sums.sMIMAS === expected.sMIMAS,
    leaves,
    liabilityRoot: economicDigest(liabilities),
    obligations: liabilities,
    receiptCount: engine.ledger.journalCount(),
    receiptIntegrity: 'canonical FNV chain; separate SHA-256 balance commitment',
    externalAnchor: null,
    localOnly: true,
    simulation: true
  });
}

export function createEconomicKernel({
  engine,
  clock = () => Date.now(),
  maxCommands = 2000,
  maxJournals = 3000,
  maxQuotes = 1000,
  maxCommandChars = 2000000
} = {}) {
  if (!engine?.ledger?.post || typeof engine.balance !== 'function') throw new TypeError('Economic kernel requires the canonical QuoteEngine');
  economicInteger(maxCommands, 'command limit');
  economicInteger(maxCommandChars, 'command export budget');
  // Journals plus cancellation receipts stay within the bundle's 4000-row bound.
  if (maxJournals + maxQuotes > 4000 || engine._issuedQuotes.size > maxQuotes) throw new Error('Canonical history exceeds its local export capacity');
  const economicCustody = engine.ledger.claimEconomicCustody({
    maxJournals,
    maxQuotes
  });
  const commands = [],
    events = [],
    replay = new Map(),
    handlers = new Map(),
    projections = new Map(),
    listeners = new Set();
  let active = false,
    disposed = false,
    replayTime = null,
    commandChars = 0;
  const balance = (account, asset = 'TUMBO') => engine.balance(account, asset);
  const idFor = (key, label = '') => economicDigest({
    key,
    label
  }).slice(0, 24);

  function register(type, handler) {
    if (!/^[a-z][a-z0-9.-]{1,80}$/.test(type) || handlers.has(type) || typeof handler !== 'function') throw new TypeError('Unique economic command handler required');
    handlers.set(type, handler);
    return input => execute(type, input);
  }

  function execute(type, original = {}) {
    if (disposed) throw new Error('Economic kernel owner has been disposed');
    const input = economicJson(original, 4),
      key = uniqueKey(input.idempotencyKey),
      requestHash = economicDigest({
        type,
        input
      });
    const prior = replay.get(key);
    if (prior) {
      if (prior.requestHash !== requestHash) throw new Error('IDEM_MISMATCH: economic key belongs to another request');
      return prior.result;
    }
    if (active) throw new Error('Economic commands cannot re-enter a pending transition');
    if (commands.length >= maxCommands) throw new Error('Local economic history is full; export before starting a new rehearsal');
    const handler = handlers.get(type);
    if (!handler) throw new Error(`Unknown economic command ${type}`);
    const now = replayTime ?? clock();
    economicInteger(now, 'time', {
      positive: false
    });
    // Reserve bounded wrapper and receipt-key space before a handler can move value.
    const commandCost = JSON.stringify({
      type,
      input,
      at: now
    }).length + 1024;
    if (commandChars + commandCost > maxCommandChars) throw new Error('Local economic export budget is full; export before starting a new rehearsal');
    const journals = [];
    let committed = false;
    active = true;
    try {
      const post = (postings, {
        label = 'settlement',
        links = {},
        memo = type,
        burn = false
      } = {}) => {
        if (journals.length) throw new Error('A domain transition must settle in one atomic journal');
        if (typeof label !== 'string' || label.length > 80) throw new Error('Economic receipt label must be bounded text');
        const safe = economicJson(postings);
        for (const leg of safe)
          if (leg.account.startsWith('sys:') && !(leg.account === 'sys:void' && leg.amount > 0 && burn)) throw new Error('Economic domains cannot debit system balances or issue supply');
        const receipt = engine.ledger.post(safe, {
          idempotencyKey: `economic:${key}:${label}`,
          economicCustody,
          action: `economic:${type}`,
          memo: String(memo).slice(0, 160),
          links: {
            economicKernel: true,
            commandKey: key,
            metadataHash: economicDigest(links)
          },
          ...(burn ? {
            voidCreditReason: 'burn'
          } : {})
        });
        journals.push(receipt);
        committed = true;
        return receipt;
      };
      const result = economicJson(handler(input, {
        key,
        now,
        restoring: replayTime !== null,
        id: label => idFor(key, label),
        post,
        balance,
        engine
      }));
      const unsigned = economicJson({
        sequence: events.length + 1,
        type,
        key,
        requestHash,
        at: now,
        prevHash: events.at(-1)?.hash ?? 'genesis',
        resultHash: economicDigest(result),
        receiptKeys: journals.map(row => row.idempotencyKey),
        receiptHashes: journals.map(row => row.hash)
      });
      const event = economicJson({
        ...unsigned,
        hash: economicDigest(unsigned)
      });
      events.push(event);
      commands.push(economicJson({
        type,
        input,
        at: now,
        eventHash: event.hash,
        receiptKeys: event.receiptKeys
      }));
      commandChars += commandCost;
      replay.set(key, {
        requestHash,
        result
      });
      if (replayTime === null)
        for (const receipt of journals) engine._emit?.('receipt', {
          receipt
        });
      for (const callback of [...listeners]) {
        try {
          callback(event);
        } catch {
          /* Observers do not authorize or unwind settlement. */ }
      }
      return result;
    } catch (error) {
      if (committed) {
        error.message = `Domain invariant failed after journal commit: ${error.message}`;
      }
      throw error;
    } finally {
      active = false;
    }
  }
  const fundPool = register('pool.fund', (input, {
    post,
    balance: read
  }) => {
    const from = economicActor(input.from),
      pool = ECONOMIC_POOLS[input.purpose];
    if (!pool) throw new Error('Unknown purpose-specific pool');
    const amountFluff = economicInteger(input.amountFluff);
    const receipt = post([{
      account: from,
      asset: 'TUMBO',
      amount: -amountFluff
    }, {
      account: pool,
      asset: 'TUMBO',
      amount: amountFluff
    }], {
      links: {
        purpose: input.purpose
      }
    });
    return {
      purpose: input.purpose,
      account: pool,
      amountFluff,
      receiptId: receipt.id,
      receiptKey: receipt.idempotencyKey,
      simulation: true
    };
  });
  const pay = register('payment.send', (input, {
    post
  }) => {
    const from = economicActor(input.from),
      to = economicActor(input.to),
      amountFluff = economicInteger(input.amountFluff);
    if (from === to) throw new Error('Payment requires two participants');
    const receipt = post([{
      account: from,
      asset: 'TUMBO',
      amount: -amountFluff
    }, {
      account: to,
      asset: 'TUMBO',
      amount: amountFluff
    }]);
    return {
      from,
      to,
      amountFluff,
      status: 'settled-local',
      receiptId: receipt.id,
      receiptKey: receipt.idempotencyKey,
      externalSettlement: false
    };
  });
  const burnReserve = register('reserve.burn', (input, {
    post
  }) => {
    if (input.explicit !== true) throw new Error('Reserve burn requires explicit approval');
    const amountFluff = economicInteger(input.amountFluff);
    const receipt = post([{
      account: ECONOMIC_POOLS.reserve,
      asset: 'TUMBO',
      amount: -amountFluff
    }, {
      account: 'sys:void',
      asset: 'TUMBO',
      amount: amountFluff
    }], {
      burn: true
    });
    return {
      amountFluff,
      receiptId: receipt.id,
      receiptKey: receipt.idempotencyKey,
      irreversible: true,
      simulation: true
    };
  });

  function project(name, reader) {
    if (projections.has(name) || typeof reader !== 'function') throw new Error('Unique domain projection required');
    projections.set(name, reader);
  }

  function snapshot({
    includeProof = false
  } = {}) {
    const domains = {};
    const obligations = [];
    for (const [name, reader] of projections) {
      domains[name] = economicJson(reader());
      obligations.push(...(domains[name].obligations ?? []));
    }
    return economicJson({
      source: ECONOMIC_KERNEL_SOURCE,
      schemaVersion: 1,
      domains,
      pools: Object.fromEntries(Object.entries(ECONOMIC_POOLS).map(([purpose, account]) => [purpose, {
        account,
        amountFluff: balance(account)
      }])),
      events,
      commandCount: commands.length,
      eventRoot: events.at(-1)?.hash ?? 'genesis',
      canonicalReceiptCount: engine.ledger.journalCount(),
      canonicalChainValid: engine.ledger.verifyChain().ok,
      ...(includeProof ? {
        proof: createEconomicProof(engine, obligations)
      } : {}),
      simulation: true,
      authority: 'local-browser-rehearsal',
      externalSettlement: false,
      publicSupplyDecision: 'undecided'
    });
  }

  function exportState() {
    const body = economicJson({
      format: ECONOMIC_KERNEL_FORMAT,
      commands,
      eventRoot: events.at(-1)?.hash ?? 'genesis'
    });
    return JSON.stringify({
      ...body,
      digest: economicDigest(body)
    });
  }

  function restore(raw) {
    if (commands.length) throw new Error('Restore requires a fresh kernel');
    if (typeof raw !== 'string' || raw.length > 8_000_000) throw new Error('Economic snapshot is missing or oversized');
    const data = economicJson(JSON.parse(raw));
    if (data.format !== ECONOMIC_KERNEL_FORMAT || Object.keys(data).some(k => !['format', 'commands', 'eventRoot', 'digest'].includes(k)) || !Array.isArray(data.commands) || data.commands.length > maxCommands) throw new Error('Unsupported economic snapshot');
    const body = {
      format: data.format,
      commands: data.commands,
      eventRoot: data.eventRoot
    };
    if (economicDigest(body) !== data.digest) throw new Error('Economic snapshot integrity mismatch');
    const seen = new Set(),
      linkedReceipts = new Set();
    for (const row of data.commands) {
      if (!handlers.has(row.type) || Object.keys(row).some(k => !['type', 'input', 'at', 'eventHash', 'receiptKeys'].includes(k)) || seen.has(uniqueKey(row.input?.idempotencyKey)) || !Array.isArray(row.receiptKeys)) throw new Error('Invalid economic command history');
      economicInteger(row.at, 'event time', {
        positive: false
      });
      seen.add(row.input.idempotencyKey);
      for (const key of row.receiptKeys) {
        if (!engine.ledger._receipts.has(key)) throw new Error('Economic history is missing its canonical journal; restore the paired ledger snapshot first');
        if (linkedReceipts.has(key)) throw new Error('Canonical economic journal has multiple command owners');
        linkedReceipts.add(key);
      }
    }
    for (const receipt of engine.ledger._journals)
      if (receipt.links?.economicKernel === true && !linkedReceipts.has(receipt.idempotencyKey)) throw new Error('Canonical economic journal is missing its domain command; an earlier component prefix cannot replace paired history');
    for (const row of data.commands) {
      replayTime = row.at;
      try {
        execute(row.type, row.input);
      } finally {
        replayTime = null;
      }
      if (events.at(-1).hash !== row.eventHash || JSON.stringify(events.at(-1).receiptKeys) !== JSON.stringify(row.receiptKeys)) throw new Error('Economic replay differs from recorded evidence');
    }
    if ((events.at(-1)?.hash ?? 'genesis') !== data.eventRoot) throw new Error('Economic event root mismatch');
    return snapshot();
  }
  return Object.freeze({
    engine,
    register,
    execute,
    project,
    balance,
    fundPool,
    pay,
    burnReserve,
    snapshot,
    exportState,
    restore,
    dispose() {
      if (active) throw new Error('Cannot dispose a pending economic transition');
      if (disposed) return;
      disposed = true;
      listeners.clear();
      engine.ledger.releaseEconomicCustody(economicCustody);
    },
    onEvent(callback) {
      if (typeof callback !== 'function') throw new TypeError('Observer required');
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    proof() {
      const obligations = [];
      for (const reader of projections.values()) obligations.push(...(reader().obligations ?? []));
      return createEconomicProof(engine, obligations);
    }
  });
}
