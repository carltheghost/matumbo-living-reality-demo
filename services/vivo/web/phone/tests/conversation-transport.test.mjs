import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRemoteConversationProvider } from '../../application/conversation-transport.mjs';

const ORIGIN = 'https://vivo.test';
const TOKEN = 'owner-test-conversation-token-0123456789';
const COMPANION = {
  id: 'relic', entityId: 'relic', name: 'Relic', role: 'Keeper of the field',
  shortRole: 'Keeper', description: 'A bounded companion.', silhouette: 'sentinel',
  color: '#should-not-cross', prompt: 'client decoration must not cross',
};
const WORLD = {
  worldId: 'world-1', branchId: 'branch-1', eyeId: 'eye-1', spaceId: 'root', dimension: 4,
  entity: { id: 'relic', name: 'Relic', q: [0, 0.5, 0.25, 0], revision: 4 },
};

const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return body; },
});

function fixtureFetch(handler, calls = []) {
  return async (url, init) => {
    const record = { url: String(url), init, body: init.body ? JSON.parse(init.body) : null };
    calls.push(record);
    return handler(record, calls);
  };
}

function readyOrUnavailable(record) {
  if (record.init.method === 'GET') return reply({ schema: 'vivo.conversation/2', status: 'ready', available: true });
  return reply({ schema: 'vivo.conversation/2', status: 'complete', requestId: record.body.requestId, generation: record.body.generation, conversationId: 'vivo-conv-fixture', text: 'fixture response', reaction: 'pulse' });
}

function provider(fetch, options = {}) {
  return createRemoteConversationProvider({
    token: TOKEN,
    origin: ORIGIN,
    location: { origin: ORIGIN },
    sessionId: 'phone-tab-fixture',
    fetch,
    ...options,
  });
}

function turn(overrides = {}) {
  return { message: 'What is this place?', companion: COMPANION, world: WORLD, ...overrides };
}

test('construction is inert and same-origin configuration fails closed', async () => {
  let calls = 0;
  const remote = provider(async () => { calls += 1; return reply({}); });
  assert.equal(remote.available, false);
  assert.equal(calls, 0);
  await assert.rejects(remote.respond(turn()), error => error.code === 'CONVERSATION_UNAVAILABLE');
  assert.equal(calls, 0);
  assert.throws(() => createRemoteConversationProvider({ token: TOKEN, origin: 'https://other.test', location: { origin: ORIGIN }, fetch: async () => reply({}) }), error => error.code === 'CONVERSATION_CROSS_ORIGIN_DISABLED');
  await remote.close();
});

test('only canonical normalized conversation routes are accepted before any bearer fetch', async () => {
  const rejected = [
    ['/api/conversation/../leak', 'CONVERSATION_RESPOND_PATH_INVALID'],
    ['/api/conversation/%2e%2e/leak', 'CONVERSATION_RESPOND_PATH_INVALID'],
    ['/api/conversation//leak', 'CONVERSATION_RESPOND_PATH_INVALID'],
    ['/api/conversation/\\leak', 'CONVERSATION_RESPOND_PATH_INVALID'],
    ['/api/conversation/respond?next=/leak', 'CONVERSATION_RESPOND_PATH_INVALID'],
    ['/api/conversation/respond#leak', 'CONVERSATION_RESPOND_PATH_INVALID'],
    ['https://vivo.test/api/conversation/respond', 'CONVERSATION_RESPOND_PATH_INVALID'],
    ['/api/conversation/respond/../leak', 'CONVERSATION_RESPOND_PATH_INVALID'],
  ];
  for (const [respondPath, code] of rejected) {
    let calls = 0;
    assert.throws(() => provider(async () => { calls += 1; return reply({}); }, { respondPath }), error => error.code === code);
    assert.equal(calls, 0, `rejected route must not fetch: ${respondPath}`);
  }

  for (const statusPath of ['/api/conversation/../leak', '/api/conversation/%2e%2e/leak', '/api/conversation//leak', '/api/conversation\\leak', '/api/conversation/status?leak=1', '/api/conversation/status#leak', 'https://vivo.test/api/conversation/status', '/api/conversation/status/../leak']) {
    let calls = 0;
    assert.throws(() => provider(async () => { calls += 1; return reply({}); }, { statusPath }), error => error.code === 'CONVERSATION_STATUS_PATH_INVALID');
    assert.equal(calls, 0, `rejected route must not fetch: ${statusPath}`);
  }

  const calls = [];
  const remote = provider(fixtureFetch(readyOrUnavailable, calls), {
    statusPath: '/api/conversation/status',
    respondPath: '/api/conversation/respond',
  });
  await remote.connect();
  assert.equal(remote.available, true);
  await remote.close();
  assert.deepEqual(calls.map(call => call.url), [`${ORIGIN}/api/conversation/status`]);
});

