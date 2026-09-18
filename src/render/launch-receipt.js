/**
 * Launch Rehearsal Receipt.
 *
 * This is a deterministic, renderer-only receipt for the existing fictional
 * TUMBO-SIM launch/distribution projection.  It joins the canonical registry
 * rows to exact fixed-supply reconciliation fields so a viewer can inspect
 * what the demo rehearsed without confusing the result for an issued asset,
 * a transfer, a wallet receipt, or a real-world distribution.
 *
 * The adapter deliberately has no arbitrary file-import, network, clipboard,
 * provider, or executable-code path. Receipt JSON is accepted only as
 * in-memory data and is copied through a descriptor-safe validator before it
 * is retained. The optional Download JSON action is a user-triggered browser
 * export of that validated text; it does not import files, persist app state,
 * or share anything externally.
 */
import { DEFAULT_LAUNCH_DISTRIBUTION_PREVIEW } from "../domains/distribution-registry.js";
import { summarizeLaunchDistribution } from "./launch-console.js";

export const LAUNCH_RECEIPT_CONSOLE_SOURCE = "launch-rehearsal-receipt-console";
export const LAUNCH_RECEIPT_SOURCE = "launch-rehearsal-receipt";
export const LAUNCH_RECEIPT_RENDER_SOURCE = LAUNCH_RECEIPT_CONSOLE_SOURCE;
export const LAUNCH_RECEIPT_SCHEMA_VERSION = 1;
export const LAUNCH_RECEIPT_DOWNLOAD_FILENAME = "matumbo-tumbo-sim-launch-rehearsal-receipt.json";
export const LAUNCH_RECEIPT_SEQUENCE = Object.freeze([
  "launch-event",
  "allocation-cohorts",
  "basis-point-reconciliation",
  "local-boundary",
]);
export const LAUNCH_RECEIPT_BOUNDARY =
  "Launch Rehearsal Receipt is a deterministic TUMBO-SIM projection only; it does not issue or distribute a real asset, custody value, connect a wallet, sign, transfer, exchange, persist app state, contact a network, or execute code. Download JSON is an optional user-triggered local browser export only; it does not import files or share externally.";

/** Stable mount ids for a host page that wants to wire the optional console. */
export const LAUNCH_RECEIPT_DOM_IDS = Object.freeze({
  panel: "launch-receipt-console",
  close: "launch-receipt-close",
  replay: "launch-receipt-replay",
  reset: "launch-receipt-reset",
  download: "launch-receipt-download",
  status: "launch-receipt-status",
  summary: "launch-receipt-summary",
  current: "launch-receipt-current",
  cohorts: "launch-receipt-cohorts",
  reconciliation: "launch-receipt-reconciliation",
  json: "launch-receipt-json",
  trace: "launch-receipt-trace",
  boundary: "launch-receipt-boundary",
});

const TOTAL_BASIS_POINTS = 10_000;
const DEFAULT_TOTAL_SUPPLY = 1_000_000_000;
const MAX_RECEIPT_TEXT_LENGTH = 256_000;
const MAX_COHORTS = 64;
const integerFormatter = new Intl.NumberFormat("en-US");
const FORBIDDEN_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "eval",
  "function",
  "script",
  "module",
  "import",
  "command",
  "execute",
  "run",
  "publish",
  "transferto",
]);

const RECEIPT_FLAGS = Object.freeze({
  simulation: true,
  localOnly: true,
  deterministic: true,
  realIssuance: false,
  liveIssuance: false,
  issuance: false,
  externalDistribution: false,
  realDistribution: false,
  wallet: false,
  walletConnection: false,
  custody: false,
  signing: false,
  transfer: false,
  externalTransfer: false,
  exchange: false,
  market: false,
  persistence: false,
  network: false,
  externalNetwork: false,
  provider: false,
  externalProvider: false,
  settlement: false,
  realMoney: false,
  executable: false,
});

