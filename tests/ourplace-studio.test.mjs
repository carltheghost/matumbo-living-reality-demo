import test from 'node:test';
import assert from 'node:assert/strict';
import { createOurplaceStudio, OURPLACE_STUDIO_STORAGE_KEY as KEY } from '../src/domains/ourplace-studio.js';

const OWNER = 'u:alice', OTHER = 'u:bob', AT = '2026-10-03T12:00:00.000Z';
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), value: () => values.get(KEY), replace: value => values.set(KEY, value) };
}
function fixture() {
  const storage = memoryStorage(), studio = createOurplaceStudio({ storage, now: () => AT });
  const document = (overrides = {}) => studio.importDocument({ actor: OWNER, title: 'Geometry reference', text: '# Geometry\nOne meter tall.\n# Material\nBlue ceramic.', license: 'CC0', ...overrides });
  const project = (source, overrides = {}) => studio.createProject({ actor: OWNER, title: 'Small vessel', brief: 'Create a one meter blue ceramic vessel.', sourceIds: [source.id], ...overrides });
  return { storage, studio, document, project };
}
function share(f, doc) { f.studio.setAccess({ actor: OWNER, documentId: doc.id, visibility: 'shared' }); }
function done(studio, project, taskId, note = 'Human reports that the task was completed.') { return studio.updateTask({ actor: OWNER, projectId: project.id, taskId, status: 'done', note }); }

test('private sources enforce actor access on list, search, direct read and project creation', () => {
  const f = fixture(), doc = f.document();
  assert.equal(doc.visibility, 'private');
  assert.deepEqual(f.studio.listDocuments({ actor: OTHER }), []);
  assert.deepEqual(f.studio.search({ actor: OTHER, query: 'ceramic' }).results, []);
  assert.throws(() => f.studio.getDocument({ actor: OTHER, documentId: doc.id }), /access is denied/);
  assert.throws(() => f.project(doc, { actor: OTHER }), /access is denied/);
  assert.throws(() => f.studio.setAccess({ actor: OTHER, documentId: doc.id, visibility: 'shared' }), /Only the document owner/);
  assert.throws(() => f.studio.removeDocument({ actor: OTHER, documentId: doc.id }), /Only the document owner/);
  assert.throws(() => f.document({ actor: '__proto__' }), /local u:/);
  share(f, doc);
  assert.equal(f.studio.getDocument({ actor: OTHER, documentId: doc.id }).id, doc.id);
  assert.equal(f.studio.search({ actor: OTHER, query: 'ceramic' }).results.length, 1);
});

test('hierarchical folders, Markdown sections and CRLF citation coordinates refer to exact lines', () => {
  const f = fixture(), text = 'Preamble.\r\n# Geometry\r\nScale one meter.\r\n## Materials\r\nBlue ceramic.\r\nCredits retained.';
  const doc = f.document({ text, folder: 'Library/Vessels/Blue' });
  assert.deepEqual(doc.sections.map(s => [s.title, s.startLine, s.endLine]), [['Geometry reference', 1, 1], ['Geometry', 2, 3], ['Materials', 4, 6]]);
  const result = f.studio.search({ actor: OWNER, query: 'Blue ceramic', folder: 'Library/Vessels' });
  assert.equal(result.method, 'local-keyword-search');
  assert.equal(result.results.length, 1);
  const cite = result.results[0];
  assert.equal(cite.startLine, 4); assert.equal(cite.endLine, 6);
  assert.equal(cite.excerpt, text.split('\r\n').slice(cite.startLine - 1, cite.endLine).join('\n'));
  assert.equal(cite.documentId, doc.id); assert.equal(cite.sectionId, doc.sections[2].id);
  assert.equal('score' in cite, false); assert.equal('confidence' in cite, false);
  assert.deepEqual(f.studio.search({ actor: OWNER, query: 'missing' }).results, []);
  assert.deepEqual(f.studio.search({ actor: OWNER, query: '' }).results, []);
  assert.deepEqual(f.studio.search({ actor: OWNER, query: 'blue', folder: 'Library/Other' }).results, []);
});

