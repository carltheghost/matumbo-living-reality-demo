/**
 * src/render/photo-mascot.js
 *
 * 3D photo mascot for the maTumbo Living Reality Ω project (Reality Lens Ω).
 *
 * A framed photo card: the photo plane keeps its source aspect ratio, sits in
 * front of a slightly larger rounded-glass backing, and carries a soft radial
 * glow sprite behind it. Everything is closed by default and materializes only
 * when needed. Projection only: no ledger, identity, wallet, or settlement
 * authority is created here. Simulated TUMBO points only.
 *
 * The module is DOM-free at build time (the glow gradient is generated with a
 * DataTexture), so it can be unit tested in Node without a renderer.
 * NOTE: imports the vendored Three.js build via relative path (the same file
 * the browser importmap maps "three" to), so Node tests resolve it too.
 */

import * as THREE from "../../vendor/three-r179.1/build/three.module.js?v=20260922-cache2";

const TILT_FACTOR = 0.12;
const PHOTO_HEIGHT = 1;
const FRAME_PAD = 0.09;
const FRAME_RADIUS = 0.09;
const GLOW_SIZE = 128;

const _camWorld = new THREE.Vector3();
const _selfWorld = new THREE.Vector3();

function clampUnit(value) {
  const n = Number(value);
  return THREE.MathUtils.clamp(Number.isFinite(n) ? n : 0, -1, 1);
}

function roundedRectShape(width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  shape.closePath();
  return shape;
}

function createGlowTexture(size = GLOW_SIZE) {
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.pow(Math.max(0, 1 - dist), 2.2);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 244;
      data[i + 2] = 230;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Build a photo mascot.
 *
 * @param {object} [options]
 * @param {string|null} [options.lookSrc]  Photo texture URL (repo-root-relative
 *   asset, e.g. "assets/avatar/photo-mascot/tumbo-hoodie.png").
 * @param {number} [options.aspect=1]      Source aspect ratio (width / height).
 * @param {THREE.TextureLoader} [options.loader]  Texture loader; defaults to a
 *   new THREE.TextureLoader().
 * @returns {{ group: THREE.Group, setLook: Function, setTilt: Function,
 *   applyMotion: Function, faceCamera: Function, dispose: Function }}
 */
export function buildPhotoMascot(options = {}) {
  const {
    lookSrc = null,
    aspect = 1,
    loader = new THREE.TextureLoader(),
  } = options || {};

  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const photoW = PHOTO_HEIGHT * safeAspect;
  const photoH = PHOTO_HEIGHT;

  const group = new THREE.Group();
  group.name = "PhotoMascot";

  const tiltGroup = new THREE.Group();
  tiltGroup.name = "PhotoMascotTilt";
  // Motion offsets (bob/sway) live on their own group so the outer `group`
  // stays the placement handle for dragging and persisted positions.
  const motionGroup = new THREE.Group();
  motionGroup.name = "PhotoMascotMotion";
  group.add(motionGroup);
  motionGroup.add(tiltGroup);

  const disposables = new Set();
  const track = (resource) => {
    disposables.add(resource);
    return resource;
  };

  // Photo plane (aspect-preserving).
  const photoGeo = track(new THREE.PlaneGeometry(photoW, photoH));
  const photoMat = track(new THREE.MeshBasicMaterial({ transparent: true }));
  const photoMesh = new THREE.Mesh(photoGeo, photoMat);
  photoMesh.name = "PhotoMascotPhoto";
  photoMesh.renderOrder = 2;
  tiltGroup.add(photoMesh);

  // Rounded-glass backing, slightly larger than the photo. Faked transmission:
  // plain transparent physical material, no postprocessing.
  const backingGeo = track(new THREE.ShapeGeometry(
    roundedRectShape(photoW + FRAME_PAD * 2, photoH + FRAME_PAD * 2, FRAME_RADIUS),
    8,
  ));
  const backingMat = track(new THREE.MeshPhysicalMaterial({
    color: 0xdfe9ff,
    transparent: true,
    opacity: 0.25,
    roughness: 0.15,
    metalness: 0,
  }));
  const backingMesh = new THREE.Mesh(backingGeo, backingMat);
  backingMesh.name = "PhotoMascotBacking";
  backingMesh.position.z = -0.015;
  backingMesh.renderOrder = 1;
  tiltGroup.add(backingMesh);

  // Soft radial glow sprite behind the frame.
  const glowTex = track(createGlowTexture());
  const glowMat = track(new THREE.SpriteMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  const glow = new THREE.Sprite(glowMat);
  glow.name = "PhotoMascotGlow";
  glow.scale.set(photoW + 0.8, photoH + 0.8, 1);
  glow.position.z = -0.06;
  glow.renderOrder = 0;
  tiltGroup.add(glow);

  function setPhotoTexture(texture) {
    const previous = photoMat.map;
    if (previous === texture) return;
    photoMat.map = texture || null;
    photoMat.needsUpdate = true;
    if (previous) {
      disposables.delete(previous);
      previous.dispose();
    }
    if (texture) disposables.add(texture);
  }

  function requestLook(src) {
    if (!src) return;
    try {
      loader.load(
        src,
        (texture) => {
          if (texture) texture.colorSpace = THREE.SRGBColorSpace;
          setPhotoTexture(texture);
        },
        undefined,
        () => {
          // Load failed: keep the previous texture, never a blank crash.
        },
      );
    } catch (error) {
      // Loader threw synchronously (e.g. no DOM image support): keep previous.
    }
  }

  function setLook(src) {
    requestLook(src);
  }

  function setTilt(nx, ny) {
    const cx = clampUnit(nx);
    const cy = clampUnit(ny);
    tiltGroup.rotation.y = cx * TILT_FACTOR;
    tiltGroup.rotation.x = -cy * TILT_FACTOR;
  }

  function faceCamera(camera) {
    if (!camera || !camera.isCamera) return;
    camera.getWorldPosition(_camWorld);
    group.getWorldPosition(_selfWorld);
    const dx = _camWorld.x - _selfWorld.x;
    const dz = _camWorld.z - _selfWorld.z;
    if (dx === 0 && dz === 0) return;
    group.rotation.y = Math.atan2(dx, dz);
  }

  function applyMotion(sample = {}, camera = null) {
    const {
      bobY = 0,
      swayX = 0,
      tiltZ = 0,
      scalePulse = 0,
      squash = 0,
    } = sample || {};
    motionGroup.position.y = bobY;
    motionGroup.position.x = swayX;
    tiltGroup.rotation.z = tiltZ;
    const s = 1 + scalePulse;
    photoMesh.scale.set(s, s * (1 - squash), 1);
    if (camera) faceCamera(camera);
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const resource of disposables) {
      if (resource && typeof resource.dispose === "function") {
        try {
          resource.dispose();
        } catch (error) {
          // Best effort: never throw from dispose.
        }
      }
    }
    disposables.clear();
    group.clear();
  }

  if (lookSrc) requestLook(lookSrc);

  return { group, setLook, setTilt, applyMotion, faceCamera, dispose };
}
