import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createUnavailableWorldEvents,
  summarizeWorldEventRealityBrutality,
  summarizeWorldEventSignalField,
} from "../src/domains/world-events.js";
import { createWorldEventsConsole } from "../src/render/world-events.js";

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
    title: "",
    type: "",
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    classList: { toggle() {} },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
  };
}

function makeDocument({ includeGeographyLens = true } = {}) {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  for (const [id, hidden] of [
    ["world-events-projection", true],
    ["world-events-projection-open"],
    ["world-events-projection-status"],
    ["world-events-projection-summary"],
    ["world-events-projection-providers"],
    ["world-events-projection-bands"],
    ["world-events-projection-boundary"],
    ["world-events-console", true],
    ["world-events-close"],
    ["world-events-refresh"],
    ["world-events-reset"],
    ["world-events-project"],
    ["world-events-status"],
    ["world-events-summary"],
    ["world-events-signal-field"],
    ["world-events-reality-brutality"],
    ["world-events-map-cells"],
    ["world-events-signal-lens"],
    ["world-events-signal-lens-status"],
    ["world-events-geography-lens"],
    ["world-events-order-lens"],
    ["world-events-order-status"],
    ["world-events-humanitarian"],
    ["world-events-humanitarian-status"],
    ["world-events-humanitarian-records"],
    ["world-events-humanitarian-boundary"],
    ["world-events-query-input"],
    ["world-events-query-refresh"],
    ["world-events-query"],
    ["world-events-current"],
    ["world-events-sources"],
    ["world-events-records"],
    ["world-events-trace"],
    ["world-events-boundary"],
  ].filter(([id]) => includeGeographyLens || id !== "world-events-geography-lens")) {
    const element = makeElement(documentRoot, "div", id);
    element.hidden = hidden === true;
    elements.set(id, element);
  }
  const lens = elements.get("world-events-signal-lens");
  ["all", "context", "violence", "explicit"].forEach((id) => {
    const button = makeElement(documentRoot, "button");
    button.dataset.worldEventsLens = id;
    lens.appendChild(button);
  });
  const orderLens = elements.get("world-events-order-lens");
  ["latest", "event-time", "signal-first"].forEach((id) => {
    const button = makeElement(documentRoot, "button");
    button.dataset.worldEventsOrderLens = id;
    orderLens.appendChild(button);
  });
  return documentRoot;
}

function collectText(node) {
  return [node.textContent ?? "", ...(node.children ?? []).map(collectText)].join(" ");
}

function readyData() {
  return {
    status: "ready",
    query: "(violence OR conflict)",
    retrievedAt: "2026-08-27T12:00:00.000Z",
    records: [{
      id: "gdelt-doc:https://news.example.test/one",
      providerId: "gdelt-doc",
      provider: "GDELT DOC 2.0",
      sourceUrl: "https://news.example.test/one",
      title: "Public conflict report",
      sourceObservedAt: "2026-08-27T11:30:00.000Z",
      eventTime: null,
      eventTimeStatus: "unavailable",
      coordinates: { longitude: -73.9, latitude: 40.7 },
      geographyStatus: "provider-reported",
      geographyBasis: "The public response supplied a coordinate pair for presentation only.",
      classification: "violence / conflict mention",
      brutalityLanguageSignal: {
        level: 2,
        band: "violence-language",
        label: "violence language",
        matchedTerms: ["conflict"],
      },
      confidence: 0,
      uncertainty: 1,
      truthClaim: false,
      complete: false,
      localOnly: true,
      simulation: true,
      executable: false,
    }],
    sources: [{
      id: "gdelt-doc",
      provider: "GDELT DOC 2.0",
      endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
      available: true,
      recordCount: 1,
      reason: null,
    }],
    providerAvailable: true,
    providerUnavailable: false,
    liveFetch: true,
    externalNetwork: true,
    externalSource: true,
    localOnly: true,
    simulation: true,
    complete: false,
    truthClaim: false,
    confidence: 0,
    uncertainty: 1,
    executable: false,
    boundary: "Public-source world-event records are unverified research observations.",
    humanitarian: {
      providerId: "unhcr-population",
      provider: "UNHCR Refugee Data Finder",
      status: "ready",
      records: [{
        id: "unhcr-population:2025:aggregate",
        providerId: "unhcr-population",
        provider: "UNHCR Refugee Data Finder",
        sourceUrl: "https://api.unhcr.org/population/v1/population/?year=2025",
        observedYear: 2025,
        sourceObservedAt: null,
        eventTime: null,
        eventTimeStatus: "unavailable",
        geography: { origin: null, asylum: null, status: "unavailable" },
        geographyStatus: "unavailable",
        metrics: { refugees: 28461306, asylum_seekers: 8998097 },
        severity: null,
        severityStatus: "unknown",
        intensity: null,
        intensityStatus: "unknown",
        retrievedAt: "2026-08-27T12:00:00.000Z",
      }],
      boundary: "UNHCR annual population observations; severity and intensity remain unknown.",
    },
  };
}

