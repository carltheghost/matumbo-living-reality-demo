/**
 * Fictional local NFT Atelier for the Living Reality demo.
 *
 * Every piece here is a simulated collectible: minting, inspection, and
 * burning happen only in the local browser collection. There is no wallet, no chain, no
 * transfer, no sale, no custody, no royalty payout, and no external
 * publication. IDs are deterministic so the same seed always rebuilds the
 * same atelier; nothing here is a uniqueness, ownership, or value claim.
 */

import { sha256Hex } from "./token-sha256.js?v=20261003-skin360";

export const NFT_ATELIER_SCHEMA_VERSION = 1;
export const NFT_ATELIER_SOURCE = "nft-atelier";
export const NFT_ATELIER_CONSOLE_SOURCE = "nft-atelier-console";
export const NFT_ATELIER_UPDATED_AT = "2026-09-18T00:00:00.000Z";
export const NFT_ATELIER_MAX_NAME_LENGTH = 48;
export const NFT_ATELIER_MAX_DESCRIPTION_LENGTH = 280;
export const NFT_ATELIER_MAX_ATTRIBUTES = 8;
export const NFT_ATELIER_STORAGE_KEY = "matumbo.nft-atelier.v1";
export const NFT_ATELIER_MAX_PIECES = 200;
export const NFT_ATELIER_MAX_BACKUP_BYTES = 500000;
const BACKUP_FORMAT = "matumbo-nft-atelier-v1";
const backupBytes = raw => new TextEncoder().encode(raw).byteLength;

export const NFT_ATELIER_BOUNDARY =
  "NFT Atelier is a fictional local rehearsal. Designs can be saved in this browser or a JSON backup. Simulated collectibles have no wallet, no chain, no transfer, no sale, no custody, no royalty, and no external publication. A local record is not external ownership or value.";

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function validDate(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return value;
}

function exactFields(record, fields, label) {
  if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(record, key))) throw new TypeError(`${label} contains unsupported or missing fields`);
}

/** Backups preserve authored records, including locally burned pieces. The digest
 * catches damage; it is not a signature, chain proof, or ownership attestation. */
