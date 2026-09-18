/** Chess Arena avatar piece foundry — Reality Lens cinematic staging builders.
 *
 * Pure builders: every factory takes the THREE namespace explicitly and this
 * module never imports 'three' itself, so the foundry is testable in node
 * against the vendored build. The browser mount (./chess-arena.js) passes the
 * import-mapped namespace.
 *
 * Every piece is the same character — Tumbo's AI-built avatar bust portrait —
 * reimagined per chess role through stature (height), a role glyph badge, and
 * the side's material language (light/gold for white, dark/obsidian with
 * violet glow for black). The portrait's face region is cropped per role via
 * texture offset/repeat so the likeness reads at board scale; role identity
 * comes from the badge, not a different face.
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

/** AI-built avatar bust portrait (2026-09-18): Tumbo's approved likeness from
 *  his PERSON Ω concept art. Every chess piece wears this same face; role is
 *  carried by stature, glyph badge, and ring. Local projection asset only. */
export const AVATAR_BUST_PORTRAIT_URL = 'assets/avatar/avatar-bust.webp';
/** Hologram heights in arena units: the king stands tallest, the pawn shortest. */
export const CHESS_PIECE_HEIGHTS = Object.freeze({p: 1.3, n: 1.5, b: 1.55, r: 1.6, q: 1.75, k: 1.9});
/** Glow-ring radii in arena units: stature reads per role at a glance. */
export const CHESS_PIECE_RING_RADII = Object.freeze({p: 0.30, n: 0.33, b: 0.34, r: 0.35, q: 0.38, k: 0.42});
/** Role glyphs for the badge each piece carries at its base. */
export const CHESS_ROLE_GLYPHS = Object.freeze({p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚'});
/** Face-region crops of the square bust portrait in UV space (center + size).
 *  The portrait's face sits near (0.5, 0.69); higher roles frame a slightly
 *  wider bust for presence. Applied via texture offset/repeat in the browser. */
export const CHESS_BUST_CROPS = Object.freeze({
  p: Object.freeze({cx: 0.5, cy: 0.69, size: 0.30}),
  n: Object.freeze({cx: 0.5, cy: 0.69, size: 0.32}),
  b: Object.freeze({cx: 0.5, cy: 0.69, size: 0.34}),
  r: Object.freeze({cx: 0.5, cy: 0.69, size: 0.36}),
  q: Object.freeze({cx: 0.5, cy: 0.69, size: 0.40}),
  k: Object.freeze({cx: 0.5, cy: 0.69, size: 0.44}),
});
const CHESS_PIECE_TINTS = Object.freeze({w: 0xffe2ae, b: 0xc4a4ff});
const ROLE_BADGE_RING = Object.freeze({w: '#ffd98a', b: '#b48cff'});
const ROLE_BADGE_GLYPH = Object.freeze({w: '#ffe9c0', b: '#d9c2ff'});

/** Role badge: a small billboarded plaque at the piece's base carrying the
 *  role glyph in the side's color. In the browser the glyph is drawn on a
 *  canvas texture; in node (tests) the badge records its metadata and stays
 *  untextured so every structural assertion still holds. */
function buildRoleBadge(THREE, color, type, textureRegistry = null) {
  const material = new THREE.SpriteMaterial({transparent: true, depthWrite: false, opacity: 0.95});
  const badge = new THREE.Sprite(material);
  const size = 0.36;
  badge.scale.set(size, size, 1);
  badge.position.set(0, 0.32, 0);
  badge.userData.part = 'role-badge';
  badge.userData.roleGlyph = CHESS_ROLE_GLYPHS[type];
  badge.userData.roleBadgeSide = color;
  if (textureRegistry) textureRegistry.add({material, getTexture: () => material.map ?? null});
  const canDraw = typeof document !== 'undefined'
    && typeof document.createElement === 'function'
    && typeof THREE.CanvasTexture === 'function';
  if (canDraw) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6,8,14,0.85)'; ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = ROLE_BADGE_RING[color]; ctx.stroke();
      ctx.font = '68px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = ROLE_BADGE_GLYPH[color];
      ctx.fillText(CHESS_ROLE_GLYPHS[type], 64, 68);
      const texture = new THREE.CanvasTexture(canvas);
      material.map = texture;
      material.needsUpdate = true;
    } catch { /* badge keeps its glyph metadata; the plaque simply stays untextured */ }
  }
  return badge;
}

/** Avatar chess piece: the same AI-built likeness on every piece, billboarded
 *  so it reads from every camera angle, standing on the role-sized,
 *  side-colored glow ring with its role glyph badge at the base. The portrait
 *  texture loads lazily from local assets; without a DOM Image (node tests)
 *  the sprite is built untextured and every structural assertion still holds. */
