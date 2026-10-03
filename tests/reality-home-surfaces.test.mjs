import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {REALITY_HOME_SHAPES,createHomeSurfaceDocument,createRealityHomeSurface} from '../src/render/reality-home-surfaces.js';

test('home previews preserve real membership and expose exactly one meaningful space action',()=>{
  const calls=[];
  const document=createHomeSurfaceDocument({id:'experiences',label:'Play, media & learning',description:'Explore the existing experiences.',
    members:[{feature:{id:'chess',label:'Chess',description:'Play a game.'}},{feature:{id:'youtube',label:'YouTube',description:'Search and play.'}}],onOpen:id=>calls.push(id)});
  const blocks=document.read();
  assert.deepEqual(blocks.filter(block=>block.actionId).map(block=>block.actionId),['open-space:experiences']);
  assert.ok(blocks.some(block=>block.text==='2 objects in this space'));
  assert.ok(blocks.some(block=>block.text==='Chess — Play a game.'));
  assert.ok(blocks.some(block=>block.text==='YouTube — Search and play.'));
  assert.equal(document.activate('chess'),false,'member previews cannot fire a wrong feature action');
  document.activate('open-space:experiences');assert.deepEqual(calls,['experiences']);
});

test('the home factory makes five whole shape families and scales real geometry for layout',()=>{
  assert.equal(new Set(Object.values(REALITY_HOME_SHAPES)).size,5);
  for(const id of Object.keys(REALITY_HOME_SHAPES)){
    const home=createRealityHomeSurface({THREE,id,label:id,members:[],height:3.9});
    const bounds=home.geometry.boundingBox;
    assert.ok(Math.abs(bounds.max.y-bounds.min.y-3.9)<1e-5);
    assert.equal(home.materials.length,home.geometry.groups.length);
    assert.equal(home.shape,REALITY_HOME_SHAPES[id]);
    assert.ok(home.materials.every(material=>material.userData.realityLensGroup===id));
    home.geometry.dispose();home.materials.forEach(material=>material.dispose());
  }
});
