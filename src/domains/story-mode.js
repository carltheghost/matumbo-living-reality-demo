// story-mode.js — Story Mode (domain logic, no DOM/THREE/network/storage).
//
// Story Mode is a guided tour of simulated world objects: an author builds a
// story out of beats, and a player walks the beats one at a time. A beat
// points at a world object by kind + refId (feature id, world view, contract
// id, relic id, or bot id) with an optional title and caption.
//
// Pure logic only. Rendering lives outside this module. The canonical
// journey story (Tumbo's designed journey, end to end) is frozen and can be
// seeded into any library; canonical stories cannot be edited in place.
// Local-only: every player snapshot carries the standard local-simulation
// flags and this module never touches storage, network, or authority APIs.

export const STORY_MODE_SCHEMA_VERSION = 1;
export const STORY_MODE_STORAGE_KEY = "matumbo.story-mode.v1";
export const STORY_MODE_BEAT_KINDS = ["feature", "world-view", "contract", "relic", "bot"];
export const STORY_MODE_WORLD_VIEWS = ["giant-block", "constellation", "tentacles"];
export const STORY_PLAYER_STATES = ["idle", "playing", "finished"];
export const JOURNEY_STORY_ID = "story-journey";
export const STORY_MODE_BOUNDARY =
  "Local story mode: a guided tour of simulated world objects only. No wallet, no custody, no mainnet, no network call, no real execution. Stories persist in this browser only.";

const MAX_TITLE_LENGTH = 80;

const LOCAL_FLAGS = Object.freeze({
  simulation: true,
  externalTransfer: false,
  localOnly: true,
});

function nextStoryId(library) {
  return `story-${++library.seq}`;
}

function nextBeatId(library) {
  return `beat-${++library.seq}`;
}

/**
 * Normalize and validate a story title. Titles are required, trimmed, and
 * capped at 80 characters. Returns { ok, title } or { ok:false, reason }.
 */
function cleanTitle(title) {
  if (typeof title !== "string") return { ok: false, reason: "invalid-title" };
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, reason: "invalid-title" };
  if (trimmed.length > MAX_TITLE_LENGTH) return { ok: false, reason: "title-too-long" };
  return { ok: true, title: trimmed };
}

/**
 * Create a fresh, empty story library.
 */
export function createStoryLibrary() {
  return {
    schemaVersion: STORY_MODE_SCHEMA_VERSION,
    seq: 0,
    stories: [],
    activeStoryId: null,
    activeBeatIndex: 0,
  };
}

/**
 * Look up a story by id. Returns the story object or null.
 */
export function getStory(library, storyId) {
  const stories = Array.isArray(library?.stories) ? library.stories : [];
  return stories.find((s) => s && s.id === storyId) ?? null;
}

/**
 * List all stories in the library (shallow copy of the stories array).
 */
export function listStories(library) {
  return Array.isArray(library?.stories) ? [...library.stories] : [];
}

/**
 * Create a new non-canonical story in the library. Story ids are
 * deterministic per operation order: `story-${++library.seq}`.
 */
export function createStory(library, { title, description } = {}) {
  if (!library || !Array.isArray(library.stories)) {
    return { ok: false, reason: "no-library" };
  }
  const valid = cleanTitle(title);
  if (!valid.ok) return valid;
  const story = {
    id: nextStoryId(library),
    canonical: false,
    title: valid.title,
    description: typeof description === "string" ? description : "",
    beats: [],
  };
  library.stories.push(story);
  return { ok: true, story };
}

/**
 * Rename a story (title and/or description). Canonical stories are locked.
 */
export function renameStory(library, storyId, { title, description } = {}) {
  const story = getStory(library, storyId);
  if (!story) return { ok: false, reason: "story-not-found" };
  if (story.canonical === true) return { ok: false, reason: "canonical-story" };
  if (title !== undefined) {
    const valid = cleanTitle(title);
    if (!valid.ok) return valid;
    story.title = valid.title;
  }
  if (description !== undefined) {
    story.description = typeof description === "string" ? description : "";
  }
  return { ok: true, story };
}

/**
 * Delete a story from the library. Canonical stories are locked. Clears the
 * active pointer when it pointed at the deleted story.
 */
