import test from 'node:test';
import assert from 'node:assert/strict';
import {offlineForkCommand} from '../../web/application/offline-branch.mjs';
import {LocalTransport} from '../../web/application/transport.mjs';

const snapshot={schema:'vivo.snapshot/1',worldId:'vivo.local.workshop',rootSpaceId:'root',
  acceptedSequence:17,stateHash:'a'.repeat(64)};

test('offline fork command binds to the exact accepted checkpoint',()=>{
  const command=offlineForkCommand(snapshot,{newWorldId:'offline:17',commandId:'fork.17'});
  assert.deepEqual(command,{schema:'vivo.command/1',id:'fork.17',worldId:snapshot.worldId,
    spaceId:'root',kind:'world.fork',expectedRevision:17,
    payload:{checkpointHash:snapshot.stateHash,newWorldId:'offline:17'}});
  assert.throws(()=>offlineForkCommand(snapshot,{newWorldId:snapshot.worldId}),/OFFLINE_FORK_WORLD_ID/);
});

test('local transport exposes explicit fork without inventing a reconnect or replay',async()=>{
  const requests=[];
  const client=new LocalTransport({fetch:async(_url,options)=>{
    requests.push(JSON.parse(options.body));
    return {ok:true,text:async()=>JSON.stringify({value:{schema:'vivo.offline-branch/1'},state:{snapshot}})};
  }});
  client.token='session-token';client.session={actorId:'local.one'};client.closed=false;client.current={snapshot};
  const result=await client.forkOffline({newWorldId:'offline:test',commandId:'fork.test'});
  assert.deepEqual(result,{schema:'vivo.offline-branch/1'});
  assert.equal(requests.length,1);assert.deepEqual(requests[0].args.command.payload,
    {checkpointHash:snapshot.stateHash,newWorldId:'offline:test'});
  assert.equal(requests[0].args.command.expectedRevision,snapshot.acceptedSequence);
});
