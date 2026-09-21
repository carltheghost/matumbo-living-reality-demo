import test from "node:test";
import assert from "node:assert/strict";
import {
  CONSTELLATION_SOURCE,
  CONSTELLATION_VERSION,
  CONSTELLATION_RADIUS,
  CONSTELLATION_CENTER,
  nodeTintFor,
  constellationLayout,
  constellationLinks,
  createConstellationState,
  toggleNodeChip,
  closeNodeChip,
  focusNode,
  mountConstellationOverview,
} from "../src/render/constellation-overview.js";
import { makeFakeThree, makeDocument, findById, fire } from "./gateway-views-fakes.mjs";

const NODES = [
  { id: "reality-lens", label: "Reality Lens Ω", kicker: "lens", description: "Semantic zoom." },
  { id: "person", label: "Person", kicker: "avatar", description: "Avatar studio." },
  { id: "block-world", label: "Block World", kicker: "world", description: "Cube field." },
  { id: "gateway", label: "World Gateway", kicker: "gateway", description: "Threshold." },
  { id: "agent", label: "Agent", kicker: "bots", description: "Bots." },
];
const LINKS = {
  "reality-lens": ["person", "block-world"],
  person: ["agent"],
  "block-world": ["reality-lens", "gateway"],
  gateway: ["reality-lens"],
  agent: ["missing-feature"],
};

