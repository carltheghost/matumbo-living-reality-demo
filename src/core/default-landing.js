// TUMBO-SIM ledger core boot: exposes window.TumboToken and funds demo accounts.
// Guarded dynamic import: the token lane's module graph is mid-flight (its
// imports don't match token.js yet), so a static import would fail the whole
// module graph and red-banner the boot. This boots the ledger automatically
// once the lane lands a consistent graph; until then boot continues cleanly.
import('../domains/token-boot.js?v=20260922-cache2').catch(() => {});

/** Default-landing routing: which feature view opens when the page loads.
 *
 * The clean root opens the proven **Reality Assembly / Living Reality**
 * constellation: connected translucent feature cubes, connection lines,
 * orbit/zoom, hover/select, labels, inspector, and local time history.
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
  return 'reality-lens';
}
