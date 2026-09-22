import {
  resolvePixelRatioCap,
  isCompactViewport,
  decideQualityLevel,
  shouldPauseRendering,
  particleBudget,
} from './render-perf.js?v=20260922-cache2';

/**
 * Install mobile freeze guard. Projection-only; no wallet/ledger/identity.
 *
 * @param {{
 *   renderer: { setPixelRatio?: (n: number) => void, setSize?: (w: number, h: number, updateStyle?: boolean) => void, domElement?: HTMLElement, shadowMap?: { enabled?: boolean }, info?: any },
 *   scene: any,
 *   camera: any,
 *   document: Document,
 *   viewportWidth: number,
 * }} opts
 * @returns {{
 *   setPaused: (paused: boolean) => void,
 *   getPaused: () => boolean,
 *   getQualityLevel: () => 0|1|2,
 *   dispose: () => void,
 *   notifyFrame: (frameMs: number) => void,
 * }}
 */
export function installMobileFreezeGuard({ renderer, scene, camera, document: doc, viewportWidth }) {
  const safeDoc = doc && typeof doc === 'object' ? doc : (typeof document !== 'undefined' ? document : null);
  let paused = false;
  let qualityLevel = 2;
  let disposed = false;
  const frameSamples = [];
  const MAX_SAMPLES = 30;
  let lastApplyMs = 0;

  // 1. Cap pixel ratio
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const width = typeof viewportWidth === 'number' && viewportWidth > 0
    ? viewportWidth
    : (typeof window !== 'undefined' ? window.innerWidth : 1024);
  const cap = resolvePixelRatioCap(dpr, width);
  if (renderer && typeof renderer.setPixelRatio === 'function') {
    try {
      renderer.setPixelRatio(cap);
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[mobile-freeze-guard] setPixelRatio failed', e);
    }
  }

  // 3. Initial mobile quality
  qualityLevel = decideQualityLevel({ avgFrameMs: 16.7, viewportWidth: width, dpr });
  applyMobileQuality(scene, qualityLevel, width);

  // 2. Visibility pause / resume
  function onVisibilityChange() {
    if (disposed || !safeDoc) return;
    const hidden = !!(safeDoc.hidden || safeDoc.visibilityState === 'hidden');
    const shouldPause = shouldPauseRendering({ documentHidden: hidden });
    setPaused(shouldPause);
  }
  if (safeDoc && typeof safeDoc.addEventListener === 'function') {
    safeDoc.addEventListener('visibilitychange', onVisibilityChange);
    // Initial sync
    onVisibilityChange();
  }

  // 5. Resize + orientation + safe-area
  function applyCanvasSize() {
    if (disposed || !renderer) return;
    try {
      const w = typeof window !== 'undefined' ? window.innerWidth : width;
      const h = typeof window !== 'undefined' ? window.innerHeight : 844;
      // Respect safe-area insets via CSS env if available on the canvas parent
      const el = renderer.domElement;
      if (el && el.style) {
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.maxWidth = '100vw';
        el.style.maxHeight = '100dvh';
        // Safe-area padding is best handled by host CSS; we only ensure canvas fills.
      }
      if (typeof renderer.setSize === 'function') {
        renderer.setSize(w, h, false);
      }
      if (camera && camera.isPerspectiveCamera) {
        camera.aspect = w / Math.max(1, h);
        if (typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix();
      }
      // Re-cap pixel ratio on resize (orientation change may change effective class)
      const newCap = resolvePixelRatioCap(
        (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
        w
      );
      if (typeof renderer.setPixelRatio === 'function') renderer.setPixelRatio(newCap);
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[mobile-freeze-guard] resize failed', e);
    }
  }

  function onResize() {
    applyCanvasSize();
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
  }

  // 4. Adaptive watchdog – call notifyFrame from host loop
  function notifyFrame(frameMs) {
    if (disposed) return;
    const ms = typeof frameMs === 'number' && frameMs > 0 ? frameMs : 16.7;
    frameSamples.push(ms);
    if (frameSamples.length > MAX_SAMPLES) frameSamples.shift();
    if (frameSamples.length < 8) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastApplyMs < 1200) return; // throttle quality changes
    const avg = frameSamples.reduce((a, b) => a + b, 0) / frameSamples.length;
    const currentWidth = typeof window !== 'undefined' ? window.innerWidth : width;
    const currentDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const next = decideQualityLevel({ avgFrameMs: avg, viewportWidth: currentWidth, dpr: currentDpr });
    if (next !== qualityLevel) {
      qualityLevel = next;
      applyMobileQuality(scene, qualityLevel, currentWidth);
      lastApplyMs = now;
    }
  }

  function setPaused(value) {
    paused = !!value;
  }

  function getPaused() {
    return paused;
  }

  function getQualityLevel() {
    return qualityLevel;
  }

  function dispose() {
    disposed = true;
    if (safeDoc && typeof safeDoc.removeEventListener === 'function') {
      safeDoc.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    }
    frameSamples.length = 0;
  }

  // Initial size pass (covers 390×844 and similar)
  applyCanvasSize();

  return {
    setPaused,
    getPaused,
    getQualityLevel,
    dispose,
    notifyFrame,
  };
}

/**
 * Apply quality settings to scene. Halves particles, disables shadows & post on compact / low quality.
 * Does not redesign visuals; only scales counts and toggles expensive features.
 * @param {any} scene
 * @param {0|1|2} level
 * @param {number} viewportWidth
 */
function applyMobileQuality(scene, level, viewportWidth) {
  if (!scene) return;
  try {
    const budget = particleBudget({ viewportWidth, qualityLevel: level });
    // Walk common particle systems / points objects and clamp count
    scene.traverse?.((obj) => {
      if (!obj) return;
      // Points / particle systems that expose a count or geometry attribute
      if (obj.isPoints || obj.type === 'Points') {
        const geo = obj.geometry;
        if (geo && geo.attributes && geo.attributes.position) {
          const pos = geo.attributes.position;
          const max = Math.min(pos.count, budget);
          if (typeof geo.setDrawRange === 'function') {
            geo.setDrawRange(0, max);
          }
        }
        if (typeof obj.count === 'number' && obj.count > budget) {
          obj.count = budget;
        }
      }
      // Named particle systems sometimes store a maxParticles or particleCount
      if (typeof obj.particleCount === 'number' && obj.particleCount > budget) {
        obj.particleCount = budget;
      }
      if (typeof obj.maxParticles === 'number' && obj.maxParticles > budget) {
        obj.maxParticles = budget;
      }
    });
    // Shadows
    const enableShadows = level >= 2 && !isCompactViewport(viewportWidth);
    scene.traverse?.((obj) => {
      if (obj && obj.isLight && obj.castShadow !== undefined) {
        obj.castShadow = enableShadows;
      }
      if (obj && obj.receiveShadow !== undefined) {
        obj.receiveShadow = enableShadows;
      }
    });
    // Postprocessing / composer – disable on compact or low quality
    // Host may attach a .composer or .postprocessing flag; we only toggle known flags
    if (scene.userData) {
      if (level < 2 || isCompactViewport(viewportWidth)) {
        scene.userData.__mf_postDisabled = true;
      } else {
        scene.userData.__mf_postDisabled = false;
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[mobile-freeze-guard] applyMobileQuality failed', e);
    }
  }
}

// Re-export pure helpers so tests and integrators can import from one place if desired
export {
  decideQualityLevel,
  shouldPauseRendering,
  particleBudget,
  resolvePixelRatioCap,
  isCompactViewport,
};
