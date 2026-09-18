import {
  WORLD_EVENTS_BOUNDARY,
  WORLD_EVENTS_DEFAULT_QUERY,
  WORLD_EVENTS_SIGNAL_FIELD_BANDS,
  createUnavailableWorldEvents,
  normalizeWorldEventsQuery,
  replayWorldEventEvidence,
  summarizeWorldEventRealityBrutality,
  summarizeWorldEventSignalField,
  summarizeWorldEventMapCells,
  summarizeWorldEvents,
  worldEventMapCell,
} from "../domains/world-events.js";

export const WORLD_EVENTS_CONSOLE_SOURCE = "world-events-evidence-console";

// These are presentation lenses over the language signal already returned by
// the public-source adapter. They never upgrade a headline into a severity,
// casualty, or truth score; a non-matching lens simply hides that record.
export const WORLD_EVENTS_SIGNAL_LENSES = Object.freeze([
  Object.freeze({ id: "all", label: "ALL", minimumLevel: 0, description: "all returned records" }),
  Object.freeze({ id: "context", label: "CONTEXT", minimumLevel: 1, description: "conflict-context language and above" }),
  Object.freeze({ id: "violence", label: "VIOLENCE", minimumLevel: 2, description: "violence-language and explicit-language records" }),
  Object.freeze({ id: "explicit", label: "EXPLICIT", minimumLevel: 3, description: "explicit-language records only" }),
]);

// Geographic lenses are independent of the existing title-language lenses.
// They filter only provider-returned coordinate pairs; no geocoding or place
// inference is performed when a record has no map point.
export const WORLD_EVENTS_GEOGRAPHY_LENSES = Object.freeze([
  Object.freeze({ id: "all", label: "ALL MAP", description: "all returned records" }),
  Object.freeze({ id: "mapped", label: "MAPPED", description: "provider coordinates present" }),
  Object.freeze({ id: "map-unavailable", label: "MAP N/A", description: "provider coordinates unavailable" }),
]);

// Chronology is a presentation order over records already returned by a
// public provider. It never requests another page, fills a missing timestamp,
// or changes the canonical response envelope.
export const WORLD_EVENTS_ORDER_LENSES = Object.freeze([
  Object.freeze({ id: "latest", label: "LATEST", description: "provider-observed newest first" }),
  Object.freeze({ id: "event-time", label: "EVENT TIME", description: "provider event time newest first; unavailable last" }),
  Object.freeze({ id: "signal-first", label: "SIGNAL FIRST", description: "title-language signal first, then newest" }),
]);

function signalLensDefinition(id) {
  return WORLD_EVENTS_SIGNAL_LENSES.find((lens) => lens.id === id) ?? WORLD_EVENTS_SIGNAL_LENSES[0];
}

function brutalitySignalLevel(record) {
  const level = Number(record?.brutalityLanguageSignal?.level);
  return Number.isFinite(level) ? Math.max(0, Math.min(3, level)) : 0;
}

function recordsForSignalLens(summary, lensId) {
  const lens = signalLensDefinition(lensId);
  const records = Array.isArray(summary?.records) ? summary.records : [];
  return records.filter((record) => brutalitySignalLevel(record) >= lens.minimumLevel);
}

function geographyLensDefinition(id) {
  return WORLD_EVENTS_GEOGRAPHY_LENSES.find((lens) => lens.id === id) ?? WORLD_EVENTS_GEOGRAPHY_LENSES[0];
}

function hasProviderCoordinates(record) {
  const longitude = Number(record?.coordinates?.longitude);
  const latitude = Number(record?.coordinates?.latitude);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= -180 && longitude <= 180
    && latitude >= -90 && latitude <= 90;
}

function recordsForGeographyLens(summary, lensId) {
  const lens = geographyLensDefinition(lensId);
  const records = Array.isArray(summary?.records) ? summary.records : [];
  if (lens.id === "mapped") return records.filter(hasProviderCoordinates);
  if (lens.id === "map-unavailable") return records.filter((record) => !hasProviderCoordinates(record));
  return records;
}

function recordsForMapCell(records, mapCellId) {
  const returned = Array.isArray(records) ? records : [];
  if (!mapCellId || mapCellId === "all") return returned;
  return returned.filter((record) => worldEventMapCell(record)?.id === mapCellId);
}

function orderLensDefinition(id) {
  return WORLD_EVENTS_ORDER_LENSES.find((lens) => lens.id === id) ?? WORLD_EVENTS_ORDER_LENSES[0];
}

function timestampMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function recordTimeForOrder(record, orderId) {
  if (orderId === "event-time") return timestampMs(record?.eventTime);
  return timestampMs(record?.sourceObservedAt) ?? timestampMs(record?.retrievedAt);
}

