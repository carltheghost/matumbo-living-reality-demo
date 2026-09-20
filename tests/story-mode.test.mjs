import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORY_MODE_SCHEMA_VERSION,
  STORY_MODE_STORAGE_KEY,
  STORY_MODE_BEAT_KINDS,
  STORY_MODE_WORLD_VIEWS,
  STORY_PLAYER_STATES,
  JOURNEY_STORY_ID,
  STORY_MODE_BOUNDARY,
  createStoryLibrary,
  createStory,
  renameStory,
  deleteStory,
  getStory,
  listStories,
  copyStory,
  addBeat,
  updateBeat,
  removeBeat,
  moveBeat,
  validateBeat,
  validateStory,
  createStoryPlayer,
  currentBeat,
  playerStart,
  playerNext,
  playerPrev,
  playerGoto,
  playerStop,
  encodeLibrary,
  decodeLibrary,
  createStoryStore,
  createJourneyStory,
  seedJourneyStory,
  planTraversal,
} from '../src/domains/story-mode.js';

function makeLibraryWithStory() {
  const library = createStoryLibrary();
  const r = createStory(library, { title: '  Tour One  ', description: 'desc' });
  assert.equal(r.ok, true);
  return { library, story: r.story };
}

function addTwoBeats(library, story) {
  const b1 = addBeat(library, story.id, {
    kind: 'feature',
    refId: 'block-world',
    title: 'Block World',
    caption: 'c1',
  });
  const b2 = addBeat(library, story.id, {
    kind: 'world-view',
    refId: 'giant-block',
    title: 'Giant Block',
  });
  assert.equal(b1.ok, true);
  assert.equal(b2.ok, true);
  return [b1.beat, b2.beat];
}

test('exports carry the contract constants', () => {
  assert.equal(STORY_MODE_SCHEMA_VERSION, 1);
  assert.equal(STORY_MODE_STORAGE_KEY, 'matumbo.story-mode.v1');
  assert.deepEqual(STORY_MODE_BEAT_KINDS, ['feature', 'world-view', 'contract', 'relic', 'bot']);
  assert.deepEqual(STORY_MODE_WORLD_VIEWS, ['giant-block', 'constellation', 'tentacles']);
  assert.deepEqual(STORY_PLAYER_STATES, ['idle', 'playing', 'finished']);
  assert.equal(JOURNEY_STORY_ID, 'story-journey');
  assert.ok(STORY_MODE_BOUNDARY.includes('No wallet'));
});

test('createStoryLibrary returns fresh defaults', () => {
  const library = createStoryLibrary();
  assert.deepEqual(library, {
    schemaVersion: 1,
    seq: 0,
    stories: [],
    activeStoryId: null,
    activeBeatIndex: 0,
  });
});

test('createStory assigns deterministic ids and trims titles', () => {
  const library = createStoryLibrary();
  const first = createStory(library, { title: '  Alpha  ' });
  assert.equal(first.ok, true);
  assert.equal(first.story.id, 'story-1');
  assert.equal(first.story.title, 'Alpha');
  assert.equal(first.story.description, '');
  assert.equal(library.seq, 1);
  const second = createStory(library, { title: 'Beta' });
  assert.equal(second.story.id, 'story-2');
});

test('createStory rejects invalid titles', () => {
  const library = createStoryLibrary();
  assert.equal(createStory(library, { title: '' }).ok, false);
  assert.equal(createStory(library, { title: '   ' }).ok, false);
  assert.equal(createStory(library, {}).ok, false);
  assert.equal(createStory(library, { title: 'x'.repeat(81) }).ok, false);
  assert.equal(createStory(library, { title: 'x'.repeat(81) }).reason, 'title-too-long');
  assert.equal(library.seq, 0, 'failed creates do not consume ids');
});

test('renameStory updates title and description', () => {
  const { library, story } = makeLibraryWithStory();
  const r = renameStory(library, story.id, { title: 'New Name', description: 'new' });
  assert.equal(r.ok, true);
  assert.equal(story.title, 'New Name');
  assert.equal(story.description, 'new');
  const bad = renameStory(library, story.id, { title: '' });
  assert.equal(bad.ok, false);
  assert.equal(story.title, 'New Name', 'rejected rename does not mutate');
  assert.equal(renameStory(library, 'nope', { title: 'x' }).reason, 'story-not-found');
});

