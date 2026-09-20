import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import { createBlockWorldLayer } from "../src/render/block-world.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    type: tag === "button" ? "button" : undefined,
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    tabIndex: -1,
    textContent: "",
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    classList: {
      values: new Set(),
      toggle(name, force) {
        if (force === true) this.values.add(name);
        else if (force === false) this.values.delete(name);
        else if (this.values.has(name)) this.values.delete(name);
        else this.values.add(name);
      },
    },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    focus() {},
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
    register(id, hidden = false, tag = "div") {
      const element = makeElement(documentRoot, tag);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
  };
  [
    ["block-world-console", true], ["block-world-close", false, "button"],
    ["block-world-replay", false, "button"], ["block-world-add", false, "button"],
    ["block-world-remove", false, "button"], ["block-world-replace", false, "button"],
    ["block-world-open", false, "button"], ["block-world-inspect", false, "button"],
    ["block-world-status"], ["block-world-count"], ["block-world-draft-count"],
    ["block-world-container-count"], ["block-world-content-count"], ["block-world-selection"],
    ["block-world-list"], ["block-world-palette"], ["block-world-trace"], ["block-world-boundary"],
    ["block-world-inspection"], ["block-world-container-hint", true], ["block-world-contents"],
    ["block-world-routes"], ["block-world-navigation-status"], ["block-world-navigation-trace"],
    ["block-world-migration-open", false, "button"], ["block-world-migration-status"],
  ].forEach(([id, hidden, tag]) => documentRoot.register(id, hidden, tag));
  return documentRoot;
}

test("selected container exposes an actionable open/inspect hint without changing canonical blocks", () => {
  const base = createBlockWorldContribution();
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot, projection: base, three: null });
  const hint = documentRoot.getElementById("block-world-container-hint");
  const container = base.blocks.find((block) => block.container && block.canOpen);
  assert.ok(container);

  layer.selectBlock(container.id, "test");
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /CONTAINER READY/);
  assert.match(hint.textContent, /OPEN CUBE OR DOUBLE-ACTIVATE/);

  const canonicalBefore = JSON.stringify(layer.getSnapshot().canonicalProjection.blocks);
  const opened = layer.openBlock(true);
  assert.equal(opened.action, "open");
  assert.match(hint.textContent, /OPEN CONTAINER/);
  assert.match(hint.textContent, /NESTED CUBE/);
  assert.equal(JSON.stringify(layer.getSnapshot().canonicalProjection.blocks), canonicalBefore);

  const closed = layer.openBlock(false);
  assert.equal(closed.action, "close");
  assert.match(hint.textContent, /CONTAINER READY/);
  assert.equal(JSON.stringify(layer.getSnapshot().canonicalProjection.blocks), canonicalBefore);
});

test("container affordance remains cube-only and keeps cue meshes off the raycast target set", async () => {
  const source = await readFile(new URL("../src/render/block-world.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /containerGeometry/);
  assert.match(source, /containerCueGeometry/);
  assert.match(source, /block-world-container-cue/);
  assert.match(source, /containerCueMaterialFor/);
  assert.match(source, /const containerHintEl/);
  assert.doesNotMatch(source, /(?:SphereGeometry|CircleGeometry|TorusGeometry)/);
  assert.doesNotMatch(source, /raycastTargets\.push\(cue\)/);
  assert.match(html, /id="block-world-container-hint"[^>]*role="status"/);
});
