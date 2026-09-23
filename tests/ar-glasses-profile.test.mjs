JavaScript
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AR_GLASSES_PROFILE,
  resolveProfile,
  requiresKeyboardOrMouse
} from '../src/projections/ar-glasses-profile.js';

test('all three device profiles resolve and are frozen', () => {
  const phone = resolveProfile('phone');
  const desktop = resolveProfile('desktop');
  const arGlasses = resolveProfile('ar-glasses');

  assert.ok(Object.isFrozen(phone));
  assert.ok(Object.isFrozen(desktop));
  assert.ok(Object.isFrozen(arGlasses));
  assert.ok(Object.isFrozen(AR_GLASSES_PROFILE));

  assert.strictEqual(phone.name, 'phone');
  assert.strictEqual(desktop.name, 'desktop');
  assert.strictEqual(arGlasses.name, 'ar-glasses');
});

test('all profiles do not require keyboard or mouse', () => {
  for (const deviceType of ['phone', 'desktop', 'ar-glasses']) {
    const profile = resolveProfile(deviceType);

    assert.strictEqual(profile.keyboardRequired, false);
    assert.strictEqual(profile.mouseRequired, false);
  }
});

test('requiresKeyboardOrMouse is false for all profiles', () => {
  for (const deviceType of ['phone', 'desktop', 'ar-glasses']) {
    assert.strictEqual(
      requiresKeyboardOrMouse(resolveProfile(deviceType)),
      false
    );
  }
});

test('unknown device type throws', () => {
  assert.throws(
    () => resolveProfile('unknown'),
    /Unknown device type: unknown/
  );
});