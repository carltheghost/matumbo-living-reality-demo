import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import {
  BLOCK_WORLD_CONTAINER_SIGNAL_COLOR,
  BLOCK_WORLD_CONTAINER_SIGNAL_EMISSIVE,
  BLOCK_WORLD_CONTAINER_SIGNAL_OFFSET_Y,
  BLOCK_WORLD_SEMANTIC_DEPTH_MODES,
  getBlockWorldLinkedNeighbors,
  getBlockWorldSemanticAxes,
  getBlockWorldSemanticDepthOffset,
} from "../src/render/block-world.js";

test("semantic depth derives W/V from local block relationships without mutating coordinates", () => {
  const projection = createBlockWorldContribution();
  const container = projection.blocks.find((block) => block.container && block.contentCount > 0);
  assert.ok(container, "fixture should include a nested-content container");
  const before = [container.x, container.y, container.z];
  const axes = getBlockWorldSemanticAxes(container, projection.blocks);

  assert.equal(axes.blockId, container.id);
  assert.ok(axes.nestedContentDepth >= 1);
  assert.ok(axes.nestedContentCount >= 1);
  assert.ok(axes.linkedNeighborDegree >= axes.nestedContentCount);
  assert.ok(axes.w > 0 && axes.w <= 1);
  assert.ok(axes.v >= 0 && axes.v <= 1);
  assert.deepEqual([container.x, container.y, container.z], before);
  assert.equal(Object.isFrozen(axes), true);
  assert.equal(Object.isFrozen(axes.nestedContentIds), true);
});

test("3D, 4D, and 5D semantic offsets are reversible renderer transforms", () => {
  const axes = { w: 0.75, v: 0.5 };
  assert.deepEqual(BLOCK_WORLD_SEMANTIC_DEPTH_MODES, ["3d", "4d", "5d"]);
  const three = getBlockWorldSemanticDepthOffset(axes, "3d");
  const four = getBlockWorldSemanticDepthOffset(axes, "4d");
  const five = getBlockWorldSemanticDepthOffset(axes, "5d");

  assert.deepEqual([three.x, three.y, three.z], [0, 0, 0]);
  assert.notDeepEqual([four.x, four.y, four.z], [0, 0, 0]);
  assert.notDeepEqual([five.x, five.y, five.z], [four.x, four.y, four.z]);
  [three, four, five].forEach((offset) => {
    assert.equal(offset.projectionOnly, true);
    assert.equal(offset.canonicalUnchanged, true);
    assert.equal(Object.isFrozen(offset), true);
  });
});

test("linked navigation keeps grid and parent/content relationships deterministic", () => {
  const projection = createBlockWorldContribution();
  const container = projection.blocks.find((block) => block.container && block.contentCount > 0);
  assert.ok(container);
  const links = getBlockWorldLinkedNeighbors(container, projection.blocks);
  assert.ok(links.length >= 1);
  assert.equal(Object.isFrozen(links), true);
  assert.ok(links.every((link) => Object.isFrozen(link)));
  assert.ok(links.some((link) => link.relation === "parent-to-nested-content"));
  assert.ok(links.every((link) => link.coordinate === null || link.coordinate.length === 3));
  assert.equal(
    JSON.stringify(getBlockWorldLinkedNeighbors(container, projection.blocks)),
    JSON.stringify(links),
  );
});

test("container signal constants stay cube-only, red, and offset from the body", () => {
  assert.equal(BLOCK_WORLD_CONTAINER_SIGNAL_COLOR, 0x8f122d);
  assert.equal(BLOCK_WORLD_CONTAINER_SIGNAL_EMISSIVE, 0xf02c4a);
  assert.ok(BLOCK_WORLD_CONTAINER_SIGNAL_OFFSET_Y > 1);
});
