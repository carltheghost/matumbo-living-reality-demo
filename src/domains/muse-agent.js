/**
 * Muse Agent — a scripted local design companion for Living Reality.
 *
 * When anyone opens Matumbo, the Muse Agent is there: a deterministic local
 * assistant that helps design images and avatars. A visitor can add their own
 * local profile ("account") — a Muse profile or any other provider tag — and
 * the agent attributes designs to that profile.
 *
 * Hard boundaries (project law):
 * - Profiles are LOCAL DISPLAY NAMES ONLY. No login, no password, no token,
 *   no OAuth, no external account linking. The app never becomes an identity
 *   authority.
 * - The agent is a deterministic local algorithm (keyword + hash driven).
 *   No AI service, no network call, no image-generation service is invoked.
 * - Designs are local compositions saved to this browser only.
 * - Avatar designs can dress the Person Studio projection (outfit id +
 *   hologram tint); image designs are copy-ready briefs.
 */

import { STUDIO_OUTFITS, STUDIO_ROOMS, STUDIO_COMPANIONS } from "./person-studio.js?v=20260922-cache2";

export const MUSE_AGENT_SCHEMA_VERSION = 1;
export const MUSE_AGENT_SOURCE = "muse-agent";
export const MUSE_AGENT_CONSOLE_SOURCE = "muse-agent-console";
export const MUSE_AGENT_UPDATED_AT = "2026-09-18T00:00:00.000Z";
export const MUSE_AGENT_STORAGE_KEY = "matumbo.muse-agent.v1";
export const MUSE_AGENT_MAX_DISPLAY_NAME = 40;
export const MUSE_AGENT_MAX_PROMPT = 280;
export const MUSE_AGENT_MAX_PROFILES = 8;
export const MUSE_AGENT_MAX_DESIGNS = 60;

export const MUSE_AGENT_BOUNDARY =
  "Muse Agent is a scripted local design companion. Profiles are local display names only — no login, no password, no token, no external account linking, and no identity authority. Designs are deterministic local compositions; no AI service, no network call, and no image-generation service is used. Everything is saved in this browser only.";

