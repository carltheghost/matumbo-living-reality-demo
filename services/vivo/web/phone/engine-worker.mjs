import { LocalVivoEngine } from './engine.mjs';
import { IndexedDbWorldStore } from './storage.mjs';

const engine = new LocalVivoEngine({
  storage: new IndexedDbWorldStore(self),
  onChange: value => self.postMessage({ type: 'event', value }),
});
let clock = null;

async function dispatch(method, args) {
  if (!['open', 'snapshot', 'translate', 'step', 'setEye', 'createEye', 'selectEye', 'enterNested', 'exitNested', 'forkOffline', 'persist', 'close'].includes(method)) throw new TypeError('Unsupported local engine operation');
  const result = await engine[method](...args);
  if (['createEye', 'selectEye', 'enterNested', 'exitNested', 'forkOffline'].includes(method)) await engine.lastPersistence;
  if (method === 'translate' && !clock) {
    clock = setInterval(async () => {
      if (!engine.activeIds.size) { clearInterval(clock); clock = null; return; }
      try { await engine.step(1 / 30); } catch (error) { self.postMessage({ type: 'event', value: { reason: 'step-error', error: error.message } }); }
    }, 33);
  }
  if (method === 'close') { if (clock) clearInterval(clock); clock = null; }
  return result;
}

self.onmessage = async ({ data }) => {
  const { id, method, args = [] } = data || {};
  try { self.postMessage({ id, ok: true, value: await dispatch(method, args) }); }
  catch (error) { self.postMessage({ id, ok: false, error: error?.message || String(error) }); }
};
