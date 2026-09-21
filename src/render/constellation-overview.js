/**
 * Reality Lens Ω — Constellation overview.
 * =============================================================================
 * Restores the blocks-and-lines opening the old demo had (2026-09-20,
 * "feat: constellation default view"): every feature rendered as a glass cube,
 * cubes connected by lines drawn from the infinite-handoff graph
 * (FEATURE_HANDOFF_LINKS — "one interaction always pushes into the next").
 *
 * Current design language: glass/volumetric cubes, NO flat labels (Tumbo's
 * standing directive). Cubes are identified by family tint; a tapped cube
 * materializes a small detail chip (label, kicker, open-feature action).
 * Nothing auto-opens, ever.
 *
 * The giant-block far view stays the start view — this constellation is a
 * view you open and drift into (story "Constellation" beat, or the entry
 * point in the Gateway tentacles view), matching the story caption:
 * "Drift closer and the block springs open into its constellation of cubes."
 *
 * Projection only: cubes and lines. No provider, network, identity,
 * execution, or authority path anywhere in this file.
 *
 * Like gateway-tentacles.js, `three` is injected so the pure core — layout
 * math, link derivation, materialization state — is unit-testable with no
 * WebGL and no DOM.
 */

export const CONSTELLATION_SOURCE = "constellation-overview";
export const CONSTELLATION_VERSION = "1.0.0";

export const CONSTELLATION_RADIUS = 10.5;
export const CONSTELLATION_CENTER = Object.freeze({ x: 0, y: 5.0, z: 0 });
export const CONSTELLATION_NODE_SIZE = 0.95;

/** Family tints for feature cubes, keyed by kicker prefix. Deterministic. */
const FAMILY_TINTS = Object.freeze([
  0x7fd4ff, // blue
  0xb79bff, // violet
  0x8fe8b8, // green
  0xffd28f, // amber
  0xff9db0, // rose
  0x9adcff, // ice
]);

function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic tint for a feature from its kicker (falls back to id). */
export function nodeTintFor(feature) {
  const key = String(feature?.kicker ?? feature?.id ?? "feature");
  return FAMILY_TINTS[hashString(key) % FAMILY_TINTS.length];
}

/**
 * Deterministic golden-spiral sphere layout. Returns a Map of
 * feature id -> { x, y, z } plain objects. Pure math, no THREE.
 */
export function constellationLayout(nodes, radius = CONSTELLATION_RADIUS, center = CONSTELLATION_CENTER) {
  const positions = new Map();
  const n = nodes.length;
  if (n === 0) return positions;
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;
    positions.set(nodes[i].id, {
      x: center.x + Math.cos(theta) * r * radius,
      y: center.y + y * radius * 0.72,
      z: center.z + Math.sin(theta) * r * radius,
    });
  }
  return positions;
}

/**
 * Link pairs from the handoff graph, filtered to nodes present in the layout.
 * Returns deduplicated [fromId, toId] pairs. Pure data, no THREE.
 */
