import {
  ASSET_MARKET_BOUNDARY,
  createUnavailableAssetMarketEvidence,
  replayAssetMarketEvidence,
  summarizeAssetMarketEvidence,
} from "../domains/asset-market.js?v=20260922-cache2";

export const ASSET_MARKET_CONSOLE_SOURCE = "asset-market-evidence-console";

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function number(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function percent(value) {
  if (!Number.isFinite(Number(value))) return "—";
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(2)}%`;
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

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function recordPrice(record) {
  return record?.currentPrice === null || record?.currentPrice === undefined
    ? "PRICE UNAVAILABLE"
    : `USD ${number(record.currentPrice, record.currentPrice < 1 ? 6 : 2)}`;
}

function recordChange(record) {
  return record?.priceChangePercentage24h === null || record?.priceChangePercentage24h === undefined
    ? "24H CHANGE UNAVAILABLE"
    : `24H ${percent(record.priceChangePercentage24h)}`;
}

function recordGrade(record) {
  return record?.dataCompletenessGrade ?? "D";
}

/**
 * Mount the CoinGecko market-evidence console. The host supplies the explicit
 * refresh callback; this renderer owns only the DOM, local selection trace,
 * and square/cube-only presentation language.
 */
export function createAssetMarketConsole({
  documentRoot = globalThis.document,
  data = null,
  onRefresh = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Asset Market console needs a document-like owner");
  const panel = documentRoot.getElementById("asset-market-console");
  const closeButton = documentRoot.getElementById("asset-market-close");
  const refreshButton = documentRoot.getElementById("asset-market-refresh");
  const resetButton = documentRoot.getElementById("asset-market-reset");
  const statusEl = documentRoot.getElementById("asset-market-status");
  const summaryEl = documentRoot.getElementById("asset-market-summary");
  const queryEl = documentRoot.getElementById("asset-market-query");
  const currentEl = documentRoot.getElementById("asset-market-current");
  const sourcesEl = documentRoot.getElementById("asset-market-sources");
  const recordsEl = documentRoot.getElementById("asset-market-records");
  const traceEl = documentRoot.getElementById("asset-market-trace");
  const boundaryEl = documentRoot.getElementById("asset-market-boundary");
  if (!panel || !closeButton || !refreshButton || !resetButton || !statusEl || !summaryEl || !queryEl || !currentEl || !sourcesEl || !recordsEl || !traceEl) {
    throw new Error("Asset Market console mount points are missing");
  }

  let summary = summarizeAssetMarketEvidence(data ?? createUnavailableAssetMarketEvidence());
  let selectedId = summary.records[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let loading = false;
  let refreshCount = 0;
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
      providerCredentials: false,
      liveFetch: false,
      truthClaim: false,
      executable: false,
    }), ...trace].slice(0, 12);
  }

  function renderSummary() {
    summaryEl.replaceChildren();
    [
      [summary.recordCount, "peer records"],
      [`${summary.availableProviderCount}/${summary.providerCount}`, "providers"],
      [summary.completeRecordCount, "complete enough"],
      [summary.missingAssetIds.length, "missing peers"],
    ].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div");
      metric.className = "asset-market-metric";
      metric.append(createText(documentRoot, "b", "asset-market-metric-value", value), createText(documentRoot, "span", "asset-market-metric-label", label));
      summaryEl.appendChild(metric);
    });
  }

  function renderSources() {
    sourcesEl.replaceChildren();
    if (!summary.sources.length) {
      sourcesEl.appendChild(createText(documentRoot, "div", "asset-market-empty", "No public CoinGecko endpoint is configured."));
      return;
    }
    summary.sources.forEach((source) => {
      const row = documentRoot.createElement("div");
      row.className = `asset-market-source ${source.available ? "asset-market-source-available" : "asset-market-source-unavailable"}`;
      row.append(
        createText(documentRoot, "strong", "asset-market-source-title", source.provider),
        createText(documentRoot, "span", "asset-market-source-meta", source.available ? `AVAILABLE · ${source.recordCount} PEER ROW${source.recordCount === 1 ? "" : "S"}` : "UNAVAILABLE · NO DATA USED"),
        createText(documentRoot, "span", "asset-market-source-endpoint", source.endpoint),
        createText(documentRoot, "span", "asset-market-source-reason", source.reason ?? "Public endpoint queried only after explicit refresh."),
      );
      sourcesEl.appendChild(row);
    });
  }

  function renderRecords() {
    recordsEl.replaceChildren();
    if (!summary.records.length) {
      recordsEl.appendChild(createText(documentRoot, "div", "asset-market-empty", `${summary.reason ?? "No public peer market rows are available."} · NO DATA FABRICATED`));
      return;
    }
    summary.records.forEach((record) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "asset-market-record";
      button.dataset.recordId = record.id;
      button.setAttribute("aria-pressed", String(record.id === selectedId));
      button.title = record.assetPageUrl ?? record.coinPageUrl ?? record.sourceUrl ?? "Public CoinGecko source";
      button.append(
        createText(documentRoot, "strong", "asset-market-record-title", `${record.name} · ${record.symbol}`),
        createText(documentRoot, "span", "asset-market-record-meta", `${recordPrice(record)} · ${recordChange(record)} · DATA ${recordGrade(record)}`),
        createText(documentRoot, "span", "asset-market-record-time", `MARKET CAP RANK ${record.marketCapRank ?? "UNAVAILABLE"} · OBSERVED ${record.sourceObservedAt ?? "UNAVAILABLE"}`),
      );
      button.addEventListener("click", () => selectRecord(record.id, "button"));
      recordsEl.appendChild(button);
    });
  }

  function renderCurrent() {
    const record = selectedRecord();
    currentEl.replaceChildren();
    const native = summary.nativeAsset;
    currentEl.append(
      createText(documentRoot, "strong", "asset-market-current-native", `${native.symbol} · ${String(native.listingStatus).toUpperCase()} · NO PRICE`),
      createText(documentRoot, "span", "asset-market-current-native-note", native.note),
    );
    if (record) {
      currentEl.append(
        createText(documentRoot, "strong", "asset-market-current-title", `${record.name} · ${record.symbol}`),
        createText(documentRoot, "span", "asset-market-current-price", `${recordPrice(record)} · ${recordChange(record)}`),
        createText(documentRoot, "span", "asset-market-current-stats", `MARKET CAP USD ${number(record.marketCap, 0)} · RANK ${record.marketCapRank ?? "UNAVAILABLE"} · 24H VOLUME USD ${number(record.totalVolume24h, 0)}`),
        createText(documentRoot, "span", "asset-market-current-time", `PROVIDER UPDATED ${record.sourceObservedAt ?? "UNAVAILABLE"} · RETRIEVED ${record.retrievedAt ?? "—"}`),
        createText(documentRoot, "span", "asset-market-current-grade", `DATA COMPLETENESS ${recordGrade(record)} · ${record.dataCompletenessPercent ?? 0}% · ${record.dataCompletenessBasis ?? "field presence only"}`),
      );
      const links = documentRoot.createElement("div");
      links.className = "asset-market-current-links";
      const sourceLink = documentRoot.createElement("a");
      sourceLink.href = record.sourceUrl ?? "#";
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceLink.textContent = "OPEN PUBLIC COINGECKO API SOURCE";
      links.appendChild(sourceLink);
      const assetPageUrl = record.assetPageUrl ?? record.coinPageUrl;
      if (assetPageUrl) {
        const assetLink = documentRoot.createElement("a");
        assetLink.href = assetPageUrl;
        assetLink.target = "_blank";
        assetLink.rel = "noopener noreferrer";
        assetLink.textContent = "OPEN ASSET PAGE";
        links.appendChild(assetLink);
      }
      currentEl.appendChild(links);
    } else {
      currentEl.appendChild(createText(documentRoot, "span", "asset-market-current-empty", "SELECT A PUBLIC PEER ROW TO INSPECT · NO DATA FABRICATED"));
    }
    const status = summary.status === "ready"
      ? `READY · ${summary.recordCount} PEER ROW${summary.recordCount === 1 ? "" : "S"} · RESEARCH ONLY`
      : summary.status === "partial"
        ? `PARTIAL · ${summary.recordCount} PEER ROW${summary.recordCount === 1 ? "" : "S"} · PROVIDER OMITTED DATA`
        : "UNAVAILABLE · NO COINGECKO DATA LOADED · NO DATA FABRICATED";
    statusEl.textContent = loading
      ? "REFRESHING COINGECKO PUBLIC SOURCE · WAITING FOR RESPONSE"
      : trace.length ? `${status} · ${trace.length} LOCAL INSPECTION${trace.length === 1 ? "" : "S"}` : status;
    refreshButton.disabled = loading;
    resetButton.disabled = trace.length === 0 && selectedId === (summary.records[0]?.id ?? null);
    queryEl.textContent = `PEER SET · ${(summary.requestedAssetIds ?? []).join(", ")} · TUMBO-SIM UNLISTED · RETRIEVED ${summary.retrievedAt ?? "—"}`;
    if (boundaryEl) boundaryEl.textContent = summary.boundary ?? ASSET_MARKET_BOUNDARY;
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "asset-market-empty", "No local inspection yet. Refresh public peer evidence, then select a row."));
      return;
    }
    trace.forEach((entry, index) => traceEl.appendChild(createText(
      documentRoot,
      "div",
      "asset-market-trace-row",
      `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "all peer rows"} · LOCAL ONLY`,
    )));
  }

  function render() {
    renderSummary();
    renderSources();
    renderRecords();
    renderCurrent();
    renderTrace();
  }

  function selectRecord(recordId, method = "button") {
    const record = summary.records.find((candidate) => candidate.id === recordId);
    if (!record) return null;
    selectedId = record.id;
    const snapshot = deepFreeze({
      source: ASSET_MARKET_CONSOLE_SOURCE,
      action: "select",
      method,
      recordId: record.id,
      record,
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      providerCredentials: false,
      liveFetch: false,
      truthClaim: false,
      executable: false,
    });
    pushTrace({ action: "select", recordId: record.id });
    render();
    onSelect?.(snapshot);
    return snapshot;
  }

  function replay(method = "button") {
    const snapshot = replayAssetMarketEvidence(summary, selectedId, method);
    pushTrace({ action: "replay", recordId: snapshot.recordId });
    render();
    const envelope = deepFreeze({ ...snapshot, source: ASSET_MARKET_CONSOLE_SOURCE });
    onReplay?.(envelope);
    return envelope;
  }

  function reset(method = "button") {
    selectedId = summary.records[0]?.id ?? null;
    trace = [];
    const snapshot = deepFreeze({
      source: ASSET_MARKET_CONSOLE_SOURCE,
      action: "reset",
      method,
      recordId: selectedId,
      summary,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      providerCredentials: false,
      liveFetch: false,
      truthClaim: false,
      executable: false,
    });
    render();
    onReset?.(snapshot);
    return snapshot;
  }

  async function refresh(method = "button") {
    if (loading) return getSnapshot();
    loading = true;
    renderCurrent();
    try {
      const result = await onRefresh?.({ method, assetIds: summary.requestedAssetIds });
      summary = summarizeAssetMarketEvidence(result ?? createUnavailableAssetMarketEvidence({ reason: "Refresh returned no public CoinGecko response; no data was fabricated." }));
      selectedId = summary.records[0]?.id ?? null;
      refreshCount += 1;
      pushTrace({ action: "refresh", recordId: null, refreshCount });
    } catch (error) {
      summary = summarizeAssetMarketEvidence(createUnavailableAssetMarketEvidence({ reason: `CoinGecko provider unavailable: ${text(error?.message ?? error, "unknown error")}` }));
      selectedId = null;
      refreshCount += 1;
      pushTrace({ action: "refresh-unavailable", recordId: null, refreshCount });
    } finally {
      loading = false;
      render();
    }
    return getSnapshot();
  }

  function setData(nextData) {
    summary = summarizeAssetMarketEvidence(nextData);
    if (!summary.records.some((record) => record.id === selectedId)) selectedId = summary.records[0]?.id ?? null;
    render();
    return getSnapshot();
  }

  function getSnapshot() {
    return deepFreeze({
      source: ASSET_MARKET_CONSOLE_SOURCE,
      summary,
      selectedId,
      selectedRecord: selectedRecord(),
      nativeAsset: summary.nativeAsset,
      opened,
      loading,
      refreshCount,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      providerCredentials: false,
      liveFetch: summary.liveFetch,
      truthClaim: false,
      executable: false,
      boundary: summary.boundary ?? ASSET_MARKET_BOUNDARY,
    });
  }

  closeButton.addEventListener("click", () => setOpen(false));
  refreshButton.addEventListener("click", () => refresh("button"));
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
    refresh,
    selectRecord,
    replay,
    reset,
    setData,
    setProjection: setData,
    getSnapshot,
    destroy: () => {},
  });
}

export const createAssetMarketEvidenceConsole = createAssetMarketConsole;
export default createAssetMarketConsole;
