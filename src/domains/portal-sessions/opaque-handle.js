let handleCounter = 0;

const HANDLE_ID = /^h_[0-9a-f]{8}$/i;
// Object membership is local to this page session. A frozen clone or guessed
// identifier does not become an issued handle, and revocation also covers the
// original immutable object and any session already holding it.
const issuedHandles = new WeakMap();

function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function assertString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

export function createHandle({ serviceId, capabilities, issuedAt, ttlMs }) {
  assertString(serviceId, 'serviceId');
  if (!Array.isArray(capabilities) || capabilities.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError('capabilities must be an array of non-empty strings');
  }
  assertFiniteNumber(issuedAt, 'issuedAt');
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new TypeError('ttlMs must be a non-negative finite number');
  }

  handleCounter += 1;
  const handleId = `h_${fnv1a(`${serviceId}${issuedAt}${handleCounter}`)}`;
  const expiresAt = issuedAt + ttlMs;
  assertFiniteNumber(expiresAt, 'expiresAt');
  const handle = Object.freeze({
    schemaVersion: 1,
    handleId,
    serviceId,
    capabilities: Object.freeze([...capabilities]),
    issuedAt,
    expiresAt,
    status: 'active'
  });
  issuedHandles.set(handle, { revoked: false });
  return handle;
}

export function isIssuedHandle(handle) {
  return Boolean(handle && typeof handle === 'object' && issuedHandles.has(handle));
}

export function isHandleRevoked(handle) {
  return issuedHandles.get(handle)?.revoked === true;
}

export function isExpired(handle, now) {
  if (!handle || typeof handle !== 'object') {
    throw new TypeError('handle must be an object');
  }
  assertFiniteNumber(now, 'now');
  assertFiniteNumber(handle.expiresAt, 'expiresAt');
  return now >= handle.expiresAt;
}

export function revoke(handle) {
  if (!isIssuedHandle(handle) || !HANDLE_ID.test(handle.handleId)) {
    throw new TypeError('invalid handle');
  }
  const record = issuedHandles.get(handle);
  record.revoked = true;
  const revoked = Object.freeze({
    schemaVersion: 1,
    handleId: handle.handleId,
    serviceId: handle.serviceId,
    capabilities: Object.freeze([...handle.capabilities]),
    issuedAt: handle.issuedAt,
    expiresAt: handle.expiresAt,
    status: 'revoked'
  });
  issuedHandles.set(revoked, record);
  return revoked;
}