function chronologyData() {
  const data = readyData();
  const template = data.records[0];
  const makeRecord = (id, sourceObservedAt, eventTime, level, title) => ({
    ...template,
    id,
    sourceUrl: `https://news.example.test/${id}`,
    title,
    sourceObservedAt,
    eventTime,
    eventTimeStatus: eventTime ? "provider-reported" : "unavailable",
    brutalityLanguageSignal: {
      level,
      band: level >= 3 ? "explicit-language" : level >= 2 ? "violence-language" : level >= 1 ? "conflict-context" : "none",
      label: level >= 3 ? "explicit brutality language" : level >= 2 ? "violence language" : level >= 1 ? "conflict context" : "no brutality language signal",
      matchedTerms: level > 0 ? ["conflict"] : [],
    },
  });
  data.records = [
    makeRecord("old", "2026-08-27T10:00:00.000Z", "2026-08-27T09:00:00.000Z", 0, "Older public report"),
    makeRecord("new", "2026-08-27T12:00:00.000Z", null, 1, "Newest report without event time"),
    makeRecord("event", "2026-08-27T11:00:00.000Z", "2026-08-27T13:00:00.000Z", 0, "Provider event-time report"),
    makeRecord("signal", "2026-08-27T08:00:00.000Z", "2026-08-27T08:00:00.000Z", 3, "Explicit title signal report"),
  ];
  data.sources = [{ ...data.sources[0], recordCount: data.records.length }];
  return data;
}

test("World Events console starts with an honest unavailable state and no fake rows", () => {
  const documentRoot = makeDocument();
  const consoleView = createWorldEventsConsole({ documentRoot });
  const snapshot = consoleView.getSnapshot();
  assert.equal(snapshot.summary.status, "unavailable");
  assert.equal(snapshot.summary.recordCount, 0);
  assert.equal(documentRoot.getElementById("world-events-records").children.length, 1);
  assert.match(collectText(documentRoot.getElementById("world-events-records")), /NO PUBLIC DATA|NO DATA FABRICATED/i);
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(snapshot.providerCredentials, false);
  assert.equal(snapshot.executable, false);
});

test("World Pulse stays no-data until the explicit project control is activated once", async () => {
  const documentRoot = makeDocument();
  const requests = [];
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async ({ query, method }) => {
      requests.push({ query, method });
      return readyData();
    },
  });
  assert.equal(consoleView.getSnapshot().summary.recordCount, 0);
  assert.match(collectText(documentRoot.getElementById("world-events-records")), /NO PUBLIC DATA|NO DATA FABRICATED/i);

  await documentRoot.getElementById("world-events-refresh").listeners.get("click")();
  assert.deepEqual(requests, [{
    query: "(violence OR conflict OR attack OR brutality OR displacement)",
    method: "button",
  }]);
  assert.equal(consoleView.getSnapshot().summary.recordCount, 1);
  assert.equal(consoleView.getSnapshot().refreshCount, 1);
});

