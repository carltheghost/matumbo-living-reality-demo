/**
 * Bounded public Social Explorer pulse adapter.
 *
 * This is an explicitly requested read of one public Bluesky author feed. It
 * is deliberately separate from the fictional social-explorer catalog: the
 * catalog remains the local discover → discuss → create → allocation-preview
 * rehearsal, while this adapter exposes untrusted public-source observations
 * for inspection only. No authentication, posting, identity resolution,
 * durable persistence, media fetching, or financial action is implemented.
 */

export const SOCIAL_PULSE_SCHEMA_VERSION = 1;
export const SOCIAL_PULSE_SOURCE = "public-social-pulse-bluesky";
export const SOCIAL_PULSE_PROVIDER = "Bluesky public AppView";
export const SOCIAL_PULSE_ENDPOINT = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
export const SOCIAL_PULSE_DOCUMENTATION = "https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed";
export const SOCIAL_PULSE_DEFAULT_ACTOR = "atproto.com";
export const SOCIAL_PULSE_ALLOWED_ACTORS = Object.freeze([SOCIAL_PULSE_DEFAULT_ACTOR]);
export const SOCIAL_PULSE_DEFAULT_LIMIT = 8;
export const SOCIAL_PULSE_MAX_LIMIT = 8;
export const SOCIAL_PULSE_MAX_TEXT_LENGTH = 480;
export const SOCIAL_PULSE_FETCH_TIMEOUT_MS = 9_000;

export const SOCIAL_PULSE_BOUNDARY =
  "Public Bluesky author-feed observations only. Content is untrusted and provider-attributed; no authentication, identity resolution, posting, media bytes, storage, recipient, wallet, token, transfer, settlement, or authority path exists.";

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  if (!value || typeof value !== "object") return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

function safeText(value, fallback = null, maxLength = SOCIAL_PULSE_MAX_TEXT_LENGTH) {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
  return normalized || fallback;
}

function timestamp(value) {
  const raw = safeText(value, null, 80);
  if (!raw || !Number.isFinite(Date.parse(raw))) return null;
  return new Date(raw).toISOString();
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  return timestamp(value) ?? new Date().toISOString();
}

function boundedActor(actor) {
  const requested = safeText(actor, SOCIAL_PULSE_DEFAULT_ACTOR, 128).toLowerCase();
  return SOCIAL_PULSE_ALLOWED_ACTORS.includes(requested)
    ? requested
    : SOCIAL_PULSE_DEFAULT_ACTOR;
}

function boundedLimit(limit) {
  return Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, SOCIAL_PULSE_MAX_LIMIT)
    : SOCIAL_PULSE_DEFAULT_LIMIT;
}

function boundedCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sourceUrlForPost({ uri, handle }) {
  const candidateUri = safeText(uri, null, 300);
  const candidateHandle = safeText(handle, null, 128);
  if (!candidateUri || !candidateHandle || !/^[a-z0-9][a-z0-9.-]{0,127}$/i.test(candidateHandle)) return null;
  const match = /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([a-z0-9]+)$/i.exec(candidateUri);
  if (!match) return null;
  return `https://bsky.app/profile/${encodeURIComponent(candidateHandle)}/post/${encodeURIComponent(match[1])}`;
}

function normalizeRecord(entry, index, retrievedAt, requestUrl) {
  const post = entry?.post;
  const record = post?.record;
  const text = safeText(record?.text, null);
  const uri = safeText(post?.uri, null, 300);
  const authorHandle = safeText(post?.author?.handle, null, 128);
  const authorDisplayName = safeText(post?.author?.displayName, authorHandle ?? `Public author ${index + 1}`, 160);
  const publishedAt = timestamp(record?.createdAt);
  const indexedAt = timestamp(post?.indexedAt);
  if (!post || !record || !text || !uri || !authorHandle || !publishedAt) return null;
  const sourceUrl = sourceUrlForPost({ uri, handle: authorHandle });
  if (!sourceUrl) return null;
  return {
    id: `bluesky:post:${uri}`,
    kind: "public-social-observation",
    provider: SOCIAL_PULSE_PROVIDER,
    authorHandle,
    authorDisplayName,
    text,
    publishedAt,
    indexedAt,
    sourceUrl,
    postUri: uri,
    replyCount: boundedCount(post.replyCount),
    repostCount: boundedCount(post.repostCount),
    likeCount: boundedCount(post.likeCount),
    quoteCount: boundedCount(post.quoteCount),
    retrievedAt,
    requestUrl,
    publicSource: true,
    untrusted: true,
    metadataOnly: true,
    mediaPresent: Boolean(post.embed || record.embed),
    mediaBytesFetched: false,
    mediaBytesStored: false,
    mediaBytesRendered: false,
    authentication: false,
    identityResolution: false,
    posting: false,
    persistence: false,
    publishing: false,
    recipient: false,
    wallet: false,
    token: false,
    transfer: false,
    settlement: false,
    authority: false,
    executable: false,
  };
}

