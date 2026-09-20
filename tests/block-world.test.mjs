import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLOCK_TYPES,
  BLOCK_WORLD_SOURCE,
  createBlockWorldContribution,
  createBlockWorldDraft,
  createBlockWorldInteractionDraft,
  createBlockWorldMoveDraft,
  createBlockWorldOpenDraft,
  inspectBlockWorldBlock,
} from "../src/domains/block-world.js";
import { previewBlockMigration } from "../src/domains/block-migration.js";
import {
  BLOCK_WORLD_MIGRATION_SOURCE,
  createBlockWorldLayer,
  summarizeBlockWorld,
} from "../src/render/block-world.js";
import { FEATURE_DEFINITIONS } from "../src/render/feature-navigator.js";

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
    register(id, hidden = false) {
      const element = makeElement(documentRoot);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
  };
  [
    ["block-world-console", true],
    ["block-world-close"],
    ["block-world-replay"],
    ["block-world-add"],
    ["block-world-remove"],
    ["block-world-replace"],
    ["block-world-open"],
    ["block-world-inspect"],
    ["block-world-move-left"],
    ["block-world-move-right"],
    ["block-world-move-forward"],
    ["block-world-move-back"],
    ["block-world-move-up"],
    ["block-world-move-down"],
    ["block-world-grab"],
    ["block-world-hold-left"],
    ["block-world-hold-right"],
    ["block-world-hold-forward"],
    ["block-world-hold-back"],
    ["block-world-hold-up"],
    ["block-world-hold-down"],
    ["block-world-place"],
    ["block-world-status"],
    ["block-world-count"],
    ["block-world-draft-count"],
    ["block-world-selection"],
    ["block-world-list"],
    ["block-world-palette"],
    ["block-world-trace"],
    ["block-world-boundary"],
    ["block-world-inspection"],
    ["block-world-contents"],
  ].forEach(([id, hidden]) => documentRoot.register(id, hidden));
  return documentRoot;
}

test("block world is a deterministic bounded semantic projection", () => {
  const left = createBlockWorldContribution();
  const right = createBlockWorldContribution();
  assert.equal(left.source, BLOCK_WORLD_SOURCE);
  assert.deepEqual(left.blocks, right.blocks);
  assert.ok(left.blocks.length > 40);
  assert.ok(left.blocks.every((block) => block.simulation === true && block.externalNetwork === false && block.executable === false));
  assert.ok(Object.keys(BLOCK_TYPES).every((type) => left.blocks.some((block) => block.blockType === type)));
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.blocks), true);
  assert.ok(left.containerCount >= 3);
  assert.ok(left.nestedContentCount >= left.containerCount);
  assert.ok(left.blocks.every((block) => block.interactive === true && block.canMove === true));
});

test("feature inventory renders one non-empty actionable block per enabled feature", () => {
  const documentRoot = makeDocument();
  const navigated = [];
  const layer = createBlockWorldLayer({
    documentRoot,
    projection: createBlockWorldContribution(),
    onFeatureNavigate: (id, method) => navigated.push({ id, method }),
  });
  const snapshot = layer.setFeatureInventory(FEATURE_DEFINITIONS);
  assert.equal(snapshot.length, FEATURE_DEFINITIONS.length);
  assert.equal(new Set(snapshot.map((feature) => feature.id)).size, FEATURE_DEFINITIONS.length);
  assert.ok(snapshot.every((feature) => feature.id && feature.label && feature.description));
  const rail = documentRoot.getElementById("block-world-console").children.find((child) => child.id === "block-world-feature-rail");
  assert.ok(rail, "feature rail should mount dynamically");
  const clusters = rail.children.slice(1);
  assert.equal(clusters.length, 4);
  assert.equal(clusters.reduce((count, cluster) => count + cluster.children[1].children.length, 0), FEATURE_DEFINITIONS.length);
  assert.ok(clusters.every((cluster) => cluster.dataset.featureCluster));
  const worldToggle = clusters[0].children[0];
  worldToggle.listeners.get("focus")();
  assert.match(documentRoot.getElementById("block-world-status").textContent, /CLUSTER FOCUS · WORLD · 9 FEATURE ROUTES/);
  const first = clusters[0].children[1].children[0];
  assert.equal(first.dataset.featureBlock, "true");
  assert.ok(first.dataset.featureId);
  first.listeners.get("pointerenter")();
  assert.match(documentRoot.getElementById("block-world-status").textContent, /FEATURE HOVER/);
  first.listeners.get("focus")();
  assert.match(documentRoot.getElementById("block-world-status").textContent, /FEATURE FOCUS/);
  assert.match(documentRoot.getElementById("block-world-status").textContent, new RegExp(FEATURE_DEFINITIONS[0].description));
  first.listeners.get("click")();
  assert.deepEqual(navigated, [{ id: FEATURE_DEFINITIONS[0].id, method: "feature-block" }]);
  assert.equal(layer.getSnapshot().draft.blocks.length, createBlockWorldContribution().blocks.length);
});

