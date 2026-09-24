import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import { TopologySurfaceObject } from '../src/render/topology-surface-object.js';

test('TopologySurfaceObject derives semantic patches from mesh cells',()=>{
  const mesh=new THREE.Mesh(
    new THREE.BoxGeometry(2,2,2,2,2,2),
    new THREE.MeshBasicMaterial(),
  );
  const object=new TopologySurfaceObject({
    id:'topo-cube',
    mesh,
    shape:'cube',
    topologyOptions:{seamAngle:.4},
    content:[
      {id:'identity',label:'IDENTITY',value:'cube',priority:1},
      {id:'state',label:'STATE',value:'live',priority:.9},
    ],
  });
  assert.ok(object.topology.cells.length>=1);
  assert.equal(object.regions.length,2);
  assert.ok(object.regions.every(region=>region.faceIndices.length>0));
  assert.ok(object.regions.some(region=>region.trianglesUv.length>0));
  assert.equal(mesh.children.length,0);
  object.dispose();
});

test('topology hit resolution prefers the owning face cell',()=>{
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),new THREE.MeshBasicMaterial());
  const object=new TopologySurfaceObject({
    id:'topo-sphere',
    mesh,
    shape:'sphere',
    topologyOptions:{seamAngle:.45},
    content:[{id:'status',label:'STATUS',value:'ready',priority:1}],
  });
  const patch=object.regions[0];
  const faceIndex=patch.faceIndices[0];
  const hit=object.hitTest({
    object:mesh,
    faceIndex,
    face:{materialIndex:0},
    uv:new THREE.Vector2(.001,.001),
  });
  assert.equal(hit?.region.id,'status');
  assert.equal(hit?.faceIndex,faceIndex);
  object.dispose();
});
