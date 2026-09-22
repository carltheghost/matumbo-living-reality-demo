/**
 * Token Lifecycle - audit console view (browser), on the unified token core.
 *
 * Ported from the token-lifecycle workstream (PR #5) onto the canonical
 * src/domains/token.js core (PR #6, agent/token-unified). Only the renderer
 * was ported - PR #5's competing core, supply constant, and genesis
 * history-filter bug were deliberately left behind.
 *
 * Mounts the transaction history / audit view for TUMBO-SIM:
 *  - a three.js (pinned r179.1) glass-cube chain: one translucent blue
 *    glass cube per journal, linked in hash-chain order;
 *  - the journal list with filters by action / account / asset / state;
 *  - click a tx to inspect its EchoProof receipt with recomputed hashes
 *    and the prevHash chain-link check;
 *  - a "verify chain" control the user can run any time;
 *  - reverse / quote cancel / quote execute rehearsal controls.
 *
 * Unified-core mapping notes (the core has no per-journal "state" and no
 * pending journals):
 *  - journal identity is `id` (was `journalId`); ordering key is `tick`;
 *    timestamps are `ts`; postings carry signed `amount` (not amountFluff).
 *  - states are derived: genesis (action), reversed (a reverse journal
 *    links to it), otherwise settled. Cancellations live on quotes, so the
 *    console rehearses quote issue -> cancel / execute instead of
 *    cancelling journals.
 *  - history comes from engine.journalHistory() (newest-first, no genesis
 *    filter bypass); verification from ledger.verifyReceipt()/verifyChain().
 *
 * Design laws honored: translucent blue glass cubes from the first frame;
 * cubes are small by default and open the inspector on interaction;
 * draggable in full 3D with positions remembered (localStorage);
 * the panel minimizes to a small translucent chip; single click selects,
 * hover peeks, double-click enters the tx block world (focused view);
 * every panel body scrolls; 1440x900 and 390x844 layouts; zero console
 * errors (all failures surface in the status line).
 *
 * SIMULATION ONLY - TUMBO-SIM are simulated points. No real money,
 * wagering, wallets, custody, or chains. Every surface labels this.
 */

import * as THREE from "three?v=20260922-cache2";
import {
  createTokenEngine,
  ensureTumboTokenFacade,
  REVERSE_WINDOW_TICKS,
  ASSETS,
} from "../domains/token.js?v=20260922-cache2";
import { runTokenLifecycleSelfTest } from "./token-lifecycle-selftest.js?v=20260922-cache2";

const POS_KEY = "tumbo:token-lifecycle:cube-positions";
const MAX_CUBES = 30;

/** Actions the unified core can emit as ledger journals. */
const KNOWN_ACTIONS = ["genesis", "faucet", "send", "lock", "unlock", "reverse", "exchange", "buy", "sell"];

const STATE_COLORS = {
  genesis: 0xeafcff,
  pending: 0xffc76f,
  settled: 0x6fc7ff,
  reversed: 0xb79aff,
  cancelled: 0xff8f9a,
  executed: 0x6fc7ff,
};

const short = (h) => (typeof h === "string" && h.length > 18 ? h.slice(0, 10) + "\u2026" + h.slice(-6) : h);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtTime = (ts) => {
  try {
    return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return String(ts); }
};

/** Integer fluff -> "1.500 TUMBO-SIM" / "0.000 sMIMAS-SIM" (no float math). */
function fmtAsset(fluff, asset) {
  const n = Number(fluff);
  const neg = n < 0;
  const abs = Math.abs(n);
  const body = Math.floor(abs / 1000).toLocaleString("en-US") + "." + String(abs % 1000).padStart(3, "0");
  return (neg ? "-" : "") + body + " " + (asset === "sMIMAS" ? "sMIMAS-SIM" : "TUMBO-SIM");
}

function loadPositions() {
  try { const raw = localStorage.getItem(POS_KEY); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
function savePositions(map) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(map)); } catch { /* best-effort */ }
}

function resolveEngine(facade) {
  if (facade && facade.engine && typeof facade.engine.journalHistory === "function") return facade.engine;
  if (facade && typeof facade.journalHistory === "function" && facade.ledger) return facade;
  throw new Error("audit console needs the unified token engine (facade.engine)");
}

/**
 * Deterministic demo journals for the audit console. All idempotency keys
 * are fixed, so re-mounts replay instead of duplicating. Uses only public
 * unified-core paths: faucet (internal authority), direct user<->user posts,
 * quote -> execute, and reverse.
 */
