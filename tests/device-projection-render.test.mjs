import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import { createDeviceProjection } from "../src/projections/device-projection.js";
import { DEVICE_PROJECTION_CONSOLE_SOURCE, createDeviceProjectionConsole, summarizeDeviceProjection } from "../src/render/device-projection.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot, tagName: tag.toUpperCase(), id: "", className: "", dataset: {}, hidden: false, disabled: false,
    textContent: "", children: [], listeners: new Map(), attributes: new Map(),
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
  [["device-projection-console", true], ["device-projection-close"], ["device-projection-replay"], ["device-projection-reset"], ["device-projection-status"], ["device-projection-summary"], ["device-projection-current"], ["device-projection-devices"], ["device-projection-parity"], ["device-projection-trace"], ["device-projection-boundary"]].forEach(([id, hidden]) => {
    const element = makeElement(documentRoot); element.id = id; element.hidden = hidden === true; elements.set(id, element);
  });
  return documentRoot;
}

function sampleDeviceProjection() {
  const envelope = createLivingRealityProjection();
  return createDeviceProjection(envelope, { viewport: { width: 1440, height: 1000 }, reducedMotion: false, inputMode: "pointer-fine", contrast: "no-preference", colorScheme: "dark", textScale: 1 });
}

test("device projection summary exposes phone, PC, and bounded XR profiles", () => {
  const summary = summarizeDeviceProjection(sampleDeviceProjection());
  assert.equal(summary.source, DEVICE_PROJECTION_CONSOLE_SOURCE);
  assert.deepEqual(summary.devices.map((device) => device.id), ["phone", "pc", "xr"]);
  assert.equal(summary.selectedDeviceId, "pc");
  assert.equal(summary.devices.find((device) => device.id === "xr").status, "fallback-only");
  assert.equal(summary.xr.status, "not-tested");
  assert.equal(summary.xrSession, false);
  assert.equal(summary.parityClaim, false);
  assert.equal(Object.isFrozen(summary), true);
});

test("device projection console selects, replays, and resets locally", () => {
  const projection = sampleDeviceProjection();
  const before = JSON.stringify(projection);
  const callbacks = [];
  const adapter = createDeviceProjectionConsole({ documentRoot: makeDocument(), projection, onSelect: (snapshot) => callbacks.push(snapshot), onReplay: (snapshot) => callbacks.push(snapshot), onReset: (snapshot) => callbacks.push(snapshot) });
  const selected = adapter.selectDevice("xr", "test");
  assert.equal(selected.deviceId, "xr");
  const replay = adapter.replay("test");
  assert.deepEqual(replay.sequence, ["canonical-world", "device-profile", "fallback-boundary"]);
  adapter.reset("test");
  assert.equal(adapter.getSnapshot().trace.length, 0);
  assert.equal(callbacks.map((item) => item.action).join(","), "select,replay,reset");
  assert.equal(callbacks.every((item) => item.localOnly === true && item.simulation === true && item.xrSession === false && item.executable === false), true);
  assert.equal(JSON.stringify(projection), before);
});

test("device projection console markup declares the fallback boundary and no XR session path", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/device-projection.js", import.meta.url), "utf8");
  for (const id of ["device-projection-console", "device-projection-close", "device-projection-replay", "device-projection-reset", "device-projection-status", "device-projection-summary", "device-projection-current", "device-projection-devices", "device-projection-parity", "device-projection-trace", "device-projection-boundary"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(source, new RegExp(id));
  }
  assert.match(source, /fallback-only/);
  assert.doesNotMatch(source, /navigator\.xr/i);
  assert.doesNotMatch(source, /requestSession/i);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
});
