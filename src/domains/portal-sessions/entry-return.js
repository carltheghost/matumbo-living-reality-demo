import { isExpired } from './opaque-handle.js';

const sessions = new WeakMap();
const HANDLE_ID = /^h_[0-9a-f]{8}$/i;

function assertHandle(handle, now) {
  if (
    !handle ||
    typeof handle !== 'object' ||
    !Object.isFrozen(handle) ||
    typeof handle.handleId !== 'string' ||
    !HANDLE_ID.test(handle.handleId) ||
    typeof handle.serviceId !== 'string' ||
    handle.serviceId.length === 0 ||
    typeof handle.status !== 'string' ||
    handle.status !== 'active' ||
    !Array.isArray(handle.capabilities) ||
    !Number.isFinite(handle.issuedAt) ||
    !Number.isFinite(handle.expiresAt) ||
    handle.expiresAt < handle.issuedAt
  ) {
    throw new TypeError('invalid opaque portal handle');
  }

  if (isExpired(handle, now)) {
    throw new Error('expired portal handle');
  }
}

function assertDestination(destination) {
  if (typeof destination !== 'string' || destination.length === 0) {
    throw new TypeError('destination must be a non-empty string');
  }
}

export function enterPortal(handle, destination, enteredAt) {
  if (!Number.isFinite(enteredAt)) {
    throw new TypeError('enteredAt must be a finite number');
  }
  assertHandle(handle, enteredAt);
  assertDestination(destination);

  const state = sessions.get(handle);
  if (state?.status === 'inside') {
    throw new Error('portal session is already inside');
  }

  sessions.set(handle, Object.freeze({
    status: 'inside',
    enteredAt
  }));

  return Object.freeze({
    sessionId: handle.handleId,
    destination,
    enteredAt
  });
}

export function returnToLens(handle, returnedAt) {
  if (!Number.isFinite(returnedAt)) {
    throw new TypeError('returnedAt must be a finite number');
  }
  assertHandle(handle, returnedAt);

  const state = sessions.get(handle);
  if (!state || state.status !== 'inside') {
    throw new Error('portal session is not inside');
  }

  sessions.set(handle, Object.freeze({
    status: 'returned',
    enteredAt: state.enteredAt,
    returnedAt
  }));

  return Object.freeze({
    sessionId: handle.handleId,
    returnedAt
  });
}
