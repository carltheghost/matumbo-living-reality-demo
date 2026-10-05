/**
 * Local RGB camera / video-file source for Hand Lens and optional eye tracking.
 *
 * Construction and source selection never request camera permission. enable()
 * is the explicit consent boundary. Camera capture requests video only; files
 * use temporary Blob URLs, never upload or record. Frame subscriptions are
 * local controller callbacks, not global diagnostics or persisted data.
 */
const WASM_PATH = new URL("../../vendor/mediapipe-tasks-vision-1.0.1/wasm", import.meta.url).href;
const MODEL_PATH = new URL("../../assets/models/vision/hand_landmarker.task", import.meta.url).href;
const MEDIAPIPE_MODULE_URL = new URL("../../vendor/mediapipe-tasks-vision-1.0.1/vision_bundle.mjs", import.meta.url).href;

export const HAND_CAMERA_TIMEOUT_MS = Object.freeze({
  camera: 30_000,
  playback: 15_000,
  model: 90_000,
  devices: 8_000,
  frame: 8_000,
  coldFrame: 15_000,
});
export const HAND_RESULT_MAX_AGE_MS = 350;
const STATES = new Set(["idle", "requesting", "running", "paused", "ended", "denied", "error"]);
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const cleanLabel = (label, fallback = "") => String(label || fallback).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);

export function normalizeHandedness(entry) {
  if (typeof entry === "string") return /left/i.test(entry) ? "Left" : "Right";
  const category = Array.isArray(entry) ? entry[0] : entry;
  const name = category && (category.categoryName || category.displayName || category.label);
  return /left/i.test(String(name || "")) ? "Left" : "Right";
}

function namedError(name, message, code) {
  const error = new Error(message);
  error.name = name;
  error.code = code;
  return error;
}

/**
 * Settle even when a browser permission prompt, model load, or play() ignores
 * cancellation. A late resource is disposed by its own operation, so it can
 * never stop or overwrite a newer source.
 */
function bounded(promise, signal, ms, code, disposeLate) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (error, value) => {
      if (settled) return false;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error); else resolve(value);
      return true;
    };
    const aborted = () => finish(namedError("AbortError", "Source startup stopped.", "cancelled"));
    if (signal?.aborted) aborted();
    else {
      signal?.addEventListener("abort", aborted, { once: true });
      timer = setTimeout(() => finish(namedError("TimeoutError", "Source startup exceeded its time limit.", code)), ms);
    }
    Promise.resolve(promise).then(
      (value) => {
        if (!finish(null, value) && disposeLate) {
          try { Promise.resolve(disposeLate(value)).catch(() => {}); } catch { /* best effort */ }
        }
      },
      (error) => finish(error),
    );
  });
}

/**
 * Compatible camera API, extended with local source controls:
 * selectCamera({deviceId?, facingMode?, mirrored?}), refreshDevices(),
 * setSourceFile(File), play(), pause(), stop(), setHandDetectionEnabled(bool),
 * onVideoFrame(({video,timestamp,source}) => ...), onStateChange(snapshot => ...),
 * getSnapshot(). Public snapshots contain ephemeral source/device option keys,
 * labels, dimensions, and diagnostics; no persistent device IDs or raw frames.
 *
 * timeouts and handLandmarkerFactory are deterministic test seams.
 */
