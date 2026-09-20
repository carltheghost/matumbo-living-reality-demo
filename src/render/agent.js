import * as THREE from "../../vendor/three-r179.1/build/three.module.js";

export const AGENT_BLOCK_SOURCE = "agent-block";

export const AGENT_BLOCK_BOUNDARY =
  "Agents are advisory fixtures. They have no autonomous execution, provider, or tool authority. " +
  "Bot Plaza contracts are fictional local rehearsals; no wallet, chain, custody, settlement, or wagering is available.";

const SECTIONS = Object.freeze([
  Object.freeze({ id: "guide", label: "Guide", kicker: "Luna guide", detail: "Feature wayfinding and local navigation help." }),
  Object.freeze({ id: "design", label: "Design", kicker: "Muse design companion", detail: "Avatar and look drafts, applied locally only." }),
  Object.freeze({ id: "bots", label: "Bots", kicker: "Bot Plaza registry", detail: "Plug-in bots, chat user↔bot and bot↔bot, local only." }),
  Object.freeze({ id: "mesh", label: "Mesh", kicker: "Neural Mesh advisory graph", detail: "Control Tower → Oracle relationships, intent, proposals." }),
]);

const GLASS_BLUE = 0x4aa8ff;

function makeLabelSprite(text, sub) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 96);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(220, 240, 255, 0.96)";
  ctx.font = "600 34px system-ui, sans-serif";
  ctx.fillText(text, 128, 42);
  ctx.fillStyle = "rgba(160, 200, 240, 0.75)";
  ctx.font = "400 20px system-ui, sans-serif";
  ctx.fillText(sub, 128, 72);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.4, 0.9, 1);
  return sprite;
}

function glassMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: GLASS_BLUE,
    metalness: 0.1,
    roughness: 0.12,
    transmission: 0.92,
    thickness: 1.4,
    ior: 1.45,
    transparent: true,
    opacity: 0.96,
    emissive: GLASS_BLUE,
    emissiveIntensity: 0.22,
  });
}