export function constellationLinks(nodes, handoffLinks) {
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set();
  const pairs = [];
  for (const node of nodes) {
    const targets = handoffLinks?.[node.id];
    if (!Array.isArray(targets)) continue;
    for (const target of targets) {
      if (!ids.has(target) || target === node.id) continue;
      const key = node.id < target ? `${node.id}|${target}` : `${target}|${node.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([node.id, target]);
    }
  }
  return pairs;
}

/** Materialization state: view starts closed, every chip starts shut. */
export function createConstellationState() {
  return { viewOpen: false, openNodeId: null, focusedNodeId: null };
}

function nodeById(nodes, id) {
  return nodes.find((n) => n.id === id) ?? null;
}

export function toggleNodeChip(state, nodes, id) {
  if (!state || !nodeById(nodes, id)) return state;
  state.openNodeId = state.openNodeId === id ? null : id;
  return state;
}

export function closeNodeChip(state) {
  if (state) state.openNodeId = null;
  return state;
}

export function focusNode(state, nodes, id) {
  if (state && nodeById(nodes, id)) state.focusedNodeId = id;
  return state;
}

/* ------------------------------------------------------------------ */
/* THREE-bound mounting (injected `three`).                             */
/* ------------------------------------------------------------------ */

const STYLE_ID = "co-style";
const CHIP_ID = "co-chip";
const BAR_ID = "co-bar";

const CSS = `
#${BAR_ID}{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:46;display:none;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(127,212,255,.3);border-radius:999px;background:rgba(6,18,30,.88);backdrop-filter:blur(12px)}
#${BAR_ID}[data-open="true"]{display:flex}
#${BAR_ID} .co-title{font-size:9px;letter-spacing:.22em;color:#9adcff;text-transform:uppercase;padding:0 6px}
#${BAR_ID} button{appearance:none;min-height:44px;border:1px solid rgba(157,219,240,.24);border-radius:999px;padding:8px 14px;background:rgba(70,139,163,.12);color:#cfe9f5;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;touch-action:manipulation;white-space:nowrap}
#${BAR_ID} button:hover,#${BAR_ID} button:focus-visible{border-color:rgba(204,247,255,.72);color:#fff;outline:none}
#${CHIP_ID}{position:fixed;left:50%;bottom:86px;transform:translateX(-50%) translateY(8px);z-index:46;max-width:min(400px,calc(100vw - 32px));padding:12px 14px;border:1px solid rgba(127,212,255,.34);border-radius:16px;background:linear-gradient(165deg,rgba(8,22,34,.96),rgba(4,10,18,.95));box-shadow:0 18px 60px rgba(0,0,0,.6),inset 0 0 30px rgba(127,212,255,.08);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease}
#${CHIP_ID}[data-open="true"]{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}
#${CHIP_ID} .co-eyebrow{font-size:9px;letter-spacing:.2em;color:#7fd4ff;text-transform:uppercase}
#${CHIP_ID} h2{margin:4px 0 6px;font-size:17px;color:#eaf7ff;letter-spacing:.01em}
#${CHIP_ID} p{margin:0 0 8px;color:#a9c6d4;font-size:10px;line-height:1.45}
#${CHIP_ID} .co-row{display:flex;align-items:center;gap:8px;margin-top:8px}
#${CHIP_ID} .co-row button{appearance:none;min-height:44px;border-radius:9px;padding:8px 12px;font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;cursor:pointer;touch-action:manipulation}
#co-open-feature{flex:1;border:1px solid rgba(143,232,184,.4);background:rgba(52,122,83,.2);color:#d8f5e4}
#co-open-feature:hover,#co-open-feature:focus-visible{border-color:rgba(216,245,228,.8);color:#fff;outline:none}
#co-chip-close{min-width:44px;border:1px solid rgba(157,219,240,.24);background:rgba(70,139,163,.12);color:#b2d8e4;font-size:15px}
#co-chip-close:hover,#co-chip-close:focus-visible{border-color:rgba(204,247,255,.72);color:#fff;outline:none}`;

function makeEl(doc, tag, className, text) {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

/**
 * Mount the constellation overview into a shared 3D world.
 *
 * @param {object} args
 * @param {object} args.three        The repo-pinned THREE namespace (injected).
 * @param {object} args.parent      Object3D to attach to.
 * @param {object} args.camera      Camera, for tap raycasting.
 * @param {object} args.documentRoot Document-ish root for chips + listeners.
 * @param {Array}  args.nodes       [{ id, label, kicker, description }]
 * @param {object} args.links       Handoff graph: { [id]: [id] }
 * @param {Function} args.onOpenFeature  (id) => void — opens a feature from a chip.
 * @param {Function} args.onOpenTentacles () => void — entry back to the Gateway tentacles.
 */
export function mountConstellationOverview({
  three, parent, camera, documentRoot, nodes = [], links = {},
  onOpenFeature = null, onOpenTentacles = null,
} = {}) {
  if (!three || !parent || !camera || !documentRoot) {
    throw new Error("[constellation-overview] mount requires { three, parent, camera, documentRoot }");
  }
  const doc = documentRoot;
  const list = nodes.filter((n) => n && n.id);
  const reducedMotion =
    typeof doc.defaultView?.matchMedia === "function" &&
    doc.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = createConstellationState();
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
  group.name = "constellation-overview";
  group.visible = false;

  const disposables = [];
  const track = (obj) => { disposables.push(obj); return obj; };

  const layout = constellationLayout(list);
  const pairs = constellationLinks(list, links);

  // --- cubes ---
  const nodeMeshes = new Map();
  const raycastTargets = [];
  for (const node of list) {
    const tint = nodeTintFor(node);
    const geo = track(new three.BoxGeometry(CONSTELLATION_NODE_SIZE, CONSTELLATION_NODE_SIZE, CONSTELLATION_NODE_SIZE));
    const mesh = new three.Mesh(geo, track(new three.MeshStandardMaterial({
      color: tint, transparent: true, opacity: 0.5, roughness: 0.15, metalness: 0.1,
      depthWrite: false, emissive: tint, emissiveIntensity: 0.22,
    })));
    mesh.add(new three.LineSegments(
      track(new three.EdgesGeometry(geo)),
      track(new three.LineBasicMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.7 })),
    ));
    mesh.userData.nodeId = node.id;
    const p = layout.get(node.id);
    mesh.position.set(p.x, p.y, p.z);
    group.add(mesh);
    nodeMeshes.set(node.id, mesh);
    raycastTargets.push(mesh);
  }

  // --- connecting lines: one LineSegments for the whole handoff graph ---
  const linePositions = [];
  for (const [a, b] of pairs) {
    const pa = layout.get(a), pb = layout.get(b);
    if (!pa || !pb) continue;
    linePositions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
  }
  const lineGeo = track(new three.BufferGeometry());
  if (typeof lineGeo.setAttribute === "function" && three.Float32BufferAttribute) {
    lineGeo.setAttribute("position", new three.Float32BufferAttribute(linePositions, 3));
  } else if (typeof lineGeo.setAttribute === "function") {
    // Minimal fake-three path: stash raw positions for tests.
    lineGeo.setAttribute("position", { array: linePositions, itemSize: 3 });
  }
  const linkLines = new three.LineSegments(
    lineGeo,
    track(new three.LineBasicMaterial({ color: 0x9adcff, transparent: true, opacity: 0.32 })),
  );
  linkLines.frustumCulled = false;
  group.add(linkLines);

  parent.add(group);

  /** Advance idle motion. Exposed for tests. */
  function tick(elapsedSec) {
    const t = Number(elapsedSec);
    const now = Number.isFinite(t) ? t : 0;
    if (!reducedMotion) {
      group.rotation.y = now * 0.03;
      let i = 0;
      for (const mesh of nodeMeshes.values()) {
        mesh.position.y += Math.sin(now * 0.6 + i * 1.7) * 0.0009;
        mesh.rotation.y = now * 0.1 + i;
        i++;
      }
    }
    for (const [id, mesh] of nodeMeshes) {
      const focused = state.focusedNodeId === id;
      mesh.material.emissiveIntensity = focused ? 0.6 : 0.22;
    }
  }

  /* ---------------- HUD bar + detail chip ---------------- */

  const bar = makeEl(doc, "div");
  bar.id = BAR_ID;
  bar.setAttribute("data-open", "false");
  bar.setAttribute("aria-hidden", "true");
  bar.setAttribute("aria-label", "Constellation overview controls");
  bar.append(makeEl(doc, "span", "co-title", `Constellation · ${list.length} features`));
  const tentaclesBtn = makeEl(doc, "button", null, "Gateway tentacles");
  tentaclesBtn.type = "button";
  const barClose = makeEl(doc, "button", null, "×");
  barClose.type = "button";
  barClose.setAttribute("aria-label", "Close constellation overview");
  bar.append(tentaclesBtn, barClose);
  (doc.body ?? doc).appendChild(bar);

  const chip = makeEl(doc, "section");
  chip.id = CHIP_ID;
  chip.setAttribute("data-open", "false");
  chip.setAttribute("aria-hidden", "true");
  chip.setAttribute("aria-label", "Constellation feature detail");
  const chipEyebrow = makeEl(doc, "div", "co-eyebrow", "CONSTELLATION · FEATURE");
  const chipTitle = makeEl(doc, "h2", null, "");
  const chipBlurb = makeEl(doc, "p", null, "");
  const chipRow = makeEl(doc, "div", "co-row");
  const openBtn = makeEl(doc, "button", null, "Open feature");
  openBtn.id = "co-open-feature";
  openBtn.type = "button";
  const chipClose = makeEl(doc, "button", null, "×");
  chipClose.id = "co-chip-close";
  chipClose.type = "button";
  chipClose.setAttribute("aria-label", "Close feature detail");
  chipRow.append(openBtn, chipClose);
  chip.append(chipEyebrow, chipTitle, chipBlurb, chipRow);
  (doc.body ?? doc).appendChild(chip);

  function renderChrome() {
    bar.setAttribute("data-open", String(state.viewOpen));
    bar.setAttribute("aria-hidden", String(!state.viewOpen));
    const node = nodeById(list, state.openNodeId);
    const open = !!node;
    chip.setAttribute("data-open", String(open));
    chip.setAttribute("aria-hidden", String(!open));
    if (node) {
      chipTitle.textContent = node.label ?? node.id;
      chipBlurb.textContent = node.description ?? node.kicker ?? "";
      chipEyebrow.textContent = `CONSTELLATION · ${node.kicker ?? "feature"}`;
    }
  }

  function openNodeChip(id) {
    toggleNodeChip(state, list, id);
    renderChrome();
    if (state.openNodeId) chipClose.focus?.({ preventScroll: true });
  }

  on(chipClose, "click", () => { closeNodeChip(state); renderChrome(); });
  on(barClose, "click", () => close());
  on(tentaclesBtn, "click", () => { try { onOpenTentacles?.(); } catch { /* best-effort */ } });
  on(openBtn, "click", () => {
    const id = state.openNodeId;
    if (!id) return;
    try { onOpenFeature?.(id); } catch { /* best-effort */ }
  });

  /* ---------------- input: tap + keyboard ---------------- */

  const raycaster = new three.Raycaster();
  const ndc = new three.Vector2();
  let downAt = 0, downX = 0, downY = 0;

  function pickNode(clientX, clientY) {
    const w = doc.defaultView?.innerWidth ?? 1;
    const h = doc.defaultView?.innerHeight ?? 1;
    ndc.set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(raycastTargets, false);
    return hits.length > 0 ? hits[0].object?.userData?.nodeId ?? null : null;
  }

  on(doc, "pointerdown", (event) => {
    if (!state.viewOpen) return;
    downAt = Date.now(); downX = event.clientX ?? 0; downY = event.clientY ?? 0;
  });
  on(doc, "pointerup", (event) => {
    if (!state.viewOpen) return;
    const moved = Math.hypot((event.clientX ?? 0) - downX, (event.clientY ?? 0) - downY);
    if (moved > 10 || Date.now() - downAt > 600) return;
    if (event.target?.closest?.(`#${CHIP_ID},#${BAR_ID}`)) return;
    const id = pickNode(event.clientX ?? 0, event.clientY ?? 0);
    if (id) { focusNode(state, list, id); openNodeChip(id); }
  });

  function cycleFocus(dir) {
    const ids = list.map((n) => n.id);
    if (!ids.length) return;
    const cur = ids.indexOf(state.focusedNodeId);
    focusNode(state, list, ids[(cur + dir + ids.length) % ids.length]);
  }

  on(doc, "keydown", (event) => {
    if (!state.viewOpen) return;
    const key = event.key;
    if (key === "Escape") {
      if (state.openNodeId) { closeNodeChip(state); renderChrome(); event.preventDefault(); }
      return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? "")) return;
    if (key === "ArrowRight" || key === "ArrowLeft") {
      cycleFocus(key === "ArrowRight" ? 1 : -1);
      event.preventDefault();
    } else if (key === "Enter" || key === " ") {
      const id = state.focusedNodeId ?? list[0]?.id;
      if (id) { focusNode(state, list, id); openNodeChip(id); }
      event.preventDefault();
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
    closeNodeChip(state);
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
      source: CONSTELLATION_SOURCE,
      version: CONSTELLATION_VERSION,
      viewOpen: state.viewOpen,
      openNodeId: state.openNodeId,
      focusedNodeId: state.focusedNodeId,
      nodeCount: list.length,
      linkCount: pairs.length,
      reducedMotion,
    });
  }

  return {
    open, close, dispose, tick, getSnapshot,
    source: CONSTELLATION_SOURCE, version: CONSTELLATION_VERSION,
    // Exposed for tests: raw link pairs behind the connecting lines.
    linkPairs: pairs,
  };
}
