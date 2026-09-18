import {
  BLOCK_WORLD_SNAPSHOT_BOUNDARY,
  createBlockWorldSnapshot,
  serializeBlockWorldSnapshot,
  validateBlockWorldSnapshot,
} from "../domains/block-world-snapshot.js";

export const BLOCK_WORLD_RUNTIME_SYNC_SOURCE = "block-world-runtime-sync";
export const BLOCK_WORLD_RUNTIME_DEFAULT_ENDPOINT = "http://localhost:8091";
export const BLOCK_WORLD_RUNTIME_DEFAULT_WORLD_ID = "demo";
export const BLOCK_WORLD_RUNTIME_MAX_RECONNECT_ATTEMPTS = 2;
export const BLOCK_WORLD_RUNTIME_RECONNECT_DELAY_MS = 1_000;
export const BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY =
  "Merge 4 sync is an explicit loopback-only bridge. Only a validated data-only Block World snapshot crosses the local runtime boundary; browser canonical state stays separate, and no wallet, token, identity, imported code, public deployment, or external execution is available.";
export const BLOCK_WORLD_RUNTIME_SYNC_ROUTE_PREFIX = "?panel=runtime-sync&world=";

export const BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS = Object.freeze({
  panel: "block-world-runtime-sync-console",
  close: "block-world-runtime-sync-close",
  endpoint: "block-world-runtime-sync-endpoint",
  worldId: "block-world-runtime-sync-world-id",
  connect: "block-world-runtime-sync-connect",
  disconnect: "block-world-runtime-sync-disconnect",
  load: "block-world-runtime-sync-load",
  save: "block-world-runtime-sync-save",
  status: "block-world-runtime-sync-status",
  connection: "block-world-runtime-sync-connection",
  version: "block-world-runtime-sync-version",
  remote: "block-world-runtime-sync-remote",
  validation: "block-world-runtime-sync-validation",
  route: "block-world-runtime-sync-route",
  copyRoute: "block-world-runtime-sync-copy-route",
  copyStatus: "block-world-runtime-sync-copy-status",
  trace: "block-world-runtime-sync-trace",
  boundary: "block-world-runtime-sync-boundary",
  payload: "block-world-runtime-sync-payload",
});

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOCAL_FLAGS = Object.freeze({
  simulation: true,
  localOnly: true,
  externalNetwork: false,
  externalTransfer: false,
  executable: false,
  walletConnection: false,
  custody: false,
  signing: false,
  settlement: false,
});

const freeze = (value) => Object.freeze(value);

function text(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function clone(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return null;
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((entry) => clone(entry, seen))
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry, seen)]));
  seen.delete(value);
  return freeze(result);
}

function isLocalOrigin(url, windowLike = globalThis) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  const location = windowLike?.location;
  if (location?.origin && parsed.origin === location.origin) return true;
  return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
}

/**
 * Normalize a runtime endpoint without allowing arbitrary network targets.
 * Same-origin URLs and loopback hosts are the only accepted destinations.
 */
