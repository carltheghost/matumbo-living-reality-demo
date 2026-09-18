/**
 * Fictional local NFT Atelier for the Living Reality demo.
 *
 * Every piece here is a simulated collectible: minting, inspection, and
 * burning happen only in this page session. There is no wallet, no chain, no
 * transfer, no sale, no custody, no royalty payout, and no external
 * publication. IDs are deterministic so the same seed always rebuilds the
 * same atelier; nothing here is a uniqueness, ownership, or value claim.
 */

export const NFT_ATELIER_SCHEMA_VERSION = 1;
export const NFT_ATELIER_SOURCE = "nft-atelier";
export const NFT_ATELIER_CONSOLE_SOURCE = "nft-atelier-console";
export const NFT_ATELIER_UPDATED_AT = "2026-09-18T00:00:00.000Z";
export const NFT_ATELIER_MAX_NAME_LENGTH = 48;
export const NFT_ATELIER_MAX_DESCRIPTION_LENGTH = 280;
export const NFT_ATELIER_MAX_ATTRIBUTES = 8;

export const NFT_ATELIER_BOUNDARY =
  "NFT Atelier is a fictional local rehearsal. Minted pieces are simulated collectibles with no wallet, no chain, no transfer, no sale, no custody, no royalty, and no external publication. Nothing minted here is ownable or valuable outside this page session.";

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** Deterministic FNV-1a hash; keeps atelier IDs stable per seed. */
export function hashNftAtelierSeed(value) {
  const text = safeText(value, "nft-atelier");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function nowIso(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    // null/undefined/"" mean "no injected clock": use the wall clock.
    // (new Date(null) would silently become the 1970 epoch.)
    if (value === null || value === undefined || value === "") {
      return new Date().toISOString();
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to the wall clock; tests inject `now`.
  }
  return new Date().toISOString();
}

function boundedName(name) {
  const normalized = safeText(name).trim().replace(/\s+/g, " ").slice(0, NFT_ATELIER_MAX_NAME_LENGTH);
  if (!normalized) throw new TypeError("nft name must be a non-empty string");
  return normalized;
}

function boundedDescription(description) {
  return safeText(description).trim().replace(/\s+/g, " ").slice(0, NFT_ATELIER_MAX_DESCRIPTION_LENGTH);
}

function boundedAttributes(attributes) {
  if (attributes === null || attributes === undefined) return [];
  if (!Array.isArray(attributes)) throw new TypeError("nft attributes must be an array");
  return attributes.slice(0, NFT_ATELIER_MAX_ATTRIBUTES).map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`nft attribute ${index} must be an object`);
    }
    const trait = safeText(entry.trait).trim().slice(0, 32) || `trait-${index + 1}`;
    const value = safeText(entry.value).trim().slice(0, 64) || "—";
    return { trait, value };
  });
}

const RARITY_TIERS = ["common", "uncommon", "rare", "epic", "mythic"];

function deriveRarity(tokenHash) {
  const roll = parseInt(tokenHash.slice(0, 2), 16);
  if (roll >= 250) return RARITY_TIERS[4];
  if (roll >= 230) return RARITY_TIERS[3];
  if (roll >= 190) return RARITY_TIERS[2];
  if (roll >= 120) return RARITY_TIERS[1];
  return RARITY_TIERS[0];
}

export const NFT_ATELIER_STARTER_PIECES = freeze([
  {
    key: "genesis-artifact",
    name: "Genesis Artifact",
    collection: "Atelier Origins",
    description: "The first simulated relic minted in this atelier. A study in light, not an asset.",
    attributes: [
      { trait: "medium", value: "procedural light study" },
      { trait: "palette", value: "gold / cyan" },
    ],
  },
  {
    key: "wardrobe-echo",
    name: "Wardrobe Echo",
    collection: "Persona Fragments",
    description: "A fictional garment-memory from the Person studio wardrobe. Wearable nowhere.",
    attributes: [
      { trait: "medium", value: "garment memory" },
      { trait: "slot", value: "outerwear" },
    ],
  },
  {
    key: "cube-relic",
    name: "Cube Relic",
    collection: "Block World Finds",
    description: "Recovered from the voxel field during a local rehearsal. It opens nothing.",
    attributes: [
      { trait: "medium", value: "voxel carving" },
      { trait: "origin", value: "block-world grid" },
    ],
  },
]);

/**
 * Create a fictional atelier. `seed` rebuilds the same starter set; `now` is
 * injectable for deterministic tests.
 */
