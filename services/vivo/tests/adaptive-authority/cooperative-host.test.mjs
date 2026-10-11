import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LocalLeaseWorld,MemoryAuthorityStore} from '../../web/authority/lease-authority.mjs';
import {GripHost} from '../../web/authority/grip-host.mjs';

const ROOT=fileURLToPath(new URL('../../../../',import.meta.url));
function python(input){const r=spawnSync('python',['services/vivo/tests/adaptive-authority/fixture.py'],{
  cwd:ROOT,env:{...process.env,PYTHONPATH:ROOT},input:JSON.stringify(input),encoding:'utf8',maxBuffer:8*1024*1024});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
async function world(){
  const seed=python({op:'seed'}),store=new MemoryAuthorityStore();
  return LocalLeaseWorld.create({snapshot:seed.snapshot,store,now:()=>1000,
    materialProtocol:'vivo.lease-adaptive/1',materialInitial:{spaceId:'root',checkpoint:seed.checkpoint}});
}
test('GripHost forwards explicit cooperative group while two independent controllers share one entity',async()=>{
  const w=await world(),a=w.attach({actorId:'host.A'}),b=w.attach({actorId:'host.B'});
  const A=await GripHost.open(a,{now:()=>10}),B=await GripHost.open(b,{now:()=>10});
  const entity=w.snapshot().spaces.root.entities.a;
  await A.begin('pointer:1',{entity,source:'touch',inputEpoch:1,cooperativeGroup:'shape.team'});
  await B.begin('hand:left',{entity,source:'hand',inputEpoch:1,cooperativeGroup:'shape.team'});
  const la=a.inspectLease('root','a',{source:'touch',inputEpoch:1});
  const lb=b.inspectLease('root','a',{source:'hand',inputEpoch:1});
  assert.equal(la?.cooperativeGroup,'shape.team');assert.equal(lb?.cooperativeGroup,'shape.team');
  assert.notEqual(la?.id,lb?.id);
  await A.end('pointer:1','pointerup');
  assert.equal(a.inspectLease('root','a',{source:'touch',inputEpoch:1}),null);
  assert.equal(b.inspectLease('root','a',{source:'hand',inputEpoch:1})?.id,lb.id);
  await B.end('hand:left','hand-open');
  assert.equal(b.inspectLease('root','a',{source:'hand',inputEpoch:1}),null);
  await A.close();await B.close();
});
