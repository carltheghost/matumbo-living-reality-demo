import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import {
  SOCIAL_EXPLORER_CAPABILITIES,
  SOCIAL_EXPLORER_SOURCE,
  SOCIAL_EXPLORER_FLOW_INTENTS,
  SOCIAL_EXPLORER_LAUNCH_MODES,
  SOCIAL_EXPLORER_LAUNCH_PHASES,
  SOCIAL_EXPLORER_LAUNCH_PHASE_IDS,
  advanceSocialExplorerFlow,
  advanceSocialExplorerLaunchPhase,
  createSocialExplorerFlowDraft,
  createSocialExplorerLaunchPlan,
  createSocialExplorerContribution,
  resetSocialExplorerFlow,
  resetSocialExplorerLaunchPlan,
  selectSocialExplorerLaunchMode,
} from "../src/domains/social-explorer.js";
import {
  SOCIAL_EXPLORER_CONSOLE_SOURCE,
  createSocialExplorerConsole,
  summarizeSocialExplorer,
  summarizeSocialExplorerLaunchPlan,
} from "../src/render/social-explorer.js";
import {
  SOCIAL_PULSE_BOUNDARY,
  SOCIAL_PULSE_SOURCE,
  createUnavailableSocialPulse,
} from "../src/domains/social-pulse.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: "",
    title: "",
    type: "",
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    classList: { toggle() {} },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    focus() {},
  };
}

function makeSocialExplorerDocument({ includeLaunchMounts = true } = {}) {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  const required = [
    ["social-explorer-console", true],
    ["social-explorer-close"],
    ["social-explorer-replay"],
    ["social-explorer-status"],
    ["social-explorer-room-count"],
    ["social-explorer-card-count"],
    ["social-explorer-signal-count"],
    ["social-explorer-action-count"],
    ["social-explorer-rooms"],
    ["social-explorer-cards"],
    ["social-explorer-signals"],
    ["social-explorer-actions"],
    ["social-explorer-trace"],
  ];
  const optional = [
    "social-explorer-reset",
    "social-explorer-flow-next",
    "social-explorer-action-status",
    "social-explorer-selection",
    "social-explorer-boundary",
    "social-explorer-flow-status",
    "social-explorer-flow-steps",
    "social-explorer-allocation-preview",
  ];
  if (includeLaunchMounts) optional.push(
    "social-explorer-launch-modes",
    "social-explorer-launch-phases",
    "social-explorer-launch-status",
    "social-explorer-launch-next",
    "social-explorer-launch-reset",
    "social-explorer-launch-participation",
    "social-explorer-launch-allocation",
  );
  optional.push(
    "social-explorer-public-pulse-refresh",
    "social-explorer-public-pulse-status",
    "social-explorer-public-pulse-summary",
    "social-explorer-public-pulse-records",
    "social-explorer-public-pulse-boundary",
  );
  [...required, ...optional.map((id) => [id])].forEach(([id, hidden]) => {
    const element = makeElement(documentRoot);
    element.id = id;
    element.hidden = hidden === true;
    elements.set(id, element);
  });
  return documentRoot;
}

test("social explorer contributes a complete frozen fictional catalog", () => {
  const contribution = createSocialExplorerContribution();
  assert.equal(contribution.source, SOCIAL_EXPLORER_SOURCE);
  assert.equal(contribution.rooms.length, 4);
  assert.equal(contribution.creatorCards.length, 6);
  assert.equal(contribution.discoverySignals.length, 6);
  assert.equal(contribution.rehearsalActions.length, 4);
  assert.equal(contribution.entities.length, 20);
  assert.equal(contribution.rehearsal.steps.length, 4);
  assert.deepEqual(
    contribution.rehearsal.steps.map((step) => step.intent),
    ["discover", "discuss", "create", "allocate-preview"],
  );
  assert.equal(Object.isFrozen(contribution), true);
  assert.equal(Object.isFrozen(contribution.rooms), true);
  assert.equal(Object.isFrozen(contribution.rooms[0]), true);
  assert.equal(Object.isFrozen(contribution.rehearsal.steps[0]), true);
  assert.equal(
    contribution.entities.every((entity) => (
      entity.simulation === true
      && entity.fictional === true
      && entity.aggregate === true
      && entity.authority === "none"
      && entity.externalNetwork === false
      && entity.externalTransfer === false
      && entity.executable === false
    )),
    true,
  );
});

