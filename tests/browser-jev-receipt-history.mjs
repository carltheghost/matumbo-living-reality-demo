// Fixture-only full-app browser regression. No provider credentials or calls.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { livingReadingProjection } from "../src/domains/living-surface-layout-engine.js";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { JEV_HISTORY_KEY, parseJevAdviceReceipt } from "../src/domains/jev-advice-receipt.js";
import { COUNCIL_STORAGE_KEY, COUNCIL_MISSION_TASK, exportCouncilReport } from "../src/domains/provider-council-evidence.js";
import { runProviderCouncil } from "../scripts/vivo/provider-council.mjs";
const require = createRequire(process.env.MATUMBO_NODE_DEPENDENCIES ?? new URL("../package.json", import.meta.url));
const { chromium } = require("playwright");
const base = new URL(process.env.MATUMBO_PREVIEW_URL ?? "http://127.0.0.1:8123/index.html?feature=web-ai");
assert.ok(["http:", "https:"].includes(base.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) && !base.username && !base.password, "loopback preview only");
base.searchParams.set("feature", "web-ai");
const out = resolve(process.env.MATUMBO_BROWSER_EVIDENCE_DIR ?? "browser-evidence/jev-receipt-history");
await mkdir(out, { recursive: true });
const hash = value => createHash("sha256").update(value).digest("hex");
function fixture(changes = {}) {
  const receipt = {
    schema: "tumbo.jev-advice-receipt/1", provider: "typesafe",
    sourceUrl: "https://api.typesafe.ai/v1/systemone", requestId: "fixture:browser:metered",
    connectionId: "fixture:browser:offline", requestedModel: "jev-latest", resolvedModel: "jev-fixture",
    receivedAt: "2026-11-24T00:00:00Z", probability: 0.7, probabilitySource: "answers.decision.noul",
    usage: { input_tokens: 330, output_tokens: 20 }, stateSha256: hash("fixture-state"),
    questionSha256: hash("fixture-question"), requestBodySha256: hash("fixture-request"),
    responseBodySha256: hash("fixture-response"), worldActionExecuted: false, ...changes,
  };
  const receiptJson = JSON.stringify(receipt);
  const envelope = { schema: "tumbo.jev-advice-export/1", receiptJson, receiptSha256: hash(receiptJson) };
  return { receipt, envelope, row: { identity: hash(JSON.stringify([receipt.connectionId, receipt.requestId])),
    receiptSha256: envelope.receiptSha256, model: receipt.resolvedModel, usage: receipt.usage } };
}
const metered = fixture(), conflict = fixture({ usage: { input_tokens: 331, output_tokens: 20 } });
const unknown = fixture({ requestId: "fixture:browser:unmetered", resolvedModel: "jev-fixture-unmetered", usage: null });
for (const f of [metered, conflict, unknown]) assert.deepEqual(await parseJevAdviceReceipt(f.envelope), f.receipt);
assert.equal(metered.row.identity, conflict.row.identity);
assert.notEqual(metered.row.receiptSha256, conflict.row.receiptSha256);
assert.notEqual(metered.row.identity, unknown.row.identity);
const tampered = { ...metered.envelope, receiptJson: metered.envelope.receiptJson.replace('"input_tokens":330', '"input_tokens":999') };
await assert.rejects(parseJevAdviceReceipt(tampered), /No valid downloadable/);
const panelSelector = "#web-ai-console", historySelector = '[aria-label="Saved Jev receipt history"]';
const statusSelector = '#web-ai-console [aria-label="Imported Jev usage — not billing"] > p[role="status"]';
const duplicate = "This request is already in the saved usage history.";
const conflictMessage = "This request has a conflicting receipt.";
// Only the five unrelated startup GETs observed in the first actual CI run
// receive synthetic unavailable responses. No external request is continued.
const offlineFeeds = new Set([
  "https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard",
  "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  "https://api.elections.kalshi.com/trade-api/v2/markets",
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=500&offset=0",
]);
const sandboxError = "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.";
const probeUrl = new URL("/__jev-browser-sandbox-probe", base.origin).href;
const errorSignature = error => ({message:error.message,stack:error.stack ?? ""});
const devices = [{ name: "desktop", viewport: { width: 1280, height: 900 }, mobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true }];
const selected = process.env.MATUMBO_BROWSER_DEVICE;
assert.ok(!selected || devices.some(d => d.name === selected), "unknown browser device");
const scenario = process.env.MATUMBO_BROWSER_SCENARIO ?? "full";
assert.ok(["full","core","isolation","orientation","council"].includes(scenario),"unknown browser scenario");
const report = { schema: "matumbo.jev-receipt-browser-regression/8", scenario, passed: false,
  preview: base.href, playwrightVersion: require("playwright/package.json").version,
  fixtures: [metered, conflict, unknown].map(f => f.envelope.receiptSha256), results: [] };
