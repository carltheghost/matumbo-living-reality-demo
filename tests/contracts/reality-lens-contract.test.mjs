import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createLifecycle } from '../../src/core/reality-object-lifecycle.js';
import { createObjectIdentity, traitSeed } from '../../src/core/reality-object-identity.js';
import { wrap, validate, migrate } from '../../src/core/reality-object-envelope.js';
import { createRegistry } from '../../src/domains/object-registry.js';
import { createHandle, isExpired } from '../../src/domains/portal-sessions/opaque-handle.js';
import { createSession } from '../../src/domains/portal-sessions/session.js';
import { registerAdapter, resolve } from '../../src/domains/portal-sessions/adapter-registry.js';
import { createOfflineActionQueue } from '../../src/domains/offline-action-queue.js';
import { createOfflineActionDrain } from '../../src/domains/offline-action-drain.js';
import { createIntentStream } from '../../src/render/lens-intent-stream.js';

test('lifecycle: legal path emits the canonical event order and illegal transitions throw', () => {
  const lifecycle = createLifecycle();
  const events = [];
  lifecycle.subscribe((event) => events.push(event.type));

  lifecycle.summon('object-1');
  lifecycle.markMaterialized('object-1');
  lifecycle.dismiss('object-1', 'test');
  lifecycle.markDisposed('object-1');

  assert.deepEqual(events, ['summoned', 'materialized', 'dismissing', 'dismissed']);

  assert.throws(() => createLifecycle().markMaterialized('unknown'));
  assert.throws(() => {
    const live = createLifecycle();
    live.summon('object-2');
    live.markMaterialized('object-2');
    live.summon('object-2');
  });
  assert.throws(() => {
    createLifecycle().dismiss('object-3');
  });
});

test('identity: deterministic genesis hash, namespace-separated trait seeds, frozen record', () => {
  const inputs = {
    objectId: 'object-1',
    kind: 'cube',
    origin: 'test-origin',
    creator: 'tester',
    timestamp: 1,
    mutability: 'mutable',
  };
  const a = createObjectIdentity(inputs);
  const b = createObjectIdentity(inputs);

  assert.equal(a.genesisHash, b.genesisHash);
  assert.notEqual(traitSeed(a, 'profile'), traitSeed(a, 'wardrobe'));
  assert.ok(Object.isFrozen(a));
  assert.throws(() => {
    a.objectId = 'mutated';
  }, TypeError);
});

test('envelope: validation rejects bad envelopes and migration is version-ordered', () => {
  assert.throws(() => validate({}));
  assert.throws(() => validate({ schema: 'reality-object' }));
  assert.throws(() => validate({ version: 1 }));

  const source = wrap('reality-object', 1, { id: 'object-1' });
  assert.equal(validate(source), true);

  const migrated = migrate(source, {
    1: (envelope) => ({ ...envelope, version: 2, data: { ...envelope.data, v2: true } }),
    2: (envelope) => ({ ...envelope, version: 3, data: { ...envelope.data, v3: true } }),
  });

  assert.equal(migrated.version, 3);
  assert.equal(migrated.data.v2, true);
  assert.equal(migrated.data.v3, true);
});

test('registry: duplicate registration throws, unknown summon throws, known summon enters materializing', () => {
  const lifecycle = createLifecycle();
  const registry = createRegistry({ lifecycle });
  const definition = { id: 'object-1', kind: 'cube', factory: () => ({}) };

  registry.register(definition);
  assert.throws(() => registry.register(definition));
  assert.throws(() => registry.summon('missing'));

  registry.summon('object-1');
  assert.equal(lifecycle.getState('object-1'), 'materializing');
});

test('portal sessions: opaque handles are non-credential-like, closed sessions cannot be reused, transitions emit events', () => {
  const handle = createHandle({
    serviceId: 'youtube',
    capabilities: ['resolve-session'],
    issuedAt: 1000,
    ttlMs: 60000,
  });
  assert.match(handle.handleId, /^h_/);
  assert.equal(isExpired(handle, 2000), false);
  assert.equal(isExpired(handle, 70000), true);

  for (const [key, value] of Object.entries(handle)) {
    assert.doesNotMatch(key, /token|secret|password|apikey/i);
    assert.doesNotMatch(String(value), /token|secret|password|apikey/i);
  }

  const events = [];
  const session = createSession(handle, { onEvent: (event) => events.push(event) });

  session.activate(1001);
  session.markIdle(1002);
  session.close('done', 1003);

  assert.ok(events.length >= 3);
  assert.ok(events.every((event) => event.type === 'session-transition'));
  assert.throws(() => session.activate(1004));
});

test('portal adapter registry: registration and resolution are identity-preserving', () => {
  const serviceId = 'contract-adapter-youtube';
  const registered = registerAdapter({
    serviceId,
    adapterId: 'youtube-portal',
    adapterVersion: '1.0.0',
    capabilities: ['resolve-session'],
    securityClass: 'trusted-agent-boundary',
  });

  assert.equal(registered.serviceId, serviceId);

  const resolved = resolve(serviceId);
  assert.equal(resolved.adapterId, 'youtube-portal');
  assert.deepEqual(resolved.capabilities, ['resolve-session']);

  assert.throws(() =>
    registerAdapter({
      serviceId,
      adapterId: 'youtube-portal',
      adapterVersion: '1.0.0',
      capabilities: ['resolve-session'],
      securityClass: 'trusted-agent-boundary',
    })
  );
});

test('offline queue/drain: FIFO order, one execution per attempt, permanent failures go to dead letters', async () => {
  const queue = createOfflineActionQueue();

  queue.enqueue({ type: 'first', payload: 1, createdAt: 1 });
  queue.enqueue({ type: 'fail-permanent', payload: 2, createdAt: 2 });
  queue.enqueue({ type: 'last', payload: 3, createdAt: 3 });

  const attempts = [];
  const drain = createOfflineActionDrain(queue, {
    execute: async (action) => {
      attempts.push(action.type);
      if (action.type === 'fail-permanent') {
        return { ok: false, retryable: false };
      }
      return { ok: true };
    },
  });

  await drain.drain();

  assert.deepEqual(attempts, ['first', 'fail-permanent', 'last']);
  assert.deepEqual(
    drain.deadLetters().map((entry) => entry.action.type),
    ['fail-permanent']
  );
  assert.equal(queue.size(), 0);
});

test('intent stream: pinch, gaze, touch and xr preserve select parity and intents are frozen', () => {
  const stream = createIntentStream();
  const raws = [
    { source: 'pinch', targetId: 'object-1', timestamp: 1 },
    { source: 'gaze', dwellMs: 900, targetId: 'object-1', timestamp: 1 },
    { source: 'touch', gesture: 'tap', targetId: 'object-1', timestamp: 1 },
    { source: 'xr', gesture: 'select', targetId: 'object-1', timestamp: 1 },
  ];
  const intents = raws.map((raw) => stream.emit(raw));

  for (const intent of intents) {
    assert.equal(intent.type, 'select');
    assert.equal(intent.targetId, 'object-1');
    assert.ok(Object.isFrozen(intent));
  }
});

test('projection-only boundary: lifecycle module contains no Three.js dependency', async () => {
  const source = await readFile(
    new URL('../../src/core/reality-object-lifecycle.js', import.meta.url),
    'utf8'
  );

  assert.equal(source.toLowerCase().includes('three'), false);
});
