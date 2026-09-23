import test from "node:test";
import assert from "node:assert/strict";

import {
  createSpacetimeLog,
  appendSpacetimeEntry,
} from "../src/spacetime-log.js";

import {
  exportLog,
  importLog,
  replay,
  filterByType,
} from "../src/domains/spacetime-replay.js";

test("export/import round-trip preserves order and content", () => {
  const log = createSpacetimeLog();

  appendSpacetimeEntry(log, {
    sequence: 1,
    timestamp: 100,
    type: "created",
    value: { id: "a" },
  });

  appendSpacetimeEntry(log, {
    sequence: 2,
    timestamp: 200,
    type: "moved",
    value: { x: 4, y: 8 },
  });

  appendSpacetimeEntry(log, {
    sequence: 3,
    timestamp: 300,
    type: "removed",
    value: { id: "a" },
  });

  const before = JSON.stringify(log);
  const json = exportLog(log);
  const restored = importLog(json);

  assert.deepEqual(restored, log);
  assert.equal(JSON.stringify(log), before);
});

test("replay calls handlers in order and counts unknown types", () => {
  const log = createSpacetimeLog();

  appendSpacetimeEntry(log, {
    sequence: 1,
    timestamp: 100,
    type: "created",
    value: { id: "a" },
  });

  appendSpacetimeEntry(log, {
    sequence: 2,
    timestamp: 200,
    type: "unknown",
    value: { id: "b" },
  });

  appendSpacetimeEntry(log, {
    sequence: 3,
    timestamp: 300,
    type: "moved",
    value: { x: 5 },
  });

  const seen = [];

  const result = replay(log, {
    created(entry) {
      seen.push(["created", entry.sequence]);
    },
    moved(entry) {
      seen.push(["moved", entry.sequence]);
    },
  });

  assert.deepEqual(seen, [
    ["created", 1],
    ["moved", 3],
  ]);

  assert.deepEqual(result, { unknown: 1 });
});

test("filterByType returns matching entries without mutating the log", () => {
  const log = createSpacetimeLog();

  appendSpacetimeEntry(log, {
    sequence: 1,
    timestamp: 100,
    type: "created",
    value: { id: "a" },
  });

  appendSpacetimeEntry(log, {
    sequence: 2,
    timestamp: 200,
    type: "moved",
    value: { x: 1 },
  });

  appendSpacetimeEntry(log, {
    sequence: 3,
    timestamp: 300,
    type: "moved",
    value: { x: 2 },
  });

  const before = JSON.stringify(log);
  const result = filterByType(log, "moved");

  assert.deepEqual(result, [
    {
      sequence: 2,
      timestamp: 200,
      type: "moved",
      value: { x: 1 },
    },
    {
      sequence: 3,
      timestamp: 300,
      type: "moved",
      value: { x: 2 },
    },
  ]);

  assert.equal(JSON.stringify(log), before);
});

test("malformed import throws", () => {
  assert.throws(
    () => importLog("{not valid json"),
    SyntaxError,
  );
});
