import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandle } from '../src/domains/portal-sessions/opaque-handle.js';
import { enterPortal, returnToLens } from '../src/domains/portal-sessions/entry-return.js';

function handle(serviceId = 'youtube', issuedAt = 100, ttlMs = 100) {
  return createHandle({
    serviceId,
    capabilities: ['resolve-session'],
    issuedAt,
    ttlMs
  });
}

test('enter and return happy path', () => {
  const portalHandle = handle();

  const entered = enterPortal(portalHandle, 'https://www.youtube.com', 110);
  assert.deepEqual(entered, {
    sessionId: portalHandle.handleId,
    destination: 'https://www.youtube.com',
    enteredAt: 110
  });

  const returned = returnToLens(portalHandle, 120);
  assert.deepEqual(returned, {
    sessionId: portalHandle.handleId,
    returnedAt: 120
  });
});

test('double-enter throws', () => {
  const portalHandle = handle('netflix');

  enterPortal(portalHandle, 'https://www.netflix.com', 110);
  assert.throws(
    () => enterPortal(portalHandle, 'https://www.netflix.com', 115),
    /already inside/
  );
});

test('return-without-enter throws', () => {
  const portalHandle = handle('google');

  assert.throws(
    () => returnToLens(portalHandle, 110),
    /not inside/
  );
});

test('forged handle fails closed', () => {
  const original = handle('icloud');
  const forged = Object.freeze({
    ...original,
    handleId: 'h_00000000'
  });

  assert.throws(
    () => enterPortal(forged, 'https://www.icloud.com', 110),
    /invalid opaque portal handle/
  );
});

test('expired handle fails closed', () => {
  const portalHandle = handle('youtube', 100, 10);

  assert.throws(
    () => enterPortal(portalHandle, 'https://www.youtube.com', 110),
    /expired portal handle/
  );
});

test('outputs expose only the opaque handle identifier, not internal identifiers', () => {
  const portalHandle = handle('google', 200, 100);
  const entered = enterPortal(portalHandle, 'https://www.google.com', 210);
  const returned = returnToLens(portalHandle, 220);

  assert.deepEqual(Object.keys(entered).sort(), ['destination', 'enteredAt', 'sessionId']);
  assert.deepEqual(Object.keys(returned).sort(), ['returnedAt', 'sessionId']);
  assert.equal(entered.sessionId, portalHandle.handleId);
  assert.equal(returned.sessionId, portalHandle.handleId);
  assert.equal('serviceId' in entered, false);
  assert.equal('serviceId' in returned, false);
});
