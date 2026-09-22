import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDefaultFeature } from '../src/core/default-landing.js';

test('clean root -> Reality Assembly / Living Reality constellation',()=>{
  assert.equal(resolveDefaultFeature(new URLSearchParams(''),''),'reality-lens');
  assert.equal(resolveDefaultFeature(new URLSearchParams(''),null),'reality-lens');
  assert.equal(resolveDefaultFeature('',''),'reality-lens');
});

test('explicit feature and panel routes are never rewritten',()=>{
  assert.equal(resolveDefaultFeature(new URLSearchParams('?feature=block-world'),''),null);
  assert.equal(resolveDefaultFeature(new URLSearchParams('?panel=block-world'),''),null);
  assert.equal(resolveDefaultFeature(new URLSearchParams('?feature=reality-lens'),''),null);
  assert.equal(resolveDefaultFeature(new URLSearchParams('?panel=person&person=x'),''),null);
});

test('a non-empty hash remains explicit',()=>{
  assert.equal(resolveDefaultFeature(new URLSearchParams(''),'#intro'),null);
  assert.equal(resolveDefaultFeature(new URLSearchParams(''),'#'), 'reality-lens');
});

test('raw query strings remain supported',()=>{
  assert.equal(resolveDefaultFeature('feature=contracts',''),null);
  assert.equal(resolveDefaultFeature('',''),'reality-lens');
});
