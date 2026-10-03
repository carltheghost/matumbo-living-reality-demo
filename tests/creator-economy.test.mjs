import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTokenEngine } from '../src/domains/token.js?v=20261003-skin360';
import { createEconomicKernel } from '../src/domains/economic-kernel.js?v=20261003-skin360';
import { createEconomicRuntime } from '../src/domains/economic-runtime.js?v=20261003-skin360';
import { mountOurplaceEconomy } from '../src/render/ourplace-economy.js?v=20261003-skin360';
import {
  CREATOR_CATEGORIES, DEFAULT_DESIGN_DESCRIPTOR, normalizeDesignDescriptor,
  parseCreatorDesignRequest, parseSharedCreatorDesign, exportSharedCreatorDerivative, createDesignSession, createCreatorEconomy,
} from '../src/domains/creator-economy.js?v=20261003-skin360';

function fixture(options = {}) {
  const observations = new Map();
  const engine = createTokenEngine();
  const kernel = createEconomicKernel({ engine });
  const postCreator = kernel.register('creator.test-payout', (input, { post }) => post(input.postings));
  const economy = createCreatorEconomy({
    observationVerifier: input => JSON.stringify(observations.get(input.evidenceId)) === JSON.stringify(input),
    payoutVerifier: receipt => engine.ledger.verifyReceipt(receipt.id).ok && engine.ledger._journals.find(value => value.id === receipt.id)?.hash === receipt.hash,
    settlementJournalCount: () => engine.ledger.journalCount(),
    ...options,
  });
  function design({ id = 'design', creator = 'u:alice', category = 'layout', parents = [], privacy = 'public', license = 'attribution', version = 1 } = {}) {
    const registration = { id, creator, category, parents, privacy, version, title: `${id} version ${version}`, descriptor: DEFAULT_DESIGN_DESCRIPTOR, idempotencyKey: `register:${id}:${version}` };
    const draft = economy.registerDesign(registration);
    if (privacy === 'public') economy.publish({ key: draft.key, creator, license, explicit: true, idempotencyKey: `publish:${id}:${version}` });
    return { key: draft.key, registration };
  }
  function use({ usageId = 'use-1', designKey = 'design@1', actor = 'u:bob', sessionId = 'session-1', period = '2026-10-03', kind = 'adoption', evidenceId = `observed:${usageId}`, verified = true } = {}) {
    const input = { usageId, designKey, actor, sessionId, period, kind, evidenceId, idempotencyKey: `use:${usageId}` };
    if (verified) observations.set(evidenceId, input);
    return economy.recordUsage(input);
  }
  return { engine, kernel, postCreator, economy, observations, design, use };
}

function sealSharedPacket(packet) {
  const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  const { packetHash: _old, ...body } = packet;
  return JSON.stringify({ ...body, packetHash: createHash('sha256').update(canonical(body).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)).digest('hex') });
}

function sharedProvenance(packet) {
  return { kind: 'shared-package', rootKey: packet.root.key, packetHash: packet.packetHash, attribution: packet.designs.map(({ key, creator, license }) => ({ key, creator, license })) };
}

function derivativeFixture() {
  const f = fixture();
  f.design({ id: 'licensed-source', license: 'attribution-sharealike' });
  f.design({ id: 'imported-remix', creator: 'u:bob', parents: ['licensed-source@1'], license: 'attribution-sharealike' });
  const serialized = f.economy.exportDesign('imported-remix@1');
  const source = parseSharedCreatorDesign(serialized), session = createDesignSession();
  session.apply({ proposalId: session.preview(source.root.descriptor, { provenance: sharedProvenance(source) }).proposalId, explicit: true });
  session.apply({ proposalId: session.preview('purple and grid and spacious').proposalId, explicit: true });
  const input = { serialized, descriptor: session.snapshot().descriptor, provenance: session.snapshot().provenance, id: 'local-derivative', creator: 'u:carol', category: 'layout', title: 'My edited place', license: 'attribution-sharealike', explicit: true };
  return { ...f, session, source, serialized, input };
}

// Synthetic event/download harness checks review authorization and real domain
// state without asserting browser geometry, rendering or a disk download.
function creatorUiFixture() {
  const nodes = [], downloads = [], blobs = new Map();
  class FormNode {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.listeners = new Map(); this.textContent = ''; this.value = ''; this.disabled = false; nodes.push(this); }
    setAttribute(name, value) { this.attrs[name] = value; if (name === 'value') this.value = value; }
    append(...children) {
      if (this.tag === 'select' && !this.children.length && children.length) this.value = children[0].value;
      this.children.push(...children); for (const child of children) child.parent = this;
    }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    async click() {
      if (this.attrs.download) downloads.push({ name: this.attrs.download, serialized: blobs.get(this.attrs.href) });
      return this.listeners.get('click')?.();
    }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() {}
  }
  const engine = createTokenEngine(), runtime = createEconomicRuntime({ engine, storage: null, clock: () => Date.UTC(2026, 9, 3) });
  const body = new FormNode('body'), documentRoot = { body, createElement: tag => new FormNode(tag) };
  const windowRoot = {
    Blob: class { constructor(parts) { this.serialized = parts.join(''); } },
    URL: { createObjectURL(blob) { const url = `blob:test-${blobs.size}`; blobs.set(url, blob.serialized); return url; }, revokeObjectURL() {} }
  };
  const controller = mountOurplaceEconomy({ host: body, runtime, documentRoot, windowRoot, applyDesign: () => ({ applied: true }) });
  return {
    runtime, engine, controller, downloads, journals: engine.ledger.journalCount(),
    field: attr => nodes.find(node => Object.hasOwn(node.attrs, attr)),
    click: name => nodes.find(node => node.attrs['data-ourplace-action'] === name).click(),
    dispose() { controller.dispose(); runtime.dispose(); }
  };
}

test('a conversational request previews changes without applying or authorizing money', () => {
  const session = createDesignSession();
  const initial = session.snapshot();
  const proposal = session.preview('Please make accent purple and layout grid and density spacious and no motion and navigation search');
  assert.equal(proposal.descriptor.palette.accent, '#a884ff');
  assert.equal(proposal.descriptor.layout, 'grid');
  assert.equal(proposal.descriptor.density, 'spacious');
  assert.equal(proposal.descriptor.motion, 'off');
  assert.equal(proposal.descriptor.navigation, 'search');
  assert.deepEqual(session.snapshot(), initial);
  assert.throws(() => session.apply({ proposalId: proposal.proposalId }), /Explicit/);
  session.apply({ proposalId: proposal.proposalId, explicit: true });
  assert.deepEqual(session.snapshot().descriptor, proposal.descriptor);
  assert.equal(session.snapshot().moneyAuthorized, false);
  session.undo(); assert.deepEqual(session.snapshot().descriptor, initial.descriptor);
});

