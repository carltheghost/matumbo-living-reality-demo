import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveDefaultFeature } from '../src/core/default-landing.js';

const root = process.cwd();

test('canonical Living Reality landing is Reality Assembly', () => {
  assert.equal(resolveDefaultFeature(new URLSearchParams(''), ''), 'reality-lens');
  assert.equal(resolveDefaultFeature(new URLSearchParams('feature=reality-lens'), ''), null);
});

test('canonical landing boot opens Reality Assembly after it is mounted', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  assert.match(main, /const cleanRealityLanding =/);
  assert.match(main, /if \(cleanRealityLanding\) \{\s*featureNavigator\.close\(\);\s*realityAssembly\.open\(\);/);
  assert.match(main, /window\.__TUMBO_REALITY_ASSEMBLY__\s*=\s*realityAssembly/);
});

test('canonical landing does not load the superseded overlay stack', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  assert.doesNotMatch(main, /constellation-overview\.js/);
  assert.doesNotMatch(main, /tab-registry\.js/);
  assert.doesNotMatch(main, /tab-engine\.js/);
  assert.doesNotMatch(main, /gateway-tentacles\.js/);
});

test('canonical Reality Assembly owns the clean glass-cube presentation', () => {
  const assembly = fs.readFileSync(path.join(root, 'src/render/reality-assembly.js'), 'utf8');
  assert.match(assembly, /assembly-clean/);
  assert.match(assembly, /document\.body\.classList\.add\('assembly-mode'\)/);
  assert.match(assembly, /spatial\.layer\.visible=true/);
});
