import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  BLOCK_MIGRATION_BOUNDARY,
  BLOCK_MIGRATION_MANIFEST,
  BLOCK_MIGRATION_SNAPSHOT_PREVIEW_SOURCE,
  BLOCK_MIGRATION_SNAPSHOT_SOURCE,
  BLOCK_MIGRATION_SOURCE,
  BLOCK_MIGRATION_STATUSES,
  applyBlockMigrationToLocalDraft,
  createBlockMigrationManifest,
  previewBlockMigration,
  previewBlockMigrationSnapshot,
  resolveBlockMigrationHandback,
  resetBlockMigrationDraft,
  validateBlockMigrationSnapshot,
} from "../src/domains/block-migration.js";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import {
  BLOCK_MIGRATION_CONSOLE_SOURCE,
  createBlockMigrationConsole,
  summarizeBlockMigration,
} from "../src/render/block-migration.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
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
    append(...children) {
      children.forEach((child) => this.appendChild(child));
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    addEventListener(type, callback) {
      this.listeners.set(type, callback);
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    focus() {},
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) {
      return makeElement(documentRoot, tag);
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    addEventListener() {},
    register(id, hidden = false) {
      const element = makeElement(documentRoot);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
  };
  [
    ["block-migration-console", true],
    ["block-migration-close"],
    ["block-migration-preview"],
    ["block-migration-apply"],
    ["block-migration-reset"],
    ["block-migration-status"],
    ["block-migration-count"],
    ["block-migration-applied-count"],
    ["block-migration-selection"],
    ["block-migration-handoff"],
    ["block-migration-list"],
    ["block-migration-trace"],
    ["block-migration-boundary"],
  ].forEach(([id, hidden]) => documentRoot.register(id, hidden));
  return documentRoot;
}

test("migration manifest is deterministic and covers the legacy concepts", () => {
  const left = createBlockMigrationManifest();
  const right = createBlockMigrationManifest();
  assert.equal(left.source, BLOCK_MIGRATION_SOURCE);
  assert.deepEqual(left, right);
  assert.deepEqual(left, BLOCK_MIGRATION_MANIFEST);
  assert.deepEqual(left.entries.map((entry) => entry.legacyId), [
    "world-scene-layout",
    "world-games",
    "world-contracts",
    "arena-room",
    "semantic-block-concepts",
    "external-project-sync",
  ]);
  assert.deepEqual(Object.keys(left.counts), BLOCK_MIGRATION_STATUSES);
  assert.deepEqual(left.counts, { mapped: 3, preserved: 2, deferred: 1 });
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.entries), true);
  assert.equal(Object.isFrozen(left.entries[0]), true);
  assert.equal(Object.isFrozen(left.entries[0].block), true);
  assert.equal(left.entries.every((entry) => (
    entry.simulation === true
    && entry.localOnly === true
    && entry.externalImport === false
    && entry.importedCodeExecution === false
    && entry.persistence === false
    && entry.externalNetwork === false
    && entry.executable === false
  )), true);
});

test("preview and apply map only safe data and never execute caller values", () => {
  let called = false;
  const hostile = {
    entries: BLOCK_MIGRATION_MANIFEST.entries.map((entry) => ({
      id: entry.id,
      legacyId: entry.legacyId,
      run: () => { called = true; },
      module: "./legacy-runtime.js",
      command: "publish",
    })),
  };
  const preview = previewBlockMigration(hostile);
  assert.equal(called, false);
  assert.equal(preview.source, "block-migration-preview");
  assert.equal(preview.mappings.length, BLOCK_MIGRATION_MANIFEST.entries.length);
  assert.equal(preview.applyCount, 5);
  assert.equal(preview.mappings.find((mapping) => mapping.status === "deferred").safeToApply, false);
  assert.equal(preview.draftPatches.every((patch) => patch.externalImport === false && patch.executable === false), true);
  assert.equal(Object.isFrozen(preview), true);
  assert.equal(Object.isFrozen(preview.mappings), true);
  assert.equal(Object.isFrozen(preview.mappings[0].sourceEntry), true);

  const base = JSON.stringify(preview);
  const applied = applyBlockMigrationToLocalDraft(preview);
  assert.equal(called, false);
  assert.equal(applied.action, "apply-local-draft");
  assert.equal(applied.draft.localDraft, true);
  assert.equal(applied.draft.mappingIds.length, 5);
  assert.equal(applied.draft.deferredMappingIds.length, 1);
  assert.equal(applied.draft.blockEdits.length, 5);
  assert.equal(applied.draft.blockEdits.some((edit) => edit.sourceId === "external-project-sync"), false);
  assert.equal(JSON.stringify(preview), base);
  assert.equal(Object.isFrozen(applied), true);
  assert.equal(Object.isFrozen(applied.draft.blockEdits), true);

  const mappedOnly = applyBlockMigrationToLocalDraft(BLOCK_MIGRATION_MANIFEST, { statuses: ["mapped"] });
  assert.deepEqual(mappedOnly.draft.mappingIds, [
    "migration:world-scene-layout",
    "migration:world-contracts",
    "migration:arena-room",
  ]);
  const reset = resetBlockMigrationDraft(applied);
  assert.equal(reset.action, "reset-local-draft");
  assert.deepEqual(reset.draft.mappingIds, []);
  assert.equal(reset.draft.localDraft, true);
});

