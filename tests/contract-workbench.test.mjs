import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountContractWorkbench, buildWorkbenchContract, parseContractValue, describePredicate, publicEventOutcomeNames } from '../src/render/contract-workbench.js';
import { createContractAutomation } from '../src/domains/contract-automation.js';

// Deliberately exercises real DOM handlers, not copies of their callbacks.
function documentFixture() {
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.style = {}; this.value = ''; this._text = ''; this.hidden = false; this.checked = false; this.ownerDocument = doc; this.scrollTop = 0; this.scrollLeft = 0; }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    append(...nodes) { for (const child of nodes) { child.parentNode = this; this.children.push(child); } }
    replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
    dispatch(type) { for (const handler of this.listeners[type] ?? []) handler({ target: this, preventDefault() {}, stopPropagation() {} }); }
    click() { this.dispatch('click'); }
    focus() { doc.activeElement = this; }
    blur() { doc.activeElement = null; for (let element = this; element; element = element.parentNode) element.dispatch('focusout'); }
  }
  const doc = { createElement: (tag) => new Element(tag) };
  return { doc, root: new Element('div') };
}
function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }
function named(root, name) { const result = descendants(root).find((el) => el.name === name); assert.ok(result, `missing control ${name}`); return result; }
function button(root, label) { const result = descendants(root).find((el) => el.tagName === 'BUTTON' && el.textContent === label); assert.ok(result, `missing button ${label}`); return result; }
function form(root, className) { return descendants(root).find((el) => el.tagName === 'FORM' && el.className === className); }
function engineFixture() {
  let records = [];
  const calls = [];
  const subscribers = new Set();
  const base = { startsAt: null, expiresAt: null, sources: [{ id: 'accepted', label: 'Delivery accepted', type: 'boolean', maxAgeMs: 86400000, provider: 'manual' }], rules: [{ id: 'delivery', label: 'Accept delivery', when: { op: 'eq', source: 'accepted', value: true }, actions: [{ type: 'simulated_transfer', from: 'owner', to: 'reviewer', amount: 100 }] }], limits: { maxTotalPoints: 1000, maxExecutions: 100 } };
  const templates = [
    { id: 'service', label: 'Service agreement', description: 'Delivery before a local receipt.', defaults: base },
    { id: 'recurring', label: 'Subscription', description: 'Bounded repeated local effects.', defaults: { ...base, rules: [{ ...base.rules[0], schedule: { everyMs: 60000, maxRuns: 3 } }] } },
    { id: 'public', label: 'Public observation', description: 'Requires connected adapter.', defaults: { ...base, sources: [{ ...base.sources[0], provider: 'public' }] } },
    { id: 'prediction', label: 'Prediction pool', description: 'Simulated pool.', defaults: { ...base, prediction: { outcomes: ['YES', 'NO'], positions: [{ actor: 'owner', outcome: 'YES', points: 10 }], resultSource: 'accepted' }, rules: [{ ...base.rules[0], actions: [{ type: 'settle_prediction' }] }] } },
  ];
  const emit = () => subscribers.forEach((listener) => listener());
  const change = (id, type, value, status) => {
    const record = records.find((item) => item.id === id);
    calls.push({ type, id, value });
    if (status) record.status = status;
    record.history.push({ id: `event:${record.history.length}`, type, actor: value.actor, at: Date.now(), detail: { reason: value.reason } });
    emit(); return structuredClone(record);
  };
  return {
    calls, subscribers,
    listTemplates: () => structuredClone(templates),
    list: () => structuredClone(records), get: (id) => structuredClone(records.find((record) => record.id === id)),
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    create(input) {
      calls.push({ type: 'create', value: input });
      const record = { ...structuredClone(input), id: `contract:${records.length + 1}`, status: 'pending_approval', approvals: [], receipts: [], history: [{ id: 'created', type: 'created', at: 1 }], evaluation: { state: 'unknown', reason: 'Required approvals are missing.' }, simulation: true };
      records.push(record); emit(); return structuredClone(record);
    },
    approve(id, value) {
      const record = records.find((item) => item.id === id);
      if (!record.approvals.some((entry) => entry.actor === value.actor)) record.approvals.push({ actor: value.actor, at: Date.now() });
      return change(id, 'approve', value, record.approvals.length === record.parties.length ? 'active' : undefined);
    },
    pause: (id, value) => change(id, 'pause', value, 'paused'), resume: (id, value) => change(id, 'resume', value, 'active'), cancel: (id, value) => change(id, 'cancel', value, 'cancelled'), dispute: (id, value) => change(id, 'dispute', value, 'disputed'), resolveDispute: (id, value) => change(id, 'resolveDispute', value, value.resolution === 'resume' ? 'active' : 'cancelled'),
    observe(value) {
      const record = records.find((item) => item.id === value.contractId);
      record.evidence = [value];
      if (record.status === 'active' && value.value === true) { record.receipts.push({ id: 'receipt:1', ruleId: 'delivery', at: Date.now(), effects: [{ type: 'simulated_transfer', amount: 100 }], simulation: true }); record.status = 'completed'; }
      return change(value.contractId, 'observe', value);
    },
    tick: emit,
  };
}
function setup() { const fixture = documentFixture(); const engine = engineFixture(); const selections = []; const api = mountContractWorkbench({ ...fixture, engine, onSelect: (record) => selections.push(record) }); return { ...fixture, engine, api, selections }; }
function create(fixture, template = 'service') {
  button(fixture.root, 'Create contract').click();
  named(fixture.root, 'templateId').value = template;
  named(fixture.root, 'templateId').dispatch('change');
  named(fixture.root, 'title').value = 'My first agreement';
  form(fixture.root, 'cw-composer').dispatch('submit');
  return fixture.engine.list()[0];
}

