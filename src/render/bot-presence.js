/**
 * Bot Plaza 3D presence — every enabled bot gets a small glass-orb hologram
 * floating in a plaza cluster inside the Reality world, with a name tag and
 * floating speech bubbles for its messages. Clicking an orb opens chat.
 *
 * Self-contained: it owns its own animation frame loop and never touches the
 * host's render loop. Reality Lens Ω visual language: glass/volumetric orbs,
 * lens lighting, no floor.
 */

import { BOT_AVATARS } from "../domains/bot-plaza.js?v=20260922-cache2";

export const BOT_PRESENCE_SOURCE = "bot-presence";
export const BOT_PRESENCE_CENTER = Object.freeze({ x: 13.5, y: 5.5, z: -5 });
export const BOT_PRESENCE_RADIUS = 3.4;
export const BOT_PRESENCE_BUBBLE_MS = 6500;

function avatarSpec(avatarId) {
  return BOT_AVATARS.find((entry) => entry.id === avatarId) ?? BOT_AVATARS[0];
}

function makeLabelSprite(THREE, documentRoot, text, color) {
  const canvas = documentRoot.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.font = "600 44px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#f2fbff";
  ctx.fillText(String(text).slice(0, 24), 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.4, 0.85, 1);
  return sprite;
}

export function mountBotPresence({
  three,
  scene,
  camera,
  container,
  documentRoot = globalThis.document,
  getBots = () => [],
  onOrbClick = null,
  reducedMotion = false,
} = {}) {
  const THREE = three;
  if (!THREE || !scene || !camera || !container) throw new TypeError("bot presence needs three, scene, camera, and container");
  const group = new THREE.Group();
  group.position.set(BOT_PRESENCE_CENTER.x, BOT_PRESENCE_CENTER.y, BOT_PRESENCE_CENTER.z);
  scene.add(group);

  // Plaza ring: a faint lens-light torus the orbs hover above.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(BOT_PRESENCE_RADIUS + 0.9, 0.045, 12, 72),
    new THREE.MeshBasicMaterial({ color: 0x2fe8d4, transparent: true, opacity: 0.35 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1.1;
  group.add(ring);

  const bubbleLayer = documentRoot.createElement("div");
  bubbleLayer.className = "bot-presence-bubbles";
  bubbleLayer.setAttribute("aria-hidden", "true");
  container.appendChild(bubbleLayer);

  const orbs = new Map(); // botId -> {group, mesh, label, bubble, bubbleUntil, baseY, phase, bot}
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projected = new THREE.Vector3();
  let raf = 0;
  let frame = 0;
  let destroyed = false;
  let visible = true;
  const textureLoader = new THREE.TextureLoader();

  function placeOrb(entry, index, count) {
    const angle = (index / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
    entry.group.position.set(Math.cos(angle) * BOT_PRESENCE_RADIUS, 0, Math.sin(angle) * BOT_PRESENCE_RADIUS);
  }

  function addOrb(bot) {
    const spec = avatarSpec(bot.avatar);
    const color = new THREE.Color(spec.color ?? "#2fe8d4");
    const entryGroup = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 40, 28),
      new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.1,
        roughness: 0.12,
        transmission: 0.92,
        thickness: 1.4,
        ior: 1.45,
        transparent: true,
        opacity: 0.96,
        emissive: color,
        emissiveIntensity: 0.22,
      }),
    );
    mesh.userData.botId = bot.id;
    entryGroup.add(mesh);
    // Bright core so the orb reads at distance.
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 20, 14),
      new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color("#ffffff"), 0.55), transparent: true, opacity: 0.9 }),
    );
    entryGroup.add(core);
    const light = new THREE.PointLight(color, 6, 7, 1.8);
    entryGroup.add(light);
    const label = makeLabelSprite(THREE, documentRoot, bot.name, spec.color ?? "#2fe8d4");
    label.position.y = 1.15;
    entryGroup.add(label);
    if (spec.kind === "image" && spec.src) {
      textureLoader.load(spec.src, (texture) => {
        if (destroyed) return;
        texture.colorSpace = THREE.SRGBColorSpace;
        const portrait = new THREE.Mesh(
          new THREE.PlaneGeometry(0.9, 0.9),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.95 }),
        );
        portrait.position.z = 0.66;
        entryGroup.add(portrait);
      }, undefined, () => { /* portrait is decorative; orb still works */ });
    }
    const bubble = documentRoot.createElement("div");
    bubble.className = "bot-presence-bubble";
    bubble.hidden = true;
    bubbleLayer.appendChild(bubble);
    const entry = {
      group: entryGroup, mesh, label, bubble, bubbleUntil: 0,
      baseY: 0, phase: Math.random() * Math.PI * 2, bot,
    };
    entryGroup.userData.botPresenceEntry = entry;
    group.add(entryGroup);
    orbs.set(bot.id, entry);
    return entry;
  }

  function removeOrb(botId) {
    const entry = orbs.get(botId);
    if (!entry) return;
    entry.bubble.remove();
    group.remove(entry.group);
    entry.group.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (material.map) material.map.dispose();
          material.dispose();
        });
      }
    });
    orbs.delete(botId);
  }

  function refresh() {
    const bots = getBots().filter((bot) => bot && bot.enabled);
    const seen = new Set();
    bots.forEach((bot) => {
      seen.add(bot.id);
      const existing = orbs.get(bot.id);
      if (existing) {
        existing.bot = bot;
      } else {
        addOrb(bot);
      }
    });
    for (const botId of [...orbs.keys()]) {
      if (!seen.has(botId)) removeOrb(botId);
    }
    let index = 0;
    for (const entry of orbs.values()) placeOrb(entry, index++, orbs.size);
  }

  function speak(botId, text) {
    const entry = orbs.get(botId);
    if (!entry) return false;
    entry.bubble.textContent = String(text).slice(0, 220);
    entry.bubble.hidden = false;
    entry.bubbleUntil = performance.now() + BOT_PRESENCE_BUBBLE_MS;
    return true;
  }

  // Reality Lens renders the selected feature as its own spatial surface.
  // Bot Plaza orbs belong to the broader world, so keep them out of the way
  // while the Lens has isolated one object, without deleting bot state.
  function setVisible(nextVisible) {
    visible = Boolean(nextVisible);
    group.visible = visible;
    bubbleLayer.hidden = !visible;
    if (!visible) {
      for (const entry of orbs.values()) entry.bubble.hidden = true;
    }
    return visible;
  }

  function updateBubbles() {
    const rect = container.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
    const now = performance.now();
    for (const entry of orbs.values()) {
      if (entry.bubble.hidden) continue;
      if (now > entry.bubbleUntil) {
        entry.bubble.hidden = true;
        continue;
      }
      entry.mesh.getWorldPosition(projected);
      projected.y += 1.9;
      projected.project(camera);
      if (projected.z > 1) {
        entry.bubble.hidden = true;
        continue;
      }
      const x = (projected.x * 0.5 + 0.5) * rect.width;
      const y = (-projected.y * 0.5 + 0.5) * rect.height;
      entry.bubble.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  let downAt = null;
  function onPointerDown(event) {
    downAt = { x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event) {
    if (!downAt) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    downAt = null;
    if (moved > 6 || typeof onOrbClick !== "function") return;
    const rect = container.getBoundingClientRect?.();
    if (!rect) return;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const targets = [...orbs.values()].map((entry) => entry.mesh);
    const hit = raycaster.intersectObjects(targets, false)[0];
    const botId = hit?.object?.userData?.botId;
    if (botId) onOrbClick(botId);
  }
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointerup", onPointerUp);

  function tick() {
    if (destroyed) return;
    raf = requestAnimationFrame(tick);
    frame += 1;
    if (frame % 45 === 0) refresh();
    const t = performance.now() / 1000;
    for (const entry of orbs.values()) {
      if (!reducedMotion) {
        entry.group.position.y = Math.sin(t * 0.9 + entry.phase) * 0.28;
        entry.group.rotation.y = t * 0.25 + entry.phase;
      }
    }
    if (!reducedMotion) ring.rotation.z = t * 0.05;
    if (visible) updateBubbles();
  }
  refresh();
  tick();

  return Object.freeze({
    refresh,
    speak,
    setVisible,
    get visible() { return visible; },
    getBotIds: () => Object.freeze([...orbs.keys()]),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointerup", onPointerUp);
      for (const botId of [...orbs.keys()]) removeOrb(botId);
      bubbleLayer.remove();
      scene.remove(group);
    },
    source: BOT_PRESENCE_SOURCE,
  });
}
