/**
 * Reality Lens Ω — World Gateway tentacles.
 * =============================================================================
 * Tumbo's own design, from his photos: the World Gateway is a central glass
 * hub block with living tentacles stretching out to satellite blocks —
 * Phone, PC, Picture Matter — each running its own simulated time and space
 * (own phase offset, own clock rate, slow self-rotation and bob), connected
 * to the hub but independent. Still one reality.
 *
 * Projection only: glass cubes and curves. No provider, network, identity,
 * execution, or authority path anywhere in this file.
 *
 * Product laws honored here:
 * - "DON'T DISPLAY INFORMATION. MATERIALIZE IT." — satellites start closed
 *   and compact. A satellite's detail chip materializes only on user
 *   interaction (tap/click, keyboard). Nothing auto-opens, ever.
 * - Three.js is projection-only, never system authority.
 *
 * The module is three.js-injected (`three` arrives as a parameter, like
 * token-gamification) so the pure core — satellite definitions, independent
 * clocks, tentacle curve math, materialization state — is fully unit-testable
 * with no WebGL and no DOM.
 */

export const GATEWAY_TENTACLES_SOURCE = "gateway-tentacles";
export const GATEWAY_TENTACLES_VERSION = "1.0.0";

/** Hub placement in world units. */
export const GATEWAY_HUB_POSITION = Object.freeze({ x: 0, y: 3.4, z: 0 });
export const GATEWAY_HUB_SIZE = 2.2;

/**
 * The three satellites. Each carries its own clock:
 * - `phase`:       offset in seconds added to the shared elapsed time.
 * - `timeScale`:    rate multiplier — each satellite's second ticks at its own speed.
 * - `orbitSpeed`:   radians of orbit per local second.
 * - `bobAmp`/`bobSpeed`: vertical drift per local second.
 * - `spinSpeed`:    self-rotation radians per local second.
 * Visibly "own time, still one reality": same shared `elapsedSec` in, three
 * different local times out.
 */
export const GATEWAY_SATELLITES = Object.freeze([
  Object.freeze({
    id: "phone",
    label: "Phone",
    blurb: "Hand-held threshold. Its own clock runs a touch fast — the device in Tumbo's pocket keeps its own time.",
    phase: 0.0,
    timeScale: 1.18,
    orbitRadius: 7.6,
    orbitSpeed: 0.10,
    orbitBaseAngle: 0.6,
    bobAmp: 0.34,
    bobSpeed: 0.85,
    spinSpeed: 0.35,
    size: 1.15,
    tint: 0x7fd4ff,
  }),
  Object.freeze({
    id: "pc",
    label: "PC",
    blurb: "Desk anchor. Steady and slow — the workstation's clock is the most patient of the three.",
    phase: 2.4,
    timeScale: 0.82,
    orbitRadius: 8.6,
    orbitSpeed: 0.075,
    orbitBaseAngle: 2.7,
    bobAmp: 0.26,
    bobSpeed: 0.6,
    spinSpeed: 0.22,
    size: 1.35,
    tint: 0xb79bff,
  }),
  Object.freeze({
    id: "picture-matter",
    label: "Picture Matter",
    blurb: "Image threshold. Drifts between the others — pictures remember their own moment.",
    phase: 4.6,
    timeScale: 1.0,
    orbitRadius: 7.0,
    orbitSpeed: 0.12,
    orbitBaseAngle: 4.8,
    bobAmp: 0.42,
    bobSpeed: 1.05,
    spinSpeed: 0.45,
    size: 1.0,
    tint: 0x8fe8b8,
  }),
]);

export const GATEWAY_SATELLITE_IDS = Object.freeze(GATEWAY_SATELLITES.map((s) => s.id));

export function getSatellite(id) {
  return GATEWAY_SATELLITES.find((s) => s.id === id) ?? null;
}

