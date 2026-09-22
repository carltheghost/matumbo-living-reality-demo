import { mountMarketBuilder } from './market-builder.js?v=20260922-cache2';
import {
  CONTRACTS_MARKETS_DRAFT_ROUTE_VERSION,
  CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_LENGTH,
  CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM,
  CONTRACTS_MARKETS_CONTRACT_ROUTE_PARAM,
  CONTRACTS_MARKETS_GRAPH_ROUTE_MODE,
  CONTRACTS_MARKETS_ALLOWED_PROVENANCE_HOSTS,
  CONTRACTS_MARKETS_SOURCE_RETURN_JOURNEY,
  CONTRACTS_MARKETS_SOURCE,
  CONTRACTS_MARKETS_REHEARSAL_SOURCE,
  ContractState,
  createContractDraftRouteState,
  createContractPoolRehearsal,
  createContractsMarketsGraph,
  validateContractDraftRouteState,
} from "../domains/contracts-markets.js?v=20260922-cache2";

export const CONTRACTS_MARKETS_CONSOLE_SOURCE = "contracts-markets-console";
export const CONTRACTS_MARKETS_RENDER_SOURCE = CONTRACTS_MARKETS_CONSOLE_SOURCE;
const DEFAULT_BOUNDARY = "Contracts and pools are fictional local scenarios. No trade, custody, signing, settlement, or market authority is active.";
const DEFAULT_DRAFT_SOURCE_ROUTE = "?build=control4&fresh=20260903-reality-lens&panel=sports-events&journey=contract-detail-source-182";
const GRAPH_ROUTE_RECORD_KINDS = new Set([
  "contract-scenario",
  "pool-scenario",
  "collateral-scenario",
  "position-scenario",
]);

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
  if (projection?.source === CONTRACTS_MARKETS_SOURCE) return projection;
  return asArray(projection?.contributions).find((contribution) => contribution?.source === CONTRACTS_MARKETS_SOURCE)
    ?? { source: CONTRACTS_MARKETS_SOURCE, updatedAt: null, entities: [], evidence: [], capabilities: [] };
}

function kindLabel(entity) {
  return text(entity?.kind ?? entity?.type ?? "scenario").replace(/-scenario$/, "").replace(/-/g, " ");
}

function entityLabel(entity) {
  return entity?.label
    ?? entity?.band
    ?? entity?.side
    ?? entity?.id
    ?? "unnamed scenario";
}

function draftSourceFor(record) {
  if (!isRecord(record) || typeof record.id !== "string") return null;
  const players = (Array.isArray(record.players) ? record.players : Array.isArray(record.competitors) ? record.competitors : [])
    .slice(0, 2)
    .map((player) => ({
      id: typeof player?.id === "string" ? player.id : null,
      name: typeof player?.name === "string" ? player.name : typeof player?.displayName === "string" ? player.displayName : "Player unavailable",
      rank: Number.isSafeInteger(player?.rank) ? player.rank : null,
    }));
  return deepFreeze({
    id: record.id,
    title: typeof record.title === "string" ? record.title : "Selected public record",
    tour: typeof record.tour === "string" ? record.tour : "SPORTS",
    provider: typeof record.provider === "string" ? record.provider : "Public provider",
    sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : null,
    retrievedAt: typeof record.retrievedAt === "string" ? record.retrievedAt : null,
    players,
  });
}

