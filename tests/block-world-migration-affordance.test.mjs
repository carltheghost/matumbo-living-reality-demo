import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import { createBlockWorldLayer } from "../src/render/block-world.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    type: tag === "button" ? "button" : undefined,
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    tabIndex: -1,
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
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    focus() { this.focused = true; },
  };
}

function makeDocument() {
  const elements = new Map();
  const documentListeners = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, callback) { documentListeners.set(type, callback); },
    register(id, hidden = false, tag = "div") {
      const element = makeElement(documentRoot, tag);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
  };
  [
    ["block-world-console", true], ["block-world-close", false, "button"],
    ["block-world-replay", false, "button"], ["block-world-add", false, "button"],
    ["block-world-remove", false, "button"], ["block-world-replace", false, "button"],
    ["block-world-open", false, "button"], ["block-world-inspect", false, "button"],
    ["block-world-status"], ["block-world-count"], ["block-world-draft-count"],
    ["block-world-container-count"], ["block-world-content-count"], ["block-world-selection"],
    ["block-world-list"], ["block-world-palette"], ["block-world-trace"], ["block-world-boundary"],
    ["block-world-inspection"], ["block-world-contents"], ["block-world-routes"],
    ["block-world-navigation-status"], ["block-world-navigation-trace"],
    ["block-world-migration-open", false, "button"], ["block-world-migration-status"],
  ].forEach(([id, hidden, tag]) => documentRoot.register(id, hidden, tag));
  return documentRoot;
}

test("Block World exposes a direct Migration Bridge affordance with a local keyboard seam", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(html, /id="block-world-migration-open"[^>]*aria-controls="block-migration-console"[^>]*aria-expanded="false"/);
  assert.match(html, /id="block-world-migration-status"[^>]*>MAP EARLIER IDEAS → CUBES · LOCAL ONLY/);
  assert.match(html, /#block-world-migration-open\{[^}]*min-height:44px/);
  assert.match(html, /id="block-migration-console"/);
  assert.match(main, /onMigrationOpen:/);
  assert.match(main, /projection\.open-migration-from-block-world/);

  const documentRoot = makeDocument();
  const events = [];
  const layer = createBlockWorldLayer({
    documentRoot,
    projection: createBlockWorldContribution(),
    three: null,
    onMigrationOpen: (snapshot, method) => events.push({ snapshot, method }),
  });
  const button = documentRoot.getElementById("block-world-migration-open");
  const status = documentRoot.getElementById("block-world-migration-status");
  assert.equal(button.tabIndex, 0, "the migration button receives the same explicit keyboard seam as portal routes");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(status.textContent, "MAP EARLIER IDEAS → CUBES · LOCAL ONLY");

  const portal = createBlockWorldContribution().blocks.find((block) => block.blockType === "portal");
  layer.selectBlock(portal.id, "test");
  let prevented = false;
  button.listeners.get("keydown")({
    key: "Enter",
    preventDefault: () => { prevented = true; },
    stopPropagation() {},
  });
  assert.equal(prevented, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].method, "keyboard");
  assert.equal(events[0].snapshot.action, "open-migration-bridge");
  assert.equal(events[0].snapshot.sourceFeature, "block-world");
  assert.equal(events[0].snapshot.targetFeature, "migration");
  assert.equal(events[0].snapshot.localOnly, true);
  assert.equal(events[0].snapshot.externalImport, false);
  assert.equal(events[0].snapshot.persistence, false);
  assert.equal(Object.isFrozen(events[0].snapshot), true);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(status.textContent, "MIGRATION BRIDGE OPEN · LOCAL ONLY");

  // A synthetic host may emit a click after keydown; consume it without
  // opening a second migration handoff.
  button.listeners.get("click")({ detail: 0 });
  assert.equal(events.length, 1);
  layer.close();
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(status.textContent, "MAP EARLIER IDEAS → CUBES · LOCAL ONLY");
  assert.equal(layer.getSnapshot().migrationBridgeOpen, false);
});

test("Block World keeps a migration cube handoff stable through return and replay", () => {
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({
    documentRoot,
    projection: createBlockWorldContribution(),
    three: null,
  });
  const target = createBlockWorldContribution().blocks.find((block) => (
    block.x === 6 && block.y === 0 && block.z === 4
  ));
  assert.ok(target);

  layer.selectBlock(target.id, "test-selection");
  const opened = layer.openMigrationBridge("test-open");
  assert.equal(opened.sourceBlockId, target.id);
  assert.deepEqual(opened.sourceCoordinate, [6, 0, 4]);
  assert.equal(opened.continuity.blockId, target.id);
  assert.deepEqual(opened.continuity.coordinate, [6, 0, 4]);

  const returned = layer.restoreMigrationContinuity("test-return");
  assert.equal(returned.action, "restore-selection");
  assert.equal(returned.status, "restored");
  assert.equal(returned.blockId, target.id);
  assert.deepEqual(returned.coordinate, [6, 0, 4]);
  assert.equal(layer.getSnapshot().selectedId, target.id);
  assert.equal(layer.getSnapshot().migrationContinuityStatus, "restored");

  const replayed = layer.replay("test-replay");
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.continuityStatus, "restored");
  assert.equal(replayed.selectedId, target.id);
  assert.deepEqual(replayed.continuity.coordinate, [6, 0, 4]);
  assert.match(documentRoot.getElementById("block-world-status").textContent, /MIGRATION HANDOFF RESTORED/);
});

