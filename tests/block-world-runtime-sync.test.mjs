import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { DEFAULT_BLOCK_WORLD } from "../src/domains/block-world.js";
import { createBlockWorldSnapshot } from "../src/domains/block-world-snapshot.js";
import {
  BLOCK_WORLD_RUNTIME_DEFAULT_ENDPOINT,
  BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY,
  BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS,
  buildBlockWorldRuntimeSyncRoute,
  blockWorldRuntimeApiUrl,
  blockWorldRuntimeWebSocketUrl,
  createBlockWorldRuntimeState,
  createBlockWorldRuntimeSync,
  normalizeBlockWorldRuntimeEndpoint,
  validateBlockWorldRuntimePayload,
} from "../src/render/block-world-runtime-sync.js";

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
    click() { this.listeners.get("click")?.({ detail: 1 }); },
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    register(id, tag = "div") {
      const element = makeElement(documentRoot, tag);
      element.id = id;
      elements.set(id, element);
      return element;
    },
  };
  Object.entries(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS).forEach(([key, id]) => {
    const element = documentRoot.register(id, ["endpoint", "worldId", "route"].includes(key) ? "input" : "div");
    element.hidden = key === "panel";
  });
  return documentRoot;
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  emit(type, payload = {}) { this.readyState = type === "open" ? 1 : type === "close" ? 3 : this.readyState; this.listeners.get(type)?.(payload); }
  close() { this.readyState = 3; this.emit("close", {}); }
}

test("runtime endpoint and envelope stay loopback-only and data-only", () => {
  assert.equal(normalizeBlockWorldRuntimeEndpoint(BLOCK_WORLD_RUNTIME_DEFAULT_ENDPOINT), "http://localhost:8091");
  assert.equal(normalizeBlockWorldRuntimeEndpoint("http://127.0.0.1:8091/"), "http://127.0.0.1:8091");
  assert.throws(() => normalizeBlockWorldRuntimeEndpoint("https://example.com"), /loopback-only/);
  assert.equal(blockWorldRuntimeApiUrl("http://localhost:8091", "demo", "health"), "http://localhost:8091/api/health");
  assert.equal(blockWorldRuntimeApiUrl("http://localhost:8091", "demo", "world"), "http://localhost:8091/api/world/demo");
  assert.equal(blockWorldRuntimeWebSocketUrl("http://localhost:8091", "demo"), "ws://localhost:8091/ws?world=demo");
  const snapshot = createBlockWorldSnapshot(DEFAULT_BLOCK_WORLD);
  const state = createBlockWorldRuntimeState(snapshot);
  assert.deepEqual(state.blockWorldSnapshot, snapshot);
  assert.deepEqual(state.ledger, []);
  assert.deepEqual(state.usedEvidence, []);
  assert.equal(state.runtimeBridge.persistence, true);
  assert.equal(state.runtimeBridge.executable, false);
  const valid = validateBlockWorldRuntimePayload({ state, version: 3 });
  assert.equal(valid.valid, true);
  assert.equal(valid.blockCount, snapshot.blockCount);
  assert.equal(validateBlockWorldRuntimePayload({ state: { ledger: [], usedEvidence: [] } }).valid, false);
});

