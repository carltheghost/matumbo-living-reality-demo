import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "../vendor/three-r179.1/build/three.module.js";
import {
  TUMBO_COIN_VISUAL_SOURCE,
  createTumboCoinGeometry,
  createTumboCoinVisual,
  readTumboCoinState,
} from "../src/render/tumbo-coin.js";

test("TUMBO coin presentation reads exact simulation policy metadata", () => {
  const state = readTumboCoinState({
    TumboToken: {
      ledger: {
        history: () => [{ id: "receipt-1" }, { id: "receipt-2" }, { id: "receipt-3" }],
      },
    },
  });

  assert.equal(state.source, TUMBO_COIN_VISUAL_SOURCE);
  assert.equal(state.asset, "TUMBO-SIM");
  assert.equal(state.simulation, true);
  assert.equal(state.unit, "fluff");
  assert.equal(state.fluffPerTumbo, "1000");
  assert.equal(state.currentIssued.wholeTumbo, "10000000");
  assert.equal(state.currentIssued.fluff, "10000000000");
  assert.equal(state.intendedMaximum.wholeTumbo, "42000000000000");
  assert.equal(state.intendedMaximum.fluff, "42000000000000000");
  assert.equal(state.receiptCount, 3);
  assert.match(state.accessibilityLabel, /policy maximum 42,000,000,000,000/);
  assert.match(state.accessibilityLabel, /3 local ledger rows observed/);
  assert.doesNotMatch(state.accessibilityLabel, /\$|USD|price|market value/i);
  assert.equal(Object.isFrozen(state), true);
});

test("TUMBO coin geometry stays a readable face-on beveled blank", () => {
  const geometry = createTumboCoinGeometry(THREE, { radius: 0.68, thickness: 0.22 });
  geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.max.x - 0.68) < 0.01);
  assert.ok(Math.abs(geometry.boundingBox.max.y - 0.68) < 0.01);
  assert.ok(Math.abs(geometry.boundingBox.max.z - 0.11) < 0.01);
  assert.ok(geometry.getAttribute("normal").count > 0);
  geometry.dispose();
});

test("TUMBO coin details expose identity, quiet ledger state, and reduced-motion hooks", () => {
  const visual = createTumboCoinVisual(THREE, { radius: 0.68, thickness: 0.22, frontZ: 0.44 });
  const quietState = readTumboCoinState({ TumboToken: { ledger: { history: () => [] } } });

  assert.equal(visual.details.pips.length, 8);
  assert.equal(visual.details.face.userData.tumboCoinPart, "face");
  assert.ok(visual.details.parts.some((part) => part.userData?.tumboCoinPart === "tumbo-emblem"));
  assert.equal(visual.root.userData.accessibleLabel, quietState.accessibilityLabel);

  visual.update(quietState, { selected: true, hovered: false });
  assert.ok(visual.details.signalRing.scale.x > 1);
  visual.animate({ time: 24, reducedMotion: false });
  assert.notEqual(visual.details.signalRing.rotation.z, 0);
  visual.animate({ time: 24, reducedMotion: true });
  assert.equal(visual.details.signalRing.rotation.z, 0);

  visual.details.geometries.forEach((geometry) => geometry.dispose());
  visual.details.materials.forEach((material) => material.dispose());
  visual.body.geometry.dispose();
  visual.bodyMaterial.dispose();
});
