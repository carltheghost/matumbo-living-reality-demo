import {
  PAYCORE_ASSET_TOKEN_ENTITY_KINDS,
  PAYCORE_ENTITY_KINDS,
  normalizePaycoreEntityKind,
  PAYCORE_SOURCE,
} from "../domains/paycore.js?v=20260922-cache2";

export const PAYCORE_CONSOLE_SOURCE = "paycore-console";
export const PAYCORE_RENDER_SOURCE = PAYCORE_CONSOLE_SOURCE;
const DEFAULT_BOUNDARY = "PAYCORE is a local TUMBO asset-token balance and flow preview. No custody, signing, transfer, or settlement authority is active.";

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
  if (projection?.source === PAYCORE_SOURCE) return projection;
  return asArray(projection?.contributions).find((contribution) => contribution?.source === PAYCORE_SOURCE)
    ?? { source: PAYCORE_SOURCE, updatedAt: null, entities: [], evidence: [], capabilities: [] };
}

/** Read the canonical PAYCORE contribution into renderer-safe balance/flow lists. */
export function summarizePaycore(projection) {
  const contribution = contributionFrom(projection);
  const entities = asArray(contribution.entities);
  // Accept canonical asset-token kinds and the explicit historical coin-* aliases
  // only through the domain parser boundary. Unknown kinds are ignored; the
  // normalized projected shape always emits the canonical asset-token kind.
  const balances = entities
    .filter((entity) => normalizePaycoreEntityKind(entity?.kind) === PAYCORE_ENTITY_KINDS.BALANCE)
    .map((entity) => deepFreeze({ ...entity, kind: PAYCORE_ASSET_TOKEN_ENTITY_KINDS.BALANCE }));
  const flows = entities
    .filter((entity) => normalizePaycoreEntityKind(entity?.kind) === PAYCORE_ENTITY_KINDS.FLOW)
    .map((entity) => deepFreeze({ ...entity, kind: PAYCORE_ASSET_TOKEN_ENTITY_KINDS.FLOW }));
  const byId = new Map(balances.map((balance) => [balance.id, balance]));
  const flowViews = flows.map((flow) => deepFreeze({
    ...flow,
    from: byId.get(flow.fromBalanceId)?.label ?? flow.fromBalanceId,
    to: byId.get(flow.toBalanceId)?.label ?? flow.toBalanceId,
  }));
  return deepFreeze({
    source: PAYCORE_SOURCE,
    updatedAt: contribution.updatedAt,
    balances,
    flows: flowViews,
    balanceCount: balances.length,
    flowCount: flowViews.length,
    recordCount: balances.length + flowViews.length,
    evidenceCount: asArray(contribution.evidence).length,
    capabilityCount: asArray(contribution.capabilities).length,
    simulation: contribution.simulation === true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    persistence: false,
    boundary: contribution.evidence?.[0]?.note ?? DEFAULT_BOUNDARY,
  });
}

