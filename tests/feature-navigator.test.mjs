import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import { FEATURE_DEFINITIONS, FEATURE_FUTURE_OPTIONS, FEATURE_SURFACE_ROUTES } from "../src/render/feature-navigator.js";

const expectedIds = [
  "reality-lens",
  "person",
  "rooms",
  "block-world",
  "runtime-sync",
  "migration",
  "asset-token",
  "asset-market",
  "launch-distribution",
  "social-explorer",
  "social-mirror",
  "youtube",
  "paycore",
  "contracts",
  "contract-atelier",
  "ledger",
  "t402",
  "agent",
  "neural-mesh",
  "muse-agent",
  "bot-plaza",
  "luna-companion",
  "picture-matter",
  "nft-atelier",
  "wardrobe-atelier",
  "white-paper",
  "gesture-lens",
  "gateway",
  "world-events",
  "sports-events",
  "multi-sport-events",
  "arena",
  "chess",
  "web-ai",
  "academy",
  "projections",
];

test("mission control exposes every major local feature", () => {
  assert.deepEqual(FEATURE_DEFINITIONS.map((feature) => feature.id), expectedIds);
  for (const feature of FEATURE_DEFINITIONS) {
    assert.ok(feature.label, `${feature.id} has a visible label`);
    assert.ok(feature.description, `${feature.id} has an opening description`);
    assert.ok(feature.boundary, `${feature.id} has an authority boundary`);
  }
});