test("social explorer replay is deterministic and has no recipient or market authority", () => {
  const first = createSocialExplorerContribution();
  const second = createSocialExplorerContribution();
  assert.deepEqual(second, first);
  assert.equal(first.rehearsal.localOnly, true);
  assert.equal(first.rehearsal.externalNetwork, false);
  assert.equal(first.rehearsal.assetLaunchId, "distribution:tumbo-demo-launch");
  assert.equal(first.rehearsalActions.every((action) => action.status === "frozen-preview"), true);
  const keys = new Set();
  const collectKeys = (value) => {
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([key, nested]) => {
      keys.add(key);
      collectKeys(nested);
    });
  };
  collectKeys(first);
  for (const forbiddenField of ["recipientAddress", "walletAddress", "privateKey", "signature", "tradingPair", "orderBook"]) {
    assert.equal(keys.has(forbiddenField), false, `no ${forbiddenField} field in social catalog`);
  }
  const denied = SOCIAL_EXPLORER_CAPABILITIES.filter((capability) => capability.denied === true);
  assert.equal(denied.length, 4);
  assert.equal(denied.every((capability) => capability.executable === false), true);
});

test("social explorer summary joins the canonical projection and replays locally", () => {
  const projection = createLivingRealityProjection().world;
  const first = summarizeSocialExplorer(projection);
  const second = summarizeSocialExplorer(projection);
  assert.equal(first.source, SOCIAL_EXPLORER_CONSOLE_SOURCE);
  assert.equal(first.roomCount, 4);
  assert.equal(first.creatorCardCount, 6);
  assert.equal(first.discoverySignalCount, 6);
  assert.equal(first.actionCount, 4);
  assert.equal(first.stepCount, 4);
  assert.equal(first.simulation, true);
  assert.equal(first.deterministic, true);
  assert.equal(first.localOnly, true);
  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.rooms), true);
  assert.equal(Object.isFrozen(first.steps), true);
  assert.deepEqual(first.flowIntents, SOCIAL_EXPLORER_FLOW_INTENTS);
  assert.deepEqual(first.launchPlan.modes.map((mode) => mode.id), ["social-experiment", "space-explorer"]);
  assert.deepEqual(first.launchPlan.phaseSequence, SOCIAL_EXPLORER_LAUNCH_PHASE_IDS);
  assert.equal(first.launchPlan.participationPolicy, "opt-in-only");
  assert.equal(first.launchPlan.distributionStatus, "preview-only");
  assert.equal(first.launchPlan.allocationPreview.source, "tumbo-distribution-registry");
  assert.equal(first.allocationPreview.localOnly, true);
  assert.equal(first.allocationPreview.externalTransfer, false);
  assert.equal(first.allocationPreview.available, true);
  assert.equal(first.allocationPreview.classCount, 8);
  assert.equal(first.allocationPreview.rowCount, 18);
  assert.equal(first.allocationPreview.totalBasisPoints, 10_000);
  assert.equal(first.allocationPreview.expectedBasisPoints, 10_000);
  assert.equal(first.allocationPreview.totalUnits, 1_000_000_000);
  assert.equal(first.allocationPreview.expectedUnits, 1_000_000_000);
  assert.equal(first.allocationPreview.complete, true);
  assert.equal(first.allocationPreview.allocationClasses.every((allocation) => allocation.complete), true);
  const allocationLabels = first.allocationPreview.allocationClasses.map((allocation) => allocation.label.toLowerCase()).join(" | ");
  for (const required of ["county", "organisation", "international", "grant", "treasury", "operations"]) {
    assert.match(allocationLabels, new RegExp(required), `allocation preview includes ${required} class`);
  }
});

