import { LIVE_GATEWAY_SOURCE } from "../domains/live-gateway.js?v=20260922-cache2";

export const LIVE_GATEWAY_CONSOLE_SOURCE = "live-gateway-console";
export const LIVE_GATEWAY_RENDER_SOURCE = LIVE_GATEWAY_CONSOLE_SOURCE;
export const LIVE_GATEWAY_PUBLIC_STATUS_SOURCE = "live-gateway-public-source-status";
export const LIVE_GATEWAY_STRUCTURED_STATUS_SOURCE = "live-gateway-structured-public-status";
export const LIVE_GATEWAY_PUBLIC_STATUS_DOM_ID = "live-gateway-public-status";
export const LIVE_GATEWAY_PUBLIC_REFRESH_DOM_ID = "live-gateway-public-actions";
export const LIVE_GATEWAY_PUBLIC_REFRESH_ALL_DOM_ID = "live-gateway-refresh-all";
export const LIVE_GATEWAY_PUBLIC_REFRESH_STATUS_DOM_ID = "live-gateway-public-refresh-status";
export const LIVE_GATEWAY_PUBLIC_STATUS_MAX_AGE_MS = 15 * 60 * 1000;
// Auto-refresh is deliberately opt-in and fixed. A recursive timeout keeps
// provider batches sequential and makes cancellation deterministic; there is
// no query-controlled cadence and no timer on the default route.
export const LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS = 30 * 1000;
export const LIVE_GATEWAY_PUBLIC_SURFACES = Object.freeze([
  Object.freeze({ id: "world-events", label: "World Pulse", description: "public world-event observations", refreshLabel: "Refresh World Pulse" }),
  Object.freeze({ id: "sports-events", label: "Tennis Evidence", description: "public ATP / WTA scoreboard observations", refreshLabel: "Refresh Tennis" }),
  Object.freeze({ id: "asset-market", label: "Asset Market Evidence", description: "public market observations", refreshLabel: "Refresh Asset Market" }),
  Object.freeze({ id: "protocol-evidence", label: "Protocol TVL Evidence", description: "public DeFiLlama protocol TVL observations", refreshLabel: "Refresh Protocol TVL" }),
  Object.freeze({ id: "multi-sport-events", label: "Multi-Sport Scoreboards", description: "public soccer / NBA / NFL scoreboard observations", refreshLabel: "Refresh Multi-Sport Scoreboards" }),
  Object.freeze({ id: "social-pulse", label: "Social Pulse", description: "public Bluesky author-feed observations", refreshLabel: "Refresh Social Pulse" }),
  Object.freeze({ id: "picture-matter", label: "Picture Matter Metadata", description: "public Wikimedia Commons image metadata", refreshLabel: "Refresh Picture Metadata" }),
]);
const DEFAULT_BOUNDARY = "Live Gateway is a local mock-evidence projection. External providers, credentials, live data, and truth authority are disabled.";
const freeze = (value) => Object.freeze(value);
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function deepFreeze(value) { if (Array.isArray(value)) { value.forEach((entry) => deepFreeze(entry)); return freeze(value); } if (!isRecord(value)) return value; Object.values(value).forEach((entry) => deepFreeze(entry)); return freeze(value); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function text(value, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function createText(documentRoot, tag, className, value) { const element = documentRoot.createElement(tag); if (className) element.className = className; element.textContent = text(value); return element; }
function contributionFrom(projection) { if (projection?.source === LIVE_GATEWAY_SOURCE) return projection; return asArray(projection?.contributions).find((contribution) => contribution?.source === LIVE_GATEWAY_SOURCE) ?? { source: LIVE_GATEWAY_SOURCE, updatedAt: null, entities: [], evidence: [], capabilities: [] }; }

function timestamp(value) {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function publicSourceUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function nonNegativeInteger(value, fallback = 0) {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : fallback;
}

function surfaceDefinition(surfaceId) {
  return LIVE_GATEWAY_PUBLIC_SURFACES.find((surface) => surface.id === surfaceId)
    ?? Object.freeze({ id: String(surfaceId ?? "unknown"), label: text(surfaceId, "Unknown public surface"), description: "unregistered public surface" });
}

function snapshotFor(snapshots, surfaceId) {
  if (snapshots instanceof Map) return snapshots.get(surfaceId) ?? null;
  if (isRecord(snapshots)) return snapshots[surfaceId] ?? null;
  return null;
}

function sourceRecords(snapshot, source) {
  const records = asArray(snapshot?.records);
  return records.filter((record) => (
    (source?.id && record?.providerId === source.id)
    || (source?.provider && record?.provider === source.provider)
  ));
}

function sourceObservedAt(snapshot, source, records) {
  const direct = timestamp(source?.observedAt ?? source?.sourceObservedAt);
  if (direct) return direct;
  const matching = records.length ? records : sourceRecords(snapshot, source);
  return matching.map((record) => timestamp(record?.sourceObservedAt ?? record?.observedAt)).find(Boolean) ?? null;
}

function sourceState(snapshot, source, recordCount) {
  // Provider availability is the hard gate for a usable status. Some provider
  // adapters preserve an upstream status string even when their availability
  // flag is false; never surface that contradiction as READY.
  if (source?.available !== true) return "unavailable";
  const explicit = String(source?.status ?? "").toLowerCase();
  if (["ready", "partial", "unavailable"].includes(explicit)) return explicit;
  if (source?.partial === true || snapshot?.status === "partial" && recordCount === 0) return "partial";
  return "ready";
}

function sourceFreshness(snapshot, source, retrievedAt, { now = null, staleAfterMs = LIVE_GATEWAY_PUBLIC_STATUS_MAX_AGE_MS } = {}) {
  if (source?.stale === true || snapshot?.stale === true) return "stale";
  if (source?.available !== true) return "unavailable";
  if (!retrievedAt) return "unavailable";
  const nowAt = timestamp(now);
  const maxAge = Number.isFinite(Number(staleAfterMs)) && Number(staleAfterMs) >= 0
    ? Number(staleAfterMs)
    : LIVE_GATEWAY_PUBLIC_STATUS_MAX_AGE_MS;
  if (!nowAt) return "unknown";
  const age = Date.parse(nowAt) - Date.parse(retrievedAt);
  if (!Number.isFinite(age) || age < 0) return "unknown";
  return age > maxAge ? "stale" : "fresh";
}

function unavailablePublicSourceStatus(surface, reason = "No public refresh has been completed in this page session.") {
  return {
    id: `${surface.id}:unavailable`,
    surfaceId: surface.id,
    surfaceLabel: surface.label,
    providerId: null,
    provider: `${surface.label} · no provider refresh yet`,
    state: "unavailable",
    freshness: "unavailable",
    retrievedAt: null,
    observedAt: null,
    recordCount: 0,
    sourceUrl: null,
    documentationUrl: null,
    reason,
    liveFetch: false,
    externalSource: false,
    localOnly: true,
    simulation: true,
    truthClaim: false,
    executable: false,
  };
}

/**
 * Normalize one in-memory public refresh envelope into a provider status row.
 * This function never fetches, persists, or infers data; all fields come from
 * the supplied provider status and returned records.
 */
export function normalizePublicSourceStatus(surfaceId, snapshot, options = {}) {
  const surface = surfaceDefinition(surfaceId);
  const records = asArray(snapshot?.records);
  const declaredSources = asArray(snapshot?.sources);
  // Social Pulse and Picture Matter intentionally expose one provider
  // envelope rather than a nested `sources` list. Adapt that already-mounted
  // envelope into one status row without inventing a second provider or
  // touching its records.
  const sources = declaredSources.length
    ? declaredSources
    : isRecord(snapshot) && (snapshot.provider || snapshot.endpoint || snapshot.requestUrl || snapshot.status)
      ? [{
          id: snapshot.providerId ?? snapshot.source ?? surface.id,
          provider: snapshot.provider ?? `${surface.label} provider`,
          available: snapshot.providerAvailable === true,
          status: snapshot.status,
          recordCount: Number.isSafeInteger(snapshot.returnedCount) ? snapshot.returnedCount : records.length,
          retrievedAt: snapshot.retrievedAt ?? null,
          requestUrl: snapshot.requestUrl ?? snapshot.endpoint ?? null,
          endpoint: snapshot.endpoint ?? null,
          documentation: snapshot.documentation ?? snapshot.documentationUrl ?? null,
          reason: snapshot.unavailableReason ?? snapshot.reason ?? null,
          externalSource: snapshot.externalSource === true || snapshot.externalNetwork === true,
          metadataOnly: snapshot.metadataOnly === true,
          untrusted: snapshot.untrusted === true,
        }]
      : [];
  if (!sources.length) return deepFreeze([unavailablePublicSourceStatus(surface, snapshot?.reason ?? "No provider status was returned; no data was fabricated.")]);
  const normalized = sources.map((source, index) => {
    const matchingRecords = sourceRecords(snapshot, source);
    const recordCount = nonNegativeInteger(source?.recordCount, matchingRecords.length);
    const retrievedAt = timestamp(source?.retrievedAt ?? snapshot?.retrievedAt);
    const observedAt = sourceObservedAt(snapshot, source, matchingRecords);
    const sourceUrl = publicSourceUrl(source?.requestUrl ?? source?.endpoint ?? matchingRecords[0]?.sourceUrl);
    const documentationUrl = publicSourceUrl(source?.documentation ?? matchingRecords[0]?.documentationUrl);
    return {
      id: `${surface.id}:${text(source?.id, String(index))}`,
      surfaceId: surface.id,
      surfaceLabel: surface.label,
      providerId: text(source?.id, null),
      provider: text(source?.provider, `${surface.label} provider`),
      state: sourceState(snapshot, source, recordCount),
      freshness: sourceFreshness(snapshot, source, retrievedAt, options),
      retrievedAt,
      observedAt,
      recordCount,
      sourceUrl,
      documentationUrl,
      reason: text(source?.reason, source?.available === true ? null : "Provider unavailable; no data was fabricated."),
      liveFetch: snapshot?.liveFetch === true,
      externalSource: snapshot?.externalSource === true || source?.externalSource === true,
      localOnly: true,
      simulation: true,
      truthClaim: false,
      executable: false,
      sourceFormat: text(source?.format, null),
      sourceRecordsMatched: matchingRecords.length,
      returnedRecordCount: records.length,
      metadataOnly: snapshot?.metadataOnly === true || source?.metadataOnly === true,
      untrusted: snapshot?.untrusted === true || source?.untrusted === true,
      imageBytesFetched: snapshot?.imageBytesFetched === true || source?.imageBytesFetched === true,
      imageBytesStored: snapshot?.imageBytesStored === true || source?.imageBytesStored === true,
      imageBytesRendered: snapshot?.imageBytesRendered === true || source?.imageBytesRendered === true,
      mediaBytesFetched: snapshot?.mediaBytesFetched === true || source?.mediaBytesFetched === true,
      mediaBytesStored: snapshot?.mediaBytesStored === true || source?.mediaBytesStored === true,
      mediaBytesRendered: snapshot?.mediaBytesRendered === true || source?.mediaBytesRendered === true,
    };
  });
  return deepFreeze(normalized);
}

/**
 * Normalize the structured humanitarian provider nested in the World Pulse
 * envelope. It intentionally stays outside the headline-provider `statuses`
 * array so existing GDELT/NYT/USGS/NASA counts and aggregate status remain
 * unchanged while the Live Gateway still exposes UNHCR provenance.
 */
export function normalizeStructuredPublicSourceStatus(surfaceId, snapshot, options = {}) {
  const surface = surfaceDefinition(surfaceId);
  if (surface.id !== "world-events") return deepFreeze([]);
  const humanitarian = isRecord(snapshot?.humanitarian) ? snapshot.humanitarian : null;
  const records = asArray(snapshot?.humanitarianRecords ?? humanitarian?.records);
  const nestedSources = asArray(snapshot?.humanitarianSources ?? humanitarian?.sources);
  if (!humanitarian && !nestedSources.length) return deepFreeze([]);
  const sources = nestedSources.length
    ? nestedSources
    : [{
      id: humanitarian?.providerId ?? "unhcr-population",
      provider: humanitarian?.provider ?? "UNHCR Refugee Data Finder",
      endpoint: humanitarian?.endpoint ?? null,
      documentation: humanitarian?.documentation ?? null,
      available: humanitarian?.providerAvailable === true,
      status: humanitarian?.status,
      recordCount: humanitarian?.recordCount,
      retrievedAt: snapshot?.retrievedAt ?? null,
      reason: humanitarian?.reason ?? null,
    }];
  const normalized = sources.map((source, index) => {
    const matchingRecords = records.filter((record) => (
      (source?.id && record?.providerId === source.id)
      || (source?.provider && record?.provider === source.provider)
    ));
    const recordCount = nonNegativeInteger(source?.recordCount, matchingRecords.length);
    const retrievedAt = timestamp(source?.retrievedAt ?? humanitarian?.retrievedAt ?? snapshot?.retrievedAt);
    const observedAt = sourceObservedAt({ records }, source, matchingRecords);
    const sourceUrl = publicSourceUrl(source?.requestUrl ?? source?.endpoint ?? matchingRecords[0]?.sourceUrl);
    const documentationUrl = publicSourceUrl(source?.documentation ?? matchingRecords[0]?.documentationUrl);
    return {
      id: `${surface.id}:humanitarian:${text(source?.id, String(index))}`,
      surfaceId: surface.id,
      surfaceLabel: `${surface.label} · HUMANITARIAN`,
      providerId: text(source?.id ?? humanitarian?.providerId, "unhcr-population"),
      provider: text(source?.provider ?? humanitarian?.provider, "UNHCR Refugee Data Finder"),
      state: sourceState(humanitarian ?? snapshot, source, recordCount),
      freshness: sourceFreshness(humanitarian ?? snapshot, source, retrievedAt, options),
      retrievedAt,
      observedAt,
      recordCount,
      sourceUrl,
      documentationUrl,
      reason: text(source?.reason, source?.available === true ? null : humanitarian?.reason ?? "Provider unavailable; no structured data was fabricated."),
      liveFetch: humanitarian?.liveFetch === true,
      externalSource: humanitarian?.externalSource === true || source?.externalSource === true,
      localOnly: true,
      simulation: true,
      truthClaim: false,
      executable: false,
      sourceFormat: text(source?.format, "structured-humanitarian"),
      sourceRecordsMatched: matchingRecords.length,
      returnedRecordCount: records.length,
      structured: true,
      structuredKind: "humanitarian",
    };
  });
  return deepFreeze(normalized);
}

/**
 * Summarize the public evidence surfaces without contacting providers.
 * Callers pass the current in-memory refresh envelopes by surface id.
 */
export function summarizePublicSourceStatuses(snapshots = {}, options = {}) {
  const statuses = LIVE_GATEWAY_PUBLIC_SURFACES.flatMap((surface) => {
    const snapshot = snapshotFor(snapshots, surface.id);
    const rows = normalizePublicSourceStatus(surface.id, snapshot, options);
    return rows.length ? rows : [unavailablePublicSourceStatus(surface)];
  });
  const structuredStatuses = LIVE_GATEWAY_PUBLIC_SURFACES.flatMap((surface) => normalizeStructuredPublicSourceStatus(surface.id, snapshotFor(snapshots, surface.id), options));
  const readyCount = statuses.filter((status) => status.state === "ready").length;
  const partialCount = statuses.filter((status) => status.state === "partial").length;
  const unavailableCount = statuses.filter((status) => status.state === "unavailable").length;
  const freshCount = statuses.filter((status) => status.freshness === "fresh").length;
  const staleCount = statuses.filter((status) => status.freshness === "stale").length;
  // A provider can be structurally ready while its last explicit response is
  // outside the bounded freshness window. Do not present that all-stale set
  // as aggregate READY: the individual stale labels are evidence, not a
  // substitute for a current successful refresh.
  const aggregateState = readyCount === statuses.length && staleCount === 0
    ? "ready"
    : readyCount || partialCount
      ? "partial"
      : "unavailable";
  const latestRetrievedAt = statuses
    .map((status) => status.retrievedAt)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  return deepFreeze({
    source: LIVE_GATEWAY_PUBLIC_STATUS_SOURCE,
    statuses,
    structuredStatuses,
    status: aggregateState,
    surfaceCount: LIVE_GATEWAY_PUBLIC_SURFACES.length,
    providerCount: statuses.length,
    structuredProviderCount: structuredStatuses.length,
    readyCount,
    partialCount,
    unavailableCount,
    freshCount,
    staleCount,
    structuredReadyCount: structuredStatuses.filter((status) => status.state === "ready").length,
    structuredPartialCount: structuredStatuses.filter((status) => status.state === "partial").length,
    structuredUnavailableCount: structuredStatuses.filter((status) => status.state === "unavailable").length,
    structuredFreshCount: structuredStatuses.filter((status) => status.freshness === "fresh").length,
    structuredStaleCount: structuredStatuses.filter((status) => status.freshness === "stale").length,
    latestRetrievedAt,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalProviders: false,
    providerCredentials: false,
    liveData: false,
    truthClaim: false,
    truthAuthority: "none",
    executable: false,
    persistence: false,
    boundary: "Public-source status only: provider availability and timestamps are shown from in-memory refresh responses; this is not a truth, emergency, trading, wallet, custody, signing, settlement, or response authority.",
  });
}

// Singular alias for hosts that prefer a noun matching the one-surface method.
export const summarizePublicSourceStatus = summarizePublicSourceStatuses;

function emptyLegacyGatewaySummary() {
  return deepFreeze({
    source: LIVE_GATEWAY_SOURCE,
    updatedAt: null,
    records: [],
    evidence: [],
    interpretations: [],
    boundaryEvidence: null,
    evidenceCount: 0,
    interpretationCount: 0,
    recordCount: 0,
    capabilityCount: 0,
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    externalProviders: false,
    providerCredentials: false,
    liveData: false,
    truthClaim: false,
    truthAuthority: "none",
    executable: false,
    persistence: false,
    boundary: "No legacy gateway fixture is mounted on the public-read route. Public rows must come from an explicit provider refresh.",
  });
}

/** Join mock observations to their local, non-authoritative interpretations. */
export function summarizeLiveGateway(projection, { includeLegacyFixture = true } = {}) {
  if (includeLegacyFixture !== true) return emptyLegacyGatewaySummary();
  const contribution = contributionFrom(projection);
  const evidence = asArray(contribution.evidence).filter((item) => item?.kind === "mock-evidence-observation").map((item) => deepFreeze({ ...item, recordType: "evidence", displayLabel: text(item.source ?? item.id), displayKind: "mock observation" }));
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const interpretations = asArray(contribution.entities).filter((item) => item?.kind === "mock-oracle-interpretation").map((item) => deepFreeze({ ...item, recordType: "interpretation", displayLabel: text(item.statement ?? item.id), displayKind: "mock interpretation", linkedEvidence: asArray(item.evidenceIds).map((id) => evidenceById.get(id)).filter(Boolean) }));
  const boundaryEvidence = asArray(contribution.evidence).find((item) => item?.kind === "simulation-boundary") ?? null;
  const records = [...evidence, ...interpretations];
  return deepFreeze({ source: LIVE_GATEWAY_SOURCE, updatedAt: contribution.updatedAt, records, evidence, interpretations, boundaryEvidence, evidenceCount: evidence.length, interpretationCount: interpretations.length, recordCount: records.length, capabilityCount: asArray(contribution.capabilities).length, simulation: contribution.simulation === true, localOnly: true, externalNetwork: false, externalProviders: false, providerCredentials: false, liveData: false, truthClaim: false, truthAuthority: "none", executable: false, persistence: false, boundary: boundaryEvidence?.degradedReason ? `${DEFAULT_BOUNDARY} (${boundaryEvidence.degradedReason})` : DEFAULT_BOUNDARY });
}

export function createLiveGatewayConsole({
  documentRoot = globalThis.document,
  projection = null,
  includeLegacyFixture = true,
  publicSourceSnapshots = {},
  onSelect = null,
  onReplay = null,
  onReset = null,
  onPublicSourceStatus = null,
  onPublicRefresh = null,
  onPublicRefreshAll = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Live Gateway console needs a document-like owner");
  const panel = documentRoot.getElementById("live-gateway-console");
  const closeButton = documentRoot.getElementById("live-gateway-close");
  const replayButton = documentRoot.getElementById("live-gateway-replay");
  const resetButton = documentRoot.getElementById("live-gateway-reset");
  const statusEl = documentRoot.getElementById("live-gateway-status");
  const summaryEl = documentRoot.getElementById("live-gateway-summary");
  const publicStatusEl = documentRoot.getElementById(LIVE_GATEWAY_PUBLIC_STATUS_DOM_ID);
  const publicRefreshEl = documentRoot.getElementById(LIVE_GATEWAY_PUBLIC_REFRESH_DOM_ID);
  const publicRefreshStatusEl = documentRoot.getElementById(LIVE_GATEWAY_PUBLIC_REFRESH_STATUS_DOM_ID);
  const legacyFixtureEl = documentRoot.getElementById("live-gateway-legacy-fixture");
  const currentEl = documentRoot.getElementById("live-gateway-current");
  const evidenceEl = documentRoot.getElementById("live-gateway-evidence");
  const interpretationsEl = documentRoot.getElementById("live-gateway-interpretations");
  const traceEl = documentRoot.getElementById("live-gateway-trace");
  const boundaryEl = documentRoot.getElementById("live-gateway-boundary");
  if (!panel || !closeButton || !replayButton || !resetButton || !statusEl || !summaryEl || !currentEl || !evidenceEl || !interpretationsEl || !traceEl) throw new Error("Live Gateway console mount points are missing");
  let summary = summarizeLiveGateway(projection, { includeLegacyFixture });
  let selectedType = summary.evidence[0] ? "evidence" : "interpretation";
  let selectedId = summary[selectedType]?.[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let trace = [];
  let publicSnapshots = publicSourceSnapshots instanceof Map
    ? Object.fromEntries(publicSourceSnapshots.entries())
    : isRecord(publicSourceSnapshots) ? { ...publicSourceSnapshots } : {};
  let publicStatus = summarizePublicSourceStatuses(publicSnapshots);
  let publicRefreshSurfaceId = null;
  let publicRefreshBatchActive = false;
  let publicRefreshBatch = deepFreeze({
    active: false,
    all: true,
    method: null,
    requested: [],
    completed: [],
    startedAt: null,
    finishedAt: null,
  });
  let publicRefreshMessage = "READY · SELECT A PUBLIC SOURCE TO REFRESH";
  let publicRefreshAutoTimer = null;
  let publicRefreshAutoEnabled = false;
  let publicRefreshAutoTickCount = 0;
  let publicRefreshAutoLastTickAt = null;
  let publicRefreshAutoNextAt = null;

  function recordsFor(type) { return type === "interpretation" ? summary.interpretations : summary.evidence; }
  function selectedRecord() { return recordsFor(selectedType).find((record) => record.id === selectedId) ?? summary.records[0] ?? null; }
  function autoRefreshSuffix() {
    return publicRefreshAutoEnabled
      ? ` · AUTO-REFRESH ON · FIXED CADENCE ${Math.round(LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS / 1000)}S`
      : "";
  }
  function clearAutoRefreshTimer() {
    if (publicRefreshAutoTimer !== null) clearTimeout(publicRefreshAutoTimer);
    publicRefreshAutoTimer = null;
    publicRefreshAutoNextAt = null;
  }
  function scheduleAutoRefresh() {
    clearAutoRefreshTimer();
    if (!publicRefreshAutoEnabled || !opened) return;
    publicRefreshAutoNextAt = Date.now() + LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS;
    publicRefreshAutoTimer = setTimeout(() => {
      publicRefreshAutoTimer = null;
      publicRefreshAutoNextAt = null;
      void runAutoRefreshTick("auto-refresh");
    }, LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS);
    // Node's Timeout exposes unref(); use it only in tests/tooling so a
    // forgotten teardown cannot keep a process alive. Browsers simply ignore
    // the optional method and retain the normal timer semantics.
    publicRefreshAutoTimer?.unref?.();
    renderPublicRefreshControls();
  }
  async function runAutoRefreshTick(method = "auto-refresh") {
    if (!publicRefreshAutoEnabled || !opened) return null;
    // A manual call or a late timer callback can never overlap a provider
    // batch. The next fixed tick is enough to retry after the current work.
    if (publicRefreshBatchActive || publicRefreshSurfaceId !== null) {
      scheduleAutoRefresh();
      return null;
    }
    publicRefreshAutoTickCount += 1;
    publicRefreshAutoLastTickAt = Date.now();
    renderPublicRefreshControls();
    try {
      return await refreshAllPublicSources(method);
    } finally {
      if (publicRefreshAutoEnabled && opened) scheduleAutoRefresh();
    }
  }
  function startAutoRefresh(method = "button") {
    if (!opened) {
      const blocked = buildPublicStatusIntent("auto-refresh-blocked", method, null, { autoRefreshReason: "panel-closed", autoRefreshIntervalMs: LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS });
      onPublicSourceStatus?.(blocked);
      return blocked;
    }
    if (publicRefreshAutoEnabled) {
      const alreadyActive = buildPublicStatusIntent("auto-refresh-start-blocked", method, null, { autoRefreshReason: "already-active", autoRefreshIntervalMs: LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS });
      onPublicSourceStatus?.(alreadyActive);
      return alreadyActive;
    }
    clearAutoRefreshTimer();
    publicRefreshAutoEnabled = true;
    publicRefreshAutoTickCount = 0;
    publicRefreshAutoLastTickAt = null;
    publicRefreshMessage = `AUTO-REFRESH ENABLED · FIXED CADENCE ${Math.round(LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS / 1000)}S · FIRST REFRESH NOW · PUBLIC READ ONLY`;
    renderPublicRefreshControls();
    const started = buildPublicStatusIntent("auto-refresh-start", method, null, { autoRefreshIntervalMs: LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS });
    onPublicSourceStatus?.(started);
    void runAutoRefreshTick("auto-refresh");
    return started;
  }
  function stopAutoRefresh(method = "button", emit = true) {
    const wasActive = publicRefreshAutoEnabled || publicRefreshAutoTimer !== null;
    clearAutoRefreshTimer();
    publicRefreshAutoEnabled = false;
    if (wasActive) {
      publicRefreshMessage = `AUTO-REFRESH STOPPED · FIXED CADENCE ${Math.round(LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS / 1000)}S · LOCAL CONTROL`;
    }
    renderPublicRefreshControls();
    const stopped = buildPublicStatusIntent("auto-refresh-stop", method, null, { autoRefreshWasActive: wasActive, autoRefreshIntervalMs: LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS });
    if (emit) onPublicSourceStatus?.(stopped);
    return stopped;
  }
  function setOpen(next) {
    const nextOpened = Boolean(next);
    if (!nextOpened && (publicRefreshAutoEnabled || publicRefreshAutoTimer !== null)) stopAutoRefresh("close", false);
    opened = nextOpened;
    panel.hidden = !opened;
    panel.classList?.toggle?.("visible", opened);
    panel.setAttribute?.("aria-hidden", String(!opened));
    // Public status is the canonical mounted route. Keep the compatibility
    // fixture physically hidden when this instance is configured without it;
    // CSS-only hiding is insufficient because a host may open the panel before
    // route classes settle, and hidden rows must never be exposed to AT.
    if (legacyFixtureEl && includeLegacyFixture !== true) {
      legacyFixtureEl.hidden = true;
      legacyFixtureEl.setAttribute?.("aria-hidden", "true");
    }
  }
  function pushTrace(entry) { trace = [deepFreeze({ ...entry, localOnly: true, simulation: true, externalNetwork: false, externalProviders: false, providerCredentials: false, liveData: false, truthClaim: false, executable: false }), ...trace].slice(0, 12); }
  function renderSummary() { summaryEl.replaceChildren(); [[summary.evidenceCount, "observations"], [summary.interpretationCount, "interpretations"], [summary.recordCount, "linked records"], [summary.capabilityCount, "capabilities"]].forEach(([value, label]) => { const metric = documentRoot.createElement("div"); metric.className = "live-gateway-metric"; metric.append(createText(documentRoot, "b", "live-gateway-metric-value", value), createText(documentRoot, "span", "live-gateway-metric-label", label)); summaryEl.appendChild(metric); }); }
  function recordButton(record, type) { const button = documentRoot.createElement("button"); button.type = "button"; button.className = "live-gateway-record"; button.dataset.recordId = record.id; button.dataset[`${type}Id`] = record.id; button.setAttribute("aria-pressed", String(type === selectedType && record.id === selectedId)); const meta = type === "evidence" ? `${record.degradedState} · uncertainty ${record.uncertainty}` : `${record.degradedState} · ${record.linkedEvidence.length} evidence link${record.linkedEvidence.length === 1 ? "" : "s"}`; button.append(createText(documentRoot, "strong", "live-gateway-record-title", record.displayLabel), createText(documentRoot, "span", "live-gateway-record-meta", meta)); button.addEventListener("click", () => selectRecord(record.id, type, "button")); return button; }
  function renderStage(element, records, type, emptyCopy) { element.replaceChildren(); if (!records.length) { element.appendChild(createText(documentRoot, "div", "live-gateway-empty", emptyCopy)); return; } records.forEach((record) => element.appendChild(recordButton(record, type))); }
  function publicStatusRow(status, { structured = false } = {}) {
    const row = documentRoot.createElement("div");
    row.className = `${structured ? "live-gateway-public-structured-row" : "live-gateway-public-status-row"} live-gateway-public-status-${status.state} live-gateway-public-freshness-${status.freshness}`;
    row.dataset.surfaceId = status.surfaceId;
    row.dataset.providerId = status.providerId ?? "";
    if (structured) row.dataset.structured = "true";
    row.append(
      createText(documentRoot, "strong", "live-gateway-public-status-title", `${status.surfaceLabel} · ${status.provider}`),
      createText(documentRoot, "span", "live-gateway-public-status-state", `STATE ${status.state.toUpperCase()} · FRESHNESS ${status.freshness.toUpperCase()}`),
      createText(documentRoot, "span", "live-gateway-public-status-time", `RETRIEVED ${status.retrievedAt ?? "UNAVAILABLE"} · OBSERVED ${status.observedAt ?? "UNAVAILABLE"}`),
      createText(documentRoot, "span", "live-gateway-public-status-count", `RECORDS ${status.recordCount}`),
    );
    const sourceUrl = publicSourceUrl(status.sourceUrl);
    if (sourceUrl) {
      const link = documentRoot.createElement("a");
      link.className = "live-gateway-public-status-url";
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `OPEN PUBLIC SOURCE · ${sourceUrl}`;
      row.appendChild(link);
    } else {
      row.appendChild(createText(documentRoot, "span", "live-gateway-public-status-url", "SOURCE URL UNAVAILABLE"));
    }
    // A failed request can still carry a safe provider documentation URL.
    // Surface that already-normalized provenance so the unavailable state is
    // actionable without fabricating a record or retrying behind the user's
    // back. Keep it separate from the request URL: documentation is context,
    // never evidence that the requested provider returned data.
    const documentationUrl = publicSourceUrl(status.documentationUrl);
    if (documentationUrl) {
      const documentationLink = documentRoot.createElement("a");
      documentationLink.className = "live-gateway-public-status-docs";
      documentationLink.href = documentationUrl;
      documentationLink.target = "_blank";
      documentationLink.rel = "noopener noreferrer";
      documentationLink.textContent = `OPEN PROVIDER DOCS · ${documentationUrl}`;
      row.appendChild(documentationLink);
    } else {
      row.appendChild(createText(documentRoot, "span", "live-gateway-public-status-docs", "PROVIDER DOCS UNAVAILABLE"));
    }
    row.appendChild(createText(documentRoot, "span", "live-gateway-public-status-reason", status.reason ?? "No provider reason returned."));
    return row;
  }

  function renderPublicStatus() {
    if (!publicStatusEl) return;
    publicStatusEl.replaceChildren();
    const structuredRendered = new Set();
    publicStatus.statuses.forEach((status) => {
      const row = publicStatusRow(status);
      if (status.surfaceId === "world-events" && !structuredRendered.has(status.surfaceId)) {
        const structuredStatuses = publicStatus.structuredStatuses.filter((candidate) => candidate.surfaceId === status.surfaceId);
        if (structuredStatuses.length) {
          const rail = documentRoot.createElement("div");
          rail.className = "live-gateway-public-structured-rail";
          rail.dataset.surfaceId = status.surfaceId;
          rail.dataset.structuredKind = "humanitarian";
          rail.appendChild(createText(documentRoot, "strong", "live-gateway-public-structured-label", "Structured humanitarian · UNHCR"));
          structuredStatuses.forEach((structuredStatus) => rail.appendChild(publicStatusRow(structuredStatus, { structured: true })));
          row.appendChild(rail);
          structuredRendered.add(status.surfaceId);
        }
      }
      publicStatusEl.appendChild(row);
    });
  }
  function renderPublicRefreshControls() {
    if (publicRefreshStatusEl) publicRefreshStatusEl.textContent = publicRefreshMessage;
    if (!publicRefreshEl) return;
    publicRefreshEl.replaceChildren();
    const allButton = documentRoot.createElement("button");
    allButton.type = "button";
    allButton.id = LIVE_GATEWAY_PUBLIC_REFRESH_ALL_DOM_ID;
    allButton.className = "live-gateway-public-refresh live-gateway-public-refresh-all";
    allButton.dataset.action = "refresh-all";
    allButton.textContent = "Refresh all public sources";
    allButton.disabled = publicRefreshSurfaceId !== null || publicRefreshBatchActive;
    allButton.addEventListener("click", () => { void refreshAllPublicSources("button"); });
    publicRefreshEl.appendChild(allButton);
    const autoButton = documentRoot.createElement("button");
    autoButton.type = "button";
    autoButton.id = "live-gateway-auto-refresh";
    autoButton.className = "live-gateway-public-refresh live-gateway-public-refresh-auto";
    autoButton.dataset.action = publicRefreshAutoEnabled ? "auto-refresh-stop" : "auto-refresh-start";
    autoButton.textContent = publicRefreshAutoEnabled
      ? `Stop auto-refresh · ${Math.round(LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS / 1000)}s`
      : `Start auto-refresh · ${Math.round(LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS / 1000)}s`;
    autoButton.disabled = publicRefreshSurfaceId !== null || publicRefreshBatchActive;
    autoButton.addEventListener("click", () => {
      if (publicRefreshAutoEnabled) stopAutoRefresh("button");
      else startAutoRefresh("button");
    });
    publicRefreshEl.appendChild(autoButton);
    LIVE_GATEWAY_PUBLIC_SURFACES.forEach((surface) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.id = `live-gateway-refresh-${surface.id}`;
      button.className = "live-gateway-public-refresh";
      button.dataset.surfaceId = surface.id;
      button.textContent = surface.refreshLabel;
      button.disabled = publicRefreshSurfaceId !== null || publicRefreshBatchActive;
      button.addEventListener("click", () => { void refreshPublicSource(surface.id, "button"); });
      publicRefreshEl.appendChild(button);
    });
  }
  function renderCurrent() { const record = selectedRecord(); if (!record) currentEl.textContent = "NO MOCK EVIDENCE RECORDS"; else if (selectedType === "evidence") currentEl.textContent = `${record.displayLabel} · ${record.degradedState.toUpperCase()} · UNCERTAINTY ${record.uncertainty} · NO PROVIDER`; else currentEl.textContent = `${record.displayLabel} · ${record.degradedState.toUpperCase()} · ${record.linkedEvidence.length} EVIDENCE LINK${record.linkedEvidence.length === 1 ? "" : "S"} · NON-AUTHORITATIVE`; statusEl.textContent = trace.length ? `READY · ${trace.length} LOCAL INSPECTION${trace.length === 1 ? "" : "S"} · NO LIVE DATA` : "READY · OBSERVE → UNCERTAINTY → AUTHORITY BOUNDARY · LOCAL ONLY"; replayButton.disabled = !record; resetButton.disabled = trace.length === 0 && selectedId === (summary.records[0]?.id ?? null); if (boundaryEl) boundaryEl.textContent = summary.boundary; }
  function renderTrace() { traceEl.replaceChildren(); if (!trace.length) { traceEl.appendChild(createText(documentRoot, "div", "live-gateway-empty", "No local inspection yet. Select an observation or interpretation.")); return; } trace.forEach((entry, index) => traceEl.appendChild(createText(documentRoot, "div", "live-gateway-trace-row", `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "all records"} · LOCAL ONLY`))); }
  function render() { renderSummary(); renderPublicStatus(); renderPublicRefreshControls(); renderStage(evidenceEl, summary.evidence, "evidence", "No mock observation is projected."); renderStage(interpretationsEl, summary.interpretations, "interpretation", "No mock interpretation is projected."); renderCurrent(); renderTrace(); }
  function selectRecord(recordId, type = "evidence", method = "button") { const record = recordsFor(type).find((candidate) => candidate.id === recordId); if (!record) return null; selectedType = type; selectedId = record.id; const snapshot = deepFreeze({ source: LIVE_GATEWAY_CONSOLE_SOURCE, action: "select", method, recordType: type, recordId: record.id, record, summary, localOnly: true, simulation: true, externalNetwork: false, externalProviders: false, providerCredentials: false, liveData: false, truthClaim: false, executable: false }); pushTrace({ action: "select", recordId: record.id, recordType: type }); render(); onSelect?.(snapshot); return snapshot; }
  function replay(method = "button") { const record = selectedRecord(); const linked = selectedType === "interpretation" ? record?.linkedEvidence?.map((item) => item.id) ?? [] : [record?.id].filter(Boolean); const snapshot = deepFreeze({ source: LIVE_GATEWAY_CONSOLE_SOURCE, action: "replay", method, recordType: selectedType, recordId: record?.id ?? null, sequence: ["observation", "uncertainty", "authority-boundary"], linkedEvidenceIds: linked, replayedRecordCount: summary.recordCount, record, summary, localOnly: true, simulation: true, externalNetwork: false, externalProviders: false, providerCredentials: false, liveData: false, truthClaim: false, executable: false }); pushTrace({ action: "replay", recordId: record?.id ?? null, recordType: selectedType }); render(); onReplay?.(snapshot); return snapshot; }
  function reset(method = "button") { if (publicRefreshAutoEnabled || publicRefreshAutoTimer !== null) stopAutoRefresh("reset"); selectedType = summary.evidence[0] ? "evidence" : "interpretation"; selectedId = summary[selectedType]?.[0]?.id ?? null; trace = []; const snapshot = deepFreeze({ source: LIVE_GATEWAY_CONSOLE_SOURCE, action: "reset", method, recordType: selectedType, recordId: selectedId, summary, publicSourceStatus: publicStatus, autoRefreshEnabled: publicRefreshAutoEnabled, autoRefreshTimerActive: publicRefreshAutoTimer !== null, localOnly: true, simulation: true, externalNetwork: false, externalProviders: false, providerCredentials: false, liveData: false, truthClaim: false, executable: false }); render(); onReset?.(snapshot); return snapshot; }
  function syncProjection(nextProjection) { summary = summarizeLiveGateway(nextProjection, { includeLegacyFixture }); if (!recordsFor(selectedType).some((record) => record.id === selectedId)) { selectedType = summary.evidence[0] ? "evidence" : "interpretation"; selectedId = summary[selectedType]?.[0]?.id ?? null; } render(); return getSnapshot(); }
  function buildPublicStatusIntent(action, method, surfaceId = null, options = {}) {
    const statuses = surfaceId ? publicStatus.statuses.filter((status) => status.surfaceId === surfaceId) : publicStatus.statuses;
    const structuredStatuses = surfaceId
      ? publicStatus.structuredStatuses.filter((status) => status.surfaceId === surfaceId)
      : publicStatus.structuredStatuses;
    return deepFreeze({ source: LIVE_GATEWAY_PUBLIC_STATUS_SOURCE, action, method, surfaceId, status: publicStatus.status, statuses, structuredStatuses, publicSourceStatus: publicStatus, readyCount: publicStatus.readyCount, freshCount: publicStatus.freshCount, partialCount: publicStatus.partialCount, unavailableCount: publicStatus.unavailableCount, staleCount: publicStatus.staleCount, providerCount: publicStatus.providerCount, autoRefreshEnabled: publicRefreshAutoEnabled, autoRefreshTickCount: publicRefreshAutoTickCount, autoRefreshLastTickAt: publicRefreshAutoLastTickAt, autoRefreshNextAt: publicRefreshAutoNextAt, autoRefreshIntervalMs: LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS, localOnly: true, simulation: true, externalNetwork: false, externalProviders: false, providerCredentials: false, liveData: false, truthClaim: false, truthAuthority: "none", executable: false, persistence: false, staleAfterMs: options.staleAfterMs ?? LIVE_GATEWAY_PUBLIC_STATUS_MAX_AGE_MS, autoRefreshReason: options.autoRefreshReason ?? null, autoRefreshWasActive: options.autoRefreshWasActive === true });
  }
  function syncPublicSourceStatus(surfaceId, snapshot, options = {}) {
    const surface = surfaceDefinition(surfaceId);
    publicSnapshots = { ...publicSnapshots, [surface.id]: snapshot };
    publicStatus = summarizePublicSourceStatuses(publicSnapshots, { now: options.now ?? new Date().toISOString(), staleAfterMs: options.staleAfterMs });
    if (publicRefreshBatchActive && publicRefreshBatch.requested.includes(surface.id)
      && !publicRefreshBatch.completed.some((entry) => entry?.surfaceId === surface.id)) {
      const completed = [
        ...publicRefreshBatch.completed,
        deepFreeze({ surfaceId: surface.id, action: "sync", finishedAt: Date.now() }),
      ];
      publicRefreshBatch = deepFreeze({ ...publicRefreshBatch, completed });
      publicRefreshMessage = `REFRESHING · ALL PUBLIC SOURCES · ${completed.length}/${publicRefreshBatch.requested.length} COMPLETE · SEQUENTIAL PUBLIC READ ONLY`;
    }
    renderPublicStatus();
    renderPublicRefreshControls();
    const intent = buildPublicStatusIntent("sync", options.method ?? "refresh", surface.id, options);
    onPublicSourceStatus?.(intent);
    return intent;
  }
  async function refreshPublicSource(surfaceId, method = "button", options = {}) {
    const surface = surfaceDefinition(surfaceId);
    if (!LIVE_GATEWAY_PUBLIC_SURFACES.some((candidate) => candidate.id === surface.id)) {
      const blocked = buildPublicStatusIntent("refresh-blocked", method, surface.id, optionsForRefresh("unknown-surface"));
      onPublicSourceStatus?.(blocked);
      return blocked;
    }
    if (publicRefreshSurfaceId !== null && options.batch !== true) return buildPublicStatusIntent("refresh-blocked", method, publicRefreshSurfaceId, optionsForRefresh("refresh-in-progress"));
    if (publicRefreshBatchActive && options.batch !== true) return buildPublicStatusIntent("refresh-blocked", method, null, optionsForRefresh("refresh-all-in-progress"));
    publicRefreshSurfaceId = surface.id;
    publicRefreshMessage = `REFRESHING · ${surface.label.toUpperCase()} · PUBLIC READ ONLY`;
    renderPublicRefreshControls();
    const request = buildPublicStatusIntent("refresh-request", method, surface.id, optionsForRefresh(null));
    onPublicSourceStatus?.(request);
    try {
      if (typeof onPublicRefresh !== "function") throw new Error("host refresh is unavailable");
      const result = await onPublicRefresh(surface.id, method);
      // A refresh control must not claim completion merely because a host
      // callback resolved. Require the callback to return the provider
      // envelope and mount that exact envelope here. Hosts may also sync it
      // themselves; re-normalizing the same in-memory payload is idempotent.
      if (!isRecord(result)) throw new Error("provider refresh returned no status envelope");
      syncPublicSourceStatus(surface.id, result, { method, now: new Date().toISOString() });
      publicRefreshMessage = `REFRESH COMPLETE · ${surface.label.toUpperCase()} · ROWS STAY PROVIDER-RETURNED`;
      return request;
    } catch (error) {
      publicRefreshMessage = `REFRESH FAILED · ${surface.label.toUpperCase()} · ${text(error?.message ?? error, "provider unavailable")}`;
      return deepFreeze({ ...request, action: "refresh-failed", reason: text(error?.message ?? error, "provider unavailable") });
    } finally {
      if (publicRefreshBatchActive && options.batch === true
        && publicRefreshBatch.requested.includes(surface.id)
        && !publicRefreshBatch.completed.some((entry) => entry?.surfaceId === surface.id)) {
        const completed = [
          ...publicRefreshBatch.completed,
          deepFreeze({ surfaceId: surface.id, action: "refresh-settled", finishedAt: Date.now() }),
        ];
        publicRefreshBatch = deepFreeze({ ...publicRefreshBatch, completed });
        publicRefreshMessage = `REFRESHING · ALL PUBLIC SOURCES · ${completed.length}/${publicRefreshBatch.requested.length} COMPLETE · SEQUENTIAL PUBLIC READ ONLY`;
      }
      publicRefreshSurfaceId = null;
      renderPublicRefreshControls();
    }
  }
  function optionsForRefresh(reason) { return { refreshSurfaceId: publicRefreshSurfaceId, refreshReason: reason }; }
  function aggregateRefreshMessage(prefix = "REFRESH COMPLETE") {
    const freshCount = publicStatus.freshCount ?? publicStatus.statuses.filter((status) => status.freshness === "fresh").length;
    const aggregate = text(publicStatus.status, "unavailable").toUpperCase();
    return `${prefix} · ALL PUBLIC SOURCES · AGGREGATE ${aggregate} · FRESH ${freshCount} · PARTIAL ${publicStatus.partialCount} · UNAVAILABLE ${publicStatus.unavailableCount} · STALE ${publicStatus.staleCount} · PROVIDER ROWS ${publicStatus.providerCount} · PROVENANCE VISIBLE${autoRefreshSuffix()}`;
  }
  async function refreshAllPublicSources(method = "button") {
    const autoMethod = String(method).toLowerCase().startsWith("auto-refresh");
    if (!autoMethod && publicRefreshAutoEnabled) clearAutoRefreshTimer();
    if (publicRefreshBatchActive || publicRefreshSurfaceId !== null) {
      const blocked = buildPublicStatusIntent("refresh-all-blocked", method, null, optionsForRefresh("refresh-in-progress"));
      onPublicSourceStatus?.(blocked);
      return blocked;
    }
    const requested = LIVE_GATEWAY_PUBLIC_SURFACES.map((surface) => surface.id);
    const startedAt = Date.now();
    publicRefreshBatchActive = true;
    publicRefreshBatch = deepFreeze({ active: true, all: true, method, requested, completed: [], startedAt, finishedAt: null });
    publicRefreshMessage = `REFRESHING · ALL PUBLIC SOURCES · 0/${requested.length} COMPLETE · SEQUENTIAL PUBLIC READ ONLY`;
    renderPublicRefreshControls();
    const request = buildPublicStatusIntent("refresh-all-request", method, null, { batch: publicRefreshBatch });
    onPublicSourceStatus?.(request);
    try {
      if (typeof onPublicRefreshAll !== "function") throw new Error("host all-sources refresh is unavailable");
      const result = await onPublicRefreshAll(method);
      const completed = Array.isArray(result?.completed)
        ? result.completed
        : publicRefreshBatch.completed;
      publicRefreshBatch = deepFreeze({ ...publicRefreshBatch, active: false, completed, finishedAt: Date.now() });
      publicRefreshMessage = aggregateRefreshMessage("REFRESH COMPLETE");
      const complete = deepFreeze({
        ...request,
        action: "refresh-all-complete",
        batch: publicRefreshBatch,
        aggregate: publicStatus,
      });
      onPublicSourceStatus?.(complete);
      return complete;
    } catch (error) {
      publicRefreshBatch = deepFreeze({ ...publicRefreshBatch, active: false, finishedAt: Date.now() });
      const reason = text(error?.message ?? error, "provider unavailable");
      publicRefreshMessage = aggregateRefreshMessage(`REFRESH FAILED · ${reason}`);
      const failed = deepFreeze({
        ...request,
        action: "refresh-all-failed",
        reason,
        batch: publicRefreshBatch,
        aggregate: publicStatus,
      });
      onPublicSourceStatus?.(failed);
      return failed;
    } finally {
      publicRefreshBatchActive = false;
      renderPublicRefreshControls();
      if (publicRefreshAutoEnabled && opened && !autoMethod) scheduleAutoRefresh();
    }
  }
  function syncPublicSources(nextSnapshots = {}, options = {}) {
    const entries = nextSnapshots instanceof Map ? [...nextSnapshots.entries()] : isRecord(nextSnapshots) ? Object.entries(nextSnapshots) : [];
    publicSnapshots = { ...publicSnapshots, ...Object.fromEntries(entries) };
    publicStatus = summarizePublicSourceStatuses(publicSnapshots, { now: options.now ?? new Date().toISOString(), staleAfterMs: options.staleAfterMs });
    renderPublicStatus();
    const intent = buildPublicStatusIntent("sync-all", options.method ?? "refresh", null, options);
    onPublicSourceStatus?.(intent);
    return intent;
  }
  function getSnapshot() { return deepFreeze({ source: LIVE_GATEWAY_CONSOLE_SOURCE, summary, selectedType, selectedId, selectedRecord: selectedRecord(), publicSourceStatus: publicStatus, publicStatuses: publicStatus.statuses, structuredPublicStatuses: publicStatus.structuredStatuses, publicRefreshBatch, publicRefreshBatchActive, publicRefreshMessage, publicRefreshAutoEnabled, publicRefreshAutoTickCount, publicRefreshAutoLastTickAt, publicRefreshAutoNextAt, publicRefreshAutoTimerActive: publicRefreshAutoTimer !== null, publicRefreshAutoIntervalMs: LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS, opened, trace, localOnly: true, simulation: true, externalNetwork: false, externalProviders: false, providerCredentials: false, liveData: false, truthClaim: false, executable: false, boundary: summary.boundary }); }
  closeButton.addEventListener("click", () => setOpen(false)); replayButton.addEventListener("click", () => replay("button")); resetButton.addEventListener("click", () => reset("button")); documentRoot.addEventListener?.("keydown", (event) => { if (event.key === "Escape" && opened) setOpen(false); }); render(); setOpen(opened);
  return Object.freeze({ open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen(!opened), selectRecord, selectEvidence: (id, method) => selectRecord(id, "evidence", method), selectInterpretation: (id, method) => selectRecord(id, "interpretation", method), replay, reset, syncProjection, setProjection: syncProjection, syncPublicSourceStatus, syncPublicSources, setPublicSourceStatus: syncPublicSourceStatus, refreshPublicSource, refreshAllPublicSources, startAutoRefresh, stopAutoRefresh, getSnapshot, destroy: () => { stopAutoRefresh("destroy", false); } });
}
export const createLiveGatewayLayer = createLiveGatewayConsole;
export const createGatewayEvidenceConsole = createLiveGatewayConsole;
export default createLiveGatewayConsole;
