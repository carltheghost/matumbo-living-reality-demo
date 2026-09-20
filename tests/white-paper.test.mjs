import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  WHITE_PAPER_BOUNDARY,
  WHITE_PAPER_BOUNDARIES,
  WHITE_PAPER_SECTIONS,
  WHITE_PAPER_SOURCE,
  createWhitePaperContribution,
  createWhitePaperDocument,
} from '../src/domains/white-paper.js';
import { createLivingRealityProjection } from '../src/core/demo-projection.js';
import { FEATURE_DEFINITIONS } from '../src/render/feature-navigator.js';
import { createWhitePaperConsole, WHITE_PAPER_CONSOLE_SOURCE } from '../src/render/white-paper.js';

const sectionById = (document, id) => document.sections.find((section) => section.id === id);

test('white paper contribution carries section metadata, never composed text', () => {
  const contribution = createWhitePaperContribution();
  assert.equal(contribution.source, WHITE_PAPER_SOURCE);
  assert.equal(contribution.simulation, true);
  assert.equal(contribution.entities.length, WHITE_PAPER_SECTIONS.length);
  for (const entity of contribution.entities) {
    assert.equal(entity.kind, 'document-section');
    assert.ok(!('body' in entity), 'contribution must not carry composed text');
  }
  assert.ok(Object.isFrozen(contribution));
});

test('full projection composes every section live with sane numbers', () => {
  const envelope = createLivingRealityProjection();
  const document = createWhitePaperDocument({ envelope, features: FEATURE_DEFINITIONS });
  assert.equal(document.sectionCount, 6);
  assert.equal(document.liveSectionCount, 4);
  assert.ok(Object.isFrozen(document));

  const vision = sectionById(document, 'vision');
  assert.equal(vision.kind, 'frozen');
  assert.match(vision.body, /Materialize it/);

  const features = sectionById(document, 'features');
  assert.equal(features.status, 'live');
  assert.equal(features.count, FEATURE_DEFINITIONS.length);
  assert.ok(features.features.some((feature) => feature.id === 'contract-atelier'));
  assert.ok(features.features.some((feature) => feature.id === 'luna-companion'));

  const mesh = sectionById(document, 'neural-mesh');
  assert.equal(mesh.status, 'live');
  assert.ok(mesh.agents.length >= 2);
  assert.ok(mesh.agents.some((agent) => agent.label === 'Control Tower'));

  const contractsLedger = sectionById(document, 'contracts-ledger');
  assert.equal(contractsLedger.status, 'live');
  assert.ok(contractsLedger.contracts.open >= 1);
  assert.ok(contractsLedger.ledger.records.length >= 1);
  assert.equal(contractsLedger.ledger.authoritative, false);

  const roomsPeople = sectionById(document, 'rooms-people');
  assert.equal(roomsPeople.status, 'live');
  assert.ok(roomsPeople.rooms.length >= 1);
  assert.ok(roomsPeople.person);

  const boundaries = sectionById(document, 'boundaries');
  assert.equal(boundaries.kind, 'frozen');
  assert.deepEqual(boundaries.items, WHITE_PAPER_BOUNDARIES);
  assert.ok(!/world eye/i.test(JSON.stringify(document)), 'World Eye name must not appear');
});

test('missing envelope degrades every live section to not-yet-live without throwing', () => {
  const document = createWhitePaperDocument({ envelope: null, features: [] });
  assert.equal(document.liveSectionCount, 0);
  for (const id of ['features', 'neural-mesh', 'contracts-ledger', 'rooms-people']) {
    const section = sectionById(document, id);
    assert.equal(section.status, 'not yet live', id);
    assert.ok(typeof section.note === 'string' && section.note.length > 0);
  }
  // Frozen sections still render.
  assert.equal(sectionById(document, 'vision').kind, 'frozen');
  assert.equal(sectionById(document, 'boundaries').kind, 'frozen');
});

test('partial envelope keeps present sections live and degrades the rest', () => {
  const full = createLivingRealityProjection();
  const kept = full.world.contributions.filter((contribution) =>
    ['contract-atelier', 'prime-ledger-echoproof'].includes(contribution.source));
  const partial = { ...full, world: { ...full.world, contributions: kept } };
  const document = createWhitePaperDocument({ envelope: partial, features: FEATURE_DEFINITIONS });
  assert.equal(sectionById(document, 'contracts-ledger').status, 'live');
  assert.equal(sectionById(document, 'neural-mesh').status, 'not yet live');
  assert.equal(sectionById(document, 'rooms-people').status, 'not yet live');
  assert.equal(sectionById(document, 'features').status, 'live');
});

test('composition is deterministic and deeply frozen', () => {
  const envelope = createLivingRealityProjection();
  const first = createWhitePaperDocument({ envelope, features: FEATURE_DEFINITIONS });
  const second = createWhitePaperDocument({ envelope, features: FEATURE_DEFINITIONS });
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first.sections));
  assert.ok(first.sections.every((section) => Object.isFrozen(section)));
});