export function createNftAtelier({ seed = "local-atelier", now = null } = {}) {
  const atelierSeed = safeText(seed) || "local-atelier";
  let counter = 0;
  const pieces = new Map();
  const trace = [];
  let sequence = 0;

  function recordTrace(action, pieceId, detail = "") {
    sequence += 1;
    trace.push(freeze({
      seq: sequence,
      action,
      pieceId,
      detail: safeText(detail).slice(0, 120),
      at: nowIso(now),
      simulation: true,
    }));
    return sequence;
  }

  function buildPiece({ key, name, collection, description, attributes }) {
    counter += 1;
    const tokenHash = hashNftAtelierSeed(`${atelierSeed}:${counter}:${name}`);
    const id = `nft:${tokenHash.slice(0, 8)}:${String(counter).padStart(4, "0")}`;
    return freeze({
      id,
      key: safeText(key) || `piece-${counter}`,
      name,
      collection: safeText(collection).trim().slice(0, 48) || "Unsorted",
      description,
      attributes,
      rarity: deriveRarity(tokenHash),
      edition: `1 of 1 (simulated)`,
      mintedAt: nowIso(now),
      burned: false,
      provenance: freeze([
        { event: "designed", at: nowIso(now), note: "Fictional design committed locally." },
        { event: "minted", at: nowIso(now), note: "Simulated mint. No chain, no wallet, no transfer." },
      ]),
      simulation: true,
      transferable: false,
      valuable: false,
    });
  }

  function mint({ name, description = "", attributes = [], collection = "Unsorted" } = {}) {
    const piece = buildPiece({
      key: "",
      name: boundedName(name),
      collection,
      description: boundedDescription(description),
      attributes: boundedAttributes(attributes),
    });
    pieces.set(piece.id, piece);
    recordTrace("mint", piece.id, piece.name);
    return piece;
  }

  function get(pieceId) {
    return pieces.get(safeText(pieceId)) ?? null;
  }

  function list({ includeBurned = false } = {}) {
    const all = [...pieces.values()];
    return freeze(includeBurned ? all : all.filter((piece) => !piece.burned));
  }

  function inspect(pieceId) {
    const piece = get(pieceId);
    if (!piece) return null;
    recordTrace("inspect", piece.id, piece.name);
    return freeze({
      piece,
      provenance: piece.provenance,
      boundary: NFT_ATELIER_BOUNDARY,
      inspectionAt: nowIso(now),
    });
  }

  function burn(pieceId) {
    const piece = get(pieceId);
    if (!piece) throw new TypeError("unknown nft piece id");
    if (piece.burned) return piece;
    const burned = freeze({
      ...piece,
      burned: true,
      provenance: freeze([
        ...piece.provenance,
        { event: "burned", at: nowIso(now), note: "Simulated burn. The rehearsal record is voided locally." },
      ]),
    });
    pieces.set(piece.id, burned);
    recordTrace("burn", piece.id, piece.name);
    return burned;
  }

  function reset() {
    pieces.clear();
    trace.length = 0;
    counter = 0;
    sequence = 0;
    NFT_ATELIER_STARTER_PIECES.forEach((starter) => {
      const piece = buildPiece(starter);
      pieces.set(piece.id, piece);
    });
    recordTrace("reset", "atelier", "starter set restored");
    return getSnapshot();
  }

  function getSnapshot() {
    const visible = list();
    return freeze({
      schemaVersion: NFT_ATELIER_SCHEMA_VERSION,
      source: NFT_ATELIER_SOURCE,
      seed: atelierSeed,
      simulation: true,
      localOnly: true,
      minted: visible.length,
      burned: [...pieces.values()].filter((piece) => piece.burned).length,
      pieces: visible.map((piece) => freeze({
        id: piece.id,
        name: piece.name,
        collection: piece.collection,
        rarity: piece.rarity,
        mintedAt: piece.mintedAt,
      })),
      trace: freeze([...trace].slice(-24)),
      boundary: NFT_ATELIER_BOUNDARY,
      wallet: false,
      chain: false,
      transfer: false,
      sale: false,
      custody: false,
      externalPublication: false,
    });
  }

  function createContribution() {
    const visible = list();
    return freeze({
      schemaVersion: NFT_ATELIER_SCHEMA_VERSION,
      source: NFT_ATELIER_SOURCE,
      updatedAt: NFT_ATELIER_UPDATED_AT,
      simulation: true,
      entities: visible.map((piece) => ({
        id: piece.id,
        kind: "nft-piece",
        label: piece.name,
        collection: piece.collection,
        rarity: piece.rarity,
        simulation: true,
      })),
      evidence: [{
        id: "nft-atelier:local-mints",
        kind: "simulated-mint-log",
        pieceIds: visible.map((piece) => piece.id),
        status: "local",
      }],
      capabilities: [{ id: "nft-atelier.mint", mode: "local-rehearsal", authority: "none", executable: false }],
      boundary: NFT_ATELIER_BOUNDARY,
    });
  }

  // Seed the starter set so the gallery is never empty on first open.
  NFT_ATELIER_STARTER_PIECES.forEach((starter) => {
    const piece = buildPiece(starter);
    pieces.set(piece.id, piece);
  });

  return freeze({
    mint,
    get,
    list,
    inspect,
    burn,
    reset,
    getSnapshot,
    createContribution,
    source: NFT_ATELIER_SOURCE,
    boundary: NFT_ATELIER_BOUNDARY,
  });
}

export function createNftAtelierContribution({ seed = "local-atelier", updatedAt = NFT_ATELIER_UPDATED_AT } = {}) {
  const studio = createNftAtelier({ seed });
  const contribution = studio.createContribution();
  return freeze({ ...contribution, updatedAt });
}

export default createNftAtelier;
