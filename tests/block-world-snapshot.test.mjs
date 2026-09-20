import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  BLOCK_WORLD_SNAPSHOT_BOUNDARY,
  BLOCK_WORLD_SNAPSHOT_MAX_STRING_LENGTH,
  DEFAULT_BLOCK_WORLD_SNAPSHOT,
  applyBlockWorldSnapshot,
  createBlockWorldSnapshot,
  serializeBlockWorldSnapshot,
  validateBlockWorldSnapshot,
} from "../src/domains/block-world-snapshot.js";
import { DEFAULT_BLOCK_WORLD } from "../src/domains/block-world.js";
import {
  BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE,
  BLOCK_WORLD_SNAPSHOT_DOM_IDS,
  createBlockWorldSnapshotConsole,
} from "../src/render/block-world-snapshot.js";

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
    clicked: false,
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
    click() { this.clicked = true; },
    remove() {},
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    register(id, hidden = false, tag = "div") {
      const element = makeElement(documentRoot, tag);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
  };
  Object.entries(BLOCK_WORLD_SNAPSHOT_DOM_IDS).forEach(([key, id]) => {
    documentRoot.register(id, key === "panel", key === "input" ? "textarea" : "div");
  });
  return documentRoot;
}

test("Block World snapshots are deterministic, bounded, and round-trip through JSON", () => {
  const first = createBlockWorldSnapshot(DEFAULT_BLOCK_WORLD);
  const second = createBlockWorldSnapshot(DEFAULT_BLOCK_WORLD);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(DEFAULT_BLOCK_WORLD_SNAPSHOT));
  assert.equal(first.blockCount, 102);
  assert.equal(first.contentCount, 24);
  assert.equal(first.blocks.some((block) => block.container && block.contents.length > 0), true);
  assert.equal(first.localOnly, true);
  assert.equal(first.persistence, false);
  const payload = serializeBlockWorldSnapshot(first);
  const result = validateBlockWorldSnapshot(payload);
  assert.equal(result.valid, true);
  assert.deepEqual(result.snapshot, first);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.equal(Object.isFrozen(result.errors), true);
});

test("snapshot validation rejects malformed, duplicate, executable, getter-backed, cyclic, and oversized data", () => {
  assert.equal(validateBlockWorldSnapshot("{broken").valid, false);
  const duplicate = {
    schemaVersion: 1,
    dimensions: { width: 2, depth: 2, height: 2 },
    blocks: [
      { x: 0, y: 0, z: 0, blockType: "stone" },
      { x: 0, y: 0, z: 0, blockType: "grass" },
    ],
  };
  assert.equal(validateBlockWorldSnapshot(duplicate).errors.some((error) => error.code === "duplicate-coordinate"), true);

  const hostile = { ...duplicate, blocks: [{ x: 0, y: 0, z: 0, blockType: "stone" }], command: "publish", executable: true };
  const hostileResult = validateBlockWorldSnapshot(hostile);
  assert.equal(hostileResult.valid, false);
  assert.equal(hostileResult.errors.some((error) => error.code === "executable-field"), true);

  let getterCalled = false;
  const getterFixture = { ...duplicate };
  Object.defineProperty(getterFixture, "blocks", {
    enumerable: true,
    get() { getterCalled = true; return []; },
  });
  const getterResult = validateBlockWorldSnapshot(getterFixture);
  assert.equal(getterResult.valid, false);
  assert.equal(getterCalled, false);
  assert.equal(getterResult.errors.some((error) => error.code === "getter-backed-value"), true);

  const cyclic = { schemaVersion: 1, dimensions: { width: 1, depth: 1, height: 1 }, blocks: [] };
  cyclic.self = cyclic;
  assert.equal(validateBlockWorldSnapshot(cyclic).errors.some((error) => error.code === "cyclic-value"), true);

  const oversized = JSON.stringify({
    schemaVersion: 1,
    worldId: "x".repeat(BLOCK_WORLD_SNAPSHOT_MAX_STRING_LENGTH + 1),
    dimensions: { width: 1, depth: 1, height: 1 },
    blocks: [],
  });
  assert.equal(validateBlockWorldSnapshot(oversized).errors.some((error) => error.code === "string-too-large"), true);
  assert.equal(validateBlockWorldSnapshot({
    schemaVersion: 1,
    dimensions: { width: 1, depth: 1, height: 1 },
    blocks: [{ x: 0, y: 0, z: 0, blockType: "unknown" }],
  }).valid, false);
});

test("applying a Block World snapshot returns an immutable local draft and preserves canonical input", () => {
  const before = JSON.stringify(DEFAULT_BLOCK_WORLD);
  const draft = applyBlockWorldSnapshot(DEFAULT_BLOCK_WORLD, DEFAULT_BLOCK_WORLD_SNAPSHOT);
  assert.equal(draft.localDraft, true);
  assert.equal(draft.lastEdit.action, "import-snapshot");
  assert.equal(draft.blocks.length, DEFAULT_BLOCK_WORLD_SNAPSHOT.blockCount);
  assert.equal(draft.nestedContentCount, DEFAULT_BLOCK_WORLD_SNAPSHOT.contentCount);
  assert.equal(draft.externalNetwork, false);
  assert.equal(draft.externalTransfer, false);
  assert.equal(draft.executable, false);
  assert.equal(JSON.stringify(DEFAULT_BLOCK_WORLD), before);
  assert.equal(Object.isFrozen(draft), true);
  assert.throws(() => applyBlockWorldSnapshot(DEFAULT_BLOCK_WORLD, { dimensions: { width: 1, depth: 1, height: 1 }, blocks: [{ x: 0, y: 0, z: 0, blockType: "invalid" }] }), /Cannot apply/);
});

