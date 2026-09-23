import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLifecycle } from '../src/core/reality-object-lifecycle.js';
import { createRegistry } from '../src/domains/object-registry.js';

test('registry registers and retrieves object definitions', () => {
  const lifecycle = createLifecycle();
  const registry = createRegistry({ lifecycle });
  const factory = () => ({ materialized: true });

  const definition = registry.register({
    id: 'mimas',
    kind: 'moon',
    capabilities: ['celestial', 'movable'],
    factory,
  });

  assert.equal(registry.get('mimas'), definition);
  assert.equal(definition.factory, factory);
});

test('registry rejects duplicate and incomplete definitions', () => {
  const lifecycle = createLifecycle();
  const registry = createRegistry({ lifecycle });

  assert.throws(
    () => registry.register({ kind: 'moon', factory: () => ({}) }),
    /requires a non-empty id/,
  );

  assert.throws(
    () => registry.register({ id: 'mimas', factory: () => ({}) }),
    /requires a non-empty kind/,
  );

  assert.throws(
    () => registry.register({ id: 'mimas', kind: 'moon' }),
    /requires a factory function/,
  );

  registry.register({
    id: 'mimas',
    kind: 'moon',
    factory: () => ({}),
  });

  assert.throws(
    () =>
      registry.register({
        id: 'mimas',
        kind: 'moon',
        factory: () => ({}),
      }),
    /already registered/,
  );
});

test('registry finds objects by kind and capability', () => {
  const lifecycle = createLifecycle();
  const registry = createRegistry({ lifecycle });

  registry.register({
    id: 'mimas',
    kind: 'moon',
    capabilities: ['celestial', 'movable'],
    factory: () => ({}),
  });

  registry.register({
    id: 'mars',
    kind: 'planet',
    capabilities: ['celestial'],
    factory: () => ({}),
  });

  assert.deepEqual(
    registry.findByKind('moon').map((item) => item.id),
    ['mimas'],
  );

  assert.deepEqual(
    registry.findByCapability('movable').map((item) => item.id),
    ['mimas'],
  );

  assert.deepEqual(
    registry.findByCapability('celestial').map((item) => item.id),
    ['mimas', 'mars'],
  );
});

test('registry summon and dismiss route through lifecycle', () => {
  const lifecycle = createLifecycle();
  const registry = createRegistry({ lifecycle });

  let receivedContext;

  registry.register({
    id: 'mimas',
    kind: 'moon',
    factory: (context) => {
      receivedContext = context;
      return { id: 'mimas' };
    },
  });

  const context = { source: 'test' };
  const object = registry.summon('mimas', context);

  assert.deepEqual(object, { id: 'mimas' });
  assert.strictEqual(receivedContext, context);
  assert.equal(lifecycle.getState('mimas'), 'materializing');

  lifecycle.markMaterialized('mimas');
  assert.deepEqual(registry.activeIds(), ['mimas']);

  registry.dismiss('mimas', 'done');
  assert.equal(lifecycle.getState('mimas'), 'dismissing');

  lifecycle.markDisposed('mimas');
  assert.deepEqual(registry.activeIds(), []);
});

test('registry rejects unknown object operations', () => {
  const lifecycle = createLifecycle();
  const registry = createRegistry({ lifecycle });

  assert.throws(
    () => registry.summon('unknown'),
    /Unknown reality object "unknown"/,
  );

  assert.throws(
    () => registry.dismiss('unknown', 'test'),
    /Unknown reality object "unknown"/,
  );
});