const DATABASE = 'vivo-phone-local';
const VERSION = 1;
const STORE = 'worlds';
const fallback = new Map();

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Phone storage request failed'));
  });
}

export class IndexedDbWorldStore {
  constructor(scope = globalThis) { this.scope = scope; this.database = null; }
  async open() {
    if (!this.scope.indexedDB) return null;
    if (this.database) return this.database;
    const request = this.scope.indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    this.database = await requestResult(request);
    this.database.onversionchange = () => { this.database.close(); this.database = null; };
    return this.database;
  }
  async load(worldId) {
    const db = await this.open();
    const value = db ? await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(worldId)) : fallback.get(worldId);
    return value ? structuredClone(value) : null;
  }
  async save(worldId, envelope) {
    const db = await this.open(), value = structuredClone(envelope);
    if (!db) { fallback.set(worldId, value); return { persistent: false }; }
    const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, worldId);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    return { persistent: true };
  }
  async remove(worldId) {
    const db = await this.open();
    if (!db) return fallback.delete(worldId);
    const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(worldId);
    return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }
  async estimate() {
    try { return await this.scope.navigator?.storage?.estimate?.() || null; } catch { return null; }
  }
  async requestPersistence() {
    try { return !!(await this.scope.navigator?.storage?.persist?.()); } catch { return false; }
  }
  close() { this.database?.close(); this.database = null; }
}
