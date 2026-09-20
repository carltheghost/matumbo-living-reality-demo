import test from 'node:test';
import assert from 'node:assert/strict';
import { createCubeDive } from '../src/render/cube-dive.js';

function makeEl(tag = 'div') {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    hidden: true,
    style: {},
    children: [],
    classList: {
      _s: new Set(),
      add(n) { this._s.add(n); },
      remove(n) { this._s.delete(n); },
      contains(n) { return this._s.has(n); },
    },
    setAttribute() {},
    append(...kids) { this.children.push(...kids); return this; },
    appendChild(k) { this.children.push(k); return k; },
    addEventListener(t, fn) { listeners[t] = fn; },
    remove() { this.removed = true; },
    querySelector() { return null; },
    click() { listeners.click?.(); },
  };
  return el;
}

function makeDoc() {
  const els = [];
  return {
    createElement: (tag) => { const el = makeEl(tag); els.push(el); return el; },
    body: { appendChild() {} },
    _els: els,
  };
}

function makeDive(doc, events) {
  return createCubeDive({
    three: null,
    scene: null,
    camera: null,
    controls: null,
    documentRoot: doc,
    reducedMotion: false,
    getBlockCenter: (id) => (id ? { x: 1, y: 2, z: 3 } : null),
    getBlockHalfSize: () => 0.45,
    getFeatureAccent: () => 0x37d9d0,
    onEvent: (type, detail) => events.push({ type, detail }),
  });
}

function pump(dive, ms, step = 50) {
  for (let t = 0; t < ms; t += step) dive.update(step / 1000);
}

test('dive flies field -> inside and shows the HUD', () => {
  const doc = makeDoc();
  const events = [];
  const dive = makeDive(doc, events);
  const res = dive.beginDive({ blockId: 'portal-1', featureId: 'rooms', label: 'Rooms + Messaging' });
  assert.equal(res.ok, true);
  assert.equal(dive.isActive(), true);
  assert.equal(dive.getSnapshot().state, 'diving');
  pump(dive, 1600);
  const snap = dive.getSnapshot();
  assert.equal(snap.state, 'inside');
  assert.equal(snap.active.featureId, 'rooms');
  assert.equal(snap.hudVisible, true);
  assert.equal(dive.isActive(), false);
  const types = events.map((e) => e.type);
  assert.ok(types.includes('dive-start'));
  assert.ok(types.includes('dive-arrived'));
  const hud = doc._els.find((e) => e.tagName === 'ASIDE');
  assert.ok(hud, 'HUD aside created');
  assert.equal(hud.hidden, false);
});

test('a second beginDive mid-flight is refused', () => {
  const doc = makeDoc();
  const dive = makeDive(doc, []);
  dive.beginDive({ blockId: 'p1', featureId: 'rooms', label: 'Rooms' });
  const again = dive.beginDive({ blockId: 'p2', featureId: 'person', label: 'Person' });
  assert.equal(again.ok, false);
  dive.destroy();
});

test('hop flies inside -> next inside without returning to the field', () => {
  const doc = makeDoc();
  const events = [];
  const dive = makeDive(doc, events);
  dive.beginDive({ blockId: 'p1', featureId: 'rooms', label: 'Rooms' });
  pump(dive, 1600);
  assert.equal(dive.getSnapshot().state, 'inside');
  const hop = dive.beginHop({ fromBlockId: 'p1', blockId: 'p2', featureId: 'person', label: 'Person' });
  assert.equal(hop.ok, true);
  assert.equal(dive.isActive(), true);
  pump(dive, 1800);
  const snap = dive.getSnapshot();
  assert.equal(snap.state, 'inside');
  assert.equal(snap.active.featureId, 'person');
  assert.equal(snap.active.kind, 'hop');
  assert.ok(events.some((e) => e.type === 'hop-start'));
  assert.ok(events.some((e) => e.type === 'hop-arrived'));
  dive.destroy();
});

test('deeper dive descends a level and exit returns to the field', () => {
  const doc = makeDoc();
  const events = [];
  const dive = makeDive(doc, events);
  dive.beginDive({ blockId: 'p1', featureId: 'rooms', label: 'Rooms' });
  pump(dive, 1600);
  const deeper = dive.beginDeeper({
    blockId: 'p1', featureId: 'rooms', label: 'Rooms · echo shard',
    contentId: 'c1', contentWorldPos: { x: 1.2, y: 2.1, z: 3.1 },
  });
  assert.equal(deeper.ok, true);
  pump(dive, 1400);
  let snap = dive.getSnapshot();
  assert.equal(snap.state, 'inside');
  assert.equal(snap.active.level, 1);
  assert.equal(snap.active.contentId, 'c1');
  const exit = dive.beginExit();
  assert.equal(exit.ok, true);
  pump(dive, 1400);
  snap = dive.getSnapshot();
  assert.equal(snap.state, 'field');
  assert.equal(snap.hudVisible, false);
  assert.ok(events.some((e) => e.type === 'dive-deeper-arrived'));
  assert.ok(events.some((e) => e.type === 'dive-exited'));
  dive.destroy();
});

test('cancel mid-flight restores the last arrived interior', () => {
  const doc = makeDoc();
  const dive = makeDive(doc, []);
  dive.beginDive({ blockId: 'p1', featureId: 'rooms', label: 'Rooms' });
  pump(dive, 1600);
  dive.beginHop({ fromBlockId: 'p1', blockId: 'p2', featureId: 'person', label: 'Person' });
  pump(dive, 200);
  const c = dive.cancel();
  assert.equal(c.ok, true);
  const snap = dive.getSnapshot();
  assert.equal(snap.state, 'inside');
  assert.equal(snap.active.featureId, 'rooms');
  assert.equal(dive.isActive(), false);
  dive.destroy();
});

test('deeper/hop/exit are refused from the field', () => {
  const doc = makeDoc();
  const dive = makeDive(doc, []);
  assert.equal(dive.beginDeeper({ blockId: 'p1' }).ok, false);
  assert.equal(dive.beginHop({ blockId: 'p2' }).ok, false);
  assert.equal(dive.beginExit().ok, false);
  dive.destroy();
});

test('HUD buttons emit the three inside actions', () => {
  const doc = makeDoc();
  const events = [];
  const dive = makeDive(doc, events);
  dive.beginDive({ blockId: 'p1', featureId: 'rooms', label: 'Rooms' });
  pump(dive, 1600);
  const buttons = doc._els.filter((e) => e.tagName === 'BUTTON');
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map((b) => b.textContent), ['Dive deeper', 'Next cube →', '← Field']);
  buttons[0].click();
  buttons[1].click();
  buttons[2].click();
  const types = events.map((e) => e.type);
  assert.ok(types.includes('dive-deeper-request'));
  assert.ok(types.includes('hop-next-request'));
  assert.ok(types.includes('exit-field-request'));
  dive.destroy();
});
