/**
 * Browser half of the optional Vivo conversation contract.
 *
 * This module is deliberately inert until a caller supplies an explicitly
 * authorized, same-origin session and calls connect().  It never discovers a
 * provider, stores a bearer, follows a proxy URL, or fabricates a reply.
 */

export const CONVERSATION_PROVIDER_SCHEMA = 'vivo.conversation-provider/1';
export const CONVERSATION_SCHEMA = 'vivo.conversation/2';
export const CONVERSATION_REACTIONS = Object.freeze(['pulse', 'warmth', 'spark', 'attention', 'path']);

const REACTION_SET = new Set(CONVERSATION_REACTIONS);
const IDENTIFIER_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_MESSAGE_CHARS = 400;
const MAX_OUTPUT_CHARS = 4000;
const MAX_CONTEXT_TEXT = 240;
const MAX_SESSION_ID = 80;
const DEFAULT_TIMEOUT_MS = 18_000;
const MAX_TIMEOUT_MS = 60_000;
const CONVERSATION_STATUS_PATH = '/api/conversation/status';
const CONVERSATION_RESPOND_PATH = '/api/conversation/respond';

const clone = value => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

function transportError(code, message = code, properties = {}) {
  const error = new Error(message);
  error.name = 'ConversationTransportError';
  error.code = code;
  error.retryable = false;
  Object.assign(error, properties);
  return error;
}

function cancellationError(reason = 'conversation-stopped') {
  const error = new Error(typeof reason === 'string' && reason ? reason : 'conversation-stopped');
  error.name = 'AbortError';
  error.code = 'CONVERSATION_CANCELLED';
  error.retryable = false;
  error.reason = typeof reason === 'string' ? reason.slice(0, 80) : 'conversation-stopped';
  return error;
}

function validateText(value, maximum, code, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw transportError(code);
  }
  if (typeof value !== 'string') throw transportError(code);
  const text = value.trim();
  if ((required && !text) || text.length > maximum) throw transportError(code);
  return text;
}

function identifier(value, code, { required = false } = {}) {
  const text = validateText(value, MAX_SESSION_ID, code, { required });
  if (text !== null && !IDENTIFIER_RE.test(text)) throw transportError(code);
  return text;
}

function optionalContextText(value, maximum = MAX_CONTEXT_TEXT) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw transportError('COMPANION_CONTEXT_INVALID');
  const text = value.trim();
  if (text.length > maximum) throw transportError('COMPANION_CONTEXT_INVALID');
  return text || null;
}

function boundedCoordinate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw transportError('WORLD_CONTEXT_INVALID');
  return Math.max(-100, Math.min(100, value));
}

function sanitizeCompanion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw transportError('COMPANION_CONTEXT_INVALID');
  const id = identifier(value.id, 'COMPANION_CONTEXT_INVALID', { required: true });
  const result = { id };
  for (const [key, maximum] of [
    ['entityId', 80],
    ['name', 80],
    ['role', 120],
    ['shortRole', 80],
    ['description', 240],
    ['silhouette', 48],
  ]) {
    const text = optionalContextText(value[key], maximum);
    if (text !== null) result[key] = text;
  }
  return result;
}

function sanitizeWorld(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw transportError('WORLD_CONTEXT_INVALID');
  const worldId = identifier(value.worldId, 'WORLD_CONTEXT_INVALID', { required: true });
  const spaceId = identifier(value.spaceId, 'WORLD_CONTEXT_INVALID', { required: true });
  const dimension = value.dimension;
  if (!Number.isInteger(dimension) || dimension < 2 || dimension > 11) throw transportError('WORLD_CONTEXT_INVALID');
  const result = {
    worldId,
    branchId: identifier(value.branchId, 'WORLD_CONTEXT_INVALID') || null,
    eyeId: identifier(value.eyeId, 'WORLD_CONTEXT_INVALID') || null,
    spaceId,
    dimension,
    entity: null,
  };
  if (value.entity !== undefined && value.entity !== null) {
    const entity = value.entity;
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) throw transportError('WORLD_CONTEXT_INVALID');
    const entityId = identifier(entity.id, 'WORLD_CONTEXT_INVALID', { required: true });
    const name = validateText(entity.name, 80, 'WORLD_CONTEXT_INVALID', { required: true });
    if (!Array.isArray(entity.q) || entity.q.length !== dimension) throw transportError('WORLD_CONTEXT_INVALID');
    const revision = entity.revision === undefined ? 0 : entity.revision;
    if (!Number.isInteger(revision) || revision < 0 || revision > 2 ** 31 - 1) throw transportError('WORLD_CONTEXT_INVALID');
    result.entity = { id: entityId, name, q: entity.q.map(boundedCoordinate), revision };
  }
  return result;
}