test('explicit connect sends only the authorized same-origin contract and sanitizes context', async () => {
  const calls = [];
  const remote = provider(fixtureFetch(readyOrUnavailable, calls));
  const status = await remote.connect();
  assert.equal(status.status, 'ready');
  assert.equal(remote.available, true);
  const result = await remote.respond(turn());
  assert.equal(result.text, 'fixture response');
  assert.equal(result.reaction, 'pulse');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${ORIGIN}/api/conversation/status`);
  assert.equal(calls[1].url, `${ORIGIN}/api/conversation/respond`);
  assert.equal(calls[1].init.credentials, 'omit');
  assert.equal(calls[1].init.cache, 'no-store');
  assert.equal(calls[1].init.redirect, 'error');
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[1].body.sessionId, 'phone-tab-fixture');
  assert.equal(calls[1].body.companion.color, undefined);
  assert.equal(calls[1].body.companion.prompt, undefined);
  assert.equal(calls[1].body.world.entity.q.length, 4);
  assert.equal(JSON.stringify(calls[1].body).includes(TOKEN), false);
  assert.equal(calls[1].url.includes(TOKEN), false);
  await remote.close();
});

test('redirected same-origin routes are rejected before a second bearer request', async () => {
  const calls = [];
  const server = createServer((request, response) => {
    calls.push({ url: request.url, authorization: request.headers.authorization });
    response.writeHead(302, { Location: '/api/conversation/leak' });
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const remote = createRemoteConversationProvider({
    token: TOKEN, origin, location: { origin }, sessionId: 'redirect-tab', fetch: globalThis.fetch,
  });
  try {
    await assert.rejects(remote.connect(), error => error.code === 'CONVERSATION_NETWORK');
    assert.deepEqual(calls, [{ url: '/api/conversation/status', authorization: `Bearer ${TOKEN}` }]);
    assert.equal(remote.available, false);
  } finally {
    await remote.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('a local HTTP server/provider fixture exercises the real fetch boundary', async () => {
  assert.equal(typeof globalThis.fetch, 'function');
  const calls = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET') {
      response.writeHead(200);
      response.end(JSON.stringify({ schema: 'vivo.conversation/2', status: 'ready', available: true }));
      return;
    }
    response.writeHead(200);
    response.end(JSON.stringify({
      schema: 'vivo.conversation/2', status: 'complete', requestId: body.requestId,
      generation: body.generation, conversationId: 'local-fixture', text: 'local server reply', reaction: 'warmth',
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const remote = createRemoteConversationProvider({
    token: TOKEN, origin, location: { origin }, sessionId: 'local-http-tab', fetch: globalThis.fetch,
  });
  try {
    await remote.connect();
    const result = await remote.respond(turn({ requestId: 'local.1', generation: 1 }));
    assert.equal(result.text, 'local server reply');
    assert.equal(result.reaction, 'warmth');
    assert.deepEqual(calls.map(call => call.method), ['GET', 'POST']);
    assert.equal(calls[0].url, '/api/conversation/status');
    assert.equal(calls[1].url, '/api/conversation/respond');
    assert.equal(calls[1].authorization, `Bearer ${TOKEN}`);
    assert.equal(JSON.stringify(calls[1].body).includes(TOKEN), false);
  } finally {
    await remote.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('unavailable and auth-denied status never enable the provider or fall back', async () => {
  const unavailable = provider(fixtureFetch(record => record.init.method === 'GET'
    ? reply({ schema: 'vivo.conversation/2', status: 'unavailable', available: false, reason: 'provider-not-configured' })
    : reply({})));
  await assert.rejects(unavailable.connect(), error => error.code === 'CONVERSATION_UNAVAILABLE');
  assert.equal(unavailable.available, false);
  await assert.rejects(unavailable.respond(turn()), error => error.code === 'CONVERSATION_UNAVAILABLE');
  await unavailable.close();

  const denied = provider(fixtureFetch(record => reply({ schema: 'vivo.conversation/2', status: 'error', error: 'AUTH_REQUIRED' }, 401)));
  await assert.rejects(denied.connect(), error => error.code === 'AUTH_REQUIRED' && error.status === 401);
  assert.equal(denied.available, false);
  await denied.close();
});

test('same request ID has one owner, cancellable duplicate waiters, and a reuse fence', async () => {
  const calls = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const remote = provider(fixtureFetch((record) => {
    if (record.init.method === 'GET') return reply({ schema: 'vivo.conversation/2', status: 'ready', available: true });
    return held.then(() => reply({ schema: 'vivo.conversation/2', status: 'complete', requestId: record.body.requestId, generation: record.body.generation, conversationId: 'vivo-conv-fixture', text: 'one owner', reaction: null }));
  }, calls));
  await remote.connect();
  const owner = remote.respond(turn({ requestId: 'phone.turn.same', generation: 1 }));
  await Promise.resolve();
  const waiterController = new AbortController();
  const waiter = remote.respond(turn({ requestId: 'phone.turn.same', generation: 1, signal: waiterController.signal }));
  waiterController.abort('selection-changed');
  await assert.rejects(waiter, error => error.code === 'CONVERSATION_CANCELLED' && error.name === 'AbortError');
  release();
  assert.equal((await owner).text, 'one owner');
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  await assert.rejects(remote.respond(turn({ requestId: 'phone.turn.same', generation: 1, message: 'different' })), error => error.code === 'REQUEST_ID_REUSED');
  await remote.close();
});

test('owner abort and timeout are terminal local fences with no automatic retry', async () => {
  for (const mode of ['abort', 'timeout']) {
    const calls = [];
    const remote = provider(fixtureFetch(record => {
      if (record.init.method === 'GET') return reply({ schema: 'vivo.conversation/2', status: 'ready', available: true });
      return new Promise((resolve, reject) => {
        record.init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        if (mode === 'abort') record.resolve = resolve;
      });
    }, calls), { timeoutMs: 20 });
    await remote.connect();
    const controller = new AbortController();
    const request = remote.respond(turn({ requestId: `terminal.${mode}`, generation: 1, signal: controller.signal }));
    if (mode === 'abort') controller.abort('navigation-changed');
    await assert.rejects(request, error => error.code === (mode === 'abort' ? 'CONVERSATION_CANCELLED' : 'CONVERSATION_TIMEOUT'));
    const postCount = calls.filter(call => call.init.method === 'POST').length;
    await assert.rejects(remote.respond(turn({ requestId: `terminal.${mode}`, generation: 1 })), error => error.code === (mode === 'abort' ? 'CONVERSATION_CANCELLED' : 'CONVERSATION_TIMEOUT'));
    assert.equal(calls.filter(call => call.init.method === 'POST').length, postCount);
    await remote.close();
  }
});

test('server errors and mismatched late replies are stable, fenced, and not retried', async () => {
  const calls = [];
  const remote = provider(fixtureFetch(record => {
    if (record.init.method === 'GET') return reply({ schema: 'vivo.conversation/2', status: 'ready', available: true });
    return reply({ schema: 'vivo.conversation/2', status: 'error', error: 'PROVIDER_TIMEOUT', requestId: record.body.requestId }, 504);
  }, calls));
  await remote.connect();
  await assert.rejects(remote.respond(turn({ requestId: 'server-error.1', generation: 1 })), error => error.code === 'PROVIDER_TIMEOUT' && error.status === 504);
  await assert.rejects(remote.respond(turn({ requestId: 'server-error.1', generation: 1 })), error => error.code === 'PROVIDER_TIMEOUT');
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  await remote.close();

  const mismatchCalls = [];
  const mismatch = provider(fixtureFetch(record => record.init.method === 'GET'
    ? reply({ schema: 'vivo.conversation/2', status: 'ready', available: true })
    : reply({ schema: 'vivo.conversation/2', status: 'complete', requestId: 'other', generation: record.body.generation, text: 'late', reaction: null }), mismatchCalls));
  await mismatch.connect();
  await assert.rejects(mismatch.respond(turn({ requestId: 'late.1', generation: 1 })), error => error.code === 'CONVERSATION_CORRELATION_ERROR');
  await assert.rejects(mismatch.respond(turn({ requestId: 'late.1', generation: 1 })), error => error.code === 'CONVERSATION_CORRELATION_ERROR');
  assert.equal(mismatchCalls.filter(call => call.init.method === 'POST').length, 1);
  await mismatch.close();
});

test('close fences the session and clears pending/terminal state', async () => {
  const remote = provider(fixtureFetch(readyOrUnavailable));
  await remote.connect();
  await remote.close();
  assert.equal(remote.available, false);
  await assert.rejects(remote.respond(turn()), error => error.code === 'CONVERSATION_CLOSED');
  await remote.close();
});
