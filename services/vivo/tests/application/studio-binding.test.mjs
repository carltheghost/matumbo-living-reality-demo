import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STUDIO_BINDING_ID,
  STUDIO_BINDING_IDS,
  STUDIO_SOURCE_NODE,
  applyCanonicalBindingToStudioSnapshot,
  mapStudioNodeToCanonical,
  studioBindingDefinition,
  studioBindingRegistrySeed,
  studioBindingSeed,
  studioCommitCommand,
  studioTransformCommand,
  validateStudioBinding,
} from '../../contracts/studio-binding.mjs';
import {validateCommand} from '../../contracts/validate.mjs';

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

test('Studio registry exposes three stable root objects and applies only the selected node',()=>{
  const registry=studioBindingRegistrySeed();
  assert.deepEqual(Object.keys(registry),['studio.node.echo','studio.node.workpiece','studio.node.portal']);
  const q=Array.from({length:9*64},(_,i)=>i/10);
  const studio={engine:{q,velocity:['kept'],edges:[{a:1,b:2}],law:{id:'rich'}},view:{paused:false,camera:{yaw:.4}}};
  for(const bindingId of STUDIO_BINDING_IDS){
    const definition=studioBindingDefinition(bindingId),binding=registry[bindingId];
    validateStudioBinding(binding);
    assert.equal(binding.sourceNode,definition.sourceNode);
    assert.equal(binding.entityId,definition.entityId);
    assert.deepEqual(mapStudioNodeToCanonical(studio,binding.sourceNode),[
      q[binding.sourceNode*9],q[binding.sourceNode*9+2],q[binding.sourceNode*9+1],q[binding.sourceNode*9+3]]);
    const applied=applyCanonicalBindingToStudioSnapshot(studio,{...binding,q:[11,12,13,14]});
    const offset=binding.sourceNode*9;
    assert.deepEqual([applied.engine.q[offset],applied.engine.q[offset+1],applied.engine.q[offset+2],applied.engine.q[offset+3]],[11,13,12,14]);
    assert.deepEqual(applied.engine.velocity,studio.engine.velocity);assert.deepEqual(applied.engine.edges,studio.engine.edges);
    assert.equal(applied.view.paused,true);assert.equal(studio.view.paused,false);
    const command=studioTransformCommand({schema:'vivo.snapshot/1',worldId:'vivo.local.workshop',acceptedSequence:3},[1,2,3,4],{
      bindingId,metadata:binding.metadata,commandId:'studio.registry.'+bindingId});
    assert.equal(command.payload.bindingId,bindingId);assert.equal(command.payload.sourceNode,binding.sourceNode);
    assert.equal(command.payload.entityId,binding.entityId);assert.equal(command.spaceId,binding.spaceId);
  }
  assert.throws(()=>studioBindingDefinition('studio.node.unknown'),/Unknown Studio binding/);
  assert.throws(()=>studioBindingSeed([1,2,3,4],{bindingId:'studio.node.unknown'}),/Unknown Studio binding/);
  assert.throws(()=>studioBindingSeed([1,2,3,4],{bindingId:'studio.node.workpiece',metadata:{name:'Echo',kind:'RESONANCE \/ 02'}}),/metadata/);
});

test('Studio transform command carries fixed binding identity and an explicit CAS revision',()=>{
  const snapshot={schema:'vivo.snapshot/1',worldId:'vivo.local.workshop',acceptedSequence:7};
  const command=studioTransformCommand(snapshot,[1,2,3,4],{commandId:'studio.test.1'});
  assert.deepEqual(command,{schema:'vivo.command/1',id:'studio.test.1',worldId:snapshot.worldId,spaceId:'root',kind:'studio.transform',expectedRevision:7,
    payload:{bindingId:STUDIO_BINDING_ID,sourceModel:'matumbo-field-lab',sourceNode:55,entityId:'relic',dimension:4,chart:'flat',q:[1,2,3,4],metadata:{name:'Echo',kind:'RESONANCE / 02'}}});
  assert.throws(()=>studioTransformCommand(snapshot,[1001,2,3,4],{commandId:'studio.test.2'}),/coordinates/);
});

test('Studio commit is a separate canonical command with binding and entity CAS',()=>{
  const snapshot={schema:'vivo.snapshot/1',worldId:'vivo.local.workshop',acceptedSequence:7};
  const command=studioCommitCommand(snapshot,[1,2,3,4],{
    commandId:'studio.commit.test.1',expectedBindingRevision:2,expectedEntityRevision:4,
  });
  assert.deepEqual(command,{schema:'vivo.command/1',id:'studio.commit.test.1',worldId:snapshot.worldId,spaceId:'root',kind:'studio.commit',expectedRevision:7,
    payload:{bindingId:STUDIO_BINDING_ID,sourceModel:'matumbo-field-lab',sourceNode:55,entityId:'relic',dimension:4,chart:'flat',q:[1,2,3,4],metadata:{name:'Echo',kind:'RESONANCE / 02'},expectedBindingRevision:2,expectedEntityRevision:4}});
  assert.equal(validateCommand(command),command);
  for(const option of ['expectedBindingRevision','expectedEntityRevision'])
    assert.throws(()=>studioCommitCommand(snapshot,[1,2,3,4],{commandId:'studio.commit.'+option,[option]:-1}),/context/);
  const forged={...command,payload:{...command.payload}};delete forged.payload.expectedEntityRevision;
  assert.throws(()=>validateCommand(forged),/Unexpected or missing keys/);
  const bad={...command,payload:{...command.payload,expectedBindingRevision:.5}};
  assert.throws(()=>validateCommand(bad),/Invalid Studio commit CAS/);
});
