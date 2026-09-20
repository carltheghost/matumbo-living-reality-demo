import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import {
  LAUNCH_COVERAGE_LENSES,
  createLaunchConsole,
  filterLaunchDistributionRows,
  summarizeLaunchCohort,
  summarizeLaunchCoverage,
  summarizeLaunchDistribution,
} from "../src/render/launch-console.js";

function makeElement(documentRoot, tag = "div", id = "") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id,
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: "",
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    classList: { toggle() {} },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    focus() {},
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  for (const [id, hidden] of [
    ["launch-console", true],
    ["launch-console-open"],
    ["launch-console-close"],
    ["launch-console-rehearse"],
    ["launch-console-replay"],
    ["launch-console-status"],
    ["launch-console-event"],
    ["launch-console-reconciliation"],
    ["launch-console-rehearsal-status"],
    ["launch-console-selected"],
    ["launch-console-rows"],
    ["launch-console-supply"],
    ["launch-console-row-count"],
    ["launch-console-basis"],
    ["launch-console-units"],
    ["launch-console-coverage-lens"],
    ["launch-console-coverage-lens-status"],
    ["launch-console-boundary"],
    ["launch-console-allocation-classes"],
    ["launch-journey-status"],
    ["launch-journey-prev"],
    ["launch-journey-next"],
    ["launch-journey-social"],
    ["launch-console-population"],
    ["launch-console-population-refresh"],
    ["launch-console-population-status"],
    ["launch-console-population-summary"],
    ["launch-console-population-records"],
    ["launch-console-population-boundary"],
  ]) {
    const element = makeElement(documentRoot, "div", id);
    element.hidden = hidden === true;
    elements.set(id, element);
  }
  const coverage = elements.get("launch-console-coverage-lens");
  ["all", "social", "county-community", "organisations", "international-funds", "grants", "reserves"].forEach((id) => {
    const button = makeElement(documentRoot, "button");
    button.dataset.launchCoverageLens = id;
    coverage.appendChild(button);
  });
  return documentRoot;
}

function collectText(node) {
  return [node.textContent ?? "", ...(node.children ?? []).map(collectText)].join(" ");
}

test("cohort inspection preserves exact metrics and local-only authority flags", () => {
  const summary = summarizeLaunchDistribution(createLivingRealityProjection().world);
  const first = summary.rows[0];
  const inspected = summarizeLaunchCohort(first);
  assert.equal(inspected.id, first.id);
  assert.equal(inspected.label, first.label);
  assert.equal(inspected.percentage, first.percentage);
  assert.equal(inspected.basisPoints, first.basisPoints);
  assert.equal(inspected.tokenUnits, first.tokenUnits);
  assert.match(inspected.inspection, /TUMBO-SIM/);
  assert.match(inspected.boundary, /AGGREGATE FICTIONAL COHORT/);
  for (const denied of [
    "localOnly",
    "deterministic",
    "externalTransfer",
    "walletConnection",
    "custody",
    "signing",
    "settlement",
    "externalNetwork",
  ]) assert.equal(inspected[denied], denied === "externalTransfer" || denied === "walletConnection" || denied === "custody" || denied === "signing" || denied === "settlement" || denied === "externalNetwork" ? false : true, `${denied} boundary`);
  assert.equal(inspected.executable, false);
  assert.equal(Object.isFrozen(inspected), true);
});

test("launch console exposes a selected cohort detail panel and deterministic replay event", () => {
  const documentRoot = makeDocument();
  const launchConsole = createLaunchConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
  });
  const selected = documentRoot.getElementById("launch-console-selected");
  const rows = documentRoot.getElementById("launch-console-rows");
  const allocationClasses = documentRoot.getElementById("launch-console-allocation-classes");
  const summary = launchConsole.getSnapshot();
  assert.equal(rows.children.length, 18);
  assert.equal(allocationClasses.children.length, 8);
  assert.equal(collectText(allocationClasses).toLowerCase().includes("county"), true);
  assert.equal(collectText(allocationClasses).toLowerCase().includes("operations"), true);
  assert.equal(selected.dataset.registryEntryId, summary.rows[0].id);
  assert.match(collectText(selected), new RegExp(summary.rows[0].label));
  assert.match(collectText(selected), /250,?000,?000|100,?000,?000/);
  assert.match(collectText(selected), /BP/);
  assert.match(collectText(selected), /TUMBO-SIM/);
  assert.match(collectText(selected), /NO TRANSFER/);

  rows.children[6].listeners.get("click")();
  const selectedAfterClick = launchConsole.getSnapshot();
  assert.equal(selectedAfterClick.selectedId, summary.rows[6].id);
  assert.equal(selected.dataset.registryEntryId, summary.rows[6].id);
  assert.match(collectText(selected), new RegExp(summary.rows[6].label));
  assert.equal(selectedAfterClick.selectedCohort.label, summary.rows[6].label);
  assert.equal(selectedAfterClick.selectedCohort.tokenUnits, summary.rows[6].tokenUnits);

  const replay = launchConsole.replay("cohort-inspection-test");
  assert.equal(replay.eventId, "distribution-event:tumbo-demo-launch");
  assert.equal(replay.status, "previewed");
  assert.equal(replay.externalTransfer, false);
  assert.equal(launchConsole.getSnapshot().replayCount, 1);
  assert.match(documentRoot.getElementById("launch-console-status").textContent, /LOCAL REPLAY #1/);
});

