import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createMultiSportEventsConsole } from "../src/render/multi-sport-events.js";

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
    href: "",
    target: "",
    rel: "",
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

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  for (const [id, hidden] of [
    ["multi-sport-events-console", true],
    ["multi-sport-events-close"],
    ["multi-sport-events-refresh"],
    ["multi-sport-events-reset"],
    ["multi-sport-events-status"],
    ["multi-sport-events-summary"],
    ["multi-sport-events-query"],
    ["multi-sport-events-current"],
    ["multi-sport-events-sources"],
    ["multi-sport-events-records"],
    ["multi-sport-events-trace"],
    ["multi-sport-events-boundary"],
  ]) {
    const element = makeElement(documentRoot, "div", id);
    element.hidden = hidden === true;
    elements.set(id, element);
  }
  return documentRoot;
}

function collectText(node) {
  return [node?.textContent ?? "", ...(node?.children ?? []).map(collectText)].join(" ");
}

function readyData() {
  const participant = (id, name, homeAway, score) => ({
    id,
    name,
    abbreviation: name.slice(0, 3).toUpperCase(),
    kind: "team",
    homeAway,
    score,
    scoreStatus: "provider-reported",
    rank: null,
  });
  return {
    status: "ready",
    retrievedAt: "2026-08-28T12:00:00.000Z",
    sports: ["soccer", "basketball", "football"],
    leagues: ["eng.1", "nba", "nfl"],
    records: [{
      id: "espn-multi-sport:soccer:eng.1:event:competition:0",
      providerId: "espn-soccer-eng1-scoreboard",
      provider: "ESPN public web API · English Premier League scoreboard",
      sport: "soccer",
      league: "eng.1",
      leagueLabel: "English Premier League",
      title: "Team Two at Team One",
      competition: { id: "competition", type: "STD" },
      participants: [participant("1", "Team One", "home", "2"), participant("2", "Team Two", "away", "1")],
      status: "Scheduled",
      statusDetail: { label: "Scheduled", state: "pre", completed: false },
      eventTime: "2026-08-28T12:00:00.000Z",
      scoreStatus: "provider-reported",
      scoreCount: 2,
      venue: { name: "Test Stadium", city: "London", country: "England" },
      sourceUrl: "https://www.espn.com/soccer/match/_/gameId/competition",
      retrievedAt: "2026-08-28T12:00:00.000Z",
      dataCompletenessGrade: "A",
      dataCompletenessPercent: 100,
      truthClaim: false,
      localOnly: true,
      simulation: true,
      executable: false,
    }],
    sources: [{ id: "espn-soccer-eng1-scoreboard", provider: "ESPN Soccer", sport: "soccer", available: true, recordCount: 1, endpoint: "https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard" }],
    providerAvailable: true,
    providerUnavailable: false,
    liveFetch: true,
    externalNetwork: true,
    externalSource: true,
    localOnly: true,
    simulation: true,
    complete: false,
    truthClaim: false,
    executable: false,
    boundary: "Public scoreboard observations are unverified research data.",
  };
}

test("multi-sport console starts unavailable and does not invent an event", () => {
  const documentRoot = makeDocument();
  const consoleView = createMultiSportEventsConsole({ documentRoot });
  const snapshot = consoleView.getSnapshot();
  assert.equal(snapshot.summary.status, "unavailable");
  assert.equal(snapshot.summary.recordCount, 0);
  assert.equal(documentRoot.getElementById("multi-sport-events-records").children.length, 1);
  assert.match(collectText(documentRoot.getElementById("multi-sport-events-records")), /NO MULTI-SPORT DATA|NO DATA FABRICATED/i);
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(snapshot.providerCredentials, false);
  assert.equal(snapshot.executable, false);
});

test("multi-sport console delegates one explicit refresh and exposes provider fields", async () => {
  const documentRoot = makeDocument();
  const selected = [];
  const replayed = [];
  const reset = [];
  let refreshCount = 0;
  const consoleView = createMultiSportEventsConsole({
    documentRoot,
    onRefresh: async ({ method }) => {
      refreshCount += 1;
      assert.equal(method, "button");
      return readyData();
    },
    onSelect: (snapshot) => selected.push(snapshot),
    onReplay: (snapshot) => replayed.push(snapshot),
    onReset: (snapshot) => reset.push(snapshot),
  });
  const refreshed = await consoleView.refresh("button");
  assert.equal(refreshCount, 1);
  assert.equal(refreshed.summary.recordCount, 1);
  assert.match(documentRoot.getElementById("multi-sport-events-status").textContent, /READY/);
  assert.equal(documentRoot.getElementById("multi-sport-events-records").children.length, 1);
  const currentText = collectText(documentRoot.getElementById("multi-sport-events-current"));
  assert.match(currentText, /Team Two at Team One/);
  assert.match(currentText, /SOCCER/);
  assert.match(currentText, /STATUS · Scheduled/);
  assert.match(currentText, /EVENT TIME/);
  assert.match(currentText, /SCORE FIELDS · 2\/2/);
  assert.match(currentText, /VENUE · Test Stadium/);
  assert.match(currentText, /DATA COMPLETENESS · A · 100%/);
  assert.match(currentText, /OPEN PUBLIC ESPN SOURCE/);

  documentRoot.getElementById("multi-sport-events-records").children[0].listeners.get("click")();
  assert.equal(selected.length, 1);
  assert.equal(selected[0].recordId, readyData().records[0].id);
  const replay = consoleView.replay("test-button");
  assert.equal(replay.externalNetwork, false);
  assert.equal(replayed.length, 1);
  assert.match(collectText(documentRoot.getElementById("multi-sport-events-trace")), /REPLAY/);
  const resetSnapshot = consoleView.reset("test-reset");
  assert.equal(reset.length, 1);
  assert.equal(resetSnapshot.action, "reset");
  assert.equal(consoleView.getSnapshot().trace.length, 0);
});

