/**
 * src/render/hand-presence.js
 *
 * 3D hand presence avatar for Reality Lens / Hand Lens.
 * Renders tracked hands as floating glassy glow spheres + skeleton lines
 * in world space (AR-glasses style – no floors, no UI chrome).
 *
 * Usage in main.js (or equivalent bootstrap):
 *
 *   import { createHandPresence } from './render/hand-presence.js';
 *
 *   const handPresence = createHandPresence(scene, camera);
 *
 *   // every frame, after camera module yields fresh hand data:
 *   handPresence.update(hands, pinchState);
 *
 *   // optional:
 *   handPresence.setVisible(true|false);
 *   // on teardown:
 *   handPresence.dispose();
 *
 * hands shape (from camera module):
 *   Array of 0–2 objects:
 *     {
 *       landmarks: [{x,y,z} × 21],   // normalized screen coords (MediaPipe)
 *       worldLandmarks: [...],      // optional, ignored here
 *       handedness: "Left" | "Right"
 *     }
 *
 * pinchState shape (from domain module):
 *   {
 *     left?:  { active: boolean, x?: number, y?: number },
 *     right?: { active: boolean, x?: number, y?: number }
 *   }
 *   (or any object that can be queried by handedness)
 */
import * as THREE from "three?v=20260922-cache2";
// ─── Tunables ───────────────────────────────────────────────────────────────
/** Fixed depth (world units) at which hands float in front of the camera. */
const HAND_DEPTH = 0.55;
/** Sphere radius for ordinary joints. */
const JOINT_RADIUS = 0.008;
/** Slightly larger radius for fingertips. */
const TIP_RADIUS = 0.011;
/** Index fingertip gets a noticeable boost. */
const INDEX_TIP_RADIUS = 0.014;
/** Lerp factor for position smoothing (higher = snappier). */
const SMOOTH = 0.38;
/** Fade-out duration when a hand disappears (ms). */
const FADE_MS = 300;
/** Base opacity of the glow materials. */
const BASE_OPACITY = 0.85;
/** Pinch pulse amplitude (added to opacity / scale). */
const PINCH_PULSE = 0.45;
// MediaPipe landmark indices
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_TIP = 20;
/** Skeleton bone pairs (MediaPipe topology). */
const BONES = [
  // thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // index
  [0, 5], [5, 6], [6, 7], [7, 8],
  // middle
  [0, 9], [9, 10], [10, 11], [11, 12],
  // ring
  [0, 13], [13, 14], [14, 15], [15, 16],
  // pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // knuckles
  [5, 9], [9, 13], [13, 17]
];
const TIP_INDICES = new Set([THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP]);
// ─── Colour palettes (cool left / warm right) ───────────────────────────────
const LEFT_COLOR  = new THREE.Color(0x40e0ff); // cyan
const RIGHT_COLOR = new THREE.Color(0xff9a3c); // amber/orange
const PINCH_LINE_COLOR = new THREE.Color(0xffffff);
// ─── Shared geometries (allocated once) ─────────────────────────────────────
/**
 * Shared joint geometries. They are module-level for performance (every
 * hand reuses the same three sphere geometries), but they must survive
 * one instance being disposed while another is still alive — and a new
 * instance created after a dispose must get fresh geometries. A small
 * reference count owns their lifetime.
 * @type {THREE.SphereGeometry|null}
 */
let geoJoint = null;
/** @type {THREE.SphereGeometry|null} */
let geoTip = null;
/** @type {THREE.SphereGeometry|null} */
let geoIndexTip = null;
/** @type {number} */
let sharedGeoRefs = 0;

function acquireSharedGeos() {
  if (sharedGeoRefs === 0 || !geoJoint || !geoTip || !geoIndexTip) {
    geoJoint = new THREE.SphereGeometry(JOINT_RADIUS, 12, 10);
    geoTip = new THREE.SphereGeometry(TIP_RADIUS, 12, 10);
    geoIndexTip = new THREE.SphereGeometry(INDEX_TIP_RADIUS, 14, 12);
  }
  sharedGeoRefs += 1;
}

