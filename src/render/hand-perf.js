/**
 * hand-perf.js — Adaptive performance governor for hand tracking.
 *
 * Controls sample rate of MediaPipe HandLandmarker to keep the Three.js
 * render loop smooth. Targets ~30 fps sampling under load, degrades
 * gracefully when detectForVideo latency climbs, and pauses entirely
 * when the tab is hidden.
 *
 * Zero per-frame allocation in the hot path (beginFrame / shouldSample /
 * endSample). All pure budgeting helpers are exported for unit tests.
 *
 * Integration points (camera module):
 *   - Call setNumHands(1) when shouldDegrade(stats) becomes true
 *     (see DEGRADE_LATENCY_MS). The governor itself only reports the
 *     decision; the camera module owns the HandLandmarker instance.
 *   - Resume setNumHands(2) once stats recover below the threshold.
 */

// ---------------------------------------------------------------------------
// Pure budgeting helpers (dependency-free, fully testable)
// ---------------------------------------------------------------------------

/** Base sample interval ≈ 30 fps. */
export const BASE_INTERVAL_MS = 33;

/** Step-up intervals when latency is elevated. */
export const INTERVALS_MS = Object.freeze([33, 50, 66]);

/** Rolling-average latency above this → start increasing sample interval. */
export const HIGH_LATENCY_MS = 40;

/** Rolling-average latency above this → recommend dropping to 1 hand. */
export const DEGRADE_LATENCY_MS = 55;

/** Rolling-average latency below this → allow recovery toward base interval. */
export const RECOVER_LATENCY_MS = 28;

/**
 * Map a measured average latency to the recommended sample interval.
 * Pure function — no side effects.
 *
 * @param {number} latencyMs  rolling average of recent detectForVideo times
 * @returns {number} interval in ms (one of INTERVALS_MS)
 */
export function sampleIntervalFor(latencyMs) {
  if (latencyMs > 50) return 66;
  if (latencyMs > HIGH_LATENCY_MS) return 50;
  return BASE_INTERVAL_MS;
}

/**
 * Compute the next sample delay given the current average latency.
 * Convenience wrapper around sampleIntervalFor for the adaptive sampler.
 *
 * @param {number} avgLatencyMs
 * @returns {number} delay until the next sample is allowed
 */
export function nextSampleDelay(avgLatencyMs) {
  return sampleIntervalFor(avgLatencyMs);
}

/**
 * Decide whether the system should degrade (drop to 1 hand).
 * Pure function.
 *
 * @param {{ avgLatencyMs: number, hands?: number }} stats
 * @returns {boolean}
 */
export function shouldDegrade(stats) {
  return stats.avgLatencyMs > DEGRADE_LATENCY_MS;
}

// ---------------------------------------------------------------------------
// Ring-buffer stats (fixed size, no allocation after construction)
// ---------------------------------------------------------------------------

const RING_SIZE = 16;

/**
 * Create the adaptive hand-performance governor.
 *
 * @param {{ onStats?: (stats: object) => void }} [opts]
 * @returns {{
 *   beginFrame: () => void,
 *   endSample: (latencyMs: number) => void,
 *   shouldSample: (nowMs: number) => boolean,
 *   getStats: () => { fps: number, avgLatencyMs: number, hands: number, throttled: boolean },
 *   destroy: () => void
 * }}
 */
export function createHandPerf({ onStats } = {}) {
  // ---- mutable state (all pre-allocated) ---------------------------------
  const latencies = new Float64Array(RING_SIZE);
  let ringWrite = 0;
  let ringCount = 0;
  let sumLatency = 0;

  let lastSampleMs = 0;
  let currentInterval = BASE_INTERVAL_MS;
  let frameCount = 0;
  let fpsWindowStart = 0;
  let fps = 0;
  let hands = 2;               // reported value; camera module may lower it
  let throttled = false;       // true while tab is hidden
  let destroyed = false;

  // ---- visibility handling -----------------------------------------------
  function onVisibilityChange() {
    if (destroyed) return;
    throttled = document.visibilityState === 'hidden';
    if (!throttled) {
      // Reset timer so we don't immediately fire a sample on resume.
      lastSampleMs = performance.now();
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  // ---- internal helpers --------------------------------------------------
  function avgLatency() {
    return ringCount === 0 ? 0 : sumLatency / ringCount;
  }

  function pushLatency(ms) {
    if (ringCount === RING_SIZE) {
      sumLatency -= latencies[ringWrite];
    } else {
      ringCount += 1;
    }
    latencies[ringWrite] = ms;
    sumLatency += ms;
    ringWrite = (ringWrite + 1) % RING_SIZE;
  }

  function recomputeInterval() {
    const avg = avgLatency();
    const desired = sampleIntervalFor(avg);
    // Hysteresis: only step down (faster) when we are clearly recovered.
    if (desired < currentInterval && avg > RECOVER_LATENCY_MS) {
      // stay at current slower interval
      return;
    }
    currentInterval = desired;
  }

  // ---- public API --------------------------------------------------------
  function beginFrame() {
    if (destroyed) return;
    frameCount += 1;
    const now = performance.now();
    if (fpsWindowStart === 0) fpsWindowStart = now;
    const elapsed = now - fpsWindowStart;
    if (elapsed >= 1000) {
      fps = (frameCount * 1000) / elapsed;
      frameCount = 0;
      fpsWindowStart = now;
      if (typeof onStats === 'function') {
        onStats(getStats());
      }
    }
  }

  /**
   * Record the wall-clock time of a completed detectForVideo call.
   * @param {number} latencyMs
   */
  function endSample(latencyMs) {
    if (destroyed) return;
    pushLatency(latencyMs);
    recomputeInterval();
  }

  /**
   * Decide whether a new hand sample is allowed this frame.
   * @param {number} nowMs  performance.now()
   * @returns {boolean}
   */
  function shouldSample(nowMs) {
    if (destroyed || throttled) return false;
    if (nowMs - lastSampleMs < currentInterval) return false;
    lastSampleMs = nowMs;
    return true;
  }

  function getStats() {
    const avg = avgLatency();
    return {
      fps: Math.round(fps * 10) / 10,
      avgLatencyMs: Math.round(avg * 10) / 10,
      hands,
      throttled,
      // convenience flags for the HUD / camera module
      intervalMs: currentInterval,
      shouldDegrade: shouldDegrade({ avgLatencyMs: avg, hands }),
    };
  }

  /**
   * Allow the camera module to report the actual number of hands it is
   * currently tracking (after applying the degrade decision).
   * @param {number} n  1 or 2
   */
  function setReportedHands(n) {
    hands = n === 1 ? 1 : 2;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  }

  return {
    beginFrame,
    endSample,
    shouldSample,
    getStats,
    setReportedHands, // camera-module integration point
    destroy,
  };
}
