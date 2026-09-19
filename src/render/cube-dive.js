// cube-dive.js — Cube Dive Transport renderer (camera choreography + interior).
//
// Orchestrates the ~1.2s cinematic that flies the camera through a portal
// cube's face and lands it inside an inverted cube-shell "world", with a
// compact inside-HUD (Inside {feature} · Dive deeper · Next cube → · ← Field).
// Inside-to-inside hops fly straight into the next cube without returning
// to the field.
//
// All motion is local projection only: no network, no storage, no wallet,
// no custody, no mainnet, no external execution. Pure Three.js camera work.
//
// Usage: createCubeDive({...}); call beginDive()/beginHop()/beginDeeper()/
// beginExit()/cancel() from main.js; call update(dt) every frame.

import {
  createCubeDiveState,
  diveTransition,
  CUBE_DIVE_DURATION_MS,
  CUBE_DIVE_EXIT_DURATION_MS,
  CUBE_DIVE_HOP_DURATION_MS,
  CUBE_DIVE_BOUNDARY,
} from "../domains/cube-dive.js";

const PHASES = Object.freeze({
  APPROACH: "approach",
  PASS: "pass",
  SETTLE: "settle",
  SWEEP: "sweep",
  RISE: "rise",
  RETURN: "return",
});

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeInOutCubic(t) {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function makeVec(three, x = 0, y = 0, z = 0) {
  if (three?.Vector3) return new three.Vector3(x, y, z);
  return { x, y, z, clone() { return { ...this }; }, lerp(v, t) { this.x = lerp(this.x, v.x, t); this.y = lerp(this.y, v.y, t); this.z = lerp(this.z, v.z, t); return this; } };
}

function cloneVec(v) {
  if (typeof v?.clone === "function") return v.clone();
  return { ...(v ?? { x: 0, y: 0, z: 0 }) };
}

export function createCubeDive({
  three = null,
  scene = null,
  camera = null,
  controls = null,
  documentRoot = globalThis.document ?? null,
  reducedMotion = false,
  // (blockId) => world-space center of the cube, or null.
  getBlockCenter = () => null,
  // (blockId) => half edge length of the cube.
  getBlockHalfSize = () => 0.45,
  // (featureId) => accent hex for the interior shell tint.
  getFeatureAccent = () => 0x37d9d0,
  // (type, detail) => void — dive-start | dive-arrived | dive-deeper-arrived |
  // hop-arrived | dive-exited | dive-cancelled
  onEvent = null,
} = {}) {
  const state = createCubeDiveState();
  let flight = null; // active camera flight descriptor
  let shell = null; // interior inverted-shell mesh
  let flashEl = null; // fullscreen flash/fade overlay
  let hudEl = null; // inside HUD
  let savedFieldPose = null;
  let savedControlLimits = null;
  let finished = false;

  const emit = (type, detail = {}) => {
    try { onEvent?.(type, { boundary: CUBE_DIVE_BOUNDARY, ...detail }); } catch { /* never break the loop */ }
  };

  // ---------- DOM: flash overlay + inside HUD ----------

  function ensureFlash() {
    if (flashEl || !documentRoot?.createElement) return flashEl;
    flashEl = documentRoot.createElement("div");
    flashEl.id = "cube-dive-flash";
    flashEl.setAttribute("aria-hidden", "true");
    flashEl.style.cssText =
      "position:fixed;inset:0;pointer-events:none;opacity:0;z-index:1200;" +
      "background:radial-gradient(circle at 50% 50%, rgba(255,255,255,0.95), rgba(160,220,255,0.55) 45%, rgba(4,8,12,0.9) 100%);";
    documentRoot.body?.appendChild(flashEl);
    return flashEl;
  }

  function setFlash(opacity) {
    const el = ensureFlash();
    if (el) el.style.opacity = String(clamp01(opacity));
  }

  function ensureHud() {
    if (hudEl || !documentRoot?.createElement) return hudEl;
    hudEl = documentRoot.createElement("aside");
    hudEl.id = "cube-dive-hud";
    hudEl.setAttribute("aria-label", "Inside cube");
    hudEl.hidden = true;
    const title = documentRoot.createElement("div");
    title.className = "cube-dive-hud-title";
    const row = documentRoot.createElement("div");
    row.className = "cube-dive-hud-row";
    const mk = (id, text, action) => {
      const b = documentRoot.createElement("button");
      b.type = "button";
      b.id = id;
      b.textContent = text;
      b.addEventListener("click", () => action());
      return b;
    };
    row.append(
      mk("cube-dive-deeper", "Dive deeper", () => emit("dive-deeper-request")),
      mk("cube-dive-next", "Next cube →", () => emit("hop-next-request")),
      mk("cube-dive-field", "← Field", () => emit("exit-field-request")),
    );
    hudEl.append(title, row);
    documentRoot.body?.appendChild(hudEl);
    return hudEl;
  }

  function showHud(label) {
    const hud = ensureHud();
    if (!hud) return;
    const title = hud.querySelector?.(".cube-dive-hud-title");
    if (title) title.textContent = `Inside ${label}`;
    hud.hidden = false;
  }

  function hideHud() {
    if (hudEl) hudEl.hidden = true;
  }

  function hudVisible() {
    return !!hudEl && hudEl.hidden !== true;
  }

  // ---------- interior shell ----------

  function buildShell(featureId) {
    disposeShell();
    if (!three || !scene) return;
    const size = 7;
    const geo = new three.BoxGeometry(size, size, size);
    const accent = getFeatureAccent(featureId);
    const mat = new three.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0,
      side: three.BackSide,
      depthWrite: false,
      fog: false,
    });
    shell = new three.Mesh(geo, mat);
    shell.renderOrder = -10;
    scene.add(shell);
  }

  function disposeShell() {
    if (!shell) return;
    try {
      scene?.remove(shell);
      shell.geometry?.dispose?.();
      shell.material?.dispose?.();
    } catch { /* noop */ }
    shell = null;
  }

  function setShellOpacity(v) {
    if (shell?.material) shell.material.opacity = clamp01(v);
  }

  // ---------- input lock ----------

  function lockInput() {
    if (controls) {
      savedControlLimits = {
        enabled: controls.enabled,
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
      };
      controls.enabled = false;
      // The interior is closer than the field's min distance; relax while diving.
      if (typeof controls.minDistance === "number") controls.minDistance = 0;
    }
  }

  function unlockInput() {
    if (controls && savedControlLimits) {
      controls.enabled = savedControlLimits.enabled;
      if (typeof controls.minDistance === "number") controls.minDistance = savedControlLimits.minDistance;
      if (typeof controls.maxDistance === "number") controls.maxDistance = savedControlLimits.maxDistance;
    }
    savedControlLimits = null;
  }

  function saveFieldPose() {
    if (!camera) return;
    savedFieldPose = {
      position: cloneVec(camera.position),
      target: controls ? cloneVec(controls.target) : cloneVec(camera.position),
    };
  }

  // ---------- flight construction ----------

  function facePoint(center, halfSize) {
    // Approach the face pointing most toward the camera.
    const from = camera ? camera.position : { x: center.x, y: center.y, z: center.z + 10 };
    const dir = { x: from.x - center.x, y: from.y - center.y, z: from.z - center.z };
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dist = halfSize + 1.6;
    return makeVec(three, center.x + (dir.x / len) * dist, center.y + (dir.y / len) * dist, center.z + (dir.z / len) * dist);
  }

  function startFlight({ kind, fromBlockId, toBlockId, featureId, label, level, contentWorldPos = null, onDone }) {
    const center = getBlockCenter(toBlockId);
    if (!center) {
      // No resolvable geometry (or no THREE): jump-cut the state, keep HUD honest.
      const res = kind === "exit" ? diveTransition(state, "land") : diveTransition(state, "arrive");
      if (kind === "exit") {
        hideHud();
        disposeShell();
        emit("dive-exited", { snapshot: res.snapshot });
      } else {
        if (res.ok) showHud(res.snapshot?.label ?? label);
        emit(kind === "hop" ? "hop-arrived" : kind === "deeper" ? "dive-deeper-arrived" : "dive-arrived", { snapshot: res.snapshot });
      }
      onDone?.(res);
      return res;
    }
    const half = Math.max(0.2, getBlockHalfSize(toBlockId) || 0.45);
    const startPos = camera ? cloneVec(camera.position) : makeVec(three);
    const startTgt = controls ? cloneVec(controls.target) : cloneVec(startPos);
    const approach = facePoint(center, half);
    const insidePos = makeVec(three, center.x + half * 0.4, center.y + half * 0.28, center.z + half * 0.62);
    const insideTgt = contentWorldPos
      ? cloneVec(contentWorldPos)
      : makeVec(three, center.x, center.y + half * 0.1, center.z - half * 2.4);

    const phases = [];
    if (kind === "exit") {
      const rise = makeVec(three, center.x, center.y + half + 3.2, center.z + half + 2.4);
      phases.push(
        { name: PHASES.RISE, ms: 420, pos: rise, tgt: makeVec(three, center.x, center.y, center.z), flash: 0.35 },
        {
          name: PHASES.RETURN, ms: 480,
          pos: savedFieldPose ? cloneVec(savedFieldPose.position) : startPos,
          tgt: savedFieldPose ? cloneVec(savedFieldPose.target) : startTgt,
          flash: 0,
        },
      );
    } else if (kind === "hop") {
      const fromCenter = getBlockCenter(fromBlockId) ?? center;
      const lift = makeVec(three, (fromCenter.x + center.x) / 2, Math.max(fromCenter.y, center.y) + 3.4, (fromCenter.z + center.z) / 2);
      phases.push(
        { name: PHASES.SWEEP, ms: 560, pos: lift, tgt: makeVec(three, center.x, center.y, center.z), flash: 0.25 },
        { name: PHASES.APPROACH, ms: 300, pos: approach, tgt: cloneVec(center), flash: 0 },
        { name: PHASES.PASS, ms: 260, pos: cloneVec(center), tgt: insideTgt, flash: 0.85 },
        { name: PHASES.SETTLE, ms: 280, pos: insidePos, tgt: insideTgt, flash: 0 },
      );
    } else if (kind === "deeper") {
      // Already inside the vessel: descend straight to the nested cube with a
      // soft crossfade, no pass-through-the-wall beat.
      const focus = contentWorldPos ? cloneVec(contentWorldPos) : cloneVec(center);
      phases.push(
        { name: PHASES.APPROACH, ms: 520, pos: makeVec(three, focus.x + half * 0.9, focus.y + half * 0.6, focus.z + half * 1.2), tgt: focus, flash: 0.3 },
        { name: PHASES.SETTLE, ms: 380, pos: makeVec(three, focus.x + half * 0.32, focus.y + half * 0.2, focus.z + half * 0.55), tgt: focus, flash: 0 },
      );
    } else {
      // fresh dive: approach -> pass through face -> settle inside
      phases.push(
        { name: PHASES.APPROACH, ms: 460, pos: approach, tgt: cloneVec(center), flash: 0 },
        { name: PHASES.PASS, ms: 300, pos: cloneVec(center), tgt: insideTgt, flash: 0.9 },
        { name: PHASES.SETTLE, ms: 440, pos: insidePos, tgt: insideTgt, flash: 0 },
      );
    }

    const totalMs = phases.reduce((n, p) => n + p.ms, 0);
    flight = {
      kind, toBlockId, featureId, label, level,
      phases, totalMs, elapsed: 0,
      startPos, startTgt,
      shellTargetOpacity: kind === "exit" ? 0 : 0.38,
      onDone,
    };
    if (reducedMotion) {
      // Respect reduced motion: shrink to a quick crossfade.
      flight.phases = flight.phases.slice(-1);
      flight.totalMs = 260;
      flight.phases[0].ms = 260;
    }
    return { ok: true, state: state.state, snapshot: state.active };
  }

  function driveFlight(dtMs) {
    if (!flight) return;
    flight.elapsed += dtMs;
    const f = flight;
    let acc = 0;
    let phase = f.phases[f.phases.length - 1];
    let phaseT = 1;
    for (const p of f.phases) {
      if (f.elapsed <= acc + p.ms) { phase = p; phaseT = (f.elapsed - acc) / p.ms; break; }
      acc += p.ms;
    }
    const e = easeInOutCubic(phaseT);
    // Segment start = previous phase end (or flight start).
    const idx = f.phases.indexOf(phase);
    const prev = idx === 0 ? { pos: f.startPos, tgt: f.startTgt, flash: 0 } : f.phases[idx - 1];
    if (camera) {
      camera.position.set(
        lerp(prev.pos.x, phase.pos.x, e),
        lerp(prev.pos.y, phase.pos.y, e),
        lerp(prev.pos.z, phase.pos.z, e),
      );
      const t = controls?.target;
      if (t) t.set(lerp(prev.tgt.x, phase.tgt.x, e), lerp(prev.tgt.y, phase.tgt.y, e), lerp(prev.tgt.z, phase.tgt.z, e));
      else camera.lookAt(phase.tgt.x, phase.tgt.y, phase.tgt.z);
    }
    const prevFlash = prev.flash ?? 0;
    const nextFlash = phase.flash ?? 0;
    // Flash peaks mid-pass: ramp in on approach->pass, out on pass->settle.
    const flashNow = phase.name === PHASES.PASS
      ? Math.sin(Math.PI * clamp01(phaseT)) * nextFlash
      : lerp(prevFlash, nextFlash, e);
    setFlash(flashNow);
    if (shell && f.kind !== "exit") {
      const center = getBlockCenter(f.toBlockId);
      if (center && typeof shell.position.set === "function") shell.position.set(center.x, center.y, center.z);
      setShellOpacity(f.shellTargetOpacity * easeInOutCubic(clamp01(f.elapsed / f.totalMs)));
    } else if (shell && f.kind === "exit") {
      setShellOpacity(0.38 * (1 - easeInOutCubic(clamp01(f.elapsed / f.totalMs))));
    }
    if (f.elapsed >= f.totalMs) finishFlight();
  }

  function finishFlight() {
    const f = flight;
    flight = null;
    setFlash(0);
    if (!f) return;
    if (f.kind === "exit") {
      const res = diveTransition(state, "land");
      disposeShell();
      hideHud();
      unlockInput();
      emit("dive-exited", { snapshot: res.snapshot });
      f.onDone?.(res);
      return;
    }
    const res = diveTransition(state, "arrive");
    if (res.ok) {
      showHud(res.snapshot?.label ?? f.label);
      emit(f.kind === "hop" ? "hop-arrived" : f.kind === "deeper" ? "dive-deeper-arrived" : "dive-arrived", { snapshot: res.snapshot });
    } else {
      // Arrival failed (state changed underneath); fail safe: restore field pose.
      disposeShell();
      hideHud();
      unlockInput();
    }
    f.onDone?.(res);
  }

  // ---------- public API ----------

  function beginDive({ blockId, featureId, label }) {
    if (state.state !== "field" || finished) return { ok: false, reason: state.state !== "field" ? "already-diving" : "destroyed" };
    const res = diveTransition(state, "begin", { blockId, featureId, label, kind: "dive" });
    if (!res.ok) return res;
    saveFieldPose();
    lockInput();
    buildShell(featureId);
    hideHud();
    emit("dive-start", { snapshot: res.snapshot });
    return startFlight({ kind: "dive", toBlockId: blockId, featureId, label, level: 0 });
  }

  function beginDeeper({ blockId, featureId, label, contentId, contentWorldPos }) {
    if (state.state !== "inside" || finished) return { ok: false, reason: "not-inside" };
    const res = diveTransition(state, "deeper", { label, contentId });
    if (!res.ok) return res;
    emit("dive-deeper-start", { snapshot: res.snapshot });
    return startFlight({ kind: "deeper", toBlockId: blockId, featureId, label, level: res.snapshot.level, contentWorldPos });
  }

  function beginHop({ fromBlockId, blockId, featureId, label }) {
    if (state.state !== "inside" || finished) return { ok: false, reason: "not-inside" };
    const res = diveTransition(state, "hop", { blockId, featureId, label });
    if (!res.ok) return res;
    buildShell(featureId);
    emit("hop-start", { snapshot: res.snapshot });
    return startFlight({ kind: "hop", fromBlockId, toBlockId: blockId, featureId, label, level: 0 });
  }

  function beginExit() {
    if (state.state !== "inside" || finished) return { ok: false, reason: "not-inside" };
    const res = diveTransition(state, "exit");
    if (!res.ok) return res;
    hideHud();
    emit("dive-exit-start", { snapshot: state.active });
    const frame = state.active;
    return startFlight({
      kind: "exit",
      toBlockId: frame?.blockId ?? null,
      featureId: frame?.featureId ?? null,
      label: frame?.label ?? "cube",
      level: 0,
    });
  }

  function cancel() {
    const res = diveTransition(state, "cancel");
    flight = null;
    setFlash(0);
    if (res.ok) {
      if (res.state === "field") { disposeShell(); hideHud(); unlockInput(); }
      else showHud(res.snapshot?.label ?? "");
      emit("dive-cancelled", { snapshot: res.snapshot });
    }
    return res;
  }

  function update(dt = 0.016) {
    if (finished) return;
    if (flight) driveFlight(dt * 1000);
  }

  function getSnapshot() {
    return {
      state: state.state,
      active: state.active ? { ...state.active } : null,
      depth: (state.stack ?? []).length,
      flying: !!flight,
      hudVisible: hudVisible(),
      boundary: CUBE_DIVE_BOUNDARY,
      simulation: true,
      externalTransfer: false,
    };
  }

  function isActive() {
    return state.state === "diving" || state.state === "exiting" || !!flight;
  }

  function isInside() {
    return state.state === "inside";
  }

  function destroy() {
    finished = true;
    flight = null;
    disposeShell();
    if (flashEl) { try { flashEl.remove(); } catch { /* noop */ } flashEl = null; }
    if (hudEl) { try { hudEl.remove(); } catch { /* noop */ } hudEl = null; }
    unlockInput();
  }

  return {
    beginDive, beginDeeper, beginHop, beginExit, cancel,
    update, getSnapshot, isActive, isInside, destroy,
  };
}
