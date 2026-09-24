import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const helperStart = source.indexOf('function openStaticFeatureRouteOnWebglFailure() {');
const constructorStart = source.indexOf('\nlet renderer;\ntry {', helperStart);
const constructorEnd = source.indexOf("\nruntimeStatus?.setStage?.('renderer'", constructorStart);
assert.ok(helperStart >= 0 && constructorStart > helperStart && constructorEnd > constructorStart);
const bootBoundary = source.slice(helperStart, constructorEnd);

function boot(search, { failRenderer = true, failPanel = false } = {}) {
  const calls = [];
  const failure = new Error('WebGL unavailable');
  const document = {
    body: { dataset: {} },
    head: { appendChild(node) { calls.push(['style', node.textContent]); } },
    createElement(name) {
      assert.equal(name, 'style');
      return { textContent: '' };
    },
  };
  const window = {
    innerWidth: 1024,
    innerHeight: 768,
    navigator: {},
    open() { calls.push(['external-open']); },
    addEventListener() { calls.push(['listener']); },
  };
  const context = {
    URLSearchParams,
    globalThis: { location: { search } },
    document,
    window,
    isMobile: false,
    THREE: {
      WebGLRenderer: class {
        constructor() {
          if (failRenderer) throw failure;
        }
      },
    },
    runtimeStatus: { markFailed(error, phase) { calls.push(['failed', error, phase]); } },
    createYoutubeSurface(options) {
      assert.equal(options.documentRoot, document);
      if (failPanel) throw new Error('YouTube panel failed');
      calls.push(['youtube-created']);
      return { open() { calls.push(['youtube-open']); } };
    },
    createWebAiConsole(options) {
      assert.equal(options.documentRoot, document);
      if (failPanel) throw new Error('Web + AI panel failed');
      calls.push(['web-ai-created', options]);
      return { open(method) { calls.push(['web-ai-open', method]); } };
    },
    console: { warn(...args) { calls.push(['warning', ...args]); } },
  };
  let thrown = null;
  try { vm.runInNewContext(bootBoundary, context); }
  catch (error) { thrown = error; }
  return { calls, document, window, failure, thrown };
}

test('WebGL failure opens the requested Web + AI panel with volatile storage', () => {
  const { calls, document, window, failure, thrown } = boot('?feature=web-ai');
  assert.equal(thrown, failure);
  assert.deepEqual(calls.slice(0, 2).map(([name]) => name), ['failed', 'web-ai-created']);
  assert.equal(calls[0][2], 'WebGL renderer');
  const options = calls[1][1];
  assert.equal(options.storage.getItem('task-note'), null);
  assert.equal(options.storage.setItem('task-note', 'unused'), undefined);
  assert.equal(options.windowRoot.sessionStorage, undefined);
  assert.equal(options.windowRoot.localStorage, undefined);
  assert.equal(options.windowRoot.navigator, window.navigator);
  assert.deepEqual(calls.slice(2).map(([name]) => name), ['web-ai-open', 'style']);
  assert.equal(calls[2][1], 'webgl-fallback');
  assert.equal(document.body.dataset.staticFeatureRoute, 'web-ai');
  assert.match(calls[3][1], /#matumbo-command-deck\{display:none!important\}/);
  assert.equal(calls.some(([name]) => name === 'external-open'), false);
});

test('WebGL failure opens the requested YouTube panel without loading a video', () => {
  const { calls, document, failure, thrown } = boot('?feature=youtube');
  assert.equal(thrown, failure);
  assert.deepEqual(calls.map(([name]) => name), ['failed', 'youtube-created', 'youtube-open', 'style']);
  assert.equal(document.body.dataset.staticFeatureRoute, 'youtube');
});

test('unrelated routes and an available renderer do not mount fallback panels', () => {
  for (const search of ['', '?feature=contracts', '?feature=youtube%20']) {
    const { calls, document, failure, thrown } = boot(search);
    assert.equal(thrown, failure);
    assert.deepEqual(calls.map(([name]) => name), ['failed']);
    assert.equal(document.body.dataset.staticFeatureRoute, undefined);
  }
  const healthy = boot('?feature=web-ai', { failRenderer: false });
  assert.equal(healthy.thrown, null);
  assert.deepEqual(healthy.calls, []);
});

test('a failed fallback panel leaves the original WebGL error and command deck intact', () => {
  const { calls, document, failure, thrown } = boot('?feature=web-ai', { failPanel: true });
  assert.equal(thrown, failure);
  assert.deepEqual(calls.map(([name]) => name), ['failed', 'warning']);
  assert.equal(document.body.dataset.staticFeatureRoute, undefined);
});
