/**
 * Frozen Relics — a living NFT collection for the Living Reality demo.
 *
 * Tumbo's law: the relic takes the CUBE form of this reality (the
 * glass/volumetric cube language), but it is only that NFT: an asset/receipt
 * that STILL LIVES AND EVOLVES, with HEAVY LOGIC LAW so that some parts are
 * NOT changeable.
 *
 * The split:
 * - FROZEN CORE (immutable): origin (the event/contract it was born from),
 *   creator, creation timestamp, original terms (e.g. an award's claim
 *   amount), and a genesis hash. The core is sealed behind a proxy whose
 *   every mutation attempt THROWS a frozen-core violation. `verifyFrozenCore`
 *   recomputes the genesis hash and proves nothing changed.
 * - EVOLVING ENVELOPE (mutable, append-only): the relic lives. It accrues a
 *   life history (world events witnessed, grading, transfers, claims),
 *   evolution stages and patina that advance deterministically with age and
 *   activity, and annotations. History is append-only: nothing already
 *   written can be edited or deleted (the public view is sealed the same
 *   way as the core, so edit/delete attempts throw).
 *
 * Eternal-escrow award NFTs can be minted AS Frozen Relics: the claim
 * amount/terms freeze in the core while the relic's life (grading → claim →
 * transfers) keeps growing around it. Escrow guarantees are untouched:
 * the claim still follows the holder, double-claim stays impossible, and
 * claims never expire.
 *
 * Everything here is a page-session rehearsal. Relics are fictional local
 * simulated collectibles: no wallet, no chain, no sale, no custody, no
 * royalty, no external publication, no real value. IDs are deterministic so
 * the same seed always rebuilds the same vault; nothing here is an
 * ownership, payout, or value claim.
 */

export const FROZEN_RELICS_SCHEMA_VERSION = 1;
export const FROZEN_RELICS_SOURCE = "frozen-relics";
export const FROZEN_RELICS_CONSOLE_SOURCE = "frozen-relics-console";
export const FROZEN_RELICS_UPDATED_AT = "2026-09-18T00:00:00.000Z";
export const FROZEN_RELICS_COLLECTION = "Frozen Relics";
export const FROZEN_RELICS_FORM = "glass-cube";
export const FROZEN_RELICS_MAX_NAME_LENGTH = 48;
export const FROZEN_RELICS_MAX_TEXT_LENGTH = 160;
export const FROZEN_RELICS_MAX_TERMS = 12;

export const FROZEN_RELICS_STAGES = Object.freeze([
  "sealed",
  "stirring",
  "awake",
  "radiant",
  "mythic",
]);

export const FROZEN_RELICS_PATINAS = Object.freeze([
  "gold-veined",
  "cyan-misted",
  "violet-deepened",
  "ember-kissed",
  "frost-lined",
  "obsidian-edged",
]);

export const FROZEN_RELICS_BOUNDARY =
  "Frozen Relics are fictional local simulated collectibles. A relic's frozen core is immutable local rehearsal data and its life history is an append-only local log. There is no wallet, no chain, no sale, no custody, no royalty, no external publication, and no real value. Nothing here is ownable or valuable outside this page session.";

const FROZEN_CORE_VIOLATION =
  "frozen core violation: the relic's core is immutable — origin, creator, timestamp, terms, and genesis hash cannot be changed, added, or removed";

const frozenHandler = {
  set(_target, property) {
    throw new TypeError(`${FROZEN_CORE_VIOLATION} (tried to set "${String(property)}")`);
  },
  deleteProperty(_target, property) {
    throw new TypeError(`${FROZEN_CORE_VIOLATION} (tried to delete "${String(property)}")`);
  },
  defineProperty(_target, property) {
    throw new TypeError(`${FROZEN_CORE_VIOLATION} (tried to define "${String(property)}")`);
  },
  setPrototypeOf() {
    throw new TypeError(FROZEN_CORE_VIOLATION);
  },
};

/**
 * Heavy logic law, enforced structurally: recursively seal a value behind
 * proxies so ANY mutation attempt — top-level or nested, set or delete —
 * throws a TypeError. Reads stay open.
 */
