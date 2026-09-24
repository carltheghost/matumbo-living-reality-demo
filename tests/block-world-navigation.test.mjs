import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  BLOCK_WORLD_PORTAL_ROUTE_REGISTRY,
  BLOCK_WORLD_SOURCE,
  createBlockWorldContribution,
  createBlockWorldNavigationDraft,
  getBlockWorldPortalRoute,
} from "../src/domains/block-world.js";
import { createBlockWorldLayer } from "../src/render/block-world.js";

const ROOT = new URL("../", import.meta.url);

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
    ["block-world-close"], ["block-world-replay"], ["block-world-add"],
    ["block-world-remove"], ["block-world-replace"], ["block-world-open"],
    ["block-world-inspect"], ["block-world-move-left"], ["block-world-move-right"],
    ["block-world-move-forward"], ["block-world-move-back"], ["block-world-move-up"],
    ["block-world-move-down"], ["block-world-grab"], ["block-world-hold-left"],
    ["block-world-hold-right"], ["block-world-hold-forward"], ["block-world-hold-back"],
    ["block-world-hold-up"], ["block-world-hold-down"], ["block-world-place"],
    ["block-world-status"], ["block-world-count"], ["block-world-draft-count"],
    ["block-world-container-count"], ["block-world-content-count"], ["block-world-selection"],
    ["block-world-list"], ["block-world-palette"], ["block-world-trace"],
    ["block-world-boundary"], ["block-world-inspection"], ["block-world-contents"],
    ["block-world-routes"], ["block-world-navigation-status"], ["block-world-navigation-trace"],
  ].forEach(([id, hidden]) => documentRoot.register(id, hidden));
  return documentRoot;
}

test("portal route registry is finite, frozen, and local-only", () => {
  const expectedRoutes = [
    "rooms",
    "migration",
    "social-explorer",
    "launch-distribution",
    "asset-token",
    "asset-market",
    "arena",
    "contracts",
    "paycore",
    "t402",
    "agent",
    "picture-matter",
    "ledger",
    "gateway",
    "world-events",
    "web-ai",
    "projections",
    "sports-events",
    "multi-sport-events",
    "reality-lens",
    "social-mirror",
  ];
  assert.equal(BLOCK_WORLD_PORTAL_ROUTE_REGISTRY.length, expectedRoutes.length);
  assert.deepEqual(BLOCK_WORLD_PORTAL_ROUTE_REGISTRY.map((route) => route.id), expectedRoutes);
  assert.equal(new Set(BLOCK_WORLD_PORTAL_ROUTE_REGISTRY.map((route) => route.id)).size, expectedRoutes.length);
  const gateway = BLOCK_WORLD_PORTAL_ROUTE_REGISTRY.find((route) => route.id === "gateway");
  assert.equal(gateway?.label, "World Gateway / Evidence");
  assert.equal(gateway?.surface, "world-events-console");
  assert.doesNotMatch(gateway?.description ?? "", /mock/i);
  const assetMarket = BLOCK_WORLD_PORTAL_ROUTE_REGISTRY.find((route) => route.id === "asset-market");
  assert.equal(assetMarket?.label, "Asset Market Evidence");
  assert.equal(assetMarket?.surface, "asset-market-console");
  const worldEvents = BLOCK_WORLD_PORTAL_ROUTE_REGISTRY.find((route) => route.id === "world-events");
  assert.equal(worldEvents?.label, "World Events / Evidence");
  assert.equal(worldEvents?.surface, "world-events-console");
  assert.doesNotMatch(worldEvents?.description ?? "", /mock/i);
  assert.ok(Object.isFrozen(BLOCK_WORLD_PORTAL_ROUTE_REGISTRY));
  BLOCK_WORLD_PORTAL_ROUTE_REGISTRY.forEach((route) => {
    assert.ok(Object.isFrozen(route));
    assert.equal(route.localOnly, true);
    assert.equal(route.simulation, true);
    assert.equal(route.externalNetwork, false);
    assert.equal(route.externalTransfer, false);
    assert.equal(route.persistence, false);
    assert.equal(route.executable, false);
    assert.equal(getBlockWorldPortalRoute(route.featureId), route);
  });
});

