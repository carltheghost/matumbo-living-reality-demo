/**
 * hand-grab.js — thin adapter from Hand Lens events to the existing
 * block-world manipulation authority.
 *
 * This module creates NOTHING new: no raycast, no placement, no highlight,
 * no second world-authority, no portal entry. Every action is an intent
 * object shaped exactly like the Gesture Lens console's, routed through
 * the two existing authorities:
 *
 *   - blockWorld.noteGestureIntent(event)
 *       → manipulator.applyExternalIntent(event)
 *       → grab / proxy-move / drag / scale / rotate / release
 *       (grabs resolve to a cube only through the manipulator's own
 *       raycast: pickBlockAtGesturePose)
 *
 *   - blockWorld.registerGestureFieldTap(pose, input)
 *       → the hand-first entry point: raycasts the ACTUAL cube at the
 *       normalized gesture pose through the block world's own
 *       pickBlockAtGesturePose (never a second raycaster, never a
 *       fabricated blockId), returns null with no selection change when
 *       the ray hits empty space, and otherwise delegates into
 *       registerFieldTap with pointerType "hand". This is the preferred
 *       route for `dive` / `select` when the integrator passes the option
 *       in; only when it is missing does the adapter fall back to the old
 *       registerFieldTap(null, ...) path (which re-selects the current
 *       block — the pre-2026-09-20 behaviour kept for parity).
 *
 *   - blockWorld.registerFieldTap(target, input)
 *       → the existing pointer/touch selection + double-tap dive authority.
 *       A semantic `dive` event from the gesture layer is only ever a HINT:
 *       entry is authorized solely by registerFieldTap's own raycast +
 *       resolveDiveBinding + its double-tap window. A dive hint that lands
 *       outside that window (hand double-pinch allows 400 ms, the field
 *       authority allows 350 ms) safely degrades to a re-select — never a
 *       false entry.
 *
 * Coordinate contract: every x/y entering this module is SCREEN-NORMALIZED
 * (0..1, origin top-left). The session owns the mirrored video→screen
 * mapping; this adapter never sees video coordinates.
 */

/** Full-screen hand sweep moves a held cube this many world units. */
export const DRAG_WORLD_UNITS = 6;
/** Full-screen hand-size change moves a held cube this many depth units. */
export const DEPTH_WORLD_UNITS = 4;
/** Suppress the trailing `select` after a dive for this long (ms). */
export const DIVE_SELECT_SUPPRESS_MS = 1000;

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {object} [options]
 * @param {(event: object) => unknown} [options.noteGestureIntent]
 *   blockWorld.noteGestureIntent — routes manipulation intents.
 * @param {(target: unknown, input: object) => unknown} [options.registerFieldTap]
 *   blockWorld.registerFieldTap — selection + validated dive authority.
 *   Legacy fallback route for dive/select when registerGestureFieldTap is
 *   not supplied.
 * @param {(pose: {x:number,y:number}, input: object) => unknown} [options.registerGestureFieldTap]
 *   blockWorld.registerGestureFieldTap — preferred hand route for
 *   dive/select: raycasts the actual cube, never falls back to the selected
 *   block. When provided, dive and select call it with the gesture pose.
 * @param {() => { w: number, h: number }} [options.getViewport]
 *   Viewport size for normalized→pixel conversion. Defaults to window.
 * @param {() => number} [options.nowMs]
 *   Clock for dive/select suppression. Defaults to performance.now().
 */
