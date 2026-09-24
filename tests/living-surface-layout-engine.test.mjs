import test from 'node:test';
import assert from 'node:assert/strict';
import {REALITY_TAB_FORMS,realityTabRadius} from '../src/domains/reality-tab-layout.js';
import {
  createLivingSurfaceMap,
  fitLivingSurface,
  focusDistanceForLivingObject,
  relaxLivingRealityLayout,
  composeLivingSurface,
  readingFrameForLivingObject,
  livingReadingProjection,
} from '../src/domains/living-surface-layout-engine.js';

test('each Reality Lens form owns bounded outward-facing living surfaces',()=>{
  for(const shape of Object.keys(REALITY_TAB_FORMS)){
    const map=createLivingSurfaceMap(shape);
    assert.equal(map.shape,shape);
    assert.deepEqual(map.faces.map(face=>face.id),['front','back','left','right','top','bottom']);
    for(const face of map.faces){
      assert.ok(face.width>0&&face.height>0,`${shape}/${face.id} has bounded readable dimensions`);
      assert.ok([...face.position,...face.rotation].every(Number.isFinite),`${shape}/${face.id} stays finite`);
    }
    assert.ok(map.primary.position[2]>0,`${shape} primary surface sits outside its body`);
  }
});

test('curved forms keep a compact readable skin instead of filling their whole body',()=>{
  const cylinder=createLivingSurfaceMap('cylinder'),sphere=createLivingSurfaceMap('sphere');
  assert.ok(cylinder.primary.width<REALITY_TAB_FORMS.cylinder.width);
  assert.ok(cylinder.primary.height<REALITY_TAB_FORMS.cylinder.height);
  assert.equal(cylinder.primary.kind,'arc');
  assert.ok(cylinder.primary.position[2]<REALITY_TAB_FORMS.cylinder.radius,'cylinder skin lies on a cut body facet, not outside its tangent');
  assert.equal(sphere.primary.kind,'hemisphere');
  assert.ok(sphere.primary.width<REALITY_TAB_FORMS.sphere.width);
  assert.ok(sphere.primary.position[2]<REALITY_TAB_FORMS.sphere.radius,'sphere skin is an in-body reading facet');
});

test('optical composition keeps native-size type and touch controls at every form, device and object scale',()=>{
  for(const shape of Object.keys(REALITY_TAB_FORMS))for(const [viewportWidth,viewportHeight] of [[390,844],[1440,900]])for(const size of [.5,1,4]){
    const frame=readingFrameForLivingObject({shape,size,approachScale:2.6,viewportWidth,viewportHeight});
    const face=createLivingSurfaceMap(shape).primary;
    const composed=composeLivingSurface({shape,worldScale:size*2.6,distance:frame.distance-face.position[2]*size*2.6,viewportWidth,viewportHeight});
    assert.equal(composed.textPx,16);assert.equal(composed.touchPx,44);
    assert.ok(composed.actualWidth<=frame.availableWidth+.5,`${shape} fits usable width`);
    assert.ok(composed.actualHeight<=frame.availableHeight+.5,`${shape} fits usable height`);
    assert.ok(Math.abs(composed.width-composed.actualWidth)<10,`${shape} CSS raster does not shrink desktop typography`);
    assert.equal(composed.overflow,'scroll');assert.equal(composed.bodyMutation,false);
    if(viewportWidth<700)assert.equal(composed.columns,1);
    assert.ok(Object.isFrozen(composed));
  }
});

test('edge-on content requests a whole-body turn and never claims readability',()=>{
  for(const cosine of [-1,0,.2,.7]){
    const projection=composeLivingSurface({faceCosine:cosine});
    assert.equal(projection.readable,false);assert.equal(projection.needsTurn,true);
  }
  assert.throws(()=>composeLivingSurface({faceCosine:NaN}),/projection/);
  assert.throws(()=>readingFrameForLivingObject({safeTop:-1}),/frame/);
});

