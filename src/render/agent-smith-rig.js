/**
 * agent-smith-rig.js — Agent Smith, the in-world avatar character.
 *
 * A procedural Pixar-style build from the approved reference: a 3D
 * Black man with warm brown skin, short black hair, a warm friendly
 * smile, a brown suit jacket, tan dress shirt, brown tie, brown
 * trousers and black dress shoes. Stylized proportions (slightly
 * larger head) are preferred over photorealism.
 *
 * three.js r179.1 only. No other 3D library, no raw WebGL, no CSS-3D.
 * The module never imports 'three' itself — it takes the THREE namespace,
 * so it stays testable in node against the vendored build.
 *
 * Joint contract (mirrors the studio avatar's humanoid layout):
 *   root, spine, neck, head,
 *   leftArm, rightArm, leftElbow, rightElbow, leftHand, rightHand,
 *   leftLeg, rightLeg
 * Returns a frozen record:
 *   { group, joints, rest, blinkers, headMesh, materials, pickMeshes,
 *     baseHeight, seed, displayName, dispose() }
 * `rest` holds the bind-pose quaternions; `blinkers` are the eye-white
 * meshes (with userData.baseScaleY) for blink animation; `pickMeshes`
 * are all clickable meshes, each tagged with userData.smithPart
 * ('head' | 'torso' | 'greet').
 */

export const AGENT_SMITH_BASE_HEIGHT = 2.0;
export const AGENT_SMITH_DISPLAY_NAME = 'Agent Smith';

const SKIN = '#7d4e30';       // warm brown skin
const SKIN_LIGHT = '#8f5f3a'; // subtle highlight (ears, nose bridge)
const HAIR = '#14100c';       // short black hair
const SUIT = '#6b4a2f';       // brown suit jacket (canonical look)
const TROUSER = '#59391f';    // brown trousers
const SHIRT = '#d9b98c';      // tan dress shirt
const TIE = '#5a3a22';        // brown tie (wardrobe-tintable)
const SHOE = '#17120e';       // black dress shoes
const EYE_WHITE = '#f2ede4';
const PUPIL = '#14100c';
const MOUTH = '#40251a';

