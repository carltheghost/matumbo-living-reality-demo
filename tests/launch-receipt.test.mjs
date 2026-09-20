import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import {
  DEFAULT_LAUNCH_REHEARSAL_RECEIPT,
  LAUNCH_RECEIPT_BOUNDARY,
  LAUNCH_RECEIPT_CONSOLE_SOURCE,
  LAUNCH_RECEIPT_DOM_IDS,
  LAUNCH_RECEIPT_DOWNLOAD_FILENAME,
  LAUNCH_RECEIPT_SEQUENCE,
  LAUNCH_RECEIPT_SOURCE,
  createLaunchReceiptConsole,
  createLaunchRehearsalReceipt,
  serializeLaunchRehearsalReceipt,
  summarizeLaunchRehearsalReceipt,
  validateLaunchRehearsalReceipt,
} from "../src/render/launch-receipt.js";

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
    clickCount: 0,
    classList: { toggle() {} },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    click() { this.clickCount += 1; },
    focus() {},
  };
}

function makeDocument() {
  const elements = new Map();
  const createdElements = [];
  const documentRoot = {
    createElement(tag) { const element = makeElement(documentRoot, tag); createdElements.push(element); return element; },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  Object.entries(LAUNCH_RECEIPT_DOM_IDS).forEach(([key, id]) => {
    const element = makeElement(documentRoot, key === "json" ? "pre" : "div");
    element.id = id;
    element.hidden = key === "panel";
    elements.set(id, element);
  });
  documentRoot.createdElements = createdElements;
  return documentRoot;
}

test("launch rehearsal receipt is a deterministic exact fixed-supply summary", () => {
  const projection = createLivingRealityProjection().world;
  const first = createLaunchRehearsalReceipt(projection);
  const second = createLaunchRehearsalReceipt(createLivingRealityProjection().world);
  assert.deepEqual(second, first);
  assert.equal(first.source, LAUNCH_RECEIPT_SOURCE);
  assert.equal(first.cohortCount, 18);
  assert.equal(first.cohorts.length, 18);
  assert.equal(first.allocationTotals.totalBasisPoints, 10_000);
  assert.equal(first.allocationTotals.expectedBasisPoints, 10_000);
  assert.equal(first.allocationTotals.totalTokenUnits, 1_000_000_000);
  assert.equal(first.allocationTotals.expectedTokenUnits, 1_000_000_000);
  assert.equal(first.allocationTotals.exact, true);
  assert.equal(first.reconciliation.exact, true);
  assert.deepEqual(first.reconciliation.basisPoints, { actual: 10_000, expected: 10_000, delta: 0, exact: true });
  assert.deepEqual(first.reconciliation.tokenUnits, { actual: 1_000_000_000, expected: 1_000_000_000, delta: 0, exact: true });
  assert.equal(first.cohorts.every((cohort) => cohort.simulation && cohort.fictional && cohort.aggregate && !cohort.executable), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.cohorts), true);
  assert.equal(Object.isFrozen(first.cohorts[0]), true);
  assert.equal(summarizeLaunchRehearsalReceipt(projection).receiptId, first.receiptId);
  assert.equal(DEFAULT_LAUNCH_REHEARSAL_RECEIPT.receiptId, first.receiptId);
});

test("receipt serialization round-trips and validation catches tampering", () => {
  const receipt = createLaunchRehearsalReceipt(createLivingRealityProjection().world);
  const serialized = serializeLaunchRehearsalReceipt(receipt);
  const valid = validateLaunchRehearsalReceipt(serialized);
  assert.equal(valid.valid, true);
  assert.equal(valid.cohortCount, 18);
  assert.equal(valid.totalBasisPoints, 10_000);
  assert.equal(valid.totalTokenUnits, 1_000_000_000);
  assert.equal(valid.exact, true);
  assert.equal(Object.isFrozen(valid), true);
  assert.equal(Object.isFrozen(valid.receipt), true);

  const tampered = JSON.parse(serialized);
  tampered.cohorts[0].tokenUnits += 1;
  const rejected = validateLaunchRehearsalReceipt(tampered);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.errors.some((error) => error.code === "receipt-mismatch"), true);
  assert.equal(rejected.receipt, null);
  assert.equal(rejected.externalDistribution, false);
  assert.equal(rejected.executable, false);
});

test("receipt validator rejects executable-looking, cyclic, and getter-backed input without invoking it", () => {
  let called = false;
  const hostile = { ...DEFAULT_LAUNCH_REHEARSAL_RECEIPT, execute: () => { called = true; } };
  const hostileResult = validateLaunchRehearsalReceipt(hostile);
  assert.equal(hostileResult.valid, false);
  assert.equal(hostileResult.errors.some((error) => error.code === "forbidden-field"), true);
  assert.equal(called, false);

  let getterCalled = false;
  const getterFixture = JSON.parse(serializeLaunchRehearsalReceipt(DEFAULT_LAUNCH_REHEARSAL_RECEIPT));
  Object.defineProperty(getterFixture, "script", {
    enumerable: true,
    get() { getterCalled = true; return "alert(1)"; },
  });
  const getterResult = validateLaunchRehearsalReceipt(getterFixture);
  assert.equal(getterResult.valid, false);
  assert.equal(getterCalled, false);

  const cyclic = JSON.parse(serializeLaunchRehearsalReceipt(DEFAULT_LAUNCH_REHEARSAL_RECEIPT));
  cyclic.self = cyclic;
  const cyclicResult = validateLaunchRehearsalReceipt(cyclic);
  assert.equal(cyclicResult.valid, false);
  assert.equal(cyclicResult.errors.some((error) => error.code === "cyclic-value"), true);
  assert.equal(cyclicResult.externalNetwork, false);
  assert.equal(cyclicResult.persistence, false);
});

