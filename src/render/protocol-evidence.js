import {
  PROTOCOL_EVIDENCE_BOUNDARY,
  createUnavailableProtocolEvidence,
  summarizeProtocolEvidence,
} from "../domains/protocol-evidence.js?v=20260922-cache2";

export const PROTOCOL_EVIDENCE_CONSOLE_SOURCE = "protocol-evidence-console";

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  if (value === null || typeof value !== "object") return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "TVL UNAVAILABLE";
  return `USD ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
}

function publicLink(documentRoot, href, label) {
  if (typeof href !== "string" || !/^https:\/\//i.test(href)) return null;
  const link = documentRoot.createElement("a");
  link.className = "protocol-evidence-link";
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

/**
 * Mount a provider-evidence rail inside the existing Contracts + Pools panel.
 * It deliberately does not join provider TVL to fictional scenario liquidity.
 * The host owns the explicit refresh callback and therefore owns all network
 * access; this renderer never calls fetch or stores data.
 */
export function createProtocolEvidenceRail({
  documentRoot = globalThis.document,
  host = null,
  onRefresh = null,
} = {}) {
  if (!documentRoot?.createElement) throw new Error("Protocol evidence rail needs a document-like owner");
  const parent = host ?? documentRoot.getElementById("contracts-markets-console");
  if (!parent?.appendChild) throw new Error("Protocol evidence rail needs the Contracts + Pools host");

  const root = documentRoot.createElement("section");
  root.id = "protocol-evidence-rail";
  root.className = "protocol-evidence-rail";
  root.setAttribute?.("aria-labelledby", "protocol-evidence-title");
  const head = documentRoot.createElement("div");
  head.className = "protocol-evidence-head";
  const titleWrap = documentRoot.createElement("div");
  titleWrap.append(
    createText(documentRoot, "div", "eyebrow", "Public protocol evidence · separate from scenarios"),
    createText(documentRoot, "h3", "protocol-evidence-title", "Provider TVL Readout"),
    createText(documentRoot, "p", "protocol-evidence-description", "Read current protocol TVL observations from DeFiLlama without treating them as the fictional pool graph."),
  );
  const refreshButton = documentRoot.createElement("button");
  refreshButton.type = "button";
  refreshButton.id = "protocol-evidence-refresh";
  refreshButton.className = "protocol-evidence-refresh";
  refreshButton.textContent = "Refresh public TVL";
  head.append(titleWrap, refreshButton);
  root.appendChild(head);

  const statusEl = createText(documentRoot, "div", "protocol-evidence-status", "UNAVAILABLE · REFRESH TO REQUEST PUBLIC TVL");
  statusEl.id = "protocol-evidence-status";
  statusEl.setAttribute?.("role", "status");
  statusEl.setAttribute?.("aria-live", "polite");
  const summaryEl = documentRoot.createElement("div");
  summaryEl.id = "protocol-evidence-summary";
  summaryEl.className = "protocol-evidence-summary";
  const recordsEl = documentRoot.createElement("div");
  recordsEl.id = "protocol-evidence-records";
  recordsEl.className = "protocol-evidence-records";
  const boundaryEl = createText(documentRoot, "div", "protocol-evidence-boundary", PROTOCOL_EVIDENCE_BOUNDARY);
  boundaryEl.id = "protocol-evidence-boundary";
  root.append(statusEl, summaryEl, recordsEl, boundaryEl);
  parent.appendChild(root);

  let summary = summarizeProtocolEvidence(createUnavailableProtocolEvidence());
  let loading = false;
  let refreshCount = 0;

  function renderSummary() {
    summaryEl.replaceChildren();
    [
      [summary.recordCount, "protocol rows"],
      [`${summary.availableCount}/${summary.providerCount}`, "available"],
      [summary.unavailableCount, "unavailable"],
      [summary.retrievedAt ?? "—", "retrieved"],
    ].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div");
      metric.className = "protocol-evidence-metric";
      metric.append(createText(documentRoot, "b", "protocol-evidence-metric-value", value), createText(documentRoot, "span", "protocol-evidence-metric-label", label));
      summaryEl.appendChild(metric);
    });
  }

  function renderRecords() {
    recordsEl.replaceChildren();
    if (!summary.records.length) {
      recordsEl.appendChild(createText(documentRoot, "div", "protocol-evidence-empty", `${summary.reason ?? "No public protocol TVL rows are available."} · NO DATA FABRICATED`));
      return;
    }
    summary.records.forEach((record) => {
      const row = documentRoot.createElement("article");
      row.className = `protocol-evidence-record protocol-evidence-${record.status === "provider-reported" ? "available" : "unavailable"}`;
      row.dataset.protocolId = record.id;
      row.append(
        createText(documentRoot, "strong", "protocol-evidence-record-title", record.protocolName),
        createText(documentRoot, "span", "protocol-evidence-record-value", record.status === "provider-reported" ? `${formatUsd(record.currentTvl)} · PROVIDER-REPORTED` : "TVL UNAVAILABLE · NO VALUE FABRICATED"),
        createText(documentRoot, "span", "protocol-evidence-record-meta", `${record.metric} · ${record.unit} · RETRIEVED ${record.retrievedAt ?? "—"}`),
        createText(documentRoot, "span", "protocol-evidence-record-reason", record.reason ?? "Public endpoint returned a usable value."),
      );
      const link = publicLink(documentRoot, record.sourceUrl, "OPEN DEFI LLAMA SOURCE");
      if (link) row.appendChild(link);
      recordsEl.appendChild(row);
    });
  }

  function render() {
    renderSummary();
    renderRecords();
    statusEl.textContent = loading
      ? "REFRESHING PUBLIC PROTOCOL TVL · WAITING FOR RESPONSE"
      : summary.status === "ready"
        ? `READY · ${summary.availableCount}/${summary.recordCount} PROTOCOL TVL ROWS · PROVIDER EVIDENCE ONLY`
        : summary.status === "partial"
          ? `PARTIAL · ${summary.availableCount}/${summary.recordCount} PROTOCOL TVL ROWS · UNAVAILABLE ROWS KEPT VISIBLE`
          : "UNAVAILABLE · NO PUBLIC PROTOCOL TVL VALUE · NO DATA FABRICATED";
    refreshButton.disabled = loading;
    boundaryEl.textContent = summary.boundary ?? PROTOCOL_EVIDENCE_BOUNDARY;
  }

  async function refresh(method = "button") {
    if (loading) return getSnapshot();
    loading = true;
    refreshCount += 1;
    render();
    let result;
    try {
      result = await onRefresh?.({ method, refreshCount });
      summary = summarizeProtocolEvidence(result ?? createUnavailableProtocolEvidence({ reason: "Refresh returned no public protocol response; no data was fabricated." }));
    } catch (error) {
      summary = summarizeProtocolEvidence(createUnavailableProtocolEvidence({ reason: `Public protocol provider unavailable: ${text(error?.message ?? error, "unknown error")}` }));
    } finally {
      loading = false;
      render();
    }
    return getSnapshot();
  }

  function sync(nextData) {
    summary = summarizeProtocolEvidence(nextData ?? createUnavailableProtocolEvidence());
    render();
    return getSnapshot();
  }

  refreshButton.addEventListener("click", () => { void refresh("button"); });
  render();

  function getSnapshot() {
    return deepFreeze({
      source: PROTOCOL_EVIDENCE_CONSOLE_SOURCE,
      summary,
      refreshCount,
      loading,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      providerCredentials: false,
      truthClaim: false,
      executable: false,
      boundary: summary.boundary ?? PROTOCOL_EVIDENCE_BOUNDARY,
    });
  }

  return Object.freeze({ refresh, sync, getSnapshot, root });
}

export default createProtocolEvidenceRail;