export function deleteStory(library, storyId) {
  const story = getStory(library, storyId);
  if (!story) return { ok: false, reason: "story-not-found" };
  if (story.canonical === true) return { ok: false, reason: "canonical-story" };
  library.stories = library.stories.filter((s) => s && s.id !== storyId);
  if (library.activeStoryId === storyId) {
    library.activeStoryId = null;
    library.activeBeatIndex = 0;
  }
  return { ok: true };
}

/**
 * Duplicate a story as a non-canonical copy titled `<title> (copy)`, with
 * fresh deterministic ids for the story and every beat.
 */
export function copyStory(library, storyId) {
  if (!library || !Array.isArray(library.stories)) {
    return { ok: false, reason: "no-library" };
  }
  const story = getStory(library, storyId);
  if (!story) return { ok: false, reason: "story-not-found" };
  const copy = {
    id: nextStoryId(library),
    canonical: false,
    title: `${story.title} (copy)`.slice(0, MAX_TITLE_LENGTH),
    description: typeof story.description === "string" ? story.description : "",
    beats: (Array.isArray(story.beats) ? story.beats : []).map((b) => ({
      id: nextBeatId(library),
      kind: b?.kind,
      refId: b?.refId,
      title: b?.title,
      caption: typeof b?.caption === "string" ? b.caption : "",
    })),
  };
  library.stories.push(copy);
  return { ok: true, story: copy };
}

function findBeat(story, beatId) {
  const beats = Array.isArray(story?.beats) ? story.beats : [];
  return beats.find((b) => b && b.id === beatId) ?? null;
}

/**
 * Build a beat object from raw fields, applying beat-level validation.
 * Returns { ok, beat } or { ok:false, reason }.
 */
function buildBeat({ kind, refId, title, caption } = {}) {
  if (!STORY_MODE_BEAT_KINDS.includes(kind)) {
    return { ok: false, reason: "invalid-beat-kind" };
  }
  if (typeof refId !== "string" || !refId) {
    return { ok: false, reason: "invalid-beat-ref" };
  }
  const valid = cleanTitle(title);
  if (!valid.ok) return { ok: false, reason: "invalid-beat-title" };
  return {
    ok: true,
    beat: {
      kind,
      refId,
      title: valid.title,
      caption: typeof caption === "string" ? caption : "",
    },
  };
}

function assertEditableStory(library, storyId) {
  const story = getStory(library, storyId);
  if (!story) return { ok: false, reason: "story-not-found", story: null };
  if (story.canonical === true) return { ok: false, reason: "canonical-story", story: null };
  return { ok: true, story };
}

/**
 * Append a beat to a story. Beat ids are deterministic per operation order:
 * `beat-${++library.seq}`. Canonical stories are locked.
 */
export function addBeat(library, storyId, { kind, refId, title, caption } = {}) {
  const editable = assertEditableStory(library, storyId);
  if (!editable.ok) return { ok: false, reason: editable.reason };
  const built = buildBeat({ kind, refId, title, caption });
  if (!built.ok) return { ok: false, reason: built.reason };
  const beat = { id: nextBeatId(library), ...built.beat };
  editable.story.beats.push(beat);
  return { ok: true, beat };
}

/**
 * Patch a beat's kind/refId/title/caption. The merged beat is revalidated.
 * Canonical stories are locked.
 */
export function updateBeat(library, storyId, beatId, patch = {}) {
  const editable = assertEditableStory(library, storyId);
  if (!editable.ok) return { ok: false, reason: editable.reason };
  const beat = findBeat(editable.story, beatId);
  if (!beat) return { ok: false, reason: "beat-not-found" };
  const merged = {
    kind: patch.kind !== undefined ? patch.kind : beat.kind,
    refId: patch.refId !== undefined ? patch.refId : beat.refId,
    title: patch.title !== undefined ? patch.title : beat.title,
    caption: patch.caption !== undefined ? patch.caption : beat.caption,
  };
  const built = buildBeat(merged);
  if (!built.ok) return { ok: false, reason: built.reason };
  Object.assign(beat, built.beat);
  return { ok: true, beat };
}

/**
 * Remove a beat from a story. Canonical stories are locked.
 */
export function removeBeat(library, storyId, beatId) {
  const editable = assertEditableStory(library, storyId);
  if (!editable.ok) return { ok: false, reason: editable.reason };
  const beat = findBeat(editable.story, beatId);
  if (!beat) return { ok: false, reason: "beat-not-found" };
  editable.story.beats = editable.story.beats.filter((b) => b && b.id !== beatId);
  return { ok: true, beat };
}

