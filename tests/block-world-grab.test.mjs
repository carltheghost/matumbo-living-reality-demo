import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLOCK_WORLD_GRAB_PLACE_ACTIONS,
  createBlockWorldContribution,
  createBlockWorldGrabDraft,
  createBlockWorldHoldDraft,
  createBlockWorldInteractionDraft,
  createBlockWorldPlaceDraft,
  createBlockWorldPickupDraft,
  createBlockWorldDropDraft,
} from "../src/domains/block-world.js";

const FLAGS = {
  localOnly: true,
  simulation: true,
  externalNetwork: false,
  externalTransfer: false,
  persistence: false,
  executable: false,
};

function emptyCell(base, excluded = new Set()) {
  const { width, depth, height } = base.dimensions;
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let z = 0; z < depth; z += 1) {
        const key = `${x}:${y}:${z}`;
        if (excluded.has(key)) continue;
        if (!base.blocks.some((block) => block.x === x && block.y === y && block.z === z)) return [x, y, z];
      }
    }
  }
  return null;
}

function occupiedNeighbor(base, block) {
  const deltas = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  return deltas
    .map(([dx, dy, dz]) => [block.x + dx, block.y + dy, block.z + dz])
    .find(([x, y, z]) => base.blocks.some((candidate) => candidate.x === x && candidate.y === y && candidate.z === z)) ?? null;
}

function emptyNeighbor(base, block) {
  const { width, depth, height } = base.dimensions;
  const deltas = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  return deltas
    .map(([dx, dy, dz]) => [block.x + dx, block.y + dy, block.z + dz])
    .find(([x, y, z]) => x >= 0 && x < width && y >= 0 && y < height && z >= 0 && z < depth
      && !base.blocks.some((candidate) => candidate.x === x && candidate.y === y && candidate.z === z)) ?? null;
}

function assertLocalRecord(record, action) {
  assert.equal(record.action, action);
  Object.entries(FLAGS).forEach(([key, value]) => assert.equal(record[key], value, `${action}.${key}`));
  assert.equal(Object.isFrozen(record), true);
}

function assertLocalFlags(record, label) {
  assert.ok(record && typeof record === "object", `${label} should be an object`);
  Object.entries(FLAGS).forEach(([key, value]) => assert.equal(record[key], value, `${label}.${key}`));
}

test("grab detaches one selected cube into an immutable local held draft", () => {
  const base = createBlockWorldContribution();
  const target = base.blocks.find((block) => block.blockType === "wood") ?? base.blocks[0];
  const canonicalBefore = JSON.stringify(base);
  const draft = createBlockWorldGrabDraft(base, target.id);

  assert.equal(draft.holding, true);
  assert.equal(draft.heldBlock.id, target.id);
  assert.deepEqual(draft.heldCoordinate, target.coordinate);
  assert.equal(draft.blocks.some((block) => block.id === target.id), false);
  assert.equal(draft.blocks.length, base.blocks.length - 1);
  assert.equal(JSON.stringify(base), canonicalBefore);
  assertLocalRecord(draft.lastEdit, "grab");
  assertLocalFlags(draft.heldBlock, "heldBlock");
  assertLocalFlags(draft, "grab draft");
  assert.equal(Object.isFrozen(draft), true);
  assert.equal(Object.isFrozen(draft.heldBlock), true);
  assert.equal(Object.isFrozen(draft.heldBlock.coordinate), true);
  assert.equal(BLOCK_WORLD_GRAB_PLACE_ACTIONS.join(","), "grab,hold,place");
  assert.equal(createBlockWorldPickupDraft, createBlockWorldGrabDraft);
});

test("hold keeps the cube detached and supports only bounded local movement", () => {
  const base = createBlockWorldContribution();
  const candidate = base.blocks.find((block) => emptyNeighbor(base, block)) ?? base.blocks[0];
  const target = emptyNeighbor(base, candidate);
  assert.ok(target, "fixture should have an empty adjacent cell");
  const grabbed = createBlockWorldGrabDraft(base, candidate.id);
  const before = JSON.stringify(grabbed);
  const held = createBlockWorldHoldDraft(grabbed, candidate.id, {
    dx: target[0] - candidate.x,
    dy: target[1] - candidate.y,
    dz: target[2] - candidate.z,
  });

  assert.equal(held.holding, true);
  assert.deepEqual(held.heldCoordinate, target);
  assert.equal(held.blocks.length, grabbed.blocks.length);
  assert.equal(JSON.stringify(grabbed), before);
  assertLocalRecord(held.lastEdit, "hold");
  assertLocalFlags(held.heldBlock, "heldBlock");
  assertLocalFlags(held, "hold draft");
  assert.deepEqual(held.lastEdit.delta, [target[0] - candidate.x, target[1] - candidate.y, target[2] - candidate.z]);
  assert.equal(Object.isFrozen(held.heldCoordinate), true);

  const heldAgain = createBlockWorldHoldDraft(held);
  assert.deepEqual(heldAgain.heldCoordinate, target);
  assertLocalRecord(heldAgain.lastEdit, "hold");

  assert.throws(() => createBlockWorldHoldDraft(grabbed, { dx: 2, dy: 0, dz: 0 }), /between -1 and 1/);
  const occupied = occupiedNeighbor(base, candidate);
  if (occupied) {
    const collisionDelta = { dx: occupied[0] - candidate.x, dy: occupied[1] - candidate.y, dz: occupied[2] - candidate.z };
    assert.throws(() => createBlockWorldHoldDraft(grabbed, collisionDelta), /occupied/);
  }
  assert.equal(JSON.stringify(grabbed), before, "rejected holds must be atomic");
});

