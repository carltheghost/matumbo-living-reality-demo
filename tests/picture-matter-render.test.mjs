import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import { MATTER_FORGE_SOURCE } from "../src/domains/matter-forge.js";
import {
  PICTURE_MATTER_CONSOLE_SOURCE,
  createPictureMatterConsole,
  summarizePictureMatter,
} from "../src/render/picture-matter.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    value: "",
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
    ["picture-matter-console", true],
    ["picture-matter-console-close"],
    ["picture-matter-console-replay"],
    ["picture-matter-console-reset"],
    ["picture-matter-console-status"],
    ["picture-matter-console-summary"],
    ["picture-matter-console-current"],
    ["picture-matter-console-path-toggle"],
    ["picture-matter-console-path-status"],
    ["picture-matter-console-path", true],
    ["picture-matter-console-metadata-query"],
    ["picture-matter-console-metadata-refresh"],
    ["picture-matter-console-metadata-status"],
    ["picture-matter-console-metadata-summary"],
    ["picture-matter-console-metadata-records"],
    ["picture-matter-console-metadata-boundary"],
    ["picture-matter-console-words"],
    ["picture-matter-console-statements"],
    ["picture-matter-console-provenance"],
    ["picture-matter-console-trace"],
    ["picture-matter-console-boundary"],
  ].forEach(([id, hidden]) => {
    const element = makeElement(documentRoot);
    element.id = id;
    element.hidden = hidden === true;
    elements.set(id, element);
  });
  return documentRoot;
}

test("Picture Matter summary joins word objects to statements and provenance", () => {
  const summary = summarizePictureMatter(createLivingRealityProjection().world);
  assert.equal(summary.source, MATTER_FORGE_SOURCE);
  assert.equal(summary.inputCount, 1);
  assert.equal(summary.wordCount, 1);
  assert.equal(summary.localImageCount, 0);
  assert.equal(summary.statementCount, 1);
  assert.equal(summary.provenanceCount, 2);
  assert.equal(summary.wordObjects[0].word, "reality");
  assert.deepEqual(summary.wordObjects[0].linkedStatementIds, ["statement:reality"]);
  assert.equal(summary.wordObjects[0].linkedStatements[0].text.includes("meaning spatial"), true);
  assert.equal(summary.statements[0].inputLabel, "reality");
  assert.equal(summary.statements[0].provenance.source, "local-fixture");
  assert.equal(summary.provenance[0].truthAuthority, "none");
  assert.equal(summary.localOnly, true);
  assert.equal(summary.externalImageFetch, false);
  assert.equal(summary.externalPublishing, false);
  assert.equal(summary.truthDetermination, false);
  assert.equal(summary.assertedTruth, false);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.wordObjects[0].linkedStatements[0]), true);
});

test("Picture Matter console inspects word → statement → provenance locally and resets", () => {
  const projection = createLivingRealityProjection().world;
  const before = JSON.stringify(projection);
  const documentRoot = makeDocument();
  const callbacks = [];
  const adapter = createPictureMatterConsole({
    documentRoot,
    projection,
    onSelect: (snapshot) => callbacks.push(snapshot),
    onReplay: (snapshot) => callbacks.push(snapshot),
    onReset: (snapshot) => callbacks.push(snapshot),
  });

  assert.equal(adapter.getSnapshot().opened, false);
  adapter.open();
  assert.equal(adapter.getSnapshot().opened, true);

  const selectedWord = adapter.selectWord("matter:word:reality", "test");
  assert.equal(selectedWord.source, PICTURE_MATTER_CONSOLE_SOURCE);
  assert.equal(selectedWord.recordType, "input");
  assert.equal(selectedWord.record.displayLabel, "reality");
  assert.equal(selectedWord.linkedStatements[0].id, "statement:reality");
  assert.equal(selectedWord.linkedProvenance.length, 2);

  const selectedStatement = adapter.selectStatement("statement:reality", "test");
  assert.equal(selectedStatement.input.id, "matter:word:reality");
  assert.equal(selectedStatement.linkedProvenance[1].entityId, "statement:reality");

  const provenanceId = selectedStatement.linkedProvenance[1].id;
  const selectedProvenance = adapter.selectProvenance(provenanceId, "test");
  assert.equal(selectedProvenance.recordType, "provenance");
  assert.equal(selectedProvenance.record.entityId, "statement:reality");

  const replay = adapter.replay("test");
  assert.equal(replay.action, "replay");
  assert.deepEqual(replay.sequence, ["word", "statement", "provenance"]);
  assert.deepEqual(replay.path.statementIds, ["statement:reality"]);
  assert.equal(replay.path.provenanceIds.length, 1);
  assert.equal(replay.replayedRecordCount, 2);

  adapter.reset("test");
  assert.equal(adapter.getSnapshot().selectedType, "input");
  assert.equal(adapter.getSnapshot().selectedId, "matter:word:reality");
  assert.equal(adapter.getSnapshot().trace.length, 0);
  assert.equal(callbacks.map((item) => item.action).join(","), "select,select,select,replay,reset");
  assert.equal(callbacks.every((item) => item.localOnly === true && item.simulation === true), true);
  assert.equal(callbacks.every((item) => item.externalNetwork === false && item.externalPublishing === false), true);
  assert.equal(callbacks.every((item) => item.truthDetermination === false && item.executable === false), true);
  assert.equal(JSON.stringify(projection), before);
});