test("World Events console supports explicit host refresh, selection, replay, and reset", async () => {
  const documentRoot = makeDocument();
  const selected = [];
  const replayed = [];
  const reset = [];
  let refreshCount = 0;
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async ({ query, method }) => {
      refreshCount += 1;
      assert.equal(method, "button");
      assert.equal(query, "(violence OR conflict)");
      return readyData();
    },
    onSelect: (snapshot) => selected.push(snapshot),
    onReplay: (snapshot) => replayed.push(snapshot),
    onReset: (snapshot) => reset.push(snapshot),
  });
  const refreshed = await consoleView.refresh("button", { query: "(violence OR conflict)" });
  assert.equal(refreshCount, 1);
  assert.equal(refreshed.summary.recordCount, 1);
  assert.match(documentRoot.getElementById("world-events-status").textContent, /READY/);
  assert.equal(documentRoot.getElementById("world-events-records").children.length, 1);
  assert.match(collectText(documentRoot.getElementById("world-events-records")), /BRUTALITY LANGUAGE/i);

  documentRoot.getElementById("world-events-records").children[0].listeners.get("click")();
  assert.equal(selected.length, 1);
  assert.equal(selected[0].recordId, readyData().records[0].id);
  assert.match(collectText(documentRoot.getElementById("world-events-current")), /Public conflict report/);
  assert.match(collectText(documentRoot.getElementById("world-events-current")), /BRUTALITY LANGUAGE/i);

  const replay = consoleView.replay("test-button");
  assert.equal(replay.externalNetwork, false);
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].recordId, readyData().records[0].id);
  assert.match(collectText(documentRoot.getElementById("world-events-trace")), /REPLAY/);

  const resetSnapshot = consoleView.reset("test-reset");
  assert.equal(reset.length, 1);
  assert.equal(resetSnapshot.action, "reset");
  assert.equal(consoleView.getSnapshot().trace.length, 0);
  assert.match(collectText(documentRoot.getElementById("world-events-trace")), /No local inspection/);
});

test("World Pulse projects the live cube field and reopens the same summary without refetch", async () => {
  const documentRoot = makeDocument();
  let refreshCount = 0;
  const projections = [];
  const filters = [];
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async () => {
      refreshCount += 1;
      return readyData();
    },
    onProject: (snapshot) => projections.push(snapshot),
    onFilter: (snapshot) => filters.push(snapshot),
  });
  assert.equal(documentRoot.getElementById("world-events-project").disabled, true);
  await consoleView.refresh("button");
  const before = consoleView.getSnapshot();
  assert.equal(refreshCount, 1);
  assert.equal(before.projection.available, true);
  assert.equal(documentRoot.getElementById("world-events-project").disabled, false);

  documentRoot.getElementById("world-events-project").listeners.get("click")();
  const projected = consoleView.getSnapshot();
  assert.equal(projected.projected, true);
  assert.equal(projected.opened, false);
  assert.equal(documentRoot.getElementById("world-events-console").hidden, true);
  assert.equal(documentRoot.getElementById("world-events-projection").hidden, false);
  assert.match(collectText(documentRoot.getElementById("world-events-projection-summary")), /1/);
  assert.match(documentRoot.getElementById("world-events-projection-providers").textContent, /GDELT DOC 2\.0.*READY/i);
  assert.match(collectText(documentRoot.getElementById("world-events-projection-bands")), /VIOLENCE LANGUAGE/);
  assert.match(documentRoot.getElementById("world-events-projection-boundary").textContent, /NO VERIFIED BRUTALITY/i);
  assert.equal(projections.length, 1);
  assert.equal(projections[0].action, "project-field");
  assert.equal(projections[0].projection.returnedRecordCount, before.returnedRecordCount);
  assert.equal(projections[0].localOnly, true);
  assert.equal(projections[0].externalNetwork, false);

  const projectionBands = documentRoot.getElementById("world-events-projection-bands").children;
  const violenceBand = projectionBands.find((button) => button.dataset.worldEventsProjectionBand === "violence");
  assert.ok(violenceBand);
  assert.equal(violenceBand.type, "button");
  assert.equal(violenceBand.disabled, false);
  assert.match(violenceBand.attributes.get("aria-label"), /filter and focus first matching cube/i);
  assert.equal(violenceBand.attributes.get("aria-pressed"), "false");
  violenceBand.listeners.get("click")();
  const bandSnapshot = consoleView.getSnapshot();
  assert.equal(bandSnapshot.projected, true);
  assert.equal(bandSnapshot.signalLens, "violence");
  assert.equal(bandSnapshot.visibleRecordCount, 1);
  assert.equal(bandSnapshot.visibleRecordIds[0], readyData().records[0].id);
  assert.equal(filters.at(-1).method, "projection-band");
  assert.equal(filters.at(-1).visibleRecordCount, 1);
  assert.equal(documentRoot.getElementById("world-events-projection-bands").children.find((button) => button.dataset.worldEventsProjectionBand === "violence").attributes.get("aria-pressed"), "true");
  assert.equal(refreshCount, 1, "projecting is a local presentation toggle");

  documentRoot.getElementById("world-events-projection-open").listeners.get("click")();
  const reopened = consoleView.getSnapshot();
  assert.equal(reopened.projected, false);
  assert.equal(reopened.opened, true);
  assert.equal(documentRoot.getElementById("world-events-console").hidden, false);
  assert.equal(documentRoot.getElementById("world-events-projection").hidden, true);
  assert.equal(reopened.summary.recordCount, before.summary.recordCount);
  assert.deepEqual(reopened.summary.records, before.summary.records);
  assert.equal(refreshCount, 1, "opening the console reuses the in-memory envelope");
});

