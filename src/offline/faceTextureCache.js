const textureCache = new Map();

function stableKey(objectId, faces) {
  return `${objectId}:${JSON.stringify(faces)}`;
}

export function getCachedFaceTextures(objectId, faces, createTexture) {
  const key = stableKey(objectId, faces);
  const existing = textureCache.get(key);

  if (existing) {
    return existing;
  }

  const textures = createTexture(faces);
  textureCache.set(key, textures);
  return textures;
}

export function invalidateFaceTextures(objectId) {
  for (const key of textureCache.keys()) {
    if (key.startsWith(`${objectId}:`)) {
      textureCache.delete(key);
    }
  }
}

export function clearFaceTextureCache() {
  textureCache.clear();
}

export function getFaceTextureCacheSize() {
  return textureCache.size;
}
