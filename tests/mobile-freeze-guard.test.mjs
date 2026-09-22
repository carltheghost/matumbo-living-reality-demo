import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideQualityLevel,
  shouldPauseRendering,
  particleBudget,
  resolvePixelRatioCap,
  isCompactViewport,
  COMPACT_VIEWPORT_MAX_WIDTH,
} from '../src/render/render-perf.js';

describe('isCompactViewport', () => {
  it('treats widths <= 700 as compact', () => {
    assert.equal(isCompactViewport(390), true);
    assert.equal(isCompactViewport(700), true);
    assert.equal(isCompactViewport(701), false);
  });
  it('treats degenerate widths as compact (safe default)', () => {
    // canonical repo semantics: anything <= 700 counts as compact
    assert.equal(isCompactViewport(0), true);
    assert.equal(isCompactViewport(-1), true);
  });
});

describe('resolvePixelRatioCap', () => {
  it('forces 1 on compact viewports', () => {
    assert.equal(resolvePixelRatioCap(3, 390), 1);
    assert.equal(resolvePixelRatioCap(2, 700), 1);
  });
  it('caps at 1.5 on non-compact', () => {
    assert.equal(resolvePixelRatioCap(3, 1024), 1.5);
    assert.equal(resolvePixelRatioCap(1.2, 1024), 1.2);
    assert.equal(resolvePixelRatioCap(1, 1024), 1);
  });
});

describe('shouldPauseRendering', () => {
  it('pauses only when document is hidden', () => {
    assert.equal(shouldPauseRendering({ documentHidden: true }), true);
    assert.equal(shouldPauseRendering({ documentHidden: false }), false);
  });
});

describe('decideQualityLevel', () => {
  it('never returns full quality on compact viewports', () => {
    assert.ok(decideQualityLevel({ avgFrameMs: 10, viewportWidth: 390, dpr: 1 }) <= 1);
    assert.ok(decideQualityLevel({ avgFrameMs: 16, viewportWidth: 700, dpr: 2 }) <= 1);
  });
  it('drops to 0 on sustained slow frames', () => {
    assert.equal(decideQualityLevel({ avgFrameMs: 55, viewportWidth: 390, dpr: 1 }), 0);
    assert.equal(decideQualityLevel({ avgFrameMs: 45, viewportWidth: 1024, dpr: 1 }), 0);
  });
  it('returns medium on moderate cost', () => {
    assert.equal(decideQualityLevel({ avgFrameMs: 30, viewportWidth: 390, dpr: 1 }), 1);
    assert.equal(decideQualityLevel({ avgFrameMs: 25, viewportWidth: 1280, dpr: 1 }), 1);
  });
  it('returns full on fast desktop frames', () => {
    assert.equal(decideQualityLevel({ avgFrameMs: 12, viewportWidth: 1280, dpr: 1 }), 2);
  });
  it('caps quality when dpr is high even if frames are fast', () => {
    assert.equal(decideQualityLevel({ avgFrameMs: 12, viewportWidth: 1280, dpr: 2 }), 1);
  });
});

describe('particleBudget', () => {
  it('halves budget on compact / medium quality', () => {
    const fullDesktop = particleBudget({ viewportWidth: 1280, qualityLevel: 2 });
    const halfDesktop = particleBudget({ viewportWidth: 1280, qualityLevel: 1 });
    const lowDesktop = particleBudget({ viewportWidth: 1280, qualityLevel: 0 });
    assert.ok(halfDesktop < fullDesktop);
    assert.ok(lowDesktop < halfDesktop);
    assert.ok(lowDesktop >= 50);
  });
  it('uses smaller base on compact viewports', () => {
    const compactFull = particleBudget({ viewportWidth: 390, qualityLevel: 2 });
    const desktopFull = particleBudget({ viewportWidth: 1280, qualityLevel: 2 });
    assert.ok(compactFull < desktopFull);
  });
  it('never returns zero or negative', () => {
    assert.ok(particleBudget({ viewportWidth: 390, qualityLevel: 0 }) > 0);
  });
});

describe('COMPACT_VIEWPORT_MAX_WIDTH', () => {
  it('is 700', () => {
    assert.equal(COMPACT_VIEWPORT_MAX_WIDTH, 700);
  });
});
