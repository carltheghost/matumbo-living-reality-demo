/* Two hand, 21-landmark local inference in a phone-owned module Worker. */
let model = null;
let activeDelegate = 'CPU';

async function createModel() {
  const base = new URL('../vendor/field-lab/', import.meta.url);
  const vision = await import(new URL('vision_bundle.mjs', base).href);
  const wasm = new URL('wasm', base).href;
  const modelAssetPath = new URL('hand_landmarker.task', base).href;
  const files = await vision.FilesetResolver.forVisionTasks(wasm);
  const options = {
    canvas: new OffscreenCanvas(256, 256),
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    model = await vision.HandLandmarker.createFromOptions(files, {
      ...options, baseOptions: { modelAssetPath, delegate: 'GPU' },
    });
    activeDelegate = 'GPU';
  } catch {
    model = await vision.HandLandmarker.createFromOptions(files, {
      ...options, baseOptions: { modelAssetPath, delegate: 'CPU' },
    });
    activeDelegate = 'CPU/WASM';
  }
  self.postMessage({ type: 'ready', maxHands: 2, landmarksPerHand: 21, delegate: activeDelegate });
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try { await createModel(); }
    catch (error) { self.postMessage({ type: 'error', message: error?.message || 'Hand model could not start.' }); }
    return;
  }
  if (data.type !== 'frame') return;
  const begin = performance.now();
  try {
    if (!model) throw new Error('Local hand model is not initialized.');
    const result = model.detectForVideo(data.image, data.time);
    const hands = (result.landmarks || []).slice(0, 2).map((points, index) => {
      const category = result.handednesses?.[index]?.[0];
      return {
        landmarks: points.slice(0, 21),
        handedness: category?.categoryName || category?.displayName || null,
        confidence: Number.isFinite(category?.score) ? category.score : null,
      };
    });
    self.postMessage({
      type: 'result', sequence: data.sequence, time: data.time,
      inferenceMs: performance.now() - begin, delegate: activeDelegate,
      maxHands: 2, landmarksPerHand: 21, hands,
      landmarks: hands.map(hand => hand.landmarks),
      handednesses: hands.map(hand => ({ categoryName: hand.handedness, score: hand.confidence })),
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Local hand inference failed.' });
  } finally {
    data.image?.close?.();
  }
};