test("Picture Matter expands a deterministic nested word → statement → provenance path", () => {
  const documentRoot = makeDocument();
  const pathToggle = documentRoot.getElementById("picture-matter-console-path-toggle");
  const pathStatus = documentRoot.getElementById("picture-matter-console-path-status");
  const pathEl = documentRoot.getElementById("picture-matter-console-path");
  const pathCallbacks = [];
  const adapter = createPictureMatterConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onPathToggle: (snapshot) => pathCallbacks.push(snapshot),
  });

  assert.equal(adapter.getSnapshot().pathExpanded, false);
  assert.equal(pathToggle.textContent, "Expand meaning path");
  assert.equal(pathToggle.attributes.get("aria-expanded"), "false");
  assert.equal(pathEl.hidden, true);

  const expanded = adapter.togglePath("test");
  assert.equal(expanded.action, "expand-path");
  assert.equal(expanded.expanded, true);
  assert.equal(expanded.path.expanded, true);
  assert.equal(expanded.path.sequence.join(" → "), "word → statement → provenance");
  assert.equal(expanded.path.input.id, "matter:word:reality");
  assert.equal(expanded.path.statements[0].id, "statement:reality");
  assert.equal(expanded.path.statements[0].truthStatus, "not-applicable");
  assert.equal(expanded.path.statements[0].provenance.source, "local-fixture");
  assert.equal(expanded.path.provenance[0].source, "local-fixture");
  assert.equal(expanded.path.provenance[0].truthAuthority, "none");
  assert.equal(expanded.path.provenance[0].entityLabel, "reality");
  assert.equal(expanded.path.provenance[0].entityKind, "word object");
  assert.equal(expanded.path.provenance[1].entityLabel.includes("local projection"), true);
  assert.equal(expanded.path.provenance[1].entityKind, "interpretation");
  assert.equal(Object.isFrozen(expanded), true);
  assert.equal(Object.isFrozen(expanded.path), true);
  assert.equal(Object.isFrozen(expanded.path.statements[0]), true);
  assert.equal(pathToggle.textContent, "Collapse meaning path");
  assert.equal(pathToggle.attributes.get("aria-expanded"), "true");
  assert.equal(pathEl.hidden, false);
  assert.equal(pathEl.children.length, 3);
  assert.equal(pathStatus.textContent.includes("PATH OPEN"), true);
  assert.equal(adapter.getSnapshot().pathVisible, true);

  const collapsed = adapter.togglePath("test");
  assert.equal(collapsed.action, "collapse-path");
  assert.equal(collapsed.expanded, false);
  assert.equal(collapsed.path.expanded, false);
  assert.equal(pathToggle.textContent, "Expand meaning path");
  assert.equal(pathToggle.attributes.get("aria-expanded"), "false");
  assert.equal(pathEl.hidden, true);
  assert.equal(adapter.getSnapshot().pathVisible, false);
  assert.deepEqual(pathCallbacks.map((snapshot) => snapshot.action), ["expand-path", "collapse-path"]);
  assert.equal(pathCallbacks.every((snapshot) => snapshot.localOnly && snapshot.simulation && !snapshot.externalNetwork), true);
});