function envelope({
  retrievedAt,
  actor = SOCIAL_PULSE_DEFAULT_ACTOR,
  limit = SOCIAL_PULSE_DEFAULT_LIMIT,
  requestUrl = null,
  records = [],
  status = "unavailable",
  providerAvailable = false,
  unavailableReason = null,
  externalNetwork = false,
} = {}) {
  return deepFreeze({
    schemaVersion: SOCIAL_PULSE_SCHEMA_VERSION,
    source: SOCIAL_PULSE_SOURCE,
    provider: SOCIAL_PULSE_PROVIDER,
    endpoint: SOCIAL_PULSE_ENDPOINT,
    documentation: SOCIAL_PULSE_DOCUMENTATION,
    actor: boundedActor(actor),
    requestUrl,
    requestedLimit: boundedLimit(limit),
    retrievedAt: safeText(retrievedAt, new Date().toISOString(), 80),
    status,
    providerAvailable: providerAvailable === true,
    returnedCount: records.length,
    records,
    unavailableReason: unavailableReason ?? null,
    publicSource: true,
    untrusted: true,
    metadataOnly: true,
    mediaBytesFetched: false,
    mediaBytesStored: false,
    mediaBytesRendered: false,
    authentication: false,
    identityResolution: false,
    posting: false,
    persistence: false,
    publishing: false,
    recipient: false,
    wallet: false,
    token: false,
    transfer: false,
    settlement: false,
    authority: false,
    executable: false,
    externalNetwork: externalNetwork === true,
    localProjection: true,
    boundary: SOCIAL_PULSE_BOUNDARY,
  });
}

function safeError(error) {
  if (error?.name === "AbortError" || /\babort(?:ed|ing)?\b/i.test(String(error?.message ?? ""))) {
    return "Provider request timed out before a usable response arrived.";
  }
  const message = safeText(error?.message ?? error, "provider unavailable", 180);
  return message;
}

/** Build the only URL this adapter can request. Actor selection is allowlisted. */
export function buildBlueskySocialPulseUrl({
  actor = SOCIAL_PULSE_DEFAULT_ACTOR,
  limit = SOCIAL_PULSE_DEFAULT_LIMIT,
} = {}) {
  const params = new URLSearchParams({
    actor: boundedActor(actor),
    limit: String(boundedLimit(limit)),
  });
  return `${SOCIAL_PULSE_ENDPOINT}?${params.toString()}`;
}

export function createUnavailableSocialPulse({
  retrievedAt = new Date().toISOString(),
  actor = SOCIAL_PULSE_DEFAULT_ACTOR,
  limit = SOCIAL_PULSE_DEFAULT_LIMIT,
  reason = "No public social pulse refresh has completed; no fallback or fictional rows were fabricated.",
} = {}) {
  return envelope({
    retrievedAt: nowIso(retrievedAt),
    actor,
    limit,
    status: "unavailable",
    providerAvailable: false,
    externalNetwork: false,
    unavailableReason: safeText(reason, "Public social pulse is unavailable; no fallback rows were fabricated.", 240),
  });
}

/**
 * Fetch one explicit, bounded public author-feed pulse. The caller owns when
 * this function runs; no renderer should invoke it implicitly. Only text and
 * post metadata are normalized; embeds and media references are not followed.
 */
export async function fetchSocialPulse({
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  actor = SOCIAL_PULSE_DEFAULT_ACTOR,
  limit = SOCIAL_PULSE_DEFAULT_LIMIT,
  timeoutMs = SOCIAL_PULSE_FETCH_TIMEOUT_MS,
} = {}) {
  const retrievedAt = nowIso(now);
  const normalizedActor = boundedActor(actor);
  const boundedRequestedLimit = boundedLimit(limit);
  const requestUrl = buildBlueskySocialPulseUrl({ actor: normalizedActor, limit: boundedRequestedLimit });
  if (typeof fetchImpl !== "function") {
    return createUnavailableSocialPulse({
      retrievedAt,
      actor: normalizedActor,
      limit: boundedRequestedLimit,
      reason: "Browser fetch is unavailable; no fallback social rows were fabricated.",
    });
  }

  let timeoutHandle = null;
  let abortController = null;
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 60_000)
    : SOCIAL_PULSE_FETCH_TIMEOUT_MS;
  try {
    if (typeof globalThis.AbortController === "function") {
      abortController = new globalThis.AbortController();
      timeoutHandle = globalThis.setTimeout?.(() => abortController.abort(), boundedTimeout) ?? null;
    }
    const response = await fetchImpl(requestUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      ...(abortController ? { signal: abortController.signal } : {}),
    });
    if (!response?.ok || typeof response.json !== "function") {
      throw new Error(`HTTP ${response?.status ?? "unavailable"}`);
    }
    const payload = await response.json();
    const records = (Array.isArray(payload?.feed) ? payload.feed : [])
      .map((entry, index) => normalizeRecord(entry, index, retrievedAt, requestUrl))
      .filter(Boolean)
      .filter((record, index, all) => all.findIndex((candidate) => candidate.id === record.id) === index)
      .slice(0, boundedRequestedLimit);
    return envelope({
      retrievedAt,
      actor: normalizedActor,
      limit: boundedRequestedLimit,
      requestUrl,
      records,
      status: records.length ? "ready" : "unavailable",
      providerAvailable: true,
      externalNetwork: true,
      unavailableReason: records.length
        ? null
        : "Bluesky returned no usable text observations for this public feed; no fallback rows were fabricated.",
    });
  } catch (error) {
    return envelope({
      retrievedAt,
      actor: normalizedActor,
      limit: boundedRequestedLimit,
      requestUrl,
      records: [],
      status: "unavailable",
      providerAvailable: false,
      externalNetwork: false,
      unavailableReason: `Bluesky public social pulse is unavailable: ${safeError(error)}`,
    });
  } finally {
    if (timeoutHandle !== null) globalThis.clearTimeout?.(timeoutHandle);
  }
}

export default fetchSocialPulse;
