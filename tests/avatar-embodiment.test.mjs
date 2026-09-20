import test from 'node:test';
import assert from 'node:assert/strict';
import {approveAvatarGenome,createAvatarEmbodiment,restoreAvatarEmbodiment} from '../src/domains/avatar-embodiment.js';
async function avatar(clock){const genome=await approveAvatarGenome({personId:'fixture-person',avatarId:'fixture-avatar',assetId:'fixture.glb',assetSha256:'a'.repeat(64),rigId:'humanoid',approvedByUser:true,approvedAt:1});return createAvatarEmbodiment(genome,{clock});}
test('identity and wardrobe never change through camera, occlusion, loss, or source switching',async()=>{
  let now=1000;const a=await avatar(()=>now);const before=JSON.stringify(a.getSnapshot().identity);
  a.appearance.transact({actor:'user',confirmed:true,outfitAssetIds:['approved-jacket']});
  const wardrobe=a.appearance.getSnapshot();
  for(const [i,source] of ['camera','vr','ar','hand','camera'].entries()) {
    a.motion.pushPose({source,sequence:i,timestamp:i+1,confidence:i===4?0:0.9,joints:{head:[0,0.2,0,0.98]}});now+=100;
    assert.equal(JSON.stringify(a.getSnapshot().identity),before);assert.strictEqual(a.appearance.getSnapshot(),wardrobe);
  }
  assert.throws(()=>a.motion.pushPose({source:'camera',sequence:9,timestamp:9,confidence:1,joints:{},outfitAssetIds:['intrusion']}),/Unexpected/);
  now+=3000;assert.equal(a.motion.samplePose().tracking,'rest');assert.deepEqual(a.motion.samplePose().joints.head,[0,0,0,1]);
  assert.ok(Object.isFrozen(a.getSnapshot().identity));assert.equal(a.motion.appearance,undefined);
});
test('explicit appearance versions and world permissions remain separate',async()=>{
  const a=await avatar(()=>1000);
  assert.throws(()=>a.appearance.transact({actor:'world',presetId:'medieval',worldId:'room'}),/locked/);
  a.appearance.transact({actor:'user',confirmed:true,authority:'CONTEXTUAL',approvedPresets:[{id:'medieval',worldId:'room',outfitAssetIds:['tunic']}]});
  assert.throws(()=>a.appearance.transact({actor:'world',presetId:'medieval',worldId:'room'}),/confirmation/);
  assert.throws(()=>a.appearance.transact({actor:'world',confirmed:true,presetId:'medieval',worldId:'room'}),/confirmation/);
  a.appearance.transact({actor:'user',confirmed:true,presetId:'medieval',worldId:'room'});
  assert.equal(a.appearance.getSnapshot().version,2);assert.deepEqual(a.appearance.getSnapshot().outfitAssetIds,['tunic']);
  a.setProjection({projectionId:'vr',worldId:'room'});a.setProjection({projectionId:'phone',worldId:'market'});
  assert.equal(new Set(a.getSnapshot().projections.map(p=>p.avatarId)).size,1);
  assert.ok(!JSON.parse(a.exportPersistent()).motion);assert.equal(a.contribution().entities[0].id,'fixture-person');
});
test('approval and motion validation reject accidental or malformed authority changes',async()=>{
  await assert.rejects(()=>approveAvatarGenome({approvedByUser:false}),/approval/);
  const a=await avatar(()=>1000);
  a.motion.pushPose({source:'camera',sequence:1,timestamp:1,confidence:1,joints:{head:[0,0,0,1]}});
  assert.throws(()=>a.motion.pushPose({source:'camera',sequence:1,timestamp:2,confidence:1,joints:{}}),/order/);
  assert.throws(()=>a.motion.pushPose({source:'camera',sequence:2,timestamp:2,confidence:1,joints:{head:[NaN,0,0,1]}}),/quaternion/);
});
test('persistent restore retains exact approved identity, wardrobe versions and projections, never camera pose',async()=>{
  const a=await avatar(()=>1000);a.appearance.transact({actor:'user',confirmed:true,outfitAssetIds:['my-jacket']});
  a.setProjection({projectionId:'phone',worldId:'room'});
  const saved=a.exportPersistent();const restored=await restoreAvatarEmbodiment(saved,{clock:()=>2000});
  assert.deepEqual(restored.getSnapshot().identity,a.getSnapshot().identity);
  assert.deepEqual(restored.getSnapshot().appearance,a.getSnapshot().appearance);
  assert.deepEqual(restored.getSnapshot().projections,a.getSnapshot().projections);
  assert.equal(restored.motion.samplePose().tracking,'idle');
  const bad=JSON.parse(saved);bad.identity.assetId='replacement';await assert.rejects(()=>restoreAvatarEmbodiment(JSON.stringify(bad)),/integrity/);
});
test('occluded hands decay independently while the head keeps tracking; device sequence can restart',async()=>{
  let now=1000;const a=await avatar(()=>now);
  a.motion.pushPose({source:'camera',sequence:10,timestamp:10,confidence:1,joints:{leftHand:[0,0.6,0,0.8]}});
  now=4000;a.motion.pushPose({source:'vr',sequence:0,timestamp:20,confidence:1,joints:{head:[0,0.1,0,0.99]}});
  assert.deepEqual(a.motion.samplePose().joints.leftHand,[0,0,0,1]);assert.equal(a.motion.samplePose().tracking,'tracked');
});
