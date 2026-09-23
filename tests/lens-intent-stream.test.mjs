import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntentStream } from '../src/render/lens-intent-stream.js';

test('semantic selection parity preserves type and targetId across supported select inputs', () => {
  const stream = createIntentStream();
  const inputs = [
    { source: 'hand', gesture: 'tap', targetId: 'card-1', timestamp: 1 },
    { source: 'gaze', gesture: 'dwell', dwellMs: 800, targetId: 'card-1', timestamp: 2 },
    { source: 'pinch', gesture: 'pinch', targetId: 'card-1', timestamp: 3 },
    { source: 'touch', gesture: 'tap', targetId: 'card-1', timestamp: 4 },
  ];

  const intents = inputs.map((input) => stream.emit(input));
  assert.deepEqual(intents.map((intent) => [intent.type, intent.targetId]), [
    ['select', 'card-1'],
    ['select', 'card-1'],
    ['select', 'card-1'],
    ['select', 'card-1'],
  ]);

  const voice = stream.emit({
    source: 'voice',
    transcript: 'select card-1',
    targetId: 'card-1',
    timestamp: 5
  });
  assert.deepEqual([voice.type, voice.targetId], ['voice-command', 'card-1']);
});

test('unknown source is dropped and counted', () => {
  const stream = createIntentStream();
  assert.equal(stream.emit({ source: 'keyboard', gesture: 'tap', timestamp: 1 }), null);
  assert.equal(stream.getDroppedCount(), 1);
});

test('every emitted intent is frozen', () => {
  const stream = createIntentStream();
  const intents = [
    stream.emit({ source: 'hand', gesture: 'grab', targetId: 'card-1', timestamp: 1 }),
    stream.emit({ source: 'gaze', gesture: 'dwell', dwellMs: 800, targetId: 'card-2', timestamp: 2 }),
    stream.emit({ source: 'pinch', gesture: 'pinch', targetId: 'card-3', timestamp: 3 }),
    stream.emit({ source: 'touch', gesture: 'tap', targetId: 'card-4', timestamp: 4 }),
    stream.emit({ source: 'voice', transcript: 'open', targetId: 'card-5', timestamp: 5 }),
  ];
  for (const intent of intents) assert.equal(Object.isFrozen(intent), true);
});

test('timestamp passes through unchanged', () => {
  const timestamp = 1700000000123;
  const stream = createIntentStream();
  const intent = stream.emit({
    source: 'touch',
    gesture: 'tap',
    targetId: 'card-1',
    timestamp
  });
  assert.equal(intent.timestamp, timestamp);
});

test('voice transcript lands in payload', () => {
  const stream = createIntentStream();
  const intent = stream.emit({
    source: 'voice',
    transcript: 'summon market',
    targetId: 'market',
    timestamp: 7
  });
  assert.deepEqual(intent.payload, { transcript: 'summon market' });
  assert.equal(intent.type, 'voice-command');
});

test('subscriber receives the same frozen intent', () => {
  const stream = createIntentStream();
  let received;
  const unsubscribe = stream.subscribe((intent) => {
    received = intent;
  });
  const emitted = stream.emit({ source: 'pinch', gesture: 'pinch', targetId: 'x', timestamp: 1 });
  assert.strictEqual(received, emitted);
  assert.equal(Object.isFrozen(received), true);
  unsubscribe();
});
