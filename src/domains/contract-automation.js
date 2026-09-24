/**
 * Contract Automation Ω — durable, declarative LOCAL REHEARSAL.
 * This engine is not an identity, legal, wallet, oracle or settlement authority.
 * Approval actors and observation providers are local assertions. An application
 * needing authenticated approvals or background execution must supply a separately
 * authorized backend. Call tick while open and on return; a closed browser does
 * not execute JavaScript. No arbitrary code, URLs, network or real-money actions.
 */
import { planGrading } from './outcome-contracts.js';

export const CONTRACT_AUTOMATION_VERSION = 1;
export const CONTRACT_AUTOMATION_STORAGE_KEY = 'matumbo.contract-automation.v1';
export const CONTRACT_AUTOMATION_BOUNDARY = 'Local simulation only · approvals are local assertions · no real funds, signatures or legal enforcement · automation runs while this app is open and catches up on return.';
const STATUSES = ['pending_approval', 'active', 'paused', 'disputed', 'completed', 'cancelled', 'expired'];
const TERMINAL = ['completed', 'cancelled', 'expired'];
const PROVIDERS = ['manual', 'local', 'public'];
const MAX_CONTRACTS = 256;
const MAX_EVENTS = 20000;
const MAX_BYTES = 4_000_000;
const MAX_TIME = 8_640_000_000_000_000;
const copy = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const publicCopy = (value) => freeze(copy(value));
const fail = (message) => { throw new TypeError(message); };
const cents = (amount) => Math.round(amount * 100);
function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} must be 1–${max} characters`);
  return value.trim();
}
function integer(value, label, min = 0, max = MAX_TIME) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be an integer from ${min} to ${max}`);
  return value;
}
function money(value, label, min = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > 1_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) fail(`${label} must be finite local points with at most two decimals`);
  return value;
}
function object(value, label, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`);
  if (allowed) for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}: unsupported field ${key}`);
  return value;
}
function array(value, label, min = 0, max = 64) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} requires ${min}–${max} items`);
  return value;
}
function unique(values, label) {
  if (new Set(values).size !== values.length) fail(`${label} must be unique`);
  return values;
}
function checkJSON(value, depth = 0, budget = { count: 0 }) {
  if (depth > 24 || ++budget.count > 180000) fail('JSON input exceeds structural limits');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Non-finite JSON number'); return; }
  if (typeof value === 'string') { if (value.length > 20000) fail('JSON string too long'); return; }
  if (Array.isArray(value)) { value.forEach((entry) => checkJSON(entry, depth + 1, budget)); return; }
  object(value, 'JSON value');
  for (const [key, entry] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('Unsafe JSON key');
    checkJSON(entry, depth + 1, budget);
  }
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
// Consistency digest only; explicitly not a signature, proof or tamper protection.
function digest(value) {
  let hash = 2166136261;
  for (const char of stable(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

const source = (id, label, type = 'boolean') => ({ id, label, type, maxAgeMs: 86400000, provider: 'manual' });
const condition = (id, value = true) => ({ op: 'eq', source: id, value });
const transfer = (amount = 100) => ({ type: 'simulated_transfer', from: 'owner', to: 'reviewer', amount });
const rule = (id, when, actions, schedule) => ({ id, label: id.replaceAll('_', ' '), when, actions, ...(schedule ? { schedule } : {}) });
const grant = (resource) => ({ type: 'grant_access', subject: 'reviewer', resource });
const defaults = (sources, rules, extra = {}) => ({ startsAt: null, expiresAt: null, sources, rules, limits: { maxTotalPoints: 1000, maxExecutions: 100 }, ...extra });
const template = (id, label, description, terms) => ({ id, label, description, defaults: terms });
const templates = freeze([
  template('service', 'Service agreement', 'Release local rehearsal points when the agreed service is accepted.', defaults([source('accepted', 'Service accepted')], [rule('service_accepted', condition('accepted'), [transfer()])])),
  template('milestone', 'Milestones / project', 'Independent, ordered milestones; later stages require earlier receipts.', defaults([source('design', 'Design accepted'), source('delivery', 'Delivery accepted')], [rule('design', condition('design'), [transfer(40)]), { ...rule('delivery', condition('delivery'), [transfer(60)]), after: ['design'] }])),
  template('delivery', 'Delivery / purchase', 'Release a local simulated delivery reserve only when delivery is confirmed.', defaults([source('delivered', 'Delivery confirmed')], [rule('delivered', condition('delivered'), [{ type: 'release_escrow', from: 'owner', to: 'reviewer', amount: 100 }])])),
  template('subscription', 'Subscription', 'Three bounded local billing cycles; fresh entitlement evidence is required.', defaults([source('enabled', 'Subscription enabled')], [rule('billing_cycle', condition('enabled'), [transfer(10)], { everyMs: 60000, maxRuns: 3 })])),
  template('recurring', 'Recurring obligation', 'Repeat a bounded obligation on a clock, with renewed evidence for overdue cycles.', defaults([source('eligible', 'Obligation eligible')], [rule('recurring_obligation', condition('eligible'), [{ type: 'record', label: 'Recurring obligation fulfilled' }], { everyMs: 60000, maxRuns: 3 })])),
  template('lease', 'Lease / time-limited access', 'Grant a local resource entitlement, then automatically expire it.', defaults([source('handover', 'Handover accepted')], [rule('lease_access', condition('handover'), [{ ...grant('studio'), durationMs: 3600000 }])])),
  template('access', 'Membership / access', 'Grant a local entitlement when eligibility is evidenced.', defaults([source('eligible', 'Member eligible')], [rule('membership', condition('eligible'), [grant('community')])])),
  template('license', 'License / permission', 'Record a bounded local permission, not a legal intellectual-property license.', defaults([source('accepted', 'Permission terms accepted')], [rule('license', condition('accepted'), [grant('creative-work')])])),
  template('governance', 'Governance / proposal', 'Record an approved proposal when the configured vote threshold is evidenced.', defaults([source('votes', 'Recorded votes', 'number')], [rule('proposal_passed', { op: 'gte', source: 'votes', value: 2 }, [{ type: 'record', label: 'Proposal adopted in local rehearsal' }])])),
  template('conditional_transfer', 'Conditional transfer', 'Bounded local point movement when a declared condition becomes true.', defaults([source('condition', 'Transfer condition')], [rule('conditional_transfer', condition('condition'), [transfer()])])),
  template('escrow', 'Escrow rehearsal', 'Release an approved local simulated reserve after acceptance; disputes hold execution.', defaults([source('release', 'Release condition')], [rule('escrow_release', condition('release'), [{ type: 'release_escrow', from: 'owner', to: 'reviewer', amount: 100 }])])),
  ...['binary', 'multi', 'pool'].map((kind) => {
    const outcomes = kind === 'multi' ? ['A', 'B', 'C'] : ['YES', 'NO'];
    return template(`prediction_${kind}`, `${kind === 'binary' ? 'Binary' : kind === 'multi' ? 'Multi-outcome' : 'Pooled'} prediction`, 'Frozen local positions; fresh declared results automatically produce conserved, perpetual simulated awards.', defaults([source('result', 'Final result', 'string')], [rule('result', { op: 'in', source: 'result', value: [...outcomes, 'DRAW', 'VOID'] }, [{ type: 'settle_prediction' }])], { prediction: { outcomes, resultSource: 'result', positions: [{ actor: 'owner', outcome: outcomes[0], points: 10 }, { actor: 'reviewer', outcome: outcomes[1], points: 10 }] } }));
  }),
  template('custom', 'Custom conditional workflow', 'Compose typed evidence, nested logic, dependencies, timing and approved local effects.', defaults([source('condition', 'Custom condition')], [rule('custom_rule', condition('condition'), [{ type: 'record', label: 'Custom condition fulfilled' }])])),
]);

function typed(value, type, label) {
  if (typeof value !== type || (type === 'number' && !Number.isFinite(value)) || (type === 'string' && value.length > 500)) fail(`${label} requires ${type} evidence`);
  return value;
}
function normalizePredicate(node, sources, depth = 0) {
  if (depth > 8) fail('Conditions may nest at most eight levels');
  object(node, 'condition');
  if (node.op === 'all' || node.op === 'any') {
    object(node, 'compound condition', ['op', 'conditions']);
    return { op: node.op, conditions: array(node.conditions, 'conditions', 1, 16).map((entry) => normalizePredicate(entry, sources, depth + 1)) };
  }
  if (node.op === 'not') {
    object(node, 'not condition', ['op', 'condition']);
    return { op: 'not', condition: normalizePredicate(node.condition, sources, depth + 1) };
  }
  if (node.op === 'time') {
    object(node, 'time condition', ['op', 'at']);
    return { op: 'time', at: integer(node.at, 'condition time') };
  }
  object(node, 'condition', ['op', 'source', 'value']);
  if (!['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'exists'].includes(node.op)) fail('Unsupported condition operator');
  const declaration = sources.find((entry) => entry.id === node.source);
  if (!declaration) fail(`Unknown condition source ${node.source}`);
  if (['gt', 'gte', 'lt', 'lte'].includes(node.op) && declaration.type !== 'number') fail('Ordered comparisons require a numeric source');
  if (node.op === 'exists') return { op: node.op, source: node.source };
  const value = node.op === 'in'
    ? array(node.value, 'membership values', 1, 32).map((entry) => typed(entry, declaration.type, 'condition value'))
    : typed(node.value, declaration.type, 'condition value');
  return { op: node.op, source: node.source, value };
}
function normalizeAction(action, parties) {
  object(action, 'action');
  const label = action.label === undefined ? undefined : text(action.label, 'action label');
  if (action.type === 'record') {
    object(action, 'record action', ['type', 'label']);
    return { type: action.type, label: text(action.label, 'record label') };
  }
  if (['simulated_transfer', 'release_escrow'].includes(action.type)) {
    object(action, 'local transfer', ['type', 'from', 'to', 'amount', 'label']);
    if (!parties.includes(action.from) || !parties.includes(action.to) || action.from === action.to) fail('Local transfers require two distinct approved parties');
    return { type: action.type, from: action.from, to: action.to, amount: money(action.amount, 'transfer amount', 0.01), ...(label ? { label } : {}) };
  }
  if (['grant_access', 'revoke_access'].includes(action.type)) {
    object(action, 'access action', ['type', 'subject', 'resource', 'durationMs', 'label']);
    if (!parties.includes(action.subject)) fail('Access subject must be an approved party');
    const normalized = { type: action.type, subject: action.subject, resource: text(action.resource, 'resource'), ...(label ? { label } : {}) };
    if (action.durationMs !== undefined) {
      if (action.type !== 'grant_access') fail('Only grants can have a duration');
      normalized.durationMs = integer(action.durationMs, 'access duration', 1000, 315360000000);
    }
    return normalized;
  }
  if (action.type === 'settle_prediction') {
    object(action, 'prediction action', ['type']);
    return { type: 'settle_prediction' };
  }
  fail(`Unsupported action ${action.type}: only bounded local simulation actions are allowed`);
}
function normalizeTerms(input, parties) {
  object(input, 'terms', ['startsAt', 'expiresAt', 'sources', 'rules', 'limits', 'prediction']);
  const startsAt = input.startsAt == null ? null : integer(input.startsAt, 'start time');
  const expiresAt = input.expiresAt == null ? null : integer(input.expiresAt, 'expiry time');
  if (startsAt !== null && expiresAt !== null && expiresAt <= startsAt) fail('Expiry must follow start time');
  const sources = array(input.sources, 'sources', 0, 32).map((entry) => {
    object(entry, 'source', ['id', 'label', 'type', 'maxAgeMs', 'provider', 'binding']);
    if (!['boolean', 'number', 'string'].includes(entry.type)) fail('Unsupported source type');
    const provider = entry.provider ?? 'manual';
    if (!PROVIDERS.includes(provider)) fail('Unsupported source provider');
    let binding;
    if (entry.binding !== undefined) {
      object(entry.binding, 'source binding', ['adapter', 'eventId']);
      if (provider !== 'public' || entry.type !== 'string') fail('ESPN result bindings require a public string source');
      if (entry.binding.adapter !== 'espn-result') fail('Unsupported public source adapter');
      binding = { adapter: 'espn-result', eventId: text(entry.binding.eventId, 'bound event id', 160) };
    }
    return { id: text(entry.id, 'source id', 64), label: text(entry.label ?? entry.id, 'source label'), type: entry.type, maxAgeMs: integer(entry.maxAgeMs ?? 86400000, 'source maximum age', 1000, 31536000000), provider, ...(binding ? { binding } : {}) };
  });
  unique(sources.map((entry) => entry.id), 'source ids');
  object(input.limits, 'limits', ['maxTotalPoints', 'maxExecutions']);
  const limits = { maxTotalPoints: money(input.limits.maxTotalPoints, 'point limit'), maxExecutions: integer(input.limits.maxExecutions, 'execution limit', 1, 10000) };
  const rules = array(input.rules, 'rules', 1, 32).map((entry) => {
    object(entry, 'rule', ['id', 'label', 'when', 'actions', 'schedule', 'after']);
    const normalized = { id: text(entry.id, 'rule id', 64), label: text(entry.label ?? entry.id, 'rule label'), when: normalizePredicate(entry.when, sources), actions: array(entry.actions, 'actions', 1, 16).map((action) => normalizeAction(action, parties)) };
    if (entry.schedule !== undefined) {
      object(entry.schedule, 'schedule', ['everyMs', 'maxRuns']);
      normalized.schedule = { everyMs: integer(entry.schedule.everyMs, 'recurrence interval', 1000, 315360000000), maxRuns: integer(entry.schedule.maxRuns, 'maximum recurrence', 1, 1000) };
    }
    if (entry.after !== undefined) normalized.after = unique(array(entry.after, 'dependencies', 0, 31).map((id) => text(id, 'dependency id', 64)), 'dependency ids');
    return normalized;
  });
  unique(rules.map((entry) => entry.id), 'rule ids');
  for (let index = 0; index < rules.length; index += 1) {
    const prior = rules.slice(0, index).map((entry) => entry.id);
    if ((rules[index].after ?? []).some((id) => !prior.includes(id))) fail('Dependencies must refer to earlier rules (no cycles or forward dependencies)');
  }
  const totalRuns = rules.reduce((sum, entry) => sum + (entry.schedule?.maxRuns ?? 1), 0);
  if (totalRuns > limits.maxExecutions) fail('Scheduled executions exceed approved execution limit');
  const totalPoints = rules.reduce((sum, entry) => sum + entry.actions.reduce((subtotal, action) => subtotal + (['simulated_transfer', 'release_escrow'].includes(action.type) ? cents(action.amount) : 0), 0) * (entry.schedule?.maxRuns ?? 1), 0);
  let prediction;
  const predictionActions = rules.flatMap((entry) => entry.actions.filter((action) => action.type === 'settle_prediction').map(() => entry));
  if (input.prediction !== undefined) {
    object(input.prediction, 'prediction', ['outcomes', 'positions', 'resultSource']);
    const outcomes = unique(array(input.prediction.outcomes, 'outcomes', 2, 6).map((entry) => text(entry, 'outcome', 48).toUpperCase()), 'outcomes');
    if (outcomes.some((entry) => ['DRAW', 'VOID'].includes(entry))) fail('DRAW and VOID are reserved refund results');
    const resultSource = sources.find((entry) => entry.id === input.prediction.resultSource);
    if (resultSource?.type !== 'string') fail('Prediction result must use a declared string source');
    const positions = array(input.prediction.positions, 'positions', 1, 64).map((entry) => {
      object(entry, 'position', ['actor', 'outcome', 'points']);
      if (!parties.includes(entry.actor)) fail('Position actors must approve the contract');
      const outcome = text(entry.outcome, 'position outcome', 48).toUpperCase();
      if (!outcomes.includes(outcome)) fail('Position outcome is not in the approved outcome set');
      return { actor: entry.actor, outcome, points: money(entry.points, 'position points', 0.01) };
    });
    unique(positions.map((entry) => entry.actor), 'position actors');
    if (predictionActions.length !== 1 || predictionActions[0].schedule) fail('Predictions require exactly one non-recurring settlement action');
    prediction = { outcomes, positions, resultSource: resultSource.id };
  } else if (predictionActions.length) fail('Prediction settlement requires frozen prediction terms');
  const predictionPoints = prediction?.positions.reduce((sum, entry) => sum + cents(entry.points), 0) ?? 0;
  if (totalPoints + predictionPoints > cents(limits.maxTotalPoints)) fail('Planned effects exceed approved point limit');
  return { startsAt, expiresAt, sources, rules, limits, ...(prediction ? { prediction } : {}) };
}

function latestEvidence(record, sourceId, at) {
  const declaration = record.terms.sources.find((entry) => entry.id === sourceId);
  const candidates = record.evidence.filter((entry) => entry.source === sourceId && entry.observedAt <= at).sort((a, b) => b.observedAt - a.observedAt);
  const latest = candidates[0];
  if (!latest) return { known: false, reason: `Missing evidence: ${sourceId}` };
  if (at - latest.observedAt > declaration.maxAgeMs) return { known: false, reason: `Stale evidence: ${sourceId}` };
  if (candidates.some((entry) => entry.observedAt === latest.observedAt && entry.value !== latest.value)) return { known: false, reason: `Conflicting evidence: ${sourceId}` };
  return { known: true, value: latest.value, evidenceId: latest.id, reason: '' };
}
function evaluate(node, record, at) {
  if (node.op === 'time') return { state: at >= node.at ? 'true' : 'false', reason: at >= node.at ? '' : 'Waiting for scheduled time', evidenceIds: [] };
  if (node.op === 'all' || node.op === 'any') {
    const values = node.conditions.map((entry) => evaluate(entry, record, at));
    const definitive = node.op === 'all' ? 'false' : 'true';
    const state = values.some((entry) => entry.state === definitive) ? definitive : values.some((entry) => entry.state === 'unknown') ? 'unknown' : node.op === 'all' ? 'true' : 'false';
    return { state, reason: state === 'unknown' ? values.find((entry) => entry.state === 'unknown').reason : state === 'false' ? 'Condition not satisfied' : '', evidenceIds: uniqueIds(values.flatMap((entry) => entry.evidenceIds)) };
  }
  if (node.op === 'not') {
    const result = evaluate(node.condition, record, at);
    return { ...result, state: result.state === 'unknown' ? 'unknown' : result.state === 'true' ? 'false' : 'true' };
  }
  const observation = latestEvidence(record, node.source, at);
  if (!observation.known) return { state: 'unknown', reason: observation.reason, evidenceIds: [] };
  const a = observation.value, b = node.value;
  const matched = { eq: () => a === b, neq: () => a !== b, gt: () => a > b, gte: () => a >= b, lt: () => a < b, lte: () => a <= b, in: () => b.includes(a), exists: () => true }[node.op]();
  return { state: matched ? 'true' : 'false', reason: matched ? '' : `Condition not satisfied: ${node.source}`, evidenceIds: [observation.evidenceId] };
}
const uniqueIds = (values) => [...new Set(values)];
function effectsFor(record, entry, at) {
  return entry.actions.map((action) => {
    if (action.type === 'settle_prediction') {
      const terms = record.terms.prediction;
      const observation = latestEvidence(record, terms.resultSource, at);
      if (!observation.known) throw new Error(observation.reason);
      const result = observation.value.trim().toUpperCase();
      if (![...terms.outcomes, 'DRAW', 'VOID'].includes(result)) throw new Error('Result is outside the approved outcome set');
      const plan = planGrading({ eventId: record.id, outcomes: terms.outcomes, stakes: terms.positions.map((position) => ({ participant: position.actor, outcome: position.outcome, amount: position.points })) }, result);
      return { type: action.type, simulation: true, result, digest: plan.digest, poolCents: plan.poolCents, payoutKind: plan.payoutKind, payouts: plan.payouts, expiresAt: null, evidenceId: observation.evidenceId };
    }
    return { ...action, simulation: true, ...(['simulated_transfer', 'release_escrow'].includes(action.type) ? { amountCents: cents(action.amount), unit: 'simulated TUMBO points' } : {}), ...(action.type === 'grant_access' ? { expiresAt: action.durationMs ? at + action.durationMs : null } : {}) };
  });
}
function makeProjection(record, at) {
  const balances = Object.fromEntries(record.parties.map((party) => [party, 0]));
  const access = new Map();
  for (const receipt of record.receipts) for (const effect of receipt.effects) {
    if (['simulated_transfer', 'release_escrow'].includes(effect.type)) {
      balances[effect.from] -= effect.amountCents;
      balances[effect.to] += effect.amountCents;
    }
    if (effect.type === 'settle_prediction') {
      record.terms.prediction.positions.forEach((position) => { balances[position.actor] -= cents(position.points); });
      effect.payouts.forEach((payout) => { balances[payout.participant] += payout.amountCents; });
    }
    const key = JSON.stringify([effect.subject, effect.resource]);
    if (effect.type === 'grant_access') access.set(key, { subject: effect.subject, resource: effect.resource, expiresAt: effect.expiresAt, receiptId: receipt.id, active: effect.expiresAt === null || effect.expiresAt > at });
    if (effect.type === 'revoke_access') access.delete(key);
  }
  return { simulation: true, balanceDeltasCents: balances, access: [...access.values()] };
}

function emptyState() { return { schemaVersion: CONTRACT_AUTOMATION_VERSION, sequence: 0, contracts: [], events: [], savedAt: 0 }; }
function validateLifecycle(record) {
  let status = null, activatedAt = null;
  const approvals = [];
  const resolutions = new Map();
  let pausingActor = null;
  const receiptIds = [];
  const evidence = [];
  for (const event of record.history) {
    const participant = record.parties.includes(event.actor);
    if (event.type === 'created') {
      if (status !== null || event.actor !== record.creator || event.at !== record.createdAt || event.detail.termsDigest !== record.termsDigest || event.detail.templateId !== record.templateId) fail('Invalid creation trace');
      status = 'pending_approval';
    } else if (event.type === 'approved') {
      if (status !== 'pending_approval' || !participant || approvals.some((entry) => entry.actor === event.actor) || event.detail.termsDigest !== record.termsDigest) fail('Invalid approval lifecycle');
      approvals.push({ actor: event.actor, at: event.at, termsDigest: event.detail.termsDigest });
    } else if (event.type === 'activated') {
      if (status !== 'pending_approval' || approvals.length !== record.parties.length || event.actor !== 'automation' || activatedAt !== null) fail('Invalid activation lifecycle');
      status = 'active'; activatedAt = event.at;
    } else if (event.type === 'paused') {
      if (status !== 'active' || !participant) fail('Invalid pause lifecycle');
      status = 'paused'; pausingActor = event.actor;
    } else if (event.type === 'resumed') {
      if (status !== 'paused' || event.actor !== pausingActor) fail('Invalid resume lifecycle');
      status = 'active';
    } else if (event.type === 'disputed') {
      if (!['pending_approval', 'active', 'paused'].includes(status) || !participant) fail('Invalid dispute lifecycle');
      status = 'disputed'; resolutions.clear();
    } else if (event.type === 'dispute_resolved') {
      if (status !== 'disputed' || !['resume', 'cancel'].includes(event.detail.resolution)) fail('Invalid dispute resolution lifecycle');
      if (event.detail.unanimous === true) {
        if (event.actor !== 'automation' || record.parties.some((party) => resolutions.get(party) !== event.detail.resolution)) fail('Resolution was not unanimous');
        status = event.detail.resolution === 'cancel' ? 'cancelled' : approvals.length === record.parties.length ? 'active' : 'pending_approval';
      } else {
        if (!participant || event.detail.unanimous !== false) fail('Invalid resolution vote');
        resolutions.set(event.actor, event.detail.resolution);
      }
    } else if (event.type === 'cancelled') {
      if (TERMINAL.includes(status) || !participant) fail('Invalid cancellation lifecycle');
      status = 'cancelled';
    } else if (event.type === 'expired') {
      if (TERMINAL.includes(status) || event.actor !== 'automation' || record.terms.expiresAt === null || event.at < record.terms.expiresAt) fail('Invalid expiry lifecycle');
      status = 'expired';
    } else if (event.type === 'completed') {
      if (status !== 'active' || event.actor !== 'automation') fail('Invalid completion lifecycle');
      status = 'completed';
    } else if (event.type === 'executed') {
      if (status !== 'active' || event.actor !== 'automation') fail('Execution occurred while not active');
      receiptIds.push(event.detail.receiptId);
    } else if (event.type === 'observed') {
      if (TERMINAL.includes(status)) fail('Evidence arrived after terminal state');
      const normalized = validateObservation(event.detail.evidence, record, event.at);
      if (stable(normalized) !== stable(event.detail.evidence) || event.actor !== `source:${normalized.provider}`) fail('Invalid observation trace');
      evidence.push(normalized);
    } else if (event.type === 'access_expired') {
      if (event.actor !== 'automation') fail('Invalid access expiry authority');
      const receipt = record.receipts.find((entry) => entry.id === event.detail.receiptId);
      if (!receipt?.effects.some((effect) => effect.type === 'grant_access' && effect.resource === event.detail.resource && effect.subject === event.detail.subject && effect.expiresAt !== null && effect.expiresAt <= event.at)) fail('Access expiry has no timed grant');
    }
  }
  if (status !== record.status || activatedAt !== record.activatedAt || stable(approvals) !== stable(record.approvals) || stable(evidence) !== stable(record.evidence) || stable(receiptIds) !== stable(record.receipts.map((entry) => entry.id))) fail('Saved lifecycle differs from its event history');
}
function validateState(input) {
  checkJSON(input);
  object(input, 'saved state', ['schemaVersion', 'sequence', 'contracts', 'events', 'savedAt']);
  if (input.schemaVersion !== CONTRACT_AUTOMATION_VERSION) fail('Unsupported automation storage version');
  integer(input.sequence, 'saved sequence');
  integer(input.savedAt, 'saved time');
  array(input.events, 'events', 0, MAX_EVENTS);
  array(input.contracts, 'contracts', 0, MAX_CONTRACTS);
  unique(input.contracts.map((entry) => entry.id), 'contract ids');
  unique(input.events.map((entry) => entry.id), 'event ids');
  let previousEventNumber = 0, previousEventAt = 0;
  for (const event of input.events) {
    object(event, 'event', ['id', 'type', 'actor', 'at', 'contractId', 'detail']);
    if (!/^event:\d+$/.test(event.id) || Number(event.id.split(':')[1]) > input.sequence) fail('Invalid saved event id');
    if (!['created', 'approved', 'activated', 'observed', 'executed', 'completed', 'paused', 'resumed', 'cancelled', 'expired', 'disputed', 'dispute_resolved', 'access_expired', 'evaluation_changed'].includes(event.type)) fail('Unknown saved event type');
    text(event.actor, 'event actor'); integer(event.at, 'event time'); object(event.detail, 'event detail');
    const eventNumber = Number(event.id.split(':')[1]);
    if (eventNumber <= previousEventNumber || event.at < previousEventAt || event.at > input.savedAt) fail('Saved events have invalid chronology');
    previousEventNumber = eventNumber; previousEventAt = event.at;
    if (!input.contracts.some((record) => record.id === event.contractId)) fail('Orphaned saved event');
  }
  for (const record of input.contracts) {
    object(record, 'saved contract', ['id', 'templateId', 'title', 'creator', 'parties', 'terms', 'termsDigest', 'status', 'approvals', 'evidence', 'receipts', 'history', 'evaluation', 'createdAt', 'updatedAt', 'activatedAt', 'simulation', 'dispute', 'expiredAccess']);
    if (!/^contract:\d+$/.test(record.id) || Number(record.id.split(':')[1]) > input.sequence) fail('Invalid saved contract id');
    if (!templates.some((entry) => entry.id === record.templateId)) fail('Unknown saved template');
    text(record.title, 'saved title'); text(record.creator, 'creator');
    unique(array(record.parties, 'parties', 1, 16).map((entry) => text(entry, 'party', 80)), 'parties');
    if (!record.parties.includes(record.creator) || record.simulation !== true || !STATUSES.includes(record.status)) fail('Invalid saved contract authority or status');
    const normalized = normalizeTerms(record.terms, record.parties);
    if (stable(normalized) !== stable(record.terms) || digest(record.terms) !== record.termsDigest) fail('Saved terms are inconsistent');
    integer(record.createdAt, 'creation time'); integer(record.updatedAt, 'update time');
    if (record.updatedAt < record.createdAt || record.updatedAt > input.savedAt) fail('Invalid saved chronology');
    if (record.activatedAt !== null) integer(record.activatedAt, 'activation time', record.createdAt);
    unique(array(record.approvals, 'approvals', 0, 16).map((approval) => {
      object(approval, 'approval', ['actor', 'at', 'termsDigest']);
      if (!record.parties.includes(approval.actor) || approval.termsDigest !== record.termsDigest) fail('Invalid saved approval');
      integer(approval.at, 'approval time', record.createdAt); return approval.actor;
    }), 'approval actors');
    if (['active', 'paused', 'completed'].includes(record.status) && (record.approvals.length !== record.parties.length || record.activatedAt === null)) fail('Saved state executed without approval');
    array(record.history, 'history', 1, MAX_EVENTS);
    const ownEvents = input.events.filter((event) => event.contractId === record.id);
    if (stable(ownEvents) !== stable(record.history) || record.history[0].type !== 'created') fail('Saved history does not match event fabric');
    validateLifecycle(record);
    for (const approval of record.approvals) if (!record.history.some((entry) => entry.type === 'approved' && entry.actor === approval.actor && entry.at === approval.at && entry.detail.termsDigest === record.termsDigest)) fail('Approval is missing its trace');
    array(record.evidence, 'evidence', 0, 4000);
    unique(record.evidence.map((entry) => entry.id), 'evidence ids');
    for (const evidence of record.evidence) {
      validateObservation(evidence, record, Math.max(input.savedAt, evidence.observedAt));
      if (!record.history.some((entry) => entry.type === 'observed' && stable(entry.detail.evidence) === stable(evidence))) fail('Evidence is missing its trace');
    }
    array(record.receipts, 'receipts', 0, record.terms.limits.maxExecutions);
    unique(record.receipts.map((entry) => entry.id), 'receipt ids');
    const counts = new Map();
    let spent = 0;
    for (const receipt of record.receipts) {
      object(receipt, 'receipt', ['id', 'contractId', 'ruleId', 'run', 'at', 'scheduledAt', 'termsDigest', 'evidenceIds', 'effects', 'simulation']);
      const entry = record.terms.rules.find((candidate) => candidate.id === receipt.ruleId);
      const run = (counts.get(receipt.ruleId) ?? 0) + 1;
      if (!entry || receipt.run !== run || receipt.id !== `receipt:${record.id}:${entry.id}:${run}` || receipt.contractId !== record.id || receipt.simulation !== true || receipt.termsDigest !== record.termsDigest) fail('Invalid saved receipt');
      if (run > (entry.schedule?.maxRuns ?? 1)) fail('Saved receipt exceeds recurrence limit');
      integer(receipt.at, 'receipt time', record.activatedAt ?? MAX_TIME);
      const due = Math.max(record.terms.startsAt ?? 0, record.activatedAt ?? 0) + (entry.schedule?.everyMs ?? 0) * (run - 1);
      if (receipt.scheduledAt !== due || receipt.at < due || (record.terms.expiresAt !== null && receipt.at >= record.terms.expiresAt)) fail('Saved receipt is outside its execution window');
      const execution = record.history.find((event) => event.type === 'executed' && event.detail.receiptId === receipt.id);
      if (!execution || execution.at !== receipt.at) fail('Receipt is missing its trace');
      const prior = record.history.slice(0, record.history.indexOf(execution));
      // Arrival order matters when several observations share the same clock
      // millisecond. A later correction must not invalidate an earlier receipt.
      const observedIds = new Set(prior.filter((event) => event.type === 'observed').map((event) => event.detail.evidence.id));
      const historical = { ...record, evidence: record.evidence.filter((evidence) => observedIds.has(evidence.id)) };
      const evaluated = evaluate(entry.when, historical, receipt.at);
      if (evaluated.state !== 'true' || (entry.after ?? []).some((id) => (counts.get(id) ?? 0) < (record.terms.rules.find((item) => item.id === id).schedule?.maxRuns ?? 1))) fail('Saved receipt has no satisfied condition/dependency');
      if (stable(effectsFor(historical, entry, receipt.at)) !== stable(receipt.effects)) fail('Saved receipt effects differ from approved terms');
      const evidenceIds = uniqueIds([...evaluated.evidenceIds, ...receipt.effects.filter((effect) => effect.evidenceId).map((effect) => effect.evidenceId)]);
      if (stable(receipt.evidenceIds) !== stable(evidenceIds)) fail('Saved receipt evidence mismatch');
      if (record.parties.some((party) => !prior.some((event) => event.type === 'approved' && event.actor === party))) fail('Receipt precedes approval');
      const lastStatus = prior.filter((event) => ['activated', 'paused', 'resumed', 'disputed', 'dispute_resolved', 'cancelled', 'expired', 'completed'].includes(event.type)).at(-1);
      if (!lastStatus || !['activated', 'resumed', 'dispute_resolved'].includes(lastStatus.type) || (lastStatus.type === 'dispute_resolved' && lastStatus.detail.resolution !== 'resume')) fail('Receipt executes while blocked');
      spent += receipt.effects.reduce((sum, effect) => sum + (effect.amountCents ?? effect.poolCents ?? 0), 0);
      counts.set(entry.id, run);
    }
    if (spent > cents(record.terms.limits.maxTotalPoints)) fail('Saved effects exceed approval limits');
    if (record.status === 'completed' && record.terms.rules.some((entry) => (counts.get(entry.id) ?? 0) < (entry.schedule?.maxRuns ?? 1))) fail('Saved completed contract has unfinished rules');
    object(record.evaluation, 'evaluation', ['state', 'reason', 'rules']);
    if (!['unknown', 'waiting', 'ready'].includes(record.evaluation.state)) fail('Invalid saved evaluation');
    text(record.evaluation.reason, 'evaluation reason', 1000); array(record.evaluation.rules, 'rule evaluations', 0, 32);
    unique(array(record.expiredAccess, 'expired access', 0, 10000).map((entry) => text(entry, 'access expiry id', 256)), 'access expiry ids');
    if (record.dispute !== null) {
      object(record.dispute, 'dispute', ['actor', 'reason', 'at', 'resolutions']);
      if (!record.parties.includes(record.dispute.actor)) fail('Invalid dispute actor');
      text(record.dispute.reason, 'dispute reason', 500); integer(record.dispute.at, 'dispute time');
      unique(array(record.dispute.resolutions, 'resolutions', 0, 16).map((resolution) => {
        object(resolution, 'resolution', ['actor', 'resolution', 'reason', 'at']);
        if (!record.parties.includes(resolution.actor) || !['resume', 'cancel'].includes(resolution.resolution)) fail('Invalid saved dispute resolution');
        text(resolution.reason, 'resolution reason', 500); integer(resolution.at, 'resolution time'); return resolution.actor;
      }), 'resolution actors');
    }
  }
  return copy(input);
}
function validateObservation(input, record, at) {
  object(input, 'evidence', ['id', 'contractId', 'source', 'value', 'observedAt', 'provider', 'provenance']);
  const id = text(input.id, 'evidence id', 160);
  if (input.contractId !== record.id) fail('Evidence belongs to another contract');
  const declaration = record.terms.sources.find((entry) => entry.id === input.source);
  if (!declaration) fail('Evidence source is not declared in approved terms');
  const provider = input.provider ?? 'manual';
  if (provider !== declaration.provider) fail(`Evidence provider must be ${declaration.provider}`);
  let provenance;
  if (declaration.binding) {
    object(input.provenance, 'bound evidence provenance', ['adapter', 'eventId', 'url']);
    if (input.provenance.adapter !== declaration.binding.adapter || input.provenance.eventId !== declaration.binding.eventId) fail('Evidence provenance does not match the approved source binding');
    let url;
    try { url = new URL(text(input.provenance.url, 'provenance URL', 2000)); }
    catch { fail('Evidence provenance requires an HTTPS ESPN URL'); }
    if (url.protocol !== 'https:' || (url.hostname !== 'espn.com' && !url.hostname.endsWith('.espn.com')) || url.username || url.password || url.port) fail('Evidence provenance requires an HTTPS ESPN URL without credentials or custom ports');
    // Provenance is reproducible source context, never authentication, a signed
    // oracle, or a guarantee that an external report is true.
    provenance = { adapter: declaration.binding.adapter, eventId: declaration.binding.eventId, url: url.href };
  } else if (input.provenance !== undefined) fail('Unbound sources cannot claim bound adapter provenance');
  return { id, contractId: record.id, source: declaration.id, value: typed(input.value, declaration.type, 'Observation'), observedAt: integer(input.observedAt, 'observation time', 0, at), provider, ...(provenance ? { provenance } : {}) };
}

export function createContractAutomation({ now = () => Date.now(), storage = null, storageKey = CONTRACT_AUTOMATION_STORAGE_KEY, onEvent = null } = {}) {
  if (typeof now !== 'function') fail('now must be a clock function');
  const clock = () => {
    const value = now();
    return integer(value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value, 'clock time');
  };
  if (storage && (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function')) fail('storage must implement synchronous getItem/setItem');
  let state = emptyState();
  let storedRaw = null;
  let storageStatus = { mode: storage ? 'durable' : 'memory', status: 'ok', error: null };
  if (storage) {
    try {
      const raw = storage.getItem(storageKey);
      storedRaw = raw ?? null;
      if (raw !== null && raw !== undefined) {
        if (typeof raw !== 'string' || raw.length > MAX_BYTES) fail('Stored automation state exceeds limit');
        state = validateState(JSON.parse(raw));
      }
    } catch (error) { throw new Error(`Contract automation restore failed; saved data was not changed: ${error.message}`); }
  }
  const listeners = new Set();
  let writing = false;
  let notifying = false;
  const find = (draft, id) => { const record = draft.contracts.find((entry) => entry.id === id); if (!record) throw new Error(`Unknown contract ${id}`); return record; };
  const ensureActor = (record, actor) => { if (!record.parties.includes(actor)) throw new Error('Actor must be an approved-term party (local identity assertion only)'); };
  function event(draft, record, type, actor, detail, at) {
    if (draft.events.length >= MAX_EVENTS) throw new Error('Local audit capacity reached; export an archive before creating a new workspace');
    const entry = { id: `event:${++draft.sequence}`, type, actor, at, contractId: record.id, detail };
    draft.events.push(entry); record.history.push(entry); record.updatedAt = at;
  }
  function transaction(change) {
    if (writing || notifying) throw new Error('Reentrant contract mutation is not allowed');
    writing = true;
    let result, notifications = [];
    try {
      if (storage && (storage.getItem(storageKey) ?? null) !== storedRaw) {
        storageStatus = { mode: 'durable', status: 'error', error: 'Another tab changed this workspace. Reload to reconcile before continuing.' };
        throw new Error(`Automation held: ${storageStatus.error}`);
      }
      const draft = copy(state);
      const at = clock();
      if (at < state.savedAt) throw new Error('Clock moved backwards; automation is held until time catches up');
      result = change(draft, at);
      if (stable(draft) !== stable(state)) {
        draft.savedAt = at;
        const serialized = JSON.stringify(draft);
        if (serialized.length > MAX_BYTES) throw new Error('Local automation storage limit reached');
        if (storage) {
          try {
            // Optimistic stale-writer protection, not a cross-process lock. This
            // synchronous local engine never claims distributed exactly-once
            // execution; real external effects would require server authority.
            if ((storage.getItem(storageKey) ?? null) !== storedRaw) throw new Error('Another tab changed this workspace; reload before continuing');
            storage.setItem(storageKey, serialized); storedRaw = serialized;
            storageStatus = { mode: 'durable', status: 'ok', error: null };
          }
          catch (error) { storageStatus = { mode: 'durable', status: 'error', error: error.message }; throw new Error(`Automation held: persistence failed (${error.message})`); }
        }
        notifications = draft.events.slice(state.events.length);
        state = draft;
      }
    } finally { writing = false; }
    // Persist before external callbacks. Observers cannot undo or corrupt effects.
    notifying = true;
    try {
      for (const notification of notifications) {
        try { if (typeof onEvent === 'function') onEvent(publicCopy(notification)); } catch { /* Projection failure cannot roll back persisted domain state. */ }
      }
      if (notifications.length) for (const listener of listeners) {
        try { listener(snapshot()); } catch { /* An observer is not execution authority. */ }
      }
    } finally { notifying = false; }
    return result;
  }
  function run(draft, record, at) {
    const historyLength = record.history.length;
    const previous = stable(record.evaluation);
    runInternal(draft, record, at);
    // A time-only change (e.g. evidence becoming stale) must wake subscribers
    // and have a trace even when it produces no receipt. Unchanged ticks stay quiet.
    if (record.history.length === historyLength && stable(record.evaluation) !== previous) event(draft, record, 'evaluation_changed', 'automation', { state: record.evaluation.state, reason: record.evaluation.reason }, at);
  }
  function runInternal(draft, record, at) {
    // Expiring previously granted local access is projection bookkeeping, even
    // after completion. It does not retract immutable receipts or mutate terms.
    for (const receipt of record.receipts) for (let index = 0; index < receipt.effects.length; index += 1) {
      const effect = receipt.effects[index];
      const key = `${receipt.id}:${index}`;
      if (effect.type === 'grant_access' && effect.expiresAt !== null && effect.expiresAt <= at && !record.expiredAccess.includes(key)) {
        record.expiredAccess.push(key); event(draft, record, 'access_expired', 'automation', { receiptId: receipt.id, subject: effect.subject, resource: effect.resource }, at);
      }
    }
    if (TERMINAL.includes(record.status)) return;
    if (record.terms.expiresAt !== null && at >= record.terms.expiresAt) {
      record.status = 'expired'; record.evaluation = { state: 'waiting', reason: 'Approved execution window expired; previous receipts remain intact', rules: [] };
      event(draft, record, 'expired', 'automation', {}, at); return;
    }
    if (record.status !== 'active') return;
    if (at < (record.terms.startsAt ?? 0)) {
      record.evaluation = { state: 'waiting', reason: 'Waiting for approved start time', rules: [] }; return;
    }
    const evaluations = [];
    for (const entry of record.terms.rules) {
      let receipts = record.receipts.filter((receipt) => receipt.ruleId === entry.id);
      const maxRuns = entry.schedule?.maxRuns ?? 1;
      if (receipts.length >= maxRuns) { evaluations.push({ id: entry.id, state: 'done', reason: 'Approved executions completed' }); continue; }
      if ((entry.after ?? []).some((id) => record.receipts.filter((receipt) => receipt.ruleId === id).length < (record.terms.rules.find((prior) => prior.id === id).schedule?.maxRuns ?? 1))) {
        evaluations.push({ id: entry.id, state: 'waiting', reason: 'Waiting for prior milestone' }); continue;
      }
      let executionsThisTick = 0;
      while (receipts.length < maxRuns && executionsThisTick < 32) {
        const scheduledAt = Math.max(record.terms.startsAt ?? 0, record.activatedAt) + (entry.schedule?.everyMs ?? 0) * receipts.length;
        if (at < scheduledAt) { evaluations.push({ id: entry.id, state: 'waiting', reason: 'Waiting for next scheduled cycle', nextAt: scheduledAt }); break; }
        // Evaluate at actual execution time, not backdated time: stale evidence
        // cannot authorize a burst of overdue work after an offline period.
        const result = evaluate(entry.when, record, at);
        if (result.state !== 'true') { evaluations.push({ id: entry.id, state: result.state === 'unknown' ? 'unknown' : 'waiting', reason: result.reason }); break; }
        let effects;
        try { effects = effectsFor(record, entry, at); }
        catch (error) { evaluations.push({ id: entry.id, state: 'unknown', reason: error.message }); break; }
        const spent = record.receipts.flatMap((receipt) => receipt.effects).reduce((sum, effect) => sum + (effect.amountCents ?? effect.poolCents ?? 0), 0);
        const cost = effects.reduce((sum, effect) => sum + (effect.amountCents ?? effect.poolCents ?? 0), 0);
        if (record.receipts.length >= record.terms.limits.maxExecutions || spent + cost > cents(record.terms.limits.maxTotalPoints)) {
          evaluations.push({ id: entry.id, state: 'waiting', reason: 'Approved execution limit reached' }); break;
        }
        const runNumber = receipts.length + 1;
        const evidenceIds = uniqueIds([...result.evidenceIds, ...effects.filter((effect) => effect.evidenceId).map((effect) => effect.evidenceId)]);
        const receipt = { id: `receipt:${record.id}:${entry.id}:${runNumber}`, contractId: record.id, ruleId: entry.id, run: runNumber, at, scheduledAt, termsDigest: record.termsDigest, evidenceIds, effects, simulation: true };
        record.receipts.push(receipt); receipts.push(receipt); executionsThisTick += 1;
        event(draft, record, 'executed', 'automation', { receiptId: receipt.id, ruleId: entry.id, run: runNumber }, at);
      }
      if (receipts.length >= maxRuns) evaluations.push({ id: entry.id, state: 'done', reason: 'Approved executions completed' });
      else if (executionsThisTick === 32) evaluations.push({ id: entry.id, state: 'waiting', reason: 'Bounded catch-up continues on the next tick' });
    }
    const allDone = record.terms.rules.every((entry) => record.receipts.filter((receipt) => receipt.ruleId === entry.id).length >= (entry.schedule?.maxRuns ?? 1));
    record.evaluation = { state: allDone ? 'ready' : evaluations.some((entry) => entry.state === 'unknown') ? 'unknown' : 'waiting', reason: allDone ? 'All approved local effects completed' : evaluations.find((entry) => entry.state === 'unknown')?.reason ?? evaluations.find((entry) => entry.state === 'waiting')?.reason ?? 'Waiting for evidence', rules: evaluations };
    if (allDone) { record.status = 'completed'; event(draft, record, 'completed', 'automation', {}, at); }
  }
  function view(record) { return publicCopy({ ...record, projection: makeProjection(record, clock()) }); }
  function snapshot() { return publicCopy({ ...state, contracts: state.contracts.map((record) => ({ ...record, projection: makeProjection(record, clock()) })), persistence: storageStatus, boundary: CONTRACT_AUTOMATION_BOUNDARY }); }
  function mutation(id, callback) { transaction((draft, at) => callback(draft, find(draft, id), at)); return api.get(id); }
  const api = {
    listTemplates: () => publicCopy(templates),
    create(input) {
      checkJSON(input); object(input, 'contract', ['templateId', 'title', 'creator', 'parties', 'terms']);
      const chosen = templates.find((entry) => entry.id === input.templateId);
      if (!chosen) fail('Unknown contract template');
      const creator = text(input.creator ?? 'owner', 'creator', 80);
      const parties = unique(array(input.parties ?? [creator, creator === 'reviewer' ? 'owner' : 'reviewer'], 'parties', 1, 16).map((entry) => text(entry, 'party', 80)), 'parties');
      if (!parties.includes(creator)) fail('Creator must be a required approving party');
      const adaptedDefaults = copy(chosen.defaults);
      const aliases = { owner: creator, reviewer: parties.find((entry) => entry !== creator) ?? creator };
      adaptedDefaults.rules.forEach((entry) => entry.actions.forEach((action) => { for (const key of ['from', 'to', 'subject']) if (Object.hasOwn(aliases, action[key])) action[key] = aliases[action[key]]; }));
      adaptedDefaults.prediction?.positions.forEach((position) => { position.actor = aliases[position.actor]; });
      const terms = normalizeTerms({ ...adaptedDefaults, ...(input.terms ?? {}) }, parties);
      const title = text(input.title ?? chosen.label, 'contract title');
      let id;
      transaction((draft, at) => {
        if (draft.contracts.length >= MAX_CONTRACTS) throw new Error('Local contract capacity reached');
        if (terms.expiresAt !== null && terms.expiresAt <= at) fail('A new contract cannot already be expired');
        id = `contract:${++draft.sequence}`;
        const record = { id, templateId: chosen.id, title, creator, parties, terms, termsDigest: digest(terms), status: 'pending_approval', approvals: [], evidence: [], receipts: [], history: [], evaluation: { state: 'waiting', reason: 'All named parties must approve the same frozen terms', rules: [] }, createdAt: at, updatedAt: at, activatedAt: null, simulation: true, dispute: null, expiredAccess: [] };
        draft.contracts.push(record); event(draft, record, 'created', creator, { templateId: chosen.id, termsDigest: record.termsDigest }, at);
      });
      return api.get(id);
    },
    approve(id, { actor } = {}) {
      return mutation(id, (draft, record, at) => {
        ensureActor(record, actor); run(draft, record, at);
        if (record.approvals.some((entry) => entry.actor === actor)) return;
        if (record.status !== 'pending_approval') throw new Error('Only pending contracts can receive approval');
        record.approvals.push({ actor, at, termsDigest: record.termsDigest }); event(draft, record, 'approved', actor, { termsDigest: record.termsDigest }, at);
        if (record.approvals.length === record.parties.length) {
          record.status = 'active'; record.activatedAt = at; event(draft, record, 'activated', 'automation', {}, at); run(draft, record, at);
        }
      });
    },
    observe(input) {
      checkJSON(input);
      return mutation(input.contractId, (draft, record, at) => {
        const observation = validateObservation(input, record, at);
        const existing = record.evidence.find((entry) => entry.id === observation.id);
        if (existing) { if (stable(existing) !== stable(observation)) throw new Error('Evidence id already exists with different content'); return; }
        if (TERMINAL.includes(record.status)) throw new Error('Terminal contracts cannot accept new execution evidence');
        if (record.evidence.length >= 4000) throw new Error('Contract evidence capacity reached');
        record.evidence.push(observation); event(draft, record, 'observed', `source:${observation.provider}`, { evidence: observation }, at); run(draft, record, at);
      });
    },
    tick() { transaction((draft, at) => { draft.contracts.forEach((record) => run(draft, record, at)); }); return snapshot(); },
    pause(id, { actor } = {}) {
      return mutation(id, (draft, record, at) => {
        ensureActor(record, actor);
        if (record.status === 'paused') return;
        if (record.status !== 'active') throw new Error('Only active contracts can pause');
        record.status = 'paused'; record.evaluation = { state: 'waiting', reason: `Paused by ${actor}`, rules: [] }; event(draft, record, 'paused', actor, {}, at);
      });
    },
    resume(id, { actor } = {}) {
      return mutation(id, (draft, record, at) => {
        ensureActor(record, actor);
        if (record.status !== 'paused') throw new Error('Only paused contracts can resume');
        const pausedBy = record.history.filter((entry) => entry.type === 'paused').at(-1)?.actor;
        if (actor !== pausedBy) throw new Error('Only the party who paused can resume; use dispute resolution for disagreement');
        record.status = 'active'; event(draft, record, 'resumed', actor, {}, at); run(draft, record, at);
      });
    },
    cancel(id, { actor } = {}) {
      return mutation(id, (draft, record, at) => {
        ensureActor(record, actor);
        if (record.status === 'cancelled') return;
        if (TERMINAL.includes(record.status)) throw new Error('Terminal contracts cannot be cancelled or reverse receipts');
        record.status = 'cancelled'; record.evaluation = { state: 'waiting', reason: 'Cancelled; previous receipts remain intact', rules: [] }; event(draft, record, 'cancelled', actor, {}, at);
      });
    },
    dispute(id, { actor, reason } = {}) {
      return mutation(id, (draft, record, at) => {
        ensureActor(record, actor);
        if (TERMINAL.includes(record.status) || record.status === 'disputed') throw new Error('Contract cannot enter dispute in its current state');
        record.dispute = { actor, reason: text(reason, 'dispute reason', 500), at, resolutions: [] }; record.status = 'disputed';
        record.evaluation = { state: 'waiting', reason: 'Disputed; every party must agree on the same resolution', rules: [] }; event(draft, record, 'disputed', actor, { reason: record.dispute.reason }, at);
      });
    },
    resolveDispute(id, { actor, resolution, reason = 'Local resolution agreement' } = {}) {
      return mutation(id, (draft, record, at) => {
        ensureActor(record, actor);
        if (record.status !== 'disputed' || !['resume', 'cancel'].includes(resolution)) throw new Error('A disputed contract requires resume or cancel resolution');
        const vote = { actor, resolution, reason: text(reason, 'resolution reason', 500), at };
        const previous = record.dispute.resolutions.findIndex((entry) => entry.actor === actor);
        if (previous >= 0) record.dispute.resolutions[previous] = vote; else record.dispute.resolutions.push(vote);
        event(draft, record, 'dispute_resolved', actor, { resolution, reason: vote.reason, unanimous: false }, at);
        if (record.parties.every((party) => record.dispute.resolutions.some((entry) => entry.actor === party && entry.resolution === resolution))) {
          record.status = resolution === 'cancel' ? 'cancelled' : record.approvals.length === record.parties.length ? 'active' : 'pending_approval';
          event(draft, record, 'dispute_resolved', 'automation', { resolution, unanimous: true }, at);
          record.evaluation = { state: 'waiting', reason: `Dispute resolved: ${resolution}`, rules: [] }; run(draft, record, at);
        }
      });
    },
    get(id) { const record = state.contracts.find((entry) => entry.id === id); return record ? view(record) : null; },
    list: () => state.contracts.map(view),
    snapshot,
    subscribe(listener) { if (typeof listener !== 'function') fail('Subscriber must be a function'); listeners.add(listener); return () => listeners.delete(listener); },
    exportState: () => JSON.stringify(state),
    importState(serialized) {
      if (state.contracts.length || state.events.length) throw new Error('Import requires an empty workspace; existing history cannot be overwritten');
      if (typeof serialized !== 'string' || serialized.length > MAX_BYTES) fail('Import must be a bounded JSON string');
      const restored = validateState(JSON.parse(serialized));
      if (restored.savedAt > clock()) fail('Cannot import a workspace saved in the future');
      transaction((draft) => { Object.assign(draft, restored); });
      return snapshot();
    },
  };
  return Object.freeze(api);
}

export default createContractAutomation;