test("directory keeps selected and hovered cubes reachable beyond the capped rows", () => {
  const base = createBlockWorldContribution();
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot, projection: base });
  const selected = base.blocks.find((block) => block.id === layer.getSnapshot().selectedId);
  assert.ok(selected, "fixture should expose the initial selected cube");
  assert.ok(base.blocks.slice().sort((left, right) => left.id.localeCompare(right.id)).findIndex((block) => block.id === selected.id) >= 18, "selected fixture should exercise the directory cap");

  const list = documentRoot.getElementById("block-world-list");
  const rowIds = () => list.children
    .filter((child) => child.dataset?.blockId)
    .map((child) => child.dataset.blockId);
  assert.equal(rowIds().includes(selected.id), true, "selected cube remains visible even when outside the first 18 IDs");

  const hovered = base.blocks.find((block) => block.id === "block:6:2:2");
  assert.ok(hovered, "fixture should expose a far hover target");
  layer.setHoveredBlock(hovered.id);
  assert.equal(rowIds().includes(hovered.id), true, "hovered cube remains visible even when outside the first 18 IDs");

  const canonicalBefore = JSON.stringify(layer.getSnapshot().canonicalProjection);
  const grabbed = layer.grabSelected();
  assert.equal(grabbed.action, "grab");
  const heldRow = list.children.find((child) => child.className === "block-world-held-row");
  assert.ok(heldRow, "held cube keeps an explicit directory row");
  assert.equal(heldRow.dataset.blockId, selected.id, "held row keeps the stable cube ID");
  assert.equal(rowIds().includes(selected.id), true, "held cube remains addressable while detached from the draft block list");
  assert.equal(JSON.stringify(layer.getSnapshot().canonicalProjection), canonicalBefore, "directory reachability does not change canonical state");
});

test("distribution cohort cluster keeps canonical IDs and routes without fabrication", () => {
  const documentRoot = makeDocument();
  const opened = [];
  const layer = createBlockWorldLayer({ documentRoot, projection: createBlockWorldContribution(), onDistributionNavigate: (id) => opened.push(id) });
  const cohorts = [{ id: "cohort:county:alpha", label: "County Alpha", coverage: "fictional county cohort", shareBasisPoints: 500 }, { id: "not-a-cohort", label: "Ignored" }];
  const result = layer.setDistributionCohorts(cohorts);
  assert.deepEqual(result.map((entry) => entry.id), ["cohort:county:alpha"]);
  const rail = documentRoot.getElementById("block-world-console").children.find((child) => child.id === "block-world-feature-rail");
  const cluster = rail?.children.find((child) => child.dataset.featureCluster === "distribution");
  assert.ok(cluster);
  const child = cluster.children[1].children[0];
  assert.equal(child.dataset.cohortId, "cohort:county:alpha");
  assert.equal(child.dataset.distributionBlock, "true");
  assert.equal(child.tabIndex, 0);
  child.listeners.get("focus")();
  assert.match(documentRoot.getElementById("block-world-status").textContent, /COHORT FOCUS/);
  child.listeners.get("pointerenter")();
  assert.match(documentRoot.getElementById("block-world-status").textContent, /COHORT (HOVER|FOCUS)/);
  child.listeners.get("click")();
  assert.deepEqual(opened, ["cohort:county:alpha"]);
  const distributionToggle = cluster.children[0];
  distributionToggle.listeners.get("focus")();
  assert.match(documentRoot.getElementById("block-world-status").textContent, /CLUSTER FOCUS · DISTRIBUTION · 1 CANONICAL COHORTS/);
});

