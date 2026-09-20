/**
 * Synthetic tests for the air-typing engine.
 * Run with: node --test tests/air-typing.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAirTyping,
  DEBOUNCE_MS,
  TAP_COMPLETE_MS,
  LATERAL_MOVE_RATIO,
} from "../src/domains/air-typing.js";
/** Helper: build a simple QWERTY-ish letter map (normalized 0..1). */
function letterMap() {
  const keys = [
    { key: "q", x: 0.05, y: 0.1, w: 0.08, h: 0.15 },
    { key: "w", x: 0.14, y: 0.1, w: 0.08, h: 0.15 },
    { key: "e", x: 0.23, y: 0.1, w: 0.08, h: 0.15 },
    { key: "r", x: 0.32, y: 0.1, w: 0.08, h: 0.15 },
    { key: "t", x: 0.41, y: 0.1, w: 0.08, h: 0.15 },
    { key: "y", x: 0.50, y: 0.1, w: 0.08, h: 0.15 },
    { key: "u", x: 0.59, y: 0.1, w: 0.08, h: 0.15 },
    { key: "i", x: 0.68, y: 0.1, w: 0.08, h: 0.15 },
    { key: "o", x: 0.77, y: 0.1, w: 0.08, h: 0.15 },
    { key: "p", x: 0.86, y: 0.1, w: 0.08, h: 0.15 },
    { key: "a", x: 0.09, y: 0.30, w: 0.08, h: 0.15 },
    { key: "s", x: 0.18, y: 0.30, w: 0.08, h: 0.15 },
    { key: "d", x: 0.27, y: 0.30, w: 0.08, h: 0.15 },
    { key: "f", x: 0.36, y: 0.30, w: 0.08, h: 0.15 },
    { key: "g", x: 0.45, y: 0.30, w: 0.08, h: 0.15 },
    { key: "h", x: 0.54, y: 0.30, w: 0.08, h: 0.15 },
    { key: "j", x: 0.63, y: 0.30, w: 0.08, h: 0.15 },
    { key: "k", x: 0.72, y: 0.30, w: 0.08, h: 0.15 },
    { key: "l", x: 0.81, y: 0.30, w: 0.08, h: 0.15 },
    { key: "Shift", x: 0.02, y: 0.50, w: 0.12, h: 0.15 },
    { key: "z", x: 0.16, y: 0.50, w: 0.08, h: 0.15 },
    { key: "x", x: 0.25, y: 0.50, w: 0.08, h: 0.15 },
    { key: "c", x: 0.34, y: 0.50, w: 0.08, h: 0.15 },
    { key: "v", x: 0.43, y: 0.50, w: 0.08, h: 0.15 },
    { key: "b", x: 0.52, y: 0.50, w: 0.08, h: 0.15 },
    { key: "n", x: 0.61, y: 0.50, w: 0.08, h: 0.15 },
    { key: "m", x: 0.70, y: 0.50, w: 0.08, h: 0.15 },
    { key: "Backspace", x: 0.80, y: 0.50, w: 0.15, h: 0.15 },
    { key: " ", x: 0.25, y: 0.70, w: 0.40, h: 0.15 },
    { key: "Enter", x: 0.70, y: 0.70, w: 0.15, h: 0.15 },
    { key: "Dismiss", x: 0.88, y: 0.70, w: 0.10, h: 0.15 },
  ];
  return keys.map((k) => ({
    key: k.key,
    rect: { x: k.x, y: k.y, w: k.w, h: k.h },
  }));
}
/** Symbols layout – digits + common punctuation. */
function symbolsMap() {
  const keys = [
    { key: "1", x: 0.05, y: 0.1, w: 0.08, h: 0.15 },
    { key: "2", x: 0.14, y: 0.1, w: 0.08, h: 0.15 },
    { key: "3", x: 0.23, y: 0.1, w: 0.08, h: 0.15 },
    { key: "4", x: 0.32, y: 0.1, w: 0.08, h: 0.15 },
    { key: "5", x: 0.41, y: 0.1, w: 0.08, h: 0.15 },
    { key: "6", x: 0.50, y: 0.1, w: 0.08, h: 0.15 },
    { key: "7", x: 0.59, y: 0.1, w: 0.08, h: 0.15 },
    { key: "8", x: 0.68, y: 0.1, w: 0.08, h: 0.15 },
    { key: "9", x: 0.77, y: 0.1, w: 0.08, h: 0.15 },
    { key: "0", x: 0.86, y: 0.1, w: 0.08, h: 0.15 },
    { key: "!", x: 0.05, y: 0.30, w: 0.08, h: 0.15 },
    { key: "@", x: 0.14, y: 0.30, w: 0.08, h: 0.15 },
    { key: "#", x: 0.23, y: 0.30, w: 0.08, h: 0.15 },
    { key: "$", x: 0.32, y: 0.30, w: 0.08, h: 0.15 },
    { key: "%", x: 0.41, y: 0.30, w: 0.08, h: 0.15 },
    { key: "^", x: 0.50, y: 0.30, w: 0.08, h: 0.15 },
    { key: "&", x: 0.59, y: 0.30, w: 0.08, h: 0.15 },
    { key: "*", x: 0.68, y: 0.30, w: 0.08, h: 0.15 },
    { key: "(", x: 0.77, y: 0.30, w: 0.08, h: 0.15 },
    { key: ")", x: 0.86, y: 0.30, w: 0.08, h: 0.15 },
    { key: "-", x: 0.14, y: 0.50, w: 0.08, h: 0.15 },
    { key: "=", x: 0.23, y: 0.50, w: 0.08, h: 0.15 },
    { key: "[", x: 0.32, y: 0.50, w: 0.08, h: 0.15 },
    { key: "]", x: 0.41, y: 0.50, w: 0.08, h: 0.15 },
    { key: ";", x: 0.50, y: 0.50, w: 0.08, h: 0.15 },
    { key: "'", x: 0.59, y: 0.50, w: 0.08, h: 0.15 },
    { key: ",", x: 0.68, y: 0.50, w: 0.08, h: 0.15 },
    { key: ".", x: 0.77, y: 0.50, w: 0.08, h: 0.15 },
    { key: "/", x: 0.86, y: 0.50, w: 0.08, h: 0.15 },
    { key: "Backspace", x: 0.80, y: 0.70, w: 0.15, h: 0.15 },
    { key: " ", x: 0.25, y: 0.70, w: 0.40, h: 0.15 },
  ];
  return keys.map((k) => ({
    key: k.key,
    rect: { x: k.x, y: k.y, w: k.w, h: k.h },
  }));
}
/** Centre of a key rect. */
function centre(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}
/** Advance time and force completion of pending taps. */
function complete(engine, fingerId, nowMs) {
  // A no-op move after the window forces flush.
  return engine.registerMove(fingerId, 0, 0, nowMs + TAP_COMPLETE_MS + 1);
}
describe("air-typing constants", () => {
  it("exports expected windows", () => {
    assert.equal(DEBOUNCE_MS, 250);
    assert.equal(TAP_COMPLETE_MS, 90);
    assert.equal(LATERAL_MOVE_RATIO, 0.12);
  });
});
describe("createAirTyping – basic char mapping", () => {
  it("emits lowercase letter on tap inside key rect", () => {
    const at = createAirTyping();
    const map = letterMap();
    at.setKeyMap(map);
    at.setLayer("letters");
    const a = map.find((k) => k.key === "a");
    const { x, y } = centre(a.rect);
    let t = 1000;
    at.registerTap(1, x, y, t);
    const events = complete(at, 1, t);
    assert.deepEqual(events, [{ type: "char", char: "a" }]);
  });
  it("emits space, backspace, enter, dismiss", () => {
    const at = createAirTyping();
    at.setKeyMap(letterMap());
    at.setLayer("letters");
    const cases = [
      [" ", { type: "char", char: " " }],
      ["Backspace", { type: "backspace" }],
      ["Enter", { type: "enter" }],
      ["Dismiss", { type: "dismiss" }],
    ];
    let t = 2000;
    for (const [keyId, expected] of cases) {
      const kr = letterMap().find((k) => k.key === keyId);
      const { x, y } = centre(kr.rect);
      at.registerTap(2, x, y, t);
      const evs = complete(at, 2, t);
      assert.deepEqual(evs, [expected], `key ${keyId}`);
      t += DEBOUNCE_MS + 50; // clear debounce
    }
  });
  it("misses emit nothing", () => {
    const at = createAirTyping();
    at.setKeyMap(letterMap());
    let t = 3000;
    at.registerTap(3, 0.01, 0.01, t); // outside all keys
    const evs = complete(at, 3, t);
    assert.deepEqual(evs, []);
  });
});
describe("shift one-shot", () => {
  it("next letter is upper-case, then latch clears", () => {
    const at = createAirTyping();
    const map = letterMap();
    at.setKeyMap(map);
    at.setLayer("letters");
    const shift = map.find((k) => k.key === "Shift");
    const a = map.find((k) => k.key === "a");
    let t = 4000;
    // arm shift
    const sc = centre(shift.rect);
    at.registerTap(1, sc.x, sc.y, t);
    let evs = complete(at, 1, t);
    assert.deepEqual(evs, []); // Shift itself emits nothing
    // next letter upper
    t += DEBOUNCE_MS + 10;
    const ac = centre(a.rect);
    at.registerTap(2, ac.x, ac.y, t);
    evs = complete(at, 2, t);
    assert.deepEqual(evs, [{ type: "char", char: "A" }]);
    // subsequent letter lower again
    t += DEBOUNCE_MS + 10;
    at.registerTap(3, ac.x, ac.y, t);
    evs = complete(at, 3, t);
    assert.deepEqual(evs, [{ type: "char", char: "a" }]);
  });
});
describe("symbols layer", () => {
  it("emits digits and punctuation from symbols map", () => {
    const at = createAirTyping();
    const map = symbolsMap();
    at.setKeyMap(map);
    at.setLayer("symbols");
    const one = map.find((k) => k.key === "1");
    const bang = map.find((k) => k.key === "!");
    let t = 5000;
    at.registerTap(1, centre(one.rect).x, centre(one.rect).y, t);
    let evs = complete(at, 1, t);
    assert.deepEqual(evs, [{ type: "char", char: "1" }]);
    t += DEBOUNCE_MS + 10;
    at.registerTap(2, centre(bang.rect).x, centre(bang.rect).y, t);
    evs = complete(at, 2, t);
    assert.deepEqual(evs, [{ type: "char", char: "!" }]);
  });
});
describe("per-key debounce", () => {
  it("blocks same key within 250 ms, allows different key", () => {
    const at = createAirTyping();
    const map = letterMap();
    at.setKeyMap(map);
    at.setLayer("letters");
    const a = map.find((k) => k.key === "a");
    const s = map.find((k) => k.key === "s");
    const ac = centre(a.rect);
    const sc = centre(s.rect);
    let t = 6000;
    // first a
    at.registerTap(1, ac.x, ac.y, t);
    let evs = complete(at, 1, t);
    assert.deepEqual(evs, [{ type: "char", char: "a" }]);
    // same key too soon → blocked
    t += 100; // < DEBOUNCE_MS
    at.registerTap(1, ac.x, ac.y, t);
    evs = complete(at, 1, t);
    assert.deepEqual(evs, []);
    // different key is fine
    at.registerTap(2, sc.x, sc.y, t);
    evs = complete(at, 2, t);
    assert.deepEqual(evs, [{ type: "char", char: "s" }]);
    // after debounce window same key works again
    t += DEBOUNCE_MS + 10;
    at.registerTap(1, ac.x, ac.y, t);
    evs = complete(at, 1, t);
    assert.deepEqual(evs, [{ type: "char", char: "a" }]);
  });
});
describe("lateral-move cancellation", () => {
  it("cancels pending tap when finger moves > 12% of key width", () => {
    const at = createAirTyping();
    const map = letterMap();
    at.setKeyMap(map);
    at.setLayer("letters");
    const a = map.find((k) => k.key === "a");
    const { x, y } = centre(a.rect);
    const threshold = a.rect.w * LATERAL_MOVE_RATIO;
    let t = 7000;
    at.registerTap(1, x, y, t);
    // move beyond threshold before completion
    at.registerMove(1, x + threshold + 0.001, y, t + 30);
    const evs = complete(at, 1, t);
    assert.deepEqual(evs, []); // cancelled
  });
  it("still fires when move stays inside threshold", () => {
    const at = createAirTyping();
    const map = letterMap();
    at.setKeyMap(map);
    at.setLayer("letters");
    const a = map.find((k) => k.key === "a");
    const { x, y } = centre(a.rect);
    const threshold = a.rect.w * LATERAL_MOVE_RATIO;
    let t = 8000;
    at.registerTap(1, x, y, t);
    at.registerMove(1, x + threshold * 0.5, y, t + 30); // inside
    const evs = complete(at, 1, t);
    assert.deepEqual(evs, [{ type: "char", char: "a" }]);
  });
});
describe("multi-finger independence", () => {
  it("tracks distinct fingerIds concurrently", () => {
    const at = createAirTyping();
    const map = letterMap();
    at.setKeyMap(map);
    at.setLayer("letters");
    const a = map.find((k) => k.key === "a");
    const s = map.find((k) => k.key === "s");
    let t = 9000;
    at.registerTap(1, centre(a.rect).x, centre(a.rect).y, t);
    at.registerTap(2, centre(s.rect).x, centre(s.rect).y, t);
    // complete both
    const evs1 = complete(at, 1, t);
    const evs2 = complete(at, 2, t);
    // order depends on flush iteration; collect both
    const all = [...evs1, ...evs2];
    const chars = all.filter((e) => e.type === "char").map((e) => e.char).sort();
    assert.deepEqual(chars, ["a", "s"]);
  });
});
describe("poll() and setShiftArmed()", () => {
  it("fires a tap registered before DEBOUNCE_MS via poll()", () => {
    const at = createAirTyping();
    const map = letterMap();
    at.setKeyMap(map);
    at.setLayer("letters");
    const a = map.find((k) => k.key === "a");
    const { x, y } = centre(a.rect);
    // t < DEBOUNCE_MS: the first tap on a key must not be debounce-blocked
    // (per-key last-fire starts at -Infinity, not 0).
    const t = 100;
    const immediate = at.registerTap(1, x, y, t);
    assert.deepEqual(immediate, [], "tap is pending, not yet complete");
    const events = at.poll(t + TAP_COMPLETE_MS);
    assert.deepEqual(events, [{ type: "char", char: "a" }]);
  });
  it("poll() suppresses a second tap inside the debounce window", () => {
    const at = createAirTyping();
    const map = letterMap();
    at.setKeyMap(map);
    at.setLayer("letters");
    const a = map.find((k) => k.key === "a");
    const { x, y } = centre(a.rect);
    let t = 100;
    at.registerTap(1, x, y, t);
    assert.deepEqual(at.poll(t + TAP_COMPLETE_MS), [{ type: "char", char: "a" }]);
    // second tap 100 ms after the first fired -> inside DEBOUNCE_MS
    t += 100;
    at.registerTap(1, x, y, t);
    assert.deepEqual(at.poll(t + TAP_COMPLETE_MS), [], "debounced");
  });
  it("setShiftArmed drives the one-shot latch without a tap", () => {
    const at = createAirTyping();
    const map = letterMap();
    at.setKeyMap(map);
    at.setLayer("letters");
    at.setShiftArmed(true);
    const a = map.find((k) => k.key === "a");
    const { x, y } = centre(a.rect);
    const t = 500;
    at.registerTap(1, x, y, t);
    assert.deepEqual(at.poll(t + TAP_COMPLETE_MS), [{ type: "char", char: "A" }]);
    // one-shot: the latch clears after use, so the next letter is lower-case
    const t2 = t + TAP_COMPLETE_MS + DEBOUNCE_MS + 10;
    at.registerTap(2, x, y, t2);
    assert.deepEqual(at.poll(t2 + TAP_COMPLETE_MS), [{ type: "char", char: "a" }]);
    // and disarming explicitly keeps the next letter lower-case too
    at.setShiftArmed(false);
    const t3 = t2 + TAP_COMPLETE_MS + DEBOUNCE_MS + 10;
    at.registerTap(3, x, y, t3);
    assert.deepEqual(at.poll(t3 + TAP_COMPLETE_MS), [{ type: "char", char: "a" }]);
  });
});