test("shareable panel=block-world route opens the interactive cube console", async () => {
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");
  assert.match(main, /get\('panel'\) === ['"]block-world['"]/);
  assert.match(main, /get\('panel'\) === ['"]block-world['"][\s\S]{0,420}featureNavigator\.select\('block-world', 'url', \{ updateLocation: false \}\)/);
  assert.match(main, /get\('panel'\) === ['"]block-world['"][\s\S]{0,520}featureNavigator\.close\(\)[\s\S]{0,120}blockWorld\?\.open\(\)/);
});

test("cold-load Block World actions deterministically select a real container before opening", async () => {
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");
  const start = main.indexOf("const blockActionQuery = new URLSearchParams");
  const end = main.indexOf("if (blockActionQuery.get('panel') === 'block-snapshot')", start);
  assert.ok(start >= 0 && end > start, "expected the URL block-action route");
  const route = main.slice(start, end);
  assert.match(route, /const defaultContainer = blocks\.find\(\(block\) => block\.canOpen && block\.container\)/);
  assert.match(route, /: explicitBlock \?\? defaultContainer/);
  assert.match(route, /blockWorld\.selectBlock\(selectedBlock\.id, 'url'\);[\s\S]{0,140}blockWorld\.openBlock\(true\)/);
});

test("cold-load Block World actions honor an explicit existing blockId target", async () => {
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");
  const start = main.indexOf("const blockActionQuery = new URLSearchParams");
  const end = main.indexOf("if (blockActionQuery.get('panel') === 'block-snapshot')", start);
  assert.ok(start >= 0 && end > start, "expected the URL block-action route");
  const route = main.slice(start, end);
  assert.match(route, /blockActionQuery\.get\('blockId'\)/);
  assert.match(route, /const explicitBlock = requestedBlockId[\s\S]{0,120}blocks\.find\(\(block\) => block\.id === requestedBlockId\)/);
  assert.match(route, /: explicitBlock \?\? defaultContainer/);
  assert.match(route, /externalNetwork|local draft|state store/i);
});

test("selecting a Block World cube immediately publishes its readout before it is opened", async () => {
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");
  const start = main.indexOf("onSelect: (block, method) => {");
  const end = main.indexOf("onOpen: (snapshot, action) => {", start);
  assert.ok(start >= 0 && end > start, "expected the Block World select callback");
  const selectCallback = main.slice(start, end);
  assert.match(selectCallback, /showBlockReadout\(block, 'select'\)/);
  assert.match(selectCallback, /projection\.select-block/);
  assert.match(selectCallback, /cubeQuickActions\?\.refresh\?\.\(\)/);
});

test("asset market and World Pulse portal routes use existing handlers without a second refresh", async () => {
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");
  assert.match(main, /'asset-market',/);
  assert.match(main, /['"]asset-market['"]:\s*\(\)\s*=>\s*openAssetMarket\('block-portal:asset-market',\s*false\)/);
  assert.match(main, /'world-events':\s*\(\)\s*=>\s*openWorldEvents\('block-portal:world-events',\s*false\)/);
  assert.match(main, /else if \(feature\.id === 'world-events'\)[\s\S]{0,900}worldEventsConsole\?\.refresh\(`feature:\$\{method\}`\)/);
});

test("portal navigation draft validates the portal source and preserves canonical blocks", () => {
  const base = createBlockWorldContribution();
  const portal = base.blocks.find((block) => block.blockType === "portal");
  const before = JSON.stringify(base.blocks);
  assert.ok(portal);

  const draft = createBlockWorldNavigationDraft(base, portal.id, "rooms", "test-button");
  assert.equal(draft.source, BLOCK_WORLD_SOURCE);
  assert.equal(draft.action, "portal-navigate");
  assert.equal(draft.targetFeature, "rooms");
  assert.equal(draft.routeId, "rooms");
  assert.equal(draft.transition, "portal");
  assert.equal(draft.portalTransition.type, "portal");
  assert.equal(draft.localDraft, true);
  assert.equal(draft.localOnly, true);
  assert.equal(draft.externalNetwork, false);
  assert.equal(Object.isFrozen(draft), true);
  assert.equal(JSON.stringify(base.blocks), before);

  const objectForm = createBlockWorldNavigationDraft(base, {
    sourceBlockId: portal.id,
    targetFeature: "arena",
  });
  assert.equal(objectForm.targetFeature, "arena");
  assert.equal(objectForm.sourceBlockId, portal.id);
  assert.throws(() => createBlockWorldNavigationDraft(base, portal.id, "not-a-route"), /unknown portal route/);
  const solid = base.blocks.find((block) => block.blockType !== "portal");
  assert.throws(() => createBlockWorldNavigationDraft(base, solid.id, "rooms"), /portal source block/);
  assert.equal(JSON.stringify(base.blocks), before);
});

test("renderer exposes portal buttons, frozen hand-off, visible trace, and atomic rejection", () => {
  const base = createBlockWorldContribution();
  const portal = base.blocks.find((block) => block.blockType === "portal");
  assert.ok(portal);
  const documentRoot = makeDocument();
  const events = [];
  const layer = createBlockWorldLayer({
    documentRoot,
    projection: base,
    onNavigate: (snapshot, method) => events.push({ snapshot, method }),
  });
  const canonicalBefore = JSON.stringify(layer.getSnapshot().canonicalProjection.blocks);

  layer.selectBlock(portal.id, "test");
  const routeList = documentRoot.getElementById("block-world-routes");
  assert.equal(routeList.children.length, BLOCK_WORLD_PORTAL_ROUTE_REGISTRY.length);
  const roomsButton = routeList.children.find((button) => button.dataset.routeId === "rooms");
  assert.ok(roomsButton);
  assert.equal(roomsButton.listeners.has("click"), true);
  roomsButton.listeners.get("click")();

  assert.equal(events.length, 1);
  assert.equal(events[0].method, "button");
  assert.equal(events[0].snapshot.targetFeature, "rooms");
  assert.equal(events[0].snapshot.sourceBlockId, portal.id);
  assert.equal(Object.isFrozen(events[0].snapshot), true);
  assert.equal(layer.getSnapshot().lastNavigation.targetFeature, "rooms");
  assert.equal(layer.getSnapshot().navigationTrace.length, 1);
  assert.equal(documentRoot.getElementById("block-world-navigation-trace").children.length, 1);
  assert.equal(JSON.stringify(layer.getSnapshot().canonicalProjection.blocks), canonicalBefore);
  assert.equal(JSON.stringify(layer.getSnapshot().draft.blocks), canonicalBefore);

  const before = JSON.stringify(layer.getSnapshot());
  assert.equal(layer.navigatePortal("not-a-route"), null);
  assert.equal(JSON.stringify(layer.getSnapshot().draft.blocks), canonicalBefore);
  assert.equal(JSON.stringify(layer.getSnapshot().canonicalProjection.blocks), canonicalBefore);
  assert.equal(JSON.stringify(layer.getSnapshot()), before, "a rejected route is atomic, including the visible snapshot");
  layer.selectBlock(base.blocks.find((block) => block.blockType !== "portal").id, "test");
  assert.equal(layer.navigatePortal("rooms"), null);
  assert.equal(events.length, 1);
});

test("replay clears portal navigation trace without changing the canonical fixture", () => {
  const base = createBlockWorldContribution();
  const portal = base.blocks.find((block) => block.blockType === "portal");
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot, projection: base });
  layer.selectBlock(portal.id, "test");
  assert.ok(layer.navigatePortal("reality-lens"));
  assert.equal(layer.getSnapshot().navigationTrace.length, 1);
  layer.replay("test");
  assert.equal(layer.getSnapshot().lastNavigation, null);
  assert.equal(layer.getSnapshot().navigationTrace.length, 0);
  assert.equal(JSON.stringify(layer.getSnapshot().canonicalProjection.blocks), JSON.stringify(base.blocks));
});
