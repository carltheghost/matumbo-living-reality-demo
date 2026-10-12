import test from 'node:test';
import assert from 'node:assert/strict';
import { createEye, createPhoneSnapshot, LocalVivoEngine } from '../engine.mjs';
import {
  FIELD_WORLD_SCHEMA,
  FieldWorldController,
  buildFieldWorld,
  inspectAcceptedEvents,
} from '../field-world.mjs';

class MemoryStore {
  rows = new Map();
  async load(id) { return structuredClone(this.rows.get(id) || null); }
  async save(id, value) { this.rows.set(id, structuredClone(value)); return { persistent: true }; }
}

function envelope(rootDimension = 11) {
  const snapshot = createPhoneSnapshot({ worldId: 'field-world-test', rootDimension });
  const eye = createEye({ id: 'field-eye', spaceId: 'root', dimension: rootDimension });
  return {
    snapshot,
    eyes: { [eye.id]: eye },
    currentEyeId: eye.id,
    branchId: 'branch-field-test',
    mode: 'local',
    parentBranchId: null,
    branchLabel: null,
    forkedAt: null,
  };
}

test('field-world builds a bounded analytic plane atlas for every 3D..11D space', () => {
  for (let dimension = 3; dimension <= 11; dimension++) {
    const model = buildFieldWorld(envelope(dimension), {
      query: 'relic',
      relevanceThreshold: 0.18,
      eyeAxes: [0, 1, dimension - 1],
      atlasResolution: 99,
      layout: 'ring',
      selectedId: 'relic',
    });
    assert.equal(model.schema, FIELD_WORLD_SCHEMA);
    assert.equal(model.dimension, dimension);
    assert.equal(model.atlas.length, dimension * (dimension - 1) / 2);
    assert.ok(model.atlas.every(plane => plane.resolution === 12));
    assert.ok(model.atlas.every(plane => plane.cells.length === 144));
    assert.deepEqual(model.eye.axes, dimension >= 3 ? [0, 1, dimension - 1] : [0, 1, 2]);
    assert.ok(model.awakeIds.includes('relic'));
    assert.equal(model.field.kind, 'analytic-information-mixture');
    assert.equal(model.field.materialAuthority, 'phone-local-view-only');
    assert.deepEqual(model.layout.mode, 'ring');
  }
});

test('field-world relevance and layout changes are view-only and accepted history is inspectable', () => {
  const initial = envelope(4);
  const controller = new FieldWorldController(initial, { query: 'workpiece', layout: 'row' });
  const before = structuredClone(initial);
  const first = controller.model;
  assert.equal(first.layout.mode, 'row');
  assert.ok(first.awakeIds.includes('workpiece'));
  assert.equal(inspectAcceptedEvents(initial).branchId, 'branch-field-test');
  controller.setOptions({ query: 'portal', layout: 'gather', selectedId: 'portal' });
  assert.equal(controller.model.layout.mode, 'gather');
  assert.ok(controller.model.awakeIds.includes('portal'));
  assert.deepEqual(initial, before);
  assert.equal(controller.commitCandidate(), null);
});

test('field preview identity is invalidated by discard, retarget and world changes', () => {
  const initial = envelope(4);
  const controller = new FieldWorldController(initial, { selectedId: 'relic' });
  const candidate = controller.previewMove('relic', 0, 0.14);
  assert.equal(controller.isCurrent(candidate), true);
  controller.discardPreview();
  assert.equal(controller.isCurrent(candidate), false);
  const replacement = controller.previewMove('relic', 0, 0.2);
  const retargeted = structuredClone(initial);
  retargeted.currentEyeId = Object.keys(retargeted.eyes)[0];
  retargeted.branchId = 'another-branch';
  controller.refresh(retargeted);
  assert.equal(controller.isCurrent(replacement), false);
  assert.equal(controller.commitCandidate(), null);
});