test('getStory and listStories', () => {
  const { library, story } = makeLibraryWithStory();
  assert.equal(getStory(library, story.id), story);
  assert.equal(getStory(library, 'missing'), null);
  const list = listStories(library);
  assert.deepEqual(list, [story]);
  assert.notEqual(list, library.stories, 'returns a copy of the array');
});

test('deleteStory removes the story and clears the active pointer', () => {
  const { library, story } = makeLibraryWithStory();
  library.activeStoryId = story.id;
  library.activeBeatIndex = 3;
  const r = deleteStory(library, story.id);
  assert.equal(r.ok, true);
  assert.equal(getStory(library, story.id), null);
  assert.equal(library.activeStoryId, null);
  assert.equal(library.activeBeatIndex, 0);
  assert.equal(deleteStory(library, story.id).reason, 'story-not-found');
});

test('addBeat appends beats with deterministic beat ids', () => {
  const { library, story } = makeLibraryWithStory();
  const [b1, b2] = addTwoBeats(library, story);
  assert.equal(b1.id, 'beat-2');
  assert.equal(b2.id, 'beat-3');
  assert.equal(story.beats.length, 2);
  assert.equal(b2.caption, '', 'caption defaults to empty string');
});

test('addBeat rejects bad kinds and refs', () => {
  const { library, story } = makeLibraryWithStory();
  assert.equal(addBeat(library, story.id, { kind: 'nope', refId: 'x', title: 't' }).reason, 'invalid-beat-kind');
  assert.equal(addBeat(library, story.id, { kind: 'feature', refId: '', title: 't' }).reason, 'invalid-beat-ref');
  assert.equal(addBeat(library, story.id, { kind: 'feature', refId: 'x', title: '' }).reason, 'invalid-beat-title');
  assert.equal(addBeat(library, 'missing', { kind: 'feature', refId: 'x', title: 't' }).reason, 'story-not-found');
  assert.equal(story.beats.length, 0);
});

test('updateBeat patches fields and revalidates', () => {
  const { library, story } = makeLibraryWithStory();
  const [b1] = addTwoBeats(library, story);
  const r = updateBeat(library, story.id, b1.id, { title: 'Renamed', refId: 'rooms' });
  assert.equal(r.ok, true);
  assert.equal(b1.title, 'Renamed');
  assert.equal(b1.refId, 'rooms');
  const bad = updateBeat(library, story.id, b1.id, { kind: 'bogus' });
  assert.equal(bad.ok, false);
  assert.equal(b1.kind, 'feature', 'rejected patch does not mutate');
  assert.equal(updateBeat(library, story.id, 'missing', { title: 'x' }).reason, 'beat-not-found');
});

test('removeBeat deletes the beat', () => {
  const { library, story } = makeLibraryWithStory();
  const [b1, b2] = addTwoBeats(library, story);
  const r = removeBeat(library, story.id, b1.id);
  assert.equal(r.ok, true);
  assert.equal(r.beat.id, b1.id);
  assert.deepEqual(story.beats.map((b) => b.id), [b2.id]);
  assert.equal(removeBeat(library, story.id, b1.id).reason, 'beat-not-found');
});

test('moveBeat reorders and clamps the index', () => {
  const library = createStoryLibrary();
  const { story } = (() => {
    const r = createStory(library, { title: 'M' });
    return { story: r.story };
  })();
  const beats = ['A', 'B', 'C'].map((t) => addBeat(library, story.id, { kind: 'feature', refId: 'x', title: t }).beat);
  let r = moveBeat(library, story.id, beats[0].id, 2);
  assert.equal(r.ok, true);
  assert.equal(r.index, 2);
  assert.deepEqual(story.beats.map((b) => b.title), ['B', 'C', 'A']);
  r = moveBeat(library, story.id, beats[2].id, 99);
  assert.equal(r.index, 2, 'clamped to the end');
  assert.deepEqual(story.beats.map((b) => b.title), ['B', 'A', 'C']);
  r = moveBeat(library, story.id, beats[0].id, -5);
  assert.equal(r.index, 0, 'clamped to the start');
  assert.deepEqual(story.beats.map((b) => b.title), ['A', 'B', 'C']);
  assert.equal(moveBeat(library, story.id, 'missing', 0).reason, 'beat-not-found');
});