test("World Events console renders UNHCR as a separate structured humanitarian readout", async () => {
  const documentRoot = makeDocument();
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async () => readyData(),
  });
  await consoleView.refresh("button");
  const humanitarian = consoleView.getSnapshot().humanitarian;
  assert.equal(humanitarian.providerId, "unhcr-population");
  assert.equal(humanitarian.records.length, 1);
  const readout = collectText(documentRoot.getElementById("world-events-humanitarian-records"));
  assert.match(documentRoot.getElementById("world-events-humanitarian-status").textContent, /UNHCR REFUGEE DATA FINDER/i);
  assert.match(readout, /UNHCR REFUGEE DATA FINDER/i);
  assert.match(readout, /YEAR 2025/);
  assert.match(readout, /REFUGEES 28,461,306/);
  assert.match(readout, /GEOGRAPHY UNAVAILABLE/);
  assert.match(readout, /SEVERITY UNKNOWN/);
  assert.match(readout, /INTENSITY UNKNOWN/);
  assert.match(readout, /OPEN UNHCR SOURCE/);
});

test("World Events query control sends a bounded query only on explicit refresh", async () => {
  const documentRoot = makeDocument();
  const requests = [];
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async ({ query, method }) => {
      requests.push({ query, method });
      return { ...readyData(), query };
    },
  });
  const input = documentRoot.getElementById("world-events-query-input");
  input.value = "  climate\nresilience  ";
  await documentRoot.getElementById("world-events-query-refresh").listeners.get("click")();
  assert.deepEqual(requests, [{ query: "climate resilience", method: "query-button" }]);
  assert.equal(consoleView.getSnapshot().queryInput, "climate resilience");
  assert.equal(input.value, "climate resilience");
  assert.equal(consoleView.getSnapshot().summary.query, "climate resilience");
  assert.equal(consoleView.getSnapshot().summary.recordCount, 1);
});

test("World Events signal lenses filter only returned title-language levels", async () => {
  const documentRoot = makeDocument();
  const filtered = [];
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async () => readyData(),
    onFilter: (snapshot) => filtered.push(snapshot),
  });
  await consoleView.refresh("button");
  assert.equal(consoleView.getSnapshot().signalLens, "all");
  assert.equal(consoleView.getSnapshot().visibleRecords.length, 1);

  const lens = documentRoot.getElementById("world-events-signal-lens");
  const explicit = lens.children.find((button) => button.dataset.worldEventsLens === "explicit");
  explicit.listeners.get("click")();
  assert.equal(consoleView.getSnapshot().signalLens, "explicit");
  assert.equal(consoleView.getSnapshot().visibleRecords.length, 0);
  assert.equal(documentRoot.getElementById("world-events-records").children.length, 1);
  assert.match(collectText(documentRoot.getElementById("world-events-records")), /NO RETURNED RECORDS MATCH|NO DATA FABRICATED/i);
  assert.equal(filtered.at(-1).signalLens, "explicit");
  assert.equal(filtered.at(-1).records.length, 0);

  const context = lens.children.find((button) => button.dataset.worldEventsLens === "context");
  context.listeners.get("click")();
  assert.equal(consoleView.getSnapshot().signalLens, "context");
  assert.equal(consoleView.getSnapshot().visibleRecords.length, 1);
  assert.equal(consoleView.getSnapshot().summary.records.length, 1, "canonical full summary remains intact");
});