test("snapshot console loads, previews, applies, exports, replays, and resets locally", () => {
  const documentRoot = makeDocument();
  const actions = [];
  let liveProjection = DEFAULT_BLOCK_WORLD;
  const adapter = createBlockWorldSnapshotConsole({
    documentRoot,
    projection: DEFAULT_BLOCK_WORLD,
    getProjection: () => liveProjection,
    onLoad: (result) => actions.push(result),
    onPreview: (result) => actions.push(result),
    onApply: (result) => { actions.push(result); if (result.accepted) liveProjection = result.draft; },
    onReplay: (result) => actions.push(result),
    onReset: (result) => actions.push(result),
    onExport: (result) => actions.push(result),
  });
  assert.equal(adapter.getSnapshot().source, BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE);
  assert.equal(adapter.getSnapshot().opened, false);
  assert.equal(adapter.getSnapshot().validation.valid, true);

  const loaded = adapter.loadSnapshot(serializeBlockWorldSnapshot(DEFAULT_BLOCK_WORLD_SNAPSHOT), "test");
  assert.equal(loaded.accepted, true);
  assert.equal(loaded.validation.blockCount, 102);
  const preview = adapter.preview("test");
  assert.equal(preview.action, "preview");
  assert.equal(preview.contentCount, 24);
  const applied = adapter.apply("test");
  assert.equal(applied.accepted, true);
  assert.equal(applied.draft.lastEdit.action, "import-snapshot");
  const exported = adapter.exportSnapshot("test");
  assert.equal(exported.validated, true);
  assert.equal(exported.snapshot.blockCount, 102);
  assert.equal(typeof exported.payload, "string");
  assert.match(documentRoot.getElementById(BLOCK_WORLD_SNAPSHOT_DOM_IDS.status).textContent, /EXPORTED · 102 BLOCKS · (DOWNLOAD READY|COPY JSON READY) · LOCAL ONLY/);
  const replayed = adapter.replay("test");
  assert.equal(replayed.action, "replay");
  assert.equal(replayed.accepted, true);
  const reset = adapter.reset("test");
  assert.equal(reset.action, "reset");
  assert.equal(adapter.getSnapshot().validation.valid, true);
  assert.equal(actions.every((entry) => entry.localOnly === true && entry.externalNetwork === false && entry.executable === false), true);
  assert.equal(documentRoot.getElementById(BLOCK_WORLD_SNAPSHOT_DOM_IDS.validation).children.length > 0, true);
  assert.match(documentRoot.getElementById(BLOCK_WORLD_SNAPSHOT_DOM_IDS.boundary).textContent, /data-only local drafts/i);
  assert.equal(adapter.getSnapshot().boundary, BLOCK_WORLD_SNAPSHOT_BOUNDARY);
});

test("snapshot console imports one bounded local JSON file through the existing validator", async () => {
  const documentRoot = makeDocument();
  const actions = [];
  const adapter = createBlockWorldSnapshotConsole({ documentRoot, onLoad: (result) => actions.push(result) });
  const payload = serializeBlockWorldSnapshot(DEFAULT_BLOCK_WORLD_SNAPSHOT);
  const loaded = await adapter.loadFile({
    name: "cube-world.JSON",
    type: "application/json",
    size: payload.length,
    async text() { return payload; },
  }, "test-file");
  assert.equal(loaded.action, "load");
  assert.equal(loaded.method, "test-file");
  assert.equal(loaded.accepted, true);
  assert.equal(loaded.readInMemory, true);
  assert.equal(loaded.fileImport.status, "accepted");
  assert.equal(adapter.getSnapshot().lastFileImport.readInMemory, true);
  assert.equal(adapter.getSnapshot().validation.blockCount, DEFAULT_BLOCK_WORLD_SNAPSHOT.blockCount);
  assert.match(documentRoot.getElementById(BLOCK_WORLD_SNAPSHOT_DOM_IDS.status).textContent, /FILE LOADED/);
  assert.equal(actions.length, 1);

  const rejected = await adapter.loadFile({ name: "cube-world.txt", type: "text/plain", size: 2, async text() { return "{}"; } }, "test-type");
  assert.equal(rejected.action, "file-load");
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.validation.errors[0].code, "file-type");
  assert.equal(rejected.file.name, undefined);
  assert.match(documentRoot.getElementById(BLOCK_WORLD_SNAPSHOT_DOM_IDS.status).textContent, /FILE REJECTED/);

  const oversized = await adapter.loadFile({
    name: "too-large.json",
    type: "application/json",
    size: 200_001,
    async text() { throw new Error("must not read oversized file"); },
  }, "test-size");
  assert.equal(oversized.validation.errors[0].code, "file-too-large");
  assert.equal(actions.length, 3);
  assert.equal(actions.every((entry) => entry.externalNetwork === false && entry.executable === false), true);
});

test("snapshot renderer and docs declare the local data-only boundary", async () => {
  const renderer = await readFile(new URL("../src/render/block-world-snapshot.js", import.meta.url), "utf8");
  const docs = await readFile(new URL("../docs/BLOCK_WORLD_MIGRATION.md", import.meta.url), "utf8");
  for (const id of Object.values(BLOCK_WORLD_SNAPSHOT_DOM_IDS)) assert.match(renderer, new RegExp(id));
  assert.match(renderer, /validateBlockWorldSnapshot/);
  assert.match(renderer, /loadFile/);
  assert.match(renderer, /application\/json/);
  assert.doesNotMatch(renderer, /\bfetch\s*\(/i);
  assert.doesNotMatch(renderer, /new\s+WebSocket/i);
  assert.doesNotMatch(renderer, /\beval\s*\(/i);
  assert.match(docs, /snapshot/i);
  assert.match(docs, /data-only/i);
});
