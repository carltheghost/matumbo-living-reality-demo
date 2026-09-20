import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import {
  LAUNCH_CONSOLE_SOURCE,
  LAUNCH_JOURNEY_STEPS,
  summarizeLaunchDistribution,
} from "../src/render/launch-console.js";

test("launch console reads every canonical fictional registry row and exact totals", () => {
  const projection = createLivingRealityProjection().world;
  const summary = summarizeLaunchDistribution(projection);
  assert.equal(summary.source, LAUNCH_CONSOLE_SOURCE);
  assert.equal(summary.rowCount, 18);
  assert.equal(summary.totalBasisPoints, 10_000);
  assert.equal(summary.expectedBasisPoints, 10_000);
  assert.equal(summary.totalUnits, 1_000_000_000);
  assert.equal(summary.expectedUnits, 1_000_000_000);
  assert.equal(summary.totalSupply, 1_000_000_000);
  assert.equal(summary.rows.every((row) => row.simulation && row.aggregate && !row.executable), true);
  const labels = summary.rows.map((row) => row.label).join(" | ").toLowerCase();
  for (const required of ["county", "organisation", "international", "grant", "treasury", "operations", "insurance"]) {
    assert.match(labels, new RegExp(required), `registry includes ${required} cohort`);
  }
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.rows), true);
});

test("launch console summary is deterministic and replay-safe", () => {
  const first = summarizeLaunchDistribution(createLivingRealityProjection().world);
  const second = summarizeLaunchDistribution(createLivingRealityProjection().world);
  assert.deepEqual(second, first);
  assert.equal(first.eventId, "distribution-event:tumbo-demo-launch");
  assert.equal(first.launchId, "distribution:tumbo-demo-launch");
  assert.equal(first.externalDistribution, false);
  assert.equal(first.executable, false);
});

test("launch journey is an explicit four-step local handoff", async () => {
  assert.deepEqual(
    LAUNCH_JOURNEY_STEPS.map(({ id }) => id),
    ["prepare", "reveal", "registry", "social"],
  );
  assert.equal(LAUNCH_JOURNEY_STEPS.every((step) => step.label && step.title && step.detail), true);
  assert.equal(Object.isFrozen(LAUNCH_JOURNEY_STEPS), true);
  assert.equal(Object.isFrozen(LAUNCH_JOURNEY_STEPS[0]), true);
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/launch-console.js", import.meta.url), "utf8");
  for (const id of ["launch-journey", "launch-journey-status", "launch-journey-prev", "launch-journey-next", "launch-journey-social"]) {
    assert.match(html, new RegExp(`id=[\"']${id}[\"']`));
  }
  for (const step of ["prepare", "reveal", "registry", "social"]) {
    assert.match(html, new RegExp(`data-launch-journey-step=[\"']${step}[\"']`));
  }
  assert.match(source, /onJourney/);
  assert.match(source, /setJourneyStep/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
});

test("launch console markup exposes local replay and no external execution surface", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/launch-console.js", import.meta.url), "utf8");
  for (const id of [
    "launch-console",
    "launch-console-rehearse",
    "launch-console-replay",
    "launch-console-rows",
    "launch-console-event",
    "launch-console-reconciliation",
    "launch-console-rehearsal-status",
    "launch-console-coverage-lens",
    "launch-console-coverage-lens-status",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  for (const lens of ["all", "social", "county-community", "organisations", "international-funds", "grants", "reserves"]) {
    assert.match(html, new RegExp(`data-launch-coverage-lens=["']${lens}["']`));
  }
  assert.match(html, /Launch Distribution Console/);
  assert.match(html, /Reconcile fictional aggregate registry/i);
  assert.match(html, /Enable local TUMBO-SIM rehearsal/i);
  assert.match(html, /FULL REGISTRY REHEARSAL NOT RUN/i);
  assert.match(html, /Run local launch preview/i);
  assert.match(source, /onRehearse|function rehearse/);
  assert.match(source, /distribution\.launch-distribution-console-replay|onReplay/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
});

test("TUMBO-SIM operator rehearsal is default-off and fail-closed", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/launch-console.js", import.meta.url), "utf8");
  assert.match(html, /launch-console-simulation-toggle/);
  assert.match(source, /let simulationDistributionEnabled = false/);
  assert.match(source, /kind === "local-demo-operator"/);
  assert.match(source, /LOCAL DEMO OPERATOR · TUMBO-SIM REHEARSAL/);
  assert.match(source, /LOCAL REHEARSAL DISABLED · ENABLE LOCAL TUMBO-SIM REHEARSAL FIRST · NO TRANSFER/);
  assert.match(source, /status: "denied"/);
  for (const flag of ["localOnly: true", "authority: \"none\"", "executable: false", "externalTransfer: false", "walletConnection: false", "custody: false", "signing: false", "settlement: false", "issuance: false", "money: false"]) {
    assert.match(source, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\s*\(/i);
});

test("one local launch rehearsal opens a fresh cohort receipt from the canonical projection", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = main.indexOf("onRehearse: (request) => {");
  const end = main.indexOf("onReplay: (replay)", start);
  assert.ok(start >= 0 && end > start, "expected the launch rehearsal callback");
  const handoff = main.slice(start, end);
  assert.match(handoff, /createLaunchDistributionRehearsal\(/);
  assert.match(handoff, /launchReceipt\?\.syncProjection\(livingRealityWorld\)/);
  assert.match(handoff, /launchConsole\?\.close\(\)/);
  assert.match(handoff, /launchReceipt\?\.open\(\)/);
  assert.match(handoff, /issuance: false,[\s\S]*?money: false,[\s\S]*?executable: false/);
  assert.doesNotMatch(handoff, /\bfetch\s*\(/i);
});
