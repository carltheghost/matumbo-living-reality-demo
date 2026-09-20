// ============================================================================
// TUMBO-SIM Token Vault — glass-cube console UI
// ----------------------------------------------------------------------------
// Self-mounting demo console for src/domains/token.js. Importing this module
// mounts a small translucent chip (draggable, position remembered); single
// click opens the vault panel, double-click enters the 3D block view.
//
// ALL 3D uses the repo's pinned three.js r179.1 via the "three" import map,
// with the shared glass-cube look (translucent blue glass cubes + connection
// lines) from src/render/glass-style.js. No other 3D library, no raw WebGL
// for new geometry, no CSS-3D fakes for cubes.
//
// Simulated TUMBO-SIM points only — never real money. The UI labels itself
// simulated on every surface.
// ============================================================================

import * as THREE from 'three';
import { makeGlassCube, makeConnectionLines, addGlassLighting, glassTintFor } from '../render/glass-style.js';
import { attachTokenVault, fmtTokenFluff, parseTumboSim } from './token.js';

const VAULT_USER = 'u:you';
const STORE_KEY = 'tumbo:vault:ui:v1';
const TINT = glassTintFor('token');
const LINE_COLOR = 0x7fc8ff;
const Z = 9000;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

let engine = null;
function getEngine() {
  if (engine) return engine;
  const w = typeof window !== 'undefined' ? window : {};
  const prior = w.TumboToken && w.TumboToken.tokenVault;
  if (prior) { engine = prior; return engine; }
  const facade = attachTokenVault(w.TumboToken, {
    initialGrants: [
      { to: VAULT_USER, asset: 'TUMBO', amountFluff: 250000 },
      { to: VAULT_USER, asset: 'sMIMAS', amountFluff: 100000 },
    ],
  });
  if (typeof window !== 'undefined' && !window.TumboToken) window.TumboToken = facade;
  engine = facade.tokenVault;
  return engine;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}
function saveStore(patch) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadStore(), ...patch })); }
  catch { /* private mode */ }
}
function el(tag, cls, html) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html !== undefined) d.innerHTML = html;
  return d;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
