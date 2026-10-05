/**
 * Production hand inference worker. All model work and detectForVideo calls
 * stay off the main thread. Messages run serially; every bitmap is closed.
 */
let detector = null;
let queue = Promise.resolve();

async function handle({ id, type, ...payload }) {
  try {
    if (type === "init") {
      const { FilesetResolver, HandLandmarker } = await import(payload.runtimeUrl);
      const vision = await FilesetResolver.forVisionTasks(payload.wasmPath.replace(/\/+$/, ""));
      const common = { runningMode: "VIDEO", numHands: payload.numHands };
      let delegate = "GPU-worker";
      try {
        const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1) : undefined;
        detector = await HandLandmarker.createFromOptions(vision, {
          ...common, ...(canvas ? { canvas } : {}),
          baseOptions: { modelAssetPath: payload.modelPath, delegate: "GPU" },
        });
      } catch {
        delegate = "CPU-worker";
        detector = await HandLandmarker.createFromOptions(vision, {
          ...common, baseOptions: { modelAssetPath: payload.modelPath, delegate: "CPU" },
        });
      }
      self.postMessage({ id, result: { delegate } });
      return;
    }
    if (!detector) throw new Error("Hand model is not initialized.");
    if (type === "options") {
      await detector.setOptions(payload.options);
      self.postMessage({ id, result: null });
      return;
    }
    if (type === "detect") {
      try {
        const result = detector.detectForVideo(payload.bitmap, payload.timestamp);
        self.postMessage({ id, result });
      } finally { payload.bitmap.close(); }
      return;
    }
    throw new Error("Unknown hand worker request.");
  } catch (error) {
    self.postMessage({ id, error: {
      code: type === "init" ? "model_unavailable" : "hand_detection_failed",
      message: String(error?.message || error).slice(0, 240),
    } });
  }
}

self.addEventListener("message", (event) => {
  queue = queue.then(() => handle(event.data));
});
