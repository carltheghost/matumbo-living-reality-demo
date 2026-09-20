import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryModeConsole } from '../src/render/story-mode.js';
import {
  STORY_MODE_BEAT_KINDS,
  STORY_MODE_BOUNDARY,
  JOURNEY_STORY_ID,
} from '../src/domains/story-mode.js';

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

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function makeConsole(doc, storage, events, nav) {
  return createStoryModeConsole({
    documentRoot: doc,
    storage,
    onNavigateBeat: (beat) => nav.push(beat),
    onEvent: (type, detail) => events.push({ type, detail }),
  });
}

const byId = (doc, id) => doc._els.find((e) => e.id === id);
const listTexts = (doc) => byId(doc, 'story-mode-story-list').children.map((r) => r.children[0].textContent);
const beatRows = (doc) => byId(doc, 'story-mode-beat-list').children;
const beatLabels = (doc) => beatRows(doc).map((r) => r.children[0].textContent);
const rowButton = (row, text) => row.children.find((c) => c.tagName === 'BUTTON' && c.textContent === text);

function createTestStory(doc, title = 'My Tour', description = 'A test tour') {
  byId(doc, 'story-mode-new-title').value = title;
  byId(doc, 'story-mode-new-description').value = description;
  byId(doc, 'story-mode-new-create').click();
}

function addTestBeat(doc, { kind = 'feature', refId = 'block-world', title, caption = '' }) {
  byId(doc, 'story-mode-beat-kind').value = kind;
  byId(doc, 'story-mode-beat-refid').value = refId;
  byId(doc, 'story-mode-beat-title').value = title;
  byId(doc, 'story-mode-beat-caption').value = caption;
  byId(doc, 'story-mode-beat-add').click();
}

test('console starts with both panels hidden and closed by default', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  const root = c.getElement();
  assert.ok(root, 'root wrapper returned');
  assert.equal(root.id, 'story-mode-root');
  assert.equal(c.isOpen(), false);
  assert.equal(c.getSnapshot().open, false);
  assert.equal(c.getSnapshot().player.state, 'idle');
  assert.equal(byId(doc, 'story-mode-console').hidden, true);
  assert.equal(byId(doc, 'story-mode-hud').hidden, true);
  c.destroy();
});

test('open() shows the planner and emits story.opened; close() hides and emits story.closed', () => {
  const doc = makeDoc();
  const events = [];
  const c = makeConsole(doc, makeStorage(), events, []);
  c.open();
  assert.equal(c.isOpen(), true);
  assert.equal(byId(doc, 'story-mode-console').hidden, false);
  assert.equal(events[0].type, 'story.opened');
  assert.equal(events[0].detail.boundary, STORY_MODE_BOUNDARY);
  c.close();
  assert.equal(c.isOpen(), false);
  assert.equal(byId(doc, 'story-mode-console').hidden, true);
  assert.equal(events[1].type, 'story.closed');
  c.destroy();
});

test('fresh init seeds the canonical journey story', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  assert.equal(c.getSnapshot().storyCount, 1);
  const texts = listTexts(doc);
  assert.ok(texts[0].includes('The Journey'));
  assert.ok(texts[0].includes('9 beats'));
  assert.ok(texts[0].includes('canonical'));
  c.destroy();
});

test('New story form creates a story that appears in the list', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  createTestStory(doc);
  assert.equal(c.getSnapshot().storyCount, 2);
  assert.ok(listTexts(doc).some((t) => t.includes('My Tour') && t.includes('0 beats')));
  c.destroy();
});

test('New story with an empty title is refused with an error', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  byId(doc, 'story-mode-new-title').value = '   ';
  byId(doc, 'story-mode-new-create').click();
  assert.equal(c.getSnapshot().storyCount, 1);
  assert.ok(byId(doc, 'story-mode-new-error').textContent.length > 0);
  c.destroy();
});

test('add beat appends beats in order and updates the story list count', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  createTestStory(doc);
  addTestBeat(doc, { title: 'Alpha' });
  addTestBeat(doc, { title: 'Beta' });
  const labels = beatLabels(doc);
  assert.equal(labels.length, 2);
  assert.ok(labels[0].startsWith('1. [feature] Alpha'));
  assert.ok(labels[1].startsWith('2. [feature] Beta'));
  assert.ok(listTexts(doc).some((t) => t.includes('My Tour') && t.includes('2 beats')));
  c.destroy();
});

test('add beat validates: empty refId shows an error and adds nothing', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  createTestStory(doc);
  addTestBeat(doc, { refId: '', title: 'Nope' });
  assert.equal(beatRows(doc).length, 0);
  assert.ok(byId(doc, 'story-mode-beat-error').textContent.includes('invalid-beat-ref'));
  c.destroy();
});