/** A satellite's own simulated time, in seconds, for a shared elapsed time. */
export function satelliteLocalTime(sat, elapsedSec) {
  const t = Number(elapsedSec);
  const base = Number.isFinite(t) ? t : 0;
  return base * sat.timeScale + sat.phase;
}

/** World-space position of a satellite for a shared elapsed time. Plain object, no THREE. */
export function satellitePosition(sat, elapsedSec, hub = GATEWAY_HUB_POSITION) {
  const local = satelliteLocalTime(sat, elapsedSec);
  const angle = sat.orbitBaseAngle + local * sat.orbitSpeed;
  return {
    x: hub.x + Math.cos(angle) * sat.orbitRadius,
    y: hub.y + Math.sin(local * sat.bobSpeed) * sat.bobAmp,
    z: hub.z + Math.sin(angle) * sat.orbitRadius,
  };
}

/** Self-rotation of a satellite for a shared elapsed time (radians). */
export function satelliteSpin(sat, elapsedSec) {
  return satelliteLocalTime(sat, elapsedSec) * sat.spinSpeed;
}

/**
 * Control points for one tentacle: hub surface → lifted mid points → satellite.
 * Returns an array of [x, y, z] triples, pure math, no THREE. `swayPhase`
 * (seconds) offsets the mid points perpendicular for the idle sway; pass 0
 * for the rest pose.
 */
export function tentacleControlPoints(hubPos, satPos, swayPhase = 0, swayAmp = 0.35) {
  const hx = hubPos.x, hy = hubPos.y, hz = hubPos.z;
  const sx = satPos.x, sy = satPos.y, sz = satPos.z;
  const dx = sx - hx, dy = sy - hy, dz = sz - hz;
  const dist = Math.hypot(dx, dy, dz) || 1;
  // Perpendicular in the XZ plane for the sway.
  const px = -dz / dist, pz = dx / dist;
  const sway = Math.sin(swayPhase) * swayAmp;
  const lift = 1.1 + dist * 0.08;
  const point = (t, liftScale, swayScale) => [
    hx + dx * t + px * sway * swayScale,
    hy + dy * t + lift * liftScale,
    hz + dz * t + pz * sway * swayScale,
  ];
  return [
    [hx + (dx / dist) * (GATEWAY_HUB_SIZE / 2), hy, hz + (dz / dist) * (GATEWAY_HUB_SIZE / 2)],
    point(0.30, 1.0, 1.0),
    point(0.62, 0.72, 1.35),
    point(0.86, 0.30, 0.8),
    [sx, sy, sz],
  ];
}

/** Materialization state: the view starts closed and every chip starts shut. */
export function createTentacleState() {
  return { viewOpen: false, openSatelliteId: null, focusedSatelliteId: null };
}

export function toggleSatelliteChip(state, id) {
  if (!state || !getSatellite(id)) return state;
  state.openSatelliteId = state.openSatelliteId === id ? null : id;
  return state;
}

export function closeSatelliteChip(state) {
  if (state) state.openSatelliteId = null;
  return state;
}

export function focusSatellite(state, id) {
  if (state && getSatellite(id)) state.focusedSatelliteId = id;
  return state;
}

/* ------------------------------------------------------------------ */
/* THREE-bound mounting (injected `three`, like token-gamification).    */
/* ------------------------------------------------------------------ */

const STYLE_ID = "gt-style";
const CHIP_ID = "gt-chip";
const BAR_ID = "gt-bar";

