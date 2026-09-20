/**
 * tests/hand-mobile-panel.test.mjs
 *
 * Single-panel mobile behaviour for src/render/mobile-panel-manager.js:
 * on narrow (<=700px) viewports only one floating panel may stay visible.
 * Uses fake DOM nodes (hand-rolled stubs, no jsdom).
 *
 * Run with: node --test tests/hand-mobile-panel.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyMobilePanelPolicy,
  initMobilePanelManager,
} from "../src/render/mobile-panel-manager.js";

// ---------------------------------------------------------------------------
// Fake DOM
// ---------------------------------------------------------------------------

function makeClassList() {
  const classes = new Set();
  return {
    contains(name) {
      return classes.has(name);
    },
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    toggle(name, force) {
      if (force) classes.add(name);
      else classes.delete(name);
      return force;
    },
  };
}

function makeAside(id, { hidden = true } = {}) {
  return {
    id,
    tagName: "ASIDE",
    hidden,
    classList: makeClassList(),
    setAttribute() {},
  };
}

function makeDocumentRoot(asides, hint) {
  return {
    body: { classList: makeClassList() },
    documentElement: null, // no MutationObserver wiring in these tests
    querySelectorAll(selector) {
      return selector === "aside" ? asides.slice() : [];
    },
    getElementById(id) {
      if (id === "hint") return hint;
      return null; // gesture-input-panel / media-preview / readout absent
    },
  };
}

function makeWindowRoot(innerWidth) {
  return {
    innerWidth,
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ display: "block" }),
  };
}

// ---------------------------------------------------------------------------
// Pure policy
// ---------------------------------------------------------------------------

describe("applyMobilePanelPolicy (pure)", () => {
  it("keeps openedId, hides the other visible panel, hides the hint", () => {
    const result = applyMobilePanelPolicy({
      panels: [
        { id: "other-panel", visible: true },
        { id: "hand-lens-panel", visible: true },
      ],
      openedId: "hand-lens-panel",
    });

    assert.equal(result.keeper, "hand-lens-panel");
    assert.deepEqual(result.hideIds, ["other-panel"]);
    assert.equal(result.hintHidden, true);
  });

  it("with no visible panels the keeper is null and the hint stays", () => {
    const result = applyMobilePanelPolicy({
      panels: [
        { id: "other-panel", visible: false },
        { id: "hand-lens-panel", visible: false },
      ],
      openedId: null,
    });

    assert.equal(result.keeper, null);
    assert.deepEqual(result.hideIds, []);
    assert.equal(result.hintHidden, false);
  });

  it("falls back to the first visible panel when openedId is unknown", () => {
    const result = applyMobilePanelPolicy({
      panels: [
        { id: "other-panel", visible: true },
        { id: "hand-lens-panel", visible: true },
      ],
      openedId: null,
    });

    assert.equal(result.keeper, "other-panel");
    assert.deepEqual(result.hideIds, ["hand-lens-panel"]);
    assert.equal(result.hintHidden, true);
  });
});

// ---------------------------------------------------------------------------
// Integrated manager with fake DOM
// ---------------------------------------------------------------------------

describe("initMobilePanelManager (integrated)", () => {
  it("narrow: opening the hand-lens panel collapses the other panel", () => {
    const otherPanel = makeAside("other-panel", { hidden: false });
    const handLensPanel = makeAside("hand-lens-panel", { hidden: true });
    const hint = { hidden: false };

    const manager = initMobilePanelManager({
      documentRoot: makeDocumentRoot([handLensPanel, otherPanel], hint),
      windowRoot: makeWindowRoot(400),
      MutationObserverImpl: null,
    });

    assert.equal(manager.isNarrow(), true);

    // Other panel starts visible; the hand-lens panel is closed.
    assert.equal(otherPanel.hidden, false);
    assert.equal(handLensPanel.hidden, true);

    // Open the hand-lens panel, then run the policy hook.
    handLensPanel.hidden = false;
    manager.sync();

    assert.equal(
      handLensPanel.hidden,
      false,
      "the hand-lens panel must stay visible",
    );
    assert.equal(
      otherPanel.hidden,
      true,
      "the previously open panel must collapse on a narrow viewport",
    );
    assert.equal(hint.hidden, true, "the hint bar hides while a panel is open");

    manager.destroy();
  });

  it("desktop width: opening a panel does not hide the other", () => {
    const otherPanel = makeAside("other-panel", { hidden: false });
    const handLensPanel = makeAside("hand-lens-panel", { hidden: true });
    const hint = { hidden: false };

    const manager = initMobilePanelManager({
      documentRoot: makeDocumentRoot([handLensPanel, otherPanel], hint),
      windowRoot: makeWindowRoot(1024),
      MutationObserverImpl: null,
    });

    assert.equal(manager.isNarrow(), false);

    handLensPanel.hidden = false;
    manager.sync();

    assert.equal(handLensPanel.hidden, false);
    assert.equal(
      otherPanel.hidden,
      false,
      "desktop layout must leave the other panel untouched",
    );

    manager.destroy();
  });

  it("narrow: closing all panels restores the hint bar", () => {
    const otherPanel = makeAside("other-panel", { hidden: false });
    const handLensPanel = makeAside("hand-lens-panel", { hidden: true });
    const hint = { hidden: false };

    const manager = initMobilePanelManager({
      documentRoot: makeDocumentRoot([handLensPanel, otherPanel], hint),
      windowRoot: makeWindowRoot(400),
      MutationObserverImpl: null,
    });

    // Other panel is the keeper at boot; hint hides.
    assert.equal(hint.hidden, true);

    // Close everything.
    otherPanel.hidden = true;
    handLensPanel.hidden = true;
    manager.sync();

    assert.equal(hint.hidden, false, "hint bar returns when no panel is open");

    manager.destroy();
  });
});
