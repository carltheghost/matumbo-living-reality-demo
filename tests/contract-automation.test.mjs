import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContractAutomation, CONTRACT_AUTOMATION_STORAGE_KEY } from '../src/domains/contract-automation.js';

const BASE = Date.parse('2026-09-24T12:00:00Z');
function harness(options = {}) {
  let at = BASE, evidenceCounter = 0;
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const events = [];
  const engine = createContractAutomation({ now: () => at, storage, onEvent: (entry) => events.push(entry), ...options });
  return { engine, storage, data, events, now: () => at, advance: (ms = 1) => { at += ms; }, setTime: (value) => { at = value; }, observe: (record, source, value, extra = {}) => engine.observe({ id: `evidence-${++evidenceCounter}`, contractId: record.id, source, value, observedAt: at, ...extra }) };
}
function approved(h, input) {
  const record = h.engine.create(typeof input === 'string' ? { templateId: input } : input);
  for (const actor of record.parties) h.engine.approve(record.id, { actor });
  return h.engine.get(record.id);
}
function satisfy(h, record) {
  for (const declaration of record.terms.sources) {
    h.advance();
    const value = declaration.type === 'boolean' ? true : declaration.type === 'number' ? 2 : record.terms.prediction?.outcomes[0] ?? 'yes';
    h.observe(record, declaration.id, value, { provider: declaration.provider });
  }
  h.advance(60000 * 3); h.engine.tick();
  return h.engine.get(record.id);
}

test('all 15 advertised templates create -> required approvals -> evidence/time -> automatic local receipts', () => {
  const catalog = harness().engine.listTemplates();
  assert.equal(catalog.length, 15);
  for (const template of catalog) {
    const h = harness();
    const record = approved(h, template.id);
    assert.equal(record.status, 'active', template.id);
    const result = satisfy(h, record);
    assert.equal(result.status, 'completed', template.id);
    assert.ok(result.receipts.length > 0, template.id);
    assert.ok(result.receipts.every((receipt) => receipt.simulation));
    assert.equal(result.history.at(-1).type, 'completed', template.id);
    assert.ok(result.receipts.flatMap((receipt) => receipt.effects).every((effect) => effect.simulation));
    const restored = createContractAutomation({ now: h.now, storage: h.storage });
    assert.deepEqual(restored.get(record.id), result, `${template.id} must restore exactly`);
    restored.tick();
    assert.equal(restored.get(record.id).receipts.length, result.receipts.length);
  }
});

test('frozen all-party terms, approvals and evidence cannot be mutated through public snapshots', () => {
  const h = harness();
  const input = { templateId: 'service', creator: 'alice', parties: ['alice', 'bob'] };
  const record = h.engine.create(input);
  assert.deepEqual(record.terms.rules[0].actions[0], { type: 'simulated_transfer', from: 'alice', to: 'bob', amount: 100 });
  input.parties.push('mallory');
  h.observe(record, 'accepted', true);
  assert.equal(h.engine.get(record.id).receipts.length, 0);
  h.engine.approve(record.id, { actor: 'alice' });
  assert.equal(h.engine.get(record.id).receipts.length, 0);
  assert.throws(() => h.engine.approve(record.id, { actor: 'mallory' }), /Actor/);
  assert.throws(() => { record.terms.rules[0].actions[0].amount = 1000000; }, TypeError);
  h.engine.approve(record.id, { actor: 'bob' });
  const result = h.engine.get(record.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.receipts.length, 1);
  assert.deepEqual(result.projection.balanceDeltasCents, { alice: -10000, bob: 10000 });
  h.engine.approve(record.id, { actor: 'bob' });
  assert.equal(h.engine.get(record.id).receipts.length, 1);
  assert.equal(h.engine.listTemplates()[0].defaults.rules[0].actions[0].from, 'owner');
});

