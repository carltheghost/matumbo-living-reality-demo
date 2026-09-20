import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("World Pulse is mounted as a real-source route over the cube-only field", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/render/world-events.js", import.meta.url), "utf8");
  const navigator = await readFile(new URL("../src/render/feature-navigator.js", import.meta.url), "utf8");
  const launchKit = await readFile(new URL("../src/domains/launch-kit.js", import.meta.url), "utf8");

  for (const id of [
    "world-events-projection",
    "world-events-projection-open",
    "world-events-projection-status",
    "world-events-projection-summary",
    "world-events-projection-providers",
    "world-events-projection-bands",
    "world-events-projection-boundary",
    "world-events-console",
    "world-events-refresh",
    "world-events-sources",
    "world-events-records",
    "world-events-current",
    "world-events-legend",
    "world-events-signal-lens",
    "world-events-signal-field",
    "world-events-reality-brutality",
    "world-events-map-cells",
    "world-events-query-control",
    "world-events-query-input",
    "world-events-query-refresh",
    "world-events-order-lens",
    "world-events-order-status",
    "world-events-humanitarian",
    "world-events-humanitarian-status",
    "world-events-humanitarian-records",
    "world-events-humanitarian-boundary",
    "world-events-boundary",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /What is happening around the world/);
  assert.match(html, /No graphic imagery is loaded/);
  assert.match(html, /No fabricated fallback records/);
  assert.match(html, /title-language signals|title-language signal/i);
  assert.match(html, /DERIVED SIGNAL FIELD|Derived global title-language signal field/i);
  assert.match(html, /REALITY \/ BRUTALITY CONTEXT|Returned title-language reality and brutality bands/i);
  assert.match(html, /GLOBAL MAP CELLS|Broad provider-coordinate map cells/i);
  assert.match(html, /Collect \/ refresh/i);
  assert.match(html, /id="world-events-open"[^>]*data-world-pulse-action="project-live"[^>]*>PROJECT LIVE WORLD PULSE<\/button>/i);
  assert.match(html, /id="world-events-project"[^>]*>PROJECT FIELD<\/button>/i);
  assert.match(html, /id="world-events-projection-open"[^>]*>OPEN CONSOLE<\/button>/i);
  assert.match(html, /LIVE WORLD FIELD/);
  assert.match(html, /NO VERIFIED BRUTALITY, SEVERITY, CASUALTY, TRUTH, OR COMPLETENESS CLAIM/i);
  assert.match(html, /id="world-events-projection-bands"[^>]*role="group"/i);
  assert.match(renderer, /world-events-projection-band/);
  assert.match(renderer, /dataset\.worldEventsProjectionBand/);
  assert.match(renderer, /aria-label.*filter and focus first matching cube/i);
  assert.match(renderer, /setSignalLens\(nextLens, "projection-band"\)/);
  assert.match(renderer, /selectRecord\(firstRecordId, "projection-band"\)/);
  assert.match(main, /fetchWorldEvents/);
  assert.match(main, /createUnavailableWorldEvents/);
  assert.match(main, /worldQuery/);
  assert.match(main, /refresh\(method, \{ query: options\.query \}\)/);
  assert.match(main, /renderWorldEvidenceCubes/);
  assert.match(main, /humanitarianRecords/);
  assert.match(main, /worldEvidenceKind = 'humanitarian'/);
  assert.match(main, /worldEvidenceHumanitarian = true/);
  assert.match(main, /worldEvidenceObservedYear/);
  assert.match(main, /worldEvidenceMetricCount/);
  assert.match(main, /metric:\$\{field\}/);
  assert.match(main, /STRUCTURED HUMANITARIAN EVIDENCE/);
  assert.match(main, /severity unknown.*intensity unknown/i);
  assert.match(main, /worldEvidenceBrutalityLevel/);
  assert.match(main, /beginWorldEvidenceManipulation/);
  assert.match(main, /toggleWorldEvidenceOpen/);
  assert.match(html, /double-activate it to open source, time, and place cubes/i);
  assert.match(html, /headline signal cube/i);
  assert.match(html, /STRUCTURED HUMANITARIAN EVIDENCE/i);
  assert.match(html, /UNHCR metrics are provider-reported annual population observations/i);
  assert.match(html, /data-world-events-lens=["']explicit["']/i);
  assert.match(html, /data-world-events-order-lens=["']event-time["']/i);
  assert.match(html, /data-world-events-order-lens=["']signal-first["']/i);
  assert.match(main, /filter-world-event-evidence/);
  assert.match(main, /mapCellId/);
  assert.match(main, /brutalityLanguageSignal\?\.level|worldEvidenceBrutalityLevel/);
  assert.match(main, /worldEvidenceInnerKind.*signal|title-language signal/s);
  assert.match(main, /worldEventsConsole\?\.refresh/);
  assert.match(main, /worldEventsConsole\?\.open/);
  assert.match(main, /const worldProjection = new URLSearchParams\(globalThis\.location\?\.search \?\? ''\)\.get\('projection'\)/);
  assert.match(main, /projectField: worldProjection === 'field' \|\| worldProjection === 'live'/);
  assert.match(main, /options\.projectField === true[\s\S]*worldEventsConsole\?\.projectField\?\.\('url'\)/);
  assert.match(main, /onProject:\s*\(snapshot\)[\s\S]{0,260}focusWorldEvidenceField/);
  assert.match(main, /function focusWorldEvidenceField/);
  assert.match(main, /new THREE\.Box3\(\)\.setFromObject\(worldEvidenceLayer\)/);
  assert.match(main, /worldEvidenceField:\s*getWorldEvidenceFieldCameraSnapshot\(\)/);
  assert.match(main, /__TUMBO_WORLD_EVENTS_CAMERA__/);
  assert.match(main, /projection\.focus-world-evidence-field/);
  assert.match(main, /snapshot\?\.method === 'projection-band'/);
  assert.match(main, /function focusWorldEvidenceRecord/);
  assert.match(main, /projection\.focus-world-evidence-record/);
  assert.match(main, /const worldSignal = new URLSearchParams/);
  assert.match(main, /signalLens: worldSignal/);
  assert.match(main, /setSignalLens\?\.\(options\.signalLens, 'url'\)/);
  assert.equal((main.match(/openWorldEvents\('launch-kit-world-pulse'\)/g) ?? []).length, 1);
  assert.match(main, /document\.getElementById\('world-events-open'\)\?\.addEventListener\('click', \(\) => openWorldEvents\('launch-kit-world-pulse'\)\)/);
  assert.match(main, /function openWorldEvents[\s\S]{0,1800}const refreshPromise = worldEventsConsole\?\.refresh\(method, \{ query: options\.query \}\)/);
  assert.match(main, /options\.projectField === true[\s\S]{0,240}worldEventsConsole\?\.projectField\?\.\('url'\)/);
  assert.match(main, /raycastTargets\.push\(cube\)/);
  assert.match(main, /new THREE\.BoxGeometry/);
  assert.match(main, /humanitarianRecords\.slice\(0, 12\)/);
  assert.match(main, /worldEvidenceLayer\.visible = records\.length > 0 \|\| humanitarianRecords\.length > 0/);
  // World Pulse -> existing portal destination -> cube field is a reversible
  // presentation handoff. The public record identity/provider envelope must
  // remain separate from the renderer-local cube position while the feature
  // navigator hides the evidence layer.
  assert.match(main, /let worldEvidenceFocusedRecordId = null/);
  assert.match(main, /function captureWorldEvidenceReturnContext/);
  assert.match(main, /function restoreWorldEvidenceReturnContext/);
  assert.match(main, /worldEvidenceReturnContext = null/);
  assert.match(main, /worldEvidenceLocalPositions\.set\(record\.id, \{ x: position\.x, z: position\.z \}\)/);
  assert.match(main, /worldEvidenceLayer && \(worldEvidenceLayer\.visible = true\)/);
  assert.match(main, /projection\.restore-world-evidence-context/);
  assert.match(main, /restoreWorldEvidenceReturnContext\('portal-return'\)/);
  assert.match(main, /focusedRecordId: worldEvidenceFocusedRecordId/);
  assert.match(main, /returnContext: worldEvidenceReturnContext/);
  assert.match(main, /function openWorldEvents[\s\S]{0,800}hideReadout\(\)/);
  assert.match(main, /panel.*world-events/s);
  assert.match(navigator, /id: "world-events"/);
  assert.match(launchKit, /\["world-events",/);
  assert.doesNotMatch(navigator, /id: "world-events"[\s\S]{0,500}mock evidence/i);
});

test("the World Gateway route opens the public status console, not the legacy fixture", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /local\s+gateway\s+fixture/i);
  assert.match(main, /feature\.id === 'gateway'[\s\S]{0,1200}openLivePublicStatus\(`feature-gateway:/);
  assert.match(main, /document\.getElementById\('live-gateway-console'\)\?\.classList\.add\('public-status-only'\)/);
  assert.match(main, /feature\.id === 'gateway'[\s\S]{0,1200}featureNavigator !== null/);
  assert.doesNotMatch(main, /feature\.id === 'gateway'[\s\S]{0,1200}worldEventsConsole\?\.open\(\)/);
  assert.doesNotMatch(main, /feature\.id === 'gateway'[\s\S]{0,1200}worldEventsConsole\?\.refresh/);
  assert.match(main, /get\('feature'\) === 'gateway'[\s\S]{0,300}openLivePublicStatus\('url', true\)/);
});

test("Tennis Evidence is mounted as a real public read over the cube-only field", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const navigator = await readFile(new URL("../src/render/feature-navigator.js", import.meta.url), "utf8");
  const launchKit = await readFile(new URL("../src/domains/launch-kit.js", import.meta.url), "utf8");
  for (const id of [
    "sports-events-console",
    "sports-events-refresh",
    "sports-events-query",
    "sports-events-sources",
    "sports-events-records",
    "sports-events-current",
    "sports-events-boundary",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /ATP \/ WTA match reality/);
  assert.match(html, /No fabricated fallback matches/);
  assert.match(main, /fetchSportsEvents/);
  assert.match(main, /createUnavailableSportsEvents/);
  assert.match(main, /renderSportsEvidenceCubes/);
  assert.match(main, /sports-events.*BoxGeometry/s);
  assert.match(main, /panel.*sports-events/s);
  assert.match(navigator, /id: "sports-events"/);
  assert.match(launchKit, /\["sports-events",/);
  assert.doesNotMatch(main, /sports-events[\s\S]{0,1200}odds\?\./i);
});

test("social and space launch modes are visible and wired to the local plan", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/render/social-explorer.js", import.meta.url), "utf8");
  const domain = await readFile(new URL("../src/domains/social-explorer.js", import.meta.url), "utf8");
  for (const id of [
    "social-explorer-launch-plan",
    "social-explorer-launch-modes",
    "social-explorer-launch-phases",
    "social-explorer-launch-status",
    "social-explorer-launch-participation",
    "social-explorer-launch-next",
    "social-explorer-launch-reset",
    "social-explorer-launch-allocation",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(domain, /social-experiment/);
  assert.match(domain, /space-explorer/);
  assert.match(main, /onLaunchPlan/);
  assert.match(main, /projection\.social-launch-plan/);
  assert.match(main, /event\?\.action === 'select-launch-mode'/);
  assert.match(main, /plan\.modeId === 'space-explorer'/);
  assert.match(main, /featureNavigator\?\.select\('block-world', 'social-launch-space-mode'/);
  assert.match(main, /projection\.social-launch-space-route/);
  assert.match(main, /requestedSocialMode/);
  assert.match(renderer, /selectLaunchMode/);
  assert.match(renderer, /advanceLaunchPhase/);
  assert.match(renderer, /replayLaunchPlan/);
  assert.doesNotMatch(renderer, /fetch\s*\(/i);
});
