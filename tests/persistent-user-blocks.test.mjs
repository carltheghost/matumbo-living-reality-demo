import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSISTENT_BLOCK_LIMIT,
  PERSISTENT_BLOCK_TEMPLATES,
  clampBlockDepth,
  clampBlockPosition,
  normalizeBlockId,
  normalizeBlockSpec,
} from "../src/render/persistent-user-blocks.js";

test("persistent blocks have a bounded default catalog and limit", () => {
  assert.equal(PERSISTENT_BLOCK_LIMIT, 24);
  assert.ok(PERSISTENT_BLOCK_TEMPLATES.some((item) => item.type === "media"));
  assert.ok(PERSISTENT_BLOCK_TEMPLATES.some((item) => item.type === "social"));
});

test("block ids normalize safely and deterministically", () => {
  assert.equal(normalizeBlockId(" My Prime/App #1 "), "my-prime-app-1");
  assert.equal(normalizeBlockId("***"), "");
});

test("block definitions remain local simulation metadata", () => {
  const spec = normalizeBlockSpec({
    id: "user-prime",
    title: "Prime-style Media · SIMULATED",
    type: "media",
    body: "local",
    items: ["One", "Two"],
  });
  assert.equal(spec.id, "user-prime");
  assert.equal(spec.simulation, true);
  assert.equal(spec.localOnly, true);
  assert.deepEqual(spec.items, ["One", "Two"]);
});

test("position helper keeps blocks inside the viewport", () => {
  const p = clampBlockPosition(-40, 9999, 300, 200, 1000, 700);
  assert.equal(p.x, 8);
  assert.equal(p.y, 458);
});

test("depth helper clamps front/back range", () => {
  assert.equal(clampBlockDepth(-99999), -900);
  assert.equal(clampBlockDepth(99999), 700);
});