test("user-supplied legacy snapshots validate against fixed mappings and expose mapped/deferred rows", () => {
  const input = JSON.stringify({
    schemaVersion: 1,
    snapshotId: "legacy-review-01",
    updatedAt: "2026-08-28T12:00:00.000Z",
    entries: [
      { legacyId: "world-contracts", status: "mapped", coordinate: [6, 0, 4] },
      { legacyId: "external-project-sync", status: "deferred", coordinate: null },
    ],
  });
  const validation = validateBlockMigrationSnapshot(input);
  assert.equal(validation.source, BLOCK_MIGRATION_SNAPSHOT_SOURCE);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.snapshot.entries.map((entry) => entry.id), [
    "migration:world-contracts",
    "migration:external-project-sync",
  ]);
  assert.equal(Object.isFrozen(validation), true);
  const preview = previewBlockMigrationSnapshot(input);
  assert.equal(preview.source, BLOCK_MIGRATION_SNAPSHOT_PREVIEW_SOURCE);
  assert.equal(preview.valid, true);
  assert.equal(preview.mappedRows.length, 1);
  assert.equal(preview.deferredRows.length, 1);
  assert.deepEqual(preview.mappedRows[0].coordinate, [6, 0, 4]);
  assert.equal(preview.deferredRows[0].safeToApply, false);
  assert.equal(preview.applyCount, 1);
  assert.equal(preview.draftPatches[0].coordinate.join(","), "6,0,4");
  assert.equal(preview.externalImport, false);
  assert.equal(preview.persistence, false);

  const mismatch = validateBlockMigrationSnapshot({
    schemaVersion: 1,
    snapshotId: "legacy-review-02",
    updatedAt: "2026-08-28T12:00:00.000Z",
    entries: [{ legacyId: "world-contracts", status: "deferred", coordinate: [9, 9, 9] }],
  });
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.errors.some((error) => error.code === "status-mismatch"), true);
  assert.equal(mismatch.errors.some((error) => error.code === "coordinate-mismatch"), true);
  assert.equal(previewBlockMigrationSnapshot(mismatch).action, "preview-blocked");

  let getterCalled = false;
  const getterInput = {
    schemaVersion: 1,
    snapshotId: "legacy-review-03",
    updatedAt: "2026-08-28T12:00:00.000Z",
    entries: [{ legacyId: "world-contracts" }],
  };
  Object.defineProperty(getterInput.entries[0], "label", {
    enumerable: true,
    get() { getterCalled = true; return "unsafe"; },
  });
  const getterResult = validateBlockMigrationSnapshot(getterInput);
  assert.equal(getterCalled, false);
  assert.equal(getterResult.valid, false);
  assert.equal(getterResult.errors.some((error) => error.code === "accessor-field"), true);
});

