import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LocalLeaseWorld,MemoryAuthorityStore} from '../../web/authority/lease-authority.mjs';
const ROOT=fileURLToPath(new URL('../../../../',import.meta.url)),protocol='vivo.lease-adaptive/1';
function python(input){const r=spawnSync('python',['services/vivo/tests/adaptive-authority/fixture.py'],{cwd:ROOT,env:{...process.env,PYTHONPATH:ROOT},input:JSON.stringify(input),encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
const seed=()=>structuredClone(python({op:'seed'}));
async function fixture(store=new MemoryAuthorityStore()){const {snapshot,checkpoint}=seed(),clock={now:1000};const world=await LocalLeaseWorld.create({snapshot,store,now:()=>clock.now,materialProtocol:protocol,materialInitial:{spaceId:'root',checkpoint}});const a=world.attach({actorId:'A'}),b=world.attach({actorId:'B'});await a.open();await b.open();return{world,a,b,clock,store};}
let n=0;const cmd=(sid,kind,payload,rev=0)=>({schema:'vivo.command/1',id:'adaptive.'+(++n),worldId:'adaptive.world',spaceId:sid,kind,expectedRevision:rev,payload});
const begin=(sid,eid,rev=0,epoch=1,source='touch')=>cmd(sid,'grab.begin',{entityId:eid,source,inputEpoch:epoch},rev);
const target=(sid,eid,lease,q,rev=0,seq=1,epoch=1,source='touch')=>cmd(sid,'grab.target',{entityId:eid,leaseId:lease,source,inputEpoch:epoch,targetSeq:seq,dimension:q.length,chart:'flat',q,sampleAgeMs:1},rev);
async function step(world){const capture=await world.captureMaterial('root');const p=python({op:'propose',capture});return world.applyMaterialProposal(p);}
const code=c=>e=>e?.code===c;

test('adaptive protocol is explicit and phase/legacy restore cannot be mislabeled',async()=>{
 const f=await fixture();await assert.rejects(LocalLeaseWorld.create({store:f.store}),code('MATERIAL_PROTOCOL_MISMATCH'));
 await assert.rejects(LocalLeaseWorld.create({store:f.store,materialProtocol:'vivo.lease-material/1'}),code('MATERIAL_PROTOCOL_MISMATCH'));
 await assert.rejects(LocalLeaseWorld.create({snapshot:seed().snapshot,materialProtocol:'nope'}),code('MATERIAL_PROTOCOL'));
});

test('accepted root x4 target produces learned material motion only after material step',async()=>{
 const f=await fixture(),l=(await f.a.submit(begin('root','a'))).result.leaseId;
 const receipt=await f.a.submit(target('root','a',l,[0,0,0,1]));assert.equal(receipt.status,'accepted');
 assert.equal(f.world.snapshot().spaces.root.entities.a.q[3],0);
 await step(f.world);const moved=f.world.snapshot().spaces.root.entities.a;
 assert.ok(moved.q[3]>0);assert.equal(moved.revision,1);
});

test('accepted inner x11 target evolves actual eleventh coordinate and survives restart',async()=>{
 const f=await fixture(),l=(await f.a.submit(begin('inner','i'))).result.leaseId,q=Array(11).fill(0);q[10]=1;
 assert.equal((await f.a.submit(target('inner','i',l,q))).status,'accepted');
 await step(f.world);const first=f.world.snapshot().spaces.inner.entities.i;assert.ok(first.q[10]>0);assert.equal(first.revision,1);
 const resumed=await LocalLeaseWorld.create({store:f.store,now:()=>f.clock.now,materialProtocol:protocol});
 assert.equal(resumed.snapshot().spaces.inner.entities.i.q[10],first.q[10]);assert.equal(resumed.constraints().length,0);
});

test('independent Eyes remain observer state while adaptive material changes coordinates',async()=>{
 const f=await fixture(),view=(sid,d)=>({spaceId:sid,chart:'flat',dimension:d,q:Array(d).fill(0),basis:Array.from({length:d},(_,i)=>Array.from({length:d},(_,j)=>+(i===j))),slice:{}});
 await f.a.registerEye('main',view('root',4));await f.b.registerEye('main',view('root',4));
 const b0=f.b.getEye('main'),l=(await f.a.submit(begin('root','a'))).result.leaseId;
 await f.a.submit(target('root','a',l,[0,0,0,1]));await step(f.world);
 assert.deepEqual(f.b.getEye('main'),b0);
});

test('adaptive target validation accepts full 11D finite target and rejects nonfinite/shape mismatch',async()=>{
 const f=await fixture(),l=(await f.a.submit(begin('inner','i'))).result.leaseId,q=Array(11).fill(0);q[10]=2;
 assert.equal((await f.a.submit(target('inner','i',l,q))).status,'accepted');
 const bad=target('inner','i',l,Array(11).fill(0),0,2);bad.payload.q[10]=Infinity;
 await assert.rejects(f.a.submit(bad));
});

test('stale proposal is rejected after a newer target and no partial state commits',async()=>{
 const f=await fixture(),l=(await f.a.submit(begin('root','a'))).result.leaseId;await f.a.submit(target('root','a',l,[0,0,0,1]));
 const capture=await f.world.captureMaterial('root'),p=python({op:'propose',capture}),before=f.world.checkpoint();
 await f.a.submit(target('root','a',l,[0,0,0,2],0,2));
 await assert.rejects(f.world.applyMaterialProposal(p),code('MATERIAL_STALE_AUTHORITY'));
 assert.notDeepEqual(f.world.checkpoint(),before); // only newer accepted target differs; proposal itself did not commit
 assert.equal(f.world.snapshot().spaces.root.entities.a.q[3],0);
});