test('a newer same-object preview is rebased after an older Apply completes', () => {
  const initial = envelope(4);
  const controller = new FieldWorldController(initial, { selectedId: 'relic' });
  const first = controller.previewMove('relic', 0, 0.14);
  const newer = controller.previewMove('relic', 0, 0.14);
  const accepted = structuredClone(initial);
  const relic = accepted.snapshot.spaces.root.entities.relic;
  relic.q[0] += first.delta[0];
  relic.revision = first.baseRevision + 1;

  controller.refresh(accepted, { pendingApplies: [{ candidate: first }] });
  assert.equal(controller.commitCandidate().operationId, newer.operationId);
  assert.equal(controller.commitCandidate().baseRevision, first.baseRevision);

  controller.refresh(accepted, { completedApply: { candidate: first, result: { changed: true, revision: relic.revision } } });
  const rebased = controller.commitCandidate();
  assert.equal(rebased.operationId, newer.operationId);
  assert.equal(rebased.baseRevision, relic.revision);
  assert.ok(Math.abs(rebased.q[0] - (relic.q[0] + (newer.q[0] - first.q[0]))) < 1e-12);
  assert.ok(Math.abs(controller.entity('relic').q[0] - rebased.q[0]) < 1e-12);

  relic.q[0] += 0.02;
  relic.revision++;
  controller.refresh(accepted);
  const tracked = controller.commitCandidate();
  assert.equal(tracked.baseRevision, relic.revision);
  assert.ok(Math.abs(tracked.q[0] - (relic.q[0] + (newer.q[0] - first.q[0]))) < 1e-12);
});

test('a stale preflight can rebase newer intent without mutating accepted state', () => {
  const initial = envelope(4);
  const controller = new FieldWorldController(initial, { selectedId: 'relic' });
  const first = controller.previewMove('relic', 0, 0.14);
  const newer = controller.previewMove('relic', 0, 0.14);
  const accepted = structuredClone(initial);
  const relic = accepted.snapshot.spaces.root.entities.relic;
  relic.q[0] += first.delta[0];
  relic.revision = first.baseRevision + 1;

  controller.refresh(accepted, { pendingApplies: [{ candidate: first }] });
  const rebased = controller.rebaseCandidate(newer, accepted);
  assert.equal(rebased.operationId, newer.operationId);
  assert.equal(rebased.baseRevision, relic.revision);
  assert.ok(Math.abs(rebased.delta[0] - newer.intentDelta[0]) < 1e-12);
  assert.ok(Math.abs(rebased.q[0] - (relic.q[0] + newer.intentDelta[0])) < 1e-12);
  assert.ok(Math.abs(accepted.snapshot.spaces.root.entities.relic.q[0] - (-1.15 + first.delta[0])) < 1e-12);
});

test('a preview created after the accepted state stays fenced through later solver revisions', () => {
  const initial = envelope(4);
  const controller = new FieldWorldController(initial, { selectedId: 'relic' });
  const first = controller.previewMove('relic', 0, 0.14);
  const accepted = structuredClone(initial);
  const relic = accepted.snapshot.spaces.root.entities.relic;
  relic.q[0] += first.delta[0];
  relic.revision = 1;
  controller.refresh(accepted, { pendingApplies: [{ candidate: first }] });
  assert.equal(controller.commitCandidate(), null);

  const newer = controller.previewMove('relic', 0, 0.14);
  controller.refresh(accepted, {
    pendingApplies: [{ candidate: first }],
    completedApply: { candidate: first, result: { changed: true, revision: relic.revision } },
  });
  assert.equal(controller.commitCandidate().operationId, newer.operationId);
  relic.q[0] += 0.02;
  relic.revision++;
  controller.refresh(accepted);
  const tracked = controller.commitCandidate();
  assert.equal(tracked.baseRevision, relic.revision);
  assert.ok(Math.abs(tracked.q[0] - (relic.q[0] + newer.delta[0])) < 1e-12);
});

test('field-world move, mix and turn previews require explicit local application', () => {
  const state = envelope(4);
  const controller = new FieldWorldController(state, { selectedId: 'relic' });
  const move = controller.previewMove('relic', 2, 0.35);
  assert.equal(move.kind, 'move');
  assert.equal(move.delta[2], 0.35);
  assert.equal(controller.commitCandidate().baseRevision, 0);
  controller.discardPreview();
  const mix = controller.previewMix('relic');
  assert.equal(mix.kind, 'mix');
  assert.ok(mix.mixWith);
  controller.discardPreview();
  const turn = controller.previewRotate('relic', Math.PI / 8);
  assert.equal(turn.kind, 'rotate-view');
  assert.deepEqual(turn.delta, [0, 0, 0, 0]);
  assert.deepEqual(state.snapshot.spaces.root.entities.relic.q, [-1.15, -0.1, 0.25, 0]);
});

