/** Classic worker entry: the pinned Tasks WASM loader uses importScripts.
 * The API remains a local dynamic ESM import. No camera, storage or uploads.
 * Project-authored adapter; vendored runtime/model provenance lives in
 * assets/models/vision/provenance.json. Public API reference:
 * https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
 */
let landmarker = null;
globalThis.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'init') {
      const { FaceLandmarker, FilesetResolver } = await import(data.assets.moduleUrl);
      const vision = await FilesetResolver.forVisionTasks(data.assets.wasmUrl.replace(/\/+$/, ''));
      // Detect up to two so a second visible face can invalidate one-person
      // calibration. The estimator accepts exactly one and smooths it itself.
      landmarker = await FaceLandmarker.createFromOptions(vision, { ...data.options,
        baseOptions: { modelAssetPath: data.assets.modelUrl, delegate: data.delegate }, canvas: new OffscreenCanvas(1, 1) });
      globalThis.postMessage({ id, result: { ready: true } });
    } else if (type === 'frame' && landmarker) {
      let result;
      try { result = landmarker.detectForVideo(data.bitmap, data.timestamp); } finally { data.bitmap.close(); }
      globalThis.postMessage({ id, result });
    } else throw new Error('invalid-worker-operation');
  } catch {
    try { data.bitmap?.close?.(); } catch {}
    globalThis.postMessage({ id, error: type === 'init' ? 'local-model-initialization-failed' : 'local-frame-detection-failed' });
  }
};
