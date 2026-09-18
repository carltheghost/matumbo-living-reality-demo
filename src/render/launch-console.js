/**
 * Launch Distribution / Social Experiment console.
 *
 * This module is a DOM adapter for the deterministic recipient-registry
 * contribution. It renders every aggregate fictional cohort and exposes
 * replay plus an explicit full-registry rehearsal action that can only emit
 * local projection intents. It deliberately does not create addresses,
 * wallets, claims, payment instructions, or mutable domain state.
 */

export const LAUNCH_CONSOLE_SOURCE = "tumbo-distribution-registry";
export const DEFAULT_LAUNCH_EVENT_ID = "distribution-event:tumbo-demo-launch";
export const DEFAULT_LAUNCH_ID = "distribution:tumbo-demo-launch";
export const LAUNCH_REHEARSAL_ACTION_ID = "distribution-action:tumbo-demo-launch-rehearsal";
export const POPULATION_CONTEXT_RENDER_SOURCE = "public-population-context-world-bank";
export const LAUNCH_COHORT_ROUTE_PARAM = "cohort";
export const LAUNCH_COHORT_ROUTE_PANEL = "launch-distribution";
export function validateLaunchCohortCompareRoute({ compare, projection } = {}) { const ids=typeof compare==='string'?compare.split(','):[]; if(ids.length!==2||ids[0]===ids[1]||ids.some(id=>!/^[a-z0-9:_-]{1,160}$/i.test(id))) return null; const rows=summarizeLaunchDistribution(projection).rows; const found=ids.map(id=>rows.find(row=>row.id===id)); return found.some(row=>!row)?null:Object.freeze({ids:Object.freeze(ids),rows:Object.freeze(found)}); }
const POPULATION_CONTEXT_MAX_ROWS_RENDER = 18;

// Coverage lenses are presentation filters over the existing canonical
// registry rows. They never create a second schedule or alter the fixed
// 10,000-basis-point / 1,000,000,000-unit reconciliation.
export const LAUNCH_COVERAGE_LENSES = Object.freeze([
  Object.freeze({ id: "all", label: "ALL", description: "all 18 aggregate registry rows", recipientClasses: Object.freeze([]) }),
  Object.freeze({ id: "social", label: "SOCIAL", description: "public social-experiment cohorts", recipientClasses: Object.freeze(["public-social-experiment"]) }),
  Object.freeze({ id: "county-community", label: "COUNTY/COMMUNITY", description: "county and community cohorts", recipientClasses: Object.freeze(["county-community"]) }),
  Object.freeze({ id: "organisations", label: "ORGANISATIONS", description: "participating organisation cohorts", recipientClasses: Object.freeze(["organizations"]) }),
  Object.freeze({ id: "international-funds", label: "INTERNATIONAL FUNDS", description: "international public-good fund cohorts", recipientClasses: Object.freeze(["international-public-good-funds"]) }),
  Object.freeze({ id: "grants", label: "GRANTS", description: "ecosystem grant cohorts", recipientClasses: Object.freeze(["ecosystem-grants"]) }),
  Object.freeze({ id: "reserves", label: "RESERVES", description: "treasury, operations, and insurance reserves", recipientClasses: Object.freeze(["treasury-reserve", "operations", "insurance-risk-reserve"]) }),
]);

const COVERAGE_LENS_IDS = new Set(LAUNCH_COVERAGE_LENSES.map(({ id }) => id));

export function validateLaunchCohortRoute({ cohortId, projection } = {}) {
  if (typeof cohortId !== "string" || !/^[a-z0-9:_-]{1,160}$/i.test(cohortId)) return null;
  const summary = summarizeLaunchDistribution(projection);
  const row = summary.rows.find((candidate) => candidate.id === cohortId);
  return row ? Object.freeze({ cohortId: row.id, row }) : null;
}

// Journey state is presentation-only. It points at the same frozen registry
// summary and never creates a second allocation schedule or execution path.
export const LAUNCH_JOURNEY_STEPS = Object.freeze([
  Object.freeze({
    id: "prepare",
    label: "Prepare",
    title: "Prepare local preview",
    detail: "Read the fixed-supply boundary before revealing the map.",
  }),
  Object.freeze({
    id: "reveal",
    label: "Reveal map",
    title: "Reveal the fixed map",
    detail: "Light the aggregate cohort map; no tokens move anywhere.",
  }),
  Object.freeze({
    id: "registry",
    label: "Inspect registry",
    title: "Inspect the complete registry",
    detail: "Review every deterministic fictional row and its reconciliation.",
  }),
  Object.freeze({
    id: "social",
    label: "Social explorer",
    title: "Hand off to social explorer",
    detail: "Continue into local rooms and community cards without a network.",
  }),
]);

const JOURNEY_STEP_IDS = new Set(LAUNCH_JOURNEY_STEPS.map(({ id }) => id));

const integerFormatter = new Intl.NumberFormat("en-US");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function safeInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) ? value : fallback;
}

function freezeSnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeSnapshot(entry)));
  if (!isRecord(value)) return value;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeSnapshot(entry)])),
  );
}

