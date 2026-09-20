import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import {
  BLOCK_MIGRATION_MANIFEST,
  BLOCK_MIGRATION_SOURCE,
} from "../src/domains/block-migration.js";
import {
  DEFAULT_MIGRATION_SNAPSHOT,
  MIGRATION_SNAPSHOT_BOUNDARY,
  MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
  MIGRATION_SNAPSHOT_DOM_IDS,
  MIGRATION_SNAPSHOT_MAX_FILE_BYTES,
  createMigrationSnapshotConsole,
  createMigrationSnapshotFixture,
  serializeMigrationSnapshot,
  summarizeMigrationSnapshot,
  validateMigrationSnapshot,
} from "../src/render/migration-snapshot.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    classList: {
      values: new Set(),
      toggle(name, force) {
        if (force === true) this.values.add(name);
        else if (force === false) this.values.delete(name);
        else if (this.values.has(name)) this.values.delete(name);
        else this.values.add(name);
      },
    },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    focus() {},
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
    register(id, hidden = false, tag = "div") {
      const element = makeElement(documentRoot, tag);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
  };
  Object.entries(MIGRATION_SNAPSHOT_DOM_IDS).forEach(([key, id]) => {
    documentRoot.register(id, key === "panel", key === "input" ? "textarea" : "div");
  });
  return documentRoot;
}

test("snapshot validator accepts compact JSON and produces canonical safe mappings", () => {
  const fixture = createMigrationSnapshotFixture(BLOCK_MIGRATION_MANIFEST.entries.slice(0, 3));
  const result = validateMigrationSnapshot(serializeMigrationSnapshot(fixture));
  assert.equal(result.source, MIGRATION_SNAPSHOT_CONSOLE_SOURCE);
  assert.equal(result.valid, true);
  assert.equal(result.mappingCount, 3);
  assert.equal(result.safeCount, 3);
  assert.equal(result.deferredCount, 0);
  assert.equal(result.preview.source, "block-migration-preview");
  assert.deepEqual(result.preview.mappings.map((mapping) => mapping.mappingId), [
    "migration:world-scene-layout",
    "migration:world-games",
    "migration:world-contracts",
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.equal(Object.isFrozen(result.errors), true);
});

test("snapshot validation rejects malformed, unknown, duplicate, and executable-looking input without invoking it", () => {
  const malformed = validateMigrationSnapshot("{\"entries\":[");
  assert.equal(malformed.valid, false);
  assert.equal(malformed.errors[0].code, "invalid-json");

  const unknown = validateMigrationSnapshot({ entries: [{ id: "not-a-real-mapping" }] });
  assert.equal(unknown.valid, false);
  assert.equal(unknown.errors[0].code, "unknown-entry");

  const duplicate = validateMigrationSnapshot({ entries: [
    { id: "migration:world-contracts" },
    { legacyId: "world-contracts" },
  ] });
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.errors[0].code, "duplicate-entry");

  let called = false;
  const hostile = {
    entries: [{
      id: "migration:world-contracts",
      run: () => { called = true; },
      command: "publish",
    }],
  };
  const rejected = validateMigrationSnapshot(hostile);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.errors.some((error) => error.code === "forbidden-field"), true);
  assert.equal(called, false);

  let getterCalled = false;
  const getterFixture = { entries: [{ id: "migration:world-contracts" }] };
  Object.defineProperty(getterFixture.entries[0], "run", {
    enumerable: true,
    get() {
      getterCalled = true;
      return () => {};
    },
  });
  const getterResult = validateMigrationSnapshot(getterFixture);
  assert.equal(getterResult.valid, false);
  assert.equal(getterCalled, false);

  const cyclic = { entries: [{ id: "migration:world-contracts" }] };
  cyclic.self = cyclic;
  const cyclicResult = validateMigrationSnapshot(cyclic);
  assert.equal(cyclicResult.valid, false);
  assert.equal(cyclicResult.errors.some((error) => error.code === "cyclic-value"), true);
  assert.equal(cyclicResult.externalImport, false);
});

