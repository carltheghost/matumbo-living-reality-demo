import {
  createSpacetimeLog,
  appendSpacetimeEntry,
} from "../spacetime-log.js";

export function exportLog(log) {
  return JSON.stringify(log);
}

export function importLog(json) {
  const parsed = JSON.parse(json);

  const entries = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.entries)
      ? parsed.entries
      : null;

  if (!entries) {
    throw new TypeError("Invalid spacetime log");
  }

  const log = createSpacetimeLog();

  for (const entry of entries) {
    appendSpacetimeEntry(log, entry);
  }

  return log;
}

export function replay(log, handlers) {
  let unknown = 0;

  for (const entry of log.entries) {
    const handler = handlers[entry.type];

    if (typeof handler === "function") {
      handler(entry);
    } else {
      unknown += 1;
    }
  }

  return { unknown };
}

export function filterByType(log, type) {
  return log.entries.filter((entry) => entry.type === type);
}
