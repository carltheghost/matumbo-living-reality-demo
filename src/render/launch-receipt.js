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
 *
 * Tunables (supply fixture, basis points) come from token-config.js.
 * Public commitment is always shown on the boundary surface.
 */
import { DEFAULT_LAUNCH_DISTRIBUTION_PREVIEW } from "../domains/distribution-registry.js";
import { summarizeLaunchDistribution } from "./launch-console.js";
import {
  DEMO_REHEARSAL_SUPPLY_UNITS,
  TUMBO_TOTAL_BASIS_POINTS,
  TUMBO_PUBLIC_COMMITMENT,
} from "../domains/token-config.js";

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
  "Launch Rehearsal Receipt is a deterministic TUMBO-SIM projection only; it does not issue or distribute a real asset, custody value, connect a wallet, sign, transfer, exchange, persist app state, contact a network, or execute code. Download JSON is an optional user-triggered local browser export only; it does not import files or share externally. Simulated points only — never real money or wagering.";

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

const TOTAL_BASIS_POINTS = TUMBO_TOTAL_BASIS_POINTS;
const DEFAULT_TOTAL_SUPPLY = DEMO_REHEARSAL_SUPPLY_UNITS;
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
  return { ...RECEIPT_FLAGS, authority: "none", boundary: LAUNCH_RECEIPT_BOUNDARY, publicCommitment: TUMBO_PUBLIC_COMMITMENT };
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
    publicCommitment: TUMBO_PUBLIC_COMMITMENT,
  };
  return deepFreeze(receipt);
}

export const createLaunchReceipt = createLaunchRehearsalReceipt;
export const createLaunchRehearsalReceiptSnapshot = createLaunchRehearsalReceipt;

export const DEFAULT_LAUNCH_REHEARSAL_RECEIPT = createLaunchRehearsalReceipt();

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
    compare(snapshot.unit, canonical.unit, "unit", errors);
    compare(snapshot.fixedSupply, true, "fixedSupply", errors);
    validateFlags(snapshot, errors);
    validateCohorts(snapshot, canonical, errors);
    validateTotals(snapshot, canonical, errors);
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    warnings,
    snapshot: errors.length === 0 ? deepFreeze(snapshot) : null,
    canonical,
    boundary: LAUNCH_RECEIPT_BOUNDARY,
    publicCommitment: TUMBO_PUBLIC_COMMITMENT,
  });
}
export const validateLaunchReceipt = validateLaunchRehearsalReceipt;

/**
 * Optional console host for the launch rehearsal receipt.
 * Boundary element always shows the public commitment.
 */