test('typed evidence rejects ambiguous boolean and non-finite or empty numbers', () => {
  assert.equal(parseContractValue('false', 'boolean'), false);
  assert.equal(parseContractValue('3.5', 'number'), 3.5);
  assert.throws(() => parseContractValue('maybe', 'boolean'));
  assert.throws(() => parseContractValue('', 'number'));
  assert.throws(() => parseContractValue('Infinity', 'number'));
});
test('contract input deduplicates local parties, requires creator and clones terms', () => {
  const terms = { rules: [] };
  const input = buildWorkbenchContract({ templateId: 'service', title: ' A ', creator: 'owner', parties: 'owner, reviewer,owner', terms });
  assert.deepEqual(input.parties, ['owner', 'reviewer']); assert.equal(input.title, 'A');
  input.terms.rules.push(1); assert.deepEqual(terms.rules, []);
  assert.throws(() => buildWorkbenchContract({ title: 'A', creator: 'owner', parties: 'someone', terms }), /creator/);
});
test('native composer creates edited service terms; engine owns selected persisted object', () => {
  const fixture = setup();
  button(fixture.root, 'Create contract').click();
  named(fixture.root, 'title').value = '<script>not executable</script>';
  named(fixture.root, 'effect-amount').value = '250';
  named(fixture.root, 'source-max-age').value = '5';
  form(fixture.root, 'cw-composer').dispatch('submit');
  const saved = fixture.engine.list()[0];
  assert.equal(saved.terms.rules[0].actions[0].amount, 250);
  assert.equal(saved.terms.sources[0].maxAgeMs, 300000);
  assert.equal(saved.title, '<script>not executable</script>');
  assert.equal(descendants(fixture.root).filter((el) => el.tagName === 'SCRIPT').length, 0);
  assert.equal(fixture.api.getSnapshot().selectedId, saved.id);
  assert.equal(fixture.selections[0].id, saved.id);
  assert.match(fixture.root.textContent, /not verified signatures/);
  fixture.api.destroy();
});
test('create -> required approvals -> local evidence invokes real handlers and displays receipt', () => {
  const fixture = setup(); create(fixture);
  named(fixture.root, 'actor').value = 'owner'; button(fixture.root, 'Approve as selected role').click();
  assert.equal(fixture.engine.list()[0].status, 'pending_approval');
  named(fixture.root, 'actor').value = 'reviewer'; button(fixture.root, 'Approve as selected role').click();
  assert.equal(fixture.engine.list()[0].status, 'active');
  named(fixture.root, 'evidence-value').value = 'true'; form(fixture.root, 'cw-evidence').dispatch('submit');
  assert.equal(fixture.engine.list()[0].status, 'completed');
  const observation = fixture.engine.calls.find((call) => call.type === 'observe').value;
  assert.equal(observation.provider, 'manual'); assert.equal(observation.value, true);
  assert.match(observation.id, /^manual:/);
  assert.match(fixture.root.textContent, /Local receipt \/ delivery/);
  fixture.api.destroy();
});
test('pause, resume, dispute reason and explicit resolution use selected local actor', () => {
  const fixture = setup(); create(fixture);
  named(fixture.root, 'actor').value = 'owner'; button(fixture.root, 'Approve as selected role').click();
  named(fixture.root, 'actor').value = 'reviewer'; button(fixture.root, 'Approve as selected role').click();
  button(fixture.root, 'Pause automation').click(); assert.equal(fixture.engine.list()[0].status, 'paused');
  button(fixture.root, 'Resume automation').click(); assert.equal(fixture.engine.list()[0].status, 'active');
  button(fixture.root, 'Dispute & stop automation').click(); assert.equal(fixture.engine.list()[0].status, 'active');
  assert.match(fixture.root.textContent, /Add a reason/);
  named(fixture.root, 'dispute-reason').value = 'Delivery needs correction';
  button(fixture.root, 'Dispute & stop automation').click(); assert.equal(fixture.engine.list()[0].status, 'disputed');
  named(fixture.root, 'dispute-reason').value = 'Both local roles resolved the delivery';
  button(fixture.root, 'Agree to resume').click(); assert.equal(fixture.engine.list()[0].status, 'active');
  button(fixture.root, 'Cancel agreement').click(); assert.equal(fixture.engine.list()[0].status, 'cancelled');
  fixture.api.destroy();
});
test('recurrence and prediction pool positions are editable, not canned', () => {
  const fixture = setup();
  button(fixture.root, 'Create contract').click();
  named(fixture.root, 'templateId').value = 'recurring'; named(fixture.root, 'templateId').dispatch('change');
  named(fixture.root, 'title').value = 'Weekly access'; named(fixture.root, 'rule-every').value = '10080'; named(fixture.root, 'rule-runs').value = '12';
  form(fixture.root, 'cw-composer').dispatch('submit');
  assert.deepEqual(fixture.engine.list()[0].terms.rules[0].schedule, { everyMs: 604800000, maxRuns: 12 });
  button(fixture.root, 'Create contract').click();
  named(fixture.root, 'templateId').value = 'prediction'; named(fixture.root, 'templateId').dispatch('change');
  named(fixture.root, 'title').value = 'Two outcomes'; named(fixture.root, 'prediction-outcomes').value = 'A, B'; named(fixture.root, 'prediction-positions').value = 'owner, A, 20\nreviewer, B, 30';
  form(fixture.root, 'cw-composer').dispatch('submit');
  assert.deepEqual(fixture.engine.list()[1].terms.prediction.positions, [{ actor: 'owner', outcome: 'A', points: 20 }, { actor: 'reviewer', outcome: 'B', points: 30 }]);
  fixture.api.destroy();
});
test('public adapter sources cannot be impersonated with manual evidence form', () => {
  const fixture = setup(); create(fixture, 'public');
  assert.equal(form(fixture.root, 'cw-evidence'), undefined);
  assert.match(fixture.root.textContent, /cannot impersonate/);
  fixture.api.destroy();
});
test('heartbeats preserve native controls and unsaved draft text; destroy unsubscribes', () => {
  const fixture = setup(); create(fixture);
  const evidenceValue = named(fixture.root, 'evidence-value');
  evidenceValue.value = 'true';
  button(fixture.root, 'Create contract').click();
  named(fixture.root, 'title').value = 'Unfinished draft';
  fixture.engine.tick(); fixture.api.refresh();
  assert.equal(named(fixture.root, 'evidence-value'), evidenceValue);
  assert.equal(named(fixture.root, 'title').value, 'Unfinished draft');
  assert.equal(form(fixture.root, 'cw-composer').dataset.previewDirty, 'true');
  fixture.api.destroy(); fixture.api.destroy();
  assert.equal(fixture.engine.subscribers.size, 0); assert.equal(fixture.root.children.length, 0);
});
test('advanced JSON validation errors remain visible without discarding input', () => {
  const fixture = setup();
  button(fixture.root, 'Create contract').click(); named(fixture.root, 'title').value = 'Advanced';
  named(fixture.root, 'advancedEnabled').checked = true; named(fixture.root, 'advancedTerms').value = '{ bad';
  form(fixture.root, 'cw-composer').dispatch('submit');
  assert.equal(fixture.engine.list().length, 0);
  assert.equal(named(fixture.root, 'advancedTerms').value, '{ bad');
  assert.ok(descendants(fixture.root).some((el) => el.getAttribute('role') === 'alert'));
  fixture.api.destroy();
});
test('compound conditions remain meaningful, styles enforce touch targets and no perpetual motion', () => {
  assert.equal(describePredicate({ op: 'all', conditions: [{ op: 'eq', source: 'accepted', value: true }, { op: 'gte', source: 'quality', value: 8 }] }), 'accepted eq true AND quality gte 8');
  const js = readFileSync(new URL('../src/render/contract-workbench.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/render/contract-workbench.css', import.meta.url), 'utf8');
  assert.equal(js.includes('innerHTML'), false);
  assert.match(css, /min-height:44px/); assert.match(css, /@container\(max-width:380px\)/); assert.match(css, /prefers-reduced-motion/);
  assert.equal(css.includes('infinite'), false);
});

