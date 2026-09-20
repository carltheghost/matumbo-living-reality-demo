/**
 * Hand Lens camera lifecycle + MediaPipe HandLandmarker wiring.
 *
 * PRIVACY GUARANTEE:
 * - Camera is OFF by default.
 * - Camera access begins ONLY after the user explicitly presses
 *   "Enable Hand Lens".
 * - Video frames are analyzed locally for hand landmarks only.
 * - Frames are NEVER recorded, uploaded, persisted, or sent anywhere.
 * - Closing/disabling Hand Lens stops every active media track.
 * - The preview is mirrored for the user and is never analyzed beyond
 *   the hand-landmark detector.
 *
 * Integration point:
 *   main.js should call:
 *
 *     const handCamera = createHandCamera({
 *       onError: (error) => console.warn("[Hand Lens]", error)
 *     });
 *
 *     handCamera.onHands(({ hands, timestamp }) => {
 *       // Feed landmarks into the spatial/visual hand layer here.
 *     });
 *
 *   The UI's "Enable Hand Lens" button is owned by this module, so
 *   main.js does NOT need to call enable() unless an external control
 *   is intentionally being added.
 *
 *   If main.js does provide an external enable control, the exact
 *   integration point is:
 *
 *     handCamera.enable();
 *
 *   and disable with:
 *
 *     handCamera.disable();
 *
 * Dependency:
 *   MediaPipe Tasks Vision 0.10.7 is lazy-loaded ONLY after enable().
 *
 * No build step required.
 */

const MEDIAPIPE_VERSION = "0.10.7";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.7/wasm";

