import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSurface,
  clampDepth,
  depthScale,
  depthBrightness,
  composePanelTransform,
  collectPanelDescriptors,
  panelTitle,
  isPanelVisible,
  PANEL_DEPTH_MIN,
  PANEL_DEPTH_MAX,
  mountCenteredSurfaces,
} from '../src/render/centered-surfaces.js';

test('feature panels stay in reach on desktop and phone', () => {
  assert.deepEqual(clampSurface(-50, 2000, 300, 500, 390, 844), { x: 8, y: 302 });
  assert.deepEqual(clampSurface(400, 200, 520, 500, 1440, 900), { x: 400, y: 200 });
  assert.deepEqual(clampSurface(-30, -30, 900, 900, 320, 600), { x: 8, y: 8 });
});

test('depth clamps to the simulated space bounds', () => {
  assert.equal(clampDepth(0), 0);
  assert.equal(clampDepth(200), 200);
  assert.equal(clampDepth(-2000), PANEL_DEPTH_MIN);
  assert.equal(clampDepth(2000), PANEL_DEPTH_MAX);
  assert.equal(clampDepth(NaN), 0);
  assert.equal(clampDepth('far'), 0);
});

test('depth scale grows closer panels and shrinks farther ones', () => {
  assert.equal(depthScale(0), 1);
  assert.ok(depthScale(500) > 1.5, 'closer panel grows');
  assert.ok(depthScale(-800) < 0.7, 'farther panel shrinks');
  assert.ok(depthScale(250) > depthScale(0) && depthScale(0) > depthScale(-250), 'monotonic in depth');
});

test('depth brightness stays a subtle cue', () => {
  assert.equal(depthBrightness(0), 1);
  assert.ok(depthBrightness(500) > 1 && depthBrightness(500) <= 1.12);
  assert.ok(depthBrightness(-800) < 1 && depthBrightness(-800) >= 0.75);
});

test('panel transform composes translate and depth scale', () => {
  const t = composePanelTransform(10, 20, 0);
  assert.match(t, /translate3d\(10\.0px, 20\.0px, 0px\) scale\(1\.0000\)/);
  const deep = composePanelTransform(10, 20, -800);
  assert.ok(deep.includes('scale(0.6364)'), `far depth shrinks: ${deep}`);
});

test('panel discovery collects asides plus overlay extras without duplicates', () => {
  const aside1 = { id: 'arena-games-console', tagName: 'ASIDE' };
  const aside2 = { id: 'intent-timeline', tagName: 'ASIDE' };
  const gesture = { id: 'gesture-input-panel', tagName: 'SECTION' };
  const doc = {
    querySelectorAll: (sel) => (sel === 'aside' ? [aside1, aside2, aside1] : []),
    getElementById: (id) => ({ 'gesture-input-panel': gesture }[id] || null),
  };
  const found = collectPanelDescriptors(doc).map((d) => d.id);
  assert.deepEqual(found, ['arena-games-console', 'intent-timeline', 'gesture-input-panel']);
});

test('panel titles prefer aria-label, then heading, then id', () => {
  assert.equal(panelTitle({ getAttribute: (k) => (k === 'aria-label' ? 'Mission Control feature navigator' : null), querySelector: () => null, id: 'feature-shell' }), 'Mission Control feature navigator');
  assert.equal(panelTitle({ getAttribute: () => null, querySelector: (s) => (s === 'h2, h3' ? { textContent: '  Intent Timeline ' } : null), id: 'intent-timeline' }), 'Intent Timeline');
  assert.equal(panelTitle({ getAttribute: () => null, querySelector: () => null, id: 'hint' }), 'Hint');
  assert.equal(panelTitle(null), 'Panel');
});

