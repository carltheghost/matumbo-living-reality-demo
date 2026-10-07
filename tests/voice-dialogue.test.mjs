import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceDialogue } from '../src/domains/voice-dialogue.js';

function harness(overrides = {}) {
  const timers = new Map(); let nextId = 0;
  const calls = { capture: 0, finish: 0, abort: 0, submitted: [], spoken: [], states: [] };
  const api = createVoiceDialogue({
    beginCapture: () => calls.capture++, finishCapture: () => calls.finish++, abortCapture: () => calls.abort++,
    submit: async text => { calls.submitted.push(text); return `Reply to ${text}`; },
    speak: async text => { calls.spoken.push(text); return true; },
    onState: state => calls.states.push(state),
    setTimer: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id),
    ...overrides,
  });
  async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
  function runTimer(ms) {
    const row = [...timers].find(([, timer]) => timer.ms === ms);
    assert.ok(row, `Expected a ${ms}ms voice timer.`);
    timers.delete(row[0]); row[1].fn();
  }
  return { api, calls, timers, runTimer, flush };
}

test('dialogue sends a finalized pause, speaks its answer, then listens for the next turn', async () => {
  const h = harness();
  assert.equal(h.api.start(), true);
  assert.equal(h.calls.capture, 1);
  h.api.update({ status: 'listening', transcript: 'Find the room', interim: '' });
  h.api.update({ status: 'listening', transcript: 'Find the room', interim: ' next' });
  assert.equal(h.timers.size, 0, 'Interim words defer automatic sending.');
  h.api.update({ status: 'listening', transcript: 'Find the room next', interim: '' });
  h.runTimer(900);
  assert.equal(h.calls.finish, 1, 'Silence asks recognition for its final words.');
  h.api.update({ status: 'stopped', transcript: 'Find the room next' });
  await h.flush();
  assert.deepEqual(h.calls.submitted, ['Find the room next']);
  assert.deepEqual(h.calls.spoken, ['Reply to Find the room next']);
  assert.equal(h.api.getSnapshot().phase, 'listening');
  assert.equal(h.calls.capture, 2);
  h.api.stop();
  assert.equal(h.api.getSnapshot().running, false);
  assert.equal(h.calls.abort, 1);
});

test('stopping during a provider request prevents late speech and microphone restart', async () => {
  let resolveReply;
  const h = harness({ submit: async text => { h.calls.submitted.push(text); return new Promise(resolve => { resolveReply = resolve; }); } });
  h.api.start(); h.api.update({ status: 'stopped', transcript: 'Stop me' });
  await Promise.resolve();
  assert.equal(h.api.getSnapshot().phase, 'sending');
  h.api.stop(); resolveReply('Late answer'); await h.flush();
  assert.deepEqual(h.calls.spoken, []);
  assert.equal(h.calls.capture, 1);
});

test('provider or speech failure ends the dialogue visibly without retrying or resending', async () => {
  const h = harness({ submit: async () => { throw new Error('Bridge unavailable'); } });
  h.api.start(); h.api.update({ status: 'stopped', transcript: 'Hello' }); await h.flush();
  assert.equal(h.api.getSnapshot().running, false);
  assert.equal(h.api.getSnapshot().phase, 'error');
  assert.match(h.api.getSnapshot().error, /Bridge unavailable/);
  assert.equal(h.calls.capture, 1);
  assert.deepEqual(h.calls.spoken, []);
});

test('empty speech pauses never produce provider calls and can restart recognition', () => {
  const h = harness(); h.api.start(); h.api.update({ status: 'stopped', transcript: '', reason: 'ended' });
  assert.deepEqual(h.calls.submitted, []);
  h.runTimer(500);
  assert.equal(h.calls.capture, 2);
  h.api.stop();
});
