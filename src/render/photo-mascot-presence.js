/**
 * src/render/photo-mascot-presence.js
 *
 * Single-instance, draggable photo-mascot presence for the maTumbo
 * Living Reality Ω (Reality Lens Ω) HUD.
 *
 * - Closed by default; the mascot materializes only when opened.
 * - Singleton: a second createPhotoMascotPresence() call returns the
 *   existing instance.
 * - open() / close() / toggle() / isOpen().
 * - Drag with the pointer: the mascot moves on a plane facing the camera.
 *   Position persists to localStorage ("tumbo-mascot-presence-pos") and is
 *   restored on open.
 * - Small close chip anchored above the mascot.
 * - Click (pointer down/up with no drag) triggers the wave gesture through
 *   the motion system (MASCOT_STATES.wave).
 * - update(t, dt) applies motion.sample(t) via mascot.applyMotion and keeps
 *   the mascot facing the camera via mascot.faceCamera(camera).
 * - setLook(look) routes through setMascotLook (photo set) and re-subscribes
 *   the texture through buildPhotoMascot.setLook.
 * - Escape closes the presence.
 * - On mobile (matchMedia "(max-width: 700px)"), opening fires the optional
 *   onOpen callback so the host can enforce the one-floating-panel rule
 *   (this module never reaches into other panels itself).
 * - dispose() removes listeners, the chip, and the 3D object, and clears
 *   the singleton.
 *
 * Dependencies (built by sibling agents, used exactly as specified):
 *   ./photo-mascot.js           -> buildPhotoMascot()
 *                                  => { group, setLook, setTilt, applyMotion, faceCamera, dispose }
 *   ../domains/mascot-motion.js -> createMascotMotion(), MASCOT_STATES,
 *                                  motion.sample(t) => { bobY, swayX, tiltZ, scalePulse, squash }
 *   ./photo-mascot-set.js       -> getMascotLook / setMascotLook / preloadPhotos
 *
 * Conventions: Three.js is imported ONLY as `import * as THREE from "three"`
 * (the browser importmap maps "three" to the vendored build).
 * Projection only — no ledger / identity / wallet authority anywhere.
 * Simulated TUMBO points only — no wallets / crypto.
 */

import * as THREE from "three";
import { buildPhotoMascot } from "./photo-mascot.js";
import { createMascotMotion, MASCOT_STATES } from "../domains/mascot-motion.js";
import { getMascotLook, getPhoto, setMascotLook, preloadPhotos } from "./photo-mascot-set.js";

const STORAGE_KEY = "tumbo-mascot-presence-pos";
const MOBILE_QUERY = "(max-width: 700px)";
const CLICK_MAX_DIST_PX = 8;
const CLICK_MAX_MS = 400;
const DEFAULT_FORWARD_DIST = 2.4;
const DEFAULT_RIGHT = 0.9;
const DEFAULT_DOWN = 0.35;
const CHIP_LIFT = 0.55;

let singleton = null;

function readStoredPosition() {
  try {
    const raw = globalThis.localStorage ? globalThis.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p.x !== "number" || typeof p.y !== "number" || typeof p.z !== "number") return null;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
    return { x: p.x, y: p.y, z: p.z };
  } catch {
    return null;
  }
}

function writeStoredPosition(pos) {
  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ x: pos.x, y: pos.y, z: pos.z })
      );
    }
  } catch {
    // Storage unavailable (private mode, quota, etc.): presence still works in memory.
  }
}

function isMobileViewport() {
  try {
    const mq = globalThis.matchMedia ? globalThis.matchMedia(MOBILE_QUERY) : null;
    return !!(mq && mq.matches);
  } catch {
    return false;
  }
}

function now() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

// The motion module contract is MASCOT_STATES + sample(t); the exact gesture
// method name may vary between implementations, so try the known ones.
function triggerWave(motion) {
  if (!motion) return;
  const wave = (MASCOT_STATES && MASCOT_STATES.wave) || "wave";
  if (typeof motion.trigger === "function") { motion.trigger(wave); return; }
  if (typeof motion.play === "function") { motion.play(wave); return; }
  if (typeof motion.setState === "function") { motion.setState(wave); return; }
  if (typeof motion.fire === "function") { motion.fire(wave); }
}