test("place releases a held cube into an empty bounded cell and preserves identity boundaries", () => {
  const base = createBlockWorldContribution();
  const target = base.blocks.find((block) => block.container && block.contentCount > 0) ?? base.blocks[0];
  const grabbed = createBlockWorldGrabDraft(base, target.id);
  const destination = emptyCell(base, new Set([target.coordinate.join(":")]));
  assert.ok(destination, "fixture should have an empty place cell");
  const held = createBlockWorldHoldDraft(grabbed, { coordinate: destination });
  const before = JSON.stringify(held);
  const placed = createBlockWorldPlaceDraft(held, destination);

  assert.equal(placed.holding, false);
  assert.equal(placed.heldBlock, null);
  assert.equal(placed.heldBlockId, null);
  assert.equal(placed.blocks.length, base.blocks.length);
  const restored = placed.blocks.find((block) => block.x === destination[0] && block.y === destination[1] && block.z === destination[2]);
  assert.ok(restored);
  assert.equal(restored.blockType, target.blockType);
  assert.equal(restored.container, target.container);
  assert.equal(restored.contentCount, target.contentCount);
  assert.equal(JSON.stringify(held), before);
  assertLocalRecord(placed.lastEdit, "place");
  assert.equal(placed.lastEdit.blockId, target.id);
  assert.deepEqual(placed.lastEdit.to, destination);
  assertLocalFlags(placed.placedBlock, "placedBlock");
  assertLocalFlags(placed, "place draft");
  assert.equal(createBlockWorldDropDraft, createBlockWorldPlaceDraft);
});

test("grab, hold, and place reject missing, malformed, out-of-bounds, and occupied targets atomically", () => {
  const base = createBlockWorldContribution();
  const target = base.blocks[0];
  const canonicalBefore = JSON.stringify(base);
  assert.throws(() => createBlockWorldGrabDraft(base, "block:missing"), /not found/);
  assert.equal(JSON.stringify(base), canonicalBefore);

  const grabbed = createBlockWorldGrabDraft(base, target.id);
  const grabbedBefore = JSON.stringify(grabbed);
  assert.throws(() => createBlockWorldHoldDraft(grabbed, { coordinate: [999, 0, 0] }), /outside/);
  assert.throws(() => createBlockWorldHoldDraft(grabbed, { dx: 1.5, dy: 0, dz: 0 }), /integer/);
  assert.throws(() => createBlockWorldPlaceDraft(grabbed, [999, 0, 0]), /outside/);
  const occupied = base.blocks.find((block) => block.id !== target.id);
  assert.ok(occupied);
  assert.throws(() => createBlockWorldPlaceDraft(grabbed, occupied.coordinate), /occupied/);
  assert.equal(JSON.stringify(grabbed), grabbedBefore);
  assert.throws(() => createBlockWorldHoldDraft(base, { dx: 0, dy: 0, dz: 0 }), /held/);
  assert.throws(() => createBlockWorldPlaceDraft(base, [0, 0, 0]), /held/);
});

test("generic interaction dispatch preserves the existing interaction contract", () => {
  const base = createBlockWorldContribution();
  const target = base.blocks[0];
  const grabbed = createBlockWorldInteractionDraft(base, { action: "grab", blockId: target.id });
  const held = createBlockWorldInteractionDraft(grabbed, { action: "hold", blockId: target.id, delta: [0, 0, 0] });
  const destination = emptyCell(base, new Set([target.coordinate.join(":")]));
  const placed = createBlockWorldInteractionDraft(held, {
    action: "place",
    blockId: target.id,
    coordinate: destination,
  });
  assert.equal(grabbed.lastEdit.action, "grab");
  assert.equal(held.lastEdit.action, "hold");
  assert.equal(placed.lastEdit.action, "place");
  assert.equal(placed.holding, false);
  assert.equal(placed.blocks.length, base.blocks.length);
});
