/**
 * tests/mascot-motion.test.mjs
 *
 * DOM-free tests for src/domains/mascot-motion.js.
 *
 * Run with: node --test tests/mascot-motion.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  MASCOT_STATES,
  blinkDip,
  createMascotMotion,
} from "../src/domains/mascot-motion.js";

test("MASCOT_STATES contains the five mascot states", () => {
  assert.deepEqual(MASCOT_STATES, [
    "idle",
    "float",
    "wave",
    "talk",
    "celebrate",
  ]);
});

test("setState throws on an unknown state", () => {
  const motion = createMascotMotion();

  assert.throws(
    () => motion.setState("unknown"),
    /Unknown mascot state: unknown/,
  );
});

test("sample is deterministic for the same time", () => {
  const motion = createMascotMotion();

  const first = motion.sample(2.5);
  const second = motion.sample(2.5);

  assert.deepEqual(first, second);
});

test("idle bobY matches the expected formula", () => {
  const motion = createMascotMotion();
  const t = 2;

  const sample = motion.sample(t);
  const expected = 0.03 * Math.sin(2 * Math.PI * 0.25 * t);

  assert.equal(sample.bobY, expected);
});

test("blinkDip returns 0.12 inside the blink window", () => {
  assert.equal(blinkDip(0.05), 0.12);
  assert.equal(blinkDip(3.4 + 0.05), 0.12);
});

test("blinkDip returns 0 outside the blink window", () => {
  assert.equal(blinkDip(0.12), 0);
  assert.equal(blinkDip(1), 0);
  assert.equal(blinkDip(3.4 + 0.12), 0);
});

test("wave returns to idle after 1.4 seconds", () => {
  let now = 100;

  const motion = createMascotMotion("idle", () => now);

  motion.setState("wave");
  assert.equal(motion.getState(), "wave");

  now = 101.399;
  motion.sample(0);
  assert.equal(motion.getState(), "wave");

  now = 101.4;
  motion.sample(0);

  assert.equal(motion.getState(), "idle");
});

test("no sample value is NaN across every state", () => {
  let now = 500;

  for (const state of MASCOT_STATES) {
    const motion = createMascotMotion("idle", () => now);
    motion.setState(state);

    const samples = [
      motion.sample(0),
      motion.sample(0.1),
      motion.sample(1),
      motion.sample(2.5),
      motion.sample(10),
    ];

    for (const sample of samples) {
      for (const value of Object.values(sample)) {
        assert.equal(typeof value, "number");
        assert.equal(Number.isNaN(value), false);
      }
    }

    now += 10;
  }
});
