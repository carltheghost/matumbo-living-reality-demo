/**
 * photo-mascot-mount.js - Reality Lens Ω
 *
 * Lazy wiring for the maTumbo Living Reality Ω photo mascot.
 *
 * mountPhotoMascot({ scene, camera, hudRoot, onOpenPanel, canvas, tick })
 *   -> async mount() -> { presence, unmount, tick }
 *
 * - Lazy: preloadPhotos() runs on the first open, never at boot.
 * - Creates exactly ONE presence via createPhotoMascotPresence.
 * - Adds a <button> "MASCOT" toggle (44px touch target) to hudRoot.
 * - pointermove over the canvas feeds presence.setTilt() with normalized coords.
 * - presence.update(t, dt) is driven by an internal rAF loop, or by an
 *   external tick registrar passed as `tick`.
 * - unmount() stops the loop, disposes the presence, removes the button.
 * - Never throws: missing scene/camera (or any mount failure) resolves to
 *   { presence: null } with a console warning.
 *
 * Conventions: ES modules, Three.js only as `import * as THREE from "three"`
 * (not needed by this module), no console spam, Reality Lens Ω naming
 * (World Eye is retired), everything closed by default and materializing
 * only when needed, simulated TUMBO points only, projection only.
 */

import { createPhotoMascotPresence } from "./photo-mascot-presence.js?v=20260922-cache2";
import { preloadPhotos } from "./photo-mascot-set.js?v=20260922-cache2";

const TAG = "[photo-mascot-mount]";
const BUTTON_LABEL = "MASCOT";
const BUTTON_ARIA_LABEL = "Toggle mascot";
const MIN_TOUCH_TARGET_PX = 44;
const MAX_FRAME_DT = 0.1;
const OPEN_PANEL_ID = "mascot";

function warn(message) {
  try {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(`${TAG} ${message}`);
    }
  } catch {
    // Logging must never break the host app.
  }
}

function describeError(err) {
  if (err && typeof err.message === "string" && err.message) return err.message;
  return String(err);
}

function nullHandle() {
  return {
    presence: null,
    unmount() {},
    tick() {},
  };
}

function toFinite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Convert client coords to the -1..1 tilt space the mascot expects. */
function pointerToTilt(clientX, clientY, rect) {
  const width = rect && rect.width > 0 ? rect.width : 1;
  const height = rect && rect.height > 0 ? rect.height : 1;
  const left = rect ? toFinite(rect.left, 0) : 0;
  const top = rect ? toFinite(rect.top, 0) : 0;
  return {
    x: ((toFinite(clientX, left + width / 2) - left) / width) * 2 - 1,
    y: -(((toFinite(clientY, top + height / 2) - top) / height) * 2 - 1),
  };
}

export function mountPhotoMascot(options) {
  const opts = options || {};
  const { scene, camera, hudRoot, onOpenPanel, canvas, tick } = opts;

  async function mount() {
    try {
      return await mountInner({ scene, camera, hudRoot, onOpenPanel, canvas, tick });
    } catch (err) {
      warn(`mount failed (${describeError(err)}); mascot disabled.`);
      return nullHandle();
    }
  }

  return mount;
}

