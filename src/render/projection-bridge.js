const PROJECTION_EVENT = 'simfabric:projection';
const INTENT_EVENT = 'simfabric:intent';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function freezeValue(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeValue(entry)));
  if (!isRecord(value)) return value;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeValue(entry)])),
  );
}

function entitiesFrom(projection) {
  if (Array.isArray(projection?.entities)) return projection.entities;
  if (isRecord(projection?.entities)) {
    return Object.entries(projection.entities).map(([id, entity]) => ({ id, ...entity }));
  }
  return [];
}

function readInitialProjection() {
  const fabric = window.SIMFABRIC;
  if (typeof fabric?.getProjection === 'function') return fabric.getProjection();
  return window.__SIMFABRIC_PROJECTION__ ?? null;
}

export function createProjectionBridge() {
  let snapshot = null;
  const subscribers = new Set();

  function publish(candidate) {
    if (!isRecord(candidate) || candidate.schemaVersion == null || !candidate.entities) return false;
    snapshot = Object.freeze({ ...candidate, entities: entitiesFrom(candidate) });
    subscribers.forEach((subscriber) => subscriber(snapshot));
    return true;
  }

  function onProjection(event) {
    publish(event.detail?.projection ?? event.detail);
  }

  window.addEventListener(PROJECTION_EVENT, onProjection);
  publish(readInitialProjection());

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(subscriber) {
      subscribers.add(subscriber);
      if (snapshot) subscriber(snapshot);
      return () => subscribers.delete(subscriber);
    },
    emitIntent(type, target, detail = {}) {
      const intent = Object.freeze({
        schemaVersion: 1,
        type,
        target,
        detail: freezeValue(detail),
        source: 'living-reality-renderer',
        simulation: true,
        createdAt: new Date().toISOString()
      });
      window.dispatchEvent(new CustomEvent(INTENT_EVENT, { detail: intent }));
      return intent;
    },
    destroy() {
      subscribers.clear();
      window.removeEventListener(PROJECTION_EVENT, onProjection);
    }
  });
}
