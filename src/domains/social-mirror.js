/**
 * Social Mirror — ambient social-feed pass-through (domain projection).
 *
 * The mirror is a glass cube that reflects the owner's social feeds
 * (X/Twitter, YouTube, Snapchat, Meta accounts) as an ambient, glanceable
 * pass-through: a slim ticker strip stays visible at the side of the world
 * without opening the block, and double-clicking the cube travels into the
 * full feed world.
 *
 * This module is a pure local projection. It performs no network request,
 * accepts no credentials, API keys, tokens, or secrets, and never fabricates
 * feed rows. Official embeds only: the X timeline widget and YouTube iframe
 * embeds render provider content inside their own frames. Snapchat and Meta
 * offer no unauthenticated embeds, so they resolve to clean "connect
 * account" placeholders. Offline or empty states resolve to quiet
 * placeholder content — the mirror never shows an error wall.
 *
 * Simulated points only — no money, no wagering, no wallets anywhere.
 */

export const SOCIAL_MIRROR_SCHEMA_VERSION = 1;
export const SOCIAL_MIRROR_SOURCE = "social-mirror-feed";
export const SOCIAL_MIRROR_CONSOLE_SOURCE = "social-mirror-console";
export const SOCIAL_MIRROR_FEATURE_ID = "social-mirror";
export const SOCIAL_MIRROR_UPDATED_AT = "2026-09-20T00:00:00.000Z";

export const SOCIAL_MIRROR_X_WIDGET_SCRIPT = "https://platform.twitter.com/widgets.js";
export const SOCIAL_MIRROR_X_WIDGET_DOCS = "https://developer.x.com/en/docs/x-for-websites/timelines/overview";
export const SOCIAL_MIRROR_YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";
export const SOCIAL_MIRROR_YOUTUBE_EMBED_DOCS = "https://developers.google.com/youtube/player_parameters";

export const SOCIAL_MIRROR_BOUNDARY =
  "Official embeds only: the X timeline widget and YouTube iframe embeds render provider content inside their own frames — this demo never reads, stores, or republishes feed data. Snapchat and Meta offer no unauthenticated embeds and stay as connect placeholders. No credentials, API keys, tokens, or secrets are requested, accepted, or stored anywhere. Offline or empty states show quiet placeholders, never an error wall. Simulated points only — no money, no wagering, no wallets.";

function freeze(value) {
  return Object.freeze(value);
}

function safeText(value, fallback = "") {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

// Targets are identifiers for official public embeds only — never secrets.
// They are sanitized hard so they can never become a script or URL payload.
function sanitizeHandle(value) {
  const text = safeText(value);
  if (!/^[A-Za-z0-9_]{1,15}$/.test(text)) return null;
  return text;
}

function sanitizePlaylistId(value) {
  const text = safeText(value);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(text)) return null;
  return text;
}

export const SOCIAL_MIRROR_SOURCES = freeze([
  freeze({
    id: "x",
    label: "X / Twitter",
    embedKind: "official-widget",
    unauthenticatedEmbed: true,
    script: SOCIAL_MIRROR_X_WIDGET_SCRIPT,
    docs: SOCIAL_MIRROR_X_WIDGET_DOCS,
    description: "Official X timeline widget. Renders only when an owner handle is configured.",
    connectCopy: "Add the owner's X handle to SOCIAL_MIRROR_EMBED_TARGETS to light up the official timeline widget.",
  }),
  freeze({
    id: "youtube",
    label: "YouTube",
    embedKind: "official-iframe",
    unauthenticatedEmbed: true,
    origin: SOCIAL_MIRROR_YOUTUBE_EMBED_ORIGIN,
    docs: SOCIAL_MIRROR_YOUTUBE_EMBED_DOCS,
    description: "Official YouTube iframe embed of the channel uploads playlist. Renders only when a playlist id is configured.",
    connectCopy: "Add the channel uploads playlist id to SOCIAL_MIRROR_EMBED_TARGETS to light up the official player.",
  }),
  freeze({
    id: "snapchat",
    label: "Snapchat",
    embedKind: "none",
    unauthenticatedEmbed: false,
    description: "Snapchat offers no unauthenticated embed. This source stays a connect placeholder.",
    connectCopy: "Connect placeholder — Snapchat offers no unauthenticated embed, and this demo never asks for credentials.",
  }),
  freeze({
    id: "meta",
    label: "Meta",
    embedKind: "none",
    unauthenticatedEmbed: false,
    description: "Meta offers no unauthenticated embed. This source stays a connect placeholder.",
    connectCopy: "Connect placeholder — Meta offers no unauthenticated embed, and this demo never asks for credentials.",
  }),
]);

export const SOCIAL_MIRROR_TABS = freeze([
  freeze({ id: "feed", label: "Feed" }),
  freeze({ id: "sources", label: "Sources" }),
  freeze({ id: "about", label: "About" }),
]);

/**
 * Owner-configured embed targets. Every value defaults to null, which keeps
 * the mirror quiet: official embeds render only for an explicitly configured
 * public handle / playlist id. Snapchat and Meta stay placeholders — there
 * is no target shape that could light them up, by design.
 */
export const SOCIAL_MIRROR_DEFAULT_TARGETS = freeze({
  x: freeze({ handle: null }),
  youtube: freeze({ playlistId: null }),
  snapchat: freeze({ username: null }),
  meta: freeze({ page: null }),
});

function normalizeTargets(targets) {
  const input = targets && typeof targets === "object" ? targets : {};
  return freeze({
    x: freeze({ handle: sanitizeHandle(input.x?.handle) }),
    youtube: freeze({ playlistId: sanitizePlaylistId(input.youtube?.playlistId) }),
    snapchat: freeze({ username: null }),
    meta: freeze({ page: null }),
  });
}