test('repeated move previews accumulate against the unchanged local base', () => {
  const controller = new FieldWorldController(envelope(4), { selectedId: 'relic' });
  const first = controller.previewMove('relic', 0, 0.14);
  const second = controller.previewMove('relic', 0, 0.14);
  assert.ok(Math.abs(first.delta[0] - 0.14) < 1e-12);
  assert.ok(Math.abs(second.delta[0] - 0.28) < 1e-12);
  assert.ok(Math.abs(second.q[0] - (-1.15 + 0.28)) < 1e-12);
  assert.ok(Math.abs(controller.commitCandidate().delta[0] - 0.28) < 1e-12);
});

test('composable mix previews always report delta from immutable base coordinates', () => {
  const controller = new FieldWorldController(envelope(4), { selectedId: 'relic' });
  const moved = controller.previewMove('relic', 0, 0.14);
  const mixedAfterMove = controller.previewMix('relic');
  assert.equal(mixedAfterMove.baseQ[0], -1.15);
  assert.notEqual(mixedAfterMove.q[0], moved.q[0]);
  assert.equal(mixedAfterMove.delta[0], mixedAfterMove.q[0] - mixedAfterMove.baseQ[0]);
  const mixedAgain = controller.previewMix('relic');
  assert.notEqual(mixedAgain.q[0], mixedAfterMove.q[0]);
  assert.equal(mixedAgain.delta[0], mixedAgain.q[0] - mixedAgain.baseQ[0]);
});

test('field preview operation identity is fresh after persisted reload and duplicate apply remains idempotent', async () => {
  const store = new MemoryStore();
  const firstEngine = new LocalVivoEngine({ storage: store });
  await firstEngine.open('field-preview-reload');
  const firstController = new FieldWorldController(await firstEngine.snapshot(), { selectedId: 'relic' });
  const first = firstController.previewMove('relic', 0, 0.14);
  const apply = (engine, candidate) => engine.applyLocalEdit(candidate.entityId, candidate.delta, {
    worldId: candidate.worldId,
    branchId: candidate.branchId,
    eyeId: candidate.eyeId,
    spaceId: candidate.spaceId,
    entityId: candidate.entityId,
    baseRevision: candidate.baseRevision,
    operationId: candidate.operationId,
  });
  await apply(firstEngine, first);
  await firstEngine.close();

  const reloaded = new LocalVivoEngine({ storage: store });
  await reloaded.open('field-preview-reload');
  const secondController = new FieldWorldController(await reloaded.snapshot(), { selectedId: 'relic' });
  const second = secondController.previewMove('relic', 0, 0.14);
  assert.notEqual(second.operationId, first.operationId);
  const accepted = await apply(reloaded, second);
  assert.deepEqual(accepted, { changed: true, revision: 2 });
  const replay = await apply(reloaded, second);
  assert.equal(replay.replayed, true);
  assert.equal((await reloaded.snapshot()).snapshot.spaces.root.entities.relic.revision, 2);
  await reloaded.close();
});

test('local field application advances only the selected local object and preserves stable identity', async () => {
  const engine = new LocalVivoEngine({ storage: new MemoryStore() });
  await engine.open('field-engine-test', 4);
  const before = await engine.snapshot();
  const q = before.snapshot.spaces.root.entities.relic.q;
  const result = await engine.applyLocalEdit('relic', [0, 0.2, 0, 0]);
  const after = await engine.snapshot();
  assert.deepEqual(result, { changed: true, revision: 1 });
  assert.equal(after.snapshot.spaces.root.entities.relic.id, 'relic');
  assert.equal(after.snapshot.spaces.root.entities.relic.q[1], q[1] + 0.2);
  assert.deepEqual(after.snapshot.spaces.root.entities.workpiece.q, before.snapshot.spaces.root.entities.workpiece.q);
  assert.equal(after.snapshot.spaces.root.entities.relic.v[1], 0);
  await engine.close();
});