export function createHandCamera({
  onError,
  handLandmarkerFactory,
  timeouts = {},
} = {}) {
  const limits = Object.fromEntries(Object.entries(HAND_CAMERA_TIMEOUT_MS).map(([key, value]) => [
    key, Number.isFinite(timeouts[key]) && timeouts[key] > 0 ? timeouts[key] : value,
  ]));
  let state = "idle";
  let destroyed = false;
  let generation = 0;
  let active = null;
  let stream = null;
  let video = null;
  let panel = null;
  let toggleButton = null;
  let statusLine = null;
  let cameraSelect = null;
  let sourceSelect = null;
  let mirrorInput = null;
  let playbackButton = null;
  let fileInput = null;
  let animationFrame = null;
  let videoFrameHandle = null;
  let lastFrameKey = null;
  let lastDetectionTime = -Infinity;
  let sampleIntervalMs = 33;
  let desiredHandCount = 2;
  let handDetectionEnabled = true;
  let landmarker = null;
  let pendingModel = null;
  let modelEpoch = 0;
  let modelState = "idle";
  let modelDelegate = null;
  let modelErrorCode = null;
  let selectedKind = "camera";
  let selectedDeviceId = "";
  let selectedFacingMode = "user";
  let mirrorOverride = null;
  let selectedFile = null;
  let blobUrl = null;
  let deviceEntries = [];
  let deviceEnumeration = "unrequested";
  let deviceEpoch = 0;
  let deviceOperation = null;
  let deviceListenerAttached = false;
  let actualFacingMode = null;
  let actualDeviceLabel = "";
  let frameCount = 0;
  let detectionOperation = null;
  let detectorOnMainThread = false;
  let sourceMuted = false;
  let handModelCold = true;
  let lastFrameTimestamp = -Infinity;
  let diagnostic = { code: "off", message: "Camera is off. Enable Hand Lens when you are ready." };
  const handSubscribers = new Set();
  const frameSubscribers = new Set();
  const stateSubscribers = new Set();
  const resourceListeners = [];

  function reportError(error) {
    const normalized = error instanceof Error ? error : new Error(String(error || "Hand Lens error"));
    try { onError?.(normalized); } catch { /* host callbacks cannot break cleanup */ }
  }

  function sourceSnapshot() {
    const facingMode = selectedKind === "camera" ? actualFacingMode : null;
    const requestedFacingMode = selectedKind === "camera" && !selectedDeviceId ? selectedFacingMode : null;
    // Unnamed default/front and manually selected webcams use a mirrored
    // display unless the device reports rear facing or the user overrides it.
    // A successful exact rear request defaults to unmirrored even when the
    // browser omits facingMode from its track settings; reported facing stays
    // unknown in the public snapshot rather than being invented.
    const automaticMirror = selectedKind === "camera" && (facingMode
      ? facingMode !== "environment" : requestedFacingMode !== "environment");
    return Object.freeze({
      kind: selectedKind,
      id: "source-" + generation,
      mirrored: mirrorOverride ?? automaticMirror,
      facingMode,
      requestedFacingMode,
      deviceLabel: selectedKind === "camera" ? actualDeviceLabel : "",
      width: Number(video?.videoWidth) || 0,
      height: Number(video?.videoHeight) || 0,
      playing: state === "running" && Boolean(video) && !sourceMuted,
      coordinates: "normalized-display",
      available: Boolean(video) && ["running", "paused"].includes(state) && !sourceMuted,
    });
  }

  function getSnapshot() {
    return Object.freeze({
      state,
      source: sourceSnapshot(),
      handDetectionEnabled,
      handModel: Object.freeze({ state: modelState, delegate: modelDelegate, errorCode: modelErrorCode }),
      diagnostic: Object.freeze({ ...diagnostic }),
      devices: Object.freeze(deviceEntries.map(({ key, label }) => Object.freeze({ key, label }))),
      deviceEnumeration,
      frames: frameCount,
      secureContext: typeof globalThis.isSecureContext === "boolean" ? globalThis.isSecureContext : null,
      localOnly: true,
      microphone: false,
      recording: false,
      uploading: false,
    });
  }

  function publishState() {
    const snapshot = getSnapshot();
    for (const callback of stateSubscribers) {
      try { callback(snapshot); } catch (error) { reportError(error); }
    }
    return snapshot;
  }

  function syncControls() {
    if (toggleButton) {
      // Stop remains available while a permission prompt or model load hangs.
      toggleButton.disabled = destroyed;
      toggleButton.textContent = state === "requesting" ? "Cancel startup"
        : ["running", "paused"].includes(state) ? "Disable Hand Lens" : "Enable Hand Lens";
    }
    if (statusLine) statusLine.textContent = diagnostic.message;
    if (sourceSelect) sourceSelect.value = selectedKind;
    if (mirrorInput) mirrorInput.checked = sourceSnapshot().mirrored;
    if (playbackButton) {
      playbackButton.hidden = selectedKind !== "video-file";
      playbackButton.textContent = state === "running" ? "Pause video" : "Play video";
    }
    if (video) video.style.transform = sourceSnapshot().mirrored ? "scaleX(-1)" : "none";
  }

  function setState(nextState, code, message) {
    if (!STATES.has(nextState)) return;
    state = nextState;
    diagnostic = { code, message };
    syncControls();
    publishState();
  }

  function listen(target, type, handler) {
    target?.addEventListener?.(type, handler);
    resourceListeners.push(() => target?.removeEventListener?.(type, handler));
  }

  function notifyNoHands(extra = {}) {
    const payload = { ...extra, hands: [], timestamp: clock(), source: sourceSnapshot(), mirrored: sourceSnapshot().mirrored };
    for (const callback of handSubscribers) {
      try { callback(payload); } catch (error) { reportError(error); }
    }
  }

  function stopStream(target) {
    for (const track of target?.getTracks?.() || []) {
      try { track.stop(); } catch { /* all tracks still get a stop attempt */ }
    }
  }

  function closeDetector(target) {
    if (!target) return;
    try {
      const result = target.close?.();
      if (result?.then) result.catch(reportError);
    } catch (error) { reportError(error); }
  }

  function cancelDetectionLoop() {
    if (animationFrame !== null) globalThis.cancelAnimationFrame?.(animationFrame);
    if (videoFrameHandle !== null) video?.cancelVideoFrameCallback?.(videoFrameHandle);
    animationFrame = null;
    videoFrameHandle = null;
  }

  function stopDetector(nextState = handDetectionEnabled ? "idle" : "disabled") {
    modelEpoch += 1;
    pendingModel?.controller.abort();
    pendingModel = null;
    detectionOperation?.controller.abort();
    const previous = landmarker;
    landmarker = null;
    closeDetector(previous);
    modelState = nextState;
    modelDelegate = null;
    modelErrorCode = null;
    detectorOnMainThread = false;
    handModelCold = true;
    lastDetectionTime = -Infinity;
  }

  function releaseSource() {
    active?.controller.abort();
    active = null;
    cancelDetectionLoop();
    for (const remove of resourceListeners.splice(0)) remove();
    const previousStream = stream;
    stream = null;
    stopStream(previousStream);
    const previousVideo = video;
    video = null;
    if (previousVideo) {
      try { previousVideo.pause(); } catch { /* detached media element */ }
      previousVideo.srcObject = null;
      previousVideo.removeAttribute?.("src");
      try { previousVideo.load?.(); } catch { /* unsupported stub/browser */ }
      previousVideo.remove?.();
    }
    if (blobUrl) {
      globalThis.URL?.revokeObjectURL?.(blobUrl);
      blobUrl = null;
    }
    stopDetector();
    lastFrameKey = null;
    lastDetectionTime = -Infinity;
    actualFacingMode = null;
    actualDeviceLabel = "";
    sourceMuted = false;
  }

  function current(context) {
    return !destroyed && active === context && !context.controller.signal.aborted;
  }

  function friendlyError(error, stage) {
    const code = error?.code;
    if (code === "camera_timeout") return ["error", code, "Camera permission timed out locally. Choose Allow, then retry; a late camera stream will be stopped."];
    if (code === "playback_timeout") return ["error", code, "Video did not start in time. Retry playback or choose another source."];
    if (code === "insecure_origin") return ["error", code, "Camera needs HTTPS or localhost. On a phone, open a trusted HTTPS address; plain HTTP over Wi-Fi cannot access the camera."];
    if (code === "camera_unavailable") return ["error", code, "This browser cannot access a camera. Try a browser with camera support, HTTPS, or a local video file."];
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError" || error?.name === "SecurityError") {
      return ["denied", "permission_denied", "Camera access was denied or blocked. Allow camera access in browser/site settings, then retry. Pointer/touch controls remain available."];
    }
    if (error?.name === "NotFoundError") return ["error", "no_camera", "No camera was found. Connect a webcam or choose a local video file."];
    if (error?.name === "NotReadableError" || error?.name === "TrackStartError") return ["error", "camera_busy", "Camera is busy or unavailable to the browser. Close other camera apps, check the connection, then retry."];
    if (error?.name === "OverconstrainedError") return ["error", "camera_selection_unavailable", selectedFacingMode === "environment" && !selectedDeviceId
      ? "A rear camera is unavailable in this browser. Choose Front / default or select a named camera."
      : "The selected camera is unavailable. Refresh cameras or choose Front / default."];
    if (stage === "file") return ["error", "video_decode_error", "This video could not play. Choose a video codec supported by this browser; the file stays on this device."];
    return ["error", "source_error", "Hand Lens could not start this source. Check camera permission or choose another video. Pointer/touch controls remain available."];
  }

  function finishSource(context, nextState, code, message) {
    if (!current(context)) return;
    releaseSource();
    generation += 1;
    notifyNoHands();
    setState(nextState, code, message);
  }

  function createPreview(context) {
    const preview = document.createElement("video");
    preview.id = "hand-lens-preview";
    preview.autoplay = true;
    preview.playsInline = true;
    preview.muted = true;
    preview.controls = selectedKind === "video-file";
    preview.setAttribute("aria-label", selectedKind === "video-file" ? "Local video tracking preview" : "Hand Lens camera preview");
    Object.assign(preview.style, {
      display: "block", width: "100%", maxHeight: "170px", objectFit: "contain",
      borderRadius: "8px", background: "#000", marginTop: "8px",
      transform: sourceSnapshot().mirrored ? "scaleX(-1)" : "none",
    });
    panel.appendChild(preview);
    video = preview;
    listen(preview, "error", () => finishSource(context, "error", "video_decode_error", "Video playback failed. Choose another file or retry the camera."));
    listen(preview, "ended", () => finishSource(context, "ended", "video_ended", "Video ended. Its temporary playback URL was released. Press Enable to replay."));
    listen(preview, "pause", () => {
      if (!current(context) || state !== "running") return;
      cancelDetectionLoop();
      detectionOperation?.controller.abort();
      notifyNoHands();
      setState("paused", "paused", "Video paused. Hand actions are released; press Play video to continue.");
    });
    listen(preview, "playing", () => {
      if (!current(context) || !["running", "paused"].includes(state)) return;
      setState("running", "active", activeMessage());
      scheduleFrame(context);
    });
    return preview;
  }

  function activeMessage() {
    if (sourceMuted) return "Camera frames are temporarily unavailable. Check the camera shutter or another camera app.";
    if (!handDetectionEnabled) return "Local video is active. Hand detection is off; local eye tracking can use this source.";
    if (modelState === "error") return "Local video is active, but the hand model is unavailable. Eye tracking can continue; pointer/touch controls remain available.";
    if (modelState === "loading" || modelState === "idle") return "Local video is active. Loading the hand model; frames stay on this device.";
    if (detectorOnMainThread) return "Hand Lens is active with a CPU fallback at up to 4 samples/second. This browser has no worker video input; frames stay local.";
    return "Hand Lens is active. Camera/video frames stay on this device.";
  }

  function emitDetection(result, timestamp, latencyMs) {
    const source = sourceSnapshot();
    const landmarks = Array.isArray(result?.landmarks) ? result.landmarks : [];
    const hands = landmarks.map((points, index) => ({
      // Preview and screen control coordinates use the same mirror mapping.
      landmarks: Array.isArray(points) ? points.map((point) => source.mirrored
        ? { ...point, x: 1 - point.x } : { ...point }) : [],
      worldLandmarks: Array.isArray(result?.worldLandmarks?.[index]) ? result.worldLandmarks[index] : [],
      handedness: normalizeHandedness(result?.handedness?.[index]),
    }));
    for (const callback of handSubscribers) {
      try { callback({ hands, timestamp, latencyMs, source, mirrored: source.mirrored }); }
      catch (error) { reportError(error); }
    }
  }

  async function detectHandFrame(context, timestamp, frameVideo, source) {
    if (!current(context) || state !== "running" || document.hidden === true || sourceMuted || !handDetectionEnabled || !landmarker || detectionOperation) return;
    if (timestamp - lastDetectionTime < Math.max(sampleIntervalMs, detectorOnMainThread ? 250 : 0)) return;
    lastDetectionTime = timestamp;
    const detector = landmarker;
    const epoch = modelEpoch;
    const operation = { controller: new AbortController() };
    detectionOperation = operation;
    const abort = () => operation.controller.abort();
    context.controller.signal.addEventListener("abort", abort, { once: true });
    try {
      const started = clock();
      const timeout = handModelCold ? limits.coldFrame : limits.frame;
      const result = await bounded(detector.detectForVideo(frameVideo, timestamp), operation.controller.signal, timeout, "hand_frame_timeout");
      if (result && current(context) && state === "running" && document.hidden !== true && !sourceMuted && handDetectionEnabled && epoch === modelEpoch && source.id === sourceSnapshot().id) {
        if (result.landmarks?.length) handModelCold = false;
        const latencyMs = clock() - started;
        // Warmup or slow inference must never act on where a hand used to be.
        // Empty hands cancel holds in every consumer, including legacy paths;
        // the measured latency still lets the governor reduce detector load.
        if (clock() - timestamp > HAND_RESULT_MAX_AGE_MS) notifyNoHands({ latencyMs, stale: true });
        else emitDetection(result, timestamp, latencyMs);
      }
    } catch (error) {
      if (!current(context) || epoch !== modelEpoch || error?.name === "AbortError") return;
      reportError(error);
      notifyNoHands();
      stopDetector("error");
      modelErrorCode = error?.code || "hand_detection_failed";
      diagnostic = { code: modelErrorCode, message: "Hand detection failed or timed out. Local video remains available to eyes; toggle hand detection or retry." };
      syncControls(); publishState();
    } finally {
      context.controller.signal.removeEventListener("abort", abort);
      if (detectionOperation === operation) detectionOperation = null;
    }
  }

  function processFrame(context, metadata) {
    if (!current(context) || state !== "running" || document.hidden === true || sourceMuted || !video) return;
    if (video.readyState < (globalThis.HTMLMediaElement?.HAVE_CURRENT_DATA ?? 2)) return;
    // rVFC counts decoded presented frames. The rAF fallback deduplicates by
    // media currentTime instead of analyzing the same frame at display refresh.
    const frameKey = Number.isFinite(metadata?.presentedFrames) ? metadata.presentedFrames
      : Number.isFinite(metadata?.mediaTime) ? metadata.mediaTime
      : Number.isFinite(video.currentTime) ? video.currentTime : 0;
    if (frameKey === lastFrameKey) return;
    lastFrameKey = frameKey;
    const timestamp = Math.max(clock(), lastFrameTimestamp + 0.001);
    lastFrameTimestamp = timestamp;
    const source = sourceSnapshot();
    const frameVideo = video;
    frameCount += 1;
    for (const callback of frameSubscribers) {
      try { callback({ video: frameVideo, timestamp, source }); } catch (error) { reportError(error); }
      if (!current(context)) return;
    }
    void detectHandFrame(context, timestamp, frameVideo, source);
  }

  function scheduleFrame(context) {
    if (!current(context) || state !== "running" || !video || animationFrame !== null || videoFrameHandle !== null) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      videoFrameHandle = video.requestVideoFrameCallback((_, metadata) => {
        videoFrameHandle = null;
        processFrame(context, metadata);
        scheduleFrame(context);
      });
    } else {
      animationFrame = globalThis.requestAnimationFrame?.(() => {
        animationFrame = null;
        processFrame(context);
        scheduleFrame(context);
      }) ?? null;
    }
  }

  async function createLandmarker(context, epoch, signal) {
    if (typeof handLandmarkerFactory === "function") return { detector: await handLandmarkerFactory(context.id), delegate: "injected" };
    if (typeof globalThis.Worker === "function" && typeof globalThis.createImageBitmap === "function") {
      const { createWorkerHandDetector } = await import("./hand-detector.js");
      if (!current(context) || epoch !== modelEpoch) return null;
      const detector = await createWorkerHandDetector({
        runtimeUrl: MEDIAPIPE_MODULE_URL, wasmPath: WASM_PATH, modelPath: MODEL_PATH,
        numHands: desiredHandCount, initTimeoutMs: limits.model, frameTimeoutMs: limits.frame,
        coldFrameTimeoutMs: limits.coldFrame,
        signal,
      });
      return { detector, delegate: detector.delegate };
    }
    const { FilesetResolver, HandLandmarker } = await import(MEDIAPIPE_MODULE_URL);
    if (!current(context) || epoch !== modelEpoch) return null;
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    if (!current(context) || epoch !== modelEpoch) return null;
    // Older browsers without transferable video input retain a bounded-rate
    // CPU path. Worker-capable browsers never run production inference here.
    const options = { baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" }, runningMode: "VIDEO", numHands: desiredHandCount };
    return { detector: await HandLandmarker.createFromOptions(vision, options), delegate: "CPU-main-thread" };
  }

  function applyHandCount(target) {
    try {
      const result = target?.setOptions?.({ numHands: desiredHandCount });
      if (result?.then) result.catch(reportError);
    } catch (error) { reportError(error); }
  }

  async function ensureHandModel(context) {
    if (!current(context) || !handDetectionEnabled || landmarker) return;
    if (pendingModel) return pendingModel.promise;
    const epoch = ++modelEpoch;
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.controller.signal.addEventListener("abort", abort, { once: true });
    const operation = { controller, promise: null };
    pendingModel = operation;
    modelState = "loading";
    modelErrorCode = null;
    diagnostic = { code: "model_loading", message: activeMessage() };
    syncControls();
    publishState();
    if (!current(context) || epoch !== modelEpoch || !handDetectionEnabled) {
      controller.abort();
      context.controller.signal.removeEventListener("abort", abort);
      if (pendingModel === operation) pendingModel = null;
      return;
    }
    operation.promise = (async () => {
      try {
        const created = await bounded(createLandmarker(context, epoch, controller.signal), controller.signal, limits.model, "model_timeout", (late) => closeDetector(late?.detector));
        if (!current(context) || epoch !== modelEpoch || !handDetectionEnabled) {
          closeDetector(created?.detector);
          return;
        }
        if (!created?.detector) throw namedError("Error", "Hand model did not initialize.", "model_unavailable");
        landmarker = created.detector;
        modelDelegate = created.delegate;
        detectorOnMainThread = created.delegate === "CPU-main-thread";
        applyHandCount(landmarker);
        modelState = "ready";
        lastDetectionTime = -Infinity;
        diagnostic = { code: sourceMuted ? "camera_muted" : "active", message: activeMessage() };
      } catch (error) {
        if (error?.name === "AbortError" || !current(context) || epoch !== modelEpoch) return;
        modelState = "error";
        modelErrorCode = error?.code || "model_unavailable";
        diagnostic = {
          code: modelErrorCode,
          message: modelErrorCode === "model_timeout"
            ? "Hand model loading timed out locally. Video and eye tracking remain available; retry hand detection. Model downloads may still finish in the browser."
            : "Hand model could not load. Check access to the local model/runtime files and browser WebAssembly support. Video and eye tracking remain available.",
        };
        notifyNoHands();
        reportError(error);
      } finally {
        context.controller.signal.removeEventListener("abort", abort);
        if (pendingModel === operation) pendingModel = null;
        if (current(context) && epoch === modelEpoch) {
          syncControls();
          publishState();
        }
      }
    })();
    return operation.promise;
  }

  async function enable() {
    if (destroyed) return getSnapshot();
    if (state === "paused" && active) return play();
    if (state === "running" || state === "requesting") return getSnapshot();
    ensurePanel();
    generation += 1;
    const context = { id: generation, controller: new AbortController() };
    active = context;
    frameCount = 0;
    lastFrameKey = null;
    actualDeviceLabel = "";
    actualFacingMode = null;
    setState("requesting", "starting", selectedKind === "camera" ? "Requesting camera access…" : "Starting local video…");
    if (!current(context)) return getSnapshot();
    try {
      if (selectedKind === "camera") {
        if (globalThis.isSecureContext === false) throw namedError("SecurityError", "Camera requires a secure context.", "insecure_origin");
        const mediaDevices = globalThis.navigator?.mediaDevices;
        if (typeof mediaDevices?.getUserMedia !== "function") throw namedError("Error", "getUserMedia unavailable.", "camera_unavailable");
        const constraints = { width: { ideal: 640 }, height: { ideal: 480 } };
        if (selectedDeviceId) constraints.deviceId = { exact: selectedDeviceId };
        else constraints.facingMode = selectedFacingMode === "environment" ? { exact: "environment" } : { ideal: "user" };
        const acquired = await bounded(mediaDevices.getUserMedia({ video: constraints, audio: false }), context.controller.signal, limits.camera, "camera_timeout", stopStream);
        if (!current(context)) { stopStream(acquired); return getSnapshot(); }
        const tracks = acquired?.getVideoTracks?.() ?? acquired?.getTracks?.() ?? [];
        if (!tracks.length) { stopStream(acquired); throw namedError("NotFoundError", "No camera video track returned.", "no_camera"); }
        stream = acquired;
        const settings = tracks[0]?.getSettings?.() || {};
        actualFacingMode = ["user", "environment"].includes(settings.facingMode) ? settings.facingMode : null;
        actualDeviceLabel = cleanLabel(tracks[0]?.label, "Camera");
        // A track can be muted before we attach listeners (for example a
        // hardware shutter). Do not wait for a second mute event to suppress
        // frames or report unavailable capture honestly.
        sourceMuted = tracks.some((track) => track.muted === true);
        for (const track of tracks) {
          listen(track, "ended", () => finishSource(context, "error", "camera_lost", "Camera disconnected or permission ended. Reconnect it and press Enable, or choose a local video."));
          listen(track, "mute", () => {
            if (!current(context)) return;
            sourceMuted = true;
            generation += 1;
            context.id = generation;
            notifyNoHands();
            diagnostic = { code: "camera_muted", message: "Camera frames are temporarily unavailable. Check the camera shutter or another camera app." };
            syncControls(); publishState();
          });
          listen(track, "unmute", () => {
            if (!current(context)) return;
            sourceMuted = false;
            generation += 1;
            context.id = generation;
            lastDetectionTime = -Infinity;
            diagnostic = { code: "active", message: activeMessage() };
            syncControls(); publishState();
          });
        }
      } else {
        if (!selectedFile) throw namedError("Error", "Choose a local video first.", "video_required");
        if (typeof globalThis.URL?.createObjectURL !== "function") throw namedError("Error", "Local video playback unavailable.", "video_unavailable");
        blobUrl = globalThis.URL.createObjectURL(selectedFile);
      }
      const preview = createPreview(context);
      if (selectedKind === "camera") preview.srcObject = stream; else preview.src = blobUrl;
      await bounded(preview.play(), context.controller.signal, limits.playback, "playback_timeout");
      if (!current(context)) return getSnapshot();
      setState("running", sourceMuted ? "camera_muted" : "active", activeMessage());
      // Existing rAF-only runtimes may already have a decoded frame on play().
      if (typeof preview.requestVideoFrameCallback !== "function") processFrame(context);
      scheduleFrame(context);
      if (selectedKind === "camera") void refreshDevices();
      if (handDetectionEnabled) {
        await ensureHandModel(context);
        if (current(context) && typeof preview.requestVideoFrameCallback !== "function") {
          // The first source frame may have been emitted before the detector
          // was ready. Detect it once without duplicating the frame callback.
          if (landmarker && preview.readyState >= (globalThis.HTMLMediaElement?.HAVE_CURRENT_DATA ?? 2) && document.hidden !== true && !sourceMuted) {
            await detectHandFrame(context, clock(), preview, sourceSnapshot());
          }
        }
      } else { modelState = "disabled"; publishState(); }
    } catch (error) {
      if (error?.name === "AbortError" || !current(context)) return getSnapshot();
      const details = error?.code === "video_required"
        ? ["error", "video_required", "Choose a local video file, then press Enable Hand Lens."]
        : friendlyError(error, selectedKind === "video-file" ? "file" : "camera");
      releaseSource();
      generation += 1;
      notifyNoHands();
      setState(...details);
      reportError(error);
    }
    return getSnapshot();
  }

  function disable() {
    releaseSource();
    deviceEpoch += 1;
    if (deviceOperation) deviceEnumeration = "cancelled";
    deviceOperation?.abort();
    deviceOperation = null;
    generation += 1;
    desiredHandCount = 2;
    frameCount = 0;
    notifyNoHands();
    setState("idle", "off", "Camera/video is off. Enable Hand Lens when you are ready.");
    return getSnapshot();
  }

  function setHandDetectionEnabled(enabled) {
    if (destroyed) return getSnapshot();
    const next = Boolean(enabled);
    if (next === handDetectionEnabled) {
      if (next && modelState === "error" && active) void ensureHandModel(active);
      return getSnapshot();
    }
    handDetectionEnabled = next;
    stopDetector(next ? "idle" : "disabled");
    notifyNoHands();
    if (next && active && ["running", "paused"].includes(state)) void ensureHandModel(active);
    else {
      if (active) diagnostic = { code: "active", message: activeMessage() };
      syncControls(); publishState();
    }
    return getSnapshot();
  }

  function restartSelection(change) {
    const restart = ["requesting", "running", "paused"].includes(state);
    disable();
    change();
    syncControls();
    publishState();
    return restart ? enable() : Promise.resolve(getSnapshot());
  }

  function selectCamera({ deviceId, facingMode, mirrored } = {}) {
    if (destroyed) return Promise.resolve(getSnapshot());
    if (facingMode !== undefined && !["user", "environment"].includes(facingMode)) throw new TypeError("Choose front/user or rear/environment camera.");
    if (deviceId !== undefined && typeof deviceId !== "string") throw new TypeError("Camera deviceId must be a string.");
    if (mirrored !== undefined && typeof mirrored !== "boolean") throw new TypeError("Camera mirrored must be boolean.");
    return restartSelection(() => {
      selectedKind = "camera";
      selectedFile = null;
      selectedFacingMode = facingMode || selectedFacingMode;
      selectedDeviceId = deviceId === undefined ? (facingMode ? "" : selectedDeviceId) : (deviceEntries.find((entry) => entry.key === deviceId)?.deviceId || deviceId);
      mirrorOverride = mirrored ?? null;
    });
  }

  function setSourceFile(file) {
    if (destroyed) return Promise.resolve(getSnapshot());
    const isBlob = typeof globalThis.Blob === "function" && file instanceof Blob;
    if (!isBlob || (!/^video\//i.test(file.type) && !(file.type === "" && /\.(mp4|m4v|webm|mov|ogv|ogg)$/i.test(file.name || "")))) {
      throw new TypeError("Choose a local video file supported by this browser.");
    }
    return restartSelection(() => {
      selectedKind = "video-file";
      selectedFile = file;
      selectedDeviceId = "";
      mirrorOverride = false;
    });
  }

  async function play() {
    if (destroyed) return getSnapshot();
    if (!active || !video) return enable();
    const context = active;
    try {
      await bounded(video.play(), context.controller.signal, limits.playback, "playback_timeout");
      if (current(context)) {
        setState("running", "active", activeMessage());
        scheduleFrame(context);
      }
    } catch (error) {
      if (error?.name !== "AbortError" && current(context)) {
        finishSource(context, ...friendlyError(error, selectedKind === "video-file" ? "file" : "camera"));
        reportError(error);
      }
    }
    return getSnapshot();
  }

  function pause() {
    if (!active || !video || state !== "running") return getSnapshot();
    cancelDetectionLoop();
    detectionOperation?.controller.abort();
    video.pause();
    if (state === "running") {
      notifyNoHands();
      setState("paused", "paused", "Video paused. Hand actions are released; press Play video to continue.");
    }
    return getSnapshot();
  }

  function renderDevices() {
    if (!cameraSelect) return;
    cameraSelect.replaceChildren?.();
    if (!cameraSelect.replaceChildren) cameraSelect.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Front / default camera";
    cameraSelect.appendChild(defaultOption);
    for (const { key, label } of deviceEntries) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = label;
      cameraSelect.appendChild(option);
    }
    cameraSelect.value = deviceEntries.find((entry) => entry.deviceId === selectedDeviceId)?.key || "";
  }

  async function refreshDevices() {
    if (destroyed) return [];
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (typeof mediaDevices?.enumerateDevices !== "function") {
      deviceEnumeration = "unavailable";
      publishState();
      return [];
    }
    deviceOperation?.abort();
    const controller = new AbortController();
    deviceOperation = controller;
    const epoch = ++deviceEpoch;
    deviceEnumeration = "loading";
    publishState();
    try {
      const devices = await bounded(mediaDevices.enumerateDevices(), controller.signal, limits.devices, "devices_timeout");
      if (destroyed || epoch !== deviceEpoch) return [];
      deviceEntries = devices.filter((device) => device.kind === "videoinput").map((device, index) => ({
        key: "camera-" + epoch + "-" + (index + 1),
        deviceId: device.deviceId,
        label: cleanLabel(device.label, "Camera " + (index + 1) + " (allow access for its name)"),
      }));
      deviceEnumeration = "ready";
      renderDevices();
    } catch (error) {
      if (error?.name === "AbortError" || destroyed || epoch !== deviceEpoch) return [];
      deviceEnumeration = error?.code === "devices_timeout" ? "timeout" : "error";
      reportError(error);
    } finally {
      if (deviceOperation === controller) deviceOperation = null;
      if (!destroyed && epoch === deviceEpoch) publishState();
    }
    return getSnapshot().devices;
  }

  function setHandCount(n) {
    const next = n === 1 ? 1 : 2;
    if (next === desiredHandCount) return;
    desiredHandCount = next;
    applyHandCount(landmarker);
  }

  function setSampleInterval(ms) {
    const value = Number(ms);
    if (Number.isFinite(value)) sampleIntervalMs = Math.min(500, Math.max(16, value));
  }

  function subscribe(set, callback, label) {
    if (typeof callback !== "function") throw new TypeError(label + " requires a callback function.");
    if (!destroyed) set.add(callback);
    return () => set.delete(callback);
  }

  function handleVisibilityChange() {
    if (document.hidden === true) {
      detectionOperation?.controller.abort();
      notifyNoHands();
    }
    else lastDetectionTime = -Infinity;
  }

  function handleDeviceChange() {
    if (!destroyed && (active || panel?.hidden === false)) void refreshDevices();
  }

  function ensurePanel() {
    if (destroyed || panel?.isConnected || typeof document === "undefined") return;
    panel = document.createElement("aside");
    panel.id = "hand-lens-panel";
    panel.dataset.handLensPanel = "true";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Hand Lens camera and local video controls");
    Object.assign(panel.style, {
      position: "fixed", right: "12px", bottom: "12px", zIndex: "9999",
      width: "min(300px, calc(100vw - 24px))", maxHeight: "calc(100vh - 32px)",
      overflowY: "auto", padding: "12px", borderRadius: "10px",
      background: "rgba(12,14,18,.94)", color: "#fff", fontFamily: "system-ui,sans-serif",
      fontSize: "12px", lineHeight: "1.4", boxSizing: "border-box",
    });
    const button = (id, text, handler) => {
      const control = document.createElement("button");
      control.id = id; control.type = "button"; control.textContent = text;
      Object.assign(control.style, { minHeight: "36px", padding: "6px 8px", margin: "3px", borderRadius: "6px", cursor: "pointer" });
      control.addEventListener("click", handler);
      return control;
    };
    const header = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = "Camera or video";
    const close = button("hand-lens-close", "×", () => {
      disable(); setPanelOpen(false);
    });
    close.setAttribute("aria-label", "Close Hand Lens and stop camera/video");
    header.append(title, close);
    sourceSelect = document.createElement("select");
    sourceSelect.id = "hand-lens-source";
    sourceSelect.setAttribute("aria-label", "Camera or local video source");
    for (const [value, text] of [["camera", "Camera"], ["video-file", "Local video file"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = text; sourceSelect.appendChild(option);
    }
    sourceSelect.addEventListener("change", () => {
      if (sourceSelect.value === "camera") void selectCamera({});
      else {
        disable(); selectedKind = "video-file"; mirrorOverride = false; syncControls(); publishState();
      }
    });
    cameraSelect = document.createElement("select");
    cameraSelect.id = "hand-lens-camera-select";
    cameraSelect.setAttribute("aria-label", "Available cameras");
    cameraSelect.addEventListener("change", () => {
      // The blank option is explicitly Front / default, including after a
      // named device was selected from Rear mode. Do not retain the last rear
      // constraint while labeling this choice as the front/default camera.
      void selectCamera(cameraSelect.value ? { deviceId: cameraSelect.value } : { deviceId: "", facingMode: "user" });
    });
    const cameraRow = document.createElement("div");
    cameraRow.append(
      button("hand-lens-front", "Front / default", () => { void selectCamera({ facingMode: "user" }); }),
      button("hand-lens-rear", "Rear camera", () => { void selectCamera({ facingMode: "environment" }); }),
      button("hand-lens-refresh", "Refresh cameras", () => { void refreshDevices(); }),
    );
    fileInput = document.createElement("input");
    fileInput.id = "hand-lens-file"; fileInput.type = "file"; fileInput.accept = "video/*";
    fileInput.setAttribute("aria-label", "Choose local video; it stays on this device");
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try { void setSourceFile(file); } catch (error) {
        diagnostic = { code: "invalid_video_file", message: error.message }; syncControls(); publishState();
      }
      fileInput.value = "";
    });
    const mirrorLabel = document.createElement("label");
    mirrorInput = document.createElement("input");
    mirrorInput.id = "hand-lens-mirror"; mirrorInput.type = "checkbox";
    mirrorInput.addEventListener("change", () => {
      mirrorOverride = mirrorInput.checked;
      generation += 1;
      if (active) active.id = generation;
      notifyNoHands(); syncControls(); publishState();
    });
    mirrorLabel.append(mirrorInput);
    const mirrorText = document.createElement("span"); mirrorText.textContent = " Mirror preview and control coordinates"; mirrorLabel.append(mirrorText);
    toggleButton = button("hand-lens-enable", "Enable Hand Lens", () => {
      if (["running", "paused", "requesting"].includes(state)) disable(); else void enable();
    });
    playbackButton = button("hand-lens-playback", "Play video", () => { if (state === "running") pause(); else void play(); });
    const stopButton = button("hand-lens-stop", "Stop", disable);
    statusLine = document.createElement("div");
    statusLine.id = "hand-lens-status";
    statusLine.setAttribute("role", "status"); statusLine.setAttribute("aria-live", "polite");
    const note = document.createElement("p");
    note.textContent = "Camera needs HTTPS or localhost. Files play locally. No microphone, recording, or upload. Hand and eye models load from this app when enabled.";
    panel.append(header, sourceSelect, cameraSelect, cameraRow, fileInput, mirrorLabel, toggleButton, playbackButton, stopButton, statusLine, note);
    document.body.appendChild(panel);
    renderDevices(); syncControls();
  }

  function setPanelOpen(open) {
    ensurePanel();
    if (panel) panel.hidden = !open;
  }

  function destroy() {
    if (destroyed) return;
    disable();
    destroyed = true;
    deviceEpoch += 1;
    deviceOperation?.abort();
    deviceOperation = null;
    globalThis.document?.removeEventListener?.("visibilitychange", handleVisibilityChange);
    if (deviceListenerAttached) globalThis.navigator?.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    panel?.remove?.(); panel = null;
    handSubscribers.clear(); frameSubscribers.clear(); stateSubscribers.clear();
    selectedFile = null; selectedDeviceId = ""; deviceEntries = [];
  }

  if (typeof document !== "undefined") {
    ensurePanel();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (typeof mediaDevices?.addEventListener === "function") {
      mediaDevices.addEventListener("devicechange", handleDeviceChange);
      deviceListenerAttached = true;
    }
  }

  return {
    enable, disable, stop: disable, destroy, play, pause,
    selectCamera, refreshDevices, setSourceFile, setHandDetectionEnabled, getSnapshot,
    onHands: (callback) => subscribe(handSubscribers, callback, "Hand Lens onHands()"),
    offHands: (callback) => handSubscribers.delete(callback),
    onVideoFrame: (callback) => subscribe(frameSubscribers, callback, "Hand Lens onVideoFrame()"),
    onStateChange: (callback) => subscribe(stateSubscribers, callback, "Hand Lens onStateChange()"),
    getState: () => state,
    setHandCount, getHandCount: () => desiredHandCount, setSampleInterval,
    setPanelOpen, isPanelOpen: () => Boolean(panel?.isConnected) && panel.hidden !== true,
    getPanelElement: () => panel,
  };
}
