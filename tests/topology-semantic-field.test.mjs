import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeTopology,
  resolvePatchByFace,
  semanticPatchesFromTopology,
  topologyNeighborhood,
  topologySummary,
} from '../src/domains/topology-semantic-field.js';

const cubePositions = new Float32Array([
  -1,-1, 1,  1,-1, 1,  1, 1, 1, -1, 1, 1,
  -1,-1,-1, -1, 1,-1,  1, 1,-1,  1,-1,-1,
]);
const cubeIndex = new Uint16Array([
  0,1,2, 0,2,3,
  4,5,6, 4,6,7,
  4,0,3, 4,3,5,
  1,7,6, 1,6,2,
  3,2,6, 3,6,5,
  4,7,1, 4,1,0,
]);
const cubeUvs = new Float32Array([
  0,0, 1,0, 1,1, 0,1,
  0,0, 0,1, 1,1, 1,0,
]);

test('cube topology exposes cells, ridges, adjacency and one closed shell',()=>{
  const topology=analyzeTopology({positions:cubePositions,index:cubeIndex,uvs:cubeUvs,seamAngle:.5});
  const summary=topologySummary(topology);
  assert.equal(summary.components,1);
  assert.equal(summary.closedShells,1);
  assert.ok(summary.ridges>=6);
  assert.ok(summary.cells>=1);
  assert.equal(topology.adjacency.length,8);
  assert.ok(topologyNeighborhood(topology,0,1).length>=4);
});

test('disconnected triangles become independent components and open shells',()=>{
  const positions=new Float32Array([
    0,0,0, 1,0,0, 0,1,0,
    4,0,0, 5,0,0, 4,1,0,
  ]);
  const topology=analyzeTopology({positions});
  const summary=topologySummary(topology);
  assert.equal(summary.components,2);
  assert.equal(summary.closedShells,0);
  assert.equal(summary.boundaries,6);
});

test('bent surface creates feature edges and deterministic topology patches',()=>{
  const positions=new Float32Array([
    0,0,0, 1,0,0, 0,1,0,
    1,0,0, 1,1,.8, 0,1,0,
  ]);
  const uvs=new Float32Array([
    0,0, 1,0, 0,1,
    1,0, 1,1, 0,1,
  ]);
  const topology=analyzeTopology({positions,uvs,seamAngle:.25});
  const content=[
    {id:'status',label:'STATUS',value:'live',priority:1},
    {id:'detail',label:'DETAIL',value:'ridge-bound',priority:.7},
  ];
  const a=semanticPatchesFromTopology({topology,content});
  const b=semanticPatchesFromTopology({topology,content});
  assert.deepEqual(a,b);
  assert.equal(a.length,2);
  assert.ok(a.every(p=>p.faceIndices.length>0));
  assert.ok(a.some(p=>p.trianglesUv.length>0));
  assert.equal(resolvePatchByFace(a,a[0].faceIndices[0])?.id,a[0].id);
});

test('curvature field classifies non-flat local shape without losing vertices',()=>{
  const positions=new Float32Array([
    -1,-1,0, 1,-1,0, 1,1,0,
    -1,-1,0, 1,1,0, -1,1,.9,
  ]);
  const topology=analyzeTopology({positions,curvatureThreshold:.005,seamAngle:.2});
  assert.ok(topology.curvature.some(c=>c.magnitude>0));
  assert.equal(topology.vertexCount,4);
  assert.equal(topology.originalVertexCount,6);
});

test('semantic patches carry topology provenance and cell ownership',()=>{
  const topology=analyzeTopology({positions:cubePositions,index:cubeIndex,uvs:cubeUvs,seamAngle:.5});
  const [patch]=semanticPatchesFromTopology({topology,content:[{id:'ledger',label:'LEDGER',priority:.9}]});
  assert.equal(patch.id,'ledger');
  assert.ok(patch.provenance.includes('topology-native'));
  assert.ok(Number.isInteger(patch.topologyCellId));
  assert.ok(patch.topologyRole);
});
