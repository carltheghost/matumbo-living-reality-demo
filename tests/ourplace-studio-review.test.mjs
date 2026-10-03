import test from 'node:test';
import assert from 'node:assert/strict';
import { createOurplaceStudio, OURPLACE_STUDIO_STORAGE_KEY } from '../src/domains/ourplace-studio.js';
import { DEFAULT_DESIGN_DESCRIPTOR } from '../src/domains/creator-economy.js?v=20261003-complete8';

function fixture() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const owner = createOurplaceStudio({ storage });
  const reader = createOurplaceStudio({ storage });
  const source = owner.importDocument({ actor: 'u:alice', title: 'Source', text: '# Private evidence\nsecret-cobalt material recipe', license: 'CC0' });
  const share = () => owner.setAccess({ actor: 'u:alice', documentId: source.id, visibility: 'shared' });
  const createProject = (designSnapshot = null) => reader.createProject({ actor: 'u:bob', title: 'Confidential plan', brief: 'brief-secret-cobalt', sourceIds: [source.id], designSnapshot });
  const editSaved = edit => {
    const saved = JSON.parse(storage.getItem(OURPLACE_STUDIO_STORAGE_KEY));
    edit(saved);
    storage.setItem(OURPLACE_STUDIO_STORAGE_KEY, JSON.stringify(saved));
  };
  return { storage, owner, reader, source, share, createProject, editSaved };
}

test('review: private source cannot leak through another instance search, read, or project creation', () => {
  const f = fixture();
  assert.deepEqual(f.reader.search({ actor: 'u:bob', query: 'secret-cobalt' }).results, []);
  assert.deepEqual(f.reader.listDocuments({ actor: 'u:bob' }), []);
  assert.throws(() => f.reader.getDocument({ actor: 'u:bob', documentId: f.source.id }), { code: 'STUDIO_ACCESS_DENIED' });
  assert.throws(() => f.createProject(), { code: 'STUDIO_ACCESS_DENIED' });
  f.share();
  assert.equal(f.reader.search({ actor: 'u:bob', query: 'secret-cobalt' }).results.length, 1);
});

test('review: revocation immediately hides project content across instances and resharing cannot revive it', () => {
  const f = fixture(); f.share();
  const project = f.createProject();
  assert.match(JSON.stringify(project), /secret-cobalt/);
  f.owner.setAccess({ actor: 'u:alice', documentId: f.source.id, visibility: 'revoked' });
  assert.deepEqual(f.reader.search({ actor: 'u:bob', query: 'secret-cobalt' }).results, []);
  const blocked = f.reader.getProject({ actor: 'u:bob', projectId: project.id });
  assert.equal(blocked.blocked, true);
  assert.doesNotMatch(JSON.stringify(blocked), /secret-cobalt|Confidential plan/);
  assert.throws(() => f.reader.exportProject({ actor: 'u:bob', projectId: project.id }), { code: 'STUDIO_EXPORT_BLOCKED' });
  f.share();
  assert.equal(f.reader.getProject({ actor: 'u:bob', projectId: project.id }).blocked, true);
});

test('review: deletion invalidates existing projects and an exported receipt has no execution authority', () => {
  const f = fixture(); f.share();
  const project = f.createProject();
  const packet = f.reader.exportProject({ actor: 'u:bob', projectId: project.id });
  assert.equal(packet.boundary.executionPerformed, false);
  assert.equal(packet.boundary.aiExecuted, false);
  assert.equal(packet.boundary.payoutAuthorized, false);
  f.owner.removeDocument({ actor: 'u:alice', documentId: f.source.id });
  assert.equal(f.reader.listProjects({ actor: 'u:bob' })[0].blocked, true);
  assert.throws(() => f.reader.exportProject({ actor: 'u:bob', projectId: project.id }), { code: 'STUDIO_EXPORT_BLOCKED' });
});

test('review: restored projects missing a required snapshot field fail closed without throwing during listing', () => {
  const f = fixture(); f.share(); f.createProject();
  f.editSaved(saved => { delete saved.projects[0].designSnapshot; });
  const before = f.storage.getItem(OURPLACE_STUDIO_STORAGE_KEY);
  const restored = createOurplaceStudio({ storage: f.storage });
  assert.match(restored.warning ?? '', /not loaded|closed/i);
  assert.deepEqual(restored.listProjects({ actor: 'u:bob' }), []);
  assert.equal(f.storage.getItem(OURPLACE_STUDIO_STORAGE_KEY), before);
});

test('review: unknown authority-bearing snapshot provenance cannot survive persistence restoration', () => {
  const f = fixture(); f.share();
  f.createProject({ descriptor: DEFAULT_DESIGN_DESCRIPTOR, provenance: { kind: 'fresh' } });
  f.editSaved(saved => { saved.projects[0].designSnapshot.provenance.executionApproved = true; });
  const restored = createOurplaceStudio({ storage: f.storage });
  assert.match(restored.warning ?? '', /not loaded|closed/i);
  assert.deepEqual(restored.listProjects({ actor: 'u:bob' }), []);
});

test('review: imported or unverified design lineage cannot be exported as a newly licensed plan', () => {
  for (const provenance of [{ kind: 'legacy-unverified' }, { kind: 'local-design', rootKey: 'original@1' }]) {
    const f = fixture(); f.share();
    const project = f.createProject({ descriptor: DEFAULT_DESIGN_DESCRIPTOR, provenance });
    assert.throws(() => f.reader.exportProject({ actor: 'u:bob', projectId: project.id }), { code: 'STUDIO_EXPORT_DESIGN_LICENSE' });
  }
});

test('review: oversized saved data blocks mutations and preserves the original saved bytes', () => {
  const f = fixture();
  const raw = ' '.repeat(3_500_001);
  f.storage.setItem(OURPLACE_STUDIO_STORAGE_KEY, raw);
  assert.deepEqual(f.reader.listDocuments({ actor: 'u:bob' }), []);
  assert.match(f.reader.warning ?? '', /size limit/);
  assert.throws(() => f.owner.importDocument({ actor: 'u:alice', title: 'New', text: 'A' }), { code: 'STUDIO_STORAGE_BLOCKED' });
  assert.equal(f.storage.getItem(OURPLACE_STUDIO_STORAGE_KEY), raw);
});

test('review: malformed persistence diagnostics never disclose source bytes', () => {
  const f = fixture();
  f.storage.setItem(OURPLACE_STUDIO_STORAGE_KEY, 'secret-cobalt invalid JSON');
  assert.deepEqual(f.reader.listDocuments({ actor: 'u:bob' }), []);
  assert.doesNotMatch(f.reader.warning, /secret-cobalt/);
  assert.throws(() => f.reader.importDocument({actor:'u:bob',title:'New',text:'New'}), {code:'STUDIO_STORAGE_BLOCKED'});
  assert.equal(f.storage.getItem(OURPLACE_STUDIO_STORAGE_KEY), 'secret-cobalt invalid JSON');
});