test("social explorer guided flow advances in order, rejects skips, and resets immutably", () => {
  const initial = createSocialExplorerFlowDraft();
  const skipped = advanceSocialExplorerFlow(initial, "create");
  assert.equal(skipped.accepted, false);
  assert.equal(skipped.rejected, true);
  assert.equal(skipped.nextIntent, "discover");
  assert.deepEqual(initial.completedIntents, []);

  let flow = initial;
  SOCIAL_EXPLORER_FLOW_INTENTS.forEach((intent, index) => {
    flow = advanceSocialExplorerFlow(flow, intent);
    assert.equal(flow.accepted, true);
    assert.equal(flow.stepIndex, index + 1);
  });
  assert.equal(flow.complete, true);
  const completeReject = advanceSocialExplorerFlow(flow, "discover");
  assert.equal(completeReject.accepted, false);
  assert.match(completeReject.reason, /complete/);
  const reset = resetSocialExplorerFlow(flow);
  assert.equal(reset.action, "reset");
  assert.equal(reset.stepIndex, 0);
  assert.deepEqual(reset.completedIntents, []);
  assert.equal(Object.isFrozen(reset), true);
  assert.equal(Object.isFrozen(reset.completedIntents), true);
});

test("social explorer launch plan exposes two opt-in modes and a frozen ordered preview", () => {
  const first = createSocialExplorerLaunchPlan();
  const second = createSocialExplorerLaunchPlan();
  const custom = createSocialExplorerContribution({ updatedAt: "2025-02-03T04:05:06.000Z" });
  assert.deepEqual(second, first);
  assert.equal(custom.launchPlan.updatedAt, "2025-02-03T04:05:06.000Z");
  assert.deepEqual(first.modes.map((mode) => mode.id), ["social-experiment", "space-explorer"]);
  assert.deepEqual(first.phaseSequence, ["opt-in", "explore", "create", "allocate-preview"]);
  assert.deepEqual(first.phaseSequence, SOCIAL_EXPLORER_LAUNCH_PHASE_IDS);
  assert.deepEqual(first.phases.map((phase) => phase.id), SOCIAL_EXPLORER_LAUNCH_PHASES.map((phase) => phase.id));
  assert.equal(first.participationPolicy, "opt-in-only");
  assert.equal(first.participationStatus, "opt-in-not-recorded");
  assert.equal(first.optInRequired, true);
  assert.equal(first.distributionStatus, "preview-only");
  assert.equal(first.allocationPreview.source, "tumbo-distribution-registry");
  assert.equal(first.allocationPreview.launchId, "distribution:tumbo-demo-launch");
  assert.equal(first.allocationPreview.canonical, true);
  assert.equal(first.allocationPreview.duplicateSchedule, false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.modes), true);
  assert.equal(Object.isFrozen(first.modes[0]), true);
  assert.equal(Object.isFrozen(first.phases), true);
  assert.equal(Object.isFrozen(first.allocationPreview), true);
  assert.equal(SOCIAL_EXPLORER_LAUNCH_MODES.every((mode) => (
    mode.participation === "opt-in"
      && mode.optIn === true
      && mode.optInOnly === true
      && mode.optInRequired === true
      && mode.participantStatus === "not-enrolled"
      && mode.externalNetwork === false
      && mode.executable === false
  )), true);

  const switched = selectSocialExplorerLaunchMode(first, "space-explorer");
  assert.equal(switched.modeId, "space-explorer");
  assert.equal(switched.phaseIndex, 0);
  const skipped = advanceSocialExplorerLaunchPhase(switched, "create");
  assert.equal(skipped.accepted, false);
  assert.equal(skipped.rejected, true);
  assert.equal(skipped.nextPhaseId, "opt-in");

  let complete = switched;
  SOCIAL_EXPLORER_LAUNCH_PHASE_IDS.forEach((phaseId, index) => {
    complete = advanceSocialExplorerLaunchPhase(complete, phaseId);
    assert.equal(complete.accepted, true);
    assert.equal(complete.phaseIndex, index + 1);
  });
  assert.equal(complete.complete, true);
  const completeReject = advanceSocialExplorerLaunchPhase(complete, "opt-in");
  assert.equal(completeReject.rejected, true);
  assert.match(completeReject.reason, /complete/);
  const reset = resetSocialExplorerLaunchPlan(complete);
  assert.equal(reset.modeId, "space-explorer");
  assert.equal(reset.phaseIndex, 0);
  assert.equal(reset.action, "reset");
  assert.equal(Object.isFrozen(reset), true);

  const keys = new Set();
  const collectKeys = (value) => {
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([key, nested]) => {
      keys.add(key);
      collectKeys(nested);
    });
  };
  collectKeys(first);
  for (const forbiddenField of ["recipientAddress", "walletAddress", "privateKey", "signature", "tradingPair", "orderBook", "tokenUnits", "shareBasisPoints"]) {
    assert.equal(keys.has(forbiddenField), false, `launch plan has no ${forbiddenField} field`);
  }
});