function compareRecordOrder(left, right, orderId) {
  if (orderId === "signal-first") {
    const signalDelta = brutalitySignalLevel(right) - brutalitySignalLevel(left);
    if (signalDelta !== 0) return signalDelta;
  }
  const leftTime = recordTimeForOrder(left, orderId);
  const rightTime = recordTimeForOrder(right, orderId);
  if (leftTime === null && rightTime !== null) return 1;
  if (leftTime !== null && rightTime === null) return -1;
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return rightTime - leftTime;
  return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

function orderRecords(records, orderId) {
  return [...(Array.isArray(records) ? records : [])].sort((left, right) => compareRecordOrder(left, right, orderId));
}

function recordsForLenses(summary, signalLensId, geographyLensId, orderId, mapCellId = "all") {
  const signalRecords = recordsForSignalLens(summary, signalLensId);
  const geographicRecords = recordsForGeographyLens({ records: signalRecords }, geographyLensId);
  return orderRecords(recordsForMapCell(geographicRecords, mapCellId), orderId);
}

function geographyCoverageText(records, returnedRecordCount, lens) {
  const mappedCount = (records ?? []).filter(hasProviderCoordinates).length;
  const mapUnavailableCount = Math.max((records ?? []).length - mappedCount, 0);
  if (!returnedRecordCount) return `MAP LENS · ${lens.label} · NO PUBLIC RECORDS RETURNED · NO DATA FABRICATED`;
  if (!(records ?? []).length) return `MAP LENS · ${lens.label} · 0/${returnedRecordCount} VISIBLE · NO DATA FABRICATED · PROVIDER STATUS BELOW`;
  return `MAP LENS · ${lens.label} · ${mappedCount} MAPPED · ${mapUnavailableCount} MAP-UNAVAILABLE · ${records.length}/${returnedRecordCount} VISIBLE · PROVIDER COORDINATES ONLY`;
}

function chronologyStatusText(lens, records, returnedRecordCount) {
  const visibleRecordCount = Array.isArray(records) ? records.length : 0;
  if (!returnedRecordCount) return `ORDER · ${lens.label} · NO PUBLIC RECORDS RETURNED · NO DATA FABRICATED`;
  const eventTimeUnavailableCount = (records ?? []).filter((record) => timestampMs(record?.eventTime) === null).length;
  const missingSuffix = lens.id === "event-time" && eventTimeUnavailableCount > 0
    ? ` · ${eventTimeUnavailableCount} EVENT TIME UNAVAILABLE · KEPT AT END`
    : "";
  return `ORDER · ${lens.label} · ${visibleRecordCount}/${returnedRecordCount} VISIBLE · ${lens.description.toUpperCase()}${missingSuffix}`;
}

function mapCellStatusText(mapCellId, records, returnedRecordCount, cellField) {
  const visibleRecordCount = Array.isArray(records) ? records.length : 0;
  if (mapCellId === "all") {
    return `MAP CELLS · ALL · ${cellField?.activeCellCount ?? 0} ACTIVE · ${cellField?.mappedRecordCount ?? 0} MAPPED / ${returnedRecordCount} RETURNED · COORDINATE BUCKETS ONLY`;
  }
  const cell = cellField?.cells?.find((candidate) => candidate.id === mapCellId);
  const label = cell?.label ?? mapCellId;
  if (!returnedRecordCount) return `MAP CELL · ${label} · NO PUBLIC RECORDS RETURNED · NO DATA FABRICATED`;
  if (!visibleRecordCount) return `MAP CELL · ${label} · 0/${returnedRecordCount} VISIBLE · NO DATA FABRICATED`;
  return `MAP CELL · ${label} · ${visibleRecordCount}/${returnedRecordCount} VISIBLE · PROVIDER COORDINATES ONLY`;
}

function lensStatusText(lens, records, returnedRecordCount) {
  const visibleRecordCount = Array.isArray(records) ? records.length : 0;
  if (!returnedRecordCount) {
    return `SIGNAL LENS · ${lens.label} · NO PUBLIC RECORDS RETURNED · NO DATA FABRICATED`;
  }
  if (!visibleRecordCount) {
    return `SIGNAL LENS · ${lens.label} · 0/${returnedRecordCount} MATCH · NO DATA FABRICATED · PROVIDER STATUS BELOW`;
  }
  return `SIGNAL LENS · ${lens.label} · ${visibleRecordCount}/${returnedRecordCount} MATCH${visibleRecordCount === 1 ? "" : "ES"} · TITLE LANGUAGE ONLY`;
}

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
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

function recordSummary(record) {
  if (!record) return "SELECT A PUBLIC RECORD TO INSPECT";
  const eventTime = record.eventTime ?? "EVENT TIME UNAVAILABLE";
  return `${record.title} · ${record.provider} · ${record.classification} · EVENT ${eventTime} · UNCERTAINTY ${record.uncertainty}`;
}

function geographyLabel(record) {
  const longitude = Number(record?.coordinates?.longitude);
  const latitude = Number(record?.coordinates?.latitude);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? `MAP ${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`
    : "MAP LOCATION UNAVAILABLE";
}

function brutalitySignalLabel(record) {
  const signal = record?.brutalityLanguageSignal;
  const level = Number(signal?.level);
  if (level >= 3) return "BRUTALITY LANGUAGE · EXPLICIT";
  if (level === 2) return "BRUTALITY LANGUAGE · VIOLENCE";
  if (level === 1) return "BRUTALITY LANGUAGE · CONTEXT";
  return "BRUTALITY LANGUAGE · NONE";
}

function formatHumanitarianMetric(value) {
  if (!Number.isFinite(Number(value))) return "UNKNOWN";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value));
}

function humanitarianGeographyLabel(record) {
  const geography = record?.geography;
  if (!geography || geography.status !== "provider-reported") return "GEOGRAPHY UNAVAILABLE · PROVIDER DID NOT NAME A DIMENSION";
  const dimensions = [];
  if (geography.origin) dimensions.push(`ORIGIN ${geography.origin.name ?? geography.origin.code ?? "UNKNOWN"}`);
  if (geography.asylum) dimensions.push(`ASYLUM ${geography.asylum.name ?? geography.asylum.code ?? "UNKNOWN"}`);
  return dimensions.length ? dimensions.join(" · ") : "GEOGRAPHY UNAVAILABLE";
}

function humanitarianMetricText(record) {
  const metrics = Object.entries(record?.metrics ?? {}).filter(([, value]) => value !== null && value !== undefined);
  if (!metrics.length) return "METRICS UNAVAILABLE · PROVIDER RETURNED NO USABLE VALUES";
  return `PROVIDER METRICS · ${metrics.map(([key, value]) => `${key.replaceAll("_", " ").toUpperCase()} ${formatHumanitarianMetric(value)}`).join(" · ")}`;
}

/**
 * Mount the public World Events evidence console. Network access belongs to
 * the host's explicit refresh callback; this renderer only presents data and
 * emits local selection/replay/reset snapshots.
 */