test("containers open and close as immutable local drafts and expose nested contents", () => {
  const base = createBlockWorldContribution();
  const container = base.blocks.find((block) => block.container && block.contentCount > 0);
  assert.ok(container, "fixture should include an inspectable container");
  assert.equal(container.open, false);
  const opened = createBlockWorldOpenDraft(base, container.id, true);
  const openedBlock = opened.blocks.find((block) => block.id === container.id);
  assert.equal(openedBlock.open, true);
  assert.equal(openedBlock.contentCount, container.contentCount);
  assert.equal(base.blocks.find((block) => block.id === container.id).open, false);
  assert.equal(opened.lastEdit.action, "open");
  assert.equal(Object.isFrozen(openedBlock.contents), true);
  const inspected = inspectBlockWorldBlock(opened, container.id);
  assert.equal(inspected.action, "inspect");
  assert.equal(inspected.opened, true);
  assert.deepEqual(inspected.contents, openedBlock.contents);
  assert.equal(inspected.localOnly, true);
  const genericInspection = createBlockWorldInteractionDraft(opened, {
    action: "inspect",
    blockId: container.id,
  });
  assert.deepEqual(genericInspection, inspected);
  const closed = createBlockWorldOpenDraft(opened, container.id, false);
  assert.equal(closed.blocks.find((block) => block.id === container.id).open, false);
  assert.equal(closed.lastEdit.action, "close");
});

test("moving a selected cube is one bounded immutable grid step and rejects collisions", () => {
  const base = createBlockWorldContribution();
  let candidate = null;
  let delta = null;
  for (const block of base.blocks) {
    for (const nextDelta of [{ dx: 1, dy: 0, dz: 0 }, { dx: -1, dy: 0, dz: 0 }, { dx: 0, dy: 0, dz: 1 }, { dx: 0, dy: 0, dz: -1 }]) {
      const x = block.x + nextDelta.dx;
      const y = block.y + nextDelta.dy;
      const z = block.z + nextDelta.dz;
      if (x >= 0 && x < base.dimensions.width && y >= 0 && y < base.dimensions.height && z >= 0 && z < base.dimensions.depth
        && !base.blocks.some((other) => other.x === x && other.y === y && other.z === z)) {
        candidate = block;
        delta = nextDelta;
        break;
      }
    }
    if (candidate) break;
  }
  assert.ok(candidate, "fixture should include an empty adjacent cell");
  const moved = createBlockWorldMoveDraft(base, candidate.id, delta);
  const movedBlock = moved.blocks.find((block) => block.blockType === candidate.blockType && block.source === "local-draft" && block.id !== candidate.id);
  assert.ok(movedBlock);
  assert.deepEqual(moved.lastEdit.from, [candidate.x, candidate.y, candidate.z]);
  assert.deepEqual(moved.lastEdit.to, [candidate.x + delta.dx, candidate.y + delta.dy, candidate.z + delta.dz]);
  assert.equal(base.blocks.some((block) => block.id === candidate.id), true);
  assert.throws(() => createBlockWorldMoveDraft(base, candidate.id, { dx: 2, dy: 0, dz: 0 }), /between -1 and 1/);
});

test("local block edits return a new draft and preserve the base projection", () => {
  const base = createBlockWorldContribution();
  const target = base.blocks.find((block) => block.blockType === "stone");
  const draft = createBlockWorldDraft(base, { action: "replace", x: target.x, y: target.y, z: target.z, blockType: "crystal" });
  assert.notEqual(draft, base);
  assert.equal(base.localDraft, false);
  assert.equal(draft.localDraft, true);
  assert.equal(draft.editCount, 1);
  assert.equal(draft.blocks.find((block) => block.x === target.x && block.y === target.y && block.z === target.z).blockType, "crystal");
  assert.equal(draft.lastEdit.localOnly, true);
  assert.equal(draft.lastEdit.externalNetwork, false);
  assert.equal(Object.isFrozen(draft), true);
});