test('canonical lock blocks every story and beat mutation', () => {
  const library = createStoryLibrary();
  const story = seedJourneyStory(library);
  assert.equal(addBeat(library, story.id, { kind: 'feature', refId: 'x', title: 't' }).reason, 'canonical-story');
  assert.equal(updateBeat(library, story.id, 'beat-journey-1', { title: 't' }).reason, 'canonical-story');
  assert.equal(removeBeat(library, story.id, 'beat-journey-1').reason, 'canonical-story');
  assert.equal(moveBeat(library, story.id, 'beat-journey-1', 2).reason, 'canonical-story');
  assert.equal(renameStory(library, story.id, { title: 'x' }).reason, 'canonical-story');
  assert.equal(deleteStory(library, story.id).reason, 'canonical-story');
  assert.equal(story.beats.length, 9, 'canonical beats untouched');
});

test('copyStory duplicates as a non-canonical story with fresh ids', () => {
  const library = createStoryLibrary();
  const journey = seedJourneyStory(library);
  const r = copyStory(library, JOURNEY_STORY_ID);
  assert.equal(r.ok, true);
  assert.equal(r.story.canonical, false);
  assert.equal(r.story.title, 'The Journey (copy)');
  assert.equal(r.story.beats.length, 9);
  assert.notEqual(r.story.id, journey.id);
  assert.ok(r.story.beats.every((b) => !b.id.startsWith('beat-journey')));
  const ren = renameStory(library, r.story.id, { title: 'Editable' });
  assert.equal(ren.ok, true);
  assert.equal(journey.title, 'The Journey', 'original untouched');
  assert.equal(copyStory(library, 'missing').reason, 'story-not-found');
});

test('validateBeat checks kind, ref, and registry membership', () => {
  const good = { kind: 'feature', refId: 'block-world', title: 't' };
  assert.equal(validateBeat(good).ok, true);
  assert.equal(validateBeat({ ...good, kind: 'nope' }).reason, 'invalid-beat-kind');
  assert.equal(validateBeat({ ...good, refId: '' }).reason, 'invalid-beat-ref');
  assert.equal(validateBeat({ ...good, refId: 42 }).reason, 'invalid-beat-ref');
  assert.equal(validateBeat(good, { feature: ['block-world', 'rooms'] }).ok, true);
  assert.equal(validateBeat(good, { feature: ['rooms'] }).reason, 'unknown-beat-ref');
  assert.equal(validateBeat(good, { feature: new Set(['block-world']) }).ok, true);
  assert.equal(validateBeat(good, { feature: new Set(['rooms']) }).reason, 'unknown-beat-ref');
  assert.equal(validateBeat(good, { other: ['x'] }).ok, true, 'registry entry for another kind is ignored');
});

test('validateStory requires beats and reports per-beat errors', () => {
  const { library, story } = makeLibraryWithStory();
  const empty = createStory(library, { title: 'Empty' }).story;
  let v = validateStory(empty);
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors, [{ beatId: null, reason: 'story-has-no-beats' }]);
  addBeat(library, story.id, { kind: 'feature', refId: 'block-world', title: 'Good' });
  story.beats.push({ id: 'beat-bad', kind: 'nope', refId: '', title: 'Bad' });
  v = validateStory(story);
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors, [{ beatId: 'beat-bad', reason: 'invalid-beat-kind' }]);
  story.beats.pop();
  assert.equal(validateStory(story).ok, true);
});

test('player walks start -> next* -> finished', () => {
  const { library, story } = makeLibraryWithStory();
  addTwoBeats(library, story);
  const player = createStoryPlayer();
  assert.deepEqual(player, { state: 'idle', storyId: null, beatIndex: 0 });
  let r = playerStart(player, story);
  assert.equal(r.ok, true);
  assert.equal(player.state, 'playing');
  assert.equal(r.beat.title, 'Block World');
  r = playerNext(player, story);
  assert.equal(r.ok, true);
  assert.equal(r.state, 'playing');
  assert.equal(r.beat.title, 'Giant Block');
  r = playerNext(player, story);
  assert.equal(r.ok, true);
  assert.equal(r.state, 'finished');
  assert.equal(r.beat.title, 'Giant Block');
  assert.equal(player.state, 'finished');
});

test('playerStart requires beats and a valid index', () => {
  const { library, story } = makeLibraryWithStory();
  const player = createStoryPlayer();
  const r = playerStart(player, story);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'story-has-no-beats');
  assert.equal(player.state, 'idle');
  addTwoBeats(library, story);
  const bad = playerStart(player, story, { beatIndex: 7 });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'beat-index-out-of-range');
  assert.equal(player.state, 'idle');
  const second = playerStart(player, story, { beatIndex: 1 });
  assert.equal(second.ok, true);
  assert.equal(second.beat.title, 'Giant Block');
});

