/** Mobile rendering perf helpers. Pure and DOM-free so every decision is
 * unit-testable with small fakes; the render modules (`chess-arena.js`,
 * `market-constellation.js`) apply these to their own WebGL renderers and
 * animation loops. Desktop behavior is never touched: every helper is a
 * no-op for wide viewports.
 *
 * Projection only: nothing here changes ledger, identity, signing,
 * settlement, wallet, custody, or authority state.
 */

/** Viewport width at or below which a screen counts as compact (matches the
 * one-panel-at-a-time mobile panel manager). */
export const COMPACT_VIEWPORT_MAX_WIDTH = 700;

/** True when the viewport is a compact/mobile layout. */
export function isCompactViewport(viewportWidth) {
  const width = Number(viewportWidth);
  return Number.isFinite(width) && width <= COMPACT_VIEWPORT_MAX_WIDTH;
}

/** Pixel-ratio cap for a renderer: 1 on compact viewports (kills mobile
 * fill-rate cost and transparent overdraw), otherwise min(devicePixelRatio,
 * 1.5) — the existing desktop cap. */
export function resolvePixelRatioCap(devicePixelRatio, viewportWidth) {
  if (isCompactViewport(viewportWidth)) return 1;
  const dpr = Number(devicePixelRatio);
  const sane = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(sane, 1.5);
}

/** Gate for a secondary renderer's animation frame. The loop should run only
 * while its host is alive, attached to the document, laid out on screen, and
 * the tab is visible. Callers stop their rAF chain when this returns false
 * and restart it on visibility/IntersectionObserver resume events. */
export function shouldRunSecondaryLoop({ alive, connected, offsetVisible, documentHidden }) {
  return !!alive && !!connected && !!offsetVisible && !documentHidden;
}

/** A rAF loop that skips its work callback while `isVisible()` is false but
 * keeps the frame scheduled, so a visibility change resumes it without any
 * re-wiring. `requestFrame`/`cancelFrame` are injectable so tests can drive
 * the loop with a fake scheduler and no DOM. Returns false from `work` to
 * stop the loop from inside the frame.
 */
export function createVisibilityLoop({
  isVisible = () => true,
  work = () => {},
  requestFrame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (id) => cancelAnimationFrame(id),
} = {}) {
  let raf = 0;
  let started = false;
  const frame = (now) => {
    if (!started) return;
    raf = 0;
    if (isVisible()) {
      const keepGoing = work(now);
      if (keepGoing === false) {
        started = false;
        return;
      }
    }
    if (started) raf = requestFrame(frame);
  };
  return {
    start() {
      if (started) return;
      started = true;
      raf = requestFrame(frame);
    },
    stop() {
      started = false;
      if (raf) {
        cancelFrame(raf);
        raf = 0;
      }
    },
    get running() {
      return started;
    },
  };
}
