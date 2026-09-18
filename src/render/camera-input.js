/**
 * Optional local camera-motion input.
 *
 * The adapter asks for a video stream only after an explicit button press.
 * It reduces frames to a tiny luminance grid, emits coarse motion, and then
 * releases the stream when disabled. No frame, image, face, or identity is
 * retained or sent anywhere.
 */

export const CAMERA_INPUT_SOURCE = "local-camera-motion";
export const CAMERA_INPUT_WIDTH = 48;
export const CAMERA_INPUT_HEIGHT = 36;
export const CAMERA_INPUT_THRESHOLD = 18;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function freezeSnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeSnapshot(entry)));
  if (!isRecord(value)) return value;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeSnapshot(entry)])),
  );
}

export function clamp(value, minimum = -1, maximum = 1) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Estimate normalized motion from two RGBA frames. The output is bounded to
 * [-1, 1] and is deterministic for identical frame buffers.
 */
export function estimateMotion(
  previousFrame,
  currentFrame,
  width = CAMERA_INPUT_WIDTH,
  height = CAMERA_INPUT_HEIGHT,
  threshold = CAMERA_INPUT_THRESHOLD,
) {
  const pixelCount = width * height;
  const validFrames = previousFrame && currentFrame
    && previousFrame.length >= pixelCount * 4
    && currentFrame.length >= pixelCount * 4
    && Number.isInteger(width) && width > 0
    && Number.isInteger(height) && height > 0;
  if (!validFrames) {
    return freezeSnapshot({
      dx: 0,
      dy: 0,
      magnitude: 0,
      samples: 0,
      simulation: true,
      localOnly: true,
      biometric: false,
      recording: false,
      externalNetwork: false,
      externalTransfer: false,
    });
  }

  const safeThreshold = Number.isFinite(threshold) ? Math.max(0, threshold) : CAMERA_INPUT_THRESHOLD;
  // Use the signed luminance delta for direction.  An absolute-difference
  // centroid makes a translating feature cancel itself out (the old pixel
  // disappears and the new pixel appears with equal weight), which leaves
  // the camera apparently active while producing no orbit input.  A signed
  // moment keeps that coarse left/right and up/down direction without
  // retaining a frame or attempting recognition.
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const previous = (previousFrame[offset] * 0.299)
        + (previousFrame[offset + 1] * 0.587)
        + (previousFrame[offset + 2] * 0.114);
      const current = (currentFrame[offset] * 0.299)
        + (currentFrame[offset + 1] * 0.587)
        + (currentFrame[offset + 2] * 0.114);
      const signedDelta = current - previous;
      const delta = Math.abs(signedDelta);
      if (delta <= safeThreshold) continue;
      const weight = delta - safeThreshold;
      const direction = signedDelta < 0 ? -1 : 1;
      weightedX += ((x / Math.max(1, width - 1)) * 2 - 1) * weight * direction;
      weightedY += ((y / Math.max(1, height - 1)) * 2 - 1) * weight * direction;
      totalWeight += weight;
      samples += 1;
    }
  }

  if (totalWeight <= 0) {
    return freezeSnapshot({
      dx: 0,
      dy: 0,
      magnitude: 0,
      samples: 0,
      simulation: true,
      localOnly: true,
      biometric: false,
      recording: false,
      externalNetwork: false,
      externalTransfer: false,
    });
  }

  const dx = clamp(weightedX / totalWeight);
  const dy = clamp(weightedY / totalWeight);
  return freezeSnapshot({
    dx,
    dy,
    magnitude: clamp(Math.hypot(dx, dy), 0, 1),
    samples,
    simulation: true,
    localOnly: true,
    biometric: false,
    recording: false,
    externalNetwork: false,
    externalTransfer: false,
  });
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = String(value ?? "");
  return element;
}

function streamTracks(stream) {
  return typeof stream?.getTracks === "function" ? stream.getTracks() : [];
}

/**
 * Mount the optional camera control panel. The host owns camera movement and
 * receives only frozen coarse motion metadata through onMotion.
 */