export function createAgentBlock({
  documentRoot = globalThis.document,
  projection = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
  onOpenBot = null,
  registry = null,
  runtime = null,
} = {}) {
  const root = documentRoot ?? globalThis.document;
  let opened = false;
  let selectedSection = "guide";
  let sectionNote = "";
  let projectionRef = projection ?? null;

  // ---- DOM host (created programmatically; no index.html mount points needed)
  const host = root.createElement("div");
  host.id = "agent-block";
  host.hidden = true;
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-label", "Agent block");
  host.style.cssText = [
    "position:fixed", "right:18px", "bottom:18px", "width:min(460px,92vw)",
    "max-height:min(560px,80vh)", "display:flex", "flex-direction:column",
    "background:rgba(8,18,34,0.88)", "border:1px solid rgba(90,170,255,0.45)",
    "border-radius:14px", "backdrop-filter:blur(10px)", "color:#dceeff",
    "font-family:system-ui,sans-serif", "z-index:40", "overflow:hidden",
    "box-shadow:0 12px 40px rgba(20,80,180,0.35)",
  ].join(";");
  const header = root.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(90,170,255,0.25);";
  const title = root.createElement("div");
  title.innerHTML = "<strong>Agent</strong> <span style='opacity:.65;font-size:12px'>guide · design · bots · mesh</span>";
  const closeBtn = root.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close agent block");
  closeBtn.style.cssText = "background:transparent;border:1px solid rgba(120,190,255,.4);color:#dceeff;border-radius:8px;padding:2px 10px;cursor:pointer;";
  header.append(title, closeBtn);
  const canvasWrap = root.createElement("div");
  canvasWrap.style.cssText = "position:relative;width:100%;height:300px;background:radial-gradient(ellipse at 50% 30%,rgba(40,110,220,.18),transparent 70%);";
  const fallback = root.createElement("div");
  fallback.style.cssText = "display:none;padding:10px 14px;flex-direction:column;gap:8px;";
  const detail = root.createElement("div");
  detail.style.cssText = "padding:10px 14px;font-size:13px;line-height:1.5;border-top:1px solid rgba(90,170,255,0.25);min-height:64px;";
  const boundary = root.createElement("div");
  boundary.style.cssText = "padding:8px 14px 12px;font-size:11px;opacity:.6;line-height:1.4;";
  boundary.textContent = AGENT_BLOCK_BOUNDARY;
  host.append(header, canvasWrap, fallback, detail, boundary);
  (root.body ?? root.documentElement).appendChild(host);

  SECTIONS.forEach((section) => {
    const btn = root.createElement("button");
    btn.type = "button";
    btn.textContent = `${section.label} — ${section.kicker}`;
    btn.style.cssText = "text-align:left;background:rgba(60,140,255,.12);border:1px solid rgba(90,170,255,.35);color:#dceeff;border-radius:8px;padding:8px 10px;cursor:pointer;";
    btn.addEventListener("click", () => selectSection(section.id, "fallback"));
    fallback.appendChild(btn);
  });

  // ---- three.js scene (lazy)
  let renderer = null;
  let scene3d = null;
  let camera3d = null;
  let cubes = [];
  let raycaster = null;
  let pointer = null;
  let rafId = 0;
  let webglFailed = false;
  const reducedMotion = typeof root.defaultView?.matchMedia === "function"
    && root.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function botCount() {
    try {
      const bots = registry?.listBots?.();
      return Array.isArray(bots) ? bots.length : 0;
    } catch { return 0; }
  }

  function initScene() {
    if (renderer || webglFailed) return;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      webglFailed = true;
      canvasWrap.style.display = "none";
      fallback.style.display = "flex";
      return;
    }
    renderer.setPixelRatio(Math.min(root.defaultView?.devicePixelRatio ?? 1, 2));
    const w = canvasWrap.clientWidth || 440;
    const h = canvasWrap.clientHeight || 300;
    renderer.setSize(w, h);
    canvasWrap.appendChild(renderer.domElement);

    scene3d = new THREE.Scene();
    camera3d = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    camera3d.position.set(0, 1.6, 7.2);
    camera3d.lookAt(0, 0.4, 0);

    scene3d.add(new THREE.AmbientLight(0xbfe0ff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 6, 5);
    scene3d.add(key);
    const rim = new THREE.PointLight(GLASS_BLUE, 24, 30);
    rim.position.set(-4, 2, -3);
    scene3d.add(rim);

    const spacing = 2.15;
    cubes = SECTIONS.map((section, i) => {
      const x = (i - 1.5) * spacing;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.35, 1.35), glassMaterial());
      mesh.position.set(x, 0.4, 0);
      mesh.userData.sectionId = section.id;
      scene3d.add(mesh);
      const label = makeLabelSprite(section.label, section.kicker);
      label.position.set(x, 1.65, 0);
      scene3d.add(label);
      return { section, mesh, label, baseY: 0.4, phase: i * 1.7 };
    });

    const lineMat = new THREE.LineBasicMaterial({ color: GLASS_BLUE, transparent: true, opacity: 0.5 });
    for (let i = 0; i < cubes.length - 1; i++) {
      const a = cubes[i].mesh.position;
      const b = cubes[i + 1].mesh.position;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, a.y, a.z),
        new THREE.Vector3(b.x, b.y, b.z),
      ]);
      scene3d.add(new THREE.Line(geo, lineMat));
    }

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    renderer.domElement.style.cursor = "pointer";
    renderer.domElement.addEventListener("click", (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera3d);
      const hits = raycaster.intersectObjects(cubes.map((c) => c.mesh));
      if (hits.length) selectSection(hits[0].object.userData.sectionId, "cube");
    });

    highlightSelected();
    if (reducedMotion) {
      renderer.render(scene3d, camera3d);
    } else {
      const tick = (t) => {
        rafId = requestAnimationFrame(tick);
        const time = t / 1000;
        cubes.forEach(({ mesh, label, baseY, phase }) => {
          mesh.position.y = baseY + Math.sin(time * 1.1 + phase) * 0.12;
          mesh.rotation.y = Math.sin(time * 0.4 + phase) * 0.18;
          label.position.y = 1.65 + Math.sin(time * 1.1 + phase) * 0.12;
        });
        renderer.render(scene3d, camera3d);
      };
      rafId = requestAnimationFrame(tick);
    }
  }

  function highlightSelected() {
    cubes.forEach(({ section, mesh }) => {
      mesh.material.emissiveIntensity = section.id === selectedSection ? 0.65 : 0.22;
    });
  }

  function renderDetail() {
    const section = SECTIONS.find((s) => s.id === selectedSection) ?? SECTIONS[0];
    let extra = section.detail;
    if (section.id === "bots") extra += ` ${botCount()} bot(s) registered locally.`;
    if (sectionNote) extra += ` ${sectionNote}`;
    detail.textContent = `${section.label} — ${section.kicker}. ${extra}`;
  }

  function snapshot(action = "read", method = "api") {
    return Object.freeze({
      source: AGENT_BLOCK_SOURCE,
      featureId: "agent",
      action,
      method,
      opened,
      selectedSection,
      sections: SECTIONS.map((s) => s.id),
      botCount: botCount(),
      simulation: true,
      advisoryOnly: true,
      localOnly: true,
      deterministic: true,
      externalNetwork: false,
      providerAccess: false,
      toolAccess: false,
      autonomousExecution: false,
      executable: false,
      boundary: AGENT_BLOCK_BOUNDARY,
    });
  }

  function selectSection(sectionId, method = "api") {
    if (!SECTIONS.some((s) => s.id === sectionId)) return;
    selectedSection = sectionId;
    sectionNote = "";
    highlightSelected();
    renderDetail();
    onSelect?.(snapshot("select-section", `${AGENT_BLOCK_SOURCE}:${method}`));
  }

  function open(source = "api") {
    initScene();
    host.hidden = false;
    opened = true;
    renderDetail();
    return snapshot("open", source);
  }

  function openWithBot(botId) {
    const snap = open("open-with-bot");
    sectionNote = botId ? `Focused bot: ${String(botId)}. Chat stays local; no external bot APIs.` : "";
    selectSection("bots", "open-with-bot");
    onOpenBot?.(botId ?? null, snapshot("open-with-bot", AGENT_BLOCK_SOURCE));
    return snap;
  }

  function close(source = "api") {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    host.hidden = true;
    opened = false;
    return snapshot("close", source);
  }

  function replay(source = "api") {
    open(source);
    const order = ["guide", "design", "bots", "mesh"];
    order.forEach((id) => selectSection(id, "replay"));
    const snap = snapshot("replay", source);
    onReplay?.(snap);
    return snap;
  }

  function syncProjection(next) {
    projectionRef = next ?? projectionRef;
    return snapshot("sync", "projection");
  }

  function reset(source = "api") {
    sectionNote = "";
    selectSection("guide", "reset");
    const snap = snapshot("reset", source);
    onReset?.(snap);
    return snap;
  }

  closeBtn.addEventListener("click", () => close("close-button"));
  renderDetail();

  return Object.freeze({
    open,
    openWithBot,
    close,
    replay,
    reset,
    syncProjection,
    getSnapshot: () => snapshot("read", "api"),
  });
}

export default createAgentBlock;