const freeze = (value) => Object.freeze(value);
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function text(value, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function safeInteger(value, fallback = 0) { return Number.isSafeInteger(value) ? value : fallback; }
function deepFreeze(value) {
  if (Array.isArray(value)) { value.forEach((entry) => deepFreeze(entry)); return freeze(value); }
  if (!isRecord(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return freeze(value);
}
function formatInteger(value) { return Number.isSafeInteger(value) ? integerFormatter.format(value) : "—"; }
function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}
function bool(value, expected) { return value === expected; }

function canonicalProjection(projection) {
  return projection ?? DEFAULT_LAUNCH_DISTRIBUTION_PREVIEW;
}

function canonicalSummary(projection) {
  return summarizeLaunchDistribution(canonicalProjection(projection));
}

function flagsWithBoundary() {
  return { ...RECEIPT_FLAGS, authority: "none", boundary: LAUNCH_RECEIPT_BOUNDARY };
}

function normalizeCohort(row, index) {
  return {
    id: text(row?.id, `registry-row-${index + 1}`),
    label: text(row?.label ?? row?.recipientLabel, `Fictional cohort ${index + 1}`),
    recipientClass: text(row?.recipientClass, "aggregate fictional cohort"),
    coverage: text(row?.coverage, "aggregate fictional coverage"),
    allocationId: text(row?.allocationId),
    basisPoints: safeInteger(row?.basisPoints ?? row?.shareBasisPoints),
    percentage: Number.isFinite(row?.percentage)
      ? row.percentage
      : Number.isFinite(row?.percent)
        ? row.percent
        : safeInteger(row?.basisPoints ?? row?.shareBasisPoints) / 100,
    tokenUnits: safeInteger(row?.tokenUnits ?? row?.units),
    status: text(row?.status, "simulated"),
    simulation: true,
    fictional: true,
    aggregate: true,
    executable: false,
  };
}

function reconciliationFor(summary, cohorts) {
  const totalBasisPoints = cohorts.reduce((sum, cohort) => sum + cohort.basisPoints, 0);
  const totalTokenUnits = cohorts.reduce((sum, cohort) => sum + cohort.tokenUnits, 0);
  const expectedBasisPoints = safeInteger(summary.expectedBasisPoints, TOTAL_BASIS_POINTS);
  const expectedTokenUnits = safeInteger(summary.expectedUnits, safeInteger(summary.totalSupply, DEFAULT_TOTAL_SUPPLY));
  const totalSupply = safeInteger(summary.totalSupply, DEFAULT_TOTAL_SUPPLY);
  const expectedSupply = safeInteger(summary.expectedTotalSupply, totalSupply);
  const basisPoints = {
    actual: totalBasisPoints,
    expected: expectedBasisPoints,
    delta: totalBasisPoints - expectedBasisPoints,
    exact: totalBasisPoints === expectedBasisPoints,
  };
  const tokenUnits = {
    actual: totalTokenUnits,
    expected: expectedTokenUnits,
    delta: totalTokenUnits - expectedTokenUnits,
    exact: totalTokenUnits === expectedTokenUnits,
  };
  const supply = {
    actual: totalTokenUnits,
    expected: expectedSupply,
    delta: totalTokenUnits - expectedSupply,
    exact: totalTokenUnits === expectedSupply && totalSupply === expectedSupply,
  };
  const exact = basisPoints.exact && tokenUnits.exact && supply.exact;
  return {
    totalBasisPoints,
    expectedBasisPoints,
    totalTokenUnits,
    expectedTokenUnits,
    totalSupply,
    expectedSupply,
    basisPoints,
    tokenUnits,
    supply,
    exact,
    status: exact ? "verified" : "review",
  };
}

/**
 * Build one deterministic receipt from the canonical registry projection.
 * The optional projection is read only; allocation rows are copied into a
 * receipt-owned frozen value and no canonical object is mutated.
 */
export function createLaunchRehearsalReceipt(projection = null) {
  const summary = canonicalSummary(projection);
  const cohorts = summary.rows.map(normalizeCohort);
  const reconciliation = reconciliationFor(summary, cohorts);
  const receiptId = `launch-rehearsal-receipt:${summary.eventId}`;
  const receipt = {
    schemaVersion: LAUNCH_RECEIPT_SCHEMA_VERSION,
    source: LAUNCH_RECEIPT_SOURCE,
    kind: "asset-token-launch-rehearsal-receipt",
    receiptId,
    distributionSource: summary.source,
    launchId: summary.launchId,
    eventId: summary.eventId,
    eventStatus: summary.eventStatus,
    updatedAt: summary.updatedAt,
    unit: summary.unit,
    fixedSupply: true,
    totalSupply: reconciliation.totalSupply,
    cohortCount: cohorts.length,
    cohorts,
    // `allocationTotals` is intentionally an explicit name: consumers can
    // inspect the allocation map without treating this receipt as a ledger.
    allocationTotals: {
      cohortCount: cohorts.length,
      totalBasisPoints: reconciliation.totalBasisPoints,
      expectedBasisPoints: reconciliation.expectedBasisPoints,
      totalTokenUnits: reconciliation.totalTokenUnits,
      expectedTokenUnits: reconciliation.expectedTokenUnits,
      totalSupply: reconciliation.totalSupply,
      expectedSupply: reconciliation.expectedSupply,
      basisPointDelta: reconciliation.basisPoints.delta,
      tokenUnitDelta: reconciliation.tokenUnits.delta,
      exact: reconciliation.exact,
      status: reconciliation.status,
    },
    reconciliation,
    flags: flagsWithBoundary(),
    ...RECEIPT_FLAGS,
    authority: "none",
    boundary: LAUNCH_RECEIPT_BOUNDARY,
  };
  return deepFreeze(receipt);
}

export const createLaunchReceipt = createLaunchRehearsalReceipt;
export const createLaunchRehearsalReceiptSnapshot = createLaunchRehearsalReceipt;

export const DEFAULT_LAUNCH_REHEARSAL_RECEIPT = createLaunchRehearsalReceipt();

/** Pure summary alias for hosts that prefer a summarize-shaped API. */
export function summarizeLaunchRehearsalReceipt(projection = null) {
  return createLaunchRehearsalReceipt(projection);
}
export const summarizeLaunchReceipt = summarizeLaunchRehearsalReceipt;

export function serializeLaunchRehearsalReceipt(receipt = DEFAULT_LAUNCH_REHEARSAL_RECEIPT) {
  if (!isRecord(receipt)) throw new TypeError("Launch rehearsal receipt must be an object");
  return JSON.stringify(receipt, null, 2);
}
export const serializeLaunchReceipt = serializeLaunchRehearsalReceipt;

function errorRecord(code, path, message) { return { code, path, message }; }
function warningRecord(code, path, message) { return { code, path, message }; }

/**
 * Copy JSON data without invoking getters or retaining executable values.
 * A rejected value never reaches the canonical comparison or the console.
 */
function copyJsonValue(value, path, errors, seen, warnings) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(errorRecord("non-finite-number", path, `${path} must be a finite JSON number.`));
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    errors.push(errorRecord("non-json-value", path, `${path} contains a value that is not valid JSON data.`));
    return null;
  }
  if (!Array.isArray(value) && !isRecord(value)) {
    errors.push(errorRecord("non-json-object", path, `${path} must contain plain JSON data.`));
    return null;
  }
  if (seen.has(value)) {
    errors.push(errorRecord("cyclic-value", path, `${path} contains a cyclic reference.`));
    return null;
  }
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        errors.push(errorRecord("non-json-value", `${path}[${index}]`, `${path}[${index}] must be plain JSON data.`));
        copy.push(null);
      } else copy.push(copyJsonValue(descriptor.value, `${path}[${index}]`, errors, seen, warnings));
    }
  } else {
    copy = {};
    Object.keys(Object.getOwnPropertyDescriptors(value)).forEach((key) => {
      const childPath = path ? `${path}.${key}` : key;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        errors.push(errorRecord("forbidden-field", childPath, `${childPath} is not accepted in a receipt.`));
        return;
      }
      if (!descriptor || !("value" in descriptor)) {
        errors.push(errorRecord("non-json-value", childPath, `${childPath} must be plain JSON data.`));
        return;
      }
      copy[key] = copyJsonValue(descriptor.value, childPath, errors, seen, warnings);
    });
  }
  seen.delete(value);
  return copy;
}