test('local commands can redesign selected or all surfaces using the existing seven forms', () => {
  for (const shape of ['phone', 'square', 'rectangle', 'sphere', 'cylinder', 'cube', 'wave']) {
    const result = parseCreatorDesignRequest(`all objects to ${shape}`);
    assert.deepEqual(result.descriptor.surface, { scope: 'all', shape });
    assert.deepEqual(result.unsupported, []);
  }
  assert.deepEqual(parseCreatorDesignRequest('selected surface a sphere').descriptor.surface, { scope: 'selected', shape: 'sphere' });
});

test('unsupported conversational tasks are disclosed rather than simulated as execution', () => {
  const result = parseCreatorDesignRequest('accent blue and pay all creators and install arbitrary code');
  assert.deepEqual(result.supported, ['accent']);
  assert.deepEqual(result.unsupported, ['pay all creators', 'install arbitrary code']);
  assert.equal(result.complete, false);
  const session = createDesignSession();
  const proposal = session.preview('build a bank and send cash');
  assert.throws(() => session.apply({ proposalId: proposal.proposalId, explicit: true }), /no supported/);
});

test('design previews expire after application and cannot silently overwrite newer work', () => {
  const session = createDesignSession();
  const old = session.preview('red'); const next = session.preview('green');
  session.apply({ proposalId: next.proposalId, explicit: true });
  assert.throws(() => session.apply({ proposalId: old.proposalId, explicit: true }), /stale/);
  session.reset(); assert.deepEqual(session.snapshot().descriptor, DEFAULT_DESIGN_DESCRIPTOR);
});

test('design session restore preserves applied state and real undo history atomically', () => {
  const session = createDesignSession();
  for (const request of ['red', 'grid']) session.apply({ proposalId: session.preview(request).proposalId, explicit: true });
  const restored = createDesignSession(); restored.restore(session.serialize());
  assert.deepEqual(restored.snapshot(), session.snapshot());
  restored.undo(); assert.equal(restored.snapshot().descriptor.palette.accent, '#ff5875');
  assert.equal(restored.snapshot().descriptor.layout, 'spaces');
  const before = restored.snapshot(); const corrupt = JSON.parse(session.serialize()); corrupt.current.code = 'alert(1)';
  assert.throws(() => restored.restore(JSON.stringify(corrupt)), /Unsupported/);
  assert.deepEqual(restored.snapshot(), before);
});

test('structured designs reject executable code, unsafe URLs, unknown properties and oversized content', () => {
  for (const field of ['code', 'html', 'script', 'url', 'prototype']) assert.throws(() => normalizeDesignDescriptor({ [field]: 'x' }), /Unsupported/);
  assert.throws(() => normalizeDesignDescriptor({ palette: { accent: 'red' } }), /six-digit/);
  assert.throws(() => normalizeDesignDescriptor({ steps: [{ id: 's', action: 'navigate', target: 'javascript:evil', label: 'Run' }] }), /local IDs/);
  assert.throws(() => normalizeDesignDescriptor({ objects: [{ id: 'x', kind: 'surface', label: '<script>' }] }), /plain text/);
  assert.throws(() => normalizeDesignDescriptor({ objects: Array.from({ length: 25 }, (_, i) => ({ id: String(i), kind: 'surface', label: 'x' })) }), /at most/);
  assert.throws(() => normalizeDesignDescriptor(Object.create({ layout: 'grid' })), /plain object/);
});

for (const category of CREATOR_CATEGORIES) test(`${category} designs share immutable reviewable descriptors and explicit public licenses`, () => {
  const { economy } = fixture();
  const descriptor = { objects: [{ id: 'target', kind: category === 'object' || category === 'layout' ? 'surface' : category, label: 'Inspect me', shape: 'cube', color: '#39b9ff' }], steps: [{ id: 'inspect', action: 'inspect', target: 'target', label: 'Review this intent' }] };
  const input = { id: category, version: 1, creator: 'u:alice', category, title: category, descriptor, privacy: 'public', idempotencyKey: `new:${category}` };
  const draft = economy.registerDesign(input);
  descriptor.objects[0].label = 'Mutated';
  assert.equal(draft.descriptor.objects[0].label, 'Inspect me');
  assert.equal(draft.state, 'draft');
  assert.throws(() => economy.publish({ key: draft.key, creator: 'u:alice', license: 'attribution', idempotencyKey: `deny:${category}` }), /explicitly publish/);
  assert.throws(() => economy.publish({ key: draft.key, creator: 'u:thief', license: 'attribution', explicit: true, idempotencyKey: `thief:${category}` }), /creator/);
  const published = economy.publish({ key: draft.key, creator: 'u:alice', license: 'attribution', explicit: true, idempotencyKey: `yes:${category}` });
  assert.equal(published.state, 'published');
  assert.throws(() => { published.descriptor.layout = 'grid'; }, TypeError);
});

test('private work stays private and earns nothing until a new reviewed public version exists', () => {
  const f = fixture(); f.design({ privacy: 'private' });
  assert.equal(f.economy.snapshot({ publicOnly: true }).designs.length, 0);
  assert.throws(() => f.economy.publish({ key: 'design@1', creator: 'u:alice', license: 'attribution', explicit: true, idempotencyKey: 'publish-private' }), /Private/);
  assert.throws(() => f.economy.exportDesign('design@1'), /Only public/);
  assert.equal(f.use().reason, 'design-not-publicly-published');
  assert.equal(f.economy.snapshot().entitlements.length, 0);
});

test('version advancement preserves creator ownership and idempotent replay is payload bound', () => {
  const f = fixture(); const first = f.design();
  assert.equal(f.economy.registerDesign(first.registration).key, 'design@1');
  assert.throws(() => f.economy.registerDesign({ ...first.registration, title: 'changed' }), error => error.code === 'IDEM_MISMATCH');
  assert.throws(() => f.design({ version: 2, creator: 'u:thief' }), /original creator/);
  assert.throws(() => f.design({ version: 3 }), /consecutively/);
  f.design({ version: 2 });
  assert.equal(f.economy.snapshot().designs.length, 2);
  assert.equal(f.economy.snapshot().designs[0].version, 1);
});

test('remix parents must be published and share-alike licenses survive derivation', () => {
  const f = fixture(); f.design({ id: 'private', privacy: 'private' });
  assert.throws(() => f.design({ id: 'child', creator: 'u:bob', parents: ['private@1'] }), /publicly published/);
  f.design({ id: 'parent', license: 'attribution-sharealike' });
  const input = { id: 'child', version: 1, creator: 'u:bob', category: 'experience', title: 'Remix', descriptor: DEFAULT_DESIGN_DESCRIPTOR, privacy: 'public', parents: ['parent@1'], idempotencyKey: 'child-register' };
  f.economy.registerDesign(input);
  assert.throws(() => f.economy.publish({ key: 'child@1', creator: 'u:bob', license: 'attribution', explicit: true, idempotencyKey: 'wrong-license' }), /share-alike/);
  f.economy.publish({ key: 'child@1', creator: 'u:bob', license: 'attribution-sharealike', explicit: true, idempotencyKey: 'right-license' });
  assert.throws(() => f.design({ id: 'missing', parents: ['missing@1'] }), /Unknown/);
});

