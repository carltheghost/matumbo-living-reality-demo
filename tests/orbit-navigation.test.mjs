import test from 'node:test';
import assert from 'node:assert/strict';
import {orbitCamera,orbitPointerDelta} from '../src/render/orbit-navigation.js';
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} differs from ${b}`);
test('orbit turns around the current target while preserving distance and source',()=>{
  const position=[4,5,16],target=[4,5,6],result=orbitCamera({position,target,yaw:Math.PI/2});
  result.position.forEach((v,i)=>near(v,[14,5,6][i]));near(result.distance,10);
  assert.deepEqual(target,[4,5,6]);assert.deepEqual(position,[4,5,16]);assert.notEqual(result.target,target);
});
test('pointer rotation crosses the circular seam without a full spin',()=>{
  near(orbitPointerDelta(179*Math.PI/180,-179*Math.PI/180),2*Math.PI/180);
  near(orbitPointerDelta(-179*Math.PI/180,179*Math.PI/180),-2*Math.PI/180);
  assert.equal(orbitPointerDelta(NaN,0),0);
});
test('travel respects limits and elevation avoids polar singularities',()=>{
  const input={position:[0,0,10],target:[0,0,0],minDistance:3,maxDistance:20};
  near(orbitCamera({...input,zoom:.001}).distance,3);near(orbitCamera({...input,zoom:100}).distance,20);
  const result=orbitCamera({...input,pitch:100});assert(result.position.every(Number.isFinite));assert(result.position[2]>0);near(result.distance,10);
});
test('invalid orbit state fails before emitting a camera change',()=>{
  for(const input of [{position:[0,0,0],target:[0,0,0]},{position:[0,0,10],target:[0,0,0],zoom:0},{position:[NaN,0,10],target:[0,0,0]},{position:[0,0,10],target:[0,0,0],maxDistance:1,minDistance:3}])assert.throws(()=>orbitCamera(input),TypeError);
});
