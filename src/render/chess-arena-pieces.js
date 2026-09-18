/** Chess Arena avatar piece foundry — Reality Lens cinematic staging builders.
 *
 * Pure builders: every factory takes the THREE namespace explicitly and this
 * module never imports 'three' itself, so the foundry is testable in node
 * against the vendored build. The browser mount (./chess-arena.js) passes the
 * import-mapped namespace.
 *
 * Pieces are stylized humanoid avatars wearing the user's approved Person
 * Studio appearance (skin, hair, outfit colors) read from the same
 * localStorage profile the studio saves. Side identity stays a chess read:
 * ivory/gold for white, obsidian/violet-glow for black.
 *
 * Projection only: no network, no identity authority, no wallet, no
 * settlement. Geometries and materials are shared across every piece so the
 * cinematic staging does not explode draw state.
 */
import {PERSON_STUDIO_STORAGE_KEY, STUDIO_MODEL, STUDIO_OUTFITS} from '../domains/person-studio.js';

export const CHESS_ARENA_PIECE_TYPES = Object.freeze(['p', 'n', 'b', 'r', 'q', 'k']);
const FILES = 'abcdefgh';

/** Board square -> [x, y, z] in arena units. No THREE dependency. */
export function squarePosition(square) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return [file - 3.5, 0.06, 3.5 - rank];
}

const DEFAULT_APPEARANCE = Object.freeze({
  skin: STUDIO_MODEL.skin,
  hair: STUDIO_MODEL.hair,
  outfitId: 'obsidian',
  outfitColor: '#111620',
  outfitTrim: '#d9ae60',
  displayName: '',
  approved: false,
});

function outfitById(id) {
  return STUDIO_OUTFITS.find((outfit) => outfit.id === id) ?? STUDIO_OUTFITS[0];
}

/** Read the approved avatar appearance from the Person Studio saved profile.
 *  Never throws: falls back to the reference defaults when nothing valid is
 *  saved. The renderer is a projection, not a validator — person-studio owns
 *  validation; here we only borrow its colors. */
export function readArenaAvatarAppearance({storage = null} = {}) {
  const fallback = () => Object.freeze({...DEFAULT_APPEARANCE});
  let store = storage;
  if (!store) {
    try {
      store = globalThis.localStorage ?? null;
    } catch {
      store = null;
    }
  }
  if (!store) return fallback();
  let raw = null;
  try {
    raw = store.getItem(PERSON_STUDIO_STORAGE_KEY);
  } catch {
    return fallback();
  }
  if (!raw) return fallback();
  let saved = null;
  try {
    saved = JSON.parse(raw);
  } catch {
    return fallback();
  }
  if (!saved || typeof saved !== 'object') return fallback();
  // The avatar snapshot's outfit asset is authoritative when present; the
  // top-level outfitId is the studio's current selection. Prefer the asset.
  let outfit = outfitById(typeof saved.outfitId === 'string' ? saved.outfitId : '');
  try {
    const snapshot = JSON.parse(saved.avatar);
    const asset = snapshot?.appearance?.outfitAssetIds?.[0];
    if (typeof asset === 'string' && asset.startsWith('studio-outfit:')) {
      outfit = outfitById(asset.slice('studio-outfit:'.length));
    }
  } catch {
    /* keep the studio selection */
  }
  return Object.freeze({
    skin: STUDIO_MODEL.skin,
    hair: STUDIO_MODEL.hair,
    outfitId: outfit.id,
    outfitColor: outfit.color,
    outfitTrim: outfit.trim,
    displayName: typeof saved.displayName === 'string' ? saved.displayName.slice(0, 60) : '',
    approved: true,
  });
}

