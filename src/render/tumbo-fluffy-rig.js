/**
 * tumbo-fluffy-rig.js — the fluffy Tumbo mascot as a real-time rig.
 *
 * Built to match the user's canonical fluffy Tumbo reference: a round
 * plush-brown body, cream face patch, bead eyes, tiny :3 mouth, grey
 * over-ear headphones, and black locs poking out around them.
 *
 * Technique: fur-shell texturing. Each body part renders as an opaque
 * root mesh plus N concentric shells displaced along the vertex normals,
 * textured with a procedural strand alpha map. That is what makes the
 * silhouette read as plush instead of hard-surface — the thing the
 * smooth-shaded chibi rig could never do.
 *
 * The joint hierarchy and names are identical to tumbo-chibi-rig.js
 * (hips, spine, neck, head, arm/elbow/hand Left/Right, leg Left/Right,
 * tail), so updateTumboChibiRig() drives this rig with zero animation
 * changes: idle breathing, blink, wave, hop, walk, bow, spin all carry
 * over. Node-safe: with no DOM the strand texture is skipped and shells
 * fall back to opacity grading.
 */

export const FLUFFY_RIG_BASE_HEIGHT = 1.7;

const FUR_ROOT = '#8a5a2e';
const FUR_TIP = '#c08d4e';
const CREAM = '#d9b98c';
const CREAM_TIP = '#e8cfa5';
const HEADPHONE_GREY = '#9aa0a8';
const CUSHION_GREY = '#5f646c';
const LOC_COLOR = '#191008';
const EYE_COLOR = '#14100c';

// Deterministic PRNG (mulberry32): every random choice in the build flows
// from the rig seed, so the same seed always grows the same Tumbo — the
// identity fingerprint stays stable across reloads and devices.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStrandTexture(rng) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 128);
    // Short random strands, denser toward the bottom of each tile so the
    // shell reads as tapered fur rather than noise. All draws come from the
    // build rng: the texture is identical for a given seed.
    for (let i = 0; i < 900; i++) {
      const x = rng() * 128;
      const y = rng() * 128;
      const len = 3 + rng() * 7;
      const lean = (rng() - 0.5) * 4;
      const a = 0.25 + rng() * 0.75;
      ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.lineWidth = 1 + rng();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + lean, y + len);
      ctx.stroke();
    }
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Wrap a geometry in fur: opaque root mesh + shells displaced along normals.
 * Shells carry a GPU sway shader (uFurTime / uFurSway / uFurAmp): a breeze
 * term plus a motion-reactive bend so the fur trails the avatar's movement
 * and breathes in the wind without any per-frame CPU work. Shader uniform
 * handles are collected into shaderSink for the host to drive.
 * Returns { group, materials } — materials[0] is the root material.
 */