test('playerPrev at the first beat is rejected without mutation', () => {
  const { library, story } = makeLibraryWithStory();
  addTwoBeats(library, story);
  const player = createStoryPlayer();
  playerStart(player, story);
  const r = playerPrev(player, story);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'at-first-beat');
  assert.equal(player.beatIndex, 0);
  assert.equal(player.state, 'playing');
  playerNext(player, story);
  const back = playerPrev(player, story);
  assert.equal(back.ok, true);
  assert.equal(player.beatIndex, 0);
  assert.equal(back.beat.title, 'Block World');
});

test('playerGoto jumps within range and rejects out-of-range', () => {
  const { library, story } = makeLibraryWithStory();
  addTwoBeats(library, story);
  const player = createStoryPlayer();
  playerStart(player, story);
  const r = playerGoto(player, story, 1);
  assert.equal(r.ok, true);
  assert.equal(player.beatIndex, 1);
  assert.equal(r.beat.title, 'Giant Block');
  const bad = playerGoto(player, story, 5);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'beat-index-out-of-range');
  assert.equal(player.beatIndex, 1, 'rejected goto does not mutate');
});

test('illegal player transitions are rejected without mutation', () => {
  const { library, story } = makeLibraryWithStory();
  addTwoBeats(library, story);
  const player = createStoryPlayer();
  assert.equal(playerNext(player, story).reason, 'not-playing');
  assert.equal(playerPrev(player, story).reason, 'not-playing');
  assert.equal(playerGoto(player, story, 0).reason, 'not-playing');
  assert.equal(player.state, 'idle');
  playerStart(player, story);
  const other = createStory(library, { title: 'Other' }).story;
  addBeat(library, other.id, { kind: 'feature', refId: 'x', title: 'o' });
  assert.equal(playerNext(player, other).reason, 'story-mismatch');
  assert.equal(player.beatIndex, 0);
  playerNext(player, story);
  playerNext(player, story);
  assert.equal(playerNext(player, story).reason, 'already-finished');
  assert.equal(player.state, 'finished');
});

test('playerStop resets to idle', () => {
  const { library, story } = makeLibraryWithStory();
  addTwoBeats(library, story);
  const player = createStoryPlayer();
  playerStart(player, story);
  playerNext(player, story);
  const r = playerStop(player);
  assert.equal(r.ok, true);
  assert.equal(r.state, 'idle');
  assert.equal(r.beat, null);
  assert.equal(r.snapshot, null);
  assert.deepEqual(player, { state: 'idle', storyId: null, beatIndex: 0 });
});

test('snapshots are frozen local-only records', () => {
  const { library, story } = makeLibraryWithStory();
  addTwoBeats(library, story);
  const player = createStoryPlayer();
  const r = playerStart(player, story);
  assert.equal(Object.isFrozen(r.snapshot), true);
  assert.equal(r.snapshot.simulation, true);
  assert.equal(r.snapshot.externalTransfer, false);
  assert.equal(r.snapshot.localOnly, true);
  assert.equal(r.snapshot.storyId, story.id);
  assert.equal(r.snapshot.beatIndex, 0);
  assert.equal(r.snapshot.beatId, 'beat-2');
  assert.equal(r.snapshot.kind, 'feature');
  assert.equal(r.snapshot.refId, 'block-world');
  assert.equal(r.snapshot.title, 'Block World');
  assert.ok(typeof r.snapshot.at === 'number');
});

test('currentBeat resolves the beat under the player', () => {
  const { library, story } = makeLibraryWithStory();
  addTwoBeats(library, story);
  const player = createStoryPlayer();
  assert.equal(currentBeat(player, story), null, 'idle has no current beat');
  playerStart(player, story, { beatIndex: 1 });
  assert.equal(currentBeat(player, story).title, 'Giant Block');
  playerStop(player);
  assert.equal(currentBeat(player, story), null);
});

test('codec round-trips a populated library', () => {
  const library = createStoryLibrary();
  const { story } = (() => {
    const r = createStory(library, { title: 'Codec', description: 'd' });
    return { story: r.story };
  })();
  addBeat(library, story.id, { kind: 'relic', refId: 'r1', title: 'A Relic', caption: 'cap' });
  library.activeStoryId = story.id;
  library.activeBeatIndex = 0;
  const text = encodeLibrary(library);
  assert.equal(typeof text, 'string');
  const decoded = decodeLibrary(text);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.library, library);
});