test('derived use rewards unique ancestors exactly once across a diamond attribution graph', () => {
  const f = fixture({ rewardFluffPerUsage: 11 });
  f.design({ id: 'root', creator: 'u:alice' });
  f.design({ id: 'left', creator: 'u:bob', parents: ['root@1'] });
  f.design({ id: 'right', creator: 'u:bob', parents: ['root@1'] });
  f.design({ id: 'remix', creator: 'u:carol', parents: ['left@1', 'right@1'] });
  const use = f.use({ designKey: 'remix@1', actor: 'u:dan', kind: 'derived-use' });
  assert.deepEqual(use.attribution, ['u:alice', 'u:bob', 'u:carol']);
  assert.equal(use.rewardFluff, 11);
  assert.deepEqual(f.economy.snapshot().entitlements.map(value => [value.creator, value.amountFluff]), [['u:alice', 4], ['u:bob', 4], ['u:carol', 3]]);
  assert.equal(f.engine.balance('u:alice', 'TUMBO'), 0);
  assert.equal(use.settled, false);
});

test('self use, ancestor self use, unverified claims and fictitious derived use earn nothing', () => {
  const f = fixture(); f.design(); f.design({ id: 'child', creator: 'u:carol', parents: ['design@1'] });
  assert.equal(f.use({ actor: 'u:alice' }).reason, 'self-use');
  assert.equal(f.use({ usageId: 'ancestor', designKey: 'child@1', actor: 'u:alice', kind: 'derived-use' }).reason, 'self-use');
  assert.equal(f.use({ usageId: 'fake', verified: false }).reason, 'observation-unverified');
  assert.equal(f.use({ usageId: 'no-parent', kind: 'derived-use' }).reason, 'no-derived-ancestry');
  assert.equal(f.economy.snapshot().entitlements.length, 0);
});

test('the default observation and payout boundaries fail closed', () => {
  const f = fixture({ observationVerifier: undefined }); f.design();
  assert.equal(f.use().reason, 'observation-unverified');
  assert.equal(f.economy.snapshot().ownsTokenBalance, false);
  assert.equal(f.economy.snapshot().issuesTokens, false);
});

test('duplicate usage replay cannot reward twice or substitute another design/actor payload', () => {
  const f = fixture(); f.design(); const first = f.use();
  assert.equal(f.use(), first);
  assert.equal(f.economy.snapshot().entitlements.length, 1);
  assert.throws(() => f.use({ actor: 'u:other' }), error => error.code === 'IDEM_MISMATCH');
  assert.equal(f.use({ usageId: 'second', evidenceId: 'observed:use-1', actor: 'u:other' }).reason, 'duplicate-evidence');
});

test('new event IDs cannot farm repeated sessions or one design repeatedly within a period', () => {
  const f = fixture(); f.design(); f.use();
  assert.equal(f.use({ usageId: 'new-id' }).reason, 'duplicate-session');
  assert.equal(f.use({ usageId: 'new-session', sessionId: 'other-session' }).reason, 'repeated-design-in-period');
  assert.equal(f.use({ usageId: 'next-period', sessionId: 'next-session', period: '2026-10-04' }).qualified, true);
});

test('actor, creator and total-period caps bound rewards despite new identities and designs', () => {
  const f = fixture({ rewardFluffPerUsage: 10, maxActorUsesPerPeriod: 1, maxCreatorRewardFluffPerPeriod: 12, maxTotalRewardFluffPerPeriod: 15 });
  f.design(); f.design({ id: 'other' }); f.design({ id: 'third', creator: 'u:carol' });
  assert.equal(f.use().rewardFluff, 10);
  assert.equal(f.use({ usageId: 'actor-cap', designKey: 'other@1', sessionId: 's2' }).reason, 'actor-period-cap');
  assert.equal(f.use({ usageId: 'creator-cap', designKey: 'other@1', actor: 'u:dan', sessionId: 's3' }).rewardFluff, 2);
  assert.equal(f.use({ usageId: 'total-cap', designKey: 'third@1', actor: 'u:ellen', sessionId: 's4' }).rewardFluff, 3);
  assert.equal(f.use({ usageId: 'exhausted', designKey: 'third@1', actor: 'u:frank', sessionId: 's5' }).reason, 'reward-period-cap');
  assert.equal(f.economy.snapshot().entitlements.reduce((sum, row) => sum + row.amountFluff, 0), 15);
});

test('a stolen observation cannot qualify a different actor or design', () => {
  const f = fixture(); f.design();
  const input = { usageId: 'claim', designKey: 'design@1', actor: 'u:bob', sessionId: 's', period: 'p', kind: 'adoption', evidenceId: 'real-evidence', idempotencyKey: 'claim' };
  f.observations.set('real-evidence', { ...input, actor: 'u:carol' });
  assert.equal(f.economy.recordUsage(input).reason, 'observation-unverified');
});

test('payout planning is exact, reserves entitlements and refuses unfunded/system pools', () => {
  const f = fixture(); f.design(); f.use();
  assert.throws(() => f.economy.planPayout({ planId: 'p', period: '2026-10-03', availableFluff: 9, idempotencyKey: 'plan' }), error => error.code === 'CREATOR_UNFUNDED');
  assert.equal(f.economy.snapshot().entitlements[0].state, 'pending');
  assert.throws(() => f.economy.planPayout({ planId: 'p', period: '2026-10-03', fundingAccount: 'sys:treasury', availableFluff: 10, idempotencyKey: 'sys' }), /funded creator reward pool/);
  const plan = f.economy.planPayout({ planId: 'p', period: '2026-10-03', availableFluff: 10, idempotencyKey: 'plan' });
  assert.equal(plan.totalFluff, 10);
  assert.equal(plan.entries.reduce((sum, row) => sum + BigInt(row.delta), 0n), 0n);
  assert.equal(plan.entries[0].account, 'b:economic-rewards');
  assert.equal(plan.settled, false); assert.equal(plan.moneyAuthorized, false);
  assert.throws(() => f.economy.planPayout({ planId: 'second', period: '2026-10-03', availableFluff: 100, idempotencyKey: 'second' }), /No pending/);
});