function eligibleDraftSource(record) {
  const source = draftSourceFor(record);
  if (!source || !source.id || !source.sourceUrl) return false;
  if (!(source.tour.toUpperCase() === "ATP" || source.tour.toUpperCase() === "WTA" || source.tour.toUpperCase() === "SPORTS")) return false;
  const players = Array.isArray(source.players) ? source.players : [];
  if (players.length !== 2 || players.some((player) => !player?.name || player.name === "Player unavailable")) return false;
  try {
    const parsed = new URL(source.sourceUrl);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.port
      && CONTRACTS_MARKETS_ALLOWED_PROVENANCE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function draftRouteHref(routeState, focus = null) {
  if (!routeState || typeof routeState !== "object") return null;
  let serialized;
  try {
    serialized = JSON.stringify(routeState);
  } catch {
    return null;
  }
  if (!serialized || serialized.length > CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_LENGTH) return null;
  try {
    // Build the same bounded query used by the main bootstrap. Existing
    // feature/live/draft parameters are removed so copying a route can never
    // carry an unrelated provider refresh or stale feature handoff with it.
    const baseHref = typeof globalThis.location?.href === "string"
      ? globalThis.location.href
      : "http://matumbo.local/";
    const url = new URL(baseHref);
    url.searchParams.delete("feature");
    url.searchParams.delete("live");
    url.searchParams.delete(CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM);
    url.searchParams.delete(CONTRACTS_MARKETS_CONTRACT_ROUTE_PARAM);
    url.searchParams.set("panel", "contracts");
    url.searchParams.set(CONTRACTS_MARKETS_CONTRACT_ROUTE_PARAM, routeState.contractId);
    url.searchParams.set(CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM, serialized);
    if (typeof focus === "string" && focus.trim()) url.searchParams.set("node", focus.trim());
    url.hash = "";
    // A relative route is portable across localhost ports and remains safe
    // in test hosts; a browser with a real location gets an absolute link.
    return typeof globalThis.location?.href === "string"
      ? url.toString()
      : `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function graphRouteHref(recordId) {
  if (typeof recordId !== "string" || !/^[a-z0-9:_-]{1,160}$/i.test(recordId)) return null;
  try {
    const baseHref = typeof globalThis.location?.href === "string"
      ? globalThis.location.href
      : "http://matumbo.local/";
    const url = new URL(baseHref);
    url.searchParams.delete("feature");
    url.searchParams.delete("live");
    url.searchParams.delete("draft");
    url.searchParams.delete("contract");
    url.searchParams.delete("node");
    url.searchParams.set("panel", "contracts");
    url.searchParams.set("record", recordId);
    url.searchParams.set("graph", CONTRACTS_MARKETS_GRAPH_ROUTE_MODE);
    url.hash = "";
    return typeof globalThis.location?.href === "string"
      ? url.toString()
      : `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function safeDraftSourceRoute(value, sourceRecordId) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 320) return null;
  try {
    const parsed = new URL(value.trim(), "http://matumbo.local");
    if (parsed.origin !== "http://matumbo.local"
      || parsed.hash
      || !["sports-events", "multi-sport-events"].includes(parsed.searchParams.get("panel"))
      || parsed.searchParams.get("journey") !== CONTRACTS_MARKETS_SOURCE_RETURN_JOURNEY) return null;
    if (parsed.searchParams.get("record") !== sourceRecordId) return null;
    if (!/^[a-z0-9:_.-]{1,160}$/i.test(parsed.searchParams.get("record") ?? "")) return null;
    return value.trim().slice(0, 320);
  } catch {
    return null;
  }
}

/** Read the canonical contracts contribution without creating execution state. */
export function summarizeContractsMarkets(projection) {
  const contribution = contributionFrom(projection);
  const entities = asArray(contribution.entities);
  const graph = createContractsMarketsGraph(contribution);
  const records = entities.map((entity) => deepFreeze({
    ...entity,
    label: entityLabel(entity),
    displayKind: kindLabel(entity),
  }));
  return deepFreeze({
    source: CONTRACTS_MARKETS_SOURCE,
    updatedAt: contribution.updatedAt,
    records,
    contracts: records.filter((record) => record.kind === "contract-scenario"),
    pools: records.filter((record) => record.kind === "pool-scenario"),
    collateral: records.filter((record) => record.kind === "collateral-scenario"),
    positions: records.filter((record) => record.kind === "position-scenario"),
    risks: records.filter((record) => record.kind === "risk-scenario"),
    graph,
    recordCount: records.length,
    capabilityCount: asArray(contribution.capabilities).length,
    evidenceCount: asArray(contribution.evidence).length,
    simulation: contribution.simulation === true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    persistence: false,
    boundary: contribution.evidence?.[0]?.note ?? DEFAULT_BOUNDARY,
  });
}

export function createContractsMarketsConsole({
  documentRoot = globalThis.document,
  projection = null,
  onSelect = null,
  onGraphExpand = null,
  onReplay = null,
  onReset = null,
  onDraft = null,
  onDraftClear = null,
  onDraftInspect = null,
  onDraftCopy = null,
  onOpenSportsEvidence = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Contracts + Pools console needs a document-like owner");
  const panel = documentRoot.getElementById("contracts-markets-console");
  const closeButton = documentRoot.getElementById("contracts-markets-close");
  const replayButton = documentRoot.getElementById("contracts-markets-replay");
  const resetButton = documentRoot.getElementById("contracts-markets-reset");
  const statusEl = documentRoot.getElementById("contracts-markets-status");
  const summaryEl = documentRoot.getElementById("contracts-markets-summary");
  const currentEl = documentRoot.getElementById("contracts-markets-current");
  const listEl = documentRoot.getElementById("contracts-markets-list");
  const traceEl = documentRoot.getElementById("contracts-markets-trace");
  const boundaryEl = documentRoot.getElementById("contracts-markets-boundary");
  const draftEl = documentRoot.getElementById("contracts-markets-draft");
  const draftSourceEl = documentRoot.getElementById("contracts-markets-draft-source");
  const draftContractLabelEl = documentRoot.getElementById("contracts-markets-draft-contract-label");
  const draftPoolLabelEl = documentRoot.getElementById("contracts-markets-draft-pool-label");
  const draftCreateButton = documentRoot.getElementById("contracts-markets-draft-create");
  const draftClearButton = documentRoot.getElementById("contracts-markets-draft-clear");
  const draftInspectButton = documentRoot.getElementById("contracts-markets-draft-inspect");
  const draftCloseButton = documentRoot.getElementById("contracts-markets-draft-close");
  const draftCopyButton = documentRoot.getElementById("contracts-markets-draft-copy");
  const draftStatusEl = documentRoot.getElementById("contracts-markets-draft-status");
  const draftBackLinkEl = documentRoot.getElementById("contracts-markets-draft-back");
  const openSportsEvidenceButton = documentRoot.getElementById("contracts-markets-open-sports");
  if (!panel || !closeButton || !replayButton || !resetButton || !statusEl || !summaryEl || !currentEl || !listEl || !traceEl) {
    throw new Error("Contracts + Pools console mount points are missing");
  }

  let summary = summarizeContractsMarkets(projection);
  let selectedId = summary.records[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let trace = [];
  let expandedGraph = null;
  let graphRouteError = null;
  let draftSource = null;
  let draftSourceRoute = null;
  let draftRouteError = null;
  let draftCopyStatus = null;
  let localDraft = null;
  mountMarketBuilder({documentRoot,panel,getSource:()=>draftSource});
  // The host markup predates linked-graph inspection, so mount one optional
  // native details rail at runtime. It is deliberately outside the rerendered
  // list/current nodes and remains usable in compact/static DOM test hosts.
  const existingGraphExpandButton = documentRoot.getElementById("contracts-markets-expand-graph");
  const graphExpandButton = existingGraphExpandButton ?? documentRoot.createElement("button");
  const graphExpandButtonNeedsMount = !existingGraphExpandButton;
  graphExpandButton.id = "contracts-markets-expand-graph";
  graphExpandButton.type = "button";
  graphExpandButton.className = "contracts-markets-expand-graph";
  graphExpandButton.textContent = "EXPAND LINKED GRAPH";
  const existingGraphDetailsEl = documentRoot.getElementById("contracts-markets-graph");
  const graphDetailsEl = existingGraphDetailsEl ?? documentRoot.createElement("div");
  const graphDetailsNeedsMount = !existingGraphDetailsEl;
  graphDetailsEl.id = "contracts-markets-graph";
  graphDetailsEl.className = "contracts-markets-graph";
  graphDetailsEl.setAttribute?.("role", "region");
  graphDetailsEl.setAttribute?.("aria-label", "Expanded contract graph");
  if (graphExpandButtonNeedsMount) panel.appendChild?.(graphExpandButton);
  if (graphDetailsNeedsMount) panel.appendChild?.(graphDetailsEl);

  function selectedRecord() {
    if (graphRouteError) return null;
    return summary.records.find((record) => record.id === selectedId) ?? summary.records[0] ?? null;
  }

  function graphReadoutFor(recordId = selectedId) {
    if (!recordId) return null;
    return summary.graph?.readouts?.find((readout) => readout.nodeIds?.includes(recordId)) ?? null;
  }

  function coverageText(readout) {
    return Number.isFinite(readout?.coverageRatio) ? readout.coverageRatio.toFixed(2) : "N/A";
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
      [summary.recordCount, "linked records"],
      [summary.contracts.length, "contracts"],
      [summary.pools.length, "pools"],
      [summary.risks.length, "risk views"],
    ].forEach(([value, label]) => {
      const metric = documentRoot.createElement("div");
      metric.className = "contracts-markets-metric";
      metric.append(createText(documentRoot, "b", "contracts-markets-metric-value", value), createText(documentRoot, "span", "contracts-markets-metric-label", label));
      summaryEl.appendChild(metric);
    });
  }

  function renderCurrent() {
    const record = selectedRecord();
    const readout = expandedGraph?.nodeIds?.includes(record?.id) ? expandedGraph : graphReadoutFor(record?.id);
    const graphText = readout
      ? ` · GRAPH ${String(readout.status).toUpperCase()} · ${readout.completeLinkCount ?? 0} COMPLETE/${readout.missingLinkCount ?? 0} MISSING · COVERAGE ${coverageText(readout)} · RISK ${String(readout.riskBand ?? "UNKNOWN").toUpperCase()}`
      : " · GRAPH MISSING · NO LINKED CHAIN";
    currentEl.textContent = graphRouteError
      ? `GRAPH ROUTE REJECTED · ${graphRouteError} · NO NODE FABRICATED`
      : record
      ? `${record.label} · ${record.displayKind.toUpperCase()} · ${record.state ?? record.band ?? record.side ?? "linked"}${graphText}`
      : "NO CONTRACT OR POOL RECORDS · GRAPH MISSING";
    if (boundaryEl) boundaryEl.textContent = summary.boundary;
    statusEl.textContent = graphRouteError
      ? `GRAPH ROUTE REJECTED · ${graphRouteError} · NO NODE FABRICATED`
      : trace.length
      ? `READY · ${trace.length} LOCAL INSPECTION${trace.length === 1 ? "" : "S"} · NO EXECUTION`
      : "READY · SELECT A CONTRACT, POOL, OR RISK VIEW";
    replayButton.disabled = summary.records.length === 0;
    resetButton.disabled = trace.length === 0 && selectedId === (summary.records[0]?.id ?? null);
  }

  function renderList() {
    listEl.replaceChildren();
    if (!summary.records.length) {
      listEl.appendChild(createText(documentRoot, "div", "contracts-markets-empty", "No local contract or pool records are projected."));
      return;
    }
    summary.records.forEach((record) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "contracts-markets-record";
      button.dataset.recordId = record.id;
      button.setAttribute("aria-pressed", String(record.id === selectedId));
      button.append(
        createText(documentRoot, "strong", "contracts-markets-record-title", record.label),
        createText(documentRoot, "span", "contracts-markets-record-meta", `${record.displayKind} · ${record.state ?? record.band ?? record.side ?? "linked"}`),
      );
      button.addEventListener("click", () => selectRecord(record.id, "button"));
      listEl.appendChild(button);
    });
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "contracts-markets-empty", "No local inspection yet. Select a record to open its links."));
      return;
    }
    trace.forEach((entry, index) => traceEl.appendChild(createText(
      documentRoot,
      "div",
      "contracts-markets-trace-row",
      `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "all records"}${entry.graphStatus ? ` · ${String(entry.graphStatus).toUpperCase()}` : ""} · LOCAL ONLY`,
    )));
  }

  function renderGraph() {
    const readout = graphReadoutFor(selectedId);
    graphExpandButton.disabled = Boolean(graphRouteError) || !readout;
    graphExpandButton.setAttribute?.("aria-expanded", String(Boolean(expandedGraph)));
    graphExpandButton.textContent = expandedGraph ? "COLLAPSE LINKED GRAPH" : "EXPAND LINKED GRAPH";
    graphDetailsEl.hidden = !expandedGraph && !graphRouteError;
    graphDetailsEl.replaceChildren?.();
    if (graphRouteError) {
      graphDetailsEl.appendChild?.(createText(
        documentRoot,
        "div",
        "contracts-markets-graph-route-error",
        `GRAPH ROUTE REJECTED · ${graphRouteError} · NO NODE FABRICATED`,
      ));
      return;
    }
    if (!expandedGraph) return;
    const header = createText(
      documentRoot,
      "div",
      "contracts-markets-graph-summary",
      `LINKED GRAPH · ${String(expandedGraph.status).toUpperCase()} · ${expandedGraph.completeLinkCount ?? 0} COMPLETE · ${expandedGraph.missingLinkCount ?? 0} MISSING · COVERAGE ${coverageText(expandedGraph)} · RISK ${String(expandedGraph.riskBand ?? "UNKNOWN").toUpperCase()}`,
    );
    graphDetailsEl.appendChild(header);
    (expandedGraph.path ?? []).forEach((node, index) => {
      const label = `${index + 1} · ${kindLabel(node).toUpperCase()} · ${entityLabel(node)} · ${node.id}`;
      if (GRAPH_ROUTE_RECORD_KINDS.has(node?.kind)) {
        const link = documentRoot.createElement("a");
        link.className = "contracts-markets-graph-node contracts-markets-graph-link-action";
        link.href = graphRouteHref(node.id) ?? "#";
        link.dataset.recordId = node.id;
        link.dataset.graphRoute = CONTRACTS_MARKETS_GRAPH_ROUTE_MODE;
        link.setAttribute?.("aria-label", `Open ${kindLabel(node)} ${entityLabel(node)} in expanded graph`);
        link.textContent = label;
        graphDetailsEl.appendChild(link);
      } else {
        graphDetailsEl.appendChild(createText(
          documentRoot,
          "div",
          "contracts-markets-graph-node",
          label,
        ));
      }
    });
    (expandedGraph.links ?? []).filter((link) => link.status === "missing").forEach((link) => {
      graphDetailsEl.appendChild(createText(
        documentRoot,
        "div",
        "contracts-markets-graph-link missing",
        `MISSING LINK · ${link.kind} · EXPECTED ${link.expectedKind}`,
      ));
    });
  }

  function renderDraft() {
    if (!draftEl) return;
    if (openSportsEvidenceButton) {
      // The empty draft state needs an explicit route to the provider-backed
      // Tennis Evidence reader. The host owns the public-read action; this
      // button never creates a record or local draft by itself.
      openSportsEvidenceButton.hidden = typeof onOpenSportsEvidence !== "function";
      openSportsEvidenceButton.disabled = false;
      openSportsEvidenceButton.textContent = "OPEN TENNIS EVIDENCE · SELECT A PUBLIC RECORD";
      openSportsEvidenceButton.setAttribute?.("aria-label", "Open Tennis Evidence and select a public sports record");
    }
    const source = draftSource;
    const validSource = eligibleDraftSource(source);
    draftEl.setAttribute?.("data-state", localDraft ? "created" : validSource ? "ready" : "empty");
    if (draftSourceEl) {
      draftSourceEl.textContent = source
        ? `SOURCE · ${source.title} · ${source.tour.toUpperCase()} · ${source.provider} · ${source.sourceUrl ?? "PUBLIC URL UNAVAILABLE"}`
        : "SELECT A PUBLIC SPORTS RECORD FIRST · NO DRAFT CREATED";
    }
    if (draftContractLabelEl && !draftContractLabelEl.value && source) {
      draftContractLabelEl.value = `${source.tour.toUpperCase()} · ${source.title} · local contract rehearsal`;
    }
    if (draftPoolLabelEl && !draftPoolLabelEl.value && source) {
      draftPoolLabelEl.value = `${source.tour.toUpperCase()} · observation pool · local rehearsal`;
    }
    if (draftStatusEl) {
      if (draftCloseButton) draftCloseButton.textContent = localDraft?.contract?.state === ContractState.CLOSED ? "DEMO CONTRACT VOIDED" : "VOID DEMO CONTRACT";
      draftStatusEl.textContent = draftRouteError
        ? `DRAFT ROUTE REJECTED · ${draftRouteError}`
        : draftCopyStatus
          ? draftCopyStatus
        : localDraft
            ? `DRAFT READY · STATE ${String(localDraft.lifecycle?.state ?? localDraft.contract?.state ?? "proposed").toUpperCase()} · ${localDraft.contract.label} · ${localDraft.pool.label} · LOCAL ONLY`
          : validSource
            ? "PUBLIC RECORD READY · NAME THE DRAFT, THEN CREATE IT IN MEMORY"
            : "NO ELIGIBLE PUBLIC SPORTS RECORD · ATP/WTA OR MULTI-SPORT + TWO PARTICIPANTS + ALLOWLISTED HTTPS REQUIRED";
    }
    if (draftCreateButton) draftCreateButton.disabled = !validSource;
    if (draftClearButton) draftClearButton.disabled = !localDraft && !source;
    if (draftInspectButton) draftInspectButton.disabled = !localDraft;
    if (draftCloseButton) draftCloseButton.disabled = !localDraft || localDraft.contract?.state === ContractState.CLOSED;
    if (draftCopyButton) draftCopyButton.disabled = !localDraft || !getDraftRouteState();
    if (draftBackLinkEl) {
      const visible = Boolean(draftSourceRoute && localDraft);
      draftBackLinkEl.hidden = !visible;
      if (visible) {
        draftBackLinkEl.href = draftSourceRoute;
        draftBackLinkEl.textContent = source?.tour?.toUpperCase?.() === "SPORTS" ? "BACK TO MULTI-SPORT EVIDENCE" : "BACK TO TENNIS EVIDENCE";
      }
    }
    const resultEl = documentRoot.getElementById("contracts-markets-draft-result");
    if (resultEl) {
      resultEl.replaceChildren?.();
      if (localDraft) {
        const routeState = getDraftRouteState();
        const links = documentRoot.createElement("div");
        links.className = "contracts-markets-draft-links";
        const contractHref = draftRouteHref(routeState, "contract");
        const poolHref = draftRouteHref(routeState, "pool");
        if (contractHref) {
          const contractLink = documentRoot.createElement("a");
          contractLink.id = "contracts-markets-draft-contract-link";
          contractLink.className = "contracts-markets-draft-link";
          contractLink.href = contractHref;
          contractLink.textContent = `OPEN CONTRACT · ${localDraft.contract.label}`;
          links.appendChild(contractLink);
        }
        if (poolHref) {
          const poolLink = documentRoot.createElement("a");
          poolLink.id = "contracts-markets-draft-pool-link";
          poolLink.className = "contracts-markets-draft-link";
          poolLink.href = poolHref;
          poolLink.textContent = `OPEN POOL · ${localDraft.pool.label}`;
          links.appendChild(poolLink);
        }
        resultEl.append(
          createText(documentRoot, "strong", "contracts-markets-draft-result-title", `${localDraft.contract.label} → ${localDraft.pool.label}`),
          createText(documentRoot, "span", "contracts-markets-draft-result-meta", `STATE · ${String(localDraft.lifecycle?.state ?? localDraft.contract?.state ?? "proposed").toUpperCase()} · PROVENANCE · ${localDraft.provenance.provider} · ${localDraft.provenance.sourceRecordId} · LIQUIDITY NOT CONFIGURED · NO EXECUTION`),
          links,
        );
      }
    }
  }

  function render() {
    renderSummary();
    renderList();
    renderCurrent();
    renderTrace();
    renderGraph();
    renderDraft();
  }

  function selectRecord(recordId, method = "button") {
    const record = summary.records.find((candidate) => candidate.id === recordId);
    if (!record) return null;
    graphRouteError = null;
    selectedId = record.id;
    expandedGraph = null;
    const snapshot = deepFreeze({
      source: CONTRACTS_MARKETS_CONSOLE_SOURCE,
      action: "select",
      method,
      recordId: record.id,
      record,
      summary,
      graph: summary.graph,
      graphReadout: graphReadoutFor(record.id),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    pushTrace({ action: "select", recordId: record.id });
    render();
    onSelect?.(snapshot);
    return snapshot;
  }

  function expandGraph(recordId = selectedId, method = "button") {
    graphRouteError = null;
    const record = summary.records.find((candidate) => candidate.id === recordId) ?? selectedRecord();
    const readout = graphReadoutFor(record?.id);
    const action = readout ? "expand-graph" : "expand-graph-blocked";
    expandedGraph = readout;
    pushTrace({
      action,
      recordId: record?.id ?? null,
      graphStatus: readout?.status ?? "missing",
      completeLinkCount: readout?.completeLinkCount ?? 0,
      missingLinkCount: readout?.missingLinkCount ?? 0,
    });
    render();
    const snapshot = deepFreeze({
      source: CONTRACTS_MARKETS_CONSOLE_SOURCE,
      action,
      method,
      recordId: record?.id ?? null,
      record,
      graph: summary.graph,
      graphReadout: readout,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onGraphExpand?.(snapshot);
    return snapshot;
  }

  function toggleGraph(method = "button") {
    if (expandedGraph) {
      const record = selectedRecord();
      expandedGraph = null;
      pushTrace({ action: "collapse-graph", recordId: record?.id ?? null, graphStatus: "collapsed" });
      render();
      return deepFreeze({
        source: CONTRACTS_MARKETS_CONSOLE_SOURCE,
        action: "collapse-graph",
        method,
        recordId: record?.id ?? null,
        trace,
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      });
    }
    return expandGraph(selectedId, method);
  }

  function replay(method = "button") {
    const record = selectedRecord();
    const snapshot = deepFreeze({
      source: CONTRACTS_MARKETS_CONSOLE_SOURCE,
      action: "replay",
      method,
      recordId: record?.id ?? null,
      record,
      replayedRecordCount: summary.records.length,
      summary,
      graph: summary.graph,
      graphReadout: graphReadoutFor(record?.id),
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
    selectedId = summary.records[0]?.id ?? null;
    expandedGraph = null;
    graphRouteError = null;
    trace = [];
    draftSource = null;
    draftSourceRoute = null;
    draftRouteError = null;
    draftCopyStatus = null;
    localDraft = null;
    const snapshot = deepFreeze({
      source: CONTRACTS_MARKETS_CONSOLE_SOURCE,
      action: "reset",
      method,
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

  function prepareDraft(record, method = "handoff", options = {}) {
    draftSource = eligibleDraftSource(record) ? draftSourceFor(record) : null;
    const requestedSourceRoute = typeof options?.sourceRoute === "string" ? options.sourceRoute : null;
    draftSourceRoute = draftSource && requestedSourceRoute
      ? safeDraftSourceRoute(requestedSourceRoute, draftSource.id)
      : null;
    draftRouteError = requestedSourceRoute && !draftSourceRoute
      ? "source return route is missing, malformed, or does not identify the selected record"
      : null;
    draftCopyStatus = null;
    localDraft = null;
    if (draftContractLabelEl) draftContractLabelEl.value = draftSource
      ? `${draftSource.tour.toUpperCase()} · ${draftSource.title} · local contract rehearsal`
      : "";
    if (draftPoolLabelEl) draftPoolLabelEl.value = draftSource
      ? `${draftSource.tour.toUpperCase()} · observation pool · local rehearsal`
      : "";
    pushTrace({ action: draftSource ? "prepare-draft" : "prepare-draft-blocked", recordId: draftSource?.id ?? null, method });
    render();
    const snapshot = deepFreeze({
      source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
      action: draftSource ? "prepare-draft" : "prepare-draft-blocked",
      method,
      sourceRecord: draftSource,
      localDraft: null,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onDraft?.(snapshot);
    return snapshot;
  }

  function createDraft(method = "button") {
    draftRouteError = null;
    draftCopyStatus = null;
    if (!draftSource) {
      const blocked = deepFreeze({
        source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
        action: "create-draft-blocked",
        method,
        reason: "Select a public sports record before creating a local draft.",
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      });
      pushTrace({ action: blocked.action, recordId: null, reason: blocked.reason });
      render();
      onDraft?.(blocked);
      return blocked;
    }
    try {
      localDraft = createContractPoolRehearsal({
        record: draftSource,
        contractLabel: draftContractLabelEl?.value,
        poolLabel: draftPoolLabelEl?.value,
        lifecycleState: ContractState.PROPOSED,
      });
    } catch (error) {
      const blocked = deepFreeze({
        source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
        action: "create-draft-blocked",
        method,
        sourceRecord: draftSource,
        reason: String(error?.message ?? error),
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      });
      pushTrace({ action: blocked.action, recordId: draftSource.id, reason: blocked.reason });
      render();
      onDraft?.(blocked);
      return blocked;
    }
    pushTrace({ action: "create-draft", recordId: draftSource.id, draftId: localDraft.id });
    render();
    const snapshot = deepFreeze({
      source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
      action: "create-draft",
      method,
      sourceRecord: draftSource,
      localDraft,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      settlement: false,
      custody: false,
      boundary: localDraft.boundary,
    });
    onDraft?.(snapshot);
    return snapshot;
  }

  function transitionDraftClosed(method = "button") {
    if (!localDraft || !draftSource) {
      const blocked = deepFreeze({
        source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
        action: "close-draft-blocked",
        method,
        reason: "No local contract draft exists.",
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        persistence: false,
        executable: false,
        settlement: false,
        custody: false,
      });
      pushTrace({ action: blocked.action, recordId: null, reason: blocked.reason });
      render();
      onDraft?.(blocked);
      return blocked;
    }
    if (localDraft.contract?.state === ContractState.CLOSED) {
      const blocked = deepFreeze({
        source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
        action: "close-draft-blocked",
        method,
        reason: "Local contract draft is already closed.",
        sourceRecord: draftSource,
        localDraft,
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        persistence: false,
        executable: false,
        settlement: false,
        custody: false,
      });
      pushTrace({ action: blocked.action, recordId: draftSource.id, reason: blocked.reason });
      render();
      onDraft?.(blocked);
      return blocked;
    }
    draftCopyStatus = null;
    localDraft = createContractPoolRehearsal({
      record: draftSource,
      contractLabel: localDraft.contract?.label,
      poolLabel: localDraft.pool?.label,
      lifecycleState: ContractState.CLOSED,
      lifecycleReason: "local-close",
    });
    pushTrace({ action: "close-draft", recordId: draftSource.id, draftId: localDraft.id, lifecycleState: ContractState.CLOSED });
    render();
    const snapshot = deepFreeze({
      source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
      action: "close-draft",
      method,
      sourceRecord: draftSource,
      localDraft,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      settlement: false,
      custody: false,
      boundary: localDraft.boundary,
    });
    onDraft?.(snapshot);
    return snapshot;
  }

  function getDraftRouteState(options = {}) {
    if (!localDraft) return null;
    const sourceRoute = typeof options?.sourceRoute === "string" && options.sourceRoute.trim()
      ? options.sourceRoute.trim()
      : draftSourceRoute ?? DEFAULT_DRAFT_SOURCE_ROUTE;
    return createContractDraftRouteState({ draft: localDraft, sourceRoute });
  }

  async function copyDraftRoute(method = "button") {
    const routeState = getDraftRouteState();
    const route = draftRouteHref(routeState);
    if (!route) {
      draftCopyStatus = "ROUTE UNAVAILABLE · CREATE A VALID LOCAL DRAFT FIRST";
      pushTrace({ action: "copy-draft-route-blocked", recordId: draftSource?.id ?? null, reason: draftCopyStatus });
      render();
      const blocked = deepFreeze({
        source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
        action: "copy-draft-route-blocked",
        method,
        routeState: null,
        route: null,
        copied: false,
        reason: draftCopyStatus,
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        persistence: false,
        executable: false,
      });
      onDraftCopy?.(blocked);
      return blocked;
    }

    draftCopyStatus = "ROUTE READY · COPYING LOCAL DETAIL LINK";
    render();
    let copied = false;
    let copyError = null;
    const navigatorLike = documentRoot?.defaultView?.navigator ?? globalThis.navigator;
    if (typeof navigatorLike?.clipboard?.writeText === "function") {
      try {
        await navigatorLike.clipboard.writeText(route);
        copied = true;
      } catch (error) {
        copyError = String(error?.message ?? error);
      }
    } else {
      copyError = "Clipboard API unavailable in this context";
    }

    draftCopyStatus = copied
      ? "ROUTE COPIED · LOCAL DETAIL LINK · NO EXTERNAL WRITE"
      : "ROUTE READY · COPY FROM THE ADDRESS BAR";
    const action = copied ? "copy-draft-route" : "copy-draft-route-manual";
    pushTrace({ action, recordId: draftSource?.id ?? null, copied, reason: copyError });
    render();
    const snapshot = deepFreeze({
      source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
      action,
      method,
      routeState,
      route,
      copied,
      reason: copyError,
      sourceRecord: draftSource,
      localDraft,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      settlement: false,
      custody: false,
    });
    onDraftCopy?.(snapshot);
    return snapshot;
  }

  function hydrateDraftRouteState(routeState, method = "url") {
    const validated = validateContractDraftRouteState(routeState);
    if (!validated) {
      draftSource = null;
      draftSourceRoute = null;
      localDraft = null;
      draftRouteError = "invalid, expired, or non-allowlisted provenance";
      draftCopyStatus = null;
      pushTrace({ action: "hydrate-draft-route-blocked", recordId: null, reason: draftRouteError });
      render();
      return deepFreeze({
        source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
        action: "hydrate-draft-route-blocked",
        method,
        reason: draftRouteError,
        routeState: null,
        localDraft: null,
        trace,
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        persistence: false,
        executable: false,
        settlement: false,
        custody: false,
      });
    }
    try {
      const sourceRecord = {
        id: validated.sourceRecordId,
        title: validated.sourceTitle,
        tour: validated.tour,
        provider: validated.provider,
        sourceUrl: validated.sourceUrl,
        retrievedAt: validated.retrievedAt,
        players: validated.players,
      };
      const hydrated = createContractPoolRehearsal({
        record: sourceRecord,
        contractLabel: validated.contractLabel,
        poolLabel: validated.poolLabel,
        lifecycleState: validated.lifecycleState,
        lifecycleReason: "route-hydrate",
      });
      if (hydrated.id !== validated.draftId || hydrated.contract.id !== validated.contractId || hydrated.pool.id !== validated.poolId) {
        throw new TypeError("hydrated draft IDs do not match route");
      }
      draftSource = hydrated.sourceRecord;
      draftSourceRoute = validated.sourceRoute;
      draftRouteError = null;
      draftCopyStatus = null;
      localDraft = hydrated;
      pushTrace({ action: "hydrate-draft-route", recordId: draftSource.id, draftId: localDraft.id, lifecycleState: localDraft.contract.state });
      render();
      const snapshot = deepFreeze({
        source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
        action: "hydrate-draft-route",
        method,
        routeState: validated,
        sourceRecord: draftSource,
        localDraft,
        trace,
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        persistence: false,
        executable: false,
        settlement: false,
        custody: false,
        boundary: localDraft.boundary,
      });
      onDraft?.(snapshot);
      return snapshot;
    } catch (error) {
      draftSource = null;
      draftSourceRoute = null;
      localDraft = null;
      draftRouteError = "route payload could not be hydrated";
      draftCopyStatus = null;
      pushTrace({ action: "hydrate-draft-route-blocked", recordId: null, reason: String(error?.message ?? error) });
      render();
      return deepFreeze({
        source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
        action: "hydrate-draft-route-blocked",
        method,
        reason: draftRouteError,
        routeState: validated,
        localDraft: null,
        trace,
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        persistence: false,
        executable: false,
        settlement: false,
        custody: false,
      });
    }
  }

  function clearDraft(method = "button") {
    const sourceRecord = draftSource;
    localDraft = null;
    draftSource = null;
    draftSourceRoute = null;
    draftRouteError = null;
    draftCopyStatus = null;
    if (draftContractLabelEl) draftContractLabelEl.value = "";
    if (draftPoolLabelEl) draftPoolLabelEl.value = "";
    pushTrace({ action: "clear-draft", recordId: sourceRecord?.id ?? null });
    render();
    const snapshot = deepFreeze({
      source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
      action: "clear-draft",
      method,
      sourceRecord,
      localDraft: null,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onDraftClear?.(snapshot);
    return snapshot;
  }

  function hydrateGraphRouteState(routeState, method = "url", reason = null) {
    // A graph permalink is a canonical projection view, not a draft route.
    // Drop any renderer-local sports draft left by a previous history entry;
    // Back/Forward will rehydrate it only when its own bounded draft payload
    // is visited again.
    draftSource = null;
    draftSourceRoute = null;
    draftRouteError = null;
    draftCopyStatus = null;
    localDraft = null;
    if (draftContractLabelEl) draftContractLabelEl.value = "";
    if (draftPoolLabelEl) draftPoolLabelEl.value = "";
    const recordId = typeof routeState?.recordId === "string" ? routeState.recordId : null;
    const record = recordId
      ? summary.records.find((candidate) => candidate.id === recordId && GRAPH_ROUTE_RECORD_KINDS.has(candidate.kind)) ?? null
      : null;
    const readout = record ? graphReadoutFor(record.id) : null;
    if (routeState?.graph !== CONTRACTS_MARKETS_GRAPH_ROUTE_MODE || !record || !readout) {
      selectedId = null;
      expandedGraph = null;
      graphRouteError = reason || "record is malformed, unknown, or not a canonical contract/pool graph node";
      pushTrace({ action: "hydrate-graph-route-blocked", recordId: null, reason: graphRouteError });
      render();
      return deepFreeze({
        source: CONTRACTS_MARKETS_CONSOLE_SOURCE,
        action: "hydrate-graph-route-blocked",
        method,
        reason: graphRouteError,
        routeState: null,
        recordId: null,
        graphReadout: null,
        trace,
        localOnly: true,
        simulation: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      });
    }
    graphRouteError = null;
    const requestedNode = routeState?.node === 'pool' ? 'pool' : routeState?.node === 'contract' ? 'contract' : null;
    const target = requestedNode
      ? readout.path?.find((candidate) => candidate.kind === `${requestedNode}-scenario`) ?? record
      : record;
    selectedId = target.id;
    expandedGraph = readout;
    pushTrace({
      action: "hydrate-graph-route",
      recordId: record.id,
      graphStatus: readout.status,
      completeLinkCount: readout.completeLinkCount,
      missingLinkCount: readout.missingLinkCount,
    });
    render();
    const snapshot = deepFreeze({
      source: CONTRACTS_MARKETS_CONSOLE_SOURCE,
      action: "hydrate-graph-route",
      method,
      routeState,
      recordId: record.id,
      record,
      graph: summary.graph,
      graphReadout: readout,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onGraphExpand?.(snapshot);
    return snapshot;
  }

  function inspectDraft(method = "button") {
    const snapshot = deepFreeze({
      source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
      action: localDraft ? "inspect-draft" : "inspect-draft-blocked",
      method,
      sourceRecord: draftSource,
      localDraft,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      boundary: localDraft?.boundary ?? "No local draft exists.",
    });
    pushTrace({ action: snapshot.action, recordId: draftSource?.id ?? null });
    render();
    onDraftInspect?.(snapshot);
    return snapshot;
  }

  function syncProjection(nextProjection) {
    summary = summarizeContractsMarkets(nextProjection);
    if (graphRouteError) {
      selectedId = null;
      expandedGraph = null;
    } else {
      expandedGraph = null;
      if (!summary.records.some((record) => record.id === selectedId)) selectedId = summary.records[0]?.id ?? null;
    }
    render();
    return getSnapshot();
  }

  function getSnapshot() {
    return deepFreeze({
      source: CONTRACTS_MARKETS_CONSOLE_SOURCE,
      summary,
      graph: summary.graph,
      selectedId,
      selectedRecord: selectedRecord(),
      graphReadout: graphReadoutFor(selectedId),
      expandedGraph,
      graphRouteError,
      draftSource,
      draftSourceRoute,
      draftRouteError,
      localDraft,
      draftRouteState: getDraftRouteState(),
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
  openSportsEvidenceButton?.addEventListener("click", () => {
    onOpenSportsEvidence?.({
      method: "contracts-empty-state",
      source: CONTRACTS_MARKETS_CONSOLE_SOURCE,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
    });
  });
  graphExpandButton.addEventListener("click", () => toggleGraph("button"));
  draftCreateButton?.addEventListener("click", () => createDraft("button"));
  draftClearButton?.addEventListener("click", () => clearDraft("button"));
  draftInspectButton?.addEventListener("click", () => inspectDraft("button"));
  draftCloseButton?.addEventListener("click", () => transitionDraftClosed("button"));
  draftCopyButton?.addEventListener("click", () => { void copyDraftRoute("button"); });
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
    expandGraph,
    inspectGraph: expandGraph,
    toggleGraph,
    replay,
    reset,
    prepareDraft,
    createDraft,
    closeDraft: transitionDraftClosed,
    clearDraft,
    inspectDraft,
    copyDraftRoute,
    getDraftRouteState,
    hydrateDraftRouteState,
    hydrateGraphRouteState,
    syncProjection,
    setProjection: syncProjection,
    getSnapshot,
    destroy: () => {},
  });
}

export const createContractsMarketsLayer = createContractsMarketsConsole;
export const createContractsConsole = createContractsMarketsConsole;
export default createContractsMarketsConsole;
