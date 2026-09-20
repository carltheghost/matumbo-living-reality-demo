import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import {
  CONTRACTS_MARKETS_SOURCE,
  CONTRACTS_MARKETS_REHEARSAL_SOURCE,
  CONTRACTS_MARKETS_GRAPH_ROUTE_MODE,
  ContractState,
  createContractsMarketsGraph,
  createContractDraftRouteState,
  createContractPoolRehearsal,
  validateContractsMarketsGraphRoute,
  validateContractDraftRouteState,
} from "../src/domains/contracts-markets.js";
import {
  CONTRACTS_MARKETS_CONSOLE_SOURCE,
  createContractsMarketsConsole,
  summarizeContractsMarkets,
} from "../src/render/contracts-markets.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
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
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    focus() {},
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  [
    ["contracts-markets-console", true],
    ["contracts-markets-close"],
    ["contracts-markets-replay"],
    ["contracts-markets-reset"],
    ["contracts-markets-status"],
    ["contracts-markets-summary"],
    ["contracts-markets-current"],
    ["contracts-markets-list"],
    ["contracts-markets-trace"],
    ["contracts-markets-boundary"],
    ["contracts-markets-draft"],
    ["contracts-markets-draft-source"],
    ["contracts-markets-draft-contract-label"],
    ["contracts-markets-draft-pool-label"],
    ["contracts-markets-draft-create"],
    ["contracts-markets-draft-clear"],
    ["contracts-markets-draft-inspect"],
    ["contracts-markets-draft-close"],
    ["contracts-markets-draft-copy"],
    ["contracts-markets-draft-status"],
    ["contracts-markets-draft-back"],
    ["contracts-markets-draft-result"],
    ["contracts-markets-open-sports"],
  ].forEach(([id, hidden]) => {
    const element = makeElement(documentRoot);
    element.id = id;
    if (id.endsWith("-label")) element.value = "";
    element.hidden = hidden === true;
    elements.set(id, element);
  });
  return documentRoot;
}

test("contracts summary joins contract, pool, collateral, position, and risk records", () => {
  const projection = createLivingRealityProjection().world;
  const summary = summarizeContractsMarkets(projection);
  assert.equal(summary.source, CONTRACTS_MARKETS_SOURCE);
  assert.equal(summary.recordCount, 5);
  assert.equal(summary.contracts.length, 1);
  assert.equal(summary.pools.length, 1);
  assert.equal(summary.collateral.length, 1);
  assert.equal(summary.positions.length, 1);
  assert.equal(summary.risks.length, 1);
  assert.equal(summary.simulation, true);
  assert.equal(summary.externalNetwork, false);
  assert.equal(summary.executable, false);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.records), true);
});

test("contracts graph resolves the canonical chain with deterministic coverage and risk", () => {
  const projection = createLivingRealityProjection().world;
  const graph = createContractsMarketsGraph(projection);
  assert.equal(graph.status, "complete");
  assert.equal(graph.chains.length, 1);
  const chain = graph.chains[0];
  assert.deepEqual(chain.nodeIds, [
    "contract:demo",
    "pool:demo",
    "collateral:demo",
    "position:demo",
    "risk:position:demo",
  ]);
  assert.equal(chain.status, "complete");
  assert.equal(chain.completeLinkCount, 4);
  assert.equal(chain.missingLinkCount, 0);
  assert.equal(chain.coverageRatio, 1.6);
  assert.equal(chain.coverageStatus, "covered");
  assert.equal(chain.riskBand, "low");
  assert.equal(chain.riskStatus, "complete");
  assert.equal(chain.riskSource, "canonical-risk-scenario");
  assert.equal(graph.coverage.completeRatio, 1);
  assert.deepEqual(graph.risk.bands, { low: 1, elevated: 0, high: 0, unknown: 0 });
  assert.equal(Object.isFrozen(graph), true);
  assert.equal(Object.isFrozen(graph.chains), true);
  assert.equal(Object.isFrozen(chain.links), true);
  assert.equal(Object.isFrozen(chain.links[0]), true);
});

