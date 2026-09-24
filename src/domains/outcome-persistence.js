/** Atomic durable LOCAL workspace for the existing outcome desk + relic vault.
 * Replay always builds fresh raw domains. Only after the journal is persisted do
 * both stable proxies move to the candidate domains. Nested desk→vault mutations
 * are part of one command, never reminted into the live vault during validation.
 * Digests/local actor names are consistency checks, not authenticated authority.
 */
import { createOutcomeContracts, hashOutcomeSeed } from './outcome-contracts.js';
import { createFrozenRelics } from './frozen-relics.js';

export const CONTRACT_WORKSPACE_STORAGE_KEY = 'matumbo.contract-workspace.v1';
const VERSION = 1, MAX_BYTES = 4_000_000, MAX_COMMANDS = 4000;
const FIELDS = Object.freeze({
  'desk.createContract': ['eventId', 'eventLabel', 'outcomes', 'creator', 'status', 'idempotencyKey'],
  'desk.publish': ['contractId'], 'desk.lock': ['contractId'],
  'desk.join': ['contractId', 'participant', 'outcome', 'stakeAmount', 'idempotencyKey'],
  'desk.recordResult': ['contractId', 'result'], 'desk.settle': ['contractId'],
  'desk.void': ['contractId', 'reason'], 'desk.transferAward': ['nftId', 'toHolder', 'idempotencyKey'],
  'desk.claimAward': ['nftId', 'idempotencyKey'], 'desk.reset': [],
  'vault.mintRelic': ['name', 'origin', 'creator', 'terms', 'holder'],
  'vault.recordLifeEvent': ['relicId', 'kind', 'detail'], 'vault.witness': ['relicId', 'kind', 'detail'],
  'vault.annotate': ['relicId', 'note'], 'vault.recordRelicTransfer': ['relicId', 'toHolder'],
  'vault.recordRelicClaim': ['relicId', 'holder', 'amount'], 'vault.reset': [],
});
const READS = {
  desk: ['get', 'getLifecycle', 'list', 'getNft', 'listEscrows', 'listNfts', 'claimableFor', 'createContribution'],
  vault: ['getRelic', 'listRelics', 'verifyFrozenCore', 'createContribution'],
};
const clone = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function plain(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`${label}: unexpected field ${key}`);
}
function safeJSON(value, depth = 0) {
  if (depth > 12) throw new TypeError('Contract journal JSON is too deeply nested');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string' && value.length <= 4000) return;
  if (Array.isArray(value) && value.length <= 128) { value.forEach((item) => safeJSON(item, depth + 1)); return; }
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Unsafe journal key');
      safeJSON(item, depth + 1);
    }
    return;
  }
  throw new TypeError('Contract journal requires bounded plain JSON');
}
function timestamp(value) {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 8_640_000_000_000_000) throw new TypeError('Invalid contract journal clock');
  return ms;
}
function parameters(operation, input = {}) {
  const allowed = FIELDS[operation];
  if (!allowed) throw new TypeError('Unsupported contract journal command');
  plain(input, allowed, 'contract command');
  const result = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  safeJSON(result);
  return clone(result);
}
function createDomains(envelope) {
  const domains = { at: envelope.createdAt, createKeys: new Map() };
  domains.vault = createFrozenRelics({ seed: envelope.relicSeed, now: () => domains.at });
  domains.desk = createOutcomeContracts({ seed: envelope.outcomeSeed, now: () => domains.at, relicVault: domains.vault });
  return domains;
}
function assertLinks(domains) {
  const awards = domains.desk.listNfts();
  const relics = domains.vault.listRelics();
  for (const nft of awards) {
    const relic = relics.find((entry) => entry.id === nft.relicId);
    if (!relic || relic.award?.awardNftId !== nft.id || relic.award?.escrowId !== nft.escrowId || relic.award?.contractId !== nft.contractId || relic.life.holder !== nft.holder || relic.life.claimed !== nft.claimed || Number(relic.frozenCore.terms.claimAmount) !== nft.amount) throw new Error('Contract/relic identity, holder, amount or claim parity failed');
  }
  if (relics.some((relic) => relic.award && !awards.some((nft) => nft.id === relic.award.awardNftId && nft.relicId === relic.id))) throw new Error('Reset would orphan a linked contract award; shared award history must remain intact');
}
function stateDigest(domains) {
  return hashOutcomeSeed(canonical({ contracts: domains.desk.list(), escrows: domains.desk.listEscrows(), nfts: domains.desk.listNfts(), trace: domains.desk.getSnapshot().trace, relics: domains.vault.listRelics() }));
}
function execute(domains, operation, input) {
  const [domain, method] = operation.split('.');
  let result;
  if (operation === 'desk.createContract' && input.idempotencyKey != null) {
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 300) throw new TypeError('Creation idempotency key must be a bounded non-empty string');
    const previous = domains.createKeys.get(input.idempotencyKey);
    if (previous) {
      if (canonical(previous.input) !== canonical(input)) throw new TypeError('Creation idempotency key was used with different terms');
      const existing = domains.desk.get(previous.id);
      if (!existing) throw new Error('Previously created idempotent contract was reset; use a new approval identity');
      return existing;
    }
  }
  if (domain === 'vault' && ['recordRelicTransfer', 'recordRelicClaim'].includes(method)) {
    const relic = domains.vault.getRelic(input.relicId);
    if (relic.award) {
      const nftId = relic.award.awardNftId;
      if (method === 'recordRelicTransfer') domains.desk.transferAward({ nftId, toHolder: input.toHolder });
      else {
        const nft = domains.desk.getNft(nftId);
        if (input.holder !== undefined && input.holder !== nft.holder) throw new Error('Claim holder differs from linked award holder');
        if (input.amount !== undefined && Number(input.amount) !== nft.amount) throw new Error('Claim amount differs from linked award amount');
        domains.desk.claimAward({ nftId });
      }
      result = domains.vault.getRelic(input.relicId);
    } else result = domains.vault[method](input);
  } else result = domains[domain][method](input);
  assertLinks(domains);
  if (operation === 'desk.createContract' && input.idempotencyKey != null) domains.createKeys.set(input.idempotencyKey, { input: clone(input), id: result.id });
  return result;
}
function replay(envelope, seeds) {
  plain(envelope, ['schemaVersion', 'outcomeSeed', 'relicSeed', 'createdAt', 'commands', 'stateDigest', 'simulation'], 'contract workspace journal');
  if (envelope.schemaVersion !== VERSION || envelope.simulation !== true || envelope.outcomeSeed !== seeds.outcomeSeed || envelope.relicSeed !== seeds.relicSeed) throw new TypeError('Contract journal version, seeds or simulation boundary mismatch');
  timestamp(envelope.createdAt);
  if (!Array.isArray(envelope.commands) || envelope.commands.length > MAX_COMMANDS) throw new TypeError('Contract journal command limit exceeded');
  const domains = createDomains(envelope);
  for (let index = 0; index < envelope.commands.length; index += 1) {
    const command = envelope.commands[index];
    plain(command, ['seq', 'operation', 'input', 'at', 'resultDigest'], 'journal command');
    if (command.seq !== index + 1 || timestamp(command.at) < domains.at) throw new TypeError('Contract journal sequence/clock is inconsistent');
    domains.at = command.at;
    const result = execute(domains, command.operation, parameters(command.operation, command.input));
    if (hashOutcomeSeed(canonical(result)) !== command.resultDigest) throw new TypeError('Contract command receipt differs on replay');
  }
  if (stateDigest(domains) !== envelope.stateDigest) throw new TypeError('Contract workspace state differs on replay');
  return domains;
}