test('missing, stale, conflicting and future evidence fail closed; UNKNOWN survives NOT', () => {
  const h = harness();
  const record = approved(h, { templateId: 'custom', terms: { sources: [{ id: 'condition', type: 'boolean', maxAgeMs: 1000 }], rules: [{ id: 'not', when: { op: 'not', condition: { op: 'eq', source: 'condition', value: false } }, actions: [{ type: 'record', label: 'Accepted' }] }] } });
  assert.equal(record.evaluation.state, 'unknown');
  assert.throws(() => h.observe(record, 'condition', true, { observedAt: h.now() + 1 }), /observation time/);
  h.advance(1001);
  h.observe(record, 'condition', true, { observedAt: BASE });
  assert.match(h.engine.get(record.id).evaluation.reason, /Stale/);
  h.engine.pause(record.id, { actor: 'owner' });
  h.observe(record, 'condition', false);
  h.observe(record, 'condition', true);
  h.engine.resume(record.id, { actor: 'owner' });
  assert.match(h.engine.get(record.id).evaluation.reason, /Conflicting/);
  assert.equal(h.engine.get(record.id).receipts.length, 0);
  h.advance(); h.observe(record, 'condition', true);
  assert.equal(h.engine.get(record.id).status, 'completed');
});

test('typed provenance and ids reject incompatible or cross-contract evidence', () => {
  const h = harness();
  const record = approved(h, { templateId: 'custom', terms: { sources: [{ id: 'condition', type: 'boolean', provider: 'public', maxAgeMs: 10000 }] } });
  assert.throws(() => h.observe(record, 'condition', 'true', { provider: 'public' }), /boolean/);
  assert.throws(() => h.observe(record, 'condition', true), /provider/);
  assert.throws(() => h.observe(record, 'undeclared', true, { provider: 'public' }), /not declared/);
  const observation = { id: 'provider:1', contractId: record.id, source: 'condition', value: false, observedAt: h.now(), provider: 'public' };
  h.engine.observe(observation); h.engine.observe(observation);
  assert.equal(h.engine.get(record.id).evidence.length, 1);
  assert.throws(() => h.engine.observe({ ...observation, value: true }), /different content/);
  assert.throws(() => h.engine.observe({ ...observation, contractId: 'missing' }), /Unknown contract/);
});

test('pause, unanimous dispute resolution, cancellation and expiry hold execution', () => {
  const h = harness();
  const record = approved(h, 'service');
  h.engine.pause(record.id, { actor: 'reviewer' });
  h.observe(record, 'accepted', true); h.engine.tick();
  assert.equal(h.engine.get(record.id).receipts.length, 0);
  assert.throws(() => h.engine.resume(record.id, { actor: 'owner' }), /party who paused/);
  h.engine.dispute(record.id, { actor: 'owner', reason: 'Delivery needs correction' });
  h.engine.resolveDispute(record.id, { actor: 'owner', resolution: 'resume' });
  assert.equal(h.engine.get(record.id).status, 'disputed');
  h.engine.resolveDispute(record.id, { actor: 'reviewer', resolution: 'cancel' });
  assert.equal(h.engine.get(record.id).status, 'disputed');
  h.engine.resolveDispute(record.id, { actor: 'reviewer', resolution: 'resume' });
  assert.equal(h.engine.get(record.id).status, 'completed');
  const cancelled = approved(h, 'service');
  h.engine.cancel(cancelled.id, { actor: 'reviewer' });
  assert.throws(() => h.observe(cancelled, 'accepted', true), /Terminal/);
  assert.throws(() => h.engine.cancel(record.id, { actor: 'owner' }), /Terminal/);
  const expiring = approved(h, { templateId: 'service', terms: { expiresAt: h.now() + 1000 } });
  h.advance(1000); h.engine.tick();
  assert.equal(h.engine.get(expiring.id).status, 'expired');
  assert.equal(h.engine.get(expiring.id).receipts.length, 0);
});

test('a preapproval dispute can resume to review, never to unauthorized execution', () => {
  const h = harness();
  const record = h.engine.create({ templateId: 'service' });
  h.observe(record, 'accepted', true);
  h.engine.dispute(record.id, { actor: 'owner', reason: 'Check terms' });
  h.engine.resolveDispute(record.id, { actor: 'owner', resolution: 'resume' });
  h.engine.resolveDispute(record.id, { actor: 'reviewer', resolution: 'resume' });
  assert.equal(h.engine.get(record.id).status, 'pending_approval');
  for (const actor of record.parties) h.engine.approve(record.id, { actor });
  assert.equal(h.engine.get(record.id).status, 'completed');
});

