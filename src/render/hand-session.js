/**
 * hand-session.js — Hand Lens session pipeline.
 *
 * Owns the full per-frame hand pipeline and NOTHING else:
 *
 *   hand-camera (frames) → hand-lens (pinch/tap/pose events)
 *     → depth from apparent hand size
 *     → hand-gestures (dive/select/scale/rotate/release-all/swipe)
 *     → hand-grab (adapter into block-world authorities)
 *     → hand-presence (3D hand visuals)
 *     → air-typing → air-keyboard (when the keyboard is visible)
 *
 *   + hand-perf governor (sample interval + 2-hand/1-hand degrade)
 *   + AR-glasses-mode orchestration (presentation only)
 *   + HUD "HAND LENS" panel toggle button
 *
 * What this module does NOT do (by design):
 *   - no raycast of its own: selection/dive go through
 *     blockWorld.registerGestureFieldTap, which uses the block world's own
 *     pickBlockAtGesturePose and resolveDiveBinding as final authority;
 *   - no camera enable on mount: the camera stays OFF until the user
 *     presses Enable in the hand-lens panel (privacy: explicit action only);
 *   - no frame leaves the device; Three.js is projection-only.
 *
 * The session is DOM-tolerant: every DOM touch is guarded, and mount()
 * without a documentRoot is a graceful no-op returning false.
 */

import { createHandLens, handDepthDelta } from "../domains/hand-lens.js";
import { createHandGestures } from "../domains/hand-gestures.js";
import { createAirTyping } from "../domains/air-typing.js";
import { createHandCamera } from "./hand-camera.js";
import { createAirKeyboard } from "./air-keyboard.js";
import { createArGlassesMode } from "./ar-glasses-mode.js";
import { createHandPerf } from "./hand-perf.js";
import { createHandGrab } from "./hand-grab.js";

// hand-presence.js statically imports three.js (browser-vendored via
// importmap). It is imported lazily inside mount() — the only place presence
// is created — so pure-logic consumers (node tests, non-DOM harnesses) can
// import this module without a three install.
let presenceFactoryPromise = null;
function loadPresenceFactory() {
  if (!presenceFactoryPromise) {
    presenceFactoryPromise = import("./hand-presence.js").then(
      (module) => module.createHandPresence,
    );
  }
  return presenceFactoryPromise;
}

/**
 * Map an air-keyboard key id to the id air-typing expects in its key map.
 */
function mapKeyboardKeyId(keyId) {
  switch (keyId) {
    case "key-space":
      return " ";
    case "key-shift":
      return "Shift";
    case "key-symbols":
      return "Symbols";
    case "key-backspace":
      return "Backspace";
    case "key-enter":
      return "Enter";
    case "key-dismiss":
      return "Dismiss";
    default:
      return typeof keyId === "string" && keyId.startsWith("key-")
        ? keyId.slice(4)
        : String(keyId);
  }
}

/**
 * Map an air-typing char event back to an air-keyboard key id.
 * " " → "key-space"; single letter → "key-"+lowercase;
 * digit or symbol char → "key-"+char.
 */
function keyIdForChar(char) {
  if (char === " ") return "key-space";
  if (typeof char === "string" && char.length === 1) {
    const lower = char.toLowerCase();
    if (lower >= "a" && lower <= "z") return `key-${lower}`;
    return `key-${char}`;
  }
  return `key-${String(char)}`;
}

/**
 * @param {object} [options]
 * @param {object|null} [options.blockWorld]  block-world layer API
 * @param {object|null} [options.scene]       three.js scene (presence)
 * @param {object|null} [options.camera]      three.js camera (presence)
 * @param {object|null} [options.documentRoot]
 * @param {(error: unknown) => void} [options.onError]
 * @param {(options: object) => object} [options.createCamera]
 *   defaults to createHandCamera; injectable for tests.
 * @param {(options: object) => object} [options.createKeyboard]
 *   defaults to createAirKeyboard; injectable for tests.
 * @returns {{
 *   mount: () => boolean,
 *   destroy: () => void,
 *   handleFrame: (frame?: { hands?: Array, timestamp?: number, latencyMs?: number }) => void,
 *   getCamera: () => object|null,
 *   getKeyboard: () => object|null,
 *   getArMode: () => object|null,
 *   refreshAirKeyMap: () => void,
 *   isMounted: () => boolean,
 * }}
 */