export function createWorldEventsConsole({
  documentRoot = globalThis.document,
  data = null,
  onRefresh = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
  onFilter = null,
  onProject = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("World Events console needs a document-like owner");
  const panel = documentRoot.getElementById("world-events-console");
  const projectionEl = documentRoot.getElementById("world-events-projection");
  const projectionOpenButton = documentRoot.getElementById("world-events-projection-open");
  const projectionStatusEl = documentRoot.getElementById("world-events-projection-status");
  const projectionSummaryEl = documentRoot.getElementById("world-events-projection-summary");
  const projectionProvidersEl = documentRoot.getElementById("world-events-projection-providers");
  const projectionBandsEl = documentRoot.getElementById("world-events-projection-bands");
  const projectionBoundaryEl = documentRoot.getElementById("world-events-projection-boundary");
  const closeButton = documentRoot.getElementById("world-events-close");
  const refreshButton = documentRoot.getElementById("world-events-refresh");
  const resetButton = documentRoot.getElementById("world-events-reset");
  const projectButton = documentRoot.getElementById("world-events-project");
  const statusEl = documentRoot.getElementById("world-events-status");
  const summaryEl = documentRoot.getElementById("world-events-summary");
  const signalFieldEl = documentRoot.getElementById("world-events-signal-field");
  const realityBrutalityEl = documentRoot.getElementById("world-events-reality-brutality");
  const mapCellsEl = documentRoot.getElementById("world-events-map-cells");
  const lensEl = documentRoot.getElementById("world-events-signal-lens");
  const lensStatusEl = documentRoot.getElementById("world-events-signal-lens-status");
  const queryInputEl = documentRoot.getElementById("world-events-query-input");
  const queryRefreshButton = documentRoot.getElementById("world-events-query-refresh");
  const queryEl = documentRoot.getElementById("world-events-query");
  const currentEl = documentRoot.getElementById("world-events-current");
  const sourcesEl = documentRoot.getElementById("world-events-sources");
  const recordsEl = documentRoot.getElementById("world-events-records");
  const traceEl = documentRoot.getElementById("world-events-trace");
  const boundaryEl = documentRoot.getElementById("world-events-boundary");
  const humanitarianStatusEl = documentRoot.getElementById("world-events-humanitarian-status");
  const humanitarianRecordsEl = documentRoot.getElementById("world-events-humanitarian-records");
  const humanitarianBoundaryEl = documentRoot.getElementById("world-events-humanitarian-boundary");
  if (!panel || !closeButton || !refreshButton || !resetButton || !statusEl || !summaryEl || !queryEl || !currentEl || !sourcesEl || !recordsEl || !traceEl) {
    throw new Error("World Events console mount points are missing");
  }

  let summary = summarizeWorldEvents(data);
  let selectedId = summary.records[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let loading = false;
  let refreshCount = 0;
  let trace = [];
  let signalLens = "all";
  let geographyLens = "all";
  let orderLens = "latest";
  let mapCellId = "all";
  let projected = false;

  let geographyLensEl = documentRoot.getElementById("world-events-geography-lens");
  if (!geographyLensEl && lensEl) {
    geographyLensEl = documentRoot.createElement("div");
    geographyLensEl.id = "world-events-geography-lens";
    geographyLensEl.className = "world-events-geography-lens";
    geographyLensEl.setAttribute?.("role", "group");
    geographyLensEl.setAttribute?.("aria-label", "Provider coordinate coverage lens");
    lensEl.appendChild(geographyLensEl);
  }
  if (geographyLensEl && !(Array.from(geographyLensEl.children ?? []).some((element) => element?.dataset?.worldEventsGeographyLens))) {
    const label = documentRoot.createElement("span");
    label.className = "world-events-geography-lens-label";
    label.textContent = "Map";
    geographyLensEl.appendChild(label);
    WORLD_EVENTS_GEOGRAPHY_LENSES.forEach((lens) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.dataset.worldEventsGeographyLens = lens.id;
      button.setAttribute?.("aria-pressed", String(lens.id === geographyLens));
      button.textContent = lens.label;
      geographyLensEl.appendChild(button);
    });
  }

  let orderLensEl = documentRoot.getElementById("world-events-order-lens");
  if (!orderLensEl && lensEl) {
    orderLensEl = documentRoot.createElement("div");
    orderLensEl.id = "world-events-order-lens";
    orderLensEl.className = "world-events-order-lens";
    orderLensEl.setAttribute?.("role", "group");
    orderLensEl.setAttribute?.("aria-label", "Public record chronology order");
    lensEl.appendChild(orderLensEl);
  }
  if (orderLensEl && !(Array.from(orderLensEl.children ?? []).some((element) => element?.dataset?.worldEventsOrderLens))) {
    const label = documentRoot.createElement("span");
    label.className = "world-events-order-lens-label";
    label.textContent = "Timeline";
    orderLensEl.appendChild(label);
    WORLD_EVENTS_ORDER_LENSES.forEach((lens) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.dataset.worldEventsOrderLens = lens.id;
      button.setAttribute?.("aria-pressed", String(lens.id === orderLens));
      button.textContent = lens.label;
      orderLensEl.appendChild(button);
    });
  }
  const orderStatusEl = documentRoot.getElementById("world-events-order-status");

  function visibleRecords() {
    return recordsForLenses(summary, signalLens, geographyLens, orderLens, mapCellId);
  }

  function visibleSummary() {
    const records = visibleRecords();
    const signalField = summarizeWorldEventSignalField(records);
    const mapCells = summarizeWorldEventMapCells(records);
    const realityBrutality = summarizeWorldEventRealityBrutality(records, summary.sources);
    return deepFreeze({
      ...summary,
      records,
      recordCount: records.length,
      brutalityLanguageSignalCount: records.filter((record) => brutalitySignalLevel(record) > 0).length,
      geographyLens,
      signalLens,
      orderLens,
      chronology: orderLens,
      mapCellId,
      signalField,
      mapCells,
      realityBrutality,
      signalCoverage: {
        returnedRecordCount: records.length,
        signalCount: records.filter((record) => brutalitySignalLevel(record) > 0).length,
        noSignalCount: records.filter((record) => brutalitySignalLevel(record) === 0).length,
      },
      geographicCoverage: {
        returnedRecordCount: records.length,
        mappedCount: records.filter(hasProviderCoordinates).length,
        mapUnavailableCount: records.filter((record) => !hasProviderCoordinates(record)).length,
      },
    });
  }

  function returnedMapCellField() {
    return summary.mapCells ?? summarizeWorldEventMapCells(summary.records);
  }

  function selectedMapCell() {
    if (mapCellId === "all") return null;
    return returnedMapCellField().cells.find((cell) => cell.id === mapCellId) ?? null;
  }

  function filterSnapshot(action = "filter", method = "button") {
    const lens = signalLensDefinition(signalLens);
    const mapLens = geographyLensDefinition(geographyLens);
    const order = orderLensDefinition(orderLens);
    const records = visibleRecords();
    const signalField = summarizeWorldEventSignalField(records);
    const mapCellField = summarizeWorldEventMapCells(summary.records);
    const realityBrutality = summarizeWorldEventRealityBrutality(records, summary.sources);
    const mapCell = mapCellField.cells.find((candidate) => candidate.id === mapCellId) ?? null;
    const returnedRecordCount = summary.records.length;
    return deepFreeze({
      source: WORLD_EVENTS_CONSOLE_SOURCE,
      action,
      method,
      signalLens: lens.id,
      signalFilter: lens.id,
      filter: lens.id,
      filterLabel: lens.label,
      lens,
      geographyLens: mapLens.id,
      coverageLens: mapLens.id,
      geographyFilter: mapLens.id,
      coverageLensLabel: mapLens.label,
      coverageLensDefinition: mapLens,
      orderLens: order.id,
      chronology: order.id,
      orderLabel: order.label,
      orderLensDefinition: order,
      queryInput: summary.query,
      mapCellId,
      mapCell,
      mapCellLabel: mapCell?.label ?? "ALL",
      mapCells: mapCellField,
      records,
      visibleRecords: records,
      visibleRecordIds: records.map((record) => record.id),
      visibleRecordCount: records.length,
      filteredRecordCount: Math.max(0, returnedRecordCount - records.length),
      returnedRecordCount,
      filterNoMatch: returnedRecordCount > 0 && records.length === 0,
      filterStatus: `${lensStatusText(lens, records, returnedRecordCount)} · ${geographyCoverageText(records, returnedRecordCount, mapLens)} · ${mapCellStatusText(mapCellId, records, returnedRecordCount, mapCellField)}`,
      chronologyStatus: chronologyStatusText(order, records, returnedRecordCount),
      signalField,
      realityBrutality,
      summary,
      visibleSummary: visibleSummary(),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      providerCredentials: false,
      liveFetch: false,
      truthClaim: false,
      executable: false,
    });
  }

  function emitFilter(action = "filter", method = "button") {
    const snapshot = filterSnapshot(action, method);
    onFilter?.(snapshot);
    return snapshot;
  }

  function selectedRecord() {
    const records = visibleRecords();
    return records.find((record) => record.id === selectedId) ?? records[0] ?? null;
  }

  function projectionAvailable() {
    return summary.liveFetch === true && summary.records.length > 0;
  }

  function projectionData() {
    const reality = summary.realityBrutality
      ?? summarizeWorldEventRealityBrutality(summary.records, summary.sources);
    const humanitarianRecords = Array.isArray(summary.humanitarian?.records)
      ? summary.humanitarian.records
      : [];
    return {
      reality,
      humanitarianRecordCount: humanitarianRecords.length,
      returnedRecordCount: summary.records.length,
      providerAvailable: reality.availableProviderCount,
      providerCount: reality.providerCount,
      mappedCount: reality.mappedCount,
      bands: reality.bands,
      boundary: summary.boundary ?? WORLD_EVENTS_BOUNDARY,
    };
  }

  function renderProjection() {
    const data = projectionData();
    const ready = projectionAvailable();
    if (projectionEl) {
      projectionEl.hidden = !projected;
      projectionEl.classList?.toggle?.("visible", projected);
      projectionEl.setAttribute?.("aria-hidden", String(!projected));
    }
    if (projectButton) {
      projectButton.disabled = loading || !ready;
      projectButton.setAttribute?.("aria-disabled", String(projectButton.disabled));
      projectButton.title = ready
        ? "Hide the full console and project the returned World Pulse field"
        : "Refresh public World Pulse data before projecting the field";
    }
    if (!projectionEl) return;
    if (projectionStatusEl) {
      projectionStatusEl.textContent = ready
        ? `${String(summary.status ?? "ready").toUpperCase()} · ${data.returnedRecordCount} RETURNED · ${data.humanitarianRecordCount} HUMANITARIAN · CUBE FIELD ACTIVE`
        : "REFRESH WORLD PULSE TO PROJECT RETURNED RECORDS";
    }
    if (projectionSummaryEl) {
      projectionSummaryEl.replaceChildren();
      [
        [data.returnedRecordCount, "returned records"],
        [`${data.providerAvailable}/${data.providerCount}`, "providers available"],
        [`${data.mappedCount}/${data.returnedRecordCount}`, "mapped coordinates"],
      ].forEach(([value, label]) => {
        const metric = documentRoot.createElement("div");
        metric.className = "world-events-projection-metric";
        metric.append(
          createText(documentRoot, "strong", "world-events-projection-metric-value", value),
          createText(documentRoot, "span", "world-events-projection-metric-label", label),
        );
        projectionSummaryEl.appendChild(metric);
      });
    }
    if (projectionProvidersEl) {
      projectionProvidersEl.textContent = data.reality.providerCoverage?.length
        ? data.reality.providerCoverage
          .map((provider) => `${provider.provider} ${provider.available ? "READY" : "UNAVAILABLE"} · ${provider.recordCount} RECORD${provider.recordCount === 1 ? "" : "S"}`)
          .join(" · ")
        : "PROVIDER STATUS UNAVAILABLE UNTIL AN EXPLICIT REFRESH.";
    }
    if (projectionBandsEl) {
      projectionBandsEl.replaceChildren();
      data.bands.forEach((band) => {
        // A projected band is a local lens control, not decorative status.
        // It reuses the same in-memory signal lens as the full console; the
        // host's onFilter/onSelect callbacks rebuild and focus the cube field
        // without issuing another provider request.
        const button = documentRoot.createElement("button");
        button.type = "button";
        button.className = "world-events-projection-band";
        button.dataset.worldEventsProjectionBand = band.id;
        const nextLens = band.id === "none" ? "all" : band.id;
        const active = signalLens === nextLens;
        button.disabled = !ready || band.recordCount === 0;
        button.setAttribute?.("aria-pressed", String(active));
        button.setAttribute?.("aria-label", `${band.label}: ${band.recordCount} returned record${band.recordCount === 1 ? "" : "s"}${button.disabled ? "; no matching returned cubes" : "; filter and focus first matching cube"}`);
        button.classList?.toggle?.("active", active);
        button.title = band.recordCount
          ? `Filter the returned title-language field to ${band.label} and focus its first cube`
          : `${band.label}; no returned records in this refresh`;
        button.append(
          createText(documentRoot, "strong", "world-events-projection-band-label", band.label),
          createText(documentRoot, "span", "world-events-projection-band-count", String(band.recordCount)),
        );
        button.addEventListener("click", () => {
          if (button.disabled) return;
          setSignalLens(nextLens, "projection-band");
          const firstRecordId = band.recordIds?.find((id) => visibleRecords().some((record) => record.id === id));
          if (firstRecordId) selectRecord(firstRecordId, "projection-band");
        });
        projectionBandsEl.appendChild(button);
      });
    }
    if (projectionBoundaryEl) {
      projectionBoundaryEl.textContent = `${data.boundary} Projection uses returned title-language bands and provider coordinates only; NO VERIFIED BRUTALITY, SEVERITY, CASUALTY, TRUTH, OR COMPLETENESS CLAIM.`;
    }
  }

  function setOpen(next) {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList?.toggle?.("visible", opened);
    panel.setAttribute?.("aria-hidden", String(!opened));
  }

  function openConsole(method = "button") {
    projected = false;
    setOpen(true);
    render();
    return deepFreeze({
      source: WORLD_EVENTS_CONSOLE_SOURCE,
      action: "open-console",
      method,
      summary,
      projection: projectionData(),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      providerCredentials: false,
      liveFetch: false,
      truthClaim: false,
      executable: false,
    });
  }

  function closeConsole() {
    projected = false;
    setOpen(false);
    render();
    return getSnapshot();
  }

  function projectField(method = "button") {
    if (!projectionAvailable()) return getSnapshot();
    projected = true;
    setOpen(false);
    render();
    const snapshot = deepFreeze({
      source: WORLD_EVENTS_CONSOLE_SOURCE,
      action: "project-field",
      method,
      summary,
      projection: projectionData(),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      providerCredentials: false,
      liveFetch: false,
      truthClaim: false,
      executable: false,
    });
    // The host owns the Three.js handoff. Keep this renderer callback-only:
    // projecting a returned envelope never creates a second store or performs
    // another provider request, while the host may reuse its local camera
    // focus seam for the newly visible field.
    onProject?.(snapshot);
    return snapshot;
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
    const records = visibleRecords();
    const mappedCount = records.filter(hasProviderCoordinates).length;
    const mapUnavailableCount = Math.max(records.length - mappedCount, 0);
    summaryEl.replaceChildren();
    [
      [records.length, signalLens === "all" && geographyLens === "all" ? "usable records" : "visible records"],
      [`${summary.availableProviderCount}/${summary.providerCount}`, "providers available"],
      [`${mappedCount}/${records.length}`, "mapped coordinates"],
      [mapUnavailableCount, "map unavailable"],
      [records.filter((record) => record.eventTime).length, "event times"],
      [records.filter((record) => brutalitySignalLevel(record) > 0).length, "title-language signals"],
    ].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div");
      metric.className = "world-events-metric";
      metric.append(createText(documentRoot, "b", "world-events-metric-value", value), createText(documentRoot, "span", "world-events-metric-label", label));
      summaryEl.appendChild(metric);
    });
  }

  function renderSignalField() {
    if (!signalFieldEl) return;
    const records = visibleRecords();
    const field = summarizeWorldEventSignalField(records);
    signalFieldEl.replaceChildren();
    const header = documentRoot.createElement("div");
    header.className = "world-events-signal-field-header";
    header.append(
      createText(documentRoot, "strong", "world-events-signal-field-title", "DERIVED SIGNAL FIELD"),
      createText(documentRoot, "span", "world-events-signal-field-count", `${records.length}/${summary.records.length} VISIBLE`),
    );
    signalFieldEl.appendChild(header);
    if (!records.length) {
      signalFieldEl.appendChild(createText(documentRoot, "div", "world-events-empty", "No returned records in this lens · NO DATA FABRICATED"));
      return;
    }
    const maxCount = Math.max(...field.bands.map((band) => band.recordCount), 1);
    field.bands.forEach((band) => {
      const row = documentRoot.createElement("div");
      row.className = "world-events-signal-field-row";
      const label = documentRoot.createElement("span");
      label.className = "world-events-signal-field-label";
      label.textContent = `${band.label} · ${band.recordCount}`;
      const track = documentRoot.createElement("span");
      track.className = "world-events-signal-field-track";
      const bar = documentRoot.createElement("span");
      bar.className = "world-events-signal-field-bar";
      if (bar.style) {
        bar.style.width = `${Math.round((band.recordCount / maxCount) * 100)}%`;
        bar.style.background = band.color;
        bar.style.boxShadow = `0 0 10px ${band.color}`;
      }
      track.appendChild(bar);
      row.append(label, track);
      signalFieldEl.appendChild(row);
    });
    const coverage = documentRoot.createElement("div");
    coverage.className = "world-events-signal-field-coverage";
    coverage.textContent = `MAP COVERAGE · ${field.mappedCount} MAPPED · ${field.mapUnavailableCount} MAP-UNAVAILABLE`;
    signalFieldEl.appendChild(coverage);
    signalFieldEl.appendChild(createText(documentRoot, "div", "world-events-signal-field-note", "Derived from returned title language and provider coordinates only · not a verified brutality or severity measure."));
  }

  function renderRealityBrutalityRail() {
    if (!realityBrutalityEl) return;
    const reality = summary.realityBrutality
      ?? summarizeWorldEventRealityBrutality(summary.records, summary.sources);
    realityBrutalityEl.replaceChildren();
    const header = documentRoot.createElement("div");
    header.className = "world-events-reality-brutality-header";
    header.append(
      createText(documentRoot, "strong", "world-events-reality-brutality-title", "REALITY / BRUTALITY CONTEXT"),
      createText(documentRoot, "span", "world-events-reality-brutality-count", `${reality.recordCount} RETURNED · ${reality.signalRecordCount} TITLE SIGNALS`),
    );
    realityBrutalityEl.appendChild(header);
    const coverage = documentRoot.createElement("div");
    coverage.className = "world-events-reality-brutality-coverage";
    const providerText = reality.providerCount
      ? `${reality.availableProviderCount}/${reality.providerCount} PROVIDERS AVAILABLE`
      : "NO PROVIDER STATUS RETURNED";
    coverage.textContent = `${providerText} · ${reality.mappedCount}/${reality.recordCount} MAPPED · ${reality.activeMapCellCount} ACTIVE MAP CELLS · ${reality.realityStatus}`;
    realityBrutalityEl.appendChild(coverage);
    const providerList = documentRoot.createElement("div");
    providerList.className = "world-events-reality-brutality-providers";
    providerList.textContent = reality.providerCoverage.length
      ? reality.providerCoverage.map((provider) => `${provider.provider} ${provider.available ? "READY" : "UNAVAILABLE"} · ${provider.recordCount} RECORDS`).join(" · ")
      : "Provider coverage unavailable until an explicit refresh.";
    realityBrutalityEl.appendChild(providerList);
    const bands = documentRoot.createElement("div");
    bands.className = "world-events-reality-brutality-bands";
    bands.setAttribute?.("role", "group");
    bands.setAttribute?.("aria-label", "Returned title-language reality and brutality bands");
    reality.bands.forEach((band) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "world-events-reality-brutality-band";
      button.dataset.worldEventsRealityBand = band.id;
      const active = band.id === "none"
        ? signalLens === "all"
        : signalLens === band.id;
      button.setAttribute?.("aria-pressed", String(active));
      button.classList?.toggle?.("active", active);
      button.title = band.recordCount
        ? `Filter to ${band.label} and focus its first returned record`
        : `${band.label}; no returned records in this refresh`;
      button.append(
        createText(documentRoot, "strong", "world-events-reality-brutality-band-label", band.label),
        createText(documentRoot, "span", "world-events-reality-brutality-band-count", `${band.recordCount} RECORD${band.recordCount === 1 ? "" : "S"}`),
        createText(documentRoot, "span", "world-events-reality-brutality-band-action", band.recordCount ? "FILTER · FOCUS" : "NO DATA"),
      );
      button.addEventListener("click", () => {
        const nextLens = band.id === "none" ? "all" : band.id;
        setSignalLens(nextLens, "reality-brutality-band");
        const firstRecordId = band.recordIds?.find((id) => visibleRecords().some((record) => record.id === id));
        if (firstRecordId) selectRecord(firstRecordId, "reality-brutality-band");
      });
      bands.appendChild(button);
    });
    realityBrutalityEl.appendChild(bands);
    realityBrutalityEl.appendChild(createText(
      documentRoot,
      "div",
      "world-events-reality-brutality-note",
      `${reality.brutalitySignalStatus} · ${reality.basis}`,
    ));
  }

  function renderMapCells() {
    if (!mapCellsEl) return;
    const field = summarizeWorldEventMapCells(summary.records);
    mapCellsEl.replaceChildren();
    const header = documentRoot.createElement("div");
    header.className = "world-events-map-cells-header";
    header.append(
      createText(documentRoot, "strong", "world-events-map-cells-title", "GLOBAL MAP CELLS"),
      createText(documentRoot, "span", "world-events-map-cells-count", `${field.activeCellCount} ACTIVE · ${field.mappedRecordCount}/${field.recordCount} MAPPED`),
    );
    mapCellsEl.appendChild(header);
    const controls = documentRoot.createElement("div");
    controls.className = "world-events-map-cells-controls";
    controls.setAttribute?.("role", "group");
    controls.setAttribute?.("aria-label", "Broad provider-coordinate map cells");
    const allButton = documentRoot.createElement("button");
    allButton.type = "button";
    allButton.dataset.worldEventsMapCell = "all";
    allButton.setAttribute?.("aria-pressed", String(mapCellId === "all"));
    allButton.classList?.toggle?.("active", mapCellId === "all");
    allButton.textContent = `ALL CELLS · ${field.recordCount}`;
    allButton.addEventListener("click", () => setMapCell("all", "map-cell-button"));
    controls.appendChild(allButton);
    field.cells.forEach((cell) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.dataset.worldEventsMapCell = cell.id;
      button.setAttribute?.("aria-pressed", String(cell.id === mapCellId));
      button.classList?.toggle?.("active", cell.id === mapCellId);
      button.title = `${cell.latitudeRange} · ${cell.longitudeRange} · provider coordinates only`;
      button.append(
        createText(documentRoot, "strong", "world-events-map-cell-label", cell.label),
        createText(documentRoot, "span", "world-events-map-cell-meta", `${cell.recordCount} RECORD${cell.recordCount === 1 ? "" : "S"} · ${cell.signalRecordCount} SIGNAL${cell.signalRecordCount === 1 ? "" : "S"} · ${cell.explicitSignalCount} EXPLICIT`),
      );
      button.addEventListener("click", () => setMapCell(cell.id, "map-cell-button"));
      controls.appendChild(button);
    });
    mapCellsEl.appendChild(controls);
    if (!field.cells.length) {
      mapCellsEl.appendChild(createText(documentRoot, "div", "world-events-empty", "No provider coordinates returned · NO MAP CELLS FABRICATED"));
    }
    mapCellsEl.appendChild(createText(documentRoot, "div", "world-events-map-cells-note", "Broad coordinate buckets only · not country labels, geocoding, severity, casualty, truth, or completeness."));
  }

  function renderHumanitarian() {
    if (!humanitarianRecordsEl && !humanitarianStatusEl) return;
    const humanitarian = summary.humanitarian ?? {};
    const records = Array.isArray(humanitarian.records) ? humanitarian.records : [];
    const provider = humanitarian.provider ?? "UNHCR Refugee Data Finder";
    if (humanitarianStatusEl) {
      humanitarianStatusEl.textContent = records.length
        ? `${String(humanitarian.status ?? "ready").toUpperCase()} · ${provider} · ${records.length} ANNUAL ROW${records.length === 1 ? "" : "S"} · STRUCTURED ONLY`
        : `UNAVAILABLE · ${provider} · NO STRUCTURED ROWS · NO DATA FABRICATED`;
    }
    if (humanitarianBoundaryEl) humanitarianBoundaryEl.textContent = humanitarian.boundary ?? "Structured humanitarian metrics are provider-reported annual observations; severity, intensity, casualties, truth, and missing geography remain unknown or unavailable.";
    if (!humanitarianRecordsEl) return;
    humanitarianRecordsEl.replaceChildren();
    if (!records.length) {
      humanitarianRecordsEl.appendChild(createText(documentRoot, "div", "world-events-empty", humanitarian.reason ?? "UNHCR has not returned structured population rows · NO DATA FABRICATED"));
      return;
    }
    records.forEach((record) => {
      const row = documentRoot.createElement("div");
      row.className = "world-events-humanitarian-record";
      const year = Number.isInteger(record?.observedYear) ? `YEAR ${record.observedYear}` : "YEAR UNAVAILABLE";
      row.append(
        createText(documentRoot, "strong", "world-events-humanitarian-record-title", `${provider} · ${year}`),
        createText(documentRoot, "span", "world-events-humanitarian-record-meta", `${humanitarianGeographyLabel(record)} · EVENT TIME UNAVAILABLE · RETRIEVED ${record?.retrievedAt ?? "—"}`),
        createText(documentRoot, "span", "world-events-humanitarian-record-metrics", humanitarianMetricText(record)),
        createText(documentRoot, "span", "world-events-humanitarian-record-boundary", `SEVERITY ${String(record?.severityStatus ?? "unknown").toUpperCase()} · INTENSITY ${String(record?.intensityStatus ?? "unknown").toUpperCase()} · ${record?.severityBasis ?? "Provider did not report event severity or intensity."}`),
      );
      if (record?.sourceUrl) {
        const sourceLink = documentRoot.createElement("a");
        sourceLink.className = "world-events-humanitarian-record-meta";
        sourceLink.href = record.sourceUrl;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        sourceLink.textContent = `OPEN UNHCR SOURCE · ${record.sourceUrl}`;
        row.appendChild(sourceLink);
      }
      humanitarianRecordsEl.appendChild(row);
    });
  }

  function renderSources() {
    sourcesEl.replaceChildren();
    if (!summary.sources.length) {
      sourcesEl.appendChild(createText(documentRoot, "div", "world-events-empty", "No public source endpoints are configured."));
      return;
    }
    summary.sources.forEach((source) => {
      const row = documentRoot.createElement("div");
      row.className = `world-events-source ${source.available ? "world-events-source-available" : "world-events-source-unavailable"}`;
      const state = source.available ? `AVAILABLE · ${source.recordCount} RECORD${source.recordCount === 1 ? "" : "S"}` : "UNAVAILABLE · NO DATA USED";
      row.append(
        createText(documentRoot, "strong", "world-events-source-title", source.provider),
        createText(documentRoot, "span", "world-events-source-meta", state),
        createText(documentRoot, "span", "world-events-source-endpoint", source.endpoint),
        createText(documentRoot, "span", "world-events-source-reason", source.reason ?? "Public endpoint queried only after explicit refresh."),
      );
      sourcesEl.appendChild(row);
    });
  }

  function renderRecords() {
    const records = visibleRecords();
    recordsEl.replaceChildren();
    if (!records.length) {
      const lens = signalLensDefinition(signalLens);
      const mapLens = geographyLensDefinition(geographyLens);
      const reasons = [];
      if (summary.records.length && signalLens !== "all") reasons.push(`${lens.label.toLowerCase()} title-language lens (${lens.description})`);
      if (summary.records.length && geographyLens !== "all") reasons.push(`${mapLens.label.toLowerCase()} geography lens (${mapLens.description})`);
      if (summary.records.length && mapCellId !== "all") reasons.push(`map cell ${selectedMapCell()?.label ?? mapCellId}`);
      const reason = summary.records.length
        ? `No returned records match ${reasons.join(" and ") || "the active lens"}.`
        : summary.reason ?? "No public records available. Refresh explicitly when online.";
      recordsEl.appendChild(createText(documentRoot, "div", "world-events-empty", `${reason} · NO DATA FABRICATED`));
      return;
    }
    records.forEach((record) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "world-events-record";
      button.dataset.recordId = record.id;
      button.setAttribute("aria-pressed", String(record.id === selectedId));
      button.title = record.sourceUrl;
      button.append(
        createText(documentRoot, "strong", "world-events-record-title", record.title),
        createText(documentRoot, "span", "world-events-record-meta", `${record.provider} · ${record.classification} · ${brutalitySignalLabel(record)}`),
        createText(documentRoot, "span", "world-events-record-time", `OBSERVED ${record.sourceObservedAt ?? "—"} · EVENT ${record.eventTime ?? "UNAVAILABLE"} · ${geographyLabel(record)}`),
      );
      button.addEventListener("click", () => selectRecord(record.id, "button"));
      recordsEl.appendChild(button);
    });
  }

  function renderCurrent() {
    const record = selectedRecord();
    currentEl.replaceChildren();
    if (!record) {
      const lens = signalLensDefinition(signalLens);
      const mapLens = geographyLensDefinition(geographyLens);
      const emptyReasons = [];
      if (summary.records.length && signalLens !== "all") emptyReasons.push(`NO ${lens.label} SIGNAL RECORDS`);
      if (summary.records.length && geographyLens !== "all") emptyReasons.push(`NO ${mapLens.label} RECORDS`);
      if (summary.records.length && mapCellId !== "all") emptyReasons.push(`NO ${selectedMapCell()?.label ?? mapCellId} RECORDS`);
      const empty = emptyReasons.length
        ? `${emptyReasons.join(" · ")} IN THIS REFRESH · SWITCH LENS OR REFRESH`
        : "SELECT A PUBLIC RECORD TO INSPECT · NO DATA FABRICATED";
      currentEl.appendChild(createText(documentRoot, "span", "world-events-current-empty", empty));
    } else {
      currentEl.append(
        createText(documentRoot, "strong", "world-events-current-title", record.title),
        createText(documentRoot, "span", "world-events-current-meta", `${record.provider} · ${record.classification} · CONFIDENCE ${record.confidence} · UNCERTAINTY ${record.uncertainty}`),
        createText(documentRoot, "span", "world-events-current-brutality", `${brutalitySignalLabel(record)} · ${record.brutalityLanguageSignal?.matchedTerms?.join(", ") || "no matched title terms"}`),
        createText(documentRoot, "span", "world-events-current-time", `SOURCE OBSERVED ${record.sourceObservedAt ?? "—"} · EVENT TIME ${record.eventTime ?? "UNAVAILABLE"} · ${geographyLabel(record)}`),
        createText(documentRoot, "span", "world-events-current-geography", `GEOGRAPHY · ${record.geographyStatus ?? (hasProviderCoordinates(record) ? "provider-reported" : "unavailable")} · ${record.geographyBasis ?? "Provider coordinates only; no geocoding or place inference."}`),
      );
      const sourceLink = documentRoot.createElement("a");
      sourceLink.className = "world-events-current-url";
      sourceLink.href = record.sourceUrl;
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceLink.textContent = `OPEN SOURCE · ${record.sourceUrl}`;
      currentEl.appendChild(sourceLink);
    }
    const lens = signalLensDefinition(signalLens);
    const lensSuffix = signalLens === "all" ? "" : ` · LENS ${lens.label}`;
    const mapLens = geographyLensDefinition(geographyLens);
    const mapLensSuffix = geographyLens === "all" ? "" : ` · MAP ${mapLens.label}`;
    const mapCellSuffix = mapCellId === "all" ? "" : ` · CELL ${selectedMapCell()?.label ?? mapCellId}`;
    const status = summary.status === "ready"
      ? `READY · ${visibleRecords().length} PUBLIC RECORD${visibleRecords().length === 1 ? "" : "S"} · RESEARCH ONLY${lensSuffix}${mapLensSuffix}${mapCellSuffix}`
      : summary.status === "partial"
        ? `PARTIAL · ${visibleRecords().length} RECORD${visibleRecords().length === 1 ? "" : "S"} · SOME PROVIDERS UNAVAILABLE${lensSuffix}${mapLensSuffix}${mapCellSuffix}`
        : `UNAVAILABLE · NO PUBLIC DATA LOADED · NO DATA FABRICATED${lensSuffix}${mapLensSuffix}${mapCellSuffix}`;
    statusEl.textContent = loading ? "REFRESHING PUBLIC SOURCES · WAITING FOR RESPONSE" : trace.length ? `${status} · ${trace.length} LOCAL INSPECTION${trace.length === 1 ? "" : "S"}` : status;
    refreshButton.disabled = loading;
    if (queryInputEl && documentRoot.activeElement !== queryInputEl) queryInputEl.value = summary.query;
    if (queryRefreshButton) queryRefreshButton.disabled = loading;
    resetButton.disabled = trace.length === 0 && selectedId === (visibleRecords()[0]?.id ?? null) && signalLens === "all" && geographyLens === "all" && orderLens === "latest" && mapCellId === "all";
    queryEl.textContent = `QUERY · ${summary.query} · RETRIEVED ${summary.retrievedAt ?? "—"}`;
    if (boundaryEl) boundaryEl.textContent = summary.boundary ?? WORLD_EVENTS_BOUNDARY;
  }

  function renderSignalLens() {
    const buttons = Array.from(lensEl?.children ?? []).filter((element) => element?.dataset?.worldEventsLens);
    buttons.forEach((button) => {
      const active = button.dataset.worldEventsLens === signalLens;
      button.setAttribute?.("aria-pressed", String(active));
      button.classList?.toggle?.("active", active);
    });
    const lens = signalLensDefinition(signalLens);
    const mapLens = geographyLensDefinition(geographyLens);
    const records = visibleRecords();
    const mapCellField = summarizeWorldEventMapCells(summary.records);
    if (lensStatusEl) lensStatusEl.textContent = `${lensStatusText(lens, records, summary.records.length)} · ${geographyCoverageText(records, summary.records.length, mapLens)} · ${mapCellStatusText(mapCellId, records, summary.records.length, mapCellField)}`;
  }

  function renderGeographyLens() {
    const buttons = Array.from(geographyLensEl?.children ?? []).filter((element) => element?.dataset?.worldEventsGeographyLens);
    buttons.forEach((button) => {
      const active = button.dataset.worldEventsGeographyLens === geographyLens;
      button.setAttribute?.("aria-pressed", String(active));
      button.classList?.toggle?.("active", active);
    });
  }

  function renderOrderLens() {
    const buttons = Array.from(orderLensEl?.children ?? []).filter((element) => element?.dataset?.worldEventsOrderLens);
    buttons.forEach((button) => {
      const active = button.dataset.worldEventsOrderLens === orderLens;
      button.setAttribute?.("aria-pressed", String(active));
      button.classList?.toggle?.("active", active);
    });
    const lens = orderLensDefinition(orderLens);
    if (orderStatusEl) orderStatusEl.textContent = chronologyStatusText(lens, visibleRecords(), summary.records.length);
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "world-events-empty", "No local inspection yet. Refresh public evidence, then select a record to inspect."));
      return;
    }
    trace.forEach((entry, index) => traceEl.appendChild(createText(
      documentRoot,
      "div",
      "world-events-trace-row",
      `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "all records"} · LOCAL ONLY`,
    )));
  }

  function render() {
    renderSummary();
    renderSignalField();
    renderRealityBrutalityRail();
    renderMapCells();
    renderHumanitarian();
    renderSignalLens();
    renderGeographyLens();
    renderOrderLens();
    renderSources();
    renderRecords();
    renderCurrent();
    renderTrace();
    renderProjection();
  }

  function selectRecord(recordId, method = "button") {
    const record = visibleRecords().find((candidate) => candidate.id === recordId);
    if (!record) return null;
    selectedId = record.id;
    const snapshot = deepFreeze({
      source: WORLD_EVENTS_CONSOLE_SOURCE,
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
    const snapshot = replayWorldEventEvidence(summary, selectedId, method);
    pushTrace({ action: "replay", recordId: snapshot.recordId });
    render();
    const envelope = deepFreeze({ ...snapshot, source: WORLD_EVENTS_CONSOLE_SOURCE });
    onReplay?.(envelope);
    return envelope;
  }

  function reset(method = "button") {
    signalLens = "all";
    geographyLens = "all";
    orderLens = "latest";
    mapCellId = "all";
    selectedId = summary.records[0]?.id ?? null;
    trace = [];
    const snapshot = deepFreeze({
      source: WORLD_EVENTS_CONSOLE_SOURCE,
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
    emitFilter("reset", method);
    return snapshot;
  }

  function setSignalLens(nextLens, method = "button") {
    const next = signalLensDefinition(nextLens).id;
    signalLens = next;
    const records = visibleRecords();
    if (!records.some((record) => record.id === selectedId)) selectedId = records[0]?.id ?? null;
    const snapshot = filterSnapshot("filter", method);
    pushTrace({ action: "filter", recordId: selectedId, signalLens: next });
    render();
    onFilter?.(snapshot);
    return snapshot;
  }

  function setGeographyLens(nextLens, method = "button") {
    const next = geographyLensDefinition(nextLens).id;
    geographyLens = next;
    const records = visibleRecords();
    if (!records.some((record) => record.id === selectedId)) selectedId = records[0]?.id ?? null;
    const snapshot = filterSnapshot("geography-filter", method);
    pushTrace({ action: "geography-filter", recordId: selectedId, geographyLens: next });
    render();
    onFilter?.(snapshot);
    return snapshot;
  }

  function setOrderLens(nextLens, method = "button") {
    const next = orderLensDefinition(nextLens).id;
    orderLens = next;
    const records = visibleRecords();
    if (!records.some((record) => record.id === selectedId)) selectedId = records[0]?.id ?? null;
    const snapshot = filterSnapshot("chronology", method);
    pushTrace({ action: "chronology", recordId: selectedId, orderLens: next });
    render();
    onFilter?.(snapshot);
    return snapshot;
  }

  function setMapCell(nextCell, method = "button") {
    const requested = String(nextCell ?? "all");
    const field = summarizeWorldEventMapCells(summary.records);
    if (requested !== "all" && !field.cells.some((cell) => cell.id === requested)) return getSnapshot();
    mapCellId = requested;
    const records = visibleRecords();
    if (!records.some((record) => record.id === selectedId)) selectedId = records[0]?.id ?? null;
    const snapshot = filterSnapshot("map-cell-filter", method);
    pushTrace({ action: "map-cell-filter", recordId: selectedId, mapCellId });
    render();
    onFilter?.(snapshot);
    return snapshot;
  }

  async function refresh(method = "button", options = {}) {
    if (loading) return getSnapshot();
    const requestedQuery = normalizeWorldEventsQuery(options.query ?? queryInputEl?.value ?? summary.query ?? WORLD_EVENTS_DEFAULT_QUERY);
    loading = true;
    renderCurrent();
    try {
      const result = await onRefresh?.({
        query: requestedQuery,
        method,
      });
      summary = summarizeWorldEvents(result ?? createUnavailableWorldEvents({
        query: requestedQuery,
        reason: "Refresh returned no public response; no data was fabricated.",
      }));
      if (mapCellId !== "all" && !summary.mapCells?.cells?.some((cell) => cell.id === mapCellId)) mapCellId = "all";
      selectedId = summary.records[0]?.id ?? null;
      if (!visibleRecords().some((record) => record.id === selectedId)) selectedId = visibleRecords()[0]?.id ?? null;
      refreshCount += 1;
      pushTrace({ action: "refresh", recordId: null, refreshCount });
    } catch (error) {
      summary = summarizeWorldEvents(createUnavailableWorldEvents({
        query: requestedQuery,
        reason: `Public provider unavailable: ${text(error?.message ?? error, "unknown error")}`,
      }));
      mapCellId = "all";
      selectedId = null;
      refreshCount += 1;
      pushTrace({ action: "refresh-unavailable", recordId: null, refreshCount });
    } finally {
      loading = false;
      render();
      emitFilter("refresh", method);
    }
    return getSnapshot();
  }

  function setData(nextData) {
    summary = summarizeWorldEvents(nextData);
    if (mapCellId !== "all" && !summary.mapCells?.cells?.some((cell) => cell.id === mapCellId)) mapCellId = "all";
    if (!visibleRecords().some((record) => record.id === selectedId)) selectedId = visibleRecords()[0]?.id ?? null;
    render();
    emitFilter("set-data", "host");
    return getSnapshot();
  }

  function getSnapshot() {
    const lens = signalLensDefinition(signalLens);
    const mapLens = geographyLensDefinition(geographyLens);
    const order = orderLensDefinition(orderLens);
    const records = visibleRecords();
    const returnedRecordCount = summary.records.length;
    const signalField = summarizeWorldEventSignalField(records);
    const returnedSignalField = summarizeWorldEventSignalField(summary.records);
    const realityBrutality = summarizeWorldEventRealityBrutality(records, summary.sources);
    const returnedRealityBrutality = summarizeWorldEventRealityBrutality(summary.records, summary.sources);
    const mapCellField = summarizeWorldEventMapCells(summary.records);
    const mapCell = mapCellField.cells.find((candidate) => candidate.id === mapCellId) ?? null;
    const projectedSummary = visibleSummary();
    return deepFreeze({
      source: WORLD_EVENTS_CONSOLE_SOURCE,
      summary,
      selectedId,
      selectedRecord: selectedRecord(),
      signalLens,
      signalFilter: signalLens,
      filter: signalLens,
      filterLabel: lens.label,
      lens,
      geographyLens: mapLens.id,
      coverageLens: mapLens.id,
      geographyFilter: mapLens.id,
      coverageLensLabel: mapLens.label,
      coverageLensDefinition: mapLens,
      orderLens,
      chronology: orderLens,
      orderLabel: order.label,
      orderLensDefinition: order,
      queryInput: summary.query,
      mapCellId,
      mapCell,
      mapCellLabel: mapCell?.label ?? "ALL",
      mapCells: mapCellField,
      returnedMapCells: mapCellField,
      visibleRecords: records,
      visibleRecordIds: records.map((record) => record.id),
      visibleRecordCount: records.length,
      filteredRecordCount: Math.max(0, returnedRecordCount - records.length),
      returnedRecordCount,
      filterNoMatch: returnedRecordCount > 0 && records.length === 0,
      filterStatus: `${lensStatusText(lens, records, returnedRecordCount)} · ${geographyCoverageText(records, returnedRecordCount, mapLens)} · ${mapCellStatusText(mapCellId, records, returnedRecordCount, mapCellField)}`,
      chronologyStatus: chronologyStatusText(order, records, returnedRecordCount),
      signalField,
      returnedSignalField,
      realityBrutality,
      returnedRealityBrutality,
      visibleSummary: projectedSummary,
      geographicCoverage: summary.geographicCoverage,
      signalCoverage: summary.signalCoverage,
      humanitarian: summary.humanitarian,
      visibleGeographicCoverage: projectedSummary.geographicCoverage,
      opened,
      projected,
      projection: {
        active: projected,
        available: projectionAvailable(),
        ...projectionData(),
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        truthClaim: false,
        executable: false,
      },
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
      boundary: summary.boundary ?? WORLD_EVENTS_BOUNDARY,
    });
  }

  closeButton.addEventListener("click", () => closeConsole());
  projectButton?.addEventListener("click", () => projectField("button"));
  projectionOpenButton?.addEventListener("click", () => openConsole("projection-button"));
  refreshButton.addEventListener("click", () => refresh("button"));
  queryRefreshButton?.addEventListener("click", () => refresh("query-button", { query: queryInputEl?.value }));
  resetButton.addEventListener("click", () => reset("button"));
  Array.from(lensEl?.children ?? [])
    .filter((element) => element?.dataset?.worldEventsLens)
    .forEach((button) => button.addEventListener("click", () => setSignalLens(button.dataset.worldEventsLens, "button")));
  Array.from(geographyLensEl?.children ?? [])
    .filter((element) => element?.dataset?.worldEventsGeographyLens)
    .forEach((button) => button.addEventListener("click", () => setGeographyLens(button.dataset.worldEventsGeographyLens, "button")));
  Array.from(orderLensEl?.children ?? [])
    .filter((element) => element?.dataset?.worldEventsOrderLens)
    .forEach((button) => button.addEventListener("click", () => setOrderLens(button.dataset.worldEventsOrderLens, "button")));
  documentRoot.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape" && opened) closeConsole();
  });
  render();
  setOpen(opened);

  return Object.freeze({
    open: () => openConsole("api"),
    close: () => closeConsole(),
    toggle: () => (projected || !opened ? openConsole("toggle") : closeConsole()),
    projectField,
    openConsole,
    refresh,
    selectRecord,
    replay,
    reset,
    setSignalLens,
    setSignalFilter: setSignalLens,
    setGeographyLens,
    setCoverageLens: setGeographyLens,
    setOrderLens,
    setChronology: setOrderLens,
    setMapCell,
    setRegionCell: setMapCell,
    setData,
    setProjection: setData,
    getSnapshot,
    destroy: () => {},
  });
}

export const createWorldEventsEvidenceConsole = createWorldEventsConsole;
export default createWorldEventsConsole;
