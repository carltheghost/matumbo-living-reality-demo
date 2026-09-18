/**
 * Small DOM-only presentation state for the cube-first Block World route.
 *
 * The focused route deliberately hides the feature directory, asset preview,
 * generic organ selector, and Reality Lens control so the cube field and its
 * local action console have the whole viewport.  The feature toggle remains
 * mounted as the explicit way back to Mission Control.  This module never
 * changes canonical projection state or grants an external capability.
 */

export const BLOCK_WORLD_FOCUS_MODE = "block-world-focus";
export const BLOCK_WORLD_DIRECTORY_MODE = "world-directory";

function toggleClass(element, name, enabled) {
  element?.classList?.toggle?.(name, enabled);
}

function setMode(element, mode) {
  element?.setAttribute?.("data-view-mode", mode);
}

/**
 * Apply the cube-first presentation flag to a document-like host.
 *
 * Both html and body receive the state so CSS remains reliable in a normal
 * browser and in small/static harnesses that only expose one root.  Returning
 * a frozen snapshot makes the handoff inspectable without becoming a source
 * of truth.
 */
export function applyBlockWorldFocusMode({ documentRoot = globalThis.document, active = false } = {}) {
  const focused = Boolean(active);
  const mode = focused ? BLOCK_WORLD_FOCUS_MODE : BLOCK_WORLD_DIRECTORY_MODE;
  const roots = [documentRoot?.documentElement, documentRoot?.body].filter(Boolean);
  roots.forEach((root) => {
    toggleClass(root, BLOCK_WORLD_FOCUS_MODE, focused);
    setMode(root, mode);
  });

  const toggle = documentRoot?.getElementById?.("feature-toggle");
  toggleClass(toggle, "block-world-focus-toggle", focused);
  toggle?.setAttribute?.("data-focus-mode", mode);

  return Object.freeze({
    active: focused,
    mode,
    hiddenOverlays: focused,
    directoryToggle: "feature-toggle",
    localOnly: true,
    externalNetwork: false,
    persistence: false,
    executable: false,
  });
}

export default applyBlockWorldFocusMode;