export function createPaycoreConsole({
  documentRoot = globalThis.document,
  projection = null,
  onSelect = null,
  onPreview = null,
  onReplay = null,
  onReset = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("PAYCORE console needs a document-like owner");
  const panel = documentRoot.getElementById("paycore-console");
  const closeButton = documentRoot.getElementById("paycore-console-close");
  const replayButton = documentRoot.getElementById("paycore-console-replay");
  const resetButton = documentRoot.getElementById("paycore-console-reset");
  const statusEl = documentRoot.getElementById("paycore-console-status");
  const summaryEl = documentRoot.getElementById("paycore-console-summary");
  const currentEl = documentRoot.getElementById("paycore-console-current");
  const balancesEl = documentRoot.getElementById("paycore-console-balances");
  const flowsEl = documentRoot.getElementById("paycore-console-flows");
  const traceEl = documentRoot.getElementById("paycore-console-trace");
  const boundaryEl = documentRoot.getElementById("paycore-console-boundary");
  if (!panel || !closeButton || !replayButton || !resetButton || !statusEl || !summaryEl || !currentEl || !balancesEl || !flowsEl || !traceEl) {
    throw new Error("PAYCORE console mount points are missing");
  }

  let summary = summarizePaycore(projection);
  let selectedType = summary.balances[0] ? "balance" : "flow";
  let selectedId = summary.balances[0]?.id ?? summary.flows[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let trace = [];

  function selectedRecord() {
    const pool = selectedType === "flow" ? summary.flows : summary.balances;
    return pool.find((record) => record.id === selectedId) ?? summary.balances[0] ?? summary.flows[0] ?? null;
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
      executable: false,
    }), ...trace].slice(0, 12);
  }

  function renderSummary() {
    summaryEl.replaceChildren();
    [
      [summary.balanceCount, "balances"],
      [summary.flowCount, "flow previews"],
      [summary.recordCount, "linked records"],
    ].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div");
      metric.className = "paycore-console-metric";
      metric.append(createText(documentRoot, "b", "paycore-console-metric-value", value), createText(documentRoot, "span", "paycore-console-metric-label", label));
      summaryEl.appendChild(metric);
    });
  }

  function recordButton(record, type) {
    const button = documentRoot.createElement("button");
    button.type = "button";
    button.className = "paycore-console-record";
    button.dataset[`${type}Id`] = record.id;
    button.setAttribute("aria-pressed", String(type === selectedType && record.id === selectedId));
    const secondary = type === "flow"
      ? `${record.from} → ${record.to} · ${record.status ?? "preview"}`
      : `${record.unit} · ${record.amount} simulated units`;
    button.append(createText(documentRoot, "strong", "paycore-console-record-title", record.label ?? record.id), createText(documentRoot, "span", "paycore-console-record-meta", secondary));
    button.addEventListener("click", () => selectRecord(record.id, type, "button"));
    return button;
  }

  function renderLists() {
    balancesEl.replaceChildren();
    flowsEl.replaceChildren();
    if (!summary.balances.length) balancesEl.appendChild(createText(documentRoot, "div", "paycore-console-empty", "No simulated balances are projected."));
    summary.balances.forEach((balance) => balancesEl.appendChild(recordButton(balance, "balance")));
    if (!summary.flows.length) flowsEl.appendChild(createText(documentRoot, "div", "paycore-console-empty", "No simulated flows are projected."));
    summary.flows.forEach((flow) => flowsEl.appendChild(recordButton(flow, "flow")));
  }

  function renderCurrent() {
    const record = selectedRecord();
    if (!record) currentEl.textContent = "NO PAYCORE ASSET-TOKEN RECORDS";
    else if (selectedType === "flow") currentEl.textContent = `${record.from} → ${record.to} · ${record.amount} ${record.unit} · ASSET-TOKEN FLOW ${(record.status ?? "preview").toUpperCase()} · NO TRANSFER`;
    else currentEl.textContent = `${record.label} · ${record.amount} ${record.unit} · ASSET-TOKEN BALANCE PREVIEW ONLY`;
    statusEl.textContent = trace.length
      ? `READY · ${trace.length} LOCAL PREVIEW${trace.length === 1 ? "" : "S"} · NO CUSTODY`
      : "READY · SELECT AN ASSET-TOKEN BALANCE OR FLOW PREVIEW";
    replayButton.disabled = !record;
    resetButton.disabled = trace.length === 0 && selectedId === (summary.balances[0]?.id ?? summary.flows[0]?.id ?? null);
    if (boundaryEl) boundaryEl.textContent = summary.boundary;
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "paycore-console-empty", "No local preview yet. Select a balance or flow to inspect it."));
      return;
    }
    trace.forEach((entry, index) => traceEl.appendChild(createText(documentRoot, "div", "paycore-console-trace-row", `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "all records"} · LOCAL ONLY`)));
  }

  function render() {
    renderSummary();
    renderLists();
    renderCurrent();
    renderTrace();
  }

  function selectRecord(recordId, type = "balance", method = "button") {
    const pool = type === "flow" ? summary.flows : summary.balances;
    const record = pool.find((candidate) => candidate.id === recordId);
    if (!record) return null;
    selectedType = type;
    selectedId = record.id;
    const snapshot = deepFreeze({
      source: PAYCORE_CONSOLE_SOURCE,
      action: "select",
      method,
      recordType: type,
      recordId: record.id,
      record,
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    pushTrace({ action: "select", recordId: record.id, recordType: type });
    render();
    onSelect?.(snapshot);
    if (type === "flow") onPreview?.(deepFreeze({ ...snapshot, action: "preview-flow" }));
    return snapshot;
  }

  function previewFlow(flowId = selectedId, method = "button") {
    return selectRecord(flowId, "flow", method);
  }

  function replay(method = "button") {
    const record = selectedRecord();
    const snapshot = deepFreeze({
      source: PAYCORE_CONSOLE_SOURCE,
      action: "replay",
      method,
      recordType: selectedType,
      recordId: record?.id ?? null,
      record,
      replayedRecordCount: summary.recordCount,
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    pushTrace({ action: "replay", recordId: record?.id ?? null });
    render();
    onReplay?.(snapshot);
    return snapshot;
  }

  function reset(method = "button") {
    selectedType = summary.balances[0] ? "balance" : "flow";
    selectedId = summary.balances[0]?.id ?? summary.flows[0]?.id ?? null;
    trace = [];
    const snapshot = deepFreeze({
      source: PAYCORE_CONSOLE_SOURCE,
      action: "reset",
      method,
      recordType: selectedType,
      recordId: selectedId,
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    render();
    onReset?.(snapshot);
    return snapshot;
  }

  function syncProjection(nextProjection) {
    summary = summarizePaycore(nextProjection);
    if (!(selectedType === "flow" ? summary.flows : summary.balances).some((record) => record.id === selectedId)) {
      selectedType = summary.balances[0] ? "balance" : "flow";
      selectedId = summary.balances[0]?.id ?? summary.flows[0]?.id ?? null;
    }
    render();
    return getSnapshot();
  }

  function getSnapshot() {
    return deepFreeze({
      source: PAYCORE_CONSOLE_SOURCE,
      summary,
      selectedType,
      selectedId,
      selectedRecord: selectedRecord(),
      opened,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
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
    selectBalance: (id, method) => selectRecord(id, "balance", method),
    selectFlow: (id, method) => selectRecord(id, "flow", method),
    previewFlow,
    replay,
    reset,
    syncProjection,
    setProjection: syncProjection,
    getSnapshot,
    destroy: () => {},
  });
}

export const createPaycoreLayer = createPaycoreConsole;
export const createPaycoreRenderer = createPaycoreConsole;
export default createPaycoreConsole;
