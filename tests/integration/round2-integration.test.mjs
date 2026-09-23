import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSpacetimeLog } from '../../src/core/spacetime-log.js';
import { createOfflineQueueStore } from '../../src/core/offline-queue-store.js';
import { createPortalAdapter } from '../../src/core/portal-adapters.js';
import { createOpaqueHandle } from '../../src/core/opaque-handle.js';
import { createProjectionGuard } from '../../src/core/reality-object-projection-guard.js';
import { createARGlassesProfile } from '../../src/core/ar-glasses-profile.js';
import { createDeviceProfile } from '../../src/core/device-profiles.js';

test('spacetime log records queued actions in queue order', () => {
  const log = createSpacetimeLog();
  const queue = createOfflineQueueStore();

  queue.enqueue({ type: 'MOVE', objectId: 'object-a', value: 1 });
  queue.enqueue({ type: 'PORTAL', objectId: 'object-b', value: 2 });
  queue.enqueue({ type: 'SUMMON', objectId: 'object-c', value: 3 });

  const actions = queue.drain();

  for (const action of actions) {
    log.append(action);
  }

  const entries = log.entries();

  assert.deepEqual(
    entries.map((entry) => entry.action ?? entry),
    actions
  );
});

test('portal adapter session requires a valid opaque handle', () => {
  const adapter = createPortalAdapter();
  const handle = createOpaqueHandle('portal-session');

  const session = adapter.createSession(handle);

  assert.ok(session);
  assert.throws(
    () => adapter.createSession('portal-session'),
    /opaque|handle|invalid|forged/i
  );
});

test('projection guard prevents dormant objects from entering AR glasses projection', () => {
  const guard = createProjectionGuard();
  const profile = createARGlassesProfile();

  const objectId = 'reality-object-1';

  guard.markDormant(objectId);

  assert.equal(guard.isDormant(objectId), true);
  assert.equal(profile.canProject(objectId, guard), false);

  assert.throws(
    () => profile.project(objectId, guard),
    /dormant|projection|project/i
  );

  assert.equal(guard.isProjected(objectId), false);
});

test('AR glasses profile satisfies the device profile contract shape', () => {
  const arProfile = createARGlassesProfile();
  const deviceProfile = createDeviceProfile(arProfile);

  assert.ok(arProfile);
  assert.ok(deviceProfile);

  assert.equal(typeof arProfile, 'object');
  assert.equal(typeof deviceProfile, 'object');

  for (const key of Object.keys(deviceProfile)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(arProfile, key),
      `AR glasses profile is missing device profile field: ${key}`
    );
  }
});
