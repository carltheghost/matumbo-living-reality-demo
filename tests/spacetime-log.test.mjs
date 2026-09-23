JavaScript
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSpacetimeLog,
  fnv1a,
  importLog,
  replay,
} from '../src/domains/spacetime-log.js';

test('fnv1a returns deterministic hexadecimal hashes', () => {
  assert.equal(fnv1a(''), '811c9dc5');
  assert.equal(fnv1a('hello'), '4f9f2cab');
  assert.equal(fnv1a('hello'), fnv1a('hello'));
  assert.notEqual(fnv1a('hello'), fnv1a('world'));
});

test('chain integrity survives 20 appends', () => {
  const log = createSpacetimeLog();

  for (let i = 0; i < 20; i += 1) {
    const entry = log.append({
      type: i % 2 === 0 ? 'appear' : 'move',
      objectId: `object-${i % 4}`,
      payload: {
        index: i,
        value: `state-${i}`,
      },
    });

    assert.equal(entry.seq, i);
    assert.equal(entry.at, i);
    assert.equal(entry.prevHash, i === 0 ? '00000000' : log.entries()[i - 1].hash);
    assert.match(entry.hash, /^[0-9a-f]{8}$/);
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.payload));
  }

  const restored = importLog(log.exportLog());
  assert.equal(restored.entries().length, 20);
  assert.deepEqual(restored.entries(), log.entries());
});

test('tampering with one payload character is detected', () => {
  const log = createSpacetimeLog();

  log.append({
    type: 'create',
    objectId: 'cube-1',
    payload: { label: 'original' },
  });

  log.append({
    type: 'update',
    objectId: 'cube-1',
    payload: { label: 'second' },
  });

  const exported = log.exportLog();
  const tampered = exported.replace('"original"', '"originaX"');

  assert.throws(
    () => importLog(tampered),
    /Broken hash|Broken chain/,
  );
});

test('entries filters by type, objectId, and sinceSeq in sequence order', () => {
  const log = createSpacetimeLog();

  log.append({
    type: 'create',
    objectId: 'a',
    payload: { n: 0 },
  });

  log.append({
    type: 'update',
    objectId: 'b',
    payload: { n: 1 },
  });

  log.append({
    type: 'update',
    objectId: 'a',
    payload: { n: 2 },
  });

  log.append({
    type: 'delete',
    objectId: 'a',
    payload: { n: 3 },
  });

  log.append({
    type: 'update',
    objectId: 'a',
    payload: { n: 4 },
  });

  assert.deepEqual(
    log.entries({ type: 'update' }).map((entry) => entry.seq),
    [1, 2, 4],
  );

  assert.deepEqual(
    log.entries({ objectId: 'a' }).map((entry) => entry.seq),
    [0, 2, 3, 4],
  );

  assert.deepEqual(
    log.entries({ type: 'update', objectId: 'a' }).map((entry) => entry.seq),
    [2, 4],
  );

  assert.deepEqual(
    log.entries({ sinceSeq: 2 }).map((entry) => entry.seq),
    [2, 3, 4],
  );

  assert.deepEqual(
    log.entries({ objectId: 'a', sinceSeq: 3 }).map((entry) => entry.seq),
    [3, 4],
  );
});

test('export and import preserve every entry and hash', () => {
  const original = createSpacetimeLog();

  original.append({
    type: 'spawn',
    objectId: 'alpha',
    payload: { x: 1, y: 2 },
  });

  original.append({
    type: 'transform',
    objectId: 'alpha',
    payload: {
      rotation: [0, 0, 1],
      scale: { x: 2, y: 2, z: 2 },
    },
  });

  original.append({
    type: 'dismiss',
    objectId: 'alpha',
    payload: { reason: 'test' },
  });

  const exported = original.exportLog();
  const imported = importLog(exported);

  assert.equal(imported.exportLog(), exported);
  assert.deepEqual(
    imported.entries().map((entry) => entry.hash),
    original.entries().map((entry) => entry.hash),
  );
  assert.deepEqual(imported.entries(), original.entries());
});

test('replay invokes handlers in sequence order and returns count', () => {
  const log = createSpacetimeLog();

  log.append({
    type: 'create',
    objectId: 'one',
    payload: { value: 1 },
  });

  log.append({
    type: 'update',
    objectId: 'one',
    payload: { value: 2 },
  });

  log.append({
    type: 'update',
    objectId: 'one',
    payload: { value: 3 },
  });

  const calls = [];

  const count = replay(log, {
    create(entry) {
      calls.push(`create:${entry.seq}:${entry.payload.value}`);
    },
    update(entry) {
      calls.push(`update:${entry.seq}:${entry.payload.value}`);
    },
  });

  assert.equal(count, 3);
  assert.deepEqual(calls, [
    'create:0:1',
    'update:1:2',
    'update:2:3',
  ]);
});

test('every imported entry is frozen', () => {
  const source = createSpacetimeLog();

  source.append({
    type: 'create',
    objectId: 'a',
    payload: {
      nested: {
        value: 1,
      },
    },
  });

  const imported = importLog(source.exportLog());
  const [entry] = imported.entries();

  assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry.payload));
  assert.ok(Object.isFrozen(entry.payload.nested));

  assert.throws(() => {
    entry.type = 'tampered';
  }, TypeError);

  assert.throws(() => {
    entry.payload.nested.value = 99;
  }, TypeError);
});

test('broken previous-link hash is rejected', () => {
  const log = createSpacetimeLog();

  log.append({
    type: 'create',
    objectId: 'a',
    payload: { value: 1 },
  });

  log.append({
    type: 'update',
    objectId: 'a',
    payload: { value: 2 },
  });

  const parsed = JSON.parse(log.exportLog());
  parsed[1].prevHash = 'deadbeef';

  assert.throws(
    () => importLog(JSON.stringify(parsed)),
    /Broken chain|Broken hash/,
  );
});

test('missing replay handlers are rejected', () => {
  const log = createSpacetimeLog();

  log.append({
    type: 'unknown-action',
    objectId: 'a',
    payload: {},
  });

  assert.throws(
    () => replay(log, {}),
    /Missing replay handler for type: unknown-action/,
  );
});