test('a canceled payout releases its entitlements without settling or losing attribution', () => {
  const f = fixture(); f.design(); f.use();
  f.economy.planPayout({ planId: 'p', period: '2026-10-03', availableFluff: 10, idempotencyKey: 'plan' });
  const canceled = f.economy.cancelPayout({ planId: 'p', idempotencyKey: 'cancel' });
  assert.equal(canceled.state, 'canceled'); assert.equal(f.economy.snapshot().entitlements[0].state, 'pending');
  const next = f.economy.planPayout({ planId: 'next', period: '2026-10-03', availableFluff: 10, idempotencyKey: 'next' });
  assert.equal(next.totalFluff, 10);
  assert.throws(() => f.economy.cancelPayout({ planId: 'p', idempotencyKey: 'again' }), /unsettled/);
});

test('actual canonical ledger settlement is required and pays a creator once without minting', () => {
  const f = fixture(); f.design(); f.use();
  f.engine.faucet('u:sponsor', 'TUMBO', 100, { idempotencyKey: 'sponsor-fund' });
  f.kernel.fundPool({ from: 'u:sponsor', purpose: 'rewards', amountFluff: 100, idempotencyKey: 'pool-fund' });
  const plan = f.economy.planPayout({ planId: 'p', period: '2026-10-03', availableFluff: f.engine.balance('b:economic-rewards', 'TUMBO'), idempotencyKey: 'plan' });
  const postings = plan.entries.map(({ account, asset, delta }) => ({ account, asset, amount: Number(delta) }));
  const fake = { id: 'fake', hash: '1234567890abcdef', postings };
  assert.throws(() => f.economy.acknowledgePayout({ planId: 'p', receipt: fake, explicit: true, idempotencyKey: 'fake' }), /not verified/);
  assert.equal(f.economy.snapshot().entitlements[0].state, 'planned');
  const count = f.engine.ledger.journalCount();
  const receipt = f.postCreator({ postings, idempotencyKey: 'creator:p' });
  const input = { planId: 'p', receipt, explicit: true, idempotencyKey: 'ack' };
  const paid = f.economy.acknowledgePayout(input);
  assert.equal(f.economy.acknowledgePayout(input), paid);
  assert.equal(f.engine.ledger.journalCount(), count + 1);
  assert.equal(f.engine.balance('u:alice', 'TUMBO'), 10);
  assert.equal(f.engine.balance('b:economic-rewards', 'TUMBO'), 90);
  assert.equal(paid.hashAlgorithm, 'FNV-1a-64');
  assert.equal(paid.cryptographicSettlementProof, false);
  assert.equal(f.engine.ledger.verifyChain().ok, true);
  assert.equal(f.economy.snapshot().entitlements[0].state, 'paid');
});

test('receipt acknowledgment rejects changed destinations, fractional amounts and executable metadata', () => {
  const f = fixture(); f.design(); f.use();
  f.economy.planPayout({ planId: 'p', period: '2026-10-03', availableFluff: 10, idempotencyKey: 'plan' });
  const receipt = { id: 'r', hash: '1234567890abcdef', postings: [{ account: 'b:economic-rewards', asset: 'TUMBO', amount: -10 }, { account: 'u:thief', asset: 'TUMBO', amount: 10 }] };
  assert.throws(() => f.economy.acknowledgePayout({ planId: 'p', receipt, explicit: true, idempotencyKey: 'thief' }), /exact funded/);
  receipt.postings[1].amount = 9.5;
  assert.throws(() => f.economy.acknowledgePayout({ planId: 'p', receipt, explicit: true, idempotencyKey: 'fraction' }), /exact nonzero/);
  let called = false; receipt.toJSON = () => { called = true; return {}; };
  assert.throws(() => f.economy.acknowledgePayout({ planId: 'p', receipt, explicit: true, idempotencyKey: 'executable' }), /plain object/);
  assert.equal(called, false);
});

test('public shared JSON preserves attribution and safely previews a portable design', () => {
  const f = fixture(); f.design({ id: 'parent', license: 'attribution-sharealike' });
  f.design({ id: 'child', creator: 'u:bob', parents: ['parent@1'], license: 'attribution-sharealike' });
  f.use({ designKey: 'child@1', actor: 'u:carol', kind: 'derived-use' });
  const serialized = f.economy.exportDesign('child@1');
  assert.equal(serialized.includes('session-1'), false);
  const parsed = parseSharedCreatorDesign(serialized);
  assert.equal(parsed.integrityVerified, true); assert.equal(parsed.authorIdentityVerified, false);
  assert.equal(parsed.moneyAuthorized, false); assert.equal(parsed.root.creator, 'u:bob');
  assert.equal(parsed.designs.length, 2);
  const session = createDesignSession(); const preview = session.preview(parsed.root.descriptor);
  session.apply({ proposalId: preview.proposalId, explicit: true });
  assert.deepEqual(session.snapshot().descriptor, parsed.root.descriptor);
  const corrupt = JSON.parse(serialized); corrupt.designs[0].descriptor.layout = 'flow';
  assert.throws(() => parseSharedCreatorDesign(JSON.stringify(corrupt)), /integrity/);
});

test('creator export restores immutable attribution, qualified observations and pending payout exactly', () => {
  const f = fixture(); f.design(); f.use();
  f.economy.planPayout({ planId: 'p', period: '2026-10-03', availableFluff: 10, idempotencyKey: 'plan' });
  const fresh = createCreatorEconomy({ observationVerifier: input => JSON.stringify(f.observations.get(input.evidenceId)) === JSON.stringify(input) });
  fresh.restore(f.economy.serialize());
  assert.deepEqual(fresh.snapshot(), f.economy.snapshot());
  assert.throws(() => fresh.restore(f.economy.serialize()), /fresh/);
});

test('import tampering or unverified evidence fails atomically without accepting forged reward history', () => {
  const f = fixture(); f.design(); f.use();
  const before = createCreatorEconomy();
  assert.throws(() => before.restore(f.economy.serialize()), /reproduce/);
  assert.equal(before.snapshot().historyLength, 0);
  assert.equal(before.snapshot().designs.length, 0);
  const corrupt = JSON.parse(f.economy.serialize()); corrupt.events[0].input.creator = 'u:thief';
  assert.throws(() => before.restore(JSON.stringify(corrupt)), /integrity/);
  assert.equal(before.snapshot().entitlements.length, 0);
  corrupt.events[0].input.creator = 'u:alice'; corrupt.policy.rewardFluffPerUsage = 999;
  assert.throws(() => before.restore(JSON.stringify(corrupt)), /Incompatible/);
});

