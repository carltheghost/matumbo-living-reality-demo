import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createProtocolEvidenceRail } from "../src/render/protocol-evidence.js";

function makeElement(documentRoot, tag = "div", id = "") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id,
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: "",
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
  };
}

function makeDocument() {
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById() { return null; },
  };
  return documentRoot;
}

function collectText(node) {
  return [node.textContent ?? "", ...(node.children ?? []).map(collectText)].join(" ");
}

function readyData() {
  return {
    status: "partial",
    provider: "DeFiLlama public API",
    metric: "current protocol TVL",
    unit: "USD",
    retrievedAt: "2026-08-28T12:00:00.000Z",
    records: [
      { id: "defillama-tvl:aave", protocolName: "Aave", metric: "current protocol TVL", unit: "USD", currentTvl: 123456, status: "provider-reported", retrievedAt: "2026-08-28T12:00:00.000Z", reason: null, sourceUrl: "https://defillama.com/protocol/aave" },
      { id: "defillama-tvl:uniswap", protocolName: "Uniswap", metric: "current protocol TVL", unit: "USD", currentTvl: null, status: "unavailable", retrievedAt: "2026-08-28T12:00:00.000Z", reason: "Provider unavailable", sourceUrl: "https://defillama.com/protocol/uniswap" },
    ],
    sources: [
      { id: "aave", available: true },
      { id: "uniswap", available: false },
    ],
    availableCount: 1,
    unavailableCount: 1,
    providerAvailable: true,
    providerUnavailable: false,
    liveFetch: true,
    externalNetwork: true,
    externalSource: true,
    truthClaim: false,
    executable: false,
    boundary: "Provider evidence only; no settlement authority.",
  };
}

test("protocol evidence rail is unavailable until explicit refresh and keeps provider rows separate", async () => {
  const documentRoot = makeDocument();
  const host = makeElement(documentRoot, "aside", "contracts-markets-console");
  let calls = 0;
  const rail = createProtocolEvidenceRail({
    documentRoot,
    host,
    onRefresh: async ({ method }) => {
      calls += 1;
      assert.equal(method, "button");
      return readyData();
    },
  });
  assert.equal(calls, 0);
  assert.equal(rail.getSnapshot().summary.availableCount, 0);
  assert.match(collectText(rail.root), /NO PUBLIC PROTOCOL TVL VALUE|NO DATA FABRICATED/i);
  const refreshButton = rail.root.children[0].children.find((child) => child.id === "protocol-evidence-refresh");
  assert.equal(typeof refreshButton.listeners.get("click"), "function");
  await rail.refresh("button");
  assert.equal(calls, 1);
  const snapshot = rail.getSnapshot();
  assert.equal(snapshot.summary.availableCount, 1);
  assert.equal(snapshot.summary.unavailableCount, 1);
  const rendered = collectText(rail.root);
  assert.match(rendered, /Aave/);
  assert.match(rendered, /USD 123,456/);
  assert.match(rendered, /TVL UNAVAILABLE · NO VALUE FABRICATED/);
  assert.match(rendered, /separate from scenarios|no settlement/i);
});

test("protocol evidence renderer has no network or storage path", async () => {
  const source = await readFile(new URL("../src/render/protocol-evidence.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /WebSocket|localStorage|sessionStorage|indexedDB/i);
  assert.match(source, /PROTOCOL_EVIDENCE_CONSOLE_SOURCE/);
});
