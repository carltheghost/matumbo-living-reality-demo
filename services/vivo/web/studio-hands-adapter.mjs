/*
 * Additive two-hand adapter for the mounted Full Studio.
 *
 * The imported Studio and its compact camera client are integrity-pinned. This
 * module is loaded only by the canonical localhost mount, after FieldApp has
 * booted, and owns the multi-hand worker/input seam without replacing the
 * Studio renderer, history, or physics state.
 *
 * The detector is deliberately bounded to two hands. One-hand pinch remains
 * the existing labelled-node/field grab path. Two deliberate simultaneous
 * pinches become a view gesture (zoom, pan, and bounded yaw rotation); they
 * release any one-hand grab before moving the view. Camera frames and raw
 * landmarks never leave this page.
 */

const MAX_HANDS = 2;
const DEFAULT_OPEN = .42;
const DEFAULT_CLOSE = .28;
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[0,17],[17,18],[18,19],[19,20]];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
  && Number.isFinite(point.z ?? 0);
const distance = (a, b, aspect = 1) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
const wrapAngle = angle => {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
};

function centerOf(points) {
  const indices = [0, 5, 9, 13, 17];
  const selected = indices.map(index => points[index]).filter(finitePoint);
  if (!selected.length) return null;
  return {
    x: selected.reduce((sum, point) => sum + point.x, 0) / selected.length,
    y: selected.reduce((sum, point) => sum + point.y, 0) / selected.length,
  };
}
function labelOf(entry) {
  const value = Array.isArray(entry) ? entry[0] : entry;
  const label = value?.categoryName ?? value?.label ?? value?.displayName;
  return typeof label === 'string' && /^(left|right)$/i.test(label) ? label.toLowerCase() : null;
}

function confidenceOf(entry) {
  const value = Array.isArray(entry) ? entry[0] : entry;
  const score = Number(value?.score ?? value?.confidence);
  return Number.isFinite(score) ? clamp(score, 0, 1) : 1;
}

/**
 * Validate, cap, and identity-match a MediaPipe result. Handedness is the
 * primary identity; proximity to the previous frame is the fallback for
 * virtual/older runtimes that omit handedness metadata.
 */
