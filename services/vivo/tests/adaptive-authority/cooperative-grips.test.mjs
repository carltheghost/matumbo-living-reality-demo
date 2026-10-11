import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LocalLeaseWorld,MemoryAuthorityStore} from '../../web/authority/lease-authority.mjs';

const ROOT=fileURLToPath(new URL('../../../../',import.meta.url));
const protocol='vivo.lease-adaptive/1';
function python(input){
  const r=spawnSync('python',['services/vivo/tests/adaptive-authority/fixture.py'],{
    cwd:ROOT,env:{...process.env,PYTHONPATH:ROOT},input:JSON.stringify(input),encoding:'utf8',maxBuffer:8*1024*1024});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
async function fixture(){
  const seeded=python({op:'seed'}),store=new MemoryAuthorityStore(),clock={now:1000};
  const world=await LocalLeaseWorld.create({snapshot:seeded.snapshot,store,now:()=>clock.now,
    materialProtocol:protocol,materialInitial:{spaceId:'root',checkpoint:seeded.checkpoint}});
  const a=world.attach({actorId:'person.A'}),b=world.attach({actorId:'person.B'}),c=world.attach({actorId:'person.C'});
  await a.open();await b.open();await c.open();return{world,a,b,c,store,clock};
}
let serial=0;
const command=(sid,kind,revision,payload)=>({schema:'vivo.command/1',id:'coop.'+(++serial),
  worldId:'adaptive.world',spaceId:sid,kind,expectedRevision:revision,payload});
const begin=(group,epoch,source='touch')=>command('root','grab.begin',0,{entityId:'a',source,inputEpoch:epoch,cooperativeGroup:group});
const target=(lease,groupQ,epoch,seq,source='touch',revision=0)=>command('root','grab.target',revision,{
  entityId:'a',leaseId:lease,source,inputEpoch:epoch,targetSeq:seq,dimension:4,chart:'flat',q:groupQ,sampleAgeMs:1});
const end=(lease,epoch,revision=0)=>command('root','grab.end',revision,{entityId:'a',leaseId:lease,inputEpoch:epoch,reason:'done'});
async function materialStep(f){
  const capture=await f.world.captureMaterial('root');
  const proposal=python({op:'propose',capture});
  return f.world.applyMaterialProposal(proposal);
}

test('two people hold one adaptive object through explicit matching cooperative group',async()=>{
  const f=await fixture();
  const ra=await f.a.submit(begin('shape.team',1,'touch'));
  const rb=await f.b.submit(begin('shape.team',1,'hand'));
  assert.equal(ra.status,'accepted');assert.equal(rb.status,'accepted');
  assert.notEqual(ra.result.leaseId,rb.result.leaseId);
  assert.equal(ra.result.cooperativeGroup,'shape.team');assert.equal(rb.result.cooperativeGroup,'shape.team');
  await f.a.submit(target(ra.result.leaseId,[0,1,0,0],1,1,'touch'));
  await f.b.submit(target(rb.result.leaseId,[0,0,0,1],1,1,'hand'));
  const leases=f.world.constraints().filter(l=>l.entityId==='a');
  assert.equal(leases.length,2);assert.deepEqual(new Set(leases.map(l=>l.actorId)),new Set(['person.A','person.B']));
});

test('cooperative grips combine orthogonal constraints into one persistent entity state',async()=>{
  const f=await fixture();
  const a=(await f.a.submit(begin('shape.team',1,'touch'))).result.leaseId;
  const b=(await f.b.submit(begin('shape.team',1,'hand'))).result.leaseId;
  assert.equal((await f.a.submit(target(a,[0,1,0,0],1,1,'touch'))).status,'accepted');
  assert.equal((await f.b.submit(target(b,[0,0,0,1],1,1,'hand'))).status,'accepted');
  await materialStep(f);
  const e=f.world.snapshot().spaces.root.entities.a;
  assert.equal(e.revision,1);assert.ok(e.q[1]>0);assert.ok(e.q[3]>0);
  assert.equal(f.world.constraints().filter(l=>l.entityId==='a').length,2);
});

test('one collaborator release leaves the other cooperative grip alive',async()=>{
  const f=await fixture();
  const a=(await f.a.submit(begin('shape.team',1,'touch'))).result.leaseId;
  const b=(await f.b.submit(begin('shape.team',1,'hand'))).result.leaseId;
  await f.a.submit(target(a,[0,1,0,0],1,1,'touch'));
  await f.b.submit(target(b,[0,0,0,1],1,1,'hand'));
  await materialStep(f);
  assert.equal((await f.a.submit(end(a,1,0))).status,'accepted');
  let leases=f.world.constraints().filter(l=>l.entityId==='a');
  assert.equal(leases.length,1);assert.equal(leases[0].id,b);assert.equal(leases[0].actorId,'person.B');
  assert.equal((await f.b.submit(end(b,1,0))).status,'accepted');
  assert.equal(f.world.constraints().filter(l=>l.entityId==='a').length,0);
});

test('exclusive grab and mismatched cooperative groups cannot mix',async()=>{
  const f=await fixture();
  assert.equal((await f.a.submit(begin('shape.one',1,'touch'))).status,'accepted');
  const wrong=await f.b.submit(begin('shape.two',1,'hand'));assert.equal(wrong.status,'rejected');assert.equal(wrong.code,'LEASE_HELD');
  const exclusive=await f.c.submit(command('root','grab.begin',0,{entityId:'a',source:'keyboard',inputEpoch:1}));
  assert.equal(exclusive.status,'rejected');assert.equal(exclusive.code,'LEASE_HELD');
});

test('cooperative mode is rejected outside the adaptive material protocol',async()=>{
  const seeded=python({op:'seed'}),snap=structuredClone(seeded.snapshot);
  for(const space of Object.values(snap.spaces)){
    space.law={id:'pending-material',version:'0'};space.modelHashes=[];
    space.field={codec:'pending',handle:'f.'+space.id,hash:'0'.repeat(64)};
    delete space.adaptiveEdges;
    for(const e of Object.values(space.entities))e.materialProfile='elastic';
  }
  const world=await LocalLeaseWorld.create({snapshot:snap});
  const a=world.attach({actorId:'plain.A'});await a.open();
  const receipt=await a.submit(command('root','grab.begin',0,{entityId:'a',source:'touch',inputEpoch:1,cooperativeGroup:'shape'}));
  assert.equal(receipt.status,'rejected');assert.equal(receipt.code,'COOPERATIVE_UNSUPPORTED');
});

test('cooperative accepted state survives restart while process-local leases are revoked',async()=>{
  const f=await fixture();
  const a=(await f.a.submit(begin('shape.team',1,'touch'))).result.leaseId;
  const b=(await f.b.submit(begin('shape.team',1,'hand'))).result.leaseId;
  await f.a.submit(target(a,[0,1,0,0],1,1,'touch'));await f.b.submit(target(b,[0,0,0,1],1,1,'hand'));
  await materialStep(f);const q=structuredClone(f.world.snapshot().spaces.root.entities.a.q);
  const resumed=await LocalLeaseWorld.create({store:f.store,now:()=>f.clock.now,materialProtocol:protocol});
  assert.deepEqual(resumed.snapshot().spaces.root.entities.a.q,q);
  assert.equal(resumed.constraints().length,0);
});

test('inspectLease criteria disambiguate two cooperative sources owned by one session',async()=>{
  const f=await fixture();
  const first=(await f.a.submit(begin('shape.team',1,'touch'))).result.leaseId;
  const second=(await f.a.submit(begin('shape.team',2,'hand'))).result.leaseId;
  assert.notEqual(first,second);
  assert.equal(f.a.inspectLease('root','a'),null);
  assert.equal(f.a.inspectLease('root','a',{source:'touch',inputEpoch:1}).id,first);
  assert.equal(f.a.inspectLease('root','a',{source:'hand',inputEpoch:2}).id,second);
});