test("spatial inspector routes describe the feature they actually open", async () => {
  for (const feature of FEATURE_DEFINITIONS) {
    assert.ok(FEATURE_SURFACE_ROUTES[feature.id]?.length, `${feature.id} has a concrete inspector route`);
  }
  assert.deepEqual(FEATURE_SURFACE_ROUTES["sports-events"].map(([title]) => title), [
    "PUBLIC SCOREBOARD",
    "PLAYER + SETS",
    "DATA GRADE",
  ]);
  assert.deepEqual(FEATURE_SURFACE_ROUTES["web-ai"].map(([title]) => title), [
    "WEB TAB",
    "AI TAB",
    "TASK NOTE",
    "OPENING",
  ]);
  assert.match(FEATURE_DEFINITIONS.find((feature) => feature.id === "agent").description, /Bot Plaza roster/);

  const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(mainSource, /webAiConsole\s*=\s*createWebAiConsole\(/);
  assert.match(mainSource, /socialMirrorConsole\s*=\s*createSocialMirrorConsole\(/);
  assert.match(mainSource, /feature\.id === 'agent'[\s\S]{0,180}botPlazaConsole\?\.open\(\)/);
  assert.match(mainSource, /feature\.id === 'social-mirror'[\s\S]{0,180}socialMirrorConsole\?\.open/);
  assert.match(mainSource, /feature\.id === 'web-ai'[\s\S]{0,180}webAiConsole\?\.open/);
  assert.match(mainSource, /const enteredFromRealityAssembly = Boolean\(feature\?\.id && realityAssembly\?\.active\)/);
  assert.match(mainSource, /focusFeature\?\.\(feature\.id\)/);
  assert.match(mainSource, /genericNoAutoRefresh = \[[^\]]*'reality-assembly'\]/);
  assert.match(mainSource, /REALITY_ASSEMBLY_FEATURE_PANEL_IDS = Object\.freeze/);
  assert.match(mainSource, /onNavigate:\(id\)=>\{featureNavigator\.select\(id,'reality-assembly',\{updateLocation:false\}\);featureNavigator\.close\(\);\}/);
  const assemblyCss = await readFile(new URL("../src/render/reality-assembly.css", import.meta.url), "utf8");
  assert.match(assemblyCss, /body\.assembly-mode \.reality-lens-feature-panel:not\(\[hidden\]\)\{display:flex!important;z-index:120!important\}/);
});

test("mission control keeps future options visible and capability-gated", async () => {
  assert.equal(FEATURE_FUTURE_OPTIONS.length, 3);
  assert.deepEqual(FEATURE_FUTURE_OPTIONS.map((option) => option.id), [
    "shared-session",
    "provider-adapters",
    "xr-host",
  ]);
  for (const option of FEATURE_FUTURE_OPTIONS) {
    assert.ok(option.label);
    assert.ok(option.detail);
    assert.match(option.status, /NOT ENABLED|OPTIONAL GATE|NOT TESTED/);
    assert.ok(expectedIds.includes(option.routeId), `${option.id} points to an existing local boundary route`);
    assert.match(option.routeLabel, /^OPEN /, `${option.id} has an explicit local boundary action label`);
  }
  const navigatorSource = await readFile(new URL("../src/render/feature-navigator.js", import.meta.url), "utf8");
  assert.match(navigatorSource, /feature-future-options/);
  assert.match(navigatorSource, /FUTURE OPTIONS/);
  assert.match(navigatorSource, /NOT ENABLED/);
  assert.match(navigatorSource, /futureRoute/);
  assert.match(navigatorSource, /select\(option\.routeId, "future-option"\)/);
  assert.doesNotMatch(navigatorSource, /navigator\.mediaDevices|requestSession\(/);
});

test("feature source references resolve against the canonical projection", () => {
  const projection = createLivingRealityProjection().world;
  const sources = new Set(projection.contributions.map((contribution) => contribution.source));
  for (const feature of FEATURE_DEFINITIONS) {
    for (const source of feature.sources) {
      assert.ok(sources.has(source), `${feature.id} source ${source} is projected`);
    }
  }
});

test("navigator markup is explicit and remains local-only", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="feature-toggle"/);
  assert.match(html, /id="feature-nav"/);
  assert.match(html, /OPEN FEATURES/);
  assert.match(html, /Open a feature/);
  assert.match(html, /grid-template-columns:repeat\(3/);
  const navigatorSource = await readFile(new URL("../src/render/feature-navigator.js", import.meta.url), "utf8");
  assert.match(navigatorSource, /REPLAY LOCAL VIEW/);
  assert.match(navigatorSource, /FOCUS IN WORLD/);
  assert.match(navigatorSource, /feature-route/);
  assert.match(navigatorSource, /reality-lens.*WORLD FIELD/s);
  assert.match(navigatorSource, /arena.*GAME LAB/s);
  assert.match(navigatorSource, /chess.*STANDARD PIECES/s);
  assert.match(navigatorSource, /aria-hidden and inert/);
  assert.match(navigatorSource, /toggle\.focus/);
  assert.match(navigatorSource, /feature-future-action/);
  assert.match(html, /\.feature-future-action/);
  assert.match(html, /feature-future-action\{[^}]*max-width:100%/);
  assert.doesNotMatch(html, /World Eye/i);
  assert.doesNotMatch(html, /Coin Engine/i);
});

test("static fallback directory mirrors the canonical feature registry", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const fallbackStart = html.indexOf('id="feature-nav-fallback-list"');
  const fallbackEnd = html.indexOf('</ul>', fallbackStart);
  assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, "fallback feature directory must be mounted");
  const fallback = html.slice(fallbackStart, fallbackEnd);
  const ids = [...fallback.matchAll(/href="\?feature=([^&"]+)|href="\?panel=([^&"]+)/g)].map((match) => match[1] ?? match[2]);
  assert.deepEqual(ids.slice(0, FEATURE_DEFINITIONS.length), FEATURE_DEFINITIONS.map((feature) => feature.id));
  assert.equal(ids.length, FEATURE_DEFINITIONS.length + 1, "fallback adds only the Launch Kit launcher entry");
  assert.equal(ids.at(-1), "launch-kit");
});

