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
  const leases=w.constraints().filter(l=>l.entityId==='a');
  assert.equal(leases.length,2);assert.deepEqual(new Set(leases.map(l=>l.cooperativeGroup)),new Set(['shape.team']));
  assert.equal(A.offer('pointer:1',{spaceId:'root',chart:'flat',dimension:4,q:[0,1,0,0]},10),true);
  assert.equal(B.offer('hand:left',{spaceId:'root',chart:'flat',dimension:4,q:[0,0,0,1]},10),true);
  for(let i=0;i<50&&w.constraints().filter(l=>l.entityId==='a'&&l.target!==null).length<2;i++)
    await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(w.constraints().filter(l=>l.entityId==='a'&&l.target!==null).length,2);
  await A.end('pointer:1','pointerup');assert.equal(w.constraints().filter(l=>l.entityId==='a').length,1);
  await B.end('hand:left','hand-open');assert.equal(w.constraints().filter(l=>l.entityId==='a').length,0);
  await A.close();await B.close();
});
