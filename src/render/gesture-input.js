/**
 * Capability-aware local gesture input.
 *
 * This bridge deliberately treats touch/pointer input as the phone fallback
 * and only exposes gaze or XR hand tracking when a host explicitly provides a
 * supported tracker/session. It emits bounded pose metadata to the host; it
 * never receives raw camera imagery, identity data, or a block-edit command.
 */

export const GESTURE_INPUT_SOURCE = "local-gesture-input";
export const GESTURE_BOUNDARY = "TOUCH / POINTER FALLBACK · OPTIONAL ORIENTATION / XR HAND TRACKING · NATIVE HAND HOST ONLY WHEN EXPLICITLY ENABLED · GAZE ONLY WHEN A SUPPORTED HOST TRACKER EXISTS · COARSE GRAB / HOLD / PLACE SIGNALS ONLY REACH A FRESH GAZE-LOCKED LOCAL DRAFT · NO RAW CAMERA DATA, IDENTITY, RECORDING, UPLOAD, NETWORK, STORAGE, OR CAMERA-DRIVEN CUBE EDITS";
export const HAND_CALIBRATION_SOURCE = "local-hand-calibration";
export const HAND_CALIBRATION_BOUNDARY = "EXPLICIT HAND / FINGER CALIBRATION · SANITIZED PINCH OR XR-HAND SELECT ONLY · NO RAW FRAMES, LANDMARKS, IDENTITY, RECORDING, UPLOAD, NETWORK, STORAGE, OR CUBE EDITS";

