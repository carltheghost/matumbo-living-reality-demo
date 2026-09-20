/**
 * Air-typing engine (pure, no DOM).
 * Maps normalized fingertip taps to key events using a floating key map.
 * Supports letters/symbols layers, one-shot Shift, per-key debounce,
 * multi-finger tracking, and lateral-move cancellation of pending taps.
 */
export const DEBOUNCE_MS = 250;
export const TAP_COMPLETE_MS = 90;
export const LATERAL_MOVE_RATIO = 0.12; // of key width
/** Sensible symbols layer mapping (normalized key ids → emitted glyph). */
const SYMBOLS_MAP = Object.freeze({
  "1": "1", "2": "2", "3": "3", "4": "4", "5": "5",
  "6": "6", "7": "7", "8": "8", "9": "9", "0": "0",
  "-": "-", "=": "=", "[": "[", "]": "]", "\\": "\\",
  ";": ";", "'": "'", ",": ",", ".": ".", "/": "/",
  "`": "`", "~": "~", "!": "!", "@": "@", "#": "#",
  "$": "$", "%": "%", "^": "^", "&": "&", "*": "*",
  "(": "(", ")": ")", "_": "_", "+": "+", "{": "{",
  "}": "}", "|": "|", ":": ":", "\"": "\"", "<": "<",
  ">": ">", "?": "?",
});
/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {{ key: string, rect: Rect }} KeyRect
 * @typedef {{ type: "char", char: string } | { type: "backspace" } | { type: "enter" } | { type: "dismiss" } | { type: "symbols" }} AirEvent
 * @typedef {(keyId: "Shift" | "Symbols", armed: boolean) => void} ControlKeyCallback
 */
/**
 * Create a pure air-typing engine.
 *
 * @param {object} [options]
 * @param {ControlKeyCallback} [options.onControlKey]
 *   Optional hook invoked when a tap lands on a control key that produces
 *   no text event of its own (Shift arm/disarm, Symbols layer toggle).
 *   This lets an integrator mirror control state (e.g. a visible
 *   keyboard's Shift highlight) without changing any emitted event.
 *   All return values are unchanged whether or not the hook is provided.
 * @returns {{
 *   setKeyMap: (rects: KeyRect[]) => void,
 *   setLayer: (layer: "letters" | "symbols") => void,
 *   setShiftArmed: (armed: boolean) => void,
 *   poll: (nowMs: number) => AirEvent[],
 *   registerTap: (fingerId: number, x: number, y: number, nowMs: number) => AirEvent[],
 *   registerMove: (fingerId: number, x: number, y: number, nowMs: number) => AirEvent[],
 * }}
 */