test("canonical graph route resolves only existing contract, pool, collateral, and position records", () => {
  const projection = createLivingRealityProjection().world;
  for (const recordId of ["contract:demo", "pool:demo", "collateral:demo", "position:demo"]) {
    const route = validateContractsMarketsGraphRoute({
      recordId,
      graph: CONTRACTS_MARKETS_GRAPH_ROUTE_MODE,
      projection,
    });
    assert.ok(route, `expected ${recordId} to resolve`);
    assert.equal(route.recordId, recordId);
    assert.equal(route.graph, CONTRACTS_MARKETS_GRAPH_ROUTE_MODE);
    assert.ok(route.graphReadout.nodeIds.includes(recordId));
  }
  assert.equal(validateContractsMarketsGraphRoute({
    recordId: "risk:position:demo",
    graph: CONTRACTS_MARKETS_GRAPH_ROUTE_MODE,
    projection,
  }), null, "derived risk is not an addressable canonical route target");
  assert.equal(validateContractsMarketsGraphRoute({
    recordId: "contract:missing",
    graph: CONTRACTS_MARKETS_GRAPH_ROUTE_MODE,
    projection,
  }), null);
  assert.equal(validateContractsMarketsGraphRoute({
    recordId: "contract:demo",
    graph: "collapsed",
    projection,
  }), null);
  assert.equal(validateContractsMarketsGraphRoute({
    recordId: "contract/demo",
    graph: CONTRACTS_MARKETS_GRAPH_ROUTE_MODE,
    projection,
  }), null);
});