/**
 * Move a beat to a new position. The target index is clamped into range.
 * An unknown beat id is rejected without mutation. Canonical stories locked.
 */
export function moveBeat(library, storyId, beatId, toIndex) {
  const editable = assertEditableStory(library, storyId);
  if (!editable.ok) return { ok: false, reason: editable.reason };
  const beats = editable.story.beats;
  const from = beats.findIndex((b) => b && b.id === beatId);
  if (from < 0) return { ok: false, reason: "beat-not-found" };
  if (typeof toIndex !== "number" || !Number.isFinite(toIndex)) {
    return { ok: false, reason: "invalid-beat-index" };
  }
  const clamped = Math.max(0, Math.min(beats.length - 1, Math.floor(toIndex)));
  const [beat] = beats.splice(from, 1);
  beats.splice(clamped, 0, beat);
  return { ok: true, beat, index: clamped };
}

/**
 * Validate a beat object. kind must be one of STORY_MODE_BEAT_KINDS and
 * refId must be a non-empty string. When a registry is provided and
 * registry[kind] is an array or Set, refId must be included in it.
 */
export function validateBeat(beat, registry = null) {
  if (!beat || typeof beat !== "object") return { ok: false, reason: "invalid-beat" };
  if (!STORY_MODE_BEAT_KINDS.includes(beat.kind)) {
    return { ok: false, reason: "invalid-beat-kind" };
  }
  if (typeof beat.refId !== "string" || !beat.refId) {
    return { ok: false, reason: "invalid-beat-ref" };
  }
  if (registry && registry[beat.kind] != null) {
    const known = registry[beat.kind];
    const includes = Array.isArray(known)
      ? known.includes(beat.refId)
      : typeof known.has === "function"
        ? known.has(beat.refId)
        : null;
    if (includes === null) return { ok: false, reason: "invalid-registry" };
    if (!includes) return { ok: false, reason: "unknown-beat-ref" };
  }
  return { ok: true };
}

/**
 * Validate a whole story: every beat must validate, and a story needs at
 * least one beat. Returns { ok, errors: [{ beatId, reason }] }.
 */