test('ordered milestones wait for earlier receipt and process automatically on evidence arrival', () => {
  const h = harness(), record = approved(h, 'milestone');
  h.observe(record, 'delivery', true);
  assert.equal(h.engine.get(record.id).receipts.length, 0);
  h.observe(record, 'design', true);
  const result = h.engine.get(record.id);
  assert.deepEqual(result.receipts.map((receipt) => receipt.ruleId), ['design', 'delivery']);
  assert.equal(result.projection.balanceDeltasCents.owner, -10000);
});

test('recurrence is bounded, stale offline evidence blocks catchup and reload cannot repeat receipts', () => {
  const h = harness();
  const record = approved(h, { templateId: 'subscription', terms: { sources: [{ id: 'enabled', type: 'boolean', maxAgeMs: 1000 }] } });
  h.observe(record, 'enabled', true);
  assert.equal(h.engine.get(record.id).receipts.length, 1);
  h.advance(120000); h.engine.tick();
  assert.equal(h.engine.get(record.id).receipts.length, 1);
  assert.match(h.engine.get(record.id).evaluation.reason, /Stale/);
  h.observe(record, 'enabled', true);
  assert.equal(h.engine.get(record.id).receipts.length, 3);
  const restored = createContractAutomation({ now: h.now, storage: h.storage });
  restored.tick(); restored.tick();
  assert.equal(restored.get(record.id).receipts.length, 3);
  assert.equal(restored.get(record.id).projection.balanceDeltasCents.owner, -3000);
});

test('clock-only custom predicates, start times and access expiry use actual time with trace', () => {
  const h = harness();
  const record = approved(h, { templateId: 'custom', terms: { startsAt: BASE + 1000, sources: [], rules: [{ id: 'timed', when: { op: 'time', at: BASE + 1500 }, actions: [{ type: 'grant_access', subject: 'reviewer', resource: 'room', durationMs: 1000 }] }] } });
  h.advance(1000); h.engine.tick(); assert.equal(h.engine.get(record.id).receipts.length, 0);
  h.advance(500); h.engine.tick(); assert.equal(h.engine.get(record.id).status, 'completed');
  assert.equal(h.engine.get(record.id).projection.access[0].active, true);
  h.advance(1000); h.engine.tick();
  assert.equal(h.engine.get(record.id).projection.access[0].active, false);
  assert.equal(h.engine.get(record.id).history.at(-1).type, 'access_expired');
  h.engine.tick();
  assert.equal(h.engine.get(record.id).history.filter((event) => event.type === 'access_expired').length, 1);
});

test('compound conditions implement three-valued ALL/ANY/NOT without evaluating strings as code', () => {
  const h = harness();
  const record = approved(h, { templateId: 'custom', terms: { sources: [{ id: 'a', type: 'boolean' }, { id: 'b', type: 'number' }, { id: 'c', type: 'string' }], rules: [{ id: 'compound', when: { op: 'all', conditions: [{ op: 'eq', source: 'a', value: true }, { op: 'any', conditions: [{ op: 'gte', source: 'b', value: 3 }, { op: 'in', source: 'c', value: ['allowed', 'approved'] }] }] }, actions: [{ type: 'record', label: '<script>not executable</script>' }] }] } });
  h.observe(record, 'a', true); h.observe(record, 'b', 2);
  assert.equal(h.engine.get(record.id).evaluation.state, 'unknown');
  h.observe(record, 'c', 'allowed');
  assert.equal(h.engine.get(record.id).status, 'completed');
});

test('prediction engine reuses canonical grading with cent conservation, refunds and permanent simulated awards', () => {
  for (const result of ['YES', 'NO', 'DRAW', 'VOID']) {
    const h = harness();
    const record = approved(h, { templateId: 'prediction_pool', parties: ['owner', 'reviewer', 'third'], terms: { prediction: { outcomes: ['YES', 'NO'], resultSource: 'result', positions: [{ actor: 'owner', outcome: 'YES', points: 0.03 }, { actor: 'reviewer', outcome: 'YES', points: 0.02 }, { actor: 'third', outcome: 'NO', points: 0.02 }] } } });
    h.observe(record, 'result', result);
    const settled = h.engine.get(record.id), effect = settled.receipts[0].effects[0];
    assert.equal(effect.poolCents, 7);
    assert.equal(effect.payouts.reduce((sum, payout) => sum + payout.amountCents, 0), 7);
    assert.equal(effect.expiresAt, null);
    assert.equal(Object.values(settled.projection.balanceDeltasCents).reduce((sum, points) => sum + points, 0), 0);
    assert.equal(effect.payoutKind, ['DRAW', 'VOID'].includes(result) ? 'refund' : 'award');
    assert.throws(() => h.observe(record, 'result', 'NO'), /Terminal/);
  }
});

