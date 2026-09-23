import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PHONE_PROFILE,
  resolveGesture
} from '../src/projections/phone-profile.js';

test('phone profile matches the device profile contract', () => {
  assert.equal(PHONE_PROFILE.id, 'phone');
  assert.deepEqual(PHONE_PROFILE.input, ['touch', 'voice']);
  assert.equal(PHONE_PROFILE.viewport, 'small');
  assert.equal(typeof PHONE_PROFILE.maxVisibleObjects, 'number');
  assert.equal(typeof PHONE_PROFILE.labelStrategy, 'string');
  assert.equal(typeof PHONE_PROFILE.gestureMap, 'object');
  assert.ok(Object.isFrozen(PHONE_PROFILE));
  assert.ok(Object.isFrozen(PHONE_PROFILE.input));
  assert.ok(Object.isFrozen(PHONE_PROFILE.gestureMap));
});

test('all four phone gestures resolve to lens intents', () => {
  assert.equal(resolveGesture('tap'), 'select');
  assert.equal(resolveGesture('two-finger-pinch'), 'zoom');
  assert.equal(resolveGesture('swipe'), 'navigate');
  assert.equal(resolveGesture('long-press'), 'inspect');
});

test('unknown gesture throws', () => {
  assert.throws(
    () => resolveGesture('double-tap'),
    /Unknown phone gesture: double-tap/
  );
});

test('phone profile contains no hover or gaze-dwell intents', () => {
  const serialized = JSON.stringify(PHONE_PROFILE);

  assert.equal(Object.hasOwn(PHONE_PROFILE.gestureMap, 'hover'), false);
  assert.equal(Object.hasOwn(PHONE_PROFILE.gestureMap, 'gaze-dwell'), false);
  assert.equal(serialized.includes('hover'), false);
  assert.equal(serialized.includes('gaze-dwell'), false);
  assert.equal(PHONE_PROFILE.input.includes('gaze'), false);
});

test('phone profile is deterministic and touch-first', () => {
  assert.equal(PHONE_PROFILE.input[0], 'touch');
  assert.equal(PHONE_PROFILE.gestureMap.tap, 'select');
  assert.equal(PHONE_PROFILE.gestureMap['two-finger-pinch'], 'zoom');
  assert.equal(PHONE_PROFILE.gestureMap.swipe, 'navigate');
  assert.equal(PHONE_PROFILE.gestureMap['long-press'], 'inspect');
});
