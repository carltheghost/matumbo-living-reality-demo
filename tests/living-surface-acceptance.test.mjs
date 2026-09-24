import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildRealityAssemblyScene} from '../src/render/reality-assembly-scene.js';
import {CLEAN_LANDING_CAMERA} from '../src/render/reality-assembly.js';
import {REALITY_TAB_FORMS} from '../src/domains/reality-tab-layout.js';
import {
  measureContent,
  fitObjectToContent,
  surfaceTransform,
  layoutObjects,
} from '../src/domains/living-surface-layout-engine.js';

const FEATURES = [
  {id:'block-world',label:'Materia',description:'Shared materialized world surface.',sources:['semantic-block-fabric'],boundary:'Local view only.',assemblyTier:'tab'},
  {id:'contracts',label:'Contracts',description:'Contracts and markets connected to the same reality.',sources:['contracts-markets'],boundary:'No execution.',assemblyTier:'tab'},
  {id:'person',label:'Person',description:'Personal space and identity surface.',sources:['person-space'],boundary:'Local view only.',assemblyTier:'tab'},
  {id:'rooms',label:'Rooms',description:'Rooms and places in the living world.',sources:['rooms'],boundary:'Local view only.',assemblyTier:'tab'},
  {id:'academy',label:'Academy',description:'Learning surfaces connected to the same object.',sources:['academy'],boundary:'Local view only.',assemblyTier:'tab'},
  {id:'world-events',label:'Events',description:'World events as a living feature surface.',sources:['world-events'],boundary:'Local view only.',assemblyTier:'tab'},
];

function bootHeadlessAssembly() {
  const parent = new THREE.Scene();
  const targets = [];
  const positions = FEATURES.map((feature,index) => ({
    id:feature.id,
    position:[index * 7 - 17.5, (index % 2) * 1.5, index * 2],
    shape:Object.keys(REALITY_TAB_FORMS)[index % Object.keys(REALITY_TAB_FORMS).length],
    size:1,
  }));
  const scene = buildRealityAssemblyScene({
    THREE,
    parent,
    features:FEATURES.map((feature,index)=>({
      ...feature,
      label:feature.label,
      lensGroup:'worlds',
      initialPosition:positions[index].position,
      initialTabShape:positions[index].shape,
    })),
    targets,
  });
  scene.apply({
    selectedId:null,
    mode:'present',
    objects:positions,
  });
  scene.setLensMode(true);
  scene.layer.visible=true;
  scene.update(1,0,{reducedMotion:true,cameraDistance:110,cameraPosition:new THREE.Vector3(...CLEAN_LANDING_CAMERA.position)});
  return {parent,targets,scene,positions};
}

function volumeFor(node) {
  const form=REALITY_TAB_FORMS[node.shape];
  const scale=node.size??1;
  return form.width*form.height*form.depth*scale**3;
}

function projectHeightFraction(object,camera) {
  const box=new THREE.Box3().setFromObject(object);
  const corners=[];
  for(const x of [box.min.x,box.max.x]) {
    for(const y of [box.min.y,box.max.y]) {
      for(const z of [box.min.z,box.max.z]) corners.push(new THREE.Vector3(x,y,z).project(camera));
    }
  }
  const minY=Math.min(...corners.map(point=>point.y));
  const maxY=Math.max(...corners.map(point=>point.y));
  return (maxY-minY)/2;
}

test('acceptance: every Reality Lens object is fitted to content instead of carrying >1.6x empty volume',()=>{
  const {scene}=bootHeadlessAssembly();
  try {
    for(const feature of FEATURES){
      const node=scene.nodes.get(feature.id);
      assert.ok(node?.isTab, feature.id);
      const descriptor={
        title:feature.label,
        lines:[feature.description,...feature.sources,feature.boundary],
        actions:['Open','Enter'],
      };
      const metrics=measureContent(descriptor);
      const fitted=fitObjectToContent(metrics,{shape:node.shape});
      const actual=volumeFor(node);
      const contentVolume=metrics.width*metrics.height*Math.max(metrics.depth??fitted.depth,Number.EPSILON);
      assert.ok(
        actual <= contentVolume*1.6+1e-6,
        `${feature.id}: object volume ${actual} exceeds 1.6x content-box volume ${contentVolume}`,
      );
      assert.ok(Math.abs(REALITY_TAB_FORMS[node.shape].width-fitted.width)<1e-6 ||
        Math.abs(REALITY_TAB_FORMS[node.shape].height-fitted.height)<1e-6,
        `${feature.id}: rendered form is not derived from the fitted content geometry`);
    }
  } finally {
    scene.destroy();
  }
});