async function read(page) {
  return page.evaluate(key => ({
    economy: window.__TUMBO_WEB_AI__.getComputeEconomySnapshot(),
    journal: sessionStorage.getItem(key), localJournal: localStorage.getItem(key),
    summary: document.querySelector('[aria-label="Saved Jev receipt history"] > p')?.textContent,
    rows: [...document.querySelectorAll('[aria-label="Saved Jev receipt history"] > div')].map(n => n.textContent),
    metrics: [...document.querySelectorAll("#web-ai-console .web-ai-metric b")].map(n => n.textContent),
    timelineRows: [...document.querySelectorAll("#web-ai-console .web-ai-economy-event span")].map(n => n.textContent),
  }), JEV_HISTORY_KEY);
}
function balances(actual, before) {
  for (const key of ["account", "exchange", "vault"]) assert.deepEqual(actual.economy[key], before.economy[key], key + " changed");
  assert.deepEqual(actual.metrics, before.metrics, "displayed balances changed");
}
function history(state, expected) {
  assert.deepEqual(state.journal === null ? [] : JSON.parse(state.journal), expected.map(f => f.row));
  assert.equal(state.localJournal, null, "tab history leaked into localStorage");
  const total = expected.reduce((sum, f) => sum + (f.row.usage ? f.row.usage.input_tokens + f.row.usage.output_tokens : 0), 0);
  assert.equal(state.summary, expected.length + " saved receipts · " + total.toLocaleString("en-US") + " reported tokens · " + expected.filter(f => f.row.usage === null).length + " without counts");
  assert.deepEqual(state.rows, expected.slice(-5).reverse().map(({row}) => row.model + " · " + (row.usage ? row.usage.input_tokens.toLocaleString("en-US") + " in / " + row.usage.output_tokens.toLocaleString("en-US") + " out" : "counts unavailable")));
  for (const f of [metered, conflict, unknown]) {
    assert.ok(!state.journal?.includes(f.receipt.connectionId));
    assert.ok(!state.journal?.includes(f.receipt.requestId));
  }
}
function observed(before, after, f) {
  const events = after.economy.timeline.events;
  assert.deepEqual(events.slice(0, -1), before.economy.timeline.events, "must append exactly one event");
  const { type, source, payload } = events.at(-1);
  assert.deepEqual({type, source, payload}, { type: "provider.usage-observed", source: "typesafe",
    payload: { model: f.row.model, usage: f.row.usage, receiptSha256: f.row.receiptSha256 } });
  assert.equal(after.economy.timeline.verifiedLocalChain, true);
  assert.deepEqual(after.timelineRows, events.slice(-10).reverse().map(e => e.type + " · " + e.source));
  balances(after, before);
}
async function runDevice(browser, device) {
  const result = { device: device.name, viewport: device.viewport, passed: false, checkpoints: [], pageErrors: [], forbiddenRequests: [], offlineFixtureRequests: [], sandboxProbes: [], harnessDiagnostics: [] };
  const contexts = [], sandboxProofs = new Map();
  let page, stage = "launch context";
  const progressPath=resolve(out,device.name+"-"+scenario+"-progress.jsonl");
  await writeFile(progressPath,"");
  async function recordCheckpoint(entry){
    result.checkpoints.push(entry);
    const event={device:device.name,scenario,number:result.checkpoints.length,...entry};
    await appendFile(progressPath,JSON.stringify(event)+"\n");
    // stderr retains stage evidence in CI even if the browser job is canceled.
    console.error("[jev-browser-checkpoint] "+JSON.stringify(event));
  }
  async function newPage(existingContext = null) {
    const context = existingContext ?? await browser.newContext({ viewport: device.viewport, isMobile: device.mobile, hasTouch: device.mobile,
      deviceScaleFactor: 1, reducedMotion: "reduce", locale: "en-US", serviceWorkers: "block" });
    if (!existingContext) {
    contexts.push(context);
    await context.route("**/*", route => {
      const req = route.request(), url = new URL(req.url());
      if (req.method() === "GET" && offlineFeeds.has(url.href)) {
        result.offlineFixtureRequests.push({ method: "GET", url: url.href, response: 503 });
        return route.fulfill({status:503,headers:{"access-control-allow-origin":"*"},json:{error:"offline browser regression fixture"}});
      }
      if (url.origin !== base.origin || !["GET","HEAD"].includes(req.method())) {
        result.forbiddenRequests.push({ method: req.method(), url: url.href }); return route.abort("blockedbyclient");
      }
      if (url.href === probeUrl) return route.fulfill({contentType:"text/html",body:'<!doctype html><html><body><iframe title="Sandbox probe" sandbox="allow-scripts" srcdoc="<p>Empty sandbox fixture</p>"></iframe></body></html>'});
      if (url.pathname.endsWith("/__preview/revision")) return route.fulfill({ json: { revision: "jev-receipt-fixture" } });
      return route.continue();
    });
    await context.routeWebSocket("**/*", ws => { result.forbiddenRequests.push({ kind: "websocket", url: ws.url() }); ws.close(); });
    // Playwright 1.57's serviceWorkers:block init script itself reads
    // navigator.serviceWorker without a try/catch. Prove the exact error
    // occurs in a script-free sandbox before classifying any app-page error.
    // Keep blocking service workers, and fail on every unmatched error.
    const probe = await context.newPage(), probeErrors = [];
    probe.on("pageerror", e => probeErrors.push(errorSignature(e)));
    try {
      await probe.goto(probeUrl, {waitUntil:"load",timeout:15_000});
      await probe.frameLocator("iframe").locator("p").waitFor({state:"visible",timeout:5_000});
      await probe.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } finally { await probe.close(); }
    const reproduced = probeErrors.filter(e => e.message === sandboxError);
    result.sandboxProbes.push({errors:probeErrors, reproduced:reproduced.length});
    for (const e of probeErrors.filter(e=>e.message!==sandboxError)) result.pageErrors.push(e);
    sandboxProofs.set(context,reproduced);
    }
    const reproduced = sandboxProofs.get(context);
    assert.ok(reproduced,"every context must have an independent sandbox probe");
    const p = await context.newPage();
    p.setDefaultTimeout(20_000); p.setDefaultNavigationTimeout(45_000);
    p.on("pageerror", e => {
      const signature=errorSignature(e);
      if(signature.message===sandboxError && reproduced.some(proof=>proof.stack===signature.stack)){
        result.harnessDiagnostics.push({kind:"reproduced-playwright-sandbox-init",...signature});
      } else result.pageErrors.push(signature);
    });
    p.on("popup", popup => { result.forbiddenRequests.push({ kind: "popup", url: popup.url() }); void popup.close(); });
    return p;
  }
  const panel = () => page.locator(panelSelector);
  const hist = () => panel().locator(historySelector);
  const activate = locator => device.mobile ? locator.tap() : locator.click();
  async function checkpoint(label) {
    stage = label;
    const state = await read(page);
    await recordCheckpoint({ label, summary: state.summary, metrics: state.metrics,
      events: state.economy.timeline.events.map(e => e.type) });
    return state;
  }
  async function waitNative(id, panelId) {
    await page.waitForFunction(({id,panelId}) => {
      const p = document.getElementById(panelId), a = window.__TUMBO_REALITY_ASSEMBLY__;
      const host = p?.closest("#reality-assembly .assembly-css3d-host");
      return a?.getSnapshot().selectedId === id && p?.dataset.lensSurfaceAttached === "true" && !p.hidden
        && host && host.dataset.surfaceFallback !== "true" && p.closest(".assembly-css3d-renderer")
        && a.getFeatureObject(id)?.root.children.some(child => child.isCSS3DObject && child.element === p);
    }, {id,panelId}, {timeout:45_000});
  }
  async function openFace(name,face) {
    stage = "open face " + name;
    const tab=panel().getByRole("tab",{name,exact:true});
    if(await tab.getAttribute("aria-selected")!=="true") await activate(tab);
    await page.waitForFunction(({face})=>{
      const p=document.getElementById("web-ai-console");
      const t=p?.querySelector('[data-tab="'+face+'"]'), active=p?.querySelector('[data-panel="'+face+'"]');
      return t?.getAttribute("aria-selected")==="true" && active && !active.hidden
        && [...p.querySelectorAll("[data-panel]")].every(n=>n===active || n.hidden);
    },{face});
    // Wait for real layout after CSS3D composition, not only a tab's ARIA
    // flag. A collapsed mobile face remains a failure with measured evidence.
    await panel().locator('[data-panel="'+face+'"]').waitFor({state:"visible",timeout:15_000});
    assert.equal(await panel().locator("[data-panel]:visible").count(),1);
    const layout=await panel().evaluate((p,face)=>{
      const body=p.querySelector(".web-ai-body"),active=p.querySelector('[data-panel="'+face+'"]'),
        tabs=p.querySelector(".web-ai-tabs"),buttons=[...tabs.querySelectorAll("button")];
      return {panelHeight:p.clientHeight,panelScrollHeight:p.scrollHeight,
        bodyHeight:body.clientHeight,bodyScrollHeight:body.scrollHeight,bodyOverflow:getComputedStyle(body).overflowY,
        activeHeight:active.clientHeight,tabsHeight:tabs.clientHeight,tabsWidth:tabs.clientWidth,tabsScrollWidth:tabs.scrollWidth,
        tabTops:buttons.map(n=>n.offsetTop),tabHeights:buttons.map(n=>n.getBoundingClientRect().height)};
    },face);
    await recordCheckpoint({label:"native face layout "+name,...layout});
    assert.ok(layout.activeHeight>=48,"face content must have a real, noncollapsed layout");
    assert.ok(layout.bodyHeight>=layout.activeHeight,"reading body must expand to hold selected face");
    assert.equal(layout.bodyOverflow,"visible","attached skin owns scrolling, not nested body");
    assert.ok(layout.bodyScrollHeight<=layout.bodyHeight+2,"nested body must not clip content");
    assert.ok(layout.tabsScrollWidth<=layout.tabsWidth+2,"face tabs must not overflow horizontally");
    assert.ok(new Set(layout.tabTops).size===1,"three face tabs must stay on one row");
    assert.ok(layout.tabHeights.every(height=>height>=44),"face switches must remain touch-sized");
    if(face==="economy"){
      assert.ok(layout.panelScrollHeight>layout.panelHeight,"long Compute face scrolls on its own object");
      const imported = panel().getByRole("region",{name:"Imported Jev usage — not billing",exact:true});
      assert.equal(await imported.count(),1);
      assert.equal(await imported.locator(historySelector).count(),1);
      const placement = await imported.evaluate(region=>{
        const face=region.closest('[data-panel="economy"]');
        const metrics=face.querySelector(".web-ai-economy-grid");
        const wallet=face.querySelector('[aria-label="Demo compute credits to add"]');
        const lab=face.querySelector('[aria-label="Provider reported cost in USD"]');
        const input=region.querySelector('input[type="file"]');
        const note=document.getElementById(input.getAttribute("aria-describedby"));
        const follows=node=>Boolean(node && region.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING);
        return {beforeMetrics:follows(metrics),beforeWallet:follows(wallet),beforeLab:follows(lab),
          sameNativeObject:region.closest("#web-ai-console")?.dataset.lensSurfaceAttached==="true",
          associatedBoundary:region.contains(note)&&note.textContent.includes("not provider-authenticated")&&note.textContent.includes("do not change demo credits")};
      });
      assert.deepEqual(placement,{beforeMetrics:true,beforeWallet:true,beforeLab:true,sameNativeObject:true,associatedBoundary:true});
      await recordCheckpoint({label:"import and saved usage precede demo accounting controls",...placement});
    }
  }
  async function compute() {
    stage = "attach native Compute object";
    await waitNative("web-ai","web-ai-console");
    assert.equal(await panel().count(), 1); assert.equal(await hist().count(), 1);
    assert.equal(await panel().getAttribute("data-no-panel-drag"), "true");
    assert.equal(await page.evaluate(() => window.__TUMBO_REALITY_ASSEMBLY__.getSnapshot().objects.filter(o => o.id === "web-ai").length), 1);
    await openFace("COMPUTE","economy");
  }
  async function upload(body, message) {
    stage = "upload: " + message;
    const input = panel().getByLabel("Import a Vivo Jev usage receipt", {exact:true});
    assert.equal(await input.count(), 1);
    await input.scrollIntoViewIfNeeded(); assert.equal(await input.isVisible(), true);
    // The native file input must be reachable through the actual scroll
    // surface; a positive offscreen bounding box alone is not sufficient.
    await (device.mobile ? input.tap({trial:true}) : input.click({trial:true}));
    // The receipt entry is now near the top and may already be visible.
    // The trial action above still verifies actual pointer/touch reachability;
    // require that the control belongs to the one native scroll surface.
    assert.equal(await input.evaluate(n=>n.closest("#web-ai-console")?.dataset.lensSurfaceAttached),"true");
    // Real browser file input/change event; no direct journal calls or storage seeding.
    await input.setInputFiles({name:"jev-fixture.json", mimeType:"application/json",
      buffer:Buffer.from(typeof body === "string" ? body : JSON.stringify(body))});
    await page.waitForFunction(({selector,message}) => {
      const input = document.querySelector('#web-ai-console [aria-label="Imported Jev usage — not billing"] input[type="file"]');
      return document.querySelector(selector)?.textContent === message && input && !input.disabled && input.value === "";
    }, {selector:statusSelector,message});
    assert.equal(await input.inputValue(), "");
    await hist().locator(":scope > p").scrollIntoViewIfNeeded();
    assert.equal(await hist().isVisible(), true);
    return read(page);
  }
  async function reject(body, message, expected) {
    assert.deepEqual(await upload(body, message), expected, "rejected import must change no receipt or economic state");
  }
  async function select(id) {
    stage = "directory select " + id;
    const assembly = page.locator("#reality-assembly");
    // Desktop quick-search focus deliberately transfers focus to the catalog.
    // Use the visible directory result on both layouts, not an Enter press
    // on the input that has just lost focus or an internal navigation API.
    if (!(await assembly.getAttribute("class")).split(/\s+/).includes("assembly-directory-open")) {
      if(device.mobile) await activate(assembly.locator("[data-directory-toggle]"));
      else await activate(assembly.locator("[data-quick-search]"));
    }
    const search = assembly.locator("[data-search]");
    await search.waitFor({state:"visible"});
    await search.fill(id);
    const label = {"paycore":"Pecunia · PAYCORE","web-ai":"Retia & AI"}[id];
    assert.ok(label,"explicit directory label required");
    const match=assembly.locator(".assembly-domain-features").getByRole("button",{name:label,exact:true});
    await match.waitFor({state:"visible"}); assert.equal(await match.count(),1);
    await activate(match);
    await page.waitForFunction(id => window.__TUMBO_REALITY_ASSEMBLY__.getSnapshot().selectedId === id, id);
    await waitNative(id,id==="paycore"?"paycore-console":"web-ai-console");
  }
  async function navigate(expected) {
    stage = "face and object navigation";
    const original = await panel().elementHandle();
    try {
      for (const [name,face] of [["WEB","web"],["AI HELP","ai"],["COMPUTE","economy"]]) {
        await openFace(name,face);
        assert.deepEqual(await read(page),expected);
        await checkpoint("face "+name+" preserves state");
      }
      await select("paycore");
      await page.waitForFunction(() => {
        const p=document.getElementById("web-ai-console");
        return p && p.hidden && p.dataset.lensSurfaceAttached !== "true";
      });
      await recordCheckpoint({label:"native PAYCORE attached; Compute detached"});
      await select("web-ai"); await compute();
      assert.equal(await page.evaluate(n => n === document.getElementById("web-ai-console"),original),true);
      assert.deepEqual(await read(page),expected);
    } finally { await original?.dispose(); }
  }
  async function fund() {
    stage = "seed nonzero local demo balances";
    await panel().getByLabel("Demo compute credits to add",{exact:true}).fill("25");
    await activate(panel().getByRole("button",{name:"ADD DEMO CREDITS",exact:true}));
    await panel().getByLabel("Input tokens",{exact:true}).fill("7");
    await panel().getByLabel("Output tokens",{exact:true}).fill("3");
    await panel().getByLabel("Provider reported cost in USD",{exact:true}).fill("2");
    await panel().getByRole("checkbox",{name:/Simulate a provider-verified receipt/}).check();
    await activate(panel().getByRole("button",{name:"RECORD LOCAL USAGE →",exact:true}));
    const state = await checkpoint("funded local demo");
    assert.deepEqual(state.metrics,["$23.00","$2.00","10","0.2"]);
    assert.equal(state.economy.account.spentUsd,2);
    assert.equal(state.economy.exchange.totals.reportedSpendUsd,2);
    assert.equal(state.economy.exchange.totals.tumboSimReward,0.2);
    return state;
  }
  async function reload(expected,journal,fresh) {
    stage = "actual same-tab reload";
    const old = await page.evaluate(() => performance.timeOrigin);
    await page.reload({waitUntil:"domcontentloaded"}); await compute();
    assert.notEqual(await page.evaluate(() => performance.timeOrigin),old);
    const state = await read(page);
    history(state,expected); assert.equal(state.journal,journal);
    assert.deepEqual(state.economy.timeline,fresh.economy.timeline,"restoration replayed timeline");
    assert.deepEqual(state.timelineRows,[]);
    balances(state,fresh);
    return state;
  }
  async function rejections(expected,includeUnknown=false) {
    await reject(metered.envelope,duplicate,expected);
    await reject(conflict.envelope,conflictMessage,expected);
    if (includeUnknown) await reject(unknown.envelope,duplicate,expected);
    await reject(tampered,"No valid downloadable Jev advice receipt was returned.",expected);
    await reject("{bad-json","The receipt is not valid JSON.",expected);
  }
  async function verifyCouncil(fresh){
    const report=await runProviderCouncil({task:COUNCIL_MISSION_TASK});
    const envelope=await exportCouncilReport(report);
    const region=()=>panel().getByRole("region",{name:"Provider Council evidence — not billing",exact:true});
    const rows=()=>region().getByLabel("Latest provider council report",{exact:true});
    const councilStatus=()=>region().getByRole("status");
    const readCouncil=()=>page.evaluate(key=>({journal:sessionStorage.getItem(key),localJournal:localStorage.getItem(key),
      text:document.querySelector('[aria-label="Latest provider council report"]')?.textContent}),COUNCIL_STORAGE_KEY);
    const uploadCouncil=async(body,message)=>{
      stage="council upload: "+message;
      const input=region().getByLabel("Import a provider council report",{exact:true});
      assert.equal(await input.count(),1);
      await input.scrollIntoViewIfNeeded();
      await (device.mobile?input.tap({trial:true}):input.click({trial:true}));
      await input.setInputFiles({name:"council.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(body))});
      await page.waitForFunction(({message})=>{
        const r=document.querySelector('[aria-label="Provider Council evidence — not billing"]'),n=r?.querySelector('input[type="file"]');
        return r?.querySelector('[role="status"]')?.textContent===message&&n&&!n.disabled&&!n.value;
      },{message});
      assert.equal(await councilStatus().textContent(),message);
    };
    assert.equal(await region().count(),1);
    const funded=await fund();
    const jev=await upload(metered.envelope,"Saved 330 input and 20 output tokens.");
    history(jev,[metered]);observed(funded,jev,metered);
    const before=await read(page);
    await uploadCouncil(envelope,"Latest report saved for this tab.");
    const saved=await readCouncil();
    assert.equal(saved.journal,JSON.stringify(envelope));assert.equal(saved.localJournal,null);
    assert.match(saved.text,/Fixture report · not live/);
    assert.match(saved.text,/Local optimum: C,D · cost 7 \/ 7 · value 13/);
    assert.match(saved.text,/4 optimal · 2 alternative · 1 invalid · 0 unknown/);
    assert.match(saved.text,/deepseek.*A,B · feasible-suboptimal/);
    assert.match(saved.text,/kimi.*A,C · over-budget/);
    assert.match(saved.text,/xai.*invalid-proposal/);
    assert.deepEqual(await read(page),before,"council import changed Jev or economic state");
    await recordCheckpoint({label:"council mission imported with dissent and unchanged accounting",summary:saved.text});
    const changed={...envelope,reportJson:envelope.reportJson.replace("fixture-council-mission-v1","altered")};
    await uploadCouncil(changed,"Report rejected. Existing evidence and balances were not changed.");
    assert.deepEqual(await readCouncil(),saved);assert.deepEqual(await read(page),before);
    const forged=structuredClone(report);forged.rows.find(row=>row.provider==="kimi").answerCorrect=true;
    const reportJson=JSON.stringify(forged);
    await uploadCouncil({...envelope,reportJson,reportSha256:hash(reportJson)},"Report rejected. Existing evidence and balances were not changed.");
    assert.deepEqual(await readCouncil(),saved);assert.deepEqual(await read(page),before);
    await recordCheckpoint({label:"changed bytes and rehashed invalid plan rejected"});
    await navigate(before);
    assert.deepEqual(await readCouncil(),saved);
    const restored=await reload([metered],jev.journal,fresh);
    stage="restore saved council report";
    await page.waitForFunction(()=>document.querySelector('[aria-label="Provider Council evidence — not billing"] [role="status"]')?.textContent==="Restored latest report for this tab.");
    assert.deepEqual(await readCouncil(),saved);
    assert.deepEqual(await read(page),restored);
    await rows().scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(out,device.name+"-council-restored.png")});
    await recordCheckpoint({label:"council survives actual reload without billing or Jev replay"});
    const original=page;
    page=await newPage(original.context());await page.goto(base.href,{waitUntil:"domcontentloaded"});await compute();
    assert.equal((await readCouncil()).journal,null);assert.equal(await councilStatus().textContent(),"No provider council report imported.");
    await recordCheckpoint({label:"independent no-opener tab has no council history"});
  }
  async function verifyOrientation(fresh){
    const funded=await fund();
    const first=await upload(metered.envelope,"Saved 330 input and 20 output tokens.");
    history(first,[metered]); observed(funded,first,metered);
    await checkpoint("orientation fixture imported with nonzero balances");
    stage="focus unsent local model draft";
    const control=panel().getByPlaceholder("model name",{exact:true});
    await control.scrollIntoViewIfNeeded();
    await control.fill("local unsent rotation draft");
    await control.press("Home");
    for(let i=0;i<7;i++)await control.press("ArrowRight");
    const handle=await control.elementHandle(),skin=await panel().elementHandle();
    const canonical=await page.evaluate(()=>{
      const a=window.__TUMBO_REALITY_ASSEMBLY__,s=a.getSnapshot(),node=a.getFeatureObject("web-ai");
      return {selectedId:s.selectedId,revision:s.revision,objects:s.objects,shape:node.shape,rootId:node.root.uuid};
    });
    const draft=await control.evaluate(n=>({value:n.value,start:n.selectionStart,end:n.selectionEnd,focused:document.activeElement===n}));
    assert.deepEqual(draft,{value:"local unsent rotation draft",start:7,end:7,focused:true});
    try{
      const sizes=device.mobile?[{width:844,height:390},device.viewport]:[{width:844,height:390},device.viewport];
      for(const viewport of sizes){
        const projection=livingReadingProjection({shape:canonical.shape,viewportWidth:viewport.width,viewportHeight:viewport.height});
        stage="reproject focused draft "+viewport.width+"x"+viewport.height;
        await page.setViewportSize(viewport);
        // No trial click, forced focus or scroll after changing viewport:
        // those would hide a real reading-position failure.
        await page.waitForFunction(({viewport,mode,ratio})=>{
          const a=window.__TUMBO_REALITY_ASSEMBLY__,root=a?.getFeatureObject("web-ai")?.root;
          const p=document.getElementById("web-ai-console"),n=p?.querySelector('input[placeholder="model name"]');
          if(!root||!p||!n||document.activeElement!==n||innerWidth!==viewport.width||innerHeight!==viewport.height)return false;
          if(document.getElementById("reality-assembly")?.dataset.readingProjection!==mode||Math.abs(root.scale.y/root.scale.x-ratio)>.03)return false;
          const r=n.getBoundingClientRect(),b=p.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
          return r.width>0&&r.height>0&&x>=Math.max(0,b.left)&&x<=Math.min(innerWidth,b.right)
            &&y>=Math.max(0,b.top)&&y<=Math.min(innerHeight,b.bottom)&&document.elementFromPoint(x,y)===n;
        },{viewport,mode:projection.mode,ratio:projection.stretch[1]/projection.stretch[0]},{timeout:25_000});
        await waitNative("web-ai","web-ai-console");
        assert.equal(await page.evaluate(n=>n===document.getElementById("web-ai-console"),skin),true);
        assert.equal(await page.evaluate(n=>n===document.activeElement,handle),true);
        assert.deepEqual(await control.evaluate(n=>({value:n.value,start:n.selectionStart,end:n.selectionEnd,focused:document.activeElement===n})),draft);
        const current=await page.evaluate(()=>{
          const a=window.__TUMBO_REALITY_ASSEMBLY__,s=a.getSnapshot(),node=a.getFeatureObject("web-ai");
          return {selectedId:s.selectedId,revision:s.revision,objects:s.objects,shape:node.shape,rootId:node.root.uuid};
        });
        assert.deepEqual(current,canonical,"viewport projection must not mutate the canonical world object");
        assert.deepEqual(await read(page),first,"viewport projection changed receipt/accounting state");
        await recordCheckpoint({label:"focused control survives "+projection.mode+" reprojection",viewport,shape:canonical.shape,
          objectRoot:canonical.rootId,focusPreserved:true,caret:[draft.start,draft.end],draftPreserved:true,receiptAndAccountingPreserved:true});
        await page.screenshot({path:resolve(out,device.name+"-orientation-"+viewport.width+"x"+viewport.height+".png")});
      }
      await reject(metered.envelope,duplicate,first);
      await checkpoint("duplicate rejection still works after viewport transitions");
    }finally{await handle?.dispose();await skin?.dispose();}
  }
  try {
    page = await newPage(); await page.goto(base.href,{waitUntil:"domcontentloaded"}); await compute();
    const fresh = await checkpoint("empty native Compute object");
    history(fresh,[]); assert.equal(fresh.journal,null);
    assert.deepEqual(fresh.economy.timeline.events,[]); assert.deepEqual(fresh.metrics,["$0.00","$0.00","0","0"]);
    if(scenario==="council"){
      await verifyCouncil(fresh);
    }else if(scenario==="orientation"){
      await verifyOrientation(fresh);
    }else{
    let twice;
    if(scenario!=="isolation"){
    const funded = await fund();
    const first = await upload(metered.envelope,"Saved 330 input and 20 output tokens.");
    history(first,[metered]); observed(funded,first,metered);
    await checkpoint("metered receipt observed without balance change");
    await rejections(first); await checkpoint("metered duplicate/conflict/tamper/JSON rejection");
    await navigate(first); await checkpoint("metered receipt and rejection/navigation invariants");
    const restored = await reload([metered],first.journal,fresh);
    await rejections(restored); await checkpoint("metered reload without replay");
    const fundedAgain = await fund(); history(fundedAgain,[metered]);
    const both = await upload(unknown.envelope,"Saved the receipt. Token counts were unavailable.");
    history(both,[metered,unknown]); observed(fundedAgain,both,unknown);
    await checkpoint("unmetered receipt observed without balance change");
    await rejections(both,true); await checkpoint("both receipts reject duplicate/conflict/tamper/JSON");
    await navigate(both); await checkpoint("unmetered receipt preserves nonzero balances");
    const restoredBoth = await reload([metered,unknown],both.journal,fresh);
    await rejections(restoredBoth,true); await checkpoint("both receipts survive reload without replay");
    twice = await reload([metered,unknown],both.journal,fresh);
    assert.deepEqual(twice,restoredBoth); await checkpoint("repeated reload idempotence");
    await hist().locator(":scope > p").scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(out,device.name+"-restored-history.png")});
    }else{
      // Independently prepare the exact two-receipt state used by isolation.
      // This shorter scenario avoids repeating the entire navigation/rejection
      // suite on a slow software-rendering runner.
      const funded=await fund();
      const first=await upload(metered.envelope,"Saved 330 input and 20 output tokens.");
      history(first,[metered]); observed(funded,first,metered);
      const both=await upload(unknown.envelope,"Saved the receipt. Token counts were unavailable.");
      history(both,[metered,unknown]); observed(first,both,unknown);
      twice=await reload([metered,unknown],both.journal,fresh);
      await checkpoint("isolated scenario prepared original two-receipt journal");
    }
    if(scenario!=="core"){
    const original = page;
    // Same browser profile, same origin, different top-level browsing context.
    // Deliberately no opener: browsers may clone sessionStorage when a tab has
    // an opener. This tests independently created tabs, not popup semantics.
    stage = "same-context new tab isolation";
    page = await newPage(original.context());
    await page.goto(base.href,{waitUntil:"domcontentloaded"}); await compute();
    assert.equal(page.context(),original.context());
    assert.equal(await page.evaluate(()=>window.opener===null),true);
    const siblingFresh = await checkpoint("same-context no-opener tab starts empty");
    history(siblingFresh,[]); assert.equal(siblingFresh.journal,null);
    balances(siblingFresh,fresh); assert.deepEqual(siblingFresh.economy.timeline,fresh.economy.timeline);
    const siblingImported = await upload(unknown.envelope,"Saved the receipt. Token counts were unavailable.");
    history(siblingImported,[unknown]); observed(siblingFresh,siblingImported,unknown);
    await checkpoint("sibling tab records only its own receipt");
    assert.deepEqual(await read(original),twice,"same-context sibling modified the original tab");
    const siblingRestored = await reload([unknown],siblingImported.journal,siblingFresh);
    await reject(unknown.envelope,duplicate,siblingRestored);
    assert.deepEqual(await read(original),twice,"sibling reload modified original tab");
    await checkpoint("sibling tab retains independent history after reload");

    // Explicit fault injection only after the ordinary receipt workflow.
    // Real sessionStorage bytes are corrupted in this disposable sibling;
    // the app must surface a storage error and refuse a valid new import.
    stage = "inject corrupt sibling sessionStorage fixture";
    const corrupt = "{fixture:invalid-journal";
    const invalidMessage = "Tab receipt history is invalid; no receipts were changed.";
    await page.evaluate(({key,corrupt})=>sessionStorage.setItem(key,corrupt),{key:JEV_HISTORY_KEY,corrupt});
    await page.reload({waitUntil:"domcontentloaded"}); await compute();
    const broken = await checkpoint("corrupt journal is visible and fails closed");
    assert.equal(broken.summary,invalidMessage); assert.equal(broken.journal,corrupt);
    assert.equal(broken.localJournal,null); assert.deepEqual(broken.rows,[]);
    assert.deepEqual(broken.economy.timeline,siblingFresh.economy.timeline); balances(broken,siblingFresh);
    const fundedBroken = await fund();
    assert.equal(fundedBroken.journal,corrupt);
    assert.equal(fundedBroken.summary,invalidMessage);
    await reject(metered.envelope,invalidMessage,fundedBroken);
    assert.deepEqual(await read(original),twice,"corrupt sibling changed original tab");
    await checkpoint("corrupt journal and nonzero balances unchanged after valid receipt rejection");
    await page.close();
    page = original;
    assert.deepEqual(await read(page),twice,"closing sibling modified original tab");
    // Independent clean context has no saved history and cannot affect the original tab.
    stage = "fresh context isolation";
    page = await newPage(); await page.goto(base.href,{waitUntil:"domcontentloaded"}); await compute();
    const clean = await checkpoint("fresh context has no imported receipts");
    history(clean,[]); assert.equal(clean.journal,null); balances(clean,fresh);
    assert.deepEqual(clean.economy.timeline,fresh.economy.timeline);
    assert.deepEqual(await read(original),twice,"independent context changed original tab");
    }
    }
    result.passed = true;
  } catch (e) {
    result.failedAt=stage; result.error=e.stack ?? String(e);
    if(page) result.layoutAtFailure=await page.evaluate(()=>{
      const p=document.getElementById("web-ai-console"), a=document.getElementById("reality-assembly");
      function geometry(n){
        if(!n)return null;const r=n.getBoundingClientRect(),c=getComputedStyle(n);
        return {hidden:n.hidden,ariaSelected:n.getAttribute("aria-selected"),rect:{x:r.x,y:r.y,width:r.width,height:r.height},
          clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,scrollTop:n.scrollTop,
          display:c.display,visibility:c.visibility,overflowY:c.overflowY,flex:c.flex,minHeight:c.minHeight,
          height:c.height,transform:c.transform};
      }
      const focused=document.activeElement,control=p?.querySelector('input[placeholder="model name"]'),r=control?.getBoundingClientRect();
      const hit=r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      const node=window.__TUMBO_REALITY_ASSEMBLY__?.getFeatureObject("web-ai")?.root;
      return {viewport:{width:innerWidth,height:innerHeight},selectedId:window.__TUMBO_REALITY_ASSEMBLY__?.getSnapshot()?.selectedId,
        focusDiagnostic:{activeTag:focused?.tagName,activeId:focused?.id,activePlaceholder:focused?.getAttribute("placeholder"),
          expectedControl:geometry(control),focused:focused===control,caret:control?[control.selectionStart,control.selectionEnd]:null,
          centerHit:hit?{tag:hit.tagName,id:hit.id,className:typeof hit.className==="string"?hit.className:""}:null,
          scaleRatio:node?node.scale.y/node.scale.x:null},
        assemblyClass:a?.className,readingProjection:a?.dataset.readingProjection,
        panel:geometry(p),head:geometry(p?.querySelector(".web-ai-head")),body:geometry(p?.querySelector(".web-ai-body")),
        tabs:geometry(p?.querySelector(".web-ai-tabs")),boundary:geometry(p?.querySelector(".web-ai-boundary")),
        faces:[...(p?.querySelectorAll("[data-panel]")??[])].map(n=>({face:n.dataset.panel,...geometry(n)})),
        tabStates:[...(p?.querySelectorAll("[data-tab]")??[])].map(n=>({tab:n.dataset.tab,...geometry(n)})),
        directory:geometry(a?.querySelector(".assembly-directory")),searchValue:a?.querySelector("[data-search]")?.value,
        visibleResults:[...(a?.querySelectorAll(".assembly-domain-features > button:not([hidden])")??[])].map(n=>n.textContent)};
    }).catch(error=>({error:String(error)}));
    await page?.screenshot({path:resolve(out,device.name+"-failure.png")}).catch(()=>{});
  } finally { for (const c of contexts.reverse()) await c.close(); }
  if (result.pageErrors.length || result.forbiddenRequests.length) {
    result.passed=false; result.error ??= "Page errors or forbidden traffic; inspect arrays";
  }
  return result;
}
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.MATUMBO_CHROMIUM ?? chromium.executablePath(),
    args:["--no-sandbox","--enable-unsafe-swiftshader"]});
  report.browserVersion=browser.version();
  const cases=devices.filter(d=>!selected||d.name===selected);
  for(const d of cases) report.results.push(await runDevice(browser,d));
  report.passed=report.results.length===cases.length && report.results.every(r=>r.passed);
} catch(e) { report.error=e.stack??String(e); }
finally {
  await browser?.close();
  await writeFile(resolve(out,"results.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
  if(!report.passed) process.exitCode=1;
}
