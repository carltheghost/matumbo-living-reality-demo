/**
 * Infinite Burrow — TUMBO-SIM token gamification surface.
 *
 * A small translucent-blue glass cube lives in the 3D field from the first
 * frame. Hover peeks at hunger/score, single click selects, double
 * click/tap enters the burrow console, and the cube drags freely in 3D with
 * its position remembered in localStorage. The scrollable console shows the
 * Hunger Meter, daily Proof of Presence check-in, Burrow Score, Supporter
 * Ribbon claim, demo balances, a simulated ranked leaderboard, and recent
 * on-ledger activity.
 *
 * All 3D uses the repo-pinned three.js r179.1 import map. No other 3D
 * library, no raw WebGL, no CSS 3D fakes.
 *
 * Simulated points only — never real money or wagering.
 */

import * as THREE from "three";
import { ensureTumboToken, fmtFluff } from "../domains/token.js?v=20260922-cache2";
import {
  HUNGER_MAX,
  RIBBON_CAP,
  LEADERBOARD_SIZE,
} from "../domains/token-config.js?v=20260922-cache2";
import {
  GAMIFICATION_VERSION,
  SIM_BOUNDARY_NOTE,
  SIM_DAY_TICKS,
  createTokenGamification,
  seedDemoBurrow,
  presenceDayKey,
} from "../domains/token-gamification.js?v=20260922-cache2";

export const TOKEN_GAMIFICATION_CONSOLE_SOURCE = "token-gamification-console";
export const TOKEN_GAMIFICATION_VERSION = GAMIFICATION_VERSION;

const STYLE_ID = "tg-style";
const PANEL_ID = "tg-console";
const CHIP_ID = "tg-chip";
const PEEK_ID = "tg-peek";
const STORAGE_KEY = "tumbo.token-gamification.v1";
const DEMO_ACCOUNT = "u:guest";
const CUBE_SIZE = 0.5;
const DEFAULT_POSITION = Object.freeze({ x: 3.4, y: 1.5, z: 2.6 });
const POSITION_BOUNDS = Object.freeze({ x: 8, yMin: 0.4, yMax: 6, z: 8 });
const DOUBLE_TAP_MS = 350;
const DRAG_THRESHOLD_PX = 6;
const ACTIVITY_LIMIT = 12;