test("Block World reports missing and deferred migration handoffs without changing canonical cubes", () => {
  const documentRoot = makeDocument();
  const canonical = createBlockWorldContribution();
  const layer = createBlockWorldLayer({ documentRoot, projection: canonical, three: null });
  const target = canonical.blocks.find((block) => block.x === 6 && block.y === 0 && block.z === 4);
  layer.selectBlock(target.id, "test-selection");
  layer.openMigrationBridge("test-open");
  layer.edit("remove");

  const missing = layer.restoreMigrationContinuity("test-missing");
  assert.equal(missing.action, "restore-selection-blocked");
  assert.equal(missing.status, "missing");
  assert.deepEqual(missing.coordinate, [6, 0, 4]);
  assert.equal(layer.getSnapshot().draft.blocks.some((block) => block.id === target.id), false);
  assert.equal(layer.getSnapshot().canonicalProjection.blocks.some((block) => block.id === target.id), true);
  assert.match(documentRoot.getElementById("block-world-status").textContent, /MIGRATION HANDOFF MISSING/);

  const deferredDocument = makeDocument();
  const deferredLayer = createBlockWorldLayer({ documentRoot: deferredDocument, projection: canonical, three: null });
  const deferred = deferredLayer.acceptMigrationHandback({
    mappingId: "migration:external-project-sync",
    reason: "deferred-mapping",
    coordinate: null,
  }, "test-deferred");
  assert.equal(deferred.action, "accept-handback-blocked");
  assert.equal(deferred.status, "deferred");
  assert.equal(deferred.coordinate, null);
  assert.equal(deferredLayer.getSnapshot().migrationContinuityStatus, "deferred");
  assert.match(deferredDocument.getElementById("block-world-status").textContent, /MIGRATION HANDOFF DEFERRED/);
  assert.equal(deferredLayer.getSnapshot().canonicalProjection.blocks.length, canonical.blocks.length);
});

test("Block World migration continuity stays renderer-local and non-executable", async () => {
  const source = await readFile(new URL("../src/render/block-world.js", import.meta.url), "utf8");
  assert.match(source, /migrationContinuity/);
  assert.match(source, /restoreMigrationContinuity/);
  assert.match(source, /acceptMigrationHandback/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /\beval\s*\(/i);
});

test("Applying a migration draft hands the viewer to the first safe existing cube", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /firstAppliedEdit = snapshot\.draft\?\.blockEdits\?\.find/);
  assert.match(main, /migration-apply-handoff/);
  assert.match(main, /selectedBlockId: selectedAppliedBlock\?\.id/);
  assert.match(main, /handoff: selectedAppliedBlock \? 'cube-field' : 'none'/);
  // The handoff is resolved against the applied local draft, never by
  // creating a new block or contacting an external project.
  assert.match(main, /blockDraft\?\.draft\?\.blocks\?\.find/);
});

test("Block World previews a user legacy snapshot without changing the cube draft", () => {
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({
    documentRoot,
    projection: createBlockWorldContribution(),
    three: null,
  });
  const before = JSON.stringify(layer.getSnapshot().draft.blocks);
  const preview = layer.previewLegacySnapshot({
    schemaVersion: 1,
    snapshotId: "legacy-review-01",
    updatedAt: "2026-08-28T12:00:00.000Z",
    entries: [
      { legacyId: "world-contracts", coordinate: [6, 0, 4] },
      { legacyId: "external-project-sync", status: "deferred", coordinate: null },
    ],
  }, "test-user-preview");
  assert.equal(preview.action, "preview-legacy-snapshot");
  assert.equal(preview.valid, true);
  assert.equal(preview.mappedRows.length, 1);
  assert.equal(preview.deferredRows.length, 1);
  assert.deepEqual(preview.mappedRows[0].coordinate, [6, 0, 4]);
  assert.equal(preview.deferredRows[0].safeToApply, false);
  assert.equal(preview.localOnly, true);
  assert.equal(preview.externalImport, false);
  assert.equal(preview.persistence, false);
  assert.equal(JSON.stringify(layer.getSnapshot().draft.blocks), before);
  assert.match(documentRoot.getElementById("block-world-status").textContent, /LEGACY SNAPSHOT PREVIEW/);

  const blocked = layer.previewLegacySnapshot({
    schemaVersion: 1,
    snapshotId: "legacy-review-invalid",
    updatedAt: "2026-08-28T12:00:00.000Z",
    entries: [{ legacyId: "world-contracts", coordinate: [99, 99, 99] }],
  }, "test-invalid-preview");
  assert.equal(blocked.action, "preview-legacy-snapshot-blocked");
  assert.equal(blocked.valid, false);
  assert.equal(blocked.rows.length, 0);
  assert.match(documentRoot.getElementById("block-world-status").textContent, /LEGACY SNAPSHOT BLOCKED/);
});