test("selected eligible multi-sport event exposes a local contract and pool rehearsal handoff", () => {
  const documentRoot = makeDocument();
  const handoffs = [];
  const record = readyData().records[0];
  const consoleView = createMultiSportEventsConsole({
    documentRoot,
    data: readyData(),
    onOpenContractDraft: (snapshot) => handoffs.push(snapshot),
  });
  const button = documentRoot.getElementById("multi-sport-events-current").children
    .find((child) => child.id === "multi-sport-events-current-contract-draft");
  assert.ok(button, "selected public event should expose a local contract/pool action");
  assert.equal(button.dataset.sourceRecordId, record.id);
  assert.equal(button.dataset.sourceUrl, record.sourceUrl);
  assert.match(button.attributes.get("aria-label"), /Team Two at Team One/);
  button.listeners.get("click")();
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].record.id, record.id);
  assert.equal(handoffs[0].record.tour, "SPORTS");
  assert.deepEqual(handoffs[0].record.players.map((player) => player.name), ["Team One", "Team Two"]);
  assert.equal(consoleView.getSnapshot().externalNetwork, false);
  assert.equal(consoleView.getSnapshot().executable, false);
});

test("multi-sport renderer is presentation-only and excludes executable authority", async () => {
  const source = await readFile(new URL("../src/render/multi-sport-events.js", import.meta.url), "utf8");
  assert.match(source, /createMultiSportEventsConsole/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
  assert.match(source, /FIELD PRESENCE ONLY/);
  assert.match(source, /NO DATA FABRICATED/);
});

test("multi-sport renderer exposes explicit selected-event detail without changing the normal refresh callback", async () => {
  const documentRoot = makeDocument();
  const refreshCalls = [];
  const inspectCalls = [];
  const consoleView = createMultiSportEventsConsole({
    documentRoot,
    onRefresh: async ({ method }) => {
      refreshCalls.push(method);
      return readyData();
    },
    onInspect: async ({ record, method }) => {
      inspectCalls.push({ id: record.id, method });
      return {
        status: "ready",
        requestStatus: "available",
        requestCount: 1,
        externalNetwork: true,
        liveFetch: true,
        record: {
          ...record,
          eventId: "event-1",
          publicDetail: {
            status: "available",
            requestCount: 1,
            sourceUrl: "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=event-1",
            timelineStatus: "available",
            periodStatus: "provider-reported",
            detailCompletenessGrade: "A",
            detailCompletenessPercent: 100,
            players: [{ name: "Player One", teamName: "Team One", statLines: [{ label: "PTS", value: "24" }] }],
            periods: [{ period: 1, label: "QUARTER 1", status: "provider-reported", scores: [{ participantName: "Team One", value: "24" }] }],
            timeline: [{ index: 1, kind: "play", period: 1, clock: "10:00", text: "Player One scores", participant: "Team One", score: "2" }],
          },
        },
      };
    },
  });
  await consoleView.refresh("button");
  assert.deepEqual(refreshCalls, ["button"]);
  const detailButton = documentRoot.getElementById("multi-sport-events-current").children.find((child) => child.id === "multi-sport-events-current-detail");
  assert.ok(detailButton);
  const inspected = await consoleView.inspect();
  assert.equal(inspectCalls.length, 1);
  assert.equal(inspectCalls[0].method, "button");
  assert.equal(inspected.selectedRecord.publicDetail.timeline.length, 1);
  const currentText = collectText(documentRoot.getElementById("multi-sport-events-current"));
  assert.match(currentText, /PROVIDER DETAIL · AVAILABLE/);
  assert.match(currentText, /Player One/);
  assert.match(currentText, /QUARTER 1/);
  assert.match(currentText, /Player One scores/);
  assert.match(currentText, /DETAIL COMPLETENESS · A · 100%/);
  assert.match(currentText, /OPEN PUBLIC ESPN EVENT DETAIL/);
  assert.match(collectText(documentRoot.getElementById("multi-sport-events-trace")), /INSPECT-DETAIL/);
  assert.deepEqual(refreshCalls, ["button"]);
});

test("multi-sport renderer exposes missing scoreboard and event-detail provenance instead of empty links", async () => {
  const documentRoot = makeDocument();
  const consoleView = createMultiSportEventsConsole({
    documentRoot,
    onRefresh: async () => {
      const data = readyData();
      return {
        ...data,
        records: [{
          ...data.records[0],
          sourceUrl: "javascript:alert('not-a-public-source')",
        }],
      };
    },
    onInspect: async ({ record }) => ({
      status: "ready",
      requestStatus: "available",
      record: {
        ...record,
        publicDetail: {
          status: "available",
          sourceUrl: "http://example.invalid/detail",
          requestCount: 1,
          players: [],
          periods: [],
          timeline: [],
        },
      },
    }),
  });
  await consoleView.refresh("test");
  assert.match(
    collectText(documentRoot.getElementById("multi-sport-events-current")),
    /PUBLIC SCOREBOARD SOURCE UNAVAILABLE · PROVIDER DID NOT RETURN SAFE HTTPS SOURCE/,
  );
  await consoleView.inspect(undefined, "test");
  assert.match(
    collectText(documentRoot.getElementById("multi-sport-events-current")),
    /EVENT DETAIL SOURCE UNAVAILABLE · PROVIDER DID NOT RETURN SAFE HTTPS SOURCE/,
  );
  const current = documentRoot.getElementById("multi-sport-events-current");
  assert.equal(current.children.some((child) => child.className === "multi-sport-events-current-url"), false);
  assert.equal(current.children.some((child) => child.className === "multi-sport-events-current-detail-url"), false);
});