test("renderer summary exposes block counts without adding authority", () => {
  const summary = summarizeBlockWorld({ contributions: [createBlockWorldContribution()] });
  assert.equal(summary.source, BLOCK_WORLD_SOURCE);
  assert.equal(summary.blockCount, summary.blocks.length);
  assert.ok(summary.typeCounts.portal >= 1);
  assert.match(summary.boundary, /no filesystem import/i);
  assert.ok(summary.capabilities.some((capability) => capability.denied === true));
});

test("migration draft applies five safe mappings sequentially and leaves canonical projection unchanged", () => {
  const base = createBlockWorldContribution();
  const documentRoot = makeDocument();
  const events = [];
  const layer = createBlockWorldLayer({
    documentRoot,
    projection: base,
    onEdit: (snapshot) => events.push(snapshot),
  });
  const canonicalBefore = JSON.stringify(layer.getSnapshot().canonicalProjection);
  const patches = [
    { mappingId: "migration:scene", status: "mapped", coordinate: [4, 0, 4], blockType: "portal" },
    { mappingId: "migration:games", status: "preserved", coordinate: [2, 0, 4], blockType: "crystal" },
    { mappingId: "migration:contracts", status: "mapped", coordinate: [6, 0, 4], blockType: "stone" },
    { mappingId: "migration:room", status: "mapped", coordinate: [4, 0, 2], blockType: "portal" },
    { mappingId: "migration:blocks", status: "preserved", coordinate: [4, 1, 4], blockType: "wood" },
    { mappingId: "migration:external", status: "deferred" },
  ];

  const result = layer.applyMigrationDraft(patches, "test");
  assert.equal(result.source, BLOCK_WORLD_MIGRATION_SOURCE);
  assert.equal(result.localDraft, true);
  assert.equal(result.editCount, 5);
  assert.deepEqual(result.appliedMappingIds, patches.slice(0, 5).map(({ mappingId }) => mappingId));
  assert.deepEqual(result.deferredMappingIds, ["migration:external"]);
  assert.deepEqual(result.appliedCoordinates.map(({ mappingId }) => mappingId), result.appliedMappingIds);
  assert.equal(result.migrationTrace.filter((entry) => entry.applied === true).length, 5);
  assert.equal(result.migrationTrace.some((entry) => entry.mappingId === "migration:external" && entry.applied === true), false);
  assert.equal(JSON.stringify(result.canonicalProjection), canonicalBefore);
  assert.equal(events.length, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.appliedCoordinates), true);
  assert.equal(Object.isFrozen(result.migrationTrace[0]), true);
});

test("a full migration preview keeps deferred rows visible without applying them", () => {
  const base = createBlockWorldContribution();
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot, projection: base });
  const preview = previewBlockMigration();
  const result = layer.applyMigrationDraft(preview, "preview");
  assert.equal(result.appliedMappingIds.length, 5);
  assert.equal(result.deferredMappingIds.includes("migration:external-project-sync"), true);
  assert.equal(result.migrationTrace.filter((entry) => entry.applied === true).length, 5);
  assert.equal(result.migrationTrace.some((entry) => entry.mappingId === "migration:external-project-sync" && entry.applied === true), false);
});

test("migration bridge validates all safe patches before editing, and replay resets local trace", () => {
  const base = createBlockWorldContribution();
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot, projection: base });
  const before = JSON.stringify(layer.getSnapshot());
  assert.throws(
    () => layer.applyDraftEdits([{ mappingId: "bad-coordinate", coordinate: [Number.NaN, 0, 0], blockType: "stone" }], "test"),
    /finite integer/,
  );
  assert.equal(JSON.stringify(layer.getSnapshot()), before);
  const applied = layer.applyMigrationDraft([
    { mappingId: "safe", coordinate: [0, 0, 0], blockType: "grass" },
  ], "test");
  assert.equal(applied.editCount, 1);
  const replay = layer.replay("test");
  assert.equal(replay.status, "replayed");
  assert.equal(layer.getSnapshot().localDraft, false);
  assert.equal(layer.getSnapshot().migrationTrace.length, 0);
  assert.equal(layer.getSnapshot().trace.length, 0);
});

