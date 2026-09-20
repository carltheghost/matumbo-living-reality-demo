/**
 * tests/block-world-gesture-tap.test.mjs
 *
 * registerGestureFieldTap: the hand-first field entry point. It raycasts the
 * ACTUAL cube through the block world's own pickBlockAtGesturePose — never
 * a second raycaster, never a fabricated blockId — and returns null with NO
 * selection change and NO fallback to the selected block when the raycast
 * hits nothing.
 *
 * In node there is no three.js (globalThis.THREE is undefined), so the
 * block world's raycaster deterministically returns null: exactly the
 * "empty space" case this test pins down.
 *
 * Run with: node --test tests/block-world-gesture-tap.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import { createBlockWorldLayer } from "../src/render/block-world.js";

function stubElement() {
  const el = {
    children: [],
    dataset: {},
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains: () => false,
    },
    textContent: "",
    innerHTML: "",
    id: "",
    className: "",
    hidden: false,
    disabled: false,
    value: "",
    parentElement: null,
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) {
      el.children.push(child);
      child.parentElement = el;
      return child;
    },
    removeChild(child) {
      const index = el.children.indexOf(child);
      if (index >= 0) el.children.splice(index, 1);
      return child;
    },
    insertBefore(child) {
      return el.appendChild(child);
    },
    replaceChildren(...children) {
      el.children.length = 0;
      for (const child of children) el.appendChild(child);
    },
    append(...children) {
      for (const child of children) el.appendChild(child);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
    }),
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    focus() {},
    blur() {},
    click() {},
    remove() {},
  };
  return el;
}

function makeDocumentRoot() {
  return {
    getElementById: () => stubElement(),
    createElement: () => stubElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: stubElement(),
    addEventListener() {},
    removeEventListener() {},
  };
}

test("registerGestureFieldTap exists on the layer API", () => {
  const layer = createBlockWorldLayer({
    documentRoot: makeDocumentRoot(),
    projection: createBlockWorldContribution(),
  });
  assert.equal(typeof layer.registerGestureFieldTap, "function");
  assert.equal(
    typeof layer.registerFieldTap,
    "function",
    "legacy entry point untouched",
  );
});

test("raycast hits nothing → null, no selection change, no fallback", () => {
  const layer = createBlockWorldLayer({
    documentRoot: makeDocumentRoot(),
    projection: createBlockWorldContribution(),
  });
  const before = layer.getSnapshot().selectedId;
  assert.ok(before, "fixture should start with a selected block");

  const result = layer.registerGestureFieldTap(
    { x: 0.5, y: 0.5 },
    { clientX: 640, clientY: 400, pointerType: "hand", timeStamp: 1000 },
  );

  assert.equal(result, null, "empty-space hand tap returns null");
  assert.equal(
    layer.getSnapshot().selectedId,
    before,
    "no fallback to the currently selected block for hand input",
  );
});
