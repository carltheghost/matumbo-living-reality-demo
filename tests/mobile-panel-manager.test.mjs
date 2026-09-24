import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { applyMobilePanelPolicy, initMobilePanelManager } from '../src/render/mobile-panel-manager.js';

test('bootstrap initializes the mobile keeper once, after the world route is mounted',()=>{
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.equal((main.match(/\binitMobilePanelManager\s*\(/g)??[]).length,1,'two managers can evict the requested surface before attachment');
  assert.ok(main.indexOf('const mobilePanelManager = initMobilePanelManager')>main.indexOf('renderer.setAnimationLoop(animate)'), 'mobile ownership begins after Assembly has been opened');
});

test('policy keeps only the just-opened panel visible', () => {
  const panels = [
    { id: 'room-console', visible: true },
    { id: 't402-console', visible: true },
    { id: 'media-preview', visible: false },
  ];
  const result = applyMobilePanelPolicy({ panels, openedId: 't402-console' });
  assert.equal(result.keeper, 't402-console');
  assert.deepEqual(result.hideIds, ['room-console']);
  assert.equal(result.hintHidden, true);
});

test('policy hides nothing when a single panel is open', () => {
  const result = applyMobilePanelPolicy({
    panels: [{ id: 'room-console', visible: true }],
    openedId: 'room-console',
  });
  assert.deepEqual(result.hideIds, []);
  assert.equal(result.hintHidden, true);
});

test('policy shows the hint bar when no panel is open', () => {
  const result = applyMobilePanelPolicy({
    panels: [{ id: 'room-console', visible: false }],
    openedId: null,
  });
  assert.equal(result.keeper, null);
  assert.equal(result.hintHidden, false);
});

test('policy falls back to the first visible panel with no opener', () => {
  const result = applyMobilePanelPolicy({
    panels: [
      { id: 'a-console', visible: true },
      { id: 'b-console', visible: true },
    ],
    openedId: null,
  });
  assert.equal(result.keeper, 'a-console');
  assert.deepEqual(result.hideIds, ['b-console']);
});

function makeClassList() {
  const set = new Set();
  return {
    toggle(name, force) { if (force) set.add(name); else set.delete(name); },
    add(name) { set.add(name); },
    remove(name) { set.delete(name); },
    contains(name) { return set.has(name); },
  };
}

function makePanel(id, tag = 'ASIDE') {
  return {
    id,
    tagName: tag,
    hidden: true,
    open: false,
    attrs: {},
    classList: makeClassList(),
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    querySelector() { return null; },
  };
}

function makeHarness({ narrow = true } = {}) {
  const room = makePanel('room-console');
  const t402 = makePanel('t402-console');
  const camera = makePanel('camera-input-panel');
  const asset = makePanel('asset-launch');
  const shell = makePanel('feature-shell');
  const media = makePanel('media-preview', 'DETAILS');
  const readout = makePanel('readout', 'DIV');
  const hint = { hidden: false };
  const cityDetails = { open: false };
  const cityRoot = { querySelector: () => cityDetails };
  let closeClicked = 0;
  const featureClose = { click() { closeClicked += 1; shell.classList.remove('open'); } };
  const byId = {
    'room-console': room,
    't402-console': t402,
    'camera-input-panel': camera,
    'asset-launch': asset,
    'feature-shell': shell,
    'feature-close': featureClose,
    'media-preview': media,
    'readout': readout,
    'hint': hint,
    'city-journey': cityRoot,
  };
  let observerCb = null;
  const doc = {
    body: { classList: makeClassList() },
    documentElement: {},
    querySelectorAll: (sel) => (sel === 'aside' ? [room, t402, camera, asset, shell] : []),
    getElementById: (id) => byId[id] || null,
  };
  const win = {
    innerWidth: narrow ? 390 : 1280,
    matchMedia: (q) => ({ matches: narrow && q === '(max-width:700px)', addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    MutationObserver: class { constructor(cb) { observerCb = cb; } observe() {} disconnect() {} },
  };
  const fire = (target) => observerCb([{ target }]);
  return { doc, win, room, t402, camera, asset, shell, media, readout, hint, cityDetails, featureClose, fire, get closeClicked() { return closeClicked; } };
}

test('opening a second console hides the first on narrow screens', () => {
  const h = makeHarness({ narrow: true });
  const mgr = initMobilePanelManager({ documentRoot: h.doc, windowRoot: h.win, MutationObserverImpl: h.win.MutationObserver });
  h.room.hidden = false; h.fire(h.room);
  assert.equal(h.room.hidden, false);
  assert.ok(h.doc.body.classList.contains('mobile-panel-open'));
  h.t402.hidden = false; h.fire(h.t402);
  assert.equal(h.t402.hidden, false, 'just-opened console stays visible');
  assert.equal(h.room.hidden, true, 'previously open console collapses');
  mgr.destroy();
  assert.ok(!h.doc.body.classList.contains('mobile-panel-open'));
});

test('opening a console collapses the camera/audio preview and city dropdown', () => {
  const h = makeHarness({ narrow: true });
  const mgr = initMobilePanelManager({ documentRoot: h.doc, windowRoot: h.win, MutationObserverImpl: h.win.MutationObserver });
  h.media.open = true;
  h.cityDetails.open = true;
  h.room.hidden = false; h.fire(h.room);
  assert.equal(h.media.open, false, 'media preview collapses');
  assert.equal(h.cityDetails.open, false, 'city districts dropdown closes');
  mgr.destroy();
});

test('opening a console collapses the feature-shell through its own close control', () => {
  const h = makeHarness({ narrow: true });
  const mgr = initMobilePanelManager({ documentRoot: h.doc, windowRoot: h.win, MutationObserverImpl: h.win.MutationObserver });
  h.shell.classList.add('open'); h.fire(h.shell);
  assert.equal(h.doc.body.classList.contains('mobile-panel-open'), true);
  h.room.hidden = false; h.fire(h.room);
  assert.equal(h.room.hidden, false, 'just-opened console stays visible');
  assert.equal(h.closeClicked, 1, 'shell closed via its own close control so navigator state stays in sync');
  assert.ok(!h.shell.classList.contains('open'), 'shell collapsed');
  mgr.destroy();
});

test('opening a console collapses the class-driven readout sheet', () => {
  const h = makeHarness({ narrow: true });
  const mgr = initMobilePanelManager({ documentRoot: h.doc, windowRoot: h.win, MutationObserverImpl: h.win.MutationObserver });
  h.readout.classList.add('visible'); h.fire(h.readout);
  h.room.hidden = false; h.fire(h.room);
  assert.ok(!h.readout.classList.contains('visible'), 'readout collapses');
  assert.equal(h.room.hidden, false, 'just-opened console stays visible');
  mgr.destroy();
});

test('the hint bar hides while a panel is open and returns after', () => {
  const h = makeHarness({ narrow: true });
  const mgr = initMobilePanelManager({ documentRoot: h.doc, windowRoot: h.win, MutationObserverImpl: h.win.MutationObserver });
  assert.equal(h.hint.hidden, false);
  h.room.hidden = false; h.fire(h.room);
  assert.equal(h.hint.hidden, true, 'hint hides while a panel is open');
  h.room.hidden = true; h.fire(h.room);
  assert.equal(h.hint.hidden, false, 'hint returns when no panel is open');
  mgr.destroy();
});

test('a CSS-hidden panel never wins the keeper election', () => {
  const h = makeHarness({ narrow: true });
  // asset-launch style: no `hidden` attribute, but display:none from CSS.
  h.win.getComputedStyle = (el) => (el === h.asset
    ? { display: 'none', visibility: 'visible', opacity: '1' }
    : { display: 'block', visibility: 'visible', opacity: '1' });
  const mgr = initMobilePanelManager({ documentRoot: h.doc, windowRoot: h.win, MutationObserverImpl: h.win.MutationObserver });
  h.room.hidden = false; h.fire(h.room);
  assert.equal(h.room.hidden, false, 'the truly visible console is the keeper');
  assert.ok(h.doc.body.classList.contains('mobile-panel-open'));
  mgr.destroy();
});

test('desktop layouts are left alone', () => {
  const wide = makeHarness({ narrow: false });
  const mgr2 = initMobilePanelManager({ documentRoot: wide.doc, windowRoot: wide.win, MutationObserverImpl: wide.win.MutationObserver });
  wide.room.hidden = false; wide.fire(wide.room);
  wide.t402.hidden = false; wide.fire(wide.t402);
  assert.equal(wide.room.hidden, false, 'desktop keeps both consoles');
  assert.equal(wide.t402.hidden, false, 'desktop keeps both consoles');
  assert.ok(!wide.doc.body.classList.contains('mobile-panel-open'));
  mgr2.destroy();
});

test('mobile observer reaches quiescence instead of writing hidden forever',()=>{
  const h=makeHarness({narrow:true});
  let hidden=false,writes=0;
  Object.defineProperty(h.hint,'hidden',{get:()=>hidden,set:value=>{hidden=value;writes++;}});
  const manager=initMobilePanelManager({documentRoot:h.doc,windowRoot:h.win});
  assert.equal(writes,0,'boot does not rewrite an unchanged hidden attribute');
  h.room.hidden=false;h.fire(h.room);
  assert.equal(writes,1);
  // A real browser enqueues this record after the reflected hidden write.
  // The old implementation created another record on every callback.
  for(let tick=0;tick<20;tick++)h.fire(h.hint);
  assert.equal(writes,1,'self-generated observer records make no further writes');
  h.room.hidden=true;h.fire(h.room);assert.equal(writes,2);
  h.fire(h.hint);assert.equal(writes,2);
  manager.destroy();
});

test('a world-attached reading surface is not evicted by mobile overlay policy',()=>{
  const h=makeHarness({narrow:true});
  h.room.setAttribute('data-lens-surface-attached','true');h.room.hidden=false;
  const manager=initMobilePanelManager({documentRoot:h.doc,windowRoot:h.win});
  h.t402.hidden=false;h.fire(h.t402);
  assert.equal(h.room.hidden,false,'entity skin stays owned by the world renderer');
  assert.equal(h.t402.hidden,false);
  manager.destroy();
});

test('CSS-hidden Mission Control cannot evict the feature being mounted into the world',()=>{
  const h=makeHarness({narrow:true});
  h.shell.classList.add('open');h.room.hidden=false;
  h.win.getComputedStyle=el=>({display:el===h.shell?'none':'block',visibility:'visible'});
  const manager=initMobilePanelManager({documentRoot:h.doc,windowRoot:h.win});
  assert.equal(h.room.hidden,false,'the visible feature survives initial keeper election');
  manager.destroy();
});

test('an aside inside a hidden ancestor cannot win mobile panel election',()=>{
  const h=makeHarness({narrow:true});h.room.hidden=false;h.t402.hidden=false;
  h.room.getClientRects=()=>[];
  const manager=initMobilePanelManager({documentRoot:h.doc,windowRoot:h.win});
  assert.equal(h.t402.hidden,false);
  manager.destroy();
});