async function mountInner({ scene, camera, hudRoot, onOpenPanel, canvas, tick }) {
  // Guard: no WebGL scene/camera -> disabled with a warning, never throws.
  if (!scene || !camera) {
    warn("scene or camera unavailable; photo mascot disabled.");
    return nullHandle();
  }

  let presence = null;
  try {
    presence = createPhotoMascotPresence({ scene, camera });
  } catch (err) {
    warn(`createPhotoMascotPresence threw (${describeError(err)}); mascot disabled.`);
    return nullHandle();
  }
  if (!presence || typeof presence.update !== "function") {
    warn("createPhotoMascotPresence returned an unusable presence; mascot disabled.");
    return nullHandle();
  }

  const doc = typeof document !== "undefined" ? document : null;

  // ---- Lazy photo preload: first open only, never at boot. ----
  let photosPromise = null;
  let photosReady = false;
  function ensurePhotos() {
    if (photosReady) return Promise.resolve(true);
    if (!photosPromise) {
      photosPromise = Promise.resolve()
        .then(() => preloadPhotos())
        .then(() => {
          photosReady = true;
          return true;
        })
        .catch((err) => {
          photosPromise = null; // allow a retry on the next open
          warn(`preloadPhotos failed (${describeError(err)}); opening with fallbacks.`);
          return false;
        });
    }
    return photosPromise;
  }

  // ---- HUD toggle button ----
  let button = null;
  const canUseHud = !!doc && !!hudRoot && typeof hudRoot.appendChild === "function";

  function syncButton(open) {
    if (!button) return;
    try {
      button.setAttribute("aria-pressed", open ? "true" : "false");
      if (button.classList && typeof button.classList.toggle === "function") {
        button.classList.toggle("is-open", !!open);
      }
    } catch {
      // Non-fatal; the toggle itself still works.
    }
  }

  let openedOnce = false;
  let toggling = false;

  async function handleToggle() {
    if (toggling) return;
    toggling = true;
    try {
      const isOpen = typeof presence.isOpen === "function" ? !!presence.isOpen() : false;
      if (isOpen) {
        if (typeof presence.close === "function") await presence.close();
        syncButton(false);
        return;
      }
      // Mobile single-panel rule: let the host close other panels first.
      if (typeof onOpenPanel === "function") {
        try {
          onOpenPanel(OPEN_PANEL_ID);
        } catch (err) {
          warn(`onOpenPanel threw (${describeError(err)}); continuing.`);
        }
      }
      if (!openedOnce) {
        openedOnce = true;
        await ensurePhotos(); // lazy: preloads on first open only
      }
      if (typeof presence.open === "function") {
        await presence.open();
      } else if (typeof presence.toggle === "function") {
        await presence.toggle();
      }
      syncButton(true);
    } catch (err) {
      warn(`toggle failed (${describeError(err)}).`);
    } finally {
      toggling = false;
    }
  }

  if (canUseHud) {
    button = doc.createElement("button");
    button.type = "button";
    const mascotCube = doc.createElement("span");
    mascotCube.setAttribute("aria-hidden", "true");
    mascotCube.textContent = "◇";
    mascotCube.style.cssText = "display:inline-grid;place-items:center;width:26px;height:26px;border:1px solid rgba(142,232,255,.55);border-radius:6px;background:linear-gradient(145deg,rgba(90,211,255,.35),rgba(8,24,36,.9));box-shadow:inset 0 0 9px rgba(90,211,255,.16),0 0 14px rgba(90,211,255,.1);font-size:15px;text-shadow:0 0 9px rgba(142,232,255,.8);";
    const mascotWord = doc.createElement("span");
    mascotWord.textContent = "TUMBO";
    mascotWord.style.cssText = "letter-spacing:.14em;font-size:9px;font-weight:700;text-transform:uppercase;";
    button.replaceChildren?.(mascotCube, mascotWord);
    if (!button.firstChild) button.append(mascotCube, mascotWord);
    button.setAttribute("aria-label", BUTTON_ARIA_LABEL);
    button.setAttribute("aria-pressed", "false");
    if (button.classList && typeof button.classList.add === "function") {
      button.classList.add("hud-button", "mascot-toggle");
    }
    if (button.style) {
      button.style.minWidth = `${MIN_TOUCH_TARGET_PX + 52}px`;
      button.style.display = "inline-flex";
      button.style.alignItems = "center";
      button.style.gap = "8px";
      button.style.padding = "7px 10px";
      button.style.border = "1px solid rgba(129,232,255,.26)";
      button.style.borderRadius = "14px";
      button.style.background = "linear-gradient(145deg,rgba(20,52,72,.96),rgba(4,14,23,.97))";
      button.style.color = "#dff8ff";
      button.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,.08),0 9px 28px rgba(0,0,0,.42),0 0 20px rgba(83,203,255,.08)";
      button.style.backdropFilter = "blur(12px)";
      button.style.minHeight = `${MIN_TOUCH_TARGET_PX}px`;
    }
    button.addEventListener("click", handleToggle);
    hudRoot.appendChild(button);
  } else {
    warn("hudRoot or document unavailable; mascot toggle button skipped.");
  }

  // ---- Live look sync: Person Studio dispatches "tumbo:mascot-look" when
  // a photo look is chosen, so an open mascot swaps without reopening. ----
  const eventTarget =
    typeof window !== "undefined" && typeof window.addEventListener === "function"
      ? window
      : null;

  function onMascotLookEvent(event) {
    try {
      const look = event && event.detail && event.detail.look;
      if (typeof look !== "string" || !look) return;
      if (typeof presence.isOpen !== "function" || !presence.isOpen()) return;
      if (typeof presence.setLook !== "function") return;
      Promise.resolve(presence.setLook(look)).catch((err) => {
        warn(`setLook failed (${describeError(err)}).`);
      });
    } catch (err) {
      warn(`mascot-look event failed (${describeError(err)}).`);
    }
  }

  if (eventTarget) {
    try {
      eventTarget.addEventListener("tumbo:mascot-look", onMascotLookEvent);
    } catch {
      // Non-fatal.
    }
  }

  // ---- Pointer tilt: pointermove over the canvas feeds setTilt. ----
  const tiltTarget =
    canvas ||
    (doc && typeof doc.querySelector === "function" ? doc.querySelector("canvas") : null) ||
    null;
  const canListen = !!tiltTarget && typeof tiltTarget.addEventListener === "function";

  function onPointerMove(event) {
    try {
      const isOpen = typeof presence.isOpen === "function" ? !!presence.isOpen() : false;
      if (!isOpen) return;
      if (typeof presence.setTilt !== "function") return;
      const rect =
        typeof tiltTarget.getBoundingClientRect === "function"
          ? tiltTarget.getBoundingClientRect()
          : null;
      const { x, y } = pointerToTilt(event && event.clientX, event && event.clientY, rect);
      presence.setTilt(x, y);
    } catch (err) {
      warn(`setTilt failed (${describeError(err)}).`);
    }
  }

  if (canListen) {
    tiltTarget.addEventListener("pointermove", onPointerMove, { passive: true });
  }

  // ---- Frame driver: internal rAF loop, or an external tick registrar. ----
  let stopped = false;
  let rafId = null;
  let lastSeconds = 0;
  const hasRaf =
    typeof requestAnimationFrame === "function" &&
    typeof cancelAnimationFrame === "function";

  function step(t, dt) {
    try {
      presence.update(t, dt);
    } catch (err) {
      warn(`presence.update threw (${describeError(err)}).`);
    }
  }

  function frame(nowMs) {
    if (stopped) return;
    const t = toFinite(nowMs, 0) / 1000;
    const dt = lastSeconds > 0 ? Math.min(MAX_FRAME_DT, Math.max(0, t - lastSeconds)) : 0;
    lastSeconds = t;
    step(t, dt);
    if (!stopped && hasRaf) rafId = requestAnimationFrame(frame);
  }

  let releaseExternalTick = null;
  let external = false;
  if (typeof tick === "function") {
    try {
      releaseExternalTick =
        tick((t, dt) => {
          if (!stopped) step(toFinite(t, 0), Math.max(0, toFinite(dt, 0)));
        }) || null;
      external = true;
    } catch (err) {
      warn(`external tick registrar threw (${describeError(err)}); using internal rAF loop.`);
    }
  }
  if (!external) {
    if (hasRaf) {
      rafId = requestAnimationFrame(frame);
    } else {
      warn("requestAnimationFrame unavailable; mascot presence will not animate.");
    }
  }

  // ---- Teardown ----
  let unmounted = false;
  function unmount() {
    if (unmounted) return;
    unmounted = true;
    stopped = true;

    if (rafId !== null && hasRaf) {
      try {
        cancelAnimationFrame(rafId);
      } catch {
        // ignore
      }
      rafId = null;
    }
    if (typeof releaseExternalTick === "function") {
      try {
        releaseExternalTick();
      } catch {
        // ignore
      }
    }
    if (eventTarget && typeof eventTarget.removeEventListener === "function") {
      try {
        eventTarget.removeEventListener("tumbo:mascot-look", onMascotLookEvent);
      } catch {
        // ignore
      }
    }
    if (canListen && typeof tiltTarget.removeEventListener === "function") {
      try {
        tiltTarget.removeEventListener("pointermove", onPointerMove);
      } catch {
        // ignore
      }
    }
    if (button) {
      try {
        button.removeEventListener("click", handleToggle);
      } catch {
        // ignore
      }
      try {
        if (typeof button.remove === "function") {
          button.remove();
        } else if (button.parentNode && typeof button.parentNode.removeChild === "function") {
          button.parentNode.removeChild(button);
        }
      } catch {
        // ignore
      }
      button = null;
    }
    try {
      if (typeof presence.dispose === "function") presence.dispose();
    } catch (err) {
      warn(`presence.dispose threw (${describeError(err)}).`);
    }
  }

  return {
    presence,
    unmount,
    /** Manual driver for hosts that pump frames themselves: tick(tSeconds, dtSeconds). */
    tick(t, dt) {
      if (!unmounted && !stopped) step(toFinite(t, 0), Math.max(0, toFinite(dt, 0)));
    },
  };
}
