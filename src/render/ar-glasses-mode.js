/**
 * maTumbo Living Reality Ω
 * Hand Lens — AR Glasses Session Mode
 *
 * Thin orchestration layer only.
 *
 * This module does NOT:
 * - implement camera capture
 * - run MediaPipe
 * - process hand landmarks
 * - implement pinch/grab logic
 * - implement the air keyboard
 * - implement hand presence
 * - implement HUD rendering
 *
 * It coordinates those sibling modules when the user explicitly enables
 * AR-glasses mode.
 *
 * Privacy:
 * - AR-glasses mode is OFF by default.
 * - Camera access is requested only after explicit enable().
 * - Camera frames must remain local to the device.
 *
 * DEPLOY CHECKLIST
 * ---------------------------------------------------------------------------
 * [ ] GitHub Pages is served over HTTPS. getUserMedia() requires a secure
 *     context (localhost is also permitted during local development).
 *
 * [ ] Camera permission UX clearly explains why the camera is requested:
 *     "Hand Lens uses your front camera locally to track hand movement.
 *      Camera frames never leave this device."
 *
 * [ ] Verify every newly deployed Hand Lens file returns HTTP 200 from the
 *     actual GitHub Pages HTTPS URL.
 *
 * [ ] Open the deployed page with DevTools Console visible and verify there
 *     are ZERO console errors.
 *
 * [ ] Keep hand-sampling work within the approximately 30 FPS budget.
 *     Do not accidentally create a second camera/MediaPipe loop here.
 *
 * [ ] If the hand-model CDN/resource is unreachable, show a clear,
 *     user-readable error and keep the application usable with
 *     touch/mouse. AR-glasses mode must not make the rest of the app fail.
 *
 * [ ] Confirm camera remains OFF on initial page load. Only the explicit
 *     AR-glasses toggle may start the camera session.
 *
 * [ ] Confirm turning AR-glasses mode OFF releases/stops the camera session
 *     through the hand-camera module.
 *
 * [ ] Confirm keyboard, hand presence, HUD, and interaction targets remain
 *     usable without a camera or AR-capable hardware.
 * ---------------------------------------------------------------------------
 */

/**
 * Approximate interaction-affordance enlargement used in AR glasses mode.
 *
 * The visual/interaction modules remain responsible for deciding exactly
 * how this multiplier is applied.
 */
const AR_INTERACTION_SCALE = 1.3;

/**
 * Safely call an optional integration method.
 *
 * Keeping these calls optional is intentional: Hand Lens must continue to
 * work with mouse/touch even when a sibling module does not provide an
 * AR-specific implementation yet.
 *
 * @param {object|undefined|null} target
 * @param {string} method
 * @param {...unknown} args
 * @returns {unknown}
 */
function callIfAvailable(target, method, ...args) {
  if (!target || typeof target[method] !== "function") {
    return undefined;
  }
  return target[method](...args);
}

/**
 * Apply the AR-glasses presentation state to one sibling module.
 *
 * Sibling modules own their own implementation. This file only coordinates
 * the state transition.
 *
 * @param {object|undefined|null} module
 * @param {boolean} enabled
 */
function applyArPresentation(module, enabled) {
  if (!module) {
    return;
  }
  // Preferred single integration point for sibling modules.
  callIfAvailable(module, "setArGlassesMode", enabled);
  // Optional finer-grained integration points. They are deliberately
  // independent so a partially integrated sibling still works.
  callIfAvailable(module, "setWorldAnchored", enabled);
  callIfAvailable(module, "setFollowCameraYaw", enabled);
  callIfAvailable(module, "setInteractionScale", enabled ? AR_INTERACTION_SCALE : 1);
  callIfAvailable(module, "setGlassContrast", enabled);
}