const newKey = () => (typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function injectStyles() {
  if (document.getElementById('tv-styles')) return;
  const st = document.createElement('style');
  st.id = 'tv-styles';
  st.textContent = `
  .tv-chip{position:fixed;z-index:${Z};display:flex;flex-direction:column;align-items:center;gap:2px;
    padding:8px 10px 6px;border-radius:14px;cursor:grab;user-select:none;
    background:rgba(18,38,76,.55);border:1px solid rgba(140,200,255,.35);
    backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    box-shadow:0 6px 24px rgba(40,120,220,.25);color:#dff1ff;
    font:600 10px/1.2 system-ui,sans-serif;letter-spacing:.08em;touch-action:none}
  .tv-chip:active{cursor:grabbing}
  .tv-chip canvas{width:52px;height:52px;display:block}
  .tv-chip-tick{font-weight:400;opacity:.75;letter-spacing:.04em}
  .tv-peek{position:fixed;z-index:${Z};pointer-events:none;max-width:250px;padding:10px 12px;border-radius:12px;
    background:rgba(14,30,62,.92);border:1px solid rgba(140,200,255,.35);color:#dff1ff;
    font:400 11px/1.5 system-ui,sans-serif;box-shadow:0 8px 28px rgba(40,120,220,.3)}
  .tv-peek b{color:#9fdcff}
  .tv-panel{position:fixed;z-index:${Z};width:392px;max-width:calc(100vw - 24px);max-height:min(78vh,720px);
    display:flex;flex-direction:column;border-radius:16px;overflow:hidden;color:#dff1ff;
    background:rgba(16,34,70,.72);border:1px solid rgba(140,200,255,.4);
    backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
    box-shadow:0 12px 44px rgba(30,110,210,.35);font:400 12px/1.5 system-ui,sans-serif}
  .tv-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:grab;
    background:rgba(30,70,140,.35);border-bottom:1px solid rgba(140,200,255,.25)}
  .tv-title{font-weight:700;font-size:12px;letter-spacing:.1em}
  .tv-sim{font-weight:400;font-size:10px;opacity:.7;letter-spacing:.06em;border:1px solid rgba(140,200,255,.4);
    border-radius:20px;padding:1px 8px;margin-left:6px}
  .tv-btn{background:rgba(90,160,255,.16);border:1px solid rgba(140,200,255,.4);color:#dff1ff;
    border-radius:8px;padding:4px 10px;font:600 11px system-ui,sans-serif;cursor:pointer}
  .tv-btn:hover{background:rgba(90,160,255,.32)}
  .tv-btn:disabled{opacity:.4;cursor:default}
  .tv-err{margin:8px 12px 0;padding:8px 10px;border-radius:8px;font-size:11px;
    background:rgba(180,40,60,.25);border:1px solid rgba(255,120,140,.5);color:#ffd9de}
  .tv-body{overflow-y:auto;padding:4px 12px 12px;scrollbar-width:thin}
  .tv-body h3{font-size:10px;letter-spacing:.12em;opacity:.75;margin:14px 0 8px;font-weight:700}
  .tv-kv{display:flex;justify-content:space-between;padding:3px 0;font-size:12px}
  .tv-kv b{color:#9fdcff;font-weight:600}
  .tv-ok{color:#8df0b3}.tv-bad{color:#ff9aa8}
  .tv-form{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;padding:8px;border-radius:10px;
    background:rgba(40,90,170,.14);border:1px solid rgba(140,200,255,.2)}
  .tv-form .tv-flabel{grid-column:1/-1;font-size:10px;letter-spacing:.1em;opacity:.7;font-weight:700}
  .tv-in,.tv-sel{background:rgba(10,24,52,.7);border:1px solid rgba(140,200,255,.35);color:#dff1ff;
    border-radius:8px;padding:6px 8px;font:400 12px system-ui,sans-serif;width:100%;box-sizing:border-box}
  .tv-form .tv-btn{grid-column:1/-1}
  .tv-row{display:flex;align-items:center;gap:8px;padding:7px 8px;margin-bottom:6px;border-radius:10px;
    background:rgba(40,90,170,.12);border:1px solid rgba(140,200,255,.18);font-size:11px}
  .tv-row .tv-grow{flex:1;min-width:0}
  .tv-row .tv-id{font-weight:700;color:#9fdcff}
  .tv-row .tv-sub{opacity:.7;font-size:10px}
  .tv-log{max-height:150px;overflow-y:auto;font:400 10.5px/1.6 ui-monospace,monospace;
    background:rgba(8,18,40,.5);border-radius:8px;padding:8px;scrollbar-width:thin}
  .tv-log div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tv-foot{margin-top:12px;font-size:10px;opacity:.6;text-align:center}
  .tv-3d{position:fixed;inset:0;z-index:${Z + 1};background:rgba(6,14,32,.86);
    backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
  .tv-3d canvas{width:100%;height:100%;display:block;touch-action:none}
  .tv-3d-top{position:absolute;top:14px;left:16px;right:16px;display:flex;justify-content:space-between;
    align-items:center;pointer-events:none;color:#dff1ff;font:600 12px system-ui,sans-serif;letter-spacing:.08em}
  .tv-3d-top .tv-btn{pointer-events:auto}
  .tv-3d-info{position:absolute;left:16px;bottom:16px;max-width:min(340px,80vw);padding:10px 12px;border-radius:12px;
    background:rgba(14,30,62,.9);border:1px solid rgba(140,200,255,.35);color:#dff1ff;
    font:400 11px/1.6 system-ui,sans-serif}
  .tv-3d-hint{position:absolute;bottom:16px;right:16px;color:#9fdcff;opacity:.75;
    font:400 10px system-ui,sans-serif;letter-spacing:.06em}
  @media (max-width:480px){
    .tv-panel{width:auto;left:12px;right:12px}
    .tv-chip{padding:6px 8px 4px}
    .tv-chip canvas{width:40px;height:40px}
  }`;
  document.head.appendChild(st);
}

// ---------------------------------------------------------------------------
// Refresh plumbing
// ---------------------------------------------------------------------------

let refreshQueued = false;
let ui = null;
function scheduleRefresh() {
  if (refreshQueued || !ui) return;
  refreshQueued = true;
  requestAnimationFrame(() => { refreshQueued = false; try { refreshUI(); } catch { /* never */ } });
}

function showError(msg) {
  if (!ui) return;
  ui.err.hidden = false;
  ui.err.textContent = msg;
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { ui.err.hidden = true; }, 6000);
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

function makeDraggable(node, handle, storeSlot) {
  const pos = loadStore()[storeSlot];
  if (pos && typeof pos.left === 'string' && pos.left.endsWith('px')) {
    node.style.left = pos.left;
    node.style.top = pos.top;
    node.style.right = 'auto';
    node.style.bottom = 'auto';
  }
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false, moved = 0;
  const target = handle || node;
  target.addEventListener('pointerdown', (e) => {
    dragging = true; moved = 0;
    const r = node.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    try { target.setPointerCapture(e.pointerId); } catch { /* never */ }
  });
  target.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
    if (moved > 4) {
      node.style.left = `${Math.min(Math.max(0, ox + dx), window.innerWidth - 60)}px`;
      node.style.top = `${Math.min(Math.max(0, oy + dy), window.innerHeight - 40)}px`;
      node.style.right = 'auto';
      node.style.bottom = 'auto';
    }
  });
  target.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    if (moved > 4) saveStore({ [storeSlot]: { left: node.style.left, top: node.style.top } });
  });
}

