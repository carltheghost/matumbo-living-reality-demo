// TUMBO-SIM ledger core boot: exposes window.TumboToken and funds demo accounts.
// Guarded dynamic import: the token lane's module graph is mid-flight (its
// imports don't match token.js yet), so a static import would fail the whole
// module graph and red-banner the boot. This boots the ledger automatically
// once the lane lands a consistent graph; until then boot continues cleanly.
import('../domains/token-boot.js').catch(() => {});

import { applyBlockWorldFocusMode } from '../render/block-world-focus.js';

/**
 * Default-landing routing: which feature view opens when the page loads.
 *
 * The default is the actual connected glass-cube Living Reality surface:
 * the cube field owns the viewport, the legacy rounded rails are suppressed,
 * and the user can zoom the connected field and double-click/double-tap a
 * portal cube to dive inside it.
 *
 * Explicit feature/panel/hash routes are never rewritten.
 */
export function resolveDefaultFeature(search, hash) {
  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(search ?? '');
  if (params.get('feature') || params.get('panel')) return null;
  const fragment = String(hash ?? '');
  if (fragment && fragment !== '#') return null;
  return 'block-world';
}

/**
 * Apply the visual contract of the default landing.
 *
 * Routing alone is not enough: selecting the Block World feature must also
 * put the document into cube-first presentation. This is intentionally a
 * renderer-only handoff; it does not alter canonical world state.
 */
export function applyDefaultBlockWorldLanding({
  search = globalThis.location?.search ?? '',
  hash = globalThis.location?.hash ?? '',
  documentRoot = globalThis.document,
} = {}) {
  const isDefault = resolveDefaultFeature(search, hash) === 'block-world';
  if (!isDefault) return Object.freeze({ active: false, reason: 'explicit-route' });

  const focus = applyBlockWorldFocusMode({ documentRoot, active: true });
  const roots = [documentRoot?.documentElement, documentRoot?.body].filter(Boolean);
  roots.forEach((root) => {
    root.classList?.add?.('cube-first-mode');
    root.setAttribute?.('data-living-reality-ui', 'connected-block-world');
  });

  const shell = documentRoot?.getElementById?.('feature-shell');
  shell?.classList?.remove?.('open');
  shell?.setAttribute?.('aria-hidden', 'true');

  const toggle = documentRoot?.getElementById?.('feature-toggle');
  toggle?.setAttribute?.('aria-expanded', 'false');

  return Object.freeze({
    active: true,
    focus,
    ui: 'connected-block-world',
    zoom: true,
    doubleActivate: true,
    localOnly: true,
    externalNetwork: false,
    executable: false,
  });
}

// main.js loads after the document shell, so this applies the landing UI in
// the same tick as route resolution instead of waiting for a later click.
export const DEFAULT_BLOCK_WORLD_LANDING = applyDefaultBlockWorldLanding();