test('schema denies unsafe actions, malformed terms, limits, cycles and unapproved stake holders', () => {
  const h = harness();
  const invalid = [
    { rules: [{ id: 'bad', when: { op: 'time', at: BASE }, actions: [{ type: 'fetch', url: 'https://example.com' }] }] },
    { limits: { maxTotalPoints: 1, maxExecutions: 100 } },
    { rules: [{ id: 'loop', when: { op: 'time', at: BASE }, actions: [{ type: 'record', label: 'Loop' }], after: ['loop'] }] },
    { sources: [{ id: 'accepted', type: 'boolean', provider: 'verified-bank' }] },
    { expiresAt: BASE },
    { wallet: 'forbidden' },
    { rules: [{ id: 'unknown', when: { op: 'eq', source: 'absent', value: true }, actions: [{ type: 'record', label: 'Invalid' }] }] },
    { rules: [{ id: 'infinite', when: { op: 'time', at: BASE }, actions: [{ type: 'record', label: 'Invalid' }], schedule: { everyMs: 1, maxRuns: Infinity } }] },
  ];
  for (const terms of invalid) assert.throws(() => h.engine.create({ templateId: 'service', terms }), TypeError);
  assert.throws(() => h.engine.create({ templateId: 'service', parties: ['owner', 'owner'] }), /unique/);
  assert.throws(() => h.engine.create({ templateId: 'service', creator: 'outside', parties: ['owner', 'reviewer'] }), /Creator/);
  assert.throws(() => h.engine.create({ templateId: 'custom', terms: JSON.parse('{"__proto__":{"polluted":true}}') }), /Unsafe/);
  assert.throws(() => h.engine.create({ templateId: 'prediction_binary', terms: { prediction: { outcomes: ['YES', 'NO'], resultSource: 'result', positions: [{ actor: 'outsider', outcome: 'YES', points: 1 }] } } }), /actors must approve/);
  assert.equal(h.engine.list().length, 0);
});

test('storage failure does not commit effects or deliver events and can safely retry', () => {
  const h = harness();
  const record = approved(h, 'service');
  let notified = 0; h.engine.subscribe(() => { notified += 1; });
  const previous = h.engine.exportState(), previousEvents = h.events.length;
  const writer = h.storage.setItem;
  h.storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => h.observe(record, 'accepted', true), /persistence failed/);
  assert.equal(h.engine.exportState(), previous);
  assert.equal(h.events.length, previousEvents); assert.equal(notified, 0);
  assert.equal(h.engine.snapshot().persistence.status, 'error');
  h.storage.setItem = writer;
  h.observe(record, 'accepted', true);
  assert.equal(h.engine.get(record.id).receipts.length, 1);
  assert.equal(h.engine.snapshot().persistence.status, 'ok');
  assert.equal(notified, 1);
});

test('observer exceptions cannot roll back persisted execution; unsubscribe works', () => {
  const h = harness({ onEvent: () => { throw new Error('projection error'); } });
  let changes = 0;
  const dispose = h.engine.subscribe(() => { changes += 1; throw new Error('view error'); });
  const record = approved(h, 'service');
  h.observe(record, 'accepted', true);
  assert.equal(h.engine.get(record.id).status, 'completed');
  assert.equal(changes, 4);
  dispose(); h.engine.create({ templateId: 'custom' }); assert.equal(changes, 4);
});

