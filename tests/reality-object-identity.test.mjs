import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createObjectIdentity,
  fnv1a,
  traitSeed,
} from '../src/core/reality-object-identity.js';

test('FNV-1a returns deterministic hexadecimal output', () => {
  assert.equal(fnv1a('hello'), fnv1a('hello'));
  assert.match(fnv1a('hello'), /^[0-9a-f]{8}$/);
});

test('identity is frozen and genesis hash covers the identity fields', () => {
  const identity = createObjectIdentity({
    objectId: 'mimas',
    kind: 'moon',
    origin: 'saturn',
    creator: 'system',
    timestamp: 2051,
    mutability: 'immutable',
  });

  assert.equal(identity.objectId, 'mimas');
  assert.match(identity.genesisHash, /^[0-9a-f]{8}$/);
  assert.equal(Object.isFrozen(identity), true);

  const changed = createObjectIdentity({
    objectId: 'mimas',
    kind: 'moon',
    origin: 'saturn',
    creator: 'system',
    timestamp: 2052,
    mutability: 'immutable',
  });

  assert.notEqual(identity.genesisHash, changed.genesisHash);
});

test('canonical hashing ignores object key insertion order', () => {
  const a = fnv1a({ b: 2, a: 1 });
  const b = fnv1a({ a: 1, b: 2 });

  assert.equal(a, b);
});

test('trait seeds are namespace-stable and independent', () => {
  const identity = createObjectIdentity({
    objectId: 'mimas',
    kind: 'moon',
    origin: 'saturn',
    creator: 'system',
    timestamp: 2051,
    mutability: 'immutable',
  });

  const geometry = traitSeed(identity, 'geometry');
  const surface = traitSeed(identity, 'surface');

  assert.match(geometry, /^[0-9a-f]{8}$/);
  assert.match(surface, /^[0-9a-f]{8}$/);
  assert.notEqual(geometry, surface);

  assert.equal(geometry, traitSeed(identity, 'geometry'));
  assert.equal(surface, traitSeed(identity, 'surface'));
});