export function sanitizeConversationRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw transportError('REQUEST_INVALID');
  const message = validateText(value.message, MAX_MESSAGE_CHARS, 'MESSAGE_INVALID', { required: true });
  const companion = sanitizeCompanion(value.companion);
  const world = sanitizeWorld(value.world);
  return { message, companion, world };
}

export function normalizeConversationReply(value, { requestId, generation } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw transportError('CONVERSATION_PROTOCOL_ERROR');
  if (value.schema !== CONVERSATION_SCHEMA || value.status !== 'complete') throw transportError('CONVERSATION_PROTOCOL_ERROR');
  if (requestId !== undefined && value.requestId !== requestId) throw transportError('CONVERSATION_CORRELATION_ERROR');
  if (generation !== undefined && value.generation !== generation) throw transportError('CONVERSATION_CORRELATION_ERROR');
  const text = validateText(value.text, MAX_OUTPUT_CHARS, 'CONVERSATION_PROTOCOL_ERROR', { required: true });
  const reaction = typeof value.reaction === 'string' && REACTION_SET.has(value.reaction.trim())
    ? value.reaction.trim()
    : null;
  return {
    schema: CONVERSATION_SCHEMA,
    status: 'complete',
    requestId: value.requestId,
    conversationId: typeof value.conversationId === 'string' ? value.conversationId.slice(0, MAX_SESSION_ID) : null,
    generation: value.generation,
    text,
    reaction,
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function pageOrigin(locationLike) {
  if (!locationLike) return null;
  try {
    const value = locationLike.origin || new URL(locationLike.href).origin;
    return value && value !== 'null' ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

function sameOrigin(value, locationLike) {
  let parsed;
  try { parsed = new URL(value); } catch { throw transportError('CONVERSATION_ORIGIN_INVALID'); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw transportError('CONVERSATION_ORIGIN_INVALID');
  }
  const current = pageOrigin(locationLike);
  if (current && parsed.origin !== current) throw transportError('CONVERSATION_CROSS_ORIGIN_DISABLED');
  return parsed.origin;
}

function endpoint(origin, path, allowedPath, code) {
  if (typeof path !== 'string' || path !== allowedPath) throw transportError(code);
  let url;
  try { url = new URL(path, `${origin}/`); } catch { throw transportError(code); }
  if (
    url.origin !== origin
    || url.pathname !== allowedPath
    || url.search
    || url.hash
    || url.href !== `${origin}${allowedPath}`
  ) throw transportError(code);
  return url.href;
}

function generatedSessionId(cryptoLike) {
  if (!cryptoLike || typeof cryptoLike.randomUUID !== 'function') throw transportError('SESSION_ID_UNAVAILABLE');
  return `phone-tab-${cryptoLike.randomUUID()}`;
}

function responseErrorCode(response, body) {
  const candidate = body && typeof body.error === 'string' && ERROR_CODE_RE.test(body.error) ? body.error : null;
  if (candidate) return candidate;
  if (response.status === 401) return 'AUTH_REQUIRED';
  if (response.status === 403) return 'ORIGIN_NOT_ALLOWED';
  if (response.status === 503) return 'CONVERSATION_UNAVAILABLE';
  return 'CONVERSATION_HTTP_ERROR';
}

function stableHttpError(response, body) {
  const code = responseErrorCode(response, body);
  return transportError(code, code, { status: response.status, requestId: body?.requestId || null });
}

function asAbortError(error, signal) {
  if (signal?.aborted || error?.name === 'AbortError') return cancellationError(signal?.reason);
  return null;
}

/**
 * Create a provider for one explicitly admitted remote Vivo session.
 * Construction performs no I/O. Call connect() before respond().
 */
export function createRemoteConversationProvider({
  token,
  origin,
  location: locationLike = globalThis.location,
  sessionId,
  fetch: fetchImpl = globalThis.fetch,
  crypto: cryptoLike = globalThis.crypto,
  statusPath = CONVERSATION_STATUS_PATH,
  respondPath = CONVERSATION_RESPOND_PATH,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof token !== 'string' || token.trim().length < 20 || token.trim().length > 256) throw transportError('AUTH_REQUIRED');
  if (typeof fetchImpl !== 'function') throw transportError('CONVERSATION_FETCH_UNAVAILABLE');
  const bearer = token.trim();
  const resolvedOrigin = sameOrigin(origin || pageOrigin(locationLike), locationLike);
  const statusUrl = endpoint(resolvedOrigin, statusPath, CONVERSATION_STATUS_PATH, 'CONVERSATION_STATUS_PATH_INVALID');
  const respondUrl = endpoint(resolvedOrigin, respondPath, CONVERSATION_RESPOND_PATH, 'CONVERSATION_RESPOND_PATH_INVALID');
  const tabId = identifier(sessionId || generatedSessionId(cryptoLike), 'SESSION_INVALID', { required: true });
  const requestTimeout = Math.max(1, Math.min(MAX_TIMEOUT_MS, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  let closed = false;
  let available = false;
  let statusSnapshot = null;
  let statusPromise = null;
  let statusController = null;
  let serial = 0;
  let generation = 0;
  const pending = new Map();
  const completed = new Map();

  const rememberCompleted = (requestId, fingerprint, result, failure) => {
    completed.set(requestId, {
      fingerprint,
      result: result ? clone(result) : null,
      error: failure ? { code: failure.code || 'CONVERSATION_FAILED', message: failure.message || failure.code, status: failure.status || 0, reason: failure.reason } : null,
    });
    while (completed.size > 64) completed.delete(completed.keys().next().value);
  };
  const replayCompleted = entry => {
    if (entry.error) {
      const error = transportError(entry.error.code, entry.error.message, { status: entry.error.status, reason: entry.error.reason });
      if (error.code === 'CONVERSATION_CANCELLED') { error.name = 'AbortError'; }
      return Promise.reject(error);
    }
    return Promise.resolve(clone(entry.result));
  };
  const ensureOpen = () => {
    if (closed) throw transportError('CONVERSATION_CLOSED');
  };
  const ensureAvailable = () => {
    ensureOpen();
    if (!available) throw transportError('CONVERSATION_UNAVAILABLE');
  };

  async function requestJson(url, init = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: init.method || 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${bearer}`,
          ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body,
        credentials: 'omit',
        cache: 'no-store',
        mode: 'same-origin',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: init.signal,
      });
    } catch (error) {
      const abort = asAbortError(error, init.signal);
      if (abort) throw abort;
      throw transportError('CONVERSATION_NETWORK');
    }
    let body = null;
    try { body = await response.json(); } catch { /* stable protocol/http errors below */ }
    if (!response.ok) throw stableHttpError(response, body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw transportError('CONVERSATION_PROTOCOL_ERROR');
    return body;
  }

  async function connect({ signal } = {}) {
    ensureOpen();
    if (available && statusSnapshot) return clone(statusSnapshot);
    if (statusPromise) return statusPromise;
    const controller = new AbortController();
    statusController = controller;
    const forwardAbort = () => controller.abort(signal.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener?.('abort', forwardAbort, { once: true });
    statusPromise = (async () => {
      try {
        const body = await requestJson(statusUrl, { signal: controller.signal });
        if (closed) throw transportError('CONVERSATION_CLOSED');
        if (body.schema !== CONVERSATION_SCHEMA) throw transportError('CONVERSATION_PROTOCOL_ERROR');
        statusSnapshot = clone(body);
        if (body.available !== true || body.status !== 'ready') {
          available = false;
          throw transportError('CONVERSATION_UNAVAILABLE', 'CONVERSATION_UNAVAILABLE', { reason: body.reason || 'provider-unavailable' });
        }
        available = true;
        return clone(body);
      } catch (error) {
        available = false;
        const abort = asAbortError(error, controller.signal);
        if (abort) throw abort;
        if (error?.code) throw error;
        throw transportError('CONVERSATION_NETWORK');
      } finally {
        signal?.removeEventListener?.('abort', forwardAbort);
        if (statusController === controller) statusController = null;
        statusPromise = null;
      }
    })();
    return statusPromise;
  }

  function abortOwner(entry, reason) {
    if (entry.done) return;
    entry.abortReason = typeof reason === 'string' && reason ? reason : 'conversation-stopped';
    if (!entry.controller.signal.aborted) entry.controller.abort(entry.abortReason);
  }

  function attachWaiter(entry, signal, owner) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener?.('abort', onAbort);
        callback(value);
      };
      const onAbort = () => {
        if (owner) abortOwner(entry, signal.reason);
        finish(reject, owner ? cancellationError(signal.reason) : cancellationError(signal.reason));
      };
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener?.('abort', onAbort, { once: true });
      entry.promise.then(
        value => finish(resolve, clone(value)),
        error => finish(reject, error),
      );
    });
  }

  async function runRespond(entry) {
    let timer = null;
    let timedOut = false;
    const timeout = () => {
      timedOut = true;
      abortOwner(entry, 'CONVERSATION_TIMEOUT');
    };
    timer = globalThis.setTimeout?.(timeout, requestTimeout) || null;
    try {
      const body = await requestJson(respondUrl, {
        method: 'POST',
        body: JSON.stringify(entry.payload),
        signal: entry.controller.signal,
      });
      if (timedOut) throw transportError('CONVERSATION_TIMEOUT');
      if (entry.controller.signal.aborted) throw cancellationError(entry.abortReason);
      const result = normalizeConversationReply(body, {
        requestId: entry.payload.requestId,
        generation: entry.payload.generation,
      });
      rememberCompleted(entry.payload.requestId, entry.fingerprint, result, null);
      return result;
    } catch (error) {
      const failure = timedOut
        ? transportError('CONVERSATION_TIMEOUT')
        : (entry.controller.signal.aborted ? cancellationError(entry.abortReason) : (error?.code ? error : transportError('CONVERSATION_NETWORK')));
      rememberCompleted(entry.payload.requestId, entry.fingerprint, null, failure);
      throw failure;
    } finally {
      if (timer !== null) globalThis.clearTimeout?.(timer);
      entry.done = true;
      pending.delete(entry.payload.requestId);
    }
  }

  function nextRequestId() {
    let candidate;
    do candidate = `phone.turn.${++serial}`;
    while (pending.has(candidate) || completed.has(candidate));
    return candidate;
  }

  async function respond(input = {}) {
    ensureAvailable();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw transportError('REQUEST_INVALID');
    const scoped = sanitizeConversationRequest(input);
    const requestId = input.requestId === undefined ? nextRequestId() : identifier(input.requestId, 'REQUEST_ID_INVALID', { required: true });
    const nextGeneration = input.generation === undefined ? generation + 1 : input.generation;
    if (!Number.isInteger(nextGeneration) || nextGeneration < 0 || nextGeneration > 1_000_000) throw transportError('GENERATION_INVALID');
    generation = Math.max(generation, nextGeneration);
    const payload = {
      sessionId: tabId,
      requestId,
      generation: nextGeneration,
      message: scoped.message,
      companion: scoped.companion,
      world: scoped.world,
    };
    const fingerprint = stableStringify(payload);
    const old = pending.get(requestId);
    if (old) {
      if (old.fingerprint !== fingerprint) return Promise.reject(transportError('REQUEST_ID_REUSED'));
      return attachWaiter(old, input.signal, false);
    }
    const done = completed.get(requestId);
    if (done) {
      if (done.fingerprint !== fingerprint) return Promise.reject(transportError('REQUEST_ID_REUSED'));
      return replayCompleted(done);
    }
    const entry = {
      payload,
      fingerprint,
      controller: new AbortController(),
      abortReason: 'conversation-stopped',
      done: false,
      promise: null,
    };
    entry.promise = runRespond(entry);
    pending.set(requestId, entry);
    return attachWaiter(entry, input.signal, true);
  }

  async function close() {
    if (closed) return;
    closed = true;
    available = false;
    statusController?.abort('conversation-closed');
    for (const entry of pending.values()) abortOwner(entry, 'conversation-closed');
    await Promise.all([
      ...(statusPromise ? [statusPromise.catch(() => null)] : []),
      ...[...pending.values()].map(entry => entry.promise.catch(() => null)),
    ]);
    pending.clear();
    completed.clear();
    statusSnapshot = null;
  }

  const provider = {
    schema: CONVERSATION_PROVIDER_SCHEMA,
    get available() { return available && !closed; },
    get sessionId() { return tabId; },
    connect,
    status: connect,
    respond,
    close,
  };
  return provider;
}