test('code-fence headings remain inert and long source lines produce bounded exact quotations', () => {
  const f = fixture(), doc = f.document({ text: '# Reference\n```js\n# not a heading\nfetch(secret)\n```\n# Actual\nText.' });
  assert.deepEqual(doc.sections.map(s => s.title), ['Reference', 'Actual']);
  const long = f.document({ title: 'Long line', text: `${'a'.repeat(5000)}needle${'b'.repeat(5000)}` });
  const cite = f.studio.search({ actor: OWNER, query: 'needle' }).results[0];
  assert.equal(cite.startLine, 1); assert.equal(cite.endLine, 1); assert.ok(cite.excerpt.length <= 2000); assert.ok(cite.excerpt.includes('needle')); assert.ok(long.text.includes(cite.excerpt));
});

test('automatic folder rules and bounded hierarchy reject unsupported paths', () => {
  const f = fixture();
  assert.equal(f.document({ title: 'Surface studies', text: 'Texture palette.' }).folder, 'Production/Materials');
  assert.equal(f.document({ title: 'Shot studies', text: 'Camera composition.' }).folder, 'Production/Lighting');
  assert.equal(f.document({ title: 'Object', text: 'Mesh topology.' }).folder, 'Production/Geometry');
  assert.equal(f.document({ title: 'Plan', text: 'Concept brief.' }).folder, 'Production/Direction');
  assert.throws(() => f.document({ folder: 'a/../b' }), /Folder/);
  assert.throws(() => f.document({ folder: 'a/b/c/d/e/f/g' }), /Folder/);
});

test('revocation closes saved cross-instance reads and permanently blocks dependent project content', () => {
  const f = fixture(), doc = f.document(); share(f, doc);
  const ownerProject = f.project(doc), otherProject = f.project(doc, { actor: OTHER, title: 'SECRET PROJECT TITLE', brief: 'SECRET DERIVED BRIEF' });
  const second = createOurplaceStudio({ storage: f.storage, now: () => AT });
  assert.equal(second.getProject({ actor: OTHER, projectId: otherProject.id }).blocked, false);
  f.studio.setAccess({ actor: OWNER, documentId: doc.id, visibility: 'revoked' });
  assert.deepEqual(second.search({ actor: OTHER, query: 'ceramic' }).results, []);
  assert.throws(() => second.getDocument({ actor: OWNER, documentId: doc.id }), /access is denied/);
  const summary = second.listDocuments({ actor: OWNER })[0]; assert.equal(summary.blocked, true); assert.deepEqual(summary.sections, []); assert.equal('text' in summary, false);
  const blocked = second.getProject({ actor: OTHER, projectId: otherProject.id });
  assert.equal(blocked.blocked, true); assert.equal(blocked.title, 'Blocked project'); assert.doesNotMatch(JSON.stringify(blocked), /SECRET|ceramic/);
  for (const key of ['brief', 'tasks', 'citations', 'sourceIds', 'designSnapshot']) assert.equal(key in blocked, false);
  assert.throws(() => second.exportProject({ actor: OWNER, projectId: ownerProject.id }), /revoked/);
  assert.throws(() => second.updateTask({ actor: OWNER, projectId: ownerProject.id, taskId: 'director', status: 'done', note: 'Reviewed.' }), /blocked/);
  f.studio.setAccess({ actor: OWNER, documentId: doc.id, visibility: 'shared' });
  assert.equal(second.getProject({ actor: OWNER, projectId: ownerProject.id }).blocked, true);
  const fresh = f.project(doc); assert.equal(second.getProject({ actor: OWNER, projectId: fresh.id }).blocked, false);
});

test('shared-to-private access blocks other roles but retains the owner project and prevents export', () => {
  const f = fixture(), doc = f.document(); share(f, doc);
  const own = f.project(doc), other = f.project(doc, { actor: OTHER });
  f.studio.setAccess({ actor: OWNER, documentId: doc.id, visibility: 'private' });
  assert.equal(f.studio.getProject({ actor: OWNER, projectId: own.id }).blocked, false);
  assert.equal(f.studio.getProject({ actor: OTHER, projectId: other.id }).blocked, true);
  assert.throws(() => f.studio.exportProject({ actor: OWNER, projectId: own.id }), /explicitly shared/);
});

