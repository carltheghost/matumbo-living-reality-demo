import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STUDIO_BINDING_ID,
  STUDIO_SOURCE_NODE,
  applyCanonicalBindingToStudioSnapshot,
  mapStudioNodeToCanonical,
  studioBindingSeed,
  studioTransformCommand,
} from '../../contracts/studio-binding.mjs';

test('Studio projection mapping is four-dimensional and does not alias the rich snapshot',()=>{
  const q=Array.from({length:9*64},(_,i)=>i/10),studio={engine:{q,velocity:['kept'],edges:[{a:1,b:2}],law:{id:'rich'}},view:{paused:false,camera:{yaw:.4}},landmarks:[{node:STUDIO_SOURCE_NODE,name:'Echo'}]};
  const binding=studioBindingSeed([10,20,30,40]);
  const mapped=mapStudioNodeToCanonical(studio,STUDIO_SOURCE_NODE);
  assert.deepEqual(mapped,[q[STUDIO_SOURCE_NODE*9],q[STUDIO_SOURCE_NODE*9+2],q[STUDIO_SOURCE_NODE*9+1],q[STUDIO_SOURCE_NODE*9+3]]);
  const applied=applyCanonicalBindingToStudioSnapshot(studio,binding);
  assert.equal(applied.view.paused,true);assert.equal(studio.view.paused,false);
  assert.deepEqual(applied.engine.velocity,studio.engine.velocity);assert.deepEqual(applied.engine.edges,studio.engine.edges);
  assert.equal(applied.engine.q[STUDIO_SOURCE_NODE*9],10);assert.equal(applied.engine.q[STUDIO_SOURCE_NODE*9+1],30);
  assert.equal(applied.engine.q[STUDIO_SOURCE_NODE*9+2],20);assert.equal(applied.engine.q[STUDIO_SOURCE_NODE*9+3],40);
  assert.notEqual(applied.engine.q,studio.engine.q);assert.equal(studio.engine.q[STUDIO_SOURCE_NODE*9],q[STUDIO_SOURCE_NODE*9]);
});

test('Studio transform command carries fixed binding identity and an explicit CAS revision',()=>{
  const snapshot={schema:'vivo.snapshot/1',worldId:'vivo.local.workshop',acceptedSequence:7};
  const command=studioTransformCommand(snapshot,[1,2,3,4],{commandId:'studio.test.1'});
  assert.deepEqual(command,{schema:'vivo.command/1',id:'studio.test.1',worldId:snapshot.worldId,spaceId:'root',kind:'studio.transform',expectedRevision:7,
    payload:{bindingId:STUDIO_BINDING_ID,sourceModel:'matumbo-field-lab',sourceNode:55,entityId:'relic',dimension:4,chart:'flat',q:[1,2,3,4],metadata:{name:'Echo',kind:'RESONANCE / 02'}}});
  assert.throws(()=>studioTransformCommand(snapshot,[1001,2,3,4],{commandId:'studio.test.2'}),/coordinates/);
});