function buildChip(eng) {
  const chip = el('div', 'tv-chip');
  chip.setAttribute('data-vault-chip', '');
  chip.title = 'Hibernation Vault (simulated) — click to open, double-click for 3D';
  const cv = document.createElement('canvas');
  cv.width = 104; cv.height = 104;
  const label = el('div', null, 'VAULT');
  const tick = el('div', 'tv-chip-tick', 'tick 0');
  chip.append(cv, label, tick);
  chip.style.right = '18px';
  chip.style.bottom = '18px';
  document.body.appendChild(chip);
  makeDraggable(chip, null, 'chip');

  // mini glass cube
  try {
    const renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
    renderer.setSize(52, 52, false);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
    cam.position.set(0, 0.4, 3.1); cam.lookAt(0, 0, 0);
    addGlassLighting(THREE, scene);
    const cube = makeGlassCube(THREE, 0.95, TINT);
    scene.add(cube);
    const spin = () => {
      cube.rotation.y += 0.012; cube.rotation.x += 0.004;
      renderer.render(scene, cam);
      requestAnimationFrame(spin);
    };
    spin();
  } catch { /* chip still works without the cube */ }

  // peek on hover
  let peek = null;
  chip.addEventListener('mouseenter', () => {
    peek = el('div', 'tv-peek', peekHtml(eng));
    const r = chip.getBoundingClientRect();
    peek.style.right = `${Math.max(8, window.innerWidth - r.left + 8)}px`;
    peek.style.bottom = `${Math.max(8, window.innerHeight - r.top + 8)}px`;
    document.body.appendChild(peek);
  });
  chip.addEventListener('mouseleave', () => { if (peek) { peek.remove(); peek = null; } });

  let clickTimer = null;
  chip.addEventListener('click', () => {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => openPanel(), 280);
  });
  chip.addEventListener('dblclick', (e) => {
    e.preventDefault();
    clearTimeout(clickTimer);
    open3D();
  });
  ui.chip = chip;
  ui.chipTick = tick;
}

