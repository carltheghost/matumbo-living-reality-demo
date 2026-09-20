/**
 * Synthetic tests for the air keyboard (src/render/air-keyboard.js).
 * Run with: node --test tests/air-keyboard.test.mjs
 *
 * No jsdom, no npm installs: the pure layout math is tested directly, and
 * pressKey() is exercised against a minimal hand-rolled document stub. The
 * stub deliberately provides NO `CSS` global, proving pressKey no longer
 * depends on CSS.escape (a ReferenceError/TypeError would fail the test).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAirKeyboard,
  calculateKeyboardLayout,
  calculateKeyRects,
} from "../src/render/air-keyboard.js";

/* ------------------------------------------------------------------ */
/* Minimal fake document                                               */
/* ------------------------------------------------------------------ */

function makeClassList() {
  const set = new Set();
  const syncFromString = (value) => {
    set.clear();
    for (const token of String(value).split(/\s+/)) {
      if (token) set.add(token);
    }
  };
  return {
    add: (...cls) => { for (const c of cls) set.add(c); },
    remove: (...cls) => { for (const c of cls) set.delete(c); },
    toggle: (c, force) => {
      const next = force === undefined ? !set.has(c) : !!force;
      if (next) set.add(c); else set.delete(c);
      return next;
    },
    contains: (c) => set.has(c),
    // Internal: keep `el.className = "..."` assignments in sync.
    _syncFromString: syncFromString,
    _toString: () => [...set].join(" "),
  };
}

function makeStyle() {
  const style = {};
  style.setProperty = (name, value) => { style[name] = String(value); };
  style.getPropertyValue = (name) => style[name] ?? "";
  return style;
}

function matchesSelector(el, selector) {
  if (!el || typeof el !== "object") return false;
  if (selector.startsWith(".")) {
    return !!el.classList?.contains(selector.slice(1));
  }
  return false;
}

function makeElement(doc, tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: makeStyle(),
    dataset: {},
    attributes: {},
    listeners: {},
    textContent: "",
    isConnected: false,
    classList: makeClassList(),
    offsetWidth: 0,
    innerHTML: "",
    appendChild(child) {
      el.children.push(child);
      if (child && typeof child === "object") child.isConnected = true;
      return child;
    },
    append(...kids) {
      for (const k of kids) el.appendChild(k);
      return el;
    },
    remove() { el.isConnected = false; },
    setAttribute(name, value) {
      el.attributes[name] = String(value);
      if (name === "id") el.id = String(value);
    },
    getAttribute(name) { return el.attributes[name] ?? null; },
    addEventListener(type, fn, _opts) {
      (el.listeners[type] ??= []).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = el.listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    querySelector(selector) {
      const all = el.querySelectorAll(selector);
      return all.length ? all[0] : null;
    },
    querySelectorAll(selector) {
      const out = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          if (matchesSelector(child, selector)) out.push(child);
          visit(child);
        }
      };
      visit(el);
      return out;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    },
    contains(other) {
      if (other === el) return true;
      return (el.children || []).some(
        (c) => c === other || (c.contains && c.contains(other)),
      );
    },
    replaceChildren(...kids) {
      el.children = [];
      for (const k of kids) el.appendChild(k);
    },
  };
  let elId = "";
  Object.defineProperty(el, "id", {
    get: () => elId,
    set: (v) => {
      elId = String(v);
      el.attributes.id = elId;
      doc.registerId(elId, el);
    },
    configurable: true,
    enumerable: true,
  });
  // Keep className assignments and classList in sync both ways.
  Object.defineProperty(el, "className", {
    get: () => el.classList._toString(),
    set: (v) => el.classList._syncFromString(v),
    configurable: true,
    enumerable: true,
  });
  return el;
}

/**
 * Install the smallest document/window/localStorage that satisfies
 * createAirKeyboard(). `CSS` is intentionally left undefined.
 */
