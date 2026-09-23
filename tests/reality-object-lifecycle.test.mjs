import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLifecycle } from '../src/core/reality-object-lifecycle.js';

test('lifecycle starts dormant and follows legal transitions', () => {
  const lifecycle = createLifecycle();
  const events = [];

  lifecycle.subscribe((event) => events.push(event.type));

  assert.equal(lifecycle.getState('moon-1'), 'dormant');

  lifecycle.summon('moon-1', { source: 'test' });
  assert.equal(lifecycle.getState('moon-1'), 'materializing');

  lifecycle.markMaterialized('moon-1');
  assert.equal(lifecycle.getState('moon-1'), 'live');

  lifecycle.dismiss('moon-1', 'test complete');
  assert.equal(lifecycle.getState('moon-1'), 'dismissing');

  lifecycle.markDisposed('moon-1');
  assert.equal(lifecycle.getState('moon-1'), 'dormant');

  assert.deepEqual(events, [
    'summoned',
    'materialized',
    'dismissing',
    'dismissed',
  ]);
});

test('illegal lifecycle transitions throw clearly', () => {
  const lifecycle = createLifecycle();

  assert.throws(
    () => lifecycle.markMaterialized('moon-1'),
    /Illegal lifecycle transition.*moon-1.*dormant.*markMaterialized/,
  );

  lifecycle.summon('moon-1');

  assert.throws(
    () => lifecycle.summon('moon-1'),
    /Illegal lifecycle transition.*moon-1.*materializing.*summon/,
  );

  assert.throws(
    () => lifecycle.dismiss('moon-1'),
    /Illegal lifecycle transition.*moon-1.*materializing.*dismiss/,
  );
});

test('unsubscribe stops lifecycle event delivery', () => {
  const lifecycle = createLifecycle();
  let count = 0;

  const unsubscribe = lifecycle.subscribe(() => {
    count += 1;
  });

  lifecycle.summon('moon-1');
  unsubscribe();
  lifecycle.markMaterialized('moon-1');

  assert.equal(count, 1);
});