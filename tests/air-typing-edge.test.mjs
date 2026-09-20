/**
 * tests/air-typing-edge.test.mjs
 *
 * Edge cases for src/domains/air-typing.js:
 * first-tap debounce baseline, per-key debounce, lateral-move
 * cancellation, one-shot Shift, symbols layer, and the onControlKey hook.
 *
 * Run with: node --test tests/air-typing-edge.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createAirTyping,
  DEBOUNCE_MS,
  TAP_COMPLETE_MS,
  LATERAL_MOVE_RATIO,
} from "../src/domains/air-typing.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function keyMap() {
  return [
    { key: "a", rect: { x: 0.09, y: 0.30, w: 0.08, h: 0.15 } },
    { key: "b", rect: { x: 0.52, y: 0.50, w: 0.08, h: 0.15 } },
    { key: "1", rect: { x: 0.05, y: 0.10, w: 0.08, h: 0.15 } },
    { key: "Shift", rect: { x: 0.02, y: 0.50, w: 0.12, h: 0.15 } },
    { key: "Symbols", rect: { x: 0.02, y: 0.70, w: 0.16, h: 0.15 } },
  ];
}

const A_POS = { x: 0.13, y: 0.375 }; // inside "a"
const B_POS = { x: 0.56, y: 0.575 }; // inside "b"
const ONE_POS = { x: 0.09, y: 0.175 }; // inside "1"
const SHIFT_POS = { x: 0.08, y: 0.575 }; // inside "Shift"
const SYMBOLS_POS = { x: 0.1, y: 0.775 }; // inside "Symbols"
const NOWHERE = { x: 0.5, y: 0.9 }; // hits no key

function chars(events) {
  return events.filter((e) => e.type === "char");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("air-typing edge cases", () => {
  it("first tap fires even when it lands before 250ms (?? -Infinity baseline)", () => {
    const api = createAirTyping();
    api.setKeyMap(keyMap());

    assert.deepEqual(api.registerTap(0, A_POS.x, A_POS.y, 100), []);

    // The pending tap completes at t=100+TAP_COMPLETE_MS=190; flushing at
    // t=200 must emit the char. With a `?? 0` baseline the last-fire
    // lookup would be 0 and 200-0 < DEBOUNCE_MS would suppress it.
    assert.ok(DEBOUNCE_MS === 250 && TAP_COMPLETE_MS === 90);

    const flushed = api.registerTap(1, A_POS.x, A_POS.y, 200);
    const found = chars(flushed);

    assert.equal(found.length, 1, "first tap must not be swallowed by debounce");
    assert.equal(found[0].char, "a");
  });

  it("debounce suppresses a second tap within 250ms of the first", () => {
    const api = createAirTyping();
    api.setKeyMap(keyMap());

    api.registerTap(0, A_POS.x, A_POS.y, 1000);

    // Completes the first tap: fires.
    const first = api.registerTap(1, A_POS.x, A_POS.y, 1100);
    assert.equal(chars(first).length, 1);
    assert.equal(chars(first)[0].char, "a");

    // Completes the second tap 100ms later: within debounce, suppressed.
    const second = api.registerTap(2, A_POS.x, A_POS.y, 1200);
    assert.deepEqual(second, [], "second tap must be debounced");

    // After the window expires, the same key fires again.
    const third = api.registerTap(3, A_POS.x, A_POS.y, 1500);
    assert.equal(chars(third).length, 1);
    assert.equal(chars(third)[0].char, "a");
  });

  it("lateral move beyond 0.12 x key width cancels the pending tap", () => {
    const api = createAirTyping();
    api.setKeyMap(keyMap());

    api.registerTap(0, A_POS.x, A_POS.y, 0);

    const keyWidth = 0.08;
    const cancelX = A_POS.x + keyWidth * LATERAL_MOVE_RATIO + 0.01;
    api.registerMove(0, cancelX, A_POS.y, 50);

    // Flush past the tap-complete window on empty space: nothing fires.
    const flushed = api.registerTap(9, NOWHERE.x, NOWHERE.y, 200);
    assert.deepEqual(
      flushed,
      [],
      "a laterally-cancelled tap must emit no char",
    );
  });

  it("shift is one-shot: Shift, a -> 'A', then b -> 'b'", () => {
    const controlCalls = [];
    const api = createAirTyping({
      onControlKey: (keyId, armed) => controlCalls.push([keyId, armed]),
    });
    api.setKeyMap(keyMap());

    // Tap Shift.
    api.registerTap(0, SHIFT_POS.x, SHIFT_POS.y, 0);
    const shiftFlushed = api.registerTap(1, A_POS.x, A_POS.y, 200);
    assert.deepEqual(shiftFlushed, [], "Shift emits no char of its own");
    assert.deepEqual(controlCalls, [["Shift", true]]);

    // Tap "a": flushes the Shift tap, arms "a"; flushing "a" yields "A".
    const aOut = api.registerTap(2, B_POS.x, B_POS.y, 400);
    assert.equal(aOut.length, 1);
    assert.equal(aOut[0].char, "A");

    // Tap nothing: flushes "b" -> lowercase, shift was one-shot.
    const bOut = api.registerTap(3, NOWHERE.x, NOWHERE.y, 600);
    assert.equal(bOut.length, 1);
    assert.equal(bOut[0].char, "b");
  });

  it("symbols layer: '1' emits '1'; Symbols tap notifies onControlKey", () => {
    const controlCalls = [];
    const api = createAirTyping({
      onControlKey: (keyId, armed) => controlCalls.push([keyId, armed]),
    });
    api.setKeyMap(keyMap());

    // Letters layer: tap the Symbols control key. The engine emits the
    // event and notifies; the actual layer switch stays integrator-driven.
    api.registerTap(0, SYMBOLS_POS.x, SYMBOLS_POS.y, 0);
    const symOut = api.registerTap(1, NOWHERE.x, NOWHERE.y, 200);
    assert.equal(symOut.length, 1);
    assert.equal(symOut[0].type, "symbols");
    assert.deepEqual(controlCalls, [["Symbols", true]]);

    api.setLayer("symbols");
    api.registerTap(2, ONE_POS.x, ONE_POS.y, 400);
    const numOut = api.registerTap(3, NOWHERE.x, NOWHERE.y, 600);
    assert.equal(chars(numOut).length, 1);
    assert.equal(chars(numOut)[0].char, "1");
  });

  it("poll() is used defensively only when present", () => {
    const api = createAirTyping();
    api.setKeyMap(keyMap());

    api.registerTap(0, A_POS.x, A_POS.y, 100);

    if (typeof api.poll === "function") {
      const out = api.poll(200);
      assert.equal(chars(out).length, 1);
      assert.equal(chars(out)[0].char, "a");
    } else {
      // Fall back to the registerTap flush when poll is unavailable.
      const out = api.registerTap(1, A_POS.x, A_POS.y, 200);
      assert.equal(chars(out).length, 1);
    }
  });
});
