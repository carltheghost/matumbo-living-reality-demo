import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import { LEDGER_PROOF_SOURCE } from "../src/domains/ledger-proof.js";
import { LEDGER_PROOF_CONSOLE_SOURCE, createLedgerProofConsole, summarizeLedgerProof } from "../src/render/ledger-proof.js";

function makeElement(documentRoot, tag = "div") { return { ownerDocument: documentRoot, tagName: tag.toUpperCase(), id: "", className: "", dataset: {}, hidden: false, disabled: false, textContent: "", children: [], listeners: new Map(), attributes: new Map(), classList: { toggle() {} }, append(...children) { children.forEach((child) => this.appendChild(child)); }, appendChild(child) { this.children.push(child); return child; }, replaceChildren(...children) { this.children = children; }, addEventListener(type, callback) { this.listeners.set(type, callback); }, setAttribute(name, value) { this.attributes.set(name, String(value)); }, focus() {} }; }
function makeDocument() { const elements = new Map(); const documentRoot = { createElement(tag) { return makeElement(documentRoot, tag); }, getElementById(id) { return elements.get(id) ?? null; }, addEventListener() {} }; [["ledger-proof-console", true], ["ledger-proof-close"], ["ledger-proof-replay"], ["ledger-proof-reset"], ["ledger-proof-status"], ["ledger-proof-summary"], ["ledger-proof-current"], ["ledger-proof-ledger"], ["ledger-proof-proofs"], ["ledger-proof-trace"], ["ledger-proof-boundary"]].forEach(([id, hidden]) => { const element = makeElement(documentRoot); element.id = id; element.hidden = hidden === true; elements.set(id, element); }); return documentRoot; }

test("Prime Ledger summary joins balanced records and proof ancestry", () => {
  const summary = summarizeLedgerProof(createLivingRealityProjection().world);
  assert.equal(summary.source, LEDGER_PROOF_SOURCE); assert.equal(summary.ledgerCount, 1); assert.equal(summary.balancedCount, 1); assert.equal(summary.proofCount, 2); assert.equal(summary.ancestryEdgeCount, 1); assert.equal(summary.recordCount, 3); assert.equal(summary.ledger[0].status, "balanced"); assert.deepEqual(summary.proofs[1].parentLabels, ["Declared local root"]); assert.equal(summary.authoritative, false); assert.equal(summary.cryptographicVerification, false); assert.equal(summary.executable, false); assert.equal(Object.isFrozen(summary), true);
});

test("Prime Ledger console selects, replays proof ancestry, and resets locally", () => {
  const projection = createLivingRealityProjection().world; const before = JSON.stringify(projection); const callbacks = []; const adapter = createLedgerProofConsole({ documentRoot: makeDocument(), projection, onSelect: (snapshot) => callbacks.push(snapshot), onReplay: (snapshot) => callbacks.push(snapshot), onReset: (snapshot) => callbacks.push(snapshot) });
  const selected = adapter.selectProof("proof:projection", "test"); assert.equal(selected.source, LEDGER_PROOF_CONSOLE_SOURCE); assert.equal(selected.recordType, "proof"); assert.equal(adapter.getSnapshot().selectedId, "proof:projection"); const replay = adapter.replay("test"); assert.equal(replay.action, "replay"); assert.deepEqual(replay.sequence, ["proof:root", "proof:projection"]); adapter.reset("test"); assert.equal(adapter.getSnapshot().trace.length, 0); assert.equal(callbacks.map((item) => item.action).join(","), "select,replay,reset"); assert.equal(callbacks.every((item) => item.localOnly === true && item.simulation === true && item.executable === false), true); assert.equal(JSON.stringify(projection), before);
});

test("Prime Ledger console source exposes local boundaries and no execution path", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8"); const source = await readFile(new URL("../src/render/ledger-proof.js", import.meta.url), "utf8");
  for (const id of ["ledger-proof-console", "ledger-proof-close", "ledger-proof-replay", "ledger-proof-reset", "ledger-proof-status", "ledger-proof-summary", "ledger-proof-current", "ledger-proof-ledger", "ledger-proof-proofs", "ledger-proof-trace", "ledger-proof-boundary"]) { assert.match(html, new RegExp(`id=["']${id}["']`)); assert.match(source, new RegExp(id)); }
  assert.match(source, /function selectRecord\(/); assert.match(source, /function replay\(/); assert.doesNotMatch(source, /\bfetch\s*\(/i); assert.doesNotMatch(source, /new\s+WebSocket/i); assert.doesNotMatch(source, /navigator\.sendBeacon/i);
});