const CSS = `
#${BAR_ID}{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:46;display:none;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(127,212,255,.3);border-radius:999px;background:rgba(6,18,30,.88);backdrop-filter:blur(12px)}
#${BAR_ID}[data-open="true"]{display:flex}
#${BAR_ID} .gt-title{font-size:9px;letter-spacing:.22em;color:#9adcff;text-transform:uppercase;padding:0 6px}
#${BAR_ID} button{appearance:none;min-height:44px;border:1px solid rgba(157,219,240,.24);border-radius:999px;padding:8px 14px;background:rgba(70,139,163,.12);color:#cfe9f5;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;touch-action:manipulation;white-space:nowrap}
#${BAR_ID} button:hover,#${BAR_ID} button:focus-visible{border-color:rgba(204,247,255,.72);color:#fff;outline:none}
#${CHIP_ID}{position:fixed;left:50%;bottom:86px;transform:translateX(-50%) translateY(8px);z-index:46;max-width:min(400px,calc(100vw - 32px));padding:12px 14px;border:1px solid rgba(127,212,255,.34);border-radius:16px;background:linear-gradient(165deg,rgba(8,22,34,.96),rgba(4,10,18,.95));box-shadow:0 18px 60px rgba(0,0,0,.6),inset 0 0 30px rgba(127,212,255,.08);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease}
#${CHIP_ID}[data-open="true"]{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}
#${CHIP_ID} .gt-eyebrow{font-size:9px;letter-spacing:.2em;color:#7fd4ff;text-transform:uppercase}
#${CHIP_ID} h2{margin:4px 0 6px;font-size:17px;color:#eaf7ff;letter-spacing:.01em}
#${CHIP_ID} p{margin:0 0 8px;color:#a9c6d4;font-size:10px;line-height:1.45}
#${CHIP_ID} .gt-clock{font-size:9px;letter-spacing:.08em;color:#8fe8b8;text-transform:uppercase;font-variant-numeric:tabular-nums}
#${CHIP_ID} .gt-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px}
#gt-chip-close{appearance:none;min-width:44px;min-height:44px;border:1px solid rgba(157,219,240,.24);border-radius:8px;background:rgba(70,139,163,.12);color:#b2d8e4;font-size:15px;line-height:1;cursor:pointer;touch-action:manipulation}
#gt-chip-close:hover,#gt-chip-close:focus-visible{border-color:rgba(204,247,255,.72);color:#fff;outline:none}`;