export const MUSE_AGENT_PROVIDERS = Object.freeze([
  { id: "muse", label: "Muse" },
  { id: "other", label: "Other account" },
]);

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** Deterministic FNV-1a hash; the same prompt always yields the same design. */
export function hashMuseAgentSeed(value) {
  const text = safeText(value, "muse-agent");
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
    if (value === null || value === undefined || value === "") return new Date().toISOString();
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to the wall clock; tests inject `now`.
  }
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Design vocabulary: keyword → design parameter mapping (the agent's
// "algorithm": deterministic, local, explainable).
// ---------------------------------------------------------------------------

export const MUSE_AGENT_PALETTES = freeze([
  { id: "ember-gold", name: "Ember Gold", colors: ["#ffd166", "#b4551f", "#2b1a08"], keywords: ["gold", "ember", "fire", "sun", "warm", "desert"] },
  { id: "obsidian-night", name: "Obsidian Night", colors: ["#111620", "#3d4c63", "#0a0d13"], keywords: ["dark", "night", "obsidian", "black", "shadow", "noir"] },
  { id: "cobalt-deep", name: "Cobalt Deep", colors: ["#153b78", "#90c9fa", "#0a1c3d"], keywords: ["blue", "ocean", "cobalt", "sea", "water", "ice"] },
  { id: "ivory-dawn", name: "Ivory Dawn", colors: ["#d6cdc0", "#b28c4b", "#f5efe4"], keywords: ["ivory", "white", "dawn", "light", "cream", "sand"] },
  { id: "oxblood-royal", name: "Oxblood Royal", colors: ["#5d1b29", "#dba270", "#2a0d14"], keywords: ["red", "royal", "crimson", "wine", "blood", "king"] },
  { id: "violet-lens", name: "Violet Lens", colors: ["#7a4fd0", "#c9a7ff", "#1c1030"], keywords: ["violet", "purple", "lens", "cosmic", "galaxy", "dream"] },
  { id: "emerald-field", name: "Emerald Field", colors: ["#1f7a55", "#9fe8c1", "#0b2b1e"], keywords: ["green", "forest", "emerald", "nature", "field", "jungle"] },
]);

export const MUSE_AGENT_STYLES = freeze([
  { id: "cinematic", name: "Cinematic", keywords: ["cinematic", "film", "epic", "movie"] },
  { id: "hologram", name: "Hologram", keywords: ["hologram", "holo", "ghost", "spirit", "projection"] },
  { id: "minimal", name: "Minimal", keywords: ["minimal", "clean", "simple", "calm"] },
  { id: "bold", name: "Bold", keywords: ["bold", "loud", "street", "graffiti", "punk"] },
  { id: "regal", name: "Regal", keywords: ["regal", "royal", "crown", "throne", "majestic"] },
  { id: "voyager", name: "Voyager", keywords: ["space", "voyager", "stars", "orbit", "future"] },
]);

export const MUSE_AGENT_MOODS = freeze([
  { id: "triumphant", name: "Triumphant", keywords: ["win", "victory", "champion", "triumph", "glory"] },
  { id: "serene", name: "Serene", keywords: ["calm", "peace", "serene", "quiet", "zen"] },
  { id: "electric", name: "Electric", keywords: ["electric", "energy", "party", "neon", "dance"] },
  { id: "mystic", name: "Mystic", keywords: ["mystic", "magic", "mystery", "ancient", "spirit"] },
]);

function wordsOf(prompt) {
  return safeText(prompt).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function pickByKeywords(words, vocab, hash, fallbackIndex = 0) {
  for (const entry of vocab) {
    if (entry.keywords.some((keyword) => words.includes(keyword))) return entry;
  }
  return vocab[parseInt(hash.slice(0, 2), 16) % vocab.length] ?? vocab[fallbackIndex];
}

/** The agent's core algorithm: prompt → deterministic design specification. */
export function designFromPrompt({ kind = "avatar", prompt = "", seed = "muse-agent" } = {}) {
  const normalizedKind = kind === "image" ? "image" : "avatar";
  const clean = safeText(prompt).trim().replace(/\s+/g, " ").slice(0, MUSE_AGENT_MAX_PROMPT);
  if (!clean) throw new TypeError("design prompt must be a non-empty string");
  const words = wordsOf(clean);
  const hash = hashMuseAgentSeed(`${seed}:${normalizedKind}:${clean.toLowerCase()}`);
  const palette = pickByKeywords(words, MUSE_AGENT_PALETTES, hash);
  const style = pickByKeywords(words, MUSE_AGENT_STYLES, hash);
  const mood = pickByKeywords(words, MUSE_AGENT_MOODS, hash);

  if (normalizedKind === "avatar") {
    // Map the prompt onto the Person Studio wardrobe + hologram presentation.
    const OUTFIT_KEYWORDS = {
      obsidian: ["obsidian", "black", "dark", "noir", "shadow", "stealth"],
      cobalt: ["cobalt", "blue", "ocean", "sea", "water", "ice"],
      ivory: ["ivory", "white", "cream", "sand", "dawn", "light"],
      oxblood: ["oxblood", "crimson", "red", "royal", "wine", "blood", "king", "burgundy"],
    };
    const ROOM_KEYWORDS = {
      city: ["city", "urban", "street", "skyline"],
      ocean: ["ocean", "sea", "water", "observatory"],
      night: ["night", "sanctuary", "stars", "moon"],
    };
    const outfit = pickByKeywords(
      words,
      STUDIO_OUTFITS.map((entry) => ({ ...entry, keywords: OUTFIT_KEYWORDS[entry.id] ?? [entry.id] })),
      hash,
    );
    const room = pickByKeywords(
      words,
      STUDIO_ROOMS.map((entry) => ({ ...entry, keywords: ROOM_KEYWORDS[entry.id] ?? [entry.id] })),
      hash,
    );
    const companion = STUDIO_COMPANIONS[parseInt(hash.slice(2, 4), 16) % STUDIO_COMPANIONS.length];
    const tint = palette.colors[0];
    const glow = palette.colors[1];
    const title = `${style.name} ${palette.name} Avatar`;
    return freeze({
      kind: "avatar",
      title,
      prompt: clean,
      palette: { id: palette.id, name: palette.name, colors: [...palette.colors] },
      style: { id: style.id, name: style.name },
      mood: { id: mood.id, name: mood.name },
      outfitId: outfit.id,
      outfitName: outfit.name,
      roomId: room.id,
      roomName: room.name,
      companion,
      hologramTint: tint,
      hologramGlow: glow,
      hologramOpacity: 0.92,
      brief: `${title}: dress the PERSON Ω hologram in the ${outfit.name} outfit under ${room.name} light, ${companion} companion beside, ${palette.name.toLowerCase()} glow.`,
      deterministic: true,
      localOnly: true,
      seed: hash,
    });
  }

  const aspect = words.includes("wide") || words.includes("banner") ? "16:9" : words.includes("square") ? "1:1" : "4:5";
  const subject = clean.length > 64 ? `${clean.slice(0, 61)}…` : clean;
  const title = `${style.name} ${palette.name} Study`;
  const brief = [
    `Subject: ${subject}.`,
    `Style: ${style.name.toLowerCase()}, ${mood.name.toLowerCase()} mood.`,
    `Palette: ${palette.name} (${palette.colors.join(", ")}).`,
    `Composition: centered PERSON Ω likeness, ${aspect} frame, floating in open lens space, no ground, volumetric glow.`,
    "Rendered locally from this brief — no image service is called.",
  ].join(" ");
  return freeze({
    kind: "image",
    title,
    prompt: clean,
    palette: { id: palette.id, name: palette.name, colors: [...palette.colors] },
    style: { id: style.id, name: style.name },
    mood: { id: mood.id, name: mood.name },
    aspect,
    subject,
    brief,
    deterministic: true,
    localOnly: true,
    seed: hash,
  });
}

// ---------------------------------------------------------------------------
// Agent: profiles ("accounts") + gallery, persisted to localStorage only.
// ---------------------------------------------------------------------------

function boundedDisplayName(name) {
  const normalized = safeText(name).trim().replace(/\s+/g, " ").slice(0, MUSE_AGENT_MAX_DISPLAY_NAME);
  if (!normalized) throw new TypeError("profile name must be a non-empty string");
  return normalized;
}

function validProvider(providerId) {
  const found = MUSE_AGENT_PROVIDERS.find((entry) => entry.id === safeText(providerId));
  return found ? found.id : "other";
}

function readStored(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(MUSE_AGENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.profiles) || !Array.isArray(parsed.designs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(storage, state) {
  if (!storage) return;
  try {
    storage.setItem(MUSE_AGENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable (private mode); the session copy still works.
  }
}

export function createMuseAgent({ storage = null, seed = "muse-agent", now = null } = {}) {
  const agentSeed = safeText(seed) || "muse-agent";
  const store = storage ?? (() => { try { return globalThis.localStorage; } catch { return null; } })();
  const stored = readStored(store);
  const profiles = new Map();
  const designs = new Map();
  let activeProfileId = null;
  let profileCounter = 0;
  let designCounter = 0;

  function persist() {
    writeStored(store, {
      schemaVersion: MUSE_AGENT_SCHEMA_VERSION,
      profiles: [...profiles.values()],
      activeProfileId,
      designs: [...designs.values()],
    });
  }

  function addProfile({ displayName, provider = "muse" } = {}) {
    if (profiles.size >= MUSE_AGENT_MAX_PROFILES) throw new TypeError("profile limit reached");
    profileCounter += 1;
    const hash = hashMuseAgentSeed(`${agentSeed}:profile:${profileCounter}:${displayName}`);
    const profile = freeze({
      id: `muse-profile:${hash.slice(0, 8)}`,
      displayName: boundedDisplayName(displayName),
      provider: validProvider(provider),
      providerLabel: MUSE_AGENT_PROVIDERS.find((entry) => entry.id === validProvider(provider)).label,
      createdAt: nowIso(now),
      localOnly: true,
      verified: false,
    });
    profiles.set(profile.id, profile);
    // Adding an account switches to it: the visitor designs as themselves.
    activeProfileId = profile.id;
    persist();
    return profile;
  }

  function selectProfile(profileId) {
    const profile = profiles.get(safeText(profileId));
    if (!profile) throw new TypeError("unknown profile id");
    activeProfileId = profile.id;
    persist();
    return profile;
  }

  function renameProfile(profileId, displayName) {
    const profile = profiles.get(safeText(profileId));
    if (!profile) throw new TypeError("unknown profile id");
    const renamed = freeze({ ...profile, displayName: boundedDisplayName(displayName) });
    profiles.set(profile.id, renamed);
    persist();
    return renamed;
  }

  function removeProfile(profileId) {
    const id = safeText(profileId);
    if (!profiles.has(id)) throw new TypeError("unknown profile id");
    profiles.delete(id);
    for (const [designId, design] of designs) {
      if (design.profileId === id) designs.delete(designId);
    }
    if (activeProfileId === id) activeProfileId = [...profiles.keys()][0] ?? null;
    persist();
    return true;
  }

  function getActiveProfile() {
    return (activeProfileId && profiles.get(activeProfileId)) || null;
  }

  function generate({ kind = "avatar", prompt = "" } = {}) {
    const profile = getActiveProfile();
    if (!profile) throw new TypeError("add a profile before designing");
    const spec = designFromPrompt({ kind, prompt, seed: `${agentSeed}:${profile.id}` });
    designCounter += 1;
    const design = freeze({
      ...spec,
      id: `muse-design:${spec.seed.slice(0, 8)}:${String(designCounter).padStart(3, "0")}`,
      profileId: profile.id,
      profileName: profile.displayName,
      provider: profile.provider,
      createdAt: nowIso(now),
      applied: false,
    });
    return design;
  }

  function save(design) {
    if (!design || typeof design !== "object" || !design.id) throw new TypeError("cannot save an empty design");
    if (designs.size >= MUSE_AGENT_MAX_DESIGNS) throw new TypeError("design gallery is full");
    designs.set(design.id, design);
    persist();
    return design;
  }

  function getDesign(designId) {
    return designs.get(safeText(designId)) ?? null;
  }

  function listDesigns() {
    return freeze([...designs.values()]);
  }

  function removeDesign(designId) {
    const id = safeText(designId);
    if (!designs.has(id)) throw new TypeError("unknown design id");
    designs.delete(id);
    persist();
    return true;
  }

  function markApplied(designId) {
    const design = designs.get(safeText(designId));
    if (!design) throw new TypeError("unknown design id");
    const applied = freeze({ ...design, applied: true, appliedAt: nowIso(now) });
    designs.set(design.id, applied);
    persist();
    return applied;
  }

  function getSnapshot() {
    const active = getActiveProfile();
    return freeze({
      schemaVersion: MUSE_AGENT_SCHEMA_VERSION,
      source: MUSE_AGENT_SOURCE,
      simulation: true,
      localOnly: true,
      deterministic: true,
      externalNetwork: false,
      externalAuth: false,
      identityAuthority: false,
      aiService: false,
      profiles: [...profiles.values()].map((profile) => freeze({
        id: profile.id,
        displayName: profile.displayName,
        provider: profile.provider,
        providerLabel: profile.providerLabel,
        active: profile.id === activeProfileId,
      })),
      activeProfileId,
      activeProfileName: active?.displayName ?? null,
      designs: [...designs.values()].map((design) => freeze({
        id: design.id,
        kind: design.kind,
        title: design.title,
        profileName: design.profileName,
        applied: design.applied,
        createdAt: design.createdAt,
      })),
      boundary: MUSE_AGENT_BOUNDARY,
    });
  }

  function createContribution() {
    return freeze({
      schemaVersion: MUSE_AGENT_SCHEMA_VERSION,
      source: MUSE_AGENT_SOURCE,
      updatedAt: MUSE_AGENT_UPDATED_AT,
      simulation: true,
      localOnly: true,
      deterministic: true,
      entities: [...designs.values()].map((design) => ({
        id: design.id,
        kind: design.kind === "avatar" ? "avatar-design" : "image-design",
        label: design.title,
        profileName: design.profileName,
        simulation: true,
      })),
      evidence: [{
        id: "muse-agent:local-designs",
        kind: "local-design-log",
        designIds: [...designs.keys()],
        status: "local",
      }],
      capabilities: [
        { id: "muse-agent.design", mode: "local-deterministic", authority: "none", executable: false },
        { id: "muse-agent.profile", mode: "local-display-name", authority: "none", executable: false },
      ],
      boundary: MUSE_AGENT_BOUNDARY,
    });
  }

  // Restore a previous local session (validated; anything else is dropped).
  if (stored) {
    try {
      for (const entry of stored.profiles.slice(0, MUSE_AGENT_MAX_PROFILES)) {
        if (!entry || typeof entry.id !== "string") continue;
        const profile = freeze({
          id: entry.id,
          displayName: boundedDisplayName(entry.displayName),
          provider: validProvider(entry.provider),
          providerLabel: MUSE_AGENT_PROVIDERS.find((p) => p.id === validProvider(entry.provider)).label,
          createdAt: safeText(entry.createdAt) || nowIso(now),
          localOnly: true,
          verified: false,
        });
        profiles.set(profile.id, profile);
      }
      if (typeof stored.activeProfileId === "string" && profiles.has(stored.activeProfileId)) {
        activeProfileId = stored.activeProfileId;
      } else {
        activeProfileId = [...profiles.keys()][0] ?? null;
      }
      for (const entry of stored.designs.slice(0, MUSE_AGENT_MAX_DESIGNS)) {
        if (!entry || typeof entry.id !== "string" || !["avatar", "image"].includes(entry.kind)) continue;
        designs.set(entry.id, freeze({ ...entry, localOnly: true }));
      }
      profileCounter = profiles.size;
      designCounter = designs.size;
    } catch {
      // Corrupt storage never breaks the agent; it starts clean.
    }
  }

  // A first-run guest profile so the agent greets everyone immediately.
  if (!profiles.size) {
    addProfile({ displayName: "Guest", provider: "muse" });
  }

  return freeze({
    addProfile,
    selectProfile,
    renameProfile,
    removeProfile,
    getActiveProfile,
    listProfiles: () => freeze([...profiles.values()]),
    generate,
    save,
    getDesign,
    listDesigns,
    removeDesign,
    markApplied,
    getSnapshot,
    createContribution,
    source: MUSE_AGENT_SOURCE,
    boundary: MUSE_AGENT_BOUNDARY,
  });
}

export function createMuseAgentContribution({ seed = "muse-agent", updatedAt = MUSE_AGENT_UPDATED_AT } = {}) {
  const agent = createMuseAgent({ seed, storage: null });
  const contribution = agent.createContribution();
  return freeze({ ...contribution, updatedAt });
}

export default createMuseAgent;