test("renderer summary and console expose a frozen local migration rehearsal", () => {
  const summary = summarizeBlockMigration({ contributions: [BLOCK_MIGRATION_MANIFEST] });
  assert.equal(summary.source, BLOCK_MIGRATION_CONSOLE_SOURCE);
  assert.equal(summary.entries.length, 6);
  assert.equal(summary.counts.deferred, 1);
  assert.equal(summary.localOnly, true);
  assert.equal(summary.externalImport, false);
  assert.equal(summary.persistence, false);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.entries), true);

  const documentRoot = makeDocument();
  const actions = [];
  const console = createBlockMigrationConsole({
    documentRoot,
    manifest: BLOCK_MIGRATION_MANIFEST,
    onSelect: (snapshot) => actions.push(snapshot),
    onPreview: (snapshot) => actions.push(snapshot),
    onApply: (snapshot) => actions.push(snapshot),
    onReset: (snapshot) => actions.push(snapshot),
  });
  assert.equal(console.getSnapshot().source, BLOCK_MIGRATION_CONSOLE_SOURCE);
  assert.equal(console.getSnapshot().opened, false);
  const selected = console.selectMapping("migration:world-contracts", "test");
  assert.equal(selected.mapping.status, "mapped");
  const preview = console.preview("test");
  assert.equal(preview.preview.applyCount, 5);
  const applied = console.apply("test");
  assert.equal(applied.draft.mappingIds.length, 5);
  assert.equal(console.getSnapshot().draft.draft.localDraft, true);
  const reset = console.reset("test");
  assert.equal(reset.result.action, "reset-local-draft");
  assert.equal(console.getSnapshot().draft, null);
  assert.deepEqual(actions.map((entry) => entry.action), ["select", "preview", "apply-local-draft", "reset"]);
  assert.equal(actions.every((entry) => entry.localOnly === true && entry.externalImport === false && entry.persistence === false), true);
  assert.equal(Object.isFrozen(console.getSnapshot()), true);
});

test("safe mappings hand back to their existing cube coordinate and deferred sync stays denied", () => {
  const documentRoot = makeDocument();
  const handoffs = [];
  const adapter = createBlockMigrationConsole({
    documentRoot,
    manifest: BLOCK_MIGRATION_MANIFEST,
    onShowInCube: (snapshot) => handoffs.push(snapshot),
  });
  const canonicalBefore = JSON.stringify(BLOCK_MIGRATION_MANIFEST);
  adapter.selectMapping("migration:world-contracts", "test");
  const shown = adapter.showInCube("test");
  assert.equal(shown.action, "show-in-cube");
  assert.deepEqual(shown.coordinate, [6, 0, 4]);
  assert.equal(shown.mappingId, "migration:world-contracts");
  assert.equal(shown.returnFeature, "migration");
  assert.equal(shown.localOnly, true);
  assert.equal(shown.externalNetwork, false);
  assert.equal(shown.persistence, false);
  assert.equal(handoffs.length, 1);
  assert.match(documentRoot.getElementById("block-migration-selection").textContent, /CUBE 6,0,4/);
  assert.match(documentRoot.getElementById("block-migration-handoff").textContent, /MIGRATION BRIDGE REMAINS THE RETURN PATH/);

  adapter.selectMapping("migration:external-project-sync", "test");
  const blocked = adapter.showInCube("test");
  assert.equal(blocked.action, "show-in-cube-blocked");
  assert.equal(blocked.reason, "deferred-mapping");
  assert.equal(blocked.coordinate, null);
  assert.equal(blocked.externalImport, false);
  assert.equal(handoffs.length, 2);
  assert.match(documentRoot.getElementById("block-migration-handoff").textContent, /EXTERNAL PROJECT SYNC REMAINS DENIED/);
  assert.equal(JSON.stringify(BLOCK_MIGRATION_MANIFEST), canonicalBefore);
});

test("domain handback resolves the current cube draft without creating a block", () => {
  const world = createBlockWorldContribution();
  const before = JSON.stringify(world.blocks);
  const mapped = resolveBlockMigrationHandback(world, "world-contracts");
  assert.equal(mapped.action, "show-in-cube");
  assert.equal(mapped.mappingId, "migration:world-contracts");
  assert.equal(mapped.legacyId, "world-contracts");
  assert.deepEqual(mapped.coordinate, [6, 0, 4]);
  assert.equal(mapped.blockId, "block:6:0:4");
  assert.equal(mapped.found, true);
  assert.equal(mapped.reason, null);
  assert.equal(mapped.returnFeature, "migration");
  assert.equal(mapped.localOnly, true);
  assert.equal(mapped.externalNetwork, false);
  assert.equal(mapped.persistence, false);
  assert.equal(Object.isFrozen(mapped), true);
  assert.equal(JSON.stringify(world.blocks), before);

  const missing = resolveBlockMigrationHandback({ blocks: world.blocks.filter((block) => block.id !== "block:6:0:4") }, "world-contracts");
  assert.equal(missing.action, "show-in-cube-blocked");
  assert.equal(missing.found, false);
  assert.equal(missing.reason, "cube-not-found-in-current-draft");
  assert.deepEqual(missing.coordinate, [6, 0, 4]);

  const deferred = resolveBlockMigrationHandback(world, "external-project-sync");
  assert.equal(deferred.action, "show-in-cube-blocked");
  assert.equal(deferred.found, false);
  assert.equal(deferred.coordinate, null);
  assert.equal(deferred.reason, "deferred-mapping");
  assert.equal(deferred.externalImport, false);
  assert.equal(deferred.executable, false);
});