test("snapshot console loads, previews, applies, replays, and resets only a local draft", () => {
  const projection = createLivingRealityProjection().world;
  const before = JSON.stringify(projection);
  const documentRoot = makeDocument();
  const actions = [];
  const consoleAdapter = createMigrationSnapshotConsole({
    documentRoot,
    projection,
    onLoad: (snapshot) => actions.push(snapshot),
    onSelect: (snapshot) => actions.push(snapshot),
    onPreview: (snapshot) => actions.push(snapshot),
    onApply: (snapshot) => actions.push(snapshot),
    onReplay: (snapshot) => actions.push(snapshot),
    onReset: (snapshot) => actions.push(snapshot),
  });

  assert.equal(consoleAdapter.getSnapshot().source, MIGRATION_SNAPSHOT_CONSOLE_SOURCE);
  assert.equal(consoleAdapter.getSnapshot().opened, false);
  assert.equal(consoleAdapter.getSnapshot().validation.valid, true);
  assert.equal(consoleAdapter.getSnapshot().preview.applyCount, 5);

  const fixture = createMigrationSnapshotFixture(BLOCK_MIGRATION_MANIFEST.entries.slice(0, 2));
  const loaded = consoleAdapter.loadSnapshot(serializeMigrationSnapshot(fixture), "test");
  assert.equal(loaded.action, "load");
  assert.equal(loaded.accepted, true);
  assert.equal(loaded.validation.mappingCount, 2);

  const selected = consoleAdapter.selectMapping("migration:world-contracts", "test");
  assert.equal(selected, null); // not part of the two-entry fixture
  const preview = consoleAdapter.preview("test");
  assert.equal(preview.preview.applyCount, 2);
  const applied = consoleAdapter.apply("test");
  assert.equal(applied.action, "apply-local-draft");
  assert.equal(applied.draft.mappingIds.length, 2);
  assert.equal(consoleAdapter.getSnapshot().draft.draft.localDraft, true);

  const replay = consoleAdapter.replay("test");
  assert.equal(replay.action, "replay");
  assert.equal(replay.draft.mappingIds.length, 2);
  assert.equal(replay.replayCount, 1);
  const reset = consoleAdapter.reset("test");
  assert.equal(reset.action, "reset");
  assert.equal(consoleAdapter.getSnapshot().draft, null);
  assert.equal(consoleAdapter.getSnapshot().validation.valid, true);

  const invalid = consoleAdapter.loadSnapshot("{ broken", "test");
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.validation.valid, false);
  assert.equal(consoleAdapter.getSnapshot().preview, null);
  assert.equal(documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.validation).children.length > 0, true);
  const rejectedApply = consoleAdapter.apply("test");
  assert.equal(rejectedApply.accepted, false);
  assert.equal(rejectedApply.valid, false);
  assert.equal(actions.map((entry) => entry.action).join(","), "load,preview,apply-local-draft,replay,reset,load,apply");
  assert.equal(actions.every((entry) => entry.localOnly === true && entry.externalImport === false && entry.executable === false), true);
  assert.equal(JSON.stringify(projection), before);
  assert.equal(Object.isFrozen(consoleAdapter.getSnapshot()), true);
});

test("snapshot console imports one bounded local JSON file and keeps paths out of state", async () => {
  const documentRoot = makeDocument();
  const actions = [];
  const adapter = createMigrationSnapshotConsole({ documentRoot, onLoad: (result) => actions.push(result) });
  const fixture = createMigrationSnapshotFixture(BLOCK_MIGRATION_MANIFEST.entries.slice(0, 3));
  const payload = serializeMigrationSnapshot(fixture);
  const loaded = await adapter.loadFile({
    name: "migration.JSON",
    type: "application/json",
    size: payload.length,
    async text() { return payload; },
  }, "test-file");
  assert.equal(loaded.action, "load");
  assert.equal(loaded.method, "test-file");
  assert.equal(loaded.accepted, true);
  assert.equal(loaded.readInMemory, true);
  assert.equal(loaded.fileImport.status, "accepted");
  assert.equal(adapter.getSnapshot().validation.mappingCount, 3);
  assert.equal(adapter.getSnapshot().lastFileImport.readInMemory, true);
  assert.match(documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.status).textContent, /FILE LOADED/);

  const rejected = await adapter.loadFile({ name: "migration.txt", type: "text/plain", size: 4, async text() { return payload; } }, "test-type");
  assert.equal(rejected.action, "file-load");
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.validation.errors[0].code, "file-type");
  assert.equal(rejected.file.name, undefined);
  assert.match(documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.validation).children[0].textContent, /ERROR · \$file/);

  const oversized = await adapter.loadFile({
    name: "migration.json",
    type: "application/json",
    size: MIGRATION_SNAPSHOT_MAX_FILE_BYTES + 1,
    async text() { throw new Error("must not read oversized file"); },
  }, "test-size");
  assert.equal(oversized.validation.errors[0].code, "file-too-large");
  assert.equal(actions.length, 3);
  assert.equal(actions.every((entry) => entry.externalNetwork === false && entry.executable === false), true);
});