test("contracts graph keeps partial and missing links explicit without repairing records", () => {
  const partial = createContractsMarketsGraph({
    entities: [
      { id: "contract:partial", kind: "contract-scenario", label: "Partial", state: "proposed" },
      { id: "position:partial", kind: "position-scenario", contractId: "contract:partial", poolId: "pool:missing", collateralId: "collateral:missing", side: "long", simulatedExposure: 10 },
    ],
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.chains[0].status, "partial");
  assert.equal(partial.chains[0].completeLinkCount, 1);
  assert.equal(partial.chains[0].missingLinkCount, 3);
  assert.equal(partial.chains[0].coverageRatio, null);
  assert.equal(partial.chains[0].riskStatus, "missing");
  assert.equal(partial.chains[0].links.some((link) => link.status === "missing" && link.expectedKind === "pool-scenario"), true);

  const missing = createContractsMarketsGraph({
    entities: [{ id: "contract:empty", kind: "contract-scenario", label: "Empty", state: "proposed" }],
  });
  assert.equal(missing.status, "missing");
  assert.equal(missing.chains[0].status, "missing");
  assert.equal(missing.chains[0].positionId, null);
  assert.equal(missing.chains[0].links.every((link) => link.status === "missing"), true);
});

test("sports provenance can seed a bounded local contract and pool draft", () => {
  const record = {
    id: "espn-tennis:atp:event:match",
    title: "Test Open · Player One vs Player Two",
    tour: "ATP",
    provider: "ESPN public web API · ATP scoreboard",
    sourceUrl: "https://www.espn.com/tennis/scoreboard/test",
    retrievedAt: "2026-08-27T12:00:00.000Z",
    players: [{ id: "1", name: "Player One", rank: 1 }, { id: "2", name: "Player Two", rank: 2 }],
  };
  const draft = createContractPoolRehearsal({ record, contractLabel: "  Match rehearsal  ", poolLabel: "Observation pool" });
  assert.equal(draft.source, CONTRACTS_MARKETS_REHEARSAL_SOURCE);
  assert.equal(draft.contract.label, "Match rehearsal");
  assert.equal(draft.pool.label, "Observation pool");
  assert.equal(draft.contract.state, "proposed");
  assert.equal(draft.pool.liquidityStatus, "not-configured");
  assert.equal(draft.sourceRecord.sourceUrl, record.sourceUrl);
  assert.deepEqual(draft.players.map((player) => player.name), ["Player One", "Player Two"]);
  assert.equal(draft.externalNetwork, false);
  assert.equal(draft.persistence, false);
  assert.equal(draft.executable, false);
  assert.equal(draft.settlement, false);
  assert.equal(Object.hasOwn(draft, "odds"), false);
  assert.equal(Object.hasOwn(draft, "wager"), false);
  assert.equal(Object.isFrozen(draft), true);
  assert.equal(Object.isFrozen(draft.contract), true);
  assert.throws(() => createContractPoolRehearsal({ record: { ...record, sourceUrl: "http://not-https" } }), /https URL/);
});

test("local contract draft route state is bounded, self-consistent, and round-trips", () => {
  const record = {
    id: "espn-tennis:atp:event:route",
    title: "Route Open · Player One vs Player Two",
    tour: "ATP",
    provider: "ESPN public web API · ATP scoreboard",
    sourceUrl: "https://www.espn.com/tennis/scoreboard/route",
    retrievedAt: "2026-08-27T12:00:00.000Z",
    players: [{ id: "1", name: "Player One", rank: 1 }, { id: "2", name: "Player Two", rank: 2 }],
  };
  const draft = createContractPoolRehearsal({ record });
  const route = createContractDraftRouteState({
    draft,
    sourceRoute: "?build=control4&panel=sports-events&journey=contract-detail-source-182&record=espn-tennis:atp:event:route",
  });
  assert.ok(route);
  assert.equal(route.kind, "contract-detail-route");
  assert.equal(route.contractId, draft.contract.id);
  assert.equal(route.poolId, draft.pool.id);
  assert.equal(route.sourceRecordId, record.id);
  assert.equal(route.lifecycleState, ContractState.PROPOSED);
  assert.equal(Object.isFrozen(route), true);
  assert.equal(Object.isFrozen(route.players), true);
  assert.deepEqual(validateContractDraftRouteState(JSON.parse(JSON.stringify(route))), route);
  assert.equal(validateContractDraftRouteState({ ...route, retrievedAt: "definitely-not-an-iso-timestamp" }), null);
  assert.equal(validateContractDraftRouteState({ ...route, retrievedAt: "2026-08-27T12:00:00Z" })?.retrievedAt, "2026-08-27T12:00:00Z");
  assert.equal(validateContractDraftRouteState({ ...route, retrievedAt: null })?.retrievedAt, null);
  assert.equal(validateContractDraftRouteState({ ...route, sourceUrl: "http://not-allowed" }), null);
  assert.equal(validateContractDraftRouteState({ ...route, sourceUrl: "https://evil.example/record" }), null);
  assert.equal(validateContractDraftRouteState({ ...route, sourceRoute: "https://evil.example/route" }), null);
  assert.equal(validateContractDraftRouteState({ ...route, sourceRoute: `?panel=sports-events&journey=other-route&record=${encodeURIComponent(record.id)}` }), null);
  assert.equal(validateContractDraftRouteState({ ...route, sourceRoute: `?panel=sports-events&journey=contract-detail-source-182&record=espn-tennis:atp:event:other` }), null);
  assert.equal(validateContractDraftRouteState({ ...route, contractId: "contract:draft:other" }), null);
  assert.equal(validateContractDraftRouteState({ ...route, sourceTitle: "x".repeat(97) }), null);
  assert.equal(validateContractDraftRouteState({ ...route, players: [] }), null);
});

test("contracts console selection, replay, and reset stay local and preserve canonical state", () => {
  const projection = createLivingRealityProjection().world;
  const before = JSON.stringify(projection);
  const documentRoot = makeDocument();
  const callbacks = [];
  const consoleAdapter = createContractsMarketsConsole({
    documentRoot,
    projection,
    onSelect: (snapshot) => callbacks.push(snapshot),
    onReplay: (snapshot) => callbacks.push(snapshot),
    onReset: (snapshot) => callbacks.push(snapshot),
  });
  const selected = consoleAdapter.selectRecord("pool:demo", "test");
  assert.equal(selected.source, CONTRACTS_MARKETS_CONSOLE_SOURCE);
  assert.equal(selected.action, "select");
  assert.equal(consoleAdapter.getSnapshot().selectedId, "pool:demo");
  const replay = consoleAdapter.replay("test");
  assert.equal(replay.action, "replay");
  assert.equal(replay.replayedRecordCount, 5);
  const reset = consoleAdapter.reset("test");
  assert.equal(reset.action, "reset");
  assert.equal(consoleAdapter.getSnapshot().trace.length, 0);
  assert.equal(callbacks.map((item) => item.action).join(","), "select,replay,reset");
  assert.equal(callbacks.every((item) => item.localOnly === true && item.simulation === true), true);
  assert.equal(callbacks.every((item) => item.externalNetwork === false && item.executable === false), true);
  assert.equal(JSON.stringify(projection), before);
});

test("empty contracts draft exposes an explicit Tennis Evidence hand-off without creating a draft", () => {
  const documentRoot = makeDocument();
  const callbacks = [];
  const consoleAdapter = createContractsMarketsConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onOpenSportsEvidence: (request) => callbacks.push(request),
  });
  const openSports = documentRoot.getElementById("contracts-markets-open-sports");
  assert.equal(openSports.hidden, false);
  assert.match(openSports.textContent, /OPEN TENNIS EVIDENCE.*SELECT A PUBLIC RECORD/);
  assert.equal(consoleAdapter.getSnapshot().draftSource, null);
  assert.equal(consoleAdapter.getSnapshot().localDraft, null);
  openSports.listeners.get("click")({ detail: 1 });
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].method, "contracts-empty-state");
  assert.equal(callbacks[0].localOnly, true);
  assert.equal(callbacks[0].externalNetwork, false);
  assert.equal(callbacks[0].executable, false);
  assert.equal(consoleAdapter.getSnapshot().draftSource, null);
  assert.equal(consoleAdapter.getSnapshot().localDraft, null);
});