test('aggregator never touches the network and ignores the wall clock', () => {
  const envelope = createLivingRealityProjection();
  const json = JSON.stringify(createWhitePaperDocument({ envelope, features: FEATURE_DEFINITIONS }));
  assert.ok(!/fetch\(|XMLHttpRequest/.test(json), 'no network primitives in output');
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 86_400_000; // pretend a day passed
    const later = createWhitePaperDocument({ envelope, features: FEATURE_DEFINITIONS });
    const baseline = createWhitePaperDocument({ envelope, features: FEATURE_DEFINITIONS });
    Date.now = realNow;
    assert.deepEqual(later, baseline, 'composition must not depend on Date.now()');
  } finally {
    Date.now = realNow;
  }
});

// --- renderer harness (fake DOM, node-safe) ---

function makeEl(tag) {
  const el = {
    tag, children: [], dataset: {}, style: {}, textContent: '', hidden: false,
    className: '', type: '', title: '',
    setAttribute() {}, append(...nodes) { this.children.push(...nodes); return this; },
    replaceChildren(...nodes) { this.children = [...nodes]; return this; },
    addEventListener(type, handler) { this[`on_${type}`] = handler; },
    click() { this.on_click?.(); },
  };
  return el;
}

function makeHarness() {
  const els = {};
  const ids = ['white-paper-console', 'white-paper-close', 'white-paper-status', 'white-paper-document', 'white-paper-refresh', 'white-paper-boundary'];
  for (const id of ids) els[id] = makeEl('div');
  const doc = {
    getElementById: (id) => els[id] ?? null,
    createElement: (tag) => makeEl(tag),
  };
  return { doc, els };
}

test('console renders all sections and refreshes from a new envelope', () => {
  const { doc, els } = makeHarness();
  let envelope = createLivingRealityProjection();
  let features = FEATURE_DEFINITIONS;
  const selected = [];
  const whitePaper = createWhitePaperConsole({
    documentRoot: doc,
    getEnvelope: () => envelope,
    getFeatures: () => features,
    onSelect: (id, method) => selected.push([id, method]),
  });
  assert.equal(els['white-paper-document'].children.length, 6);
  assert.match(els['white-paper-status'].textContent, /6 SECTIONS · 4 LIVE/);

  // Feature rows navigate (read-only): clicking selects without mutating.
  const featureList = els['white-paper-document'].children
    .flatMap((section) => section.children)
    .find((node) => node.className === 'white-paper-feature-list');
  assert.ok(featureList && featureList.children.length > 0);
  featureList.children[0].click();
  assert.deepEqual(selected, [[FEATURE_DEFINITIONS[0].id, 'white-paper']]);

  // Refresh re-composes: degrade the envelope and features, confirm "not yet live".
  envelope = null;
  features = [];
  els['white-paper-refresh'].click();
  assert.match(els['white-paper-status'].textContent, /0 LIVE/);
  const snapshot = whitePaper.getSnapshot();
  assert.equal(snapshot.source, WHITE_PAPER_CONSOLE_SOURCE);
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.externalNetwork, false);
});

test('console open/close/replay publish snapshots', () => {
  const { doc, els } = makeHarness();
  const replays = [];
  const whitePaper = createWhitePaperConsole({
    documentRoot: doc,
    getEnvelope: () => createLivingRealityProjection(),
    getFeatures: () => FEATURE_DEFINITIONS,
    onReplay: (snapshot) => replays.push(snapshot),
  });
  const opened = whitePaper.open('button');
  assert.equal(opened.opened, true);
  assert.equal(els['white-paper-console'].hidden, false);
  const closed = whitePaper.close('button');
  assert.equal(closed.opened, false);
  assert.equal(els['white-paper-console'].hidden, true);
  whitePaper.replay('button');
  assert.equal(replays.length, 1);
  assert.equal(replays[0].action, 'replay');
});

test('console throws when mount points are missing', () => {
  assert.throws(
    () => createWhitePaperConsole({ documentRoot: { getElementById: () => null } }),
    /mount points are missing/,
  );
});

test('console boundary text is honest about read-only local simulation', () => {
  const { doc, els } = makeHarness();
  createWhitePaperConsole({ documentRoot: doc, getEnvelope: () => null, getFeatures: () => [] });
  assert.equal(els['white-paper-boundary'].textContent, WHITE_PAPER_BOUNDARY);
  assert.match(els['white-paper-boundary'].textContent, /read-only/i);
});

test('index.html mounts every white-paper console mount point', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['white-paper-console', 'white-paper-close', 'white-paper-status', 'white-paper-document', 'white-paper-refresh', 'white-paper-boundary']) {
    assert.ok(html.includes(`id="${id}"`), `index.html mounts #${id}`);
  }
  assert.ok(html.includes('paper-live.html'), 'failure banner offers the live white paper');
});