export function createAirTyping({ onControlKey } = {}) {
  const notifyControlKey =
    typeof onControlKey === "function" ? onControlKey : null;
  /** @type {KeyRect[]} */
  let keyMap = [];
  /** @type {"letters" | "symbols"} */
  let layer = "letters";
  /** one-shot shift latch */
  let shiftArmed = false;
  /** last emission time per key id (for debounce) */
  const lastFire = new Map();
  /**
   * Pending taps keyed by fingerId.
   * @type {Map<number, {
   *   x0: number, y0: number, t0: number,
   *   key: string | null, rect: Rect | null,
   *   cancelled: boolean
   * }>}
   */
  const pending = new Map();
  /**
   * Find the key whose rect contains (x,y). First match wins.
   * @param {number} x
   * @param {number} y
   * @returns {KeyRect | null}
   */
  function hitTest(x, y) {
    for (const kr of keyMap) {
      const { x: rx, y: ry, w, h } = kr.rect;
      if (x >= rx && x < rx + w && y >= ry && y < ry + h) {
        return kr;
      }
    }
    return null;
  }
  /**
   * Map a raw key id to the final emitted character / control event,
   * honouring the current layer and shift latch.
   * @param {string} keyId
   * @returns {AirEvent | null}
   */
  function resolveKey(keyId) {
    if (keyId === "Backspace") return { type: "backspace" };
    if (keyId === "Enter") return { type: "enter" };
    if (keyId === "Dismiss" || keyId === "dismiss") return { type: "dismiss" };
    if (keyId === "Shift") {
      shiftArmed = !shiftArmed;
      if (notifyControlKey) {
        try { notifyControlKey("Shift", shiftArmed); } catch { /* hook must not break typing */ }
      }
      return null; // no emission; just arm/disarm
    }
    if (keyId === "Symbols") {
      if (notifyControlKey) {
        try { notifyControlKey("Symbols", layer !== "symbols"); } catch { /* hook must not break typing */ }
      }
      return { type: "symbols" };
    }
    if (keyId === " ") return { type: "char", char: " " };
    let ch = keyId;
    if (layer === "symbols") {
      ch = SYMBOLS_MAP[keyId] ?? keyId;
    } else {
      // letters layer – expect a–z (or already upper)
      ch = keyId.length === 1 ? keyId.toLowerCase() : keyId;
    }
    if (shiftArmed && ch.length === 1 && /[a-z]/.test(ch)) {
      ch = ch.toUpperCase();
      shiftArmed = false; // one-shot
    }
    return { type: "char", char: ch };
  }
  /**
   * Attempt to fire a key, respecting per-key debounce.
   * @param {string} keyId
   * @param {number} nowMs
   * @returns {AirEvent | null}
   */
  function tryFire(keyId, nowMs) {
    const last = lastFire.get(keyId) ?? -Infinity;
    if (nowMs - last < DEBOUNCE_MS) return null;
    lastFire.set(keyId, nowMs);
    return resolveKey(keyId);
  }
  /**
   * Complete any pending taps whose window has expired.
   * @param {number} nowMs
   * @returns {AirEvent[]}
   */
  function flushCompleted(nowMs) {
    /** @type {AirEvent[]} */
    const out = [];
    for (const [fid, p] of pending) {
      if (p.cancelled) {
        pending.delete(fid);
        continue;
      }
      if (nowMs - p.t0 >= TAP_COMPLETE_MS) {
        pending.delete(fid);
        if (p.key) {
          const ev = tryFire(p.key, nowMs);
          if (ev) out.push(ev);
        }
      }
    }
    return out;
  }
  /**
   * @param {KeyRect[]} rects
   */
  function setKeyMap(rects) {
    keyMap = Array.isArray(rects) ? rects.slice() : [];
  }
  /**
   * @param {"letters" | "symbols"} l
   */
  function setLayer(l) {
    if (l === "letters" || l === "symbols") layer = l;
  }
  /**
   * Register a tap (touch-down). Starts a pending buffer that will
   * complete after TAP_COMPLETE_MS unless cancelled by lateral move.
   * @param {number} fingerId
   * @param {number} x
   * @param {number} y
   * @param {number} nowMs
   * @returns {AirEvent[]}
   */
  function registerTap(fingerId, x, y, nowMs) {
    const completed = flushCompleted(nowMs);
    // Cap at 10 concurrent fingers; drop oldest if needed.
    if (pending.size >= 10 && !pending.has(fingerId)) {
      const oldest = pending.keys().next().value;
      pending.delete(oldest);
    }
    const hit = hitTest(x, y);
    pending.set(fingerId, {
      x0: x, y0: y, t0: nowMs,
      key: hit ? hit.key : null,
      rect: hit ? hit.rect : null,
      cancelled: false,
    });
    return completed;
  }
  /**
   * Register a move. If the finger has drifted laterally more than
   * LATERAL_MOVE_RATIO of the original key width, cancel the pending tap.
   * @param {number} fingerId
   * @param {number} x
   * @param {number} y
   * @param {number} nowMs
   * @returns {AirEvent[]}
   */
  function registerMove(fingerId, x, y, nowMs) {
    const completed = flushCompleted(nowMs);
    const p = pending.get(fingerId);
    if (!p || p.cancelled) return completed;
    if (p.rect) {
      const dx = Math.abs(x - p.x0);
      const threshold = p.rect.w * LATERAL_MOVE_RATIO;
      if (dx > threshold) {
        p.cancelled = true;
      }
    }
    return completed;
  }
  /**
   * Set the one-shot shift latch directly. Lets a session/integrator mirror
   * an externally driven shift state (e.g. the visible air keyboard's Shift
   * highlight) into the engine without synthesizing a tap.
   * @param {boolean} armed
   */
  function setShiftArmed(armed) {
    shiftArmed = !!armed;
  }
  /**
   * Flush any pending taps whose completion window has expired.
   *
   * Lets the session drain completed taps on every frame even when no new
   * tap or move arrives (taps complete purely on elapsed time).
   * @param {number} nowMs
   * @returns {AirEvent[]}
   */
  function poll(nowMs) {
    return flushCompleted(nowMs);
  }
  return {
    setKeyMap,
    setLayer,
    setShiftArmed,
    poll,
    registerTap,
    registerMove,
  };
}