function parseInput(input) {
  if (typeof input === "string") {
    if (input.length > MAX_RECEIPT_TEXT_LENGTH) return { value: null, errors: [errorRecord("receipt-too-large", "$", `Receipt JSON exceeds ${MAX_RECEIPT_TEXT_LENGTH} characters.`)], warnings: [] };
    if (!input.trim()) return { value: null, errors: [errorRecord("empty-receipt", "$", "Receipt JSON is empty.")], warnings: [] };
    try { return { value: JSON.parse(input), errors: [], warnings: [] }; }
    catch (error) { return { value: null, errors: [errorRecord("invalid-json", "$", `Receipt JSON could not be parsed: ${text(error?.message, "syntax error")}`)], warnings: [] }; }
  }
  return { value: input, errors: [], warnings: [] };
}

function compare(actual, expected, path, errors) {
  if (actual !== expected) errors.push(errorRecord("receipt-mismatch", path, `${path} must equal the canonical rehearsal value.`));
}

function validateFlags(snapshot, errors) {
  const flags = isRecord(snapshot?.flags) ? snapshot.flags : null;
  if (!flags) {
    errors.push(errorRecord("flags-required", "flags", "Receipt must include explicit simulation and authority flags."));
    return;
  }
  Object.entries(RECEIPT_FLAGS).forEach(([key, expected]) => compare(flags[key], expected, `flags.${key}`, errors));
  compare(flags.authority, "none", "flags.authority", errors);
  compare(flags.boundary, LAUNCH_RECEIPT_BOUNDARY, "flags.boundary", errors);
  Object.entries(RECEIPT_FLAGS).forEach(([key, expected]) => compare(snapshot[key], expected, key, errors));
  compare(snapshot.authority, "none", "authority", errors);
  compare(snapshot.boundary, LAUNCH_RECEIPT_BOUNDARY, "boundary", errors);
}