test('snapshots disclose entitlements rather than inventing spendable balances or external authority', () => {
  const f = fixture(); f.design(); f.use(); const state = f.economy.snapshot();
  assert.equal('balance' in state, false); assert.equal('balanceFluff' in state, false);
  assert.equal(state.ownsTokenBalance, false); assert.equal(state.realMoneyAuthority, false);
  assert.equal(state.entitlements[0].state, 'pending');
  const publicState = f.economy.snapshot({ publicOnly: true });
  assert.equal(publicState.usages.length, 0); assert.equal(publicState.entitlements.length, 0); assert.equal(publicState.payoutPlans.length, 0);
});

test('a verifier cannot reenter the creator owner to manufacture another design or usage', () => {
  let economy;
  economy = createCreatorEconomy({ observationVerifier: () => {
    economy.registerDesign({ id: 'nested', creator: 'u:alice', category: 'layout', title: 'Nested', descriptor: DEFAULT_DESIGN_DESCRIPTOR, privacy: 'public', idempotencyKey: 'nested' });
    return true;
  } });
  economy.registerDesign({ id: 'real', creator: 'u:alice', category: 'layout', title: 'Real', descriptor: DEFAULT_DESIGN_DESCRIPTOR, privacy: 'public', idempotencyKey: 'real' });
  economy.publish({ key: 'real@1', creator: 'u:alice', license: 'attribution', explicit: true, idempotencyKey: 'publish' });
  const use = economy.recordUsage({ usageId: 'use', designKey: 'real@1', actor: 'u:bob', sessionId: 's', period: 'p', kind: 'adoption', evidenceId: 'e', idempotencyKey: 'use' });
  assert.equal(use.reason, 'observation-unverified');
  assert.equal(economy.snapshot().designs.length, 1);
  assert.equal(economy.snapshot().entitlements.length, 0);
});

test('guarded settlement blocks canonical onCommit observers from canceling after money moved', () => {
  const f = fixture(); f.design(); f.use();
  f.engine.faucet('u:sponsor', 'TUMBO', 100, { idempotencyKey: 'fund' });
  f.kernel.fundPool({ from: 'u:sponsor', purpose: 'rewards', amountFluff: 100, idempotencyKey: 'pool' });
  f.economy.planPayout({ planId: 'guarded', period: '2026-10-03', availableFluff: 100, idempotencyKey: 'plan' });
  const observerErrors = [];
  const unsubscribe = f.engine.ledger.onCommit(() => {
    try { f.economy.cancelPayout({ planId: 'guarded', idempotencyKey: 'observer-cancel' }); }
    catch (error) { observerErrors.push(error.code); }
  });
  let calls = 0;
  const settle = plan => { calls++; return f.postCreator({ postings: plan.entries.map(({ account, asset, delta }) => ({ account, asset, amount: Number(delta) })), idempotencyKey: 'guarded-receipt' }); };
  const input = { planId: 'guarded', explicit: true, idempotencyKey: 'commit' };
  const result = f.economy.commitPayout(input, settle);
  assert.equal(result.state, 'paid'); assert.equal(result.settled, true);
  assert.deepEqual(observerErrors, ['CREATOR_REENTRY']);
  assert.equal(f.economy.commitPayout(input, settle), result); assert.equal(calls, 1);
  assert.equal(f.engine.balance('u:alice', 'TUMBO'), 10);
  assert.equal(f.economy.snapshot().entitlements[0].state, 'paid');
  const fresh = createCreatorEconomy({ observationVerifier: input => JSON.stringify(f.observations.get(input.evidenceId)) === JSON.stringify(input), payoutVerifier: receipt => f.engine.ledger.verifyReceipt(receipt.id).ok, settlementJournalCount: () => f.engine.ledger.journalCount() });
  const journals = f.engine.ledger.journalCount(); fresh.restore(f.economy.serialize());
  assert.deepEqual(fresh.snapshot(), f.economy.snapshot());
  assert.equal(f.engine.ledger.journalCount(), journals);
  unsubscribe();
});

test('guarded settlement rejects async work before invocation and insufficient funds leave entitlements unchanged', () => {
  const f = fixture(); f.design(); f.use();
  f.economy.planPayout({ planId: 'guarded', period: '2026-10-03', availableFluff: 10, idempotencyKey: 'plan' });
  let called = false; const before = f.economy.snapshot();
  assert.throws(() => f.economy.commitPayout({ planId: 'guarded', explicit: true, idempotencyKey: 'async' }, async () => { called = true; }), /synchronous/);
  assert.equal(called, false);
  assert.throws(() => f.economy.commitPayout({ planId: 'guarded', explicit: true, idempotencyKey: 'insufficient' }, plan => f.postCreator({ postings: plan.entries.map(({ account, asset, delta }) => ({ account, asset, amount: Number(delta) })), idempotencyKey: 'insufficient-journal' })), /insufficient/);
  assert.deepEqual(f.economy.snapshot(), before);
  assert.throws(() => f.economy.commitPayout({ planId: 'guarded', explicit: true, idempotencyKey: 'promise' }, () => Promise.resolve({})), /asynchronous/);
  assert.deepEqual(f.economy.snapshot(), before);
});

test('an ambiguous callback failure after canonical payment visibly blocks retry and preserves entitlement ownership', () => {
  const f = fixture(); f.design(); f.use();
  f.engine.faucet('u:sponsor', 'TUMBO', 100, { idempotencyKey: 'fund' });
  f.kernel.fundPool({ from: 'u:sponsor', purpose: 'rewards', amountFluff: 100, idempotencyKey: 'pool' });
  f.economy.planPayout({ planId: 'ambiguous', period: '2026-10-03', availableFluff: 100, idempotencyKey: 'plan' });
  let receipt;
  const result = f.economy.commitPayout({ planId: 'ambiguous', explicit: true, idempotencyKey: 'commit' }, plan => {
    receipt = f.postCreator({ postings: plan.entries.map(({ account, asset, delta }) => ({ account, asset, amount: Number(delta) })), idempotencyKey: 'ambiguous-journal' });
    throw new Error('Callback lost its result');
  });
  assert.equal(result.state, 'reconciliation-required'); assert.equal(result.settled, false);
  assert.equal(f.economy.snapshot().entitlements[0].state, 'planned');
  assert.throws(() => f.economy.commitPayout({ planId: 'ambiguous', explicit: true, idempotencyKey: 'retry' }, () => { throw new Error('should never run'); }), /terminal/);
  assert.throws(() => f.economy.cancelPayout({ planId: 'ambiguous', idempotencyKey: 'cancel' }), /unsettled/);
  const recovered = createCreatorEconomy({ observationVerifier: input => JSON.stringify(f.observations.get(input.evidenceId)) === JSON.stringify(input), payoutVerifier: receipt => f.engine.ledger.verifyReceipt(receipt.id).ok });
  recovered.restore(f.economy.serialize());
  assert.equal(recovered.snapshot().payoutPlans[0].state, 'reconciliation-required');
  const paid = f.economy.acknowledgePayout({ planId: 'ambiguous', receipt, explicit: true, idempotencyKey: 'recover' });
  assert.equal(paid.state, 'paid'); assert.equal(f.engine.balance('u:alice', 'TUMBO'), 10);
  assert.equal(f.economy.snapshot().usages[0].rewardSettlementState, 'paid');
});

