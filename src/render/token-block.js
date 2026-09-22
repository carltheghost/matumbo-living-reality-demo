/**
 * token-block.js — TUMBO Token glass block for the maTumbo block world.
 *
 * One translucent blue glass cube (small by default), built with the canon
 * glass-style.js builders (Packet 233 one-block-system): translucent blue
 * glass body + glowing edge frame + core-to-corner connection lines.
 *
 * Interaction law: single click selects, hover peeks a balance summary,
 * double-click / double-tap travels into the token block world (wallet view
 * with balances per account/asset, idempotency-keyed send form with receipt
 * toast, history list, vault/lock summary). The cube drags in full 3D with
 * its position remembered in localStorage; the panel minimizes to a small
 * translucent chip. Every panel body scrolls; empty and offline states are
 * graceful — never an error wall.
 *
 * Simulation-first: TUMBO-SIM simulated points only. Every surface is
 * labeled simulated. No issuer, wallet connection, custody, signing,
 * settlement, exchange, or real-money path exists here.
 *
 * Wiring: renders against the shared contract window.TumboToken
 * { ledger, balance(acct,asset), fmt(fluff), on(evt,cb) } from
 * src/domains/token.js, and subscribes to both the facade and document
 * 'tumbo:token' CustomEvents for live updates. If the facade is absent the
 * block still mounts and renders graceful unavailable states.
 *
 * Node-safe: THREE and the DOM are only touched inside createTokenBlock().
 */
import { createDoubleTapDetector } from './double-tap.js?v=20260922-cache2';
import {
  makeGlassCubeMaterial,
  makeGlowMarker,
  makeConnectionLines,
  glassTintFor,
} from './glass-style.js?v=20260922-cache2';
import {
  TUMBO_TOKEN_EVENT,
  TUMBO_TOKEN_ASSET,
  TUMBO_TOKEN_DEFAULT_ACCOUNT,
  TUMBO_TOKEN_SOURCE,
  formatSimAmount,
  tumboSimToFluff,
  newIdempotencyKey,
  getTumboTokenFacade,
} from '../domains/token.js?v=20260922-cache2';

export const TOKEN_BLOCK_CONSOLE_SOURCE = 'tumbo-token-block';
const TOKEN_BLOCK_ID = 'tumbo-token';
const TOKEN_BLOCK_LABEL = 'TUMBO Token';
const CUBE_SIZE = 0.95;
const CORE_SIZE = 0.26;
const STORAGE_POSITION_KEY = 'tumbo:token-block:v1:position';
const STORAGE_MINIMIZED_KEY = 'tumbo:token-block:v1:minimized';
const DOUBLE_TAP_WINDOW_MS = 350;
const DOUBLE_TAP_DISTANCE_PX = 28;
const DRAG_THRESHOLD_PX = 6;
const DRAG_BOUNDS = { x: 10, yMin: 0.7, yMax: 9, z: 10 };
const DEFAULT_ANCHOR = { x: 4.6, y: 2.4, z: 2.4 };
const TOAST_TTL_MS = 7000;
const TABS = [
  { id: 'wallet', label: 'Wallet' },
  { id: 'send', label: 'Send' },
  { id: 'history', label: 'History' },
  { id: 'vault', label: 'Vault' },
];

