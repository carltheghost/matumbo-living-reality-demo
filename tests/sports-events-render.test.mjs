import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createUnavailableSportsEvents } from "../src/domains/sports-events.js";
import { createSportsEventsConsole } from "../src/render/sports-events.js";

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
    ["sports-events-console", true],
    ["sports-events-close"],
    ["sports-events-refresh"],
    ["sports-events-reset"],
    ["sports-events-status"],
    ["sports-events-summary"],
    ["sports-events-query"],
    ["sports-events-current"],
    ["sports-events-secondary-parity"],
    ["sports-events-secondary-status"],
    ["sports-events-secondary-context"],
    ["sports-events-secondary-fields"],
    ["sports-events-secondary-boundary"],
    ["sports-events-sources"],
    ["sports-events-records"],
    ["sports-events-trace"],
    ["sports-events-boundary"],
  ]) {
    const element = makeElement(documentRoot, "div", id);
    element.hidden = hidden === true;
    elements.set(id, element);
  }
  return documentRoot;
}

function collectText(node) {
  return [node.textContent ?? "", ...(node.children ?? []).map(collectText)].join(" ");
}

function readyData() {
  return {
    status: "ready",
    retrievedAt: "2026-08-27T12:00:00.000Z",
    tours: ["ATP", "WTA"],
    records: [{
      id: "espn-tennis:atp:event:match",
      providerId: "espn-atp-scoreboard",
      provider: "ESPN public web API · ATP scoreboard",
      tour: "ATP",
      matchId: "match",
      title: "Test Open · Player One vs Player Two",
      tournament: { name: "Test Open", sourceUrl: "https://www.espn.com/tennis/scoreboard/test" },
      match: { round: "Final", venue: "Test Court" },
      players: [
        { id: "1", name: "Player One", rank: 1, rankStatus: "provider-reported", rankSourceUrl: "https://site.web.api.espn.com/apis/site/v2/sports/tennis/atp/rankings", countryCode: "USA", profileUrl: "https://www.espn.com/tennis/player/1", winner: true },
        { id: "2", name: "Player Two", rank: 2, rankStatus: "provider-reported", rankSourceUrl: "https://site.web.api.espn.com/apis/site/v2/sports/tennis/atp/rankings", countryCode: "GBR", profileUrl: "https://www.espn.com/tennis/player/2", winner: false },
      ],
      status: { label: "Final", state: "post", completed: true },
      statusDetail: { label: "Final", state: "post", completed: true, final: true, completionStatus: "final", source: "provider-reported" },
      completionStatus: "final",
      completion: { status: "final", completed: true, final: true, source: "provider-reported" },
      eventTime: "2026-08-27T15:00:00.000Z",
      retrievedAt: "2026-08-27T12:00:00.000Z",
      setScores: [{
        set: 1,
        scores: [{ athleteId: "1", athleteName: "Player One", value: 6, displayValue: "6", winner: true }, { athleteId: "2", athleteName: "Player Two", value: 4, displayValue: "4", winner: false }],
        dataCompletenessGrade: "A",
        dataCompletenessPercent: 100,
        scoreStatus: "complete",
        scoreCount: 2,
        expectedScoreCount: 2,
      }],
      setScoreCompleteness: { status: "complete", providedSets: 1, completeSets: 1, partialSets: 0, unavailableSets: 0 },
      resultReconciliation: {
        status: "consistent",
        checkCount: 5,
        availableCheckCount: 5,
        conflictCount: 0,
        basis: "Internal consistency across one provider response only.",
      },
      timelineStatus: "unavailable",
      timelineReason: "The public scoreboard payload did not include a point-by-point timeline.",
      detailReferences: ["https://www.espn.com/tennis/scoreboard/test"],
      sourceUrl: "https://www.espn.com/tennis/scoreboard/test",
      dataCompletenessGrade: "B",
      dataCompletenessPercent: 75,
      basis: "Match field completeness only; not a player rating or betting grade.",
      uncertainty: 1,
      confidence: 0,
      truthClaim: false,
      localOnly: true,
      simulation: true,
      executable: false,
    }],
    rankings: [{ id: "1", tour: "ATP", rank: 1 }],
    sources: [{ id: "espn-atp-scoreboard", provider: "ESPN ATP", format: "scoreboard", available: true, recordCount: 1, endpoint: "https://site.web.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard" }],
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
    boundary: "Public ESPN tennis observations are unverified research data.",
  };
}