test('creator identities match canonical participants before a plan can reach ledger settlement', () => {
  const f = fixture();
  for (const creator of ['u:has.dot', 'u:-dash', 'u:_underscore', `u:${'x'.repeat(65)}`, 'sys:treasury', 'b:economic-rewards']) assert.throws(() => f.design({ creator }), /canonical|bounded/);
  f.design({ creator: 'u:Creator_42-safe' });
  assert.equal(f.economy.snapshot().designs[0].creator, 'u:Creator_42-safe');
});

test('rewriting a public packet checksum cannot bypass descriptor safety, DAG completeness or license terms', () => {
  const f = fixture(); f.design({ id: 'parent', license: 'attribution-sharealike' });
  f.design({ id: 'child', creator: 'u:bob', parents: ['parent@1'], license: 'attribution-sharealike' });
  const original = JSON.parse(f.economy.exportDesign('child@1'));
  const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  const seal = packet => { const { packetHash: _old, ...body } = packet; packet.packetHash = createHash('sha256').update(canonical(body).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)).digest('hex'); return JSON.stringify(packet); };
  const cyclic = structuredClone(original); cyclic.designs[0].parents = ['child@1'];
  assert.throws(() => parseSharedCreatorDesign(seal(cyclic)), /cyclic/);
  const missing = structuredClone(original); missing.designs.pop();
  assert.throws(() => parseSharedCreatorDesign(seal(missing)), /incomplete/);
  const wrongLicense = structuredClone(original); wrongLicense.designs[0].license = 'attribution';
  assert.throws(() => parseSharedCreatorDesign(seal(wrongLicense)), /parent terms/);
  const unsafe = structuredClone(original); unsafe.designs[0].descriptor.code = 'execute anything';
  assert.throws(() => parseSharedCreatorDesign(seal(unsafe)), /Unsupported descriptor/);
});

test('shared attribution survives apply, reload, language edits and undo without becoming a fresh author', () => {
  const f = fixture(); f.design({ license: 'attribution-sharealike' });
  const packet = parseSharedCreatorDesign(f.economy.exportDesign('design@1'));
  const provenance = { kind: 'shared-package', rootKey: packet.root.key, packetHash: packet.packetHash, attribution: packet.designs.map(({ key, creator, license }) => ({ key, creator, license })) };
  const session = createDesignSession(); session.apply({ proposalId: session.preview(packet.root.descriptor, { provenance }).proposalId, explicit: true });
  const restored = createDesignSession(); restored.restore(session.serialize());
  assert.deepEqual(restored.snapshot().provenance, provenance); assert.equal(restored.snapshot().publicationEligible, false);
  restored.apply({ proposalId: restored.preview('blue and compact').proposalId, explicit: true });
  assert.deepEqual(restored.snapshot().provenance, provenance); assert.equal(restored.snapshot().publicationEligible, false);
  restored.reset(); assert.equal(restored.snapshot().provenance.kind, 'fresh'); assert.equal(restored.snapshot().publicationEligible, true);
  restored.undo(); assert.deepEqual(restored.snapshot().provenance, provenance); assert.equal(restored.snapshot().publicationEligible, false);
});

test('registered local remix roots participate in preview staleness and restore with undo', () => {
  const session = createDesignSession(), origin = { kind: 'local-design', rootKey: 'original@1' };
  const stale = session.preview('red');
  session.apply({ proposalId: session.preview(DEFAULT_DESIGN_DESCRIPTOR, { provenance: origin }).proposalId, explicit: true });
  assert.throws(() => session.apply({ proposalId: stale.proposalId, explicit: true }), /stale/);
  session.apply({ proposalId: session.preview('grid').proposalId, explicit: true });
  const restored = createDesignSession(); restored.restore(session.serialize());
  assert.deepEqual(restored.snapshot().provenance, origin); assert.equal(restored.snapshot().publicationEligible, true);
  restored.undo(); assert.deepEqual(restored.snapshot().provenance, origin); assert.equal(restored.snapshot().descriptor.layout, 'spaces');
  restored.undo(); assert.equal(restored.snapshot().provenance.kind, 'fresh');
});

test('unknown, missing or executable session provenance fails atomically', () => {
  const session = createDesignSession(), before = session.snapshot(), exported = JSON.parse(session.serialize());
  for (const provenance of [{ kind: 'bank-verified', rootKey: 'x@1' }, { kind: 'fresh', script: 'run' }, { kind: 'local-design', rootKey: 'javascript:evil' }, { kind: 'shared-package', rootKey: 'x@1', packetHash: 'a'.repeat(64), attribution: [{ key: 'x@1', creator: 'sys:treasury', license: 'attribution' }] }]) {
    assert.throws(() => session.restore(JSON.stringify({ ...exported, provenance })), /provenance|Provenance|canonical|Unsupported/);
    assert.deepEqual(session.snapshot(), before);
  }
  delete exported.provenance; assert.throws(() => session.restore(JSON.stringify(exported)), /provenance is required/); assert.deepEqual(session.snapshot(), before);
});

test('legacy sessions preserve appearance but quarantine changed designs with unavailable attribution', () => {
  const session = createDesignSession(), legacy = { schemaVersion: 1, original: DEFAULT_DESIGN_DESCRIPTOR, current: { ...DEFAULT_DESIGN_DESCRIPTOR, layout: 'grid' }, previous: [DEFAULT_DESIGN_DESCRIPTOR] };
  session.restore(JSON.stringify(legacy)); assert.equal(session.snapshot().descriptor.layout, 'grid'); assert.equal(session.snapshot().provenance.kind, 'legacy-unverified'); assert.equal(session.snapshot().publicationEligible, false);
  session.undo(); assert.equal(session.snapshot().provenance.kind, 'fresh'); assert.equal(session.snapshot().publicationEligible, true);
});

