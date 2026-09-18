/**
 * Bounded public image-metadata read for the Picture Matter console.
 *
 * This module is intentionally separate from the local Statement Forge.  The
 * host owns the explicit refresh, while the renderer only displays the frozen
 * result.  Wikimedia Commons returns metadata and canonical source links; no
 * image bytes are requested, stored, or rendered by this module.
 */

export const PICTURE_MATTER_METADATA_SCHEMA_VERSION = 1;
export const PICTURE_MATTER_METADATA_SOURCE = "picture-matter-wikimedia-metadata";
export const WIKIMEDIA_COMMONS_API = "https://commons.wikimedia.org/w/api.php";
export const WIKIMEDIA_COMMONS_ORIGIN = "https://commons.wikimedia.org";
export const WIKIMEDIA_COMMONS_THUMBNAIL_ORIGIN = "https://upload.wikimedia.org";
export const PICTURE_MATTER_METADATA_DEFAULT_QUERY = "reality";
export const PICTURE_MATTER_METADATA_MAX_QUERY_LENGTH = 64;
export const PICTURE_MATTER_METADATA_DEFAULT_LIMIT = 3;
export const PICTURE_MATTER_METADATA_MAX_LIMIT = 5;
export const PICTURE_MATTER_METADATA_FETCH_TIMEOUT_MS = 9_000;

export const PICTURE_MATTER_METADATA_BOUNDARY =
  "Public Wikimedia Commons metadata only. Canonical source and optional thumbnail URLs are read as references; image bytes are not downloaded or rendered, and no storage, publishing, identity, wallet, token, or authority path exists.";

function freeze(value) {
  return Object.freeze(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return freeze(value);
  }
  if (!value || typeof value !== "object") return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return freeze(value);
}

function safeText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function nowIso(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to a deterministic-looking current timestamp for the
    // unavailable envelope; callers can inject `now` in tests.
  }
  return new Date().toISOString();
}

function boundedQuery(query) {
  const normalized = safeText(query, PICTURE_MATTER_METADATA_DEFAULT_QUERY)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, PICTURE_MATTER_METADATA_MAX_QUERY_LENGTH);
  return normalized || PICTURE_MATTER_METADATA_DEFAULT_QUERY;
}

function boundedLimit(limit) {
  return Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, PICTURE_MATTER_METADATA_MAX_LIMIT)
    : PICTURE_MATTER_METADATA_DEFAULT_LIMIT;
}

function isHttpsUrl(value, origin) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === origin;
  } catch {
    return false;
  }
}

function errorReason(error) {
  const message = error instanceof Error ? error.message : String(error ?? "unavailable");
  return message.slice(0, 180) || "provider response was unavailable";
}

/**
 * Build the only URL this module can request.  The fixed host, namespace,
 * property allowlist, and result cap keep the provider read reviewable.
 */
export function buildWikimediaCommonsMetadataUrl({
  query = PICTURE_MATTER_METADATA_DEFAULT_QUERY,
  limit = PICTURE_MATTER_METADATA_DEFAULT_LIMIT,
} = {}) {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: boundedQuery(query),
    gsrlimit: String(boundedLimit(limit)),
    prop: "imageinfo",
    iiprop: "url|mime|size|timestamp",
    iiurlwidth: "320",
    format: "json",
    formatversion: "2",
    origin: "*",
  });
  return `${WIKIMEDIA_COMMONS_API}?${params.toString()}`;
}

function pagesFrom(payload) {
  const pages = payload?.query?.pages;
  if (Array.isArray(pages)) return pages;
  if (!pages || typeof pages !== "object") return [];
  return Object.values(pages);
}

function normalizeRecord(page, index, retrievedAt, requestUrl) {
  const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
  if (!page || !info || !Number.isSafeInteger(Number(page.pageid))) return null;
  const pageId = Number(page.pageid);
  const title = safeText(page.title, `Wikimedia file ${index + 1}`);
  const descriptionUrl = isHttpsUrl(info.descriptionurl, WIKIMEDIA_COMMONS_ORIGIN)
    ? info.descriptionurl
    : null;
  const thumbnailUrl = isHttpsUrl(info.thumburl, WIKIMEDIA_COMMONS_THUMBNAIL_ORIGIN)
    ? info.thumburl
    : null;
  const timestamp = typeof info.timestamp === "string" && !Number.isNaN(Date.parse(info.timestamp))
    ? new Date(info.timestamp).toISOString()
    : null;
  const mime = typeof info.mime === "string" && info.mime.startsWith("image/") ? info.mime : null;
  if (!descriptionUrl || !timestamp || !mime) return null;
  return {
    id: `wikimedia-commons:page:${pageId}`,
    pageId,
    title,
    sourceUrl: descriptionUrl,
    thumbnailUrl,
    mime,
    sizeBytes: Number.isSafeInteger(info.size) && info.size >= 0 ? info.size : null,
    width: Number.isSafeInteger(info.width) && info.width >= 0 ? info.width : null,
    height: Number.isSafeInteger(info.height) && info.height >= 0 ? info.height : null,
    providerTimestamp: timestamp,
    retrievedAt,
    requestUrl,
    metadataOnly: true,
    imageBytesFetched: false,
    imageBytesStored: false,
    imageBytesRendered: false,
    simulation: false,
    externalNetwork: true,
    persistence: false,
    publishing: false,
    executable: false,
  };
}

