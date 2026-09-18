/** Avatar motion language — how the Tumbo presence moves, shared by all.
 *
 * Extracted from the Person Studio presence (src/render/person-studio-scene.js):
 * the avatar never stands statue-still. Everything structural floats — a gentle
 * vertical bob, a slow sway-turn, a breathing glow pulse. Chess pieces ARE the
 * same avatar, so they speak the same motion language instead of standing
 * frozen on the board.
 *
 * Pure math only: no THREE, no DOM, no network. Deterministic per (time, seed)
 * so every presence can be desynchronized by seed while staying reproducible.
 * Frozen under `reducedMotion`, mirroring the studio's accessibility contract.
 *
 * Projection only: this describes how a hologram moves. It grants no identity,
 * wallet, ledger, signing, settlement, or authority of any kind.
 */

export const AVATAR_MOTION = Object.freeze({
  /** Gentle vertical float, mirroring the studio's avatar floater. */
  bob: Object.freeze({ amp: 0.045, speed: 1.15, phase: 0.6 }),
  /** Slow sway-turn, mirroring the companion's drift. */
  swayTurn: Object.freeze({ amp: 0.06, speed: 0.8 }),
  /** Breathing glow pulse, mirroring the lens energy glow. */
  glowPulse: Object.freeze({ base: 0.46, amp: 0.06, speed: 1.6 }),
  /** Barely-there torso sway. */
  torsoSway: Object.freeze({ amp: 0.007, speed: 1.4 }),
  /** Glide travel for a single square-to-square move. */
  moveDurationMs: 480,
  moveArc: 0.28,
  /** Captures travel with more drama — a higher swoop, same language. */
  captureArc: 0.6,
});

/**
 * The idle pose of one avatar presence at `time` (seconds).
 * Returns { bobY, swayY, glow, torso } — offsets to apply around the rest pose.
 */
export function avatarIdlePose({ time, seed = 0, reducedMotion = false } = {}) {
  if (!Number.isFinite(time)) throw Error('avatarIdlePose needs a finite time');
  const base = AVATAR_MOTION.glowPulse.base;
  if (reducedMotion) {
    return Object.freeze({ bobY: 0, swayY: 0, glow: base, torso: 0 });
  }
  // Per-presence phase offset so a board of pieces never pulses in lockstep.
  const phase = (Number(seed) || 0) * 0.7;
  return Object.freeze({
    bobY: Math.sin(time * AVATAR_MOTION.bob.speed + AVATAR_MOTION.bob.phase + phase) * AVATAR_MOTION.bob.amp,
    swayY: Math.sin(time * AVATAR_MOTION.swayTurn.speed + phase) * AVATAR_MOTION.swayTurn.amp,
    glow: base + Math.sin(time * AVATAR_MOTION.glowPulse.speed + phase) * AVATAR_MOTION.glowPulse.amp,
    torso: Math.sin(time * AVATAR_MOTION.torsoSway.speed + phase) * AVATAR_MOTION.torsoSway.amp,
  });
}

export const AVATAR_BLINK = Object.freeze({
  /** Seconds between blinks. */
  period: 3.4,
  /** Seconds for one close-open cycle. */
  duration: 0.16,
  /** Eye openness at the bottom of a blink (1 = fully open). */
  closed: 0.12,
});

/**
 * Eye openness at `time` (seconds): 1 while open, dipping to
 * AVATAR_BLINK.closed mid-blink and back. Deterministic per (time, seed);
 * frozen open (1) under `reducedMotion`, mirroring the studio's
 * accessibility contract.
 */
export function avatarBlink({ time, seed = 0, reducedMotion = false } = {}) {
  if (!Number.isFinite(time)) throw Error('avatarBlink needs a finite time');
  if (reducedMotion) return 1;
  const phase = (((time + (Number(seed) || 0) * 0.7) % AVATAR_BLINK.period) + AVATAR_BLINK.period) % AVATAR_BLINK.period;
  if (phase >= AVATAR_BLINK.duration) return 1;
  const u = phase / AVATAR_BLINK.duration;
  return 1 - (1 - AVATAR_BLINK.closed) * Math.sin(Math.PI * u);
}

function easeInOut(t) {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
}

/**
 * Glide a presence from one [x,y,z] point to another: eased horizontal travel
 * with a soft sine lift, like the avatar floats instead of hopping.
 * `t` in [0,1]; returns a frozen { x, y, z }.
 */export function avatarGlide({ from, to, t, arc = AVATAR_MOTION.moveArc } = {}) {
  if (!Array.isArray(from) || !Array.isArray(to) || from.length !== 3 || to.length !== 3
    || ![...from, ...to].every(Number.isFinite)) {
    throw Error('avatarGlide needs finite [x,y,z] from/to points');
  }
  if (!Number.isFinite(t)) throw Error('avatarGlide needs a finite t');
  const clamped = Math.min(1, Math.max(0, t));
  // Snap exactly to the anchors at the endpoints — no float dust on landing.
  if (clamped === 0) return Object.freeze({ x: from[0], y: from[1], z: from[2] });
  if (clamped === 1) return Object.freeze({ x: to[0], y: to[1], z: to[2] });
  const e = easeInOut(clamped);
  const lift = Math.sin(clamped * Math.PI) * (Number.isFinite(arc) ? arc : AVATAR_MOTION.moveArc);
  return Object.freeze({
    x: from[0] + (to[0] - from[0]) * e,
    y: from[1] + (to[1] - from[1]) * e + lift,
    z: from[2] + (to[2] - from[2]) * e,
  });
}
