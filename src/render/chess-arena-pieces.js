/** Standard chess-piece foundry for the Living Reality chess arena.
 *
 * Chess is a game first: the board uses conventional, immediately recognizable
 * chess glyphs rather than custom avatars. The glyphs are rendered locally as
 * text textures when a browser canvas is available, with deterministic
 * structural metadata retained for non-DOM tests.
 *
 * Projection only: no network, identity authority, wallet, settlement, or
 * external asset loading is involved.
 */
import {STUDIO_MODEL} from '../domains/person-studio.js';

export const CHESS_ARENA_PIECE_TYPES = Object.freeze(['p','n','b','r','q','k']);
const FILES = 'abcdefgh';

/** Board square -> [x, y, z] in arena units. No THREE dependency. */
export function squarePosition(square) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return [file - 3.5, 0.06, 3.5 - rank];
}

/** Kept as a compatibility export for older callers/tests. No avatar is used. */
export const AVATAR_CHIBI_FALLBACK_URL = null;

/** Conventional Unicode chess glyphs, one identity per piece type. */
export const CHESS_ROLE_GLYPHS = Object.freeze({
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
});
export const CHESS_ROLE_GLYPHS_WHITE = Object.freeze({
  p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔',
});
export const CHESS_ROLE_GLYPHS_BLACK = Object.freeze({
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
});

export const CHESS_PIECE_HEIGHTS = Object.freeze({p: 1.15, n: 1.35, b: 1.45, r: 1.45, q: 1.60, k: 1.72});
export const CHESS_PIECE_RING_RADII = Object.freeze({p: 0.27, n: 0.30, b: 0.31, r: 0.31, q: 0.34, k: 0.36});
export const CHESS_BUST_CROPS = Object.freeze({}); // compatibility only; avatars are not used.

const SIDE_STYLE = Object.freeze({
  w: Object.freeze({body: 0xf4ead8, edge: 0x9b8567, glyph: '#fffaf0', halo: 0xffd98a}),
  b: Object.freeze({body: 0x202733, edge: 0x080b10, glyph: '#f0e6ff', halo: 0xb48cff}),
});

function createGeometryCache(THREE) {
  const cache = new Map();
  const get = (key, make) => {
    let geometry = cache.get(key);
    if (!geometry) { geometry = make(); cache.set(key, geometry); }
    return geometry;
  };
  return {
    torus: (r, t) => get(`torus:${r}:${t}`, () => new THREE.TorusGeometry(r, t, 10, 24)),
    dispose() { cache.forEach((geometry) => geometry.dispose()); cache.clear(); },
  };
}

function createMaterialSet(THREE) {
  const std = (params) => new THREE.MeshStandardMaterial(params);
  return {
    side: {
      w: {
        base: std({color: SIDE_STYLE.w.body, metalness: 0.2, roughness: 0.42}),
        glow: std({color: SIDE_STYLE.w.body, emissive: 0x7a4b10, emissiveIntensity: 0.55, metalness: 0.15, roughness: 0.42}),
        ring: std({color: SIDE_STYLE.w.halo, emissive: 0x8b4b08, emissiveIntensity: 1.35, metalness: 0.35, roughness: 0.34}),
      },
      b: {
        base: std({color: SIDE_STYLE.b.body, metalness: 0.42, roughness: 0.34}),
        glow: std({color: SIDE_STYLE.b.body, emissive: 0x160b30, emissiveIntensity: 0.75, metalness: 0.45, roughness: 0.32}),
        ring: std({color: SIDE_STYLE.b.halo, emissive: 0x4b1aa0, emissiveIntensity: 1.55, metalness: 0.35, roughness: 0.32}),
      },
    },
  };
}