test('corrupt/version-skewed and semantically forged persistence fail closed without overwriting data', () => {
  const h = harness(), record = approved(h, 'service');
  h.observe(record, 'accepted', true);
  const pristine = h.engine.exportState();
  const mutations = [
    (state) => { state.schemaVersion = 999; },
    (state) => { state.contracts[0].terms.rules[0].actions[0].amount = 999; },
    (state) => { state.contracts[0].approvals = []; },
    (state) => { state.contracts[0].receipts[0].effects[0].amountCents = 999999; },
    (state) => { state.contracts[0].receipts.push(state.contracts[0].receipts[0]); },
    (state) => { state.events = []; },
    (state) => { state.contracts[0].status = 'unknown'; },
    (state) => { state.contracts[0].status = 'active'; },
    (state) => { state.contracts[0].activatedAt = BASE - 1; },
    (state) => { state.contracts[0].receipts[0].at = BASE - 1; },
  ];
  for (const mutate of mutations) {
    const state = JSON.parse(pristine); mutate(state); const serialized = JSON.stringify(state);
    h.data.set(CONTRACT_AUTOMATION_STORAGE_KEY, serialized);
    assert.throws(() => createContractAutomation({ now: h.now, storage: h.storage }), /restore failed/);
    assert.equal(h.data.get(CONTRACT_AUTOMATION_STORAGE_KEY), serialized);
  }
  h.data.set(CONTRACT_AUTOMATION_STORAGE_KEY, '{not json');
  assert.throws(() => createContractAutomation({ now: h.now, storage: h.storage }), /restore failed/);
});

test('validated export/import only into empty workspace and clock rollback holds effects', () => {
  const h = harness(), record = approved(h, 'service');
  const restored = createContractAutomation({ now: h.now });
  restored.importState(h.engine.exportState());
  assert.deepEqual(restored.get(record.id), h.engine.get(record.id));
  assert.throws(() => restored.importState(h.engine.exportState()), /empty workspace/);
  h.setTime(BASE - 1);
  assert.throws(() => h.engine.tick(), /Clock moved backwards/);
  assert.equal(h.engine.get(record.id).receipts.length, 0);
});

test('two loaded engines refuse stale writes, preserving the other tab and receipt idempotency', () => {
  const h = harness();
  const record = approved(h, 'subscription');
  const second = createContractAutomation({ now: h.now, storage: h.storage });
  h.observe(record, 'enabled', true);
  const saved = h.data.get(CONTRACT_AUTOMATION_STORAGE_KEY);
  assert.throws(() => second.observe({ id: 'other-tab', contractId: record.id, source: 'enabled', value: true, observedAt: h.now() }), /Another tab/);
  assert.throws(() => second.tick(), /Another tab/);
  assert.equal(h.data.get(CONTRACT_AUTOMATION_STORAGE_KEY), saved);
  assert.equal(second.snapshot().persistence.status, 'error');
  const refreshed = createContractAutomation({ now: h.now, storage: h.storage });
  refreshed.tick();
  assert.equal(refreshed.get(record.id).receipts.length, 1);
});

test('restore uses observation arrival order for corrections in the same millisecond', () => {
  const h = harness(), record = approved(h, 'subscription');
  h.observe(record, 'enabled', true);
  h.observe(record, 'enabled', false);
  assert.equal(h.engine.get(record.id).receipts.length, 1);
  const restored = createContractAutomation({ now: h.now, storage: h.storage });
  assert.equal(restored.get(record.id).receipts.length, 1);
});

test('prediction result evidence is traceable even when the custom rule uses another trigger', () => {
  const h = harness();
  const record = approved(h, { templateId: 'prediction_binary', terms: { rules: [{ id: 'prediction', when: { op: 'time', at: BASE }, actions: [{ type: 'settle_prediction' }] }] } });
  assert.equal(record.receipts.length, 0);
  h.observe(record, 'result', 'YES');
  assert.deepEqual(h.engine.get(record.id).receipts[0].evidenceIds, ['evidence-1']);
  const restored = createContractAutomation({ now: h.now, storage: h.storage });
  assert.equal(restored.get(record.id).receipts[0].effects[0].poolCents, 2000);
});

test('observers may read but cannot mutate domain state while delivering an atomic event batch', () => {
  const h = harness();
  h.engine.subscribe(() => h.engine.create({ templateId: 'custom' }));
  h.engine.create({ templateId: 'service' });
  assert.equal(h.engine.list().length, 1);
});

test('meaningful time-only evaluation changes notify and trace once; unchanged timer ticks stay silent', () => {
  const h = harness();
  const record = approved(h, { templateId: 'subscription', terms: { sources: [{ id: 'enabled', type: 'boolean', maxAgeMs: 1000 }] } });
  h.observe(record, 'enabled', true);
  let changes = 0; h.engine.subscribe(() => { changes += 1; });
  h.advance(60000); h.engine.tick();
  assert.equal(changes, 1);
  assert.equal(h.engine.get(record.id).history.at(-1).type, 'evaluation_changed');
  h.engine.tick(); h.engine.tick();
  assert.equal(changes, 1);
  assert.doesNotThrow(() => createContractAutomation({ now: h.now, storage: h.storage }));
});