const CSS = `
#${PANEL_ID}{position:fixed;right:20px;top:145px;z-index:44;width:min(430px,calc(100vw - 40px));max-height:calc(100vh - 190px);display:flex;flex-direction:column;gap:10px;padding:15px;border:1px solid rgba(105,231,255,.32);border-radius:18px;background:linear-gradient(165deg,rgba(6,24,34,.96),rgba(3,8,14,.95));box-shadow:0 24px 80px rgba(0,0,0,.6),inset 0 0 42px rgba(65,205,255,.07);backdrop-filter:blur(20px);overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(105,231,255,.45) rgba(5,20,28,.7)}
#${PANEL_ID}[hidden]{display:none}
#${PANEL_ID} .tg-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
#${PANEL_ID} .tg-eyebrow{font-size:9px;letter-spacing:.2em;color:#7fe3f7;text-transform:uppercase}
#${PANEL_ID} h2{margin:4px 0 4px;font-size:20px;color:#e6fbff;letter-spacing:.01em}
#${PANEL_ID} p{margin:0;color:#a8c6cf;font-size:10px;line-height:1.42}
#${PANEL_ID} .tg-boundary{padding:7px 8px;border-left:2px solid rgba(255,194,139,.66);border-radius:0 7px 7px 0;background:rgba(121,75,40,.13);color:#dbc6af;font-size:9px;line-height:1.4}
#tg-close{appearance:none;flex:0 0 auto;min-width:44px;min-height:44px;border:1px solid rgba(157,219,240,.24);border-radius:8px;background:rgba(70,139,163,.12);color:#b2d8e4;font-size:16px;line-height:1;cursor:pointer;touch-action:manipulation}
#tg-close:hover,#tg-close:focus-visible{border-color:rgba(204,247,255,.72);color:#fff;outline:none}
#tg-status{padding:7px 8px;border-left:2px solid rgba(115,214,248,.54);border-radius:0 7px 7px 0;background:rgba(52,122,153,.12);color:#b9deea;font-size:8px;line-height:1.35;letter-spacing:.04em;overflow-wrap:anywhere}
.tg-section{display:grid;gap:7px;padding:10px;border:1px solid rgba(105,231,255,.14);border-radius:12px;background:rgba(7,26,35,.55)}
.tg-section h3{margin:0;color:#9ee6f5;font-size:8px;letter-spacing:.15em;text-transform:uppercase}
.tg-section .tg-note{color:#8fb0ba;font-size:9px;line-height:1.4;overflow-wrap:anywhere}
.tg-hunger-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
#tg-hunger-value{color:#e6fbff;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
#tg-hunger-state{color:#8fe1c7;font-size:8px;letter-spacing:.1em;text-transform:uppercase}
#tg-hunger-state[data-starved="true"]{color:#ffc7cc}
.tg-meter{height:10px;border-radius:999px;border:1px solid rgba(105,231,255,.25);background:rgba(3,10,15,.7);overflow:hidden}
#tg-hunger-fill{display:block;height:100%;width:100%;border-radius:999px;background:linear-gradient(90deg,#2fd08f,#8feaff);transition:width .25s ease}
#tg-hunger-fill[data-starved="true"]{background:linear-gradient(90deg,#d06a2f,#ffb08a)}
.tg-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tg-row .tg-inline{flex:1 1 auto;min-width:0;color:#9fc3cd;font-size:8px;line-height:1.35;letter-spacing:.03em;overflow-wrap:anywhere}
#${PANEL_ID} button.tg-btn{appearance:none;min-height:44px;border:1px solid rgba(130,221,249,.3);border-radius:9px;padding:8px 10px;background:rgba(42,137,167,.16);color:#d4f5ff;font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:rgba(142,240,255,.25);transition:.16s ease}
#${PANEL_ID} button.tg-btn:hover,#${PANEL_ID} button.tg-btn:focus-visible{border-color:rgba(199,246,255,.75);background:rgba(52,153,182,.32);outline:none;transform:translateY(-1px)}
#${PANEL_ID} button.tg-btn:disabled{opacity:.38;cursor:not-allowed;transform:none}
.tg-score-big{color:#e6fbff;font-size:30px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1}
#tg-score-breakdown{color:#8fb0ba;font-size:9px;line-height:1.4;overflow-wrap:anywhere}
.tg-bal-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.tg-bal-row span{color:#8fb0ba;font-size:8px;letter-spacing:.1em;text-transform:uppercase}
.tg-bal-row b{color:#e6fbff;font-size:13px;font-variant-numeric:tabular-nums}
.tg-toolbar{display:flex;gap:6px;flex-wrap:wrap}
.tg-toolbar .tg-btn{flex:1 1 0}
#tg-leaderboard,#tg-activity{display:grid;gap:4px;max-height:22vh;overflow-x:hidden;overflow-y:auto;padding-right:2px}
.tg-rank-row,.tg-act-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:6px 7px;border:1px solid rgba(105,231,255,.1);border-radius:7px;background:rgba(8,30,42,.6);font-size:9px}
.tg-rank-row .tg-rank{flex:0 0 auto;color:#ffd98a;font-weight:700;font-variant-numeric:tabular-nums}
.tg-rank-row .tg-who{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c9e9f0}
.tg-rank-row .tg-pts{flex:0 0 auto;color:#8fe1c7;font-variant-numeric:tabular-nums}
.tg-act-row .tg-act{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#b9dae4;letter-spacing:.03em;text-transform:uppercase}
.tg-act-row .tg-tick{flex:0 0 auto;color:#6f9aa6;font-size:8px;font-variant-numeric:tabular-nums}
.tg-empty{padding:8px;color:#8fb0ba;font-size:9px}
#${CHIP_ID}{position:fixed;right:20px;bottom:76px;z-index:45;appearance:none;min-height:44px;padding:10px 14px;border:1px solid rgba(105,231,255,.4);border-radius:999px;background:linear-gradient(180deg,rgba(4,11,17,.85),rgba(2,6,10,.6));color:#c8f7ff;font-size:10px;letter-spacing:.14em;font-weight:700;cursor:pointer;backdrop-filter:blur(12px);box-shadow:0 10px 30px rgba(0,0,0,.35);touch-action:manipulation}
#${CHIP_ID}[hidden]{display:none} #${CHIP_ID} .tg-chip-title{display:block;font-size:10px;letter-spacing:.14em;font-weight:700} #${CHIP_ID} .tg-chip-note{display:block;max-width:230px;margin:2px auto 0;font-size:8px;letter-spacing:.02em;font-weight:400;line-height:1.35;color:#dbc6af;white-space:normal}
#${CHIP_ID}:hover,#${CHIP_ID}:focus-visible{border-color:rgba(177,247,255,.75);color:#fff;outline:none}
#${PEEK_ID}{position:fixed;z-index:60;max-width:min(260px,calc(100vw - 40px));padding:9px 10px;border:1px solid rgba(122,230,255,.3);border-radius:12px;background:linear-gradient(165deg,rgba(4,17,25,.94),rgba(3,7,12,.92));box-shadow:0 14px 40px rgba(0,0,0,.5);backdrop-filter:blur(14px);pointer-events:none}
#${PEEK_ID}[hidden]{display:none}
#${PEEK_ID} .tg-peek-title{color:#e6fbff;font-size:10px;font-weight:700;letter-spacing:.06em}
#${PEEK_ID} .tg-peek-line{color:#9fc3cd;font-size:9px;line-height:1.4;margin-top:3px;font-variant-numeric:tabular-nums}
#${PEEK_ID} .tg-peek-boundary{color:#dbc6af;font-size:8px;line-height:1.35;margin-top:5px}
@media (max-width:480px){
#${PANEL_ID}{right:10px;top:118px;max-height:calc(100vh - 150px)}
#${CHIP_ID}{right:10px;bottom:14px}
}
`;