test('deletion leaves blocked safe metadata after restore and never reuses a document ID', () => {
  const f = fixture(), doc = f.document(), project = f.project(doc);
  f.studio.removeDocument({ actor: OWNER, documentId: doc.id });
  const restored = createOurplaceStudio({ storage: f.storage, now: () => AT });
  assert.equal(restored.warning, null); assert.deepEqual(restored.listDocuments({ actor: OWNER }), []);
  assert.equal(restored.getProject({ actor: OWNER, projectId: project.id }).blocked, true);
  assert.throws(() => restored.exportProject({ actor: OWNER, projectId: project.id }), /removed/);
  assert.notEqual(f.document().id, doc.id);
});

test('production tasks enforce the parallel materials/modeling stage and report no verified execution or payout', () => {
  const f = fixture(), doc = f.document(), project = f.project(doc);
  assert.deepEqual(project.tasks.map(task => [task.id, task.dependencies]), [['director', []], ['modeling', ['director']], ['materials', ['director']], ['lighting', ['modeling', 'materials']], ['review', ['lighting']]]);
  assert.throws(() => done(f.studio, project, 'modeling'), /prerequisite/);
  assert.throws(() => done(f.studio, project, 'director', ''), /completion note/);
  done(f.studio, project, 'director'); done(f.studio, project, 'materials');
  assert.throws(() => done(f.studio, project, 'lighting'), /prerequisite/);
  done(f.studio, project, 'modeling'); done(f.studio, project, 'lighting');
  const complete = done(f.studio, project, 'review');
  assert.equal(complete.status, 'user-reported-complete');
  assert.ok(complete.tasks.every(task => task.completionEvidence === 'user-reported' && task.reportedAt === AT));
  assert.equal(complete.aiExecuted, false); assert.equal(complete.blenderExecuted, false); assert.equal(complete.payoutAuthorized, false);
  assert.throws(() => f.studio.updateTask({ actor: OWNER, projectId: project.id, taskId: 'director', status: 'planned' }), /Reopen dependent/);
  assert.throws(() => f.studio.updateTask({ actor: OWNER, projectId: project.id, taskId: 'review', status: 'verified' }), /task status/);
  for (const id of ['review', 'lighting', 'materials', 'modeling', 'director']) f.studio.updateTask({ actor: OWNER, projectId: project.id, taskId: id, status: 'planned' });
  assert.equal(f.studio.getProject({ actor: OWNER, projectId: project.id }).status, 'planned');
  assert.equal(f.studio.listProjects({ actor: OTHER }).length, 0);
  assert.throws(() => f.studio.getProject({ actor: OTHER, projectId: project.id }), /access is denied/);
});

test('projects persist source IDs only and derive fresh citations after restore', () => {
  const f = fixture(), doc = f.document(), project = f.project(doc), saved = JSON.parse(f.storage.value());
  assert.deepEqual(saved.projects[0].sourceIds, [doc.id]);
  assert.equal('citations' in saved.projects[0], false); assert.equal('sources' in saved.projects[0], false);
  assert.deepEqual(createOurplaceStudio({ storage: f.storage, now: () => AT }).getProject({ actor: OWNER, projectId: project.id }), project);
  // A same-browser record edit is not authenticated; readers still derive from the current text.
  saved.documents[0].text = '# Updated\nCurrent citation text.'; f.storage.replace(JSON.stringify(saved));
  const current = f.studio.getProject({ actor: OWNER, projectId: project.id });
  assert.match(current.citations[0].excerpt, /Current citation/); assert.doesNotMatch(JSON.stringify(current.citations), /ceramic/);
});