test("Tennis console starts unavailable and never invents a match", () => {
  const documentRoot = makeDocument();
  const consoleView = createSportsEventsConsole({ documentRoot, onRefresh: async () => createUnavailableSportsEvents() });
  const snapshot = consoleView.getSnapshot();
  assert.equal(snapshot.summary.status, "unavailable");
  assert.equal(snapshot.summary.recordCount, 0);
  assert.equal(documentRoot.getElementById("sports-events-records").children.length, 1);
  assert.match(collectText(documentRoot.getElementById("sports-events-records")), /NO TENNIS DATA|NO DATA FABRICATED/i);
  const emptyRefresh = documentRoot.getElementById("sports-events-current").children
    .find((child) => child.id === "sports-events-empty-refresh");
  assert.ok(emptyRefresh, "the empty state should expose the explicit public refresh action");
  assert.match(emptyRefresh.textContent, /REFRESH ATP \/ WTA.*UNLOCK LOCAL CONTRACT \/ POOL/i);
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(snapshot.providerCredentials, false);
  assert.equal(snapshot.executable, false);
  assert.equal(snapshot.secondaryParity.status, "unavailable");
  assert.match(documentRoot.getElementById("sports-events-secondary-status").textContent, /UNAVAILABLE.*NO VERIFIED SECONDARY SOURCE/i);
  assert.match(collectText(documentRoot.getElementById("sports-events-secondary-context")), /NO PARITY REQUEST MADE|UNAVAILABLE/i);
});

test("empty-state refresh is explicit and reveals the local contract/pool handoff only after provider data", async () => {
  const documentRoot = makeDocument();
  const methods = [];
  const consoleView = createSportsEventsConsole({
    documentRoot,
    onRefresh: async ({ method }) => {
      methods.push(method);
      return readyData();
    },
    onOpenContractDraft: () => {},
  });
  const emptyRefresh = documentRoot.getElementById("sports-events-current").children
    .find((child) => child.id === "sports-events-empty-refresh");
  assert.ok(emptyRefresh);
  emptyRefresh.listeners.get("click")();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(methods, ["empty-state"]);
  assert.equal(consoleView.getSnapshot().summary.recordCount, 1);
  assert.ok(
    documentRoot.getElementById("sports-events-current").children
      .some((child) => child.id === "sports-events-current-contract-draft"),
    "the local contract/pool action should appear after an eligible public record returns",
  );
  assert.equal(
    documentRoot.getElementById("sports-events-current").children
      .some((child) => child.id === "sports-events-empty-refresh"),
    false,
  );
});

test("Tennis console supports explicit refresh, selection, replay, and reset", async () => {
  const documentRoot = makeDocument();
  const selected = [];
  const replayed = [];
  const reset = [];
  let refreshCount = 0;
  const consoleView = createSportsEventsConsole({
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
  assert.match(documentRoot.getElementById("sports-events-status").textContent, /READY/);
  assert.equal(documentRoot.getElementById("sports-events-records").children.length, 1);
  const currentText = collectText(documentRoot.getElementById("sports-events-current"));
  assert.match(currentText, /Player One/);
  assert.match(currentText, /RANK SOURCE · ESPN/);
  assert.match(currentText, /FINAL YES.*COMPLETED YES/);
  assert.match(currentText, /SCORES 2\/2 COMPLETE.*DATA A 100%/);
  assert.match(currentText, /SET DATA SUMMARY · 1\/1 COMPLETE/);
  assert.match(currentText, /RESULT RECONCILIATION · INTERNALLY CONSISTENT · CHECKS 5\/5 · CONFLICTS 0/);
  assert.match(currentText, /TIMELINE UNAVAILABLE/);
  assert.match(currentText, /OPEN PLAYER PROFILE · ESPN/);
  const secondaryText = [
    "sports-events-secondary-status",
    "sports-events-secondary-context",
    "sports-events-secondary-fields",
    "sports-events-secondary-boundary",
  ].map((id) => collectText(documentRoot.getElementById(id))).join(" ");
  assert.match(secondaryText, /Independent public tennis source/);
  assert.match(secondaryText, /MATCH match/);
  assert.match(secondaryText, /Player One vs Player Two/);
  assert.match(secondaryText, /UNAVAILABLE/);
  assert.match(secondaryText, /NO PARITY REQUEST MADE/);
  assert.equal(refreshed.secondaryParity.compared, false);
  assert.equal(refreshed.secondaryParity.context.matchId, "match");

  documentRoot.getElementById("sports-events-records").children[0].listeners.get("click")();
  assert.equal(selected.length, 1);
  assert.equal(selected[0].recordId, readyData().records[0].id);
  assert.match(collectText(documentRoot.getElementById("sports-events-current")), /Test Open/);

  const replay = consoleView.replay("test-button");
  assert.equal(replay.externalNetwork, false);
  assert.equal(replayed.length, 1);
  assert.match(collectText(documentRoot.getElementById("sports-events-trace")), /REPLAY/);

  const resetSnapshot = consoleView.reset("test-reset");
  assert.equal(reset.length, 1);
  assert.equal(resetSnapshot.action, "reset");
  assert.equal(consoleView.getSnapshot().trace.length, 0);
  assert.match(collectText(documentRoot.getElementById("sports-events-trace")), /No local inspection/);
});

test("selected public match exposes a local contract and pool handoff", () => {
  const documentRoot = makeDocument();
  const handoffs = [];
  const record = readyData().records[0];
  const consoleView = createSportsEventsConsole({
    documentRoot,
    data: readyData(),
    onOpenContractDraft: (snapshot) => handoffs.push(snapshot),
  });
  const button = documentRoot.getElementById("sports-events-current").children
    .find((child) => child.id === "sports-events-current-contract-draft");
  assert.ok(button, "selected match should expose a local contract/pool action");
  assert.equal(button.dataset.sourceRecordId, record.id);
  assert.equal(button.dataset.sourceUrl, record.sourceUrl);
  assert.match(button.attributes.get("aria-label"), /Player One/);
  button.listeners.get("click")();
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].record.id, readyData().records[0].id);
  assert.equal(handoffs[0].method, "button");
  assert.equal(consoleView.getSnapshot().externalNetwork, false);
});