function peekHtml(eng) {
  try {
    const open = eng.openPositions({ owner: VAULT_USER });
    return `<b>Hibernation Vault</b> · simulated<br>` +
      `tick ${eng.tick()} · ${open.length} open position${open.length === 1 ? '' : 's'}<br>` +
      `TUMBO ${esc(fmtTokenFluff(eng.balance(VAULT_USER, 'TUMBO')))}<br>` +
      `sMIMAS ${esc(fmtTokenFluff(eng.balance(VAULT_USER, 'sMIMAS')))}`;
  } catch { return 'Hibernation Vault · simulated'; }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function assetOptions(sel) {
  return ['TUMBO', 'sMIMAS'].map((a) =>
    `<option value="${a}"${a === sel ? ' selected' : ''}>${a}</option>`).join('');
}

function buildPanel(eng) {
  const panel = el('div', 'tv-panel');
  panel.setAttribute('data-vault-panel', '');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="tv-head">
      <div class="tv-title">HIBERNATION VAULT<span class="tv-sim">simulated</span></div>
      <div class="tv-head-btns">
        <button class="tv-btn" data-act="3d" title="Open 3D block view">3D</button>
        <button class="tv-btn" data-act="min" title="Minimize to chip">–</button>
      </div>
    </div>
    <div class="tv-err" hidden></div>
    <div class="tv-body">
      <section><h3>STATUS</h3><div class="tv-status"></div></section>
      <section><h3>STAKE · LOCK · DEPOSIT · SAVE</h3><div class="tv-forms"></div></section>
      <section><h3>OPEN POSITIONS</h3><div class="tv-positions"></div></section>
      <section><h3>SAVINGS POCKETS</h3><div class="tv-pockets"></div></section>
      <section><h3>TICK</h3><div class="tv-tickrow"></div></section>
      <section><h3>RECEIPTS</h3><div class="tv-log"></div></section>
      <div class="tv-foot">Simulated TUMBO-SIM points · not real money · not a wallet</div>
    </div>`;
  document.body.appendChild(panel);
  const q = (s) => panel.querySelector(s);
  ui.panel = panel;
  ui.err = q('.tv-err');
  ui.status = q('.tv-status');
  ui.forms = q('.tv-forms');
  ui.positions = q('.tv-positions');
  ui.pockets = q('.tv-pockets');
  ui.tickrow = q('.tv-tickrow');
  ui.log = q('.tv-log');
  panel.style.right = '18px';
  panel.style.bottom = '18px';
  makeDraggable(panel, q('.tv-head'), 'panel');

  q('[data-act="min"]').addEventListener('click', () => { panel.hidden = true; });
  q('[data-act="3d"]').addEventListener('click', () => { panel.hidden = true; open3D(); });

  buildForms(eng);
  buildTickRow(eng);
}

function buildForms(eng) {
  const f = ui.forms;
  f.innerHTML = '';
  const mk = (title, fieldsHtml, btnLabel, onGo) => {
    const box = el('div', 'tv-form');
    box.innerHTML = `<div class="tv-flabel">${title}</div>${fieldsHtml}<button class="tv-btn">${btnLabel}</button>`;
    box.querySelector('.tv-btn').addEventListener('click', () => {
      try {
        const vals = [...box.querySelectorAll('[data-f]')].map((n) => n.value);
        onGo(vals);
      } catch (err) { showError(err && err.message ? err.message : String(err)); }
    });
    f.appendChild(box);
  };
  const amt = (ph) => `<input class="tv-in" data-f placeholder="${ph || 'amount (TUMBO-SIM)'}">`;
  const asset = `<select class="tv-sel" data-f>${assetOptions('TUMBO')}</select>`;
  mk('STAKE — flexible, earns simulated rewards', `${asset}${amt()}`, 'Stake', ([a, amount]) => {
    eng.stake({ from: VAULT_USER, asset: a, amountFluff: parseTumboSim(amount), idempotencyKey: newKey() });
    scheduleRefresh();
  });
  mk('LOCK — fixed term, withdraw at/after unlock tick', `${asset}${amt()}<input class="tv-in" data-f placeholder="unlock tick (e.g. 120)">`, 'Lock', ([a, amount, tickStr]) => {
    const t = Number(tickStr);
    if (!Number.isSafeInteger(t) || t <= eng.tick()) throw new Error('unlock tick must be an integer after the current tick');
    eng.lock({ from: VAULT_USER, asset: a, amountFluff: parseTumboSim(amount), unlockTick: t, idempotencyKey: newKey() });
    scheduleRefresh();
  });
  mk('DEPOSIT — flexible, no rewards', `${asset}${amt()}`, 'Deposit', ([a, amount]) => {
    eng.deposit({ from: VAULT_USER, asset: a, amountFluff: parseTumboSim(amount), idempotencyKey: newKey() });
    scheduleRefresh();
  });
  mk('SAVE — savings pocket u:you:save:<goal>', `<input class="tv-in" data-f placeholder="goal (e.g. bike)">${asset}${amt()}`, 'Save', ([goal, a, amount]) => {
    eng.save({ from: VAULT_USER, goal: goal.trim(), asset: a, amountFluff: parseTumboSim(amount), idempotencyKey: newKey() });
    scheduleRefresh();
  });
}

function buildTickRow(eng) {
  ui.tickrow.innerHTML = '';
  const row = el('div', 'tv-row');
  row.innerHTML = `<div class="tv-grow">current tick <b class="tv-id tv-cur-tick"></b></div>
    <input class="tv-in" data-f style="width:90px" value="10" placeholder="ticks">
    <button class="tv-btn">Advance</button>`;
  row.querySelector('.tv-btn').addEventListener('click', () => {
    try {
      const n = Number(row.querySelector('[data-f]').value);
      eng.advanceTick({ ticks: n, idempotencyKey: newKey() });
      scheduleRefresh();
    } catch (err) { showError(err && err.message ? err.message : String(err)); }
  });
  ui.tickrow.appendChild(row);
}

function openPanel() {
  if (!ui.panel) return;
  ui.panel.hidden = false;
  refreshUI();
}

function refreshUI() {
  const eng = getEngine();
  if (ui.chipTick) ui.chipTick.textContent = `tick ${eng.tick()}`;
  if (!ui.panel || ui.panel.hidden) return;
  const cur = ui.tickrow.querySelector('.tv-cur-tick');
  if (cur) cur.textContent = String(eng.tick());
  // status
  const rep = eng.vaultIntegrity();
  const okAll = rep.TUMBO.ok && rep.sMIMAS.ok;
  ui.status.innerHTML = `
    <div class="tv-kv"><span>u:you · TUMBO</span><b>${esc(fmtTokenFluff(eng.balance(VAULT_USER, 'TUMBO')))}</b></div>
    <div class="tv-kv"><span>u:you · sMIMAS</span><b>${esc(fmtTokenFluff(eng.balance(VAULT_USER, 'sMIMAS')))}</b></div>
    <div class="tv-kv"><span>sys:vault · TUMBO</span><b>${esc(fmtTokenFluff(rep.TUMBO.vaultBalance))}</b></div>
    <div class="tv-kv"><span>sys:vault · sMIMAS</span><b>${esc(fmtTokenFluff(rep.sMIMAS.vaultBalance))}</b></div>
    <div class="tv-kv"><span>vault integrity</span><b class="${okAll ? 'tv-ok' : 'tv-bad'}">${okAll ? 'OK — vault = open positions' : 'BREACH'}</b></div>
    <div class="tv-kv"><span>rewards reserve · TUMBO</span><b>${esc(fmtTokenFluff(eng.rewardsReserveOf('TUMBO')))}</b></div>`;
  // positions
  const open = eng.openPositions({ owner: VAULT_USER });
  ui.positions.innerHTML = open.length ? '' : '<div style="opacity:.6">no open positions yet</div>';
  for (const p of open) {
    const row = el('div', 'tv-row');
    let actionHtml = '';
    if (p.kind === 'stake') {
      actionHtml = '<button class="tv-btn">Unstake</button>';
    } else if (p.kind === 'lock') {
      actionHtml = eng.tick() >= p.unlockTick
        ? '<button class="tv-btn">Withdraw</button>'
        : `<button class="tv-btn" disabled>unlocks @ ${p.unlockTick}</button>`;
    } else {
      actionHtml = '<button class="tv-btn">Withdraw</button>';
    }
    row.innerHTML = `<div class="tv-grow"><span class="tv-id">${esc(p.id)}</span> · ${esc(p.kind)} · ${esc(p.asset)}<br>
      <span class="tv-sub">${esc(fmtTokenFluff(p.principal))}${p.kind === 'lock' ? ` · unlock tick ${p.unlockTick}` : ''}${p.kind === 'stake' ? ` · est. reward ${esc(fmtTokenFluff(eng.estimateRewards(p.id)))}` : ''}</span></div>${actionHtml}`;
    const btn = row.querySelector('.tv-btn');
    if (btn && !btn.disabled) {
      btn.addEventListener('click', () => {
        try {
          if (p.kind === 'stake') eng.unstake({ positionId: p.id, idempotencyKey: newKey() });
          else eng.withdraw({ positionId: p.id, idempotencyKey: newKey() });
          scheduleRefresh();
        } catch (err) { showError(err && err.message ? err.message : String(err)); }
      });
    }
    ui.positions.appendChild(row);
  }
  // pockets
  const pockets = eng.pocketsOf(VAULT_USER);
  ui.pockets.innerHTML = pockets.length ? '' : '<div style="opacity:.6">no savings pockets yet</div>';
  for (const pk of pockets) {
    const row = el('div', 'tv-row');
    const goal = pk.pocket.split(':save:')[1];
    row.innerHTML = `<div class="tv-grow"><span class="tv-id">${esc(goal)}</span> · ${esc(pk.asset)}<br>
      <span class="tv-sub">${esc(fmtTokenFluff(pk.balance))}</span></div>
      <input class="tv-in" data-f style="width:90px" placeholder="amount">
      <button class="tv-btn">Withdraw</button>`;
    row.querySelector('.tv-btn').addEventListener('click', () => {
      try {
        eng.withdraw({ owner: VAULT_USER, goal, asset: pk.asset, amountFluff: parseTumboSim(row.querySelector('[data-f]').value), idempotencyKey: newKey() });
        scheduleRefresh();
      } catch (err) { showError(err && err.message ? err.message : String(err)); }
    });
    ui.pockets.appendChild(row);
  }
  // log
  const all = eng.receipts();
  ui.log.innerHTML = all.slice(-12).reverse().map((r) =>
    `<div>#${all.indexOf(r) + 1} ${esc(r.action)} · tick ${r.tick} · ${esc(String(r.key).slice(0, 13))}</div>`
  ).join('');
}

