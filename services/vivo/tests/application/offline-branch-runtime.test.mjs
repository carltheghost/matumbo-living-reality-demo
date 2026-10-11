import test from 'node:test';
import assert from 'node:assert/strict';
import {MountedRuntime} from '../../server/application/runtime.mjs';

test('mounted runtime accepts an explicit offline branch from its current checkpoint',async t=>{
  const runtime=await MountedRuntime.open({store:'memory'});
  t.after(async()=>{if(!runtime.closed)await runtime.dispatch({op:'shutdown'});});
  const opened=await runtime.dispatch({op:'open',args:{seat:'one'}});
  const snapshot=opened.state.snapshot;
  const command={schema:'vivo.command/1',id:'runtime.fork',worldId:snapshot.worldId,spaceId:snapshot.rootSpaceId,
    kind:'world.fork',expectedRevision:snapshot.acceptedSequence,
    payload:{checkpointHash:snapshot.stateHash,newWorldId:'offline:runtime'}};
  const result=await runtime.dispatch({op:'submit',token:opened.token,args:{command}});
  assert.equal(result.value.status,'accepted');assert.equal(result.value.code,'OFFLINE_BRANCH');
  assert.equal(result.value.result.parentWorldId,snapshot.worldId);
  assert.equal(result.value.result.checkpointHash,snapshot.stateHash);
  assert.equal(result.value.result.snapshot.worldId,'offline:runtime');
  assert.deepEqual(Object.keys(result.value.result.snapshot.spaces).sort(),Object.keys(snapshot.spaces).sort());
  const exported=await runtime.dispatch({op:'export',token:opened.token});
  assert.equal(exported.value.history.events.at(-1).kind,'world-fork');
  assert.equal(exported.value.snapshot.worldId,snapshot.worldId);
});