test('add-beat kind select offers every STORY_MODE_BEAT_KINDS option', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  createTestStory(doc);
  const opts = byId(doc, 'story-mode-beat-kind').children.filter((o) => o.tagName === 'OPTION');
  assert.deepEqual(opts.map((o) => o.value), [...STORY_MODE_BEAT_KINDS]);
  c.destroy();
});

test('move up/down reorders beats', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  createTestStory(doc);
  addTestBeat(doc, { title: 'Alpha' });
  addTestBeat(doc, { title: 'Beta' });
  addTestBeat(doc, { title: 'Gamma' });
  rowButton(beatRows(doc)[1], '↑').click();
  assert.deepEqual(
    beatLabels(doc),
    ['1. [feature] Beta', '2. [feature] Alpha', '3. [feature] Gamma'],
  );
  rowButton(beatRows(doc)[0], '↓').click();
  assert.deepEqual(
    beatLabels(doc),
    ['1. [feature] Alpha', '2. [feature] Beta', '3. [feature] Gamma'],
  );
  c.destroy();
});

test('remove beat deletes it from the story', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  createTestStory(doc);
  addTestBeat(doc, { title: 'Alpha' });
  addTestBeat(doc, { title: 'Beta' });
  rowButton(beatRows(doc)[0], 'Remove').click();
  const labels = beatLabels(doc);
  assert.equal(labels.length, 1);
  assert.ok(labels[0].includes('Beta'));
  c.destroy();
});

test('canonical journey beats are locked: no add form, no row buttons, copy offered', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  byId(doc, `story-mode-edit-${JOURNEY_STORY_ID}`).click();
  assert.equal(beatRows(doc).length, 9);
  assert.ok(byId(doc, 'story-mode-beat-form').hidden, 'add-beat form hidden for canonical story');
  assert.ok(!beatRows(doc)[0].children.some((ch) => ch.tagName === 'BUTTON'), 'no up/down/remove on locked rows');
  assert.ok(byId(doc, 'story-mode-editor-note').textContent.includes('locked'));
  assert.equal(byId(doc, 'story-mode-make-copy').hidden, false);
  c.destroy();
});

test('Make a copy duplicates the journey and the copy is editable', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  byId(doc, `story-mode-edit-${JOURNEY_STORY_ID}`).click();
  byId(doc, 'story-mode-make-copy').click();
  assert.equal(c.getSnapshot().storyCount, 2);
  assert.ok(listTexts(doc).some((t) => t.includes('The Journey (copy)') && t.includes('9 beats')));
  assert.equal(byId(doc, 'story-mode-beat-form').hidden, false);
  assert.equal(beatRows(doc).length, 9);
  assert.ok(rowButton(beatRows(doc)[0], '↑'), 'copy beats have move buttons');
  c.destroy();
});

test('Copy button duplicates a custom story with its beats', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  createTestStory(doc);
  addTestBeat(doc, { title: 'Alpha' });
  byId(doc, 'story-mode-copy-story-1').click();
  assert.equal(c.getSnapshot().storyCount, 3);
  assert.ok(listTexts(doc).some((t) => t.includes('My Tour (copy)') && t.includes('1 beat')));
  c.destroy();
});

test('Delete removes a story from the list', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  createTestStory(doc);
  assert.equal(c.getSnapshot().storyCount, 2);
  byId(doc, 'story-mode-delete-story-1').click();
  assert.equal(c.getSnapshot().storyCount, 1);
  assert.ok(!listTexts(doc).some((t) => t.includes('My Tour')));
  c.destroy();
});

test('playStory starts at beat 0, shows the HUD, and navigates', () => {
  const doc = makeDoc();
  const events = [];
  const nav = [];
  const c = makeConsole(doc, makeStorage(), events, nav);
  const res = c.playStory(JOURNEY_STORY_ID);
  assert.equal(res.ok, true);
  assert.equal(nav.length, 1);
  assert.equal(nav[0].title, 'One Block');
  const snap = c.getSnapshot();
  assert.equal(snap.player.state, 'playing');
  assert.equal(snap.player.storyId, JOURNEY_STORY_ID);
  assert.equal(snap.player.beatIndex, 0);
  assert.equal(byId(doc, 'story-mode-hud').hidden, false);
  assert.equal(byId(doc, 'story-mode-hud-count').textContent, 'Beat 1 of 9');
  assert.equal(byId(doc, 'story-mode-hud-title').textContent, 'One Block');
  assert.equal(events[0].type, 'story.beat');
  assert.equal(events[0].detail.boundary, STORY_MODE_BOUNDARY);
  assert.equal(events[0].detail.beatIndex, 0);
  c.destroy();
});

