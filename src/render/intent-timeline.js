/**
 * Bounded local intent timeline.
 *
 * The timeline is a renderer-side observability adapter.  It listens to the
 * frozen `simfabric:intent` event emitted by the projection bridge, keeps a
 * small in-memory window, and renders only an allowlisted primitive summary.
 * It never becomes a second event bus or a source of canonical state.
 */

export const INTENT_EVENT_NAME = "simfabric:intent";
export const INTENT_TIMELINE_SOURCE = "living-reality-intent-timeline";
export const INTENT_TIMELINE_MAX_ENTRIES = 12;

const MAX_TEXT_LENGTH = 120;
const MAX_SUMMARY_KEYS = 12;
const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

// Detail metadata is intentionally small and primitive.  In particular,
// address/key/credential-shaped fields are not useful for this local trace.
const PRIVATE_KEY_PATTERN = /(password|passphrase|secret|private|credential|authorization|auth(?:entication|orization)?token|access[_-]?token|refresh[_-]?token|api[_-]?key|wallet(?:address)?|recipient[_-]?address|address|signature|seed|mnemonic|cookie|session(?:id)?)/i;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return Object.freeze(value);
}

function safeText(value, fallback = "—", limit = MAX_TEXT_LENGTH) {
  if (value === null || value === undefined || value === "") return fallback;
  if (["object", "function", "symbol"].includes(typeof value)) return fallback;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, Math.max(1, limit - 1))}…` : text;
}

function safePrimitive(value) {
  if (typeof value === "string") return safeText(value, "", 72);
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/**
 * Keep only safe, shallow metadata from an intent detail object.
 *
 * This is exported so tests and other local surfaces can use the exact same
 * redaction rule as the DOM adapter.  Nested objects and arrays are omitted;
 * values are never stringified into an arbitrary object dump.
 */
export function sanitizeIntentDetail(detail) {
  if (!isRecord(detail)) return deepFreeze({});
  const safe = {};
  const sortedEntries = Object.entries(detail).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of sortedEntries) {
    if (Object.keys(safe).length >= MAX_SUMMARY_KEYS) break;
    if (
      typeof key !== "string"
      || RESERVED_KEYS.has(key)
      || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(key)
      || PRIVATE_KEY_PATTERN.test(key)
    ) continue;
    const primitive = safePrimitive(value);
    if (primitive !== undefined && primitive !== "") safe[key] = primitive;
  }
  return deepFreeze(safe);
}

function safeTarget(target) {
  const primitive = safePrimitive(target);
  if (primitive !== undefined && primitive !== "") return primitive;
  // A target object may be supplied by a caller, but only its short id is
  // useful in a timeline row.  No object is rendered or stringified.
  if (isRecord(target)) {
    const id = safePrimitive(target.id);
    if (id !== undefined && id !== "") return id;
  }
  return "local target";
}

function safeType(type) {
  const value = safeText(type, "intent", 96);
  return value.replace(/[^A-Za-z0-9_.:-]/g, "_");
}

function safeCreatedAt(createdAt) {
  const value = safePrimitive(createdAt);
  return typeof value === "string" ? safeText(value, "session time", 48) : "session time";
}

function formatDetailSummary(detail) {
  const entries = Object.entries(detail);
  if (!entries.length) return "no safe metadata";
  return entries
    .slice(0, MAX_SUMMARY_KEYS)
    .map(([key, value]) => `${key}=${safeText(value, "—", 48)}`)
    .join(" · ");
}

/**
 * Convert an event detail object into a frozen, display-safe timeline entry.
 * `sequence` is supplied by the adapter and is the only local identity added
 * to an entry; it does not represent a ledger index or external receipt.
 */
export function summarizeIntent(intent, sequence = 1) {
  const raw = isRecord(intent) ? intent : {};
  const safeSequence = Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 1;
  const detail = sanitizeIntentDetail(raw.detail);
  return deepFreeze({
    id: `intent:${safeSequence}`,
    sequence: safeSequence,
    type: safeType(raw.type),
    target: safeTarget(raw.target),
    summary: formatDetailSummary(detail),
    detail,
    source: safeText(raw.source, "local renderer", 72),
    simulation: raw.simulation === true,
    localOnly: true,
    externalTransfer: false,
    schemaVersion: Number.isSafeInteger(raw.schemaVersion) ? raw.schemaVersion : 1,
    createdAt: safeCreatedAt(raw.createdAt),
  });
}

function formatCount(value) {
  return Number.isSafeInteger(value) ? String(value) : "0";
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = safeText(value);
  return element;
}

function clampBound(value) {
  if (!Number.isSafeInteger(value)) return INTENT_TIMELINE_MAX_ENTRIES;
  return Math.min(INTENT_TIMELINE_MAX_ENTRIES, Math.max(1, value));
}

/**
 * Mount the in-memory timeline into the HUD.
 *
 * `eventRoot` is injectable for focused tests.  In the browser it is the
 * window object and the only event subscribed to is `simfabric:intent`.
 */
export function createIntentTimeline({
  documentRoot = globalThis.document,
  eventRoot = globalThis.window,
  projection = null,
  maxEntries = INTENT_TIMELINE_MAX_ENTRIES,
  onReplay = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Intent timeline needs a document-like owner");
  if (!eventRoot?.addEventListener || !eventRoot?.removeEventListener) {
    throw new Error("Intent timeline needs an event owner");
  }

  const panel = documentRoot.getElementById("intent-timeline");
  const openButton = documentRoot.getElementById("intent-timeline-open");
  const closeButton = documentRoot.getElementById("intent-timeline-close");
  const replayButton = documentRoot.getElementById("intent-timeline-replay");
  const clearButton = documentRoot.getElementById("intent-timeline-clear");
  const statusEl = documentRoot.getElementById("intent-timeline-status");
  const list = documentRoot.getElementById("intent-timeline-events");
  const countEl = documentRoot.getElementById("intent-timeline-count");
  const boundaryEl = documentRoot.getElementById("intent-timeline-boundary");
  if (!panel || !closeButton || !replayButton || !clearButton || !statusEl || !list || !countEl) {
    throw new Error("Intent timeline mount points are missing");
  }

  const bound = clampBound(maxEntries);
  let currentProjection = projection;
  let entries = [];
  let sequence = 0;
  let clearCount = 0;
  let replayCount = 0;
  let lastReplay = null;
  let opened = panel.hidden !== true;

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList?.toggle?.("visible", opened);
    panel.setAttribute?.("aria-hidden", String(!opened));
    if (openButton) {
      openButton.setAttribute?.("aria-expanded", String(opened));
      openButton.textContent = opened ? "HIDE INTENT TRACE" : "OPEN INTENT TRACE";
    }
    if (opened && method === "open") replayButton.focus?.({ preventScroll: true });
  }

  function renderEntry(entry) {
    const row = documentRoot.createElement("div");
    row.className = "intent-timeline-entry";
    row.dataset.intentId = entry.id;
    row.append(
      createText(documentRoot, "b", "intent-timeline-entry-sequence", `#${entry.sequence}`),
      createText(documentRoot, "span", "intent-timeline-entry-type", entry.type),
      createText(documentRoot, "span", "intent-timeline-entry-target", entry.target),
      createText(documentRoot, "span", "intent-timeline-entry-summary", entry.summary),
    );
    row.title = `${entry.type} · ${entry.target}`;
    return row;
  }

  function render() {
    list.replaceChildren();
    entries.forEach((entry) => list.appendChild(renderEntry(entry)));
    if (!entries.length) {
      list.appendChild(createText(documentRoot, "div", "intent-timeline-empty", "No local intents yet. Select a feature to begin."));
    }
    countEl.textContent = `${formatCount(entries.length)} / ${formatCount(bound)} recent intents`;
    statusEl.textContent = lastReplay
      ? `REPLAYED · LOCAL SNAPSHOT #${replayCount} · NO NETWORK`
      : entries.length
        ? "CAPTURING · LOCAL SIMULATION · NO NETWORK"
        : "READY · LOCAL SIMULATION · NO NETWORK";
    if (boundaryEl) {
      boundaryEl.textContent = "Recent renderer intents only. In-memory for this page session; no persistence, providers, identity, or execution authority.";
    }
  }

  function capture(eventDetail) {
    if (!isRecord(eventDetail)) return null;
    sequence += 1;
    const entry = summarizeIntent(eventDetail, sequence);
    entries = [...entries, entry].slice(-bound);
    lastReplay = null;
    render();
    return entry;
  }

  function onIntent(event) {
    capture(event?.detail);
  }

  function clear(method = "button") {
    entries = [];
    clearCount += 1;
    lastReplay = null;
    render();
    return getSnapshot(method);
  }

  function replay(method = "button") {
    replayCount += 1;
    lastReplay = deepFreeze({
      source: INTENT_TIMELINE_SOURCE,
      method,
      replayCount,
      count: entries.length,
      events: entries.slice(),
      simulation: true,
      localOnly: true,
      externalTransfer: false,
      persisted: false,
    });
    render();
    onReplay?.(lastReplay);
    return lastReplay;
  }

  function setProjection(nextProjection) {
    currentProjection = nextProjection ?? currentProjection;
    return getSnapshot("projection");
  }

  function getSnapshot(method = "api") {
    return deepFreeze({
      source: INTENT_TIMELINE_SOURCE,
      bound,
      entries: entries.slice(),
      count: entries.length,
      sequence,
      clearCount,
      replayCount,
      lastReplay,
      opened,
      simulation: true,
      localOnly: true,
      externalTransfer: false,
      persisted: false,
      projectionSchemaVersion: Number.isSafeInteger(currentProjection?.schemaVersion)
        ? currentProjection.schemaVersion
        : null,
      method,
    });
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && opened) setOpen(false, "escape");
  }

  eventRoot.addEventListener(INTENT_EVENT_NAME, onIntent);
  openButton?.addEventListener("click", () => setOpen(!opened, opened ? "close" : "open"));
  closeButton.addEventListener("click", () => setOpen(false, "close"));
  clearButton.addEventListener("click", () => clear("button"));
  replayButton.addEventListener("click", () => replay("button"));
  documentRoot.addEventListener?.("keydown", onKeyDown);

  render();
  setOpen(opened, "initial");

  return Object.freeze({
    open: () => setOpen(true, "open"),
    close: () => setOpen(false, "close"),
    toggle: () => setOpen(!opened, "toggle"),
    capture,
    clear,
    replay,
    setProjection,
    getSnapshot,
    destroy() {
      eventRoot.removeEventListener(INTENT_EVENT_NAME, onIntent);
      documentRoot.removeEventListener?.("keydown", onKeyDown);
      entries = [];
      lastReplay = null;
      render();
    },
  });
}

export default createIntentTimeline;