function normalizePopulationContext(value) {
  const source = isRecord(value) ? value : {};
  const records = asArray(source.records)
    .filter(isRecord)
    .slice(0, 18)
    .map((record) => ({
      id: safeText(record.id, "population-observation"),
      contextCode: safeText(record.contextCode, "—"),
      contextLabel: safeText(record.contextLabel, "fixed context"),
      countryName: safeText(record.countryName, "provider country name unavailable"),
      indicator: safeText(record.indicator, "SP.POP.TOTL"),
      indicatorLabel: safeText(record.indicatorLabel, "Population, total"),
      year: Number.isInteger(record.year) ? record.year : null,
      population: Number.isSafeInteger(record.population) && record.population >= 0 ? record.population : null,
      unit: safeText(record.unit, "people"),
      retrievedAt: safeText(record.retrievedAt, "retrieval time unavailable"),
      sourceUrl: safeText(record.sourceUrl ?? record.requestUrl, "World Bank source URL unavailable"),
      publicSource: record.publicSource === true,
      metadataOnly: true,
      contextualOnly: true,
      recipientCount: false,
      allocationWeight: false,
      geocoded: false,
      identityResolution: false,
      simulation: true,
      localOnly: true,
      executable: false,
    }));
  const contextStatuses = asArray(source.contextStatuses)
    .filter(isRecord)
    .slice(0, 6)
    .map((status) => ({
      id: safeText(status.id, "population-context"),
      contextCode: safeText(status.contextCode, "—"),
      contextLabel: safeText(status.contextLabel, "fixed context"),
      provider: safeText(status.provider, "World Bank Indicators API"),
      indicator: safeText(status.indicator, "SP.POP.TOTL"),
      status: safeText(status.status, "unavailable"),
      recordCount: Number.isSafeInteger(status.recordCount) ? status.recordCount : 0,
      latestYear: Number.isInteger(status.latestYear) ? status.latestYear : null,
      latestPopulation: Number.isSafeInteger(status.latestPopulation) && status.latestPopulation >= 0 ? status.latestPopulation : null,
      countryName: safeText(status.countryName, "provider country name unavailable"),
      reason: safeText(status.reason, null),
      contextualOnly: true,
      recipientCount: false,
      allocationWeight: false,
      geocoded: false,
      identityResolution: false,
      simulation: true,
      localOnly: true,
      executable: false,
    }));
  return freezeSnapshot({
    source: safeText(source.source, POPULATION_CONTEXT_RENDER_SOURCE),
    provider: safeText(source.provider, "World Bank Indicators API"),
    indicator: safeText(source.indicator, "SP.POP.TOTL"),
    indicatorLabel: safeText(source.indicatorLabel, "Population, total"),
    requestedYears: isRecord(source.requestedYears)
      ? {
          from: Number.isInteger(source.requestedYears.from) ? source.requestedYears.from : null,
          to: Number.isInteger(source.requestedYears.to) ? source.requestedYears.to : null,
        }
      : { from: null, to: null },
    status: safeText(source.status, records.length ? "ready" : "unavailable"),
    retrievedAt: safeText(source.retrievedAt, "retrieval time unavailable"),
    endpoint: safeText(source.endpoint ?? source.requestUrl, "World Bank endpoint unavailable"),
    documentation: safeText(source.documentation, "World Bank Indicators API documentation unavailable"),
    records,
    contextStatuses,
    recordCount: records.length,
    contextCount: Number.isSafeInteger(source.contextCount) ? source.contextCount : Math.max(contextStatuses.length, 6),
    availableContextCount: Number.isSafeInteger(source.availableContextCount)
      ? source.availableContextCount
      : contextStatuses.filter((status) => status.status === "provider-reported").length,
    providerAvailable: source.providerAvailable === true,
    providerUnavailable: source.providerUnavailable !== false,
    liveFetch: source.liveFetch === true,
    externalNetwork: source.externalNetwork === true,
    publicSource: true,
    metadataOnly: true,
    contextualOnly: true,
    recipientCount: false,
    allocationWeight: false,
    geocoded: false,
    identityResolution: false,
    issuance: false,
    wallet: false,
    transfer: false,
    custody: false,
    signing: false,
    settlement: false,
    executable: false,
    simulation: true,
    localOnly: true,
    truthClaim: false,
    boundary: safeText(
      source.boundary,
      "Population context is metadata only; it cannot alter the fictional registry or create recipients, issuance, wallet, transfer, custody, signing, or settlement.",
    ),
    reason: safeText(source.reason, records.length ? null : "No public population observations are available; no fallback rows were fabricated."),
  });
}

/** Find the one canonical registry contribution inside a world projection. */
export function findLaunchDistributionContribution(projection) {
  if (projection?.source === LAUNCH_CONSOLE_SOURCE) return projection;
  return asArray(projection?.contributions).find(
    (contribution) => contribution?.source === LAUNCH_CONSOLE_SOURCE,
  ) ?? null;
}

/**
 * Produce deterministic display totals from the canonical registry rows.
 * This helper is intentionally pure so release tests can verify the console
 * without a browser or a second allocation schedule.
 */
export function summarizeLaunchDistribution(projection) {
  const contribution = findLaunchDistributionContribution(projection);
  const rows = asArray(contribution?.registry).map((row, index) => ({
    id: safeText(row?.id, `registry-row-${index + 1}`),
    label: safeText(row?.label ?? row?.recipientLabel, `Fictional cohort ${index + 1}`),
    recipientClass: safeText(row?.recipientClass, "aggregate fictional cohort"),
    coverage: safeText(row?.coverage, "aggregate fictional coverage"),
    allocationId: safeText(row?.allocationId),
    basisPoints: safeInteger(row?.shareBasisPoints ?? row?.basisPoints),
    percentage: Number.isFinite(row?.percent)
      ? row.percent
      : Number.isFinite(row?.percentage)
        ? row.percentage
        : safeInteger(row?.shareBasisPoints ?? row?.basisPoints) / 100,
    tokenUnits: safeInteger(row?.tokenUnits ?? row?.units),
    status: safeText(row?.status, "simulated"),
    simulation: row?.simulation === true,
    aggregate: row?.aggregate === true,
    executable: row?.executable === true,
  }));
  const evidence = asArray(contribution?.evidence);
  const reconciliation = evidence.find((item) => item?.kind === "recipient-registry-reconciliation") ?? null;
  const totalSupply = safeInteger(
    contribution?.totalSupply ?? reconciliation?.expectedTokenUnits,
  );
  const totalBasisPoints = rows.reduce((sum, row) => sum + row.basisPoints, 0);
  const totalUnits = rows.reduce((sum, row) => sum + row.tokenUnits, 0);
  const canonicalAllocationSummary = isRecord(contribution?.allocationSummary)
    ? contribution.allocationSummary
    : null;
  const allocationClasses = asArray(canonicalAllocationSummary?.classes).map((allocation, index) => ({
    allocationId: safeText(allocation?.allocationId, `allocation-${index + 1}`),
    recipientClass: safeText(allocation?.recipientClass, "aggregate fictional cohort"),
    label: safeText(allocation?.label, `Allocation class ${index + 1}`),
    purpose: safeText(allocation?.purpose, "Aggregate fictional asset-token cohort."),
    rowCount: safeInteger(allocation?.rowCount),
    basisPoints: safeInteger(allocation?.basisPoints),
    expectedBasisPoints: safeInteger(allocation?.expectedBasisPoints),
    percentage: Number.isFinite(allocation?.percentage) ? allocation.percentage : 0,
    tokenUnits: safeInteger(allocation?.tokenUnits),
    expectedTokenUnits: safeInteger(allocation?.expectedTokenUnits),
    complete: allocation?.complete === true,
    aggregate: true,
    fictional: true,
    simulation: true,
    executable: false,
    externalTransfer: false,
  }));
  const allocationComplete = canonicalAllocationSummary?.complete === true
    || (allocationClasses.length > 0 && allocationClasses.every((allocation) => allocation.complete));
  return freezeSnapshot({
    source: contribution?.source ?? LAUNCH_CONSOLE_SOURCE,
    launchId: safeText(contribution?.launchId ?? contribution?.launchEvent?.launchId, DEFAULT_LAUNCH_ID),
    eventId: safeText(contribution?.launchEvent?.id, DEFAULT_LAUNCH_EVENT_ID),
    eventStatus: safeText(contribution?.launchEvent?.status, "previewed"),
    updatedAt: safeText(contribution?.updatedAt),
    unit: safeText(contribution?.unit, "TUMBO-SIM"),
    totalSupply,
    expectedTotalSupply: safeInteger(reconciliation?.expectedTokenUnits, totalSupply),
    totalBasisPoints,
    expectedBasisPoints: safeInteger(reconciliation?.expectedBasisPoints, 10_000),
    totalUnits,
    expectedUnits: safeInteger(reconciliation?.expectedTokenUnits, totalSupply),
    allocationClassCount: allocationClasses.length,
    allocationClasses,
    allocationComplete,
    rows,
    rowCount: rows.length,
    simulation: contribution?.simulation === true,
    externalDistribution: contribution?.externalDistribution === true,
    executable: contribution?.executable === true,
    capabilities: asArray(contribution?.capabilities),
    evidence,
    boundary: safeText(
      evidence.find((item) => item?.kind === "simulation-boundary")?.note,
      "Launch preview records remain aggregate fictional data; no external transfer occurs.",
    ),
  });
}