test("contracts console creates, inspects, and clears a local sports draft", () => {
  const documentRoot = makeDocument();
  const callbacks = [];
  const consoleAdapter = createContractsMarketsConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onDraft: (snapshot) => callbacks.push(snapshot),
    onDraftClear: (snapshot) => callbacks.push(snapshot),
    onDraftInspect: (snapshot) => callbacks.push(snapshot),
  });
  const source = {
    id: "espn-tennis:atp:event:match",
    title: "Test Open · Player One vs Player Two",
    tour: "ATP",
    provider: "ESPN public web API · ATP scoreboard",
    sourceUrl: "https://www.espn.com/tennis/scoreboard/test",
    players: [{ id: "1", name: "Player One", rank: 1 }, { id: "2", name: "Player Two", rank: 2 }],
  };
  const prepared = consoleAdapter.prepareDraft(source, "test-handoff");
  assert.equal(prepared.action, "prepare-draft");
  assert.equal(documentRoot.getElementById("contracts-markets-draft-create").disabled, false);
  const created = consoleAdapter.createDraft("test-create");
  assert.equal(created.action, "create-draft");
  assert.equal(created.localDraft.provenance.sourceRecordId, source.id);
  assert.equal(created.localDraft.executable, false);
  assert.match(documentRoot.getElementById("contracts-markets-draft-status").textContent, /DRAFT READY/);
  const inspected = consoleAdapter.inspectDraft("test-inspect");
  assert.equal(inspected.action, "inspect-draft");
  const cleared = consoleAdapter.clearDraft("test-clear");
  assert.equal(cleared.action, "clear-draft");
  assert.equal(consoleAdapter.getSnapshot().localDraft, null);
  assert.deepEqual(callbacks.map((item) => item.action), ["prepare-draft", "create-draft", "inspect-draft", "clear-draft"]);
  assert.equal(callbacks.every((item) => item.localOnly === true && item.executable === false), true);
});

test("contracts console accepts an eligible two-participant multi-sport ESPN observation as a local-only draft", () => {
  const documentRoot = makeDocument();
  const consoleAdapter = createContractsMarketsConsole({ documentRoot, projection: createLivingRealityProjection().world });
  const source = {
    id: "espn-multi-sport:soccer:eng.1:event:competition:0",
    title: "Team Two at Team One",
    tour: "SPORTS",
    provider: "ESPN public web API · English Premier League scoreboard",
    sourceUrl: "https://www.espn.com/soccer/match/_/gameId/competition",
    players: [{ id: "1", name: "Team One", rank: null }, { id: "2", name: "Team Two", rank: null }],
  };
  const prepared = consoleAdapter.prepareDraft(source, "multi-sport-handoff", { sourceRoute: `?panel=multi-sport-events&journey=contract-detail-source-182&record=${encodeURIComponent(source.id)}` });
  assert.equal(prepared.action, "prepare-draft");
  const created = consoleAdapter.createDraft("multi-sport-create");
  assert.equal(created.localDraft.sourceRecord.tour, "SPORTS");
  assert.equal(created.localDraft.executable, false);
  assert.equal(created.localDraft.settlement, false);
  assert.match(consoleAdapter.getDraftRouteState().sourceRoute, /panel=multi-sport-events/);
});