function releaseSharedGeos() {
  sharedGeoRefs = Math.max(0, sharedGeoRefs - 1);
  if (sharedGeoRefs === 0) {
    geoJoint?.dispose();
    geoTip?.dispose();
    geoIndexTip?.dispose();
    geoJoint = null;
    geoTip = null;
    geoIndexTip = null;
  }
}
// ─── Helpers ────────────────────────────────────────────────────────────────
function makeGlowMaterial(color, opacity = BASE_OPACITY) {
  return new THREE.MeshBasicMaterial({
    color: color.clone(),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}
function makeLineMaterial(color, opacity = BASE_OPACITY * 0.7) {
  return new THREE.LineBasicMaterial({
    color: color.clone(),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}
/**
 * Convert a single MediaPipe landmark (normalised screen space)
 * into world coordinates at HAND_DEPTH in front of the camera.
 *
 * MediaPipe x/y are 0..1 (origin top-left). Three.js NDC is -1..1
 * with y flipped.
 */
function landmarkToWorld(lm, camera, target) {
  const ndcX = lm.x * 2 - 1;
  const ndcY = -(lm.y * 2 - 1); // flip Y
  // Unproject a point on the near plane, then place it at fixed depth
  // along the camera's forward ray.
  const vec = target || new THREE.Vector3();
  vec.set(ndcX, ndcY, 0.5).unproject(camera);
  // Direction from camera to the unprojected point
  const dir = vec.sub(camera.position).normalize();
  // Place at comfortable depth
  return target
    ? target.copy(camera.position).addScaledVector(dir, HAND_DEPTH)
    : camera.position.clone().addScaledVector(dir, HAND_DEPTH);
}
// ─── Per-hand state object ──────────────────────────────────────────────────
function createHandState(handedness, scene) {
  const isLeft = handedness === 'Left';
  const baseColor = isLeft ? LEFT_COLOR : RIGHT_COLOR;
  // Joint meshes (21)
  const joints = [];
  for (let i = 0; i < 21; i++) {
    let geo = geoJoint;
    if (i === INDEX_TIP) geo = geoIndexTip;
    else if (TIP_INDICES.has(i)) geo = geoTip;
    const mat = makeGlowMaterial(baseColor);
    // Fingertips brighter
    if (TIP_INDICES.has(i)) {
      mat.opacity = BASE_OPACITY * 1.15;
      if (i === INDEX_TIP) mat.opacity = BASE_OPACITY * 1.35;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 10;
    scene.add(mesh);
    joints.push(mesh);
  }
  // Skeleton lines
  const positions = new Float32Array(BONES.length * 2 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lineMat = makeLineMaterial(baseColor);
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.visible = false;
  lines.renderOrder = 9;
  scene.add(lines);
  // Pinch line (thumb tip ↔ index tip)
  const pinchPositions = new Float32Array(6);
  const pinchGeo = new THREE.BufferGeometry();
  pinchGeo.setAttribute('position', new THREE.BufferAttribute(pinchPositions, 3));
  const pinchMat = makeLineMaterial(PINCH_LINE_COLOR, 0.95);
  const pinchLine = new THREE.LineSegments(pinchGeo, pinchMat);
  pinchLine.visible = false;
  pinchLine.renderOrder = 11;
  scene.add(pinchLine);
  // Smoothed world positions (reused)
  const smoothed = Array.from({ length: 21 }, () => new THREE.Vector3());
  const tmp = new THREE.Vector3();
  return {
    handedness,
    joints,
    lines,
    lineGeo,
    lineMat,
    pinchLine,
    pinchGeo,
    pinchMat,
    smoothed,
    tmp,
    // lifecycle
    present: false,       // currently receiving data
    lastSeen: 0,          // performance.now()
    opacity: 0,           // current group opacity 0..1
    pinchActive: false
  };
}
function disposeHandState(state, scene) {
  for (const mesh of state.joints) {
    scene.remove(mesh);
    mesh.material.dispose();
    // geometries are shared – do NOT dispose
  }
  scene.remove(state.lines);
  state.lineGeo.dispose();
  state.lineMat.dispose();
  scene.remove(state.pinchLine);
  state.pinchGeo.dispose();
  state.pinchMat.dispose();
}
// ─── Public factory ─────────────────────────────────────────────────────────
/**
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @returns {{ update: Function, setVisible: Function, dispose: Function }}
 */
export function createHandPresence(scene, camera) {
  // Own one reference to the shared joint geometries for this instance's
  // lifetime; released in dispose().
  acquireSharedGeos();
  /** @type {Map<string, ReturnType<typeof createHandState>>} */
  const hands = new Map();
  let visible = true;
  let lastNow = performance.now();
  function ensureHand(handedness) {
    if (!hands.has(handedness)) {
      hands.set(handedness, createHandState(handedness, scene));
    }
    return hands.get(handedness);
  }
  /**
   * @param {Array} handList  – 0–2 hand objects from the camera module
   * @param {object} [pinchState] – optional pinch info keyed by side
   */
  function update(handList = [], pinchState = {}) {
    if (!visible) return;
    const now = performance.now();
    const dt = Math.min(64, now - lastNow); // clamp for stability
    lastNow = now;
    // Mark all existing hands as not present this frame
    for (const h of hands.values()) h.present = false;
    // Process incoming hands
    for (const raw of handList) {
      if (!raw || !raw.landmarks || raw.landmarks.length < 21) continue;
      const side = raw.handedness === 'Left' ? 'Left' : 'Right';
      const state = ensureHand(side);
      state.present = true;
      state.lastSeen = now;
      // Pinch lookup (flexible shape)
      const pinch = pinchState[side.toLowerCase()] ||
                    pinchState[side] ||
                    (side === 'Left' ? pinchState.left : pinchState.right) ||
                    {};
      state.pinchActive = !!(pinch.active || pinch.isPinching);
      // Smooth + place joints
      for (let i = 0; i < 21; i++) {
        const world = landmarkToWorld(raw.landmarks[i], camera, state.tmp);
        state.smoothed[i].lerp(world, SMOOTH);
        const mesh = state.joints[i];
        mesh.position.copy(state.smoothed[i]);
        mesh.visible = true;
        // Pinch feedback on thumb + index tips
        if (state.pinchActive && (i === THUMB_TIP || i === INDEX_TIP)) {
          const pulse = 1 + PINCH_PULSE * (0.5 + 0.5 * Math.sin(now * 0.012));
          mesh.scale.setScalar(pulse);
          mesh.material.opacity = Math.min(1, BASE_OPACITY * 1.4 * pulse);
        } else {
          mesh.scale.setScalar(1);
          // restore base opacity (fingertips brighter)
          let base = BASE_OPACITY;
          if (TIP_INDICES.has(i)) base *= 1.15;
          if (i === INDEX_TIP) base *= 1.35;
          mesh.material.opacity = base * state.opacity;
        }
      }
      // Skeleton lines
      const posAttr = state.lineGeo.attributes.position;
      const arr = posAttr.array;
      let idx = 0;
      for (const [a, b] of BONES) {
        const pa = state.smoothed[a];
        const pb = state.smoothed[b];
        arr[idx++] = pa.x; arr[idx++] = pa.y; arr[idx++] = pa.z;
        arr[idx++] = pb.x; arr[idx++] = pb.y; arr[idx++] = pb.z;
      }
      posAttr.needsUpdate = true;
      state.lines.visible = true;
      state.lineMat.opacity = (BASE_OPACITY * 0.7) * state.opacity;
      // Pinch connector
      if (state.pinchActive) {
        const p4 = state.smoothed[THUMB_TIP];
        const p8 = state.smoothed[INDEX_TIP];
        const parr = state.pinchGeo.attributes.position.array;
        parr[0] = p4.x; parr[1] = p4.y; parr[2] = p4.z;
        parr[3] = p8.x; parr[4] = p8.y; parr[5] = p8.z;
        state.pinchGeo.attributes.position.needsUpdate = true;
        state.pinchLine.visible = true;
        const pulse = 0.7 + 0.3 * Math.sin(now * 0.014);
        state.pinchMat.opacity = pulse * state.opacity;
      } else {
        state.pinchLine.visible = false;
      }
    }
    // Fade / hide lost hands
    for (const state of hands.values()) {
      if (state.present) {
        // fade in quickly
        state.opacity = Math.min(1, state.opacity + dt / 120);
      } else {
        const age = now - state.lastSeen;
        if (age > FADE_MS) {
          state.opacity = 0;
          // fully hide
          for (const m of state.joints) m.visible = false;
          state.lines.visible = false;
          state.pinchLine.visible = false;
        } else {
          state.opacity = 1 - age / FADE_MS;
          // keep geometry visible while fading
          for (const m of state.joints) {
            m.visible = true;
            m.material.opacity *= state.opacity; // already set above, scale further
          }
          state.lineMat.opacity = (BASE_OPACITY * 0.7) * state.opacity;
          if (state.pinchLine.visible) {
            state.pinchMat.opacity *= state.opacity;
          }
        }
      }
    }
  }
  function setVisible(v) {
    visible = !!v;
    if (!visible) {
      for (const state of hands.values()) {
        for (const m of state.joints) m.visible = false;
        state.lines.visible = false;
        state.pinchLine.visible = false;
        state.opacity = 0;
      }
    }
  }
  function dispose() {
    for (const state of hands.values()) {
      disposeHandState(state, scene);
    }
    hands.clear();
    // Release this instance's reference to the shared geometries.
    // They are only truly disposed once the last live instance is gone,
    // so disposing one presence can never invalidate another.
    releaseSharedGeos();
  }
  return { update, setVisible, dispose };
}
