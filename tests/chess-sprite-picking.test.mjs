import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {isVisibleChessIntersection} from '../src/render/chess-arena-pieces.js';

test('chess sprite picking ignores transparent glyph margins but respects visible pixels and texture UV orientation',()=>{
  const samples=[];
  const image={width:100,height:100,getContext:()=>({getImageData:(x,y)=>{samples.push([x,y]);return {data:[255,255,255,x>=30&&x<70&&y>=20&&y<80?255:0]};}})};
  const map=new THREE.CanvasTexture(image),sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true}));
  assert.equal(isVisibleChessIntersection({object:sprite,uv:new THREE.Vector2(.05,.5)}),false);
  assert.equal(isVisibleChessIntersection({object:sprite,uv:new THREE.Vector2(.5,.75)}),true);
  assert.deepEqual(samples.at(-1),[50,25],'sample canvas coordinates with texture flipY');
  sprite.material.opacity=0;
  assert.equal(isVisibleChessIntersection({object:sprite,uv:new THREE.Vector2(.5,.5)}),false);
  assert.equal(isVisibleChessIntersection({object:new THREE.Mesh(),uv:new THREE.Vector2(0,0)}),true,'solid geometry remains selectable');
  map.dispose();sprite.material.dispose();
});