function validateBackup(raw) {
  if (typeof raw !== "string" || raw.length > NFT_ATELIER_MAX_BACKUP_BYTES || backupBytes(raw) > NFT_ATELIER_MAX_BACKUP_BYTES) throw new TypeError("Atelier backup must be a bounded JSON document");
  let data;
  try { data = JSON.parse(raw); } catch { throw new TypeError("Atelier backup is not valid JSON"); }
  if (!data || Array.isArray(data) || typeof data !== "object") throw new TypeError("Atelier backup must be an object");
  const { digest, ...body } = data;
  exactFields(body, ["format", "schemaVersion", "seed", "counter", "sequence", "pieces", "trace"], "Atelier backup");
  if (body.format !== BACKUP_FORMAT || body.schemaVersion !== NFT_ATELIER_SCHEMA_VERSION || digest !== sha256Hex(JSON.stringify(body))) throw new TypeError("Atelier backup is damaged or uses an unsupported format");
  if (typeof body.seed !== "string" || !body.seed || body.seed.length > 200) throw new TypeError("Atelier backup seed is invalid");
  if (!Number.isSafeInteger(body.counter) || body.counter < 0 || body.counter > NFT_ATELIER_MAX_PIECES || !Number.isSafeInteger(body.sequence) || body.sequence < 0) throw new TypeError("Atelier backup counters are invalid");
  if (!Array.isArray(body.pieces) || body.pieces.length > NFT_ATELIER_MAX_PIECES || body.pieces.length !== body.counter || !Array.isArray(body.trace) || body.trace.length > 100) throw new TypeError("Atelier backup collection exceeds its limit");
  const ids = new Set();
  body.pieces.forEach((piece, index) => {
    exactFields(piece, ["id", "key", "name", "collection", "description", "attributes", "rarity", "edition", "mintedAt", "burned", "provenance", "simulation", "transferable", "valuable"], "Atelier piece");
    const ordinal = index + 1, hash = hashNftAtelierSeed(`${body.seed}:${ordinal}:${piece.name}`);
    if (piece.id !== `nft:${hash}:${String(ordinal).padStart(4, "0")}` || ids.has(piece.id)) throw new TypeError("Atelier piece identity is invalid");
    ids.add(piece.id);
    if (typeof piece.name !== "string" || piece.name !== boundedName(piece.name) || typeof piece.description !== "string" || piece.description !== boundedDescription(piece.description) || typeof piece.collection !== "string" || !piece.collection || piece.collection.length > 48 || typeof piece.key !== "string" || piece.key.length > 200) throw new TypeError("Atelier piece text is invalid");
    if (!Array.isArray(piece.attributes) || piece.attributes.length > NFT_ATELIER_MAX_ATTRIBUTES || JSON.stringify(boundedAttributes(piece.attributes)) !== JSON.stringify(piece.attributes)) throw new TypeError("Atelier piece attributes are invalid");
    if (piece.rarity !== deriveRarity(hash) || piece.edition !== "1 of 1 (simulated)" || typeof piece.burned !== "boolean" || piece.simulation !== true || piece.transferable !== false || piece.valuable !== false) throw new TypeError("Atelier backup cannot assert external collectible authority");
    validDate(piece.mintedAt, "Atelier mint time");
    const expected = piece.burned ? ["designed", "minted", "burned"] : ["designed", "minted"];
    if (!Array.isArray(piece.provenance) || piece.provenance.length !== expected.length) throw new TypeError("Atelier provenance is invalid");
    piece.provenance.forEach((entry, entryIndex) => {
      exactFields(entry, ["event", "at", "note"], "Atelier provenance");
      if (!entry || entry.event !== expected[entryIndex] || typeof entry.note !== "string" || entry.note.length > 200) throw new TypeError("Atelier provenance is invalid");
      validDate(entry.at, "Atelier provenance time");
    });
  });
  let previous = 0;
  for (const entry of body.trace) {
    exactFields(entry, ["seq", "action", "pieceId", "detail", "at", "simulation"], "Atelier action");
    if (!entry || !Number.isSafeInteger(entry.seq) || entry.seq <= previous || entry.seq > body.sequence || !["mint", "burn", "inspect", "reset"].includes(entry.action) || typeof entry.detail !== "string" || entry.detail.length > 120 || (entry.pieceId !== "atelier" && !ids.has(entry.pieceId)) || entry.simulation !== true) throw new TypeError("Atelier action history is invalid");
    validDate(entry.at, "Atelier action time");
    previous = entry.seq;
  }
  return body;
}

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
export function createNftAtelier({ seed = "local-atelier", now = null, storage = browserStorage(), restore = true } = {}) {
  let atelierSeed = safeText(seed).slice(0, 200) || "local-atelier";
  let counter = 0;
  const pieces = new Map();
  const trace = [];
  let sequence = 0;
  let lastSaved = null;
  let persistence = { mode: storage ? "browser" : "memory", status: storage ? "new" : "session-only", error: null };

  function serialize({ nextPieces = [...pieces.values()], nextTrace = [...trace], nextCounter = counter, nextSequence = sequence } = {}) {
    const body = { format: BACKUP_FORMAT, schemaVersion: NFT_ATELIER_SCHEMA_VERSION, seed: atelierSeed, counter: nextCounter, sequence: nextSequence, pieces: nextPieces, trace: nextTrace };
    // Import, export and persistence use one compact UTF-8 payload. A collection
    // that passes capacity validation must remain portable without reformatting.
    const raw = JSON.stringify({ ...body, digest: sha256Hex(JSON.stringify(body)) });
    if (backupBytes(raw) > NFT_ATELIER_MAX_BACKUP_BYTES) throw new Error("Atelier backup capacity reached; export before resetting the collection");
    return raw;
  }

  function exportState() { return serialize(); }

  function nextTrace(action, pieceId, detail = "") {
    return [...trace, { seq: sequence + 1, action, pieceId, detail: safeText(detail).slice(0, 120), at: nowIso(now), simulation: true }].slice(-100);
  }

  function assertWritable() {
    if (persistence.status === "held") throw new Error(`Saved atelier is held: ${persistence.error}. Export the current view, import a valid backup, or explicitly reset the collection.`);
    if (!storage) return;
    let current;
    try { current = storage.getItem(NFT_ATELIER_STORAGE_KEY); }
    catch (error) { persistence = { mode: "browser", status: "held", error: `Saved collection cannot be read: ${error?.message ?? error}` }; throw new Error(persistence.error); }
    if (current !== lastSaved) {
      persistence = { mode: "browser", status: "held", error: "Another tab changed this collection; reload before editing" };
      throw new Error(persistence.error);
    }
  }

  function persist() {
    if (!storage) return;
    try {
      const raw = exportState();
      storage.setItem(NFT_ATELIER_STORAGE_KEY, raw);
      lastSaved = raw;
      persistence = { mode: "browser", status: "saved", error: null };
    } catch (error) { persistence = { mode: "memory", status: "save-failed", error: String(error?.message ?? error) }; }
  }

  function applyBackup(body) {
    atelierSeed = body.seed;
    counter = body.counter;
    sequence = body.sequence;
    pieces.clear();
    body.pieces.forEach(piece => pieces.set(piece.id, freeze(piece)));
    trace.splice(0, trace.length, ...body.trace.map(freeze));
  }

  function importState(raw) {
    const body = validateBackup(raw); // Validate every record before any local change.
    const serialized = JSON.stringify({ ...body, digest: sha256Hex(JSON.stringify(body)) });
    if (backupBytes(serialized) > NFT_ATELIER_MAX_BACKUP_BYTES) throw new TypeError("Atelier backup exceeds its normalized UTF-8 capacity");
    if (persistence.status !== "held") assertWritable();
    else if (storage && storage.getItem(NFT_ATELIER_STORAGE_KEY) !== lastSaved) throw new Error("Another tab changed this collection; reload before importing");
    applyBackup(body);
    persist();
    return getSnapshot();
  }

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
    if (trace.length > 100) trace.shift();
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
    assertWritable();
    if (counter >= NFT_ATELIER_MAX_PIECES) throw new Error("Atelier collection is full; export before starting another collection");
    const piece = buildPiece({
      key: "",
      name: boundedName(name),
      collection,
      description: boundedDescription(description),
      attributes: boundedAttributes(attributes),
    });
    try { serialize({ nextPieces: [...pieces.values(), piece], nextTrace: nextTrace("mint", piece.id, piece.name), nextSequence: sequence + 1 }); }
    catch (error) { counter -= 1; throw error; }
    pieces.set(piece.id, piece);
    recordTrace("mint", piece.id, piece.name);
    persist();
    return piece;
  }

  function get(pieceId) {
    return pieces.get(safeText(pieceId)) ?? null;
  }

  function list({ includeBurned = false } = {}) {
    const all = [...pieces.values()];
    return freeze(includeBurned ? all : all.filter((piece) => !piece.burned));
  }

  function inspect(pieceId, { record = true } = {}) {
    const piece = get(pieceId);
    if (!piece) return null;
    if (record) {
      assertWritable();
      serialize({ nextTrace: nextTrace("inspect", piece.id, piece.name), nextSequence: sequence + 1 });
      recordTrace("inspect", piece.id, piece.name);
      persist();
    }
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
    assertWritable();
    const burned = freeze({
      ...piece,
      burned: true,
      provenance: freeze([
        ...piece.provenance,
        { event: "burned", at: nowIso(now), note: "Simulated burn. The rehearsal record is voided locally." },
      ]),
    });
    serialize({ nextPieces: [...pieces.values()].map(row => row.id === piece.id ? burned : row), nextTrace: nextTrace("burn", piece.id, piece.name), nextSequence: sequence + 1 });
    pieces.set(piece.id, burned);
    recordTrace("burn", piece.id, piece.name);
    persist();
    return burned;
  }

  function reset() {
    // Reset is an explicit user action. It can recover a damaged held backup,
    // but a stale tab must still reload before replacing a newer collection.
    if (storage && storage.getItem(NFT_ATELIER_STORAGE_KEY) !== lastSaved) throw new Error("Another tab changed this collection; reload before resetting");
    pieces.clear();
    trace.length = 0;
    counter = 0;
    sequence = 0;
    NFT_ATELIER_STARTER_PIECES.forEach((starter) => {
      const piece = buildPiece(starter);
      pieces.set(piece.id, piece);
    });
    recordTrace("reset", "atelier", "starter set restored");
    persistence = { mode: storage ? "browser" : "memory", status: "new", error: null };
    persist();
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
      persistence: freeze({ ...persistence }),
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
  if (storage && restore) {
    try {
      lastSaved = storage.getItem(NFT_ATELIER_STORAGE_KEY);
      if (lastSaved) { applyBackup(validateBackup(lastSaved)); persistence = { mode: "browser", status: "restored", error: null }; }
    } catch (error) { persistence = { mode: "browser", status: "held", error: String(error?.message ?? error) }; }
  } else if (storage) {
    // A contribution builder explicitly passes storage:null. Other non-restoring
    // callers observe the current revision before a deliberate first mutation.
    try { lastSaved = storage.getItem(NFT_ATELIER_STORAGE_KEY); } catch {}
  }

  return freeze({
    mint,
    get,
    list,
    inspect,
    burn,
    reset,
    exportState,
    importState,
    getSnapshot,
    createContribution,
    source: NFT_ATELIER_SOURCE,
    boundary: NFT_ATELIER_BOUNDARY,
  });
}

export function createNftAtelierContribution({ seed = "local-atelier", updatedAt = NFT_ATELIER_UPDATED_AT } = {}) {
  const studio = createNftAtelier({ seed, storage: null });
  const contribution = studio.createContribution();
  return freeze({ ...contribution, updatedAt });
}

export default createNftAtelier;