function validateCohorts(snapshot, canonical, errors) {
  const cohorts = asArray(snapshot?.cohorts);
  if (cohorts.length > MAX_COHORTS) errors.push(errorRecord("too-many-cohorts", "cohorts", `Receipt may contain at most ${MAX_COHORTS} cohorts.`));
  if (cohorts.length !== canonical.cohorts.length) errors.push(errorRecord("cohort-count", "cohorts", "Receipt cohort count must match the canonical registry."));
  const canonicalById = new Map(canonical.cohorts.map((cohort) => [cohort.id, cohort]));
  const seen = new Set();
  cohorts.forEach((cohort, index) => {
    const path = `cohorts[${index}]`;
    if (!isRecord(cohort)) { errors.push(errorRecord("cohort-shape", path, `${path} must be an object.`)); return; }
    if (typeof cohort.id !== "string" || !cohort.id) { errors.push(errorRecord("cohort-id", `${path}.id`, `${path}.id must be a non-empty string.`)); return; }
    if (seen.has(cohort.id)) errors.push(errorRecord("duplicate-cohort", `${path}.id`, `Duplicate cohort id: ${cohort.id}.`));
    seen.add(cohort.id);
    const expected = canonicalById.get(cohort.id);
    if (!expected) { errors.push(errorRecord("unknown-cohort", `${path}.id`, `Unknown canonical cohort: ${cohort.id}.`)); return; }
    ["label", "recipientClass", "coverage", "allocationId", "basisPoints", "percentage", "tokenUnits", "status", "simulation", "fictional", "aggregate", "executable"].forEach((key) => compare(cohort[key], expected[key], `${path}.${key}`, errors));
  });
}

