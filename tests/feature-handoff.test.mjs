import test from "node:test";
import assert from "node:assert/strict";

import {
  FEATURE_DEFINITIONS,
  FEATURE_HANDOFF_LINKS,
  createFeatureNavigator,
} from "../src/render/feature-navigator.js";

const ids = new Set(FEATURE_DEFINITIONS.map((feature) => feature.id));

test("every feature has at least one valid onward handoff link", () => {
  assert.ok(Object.isFrozen(FEATURE_HANDOFF_LINKS));
  for (const feature of FEATURE_DEFINITIONS) {
    const links = FEATURE_HANDOFF_LINKS[feature.id];
    assert.ok(Array.isArray(links), `${feature.id} is missing handoff links`);
    assert.ok(links.length >= 1, `${feature.id} has no handoff links`);
    assert.ok(Object.isFrozen(links), `${feature.id} links are not frozen`);
    for (const targetId of links) {
      assert.ok(ids.has(targetId), `${feature.id} links to unknown feature ${targetId}`);
      assert.notEqual(targetId, feature.id, `${feature.id} links to itself`);
    }
  }
  assert.equal(
    Object.keys(FEATURE_HANDOFF_LINKS).length,
    FEATURE_DEFINITIONS.length,
    "handoff map must cover every feature exactly once",
  );
});

function makeElement(tag = "div") {
  const children = [];
  const element = {
    tagName: String(tag).toUpperCase(),
    children,
    dataset: {},
    className: "",
    textContent: "",
    title: "",
    type: "",
    id: "",
    handlers: {},
    classList: {
      add(...names) {
        const current = new Set(String(element.className ?? "").split(" ").filter(Boolean));
        names.filter(Boolean).forEach((name) => current.add(name));
        element.className = [...current].join(" ");
      },
      toggle(name, force) {
        const current = new Set(String(element.className ?? "").split(" ").filter(Boolean));
        const next = force ?? !current.has(name);
        if (next) current.add(name); else current.delete(name);
        element.className = [...current].join(" ");
        return next;
      },
      contains(name) { return String(element.className ?? "").split(" ").includes(name); },
    },
    setAttribute() {},
    getAttribute() { return null; },
    appendChild(child) { children.push(child); return child; },
    append(...kids) { kids.forEach((kid) => children.push(kid)); return element; },
    replaceChildren(...kids) { children.length = 0; kids.forEach((kid) => children.push(kid)); },
    addEventListener(type, handler) { (element.handlers[type] ??= []).push(handler); },
    click() { (element.handlers.click ?? []).forEach((handler) => handler({})); },
    focus() {},
    scrollIntoView() {},
  };
  return element;
}

function queryByClass(root, className) {
  const found = [];
  const walk = (node) => {
    if (String(node.className ?? "").split(" ").includes(className)) found.push(node);
    (node.children ?? []).forEach(walk);
  };
  walk(root);
  return found;
}

function makeDocumentRoot() {
  const elements = new Map();
  ["feature-shell", "feature-toggle", "feature-close", "feature-nav", "feature-detail", "feature-count"]
    .forEach((id) => elements.set(id, makeElement("div")));
  const documentRoot = {
    elements,
    createElement: (tag) => {
      const element = makeElement(tag);
      element.ownerDocument = documentRoot;
      return element;
    },
    getElementById: (id) => elements.get(id) ?? null,
    addEventListener() {},
  };
  elements.forEach((element) => { element.ownerDocument = documentRoot; });
  return documentRoot;
}

test("feature detail renders a KEEP GOING strip that hands off to linked features", () => {
  const documentRoot = makeDocumentRoot();
  const seen = [];
  const navigator = createFeatureNavigator({
    documentRoot,
    projection: null,
    onFocus: (feature, method) => seen.push([feature.id, method]),
  });

  const detail = documentRoot.getElementById("feature-detail");
  const strip = queryByClass(detail, "feature-handoff");
  assert.equal(strip.length, 1, "KEEP GOING strip is rendered");
  const buttons = queryByClass(detail, "feature-handoff-action");
  const expected = FEATURE_HANDOFF_LINKS["reality-lens"];
  assert.equal(buttons.length, expected.length, "one button per handoff link");
  assert.deepEqual(
    buttons.map((button) => button.dataset.handoffTarget),
    expected,
    "buttons target the linked features in order",
  );

  const firstTarget = expected[0];
  buttons[0].click();
  assert.deepEqual(
    seen.at(-1),
    [firstTarget, "handoff"],
    "clicking a handoff button selects the linked feature with the handoff method",
  );

  // After the handoff, the new feature's detail shows its own onward links.
  const nextDetail = documentRoot.getElementById("feature-detail");
  const nextButtons = queryByClass(nextDetail, "feature-handoff-action");
  assert.deepEqual(
    nextButtons.map((button) => button.dataset.handoffTarget),
    FEATURE_HANDOFF_LINKS[firstTarget],
    "the destination feature also pushes onward — no dead ends",
  );
  assert.ok(navigator, "navigator instance returned");
});