function buildStandardGlyph(THREE, color, type, glyphRegistry = null) {
  const glyph = color === 'w' ? CHESS_ROLE_GLYPHS_WHITE[type] : CHESS_ROLE_GLYPHS_BLACK[type];
  const material = new THREE.SpriteMaterial({
    transparent: true,
    depthWrite: false,
    color: color === 'w' ? 0xffffff : 0xffffff,
    opacity: 1,
  });
  const sprite = new THREE.Sprite(material);
  const height = CHESS_PIECE_HEIGHTS[type] ?? 1.3;
  sprite.scale.set(height * 0.82, height, 1);
  sprite.position.set(0, height * 0.52, 0);
  sprite.userData.part = 'chess-piece';
  sprite.userData.pieceType = type;
  sprite.userData.chessGlyph = glyph;
  sprite.userData.isStandardChessPiece = true;
  sprite.userData.avatarPiece = false;
  if (glyphRegistry) glyphRegistry.add({material, getTexture: () => material.map ?? null});

  const canDraw = typeof document !== 'undefined'
    && typeof document.createElement === 'function'
    && typeof THREE.CanvasTexture === 'function';
  if (canDraw) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 256, 256);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '220px "DejaVu Sans", "Noto Sans Symbols 2", "Segoe UI Symbol", serif';
      // A restrained shadow keeps the standard silhouette legible on the dark board.
      ctx.lineWidth = 8;
      ctx.strokeStyle = color === 'w' ? 'rgba(20,14,8,.95)' : 'rgba(0,0,0,.95)';
      ctx.strokeText(glyph, 128, 132);
      ctx.fillStyle = SIDE_STYLE[color].glyph;
      ctx.fillText(glyph, 128, 132);
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      material.map = texture;
      material.needsUpdate = true;
    } catch { /* structural glyph metadata remains available */ }
  }
  return sprite;
}

function buildPiece(THREE, G, M, color, type, glyphRegistry = null) {
  const group = new THREE.Group();
  const style = M.side[color];
  const ringRadius = CHESS_PIECE_RING_RADII[type] ?? 0.30;
  const ring = new THREE.Mesh(G.torus(ringRadius, 0.045), style.ring);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  ring.userData.part = 'ring';
  ring.userData.ringRadius = ringRadius;
  group.add(ring);

  // A small physical base makes the glyph read like a normal chess piece
  // rather than a floating emoji.
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(ringRadius * 0.88, ringRadius * 1.08, 0.16, 24),
    style.base,
  );
  base.position.y = 0.10;
  base.userData.part = 'base';
  group.add(base);

  group.add(buildStandardGlyph(THREE, color, type, glyphRegistry));
  group.userData.standardChessPiece = true;
  group.userData.avatarPiece = false;
  group.userData.pieceType = type;
  group.userData.color = color;
  return group;
}

/** Piece foundry with shared ring geometry/material caches. */
export function createPieceBuilders(THREE, _appearance = null) {
  if (!THREE) throw new Error('createPieceBuilders needs the THREE namespace');
  const G = createGeometryCache(THREE);
  const M = createMaterialSet(THREE);
  const glyphRegistry = new Set();
  function buildPiecePublic(type, color) {
    if (!CHESS_ARENA_PIECE_TYPES.includes(type)) throw new Error(`Unknown chess piece type: ${type}`);
    if (color !== 'w' && color !== 'b') throw new Error(`Unknown chess side: ${color}`);
    return buildPiece(THREE, G, M, color, type, glyphRegistry);
  }
  function dispose() {
    G.dispose();
    for (const side of ['w','b']) {
      M.side[side].base.dispose();
      M.side[side].glow.dispose();
      M.side[side].ring.dispose();
    }
    glyphRegistry.forEach(({material, getTexture}) => {
      try { getTexture()?.dispose?.(); } catch {}
      try { material.dispose?.(); } catch {}
    });
    glyphRegistry.clear();
  }
  return Object.freeze({appearance: Object.freeze({...(_appearance ?? {}), skin: STUDIO_MODEL.skin}), buildPiece: buildPiecePublic, dispose});
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