test("launch console exposes an explicit full-registry rehearsal action", () => {
  const documentRoot = makeDocument();
  const calls = [];
  const launchConsole = createLaunchConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onRehearse: (request) => {
      calls.push(request);
      return {
        ...request,
        status: "reconciled",
        registryComplete: true,
        completeClassCount: 8,
      };
    },
  });
  const button = documentRoot.getElementById("launch-console-rehearse");
  const initial = launchConsole.getSnapshot();
  assert.equal(initial.rehearsalCount, 0);
  assert.equal(initial.lastRehearsal, null);
  button.listeners.get("click")();
  const snapshot = launchConsole.getSnapshot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actionId, "distribution-action:tumbo-demo-launch-rehearsal");
  assert.equal(calls[0].trigger, "button");
  assert.equal(snapshot.rehearsalCount, 1);
  assert.equal(snapshot.lastRehearsal.registryComplete, true);
  assert.equal(snapshot.lastRehearsal.registryEntryCount, 18);
  assert.equal(snapshot.lastRehearsal.completeClassCount, 8);
  assert.match(documentRoot.getElementById("launch-console-status").textContent, /REGISTRY COMPLETE/);
  assert.match(documentRoot.getElementById("launch-console-rehearsal-status").textContent, /FULL REGISTRY REHEARSAL .* 8\/8 CLASSES .* 18\/18 ROWS .* VERIFIED/);
  assert.equal(documentRoot.getElementById("launch-console-rehearsal-status").dataset.status, "verified");
  assert.equal(snapshot.lastRehearsal.externalTransfer, false);
  assert.equal(snapshot.lastRehearsal.executable, false);
});

test("coverage lenses expose each aggregate class without changing canonical totals", () => {
  const projection = createLivingRealityProjection().world;
  const summary = summarizeLaunchDistribution(projection);
  assert.deepEqual(LAUNCH_COVERAGE_LENSES.map((lens) => lens.id), [
    "all",
    "social",
    "county-community",
    "organisations",
    "international-funds",
    "grants",
    "reserves",
  ]);
  assert.deepEqual(LAUNCH_COVERAGE_LENSES.map((lens) => filterLaunchDistributionRows(summary.rows, lens.id).length), [18, 3, 4, 3, 3, 2, 3]);
  const county = summarizeLaunchCoverage(summary, "county-community");
  assert.equal(county.rowCount, 4);
  assert.equal(county.basisPoints, 2_000);
  assert.equal(county.tokenUnits, 200_000_000);
  assert.equal(county.canonicalRowCount, 18);
  assert.equal(county.canonicalBasisPoints, 10_000);
  assert.equal(county.canonicalUnits, 1_000_000_000);
  assert.equal(Object.isFrozen(county), true);

  const documentRoot = makeDocument();
  const launchConsole = createLaunchConsole({ documentRoot, projection });
  const coverage = documentRoot.getElementById("launch-console-coverage-lens");
  const countyButton = coverage.children.find((button) => button.dataset.launchCoverageLens === "county-community");
  countyButton.listeners.get("click")();
  const filtered = launchConsole.getSnapshot();
  assert.equal(filtered.coverageLens, "county-community");
  assert.equal(filtered.visibleRowCount, 4);
  assert.equal(filtered.visibleBasisPoints, 2_000);
  assert.equal(filtered.visibleTokenUnits, 200_000_000);
  assert.equal(filtered.rowCount, 18, "canonical row count stays visible");
  assert.equal(filtered.totalBasisPoints, 10_000);
  assert.equal(filtered.totalUnits, 1_000_000_000);
  assert.equal(documentRoot.getElementById("launch-console-rows").children.length, 4);
  assert.match(documentRoot.getElementById("launch-console-coverage-lens-status").textContent, /4\/18 ROWS/);
  assert.match(documentRoot.getElementById("launch-console-coverage-lens-status").textContent, /CANONICAL TOTALS UNCHANGED/);
  assert.equal(filtered.selectedCohort.recipientClass, "county-community");
  const replay = launchConsole.replay("coverage-test");
  assert.equal(replay.coverageLens, "county-community");
  assert.equal(replay.visibleRowCount, 4);
  assert.equal(replay.externalTransfer, false);
});

