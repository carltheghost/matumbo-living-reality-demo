/**
 * Gesture Lens console — academy-pattern renderer for the Gesture Lens
 * rehearsal surface.
 *
 * The camera is OFF by default. An explicit toggle requests a local preview;
 * the preview is shown in a small on-device <video> element and is NEVER
 * analyzed, recorded, uploaded, or sent anywhere. Closing the preview (or
 * the panel) stops every camera track. When the camera is denied or missing,
 * the pointer/touch rehearsal pad keeps working with zero breakage.
 *
 * Gesture vocabulary (all pointer/touch driven in this build, every gesture
 * also available as a keyboard-focusable button):
 *   open palm move  → steer the hand proxy (proxy-move)
 *   press-and-hold  → pinch → grab
 *   drag while held → drag in 3D; mouse wheel while held → depth push/pull
 *   two pointers    → spread = stretch (scale), twist = rotate
 *   release pointer / fist button → release / detach
 *
 * Intents are emitted through onGesture() for the host (wired to the block
 * world's manipulate-controls external pointer source). The console never
 * touches wallet, ledger, contracts, network, or settlement.
 */

import {
  GESTURE_LENS_BOUNDARY,
  GESTURE_LENS_CONSOLE_SOURCE,
  GESTURE_LENS_SCHEMA_VERSION,
  createGestureLens,
  pointerSampleToFrame,
  syntheticHand,
} from "../domains/gesture-lens.js";

export {
  GESTURE_LENS_BOUNDARY,
  GESTURE_LENS_CONSOLE_SOURCE,
  GESTURE_LENS_SCHEMA_VERSION,
};

export const GESTURE_LENS_LONG_PRESS_MS = 450;
export const GESTURE_LENS_WHEEL_DEPTH_STEP = 0.12;

const MOUNT_IDS = Object.freeze([
  "gesture-lens-console",
  "gesture-lens-close",
  "gesture-lens-status",
  "gesture-lens-toggle",
  "gesture-lens-preview-wrap",
  "gesture-lens-preview",
  "gesture-lens-preview-close",
  "gesture-lens-preview-note",
  "gesture-lens-pad",
  "gesture-lens-proxy",
  "gesture-lens-gesture",
  "gesture-lens-grab",
  "gesture-lens-release",
  "gesture-lens-scale-up",
  "gesture-lens-scale-down",
  "gesture-lens-twist-left",
  "gesture-lens-twist-right",
  "gesture-lens-depth-push",
  "gesture-lens-depth-pull",
  "gesture-lens-reset",
  "gesture-lens-trace",
  "gesture-lens-boundary",
]);

