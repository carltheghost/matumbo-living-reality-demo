import test from "node:test";
import assert from "node:assert/strict";
import {
  GATEWAY_TENTACLES_SOURCE,
  GATEWAY_TENTACLES_VERSION,
  GATEWAY_SATELLITES,
  GATEWAY_SATELLITE_IDS,
  GATEWAY_HUB_POSITION,
  getSatellite,
  satelliteLocalTime,
  satellitePosition,
  satelliteSpin,
  tentacleControlPoints,
  createTentacleState,
  toggleSatelliteChip,
  closeSatelliteChip,
  focusSatellite,
  mountGatewayTentacles,
} from "../src/render/gateway-tentacles.js";
import { makeFakeThree, makeDocument, findById, fire } from "./gateway-views-fakes.mjs";

test("exactly three satellites: phone, pc, picture-matter", () => {
  assert.equal(GATEWAY_SATELLITES.length, 3);
  assert.deepEqual([...GATEWAY_SATELLITE_IDS].sort(), ["pc", "phone", "picture-matter"]);
  assert.ok(GATEWAY_SATELLITES.every((s) => Object.isFrozen(s)));
  assert.equal(getSatellite("phone")?.label, "Phone");
  assert.equal(getSatellite("nope"), null);
});

test("satellites run independent clocks: same shared time, different local times", () => {
  const [phone, pc, pm] = GATEWAY_SATELLITES;
  const t0 = satelliteLocalTime(phone, 100);
  const t1 = satelliteLocalTime(pc, 100);
  const t2 = satelliteLocalTime(pm, 100);
  assert.notEqual(t0, t1);
  assert.notEqual(t1, t2);
  assert.notEqual(t0, t2);
  // Rates differ too: over 100 shared seconds the gaps widen unevenly.
  const gapA = Math.abs(satelliteLocalTime(phone, 200) - satelliteLocalTime(pc, 200));
  const gapB = Math.abs(satelliteLocalTime(phone, 100) - satelliteLocalTime(pc, 100));
  assert.notEqual(gapA, gapB);
  // Deterministic: same input, same output.
  assert.equal(satelliteLocalTime(phone, 100), t0);
});

test("satellite positions are sane and distinct per satellite", () => {
  const positions = GATEWAY_SATELLITES.map((s) => satellitePosition(s, 12.5));
  for (const p of positions) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
    const dist = Math.hypot(p.x - GATEWAY_HUB_POSITION.x, p.z - GATEWAY_HUB_POSITION.z);
    assert.ok(dist > 4 && dist < 12, `orbit radius sane: ${dist}`);
  }
  const [a, b] = positions;
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1, "satellites do not overlap");
});

test("tentacle control points: five points, hub surface to satellite", () => {
  const sat = getSatellite("phone");
  const satPos = satellitePosition(sat, 3);
  const pts = tentacleControlPoints(GATEWAY_HUB_POSITION, satPos, 0.7);
  assert.equal(pts.length, 5);
  for (const p of pts) assert.equal(p.length, 3);
  assert.deepEqual(pts[4], [satPos.x, satPos.y, satPos.z]);
  // First point sits on the hub surface (hub half-size from center in XZ).
  const d0 = Math.hypot(pts[0][0] - GATEWAY_HUB_POSITION.x, pts[0][2] - GATEWAY_HUB_POSITION.z);
  assert.ok(Math.abs(d0 - 1.1) < 0.01, `hub surface start: ${d0}`);
  // Sway actually moves the mid points.
  const still = tentacleControlPoints(GATEWAY_HUB_POSITION, satPos, 0);
  const swayed = tentacleControlPoints(GATEWAY_HUB_POSITION, satPos, Math.PI / 2);
  assert.notDeepEqual(still[1], swayed[1]);
});

test("materialization state: everything starts closed; toggle opens and closes", () => {
  const state = createTentacleState();
  assert.equal(state.viewOpen, false);
  assert.equal(state.openSatelliteId, null);
  toggleSatelliteChip(state, "phone");
  assert.equal(state.openSatelliteId, "phone");
  toggleSatelliteChip(state, "phone");
  assert.equal(state.openSatelliteId, null);
  toggleSatelliteChip(state, "pc");
  assert.equal(state.openSatelliteId, "pc");
  closeSatelliteChip(state);
  assert.equal(state.openSatelliteId, null);
  // Unknown ids are ignored.
  toggleSatelliteChip(state, "nope");
  assert.equal(state.openSatelliteId, null);
  focusSatellite(state, "picture-matter");
  assert.equal(state.focusedSatelliteId, "picture-matter");
});