test('share export requires explicit source access, licenses and original CC-BY credit', () => {
  const f = fixture(), privateSource = f.document(), privateProject = f.project(privateSource);
  assert.throws(() => f.studio.exportProject({ actor: OWNER, projectId: privateProject.id }), /explicitly shared/);
  for (const license of ['unspecified', 'restricted']) {
    const doc = f.document({ license }); share(f, doc); const project = f.project(doc);
    assert.throws(() => f.studio.exportProject({ actor: OWNER, projectId: project.id }), /CC0 or CC-BY/);
  }
  assert.throws(() => f.document({ license: 'CC-BY' }), /attribution/);
  const credited = f.document({ license: 'CC-BY', attribution: 'Original artist, reference guide, CC BY 4.0', origin: 'https://example.org/reference', text: '# First\nIntro\n# Second\nMore\n# Third\nKeep this late section.' }); share(f, credited);
  const project = f.project(credited), packet = f.studio.exportProject({ actor: OWNER, projectId: project.id });
  assert.equal(packet.kind, 'ourplace-production-plan'); assert.equal(packet.references.length, 1);
  assert.equal(packet.references[0].sections.length, 3); assert.match(packet.references[0].sections[2].text, /late section/);
  assert.equal(packet.references[0].attribution, credited.attribution); assert.equal(packet.references[0].licenseEvidence, 'importer-declared');
  assert.equal(packet.project.citations[0].attribution, credited.attribution);
  assert.equal(packet.boundary.executionPerformed, false); assert.equal(packet.boundary.payoutAuthorized, false); assert.equal(packet.boundary.completionEvidence, 'user-reported-only');
  assert.deepEqual(JSON.parse(JSON.stringify(packet)), packet);
});

test('design snapshots preserve allowed inert metadata and reject executable fields and ambiguous export provenance', () => {
  const f = fixture(), doc = f.document(); share(f, doc);
  const fresh = f.project(doc, { designSnapshot: { descriptor: { palette: { accent: '#abcdef' }, objects: [{ id: 'bowl', kind: 'surface', label: 'Bowl', shape: 'sphere' }] }, provenance: { kind: 'fresh' } } });
  const packet = f.studio.exportProject({ actor: OWNER, projectId: fresh.id });
  assert.equal(packet.project.designSnapshot.descriptor.objects[0].shape, 'sphere');
  assert.throws(() => f.project(doc, { designSnapshot: { descriptor: { code: 'fetch(secret)' }, provenance: { kind: 'fresh' } } }), /Unsupported descriptor/);
  assert.throws(() => f.project(doc, { designSnapshot: { descriptor: {}, provenance: { kind: 'fresh' }, payoutAuthorized: true } }), /Unsupported design snapshot/);
  for (const provenance of [{ kind: 'legacy-unverified' }, { kind: 'local-design', rootKey: 'example@1' }, { kind: 'shared-package', rootKey: 'example@1', packetHash: 'a'.repeat(64), attribution: [{ key: 'example@1', creator: OWNER, license: 'attribution-sharealike' }] }]) {
    const project = f.project(doc, { designSnapshot: { descriptor: {}, provenance } });
    assert.deepEqual(project.designSnapshot.provenance, provenance);
    assert.throws(() => f.studio.exportProject({ actor: OWNER, projectId: project.id }), /cannot relicense/);
  }
});

test('returned documents, projects and packets are detached from internal state', () => {
  const f = fixture(), doc = f.document(); share(f, doc);
  const project = f.project(doc), packet = f.studio.exportProject({ actor: OWNER, projectId: project.id });
  doc.sections[0].text = 'tampered'; project.tasks[0].status = 'done'; project.sourceIds.length = 0; packet.references[0].sections[0].text = 'tampered';
  assert.match(f.studio.getDocument({ actor: OWNER, documentId: doc.id }).sections[0].text, /one meter/i);
  const read = f.studio.getProject({ actor: OWNER, projectId: project.id }); assert.equal(read.tasks[0].status, 'planned'); assert.equal(read.sourceIds.length, 1);
});

test('invalid or oversized restored state fails closed, warns and is never overwritten', () => {
  for (const corrupt of ['{', JSON.stringify({ schemaVersion: 999 }), 'x'.repeat(3500001)]) {
    const storage = memoryStorage(); storage.replace(corrupt); const studio = createOurplaceStudio({ storage, now: () => AT });
    assert.match(studio.warning, /not loaded/); assert.deepEqual(studio.listDocuments({ actor: OWNER }), []); assert.deepEqual(studio.listProjects({ actor: OWNER }), []);
    assert.throws(() => studio.importDocument({ actor: OWNER, title: 'New', text: 'New' }), /not been overwritten/); assert.equal(storage.value(), corrupt);
  }
});