test("social explorer launch-plan renderer API is DOM-safe and preserves local traces", () => {
  const documentRoot = makeSocialExplorerDocument();
  const console = createSocialExplorerConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
  });
  const initial = console.getSnapshot();
  assert.equal(initial.launchPlan.modeId, "social-experiment");
  assert.equal(initial.launchPlan.phaseIndex, 0);
  assert.equal(documentRoot.getElementById("social-explorer-launch-modes").children.length, 2);
  assert.equal(documentRoot.getElementById("social-explorer-launch-phases").children.length, 4);
  assert.match(documentRoot.getElementById("social-explorer-launch-participation").textContent, /OPT-IN-ONLY/);
  assert.match(documentRoot.getElementById("social-explorer-launch-allocation").textContent, /PREVIEW-ONLY/);

  const switched = console.selectLaunchMode("space-explorer", "test");
  assert.equal(switched.accepted, true);
  assert.equal(switched.launchPlan.modeId, "space-explorer");
  const skipped = console.advanceLaunchPhase("create", "test");
  assert.equal(skipped.accepted, false);
  assert.equal(skipped.rejected, true);
  assert.equal(skipped.launchPlan.phaseIndex, 0);

  SOCIAL_EXPLORER_LAUNCH_PHASE_IDS.forEach((phaseId, index) => {
    const event = console.advanceLaunchPhase(phaseId, "test");
    assert.equal(event.accepted, true);
    assert.equal(event.launchPlan.phaseIndex, index + 1);
  });
  const complete = console.getSnapshot();
  assert.equal(complete.launchPlan.complete, true);
  assert.equal(complete.launchPlan.distributionStatus, "preview-only");
  assert.equal(complete.launchPlanTrace.length, 6);
  assert.equal(Object.isFrozen(complete.launchPlanTrace), true);

  const reset = console.resetLaunchPlan("test");
  assert.equal(reset.action, "reset-launch-plan");
  assert.equal(reset.launchPlan.phaseIndex, 0);
  assert.equal(console.getSnapshot().launchPlanTrace.length, 7);
  const replay = console.replayLaunchPlan("test");
  assert.equal(replay.action, "replay-launch-plan");
  assert.equal(replay.launchPlan.complete, true);
  assert.equal(replay.launchPlan.replayCount, 1);
  assert.equal(console.getSnapshot().launchPlanTrace.length, 8);

  // The API remains usable when a host has not supplied launch-specific DOM.
  const withoutLaunchMarkup = createSocialExplorerConsole({
    documentRoot: makeSocialExplorerDocument({ includeLaunchMounts: false }),
    projection: createLivingRealityProjection().world,
  });
  assert.doesNotThrow(() => withoutLaunchMarkup.selectLaunchMode("space-explorer"));
  assert.doesNotThrow(() => withoutLaunchMarkup.advanceLaunchPhase("opt-in"));
  assert.doesNotThrow(() => withoutLaunchMarkup.resetLaunchPlan());
  assert.equal(withoutLaunchMarkup.getSnapshot().launchPlan.modeId, "space-explorer");
});