test('phone orientation adapts the whole reading body without changing canonical shape',()=>{
  for(const shape of Object.keys(REALITY_TAB_FORMS))for(const [viewportWidth,viewportHeight] of [[390,844],[844,390]]){
    const projection=livingReadingProjection({shape,viewportWidth,viewportHeight});
    const frame=readingFrameForLivingObject({shape,size:1,approachScale:2.6,viewportWidth,viewportHeight,...projection});
    const face=createLivingSurfaceMap(shape).primary;
    const composition=composeLivingSurface({shape,worldScale:2.6*projection.stretch[0],verticalScale:2.6*projection.stretch[1],distance:frame.distance-face.position[2]*2.6,viewportWidth,viewportHeight});
    assert.equal(projection.shape,shape);assert.equal(projection.canonicalShapeUnchanged,true);
    assert.equal(projection.authority,'projection-only');
    assert.ok(composition.actualHeight>=(viewportHeight>600?340:190),`${shape} has a usable ${projection.mode} reader`);
    assert.ok(composition.actualWidth<=frame.availableWidth+.5);
    assert.ok(composition.actualHeight<=frame.availableHeight+.5);
    assert.ok(Math.abs(composition.width-composition.actualWidth)<10);
    assert.ok(Math.abs(composition.height-composition.actualHeight)<10,'vertical glyph density compensates body stretch');
    if(viewportWidth<700&&['wave','rectangle'].includes(shape))assert.ok(projection.stretch[1]>2,'wide forms unfold vertically as bodies');
    if(viewportHeight<600&&shape==='phone')assert.ok(projection.stretch[0]>2,'landscape phone becomes a broad reading body');
    assert.ok(Object.isFrozen(projection.stretch));
  }
  assert.deepEqual(livingReadingProjection({shape:'wave',viewportWidth:1440,viewportHeight:900}).stretch,[1,1,1]);
});

test('content is clamped to a readable viewport surface instead of stretching the object body',()=>{
  const fit=fitLivingSurface({shape:'cylinder',size:16,approachScale:2.6,distance:22,viewportWidth:1440,viewportHeight:900,safeWidth:96,safeHeight:180});
  assert.ok(fit.width<=((1440-96)*.64)+.001);
  assert.ok(fit.height<=((900-180)*.64)+.001);
  assert.equal(fit.scrollable,true);
  assert.equal(fit.overflowed,true);
});

test('focus camera distance grows with a deliberately enlarged body instead of making a giant close-up',()=>{
  const normal=focusDistanceForLivingObject({shape:'cylinder',size:1,approachScale:2.6,viewportWidth:1440,viewportHeight:900});
  const large=focusDistanceForLivingObject({shape:'cylinder',size:12,approachScale:2.6,viewportWidth:1440,viewportHeight:900});
  assert.ok(large.distance>normal.distance*6);
  assert.equal(normal.occupancy,.54);
  assert.ok(large.distance<=190);
});

test('the deterministic layout solver adds breathing room without moving a locked object',()=>{
  const objects=[
    {id:'anchor',shape:'sphere',size:1,position:[0,0,0],locked:true},
    {id:'cylinder',shape:'cylinder',size:1,position:[0,0,0]},
    {id:'phone',shape:'phone',size:1,position:[.1,0,.1]},
    {id:'wave',shape:'wave',size:1,position:[.15,0,.15]},
  ];
  const options={gap:1.28,maxIterations:32,axis:[54,36,164]};
  const first=relaxLivingRealityLayout(objects,options),second=relaxLivingRealityLayout(objects,options);
  assert.deepEqual(first,second,'the Lens field must not jitter between frames');
  assert.deepEqual(first.objects.find(object=>object.id==='anchor').position,[0,0,0]);
  for(let i=0;i<first.objects.length;i++)for(let j=i+1;j<first.objects.length;j++){
    const a=first.objects[i],b=first.objects[j];
    const distance=Math.hypot(...a.position.map((value,index)=>value-b.position[index]));
    const required=realityTabRadius(a)+realityTabRadius(b)+options.gap;
    assert.ok(distance>=required-.01,`${a.id} and ${b.id} have breathing room`);
  }
  assert.equal(first.diagnostics.collisionCount,0);
});
