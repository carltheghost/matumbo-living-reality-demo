import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import {
  LAUNCH_COVERAGE_LENSES,
  createLaunchConsole,
  filterLaunchDistributionRows,
  summarizeLaunchDistribution,
} from "../src/render/launch-console.js";

function element(documentRoot, tag = "div", id = "") {
  return { ownerDocument: documentRoot, tagName: tag.toUpperCase(), id, className: "", dataset: {}, hidden: false, disabled: false, textContent: "", children: [], listeners: new Map(), attributes: new Map(), classList: { toggle() {} }, append(...children) { children.forEach((child) => this.appendChild(child)); }, appendChild(child) { this.children.push(child); return child; }, replaceChildren(...children) { this.children = children; }, addEventListener(type, fn) { this.listeners.set(type, fn); }, setAttribute(name, value) { this.attributes.set(name, String(value)); }, focus() {} };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = { createElement: (tag) => element(documentRoot, tag), getElementById: (id) => elements.get(id) ?? null, querySelectorAll: () => [], addEventListener() {} };
  const ids = ["launch-console", "launch-console-open", "launch-console-close", "launch-console-replay", "launch-console-status", "launch-console-event", "launch-console-reconciliation", "launch-console-selected", "launch-console-rows", "launch-console-supply", "launch-console-row-count", "launch-console-basis", "launch-console-units", "launch-console-allocation-classes", "launch-console-coverage-lens", "launch-console-coverage-lens-status", "launch-console-boundary", "launch-journey-status", "launch-journey-prev", "launch-journey-next", "launch-journey-social"];
  ids.forEach((id) => elements.set(id, element(documentRoot, "div", id)));
  LAUNCH_COVERAGE_LENSES.forEach((lens) => { const button = element(documentRoot, "button"); button.dataset.launchCoverageLens = lens.id; button.textContent = lens.label; elements.get("launch-console-coverage-lens").appendChild(button); });
  return documentRoot;
}

test("coverage lenses filter only canonical registry rows and keep canonical reconciliation exact", () => {
  const summary = summarizeLaunchDistribution(createLivingRealityProjection().world);
  assert.equal(summary.rowCount, 18);
  assert.equal(filterLaunchDistributionRows(summary.rows, "social").length, 3);
  assert.equal(filterLaunchDistributionRows(summary.rows, "county-community").length, 4);
  assert.equal(filterLaunchDistributionRows(summary.rows, "organisations").length, 3);
  assert.equal(filterLaunchDistributionRows(summary.rows, "international-funds").length, 3);
  assert.equal(filterLaunchDistributionRows(summary.rows, "grants").length, 2);
  assert.equal(filterLaunchDistributionRows(summary.rows, "reserves").length, 3);
  assert.equal(filterLaunchDistributionRows(summary.rows, "all").length, 18);
  assert.equal(Object.isFrozen(filterLaunchDistributionRows(summary.rows, "reserves")), true);
});

test("launch console coverage controls preserve selection, replay, exact totals, and denied authority", () => {
  const documentRoot = makeDocument();
  const adapter = createLaunchConsole({ documentRoot, projection: createLivingRealityProjection().world });
  const initial = adapter.getSnapshot();
  assert.equal(initial.visibleRowCount, 18);
  assert.equal(initial.totalBasisPoints, 10_000);
  assert.equal(initial.totalUnits, 1_000_000_000);
  const chosen = initial.rows[13];
  adapter.select(chosen.id, "test-select");
  const filtered = adapter.setCoverageLens("grants", "test-filter");
  assert.equal(filtered.coverageLens, "grants");
  assert.equal(filtered.visibleRowCount, 2);
  assert.equal(filtered.visibleRows.every((row) => row.recipientClass === "ecosystem-grants"), true);
  assert.equal(filtered.totalBasisPoints, 10_000);
  assert.equal(filtered.totalUnits, 1_000_000_000);
  assert.equal(filtered.selectedCohort.recipientClass, "ecosystem-grants");
  assert.equal(Object.isFrozen(filtered), true);
  const lensStatus = documentRoot.getElementById("launch-console-coverage-lens-status");
  assert.match(lensStatus.textContent, /GRANTS · 2\/18 ROWS/);
  assert.match(lensStatus.textContent, /CANONICAL TOTALS UNCHANGED/);
  const lensButtons = documentRoot.getElementById("launch-console-coverage-lens").children;
  assert.equal([...lensButtons].find((button) => button.dataset.launchCoverageLens === "grants").attributes.get("aria-pressed"), "true");
  assert.equal([...lensButtons].find((button) => button.dataset.launchCoverageLens === "all").attributes.get("aria-pressed"), "false");
  assert.equal(documentRoot.getElementById("launch-console-rows").children.length, 2);
  const replay = adapter.replay("test-replay");
  assert.equal(replay.rowCount, 18);
  assert.equal(replay.totalBasisPoints, 10_000);
  assert.equal(replay.totalUnits, 1_000_000_000);
  assert.equal(replay.coverageLens, "grants");
  assert.equal(replay.externalTransfer, false);
  adapter.setCoverageLens("all", "test-reset-lens");
  assert.equal(adapter.getSnapshot().visibleRowCount, 18);
  assert.equal(adapter.getSnapshot().selectedId, chosen.id);
});

test("coverage lens controls are statically mounted and renderer-only", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/launch-console.js", import.meta.url), "utf8");
  assert.match(html, /id=["']launch-console-coverage-lens["']/);
  assert.match(html, /data-launch-coverage-lens=["']social["']/);
  for (const label of ["ALL", "SOCIAL", "COUNTY\/COMMUNITY", "ORGANISATIONS", "INTERNATIONAL FUNDS", "GRANTS", "RESERVES"]) assert.match(html, new RegExp(label));
  assert.match(source, /filterLaunchDistributionRows/);
  assert.match(source, /CANONICAL TOTALS UNCHANGED/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
});
