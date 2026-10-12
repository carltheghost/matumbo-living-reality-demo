import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

test('Pages publishes a self-contained local phone route without changing the canonical launcher', async () => {
  const [canonical, route, shield, shared, bootstrap, fieldWorld, fabric, sw] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('phone/index.html', root), 'utf8'),
    readFile(new URL('phone/static-route-shield.js', root), 'utf8'),
    readFile(new URL('shared.js', root), 'utf8'),
    readFile(new URL('phone/bootstrap.mjs', root), 'utf8'),
    readFile(new URL('phone/field-world.mjs', root), 'utf8'),
    readFile(new URL('phone/spatial-fabric.mjs', root), 'utf8'),
    readFile(new URL('vivo-sw.js', root), 'utf8'),
  ]);
  assert.match(canonical, /src="shared\.js"/);
  assert.doesNotMatch(canonical, /phone\/bootstrap\.mjs/);
  assert.match(route, /href="\.\.\/shared\.css"/);
  assert.match(route, /src="\.\.\/shared\.js"/);
  assert.match(route, /src="\.\/bootstrap\.mjs"/);
  assert.match(route, /src="\.\/static-route-shield\.js"/);
  assert.match(shield, /PAGES STATIC\/OFFLINE/);
  assert.match(shield, /readyz/);
  assert.match(shared, /services\\\/vivo\\\/web\\\/phone/);
  assert.match(bootstrap, /PAGES STATIC\/OFFLINE/);
  assert.match(bootstrap, /canonical authority unavailable/);
  assert.match(bootstrap, /STATIC_PHONE_ROUTE \? new URL\('\.\/index\.html'/);
  assert.match(fieldWorld, /vivo\.phone\.field-world\/1/);
  assert.match(fieldWorld, /analytic-information-mixture/);
  assert.match(fabric, /spatial-interaction-fabric\/1/);
  assert.match(fabric, /releaseKind/);
  assert.match(sw, /phone\/index\.html/);
  assert.match(sw, /phone\/static-route-shield\.js/);
  assert.match(sw, /phone\/field-world\.mjs/);
  assert.match(sw, /phone\/spatial-fabric\.mjs/);
  assert.match(sw, /phoneNavigation/);
  assert.match(sw, /shell\.match\(scoped\('phone\/index\.html'\)\)/);
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
});
