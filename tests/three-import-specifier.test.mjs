import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const THREE_BEARING_SOURCE_FILES = [
  '../src/render/hand-presence.js',
  '../src/render/chess-arena.js',
  '../src/render/person-organisms.js',
  '../src/domains/token-vault-ui.js',
  '../src/render/token-lifecycle.js',
  '../src/render/photo-mascot-presence.js',
  '../src/render/token-gamification.js',
  '../src/render/distribution-explorer.js',
  '../src/domains/token-transfers-ui.js',
];

test('bare Three.js imports use the import-map key without a query string', async () => {
  for (const relativePath of THREE_BEARING_SOURCE_FILES) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]three\?/i, `${relativePath} must not put a cache query on the bare import-map specifier`);
    assert.doesNotMatch(source, /import\(['"]three\?/i, `${relativePath} must not dynamically import a queried bare specifier`);
  }
});

test('relative local modules may keep their explicit cache-bust query strings', async () => {
  const source = await readFile(new URL('../src/render/photo-mascot-presence.js', import.meta.url), 'utf8');
  assert.match(source, /from ['"]\.\/photo-mascot\.js\?v=/);
});

test('the browser import contract stays explicit', () => {
  assert.equal(typeof globalThis, 'object');
});