function coverageLensDefinition(lensId) {
  return LAUNCH_COVERAGE_LENSES.find((lens) => lens.id === lensId) ?? LAUNCH_COVERAGE_LENSES[0];
}

/** Filter only already-normalized registry rows for a presentation lens. */
export function filterLaunchDistributionRows(rows, lensId = "all") {
  const lens = coverageLensDefinition(lensId);
  const normalizedRows = asArray(rows);
  if (!lens.recipientClasses.length) return freezeSnapshot([...normalizedRows]);
  return freezeSnapshot(normalizedRows.filter((row) => lens.recipientClasses.includes(row?.recipientClass)));
}

/** Summarize the visible lens while retaining canonical totals separately. */
export function summarizeLaunchCoverage(summary, lensId = "all") {
  const lens = coverageLensDefinition(lensId);
  const rows = filterLaunchDistributionRows(summary?.rows, lens.id);
  return freezeSnapshot({
    lensId: lens.id,
    label: lens.label,
    description: lens.description,
    rows,
    rowCount: rows.length,
    basisPoints: rows.reduce((total, row) => total + safeInteger(row?.basisPoints), 0),
    tokenUnits: rows.reduce((total, row) => total + safeInteger(row?.tokenUnits), 0),
    canonicalRowCount: safeInteger(summary?.rowCount),
    canonicalBasisPoints: safeInteger(summary?.totalBasisPoints),
    canonicalUnits: safeInteger(summary?.totalUnits),
    localOnly: true,
    deterministic: true,
    simulation: true,
    aggregate: true,
    executable: false,
    externalTransfer: false,
  });
}

/**
 * Turn one normalized registry row into an explicit, inspectable cohort
 * readout. The launch console uses this helper for its inline detail panel so
 * selecting a row is visibly different from merely highlighting a table row.
 * It is intentionally presentation-only: no recipient authority fields or
 * execution affordances are derived here.
 */
export function summarizeLaunchCohort(row) {
  if (!isRecord(row)) {
    return freezeSnapshot({
      selected: false,
      localOnly: true,
      deterministic: true,
      simulation: true,
      aggregate: true,
      executable: false,
      externalTransfer: false,
      walletConnection: false,
      custody: false,
      signing: false,
      settlement: false,
      externalNetwork: false,
      inspection: "SELECT A COHORT TO INSPECT",
      boundary: "AGGREGATE FICTIONAL COHORT · LOCAL TUMBO-SIM ONLY · NO TRANSFER",
    });
  }
  const basisPoints = safeInteger(row.shareBasisPoints ?? row.basisPoints);
  const percentage = Number.isFinite(row.percent)
    ? row.percent
    : Number.isFinite(row.percentage)
      ? row.percentage
      : basisPoints / 100;
  const tokenUnits = safeInteger(row.tokenUnits ?? row.units);
  const normalized = {
    id: safeText(row.id, "registry-row"),
    label: safeText(row.label ?? row.recipientLabel, "Fictional cohort"),
    recipientClass: safeText(row.recipientClass, "aggregate fictional cohort"),
    coverage: safeText(row.coverage, "aggregate fictional coverage"),
    allocationId: safeText(row.allocationId),
    basisPoints,
    percentage,
    tokenUnits,
    status: safeText(row.status, "simulated"),
    simulation: row.simulation === true,
    aggregate: row.aggregate === true,
    executable: row.executable === true,
  };
  return freezeSnapshot({
    ...normalized,
    selected: true,
    localOnly: true,
    deterministic: true,
    externalTransfer: false,
    walletConnection: false,
    custody: false,
    signing: false,
    settlement: false,
    externalNetwork: false,
    inspection: `${normalized.label} · ${normalized.percentage}% · ${formatInteger(normalized.basisPoints)} BP · ${formatInteger(normalized.tokenUnits)} TUMBO-SIM`,
    boundary: "AGGREGATE FICTIONAL COHORT · LOCAL TUMBO-SIM ONLY · NO TRANSFER",
  });
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = safeText(value);
  return element;
}