export function createPhotoMascotPresence(options) {
  if (singleton) return singleton;

  const opts = options || {};
  const scene = opts.scene;
  const camera = opts.camera;
  const hudRoot = opts.hudRoot;
  const onOpen = opts.onOpen;

  const doc =
    (hudRoot && hudRoot.ownerDocument) ||
    (typeof document !== "undefined" ? document : null);

  let mascot = null; // { group, setLook, setTilt, applyMotion, faceCamera, dispose }
  let motion = null;
  let opened = false;
  let built = false;
  let disposed = false;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const planeHit = new THREE.Vector3();
  const grabOffset = new THREE.Vector3();
  const chipAnchor = new THREE.Vector3();
  const camDir = new THREE.Vector3();

  let pointerOnMascot = false;
  let dragging = false;
  let activePointerId = null;
  let downX = 0;
  let downY = 0;
  let downAt = 0;

  // -- Close chip ---------------------------------------------------------
  const chip = doc ? doc.createElement("button") : null;
  if (chip) {
    chip.type = "button";
    chip.textContent = "×";
    if (typeof chip.setAttribute === "function") {
      chip.setAttribute("aria-label", "Close photo mascot");
    }
    const cs = chip.style;
    cs.position = "fixed";
    cs.zIndex = "40";
    cs.display = "none";
    cs.width = "28px";
    cs.height = "28px";
    cs.borderRadius = "9999px";
    cs.border = "1px solid rgba(255,255,255,0.25)";
    cs.background = "rgba(10,10,14,0.72)";
    cs.color = "#fff";
    cs.fontSize = "16px";
    cs.lineHeight = "1";
    cs.cursor = "pointer";
    cs.padding = "0";
    chip.addEventListener("click", function (e) {
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
      close();
    });
    if (hudRoot && typeof hudRoot.appendChild === "function") {
      hudRoot.appendChild(chip);
    } else if (doc && doc.body && typeof doc.body.appendChild === "function") {
      doc.body.appendChild(chip);
    }
  }

  function placeAtDefault() {
    if (camera && typeof camera.getWorldDirection === "function") {
      camera.getWorldDirection(camDir);
    } else {
      camDir.set(0, 0, -1);
    }
    const base = (camera && camera.position) || new THREE.Vector3(0, 1.6, 0);
    mascot.group.position
      .set(base.x + DEFAULT_RIGHT, base.y - DEFAULT_DOWN, base.z)
      .addScaledVector(camDir, DEFAULT_FORWARD_DIST);
  }

  function ensureBuilt() {
    if (built || disposed) return;
    mascot = buildPhotoMascot();
    motion = createMascotMotion();
    if (!mascot || !mascot.group) return;
    mascot.group.visible = false; // closed by default
    if (scene && typeof scene.add === "function") scene.add(mascot.group);
    const stored = readStoredPosition();
    if (stored) {
      mascot.group.position.set(stored.x, stored.y, stored.z);
    } else {
      placeAtDefault();
    }
    // Sync with the globally selected look (e.g. chosen in Person Studio):
    // a look id maps to a photo texture URL through the photo set.
    try {
      const photo = getPhoto(getMascotLook());
      if (photo && typeof mascot.setLook === "function") mascot.setLook(photo.src);
    } catch {
      // Non-fatal: builder keeps its own default look.
    }
    built = true;
  }

  // -- Pointer interaction ------------------------------------------------
  function updateNDC(e) {
    const w = globalThis.innerWidth || 1;
    const h = globalThis.innerHeight || 1;
    ndc.set((e.clientX / w) * 2 - 1, -((e.clientY / h) * 2 - 1));
  }

  function pickMascot(e) {
    if (!mascot || !camera) return [];
    updateNDC(e);
    try {
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObject(mascot.group, true) || [];
    } catch {
      return [];
    }
  }

  function onPointerDown(e) {
    if (disposed || !opened || !e) return;
    if (e.isPrimary === false) return;
    if (e.button !== undefined && e.button !== 0) return;
    // Only engage on the 3D canvas so HUD clicks are never hijacked.
    if (!e.target || e.target.tagName !== "CANVAS") return;
    const hits = pickMascot(e);
    if (hits.length === 0) return;
    pointerOnMascot = true;
    dragging = false;
    activePointerId = e.pointerId !== undefined ? e.pointerId : null;
    downX = e.clientX;
    downY = e.clientY;
    downAt = now();
    // Drag plane faces the camera through the mascot's current position.
    camera.getWorldDirection(camDir);
    dragPlane.setFromNormalAndCoplanarPoint(camDir, mascot.group.position);
    const hitPoint = (hits[0] && hits[0].point) || planeHit;
    grabOffset.copy(mascot.group.position).sub(hitPoint);
    try {
      if (e.target.setPointerCapture && activePointerId !== null) {
        e.target.setPointerCapture(activePointerId);
      }
    } catch {
      // Non-fatal.
    }
    if (typeof e.preventDefault === "function") e.preventDefault();
  }

  function onPointerMove(e) {
    if (disposed || !opened || !pointerOnMascot || !e) return;
    if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
    if (!dragging) {
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (Math.hypot(dx, dy) <= CLICK_MAX_DIST_PX) return;
      dragging = true;
    }
    updateNDC(e);
    try {
      raycaster.setFromCamera(ndc, camera);
    } catch {
      return;
    }
    let p = null;
    try {
      p = raycaster.ray.intersectPlane(dragPlane, planeHit);
    } catch {
      p = null;
    }
    if (!p) return;
    mascot.group.position.copy(p).add(grabOffset);
    writeStoredPosition(mascot.group.position);
  }

  function endPointerGesture() {
    pointerOnMascot = false;
    dragging = false;
    activePointerId = null;
  }

  function onPointerUp(e) {
    if (disposed || !pointerOnMascot) return;
    if (e && activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
    const wasDrag = dragging;
    const held = now() - downAt;
    endPointerGesture();
    if (!opened || !mascot) return;
    if (!wasDrag && held <= CLICK_MAX_MS) {
      triggerWave(motion); // click (no drag) -> wave gesture via the motion system
    } else {
      writeStoredPosition(mascot.group.position); // persist final drag position
    }
  }

  function onPointerCancel() {
    endPointerGesture();
  }

  function onKeyDown(e) {
    if (disposed || !e) return;
    if (e.key === "Escape" && opened) close();
  }

  const listenTarget = doc || (typeof globalThis !== "undefined" ? globalThis : null);
  if (listenTarget && typeof listenTarget.addEventListener === "function") {
    listenTarget.addEventListener("pointerdown", onPointerDown);
    listenTarget.addEventListener("pointermove", onPointerMove);
    listenTarget.addEventListener("pointerup", onPointerUp);
    listenTarget.addEventListener("pointercancel", onPointerCancel);
    listenTarget.addEventListener("keydown", onKeyDown);
  }

  function detachListeners() {
    if (!listenTarget || typeof listenTarget.removeEventListener !== "function") return;
    listenTarget.removeEventListener("pointerdown", onPointerDown);
    listenTarget.removeEventListener("pointermove", onPointerMove);
    listenTarget.removeEventListener("pointerup", onPointerUp);
    listenTarget.removeEventListener("pointercancel", onPointerCancel);
    listenTarget.removeEventListener("keydown", onKeyDown);
  }

  // -- Open / close --------------------------------------------------------
  function doOpen() {
    if (disposed || opened) return;
    ensureBuilt();
    if (!mascot || !mascot.group) return;
    // Restore the persisted position on every open.
    const stored = readStoredPosition();
    if (stored) mascot.group.position.set(stored.x, stored.y, stored.z);
    opened = true;
    mascot.group.visible = true;
    if (chip) chip.style.display = "block";
    // Mobile one-floating-panel rule: let the host close other panels.
    if (isMobileViewport() && typeof onOpen === "function") {
      try {
        onOpen();
      } catch (err) {
        console.warn("[photo-mascot-presence] onOpen callback failed:", err);
      }
    }
    try {
      const r = typeof preloadPhotos === "function" ? preloadPhotos() : null;
      if (r && typeof r.catch === "function") r.catch(function () {});
    } catch {
      // Non-fatal.
    }
  }

  function close() {
    if (disposed || !opened) return;
    opened = false;
    endPointerGesture();
    if (mascot && mascot.group) mascot.group.visible = false;
    if (chip) chip.style.display = "none";
  }

  function toggle() {
    if (opened) close();
    else doOpen();
    return isOpen();
  }

  function isOpen() {
    return !disposed && opened;
  }

  // -- Per-frame update -----------------------------------------------------
  function positionChip() {
    if (!chip || !mascot || !camera) return;
    chipAnchor.copy(mascot.group.position);
    chipAnchor.y += CHIP_LIFT;
    try {
      chipAnchor.project(camera);
    } catch {
      return;
    }
    if (chipAnchor.z > 1 || chipAnchor.z < -1) {
      chip.style.display = "none"; // behind the camera
      return;
    }
    const w = globalThis.innerWidth || 1;
    const h = globalThis.innerHeight || 1;
    const x = (chipAnchor.x * 0.5 + 0.5) * w;
    const y = (-chipAnchor.y * 0.5 + 0.5) * h;
    chip.style.display = "block";
    chip.style.left = Math.round(x + 16) + "px";
    chip.style.top = Math.round(y - 14) + "px";
  }

  function update(t, dt) {
    if (disposed || !opened || !mascot) return;
    if (motion && typeof motion.sample === "function" && typeof mascot.applyMotion === "function") {
      mascot.applyMotion(motion.sample(t));
    }
    if (typeof mascot.faceCamera === "function") mascot.faceCamera(camera);
    positionChip();
  }

  // -- Look switching --------------------------------------------------------
  function setLook(look) {
    try {
      setMascotLook(look); // global photo-set selection
    } catch {
      // Non-fatal.
    }
    try {
      const photo = getPhoto(look);
      if (photo && mascot && typeof mascot.setLook === "function") {
        mascot.setLook(photo.src); // look id -> photo texture URL
      }
    } catch {
      // Non-fatal: applied on next open via ensureBuilt().
    }
  }

  function getLook() {
    try {
      return getMascotLook();
    } catch {
      return null;
    }
  }

  // -- Pointer tilt --------------------------------------------------------
  // Forwards to the builder's inner tilt group when the mascot is built.
  // Safe no-op before open (the builder materializes lazily on first open).
  function setTilt(x, y) {
    try {
      if (mascot && typeof mascot.setTilt === "function") mascot.setTilt(x, y);
    } catch {
      // Non-fatal.
    }
  }

  // -- Teardown ---------------------------------------------------------------
  function dispose() {
    if (disposed) return;
    disposed = true;
    endPointerGesture();
    detachListeners();
    if (chip && typeof chip.remove === "function") chip.remove();
    if (mascot) {
      try {
        if (scene && typeof scene.remove === "function") scene.remove(mascot.group);
      } catch {
        // Non-fatal.
      }
      try {
        if (typeof mascot.dispose === "function") mascot.dispose();
      } catch {
        // Non-fatal.
      }
      mascot = null;
    }
    try {
      if (motion && typeof motion.dispose === "function") motion.dispose();
    } catch {
      // Non-fatal.
    }
    motion = null;
    opened = false;
    if (singleton === api) singleton = null;
  }

  const api = { open: doOpen, close, toggle, isOpen, update, setLook, getLook, setTilt, dispose };
  singleton = api;
  return api;
}