export function validateStory(story, registry = null) {
  const errors = [];
  const beats = Array.isArray(story?.beats) ? story.beats : [];
  if (beats.length === 0) {
    errors.push({ beatId: null, reason: "story-has-no-beats" });
  }
  for (const beat of beats) {
    const checked = validateBeat(beat, registry);
    if (!checked.ok) {
      errors.push({ beatId: beat?.id ?? null, reason: checked.reason });
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Create a fresh player: idle, unbound to any story.
 */
export function createStoryPlayer() {
  return { state: "idle", storyId: null, beatIndex: 0 };
}

/**
 * Resolve the beat under the player, or null when the player is not playing
 * the given story.
 */
export function currentBeat(player, story) {
  if (!player || player.state !== "playing") return null;
  if (!story || story.id !== player.storyId) return null;
  const beats = Array.isArray(story.beats) ? story.beats : [];
  return beats[player.beatIndex] ?? null;
}

function beatSnapshot(player, beat) {
  return Object.freeze({
    ...LOCAL_FLAGS,
    storyId: player.storyId,
    beatIndex: player.beatIndex,
    beatId: beat?.id ?? null,
    kind: beat?.kind ?? null,
    refId: beat?.refId ?? null,
    title: beat?.title ?? null,
    at: Date.now(),
  });
}

function playerFailure(player, reason) {
  return {
    ok: false,
    reason,
    state: player?.state ?? "idle",
    beat: null,
    snapshot: null,
  };
}

function assertPlaying(player, story) {
  if (!player || typeof player !== "object") return "no-player";
  if (player.state === "finished") return "already-finished";
  if (player.state !== "playing") return "not-playing";
  if (!story || story.id !== player.storyId) return "story-mismatch";
  return null;
}

function storyBeats(story) {
  return Array.isArray(story?.beats) ? story.beats : [];
}

/**
 * Start playing a story at the given beat index (default 0). Requires at
 * least one beat; the index is range-checked. Sets state to 'playing'.
 */
export function playerStart(player, story, { beatIndex = 0 } = {}) {
  if (!player || typeof player !== "object") {
    return { ok: false, reason: "no-player", state: "idle", beat: null, snapshot: null };
  }
  const beats = storyBeats(story);
  if (beats.length === 0) return playerFailure(player, "story-has-no-beats");
  if (!Number.isInteger(beatIndex) || beatIndex < 0 || beatIndex >= beats.length) {
    return playerFailure(player, "beat-index-out-of-range");
  }
  player.state = "playing";
  player.storyId = story.id;
  player.beatIndex = beatIndex;
  const beat = currentBeat(player, story);
  return { ok: true, state: "playing", beat, snapshot: beatSnapshot(player, beat) };
}

/**
 * Advance to the next beat. At the last beat the story finishes instead of
 * moving: state becomes 'finished' and the final beat is reported.
 */
export function playerNext(player, story) {
  const blocked = assertPlaying(player, story);
  if (blocked) return playerFailure(player, blocked);
  const beats = storyBeats(story);
  if (player.beatIndex >= beats.length - 1) {
    player.state = "finished";
    const beat = beats[beats.length - 1] ?? null;
    return { ok: true, state: "finished", beat, snapshot: beatSnapshot(player, beat) };
  }
  player.beatIndex += 1;
  const beat = currentBeat(player, story);
  return { ok: true, state: "playing", beat, snapshot: beatSnapshot(player, beat) };
}

/**
 * Step back one beat. At the first beat this is rejected without mutation.
 */
export function playerPrev(player, story) {
  const blocked = assertPlaying(player, story);
  if (blocked) return playerFailure(player, blocked);
  if (player.beatIndex <= 0) return playerFailure(player, "at-first-beat");
  player.beatIndex -= 1;
  const beat = currentBeat(player, story);
  return { ok: true, state: "playing", beat, snapshot: beatSnapshot(player, beat) };
}

/**
 * Jump to a beat index (range-checked). No mutation on failure.
 */
export function playerGoto(player, story, index) {
  const blocked = assertPlaying(player, story);
  if (blocked) return playerFailure(player, blocked);
  const beats = storyBeats(story);
  if (!Number.isInteger(index) || index < 0 || index >= beats.length) {
    return playerFailure(player, "beat-index-out-of-range");
  }
  player.beatIndex = index;
  const beat = currentBeat(player, story);
  return { ok: true, state: "playing", beat, snapshot: beatSnapshot(player, beat) };
}

/**
 * Stop playback and unbind the player from the story: state 'idle'.
 */
export function playerStop(player) {
  if (!player || typeof player !== "object") {
    return { ok: false, reason: "no-player", state: "idle", beat: null, snapshot: null };
  }
  player.state = "idle";
  player.storyId = null;
  player.beatIndex = 0;
  return { ok: true, state: "idle", beat: null, snapshot: null };
}

/**
 * Serialize a library to a JSON string.
 */
export function encodeLibrary(library) {
  return JSON.stringify(library ?? {});
}

function normalizeBeat(raw) {
  return {
    id: typeof raw?.id === "string" ? raw.id : "",
    kind: typeof raw?.kind === "string" ? raw.kind : "feature",
    refId: typeof raw?.refId === "string" ? raw.refId : "",
    title: typeof raw?.title === "string" ? raw.title : "",
    caption: typeof raw?.caption === "string" ? raw.caption : "",
  };
}

function normalizeStory(raw) {
  return {
    id: typeof raw?.id === "string" ? raw.id : "",
    canonical: raw?.canonical === true,
    title: typeof raw?.title === "string" ? raw.title : "",
    description: typeof raw?.description === "string" ? raw.description : "",
    beats: Array.isArray(raw?.beats) ? raw.beats.map(normalizeBeat) : [],
  };
}

/**
 * Deserialize a library from a JSON string. Rejects non-objects and wrong
 * schema versions; missing fields are defensively filled with defaults.
 */
export function decodeLibrary(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: "invalid-json", library: null };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "invalid-library", library: null };
  }
  if (parsed.schemaVersion !== STORY_MODE_SCHEMA_VERSION) {
    return { ok: false, reason: "unsupported-schema-version", library: null };
  }
  const library = {
    schemaVersion: STORY_MODE_SCHEMA_VERSION,
    seq: Number.isInteger(parsed.seq) && parsed.seq >= 0 ? parsed.seq : 0,
    stories: Array.isArray(parsed.stories) ? parsed.stories.map(normalizeStory) : [],
    activeStoryId: typeof parsed.activeStoryId === "string" ? parsed.activeStoryId : null,
    activeBeatIndex:
      Number.isInteger(parsed.activeBeatIndex) && parsed.activeBeatIndex >= 0
        ? parsed.activeBeatIndex
        : 0,
  };
  return { ok: true, library };
}

