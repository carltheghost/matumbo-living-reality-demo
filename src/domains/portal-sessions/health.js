import { isExpired } from './opaque-handle.js';
import { sessionHealthView } from './session.js';

const NEXT_CHECK_MS = 1000;

export function checkSession(session, now) {
  if (!session ||
      typeof session !== 'object' ||
      typeof session[sessionHealthView] !== 'function') {
    throw new TypeError('session must be a portal session');
  }

  if (!Number.isFinite(now)) {
    throw new TypeError('now must be a finite number');
  }

  const view = session[sessionHealthView]();

  let status;
  let reason;

  if (view.handleStatus === 'revoked') {
    status = 'revoked';
    reason = 'session handle revoked';
  } else if (isExpired({ expiresAt: view.expiresAt }, now)) {
    status = 'expired';
    reason = 'session handle expired';
  } else if (view.state === 'closed') {
    status = 'dead';
    reason = view.closedReason || 'session closed';
  } else if (view.state === 'closing') {
    status = 'offline';
    reason = 'session is closing';
  } else if (view.state === 'idle') {
    status = 'stale';
    reason = 'session is idle';
  } else {
    status = 'healthy';
    reason = 'session is active';
  }

  return Object.freeze({
    schemaVersion: 1,
    handleId: view.handleId,
    status,
    checkedAt: now,
    nextCheckAt: now + NEXT_CHECK_MS,
    retryCount: 0,
    reason
  });
}