function seedDemo(engine) {
  const existing = engine.journalHistory({ limit: 1000 });
  if (existing.rows.some((r) => r.idempotencyKey === "audit-demo:fund-alice")) return;
  const post = (legs, key, action, memo) => {
    try { return engine.ledger.post(legs, { idempotencyKey: key, action, memo }); }
    catch { return null; }
  };
  const send = (from, to, asset, fluff, key, memo) => post(
    [{ account: from, asset, amount: -fluff }, { account: to, asset, amount: fluff }],
    key, "send", memo
  );
  try { engine.faucet("u:alice", "TUMBO", 60000, { idempotencyKey: "audit-demo:fund-alice" }); } catch { /* replay */ }
  try { engine.faucet("u:bob", "TUMBO", 40000, { idempotencyKey: "audit-demo:fund-bob" }); } catch { /* replay */ }
  // The faucet holds TUMBO only; sMIMAS funding comes from the market maker
  // through the internal-authority path (same as genesis).
  try {
    engine.ledger.post(
      [{ account: "sys:market", asset: "sMIMAS", amount: -25000 }, { account: "u:alice", asset: "sMIMAS", amount: 25000 }],
      { idempotencyKey: "audit-demo:fund-alice-smimas", action: "faucet", memo: "demo sMIMAS funding", authority: "internal" }
    );
  } catch { /* replay */ }
  send("u:alice", "u:bob", "TUMBO", 1500, "audit-demo:tip-1", "simulated tip");
  send("u:bob", "u:carol", "TUMBO", 8000, "audit-demo:send-1", "simulated send");
  post(
    [{ account: "u:alice", asset: "TUMBO", amount: -10000 }, { account: "sys:escrow", asset: "TUMBO", amount: 10000 }],
    "audit-demo:lock-1", "lock", "simulated lock to escrow"
  );
  try {
    const q = engine.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 2000 });
    engine.execute(q, { idempotencyKey: "audit-demo:xchg-1" });
  } catch { /* replay */ }
  try { engine.reverse({ idempotencyKey: "audit-demo:tip-1", actor: "audit-demo" }); } catch { /* replay / already reversed */ }
}

/** Human one-liner for a unified journal receipt. */
function summarize(r) {
  if (r.action === "genesis") return "genesis \u2014 supply issuance anchors the chain";
  const credits = r.postings.filter((p) => p.amount > 0);
  const debits = r.postings.filter((p) => p.amount < 0);
  const c0 = credits[0], d0 = debits[0];
  if (c0 && d0) {
    return r.action + " " + fmtAsset(c0.amount, c0.asset) + " " + d0.account + " \u2192 " + c0.account;
  }
  if (r.memo) return r.action + " \u2014 " + r.memo;
  return r.action;
}