test("runtime sync exposes a bounded local route and copies only after an explicit action", async () => {
  assert.equal(buildBlockWorldRuntimeSyncRoute("share-173_safe"), "?panel=runtime-sync&world=share-173_safe");
  assert.throws(() => buildBlockWorldRuntimeSyncRoute("unsafe/world"), /world id must contain only/);

  const documentRoot = makeDocument();
  const calls = [];
  const copied = [];
  const windowLike = {
    location: { origin: "http://localhost:8080" },
    fetch: async (...args) => { calls.push(args); return response({}); },
    navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
  };
  const adapter = createBlockWorldRuntimeSync({ documentRoot, windowLike, projection: DEFAULT_BLOCK_WORLD });
  assert.equal(calls.length, 0);
  assert.equal(adapter.getSnapshot().localRoute, "?panel=runtime-sync&world=demo");
  assert.equal(adapter.getSnapshot().lastCopy, null);
  assert.match(documentRoot.getElementById(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS.copyStatus).textContent, /ROUTE VISIBLE.*COPY MANUALLY.*LOCAL ONLY/);

  const result = await adapter.copyLocalRoute("test");
  assert.equal(calls.length, 0, "copy must not contact the runtime");
  assert.deepEqual(copied, ["?panel=runtime-sync&world=demo"]);
  assert.equal(result.status, "copied");
  assert.equal(result.route, "?panel=runtime-sync&world=demo");
  assert.equal(result.worldId, "demo");
  assert.equal(result.localOnly, true);
  assert.equal(result.externalNetwork, false);
  assert.match(documentRoot.getElementById(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS.copyStatus).textContent, /ROUTE COPIED.*LOCAL ONLY/);

  documentRoot.getElementById(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS.worldId).value = "unsafe/world";
  const rejected = await adapter.copyLocalRoute("invalid-test");
  assert.equal(calls.length, 0);
  assert.equal(copied.length, 1);
  assert.equal(rejected.status, "invalid");
  assert.equal(rejected.copied, false);
  assert.match(documentRoot.getElementById(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS.copyStatus).textContent, /BOUNDED WORLD ID REQUIRED.*LOCAL ONLY/);
});

test("runtime sync keeps the route selectable when clipboard access is unavailable", async () => {
  const documentRoot = makeDocument();
  const adapter = createBlockWorldRuntimeSync({
    documentRoot,
    windowLike: { location: { origin: "http://localhost:8080" }, navigator: {} },
    projection: DEFAULT_BLOCK_WORLD,
  });
  const result = await adapter.copyLocalRoute("manual-test");
  assert.equal(result.status, "manual");
  assert.equal(result.copied, false);
  assert.equal(result.route, "?panel=runtime-sync&world=demo");
  assert.match(documentRoot.getElementById(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS.route).value, /^\?panel=runtime-sync&world=demo$/);
  assert.match(documentRoot.getElementById(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS.copyStatus).textContent, /COPY MANUALLY.*LOCAL ONLY/);
});

test("runtime sync does not request on mount, loads and saves only after explicit connect", async () => {
  const documentRoot = makeDocument();
  const calls = [];
  const snapshot = createBlockWorldSnapshot(DEFAULT_BLOCK_WORLD);
  const state = createBlockWorldRuntimeState(snapshot);
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/health")) return response({ ok: true, postgres: false, storage: "memory-demo" });
    if (url.endsWith("/api/world/demo") && options.method === "PUT") return response({ worldId: "demo", version: 1, ledgerBalanced: true });
    if (url.endsWith("/api/world/demo")) return response({ worldId: "demo", version: 0, state, updatedAt: "2026-08-28T00:00:00.000Z" });
    return response({ error: "not found" }, 404);
  };
  const windowLike = { location: { origin: "http://localhost:8080" }, fetch, WebSocket: FakeWebSocket, setTimeout, clearTimeout };
  const loaded = [];
  const saved = [];
  const adapter = createBlockWorldRuntimeSync({ documentRoot, windowLike, projection: DEFAULT_BLOCK_WORLD, onLoad: (result) => loaded.push(result), onSave: (result) => saved.push(result) });
  assert.equal(calls.length, 0);
  assert.equal(FakeWebSocket.instances.length, 0);
  assert.equal(adapter.getSnapshot().connectionState, "offline");

  await adapter.connect("test");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:8091/api/health");
  assert.equal(FakeWebSocket.instances.length, 1);
  FakeWebSocket.instances[0].emit("open");
  assert.match(documentRoot.getElementById(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS.status).textContent, /MEMORY-DEMO.*NON-DURABLE.*NO EXTERNAL PROVIDER/);
  assert.match(documentRoot.getElementById(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS.connection).textContent, /EXPLICIT SESSION.*MEMORY-DEMO.*NON-DURABLE/);
  const loadedResult = await adapter.load("test");
  assert.equal(loadedResult.accepted, true);
  assert.equal(loaded.length, 1);
  assert.equal(adapter.getSnapshot().serverVersion, 0);
  const savedResult = await adapter.save("test");
  assert.equal(savedResult.accepted, true);
  assert.equal(savedResult.expectedVersion, 0);
  assert.equal(savedResult.version, 1);
  assert.equal(saved.length, 1);
  const putCall = calls.find((call) => call.options.method === "PUT");
  assert.ok(putCall);
  const putBody = JSON.parse(putCall.options.body);
  assert.equal(putBody.expectedVersion, 0);
  assert.equal(putBody.state.blockWorldSnapshot.blockCount, snapshot.blockCount);
  assert.equal(putBody.state.ledger.length, 0);
  assert.match(documentRoot.getElementById(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS.status).textContent, /SAVED · SERVER VERSION 1/);
  assert.equal(adapter.getSnapshot().localOnly, true);
  assert.equal(adapter.getSnapshot().externalNetwork, false);
  assert.equal(adapter.getSnapshot().boundary, BLOCK_WORLD_RUNTIME_SYNC_BOUNDARY);
  adapter.disconnect("test");
  assert.equal(adapter.getSnapshot().connectionState, "offline");
});

