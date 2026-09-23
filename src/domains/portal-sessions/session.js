const STATES = Object.freeze(['created', 'active', 'idle', 'closing', 'closed']);
const HEALTH_VIEW = Symbol('portal-session-health-view');

const ALLOWED = Object.freeze({
  created: new Set(['active']),
  active: new Set(['idle']),
  idle: new Set(['closing']),
  closing: new Set(['closed']),
  closed: new Set()
});

function assertHandle(handle) {
  if (!handle || typeof handle !== 'object' ||
      typeof handle.handleId !== 'string' ||
      typeof handle.serviceId !== 'string' ||
      typeof handle.status !== 'string') {
    throw new TypeError('invalid session handle');
  }
}

export function createSession(handle, { onEvent } = {}) {
  assertHandle(handle);
  if (onEvent !== undefined && typeof onEvent !== 'function') {
    throw new TypeError('onEvent must be a function');
  }

  let state = 'created';
  let lastAt;
  let closedReason;

  const emit = (from, to, at) => {
    if (onEvent) onEvent(Object.freeze({ type: 'session-transition', from, to, at }));
  };

  const transition = (to, at) => {
    if (state === 'closed') throw new Error('closed session cannot be reused');
    if (!ALLOWED[state].has(to)) {
      throw new Error(`illegal session transition: ${state} -> ${to}`);
    }
    if (!Number.isFinite(at)) throw new TypeError('transition timestamp must be finite');
    const from = state;
    state = to;
    lastAt = at;
    emit(from, to, at);
  };

  const ensureUsable = () => {
    if (state === 'closed') throw new Error('closed session cannot be reused');
  };

  const session = {
    get handleId() {
      return handle.handleId;
    },
    get serviceId() {
      return handle.serviceId;
    },
    get status() {
      return state;
    },
    activate(at = 0) {
      ensureUsable();
      transition('active', at);
      return session;
    },
    markIdle(at = 0) {
      ensureUsable();
      transition('idle', at);
      return session;
    },
    close(reason = 'closed', at = 0) {
      ensureUsable();
      if (typeof reason !== 'string' || reason.length === 0) {
        throw new TypeError('reason must be a non-empty string');
      }
      transition('closing', at);
      closedReason = reason;
      transition('closed', at);
      return session;
    },
    [HEALTH_VIEW]() {
      return Object.freeze({
        handleId: handle.handleId,
        handleStatus: handle.status,
        expiresAt: handle.expiresAt,
        state,
        lastAt,
        closedReason
      });
    }
  };

  return Object.freeze(session);
}

export const sessionHealthView = HEALTH_VIEW;
export { STATES };