export function normalizeBlockWorldRuntimeEndpoint(value = BLOCK_WORLD_RUNTIME_DEFAULT_ENDPOINT, windowLike = globalThis) {
  const input = String(value ?? "").trim() || BLOCK_WORLD_RUNTIME_DEFAULT_ENDPOINT;
  let parsed;
  try {
    parsed = new URL(input, windowLike?.location?.origin ?? BLOCK_WORLD_RUNTIME_DEFAULT_ENDPOINT);
  } catch {
    throw new TypeError("runtime endpoint must be a valid http(s) URL");
  }
  if (!isLocalOrigin(parsed.href, windowLike)) {
    throw new TypeError("runtime endpoint must be same-origin or loopback-only");
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeBlockWorldRuntimeWorldId(value = BLOCK_WORLD_RUNTIME_DEFAULT_WORLD_ID) {
  const worldId = String(value ?? "").trim() || BLOCK_WORLD_RUNTIME_DEFAULT_WORLD_ID;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(worldId)) throw new TypeError("world id must contain only letters, numbers, dot, underscore, or hyphen");
  return worldId;
}

/**
 * Build the copyable local handoff without carrying an endpoint, origin,
 * credentials, or arbitrary query state. The world id is normalized before
 * encoding, so every generated route remains within the bounded local route
 * contract.
 */
export function buildBlockWorldRuntimeSyncRoute(value = BLOCK_WORLD_RUNTIME_DEFAULT_WORLD_ID) {
  const worldId = normalizeBlockWorldRuntimeWorldId(value);
  return `${BLOCK_WORLD_RUNTIME_SYNC_ROUTE_PREFIX}${encodeURIComponent(worldId)}`;
}

export function blockWorldRuntimeApiUrl(endpoint, worldId, path = "") {
  const base = normalizeBlockWorldRuntimeEndpoint(endpoint);
  const suffix = String(path ?? "").replace(/^\/+/, "");
  if (suffix === "health") return `${base}/api/health`;
  const id = normalizeBlockWorldRuntimeWorldId(worldId);
  return `${base}/api/${suffix ? `${suffix}/` : ""}${encodeURIComponent(id)}`;
}

export function blockWorldRuntimeWebSocketUrl(endpoint, worldId) {
  const httpUrl = new URL(normalizeBlockWorldRuntimeEndpoint(endpoint));
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  httpUrl.pathname = `${httpUrl.pathname.replace(/\/+$/, "")}/ws`;
  httpUrl.search = `?world=${encodeURIComponent(normalizeBlockWorldRuntimeWorldId(worldId))}`;
  return httpUrl.toString();
}

/**
 * Convert the validated renderer snapshot into the Merge 4 state envelope.
 * Required runtime arrays are deliberately empty: this bridge carries block
 * data only and cannot smuggle financial, identity, event, or executable data.
 */
export function createBlockWorldRuntimeState(input) {
  const validation = validateBlockWorldSnapshot(input);
  if (!validation.valid || !validation.snapshot) {
    throw new TypeError(`Cannot sync Block World snapshot: ${validation.errors?.[0]?.message ?? "invalid snapshot"}`);
  }
  const snapshot = validation.snapshot;
  return freeze({
    schemaVersion: 1,
    kind: "matumbo-block-world-runtime-state",
    blockWorldSnapshot: snapshot,
    ledger: freeze([]),
    usedEvidence: freeze([]),
    events: freeze([]),
    fabric: freeze({ entities: freeze({}), relations: freeze([]) }),
    rooms: freeze([]),
    messages: freeze([]),
    proofs: freeze([]),
    runtimeBridge: freeze({
      source: BLOCK_WORLD_RUNTIME_SYNC_SOURCE,
      schemaVersion: 1,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: true,
      executable: false,
    }),
  });
}

function candidateFromRuntimePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return payload.blockWorldSnapshot
    ?? payload.state?.blockWorldSnapshot
    ?? payload.state?.blockWorld
    ?? (payload.kind === "block-world-snapshot" ? payload : null);
}

export function validateBlockWorldRuntimePayload(payload) {
  const candidate = candidateFromRuntimePayload(payload);
  if (!candidate) {
    return freeze({
      valid: false,
      snapshot: null,
      errors: freeze([{ code: "runtime-snapshot-missing", path: "$.state.blockWorldSnapshot", message: "Runtime response did not contain a Block World snapshot." }]),
      warnings: freeze([]),
    });
  }
  return validateBlockWorldSnapshot(candidate);
}

function responseJson(response) {
  return Promise.resolve(response?.json?.()).catch(() => ({}));
}

function makeError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function requireElements(documentRoot) {
  const elements = Object.fromEntries(Object.entries(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS).map(([key, id]) => [key, documentRoot.getElementById(id)]));
  const required = Object.keys(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS);
  const missing = required.filter((key) => !elements[key]);
  if (missing.length) throw new Error(`Block World runtime sync mount points are missing: ${missing.join(", ")}`);
  return elements;
}

function makeText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

/**
 * Mount an explicit local Merge 4 bridge. No request or socket is created at
 * mount time; connect/load/save are user actions and all remote snapshots are
 * validated before the host may apply them to its local draft.
 */
