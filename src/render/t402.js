import { T402_SOURCE } from "../domains/t402.js";

export const T402_CONSOLE_SOURCE = "t402-console";
export const T402_RENDER_SOURCE = T402_CONSOLE_SOURCE;

const DEFAULT_BOUNDARY =
  "T402 is a local offer, route, and escrow rehearsal. Live value movement, custody, signing, release, transfer, and settlement are denied.";

const freeze = (value) => Object.freeze(value);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return freeze(value);
  }
  if (!isRecord(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return freeze(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function contributionFrom(projection) {
  if (projection?.source === T402_SOURCE) return projection;
  return asArray(projection?.contributions).find((contribution) => contribution?.source === T402_SOURCE)
    ?? { source: T402_SOURCE, updatedAt: null, entities: [], evidence: [], capabilities: [] };
}

function displayKind(entity) {
  return text(entity?.kind ?? "record").replace(/^t402-/, "").replace(/-/g, " ");
}

function displayLabel(entity) {
  if (!entity) return "unnamed record";
  if (entity.kind === "t402-route-rehearsal") return `${text(entity.from)} → ${text(entity.to)}`;
  if (entity.kind === "t402-live-movement-denial") return `${text(entity.requestedAction)} · denied`;
  return text(entity.label ?? entity.id);
}

/** Read the canonical T402 contribution into four inspectable local stages. */
export function summarizeT402(projection) {
  const contribution = contributionFrom(projection);
  const entities = asArray(contribution.entities);
  const offers = entities.filter((entity) => entity?.kind === "t402-offer").map((entity) => deepFreeze({ ...entity, displayLabel: displayLabel(entity), displayKind: displayKind(entity) }));
  const routes = entities.filter((entity) => entity?.kind === "t402-route-rehearsal").map((entity) => deepFreeze({ ...entity, displayLabel: displayLabel(entity), displayKind: displayKind(entity) }));
  const escrows = entities.filter((entity) => entity?.kind === "t402-escrow-rehearsal").map((entity) => deepFreeze({ ...entity, displayLabel: displayLabel(entity), displayKind: displayKind(entity) }));
  const denials = entities.filter((entity) => entity?.kind === "t402-live-movement-denial").map((entity) => deepFreeze({ ...entity, displayLabel: displayLabel(entity), displayKind: displayKind(entity) }));
  const records = [...offers, ...routes, ...escrows, ...denials];
  return deepFreeze({
    source: T402_SOURCE,
    updatedAt: contribution.updatedAt,
    records,
    offers,
    routes,
    escrows,
    denials,
    offerCount: offers.length,
    routeCount: routes.length,
    escrowCount: escrows.length,
    denialCount: denials.length,
    recordCount: records.length,
    evidenceCount: asArray(contribution.evidence).length,
    capabilityCount: asArray(contribution.capabilities).length,
    simulation: contribution.simulation === true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    custody: false,
    signing: false,
    settlement: false,
    executable: false,
    persistence: false,
    boundary: contribution.evidence?.[0]?.note ?? DEFAULT_BOUNDARY,
  });
}

export function createT402Console({
  documentRoot = globalThis.document,
  projection = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("T402 console needs a document-like owner");
  const panel = documentRoot.getElementById("t402-console");
  const closeButton = documentRoot.getElementById("t402-console-close");
  const replayButton = documentRoot.getElementById("t402-console-replay");
  const resetButton = documentRoot.getElementById("t402-console-reset");
  const statusEl = documentRoot.getElementById("t402-console-status");
  const summaryEl = documentRoot.getElementById("t402-console-summary");
  const currentEl = documentRoot.getElementById("t402-console-current");
  const offersEl = documentRoot.getElementById("t402-console-offers");
  const routesEl = documentRoot.getElementById("t402-console-routes");
  const escrowsEl = documentRoot.getElementById("t402-console-escrows");
  const denialsEl = documentRoot.getElementById("t402-console-denials");
  const traceEl = documentRoot.getElementById("t402-console-trace");
  const boundaryEl = documentRoot.getElementById("t402-console-boundary");
  if (!panel || !closeButton || !replayButton || !resetButton || !statusEl || !summaryEl || !currentEl || !offersEl || !routesEl || !escrowsEl || !denialsEl || !traceEl) {
    throw new Error("T402 console mount points are missing");
  }

  let summary = summarizeT402(projection);
  let selectedId = summary.records[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let trace = [];

  function selectedRecord() {
    return summary.records.find((record) => record.id === selectedId) ?? summary.records[0] ?? null;
  }

  function setOpen(next) {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList?.toggle?.("visible", opened);
    panel.setAttribute?.("aria-hidden", String(!opened));
  }

  function pushTrace(entry) {
    trace = [deepFreeze({
      ...entry,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      custody: false,
      signing: false,
      settlement: false,
      executable: false,
    }), ...trace].slice(0, 12);
  }

  function renderSummary() {
    summaryEl.replaceChildren();
    [
      [summary.offerCount, "offers"],
      [summary.routeCount, "routes"],
      [summary.escrowCount, "holds"],
      [summary.denialCount, "blocked live"],
    ].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div");
      metric.className = "t402-console-metric";
      metric.append(createText(documentRoot, "b", "t402-console-metric-value", value), createText(documentRoot, "span", "t402-console-metric-label", label));
      summaryEl.appendChild(metric);
    });
  }

  function renderCurrent() {
    const record = selectedRecord();
    if (!record) currentEl.textContent = "NO T402 RECORDS";
    else if (record.kind === "t402-route-rehearsal") currentEl.textContent = `${record.displayLabel} · ${record.simulatedAmount} ${record.unit} · ${(record.state ?? "rehearsal").toUpperCase()} · NO MOVEMENT`;
    else if (record.kind === "t402-escrow-rehearsal") currentEl.textContent = `${record.displayLabel} · ${record.simulatedAmount} ${record.unit} · ${(record.state ?? "rehearsal").toUpperCase()} · NO CUSTODY`;
    else if (record.kind === "t402-live-movement-denial") currentEl.textContent = `${record.displayLabel} · DENIED · NO LIVE VALUE AUTHORITY`;
    else currentEl.textContent = `${record.displayLabel} · ${record.simulatedAmount} ${record.unit} · ${(record.state ?? "open").toUpperCase()} · SIMULATION ONLY`;
    statusEl.textContent = trace.length
      ? `READY · ${trace.length} LOCAL STEP${trace.length === 1 ? "" : "S"} · LIVE MOVEMENT DENIED`
      : "READY · OFFER → ROUTE → HOLD · LOCAL ONLY";
    replayButton.disabled = summary.records.length === 0;
    resetButton.disabled = trace.length === 0 && selectedId === (summary.records[0]?.id ?? null);
    if (boundaryEl) boundaryEl.textContent = summary.boundary;
  }

  function recordButton(record) {
    const button = documentRoot.createElement("button");
    button.type = "button";
    button.className = "t402-console-record";
    button.dataset.recordId = record.id;
    button.setAttribute("aria-pressed", String(record.id === selectedId));
    const meta = record.kind === "t402-route-rehearsal"
      ? `${record.displayKind} · ${record.state ?? "rehearsal"}`
      : record.kind === "t402-escrow-rehearsal"
        ? `${record.displayKind} · ${record.state ?? "rehearsal"}`
        : record.kind === "t402-live-movement-denial"
          ? `${record.displayKind} · ${record.status}`
          : `${record.displayKind} · ${record.state ?? "open"}`;
    button.append(createText(documentRoot, "strong", "t402-console-record-title", record.displayLabel), createText(documentRoot, "span", "t402-console-record-meta", meta));
    button.addEventListener("click", () => selectRecord(record.id, "button"));
    return button;
  }

  function renderStage(element, records, emptyCopy) {
    element.replaceChildren();
    if (!records.length) {
      element.appendChild(createText(documentRoot, "div", "t402-console-empty", emptyCopy));
      return;
    }
    records.forEach((record) => element.appendChild(recordButton(record)));
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "t402-console-empty", "No local step yet. Select a stage to inspect the route."));
      return;
    }
    trace.forEach((entry, index) => traceEl.appendChild(createText(documentRoot, "div", "t402-console-trace-row", `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "all stages"} · LOCAL ONLY`)));
  }

  function render() {
    renderSummary();
    renderStage(offersEl, summary.offers, "No fictional offer is projected.");
    renderStage(routesEl, summary.routes, "No route rehearsal is projected.");
    renderStage(escrowsEl, summary.escrows, "No escrow rehearsal is projected.");
    renderStage(denialsEl, summary.denials, "No live-movement denial is projected.");
    renderCurrent();
    renderTrace();
  }

  function selectRecord(recordId, method = "button") {
    const record = summary.records.find((candidate) => candidate.id === recordId);
    if (!record) return null;
    selectedId = record.id;
    const snapshot = deepFreeze({
      source: T402_CONSOLE_SOURCE,
      action: "select",
      method,
      recordId: record.id,
      record,
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      custody: false,
      signing: false,
      settlement: false,
      executable: false,
    });
    pushTrace({ action: "select", recordId: record.id });
    render();
    onSelect?.(snapshot);
    return snapshot;
  }

  function replay(method = "button") {
    const record = selectedRecord();
    const snapshot = deepFreeze({
      source: T402_CONSOLE_SOURCE,
      action: "replay",
      method,
      recordId: record?.id ?? null,
      record,
      sequence: ["offer", "route", "hold"],
      replayedRecordCount: summary.recordCount,
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      custody: false,
      signing: false,
      settlement: false,
      executable: false,
    });
    pushTrace({ action: "replay", recordId: record?.id ?? null });
    render();
    onReplay?.(snapshot);
    return snapshot;
  }

  function reset(method = "button") {
    selectedId = summary.records[0]?.id ?? null;
    trace = [];
    const snapshot = deepFreeze({
      source: T402_CONSOLE_SOURCE,
      action: "reset",
      method,
      recordId: selectedId,
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      custody: false,
      signing: false,
      settlement: false,
      executable: false,
    });
    render();
    onReset?.(snapshot);
    return snapshot;
  }

  function syncProjection(nextProjection) {
    summary = summarizeT402(nextProjection);
    if (!summary.records.some((record) => record.id === selectedId)) selectedId = summary.records[0]?.id ?? null;
    render();
    return getSnapshot();
  }

  function getSnapshot() {
    return deepFreeze({
      source: T402_CONSOLE_SOURCE,
      summary,
      selectedId,
      selectedRecord: selectedRecord(),
      opened,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      custody: false,
      signing: false,
      settlement: false,
      executable: false,
      boundary: summary.boundary,
    });
  }

  closeButton.addEventListener("click", () => setOpen(false));
  replayButton.addEventListener("click", () => replay("button"));
  resetButton.addEventListener("click", () => reset("button"));
  documentRoot.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false);
  });
  render();
  setOpen(opened);

  return Object.freeze({
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!opened),
    selectRecord,
    selectOffer: (id, method) => selectRecord(id, method),
    selectRoute: (id, method) => selectRecord(id, method),
    selectEscrow: (id, method) => selectRecord(id, method),
    selectDenial: (id, method) => selectRecord(id, method),
    replay,
    reset,
    syncProjection,
    setProjection: syncProjection,
    getSnapshot,
    destroy: () => {},
  });
}

export const createT402Layer = createT402Console;
export const createT402RoutingConsole = createT402Console;
export default createT402Console;
