/** Miniature articulated Tumbo chibi rig — the chess piece body.
 *
 * Pure builders: takes the THREE namespace plus the shared geometry cache
 * and material set from the piece foundry, so all 32 pieces share draw
 * state. Never imports 'three' itself; testable in node against the
 * vendored build.
 *
 * The rig mirrors the Person Studio avatar's reference look (Packet 230)
 * simplified for board scale: big chibi head, fluffy earmuffs, black hoodie
 * with drawstrings, brown furry paws, fluffy tail, locs, eyeliner, beauty
 * mark, goatee. Joints are named Groups; updateTumboChibiRig() drives the
 * shared avatar motion language (src/domains/avatar-motion.js).
 *
 * Projection only: local simulation, no identity authority, no wallet.
 */
import {
  AVATAR_GREET,
  AVATAR_CELEBRATE,
  avatarBlink,
  avatarBowPose,
  avatarIdlePose,
  avatarJumpPose,
  avatarSpinPose,
  avatarWalkPhase,
  avatarWavePose,
} from '../domains/avatar-motion.js';

/** Base height of the rig in arena units before per-role scaling. */
export const CHIBI_RIG_BASE_HEIGHT = 1.7;

/** Celebration/select modes the rig can play, with their durations. */
export const CHIBI_RIG_MODES = Object.freeze({
  idle: 0,
  wave: AVATAR_GREET.durations.wave,
  hop: AVATAR_CELEBRATE.hop,
  walk: 0, // persists while the piece travels
  bow: AVATAR_CELEBRATE.bow,
  spin: AVATAR_CELEBRATE.spin,
});

function qFromEuler(THREE, x, y, z) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
}

/** Build one articulated chibi. `mats` needs skin, hair, outfit, trim, paw,
 *  muff, eyeWhite, iris, pupil, liner, lips. Returns the rig record. */