export function createHandLensSession({
  blockWorld = null,
  scene = null,
  camera: threeCamera = null,
  documentRoot = null,
  onError = null,
  createCamera = createHandCamera,
  createKeyboard = createAirKeyboard,
} = {}) {
  const reportError =
    typeof onError === "function" ? onError : () => {};

  function safeCreate(factory) {
    try {
      return factory();
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  // ---- pure pipeline pieces (no DOM, safe to build eagerly) -------------
  const handLens = createHandLens();
  const handGestures = createHandGestures();
  const perf = createHandPerf();
  const handGrab = createHandGrab({
    noteGestureIntent: (event) => blockWorld?.noteGestureIntent?.(event),
    // Tolerates a null blockWorld: the arrow returns undefined.
    registerGestureFieldTap: (pose, input) =>
      blockWorld?.registerGestureFieldTap?.(pose, input),
  });

  // ---- lifecycle-managed pieces -----------------------------------------
  const handCamera = safeCreate(() =>
    typeof createCamera === "function"
      ? createCamera({ onError })
      : null,
  );
  let keyboard = null;
  let presence = null;
  let arMode = null;
  let mounted = false;
  let hudButton = null;
  let resizeHandler = null;

  // ---- air-typing state ---------------------------------------------------
  // Mirrors of the visible keyboard's one-shot control state, so air taps
  // and pointer taps stay in sync without event loops: pressing a control
  // key through the keyboard re-enters sessionOnKey, which only writes the
  // mirrors (setLayer emits nothing), so nothing re-fires.
  let shiftMirror = false;
  let symbolsMirror = false;
  let lastKeyboardVisible = null;

  function sessionControlKey(keyId, armed) {
    if (!keyboard) return;
    if (keyId === "Shift") {
      if (shiftMirror !== armed) {
        keyboard.pressKey("key-shift");
        shiftMirror = armed;
      }
    } else if (keyId === "Symbols") {
      if (symbolsMirror !== armed) {
        keyboard.pressKey("key-symbols");
        symbolsMirror = armed;
        refreshAirKeyMap();
      }
    }
  }

  const airTyping = createAirTyping({ onControlKey: sessionControlKey });

  // Pointer parity: a pointer tap on the visible keyboard mirrors control
  // state back into the air-typing engine.
  function sessionOnKey(keyInfo) {
    if (!keyInfo) return;
    if (keyInfo.action === "symbols") {
      const toSymbols = !!keyInfo.value;
      airTyping.setLayer(toSymbols ? "symbols" : "letters");
      symbolsMirror = toSymbols;
      refreshAirKeyMap();
    } else if (keyInfo.action === "shift") {
      const armed = !!keyInfo.value;
      if (typeof airTyping.setShiftArmed === "function") {
        airTyping.setShiftArmed(armed);
      }
      shiftMirror = armed;
    }
  }

  // ---- per-hand apparent-size baselines for depth -------------------------
  const handSizeBaselines = new Map();

  function dispatchAirEvent(airEvent) {
    if (!airEvent || typeof airEvent.type !== "string" || !keyboard) return;
    const press = (keyId) => {
      if (typeof keyboard.pressKey === "function") keyboard.pressKey(keyId);
    };
    // The visible keyboard's shift is one-shot: after any character,
    // backspace, or enter press the mirror clears.
    const clearOneShotShift = () => {
      if (shiftMirror) shiftMirror = false;
    };
    switch (airEvent.type) {
      case "char":
        press(keyIdForChar(airEvent.char));
        clearOneShotShift();
        break;
      case "backspace":
        press("key-backspace");
        clearOneShotShift();
        break;
      case "enter":
        press("key-enter");
        clearOneShotShift();
        break;
      case "dismiss":
        press("key-dismiss");
        break;
      case "symbols":
        // The symbols toggle is synced synchronously by the onControlKey
        // hook (which fires inside registerTap before this event is
        // returned): mirrors + keyboard layout are already updated, so
        // there is nothing to press here — pressing "key-symbols" again
        // would toggle the keyboard back.
        break;
      default:
        break;
    }
  }

  /**
   * Rebuild the air-typing key map from the visible keyboard's key rects.
   * When the keyboard is hidden the map is cleared so stray taps type
   * nothing.
   */
  function refreshAirKeyMap() {
    if (!airTyping || typeof airTyping.setKeyMap !== "function") return;
    const visible =
      keyboard && typeof keyboard.isVisible === "function"
        ? !!keyboard.isVisible()
        : false;
    if (!visible) {
      airTyping.setKeyMap([]);
      return;
    }
    let rects = {};
    try {
      rects =
        (typeof keyboard.getKeyRects === "function"
          ? keyboard.getKeyRects()
          : {}) || {};
    } catch (error) {
      reportError(error);
      rects = {};
    }
    const view =
      (documentRoot && documentRoot.defaultView) ||
      (typeof globalThis !== "undefined" ? globalThis : null);
    let vw = Number(view && view.innerWidth);
    let vh = Number(view && view.innerHeight);
    if (!Number.isFinite(vw) || vw <= 0) vw = 1;
    if (!Number.isFinite(vh) || vh <= 0) vh = 1;
    const list = [];
    for (const [keyId, rect] of Object.entries(rects)) {
      if (!rect) continue;
      const left = Number(rect.left);
      const top = Number(rect.top);
      const width = Number(rect.width);
      const height = Number(rect.height);
      if (
        ![left, top, width, height].every((value) => Number.isFinite(value))
      ) {
        continue;
      }
      list.push({
        key: mapKeyboardKeyId(keyId),
        rect: {
          x: left / vw,
          y: top / vh,
          w: width / vw,
          h: height / vh,
        },
      });
    }
    airTyping.setKeyMap(list);
  }

  /**
   * One pipeline tick. Called by the hand-camera module with each sampled
   * frame: { hands, timestamp, latencyMs }.
   */
  function handleFrame(frame = {}) {
    const nowMs = Number.isFinite(frame.timestamp)
      ? frame.timestamp
      : typeof performance !== "undefined"
        ? performance.now()
        : Date.now();
    const hands = Array.isArray(frame.hands) ? frame.hands : [];

    // a. Performance governor.
    const latencyMs = Number.isFinite(frame.latencyMs) ? frame.latencyMs : 0;
    try {
      perf.endSample(latencyMs);
    } catch (error) {
      reportError(error);
    }
    let stats = null;
    try {
      stats = perf.getStats();
    } catch (error) {
      reportError(error);
    }
    if (stats && handCamera) {
      if (typeof handCamera.setSampleInterval === "function") {
        try {
          handCamera.setSampleInterval(stats.intervalMs);
        } catch (error) {
          reportError(error);
        }
      }
      // setHandCount/getHandCount are being added by a sibling lane;
      // call defensively.
      if (typeof handCamera.setHandCount === "function") {
        const want = stats.shouldDegrade ? 1 : 2;
        try {
          handCamera.setHandCount(want);
          perf.setReportedHands(
            typeof handCamera.getHandCount === "function"
              ? handCamera.getHandCount()
              : want,
          );
        } catch (error) {
          reportError(error);
        }
      }
    }

    // b. Hand-lens events.
    let lensEvents = [];
    try {
      lensEvents = handLens.update(hands, nowMs) || [];
    } catch (error) {
      reportError(error);
      lensEvents = [];
    }

    // c. Depth from apparent hand size (per-hand baselines).
    for (const event of lensEvents) {
      if (event.type === "pinchstart") {
        handSizeBaselines.set(event.hand, event.handSize);
        event.depthDelta = 0;
      } else if (event.type === "pinchmove") {
        const last = handSizeBaselines.get(event.hand);
        event.depthDelta = handDepthDelta(last, event.handSize);
        if (Number.isFinite(event.handSize)) {
          handSizeBaselines.set(event.hand, event.handSize);
        }
      } else if (event.type === "pinchend") {
        event.depthDelta = 0;
        handSizeBaselines.delete(event.hand);
      }
    }

    // d. Per-frame "move" events keep the swipe tracker alive during a
    // continuous open-palm motion (hand-grab ignores unknown types).
    const moveEvents = [];
    for (const hand of hands) {
      const wrist = hand && hand.landmarks && hand.landmarks[0];
      if (
        wrist &&
        Number.isFinite(wrist.x) &&
        Number.isFinite(wrist.y) &&
        (hand.handedness === "Left" || hand.handedness === "Right")
      ) {
        moveEvents.push({
          type: "move",
          hand: hand.handedness,
          x: wrist.x,
          y: wrist.y,
          timestamp: nowMs,
        });
      }
    }

    // e. Semantic gestures.
    let gestureEvents = [];
    try {
      gestureEvents = handGestures.update(
        lensEvents.concat(moveEvents),
        nowMs,
      ) || [];
    } catch (error) {
      reportError(error);
      gestureEvents = [];
    }

    // f. Route into the block-world authorities (never a second raycaster).
    try {
      handGrab.handleHandLensEvents(lensEvents);
    } catch (error) {
      reportError(error);
    }
    try {
      handGrab.handleGestureEvents(gestureEvents);
    } catch (error) {
      reportError(error);
    }

    // g. Hand presence visuals.
    const pinchState = {
      left: { active: false },
      right: { active: false },
    };
    for (const event of lensEvents) {
      const slot =
        event.hand === "Left"
          ? "left"
          : event.hand === "Right"
            ? "right"
            : null;
      if (!slot) continue;
      if (event.type === "pinchstart" || event.type === "pinchmove") {
        pinchState[slot].active = true;
      } else if (event.type === "pinchend") {
        pinchState[slot].active = false;
      }
    }
    if (presence && typeof presence.update === "function") {
      try {
        presence.update(hands, pinchState);
      } catch (error) {
        reportError(error);
      }
    }

    // h. Keyboard visibility poll.
    if (keyboard && typeof keyboard.isVisible === "function") {
      let visible = false;
      try {
        visible = !!keyboard.isVisible();
      } catch (error) {
        reportError(error);
      }
      if (visible !== lastKeyboardVisible) {
        lastKeyboardVisible = visible;
        refreshAirKeyMap();
      }
    }

    // i. Air typing — only while the keyboard is visible.
    if (lastKeyboardVisible === true) {
      const airEvents = [];
      for (const event of lensEvents) {
        if (event.type !== "tap") continue;
        const fingerId =
          (event.hand === "Left" ? 0 : 2) +
          (event.finger === "middle" ? 1 : 0);
        try {
          const out = airTyping.registerTap(
            fingerId,
            event.x,
            event.y,
            nowMs,
          );
          if (Array.isArray(out)) airEvents.push(...out);
        } catch (error) {
          reportError(error);
        }
      }
      // poll() is being added by a sibling lane; call defensively.
      if (typeof airTyping.poll === "function") {
        try {
          const out = airTyping.poll(nowMs);
          if (Array.isArray(out)) airEvents.push(...out);
        } catch (error) {
          reportError(error);
        }
      }
      for (const airEvent of airEvents) {
        dispatchAirEvent(airEvent);
      }
    }
  }

  function wireArMode() {
    if (arMode && typeof arMode.destroy === "function") {
      try {
        arMode.destroy();
      } catch (error) {
        reportError(error);
      }
    }
    arMode = safeCreate(() =>
      createArGlassesMode({
        handCamera,
        airKeyboard: keyboard,
        handPresence: presence,
      }),
    );
  }

  function installHudButton() {
    try {
      const hud =
        typeof documentRoot.getElementById === "function"
          ? documentRoot.getElementById("hud")
          : typeof documentRoot.querySelector === "function"
            ? documentRoot.querySelector("#hud")
            : null;
      if (!hud || typeof documentRoot.createElement !== "function") return;
      hudButton = documentRoot.createElement("button");
      hudButton.textContent = "HAND LENS";
      // The HUD container is pointer-events:none; the button opts back in.
      hudButton.style.pointerEvents = "auto";
      hudButton.addEventListener("click", () => {
        if (
          handCamera &&
          typeof handCamera.setPanelOpen === "function" &&
          typeof handCamera.isPanelOpen === "function"
        ) {
          try {
            handCamera.setPanelOpen(!handCamera.isPanelOpen());
          } catch (error) {
            reportError(error);
          }
        }
      });
      if (typeof hud.appendChild === "function") hud.appendChild(hudButton);
    } catch (error) {
      reportError(error);
    }
  }

  function installResizeListener() {
    try {
      const view = documentRoot && documentRoot.defaultView;
      if (view && typeof view.addEventListener === "function") {
        resizeHandler = () => {
          refreshAirKeyMap();
        };
        view.addEventListener("resize", resizeHandler);
      }
    } catch (error) {
      reportError(error);
    }
  }

  /**
   * Mount the session: create the keyboard, presence, AR orchestration,
   * subscribe to camera frames, and add the HUD toggle. Never enables the
   * camera — it stays off until the user presses Enable in the panel.
   *
   * @returns {boolean} false when there is no DOM to mount into.
   */
  function mount() {
    if (!documentRoot) return false;
    if (mounted) return true;

    keyboard = safeCreate(() =>
      typeof createKeyboard === "function"
        ? createKeyboard({ onKey: sessionOnKey })
        : null,
    );

    if (scene && threeCamera) {
      // three.js import stays out of the static graph; presence arrives on
      // a microtask and is wired into the AR orchestration then.
      loadPresenceFactory()
        .then((factory) => {
          if (!mounted) return;
          presence = safeCreate(() => factory(scene, threeCamera));
          wireArMode();
        })
        .catch(reportError);
    } else {
      wireArMode();
    }

    if (handCamera && typeof handCamera.onHands === "function") {
      try {
        handCamera.onHands(handleFrame);
      } catch (error) {
        reportError(error);
      }
    }

    installHudButton();
    installResizeListener();

    mounted = true;
    return true;
  }

  function destroy() {
    mounted = false;
    if (handCamera && typeof handCamera.disable === "function") {
      try {
        handCamera.disable();
      } catch (error) {
        reportError(error);
      }
    }
    if (arMode && typeof arMode.destroy === "function") {
      try {
        arMode.destroy();
      } catch (error) {
        reportError(error);
      }
    }
    if (keyboard && typeof keyboard.destroy === "function") {
      try {
        keyboard.destroy();
      } catch (error) {
        reportError(error);
      }
    }
    if (presence && typeof presence.dispose === "function") {
      try {
        presence.dispose();
      } catch (error) {
        reportError(error);
      }
    }
    if (perf && typeof perf.destroy === "function") {
      try {
        perf.destroy();
      } catch (error) {
        reportError(error);
      }
    }
    if (hudButton && typeof hudButton.remove === "function") {
      try {
        hudButton.remove();
      } catch (error) {
        reportError(error);
      }
    }
    hudButton = null;
    try {
      const view = documentRoot && documentRoot.defaultView;
      if (
        view &&
        typeof view.removeEventListener === "function" &&
        resizeHandler
      ) {
        view.removeEventListener("resize", resizeHandler);
      }
    } catch (error) {
      reportError(error);
    }
    resizeHandler = null;
    presence = null;
    arMode = null;
  }

  return {
    mount,
    destroy,
    handleFrame,
    getCamera: () => handCamera,
    getKeyboard: () => keyboard,
    getArMode: () => arMode,
    refreshAirKeyMap,
    isMounted: () => mounted,
  };
}

export default { createHandLensSession };
