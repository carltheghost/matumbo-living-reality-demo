import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCubeDiveState,
  diveTransition,
  resolveDiveBinding,
  resolveHandoffHop,
  resolveHopVessel,
  resolveNestedDiveTargets,
  CUBE_DIVE_DOUBLE_TAP_WINDOW_MS,
  CUBE_DIVE_STATES,
} from '../src/domains/cube-dive.js';

test('dive window is a tight 350ms double-tap', () => {
  assert.equal(CUBE_DIVE_DOUBLE_TAP_WINDOW_MS, 350);
  assert.deepEqual(CUBE_DIVE_STATES, ['field', 'diving', 'inside', 'exiting']);
});

test('state machine walks field -> diving -> inside -> exiting -> field', () => {
  const s = createCubeDiveState();
  let r = diveTransition(s, 'begin', { blockId: 'b1', featureId: 'rooms', label: 'Rooms' });
  assert.equal(r.ok, true);
  assert.equal(s.state, 'diving');
  assert.equal(r.snapshot.simulation, true);
  assert.equal(r.snapshot.externalTransfer, false);
  r = diveTransition(s, 'arrive');
  assert.equal(r.ok, true);
  assert.equal(s.state, 'inside');
  assert.equal(s.stack.length, 1);
  r = diveTransition(s, 'exit');
  assert.equal(r.ok, true);
  assert.equal(s.state, 'exiting');
  r = diveTransition(s, 'land');
  assert.equal(r.ok, true);
  assert.equal(s.state, 'field');
  assert.equal(s.stack.length, 0);
  assert.equal(s.active, null);
});

test('illegal transitions are rejected without mutating state', () => {
  const s = createCubeDiveState();
  assert.equal(diveTransition(s, 'arrive').ok, false);
  assert.equal(diveTransition(s, 'exit').ok, false);
  assert.equal(diveTransition(s, 'land').ok, false);
  assert.equal(diveTransition(s, 'deeper').ok, false);
  assert.equal(diveTransition(s, 'hop').ok, false);
  assert.equal(s.state, 'field');
  diveTransition(s, 'begin', { blockId: 'b1', featureId: 'rooms' });
  assert.equal(diveTransition(s, 'begin', { blockId: 'b2', featureId: 'x' }).ok, false);
  assert.equal(s.state, 'diving');
});

test('hop moves inside -> diving -> inside with the new feature', () => {
  const s = createCubeDiveState();
  diveTransition(s, 'begin', { blockId: 'b1', featureId: 'rooms', label: 'Rooms' });
  diveTransition(s, 'arrive');
  const r = diveTransition(s, 'hop', { blockId: 'b2', featureId: 'person', label: 'Person' });
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.kind, 'hop');
  assert.equal(r.snapshot.level, 0);
  diveTransition(s, 'arrive');
  assert.equal(s.state, 'inside');
  assert.equal(s.active.featureId, 'person');
  assert.equal(s.stack.length, 2);
});

test('deeper dives stack levels and cancel unwinds', () => {
  const s = createCubeDiveState();
  diveTransition(s, 'begin', { blockId: 'b1', featureId: 'rooms', label: 'Rooms' });
  diveTransition(s, 'arrive');
  const r = diveTransition(s, 'deeper', { contentId: 'c1', label: 'Rooms · echo shard' });
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.level, 1);
  assert.equal(r.snapshot.blockId, 'b1');
  diveTransition(s, 'arrive');
  assert.equal(s.stack.length, 2);
  // Cancel mid-flight returns to the last arrived interior.
  diveTransition(s, 'deeper', { contentId: 'c2', label: 'x' });
  const c = diveTransition(s, 'cancel');
  assert.equal(c.ok, true);
  assert.equal(s.state, 'inside');
  assert.equal(s.active.level, 1);
});

test('portal cubes bind deterministically to portal routes', () => {
  const blocks = [
    { id: 'solid-1', blockType: 'solid' },
    { id: 'portal-1', blockType: 'portal' },
    { id: 'portal-2', blockType: 'portal' },
  ];
  const b1 = resolveDiveBinding({ blocks, blockId: 'portal-1' });
  assert.equal(b1.ok, true);
  assert.ok(b1.featureId);
  assert.ok(b1.routeId);
  const b2 = resolveDiveBinding({ blocks, blockId: 'portal-2' });
  assert.equal(b2.ok, true);
  assert.notEqual(b2.featureId, b1.featureId, 'round-robin gives distinct routes');
  const solid = resolveDiveBinding({ blocks, blockId: 'solid-1' });
  assert.equal(solid.ok, false);
  assert.equal(solid.reason, 'not-a-portal-cube');
  assert.equal(resolveDiveBinding({ blocks, blockId: 'missing' }).ok, false);
});

test('handoff hop follows the first valid onward edge; dead ends are null', () => {
  const links = { 'reality-lens': ['person', 'block-world'], 'rooms': [] };
  assert.equal(resolveHandoffHop({ featureId: 'reality-lens', handoffLinks: links }), 'person');
  assert.equal(resolveHandoffHop({ featureId: 'rooms', handoffLinks: links }), null);
  assert.equal(resolveHandoffHop({ featureId: 'unknown', handoffLinks: links }), null);
});

test('hop vessel prefers the bound cube, then current, then first portal', () => {
  const blocks = [
    { id: 'p1', blockType: 'portal' },
    { id: 'p2', blockType: 'portal' },
    { id: 's1', blockType: 'solid' },
  ];
  const binding = resolveDiveBinding({ blocks, blockId: 'p1' });
  assert.equal(
    resolveHopVessel({ blocks, featureId: binding.featureId, currentBlockId: 'p2' }),
    'p1',
    'bound cube wins',
  );
  assert.equal(
    resolveHopVessel({ blocks, featureId: 'no-such-feature', currentBlockId: 'p2' }),
    'p2',
    'unbound feature falls back to the current vessel so the chain never breaks',
  );
  assert.equal(
    resolveHopVessel({ blocks, featureId: 'no-such-feature', currentBlockId: 'gone' }),
    'p1',
    'final fallback is the first portal cube',
  );
  assert.equal(resolveHopVessel({ blocks: [], featureId: 'x' }), null);
});

test('nested dive targets list content cubes', () => {
  const block = {
    id: 'vessel',
    contents: [
      { id: 'c1', contentType: 'echo-shard', label: 'Echo shard' },
      { id: 'c2', contentType: 'memory-fragment' },
      null,
      { nope: true },
    ],
  };
  const targets = resolveNestedDiveTargets(block);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].contentId, 'c1');
  assert.equal(targets[0].contentIndex, 0);
  assert.deepEqual(resolveNestedDiveTargets({ id: 'empty' }), []);
  assert.deepEqual(resolveNestedDiveTargets(null), []);
});