test("runtime sync surfaces atomic version conflicts and WebSocket updates without applying them", async () => {
  const documentRoot = makeDocument();
  const snapshot = createBlockWorldSnapshot(DEFAULT_BLOCK_WORLD);
  const state = createBlockWorldRuntimeState(snapshot);
  const conflicts = [];
  const updates = [];
  const fetch = async (url, options = {}) => {
    if (url.endsWith("/api/health")) return response({ ok: true, storage: "memory-demo" });
    if (options.method === "PUT") return response({ error: "world version conflict", currentVersion: 4 }, 409);
    return response({ worldId: "demo", version: 3, state });
  };
  const windowLike = { location: { origin: "http://localhost:8080" }, fetch, WebSocket: FakeWebSocket, setTimeout, clearTimeout };
  const adapter = createBlockWorldRuntimeSync({ documentRoot, windowLike, projection: DEFAULT_BLOCK_WORLD, onConflict: (result) => conflicts.push(result), onRemoteUpdate: (result) => updates.push(result) });
  await adapter.connect("test");
  FakeWebSocket.instances.at(-1).emit("open");
  await adapter.load("test");
  assert.equal(adapter.getSnapshot().serverVersion, 3);
  FakeWebSocket.instances.at(-1).emit("message", { data: JSON.stringify({ type: "WORLD_UPDATED", worldId: "demo", version: 4 }) });
  assert.equal(updates.length, 1);
  assert.equal(adapter.getSnapshot().remoteVersion, 4);
  assert.match(adapter.getSnapshot().status, /REMOTE UPDATE/);
  const result = await adapter.save("test");
  assert.equal(result.conflict, true);
  assert.equal(result.accepted, false);
  assert.equal(conflicts.length, 1);
  assert.equal(adapter.getSnapshot().requiresReload, true);
  assert.match(documentRoot.getElementById(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS.status).textContent, /VERSION CONFLICT/);
  const blocked = await adapter.save("after-conflict");
  assert.equal(blocked.requiresReload, true);
  adapter.disconnect("test");
});

test("runtime sync renderer and docs declare explicit local bridge boundaries", async () => {
  const renderer = await readFile(new URL("../src/render/block-world-runtime-sync.js", import.meta.url), "utf8");
  const markup = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const docs = await readFile(new URL("../docs/BLOCK_WORLD_MIGRATION.md", import.meta.url), "utf8");
  for (const id of Object.values(BLOCK_WORLD_RUNTIME_SYNC_DOM_IDS)) assert.match(markup, new RegExp(id));
  assert.match(renderer, /WORLD_UPDATED/);
  assert.match(renderer, /expectedVersion/);
  assert.match(renderer, /loopback-only/);
  assert.match(renderer, /buildBlockWorldRuntimeSyncRoute/);
  assert.match(renderer, /copy-local-route/);
  assert.doesNotMatch(renderer, /localStorage|sessionStorage|indexedDB/);
  assert.match(markup, /Copy local sync route/);
  assert.match(docs, /Merge 4/i);
});