export function createPersistentContractWorkspace({ storage = null, storageKey = CONTRACT_WORKSPACE_STORAGE_KEY, outcomeSeed = 'local-outcomes', relicSeed = 'local-relics', now = () => Date.now() } = {}) {
  if (typeof now !== 'function') throw new TypeError('Contract persistence requires a clock function');
  for (const seed of [outcomeSeed, relicSeed]) if (typeof seed !== 'string' || !seed.trim() || seed.length > 160) throw new TypeError('Contract persistence requires bounded seeds');
  if (storage && (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function')) throw new TypeError('Contract storage requires synchronous getItem/setItem');
  const seeds = { outcomeSeed, relicSeed };
  let status = { mode: storage ? 'durable' : 'memory', status: 'ok', error: null };
  let storedRaw = null, journal, domains, busy = false;
  const listeners = new Set();
  const readRaw = () => storage ? storage.getItem(storageKey) ?? null : null;
  function load() {
    const raw = readRaw();
    let nextJournal, nextDomains;
    if (raw !== null) {
      if (typeof raw !== 'string' || raw.length > MAX_BYTES) throw new TypeError('Contract journal storage exceeds its limit');
      nextJournal = JSON.parse(raw); nextDomains = replay(nextJournal, seeds);
    } else {
      nextJournal = { schemaVersion: VERSION, ...seeds, createdAt: timestamp(now()), commands: [], stateDigest: '', simulation: true };
      nextDomains = createDomains(nextJournal); nextJournal.stateDigest = stateDigest(nextDomains);
    }
    storedRaw = raw; journal = nextJournal; domains = nextDomains;
    status = { mode: storage ? 'durable' : 'memory', status: 'ok', error: null };
  }
  try { load(); }
  catch (error) { throw new Error(`Contract workspace restore failed; saved data was not changed: ${error.message}`); }
  function held(error) {
    status = { mode: storage ? 'durable' : 'memory', status: 'error', error: String(error.message ?? error) };
    throw new Error(`Contract workspace held: ${status.error}`);
  }
  function mutate(operation, input) {
    if (busy) throw new Error('Reentrant contract journal mutation is not allowed');
    busy = true;
    try {
      if (storage) {
        let currentRaw;
        try { currentRaw = readRaw(); } catch (error) { return held(error); }
        if (currentRaw !== storedRaw) return held(new Error('Another tab changed the contract workspace; reload before continuing'));
      }
      const args = parameters(operation, input);
      if (journal.commands.length >= MAX_COMMANDS) return held(new Error('Contract journal capacity reached; export an archive'));
      const at = timestamp(now());
      if (at < (journal.commands.at(-1)?.at ?? journal.createdAt)) return held(new Error('Clock moved backwards; execution is held'));
      const working = replay(journal, seeds);
      working.at = at;
      const before = stateDigest(working);
      const result = execute(working, operation, args);
      const nextDigest = stateDigest(working);
      if (nextDigest === before) return result;
      const next = { ...journal, commands: [...journal.commands, { seq: journal.commands.length + 1, operation, input: args, at, resultDigest: hashOutcomeSeed(canonical(result)) }], stateDigest: nextDigest };
      const serialized = JSON.stringify(next);
      if (serialized.length > MAX_BYTES) return held(new Error('Contract journal storage size limit reached'));
      if (storage) {
        try {
          if (readRaw() !== storedRaw) throw new Error('Another tab changed the contract workspace; reload before continuing');
          storage.setItem(storageKey, serialized);
        } catch (error) { return held(error); }
      }
      journal = next; domains = working; storedRaw = storage ? serialized : null;
      status = { mode: storage ? 'durable' : 'memory', status: 'ok', error: null };
      for (const listener of listeners) { try { listener(workspace.getSnapshot()); } catch { /* projections have no authority */ } }
      return result;
    } finally { busy = false; }
  }
  function read(domain, method, args) {
    const previous = domains.at;
    try { domains.at = timestamp(now()); return domains[domain][method](...args); }
    finally { domains.at = previous; }
  }
  const proxies = {};
  for (const domain of ['desk', 'vault']) {
    const api = {
      source: domains[domain].source,
      boundary: domains[domain].boundary,
      getSnapshot: () => freeze({ ...clone(read(domain, 'getSnapshot', [])), persistence: { ...status }, durableCommandCount: journal.commands.length }),
      getPersistenceStatus: () => freeze({ ...status }),
    };
    if (domain === 'vault') { api.collection = domains.vault.collection; api.form = domains.vault.form; }
    for (const operation of Object.keys(FIELDS).filter((entry) => entry.startsWith(`${domain}.`))) api[operation.split('.')[1]] = (input = {}) => mutate(operation, input);
    for (const name of READS[domain]) api[name] = (...args) => read(domain, name, args);
    if (domain === 'vault') api.mintRelicFromAward = () => { throw new Error('Award relics are minted atomically by the shared outcome desk'); };
    proxies[domain] = Object.freeze(api);
  }
  const workspace = {
    vault: proxies.vault, outcomeDesk: proxies.desk,
    getPersistenceStatus: () => freeze({ ...status }),
    getSnapshot: () => freeze({ simulation: true, persistence: { ...status }, commands: journal.commands.length, outcomes: proxies.desk.getSnapshot(), relics: proxies.vault.getSnapshot() }),
    exportState: () => JSON.stringify(journal),
    reloadFromStorage() {
      if (busy) throw new Error('Cannot reload during a contract mutation');
      try { load(); return workspace.getSnapshot(); } catch (error) { return held(error); }
    },
    subscribe(listener) { if (typeof listener !== 'function') throw new TypeError('Subscriber must be a function'); listeners.add(listener); return () => listeners.delete(listener); },
  };
  return Object.freeze(workspace);
}
