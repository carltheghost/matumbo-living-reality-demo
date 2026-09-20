import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  PORTAL_RETURN_BOUNDARY,
  PORTAL_RETURN_SOURCE,
  createPortalReturnHandoff,
} from "../src/render/portal-return.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    tabIndex: -1,
    textContent: "",
    listeners: new Map(),
    attributes: new Map(),
    appendChild(child) { this.children ??= []; this.children.push(child); return child; },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    focus() { this.focused = true; },
    blur() { this.focused = false; },
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    register(id, hidden = false) {
      const element = makeElement(documentRoot);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
  };
  documentRoot.register("portal-return-console", true);
  documentRoot.register("portal-return-button", false);
  documentRoot.register("portal-return-status", false);
  documentRoot.register("portal-return-detail", false);
  documentRoot.register("portal-return-boundary", false);
  return documentRoot;
}

const navigation = Object.freeze({
  sourceBlockId: "block:4:0:4",
  sourceCoordinate: Object.freeze([4, 0, 4]),
  targetFeature: "rooms",
  routeId: "rooms",
  transition: "portal",
  portalTransition: "portal",
});

test("portal return stays disabled until a destination is opened", () => {
  const documentRoot = makeDocument();
  const handoff = createPortalReturnHandoff({ documentRoot });
  const snapshot = handoff.getSnapshot();
  const button = documentRoot.getElementById("portal-return-button");
  assert.equal(snapshot.opened, false);
  assert.equal(snapshot.navigation, null);
  assert.equal(button.disabled, true);
  assert.equal(snapshot.localOnly, true);
  assert.equal(snapshot.preservedDraft, true);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("portal return opens a normalized frozen handoff and returns once from a button", () => {
  const documentRoot = makeDocument();
  const returned = [];
  const handoff = createPortalReturnHandoff({
    documentRoot,
    onReturn: (snapshot) => returned.push(snapshot),
  });
  const opened = handoff.open(navigation, "portal");
  const panel = documentRoot.getElementById("portal-return-console");
  const button = documentRoot.getElementById("portal-return-button");
  assert.equal(opened.opened, true);
  assert.equal(panel.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(opened.navigation.sourceBlockId, navigation.sourceBlockId);
  assert.deepEqual(opened.navigation.sourceCoordinate, [4, 0, 4]);
  assert.equal(opened.navigation.targetFeature, "rooms");
  assert.equal(opened.navigation.navigationDraft, true);
  assert.equal(opened.navigation.externalNetwork, false);
  assert.equal(Object.isFrozen(opened.navigation), true);

  button.listeners.get("click")({ detail: 1 });
  assert.equal(returned.length, 1);
  assert.equal(returned[0].source, PORTAL_RETURN_SOURCE);
  assert.equal(returned[0].action, "return-to-cube-field");
  assert.equal(returned[0].preservedDraft, true);
  assert.equal(returned[0].preservedPortalTrace, true);
  assert.equal(returned[0].returnCount, 1);
  assert.equal(returned[0].localOnly, true);
  assert.equal(returned[0].externalNetwork, false);
  assert.equal(returned[0].persistence, false);
  assert.equal(returned[0].boundary, PORTAL_RETURN_BOUNDARY);
  assert.equal(panel.hidden, true);
  assert.equal(handoff.getSnapshot().returnCount, 1);
  assert.equal(Object.isFrozen(returned[0]), true);
});

test("portal return keyboard activation is touch-safe and does not double emit", () => {
  const documentRoot = makeDocument();
  const returned = [];
  const handoff = createPortalReturnHandoff({
    documentRoot,
    onReturn: (snapshot) => returned.push(snapshot),
  });
  const button = documentRoot.getElementById("portal-return-button");
  handoff.open(navigation, "portal");
  let prevented = false;
  button.listeners.get("keydown")({
    key: "Enter",
    isTrusted: false,
    preventDefault: () => { prevented = true; },
    stopPropagation() {},
  });
  assert.equal(prevented, true);
  assert.equal(returned.length, 1);
  // Synthetic harnesses often follow the key event with a zero-detail click.
  button.listeners.get("click")({ detail: 0 });
  assert.equal(returned.length, 1);

  handoff.open(navigation, "portal");
  button.listeners.get("click")({ detail: 0 });
  assert.equal(returned.length, 2);
  assert.equal(returned[1].method, "keyboard");
  assert.equal(returned[1].returnCount, 2);
  assert.equal(button.getAttribute("aria-keyshortcuts"), "Enter Space");
  assert.equal(button.getAttribute("aria-label"), "Return to the cube field");
});

test("portal return rejects malformed navigation atomically", () => {
  const handoff = createPortalReturnHandoff({ documentRoot: makeDocument() });
  assert.throws(() => handoff.open({ targetFeature: "rooms" }), /sourceBlockId/);
  assert.equal(handoff.getSnapshot().navigation, null);
  assert.throws(() => handoff.open({ ...navigation, sourceCoordinate: [4, 0] }), /sourceCoordinate/);
  assert.equal(handoff.getSnapshot().navigation, null);
});

test("portal return markup and source declare an accessible local handoff", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(html, /id="portal-return-console"[^>]*aria-describedby="portal-return-detail portal-return-boundary"/);
  assert.match(html, /#portal-return-console\{[^}]*z-index:70[^}]*isolation:isolate/);
  assert.match(html, /id="portal-return-button"[^>]*>RETURN TO CUBE FIELD/);
  assert.match(source, /createPortalReturnHandoff/);
  assert.match(source, /projection\.return-to-cube-field/);
  assert.match(source, /portalSurfaceOpeners/);
  assert.match(source, /rooms:\s*\(\)\s*=>\s*roomSpaces\?\.open/);
  assert.doesNotMatch(source, /portal-return.*fetch\s*\(/is);
});

test("portal handoffs retain the cube substrate while destination consoles stay local", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /portalCubeSubstrateActive/);
  assert.match(source, /PORTAL_CUBE_SUBSTRATE_FEATURES\s*=\s*new Set\(\[[\s\S]*'rooms',[\s\S]*'asset-token',[\s\S]*'contracts',[\s\S]*'paycore',[\s\S]*'t402',[\s\S]*'reality-lens',[\s\S]*\]\)/);
  assert.match(source, /portalCubeSubstrateActive\s*=\s*PORTAL_CUBE_SUBSTRATE_FEATURES\.has\(targetFeature\)/);
  assert.match(source, /isPortalCubeSubstrateHandoff\(feature\.id, method\)/);
  assert.match(source, /setBlockWorldPresentation\(true, \{[\s\S]*cubeFirstUi: feature\.id === 'block-world' \|\| feature\.id === 'runtime-sync' \|\| preserveCubeSubstrate,[\s\S]*\}\)/);
  assert.match(source, /blockWorld\?\.close\(\)/);
  assert.match(source, /portalCubeSubstrateActive\s*=\s*false;/);
  assert.match(source, /const sourceTarget = blockWorld\?\.getFocusTarget\(snapshot\?\.sourceBlockId/);
  assert.match(source, /desiredCameraPosition\.copy\(sourceTarget\)\.add/);
  assert.match(source, /function restorePortalCubeReadout\(method = 'portal'\)/);
  assert.match(source, /if \(!portalCubeSubstrateActive\) showBlockReadout\(nextBlock(?:, 'hover')?\);/);
  assert.match(source, /if \(preserveCubeSubstrate\) \{[\s\S]*restorePortalCubeReadout\(method\);[\s\S]*return;/);
  assert.match(source, /const organ = organs\.find\(\(candidate\) => candidate\.id === feature\.focusOrganId\);\s*if \(organ\) focusOrgan\(organ, `feature:\$\{method\}`\);/);
  assert.match(source, /contracts:\s*\(\)\s*=>\s*contractsMarkets\?\.open/);
  assert.match(source, /paycore:\s*\(\)\s*=>\s*paycoreConsole\?\.open/);
  assert.match(source, /t402:\s*\(\)\s*=>\s*t402Console\?\.open/);
  assert.match(source, /assetLaunchPanel\?\.classList\.add\('portal-destination-visible'\)/);
  assert.match(source, /function focusOrgan\(o,method='spatial'\)\{[\s\S]*portalCubeSubstrateActive[\s\S]*restorePortalCubeReadout\(method\)/);
  assert.doesNotMatch(source, /PORTAL_CUBE_SUBSTRATE_FEATURES\.add/);
});

test("portal substrate keeps the source cube readout stable during hover", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /if\(nextBlock\)\{[\s\S]*if \(!portalCubeSubstrateActive\) showBlockReadout\(nextBlock(?:, 'hover')?\);[\s\S]*projectionBridge\.emitIntent\('projection\.inspect-block'/);
  // Deliberate cube selection remains an intentional action and may update
  // the readout even while the portal substrate is active.
  assert.match(source, /blockWorld\.selectBlock\(block\.id, 'canvas'\);/);
  assert.match(source, /showBlockReadout\(block, action\);/);
});
