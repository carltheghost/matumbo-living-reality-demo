import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'mobile-layout.css'), 'utf8');
const js = readFileSync(join(root, 'mobile-chrome.js'), 'utf8');

// Remove /* */ comments, then remove every @media{...} block via brace matching.
function stripMediaBlocks(source) {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let i = 0;
  while (i < noComments.length) {
    const at = noComments.indexOf('@media', i);
    if (at === -1) { out += noComments.slice(i); break; }
    out += noComments.slice(i, at);
    const open = noComments.indexOf('{', at);
    let depth = 0;
    let j = open;
    while (j < noComments.length) {
      if (noComments[j] === '{') depth++;
      else if (noComments[j] === '}') { depth--; if (depth === 0) break; }
      j++;
    }
    i = j + 1;
  }
  return out;
}

test('index.html wires the mobile layer with cache-busted URLs', () => {
  assert.match(html, /<meta name="viewport"[^>]*width=device-width/);
  assert.match(html, /<link rel="stylesheet" href="\.\/mobile-layout\.css\?v=[^"]+"/);
  assert.match(html, /<script type="module" src="\.\/mobile-chrome\.js\?v=[^"]+"><\/script>/);
});

test('mobile-layout.css only styles narrow viewports (desktop untouched)', () => {
  assert.match(css, /@media\s*\(max-width:\s*700px\)/);
  assert.match(css, /@media\s*\(max-width:\s*420px\)/);
  const outside = stripMediaBlocks(css).replace(/\s+/g, '');
  assert.equal(outside, '', 'mobile-layout.css must not style viewports outside @media blocks');
});

test('mobile-layout.css covers the dock, sheets, header, and touch targets', () => {
  for (const token of [
    '.mcd-bottom', '[data-mobile-dock-handle]', '.mobile-dock-open',
    '.mobile-view-open', '.mobile-inspect-open', '.assembly-toolbar',
    '.mcd-right', '.assembly-header', 'safe-area-inset-bottom',
  ]) assert.ok(css.includes(token), `mobile-layout.css is missing ${token}`);
  assert.ok(/min-height:\s*4[48]px/.test(css), 'expected >=44px touch targets');
  assert.ok(css.includes('overflow-x:hidden'), 'expected a horizontal-overflow guard');
});

test('mobile-chrome.js toggles the dock and sheets additively', () => {
  for (const token of [
    'mobile-dock-open', 'mobile-view-open', 'mobile-inspect-open',
    'matchMedia', 'mobileDockHandle', 'Escape',
  ]) assert.ok(js.includes(token), `mobile-chrome.js is missing ${token}`);
  // Additive only: it toggles classes and appends buttons, never rewrites markup.
  assert.ok(!/\.innerHTML\s*=/.test(js), 'mobile-chrome.js must not rewrite existing markup');
});