test('edited imported designs export a new unverified root with unchanged complete licensed ancestry and no economic effects', () => {
  const f = derivativeFixture(), before = f.economy.snapshot(), sessionBefore = f.session.snapshot(), journals = f.engine.ledger.journalCount();
  const serialized = exportSharedCreatorDerivative(f.input), raw = JSON.parse(serialized), packet = parseSharedCreatorDesign(serialized);
  assert.equal(raw.format, 'matumbo-unverified-derivative-v1');
  assert.equal(packet.root.key, 'local-derivative@1');
  assert.equal(packet.root.creator, 'u:carol');
  assert.deepEqual(packet.root.parents, [f.source.root.key]);
  assert.deepEqual(packet.root.descriptor, sessionBefore.descriptor);
  assert.notEqual(packet.root.descriptorHash, f.source.root.descriptorHash);
  assert.deepEqual(packet.designs.slice(1), f.source.designs);
  assert.equal(packet.derivation.sourcePacketHash, f.source.packetHash);
  assert.equal(packet.derivation.declaredLocalAuthor, 'u:carol');
  for (const authority of ['authorIdentityVerified', 'externalPublicationVerified', 'catalogRegistered', 'moneyAuthorized']) assert.equal(packet.derivation[authority], false);
  assert.equal(packet.authorIdentityVerified, false); assert.equal(packet.externalPublicationVerified, false); assert.equal(packet.moneyAuthorized, false);
  assert.equal(packet.requiresExplicitReview, true); assert.equal(packet.integrityVerified, true);
  assert.deepEqual(f.economy.snapshot(), before); assert.deepEqual(f.session.snapshot(), sessionBefore);
  assert.equal(f.engine.ledger.journalCount(), journals);
  assert.equal(f.economy.exportDesign('imported-remix@1'), f.serialized);
  assert.equal(f.session.snapshot().publicationEligible, false);
  assert.throws(() => { packet.designs[1].license = 'attribution'; }, TypeError);
});

test('an exported derivative can be imported, reloaded, edited and exported again while both authors and all licenses survive', () => {
  const f = derivativeFixture(), firstJson = exportSharedCreatorDerivative(f.input), first = parseSharedCreatorDesign(firstJson), next = createDesignSession();
  next.apply({ proposalId: next.preview(first.root.descriptor, { provenance: sharedProvenance(first) }).proposalId, explicit: true });
  const reloaded = createDesignSession(); reloaded.restore(next.serialize());
  reloaded.apply({ proposalId: reloaded.preview('green and flow').proposalId, explicit: true });
  const second = parseSharedCreatorDesign(exportSharedCreatorDerivative({ ...f.input, serialized: firstJson, descriptor: reloaded.snapshot().descriptor, provenance: reloaded.snapshot().provenance, id: 'second-derivative', creator: 'u:dana' }));
  assert.deepEqual(second.root.parents, ['local-derivative@1']);
  assert.deepEqual(second.designs.slice(1), first.designs);
  assert.equal(second.designs.length, 4);
  assert.equal(second.derivation.sourcePacketHash, first.packetHash);
  assert.equal(reloaded.snapshot().publicationEligible, false);
  reloaded.undo(); assert.deepEqual(reloaded.snapshot().provenance, sharedProvenance(first));
  assert.deepEqual(reloaded.snapshot().descriptor, first.root.descriptor);
});

test('derivative export requires explicit review, an applied descriptor edit and the exact complete shared session origin', () => {
  const f = derivativeFixture(), before = f.session.snapshot();
  assert.throws(() => exportSharedCreatorDerivative({ ...f.input, explicit: false }), /Explicit derivative review/);
  assert.throws(() => exportSharedCreatorDerivative({ ...f.input, descriptor: f.source.root.descriptor, title: 'A renamed original' }), /Apply an edit/);
  for (const provenance of [
    { kind: 'fresh' },
    { kind: 'legacy-unverified' },
    { kind: 'local-design', rootKey: f.source.root.key },
    { ...f.input.provenance, packetHash: 'a'.repeat(64) },
    { ...f.input.provenance, rootKey: 'licensed-source@1' },
    { ...f.input.provenance, attribution: [f.input.provenance.attribution[0]] },
    { ...f.input.provenance, attribution: f.input.provenance.attribution.map(row => ({ ...row, creator: 'u:thief' })) },
    { ...f.input.provenance, attribution: f.input.provenance.attribution.map(row => ({ ...row, license: 'attribution' })) },
  ]) assert.throws(() => exportSharedCreatorDerivative({ ...f.input, provenance }), /matching the current shared session/);
  // An order change preserves the complete keyed licensed ancestry.
  assert.doesNotThrow(() => exportSharedCreatorDerivative({ ...f.input, provenance: { ...f.input.provenance, attribution: [...f.input.provenance.attribution].reverse() } }));
  assert.deepEqual(f.session.snapshot(), before);
});

test('portable derivatives reject ancestry ID collisions, weakened licenses, unsafe descriptors and authority fields', () => {
  const f = derivativeFixture();
  for (const id of ['licensed-source', 'imported-remix']) assert.throws(() => exportSharedCreatorDerivative({ ...f.input, id }), /collides/);
  assert.throws(() => exportSharedCreatorDerivative({ ...f.input, license: 'attribution' }), /share-alike/);
  assert.throws(() => exportSharedCreatorDerivative({ ...f.input, license: 'private' }), /Unsupported derivative license/);
  assert.throws(() => exportSharedCreatorDerivative({ ...f.input, creator: 'sys:treasury' }), /canonical/);
  assert.throws(() => exportSharedCreatorDerivative({ ...f.input, descriptor: { ...f.input.descriptor, script: 'arbitrary code' } }), /Unsupported descriptor/);
  assert.throws(() => exportSharedCreatorDerivative({ ...f.input, descriptor: { steps: [{ id: 'run', action: 'inspect', target: 'https://external.example', label: 'Execute' }] } }), /unsupported characters|local IDs/);
  assert.throws(() => exportSharedCreatorDerivative({ ...f.input, catalogRegistered: true }), /Unsupported derivative export/);
  const original = JSON.parse(exportSharedCreatorDerivative(f.input));
  for (const authority of ['authorIdentityVerified', 'externalPublicationVerified', 'catalogRegistered', 'moneyAuthorized']) {
    const forged = structuredClone(original); forged.derivation[authority] = true;
    assert.throws(() => parseSharedCreatorDesign(sealSharedPacket(forged)), /cannot claim/);
  }
  const forgedAuthor = structuredClone(original); forgedAuthor.derivation.declaredLocalAuthor = 'u:thief';
  assert.throws(() => parseSharedCreatorDesign(sealSharedPacket(forgedAuthor)), /declared local author/);
  const removedParent = structuredClone(original); removedParent.designs[0].parents = ['licensed-source@1']; removedParent.designs.splice(1, 1);
  assert.throws(() => parseSharedCreatorDesign(sealSharedPacket(removedParent)), /source ancestry/);
  const code = structuredClone(original); code.designs[0].descriptor.code = 'execute';
  assert.throws(() => parseSharedCreatorDesign(sealSharedPacket(code)), /Unsupported descriptor/);
});