const STYLE_TEXT = `
.tkb-root{position:fixed;inset:0;z-index:60;pointer-events:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.tkb-root[hidden]{display:none}
.tkb-wrap{position:fixed;right:20px;top:112px;width:min(400px,calc(100vw - 40px));pointer-events:none}
.tkb-panel{pointer-events:auto;display:flex;flex-direction:column;gap:10px;max-height:min(660px,calc(100vh - 150px));padding:15px;border:1px solid rgba(122,230,255,.24);border-radius:18px;background:linear-gradient(165deg,rgba(5,22,32,.96),rgba(3,8,14,.95));box-shadow:0 24px 80px rgba(0,0,0,.58),inset 0 0 42px rgba(65,205,255,.07);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);overflow:hidden;color:#dff7ff}
.tkb-panel[hidden]{display:none}
.tkb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.tkb-eyebrow{font-size:9px;letter-spacing:.2em;color:#70cce0;text-transform:uppercase}
.tkb-title{margin:4px 0 3px;font-size:20px;letter-spacing:.01em;color:#e8fbff}
.tkb-sub{margin:0;color:#8baab5;font-size:10px;line-height:1.4}
.tkb-head-actions{display:flex;gap:6px;flex:0 0 auto}
.tkb-icon-btn{appearance:none;min-width:36px;min-height:36px;border:1px solid rgba(137,222,239,.22);border-radius:8px;background:rgba(84,170,195,.08);color:#9bc7d2;font-size:16px;line-height:1;cursor:pointer}
.tkb-icon-btn:hover,.tkb-icon-btn:focus-visible{color:#eaffff;border-color:rgba(178,244,255,.6);outline:none}
.tkb-offline{padding:7px 9px;border-left:2px solid rgba(255,194,139,.7);border-radius:0 7px 7px 0;background:rgba(121,75,40,.16);color:#e5cbaa;font-size:8px;line-height:1.4;letter-spacing:.04em;text-transform:uppercase}
.tkb-offline[hidden]{display:none}
.tkb-tabs{display:flex;gap:5px;flex-wrap:wrap}
.tkb-tab{appearance:none;flex:1 1 0;min-width:0;min-height:40px;padding:7px 6px;border:1px solid rgba(122,230,255,.16);border-radius:9px;background:rgba(5,21,29,.6);color:#9bc7d2;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;touch-action:manipulation}
.tkb-tab:hover,.tkb-tab:focus-visible{border-color:rgba(178,244,255,.55);color:#eaffff;outline:none}
.tkb-tab[aria-selected="true"]{border-color:rgba(140,230,255,.7);background:rgba(42,137,167,.28);color:#f2fdff;box-shadow:inset 0 0 0 1px rgba(140,230,255,.18)}
.tkb-bodies{display:flex;min-height:0;flex:1 1 auto}
.tkb-body{display:none;min-width:0;flex:1 1 auto;min-height:120px;max-height:38vh;overflow-y:auto;overflow-x:hidden;padding:2px 4px 2px 0;scrollbar-width:thin;scrollbar-color:rgba(111,217,239,.45) rgba(5,20,28,.6)}
.tkb-body[data-active="true"]{display:block}
.tkb-total{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:9px 10px;border:1px solid rgba(122,230,255,.16);border-radius:10px;background:rgba(42,137,167,.1);margin-bottom:7px}
.tkb-total span{color:#8db8c3;font-size:8px;letter-spacing:.1em;text-transform:uppercase}
.tkb-total b{color:#e8fbff;font-size:16px;font-variant-numeric:tabular-nums}
.tkb-rows{display:grid;gap:5px}
.tkb-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;padding:8px 9px;border:1px solid rgba(122,230,255,.1);border-radius:9px;background:rgba(8,26,36,.6)}
.tkb-row-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d8f4ff;font-size:10px;font-weight:650}
.tkb-row-meta{color:#7fa5b1;font-size:8px;letter-spacing:.05em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tkb-row-value{grid-row:1 / span 2;align-self:center;color:#bfeaff;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.tkb-empty{padding:12px;border:1px dashed rgba(122,230,255,.2);border-radius:9px;color:#8db8c3;font-size:9px;line-height:1.5;text-align:center}
.tkb-sim-note{margin-top:8px;color:#6e99a5;font-size:8px;line-height:1.4;letter-spacing:.03em}
.tkb-form{display:grid;gap:8px}
.tkb-field{display:grid;gap:4px}
.tkb-field label{color:#8db8c3;font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.tkb-field input{width:100%;min-width:0;padding:9px 10px;border:1px solid rgba(122,230,255,.2);border-radius:9px;background:rgba(3,12,20,.8);color:#dff9ff;font-size:12px;outline:none}
.tkb-field input:focus{border-color:rgba(145,232,255,.7);box-shadow:0 0 0 2px rgba(84,194,232,.14)}
.tkb-field input[readonly]{color:#9bc7d2;background:rgba(10,26,36,.6)}
.tkb-key-row{display:flex;align-items:center;gap:7px;padding:7px 9px;border:1px solid rgba(122,230,255,.12);border-radius:8px;background:rgba(8,26,36,.55)}
.tkb-key-row code{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9fd8e8;font-size:9px}
.tkb-key-row button{appearance:none;flex:0 0 auto;border:1px solid rgba(122,230,255,.25);border-radius:7px;padding:6px 8px;background:rgba(42,137,167,.14);color:#c9edff;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
.tkb-key-row button:hover{border-color:rgba(190,246,255,.7)}
.tkb-form-error{display:none;padding:7px 9px;border-left:2px solid rgba(255,120,132,.65);border-radius:0 7px 7px 0;background:rgba(148,59,76,.14);color:#ffc9ce;font-size:9px;line-height:1.4}
.tkb-form-error[data-visible="true"]{display:block}
.tkb-submit{appearance:none;min-height:46px;border:1px solid rgba(140,230,255,.4);border-radius:10px;padding:10px;background:linear-gradient(135deg,rgba(42,137,167,.4),rgba(24,80,100,.35));color:#eafcff;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;touch-action:manipulation}
.tkb-submit:hover,.tkb-submit:focus-visible{border-color:rgba(210,248,255,.85);outline:none;transform:translateY(-1px)}
.tkb-submit:disabled{opacity:.45;cursor:wait;transform:none}
.tkb-hist-row{display:grid;gap:3px;padding:8px 9px;border:1px solid rgba(122,230,255,.1);border-radius:9px;background:rgba(8,26,36,.6)}
.tkb-hist-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.tkb-hist-dir{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d8f4ff;font-size:10px;font-weight:650}
.tkb-hist-amt{flex:0 0 auto;color:#bfeaff;font-size:11px;font-variant-numeric:tabular-nums}
.tkb-hist-memo{color:#9eb8c2;font-size:9px;line-height:1.35;overflow-wrap:anywhere}
.tkb-hist-meta{display:flex;justify-content:space-between;gap:8px;color:#7fa5b1;font-size:7px;letter-spacing:.06em;text-transform:uppercase}
.tkb-hist-meta code{color:#9fd8e8;text-transform:none;letter-spacing:0}
.tkb-pill{display:inline-block;padding:3px 7px;border-radius:999px;font-size:7px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.tkb-pill-sim{border:1px solid rgba(140,230,255,.3);color:#9fdcf0;background:rgba(42,137,167,.12)}
.tkb-pill-lock{border:1px solid rgba(255,208,121,.35);color:#ffd9a3;background:rgba(145,91,31,.14)}
.tkb-vault-sum{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:7px}
.tkb-vault-metric{padding:8px;border:1px solid rgba(122,230,255,.12);border-radius:9px;background:rgba(42,137,167,.08)}
.tkb-vault-metric b{display:block;color:#e8fbff;font-size:13px;font-variant-numeric:tabular-nums}
.tkb-vault-metric span{display:block;margin-top:3px;color:#7fa5b1;font-size:7px;letter-spacing:.1em;text-transform:uppercase}
.tkb-lock-row{display:grid;gap:3px;padding:8px 9px;border:1px solid rgba(255,208,121,.14);border-radius:9px;background:rgba(48,32,16,.4)}
.tkb-lock-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.tkb-lock-top strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ffe4b8;font-size:10px}
.tkb-lock-top b{flex:0 0 auto;color:#ffd9a3;font-size:11px;font-variant-numeric:tabular-nums}
.tkb-lock-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#c9a97e;font-size:8px}
.tkb-unlock{appearance:none;border:1px solid rgba(122,232,192,.4);border-radius:7px;padding:6px 8px;background:rgba(40,148,114,.16);color:#cff8e4;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
.tkb-unlock:hover{border-color:rgba(200,255,230,.8)}
.tkb-unlock:disabled{opacity:.4;cursor:not-allowed}
.tkb-chip{pointer-events:auto;position:fixed;left:20px;bottom:20px;z-index:61;display:flex;align-items:center;gap:8px;min-height:44px;padding:9px 14px;border:1px solid rgba(122,230,255,.3);border-radius:999px;background:linear-gradient(135deg,rgba(9,29,38,.88),rgba(4,12,18,.72));color:#d6fbff;font-size:11px;font-weight:700;letter-spacing:.04em;cursor:pointer;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 10px 30px rgba(0,0,0,.35)}
.tkb-chip:hover{border-color:rgba(190,246,255,.7)}
.tkb-chip[hidden]{display:none}
.tkb-chip .tkb-chip-dot{width:9px;height:9px;border-radius:2px;background:linear-gradient(135deg,#7fd4ff,#2f7dff);box-shadow:0 0 12px rgba(127,212,255,.8);transform:rotate(45deg)}
.tkb-chip small{color:#7fa5b1;font-weight:600;letter-spacing:.08em;font-size:8px;text-transform:uppercase}
.tkb-toasts{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:80;display:grid;gap:8px;width:min(400px,calc(100vw - 32px));pointer-events:none}
.tkb-toast{pointer-events:auto;display:grid;gap:5px;padding:11px 12px;border:1px solid rgba(122,232,192,.4);border-radius:12px;background:linear-gradient(165deg,rgba(6,30,26,.96),rgba(3,10,14,.94));box-shadow:0 16px 50px rgba(0,0,0,.5);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
.tkb-toast strong{color:#d9fff0;font-size:11px}
.tkb-toast p{margin:0;color:#a9c9c5;font-size:9px;line-height:1.4;overflow-wrap:anywhere}
.tkb-toast-actions{display:flex;gap:6px}
.tkb-toast button{appearance:none;flex:1;border:1px solid rgba(122,232,192,.35);border-radius:8px;padding:7px 8px;background:rgba(40,148,114,.14);color:#cff8e4;font-size:8px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;cursor:pointer}
.tkb-toast button:hover{border-color:rgba(200,255,230,.75)}
.tkb-peek{position:fixed;z-index:70;max-width:min(280px,calc(100vw - 32px));padding:9px 11px;border:1px solid rgba(122,230,255,.3);border-radius:11px;background:linear-gradient(165deg,rgba(5,22,32,.95),rgba(3,8,14,.92));box-shadow:0 14px 44px rgba(0,0,0,.5);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);pointer-events:none;color:#d8f4ff;font-size:10px;line-height:1.45}
.tkb-peek[hidden]{display:none}
.tkb-peek b{color:#fff}
.tkb-peek .tkb-peek-hint{display:block;margin-top:4px;color:#7fa5b1;font-size:8px;letter-spacing:.05em}
@media (max-width:640px){
.tkb-wrap{left:12px;right:12px;top:auto;bottom:12px;width:auto}
.tkb-panel{max-height:64vh;padding:13px}
.tkb-body{max-height:40vh}
.tkb-chip{left:12px;bottom:auto;top:12px}
.tkb-toasts{bottom:12px}
}
`;

