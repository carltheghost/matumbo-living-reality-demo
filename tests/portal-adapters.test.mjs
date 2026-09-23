JavaScript
import test from 'node:test';
import assert from 'node:assert/strict';

import { getAdapter } from '../src/domains/portal-sessions/adapters.js';
import { registerAdapter } from '../src/domains/portal-sessions/adapter-registry.js';

const SERVICES = Object.freeze({
  youtube: Object.freeze({
    adapterId: 'youtube-portal',
    entryUrl: 'https://www.youtube.com',
    label: 'YouTube'
  }),
  netflix: Object.freeze({
    adapterId: 'netflix-portal',
    entryUrl: 'https://www.netflix.com',
    label: 'Netflix'
  }),
  google: Object.freeze({
    adapterId: 'google-portal',
    entryUrl: 'https://www.google.com',
    label: 'Google'
  }),
  icloud: Object.freeze({
    adapterId: 'icloud-portal',
    entryUrl: 'https://www.icloud.com',
    label: 'iCloud'
  })
});

test('all portal service adapters are registered and resolvable', () => {
  for (const [serviceId, expected] of Object.entries(SERVICES)) {
    const adapter = getAdapter(serviceId);

    assert.ok(adapter);
    assert.equal(adapter.serviceId, serviceId);
    assert.equal(adapter.adapterId, expected.adapterId);
    assert.equal(adapter.adapterVersion, '1.0.0');
    assert.deepEqual(adapter.capabilities, ['resolve-session']);
    assert.equal(adapter.securityClass, 'trusted-agent-boundary');
  }
});

test('open returns the correct public service entry URL', () => {
  for (const [serviceId, expected] of Object.entries(SERVICES)) {
    const adapter = getAdapter(serviceId);
    const opened = adapter.open({
      serviceId,
      handleId: `${serviceId}-handle`
    });

    assert.deepEqual(opened, {
      serviceId,
      handleId: `${serviceId}-handle`,
      entryUrl: expected.entryUrl,
      label: expected.label
    });
    assert.equal(Object.isFrozen(opened), true);
  }
});

test('adapter outputs contain no credential-related key or value substrings', () => {
  const forbidden = /token|secret|password|cookie/i;

  for (const serviceId of Object.keys(SERVICES)) {
    const adapter = getAdapter(serviceId);
    const opened = adapter.open({
      serviceId,
      handleId: `${serviceId}-handle`
    });
    const closed = adapter.close({
      serviceId,
      handleId: `${serviceId}-handle`
    });

    for (const object of [adapter, opened, closed]) {
      for (const [key, value] of Object.entries(object)) {
        assert.equal(forbidden.test(key), false, `forbidden key: ${key}`);
        if (typeof value === 'string') {
          assert.equal(
            forbidden.test(value),
            false,
            `forbidden value: ${value}`
          );
        }
      }
    }
  }
});

test('close returns closed true', () => {
  for (const serviceId of Object.keys(SERVICES)) {
    const adapter = getAdapter(serviceId);
    const closed = adapter.close({
      serviceId,
      handleId: `${serviceId}-handle`
    });

    assert.deepEqual(closed, {
      serviceId,
      handleId: `${serviceId}-handle`,
      closed: true
    });
    assert.equal(Object.isFrozen(closed), true);
  }
});

test('open and close throw on invalid handles', () => {
  for (const serviceId of Object.keys(SERVICES)) {
    const adapter = getAdapter(serviceId);

    for (const invalidHandle of [
      null,
      undefined,
      {},
      { serviceId },
      { handleId: 'handle' },
      { serviceId: 'other', handleId: 'handle' },
      { serviceId, handleId: '' }
    ]) {
      assert.throws(() => adapter.open(invalidHandle), TypeError);
      assert.throws(() => adapter.close(invalidHandle), TypeError);
    }
  }
});

test('registering a duplicate serviceId throws', () => {
  assert.throws(
    () => registerAdapter({
      serviceId: 'youtube',
      adapterId: 'duplicate-portal',
      adapterVersion: '1.0.0',
      capabilities: ['resolve-session'],
      securityClass: 'trusted-agent-boundary'
    }),
    /adapter already registered/
  );
});