// These hooks are intentionally host seams rather than browser camera APIs.
// The native alias is the documented name; the shorter name keeps the bridge
// easy to embed in an existing shell. Both hooks must expose `supported:true`
// and a `start()` method before they can be considered available.
export const NATIVE_HAND_TRACKER_HOOK = "__TUMBO_NATIVE_HAND_TRACKER__";
export const HAND_TRACKER_HOOK = "__TUMBO_HAND_TRACKER__";
// `inspect` is an intentionally narrow, semantic action. Hosts may report it
// only as a coarse gesture name. Carry actions are also explicit names; their
// optional hold delta is accepted only as three bounded integer grid steps
// below. No hand landmarks, frames, or arbitrary action payloads are accepted
// by this bridge.
const NATIVE_HAND_GESTURES = new Set(["pinch", "point", "open", "inspect", "grab", "hold", "place", "release"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  if (!isRecord(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

export function clamp(value, minimum = -1, maximum = 1) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(minimum, value));
}

function capabilityState(value) {
  return value === true ? "available" : value === false ? "unavailable" : String(value ?? "unavailable");
}

function gazeTracker() {
  const tracker = globalThis.__TUMBO_GAZE_TRACKER__;
  return tracker?.supported === true && typeof tracker.start === "function"
    ? tracker
    : null;
}

function nativeHandTracker() {
  const tracker = globalThis[NATIVE_HAND_TRACKER_HOOK] ?? globalThis[HAND_TRACKER_HOOK];
  return tracker?.supported === true && typeof tracker.start === "function"
    ? tracker
    : null;
}

function nativeHandGestureKind(sample) {
  if (!isRecord(sample)) return null;
  const candidate = sample.gesture ?? sample.kind ?? sample.action ?? sample.type;
  if (typeof candidate !== "string") return null;
  const kind = candidate.trim().toLowerCase();
  return NATIVE_HAND_GESTURES.has(kind) ? kind : null;
}

function sanitizeCarryDelta(sample) {
  const candidate = sample?.holdDelta ?? sample?.gridDelta ?? sample?.delta;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const values = [candidate.dx, candidate.dy, candidate.dz].map((value) => Number(value));
  if (!values.every((value) => Number.isInteger(value) && Math.abs(value) <= 1)) return null;
  if (values.every((value) => value === 0)) return { dx: 0, dy: 0, dz: 0 };
  return { dx: values[0], dy: values[1], dz: values[2] };
}

function carryDeltaProvided(sample) {
  if (!sample || typeof sample !== "object") return false;
  return ["holdDelta", "gridDelta", "delta"].some((key) => Object.prototype.hasOwnProperty.call(sample, key));
}

/**
 * Accept only the tiny native-host contract. In particular, do not spread or
 * retain the host object: a host may have camera frames, joints, or identity
 * fields attached, but none of those are allowed into the renderer event.
 */
function sanitizeNativeHandSample(sample) {
  const gesture = nativeHandGestureKind(sample);
  if (!gesture) return null;
  const rawX = sample.x ?? sample.normalizedX;
  const rawY = sample.y ?? sample.normalizedY;
  const x = Number(rawX);
  const y = Number(rawY);
  const dx = Number(sample.dx ?? sample.deltaX);
  const dy = Number(sample.dy ?? sample.deltaY);
  return {
    gesture,
    // Keep absence distinct from the bounded zero pose. A hand host that
    // reports only a coarse pinch/open/inspect gesture must be able to reuse
    // the renderer's fresh gaze point instead of accidentally targeting the
    // centre of the viewport.
    pointProvided: Number.isFinite(x) && Number.isFinite(y),
    pose: pointerPose({ x, y, dx, dy, pointerType: "native-hand" }),
    holdDelta: gesture === "hold" ? sanitizeCarryDelta(sample) : null,
    holdDeltaProvided: gesture === "hold" ? carryDeltaProvided(sample) : false,
  };
}

function readCapabilities() {
  const orientation = globalThis.DeviceOrientationEvent;
  const xr = globalThis.navigator?.xr;
  return {
    touchPointer: "available",
    orientation: capabilityState(Boolean(orientation && typeof globalThis.addEventListener === "function")),
    gaze: gazeTracker() ? "available" : "unavailable",
    nativeHand: nativeHandTracker() ? "unrequested" : "unavailable",
    webxr: capabilityState(Boolean(xr && typeof xr.requestSession === "function")),
    handTracking: xr && typeof xr.requestSession === "function" ? "unrequested" : "unavailable",
  };
}

function pointerPose({ x = 0, y = 0, dx = 0, dy = 0, pointerType = "pointer" } = {}) {
  const safeX = clamp(x);
  const safeY = clamp(y);
  const safeDx = clamp(dx);
  const safeDy = clamp(dy);
  return {
    x: safeX,
    y: safeY,
    dx: safeDx,
    dy: safeDy,
    magnitude: clamp(Math.hypot(safeDx, safeDy), 0, 1),
    pointerType: String(pointerType || "pointer").slice(0, 32),
  };
}

function orientationPose(event) {
  // Device orientation is a coarse viewpoint hint, not an eye/hand signal.
  const gamma = Number(event?.gamma);
  const beta = Number(event?.beta);
  return pointerPose({
    dx: clamp(Number.isFinite(gamma) ? gamma / 45 : 0),
    dy: clamp(Number.isFinite(beta) ? (beta - 45) / 45 : 0),
    pointerType: "orientation",
  });
}

function xrPose(inputSource) {
  return pointerPose({
    dx: clamp(Number(inputSource?.gamepad?.axes?.[0]) || 0),
    dy: clamp(Number(inputSource?.gamepad?.axes?.[1]) || 0),
    pointerType: inputSource?.hand ? `xr-hand-${inputSource.handedness || "unknown"}` : "xr-pointer",
  });
}

/**
 * Mount the local gesture controls. Permission-bearing sensors are requested
 * only from enable(), which is bound to an explicit user button by default.
 */
export function createGestureInput({
  documentRoot = globalThis.document,
  onGesture = null,
  onStatus = null,
  requestImmersive = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Gesture input needs a document-like owner");
  const panel = documentRoot.getElementById("gesture-input-panel");
  const openButton = documentRoot.getElementById("gesture-input-open");
  const closeButton = documentRoot.getElementById("gesture-input-close");
  const toggleButton = documentRoot.getElementById("gesture-input-toggle");
  const resetButton = documentRoot.getElementById("gesture-input-reset");
  const stopButton = documentRoot.getElementById("gesture-input-stop");
  const calibrationButton = documentRoot.getElementById("gesture-input-calibrate");
  const statusEl = documentRoot.getElementById("gesture-input-status");
  const capabilitiesEl = documentRoot.getElementById("gesture-input-capabilities");
  const modeEl = documentRoot.getElementById("gesture-input-mode");
  const calibrationStatusEl = documentRoot.getElementById("gesture-input-calibration-status");
  const samplesEl = documentRoot.getElementById("gesture-input-samples");
  const pad = documentRoot.getElementById("gesture-input-pad");
  if (!panel || !toggleButton || !statusEl || !capabilitiesEl || !pad) {
    throw new Error("Gesture input mount points are missing");
  }

  let opened = panel.hidden !== true;
  let active = false;
  let status = "off";
  let mode = "touch-pointer";
  let samples = 0;
  let previousPointer = null;
  let orientationListening = false;
  let xrSession = null;
  let gazeActive = false;
  let nativeHandActive = false;
  let nativeHandStarting = false;
  let nativeHandStop = null;
  let lastNativeHandGesture = null;
  let pointProvided = false;
  let couplingStatus = "GAZE + HAND OFF · LOOK THEN PINCH";
  let capabilities = readCapabilities();
  let pose = pointerPose({ pointerType: "touch-pointer" });
  let calibration = {
    source: HAND_CALIBRATION_SOURCE,
    status: "idle",
    inputSource: null,
    gesture: null,
    sampleCount: 0,
    localOnly: true,
    simulation: true,
    biometric: false,
    landmarks: false,
    recording: false,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    cameraDrivenBlockEdits: false,
    boundary: HAND_CALIBRATION_BOUNDARY,
  };
  let calibrationDetail = "HAND CALIBRATION OFF · ENABLE GESTURES FIRST";

  function statusCopy(nextStatus) {
    return ({
      off: "GESTURES OFF · TOUCH / POINTER FALLBACK READY",
      requesting: "REQUESTING OPTIONAL SENSOR CAPABILITIES · LOCAL ONLY",
      active: "GESTURES ACTIVE · COARSE VIEWPOINT ONLY · NO CUBE EDITS",
      partial: "GESTURE FALLBACK ACTIVE · OPTIONAL SENSOR UNAVAILABLE",
      denied: "SENSOR PERMISSION DENIED · TOUCH / POINTER FALLBACK READY",
      unavailable: "OPTIONAL GESTURE SENSORS UNAVAILABLE · TOUCH / POINTER READY",
      error: "GESTURE INPUT ERROR · TOUCH / POINTER FALLBACK READY",
    }[nextStatus] ?? "GESTURE INPUT OFF");
  }

  function renderCapabilities() {
    const labels = [
      ["touch-pointer", "TOUCH / POINTER", capabilities.touchPointer],
      ["orientation", "ORIENTATION", capabilities.orientation],
      ["gaze", "GAZE", capabilities.gaze],
      ["native-hand", "NATIVE HAND HOST", capabilities.nativeHand],
      ["handTracking", "XR HAND TRACKING", capabilities.handTracking],
    ];
    capabilitiesEl.replaceChildren();
    labels.forEach(([id, label, value]) => {
      const item = documentRoot.createElement("span");
      item.dataset.gestureCapability = id;
      item.textContent = `${label} · ${String(value).toUpperCase()}`;
      capabilitiesEl.appendChild(item);
    });
  }

  function snapshot() {
    return deepFreeze({
      source: GESTURE_INPUT_SOURCE,
      status,
      active,
      opened,
      mode,
      samples,
      capabilities: { ...capabilities },
      pose: { ...pose },
      pointProvided,
      couplingStatus,
      calibration: { ...calibration },
      handCalibration: { ...calibration },
      boundary: GESTURE_BOUNDARY,
      simulation: true,
      localOnly: true,
      motionOnly: true,
      biometric: false,
      landmarks: false,
      recording: false,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      cameraDrivenBlockEdits: false,
      gesture: lastNativeHandGesture,
      nativeHandGesture: lastNativeHandGesture,
    });
  }

  function publishStatus(nextStatus, detail) {
    status = nextStatus;
    const copy = detail ?? statusCopy(nextStatus);
    statusEl.textContent = copy;
    if (modeEl) modeEl.textContent = `MODE · ${mode.toUpperCase()}`;
    toggleButton.textContent = active ? "Pause gesture input" : "Enable phone gestures";
    stopButton?.toggleAttribute?.("hidden", !active);
    renderCapabilities();
    onStatus?.(deepFreeze({ ...snapshot(), status, statusText: copy }));
  }

  function setCouplingStatus(nextStatus, metadata = {}) {
    couplingStatus = String(nextStatus || "GAZE + HAND OFF · LOOK THEN PINCH").slice(0, 180);
    const couplingEl = documentRoot.getElementById("gesture-input-coupling-status");
    if (couplingEl) {
      couplingEl.textContent = couplingStatus;
      couplingEl.dataset.couplingState = String(metadata?.state ?? "info");
    }
    return snapshot();
  }

  function handCapabilityReady() {
    return capabilities.nativeHand === "active" || capabilities.handTracking === "active";
  }

  function renderCalibration() {
    if (calibrationStatusEl) {
      calibrationStatusEl.textContent = calibrationDetail;
      calibrationStatusEl.dataset.calibrationState = calibration.status;
    }
    if (calibrationButton) {
      calibrationButton.textContent = calibration.status === "waiting"
        ? "Cancel hand calibration"
        : calibration.status === "complete"
          ? "Calibrate hand / finger again"
          : "Calibrate hand / finger";
      calibrationButton.setAttribute("aria-busy", String(calibration.status === "waiting"));
    }
  }

  function setCalibration(nextStatus, detail, metadata = {}, method = "status") {
    calibration = deepFreeze({
      ...calibration,
      status: nextStatus,
      inputSource: metadata.inputSource ?? (nextStatus === "idle" || nextStatus === "unavailable" ? null : calibration.inputSource),
      gesture: metadata.gesture ?? (nextStatus === "idle" || nextStatus === "unavailable" ? null : calibration.gesture),
      sampleCount: Number.isFinite(metadata.sampleCount)
        ? Math.max(0, Math.floor(metadata.sampleCount))
        : nextStatus === "complete" ? 1 : nextStatus === "waiting" ? 0 : calibration.sampleCount,
    });
    calibrationDetail = String(detail || "HAND CALIBRATION STATUS UNAVAILABLE").slice(0, 180);
    renderCalibration();
    onStatus?.(deepFreeze({ ...snapshot(), calibrationMethod: method, calibrationStatus: calibrationDetail }));
    return snapshot();
  }

  function calibrateHand(method = "button") {
    if (!active) return setCalibration("unavailable", "HAND CALIBRATION UNAVAILABLE · ENABLE PHONE GESTURES FIRST", {}, method);
    if (!handCapabilityReady()) {
      return setCalibration("unavailable", "HAND CALIBRATION UNAVAILABLE · SUPPORTED HAND HOST NOT PRESENT", {}, method);
    }
    if (calibration.status === "waiting") {
      return setCalibration("ready", "HAND CALIBRATION CANCELLED · PRESS AGAIN TO WAIT FOR PINCH / SELECT", {}, method);
    }
    return setCalibration("waiting", "HAND CALIBRATION WAITING · SHOW ONE PINCH / XR-HAND SELECT", {
      inputSource: null,
      gesture: null,
      sampleCount: 0,
    }, method);
  }

  function acceptCalibrationSignal(inputSource, gesture) {
    if (calibration.status !== "waiting") return;
    const source = String(inputSource || "");
    const kind = String(gesture || "").toLowerCase();
    if (!((source === "native-hand" && kind === "pinch") || (source === "xr-hand" && kind === "select"))) return;
    setCalibration("complete", `HAND CALIBRATION COMPLETE · ${source === "native-hand" ? "PINCH" : "XR-HAND SELECT"} ACCEPTED · COARSE INPUT ONLY`, {
      inputSource: source,
      gesture: kind,
      sampleCount: 1,
    }, "sensor-signal");
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.setAttribute("aria-hidden", String(!opened));
    openButton?.setAttribute("aria-expanded", String(opened));
    if (opened && method === "open") toggleButton.focus?.({ preventScroll: true });
  }

  function emitPose(nextPose, source = "touch-pointer", gestureKind = null, metadata = {}) {
    pose = pointerPose({ ...nextPose, pointerType: source });
    pointProvided = metadata?.pointProvided !== false;
    lastNativeHandGesture = source === "native-hand" && gestureKind ? gestureKind : null;
    if (!active) return snapshot();
    samples += 1;
    if (samplesEl) samplesEl.textContent = String(samples);
    const event = deepFreeze({
      ...snapshot(),
      action: "gesture",
      source: GESTURE_INPUT_SOURCE,
      inputSource: source,
      gesture: gestureKind,
      nativeHandGesture: gestureKind,
      pose: { ...pose },
      pointProvided,
      holdDelta: metadata?.holdDelta ?? null,
      holdDeltaProvided: metadata?.holdDeltaProvided === true,
      sample: samples,
    });
    onGesture?.(event);
    acceptCalibrationSignal(source, gestureKind);
    return event;
  }

  function notePointer(event) {
    if (!active || !event || typeof pad.getBoundingClientRect !== "function") return snapshot();
    const rect = pad.getBoundingClientRect();
    if (!rect.width || !rect.height) return snapshot();
    const x = clamp(((Number(event.clientX) - rect.left) / rect.width) * 2 - 1);
    const y = clamp(-(((Number(event.clientY) - rect.top) / rect.height) * 2 - 1));
    const dx = previousPointer ? clamp((x - previousPointer.x) * 2) : 0;
    const dy = previousPointer ? clamp((y - previousPointer.y) * 2) : 0;
    previousPointer = { x, y };
    return emitPose({ x, y, dx, dy }, event.pointerType || "touch-pointer");
  }

  function onOrientation(event) {
    const next = orientationPose(event);
    emitPose(next, "orientation");
  }

  function onXRSelect(event) {
    const input = event?.inputSource;
    const source = input?.hand ? "xr-hand" : "xr-pointer";
    // XR hand select is a coarse activation signal, not a screen point. Keep
    // pointProvided false so the renderer can deliberately reuse the fresh
    // gaze lock instead of treating the default XR pose as viewport centre.
    emitPose(xrPose(input), source, input?.hand ? "select" : null, {
      pointProvided: input?.hand ? false : true,
    });
  }

  function onGazeSample(sample) {
    if (!active) return;
    const rawX = sample?.x ?? sample?.normalizedX;
    const rawY = sample?.y ?? sample?.normalizedY;
    const x = Number(rawX);
    const y = Number(rawY);
    const dx = Number(sample?.dx ?? sample?.deltaX);
    const dy = Number(sample?.dy ?? sample?.deltaY);
    emitPose({ x, y, dx, dy }, "host-gaze", null, {
      pointProvided: Number.isFinite(x) && Number.isFinite(y),
    });
  }

  function onNativeHandSample(sample) {
    if (!active || !(nativeHandActive || nativeHandStarting)) return;
    const safe = sanitizeNativeHandSample(sample);
    if (!safe) return;
    emitPose(safe.pose, "native-hand", safe.gesture, {
      pointProvided: safe.pointProvided,
      holdDelta: safe.holdDelta,
      holdDeltaProvided: safe.holdDeltaProvided,
    });
  }

  async function requestOrientation() {
    const ctor = globalThis.DeviceOrientationEvent;
    if (!ctor || typeof globalThis.addEventListener !== "function") return "unavailable";
    if (typeof ctor.requestPermission === "function") {
      try {
        const permission = await ctor.requestPermission();
        if (permission !== "granted") return "denied";
      } catch {
        return "denied";
      }
    }
    globalThis.addEventListener("deviceorientation", onOrientation, { passive: true });
    orientationListening = true;
    return "active";
  }

  async function requestXRHandTracking() {
    if (requestImmersive) {
      const shared = await requestImmersive();
      capabilities = { ...capabilities, webxr: shared ? "available" : "unavailable", handTracking: shared ? "unrequested" : "unavailable" };
      // Shared scene owns XR input and lifecycle, never open a second session.
      return shared ? "active" : "unavailable";
    }
    const xr = globalThis.navigator?.xr;
    if (!xr || typeof xr.requestSession !== "function") {
      capabilities = { ...capabilities, webxr: "unavailable", handTracking: "unavailable" };
      return "unavailable";
    }
    try {
      if (typeof xr.isSessionSupported === "function" && !(await xr.isSessionSupported("immersive-ar"))) {
        capabilities = { ...capabilities, webxr: "unavailable", handTracking: "unavailable" };
        return "unavailable";
      }
      const session = await xr.requestSession("immersive-ar", {
        requiredFeatures: [],
        optionalFeatures: ["hand-tracking"],
      });
      xrSession = session;
      session.addEventListener?.("select", onXRSelect);
      session.addEventListener?.("end", () => {
        xrSession = null;
        capabilities = { ...capabilities, handTracking: "ended" };
        if (active && !gazeActive) publishStatus("partial");
      }, { once: true });
      const enabledFeatures = Array.from(session.enabledFeatures ?? []);
      const handAvailable = enabledFeatures.includes("hand-tracking")
        || Array.from(session.inputSources ?? []).some((input) => Boolean(input?.hand));
      capabilities = { ...capabilities, webxr: "available", handTracking: handAvailable ? "active" : "unavailable" };
      if (!handAvailable) {
        await session.end?.();
        xrSession = null;
        return "unavailable";
      }
      return "active";
    } catch (error) {
      capabilities = {
        ...capabilities,
        webxr: "error",
        handTracking: error?.name === "NotAllowedError" ? "denied" : "error",
      };
      return capabilities.handTracking;
    }
  }

  async function requestGaze() {
    const tracker = gazeTracker();
    if (!tracker) {
      capabilities = { ...capabilities, gaze: "unavailable" };
      return "unavailable";
    }
    try {
      await tracker.start({ onSample: onGazeSample });
      gazeActive = true;
      capabilities = { ...capabilities, gaze: "active" };
      return "active";
    } catch (error) {
      capabilities = { ...capabilities, gaze: error?.name === "NotAllowedError" ? "denied" : "error" };
      return capabilities.gaze;
    }
  }

  async function requestNativeHand() {
    const tracker = nativeHandTracker();
    if (!tracker) {
      capabilities = { ...capabilities, nativeHand: "unavailable" };
      return "unavailable";
    }
    nativeHandStarting = true;
    try {
      const handle = await tracker.start({
        mode: "coarse-gesture",
        onGesture: onNativeHandSample,
        onSample: onNativeHandSample,
      });
      if (handle === false) {
        capabilities = { ...capabilities, nativeHand: "unavailable" };
        return "unavailable";
      }
      nativeHandStop = typeof handle === "function"
        ? handle
        : typeof handle?.stop === "function"
          ? () => handle.stop()
          : null;
      nativeHandActive = true;
      capabilities = { ...capabilities, nativeHand: "active" };
      return "active";
    } catch (error) {
      capabilities = {
        ...capabilities,
        nativeHand: error?.name === "NotAllowedError" ? "denied" : "error",
      };
      return capabilities.nativeHand;
    } finally {
      nativeHandStarting = false;
    }
  }

  function releaseOptionalInputs() {
    if (orientationListening) globalThis.removeEventListener?.("deviceorientation", onOrientation);
    orientationListening = false;
    if (xrSession) {
      xrSession.removeEventListener?.("select", onXRSelect);
      void xrSession.end?.();
      xrSession = null;
    }
    const tracker = gazeTracker();
    if (gazeActive) void tracker?.stop?.();
    gazeActive = false;
    if (nativeHandActive || nativeHandStop) {
      const tracker = nativeHandTracker();
      try {
        if (nativeHandStop) void nativeHandStop();
        else void tracker?.stop?.();
      } catch {
        // Host cleanup is best effort; the renderer keeps no native handle.
      }
    }
    nativeHandStop = null;
    nativeHandActive = false;
    nativeHandStarting = false;
    capabilities = {
      ...capabilities,
      nativeHand: nativeHandTracker() ? "unrequested" : "unavailable",
    };
  }

  function reset(method = "button") {
    pose = pointerPose({ pointerType: "touch-pointer" });
    previousPointer = null;
    samples = 0;
    lastNativeHandGesture = null;
    pointProvided = false;
    calibration = deepFreeze({
      ...calibration,
      status: active && handCapabilityReady() ? "ready" : "idle",
      inputSource: null,
      gesture: null,
      sampleCount: 0,
    });
    calibrationDetail = active && handCapabilityReady()
      ? "HAND CALIBRATION READY · PRESS CALIBRATE, THEN SHOW PINCH / XR-HAND SELECT"
      : "HAND CALIBRATION OFF · ENABLE GESTURES FIRST";
    if (samplesEl) samplesEl.textContent = "0";
    onGesture?.(deepFreeze({
      ...snapshot(),
      action: "reset",
      method,
      source: GESTURE_INPUT_SOURCE,
      pose: { ...pose },
    }));
    publishStatus(active ? status : "off");
    renderCalibration();
    return snapshot();
  }

  function disable(method = "button") {
    releaseOptionalInputs();
    active = false;
    mode = "touch-pointer";
    reset(method);
    publishStatus("off");
    return snapshot();
  }

  async function enable(method = "button") {
    if (active) return snapshot();
    active = true;
    mode = "touch-pointer";
    publishStatus("requesting");
    const [orientationResult, handResult, gazeResult, nativeHandResult] = await Promise.all([
      requestOrientation(),
      requestXRHandTracking(),
      requestGaze(),
      requestNativeHand(),
    ]);
    if (gazeResult === "active") mode = "host-gaze";
    else if (nativeHandResult === "active") mode = "native-hand";
    else if (handResult === "active") mode = "xr-hand";
    else if (orientationResult === "active") mode = "orientation";
    else mode = "touch-pointer";
    const optionalDenied = [orientationResult, handResult, gazeResult, nativeHandResult].some((result) => ["denied", "error"].includes(result));
    const optionalActive = [orientationResult, handResult, gazeResult, nativeHandResult].some((result) => result === "active");
    calibration = deepFreeze({
      ...calibration,
      status: handCapabilityReady() ? "ready" : "unavailable",
      inputSource: null,
      gesture: null,
      sampleCount: 0,
    });
    calibrationDetail = handCapabilityReady()
      ? "HAND CALIBRATION READY · PRESS CALIBRATE, THEN SHOW PINCH / XR-HAND SELECT"
      : "HAND CALIBRATION UNAVAILABLE · SUPPORTED HAND HOST NOT PRESENT";
    publishStatus(optionalDenied && !optionalActive ? "denied" : optionalActive ? "active" : "partial");
    renderCalibration();
    onStatus?.(deepFreeze({ ...snapshot(), method }));
    return snapshot();
  }

  pad.addEventListener("pointerdown", (event) => {
    previousPointer = null;
    pad.setPointerCapture?.(event.pointerId);
    notePointer(event);
  });
  pad.addEventListener("pointermove", notePointer);
  pad.addEventListener("pointerup", (event) => {
    notePointer(event);
    previousPointer = null;
    pad.releasePointerCapture?.(event.pointerId);
  });
  pad.addEventListener("pointercancel", () => { previousPointer = null; });
  openButton?.addEventListener("click", () => setOpen(true, "open"));
  closeButton?.addEventListener("click", () => setOpen(false, "close"));
  toggleButton.addEventListener("click", () => (active ? disable("toggle") : enable("button")));
  stopButton?.addEventListener("click", () => disable("stop"));
  resetButton?.addEventListener("click", () => reset("button"));
  calibrationButton?.addEventListener("click", () => calibrateHand("button"));
  documentRoot.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false, "escape");
  });

  renderCapabilities();
  renderCalibration();
  publishStatus("off");
  setOpen(opened, "initial");

  return Object.freeze({
    open: () => setOpen(true, "open"),
    close: () => setOpen(false, "close"),
    enable,
    disable,
    toggle: () => (active ? disable("toggle") : enable("toggle")),
    reset,
    calibrateHand,
    setCouplingStatus,
    notePointer,
    getSnapshot: snapshot,
    destroy: () => disable("destroy"),
  });
}

export default createGestureInput;