test("Social Explorer public pulse stays separate, explicit, text-only, and fails closed", async () => {
  const documentRoot = makeSocialExplorerDocument();
  const refreshCalls = [];
  const publicPulse = createUnavailableSocialPulse({
    retrievedAt: "2026-08-28T12:00:00.000Z",
    reason: "No public pulse refresh has completed.",
  });
  const console = createSocialExplorerConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    publicPulse,
    onPublicPulseRefresh: async (request) => {
      refreshCalls.push(request);
      return {
        ...publicPulse,
        source: SOCIAL_PULSE_SOURCE,
        provider: "Bluesky public AppView",
        actor: "atproto.com",
        requestedLimit: 8,
        retrievedAt: "2026-08-28T12:03:00.000Z",
        status: "ready",
        providerAvailable: true,
        externalNetwork: true,
        records: [{
          id: "bluesky:post:sample",
          authorHandle: "atproto.com",
          authorDisplayName: "AT Protocol Developers",
          text: "Public text observation.",
          publishedAt: "2026-08-28T11:59:00.000Z",
          indexedAt: "2026-08-28T11:59:01.000Z",
          sourceUrl: "https://bsky.app/profile/atproto.com/post/3sample",
          replyCount: 1,
          repostCount: 2,
          likeCount: 3,
          mediaPresent: true,
        }],
      };
    },
  });
  const status = documentRoot.getElementById("social-explorer-public-pulse-status");
  const summary = documentRoot.getElementById("social-explorer-public-pulse-summary");
  const records = documentRoot.getElementById("social-explorer-public-pulse-records");
  assert.match(status.textContent, /UNAVAILABLE/);
  assert.equal(records.children.length, 1);
  assert.match(records.children[0].textContent, /No public pulse refresh/);
  assert.equal(publicPulse.boundary, SOCIAL_PULSE_BOUNDARY);

  await console.refreshPublicPulse("test");
  assert.deepEqual(refreshCalls, [{ actor: "atproto.com", limit: 8, method: "test" }]);
  assert.match(status.textContent, /READY/);
  assert.match(summary.textContent, /PUBLIC-SOCIAL-PULSE-BLUESKY/i);
  assert.match(summary.textContent, /RETURNED · 1\/8/);
  assert.equal(records.children.length, 1);
  assert.equal(records.children[0].tagName, "ARTICLE");
  assert.equal(records.children[0].children.some((child) => child.tagName === "IMG"), false);
  assert.equal(records.children[0].children.some((child) => /UNTRUSTED/.test(child.textContent)), true);
  const snapshot = console.getSnapshot();
  assert.equal(snapshot.publicPulse.status, "ready");
  assert.equal(snapshot.publicPulse.metadataOnly, true);
  assert.equal(snapshot.publicPulse.mediaBytesFetched, false);
  assert.equal(snapshot.publicPulse.identityResolution, false);
  assert.equal(snapshot.publicPulse.externalNetwork, true);
});