test('public ESPN source binding is frozen, traceable and preserved by validated import/reload', () => {
  const h = harness();
  const binding = { adapter: 'espn-result', eventId: 'espn:nfl:401234567' };
  const record = approved(h, { templateId: 'prediction_binary', terms: { sources: [{ id: 'result', type: 'string', provider: 'public', binding }] } });
  binding.eventId = 'not-the-approved-event';
  assert.equal(record.terms.sources[0].binding.eventId, 'espn:nfl:401234567');
  assert.throws(() => { record.terms.sources[0].binding.eventId = 'tampered'; }, TypeError);
  const provenance = { adapter: 'espn-result', eventId: 'espn:nfl:401234567', url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard' };
  h.observe(record, 'result', 'YES', { provider: 'public', provenance });
  const result = h.engine.get(record.id);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.evidence[0].provenance, provenance);
  assert.deepEqual(result.history.find((event) => event.type === 'observed').detail.evidence.provenance, provenance);
  const reload = createContractAutomation({ now: h.now, storage: h.storage });
  assert.deepEqual(reload.get(record.id), result);
  const imported = createContractAutomation({ now: h.now });
  imported.importState(h.engine.exportState());
  assert.deepEqual(imported.get(record.id).terms.sources[0].binding, record.terms.sources[0].binding);
});

test('bound observations reject missing, mismatched and hostile provenance before any execution', () => {
  const h = harness();
  const binding = { adapter: 'espn-result', eventId: 'espn:nba:123' };
  const record = approved(h, { templateId: 'prediction_binary', terms: { sources: [{ id: 'result', type: 'string', provider: 'public', binding }] } });
  const provenance = { ...binding, url: 'https://www.espn.com/nba/game/_/gameId/123' };
  assert.throws(() => h.observe(record, 'result', 'YES'), /provider/);
  assert.throws(() => h.observe(record, 'result', 'YES', { provider: 'public' }), /provenance/);
  for (const change of [
    { adapter: 'arbitrary-adapter' }, { eventId: 'espn:nba:456' },
    { url: 'http://www.espn.com/' }, { url: 'https://espn.com.evil.test/' },
    { url: 'https://evil-espn.com/' }, { url: 'javascript:alert(1)' },
    { url: 'https://espn.com@evil.test/' }, { url: 'https://user:pass@espn.com/' },
    { url: 'https://espn.com:8443/' }, { url: 'not a URL' },
  ]) assert.throws(() => h.observe(record, 'result', 'YES', { provider: 'public', provenance: { ...provenance, ...change } }), /provenance/);
  assert.equal(h.engine.get(record.id).receipts.length, 0);
  assert.equal(h.engine.get(record.id).evidence.length, 0);
  h.observe(record, 'result', 'YES', { provider: 'public', provenance });
  assert.equal(h.engine.get(record.id).receipts.length, 1);
});

test('source bindings reject unsupported provider, type, adapter and extra executable fields', () => {
  const h = harness();
  const source = { id: 'result', type: 'string', provider: 'public', binding: { adapter: 'espn-result', eventId: 'event:1' } };
  for (const change of [
    { provider: 'manual' }, { provider: 'local' }, { type: 'boolean' },
    { binding: { ...source.binding, adapter: 'fetch-any-url' } },
    { binding: { ...source.binding, eventId: '' } },
    { binding: { ...source.binding, eventId: 'x'.repeat(161) } },
    { binding: { ...source.binding, url: 'https://arbitrary.test/' } },
  ]) assert.throws(() => h.engine.create({ templateId: 'prediction_binary', terms: { sources: [{ ...source, ...change }] } }), TypeError);
  const unbound = approved(h, { templateId: 'prediction_binary', terms: { sources: [{ id: 'result', type: 'string', provider: 'public' }] } });
  assert.throws(() => h.observe(unbound, 'result', 'YES', { provider: 'public', provenance: { ...source.binding, url: 'https://espn.com/' } }), /Unbound/);
});
