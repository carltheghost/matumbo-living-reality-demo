import { getCachedFaceTextures, invalidateFaceTextures } from "../offline/faceTextureCache.js";
import { appendSpacetimeEvent } from "../spacetime/spacetimeLog.js";

const contentState = new Map();

export function updateObjectFaceContent(objectId, faces, createTexture) {
  contentState.set(objectId, {
    faces,
    textures: getCachedFaceTextures(objectId, faces, createTexture),
    updatedAt: Date.now(),
  });

  appendSpacetimeEvent("wrap-content-change", objectId, {
    faces,
  });

  return contentState.get(objectId);
}

export function openObject(objectId) {
  appendSpacetimeEvent("open", objectId);
  return contentState.get(objectId);
}

export function closeObject(objectId) {
  appendSpacetimeEvent("close", objectId);
}

export function dismissObject(objectId) {
  appendSpacetimeEvent("dismiss", objectId);
}

export function removeObjectContentCache(objectId) {
  invalidateFaceTextures(objectId);
  contentState.delete(objectId);
}