function makeEl(doc, tag, className, text) {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

/**
 * Mount the Gateway tentacles into a shared 3D world.
 *
 * @param {object} args
 * @param {object} args.three        The repo-pinned THREE namespace (injected).
 * @param {object} args.parent      Object3D to attach the tentacle group to (world or scene).
 * @param {object} args.camera      Camera, for tap raycasting.
 * @param {object} args.documentRoot Document-ish root for the chip + listeners.
 * @param {Function} args.onOpenConstellation () => void — entry to the constellation overview.
 * @returns handle { open, close, dispose, tick, getSnapshot, source, version }
 */
export function mountGatewayTentacles({ three, parent, camera, documentRoot, onOpenConstellation = null } = {}) {
  if (!three || !parent || !camera || !documentRoot) {
    throw new Error("[gateway-tentacles] mount requires { three, parent, camera, documentRoot }");
  }
  const doc = documentRoot;
  const reducedMotion =
    typeof doc.defaultView?.matchMedia === "function" &&
    doc.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const compact =
    typeof doc.defaultView?.innerWidth === "number" ? doc.defaultView.innerWidth <= 700 : false;
  const TUBE_SEGMENTS = compact ? 14 : 28;

  const state = createTentacleState();
  const aborter = new AbortController();
  const on = (target, type, handler, options) =>
    target.addEventListener(type, handler, { ...(options ?? {}), signal: aborter.signal });

  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  const group = new three.Group();
  group.name = "gateway-tentacles";
  group.visible = false;

  const disposables = [];
  const track = (obj) => { disposables.push(obj); return obj; };

  function glassMaterial(tint, opacity = 0.5) {
    return track(new three.MeshStandardMaterial({
      color: tint, transparent: true, opacity, roughness: 0.15, metalness: 0.1,
      depthWrite: false, emissive: tint, emissiveIntensity: 0.22,
    }));
  }
  function edgeMaterial(tint, opacity = 0.85) {
    return track(new three.LineBasicMaterial({ color: tint, transparent: true, opacity }));
  }

  // --- hub ---
  const hubGeo = track(new three.BoxGeometry(GATEWAY_HUB_SIZE, GATEWAY_HUB_SIZE, GATEWAY_HUB_SIZE));
  const hub = new three.Mesh(hubGeo, glassMaterial(0x9adcff, 0.42));
  hub.position.set(GATEWAY_HUB_POSITION.x, GATEWAY_HUB_POSITION.y, GATEWAY_HUB_POSITION.z);
  hub.add(new three.LineSegments(track(new three.EdgesGeometry(hubGeo)), edgeMaterial(0xdff3ff)));
  const hubCore = new three.Mesh(
    track(new three.BoxGeometry(GATEWAY_HUB_SIZE * 0.45, GATEWAY_HUB_SIZE * 0.45, GATEWAY_HUB_SIZE * 0.45)),
    glassMaterial(0xeaf7ff, 0.5),
  );
  hub.add(hubCore);
  group.add(hub);

  // --- satellites + tentacles ---
  const satelliteMeshes = new Map(); // id -> Mesh
  const tentacleTubes = new Map();   // id -> Mesh (tube)
  const tipGlows = new Map();        // id -> Mesh
  const raycastTargets = [];

  for (const sat of GATEWAY_SATELLITES) {
    const geo = track(new three.BoxGeometry(sat.size, sat.size, sat.size));
    const mesh = new three.Mesh(geo, glassMaterial(sat.tint, 0.5));
    mesh.add(new three.LineSegments(track(new three.EdgesGeometry(geo)), edgeMaterial(0xdff3ff, 0.7)));
    mesh.userData.satelliteId = sat.id;
    const pos = satellitePosition(sat, 0);
    mesh.position.set(pos.x, pos.y, pos.z);
    group.add(mesh);
    satelliteMeshes.set(sat.id, mesh);
    raycastTargets.push(mesh);

    const tubeMat = track(new three.MeshStandardMaterial({
      color: sat.tint, transparent: true, opacity: 0.4, roughness: 0.35,
      metalness: 0.05, depthWrite: false, emissive: sat.tint, emissiveIntensity: 0.35,
    }));
    const tube = new three.Mesh(track(new three.BufferGeometry()), tubeMat);
    tube.frustumCulled = false;
    group.add(tube);
    tentacleTubes.set(sat.id, tube);

    const tip = new three.Mesh(track(new three.SphereGeometry(0.12, 12, 10)), glassMaterial(sat.tint, 0.8));
    group.add(tip);
    tipGlows.set(sat.id, tip);
  }

  parent.add(group);

  function rebuildTentacle(sat, elapsedSec) {
    const mesh = satelliteMeshes.get(sat.id);
    const tube = tentacleTubes.get(sat.id);
    if (!mesh || !tube) return;
    const satPos = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
    const swayPhase = reducedMotion ? 0 : elapsedSec * 0.7 + sat.phase;
    const pts = tentacleControlPoints(GATEWAY_HUB_POSITION, satPos, swayPhase)
      .map(([x, y, z]) => new three.Vector3(x, y, z));
    const curve = new three.CatmullRomCurve3(pts);
    const old = tube.geometry;
    tube.geometry = track(new three.TubeGeometry(curve, TUBE_SEGMENTS, 0.085, 6, false));
    if (old && typeof old.dispose === "function") {
      const idx = disposables.indexOf(old);
      if (idx !== -1) disposables.splice(idx, 1);
      old.dispose();
    }
    const tip = tipGlows.get(sat.id);
    if (tip) tip.position.set(satPos.x, satPos.y, satPos.z);
  }

  /** Advance the simulation to a shared elapsed time (seconds). Called by the rAF loop; exposed for tests. */
  function tick(elapsedSec) {
    const t = Number(elapsedSec);
    const now = Number.isFinite(t) ? t : 0;
    if (!reducedMotion) {
      const pulse = 1 + Math.sin(now * 1.15) * 0.022;
      hub.scale.set(pulse, pulse, pulse);
      hub.rotation.y = now * 0.12;
    }
    for (const sat of GATEWAY_SATELLITES) {
      const mesh = satelliteMeshes.get(sat.id);
      if (!mesh) continue;
      const pos = satellitePosition(sat, now);
      mesh.position.set(pos.x, pos.y, pos.z);
      if (!reducedMotion) mesh.rotation.y = satelliteSpin(sat, now);
      // Focus ring: brighten the focused satellite's edges.
      const focused = state.focusedSatelliteId === sat.id;
      mesh.material.emissiveIntensity = focused ? 0.55 : 0.22;
      rebuildTentacle(sat, now);
    }
    updateChipClock(now);
  }

  /* ---------------- detail chip (materializes on interaction) ---------------- */

  const chip = makeEl(doc, "section");
  chip.id = CHIP_ID;
  chip.setAttribute("data-open", "false");
  chip.setAttribute("aria-hidden", "true");
  chip.setAttribute("aria-label", "Gateway satellite detail");
  const chipEyebrow = makeEl(doc, "div", "gt-eyebrow", "WORLD GATEWAY · SATELLITE");
  const chipTitle = makeEl(doc, "h2", null, "");
  const chipBlurb = makeEl(doc, "p", null, "");
  const chipClock = makeEl(doc, "div", "gt-clock", "");
  chipClock.setAttribute("role", "status");
  const chipRow = makeEl(doc, "div", "gt-row");
  const chipHint = makeEl(doc, "span", "gt-clock", "tap again or Esc to close");
  const chipClose = makeEl(doc, "button", null, "×");
  chipClose.id = "gt-chip-close";
  chipClose.type = "button";
  chipClose.setAttribute("aria-label", "Close satellite detail");
  chipRow.append(chipHint, chipClose);
  chip.append(chipEyebrow, chipTitle, chipBlurb, chipClock, chipRow);
  (doc.body ?? doc).appendChild(chip);

  // View bar: entry point to the constellation overview.
  const bar = makeEl(doc, "div");
  bar.id = BAR_ID;
  bar.setAttribute("data-open", "false");
  bar.setAttribute("aria-hidden", "true");
  bar.setAttribute("aria-label", "World Gateway view controls");
  bar.append(makeEl(doc, "span", "gt-title", "World Gateway · Tentacles"));
  const constellationBtn = makeEl(doc, "button", null, "✦ Constellation");
  constellationBtn.type = "button";
  bar.append(constellationBtn);
  (doc.body ?? doc).appendChild(bar);
  on(constellationBtn, "click", () => { try { onOpenConstellation?.(); } catch { /* best-effort */ } });

  function renderChrome() {
    bar.setAttribute("data-open", String(state.viewOpen));
    bar.setAttribute("aria-hidden", String(!state.viewOpen));
    const sat = getSatellite(state.openSatelliteId);
    const open = !!sat;
    chip.setAttribute("data-open", String(open));
    chip.setAttribute("aria-hidden", String(!open));
    if (sat) {
      chipTitle.textContent = sat.label;
      chipBlurb.textContent = sat.blurb;
    }
  }

  function updateChipClock(elapsedSec) {
    const sat = getSatellite(state.openSatelliteId);
    if (!sat) return;
    const local = satelliteLocalTime(sat, elapsedSec);
    chipClock.textContent = `own time t+${local.toFixed(1)}s · ×${sat.timeScale} · still one reality`;
  }

  function openChip(id) {
    toggleSatelliteChip(state, id);
    // One chip at a time is the materialization rule.
    renderChrome();
    if (state.openSatelliteId) chipClose.focus?.({ preventScroll: true });
  }

  on(chipClose, "click", () => { closeSatelliteChip(state); renderChrome(); });

  /* ---------------- input: tap + keyboard ---------------- */

  const raycaster = new three.Raycaster();
  const ndc = new three.Vector2();
  let downAt = 0, downX = 0, downY = 0;

  function pickSatellite(clientX, clientY) {
    const w = doc.defaultView?.innerWidth ?? 1;
    const h = doc.defaultView?.innerHeight ?? 1;
    ndc.set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(raycastTargets, false);
    return hits.length > 0 ? hits[0].object?.userData?.satelliteId ?? null : null;
  }

  // Tap (not drag): pointerdown/up with a small movement + time budget.
  on(doc, "pointerdown", (event) => {
    if (!state.viewOpen) return;
    downAt = Date.now(); downX = event.clientX ?? 0; downY = event.clientY ?? 0;
  });
  on(doc, "pointerup", (event) => {
    if (!state.viewOpen) return;
    const moved = Math.hypot((event.clientX ?? 0) - downX, (event.clientY ?? 0) - downY);
    if (moved > 10 || Date.now() - downAt > 600) return;
    // Let the chip's own close button handle its clicks.
    if (event.target?.closest?.(`#${CHIP_ID}`)) return;
    const id = pickSatellite(event.clientX ?? 0, event.clientY ?? 0);
    if (id) { focusSatellite(state, id); openChip(id); }
  });

  function cycleFocus(dir) {
    const ids = GATEWAY_SATELLITE_IDS;
    const cur = ids.indexOf(state.focusedSatelliteId);
    const next = ids[(cur + dir + ids.length) % ids.length];
    focusSatellite(state, next);
  }

  on(doc, "keydown", (event) => {
    if (!state.viewOpen) return;
    const key = event.key;
    if (key === "Escape") {
      if (state.openSatelliteId) { closeSatelliteChip(state); renderChrome(); event.preventDefault(); }
      return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? "")) return;
    if (key === "ArrowRight" || key === "ArrowLeft") {
      cycleFocus(key === "ArrowRight" ? 1 : -1);
      event.preventDefault();
    } else if (key === "Enter" || key === " ") {
      const id = state.focusedSatelliteId ?? GATEWAY_SATELLITE_IDS[0];
      focusSatellite(state, id); openChip(id);
      event.preventDefault();
    } else if (key >= "1" && key <= "3") {
      const id = GATEWAY_SATELLITE_IDS[Number(key) - 1];
      focusSatellite(state, id); openChip(id);
    }
  });

  /* ---------------- loop + lifecycle ---------------- */

  let rafId = 0;
  let disposed = false;
  function frame(nowMs) {
    if (disposed || !state.viewOpen) return;
    rafId = 0;
    tick((nowMs ?? 0) / 1000);
    if (!reducedMotion && typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(frame);
    }
  }

  function open() {
    if (disposed) return;
    state.viewOpen = true;
    group.visible = true;
    renderChrome();
    tick(0);
    if (!reducedMotion && typeof requestAnimationFrame === "function" && !rafId) {
      rafId = requestAnimationFrame(frame);
    }
  }

  function close() {
    state.viewOpen = false;
    group.visible = false;
    closeSatelliteChip(state);
    renderChrome();
    if (rafId && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function dispose() {
    disposed = true;
    close();
    aborter.abort();
    for (const obj of disposables) {
      try { obj.dispose?.(); } catch { /* best-effort */ }
    }
    disposables.length = 0;
    try { parent.remove(group); } catch { /* best-effort */ }
    try { chip.remove(); } catch { /* best-effort */ }
    try { bar.remove(); } catch { /* best-effort */ }
  }

  function getSnapshot() {
    return Object.freeze({
      source: GATEWAY_TENTACLES_SOURCE,
      version: GATEWAY_TENTACLES_VERSION,
      viewOpen: state.viewOpen,
      openSatelliteId: state.openSatelliteId,
      focusedSatelliteId: state.focusedSatelliteId,
      reducedMotion,
      satellites: Object.freeze(GATEWAY_SATELLITES.map((sat) => sat.id)),
    });
  }

  return { open, close, dispose, tick, getSnapshot, source: GATEWAY_TENTACLES_SOURCE, version: GATEWAY_TENTACLES_VERSION };
}