function isTargetConfigured(sourceId, targets) {
  if (sourceId === "x") return targets.x.handle !== null;
  if (sourceId === "youtube") return targets.youtube.playlistId !== null;
  return false;
}

/**
 * Resolve one source's mirror state. "live" needs a configured target and a
 * network; "offline" is the quiet holding state; everything else is an
 * honest placeholder. No feed rows are fabricated in any state.
 */
export function getSocialMirrorSourceState(sourceId, targets = SOCIAL_MIRROR_DEFAULT_TARGETS, online = true) {
  const source = SOCIAL_MIRROR_SOURCES.find((candidate) => candidate.id === sourceId);
  if (!source) return "placeholder";
  if (online !== true) return "offline";
  if (source.unauthenticatedEmbed && isTargetConfigured(sourceId, normalizeTargets(targets))) return "live";
  return "placeholder";
}

/** Embed descriptor for the render layer, or null when the slot stays a placeholder. */
export function getSocialMirrorEmbedDescriptor(sourceId, targets = SOCIAL_MIRROR_DEFAULT_TARGETS) {
  const normalized = normalizeTargets(targets);
  if (sourceId === "x" && normalized.x.handle) {
    return freeze({
      kind: "x-timeline",
      handle: normalized.x.handle,
      profileUrl: `https://twitter.com/${normalized.x.handle}`,
      script: SOCIAL_MIRROR_X_WIDGET_SCRIPT,
      official: true,
    });
  }
  if (sourceId === "youtube" && normalized.youtube.playlistId) {
    return freeze({
      kind: "youtube-iframe",
      playlistId: normalized.youtube.playlistId,
      embedUrl: `${SOCIAL_MIRROR_YOUTUBE_EMBED_ORIGIN}/embed/videoseries?list=${normalized.youtube.playlistId}`,
      official: true,
    });
  }
  return null;
}

function tickerTextFor(source, state) {
  switch (source.id) {
    case "x":
      return state === "live"
        ? "X · timeline live — the latest posts are inside the mirror"
        : state === "offline"
          ? "X · offline — the mirror holds its quiet state"
          : "X · quiet — add an owner handle to light up the timeline";
    case "youtube":
      return state === "live"
        ? "YouTube · latest uploads playing inside the mirror"
        : state === "offline"
          ? "YouTube · offline — the mirror holds its quiet state"
          : "YouTube · quiet — add an uploads playlist to light up the channel";
    case "snapchat":
      return state === "offline"
        ? "Snapchat · offline — connect placeholder holding"
        : "Snapchat · connect placeholder — no unauthenticated embed exists";
    case "meta":
      return state === "offline"
        ? "Meta · offline — connect placeholder holding"
        : "Meta · connect placeholder — no unauthenticated embed exists";
    default:
      return `${source.label} · quiet`;
  }
}

/** Deterministic, glanceable ticker items derived from source states. */
export function getSocialMirrorTickerItems(projection) {
  const sources = Array.isArray(projection?.sources) ? projection.sources : [];
  const items = sources.map((source, index) => freeze({
    id: `social-mirror-ticker:${source.id}`,
    ordinal: index + 1,
    sourceId: source.id,
    label: source.label,
    state: source.state,
    text: tickerTextFor(source, source.state),
    tone: source.state === "live" ? "live" : source.state === "offline" ? "offline" : "quiet",
    localOnly: true,
    simulation: true,
  }));
  return freeze(items);
}

export function createSocialMirrorProjection({ targets = SOCIAL_MIRROR_DEFAULT_TARGETS, online = true } = {}) {
  const normalizedTargets = normalizeTargets(targets);
  const networkUp = online !== false;
  const sources = SOCIAL_MIRROR_SOURCES.map((source) => {
    const state = getSocialMirrorSourceState(source.id, normalizedTargets, networkUp);
    const embed = state === "live" ? getSocialMirrorEmbedDescriptor(source.id, normalizedTargets) : null;
    return freeze({
      ...source,
      target: normalizedTargets[source.id] ?? freeze({}),
      state,
      embed,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      persistence: false,
      executable: false,
    });
  });
  const liveCount = sources.filter((source) => source.state === "live").length;
  const projection = freeze({
    schemaVersion: SOCIAL_MIRROR_SCHEMA_VERSION,
    source: SOCIAL_MIRROR_SOURCE,
    kind: "social-mirror-projection",
    featureId: SOCIAL_MIRROR_FEATURE_ID,
    updatedAt: SOCIAL_MIRROR_UPDATED_AT,
    online: networkUp,
    targets: normalizedTargets,
    sources,
    tabs: SOCIAL_MIRROR_TABS,
    sourceCount: sources.length,
    liveCount,
    quietCount: sources.length - liveCount,
    status: networkUp
      ? (liveCount > 0
        ? `MIRROR LIVE · ${liveCount}/${sources.length} SOURCES · LOCAL ONLY`
        : "MIRROR QUIET · NO TARGETS CONFIGURED · LOCAL ONLY")
      : "OFFLINE · QUIET HOLDING STATE · LOCAL ONLY",
    boundary: SOCIAL_MIRROR_BOUNDARY,
    simulation: true,
    localOnly: true,
    deterministic: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
    credentials: "never-requested",
  });
  return freeze({ ...projection, tickerItems: getSocialMirrorTickerItems(projection) });
}

export const DEFAULT_SOCIAL_MIRROR = createSocialMirrorProjection();

export default DEFAULT_SOCIAL_MIRROR;