test('decodeLibrary rejects corrupt and foreign input', () => {
  assert.equal(decodeLibrary('not json').reason, 'invalid-json');
  assert.equal(decodeLibrary('"just a string"').reason, 'invalid-library');
  assert.equal(decodeLibrary('[1,2]').reason, 'invalid-library');
  assert.equal(decodeLibrary(JSON.stringify({ schemaVersion: 99, stories: [] })).reason, 'unsupported-schema-version');
  assert.equal(decodeLibrary(JSON.stringify({ schemaVersion: 1 })).ok, true);
});

test('decodeLibrary defensively fills missing fields', () => {
  const raw = JSON.stringify({
    schemaVersion: 1,
    stories: [{ id: 's1', beats: [{ id: 'b1', kind: 'bot', refId: 'b', title: 't' }] }],
  });
  const r = decodeLibrary(raw);
  assert.equal(r.ok, true);
  assert.equal(r.library.seq, 0);
  assert.equal(r.library.activeStoryId, null);
  assert.equal(r.library.activeBeatIndex, 0);
  assert.equal(r.library.stories[0].canonical, false);
  assert.equal(r.library.stories[0].description, '');
  assert.equal(r.library.stories[0].beats[0].caption, '');
});

test('store loads fresh on a missing key and round-trips saves', () => {
  const data = new Map();
  const storage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
  };
  const store = createStoryStore(storage);
  let r = store.load();
  assert.equal(r.ok, true);
  assert.equal(r.fresh, true);
  assert.deepEqual(r.library.stories, []);
  const library = r.library;
  createStory(library, { title: 'Saved' });
  assert.equal(store.save(library).ok, true);
  r = store.load();
  assert.equal(r.ok, true);
  assert.equal(r.fresh, false);
  assert.equal(r.library.stories[0].title, 'Saved');
  assert.equal(store.reset().ok, true);
  r = store.load();
  assert.deepEqual(r.library.stories, []);
});

test('store load reports corrupt payloads without losing the fresh library', () => {
  const data = new Map([[STORY_MODE_STORAGE_KEY, 'garbage{{{']]);
  const storage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
  };
  const store = createStoryStore(storage);
  const r = store.load();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid-json');
  assert.equal(r.fresh, true);
  assert.deepEqual(r.library.stories, []);
});

test('journey seed is idempotent and holds exactly 9 beats in order', () => {
  const library = createStoryLibrary();
  const first = seedJourneyStory(library);
  const second = seedJourneyStory(library);
  assert.equal(first, second);
  assert.equal(library.stories.length, 1);
  assert.equal(first.id, JOURNEY_STORY_ID);
  assert.equal(first.canonical, true);
  assert.equal(first.title, 'The Journey');
  assert.equal(first.description, 'Tumbo\u2019s designed journey, end to end.');
  assert.equal(first.beats.length, 9);
  const plan = [
    ['world-view', 'giant-block', 'One Block'],
    ['feature', 'block-world', 'Constellation'],
    ['world-view', 'tentacles', 'Tentacles'],
    ['feature', 'asset-market', 'Asset Market'],
    ['feature', 'ledger', 'Prime Ledger \u00b7 EchoProof'],
    ['feature', 'contracts', 'Contracts'],
    ['feature', 'nft-atelier', 'Frozen Relics'],
    ['feature', 'ledger', 'Journal'],
    ['world-view', 'giant-block', 'Back to One Block'],
  ];
  first.beats.forEach((beat, i) => {
    assert.equal(beat.kind, plan[i][0], `beat ${i} kind`);
    assert.equal(beat.refId, plan[i][1], `beat ${i} refId`);
    assert.equal(beat.title, plan[i][2], `beat ${i} title`);
    assert.ok(beat.caption.length > 0, `beat ${i} has a caption`);
    assert.equal(Object.isFrozen(beat), true, `beat ${i} frozen`);
  });
  assert.equal(validateStory(first).ok, true);
});

test('planTraversal lists beats in play order', () => {
  const library = createStoryLibrary();
  const journey = seedJourneyStory(library);
  const traversal = planTraversal(journey);
  assert.equal(traversal.length, 9);
  assert.deepEqual(traversal[0], {
    index: 0,
    beatId: 'beat-journey-1',
    kind: 'world-view',
    refId: 'giant-block',
    title: 'One Block',
    caption: 'Far away, the whole Living Reality is a single giant pulsing glass block.',
  });
  assert.equal(traversal[8].title, 'Back to One Block');
  assert.deepEqual(planTraversal(null), []);
});
