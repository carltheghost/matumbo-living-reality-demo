import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDefaultFeature,
  applyDefaultBlockWorldLanding,
} from '../src/core/default-landing.js';

test('no route params -> connected Block World (new Living Reality UI)',()=>{
  assert.equal(resolveDefaultFeature(new URLSearchParams(''),''),'block-world');
  assert.equal(resolveDefaultFeature(new URLSearchParams(''),null),'block-world');
  assert.equal(resolveDefaultFeature('',''),'block-world');
});

test('default landing activates the connected cube UI instead of only routing',()=>{
  const html = { classList: { add() {} }, setAttribute() {} };
  const body = { classList: { add() {} }, setAttribute() {} };
  const shell = {
    classList: { remove(name) { assert.equal(name, 'open'); } },
    setAttribute(name, value) {
      assert.equal(name, 'aria-hidden');
      assert.equal(value, 'true');
    },
  };
  const toggle = {
    setAttribute(name, value) {
      assert.equal(name, 'aria-expanded');
      assert.equal(value, 'false');
    },
  };
  const documentRoot = {
    documentElement: html,
    body,
    getElementById(id) {
      if (id === 'feature-shell') return shell;
      if (id === 'feature-toggle') return toggle;
      return null;
    },
  };
  const result = applyDefaultBlockWorldLanding({ search: '', hash: '', documentRoot });
  assert.equal(result.active, true);
  assert.equal(result.ui, 'connected-block-world');
  assert.equal(result.zoom, true);
  assert.equal(result.doubleActivate, true);
});

test('explicit routes do not activate the default landing UI',()=>{
  const result = applyDefaultBlockWorldLanding({
    search: '?feature=reality-lens',
    hash: '',
    documentRoot: {},
  });
  assert.equal(result.active, false);
  assert.equal(result.reason, 'explicit-route');
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
  assert.equal(resolveDefaultFeature(new URLSearchParams('?feature=block-world'),''),null);
  assert.equal(resolveDefaultFeature(new URLSearchParams('?panel=block-world'),''),null);
});

test('accepts a raw query string as well as URLSearchParams',()=>{
  assert.equal(resolveDefaultFeature('feature=contracts',''),null);
  assert.equal(resolveDefaultFeature('',''),'block-world');
});
