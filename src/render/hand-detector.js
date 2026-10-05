/**
 * Worker-backed MediaPipe hands. ImageBitmaps are temporary transferable frame
 * copies, never retained or uploaded. A single in-flight sample prevents
 * backlogs; close() terminates the worker and settles every pending request.
 */
export async function createWorkerHandDetector({
  runtimeUrl, wasmPath, modelPath, numHands = 2,
  initTimeoutMs = 90_000, frameTimeoutMs = 8_000,
  coldFrameTimeoutMs = frameTimeoutMs,
  signal,
  // Classic workers let MediaPipe's unchanged Emscripten loader use
  // importScripts(), which exposes its ModuleFactory on the worker global.
  // The worker itself dynamically imports the vendored ESM task runtime.
  workerFactory = (url) => new Worker(url),
  bitmapFactory = (video) => createImageBitmap(video),
} = {}) {
  const worker = workerFactory(new URL("./hand-detector-worker.js", import.meta.url));
  let closed = false;
  let busy = false;
  let sequence = 0;
  let cold = true;
  const pending = new Map();

  function close() {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", close);
    worker.removeEventListener?.("message", onMessage);
    worker.removeEventListener?.("error", onError);
    worker.removeEventListener?.("messageerror", onError);
    worker.terminate?.();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      const error = new Error("Hand detector stopped.");
      error.name = "AbortError";
      request.reject(error);
    }
    pending.clear();
  }

  function onMessage(event) {
    const response = event.data;
    const request = pending.get(response?.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(response.id);
    if (response.error) {
      const error = new Error(response.error.message || "Hand worker failed.");
      error.code = response.error.code || "hand_worker_error";
      request.reject(error);
    } else request.resolve(response.result);
  }

  function onError() {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      const error = new Error("Hand worker could not run. Check browser worker support and local model files.");
      error.code = "hand_worker_error";
      request.reject(error);
    }
    pending.clear();
    close();
  }

  function request(type, payload, transfers = [], timeoutMs = frameTimeoutMs) {
    if (closed) return Promise.reject(Object.assign(new Error("Hand detector stopped."), { name: "AbortError" }));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error("Hand worker request timed out.");
        error.code = type === "init" ? "model_timeout" : "hand_frame_timeout";
        reject(error);
        close();
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, type, ...payload }, transfers); }
      catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onError);
  signal?.addEventListener("abort", close, { once: true });
  if (signal?.aborted) close();
  let initialized;
  try {
    initialized = await request("init", { runtimeUrl, wasmPath, modelPath, numHands }, [], initTimeoutMs);
  } catch (error) {
    close();
    throw error;
  }

  return {
    delegate: initialized.delegate,
    async detectForVideo(video, timestamp) {
      if (closed || busy) return null;
      busy = true;
      let bitmap = null;
      let transferred = false;
      try {
        bitmap = await bitmapFactory(video);
        if (closed) return null;
        const result = await request("detect", { bitmap, timestamp }, [bitmap], cold ? coldFrameTimeoutMs : frameTimeoutMs);
        transferred = true;
        if (result?.landmarks?.length) cold = false;
        return result;
      } finally {
        // Transferred bitmaps are closed by the worker. A failed capture/post
        // or capture that resolves after close still belongs to this caller.
        if (bitmap && !transferred) {
          try { bitmap.close?.(); } catch { /* already transferred */ }
        }
        busy = false;
      }
    },
    setOptions(options) {
      return request("options", { options });
    },
    close,
  };
}