function element(documentRoot, tag, className, text) {
  const el = documentRoot.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function cameraCopy(state) {
  return (
    {
      off: "GESTURE LENS READY · CAMERA OFF · POINTER / TOUCH REHEARSAL ACTIVE",
      preview: "CAMERA PREVIEW LIVE · ON-DEVICE ONLY · NOT ANALYZED · NOT RECORDED",
      denied: "CAMERA BLOCKED · POINTER / TOUCH REHEARSAL FULLY WORKING",
      unavailable: "NO CAMERA ON THIS DEVICE · POINTER / TOUCH REHEARSAL FULLY WORKING",
      error: "CAMERA ERROR · POINTER / TOUCH REHEARSAL FULLY WORKING",
    }[state] ?? "GESTURE LENS READY"
  );
}

export function createGestureLensConsole({
  documentRoot = globalThis.document,
  lens = null,
  onGesture = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
} = {}) {
  const get = (id) => documentRoot?.getElementById?.(id) ?? null;
  const panel = get("gesture-lens-console");
  const closeButton = get("gesture-lens-close");
  const statusEl = get("gesture-lens-status");
  const toggleButton = get("gesture-lens-toggle");
  const previewWrap = get("gesture-lens-preview-wrap");
  const previewVideo = get("gesture-lens-preview");
  const previewClose = get("gesture-lens-preview-close");
  const previewNote = get("gesture-lens-preview-note");
  const pad = get("gesture-lens-pad");
  const proxyEl = get("gesture-lens-proxy");
  const gestureEl = get("gesture-lens-gesture");
  const grabButton = get("gesture-lens-grab");
  const releaseButton = get("gesture-lens-release");
  const scaleUpButton = get("gesture-lens-scale-up");
  const scaleDownButton = get("gesture-lens-scale-down");
  const twistLeftButton = get("gesture-lens-twist-left");
  const twistRightButton = get("gesture-lens-twist-right");
  const depthPushButton = get("gesture-lens-depth-push");
  const depthPullButton = get("gesture-lens-depth-pull");
  const resetButton = get("gesture-lens-reset");
  const traceEl = get("gesture-lens-trace");
  const boundaryEl = get("gesture-lens-boundary");
  const missing = MOUNT_IDS.filter((id) => !get(id));
  if (missing.length > 0) {
    throw new Error(`Gesture Lens console mount points are missing: ${missing.join(", ")}`);
  }

  const studio = lens ?? createGestureLens();
  let opened = panel.hidden !== true;
  let cameraState = "off";
  let cameraStream = null;
  const pointers = new Map();
  let grabbed = false;
  let pinchTimer = null;
  let pinchStart = null;
  let twoHand = null; // { spread, skew }
  let depthAxis = 0;

  function mediaDevices() {
    return globalThis.navigator?.mediaDevices ?? null;
  }

  function snapshot(action = "read", method = "api") {
    const state = studio.getSnapshot();
    return Object.freeze({
      source: GESTURE_LENS_CONSOLE_SOURCE,
      schemaVersion: GESTURE_LENS_SCHEMA_VERSION,
      action,
      method,
      opened,
      camera: cameraState,
      gesture: state.gesture,
      pose: state.pose,
      intents: state.intents,
      localOnly: true,
      simulation: true,
      recording: false,
      upload: false,
      externalNetwork: false,
      executable: false,
      wallet: false,
      boundary: GESTURE_LENS_BOUNDARY,
    });
  }

  function publish(action, method) {
    const next = snapshot(action, method);
    if (action === "replay") onReplay?.(next);
    else if (action === "reset") onReset?.(next);
    else onSelect?.(next);
    return next;
  }

  function render() {
    const state = studio.getSnapshot();
    statusEl.textContent = cameraCopy(cameraState);
    gestureEl.textContent = `GESTURE · ${String(state.gesture).toUpperCase()} · ${state.intents} INTENT${state.intents === 1 ? "" : "S"}`;
    if (proxyEl && proxyEl.style) {
      proxyEl.style.left = `${Math.round(state.pose.x * 100)}%`;
      proxyEl.style.top = `${Math.round(state.pose.y * 100)}%`;
      proxyEl.style.opacity = grabbed ? "1" : "0.75";
    }
    traceEl.replaceChildren();
    const entries = [...state.trace].reverse().slice(0, 12);
    if (entries.length === 0) {
      traceEl.append(element(documentRoot, "div", "gesture-lens-empty", "No gesture intents yet. Drag the pad, or use the gesture buttons."));
    }
    entries.forEach((entry) => {
      traceEl.append(
        element(documentRoot, "div", "gesture-lens-trace-row", `${entry.at} · ${String(entry.gesture).toUpperCase()}`)
      );
    });
    boundaryEl.textContent = GESTURE_LENS_BOUNDARY;
    if (previewNote) {
      previewNote.textContent = "LOCAL PREVIEW · NOT ANALYZED · NO HAND TRACKING IN THIS BUILD · CLOSING STOPS THE CAMERA";
    }
    toggleButton.textContent = cameraState === "preview" ? "Stop camera preview" : "Enable camera preview";
  }

  function emitIntent(result, method) {
    const state = studio.getSnapshot();
    render();
    if (!result || !result.intent) return null;
    const event = Object.freeze({
      action: "gesture-intent",
      source: GESTURE_LENS_CONSOLE_SOURCE,
      method,
      intent: result.intent,
      detail: result.detail,
      pose: state.pose,
      gesture: state.gesture,
    });
    try {
      onGesture?.(event);
    } catch {
      // A host failure must never break the gesture pipeline.
    }
    publish("gesture", method);
    return event;
  }

  function noteSample(sample, method = "pointer") {
    const result = studio.notePointerSample(sample);
    return emitIntent(result, method);
  }

  function noteDirectFrame(frame, method) {
    const result = studio.noteFrame(frame);
    return emitIntent(result, method);
  }

  // ---- camera lifecycle: explicit toggle only, preview is local-only ----
  function stopCamera() {
    try {
      cameraStream?.getTracks?.().forEach((track) => track?.stop?.());
    } catch {
      // Track cleanup is best effort.
    }
    cameraStream = null;
    if (previewVideo) {
      try {
        previewVideo.pause?.();
      } catch {
        // A fake or detached video element may not implement pause().
      }
      previewVideo.srcObject = null;
      if (typeof previewVideo.removeAttribute === "function") previewVideo.removeAttribute("src");
    }
    if (previewWrap) previewWrap.hidden = true;
  }

  async function setCameraEnabled(next, method = "api") {
    const want = next === true;
    if (want === (cameraState === "preview")) return snapshot("camera", method);
    if (!want) {
      stopCamera();
      cameraState = "off";
      render();
      return publish("camera-off", method);
    }
    const devices = mediaDevices();
    if (!devices || typeof devices.getUserMedia !== "function") {
      cameraState = "unavailable";
      render();
      return publish("camera-unavailable", method);
    }
    try {
      const stream = await devices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
        audio: false,
      });
      cameraStream = stream;
      if (previewVideo) {
        previewVideo.srcObject = stream;
        try {
          await previewVideo.play?.();
        } catch {
          // Autoplay policies may block play(); the preview element still shows the stream.
        }
      }
      if (previewWrap) previewWrap.hidden = false;
      cameraState = "preview";
    } catch (error) {
      stopCamera();
      cameraState = error?.name === "NotAllowedError" ? "denied" : "error";
    }
    render();
    return publish(`camera-${cameraState}`, method);
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.setAttribute("aria-hidden", String(!opened));
    if (!opened && cameraState === "preview") {
      // Closing the panel kills the camera stream.
      stopCamera();
      cameraState = "off";
    }
    if (opened) render();
    return publish(opened ? "open" : "close", method);
  }

  // ---- rehearsal pad: pointer/touch drives the classifier pipeline ----
  function padRect() {
    if (pad && typeof pad.getBoundingClientRect === "function") {
      const rect = pad.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) return rect;
    }
    return { left: 0, top: 0, width: 300, height: 200 };
  }

  function normalizePoint(clientX, clientY) {
    const rect = padRect();
    return {
      x: Math.min(1, Math.max(0, (Number(clientX) - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (Number(clientY) - rect.top) / rect.height)),
      rect,
    };
  }

  function clearPinchTimer() {
    if (pinchTimer !== null) {
      clearTimeout(pinchTimer);
      pinchTimer = null;
    }
  }

  function startPinchTimer(point) {
    clearPinchTimer();
    pinchStart = point;
    pinchTimer = setTimeout(() => {
      pinchTimer = null;
      if (pointers.size === 1 && !grabbed) {
        grabbed = true;
        noteSample({ x: point.x, y: point.y, depth: depthAxis, mode: "pinch" }, "pad-hold");
      }
    }, GESTURE_LENS_LONG_PRESS_MS);
  }

  function onPadDown(event) {
    if (!event) return;
    const point = normalizePoint(event.clientX, event.clientY);
    pointers.set(event.pointerId ?? `pad-${pointers.size}`, { x: point.x, y: point.y });
    if (typeof pad.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        pad.setPointerCapture(event.pointerId);
      } catch {
        // Capture is best effort on degraded hosts.
      }
    }
    if (pointers.size === 2) {
      clearPinchTimer();
      grabbed = false;
      const [a, b] = [...pointers.values()];
      twoHand = {
        spread: Math.hypot(b.x - a.x, b.y - a.y),
        skew: b.y - a.y,
      };
      noteSample({ x: a.x, y: a.y, depth: depthAxis, twoHand: true, spread: twoHand.spread, skew: twoHand.skew }, "pad-two-hand");
      return;
    }
    if (pointers.size === 1) {
      twoHand = null;
      startPinchTimer(point);
      noteSample({ x: point.x, y: point.y, depth: depthAxis, mode: "open" }, "pad-touch");
    }
  }

  function onPadMove(event) {
    if (!event) return;
    const key = event.pointerId ?? [...pointers.keys()][0];
    if (!pointers.has(key)) return;
    const point = normalizePoint(event.clientX, event.clientY);
    const previous = pointers.get(key);
    pointers.set(key, { x: point.x, y: point.y });
    if (pinchStart && Math.hypot(point.x - pinchStart.x, point.y - pinchStart.y) * padRect().width > 10) {
      clearPinchTimer();
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const spread = Math.hypot(b.x - a.x, b.y - a.y);
      const skew = b.y - a.y;
      noteSample({ x: a.x, y: a.y, depth: depthAxis, twoHand: true, spread, skew }, "pad-two-hand");
      twoHand = { spread, skew };
      return;
    }
    if (grabbed) {
      noteSample({ x: point.x, y: point.y, depth: depthAxis, mode: "pinch" }, "pad-drag");
    } else {
      const moved = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (moved > 0.001) {
        noteSample({ x: point.x, y: point.y, depth: depthAxis, mode: "open" }, "pad-move");
      }
    }
  }

  function onPadUp(event) {
    const key = event?.pointerId ?? [...pointers.keys()][0];
    clearPinchTimer();
    pointers.delete(key);
    if (typeof pad.releasePointerCapture === "function" && event?.pointerId !== undefined) {
      try {
        pad.releasePointerCapture(event.pointerId);
      } catch {
        // Release is best effort on degraded hosts.
      }
    }
    if (pointers.size < 2) twoHand = null;
    if (grabbed && pointers.size === 0) {
      grabbed = false;
      const state = studio.getSnapshot();
      // Pointer release after a grab = fist release / detach.
      noteDirectFrame(
        { at: Date.now(), hands: [syntheticHand({ x: state.pose.x, y: state.pose.y, z: state.pose.z }, "fist")] },
        "pad-release"
      );
    }
    pinchStart = null;
  }

  function onPadWheel(event) {
    if (!event || !grabbed) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    const delta = Number(event.deltaY) || 0;
    // Wheel up (negative deltaY) pushes away; wheel down pulls toward viewer.
    depthAxis = Math.min(1, Math.max(-1, depthAxis + (delta > 0 ? GESTURE_LENS_WHEEL_DEPTH_STEP : -GESTURE_LENS_WHEEL_DEPTH_STEP)));
    const state = studio.getSnapshot();
    noteSample({ x: state.pose.x, y: state.pose.y, depth: depthAxis, mode: "pinch" }, "pad-depth");
  }

  // ---- gesture buttons: every intent is keyboard/voice operable ----
  function grabAt(method) {
    const state = studio.getSnapshot();
    grabbed = true;
    return noteSample({ x: state.pose.x, y: state.pose.y, depth: depthAxis, mode: "pinch" }, method);
  }

  function releaseAt(method) {
    grabbed = false;
    depthAxis = 0;
    const state = studio.getSnapshot();
    return noteDirectFrame(
      { at: Date.now(), hands: [syntheticHand({ x: state.pose.x, y: state.pose.y, z: state.pose.z }, "fist")] },
      method
    );
  }

  function twoHandStep(spreadFrom, spreadTo, skewFrom, skewTo, method) {
    const state = studio.getSnapshot();
    noteSample(
      { x: state.pose.x, y: state.pose.y, depth: depthAxis, twoHand: true, spread: spreadFrom, skew: skewFrom },
      `${method}-from`
    );
    return noteSample(
      { x: state.pose.x, y: state.pose.y, depth: depthAxis, twoHand: true, spread: spreadTo, skew: skewTo },
      method
    );
  }

  function depthStep(direction, method) {
    const state = studio.getSnapshot();
    if (!grabbed) grabAt(`${method}-grab`);
    depthAxis = Math.min(1, Math.max(-1, depthAxis + direction * GESTURE_LENS_WHEEL_DEPTH_STEP * 2));
    const after = studio.getSnapshot();
    return noteSample({ x: after.pose.x, y: after.pose.y, depth: depthAxis, mode: "pinch" }, method);
  }

  toggleButton.addEventListener("click", () => {
    void setCameraEnabled(cameraState !== "preview", "toggle");
  });
  previewClose.addEventListener("click", () => {
    void setCameraEnabled(false, "preview-close");
  });
  closeButton.addEventListener("click", () => setOpen(false, "close"));
  pad.addEventListener("pointerdown", onPadDown);
  pad.addEventListener("pointermove", onPadMove);
  pad.addEventListener("pointerup", onPadUp);
  pad.addEventListener("pointercancel", onPadUp);
  pad.addEventListener("wheel", onPadWheel, { passive: false });
  grabButton.addEventListener("click", () => grabAt("button-grab"));
  releaseButton.addEventListener("click", () => releaseAt("button-release"));
  scaleUpButton.addEventListener("click", () => twoHandStep(0.15, 0.3, 0, 0, "button-scale-up"));
  scaleDownButton.addEventListener("click", () => twoHandStep(0.3, 0.15, 0, 0, "button-scale-down"));
  twistLeftButton.addEventListener("click", () => twoHandStep(0.2, 0.2, 0, -0.35, "button-twist-left"));
  twistRightButton.addEventListener("click", () => twoHandStep(0.2, 0.2, 0, 0.35, "button-twist-right"));
  depthPushButton.addEventListener("click", () => depthStep(-1, "button-depth-push"));
  depthPullButton.addEventListener("click", () => depthStep(1, "button-depth-pull"));
  resetButton.addEventListener("click", () => {
    grabbed = false;
    depthAxis = 0;
    studio.reset();
    render();
    publish("reset", "button");
  });
  documentRoot.addEventListener?.("keydown", (event) => {
    if (event?.key === "Escape" && opened) setOpen(false, "escape");
  });

  render();
  setOpen(opened, "initial");

  return Object.freeze({
    open: (method = "open") => setOpen(true, method),
    close: (method = "close") => setOpen(false, method),
    replay: (method = "replay") => publish("replay", method),
    reset: (method = "api") => {
      grabbed = false;
      depthAxis = 0;
      studio.reset();
      render();
      return publish("reset", method);
    },
    setCameraEnabled,
    getCameraState: () => cameraState,
    simulateFrame: (frame, method = "simulate") => noteDirectFrame(frame, method),
    getSnapshot: () => snapshot("read", "api"),
    boundary: GESTURE_LENS_BOUNDARY,
    source: GESTURE_LENS_CONSOLE_SOURCE,
  });
}

export default createGestureLensConsole;