/**
 * Create a storage-backed story store. `storage` only needs getItem/setItem
 * (localStorage-compatible); this module never touches storage directly.
 */
export function createStoryStore(storage) {
  const store = {
    load() {
      try {
        const raw = storage.getItem(STORY_MODE_STORAGE_KEY);
        if (raw == null) {
          return { ok: true, library: createStoryLibrary(), fresh: true };
        }
        const decoded = decodeLibrary(raw);
        if (!decoded.ok) {
          return {
            ok: false,
            reason: decoded.reason,
            library: createStoryLibrary(),
            fresh: true,
          };
        }
        return { ok: true, library: decoded.library, fresh: false };
      } catch (err) {
        return {
          ok: false,
          reason: "storage-error",
          library: createStoryLibrary(),
          fresh: true,
        };
      }
    },
    save(library) {
      try {
        storage.setItem(STORY_MODE_STORAGE_KEY, encodeLibrary(library));
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: "storage-error" };
      }
    },
    reset() {
      return store.save(createStoryLibrary());
    },
  };
  return store;
}

const JOURNEY_BEAT_DEFS = [
  {
    kind: "world-view",
    refId: "giant-block",
    title: "One Block",
    caption: "Far away, the whole Living Reality is a single giant pulsing glass block.",
  },
  {
    kind: "feature",
    refId: "block-world",
    title: "Constellation",
    caption: "Drift closer and the block springs open into its constellation of cubes.",
  },
  {
    kind: "world-view",
    refId: "tentacles",
    title: "Tentacles",
    caption:
      "The World Gateway stretches its tentacles \u2014 phone, PC, Picture Matter \u2014 each with its own time and space, still one reality.",
  },
  {
    kind: "feature",
    refId: "asset-market",
    title: "Asset Market",
    caption: "Evidence of the market: every listing a local simulated record.",
  },
  {
    kind: "feature",
    refId: "ledger",
    title: "Prime Ledger \u00b7 EchoProof",
    caption: "The Prime Ledger and its EchoProof chain \u2014 local, verifiable, simulated.",
  },
  {
    kind: "feature",
    refId: "contracts",
    title: "Contracts",
    caption: "Outcome contracts in eternal escrow \u2014 simulated TUMBO points only, never real money.",
  },
  {
    kind: "feature",
    refId: "nft-atelier",
    title: "Frozen Relics",
    caption: "Frozen cores, evolving envelopes \u2014 cube-form relics with no chain and no custody.",
  },
  {
    kind: "feature",
    refId: "ledger",
    title: "Journal",
    caption: "Journal layers orbit the ledger \u2014 every chapter of the journey written down locally.",
  },
  {
    kind: "world-view",
    refId: "giant-block",
    title: "Back to One Block",
    caption:
      "Pull all the way back out. One block again \u2014 the story never ends, it just begins again.",
  },
];

/**
 * Build the canonical journey story (Tumbo's designed journey, end to end):
 * 9 frozen beats. Every call returns a fresh object so libraries can seed it
 * independently.
 */
export function createJourneyStory() {
  const beats = JOURNEY_BEAT_DEFS.map((def, index) =>
    Object.freeze({
      id: `beat-journey-${index + 1}`,
      kind: def.kind,
      refId: def.refId,
      title: def.title,
      caption: def.caption,
    }),
  );
  return Object.freeze({
    id: JOURNEY_STORY_ID,
    canonical: true,
    title: "The Journey",
    description: "Tumbo\u2019s designed journey, end to end.",
    beats: Object.freeze(beats),
  });
}

/**
 * Seed the canonical journey story into a library. Idempotent: when the
 * library already contains the journey story, it is returned unchanged.
 */
export function seedJourneyStory(library) {
  if (!library || !Array.isArray(library.stories)) {
    return null;
  }
  const existing = getStory(library, JOURNEY_STORY_ID);
  if (existing) return existing;
  const story = createJourneyStory();
  library.stories.push(story);
  return story;
}

/**
 * Plan a traversal of a story: one entry per beat in play order.
 */
export function planTraversal(story) {
  const beats = Array.isArray(story?.beats) ? story.beats : [];
  return beats.map((b, index) => ({
    index,
    beatId: b?.id ?? null,
    kind: b?.kind ?? null,
    refId: b?.refId ?? null,
    title: b?.title ?? null,
    caption: b?.caption ?? "",
  }));
}