function makeEl(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function loadPosition() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    const z = Number(parsed?.z);
    if (![x, y, z].every(Number.isFinite)) return null;
    return { x, y, z };
  } catch {
    return null;
  }
}

function savePosition(position) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        x: Number(position.x.toFixed(3)),
        y: Number(position.y.toFixed(3)),
        z: Number(position.z.toFixed(3)),
      }),
    );
  } catch {
    /* storage is best-effort */
  }
}

function clampPosition(position) {
  return {
    x: Math.max(-POSITION_BOUNDS.x, Math.min(POSITION_BOUNDS.x, position.x)),
    y: Math.max(POSITION_BOUNDS.yMin, Math.min(POSITION_BOUNDS.yMax, position.y)),
    z: Math.max(-POSITION_BOUNDS.z, Math.min(POSITION_BOUNDS.z, position.z)),
  };
}

function uniqueIdem(prefix) {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `${prefix}-${rand}`;
}

/**
 * Mount the Infinite Burrow gamification surface.
 *
 * @param {object} options
 * @param {object} options.three three.js module (defaults to the import-map pin)
 * @param {THREE.Group} options.world parent for the cube (falls back to scene)
 * @param {THREE.PerspectiveCamera} options.camera needed for picking/dragging
 * @param {THREE.WebGLRenderer} options.renderer pointer host (falls back to the page canvas)
 * @param {object} [options.controls] OrbitControls-like handle, disabled while dragging
 */