export function createCameraInput({
  documentRoot = globalThis.document,
  onMotion = null,
  onStatus = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Camera input needs a document-like owner");
  const panel = documentRoot.getElementById("camera-input-panel");
  const openButton = documentRoot.getElementById("camera-input-open");
  const closeButton = documentRoot.getElementById("camera-input-close");
  const toggleButton = documentRoot.getElementById("camera-input-toggle");
  const stopButton = documentRoot.getElementById("camera-input-stop");
  const statusEl = documentRoot.getElementById("camera-input-status");
  const indicatorEl = documentRoot.getElementById("camera-input-indicator");
  const sampleEl = documentRoot.getElementById("camera-input-samples");
  const video = documentRoot.getElementById("camera-input-video");
  if (!panel || !toggleButton || !statusEl || !video) {
    throw new Error("Camera input mount points are missing");
  }

  const canvas = documentRoot.createElement("canvas");
  canvas.width = CAMERA_INPUT_WIDTH;
  canvas.height = CAMERA_INPUT_HEIGHT;
  const context = typeof canvas.getContext === "function"
    ? canvas.getContext("2d", { willReadFrequently: true })
    : null;
  let stream = null;
  let active = false;
  let frameHandle = null;
  let previousFrame = null;
  // Retain only the latest bounded motion vector for local diagnostics and
  // projection composition. The camera frame itself is never retained.
  let lastMotion = null;
  let samples = 0;
  let status = "off";
  let opened = panel.hidden !== true;

  function setStatus(nextStatus, detail) {
    status = nextStatus;
    const copy = detail ?? ({
      off: "CAMERA OFF · MOUSE / TRACKPAD READY",
      requesting: "REQUESTING CAMERA PERMISSION · MOTION ONLY",
      active: "CAMERA MOTION ACTIVE · ORBIT ONLY · NO CUBE EDITS · NO FRAMES STORED",
      unsupported: "CAMERA UNAVAILABLE · MOUSE / TRACKPAD READY",
      denied: "CAMERA PERMISSION DENIED · MOUSE / TRACKPAD READY",
      error: "CAMERA INPUT ERROR · MOUSE / TRACKPAD READY",
    }[nextStatus] ?? "CAMERA INPUT OFF");
    statusEl.textContent = copy;
    if (indicatorEl) indicatorEl.textContent = active ? "CAMERA MOTION ON" : "CAMERA MOTION OFF";
    if (toggleButton) toggleButton.textContent = active ? "Pause camera motion" : "Enable camera motion";
    if (stopButton) stopButton.hidden = !active;
    onStatus?.(freezeSnapshot({
      source: CAMERA_INPUT_SOURCE,
      status: nextStatus,
      active,
      localOnly: true,
      motionOnly: true,
      biometric: false,
      recording: false,
      externalNetwork: false,
      externalTransfer: false,
    }));
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.setAttribute("aria-hidden", String(!opened));
    openButton?.setAttribute("aria-expanded", String(opened));
    if (opened && method === "open") toggleButton.focus({ preventScroll: true });
  }

  function cancelSampling() {
    if (frameHandle !== null && typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(frameHandle);
    if (frameHandle !== null && typeof globalThis.clearTimeout === "function") globalThis.clearTimeout(frameHandle);
    frameHandle = null;
  }

  function releaseStream() {
    streamTracks(stream).forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  }

  function disable(method = "button") {
    cancelSampling();
    releaseStream();
    active = false;
    previousFrame = null;
    lastMotion = null;
    samples = 0;
    if (sampleEl) sampleEl.textContent = "0";
    setStatus("off", method === "permission" ? "CAMERA OFF · PERMISSION NOT GRANTED" : undefined);
    return getSnapshot();
  }

  // Closing the visible consent surface must also stop any active camera
  // stream.  The old behavior only hid the panel, which could leave an
  // approved local motion feed running without an on-screen control.  A
  // close is therefore a real opt-out: cancel sampling, release tracks, and
  // then hide the UI.  Reopening remains safe because it never asks for
  // permission until the viewer explicitly enables motion again.
  function close(method = "close") {
    disable(method);
    setOpen(false, method);
    return getSnapshot();
  }

  function sample() {
    if (!active) return;
    if (context && video.readyState >= 2) {
      context.drawImage(video, 0, 0, CAMERA_INPUT_WIDTH, CAMERA_INPUT_HEIGHT);
      const currentFrame = context.getImageData(0, 0, CAMERA_INPUT_WIDTH, CAMERA_INPUT_HEIGHT).data;
        const motion = estimateMotion(previousFrame, currentFrame);
        previousFrame = currentFrame;
        if (motion.samples > 0 && motion.magnitude > 0.02) {
          lastMotion = freezeSnapshot({
            dx: motion.dx,
            dy: motion.dy,
            magnitude: motion.magnitude,
            samples: motion.samples,
            localOnly: true,
            motionOnly: true,
            biometric: false,
            recording: false,
            externalNetwork: false,
            externalTransfer: false,
          });
          samples += 1;
        if (sampleEl) sampleEl.textContent = String(samples);
        onMotion?.(freezeSnapshot({
          ...motion,
          source: CAMERA_INPUT_SOURCE,
          sample: samples,
          active: true,
          motionOnly: true,
          localOnly: true,
          biometric: false,
          recording: false,
          externalNetwork: false,
          externalTransfer: false,
        }));
      }
    }
    if (typeof globalThis.requestAnimationFrame === "function") {
      frameHandle = globalThis.requestAnimationFrame(sample);
    } else {
      frameHandle = globalThis.setTimeout(sample, 80);
    }
  }

  async function enable(method = "button") {
    if (active) return getSnapshot();
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (typeof mediaDevices?.getUserMedia !== "function") {
      active = false;
      setStatus("unsupported");
      return getSnapshot();
    }
    setStatus("requesting");
    try {
      stream = await mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
        audio: false,
      });
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play?.();
    active = true;
    previousFrame = null;
      lastMotion = null;
      samples = 0;
      if (sampleEl) sampleEl.textContent = "0";
      setStatus("active", "CAMERA MOTION ACTIVE · ORBIT ONLY · NO CUBE EDITS · NO FRAMES STORED OR SENT");
      sample();
    } catch (error) {
      releaseStream();
      active = false;
      setStatus(error?.name === "NotAllowedError" ? "denied" : "error");
    }
    return getSnapshot();
  }

  function getSnapshot() {
    return freezeSnapshot({
      source: CAMERA_INPUT_SOURCE,
      status,
      active,
      opened,
      samples,
      lastMotion,
      localOnly: true,
      motionOnly: true,
      biometric: false,
      recording: false,
      externalNetwork: false,
      externalTransfer: false,
    });
  }

  openButton?.addEventListener("click", () => setOpen(true, "open"));
  closeButton?.addEventListener("click", () => close("close"));
  toggleButton.addEventListener("click", () => (active ? disable("button") : enable("button")));
  stopButton?.addEventListener("click", () => disable("stop"));
  documentRoot.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && opened) close("escape");
  });

  setStatus("off");
  setOpen(opened, "initial");

  return Object.freeze({
    open: () => setOpen(true, "open"),
    close,
    enable,
    disable,
    toggle: () => (active ? disable("toggle") : enable("toggle")),
    getSnapshot,
    destroy: () => disable("destroy"),
  });
}

export default createCameraInput;
