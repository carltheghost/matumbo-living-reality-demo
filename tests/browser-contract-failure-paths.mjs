// Actual browser regressions for the six PR118 contract/market failure paths.
// Run against the local read-only preview server; it never calls a provider or
// performs a financial action.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(process.env.MATUMBO_NODE_DEPENDENCIES ?? '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const base = process.env.MATUMBO_PREVIEW_URL ?? 'http://127.0.0.1:4184/';

const browser = await chromium.launch({ headless: true, executablePath: process.env.MATUMBO_CHROMIUM ?? '/usr/bin/chromium' });
const results = [];

async function openContext({ quota = false, feature = 'contract-atelier' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  if (quota) {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem() { return null; },
          setItem() { throw new DOMException('quota', 'QuotaExceededError'); },
          removeItem() {},
          clear() {},
          key() { return null; },
          length: 0,
        },
      });
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/__preview/revision', (route) => route.fulfill({ json: { revision: 'pr118-failure-paths' } }));
  await page.goto(`${base}?feature=${feature}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#contract-workbench', { state: 'attached' });
  await page.waitForSelector('#market-builder', { state: 'attached' });
  return { context, page, errors };
}

async function createListing(page, question) {
  const market = page.locator('#market-builder');
  await market.locator('input[aria-label="Creator label"]').fill('Browser author');
  await market.locator('input[aria-label="Listing question"]').fill(question);
  await market.locator('textarea[aria-label="Terms and completion criteria"]').fill('Browser failure-path terms');
  await market.locator('textarea[aria-label="Outcomes · one per line"]').fill('YES\nNO');
  await market.getByRole('button', { name: 'Create local listing', exact: true }).click();
}

async function testQuotaAndSelection() {
  const quota = await openContext({ quota: true, feature: 'contracts' });
  try {
    await createListing(quota.page, 'Quota listing');
    const status = quota.page.locator('#market-builder .marketplace-status');
    await assertPoll(status, /Local listing created/);
    await assertPoll(status, /Workspace is memory-only/);
    assert.equal(await quota.page.locator('#market-builder .marketplace-card').count(), 1);
    await quota.page.reload({ waitUntil: 'domcontentloaded' });
    await quota.page.waitForSelector('#market-builder', { state: 'attached' });
    assert.equal(await quota.page.locator('#market-builder .marketplace-card').count(), 0, 'quota-backed listing must not be reported as durable after reload');
  } finally {
    await quota.context.close();
  }

  const opened = await openContext({ feature: 'contracts' });
  try {
    await createListing(opened.page, 'First browser listing');
    await createListing(opened.page, 'Second browser listing');
    const selected = opened.page.locator('#market-builder .marketplace-card[data-selected="true"]');
    assert.equal(await selected.count(), 1);
    assert.match(await selected.textContent(), /Second browser listing/);
    results.push({ name: 'quota warning and synchronous listing selection', errors: opened.errors });
  } finally {
    await opened.context.close();
  }
}

async function testGoverningRefreshAndDraftForecast() {
  const linked = await openContext({ feature: 'contracts' });
  try {
    const contractId = await linked.page.evaluate(() => window.__TUMBO_CONTRACT_AUTOMATION__.create({ templateId: 'service', title: 'Contract created after Marketplace mount' }).id);
    await linked.page.waitForFunction((id) => [...document.querySelector('#market-builder select[aria-label="Governing contract (optional)"]').options].some((option) => option.value === id), contractId);
    assert.equal(await linked.page.locator(`#market-builder select[aria-label="Governing contract (optional)"] option[value="${contractId}"]`).count(), 1);
    results.push({ name: 'governing-contract refresh after post-mount create', errors: linked.errors });
  } finally {
    await linked.context.close();
  }

  const { context, page, errors } = await openContext({ feature: 'contract-atelier' });
  try {
    const workbench = page.locator('#contract-workbench');
    await workbench.getByRole('button', { name: 'Create contract', exact: true }).click();
    await workbench.locator('select[name="templateId"]').selectOption('custom');
    const terms = {
      startsAt: null,
      expiresAt: null,
      sources: [{ id: 'ready', label: 'Ready', type: 'boolean', maxAgeMs: 86400000, provider: 'manual' }],
      rules: [
        { id: 'repeat', label: 'Repeat twice', when: { op: 'eq', source: 'ready', value: true }, actions: [{ type: 'record', label: 'Repeat' }], schedule: { everyMs: 60000, maxRuns: 2 } },
        { id: 'after-repeat', label: 'After repeat', after: ['repeat'], when: { op: 'eq', source: 'ready', value: true }, actions: [{ type: 'record', label: 'After' }] },
      ],
      limits: { maxTotalPoints: 1000, maxExecutions: 10 },
    };
    await workbench.getByText('Advanced JSON terms · nested logic & local effects', { exact: true }).click();
    await workbench.locator('input[name="title"]').fill('Recurring dependency draft');
    await workbench.locator('input[name="advancedEnabled"]').check();
    await workbench.locator('textarea[name="advancedTerms"]').fill(JSON.stringify(terms));
    await workbench.locator('textarea[name="preview-evidence"]').fill('{"ready":true}');
    await workbench.getByRole('button', { name: 'Preview simulated lifecycle', exact: true }).click();
    const preview = workbench.locator('.cw-preview-output');
    await assertPoll(preview, /Repeat twice · TRIGGERED/);
    await assertPoll(preview, /After repeat · WAITING/);

    await workbench.locator('input[name="title"]').fill('Edited after forecast');
    await assertPoll(preview, /Draft changed after this forecast/);
    assert.equal(await preview.locator('text=Repeat twice · TRIGGERED').count(), 0);
    results.push({ name: 'recurring dependency and stale draft forecast', errors });
  } finally {
    await context.close();
  }
}

