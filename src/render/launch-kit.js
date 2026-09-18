/**
 * Local Launch Kit console.
 *
 * This adapter makes the portable Launch Kit visible in the demo. It is a
 * renderer-only view over the frozen domain manifest: route buttons hand
 * control back to Mission Control, replay only re-renders the manifest, and
 * Download Launch Kit is a user-triggered browser export of validated JSON.
 * Nothing in this module contacts a network, imports a file, executes a
 * command, connects a wallet, or creates distribution authority.
 */
import {
  DEFAULT_LAUNCH_KIT,
  LAUNCH_KIT_DOWNLOAD_FILENAME,
  serializeLaunchKit,
  summarizeLaunchKit,
  validateLaunchKit,
} from "../domains/launch-kit.js";

export const LAUNCH_KIT_CONSOLE_SOURCE = "launch-kit-console";
export const LAUNCH_KIT_RENDER_SOURCE = LAUNCH_KIT_CONSOLE_SOURCE;
export const LAUNCH_KIT_BOUNDARY = "Launch Kit is a deterministic local manifest for the maTumbo social-experiment preview; there are no recipient records or authority here. It cannot issue or distribute a real asset, contact a network, connect a wallet, execute code, persist state, or launch external services. Download is a user-triggered local JSON export only.";
// The share handoff is deliberately the explicit seven-source status route.
// `live=all` asks the already-mounted adapters for one sequential public read
// when the recipient opens the link; there is no hidden polling or deployment
// claim. Keep the older export name as an alias so existing callers/tests do
// not silently drift to the former cube-first Launch Kit route.
export const LAUNCH_KIT_LIVE_STATUS_ROUTE_QUERY = "?build=control4&fresh=20260903-reality-lens&panel=live-status&live=all&journey=launch-kit-live-status";
export const LAUNCH_KIT_LOCAL_ROUTE_QUERY = LAUNCH_KIT_LIVE_STATUS_ROUTE_QUERY;
export const LAUNCH_KIT_LIVE_STATUS_ROUTE_COPY = "Live status link · 7 public sources · refresh once on open";
export const LAUNCH_KIT_DOM_IDS = Object.freeze({
  panel: "launch-kit-console",
  close: "launch-kit-close",
  replay: "launch-kit-replay",
  reset: "launch-kit-reset",
  download: "launch-kit-download",
  shareUrl: "launch-kit-share-url",
  copyLink: "launch-kit-copy-link",
  copyStatus: "launch-kit-copy-status",
  missionControl: "launch-kit-mission-control",
  status: "launch-kit-status",
  summary: "launch-kit-summary",
  routes: "launch-kit-routes",
  token: "launch-kit-token",
  migration: "launch-kit-migration",
  social: "launch-kit-social",
  devices: "launch-kit-devices",
  json: "launch-kit-json",
  boundary: "launch-kit-boundary",
});

const integerFormatter = new Intl.NumberFormat("en-US");

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

/**
 * Build the one-click handoff for the local demo without carrying through
 * arbitrary query state. The route opens the seven-source public status
 * dashboard and performs its explicit `live=all` refresh once on open. It is
 * still a local route; origin and pathname come from the current local host
 * (or remain relative when no origin is available).
 */
export function buildLaunchKitLocalRoute(windowLike = globalThis.window ?? globalThis) {
  const location = windowLike?.location ?? windowLike ?? globalThis.location;
  const origin = typeof location?.origin === "string" && location.origin !== "null"
    ? location.origin.replace(/\/+$/, "")
    : "";
  let pathname = typeof location?.pathname === "string" && location.pathname ? location.pathname : "/";
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  return `${origin}${pathname}${LAUNCH_KIT_LOCAL_ROUTE_QUERY}`;
}

function formatInteger(value) {
  return Number.isSafeInteger(value) ? integerFormatter.format(value) : text(value);
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freeze(entry)));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freeze(entry)])));
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function requireMount(documentRoot) {
  const ids = LAUNCH_KIT_DOM_IDS;
  const elements = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, documentRoot.getElementById(id)]));
  const required = ["panel", "close", "replay", "reset", "download", "missionControl", "status", "summary", "routes", "token", "migration", "social", "devices", "json"];
  if (required.some((key) => !elements[key])) throw new Error("Launch Kit console mount points are missing");
  return elements;
}

function renderMetric(documentRoot, value, label) {
  const metric = documentRoot.createElement("div");
  metric.className = "launch-kit-metric";
  metric.append(
    createText(documentRoot, "b", "launch-kit-metric-value", typeof value === "number" ? formatInteger(value) : value),
    createText(documentRoot, "span", "launch-kit-metric-label", label),
  );
  return metric;
}