test("migration bridge markup and source keep external import and persistence denied", async () => {
  const source = await readFile(new URL("../src/domains/block-migration.js", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/render/block-migration.js", import.meta.url), "utf8");
  assert.match(BLOCK_MIGRATION_BOUNDARY, /filesystem import/i);
  assert.match(BLOCK_MIGRATION_BOUNDARY, /persistence/i);
  assert.match(source, /externalImport:\s*false/);
  assert.match(source, /importedCodeExecution:\s*false/);
  assert.match(source, /persistence:\s*false/);
  assert.match(source, /BLOCK_MIGRATION_STATUSES/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /\bimport\s*\(/i);
  assert.doesNotMatch(source, /\beval\s*\(/i);
  assert.doesNotMatch(renderer, /\bfetch\s*\(/i);
  assert.doesNotMatch(renderer, /\bimport\s*\(/i);
  assert.doesNotMatch(renderer, /\beval\s*\(/i);
  for (const id of [
    "block-migration-console",
    "block-migration-preview",
    "block-migration-apply",
    "block-migration-reset",
    "block-migration-list",
    "block-migration-trace",
    "block-migration-boundary",
    "block-migration-handoff",
    "block-migration-show-cube",
  ]) assert.match(renderer, new RegExp(id));
});

test("migration markup exposes a coordinate handback and an explicit return path", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/render/block-migration.js", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(html, /id="block-migration-handoff"[^>]*role="status"/);
  assert.match(renderer, /block-migration-show-cube/);
  assert.match(renderer, /SHOW IN CUBE FIELD/);
  assert.match(renderer, /DEFERRED · NO CUBE HANDOFF/);
  assert.match(main, /onShowInCube:\s*\(snapshot\)/);
  assert.match(main, /resolveBlockMigrationHandback/);
  assert.match(main, /cube-not-found-in-current-draft|unknown-migration-entry/);
  assert.match(main, /projection\.show-migration-mapping-in-cube/);
  assert.match(main, /featureNavigator\?\.select\('block-world', 'migration-show-in-cube'/);
  assert.match(main, /blockWorld\?\.selectBlock\?\.\(target\.id, 'migration-show-in-cube'\)/);
  assert.match(main, /onMigrationOpen/);
  assert.doesNotMatch(main, /onShowInCube:[\s\S]*fetch\s*\(/i);
});

test("applying a migration draft aligns Mission Control with its selected Block World cube", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = main.indexOf("onApply: (snapshot) => {", main.indexOf("blockMigration = createBlockMigrationConsole"));
  const end = main.indexOf("onReset: (snapshot)", start);
  assert.ok(start >= 0 && end > start, "expected the local migration apply handoff");
  const handoff = main.slice(start, end);

  assert.match(handoff, /blockWorld\?\.applyMigrationDraft\(snapshot\.draft\?\.blockEdits \?\? \[\], 'migration-bridge'\)/);
  assert.match(handoff, /blockWorld\?\.selectBlock\?\.\(firstAppliedBlock\.id, 'migration-apply-handoff'\)/);
  assert.match(handoff, /featureNavigator\?\.select\('block-world', 'migration-apply-handoff', \{ updateLocation: false \}\)/);
  assert.match(handoff, /showBlockReadout\(selectedAppliedBlock, 'migration-apply-handoff'\)/);
  assert.match(handoff, /blockWorld\?\.open\(\)/);
  assert.doesNotMatch(handoff, /\bfetch\s*\(/i);
});
