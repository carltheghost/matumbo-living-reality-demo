/** Real local UI acceptance; public failures are evidence, never substituted data. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const base = process.env.NETWORK_TOOLS_BASE_URL || 'http://127.0.0.1:8082/';
const angle = process.env.NETWORK_TOOLS_ANGLE === 'd3d11' ? 'd3d11' : 'swiftshader';
const out = path.resolve(process.env.NETWORK_TOOLS_OUTPUT || path.join(__dirname, '../work/network-tools-browser'));
fs.mkdirSync(out, { recursive: true });
const files = ['src/main.js', 'src/domains/network-tools.js', 'src/render/api-connections.js', 'src/render/api-connections.css', 'src/render/my-gpt.js', 'src/render/web-ai.js', 'scripts/provider_bridge.py', 'scripts/verify-demo-launch.ps1'];
const fingerprints = () => Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex')]));
const report = { base, startedAt: new Date().toISOString(), sourceBefore: fingerprints(), runs: [], isolatedBrowserStorage: true, independentColdLoads: true, browserChannel: 'chromium', requestedAngle: angle, softwareWebGL: angle === 'swiftshader', inferenceAttempted: false };
const save = () => fs.writeFileSync(path.join(out, 'acceptance.json'), JSON.stringify(report, null, 2));

async function run(context, name, viewport) {
  const page = context.pages()[0] || await context.newPage(); await page.setViewportSize(viewport);
  const entry = { name, viewport, checks: [], pageErrors: [] };
  const onPageError = e => entry.pageErrors.push(String(e.stack));
  report.runs.push(entry); page.on('pageerror', onPageError);
  const pendingRequests = new Set();
  entry.unexpectedProviderActions = [];
  const onRequest = request => {
    pendingRequests.add(request.url());
    if (request.method() !== 'GET' && /\/api\/(gpt|nvidia)\//.test(new URL(request.url()).pathname)) entry.unexpectedProviderActions.push({ method: request.method(), path: new URL(request.url()).pathname });
  }, onFinished = request => pendingRequests.delete(request.url());
  page.on('request', onRequest); page.on('requestfinished', onFinished); page.on('requestfailed', onFinished);
  const check = async (label, fn) => { try { const details = await fn(); entry.checks.push({ label, pass: true, ...details }); } catch (e) { entry.checks.push({ label, pass: false, error: String(e.stack) }); } save(); console.log(JSON.stringify({ view: name, ...entry.checks.at(-1) })); };
  const openConnections = async () => { if (!await page.locator('#api-connections-panel').isVisible()) await page.locator('#api-connections-trigger').click(); };
  const openSources = async () => { const details = page.locator('.api-connections-public'); if (!await details.evaluate(el => el.open)) await details.locator('summary').click(); };
  const textView = async () => { const control = page.locator('[data-surface-text-view]'); if (await control.getAttribute('aria-pressed') !== 'true') await control.click(); };
  try {
    if (page.url() === 'about:blank') await page.goto(base + '?feature=reality-lens&space=network', { waitUntil: 'commit', timeout: 30000 });
    else await page.evaluate(() => { window.__TUMBO_FEATURE_NAVIGATOR__.select('reality-lens', 'url', { updateLocation: true }); window.__TUMBO_FEATURE_NAVIGATOR__.close(); window.__TUMBO_REALITY_ASSEMBLY__.openSpace('network'); });
    await page.waitForFunction(() => window.__TUMBO_REALITY_ASSEMBLY__?.getSnapshot().spaceId === 'network', null, { timeout: 45000 });
    await page.waitForFunction(() => window.__TUMBO_API_CONNECTIONS__ && !window.__TUMBO_API_CONNECTIONS__.getSnapshot().checking, null, { timeout: 40000 });
    await check('network-keeps-four-feature-owners', async () => {
      const snapshot = await page.evaluate(() => window.__TUMBO_REALITY_ASSEMBLY__.getSnapshot());
      assert.equal(snapshot.spaceView, 'space'); assert.equal(snapshot.spaceId, 'network');
      const owners = [...snapshot.spatial.visibleFeatureIds].sort();
      assert.deepEqual(owners, ['bot-plaza', 'gateway', 'social-explorer', 'web-ai']);
      const renderer = await page.evaluate(() => {
        const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl');
        if (!gl) return { available: false };
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        const info = { available: true, vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null, renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null };
        gl.getExtension('WEBGL_lose_context')?.loseContext(); return info;
      });
      entry.renderer = renderer;
      await page.screenshot({ path: path.join(out, name + '-network.png') }); return { spaceId: snapshot.spaceId, owners };
    });
    await check('live-assistant-and-local-plugin-status', async () => {
      await openConnections(); const snapshot = await page.evaluate(() => window.__TUMBO_API_CONNECTIONS__.getSnapshot());
      assert(snapshot.gpt); assert.equal(snapshot.credentialsInBrowser, false); assert.equal(snapshot.automaticInference, false);
      assert.deepEqual(snapshot.localTools.map(t => t.id), ['lens-guide', 'plan-helper']); assert(snapshot.localTools.every(t => t.state === 'enabled'));
      const panel = await page.locator('#api-connections-panel').boundingBox(); assert(panel.x >= 0 && panel.x + panel.width <= viewport.width + 1); assert(panel.y >= 0 && panel.y + panel.height <= viewport.height + 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(out, name + '-connections.png') });
      return { gpt: snapshot.gpt, nvidia: snapshot.nvidia, localTools: snapshot.localTools, publicSources: snapshot.publicSources.map(s => ({ id: s.id, state: s.state, provider: s.provider, summary: s.summary, sourceUrl: s.sourceUrl, observedAt: s.observedAt })) };
    });
    await check('assistant-refresh-is-local-GET-only', async () => {
      const requests = []; const onRequest = request => requests.push({ url: request.url(), method: request.method() }); page.on('request', onRequest);
      await page.getByRole('button', { name: 'Refresh assistant status', exact: true }).click(); await page.waitForFunction(() => !window.__TUMBO_API_CONNECTIONS__.getSnapshot().checking);
      page.off('request', onRequest); assert.equal(requests.length, 2); assert(requests.every(r => r.method === 'GET' && r.url.startsWith(base + 'api/'))); return { requests };
    });
    await check('API-setup-handoff-selects-actual-owner-and-provider', async () => {
      await page.getByRole('button', { name: 'Open API setup', exact: true }).click();
      await page.waitForFunction(() => window.__TUMBO_WEB_AI__.getGptSnapshot().provider === 'openai');
      assert.equal(await page.evaluate(() => window.__TUMBO_FEATURE_NAVIGATOR__.getSnapshot().activeId), 'web-ai');
      assert.equal(await page.locator('#api-connections-panel').isVisible(), false); await textView();
      assert.equal(await page.getByRole('button', { name: 'OpenAI API', exact: true }).getAttribute('aria-pressed'), 'true');
      return { feature: 'web-ai', provider: 'openai' };
    });
    await check('ChatGPT-handoff-selects-actual-account-mode', async () => {
      await openConnections(); await page.getByRole('button', { name: 'Open My GPT', exact: true }).click();
      await page.waitForFunction(() => window.__TUMBO_WEB_AI__.getGptSnapshot().provider === 'chatgpt');
      assert.equal(await page.evaluate(() => window.__TUMBO_WEB_AI__.getSnapshot().tab), 'gpt'); return { provider: 'chatgpt' };
    });
    await check('Lens-Guide-handoff-and-scripted-reply', async () => {
      await openConnections(); await page.locator('[data-plugin="lens-guide"]').getByRole('button').click();
      await page.waitForFunction(() => window.__TUMBO_BOT_PLAZA__.console.getSnapshot().selectedBotId === 'lens-guide'); await textView();
      await page.locator('#bot-plaza-input').fill('Where is My GPT?'); await page.locator('#bot-plaza-send').click();
      assert((await page.locator('#bot-plaza-chat-log').textContent()).includes('Web + AI')); return { selectedBotId: 'lens-guide' };
    });
    await check('Plan-Helper-handoff-and-local-plan', async () => {
      await openConnections(); await page.locator('[data-plugin="plan-helper"]').getByRole('button').click();
      await page.waitForFunction(() => window.__TUMBO_BOT_PLAZA__.console.getSnapshot().selectedBotId === 'plan-helper');
      assert.equal(await page.locator('[data-surface-text-view]').getAttribute('aria-pressed'), 'true');
      await page.locator('#bot-plaza-input').fill('Organize this world'); await page.locator('#bot-plaza-send').click();
      assert((await page.locator('#bot-plaza-chat-log').textContent()).includes('Nothing has been executed or scheduled')); return { selectedBotId: 'plan-helper' };
    });
    await check('individual-FX-retry-and-local-reference-conversion', async () => {
      await openConnections(); await openSources(); const requests = []; const onRequest = r => requests.push({ url: r.url(), method: r.method() }); page.on('request', onRequest);
      await page.getByRole('button', { name: 'Check Exchange rates', exact: true }).click(); await page.waitForFunction(() => !window.__TUMBO_API_CONNECTIONS__.getSnapshot().checking, null, { timeout: 25000 });
      page.off('request', onRequest); assert(requests.length >= 1 && requests.length <= 2); assert(requests.every(r => /frankfurter|open.er-api/.test(r.url) && r.method === 'GET'));
      const source = await page.evaluate(() => window.__TUMBO_API_CONNECTIONS__.getSnapshot().publicSources.find(s => s.id === 'fx'));
      if (source.state === 'available') {
        await page.getByLabel('Amount', { exact: true }).fill('100'); await page.getByLabel('From', { exact: true }).selectOption('EUR'); await page.getByLabel('To', { exact: true }).selectOption('USD');
        const extra = []; const listener = r => extra.push(r.url()); page.on('request', listener); await page.getByRole('button', { name: 'Convert reference amount', exact: true }).click(); page.off('request', listener);
        const text = await page.locator('.api-connections-conversion').textContent();
        const expected = await page.evaluate(rate => `100 EUR ≈ ${(100 * rate).toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`, source.observation.rates.USD);
        if (/stale|invalid date|did not return/.test(text)) assert(text.length > 0);
        else { assert(text.includes(expected)); assert(text.includes(source.provider)); assert(text.includes(source.observedAt)); }
        assert.equal(extra.length, 0);
      } else assert(await page.getByRole('button', { name: 'Convert reference amount', exact: true }).isDisabled());
      entry.drawerLayout = await page.locator('#api-connections-panel').evaluate(panel => ({ scrollLeft: panel.scrollLeft, width: panel.clientWidth, scrollWidth: panel.scrollWidth, header: panel.querySelector('.api-connections-head').getBoundingClientRect().toJSON(), heading: panel.querySelector('h2').getBoundingClientRect().toJSON(), headerContentScrollLeft: panel.querySelector('.api-connections-head>div').scrollLeft, headerContentWidth: panel.querySelector('.api-connections-head>div').clientWidth, headerContentScrollWidth: panel.querySelector('.api-connections-head>div').scrollWidth }));
      assert.equal(entry.drawerLayout.scrollLeft, 0); assert(entry.drawerLayout.scrollWidth <= entry.drawerLayout.width + 1);
      assert(entry.drawerLayout.heading.x >= entry.drawerLayout.header.x, 'drawer heading must stay inside its header');
      assert(await page.locator('#api-connections-panel h2').evaluate(heading => {
        const bounds = heading.getBoundingClientRect();
        return document.elementFromPoint(bounds.x + 5, bounds.y + bounds.height / 2)?.closest('#api-connections-panel') != null;
      }), 'the active feature Text view must not occlude the Connections heading');
      await page.locator('.api-connections-conversion').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, name + '-public-tools.png') }); return { requests, sourceState: source.state, sourceProvider: source.provider, conversion: await page.locator('.api-connections-conversion').textContent() };
    });
    await check('cancel-pending-public-read-recovers-and-suppresses-late-data', async () => {
      let release; const released = new Promise(resolve => { release = resolve; });
      await page.route('https://api.open-meteo.com/**', async route => { await released; try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { temperature_2m: 99, time: 'test-only-late' } }) }); } catch {} });
      await page.getByRole('button', { name: 'Check Weather', exact: true }).click(); await page.waitForFunction(() => window.__TUMBO_API_CONNECTIONS__.getSnapshot().checking);
      const before = await page.evaluate(() => window.__TUMBO_API_CONNECTIONS__.getSnapshot().publicSources.find(s => s.id === 'weather'));
      await page.getByRole('button', { name: 'Stop waiting', exact: true }).click(); await page.waitForFunction(() => !window.__TUMBO_API_CONNECTIONS__.getSnapshot().checking);
      release(); await page.waitForTimeout(120); assert.deepEqual(await page.evaluate(() => window.__TUMBO_API_CONNECTIONS__.getSnapshot().publicSources.find(s => s.id === 'weather')), before);
      assert(await page.getByRole('button', { name: 'Check connections', exact: true }).isEnabled()); await page.unroute('https://api.open-meteo.com/**'); return { injectedFailureOnly: true };
    });
    await check('keyboard-dismiss-restores-focus-and-no-uncaught-errors', async () => {
      await page.getByRole('button', { name: 'Check connections', exact: true }).focus(); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#api-connections-panel').isVisible(), false); assert.equal(await page.evaluate(() => document.activeElement.id), 'api-connections-trigger');
      assert.deepEqual(entry.pageErrors, []); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(entry.unexpectedProviderActions, []);
    });
  } finally { entry.pendingRequests = [...pendingRequests]; page.off('pageerror', onPageError); page.off('request', onRequest); page.off('requestfinished', onFinished); page.off('requestfailed', onFinished); save(); }
}
(async () => {
  const healthResponse = await fetch(base + 'api/health'); assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  const expectedRoot = crypto.createHash('sha256').update(path.resolve(__dirname, '..').replaceAll('\\', '/').toLowerCase()).digest('hex');
  assert.equal(health.service, 'matumbo-provider-bridge'); assert.equal(health.rootFingerprint, expectedRoot); assert.equal(health.healthy, true);
  report.liveIdentity = { instanceId: health.instanceId, rootFingerprint: health.rootFingerprint, featureCount: health.featureCount, checkedAt: health.checkedAt };
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=' + angle] });
  try {
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      try { await run(context, name, viewport); } finally { await context.close(); }
    }
  }
  finally { await browser.close(); report.sourceAfter = fingerprints(); report.sourceUnchanged = JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter); save(); }
  assert(report.sourceUnchanged); const failed = report.runs.flatMap(r => r.checks.filter(c => !c.pass)); console.log(JSON.stringify({ checks: report.runs.reduce((n, r) => n + r.checks.length, 0), failures: failed.length, output: out })); if (failed.length) process.exitCode = 1;
})().catch(error => { report.error = String(error.stack); save(); console.error(error); process.exitCode = 1; });