function readStoredPosition() {
  try {
    const raw = localStorage.getItem(STORAGE_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const x = Number(parsed?.x); const y = Number(parsed?.y); const z = Number(parsed?.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return {
      x: Math.max(-DRAG_BOUNDS.x, Math.min(DRAG_BOUNDS.x, x)),
      y: Math.max(DRAG_BOUNDS.yMin, Math.min(DRAG_BOUNDS.yMax, y)),
      z: Math.max(-DRAG_BOUNDS.z, Math.min(DRAG_BOUNDS.z, z)),
    };
  } catch { return null; }
}

function writeStoredPosition(anchor) {
  try {
    localStorage.setItem(STORAGE_POSITION_KEY, JSON.stringify({
      x: Number(anchor.x.toFixed(3)), y: Number(anchor.y.toFixed(3)), z: Number(anchor.z.toFixed(3)),
    }));
  } catch {}
}

function readStoredMinimized() {
  try { return localStorage.getItem(STORAGE_MINIMIZED_KEY) === '1'; } catch { return false; }
}

function writeStoredMinimized(value) {
  try { localStorage.setItem(STORAGE_MINIMIZED_KEY, value ? '1' : '0'); } catch {}
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return String(iso ?? ''); }
}

function formatUnlock(iso) {
  if (!iso) return 'No unlock date';
  try {
    return `Unlocks ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } catch { return 'Unlock date unavailable'; }
}

function shortId(id) {
  const text = String(id ?? '');
  return text.length > 10 ? `…${text.slice(-8)}` : text;
}

/**
 * Mount the Token glass block.
 *
 * @param {object} options
 * @param {object} options.three - the pinned three.js module (required)
 * @param {HTMLCanvasElement} [options.renderer] - renderer (for canvas input)
 * @param {THREE.Camera} [options.camera]
 * @param {object} [options.controls] - orbit controls (disabled during drag/flight)
 * @param {THREE.Object3D} [options.parent] - scene group to attach the cube
 * @param {Document} [options.documentRoot]
 * @param {boolean} [options.isMobile]
 * @param {boolean} [options.reducedMotion]
 * @param {(dragging:boolean)=>void} [options.onDragStateChange]
 * @param {(snapshot:{source:string,action:string,detail:object})=>void} [options.onIntent]
 */
export function createTokenBlock(options = {}) {
  const THREE = options.three;
  const doc = options.documentRoot ?? (typeof document !== 'undefined' ? document : null);
  if (!THREE || !doc) throw new Error('createTokenBlock requires three.js and a document');
  const camera = options.camera ?? null;
  const controls = options.controls ?? null;
  const parent = options.parent ?? null;
  const reducedMotion = options.reducedMotion === true;
  const onDragStateChange = typeof options.onDragStateChange === 'function' ? options.onDragStateChange : null;
  const onIntent = typeof options.onIntent === 'function' ? options.onIntent : null;
  const canvas = options.renderer?.domElement ?? doc.querySelector('canvas') ?? null;

  const facade = getTumboTokenFacade();
  const ledger = facade?.ledger ?? null;

  const emitIntent = (action, detail = {}) => {
    try { onIntent?.({ source: TOKEN_BLOCK_CONSOLE_SOURCE, action, detail: { ...detail } }); } catch {}
  };

  // ---------- style ----------
  const styleEl = doc.createElement('style');
  styleEl.setAttribute('data-token-block', 'true');
  styleEl.textContent = STYLE_TEXT;
  doc.head.appendChild(styleEl);

  // ---------- 3D cube ----------
  const group = new THREE.Group();
  group.name = 'tumbo-token-block';
  const anchor = { ...(readStoredPosition() ?? DEFAULT_ANCHOR) };
  let bobPhase = Math.random() * Math.PI * 2;

  const tint = glassTintFor('#4aa8ff', 0.5);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE),
    makeGlassCubeMaterial(THREE, tint),
  );
  body.name = 'tumbo-token-block/body';
  body.userData.tokenBlockId = TOKEN_BLOCK_ID;
  const edges = makeGlowMarker(THREE, { size: CUBE_SIZE });
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(CORE_SIZE, CORE_SIZE, CORE_SIZE),
    new THREE.MeshStandardMaterial({
      color: 0x2f7dff, emissive: 0x1a56ff, emissiveIntensity: 2.2,
      roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.92,
    }),
  );
  core.name = 'tumbo-token-block/core';
  const half = CUBE_SIZE / 2;
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    corners.push({ x: sx * half, y: sy * half, z: sz * half });
  }
  const links = makeConnectionLines(THREE, corners.map((corner) => [{ x: 0, y: 0, z: 0 }, corner]));
  const selectRing = makeGlowMarker(THREE, { size: CUBE_SIZE * 1.22, color: '#cfeaff', opacity: 0.95 });
  selectRing.visible = false;
  group.add(body, edges, core, links, selectRing);
  group.position.set(anchor.x, anchor.y, anchor.z);
  parent?.add(group);

  const raycastTargets = [body];
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const hitPoint = new THREE.Vector3();
  const tmpVec = new THREE.Vector3();

  function castAt(clientX, clientY) {
    if (!camera) return null;
    const rect = canvas?.getBoundingClientRect?.();
    const w = rect?.width ?? 1; const h = rect?.height ?? 1;
    const x = rect ? clientX - rect.left : clientX;
    const y = rect ? clientY - rect.top : clientY;
    pointerNdc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(raycastTargets, false);
    return hits.length ? hits[0] : null;
  }

  // ---------- DOM ----------
  const root = el('section', 'tkb-root');
  root.hidden = true;
  root.setAttribute('aria-label', 'TUMBO Token block world');

  const wrap = el('div', 'tkb-wrap');
  const panel = el('div', 'tkb-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', 'TUMBO Token block world');
  panel.hidden = true;

  const head = el('div', 'tkb-head');
  const headCopy = el('div');
  headCopy.appendChild(el('div', 'tkb-eyebrow', 'TUMBO Token · Simulated'));
  headCopy.appendChild(el('h2', 'tkb-title', 'Token Block World'));
  headCopy.appendChild(el('p', 'tkb-sub', 'TUMBO-SIM points only · no real value · local simulation'));
  const headActions = el('div', 'tkb-head-actions');
  const minBtn = el('button', 'tkb-icon-btn', '–');
  minBtn.type = 'button'; minBtn.setAttribute('aria-label', 'Minimize to chip'); minBtn.title = 'Minimize to chip';
  const closeBtn = el('button', 'tkb-icon-btn', '×');
  closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', 'Close token block world'); closeBtn.title = 'Close';
  headActions.appendChild(minBtn); headActions.appendChild(closeBtn);
  head.appendChild(headCopy); head.appendChild(headActions);
  panel.appendChild(head);

  const offlineBar = el('div', 'tkb-offline', "You're offline — showing local simulated balances. Sends still record locally.");
  offlineBar.hidden = true;
  panel.appendChild(offlineBar);

  const tabsEl = el('div', 'tkb-tabs');
  tabsEl.setAttribute('role', 'tablist');
  tabsEl.setAttribute('aria-label', 'Token views');
  const tabButtons = new Map();
  for (const tab of TABS) {
    const button = el('button', 'tkb-tab', tab.label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.dataset.tab = tab.id;
    button.addEventListener('click', () => setTab(tab.id, 'tab'));
    tabsEl.appendChild(button);
    tabButtons.set(tab.id, button);
  }
  panel.appendChild(tabsEl);

  const bodiesEl = el('div', 'tkb-bodies');
  const bodyEls = new Map();
  for (const tab of TABS) {
    const bodyEl = el('div', 'tkb-body');
    bodyEl.dataset.tab = tab.id;
    bodyEl.dataset.active = 'false';
    bodyEl.setAttribute('role', 'tabpanel');
    bodyEl.setAttribute('aria-label', `${tab.label} — simulated`);
    bodiesEl.appendChild(bodyEl);
    bodyEls.set(tab.id, bodyEl);
  }
  panel.appendChild(bodiesEl);
  wrap.appendChild(panel);

  const chip = el('button', 'tkb-chip');
  chip.type = 'button';
  chip.hidden = true;
  chip.setAttribute('aria-label', 'Restore token block world');
  chip.appendChild(el('span', 'tkb-chip-dot'));
  const chipBalance = el('span', '', '—');
  chip.appendChild(chipBalance);
  chip.appendChild(el('small', '', 'simulated'));
  chip.addEventListener('click', () => restore('chip'));
  wrap.appendChild(chip);
  root.appendChild(wrap);

  const toastsEl = el('div', 'tkb-toasts');
  toastsEl.setAttribute('aria-live', 'polite');
  root.appendChild(toastsEl);

  const peek = el('div', 'tkb-peek');
  peek.hidden = true;
  root.appendChild(peek);
  doc.body.appendChild(root);

  // ---------- wallet tab ----------
  const walletBody = bodyEls.get('wallet');
  const totalBox = el('div', 'tkb-total');
  totalBox.appendChild(el('span', '', 'Total simulated'));
  const totalValue = el('b', '', '—');
  totalBox.appendChild(totalValue);
  walletBody.appendChild(totalBox);
  const walletRows = el('div', 'tkb-rows');
  walletBody.appendChild(walletRows);
  const walletEmpty = el('div', 'tkb-empty', 'No accounts yet — this simulated wallet is empty.');
  walletEmpty.hidden = true;
  walletBody.appendChild(walletEmpty);
  const walletNote = el('p', 'tkb-sim-note', 'Balances are simulated TUMBO-SIM points for the local demo. They are not real tokens, money, or financial claims.');
  walletBody.appendChild(walletNote);

  // ---------- send tab ----------
  const sendBody = bodyEls.get('send');
  const form = el('form', 'tkb-form');
  form.setAttribute('novalidate', 'true');
  const fromField = el('div', 'tkb-field');
  fromField.appendChild(el('label', '', 'From'));
  const fromInput = el('input'); fromInput.readOnly = true; fromInput.value = TUMBO_TOKEN_DEFAULT_ACCOUNT; fromInput.setAttribute('aria-label', 'From account (simulated)');
  fromField.appendChild(fromInput);
  const toField = el('div', 'tkb-field');
  const toLabel = el('label', '', 'To'); toLabel.setAttribute('for', 'tkb-send-to');
  const toInput = el('input'); toInput.id = 'tkb-send-to'; toInput.placeholder = 'alice'; toInput.maxLength = 64; toInput.autocomplete = 'off';
  toField.appendChild(toLabel); toField.appendChild(toInput);
  const amountField = el('div', 'tkb-field');
  const amountLabel = el('label', '', 'Amount (TUMBO-SIM)'); amountLabel.setAttribute('for', 'tkb-send-amount');
  const amountInput = el('input'); amountInput.id = 'tkb-send-amount'; amountInput.placeholder = '1.250'; amountInput.inputMode = 'decimal'; amountInput.autocomplete = 'off';
  amountField.appendChild(amountLabel); amountField.appendChild(amountInput);
  const memoField = el('div', 'tkb-field');
  const memoLabel = el('label', '', 'Memo (optional)'); memoLabel.setAttribute('for', 'tkb-send-memo');
  const memoInput = el('input'); memoInput.id = 'tkb-send-memo'; memoInput.placeholder = 'Demo lunch split'; memoInput.maxLength = 140; memoInput.autocomplete = 'off';
  memoField.appendChild(memoLabel); memoField.appendChild(memoInput);
  const keyRow = el('div', 'tkb-key-row');
  const keyLabel = el('span', '', 'Key');
  keyLabel.style.cssText = 'color:#7fa5b1;font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase';
  const keyCode = el('code', '', '');
  const keyRegen = el('button', '', 'New key'); keyRegen.type = 'button';
  keyRow.appendChild(keyLabel); keyRow.appendChild(keyCode); keyRow.appendChild(keyRegen);
  const formError = el('div', 'tkb-form-error', '');
  formError.dataset.visible = 'false'; formError.setAttribute('role', 'alert');
  const submitBtn = el('button', 'tkb-submit', 'Send (simulated)');
  submitBtn.type = 'submit';
  form.appendChild(fromField); form.appendChild(toField); form.appendChild(amountField);
  form.appendChild(memoField); form.appendChild(keyRow); form.appendChild(formError); form.appendChild(submitBtn);
  sendBody.appendChild(form);
  const sendNote = el('p', 'tkb-sim-note', 'Sends move simulated TUMBO-SIM points between local demo accounts. Each send carries an idempotency key: retrying with the same key replays the original receipt instead of sending twice.');
  sendBody.appendChild(sendNote);

  let idempotencyKey = newIdempotencyKey();
  function renderKey() {
    keyCode.textContent = shortId(idempotencyKey);
    keyCode.title = idempotencyKey;
  }
  renderKey();
  keyRegen.addEventListener('click', () => { idempotencyKey = newIdempotencyKey(); renderKey(); });

  function showFormError(message) {
    formError.textContent = message;
    formError.dataset.visible = 'true';
  }
  function clearFormError() {
    formError.textContent = '';
    formError.dataset.visible = 'false';
  }

  // ---------- history tab ----------
  const historyBody = bodyEls.get('history');
  const historyRows = el('div', 'tkb-rows');
  historyBody.appendChild(historyRows);
  const historyEmpty = el('div', 'tkb-empty', 'No simulated transfers yet — sends you make here will appear in this list.');
  historyEmpty.hidden = true;
  historyBody.appendChild(historyEmpty);
  historyBody.appendChild(el('p', 'tkb-sim-note', 'Every receipt below is a local simulation record, newest first.'));

  // ---------- vault tab ----------
  const vaultBody = bodyEls.get('vault');
  const vaultSum = el('div', 'tkb-vault-sum');
  const vaultLockedMetric = el('div', 'tkb-vault-metric');
  vaultLockedMetric.appendChild(el('b', '', '—'));
  vaultLockedMetric.appendChild(el('span', '', 'Locked simulated'));
  const vaultSpendMetric = el('div', 'tkb-vault-metric');
  vaultSpendMetric.appendChild(el('b', '', '—'));
  vaultSpendMetric.appendChild(el('span', '', 'Spendable simulated'));
  vaultSum.appendChild(vaultLockedMetric); vaultSum.appendChild(vaultSpendMetric);
  vaultBody.appendChild(vaultSum);
  const vaultRows = el('div', 'tkb-rows');
  vaultBody.appendChild(vaultRows);
  const vaultEmpty = el('div', 'tkb-empty', 'No locked balances in this simulated wallet.');
  vaultEmpty.hidden = true;
  vaultBody.appendChild(vaultEmpty);
  vaultBody.appendChild(el('p', 'tkb-sim-note', 'Locks are simulated: they ring-fence TUMBO-SIM points inside the local demo and never custody real assets.'));

  // ---------- state ----------
  const state = {
    selected: false,
    open: false,
    minimized: false,
    tab: 'wallet',
    dragging: false,
    hovered: false,
  };
  let camTween = null;
  let savedPose = null;
  let downInfo = null;

  function fmtFluff(fluff) {
    try {
      if (facade) return facade.fmt(fluff);
    } catch {}
    return `${formatSimAmount(fluff)} ${TUMBO_TOKEN_ASSET}`;
  }

  function spendableFluff() {
    try { return ledger ? ledger.balance(TUMBO_TOKEN_DEFAULT_ACCOUNT, TUMBO_TOKEN_ASSET) : 0; }
    catch { return 0; }
  }

  function peekSummary() {
    const total = spendableFluff();
    let locked = 0;
    try { locked = ledger ? ledger.vault(TUMBO_TOKEN_DEFAULT_ACCOUNT, TUMBO_TOKEN_ASSET).totalLockedFluff : 0; }
    catch {}
    return { total, locked };
  }

  // ---------- rendering ----------
  function renderWallet() {
    let rows = [];
    try { rows = ledger ? ledger.accounts() : []; } catch { rows = []; }
    walletRows.replaceChildren();
    walletEmpty.hidden = rows.length > 0;
    let grand = 0;
    for (const row of rows) {
      grand += row.balanceFluff;
      const rowEl = el('div', 'tkb-row');
      const title = el('div', 'tkb-row-title', row.acct);
      const meta = el('div', 'tkb-row-meta', `${row.asset} · simulated`);
      const value = el('div', 'tkb-row-value', formatSimAmount(row.balanceFluff));
      const copy = el('div'); copy.appendChild(title); copy.appendChild(meta);
      rowEl.appendChild(copy); rowEl.appendChild(value);
      walletRows.appendChild(rowEl);
    }
    totalValue.textContent = rows.length ? fmtFluff(grand) : '—';
    if (!ledger) {
      walletEmpty.hidden = false;
      walletEmpty.textContent = 'Simulated ledger unavailable — the token core did not load. The cube stays visible; balances will appear once the core mounts.';
    } else if (rows.length === 0) {
      walletEmpty.textContent = 'No accounts yet — this simulated wallet is empty.';
    }
  }

  function historyKindLabel(receipt) {
    if (receipt.kind === 'faucet-credit') return `Faucet credit · from ${receipt.from}`;
    return `To ${receipt.to}`;
  }

  function renderHistory() {
    let items = [];
    try { items = ledger ? ledger.history({ limit: 50 }) : []; } catch { items = []; }
    historyRows.replaceChildren();
    historyEmpty.hidden = items.length > 0;
    for (const receipt of items) {
      const rowEl = el('div', 'tkb-hist-row');
      const top = el('div', 'tkb-hist-top');
      top.appendChild(el('div', 'tkb-hist-dir', historyKindLabel(receipt)));
      top.appendChild(el('div', 'tkb-hist-amt', formatSimAmount(receipt.amountFluff)));
      rowEl.appendChild(top);
      if (receipt.memo) rowEl.appendChild(el('div', 'tkb-hist-memo', receipt.memo));
      const meta = el('div', 'tkb-hist-meta');
      const left = el('span', '', `${formatTime(receipt.at)} · `);
      const code = el('code', '', `receipt ${shortId(receipt.id)}`);
      left.appendChild(code);
      meta.appendChild(left);
      const pill = el('span', 'tkb-pill tkb-pill-sim', receipt.duplicate ? 'replay · simulated' : 'simulated');
      meta.appendChild(pill);
      rowEl.appendChild(meta);
      historyRows.appendChild(rowEl);
    }
  }

  function renderVault() {
    let summary = { locks: [], totalLockedFluff: 0 };
    try { summary = ledger ? ledger.vault(TUMBO_TOKEN_DEFAULT_ACCOUNT, TUMBO_TOKEN_ASSET) : summary; }
    catch {}
    vaultRows.replaceChildren();
    vaultEmpty.hidden = summary.locks.length > 0;
    vaultLockedMetric.firstChild.textContent = formatSimAmount(summary.totalLockedFluff);
    vaultSpendMetric.firstChild.textContent = formatSimAmount(spendableFluff());
    const now = Date.now();
    for (const lockEntry of summary.locks) {
      const rowEl = el('div', 'tkb-lock-row');
      const top = el('div', 'tkb-lock-top');
      top.appendChild(el('strong', '', lockEntry.label));
      top.appendChild(el('b', '', formatSimAmount(lockEntry.amountFluff)));
      rowEl.appendChild(top);
      const meta = el('div', 'tkb-lock-meta');
      meta.appendChild(el('span', '', `${formatUnlock(lockEntry.unlocksAt)} · ${lockEntry.status}`));
      if (lockEntry.status === 'locked') {
        const matured = !lockEntry.unlocksAt || now >= Date.parse(lockEntry.unlocksAt);
        const unlockBtn = el('button', 'tkb-unlock', matured ? 'Release' : 'Locked');
        unlockBtn.type = 'button';
        unlockBtn.disabled = !matured;
        unlockBtn.addEventListener('click', () => {
          try {
            ledger.unlock(lockEntry.id);
            emitIntent('vault-release', { lockId: lockEntry.id });
          } catch { showFormError(''); }
        });
        meta.appendChild(unlockBtn);
      } else {
        meta.appendChild(el('span', 'tkb-pill tkb-pill-sim', 'released'));
      }
      rowEl.appendChild(meta);
      vaultRows.appendChild(rowEl);
    }
  }

  function renderChip() {
    chipBalance.textContent = fmtFluff(spendableFluff());
  }

  function renderAll() {
    renderWallet(); renderHistory(); renderVault(); renderChip();
  }

  function setTab(id, method = 'api') {
    if (!bodyEls.has(id)) return;
    state.tab = id;
    for (const [key, button] of tabButtons) button.setAttribute('aria-selected', String(key === id));
    for (const [key, bodyEl] of bodyEls) bodyEl.dataset.active = String(key === id);
    if (method !== 'silent') emitIntent('tab', { tab: id, method });
  }

  // ---------- toasts ----------
  function toast({ title, body: bodyText, actionLabel, onAction }) {
    const toastEl = el('div', 'tkb-toast');
    toastEl.appendChild(el('strong', '', title));
    if (bodyText) toastEl.appendChild(el('p', '', bodyText));
    const actions = el('div', 'tkb-toast-actions');
    if (actionLabel) {
      const actionBtn = el('button', '', actionLabel);
      actionBtn.type = 'button';
      actionBtn.addEventListener('click', () => { try { onAction?.(); } catch {} dismiss(); });
      actions.appendChild(actionBtn);
    }
    const dismissBtn = el('button', '', 'Dismiss');
    dismissBtn.type = 'button';
    actions.appendChild(dismissBtn);
    toastEl.appendChild(actions);
    toastsEl.appendChild(toastEl);
    root.hidden = false;
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return; dismissed = true;
      toastEl.remove();
      if (state.open === false && panel.hidden && chip.hidden && toastsEl.children.length === 0 && peek.hidden) root.hidden = true;
    };
    dismissBtn.addEventListener('click', dismiss);
    setTimeout(dismiss, TOAST_TTL_MS);
    return dismiss;
  }

  function toastReceipt(receipt) {
    const amount = formatSimAmount(receipt.amountFluff);
    const title = receipt.duplicate
      ? `Already recorded — ${amount} ${TUMBO_TOKEN_ASSET} (simulated)`
      : `Sent ${amount} ${TUMBO_TOKEN_ASSET} (simulated)`;
    toast({
      title,
      bodyText: receipt.duplicate
        ? `Idempotency replay: no funds moved twice. Receipt ${shortId(receipt.id)} · to ${receipt.to}.`
        : `Receipt ${shortId(receipt.id)} · to ${receipt.to}${receipt.memo ? ` · “${receipt.memo}”` : ''}.`,
      actionLabel: 'View history',
      onAction: () => { if (!state.open) enter('toast'); setTab('history', 'toast'); },
    });
  }

  // ---------- send ----------
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFormError();
    if (!ledger) { showFormError('Simulated ledger unavailable — the token core did not load. Nothing was sent.'); return; }
    const to = toInput.value.trim();
    const amountText = amountInput.value.trim();
    const memo = memoInput.value;
    if (!to) { showFormError('Enter a recipient for this simulated send.'); toInput.focus(); return; }
    let amountFluff;
    try { amountFluff = tumboSimToFluff(amountText); }
    catch { showFormError('Enter an amount in TUMBO-SIM, e.g. 1.250.'); amountInput.focus(); return; }
    if (amountFluff <= 0) { showFormError('Amount must be greater than 0 TUMBO-SIM.'); amountInput.focus(); return; }
    submitBtn.disabled = true;
    try {
      const receipt = ledger.send({
        from: TUMBO_TOKEN_DEFAULT_ACCOUNT,
        to,
        asset: TUMBO_TOKEN_ASSET,
        amountFluff,
        memo,
        idempotencyKey,
      });
      idempotencyKey = newIdempotencyKey();
      renderKey();
      amountInput.value = '';
      memoInput.value = '';
      toastReceipt(receipt);
      emitIntent('send', { to, amountFluff, duplicate: receipt.duplicate === true, receiptId: receipt.id });
    } catch (error) {
      if (error?.code === 'insufficient-simulated-funds') {
        showFormError('Insufficient simulated balance for this send — nothing was moved.');
      } else {
        showFormError('Could not record this simulated send — nothing was moved.');
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---------- open / close / minimize ----------
  function flyTo(position, target, done) {
    if (!camera) { done?.(); return; }
    if (reducedMotion) {
      camera.position.copy(position);
      if (controls?.target) { controls.target.copy(target); camera.lookAt(target); }
      done?.();
      return;
    }
    camTween = {
      fromPos: camera.position.clone(),
      toPos: position.clone(),
      fromTgt: controls?.target ? controls.target.clone() : new THREE.Vector3(),
      toTgt: target.clone(),
      start: performance.now(),
      dur: 900,
      done,
    };
    setControlsEnabled(false);
  }

  function setControlsEnabled(enabled) {
    try { if (controls) controls.enabled = enabled; } catch {}
    try { onDragStateChange?.(!enabled); } catch {}
  }

  function enter(method = 'api') {
    if (state.open) { setTab(state.tab, 'silent'); panel.hidden = false; chip.hidden = true; return true; }
    state.open = true;
    state.minimized = false;
    if (camera) {
      savedPose = {
        pos: camera.position.clone(),
        tgt: controls?.target ? controls.target.clone() : null,
      };
    }
    renderAll();
    root.hidden = false;
    panel.hidden = false;
    chip.hidden = true;
    setTab(state.tab, 'silent');
    const target = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
    const position = target.clone().add(new THREE.Vector3(0, 1.6, 4.2));
    flyTo(position, target);
    try { closeBtn.focus({ preventScroll: true }); } catch {}
    emitIntent('enter', { method });
    return true;
  }

  function exit(method = 'api') {
    if (!state.open) return false;
    state.open = false;
    state.minimized = false;
    writeStoredMinimized(false);
    root.hidden = true;
    panel.hidden = true;
    chip.hidden = true;
    peek.hidden = true;
    if (savedPose && camera) {
      flyTo(savedPose.pos, savedPose.tgt ?? new THREE.Vector3(anchor.x, anchor.y, anchor.z));
      savedPose = null;
    } else {
      setControlsEnabled(true);
    }
    emitIntent('exit', { method });
    return true;
  }

  function minimize(method = 'api') {
    if (!state.open || state.minimized) return false;
    state.minimized = true;
    writeStoredMinimized(true);
    panel.hidden = true;
    chip.hidden = false;
    root.hidden = false;
    renderChip();
    try { chip.focus({ preventScroll: true }); } catch {}
    emitIntent('minimize', { method });
    return true;
  }

  function restore(method = 'api') {
    if (!state.open || !state.minimized) return false;
    state.minimized = false;
    writeStoredMinimized(false);
    panel.hidden = false;
    chip.hidden = true;
    renderAll();
    try { closeBtn.focus({ preventScroll: true }); } catch {}
    emitIntent('restore', { method });
    return true;
  }

  minBtn.addEventListener('click', () => minimize('button'));
  closeBtn.addEventListener('click', () => exit('button'));
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open && !state.minimized) exit('escape');
  });

  // ---------- selection + hover peek ----------
  function select(method = 'api') {
    state.selected = true;
    selectRing.visible = true;
    body.material.emissive = new THREE.Color(0x0a2a44);
    body.material.emissiveIntensity = 0.7;
    emitIntent('select', { method });
  }

  function deselect(method = 'api') {
    if (!state.selected) return;
    state.selected = false;
    selectRing.visible = false;
    body.material.emissive = new THREE.Color(0x000000);
    body.material.emissiveIntensity = 0;
    emitIntent('deselect', { method });
  }

  function showPeek(clientX, clientY, pinned = false) {
    const { total, locked } = peekSummary();
    peek.replaceChildren();
    const title = el('b', '', `${TOKEN_BLOCK_LABEL} · ${fmtFluff(total)}`);
    peek.appendChild(title);
    peek.appendChild(doc.createTextNode(` · spendable simulated${locked > 0 ? ` · ${formatSimAmount(locked)} locked` : ''}`));
    const hint = el('span', 'tkb-peek-hint', pinned
      ? 'Selected — double-click to enter the token world · drag to move'
      : 'Hover peek · click to select · double-click to enter · drag to move');
    peek.appendChild(hint);
    peek.hidden = false;
    root.hidden = false;
    const pad = 14;
    const rect = peek.getBoundingClientRect();
    let left = clientX + 16;
    let top = clientY + 18;
    const vw = doc.documentElement.clientWidth; const vh = doc.documentElement.clientHeight;
    if (left + rect.width > vw - pad) left = Math.max(pad, clientX - rect.width - 12);
    if (top + rect.height > vh - pad) top = Math.max(pad, clientY - rect.height - 12);
    peek.style.left = `${Math.round(left)}px`;
    peek.style.top = `${Math.round(top)}px`;
  }

  function hidePeek() {
    peek.hidden = true;
    if (!state.open && panel.hidden && chip.hidden && toastsEl.children.length === 0) root.hidden = true;
  }

  // ---------- pointer interaction ----------
  const tapDetector = createDoubleTapDetector({
    windowMs: DOUBLE_TAP_WINDOW_MS,
    distancePx: DOUBLE_TAP_DISTANCE_PX,
    onSingleTap: () => select('tap'),
    onDoubleTap: () => { select('double-tap'); enter('double-tap'); },
  });

  function setCanvasCursor(hit) {
    try { if (canvas) canvas.style.cursor = hit ? 'pointer' : ''; } catch {}
  }

  const onPointerMove = (event) => {
    if (downInfo?.active) {
      const dx = event.clientX - downInfo.x;
      const dy = event.clientY - downInfo.y;
      if (!state.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX && downInfo.hit) {
        state.dragging = true;
        tapDetector.reset();
      }
      if (state.dragging && downInfo.hit && camera) {
        const rect = canvas?.getBoundingClientRect?.();
        const w = rect?.width ?? 1; const h = rect?.height ?? 1;
        const x = rect ? event.clientX - rect.left : event.clientX;
        const y = rect ? event.clientY - rect.top : event.clientY;
        pointerNdc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
        raycaster.setFromCamera(pointerNdc, camera);
        if (raycaster.ray.intersectPlane(downInfo.plane, tmpVec)) {
          anchor.x = Math.max(-DRAG_BOUNDS.x, Math.min(DRAG_BOUNDS.x, tmpVec.x - downInfo.offset.x));
          anchor.y = Math.max(DRAG_BOUNDS.yMin, Math.min(DRAG_BOUNDS.yMax, tmpVec.y - downInfo.offset.y));
          anchor.z = Math.max(-DRAG_BOUNDS.z, Math.min(DRAG_BOUNDS.z, tmpVec.z - downInfo.offset.z));
          group.position.set(anchor.x, anchor.y, anchor.z);
        }
      }
      return;
    }
    if (!canvas || event.pointerType === 'touch') return;
    const hit = castAt(event.clientX, event.clientY);
    state.hovered = Boolean(hit);
    setCanvasCursor(hit);
    if (hit) showPeek(event.clientX, event.clientY, state.selected);
    else hidePeek();
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (!canvas) return;
    const hit = castAt(event.clientX, event.clientY);
    downInfo = { x: event.clientX, y: event.clientY, hit: Boolean(hit), active: true, plane: new THREE.Plane(), offset: new THREE.Vector3() };
    if (hit) {
      camera?.getWorldDirection?.(tmpVec);
      downInfo.plane.setFromNormalAndCoplanarPoint(tmpVec, hit.point);
      downInfo.offset.copy(hit.point).sub(group.position);
      setControlsEnabled(false);
      try { canvas.setPointerCapture?.(event.pointerId); } catch {}
    }
  };

  const endPointer = (event, cancelled = false) => {
    const wasDragging = state.dragging;
    const wasHit = downInfo?.hit === true;
    downInfo = null;
    state.dragging = false;
    setControlsEnabled(true);
    if (cancelled) return;
    if (wasDragging) {
      if (wasHit) {
        writeStoredPosition(anchor);
        emitIntent('move', { position: { ...anchor } });
      }
      return;
    }
    if (wasHit) {
      tapDetector.tap(TOKEN_BLOCK_ID, event);
    } else if (state.selected) {
      deselect('canvas');
      hidePeek();
    }
  };

  const onPointerUp = (event) => { if (downInfo?.active) endPointer(event, false); };
  const onPointerCancel = (event) => { if (downInfo?.active) endPointer(event, true); };

  if (canvas) {
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
  }

  // ---------- offline ----------
  function updateOffline() {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    offlineBar.hidden = !offline;
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', updateOffline);
    window.addEventListener('offline', updateOffline);
  }
  updateOffline();

  // ---------- live subscriptions ----------
  const refresh = () => { renderAll(); if (state.hovered && !peek.hidden) hidePeek(); };
  let unsubscribe = null;
  try { unsubscribe = facade?.on('*', refresh) ?? null; } catch {}
  const onTokenEvent = () => refresh();
  try { doc.addEventListener(TUMBO_TOKEN_EVENT, onTokenEvent); } catch {}

  // ---------- frame loop ----------
  let rafId = 0;
  let lastNow = 0;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  function tick(now) {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0.0001, (now - lastNow) / 1000 || 0.016));
    lastNow = now;
    const time = now / 1000;
    if (camTween && camera) {
      const k = Math.min(1, (now - camTween.start) / camTween.dur);
      const e = easeInOut(k);
      camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
      if (controls?.target) {
        controls.target.lerpVectors(camTween.fromTgt, camTween.toTgt, e);
        camera.lookAt(controls.target);
      }
      if (k >= 1) {
        const done = camTween.done;
        camTween = null;
        if (!state.dragging) setControlsEnabled(true);
        try { done?.(); } catch {}
      }
    }
    if (!reducedMotion && !state.dragging) {
      bobPhase += dt * 0.8;
      group.position.set(anchor.x, anchor.y + Math.sin(bobPhase) * 0.06, anchor.z);
      core.rotation.y += dt * 0.6;
      core.rotation.x = Math.sin(time * 0.5) * 0.2;
    } else if (!state.dragging) {
      group.position.set(anchor.x, anchor.y, anchor.z);
    }
    if (state.selected) {
      const pulse = 0.75 + Math.sin(time * 4) * 0.2;
      selectRing.material.opacity = Math.max(0.3, Math.min(1, pulse));
    }
  }
  if (typeof requestAnimationFrame === 'function') {
    lastNow = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  // ---------- public API ----------
  const api = {
    source: TOKEN_BLOCK_CONSOLE_SOURCE,
    id: TOKEN_BLOCK_ID,
    select,
    deselect,
    enter,
    exit,
    minimize,
    restore,
    setTab: (id) => setTab(id, 'api'),
    getAnchor: () => ({ ...anchor }),
    getSnapshot: () => ({
      source: TOKEN_BLOCK_CONSOLE_SOURCE,
      id: TOKEN_BLOCK_ID,
      selected: state.selected,
      open: state.open,
      minimized: state.minimized,
      tab: state.tab,
      position: { ...anchor },
      spendableFluff: spendableFluff(),
      lockedFluff: (() => { try { return ledger ? ledger.vault(TUMBO_TOKEN_DEFAULT_ACCOUNT, TUMBO_TOKEN_ASSET).totalLockedFluff : 0; } catch { return 0; } })(),
      receiptCount: (() => { try { return ledger ? ledger.history({ limit: 200 }).length : 0; } catch { return 0; } })(),
      facade: Boolean(facade),
      simulation: true,
    }),
    update: (dt, time) => {
      if (!reducedMotion && !state.dragging) {
        group.position.set(anchor.x, anchor.y + Math.sin(time * 0.8 + bobPhase) * 0.06, anchor.z);
      }
    },
    destroy: () => {
      try { cancelAnimationFrame(rafId); } catch {}
      try { unsubscribe?.(); } catch {}
      try { doc.removeEventListener(TUMBO_TOKEN_EVENT, onTokenEvent); } catch {}
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', updateOffline);
        window.removeEventListener('offline', updateOffline);
      }
      if (canvas) {
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
      }
      styleEl.remove();
      root.remove();
      parent?.remove(group);
      group.traverse((child) => {
        try { child.geometry?.dispose?.(); } catch {}
        try { child.material?.dispose?.(); } catch {}
      });
    },
  };

  renderAll();
  if (typeof window !== 'undefined') window.__TUMBO_TOKEN_BLOCK__ = api;
  return api;
}

export default createTokenBlock;