function formatInteger(value) {
  return Number.isSafeInteger(value) ? integerFormatter.format(value) : "—";
}

function percentLabel(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value}%`;
}

function capabilityLabel(capability) {
  if (capability?.denied === true || capability?.enabled === false || capability?.mode === "denied") {
    return `denied: ${safeText(capability.label, capability.id)}`;
  }
  return `local: ${safeText(capability.label, capability.id)}`;
}

/**
 * Mount the launch console into the static HUD. The host owns camera focus
 * and intents; this adapter owns only DOM state and replay presentation.
 */
export function createLaunchConsole({
  documentRoot = globalThis.document,
  projection = null,
  populationContext = null,
  onReplay = null,
  onRehearse = null,
  onSelect = null,
  onJourney = null,
  onPopulationRefresh = null,
  operatorCapability = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Launch console needs a document-like owner");
  const panel = documentRoot.getElementById("launch-console");
  const openButton = documentRoot.getElementById("launch-console-open");
  const closeButton = documentRoot.getElementById("launch-console-close");
  const replayButton = documentRoot.getElementById("launch-console-replay");
  const rehearseButton = documentRoot.getElementById("launch-console-rehearse");
  const simulationToggle = documentRoot.getElementById("launch-console-simulation-toggle");
  const statusEl = documentRoot.getElementById("launch-console-status");
  const eventEl = documentRoot.getElementById("launch-console-event");
  const reconciliationEl = documentRoot.getElementById("launch-console-reconciliation");
  const rehearsalStatusEl = documentRoot.getElementById("launch-console-rehearsal-status");
  const selectedEl = documentRoot.getElementById("launch-console-selected");
  const list = documentRoot.getElementById("launch-console-rows");
  const supplyEl = documentRoot.getElementById("launch-console-supply");
  const rowCountEl = documentRoot.getElementById("launch-console-row-count");
  const basisEl = documentRoot.getElementById("launch-console-basis");
  const unitsEl = documentRoot.getElementById("launch-console-units");
  const allocationClassesEl = documentRoot.getElementById("launch-console-allocation-classes");
  const coverageLensEl = documentRoot.getElementById("launch-console-coverage-lens");
  const coverageLensStatusEl = documentRoot.getElementById("launch-console-coverage-lens-status");
  const boundaryEl = documentRoot.getElementById("launch-console-boundary");
  const journeyStatusEl = documentRoot.getElementById("launch-journey-status");
  const journeyPrevButton = documentRoot.getElementById("launch-journey-prev");
  const journeyNextButton = documentRoot.getElementById("launch-journey-next");
  const journeySocialButton = documentRoot.getElementById("launch-journey-social");
  const journeyStepButtons = [...documentRoot.querySelectorAll?.("[data-launch-journey-step]") ?? []];
  const populationPanel = documentRoot.getElementById("launch-console-population");
  const populationRefreshButton = documentRoot.getElementById("launch-console-population-refresh");
  const populationStatusEl = documentRoot.getElementById("launch-console-population-status");
  const populationSummaryEl = documentRoot.getElementById("launch-console-population-summary");
  const populationRecordsEl = documentRoot.getElementById("launch-console-population-records");
  const populationBoundaryEl = documentRoot.getElementById("launch-console-population-boundary");
  if (!panel || !closeButton || !replayButton || !statusEl || !eventEl || !reconciliationEl || !list) {
    throw new Error("Launch console mount points are missing");
  }

  let currentProjection = projection;
  let summary = summarizeLaunchDistribution(currentProjection);
  let selectedId = summary.rows[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let replayCount = 0;
  let lastReplay = null;
  let rehearsalCount = 0;
  let lastRehearsal = null;
  let journeyStep = "prepare";
  let coverageLens = "all";
  let currentPopulationContext = normalizePopulationContext(populationContext);
  let populationRefreshCount = 0;
  let populationRefreshPending = false;
  let routeError = null;
  let compareRows = null;
  let simulationDistributionEnabled = false;
  const validOperator = isRecord(operatorCapability) && operatorCapability.kind === "local-demo-operator" && operatorCapability.enabled === true;

  function visibleCoverage() {
    return summarizeLaunchCoverage(summary, coverageLens);
  }

  function coverageLensButtons() {
    return [...coverageLensEl?.children ?? []].filter((button) => button?.dataset?.launchCoverageLens);
  }

  function renderCoverageLens() {
    const visible = visibleCoverage();
    coverageLensButtons().forEach((button) => {
      const active = button.dataset.launchCoverageLens === coverageLens;
      button.setAttribute("aria-pressed", String(active));
      button.classList?.toggle?.("active", active);
    });
    if (coverageLensStatusEl) {
      coverageLensStatusEl.textContent = `COVERAGE · ${visible.label} · ${visible.rowCount}/${visible.canonicalRowCount} ROWS · ${formatInteger(visible.basisPoints)} BP · ${formatInteger(visible.tokenUnits)} ${summary.unit} · CANONICAL TOTALS UNCHANGED`;
      coverageLensStatusEl.dataset.lens = visible.lensId;
    }
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList.toggle("visible", opened);
    panel.setAttribute("aria-hidden", String(!opened));
    if (openButton) {
      openButton.setAttribute("aria-expanded", String(opened));
      openButton.textContent = opened ? "HIDE LAUNCH CONSOLE" : "OPEN LAUNCH CONSOLE";
    }
    if (opened && method === "open") replayButton.focus({ preventScroll: true });
  }

  function renderRows() {
    list.replaceChildren();
    visibleCoverage().rows.forEach((row) => {
      const item = documentRoot.createElement("button");
      item.type = "button";
      item.className = "launch-console-row";
      item.dataset.registryEntryId = row.id;
      item.dataset.cohortRoute = `${LAUNCH_COHORT_ROUTE_PANEL}&${LAUNCH_COHORT_ROUTE_PARAM}=${encodeURIComponent(row.id)}`;
      item.setAttribute("aria-pressed", String(row.id === selectedId));
      item.title = row.coverage;

      const primary = createText(documentRoot, "span", "launch-console-row-primary", row.label);
      const secondary = createText(
        documentRoot,
        "span",
        "launch-console-row-secondary",
        `${row.recipientClass} · ${row.status === "previewed" || lastReplay ? "previewed" : "simulated"}`,
      );
      const amount = createText(
        documentRoot,
        "span",
        "launch-console-row-amount",
        `${percentLabel(row.percentage)} · ${formatInteger(row.tokenUnits)}`,
      );
      const basis = createText(documentRoot, "span", "launch-console-row-basis", `${row.basisPoints} bp`);
      const content = documentRoot.createElement("span");
      content.className = "launch-console-row-copy";
      content.append(primary, secondary);
      item.append(content, amount, basis);
      item.addEventListener("click", () => {
        if (globalThis.history?.pushState && globalThis.location) {
          const url = new URL(globalThis.location.href);
          url.searchParams.set("panel", LAUNCH_COHORT_ROUTE_PANEL);
          url.searchParams.set(LAUNCH_COHORT_ROUTE_PARAM, row.id);
          globalThis.history.pushState({ panel: LAUNCH_COHORT_ROUTE_PANEL, cohort: row.id }, "", url);
        }
        select(row.id, "row-route");
      });
      list.appendChild(item);
    });
    if (!visibleCoverage().rows.length) {
      list.appendChild(createText(documentRoot, "div", "launch-console-empty", "No registry rows match this coverage lens; no rows were fabricated."));
    }
  }

  function renderSelectedCohort() {
    if (!selectedEl) return;
    const row = visibleCoverage().rows.find((candidate) => candidate.id === selectedId);
    selectedEl.replaceChildren();
    if (compareRows) { selectedEl.append(...compareRows.flatMap(row=>[createText(documentRoot,"strong","launch-console-selected-title",`COMPARE · ${row.label}`),createText(documentRoot,"span","launch-console-selected-meta",`${row.recipientClass} · ${row.percentage}% · ${formatInteger(row.basisPoints)} BP · ${formatInteger(row.tokenUnits)} TUMBO-SIM`),createText(documentRoot,"span","launch-console-selected-coverage",`${row.coverage} · ${row.id}`),createText(documentRoot,"span","launch-console-selected-provenance",`PROVENANCE · ${row.id} · TUMBO-SIM LOCAL REGISTRY`)])); return; }
    if (!row) {
      selectedEl.textContent = "SELECT A COHORT TO INSPECT · REGISTRY EMPTY";
      delete selectedEl.dataset.registryEntryId;
      return;
    }
    const detail = summarizeLaunchCohort(row);
    selectedEl.dataset.registryEntryId = detail.id;
    selectedEl.setAttribute("aria-label", `Selected cohort ${detail.label}`);
    selectedEl.append(
      createText(documentRoot, "strong", "launch-console-selected-title", detail.label),
      createText(
        documentRoot,
        "span",
        "launch-console-selected-meta",
        `${detail.recipientClass} · ${detail.percentage}% · ${formatInteger(detail.basisPoints)} BP · ${formatInteger(detail.tokenUnits)} TUMBO-SIM`,
      ),
      createText(
        documentRoot,
        "span",
        "launch-console-selected-coverage",
        `${detail.coverage} · ${detail.allocationId} · ${detail.status}`,
      ),
      createText(documentRoot, "span", "launch-console-selected-provenance", `PROVENANCE · ${detail.id} · ${detail.kind ?? "aggregate-recipient-cohort"} · TUMBO-SIM LOCAL REGISTRY`),
      createText(documentRoot, "span", "launch-console-selected-boundary", detail.boundary),
    );
  }

  function renderPopulationContext() {
    const context = currentPopulationContext;
    if (populationPanel) populationPanel.dataset.populationStatus = context.status;
    if (populationRefreshButton) {
      populationRefreshButton.disabled = populationRefreshPending;
      populationRefreshButton.textContent = populationRefreshPending
        ? "READING WORLD BANK…"
        : "REFRESH WORLD BANK";
    }
    const availableContexts = context.availableContextCount ?? 0;
    const contextCount = context.contextCount ?? 6;
    const range = context.requestedYears?.from && context.requestedYears?.to
      ? `${context.requestedYears.from}–${context.requestedYears.to}`
      : "bounded year window";
    if (populationStatusEl) {
      const statusLabel = context.status === "ready"
        ? "READY"
        : context.status === "partial"
          ? "PARTIAL"
          : "UNAVAILABLE";
      populationStatusEl.textContent = `${statusLabel} · ${context.provider} · ${context.indicator} · ${context.recordCount}/${POPULATION_CONTEXT_MAX_ROWS_RENDER} OBSERVATIONS · ${availableContexts}/${contextCount} CONTEXTS${populationRefreshPending ? " · REQUESTING" : ""}`;
      populationStatusEl.dataset.status = context.status;
    }
    if (populationSummaryEl) {
      populationSummaryEl.textContent = `${range} · fixed representative context set · ${context.liveFetch ? "retrieved from public provider" : "no public read in this session"} · ${context.retrievedAt}`;
    }
    if (populationRecordsEl) {
      populationRecordsEl.replaceChildren();
      if (!context.records.length) {
        populationRecordsEl.appendChild(createText(
          documentRoot,
          "div",
          "launch-console-population-empty",
          context.reason ?? "No public population observations returned; no fallback rows were fabricated.",
        ));
      } else {
        context.records.forEach((record) => {
          const item = documentRoot.createElement("div");
          item.className = "launch-console-population-record";
          item.dataset.contextCode = record.contextCode;
          item.append(
            createText(documentRoot, "strong", "launch-console-population-record-title", `${record.contextLabel} · ${record.countryName}`),
            createText(documentRoot, "span", "launch-console-population-record-meta", `${record.contextCode} · ${record.year ?? "YEAR UNAVAILABLE"} · ${record.indicator}`),
            createText(documentRoot, "span", "launch-console-population-record-value", record.population === null ? "POPULATION UNAVAILABLE" : `${formatInteger(record.population)} ${record.unit}`),
            createText(documentRoot, "span", "launch-console-population-record-source", "WORLD BANK PROVIDER OBSERVATION · CONTEXT ONLY"),
          );
          populationRecordsEl.appendChild(item);
        });
      }
    }
    if (populationBoundaryEl) populationBoundaryEl.textContent = context.boundary;
  }

  function journeyIndex() {
    const index = LAUNCH_JOURNEY_STEPS.findIndex(({ id }) => id === journeyStep);
    return index >= 0 ? index : 0;
  }

  function renderJourney() {
    const index = journeyIndex();
    const current = LAUNCH_JOURNEY_STEPS[index];
    const previous = LAUNCH_JOURNEY_STEPS[index - 1] ?? null;
    const next = LAUNCH_JOURNEY_STEPS[index + 1] ?? null;
    journeyStepButtons.forEach((button) => {
      const active = button.dataset.launchJourneyStep === current.id;
      button.setAttribute("aria-current", active ? "step" : "false");
      button.setAttribute("aria-pressed", String(active));
    });
    if (journeyStatusEl) {
      journeyStatusEl.textContent = `STEP ${index + 1} / ${LAUNCH_JOURNEY_STEPS.length} · ${current.title} — ${current.detail}`;
      journeyStatusEl.dataset.step = current.id;
    }
    if (journeyPrevButton) {
      journeyPrevButton.disabled = !previous;
      journeyPrevButton.textContent = previous ? `Back: ${previous.label}` : "Back";
    }
    if (journeyNextButton) {
      journeyNextButton.disabled = !next;
      journeyNextButton.textContent = next ? `Next: ${next.label}` : "Journey complete";
    }
    if (journeySocialButton) {
      journeySocialButton.disabled = current.id === "social";
      journeySocialButton.setAttribute("aria-current", current.id === "social" ? "step" : "false");
    }
  }

  function render() {
    summary = summarizeLaunchDistribution(currentProjection);
    const visible = visibleCoverage();
    if (!routeError && !visible.rows.some((row) => row.id === selectedId)) selectedId = visible.rows[0]?.id ?? null;
    if (supplyEl) supplyEl.textContent = `${formatInteger(summary.totalSupply)} ${summary.unit}`;
    if (rowCountEl) rowCountEl.textContent = formatInteger(summary.rowCount);
    if (basisEl) basisEl.textContent = `${formatInteger(summary.totalBasisPoints)} / ${formatInteger(summary.expectedBasisPoints)} bp`;
    if (unitsEl) unitsEl.textContent = `${formatInteger(summary.totalUnits)} / ${formatInteger(summary.expectedUnits)}`;
    statusEl.textContent = routeError
      ? `ASSET-TOKEN COHORT ROUTE REJECTED · ${routeError} · NO ROW FABRICATED`
      : lastRehearsal
      ? `REHEARSED · TUMBO ASSET-TOKEN ALLOCATION · LOCAL ACTION #${rehearsalCount} · ${lastRehearsal.registryComplete ? "REGISTRY COMPLETE" : "REVIEW REQUIRED"} · NO TRANSFER`
      : lastReplay
        ? `PREVIEWED · LOCAL REPLAY #${replayCount} · NO TRANSFER`
        : simulationDistributionEnabled
          ? "LOCAL DEMO OPERATOR · TUMBO-SIM REHEARSAL ENABLED · NO TRANSFER"
          : "READY · TUMBO ASSET-TOKEN ALLOCATION PREVIEW · NO TRANSFER";
    if (simulationToggle) {
      simulationToggle.disabled = !validOperator;
      simulationToggle.setAttribute("aria-pressed", String(simulationDistributionEnabled));
      simulationToggle.textContent = simulationDistributionEnabled ? "Disable local TUMBO-SIM rehearsal" : "Enable local TUMBO-SIM rehearsal";
      simulationToggle.title = validOperator ? "Local fictional-aggregate rehearsal toggle; not secure admin authorization and not a launch control." : "Denied: local demo operator capability is missing or invalid.";
    }
    eventEl.textContent = `${summary.eventId} · ${summary.eventStatus} · ${summary.updatedAt}${lastRehearsal ? ` · ${lastRehearsal.actionId}` : ""}`;
    const reconciled = summary.totalBasisPoints === summary.expectedBasisPoints
      && summary.totalUnits === summary.expectedUnits
      && summary.totalUnits === summary.totalSupply;
    reconciliationEl.textContent = reconciled
      ? "RECONCILIATION VERIFIED · 10,000 BP · 1,000,000,000 UNITS"
      : "RECONCILIATION REQUIRES REVIEW";
    reconciliationEl.dataset.status = reconciled ? "verified" : "review";
    if (rehearsalStatusEl) {
      rehearsalStatusEl.textContent = lastRehearsal
        ? `FULL REGISTRY REHEARSAL · ${lastRehearsal.completeClassCount}/${lastRehearsal.allocationClassCount} CLASSES · ${lastRehearsal.registryEntryCount}/${summary.rowCount} ROWS · ${formatInteger(lastRehearsal.totalBasisPoints)} BP · ${formatInteger(lastRehearsal.totalUnits)} ${summary.unit} · ${lastRehearsal.registryComplete ? "VERIFIED" : "REVIEW"}`
        : simulationToggle && !simulationDistributionEnabled
          ? "LOCAL REHEARSAL DISABLED · ENABLE LOCAL TUMBO-SIM REHEARSAL FIRST · NO TRANSFER"
          : "FULL REGISTRY REHEARSAL NOT RUN · SELECT THE ACTION TO CHECK EVERY ROW";
      rehearsalStatusEl.dataset.status = lastRehearsal?.registryComplete ? "verified" : "pending";
    }
    if (allocationClassesEl) {
      allocationClassesEl.replaceChildren();
      if (!summary.allocationClasses.length) {
        allocationClassesEl.appendChild(createText(documentRoot, "div", "launch-console-allocation-empty", "No allocation class summary is available."));
      } else {
        summary.allocationClasses.forEach((allocation) => {
          const item = createText(
            documentRoot,
            "div",
            "launch-console-allocation-class",
            `${allocation.label} · ${percentLabel(allocation.percentage)} · ${formatInteger(allocation.tokenUnits)} ${summary.unit} · ${allocation.rowCount} registry row${allocation.rowCount === 1 ? "" : "s"}`,
          );
          item.dataset.allocationId = allocation.allocationId;
          item.setAttribute?.("role", "listitem");
          item.dataset.status = allocation.complete ? "complete" : "review";
          allocationClassesEl.appendChild(item);
        });
      }
    }
    if (boundaryEl) boundaryEl.textContent = summary.boundary;
    renderCoverageLens();
    renderRows();
    renderSelectedCohort();
    renderJourney();
    renderPopulationContext();
  }

  function setJourneyStep(step, method = "journey-control") {
    if (!JOURNEY_STEP_IDS.has(step)) return getSnapshot();
    journeyStep = step;
    renderJourney();
    const current = LAUNCH_JOURNEY_STEPS[journeyIndex()];
    const snapshot = freezeSnapshot({
      step: current.id,
      label: current.label,
      title: current.title,
      detail: current.detail,
      index: journeyIndex(),
      count: LAUNCH_JOURNEY_STEPS.length,
      method,
      simulation: true,
      localOnly: true,
      executable: false,
      externalNetwork: false,
      externalTransfer: false,
      walletConnection: false,
      issuance: false,
      custody: false,
      signing: false,
      settlement: false,
      market: false,
      money: false,
    });
    onJourney?.(snapshot);
    return getSnapshot();
  }

  function moveJourney(delta, method = "journey-control") {
    const nextIndex = Math.max(0, Math.min(LAUNCH_JOURNEY_STEPS.length - 1, journeyIndex() + delta));
    return setJourneyStep(LAUNCH_JOURNEY_STEPS[nextIndex].id, method);
  }

  function select(id, method = "row") {
    const row = visibleCoverage().rows.find((candidate) => candidate.id === id);
    if (!row) return null;
    selectedId = row.id;
    routeError = null;
    renderRows();
    renderSelectedCohort();
    const snapshot = freezeSnapshot({ ...row, selected: true, localOnly: true });
    onSelect?.(snapshot, method);
    return snapshot;
  }

  function hydrateCohortRoute(routeState, method = "url", reason = null) {
    const valid = routeState?.cohortId && visibleCoverage().rows.find((row) => row.id === routeState.cohortId);
    if (!valid) {
      selectedId = null;
      routeError = reason ?? "cohort ID is malformed, unknown, or not in the canonical registry";
      render();
      return getSnapshot();
    }
    routeError = null;
    selectedId = valid.id;
    render();
    return freezeSnapshot({ ...valid, selected: true, method, localOnly: true, simulation: true, executable: false });
  }
  function hydrateCompareRoute(routeState, method="url", reason=null) { compareRows=routeState?.rows??null; routeError=compareRows?null:(reason??"compare requires exactly two distinct canonical cohort IDs"); selectedId=compareRows?compareRows[0].id:null; render(); return getSnapshot(); }

  function replay(method = "button") {
    replayCount += 1;
    lastReplay = freezeSnapshot({
      launchId: summary.launchId,
      eventId: summary.eventId,
      status: "previewed",
      replayCount,
      rowCount: summary.rowCount,
      totalSupply: summary.totalSupply,
      totalUnits: summary.totalUnits,
      totalBasisPoints: summary.totalBasisPoints,
      unit: summary.unit,
      coverageLens,
      visibleRowCount: visibleCoverage().rowCount,
      simulation: true,
      executable: false,
      externalTransfer: false,
      method,
    });
    render();
    onReplay?.(lastReplay);
    return lastReplay;
  }

  function rehearse(method = "button") {
    if (simulationToggle && !simulationDistributionEnabled) {
      const denied = freezeSnapshot({ actionId: LAUNCH_REHEARSAL_ACTION_ID, status: "denied", reason: "LOCAL DEMO OPERATOR · TUMBO-SIM REHEARSAL is disabled", simulation: true, localOnly: true, authority: "none", executable: false, externalTransfer: false, walletConnection: false, custody: false, signing: false, settlement: false, issuance: false, money: false });
      rehearsalStatusEl && (rehearsalStatusEl.textContent = denied.reason);
      return denied;
    }
    rehearsalCount += 1;
    const completeClassCount = summary.allocationClasses.filter((allocation) => allocation.complete).length;
    const registryComplete = summary.allocationComplete === true
      && summary.rowCount > 0
      && summary.totalBasisPoints === summary.expectedBasisPoints
      && summary.totalUnits === summary.expectedUnits
      && summary.totalUnits === summary.totalSupply;
    const localReceipt = freezeSnapshot({
      actionId: LAUNCH_REHEARSAL_ACTION_ID,
      launchId: summary.launchId,
      eventId: summary.eventId,
      trigger: method,
      status: registryComplete ? "reconciled" : "review",
      registryComplete,
      registryEntryCount: summary.rowCount,
      allocationClassCount: summary.allocationClassCount,
      completeClassCount,
      totalBasisPoints: summary.totalBasisPoints,
      expectedBasisPoints: summary.expectedBasisPoints,
      totalUnits: summary.totalUnits,
      expectedUnits: summary.expectedUnits,
      totalSupply: summary.totalSupply,
      unit: summary.unit,
      registryEntryIds: summary.rows.map((row) => row.id),
      classChecks: summary.allocationClasses.map((allocation) => ({
        allocationId: allocation.allocationId,
        label: allocation.label,
        rowCount: allocation.rowCount,
        basisPoints: allocation.basisPoints,
        expectedBasisPoints: allocation.expectedBasisPoints,
        tokenUnits: allocation.tokenUnits,
        expectedTokenUnits: allocation.expectedTokenUnits,
        complete: allocation.complete,
        aggregate: true,
        simulation: true,
        executable: false,
        externalTransfer: false,
      })),
      simulation: true,
      localOnly: true,
      deterministic: true,
      externalDistribution: false,
      externalTransfer: false,
      walletConnection: false,
      custody: false,
      signing: false,
      settlement: false,
      issuance: false,
      money: false,
      executable: false,
      method,
    });
    let callbackReceipt = null;
    try {
      callbackReceipt = onRehearse?.(localReceipt);
    } catch {
      callbackReceipt = null;
    }
    lastRehearsal = freezeSnapshot(
      isRecord(callbackReceipt)
        ? { ...localReceipt, ...callbackReceipt, actionId: LAUNCH_REHEARSAL_ACTION_ID }
        : localReceipt,
    );
    render();
    return lastRehearsal;
  }

  function setProjection(nextProjection) {
    currentProjection = nextProjection ?? currentProjection;
    render();
    return getSnapshot();
  }

  /**
   * Ask the host for one explicit public population read. The renderer never
   * builds a provider URL or performs a provider call; it only renders the returned
   * metadata and keeps a failure/no-data state visible.
   */
  async function refreshPopulationContext(method = "button") {
    if (populationRefreshPending) return getSnapshot();
    populationRefreshPending = true;
    populationRefreshCount += 1;
    renderPopulationContext();
    let result = null;
    try {
      result = await onPopulationRefresh?.({
        method,
        refreshCount: populationRefreshCount,
      });
    } catch (error) {
      result = {
        source: POPULATION_CONTEXT_RENDER_SOURCE,
        provider: "World Bank Indicators API",
        indicator: "SP.POP.TOTL",
        status: "unavailable",
        records: [],
        contextStatuses: [],
        contextCount: 6,
        availableContextCount: 0,
        providerAvailable: false,
        providerUnavailable: true,
        liveFetch: false,
        externalNetwork: false,
        reason: `Population context refresh failed: ${safeText(error?.message ?? error, "provider unavailable")}`,
        boundary: "Population context is metadata only; no fallback rows were fabricated and the fictional launch registry is unchanged.",
      };
    }
    if (result) currentPopulationContext = normalizePopulationContext(result);
    populationRefreshPending = false;
    renderPopulationContext();
    return getSnapshot();
  }

  function setCoverageLens(nextLens, method = "coverage-button") {
    if (!COVERAGE_LENS_IDS.has(nextLens)) return getSnapshot();
    coverageLens = nextLens;
    const visible = visibleCoverage();
    if (!visible.rows.some((row) => row.id === selectedId)) selectedId = visible.rows[0]?.id ?? null;
    render();
    return freezeSnapshot({
      ...getSnapshot(),
      source: LAUNCH_CONSOLE_SOURCE,
      action: "coverage-filter",
      method,
      lensId: visible.lensId,
      lensLabel: visible.label,
      visibleRowCount: visible.rowCount,
      canonicalRowCount: visible.canonicalRowCount,
      visibleBasisPoints: visible.basisPoints,
      visibleTokenUnits: visible.tokenUnits,
      canonicalBasisPoints: visible.canonicalBasisPoints,
      canonicalUnits: visible.canonicalUnits,
      selectedId,
      routeError,
      simulation: true,
      localOnly: true,
      deterministic: true,
      aggregate: true,
      executable: false,
      externalTransfer: false,
      walletConnection: false,
      custody: false,
      signing: false,
      settlement: false,
      externalNetwork: false,
    });
  }

  function getSnapshot() {
    const visible = visibleCoverage();
    return freezeSnapshot({
      ...summary,
      selectedId,
      selectedCohort: summarizeLaunchCohort(visible.rows.find((row) => row.id === selectedId)),
      coverageLens,
      coverageLensDefinition: coverageLensDefinition(coverageLens),
      visibleRows: visible.rows,
      visibleRowCount: visible.rowCount,
      visibleBasisPoints: visible.basisPoints,
      visibleTokenUnits: visible.tokenUnits,
      coverage: visible,
      opened,
      replayCount,
      lastReplay,
      rehearsalCount,
      lastRehearsal,
      journeyStep,
      journeyIndex: journeyIndex(),
      journeyCount: LAUNCH_JOURNEY_STEPS.length,
      journey: LAUNCH_JOURNEY_STEPS,
      populationContext: currentPopulationContext,
      populationRefreshCount,
      populationRefreshPending,
      localOnly: true,
      deterministic: true,
    });
  }

  openButton?.addEventListener("click", () => setOpen(!opened, opened ? "close" : "open"));
  closeButton.addEventListener("click", () => setOpen(false, "close"));
  replayButton.addEventListener("click", () => replay("button"));
  rehearseButton?.addEventListener("click", () => rehearse("button"));
  simulationToggle?.addEventListener("click", () => { if (validOperator) { simulationDistributionEnabled = !simulationDistributionEnabled; render(); } });
  journeyStepButtons.forEach((button) => {
    button.addEventListener("click", () => setJourneyStep(button.dataset.launchJourneyStep, "step-button"));
  });
  journeyPrevButton?.addEventListener("click", () => moveJourney(-1, "previous-button"));
  journeyNextButton?.addEventListener("click", () => moveJourney(1, "next-button"));
  journeySocialButton?.addEventListener("click", () => setJourneyStep("social", "social-handoff-button"));
  coverageLensButtons().forEach((button) => {
    button.addEventListener("click", () => setCoverageLens(button.dataset.launchCoverageLens, "coverage-button"));
  });
  populationRefreshButton?.addEventListener("click", () => {
    void refreshPopulationContext("button");
  });
  globalThis.addEventListener?.("popstate", () => {
    const query = new URLSearchParams(globalThis.location?.search ?? "");
    if (query.get("panel") !== LAUNCH_COHORT_ROUTE_PANEL) return;
    const cohortId = query.get(LAUNCH_COHORT_ROUTE_PARAM);
    const routeState = validateLaunchCohortRoute({ cohortId, projection: currentProjection });
    hydrateCohortRoute(routeState, "popstate", routeState ? null : "cohort ID is malformed, unknown, or not in the canonical registry");
  });
  documentRoot.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false, "escape");
  });

  render();
  setOpen(opened, "initial");

  return Object.freeze({
    open: () => setOpen(true, "open"),
    close: () => setOpen(false, "close"),
    toggle: () => setOpen(!opened, "toggle"),
    replay,
    rehearse,
    select,
    hydrateCohortRoute,
    hydrateCompareRoute,
    setProjection,
    setJourneyStep,
    setCoverageLens,
    setRegistryLens: setCoverageLens,
    refreshPopulationContext,
    setPopulationContext: (next) => {
      currentPopulationContext = normalizePopulationContext(next);
      renderPopulationContext();
      return getSnapshot();
    },
    nextJourneyStep: () => moveJourney(1, "api-next"),
    previousJourneyStep: () => moveJourney(-1, "api-previous"),
    getSnapshot,
  });
}

export default createLaunchConsole;
