JavaScript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectionGuard } from '../src/core/reality-object-projection-guard.js';

test('dormant then markProjected throws', () => {
  const guard = createProjectionGuard();

  guard.markDormant('reality-1');

  assert.equal(guard.isDormant('reality-1'), true);
  assert.throws(
    () => guard.markProjected('reality-1'),
    /Dormant Reality Object cannot be projected/
  );
});

test('project without a dormant mark works', () => {
  const guard = createProjectionGuard();

  guard.markProjected('reality-1');

  assert.equal(guard.isProjected('reality-1'), true);
  assert.deepEqual(guard.projectedIds(), ['reality-1']);
});

test('undormant then project works', () => {
  const guard = createProjectionGuard();

  guard.markDormant('reality-1');
  guard.undormant('reality-1');
  guard.markProjected('reality-1');

  assert.equal(guard.isDormant('reality-1'), false);
  assert.equal(guard.isProjected('reality-1'), true);
});

test('assertClean passes on a healthy guard and throws when violated', () => {
  const guard = createProjectionGuard();

  guard.markDormant('reality-1');
  assert.doesNotThrow(() => guard.assertClean());

  guard.undormant('reality-1');
  guard.markProjected('reality-1');
  assert.doesNotThrow(() => guard.assertClean());

  guard.markDormant('reality-1');
  assert.throws(
    () => guard.assertClean(),
    /Projection guard violation/
  );
});

test('non-string id throws TypeError', () => {
  const guard = createProjectionGuard();

  for (const method of [
    'markDormant',
    'markProjected',
    'undormant',
    'isDormant',
    'isProjected'
  ]) {
    assert.throws(
      () => guard[method](42),
      TypeError
    );
  }
});

test('projectedIds lists projected ids', () => {
  const guard = createProjectionGuard();

  guard.markProjected('reality-a');
  guard.markProjected('reality-b');

  assert.deepEqual(
    guard.projectedIds(),
    ['reality-a', 'reality-b']
  );
});