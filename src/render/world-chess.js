/** Avatar World Chess — a full 3D chessboard floating among the blocks of
 * the living-reality world (Packet 234).
 *
 * The lens contract: mountWorldChess({THREE, scene, camera, controls,
 * documentRoot, onExit}) returns {open, close, getSnapshot, destroy,
 * setHomePosition}. Nothing auto-mounts on import. `world-chess:open` opens
 * it, and window.__TUMBO_WORLD_CHESS__ exposes {open, close, getSnapshot}.
 *
 * - Board: translucent blue glass slab, glowing square inlays, connection
 *   lines underneath, bounded starfield backdrop — the reality-lens language.
 * - Pieces: 32 articulated Tumbo chibis (tumbo-chibi-rig.js) with role
 *   stature, side glow rings, and role-glyph badges. Shared geometry and
 *   material caches keep draw state flat.
 * - Rules: full chess.js legality (castling, en passant, promotion), local
 *   human-vs-human or human-vs-AI via the local minimax (./chess-ai.js).
 * - Motion: pieces walk-glide with the avatar motion language; captures
 *   spin+shrink, victors bow. Reduced motion collapses everything to
 *   instant moves.
 *
 * Projection only: simulated play, no money, no wagering, no network.
 */
import {
  updateTumboChibiRig,
  buildTumboChibiRig,
  createTumboGeometryCache,
  createTumboMaterialSet,
  CHIBI_RIG_MODES,
  CHIBI_RIG_BASE_HEIGHT,
} from './tumbo-chibi-rig.js?v=20260919-chibi-champions';
import {avatarGlide, AVATAR_MOTION} from '../domains/avatar-motion.js?v=20260919-chibi-champions';
import {
  createWorldChessGame,
  worldChessSquareXZ,
  WORLD_CHESS_SQUARE_SIZE,
  WORLD_CHESS_PIECE_HEIGHTS,
  WORLD_CHESS_RING_RADII,
  WORLD_CHESS_ROLE_GLYPHS,
  WORLD_CHESS_PROMOTION_CHOICES,
  WORLD_CHESS_MODES,
} from '../domains/world-chess.js';
import {CHESS_AI_DIFFICULTIES, resolveAiDifficulty} from '../domains/chess-ai.js?v=20260919-chibi-champions';

const CHIBI_BASE_HEIGHT = CHIBI_RIG_BASE_HEIGHT;
const SQUARE = WORLD_CHESS_SQUARE_SIZE;
const PIECE_Y = 0.36;
const TILE_TOP = 0.335;
const FILES = 'abcdefgh';
const CSS_ID = 'world-chess-css';
const OPEN_EVENT = 'world-chess:open';
const AI_BUDGET_CAP_MS = 900; // hard stays deep but never stalls the frame loop

const BADGE_RING = Object.freeze({w: '#ffd98a', b: '#b48cff'});
const BADGE_GLYPH = Object.freeze({w: '#ffe9c0', b: '#d9c2ff'});

function squareLocal(square) {
  const {x, z} = worldChessSquareXZ(square, SQUARE);
  return [x, PIECE_Y, z];
}

/* ---------------- geometry + material caches (shared chibi rig module) ----------------
 * Geometry and base materials come from the shared chibi rig module
 * (./tumbo-chibi-rig.js) so the world chess foundry, the table arena, and
 * the Person Studio build from one source. World chess only adds its
 * side-colored ring/glow set, selection halos, markers, and glass tiles. */

function createGeometryCache(THREE) {
  return createTumboGeometryCache(THREE);
}

function createWorldMaterialSet(THREE) {
  // Base chibi look (skin, hair, outfit, trim, paws, muffs, face) from the
  // shared rig module — wardrobe-tinted live there, identical for every rig.
  const base = createTumboMaterialSet(THREE);
  const std = (params) => new THREE.MeshStandardMaterial(params);
  const extras = {
    side: {
      w: {
        ring: std({color: 0xffd98a, emissive: 0xd77a1a, emissiveIntensity: 2.2, metalness: 0.4, roughness: 0.35}),
        glow: std({color: 0xffc25e, emissive: 0x9a5200, emissiveIntensity: 1.4, metalness: 0.55, roughness: 0.3}),
      },
      b: {
        ring: std({color: 0xb48cff, emissive: 0x5b1ee0, emissiveIntensity: 2.4, metalness: 0.4, roughness: 0.35}),
        glow: std({color: 0x9a5cff, emissive: 0x43119c, emissiveIntensity: 1.6, metalness: 0.45, roughness: 0.3}),
      },
    },
    select: new THREE.MeshBasicMaterial({color: 0xbfe6ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide}),
    markerMove: new THREE.MeshBasicMaterial({color: 0x57d6a2, transparent: true, opacity: 0.85, side: THREE.DoubleSide}),
    markerCapture: new THREE.MeshBasicMaterial({color: 0xff7a5c, transparent: true, opacity: 0.9, side: THREE.DoubleSide}),
    lastMove: new THREE.MeshBasicMaterial({color: 0xffe08a, transparent: true, opacity: 0.28, side: THREE.DoubleSide}),
    tileLight: std({color: 0x4a86cc, emissive: 0x1d4e8f, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.92}),
    tileDark: std({color: 0x16345e, emissive: 0x0a1c3d, emissiveIntensity: 0.7, roughness: 0.45, metalness: 0.1, transparent: true, opacity: 0.92}),
  };
  const extraMaterials = [extras.select, extras.markerMove, extras.markerCapture, extras.lastMove,
    extras.tileLight, extras.tileDark];
  Object.values(extras.side).forEach((s) => extraMaterials.push(s.ring, s.glow));
  const mats = {...base, ...extras};
  mats.dispose = () => {
    extraMaterials.forEach((m) => m && typeof m.dispose === 'function' && m.dispose());
    base.dispose();
  };
  return mats;
}

