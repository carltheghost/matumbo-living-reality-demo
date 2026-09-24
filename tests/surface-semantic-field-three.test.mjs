import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {
  SurfaceObject,
  ensureSurfaceUv,
  surfaceSlotCountForGeometry,
  surfaceContact,
} from '../src/render/surface-semantic-field-three.js';

test('existing primitive UVs are preserved',()=>{
  const source=new THREE.SphereGeometry(1,16,12);
  const resolved=ensureSurfaceUv(source);
  assert.equal(resolved.generated,false);
  assert.ok(resolved.geometry.getAttribute('uv'));
});

test('hostile no-uv geometry receives an intrinsic surface chart',()=>{
  const source=new THREE.IcosahedronGeometry(1,1);
  source.deleteAttribute('uv');
  const resolved=ensureSurfaceUv(source);
  assert.equal(resolved.generated,true);
  assert.equal(resolved.fallback,'global-planar-chart');
  assert.equal(resolved.geometry.getAttribute('uv').count,resolved.geometry.getAttribute('position').count);
});

test('cube exposes six semantic walls',()=>{
  const geometry=new THREE.BoxGeometry(2,2,2,2,2,2);
  assert.equal(surfaceSlotCountForGeometry(geometry,'cube'),6);
});

test('SurfaceObject changes the mesh material without adding overlay meshes',()=>{
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshBasicMaterial());
  const object=new SurfaceObject({id:'sphere',mesh,shape:'sphere',content:[{id:'state',label:'STATE',value:'READY'}]});
  assert.equal(mesh.children.length,0);
  assert.equal(mesh.userData.ssf,object);
  assert.ok(mesh.material.isMeshPhysicalMaterial);
  const hit=object.hitTest({object:mesh,uv:new THREE.Vector2(object.regions[0].rect.x+.01,object.regions[0].rect.y+.01),face:{materialIndex:0}});
  assert.equal(hit.region.id,'state');
  object.dispose();
});

test('contact mutates both objects own material state',()=>{
  const a=new SurfaceObject({id:'a',mesh:new THREE.Mesh(new THREE.SphereGeometry(1,16,12),new THREE.MeshBasicMaterial()),shape:'sphere'});
  const b=new SurfaceObject({id:'b',mesh:new THREE.Mesh(new THREE.SphereGeometry(1,16,12),new THREE.MeshBasicMaterial()),shape:'sphere'});
  a.mesh.position.set(0,0,0);b.mesh.position.set(2.1,0,0);a.mesh.updateMatrixWorld();b.mesh.updateMatrixWorld();
  const s=surfaceContact(a,b,1);
  assert.ok(s>.8);
  assert.equal(a.contact,b.contact);
  a.dispose();b.dispose();
});