test("mount requires its dependencies", () => {
  assert.throws(() => mountGatewayTentacles({}), /requires/);
  assert.throws(() => mountGatewayTentacles({ three: {} }), /requires/);
});

test("mount/open/tick/close/dispose lifecycle with fakes", () => {
  const three = makeFakeThree();
  const doc = makeDocument();
  const parent = new three.Group();
  const handle = mountGatewayTentacles({ three, parent, camera: {}, documentRoot: doc });
  assert.equal(handle.source, GATEWAY_TENTACLES_SOURCE);
  assert.equal(handle.version, GATEWAY_TENTACLES_VERSION);
  for (const fn of ["open", "close", "dispose", "tick", "getSnapshot"]) {
    assert.equal(typeof handle[fn], "function", fn);
  }

  let snap = handle.getSnapshot();
  assert.equal(snap.viewOpen, false);
  assert.equal(snap.openSatelliteId, null);

  handle.open();
  snap = handle.getSnapshot();
  assert.equal(snap.viewOpen, true);
  const group = parent.children.find((c) => c.name === "gateway-tentacles");
  assert.ok(group, "tentacle group attached to parent");
  assert.equal(group.visible, true);
  // Hub + 3 satellites + 3 tubes + 3 tips = 10 children.
  assert.equal(group.children.length, 10);

  // Tick advances the simulation without throwing; tubes get rebuilt geometry.
  handle.tick(10);
  handle.tick(20);
  const tube = group.children.find((c) => c.geometry?.tubularSegments === 28);
  assert.ok(tube, "tentacle tube geometry rebuilt on tick");

  handle.close();
  assert.equal(handle.getSnapshot().viewOpen, false);
  assert.equal(group.visible, false);

  handle.dispose();
  assert.equal(parent.children.length, 0, "group removed from parent on dispose");
  const chipAfter = findById(doc, "gt-chip");
  assert.equal(chipAfter._removed, true, "chip removed on dispose");
});

test("tap toggles a satellite chip; second tap closes it; Esc closes it", () => {
  const three = makeFakeThree();
  const doc = makeDocument();
  const parent = new three.Group();
  const handle = mountGatewayTentacles({ three, parent, camera: {}, documentRoot: doc });
  handle.open();

  // Aim the fake raycaster at the phone satellite.
  three._raycasters[0].hits = [{ object: { userData: { satelliteId: "phone" } } }];
  fire(doc, "pointerdown", { clientX: 100, clientY: 100 });
  fire(doc, "pointerup", { clientX: 102, clientY: 101 });
  assert.equal(handle.getSnapshot().openSatelliteId, "phone");

  const chip = findById(doc, "gt-chip");
  assert.equal(chip.getAttribute("data-open"), "true");

  // Tap again closes.
  fire(doc, "pointerdown", { clientX: 100, clientY: 100 });
  fire(doc, "pointerup", { clientX: 100, clientY: 100 });
  assert.equal(handle.getSnapshot().openSatelliteId, null);

  // Open once more, then Esc.
  fire(doc, "pointerdown", { clientX: 100, clientY: 100 });
  fire(doc, "pointerup", { clientX: 100, clientY: 100 });
  assert.equal(handle.getSnapshot().openSatelliteId, "phone");
  fire(doc, "keydown", { key: "Escape" });
  assert.equal(handle.getSnapshot().openSatelliteId, null);
});

test("keyboard: arrows cycle focus, Enter opens the focused chip", () => {
  const three = makeFakeThree();
  const doc = makeDocument();
  const parent = new three.Group();
  const handle = mountGatewayTentacles({ three, parent, camera: {}, documentRoot: doc });
  handle.open();
  fire(doc, "keydown", { key: "ArrowRight" });
  assert.equal(handle.getSnapshot().focusedSatelliteId, "phone");
  fire(doc, "keydown", { key: "ArrowRight" });
  assert.equal(handle.getSnapshot().focusedSatelliteId, "pc");
  fire(doc, "keydown", { key: "Enter" });
  assert.equal(handle.getSnapshot().openSatelliteId, "pc");
});

test("constellation entry button fires the callback", () => {
  const three = makeFakeThree();
  const doc = makeDocument();
  const parent = new three.Group();
  let opened = 0;
  const handle = mountGatewayTentacles({
    three, parent, camera: {}, documentRoot: doc,
    onOpenConstellation: () => { opened += 1; },
  });
  handle.open();
  const bar = findById(doc, "gt-bar");
  assert.equal(bar.getAttribute("data-open"), "true");
  const btn = bar.children.find((c) => c.tagName === "BUTTON");
  fire(btn, "click");
  assert.equal(opened, 1);
});
