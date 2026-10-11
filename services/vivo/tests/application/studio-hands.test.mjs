import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHandCandidates,TwoHandGestureGate} from '../../web/studio-hands-adapter.mjs';

function hand(x, y, ratio = .8, label = null) {
  const points = Array.from({length: 21}, (_, index) => ({x: x + (index % 5 - 2) * .006,
    y: y + (Math.floor(index / 5) - 2) * .006, z: 0}));
  points[0] = {x, y, z: 0};
  points[5] = {x: x - .06, y: y + .01, z: 0};
  points[17] = {x: x + .06, y: y + .01, z: 0};
  points[4] = {x: x - .05, y: y - .02, z: 0};
  points[8] = {x: x - .05 + .12 * ratio, y: y - .02, z: 0};
  return {points, handedness: label ? [{categoryName: label, score: .93}] : []};
}

function openHands(offset = 0) {
  return normalizeHandCandidates(
    [hand(.25 + offset, .5, .8, 'Left').points, hand(.75 + offset, .5, .8, 'Right').points],
    [hand(0, 0, .8, 'Left').handedness, hand(0, 0, .8, 'Right').handedness],
  );
}

function closedHands(offset = 0, spread = 0) {
  return normalizeHandCandidates(
    [hand(.25 + offset - spread, .5, .18, 'Left').points, hand(.75 + offset + spread, .5, .18, 'Right').points],
    [hand(0, 0, .18, 'Left').handedness, hand(0, 0, .18, 'Right').handedness],
  );
}

test('normalizes complete 21-landmark hands and preserves identity across reorder/crossing', () => {
  const first = normalizeHandCandidates(
    [hand(.25, .5).points, hand(.75, .5).points],
    [hand(0, 0, .8, 'Left').handedness, hand(0, 0, .8, 'Right').handedness],
  );
  assert.deepEqual(first.map(hand => hand.id), ['hand:left', 'hand:right']);
  assert.ok(first.every(hand => hand.points.length === 21));
  assert.ok(first.every(hand => [4, 8, 12, 16, 20].every(index => Number.isFinite(hand.points[index].x))));

  const reordered = normalizeHandCandidates(
    [hand(.72, .5).points, hand(.28, .5).points],
    [hand(0, 0, .8, 'Right').handedness, hand(0, 0, .8, 'Left').handedness], first,
  );
  assert.deepEqual(reordered.map(hand => hand.id), ['hand:left', 'hand:right']);
  assert.ok(Math.abs(reordered.find(hand => hand.id === 'hand:left').center.x - .28) < .02);

  const crossed = normalizeHandCandidates(
    [hand(.78, .5).points, hand(.22, .5).points],
    [hand(0, 0, .8, 'Left').handedness, hand(0, 0, .8, 'Right').handedness], reordered,
  );
  assert.equal(crossed.find(hand => hand.id === 'hand:left').label, 'left');
  assert.equal(crossed.find(hand => hand.id === 'hand:right').label, 'right');
});
test('occlusion and reacquisition keep a surviving hand addressable', () => {
  const both = normalizeHandCandidates(
    [hand(.25, .5).points, hand(.75, .5).points],
    [hand(0, 0, .8, 'Left').handedness, hand(0, 0, .8, 'Right').handedness],
  );
  const occluded = normalizeHandCandidates([hand(.74, .5).points], [hand(0, 0, .8, 'Right').handedness], both);
  assert.deepEqual(occluded.map(hand => hand.id), ['hand:right']);
  const reacquired = normalizeHandCandidates(
    [hand(.27, .5).points, hand(.73, .5).points],
    [hand(0, 0, .8, 'Left').handedness, hand(0, 0, .8, 'Right').handedness], occluded,
  );
  assert.deepEqual(reacquired.map(hand => hand.id), ['hand:left', 'hand:right']);
});

test('two-hand view requires open arming, closed hysteresis, and releases safely', () => {
  const gate = new TwoHandGestureGate();
  assert.equal(gate.update(openHands()).type, 'idle');
  assert.equal(gate.update(openHands()).type, 'idle');
  assert.equal(gate.update(openHands()).type, 'armed');
  assert.equal(gate.update(closedHands()).type, 'armed');
  assert.equal(gate.update(closedHands()).type, 'armed');
  assert.equal(gate.update(closedHands()).type, 'start');
  const moved = gate.update(closedHands(.08));
  assert.equal(moved.type, 'update');
  assert.equal(moved.mode, 'view');
  assert.ok(Math.abs(moved.zoom) <= 120);
  assert.ok(moved.pan.every(value => Math.abs(value) <= 64));
  assert.ok(Math.abs(moved.rotate) <= 48);
  gate.update(openHands());
  assert.equal(gate.update(openHands()).type, 'release');
  assert.equal(gate.update(null).type, 'idle');
});

test('mobile bounds cap detector output and ignore malformed or excess hands', () => {
  const malformed = [hand(.25, .5).points, hand(.75, .5).points, hand(.5, .5).points];
  malformed[2][8] = {x: Number.NaN, y: .5, z: 0};
  const valid = normalizeHandCandidates(malformed, [], []);
  assert.equal(valid.length, 2);
  assert.ok(valid.every(hand => hand.points.length === 21));
  const gate = new TwoHandGestureGate();
  for (let i = 0; i < 3; i++) gate.update(openHands());
  for (let i = 0; i < 3; i++) gate.update(closedHands());
  const bounded = gate.update(closedHands(0, .18));
  assert.ok(Math.abs(bounded.zoom) <= 120);
  assert.ok(bounded.pan.every(value => Math.abs(value) <= 64));
  assert.ok(Math.abs(bounded.rotate) <= 48);
});
