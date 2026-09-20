import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_LAUNCH_KIT, LAUNCH_KIT_DOWNLOAD_FILENAME } from "../src/domains/launch-kit.js";
import {
  LAUNCH_KIT_BOUNDARY,
  LAUNCH_KIT_CONSOLE_SOURCE,
  LAUNCH_KIT_DOM_IDS,
  LAUNCH_KIT_LIVE_STATUS_ROUTE_COPY,
  LAUNCH_KIT_LIVE_STATUS_ROUTE_QUERY,
  LAUNCH_KIT_LOCAL_ROUTE_QUERY,
  buildLaunchKitLocalRoute,
  createLaunchKitConsole,
} from "../src/render/launch-kit.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    dataset: {},
    hidden: false,
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
  Object.entries(LAUNCH_KIT_DOM_IDS).forEach(([key, id]) => {
    const element = makeElement(documentRoot, key === "json" ? "pre" : "div");
    element.id = id;
    element.hidden = key === "panel";
    elements.set(id, element);
  });
  documentRoot.createdElements = createdElements;
  return documentRoot;
}

test("Launch Kit console renders the complete local directory and catalog", () => {
  const documentRoot = makeDocument();
  const adapter = createLaunchKitConsole({
    documentRoot,
    windowLike: { location: { origin: "http://localhost:8080", pathname: "/" } },
  });
  const snapshot = adapter.getSnapshot();
  assert.equal(snapshot.source, LAUNCH_KIT_CONSOLE_SOURCE);
  assert.equal(snapshot.opened, false);
  assert.equal(snapshot.summary.featureCount, 23);
  assert.equal(snapshot.summary.allocationCount, 8);
  assert.equal(snapshot.summary.registryCount, 18);
  assert.equal(snapshot.summary.migrationCount, 6);
  assert.equal(snapshot.summary.socialActionCount, 4);
  assert.equal(documentRoot.getElementById(LAUNCH_KIT_DOM_IDS.routes).children.length, 23);
  assert.equal(documentRoot.getElementById(LAUNCH_KIT_DOM_IDS.token).children.length, 6);
  assert.match(
    documentRoot.getElementById(LAUNCH_KIT_DOM_IDS.token).children[0].children.map((child) => child.textContent).join(" "),
    /TUMBO Asset Token/i,
  );
  assert.match(
    documentRoot.getElementById(LAUNCH_KIT_DOM_IDS.token).children[3].children.map((child) => child.textContent).join(" "),
    /verified/i,
  );
  assert.match(documentRoot.getElementById(LAUNCH_KIT_DOM_IDS.json).textContent, /launch-kit:tumbo-space-explorer-v1/);
  assert.match(documentRoot.getElementById(LAUNCH_KIT_DOM_IDS.boundary).textContent, /no recipient/i);
  assert.equal(snapshot.localLaunchRoute, `http://localhost:8080/${LAUNCH_KIT_LOCAL_ROUTE_QUERY}`);
  assert.equal(LAUNCH_KIT_LOCAL_ROUTE_QUERY, LAUNCH_KIT_LIVE_STATUS_ROUTE_QUERY);
  assert.equal(snapshot.liveStatusRoute, true);
  assert.equal(snapshot.liveStatusRefresh, "opt-in-on-open");
  assert.match(snapshot.localLaunchRoute, /panel=live-status&live=all/);
  assert.equal(snapshot.copyStatus, "manual");
  assert.equal(documentRoot.getElementById(LAUNCH_KIT_DOM_IDS.shareUrl).value, snapshot.localLaunchRoute);
  assert.match(documentRoot.getElementById(LAUNCH_KIT_DOM_IDS.copyStatus).textContent, /LINK VISIBLE · COPY MANUALLY/);
});

test("Launch Kit local route generation is deterministic and ignores current query state", () => {
  const first = buildLaunchKitLocalRoute({
    location: {
      origin: "http://localhost:8080/",
      pathname: "/index.html",
      search: "?feature=arena&panel=old",
      hash: "#stale",
    },
  });
  const second = buildLaunchKitLocalRoute({
    location: { origin: "http://localhost:8080", pathname: "/index.html", search: "?anything=else" },
  });
  assert.equal(first, `http://localhost:8080/index.html${LAUNCH_KIT_LOCAL_ROUTE_QUERY}`);
  assert.equal(second, first);
  assert.equal(buildLaunchKitLocalRoute({ location: { pathname: "index.html" } }), `/index.html${LAUNCH_KIT_LOCAL_ROUTE_QUERY}`);
});

