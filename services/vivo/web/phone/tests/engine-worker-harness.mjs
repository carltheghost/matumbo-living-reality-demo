import { parentPort } from 'node:worker_threads';

// The production worker intentionally uses the browser `self` surface. This
// tiny test-only adapter keeps that surface intact while running the actual
// module worker under Node's worker_threads implementation.
globalThis.self = {
  postMessage: value => parentPort.postMessage(value),
};

await import('../engine-worker.mjs');

parentPort.on('message', value => self.onmessage?.({ data: value }));