function furPart(THREE, geometry, { root = FUR_ROOT, tip = FUR_TIP, shells = 9, length = 0.045, strandCanvas = null, disposables = null, rng = Math.random, shaderSink = null } = {}) {
  const group = new THREE.Group();
  const materials = [];
  const track = (m) => { materials.push(m); if (disposables) disposables.push(m); return m; };
  const rootMat = track(new THREE.MeshStandardMaterial({ color: root, roughness: 1, metalness: 0 }));
  const rootMesh = new THREE.Mesh(geometry, rootMat);
  group.add(rootMesh);

  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const hasNormals = !!nor;
  for (let i = 1; i <= shells; i++) {
    const t = i / shells;
    const g = geometry.clone();
    if (disposables) disposables.push(g);
    if (hasNormals) {
      const p = g.attributes.position;
      for (let v = 0; v < p.count; v++) {
        const d = length * t;
        p.setXYZ(v,
          p.getX(v) + nor.getX(v) * d,
          p.getY(v) + nor.getY(v) * d,
          p.getZ(v) + nor.getZ(v) * d);
      }
      p.needsUpdate = true;
    }
    const color = new THREE.Color(root).lerp(new THREE.Color(tip), t);
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 1, metalness: 0,
      transparent: true,
      opacity: 0.6 * (1 - t * 0.55),
      depthWrite: false,
    });
    // GPU fur simulation: outer shells sway with breeze + host-driven motion.
    // uShellT^2 keeps roots planted while tips move; uFurAmp freezes the sim
    // under reduced motion. One shared program via customProgramCacheKey.
    const shellT = t;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFurTime = { value: 0 };
      shader.uniforms.uFurSway = { value: new THREE.Vector3() };
      shader.uniforms.uFurAmp = { value: 1 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uFurTime;\nuniform vec3 uFurSway;\nuniform float uFurAmp;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float furBand = ${shellT.toFixed(4)} * ${shellT.toFixed(4)} * uFurAmp;
          float breeze = sin(uFurTime * 2.3 + position.y * 14.0 + position.x * 9.0)
                       + 0.5 * sin(uFurTime * 3.7 + position.z * 17.0);
          transformed += uFurSway * furBand * (0.55 + 0.15 * breeze);
          transformed.x += furBand * 0.008 * breeze;
          transformed.z += furBand * 0.006 * breeze;
        }`);
      if (shaderSink) shaderSink.push(shader);
    };
    mat.customProgramCacheKey = () => 'tumbo-fur-sway-v1';
    if (strandCanvas && typeof THREE.CanvasTexture === 'function') {
      try {
        const tex = new THREE.CanvasTexture(strandCanvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(3, 3);
        tex.offset.set(rng(), rng());
        mat.alphaMap = tex;
        if (disposables) disposables.push(tex);
      } catch { /* strand texture is decoration; fur stands without it */ }
    }
    track(mat);
    const shell = new THREE.Mesh(g, mat);
    // Render back-to-front so deeper shells don't punch through outer ones.
    shell.renderOrder = 10 - i;
    group.add(shell);
  }
  return { group, materials };
}

export function buildTumboFluffyRig(THREE, { seed = 0, muffColor = CUSHION_GREY, faceDecalUrl = null, decalRegistry = null, furQuality = 1 } = {}) {
  if (!THREE) throw new Error('buildTumboFluffyRig needs THREE');
  const disposables = [];
  // Seeded automatic generation: the whole build (strand texture, shell
  // offsets, locs) is a pure function of `seed` — the same seed always
  // grows the same Tumbo, so the identity fingerprint is stable.
  const rng = mulberry32(seed >>> 0);
  const furShaders = [];
  const strandCanvas = makeStrandTexture(rng);
  // Shell-count LOD: small screens grow fewer shells automatically.
  const q = Math.max(0.45, Math.min(1, furQuality));
  const shellsFor = (n) => Math.max(4, Math.round(n * q));

  const group = new THREE.Group();
  group.userData.fluffyRig = true;
  const joints = {};
  const blinkBalls = [];
  const joint = (name, parent, x, y, z) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    joints[name] = g;
    return g;
  };
  const mesh = (geometry, material, parent) => {
    const m = new THREE.Mesh(geometry, material);
    parent.add(m);
    return m;
  };
  const fur = (geometry, parent, opts = {}) => {
    const part = furPart(THREE, geometry, { strandCanvas, disposables, rng, shaderSink: furShaders, ...opts });
    parent.add(part.group);
    return part;
  };

  // ---- shared materials ----
  const creamMat = new THREE.MeshStandardMaterial({ color: CREAM, roughness: 1 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: muffColor, roughness: 0.9 });
  const bandMat = new THREE.MeshStandardMaterial({ color: HEADPHONE_GREY, roughness: 0.6 });
  const locMat = new THREE.MeshStandardMaterial({ color: LOC_COLOR, roughness: 1 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: EYE_COLOR, roughness: 0.25 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: '#2a1a12', roughness: 0.8 });
  const blushMat = new THREE.MeshStandardMaterial({ color: '#d98a7a', roughness: 1, transparent: true, opacity: 0.55 });
  disposables.push(creamMat, cushionMat, bandMat, locMat, eyeMat, mouthMat, blushMat);

  // ---- body mass ----
  const hips = joint('hips', group, 0, 0.62, 0);
  {
    const egg = new THREE.SphereGeometry(0.34, 28, 20);
    egg.scale(1.06, 1.02, 0.92);
    const body = fur(egg, hips, { shells: shellsFor(10), length: 0.05 });
    body.group.position.set(0, 0.10, 0);
    disposables.push(egg);
  }
  const spine = joint('spine', hips, 0, 0.14, 0);

  // ---- head: the dominant mass, per the reference ----
  const neck = joint('neck', spine, 0, 0.20, 0);
  const head = joint('head', neck, 0, 0.18, 0);
  {
    const skull = new THREE.SphereGeometry(0.40, 32, 24);
    skull.scale(1, 1.04, 0.94);
    const h = fur(skull, head, { shells: shellsFor(11), length: 0.055 });
    h.group.position.set(0, 0.10, 0);
    disposables.push(skull);
  }
  // Cream face patch: a squashed sphere nested into the front of the head.
  // Its own light fur blends the edge into the brown so there is no hard seam.
  {
    const patch = new THREE.SphereGeometry(0.30, 28, 20);
    patch.scale(1.02, 0.88, 0.62);
    const p = fur(patch, head, { root: CREAM, tip: CREAM_TIP, shells: shellsFor(6), length: 0.03 });
    p.group.position.set(0, 0.06, 0.235);
    // Swap the brown root material for cream on the base mesh.
    p.group.children[0].material = creamMat;
    disposables.push(patch);
  }
  // Bead eyes with the same blink contract as the chibi rig. They sit proud
  // of the cream patch: the patch ellipsoid's front surface reaches
  // z≈0.42 at the face center, so the features mount just beyond it.
  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.037, 14, 10), eyeMat, head);
    eye.position.set(side * 0.135, 0.10, 0.425);
    eye.userData.baseScaleY = 1;
    blinkBalls.push(eye);
    const glint = mesh(new THREE.SphereGeometry(0.011, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }), head);
    glint.position.set(side * 0.135 + 0.012, 0.112, 0.452);
  }
  // Tiny :3 mouth from two arcs.
  for (const side of [-1, 1]) {
    const arc = mesh(new THREE.TorusGeometry(0.028, 0.0085, 8, 12, Math.PI * 0.75), mouthMat, head);
    arc.position.set(side * 0.026, 0.005, 0.435);
    arc.rotation.z = side < 0 ? Math.PI * 1.12 : Math.PI * 0.13;
  }
  // Soft blush, per the reference's pink cheeks.
  for (const side of [-1, 1]) {
    const blush = mesh(new THREE.SphereGeometry(0.045, 10, 8), blushMat, head);
    blush.position.set(side * 0.225, 0.03, 0.375);
    blush.scale.set(1, 0.6, 0.45);
  }

  // ---- headphones: grey band over the crown, plush cups on the ears ----
  // Cup meshes are exposed (with their rest positions) so the jiggle engine
  // can bounce them as sprung secondary motion.
  const headphoneCups = [];
  {
    const band = mesh(new THREE.TorusGeometry(0.40, 0.034, 10, 40, Math.PI), bandMat, head);
    band.position.set(0, 0.16, 0);
    band.rotation.y = Math.PI / 2;
    // The torus arc starts at +X and sweeps PI; rotating y by PI/2 lays the
    // arc over the crown from ear to ear.
    band.rotation.z = 0;
    for (const side of [-1, 1]) {
      const cup = mesh(new THREE.SphereGeometry(0.125, 18, 14), bandMat, head);
      cup.position.set(side * 0.40, 0.10, 0);
      cup.scale.set(0.62, 1.05, 0.95);
      cup.userData.basePos = cup.position.clone();
      headphoneCups.push(cup);
      const cushion = mesh(new THREE.TorusGeometry(0.085, 0.032, 10, 24), cushionMat, head);
      cushion.position.set(side * 0.345, 0.10, 0);
      cushion.rotation.y = Math.PI / 2;
    }
  }

  // ---- locs: black locs poking out from under the headphone band ----
  {
    const locSpots = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.35;
      // Skip the face front so the cream patch stays clean.
      const deg = ((a * 180) / Math.PI) % 360;
      if (deg > 290 || deg < 70) continue;
      locSpots.push(a);
    }
    for (const a of locSpots) {
      const r = 0.36;
      const sx = Math.cos(a) * r, sz = Math.sin(a) * r * 0.9;
      const len = 0.14 + ((a * 7) % 1) * 0.08;
      const out = 1 + 0.35 * rng();
      // Locs curl outward and slightly down around the headphones, not
      // straight up — the reference shows them escaping sideways.
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx, 0.30, sz),
        new THREE.Vector3(sx * 1.3 * out, 0.30 + len * 0.25, sz * 1.3 * out),
        new THREE.Vector3(sx * 1.45 * out, 0.30 + len * 0.1, sz * 1.45 * out),
      ]);
      const tube = new THREE.TubeGeometry(curve, 8, 0.026, 7, false);
      disposables.push(tube);
      mesh(tube, locMat, head);
    }
  }

  // ---- stubby arms ----
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'Left' : 'Right';
    const arm = joint('arm' + name, spine, side * 0.30, 0.10, 0);
    arm.rotation.z = side * 0.18;
    {
      const upper = new THREE.CapsuleGeometry(0.070, 0.10, 6, 12);
      const u = fur(upper, arm, { shells: shellsFor(7), length: 0.035 });
      u.group.position.y = -0.10;
      disposables.push(upper);
    }
    const elbow = joint('elbow' + name, arm, 0, -0.20, 0);
    const hand = joint('hand' + name, elbow, 0, -0.12, 0);
    {
      const paw = new THREE.SphereGeometry(0.075, 14, 10);
      paw.scale(0.95, 1.1, 0.9);
      const p = fur(paw, hand, { shells: shellsFor(7), length: 0.035 });
      p.group.position.y = -0.05;
      disposables.push(paw);
    }
  }

  // ---- stubby legs + feet ----
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'Left' : 'Right';
    const leg = joint('leg' + name, hips, side * 0.14, -0.06, 0);
    {
      const foot = new THREE.SphereGeometry(0.105, 14, 10);
      foot.scale(1, 0.72, 1.35);
      const f = fur(foot, leg, { shells: shellsFor(7), length: 0.035 });
      f.group.position.set(0, -0.30, 0.05);
      disposables.push(foot);
    }
  }

  // ---- tail nub ----
  const tail = joint('tail', hips, 0, 0.06, -0.30);
  {
    const nub = new THREE.SphereGeometry(0.10, 12, 10);
    const t = fur(nub, tail, { shells: shellsFor(7), length: 0.04 });
    disposables.push(nub);
  }

  // ---- optional personal portrait decal on the forehead ----
  let decalMesh = null;
  const canDecal = typeof faceDecalUrl === 'string' && faceDecalUrl.length > 0
    && typeof THREE.TextureLoader === 'function'
    && typeof Image !== 'undefined';
  if (canDecal) {
    decalMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.085, 20),
      new THREE.MeshBasicMaterial({ transparent: true }),
    );
    decalMesh.position.set(0, 0.34, 0.30);
    decalMesh.rotation.x = -0.25;
    decalMesh.userData.part = 'face-decal';
    head.add(decalMesh);
    new THREE.TextureLoader().load(faceDecalUrl, (texture) => {
      decalMesh.material.map = texture;
      decalMesh.material.needsUpdate = true;
    });
    if (decalRegistry) decalRegistry.push(decalMesh.material);
  }

  group.traverse((object) => {
    if (object.isMesh) { object.castShadow = false; object.receiveShadow = false; }
  });

  const rest = {};
  for (const [name, j] of Object.entries(joints)) rest[name] = j.quaternion.clone();

  const materials = { cream: creamMat, cushion: cushionMat, band: bandMat, loc: locMat, eye: eyeMat };

  return Object.freeze({
    group, joints, blinkBalls, blinkLids: [], tail, rest, seed, materials,
    baseHeight: FLUFFY_RIG_BASE_HEIGHT,
    fluffy: true,
    hasFaceDecal: decalMesh !== null,
    hasChestText: false,
    // Packet 236: live handles for the simulation layer — GPU fur shader
    // uniforms (uFurTime/uFurSway/uFurAmp) and the sprung headphone cups.
    furShaders,
    headphoneCups,
    dispose() { for (const d of disposables) { try { d.dispose?.(); } catch { /* noop */ } } },
  });
}