function envelope({
  retrievedAt,
  query,
  limit,
  requestUrl,
  records = [],
  status = "unavailable",
  unavailableReason = null,
  providerAvailable = false,
} = {}) {
  return deepFreeze({
    schemaVersion: PICTURE_MATTER_METADATA_SCHEMA_VERSION,
    source: PICTURE_MATTER_METADATA_SOURCE,
    provider: "Wikimedia Commons",
    endpoint: WIKIMEDIA_COMMONS_API,
    requestUrl: requestUrl ?? null,
    query: boundedQuery(query),
    requestedLimit: boundedLimit(limit),
    retrievedAt: safeText(retrievedAt, new Date().toISOString()),
    status,
    providerAvailable: providerAvailable === true,
    returnedCount: records.length,
    records,
    unavailableReason: unavailableReason ?? null,
    metadataOnly: true,
    imageBytesFetched: false,
    imageBytesStored: false,
    imageBytesRendered: false,
    externalNetwork: providerAvailable === true,
    persistence: false,
    publishing: false,
    identity: false,
    wallet: false,
    token: false,
    authority: false,
    executable: false,
    boundary: PICTURE_MATTER_METADATA_BOUNDARY,
  });
}

export function createUnavailablePictureMatterMetadata({
  retrievedAt = new Date().toISOString(),
  query = PICTURE_MATTER_METADATA_DEFAULT_QUERY,
  limit = PICTURE_MATTER_METADATA_DEFAULT_LIMIT,
  reason = "No Wikimedia Commons metadata refresh has completed; no fallback image rows were fabricated.",
} = {}) {
  return envelope({
    retrievedAt: nowIso(retrievedAt),
    query,
    limit,
    status: "unavailable",
    unavailableReason: safeText(reason),
    providerAvailable: false,
  });
}

/**
 * Perform one explicit, bounded metadata request.  The caller must invoke
 * this function in response to an intentional refresh; renderer code never
 * calls it implicitly.  Only JSON metadata is consumed from the response.
 */
export async function fetchPictureMatterMetadata({
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  query = PICTURE_MATTER_METADATA_DEFAULT_QUERY,
  limit = PICTURE_MATTER_METADATA_DEFAULT_LIMIT,
  timeoutMs = PICTURE_MATTER_METADATA_FETCH_TIMEOUT_MS,
} = {}) {
  const retrievedAt = nowIso(now);
  const normalizedQuery = boundedQuery(query);
  const boundedRequestedLimit = boundedLimit(limit);
  const requestUrl = buildWikimediaCommonsMetadataUrl({ query: normalizedQuery, limit: boundedRequestedLimit });
  if (typeof fetchImpl !== "function") {
    return createUnavailablePictureMatterMetadata({
      retrievedAt,
      query: normalizedQuery,
      limit: boundedRequestedLimit,
      reason: "Browser fetch is unavailable; no fallback image metadata was fabricated.",
    });
  }

  let timeoutHandle = null;
  let abortController = null;
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), 60_000)
    : PICTURE_MATTER_METADATA_FETCH_TIMEOUT_MS;
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
    const records = pagesFrom(payload)
      .map((page, index) => normalizeRecord(page, index, retrievedAt, requestUrl))
      .filter(Boolean)
      .filter((record, index, all) => all.findIndex((candidate) => candidate.id === record.id) === index)
      .slice(0, boundedRequestedLimit);
    return envelope({
      retrievedAt,
      query: normalizedQuery,
      limit: boundedRequestedLimit,
      requestUrl,
      records,
      status: records.length ? "ready" : "unavailable",
      unavailableReason: records.length ? null : "Wikimedia Commons returned no usable image metadata for this query.",
      providerAvailable: true,
    });
  } catch (error) {
    return envelope({
      retrievedAt,
      query: normalizedQuery,
      limit: boundedRequestedLimit,
      requestUrl,
      records: [],
      status: "unavailable",
      unavailableReason: `Wikimedia Commons metadata is unavailable: ${errorReason(error)}`,
      providerAvailable: false,
    });
  } finally {
    if (timeoutHandle !== null) globalThis.clearTimeout?.(timeoutHandle);
  }
}

export default fetchPictureMatterMetadata;