function createGeometryCache(THREE) {
  const cache = new Map();
  const get = (key, make) => {
    let geometry = cache.get(key);
    if (!geometry) {
      geometry = make();
      cache.set(key, geometry);
    }
    return geometry;
  };
  return {
    capsule: (r, length) => get(`capsule:${r}:${length}`, () => new THREE.CapsuleGeometry(r, length, 4, 10)),
    sphere: (r, w = 14, h = 10) => get(`sphere:${r}:${w}:${h}`, () => new THREE.SphereGeometry(r, w, h)),
    hairCap: (r) => get(`haircap:${r}`, () => new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.58)),
    box: (w, h, d) => get(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d)),
    cone: (r, h, s = 8) => get(`cone:${r}:${h}:${s}`, () => new THREE.ConeGeometry(r, h, s)),
    cylinder: (rt, rb, h, s = 12) => get(`cyl:${rt}:${rb}:${h}:${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s)),
    torus: (r, t) => get(`torus:${r}:${t}`, () => new THREE.TorusGeometry(r, t, 10, 24)),
    circle: (r, s = 24) => get(`circle:${r}:${s}`, () => new THREE.CircleGeometry(r, s)),
    ring: (inner, outer, s = 64) => get(`ring:${inner}:${outer}:${s}`, () => new THREE.RingGeometry(inner, outer, s)),
    dispose() {
      cache.forEach((geometry) => geometry.dispose());
      cache.clear();
    },
  };
}

function createMaterialSet(THREE, appearance) {
  const source = appearance && typeof appearance === 'object' ? appearance : {};
  const std = (params) => new THREE.MeshStandardMaterial(params);
  return {
    skin: std({color: source.skin || DEFAULT_APPEARANCE.skin, roughness: 0.62, metalness: 0}),
    hair: std({color: source.hair || DEFAULT_APPEARANCE.hair, roughness: 0.48, metalness: 0.12}),
    outfit: std({color: source.outfitColor || DEFAULT_APPEARANCE.outfitColor, roughness: 0.5, metalness: 0.28}),
    trim: std({
      color: source.outfitTrim || DEFAULT_APPEARANCE.outfitTrim,
      emissive: source.outfitTrim || DEFAULT_APPEARANCE.outfitTrim,
      emissiveIntensity: 0.35, metalness: 0.6, roughness: 0.32,
    }),
    side: {
      w: {
        base: std({color: 0xe9dcc0, metalness: 0.35, roughness: 0.38}),
        glow: std({color: 0xffc25e, emissive: 0x9a5200, emissiveIntensity: 1.6, metalness: 0.55, roughness: 0.3}),
        ring: std({color: 0xffd98a, emissive: 0xd77a1a, emissiveIntensity: 2.4, metalness: 0.4, roughness: 0.35}),
      },
      b: {
        base: std({color: 0x211829, metalness: 0.55, roughness: 0.3}),
        glow: std({color: 0x9a5cff, emissive: 0x43119c, emissiveIntensity: 1.9, metalness: 0.45, roughness: 0.3}),
        ring: std({color: 0xb48cff, emissive: 0x5b1ee0, emissiveIntensity: 2.6, metalness: 0.4, roughness: 0.35}),
      },
    },
  };
}

/** Shared humanoid avatar body: glow ring, robed torso, pauldrons, head with
 *  the user's skin/hair, glowing side-colored eyes, cape. Returns the group
 *  plus an adder and head metrics for per-type regalia. */
function buildFigure(THREE, G, M, color, {height = 1.2, bodyR = 0.22, headR = 0.2, cape = true} = {}) {
  const side = M.side[color];
  const group = new THREE.Group();
  const add = (mesh, x, y, z, part) => {
    mesh.position.set(x, y, z);
    if (part) mesh.userData.part = part;
    group.add(mesh);
    return mesh;
  };
  const ring = new THREE.Mesh(G.torus(0.3, 0.045), side.ring);
  ring.rotation.x = Math.PI / 2;
  add(ring, 0, 0.05, 0, 'ring');
  add(new THREE.Mesh(G.capsule(bodyR, height * 0.42), M.outfit), 0, height * 0.44, 0, 'body');
  const chest = new THREE.Mesh(G.sphere(0.2), side.base);
  chest.scale.set(1.05, 0.72, 0.72);
  add(chest, 0, height * 0.55, 0.07, 'chest');
  for (const s of [-1, 1]) add(new THREE.Mesh(G.sphere(0.1), M.trim), s * (bodyR + 0.07), height * 0.62, 0, 'pauldron');
  const headY = height * 0.8;
  add(new THREE.Mesh(G.sphere(headR), M.skin), 0, headY, 0, 'head');
  const hair = new THREE.Mesh(G.hairCap(headR * 1.08), M.hair);
  hair.rotation.x = -0.38;
  add(hair, 0, headY + 0.035, -0.02, 'hair');
  add(new THREE.Mesh(G.box(0.17, 0.05, 0.05), side.glow), 0, headY + 0.01, headR * 1.0, 'eyes');
  if (cape) add(new THREE.Mesh(G.cone(bodyR * 1.35, height * 0.6, 7), M.outfit), 0, height * 0.45, -(bodyR + 0.08), 'cape');
  return {group, add, headY, headR};
}

function buildPawn(THREE, G, M, color) {
  const f = buildFigure(THREE, G, M, color, {height: 1.02, bodyR: 0.2});
  const shield = new THREE.Mesh(G.cylinder(0.17, 0.17, 0.035, 14), M.trim);
  shield.rotation.z = Math.PI / 2;
  f.add(shield, -0.3, 0.52, 0.12, 'shield');
  f.add(new THREE.Mesh(G.sphere(0.06), M.side[color].glow), -0.33, 0.52, 0.12, 'shield-boss');
  return f.group;
}

function buildKnight(THREE, G, M, color) {
  const side = M.side[color];
  const group = new THREE.Group();
  const add = (mesh, x, y, z, part) => {
    mesh.position.set(x, y, z);
    if (part) mesh.userData.part = part;
    group.add(mesh);
    return mesh;
  };
  const ring = new THREE.Mesh(G.torus(0.36, 0.05), side.ring);
  ring.rotation.x = Math.PI / 2;
  add(ring, 0, 0.05, 0, 'ring');
  const body = new THREE.Mesh(G.capsule(0.21, 0.55), side.base);
  body.rotation.z = Math.PI / 2;
  add(body, 0, 0.62, -0.02, 'horse-body');
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(new THREE.Mesh(G.cylinder(0.055, 0.045, 0.58, 8), side.base), sx * 0.2, 0.31, -0.02 + sz * 0.15, 'horse-leg');
    }
  }
  const neck = new THREE.Mesh(G.box(0.2, 0.52, 0.24), side.base);
  neck.rotation.x = -0.45;
  add(neck, 0, 0.98, 0.3, 'horse-neck');
  add(new THREE.Mesh(G.box(0.19, 0.22, 0.46), side.base), 0, 1.22, 0.5, 'horse-head');
  for (const s of [-1, 1]) add(new THREE.Mesh(G.cone(0.05, 0.15, 6), side.base), s * 0.07, 1.38, 0.42, 'horse-ear');
  const mane = new THREE.Mesh(G.box(0.07, 0.5, 0.12), side.glow);
  mane.rotation.x = -0.45;
  add(mane, 0, 1.06, 0.18, 'horse-mane');
  const tail = new THREE.Mesh(G.cone(0.06, 0.34, 6), M.hair);
  tail.rotation.x = 0.7;
  add(tail, 0, 0.72, -0.44, 'horse-tail');
  add(new THREE.Mesh(G.box(0.32, 0.09, 0.34), M.outfit), 0, 0.86, -0.04, 'saddle');
  const rider = buildFigure(THREE, G, M, color, {height: 0.78, bodyR: 0.15, headR: 0.14, cape: false});
  rider.group.position.set(0, 0.9, -0.04);
  rider.group.userData.part = 'rider';
  const helm = new THREE.Mesh(G.hairCap(0.155), M.trim);
  helm.rotation.x = -0.3;
  rider.add(helm, 0, rider.headY + 0.03, -0.01, 'helm');
  group.add(rider.group);
  return group;
}

function buildBishop(THREE, G, M, color) {
  const side = M.side[color];
  const f = buildFigure(THREE, G, M, color, {height: 1.3, bodyR: 0.22});
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(G.cone(0.07, 0.32, 6), M.trim);
    horn.rotation.z = -s * 0.55;
    f.add(horn, s * 0.17, f.headY + 0.14, 0, 'horn');
  }
  f.add(new THREE.Mesh(G.cylinder(0.028, 0.028, 1.5, 8), M.trim), 0.34, 0.78, 0, 'staff');
  f.add(new THREE.Mesh(G.sphere(0.09), side.glow), 0.34, 1.58, 0, 'staff-orb');
  return f.group;
}

function buildRook(THREE, G, M, color) {
  const side = M.side[color];
  const f = buildFigure(THREE, G, M, color, {height: 1.22, bodyR: 0.3});
  for (const s of [-1, 1]) f.add(new THREE.Mesh(G.box(0.18, 0.13, 0.18), side.base), s * 0.38, 1.22 * 0.62, 0, 'bulwark');
  const crownY = f.headY + f.headR + 0.1;
  f.add(new THREE.Mesh(G.cylinder(0.24, 0.26, 0.15, 8), M.trim), 0, crownY, 0, 'battlement');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    f.add(new THREE.Mesh(G.box(0.1, 0.11, 0.1), M.trim), Math.cos(a) * 0.2, crownY + 0.12, Math.sin(a) * 0.2, 'merlon');
  }
  return f.group;
}

function buildQueen(THREE, G, M, color) {
  const side = M.side[color];
  const f = buildFigure(THREE, G, M, color, {height: 1.45, bodyR: 0.23});
  const crownY = f.headY + f.headR + 0.05;
  const band = new THREE.Mesh(G.torus(0.16, 0.032), M.trim);
  band.rotation.x = Math.PI / 2;
  f.add(band, 0, crownY, 0, 'crown-band');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    f.add(new THREE.Mesh(G.cone(0.045, 0.17, 6), side.glow), Math.cos(a) * 0.15, crownY + 0.1, Math.sin(a) * 0.15, 'crown-point');
  }
  return f.group;
}

function buildKing(THREE, G, M, color) {
  const side = M.side[color];
  const f = buildFigure(THREE, G, M, color, {height: 1.58, bodyR: 0.25});
  const crownY = f.headY + f.headR + 0.09;
  f.add(new THREE.Mesh(G.cylinder(0.2, 0.23, 0.17, 10), M.trim), 0, crownY, 0, 'crown-band');
  f.add(new THREE.Mesh(G.box(0.05, 0.24, 0.05), side.glow), 0, crownY + 0.2, 0, 'crown-cross');
  f.add(new THREE.Mesh(G.box(0.15, 0.05, 0.05), side.glow), 0, crownY + 0.22, 0, 'crown-cross');
  return f.group;
}

/** Piece foundry with shared geometry/material caches. Dispose when the
 *  appearance is refreshed or the arena unmounts. */
export function createPieceBuilders(THREE, appearance = null) {
  if (!THREE) throw new Error('createPieceBuilders needs the THREE namespace');
  const resolved = Object.freeze({...DEFAULT_APPEARANCE, ...(appearance ?? {})});
  const G = createGeometryCache(THREE);
  const M = createMaterialSet(THREE, resolved);
  const builders = {p: buildPawn, n: buildKnight, b: buildBishop, r: buildRook, q: buildQueen, k: buildKing};
  function buildPiece(type, color) {
    const build = builders[type];
    if (!build) throw new Error(`Unknown chess piece type: ${type}`);
    if (color !== 'w' && color !== 'b') throw new Error(`Unknown chess side: ${color}`);
    const group = build(THREE, G, M, color);
    group.userData.avatarPiece = true;
    group.userData.pieceType = type;
    group.userData.color = color;
    return group;
  }
  function dispose() {
    G.dispose();
    const mats = [M.skin, M.hair, M.outfit, M.trim, M.side.w.base, M.side.w.glow, M.side.w.ring, M.side.b.base, M.side.b.glow, M.side.b.ring];
    mats.forEach((mat) => mat.dispose());
  }
  return Object.freeze({appearance: resolved, buildPiece, dispose});
}

/** Cinematic arena hall: dark ground, glow halos, eight pillared columns with
 *  violet/teal bands, a glowing board frame, 64 tiles, and a pooled set of
 *  legal-move target markers. */
export function buildArenaHall(THREE) {
  if (!THREE) throw new Error('buildArenaHall needs the THREE namespace');
  const group = new THREE.Group();
  const disposables = new Set();
  const track = (object) => {
    object.traverse((child) => {
      if (child.geometry) disposables.add(child.geometry);
      if (child.material) disposables.add(child.material);
    });
    return object;
  };
  const stone = new THREE.MeshStandardMaterial({color: 0x0b0e16, roughness: 0.9, metalness: 0.1});
  const pillarGlowViolet = new THREE.MeshStandardMaterial({color: 0x9a5cff, emissive: 0x4a12b8, emissiveIntensity: 2});
  const pillarGlowTeal = new THREE.MeshStandardMaterial({color: 0x2fe8d4, emissive: 0x0e6e63, emissiveIntensity: 2});
  const frameGlow = new THREE.MeshStandardMaterial({color: 0x2fe8d4, emissive: 0x0f7a6e, emissiveIntensity: 2.2});
  const markerMat = new THREE.MeshStandardMaterial({color: 0x57d6a2, emissive: 0x1d7a4e, emissiveIntensity: 2.6, transparent: true, opacity: 0.95});
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(34, 48),
    new THREE.MeshStandardMaterial({color: 0x05070c, roughness: 1, metalness: 0}),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.07;
  ground.userData.part = 'ground';
  group.add(track(ground));
  const halo = (inner, outer, color, opacity) => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 64),
      new THREE.MeshBasicMaterial({color, transparent: true, opacity, side: THREE.DoubleSide}),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.04;
    mesh.userData.part = 'halo';
    group.add(track(mesh));
  };
  halo(6.5, 7.2, 0x7a3cff, 0.22);
  halo(7.4, 7.55, 0x2fe8d4, 0.3);
  const pillarGeo = new THREE.CylinderGeometry(0.55, 0.72, 7.5, 10);
  const bandGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.34, 10);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 13;
    const z = Math.sin(a) * 13;
    const pillar = new THREE.Mesh(pillarGeo, stone);
    pillar.position.set(x, 3.68, z);
    pillar.userData.part = 'pillar';
    const band = new THREE.Mesh(bandGeo, i % 2 ? pillarGlowTeal : pillarGlowViolet);
    band.position.set(x, 5.4, z);
    band.userData.part = 'pillar-band';
    group.add(track(pillar), track(band));
  }
  const frameLen = 8.7;
  const frameThick = 0.3;
  const frameGeoH = new THREE.BoxGeometry(frameLen, 0.2, frameThick);
  const frameGeoV = new THREE.BoxGeometry(frameThick, 0.2, frameLen);
  for (const [geo, x, z] of [[frameGeoH, 0, 4.32], [frameGeoH, 0, -4.32], [frameGeoV, 4.32, 0], [frameGeoV, -4.32, 0]]) {
    const bar = new THREE.Mesh(geo, frameGlow);
    bar.position.set(x, 0.02, z);
    bar.userData.part = 'frame';
    group.add(track(bar));
  }
  const tiles = [];
  const tileGeo = new THREE.BoxGeometry(0.98, 0.12, 0.98);
  const lightMat = new THREE.MeshStandardMaterial({color: 0x8a6a45, roughness: 0.55, metalness: 0.15});
  const darkMat = new THREE.MeshStandardMaterial({color: 0x141d29, roughness: 0.7, metalness: 0.2});
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const tile = new THREE.Mesh(tileGeo, (file + rank) % 2 ? darkMat : lightMat);
      tile.position.set(file - 3.5, 0, 3.5 - rank);
      tile.userData.square = FILES[file] + (rank + 1);
      tile.userData.part = 'tile';
      tiles.push(tile);
      group.add(track(tile));
    }
  }
  const markerGeo = new THREE.CircleGeometry(0.3, 24);
  const markerList = [];
  for (let i = 0; i < 32; i++) {
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.rotation.x = -Math.PI / 2;
    marker.visible = false;
    marker.userData.part = 'target-marker';
    markerList.push(marker);
    group.add(track(marker));
  }
  function showTargets(squares) {
    const list = Array.isArray(squares) ? squares : [];
    markerList.forEach((marker, i) => {
      const square = list[i];
      marker.visible = Boolean(square);
      if (square) {
        const [x, y, z] = squarePosition(square);
        marker.position.set(x, y + 0.03, z);
      }
    });
  }
  function hideTargets() {
    markerList.forEach((marker) => {
      marker.visible = false;
    });
  }
  function dispose() {
    disposables.forEach((resource) => resource.dispose?.());
    disposables.clear();
  }
  return {
    group,
    tiles,
    markers: Object.freeze({show: showTargets, hide: hideTargets, list: markerList}),
    dispose,
  };
}
