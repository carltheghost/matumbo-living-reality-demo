import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialRoom } from '../social-room.mjs';
const residents = [{ id: 'muse', name: 'Muse' }, { id: 'dot', name: 'dot' }, { id: 'grok', name: 'Grok' }];
const options = { participants: ['muse', 'dot', 'grok'], topic: 'Build together', maxTurns: 6 };
function fixture(respond = async ({ resident }) => ({ text: `Hello from ${resident.id}` }), extra = {}) {
  const connections = new Map(residents.map(r => [r.id, { connected: true, key: r.id, respond }]));
  return { connections, room: createSocialRoom({ residents, resolveConnection: id => connections.get(id), ...extra }) };
}
test('round robin shares real prior replies and never exceeds total budget', async () => {
  const requests = [];
  const { room } = fixture(async request => { requests.push(request); request.transcript.push({ text: 'adapter mutation' }); return { text: `reply ${requests.length}` }; });
  const result = await room.start(options);
  assert.equal(result.status, 'complete');
  assert.deepEqual(requests.map(r => r.resident.id), ['muse', 'dot', 'grok', 'muse', 'dot', 'grok']);
  assert.equal(requests[1].transcript[0].text, 'reply 1');
  assert.equal(result.messages.length, 6);
  assert.ok(result.messages.every(m => m.text !== 'adapter mutation'));
  result.messages.length = 0;
  assert.equal(room.snapshot().messages.length, 6);
});
test('disconnected resident blocks all requests before starting', async () => {
  let calls = 0; const { room, connections } = fixture(async () => { calls++; });
  connections.delete('dot');
  await assert.rejects(room.start(options));
  assert.equal(calls, 0); assert.equal(room.snapshot().status, 'idle');
});
test('stop aborts pending turn, ignores late reply, and permits a fresh explicit run', async () => {
  let finish, signal;
  const { room, connections } = fixture(request => { signal = request.signal; return new Promise(resolve => { finish = resolve; }); });
  const run = room.start(options); await Promise.resolve();
  await assert.rejects(room.start(options), /already running/);
  room.stop(); assert.equal(signal.aborted, true);
  assert.equal((await run).status, 'stopped');
  for (const c of connections.values()) c.respond = async () => ({ text: 'new reply' });
  const fresh = await room.start({ ...options, maxTurns: 1 });
  finish({ text: 'late reply' }); await Promise.resolve();
  assert.equal(fresh.messages.length, 1); assert.equal(room.snapshot().messages[0].text, 'new reply');
});
test('account change during a request drops its response and stops following turns', async () => {
  let finish; const { room, connections } = fixture(() => new Promise(resolve => { finish = resolve; }));
  const run = room.start(options); await Promise.resolve();
  connections.get('dot').key = 'another-account'; finish({ text: 'stale response' });
  const result = await run; assert.equal(result.status, 'blocked'); assert.equal(result.messages.length, 0);
});
test('provider failure does not fabricate speech or leak provider error text', async () => {
  const { room } = fixture(async () => { throw new Error('secret token'); });
  const result = await room.start(options);
  assert.equal(result.status, 'blocked'); assert.deepEqual(result.messages, []); assert.ok(!JSON.stringify(result).includes('secret token'));
});
test('timeout bounds an unresponsive provider even if it ignores abort', async () => {
  const { room } = fixture(() => new Promise(() => {}), { timeoutMs: 5 });
  assert.equal((await room.start(options)).status, 'blocked');
});
test('invalid selections, budgets and replies are rejected', async () => {
  const { room } = fixture(async () => ({ text: '' }));
  for (const change of [{ participants: ['muse', 'muse'] }, { participants: ['muse', 'unknown'] }, { maxTurns: 13 }, { maxTurns: 0 }, { topic: '' }]) await assert.rejects(room.start({ ...options, ...change }));
  assert.equal((await room.start(options)).status, 'blocked');
});
test('view-triggered stop prevents the next request and destroy cannot restart', async () => {
  let room, calls = 0;
  ({ room } = fixture(async () => { calls++; return { text: 'hello' }; }, { onChange(state) { if (state.turns === 1) room.stop(); } }));
  await room.start(options); assert.equal(calls, 1);
  room.destroy(); await assert.rejects(room.start(options));
});