test("contracts console hydrates a deep-linked draft without provider access and traces local close", () => {
  const documentRoot = makeDocument();
  const callbacks = [];
  const consoleAdapter = createContractsMarketsConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onDraft: (snapshot) => callbacks.push(snapshot),
  });
  const source = {
    id: "espn-tennis:atp:event:route-hydrate",
    title: "Hydrate Open · Player One vs Player Two",
    tour: "ATP",
    provider: "ESPN public web API · ATP scoreboard",
    sourceUrl: "https://www.espn.com/tennis/scoreboard/route-hydrate",
    retrievedAt: "2026-08-27T12:00:00.000Z",
    players: [{ id: "1", name: "Player One", rank: 1 }, { id: "2", name: "Player Two", rank: 2 }],
  };
  consoleAdapter.prepareDraft(source, "test-handoff", { sourceRoute: `?panel=sports-events&journey=contract-detail-source-182&record=${encodeURIComponent(source.id)}` });
  const created = consoleAdapter.createDraft("test-create");
  const route = consoleAdapter.getDraftRouteState();
  assert.equal(route.sourceRecordId, source.id);
  assert.equal(route.contractId, created.localDraft.contract.id);
  assert.equal(route.poolId, created.localDraft.pool.id);

  const freshDocument = makeDocument();
  const hydratedCallbacks = [];
  const freshConsole = createContractsMarketsConsole({
    documentRoot: freshDocument,
    projection: createLivingRealityProjection().world,
    onDraft: (snapshot) => hydratedCallbacks.push(snapshot),
  });
  const hydrated = freshConsole.hydrateDraftRouteState(route, "url");
  assert.equal(hydrated.action, "hydrate-draft-route");
  assert.equal(hydrated.localDraft.sourceRecord.id, source.id);
  assert.equal(hydrated.localDraft.contract.id, route.contractId);
  assert.equal(hydrated.localDraft.pool.id, route.poolId);
  assert.equal(hydrated.localDraft.persistence, false);
  assert.equal(hydrated.localDraft.executable, false);
  assert.equal(hydrated.localDraft.settlement, false);
  assert.equal(hydrated.localDraft.custody, false);
  assert.equal(hydratedCallbacks.length, 1);
  assert.equal(hydratedCallbacks[0].method, "url");
  assert.equal(freshDocument.getElementById("contracts-markets-draft-back").hidden, false);
  const result = freshDocument.getElementById("contracts-markets-draft-result");
  const links = result.children.find((child) => child.className === "contracts-markets-draft-links");
  assert.ok(links, "hydrated detail should expose actionable contract/pool links");
  assert.equal(links.children.length, 2);
  assert.equal(links.children[0].id, "contracts-markets-draft-contract-link");
  assert.equal(links.children[1].id, "contracts-markets-draft-pool-link");
  assert.match(links.children[0].href, /panel=contracts/);
  assert.match(links.children[0].href, /contract=/);
  assert.match(links.children[1].href, /node=pool/);

  const closed = freshConsole.closeDraft("button");
  assert.equal(closed.action, "close-draft");
  assert.equal(closed.localDraft.contract.state, ContractState.CLOSED);
  assert.equal(closed.localDraft.lifecycle.reason, "local-close");
  assert.equal(freshConsole.getDraftRouteState().lifecycleState, ContractState.CLOSED);
  assert.equal(freshConsole.getSnapshot().trace[0].action, "close-draft");

  const blocked = freshConsole.hydrateDraftRouteState({ ...route, sourceUrl: "https://evil.example/record" }, "url");
  assert.equal(blocked.action, "hydrate-draft-route-blocked");
  assert.equal(freshConsole.getSnapshot().localDraft, null);
  assert.match(freshDocument.getElementById("contracts-markets-draft-status").textContent, /ROUTE REJECTED/);
  assert.equal(callbacks.length, 2);
  assert.equal(validateContractDraftRouteState({ ...route, sourceRoute: "?panel=sports-events&journey=contract-detail-source-182" }), null);
});