test("Tennis evidence does not render a placeholder public-source link for an incomplete provider record", () => {
  const documentRoot = makeDocument();
  const base = readyData();
  base.records[0].sourceUrl = "http://example.invalid/not-a-safe-public-source";
  const consoleView = createSportsEventsConsole({ documentRoot, data: base });
  const current = documentRoot.getElementById("sports-events-current");
  const sourceLink = current.children.find((child) => child.className === "sports-events-current-url");
  const unavailable = current.children.find((child) => child.className === "sports-events-current-url-unavailable");
  assert.equal(sourceLink, undefined);
  assert.ok(unavailable);
  assert.match(unavailable.textContent, /PUBLIC ESPN SOURCE UNAVAILABLE.*SAFE HTTPS SOURCE/i);
  assert.equal(consoleView.getSnapshot().selectedRecord.sourceUrl, base.records[0].sourceUrl);
});

test("strict source-return state never falls back to the first provider row", () => {
  const documentRoot = makeDocument();
  const base = readyData();
  const consoleView = createSportsEventsConsole({ documentRoot, data: base });
  const requestedId = base.records[0].id;

  const pending = consoleView.setSourceReturnState({
    requestedRecordId: requestedId,
    state: "pending",
  });
  assert.equal(pending.selectedRecord, null);
  assert.equal(pending.selectedId, null);
  assert.equal(pending.sourceReturn.state, "pending");
  assert.match(collectText(documentRoot.getElementById("sports-events-current")), /RESTORING REQUESTED SOURCE RECORD/i);

  const missing = consoleView.setSourceReturnState({
    requestedRecordId: "espn-tennis:atp:missing-184",
    state: "missing",
    reason: "requested provider record was not returned",
  });
  assert.equal(missing.selectedRecord, null);
  assert.equal(missing.selectedId, null);
  assert.equal(missing.sourceReturn.state, "missing");
  assert.equal(documentRoot.getElementById("sports-events-current").attributes.get("data-source-route-state"), "missing");
  assert.match(collectText(documentRoot.getElementById("sports-events-current")), /SOURCE RECORD NOT RETURNED · NO DATA FABRICATED/i);
  assert.match(documentRoot.getElementById("sports-events-status").textContent, /NO DATA FABRICATED/i);

  // Choosing a real provider-returned row is an explicit user action, not a
  // route fallback; it exits the strict source-return context safely.
  const selected = consoleView.selectRecord(requestedId, "button");
  assert.equal(selected.recordId, requestedId);
  assert.equal(consoleView.getSnapshot().sourceReturn, null);
  assert.equal(consoleView.getSnapshot().selectedRecord.id, requestedId);
});

test("strict source-return match is exact and keeps the local boundary", () => {
  const documentRoot = makeDocument();
  const base = readyData();
  const consoleView = createSportsEventsConsole({ documentRoot, data: base });
  const requestedId = base.records[0].id;
  consoleView.setSourceReturnState({ requestedRecordId: requestedId, state: "pending" });
  const matched = consoleView.setSourceReturnState({ requestedRecordId: requestedId, state: "matched" });
  assert.equal(matched.selectedId, requestedId);
  assert.equal(matched.selectedRecord.id, requestedId);
  assert.equal(matched.sourceReturn.state, "matched");
  assert.equal(matched.localOnly, true);
  assert.equal(matched.executable, false);
  assert.equal(matched.externalNetwork, false);
  assert.equal(documentRoot.getElementById("sports-events-current").attributes.get("data-source-route-state"), "matched");
});