export function normalizeHandCandidates(rawHands, handednesses = [], previous = [], aspect = 1) {
  if (!Array.isArray(rawHands)) return [];
  const candidates = rawHands.slice(0, MAX_HANDS).map((points, index) => {
    const valid = Array.isArray(points) && points.length === 21
      && points.every(point => finitePoint(point)
        && point.x >= -.2 && point.x <= 1.2 && point.y >= -.2 && point.y <= 1.2);
    if (!valid) return null;
    const palmSpan = distance(points[5], points[17], aspect);
    if (!(palmSpan > .015)) return null;
    const center = centerOf(points);
    if (!center) return null;
    return {
      points,
      sourceIndex: index,
      label: labelOf(handednesses[index]),
      confidence: confidenceOf(handednesses[index]),
      center,
      palmSpan,
      pinchRatio: distance(points[4], points[8], aspect) / palmSpan,
    };
  }).filter(Boolean).filter(hand => hand.confidence >= .5);

  const old = Array.isArray(previous) ? previous : [];
  const used = new Set();
  const result = [];
  const nearest = candidate => old
    .map((entry, index) => ({entry, index, distance: entry.center ? distance(candidate.center, entry.center, aspect) : Infinity}))
    .filter(item => !used.has(item.index))
    .sort((a, b) => a.distance - b.distance)[0];

  for (const candidate of candidates) {
    let identity = null;
    if (candidate.label) {
      const match = old.findIndex((entry, index) => !used.has(index) && entry.label === candidate.label);
      if (match >= 0) {
        used.add(match);
        identity = old[match].id;
      }
      identity ??= 'hand:' + candidate.label;
    } else {
      const match = nearest(candidate);
      if (match && match.distance <= .42) {
        used.add(match.index);
        identity = match.entry.id;
      }
    }
    if (!identity) {
      const occupied = new Set([...old.map(entry => entry.id), ...result.map(entry => entry.id)]);
      identity = ['hand:left', 'hand:right', 'hand:0', 'hand:1'].find(id => !occupied.has(id)) ?? 'hand:0';
    }
    result.push({...candidate, id: identity});
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Hysteretic two-hand view recognizer. It requires open-palm arming followed
 * by several closed frames, then releases on a short open/lost run. All output
 * deltas are bounded for touch-sized mobile frames.
 */
export class TwoHandGestureGate {
  constructor({open = DEFAULT_OPEN, close = DEFAULT_CLOSE, armFrames = 3, pressFrames = 3, releaseFrames = 2} = {}) {
    this.open = open; this.close = close; this.armFrames = armFrames;
    this.pressFrames = pressFrames; this.releaseFrames = releaseFrames;
    this.reset();
  }
  reset() {
    this.armed = false; this.mode = 'idle'; this.openFrames = 0;
    this.pressFramesSeen = 0; this.releaseFramesSeen = 0; this.previous = null;
  }
  metrics(hands, aspect = 1) {
    if (!Array.isArray(hands) || hands.length !== 2 || hands.some(hand => !hand?.center)) return null;
    const [a, b] = hands;
    const span = distance(a.center, b.center, aspect);
    if (!(span > .04 && Number.isFinite(span))) return null;
    const center = {x: (a.center.x + b.center.x) / 2, y: (a.center.y + b.center.y) / 2};
    const angle = Math.atan2(b.center.y - a.center.y, (b.center.x - a.center.x) * aspect);
    return {span, center, angle};
  }
  update(hands, aspect = 1) {
    const valid = Array.isArray(hands) && hands.length === 2
      && hands.every(hand => hand && hand.confidence >= .5 && Number.isFinite(hand.pinchRatio));
    const metrics = valid ? this.metrics(hands, aspect) : null;
    if (!metrics) {
      const wasActive = this.mode === 'view';
      this.reset();
      return {type: wasActive ? 'lost' : 'idle', mode: 'idle'};
    }
    const bothOpen = hands.every(hand => hand.pinchRatio >= this.open);
    const bothClosed = hands.every(hand => hand.pinchRatio <= this.close);
    if (this.mode === 'view') {
      if (bothOpen) this.releaseFramesSeen++; else this.releaseFramesSeen = 0;
      if (this.releaseFramesSeen >= this.releaseFrames) {
        this.reset();
        return {type: 'release', mode: 'idle'};
      }
      const previous = this.previous;
      this.previous = metrics;
      if (!previous) return {type: 'update', mode: 'view', zoom: 0, pan: [0, 0], rotate: 0};
      const zoom = clamp(-Math.log(metrics.span / Math.max(.04, previous.span)) / .00075, -120, 120);
      const pan = [clamp((metrics.center.x - previous.center.x) * 1440, -64, 64),
        clamp((metrics.center.y - previous.center.y) * 1000, -64, 64)];
      const rotate = clamp(wrapAngle(metrics.angle - previous.angle) * 240, -48, 48);
      return {type: 'update', mode: 'view', zoom, pan, rotate};
    }
    if (bothOpen) {
      this.openFrames++;
      if (this.openFrames >= this.armFrames) this.armed = true;
    } else {
      this.openFrames = 0;
    }
    if (bothClosed && this.armed) this.pressFramesSeen++; else this.pressFramesSeen = 0;
    if (this.pressFramesSeen >= this.pressFrames) {
      this.mode = 'view'; this.releaseFramesSeen = 0; this.previous = metrics;
      return {type: 'start', mode: 'view', zoom: 0, pan: [0, 0], rotate: 0};
    }
    return {type: this.armed ? 'armed' : 'idle', mode: 'idle'};
  }
}

function workerProgram() {
  let model = null;
  self.onmessage = async ({data: message}) => {
    if (message.type === 'init') {
      try {
        const vision = await import(message.bundle);
        const files = await vision.FilesetResolver.forVisionTasks(message.wasm);
        model = await vision.HandLandmarker.createFromOptions(files, {
          canvas: new OffscreenCanvas(256, 256),
          baseOptions: {modelAssetPath: message.model, delegate: 'CPU'},
          runningMode: 'VIDEO', numHands: 2,
          minHandDetectionConfidence: .5, minHandPresenceConfidence: .5,
          minTrackingConfidence: .5,
        });
        self.postMessage({type: 'ready', maxHands: 2});
      } catch (error) {
        self.postMessage({type: 'error', message: error?.message || String(error)});
      }
      return;
    }
    if (message.type !== 'frame') return;
    const begin = performance.now();
    try {
      if (!model) throw Error('Hand model is not initialized');
      const result = model.detectForVideo(message.image, message.time);
      self.postMessage({type: 'result', sequence: message.sequence, time: message.time,
        inferenceMs: performance.now() - begin, landmarks: result.landmarks || [],
        handednesses: result.handednesses || result.handedness || []});
    } catch (error) {
      self.postMessage({type: 'error', message: error?.message || String(error)});
    } finally {
      message.image?.close?.();
    }
  };
}

const root = globalThis;
const presence = root.FieldApp?.presence;

if (presence && !root.__vivoStudioHandsAdapter) {
  const state = {
    version: 'vivo-studio-hands/1', maxHands: MAX_HANDS, backend: 'off',
    epoch: 0, frameIds: 0, lastSequence: 0, busy: false, sentAt: 0,
    frameAt: 0, worker: null, workerUrl: null, mainFrame: 0, detector: null,
    initReject: null, initTimer: 0, lastHands: [], twoHandSeen: false,
    gate: new TwoHandGestureGate(), lastError: null,
  };
  root.__vivoStudioHandsAdapter = state;

  const oldDisable = presence.disableTracking.bind(presence);
  const oldTrack = presence.track.bind(presence);
  const oldDrawHands = presence.drawHands.bind(presence);
  const oldFeedback = presence.feedback.bind(presence);
  const oldDiagnostics = presence.diagnostics.bind(presence);
  const oldLost = presence.lost.bind(presence);

  function resetGesture() {
    state.gate.reset(); state.lastHands = []; state.twoHandSeen = false;
  }
  function stopRuntime() {
    state.epoch++;
    if (state.worker) state.worker.terminate();
    state.worker = null;
    if (state.workerUrl) URL.revokeObjectURL(state.workerUrl);
    state.workerUrl = null;
    if (state.mainFrame) cancelAnimationFrame(state.mainFrame);
    state.mainFrame = 0;
    if (state.detector) { try { state.detector.close?.(); } catch {} }
    state.detector = null;
    state.busy = false;
    state.initReject?.(Error('Tracking cancelled'));
    state.initReject = null;
    clearTimeout(state.initTimer);
    resetGesture();
  }
  function status(text) {
    presence.message = text;
    const live = document.getElementById('liveCameraState');
    const camera = document.getElementById('cameraStatus');
    if (live) live.textContent = text;
    if (camera) camera.textContent = text;
  }
  function handText(hands, mode = 'idle') {
    if (!hands.length) return 'NO HANDS DETECTED - show both hands or one open hand';
    const labels = hands.map(hand => `${hand.label || hand.id} ${Math.round(hand.confidence * 100)}%`).join(' / ');
    if (mode === 'view') return `2 HANDS - VIEW PINCH ${labels}`;
    if (mode === 'armed') return `2 HANDS - OPEN PALMS ARMED, PINCH BOTH ${labels}`;
    if (hands.length > 1) return `2 HANDS - SHOW OPEN PALMS TO ARM ${labels}`;
    return `1 HAND - AIM, PINCH TO GRAB, OPEN TO RELEASE ${labels}`;
  }
  function applyView(action) {
    const nav = presence.nav;
    const renderer = nav?.r;
    if (!nav || !renderer) return;
    try {
      if (Math.abs(action.zoom) > .001) nav.zoom(action.zoom);
      if (Math.hypot(...action.pan) > .001) nav.move(-action.pan[0], action.pan[1], 0, renderer.camera.distance * .0017);
      if (Math.abs(action.rotate) > .001) nav.look(action.rotate, 0);
    } catch (error) {
      state.lastError = {stage: 'view', message: error?.message || String(error)};
      presence.lost();
      status('Two-hand view released - view transform was unavailable.');
    }
  }
  function processHands(raw, handednesses, age) {
    const aspect = (presence.video?.videoWidth || 640) / (presence.video?.videoHeight || 480);
    const hands = normalizeHandCandidates(raw, handednesses, state.lastHands, aspect);
    state.lastHands = hands;
    presence.handCount = hands.length;
    presence.handIdentity = hands.map(hand => ({id: hand.id, handedness: hand.label, confidence: hand.confidence}));
    presence.drawHands(raw || []);
    if (!hands.length) {
      if (state.twoHandSeen || presence.held) presence.lost();
      resetGesture(); status('NO FRESH HAND - object grabs released safely');
      return;
    }
    if (hands.length === 1) {
      if (state.twoHandSeen) presence.lost();
      resetGesture(); state.lastHands = hands;
      // Preserve the reviewed one-hand authority path: it alone starts and
      // moves a GripHost/InputSources lease for a labelled object.
      presence.consumeHand(hands[0].points);
      status(handText(hands, 'idle'));
      return;
    }
    if (!state.twoHandSeen) {
      state.twoHandSeen = true;
      // End a one-hand authority grip before view mode without clearing the
      // two-hand transition marker itself.
      oldLost('Two-hand view selected');
    }
    presence.nav.clearPointer(); presence.nav.aim = false; presence.held = false;
    const action = state.gate.update(hands, aspect);
    if (action.type === 'lost' || action.type === 'release') {
      presence.lost(); status('TWO-HAND VIEW RELEASED - open or re-show both hands');
      return;
    }
    if (action.type === 'update') applyView(action);
    status(handText(hands, action.mode === 'view' ? 'view' : action.type));
  }
  function receive(message, epoch) {
    if (epoch !== state.epoch || !presence.stream) return;
    if (message.type === 'result') {
      state.busy = false;
      if (message.sequence <= state.lastSequence) return;
      state.lastSequence = message.sequence;
      const age = performance.now() - message.time;
      presence.roundTrip = age; presence.inferenceMs = message.inferenceMs; presence.inferences++;
      if (age > 240) { presence.lost(); status('HAND RESULT TOO OLD - waiting for a fresh frame'); return; }
      processHands(message.landmarks || [], message.handednesses || [], age);
      if (performance.now() - presence.lastFeedback > 180) {
        presence.lastFeedback = performance.now(); presence.feedback();
      }
    } else if (message.type === 'error') {
      state.lastError = {stage: 'worker', message: message.message};
      presence.disableTracking('Hand worker stopped: ' + message.message + '. Touch remains available.');
    }
  }
  function pump(epoch, now) {
    if (epoch !== state.epoch || !state.worker || !presence.stream) return;
    presence.frameId = requestAnimationFrame(time => pump(epoch, time));
    if (document.hidden) return;
    const interval = clamp((presence.inferenceMs || 20) * 1.12, 33, 100);
    if (state.busy) {
      if (now - state.sentAt > 1200) presence.lost();
      return;
    }
    if (now - state.frameAt < interval || presence.video.readyState < 2
        || presence.video.currentTime === presence.lastTime) return;
    state.frameAt = now; presence.lastTime = presence.video.currentTime; state.busy = true; state.sentAt = now;
    const sequence = ++state.frameIds, width = presence.video.videoWidth, height = presence.video.videoHeight;
    if (!width || !height) { state.busy = false; return; }
    const scale = Math.min(1, 480 / Math.max(width, height));
    createImageBitmap(presence.video, {resizeWidth: Math.max(1, Math.round(width * scale)),
      resizeHeight: Math.max(1, Math.round(height * scale)), resizeQuality: 'low'}).then(image => {
      if (epoch !== state.epoch || !state.worker || !presence.stream) { image.close(); return; }
      state.worker.postMessage({type: 'frame', image, time: now, sequence}, [image]);
    }).catch(error => {
      if (epoch === state.epoch) { state.busy = false; presence.disableTracking('Camera frame transfer failed: ' + error.message); }
    });
  }
  function mainLoop(epoch, now) {
    if (epoch !== state.epoch || !state.detector || !presence.stream) return;
    state.mainFrame = requestAnimationFrame(time => mainLoop(epoch, time));
    const interval = clamp((presence.inferenceMs || 20) * 1.4, 42, 160);
    if (now - state.frameAt < interval || presence.video.readyState < 2
        || presence.video.currentTime === presence.lastTime) return;
    state.frameAt = now; presence.lastTime = presence.video.currentTime;
    try {
      const started = performance.now(), result = state.detector.detectForVideo(presence.video, now);
      presence.inferenceMs = performance.now() - started; presence.inferences++;
      receive({type: 'result', sequence: ++state.frameIds, time: now,
        inferenceMs: presence.inferenceMs, landmarks: result.landmarks || [],
        handednesses: result.handednesses || result.handedness || []}, epoch);
    } catch (error) {
      state.lastError = {stage: 'main', message: error?.message || String(error)};
      presence.disableTracking('Inference stopped: ' + (error?.message || String(error)));
    }
  }
  async function startMainThread(id, epoch) {
    const loaded = await presence.loadVision();
    const bytes = await presence.modelBytes('hand', loaded.local, new AbortController().signal);
    const files = await loaded.vision.FilesetResolver.forVisionTasks(loaded.wasm);
    const detector = await loaded.vision.HandLandmarker.createFromOptions(files, {
      baseOptions: {modelAssetBuffer: bytes, delegate: 'CPU'}, runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5,
    });
    if (id !== presence.modelId || epoch !== state.epoch || !presence.stream) { detector.close(); return false; }
    state.backend = 'main-thread CPU / 2 hands'; state.detector = detector; presence.detector = {close: () => {}};
    presence.kind = 'hand'; presence.modelState = 'READY'; presence.loading = false; presence.inferences = 0;
    presence.inferenceMs = 0; presence.lastTime = -1; state.lastSequence = 0;
    presence.status('Two-hand model ready. Open palms arm view; one-hand pinch grabs.');
    mainLoop(epoch, performance.now()); return true;
  }
  async function startHand() {
    if (!presence.stream || presence.loading) return false;
    presence.disableTracking();
    const id = ++presence.modelId, epoch = ++state.epoch;
    presence.loading = true; presence.modelState = 'LOADING'; presence.updateButtons();
    presence.status('Loading bounded two-hand model in a local worker.');
    try {
      if (!root.Worker || !root.OffscreenCanvas || !root.createImageBitmap) {
        const result = await startMainThread(id, epoch);
        if (!result) return false;
        return true;
      }
      state.workerUrl = URL.createObjectURL(new Blob(['(' + workerProgram.toString() + ')()'], {type: 'text/javascript'}));
      const worker = new Worker(state.workerUrl); state.worker = worker; state.backend = 'worker CPU / 2 hands';
      const assets = root.FieldHandAssets || {bundle: root.CameraAssetManifest.bundle, wasm: root.CameraAssetManifest.wasm, model: root.CameraAssetManifest.hand};
      await new Promise((resolve, reject) => {
        state.initReject = reject;
        state.initTimer = setTimeout(() => reject(Error('Two-hand model timed out. Check local assets and retry.')), 55000);
        worker.onmessage = event => {
          const message = event.data;
          if (message.type === 'ready') { clearTimeout(state.initTimer); state.initReject = null; resolve(); }
          else if (message.type === 'error' && presence.loading) { clearTimeout(state.initTimer); reject(Error(message.message)); }
          else receive(message, epoch);
        };
        worker.onerror = event => reject(Error(event.message || 'Two-hand worker unavailable'));
        worker.postMessage({type: 'init', ...assets});
      });
      if (id !== presence.modelId || epoch !== state.epoch || !presence.stream) return false;
      presence.detector = {close: () => {}}; presence.kind = 'hand'; presence.modelState = 'READY';
      presence.loading = false; presence.inferences = 0; presence.inferenceMs = 0; presence.lastTime = -1;
      state.lastSequence = 0; state.frameIds = 0;
      presence.status('Two-hand model ready. Open palms arm view; one-hand pinch grabs.'); presence.updateButtons();
      pump(epoch, performance.now()); return true;
    } catch (error) {
      state.lastError = {stage: 'model', message: error?.message || String(error)};
      stopRuntime(); presence.loading = false; presence.modelState = 'FAILED'; presence.kind = 'none';
      presence.lost(); presence.status('Two-hand tracking unavailable: ' + (error?.message || String(error)) + '. Touch remains available.');
      presence.updateButtons(); return false;
    }
  }

  presence.disableTracking = function(message) {
    stopRuntime();
    const result = oldDisable(message);
    state.backend = 'off';
    return result;
  };
  presence.track = function(kind) { return kind === 'hand' ? startHand.call(this) : oldTrack(kind); };
  presence.drawHands = function(hands) {
    oldDrawHands(hands);
    if (!document.getElementById('showHandSkeleton')?.checked || !state.lastHands.length) return;
    const width = innerWidth, height = innerHeight, context = this.ctx;
    context.save(); context.font = '10px ui-monospace,monospace'; context.textAlign = 'left';
    for (const hand of state.lastHands) {
      const wrist = this.mapPoint(hand.points[0].x, hand.points[0].y);
      context.fillStyle = hand.label === 'left' ? '#ffe0a1' : '#9ce8ff';
      context.fillText(`${hand.label || hand.id} ${Math.round(hand.confidence * 100)}%`, wrist.x * width + 8, wrist.y * height - 8);
      for (const index of [4, 8, 12, 16, 20]) {
        const point = this.mapPoint(hand.points[index].x, hand.points[index].y);
        context.beginPath(); context.arc(point.x * width, point.y * height, index === 8 ? 6 : 4, 0, Math.PI * 2); context.stroke();
      }
    }
    context.restore();
  };
  presence.feedback = function() {
    if (this.kind !== 'hand') return oldFeedback();
    const mode = state.gate.mode === 'view' ? 'view' : state.gate.armed ? 'armed' : 'idle';
    status(handText(state.lastHands, mode));
    this.updateButtons(); this.diagnostics();
  };
  presence.diagnostics = function() {
    const data = oldDiagnostics();
    data.multiHand = {schema: 'vivo.studio-hands/1', maxHands: MAX_HANDS,
      ids: state.lastHands.map(hand => hand.id),
      handedness: state.lastHands.map(hand => hand.label),
      confidence: state.lastHands.map(hand => hand.confidence), mode: state.gate.mode,
      armed: state.gate.armed, backend: state.backend, lastError: state.lastError};
    const output = document.getElementById('diagnosticsText');
    if (output) output.textContent = JSON.stringify(data, null, 2);
    return data;
  };
  // Keep the original interruption/loss safeguards while ensuring two-hand
  // state is fenced before any camera stop or XR handoff.
  presence.lost = function(...args) {
    state.gate.reset(); state.twoHandSeen = false; state.lastHands = [];
    return oldLost(...args);
  };
}