function validateTotals(snapshot, canonical, errors) {
  const totals = isRecord(snapshot?.allocationTotals) ? snapshot.allocationTotals : null;
  if (!totals) { errors.push(errorRecord("totals-required", "allocationTotals", "Receipt must include allocationTotals.")); return; }
  ["cohortCount", "totalBasisPoints", "expectedBasisPoints", "totalTokenUnits", "expectedTokenUnits", "totalSupply", "expectedSupply", "basisPointDelta", "tokenUnitDelta", "exact", "status"].forEach((key) => compare(totals[key], canonical.allocationTotals[key], `allocationTotals.${key}`, errors));
  const reconciliation = isRecord(snapshot?.reconciliation) ? snapshot.reconciliation : null;
  if (!reconciliation) { errors.push(errorRecord("reconciliation-required", "reconciliation", "Receipt must include reconciliation details.")); return; }
  ["totalBasisPoints", "expectedBasisPoints", "totalTokenUnits", "expectedTokenUnits", "totalSupply", "expectedSupply", "exact", "status"].forEach((key) => compare(reconciliation[key], canonical.reconciliation[key], `reconciliation.${key}`, errors));
  ["basisPoints", "tokenUnits", "supply"].forEach((section) => {
    const actual = reconciliation[section];
    const expected = canonical.reconciliation[section];
    if (!isRecord(actual)) { errors.push(errorRecord("reconciliation-section", `reconciliation.${section}`, `reconciliation.${section} must be an object.`)); return; }
    ["actual", "expected", "delta", "exact"].forEach((key) => compare(actual[key], expected[key], `reconciliation.${section}.${key}`, errors));
  });
}

/** Validate a receipt against the canonical fixed registry without mutation. */
export function validateLaunchRehearsalReceipt(input = DEFAULT_LAUNCH_REHEARSAL_RECEIPT, projection = null) {
  const parsed = parseInput(input);
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  let snapshot = null;
  if (!errors.length) snapshot = copyJsonValue(parsed.value, "", errors, new WeakSet(), warnings);
  if (!errors.length && !isRecord(snapshot)) errors.push(errorRecord("receipt-shape", "$", "Receipt must be a JSON object."));
  const canonical = createLaunchRehearsalReceipt(projection);
  if (!errors.length) {
    compare(snapshot.schemaVersion, LAUNCH_RECEIPT_SCHEMA_VERSION, "schemaVersion", errors);
    compare(snapshot.source, LAUNCH_RECEIPT_SOURCE, "source", errors);
    compare(snapshot.kind, canonical.kind, "kind", errors);
    compare(snapshot.receiptId, canonical.receiptId, "receiptId", errors);
    compare(snapshot.distributionSource, canonical.distributionSource, "distributionSource", errors);
    compare(snapshot.launchId, canonical.launchId, "launchId", errors);
    compare(snapshot.eventId, canonical.eventId, "eventId", errors);
    compare(snapshot.eventStatus, canonical.eventStatus, "eventStatus", errors);
    compare(snapshot.unit, canonical.unit, "unit", errors);
    compare(snapshot.fixedSupply, true, "fixedSupply", errors);
    compare(snapshot.totalSupply, canonical.totalSupply, "totalSupply", errors);
    if (typeof snapshot.updatedAt !== "string" || !snapshot.updatedAt) errors.push(errorRecord("updated-at", "updatedAt", "updatedAt must be a non-empty string."));
    validateCohorts(snapshot, canonical, errors);
    validateTotals(snapshot, canonical, errors);
    validateFlags(snapshot, errors);
    ["label", "description", "notes"].forEach((key) => { if (key in snapshot) warnings.push(warningRecord("ignored-metadata", key, `${key} is display metadata and is ignored.`)); });
  }
  const result = {
    source: LAUNCH_RECEIPT_CONSOLE_SOURCE,
    schemaVersion: LAUNCH_RECEIPT_SCHEMA_VERSION,
    valid: errors.length === 0,
    receipt: errors.length === 0 ? deepFreeze(snapshot) : null,
    canonical,
    errors,
    warnings,
    cohortCount: errors.length === 0 ? asArray(snapshot.cohorts).length : 0,
    totalBasisPoints: errors.length === 0 ? snapshot.allocationTotals?.totalBasisPoints ?? 0 : 0,
    totalTokenUnits: errors.length === 0 ? snapshot.allocationTotals?.totalTokenUnits ?? 0 : 0,
    exact: errors.length === 0 && snapshot.allocationTotals?.exact === true,
    ...RECEIPT_FLAGS,
    authority: "none",
    boundary: LAUNCH_RECEIPT_BOUNDARY,
  };
  return deepFreeze(result);
}