function buildHologramPiece(THREE, G, M, color, type, hologramRegistry = null) {
  const side = M.side[color];
  const group = new THREE.Group();
  const ringRadius = CHESS_PIECE_RING_RADII[type] ?? 0.34;
  const ring = new THREE.Mesh(G.torus(ringRadius, 0.05), side.ring);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.05, 0);
  ring.userData.part = 'ring';
  ring.userData.ringRadius = ringRadius;
  group.add(ring);
  const height = CHESS_PIECE_HEIGHTS[type] ?? 1.4;
  const crop = CHESS_BUST_CROPS[type] ?? CHESS_BUST_CROPS.p;
  const material = new THREE.SpriteMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: CHESS_PIECE_TINTS[color] ?? 0xffffff,
    opacity: 0.97,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(height, height, 1);
  sprite.position.set(0, height / 2 + 0.04, 0);
  sprite.userData.part = 'hologram';
  sprite.userData.pieceType = type;
  sprite.userData.textureUrl = AVATAR_BUST_PORTRAIT_URL;
  sprite.userData.bustCrop = {...crop};
  sprite.visible = false;
  group.add(sprite);
  group.add(buildRoleBadge(THREE, color, type, hologramRegistry));
  if (hologramRegistry) hologramRegistry.add({material, getTexture: () => material.map ?? null});
  const canLoad = typeof THREE.TextureLoader === 'function'
    && typeof Image !== 'undefined'
    && typeof AVATAR_BUST_PORTRAIT_URL === 'string';
  if (canLoad) {
    new THREE.TextureLoader().load(
      AVATAR_BUST_PORTRAIT_URL,
      (texture) => {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.repeat.set(crop.size, crop.size);
        texture.offset.set(crop.cx - crop.size / 2, crop.cy - crop.size / 2);
        texture.needsUpdate = true;
        material.map = texture;
        material.needsUpdate = true;
        sprite.visible = true;
      },
      undefined,
      () => { sprite.visible = false; },
    );
  } else {
    // Deterministic in node: the hologram slot exists with its metadata even
    // though no pixels load outside the browser.
    sprite.visible = true;
  }
  return group;
}

function buildPawn(THREE, G, M, color, _type, hologramRegistry = null) {
  return buildHologramPiece(THREE, G, M, color, 'p', hologramRegistry);
}

function buildKnight(THREE, G, M, color, _type, hologramRegistry = null) {
  return buildHologramPiece(THREE, G, M, color, 'n', hologramRegistry);
}

function buildBishop(THREE, G, M, color, _type, hologramRegistry = null) {
  return buildHologramPiece(THREE, G, M, color, 'b', hologramRegistry);
}

function buildRook(THREE, G, M, color, _type, hologramRegistry = null) {
  return buildHologramPiece(THREE, G, M, color, 'r', hologramRegistry);
}

function buildQueen(THREE, G, M, color, _type, hologramRegistry = null) {
  return buildHologramPiece(THREE, G, M, color, 'q', hologramRegistry);
}

function buildKing(THREE, G, M, color, _type, hologramRegistry = null) {
  return buildHologramPiece(THREE, G, M, color, 'k', hologramRegistry);
}

/** Piece foundry with shared geometry/material caches. Dispose when the
 *  appearance is refreshed or the arena unmounts. */
export function createPieceBuilders(THREE, appearance = null) {
  if (!THREE) throw new Error('createPieceBuilders needs the THREE namespace');
  const resolved = Object.freeze({...DEFAULT_APPEARANCE, ...(appearance ?? {})});
  const G = createGeometryCache(THREE);
  const M = createMaterialSet(THREE, resolved);
  const builders = {p: buildPawn, n: buildKnight, b: buildBishop, r: buildRook, q: buildQueen, k: buildKing};
  // Every hologram piece owns a SpriteMaterial (and, in the browser, a loaded
  // texture). Track them so dispose() releases per-sprite GPU resources too.
  const hologramRegistry = new Set();
  function buildPiece(type, color) {
    const build = builders[type];
    if (!build) throw new Error(`Unknown chess piece type: ${type}`);
    if (color !== 'w' && color !== 'b') throw new Error(`Unknown chess side: ${color}`);
    const group = build(THREE, G, M, color, type, hologramRegistry);
    group.userData.avatarPiece = true;
    group.userData.pieceType = type;
    group.userData.color = color;
    return group;
  }
  function dispose() {
    G.dispose();
    const mats = [M.skin, M.hair, M.outfit, M.trim, M.side.w.base, M.side.w.glow, M.side.w.ring, M.side.b.base, M.side.b.glow, M.side.b.ring];
    mats.forEach((mat) => mat.dispose());
    hologramRegistry.forEach(({material, getTexture}) => {
      try { getTexture()?.dispose?.(); } catch { /* already released */ }
      try { material.dispose?.(); } catch { /* already released */ }
    });
    hologramRegistry.clear();
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
