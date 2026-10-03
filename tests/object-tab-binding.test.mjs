import test from 'node:test';
import assert from 'node:assert/strict';
import {REALITY_TAB_FORMS} from '../src/domains/reality-tab-layout.js';
import {createLivingSurfaceMap} from '../src/domains/living-surface-layout-engine.js';
import {realityObjectSurfaceEngine as engine,projectSurfaceHitRegion} from '../src/domains/reality-object-engine.js';

test('each shape binds one interactive front to the exact native information face',()=>{
  for(const shape of Object.keys(REALITY_TAB_FORMS)){
    const binding=engine.primarySurfaceBinding({featureId:'youtube',objectId:'youtube',shape});
    const physical=createLivingSurfaceMap(shape,{clearance:0}).primary;
    assert.deepEqual(binding.informationFace,physical);
    assert.equal(binding.entityId,binding.bodyId);
    assert.equal(binding.coordinateSpace,'owning-body-local');
    assert.equal(binding.interactiveFaceCount,1);
    assert.equal(binding.separatePanelFrame,false);
    assert.equal(binding.bodyMutation,false);
    assert.equal(binding.interactionFace.width,physical.width);
    assert.equal(binding.interactionFace.height,physical.height);
    assert.deepEqual(binding.interactionFace.rotation,physical.rotation);
    assert.ok(Math.abs(binding.interactionFace.position[2]-physical.position[2]-.002)<.00011);
    assert.equal(binding.clipPath,engine.clipPath(shape));
    assert.ok(Object.isFrozen(binding)&&Object.isFrozen(binding.interactionFace.position));
  }
});

test('projected hit regions stay on their contour, including an offscreen edge',()=>{
  const points=[[-1.2,.8,0],[-.6,.8,0],[-.6,.2,0],[-1.2,.2,0]];
  const target=projectSurfaceHitRegion({points,viewportWidth:1000,viewportHeight:800});
  assert.equal(target.visible,true);
  assert.ok(Math.abs(target.left-(-100))<1e-8,'partially visible geometry is not shifted into an empty screen pocket');
  assert.ok(Math.abs(target.top-80)<1e-8);
  assert.ok(Math.abs(target.width-300)<1e-8);
  assert.ok(Math.abs(target.height-240)<1e-8);
  assert.equal(target.clipPath,'polygon(0% 0%,100% 0%,100% 100%,0% 100%)');
  assert.deepEqual(projectSurfaceHitRegion({points:points.map(([x,y])=>[x,y,2]),viewportWidth:1000,viewportHeight:800}),{visible:false});
  assert.throws(()=>projectSurfaceHitRegion({points:[[NaN,0,0]],viewportWidth:1000,viewportHeight:800}),/contour/);
});

test('a binding rejects another entity or an unsupported silhouette',()=>{
  assert.throws(()=>engine.primarySurfaceBinding({featureId:'youtube',objectId:'chess'}),/own feature identity/);
  assert.throws(()=>engine.primarySurfaceBinding({featureId:'',objectId:''}),/own feature identity/);
  assert.throws(()=>engine.primarySurfaceBinding({featureId:'youtube',objectId:'youtube',shape:'floating-card'}),/registered body shape/);
});
