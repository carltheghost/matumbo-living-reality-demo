import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  INTENT_EVENT_NAME,
  INTENT_TIMELINE_MAX_ENTRIES,
  createIntentTimeline,
  sanitizeIntentDetail,
  summarizeIntent,
} from "../src/render/intent-timeline.js";

class FakeClassList {
  #values = new Set();

  toggle(name, force) {
    const next = force === undefined ? !this.#values.has(name) : Boolean(force);
    if (next) this.#values.add(name);
    else this.#values.delete(name);
    return next;
  }
}

class FakeElement {
  constructor(tagName, id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.hidden = false;
    this.textContent = "";
    this.className = "";
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, detail = undefined) {
    (this.listeners.get(type) ?? []).forEach((listener) => listener({ type, detail, key: type }));
  }

  focus() {}
}

class FakeDocument {
  constructor(ids) {
    this.nodes = new Map(ids.map((id) => [id, new FakeElement("div", id)]));
    this.listeners = new Map();
  }

  getElementById(id) {
    return this.nodes.get(id) ?? null;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }
}

class FakeEventRoot {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }

  dispatchEvent(event) {
    (this.listeners.get(event.type) ?? []).forEach((listener) => listener(event));
    return true;
  }
}

const MOUNT_IDS = [
  "intent-timeline",
  "intent-timeline-open",
  "intent-timeline-close",
  "intent-timeline-replay",
  "intent-timeline-clear",
  "intent-timeline-status",
  "intent-timeline-events",
  "intent-timeline-count",
  "intent-timeline-boundary",
];

function createMountedTimeline(options = {}) {
  const documentRoot = new FakeDocument(MOUNT_IDS);
  const eventRoot = new FakeEventRoot();
  const timeline = createIntentTimeline({ documentRoot, eventRoot, ...options });
  return { documentRoot, eventRoot, timeline };
}

test("intent summaries are frozen, bounded, and redact unsafe metadata", () => {
  const summary = summarizeIntent({
    schemaVersion: 1,
    type: "projection.inspect-person",
    target: "profile:sample",
    detail: {
      method: "row",
      count: 2,
      recipientAddress: "do-not-show",
      privateKey: "do-not-show",
      nested: { secret: "do-not-show" },
      array: ["do-not-show"],
    },
    simulation: true,
  }, 7);

  assert.equal(summary.id, "intent:7");
  assert.equal(summary.type, "projection.inspect-person");
  assert.equal(summary.target, "profile:sample");
  assert.deepEqual(summary.detail, { count: 2, method: "row" });
  assert.match(summary.summary, /count=2/);
  assert.doesNotMatch(summary.summary, /do-not-show|secret|address|private/i);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.detail), true);

  const sanitized = sanitizeIntentDetail({ constructor: "x", source: { dump: true }, mode: "safe" });
  assert.deepEqual(sanitized, { mode: "safe" });
});

test("timeline captures only a bounded recent window and deep-freezes entries", () => {
  const { documentRoot, eventRoot, timeline } = createMountedTimeline();
  for (let index = 1; index <= INTENT_TIMELINE_MAX_ENTRIES + 3; index += 1) {
    eventRoot.dispatchEvent({
      type: INTENT_EVENT_NAME,
      detail: {
        schemaVersion: 1,
        type: "projection.feature-open",
        target: `feature:${index}`,
        detail: { method: "test", index, nested: { hidden: true } },
        simulation: true,
      },
    });
  }

  const snapshot = timeline.getSnapshot();
  assert.equal(snapshot.count, INTENT_TIMELINE_MAX_ENTRIES);
  assert.equal(snapshot.entries[0].sequence, 4);
  assert.equal(snapshot.entries.at(-1).target, "feature:15");
  assert.equal(snapshot.entries.every((entry) => Object.isFrozen(entry)), true);
  assert.equal(documentRoot.getElementById("intent-timeline-events").children.length, INTENT_TIMELINE_MAX_ENTRIES);
  assert.match(documentRoot.getElementById("intent-timeline-count").textContent, /^12 \/ 12/);
  assert.equal(snapshot.localOnly, true);
  assert.equal(snapshot.persisted, false);
  timeline.destroy();
});

test("clear and replay are local, deterministic controls", () => {
  const replays = [];
  const { documentRoot, eventRoot, timeline } = createMountedTimeline({ onReplay: (value) => replays.push(value) });
  eventRoot.dispatchEvent({
    type: INTENT_EVENT_NAME,
    detail: { type: "projection.focus", target: "coin", detail: { method: "test" }, simulation: true },
  });
  eventRoot.dispatchEvent({
    type: INTENT_EVENT_NAME,
    detail: { type: "projection.focus", target: "market", detail: { method: "test" }, simulation: true },
  });

  const replay = timeline.replay("test");
  assert.equal(replay.replayCount, 1);
  assert.equal(replay.count, 2);
  assert.equal(replay.events.length, 2);
  assert.equal(replay.simulation, true);
  assert.equal(replay.persisted, false);
  assert.equal(replays.length, 1);
  assert.deepEqual(replays[0], replay);
  assert.equal(timeline.getSnapshot().count, 2);

  const cleared = timeline.clear("test");
  assert.equal(cleared.count, 0);
  assert.equal(cleared.clearCount, 1);
  assert.equal(documentRoot.getElementById("intent-timeline-events").children.length, 1);
  assert.match(documentRoot.getElementById("intent-timeline-events").children[0].textContent, /No local intents yet/);
  const before = timeline.getSnapshot().count;
  documentRoot.getElementById("intent-timeline-clear").dispatch("click");
  assert.equal(timeline.getSnapshot().count, before);
  timeline.destroy();
});

test("markup and adapter are explicitly local and persistence-free", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/intent-timeline.js", import.meta.url), "utf8");
  for (const id of MOUNT_IDS) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /Intent Timeline|Intent Trace/i);
  assert.match(html, /local simulation/i);
  assert.match(html, /Replay visible trace/i);
  assert.match(html, /Clear(?: trace)?/i);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*(?:\(|\.)/i);
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB)\b/i);
});
