import { describeHand, matchHands, twoHandTransform, MAX_HAND_MISSING_FRAMES } from './hand-gestures.mjs';

const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const COLORS = ['#7ee2c3', '#e2ba76'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const palmCenter = points => [0,5,9,13,17].reduce((out, i) => [out[0] + points[i].x / 5, out[1] + points[i].y / 5], [0,0]);

/** Phone-owned, local camera and inference pipeline. */
export class PhoneTwoHandCamera {
  constructor({ video, overlay, renderer, onState = () => {}, onGesture = () => {}, onHands = () => {}, scope = globalThis } = {}) {
    this.video = video; this.overlay = overlay; this.renderer = renderer; this.onState = onState;
    this.onGesture = onGesture; this.onHands = onHands; this.scope = scope;
    this.stream = null; this.worker = null; this.ready = false; this.epoch = 0; this.frame = 0;
    this.busy = false; this.sequence = 0; this.lastFrameAt = 0; this.facing = 'user';
    this.previous = [null, null]; this.lastPose = new Map(); this.held = new Set(); this.armed = new Set();
    this.lastTwoHand = null; this.swipeStart = new Map(); this.lastSwipe = 0; this.hands = [];
    this.ctx = overlay?.getContext?.('2d') || null;
    if (overlay) Object.assign(overlay.style, { display: 'none', pointerEvents: 'none' });
    this.onResize = () => this.resizeOverlay();
    this.scope.addEventListener?.('resize', this.onResize);
    this.scope.addEventListener?.('pagehide', () => this.stop('Page closed; camera released'));
  }

  get active() { return !!this.stream && !!this.worker && this.ready; }

  resizeOverlay() {
    if (!this.overlay) return;
    const rect = this.scope.document?.getElementById('world')?.getBoundingClientRect?.()
      || this.scope.document?.documentElement?.getBoundingClientRect?.()
      || { left: 0, top: 0, width: this.scope.innerWidth || 1, height: this.scope.innerHeight || 1 };
    const ratio = Math.max(1, Math.min(3, this.scope.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio));
    if (this.overlay.width !== width || this.overlay.height !== height) {
      this.overlay.width = width; this.overlay.height = height;
    }
    Object.assign(this.overlay.style, {
      position: 'fixed', left: String(rect.left) + 'px', top: String(rect.top) + 'px',
      width: String(rect.width) + 'px', height: String(rect.height) + 'px',
      pointerEvents: 'none', zIndex: '4', display: 'block',
    });
  }

  screenPoint(point) {
    const rect = this.scope.document?.getElementById('world')?.getBoundingClientRect?.()
      || { left: 0, top: 0, width: this.scope.innerWidth || 1, height: this.scope.innerHeight || 1 };
    const vw = this.video.videoWidth || 640, vh = this.video.videoHeight || 480;
    const scale = Math.max(rect.width / vw, rect.height / vh);
    const x = (this.facing === 'user' ? 1 - point.x : point.x) * vw * scale - (vw * scale - rect.width) / 2;
    const y = point.y * vh * scale - (vh * scale - rect.height) / 2;
    return [rect.left + x, rect.top + y];
  }

  async start(facing = 'user') {
    this.stop('Starting local hand tracker…');
    const epoch = this.epoch;
    this.facing = facing;
    try {
      if (!['https:', 'http:'].includes(this.scope.location?.protocol) || !this.scope.isSecureContext || !this.scope.navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Use Viva over HTTPS (or localhost) and allow camera access.');
      }
      if (typeof this.scope.createImageBitmap !== 'function' || typeof this.scope.Worker !== 'function') {
        throw new Error('This browser needs ImageBitmap and Workers for local hand tracking.');
      }
      this.onState('Waiting for camera permission…');
      let stream;
      try {
        stream = await this.scope.navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
        });
      } catch (error) {
        if (error.name !== 'OverconstrainedError') throw error;
        stream = await this.scope.navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facing } });
      }
      if (epoch !== this.epoch) { stream.getTracks().forEach(track => track.stop()); return false; }
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      this.facing = track?.getSettings?.().facingMode || facing;
      track?.addEventListener?.('ended', () => { if (epoch === this.epoch) this.stop('Camera disconnected'); });
      this.video.srcObject = stream;
      this.video.muted = true; this.video.playsInline = true;
      this.video.style.transform = this.facing === 'user' ? 'scaleX(-1)' : 'none';
      await this.video.play();
      if (epoch !== this.epoch) return false;
      if (!this.video.videoWidth) await new Promise((resolve, reject) => {
        const timeout = this.scope.setTimeout(() => reject(new Error('Camera did not produce a video frame.')), 5000);
        const loaded = () => { this.scope.clearTimeout(timeout); resolve(); };
        this.video.addEventListener('loadedmetadata', loaded, { once: true });
        if (this.video.videoWidth) loaded();
      });

      const worker = new this.scope.Worker(new URL('./two-hand-worker.mjs', import.meta.url), {
        type: 'module', name: 'vivo-local-two-hand-tracker',
      });
      this.worker = worker; this.ready = false;
      await new Promise((resolve, reject) => {
        const timeout = this.scope.setTimeout(() => reject(new Error('Local hand model initialization timed out.')), 15000);
        worker.onmessage = ({ data }) => {
          if (epoch !== this.epoch) return;
          if (data.type === 'ready') {
            this.ready = true; this.scope.clearTimeout(timeout); resolve(data);
            return;
          }
          if (data.type === 'error') {
            this.busy = false;
            this.onState('Local hand tracker: ' + data.message);
            if (!this.ready) { this.scope.clearTimeout(timeout); reject(new Error(data.message)); }
            return;
          }
          if (data.type === 'result') {
            this.busy = false;
            this.consume(data);
          }
        };
        worker.onerror = error => {
          this.busy = false; this.scope.clearTimeout(timeout);
          reject(new Error(error.message || 'Local hand worker failed.'));
        };
        worker.postMessage({ type: 'init' });
      });
      if (epoch !== this.epoch) return false;
      this.scope.document?.body?.classList?.add('camera-live');
      if (this.video?.style) this.video.style.display = 'block';
      this.resizeOverlay(); this.onState('Local tracking active · 2 hands · 21 landmarks each · 5 fingers per hand · frames stay on this phone.');
      this.schedule(epoch);
      return true;
    } catch (error) {
      if (epoch === this.epoch) this.stop('Hand tracking stopped: ' + error.message);
      throw error;
    }
  }

  schedule(epoch) {
    if (epoch !== this.epoch || !this.worker || !this.stream) return;
    const now = this.scope.performance?.now?.() ?? Date.now();
    if (!this.busy && now - this.lastFrameAt >= 35 && this.video.readyState >= 2) {
      this.lastFrameAt = now; this.busy = true;
      const sequence = ++this.sequence;
      this.scope.createImageBitmap(this.video).then(image => {
        if (epoch !== this.epoch || !this.worker) { image.close?.(); this.busy = false; return; }
        this.worker.postMessage({ type: 'frame', sequence, time: now, image }, [image]);
      }).catch(error => {
        this.busy = false;
        this.onState('Camera frame unavailable: ' + error.message);
      });
    }
    this.frame = this.scope.requestAnimationFrame(() => this.schedule(epoch));
  }

  consume(result) {
    if (result.sequence < this.sequence - 2) return;
    const detections = (result.hands || result.landmarks || []).filter(hand => Array.isArray(hand) ? hand.length === 21 : Array.isArray(hand?.landmarks) && hand.landmarks.length === 21);
    const matched = matchHands(detections, this.previous, { handednesses: result.handednesses || [] });
    if (matched.ambiguous) {
      for (const handId of this.held) this.onGesture({ type: 'release', handId, reason: 'ambiguous hand crossing' });
      const handIds = matched.ambiguousIds.length ? matched.ambiguousIds : this.previous.map(hand => hand?.id).filter(Boolean);
      this.held.clear(); this.armed.clear(); this.lastPose.clear(); this.swipeStart.clear(); this.lastTwoHand = null;
      this.previous = [null, null]; this.hands = []; this.renderer.hand = [];
      this.onHands([]); this.draw();
      this.onGesture({ type: 'frame', hands: [], landmarksPerHand: 21, ambiguous: true, handIds });
      this.onGesture({ type: 'lost', reason: 'ambiguous hand crossing', handIds });
      return;
    }
    const nextPrevious = [null, null];
    for (const track of this.previous) if (track && (track.missing || 0) < MAX_HAND_MISSING_FRAMES) nextPrevious[track.slot] = { ...track, missing: (track.missing || 0) + 1 };
    const hands = matched.map(item => {
      const details = describeHand(item.landmarks);
      const screenLandmarks = item.landmarks.map(point => this.screenPoint(point));
      const indexPoint = screenLandmarks[8];
      const pinchPoint = [
        (screenLandmarks[4][0] + screenLandmarks[8][0]) / 2,
        (screenLandmarks[4][1] + screenLandmarks[8][1]) / 2,
      ];
      const center = palmCenter(item.landmarks);
      nextPrevious[item.slot] = item;
      return { id: item.id, slot: item.slot, pose: details.pose, fingers: details.fingers,
        handedness: item.handedness, confidence: item.confidence, pinchRatio: details.pinchRatio, screenLandmarks, indexPoint, pinchPoint,
        center: this.screenPoint({ x: center[0], y: center[1] }),
        rawLandmarks: item.landmarks };
    });
    this.previous = nextPrevious;
    this.hands = hands;
    this.renderer.hand = hands[0]?.screenLandmarks || [];
    this.onHands(hands.map(({ rawLandmarks, ...hand }) => hand));
    this.draw();
    this.onGesture({
      type: 'frame',
      hands: hands.map(({ id, pose, fingers, pinchRatio, handedness, confidence }) => ({ id, pose, fingers: { ...fingers }, pinchRatio, handedness, confidence })),
      landmarksPerHand: 21,
    });
    this.emitSwipe(hands);
    this.emitHandGestures(hands);
  }

  emitSwipe(hands) {
    const now = this.scope.performance?.now?.() ?? Date.now();
    for (const hand of hands) {
      if (hand.pose !== 'open') { this.swipeStart.delete(hand.id); continue; }
      const prior = this.swipeStart.get(hand.id);
      if (!prior || now - prior.time > 650) {
        this.swipeStart.set(hand.id, { point: hand.center, time: now });
        continue;
      }
      const dx = hand.center[0] - prior.point[0], dt = now - prior.time;
      if (dt >= 60 && Math.abs(dx) > Math.max(90, (this.scope.innerWidth || 360) * 0.22) && now - this.lastSwipe > 700) {
        this.onGesture({ type: 'swipe', handId: hand.id, dx });
        this.lastSwipe = now; this.swipeStart.delete(hand.id);
      }
    }
  }

  emitHandGestures(hands) {
    const active = new Set(hands.map(hand => hand.id));
    for (const handId of this.held) {
      if (!active.has(handId)) this.onGesture({ type: 'release', handId, reason: 'hand lost' });
    }
    this.held = new Set([...this.held].filter(id => active.has(id)));
    this.armed = new Set([...this.armed].filter(id => active.has(id)));
    const paired = hands.length === 2 && hands.every(hand => hand.pose === 'pinch');
    if (paired) {
      for (const handId of this.held) this.onGesture({ type: 'release', handId, reason: 'two-hand view gesture' });
      this.held.clear();
      hands.forEach(hand => this.armed.delete(hand.id));
      const transform = twoHandTransform(hands[0].pinchPoint, hands[1].pinchPoint, this.lastTwoHand);
      this.lastTwoHand = transform;
      if (transform) this.onGesture({ type: 'twohand', ...transform, hands: hands.map(hand => hand.id) });
    } else {
      this.lastTwoHand = null;
      for (const hand of hands) {
        const priorPose = this.lastPose.get(hand.id);
        if (priorPose !== hand.pose) {
          this.onGesture({ type: 'pose', handId: hand.id, pose: hand.pose, point: hand.indexPoint, fingers: { ...hand.fingers } });
          this.lastPose.set(hand.id, hand.pose);
        }
        if (hand.fingers.index) this.onGesture({ type: 'aim', handId: hand.id, point: hand.indexPoint });
        if (hand.pose === 'open') this.armed.add(hand.id);
        if (hand.pose === 'fist') this.armed.delete(hand.id);
        if (hand.pose === 'pinch') {
          if (!this.held.has(hand.id) && this.armed.delete(hand.id)) {
            this.held.add(hand.id);
            this.onGesture({ type: 'grab', handId: hand.id, point: hand.indexPoint });
          } else if (this.held.has(hand.id)) {
            this.onGesture({ type: 'move', handId: hand.id, point: hand.indexPoint });
          }
        } else if (this.held.delete(hand.id)) {
          this.onGesture({ type: 'release', handId: hand.id, reason: hand.pose });
        }
      }
    }
    for (const id of this.lastPose.keys()) if (!active.has(id)) this.lastPose.delete(id);
  }

  draw() {
    if (!this.ctx || !this.overlay) return;
    this.resizeOverlay();
    const rect = this.overlay.getBoundingClientRect();
    const ratio = this.overlay.width / Math.max(1, rect.width);
    const ctx = this.ctx;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
    for (const hand of this.hands) {
      const color = COLORS[hand.slot] || COLORS[0];
      const points = hand.screenLandmarks.map(([x,y]) => [x - rect.left, y - rect.top]);
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      for (const [a,b] of BONES) {
        ctx.beginPath(); ctx.moveTo(...points[a]); ctx.lineTo(...points[b]); ctx.stroke();
      }
      for (let i = 0; i < points.length; i++) {
        ctx.beginPath(); ctx.fillStyle = [4,8,12,16,20].includes(i) ? '#fff0bd' : color;
        ctx.arc(points[i][0], points[i][1], [4,8,12,16,20].includes(i) ? 4.5 : 2.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#f2f7f2'; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
      const fingerSummary = Object.entries(hand.fingers).map(([name, extended]) => name + ':' + (extended ? 'up' : 'down')).join('  ');
      ctx.fillText(hand.id + ' · ' + hand.pose, points[0][0] + 10, points[0][1] - 15);
      ctx.fillStyle = color; ctx.font = '10px system-ui';
      ctx.fillText(fingerSummary, points[0][0] + 10, points[0][1] + 2);
    }
  }

  stop(message = 'Camera off. Touch remains available.') {
    this.epoch++; this.scope.cancelAnimationFrame?.(this.frame); this.frame = 0;
    this.worker?.terminate(); this.worker = null;
    this.stream?.getTracks?.().forEach(track => track.stop()); this.stream = null;
    this.video?.pause?.(); if (this.video) this.video.srcObject = null;
    this.busy = false; this.ready = false; this.hands = []; this.previous = [null, null];
    for (const handId of this.held) this.onGesture({ type: 'release', handId, reason: message });
    this.held.clear(); this.armed.clear(); this.lastPose.clear(); this.lastTwoHand = null;
    this.scope.document?.body?.classList?.remove('camera-live');
    if (this.overlay) this.overlay.style.display = 'none';
    if (this.video?.style) this.video.style.display = 'none';
    if (this.ctx && this.overlay) this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.renderer.hand = []; this.onHands([]); this.onGesture({ type: 'lost', reason: message });
    this.onState(message);
  }
}