test("receipt console selects, replays, serializes, and resets in memory", () => {
  const projection = createLivingRealityProjection().world;
  const before = JSON.stringify(projection);
  const callbacks = [];
  const adapter = createLaunchReceiptConsole({
    documentRoot: makeDocument(),
    projection,
    onSelect: (snapshot) => callbacks.push(snapshot),
    onReplay: (snapshot) => callbacks.push(snapshot),
    onReset: (snapshot) => callbacks.push(snapshot),
  });
  assert.equal(adapter.getSnapshot().source, LAUNCH_RECEIPT_CONSOLE_SOURCE);
  assert.equal(adapter.getSnapshot().opened, false);
  const selected = adapter.selectCohort(adapter.getSnapshot().receipt.cohorts[4].id, "test");
  assert.equal(selected.action, "select");
  assert.equal(selected.cohortId, adapter.getSnapshot().selectedId);
  const replay = adapter.replay("test");
  assert.deepEqual(replay.sequence, LAUNCH_RECEIPT_SEQUENCE);
  assert.equal(replay.replayCount, 1);
  assert.equal(replay.externalTransfer, false);
  assert.equal(replay.exchange, false);
  assert.equal(adapter.serialize().includes('"receiptId"'), true);
  const reset = adapter.reset("test");
  assert.equal(reset.action, "reset");
  assert.equal(adapter.getSnapshot().trace.length, 0);
  assert.equal(adapter.getSnapshot().replayCount, 0);
  assert.equal(callbacks.map((entry) => entry.action).join(","), "select,replay,reset");
  assert.equal(callbacks.every((entry) => entry.localOnly && entry.simulation && !entry.externalNetwork && !entry.executable), true);
  assert.equal(JSON.stringify(projection), before);
  assert.equal(adapter.getSnapshot().boundary, LAUNCH_RECEIPT_BOUNDARY);
});

test("receipt console downloads a validated local JSON payload and revokes its object URL", () => {
  const projection = createLivingRealityProjection().world;
  const documentRoot = makeDocument();
  const objectUrls = [];
  const revokedUrls = [];
  class FakeBlob {
    constructor(parts, options) { this.parts = parts; this.type = options?.type; }
  }
  documentRoot.defaultView = {
    Blob: FakeBlob,
    URL: {
      createObjectURL(blob) { objectUrls.push(blob); return "blob:local-rehearsal"; },
      revokeObjectURL(url) { revokedUrls.push(url); },
    },
    setTimeout(callback) { callback(); return 1; },
  };
  const callbacks = [];
  const adapter = createLaunchReceiptConsole({ documentRoot, projection, onDownload: (snapshot) => callbacks.push(snapshot) });
  const result = adapter.download("test");
  const anchor = documentRoot.createdElements.find((element) => element.tagName === "A");
  assert.equal(result.action, "download");
  assert.equal(result.status, "downloaded");
  assert.equal(result.validated, true);
  assert.equal(result.filename, LAUNCH_RECEIPT_DOWNLOAD_FILENAME);
  assert.equal(result.bytes, adapter.serialize().length);
  assert.equal(result.localOnly, true);
  assert.equal(result.externalNetwork, false);
  assert.equal(result.externalDistribution, false);
  assert.equal(result.persistence, false);
  assert.equal(result.executable, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(anchor?.clickCount, 1);
  assert.equal(objectUrls.length, 1);
  assert.deepEqual(revokedUrls, ["blob:local-rehearsal"]);
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].status, "downloaded");
  assert.equal(adapter.getSnapshot().lastDownload.status, "downloaded");
  assert.equal(adapter.getSnapshot().trace[0].action, "download");
});

test("receipt console reports a graceful local fallback when browser download APIs are unavailable", () => {
  const documentRoot = makeDocument();
  documentRoot.defaultView = {};
  const adapter = createLaunchReceiptConsole({ documentRoot });
  const result = adapter.download("test");
  assert.equal(result.action, "download");
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "browser-download-unavailable");
  assert.equal(result.validated, true);
  assert.equal(result.bytes, 0);
  assert.equal(documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.status).textContent, "DOWNLOAD UNAVAILABLE · SAVE JSON MANUALLY");
  assert.match(documentRoot.getElementById(LAUNCH_RECEIPT_DOM_IDS.json).textContent, /receiptId/);
  assert.equal(adapter.getSnapshot().trace[0].status, "unavailable");
});

test("receipt source and docs declare a local-only, no-execution boundary", async () => {
  const source = await readFile(new URL("../src/render/launch-receipt.js", import.meta.url), "utf8");
  const docs = await readFile(new URL("../docs/LAUNCH_REHEARSAL_RECEIPT.md", import.meta.url), "utf8");
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of Object.values(LAUNCH_RECEIPT_DOM_IDS)) assert.match(source, new RegExp(id));
  for (const flag of ["realIssuance", "externalDistribution", "custody", "signing", "externalTransfer", "exchange", "persistence", "externalNetwork", "executable"]) assert.match(source, new RegExp(flag));
  assert.match(source, /LAUNCH_RECEIPT_DOWNLOAD_FILENAME/);
  assert.match(source, /createObjectURL/);
  assert.match(source, /revokeObjectURL/);
  assert.match(index, /id="launch-receipt-download"/);
  assert.match(index, /Download JSON/);
  assert.match(source, /JSON\.parse/);
  assert.match(source, /forbidden-field/);
  assert.doesNotMatch(source, /\beval\s*\(/i);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /navigator\.clipboard/i);
  assert.doesNotMatch(source, /navigator\.share/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.match(docs, /TUMBO-SIM/);
  assert.match(docs, /10,000/);
  assert.match(docs, /no real issuance/i);
  assert.match(docs, /no filesystem import/i);
});