test('next() advances and navigates to beat 1', () => {
  const doc = makeDoc();
  const events = [];
  const nav = [];
  const c = makeConsole(doc, makeStorage(), events, nav);
  c.playStory(JOURNEY_STORY_ID);
  const res = c.next();
  assert.equal(res.ok, true);
  assert.equal(nav.length, 2);
  assert.equal(nav[1].title, 'Constellation');
  assert.equal(c.getSnapshot().player.beatIndex, 1);
  assert.equal(byId(doc, 'story-mode-hud-count').textContent, 'Beat 2 of 9');
  assert.ok(events.some((e) => e.type === 'story.beat' && e.detail.beatIndex === 1));
  c.destroy();
});

test('prev() steps back a beat', () => {
  const doc = makeDoc();
  const nav = [];
  const c = makeConsole(doc, makeStorage(), [], nav);
  c.playStory(JOURNEY_STORY_ID);
  c.next();
  c.prev();
  assert.equal(c.getSnapshot().player.beatIndex, 0);
  assert.equal(nav[2].title, 'One Block');
  c.destroy();
});

test('goto() jumps to a beat index', () => {
  const doc = makeDoc();
  const nav = [];
  const c = makeConsole(doc, makeStorage(), [], nav);
  c.playStory(JOURNEY_STORY_ID);
  const res = c.goto(4);
  assert.equal(res.ok, true);
  assert.equal(c.getSnapshot().player.beatIndex, 4);
  assert.equal(nav[1].refId, 'ledger');
  assert.equal(c.goto(99).ok, false);
  assert.equal(c.getSnapshot().player.beatIndex, 4);
  c.destroy();
});

test('on the last beat Next becomes Finish and next() finishes the story', () => {
  const doc = makeDoc();
  const events = [];
  const nav = [];
  const c = makeConsole(doc, makeStorage(), events, nav);
  c.playStory(JOURNEY_STORY_ID);
  c.goto(8);
  assert.equal(byId(doc, 'story-mode-hud-next').textContent, 'Finish');
  const res = c.next();
  assert.equal(res.ok, true);
  assert.equal(res.finished, true);
  assert.equal(c.getSnapshot().player.state, 'finished');
  assert.ok(events.some((e) => e.type === 'story.finished'));
  assert.equal(byId(doc, 'story-mode-hud-count').textContent, 'Story finished');
  c.destroy();
});

test('stop() hides the HUD and idles the player', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.playStory(JOURNEY_STORY_ID);
  c.stop();
  assert.equal(byId(doc, 'story-mode-hud').hidden, true);
  assert.equal(c.getSnapshot().player.state, 'idle');
  assert.equal(c.getSnapshot().player.storyId, null);
  c.destroy();
});

test('playStory on an unknown story and next() while idle fail cleanly', () => {
  const doc = makeDoc();
  const events = [];
  const nav = [];
  const c = makeConsole(doc, makeStorage(), events, nav);
  assert.equal(c.playStory('no-such-story').ok, false);
  assert.equal(c.next().ok, false);
  assert.equal(c.getSnapshot().player.state, 'idle');
  assert.equal(nav.length, 0);
  c.destroy();
});

test('close() stops playback and hides the HUD', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  c.playStory(JOURNEY_STORY_ID);
  c.close();
  assert.equal(byId(doc, 'story-mode-hud').hidden, true);
  assert.equal(byId(doc, 'story-mode-console').hidden, true);
  assert.equal(c.getSnapshot().player.state, 'idle');
  c.destroy();
});

test('persistence: a new console with the same storage reloads created stories', () => {
  const storage = makeStorage();
  const doc1 = makeDoc();
  const c1 = makeConsole(doc1, storage, [], []);
  c1.open();
  createTestStory(doc1);
  addTestBeat(doc1, { title: 'Alpha' });
  c1.destroy();

  const doc2 = makeDoc();
  const c2 = makeConsole(doc2, storage, [], []);
  assert.equal(c2.getSnapshot().storyCount, 2);
  c2.open();
  const journeys = listTexts(doc2).filter((t) => t.includes('The Journey') && !t.includes('(copy)'));
  assert.equal(journeys.length, 1, 'journey not duplicated on reload');
  assert.ok(listTexts(doc2).some((t) => t.includes('My Tour') && t.includes('1 beat')));
  byId(doc2, 'story-mode-edit-story-1').click();
  assert.ok(beatLabels(doc2)[0].includes('Alpha'), 'beats persisted');
  c2.destroy();
});

test('planner carries the boundary caption', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  assert.equal(byId(doc, 'story-mode-boundary').textContent, STORY_MODE_BOUNDARY);
  c.destroy();
});

test('panels are mobile-safe: absolute position with max-width 100vw', () => {
  const doc = makeDoc();
  const c = makeConsole(doc, makeStorage(), [], []);
  c.open();
  const planner = byId(doc, 'story-mode-console');
  assert.equal(planner.style.position, 'absolute');
  assert.ok(String(planner.style.maxWidth).includes('100vw'));
  const hud = byId(doc, 'story-mode-hud');
  assert.equal(hud.style.position, 'absolute');
  assert.ok(String(hud.style.maxWidth).includes('100vw'));
  c.destroy();
});
