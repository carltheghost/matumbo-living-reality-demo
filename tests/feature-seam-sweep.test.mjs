import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_DEFINITIONS, FEATURE_FUTURE_OPTIONS } from '../src/render/feature-navigator.js';

// Regression implementation of the dead-end seam sweep: a registered feature
// must be reachable somewhere, and a capability-gated future option must route
// to a real local boundary feature. New features cannot silently die at the seams.
const defIds = FEATURE_DEFINITIONS.map((f) => f.id);
const futureIds = FEATURE_FUTURE_OPTIONS.map((o) => o.id);
const defSet = new Set(defIds);

test('no duplicate feature or future-option ids', () => {
  const all = [...defIds, ...futureIds];
  assert.equal(new Set(all).size, all.length, 'duplicate ids found');
  assert.ok(defIds.length >= 29, `expected at least 29 registered features, saw ${defIds.length}`);
});

test('every future option routes to a real registered feature id', () => {
  for (const option of FEATURE_FUTURE_OPTIONS) {
    assert.ok(option.routeId, `${option.id} has no routeId`);
    assert.ok(defSet.has(option.routeId),
      `future option ${option.id} routes to unknown feature ${option.routeId}`);
    assert.ok(option.detail && option.status,
      `future option ${option.id} is missing detail/status copy`);
  }
});

test('every registered feature carries complete directory metadata', () => {
  for (const feature of FEATURE_DEFINITIONS) {
    for (const field of ['label', 'kicker', 'description', 'boundary']) {
      assert.ok(String(feature[field] ?? '').trim().length > 0,
        `${feature.id} is missing ${field}`);
    }
  }
});

test('every feature id reaches a seam file: feature registry, main.js, index.html, or projection', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const projection = readFileSync(new URL('../src/core/demo-projection.js', import.meta.url), 'utf8');
  const featureNavigator = readFileSync(new URL('../src/render/feature-navigator.js', import.meta.url), 'utf8');
  for (const id of defIds) {
    const reachable = featureNavigator.includes(id) || main.includes(id) || html.includes(id) || projection.includes(id);
    assert.ok(reachable, `feature ${id} is registered but reaches no seam file`);
  }
});