export const parseLaunchRehearsalReceipt = validateLaunchRehearsalReceipt;
export const validateLaunchReceipt = validateLaunchRehearsalReceipt;

/**
 * Optional DOM adapter for the host page. It keeps receipt state in memory,
 * exposes selection/replay/reset, and renders the serialized receipt as text.
 */
export function createLaunchReceiptConsole({
  documentRoot = globalThis.document,
  projection = null,
  receipt = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
  onDownload = null,
  onValidate = null,
  windowLike = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Launch receipt console needs a document-like owner");
  const panel = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.panel);
  const closeButton = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.close);
  const replayButton = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.replay);
  const resetButton = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.reset);
  const downloadButton = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.download);
  const statusEl = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.status);
  const summaryEl = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.summary);
  const currentEl = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.current);
  const cohortsEl = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.cohorts);
  const reconciliationEl = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.reconciliation);
  const jsonEl = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.json);
  const traceEl = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.trace);
  const boundaryEl = documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.boundary);
  if (!panel || !closeButton || !replayButton || !resetButton || !downloadButton || !statusEl || !summaryEl || !currentEl || !cohortsEl || !reconciliationEl || !jsonEl || !traceEl) throw new Error("Launch receipt console mount points are missing");

  let currentProjection = canonicalProjection(projection);
  let receiptState = receipt ? validateLaunchRehearsalReceipt(receipt, currentProjection).receipt : null;
  if (!receiptState) receiptState = createLaunchRehearsalReceipt(currentProjection);
  let selectedId = receiptState.cohorts[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let trace = [];
  let replayCount = 0;
  let lastReplay = null;
  let lastDownload = null;

  function setOpen(next) { opened = Boolean(next); panel.hidden = !opened; panel.classList?.toggle?.("visible", opened); panel.setAttribute?.("aria-hidden", String(!opened)); }
  function selectedCohort() { return receiptState.cohorts.find((cohort) => cohort.id === selectedId) ?? receiptState.cohorts[0] ?? null; }
  function pushTrace(entry) { trace = [deepFreeze({ ...entry, localOnly: true, simulation: true, externalNetwork: false, externalDistribution: false, custody: false, signing: false, transfer: false, exchange: false, persistence: false, executable: false }), ...trace].slice(0, 12); }
  function renderSummary() {
    summaryEl.replaceChildren();
    [[receiptState.cohortCount, "cohorts"], [receiptState.allocationTotals.totalBasisPoints, "basis points"], [receiptState.allocationTotals.totalTokenUnits, receiptState.unit], [receiptState.allocationTotals.exact ? "EXACT" : "REVIEW", "reconciliation"]].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div"); metric.className = "launch-receipt-metric"; metric.append(createText(documentRoot, "b", "launch-receipt-metric-value", typeof value === "number" ? formatInteger(value) : value), createText(documentRoot, "span", "launch-receipt-metric-label", label)); summaryEl.appendChild(metric);
    });
  }
  function renderCohorts() {
    cohortsEl.replaceChildren();
    receiptState.cohorts.forEach((cohort) => {
      const button = documentRoot.createElement("button"); button.type = "button"; button.className = "launch-receipt-cohort"; button.dataset.cohortId = cohort.id; button.setAttribute?.("aria-pressed", String(cohort.id === selectedId));
      button.append(createText(documentRoot, "strong", "launch-receipt-cohort-title", cohort.label), createText(documentRoot, "span", "launch-receipt-cohort-meta", `${cohort.recipientClass} · ${cohort.basisPoints} bp · ${formatInteger(cohort.tokenUnits)} ${receiptState.unit}`)); button.addEventListener("click", () => selectCohort(cohort.id, "button")); cohortsEl.appendChild(button);
    });
  }
  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) { traceEl.appendChild(createText(documentRoot, "div", "launch-receipt-empty", "No local receipt action yet.")); return; }
    trace.forEach((entry, index) => traceEl.appendChild(createText(documentRoot, "div", "launch-receipt-trace-row", `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.cohortId ?? "all cohorts"} · LOCAL ONLY`)));
  }
  function render() {
    const selected = selectedCohort();
    renderSummary(); renderCohorts(); renderTrace();
    const exact = receiptState.allocationTotals.exact;
    statusEl.textContent = lastDownload?.status === "downloaded"
      ? "DOWNLOADED · LOCAL JSON · NO DISTRIBUTION"
      : lastDownload?.status === "unavailable"
        ? "DOWNLOAD UNAVAILABLE · SAVE JSON MANUALLY"
        : lastDownload?.status === "rejected"
          ? "DOWNLOAD BLOCKED · RECEIPT VALIDATION FAILED"
          : lastReplay
            ? `REPLAYED · LOCAL RECEIPT #${replayCount} · NO DISTRIBUTION`
            : `READY · ${receiptState.cohortCount} COHORTS · LOCAL ONLY`;
    currentEl.textContent = selected ? `${selected.label} · ${selected.basisPoints} BP · ${formatInteger(selected.tokenUnits)} ${receiptState.unit} · SIMULATED` : "NO COHORT SELECTED";
    reconciliationEl.textContent = exact ? `EXACT RECONCILIATION · ${formatInteger(receiptState.allocationTotals.totalBasisPoints)} BP · ${formatInteger(receiptState.totalSupply)} ${receiptState.unit}` : "RECONCILIATION REQUIRES REVIEW";
    reconciliationEl.dataset.status = exact ? "verified" : "review";
    jsonEl.textContent = serializeLaunchRehearsalReceipt(receiptState);
    if (boundaryEl) boundaryEl.textContent = LAUNCH_RECEIPT_BOUNDARY;
    replayButton.disabled = receiptState.cohortCount === 0;
    downloadButton.disabled = receiptState.cohortCount === 0;
    resetButton.disabled = trace.length === 0 && replayCount === 0 && selectedId === receiptState.cohorts[0]?.id;
  }
  function selectCohort(id, method = "button") {
    const cohort = receiptState.cohorts.find((candidate) => candidate.id === id); if (!cohort) return null; selectedId = cohort.id; lastDownload = null; const snapshot = deepFreeze({ source: LAUNCH_RECEIPT_CONSOLE_SOURCE, action: "select", method, cohortId: cohort.id, cohort, receipt: receiptState, ...RECEIPT_FLAGS, authority: "none", boundary: LAUNCH_RECEIPT_BOUNDARY }); pushTrace({ action: "select", cohortId: cohort.id }); render(); onSelect?.(snapshot); return snapshot;
  }
  function replay(method = "button") {
    replayCount += 1; lastDownload = null; const selected = selectedCohort(); lastReplay = deepFreeze({ source: LAUNCH_RECEIPT_CONSOLE_SOURCE, action: "replay", method, receiptId: receiptState.receiptId, cohortId: selected?.id ?? null, sequence: LAUNCH_RECEIPT_SEQUENCE, replayCount, exact: receiptState.allocationTotals.exact, receipt: receiptState, ...RECEIPT_FLAGS, authority: "none", boundary: LAUNCH_RECEIPT_BOUNDARY }); pushTrace({ action: "replay", cohortId: selected?.id ?? null, replayCount }); render(); onReplay?.(lastReplay); return lastReplay;
  }
  function reset(method = "button") {
    receiptState = createLaunchRehearsalReceipt(currentProjection); selectedId = receiptState.cohorts[0]?.id ?? null; replayCount = 0; lastReplay = null; lastDownload = null; trace = []; const snapshot = deepFreeze({ source: LAUNCH_RECEIPT_CONSOLE_SOURCE, action: "reset", method, receipt: receiptState, ...RECEIPT_FLAGS, authority: "none", boundary: LAUNCH_RECEIPT_BOUNDARY }); render(); onReset?.(snapshot); return snapshot;
  }
  function validate(input) { const result = validateLaunchRehearsalReceipt(input, currentProjection); onValidate?.(result); return result; }
  function download(method = "button") {
    const serialized = serializeLaunchRehearsalReceipt(receiptState);
    const validation = validate(serialized);
    const base = { source: LAUNCH_RECEIPT_CONSOLE_SOURCE, action: "download", method, receiptId: receiptState.receiptId, filename: LAUNCH_RECEIPT_DOWNLOAD_FILENAME, ...RECEIPT_FLAGS, authority: "none", boundary: LAUNCH_RECEIPT_BOUNDARY };
    if (!validation.valid || !validation.receipt) {
      lastDownload = deepFreeze({ ...base, status: "rejected", reason: "validation-failed", validated: false, bytes: 0 });
      pushTrace({ action: "download", status: "rejected" });
      render();
      onDownload?.(lastDownload);
      return lastDownload;
    }
    const payload = serializeLaunchRehearsalReceipt(validation.receipt);
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
      const blob = new BlobCtor([payload], { type: "application/json;charset=utf-8" });
      objectUrl = URLApi.createObjectURL(blob);
      if (typeof objectUrl !== "string" || !objectUrl) throw new Error("download URL unavailable");
      anchor.href = objectUrl;
      anchor.download = LAUNCH_RECEIPT_DOWNLOAD_FILENAME;
      anchor.rel = "noopener";
      anchor.setAttribute?.("download", LAUNCH_RECEIPT_DOWNLOAD_FILENAME);
      anchor.setAttribute?.("aria-label", "Download local launch rehearsal receipt JSON");
      anchor.click();
      if (typeof runtime?.setTimeout === "function") runtime.setTimeout(revoke, 0);
      else revoke();
      lastDownload = deepFreeze({ ...base, status: "downloaded", reason: "user-triggered-local-json", validated: true, bytes: payload.length });
    } catch {
      revoke();
      lastDownload = deepFreeze({ ...base, status: "unavailable", reason: "browser-download-unavailable", validated: true, bytes: 0 });
    }
    pushTrace({ action: "download", status: lastDownload.status });
    render();
    onDownload?.(lastDownload);
    return lastDownload;
  }
  function syncProjection(nextProjection) { currentProjection = canonicalProjection(nextProjection); receiptState = createLaunchRehearsalReceipt(currentProjection); selectedId = receiptState.cohorts[0]?.id ?? null; replayCount = 0; lastReplay = null; lastDownload = null; trace = []; render(); return getSnapshot(); }
  function getSnapshot() { return deepFreeze({ source: LAUNCH_RECEIPT_CONSOLE_SOURCE, receipt: receiptState, selectedId, selectedCohort: selectedCohort(), opened, trace, replayCount, lastReplay, lastDownload, ...RECEIPT_FLAGS, authority: "none", boundary: LAUNCH_RECEIPT_BOUNDARY }); }

  closeButton.addEventListener("click", () => setOpen(false)); replayButton.addEventListener("click", () => replay("button")); resetButton.addEventListener("click", () => reset("button")); downloadButton.addEventListener("click", () => download("button")); documentRoot.addEventListener?.("keydown", (event) => { if (event.key === "Escape" && opened) setOpen(false); }); render(); setOpen(opened);
  return Object.freeze({ open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen(!opened), selectCohort, select: selectCohort, replay, reset, download, validate, syncProjection, setProjection: syncProjection, getSnapshot, serialize: () => serializeLaunchRehearsalReceipt(receiptState), destroy: () => {} });
}

export const createLaunchRehearsalReceiptConsole = createLaunchReceiptConsole;
export const createLaunchReceiptLayer = createLaunchReceiptConsole;

export default createLaunchReceiptConsole;
