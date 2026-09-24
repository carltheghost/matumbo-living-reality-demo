const LOG_KEY = "matumbo_spacetime_log_v1";

function readLog() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLog(entries) {
  localStorage.setItem(LOG_KEY, JSON.stringify(entries));
}

export function appendSpacetimeEvent(type, objectId, payload = {}) {
  const log = readLog();

  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    type,
    objectId,
    timestamp: Date.now(),
    payload,
  };

  log.push(entry);
  saveLog(log);

  return entry;
}

export function getSpacetimeLog() {
  return readLog();
}

export function replaySpacetimeObject(objectId, applyEvent) {
  return readLog()
    .filter((event) => event.objectId === objectId)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((event) => applyEvent(event));
}
