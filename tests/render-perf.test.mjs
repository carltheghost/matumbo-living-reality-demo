import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPACT_VIEWPORT_MAX_WIDTH,
  isCompactViewport,
  resolvePixelRatioCap,
  shouldRunSecondaryLoop,
  createVisibilityLoop,
} from '../src/render/render-perf.js';

test('compact viewport boundary matches the mobile panel manager (<=700px)',()=>{
  assert.equal(COMPACT_VIEWPORT_MAX_WIDTH,700);
  assert.equal(isCompactViewport(700),true);
  assert.equal(isCompactViewport(375),true);
  assert.equal(isCompactViewport(701),false);
  assert.equal(isCompactViewport(1920),false);
  assert.equal(isCompactViewport(NaN),false);
});

test('pixel-ratio cap: 1 on compact viewports, desktop cap 1.5 otherwise',()=>{
  // Phone: retina dpr is clamped to 1 (fill-rate / transparent-overdraw win).
  assert.equal(resolvePixelRatioCap(3,375),1);
  assert.equal(resolvePixelRatioCap(2.75,700),1);
  // Desktop: existing min(dpr,1.5) behavior is untouched.
  assert.equal(resolvePixelRatioCap(3,1920),1.5);
  assert.equal(resolvePixelRatioCap(1.25,1366),1.25);
  assert.equal(resolvePixelRatioCap(1,1024),1);
  // Garbage in -> sane 1 on desktop, never 0/NaN/Infinity.
  assert.equal(resolvePixelRatioCap(0,1920),1);
  assert.equal(resolvePixelRatioCap(NaN,1920),1);
});

test('secondary loop gate: runs only when alive, attached, laid out, visible',()=>{
  const ok={alive:true,connected:true,offsetVisible:true,documentHidden:false};
  assert.equal(shouldRunSecondaryLoop(ok),true);
  assert.equal(shouldRunSecondaryLoop({...ok,alive:false}),false);
  assert.equal(shouldRunSecondaryLoop({...ok,connected:false}),false);
  assert.equal(shouldRunSecondaryLoop({...ok,offsetVisible:false}),false);
  assert.equal(shouldRunSecondaryLoop({...ok,documentHidden:true}),false);
});

test('visibility loop: skips work while hidden, resumes without re-wiring',()=>{
  const scheduled=[];
  let visible=true;
  const frames=[];
  const loop=createVisibilityLoop({
    isVisible:()=>visible,
    work:(now)=>{frames.push(now);},
    requestFrame:(fn)=>{scheduled.push(fn);return scheduled.length;},
    cancelFrame:(id)=>{scheduled[id-1]=null;},
  });
  loop.start();
  assert.equal(loop.running,true);
  // Drive three frames: visible, hidden, visible again.
  scheduled.shift()(1);visible=false;scheduled.shift()(2);visible=true;scheduled.shift()(3);
  assert.deepEqual(frames,[1,3]);
  assert.equal(loop.running,true);
  // work returning false stops the loop from inside the frame.
  const stopper=createVisibilityLoop({
    work:()=>false,
    requestFrame:(fn)=>{fn(9);return 1;},
    cancelFrame:()=>{},
  });
  stopper.start();
  assert.equal(stopper.running,false);
  // stop() cancels a pending frame.
  const cancelled=[];
  const pauser=createVisibilityLoop({
    requestFrame:(fn)=>{scheduled.push(fn);return 42;},
    cancelFrame:(id)=>{cancelled.push(id);},
  });
  pauser.start();pauser.stop();
  assert.equal(pauser.running,false);
  assert.deepEqual(cancelled,[42]);
});