test("layout: deterministic sphere, all nodes placed, none overlapping exactly", () => {
  const a = constellationLayout(NODES);
  const b = constellationLayout(NODES);
  assert.equal(a.size, NODES.length);
  for (const node of NODES) {
    const pa = a.get(node.id);
    const pb = b.get(node.id);
    assert.deepEqual(pa, pb, "layout is deterministic");
    const dist = Math.hypot(pa.x - CONSTELLATION_CENTER.x, pa.z - CONSTELLATION_CENTER.z);
    assert.ok(dist <= CONSTELLATION_RADIUS + 0.001, `inside sphere: ${dist}`);
  }
  const keys = [...a.values()].map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`);
  assert.equal(new Set(keys).size, keys.length, "no two nodes share a position");
  assert.deepEqual([...constellationLayout([]).keys()], [], "empty in, empty out");
});

test("links: derived from the handoff graph, filtered and deduplicated", () => {
  const pairs = constellationLinks(NODES, LINKS);
  const ids = new Set(NODES.map((n) => n.id));
  assert.ok(pairs.length > 0, "some links derived");
  for (const [from, to] of pairs) {
    assert.ok(ids.has(from) && ids.has(to), `endpoints exist: ${from} -> ${to}`);
    assert.notEqual(from, to, "no self links");
  }
  // reality-lens <-> block-world appears once despite being listed both ways.
  const rlBw = pairs.filter(([a, b]) =>
    (a === "reality-lens" && b === "block-world") || (a === "block-world" && b === "reality-lens"));
  assert.equal(rlBw.length, 1, "bidirectional link deduplicated");
  // Dangling target dropped.
  assert.ok(!pairs.some(([a, b]) => a === "missing-feature" || b === "missing-feature"));
});

test("node tints are deterministic numbers", () => {
  const t1 = nodeTintFor(NODES[0]);
  assert.equal(typeof t1, "number");
  assert.equal(nodeTintFor(NODES[0]), t1, "deterministic");
  assert.equal(nodeTintFor({}), nodeTintFor({}), "fallback deterministic");
});

test("materialization state starts closed; toggle/focus/close behave", () => {
  const state = createConstellationState();
  assert.equal(state.viewOpen, false);
  assert.equal(state.openNodeId, null);
  toggleNodeChip(state, NODES, "gateway");
  assert.equal(state.openNodeId, "gateway");
  toggleNodeChip(state, NODES, "gateway");
  assert.equal(state.openNodeId, null);
  toggleNodeChip(state, NODES, "nope");
  assert.equal(state.openNodeId, null);
  focusNode(state, NODES, "agent");
  assert.equal(state.focusedNodeId, "agent");
  closeNodeChip(state);
  assert.equal(state.openNodeId, null);
});

test("mount requires its dependencies", () => {
  assert.throws(() => mountConstellationOverview({}), /requires/);
});

test("mount builds one cube per node plus the connecting-lines mesh", () => {
  const three = makeFakeThree();
  const doc = makeDocument();
  const parent = new three.Group();
  const handle = mountConstellationOverview({
    three, parent, camera: {}, documentRoot: doc, nodes: NODES, links: LINKS,
  });
  assert.equal(handle.source, CONSTELLATION_SOURCE);
  assert.equal(handle.version, CONSTELLATION_VERSION);
  handle.open();

  const group = parent.children.find((c) => c.name === "constellation-overview");
  assert.ok(group, "overview group attached");
  assert.equal(group.visible, true);

  const cubes = group.children.filter((c) => c.userData?.nodeId);
  assert.equal(cubes.length, NODES.length, "one cube per node");
  const lineMeshes = group.children.filter((c) => !c.userData?.nodeId);
  assert.equal(lineMeshes.length, 1, "single LineSegments for all links");
  const posAttr = lineMeshes[0].geometry.attributes.position;
  assert.ok(posAttr.count > 0, "link vertices exist");
  assert.equal(posAttr.count % 2, 0, "vertices come in segment pairs");
  assert.equal(handle.linkPairs.length, posAttr.count / 2, "one segment per link pair");

  const snap = handle.getSnapshot();
  assert.equal(snap.viewOpen, true);
  assert.equal(snap.nodeCount, NODES.length);
  assert.equal(snap.linkCount, handle.linkPairs.length);

  handle.tick(5); // idle motion must not throw
  handle.close();
  assert.equal(handle.getSnapshot().viewOpen, false);
  assert.equal(group.visible, false);
  handle.dispose();
  assert.equal(parent.children.length, 0, "group removed on dispose");
});

test("tap a cube materializes its chip; Open feature fires the callback", () => {
  const three = makeFakeThree();
  const doc = makeDocument();
  const parent = new three.Group();
  let openedFeature = null;
  const handle = mountConstellationOverview({
    three, parent, camera: {}, documentRoot: doc, nodes: NODES, links: LINKS,
    onOpenFeature: (id) => { openedFeature = id; },
  });
  handle.open();

  three._raycasters[0].hits = [{ object: { userData: { nodeId: "gateway" } } }];
  fire(doc, "pointerdown", { clientX: 50, clientY: 50 });
  fire(doc, "pointerup", { clientX: 51, clientY: 50 });
  assert.equal(handle.getSnapshot().openNodeId, "gateway");

  const chip = findById(doc, "co-chip");
  assert.equal(chip.getAttribute("data-open"), "true");
  // Chip shows the feature label, not a flat in-world label.
  const title = chip.children.find((c) => c.tagName === "H2");
  assert.equal(title.textContent, "World Gateway");

  const row = chip.children.find((c) => c.tagName === "DIV" && c.children.length === 2);
  const openBtn = row.children[0];
  fire(openBtn, "click");
  assert.equal(openedFeature, "gateway");

  fire(doc, "keydown", { key: "Escape" });
  assert.equal(handle.getSnapshot().openNodeId, null);
});

test("keyboard arrows cycle focus; Enter opens the chip", () => {
  const three = makeFakeThree();
  const doc = makeDocument();
  const parent = new three.Group();
  const handle = mountConstellationOverview({
    three, parent, camera: {}, documentRoot: doc, nodes: NODES, links: LINKS,
  });
  handle.open();
  fire(doc, "keydown", { key: "ArrowRight" });
  assert.equal(handle.getSnapshot().focusedNodeId, "reality-lens");
  fire(doc, "keydown", { key: "ArrowLeft" });
  assert.equal(handle.getSnapshot().focusedNodeId, "agent");
  fire(doc, "keydown", { key: "Enter" });
  assert.equal(handle.getSnapshot().openNodeId, "agent");
});

test("tentacles entry button fires its callback", () => {
  const three = makeFakeThree();
  const doc = makeDocument();
  const parent = new three.Group();
  let backToTentacles = 0;
  const handle = mountConstellationOverview({
    three, parent, camera: {}, documentRoot: doc, nodes: NODES, links: LINKS,
    onOpenTentacles: () => { backToTentacles += 1; },
  });
  handle.open();
  const bar = findById(doc, "co-bar");
  assert.equal(bar.getAttribute("data-open"), "true");
  const btn = bar.children.find((c) => c.tagName === "BUTTON");
  fire(btn, "click");
  assert.equal(backToTentacles, 1);
});
