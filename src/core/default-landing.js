// TUMBO-SIM ledger core boot: exposes window.TumboToken and funds demo accounts.
// Side-effect import only; resolveDefaultFeature below stays pure and DOM-free.
import '../domains/token-boot.js';

/** Default-landing routing: which feature view opens when the page loads.
 *
 * Pure and DOM-free so the decision is unit-testable; the caller
 * (`src/main.js`) hands it the current query params and hash.
 *
 * - No `feature` / `panel` query param and no hash → `'reality-lens'`
 *   (the clean constellation world overview: labeled glass feature cubes,
 *   all consoles closed, the directory closed).
 * - Any explicit route (`?feature=…`, `?panel=…`, or a hash) → `null`,
 *   meaning the caller leaves the URL-driven routing exactly as it is.
 *
 * Deliberate cube-field entries — `?feature=block-world`,
 * `?panel=block-world`, an explicit Block World selection, or a cube-dive
 * double-tap — are explicit routes and are never rewritten here. The
 * cube-field interior only appears through one of those deliberate entries.
 */
export function resolveDefaultFeature(search, hash) {
  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(search ?? '');
  if (params.get('feature') || params.get('panel')) return null;
  const fragment = String(hash ?? '');
  if (fragment && fragment !== '#') return null;
  return 'reality-lens';
}