test("World Events lens exposes visible/returned counts and an honest no-match state", async () => {
  const documentRoot = makeDocument();
  const filtered = [];
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async () => readyData(),
    onFilter: (snapshot) => filtered.push(snapshot),
  });

  await consoleView.refresh("button");
  const all = consoleView.getSnapshot();
  assert.deepEqual(all.visibleRecordIds, [readyData().records[0].id]);
  assert.equal(all.visibleRecordCount, 1);
  assert.equal(all.filteredRecordCount, 0);
  assert.equal(all.returnedRecordCount, 1);
  assert.match(all.filterStatus, /1\/1 MATCH/);
  assert.match(documentRoot.getElementById("world-events-signal-lens-status").textContent, /TITLE LANGUAGE ONLY/);

  consoleView.setSignalLens("explicit", "test-button");
  const empty = consoleView.getSnapshot();
  assert.equal(empty.visibleRecordCount, 0);
  assert.equal(empty.filteredRecordCount, 1);
  assert.equal(empty.returnedRecordCount, 1);
  assert.equal(empty.filterNoMatch, true);
  assert.deepEqual(empty.visibleRecordIds, []);
  assert.match(empty.filterStatus, /0\/1 MATCH/);
  assert.match(empty.filterStatus, /NO DATA FABRICATED/);
  assert.match(documentRoot.getElementById("world-events-signal-lens-status").textContent, /PROVIDER STATUS BELOW/);
  assert.equal(filtered.at(-1).visibleRecordCount, 0);
  assert.deepEqual(filtered.at(-1).visibleRecordIds, []);
  assert.equal(Object.isFrozen(filtered.at(-1)), true);
});

test("World Events map lens filters only returned coordinate coverage and composes with signal lens", async () => {
  const documentRoot = makeDocument({ includeGeographyLens: false });
  const noMapRecord = {
    ...readyData().records[0],
    id: "gdelt-doc:https://news.example.test/no-map",
    sourceUrl: "https://news.example.test/no-map",
    title: "Public context report without mapped place",
    coordinates: null,
    geographyStatus: "unavailable",
    geographyBasis: "The public response did not supply a usable coordinate pair.",
    brutalityLanguageSignal: { level: 0, band: "none", label: "no brutality language signal", matchedTerms: [] },
  };
  const data = readyData();
  data.records = [data.records[0], noMapRecord];
  const filters = [];
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async () => data,
    onFilter: (snapshot) => filters.push(snapshot),
  });
  await consoleView.refresh("button");

  const all = consoleView.getSnapshot();
  assert.equal(all.geographyLens, "all");
  assert.equal(all.visibleRecordCount, 2);
  assert.equal(all.visibleGeographicCoverage.mappedCount, 1);
  assert.equal(all.visibleGeographicCoverage.mapUnavailableCount, 1);
  assert.match(documentRoot.getElementById("world-events-signal-lens-status").textContent, /1 MAPPED.*1 MAP-UNAVAILABLE/);

  const geographyLens = documentRoot.getElementById("world-events-signal-lens").children.find((child) => child.id === "world-events-geography-lens");
  assert.ok(geographyLens, "renderer should mount a geography lens when the host does not provide one");
  const mappedButton = geographyLens.children.find((button) => button.dataset.worldEventsGeographyLens === "mapped");
  mappedButton.listeners.get("click")();
  const mapped = consoleView.getSnapshot();
  assert.equal(mapped.geographyLens, "mapped");
  assert.equal(mapped.coverageLens, "mapped");
  assert.equal(mapped.visibleRecordCount, 1);
  assert.equal(mapped.visibleRecords[0].coordinates.latitude, 40.7);
  assert.match(mapped.filterStatus, /MAP LENS · MAPPED.*1 MAPPED.*0 MAP-UNAVAILABLE/);

  const unavailable = consoleView.setGeographyLens("map-unavailable", "test-button");
  assert.equal(unavailable.visibleRecordCount, 1);
  assert.equal(unavailable.visibleRecords[0].geographyStatus, "unavailable");
  assert.match(collectText(documentRoot.getElementById("world-events-current")), /MAP LOCATION UNAVAILABLE/);

  const noSignal = consoleView.setSignalLens("explicit", "test-button");
  assert.equal(noSignal.visibleRecordCount, 0);
  assert.equal(noSignal.filterNoMatch, true);
  assert.match(noSignal.filterStatus, /NO DATA FABRICATED/);
  assert.equal(filters.at(-1).geographyLens, "map-unavailable");
  assert.equal(Object.isFrozen(noSignal), true);
});