test("Picture Matter metadata rail refreshes through the host and never creates image nodes", async () => {
  const documentRoot = makeDocument();
  const metadataStatus = documentRoot.getElementById("picture-matter-console-metadata-status");
  const metadataSummary = documentRoot.getElementById("picture-matter-console-metadata-summary");
  const metadataRecords = documentRoot.getElementById("picture-matter-console-metadata-records");
  const metadataQuery = documentRoot.getElementById("picture-matter-console-metadata-query");
  const refreshCalls = [];
  const adapter = createPictureMatterConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onMetadataRefresh: async (request) => {
      refreshCalls.push(request);
      return Object.freeze({
        schemaVersion: 1,
        source: "picture-matter-wikimedia-metadata",
        provider: "Wikimedia Commons",
        endpoint: "https://commons.wikimedia.org/w/api.php",
        query: request.query,
        requestedLimit: request.limit,
        retrievedAt: "2026-08-28T12:06:00Z",
        status: "ready",
        providerAvailable: true,
        records: [Object.freeze({
          id: "wikimedia-commons:page:101",
          title: "File:Reality sample.jpg",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Reality_sample.jpg",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/r/reality/320px-Reality.jpg",
          mime: "image/jpeg",
          width: 640,
          height: 480,
          sizeBytes: 2048,
          providerTimestamp: "2026-08-28T12:00:00Z",
        })],
        boundary: "Metadata only; no image bytes.",
        externalNetwork: true,
      });
    },
  });
  assert.match(metadataStatus.textContent, /UNAVAILABLE/);
  assert.match(metadataSummary.textContent, /RETURNED/);
  assert.equal(metadataRecords.children.length, 1);
  assert.equal(metadataRecords.children[0].className, "picture-matter-console-empty");

  metadataQuery.value = "lens";
  await adapter.refreshMetadata("test");
  assert.deepEqual(refreshCalls, [{ query: "lens", limit: 3, method: "test" }]);
  assert.match(metadataStatus.textContent, /READY/);
  assert.match(metadataSummary.textContent, /QUERY · lens/);
  assert.match(metadataSummary.textContent, /RETURNED · 1\/3/);
  assert.equal(metadataRecords.children.length, 1);
  assert.equal(metadataRecords.children[0].tagName, "ARTICLE");
  assert.equal(metadataRecords.children[0].children.some((child) => child.tagName === "IMG"), false);
  assert.equal(adapter.getSnapshot().metadata.status, "ready");
  assert.equal(adapter.getSnapshot().metadata.metadataOnly, true);
  assert.equal(adapter.getSnapshot().metadata.imageBytesFetched, false);
  assert.equal(adapter.getSnapshot().metadataExternalNetwork, true);

  adapter.setMetadataQuery("  war   conflict  ");
  assert.equal(metadataQuery.value, "war conflict");
});

test("Picture Matter renderer declares local-only mount points and no network path", async () => {
  const source = await readFile(new URL("../src/render/picture-matter.js", import.meta.url), "utf8");
  for (const id of [
    "picture-matter-console",
    "picture-matter-console-close",
    "picture-matter-console-replay",
    "picture-matter-console-reset",
    "picture-matter-console-status",
    "picture-matter-console-summary",
    "picture-matter-console-current",
    "picture-matter-console-path-toggle",
    "picture-matter-console-path-status",
    "picture-matter-console-path",
    "picture-matter-console-metadata-query",
    "picture-matter-console-metadata-refresh",
    "picture-matter-console-metadata-status",
    "picture-matter-console-metadata-summary",
    "picture-matter-console-metadata-records",
    "picture-matter-console-metadata-boundary",
    "picture-matter-console-words",
    "picture-matter-console-statements",
    "picture-matter-console-provenance",
    "picture-matter-console-trace",
    "picture-matter-console-boundary",
  ]) assert.match(source, new RegExp(id));
  assert.match(source, /function selectWord\(/);
  assert.match(source, /function selectStatement\(/);
  assert.match(source, /function selectProvenance\(/);
  assert.match(source, /function replay\(/);
  assert.match(source, /function togglePath\(/);
  assert.match(source, /function setPathExpanded\(/);
  assert.match(source, /pathDetailsFor/);
  assert.match(source, /function refreshMetadata\(/);
  assert.match(source, /function setMetadata\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /navigator\.sendBeacon/i);
  assert.doesNotMatch(source, /truthAuthority\s*:\s*["'](?:local|verified|authoritative)/i);
});
