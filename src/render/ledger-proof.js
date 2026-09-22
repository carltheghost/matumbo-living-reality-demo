import { LEDGER_PROOF_SOURCE } from "../domains/ledger-proof.js?v=20260922-cache2";

export const LEDGER_PROOF_CONSOLE_SOURCE = "ledger-proof-console";
export const LEDGER_PROOF_RENDER_SOURCE = LEDGER_PROOF_CONSOLE_SOURCE;

const DEFAULT_BOUNDARY =
  "Prime Ledger and EchoProof are local summaries only. No authoritative ledger, cryptographic verification, signing, settlement, or publishing authority is active.";

const freeze = (value) => Object.freeze(value);
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function deepFreeze(value) {
  if (Array.isArray(value)) { value.forEach((entry) => deepFreeze(entry)); return freeze(value); }
  if (!isRecord(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return freeze(value);
}
function asArray(value) { return Array.isArray(value) ? value : []; }
function text(value, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}
function contributionFrom(projection) {
  if (projection?.source === LEDGER_PROOF_SOURCE) return projection;
  return asArray(projection?.contributions).find((contribution) => contribution?.source === LEDGER_PROOF_SOURCE)
    ?? { source: LEDGER_PROOF_SOURCE, updatedAt: null, entities: [], evidence: [], capabilities: [] };
}

function enrichLedger(record) {
  return deepFreeze({ ...record, recordType: "ledger", displayKind: "balanced journal", displayLabel: text(record.label ?? record.id) });
}

function enrichProof(record, byId) {
  const parentLabels = asArray(record.directParentIds).map((id) => byId.get(id)?.label ?? id);
  const ancestorLabels = asArray(record.ancestorIds).map((id) => byId.get(id)?.label ?? id);
  return deepFreeze({
    ...record,
    recordType: "proof",
    displayKind: "proof ancestry",
    displayLabel: text(record.label ?? record.id),
    parentLabels,
    ancestorLabels,
  });
}

/** Read balanced journal records and declared proof ancestry safely. */
export function summarizeLedgerProof(projection) {
  const contribution = contributionFrom(projection);
  const entities = asArray(contribution.entities);
  const rawProofs = entities.filter((entity) => entity?.kind === "proof-ancestry-summary");
  const proofById = new Map(rawProofs.map((proof) => [proof.id, proof]));
  const ledger = entities.filter((entity) => entity?.kind === "balanced-record-summary").map(enrichLedger);
  const proofs = rawProofs.map((proof) => enrichProof(proof, proofById));
  const records = [...ledger, ...proofs];
  return deepFreeze({
    source: LEDGER_PROOF_SOURCE,
    updatedAt: contribution.updatedAt,
    records,
    ledger,
    proofs,
    ledgerCount: ledger.length,
    proofCount: proofs.length,
    balancedCount: ledger.filter((record) => record.status === "balanced").length,
    ancestryEdgeCount: proofs.reduce((count, proof) => count + proof.directParentIds.length, 0),
    recordCount: records.length,
    evidenceCount: asArray(contribution.evidence).length,
    capabilityCount: asArray(contribution.capabilities).length,
    simulation: contribution.simulation === true,
    authoritative: false,
    localOnly: true,
    externalNetwork: false,
    signing: false,
    settlement: false,
    cryptographicVerification: false,
    publishing: false,
    executable: false,
    persistence: false,
    boundary: contribution.evidence?.[0]?.note ?? DEFAULT_BOUNDARY,
  });
}

export function createLedgerProofConsole({
  documentRoot = globalThis.document,
  projection = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Prime Ledger console needs a document-like owner");
  const panel = documentRoot.getElementById("ledger-proof-console");
  const closeButton = documentRoot.getElementById("ledger-proof-close");
  const replayButton = documentRoot.getElementById("ledger-proof-replay");
  const resetButton = documentRoot.getElementById("ledger-proof-reset");
  const statusEl = documentRoot.getElementById("ledger-proof-status");
  const summaryEl = documentRoot.getElementById("ledger-proof-summary");
  const currentEl = documentRoot.getElementById("ledger-proof-current");
  const ledgerEl = documentRoot.getElementById("ledger-proof-ledger");
  const proofsEl = documentRoot.getElementById("ledger-proof-proofs");
  const traceEl = documentRoot.getElementById("ledger-proof-trace");
  const boundaryEl = documentRoot.getElementById("ledger-proof-boundary");
  if (!panel || !closeButton || !replayButton || !resetButton || !statusEl || !summaryEl || !currentEl || !ledgerEl || !proofsEl || !traceEl) {
    throw new Error("Prime Ledger console mount points are missing");
  }

  let summary = summarizeLedgerProof(projection);
  let selectedType = summary.ledger[0] ? "ledger" : "proof";
  let selectedId = summary[selectedType]?.[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let trace = [];

  function recordsFor(type) { return type === "proof" ? summary.proofs : summary.ledger; }
  function selectedRecord() { return recordsFor(selectedType).find((record) => record.id === selectedId) ?? summary.records[0] ?? null; }
  function setOpen(next) { opened = Boolean(next); panel.hidden = !opened; panel.classList?.toggle?.("visible", opened); panel.setAttribute?.("aria-hidden", String(!opened)); }
  function pushTrace(entry) {
    trace = [deepFreeze({ ...entry, localOnly: true, simulation: true, authoritative: false, externalNetwork: false, signing: false, settlement: false, cryptographicVerification: false, executable: false }), ...trace].slice(0, 12);
  }
  function renderSummary() {
    summaryEl.replaceChildren();
    [[summary.ledgerCount, "journal records"], [summary.balancedCount, "balanced"], [summary.proofCount, "proof nodes"], [summary.ancestryEdgeCount, "parent links"]].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div"); metric.className = "ledger-proof-metric";
      metric.append(createText(documentRoot, "b", "ledger-proof-metric-value", value), createText(documentRoot, "span", "ledger-proof-metric-label", label)); summaryEl.appendChild(metric);
    });
  }
  function recordButton(record, type) {
    const button = documentRoot.createElement("button"); button.type = "button"; button.className = "ledger-proof-record"; button.dataset.recordId = record.id; button.dataset[`${type}Id`] = record.id; button.setAttribute("aria-pressed", String(type === selectedType && record.id === selectedId));
    const meta = type === "ledger" ? `${record.status} · ${record.entryCount} entries · ${record.unit}` : `generation ${record.generation} · ${record.directParentIds.length} parent link${record.directParentIds.length === 1 ? "" : "s"}`;
    button.append(createText(documentRoot, "strong", "ledger-proof-record-title", record.displayLabel), createText(documentRoot, "span", "ledger-proof-record-meta", meta));
    button.addEventListener("click", () => selectRecord(record.id, type, "button")); return button;
  }
  function renderStage(element, records, type, emptyCopy) { element.replaceChildren(); if (!records.length) { element.appendChild(createText(documentRoot, "div", "ledger-proof-empty", emptyCopy)); return; } records.forEach((record) => element.appendChild(recordButton(record, type))); }
  function renderCurrent() {
    const record = selectedRecord();
    if (!record) currentEl.textContent = "NO LEDGER OR PROOF RECORDS";
    else if (selectedType === "ledger") currentEl.textContent = `${record.displayLabel} · ${record.status.toUpperCase()} · DEBIT ${record.debitTotal} / CREDIT ${record.creditTotal} ${record.unit} · SUMMARY ONLY`;
    else currentEl.textContent = `${record.displayLabel} · GENERATION ${record.generation} · PARENTS ${record.parentLabels.join(", ") || "ROOT"} · NOT VERIFIED`;
    statusEl.textContent = trace.length ? `READY · ${trace.length} LOCAL INSPECTION${trace.length === 1 ? "" : "S"} · NO AUTHORITY` : "READY · JOURNAL → PROOF ANCESTRY · LOCAL ONLY";
    replayButton.disabled = !record; resetButton.disabled = trace.length === 0 && selectedId === (summary.records[0]?.id ?? null); if (boundaryEl) boundaryEl.textContent = summary.boundary;
  }
  function renderTrace() { traceEl.replaceChildren(); if (!trace.length) { traceEl.appendChild(createText(documentRoot, "div", "ledger-proof-empty", "No local inspection yet. Select the journal or a proof node.")); return; } trace.forEach((entry, index) => traceEl.appendChild(createText(documentRoot, "div", "ledger-proof-trace-row", `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "all records"} · LOCAL ONLY`))); }
  function render() { renderSummary(); renderStage(ledgerEl, summary.ledger, "ledger", "No balanced journal record is projected."); renderStage(proofsEl, summary.proofs, "proof", "No proof ancestry node is projected."); renderCurrent(); renderTrace(); }
  function selectRecord(recordId, type = "ledger", method = "button") {
    const record = recordsFor(type).find((candidate) => candidate.id === recordId); if (!record) return null; selectedType = type; selectedId = record.id;
    const snapshot = deepFreeze({ source: LEDGER_PROOF_CONSOLE_SOURCE, action: "select", method, recordType: type, recordId: record.id, record, summary, localOnly: true, simulation: true, authoritative: false, externalNetwork: false, signing: false, settlement: false, cryptographicVerification: false, executable: false });
    pushTrace({ action: "select", recordId: record.id, recordType: type }); render(); onSelect?.(snapshot); return snapshot;
  }
  function replay(method = "button") {
    const record = selectedRecord();
    const sequence = selectedType === "proof" ? [record?.directParentIds ?? [], record?.id ?? null].flat().filter(Boolean) : [record?.id ?? null].filter(Boolean);
    const snapshot = deepFreeze({ source: LEDGER_PROOF_CONSOLE_SOURCE, action: "replay", method, recordType: selectedType, recordId: record?.id ?? null, sequence, replayedRecordCount: summary.recordCount, record, summary, localOnly: true, simulation: true, authoritative: false, externalNetwork: false, signing: false, settlement: false, cryptographicVerification: false, executable: false });
    pushTrace({ action: "replay", recordId: record?.id ?? null, recordType: selectedType }); render(); onReplay?.(snapshot); return snapshot;
  }
  function reset(method = "button") { selectedType = summary.ledger[0] ? "ledger" : "proof"; selectedId = summary[selectedType]?.[0]?.id ?? null; trace = []; const snapshot = deepFreeze({ source: LEDGER_PROOF_CONSOLE_SOURCE, action: "reset", method, recordType: selectedType, recordId: selectedId, summary, localOnly: true, simulation: true, authoritative: false, externalNetwork: false, signing: false, settlement: false, cryptographicVerification: false, executable: false }); render(); onReset?.(snapshot); return snapshot; }
  function syncProjection(nextProjection) { summary = summarizeLedgerProof(nextProjection); if (!recordsFor(selectedType).some((record) => record.id === selectedId)) { selectedType = summary.ledger[0] ? "ledger" : "proof"; selectedId = summary[selectedType]?.[0]?.id ?? null; } render(); return getSnapshot(); }
  function getSnapshot() { return deepFreeze({ source: LEDGER_PROOF_CONSOLE_SOURCE, summary, selectedType, selectedId, selectedRecord: selectedRecord(), opened, trace, localOnly: true, simulation: true, authoritative: false, externalNetwork: false, signing: false, settlement: false, cryptographicVerification: false, executable: false, boundary: summary.boundary }); }
  closeButton.addEventListener("click", () => setOpen(false)); replayButton.addEventListener("click", () => replay("button")); resetButton.addEventListener("click", () => reset("button")); documentRoot.addEventListener?.("keydown", (event) => { if (event.key === "Escape" && opened) setOpen(false); }); render(); setOpen(opened);
  return Object.freeze({ open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen(!opened), selectRecord, selectLedger: (id, method) => selectRecord(id, "ledger", method), selectProof: (id, method) => selectRecord(id, "proof", method), replay, reset, syncProjection, setProjection: syncProjection, getSnapshot, destroy: () => {} });
}

export const createLedgerProofLayer = createLedgerProofConsole;
export const createPrimeLedgerConsole = createLedgerProofConsole;
export default createLedgerProofConsole;