test("World Events chronology orders returned records and keeps missing event times visible", async () => {
  const documentRoot = makeDocument();
  const filtered = [];
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async () => chronologyData(),
    onFilter: (snapshot) => filtered.push(snapshot),
  });

  await consoleView.refresh("button");
  assert.equal(consoleView.getSnapshot().orderLens, "latest");
  assert.deepEqual(consoleView.getSnapshot().visibleRecordIds, ["new", "event", "old", "signal"]);

  const orderLens = documentRoot.getElementById("world-events-order-lens");
  const eventButton = orderLens.children.find((button) => button.dataset.worldEventsOrderLens === "event-time");
  eventButton.listeners.get("click")();
  const eventTime = consoleView.getSnapshot();
  assert.equal(eventTime.orderLens, "event-time");
  assert.deepEqual(eventTime.visibleRecordIds, ["event", "old", "signal", "new"]);
  assert.match(eventTime.chronologyStatus, /EVENT TIME.*KEPT AT END/);
  assert.equal(eventTime.visibleRecords.at(-1).eventTime, null);
  assert.equal(filtered.at(-1).action, "chronology");
  assert.equal(filtered.at(-1).orderLens, "event-time");

  const signalButton = orderLens.children.find((button) => button.dataset.worldEventsOrderLens === "signal-first");
  signalButton.listeners.get("click")();
  const signalFirst = consoleView.getSnapshot();
  assert.equal(signalFirst.orderLens, "signal-first");
  assert.deepEqual(signalFirst.visibleRecordIds, ["signal", "new", "event", "old"]);
  assert.equal(signalFirst.visibleRecordIds.length, signalFirst.returnedRecordCount);
  assert.equal(Object.isFrozen(signalFirst), true);

  consoleView.setSignalLens("explicit", "test-button");
  assert.deepEqual(consoleView.getSnapshot().visibleRecordIds, ["signal"]);
  consoleView.reset("test-reset");
  assert.equal(consoleView.getSnapshot().orderLens, "latest");
  assert.deepEqual(consoleView.getSnapshot().visibleRecordIds, ["new", "event", "old", "signal"]);
});

test("World Events signal field counts only returned title-language bands and map coverage", async () => {
  const documentRoot = makeDocument();
  const data = chronologyData();
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async () => data,
  });
  await consoleView.refresh("button");
  const field = consoleView.getSnapshot().signalField;
  assert.equal(field.recordCount, 4);
  assert.deepEqual(field.bands.map((band) => band.recordCount), [2, 1, 0, 1]);
  assert.equal(field.mappedCount, 4);
  assert.equal(field.mapUnavailableCount, 0);
  assert.match(collectText(documentRoot.getElementById("world-events-signal-field")), /DERIVED SIGNAL FIELD/);
  assert.match(collectText(documentRoot.getElementById("world-events-signal-field")), /NOT A VERIFIED BRUTALITY OR SEVERITY MEASURE/i);

  consoleView.setSignalLens("explicit", "test-button");
  assert.equal(consoleView.getSnapshot().signalField.recordCount, 1);
  assert.equal(consoleView.getSnapshot().signalField.bands.at(-1).recordCount, 1);
  const pure = summarizeWorldEventSignalField(data.records);
  assert.equal(Object.isFrozen(pure), true);
  assert.equal(Object.isFrozen(pure.bands[0]), true);
  assert.deepEqual(pure.providerCounts.map((entry) => entry.recordCount), [4]);
});

test("Reality/Brutality rail filters and focuses returned records without fetching", async () => {
  const documentRoot = makeDocument();
  const data = chronologyData();
  const selected = [];
  const filtered = [];
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async () => data,
    onSelect: (snapshot) => selected.push(snapshot),
    onFilter: (snapshot) => filtered.push(snapshot),
  });
  await consoleView.refresh("button");
  const rail = documentRoot.getElementById("world-events-reality-brutality");
  assert.match(collectText(rail), /REALITY \/ BRUTALITY CONTEXT/);
  assert.match(collectText(rail), /TITLE-LANGUAGE SIGNAL|NO VERIFIED BRUTALITY/i);
  const bands = rail.children.find((child) => child.className === "world-events-reality-brutality-bands");
  assert.ok(bands);
  const explicit = bands.children.find((child) => child.dataset.worldEventsRealityBand === "explicit");
  assert.ok(explicit);
  explicit.listeners.get("click")();
  const snapshot = consoleView.getSnapshot();
  assert.equal(snapshot.signalLens, "explicit");
  assert.equal(snapshot.visibleRecordCount, 1);
  assert.deepEqual(snapshot.visibleRecordIds, ["signal"]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].method, "reality-brutality-band");
  assert.equal(selected[0].recordId, "signal");
  assert.equal(filtered.at(-1).method, "reality-brutality-band");
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(Object.isFrozen(snapshot.realityBrutality), true);
  const pure = summarizeWorldEventRealityBrutality(data.records, data.sources);
  assert.equal(pure.signalRecordCount, 2);
  assert.equal(pure.violenceSignalCount, 1);
});

