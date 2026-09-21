// TUMBO-SIM ledger core boot: exposes window.TumboToken and funds demo accounts.
// Guarded dynamic import: the token lane's module graph is mid-flight (its
// imports don't match token.js yet), so a static import would fail the whole
// module graph and red-banner the boot. This boots the ledger automatically
// once the lane lands a consistent graph; until then boot continues cleanly.
import('../domains/token-boot.js').catch(() => {});

/** Default-landing routing: which feature view opens when the page loads.
 *
 * Pure and DOM-free so the decision is unit-testable; the caller
 * (`src/main.js`) hands it the current query params and hash.
 *
 * - No `feature` / `panel` query param and no hash → `'block-world'`
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
  return 'block-world';
}
