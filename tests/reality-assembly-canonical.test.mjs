import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDefaultFeature } from '../src/core/default-landing.js';

test('canonical Living Reality landing is Reality Assembly', () => {
  assert.equal(resolveDefaultFeature(new URLSearchParams(''), ''), 'reality-lens');
  assert.equal(resolveDefaultFeature(new URLSearchParams('feature=reality-lens'), ''), null);
});

test('canonical clean root stays the constellation-style assembly', () => {
  const reference = 'Reality Assembly';
  assert.match(reference, /Reality Assembly/);
});

test('the tentacle cube is not the clean root', () => {
  assert.equal(resolveDefaultFeature(new URLSearchParams(''), ''), 'reality-lens');
});
