import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildRealityAssemblyScene,realityLensInscription} from '../src/render/reality-assembly-scene.js';
import {createLivingSurfaceMap} from '../src/domains/living-surface-layout-engine.js';

function installCanvasDocument(textRuns){
  const context={
    beginPath(){},closePath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},roundRect(){},clip(){},
    fill(){},stroke(){},fillRect(){},arc(){},ellipse(){},
    createLinearGradient(){return {addColorStop(){}};},createRadialGradient(){return {addColorStop(){}};},
    measureText(value){return {width:String(value).length*7};},
    fillText(value){textRuns.push(String(value));},
  };
  const previous=globalThis.document;
  globalThis.document={createElement(name){assert.equal(name,'canvas');return {width:0,height:0,getContext(kind){assert.equal(kind,'2d');return context;}};}};
  return ()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;};
}

test('feature copy and domain words are inscribed on the same 3D lens surface',()=>{
  const textRuns=[],restore=installCanvasDocument(textRuns),parent=new THREE.Scene();
  const id='contract-atelier',feature={id,label:'Contract Atelier',description:'One shared object and time.',sources:['local-contracts'],boundary:'Presentation only.',assemblyTier:'tab',lensGroup:'agents',initialTabShape:'sphere',initialPosition:[0,0,-5]};
  const scene=buildRealityAssemblyScene({THREE,parent,features:[feature],targets:[]});
  try{
    const node=scene.nodes.get(id),surface=node.artSurface,copy=realityLensInscription(feature);
    assert.equal(surface.userData.realityLensInscription,true);
    assert.deepEqual(surface.userData.inscription,copy);
    assert.equal(copy.title,'Contract Atelier');
    assert.equal(copy.groupLabel,'AGENTES');
    assert.equal(surface,node.tabMesh,'the texture is painted directly onto the sphere body');
    assert.equal(surface.geometry.type,'SphereGeometry','the artwork follows the actual spherical silhouette');
    assert.ok(node.artMaterial.map?.isCanvasTexture,'the words are drawn into the mesh material texture');
    assert.equal(node.edgeMaterial,null,'the sphere has no wireframe card/frame overlay');
    assert.ok(textRuns.includes('Contract Atelier'));
    assert.ok(textRuns.includes('AGENTES'));
    assert.ok(!textRuns.some(text=>/one universe|one point/i.test(text)),'no separate floating status plaque is drawn');
  }finally{scene.destroy();restore();}
});

test('XR inscriptions remain attached to the actual silhouette for every supported form',()=>{
  const restore=installCanvasDocument([]),parent=new THREE.Scene(),shapes=['sphere','cylinder','rectangle','square','wave','phone','cube'];
  const scene=buildRealityAssemblyScene({THREE,parent,features:shapes.map((shape,index)=>({id:`lens-${shape}`,label:`Lens ${shape}`,description:'Shared local view.',sources:[],assemblyTier:'tab',lensGroup:'experiences',initialTabShape:shape,initialPosition:[index*4,0,-5]})),targets:[]});
  try{
    for(const shape of shapes){
      const node=scene.nodes.get(`lens-${shape}`),surface=node.artSurface;
      assert.equal(surface.userData.realityLensInscription,true,shape);
      assert.equal(surface.userData.inscription.title,`Lens ${shape}`,shape);
      assert.ok(node.artMaterial.map?.isCanvasTexture,shape);
      if(shape==='sphere')assert.equal(surface,node.tabMesh,shape);
      else if(shape!=='cube')assert.ok(Math.abs(surface.position.z-createLivingSurfaceMap(shape).primary.position[2])<.00001,`${shape} skin stays on its body`);
    }
    assert.deepEqual(scene.getSnapshot().inscriptionIds,shapes.map(shape=>`lens-${shape}`));
  }finally{scene.destroy();restore();}
});