test("World Events map cells filter returned coordinates and keep unmapped rows out", async () => {
  const documentRoot = makeDocument();
  const data = chronologyData();
  data.records[0].coordinates = { longitude: -120, latitude: 45 };
  data.records[1].coordinates = { longitude: 0, latitude: 0 };
  data.records[2].coordinates = { longitude: 120, latitude: -45 };
  data.records[3].coordinates = null;
  const filtered = [];
  const consoleView = createWorldEventsConsole({
    documentRoot,
    onRefresh: async () => data,
    onFilter: (snapshot) => filtered.push(snapshot),
  });
  await consoleView.refresh("button");
  const all = consoleView.getSnapshot();
  assert.equal(all.mapCellId, "all");
  assert.equal(all.mapCells.activeCellCount, 3);
  assert.equal(all.mapCells.mappedRecordCount, 3);
  assert.equal(all.mapCells.mapUnavailableCount, 1);
  assert.equal(documentRoot.getElementById("world-events-map-cells").children[1].children.length, 4, "all-cells plus three active cells");

  const cells = documentRoot.getElementById("world-events-map-cells").children[1];
  const northWest = cells.children.find((button) => button.dataset.worldEventsMapCell === "north:west");
  northWest.listeners.get("click")();
  const selected = consoleView.getSnapshot();
  assert.equal(selected.mapCellId, "north:west");
  assert.equal(selected.visibleRecordCount, 1);
  assert.equal(selected.visibleRecords[0].id, "old");
  assert.equal(selected.visibleRecords[0].coordinates.latitude, 45);
  assert.match(selected.filterStatus, /MAP CELL · NORTH · WEST/);
  assert.equal(filtered.at(-1).action, "map-cell-filter");
  assert.equal(filtered.at(-1).mapCellId, "north:west");
  assert.equal(Object.isFrozen(selected.mapCells), true);

  const reset = consoleView.setMapCell("all", "test-reset-cell");
  assert.equal(reset.mapCellId, "all");
  assert.equal(reset.visibleRecordCount, 4);
  const invalid = consoleView.setMapCell("unknown-cell", "test-invalid");
  assert.equal(invalid.mapCellId, "all");
  assert.equal(invalid.visibleRecordCount, 4);
});

test("refresh without a host callback keeps the unavailable boundary", async () => {
  const documentRoot = makeDocument();
  const consoleView = createWorldEventsConsole({ documentRoot });
  const result = await consoleView.refresh("button");
  assert.equal(result.summary.status, "unavailable");
  assert.equal(result.summary.recordCount, 0);
  assert.equal(result.externalNetwork, false);
  assert.match(documentRoot.getElementById("world-events-status").textContent, /UNAVAILABLE/);
});

test("renderer source is presentation-only and does not own network or storage", async () => {
  const source = await readFile(new URL("../src/render/world-events.js", import.meta.url), "utf8");
  assert.match(source, /createWorldEventsConsole/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /authorization|api[_-]?key|client[_-]?secret/i);
  assert.match(source, /world-events-geography-lens/);
  assert.match(source, /summarizeWorldEventSignalField/);
  assert.match(source, /summarizeWorldEventRealityBrutality/);
  assert.match(source, /world-events-signal-field/);
  assert.match(source, /world-events-reality-brutality/);
  assert.match(source, /summarizeWorldEventMapCells/);
  assert.match(source, /world-events-map-cells/);
  assert.match(source, /world-events-projection/);
  assert.match(source, /projectField/);
  assert.match(source, /NO VERIFIED BRUTALITY/);
  assert.match(source, /world-events-query-input/);
  assert.match(source, /normalizeWorldEventsQuery/);
  assert.match(source, /MAP LOCATION UNAVAILABLE|PROVIDER COORDINATES ONLY/);
  const unavailable = createUnavailableWorldEvents({ retrievedAt: "2026-08-27T12:00:00.000Z" });
  assert.deepEqual(unavailable.records, []);
});