test("strict source-return accepts a safe dotted ESPN-style record id", () => {
  const documentRoot = makeDocument();
  const base = readyData();
  const dottedId = "espn-tennis:atp.123";
  const data = {
    ...base,
    records: base.records.map((record, index) => index === 0 ? { ...record, id: dottedId } : record),
  };
  const handoffs = [];
  const consoleView = createSportsEventsConsole({
    documentRoot,
    data,
    onOpenContractDraft: (snapshot) => handoffs.push(snapshot),
  });

  const matched = consoleView.setSourceReturnState({ requestedRecordId: dottedId, state: "matched" });
  assert.equal(matched.selectedId, dottedId);
  assert.equal(matched.selectedRecord.id, dottedId);
  const draftButton = documentRoot.getElementById("sports-events-current").children
    .find((child) => child.id === "sports-events-current-contract-draft");
  assert.ok(draftButton, "a valid dotted source-return id must retain the local Contract/Pool handoff");
  draftButton.listeners.get("click")?.();
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].record.id, dottedId);
});

test("renderer is presentation-only and keeps timeline and grade boundaries visible", async () => {
  const source = await readFile(new URL("../src/render/sports-events.js", import.meta.url), "utf8");
  assert.match(source, /createSportsEventsConsole/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
  assert.match(source, /POINT-BY-POINT TIMELINE UNAVAILABLE/);
  assert.match(source, /DATA COMPLETENESS/);
  assert.match(source, /createSecondaryParityStatus/);
  assert.match(source, /NO VERIFIED SECONDARY SOURCE/);
  assert.match(source, /OPEN LOCAL CONTRACT \/ POOL REHEARSAL/);
  assert.deepEqual(createUnavailableSportsEvents({ retrievedAt: "2026-08-27T12:00:00.000Z" }).records, []);
});

test("renderer exposes explicit provider-detail inspection and keeps the result local", async () => {
  const documentRoot = makeDocument();
  const base = readyData();
  const record = base.records[0];
  let inspected = 0;
  const consoleView = createSportsEventsConsole({
    documentRoot,
    data: base,
    onInspect: async ({ record: selected, method }) => {
      inspected += 1;
      assert.equal(selected.id, record.id);
      assert.equal(method, "button");
      return {
        status: "ready",
        requestStatus: "available",
        requestCount: 2,
        timelineSources: [{ kind: "play-by-play", available: true, pointCount: 1 }],
        liveFetch: true,
        externalNetwork: true,
        record: {
          ...selected,
          timeline: {
            status: "available",
            available: true,
            reason: null,
            points: [{ index: 1, kind: "point", set: 1, game: 1, point: 1, text: "Player One wins the point", score: "15-0" }],
          },
          timelineStatus: "available",
          timelineRequestStatus: "available",
          timelineRequestReason: null,
          publicDetail: {
            status: "available",
            sourceUrl: "https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/events/test/competitions/match",
            commentaryAvailable: true,
            liveAvailable: true,
            requestCount: 2,
            notes: ["Provider note"],
          },
          truthClaim: false,
          executable: false,
        },
      };
    },
  });
  const button = documentRoot.getElementById("sports-events-current").children.find((child) => child.id === "sports-events-current-detail");
  assert.ok(button, "selected match should expose a provider-detail button");
  button.listeners.get("click")();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(inspected, 1);
  const snapshot = consoleView.getSnapshot();
  assert.equal(snapshot.selectedRecord.publicDetail.status, "available");
  assert.equal(snapshot.selectedRecord.timelineStatus, "available");
  assert.equal(snapshot.selectedRecord.timeline.points.length, 1);
  assert.equal(snapshot.summary.timelineAvailableCount, 1);
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(snapshot.liveFetch, true);
  const currentText = collectText(documentRoot.getElementById("sports-events-current"));
  assert.match(currentText, /PROVIDER DETAIL.*AVAILABLE/);
  assert.match(currentText, /COMMENTARY AVAILABLE/);
  assert.match(currentText, /PROVIDER NOTE/);
  assert.match(currentText, /OPEN PROVIDER DETAIL SOURCE · ESPN/);
  const detailSourceLink = documentRoot.getElementById("sports-events-current").children
    .find((child) => child.className === "sports-events-current-detail-source");
  assert.ok(detailSourceLink, "the returned provider detail document should be inspectable without another fetch");
  assert.equal(detailSourceLink.href, "https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/events/test/competitions/match");
  assert.equal(detailSourceLink.target, "_blank");
  assert.equal(detailSourceLink.rel, "noopener noreferrer");
  assert.match(currentText, /POINT-BY-POINT TIMELINE.*1 POINT/);
  assert.match(collectText(documentRoot.getElementById("sports-events-trace")), /INSPECT-DETAIL/);
});