/** Role badge: billboarded plaque with the role glyph in the side's color.
 * Canvas texture only in the browser; node keeps glyph metadata untextured. */
function buildRoleBadge(THREE, color, type) {
  const material = new THREE.SpriteMaterial({transparent: true, depthWrite: false, opacity: 0.95});
  const badge = new THREE.Sprite(material);
  badge.scale.set(0.34, 0.34, 1);
  badge.userData.part = 'role-badge';
  badge.userData.roleGlyph = WORLD_CHESS_ROLE_GLYPHS[type];
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
      ctx.lineWidth = 6; ctx.strokeStyle = BADGE_RING[color]; ctx.stroke();
      ctx.font = '68px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = BADGE_GLYPH[color];
      ctx.fillText(WORLD_CHESS_ROLE_GLYPHS[type], 64, 68);
      const texture = new THREE.CanvasTexture(canvas);
      material.map = texture;
      material.needsUpdate = true;
      badge.userData.badgeTexture = texture;
    } catch { /* plaque keeps its glyph metadata */ }
  }
  return badge;
}

/* ---------------- CSS (unique world-chess- prefix) ---------------- */

const WORLD_CHESS_CSS = `
.world-chess-hud{position:fixed;top:12px;left:12px;z-index:10000;max-width:330px;
  background:rgba(16,34,58,.62);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid rgba(120,180,255,.38);border-radius:14px;color:#eaf4ff;
  font-family:system-ui,-apple-system,sans-serif;padding:12px 14px;display:none;
  box-shadow:0 8px 32px rgba(20,60,120,.35)}
.world-chess-hud.open{display:block}
.world-chess-title{font-size:15px;font-weight:700;letter-spacing:.06em;margin-bottom:6px;
  display:flex;justify-content:space-between;align-items:center;gap:8px}
.world-chess-status{font-size:12.5px;color:#bfe0ff;min-height:20px;margin-bottom:8px}
.world-chess-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.world-chess-controls label{display:flex;align-items:center;gap:6px;font-size:11px;color:#a9c6da;letter-spacing:.04em}
.world-chess-controls select{min-height:36px;border-radius:8px;border:1px solid rgba(120,180,255,.4);
  background:rgba(10,24,44,.8);color:#eef7ff;font-size:12px;padding:4px 6px;max-width:130px}
.world-chess-buttons{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.world-chess-buttons button,.world-chess-back{border-radius:8px;border:1px solid rgba(120,180,255,.4);
  background:rgba(30,70,120,.55);color:#eef7ff;font-size:12px;padding:8px 12px;cursor:pointer;min-height:36px}
.world-chess-buttons button:hover,.world-chess-back:hover{filter:brightness(1.25)}
.world-chess-buttons button:disabled{opacity:.45;cursor:default}
.world-chess-back{font-size:12px;padding:6px 10px;min-height:30px}
.world-chess-moves{max-height:120px;overflow-y:auto;font-size:12px;color:#cfe6ff;
  border-top:1px solid rgba(120,180,255,.25);padding-top:6px;margin:0;list-style:none}
.world-chess-moves li{padding:1px 0;font-variant-numeric:tabular-nums}
.world-chess-promo{position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;
  background:rgba(4,10,20,.55)}
.world-chess-promo.open{display:flex}
.world-chess-promo-card{background:rgba(16,34,58,.9);border:1px solid rgba(120,180,255,.45);
  border-radius:14px;padding:16px;text-align:center;color:#eaf4ff;backdrop-filter:blur(10px)}
.world-chess-promo-card p{margin:0 0 10px;font-size:13px}
.world-chess-promo-card button{font-size:26px;border-radius:10px;border:1px solid rgba(120,180,255,.4);
  background:rgba(30,70,120,.55);color:#fff;padding:8px 14px;margin:0 4px;cursor:pointer}
.world-chess-promo-card button:hover{filter:brightness(1.3)}
@media (max-width:640px){.world-chess-hud{max-width:250px;top:8px;left:8px;padding:10px}}
`;

function ensureCss(documentRoot) {
  if (documentRoot.getElementById(CSS_ID)) return;
  const style = documentRoot.createElement('style');
  style.id = CSS_ID;
  style.textContent = WORLD_CHESS_CSS;
  (documentRoot.head || documentRoot.documentElement).appendChild(style);
}