export function createBlockWorldRuntimeSync({
  documentRoot = globalThis.document,
  windowLike = globalThis,
  projection = null,
  getProjection = null,
  onOpen = null,
  onConnect = null,
  onDisconnect = null,
  onLoad = null,
  onSave = null,
  onConflict = null,
  onRemoteUpdate = null,
  onCopyRoute = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Block World runtime sync needs a document-like owner");
  const elements = requireElements(documentRoot);
  const {
    panel,
    close: closeButton,
    endpoint: endpointEl,
    worldId: worldIdEl,
    connect: connectButton,
    disconnect: disconnectButton,
    load: loadButton,
    save: saveButton,
    status: statusEl,
    connection: connectionEl,
    version: versionEl,
    remote: remoteEl,
    validation: validationEl,
    route: routeEl,
    copyRoute: copyRouteButton,
    copyStatus: copyStatusEl,
    trace: traceEl,
    boundary: boundaryEl,
    payload: payloadEl,
  } = elements;

  let opened = panel.hidden !== true;
  let endpoint = String(endpointEl.value || BLOCK_WORLD_RUNTIME_DEFAULT_ENDPOINT).trim();
  let worldId = String(worldIdEl.value || BLOCK_WORLD_RUNTIME_DEFAULT_WORLD_ID).trim();
  let connectionState = "offline";
  let status = "READY · CONNECT TO LOCAL MERGE 4 · NO REQUEST YET";
  let serverVersion = null;
  let remoteVersion = null;
  let requiresReload = false;
  let busy = false;
  let lastError = null;
  let lastHealth = null;
  let lastRemoteUpdate = null;
  let lastValidation = null;
  let lastCopy = null;
  let trace = [];
  let socket = null;
  let connectIntent = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let currentProjection = projection;

  // `/api/health` deliberately distinguishes the local in-memory rehearsal
  // runtime from PostgreSQL. Keep that distinction in the visible connection
  // state: a successful health response is not evidence of durable storage or
  // an external provider connection.
  function runtimeReadinessLabel(health = lastHealth) {
    if (health?.storage === "memory-demo" || health?.postgres === false) {
      return "MEMORY-DEMO · NON-DURABLE · NO EXTERNAL PROVIDER";
    }
    if (health?.storage === "postgres" || health?.postgres === true) return "POSTGRES · LOCAL RUNTIME";
    return `LOCAL RUNTIME · STORAGE ${String(health?.storage ?? "UNREPORTED").toUpperCase()}`;
  }

  function connectedRuntimeStatus() {
    return `CONNECTED · ${runtimeReadinessLabel()} · LOAD OR SAVE EXPLICITLY`;
  }

  function readProjection() {
    const next = typeof getProjection === "function" ? getProjection() : currentProjection;
    if (next?.draft && Array.isArray(next.draft.blocks)) return next.draft;
    return next ?? currentProjection;
  }

  function addTrace(action, detail = "") {
    trace = freeze([{ action, detail, at: new Date().toISOString(), localOnly: true }, ...trace].slice(0, 16).map((entry) => clone(entry)));
  }

  function setStatus(next, error = null) {
    status = String(next);
    lastError = error ? String(error.message ?? error) : null;
    render();
  }

  function renderValidation() {
    validationEl.replaceChildren();
    if (!lastValidation) {
      validationEl.appendChild(makeText(documentRoot, "div", "block-world-runtime-sync-empty", "No remote snapshot loaded yet."));
      return;
    }
    if (lastValidation.valid) {
      validationEl.appendChild(makeText(documentRoot, "div", "block-world-runtime-sync-valid", `VALIDATED · ${lastValidation.blockCount} BLOCKS · ${lastValidation.contentCount} NESTED ITEMS`));
      return;
    }
    (lastValidation.errors ?? []).forEach((error) => validationEl.appendChild(makeText(documentRoot, "div", "block-world-runtime-sync-error", `REJECTED · ${error.path} · ${error.message}`)));
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(makeText(documentRoot, "div", "block-world-runtime-sync-empty", "No runtime actions yet."));
      return;
    }
    trace.forEach((entry, index) => traceEl.appendChild(makeText(documentRoot, "div", "block-world-runtime-sync-trace-row", `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.detail || "LOCAL ONLY"}`)));
  }

  function currentLocalRoute() {
    try {
      return buildBlockWorldRuntimeSyncRoute(worldId);
    } catch {
      return "";
    }
  }

  function renderLocalRoute() {
    const route = currentLocalRoute();
    routeEl.value = route;
    routeEl.textContent = route;
    routeEl.setAttribute?.("value", route);
    routeEl.setAttribute?.("aria-invalid", String(!route));
    if (copyStatusEl) {
      copyStatusEl.textContent = !route
        ? "ROUTE BLOCKED · BOUNDED WORLD ID REQUIRED · LOCAL ONLY"
        : lastCopy?.status === "copied"
          ? "ROUTE COPIED · LOCAL ONLY · REOPEN WITH WORLD ID"
          : lastCopy?.status === "unavailable"
            ? "ROUTE VISIBLE · COPY MANUALLY · CLIPBOARD UNAVAILABLE · LOCAL ONLY"
            : lastCopy?.status === "invalid"
              ? "ROUTE BLOCKED · BOUNDED WORLD ID REQUIRED · LOCAL ONLY"
              : "ROUTE VISIBLE · COPY MANUALLY · LOCAL ONLY";
    }
  }

  function render() {
    endpointEl.value = endpoint;
    worldIdEl.value = worldId;
    renderLocalRoute();
    statusEl.textContent = status;
    connectionEl.textContent = `${connectionState.toUpperCase()} · ${connectIntent ? `EXPLICIT SESSION · ${runtimeReadinessLabel()}` : "NO SESSION"}`;
    connectionEl.dataset.connectionState = connectionState;
    versionEl.textContent = serverVersion === null ? "—" : String(serverVersion);
    remoteEl.textContent = remoteVersion === null ? "—" : String(remoteVersion);
    payloadEl.textContent = lastValidation?.valid && lastValidation.snapshot
      ? serializeBlockWorldSnapshot(lastValidation.snapshot)
      : "Load a validated runtime snapshot to show its data-only payload.";
    boundaryEl.textContent = BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY;
    const connected = connectionState === "connected" || connectionState === "reconnecting";
    connectButton.disabled = busy || connected;
    disconnectButton.disabled = busy || (!connectIntent && connectionState === "offline");
    loadButton.disabled = busy || !connectIntent || connectionState !== "connected";
    saveButton.disabled = busy || !connectIntent || connectionState !== "connected" || requiresReload;
    renderValidation();
    renderTrace();
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList?.toggle?.("visible", opened);
    panel.setAttribute?.("aria-hidden", String(!opened));
    if (opened && method === "open") onOpen?.(getSnapshot());
    if (!opened && connectIntent) disconnect("close");
    render();
  }

  function setWorldId(value, method = "api") {
    let normalized;
    try {
      normalized = normalizeBlockWorldRuntimeWorldId(value);
    } catch (error) {
      addTrace("world-id-rejected", error.message);
      setStatus("WORLD ID BLOCKED · USE 1–80 LETTERS, NUMBERS, DOT, UNDERSCORE, OR HYPHEN", error);
      return getSnapshot();
    }
    if (connectIntent && normalized !== worldId) disconnect("world-id-change");
    worldId = normalized;
    worldIdEl.value = normalized;
    serverVersion = null;
    remoteVersion = null;
    requiresReload = false;
    lastValidation = null;
    lastRemoteUpdate = null;
    lastCopy = null;
    addTrace("world-id", `${normalized}${method === "route" ? " · route open" : ""}`);
    if (method === "route") status = "READY · LOCAL SYNC ROUTE · CONNECT EXPLICITLY · NO REQUEST YET";
    else status = "WORLD ID SET · CONNECT TO LOCAL MERGE 4 EXPLICITLY";
    render();
    return getSnapshot();
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      (windowLike.clearTimeout ?? globalThis.clearTimeout)?.(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function closeSocket() {
    const active = socket;
    socket = null;
    if (!active) return;
    try { active.close?.(1000, "local runtime sync stopped"); } catch { /* noop */ }
  }

  function scheduleReconnect() {
    if (!connectIntent || reconnectTimer !== null || reconnectAttempts >= BLOCK_WORLD_RUNTIME_MAX_RECONNECT_ATTEMPTS) {
      if (connectIntent && reconnectAttempts >= BLOCK_WORLD_RUNTIME_MAX_RECONNECT_ATTEMPTS) {
        connectionState = "offline";
        setStatus("RECONNECT UNAVAILABLE · PRESS CONNECT TO RETRY");
      }
      return;
    }
    reconnectAttempts += 1;
    connectionState = "reconnecting";
    setStatus(`RUNTIME SOCKET CLOSED · RECONNECT ${reconnectAttempts}/${BLOCK_WORLD_RUNTIME_MAX_RECONNECT_ATTEMPTS}`);
    const timerApi = windowLike.setTimeout ?? globalThis.setTimeout;
    if (typeof timerApi !== "function") return;
    reconnectTimer = timerApi(() => {
      reconnectTimer = null;
      openSocket();
    }, BLOCK_WORLD_RUNTIME_RECONNECT_DELAY_MS);
  }

  function openSocket() {
    if (!connectIntent) return;
    const WebSocketCtor = windowLike.WebSocket ?? globalThis.WebSocket;
    if (typeof WebSocketCtor !== "function") {
      connectionState = "connected";
      setStatus("LOCAL RUNTIME READY · WEBSOCKET UNAVAILABLE");
      return;
    }
    let url;
    try {
      url = blockWorldRuntimeWebSocketUrl(endpoint, worldId);
    } catch (error) {
      connectionState = "offline";
      setStatus("RUNTIME SOCKET BLOCKED · LOOPBACK ONLY", error);
      return;
    }
    try {
      const next = new WebSocketCtor(url);
      socket = next;
      next.addEventListener?.("open", () => {
        if (socket !== next) return;
        reconnectAttempts = 0;
        connectionState = "connected";
        addTrace("websocket-open", `world ${worldId}`);
        setStatus(connectedRuntimeStatus());
        onConnect?.(getSnapshot());
      });
      next.addEventListener?.("message", (event) => {
        let payload;
        try { payload = JSON.parse(String(event?.data ?? "")); } catch { return; }
        if (payload?.type === "WELCOME") {
          addTrace("websocket-welcome", `world ${payload.worldId ?? worldId}`);
          render();
          return;
        }
        if (payload?.type !== "WORLD_UPDATED" || payload.worldId !== worldId) return;
        const version = Number(payload.version);
        if (!Number.isSafeInteger(version) || version < 0) return;
        remoteVersion = version;
        lastRemoteUpdate = clone({ type: payload.type, worldId, version, at: new Date().toISOString() });
        addTrace("world-updated", `server version ${version}`);
        setStatus(version > (serverVersion ?? -1)
          ? "REMOTE UPDATE · LOAD TO REVIEW · LOCAL DRAFT UNCHANGED"
          : `REMOTE UPDATE · SERVER VERSION ${version}`);
        onRemoteUpdate?.(clone({ ...lastRemoteUpdate, payload, ...LOCAL_FLAGS, persistence: false, boundary: BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY }));
      });
      next.addEventListener?.("error", () => {
        addTrace("websocket-error", "safe reconnect state");
        render();
      });
      next.addEventListener?.("close", () => {
        if (socket === next) socket = null;
        if (connectIntent) scheduleReconnect();
        else {
          connectionState = "offline";
          render();
        }
      });
      // Small test doubles often expose on* properties rather than
      // addEventListener. Keep the browser path standards-based while making
      // the adapter deterministic under a minimal document/runtime harness.
      if (!next.addEventListener) {
        next.onopen = () => { reconnectAttempts = 0; connectionState = "connected"; addTrace("websocket-open", `world ${worldId}`); setStatus(connectedRuntimeStatus()); onConnect?.(getSnapshot()); };
        next.onmessage = (event) => { try { const payload = JSON.parse(String(event?.data ?? "")); if (payload?.type === "WORLD_UPDATED") { remoteVersion = Number(payload.version); addTrace("world-updated", `server version ${remoteVersion}`); setStatus("REMOTE UPDATE · LOAD TO REVIEW · LOCAL DRAFT UNCHANGED"); onRemoteUpdate?.(payload); } } catch { /* noop */ } };
        next.onerror = () => { addTrace("websocket-error", "safe reconnect state"); render(); };
        next.onclose = () => { if (connectIntent) scheduleReconnect(); else { connectionState = "offline"; render(); } };
      }
    } catch (error) {
      socket = null;
      connectionState = "offline";
      setStatus("RUNTIME SOCKET UNAVAILABLE · LOCAL DATA UNCHANGED", error);
      scheduleReconnect();
    }
  }

  async function request(path, options = {}) {
    const fetchFn = windowLike.fetch ?? globalThis.fetch;
    if (typeof fetchFn !== "function") throw makeError("browser fetch is unavailable");
    const url = blockWorldRuntimeApiUrl(endpoint, worldId, path);
    let response;
    try {
      response = await fetchFn(url, {
        ...options,
        headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) },
      });
    } catch (error) {
      throw makeError(`local runtime request failed: ${error?.message ?? "network error"}`, { cause: error });
    }
    const payload = await responseJson(response);
    if (!response?.ok) throw makeError(payload?.error ?? `local runtime returned HTTP ${response?.status ?? "error"}`, { status: response?.status, payload, currentVersion: payload?.currentVersion });
    return payload;
  }

  async function connect(method = "button") {
    if (busy) return getSnapshot();
    busy = true;
    render();
    let normalizedEndpoint;
    let normalizedWorld;
    try {
      normalizedEndpoint = normalizeBlockWorldRuntimeEndpoint(endpointEl.value, windowLike);
      normalizedWorld = normalizeBlockWorldRuntimeWorldId(worldIdEl.value);
      endpoint = normalizedEndpoint;
      worldId = normalizedWorld;
      const health = await request("health");
      lastHealth = clone(health);
      connectIntent = true;
      reconnectAttempts = 0;
      connectionState = "connected";
      addTrace("connect", `${endpoint} · ${worldId}`);
      status = connectedRuntimeStatus();
      onConnect?.(clone({ action: "connect", method, endpoint, worldId, health, ...LOCAL_FLAGS, persistence: false, boundary: BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY }));
      render();
      openSocket();
      return getSnapshot();
    } catch (error) {
      connectIntent = false;
      connectionState = "offline";
      addTrace("connect-rejected", error.message);
      setStatus("RUNTIME UNAVAILABLE · START LOCAL MERGE 4 OR CHECK ENDPOINT", error);
      return getSnapshot();
    } finally {
      busy = false;
      render();
    }
  }

  function disconnect(method = "button") {
    connectIntent = false;
    clearReconnectTimer();
    reconnectAttempts = 0;
    closeSocket();
    connectionState = "offline";
    addTrace("disconnect", method === "close" ? "panel closed" : "explicit stop");
    setStatus("DISCONNECTED · LOCAL DRAFT UNCHANGED");
    onDisconnect?.(clone({ action: "disconnect", method, endpoint, worldId, ...LOCAL_FLAGS, persistence: false, boundary: BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY }));
    return getSnapshot();
  }

  async function load(method = "button") {
    if (busy || !connectIntent || connectionState !== "connected") {
      setStatus("LOAD BLOCKED · CONNECT TO LOCAL MERGE 4 FIRST");
      return getSnapshot();
    }
    busy = true;
    render();
    try {
      const payload = await request(`world`);
      const validation = validateBlockWorldRuntimePayload(payload);
      lastValidation = validation;
      if (!validation.valid || !validation.snapshot) {
        addTrace("load-rejected", "remote snapshot failed validation");
        setStatus("REMOTE SNAPSHOT REJECTED · LOCAL DRAFT UNCHANGED");
        return getSnapshot();
      }
      const version = Number(payload.version);
      serverVersion = Number.isSafeInteger(version) && version >= 0 ? version : 0;
      remoteVersion = serverVersion;
      requiresReload = false;
      addTrace("load", `server version ${serverVersion} · ${validation.blockCount} blocks`);
      setStatus(`LOADED · SERVER VERSION ${serverVersion} · ${validation.blockCount} BLOCKS · APPLY IS LOCAL`);
      const result = clone({ action: "load", method, accepted: true, valid: true, endpoint, worldId, version: serverVersion, validation, snapshot: validation.snapshot, ...LOCAL_FLAGS, persistence: false, boundary: BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY });
      onLoad?.(result);
      return result;
    } catch (error) {
      if (error.status === 404) {
        serverVersion = 0;
        requiresReload = false;
        addTrace("load-empty", "world not found; save may use expectedVersion 0");
        setStatus("WORLD NOT FOUND · SAVE NEW VERSION 1 WITH EXPECTED VERSION 0");
      } else {
        addTrace("load-error", error.message);
        setStatus("LOAD FAILED · LOCAL DRAFT UNCHANGED", error);
      }
      return getSnapshot();
    } finally {
      busy = false;
      render();
    }
  }

  async function save(method = "button") {
    if (busy || !connectIntent || connectionState !== "connected") {
      setStatus("SAVE BLOCKED · CONNECT TO LOCAL MERGE 4 FIRST");
      return getSnapshot();
    }
    if (requiresReload) {
      setStatus("SAVE BLOCKED · LOAD REMOTE VERSION AFTER CONFLICT");
      return getSnapshot();
    }
    busy = true;
    render();
    try {
      const snapshot = createBlockWorldSnapshot(readProjection());
      const validation = validateBlockWorldSnapshot(snapshot);
      if (!validation.valid || !validation.snapshot) throw makeError("current Block World draft failed validation");
      lastValidation = validation;
      const expectedVersion = Number.isSafeInteger(serverVersion) && serverVersion >= 0 ? serverVersion : 0;
      const payload = await request(`world`, {
        method: "PUT",
        body: JSON.stringify({ expectedVersion, state: createBlockWorldRuntimeState(snapshot) }),
      });
      const version = Number(payload.version);
      if (!Number.isSafeInteger(version) || version < 1) throw makeError("runtime returned an invalid world version");
      serverVersion = version;
      remoteVersion = version;
      requiresReload = false;
      addTrace("save", `expected ${expectedVersion} · server version ${version} · ${snapshot.blockCount} blocks`);
      setStatus(`SAVED · SERVER VERSION ${version} · ${snapshot.blockCount} BLOCKS · LOCAL RUNTIME ONLY`);
      const result = clone({ action: "save", method, accepted: true, valid: true, endpoint, worldId, expectedVersion, version, validation, snapshot, response: payload, ...LOCAL_FLAGS, persistence: true, boundary: BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY });
      onSave?.(result);
      return result;
    } catch (error) {
      if (error.status === 409) {
        const attemptedVersion = Number.isSafeInteger(serverVersion) && serverVersion >= 0 ? serverVersion : 0;
        const currentVersion = Number(error.currentVersion);
        if (Number.isSafeInteger(currentVersion) && currentVersion >= 0) {
          remoteVersion = currentVersion;
          serverVersion = currentVersion;
        }
        requiresReload = true;
        addTrace("conflict", `server version ${Number.isSafeInteger(currentVersion) ? currentVersion : "unknown"} · reload required`);
        setStatus(`VERSION CONFLICT · SERVER VERSION ${Number.isSafeInteger(currentVersion) ? currentVersion : "UNKNOWN"} · LOAD TO REVIEW`, error);
        const result = clone({ action: "conflict", method, accepted: false, conflict: true, endpoint, worldId, expectedVersion: attemptedVersion, currentVersion: Number.isSafeInteger(currentVersion) ? currentVersion : null, ...LOCAL_FLAGS, persistence: false, boundary: BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY });
        onConflict?.(result);
        return result;
      }
      addTrace("save-error", error.message);
      setStatus("SAVE FAILED · LOCAL DRAFT UNCHANGED", error);
      return getSnapshot();
    } finally {
      busy = false;
      render();
    }
  }

  async function copyLocalRoute(method = "button") {
    let normalizedWorld;
    try {
      normalizedWorld = normalizeBlockWorldRuntimeWorldId(worldIdEl.value);
    } catch (error) {
      addTrace("copy-route-rejected", error.message);
      lastCopy = clone({
        source: BLOCK_WORLD_RUNTIME_SYNC_SOURCE,
        action: "copy-local-route",
        method,
        status: "invalid",
        reason: "bounded-world-id-required",
        copied: false,
        worldId: String(worldIdEl.value ?? ""),
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
        boundary: BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY,
      });
      setStatus("ROUTE BLOCKED · BOUNDED WORLD ID REQUIRED · LOCAL ONLY", error);
      onCopyRoute?.(lastCopy);
      return lastCopy;
    }
    worldId = normalizedWorld;
    worldIdEl.value = normalizedWorld;
    const route = buildBlockWorldRuntimeSyncRoute(normalizedWorld);
    const clipboard = windowLike?.navigator?.clipboard;
    const writeText = clipboard?.writeText;
    let status = "manual";
    let reason = "clipboard-unavailable";
    if (typeof writeText === "function") {
      try {
        await writeText.call(clipboard, route);
        status = "copied";
        reason = "user-triggered-clipboard";
      } catch {
        status = "unavailable";
        reason = "clipboard-rejected";
      }
    }
    lastCopy = clone({
      source: BLOCK_WORLD_RUNTIME_SYNC_SOURCE,
      action: "copy-local-route",
      method,
      status,
      reason,
      route,
      url: route,
      worldId: normalizedWorld,
      copied: status === "copied",
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      boundary: BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY,
    });
    addTrace(status === "copied" ? "copy-route" : "copy-route-manual", route);
    setStatus(status === "copied"
      ? "ROUTE COPIED · LOCAL ONLY · REOPEN WITH WORLD ID"
      : "ROUTE VISIBLE · COPY MANUALLY · LOCAL ONLY", null);
    onCopyRoute?.(lastCopy);
    return lastCopy;
  }

  function syncProjection(nextProjection) {
    currentProjection = nextProjection;
    return getSnapshot();
  }

  function getSnapshot() {
    return clone({
      source: BLOCK_WORLD_RUNTIME_SYNC_SOURCE,
      opened,
      endpoint,
      worldId,
      localRoute: currentLocalRoute(),
      lastCopy,
      status,
      connectionState,
      connectIntent,
      serverVersion,
      remoteVersion,
      requiresReload,
      busy,
      health: lastHealth,
      validation: lastValidation,
      lastError,
      lastRemoteUpdate,
      reconnectAttempts,
      reconnectTimerActive: reconnectTimer !== null,
      socketOpen: Boolean(socket && socket.readyState === 1),
      trace,
      ...LOCAL_FLAGS,
      persistence: false,
      boundary: BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY,
    });
  }

  endpointEl.addEventListener?.("input", () => { endpoint = endpointEl.value; });
  worldIdEl.addEventListener?.("input", () => { worldId = worldIdEl.value; lastCopy = null; render(); });
  closeButton.addEventListener?.("click", () => setOpen(false, "close"));
  connectButton.addEventListener?.("click", () => { void connect("button"); });
  disconnectButton.addEventListener?.("click", () => disconnect("button"));
  loadButton.addEventListener?.("click", () => { void load("button"); });
  saveButton.addEventListener?.("click", () => { void save("button"); });
  copyRouteButton.addEventListener?.("click", () => { void copyLocalRoute("button"); });
  boundaryEl.textContent = BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY;
  render();
  setOpen(opened);

  return freeze({
    open: () => setOpen(true, "open"),
    close: () => setOpen(false, "api"),
    toggle: () => setOpen(!opened, "api"),
    connect,
    disconnect,
    load,
    save,
    setWorldId,
    copyLocalRoute,
    syncProjection,
    setProjection: syncProjection,
    getSnapshot,
    destroy: () => disconnect("destroy"),
  });
}

export default createBlockWorldRuntimeSync;