test("contracts console exposes a bounded copyable detail route without external writes", async () => {
  const documentRoot = makeDocument();
  const copied = [];
  const consoleAdapter = createContractsMarketsConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onDraftCopy: (snapshot) => copied.push(snapshot),
  });
  const source = {
    id: "espn-tennis:wta:event:copy-route",
    title: "Copy Route Open · Player One vs Player Two",
    tour: "WTA",
    provider: "ESPN public web API · WTA scoreboard",
    sourceUrl: "https://www.espn.com/tennis/scoreboard/copy-route",
    retrievedAt: "2026-08-27T12:00:00.000Z",
    players: [{ id: "1", name: "Player One", rank: 1 }, { id: "2", name: "Player Two", rank: 2 }],
  };
  consoleAdapter.prepareDraft(source, "test-handoff", { sourceRoute: `?panel=sports-events&journey=contract-detail-source-182&record=${encodeURIComponent(source.id)}` });
  consoleAdapter.createDraft("test-create");
  const result = await consoleAdapter.copyDraftRoute("test-copy");
  assert.equal(result.routeState.kind, "contract-detail-route");
  assert.match(result.route, /panel=contracts/);
  assert.match(result.route, /contract=/);
  assert.match(result.route, /draft=/);
  assert.equal(result.route.length <= 8192, true);
  assert.equal(result.localDraft.persistence, false);
  assert.equal(result.localDraft.executable, false);
  assert.equal(copied.length, 1);
  assert.match(documentRoot.getElementById("contracts-markets-draft-status").textContent, /ROUTE READY|ROUTE COPIED/);
});

test("contracts console does not mount an unsafe or recordless sports return route", () => {
  const documentRoot = makeDocument();
  const consoleAdapter = createContractsMarketsConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
  });
  const source = {
    id: "espn-tennis:atp:event:unsafe-route",
    title: "Unsafe Route Open · Player One vs Player Two",
    tour: "ATP",
    provider: "ESPN public web API · ATP scoreboard",
    sourceUrl: "https://www.espn.com/tennis/scoreboard/unsafe-route",
    players: [{ id: "1", name: "Player One", rank: 1 }, { id: "2", name: "Player Two", rank: 2 }],
  };
  consoleAdapter.prepareDraft(source, "test-handoff", { sourceRoute: "https://evil.example/return" });
  consoleAdapter.createDraft("test-create");
  assert.equal(consoleAdapter.getSnapshot().draftSourceRoute, null);
  assert.equal(documentRoot.getElementById("contracts-markets-draft-back").hidden, true);
  assert.equal(consoleAdapter.getDraftRouteState(), null);
});

test("contracts console expands linked nodes into a visible local graph trace", () => {
  const projection = createLivingRealityProjection().world;
  const documentRoot = makeDocument();
  const callbacks = [];
  const consoleAdapter = createContractsMarketsConsole({
    documentRoot,
    projection,
    onGraphExpand: (snapshot) => callbacks.push(snapshot),
  });
  const panel = documentRoot.getElementById("contracts-markets-console");
  const expandButton = panel.children.find((child) => child.id === "contracts-markets-expand-graph");
  const graph = panel.children.find((child) => child.id === "contracts-markets-graph");
  assert.ok(expandButton);
  assert.ok(graph);
  assert.equal(expandButton.disabled, false);
  assert.equal(graph.hidden, true);

  consoleAdapter.selectRecord("contract:demo", "test");
  expandButton.listeners.get("click")({});
  const expanded = consoleAdapter.getSnapshot();
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].action, "expand-graph");
  assert.equal(callbacks[0].graphReadout.status, "complete");
  assert.equal(graph.hidden, false);
  assert.equal(graph.children.length, 6, "summary plus five linked contract/pool/collateral/position/risk rows");
  assert.match(graph.children[0].textContent, /LINKED GRAPH · COMPLETE/);
  assert.match(graph.children[1].textContent, /CONTRACT/);
  assert.match(graph.children[5].textContent, /RISK/);
  assert.equal(expanded.trace[0].action, "expand-graph");
  assert.match(documentRoot.getElementById("contracts-markets-trace").children[0].textContent, /EXPAND-GRAPH.*COMPLETE/);

  expandButton.listeners.get("click")({});
  assert.equal(graph.hidden, true);
  assert.equal(consoleAdapter.getSnapshot().trace[0].action, "collapse-graph");
});