test("Block World feature cards use the generic provider-free navigation policy", async () => {
  const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(
    mainSource,
    /genericUserSelection\s*=\s*[\s\S]{0,260}method === ['"]feature-block['"]/,
    "feature-card navigation must clear stale specialized route keys",
  );
  assert.match(
    mainSource,
    /genericNoAutoRefresh\s*=\s*\[[^\]]*['"]feature-block['"][^\]]*\]\.includes\(String\(method\)\)/,
    "feature-card navigation must not trigger provider reads",
  );
});

test("direct feature URLs replay their local handoff after Mission Control mounts", async () => {
  const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(
    mainSource,
    /requestedFeatureAfterNavigatorMount\s*=\s*new URLSearchParams[\s\S]{0,250}featureNavigator\.select\(requestedFeatureAfterNavigatorMount, 'url', \{ updateLocation: false \}\)/,
  );
});

test("direct Tennis Evidence links use the cube-first surface opener without an implicit provider read", async () => {
  const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = mainSource.indexOf("if (initialLandingQuery.get('feature') === 'sports-events'");
  const end = mainSource.indexOf("const blockActionQuery", start);
  assert.ok(start >= 0 && end > start, "expected the direct Tennis Evidence route block");
  const routeBlock = mainSource.slice(start, end);
  assert.match(routeBlock, /openSportsEvents\('feature-url', false\)/);
  assert.doesNotMatch(routeBlock, /sportsEventsConsole\?\.refresh/);
});

test("direct World Pulse links use the cube-first surface opener without an implicit provider read", async () => {
  const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = mainSource.indexOf("if (initialLandingQuery.get('feature') === 'world-events'");
  const end = mainSource.indexOf("if (initialLandingQuery.get('feature') === 'sports-events'", start);
  assert.ok(start >= 0 && end > start, "expected the direct World Pulse route block");
  const routeBlock = mainSource.slice(start, end);
  assert.match(routeBlock, /openWorldEvents\('feature-url', false\)/);
  assert.doesNotMatch(routeBlock, /worldEventsConsole\?\.refresh/);
});

test("fallback public-evidence links stay provider-free until the visible refresh control", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /href="\?feature=world-events(?:&amp;[^"]*)?"[\s\S]{0,150}World Pulse/);
  assert.match(html, /href="\?feature=sports-events(?:&amp;[^"]*)?"[\s\S]{0,150}Tennis Evidence/);
  assert.match(html, /href="\?feature=multi-sport-events(?:&amp;[^"]*)?"[\s\S]{0,180}Multi-Sport Scoreboards/);
  assert.doesNotMatch(html, /href="\?panel=(?:world-events|sports-events|multi-sport-events)[^"]*"/);
});

test("the Launch Kit accepts a direct feature deep link as well as its panel alias", async () => {
  const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = mainSource.indexOf("const launchKitRouteQuery = new URLSearchParams");
  const end = mainSource.indexOf("const launchDistributionRouteQuery", start);
  assert.ok(start >= 0 && end > start, "expected the Launch Kit route handoff");
  const routeBlock = mainSource.slice(start, end);
  assert.match(routeBlock, /get\('panel'\) === 'launch-kit'/);
  assert.match(routeBlock, /get\('feature'\) === 'launch-kit'/);
  assert.match(routeBlock, /openLaunchKit\('feature-url'\)/);
});

test("direct Launch Kit feature links open the complete local handoff", async () => {
  const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = mainSource.indexOf("if (initialLandingQuery.get('feature') === 'launch-kit'");
  const end = mainSource.indexOf("const blockActionQuery", start);
  assert.ok(start >= 0 && end > start, "expected the direct Launch Kit feature route block");
  const routeBlock = mainSource.slice(start, end);
  assert.match(routeBlock, /openLaunchKit\('feature-url'\)/);
  assert.doesNotMatch(routeBlock, /launchKitConsole\?\.refresh/);
});

test("Launch Kit resets stale feature context to its Reality Lens substrate", async () => {
  const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = mainSource.indexOf("function openLaunchKit(method = 'button')");
  const end = mainSource.indexOf("launchKitConsole = createLaunchKitConsole", start);
  assert.ok(start >= 0 && end > start, "expected the Launch Kit opener");
  const opener = mainSource.slice(start, end);
  assert.match(opener, /alignFeatureSurface\('reality-lens', `launch-kit:\$\{method\}`\)/);
  assert.match(opener, /featureNavigator\?\.close\(\)/);
});