const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const MEDIAPIPE_MODULE_URL =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/+esm`;

const DETECTION_INTERVAL_MS = 33;
/** Hard bounds for the governor-adjustable sample interval (ms). */
const MIN_SAMPLE_INTERVAL_MS = 16;
const MAX_SAMPLE_INTERVAL_MS = 500;

const STATES = new Set([
  "idle",
  "requesting",
  "running",
  "denied",
  "error",
]);

/**
 * Normalize MediaPipe's handedness entry to a stable "Left" | "Right" label.
 *
 * MediaPipe Tasks Vision returns `result.handedness` as an array of arrays
 * of Category objects: e.g. `[[{ categoryName: "Left", score: 0.98 }]]`.
 * Downstream lanes (hand presence, domain gestures) expect a plain string.
 *
 * @param {unknown} entry
 * @returns {"Left"|"Right"}
 */
export function normalizeHandedness(entry) {
  if (typeof entry === "string") {
    return /left/i.test(entry) ? "Left" : "Right";
  }
  const category = Array.isArray(entry) ? entry[0] : entry;
  const name =
    (category && (category.categoryName || category.displayName || category.label)) || "";
  return /left/i.test(String(name)) ? "Left" : "Right";
}

/**
 * Create an isolated Hand Lens camera controller.
 *
 * @param {Object} [options]
 * @param {(error: Error) => void} [options.onError]
 * @param {(token: number) => Promise<any>} [options.handLandmarkerFactory]
 *   Deterministic test seam. When provided, it is called with the current
 *   lifecycle token instead of the dynamic CDN import path, and its return
 *   value (a landmarker-like object, or null) is used directly. The default
 *   CDN lazy-load path is unchanged when this option is absent.
 * @returns {{
 *   enable: () => Promise<void>,
 *   disable: () => void,
 *   destroy: () => void,
 *   onHands: (callback: Function) => Function,
 *   offHands: (callback: Function) => void,
 *   getState: () => string,
 *   setHandCount: (n: number) => void,
 *   getHandCount: () => number
 * }}
 */
export function createHandCamera({ onError, handLandmarkerFactory } = {}) {
  let state = "idle";

  /** @type {MediaStream|null} */
  let stream = null;

  /** @type {HTMLVideoElement|null} */
  let video = null;

  /** @type {HTMLElement|null} */
  let panel = null;

  /** @type {HTMLButtonElement|null} */
  let toggleButton = null;

  /** @type {HTMLElement|null} */
  let statusLine = null;

  /** @type {number|null} */
  let animationFrame = null;

  /** @type {number} */
  let lastDetectionTime = -Infinity;

  /**
   * Governor-adjustable minimum gap between MediaPipe detections.
   * Defaults to ~30 FPS; the perf governor raises it under load.
   * @type {number}
   */
  let sampleIntervalMs = DETECTION_INTERVAL_MS;

  /**
   * Let the perf governor throttle MediaPipe sampling under load.
   * Clamped to sane bounds; never disables sampling on its own.
   * @param {number} ms
   */
  function setSampleInterval(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return;
    sampleIntervalMs = Math.min(
      MAX_SAMPLE_INTERVAL_MS,
      Math.max(MIN_SAMPLE_INTERVAL_MS, n),
    );
  }

  /** @type {any|null} */
  let landmarker = null;

  /** @type {Set<Function>} */
  const subscribers = new Set();

  // Prevent stale async enable() operations from resurrecting the camera
  // after disable() has already been requested.
  let lifecycleToken = 0;

  // Prevent overlapping MediaPipe detection calls.
  let detectionInFlight = false;

  /**
   * Desired detector hand count. The hand-session lane degrades two-hand
   * tracking to one-hand when the device struggles; 2 is the default.
   * @type {number}
   */
  let desiredHandCount = 2;

  /**
   * Document-hidden sampling pause (explicit deterministic guard).
   *
   * The browser's rAF loop already stops while a tab is hidden, but this
   * listener makes the pause deterministic: when the document becomes
   * visible again the sample clock resets so MediaPipe sampling resumes
   * cleanly instead of honoring a stale interval gap.
   */
  function handleVisibilityChange() {
    if (typeof document === "undefined") {
      return;
    }

    if (document.hidden !== true) {
      lastDetectionTime = -Infinity;
    }
  }

  /**
   * Apply the desired hand count to a live landmarker.
   * Never throws; some runtimes do not expose setOptions().
   *
   * @param {any} target
   */
  function applyHandCount(target) {
    if (!target) {
      return;
    }

    try {
      if (typeof target.setOptions === "function") {
        target.setOptions({ numHands: desiredHandCount });
      }
    } catch (error) {
      reportError(error);
    }
  }

  /**
   * Degrade or restore two-hand tracking (1 ↔ 2).
   *
   * No-op when the requested count is unchanged. When no landmarker exists
   * yet the desired count is recorded and applied the next time a
   * landmarker is created (enable() / handLandmarkerFactory path).
   *
   * @param {number} n
   */
  function setHandCount(n) {
    const next = n === 1 ? 1 : 2;

    if (next === desiredHandCount) {
      return;
    }

    desiredHandCount = next;

    if (landmarker) {
      applyHandCount(landmarker);
    }
  }

  /**
   * @returns {number} the currently desired detector hand count (1 or 2).
   */
  function getHandCount() {
    return desiredHandCount;
  }

  /**
   * Safely report an error without allowing UI/callback failures
   * to break the host application.
   *
   * @param {unknown} error
   */
  function reportError(error) {
    const normalized =
      error instanceof Error
        ? error
        : new Error(String(error ?? "Unknown Hand Lens error"));

    try {
      onError?.(normalized);
    } catch {
      // Host error handlers must never break Hand Lens cleanup.
    }
  }

  /**
   * Update the internal state and visible status.
   *
   * @param {string} nextState
   * @param {string} [message]
   */
  function setState(nextState, message) {
    if (!STATES.has(nextState)) {
      return;
    }

    state = nextState;

    if (statusLine) {
      statusLine.textContent = message || defaultStatusMessage(nextState);
    }

    if (toggleButton) {
      if (nextState === "requesting") {
        toggleButton.disabled = true;
        toggleButton.textContent = "Starting…";
      } else if (nextState === "running") {
        toggleButton.disabled = false;
        toggleButton.textContent = "Disable Hand Lens";
      } else {
        toggleButton.disabled = false;
        toggleButton.textContent = "Enable Hand Lens";
      }
    }
  }

  /**
   * @param {string} currentState
   * @returns {string}
   */
  function defaultStatusMessage(currentState) {
    switch (currentState) {
      case "requesting":
        return "Requesting camera access…";

      case "running":
        return "Hand Lens is active. Camera frames stay on this device.";

      case "denied":
        return "Camera access was denied. Pointer/touch controls remain available.";

      case "error":
        return "Hand Lens could not start. Pointer/touch controls remain available.";

      case "idle":
      default:
        return "Camera is off. Enable Hand Lens when you are ready.";
    }
  }

  /**
   * Build the small opt-in control panel.
   *
   * Nothing camera-related happens here.
   * Merely creating this panel does not request permission, create a stream,
   * import MediaPipe, or initialize the detector.
   */
  function ensurePanel() {
    if (panel?.isConnected) {
      return;
    }

    panel = document.createElement("aside");
    panel.id = "hand-lens-panel";
    panel.setAttribute("aria-label", "Hand Lens camera controls");
    panel.dataset.handLensPanel = "true";
    // Start hidden: the panel is opened explicitly from the HUD ("HAND LENS"
    // button) so it participates in the mobile single-panel rule and never
    // covers the world on load. Being an <aside> lets the mobile panel
    // manager collect and collapse it like every other floating panel.
    panel.hidden = true;

    Object.assign(panel.style, {
      position: "fixed",
      right: "12px",
      bottom: "12px",
      zIndex: "9999",
      width: "220px",
      padding: "10px",
      borderRadius: "10px",
      background: "rgba(12, 14, 18, 0.88)",
      color: "#fff",
      fontFamily: "system-ui, sans-serif",
      fontSize: "12px",
      lineHeight: "1.35",
      boxSizing: "border-box",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.25)",
    });

    const header = document.createElement("div");

    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      marginBottom: "8px",
    });

    const title = document.createElement("strong");
    title.textContent = "Hand Lens";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close Hand Lens panel");
    closeButton.title = "Close Hand Lens";

    Object.assign(closeButton.style, {
      border: "0",
      background: "transparent",
      color: "#fff",
      fontSize: "20px",
      lineHeight: "1",
      cursor: "pointer",
      padding: "0 3px",
    });

    closeButton.addEventListener("click", () => {
      disable();
      removePanel();
    });

    header.append(title, closeButton);

    toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.textContent = "Enable Hand Lens";

    Object.assign(toggleButton.style, {
      width: "100%",
      border: "0",
      borderRadius: "7px",
      padding: "7px 9px",
      cursor: "pointer",
      fontWeight: "600",
    });

    toggleButton.addEventListener("click", () => {
      if (state === "running" || state === "requesting") {
        disable();
      } else {
        void enable();
      }
    });

    statusLine = document.createElement("div");
    statusLine.setAttribute("role", "status");
    statusLine.setAttribute("aria-live", "polite");
    statusLine.textContent = defaultStatusMessage("idle");

    Object.assign(statusLine.style, {
      marginTop: "8px",
      opacity: "0.82",
    });

    panel.append(header, toggleButton, statusLine);
    document.body.appendChild(panel);
  }

  /**
   * Remove the entire control panel.
   */
  function removePanel() {
    if (panel?.isConnected) {
      panel.remove();
    }

    panel = null;
    toggleButton = null;
    statusLine = null;
  }

  /**
   * Show or hide the opt-in panel without starting the camera.
   * Used by the HUD "HAND LENS" toggle. Hiding never stops a running
   * camera session; closing via the panel's × button does (existing
   * behavior: disable() + removePanel()).
   * @param {boolean} open
   */
  function setPanelOpen(open) {
    ensurePanel();
    if (panel) panel.hidden = !open;
  }

  function isPanelOpen() {
    return Boolean(panel?.isConnected) && panel.hidden !== true;
  }

  /**
   * Create the mirrored camera preview.
   *
   * This is only called after the user has explicitly enabled Hand Lens.
   */
  function createPreview() {
    removePreview();

    video = document.createElement("video");

    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.setAttribute("aria-label", "Hand Lens camera preview");

    Object.assign(video.style, {
      position: "fixed",
      right: "12px",
      bottom: "118px",
      zIndex: "9998",
      width: "160px",
      height: "120px",
      objectFit: "cover",
      transform: "scaleX(-1)",
      borderRadius: "8px",
      background: "#000",
      display: "block",
      boxShadow: "0 4px 18px rgba(0, 0, 0, 0.3)",
    });

    document.body.appendChild(video);

    return video;
  }

  /**
   * Remove the preview element.
   */
  function removePreview() {
    if (video) {
      video.pause();
      video.srcObject = null;

      if (video.isConnected) {
        video.remove();
      }
    }

    video = null;
  }

  /**
   * Stop every media track belonging to the current stream.
   */
  function stopAllTracks() {
    if (!stream) {
      return;
    }

    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // A track that has already stopped should not prevent cleanup.
      }
    }

    stream = null;
  }

  /**
   * Cancel the detection animation loop.
   */
  function cancelDetectionLoop() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  /**
   * Notify subscribers with a zero-hand frame.
   */
  function notifyNoHands(timestamp = performance.now()) {
    notifySubscribers({
      hands: [],
      timestamp,
    });
  }

  /**
   * Notify all listeners without allowing one listener to break the others.
   *
   * @param {{hands: Array, timestamp: number}} payload
   */
  function notifySubscribers(payload) {
    for (const callback of subscribers) {
      try {
        callback(payload);
      } catch (error) {
        // Subscriber failures belong to the subscriber, not the camera lane.
        reportError(error);
      }
    }
  }

  /**
   * Normalize MediaPipe's result into the stable Hand Lens payload.
   *
   * MediaPipe returns parallel arrays:
   *   result.landmarks
   *   result.worldLandmarks
   *   result.handedness  (array of Category arrays)
   *
   * Each hand keeps the corresponding index across those arrays.
   *
   * @param {any} result
   * @param {number} timestamp
   */
  function emitDetection(result, timestamp, latencyMs = 0) {
    const landmarks = Array.isArray(result?.landmarks)
      ? result.landmarks
      : [];

    const worldLandmarks = Array.isArray(result?.worldLandmarks)
      ? result.worldLandmarks
      : [];

    const handedness = Array.isArray(result?.handedness)
      ? result.handedness
      : [];

    const hands = landmarks.map((handLandmarks, index) => ({
      landmarks: Array.isArray(handLandmarks) ? handLandmarks : [],
      worldLandmarks: Array.isArray(worldLandmarks[index])
        ? worldLandmarks[index]
        : [],
      handedness: normalizeHandedness(handedness[index]),
    }));

    notifySubscribers({
      hands,
      timestamp,
      // Wall-clock MediaPipe detectForVideo latency for this sample.
      // Feeds the perf governor's degrade/recover decisions.
      latencyMs,
    });
  }

  /**
   * Run one MediaPipe VIDEO detection.
   *
   * @param {number} token
   */
  async function detectFrame(token) {
    if (
      token !== lifecycleToken ||
      state !== "running" ||
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !landmarker ||
      detectionInFlight
    ) {
      return;
    }

    // Explicit deterministic sampling pause: never run the detector while
    // the document is hidden. The visibilitychange listener resets
    // lastDetectionTime on return, so sampling resumes cleanly.
    if (typeof document !== "undefined" && document.hidden === true) {
      return;
    }

    const now = performance.now();

    // Hand sampling is frame-skipped by the governor-adjustable interval
    // (default ~30 FPS) even though the browser's requestAnimationFrame loop
    // can run at 60/120+ FPS.
    if (now - lastDetectionTime < sampleIntervalMs) {
      return;
    }

    lastDetectionTime = now;
    detectionInFlight = true;

    try {
      const detectStart = performance.now();
      const result = landmarker.detectForVideo(video, now);
      const latencyMs = performance.now() - detectStart;

      if (token !== lifecycleToken || state !== "running") {
        return;
      }

      emitDetection(result, now, latencyMs);
    } catch (error) {
      // A transient frame/detection error should not destroy the whole app.
      // Surface it, but keep the camera lifecycle alive.
      reportError(error);
    } finally {
      detectionInFlight = false;
    }
  }

  /**
   * Continuous rAF loop.
   *
   * The rAF itself is cheap; actual MediaPipe detection is frame-skipped
   * to approximately 30 FPS by detectFrame().
   *
   * @param {number} token
   */
  function detectionLoop(token) {
    if (token !== lifecycleToken || state !== "running") {
      return;
    }

    void detectFrame(token);

    animationFrame = requestAnimationFrame(() => {
      detectionLoop(token);
    });
  }

  /**
   * Lazily load and construct the MediaPipe HandLandmarker.
   *
   * IMPORTANT:
   * This function is NEVER called during createHandCamera().
   * It is reached only from enable(), after explicit user action.
   *
   * @param {number} token
   * @returns {Promise<any>}
   */
  async function createLandmarker(token) {
    if (token !== lifecycleToken) {
      return null;
    }

    // Deterministic test seam: the injected factory replaces the entire
    // dynamic CDN import path. applyHandCount still enforces whatever
    // setHandCount() recorded before enable().
    if (typeof handLandmarkerFactory === "function") {
      const injected = await handLandmarkerFactory(token);

      if (token !== lifecycleToken) {
        return null;
      }

      applyHandCount(injected);
      return injected ?? null;
    }

    // Lazy pinned import: no MediaPipe code is loaded before enable().
    const visionModule = await import(MEDIAPIPE_MODULE_URL);

    if (token !== lifecycleToken) {
      return null;
    }

    const {
      FilesetResolver,
      HandLandmarker,
    } = visionModule;

    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

    if (token !== lifecycleToken) {
      return null;
    }

    const options = {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: desiredHandCount,
    };

    try {
      return await HandLandmarker.createFromOptions(
        vision,
        options,
      );
    } catch (gpuError) {
      // Some browsers/devices expose MediaPipe's GPU path but cannot
      // actually initialize it. Retry using CPU before failing Hand Lens.
      reportError(
        new Error(
          `Hand Lens GPU initialization failed; retrying with CPU. ${gpuError?.message || gpuError}`,
        ),
      );

      if (token !== lifecycleToken) {
        return null;
      }

      return await HandLandmarker.createFromOptions(
        vision,
        {
          ...options,
          baseOptions: {
            ...options.baseOptions,
            delegate: "CPU",
          },
        },
      );
    }
  }

  /**
   * Explicitly enable Hand Lens.
   *
   * This is the ONLY function that requests camera access and loads
   * MediaPipe.
   */
  async function enable() {
    if (state === "running" || state === "requesting") {
      return;
    }

    ensurePanel();

    const token = ++lifecycleToken;

    setState("requesting", "Requesting camera access…");

    if (
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      const error = new Error(
        "This browser does not provide camera access through getUserMedia().",
      );

      setState(
        "error",
        "Camera access is unavailable. Pointer/touch controls remain available.",
      );

      reportError(error);
      notifyNoHands();
      return;
    }

    try {
      // Explicit front-camera preference.
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });

      // The user may have disabled Hand Lens while permission was pending.
      if (token !== lifecycleToken) {
        stopAllTracks();
        return;
      }

      if (!stream || stream.getTracks().length === 0) {
        throw new Error("Camera permission was granted but no media track was returned.");
      }

      const preview = createPreview();
      preview.srcObject = stream;

      try {
        await preview.play();
      } catch (playError) {
        // Autoplay should normally succeed because the video is muted,
        // but the stream can still be useful if playback starts shortly after.
        reportError(playError);
      }

      if (token !== lifecycleToken) {
        stopAllTracks();
        removePreview();
        return;
      }

      landmarker = await createLandmarker(token);

      if (token !== lifecycleToken) {
        await closeLandmarker();
        stopAllTracks();
        removePreview();
        return;
      }

      if (!landmarker) {
        throw new Error("HandLandmarker could not be initialized.");
      }

      setState(
        "running",
        "Hand Lens is active. Camera frames stay on this device.",
      );

      lastDetectionTime = -Infinity;
      detectionInFlight = false;

      detectionLoop(token);
    } catch (error) {
      // Permission denial is expected and should never break the host app.
      const name = error?.name || "";

      const denied =
        name === "NotAllowedError" ||
        name === "PermissionDeniedError" ||
        name === "SecurityError";

      if (denied) {
        setState(
          "denied",
          "Camera access was denied. Pointer/touch controls remain available.",
        );
      } else {
        setState(
          "error",
          "Hand Lens could not start. Pointer/touch controls remain available.",
        );
      }

      reportError(error);

      cancelDetectionLoop();
      stopAllTracks();
      removePreview();

      await closeLandmarker();

      notifyNoHands();

      // Keep the lifecycle usable. A later explicit enable() can retry.
      if (token === lifecycleToken) {
        detectionInFlight = false;
      }
    }
  }

  /**
   * Close MediaPipe's detector safely.
   */
  async function closeLandmarker() {
    const currentLandmarker = landmarker;
    landmarker = null;

    if (!currentLandmarker) {
      return;
    }

    try {
      const closeResult = currentLandmarker.close?.();

      // close() is normally synchronous, but supporting a Promise here makes
      // cleanup tolerant of future/runtime variations.
      if (closeResult && typeof closeResult.then === "function") {
        await closeResult;
      }
    } catch (error) {
      reportError(error);
    }
  }

  /**
   * Disable Hand Lens and release every resource.
   *
   * This is also used by the panel's close button.
   */
  function disable() {
    // Invalidate any in-flight enable() operation.
    lifecycleToken += 1;

    cancelDetectionLoop();

    detectionInFlight = false;
    lastDetectionTime = -Infinity;

    stopAllTracks();
    removePreview();

    // MediaPipe's close() is synchronous in the current Tasks Vision API.
    // Promise-returning implementations are also tolerated by closeLandmarker().
    void closeLandmarker();

    // Back to two-hand default; the hand-session lane re-degrades if needed.
    setHandCount(2);

    notifyNoHands();

    setState("idle", "Camera is off. Enable Hand Lens when you are ready.");
  }

  /**
   * Tear the controller down permanently: remove the document visibility
   * listener and release every camera resource. Do not call enable() on a
   * destroyed controller; create a fresh one instead.
   */
  function destroy() {
    if (typeof document !== "undefined") {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    }

    disable();
  }

  /**
   * Subscribe to normalized hand frames.
   *
   * @param {(payload: {
   *   hands: Array<{
   *     landmarks: Array,
   *     worldLandmarks: Array,
   *     handedness: "Left"|"Right"
   *   }>,
   *   timestamp: number
   * }) => void} callback
   *
   * @returns {Function} unsubscribe function
   */
  function onHands(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Hand Lens onHands() requires a callback function.");
    }

    subscribers.add(callback);

    return () => {
      offHands(callback);
    };
  }

  /**
   * Remove a hand-frame subscriber.
   *
   * @param {Function} callback
   */
  function offHands(callback) {
    subscribers.delete(callback);
  }

  /**
   * Return the current lifecycle state.
   *
   * @returns {"idle"|"requesting"|"running"|"denied"|"error"}
   */
  function getState() {
    return state;
  }

  // The panel is UI-only. Creating it performs NO camera work.
  // No getUserMedia(), MediaPipe import, model loading, or detector creation
  // occurs until the user explicitly presses "Enable Hand Lens".
  if (typeof document !== "undefined") {
    ensurePanel();
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  return {
    enable,
    disable,
    destroy,
    onHands,
    offHands,
    getState,
    // Two-hand ↔ one-hand degradation for the hand-session lane.
    setHandCount,
    getHandCount,
    // Perf-governor integration: throttle MediaPipe sampling under load.
    setSampleInterval,
    // HUD integration: open/close the opt-in panel without touching camera.
    setPanelOpen,
    isPanelOpen,
  };
}