async function testSavedForecastState() {
  const { context, page, errors } = await openContext();
  try {
    const id = await page.evaluate(() => {
      const engine = window.__TUMBO_CONTRACT_AUTOMATION__;
      const record = engine.create({
        templateId: 'custom',
        title: 'Stale saved forecast',
        terms: {
          sources: [{ id: 'condition', label: 'Condition', type: 'boolean', maxAgeMs: 1000, provider: 'manual' }],
          rules: [{ id: 'condition-rule', label: 'Condition rule', when: { op: 'eq', source: 'condition', value: true }, actions: [{ type: 'record', label: 'Recorded' }] }],
          limits: { maxTotalPoints: 1000, maxExecutions: 10 },
        },
      });
      engine.observe({ id: `old:${record.id}`, contractId: record.id, source: 'condition', value: true, provider: 'manual', observedAt: Date.now() - 86400000 });
      engine.approve(record.id, { actor: 'owner' });
      engine.approve(record.id, { actor: 'reviewer' });
      return record.id;
    });
    await page.evaluate((contractId) => window.__TUMBO_CONTRACT_WORKBENCH__.select(contractId), id);
    const savedPreview = page.locator('.cw-current-preview');
    await assertPoll(savedPreview, /SAVED-STATE FORECAST · NO STATE CHANGED/);
    await assertPoll(savedPreview, /Saved status: active/);
    await assertPoll(savedPreview, /saved receipts 0/);
    await assertPoll(savedPreview, /Condition rule · UNKNOWN/);
    assert.equal(await savedPreview.locator('text=Condition rule · TRIGGERED').count(), 0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#contract-workbench');
    await page.evaluate((contractId) => window.__TUMBO_CONTRACT_WORKBENCH__.select(contractId), id);
    await assertPoll(page.locator('.cw-current-preview'), /Actual evidence timestamps preserved/);
    results.push({ name: 'saved-state forecast preserves status, receipts, and stale evidence', errors });
  } finally {
    await context.close();
  }
}

async function assertPoll(locator, pattern) {
  assert.match((await locator.textContent()) ?? '', pattern);
}

try {
  await testQuotaAndSelection();
  await testGoverningRefreshAndDraftForecast();
  await testSavedForecastState();
  assert.deepEqual(results.flatMap((entry) => entry.errors), []);
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally {
  await browser.close();
}
