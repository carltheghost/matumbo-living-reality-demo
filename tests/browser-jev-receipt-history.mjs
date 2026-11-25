// Fixture-only full-app browser regression. No provider credentials or calls.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { JEV_HISTORY_KEY, parseJevAdviceReceipt } from "../src/domains/jev-advice-receipt.js";
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
const statusSelector = '#web-ai-console [data-panel="economy"] > p[role="status"]';
const duplicate = "This request is already in the saved usage history.";
const conflictMessage = "This request has a conflicting receipt.";
const devices = [{ name: "desktop", viewport: { width: 1280, height: 900 }, mobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true }];
const selected = process.env.MATUMBO_BROWSER_DEVICE;
assert.ok(!selected || devices.some(d => d.name === selected), "unknown browser device");
const report = { schema: "matumbo.jev-receipt-browser-regression/2", passed: false,
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
  const result = { device: device.name, viewport: device.viewport, passed: false, checkpoints: [], pageErrors: [], forbiddenRequests: [] };
  const contexts = [];
  let page, stage = "launch context";
  async function newPage() {
    const context = await browser.newContext({ viewport: device.viewport, isMobile: device.mobile, hasTouch: device.mobile,
      deviceScaleFactor: 1, reducedMotion: "reduce", locale: "en-US", serviceWorkers: "block" });
    contexts.push(context);
    await context.route("**/*", route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== base.origin || !["GET","HEAD"].includes(req.method())) {
        result.forbiddenRequests.push({ method: req.method(), url: url.href }); return route.abort("blockedbyclient");
      }
      if (url.pathname.endsWith("/__preview/revision")) return route.fulfill({ json: { revision: "jev-receipt-fixture" } });
      return route.continue();
    });
    await context.routeWebSocket("**/*", ws => { result.forbiddenRequests.push({ kind: "websocket", url: ws.url() }); ws.close(); });
    const p = await context.newPage();
    p.setDefaultTimeout(20_000); p.setDefaultNavigationTimeout(45_000);
    p.on("pageerror", e => result.pageErrors.push(e.message));
    p.on("popup", popup => { result.forbiddenRequests.push({ kind: "popup", url: popup.url() }); void popup.close(); });
    return p;
  }
  const panel = () => page.locator(panelSelector);
  const hist = () => panel().locator(historySelector);
  const activate = locator => device.mobile ? locator.tap() : locator.click();
  async function checkpoint(label) {
    stage = label;
    const state = await read(page);
    result.checkpoints.push({ label, summary: state.summary, metrics: state.metrics,
      events: state.economy.timeline.events.map(e => e.type) });
    return state;
  }
  async function compute() {
    await page.waitForFunction(() => {
      const p = document.getElementById("web-ai-console"), a = window.__TUMBO_REALITY_ASSEMBLY__;
      const host = p?.closest("#reality-assembly .assembly-css3d-host");
      return a?.getSnapshot().selectedId === "web-ai" && p?.dataset.lensSurfaceAttached === "true" && !p.hidden
        && host && host.dataset.surfaceFallback !== "true" && p.closest(".assembly-css3d-renderer")
        && a.getFeatureObject("web-ai")?.root.children.some(child => child.isCSS3DObject && child.element === p);
    }, null, {timeout:45_000});
    assert.equal(await panel().count(), 1); assert.equal(await hist().count(), 1);
    assert.equal(await panel().getAttribute("data-no-panel-drag"), "true");
    assert.equal(await page.evaluate(() => window.__TUMBO_REALITY_ASSEMBLY__.getSnapshot().objects.filter(o => o.id === "web-ai").length), 1);
    const tab = panel().getByRole("tab", {name:"COMPUTE", exact:true});
    await activate(tab);
    assert.equal(await tab.getAttribute("aria-selected"), "true");
    assert.equal(await panel().locator('[data-panel="economy"]').isVisible(), true);
  }
  async function upload(body, message) {
    stage = "upload: " + message;
    const input = panel().getByLabel("Import a Vivo Jev usage receipt", {exact:true});
    assert.equal(await input.count(), 1);
    await input.scrollIntoViewIfNeeded(); assert.equal(await input.isVisible(), true);
    // Real browser file input/change event; no direct journal calls or storage seeding.
    await input.setInputFiles({name:"jev-fixture.json", mimeType:"application/json",
      buffer:Buffer.from(typeof body === "string" ? body : JSON.stringify(body))});
    await page.waitForFunction(({selector,message}) => {
      const input = document.querySelector('#web-ai-console input[type="file"]');
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
    if (device.mobile) {
      await activate(page.locator("#reality-assembly [data-directory-toggle]"));
      await page.locator("#reality-assembly [data-search]").fill(id);
      const match = page.locator("#reality-assembly .assembly-domain-features > button:visible");
      assert.equal(await match.count(), 1); await activate(match);
    } else {
      const search = page.locator("#reality-assembly [data-quick-search]");
      await search.fill(id); await search.press("Enter");
    }
    await page.waitForFunction(id => window.__TUMBO_REALITY_ASSEMBLY__.getSnapshot().selectedId === id, id);
  }
  async function navigate(expected) {
    stage = "face and object navigation";
    const original = await panel().elementHandle();
    try {
      for (const [name,face] of [["WEB","web"],["AI HELP","ai"],["COMPUTE","economy"]]) {
        const tab = panel().getByRole("tab",{name,exact:true});
        await activate(tab); assert.equal(await tab.getAttribute("aria-selected"),"true");
        assert.equal(await panel().locator("[data-panel]:visible").count(),1);
        assert.equal(await panel().locator('[data-panel="'+face+'"]').isVisible(),true);
        assert.deepEqual(await read(page),expected);
      }
      await select("paycore");
      await page.waitForFunction(() => document.getElementById("web-ai-console").dataset.lensSurfaceAttached !== "true");
      assert.equal(await panel().evaluate(n => n.hidden),true);
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
  try {
    page = await newPage(); await page.goto(base.href,{waitUntil:"domcontentloaded"}); await compute();
    const fresh = await checkpoint("empty native Compute object");
    history(fresh,[]); assert.equal(fresh.journal,null);
    assert.deepEqual(fresh.economy.timeline.events,[]); assert.deepEqual(fresh.metrics,["$0.00","$0.00","0","0"]);
    const funded = await fund();
    const first = await upload(metered.envelope,"Saved 330 input and 20 output tokens.");
    history(first,[metered]); observed(funded,first,metered);
    await rejections(first); await navigate(first); await checkpoint("metered receipt and rejection/navigation invariants");
    const restored = await reload([metered],first.journal,fresh);
    await rejections(restored); await checkpoint("metered reload without replay");
    const fundedAgain = await fund(); history(fundedAgain,[metered]);
    const both = await upload(unknown.envelope,"Saved the receipt. Token counts were unavailable.");
    history(both,[metered,unknown]); observed(fundedAgain,both,unknown);
    await rejections(both,true); await navigate(both); await checkpoint("unmetered receipt preserves nonzero balances");
    const restoredBoth = await reload([metered,unknown],both.journal,fresh);
    await rejections(restoredBoth,true); await checkpoint("both receipts survive reload without replay");
    const twice = await reload([metered,unknown],both.journal,fresh);
    assert.deepEqual(twice,restoredBoth); await checkpoint("repeated reload idempotence");
    await hist().locator(":scope > p").scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(out,device.name+"-restored-history.png")});
    // Independent clean context has no saved history and cannot affect the original tab.
    stage = "fresh context isolation";
    const original = page;
    page = await newPage(); await page.goto(base.href,{waitUntil:"domcontentloaded"}); await compute();
    const clean = await checkpoint("fresh context has no imported receipts");
    history(clean,[]); assert.equal(clean.journal,null); balances(clean,fresh);
    assert.deepEqual(clean.economy.timeline,fresh.economy.timeline);
    assert.deepEqual(await read(original),twice,"independent context changed original tab");
    result.passed = true;
  } catch (e) {
    result.failedAt=stage; result.error=e.stack ?? String(e);
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
