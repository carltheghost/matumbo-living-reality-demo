/**
 * src/domains/mascot-motion.js
 *
 * Deterministic mascot motion system for the maTumbo Living Reality Ω
 * (Reality Lens Ω).
 *
 * Pure logic: no DOM, no THREE, no randomness, no console output.
 * Five states — idle / float / wave / talk / celebrate — each producing a
 * per-frame motion sample { bobY, swayX, tiltZ, scalePulse, squash }.
 *
 * wave and celebrate are timed gestures: they auto-transition back to idle
 * after 1.4s / 2.0s measured on an injectable clock (nowProvider), so tests
 * can use a fake clock.
 *
 * Simulated TUMBO points only — no wallets / crypto. Projection only —
 * no ledger / identity / wallet authority anywhere.
 */

const TWO_PI = Math.PI * 2;

export const MASCOT_STATES = [
  "idle",
  "float",
  "wave",
  "talk",
  "celebrate",
];

export function blinkDip(t) {
  const time = Number.isFinite(t) ? t : 0;
  const cycle = ((time % 3.4) + 3.4) % 3.4;
  return cycle < 0.12 ? 0.12 : 0;
}

function safeTime(value) {
  return Number.isFinite(value) ? value : 0;
}

function idleSample(t) {
  const time = safeTime(t);

  return {
    bobY: 0.03 * Math.sin(TWO_PI * 0.25 * time),
    swayX: 0.02 * Math.sin(TWO_PI * 0.18 * time + 1),
    tiltZ: 0.02 * Math.sin(TWO_PI * 0.2 * time),
    scalePulse: 0.008 * Math.sin(TWO_PI * 0.25 * time),
    squash: blinkDip(time),
  };
}

export function createMascotMotion(initialState = "idle", nowProvider = () => Date.now() / 1000) {
  if (!MASCOT_STATES.includes(initialState)) {
    throw new Error(`Unknown mascot state: ${initialState}`);
  }

  let state = initialState;
  let stateTimestamp = safeTime(nowProvider());

  function getNow() {
    return safeTime(nowProvider());
  }

  function getState() {
    return state;
  }

  function setState(nextState) {
    if (!MASCOT_STATES.includes(nextState)) {
      throw new Error(`Unknown mascot state: ${nextState}`);
    }

    state = nextState;
    stateTimestamp = getNow();
  }

  function sample(t) {
    const time = safeTime(t);

    if (state === "wave" || state === "celebrate") {
      const elapsed = Math.max(0, getNow() - stateTimestamp);

      if (elapsed >= 1.4 && state === "wave") {
        state = "idle";
      } else if (elapsed >= 2 && state === "celebrate") {
        state = "idle";
      }
    }

    if (state === "idle") {
      return idleSample(time);
    }

    if (state === "float") {
      return {
        bobY: 0.12 * Math.sin(TWO_PI * 0.5 * time),
        swayX: 0.05 * Math.sin(TWO_PI * 0.33 * time),
        tiltZ: 0.06 * Math.sin(TWO_PI * 0.4 * time),
        scalePulse: 0.01 * Math.sin(TWO_PI * 0.5 * time),
        squash: blinkDip(time),
      };
    }

    if (state === "wave") {
      const elapsed = Math.max(0, getNow() - stateTimestamp);

      return {
        bobY: 0.03 * Math.sin(TWO_PI * 0.25 * time),
        swayX: 0.02 * Math.sin(TWO_PI * 0.18 * time + 1),
        tiltZ: 0.35 * Math.sin(TWO_PI * 3 * elapsed),
        scalePulse: 0.008 * Math.sin(TWO_PI * 0.25 * time),
        squash: blinkDip(time),
      };
    }

    if (state === "talk") {
      return {
        bobY: 0.015 * Math.sin(TWO_PI * 0.25 * time),
        swayX: 0.01 * Math.sin(TWO_PI * 0.18 * time + 1),
        tiltZ: 0.01 * Math.sin(TWO_PI * 0.2 * time),
        scalePulse:
          0.02 * Math.abs(Math.sin(TWO_PI * 3 * time)) +
          0.004 * Math.sin(TWO_PI * 0.25 * time),
        squash: blinkDip(time),
      };
    }

    if (state === "celebrate") {
      const elapsed = Math.max(0, getNow() - stateTimestamp);
      const idle = idleSample(time);
      const hop =
        0.25 *
        Math.max(0, Math.sin(TWO_PI * 1.5 * elapsed)) *
        Math.exp(-elapsed * 1.2);

      return {
        bobY: idle.bobY + hop,
        swayX: idle.swayX,
        tiltZ: idle.tiltZ,
        scalePulse: idle.scalePulse,
        squash: idle.squash,
      };
    }

    return idleSample(time);
  }

  return {
    getState,
    setState,
    sample,
  };
}
