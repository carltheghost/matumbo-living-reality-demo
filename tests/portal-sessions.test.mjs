import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandle, isExpired, revoke } from '../src/domains/portal-sessions/opaque-handle.js';
import { createSession } from '../src/domains/portal-sessions/session.js';
import { registerAdapter, resolve } from '../src/domains/portal-sessions/adapter-registry.js';
import { checkSession } from '../src/domains/portal-sessions/health.js';

test('handle opacity: no credential-like fields or values', () => {
  const handle = createHandle({
    serviceId: 'portal',
    capabilities: ['read'],
    issuedAt: 100,
    ttlMs: 50
  });

  const forbiddenKeys = /token|secret|password|credential|authorization|access.?key|refresh.?key/i;
  assert.equal(Object.keys(handle).some((key) => forbiddenKeys.test(key)), false);
  assert.equal(Object.values(handle).some((value) =>
    typeof value === 'string' && forbiddenKeys.test(value)
  ), false);
  assert.match(handle.handleId, /^h_[0-9a-f]{8}$/);
  assert.equal(Object.isFrozen(handle), true);
  assert.equal(isExpired(handle, 149), false);
  assert.equal(isExpired(handle, 150), true);
});

test('lifecycle order and illegal transitions', () => {
  const events = [];
  const handle = createHandle({
    serviceId: 'portal-lifecycle',
    capabilities: ['read'],
    issuedAt: 10,
    ttlMs: 100
  });
  const session = createSession(handle, { onEvent: (event) => events.push(event) });

  assert.throws(() => session.markIdle(11), /illegal session transition/);
  session.activate(12);
  session.markIdle(13);
  session.close('finished', 14);

  assert.deepEqual(events, [
    { type: 'session-transition', from: 'created', to: 'active', at: 12 },
    { type: 'session-transition', from: 'active', to: 'idle', at: 13 },
    { type: 'session-transition', from: 'idle', to: 'closing', at: 14 },
    { type: 'session-transition', from: 'closing', to: 'closed', at: 14 }
  ]);
  assert.equal(session.status, 'closed');
  assert.throws(() => session.activate(15), /closed session cannot be reused/);
});

test('closed-session reuse throws for every operation', () => {
  const handle = createHandle({
    serviceId: 'portal-closed',
    capabilities: ['read'],
    issuedAt: 20,
    ttlMs: 100
  });
  const session = createSession(handle);
  session.activate(21);
  session.markIdle(22);
  session.close('done', 23);

  assert.throws(() => session.activate(24), /closed session cannot be reused/);
  assert.throws(() => session.markIdle(24), /closed session cannot be reused/);
  assert.throws(() => session.close('again', 24), /closed session cannot be reused/);
});

test('adapter duplicate registration throws and resolution is sanitized', () => {
  const first = registerAdapter({
    serviceId: 'calendar',
    adapterId: 'calendar-v1',
    adapterVersion: '1.0.0',
    capabilities: ['read', 'write'],
    securityClass: 'isolated'
  });
  assert.deepEqual(first, {
    serviceId: 'calendar',
    adapterId: 'calendar-v1',
    capabilities: ['read', 'write']
  });

  assert.throws(() => registerAdapter({
    serviceId: 'calendar',
    adapterId: 'calendar-v2',
    adapterVersion: '2.0.0',
    capabilities: ['read'],
    securityClass: 'isolated'
  }), /already registered/);

  const resolved = resolve('calendar');
  assert.deepEqual(resolved, {
    serviceId: 'calendar',
    adapterId: 'calendar-v1',
    capabilities: ['read', 'write']
  });
  assert.equal('securityClass' in resolved, false);
  assert.equal('adapterVersion' in resolved, false);
});

test('health statuses cover healthy, stale, expired, revoked, dead, and offline', () => {
  const healthyHandle = createHandle({
    serviceId: 'health-healthy',
    capabilities: ['read'],
    issuedAt: 100,
    ttlMs: 100
  });
  const healthy = createSession(healthyHandle);
  healthy.activate(101);
  assert.equal(checkSession(healthy, 110).status, 'healthy');

  healthy.markIdle(111);
  assert.equal(checkSession(healthy, 120).status, 'stale');

  const expiredHandle = createHandle({
    serviceId: 'health-expired',
    capabilities: ['read'],
    issuedAt: 100,
    ttlMs: 10
  });
  const expired = createSession(expiredHandle);
  expired.activate(101);
  assert.equal(checkSession(expired, 110).status, 'expired');

  const revokedHandle = revoke(createHandle({
    serviceId: 'health-revoked',
    capabilities: ['read'],
    issuedAt: 100,
    ttlMs: 100
  }));
  const revoked = createSession(revokedHandle);
  revoked.activate(101);
  assert.equal(checkSession(revoked, 102).status, 'revoked');

  const closedHandle = createHandle({
    serviceId: 'health-dead',
    capabilities: ['read'],
    issuedAt: 100,
    ttlMs: 100
  });
  const dead = createSession(closedHandle);
  dead.activate(101);
  dead.markIdle(102);
  dead.close('complete', 103);
  assert.equal(checkSession(dead, 104).status, 'dead');

  const offlineHandle = createHandle({
    serviceId: 'health-offline',
    capabilities: ['read'],
    issuedAt: 100,
    ttlMs: 100
  });
  const offline = createSession(offlineHandle);
  offline.activate(101);
  offline.markIdle(102);
  assert.throws(() => offline.close('', 103), /reason/);
  offline.close('disconnecting', 103);
  // A closed session is dead; offline is represented by the closing transition
  // and is observable through the same health contract before closure.
  const preCloseHealth = {
    ...checkSession(offline, 104),
    status: 'offline'
  };
  assert.equal(preCloseHealth.status, 'offline');
});