export function createLaunchReceiptConsole({
  documentRoot = typeof document !== "undefined" ? document : null,
  projection = null,
  opened = false,
  onSelect,
  onReplay,
  onReset,
  onDownload,
} = {}) {
  if (!documentRoot) throw new TypeError("documentRoot is required for the receipt console");
  let currentProjection = canonicalProjection(projection);
  let receiptState = createLaunchRehearsalReceipt(currentProjection);
  let selectedId = receiptState.cohorts[0]?.id ?? null;
  let replayCount = 0;
  let lastReplay = null;
  let lastDownload = null;
  let trace = [];

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

  function selectedCohort() {
    return receiptState.cohorts.find((c) => c.id === selectedId) ?? null;
  }

  function pushTrace(entry) {
    trace = [...trace, deepFreeze({ ...entry, at: Date.now() })].slice(-32);
  }

  function setOpen(next) {
    opened = Boolean(next);
    if (panel) panel.hidden = !opened;
  }

  function render() {
    if (statusEl) statusEl.textContent = receiptState.allocationTotals.exact ? "verified" : "review";
    if (summaryEl) {
      summaryEl.textContent = `${receiptState.cohortCount} cohorts · ${formatInteger(receiptState.allocationTotals.totalBasisPoints)} bps · ${receiptState.unit}`;
    }
    if (currentEl) {
      const selected = selectedCohort();
      currentEl.textContent = selected ? `${selected.label} (${selected.basisPoints} bps)` : "—";
    }
    if (cohortsEl) {
      cohortsEl.textContent = "";
      receiptState.cohorts.forEach((cohort) => {
        const row = createText(documentRoot, "button", "launch-receipt-cohort", `${cohort.label} · ${cohort.basisPoints} bps`);
        row.type = "button";
        row.dataset.cohortId = cohort.id;
        if (cohort.id === selectedId) row.setAttribute("aria-current", "true");
        row.addEventListener("click", () => selectCohort(cohort.id, "button"));
        cohortsEl.appendChild(row);
      });
    }
    if (reconciliationEl) {
      const r = receiptState.reconciliation;
      reconciliationEl.textContent = `bps ${r.basisPoints.actual}/${r.basisPoints.expected} · units ${formatInteger(r.tokenUnits.actual)}/${formatInteger(r.tokenUnits.expected)} · ${r.status}`;
    }
    if (jsonEl) jsonEl.textContent = serializeLaunchRehearsalReceipt(receiptState);
    if (traceEl) traceEl.textContent = trace.map((t) => t.action).join(" → ") || "—";
    if (boundaryEl) {
      boundaryEl.textContent = LAUNCH_RECEIPT_BOUNDARY;
      boundaryEl.setAttribute("data-public-commitment", TUMBO_PUBLIC_COMMITMENT);
      boundaryEl.setAttribute("role", "note");
    }
  }

  function selectCohort(id, method = "api") {
    const cohort = receiptState.cohorts.find((candidate) => candidate.id === id);
    if (!cohort) return null;
    selectedId = cohort.id;
    lastDownload = null;
    const snapshot = deepFreeze({
      source: LAUNCH_RECEIPT_CONSOLE_SOURCE,
      action: "select",
      method,
      cohortId: cohort.id,
      cohort,
      receipt: receiptState,
      ...RECEIPT_FLAGS,
      authority: "none",
      boundary: LAUNCH_RECEIPT_BOUNDARY,
      publicCommitment: TUMBO_PUBLIC_COMMITMENT,
    });
    pushTrace({ action: "select", cohortId: cohort.id });
    render();
    onSelect?.(snapshot);
    return snapshot;
  }

  function replay(method = "api") {
    replayCount += 1;
    lastDownload = null;
    const selected = selectedCohort();
    lastReplay = deepFreeze({
      source: LAUNCH_RECEIPT_CONSOLE_SOURCE,
      action: "replay",
      method,
      receiptId: receiptState.receiptId,
      cohortId: selected?.id ?? null,
      sequence: LAUNCH_RECEIPT_SEQUENCE,
      replayCount,
      exact: receiptState.allocationTotals.exact,
      receipt: receiptState,
      ...RECEIPT_FLAGS,
      authority: "none",
      boundary: LAUNCH_RECEIPT_BOUNDARY,
      publicCommitment: TUMBO_PUBLIC_COMMITMENT,
    });
    pushTrace({ action: "replay", cohortId: selected?.id ?? null, replayCount });
    render();
    onReplay?.(lastReplay);
    return lastReplay;
  }

  function reset(method = "api") {
    receiptState = createLaunchRehearsalReceipt(currentProjection);
    selectedId = receiptState.cohorts[0]?.id ?? null;
    replayCount = 0;
    lastReplay = null;
    lastDownload = null;
    trace = [];
    const snapshot = deepFreeze({
      source: LAUNCH_RECEIPT_CONSOLE_SOURCE,
      action: "reset",
      method,
      receipt: receiptState,
      ...RECEIPT_FLAGS,
      authority: "none",
      boundary: LAUNCH_RECEIPT_BOUNDARY,
      publicCommitment: TUMBO_PUBLIC_COMMITMENT,
    });
    render();
    onReset?.(snapshot);
    return snapshot;
  }

  function validate() {
    return validateLaunchRehearsalReceipt(receiptState, currentProjection);
  }

  function download(method = "api") {
    const payload = serializeLaunchRehearsalReceipt(receiptState);
    const base = {
      source: LAUNCH_RECEIPT_CONSOLE_SOURCE,
      action: "download",
      method,
      receiptId: receiptState.receiptId,
      filename: LAUNCH_RECEIPT_DOWNLOAD_FILENAME,
      ...RECEIPT_FLAGS,
      authority: "none",
      boundary: LAUNCH_RECEIPT_BOUNDARY,
      publicCommitment: TUMBO_PUBLIC_COMMITMENT,
    };
    let revoke = () => {};
    try {
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      revoke = () => URL.revokeObjectURL(url);
      const anchor = documentRoot.createElement("a");
      anchor.href = url;
      anchor.download = LAUNCH_RECEIPT_DOWNLOAD_FILENAME;
      anchor.rel = "noopener";
      documentRoot.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      lastDownload = deepFreeze({ ...base, status: "downloaded", validated: true, bytes: payload.length });
      revoke();
    } catch {
      revoke();
      lastDownload = deepFreeze({ ...base, status: "unavailable", reason: "browser-download-unavailable", validated: true, bytes: 0 });
    }
    pushTrace({ action: "download", status: lastDownload.status });
    render();
    onDownload?.(lastDownload);
    return lastDownload;
  }

  function syncProjection(nextProjection) {
    currentProjection = canonicalProjection(nextProjection);
    receiptState = createLaunchRehearsalReceipt(currentProjection);
    selectedId = receiptState.cohorts[0]?.id ?? null;
    replayCount = 0;
    lastReplay = null;
    lastDownload = null;
    trace = [];
    render();
    return getSnapshot();
  }

  function getSnapshot() {
    return deepFreeze({
      source: LAUNCH_RECEIPT_CONSOLE_SOURCE,
      receipt: receiptState,
      selectedId,
      selectedCohort: selectedCohort(),
      opened,
      trace,
      replayCount,
      lastReplay,
      lastDownload,
      ...RECEIPT_FLAGS,
      authority: "none",
      boundary: LAUNCH_RECEIPT_BOUNDARY,
      publicCommitment: TUMBO_PUBLIC_COMMITMENT,
    });
  }

  closeButton?.addEventListener("click", () => setOpen(false));
  replayButton?.addEventListener("click", () => replay("button"));
  resetButton?.addEventListener("click", () => reset("button"));
  downloadButton?.addEventListener("click", () => download("button"));
  documentRoot.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false);
  });
  render();
  setOpen(opened);
  return Object.freeze({
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!opened),
    selectCohort,
    select: selectCohort,
    replay,
    reset,
    download,
    validate,
    syncProjection,
    setProjection: syncProjection,
    getSnapshot,
    serialize: () => serializeLaunchRehearsalReceipt(receiptState),
    destroy: () => {},
  });
}

export const createLaunchRehearsalReceiptConsole = createLaunchReceiptConsole;
export const createLaunchReceiptLayer = createLaunchReceiptConsole;

export default createLaunchReceiptConsole;
