import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

test('Pages publishes a self-contained local phone route without changing the canonical launcher', async () => {
  const [canonical, route, staticShared, bootstrap, fieldWorld, fabric, sw, conversationTransport, phoneRender, phoneCss, palette, economyEntry, economyManifest] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('phone/index.html', root), 'utf8'),
    readFile(new URL('phone/static-shared.js', root), 'utf8'),
    readFile(new URL('phone/bootstrap.mjs', root), 'utf8'),
    readFile(new URL('phone/field-world.mjs', root), 'utf8'),
    readFile(new URL('phone/spatial-fabric.mjs', root), 'utf8'),
    readFile(new URL('vivo-sw.js', root), 'utf8'),
    readFile(new URL('application/conversation-transport.mjs', root), 'utf8'),
    readFile(new URL('phone/phone-render.mjs', root), 'utf8'),
    readFile(new URL('phone/phone-world.css', root), 'utf8'),
    readFile(new URL('phone/field-palette.mjs', root), 'utf8'),
    readFile(new URL('phone/economy-entry.mjs', root), 'utf8'),
    readFile(new URL('phone/vendor/economy/manifest.json', root), 'utf8'),
  ]);
  assert.match(canonical, /src="shared\.js"/);
  assert.doesNotMatch(canonical, /phone\/bootstrap\.mjs/);
  assert.match(route, /href="\.\.\/shared\.css"/);
  assert.doesNotMatch(route, /src="\.\.\/shared\.js"/);
  assert.match(route, /src="\.\/bootstrap\.mjs"/);
  assert.match(route, /src="\.\/static-shared\.js"/);
  assert.match(staticShared, /PAGES STATIC\/OFFLINE/);
  assert.match(staticShared, /from '\.\/phone-render\.mjs'/);
  assert.match(staticShared, /from '\.\.\/camera\.js'/);
  assert.doesNotMatch(staticShared, /api\('\/readyz'/);
  assert.match(bootstrap, /PAGES STATIC\/OFFLINE/);
  assert.match(bootstrap, /canonical authority unavailable/);
  assert.match(bootstrap, /STATIC_PHONE_ROUTE \? new URL\('\.\/index\.html'/);
  assert.match(bootstrap, /snapshot: \(\) => refreshSnapshot\(\{ externalSnapshot: true \}\)/);
  assert.match(bootstrap, /economy-entry\.mjs/);
  assert.match(fieldWorld, /vivo\.phone\.field-world\/1/);
  assert.match(fieldWorld, /analytic-information-mixture/);
  assert.match(fabric, /spatial-interaction-fabric\/1/);
  assert.match(fabric, /releaseKind/);
  assert.match(sw, /phone\/index\.html/);
  assert.match(sw, /phone\/static-shared\.js/);
  assert.match(sw, /phone\/field-world\.mjs/);
  assert.match(sw, /phone\/phone-render\.mjs/);
  assert.match(sw, /phone\/phone-world\.css/);
  assert.match(sw, /phone\/field-palette\.mjs/);
  assert.match(sw, /phone\/spatial-fabric\.mjs/);
  assert.match(sw, /phone\/local-operation\.mjs/);
  assert.match(sw, /application\/conversation-transport\.mjs/);
  assert.match(sw, /phone\/local-edit-queue\.mjs/);
  assert.match(sw, /phone\/agent-control\.mjs/);
  assert.match(sw, /phoneNavigation/);
  assert.match(sw, /shell\.match\(scoped\('phone\/index\.html'\)\)/);
  assert.match(phoneRender, /class PhoneRenderer/);
  assert.match(phoneCss, /\.field-dock/);
  assert.match(palette, /fieldTone/);
  assert.match(route, /id="phoneEconomyTrigger"/);
  assert.match(route, /id="phoneEconomyPanelHost"/);
  assert.match(route, /aria-controls="simulated-economy-panel"/);
  assert.match(route, /id="phoneEconomyContext" class="context-slot" hidden/);
  assert.match(economyEntry, /__vivoPhoneSimulatedEconomyOwner/);
  assert.match(economyEntry, /No simulated write was attempted/);
  assert.match(economyManifest, /vivo\.phone\.simulated-economy-stage\/1/);
  assert.match(conversationTransport, /vivo\.conversation-provider\/1/);
  assert.match(conversationTransport, /credentials: 'omit'/);
  assert.match(conversationTransport, /cache: 'no-store'/);
});

test('mounted economy staging preserves exact canonical module bytes', async () => {
  const pairs = [
    ['src/domains/simulated-economy.js', 'phone/vendor/economy/src/domains/simulated-economy.js'],
    ['src/domains/token.js', 'phone/vendor/economy/src/domains/token.js'],
    ['src/domains/token-config.js', 'phone/vendor/economy/src/domains/token-config.js'],
    ['src/domains/token-store.js', 'phone/vendor/economy/src/domains/token-store.js'],
    ['src/render/simulated-economy-panel.js', 'phone/vendor/economy/src/render/simulated-economy-panel.js'],
  ];
  for (const [canonicalPath, stagedPath] of pairs) {
    const canonical = await readFile(new URL(`../../../../../${canonicalPath}`, import.meta.url));
    const staged = await readFile(new URL(stagedPath, root));
    assert.deepEqual(staged, canonical, `${stagedPath} must be an exact canonical byte mirror`);
  }
});

test('Pages build copies the route and exposes its local-only boundary check', async () => {
  const [workflow, phoneWorkflow] = await Promise.all([
    readFile(new URL('../../../../../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8'),
    readFile(new URL('../../../../../.github/workflows/vivo-phone.yml', import.meta.url), 'utf8'),
  ]);
  assert.match(workflow, /cp -R services\/vivo\/web\/\. dist\/services\/vivo\/web\//);
  assert.match(workflow, /Verify the static Vivo phone route and local-only boundary/);
  assert.match(workflow, /PAGES STATIC\/OFFLINE/);
  assert.match(workflow, /services\/vivo\/web\/phone\/index\.html/);
  assert.match(phoneWorkflow, /browser-field-world-static/);
  assert.match(phoneWorkflow, /browser_field_world_static\.py/);
  assert.match(phoneWorkflow, /browser_bimanual_transform\.py/);
});

test('Pages live hash verifier covers every changed mounted phone module', async () => {
  const workflow = await readFile(new URL('../../../../../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
  const block = workflow.match(/for name in \[(.*?)\]:/s)?.[1];
  assert.ok(block, 'deploy workflow must expose a public HTTPS hash-verifier list');
  const listed = [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const required = [
    'services/vivo/web/phone/companion.mjs',
    'services/vivo/web/phone/fingertip-input.mjs',
    'services/vivo/web/phone/material-contract.mjs',
    'services/vivo/web/phone/material-input-runtime.mjs',
    'services/vivo/web/phone/material-patch.mjs',
    'services/vivo/web/phone/agent-control.mjs',
    'services/vivo/web/phone/agent-tools.mjs',
    'services/vivo/web/phone/bridge.mjs',
    'services/vivo/web/phone/client.mjs',
    'services/vivo/web/phone/engine.mjs',
    'services/vivo/web/phone/engine-worker.mjs',
    'services/vivo/web/phone/two-hand-camera.mjs',
  ];
  for (const path of required) assert.ok(listed.includes(path), `${path} must be covered by public HTTPS hash verification`);
  assert.equal(new Set(listed).size, listed.length, 'public HTTPS hash-verifier list must not contain duplicate paths');
});
