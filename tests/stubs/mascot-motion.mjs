// tests/stubs/mascot-motion.mjs
//
// Stub for src/domains/mascot-motion.js (GPT-M3 motion system).

export const MASCOT_STATES = {
  idle: "idle",
  float: "float",
  wave: "wave",
  talk: "talk",
  celebrate: "celebrate",
};

export const calls = {
  sample: 0,
  trigger: [],
};

export let lastSample = null;

export function __reset() {
  calls.sample = 0;
  calls.trigger = [];
  lastSample = null;
}

export function createMascotMotion() {
  return {
    sample: (t) => {
      calls.sample += 1;
      lastSample = { bobY: 0.05, swayX: 0, tiltZ: 0, scalePulse: 1, squash: 1 };
      return lastSample;
    },
    trigger: (state) => {
      calls.trigger.push(state);
    },
    setState: () => {},
    dispose: () => {},
  };
}