test("migration bridge stays local-only and never imports or executes legacy values", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/render/block-world.js", import.meta.url), "utf8");
  assert.match(source, /applyMigrationDraft/);
  assert.match(source, /externalTransfer: false/);
  assert.match(source, /executable: false/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/i);
  assert.doesNotMatch(source, /\b(?:eval|import)\s*\(/i);
});

test("renderer interactions update the local draft and keep block geometry cube-only", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/render/block-world.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:SphereGeometry|CircleGeometry|TorusGeometry)/);
  assert.match(source, /block-world-selection-cue/);
  assert.match(source, /new three\.EdgesGeometry\(geometry\)/);
  assert.match(source, /selectionCues\.set\(blockId, cue\)/);
  assert.match(source, /blockWorldContainerCap/);
  assert.match(source, /blockWorldOpenable/);
  assert.match(source, /new three\.Mesh\(lidGeometry, contentMaterialFor\(block\.blockType\)\)/);
  const base = createBlockWorldContribution();
  const documentRoot = makeDocument();
  const events = [];
  const layer = createBlockWorldLayer({
    documentRoot,
    projection: base,
    onOpen: (snapshot) => events.push(snapshot),
    onInspect: (snapshot) => events.push(snapshot),
  });
  const container = base.blocks.find((block) => block.container && block.contentCount > 0);
  layer.selectBlock(container.id, "test");
  const opened = layer.toggleBlock();
  assert.equal(opened.action, "open");
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, true);
  const inspected = layer.inspectBlock();
  assert.equal(inspected.action, "inspect");
  assert.equal(events.length, 2);
  assert.equal(documentRoot.getElementById("block-world-contents").children.length, container.contentCount);
  assert.equal(layer.getSnapshot().canonicalProjection.blocks.find((block) => block.id === container.id).open, false);
});

test("renderer carry controls expose grab, hold, and place without changing canonical blocks", () => {
  const base = createBlockWorldContribution();
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot, projection: base });
  const directions = [
    { dx: 1, dy: 0, dz: 0 },
    { dx: -1, dy: 0, dz: 0 },
    { dx: 0, dy: 0, dz: 1 },
    { dx: 0, dy: 0, dz: -1 },
  ];
  let candidate = null;
  let destination = null;
  for (const block of base.blocks) {
    const empty = directions.find((delta) => {
      const x = block.x + delta.dx;
      const y = block.y + delta.dy;
      const z = block.z + delta.dz;
      return x >= 0 && x < base.dimensions.width
        && y >= 0 && y < base.dimensions.height
        && z >= 0 && z < base.dimensions.depth
        && !base.blocks.some((other) => other.x === x && other.y === y && other.z === z);
    });
    if (empty) {
      candidate = block;
      destination = empty;
      break;
    }
  }
  assert.ok(candidate, "fixture should include an empty carry destination");
  layer.selectBlock(candidate.id, "test");
  const grabbed = layer.grabSelected();
  assert.equal(grabbed.action, "grab");
  assert.equal(layer.getSnapshot().holding, true);
  assert.equal(layer.getSnapshot().draft.blocks.length, base.blocks.length - 1);
  const held = layer.holdSelected(destination);
  assert.equal(held.action, "hold");
  assert.deepEqual(held.heldBlock.coordinate, [candidate.x + destination.dx, candidate.y, candidate.z]);
  const placed = layer.placeHeld();
  assert.equal(placed.action, "place");
  assert.equal(layer.getSnapshot().holding, false);
  assert.equal(layer.getSnapshot().draft.blocks.length, base.blocks.length);
  assert.equal(layer.getSnapshot().canonicalProjection.blocks.length, base.blocks.length);
  assert.equal(layer.getSnapshot().draft.blocks.some((block) => block.x === candidate.x + destination.dx && block.y === candidate.y && block.z === candidate.z), true);
});
