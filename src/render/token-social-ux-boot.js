/**
 * token-social-ux-boot.js — guarded app-shell entry for Token Social UX.
 *
 * Import from main.js after the block world / scene is ready:
 *
 *   import { bootTokenSocialUx } from './render/token-social-ux-boot.js';
 *   try { window.__TOKEN_SOCIAL_UX__ = bootTokenSocialUx({ THREE, parent: scene }); }
 *   catch (e) { console.warn('[token-social-ux] mount skipped', e); }
 *
 * Simulation only. Never throws into the host runtime.
 */

import { mountTokenSocialUx } from "./token-social-ux.js?v=20260922-cache2";

export function bootTokenSocialUx(opts = {}) {
  try {
    const { THREE = null, parent = null, position = undefined } = opts;
    const mounted = mountTokenSocialUx(THREE, parent, position);
    return mounted;
  } catch (err) {
    try {
      // HUD-only fallback without three.js
      return mountTokenSocialUx(null, null);
    } catch (err2) {
      console.warn("[token-social-ux] boot failed (simulated surface unavailable)", err2);
      return null;
    }
  }
}

/** Auto-boot HUD when this module is loaded as a side-effect script. */
export function autoBootTokenSocialUx() {
  const run = () => {
    try {
      if (window.__TOKEN_SOCIAL_UX__) return window.__TOKEN_SOCIAL_UX__;
      window.__TOKEN_SOCIAL_UX__ = bootTokenSocialUx({
        THREE: window.THREE || null,
        parent: window.__MATUMBO_SCENE__ || null,
      });
      return window.__TOKEN_SOCIAL_UX__;
    } catch (e) {
      console.warn("[token-social-ux] auto-boot skipped", e);
      return null;
    }
  };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  }
  return run;
}
