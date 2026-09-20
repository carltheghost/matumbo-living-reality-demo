/**
 * src/domains/hand-gestures.js
 *
 * Higher-level gesture vocabulary state machine.
 * Pure ES module — no DOM, no network, no side-effects outside the returned API.
 *
 * Consumes per-frame events produced by createHandLens().update(...)
 * and emits coarser semantic gestures:
 *   - release-all
 *   - scale / rotate   (two-hand)
 *   - swipe
 *   - dive
 *   - select
 *
 * Guarantees: no duplicate emission for a single physical gesture;
 * event ordering is handled robustly by processing the supplied array
 * in order and keeping only the minimum necessary temporal state.
 */
// ---------------------------------------------------------------------------
// Public threshold constants (exported so tests & callers can share them)
// ---------------------------------------------------------------------------
export const OPEN_PALM_HOLD_MS        = 600;
export const DOUBLE_PINCH_WINDOW_MS   = 400;
export const PINCH_NO_MOVE_PX         = 0.025;   // normalised units
export const SWIPE_VELOCITY_THRESHOLD = 1.4;     // normalised units / second
export const SWIPE_STOP_VELOCITY      = 0.25;    // normalised units / second
export const SWIPE_MIN_DISTANCE       = 0.12;    // must travel at least this far
export const MIN_SCALE_CHANGE         = 0.03;    // ignore tiny scale noise
export const MIN_ROTATE_RADIANS       = 0.04;    // ignore tiny rotation noise
export const SWIPE_STOP_COLLAPSE_RATIO = 0.3;    // stop = recent speed <= max(STOP, ratio * peak)
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}
function angle(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}
function dominantDirection(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  return dy > 0 ? "down" : "up";
}
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createHandGestures() {
  // Per-hand live state
  const hands = {
    Left:  makeHandState(),
    Right: makeHandState(),
  };
  // Two-hand interaction state
  let twoHand = {
    active: false,
    initialDist: 0,
    initialAngle: 0,
    lastFactor: 1,
    lastRadians: 0,
  };
  // Global temporal markers
  let lastPinchTime = -Infinity;  // any hand, for double-pinch
  let lastPinchHand = null;
  let lastPinchPose = null;
  let lastPinchX = 0;
  let lastPinchY = 0;
  let pendingSelect = null;       // {hand, x, y, t} waiting for end confirmation
  // Open-palm hold tracking (any hand can trigger release-all)
  let openPalmStart = null;       // {hand, t} or null
  let releaseAllEmitted = false;
  // Swipe tracking (open-palm only)
  let swipeTracker = null;        // {hand, samples: [{t,x,y}], highVelSeen, peakSpeed, startX, startY, startT}
  function makeHandState() {
    return {
      pinched: false,
      x: 0.5,
      y: 0.5,
      pose: "unknown",
      pinchStartT: 0,
      pinchStartX: 0,
      pinchStartY: 0,
      movedDuringPinch: false,
    };
  }
  function pushSample(tr, nowMs, x, y) {
    tr.samples.push({ t: nowMs, x, y });
    // Keep a bounded window; older samples are irrelevant to a swipe.
    while (tr.samples.length > 2 && nowMs - tr.samples[0].t > 500) {
      tr.samples.shift();
    }
  }
  /**
   * Instantaneous speed from the last two samples. Pairwise velocity is what
   * reveals a "quick stop": a whole-window average stays high because it still
   * contains the fast part of the motion.
   */
  function recentSpeed(tr) {
    const n = tr.samples.length;
    if (n < 2) return 0;
    const a = tr.samples[n - 2];
    const b = tr.samples[n - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return 0;
    return dist(a, b) / dt;
  }
  function recordPinch(hand, ev, nowMs, pose) {
    // Double-pinch → dive (only when pointing at a portal cube).
    const inWindow = nowMs - lastPinchTime <= DOUBLE_PINCH_WINDOW_MS;
    if (inWindow && lastPinchPose === "pointing" && pose === "pointing") {
      return { dive: { type: "dive", hand, x: ev.x, y: ev.y } };
    }
    lastPinchTime = nowMs;
    lastPinchHand = hand;
    lastPinchPose = pose;
    lastPinchX = ev.x;
    lastPinchY = ev.y;
    return null;
  }
  function consumeDive() {
    // Consume so a third pinch can't chain another dive.
    lastPinchTime = -Infinity;
  }
  /**
   * @param {Array<object>} handLensEvents  – events from hand-lens this frame
   * @param {number} nowMs
   * @returns {Array<object>} higher-level gesture events
   */
  function update(handLensEvents, nowMs) {
    const out = [];
    // 1. Ingest every hand-lens event in order
    for (const ev of handLensEvents) {
      const h = hands[ev.hand];
      if (!h) continue;
      switch (ev.type) {
        case "posechange":
          h.pose = ev.pose;
          if (ev.pose === "open-palm" && !h.pinched) {
            if (!openPalmStart) {
              openPalmStart = { hand: ev.hand, t: nowMs };
              releaseAllEmitted = false;
            }
          } else if (ev.pose !== "open-palm") {
            if (openPalmStart && openPalmStart.hand === ev.hand) {
              openPalmStart = null;
              releaseAllEmitted = false;
            }
          }
          // swipe tracking follows open-palm position updates
          if (ev.pose === "open-palm" && !h.pinched) {
            if (!swipeTracker || swipeTracker.hand !== ev.hand) {
              swipeTracker = {
                hand: ev.hand,
                samples: [{ t: nowMs, x: ev.x, y: ev.y }],
                startX: ev.x,
                startY: ev.y,
                startT: nowMs,
                highVelSeen: false,
                peakSpeed: 0,
              };
            } else {
              pushSample(swipeTracker, nowMs, ev.x, ev.y);
            }
          } else {
            if (swipeTracker && swipeTracker.hand === ev.hand) swipeTracker = null;
          }
          break;
        case "pinchstart":
          h.pinched = true;
          h.pinchStartT = nowMs;
          h.pinchStartX = ev.x;
          h.pinchStartY = ev.y;
          h.movedDuringPinch = false;
          // any pinch cancels an open-palm hold
          if (openPalmStart && openPalmStart.hand === ev.hand) {
            openPalmStart = null;
            releaseAllEmitted = false;
          }
          swipeTracker = null; // pinch cancels a swipe in progress
          // 2. Two-hand pinch: when the second hand joins, lock the baseline
          {
            const other = ev.hand === "Left" ? hands.Right : hands.Left;
            if (other.pinched && !twoHand.active) {
              twoHand.active = true;
              twoHand.initialDist = dist(
                { x: h.pinchStartX, y: h.pinchStartY },
                { x: other.pinchStartX, y: other.pinchStartY }
              );
              twoHand.initialAngle = angle(
                { x: h.pinchStartX, y: h.pinchStartY },
                { x: other.pinchStartX, y: other.pinchStartY }
              );
              twoHand.lastFactor = 1;
              twoHand.lastRadians = 0;
            }
          }
          // 5. Double-pinch → dive (only when pointing at a portal cube)
          {
            const rec = recordPinch(ev.hand, ev, nowMs, h.pose);
            if (rec && rec.dive) {
              out.push(rec.dive);
              consumeDive();
            }
          }
          // arm a possible "select" – confirmed on pinchend
          pendingSelect = { hand: ev.hand, x: ev.x, y: ev.y, t: nowMs, pose: h.pose };
          break;
        case "pinchmove":
          h.x = ev.x;
          h.y = ev.y;
          if (h.pinched) {
            const moved = dist(
              { x: h.pinchStartX, y: h.pinchStartY },
              { x: ev.x, y: ev.y }
            );
            if (moved > PINCH_NO_MOVE_PX) h.movedDuringPinch = true;
            if (twoHand.active) {
              const L = hands.Left, R = hands.Right;
              const d = dist({ x: L.x, y: L.y }, { x: R.x, y: R.y });
              const factor = d / (twoHand.initialDist || 1e-6);
              if (Math.abs(factor - twoHand.lastFactor) >= MIN_SCALE_CHANGE) {
                out.push({ type: "scale", factor });
                twoHand.lastFactor = factor;
              }
              let radians =
                angle({ x: L.x, y: L.y }, { x: R.x, y: R.y }) - twoHand.initialAngle;
              // normalise to [-π, π]
              if (radians > Math.PI) radians -= 2 * Math.PI;
              if (radians < -Math.PI) radians += 2 * Math.PI;
              if (Math.abs(radians - twoHand.lastRadians) >= MIN_ROTATE_RADIANS) {
                out.push({ type: "rotate", radians });
                twoHand.lastRadians = radians;
              }
            }
          }
          break;
        case "pinchend":
          h.pinched = false;
          h.x = ev.x;
          h.y = ev.y;
          if (twoHand.active) twoHand.active = false;
          // 6. Single quick pinch → select (no movement, pointing, empty space)
          if (
            pendingSelect &&
            pendingSelect.hand === ev.hand &&
            !h.movedDuringPinch &&
            pendingSelect.pose === "pointing" &&
            nowMs - pendingSelect.t < 300
          ) {
            out.push({ type: "select", hand: pendingSelect.hand, x: pendingSelect.x, y: pendingSelect.y });
          }
          pendingSelect = null;
          break;
        case "move":
          // Optional per-frame palm position update from the hand-lens lane
          // (keeps the swipe tracker alive during a continuous open-palm
          // motion, where pose does not change). Harmless if never sent.
          h.x = ev.x;
          h.y = ev.y;
          if (swipeTracker && swipeTracker.hand === ev.hand &&
              h.pose === "open-palm" && !h.pinched) {
            pushSample(swipeTracker, nowMs, ev.x, ev.y);
          }
          break;
        case "tap":
          // hand-lens already gives us tap; treat like an instant pinch for
          // double-pinch/dive bookkeeping but do not emit our own tap event.
          {
            const rec = recordPinch(ev.hand, ev, nowMs, h.pose);
            if (rec && rec.dive) {
              out.push(rec.dive);
              consumeDive();
            }
          }
          break;
        default:
          break;
      }
    }
    // 3. Open-palm held → release-all
    if (openPalmStart && !releaseAllEmitted) {
      if (nowMs - openPalmStart.t >= OPEN_PALM_HOLD_MS) {
        out.push({ type: "release-all" });
        releaseAllEmitted = true;
      }
    }
    // 4. Swipe detection: fast open-palm motion with a quick stop
    if (swipeTracker) {
      const tr = swipeTracker;
      const h = hands[tr.hand];
      if (h && h.pose === "open-palm" && !h.pinched) {
        const speed = recentSpeed(tr);
        if (speed >= SWIPE_VELOCITY_THRESHOLD) {
          tr.highVelSeen = true;
          if (speed > tr.peakSpeed) tr.peakSpeed = speed;
        }
        // Quick stop: pairwise speed collapsed after having been high.
        // Relative collapse (peak ratio) catches a real hand stop; the
        // absolute floor catches a slow drift to rest.
        const stopLine = Math.max(SWIPE_STOP_VELOCITY, tr.peakSpeed * SWIPE_STOP_COLLAPSE_RATIO);
        if (
          tr.highVelSeen &&
          speed <= stopLine &&
          nowMs - tr.startT <= 500
        ) {
          const last = tr.samples[tr.samples.length - 1];
          const travel = dist(
            { x: tr.startX, y: tr.startY },
            { x: last.x, y: last.y }
          );
          if (travel >= SWIPE_MIN_DISTANCE) {
            const dx = last.x - tr.startX;
            const dy = last.y - tr.startY;
            out.push({
              type: "swipe",
              direction: dominantDirection(dx, dy),
              hand: tr.hand,
              x: last.x,
              y: last.y,
            });
            // consume so we don't re-fire
            swipeTracker = null;
          }
        }
      } else {
        swipeTracker = null;
      }
    }
    return out;
  }
  return { update };
}