/**
 * Create the AR-glasses session mode controller.
 *
 * The controller starts disabled. It never requests camera permission during
 * construction.
 *
 * Expected sibling integration surface:
 *
 * handCamera:
 *   enable()
 *   disable()              optional, but recommended
 *
 * airKeyboard:
 *   setArGlassesMode(bool) optional
 *   setWorldAnchored(bool) optional
 *   setFollowCameraYaw(bool) optional
 *   setInteractionScale(number) optional
 *   setGlassContrast(bool) optional
 *
 * handPresence:
 *   same optional presentation methods as airKeyboard
 *
 * hud:
 *   setArGlassesMode(bool) optional
 *   setWorldAnchored(bool) optional
 *   setFollowCameraYaw(bool) optional
 *   setInteractionScale(number) optional
 *   setGlassContrast(bool) optional
 *
 * @param {object} options
 * @param {object} [options.handCamera]
 * @param {object} [options.airKeyboard]
 * @param {object} [options.handPresence]
 * @param {object} [options.hud]
 * @returns {{
 *   setEnabled: (enabled: boolean) => void,
 *   isEnabled: () => boolean,
 *   destroy: () => void
 * }}
 */
export function createArGlassesMode({
  handCamera,
  airKeyboard,
  handPresence,
  hud,
} = {}) {
  let enabled = false;
  let destroyed = false;

  /**
   * Enable/disable AR-glasses session mode.
   *
   * Important privacy behavior:
   * - `enabled` starts false.
   * - handCamera.enable() is called ONLY on an explicit transition to true.
   * - Camera implementation remains responsible for permission handling,
   *   local-only frames, front-camera selection, and MediaPipe lifecycle.
   *
   * @param {boolean} nextEnabled
   */
  function setEnabled(nextEnabled) {
    if (destroyed) {
      return;
    }
    const next = Boolean(nextEnabled);
    // Idempotent toggle: do not restart the camera or presentation systems
    // when the requested state is already active.
    if (next === enabled) {
      return;
    }
    enabled = next;
    if (enabled) {
      /*
       * CAMERA INTEGRATION POINT
       * ------------------------
       * The hand-camera sibling owns the actual camera session.
       *
       * It should:
       *   - request the user's explicit permission,
       *   - prefer the front/user-facing camera,
       *   - run the pinned MediaPipe VIDEO-mode pipeline,
       *   - keep frames on-device,
       *   - respect the ~30 FPS sampling budget.
       *
       * We intentionally do not pass camera constraints or duplicate any
       * camera logic here.
       */
      if (handCamera && typeof handCamera.enable === "function") {
        try {
          const result = handCamera.enable();
          // Promise rejection must not leave the rest of the application
          // broken. The camera module owns the actual error reporting.
          if (result && typeof result.catch === "function") {
            result.catch((error) => {
              // Keep this layer graceful when camera/AR is unavailable.
              // The camera module should provide the user-facing message.
              if (typeof handCamera.onEnableError === "function") {
                handCamera.onEnableError(error);
              }
            });
          }
        } catch (error) {
          // Synchronous camera failures are also non-fatal.
          if (typeof handCamera.onEnableError === "function") {
            handCamera.onEnableError(error);
          }
        }
      }
    } else {
      /*
       * CAMERA SHUTDOWN INTEGRATION POINT
       * ---------------------------------
       * The hand-camera module owns stream/track cleanup.
       *
       * If a disable() implementation exists, use it. If it does not,
       * presentation mode still changes correctly and mouse/touch operation
       * remains available.
       */
      callIfAvailable(handCamera, "disable");
    }
    /*
     * Presentation orchestration.
     *
     * These modules remain authoritative for their own visuals and layout.
     * AR-glasses mode simply tells them which presentation state to use.
     */
    applyArPresentation(airKeyboard, enabled);
    applyArPresentation(handPresence, enabled);
    applyArPresentation(hud, enabled);
  }

  /**
   * Return whether AR-glasses mode is currently enabled.
   *
   * @returns {boolean}
   */
  function isEnabled() {
    return enabled;
  }

  /**
   * Tear down the orchestration layer.
   *
   * This intentionally does not destroy sibling modules. It only returns
   * them to their normal presentation state and stops the camera session if
   * the camera module exposes disable().
   */
  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    // Always release camera resources if AR mode was active.
    callIfAvailable(handCamera, "disable");
    // Return presentation modules to their normal desktop/touch state.
    applyArPresentation(airKeyboard, false);
    applyArPresentation(handPresence, false);
    applyArPresentation(hud, false);
    enabled = false;
  }

  return {
    setEnabled,
    isEnabled,
    destroy,
  };
}
