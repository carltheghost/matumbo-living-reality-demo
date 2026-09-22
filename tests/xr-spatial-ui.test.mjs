import test from "node:test";
import assert from "node:assert/strict";
import {
  XR_SIDE_TABS,
  createXrSpatialUi,
} from "../src/render/xr-spatial-ui.js";

test("XR side tabs expose world, market, exchange, agents and air keyboard", () => {
  assert.deepEqual(
    XR_SIDE_TABS.map((tab) => tab.id),
    ["world", "market", "exchange", "agents", "keyboard"],
  );
});

test("spatial UI stays DOM-safe in a headless environment", () => {
  const ui = createXrSpatialUi({ documentRoot: null });
  assert.equal(ui.mount(), false);
  assert.equal(ui.isVisible(), false);
  assert.equal(ui.getSnapshot().simulation, true);
});

test("spatial UI reports exchange catalog count without network access", () => {
  const ui = createXrSpatialUi({ documentRoot: null });
  assert.ok(ui.getSnapshot().cryptoAssetCount >= 16);
  assert.equal(ui.getSnapshot().externalExecution, false);
});