export function sealFrozen(value) {
  if (Array.isArray(value)) {
    const sealed = value.map(sealFrozen);
    return new Proxy(Object.freeze(sealed), frozenHandler);
  }
  if (value && typeof value === "object") {
    const sealed = {};
    for (const [key, entry] of Object.entries(value)) sealed[key] = sealFrozen(entry);
    return new Proxy(Object.freeze(sealed), frozenHandler);
  }
  return value;
}

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** Deterministic FNV-1a hash; keeps relic IDs stable per seed. */
export function hashFrozenRelicSeed(value) {
  const text = safeText(value, "frozen-relics");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Canonical JSON: sorted keys at every level, so hashes are stable. */
export function canonicalizeFrozen(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalizeFrozen).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeFrozen(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
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

function nowMs(now) {
  const iso = nowIso(now);
  return new Date(iso).getTime();
}

function boundedName(name) {
  const normalized = safeText(name).trim().replace(/\s+/g, " ").slice(0, FROZEN_RELICS_MAX_NAME_LENGTH);
  if (!normalized) throw new TypeError("relic name must be a non-empty string");
  return normalized;
}

function boundedText(value, field) {
  const normalized = safeText(value).trim().replace(/\s+/g, " ").slice(0, FROZEN_RELICS_MAX_TEXT_LENGTH);
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function boundedHolder(value) {
  return boundedText(value, "holder name").slice(0, 40);
}

/** Original terms: a small bounded string-keyed map sealed into the core. */
function normalizeTerms(terms) {
  if (terms === null || terms === undefined) return {};
  if (!terms || typeof terms !== "object" || Array.isArray(terms)) {
    throw new TypeError("relic terms must be an object");
  }
  const entries = Object.entries(terms).slice(0, FROZEN_RELICS_MAX_TERMS);
  const normalized = {};
  for (const [rawKey, rawValue] of entries) {
    const key = safeText(rawKey).trim().slice(0, 32);
    if (!key) continue;
    const value = rawValue === null || rawValue === undefined
      ? "—"
      : safeText(typeof rawValue === "object" ? canonicalizeFrozen(rawValue) : rawValue).slice(0, 140);
    normalized[key] = value;
  }
  return normalized;
}

function genesisHashFor({ origin, creator, mintedAt, terms }) {
  return hashFrozenRelicSeed(canonicalizeFrozen({ origin, creator, mintedAt, terms }));
}

/** Recompute a core's genesis hash from its (sealed) values. */
export function verifyFrozenCoreData(core) {
  if (!core || typeof core !== "object") throw new TypeError("cannot verify: no frozen core");
  const recomputed = genesisHashFor({
    origin: core.origin,
    creator: core.creator,
    mintedAt: core.mintedAt,
    terms: core.terms,
  });
  return {
    ok: recomputed === core.genesisHash,
    expected: core.genesisHash,
    recomputed,
  };
}

function patinaFor(relicId) {
  const roll = parseInt(hashFrozenRelicSeed(`patina:${relicId}`).slice(0, 2), 16);
  return FROZEN_RELICS_PATINAS[roll % FROZEN_RELICS_PATINAS.length];
}

/**
 * Evolution is deterministic: the stage is a pure function of age and
 * activity, so the same seed and clock always yield the same stage.
 */
export function stageForRelic({ bornAtMs, nowMs: currentMs, eventCount }) {
  const ageDays = Math.max(0, (currentMs - bornAtMs) / 86_400_000);
  const byEvents = eventCount >= 12 ? 4 : eventCount >= 7 ? 3 : eventCount >= 4 ? 2 : eventCount >= 2 ? 1 : 0;
  const byAge = ageDays >= 365 ? 4 : ageDays >= 30 ? 3 : ageDays >= 7 ? 2 : ageDays >= 1 ? 1 : 0;
  return FROZEN_RELICS_STAGES[Math.max(byEvents, byAge)];
}

/**
 * Create a Frozen Relics vault. `seed` rebuilds the same vault; `now` is
 * injectable for deterministic tests (including time-travel stage tests).
 */
export function createFrozenRelics({ seed = "local-relics", now = null } = {}) {
  const vaultSeed = safeText(seed) || "local-relics";
  let counter = 0;
  const relics = new Map();
  let sequence = 0;

  function nextId() {
    counter += 1;
    const tokenHash = hashFrozenRelicSeed(`${vaultSeed}:relic:${counter}`);
    return `relic:${tokenHash.slice(0, 8)}:${String(counter).padStart(4, "0")}`;
  }

  function recordLifeEventInternal(record, kind, detail = "") {
    const eventKind = boundedText(kind, "life event kind").slice(0, 40);
    sequence += 1;
    const stageBefore = stageForRelic({
      bornAtMs: record.bornAtMs,
      nowMs: nowMs(now),
      eventCount: record.events.length,
    });
    record.events.push({
      seq: record.events.length + 1,
      kind: eventKind,
      detail: safeText(detail).slice(0, FROZEN_RELICS_MAX_TEXT_LENGTH),
      at: nowIso(now),
      simulation: true,
    });
    // Crossing a stage threshold is itself a life event: the relic evolves.
    // Checked once per append — the "evolved" marker never re-triggers.
    const stageAfter = stageForRelic({
      bornAtMs: record.bornAtMs,
      nowMs: nowMs(now),
      eventCount: record.events.length,
    });
    if (FROZEN_RELICS_STAGES.indexOf(stageAfter) > FROZEN_RELICS_STAGES.indexOf(stageBefore)) {
      record.events.push({
        seq: record.events.length + 1,
        kind: "evolved",
        detail: `The relic evolved: ${stageBefore} → ${stageAfter}.`,
        at: nowIso(now),
        simulation: true,
      });
    }
    return record.events[record.events.length - 1];
  }

  function buildCore({ origin, creator, terms }) {
    const mintedAt = nowIso(now);
    const coreData = {
      origin: boundedText(origin, "relic origin"),
      creator: boundedText(creator, "relic creator"),
      mintedAt,
      terms: normalizeTerms(terms),
    };
    const genesisHash = genesisHashFor(coreData);
    return { coreData: { ...coreData, genesisHash }, mintedAt };
  }

  function storeRelic({ name, origin, creator, terms, holder, award = null }) {
    const id = nextId();
    const { coreData, mintedAt } = buildCore({ origin, creator, terms });
    const record = {
      id,
      name: boundedName(name),
      holder: boundedHolder(holder),
      coreData,
      bornAtMs: nowMs(now),
      mintedAt,
      events: [],
      annotations: [],
      claimed: false,
      award,
    };
    relics.set(id, record);
    recordLifeEventInternal(record, "sealed", "Frozen core sealed. The relic is born as a glass cube; its core can never change.");
    return record;
  }

  /**
   * Mint a standalone Frozen Relic: a living glass cube with an immutable
   * core and an append-only life.
   */
  function mintRelic({ name, origin, creator, terms = {}, holder = "atelier" } = {}) {
    const record = storeRelic({ name, origin, creator, terms, holder });
    return publicView(record);
  }

  /**
   * Mint an eternal-escrow award AS a Frozen Relic. The claim terms freeze
   * in the core (claim amount, kind, escrow id) while the relic's life keeps
   * growing: grading → transfers → claim are recorded as life events.
   */
  function mintRelicFromAward({
    name = null,
    awardNftId,
    escrowId,
    contractId,
    eventLabel,
    creator,
    holder,
    amount,
    kind,
    unit = "simulated TUMBO points",
  } = {}) {
    if (!awardNftId) throw new TypeError("award nft id is required to mint an award relic");
    const label = safeText(eventLabel, "outcome contract").slice(0, 80) || "outcome contract";
    const record = storeRelic({
      name: name || `Award Relic · ${label}`,
      origin: `outcome-contract:${safeText(contractId, "unknown")}`,
      creator: safeText(creator, "house") || "house",
      terms: {
        claimAmount: String(amount),
        unit: safeText(unit),
        kind: safeText(kind, "award"),
        escrowId: safeText(escrowId),
        awardNftId: safeText(awardNftId),
        event: label,
      },
      holder,
      award: { awardNftId: safeText(awardNftId), escrowId: safeText(escrowId), contractId: safeText(contractId) },
    });
    recordLifeEventInternal(
      record,
      "graded",
      `Born from grading: ${label}. ${safeText(kind, "award").toUpperCase()} of ${amount} ${safeText(unit)} locked in eternal escrow — claimable forever.`,
    );
    return publicView(record);
  }

  function getRecord(relicId) {
    const record = relics.get(safeText(relicId));
    if (!record) throw new TypeError("unknown frozen relic id");
    return record;
  }

  function lifeView(record) {
    const currentMs = nowMs(now);
    return {
      stage: stageForRelic({ bornAtMs: record.bornAtMs, nowMs: currentMs, eventCount: record.events.length }),
      patina: patinaFor(record.id),
      holder: record.holder,
      claimed: record.claimed,
      eventCount: record.events.length,
      // Append-only: the public history is sealed, so edit/delete attempts
      // throw the same frozen-core violation as the core itself.
      history: record.events.map((event) => ({ ...event })),
      annotations: record.annotations.map((annotation) => ({ ...annotation })),
    };
  }

  /**
   * Public view: the frozen core AND the life history are both sealed —
   * reads are open, every mutation attempt throws.
   */
  function publicView(record) {
    return sealFrozen({
      id: record.id,
      name: record.name,
      collection: FROZEN_RELICS_COLLECTION,
      form: FROZEN_RELICS_FORM,
      frozenCore: { ...record.coreData },
      life: lifeView(record),
      mintedAt: record.mintedAt,
      award: record.award ? { ...record.award } : null,
      simulation: true,
      valuable: false,
      localTransferOnly: true,
      boundary: FROZEN_RELICS_BOUNDARY,
    });
  }

  function getRelic(relicId) {
    return publicView(getRecord(relicId));
  }

  function listRelics() {
    return [...relics.values()].map(publicView);
  }

  /**
   * The relic lives: append a life event. `kind` examples: "witnessed",
   * "graded", "transferred", "claimed", "annotated", "evolved".
   */
  function recordLifeEvent({ relicId, kind, detail = "" } = {}) {
    const record = getRecord(relicId);
    const event = recordLifeEventInternal(record, kind, detail);
    return { ...event };
  }

  /** The relic witnesses a world event: cube opened, feature entered, ... */
  function witness({ relicId, kind, detail = "" } = {}) {
    return recordLifeEvent({ relicId, kind: `witnessed:${boundedText(kind, "witness kind").slice(0, 40)}`, detail });
  }

  /** Annotations are envelope, not core: append-only, never editable. */
  function annotate({ relicId, note } = {}) {
    const record = getRecord(relicId);
    const text = boundedText(note, "annotation");
    sequence += 1;
    record.annotations.push({ seq: record.annotations.length + 1, note: text, at: nowIso(now), simulation: true });
    recordLifeEventInternal(record, "annotated", text);
    return { ...record.annotations[record.annotations.length - 1] };
  }

  /**
   * The relic rides around locally: the holder is envelope (mutable), the
   * core stays frozen. Claimed relics are spent and cannot move.
   */
  function recordRelicTransfer({ relicId, toHolder } = {}) {
    const record = getRecord(relicId);
    if (record.claimed) throw new TypeError("claimed relics are spent and cannot be transferred");
    const next = boundedHolder(toHolder);
    if (next === record.holder) throw new TypeError("relic is already held by that holder");
    const from = record.holder;
    record.holder = next;
    recordLifeEventInternal(record, "transferred", `${from} → ${next}. The claim follows the holder; the frozen core is untouched.`);
    return publicView(record);
  }

  /**
   * The win is claimed: the frozen core's terms are honored exactly, the
   * life records it, and the relic becomes spent (no further transfers).
   *
   * Holder proof: a supplied `holder` must EQUAL the relic's current
   * holder — it is proof of who claims, never a replacement. A mismatched
   * holder throws and the relic is left unspent, so a claim can never be
   * seized by naming someone else.
   */
  function recordRelicClaim({ relicId, holder, amount } = {}) {
    const record = getRecord(relicId);
    if (record.claimed) throw new TypeError("relic claim has already been recorded");
    // Validate BEFORE mutating: a rejected claim must not spend the relic.
    const terms = record.coreData.terms;
    const expected = terms.claimAmount;
    if (expected !== undefined && String(amount) !== String(expected)) {
      throw new TypeError(`claim honors the frozen core: expected ${expected}, got ${amount}`);
    }
    if (holder !== undefined && holder !== null && holder !== "") {
      const claimedBy = boundedHolder(holder);
      if (claimedBy !== record.holder) {
        throw new TypeError(
          `claim holder mismatch: the relic is held by "${record.holder}", not "${claimedBy}" — the claim follows the current holder and cannot be seized`,
        );
      }
    }
    record.claimed = true;
    recordLifeEventInternal(
      record,
      "claimed",
      `${record.holder} claimed ${amount ?? expected ?? "?"} — the exact frozen amount. The relic is spent; its life is complete.`,
    );
    return publicView(record);
  }

  /**
   * Prove the core hasn't changed: recompute the genesis hash from the
   * sealed core values and compare. Returns the verdict (never mutates).
   */
  function verifyFrozenCore(relicId) {
    const record = getRecord(relicId);
    const verdict = verifyFrozenCoreData(record.coreData);
    return sealFrozen({
      relicId: record.id,
      name: record.name,
      ok: verdict.ok,
      genesisHash: record.coreData.genesisHash,
      recomputed: verdict.recomputed,
      verifiedAt: nowIso(now),
      simulation: true,
      note: verdict.ok
        ? "Verified: the frozen core is byte-identical to its genesis seal. Nothing changed."
        : "MISMATCH: the core does not match its genesis seal.",
    });
  }

  function reset() {
    relics.clear();
    counter = 0;
    sequence = 0;
    return getSnapshot();
  }

  function getSnapshot() {
    const all = [...relics.values()];
    return sealFrozen({
      schemaVersion: FROZEN_RELICS_SCHEMA_VERSION,
      source: FROZEN_RELICS_SOURCE,
      seed: vaultSeed,
      simulation: true,
      localOnly: true,
      relics: all.length,
      claimed: all.filter((record) => record.claimed).length,
      items: all.map((record) => ({
        id: record.id,
        name: record.name,
        collection: FROZEN_RELICS_COLLECTION,
        form: FROZEN_RELICS_FORM,
        stage: stageForRelic({ bornAtMs: record.bornAtMs, nowMs: nowMs(now), eventCount: record.events.length }),
        patina: patinaFor(record.id),
        holder: record.holder,
        claimed: record.claimed,
        lifeEvents: record.events.length,
        genesisHash: record.coreData.genesisHash,
      })),
      boundary: FROZEN_RELICS_BOUNDARY,
      wallet: false,
      chain: false,
      sale: false,
      custody: false,
      externalPublication: false,
    });
  }

  function createContribution() {
    const all = [...relics.values()];
    return sealFrozen({
      schemaVersion: FROZEN_RELICS_SCHEMA_VERSION,
      source: FROZEN_RELICS_SOURCE,
      updatedAt: FROZEN_RELICS_UPDATED_AT,
      simulation: true,
      entities: all.map((record) => ({
        id: record.id,
        kind: "frozen-relic",
        label: record.name,
        collection: FROZEN_RELICS_COLLECTION,
        form: FROZEN_RELICS_FORM,
        stage: stageForRelic({ bornAtMs: record.bornAtMs, nowMs: nowMs(now), eventCount: record.events.length }),
        simulation: true,
      })),
      evidence: [{
        id: "frozen-relics:vault-log",
        kind: "simulated-relic-log",
        relicIds: all.map((record) => record.id),
        status: "local",
      }],
      capabilities: [{ id: "frozen-relics.mint", mode: "local-rehearsal", authority: "none", executable: false }],
      boundary: FROZEN_RELICS_BOUNDARY,
    });
  }

  return sealFrozen({
    mintRelic,
    mintRelicFromAward,
    getRelic,
    listRelics,
    recordLifeEvent,
    witness,
    annotate,
    recordRelicTransfer,
    recordRelicClaim,
    verifyFrozenCore,
    reset,
    getSnapshot,
    createContribution,
    source: FROZEN_RELICS_SOURCE,
    collection: FROZEN_RELICS_COLLECTION,
    form: FROZEN_RELICS_FORM,
    boundary: FROZEN_RELICS_BOUNDARY,
  });
}

export function createFrozenRelicsContribution({ seed = "local-relics", updatedAt = FROZEN_RELICS_UPDATED_AT } = {}) {
  const vault = createFrozenRelics({ seed });
  vault.mintRelic({
    name: "Genesis Frozen Relic",
    origin: "atelier:genesis",
    creator: "atelier",
    terms: { note: "the first sealed cube", edition: "1 of 1 (simulated)" },
    holder: "atelier",
  });
  const contribution = vault.createContribution();
  return sealFrozen({ ...contribution, updatedAt });
}

export default createFrozenRelics;