// ---------------------------------------------------------------------------
// 3D block view
// ---------------------------------------------------------------------------

function open3D() {
  const eng = getEngine();
  if (document.querySelector('.tv-3d')) return;
  const overlay = el('div', 'tv-3d');
  overlay.setAttribute('data-vault-3d', '');
  overlay.innerHTML = `
    <div class="tv-3d-top"><span>HIBERNATION VAULT · 3D <span class="tv-sim">simulated</span></span>
    <button class="tv-btn" data-close>Close</button></div>
    <div class="tv-3d-info" hidden></div>
    <div class="tv-3d-hint">drag cubes · click selects · double-click background closes</div>`;
  document.body.appendChild(overlay);
  const info = overlay.querySelector('.tv-3d-info');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (err) {
    info.hidden = false;
    info.textContent = '3D unavailable in this browser (WebGL error). The vault panel still works.';
    return;
  }
  overlay.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  camera.position.set(0, 2.6, 6.2);
  camera.lookAt(0, 0.6, 0);
  const lightDisposers = addGlassLighting(THREE, scene);
  const world = new THREE.Group();
  scene.add(world);

  const store = loadStore();
  const cubePos = store.cubes || {};
  const vaultCube = makeGlassCube(THREE, 1.35, TINT);
  vaultCube.position.set(0, 0.8, 0);
  vaultCube.userData.vaultCore = true;
  world.add(vaultCube);

  const draggables = [];
  const open = eng.openPositions({ owner: VAULT_USER });
  const sizeFor = { stake: 0.62, lock: 0.74, deposit: 0.5 };
  open.forEach((p, i) => {
    const cube = makeGlassCube(THREE, sizeFor[p.kind] || 0.6, TINT);
    const a = (i / Math.max(1, open.length)) * Math.PI * 2;
    const saved = cubePos[p.id];
    if (saved) cube.position.set(saved[0], saved[1], saved[2]);
    else cube.position.set(Math.cos(a) * 2.7, 0.8 + (i % 2) * 0.5, Math.sin(a) * 2.7);
    cube.userData.position = p;
    world.add(cube);
    draggables.push(cube);
    const line = makeConnectionLines(THREE, [vaultCube.position.clone(), cube.position.clone()], LINE_COLOR);
    line.userData.linkFor = p.id;
    world.add(line);
  });

  const resize = () => {
    const wpx = overlay.clientWidth, hpx = overlay.clientHeight;
    renderer.setSize(wpx, hpx, false);
    camera.aspect = wpx / Math.max(1, hpx);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const hitPoint = new THREE.Vector3();
  let dragCube = null, movedPx = 0, lastX = 0, lastY = 0;
  const setPtr = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  };
  const onDown = (e) => {
    setPtr(e); ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(draggables, false);
    movedPx = 0; lastX = e.clientX; lastY = e.clientY;
    if (hits.length) {
      dragCube = hits[0].object;
      const n = camera.getWorldDirection(new THREE.Vector3()).negate();
      dragPlane.setFromNormalAndCoplanarPoint(n, dragCube.position);
      hitPoint.copy(hits[0].point).sub(dragCube.position);
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* never */ }
    }
  };
  const onMove = (e) => {
    movedPx = Math.max(movedPx, Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY));
    if (!dragCube) return;
    setPtr(e); ray.setFromCamera(ptr, camera);
    const pt = new THREE.Vector3();
    if (ray.ray.intersectPlane(dragPlane, pt)) {
      pt.sub(hitPoint);
      const r = Math.hypot(pt.x, pt.z);
      if (r > 4.2) { pt.x *= 4.2 / r; pt.z *= 4.2 / r; }
      pt.y = Math.min(3.2, Math.max(0.15, pt.y));
      dragCube.position.copy(pt);
      // keep its connection line glued
      for (const child of world.children) {
        if (child.userData.linkFor === dragCube.userData.position.id) {
          world.remove(child);
          if (child.geometry) { try { child.geometry.dispose(); } catch { /* never */ } }
          const line = makeConnectionLines(THREE, [vaultCube.position.clone(), dragCube.position.clone()], LINE_COLOR);
          line.userData.linkFor = dragCube.userData.position.id;
          world.add(line);
          break;
        }
      }
    }
  };
  const onUp = () => {
    const wasDragCube = dragCube;
    dragCube = null;
    if (wasDragCube && movedPx > 5) {
      const p = wasDragCube.position;
      const saved = loadStore().cubes || {};
      saved[wasDragCube.userData.position.id] = [p.x, p.y, p.z];
      saveStore({ cubes: saved });
    } else if (wasDragCube) {
      const p = wasDragCube.userData.position;
      info.hidden = false;
      info.innerHTML = `<b>${esc(p.id)}</b> · ${esc(p.kind)} · ${esc(p.asset)}<br>` +
        `principal ${esc(fmtTokenFluff(p.principal))}<br>` +
        (p.kind === 'stake' ? `est. reward ${esc(fmtTokenFluff(eng.estimateRewards(p.id)))}<br>` : '') +
        (p.kind === 'lock' ? `unlock tick ${p.unlockTick} (now ${eng.tick()})` : 'flexible term');
    }
  };
  const cvs = renderer.domElement;
  cvs.addEventListener('pointerdown', onDown);
  cvs.addEventListener('pointermove', onMove);
  cvs.addEventListener('pointerup', onUp);
  cvs.addEventListener('dblclick', (e) => {
    setPtr(e); ray.setFromCamera(ptr, camera);
    if (!ray.intersectObjects(draggables, false).length) close();
  });

  let raf = 0;
  const t0 = performance.now();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!dragCube) world.rotation.y = (performance.now() - t0) / 24000;
    renderer.render(scene, camera);
  };
  loop();

  function close() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    try { if (lightDisposers && lightDisposers.dispose) lightDisposers.dispose(); } catch { /* never */ }
    world.traverse((o) => {
      if (o.geometry) { try { o.geometry.dispose(); } catch { /* never */ } }
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { try { m.dispose(); } catch { /* never */ } }
      }
    });
    try { renderer.dispose(); } catch { /* never */ }
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('[data-close]').addEventListener('click', close);
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

function mount() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__tokenVaultUIMounted) return;
  try {
    const q = new URLSearchParams(window.location.search || '');
    if (q.get('token-vault-ui') === 'off') return;
  } catch { /* ignore */ }
  window.__tokenVaultUIMounted = true;
  ui = {};
  try {
    injectStyles();
    const eng = getEngine();
    buildChip(eng);
    buildPanel(eng);
    eng.onEvent(() => scheduleRefresh());
    scheduleRefresh();
  } catch (err) {
    console.error('[token-vault-ui] mount failed:', err);
  }
}

mount();

export { mount as mountTokenVaultUI, getEngine as getTokenVaultEngine };
