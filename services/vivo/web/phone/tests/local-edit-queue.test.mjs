import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalEditQueue } from '../local-edit-queue.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('stopping a contact lets a submitted edit finish but fences queued future edits', async () => {
  const queue = new LocalEditQueue(), first = deferred(), submissions = [];
  const firstRun = queue.enqueue({ submit: async () => { submissions.push('first'); return first.promise; } });
  await new Promise(resolve => setImmediate(resolve));
  const secondRun = queue.enqueue({ submit: async () => { submissions.push('second'); return 'second'; } });
  queue.stop();
  first.resolve('first');
  assert.deepEqual(await firstRun, { status: 'submitted-fenced', submitted: true, result: 'first' });
  assert.deepEqual(await secondRun, { status: 'fenced', submitted: false });
  assert.deepEqual(submissions, ['first']);
});

test('a stop before a deferred first submit prevents a branch-crossing mutation', async () => {
  const queue = new LocalEditQueue(), submissions = [];
  const pending = queue.enqueue({ submit: async () => { submissions.push('unexpected'); return true; } });
  queue.stop();
  assert.deepEqual(await pending, { status: 'fenced', submitted: false });
  assert.deepEqual(submissions, []);
});
