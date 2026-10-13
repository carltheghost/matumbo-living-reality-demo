import test from 'node:test';
import assert from 'node:assert/strict';
import { createEye, createPhoneSnapshot } from '../engine.mjs';
import {
  COMPANION_CHARACTERS,
  CONVERSATION_PROVIDER_SCHEMA,
  companionPersistenceTone,
  buildPlacementRequest,
  formatCompanionPlacementStatus,
  isPlaced,
  normalizeConversationResult,
  placementTarget,
  readConversationProvider,
} from '../companion.mjs';

function makeEnvelope({ spaceId = 'root', dimension = 4 } = {}) {
  const snapshot = createPhoneSnapshot({ worldId: 'companion-world', rootDimension: 4 });
  const eye = createEye({ id: `eye-${spaceId}`, spaceId, dimension });
  return { snapshot, eyes: { [eye.id]: eye }, currentEyeId: eye.id, branchId: 'branch-companion', mode: 'local' };
}

test('companion roster is the existing world identity set', () => {
  assert.deepEqual(COMPANION_CHARACTERS.map(character => character.entityId), ['relic', 'workpiece', 'portal']);
  assert.deepEqual(placementTarget('workpiece'), [0, 0.5, 0.25, 0]);
  assert.deepEqual(placementTarget('portal', 6), [0.66, 0.06, 0.25, -0.12, 0, 0]);
});

test('each existing identity carries a distinct embodied silhouette and presence state', () => {
  assert.deepEqual(COMPANION_CHARACTERS.map(character => character.silhouette), ['sentinel', 'maker', 'wayfinder']);
  for (const character of COMPANION_CHARACTERS) {
    assert.match(character.idlePresence, /[A-Z]/);
    assert.match(character.attentionPresence, /[A-Z]/);
    assert.match(character.reactionPresence, /[A-Z]/);
  }
});

test('placement request stays scoped to the active root Eye and full-dimensional CAS', () => {
  const envelope = makeEnvelope();
  const request = buildPlacementRequest(envelope, 'workpiece');

  assert.equal(request.ok, true);
  assert.equal(request.schema, 'vivo.companion/1');
  assert.equal(request.worldId, 'companion-world');
  assert.equal(request.branchId, 'branch-companion');
  assert.equal(request.eyeId, 'eye-root');
  assert.equal(request.spaceId, 'root');
  assert.equal(request.entityId, 'workpiece');
  assert.equal(request.dimension, 4);
  assert.deepEqual(request.target, [0, 0.5, 0.25, 0]);
  assert.equal(request.expected.baseRevision, 0);
  assert.equal(request.delta.length, 4);

  const nested = buildPlacementRequest(makeEnvelope({ spaceId: 'inner', dimension: 11 }), 'portal');
  assert.equal(nested.ok, false);
  assert.equal(nested.code, 'COMPANION_ROOT_EYE_REQUIRED');
});

test('placement recovery distinguishes the original position from a saved move', () => {
  const envelope = makeEnvelope();
  const entity = envelope.snapshot.spaces.root.entities.relic;
  assert.equal(isPlaced(entity, 'relic'), false);
  entity.q[0] = -0.66;
  entity.q[1] = 0.06;
  assert.equal(isPlaced(entity, 'relic'), true);
});

test('placement copy follows the same persistence acknowledgement as the badge', () => {
  const saved = formatCompanionPlacementStatus('Inner world', { state: 'saved' });
  const pending = formatCompanionPlacementStatus('Inner world', { state: 'saved' }, { pending: true });
  const saving = formatCompanionPlacementStatus('Inner world', { state: 'saving' });
  const failed = formatCompanionPlacementStatus('Inner world', { state: 'unsaved', error: 'QuotaExceededError' });
  assert.match(saved, /saved locally/);
  assert.doesNotMatch(pending, /saved locally/);
  assert.match(pending, /Waiting for the local save acknowledgement/);
  assert.doesNotMatch(saving, /saved locally/);
  assert.match(saving, /Waiting for the local save acknowledgement/);
  assert.match(failed, /was not saved: QuotaExceededError/);
  assert.equal(companionPersistenceTone({ state: 'saved' }), 'success');
  assert.equal(companionPersistenceTone({ state: 'saved' }, { pending: true }), 'info');
  assert.equal(companionPersistenceTone({ state: 'saving' }), 'info');
  assert.equal(companionPersistenceTone({ state: 'unsaved' }), 'warn');
});

test('conversation seam accepts only a configured provider and readable result', () => {
  assert.equal(readConversationProvider({}), null);
  const provider = { schema: CONVERSATION_PROVIDER_SCHEMA, respond() {} };
  assert.equal(readConversationProvider({ VivoConversationProvider: provider }), provider);
  assert.equal(readConversationProvider({ VivoConversationProvider: { ...provider, available: false } }), null);
  assert.deepEqual(normalizeConversationResult({ text: '  hello  ', reaction: '  pulse  ' }), { text: 'hello', reaction: 'pulse' });
  assert.deepEqual(normalizeConversationResult('plain response'), { text: 'plain response', reaction: null });
  assert.deepEqual(normalizeConversationResult({ text: 'unknown reaction is ignored', reaction: 'launch-world-command' }), { text: 'unknown reaction is ignored', reaction: null });
  assert.equal(normalizeConversationResult({ text: '   ' }), null);
  assert.equal(normalizeConversationResult({ text: 42 }), null);
});