test('panel visibility honors hidden, shell class, details open, and display', () => {
  const view = { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
  assert.equal(isPanelVisible({ hidden: true, id: 'a', tagName: 'ASIDE' }, view), false);
  assert.equal(isPanelVisible({ hidden: false, id: 'a', tagName: 'ASIDE' }, view), true);
  const shellOpen = { hidden: false, id: 'feature-shell', tagName: 'ASIDE', classList: { contains: (c) => c === 'open' } };
  assert.equal(isPanelVisible(shellOpen, view), true);
  const shellClosed = { hidden: false, id: 'feature-shell', tagName: 'ASIDE', classList: { contains: () => false } };
  assert.equal(isPanelVisible(shellClosed, view), false);
  assert.equal(isPanelVisible({ hidden: false, id: 'media-preview', tagName: 'DETAILS', open: true }, view), true);
  assert.equal(isPanelVisible({ hidden: false, id: 'media-preview', tagName: 'DETAILS', open: false }, view), false);
  const gone = { hidden: false, id: 'asset-launch', tagName: 'ASIDE' };
  assert.equal(isPanelVisible(gone, { getComputedStyle: () => ({ display: 'none', visibility: 'visible' }) }), false);
});

/* ------------------------------------------------------------------ */
/* Fake-DOM integration smoke test for the full manager.              */
/* ------------------------------------------------------------------ */

class FakeClassList {
  constructor() { this.s = new Set(); }
  add(...c) { for (const x of c) this.s.add(x); }
  remove(...c) { for (const x of c) this.s.delete(x); }
  contains(c) { return this.s.has(c); }
}
class FakeStyle {
  constructor() { this._cssText = ''; }
  get cssText() { return this._cssText; }
  set cssText(v) { this._cssText = String(v); }
}
let __nextPid = 1;
class FakeElement {
  constructor(tag, id) {
    this.tagName = String(tag).toUpperCase();
    this.id = id || '';
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.hidden = false;
    this.open = false;
    this.classList = new FakeClassList();
    this.style = new FakeStyle();
    this._listeners = {};
    this._rect = { left: 0, top: 0, width: 200, height: 150 };
    this._pid = __nextPid++;
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  removeAttribute(k) { delete this.attributes[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  prepend(c) { c.parentNode = this; this.children.unshift(c); return c; }
  insertBefore(c, ref) { c.parentNode = this; const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  after(...cs) {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    cs.forEach((c, k) => { c.parentNode = this.parentNode; this.parentNode.children.splice(i + 1 + k, 0, c); });
  }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  get firstChild() { return this.children[0] || null; }
  querySelector(sel) {
    const tags = sel.split(',').map((s) => s.trim().toLowerCase());
    const walk = (el) => {
      for (const c of el.children) {
        if (tags.includes(c.tagName.toLowerCase())) return c;
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this);
  }
  querySelectorAll(sel) {
    if (sel === 'aside') return this._asides || [];
    return [];
  }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const l = this._listeners[type];
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  dispatch(type, props = {}) {
    const e = { type, target: this, preventDefault() {}, ...props };
    for (const fn of [...(this._listeners[type] || [])]) fn(e);
    return e;
  }
  setPointerCapture() {}
  getBoundingClientRect() { return { ...this._rect }; }
}

function makeHarness({ narrow = false, shellOpen = true } = {}) {
  const rafQueue = [];
  const moInstances = [];
  const storage = new Map();
  const docEl = new FakeElement('html');
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  docEl.appendChild(head); docEl.appendChild(body);

  const aside1 = new FakeElement('aside', 'arena-games-console');
  aside1._rect = { left: 900, top: 145, width: 420, height: 500 };
  const h2 = new FakeElement('h2'); h2.textContent = 'ARENA / Game Lab';
  aside1.appendChild(h2);
  const aside2 = new FakeElement('aside', 'intent-timeline');
  aside2._rect = { left: 900, top: 145, width: 420, height: 300 };
  aside2.hidden = true;
  const shell = new FakeElement('aside', 'feature-shell');
  shell._rect = { left: 20, top: 107, width: 460, height: 700 };
  shell.setAttribute('aria-label', 'Mission Control feature navigator');
  if (shellOpen) shell.classList.add('open');
  const hint = new FakeElement('div', 'hint');
  hint._rect = { left: 620, top: 850, width: 200, height: 30 };
  for (const el of [aside1, aside2, shell, hint]) body.appendChild(el);

  const asides = [aside1, aside2, shell];
  const doc = {
    head, documentElement: docEl, body,
    createElement: (tag) => new FakeElement(tag),
    querySelectorAll: (sel) => (sel === 'aside' ? [...asides] : []),
    getElementById: (id) => ({ hint }[id] || null),
  };
  const view = {
    innerWidth: 1440, innerHeight: 900,
    matchMedia: () => ({ matches: narrow, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    addEventListener() {}, removeEventListener() {},
    MutationObserver: class { constructor(cb) { this.cb = cb; moInstances.push(this); } observe() {} disconnect() {} },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
  return {
    doc, view, rafQueue, moInstances, storage, aside1, aside2, shell, hint,
    flushRaf() { while (rafQueue.length) rafQueue.shift()(); },
    mutate(target, attrs = {}) {
      for (const mo of moInstances) mo.cb([{ target }], mo);
    },
    gripOf(el) { return el.children.find((c) => c.className === 'surface-grip') || null; },
    toggleOf(el) { const g = this.gripOf(el); return g ? g.children.find((c) => c.className === 'surface-grip-toggle') : null; },
  };
}

test('desktop mount adds grips, places visible panels small, and leaves hidden panels alone', () => {
  const h = makeHarness();
  const destroy = mountCenteredSurfaces(h.doc, h.view);
  assert.ok(h.gripOf(h.aside1), 'visible console gets a grip');
  assert.ok(h.gripOf(h.shell), 'feature shell gets a grip');
  assert.equal(h.gripOf(h.hint), null, 'hint has no grip chrome');
  assert.equal(h.aside1.getAttribute('data-panel-space'), 'managed');
  h.flushRaf();
  assert.equal(h.aside1.style.position, 'fixed');
  assert.match(h.aside1.style.transform, /translate3d\(900\.0px, 145\.0px/);
  assert.equal(h.aside1.getAttribute('data-compact'), 'true', 'opens small by default');
  assert.equal(h.aside2.style.position, undefined, 'hidden panel is not placed until opened');
  destroy();
});

test('opening a hidden panel places it small; tap toggles materialize; drag moves it', () => {
  const h = makeHarness();
  mountCenteredSurfaces(h.doc, h.view);
  h.flushRaf();
  // Open the hidden timeline via a hidden-attribute mutation.
  h.aside2.hidden = false;
  h.mutate(h.aside2);
  h.flushRaf();
  assert.equal(h.aside2.style.position, 'fixed');
  assert.equal(h.aside2.getAttribute('data-compact'), 'true');

  const toggle = h.toggleOf(h.aside2);
  assert.ok(toggle, 'grip toggle exists');
  // Tap (no movement) materializes the panel.
  toggle.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, shiftKey: false });
  toggle.dispatch('pointerup', { pointerId: 1, clientX: 101, clientY: 100, shiftKey: false });
  assert.equal(h.aside2.getAttribute('data-compact'), null, 'tap expands the panel');
  // Drag moves it in the plane.
  const before = h.aside2.style.transform;
  toggle.dispatch('pointerdown', { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, shiftKey: false });
  toggle.dispatch('pointermove', { pointerId: 2, clientX: 160, clientY: 140 });
  toggle.dispatch('pointerup', { pointerId: 2, clientX: 160, clientY: 140, shiftKey: false });
  assert.notEqual(h.aside2.style.transform, before, 'drag changes the transform');
  assert.match(h.aside2.style.transform, /translate3d\(960\.0px, 185\.0px/);
  // Wheel over the grip travels in depth.
  toggle.dispatch('wheel', { deltaY: -100 });
  assert.match(h.aside2.style.transform, /scale\(1\.09/);
  // Shift-drag also travels in depth.
  toggle.dispatch('pointerdown', { pointerId: 3, pointerType: 'mouse', button: 0, clientX: 100, clientY: 200, shiftKey: true });
  toggle.dispatch('pointermove', { pointerId: 3, clientX: 100, clientY: 100 });
  toggle.dispatch('pointerup', { pointerId: 3, clientX: 100, clientY: 100, shiftKey: true });
  assert.match(h.aside2.style.transform, /scale\(1\.2963\)/);
});

test('positions persist across mounts via the panel space store', async () => {
  const h = makeHarness();
  mountCenteredSurfaces(h.doc, h.view);
  h.flushRaf();
  const toggle = h.toggleOf(h.aside1);
  toggle.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, shiftKey: false });
  toggle.dispatch('pointermove', { pointerId: 1, clientX: 200, clientY: 200 });
  toggle.dispatch('pointerup', { pointerId: 1, clientX: 200, clientY: 200, shiftKey: false });
  await new Promise((r) => setTimeout(r, 300)); // persist debounce
  const raw = h.storage.get('matumbo.panelSpace.v1');
  assert.ok(raw, 'store written');
  const saved = JSON.parse(raw)['arena-games-console'];
  assert.deepEqual([saved.x, saved.y], [1000, 245]);
});

test('narrow viewports stay inert so the mobile panel manager owns layout', () => {
  const h = makeHarness({ narrow: true });
  const destroy = mountCenteredSurfaces(h.doc, h.view);
  assert.equal(h.gripOf(h.aside1), null, 'no grip injected on mobile');
  assert.equal(h.aside1.getAttribute('data-panel-space'), null, 'no spatial takeover on mobile');
  destroy();
});

test('a panel that opens before layout is ready is chipped immediately and placed on retry', async () => {
  const h = makeHarness();
  mountCenteredSurfaces(h.doc, h.view);
  h.flushRaf();
  // Simulate layout not being ready yet (zero rect at open time).
  h.aside2._rect = { left: 0, top: 0, width: 0, height: 0 };
  h.aside2.hidden = false;
  h.mutate(h.aside2);
  h.flushRaf();
  assert.equal(h.aside2.getAttribute('data-compact'), 'true', 'chipped from the first visible frame');
  assert.equal(h.aside2.style.position, undefined, 'not placed while layout is missing');
  // Layout arrives later: the retry loop places it without another signal.
  // (The fake harness queues rAF manually, so flush between backoff ticks.)
  h.aside2._rect = { left: 900, top: 145, width: 420, height: 300 };
  for (let i = 0; i < 6 && h.aside2.style.position !== 'fixed'; i++) {
    await new Promise((r) => setTimeout(r, 200));
    h.flushRaf();
  }
  assert.equal(h.aside2.style.position, 'fixed', 'placed once layout is ready');
  assert.equal(h.aside2.getAttribute('data-compact'), 'true', 'still small after placement');
});

test('expanded panels are capped at 80vw/80vh so the world stays visible', () => {
  const h = makeHarness();
  mountCenteredSurfaces(h.doc, h.view);
  const styleEl = h.doc.head.children.find((c) => c.tagName === 'STYLE' && c.getAttribute('data-panel-space-style') === 'true');
  assert.ok(styleEl, 'panel space style injected');
  assert.match(styleEl.textContent, /max-width:min\(80vw/, 'expanded width capped at 80vw');
  assert.match(styleEl.textContent, /max-height:80vh/, 'expanded height capped at 80vh');
});