test('acceptance: every fitted panel is a surface-mounted face, never inside the object volume',()=>{
  for(const shape of Object.keys(REALITY_TAB_FORMS)){
    const form=REALITY_TAB_FORMS[shape];
    const metrics=measureContent({
      title:'Reality Lens',
      lines:['A living object surface.','Connected feature data.'],
      actions:['Open','Enter'],
    });
    const fitted=fitObjectToContent(metrics,{shape});
    const panel=surfaceTransform(
      {shape,width:fitted.width,height:fitted.height,depth:fitted.depth},
      {width:fitted.width,height:fitted.height},
      'front',
    );
    const faceDepth=form.depth/2;
    assert.ok(panel.position.every(Number.isFinite), `${shape}: invalid surface position`);
    assert.ok(panel.position[2] > faceDepth, `${shape}: panel is inside the front face`);
    assert.ok(panel.width <= form.width+1e-6, `${shape}: panel exceeds face width`);
    assert.ok(panel.height <= form.height+1e-6, `${shape}: panel exceeds face height`);
    assert.ok(panel.position[2]-faceDepth <= Math.max(.08,form.depth*.75),
      `${shape}: panel is detached too far from the object surface`);
  }
});

test('acceptance: default-camera objects stay below the 40% viewport-height dominance limit',()=>{
  const {scene}=bootHeadlessAssembly();
  const camera=new THREE.PerspectiveCamera(
    CLEAN_LANDING_CAMERA.fov,
    16/9,
    .1,
    500,
  );
  camera.position.set(...CLEAN_LANDING_CAMERA.position);
  camera.lookAt(...CLEAN_LANDING_CAMERA.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  try {
    const visibleTabs=[...scene.nodes.values()].filter(node=>node.isTab&&node.root.visible);
    assert.ok(visibleTabs.length>0,'headless assembly booted without visible Reality Lens tabs');
    for(const node of visibleTabs){
      const fraction=projectHeightFraction(node.root,camera);
      assert.ok(fraction <= .40+1e-6,
        `${node.feature.id}: projected object height is ${(fraction*100).toFixed(1)}% of viewport, above 40%`);
    }
  } finally {
    scene.destroy();
  }
});

test('acceptance: the default layout itself preserves minimum object separation',()=>{
  const items=FEATURES.map((feature,index)=>({
    id:feature.id,
    position:[index*4,0,0],
    width:1,
    height:1,
    depth:1,
  }));
  const laidOut=layoutObjects(items,{width:1280,height:720});
  assert.equal(laidOut.length,items.length);
  for(let i=0;i<laidOut.length;i++)for(let j=i+1;j<laidOut.length;j++){
    const a=laidOut[i].position,b=laidOut[j].position;
    assert.ok(Math.hypot(...a.map((value,axis)=>value-b[axis]))>0,
      `${laidOut[i].id} and ${laidOut[j].id} overlap`);
  }
});

/*
Exact commands:

  git fetch origin
  git checkout main
  git log --oneline -3
  node --test tests/reality-timeline.test.mjs
  node --test tests/reality-workspace.test.mjs
  node --test tests/reality-lens-engine.test.mjs
  node --test tests/reality-object-engine.test.mjs
  node --test tests/reality-assembly-scene.test.mjs
  node --test tests/reality-assembly-unified.test.mjs
  node --test tests/reality-assembly-canonical.test.mjs
  node --test tests/reality-assembly-label-layout.test.mjs
  node --test tests/reality-*.test.mjs

Acceptance gate after lanes 1-4 merge:

  node --test tests/living-surface-acceptance.test.mjs
  node --test tests/reality-*.test.mjs
*/
