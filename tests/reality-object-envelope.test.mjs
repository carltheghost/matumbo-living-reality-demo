import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  wrap,
  validate,
  migrate,
} from '../src/core/reality-object-envelope.js';

test('wrap creates a valid envelope with optional metadata', () => {
  const envelope = wrap(
    'reality-object',
    1,
    { id: 'mimas' },
    { createdAt: 100, updatedAt: 200 },
  );

  assert.deepEqual(envelope, {
    schema: 'reality-object',
    version: 1,
    data: { id: 'mimas' },
    createdAt: 100,
    updatedAt: 200,
  });

  assert.equal(validate(envelope), true);
});

test('validate rejects malformed envelopes', () => {
  assert.throws(
    () => validate(null),
    /Envelope must be an object/,
  );

  assert.throws(
    () => validate({ version: 1, data: {} }),
    /schema/,
  );

  assert.throws(
    () => validate({ schema: 'x', data: {} }),
    /version/,
  );

  assert.throws(
    () => validate({ schema: 'x', version: 1 }),
    /data/,
  );
});

test('migrate applies one-way migrations in version order', () => {
  const original = wrap('reality-object', 1, { value: 10 });

  const migrated = migrate(original, {
    1: (envelope) =>
      wrap(
        envelope.schema,
        2,
        { ...envelope.data, doubled: envelope.data.value * 2 },
      ),
    2: (envelope) =>
      wrap(
        envelope.schema,
        3,
        { ...envelope.data, final: true },
      ),
  });

  assert.deepEqual(migrated, {
    schema: 'reality-object',
    version: 3,
    data: {
      value: 10,
      doubled: 20,
      final: true,
    },
  });
});

test('migrate stops when no migration exists for the current version', () => {
  const envelope = wrap('reality-object', 3, { value: 10 });

  assert.strictEqual(migrate(envelope, {}), envelope);
});

test('migrate rejects migrations that do not advance version', () => {
  const envelope = wrap('reality-object', 1, { value: 10 });

  assert.throws(
    () =>
      migrate(envelope, {
        1: (current) => current,
      }),
    /did not advance the version/,
  );
});