export function buildTumboChibiRig(THREE, G, M, { seed = 0, faceDecalUrl = null, decalRegistry = null } = {}) {
  if (!THREE || !G || !M) throw new Error('buildTumboChibiRig needs THREE, a geometry cache, and materials');
  const group = new THREE.Group();
  group.userData.chibiRig = true;
  const joints = {};
  const blinkBalls = [];
  const blinkLids = [];
  const add = (parent, object) => { parent.add(object); return object; };
  const mesh = (geometry, material, parent) => add(parent, new THREE.Mesh(geometry, material));
  const joint = (name, parent, x, y, z) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    add(parent, g);
    joints[name] = g;
    return g;
  };

  // ---- body ----
  const hips = joint('hips', group, 0, 0.60, 0);
  const pelvis = mesh(G.sphere(0.16, 12, 8), M.outfit, hips);
  pelvis.scale.set(1.25, 0.75, 0.9);
  const spine = joint('spine', hips, 0, 0.08, 0);
  const torsoMesh = mesh(G.cylinder(0.155, 0.185, 0.44, 14), M.outfit, spine);
  torsoMesh.position.y = 0.30;
  torsoMesh.scale.z = 0.78;
  for (const side of [-1, 1]) {
    const shoulder = mesh(G.sphere(0.085, 10, 8), M.outfit, spine);
    shoulder.position.set(side * 0.20, 0.48, 0);
    // Hoodie drawstrings.
    const string = mesh(G.cylinder(0.008, 0.008, 0.16, 6), M.trim, spine);
    string.position.set(side * 0.05, 0.42, 0.135);
  }
  const pocket = mesh(G.box(0.20, 0.13, 0.05), M.outfit, spine);
  pocket.position.set(0, 0.12, 0.135);
  const zipper = mesh(G.box(0.014, 0.40, 0.012), M.trim, spine);
  zipper.position.set(0, 0.30, 0.148);

  // ---- head (big chibi read) ----
  const neck = joint('neck', spine, 0, 0.55, 0);
  const head = joint('head', neck, 0, 0.14, 0);
  const skull = mesh(G.sphere(0.26, 18, 14), M.skin, head);
  skull.scale.set(1, 1.12, 0.94);
  const jaw = mesh(G.sphere(0.20, 14, 10), M.skin, head);
  jaw.position.set(0, -0.13, 0.03);
  jaw.scale.set(0.95, 0.7, 0.9);
  for (const side of [-1, 1]) {
    const ear = mesh(G.sphere(0.045, 8, 6), M.skin, head);
    ear.position.set(side * 0.245, 0.0, 0);
    // Eyeliner rims the eye from behind the white.
    const rim = mesh(G.sphere(0.048, 10, 8), M.liner, head);
    rim.position.set(side * 0.088, 0.03, 0.205);
    rim.scale.set(1, 0.62, 0.35);
    const eye = mesh(G.sphere(0.046, 10, 8), M.eyeWhite, head);
    eye.position.set(side * 0.088, 0.03, 0.215);
    eye.scale.set(1, 0.6, 0.4);
    eye.userData.baseScaleY = 0.6;
    blinkBalls.push(eye);
    const irisMesh = mesh(G.sphere(0.021, 8, 6), M.iris, head);
    irisMesh.position.set(side * 0.088, 0.03, 0.245);
    const pupilMesh = mesh(G.sphere(0.010, 6, 5), M.pupil, head);
    pupilMesh.position.set(side * 0.088, 0.03, 0.258);
    const brow = mesh(G.box(0.085, 0.016, 0.02), M.hair, head);
    brow.position.set(side * 0.088, 0.105, 0.225);
    brow.rotation.z = -side * 0.10;
    const lid = mesh(G.sphere(0.05, 10, 8), M.skin, head);
    lid.position.set(side * 0.088, 0.055, 0.21);
    lid.scale.set(1, 0.35, 0.4);
    blinkLids.push(lid);
  }
  const nose = mesh(G.sphere(0.024, 8, 6), M.skin, head);
  nose.position.set(0, -0.02, 0.245);
  const mouth = mesh(G.box(0.07, 0.013, 0.014), M.lips, head);
  mouth.position.set(0, -0.085, 0.232);
  // Beauty mark on the cheek, per the reference portrait.
  const mark = mesh(G.sphere(0.009, 6, 5), M.liner, head);
  mark.position.set(0.068, -0.055, 0.222);
  // Goatee: chin beard + mustache.
  const beard = mesh(G.sphere(0.10, 10, 8), M.hair, head);
  beard.position.set(0, -0.155, 0.10);
  beard.scale.set(1.05, 0.32, 0.62);
  for (const side of [-1, 1]) {
    const mustache = mesh(G.sphere(0.036, 8, 6), M.hair, head);
    mustache.position.set(side * 0.038, -0.075, 0.225);
    mustache.scale.set(1, 0.32, 0.4);
    mustache.rotation.z = side > 0 ? -0.15 : 0.15;
  }
  // Locs: tapered cones angled outward-down around the crown.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    const loc = mesh(G.cone(0.028, 0.34, 7), M.hair, head);
    const r = 0.20;
    loc.position.set(Math.cos(a) * r, 0.16, Math.sin(a) * r * 0.9 - 0.03);
    loc.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.55);
  }
  // Fluffy earmuffs: headband + two plush cups. A full torus (not a
  // partial crown arc) was compared and retained: it physically connects
  // both cups, reads identically from the front, and stays correct from
  // side/back angles; the lower half hides behind the head/neck.
  const band = mesh(G.torus(0.27, 0.028), M.muff, head);
  band.position.set(0, 0.10, -0.01);
  for (const side of [-1, 1]) {
    const cup = mesh(G.sphere(0.095, 12, 10), M.muff, head);
    cup.position.set(side * 0.265, 0.02, 0);
    cup.scale.set(0.85, 1.05, 0.85);
  }
  // Optional personal portrait decal: the user's own chibi picture on the
  // forehead band area — worn only when a personal portrait exists.
  // Default (null): the geometric Tumbo face is the whole read.
  let decalMesh = null;
  const canDecal = typeof faceDecalUrl === 'string' && faceDecalUrl.length > 0
    && typeof THREE.TextureLoader === 'function'
    && typeof Image !== 'undefined';
  if (canDecal) {
    decalMesh = new THREE.Mesh(
      G.circle(0.085, 20),
      new THREE.MeshBasicMaterial({ transparent: true }),
    );
    decalMesh.position.set(0, 0.185, 0.20);
    decalMesh.rotation.x = -0.18;
    decalMesh.userData.part = 'face-decal';
    head.add(decalMesh);
    new THREE.TextureLoader().load(faceDecalUrl, (texture) => {
      decalMesh.material.map = texture;
      decalMesh.material.needsUpdate = true;
    });
    if (decalRegistry) decalRegistry.push(decalMesh.material);
  }

  // ---- arms ----
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'Left' : 'Right';
    const arm = joint('arm' + name, spine, side * 0.235, 0.46, 0);
    arm.rotation.z = side * 0.14;
    const upper = mesh(G.capsule(0.058, 0.16), M.outfit, arm);
    upper.position.y = -0.12;
    const elbow = joint('elbow' + name, arm, 0, -0.24, 0);
    elbow.rotation.x = -0.08;
    const fore = mesh(G.capsule(0.052, 0.14), M.outfit, elbow);
    fore.position.y = -0.10;
    const hand = joint('hand' + name, elbow, 0, -0.21, 0);
    const paw = mesh(G.sphere(0.072, 10, 8), M.paw, hand);
    paw.position.y = -0.05;
    paw.scale.set(0.9, 1.1, 0.85);
  }

  // ---- legs ----
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'Left' : 'Right';
    const leg = joint('leg' + name, hips, side * 0.10, -0.02, 0);
    const thigh = mesh(G.capsule(0.075, 0.30), M.outfit, leg);
    thigh.position.y = -0.20;
    const foot = mesh(G.sphere(0.10, 10, 8), M.paw, leg);
    foot.position.set(0, -0.44, 0.055);
    foot.scale.set(0.95, 0.75, 1.35);
  }

  // ---- fluffy tail ----
  const tail = joint('tail', hips, 0.10, 0.10, -0.17);
  const tailSegs = [[0, 0, 0, 0.075], [0.035, 0.10, -0.055, 0.065], [0.085, 0.19, -0.075, 0.055]];
  for (const [x, y, z, r] of tailSegs) {
    const seg = mesh(G.sphere(r, 10, 8), M.paw, tail);
    seg.position.set(x, y, z);
  }

  group.traverse((object) => {
    if (object.isMesh) { object.castShadow = false; object.receiveShadow = false; }
  });

  const rest = {};
  for (const [name, j] of Object.entries(joints)) rest[name] = j.quaternion.clone();

  return Object.freeze({
    group, joints, blinkBalls, blinkLids, tail, rest, seed,
    baseHeight: CHIBI_RIG_BASE_HEIGHT,
    hasFaceDecal: decalMesh !== null,
  });
}