test("social explorer console is visible, browsable, and network-free", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/social-explorer.js", import.meta.url), "utf8");
  for (const id of [
    "social-explorer-console",
    "social-explorer-replay",
    "social-explorer-rooms",
    "social-explorer-cards",
    "social-explorer-signals",
    "social-explorer-actions",
    "social-explorer-action-status",
    "social-explorer-reset",
    "social-explorer-flow-next",
    "social-explorer-flow-status",
    "social-explorer-flow-steps",
    "social-explorer-allocation-preview",
    "social-explorer-trace",
    "social-explorer-status",
    "social-explorer-boundary",
    "social-explorer-public-pulse",
    "social-explorer-public-pulse-refresh",
    "social-explorer-public-pulse-status",
    "social-explorer-public-pulse-summary",
    "social-explorer-public-pulse-records",
    "social-explorer-public-pulse-boundary",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /Social Explorer/i);
  assert.match(html, /Re-market/i);
  assert.match(html, /Replay local social rehearsal/i);
  assert.match(html, /Re-market rehearsal actions/i);
  assert.match(html, /TUMBO asset-token/i);
  assert.match(html, /Public social pulse/i);
  assert.match(html, /Refresh public pulse/i);
  assert.match(source, /onAction/);
  assert.match(source, /function act\(/);
  assert.match(source, /function selectLaunchMode\(/);
  assert.match(source, /function advanceLaunchPhase\(/);
  assert.match(source, /function resetLaunchPlan\(/);
  assert.match(source, /function replayLaunchPlan\(/);
  assert.match(source, /function refreshPublicPulse\(/);
  assert.match(source, /onPublicPulseRefresh/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /navigator\.sendBeacon/i);
});

test("social explorer mobile layout keeps controls touch-safe and rows readable", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/social-explorer.js", import.meta.url), "utf8");

  // The console must scroll as one surface rather than flex-shrinking sibling
  // grids into one another when the 390x844 route is full of local entries.
  assert.match(html, /#social-explorer-console\{[^}]*overflow-x:hidden;overflow-y:auto/);
  assert.match(html, /#social-explorer-console> \*\{flex:0 0 auto\}/);
  assert.match(html, /#social-explorer-console\{[^}]*overscroll-behavior:contain/);

  // Every actionable control has a 44px minimum target, including generated
  // catalog rows and the generated rehearsal action buttons.
  assert.match(html, /#social-explorer-close\{[^}]*min-width:44px;min-height:44px/);
  assert.match(html, /#social-explorer-replay,#social-explorer-reset,#social-explorer-flow-next\{[^}]*min-height:44px/);
  assert.match(html, /#launch-kit-open,#social-launch-kit-open\{[^}]*min-height:44px/);
  assert.match(html, /\.social-explorer-action\{[^}]*min-height:44px/);
  assert.match(html, /\.social-explorer-entry\{[^}]*min-height:44px/);

  // Action and flow copy wraps instead of being forced into a clipped single
  // line; flow/trace rows keep intrinsic height so text cannot overlap.
  assert.match(html, /\.social-explorer-action-title\{[^}]*overflow-wrap:anywhere/);
  assert.match(html, /\.social-explorer-action-meta\{[^}]*overflow-wrap:anywhere/);
  assert.match(html, /\.social-explorer-flow-step\{[^}]*min-height:44px/);
  assert.match(html, /\.social-explorer-flow-copy\{[^}]*overflow-wrap:anywhere/);
  assert.match(html, /\.social-explorer-flow-state\{[^}]*overflow-wrap:anywhere/);
  assert.match(html, /\.social-explorer-trace-step\{[^}]*min-height:40px/);
  assert.match(html, /@media\(max-width:700px\)\{#social-explorer-flow-steps\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(html, /@media\(max-width:700px\)\{#social-explorer-trace\{max-height:11vh\}\}/);

  // Renderer-generated catalog/actions remain native buttons, while ordered
  // flow steps stay readable status rows with aria-current state.
  assert.match(source, /documentRoot\.createElement\("button"\)/);
  assert.match(source, /item\.type = "button"/);
  assert.match(source, /step\.setAttribute\("aria-current", next === intent \? "step" : "false"\)/);
  assert.doesNotMatch(source, /style\.height/);
  assert.doesNotMatch(source, /style\.maxHeight/);
});
