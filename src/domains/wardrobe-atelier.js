/**
 * Wardrobe Atelier — a fictional local outfit studio for the Living Reality demo.
 *
 * Outfits here are simulated looks: creating, browsing, and equipping them
 * happens only in this page session. There is no marketplace, no ownership,
 * no purchase, no transfer, and no external publication. IDs are
 * deterministic so the same seed always rebuilds the same wardrobe.
 * Equipping an outfit emits a local equip event; outfits that map to a
 * person-studio outfit id can also update the 3D person appearance.
 *
 * Hardened identity-organ contract (adversarial review, 2026-09-18):
 * - Outfit IDs are canonical identity; names are display labels and may collide.
 * - The four starter outfits are immutable system records: they cannot be
 *   deleted or mutated. Customization always clones into a new custom outfit.
 * - Deleting the equipped outfit auto-transitions to the default starter so
 *   the avatar is never naked and equippedId never dangles.
 * - Equipping is component-scoped and atomic: one synchronous swap, ordered
 *   by a monotonic sequence number (last confirmed wins).
 * - Replay and persistence are separate lifecycles: reset() restores the
 *   deterministic starter set; exportState()/importState() carry user outfits.
 *   The domain never touches storage itself.
 * - Render failures degrade visually without corrupting domain truth: the
 *   renderer only ever says "user clicked"; only this domain decides "equipped".
 */

export const WARDROBE_ATELIER_SCHEMA_VERSION = 2;
export const WARDROBE_ATELIER_SOURCE = "wardrobe-atelier";
export const WARDROBE_ATELIER_CONSOLE_SOURCE = "wardrobe-atelier-console";
export const WARDROBE_ATELIER_UPDATED_AT = "2026-09-18T00:00:00.000Z";
export const WARDROBE_ATELIER_MAX_NAME_LENGTH = 48;
export const WARDROBE_ATELIER_MAX_DESCRIPTION_LENGTH = 280;
export const WARDROBE_ATELIER_MAX_PIECES = 8;

export const WARDROBE_EQUIPPED = "WARDROBE_EQUIPPED";
export const WARDROBE_ERROR_NOT_FOUND = "OUTFIT_NOT_FOUND";
export const WARDROBE_ERROR_IMMUTABLE = "OUTFIT_IMMUTABLE";

export const WARDROBE_ATELIER_BOUNDARY =
  "Wardrobe Atelier is a fictional local rehearsal. Outfits are simulated looks with no marketplace, no ownership, no purchase, no transfer, and no external publication. Equipping changes a local preview only; nothing worn here is ownable or valuable outside this page session. Single-instance local simulation: no cross-tab syncing is promised.";

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function wardrobeError(code, message) {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  return error;
}

/** Deterministic FNV-1a hash; keeps wardrobe IDs stable per seed. */
export function hashWardrobeAtelierSeed(value) {
  const text = safeText(value, "wardrobe-atelier");
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
  const normalized = safeText(name).trim().replace(/\s+/g, " ").slice(0, WARDROBE_ATELIER_MAX_NAME_LENGTH);
  if (!normalized) throw new TypeError("outfit name must be a non-empty string");
  return normalized;
}

function boundedText(value, max, label) {
  const normalized = safeText(value).trim().replace(/\s+/g, " ").slice(0, max);
  if (label && !normalized) throw new TypeError(`${label} must be a non-empty string`);
  return normalized;
}