/** Drive one rig for a frame. Resets joints to rest, then composes:
 *  idle (breathe/bob/blink/sway/tail wag) plus one overlay mode —
 *  'wave' | 'hop' | 'walk' | 'bow' | 'spin'. Returns { lift } — extra
 *  vertical lift the caller adds to the rig's base Y (greet hops).
 *  Frozen under reducedMotion: idle only, overlays become no-ops. */
export function updateTumboChibiRig(THREE, rig, { time, seed = rig.seed, reducedMotion = false, mode = 'idle', modeT = 0 } = {}) {
  if (!Number.isFinite(time)) throw Error('updateTumboChibiRig needs a finite time');
  const { joints, rest, blinkBalls, tail } = rig;
  for (const [name, j] of Object.entries(joints)) j.quaternion.copy(rest[name]);
  const q = (x, y, z) => qFromEuler(THREE, x, y, z);
  const mul = (j, e) => j.quaternion.multiply(e);

  const idle = avatarIdlePose({ time, seed, reducedMotion });
  let lift = 0;
  let turn = 0;

  if (!reducedMotion) {
    // Breathing torso.
    const breath = Math.sin(time * 1.4 + seed);
    joints.spine.scale.set(1 - 0.006 * breath, 1 + 0.012 * breath, 1 - 0.006 * breath);
    // Idle head drift.
    mul(joints.head, q(Math.sin(time * 0.7 + 1 + seed) * 0.04, Math.sin(time * 0.5 + seed) * 0.06, 0));
    // Tail wag.
    tail.rotation.y = Math.sin(time * 2.2 + seed) * 0.16;
    tail.rotation.x = Math.sin(time * 1.7 + 1 + seed) * 0.08;

    if (mode === 'wave') {
      const w = avatarWavePose({ t: modeT / AVATAR_GREET.durations.wave });
      mul(joints.armRight, q(0, 0, w.armRaise));
      mul(joints.handRight, q(0, 0, w.handWave));
      mul(joints.head, q(0, 0, w.headTilt));
      lift += w.bounce * 0.10;
    } else if (mode === 'hop') {
      const j = avatarJumpPose({ t: modeT / AVATAR_CELEBRATE.hop });
      lift += j.lift * 0.45;
      mul(joints.armLeft, q(0, 0, -1.1 * j.lift));
      mul(joints.armRight, q(0, 0, 1.1 * j.lift));
    } else if (mode === 'walk') {
      const wp = avatarWalkPhase({ time });
      const swing = 0.55;
      mul(joints.legLeft, q(wp.legL * swing, 0, 0));
      mul(joints.legRight, q(wp.legR * swing, 0, 0));
      mul(joints.armLeft, q(wp.armL * swing * 0.7, 0, 0));
      mul(joints.armRight, q(wp.armR * swing * 0.7, 0, 0));
      lift += Math.abs(wp.legL) * 0.035;
      mul(joints.spine, q(0.08, 0, 0)); // slight forward lean
    } else if (mode === 'bow') {
      const b = avatarBowPose({ t: modeT / AVATAR_CELEBRATE.bow });
      mul(joints.spine, q(b.torsoPitch, 0, 0));
      mul(joints.head, q(b.headDip, 0, 0));
      mul(joints.armLeft, q(0, 0, -b.armSweep));
      mul(joints.armRight, q(0, 0, b.armSweep));
      mul(joints.legLeft, q(-b.kneeDip, 0, 0));
      mul(joints.legRight, q(-b.kneeDip, 0, 0));
    } else if (mode === 'spin') {
      const s = avatarSpinPose({ t: modeT / AVATAR_CELEBRATE.spin });
      turn = s.turn;
      lift += s.hop * 0.16;
      mul(joints.armLeft, q(0, 0, -0.7 * Math.sin(Math.PI * Math.min(1, modeT / AVATAR_CELEBRATE.spin))));
      mul(joints.armRight, q(0, 0, 0.7 * Math.sin(Math.PI * Math.min(1, modeT / AVATAR_CELEBRATE.spin))));
    }
  } else {
    joints.spine.scale.set(1, 1, 1);
    tail.rotation.set(0, 0, 0);
  }

  // Blink: scale the eye whites' Y.
  const openness = avatarBlink({ time, seed, reducedMotion });
  for (const eye of blinkBalls) eye.scale.y = eye.userData.baseScaleY * openness;

  return Object.freeze({ bobY: idle.bobY, swayY: idle.swayY, glow: idle.glow, lift, turn });
}