test('attribution-only imports can choose either supported derivative license and new roots do not reuse ancestor IDs', () => {
  const f = fixture(); f.design();
  const serialized = f.economy.exportDesign('design@1'), source = parseSharedCreatorDesign(serialized);
  for (const license of ['attribution', 'attribution-sharealike']) {
    const packet = parseSharedCreatorDesign(exportSharedCreatorDerivative({ serialized, descriptor: { ...source.root.descriptor, layout: 'grid' }, provenance: sharedProvenance(source), id: `new-${license}`, creator: 'u:bob', title: 'Edited', category: 'layout', license, explicit: true }));
    assert.equal(packet.root.license, license);
    assert.deepEqual(packet.designs.slice(1), source.designs);
  }
});

test('derivative packets preserve the 64-design and 12-edge DAG limits including reused deep branches', () => {
  const f = fixture(); f.design();
  const template = JSON.parse(f.economy.exportDesign('design@1')).designs[0];
  const treeRows = Array.from({ length: 64 }, (_, index) => ({ ...template, id: `node-${index}`, key: `node-${index}@1`, parents: Array.from({ length: 8 }, (_, child) => index * 8 + child + 1).filter(child => child < 64).map(child => `node-${child}@1`) }));
  const serialized = sealSharedPacket({ format: 'matumbo-reviewed-design-v1', rootKey: 'node-0@1', designs: treeRows });
  const source = parseSharedCreatorDesign(serialized);
  assert.equal(source.designs.length, 64);
  const input = { serialized, descriptor: { ...source.root.descriptor, layout: 'grid' }, provenance: sharedProvenance(source), id: 'overflow', creator: 'u:bob', title: 'Edited', category: 'layout', license: 'attribution', explicit: true };
  assert.throws(() => exportSharedCreatorDerivative(input), /Unsupported shared design packet/);
  const chain = Array.from({ length: 13 }, (_, index) => ({ ...template, id: `chain-${index}`, key: `chain-${index}@1`, parents: index ? [`chain-${index - 1}@1`] : [] }));
  const maxDepthJson = sealSharedPacket({ format: 'matumbo-reviewed-design-v1', rootKey: 'chain-12@1', designs: chain });
  const maxDepth = parseSharedCreatorDesign(maxDepthJson);
  assert.throws(() => exportSharedCreatorDerivative({ ...input, serialized: maxDepthJson, provenance: sharedProvenance(maxDepth) }), /exceeds 12 levels/);
  // Visiting the reused chain first via a short edge cannot hide a longer path.
  const hiddenDeep = [...chain, { ...template, id: 'too-deep', key: 'too-deep@1', parents: ['chain-0@1', 'chain-12@1'] }];
  assert.throws(() => parseSharedCreatorDesign(sealSharedPacket({ format: 'matumbo-reviewed-design-v1', rootKey: 'too-deep@1', designs: hiddenDeep })), /exceeds 12 levels/);
  assert.throws(() => exportSharedCreatorDerivative({ ...input, serialized: ' '.repeat(850001) }), /too large/);
});

test('creator UI rejects stale author, title, category, license and applied-descriptor reviews before any derivative download', async () => {
  const f = derivativeFixture(), ui = creatorUiFixture();
  try {
    ui.field('data-design-import').value = f.serialized;
    await ui.click('design-import-preview'); await ui.click('design-apply');
    ui.field('data-design-request').value = 'purple and grid';
    await ui.click('design-preview'); await ui.click('design-apply');
    ui.field('data-design-license').value = 'attribution-sharealike';
    const changes = [
      ['data-ourplace-actor', 'u:visitor'],
      ['data-design-title', 'Changed after review'],
      ['data-design-category', 'experience'],
      ['data-design-license', 'attribution'],
    ];
    for (const [attribute, value] of changes) {
      await ui.click('design-derivative-preview');
      assert.match(ui.controller.status.textContent, /Review this current applied descriptor/);
      const field = ui.field(attribute), old = field.value; field.value = value;
      await ui.click('design-derivative-export');
      assert.match(ui.controller.status.textContent, /changed|share-alike/);
      assert.equal(ui.downloads.length, 0);
      field.value = old;
    }
    await ui.click('design-derivative-preview');
    ui.field('data-design-request').value = 'green and flow';
    await ui.click('design-preview'); await ui.click('design-apply');
    await ui.click('design-derivative-export');
    assert.match(ui.controller.status.textContent, /changed/); assert.equal(ui.downloads.length, 0);
    await ui.click('design-derivative-preview'); await ui.click('design-derivative-export');
    assert.equal(ui.downloads.length, 1);
    const packet = parseSharedCreatorDesign(ui.downloads[0].serialized);
    assert.equal(packet.root.creator, 'u:you'); assert.equal(packet.root.descriptor.layout, 'flow');
    assert.equal(packet.root.descriptor.palette.accent, '#56d6aa');
    assert.deepEqual(packet.designs.slice(1), f.source.designs);
    assert.equal(packet.moneyAuthorized, false);
    assert.deepEqual(ui.runtime.designSession.snapshot().provenance, sharedProvenance(f.source));
    assert.equal(ui.runtime.designSession.snapshot().publicationEligible, false);
    assert.equal(ui.runtime.creator.snapshot().designs.length, 0); assert.equal(ui.runtime.creator.snapshot().entitlements.length, 0);
    assert.equal(ui.engine.ledger.journalCount(), ui.journals);
  } finally { ui.dispose(); }
});

test('creator UI retains original-packet download and import publication guard while requiring a matching source and actual edit', async () => {
  const f = derivativeFixture(), ui = creatorUiFixture();
  try {
    await ui.click('design-derivative-export'); assert.match(ui.controller.status.textContent, /Review the edited derivative first/);
    ui.field('data-design-import').value = f.serialized;
    await ui.click('design-import-preview'); await ui.click('design-apply');
    ui.field('data-design-license').value = 'attribution-sharealike';
    await ui.click('design-derivative-preview'); assert.match(ui.controller.status.textContent, /Apply an edit/);
    await ui.click('design-publish'); assert.match(ui.controller.status.textContent, /shared or unverified origin/);
    assert.equal(ui.runtime.creator.snapshot().designs.length, 0);
    await ui.click('design-import-export');
    assert.deepEqual(ui.downloads, [{ name: 'ourplace-shared-design.json', serialized: f.serialized }]);
    ui.field('data-design-request').value = 'grid';
    await ui.click('design-preview'); await ui.click('design-apply');
    await ui.click('design-derivative-preview');
    const differentSource = f.economy.exportDesign('licensed-source@1');
    ui.field('data-design-import').value = differentSource; await ui.click('design-import-preview');
    // Reviewing another source must not graft it onto the already applied origin.
    await ui.click('design-derivative-export'); assert.match(ui.controller.status.textContent, /matching the current shared session/);
    assert.equal(ui.downloads.length, 1); assert.equal(ui.engine.ledger.journalCount(), ui.journals);
    assert.equal(ui.runtime.creator.snapshot().entitlements.length, 0);
  } finally { ui.dispose(); }
});
