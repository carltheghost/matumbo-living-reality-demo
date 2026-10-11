import test from 'node:test';
import assert from 'node:assert/strict';
import { startCameraFromButton } from '../camera-start-status.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const buttons = [
  { name: 'front-camera', facing: 'user', activeMessage: 'Two-hand tracking active locally.' },
  { name: 'rear-camera', facing: 'environment', activeMessage: 'Rear camera · two-hand tracking active locally.' },
];

for (const button of buttons) {
  test(`${button.name} does not announce active after delayed visibility cancellation`, async () => {
    const pending = deferred(), messages = [];
    const result = startCameraFromButton({
      facing: button.facing,
      start: async facing => { assert.equal(facing, button.facing); return pending.promise; },
      status: message => messages.push(message),
      activeMessage: button.activeMessage,
    });
    await Promise.resolve();
    pending.resolve(false);
    assert.equal(await result, false);
    assert.equal(messages.at(-1), 'Camera start canceled or stopped. Touch controls remain available.');
    assert.doesNotMatch(messages.at(-1), /tracking active/i);
  });

  test(`${button.name} does not announce active after delayed explicit stop`, async () => {
    const pending = deferred(), messages = [];
    const result = startCameraFromButton({
      facing: button.facing,
      start: async facing => { assert.equal(facing, button.facing); return pending.promise; },
      status: message => messages.push(message),
      activeMessage: button.activeMessage,
    });
    await Promise.resolve();
    pending.reject(new Error('Camera start stopped because the page was hidden.'));
    assert.equal(await result, false);
    assert.match(messages.at(-1), /page was hidden/);
    assert.doesNotMatch(messages.at(-1), /tracking active/i);
  });
}

test('camera button reports active only after a successful current session', async () => {
  const messages = [];
  assert.equal(await startCameraFromButton({
    facing: 'user', start: async () => true, status: message => messages.push(message),
    activeMessage: 'Two-hand tracking active locally.',
  }), true);
  assert.equal(messages.at(-1), 'Two-hand tracking active locally.');
});
