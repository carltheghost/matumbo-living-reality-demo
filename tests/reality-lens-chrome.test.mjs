import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEATURE_DEFINITIONS } from '../src/render/feature-navigator.js';
import { lensDirectory, lensRuntimeStatus } from '../src/render/reality-lens-chrome.js';

test('every canonical feature belongs to exactly one navigable space', () => {
  const spaces = lensDirectory(FEATURE_DEFINITIONS);
  const ids = spaces.flatMap(space => space.features.map(feature => feature.id));
  assert.equal(spaces.length, 6);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.toSorted(), FEATURE_DEFINITIONS.map(feature => feature.id).toSorted());
});

test('search finds features by name, intent, and space, and handles empty results', () => {
  const ids = query => lensDirectory(FEATURE_DEFINITIONS, query).flatMap(space => space.features.map(feature => feature.id));
  assert.ok(ids('  YOUTUBE  ').includes('youtube'));
  assert.ok(ids('wardrobe').includes('person'));
  assert.ok(ids('value & contracts').includes('ledger'));
  assert.deepEqual(ids('there-is-no-feature-called-this'), []);
  assert.equal(ids(' ').length, FEATURE_DEFINITIONS.length);
});

test('runtime labels distinguish failed and pending renderers from ready 3D', () => {
  assert.equal(lensRuntimeStatus('ready'), '3D ready');
  assert.equal(lensRuntimeStatus('error'), 'Directory mode · 3D unavailable');
  assert.equal(lensRuntimeStatus('loading'), 'Loading 3D…');
  assert.equal(lensRuntimeStatus(undefined), 'Loading 3D…');
});

test('the actual Pages build includes every root browser script, local CSS, and runtime assets', async () => {
  const output = await mkdtemp(join(tmpdir(), 'matumbo-pages-'));
  try {
    execFileSync('bash', ['scripts/build-pages.sh', output], { cwd: new URL('..', import.meta.url) });
    const html = await readFile(join(output, 'index.html'), 'utf8');
    for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+\.(?:js|css))(?:\?[^" ]*)?"/g)) {
      assert.ok((await stat(join(output, match[1]))).size > 0, match[1] + ' must ship');
    }
    assert.equal(await readFile(join(output, 'mobile-chrome.js'), 'utf8'), await readFile(new URL('../mobile-chrome.js', import.meta.url), 'utf8'));
    assert.ok((await stat(join(output, 'assets'))).isDirectory());
    assert.ok(html.includes('reality-25-bridge.js'));
    for (const developmentPath of ['AGENTS.md', '.git', 'node_modules', 'scripts', 'docs']) {
      await assert.rejects(stat(join(output, developmentPath)));
    }
  } finally { await rm(output, { recursive: true, force: true }); }
});