test("canonical graph deep link hydrates exact nodes and renders same-origin contract/pool links", () => {
  const projection = createLivingRealityProjection().world;
  const before = JSON.stringify(projection);
  const documentRoot = makeDocument();
  const callbacks = [];
  const consoleAdapter = createContractsMarketsConsole({
    documentRoot,
    projection,
    onGraphExpand: (snapshot) => callbacks.push(snapshot),
  });
  const hydrated = consoleAdapter.hydrateGraphRouteState({
    recordId: "contract:demo",
    graph: CONTRACTS_MARKETS_GRAPH_ROUTE_MODE,
  }, "url");
  assert.equal(hydrated.action, "hydrate-graph-route");
  assert.equal(consoleAdapter.getSnapshot().selectedId, "contract:demo");
  assert.equal(consoleAdapter.getSnapshot().expandedGraph.status, "complete");
  assert.equal(callbacks.length, 1);
  const graph = documentRoot.getElementById("contracts-markets-console").children.find((child) => child.id === "contracts-markets-graph");
  assert.equal(graph.hidden, false);
  const links = graph.children.filter((child) => child.tagName === "A");
  assert.ok(links.length >= 4, "contract, pool, collateral, and position should be addressable");
  for (const link of links) {
    assert.match(link.href, /panel=contracts/);
    assert.match(link.href, /graph=expanded/);
    assert.ok(link.dataset.recordId);
    assert.equal(new URL(link.href, "http://matumbo.local").origin, "http://matumbo.local");
  }
  assert.ok(links.some((link) => link.dataset.recordId === "contract:demo"));
  assert.ok(links.some((link) => link.dataset.recordId === "pool:demo"));
  assert.equal(JSON.stringify(projection), before, "graph hydration must not mutate canonical projection data");

  const blocked = consoleAdapter.hydrateGraphRouteState(null, "url", "unknown canonical record");
  assert.equal(blocked.action, "hydrate-graph-route-blocked");
  assert.equal(consoleAdapter.getSnapshot().selectedId, null);
  assert.equal(consoleAdapter.getSnapshot().expandedGraph, null);
  assert.match(graph.children.map((child) => child.textContent).join(" "), /NO NODE FABRICATED/);
  assert.equal(consoleAdapter.getSnapshot().localOnly, true);
  assert.equal(consoleAdapter.getSnapshot().executable, false);
});

test("contracts console markup exposes an openable local surface", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/contracts-markets.js", import.meta.url), "utf8");
  for (const id of [
    "contracts-markets-console",
    "contracts-markets-close",
    "contracts-markets-replay",
    "contracts-markets-reset",
    "contracts-markets-status",
    "contracts-markets-summary",
    "contracts-markets-current",
    "contracts-markets-list",
    "contracts-markets-expand-graph",
    "contracts-markets-graph",
    "contracts-markets-trace",
    "contracts-markets-boundary",
    "contracts-markets-draft",
    "contracts-markets-draft-source",
    "contracts-markets-draft-contract-label",
    "contracts-markets-draft-pool-label",
    "contracts-markets-draft-create",
    "contracts-markets-draft-inspect",
    "contracts-markets-draft-close",
    "contracts-markets-draft-clear",
    "contracts-markets-draft-copy",
    "contracts-markets-draft-back",
    "contracts-markets-draft-result",
    "contracts-markets-open-sports",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /Contracts \+ Pools/i);
  assert.match(source, /function selectRecord\(/);
  assert.match(source, /function replay\(/);
  assert.match(source, /function prepareDraft\(/);
  assert.match(source, /createContractPoolRehearsal/);
  assert.match(source, /getDraftRouteState/);
  assert.match(source, /hydrateDraftRouteState/);
  assert.match(source, /OPEN CONTRACT/);
  assert.match(source, /OPEN POOL/);
  assert.match(source, /OPEN TENNIS EVIDENCE/);
  assert.match(source, /onOpenSportsEvidence/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /navigator\.sendBeacon/i);
});
