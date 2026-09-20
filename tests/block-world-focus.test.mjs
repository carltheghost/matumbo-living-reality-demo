import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  BLOCK_WORLD_DIRECTORY_MODE,
  BLOCK_WORLD_FOCUS_MODE,
  applyBlockWorldFocusMode,
} from "../src/render/block-world-focus.js";

function makeRoot() {
  const names = new Set();
  return {
    classList: {
      toggle(name, enabled) {
        if (enabled) names.add(name);
        else names.delete(name);
      },
      contains(name) { return names.has(name); },
    },
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
  };
}

function makeDocument() {
  const html = makeRoot();
  const body = makeRoot();
  const toggle = makeRoot();
  return {
    documentElement: html,
    body,
    getElementById(id) { return id === "feature-toggle" ? toggle : null; },
    html,
    toggle,
  };
}

test("cube-first focus mode is a reversible DOM-only presentation flag", () => {
  const documentRoot = makeDocument();
  const focused = applyBlockWorldFocusMode({ documentRoot, active: true });
  assert.equal(focused.active, true);
  assert.equal(focused.mode, BLOCK_WORLD_FOCUS_MODE);
  assert.equal(focused.hiddenOverlays, true);
  assert.equal(focused.localOnly, true);
  assert.equal(documentRoot.html.classList.contains(BLOCK_WORLD_FOCUS_MODE), true);
  assert.equal(documentRoot.body.classList.contains(BLOCK_WORLD_FOCUS_MODE), true);
  assert.equal(documentRoot.html.getAttribute("data-view-mode"), BLOCK_WORLD_FOCUS_MODE);
  assert.equal(documentRoot.toggle.classList.contains("block-world-focus-toggle"), true);
  assert.equal(documentRoot.toggle.getAttribute("data-focus-mode"), BLOCK_WORLD_FOCUS_MODE);
  assert.equal(Object.isFrozen(focused), true);

  const directory = applyBlockWorldFocusMode({ documentRoot, active: false });
  assert.equal(directory.active, false);
  assert.equal(directory.mode, BLOCK_WORLD_DIRECTORY_MODE);
  assert.equal(documentRoot.html.classList.contains(BLOCK_WORLD_FOCUS_MODE), false);
  assert.equal(documentRoot.body.classList.contains(BLOCK_WORLD_FOCUS_MODE), false);
  assert.equal(documentRoot.toggle.classList.contains("block-world-focus-toggle"), false);
  assert.equal(documentRoot.toggle.getAttribute("data-focus-mode"), BLOCK_WORLD_DIRECTORY_MODE);
});

test("focus CSS keeps the directory and explicit Portal asset destination reachable", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /block-world-focus #feature-shell:not\(\.open\)/);
  assert.match(html, /block-world-focus #asset-launch:not\(\.portal-destination-visible\)/);
  assert.match(html, /body\.cube-first-mode #asset-launch\.cube-first-hidden\{display:none!important;\}/);
});
