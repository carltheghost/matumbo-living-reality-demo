import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {FEATURE_DEFINITIONS} from '../src/render/feature-navigator.js';
import {REALITY_TAB_FORMS,REALITY_TAB_FORM_IDS} from '../src/domains/reality-tab-layout.js';
import {realityLensEngine,resolveRealityLensGroup} from '../src/domains/reality-lens-engine.js';
import {surfaceLayout,focusDistance,solveLivingLayout,resolveLivingTabPosition,createLivingSurfaceComposer} from '../src/domains/living-surface-layout-engine.js';
import {buildRealityAssemblyScene} from '../src/render/reality-assembly-scene.js';
import {placeLivingWrapperAnchor,computeLivingFocusOccupancy} from '../src/render/reality-assembly.js';

// The user's exported local history ended with this Bot Plaza state. The
// export is observation history, so a small fixture keeps this test portable.
const SAVED_BOT=Object.freeze({id:'bot-plaza',shape:'cylinder',size:.887,position:[-1.014,4.539,20.425]});
const close=(actual,expected,tolerance=1e-4)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected} by more than ${tolerance}`);

function actualField(botSize=SAVED_BOT.size){
  const groups=new Map();
  for(const feature of FEATURE_DEFINITIONS){
    const group=resolveRealityLensGroup(feature.id);
    groups.set(group,[...(groups.get(group)??[]),feature]);
  }
  const objects=FEATURE_DEFINITIONS.map((feature,index)=>{
    const group=resolveRealityLensGroup(feature.id),members=groups.get(group);
    return {id:feature.id,shape:REALITY_TAB_FORM_IDS[index%REALITY_TAB_FORM_IDS.length],size:1,
      position:realityLensEngine.placeInFunnel({id:feature.id,index:members.findIndex(item=>item.id===feature.id),count:members.length,groupId:group}).position};
  });
  const bot=objects.find(object=>object.id===SAVED_BOT.id);
  Object.assign(bot,{shape:SAVED_BOT.shape,size:botSize,position:[...SAVED_BOT.position],pinned:true});
  return solveLivingLayout(objects,{gap:1.28,iterations:96}).objects;
}

function projectionBounds({node,front,camera}){
  node.root.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const box=node.tabMesh.geometry.boundingBox??(node.tabMesh.geometry.computeBoundingBox(),node.tabMesh.geometry.boundingBox);
  const projected=[];
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    projected.push(node.root.localToWorld(new THREE.Vector3(x,y,z)).project(camera));
  }
  for(const x of [-front.width/2,front.width/2])for(const y of [-front.height/2,front.height/2]){
    projected.push(node.root.localToWorld(new THREE.Vector3(x,y,front.position[2])).project(camera));
  }
  return {x:Math.max(...projected.map(point=>Math.abs(point.x))),y:Math.max(...projected.map(point=>Math.abs(point.y)))};
}

test('all seven forms expose one near-full readable face and a shape-specific outer wrapper',()=>{
  assert.equal(REALITY_TAB_FORM_IDS.length,7);
  const expectedContours={phone:'rounded-rectangle',square:'rounded-rectangle',rectangle:'rounded-rectangle',
    sphere:'circle',cylinder:'cylinder',cube:'rounded-rectangle',wave:'wave'};
  for(const shape of REALITY_TAB_FORM_IDS){
    const base=surfaceLayout({id:`fixture-${shape}`,shape,size:1,position:[0,0,0]});
    const dense=surfaceLayout({id:`fixture-${shape}`,shape,size:1,position:[0,0,0],contentDensity:1000});
    const {wrapper,primarySurface,bodyBounds}=base;
    assert.equal(wrapper.shape,shape);
    assert.equal(wrapper.contour,expectedContours[shape]);
    close(wrapper.width,bodyBounds.width);
    close(wrapper.height,bodyBounds.height);
    close(wrapper.frontDepth,primarySurface.position[2]);
    close(primarySurface.position[0],0);
    close(primarySurface.position[1],0);
    assert.ok(wrapper.frontDepth>0,`${shape}: reading face belongs on the exterior`);
    for(const axis of ['width','height']){
      const coverage=primarySurface[axis]/wrapper[axis];
      assert.ok(coverage>=.88&&coverage<=.92,`${shape} ${axis} coverage ${coverage} should fill its own silhouette`);
      assert.ok(wrapper.contentBounds[axis]>0&&wrapper.contentBounds[axis]<=wrapper.frameBounds[axis]+1e-4,`${shape}: content stays inside the frame`);
      assert.ok(wrapper.frameBounds[axis]<=wrapper[axis]+1e-4,`${shape}: frame stays inside the body`);
    }
    if(shape==='sphere')assert.ok(Math.hypot(wrapper.contentBounds.width,wrapper.contentBounds.height)<=wrapper.width*.97,
      'square controls stay fully inside the spherical outline');
    assert.deepEqual(dense.wrapper,wrapper,`${shape}: copy length must not grow the form`);
    assert.deepEqual(dense.primarySurface,primarySurface,`${shape}: copy length only scrolls inside the form`);
    assert.equal(dense.diagnostics.requiresScroll,true);
    assert.equal(bodyBounds.width,REALITY_TAB_FORMS[shape].width);
    assert.equal(bodyBounds.height,REALITY_TAB_FORMS[shape].height);
    for(const {width,height,cap} of [{width:1365,height:937,cap:.58},{width:390,height:844,cap:.55}]){
      const camera=focusDistance({shape,size:1,approachScale:2.6,viewportWidth:width,viewportHeight:height,fov:60,occupancy:cap});
      const near=camera.distance-wrapper.frontDepth*2.6;
      assert.ok(near>0,`${shape}: front remains in front of the focus camera`);
      const horizontal=primarySurface.width*2.6/(2*near*Math.tan(Math.PI/6)*width/height);
      const vertical=primarySurface.height*2.6/(2*near*Math.tan(Math.PI/6));
      assert.ok(Math.max(horizontal,vertical)<=cap+.025,`${shape}: the live face exceeds ${width}px view`);
    }
  }
});

test('the actual 36-feature field builds the same shell and wrapper, including saved Bot Plaza',()=>{
  const objects=actualField();
  assert.equal(objects.length,FEATURE_DEFINITIONS.length);
  assert.equal(objects.length,36);
  assert.deepEqual(objects.find(item=>item.id===SAVED_BOT.id).position,SAVED_BOT.position);
  const scene=buildRealityAssemblyScene({THREE,parent:new THREE.Scene(),features:FEATURE_DEFINITIONS.map(feature=>({...feature,assemblyTier:'tab'}))});
  try{
    scene.apply({selectedId:SAVED_BOT.id,mode:'present',objects});
    const seen=new Set();
    for(const object of objects){
      const node=scene.nodes.get(object.id),skin=surfaceLayout({id:object.id,shape:object.shape,size:object.size,position:object.position});
      assert.ok(node?.tabMesh,`${object.id}: selectable shell exists`);
      assert.equal(node.shape,skin.wrapper.shape,`${object.id}: shell and panel use one form`);
      seen.add(node.shape);
      const box=node.tabMesh.geometry.boundingBox??(node.tabMesh.geometry.computeBoundingBox(),node.tabMesh.geometry.boundingBox);
      const shellWidth=box.max.x-box.min.x,shellHeight=box.max.y-box.min.y;
      // Bevels and wave peaks may extend a little beyond the nominal form.
      assert.ok(Math.abs(shellWidth-skin.wrapper.width)<.12,`${object.id}: wrapper and shell widths diverge (${shellWidth}, ${skin.wrapper.width})`);
      assert.ok(Math.abs(shellHeight-skin.wrapper.height)<(node.shape==='wave'?.27:.12),`${object.id}: wrapper and shell heights diverge (${shellHeight}, ${skin.wrapper.height})`);
    }
    assert.deepEqual([...seen].sort(),[...REALITY_TAB_FORM_IDS].sort());
    const bot=scene.nodes.get(SAVED_BOT.id);
    close(bot.size,SAVED_BOT.size);
    assert.equal(bot.tabMesh.geometry.type,'CylinderGeometry');
  }finally{scene.destroy();}
});

test('saved and 24× Bot Plaza shells and their fronts remain in desktop and phone focus',()=>{
  for(const size of [SAVED_BOT.size,24]){
    const objects=actualField(size);
    const scene=buildRealityAssemblyScene({THREE,parent:new THREE.Scene(),features:FEATURE_DEFINITIONS.map(feature=>({...feature,assemblyTier:'tab'}))});
    try{
      scene.apply({selectedId:SAVED_BOT.id,mode:'present',objects});
      scene.setLensMode(true);scene.setActiveGroup('*');scene.layer.visible=true;
      for(const {width,height,occupancy} of [{width:1365,height:937,occupancy:.58},{width:390,height:844,occupancy:.55}]){
        const node=scene.nodes.get(SAVED_BOT.id);
        const framing=focusDistance({shape:'cylinder',size,baseScale:node.scale??1,approachScale:2.6,
          viewportWidth:width,viewportHeight:height,fov:60,occupancy});
        const camera=new THREE.PerspectiveCamera(60,width/height,.1,1000);
        const target=new THREE.Vector3(...SAVED_BOT.position);
        camera.position.copy(target).add(new THREE.Vector3(0,0,framing.distance));
        camera.lookAt(target);camera.updateProjectionMatrix();
        scene.focus(SAVED_BOT.id,{distance:framing.distance});
        scene.update(.1,0,{reducedMotion:true,cameraPosition:camera.position,cameraDistance:framing.distance,
          viewportWidth:width,viewportHeight:height,fov:60,occupancy});
        const skin=surfaceLayout({id:SAVED_BOT.id,shape:'cylinder',size,position:SAVED_BOT.position});
        const bounds=projectionBounds({node,front:skin.primarySurface,camera});
        assert.ok(bounds.x<=occupancy+.025,`${size}× cylinder exceeds ${width}px horizontal focus: ${bounds.x}`);
        assert.ok(bounds.y<=occupancy+.025,`${size}× cylinder exceeds ${height}px vertical focus: ${bounds.y}`);
        assert.ok(node.root.scale.x>0,`${size}× remains visible`);
      }
    }finally{scene.destroy();}
  }
});

test('the cylinder wrapper frame and CSS3D front stay registered at both oblique yaws',()=>{
  const skin=surfaceLayout({...SAVED_BOT,contentDensity:50});
  const world=new THREE.Scene(),root=new THREE.Group(),anchor=new THREE.Group();
  root.position.set(...SAVED_BOT.position);root.scale.setScalar(SAVED_BOT.size);world.add(root);root.add(anchor);
  // The real renderer gives its front DOM host 320 CSS pixels per world unit.
  // The frame's visible front is 0.012 world units behind that host.
  const pixelsPerUnit=320,frameFront=new THREE.Group(),cssFront=new THREE.Group();
  frameFront.position.z=-.012;cssFront.scale.setScalar(1/pixelsPerUnit);
  anchor.add(frameFront,cssFront);
  const wrapper=skin.wrapper;
  for(const {width,height,cap} of [{width:1365,height:937,cap:.58},{width:390,height:844,cap:.55}]){
    const framing=focusDistance({shape:SAVED_BOT.shape,size:SAVED_BOT.size,viewportWidth:width,viewportHeight:height,
      fov:60,occupancy:cap});
    const camera=new THREE.PerspectiveCamera(60,width/height,.1,1000);
    for(const yaw of [-Math.PI/4,Math.PI/4]){
      const target=root.position.clone();
      camera.position.copy(target).add(new THREE.Vector3(Math.sin(yaw)*framing.distance,.15*framing.distance,
        Math.cos(yaw)*framing.distance));
      camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
      placeLivingWrapperAnchor({THREE,root,cameraWorld:camera.position,anchor,face:skin.primarySurface,contour:wrapper.contour});
      const facing=new THREE.Vector3(0,0,1).applyQuaternion(anchor.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const cameraRay=camera.position.clone().sub(anchor.getWorldPosition(new THREE.Vector3())).normalize();
      assert.ok(facing.dot(cameraRay)>.97,`wrapper faces the camera at ${Math.round(yaw*180/Math.PI)}°`);
      const localCamera=root.worldToLocal(camera.position.clone());
      const expectedYaw=Math.atan2(localCamera.x,localCamera.z);
      close(anchor.position.x,Math.sin(expectedYaw)*wrapper.frontDepth,1e-5);
      close(anchor.position.z,Math.cos(expectedYaw)*wrapper.frontDepth,1e-5);
      for(const [u,v] of [[0,0],[-1,-1],[-1,1],[1,-1],[1,1]]){
        const frame=frameFront.localToWorld(new THREE.Vector3(u*wrapper.width/2,v*wrapper.height/2,0)).project(camera);
        const css=cssFront.localToWorld(new THREE.Vector3(
          u*Math.round(wrapper.width*pixelsPerUnit)/2,v*Math.round(wrapper.height*pixelsPerUnit)/2,0)).project(camera);
        const pixelDistance=Math.hypot((frame.x-css.x)*width/2,(frame.y-css.y)*height/2);
        assert.ok(pixelDistance<4,`frame/CSS drift ${pixelDistance.toFixed(2)}px at ${width}px, yaw ${Math.round(yaw*180/Math.PI)}°, corner ${u},${v}`);
      }
      const frameNormal=new THREE.Vector3(0,0,1).applyQuaternion(frameFront.getWorldQuaternion(new THREE.Quaternion()));
      const cssNormal=new THREE.Vector3(0,0,1).applyQuaternion(cssFront.getWorldQuaternion(new THREE.Quaternion()));
      close(frameNormal.dot(cssNormal),1,1e-6);
    }
  }
});

test('future forms can register a profile or provide one for a single object',()=>{
  const profile={body:{width:2,height:1.5,depth:.2},contour:'rounded-rectangle',coverage:.88,frontDepth:.24};
  const composer=createLivingSurfaceComposer({profiles:{'hex-diary':profile}});
  const registered=composer.surfaceLayout({id:'new-form',shape:'hex-diary',size:1,position:[0,0,0]});
  const local=surfaceLayout({id:'local-form',shape:'hex-diary',profile,size:1,position:[0,0,0]});
  for(const skin of [registered,local]){
    assert.equal(skin.wrapper.shape,'hex-diary');
    assert.equal(skin.wrapper.contour,'rounded-rectangle');
    close(skin.wrapper.width,2);close(skin.wrapper.height,1.5);close(skin.wrapper.depth,.2);
    close(skin.wrapper.frontDepth,.24);
    close(skin.primarySurface.width,1.76);close(skin.primarySurface.height,1.32);
    assert.ok(skin.wrapper.contentBounds.width<=skin.wrapper.frameBounds.width);
  }
  assert.deepEqual(registered.wrapper,local.wrapper);
  const viewport={shape:'hex-diary',size:3,approachScale:2.6,viewportWidth:390,viewportHeight:844,fov:60,occupancy:.55};
  assert.deepEqual(composer.focusDistance(viewport),focusDistance({...viewport,profile}),
    'a registered form uses its own bounds in focus framing');
  const layout=composer.solveLivingLayout([
    {id:'new-form',shape:'hex-diary',size:3,position:[0,0,0],pinned:true},
    {id:'neighbor',shape:'rectangle',size:1,position:[0,0,0]},
  ],{gap:1.02});
  close(layout.objects[0].radius,Math.hypot(1,.75,.1)*3,1e-4);
  assert.equal(layout.diagnostics.collisionCount,0,'the custom footprint also participates in collision avoidance');
  assert.deepEqual(layout.objects[0].position,[0,0,0]);
});

test('phone focus fits between measured chrome and custom drag preview equals recorded move',()=>{
  const occupancy=computeLivingFocusOccupancy({viewportHeight:568,top:164,bottom:408});
  assert.ok(occupancy<.4);
  assert.ok(568/2-occupancy*568/2>=164+10);
  assert.ok(568/2+occupancy*568/2<=408-10);
  const profile={body:{width:7,height:1.4,depth:.3},contour:'rounded-rectangle'};
  const shapes={'wide-archive':{'archive-card':profile}};
  const objects=[{id:'wide-archive',shape:'archive-card',size:1,position:[0,0,0]},
    {id:'neighbor',shape:'phone',size:1,position:[10,0,0]}];
  const preview=resolveLivingTabPosition('wide-archive',[9,0,0],objects,{shapeProfiles:shapes});
  const committed=resolveLivingTabPosition('wide-archive',preview,objects,{shapeProfiles:shapes});
  assert.deepEqual(committed,preview,'pointer release should not move the custom object again');
  assert.ok(Math.hypot(...preview.map((value,index)=>value-objects[1].position[index]))>5);
});
