import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import { createLiveGatewayConsole } from "../src/render/live-gateway.js";

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
    ["live-gateway-console", true],
    ["live-gateway-close"],
    ["live-gateway-replay"],
    ["live-gateway-reset"],
    ["live-gateway-status"],
    ["live-gateway-summary"],
    ["live-gateway-public-actions"],
    ["live-gateway-public-refresh-status"],
    ["live-gateway-public-status"],
    ["live-gateway-legacy-fixture"],
    ["live-gateway-current"],
    ["live-gateway-evidence"],
    ["live-gateway-interpretations"],
    ["live-gateway-trace"],
    ["live-gateway-boundary"],
  ].forEach(([id, hidden]) => {
    const element = makeElement(documentRoot);
    element.id = id;
    element.hidden = hidden === true;
    elements.set(id, element);
  });
  return documentRoot;
}

test("public Gateway instances hide the compatibility fixture at mount and on open", () => {
  const documentRoot = makeDocument();
  const adapter = createLiveGatewayConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    includeLegacyFixture: false,
  });
  const fixture = documentRoot.getElementById("live-gateway-legacy-fixture");
  assert.equal(fixture.hidden, true);
  assert.equal(fixture.attributes.get("aria-hidden"), "true");
  adapter.open();
  assert.equal(fixture.hidden, true);
  assert.equal(fixture.attributes.get("aria-hidden"), "true");
  assert.equal(adapter.getSnapshot().summary.recordCount, 0);
});

test("canonical main route mounts the public Gateway without fixture rows", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/live-gateway.js", import.meta.url), "utf8");
  assert.match(html, /id=["']live-gateway-legacy-fixture["']/);
  assert.match(html, /public-status-only[^\n]*live-gateway-legacy-fixture/);
  assert.match(main, /includeLegacyFixture:\s*false/);
  assert.match(main, /panel=live-status/);
  assert.match(main, /live=all/);
  assert.match(source, /legacyFixtureEl\.hidden\s*=\s*true/);
  assert.match(source, /legacyFixtureEl\.setAttribute\?\.\("aria-hidden",\s*"true"\)/);
});
