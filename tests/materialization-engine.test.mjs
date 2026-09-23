import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../src/core/materialization-engine.js';

test('full lifecycle moves dormant -> materializing -> live -> dismissing -> dormant', () => {
  const engine = createEngine();

  assert.equal(engine.getState('object-1'), 'dormant');

  assert.equal(engine.summon('object-1'), 'materializing');
  assert.equal(engine.getState('object-1'), 'materializing');

  assert.equal(engine.ready('object-1'), 'live');
  assert.equal(engine.getState('object-1'), 'live');

  assert.equal(engine.dismiss('object-1'), 'dismissing');
  assert.equal(engine.getState('object-1'), 'dismissing');

  assert.equal(engine.rest('object-1'), 'dormant');
  assert.equal(engine.getState('object-1'), 'dormant');
});

test('illegal transitions throw clear errors', () => {
  const engine = createEngine();

  assert.throws(
    () => engine.ready('object-1'),
    /Illegal materialization transition.*object-1.*ready.*dormant/,
  );

  engine.summon('object-1');

  assert.throws(
    () => engine.summon('object-1'),
    /Illegal materialization transition.*object-1.*summon.*materializing/,
  );

  engine.ready('object-1');

  assert.throws(
    () => engine.ready('object-1'),
    /Illegal materialization transition.*object-1.*ready.*live/,
  );

  engine.dismiss('object-1');

  assert.throws(
    () => engine.dismiss('object-1'),
    /Illegal materialization transition.*object-1.*dismiss.*dismissing/,
  );

  engine.rest('object-1');

  assert.throws(
    () => engine.rest('object-1'),
    /Illegal materialization transition.*object-1.*rest.*dormant/,
  );
});

test('journal records every transition in order', () => {
  const engine = createEngine();

  engine.summon('alpha');
  engine.ready('alpha');
  engine.dismiss('alpha');
  engine.rest('alpha');

  engine.summon('beta');
  engine.ready('beta');

  assert.deepEqual(engine.journal(), [
    {
      seq: 0,
      id: 'alpha',
      action: 'summon',
      from: 'dormant',
      to: 'materializing',
    },
    {
      seq: 1,
      id: 'alpha',
      action: 'ready',
      from: 'materializing',
      to: 'live',
    },
    {
      seq: 2,
      id: 'alpha',
      action: 'dismiss',
      from: 'live',
      to: 'dismissing',
    },
    {
      seq: 3,
      id: 'alpha',
      action: 'rest',
      from: 'dismissing',
      to: 'dormant',
    },
    {
      seq: 4,
      id: 'beta',
      action: 'summon',
      from: 'dormant',
      to: 'materializing',
    },
    {
      seq: 5,
      id: 'beta',
      action: 'ready',
      from: 'materializing',
      to: 'live',
    },
  ]);
});

test('objects are dormant by default and lifecycle state is independent per object', () => {
  const engine = createEngine();

  assert.equal(engine.getState('alpha'), 'dormant');
  assert.equal(engine.getState('beta'), 'dormant');

  engine.summon('alpha');

  assert.equal(engine.getState('alpha'), 'materializing');
  assert.equal(engine.getState('beta'), 'dormant');
});

test('journal entries are immutable', () => {
  const engine = createEngine();

  engine.summon('object-1');

  const [entry] = engine.journal();

  assert.ok(Object.isFrozen(entry));

  assert.throws(() => {
    entry.to = 'live';
  }, TypeError);
});

test('invalid object ids are rejected', () => {
  const engine = createEngine();

  assert.throws(() => engine.getState(''), /Object id must be a non-empty string/);
  assert.throws(() => engine.summon(''), /Object id must be a non-empty string/);
  assert.throws(() => engine.ready(null), /Object id must be a non-empty string/);
});
