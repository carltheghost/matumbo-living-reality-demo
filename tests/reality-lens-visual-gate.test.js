import { describe, it, expect } from "vitest";

/**
 * QA gate for Tumbo's object-tab law:
 * Information belongs to the object.
 * No decorative orb. No detached slab.
 */

function collectObjects(root, predicate) {
  const result = [];
  root.traverse((obj) => {
    if (predicate(obj)) result.push(obj);
  });
  return result;
}

function isDetachedInfoMesh(obj, blockGroup) {
  return (
    obj.userData?.role === "info-panel" ||
    obj.userData?.role === "text-slab" ||
    obj.name?.toLowerCase().includes("panel") ||
    obj.name?.toLowerCase().includes("slab")
  ) && !blockGroup.children.includes(obj);
}

describe("Reality Lens object-tab visual gate", () => {
  it("has zero orb objects after opening a constellation block", async () => {
    const scene = await globalThis.openTestConstellationBlock?.();

    expect(scene).toBeTruthy();

    const orbObjects = collectObjects(\
      scene,\
      (obj) =>\
        obj.userData?.role === "orb" ||\
        obj.name?.toLowerCase().includes("orb") ||\
        obj.userData?.decorativeSphere === true\
    );

    expect(orbObjects).toHaveLength(0);
  });

  it("has zero detached floating panels or slabs", async () => {
    const { scene, blockGroup } =
      await globalThis.openTestConstellationBlock?.();

    const detachedPanels = collectObjects(\
      scene,\
      (obj) => isDetachedInfoMesh(obj, blockGroup)\
    );

    expect(detachedPanels).toHaveLength(0);
  });

  it("keeps title/body/actions meshes inside the block group", async () => {
    const { blockGroup } =
      await globalThis.openTestConstellationBlock?.();

    const infoMeshes = collectObjects(\
      blockGroup,\
      (obj) =>\
        obj.userData?.role === "title" ||\
        obj.userData?.role === "body" ||\
        obj.userData?.role === "action"\
    );

    expect(infoMeshes.length).toBeGreaterThan(0);

    for (const mesh of infoMeshes) {
      expect(mesh.parent).toBe(blockGroup);
      expect(mesh.userData.surface).toBe("block-face");
    }
  });

  it("rejects mirrored text transforms", async () => {
    const { blockGroup } =
      await globalThis.openTestConstellationBlock?.();

    const textMeshes = collectObjects(\
      blockGroup,\
      (obj) => obj.userData?.isTextFace === true\
    );

    for (const mesh of textMeshes) {
      expect(mesh.scale.x).toBeGreaterThan(0);
      expect(mesh.rotation.y).not.toBeCloseTo(Math.PI);
      expect(mesh.userData.mirrored).not.toBe(true);
    }
  });

  it("open and close preserves the same object identity", async () => {
    const block = await globalThis.getTestBlock?.();

    const originalId = block.uuid;

    await block.open?.();
    await block.close?.();

    expect(block.uuid).toBe(originalId);
    expect(block.userData.transformingObject).toBe(true);
  });
});