export function mountTokenLifecycleAudit(root, opts = {}) {
  const facade = opts.facade
    ?? opts.engine
    ?? (typeof window !== "undefined" && window.TumboToken)
    ?? ensureTumboTokenFacade({ seed: true });
  const engine = resolveEngine(facade);
  const ledger = engine.ledger;
  seedDemo(engine);

  const remembered = loadPositions();
  const ui = {
    selectedId: null,
    focusedId: null,
    filters: { action: "", account: "", asset: "", state: "" },
    quotes: [],
  };

  root.innerHTML =
    '<div class="tl-shell">' +
    '<header class="tl-head"><div class="tl-head-copy">' +
    '<div class="tl-eyebrow">TUMBO-SIM \u00B7 simulated points \u00B7 no real money, wallets, or custody</div>' +
    '<h1>Token Lifecycle \u2014 Audit Console</h1>' +
    '<p>Reverse and cancel rehearsal on the unified demo ledger. Every mutation is a balanced journal; ' +
    'reversals post compensating journals and never edit history. Reverse window: <b>' + REVERSE_WINDOW_TICKS + ' ledger ticks</b>.</p>' +
    '</div><div class="tl-head-actions">' +
    '<span class="tl-pill" data-tl="chain-pill">chain \u2026</span>' +
    '<button class="tl-btn" data-tl="verify">Verify chain</button>' +
    '<button class="tl-btn" data-tl="advance">+1005 ticks</button>' +
    '<button class="tl-btn" data-tl="minimize" aria-label="Minimize panel">\u2014</button>' +
    '</div></header>' +
    '<div class="tl-selftest" data-tl="selftest" hidden></div>' +
    '<div class="tl-grid">' +
    '<section class="tl-stage-wrap"><div class="tl-stage" data-tl="stage"></div>' +
    '<div class="tl-tooltip" data-tl="tooltip" hidden></div>' +
    '<div class="tl-stage-hint">drag a cube to move it \u00B7 drag background to orbit \u00B7 scroll to zoom \u00B7 single-click selects \u00B7 double-click enters its block world</div>' +
    '</section>' +
    '<aside class="tl-panel" data-tl="panel">' +
    '<div class="tl-panel-head"><strong>Ledger panel</strong><span class="tl-meta" data-tl="tick-line"></span></div>' +
    '<div class="tl-status" data-tl="status"></div>' +
    '<section class="tl-section"><h2>Lifecycle</h2>' +
    '<div class="tl-row-btns"><button class="tl-btn" data-tl="do-reverse">Reverse selected</button></div>' +
    '<p class="tl-note">Reverse posts a compensating journal inside a ' + REVERSE_WINDOW_TICKS + '-tick window. ' +
    'Genesis, reversal, and cancellation journals cannot be reversed \u2014 attempts fail closed.</p></section>' +
    '<section class="tl-section"><h2>Quote rehearsal</h2>' +
    '<div class="tl-row-btns"><button class="tl-btn" data-tl="q-issue">Issue quote</button>' +
    '<button class="tl-btn" data-tl="q-cancel">Cancel latest quote</button>' +
    '<button class="tl-btn" data-tl="q-execute">Execute latest quote</button></div>' +
    '<div class="tl-list" data-tl="quotes" style="margin-top:8px"><p class="tl-empty">No rehearsal quotes yet \u2014 issue one, then cancel or execute it. Cancelling an executed quote fails closed.</p></div>' +
    '<p class="tl-note">Quotes are the pending stage of the lifecycle: issue \u2192 cancel (pending only) or execute (settles a journal).</p></section>' +
    '<section class="tl-section"><h2>Filters</h2><div class="tl-filters">' +
    '<label>Action<select data-tl="f-action"><option value="">All actions</option>' +
    KNOWN_ACTIONS.map((a) => '<option value="' + a + '">' + a + '</option>').join("") + '</select></label>' +
    '<label>Account<input data-tl="f-account" type="text" placeholder="u:alice or sys:escrow" autocomplete="off" /></label>' +
    '<label>Asset<select data-tl="f-asset"><option value="">All assets</option>' +
    ASSETS.map((a) => '<option value="' + a + '">' + a + '</option>').join("") + '</select></label>' +
    '<label>State<select data-tl="f-state"><option value="">Any state</option>' +
    '<option value="settled">settled</option><option value="reversed">reversed</option>' +
    '<option value="genesis">genesis</option></select></label>' +
    '</div></section>' +
    '<section class="tl-section tl-list-section"><h2>Journals <span class="tl-meta" data-tl="list-count"></span></h2>' +
    '<div class="tl-list" data-tl="list"></div></section>' +
    '<section class="tl-section"><h2>Receipt inspector</h2>' +
    '<div class="tl-receipt" data-tl="receipt"><p class="tl-empty">Select a journal to inspect its EchoProof receipt.</p></div></section>' +
    '<div class="tl-boundary">Simulation boundary: TUMBO-SIM are demo points. Nothing here settles, custodies, or represents real value.</div>' +
    '</aside></div>' +
    '<button class="tl-chip" data-tl="chip" hidden>\u25C6 Token audit</button>' +
    '</div>';

  const $ = (sel) => root.querySelector('[data-tl="' + sel + '"]');
  const stageEl = $("stage");
  const tooltipEl = $("tooltip");
  const statusEl = $("status");
  const listEl = $("list");
  const receiptEl = $("receipt");
  const quotesEl = $("quotes");
  const setStatus = (msg) => { statusEl.textContent = msg; };

  /* ---------- journal view model ---------- */
  /** Ids of journals that have been reversed (derived from reverse journals). */
  function reversedIds() {
    const set = new Set();
    try {
      for (const r of engine.journalHistory({ action: "reverse", limit: 1000 }).rows) {
        if (r.links && r.links.reverses) set.add(r.links.reverses);
      }
    } catch { /* best-effort */ }
    return set;
  }
  let reversedCache = reversedIds();
  const stateOf = (r) => (r.action === "genesis" ? "genesis" : (reversedCache.has(r.id) ? "reversed" : "settled"));
  const stateColor = (r) => (STATE_COLORS[stateOf(r)] ?? STATE_COLORS.settled);
  const isReversible = (r) => {
    if (r.action === "genesis" || r.action === "reverse" || r.action === "cancel") return false;
    if (reversedCache.has(r.id)) return false;
    return (ledger.tick - r.tick) <= REVERSE_WINDOW_TICKS;
  };
  const windowRemaining = (r) => Math.max(0, REVERSE_WINDOW_TICKS - (ledger.tick - r.tick));
  const findJournal = (id) => {
    try {
      const rows = engine.journalHistory({ limit: 1000 }).rows;
      return rows.find((r) => r.id === id) || null;
    } catch { return null; }
  };
  const findReverser = (id) => {
    try {
      const rows = engine.journalHistory({ action: "reverse", limit: 1000 }).rows;
      return rows.find((r) => r.links && r.links.reverses === id) || null;
    } catch { return null; }
  };

  /* ---------- three.js glass-cube chain ---------- */
  let three = null;
  const cubeMeshes = new Map();
  let hoverId = null;
  /* Bulk-advance guard: while advancing many ticks, receipt events are
   * suppressed and a single refresh runs at the end. Without this,
   * "+1005 ticks" would rebuild the whole scene 1005 times. */
  let suppressRefresh = 0;

  function makeLabel(text) {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "rgba(190,240,255,0.92)";
      ctx.font = "600 44px ui-sans-serif, system-ui";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, 128, 64);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
    sprite.scale.set(1.5, 0.75, 1);
    return sprite;
  }

  function initThree() {
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      stageEl.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
      camera.position.set(0, 3.4, 11);
      scene.add(new THREE.AmbientLight(0x88bbdd, 0.75));
      const dir = new THREE.DirectionalLight(0xffffff, 1.4);
      dir.position.set(5, 8, 6);
      scene.add(dir);
      const pt = new THREE.PointLight(0x66ccff, 30, 40);
      pt.position.set(-6, 2, 4);
      scene.add(pt);
      const world = new THREE.Group();
      scene.add(world);

      const ray = new THREE.Raycaster();
      const ptr = new THREE.Vector2();
      const dragPlane = new THREE.Plane();
      const dragOffset = new THREE.Vector3();
      const hitPoint = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      let dragTarget = null, orbiting = false, downPos = null;
      let yaw = 0.35, pitch = 0.12, camDist = 11;
      let focusGoal = null;

      const setPtr = (e) => {
        const r = renderer.domElement.getBoundingClientRect();
        ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      };
      const pick = (e) => {
        setPtr(e);
        ray.setFromCamera(ptr, camera);
        const hits = ray.intersectObjects(Array.from(cubeMeshes.values()).map((m) => m.hit), false);
        return hits.length ? hits[0] : null;
      };

      renderer.domElement.addEventListener("pointerdown", (e) => {
        downPos = [e.clientX, e.clientY];
        const hit = pick(e);
        if (hit) {
          dragTarget = hit.object.userData.group;
          camera.getWorldDirection(camDir);
          dragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point);
          dragOffset.copy(dragTarget.position).sub(hit.point);
          try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* noop */ }
        } else { orbiting = true; }
      });
      renderer.domElement.addEventListener("pointermove", (e) => {
        if (dragTarget) {
          setPtr(e);
          ray.setFromCamera(ptr, camera);
          if (ray.ray.intersectPlane(dragPlane, hitPoint)) {
            const p = hitPoint.clone().add(dragOffset);
            if (p.length() > 14) p.setLength(14);
            dragTarget.position.copy(p);
            const entry = cubeMeshes.get(dragTarget.userData.journalId);
            if (entry) entry.baseY = p.y;
            remembered[dragTarget.userData.journalId] = [p.x, p.y, p.z];
            savePositions(remembered);
            rebuildChainLine();
          }
          return;
        }
        if (orbiting && downPos) {
          yaw -= (e.clientX - downPos[0]) * 0.008;
          pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - downPos[1]) * 0.006));
          downPos = [e.clientX, e.clientY];
          return;
        }
        const hit = pick(e);
        const sr = stageEl.getBoundingClientRect();
        if (hit) {
          const j = hit.object.userData.journal;
          tooltipEl.hidden = false;
          tooltipEl.style.left = (e.clientX - sr.left + 14) + "px";
          tooltipEl.style.top = (e.clientY - sr.top + 10) + "px";
          tooltipEl.innerHTML = "<strong>" + esc(j.id) + "</strong> \u00B7 " + esc(j.action) + " \u00B7 " + esc(stateOf(j)) + "<br>" + esc(summarize(j));
          renderer.domElement.style.cursor = "pointer";
          setHover(j.id);
        } else {
          tooltipEl.hidden = true;
          renderer.domElement.style.cursor = "grab";
          setHover(null);
        }
      });
      const endPointer = (e) => {
        const wasClick = downPos && Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) < 6;
        if (wasClick) {
          const hit = pick(e);
          if (hit) selectJournal(hit.object.userData.journalId, true);
          else if (ui.focusedId) exitFocus();
        }
        dragTarget = null; orbiting = false; downPos = null;
      };
      renderer.domElement.addEventListener("pointerup", endPointer);
      renderer.domElement.addEventListener("pointercancel", endPointer);
      renderer.domElement.addEventListener("pointerleave", () => { tooltipEl.hidden = true; setHover(null); });
      renderer.domElement.addEventListener("dblclick", (e) => {
        const hit = pick(e);
        if (hit) enterFocus(hit.object.userData.journalId);
      });
      renderer.domElement.addEventListener("wheel", (e) => {
        e.preventDefault();
        camDist = Math.max(5, Math.min(22, camDist + e.deltaY * 0.01));
      }, { passive: false });

      const clock = new THREE.Clock();
      let raf = 0;
      const focusDest = new THREE.Vector3();
      const animate = () => {
        raf = requestAnimationFrame(animate);
        const t = clock.getElapsedTime();
        world.rotation.y += (yaw - world.rotation.y) * 0.08;
        world.rotation.x += (pitch - world.rotation.x) * 0.08;
        camera.position.z += (camDist - camera.position.z) * 0.1;
        camera.position.y += (3.4 - camera.position.y) * 0.1;
        camera.lookAt(0, 0, 0);
        for (const entry of cubeMeshes.values()) {
          if (entry.group !== dragTarget) entry.group.position.y = entry.baseY + Math.sin(t * 0.9 + entry.phase) * 0.08;
          const target = entry.group.userData.journalId === ui.selectedId ? 1.18 : 1;
          const s = entry.group.scale.x + (target - entry.group.scale.x) * 0.15;
          entry.group.scale.setScalar(s);
        }
        if (focusGoal) {
          focusGoal.getWorldPosition(focusDest);
          const dest = new THREE.Vector3(focusDest.x * 0.55, focusDest.y * 0.55 + 1.2, focusDest.z + 4.2);
          camera.position.lerp(dest, 0.08);
          if (camera.position.distanceTo(dest) < 0.15) focusGoal = null;
        }
        renderer.render(scene, camera);
      };
      const resize = () => {
        const w = stageEl.clientWidth || 300;
        const h = stageEl.clientHeight || 300;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      new ResizeObserver(resize).observe(stageEl);
      resize();
      animate();
      three = {
        renderer, scene, camera, world,
        destroy() { cancelAnimationFrame(raf); renderer.dispose(); stageEl.innerHTML = ""; },
        setFocus(g) { focusGoal = g; },
        clearFocus() { focusGoal = null; camDist = 11; },
      };
    } catch (err) {
      stageEl.innerHTML = '<div class="tl-empty">3D unavailable (' + esc(err && err.message) + '). The ledger panel works without it.</div>';
      three = null;
    }
  }

  let chainLine = null;
  function rebuildChainLine() {
    if (!three) return;
    if (chainLine) { three.world.remove(chainLine); chainLine.geometry.dispose(); chainLine.material.dispose(); chainLine = null; }
    const pts = Array.from(cubeMeshes.values()).map((m) => m.group.position.clone());
    if (pts.length < 2) return;
    chainLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.35 })
    );
    three.world.add(chainLine);
  }

  function rebuildCubes() {
    if (!three) return;
    for (const m of cubeMeshes.values()) {
      three.world.remove(m.group);
      m.cube.geometry.dispose();
      m.edges.geometry.dispose();
      m.cube.material.dispose();
      m.label.material.map.dispose();
      m.label.material.dispose();
    }
    cubeMeshes.clear();
    let rows = [];
    try { rows = engine.journalHistory({ limit: MAX_CUBES + 1 }).rows; } catch { rows = []; }
    const chronological = rows.slice().reverse().slice(-MAX_CUBES);
    const n = chronological.length;
    chronological.forEach((j, i) => {
      const color = stateColor(j);
      const size = j.action === "genesis" ? 1.05 : 0.85;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshPhysicalMaterial({
        color, transparent: true, opacity: 0.3, roughness: 0.12, metalness: 0.1,
        emissive: color, emissiveIntensity: 0.06,
      });
      const cube = new THREE.Mesh(geo, mat);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.55 })
      );
      cube.add(edges);
      const label = makeLabel(j.action === "genesis" ? "GEN" : ("T" + j.tick));
      label.position.y = size * 0.95;
      const group = new THREE.Group();
      group.add(cube);
      group.add(label);
      group.userData.journalId = j.id;
      const saved = remembered[j.id];
      if (Array.isArray(saved) && saved.length === 3) group.position.set(saved[0], saved[1], saved[2]);
      else group.position.set((i - (n - 1) / 2) * 1.9, Math.sin(i * 0.7) * 0.55, Math.cos(i * 0.55) * 0.6);
      cube.userData = { group, journal: j, journalId: j.id };
      cubeMeshes.set(j.id, { group, cube, edges, label, baseY: group.position.y, phase: i * 1.3, hit: cube });
      three.world.add(group);
    });
    rebuildChainLine();
    paintSelection();
  }

  function setHover(journalId) {
    if (hoverId === journalId) return;
    hoverId = journalId;
    paintSelection();
  }
  function paintSelection() {
    for (const entry of cubeMeshes.values()) {
      const jid = entry.group.userData.journalId;
      entry.cube.material.emissiveIntensity = jid === ui.selectedId ? 0.55 : (jid === hoverId ? 0.3 : 0.06);
    }
  }
  function enterFocus(journalId) {
    ui.focusedId = journalId;
    const m = cubeMeshes.get(journalId);
    if (m && three) three.setFocus(m.group);
    selectJournal(journalId, true);
    receiptEl.classList.add("tl-focus");
    try { receiptEl.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch { /* noop */ }
    setStatus("Entered the block world of " + journalId + " \u2014 click empty space or pick another tx to leave.");
  }
  function exitFocus() {
    ui.focusedId = null;
    if (three) three.clearFocus();
    receiptEl.classList.remove("tl-focus");
  }

  /* ---------- list / receipt / chain ---------- */
  function renderList() {
    const f = ui.filters;
    let result;
    try {
      result = engine.journalHistory({
        action: f.action || undefined,
        account: f.account.trim() || undefined,
        asset: f.asset || undefined,
        limit: 200,
      });
    } catch (err) { setStatus("Filter error: " + (err && err.message)); return; }
    let rows = result.rows;
    if (f.state) rows = rows.filter((r) => stateOf(r) === f.state);
    $("list-count").textContent = result.total + " journal" + (result.total === 1 ? "" : "s") + (f.state ? " (" + rows.length + " shown)" : "");
    if (!rows.length) { listEl.innerHTML = '<p class="tl-empty">No journals match these filters.</p>'; return; }
    listEl.innerHTML = rows.map((j) => {
      const st = stateOf(j);
      return '<button class="tl-row' + (j.id === ui.selectedId ? " is-sel" : "") + '" data-jid="' + esc(j.id) + '">' +
      '<span class="tl-row-seq">' + (j.action === "genesis" ? "GEN" : ("T" + j.tick)) + '</span>' +
      '<span class="tl-row-main"><span class="tl-row-title">' + esc(j.id) + ' \u00B7 ' + esc(j.action) + '</span>' +
      '<span class="tl-row-sub">' + esc(summarize(j)) + '</span>' +
      '<span class="tl-row-meta">tick ' + j.tick + ' \u00B7 ' + fmtTime(j.ts) + (j.links && j.links.reverses ? ' \u00B7 reverses ' + esc(j.links.reverses) : "") + '</span></span>' +
      '<span class="tl-row-state st-' + esc(st) + '">' + esc(st) + '</span></button>';
    }).join("");
    listEl.querySelectorAll(".tl-row").forEach((btn) => {
      btn.addEventListener("click", () => selectJournal(btn.getAttribute("data-jid"), true));
    });
  }

  function renderReceipt() {
    const jid = ui.selectedId;
    if (!jid) { receiptEl.innerHTML = '<p class="tl-empty">Select a journal to inspect its EchoProof receipt.</p>'; return; }
    const journal = findJournal(jid);
    if (!journal) { receiptEl.innerHTML = '<p class="tl-empty">Journal not found.</p>'; return; }
    const j = journal;
    const st = stateOf(j);
    let verification;
    try { verification = ledger.verifyReceipt(j.id); }
    catch (err) { verification = { ok: false, checks: [{ name: "verify", ok: false, detail: err && err.message }] }; }
    const reverser = findReverser(j.id);
    const postings = j.postings.map((p) => {
      const amt = Number(p.amount);
      const neg = amt < 0;
      const abs = neg ? -amt : amt;
      return '<tr><td>' + esc(p.account) + '</td><td>' + esc(p.asset) + '</td><td class="' + (neg ? "neg" : "pos") + '">' +
        (neg ? "\u2212" : "+") + esc(fmtAsset(abs, p.asset)) + '</td></tr>';
    }).join("");
    const checks = verification.checks.map((c) =>
      '<li class="' + (c.ok ? "ok" : "bad") + '"><span>' + (c.ok ? "\u2713" : "\u2717") + '</span> ' + esc(c.name) +
      (c.detail == null || c.detail === "" ? "" : ' <code>' + esc(c.detail) + '</code>') + '</li>'
    ).join("");
    const actor = (j.links && j.links.actor) ? j.links.actor : "\u2014";
    const remaining = windowRemaining(j);
    const reversible = isReversible(j);
    receiptEl.innerHTML =
      '<div class="tl-receipt-head"><strong>' + esc(j.id) + '</strong>' +
      '<span class="tl-pill">' + esc(j.action) + '</span>' +
      '<span class="tl-row-state st-' + esc(st) + '">' + esc(st) + '</span></div>' +
      '<p class="tl-receipt-summary">' + esc(summarize(j)) + '</p>' +
      '<dl class="tl-kv">' +
      '<div><dt>Tick</dt><dd>' + j.tick + ' (chain position #' + (j.tick) + ')</dd></div>' +
      '<div><dt>Actor</dt><dd>' + esc(actor) + '</dd></div>' +
      '<div><dt>Issued</dt><dd>' + fmtTime(j.ts) + '</dd></div>' +
      '<div><dt>Reverse window</dt><dd>' + (reversible
        ? remaining + " ticks remaining of " + REVERSE_WINDOW_TICKS
        : (st === "reversed" ? "already reversed" : "not eligible (genesis / lifecycle journal, or window expired)")) + '</dd></div>' +
      '<div><dt>Idempotency key</dt><dd><code>' + esc(j.idempotencyKey) + '</code></dd></div>' +
      (j.links && j.links.reverses ? '<div><dt>Reverses</dt><dd><button class="tl-link" data-goto="' + esc(j.links.reverses) + '">' + esc(j.links.reverses) + '</button></dd></div>' : "") +
      (reverser ? '<div><dt>Reversed by</dt><dd><button class="tl-link" data-goto="' + esc(reverser.id) + '">' + esc(reverser.id) + '</button></dd></div>' : "") +
      (j.memo ? '<div><dt>Memo</dt><dd>' + esc(j.memo) + '</dd></div>' : "") +
      '</dl>' +
      (postings
        ? '<table class="tl-postings"><thead><tr><th>Account</th><th>Asset</th><th>Amount</th></tr></thead><tbody>' + postings + '</tbody></table>'
        : '<p class="tl-note">No postings recorded on this journal.</p>') +
      '<h3>EchoProof receipt <span class="tl-meta">\u2014 recomputed just now</span></h3>' +
      '<dl class="tl-kv tl-hashes">' +
      '<div><dt>hash</dt><dd><code title="' + esc(j.hash) + '">' + esc(short(j.hash)) + '</code></dd></div>' +
      '<div><dt>prevHash</dt><dd><code title="' + esc(j.prevHash) + '">' + esc(short(j.prevHash)) + '</code></dd></div>' +
      '</dl><ul class="tl-checks">' + checks + '</ul>' +
      '<p class="tl-note">' + (verification.ok
        ? "Hash recomputed and the prevHash link verified against the chain."
        : "VERIFICATION FAILED \u2014 the chain may have been tampered with.") + '</p>';
    receiptEl.querySelectorAll("[data-goto]").forEach((b) => {
      b.addEventListener("click", () => selectJournal(b.getAttribute("data-goto"), true));
    });
  }

  function renderChainPill() {
    const pill = $("chain-pill");
    let report;
    try { report = ledger.verifyChain(); } catch { report = { ok: false }; }
    const ok = !!(report && report.ok);
    const count = report && typeof report.count === "number" ? report.count : ledger.journalCount();
    pill.textContent = ok ? ("chain \u2713 " + count + " receipts") : "chain \u2717 FAILED";
    if (ok) pill.classList.remove("bad"); else pill.classList.add("bad");
  }

  function renderQuotes() {
    if (!ui.quotes.length) {
      quotesEl.innerHTML = '<p class="tl-empty">No rehearsal quotes yet \u2014 issue one, then cancel or execute it. Cancelling an executed quote fails closed.</p>';
      return;
    }
    quotesEl.innerHTML = ui.quotes.map((q) =>
      '<div class="tl-row" style="cursor:default">' +
      '<span class="tl-row-seq">' + esc(q.action) + '</span>' +
      '<span class="tl-row-main"><span class="tl-row-title">' + esc(q.id) + '</span>' +
      '<span class="tl-row-sub">' + esc(q.from) + ': ' + esc(fmtAsset(q.amountIn, q.fromAsset)) + ' \u2192 ' + esc(fmtAsset(q.amountOut, q.toAsset)) + '</span>' +
      '<span class="tl-row-meta">' + esc(q.note || "") + '</span></span>' +
      '<span class="tl-row-state st-' + esc(q.status) + '">' + esc(q.status) + '</span></div>'
    ).join("");
  }

  function refreshAll(statusMsg) {
    reversedCache = reversedIds();
    rebuildCubes();
    renderList();
    renderReceipt();
    renderChainPill();
    renderQuotes();
    $("tick-line").textContent = "tick " + ledger.tick + " \u00B7 " + ledger.journalCount() + " journals";
    if (statusMsg) setStatus(statusMsg);
  }

  function selectJournal(journalId, scroll) {
    if (ui.focusedId && journalId !== ui.focusedId) exitFocus();
    ui.selectedId = journalId;
    paintSelection();
    renderList();
    renderReceipt();
    if (scroll) {
      const row = listEl.querySelector('[data-jid="' + journalId.replace(/"/g, "") + '"]');
      if (row) { try { row.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch { /* noop */ } }
    }
  }

  /* ---------- lifecycle controls ---------- */
  const needSelection = () => {
    if (!ui.selectedId) { setStatus("Select a journal first (click a cube or a row)."); return null; }
    return ui.selectedId;
  };
  $("do-reverse").addEventListener("click", () => {
    const id = needSelection(); if (!id) return;
    try {
      const res = engine.reverse({ journalId: id, actor: "audit-console" });
      refreshAll("Reversed " + id + " \u2192 compensating journal " + res.id + ". History untouched; re-running is idempotent.");
      selectJournal(res.id, true);
    } catch (err) { setStatus("Reverse failed closed: " + (err && err.message)); }
  });
  const latestPendingQuote = () => {
    for (let i = ui.quotes.length - 1; i >= 0; i -= 1) {
      if (ui.quotes[i].status === "pending") return ui.quotes[i];
    }
    return null;
  };
  $("q-issue").addEventListener("click", () => {
    try {
      const q = engine.quote({ action: "buy", from: "u:alice", fromAsset: "TUMBO", toAsset: "sMIMAS", amountIn: 1000 });
      ui.quotes.push({
        id: q.id, action: q.action, from: q.from,
        fromAsset: q.fromAsset, toAsset: q.toAsset,
        amountIn: q.amountIn, amountOut: q.amountOut,
        status: "pending", note: "issued at tick " + ledger.tick,
        quote: q,
      });
      refreshAll("Quote " + q.id + " issued (pending). Cancel it, or execute it to settle.");
    } catch (err) { setStatus("Quote failed: " + (err && err.message)); }
  });
  $("q-cancel").addEventListener("click", () => {
    const q = latestPendingQuote();
    if (!q) { setStatus("No pending rehearsal quote to cancel \u2014 issue one first."); return; }
    try {
      engine.cancelQuote(q.id, { idempotencyKey: "audit-demo:cancel-" + q.id });
      q.status = "cancelled";
      q.note = "cancelled at tick " + ledger.tick;
      refreshAll("Quote " + q.id + " cancelled. It can no longer be executed.");
    } catch (err) { setStatus("Cancel failed closed: " + (err && err.message)); }
  });
  $("q-execute").addEventListener("click", () => {
    const q = latestPendingQuote();
    if (!q) { setStatus("No pending rehearsal quote to execute \u2014 issue one first."); return; }
    try {
      const receipt = engine.execute(q.quote, { idempotencyKey: "audit-demo:exec-" + q.id });
      q.status = "executed";
      q.note = "settled as " + receipt.id + " at tick " + ledger.tick;
      refreshAll("Quote " + q.id + " executed \u2192 journal " + receipt.id + ". Cancelling it now would fail closed.");
      selectJournal(receipt.id, true);
    } catch (err) { setStatus("Execute failed: " + (err && err.message)); }
  });
  $("verify").addEventListener("click", () => {
    let report;
    try { report = ledger.verifyChain(); }
    catch (err) { setStatus("Chain verification error: " + (err && err.message)); return; }
    renderChainPill();
    setStatus(report && report.ok
      ? "Chain integrity verified: " + report.count + " receipts, every hash recomputed, every prevHash link intact. Tip " + short(report.tip) + "."
      : "Chain FAILED at " + ((report && report.at) || "?") + " (" + ((report && report.reason) || "unknown") + ").");
  });
  $("advance").addEventListener("click", () => {
    suppressRefresh += 1;
    let failed = null;
    try {
      for (let i = 0; i < 1005; i += 1) {
        ledger.post(
          [{ account: "u:alice", asset: "TUMBO", amount: -1 }, { account: "u:bob", asset: "TUMBO", amount: 1 }],
          { idempotencyKey: "audit-demo:tick-" + ledger.tick + "-" + i, action: "send", memo: "tick advance" }
        );
      }
    } catch (err) { failed = err; }
    suppressRefresh -= 1;
    if (failed) { setStatus("Advance failed: " + (failed && failed.message)); return; }
    refreshAll("Advanced 1005 ticks (now tick " + ledger.tick + "). Journals older than " + REVERSE_WINDOW_TICKS + " ticks can no longer be reversed \u2014 try reversing one.");
  });
  $("minimize").addEventListener("click", () => { $("panel").hidden = true; $("chip").hidden = false; });
  $("chip").addEventListener("click", () => { $("panel").hidden = false; $("chip").hidden = true; });

  /* ---------- filters ---------- */
  const fAction = $("f-action"), fAccount = $("f-account"), fAsset = $("f-asset"), fState = $("f-state");
  const applyFilters = () => {
    ui.filters = { action: fAction.value, account: fAccount.value, asset: fAsset.value, state: fState.value };
    renderList();
  };
  [fAction, fAccount, fAsset, fState].forEach((el) => {
    el.addEventListener("input", applyFilters);
    el.addEventListener("change", applyFilters);
  });

  /* ---------- boot ---------- */
  initThree();
  refreshAll();
  setStatus("Ready. Simulated ledger \u2014 no real value moves here.");
  const offReceipt = facade.on("receipt", () => { if (suppressRefresh === 0) refreshAll(); });

  try {
    if (new URLSearchParams(window.location.search).get("selftest") === "1") {
      const box = $("selftest");
      box.hidden = false;
      const rows = runTokenLifecycleSelfTest(createTokenEngine);
      const passed = rows.filter((r) => r.ok).length;
      box.innerHTML = '<h2>Self-test \u2014 ' + passed + "/" + rows.length + ' passed</h2><div class="tl-selftest-rows">' +
        rows.map((r) => '<div class="tl-selftest-row ' + (r.ok ? "ok" : "bad") + '">' + (r.ok ? "\u2713" : "\u2717") + " " + esc(r.name) + (r.detail ? " \u2014 " + esc(r.detail) : "") + '</div>').join("") +
        '</div>';
    }
  } catch { /* self-test is best-effort */ }

  return {
    facade,
    engine,
    refresh: () => refreshAll(),
    select: selectJournal,
    destroy() { offReceipt(); if (three) three.destroy(); root.innerHTML = ""; },
  };
}