export function mountTokenGamification({
  three = THREE,
  scene = null,
  world = null,
  camera = null,
  renderer = null,
  controls = null,
  documentRoot = null,
} = {}) {
  const doc =
    documentRoot ?? (typeof document !== "undefined" ? document : null);
  if (!doc?.createElement || !doc?.body) {
    throw new Error("token gamification needs a document");
  }
  const T = three ?? THREE;
  if (!T?.Group || !camera || !T?.Raycaster) {
    throw new Error("token gamification needs three.js and a camera");
  }
  const dom =
    renderer?.domElement ?? doc.querySelector("canvas") ?? doc.body;

  const token = ensureTumboToken({ documentRoot: doc });
  const gam = createTokenGamification({ ledger: token.ledger });
  try {
    token.ensureAccount(DEMO_ACCOUNT, "user", "Burrow guest");
  } catch {
    /* account helper is best-effort */
  }
  try {
    seedDemoBurrow(token.ledger);
  } catch {
    /* seeding is idempotent and best-effort */
  }

  const aborter = new AbortController();
  const on = (target, type, handler, options) =>
    target.addEventListener(type, handler, { ...(options ?? {}), signal: aborter.signal });

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  /* ---------------- console panel ---------------- */

  const panel = makeEl(doc, "section");
  panel.id = PANEL_ID;
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("aria-label", "Infinite Burrow token gamification console");

  const head = makeEl(doc, "div", "tg-head");
  const headCopy = makeEl(doc, "div");
  headCopy.append(
    makeEl(doc, "span", "tg-eyebrow", "TUMBO-SIM · Infinite Burrow"),
    makeEl(doc, "h2", null, "Token Gamification"),
    makeEl(doc, "p", null, "Feed the burrow with on-ledger activity, check in daily, and climb a simulated leaderboard."),
  );
  const closeBtn = makeEl(doc, "button", null, "\u00d7");
  closeBtn.id = "tg-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Minimize to chip");
  head.append(headCopy, closeBtn);

  const statusEl = makeEl(doc, "div", null, "Infinite Burrow ready · simulated.");
  statusEl.id = "tg-status";
  statusEl.setAttribute("role", "status");

  const boundaryHead = makeEl(doc, "p", "tg-boundary", SIM_BOUNDARY_NOTE);

  function section(title) {
    const node = makeEl(doc, "div", "tg-section");
    node.append(makeEl(doc, "h3", null, title));
    return node;
  }

  const hungerSection = section("Hunger Meter");
  const hungerRow = makeEl(doc, "div", "tg-hunger-row");
  const hungerValue = makeEl(doc, "b", null, `${HUNGER_MAX}/${HUNGER_MAX}`);
  hungerValue.id = "tg-hunger-value";
  const hungerState = makeEl(doc, "span", null, "FED");
  hungerState.id = "tg-hunger-state";
  hungerState.dataset.starved = "false";
  hungerRow.append(hungerValue, hungerState);
  const meter = makeEl(doc, "div", "tg-meter");
  const hungerFill = makeEl(doc, "div");
  hungerFill.id = "tg-hunger-fill";
  hungerFill.dataset.starved = "false";
  meter.append(hungerFill);
  const hungerNote = makeEl(doc, "p", "tg-note", "Fed by on-ledger activity: check-ins, tips, locks, market ops.");
  hungerNote.id = "tg-hunger-note";
  const dayBtn = makeEl(doc, "button", "tg-btn", "Simulate a day passing");
  dayBtn.id = "tg-day-btn";
  dayBtn.type = "button";
  hungerSection.append(hungerRow, meter, hungerNote, dayBtn);

  const presenceSection = section("Proof of Presence");
  presenceSection.append(
    makeEl(doc, "p", "tg-note", "One ledger-recorded check-in per account per day."),
  );
  const presenceRow = makeEl(doc, "div", "tg-row");
  const checkinBtn = makeEl(doc, "button", "tg-btn", "Check in today");
  checkinBtn.id = "tg-checkin-btn";
  checkinBtn.type = "button";
  const presenceStatus = makeEl(doc, "span", "tg-inline", "Not checked in yet.");
  presenceStatus.id = "tg-presence-status";
  presenceRow.append(checkinBtn, presenceStatus);
  presenceSection.append(presenceRow);

  const scoreSection = section("Burrow Score");
  const scoreValue = makeEl(doc, "div", "tg-score-big", "0");
  scoreValue.id = "tg-score-value";
  const scoreBreakdown = makeEl(doc, "p", null, "");
  scoreBreakdown.id = "tg-score-breakdown";
  scoreSection.append(
    scoreValue,
    scoreBreakdown,
    makeEl(doc, "p", "tg-note", "Pure function of ledger history: check-ins, tips, locks, ribbon."),
  );

  const ribbonSection = section("Supporter Ribbon");
  ribbonSection.append(
    makeEl(doc, "p", "tg-note", `Free · one per account · non-transferable · never monetized · cap ${RIBBON_CAP.toLocaleString("en-US")}.`),
  );
  const ribbonRow = makeEl(doc, "div", "tg-row");
  const ribbonBtn = makeEl(doc, "button", "tg-btn", "Claim ribbon");
  ribbonBtn.id = "tg-ribbon-btn";
  ribbonBtn.type = "button";
  const ribbonStatus = makeEl(doc, "span", "tg-inline", "Not claimed.");
  ribbonStatus.id = "tg-ribbon-status";
  ribbonRow.append(ribbonBtn, ribbonStatus);
  ribbonSection.append(ribbonRow);

  const balanceSection = section("Demo Balances");
  const balTumboRow = makeEl(doc, "div", "tg-bal-row");
  balTumboRow.append(makeEl(doc, "span", null, "TUMBO-SIM"));
  const balTumbo = makeEl(doc, "b", null, "0.000 TUMBO-SIM");
  balTumbo.id = "tg-bal-tumbo";
  balTumboRow.append(balTumbo);
  const balSmimasRow = makeEl(doc, "div", "tg-bal-row");
  balSmimasRow.append(makeEl(doc, "span", null, "sMIMAS"));
  const balSmimas = makeEl(doc, "b", null, "0.000 sMIMAS");
  balSmimas.id = "tg-bal-smimas";
  balSmimasRow.append(balSmimas);
  const balToolbar = makeEl(doc, "div", "tg-toolbar");
  const dripBtn = makeEl(doc, "button", "tg-btn", "Claim daily drip");
  dripBtn.id = "tg-drip-btn";
  dripBtn.type = "button";
  const tipBtn = makeEl(doc, "button", "tg-btn", "Tip 5 to Bramble");
  tipBtn.id = "tg-tip-btn";
  tipBtn.type = "button";
  balToolbar.append(dripBtn, tipBtn);
  balanceSection.append(
    balTumboRow,
    balSmimasRow,
    makeEl(doc, "p", "tg-note", "Drip: 50 TUMBO-SIM per account per simulated day, from the faucet."),
    balToolbar,
  );

  const boardSection = section(`Leaderboard · simulated (top ${LEADERBOARD_SIZE})`);
  const boardList = makeEl(doc, "div");
  boardList.id = "tg-leaderboard";
  boardSection.append(boardList);

  const activitySection = section("Recent activity");
  const activityList = makeEl(doc, "div");
  activityList.id = "tg-activity";
  activitySection.append(activityList);

  const boundaryFoot = makeEl(doc, "p", "tg-boundary", SIM_BOUNDARY_NOTE);

  panel.append(
    head,
    boundaryHead,
    statusEl,
    hungerSection,
    presenceSection,
    scoreSection,
    ribbonSection,
    balanceSection,
    boardSection,
    activitySection,
    boundaryFoot,
  );
  doc.body.appendChild(panel);

  const chip = makeEl(doc, "button"); chip.append(makeEl(doc, "span", "tg-chip-title", "Burrow"), makeEl(doc, "span", "tg-chip-note", SIM_BOUNDARY_NOTE));
  chip.id = CHIP_ID;
  chip.type = "button";
  chip.hidden = true;
  chip.setAttribute("aria-label", "Open the Infinite Burrow console");
  doc.body.appendChild(chip);

  const peek = makeEl(doc, "div");
  peek.id = PEEK_ID;
  peek.hidden = true;
  peek.append(
    makeEl(doc, "div", "tg-peek-title", "Infinite Burrow"),
    makeEl(doc, "div", "tg-peek-line", ""),
    makeEl(doc, "div", "tg-peek-boundary", SIM_BOUNDARY_NOTE),
  );
  const peekLine = peek.querySelector(".tg-peek-line");
  doc.body.appendChild(peek);

  /* ---------------- 3D cube ---------------- */

  const group = new T.Group();
  group.name = "infinite-burrow-cube";
  const inner = new T.Group();
  group.add(inner);
  const geo = new T.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  const glass = new T.MeshPhysicalMaterial({
    color: 0x69e7ff,
    transmission: 0.72,
    transparent: true,
    opacity: 0.34,
    roughness: 0.08,
    metalness: 0.08,
    thickness: 0.7,
    ior: 1.32,
    emissive: 0x0e3d4d,
    emissiveIntensity: 0.35,
  });
  const cubeMesh = new T.Mesh(geo, glass);
  cubeMesh.userData.burrowCube = true;
  const edges = new T.LineSegments(
    new T.EdgesGeometry(geo),
    new T.LineBasicMaterial({ color: 0x8feaff, transparent: true, opacity: 0.9 }),
  );
  const core = new T.Mesh(
    new T.BoxGeometry(0.16, 0.16, 0.16),
    new T.MeshStandardMaterial({
      color: 0x9ff3ff,
      emissive: 0x35d5f2,
      emissiveIntensity: 2.2,
      metalness: 0.2,
      roughness: 0.3,
    }),
  );
  core.userData.burrowCube = true;
  inner.add(cubeMesh, edges, core);
  const startPos = clampPosition(loadPosition() ?? { ...DEFAULT_POSITION });
  group.position.set(startPos.x, startPos.y, startPos.z);
  const cubeParent = world ?? scene; cubeParent?.add(group); const tetherGeo = new T.BufferGeometry(); tetherGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(6), 3)); const tether = new T.Line(tetherGeo, new T.LineBasicMaterial({ color: 0x69e7ff, transparent: true, opacity: 0.45 })); tether.frustumCulled = false; cubeParent?.add(tether); function updateTether() { const p = tetherGeo.attributes.position; p.setXYZ(0, group.position.x, group.position.y - CUBE_SIZE / 2, group.position.z); p.setXYZ(1, group.position.x, 0, group.position.z); p.needsUpdate = true; } updateTether();

  const pickTargets = [cubeMesh, core];
  const raycaster = new T.Raycaster();
  const ndc = new T.Vector2();
  const dragPlane = new T.Plane();
  const hitPoint = new T.Vector3();
  const camDir = new T.Vector3();

  let opened = false;
  let selected = false;
  let hovered = false;
  let disposed = false;
  let pointerDown = null;
  let dragging = false;
  let lastTap = null;
  let peekPinnedUntil = 0;
  let lastPeekEvent = null;
  const reducedMotion =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setStatus(message) {
    statusEl.textContent = String(message);
  }

  function setNdc(event) {
    const rect = dom.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 1, height: 1 };
    ndc.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
  }

  function hitsCube(event) {
    setNdc(event);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(pickTargets, false).length > 0;
  }

  function showPeek(event) {
    if (event) lastPeekEvent = { clientX: event.clientX, clientY: event.clientY };
    const snap = gam.snapshot(DEMO_ACCOUNT);
    peekLine.textContent = `Hunger ${snap.hunger}/${HUNGER_MAX} · Score ${snap.score.total} pts`;
    peek.hidden = false;
    const x = Math.min(
      (lastPeekEvent?.clientX ?? 0) + 14,
      Math.max(8, innerWidth - 280),
    );
    const y = Math.min(
      (lastPeekEvent?.clientY ?? 0) + 14,
      Math.max(8, innerHeight - 120),
    );
    peek.style.left = `${Math.max(8, x)}px`;
    peek.style.top = `${Math.max(8, y)}px`;
  }

  function showPeekPinned() {
    peekPinnedUntil = Date.now() + 2500;
    showPeek(null);
  }

  function hidePeek() {
    if (Date.now() < peekPinnedUntil) return;
    peek.hidden = true;
  }

  function setSelected(next, method = "tap") {
    selected = Boolean(next);
    const scale = selected ? 1.18 : 1;
    inner.scale.setScalar(scale);
    edges.material.opacity = selected ? 1 : 0.9;
    if (selected) {
      showPeekPinned();
      setStatus("Burrow cube selected — double-click to enter the burrow.");
    } else if (method !== "hover") {
      hidePeek();
    }
  }

  function setOpen(next, method = "button") {
    opened = Boolean(next);
    panel.hidden = !opened;
    chip.hidden = opened;
    panel.setAttribute("aria-hidden", String(!opened));
    if (opened) {
      refresh();
      if (method === "double-click") {
        setStatus("Entered the Infinite Burrow · simulated.");
      }
    }
  }

  function refresh() {
    if (disposed) return;
    let snap;
    try {
      snap = gam.snapshot(DEMO_ACCOUNT);
    } catch {
      return;
    }
    hungerValue.textContent = `${snap.hunger}/${HUNGER_MAX}`;
    hungerFill.style.width = `${Math.max(0, Math.min(100, snap.hunger))}%`;
    hungerFill.dataset.starved = String(snap.starved);
    hungerState.dataset.starved = String(snap.starved);
    hungerState.textContent = snap.starved ? "STARVING" : "FED";
    hungerNote.textContent = snap.starved
      ? "Starving: simulated rewards dip 5%. Principal is never touched."
      : "Fed by on-ledger activity: check-ins, tips, locks, market ops.";
    presenceStatus.textContent = snap.presenceToday
      ? `Checked in for day ${snap.day}.`
      : `Not checked in for day ${snap.day}.`;
    checkinBtn.disabled = snap.presenceToday;
    scoreValue.textContent = String(snap.score.total);
    const parts = [
      `${snap.score.checkins} check-in${snap.score.checkins === 1 ? "" : "s"}`,
      `${snap.score.tipTumbo} TUMBO-SIM tipped`,
      `${snap.score.lockTumbo} TUMBO-SIM locked`,
    ];
    if (snap.score.ribbonBonus) parts.push("ribbon bonus");
    scoreBreakdown.textContent = parts.join(" · ");
    ribbonStatus.textContent = snap.ribbon
      ? `Claimed ${snap.ribbon} · ${snap.ribbonsClaimed.toLocaleString("en-US")}/${snap.ribbonCap.toLocaleString("en-US")} claimed`
      : `${snap.ribbonsClaimed.toLocaleString("en-US")}/${snap.ribbonCap.toLocaleString("en-US")} claimed · free · one per account`;
    ribbonBtn.disabled = Boolean(snap.ribbon);
    try {
      balTumbo.textContent = `${fmtFluff(token.balance(DEMO_ACCOUNT, "TUMBO"))} TUMBO-SIM`;
      balSmimas.textContent = `${fmtFluff(token.balance(DEMO_ACCOUNT, "sMIMAS"))} sMIMAS`;
    } catch {
      /* balances are best-effort */
    }
    boardList.replaceChildren();
    let board = [];
    try {
      board = gam.leaderboard();
    } catch {
      board = [];
    }
    if (!board.length) {
      boardList.append(makeEl(doc, "div", "tg-empty", "No simulated burrow-mates yet."));
    }
    for (const row of board) {
      const item = makeEl(doc, "div", "tg-rank-row");
      item.append(
        makeEl(doc, "span", "tg-rank", `#${row.rank}`),
        makeEl(doc, "span", "tg-who", row.account),
        makeEl(doc, "span", "tg-pts", `${row.score} pts`),
      );
      if (row.account === DEMO_ACCOUNT) item.style.borderColor = "rgba(255,217,138,.5)";
      boardList.append(item);
    }
    activityList.replaceChildren();
    let receipts = [];
    try {
      receipts = token.ledger.receipts().slice(-ACTIVITY_LIMIT).reverse();
    } catch {
      receipts = [];
    }
    if (!receipts.length) {
      activityList.append(makeEl(doc, "div", "tg-empty", "No on-ledger activity yet."));
    }
    for (const receipt of receipts) {
      const item = makeEl(doc, "div", "tg-act-row");
      item.append(
        makeEl(doc, "span", "tg-act", `${receipt.action} · ${receipt.actor ?? "—"}`),
        makeEl(doc, "span", "tg-tick", `tick ${receipt.tick}`),
      );
      activityList.append(item);
    }
  }

  /* ---------------- actions ---------------- */

  function runAction(label, fn) {
    let result;
    try {
      result = fn();
    } catch (error) {
      setStatus(`${label}: ${error?.message ?? "unavailable"}`);
      return null;
    }
    refresh();
    return result;
  }

  on(checkinBtn, "click", () =>
    runAction("Check-in", () => {
      const receipt = gam.checkIn(
        DEMO_ACCOUNT,
        presenceDayKey(DEMO_ACCOUNT, token.ledger.day),
      );
      setStatus(`Checked in for day ${receipt.meta.day} · receipt ${receipt.id} · simulated.`);
      return receipt;
    }),
  );

  on(ribbonBtn, "click", () =>
    runAction("Ribbon", () => {
      const receipt = gam.claimRibbon(DEMO_ACCOUNT, `tg-ribbon-${DEMO_ACCOUNT}`);
      setStatus(`Supporter ribbon claimed: ${receipt.meta.ribbonId} · free · simulated.`);
      return receipt;
    }),
  );

  on(dripBtn, "click", () =>
    runAction("Drip", () => {
      const receipt = token.drip(
        DEMO_ACCOUNT,
        "TUMBO",
        uniqueIdem(`tg-drip-${DEMO_ACCOUNT}-day${token.ledger.day}`),
      );
      setStatus(`Daily drip claimed: ${fmtFluff(receipt.refs.amount)} TUMBO-SIM · simulated.`);
      return receipt;
    }),
  );

  on(tipBtn, "click", () =>
    runAction("Tip", () => {
      const receipt = token.act(
        "tip",
        { from: DEMO_ACCOUNT, to: "b:bramble", asset: "TUMBO", amount: 5000 },
        uniqueIdem("tg-tip-bramble"),
      );
      setStatus("Tipped 5 TUMBO-SIM to Bramble · simulated.");
      return receipt;
    }),
  );

  on(dayBtn, "click", () =>
    runAction("Day", () => {
      token.ledger.advanceTicks(SIM_DAY_TICKS);
      const day = token.ledger.advanceDay();
      const receipt = gam.applyDecay(DEMO_ACCOUNT, uniqueIdem(`tg-decay-${DEMO_ACCOUNT}-day${day}`));
      setStatus(`A simulated day passed (day ${day}) · hunger ${receipt.meta.from} → ${receipt.meta.to}.`);
      return receipt;
    }),
  );

  on(closeBtn, "click", () => setOpen(false, "minimize"));
  on(chip, "click", () => setOpen(true, "chip"));
  on(doc, "keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false, "escape");
  });
  const offReceipt = token.on("receipt", () => {
    if (opened) refresh();
  });

  /* ---------------- pointer interaction ---------------- */

  on(dom, "pointermove", (event) => {
    if (disposed || pointerDown?.dragging) return;
    if (pointerDown) {
      const dx = event.clientX - pointerDown.x;
      const dy = event.clientY - pointerDown.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX && pointerDown.onCube) {
        pointerDown.dragging = true;
        dragging = true;
        if (controls) controls.enabled = false;
        camera.getWorldDirection(camDir);
        dragPlane.setFromNormalAndCoplanarPoint(camDir, group.position);
        setStatus("Dragging the burrow cube in 3D · position remembered.");
      }
    }
    if (pointerDown?.dragging) {
      setNdc(event);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
        group.position.copy(clampPosition(hitPoint)); updateTether();
      }
      return;
    }
    if (pointerDown) return;
    const hit = hitsCube(event);
    if (hit !== hovered) {
      hovered = hit;
      dom.style.cursor = hit ? "pointer" : "";
      if (hit) showPeek(event);
      else hidePeek();
    } else if (hit) {
      showPeek(event);
    }
  });

  on(dom, "pointerdown", (event) => {
    if (disposed || event.button !== 0) return;
    const onCube = hitsCube(event);
    pointerDown = {
      x: event.clientX,
      y: event.clientY,
      onCube,
      dragging: false,
      pointerId: event.pointerId,
    };
  });

  function endPointer(event, cancelled) {
    const gesture = pointerDown;
    pointerDown = null;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const wasDragging = gesture.dragging;
    if (wasDragging) {
      dragging = false;
      if (controls) controls.enabled = true;
      savePosition(group.position);
      setStatus(
        `Burrow cube parked at ${group.position.x.toFixed(1)}, ${group.position.y.toFixed(1)}, ${group.position.z.toFixed(1)} · remembered.`,
      );
      return;
    }
    if (cancelled) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) return;
    if (!gesture.onCube) {
      if (selected) setSelected(false, "tap-empty");
      return;
    }
    const now = Date.now();
    const quickSecond =
      lastTap &&
      now - lastTap.time <= DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= 28;
    lastTap = { time: now, x: event.clientX, y: event.clientY };
    if (quickSecond) {
      lastTap = null;
      setSelected(true, "double-tap");
      setOpen(true, "double-click");
      return;
    }
    setSelected(!selected, "tap");
  }

  on(dom, "pointerup", (event) => endPointer(event, false));
  on(dom, "pointercancel", (event) => endPointer(event, true));
  on(dom, "dblclick", (event) => {
    if (disposed) return;
    if (hitsCube(event)) {
      setSelected(true, "double-click");
      setOpen(true, "double-click");
    }
  });
  on(dom, "pointerleave", () => {
    hovered = false;
    hidePeek();
  });

  /* ---------------- idle motion ---------------- */

  let rafId = 0;
  let lastFrame = 0;
  function frame(now) {
    if (disposed) return;
    rafId = requestAnimationFrame(frame);
    if (reducedMotion) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    core.rotation.y += dt * 0.9;
    core.rotation.x += dt * 0.35;
    inner.position.y = Math.sin(now / 1400) * 0.05; updateTether();
  }
  if (!reducedMotion) rafId = requestAnimationFrame(frame);

  function getSnapshot() {
    let snap = null;
    try {
      snap = gam.snapshot(DEMO_ACCOUNT);
    } catch {
      snap = null;
    }
    return Object.freeze({
      source: TOKEN_GAMIFICATION_CONSOLE_SOURCE,
      version: TOKEN_GAMIFICATION_VERSION,
      opened,
      selected,
      position: Object.freeze({
        x: Number(group.position.x.toFixed(3)),
        y: Number(group.position.y.toFixed(3)),
        z: Number(group.position.z.toFixed(3)),
      }),
      hunger: snap?.hunger ?? null,
      score: snap?.score?.total ?? null,
      ribbon: snap?.ribbon ?? null,
      rank: snap?.rank ?? null,
      simulation: true,
      boundary: SIM_BOUNDARY_NOTE,
      localOnly: true,
    });
  }

  function destroy() {
    disposed = true;
    aborter.abort();
    try {
      offReceipt?.();
    } catch {
      /* ignore */
    }
    if (rafId) cancelAnimationFrame(rafId);
    try {
      gam.destroy();
    } catch {
      /* ignore */
    }
    try {
      group.parent?.remove(group); tether.parent?.remove(tether);
    } catch {
      /* ignore */
    }
    geo.dispose();
    edges.geometry.dispose();
    glass.dispose();
    edges.material.dispose();
    core.geometry.dispose();
    core.material.dispose(); tetherGeo.dispose(); tether.material.dispose();
    panel.remove();
    chip.remove();
    peek.remove();
  }

  return Object.freeze({
    open: (method = "api") => setOpen(true, method),
    close: (method = "api") => setOpen(false, method),
    toggle: (method = "api") => setOpen(!opened, method),
    refresh,
    getSnapshot,
    destroy,
    cube: group,
    token,
    gamification: gam,
  });
}

export const mountInfiniteBurrow = mountTokenGamification;
export default mountTokenGamification;