function setup() {
  const listeners = {};
  const byId = {};
  const store = new Map();
  const doc = {
    activeElement: null,
    listeners,
    createElement: (tag) => makeElement(doc, tag),
    getElementById: (id) => byId[id] ?? null,
    registerId: (id, el) => { byId[id] = el; },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => {
      const arr = listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    execCommand: () => false,
  };
  doc.body = doc.createElement("body");
  doc.head = doc.createElement("head");

  const ctx = {
    doc,
    previous: {
      document: globalThis.document,
      window: globalThis.window,
      localStorage: globalThis.localStorage,
      CSS: globalThis.CSS,
    },
    teardown() {
      for (const [key, value] of Object.entries(ctx.previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };

  globalThis.document = doc;
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout: () => 0,
    getSelection: () => null,
  };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  // Prove pressKey has no CSS.escape dependency: leave CSS undefined. Any
  // reference to CSS.escape would throw here.
  delete globalThis.CSS;

  return ctx;
}

function findButton(keyboard, keyId) {
  const buttons = keyboard.element.querySelectorAll(".matumbo-air-keyboard__key");
  return buttons.find((b) => b.dataset.keyId === keyId) ?? null;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("air-keyboard: pure layout", () => {
  it("normal layout has 43 unique key ids", () => {
    const rows = calculateKeyboardLayout({});
    const ids = rows.flat().map((k) => k.id);
    assert.equal(ids.length, 43);
    assert.equal(new Set(ids).size, 43, "key ids must be unique");
  });

  it("symbols layout has 34 unique key ids", () => {
    const rows = calculateKeyboardLayout({ symbols: true });
    const ids = rows.flat().map((k) => k.id);
    assert.equal(ids.length, 34);
    assert.equal(new Set(ids).size, 34, "key ids must be unique");
  });

  it("no two key rects intersect in either layout", () => {
    for (const opts of [{}, { symbols: true }]) {
      const rows = calculateKeyboardLayout(opts);
      const rects = calculateKeyRects(rows, { keySize: 44, gap: 6 });
      const entries = Object.entries(rects);
      assert.ok(entries.length > 0);
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const [aId, a] = entries[i];
          const [bId, b] = entries[j];
          const overlap =
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height;
          assert.ok(!overlap, `${aId} overlaps ${bId}`);
        }
      }
    }
  });
});

describe("air-keyboard: pressKey with stubbed DOM", () => {
  it("presses key-a: onKey fires once and the button flashes", () => {
    const ctx = setup();
    try {
      const seen = [];
      const keyboard = createAirKeyboard({ onKey: (info) => seen.push(info) });

      const ok = keyboard.pressKey("key-a");

      assert.equal(ok, true);
      assert.equal(seen.length, 1);
      assert.deepEqual(seen[0], {
        id: "key-a",
        action: "character",
        value: "a",
        label: "a",
        inserted: false, // no focused target in the stub
      });

      const button = findButton(keyboard, "key-a");
      assert.ok(button, "key-a button exists");
      assert.ok(
        button.classList.contains("is-pressed"),
        "pressed class applied",
      );

      keyboard.destroy();
    } finally {
      ctx.teardown();
    }
  });

  it("presses special-char keys without CSS.escape", () => {
    const ctx = setup();
    try {
      assert.equal(globalThis.CSS, undefined, "CSS must stay undefined");
      const seen = [];
      const keyboard = createAirKeyboard({ onKey: (info) => seen.push(info) });

      // Switch to the symbols layer, then press selector-hostile ids.
      assert.equal(keyboard.pressKey("key-symbols"), true);
      for (const keyId of ["key-?", "key-\\", "key-\""]) {
        const before = seen.length;
        assert.equal(keyboard.pressKey(keyId), true, `${keyId} pressed`);
        assert.equal(seen.length, before + 1);
        assert.equal(seen.at(-1).id, keyId);
        assert.equal(seen.at(-1).action, "character");
      }

      keyboard.destroy();
    } finally {
      ctx.teardown();
    }
  });

  it("pressKey on an unknown id returns false", () => {
    const ctx = setup();
    try {
      const seen = [];
      const keyboard = createAirKeyboard({ onKey: (info) => seen.push(info) });
      assert.equal(keyboard.pressKey("key-nope"), false);
      assert.equal(keyboard.pressKey(""), false);
      assert.equal(keyboard.pressKey(null), false);
      assert.equal(seen.length, 0, "onKey never fired");
      keyboard.destroy();
    } finally {
      ctx.teardown();
    }
  });
});
