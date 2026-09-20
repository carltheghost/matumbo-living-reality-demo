import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { avatarIdlePose, avatarGlide, AVATAR_MOTION } from '../src/domains/avatar-motion.js';

test('idle pose is deterministic per time and seed', () => {
  const a = avatarIdlePose({ time: 3.7, seed: 0.42 });
  const b = avatarIdlePose({ time: 3.7, seed: 0.42 });
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.bobY) && Number.isFinite(a.swayY) && Number.isFinite(a.glow));
});

test('different seeds desynchronize the pulse', () => {
  const a = avatarIdlePose({ time: 3.7, seed: 0.1 });
  const b = avatarIdlePose({ time: 3.7, seed: 0.9 });
  assert.notDeepEqual(a, b, 'a board of pieces must not pulse in lockstep');
});

test('reduced motion freezes the avatar at rest', () => {
  const pose = avatarIdlePose({ time: 123.456, seed: 0.3, reducedMotion: true });
  assert.deepEqual(pose, { bobY: 0, swayY: 0, glow: AVATAR_MOTION.glowPulse.base, torso: 0 });
});

test('idle motion stays within the studio float envelope', () => {
  for (const t of [0, 0.5, 1.3, 9.9]) {
    const pose = avatarIdlePose({ time: t, seed: 0.2 });
    assert.ok(Math.abs(pose.bobY) <= AVATAR_MOTION.bob.amp + 1e-9);
    assert.ok(Math.abs(pose.swayY) <= AVATAR_MOTION.swayTurn.amp + 1e-9);
    assert.ok(Math.abs(pose.glow - AVATAR_MOTION.glowPulse.base) <= AVATAR_MOTION.glowPulse.amp + 1e-9);
  }
});

test('glide starts and ends exactly on its anchors', () => {
  const from = [1, 0.06, 2], to = [4, 0.06, -3];
  const start = avatarGlide({ from, to, t: 0 });
  const end = avatarGlide({ from, to, t: 1 });
  assert.deepEqual([start.x, start.y, start.z], from);
  assert.deepEqual([end.x, end.y, end.z], to);
});

test('glide midpoint lifts by the arc and eases (not linear)', () => {
  const from = [0, 0, 0], to = [4, 0, 0];
  const mid = avatarGlide({ from, to, t: 0.5, arc: 0.5 });
  assert.ok(Math.abs(mid.x - 2) < 1e-9, 'symmetric at the midpoint');
  assert.ok(Math.abs(mid.y - 0.5) < 1e-9, 'arc lift at the midpoint');
  const early = avatarGlide({ from, to, t: 0.25 });
  assert.ok(early.x < 1, `ease-in-out starts slow (got ${early.x})`);
  const late = avatarGlide({ from, to, t: 0.75 });
  assert.ok(late.x > 3, `ease-in-out ends fast into the anchor (got ${late.x})`);
});

test('capture glide arcs higher than a quiet move', () => {
  const from = [0, 0, 0], to = [2, 0, 0];
  const quiet = avatarGlide({ from, to, t: 0.5 });
  const capture = avatarGlide({ from, to, t: 0.5, arc: AVATAR_MOTION.captureArc });
  assert.ok(capture.y > quiet.y);
});

test('glide rejects bad input', () => {
  assert.throws(() => avatarGlide({ from: [0, 0], to: [1, 1, 1], t: 0.5 }), /from\/to/);
  assert.throws(() => avatarGlide({ from: [0, 0, 0], to: [1, 1, 1], t: NaN }), /finite t/);
  assert.throws(() => avatarIdlePose({ time: NaN }), /finite time/);
});

test('motion domain is dependency-free: no three, no DOM, no network', async () => {
  const raw = await readFile(new URL('../src/domains/avatar-motion.js', import.meta.url), 'utf8');
  // Strip comments so documentation words don't trip the scan.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  for (const banned of ['THREE', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'document.', 'window.']) {
    assert.ok(!src.includes(banned), `motion module must not reference ${banned}`);
  }
});
