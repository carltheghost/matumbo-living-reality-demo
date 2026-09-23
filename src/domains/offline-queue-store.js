JavaScript
const STORAGE_KEY = 'reality-lens:offline-queue:v1';

export function createOfflineQueueStore(queue, storage) {
  if (!queue || typeof queue.snapshot !== 'function' || typeof queue.restore !== 'function') {
    throw new TypeError('queue must provide snapshot() and restore(snapshot)');
  }

  if (
    !storage ||
    typeof storage.getItem !== 'function' ||
    typeof storage.setItem !== 'function' ||
    typeof storage.removeItem !== 'function'
  ) {
    throw new TypeError('storage must provide getItem(), setItem(), and removeItem()');
  }

  return {
    save() {
      const snapshot = queue.snapshot();

      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new TypeError('queue snapshot must be an object');
      }

      storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      return true;
    },

    load() {
      const serialized = storage.getItem(STORAGE_KEY);

      if (serialized === null || serialized === undefined || serialized === '') {
        return 0;
      }

      const parsed = JSON.parse(serialized);

      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        throw new TypeError('invalid offline queue snapshot');
      }

      const restored = queue.restore(parsed);

      if (typeof restored === 'number') {
        return restored;
      }

      if (Array.isArray(restored)) {
        return restored.length;
      }

      if (restored === undefined) {
        const snapshot = queue.snapshot();

        if (Array.isArray(snapshot)) {
          return snapshot.length;
        }

        if (snapshot && Array.isArray(snapshot.items)) {
          return snapshot.items.length;
        }

        if (snapshot && Array.isArray(snapshot.actions)) {
          return snapshot.actions.length;
        }

        throw new TypeError('queue restore produced an invalid snapshot');
      }

      throw new TypeError('queue restore returned an invalid item count');
    }
  };
}