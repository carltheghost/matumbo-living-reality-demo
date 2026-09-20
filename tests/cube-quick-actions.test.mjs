import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  CUBE_QUICK_ACTIONS,
  CUBE_QUICK_VIEW_ACTIONS,
  CUBE_QUICK_ACTIONS_BOUNDARY,
  CUBE_QUICK_ACTIONS_SOURCE,
  createCubeQuickActions,
} from "../src/render/cube-quick-actions.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    type: tag === "button" ? "button" : undefined,
    id: "",
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: "",
    listeners: new Map(),
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    replaceChildren() {},
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
  documentRoot.register("block-world-quick-actions", true);
  documentRoot.register("block-world-quick-actions-status");
  documentRoot.register("block-world-quick-actions-selected");
  documentRoot.register("block-world-quick-actions-boundary");
  documentRoot.register("block-world-quick-view-status");
  documentRoot.register("block-world-quick-view-boundary");
  ["open", "inspect", "move-left", "grab", "hold", "place"].forEach((action) => {
    documentRoot.register(`block-world-quick-action-${action}`, false, "button");
  });
  CUBE_QUICK_VIEW_ACTIONS.forEach((action) => {
    documentRoot.register(`block-world-quick-action-${action}`, false, "button");
  });
  return documentRoot;
}

function fixture({ holding = false, open = false } = {}) {
  return {
    selectedId: "cube:1:0:1",
    holding,
    heldBlock: holding ? { id: "cube:1:0:1", label: "Research Cube", x: 1, y: 0, z: 1, held: true } : null,
    directManipulation: null,
    draft: {
      blocks: [{
        id: "cube:1:0:1",
        label: "Research Cube",
        x: 1,
        y: 0,
        z: 1,
        container: true,
        canOpen: true,
        canMove: true,
        open,
      }],
    },
    semanticDepth: {
      mode: "3d",
      modes: ["3d", "4d", "5d"],
      axes: [{ blockId: "cube:1:0:1", nestedContentDepth: 1, linkedNeighborDegree: 2 }],
      projectionOnly: true,
      canonicalUnchanged: true,
      localOnly: true,
    },
  };
}

test("cube quick actions stay hidden until a feature context opts in", () => {
  const documentRoot = makeDocument();
  const rail = createCubeQuickActions({ documentRoot, getBlockWorldSnapshot: () => fixture() });
  const panel = documentRoot.getElementById("block-world-quick-actions");
  assert.equal(panel.hidden, true);
  assert.equal(rail.getSnapshot().opened, false);
  rail.open({ featureId: "rooms", featureLabel: "Rooms + Messaging", method: "portal" });
  assert.equal(panel.hidden, false);
  assert.equal(panel.getAttribute("aria-hidden"), "false");
  assert.match(documentRoot.getElementById("block-world-quick-actions-status").textContent, /OPEN \/ INSPECT \/ MOVE \/ GRAB \/ HOLD \/ PLACE/);
  assert.match(documentRoot.getElementById("block-world-quick-actions-selected").textContent, /Rooms \+ Messaging/);
  assert.equal(rail.getSnapshot().context.featureId, "rooms");
  assert.equal(rail.getSnapshot().boundary, CUBE_QUICK_ACTIONS_BOUNDARY);
});

test("quick buttons call existing host actions and emit local-only receipts", () => {
  const documentRoot = makeDocument();
  const calls = [];
  const rail = createCubeQuickActions({
    documentRoot,
    getBlockWorldSnapshot: () => fixture(),
    actions: Object.fromEntries(CUBE_QUICK_ACTIONS.map((action) => [action, () => {
      calls.push(action);
      return { action, draft: true };
    }])),
  });
  rail.open({ featureId: "contracts", featureLabel: "Contracts + Pools" });
  const button = documentRoot.getElementById("block-world-quick-action-open");
  button.listeners.get("click")({ detail: 1 });
  assert.deepEqual(calls, ["open"]);
  const receipt = rail.getSnapshot().trace.at(-1);
  assert.equal(receipt.source, CUBE_QUICK_ACTIONS_SOURCE);
  assert.equal(receipt.action, "open");
  assert.equal(receipt.localOnly, true);
  assert.equal(receipt.externalNetwork, false);
  assert.equal(receipt.persistence, false);
  assert.equal(receipt.executable, false);
  assert.equal(Object.isFrozen(receipt), true);
});

test("feature handoff clears only the transient action status while retaining the canonical cube snapshot", () => {
  const documentRoot = makeDocument();
  const rail = createCubeQuickActions({
    documentRoot,
    getBlockWorldSnapshot: () => fixture(),
    actions: { inspect: () => ({ action: "inspect" }) },
  });
  rail.open({ featureId: "contracts", featureLabel: "Contracts + Pools" });
  rail.runAction("inspect");
  assert.equal(rail.getSnapshot().lastAction, "inspect");
  rail.setContext({ featureId: "migration", featureLabel: "Migration Bridge" });
  const snapshot = rail.getSnapshot();
  assert.equal(snapshot.context.featureId, "migration");
  assert.equal(snapshot.lastAction, null);
  assert.equal(snapshot.latestSnapshot.selectedId, "cube:1:0:1");
  assert.equal(snapshot.trace.at(-1).action, "inspect", "the immutable local audit trace remains available");
  assert.match(documentRoot.getElementById("block-world-quick-actions-status").textContent, /Migration Bridge/);
  assert.doesNotMatch(documentRoot.getElementById("block-world-quick-actions-status").textContent, /ONE PROJECTION · INSPECT ·/);
});