/* ---------------- mount ---------------- */

/** Mount the World Chess lens. See the module docblock for the contract. */
export function mountWorldChess({THREE, scene, camera, controls, documentRoot = document, onExit = null} = {}) {
  if (!THREE) throw new Error('mountWorldChess needs the THREE namespace');
  if (!scene || !camera) throw new Error('mountWorldChess needs scene and camera');
  const doc = documentRoot;
  const reducedMotion = Boolean(doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  ensureCss(doc);

  const game = createWorldChessGame();
  const G = createGeometryCache(THREE);
  const M = createWorldMaterialSet(THREE);

  /* ----- board ----- */
  const boardGroup = new THREE.Group();
  boardGroup.name = 'world-chess-board';
  const boardDisposables = [];
  const track = (object) => { boardDisposables.push(object); return object; };

  const slab = new THREE.Mesh(
    G.box(17.4, 0.55, 17.4),
    new THREE.MeshPhysicalMaterial({color: 0x3d7bc4, transparent: true, opacity: 0.22, roughness: 0.12, metalness: 0.1}),
  );
  slab.position.y = 0;
  slab.userData.part = 'glass-slab';
  boardGroup.add(track(slab));
  boardDisposables.push(slab.material);

  const tileMeshes = [];
  const tileGeo = G.box(SQUARE - 0.06, 0.06, SQUARE - 0.06);
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const square = FILES[file] + (rank + 1);
      const tile = new THREE.Mesh(tileGeo, (file + rank) % 2 ? M.tileDark : M.tileLight);
      const {x, z} = worldChessSquareXZ(square, SQUARE);
      tile.position.set(x, TILE_TOP - 0.03, z);
      tile.userData.square = square;
      tile.userData.part = 'tile';
      tileMeshes.push(tile);
      boardGroup.add(track(tile));
    }
  }

  const frameMat = new THREE.MeshStandardMaterial({color: 0x2fe8d4, emissive: 0x0f7a6e, emissiveIntensity: 2.2});
  boardDisposables.push(frameMat);
  const frameLen = 17.7;
  const frameH = G.box(frameLen, 0.22, 0.34);
  const frameV = G.box(0.34, 0.22, frameLen);
  for (const [geo, x, z] of [[frameH, 0, 8.85], [frameH, 0, -8.85], [frameV, 8.85, 0], [frameV, -8.85, 0]]) {
    const bar = new THREE.Mesh(geo, frameMat);
    bar.position.set(x, 0.1, z);
    bar.userData.part = 'frame';
    boardGroup.add(track(bar));
  }

  // Connection-line accents under the board (reality-lens language).
  {
    const points = [];
    for (let i = -5; i <= 5; i++) {
      points.push(i * 2, -0.75, -10, i * 2, -0.75, 10);
      points.push(-10, -0.75, i * 2, 10, -0.75, i * 2);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const lineMat = new THREE.LineBasicMaterial({color: 0x3fa9f5, transparent: true, opacity: 0.32});
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.userData.part = 'connection-lines';
    boardGroup.add(track(lines));
    boardDisposables.push(lineGeo, lineMat);
  }

  // Bounded starfield backdrop.
  {
    const starCount = 420;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    let seed = 234;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < starCount; i++) {
      const r = 26 + rand() * 16;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.7 - 4;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const blue = rand();
      colors[i * 3] = 0.65 + blue * 0.2;
      colors[i * 3 + 1] = 0.78 + blue * 0.15;
      colors[i * 3 + 2] = 1.0;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const starMat = new THREE.PointsMaterial({size: 0.16, vertexColors: true, transparent: true, opacity: 0.9, sizeAttenuation: true});
    const stars = new THREE.Points(starGeo, starMat);
    stars.userData.part = 'starfield';
    boardGroup.add(track(stars));
    boardDisposables.push(starGeo, starMat);
  }

  // Legal-move markers (pooled) + last-move highlight.
  const markerGeo = G.circle(0.42, 24);
  const markers = [];
  for (let i = 0; i < 32; i++) {
    const marker = new THREE.Mesh(markerGeo, M.markerMove);
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = TILE_TOP + 0.02;
    marker.visible = false;
    marker.userData.part = 'target-marker';
    markers.push(marker);
    boardGroup.add(track(marker));
  }
  const lastMoveMeshes = [0, 1].map(() => {
    const mesh = new THREE.Mesh(G.plane(SQUARE - 0.06, SQUARE - 0.06), M.lastMove);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = TILE_TOP + 0.015;
    mesh.visible = false;
    mesh.userData.part = 'last-move';
    boardGroup.add(track(mesh));
    return mesh;
  });

  // Default home among the blocks; the parent can reposition via setHomePosition.
  boardGroup.position.set(26, 6, -14);
  boardGroup.visible = false;
  scene.add(boardGroup);

  /* ----- piece foundry ----- */
  const badgeTextures = [];
  function buildWorldPiece(color, type, seed = 0) {
    if (color !== 'w' && color !== 'b') throw new Error(`world-chess: unknown side ${color}`);
    const group = new THREE.Group();
    const ringRadius = WORLD_CHESS_RING_RADII[type] ?? 0.34;
    const ring = new THREE.Mesh(G.torus(ringRadius, 0.05), M.side[color].ring);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    ring.userData.part = 'ring';
    group.add(ring);
    // Selection halo: a per-piece ring that only shows while selected.
    const halo = new THREE.Mesh(G.ring(ringRadius + 0.12, ringRadius + 0.26), M.select);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.04;
    halo.visible = false;
    halo.userData.part = 'selection-halo';
    group.add(halo);
    const height = WORLD_CHESS_PIECE_HEIGHTS[type] ?? 1.4;
    // Reuse the shared chibi rig builder: every piece is the same articulated
    // Tumbo character, differentiated by stature, ring, and badge.
    const rig = buildTumboChibiRig(THREE, G, M, {seed});
    const chibiScale = height / CHIBI_BASE_HEIGHT;
    rig.group.scale.setScalar(chibiScale);
    rig.group.position.y = 0.02;
    group.add(rig.group);
    const badge = buildRoleBadge(THREE, color, type);
    if (badge.userData.badgeTexture) badgeTextures.push(badge.userData.badgeTexture);
    badge.position.set(0, 0.32, 0.5);
    group.add(badge);
    group.userData.avatarPiece = true;
    group.userData.pieceType = type;
    group.userData.color = color;
    group.userData.rig = rig;
    group.userData.chibiScale = chibiScale;
    group.userData.halo = halo;
    group.userData.seed = seed;
    group.userData.anim = null;
    group.userData.mode = 'idle';
    group.userData.modeT = 0;
    group.userData.heading = color === 'w' ? 0 : Math.PI;
    group.rotation.y = group.userData.heading;
    return group;
  }

  // Pieces state.
  let pieces = []; // piece groups currently on the board
  const piecesBySquare = new Map();
  let selected = null; // {square, moves}
  let busy = false;
  let pendingAnims = 0;
  let flipped = false;
  let aiTimer = 0;
  let aiThinking = false;
  let promotionRequest = null; // {from, to, options}
  let openState = false;
  let savedCamera = null;

  function disposePieceVisual(pieceGroup) {
    pieceGroup.traverse((node) => {
      if (node.userData && node.userData.part === 'role-badge') {
        if (node.userData.badgeTexture) {
          try { node.userData.badgeTexture.dispose(); } catch { /* noop */ }
          const bi = badgeTextures.indexOf(node.userData.badgeTexture);
          if (bi >= 0) badgeTextures.splice(bi, 1);
        }
        try { node.material.dispose(); } catch { /* noop */ }
      }
    });
  }

  /** Cancel every in-flight animation and reset the busy lock. Used when the
   * game is rebuilt out from under a running tween (mode change). */
  function cancelAllAnims() {
    for (const piece of pieces) piece.userData.anim = null;
    pendingAnims = 0;
    busy = false;
  }

  function rebuildPieces() {
    cancelAllAnims();
    for (const piece of pieces) {
      disposePieceVisual(piece);
      boardGroup.remove(piece);
    }
    pieces = [];
    piecesBySquare.clear();
    selected = null;
    const order = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    let seed = 1;
    const place = (color, type, square) => {
      const group = buildWorldPiece(color, type, seed++);
      const [x, y, z] = squareLocal(square);
      group.position.set(x, y, z);
      group.userData.square = square;
      group.rotation.y = facingFor(color);
      group.userData.heading = group.rotation.y;
      boardGroup.add(group);
      pieces.push(group);
      piecesBySquare.set(square, group);
    };
    for (let file = 0; file < 8; file++) {
      const f = FILES[file];
      place('w', order[file], f + '1');
      place('w', 'p', f + '2');
      place('b', 'p', f + '7');
      place('b', order[file], f + '8');
    }
  }

  function facingFor(color) {
    const base = color === 'w' ? 0 : Math.PI;
    return flipped ? base + Math.PI : base;
  }

  /* ----- HUD ----- */
  const hud = doc.createElement('div');
  hud.className = 'world-chess-hud';
  hud.innerHTML = `
    <div class="world-chess-title"><span>♞ World Chess</span><button class="world-chess-back" type="button">‹ Back</button></div>
    <div class="world-chess-status"></div>
    <div class="world-chess-controls">
      <label>Mode <select class="world-chess-mode">
        ${Object.values(WORLD_CHESS_MODES).map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}
      </select></label>
      <label>AI <select class="world-chess-difficulty">
        ${Object.values(CHESS_AI_DIFFICULTIES).map((d) => `<option value="${d.id}">${d.label}</option>`).join('')}
      </select></label>
    </div>
    <div class="world-chess-buttons">
      <button class="world-chess-new" type="button">New game</button>
      <button class="world-chess-resign" type="button">Resign</button>
      <button class="world-chess-flip" type="button">Flip board</button>
    </div>
    <ol class="world-chess-moves"></ol>`;
  (doc.body || doc.documentElement).appendChild(hud);
  const statusEl = hud.querySelector('.world-chess-status');
  const movesEl = hud.querySelector('.world-chess-moves');
  const modeSelect = hud.querySelector('.world-chess-mode');
  const diffSelect = hud.querySelector('.world-chess-difficulty');
  const newBtn = hud.querySelector('.world-chess-new');
  const resignBtn = hud.querySelector('.world-chess-resign');
  const flipBtn = hud.querySelector('.world-chess-flip');
  const backBtn = hud.querySelector('.world-chess-back');

  const promoOverlay = doc.createElement('div');
  promoOverlay.className = 'world-chess-promo';
  promoOverlay.innerHTML = `<div class="world-chess-promo-card">
    <p>Promote to</p>
    <div class="world-chess-promo-choices"></div></div>`;
  (doc.body || doc.documentElement).appendChild(promoOverlay);
  const promoChoices = promoOverlay.querySelector('.world-chess-promo-choices');

  const GLYPH_NAME = Object.freeze({q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight'});

  function renderStatus() {
    const snap = game.snapshot();
    let text = snap.statusText;
    if (snap.result) text += ` · ${snap.result}`;
    if (aiThinking) text += ' · AI thinking…';
    statusEl.textContent = text;
    resignBtn.disabled = snap.gameOver || busy;
    diffSelect.disabled = game.snapshot().mode === 'local';
  }

  function renderMoves() {
    const history = game.snapshot().history;
    movesEl.innerHTML = '';
    for (let i = 0; i < history.length; i += 2) {
      const li = doc.createElement('li');
      li.textContent = `${i / 2 + 1}. ${history[i]}${history[i + 1] ? ' ' + history[i + 1] : ''}`;
      movesEl.appendChild(li);
    }
    movesEl.scrollTop = movesEl.scrollHeight;
  }

  /* ----- selection + markers ----- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function findSquareTarget(object) {
    let node = object;
    while (node) {
      if (node.userData && node.userData.square) return node;
      node = node.parent;
    }
    return null;
  }

  function clearSelection() {
    if (selected) {
      const piece = piecesBySquare.get(selected.square);
      if (piece) piece.userData.halo.visible = false;
    }
    selected = null;
    markers.forEach((m) => { m.visible = false; });
  }

  function selectPiece(square) {
    clearSelection();
    const moves = game.legalMoves(square);
    if (moves.length === 0) return;
    const piece = piecesBySquare.get(square);
    if (piece) piece.userData.halo.visible = true;
    selected = {square, moves: Object.freeze(moves)};
    moves.forEach((move, i) => {
      const marker = markers[i];
      if (!marker) return;
      const {x, z} = worldChessSquareXZ(move.to, SQUARE);
      marker.position.set(x, TILE_TOP + 0.02, z);
      marker.material = move.captured ? M.markerCapture : M.markerMove;
      marker.visible = true;
    });
  }

  function humanCanPlay(color) {
    const side = game.humanSide();
    return side === 'both' || side === color;
  }

  /* ----- animation ----- */
  function noteAnimDone() {
    pendingAnims = Math.max(0, pendingAnims - 1);
    if (pendingAnims === 0) {
      busy = false;
      renderStatus();
      renderMoves();
      if (!game.snapshot().gameOver) maybeAiMove();
    }
  }

  function startGlide(pieceGroup, to, {arc = AVATAR_MOTION.moveArc, duration} = {}, onDone) {
    const from = pieceGroup.position.clone();
    if (reducedMotion) {
      pieceGroup.position.copy(to);
      onDone?.();
      return;
    }
    pendingAnims++;
    pieceGroup.userData.anim = {
      phase: 'glide',
      t: 0,
      dur: duration ?? (0.38 + 0.09 * worldChessSquareDistanceSafe(from, to)),
      from,
      to: to.clone(),
      arc,
      travelHeading: Math.atan2(to.x - from.x, to.z - from.z),
      startHeading: pieceGroup.rotation.y,
      onDone,
    };
    pieceGroup.userData.mode = 'walk';
    pieceGroup.userData.modeT = 0;
    busy = true;
  }

  function worldChessSquareDistanceSafe(from, to) {
    return Math.max(1, Math.round(Math.hypot(to.x - from.x, to.z - from.z) / SQUARE));
  }

  function startVanish(pieceGroup, onDone) {
    if (reducedMotion) {
      boardGroup.remove(pieceGroup);
      const i = pieces.indexOf(pieceGroup);
      if (i >= 0) pieces.splice(i, 1);
      onDone?.();
      return;
    }
    pendingAnims++;
    pieceGroup.userData.anim = {phase: 'vanish', t: 0, dur: CHIBI_RIG_MODES.spin, onDone};
    pieceGroup.userData.mode = 'spin';
    pieceGroup.userData.modeT = 0;
    busy = true;
  }

  function startCelebrate(pieceGroup, mode, onDone) {
    if (reducedMotion) { onDone?.(); return; }
    pendingAnims++;
    pieceGroup.userData.anim = {phase: 'celebrate', t: 0, dur: CHIBI_RIG_MODES[mode] ?? 1, mode, onDone};
    pieceGroup.userData.mode = mode;
    pieceGroup.userData.modeT = 0;
    busy = true;
  }

  function updatePieceAnim(pieceGroup, dt, now) {
    const data = pieceGroup.userData;
    const anim = data.anim;
    if (!anim) return;
    anim.t += dt;
    const k = Math.min(1, anim.t / anim.dur);
    if (anim.phase === 'glide') {
      const p = avatarGlide({
        from: [anim.from.x, anim.from.y, anim.from.z],
        to: [anim.to.x, anim.to.y, anim.to.z],
        t: k,
        arc: anim.arc,
      });
      pieceGroup.position.set(p.x, p.y, p.z);
      let delta = anim.travelHeading - anim.startHeading;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      pieceGroup.rotation.y = anim.startHeading + delta * Math.min(1, k * 1.6);
      if (k >= 1) {
        pieceGroup.position.copy(anim.to);
        data.anim = null;
        data.mode = 'idle';
        data.modeT = 0;
        pieceGroup.rotation.y = facingFor(data.color);
        data.heading = pieceGroup.rotation.y;
        const done = anim.onDone;
        noteAnimDone();
        done?.();
      }
    } else if (anim.phase === 'vanish') {
      const s = data.chibiScale * (1 - k);
      data.rig.group.scale.setScalar(Math.max(0.001, s));
      if (k >= 1) {
        boardGroup.remove(pieceGroup);
        const i = pieces.indexOf(pieceGroup);
        if (i >= 0) pieces.splice(i, 1);
        data.anim = null;
        const done = anim.onDone;
        noteAnimDone();
        done?.();
      }
    } else if (anim.phase === 'celebrate') {
      if (k >= 1) {
        data.anim = null;
        data.mode = 'idle';
        data.modeT = 0;
        const done = anim.onDone;
        noteAnimDone();
        done?.();
      }
    }
  }

  /* ----- move execution ----- */
  function victimSquareFor(move) {
    if (!move.captured) return null;
    // En passant: the captured pawn sits beside the mover's origin file.
    if (move.flags.includes('e')) return move.to[0] + move.from[1];
    return move.to;
  }

  function playMove(move) {
    clearSelection();
    const mover = piecesBySquare.get(move.from);
    if (!mover) return;
    const victimSquare = victimSquareFor(move);
    const victim = victimSquare ? piecesBySquare.get(victimSquare) : null;
    const isCastle = move.flags.includes('k') || move.flags.includes('q');

    // Logical board updates first; visuals follow.
    piecesBySquare.delete(move.from);
    if (victimSquare) piecesBySquare.delete(victimSquare);
    piecesBySquare.set(move.to, mover);
    mover.userData.square = move.to;

    let rook = null;
    let rookTo = null;
    if (isCastle) {
      const rank = move.from[1];
      const rookFrom = move.flags.includes('k') ? `h${rank}` : `a${rank}`;
      rookTo = move.flags.includes('k') ? `f${rank}` : `d${rank}`;
      rook = piecesBySquare.get(rookFrom);
      if (rook) {
        piecesBySquare.delete(rookFrom);
        piecesBySquare.set(rookTo, rook);
        rook.userData.square = rookTo;
      }
    }

    const [tx, , tz] = squareLocal(move.to);
    const to = new THREE.Vector3(tx, PIECE_Y, tz);
    const arc = move.captured ? AVATAR_MOTION.captureArc : AVATAR_MOTION.moveArc;

    if (victim && victim !== mover) startVanish(victim);

    const finishMover = () => {
      if (move.promotion) swapPromotionVisual(mover, move);
      if (victim) startCelebrate(mover, 'bow');
      setLastMove(move.from, move.to);
    };
    startGlide(mover, to, {arc}, finishMover);
    if (rook && rookTo) {
      const [rx, , rz] = squareLocal(rookTo);
      startGlide(rook, new THREE.Vector3(rx, PIECE_Y, rz), {}, null);
    }
    renderStatus();
    renderMoves();
  }

  function swapPromotionVisual(pawnGroup, move) {
    const color = pawnGroup.userData.color;
    const i = pieces.indexOf(pawnGroup);
    disposePieceVisual(pawnGroup);
    boardGroup.remove(pawnGroup);
    if (i >= 0) pieces.splice(i, 1);
    const promoted = buildWorldPiece(color, move.promotion, pawnGroup.userData.seed + 500);
    const [x, , z] = squareLocal(move.to);
    promoted.position.set(x, PIECE_Y, z);
    promoted.userData.square = move.to;
    promoted.rotation.y = facingFor(color);
    promoted.userData.heading = promoted.rotation.y;
    boardGroup.add(promoted);
    pieces.push(promoted);
    piecesBySquare.set(move.to, promoted);
    if (!reducedMotion) startCelebrate(promoted, 'hop');
  }

  function setLastMove(from, to) {
    [[from, 0], [to, 1]].forEach(([square, i]) => {
      const {x, z} = worldChessSquareXZ(square, SQUARE);
      lastMoveMeshes[i].position.set(x, TILE_TOP + 0.015, z);
      lastMoveMeshes[i].visible = true;
    });
  }

  function requestMove(from, to, promotion = null) {
    if (busy || aiThinking || !openState) return;
    let res;
    try {
      res = game.move(from, to, promotion);
    } catch {
      return; // illegal — ignore the tap
    }
    if (!res.ok) {
      if (res.needsPromotion) showPromotionChooser(from, to, res.options);
      return;
    }
    playMove(res.move);
  }

  function showPromotionChooser(from, to, options) {
    promotionRequest = {from, to, options};
    promoChoices.innerHTML = '';
    for (const choice of WORLD_CHESS_PROMOTION_CHOICES) {
      if (!options.includes(choice)) continue;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.textContent = WORLD_CHESS_ROLE_GLYPHS[choice];
      btn.title = GLYPH_NAME[choice];
      btn.addEventListener('click', () => {
        promoOverlay.classList.remove('open');
        const req = promotionRequest;
        promotionRequest = null;
        if (req) requestMove(req.from, req.to, choice);
      });
      promoChoices.appendChild(btn);
    }
    promoOverlay.classList.add('open');
  }

  /* ----- AI ----- */
  function maybeAiMove() {
    if (!openState || busy || aiThinking) return;
    if (!game.aiToMove() || game.snapshot().gameOver) return;
    aiThinking = true;
    renderStatus();
    const difficulty = resolveAiDifficulty(game.snapshot().difficulty);
    const budget = Math.min(difficulty.timeBudgetMs, AI_BUDGET_CAP_MS);
    aiTimer = setTimeout(() => {
      aiTimer = 0;
      let pick = null;
      try {
        pick = game.aiMove({timeBudgetMs: budget});
      } catch { /* AI fails closed: no move, human keeps the board */ }
      aiThinking = false;
      renderStatus();
      if (!pick || !openState) return;
      let res;
      try {
        res = game.move(pick.from, pick.to, pick.promotion);
      } catch { return; }
      if (res.ok) playMove(res.move);
    }, reducedMotion ? 60 : 450);
  }

  /* ----- input ----- */
  const canvas = (controls && controls.domElement)
    || doc.querySelector('canvas')
    || (doc.defaultView && doc.defaultView.document.querySelector('canvas'));
  let downPos = null;
  let downTime = 0;

  function onPointerDown(event) {
    if (!openState) return;
    downPos = [event.clientX, event.clientY];
    downTime = performance.now();
  }

  function onPointerUp(event) {
    if (!openState || !downPos) { downPos = null; return; }
    const dx = event.clientX - downPos[0];
    const dy = event.clientY - downPos[1];
    const quick = performance.now() - downTime < 600;
    downPos = null;
    if (Math.hypot(dx, dy) > 10 || !quick) return; // it was a drag — OrbitControls owns it
    handleTap(event.clientX, event.clientY);
  }

  function handleTap(clientX, clientY) {
    if (busy || aiThinking) return;
    const view = doc.defaultView;
    const width = view ? view.innerWidth : 1;
    const height = view ? view.innerHeight : 1;
    pointer.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hitMeshes = [...tileMeshes, ...pieces];
    const hits = raycaster.intersectObjects(hitMeshes, true);
    if (hits.length === 0) { clearSelection(); return; }
    const target = findSquareTarget(hits[0].object);
    if (!target) { clearSelection(); return; }
    const square = target.userData.square;
    const piece = piecesBySquare.get(square);
    if (selected && selected.moves.some((m) => m.to === square)) {
      requestMove(selected.square, square);
      return;
    }
    if (piece && humanCanPlay(piece.userData.color) && !game.snapshot().gameOver) {
      if (selected && selected.square === square) clearSelection();
      else selectPiece(square);
      return;
    }
    clearSelection();
  }

  /* ----- frame loop: idle language + animation ----- */
  let rafId = 0;
  let lastT = 0;
  let destroyed = false;

  function frame(now) {
    if (destroyed) return;
    rafId = requestAnimationFrame(frame);
    if (!openState || !boardGroup.visible) return;
    const t = now / 1000;
    const dt = Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;
    // Iterate a copy: captures remove pieces from the list mid-frame.
    for (const piece of [...pieces]) {
      const data = piece.userData;
      updatePieceAnim(piece, dt, now);
      data.modeT += dt;
      try {
        const pose = updateTumboChibiRig(THREE, data.rig, {
          time: t,
          seed: data.seed,
          reducedMotion,
          mode: data.mode,
          modeT: data.modeT,
        });
        const chibi = data.rig.group;
        chibi.position.y = 0.02 + pose.bobY + pose.lift;
        chibi.rotation.y = pose.swayY + (data.mode === 'spin' ? pose.turn : 0);
      } catch { /* a rig failure must never kill the frame loop */ }
    }
  }

  /* ----- camera ----- */
  function frameCamera() {
    const center = boardGroup.position.clone();
    center.y += 0.6;
    controls.target.copy(center);
    const side = flipped ? -1 : 1;
    camera.position.set(center.x, center.y + 13.5, center.z + side * 19);
    controls.minDistance = 8;
    controls.maxDistance = 60;
    controls.enableDamping = true;
    if (typeof controls.update === 'function') controls.update();
  }

  /* ----- open / close ----- */
  function open() {
    if (openState || destroyed) return;
    openState = true;
    boardGroup.visible = true;
    savedCamera = {
      position: camera.position.clone(),
      target: controls.target.clone(),
      minDistance: controls.minDistance,
      maxDistance: controls.maxDistance,
      enableDamping: controls.enableDamping,
    };
    frameCamera();
    hud.classList.add('open');
    lastT = performance.now() / 1000;
    renderStatus();
    renderMoves();
    maybeAiMove();
  }

  function close() {
    if (!openState || destroyed) return;
    openState = false;
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = 0; }
    aiThinking = false;
    promoOverlay.classList.remove('open');
    promotionRequest = null;
    clearSelection();
    hud.classList.remove('open');
    boardGroup.visible = false;
    if (savedCamera) {
      camera.position.copy(savedCamera.position);
      controls.target.copy(savedCamera.target);
      controls.minDistance = savedCamera.minDistance;
      controls.maxDistance = savedCamera.maxDistance;
      controls.enableDamping = savedCamera.enableDamping;
      if (typeof controls.update === 'function') controls.update();
      savedCamera = null;
    }
  }

  function handleExit() {
    close();
    if (typeof onExit === 'function') {
      try { onExit(); } catch { /* breadcrumb failure must not break close */ }
    }
  }

  /* ----- HUD wiring ----- */
  backBtn.addEventListener('click', handleExit);
  newBtn.addEventListener('click', () => {
    if (busy) return;
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = 0; }
    aiThinking = false;
    game.newGame();
    rebuildPieces();
    lastMoveMeshes.forEach((m) => { m.visible = false; });
    renderStatus();
    renderMoves();
    maybeAiMove();
  });
  resignBtn.addEventListener('click', () => {
    if (busy || aiThinking) return;
    if (game.resign()) {
      clearSelection();
      renderStatus();
      renderMoves();
    }
  });
  flipBtn.addEventListener('click', () => {
    flipped = !flipped;
    for (const piece of pieces) {
      if (piece.userData.anim) continue;
      piece.rotation.y = facingFor(piece.userData.color);
      piece.userData.heading = piece.rotation.y;
    }
    frameCamera();
  });
  modeSelect.addEventListener('change', () => {
    game.setMode(modeSelect.value);
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = 0; }
    aiThinking = false;
    game.newGame();
    rebuildPieces();
    lastMoveMeshes.forEach((m) => { m.visible = false; });
    renderStatus();
    renderMoves();
    maybeAiMove();
  });
  diffSelect.addEventListener('change', () => {
    game.setDifficulty(diffSelect.value);
    renderStatus();
  });

  function onKeyDown(event) {
    if (event.key === 'Escape' && openState) handleExit();
  }

  /* ----- public API ----- */
  function getSnapshot() {
    return Object.freeze({
      ...game.snapshot(),
      open: openState,
      busy,
      aiThinking,
      flipped,
      selected: selected ? selected.square : null,
    });
  }

  function setHomePosition(v3) {
    const x = Array.isArray(v3) ? v3[0] : v3?.x;
    const y = Array.isArray(v3) ? v3[1] : v3?.y;
    const z = Array.isArray(v3) ? v3[2] : v3?.z;
    if (![x, y, z].every(Number.isFinite)) throw new Error('setHomePosition needs a finite {x,y,z} or [x,y,z]');
    boardGroup.position.set(x, y, z);
    if (openState) frameCamera();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    close();
    cancelAnimationFrame(rafId);
    if (typeof window !== 'undefined') window.removeEventListener(OPEN_EVENT, openEventHandler);
    if (canvas && typeof canvas.removeEventListener === 'function') {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
    }
    if (doc.defaultView) doc.defaultView.removeEventListener('keydown', onKeyDown);
    hud.remove();
    promoOverlay.remove();
    scene.remove(boardGroup);
    badgeTextures.forEach((t) => { try { t.dispose(); } catch { /* noop */ } });
    M.dispose();
    G.dispose();
    boardDisposables.forEach((resource) => {
      if (resource && typeof resource.dispose === 'function') {
        try { resource.dispose(); } catch { /* noop */ }
      }
    });
    if (typeof window !== 'undefined' && window.__TUMBO_WORLD_CHESS__ === publicHandle) {
      delete window.__TUMBO_WORLD_CHESS__;
    }
  }

  function openEventHandler() { open(); }
  if (typeof window !== 'undefined') window.addEventListener(OPEN_EVENT, openEventHandler);
  if (canvas && typeof canvas.addEventListener === 'function') {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
  }
  if (doc.defaultView) doc.defaultView.addEventListener('keydown', onKeyDown);

  rebuildPieces();
  renderStatus();
  renderMoves();
  rafId = requestAnimationFrame(frame);

  const api = {open, close, getSnapshot, destroy, setHomePosition};
  const publicHandle = {open, close, getSnapshot, setHomePosition};
  if (typeof window !== 'undefined') window.__TUMBO_WORLD_CHESS__ = publicHandle;
  return api;
}