test("Launch Kit share route carries the current release freshness stamp", () => {
  assert.match(LAUNCH_KIT_LIVE_STATUS_ROUTE_QUERY, /fresh=20260903-reality-lens/);
  assert.doesNotMatch(LAUNCH_KIT_LIVE_STATUS_ROUTE_QUERY, /fresh=20260903(?:&|$)/);
  assert.doesNotMatch(LAUNCH_KIT_LIVE_STATUS_ROUTE_QUERY, /fresh=20260828/);
});

test("Launch Kit markup exposes a selectable local route and explicit copy status", () => {
  const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(markup, /id="launch-kit-share-url"[^>]*readonly/i);
  assert.match(markup, /id="launch-kit-copy-link"[^>]*>Copy live status link</i);
  assert.match(markup, /Live status link · 7 public sources · refresh once on open/i);
  assert.match(markup, /live=all query performs one opt-in public refresh on open/i);
  assert.doesNotMatch(markup, /cube-first Portal/);
  assert.match(markup, /id="launch-kit-reset"[^>]*>Reset</i);
  assert.match(markup, /id="launch-kit-copy-status"[^>]*role="status"/i);
  assert.doesNotMatch(markup, /navigator\.share/i);
});

test("Launch Kit route directory stays above later catalog sections for pointer handoffs", () => {
  const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const rule = markup.match(/#launch-kit-routes\{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /position:relative/);
  assert.match(rule, /z-index:2/);
  assert.match(rule, /isolation:isolate/);
});

test("Launch Kit routes are frozen local hand-offs and replay is deterministic", () => {
  const documentRoot = makeDocument();
  const routes = [];
  const replays = [];
  const adapter = createLaunchKitConsole({ documentRoot, onRoute: (value) => routes.push(value), onReplay: (value) => replays.push(value) });
  const selected = adapter.selectRoute("arena", "test");
  assert.equal(selected.featureId, "arena");
  assert.equal(selected.route, "?feature=arena");
  assert.equal(selected.localOnly, true);
  assert.equal(selected.externalNetwork, false);
  assert.equal(Object.isFrozen(selected), true);
  const replay = adapter.replay("test");
  assert.equal(replay.action, "replay");
  assert.equal(replay.replayCount, 1);
  assert.equal(Object.isFrozen(replay), true);
  assert.equal(routes.length, 1);
  assert.equal(replays.length, 1);
  assert.equal(adapter.getSnapshot().boundary, LAUNCH_KIT_BOUNDARY);
});

test("Launch Kit Local Cube Sync route is an explicit panel handoff", () => {
  const documentRoot = makeDocument();
  const routes = [];
  const adapter = createLaunchKitConsole({ documentRoot, onRoute: (value) => routes.push(value) });
  const selected = adapter.selectRoute("runtime-sync", "test");
  assert.equal(selected.featureId, "runtime-sync");
  assert.equal(selected.label, "Local Cube Sync");
  assert.equal(selected.route, "?panel=runtime-sync");
  assert.equal(selected.localOnly, true);
  assert.equal(selected.externalNetwork, false);
  assert.equal(routes.length, 1);
});

test("Launch Kit downloads validated JSON and revokes its object URL", () => {
  const documentRoot = makeDocument();
  const objectUrls = [];
  const revoked = [];
  class FakeBlob { constructor(parts, options) { this.parts = parts; this.type = options?.type; } }
  documentRoot.defaultView = {
    Blob: FakeBlob,
    URL: { createObjectURL(blob) { objectUrls.push(blob); return "blob:launch-kit"; }, revokeObjectURL(url) { revoked.push(url); } },
    setTimeout(callback) { callback(); return 1; },
  };
  const callbacks = [];
  const adapter = createLaunchKitConsole({ documentRoot, onDownload: (value) => callbacks.push(value) });
  const result = adapter.download("test");
  const anchor = documentRoot.createdElements.find((element) => element.tagName === "A");
  assert.equal(result.status, "downloaded");
  assert.equal(result.filename, LAUNCH_KIT_DOWNLOAD_FILENAME);
  assert.equal(result.validated, true);
  assert.equal(result.bytes, adapter.serialize().length);
  assert.equal(anchor?.clickCount, 1);
  assert.equal(objectUrls.length, 1);
  assert.deepEqual(revoked, ["blob:launch-kit"]);
  assert.equal(callbacks.length, 1);
});

test("Launch Kit reports a graceful browser-download fallback", () => {
  const documentRoot = makeDocument();
  documentRoot.defaultView = {};
  const adapter = createLaunchKitConsole({ documentRoot });
  const result = adapter.download("test");
  assert.equal(result.status, "unavailable");
  assert.equal(result.validated, true);
  assert.equal(result.bytes, 0);
  assert.match(documentRoot.getElementById(LAUNCH_KIT_DOM_IDS.status).textContent, /DOWNLOAD UNAVAILABLE/);
});

test("Launch Kit copies the local link only on explicit request and reports success", async () => {
  const documentRoot = makeDocument();
  const copied = [];
  const callbacks = [];
  const adapter = createLaunchKitConsole({
    documentRoot,
    windowLike: {
      location: { origin: "http://localhost:8080", pathname: "/" },
      navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
    },
    onCopy: (value) => callbacks.push(value),
  });
  assert.deepEqual(copied, [], "clipboard must not be touched during initial render");
  const result = await adapter.copyLocalLink("test");
  assert.equal(result.status, "copied");
  assert.equal(result.copied, true);
  assert.equal(result.route, adapter.getSnapshot().localLaunchRoute);
  assert.deepEqual(copied, [adapter.getSnapshot().localLaunchRoute]);
  assert.equal(callbacks.length, 1);
  assert.equal(documentRoot.getElementById(LAUNCH_KIT_DOM_IDS.copyStatus).textContent, "LINK COPIED · LOCAL ONLY");
  assert.equal(Object.isFrozen(result), true);
});

test("Launch Kit keeps the URL selectable when clipboard is unavailable or rejects", async () => {
  const noClipboardDocument = makeDocument();
  const noClipboard = createLaunchKitConsole({
    documentRoot: noClipboardDocument,
    windowLike: { location: { origin: "http://localhost:8080", pathname: "/" } },
  });
  const manual = await noClipboard.copyLocalLink("test");
  assert.equal(manual.status, "manual");
  assert.match(noClipboardDocument.getElementById(LAUNCH_KIT_DOM_IDS.copyStatus).textContent, /LINK VISIBLE · COPY MANUALLY/);
  assert.equal(noClipboardDocument.getElementById(LAUNCH_KIT_DOM_IDS.shareUrl).value, noClipboard.getSnapshot().localLaunchRoute);

  const rejectedDocument = makeDocument();
  const rejected = createLaunchKitConsole({
    documentRoot: rejectedDocument,
    windowLike: {
      location: { origin: "http://localhost:8080", pathname: "/" },
      navigator: { clipboard: { async writeText() { throw new Error("permission denied"); } } },
    },
  });
  const unavailable = await rejected.copyLocalLink("test");
  assert.equal(unavailable.status, "unavailable");
  assert.match(rejectedDocument.getElementById(LAUNCH_KIT_DOM_IDS.copyStatus).textContent, /LINK VISIBLE · COPY UNAVAILABLE/);
});

test("Launch Kit replay and reset clear stale copy status while keeping local flags", async () => {
  const documentRoot = makeDocument();
  const adapter = createLaunchKitConsole({
    documentRoot,
    windowLike: {
      location: { origin: "http://localhost:8080", pathname: "/" },
      navigator: { clipboard: { async writeText() {} } },
    },
  });
  await adapter.copyLocalLink("test");
  assert.equal(adapter.getSnapshot().copyStatus, "copied");
  const replay = adapter.replay("test");
  assert.equal(adapter.getSnapshot().copyStatus, "manual");
  assert.equal(replay.localOnly, true);
  await adapter.copyLocalLink("test");
  const reset = adapter.reset("test");
  assert.equal(reset.action, "reset");
  assert.equal(Object.isFrozen(reset), true);
  assert.equal(adapter.getSnapshot().copyStatus, "manual");
  assert.equal(adapter.getSnapshot().externalNetwork, false);
  assert.equal(documentRoot.getElementById(LAUNCH_KIT_DOM_IDS.shareUrl).readOnly ?? true, true);
});