function normalizedPalette(palette) {
  const raw = safeText(palette).trim();
  if (!raw) return "unspecified";
  // Keep only real hex colors; "banana rainbow" has none and normalizes away.
  const colors = raw.match(/#[0-9a-fA-F]{6}/g) ?? [];
  if (!colors.length) return "unspecified";
  return colors.slice(0, 2).join(" / ").slice(0, 96);
}

function normalizedPieces(pieces) {
  if (pieces === null || pieces === undefined) return [];
  if (!Array.isArray(pieces)) throw new TypeError("outfit pieces must be an array");
  // Pieces must be strings: non-string entries are dropped, never coerced.
  return pieces
    .filter((piece) => typeof piece === "string")
    .map((piece) => piece.trim().slice(0, 48))
    .filter(Boolean)
    .slice(0, WARDROBE_ATELIER_MAX_PIECES);
}

function isStarterKey(key) {
  return WARDROBE_ATELIER_STARTER_OUTFITS.some((starter) => starter.key === safeText(key));
}

/**
 * The four starter outfits mirror the person-studio wardrobe so equipping
 * one here can also update the 3D person appearance via `studioOutfitId`.
 * They are immutable system records: deletion and mutation are refused;
 * customization clones them into new custom outfits.
 */
export const WARDROBE_ATELIER_STARTER_OUTFITS = freeze([
  {
    key: "obsidian",
    name: "Obsidian",
    palette: "#111620 / #d9ae60",
    motif: "signature",
    description: "Signature black and gold. The default look — quiet, sharp, everywhere.",
    pieces: ["tailored jacket", "dark trousers", "gold-trim boots"],
    studioOutfitId: "obsidian",
  },
  {
    key: "cobalt",
    name: "Cobalt",
    palette: "#153b78 / #90c9fa",
    motif: "technical",
    description: "Technical deep blue with pale trim. Built for the arena and the lab.",
    pieces: ["utility vest", "deep-blue suit", "light runners"],
    studioOutfitId: "cobalt",
  },
  {
    key: "ivory",
    name: "Ivory",
    palette: "#d6cdc0 / #b28c4b",
    motif: "tailored",
    description: "Tailored warm white with bronze trim. Calm rooms, bright worlds.",
    pieces: ["ivory coat", "cream trousers", "bronze loafers"],
    studioOutfitId: "ivory",
  },
  {
    key: "oxblood",
    name: "Oxblood",
    palette: "#5d1b29 / #dba270",
    motif: "evening",
    description: "Evening red and graphite. For night sanctuaries and slow orbits.",
    pieces: ["oxblood blazer", "graphite trousers", "copper boots"],
    studioOutfitId: "oxblood",
  },
]);

/**
 * Create a fictional wardrobe. `seed` rebuilds the same starter set; `now`
 * is injectable for deterministic tests.
 */
export function createWardrobeAtelier({ seed = "local-wardrobe", now = null } = {}) {
  const wardrobeSeed = safeText(seed) || "local-wardrobe";
  let counter = 0;
  const outfits = new Map();
  const trace = [];
  let sequence = 0;
  let equippedId = null;

  function recordTrace(action, outfitId, detail = "", forcedSeq = null) {
    sequence += 1;
    const seq = forcedSeq ?? sequence;
    trace.push(freeze({
      seq,
      action,
      outfitId,
      detail: safeText(detail).slice(0, 120),
      at: nowIso(now),
      simulation: true,
    }));
    return seq;
  }

  function buildOutfit({ key, name, palette, motif, description, pieces, studioOutfitId = null, origin = "custom", createdAt = null }) {
    counter += 1;
    const outfitHash = hashWardrobeAtelierSeed(`${wardrobeSeed}:${counter}:${name}`);
    let id = `wdr:${outfitHash.slice(0, 8)}`;
    // Never collide with an existing record, even after imports.
    while (outfits.has(id)) {
      counter += 1;
      id = `wdr:${hashWardrobeAtelierSeed(`${wardrobeSeed}:${counter}:${name}`).slice(0, 8)}`;
    }
    return freeze({
      id,
      key: safeText(key) || `outfit-${counter}`,
      name,
      palette: normalizedPalette(palette),
      motif: safeText(motif).trim().slice(0, 48) || "custom",
      description,
      pieces,
      studioOutfitId: safeText(studioOutfitId) || null,
      origin,
      createdAt: createdAt ?? nowIso(now),
      equipped: false,
      simulation: true,
      purchasable: false,
      transferable: false,
      valuable: false,
    });
  }

  function createOutfit({ name, palette = "", motif = "", description = "", pieces = [] } = {}) {
    const outfit = buildOutfit({
      key: "",
      name: boundedName(name),
      palette,
      motif: boundedText(motif, 48),
      description: boundedText(description, WARDROBE_ATELIER_MAX_DESCRIPTION_LENGTH),
      pieces: normalizedPieces(pieces),
      studioOutfitId: null,
      origin: "custom",
    });
    outfits.set(outfit.id, outfit);
    recordTrace("create", outfit.id, outfit.name);
    return outfit;
  }

  /**
   * Customize a starter (or any outfit) by cloning it into a brand-new custom
   * outfit. The source record is never mutated; starters stay immutable.
   */
  function customizeOutfit(sourceId, changes = {}) {
    const source = getOutfit(sourceId);
    if (!source) throw wardrobeError(WARDROBE_ERROR_NOT_FOUND, "unknown wardrobe outfit id");
    const input = changes ?? {};
    const outfit = buildOutfit({
      key: "",
      name: input.name !== undefined && input.name !== null ? boundedName(input.name) : `Copy of ${source.name}`,
      palette: input.palette !== undefined && input.palette !== null ? input.palette : source.palette,
      motif: input.motif !== undefined && input.motif !== null ? boundedText(input.motif, 48) : source.motif,
      description: input.description !== undefined && input.description !== null
        ? boundedText(input.description, WARDROBE_ATELIER_MAX_DESCRIPTION_LENGTH)
        : source.description,
      pieces: input.pieces !== undefined && input.pieces !== null ? normalizedPieces(input.pieces) : source.pieces,
      studioOutfitId: null, // Derived looks stay in the atelier; only starters map to the 3D person.
      origin: "custom",
    });
    outfits.set(outfit.id, outfit);
    recordTrace("customize", outfit.id, `${outfit.name} from ${source.id}`);
    return outfit;
  }

  function getOutfit(outfitId) {
    return outfits.get(safeText(outfitId)) ?? null;
  }

  function listOutfits() {
    return freeze([...outfits.values()]);
  }

  function getEquipped() {
    return equippedId ? getOutfit(equippedId) : null;
  }

  function setEquippedRecord(outfit, equipped) {
    outfits.set(outfit.id, freeze({ ...outfit, equipped }));
  }

  /**
   * Atomic, component-scoped equip: one synchronous swap of the equipped
   * record. Only wardrobe outfit records change — nothing else in the world
   * is touched. The returned event is the person-studio-consumable artifact
   * with a monotonic sequence number (last confirmed wins).
   */
  function equipOutfit(outfitId) {
    const outfit = getOutfit(outfitId);
    if (!outfit) throw wardrobeError(WARDROBE_ERROR_NOT_FOUND, "unknown wardrobe outfit id");
    const previousOutfitId = equippedId;
    if (previousOutfitId && previousOutfitId !== outfit.id) {
      const previous = getOutfit(previousOutfitId);
      if (previous) setEquippedRecord(previous, false);
    }
    equippedId = outfit.id;
    setEquippedRecord(outfit, true);
    const equipped = getOutfit(outfit.id);
    const seq = recordTrace("equip", outfit.id, outfit.name);
    // The equip event is the person-studio-consumable artifact: it carries
    // the wardrobe outfit plus the optional person-studio outfit mapping.
    const event = freeze({
      type: WARDROBE_EQUIPPED,
      outfitId: outfit.id,
      outfitName: outfit.name,
      studioOutfitId: outfit.studioOutfitId,
      previousOutfitId,
      seq,
      timestamp: nowIso(now),
      simulation: true,
      localOnly: true,
    });
    return freeze({ outfit: equipped, event });
  }

  function defaultStarter() {
    return [...outfits.values()].find((outfit) => outfit.origin === "starter") ?? null;
  }

  /**
   * Delete a custom outfit. Unknown ids fail deterministically; starters are
   * immutable system records and cannot be deleted. Deleting the equipped
   * outfit auto-transitions to the default starter so the avatar is never
   * naked and equippedId never dangles — the transition emits a normal
   * WARDROBE_EQUIPPED event with previousOutfitId set.
   */
  function deleteOutfit(outfitId) {
    const outfit = getOutfit(outfitId);
    if (!outfit) throw wardrobeError(WARDROBE_ERROR_NOT_FOUND, "unknown wardrobe outfit id");
    if (outfit.origin === "starter") {
      throw wardrobeError(WARDROBE_ERROR_IMMUTABLE, "starter outfits are immutable system records; customize to create your own");
    }
    const wasEquipped = outfit.id === equippedId;
    outfits.delete(outfit.id);
    recordTrace("delete", outfit.id, outfit.name);
    if (!wasEquipped) {
      return freeze({ deleted: outfit, outfit: getEquipped(), event: null });
    }
    const fallback = defaultStarter();
    if (!fallback) {
      // Should never happen: starters cannot be deleted. Kept as a guard.
      equippedId = null;
      return freeze({ deleted: outfit, outfit: null, event: null });
    }
    const previousOutfitId = outfit.id;
    equippedId = fallback.id;
    setEquippedRecord(fallback, true);
    const seq = recordTrace("equip", fallback.id, `delete-fallback after ${outfit.name}`);
    const event = freeze({
      type: WARDROBE_EQUIPPED,
      outfitId: fallback.id,
      outfitName: fallback.name,
      studioOutfitId: fallback.studioOutfitId,
      previousOutfitId,
      seq,
      timestamp: nowIso(now),
      reason: "delete-fallback",
      simulation: true,
      localOnly: true,
    });
    return freeze({ deleted: outfit, outfit: getOutfit(fallback.id), event });
  }

  function seedStarters() {
    outfits.clear();
    trace.length = 0;
    counter = 0;
    sequence = 0;
    equippedId = null;
    WARDROBE_ATELIER_STARTER_OUTFITS.forEach((starter) => {
      const outfit = buildOutfit({ ...starter, origin: "starter" });
      outfits.set(outfit.id, outfit);
    });
    const first = defaultStarter();
    if (first) {
      equippedId = first.id;
      setEquippedRecord(first, true);
    }
  }

  /**
   * Replay lifecycle: restore the deterministic starter set. Custom outfits
   * do not survive a reset — use exportState()/importState() for persistence.
   */
  function reset() {
    seedStarters();
    recordTrace("reset", "wardrobe", "starter set restored");
    return getSnapshot();
  }

  /**
   * Persistence lifecycle: export the full wardrobe (user outfits included)
   * as JSON-safe state. The domain never touches storage itself.
   */
  function exportState() {
    return freeze({
      schemaVersion: WARDROBE_ATELIER_SCHEMA_VERSION,
      source: WARDROBE_ATELIER_SOURCE,
      seed: wardrobeSeed,
      simulation: true,
      localOnly: true,
      exportedAt: nowIso(now),
      outfits: listOutfits().map((outfit) => ({ ...outfit })),
      equippedId,
    });
  }

  /**
   * Persistence lifecycle: import previously exported state, preserving user
   * outfits. Every record is re-validated through the wardrobe schema.
   */
  function importState(state) {
    if (!state || typeof state !== "object") throw new TypeError("wardrobe state must be an object");
    if (state.source !== WARDROBE_ATELIER_SOURCE) throw new TypeError("wardrobe state source mismatch");
    if (state.schemaVersion !== WARDROBE_ATELIER_SCHEMA_VERSION) throw new TypeError("wardrobe state schema mismatch");
    if (!Array.isArray(state.outfits)) throw new TypeError("wardrobe state outfits must be an array");
    outfits.clear();
    trace.length = 0;
    counter = 0;
    sequence = 0;
    equippedId = null;
    state.outfits.forEach((raw) => {
      const id = safeText(raw?.id);
      if (!/^wdr:[0-9a-f]{8}$/.test(id)) throw new TypeError("wardrobe state contains an invalid outfit id");
      if (outfits.has(id)) throw new TypeError("wardrobe state contains a duplicate outfit id");
      const origin = raw?.origin === "starter" ? "starter" : "custom";
      const outfit = freeze({
        id,
        key: safeText(raw?.key) || id,
        name: boundedName(raw?.name),
        palette: normalizedPalette(raw?.palette),
        motif: safeText(raw?.motif).trim().slice(0, 48) || "custom",
        description: boundedText(raw?.description, WARDROBE_ATELIER_MAX_DESCRIPTION_LENGTH),
        pieces: normalizedPieces(raw?.pieces),
        studioOutfitId: safeText(raw?.studioOutfitId) || null,
        origin,
        createdAt: safeText(raw?.createdAt) || nowIso(now),
        equipped: false,
        simulation: true,
        purchasable: false,
        transferable: false,
        valuable: false,
      });
      outfits.set(id, outfit);
    });
    counter = outfits.size;
    const importedEquipped = safeText(state.equippedId);
    if (importedEquipped) {
      if (!outfits.has(importedEquipped)) {
        throw wardrobeError(WARDROBE_ERROR_NOT_FOUND, "imported equippedId does not resolve to an outfit");
      }
      equippedId = importedEquipped;
      setEquippedRecord(getOutfit(equippedId), true);
    }
    recordTrace("import", "wardrobe", `${outfits.size} outfits restored`);
    return getSnapshot();
  }

  /**
   * Replay helper: rebuild the wardrobe from a snapshot (outfits[] +
   * equippedId), e.g. a captured deterministic state.
   */
  function restoreFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") throw new TypeError("wardrobe snapshot must be an object");
    if (snapshot.source !== WARDROBE_ATELIER_SOURCE) throw new TypeError("wardrobe snapshot source mismatch");
    if (snapshot.schemaVersion !== WARDROBE_ATELIER_SCHEMA_VERSION) throw new TypeError("wardrobe snapshot schema mismatch");
    if (!Array.isArray(snapshot.outfits)) throw new TypeError("wardrobe snapshot outfits must be an array");
    return importState({
      schemaVersion: snapshot.schemaVersion,
      source: snapshot.source,
      seed: wardrobeSeed,
      outfits: snapshot.outfits,
      equippedId: snapshot.equippedId,
    });
  }

  /**
   * Integrity report: the invariant is that equippedId always resolves via
   * getOutfit(id) — no dangling references — and starter records are intact.
   */
  function verifyIntegrity() {
    const issues = [];
    const all = listOutfits();
    // The equipped flag is ephemeral session state, not starter identity:
    // which outfit is currently worn must never count as "modifying" a
    // starter record.
    const canonical = (outfit) => {
      const { equipped, ...rest } = outfit;
      return rest;
    };
    if (equippedId && !outfits.has(equippedId)) issues.push("equippedId does not resolve to an outfit");
    const reference = createWardrobeAtelier({ seed: wardrobeSeed, now });
    const referenceStarters = new Map(reference.listOutfits().map((outfit) => [outfit.key, outfit]));
    WARDROBE_ATELIER_STARTER_OUTFITS.forEach((starter) => {
      const current = all.find((outfit) => outfit.key === starter.key && outfit.origin === "starter");
      const expected = referenceStarters.get(starter.key);
      if (!current) {
        issues.push(`starter outfit missing: ${starter.key}`);
      } else if (JSON.stringify(canonical(current)) !== JSON.stringify(canonical(expected))) {
        issues.push(`starter outfit modified: ${starter.key}`);
      }
    });
    return freeze({
      ok: issues.length === 0,
      outfitCount: all.length,
      equippedId,
      equippedResolves: !equippedId || outfits.has(equippedId),
      startersIntact: issues.every((issue) => !issue.startsWith("starter")),
      issues: freeze(issues),
    });
  }

  function getSnapshot() {
    const all = listOutfits();
    return freeze({
      schemaVersion: WARDROBE_ATELIER_SCHEMA_VERSION,
      source: WARDROBE_ATELIER_SOURCE,
      seed: wardrobeSeed,
      simulation: true,
      localOnly: true,
      singleInstance: true,
      outfits: all,
      outfitCount: all.length,
      equippedId,
      equipped: getEquipped() ? freeze({ id: getEquipped().id, name: getEquipped().name }) : null,
      trace: freeze([...trace].slice(-24)),
      boundary: WARDROBE_ATELIER_BOUNDARY,
      marketplace: false,
      purchase: false,
      transfer: false,
      ownership: false,
      externalPublication: false,
    });
  }

  function createContribution() {
    const all = listOutfits();
    return freeze({
      schemaVersion: WARDROBE_ATELIER_SCHEMA_VERSION,
      source: WARDROBE_ATELIER_SOURCE,
      updatedAt: WARDROBE_ATELIER_UPDATED_AT,
      simulation: true,
      entities: all.map((outfit) => ({
        id: outfit.id,
        kind: "wardrobe-outfit",
        label: outfit.name,
        motif: outfit.motif,
        simulation: true,
      })),
      evidence: [{
        id: "wardrobe-atelier:local-looks",
        kind: "simulated-wardrobe-log",
        outfitIds: all.map((outfit) => outfit.id),
        status: "local",
      }],
      capabilities: [{ id: "wardrobe-atelier.equip", mode: "local-rehearsal", authority: "none", executable: false }],
      boundary: WARDROBE_ATELIER_BOUNDARY,
    });
  }

  // Seed the starter set so the gallery is never empty on first open.
  seedStarters();

  return freeze({
    createOutfit,
    customizeOutfit,
    deleteOutfit,
    getOutfit,
    listOutfits,
    getEquipped,
    equipOutfit,
    reset,
    exportState,
    importState,
    restoreFromSnapshot,
    verifyIntegrity,
    getSnapshot,
    createContribution,
    source: WARDROBE_ATELIER_SOURCE,
    boundary: WARDROBE_ATELIER_BOUNDARY,
  });
}

export function createWardrobeAtelierContribution({ seed = "local-wardrobe", updatedAt = WARDROBE_ATELIER_UPDATED_AT } = {}) {
  const atelier = createWardrobeAtelier({ seed });
  const contribution = atelier.createContribution();
  return freeze({ ...contribution, updatedAt });
}

export default createWardrobeAtelier;
