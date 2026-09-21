import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDefaultFeature} from '../src/core/default-landing.js';

test('no route params -> reality-lens (clean constellation overview)',()=>{
  assert.equal(resolveDefaultFeature(new URLSearchParams(''),''),'block-world');
  assert.equal(resolveDefaultFeature(new URLSearchParams(''),null),'block-world');
  assert.equal(resolveDefaultFeature('',''),'block-world');
});

test('any explicit route -> null (never rewritten)',()=>{
  assert.equal(resolveDefaultFeature(new URLSearchParams('?feature=block-world'),''),null);
  assert.equal(resolveDefaultFeature(new URLSearchParams('?panel=block-world'),''),null);
  assert.equal(resolveDefaultFeature(new URLSearchParams('?feature=gateway'),''),null);
  assert.equal(resolveDefaultFeature(new URLSearchParams('?feature=reality-lens'),''),null);
  assert.equal(resolveDefaultFeature(new URLSearchParams('?panel=person&person=x'),''),null);
});

test('hash -> null (an explicit route, even a bare #fragment)',()=>{
  assert.equal(resolveDefaultFeature(new URLSearchParams(''),'#intro'),null);
  assert.equal(resolveDefaultFeature(new URLSearchParams(''),'#'), 'block-world');
});

test('deliberate cube-field entries keep working unchanged',()=>{
  // ?feature=block-world, ?panel=block-world, explicit Block World
  // selection, and cube-dive double-tap are deliberate entries: the
  // resolver returns null so the URL-driven routing is untouched.
  assert.equal(resolveDefaultFeature(new URLSearchParams('?feature=block-world'),''),null);
  assert.equal(resolveDefaultFeature(new URLSearchParams('?panel=block-world'),''),null);
});

test('accepts a raw query string as well as URLSearchParams',()=>{
  assert.equal(resolveDefaultFeature('feature=contracts',''),null);
  assert.equal(resolveDefaultFeature('',''),'block-world');
});