function renderRows(documentRoot, mount, rows, emptyText, rowClass = "launch-kit-row") {
  mount.replaceChildren();
  if (!rows.length) {
    mount.appendChild(createText(documentRoot, "div", "launch-kit-empty", emptyText));
    return;
  }
  rows.forEach((row) => {
    const element = documentRoot.createElement("div");
    element.className = rowClass;
    const values = Array.isArray(row) ? row : [row?.label ?? row?.id, row?.value ?? row?.status ?? row?.kicker];
    element.append(
      createText(documentRoot, "strong", "launch-kit-row-primary", values[0]),
      createText(documentRoot, "span", "launch-kit-row-secondary", values.slice(1).filter(Boolean).join(" · ")),
    );
    mount.appendChild(element);
  });
}

/**
 * Mount the Launch Kit console into an existing document.
 *
 * The returned callbacks carry frozen metadata so the host can emit its
 * projection intent and decide how Mission Control should focus the route.
 */
export function createLaunchKitConsole({
  documentRoot = globalThis.document,
  kit = DEFAULT_LAUNCH_KIT,
  onRoute = null,
  onReplay = null,
  onReset = null,
  onDownload = null,
  onCopy = null,
  windowLike = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Launch Kit console needs a document-like owner");
  const elements = requireMount(documentRoot);
  const validatedKit = validateLaunchKit(kit);
  let currentKit = validatedKit;
  let summary = summarizeLaunchKit(currentKit);
  let opened = elements.panel.hidden !== true;
  let replayCount = 0;
  let selectedRouteId = null;
  let lastDownload = null;
  let lastReplay = null;
  let lastReset = null;
  let lastCopy = null;
  const runtime = windowLike ?? documentRoot.defaultView ?? globalThis;
  const localLaunchRoute = buildLaunchKitLocalRoute(runtime);

  function setOpen(next) {
    opened = Boolean(next);
    elements.panel.hidden = !opened;
    elements.panel.classList?.toggle?.("visible", opened);
    elements.panel.setAttribute?.("aria-hidden", String(!opened));
  }

  function renderSummary() {
    elements.summary.replaceChildren();
    [
      [summary.featureCount, "openable features"],
      [summary.allocationCount, "allocation cohorts"],
      [summary.registryCount, "registry rows"],
      [summary.migrationCount, "migration mappings"],
      [summary.socialActionCount, "social intents"],
      [summary.deviceCount, "device profiles"],
    ].forEach(([value, label]) => elements.summary.appendChild(renderMetric(documentRoot, value, label)));
  }

  function renderRoutes() {
    elements.routes.replaceChildren();
    currentKit.features.forEach((feature) => {
      const item = documentRoot.createElement("button");
      item.type = "button";
      item.className = "launch-kit-route";
      item.dataset.featureId = feature.id;
      item.setAttribute?.("aria-pressed", String(feature.id === selectedRouteId));
      item.append(
        createText(documentRoot, "strong", "launch-kit-route-title", `${String(feature.ordinal).padStart(2, "0")} · ${feature.label}`),
        createText(documentRoot, "span", "launch-kit-route-meta", `${feature.kicker} · ${feature.route}`),
      );
      item.addEventListener("click", () => selectRoute(feature.id, "button"));
      elements.routes.appendChild(item);
    });
  }

  function renderCatalogs() {
    renderRows(
      documentRoot,
      elements.token,
      [
        ["TUMBO Asset Token · fixed supply", `${formatInteger(currentKit.token.totalSupply)} ${currentKit.token.unit}`],
        ["allocation classes", `${currentKit.token.allocationCount} cohorts · ${formatInteger(currentKit.token.allocationBasisPoints)} bp`],
        ["registry", `${currentKit.token.registryCount} aggregate rows · ${formatInteger(currentKit.token.registryUnits)} units`],
        ["reconciliation", currentKit.token.allocationSummary?.complete === true
          ? `${formatInteger(currentKit.token.registryBasisPoints)} / ${formatInteger(currentKit.token.totalBasisPoints)} bp · ${formatInteger(currentKit.token.registryUnits)} / ${formatInteger(currentKit.token.totalSupply)} units · verified`
          : "requires review"],
        ["coverage", (currentKit.token.allocationSummary?.classes ?? []).map((allocation) => allocation.label).join(" · ")],
        ["authority", "fictional aggregate preview · no wallet / transfer"],
      ],
      "No token manifest is available.",
    );
    renderRows(
      documentRoot,
      elements.migration,
      currentKit.migration.entries.map((entry) => [entry.label, `${entry.mappingKind} · ${entry.mappingStatus}${entry.safeToApply ? " · safe preview" : " · deferred"}`]),
      "No migration mappings are available.",
    );
    renderRows(
      documentRoot,
      elements.social,
      [
        ["rooms", `${currentKit.social.roomCount} fictional rooms`],
        ["creator cards", `${currentKit.social.creatorCardCount} community cards`],
        ["signals", `${currentKit.social.discoverySignalCount} discovery signals`],
        ["actions", `${currentKit.social.actionCount} local discover → reuse actions`],
      ],
      "No social catalog is available.",
    );
    renderRows(
      documentRoot,
      elements.devices,
      currentKit.devices.map((device) => [device.label, `${device.viewport} · ${device.input} · XR ${device.xr}`]),
      "No device profiles are available.",
    );
  }

  function render() {
    renderSummary();
    renderRoutes();
    renderCatalogs();
    elements.json.textContent = serializeLaunchKit(currentKit);
    if (elements.shareUrl) {
      elements.shareUrl.value = localLaunchRoute;
      elements.shareUrl.textContent = localLaunchRoute;
      elements.shareUrl.setAttribute?.("value", localLaunchRoute);
    }
    if (elements.copyStatus) {
      elements.copyStatus.textContent = lastCopy?.status === "copied"
        ? "LINK COPIED · LOCAL ONLY"
        : lastCopy?.status === "unavailable"
          ? "LINK VISIBLE · COPY UNAVAILABLE"
          : "LINK VISIBLE · COPY MANUALLY";
    }
    elements.status.textContent = lastDownload?.status === "downloaded"
      ? "DOWNLOADED · LOCAL JSON · NO EXTERNAL LAUNCH"
      : lastDownload?.status === "unavailable"
        ? "DOWNLOAD UNAVAILABLE · JSON REMAINS VISIBLE"
        : lastDownload?.status === "rejected"
          ? "DOWNLOAD BLOCKED · VALIDATION FAILED"
          : lastReplay
            ? `REPLAYED · LOCAL MANIFEST #${replayCount} · NO NETWORK`
            : `READY · ${summary.featureCount} FEATURES · LOCAL ONLY`;
    if (elements.boundary) elements.boundary.textContent = LAUNCH_KIT_BOUNDARY;
  }

  function selectRoute(featureId, method = "button") {
    const feature = currentKit.features.find((candidate) => candidate.id === featureId);
    if (!feature) return null;
    selectedRouteId = feature.id;
    renderRoutes();
    const snapshot = freeze({
      source: LAUNCH_KIT_CONSOLE_SOURCE,
      action: "route",
      method,
      featureId: feature.id,
      label: feature.label,
      route: feature.route,
      localOnly: true,
      simulation: true,
      executable: false,
      externalNetwork: false,
      externalTransfer: false,
    });
    onRoute?.(snapshot);
    return snapshot;
  }

  function replay(method = "button") {
    replayCount += 1;
    lastReplay = freeze({
      source: LAUNCH_KIT_CONSOLE_SOURCE,
      action: "replay",
      method,
      replayCount,
      kitId: currentKit.id,
      featureCount: summary.featureCount,
      localOnly: true,
      simulation: true,
      executable: false,
      externalNetwork: false,
      externalTransfer: false,
    });
    lastDownload = null;
    lastReset = null;
    lastCopy = null;
    render();
    onReplay?.(lastReplay);
    return lastReplay;
  }

  function reset(method = "button") {
    selectedRouteId = null;
    replayCount = 0;
    lastDownload = null;
    lastReplay = null;
    lastCopy = null;
    lastReset = freeze({
      source: LAUNCH_KIT_CONSOLE_SOURCE,
      action: "reset",
      method,
      kitId: currentKit.id,
      localOnly: true,
      simulation: true,
      executable: false,
      externalNetwork: false,
      externalTransfer: false,
    });
    render();
    onReset?.(lastReset);
    return lastReset;
  }

  async function copyLocalLink(method = "button") {
    const clipboard = runtime?.navigator?.clipboard;
    const writeText = clipboard?.writeText;
    let status = "manual";
    if (typeof writeText === "function") {
      try {
        await writeText.call(clipboard, localLaunchRoute);
        status = "copied";
      } catch {
        status = "unavailable";
      }
    }
    lastCopy = freeze({
      source: LAUNCH_KIT_CONSOLE_SOURCE,
      action: "copy-local-link",
      method,
      status,
      route: localLaunchRoute,
      url: localLaunchRoute,
      copied: status === "copied",
      localOnly: true,
      simulation: true,
      executable: false,
      externalNetwork: false,
      externalTransfer: false,
    });
    render();
    onCopy?.(lastCopy);
    return lastCopy;
  }

  function download(method = "button") {
    const validation = validateLaunchKit(JSON.parse(serializeLaunchKit(currentKit)));
    const base = {
      source: LAUNCH_KIT_CONSOLE_SOURCE,
      action: "download",
      method,
      kitId: currentKit.id,
      filename: LAUNCH_KIT_DOWNLOAD_FILENAME,
      localOnly: true,
      simulation: true,
      executable: false,
      externalNetwork: false,
      externalTransfer: false,
    };
    if (!validation) {
      lastDownload = freeze({ ...base, status: "rejected", reason: "validation-failed", validated: false, bytes: 0 });
      render();
      onDownload?.(lastDownload);
      return lastDownload;
    }
    const payload = serializeLaunchKit(validation);
    const runtime = windowLike ?? documentRoot.defaultView ?? globalThis;
    const BlobCtor = runtime?.Blob;
    const URLApi = runtime?.URL;
    let objectUrl = null;
    let revoked = false;
    const revoke = () => {
      if (revoked || !objectUrl || typeof URLApi?.revokeObjectURL !== "function") return;
      revoked = true;
      try { URLApi.revokeObjectURL(objectUrl); } catch { /* cleanup is best effort */ }
    };
    try {
      if (typeof BlobCtor !== "function" || !URLApi || typeof URLApi.createObjectURL !== "function") throw new Error("download APIs unavailable");
      const anchor = documentRoot.createElement?.("a");
      if (!anchor || typeof anchor.click !== "function") throw new Error("download anchor unavailable");
      objectUrl = URLApi.createObjectURL(new BlobCtor([payload], { type: "application/json;charset=utf-8" }));
      if (typeof objectUrl !== "string" || !objectUrl) throw new Error("download URL unavailable");
      anchor.href = objectUrl;
      anchor.download = LAUNCH_KIT_DOWNLOAD_FILENAME;
      anchor.rel = "noopener";
      anchor.setAttribute?.("download", LAUNCH_KIT_DOWNLOAD_FILENAME);
      anchor.setAttribute?.("aria-label", "Download local maTumbo Launch Kit JSON");
      anchor.click();
      if (typeof runtime?.setTimeout === "function") runtime.setTimeout(revoke, 0);
      else revoke();
      lastDownload = freeze({ ...base, status: "downloaded", reason: "user-triggered-local-json", validated: true, bytes: payload.length });
    } catch {
      revoke();
      lastDownload = freeze({ ...base, status: "unavailable", reason: "browser-download-unavailable", validated: true, bytes: 0 });
    }
    render();
    onDownload?.(lastDownload);
    return lastDownload;
  }

  function setKit(nextKit) {
    currentKit = validateLaunchKit(nextKit);
    summary = summarizeLaunchKit(currentKit);
    selectedRouteId = null;
    lastDownload = null;
    lastReplay = null;
    lastReset = null;
    lastCopy = null;
    replayCount = 0;
    render();
    return getSnapshot();
  }

  function getSnapshot() {
    return freeze({
      source: LAUNCH_KIT_CONSOLE_SOURCE,
      kit: currentKit,
      summary,
      opened,
      selectedRouteId,
      replayCount,
      lastReplay,
      lastReset,
      lastDownload,
      lastCopy,
      localLaunchRoute,
      liveStatusRoute: true,
      liveStatusRefresh: "opt-in-on-open",
      copyStatus: lastCopy?.status ?? "manual",
      localOnly: true,
      simulation: true,
      executable: false,
      externalNetwork: false,
      externalTransfer: false,
      boundary: LAUNCH_KIT_BOUNDARY,
    });
  }

  elements.close.addEventListener("click", () => setOpen(false));
  elements.replay.addEventListener("click", () => replay("button"));
  elements.reset.addEventListener("click", () => reset("button"));
  elements.download.addEventListener("click", () => download("button"));
  elements.copyLink?.addEventListener("click", () => { void copyLocalLink("button"); });
  elements.missionControl.addEventListener("click", () => onRoute?.(freeze({
    source: LAUNCH_KIT_CONSOLE_SOURCE,
    action: "mission-control",
    method: "button",
    featureId: null,
    route: "?feature=reality-lens",
    localOnly: true,
    simulation: true,
    executable: false,
    externalNetwork: false,
    externalTransfer: false,
  })));
  documentRoot.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false);
  });
  render();
  setOpen(opened);

  return Object.freeze({
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!opened),
    replay,
    reset,
    download,
    copyLocalLink,
    selectRoute,
    setKit,
    setProjection: setKit,
    validate: (input) => validateLaunchKit(input),
    serialize: () => serializeLaunchKit(currentKit),
    getSnapshot,
  });
}

export default createLaunchKitConsole;