test("hold and place stay disabled until the Block World reports a held cube", () => {
  const documentRoot = makeDocument();
  let snapshot = fixture();
  const rail = createCubeQuickActions({
    documentRoot,
    getBlockWorldSnapshot: () => snapshot,
    actions: { hold: () => ({ action: "hold" }), place: () => ({ action: "place" }) },
  });
  rail.open({ featureId: "person", featureLabel: "Person Ω" });
  assert.equal(documentRoot.getElementById("block-world-quick-action-hold").disabled, true);
  assert.equal(documentRoot.getElementById("block-world-quick-action-place").disabled, true);
  snapshot = fixture({ holding: true });
  rail.refresh();
  assert.equal(documentRoot.getElementById("block-world-quick-action-hold").disabled, false);
  assert.equal(documentRoot.getElementById("block-world-quick-action-place").disabled, false);
});

test("persistent view controls expose semantic depth and linked navigation", () => {
  const documentRoot = makeDocument();
  let snapshot = fixture();
  const calls = [];
  const rail = createCubeQuickActions({
    documentRoot,
    getBlockWorldSnapshot: () => snapshot,
    actions: {
      "depth-5d": () => {
        calls.push("depth-5d");
        snapshot = { ...snapshot, semanticDepth: { ...snapshot.semanticDepth, mode: "5d" } };
        return { mode: "5d", projectionOnly: true };
      },
      "linked-next": () => {
        calls.push("linked-next");
        return { targetBlockId: "cube:2:0:1", canonicalUnchanged: true };
      },
    },
  });
  rail.open({ featureId: "rooms", featureLabel: "Rooms + Messaging", method: "portal" });
  const depth5D = documentRoot.getElementById("block-world-quick-action-depth-5d");
  const linkedNext = documentRoot.getElementById("block-world-quick-action-linked-next");
  assert.equal(depth5D.disabled, false);
  assert.equal(linkedNext.disabled, false);
  assert.equal(documentRoot.getElementById("block-world-quick-action-depth-3d").getAttribute("aria-pressed"), "true");
  depth5D.listeners.get("click")({ detail: 1 });
  assert.deepEqual(calls, ["depth-5d"]);
  assert.equal(documentRoot.getElementById("block-world-quick-action-depth-5d").getAttribute("aria-pressed"), "true");
  assert.match(documentRoot.getElementById("block-world-quick-view-status").textContent, /5D PROJECTION.*W 1.*V 2/);
  linkedNext.listeners.get("click")({ detail: 1 });
  assert.deepEqual(calls, ["depth-5d", "linked-next"]);
  assert.equal(rail.getSnapshot().trace.at(-1).action, "linked-next");
  assert.equal(rail.getSnapshot().trace.at(-1).localOnly, true);
});

test("keyboard activation is touch-safe and does not double-run a native click", () => {
  const documentRoot = makeDocument();
  let count = 0;
  const rail = createCubeQuickActions({
    documentRoot,
    getBlockWorldSnapshot: () => fixture(),
    actions: { inspect: () => { count += 1; return { ok: true }; } },
  });
  rail.open({ featureId: "reality-lens", featureLabel: "Reality Lens Ω" });
  const button = documentRoot.getElementById("block-world-quick-action-inspect");
  let prevented = false;
  button.listeners.get("keydown")({ key: "Enter", preventDefault: () => { prevented = true; }, stopPropagation() {} });
  button.listeners.get("click")({ detail: 0 });
  assert.equal(prevented, true);
  assert.equal(count, 1);
  assert.equal(button.getAttribute("aria-keyshortcuts"), "Enter Space");
});

test("quick action source declares no external or executable path", async () => {
  const source = await readFile(new URL("../src/render/cube-quick-actions.js", import.meta.url), "utf8");
  assert.match(source, /CUBE_QUICK_ACTIONS_BOUNDARY/);
  assert.match(source, /externalNetwork:\s*false/);
  assert.match(source, /persistence:\s*false/);
  assert.match(source, /executable:\s*false/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /localStorage|indexedDB|WebSocket/);
});

test("block-world quick-actions mount is compact, explicit, and touch-safe", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/cube-quick-actions.js", import.meta.url), "utf8");
  assert.match(html, /id="block-world-quick-actions"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(html, /id="block-world-quick-action-open"/);
  assert.match(html, /id="block-world-quick-action-inspect"/);
  assert.match(html, /id="block-world-quick-action-move-left"/);
  assert.match(html, /id="block-world-quick-action-grab"/);
  assert.match(html, /id="block-world-quick-action-hold"/);
  assert.match(html, /id="block-world-quick-action-place"/);
  assert.match(html, /id="block-world-quick-action-depth-3d"/);
  assert.match(html, /id="block-world-quick-action-depth-4d"/);
  assert.match(html, /id="block-world-quick-action-depth-5d"/);
  assert.match(html, /id="block-world-quick-action-linked-previous"/);
  assert.match(html, /id="block-world-quick-action-linked-next"/);
  assert.match(html, /id="block-world-quick-view-toolbar"[^>]*aria-label="Semantic depth and linked cube navigation"/);
  assert.match(html, /#block-world-quick-actions-toolbar button\{[^}]*min-height:44px/);
  assert.match(html, /#block-world-quick-actions-toolbar button\{[^}]*touch-action:manipulation/);
  assert.match(source, /block-world-quick-action-move-left/);
  assert.match(source, /CUBE_QUICK_VIEW_ACTIONS/);
  assert.match(source, /semantic depth projection/);
  assert.match(source, /actions\?\.\[canonicalAction\]/);
  assert.match(source, /createBlockWorldQuickActions/);
});
