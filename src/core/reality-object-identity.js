function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  const result = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalize(value[key]);
  }
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function fnv1a(value) {
  const input = typeof value === "string" ? value : canonicalJson(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

export function createObjectIdentity({
  objectId,
  kind,
  origin,
  creator,
  timestamp,
  mutability,
}) {
  const fields = {
    objectId,
    kind,
    origin,
    creator,
    timestamp,
    mutability,
  };

  const identity = {
    ...fields,
    genesisHash: fnv1a(fields),
  };

  return Object.freeze(identity);
}

export function traitSeed(identity, namespace) {
  const seedInput = {
    objectId: identity.objectId,
    kind: identity.kind,
    origin: identity.origin,
    creator: identity.creator,
    timestamp: identity.timestamp,
    mutability: identity.mutability,
    namespace,
  };

  // Traits are presentation-only, never identity/ownership/authority.
  return fnv1a(seedInput);
}