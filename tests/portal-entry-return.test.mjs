import test from 'node:test';
import assert from 'node:assert/strict';

// The issuer's private registry belongs to the mounted canonical URL graph.
import { createHandle, revoke } from '../src/domains/portal-sessions/opaque-handle.js?v=20261003-skin360';
import { createHandle as createForeignHandle } from '../src/domains/portal-sessions/opaque-handle.js?issuer=foreign';
import { enterPortal, returnToLens } from '../src/domains/portal-sessions/entry-return.js?v=20261003-skin360';

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

test('a handle from a different module URL issuer is not a canonical issued capability', () => {
  const foreign = createForeignHandle({ serviceId: 'foreign', capabilities: ['read'], issuedAt: 100, ttlMs: 100 });
  assert.throws(() => enterPortal(foreign, 'https://example.com', 110), /invalid opaque portal handle/);
  assert.throws(() => returnToLens(foreign, 120), /invalid opaque portal handle/);
});

test('even an unchanged frozen copy is not an issued portal handle', () => {
  const original = handle('clone');
  const clone = Object.freeze({ ...original });
  assert.throws(() => enterPortal(clone, 'https://example.com', 110), /invalid opaque portal handle/);
  enterPortal(original, 'https://example.com', 110);
  assert.throws(() => returnToLens(clone, 120), /invalid opaque portal handle/);
  assert.equal(returnToLens(original, 120).sessionId, original.handleId);
});

test('revocation prevents entry with both the original and returned handle', () => {
  const original = handle('revoked');
  const revoked = revoke(original);
  assert.throws(() => enterPortal(original, 'https://example.com', 110), /invalid opaque portal handle/);
  assert.throws(() => enterPortal(revoked, 'https://example.com', 110), /invalid opaque portal handle/);
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