test('restored field injection, malformed snapshot, forged task completion and identifier tampering are rejected', () => {
  const f = fixture(), doc = f.document(); f.project(doc); const base = JSON.parse(f.storage.value());
  const corruptions = [
    state => { state.moneyAuthorized = true; },
    state => { state.documents[0].__proto__ = { hacked: true }; state.documents[0].execute = 'code'; },
    state => { delete state.projects[0].designSnapshot; },
    state => { state.projects[0].designSnapshot = { descriptor: {}, provenance: { kind: 'fresh', authority: 'execute' } }; },
    state => { state.projects[0].tasks[1] = { id: 'modeling', status: 'done', note: 'Forged', reportedAt: AT }; },
    state => { state.documents.push({ ...state.documents[0] }); },
    state => { state.nextId = 1; },
    state => { state.projects[0].invalidated = 'false'; },
  ];
  for (const corrupt of corruptions) {
    const state = structuredClone(base); corrupt(state); f.storage.replace(JSON.stringify(state));
    const restored = createOurplaceStudio({ storage: f.storage, now: () => AT });
    assert.match(restored.warning, /not loaded/); assert.deepEqual(restored.listDocuments({ actor: OWNER }), []); assert.deepEqual(restored.listProjects({ actor: OWNER }), []);
  }
});

test('storage read failure closes stale content and write failure does not report a completed import', () => {
  const f = fixture(), doc = f.document(); share(f, doc);
  const get = f.storage.getItem; f.storage.getItem = () => { throw Error('Storage disabled'); };
  assert.deepEqual(f.studio.search({ actor: OWNER, query: 'ceramic' }).results, []); assert.match(f.studio.warning, /unavailable/);
  assert.throws(() => f.studio.getDocument({ actor: OWNER, documentId: doc.id }), /access is denied/);
  f.storage.getItem = get;
  const before = f.storage.value(); f.storage.setItem = () => { throw Error('QuotaExceededError'); };
  assert.throws(() => f.document({ title: 'Unsaved' }), /change was not saved/); assert.equal(f.storage.value(), before);
  assert.equal(f.studio.listDocuments({ actor: OWNER }).length, 1);
});

test('plain UTF-8 import rejects binary controls, malformed Unicode, nonstrings and excess characters', () => {
  const f = fixture();
  for (const text of ['binary\0payload', '\ud800broken', 'broken\udfff', new Uint8Array([1, 2]), 'x'.repeat(100001), '   ']) assert.throws(() => f.document({ text }));
  assert.equal(f.document({ title: 'Unicode', text: 'Café, 材質, 🎨\n\tPlain text.' }).text, 'Café, 材質, 🎨\n\tPlain text.');
  assert.throws(() => f.document({ execute: true }), /Unsupported document import/);
  assert.throws(() => f.document({ license: 'CC-BY-SA' }), /license/);
});

test('document, aggregate-text, project and retrieval limits are enforced', () => {
  const documentFixture = fixture();
  for (let i = 0; i < 60; i++) documentFixture.document({ title: `Small ${i}`, text: 'Find me.' });
  assert.throws(() => documentFixture.document(), /60 documents/);
  assert.equal(documentFixture.studio.search({ actor: OWNER, query: 'Find' }).results.length, 40);
  const totalFixture = fixture();
  for (let i = 0; i < 10; i++) totalFixture.document({ text: 'x'.repeat(100000) });
  assert.throws(() => totalFixture.document({ text: 'x' }), /1000000/);
  const projectFixture = fixture(), doc = projectFixture.document();
  for (let i = 0; i < 30; i++) projectFixture.project(doc);
  assert.throws(() => projectFixture.project(doc), /30 projects/);
  assert.throws(() => projectFixture.project(doc, { sourceIds: [] }), /1–8/);
  assert.throws(() => projectFixture.project(doc, { sourceIds: [doc.id, doc.id] }), /unique/);
});

test('explicit memory-only operation is honest about persistence and grants no external capabilities', () => {
  const studio = createOurplaceStudio({ storage: null, now: () => AT });
  assert.match(studio.warning, /persistence is disabled/);
  const doc = studio.importDocument({ actor: OWNER, title: 'Local', text: 'In-memory source.' });
  assert.equal(studio.getDocument({ actor: OWNER, documentId: doc.id }).title, 'Local');
  for (const forbidden of ['execute', 'runAgent', 'runBlender', 'pay', 'reward', 'fetch', 'publish']) assert.equal(forbidden in studio, false);
});
