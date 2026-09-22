import { DEVICE_PROJECTION_SCHEMA_VERSION } from "../projections/device-projection.js?v=20260922-cache2";

export const DEVICE_PROJECTION_CONSOLE_SOURCE = "device-projection-console";
export const DEVICE_PROJECTION_RENDER_SOURCE = DEVICE_PROJECTION_CONSOLE_SOURCE;
const DEFAULT_BOUNDARY = "Phone and PC presentation metadata are local only. XR/WebXR sessions, shared parity, external sync, and device authority are not established.";

const freeze = (value) => Object.freeze(value);
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function deepFreeze(value) {
  if (Array.isArray(value)) { value.forEach((entry) => deepFreeze(entry)); return freeze(value); }
  if (!isRecord(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return freeze(value);
}
function text(value, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function asRecord(value) { return isRecord(value) ? value : {}; }
function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

/**
 * Turn the current presentation metadata into three inspectable local device
 * profiles. Every profile still points at the same canonical world; the
 * profiles only describe how a renderer could present it.
 */
export function summarizeDeviceProjection(deviceProjection) {
  const projection = asRecord(deviceProjection);
  const presentation = asRecord(projection.presentation);
  const viewport = asRecord(presentation.viewport);
  const accessibility = asRecord(presentation.accessibility);
  const input = asRecord(presentation.input);
  const xr = asRecord(presentation.xr);
  const world = asRecord(projection.world);
  const devices = [
    deepFreeze({
      id: "phone",
      label: "Phone",
      mode: "compact",
      status: "fallback-ready",
      detail: "Compact layout · coarse input · reduced-motion aware",
      viewport: "compact",
      input: "pointer-coarse / touch fallback",
      motion: accessibility.motion ?? "unknown",
      parity: "same canonical world",
      xr: false,
    }),
    deepFreeze({
      id: "pc",
      label: "PC",
      mode: "expanded",
      status: "pointer-ready",
      detail: "Expanded layout · hover + drag orbit · keyboard shortcuts",
      viewport: "expanded",
      input: "pointer-fine / keyboard",
      motion: accessibility.motion ?? "unknown",
      parity: "same canonical world",
      xr: false,
    }),
    deepFreeze({
      id: "xr",
      label: "XR",
      mode: "not-tested",
      status: "fallback-only",
      detail: "WebXR session is not established in this preview",
      viewport: "not-tested",
      input: "no XR session",
      motion: "reduced until verified",
      parity: "unverified",
      xr: false,
    }),
  ];
  const selectedDeviceId = viewport.class === "compact" ? "phone" : "pc";
  return deepFreeze({
    source: DEVICE_PROJECTION_CONSOLE_SOURCE,
    schemaVersion: DEVICE_PROJECTION_SCHEMA_VERSION,
    projectedAt: projection.projectedAt ?? null,
    devices,
    selectedDeviceId,
    viewport: deepFreeze({
      width: viewport.width ?? null,
      height: viewport.height ?? null,
      class: viewport.class ?? "unknown",
      orientation: viewport.orientation ?? "unknown",
    }),
    accessibility: deepFreeze({
      motion: accessibility.motion ?? "unknown",
      contrast: accessibility.contrast ?? "unknown",
      colorScheme: accessibility.colorScheme ?? "unknown",
      textScale: accessibility.textScale ?? 1,
    }),
    input: deepFreeze({ mode: input.mode ?? "unknown", coarse: input.coarse === true }),
    xr: deepFreeze({
      enabled: xr.enabled === true,
      status: xr.status ?? "not-tested",
      supportClaim: xr.supportClaim === true,
    }),
    canonicalEntityCount: Array.isArray(world.entities) ? world.entities.length : 0,
    canonicalContributionCount: Array.isArray(world.contributions) ? world.contributions.length : 0,
    simulation: true,
    localOnly: true,
    sharedState: false,
    externalNetwork: false,
    xrSession: false,
    persistence: false,
    executable: false,
    parityClaim: false,
    boundary: DEFAULT_BOUNDARY,
  });
}

export function createDeviceProjectionConsole({ documentRoot = globalThis.document, projection = null, onSelect = null, onReplay = null, onReset = null } = {}) {
  if (!documentRoot?.getElementById) throw new Error("Device projection console needs a document-like owner");
  const panel = documentRoot.getElementById("device-projection-console");
  const closeButton = documentRoot.getElementById("device-projection-close");
  const replayButton = documentRoot.getElementById("device-projection-replay");
  const resetButton = documentRoot.getElementById("device-projection-reset");
  const statusEl = documentRoot.getElementById("device-projection-status");
  const summaryEl = documentRoot.getElementById("device-projection-summary");
  const currentEl = documentRoot.getElementById("device-projection-current");
  const devicesEl = documentRoot.getElementById("device-projection-devices");
  const parityEl = documentRoot.getElementById("device-projection-parity");
  const traceEl = documentRoot.getElementById("device-projection-trace");
  const boundaryEl = documentRoot.getElementById("device-projection-boundary");
  if (!panel || !closeButton || !replayButton || !resetButton || !statusEl || !summaryEl || !currentEl || !devicesEl || !parityEl || !traceEl) {
    throw new Error("Device projection console mount points are missing");
  }

  let summary = summarizeDeviceProjection(projection);
  let selectedId = summary.selectedDeviceId;
  let opened = panel.hidden !== true;
  let trace = [];

  function selectedDevice() { return summary.devices.find((device) => device.id === selectedId) ?? summary.devices[0] ?? null; }
  function setOpen(next) { opened = Boolean(next); panel.hidden = !opened; panel.classList?.toggle?.("visible", opened); panel.setAttribute?.("aria-hidden", String(!opened)); }
  function pushTrace(entry) {
    trace = [deepFreeze({ ...entry, localOnly: true, simulation: true, sharedState: false, externalNetwork: false, xrSession: false, executable: false }), ...trace].slice(0, 12);
  }
  function renderSummary() {
    summaryEl.replaceChildren();
    [
      [summary.devices.length, "profiles"],
      [summary.canonicalEntityCount, "world entities"],
      [summary.canonicalContributionCount, "contributions"],
      [summary.xr.status, "XR status"],
    ].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div");
      metric.className = "device-projection-metric";
      metric.append(createText(documentRoot, "b", "device-projection-metric-value", value), createText(documentRoot, "span", "device-projection-metric-label", label));
      summaryEl.appendChild(metric);
    });
  }
  function renderDevices() {
    devicesEl.replaceChildren();
    summary.devices.forEach((device) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "device-projection-record";
      button.dataset.deviceId = device.id;
      button.setAttribute("aria-pressed", String(device.id === selectedId));
      button.append(createText(documentRoot, "strong", "device-projection-record-title", `${device.label} · ${device.status}`), createText(documentRoot, "span", "device-projection-record-meta", device.detail));
      button.addEventListener("click", () => selectDevice(device.id, "button"));
      devicesEl.appendChild(button);
    });
  }
  function renderParity() {
    parityEl.replaceChildren();
    [
      ["canonical view", `${summary.canonicalEntityCount} entities · ${summary.canonicalContributionCount} contributions`],
      ["current viewport", `${summary.viewport.class} · ${summary.viewport.orientation} · ${summary.viewport.width ?? "?"}×${summary.viewport.height ?? "?"}`],
      ["accessibility", `${summary.accessibility.motion} motion · ${summary.accessibility.contrast} contrast · ${summary.accessibility.colorScheme}`],
      ["XR boundary", `${summary.xr.status} · no session · no parity claim`],
    ].forEach(([label, value]) => {
      const row = documentRoot.createElement("div");
      row.className = "device-projection-parity-row";
      row.append(createText(documentRoot, "strong", "device-projection-parity-label", label), createText(documentRoot, "span", "device-projection-parity-value", value));
      parityEl.appendChild(row);
    });
  }
  function renderCurrent() {
    const device = selectedDevice();
    currentEl.textContent = device ? `${device.label.toUpperCase()} · ${device.status.toUpperCase()} · ${device.parity.toUpperCase()}` : "NO DEVICE PROFILE";
    statusEl.textContent = trace.length ? `READY · ${trace.length} LOCAL INSPECTION${trace.length === 1 ? "" : "S"} · NO XR SESSION` : "READY · ONE CANONICAL WORLD · LOCAL DEVICE PROFILES";
    replayButton.disabled = !device;
    resetButton.disabled = trace.length === 0 && selectedId === summary.selectedDeviceId;
    if (boundaryEl) boundaryEl.textContent = summary.boundary;
  }
  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) { traceEl.appendChild(createText(documentRoot, "div", "device-projection-empty", "No device inspection yet. Select a profile to inspect its fallback.")); return; }
    trace.forEach((entry, index) => traceEl.appendChild(createText(documentRoot, "div", "device-projection-trace-row", `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.deviceId ?? "all profiles"} · LOCAL ONLY`)));
  }
  function render() { renderSummary(); renderDevices(); renderParity(); renderCurrent(); renderTrace(); }
  function selectDevice(deviceId, method = "button") {
    const device = summary.devices.find((candidate) => candidate.id === deviceId);
    if (!device) return null;
    selectedId = device.id;
    const snapshot = deepFreeze({ source: DEVICE_PROJECTION_CONSOLE_SOURCE, action: "select", method, deviceId: device.id, device, summary, localOnly: true, simulation: true, sharedState: false, externalNetwork: false, xrSession: false, executable: false });
    pushTrace({ action: "select", deviceId: device.id });
    render();
    onSelect?.(snapshot);
    return snapshot;
  }
  function replay(method = "button") {
    const device = selectedDevice();
    const snapshot = deepFreeze({ source: DEVICE_PROJECTION_CONSOLE_SOURCE, action: "replay", method, deviceId: device?.id ?? null, sequence: ["canonical-world", "device-profile", "fallback-boundary"], replayedProfileCount: summary.devices.length, device, summary, localOnly: true, simulation: true, sharedState: false, externalNetwork: false, xrSession: false, executable: false });
    pushTrace({ action: "replay", deviceId: device?.id ?? null });
    render();
    onReplay?.(snapshot);
    return snapshot;
  }
  function reset(method = "button") {
    selectedId = summary.selectedDeviceId;
    trace = [];
    const snapshot = deepFreeze({ source: DEVICE_PROJECTION_CONSOLE_SOURCE, action: "reset", method, deviceId: selectedId, summary, localOnly: true, simulation: true, sharedState: false, externalNetwork: false, xrSession: false, executable: false });
    render();
    onReset?.(snapshot);
    return snapshot;
  }
  function syncProjection(nextProjection) {
    summary = summarizeDeviceProjection(nextProjection);
    if (!summary.devices.some((device) => device.id === selectedId)) selectedId = summary.selectedDeviceId;
    render();
    return getSnapshot();
  }
  function getSnapshot() { return deepFreeze({ source: DEVICE_PROJECTION_CONSOLE_SOURCE, summary, selectedId, selectedDevice: selectedDevice(), opened, trace, localOnly: true, simulation: true, sharedState: false, externalNetwork: false, xrSession: false, executable: false, boundary: summary.boundary }); }

  closeButton.addEventListener("click", () => setOpen(false));
  replayButton.addEventListener("click", () => replay("button"));
  resetButton.addEventListener("click", () => reset("button"));
  documentRoot.addEventListener?.("keydown", (event) => { if (event.key === "Escape" && opened) setOpen(false); });
  render();
  setOpen(opened);
  return Object.freeze({ open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen(!opened), selectDevice, replay, reset, syncProjection, setProjection: syncProjection, getSnapshot, destroy: () => {} });
}

export const createDeviceProjectionLayer = createDeviceProjectionConsole;
export default createDeviceProjectionConsole;
