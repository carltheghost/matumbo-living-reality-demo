import test from "node:test";
import assert from "node:assert/strict";
import {
  PANEL_DEPTH_MAX,
  PANEL_DEPTH_MIN,
  PANEL_HEIGHT_MIN,
  PANEL_WIDTH_MIN,
  clampDepth,
  clampSurface,
  clampSurfaceSize,
  composePanelTransform,
  depthBrightness,
  depthScale,
  normalizePanelArrangement,
} from "../src/render/centered-surfaces.js";

test("surface geometry stays inside the viewport", () => {
  const value = clampSurface(-100, 10000, 400, 300, 1000, 800);
  assert.equal(value.x, 8);
  assert.equal(value.y, 458);
});

test("surface size is independently resizable with safe bounds", () => {
  const small = clampSurfaceSize(1, 1, 1200, 900);
  assert.equal(small.width, PANEL_WIDTH_MIN);
  assert.equal(small.height, PANEL_HEIGHT_MIN);

  const large = clampSurfaceSize(99999, 99999, 900, 700);
  assert.ok(large.width <= 876);
  assert.ok(large.height <= 646);
});

test("depth remains bounded and monotonic", () => {
  assert.equal(clampDepth(-9999), PANEL_DEPTH_MIN);
  assert.equal(clampDepth(9999), PANEL_DEPTH_MAX);
  assert.ok(depthScale(PANEL_DEPTH_MAX) > depthScale(0));
  assert.ok(depthScale(PANEL_DEPTH_MIN) < depthScale(0));
  assert.ok(depthBrightness(PANEL_DEPTH_MAX) > depthBrightness(PANEL_DEPTH_MIN));
});

test("panel transform preserves independent x/y/z layout", () => {
  const value = composePanelTransform(12, 34, 100);
  assert.match(value, /translate3d\(12\.0px, 34\.0px, 0px\)/);
  assert.match(value, /scale\(/);
});

test("arrangement vocabulary is explicit", () => {
  assert.deepEqual(
    ["free","left","right","top","bottom","front","back"].map(normalizePanelArrangement),
    ["free","left","right","top","bottom","front","back"],
  );
  assert.equal(normalizePanelArrangement("garbage"), "free");
});