export function buildAgentSmithRig(THREE, { seed = 0 } = {}) {
  if (!THREE) throw new Error('buildAgentSmithRig needs THREE');
  const disposables = [];
  const track = (d) => { disposables.push(d); return d; };

  const group = new THREE.Group();
  group.name = 'Agent Smith';
  group.userData.agentSmithRig = true;

  const joints = {};
  const blinkers = [];
  const pickMeshes = [];

  const mat = (color, roughness = 0.65, extra = {}) =>
    track(new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04, ...extra }));
  const skinMat = mat(SKIN, 0.62);
  const skinLightMat = mat(SKIN_LIGHT, 0.62);
  const hairMat = mat(HAIR, 0.5);
  const suitMat = mat(SUIT, 0.72);
  const trouserMat = mat(TROUSER, 0.74);
  const shirtMat = mat(SHIRT, 0.8);
  const tieMat = mat(TIE, 0.6);
  const shoeMat = mat(SHOE, 0.32, { metalness: 0.25 });
  const eyeWhiteMat = mat(EYE_WHITE, 0.35);
  const pupilMat = mat(PUPIL, 0.25);
  const mouthMat = mat(MOUTH, 0.7);

  const joint = (name, parent, x, y, z) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    joints[name] = g;
    return g;
  };
  const mesh = (geometry, material, parent, part = 'greet') => {
    track(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.userData.smithPart = part;
    parent.add(m);
    pickMeshes.push(m);
    return m;
  };

  // ---- hips / pelvis ----
  // The character floats: feet dangle ~0.3 above the rig origin, and the
  // studio bobs the whole group on top of that.
  const root = joint('root', group, 0, 0.95, 0);
  {
    const pelvis = mesh(new THREE.SphereGeometry(0.155, 20, 14), trouserMat, root, 'greet');
    pelvis.position.set(0, 0.02, 0);
    pelvis.scale.set(1.12, 0.72, 0.88);
  }
  const spine = joint('spine', root, 0, 0.10, 0);

  // ---- torso: brown suit jacket over a tan shirt ----
  {
    const jacket = mesh(new THREE.CylinderGeometry(0.20, 0.175, 0.55, 20), suitMat, spine, 'torso');
    jacket.position.set(0, 0.30, 0);
    jacket.scale.z = 0.75;
    // Jacket skirt flare over the hips.
    const skirt = mesh(new THREE.CylinderGeometry(0.175, 0.195, 0.14, 20), suitMat, spine, 'torso');
    skirt.position.set(0, 0.035, 0);
    skirt.scale.z = 0.75;
    // Tan shirt front panel.
    const shirtPanel = mesh(new THREE.BoxGeometry(0.15, 0.40, 0.02), shirtMat, spine, 'greet');
    shirtPanel.position.set(0, 0.32, 0.138);
    // Lapels.
    for (const side of [-1, 1]) {
      const lapel = mesh(new THREE.BoxGeometry(0.085, 0.34, 0.018), suitMat, spine, 'torso');
      lapel.position.set(side * 0.108, 0.36, 0.152);
      lapel.rotation.z = -side * 0.30;
      lapel.rotation.y = side * 0.18;
    }
    // Tie: knot + tapered blade (wardrobe tints the tie).
    const knot = mesh(new THREE.BoxGeometry(0.055, 0.07, 0.035), tieMat, spine, 'greet');
    knot.position.set(0, 0.485, 0.150);
    const blade = mesh(new THREE.CylinderGeometry(0.026, 0.036, 0.34, 4), tieMat, spine, 'greet');
    blade.position.set(0, 0.28, 0.152);
    blade.rotation.y = Math.PI / 4;
    // Pocket square, same cloth as the tie.
    const square = mesh(new THREE.BoxGeometry(0.05, 0.035, 0.012), tieMat, spine, 'torso');
    square.position.set(-0.115, 0.44, 0.128);
    square.rotation.z = 0.1;
    // Single jacket button.
    const button = mesh(new THREE.SphereGeometry(0.014, 10, 8), shoeMat, spine, 'torso');
    button.position.set(0, 0.20, 0.148);
  }

  // ---- neck & head ----
  const neck = joint('neck', spine, 0, 0.585, 0);
  mesh(new THREE.CylinderGeometry(0.06, 0.072, 0.12, 16), skinMat, neck, 'greet').position.set(0, 0.03, 0);
  // Shirt collar peeking above the jacket.
  {
    const collar = mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.05, 16), shirtMat, neck, 'greet');
    collar.position.set(0, -0.01, 0.01);
  }
  const head = joint('head', neck, 0, 0.13, 0);
  head.scale.setScalar(1.08);
  const skull = mesh(new THREE.SphereGeometry(0.175, 28, 20), skinMat, head, 'head');
  skull.position.set(0, 0.03, 0);
  skull.scale.set(0.98, 1.12, 0.95);
  const headMesh = skull;
  {
    const jaw = mesh(new THREE.SphereGeometry(0.125, 20, 14), skinMat, head, 'head');
    jaw.position.set(0, -0.075, 0.015);
    jaw.scale.set(0.92, 0.72, 0.90);
    // Short black hair: a cap slightly proud of the skull.
    const hairCap = mesh(
      new THREE.SphereGeometry(0.183, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52),
      hairMat, head, 'head'
    );
    hairCap.position.set(0, 0.048, -0.014);
    hairCap.scale.set(0.99, 1.03, 0.96);
    for (const side of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(0.032, 12, 10), skinMat, head, 'head');
      ear.position.set(side * 0.168, -0.01, 0.005);
      // Eyes: warm white with dark pupils, per the reference's friendly read.
      const white = mesh(new THREE.SphereGeometry(0.033, 14, 10), eyeWhiteMat, head, 'head');
      white.position.set(side * 0.066, 0.020, 0.150);
      white.scale.set(1, 1.2, 0.6);
      white.userData.baseScaleY = 1.2;
      blinkers.push(white);
      const pupil = mesh(new THREE.SphereGeometry(0.0135, 10, 8), pupilMat, head, 'head');
      pupil.position.set(side * 0.066, 0.020, 0.168);
      // Brows.
      const brow = mesh(new THREE.BoxGeometry(0.058, 0.013, 0.018), hairMat, head, 'head');
      brow.position.set(side * 0.066, 0.082, 0.158);
      brow.rotation.z = -side * 0.09;
    }
    // Nose.
    const nose = mesh(new THREE.SphereGeometry(0.021, 10, 8), skinMat, head, 'head');
    nose.position.set(0, -0.018, 0.170);
    nose.scale.set(0.95, 1.15, 0.9);
    const bridge = mesh(new THREE.SphereGeometry(0.016, 8, 6), skinLightMat, head, 'head');
    bridge.position.set(0, 0.002, 0.166);
    // Warm friendly smile: a torus arc centered on the bottom.
    const smile = mesh(new THREE.TorusGeometry(0.048, 0.0095, 8, 20, Math.PI * 0.72), mouthMat, head, 'head');
    smile.position.set(0, -0.058, 0.156);
    smile.rotation.z = Math.PI * 1.14;
  }

  // ---- arms: brown sleeves, skin hands ----
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'left' : 'right';
    const arm = joint(name + 'Arm', spine, side * 0.245, 0.47, 0);
    arm.rotation.z = side * 0.10;
    {
      const shoulder = mesh(new THREE.SphereGeometry(0.085, 14, 10), suitMat, arm);
      shoulder.position.set(0, -0.02, 0);
      shoulder.scale.set(1.1, 0.9, 1);
      const sleeve = mesh(new THREE.CapsuleGeometry(0.062, 0.20, 6, 12), suitMat, arm);
      sleeve.position.set(0, -0.16, 0);
    }
    const elbow = joint(name + 'Elbow', arm, 0, -0.31, 0);
    elbow.rotation.x = -0.06;
    {
      const forearm = mesh(new THREE.CapsuleGeometry(0.055, 0.18, 6, 12), suitMat, elbow);
      forearm.position.set(0, -0.13, 0);
      const cuff = mesh(new THREE.CylinderGeometry(0.06, 0.062, 0.05, 14), shirtMat, elbow);
      cuff.position.set(0, -0.26, 0);
    }
    const hand = joint(name + 'Hand', elbow, 0, -0.30, 0);
    {
      const palm = mesh(new THREE.SphereGeometry(0.058, 14, 10), skinMat, hand);
      palm.position.set(0, -0.07, 0);
      palm.scale.set(0.92, 1.3, 0.92);
      const thumb = mesh(new THREE.CapsuleGeometry(0.016, 0.045, 4, 8), skinMat, hand);
      thumb.position.set(side * 0.05, -0.05, 0.02);
      thumb.rotation.z = -side * 0.5;
    }
  }

  // ---- legs: brown trousers, black dress shoes, dangling (he floats) ----
  for (const side of [-1, 1]) {
    const name = side < 0 ? 'left' : 'right';
    const leg = joint(name + 'Leg', root, side * 0.105, -0.04, 0);
    {
      const thigh = mesh(new THREE.CapsuleGeometry(0.078, 0.30, 6, 12), trouserMat, leg);
      thigh.position.set(0, -0.20, 0);
      const shoe = mesh(new THREE.SphereGeometry(0.085, 16, 12), shoeMat, leg);
      shoe.position.set(0, -0.52, 0.045);
      shoe.scale.set(0.95, 0.62, 1.55);
      const toeCap = mesh(new THREE.SphereGeometry(0.05, 12, 10), shoeMat, leg);
      toeCap.position.set(0, -0.545, 0.14);
      toeCap.scale.set(0.9, 0.55, 0.9);
    }
  }

  group.traverse((object) => {
    if (object.isMesh) { object.castShadow = false; object.receiveShadow = false; }
  });

  const rest = {};
  for (const [name, j] of Object.entries(joints)) rest[name] = j.quaternion.clone();

  const materials = { skin: skinMat, hair: hairMat, suit: suitMat, shirt: shirtMat, tie: tieMat, trouser: trouserMat, shoe: shoeMat,
    // Wardrobe-tint alias: the studio's outfit trim dresses the tie.
    cushion: tieMat };

  return Object.freeze({
    group, joints, rest, blinkers, headMesh, materials, pickMeshes,
    baseHeight: AGENT_SMITH_BASE_HEIGHT,
    seed,
    displayName: AGENT_SMITH_DISPLAY_NAME,
    dispose() { for (const d of disposables) { try { d.dispose?.(); } catch { /* noop */ } } },
  });
}
