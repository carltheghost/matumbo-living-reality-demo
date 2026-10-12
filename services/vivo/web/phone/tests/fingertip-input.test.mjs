import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHONE_FINGER_IDS,
  PHONE_FINGERTIP_LANDMARKS,
  mapFingertipLandmarks,
  mapHandsToFingertips,
} from '../fingertip-input.mjs';

function landmarks(offset = 0) {
  return Array.from({ length: 21 }, (_, index) => [offset + index * 3, offset + index * 2]);
}

test('maps one synthetic 21-landmark hand to five stable independent finger identities', () => {
  const result = mapFingertipLandmarks({ handId: 'left-hand', landmarks: landmarks(10), sessionId: 'synthetic', generation: 7 });
  assert.deepEqual(result.map(item => item.fingerId), PHONE_FINGER_IDS);
  assert.deepEqual(result.map(item => item.landmarkIndex), PHONE_FINGER_IDS.map(id => PHONE_FINGERTIP_LANDMARKS[id]));
  assert.equal(new Set(result.map(item => item.contactId)).size, 5);
  assert.equal(result[1].source.sourceId, 'left-hand:index');
  assert.equal(result[1].source.parentSourceId, 'left-hand');
  assert.equal(result[1].source.generation, 7);
  assert.deepEqual(result[4].point, landmarks(10)[20]);
});

test('maps two synthetic hands to ten contacts without averaging their points', () => {
  const result = mapHandsToFingertips([
    { id: 'left', screenLandmarks: landmarks(0) },
    { id: 'right', screenLandmarks: landmarks(100) },
  ], { sessionId: 'synthetic-two-hand', generation: 2 });
  assert.equal(result.length, 10);
  assert.equal(new Set(result.map(item => item.source.sourceId)).size, 10);
  assert.deepEqual(result.find(item => item.source.sourceId === 'left:index').point, landmarks(0)[8]);
  assert.deepEqual(result.find(item => item.source.sourceId === 'right:pinky').point, landmarks(100)[20]);
});

test('rejects malformed landmark counts rather than claiming a camera mapping', () => {
  assert.throws(() => mapFingertipLandmarks({ handId: 'bad', landmarks: landmarks().slice(0, 20) }), /exactly 21/);
});