test("population context rail is renderer-only, explicit, and separate from the fixed registry", async () => {
  const documentRoot = makeDocument();
  const calls = [];
  const launchConsole = createLaunchConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onPopulationRefresh: async (request) => {
      calls.push(request);
      return {
        source: "public-population-context-world-bank",
        provider: "World Bank Indicators API",
        indicator: "SP.POP.TOTL",
        requestedYears: { from: 2022, to: 2024 },
        status: "partial",
        retrievedAt: "2026-08-28T14:00:00.000Z",
        records: [
          {
            id: "worldbank:population:USA:2024",
            contextCode: "USA",
            contextLabel: "North America context",
            countryName: "United States",
            indicator: "SP.POP.TOTL",
            year: 2024,
            population: 340_110_988,
            unit: "people",
          },
        ],
        contextStatuses: [
          { id: "population-context:usa", contextCode: "USA", contextLabel: "North America context", provider: "World Bank Indicators API", indicator: "SP.POP.TOTL", status: "provider-reported", recordCount: 1, latestYear: 2024, latestPopulation: 340_110_988 },
          { id: "population-context:ken", contextCode: "KEN", contextLabel: "East Africa context", provider: "World Bank Indicators API", indicator: "SP.POP.TOTL", status: "unavailable", recordCount: 0, reason: "Provider omitted this context." },
        ],
        contextCount: 6,
        availableContextCount: 1,
        providerAvailable: true,
        providerUnavailable: false,
        liveFetch: true,
        externalNetwork: true,
        boundary: "Population context is metadata only; the fictional registry remains unchanged.",
      };
    },
  });
  const initial = launchConsole.getSnapshot();
  assert.equal(initial.populationContext.status, "unavailable");
  assert.equal(initial.populationContext.recordCount, 0);
  const refreshed = await launchConsole.refreshPopulationContext("url");
  assert.deepEqual(calls, [{ method: "url", refreshCount: 1 }]);
  assert.equal(refreshed.populationContext.status, "partial");
  assert.equal(refreshed.populationContext.recordCount, 1);
  assert.equal(refreshed.populationContext.providerAvailable, true);
  assert.equal(refreshed.populationContext.contextualOnly, true);
  assert.equal(refreshed.populationContext.recipientCount, false);
  assert.equal(refreshed.populationContext.allocationWeight, false);
  assert.equal(refreshed.rowCount, 18);
  assert.equal(refreshed.totalBasisPoints, 10_000);
  assert.equal(refreshed.totalUnits, 1_000_000_000);
  const status = documentRoot.getElementById("launch-console-population-status");
  assert.match(status.textContent, /PARTIAL .* WORLD BANK INDICATORS API .* SP\.POP\.TOTL .* 1\/18 OBSERVATIONS/i);
  assert.match(collectText(documentRoot.getElementById("launch-console-population-records")), /North America context/);
  assert.match(collectText(documentRoot.getElementById("launch-console-population-boundary")), /metadata only/i);
  const source = await readFile(new URL("../src/render/launch-console.js", import.meta.url), "utf8");
  assert.match(source, /onPopulationRefresh/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
});

test("launch console markup keeps cohort inspection local and network-free", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/launch-console.js", import.meta.url), "utf8");
  assert.match(html, /id=["']launch-console-selected["']/);
  assert.match(html, /id=["']launch-console-allocation-classes["']/);
  assert.match(html, /Selected launch cohort/);
  assert.match(html, /NO TRANSFER/);
  assert.match(source, /summarizeLaunchCohort/);
  assert.match(source, /selectedCohort/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
});