export function createHandGrab({
  noteGestureIntent,
  registerFieldTap,
  registerGestureFieldTap,
  getViewport,
  nowMs,
} = {}) {
  const sendIntent = typeof noteGestureIntent === "function" ? noteGestureIntent : null;
  const fieldTap = typeof registerFieldTap === "function" ? registerFieldTap : null;
  const gestureTap = typeof registerGestureFieldTap === "function" ? registerGestureFieldTap : null;
  const viewport = typeof getViewport === "function"
    ? getViewport
    : () => ({
      w: typeof window !== "undefined" ? window.innerWidth || 1 : 1,
      h: typeof window !== "undefined" ? window.innerHeight || 1 : 1,
    });
  const clock = typeof nowMs === "function"
    ? nowMs
    : () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // Two-hand gesture baselines. The gesture layer emits CUMULATIVE scale
  // factors / rotation radians; the manipulator applies INCREMENTAL ones,
  // so the adapter diffs against the last forwarded value.
  let lastScaleFactor = null;
  let lastRadians = null;
  // Pinch tracking: hand-lens emits ABSOLUTE pinch positions, so the
  // adapter diffs consecutive frames into drag deltas.
  const lastPinchPos = new Map();
  // Dive/select bookkeeping: the gesture layer emits `dive` on the second
  // pinch's start and still emits that pinch's trailing `select` on its
  // end — the integrator suppresses the duplicate.
  let lastDiveAt = -Infinity;
  let lastDiveHand = null;

  function poseOf(x, y) {
    return { x: finiteOr(x, 0.5), y: finiteOr(y, 0.5) };
  }

  function clientOf(x, y) {
    const { w, h } = viewport() || {};
    const vw = finiteOr(w, 1) || 1;
    const vh = finiteOr(h, 1) || 1;
    return {
      clientX: finiteOr(x, 0.5) * vw,
      clientY: finiteOr(y, 0.5) * vh,
      pointerType: "hand",
      timeStamp: clock(),
    };
  }

  function resetTwoHandBaseline() {
    lastScaleFactor = null;
    lastRadians = null;
  }

  /**
   * Route one dive or select through the hand-first field entry point when
   * available (pose-anchored raycast, no selected-block fallback), else the
   * legacy registerFieldTap(null, ...) route.
   */
  function routeFieldTap(ev) {
    const pose = poseOf(ev.x, ev.y);
    const input = clientOf(ev.x, ev.y);
    if (gestureTap) {
      return gestureTap(pose, input);
    }
    if (fieldTap) {
      return fieldTap(null, input);
    }
    return null;
  }

  /**
   * Low-level Hand Lens events: pinchstart / pinchmove / pinchend.
   * pinchstart → grab, pinchmove → drag (x/y/depth), pinchend → release.
   */
  function handleHandLensEvents(events) {
    if (!sendIntent || !Array.isArray(events)) return;
    for (const ev of events) {
      if (!ev || typeof ev.type !== "string") continue;
      const hand = ev.hand ?? "unknown";
      if (ev.type === "pinchstart") {
        lastPinchPos.set(hand, { x: finiteOr(ev.x, 0.5), y: finiteOr(ev.y, 0.5) });
        sendIntent({
          gesture: "grab",
          detail: { action: "grab" },
          pose: poseOf(ev.x, ev.y),
          method: "hand-lens",
          hand,
        });
      } else if (ev.type === "pinchmove") {
        const x = finiteOr(ev.x, 0.5);
        const y = finiteOr(ev.y, 0.5);
        const prev = lastPinchPos.get(hand);
        const dx = prev ? x - prev.x : 0;
        const dy = prev ? y - prev.y : 0;
        lastPinchPos.set(hand, { x, y });
        // Depth comes from the session, which derives it from apparent
        // hand-size change (hand approaching the camera looks bigger).
        const dz = finiteOr(ev.depthDelta, 0);
        sendIntent({
          gesture: "drag",
          detail: {
            action: "drag",
            dx: dx * DRAG_WORLD_UNITS,
            dy: dy * DRAG_WORLD_UNITS,
            dz: dz * DEPTH_WORLD_UNITS,
          },
          pose: poseOf(x, y),
          method: "hand-lens",
          hand,
        });
      } else if (ev.type === "pinchend") {
        lastPinchPos.delete(hand);
        resetTwoHandBaseline();
        sendIntent({
          gesture: "release",
          detail: { action: "release" },
          pose: poseOf(ev.x, ev.y),
          method: "hand-lens",
          hand,
        });
      }
    }
  }

  /**
   * Higher-level gesture events from the gesture layer:
   * dive / select / scale / rotate / release-all / swipe.
   */
  function handleGestureEvents(events) {
    for (const ev of events || []) {
      if (!ev || typeof ev.type !== "string") continue;
      const now = clock();
      switch (ev.type) {
        case "dive": {
          // HINT ONLY. Selection + entry stay inside registerFieldTap:
          // it raycasts the actual cube, validates resolveDiveBinding,
          // and applies its own double-tap window. Prefer the hand-first
          // route (pose-anchored raycast via registerGestureFieldTap) so a
          // dive never fabricates a blockId and never falls back to the
          // selected block.
          lastDiveAt = now;
          lastDiveHand = ev.hand ?? null;
          routeFieldTap(ev);
          break;
        }
        case "select": {
          // Suppress the second pinch's trailing select when that pinch
          // already triggered a dive.
          if (
            lastDiveHand != null
            && ev.hand === lastDiveHand
            && now - lastDiveAt < DIVE_SELECT_SUPPRESS_MS
          ) {
            break;
          }
          routeFieldTap(ev);
          break;
        }
        case "scale": {
          if (!sendIntent) break;
          const factor = finiteOr(ev.factor, 1);
          const incremental = lastScaleFactor == null || lastScaleFactor === 0
            ? 1
            : factor / lastScaleFactor;
          lastScaleFactor = factor;
          sendIntent({
            gesture: "scale",
            detail: { action: "scale", factor: incremental },
            pose: poseOf(ev.x, ev.y),
            method: "hand-lens",
            hand: ev.hand ?? "unknown",
          });
          break;
        }
        case "rotate": {
          if (!sendIntent) break;
          const radians = finiteOr(ev.radians, 0);
          const delta = lastRadians == null ? 0 : radians - lastRadians;
          lastRadians = radians;
          sendIntent({
            gesture: "rotate",
            detail: { action: "rotate", degrees: (delta * 180) / Math.PI },
            pose: poseOf(ev.x, ev.y),
            method: "hand-lens",
            hand: ev.hand ?? "unknown",
          });
          break;
        }
        case "release-all": {
          resetTwoHandBaseline();
          if (sendIntent) {
            sendIntent({
              gesture: "release",
              detail: { action: "release", reason: "release-all" },
              pose: poseOf(ev.x, ev.y),
              method: "hand-lens",
              hand: ev.hand ?? "unknown",
            });
          }
          break;
        }
        case "swipe": {
          // No cube-handoff authority exists in block-world yet, so a swipe
          // is forwarded as a traceable intent (the manipulator records it
          // as unmapped) rather than inventing selection-cycling here.
          if (sendIntent) {
            sendIntent({
              gesture: "swipe",
              detail: { action: "swipe", direction: ev.direction ?? null },
              pose: poseOf(ev.x, ev.y),
              method: "hand-lens",
              hand: ev.hand ?? "unknown",
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return {
    handleHandLensEvents,
    handleGestureEvents,
  };
}
