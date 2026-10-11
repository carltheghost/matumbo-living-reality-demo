/** Small request/response client; all simulation work stays in a Worker. */
export class PhoneEngineClient extends EventTarget {
  constructor({ WorkerImpl = globalThis.Worker, workerUrl = new URL('./engine-worker.mjs', import.meta.url) } = {}) {
    super();
    if (!WorkerImpl) throw new Error('This browser has no Worker support; the touch UI remains available.');
    this.worker = new WorkerImpl(workerUrl, { type: 'module', name: 'vivo-phone-engine' });
    this.nextId = 1; this.pending = new Map(); this.closed = false;
    this.worker.onmessage = ({ data }) => {
      if (data?.type === 'event') { this.dispatchEvent(new CustomEvent('statechange', { detail: data.value })); return; }
      const pending = this.pending.get(data?.id); if (!pending) return;
      this.pending.delete(data.id);
      if (data.ok) pending.resolve(data.value); else pending.reject(new Error(data.error || 'Phone engine request failed'));
    };
    this.worker.onerror = event => {
      for (const pending of this.pending.values()) pending.reject(new Error(event.message || 'Phone engine worker failed'));
      this.pending.clear();
    };
  }
  call(method, ...args) {
    if (this.closed) return Promise.reject(new Error('Phone engine is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, method, args }); });
  }
  open(worldId, rootDimension = 4) { return this.call('open', worldId, rootDimension); }
  snapshot() { return this.call('snapshot'); }
  translate(entityId, axis, delta) { return this.call('translate', entityId, axis, delta); }
  step(dt) { return this.call('step', dt); }
  setEye(patch) { return this.call('setEye', patch); }
  createEye(label) { return this.call('createEye', label); }
  selectEye(id) { return this.call('selectEye', id); }
  enterNested(entityId) { return this.call('enterNested', entityId); }
  exitNested() { return this.call('exitNested'); }
  forkOffline(label) { return this.call('forkOffline', label); }
  persist() { return this.call('persist'); }
  async close() { if (this.closed) return; try { await this.call('close'); } finally { this.closed = true; this.worker.terminate(); } }
}
