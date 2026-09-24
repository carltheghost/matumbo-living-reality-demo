import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {FEATURE_DEFINITIONS} from '../src/render/feature-navigator.js';
import {realityLensEngine,resolveRealityLensGroup} from '../src/domains/reality-lens-engine.js';
import {REALITY_TAB_FORMS} from '../src/domains/reality-tab-layout.js';
import {focusDistance,solveLivingLayout,surfaceLayout} from '../src/domains/living-surface-layout-engine.js';
import {buildRealityAssemblyScene} from '../src/render/reality-assembly-scene.js';

test('Bot Plaza stays an exterior, readable cylinder in the actual 36-object Lens field',()=>{
  const members=new Map();
  for(const feature of FEATURE_DEFINITIONS){
    const group=resolveRealityLensGroup(feature.id);
    members.set(group,[...(members.get(group)??[]),feature]);
  }
  const shapes=['sphere','phone','rectangle','square','wave','cylinder'];
  const seeded=FEATURE_DEFINITIONS.map((feature,index)=>{
    const group=resolveRealityLensGroup(feature.id),siblings=members.get(group);
    return {id:feature.id,shape:feature.id==='bot-plaza'?'cylinder':shapes[index%shapes.length],
      size:feature.id==='bot-plaza'?24:1,
      position:realityLensEngine.placeInFunnel({id:feature.id,index:siblings.findIndex(item=>item.id===feature.id),count:siblings.length,groupId:group}).position};
  });
  const bot=seeded.find(object=>object.id==='bot-plaza');bot.pinned=true;
  const layout=solveLivingLayout(seeded,{gap:1.02,iterations:96});
  assert.equal(layout.objects.length,FEATURE_DEFINITIONS.length);
  assert.equal(layout.diagnostics.collisionCount,0);
  assert.ok(layout.diagnostics.minimumGap>=1.02-1e-5);
  assert.deepEqual(layout.objects.find(object=>object.id==='bot-plaza').position,bot.position);

  const skin=surfaceLayout({id:'bot-plaza',shape:'cylinder',size:24,contentDensity:100});
  assert.equal(skin.bodyBounds.height,REALITY_TAB_FORMS.cylinder.height);
  assert.ok(skin.primarySurface.position[2]>REALITY_TAB_FORMS.cylinder.depth/2);
  assert.ok(skin.primarySurface.width<skin.bodyBounds.width);
  assert.equal(skin.diagnostics.requiresScroll,true);

  const parent=new THREE.Scene();
  const scene=buildRealityAssemblyScene({THREE,parent,features:FEATURE_DEFINITIONS.map(feature=>({...feature,assemblyTier:'tab'}))});
  scene.apply({selectedId:'bot-plaza',mode:'present',objects:layout.objects});
  scene.setLensMode(true);scene.setActiveGroup('*');scene.layer.visible=true;
  try{
    for(const viewport of [{width:1365,height:937,cap:.58},{width:390,height:844,cap:.55}]){
      const frame=focusDistance({shape:'cylinder',size:24,baseScale:1,approachScale:2.6,
        viewportWidth:viewport.width,viewportHeight:viewport.height,occupancy:viewport.cap});
      const node=scene.nodes.get('bot-plaza'),cameraPosition=node.position.clone().add(new THREE.Vector3(0,0,frame.distance));
      scene.focus('bot-plaza',{distance:frame.distance});
      scene.update(.1,0,{reducedMotion:true,cameraPosition,cameraDistance:frame.distance,
        viewportWidth:viewport.width,viewportHeight:viewport.height,fov:60,occupancy:viewport.cap});
      const scale=node.root.scale.x,nearest=frame.distance-REALITY_TAB_FORMS.cylinder.depth*scale/2;
      const tanVertical=Math.tan(Math.PI/6),tanHorizontal=tanVertical*viewport.width/viewport.height;
      const horizontal=REALITY_TAB_FORMS.cylinder.width*scale/(2*nearest*tanHorizontal);
      const vertical=REALITY_TAB_FORMS.cylinder.height*scale/(2*nearest*tanVertical);
      assert.ok(Math.max(horizontal,vertical)<=viewport.cap+1e-6,`Bot Plaza fits ${viewport.width}px view`);
      assert.equal(node.size,24);
      assert.equal(scene.getSnapshot().focusIsolated,true);
    }
  }finally{scene.destroy();}
});