test('every actual engine template can be created through native workbench fields', () => {
  const actualEngine = createContractAutomation();
  for (const template of actualEngine.listTemplates()) {
    const fixture = documentFixture();
    const engine = createContractAutomation();
    const api = mountContractWorkbench({ ...fixture, engine });
    create({ ...fixture, engine }, template.id);
    const record = engine.list()[0];
    assert.ok(record, `${template.id} creation failed: ${fixture.root.textContent}`);
    assert.equal(record.templateId, template.id);
    assert.equal(record.terms.rules.length, template.defaults.rules.length);
    assert.equal(record.status, 'pending_approval');
    api.destroy();
  }
});
test('real engine evidence submission auto-executes without unsupported observation properties', () => {
  const fixture = documentFixture();
  const engine = createContractAutomation();
  const api = mountContractWorkbench({ ...fixture, engine });
  create({ ...fixture, engine });
  named(fixture.root, 'actor').value = 'owner'; button(fixture.root, 'Approve as selected role').click();
  named(fixture.root, 'actor').value = 'reviewer'; button(fixture.root, 'Approve as selected role').click();
  named(fixture.root, 'evidence-value').value = 'true'; form(fixture.root, 'cw-evidence').dispatch('submit');
  assert.equal(engine.list()[0].status, 'completed', fixture.root.textContent);
  assert.equal(engine.list()[0].receipts[0].effects[0].amount, 100);
  api.destroy();
});
test('real engine strict backup import restores empty workspace and refuses replacement', async () => {
  const original = createContractAutomation();
  original.create({ templateId: 'service', title: 'Portable agreement', creator: 'owner', parties: ['owner', 'reviewer'] });
  const fixture = documentFixture();
  const engine = createContractAutomation();
  const api = mountContractWorkbench({ ...fixture, engine });
  named(fixture.root, 'backup-json').value = original.exportState();
  button(fixture.root, 'Import into empty workspace').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.list()[0].title, 'Portable agreement');
  assert.equal(button(fixture.root, 'Import into empty workspace').disabled, true);
  named(fixture.root, 'backup-json').value = '{invalid';
  button(fixture.root, 'Import into empty workspace').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.list().length, 1);
  assert.match(fixture.root.textContent, /Existing contracts cannot be overwritten/);
  api.destroy();
});
test('custom named parties replace template placeholders without changing existing explicit names', () => {
  const fixture = documentFixture();
  const engine = createContractAutomation();
  const api = mountContractWorkbench({ ...fixture, engine });
  button(fixture.root, 'Create contract').click();
  named(fixture.root, 'creator').value = 'Alice'; named(fixture.root, 'parties').value = 'Alice, Bob'; named(fixture.root, 'title').value = 'Named participants';
  form(fixture.root, 'cw-composer').dispatch('submit');
  const record = engine.list()[0]; assert.ok(record, fixture.root.textContent);
  assert.equal(record.terms.rules[0].actions[0].from, 'Alice'); assert.equal(record.terms.rules[0].actions[0].to, 'Bob');
  api.destroy();
});
test('all 15 actual UI templates execute their approved initial rules on typed evidence', () => {
  const templates = createContractAutomation().listTemplates();
  assert.equal(templates.length, 15);
  for (const template of templates) {
    const fixture = documentFixture();
    let offset = 10000;
    const engine = createContractAutomation({ now: () => Date.now() + offset });
    const api = mountContractWorkbench({ ...fixture, engine });
    create({ ...fixture, engine }, template.id);
    named(fixture.root, 'actor').value = 'owner'; button(fixture.root, 'Approve as selected role').click();
    named(fixture.root, 'actor').value = 'reviewer'; button(fixture.root, 'Approve as selected role').click();
    for (const source of template.defaults.sources) {
      const sourceControl = named(fixture.root, 'evidence-source');
      sourceControl.value = source.id; sourceControl.dispatch('change');
      named(fixture.root, 'evidence-value').value = source.type === 'boolean' ? 'true' : source.type === 'number' ? '3' : template.defaults.prediction?.outcomes[0] ?? 'accepted';
      form(fixture.root, 'cw-evidence').dispatch('submit');
    }
    let record = engine.list()[0];
    assert.equal(record.receipts.length, template.defaults.rules.length, `${template.id}: ${fixture.root.textContent}`);
    if (template.defaults.rules.some((rule) => rule.schedule)) {
      offset += 180000;
      engine.tick();
      record = engine.list()[0];
      assert.equal(record.receipts.length, 3, `${template.id} recurrence failed`);
    }
    assert.equal(record.status, 'completed', `${template.id} did not finish`);
    assert.ok(record.receipts.every((receipt) => receipt.simulation));
    api.destroy();
  }
});
function createBound(fixture, eventId = '401234567') {
  button(fixture.root, 'Create contract').click();
  named(fixture.root, 'templateId').value = 'prediction_binary'; named(fixture.root, 'templateId').dispatch('change');
  named(fixture.root, 'title').value = 'Public result agreement';
  named(fixture.root, 'source-provider').value = 'public'; named(fixture.root, 'source-provider').dispatch('change');
  named(fixture.root, 'source-event-id').value = eventId;
  form(fixture.root, 'cw-composer').dispatch('submit');
  return fixture.engine.list()[0];
}
test('public source editor freezes selected ESPN event binding without creating evidence', () => {
  const fixture = documentFixture(); const engine = createContractAutomation();
  const api = mountContractWorkbench({ ...fixture, engine, getPublicEvents: () => [{ id: '401234567', label: 'Home vs Away', status: 'scheduled' }] });
  button(fixture.root, 'Create contract').click();
  named(fixture.root, 'templateId').value = 'prediction_binary'; named(fixture.root, 'templateId').dispatch('change');
  named(fixture.root, 'title').value = 'Specific event';
  named(fixture.root, 'source-provider').value = 'public'; named(fixture.root, 'source-provider').dispatch('change');
  named(fixture.root, 'source-public-event').value = '401234567'; named(fixture.root, 'source-public-event').dispatch('change');
  assert.equal(named(fixture.root, 'source-event-id').value, '401234567');
  assert.equal(named(fixture.root, 'source-event-id').maxLength, 160);
  form(fixture.root, 'cw-composer').dispatch('submit');
  const record = engine.list()[0]; assert.ok(record, fixture.root.textContent);
  assert.deepEqual(record.terms.sources[0].binding, { adapter: 'espn-result', eventId: '401234567' });
  assert.equal(record.evidence.length, 0);
  assert.equal(form(fixture.root, 'cw-evidence'), undefined);
  assert.match(fixture.root.textContent, /not independently verified/);
  assert.match(fixture.root.textContent, /No refresh adapter is connected/);
  assert.equal(descendants(fixture.root).some((el) => el.tagName === 'BUTTON' && el.textContent === 'Refresh connected evidence'), false);
  api.destroy();
});
test('public refresh reports pending, missing results and errors without fake success', async () => {
  const fixture = documentFixture(); const engine = createContractAutomation();
  let response = { observed: 0, pending: 1, errors: [] }; let captured;
  const api = mountContractWorkbench({ ...fixture, engine, onRefreshEvidence: async (request) => { captured = request; if (response instanceof Error) throw response; return response; } });
  const record = createBound({ ...fixture, engine }); assert.ok(record, fixture.root.textContent);
  button(fixture.root, 'Refresh connected evidence').click(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(captured, { contractId: record.id, bindings: [{ sourceId: 'result', adapter: 'espn-result', eventId: '401234567' }] });
  assert.match(fixture.root.textContent, /No new result observations recorded\. 1 result is still pending/);
  assert.equal(engine.get(record.id).evidence.length, 0);
  response = { observed: 2, pending: 0, errors: [] };
  button(fixture.root, 'Refresh connected evidence').click(); await new Promise((resolve) => setImmediate(resolve));
  assert.match(fixture.root.textContent, /only 0 new public observations are saved/);
  response = undefined;
  button(fixture.root, 'Refresh connected evidence').click(); await new Promise((resolve) => setImmediate(resolve));
  assert.match(fixture.root.textContent, /No new evidence is confirmed/);
  response = new Error('Network unavailable');
  button(fixture.root, 'Refresh connected evidence').click(); await new Promise((resolve) => setImmediate(resolve));
  assert.match(fixture.root.textContent, /Connected evidence could not be refreshed: Network unavailable/);
  assert.equal(button(fixture.root, 'Refresh connected evidence').disabled, false);
  api.destroy();
});
test('public refresh displays actual engine evidence provenance and automatic receipt', async () => {
  const fixture = documentFixture(); const engine = createContractAutomation();
  const api = mountContractWorkbench({ ...fixture, engine, onRefreshEvidence: async ({ contractId }) => {
    engine.observe({ id: 'espn:401234567:final', contractId, source: 'result', provider: 'public', value: 'YES', observedAt: Date.now(), provenance: { adapter: 'espn-result', eventId: '401234567', url: 'https://www.espn.com/game/_/gameId/401234567' } });
    return { observed: 1, pending: 0, errors: [] };
  } });
  const record = createBound({ ...fixture, engine });
  named(fixture.root, 'actor').value = 'owner'; button(fixture.root, 'Approve as selected role').click();
  named(fixture.root, 'actor').value = 'reviewer'; button(fixture.root, 'Approve as selected role').click();
  button(fixture.root, 'Refresh connected evidence').click(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.get(record.id).status, 'completed');
  assert.equal(engine.get(record.id).receipts.length, 1);
  assert.match(fixture.root.textContent, /Observation source: https:\/\/www\.espn\.com/);
  assert.match(fixture.root.textContent, /1 read-only result observation recorded/);
  api.destroy();
});
test('source bindings reject non-string input and are removed on manual route change', () => {
  const fixture = documentFixture(); const engine = createContractAutomation();
  const api = mountContractWorkbench({ ...fixture, engine });
  button(fixture.root, 'Create contract').click(); named(fixture.root, 'title').value = 'Incompatible source';
  named(fixture.root, 'source-provider').value = 'public'; named(fixture.root, 'source-event-id').value = '401234567';
  form(fixture.root, 'cw-composer').dispatch('submit');
  assert.equal(engine.list().length, 0); assert.match(fixture.root.textContent, /ESPN result bindings require a string/);
  named(fixture.root, 'source-provider').value = 'manual';
  form(fixture.root, 'cw-composer').dispatch('submit');
  assert.equal(engine.list()[0].terms.sources[0].provider, 'manual');
  assert.equal(engine.list()[0].terms.sources[0].binding, undefined);
  api.destroy();
});
test('public participant helper uses explicit names only and never title or winner guesses', () => {
  assert.deepEqual(publicEventOutcomeNames({ label: 'Falcons vs Ravens', winner: 'Falcons' }), []);
  assert.deepEqual(publicEventOutcomeNames({ participants: [{ name: 'Falcons', winner: true }, { name: 'Ravens', winner: false }] }), ['FALCONS', 'RAVENS']);
  assert.deepEqual(publicEventOutcomeNames({ participants: [{ name: 'Same' }, { name: 'same' }] }), []);
  assert.deepEqual(publicEventOutcomeNames({ outcomes: ['A'] }), []);
});
test('public outcome setup requires explicit position choices after copying loaded participant names', () => {
  const fixture = documentFixture(); const engine = createContractAutomation();
  const api = mountContractWorkbench({ ...fixture, engine, getPublicEvents: () => [{ id: '401234567', label: 'A match', participants: [{ name: 'Eastern Falcons' }, { name: 'Western Ravens' }] }] });
  createBound({ ...fixture, engine });
  assert.equal(engine.list().length, 0);
  assert.match(fixture.root.textContent, /Public result outcomes must be the loaded participant names/);
  const oldPositions = named(fixture.root, 'prediction-positions').value;
  button(fixture.root, 'Use loaded participant names as outcomes').click();
  assert.equal(named(fixture.root, 'prediction-outcomes').value, 'EASTERN FALCONS, WESTERN RAVENS');
  assert.equal(named(fixture.root, 'prediction-positions').value, oldPositions, 'participant choices must not silently move to different outcomes');
  form(fixture.root, 'cw-composer').dispatch('submit');
  assert.equal(engine.list().length, 0);
  assert.match(fixture.root.textContent, /Position outcome is not in the approved outcome set/);
  named(fixture.root, 'prediction-positions').value = 'owner, Eastern Falcons, 10\nreviewer, Western Ravens, 10';
  form(fixture.root, 'cw-composer').dispatch('submit');
  const record = engine.list()[0]; assert.ok(record, fixture.root.textContent);
  assert.deepEqual(record.terms.prediction.outcomes, ['EASTERN FALCONS', 'WESTERN RAVENS']);
  assert.deepEqual(record.terms.rules[0].when.value, ['EASTERN FALCONS', 'WESTERN RAVENS', 'DRAW', 'VOID']);
  assert.equal(record.evidence.length, 0); assert.equal(record.approvals.length, 0);
  api.destroy();
});
test('external lifecycle changes preserve focused form node, draft values, disclosure state and scroll', async () => {
  const fixture = documentFixture(); const engine = createContractAutomation();
  const api = mountContractWorkbench({ ...fixture, engine });
  const record = create({ ...fixture, engine }, 'governance');
  const value = named(fixture.root, 'evidence-value'); value.value = '22'; value.focus();
  named(fixture.root, 'dispute-reason').value = 'An unfinished reason';
  const history = descendants(fixture.root).find((el) => el.dataset.cwSection === 'history'); history.open = false;
  fixture.root.scrollTop = 312;
  engine.approve(record.id, { actor: 'owner' });
  assert.equal(named(fixture.root, 'evidence-value'), value, 'external event must not rebuild a focused form');
  assert.equal(fixture.doc.activeElement, value); assert.equal(value.value, '22');
  assert.match(fixture.root.textContent, /in-progress input is preserved/);
  value.blur(); await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(named(fixture.root, 'evidence-value'), value);
  assert.equal(named(fixture.root, 'evidence-value').value, '22');
  assert.equal(named(fixture.root, 'dispute-reason').value, 'An unfinished reason');
  assert.equal(descendants(fixture.root).find((el) => el.dataset.cwSection === 'history').open, false);
  assert.equal(fixture.root.scrollTop, 312);
  api.destroy();
});
function selectActor(root, actor) { named(root, 'actor').value = actor; named(root, 'actor').dispatch('change'); }
function approveBoth(root) { selectActor(root, 'owner'); button(root, 'Approve as selected role').click(); selectActor(root, 'reviewer'); button(root, 'Approve as selected role').click(); }
test('real milestone UI holds out-of-order evidence and executes only after approved predecessor', () => {
  const fixture = documentFixture(); const engine = createContractAutomation(); const api = mountContractWorkbench({ ...fixture, engine });
  const record = create({ ...fixture, engine }, 'milestone');
  named(fixture.root, 'evidence-source').value = 'delivery'; named(fixture.root, 'evidence-source').dispatch('change');
  named(fixture.root, 'evidence-value').value = 'true'; form(fixture.root, 'cw-evidence').dispatch('submit');
  assert.equal(engine.get(record.id).receipts.length, 0);
  approveBoth(fixture.root);
  assert.equal(engine.get(record.id).status, 'active'); assert.equal(engine.get(record.id).receipts.length, 0);
  named(fixture.root, 'evidence-source').value = 'design'; named(fixture.root, 'evidence-source').dispatch('change');
  named(fixture.root, 'evidence-value').value = 'true'; form(fixture.root, 'cw-evidence').dispatch('submit');
  assert.deepEqual(engine.get(record.id).receipts.map((receipt) => receipt.ruleId), ['design', 'delivery']);
  assert.equal(engine.get(record.id).status, 'completed'); api.destroy();
});
test('real pause controls refuse another role resuming; unanimous dispute votes release held evidence once', () => {
  const fixture = documentFixture(); const engine = createContractAutomation(); const api = mountContractWorkbench({ ...fixture, engine });
  const record = create({ ...fixture, engine }); approveBoth(fixture.root);
  selectActor(fixture.root, 'reviewer'); button(fixture.root, 'Pause automation').click();
  selectActor(fixture.root, 'owner'); button(fixture.root, 'Resume automation').click();
  assert.equal(engine.get(record.id).status, 'paused'); assert.match(fixture.root.textContent, /Only the party who paused/);
  selectActor(fixture.root, 'reviewer'); button(fixture.root, 'Resume automation').click();
  named(fixture.root, 'dispute-reason').value = 'Review delivery'; button(fixture.root, 'Dispute & stop automation').click();
  named(fixture.root, 'evidence-value').value = 'true'; form(fixture.root, 'cw-evidence').dispatch('submit');
  assert.equal(engine.get(record.id).receipts.length, 0);
  selectActor(fixture.root, 'owner'); named(fixture.root, 'dispute-reason').value = 'Accepted'; button(fixture.root, 'Agree to resume').click();
  assert.equal(engine.get(record.id).status, 'disputed');
  selectActor(fixture.root, 'reviewer'); named(fixture.root, 'dispute-reason').value = 'Prefer cancel'; button(fixture.root, 'Agree to cancel').click();
  assert.equal(engine.get(record.id).status, 'disputed');
  named(fixture.root, 'dispute-reason').value = 'Now accepted'; button(fixture.root, 'Agree to resume').click();
  assert.equal(engine.get(record.id).status, 'completed'); assert.equal(engine.get(record.id).receipts.length, 1);
  api.destroy();
});
test('reused agreement terms create independent approvals and retain original receipts', () => {
  const fixture = documentFixture(); const engine = createContractAutomation(); const api = mountContractWorkbench({ ...fixture, engine });
  const original = create({ ...fixture, engine }); approveBoth(fixture.root);
  named(fixture.root, 'evidence-value').value = 'true'; form(fixture.root, 'cw-evidence').dispatch('submit');
  button(fixture.root, 'Reuse terms in a new contract').click(); named(fixture.root, 'title').value = 'A second delivery';
  named(fixture.root, 'effect-amount').value = '50'; form(fixture.root, 'cw-composer').dispatch('submit');
  const records = engine.list(); assert.equal(records.length, 2);
  assert.equal(engine.get(original.id).receipts[0].effects[0].amount, 100);
  assert.equal(records[1].approvals.length, 0); assert.equal(records[1].receipts.length, 0); assert.equal(records[1].status, 'pending_approval');
  assert.equal(records[1].terms.rules[0].actions[0].amount, 50); api.destroy();
});
test('expiry is enforced even when focused local evidence is being preserved', async () => {
  let clock = Date.now(); const fixture = documentFixture(); const engine = createContractAutomation({ now: () => clock });
  const record = engine.create({ templateId: 'service', title: 'Expiring terms', terms: { expiresAt: clock + 1000 } });
  const api = mountContractWorkbench({ ...fixture, engine });
  const value = named(fixture.root, 'evidence-value'); value.value = 'true'; value.focus();
  clock += 1001; engine.tick(); assert.equal(engine.get(record.id).status, 'expired');
  assert.equal(named(fixture.root, 'evidence-value'), value);
  form(fixture.root, 'cw-evidence').dispatch('submit'); assert.equal(engine.get(record.id).receipts.length, 0);
  assert.match(fixture.root.textContent, /Terminal contracts cannot accept/);
  value.blur(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(form(fixture.root, 'cw-evidence'), undefined); api.destroy();
});
test('custom local effects expose their terms and unused effect controls are not editable', () => {
  const fixture = documentFixture(); const engine = createContractAutomation(); const api = mountContractWorkbench({ ...fixture, engine });
  button(fixture.root, 'Create contract').click(); named(fixture.root, 'templateId').value = 'custom'; named(fixture.root, 'templateId').dispatch('change');
  named(fixture.root, 'title').value = 'Access by condition'; named(fixture.root, 'effect-type').value = 'grant_access'; named(fixture.root, 'effect-type').dispatch('change');
  named(fixture.root, 'effect-resource').value = 'shared-studio'; named(fixture.root, 'effect-duration').value = '5';
  form(fixture.root, 'cw-composer').dispatch('submit');
  const record = engine.list()[0]; assert.ok(record, fixture.root.textContent);
  assert.equal(record.terms.rules[0].actions[0].durationMs, 300000);
  approveBoth(fixture.root); named(fixture.root, 'evidence-value').value = 'true'; form(fixture.root, 'cw-evidence').dispatch('submit');
  assert.equal(engine.get(record.id).receipts[0].effects[0].resource, 'shared-studio');
  assert.equal(engine.get(record.id).receipts[0].effects[0].type, 'grant_access'); api.destroy();
});
test('compact chrome leads with selected agreement and keeps storage guidance in backup disclosure', () => {
  const fixture = documentFixture(); const engine = createContractAutomation(); const api = mountContractWorkbench({ ...fixture, engine });
  const record = create({ ...fixture, engine });
  const all = descendants(fixture.root);
  const selected = all.find((el) => el.className === 'cw-selected-summary');
  const head = all.find((el) => el.className === 'cw-head');
  const portability = all.find((el) => el.className === 'cw-advanced cw-portability');
  const storage = all.find((el) => el.className === 'cw-persistence cw-hint');
  const authority = all.find((el) => el.className === 'cw-authority');
  assert.equal(selected.hidden, false); assert.match(selected.textContent, /My first agreement/);
  assert.equal(head.hidden, true, 'generic title must not duplicate the selected contract heading');
  assert.equal(storage.parentNode, portability);
  assert.equal(authority.children[0].textContent, 'Simulation · no real funds/signatures');
  assert.equal(all.find((el) => el.className === 'cw-library-picker').hidden, true, 'one selected contract does not need a duplicate list card');
  const css = readFileSync(new URL('../src/render/contract-workbench.css', import.meta.url), 'utf8');
  assert.match(css, /\.contract-workbench \.cw-tabs\{display:grid!important;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(css, /\.contract-workbench \[hidden\]\{display:none!important\}/);
  assert.equal(engine.get(record.id).status, 'pending_approval');
  button(fixture.root, 'Create contract').click(); assert.equal(selected.hidden, true); assert.equal(head.hidden, false);
  api.destroy();
});