test("snapshot console can sync the canonical migration contribution and preserves explicit boundaries", () => {
  const documentRoot = makeDocument();
  const adapter = createMigrationSnapshotConsole({ documentRoot, snapshot: { entries: [{ id: "migration:world-scene-layout" }] } });
  const synced = adapter.syncProjection({ contributions: [BLOCK_MIGRATION_MANIFEST] });
  assert.equal(synced.action, "load");
  assert.equal(adapter.getSnapshot().validation.valid, true);
  assert.equal(adapter.getSnapshot().validation.mappingCount, 6);
  const summary = summarizeMigrationSnapshot(DEFAULT_MIGRATION_SNAPSHOT);
  assert.equal(summary.valid, true);
  assert.equal(summary.records.length, 6);
  assert.equal(summary.boundary, MIGRATION_SNAPSHOT_BOUNDARY);
  assert.equal(summary.externalImport, false);
  assert.equal(summary.importedCodeExecution, false);
  assert.equal(summary.persistence, false);
  assert.equal(summary.executable, false);
  const envelopeSummary = summarizeMigrationSnapshot({ contributions: [BLOCK_MIGRATION_MANIFEST] });
  assert.equal(envelopeSummary.valid, true);
  assert.equal(envelopeSummary.records.length, 6);
  assert.equal(BLOCK_MIGRATION_SOURCE, "block-migration-bridge");
});

test("snapshot console exposes the Merge 4 adapter review without opening a server path", () => {
  const documentRoot = makeDocument();
  const reviews = [];
  const adapter = createMigrationSnapshotConsole({
    documentRoot,
    onMerge4Review: (review) => reviews.push(review),
  });
  const review = adapter.reviewMerge4Snapshot("test");
  assert.equal(review.action, "merge4-review");
  assert.equal(review.valid, true);
  assert.equal(review.adapted, true);
  assert.equal(review.worldId, "demo");
  assert.equal(review.mappedEntityCount >= 7, true);
  assert.equal(review.deferred.length >= 3, true);
  assert.equal(review.externalNetwork, false);
  assert.equal(review.executable, false);
  assert.equal(reviews.length, 1);
  assert.equal(adapter.getSnapshot().merge4Review.worldId, "demo");
  assert.match(documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.merge4Status).textContent, /READY/);
  assert.match(documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.merge4Records).children[0].textContent, /MAPPED/);
});

test("snapshot renderer advertises JSON-only controls and has no external execution path", async () => {
  const renderer = await readFile(new URL("../src/render/migration-snapshot.js", import.meta.url), "utf8");
  const docs = await readFile(new URL("../docs/MIGRATION_SNAPSHOT.md", import.meta.url), "utf8");
  for (const id of Object.values(MIGRATION_SNAPSHOT_DOM_IDS)) assert.match(renderer, new RegExp(id));
  assert.match(renderer, /JSON\.parse/);
  assert.match(renderer, /loadFile/);
  assert.match(renderer, /application\/json/);
  assert.match(renderer, /forbidden-field/);
  assert.match(renderer, /applyBlockMigrationToLocalDraft/);
  assert.doesNotMatch(renderer, /\beval\s*\(/i);
  assert.doesNotMatch(renderer, /\bfetch\s*\(/i);
  assert.doesNotMatch(renderer, /new\s+WebSocket/i);
  assert.doesNotMatch(renderer, /navigator\.sendBeacon/i);
  assert.match(docs, /JSON/i);
  assert.match(docs, /no filesystem import/i);
  assert.match(docs, /canonical/i);
});

test("applying a safe user snapshot hands back to its first existing cube and aligns Block World", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = main.indexOf("onApply: (snapshot) => {", main.indexOf("migrationSnapshot = createMigrationSnapshotConsole"));
  assert.notEqual(start, -1);
  const handoff = main.slice(start, start + 3600);
  assert.match(handoff, /firstAppliedEdit = snapshot\.draft\?\.blockEdits\?\.find/);
  assert.match(handoff, /migration-snapshot-handoff/);
  assert.match(handoff, /selectedBlockId: selectedAppliedBlock\?\.id/);
  assert.match(handoff, /handoff: selectedAppliedBlock \? 'cube-field' : 'none'/);
  assert.match(handoff, /featureNavigator\?\.select\('block-world', 'migration-snapshot', \{ updateLocation: false \}\)/);
  assert.match(handoff, /showBlockReadout\(selectedAppliedBlock, 'migration-snapshot-handoff'\)/);
  assert.match(handoff, /blockDraft\?\.draft\?\.blocks\?\.find/);
  assert.doesNotMatch(handoff, /\bfetch\s*\(/i);
});
