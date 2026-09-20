/**
 * tests/hand-perf.test.mjs
 * Pure-helper unit tests for the hand-performance governor.
 * Run with: node --test tests/hand-perf.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createHandPerf,
  sampleIntervalFor,
  nextSampleDelay,
  shouldDegrade,
  BASE_INTERVAL_MS,
  HIGH_LATENCY_MS,
  DEGRADE_LATENCY_MS,
  RECOVER_LATENCY_MS,
  INTERVALS_MS,
} from '../src/render/hand-perf.js';

// ---------------------------------------------------------------------------
// sampleIntervalFor / nextSampleDelay
// ---------------------------------------------------------------------------

describe('sampleIntervalFor', () => {
  it('returns base interval for low latency', () => {
    assert.equal(sampleIntervalFor(0), BASE_INTERVAL_MS);
    assert.equal(sampleIntervalFor(20), BASE_INTERVAL_MS);
    assert.equal(sampleIntervalFor(HIGH_LATENCY_MS), BASE_INTERVAL_MS);
  });

  it('steps up to 50 ms once latency exceeds HIGH_LATENCY_MS', () => {
    assert.equal(sampleIntervalFor(HIGH_LATENCY_MS + 0.1), 50);
    assert.equal(sampleIntervalFor(45), 50);
    assert.equal(sampleIntervalFor(50), 50);
  });

  it('steps up to 66 ms for high latency', () => {
    assert.equal(sampleIntervalFor(50.1), 66);
    assert.equal(sampleIntervalFor(80), 66);
  });

  it('only ever returns values from INTERVALS_MS', () => {
    for (const lat of [0, 10, 33, 40, 41, 50, 51, 100, 200]) {
      assert.ok(INTERVALS_MS.includes(sampleIntervalFor(lat)));
    }
  });
});

describe('nextSampleDelay', () => {
  it('mirrors sampleIntervalFor', () => {
    for (const lat of [0, 30, 41, 55, 90]) {
      assert.equal(nextSampleDelay(lat), sampleIntervalFor(lat));
    }
  });

  it('grows monotonically with rising latency', () => {
    const delays = [0, 20, 41, 51, 100].map(nextSampleDelay);
    for (let i = 1; i < delays.length; i++) {
      assert.ok(delays[i] >= delays[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// shouldDegrade
// ---------------------------------------------------------------------------

describe('shouldDegrade', () => {
  it('is false below the degrade threshold', () => {
    assert.equal(shouldDegrade({ avgLatencyMs: 0 }), false);
    assert.equal(shouldDegrade({ avgLatencyMs: DEGRADE_LATENCY_MS }), false);
    assert.equal(shouldDegrade({ avgLatencyMs: DEGRADE_LATENCY_MS - 1 }), false);
  });

  it('is true above the degrade threshold', () => {
    assert.equal(shouldDegrade({ avgLatencyMs: DEGRADE_LATENCY_MS + 0.1 }), true);
    assert.equal(shouldDegrade({ avgLatencyMs: 80 }), true);
  });

  it('ignores the hands field (decision is latency-only)', () => {
    assert.equal(shouldDegrade({ avgLatencyMs: 60, hands: 2 }), true);
    assert.equal(shouldDegrade({ avgLatencyMs: 20, hands: 1 }), false);
  });
});

// ---------------------------------------------------------------------------
// Recovery path (documented thresholds)
// ---------------------------------------------------------------------------

describe('recovery thresholds', () => {
  it('RECOVER_LATENCY_MS is strictly below HIGH_LATENCY_MS', () => {
    assert.ok(RECOVER_LATENCY_MS < HIGH_LATENCY_MS);
  });

  it('HIGH_LATENCY_MS is strictly below DEGRADE_LATENCY_MS', () => {
    assert.ok(HIGH_LATENCY_MS < DEGRADE_LATENCY_MS);
  });

  it('sampleIntervalFor returns base once latency drops under HIGH', () => {
    // After a high-latency period the pure helper itself immediately
    // returns the base interval; the governor adds hysteresis via
    // recomputeInterval, but the pure mapping recovers at once.
    assert.equal(sampleIntervalFor(RECOVER_LATENCY_MS), BASE_INTERVAL_MS);
    assert.equal(sampleIntervalFor(HIGH_LATENCY_MS - 1), BASE_INTERVAL_MS);
  });
});

// ---------------------------------------------------------------------------
// Constants sanity
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('BASE_INTERVAL_MS is 33', () => {
    assert.equal(BASE_INTERVAL_MS, 33);
  });

  it('INTERVALS_MS is the ascending ladder [33, 50, 66]', () => {
    assert.deepEqual([...INTERVALS_MS], [33, 50, 66]);
  });

  it('HIGH_LATENCY_MS is 40', () => {
    assert.equal(HIGH_LATENCY_MS, 40);
  });

  it('DEGRADE_LATENCY_MS is 55', () => {
    assert.equal(DEGRADE_LATENCY_MS, 55);
  });
});

// ---------------------------------------------------------------------------
// Governor degradation / recovery (createHandPerf integration)
// ---------------------------------------------------------------------------

describe('createHandPerf governor', () => {
  it('shouldDegrade boundary: 60 true, 50 false', () => {
    assert.equal(shouldDegrade({ avgLatencyMs: 60 }), true);
    assert.equal(shouldDegrade({ avgLatencyMs: 50 }), false);
  });

  it('degrades under sustained high latency and recovers with hysteresis', () => {
    const perf = createHandPerf();

    // Fill the ring with high-latency samples.
    for (let i = 0; i < 16; i++) perf.endSample(80);
    let stats = perf.getStats();
    assert.equal(stats.avgLatencyMs, 80);
    assert.equal(stats.shouldDegrade, true);
    assert.ok(
      stats.intervalMs === 50 || stats.intervalMs === 66,
      `interval must step up under load, was ${stats.intervalMs}`,
    );

    // Partial recovery above RECOVER_LATENCY_MS: hysteresis holds the
    // slower interval instead of stepping down.
    for (let i = 0; i < 16; i++) perf.endSample(35);
    stats = perf.getStats();
    assert.equal(stats.avgLatencyMs, 35);
    assert.ok(
      stats.intervalMs === 50 || stats.intervalMs === 66,
      `hysteresis must hold the slower interval, was ${stats.intervalMs}`,
    );

    // Full recovery at/below RECOVER_LATENCY_MS steps back down.
    for (let i = 0; i < 16; i++) perf.endSample(10);
    stats = perf.getStats();
    assert.equal(stats.intervalMs, 33, 'interval must recover toward base');
    assert.equal(stats.shouldDegrade, false);

    perf.destroy();
  });

  it('setReportedHands feeds getStats().hands', () => {
    const perf = createHandPerf();
    perf.setReportedHands(1);
    assert.equal(perf.getStats().hands, 1);
    perf.setReportedHands(2);
    assert.equal(perf.getStats().hands, 2);
    perf.destroy();
  });

  it('shouldSample returns false after destroy()', () => {
    const perf = createHandPerf();
    perf.destroy();
    assert.equal(perf.shouldSample(99999), false);
    assert.equal(perf.shouldSample(performance.now() + 1000), false);
  });
});
