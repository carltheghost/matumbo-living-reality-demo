import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalLeaseWorld, MemoryAuthorityStore} from '../../web/authority/lease-authority.mjs';
import {GripHost} from '../../web/authority/grip-host.mjs';
import {validateReceipt} from '../../contracts/validate.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let serial=0;
function seed(d=4) {
  const make=id=>({id,spaceId:'root',chart:'cartesian',dimension:d,q:Array(d).fill(0),v:Array(d).fill(0),
    revision:0,materialProfile:'elastic',fieldMembership:['field0'],innerSpaceId:null,lineage:[]});
  return {schema:'vivo.snapshot/1',worldId:'world',authorityId:'local0',acceptedSequence:0,simulationTime:7,
    rootSpaceId:'root',stateHash:'0'.repeat(64),spaces:{root:{id:'root',dimension:d,intrinsicDimension:d,
      atlasId:'flat',metricId:'euclidean',topologyId:'open',law:{id:'pending-material',version:'0'},modelHashes:[],
      field:{codec:'pending',handle:'field0',hash:'0'.repeat(64)},entities:{relic:make('relic'),other:make('other')}}}};
}
const entity=a=>a.getSnapshot().spaces.root.entities.relic;
const cmd=(kind,payload,rev=0,id='cmd.'+(++serial))=>({schema:'vivo.command/1',id,worldId:'world',spaceId:'root',kind,expectedRevision:rev,payload});
const acquire=(a,source='touch',epoch=1,eid='relic')=>a.submit(cmd('grab.begin',{entityId:eid,source,inputEpoch:epoch}));
const target=(lease,q,seq=1,source='touch',epoch=1)=>cmd('grab.target',{entityId:'relic',leaseId:lease,source,inputEpoch:epoch,
  targetSeq:seq,dimension:q.length,chart:'cartesian',q,sampleAgeMs:1});
const end=(lease,epoch=1)=>cmd('grab.end',{entityId:'relic',leaseId:lease,inputEpoch:epoch,reason:'released'});
async function fixture(options={}) {const world=await LocalLeaseWorld.create({snapshot:seed(options.d),...options});
 const a=world.attach({actorId:'A'}),b=world.attach({actorId:'B'});await a.open({});await b.open({});return{world,a,b};}
async function waitFor(fn) {for(let i=0;i<200;i++){if(fn())return;await sleep(2);}assert.fail('condition timeout');}

for(let d=2;d<=11;d++) test(`${d}D: native absolute constraint; no fake material movement`,async()=>{
 const {world,a}=await fixture({d});const r=await acquire(a),q=Array(d).fill(0);q[d-1]=2;
 const accepted=await a.submit(target(r.result.leaseId,q));validateReceipt(accepted);
 assert.equal(accepted.status,'accepted');assert.deepEqual(world.constraints()[0].target.q,q);
 assert.deepEqual(entity(a).q,Array(d).fill(0));assert.equal(a.getSnapshot().simulationTime,7);
 await a.submit(end(r.result.leaseId));assert.equal(world.constraints().length,0);
});
test('commands require open session',async()=>{
 const w=await LocalLeaseWorld.create({snapshot:seed()});const a=w.attach();await assert.rejects(acquire(a),/NOT_OPEN/);
});
test('no arbitrary actor key in command envelope',async()=>{
 const {a}=await fixture();await assert.rejects(a.submit({...cmd('grab.begin',{entityId:'relic',source:'touch',inputEpoch:1}),actorId:'B'}),/Unexpected/);
});
test('concurrent clients cannot both acquire one relic',async()=>{
 const {a,b}=await fixture();const rs=await Promise.all([acquire(a),acquire(b)]);
 assert.deepEqual(rs.map(r=>r.status).sort(),['accepted','rejected']);assert.equal(rs[1].code,'LEASE_HELD');
});
test('viewer rejected',async()=>{const {world}=await fixture();const v=world.attach({role:'viewer'});await v.open();assert.equal((await acquire(v)).code,'VIEWER');});
test('lease bound to session, not a matching actor name',async()=>{
 const {world,a}=await fixture();const b=world.attach({actorId:'A'});await b.open();const r=await acquire(a);
 assert.equal((await b.submit(target(r.result.leaseId,[1,0,0,0]))).code,'LEASE_MISMATCH');
 await assert.rejects(b.renewLease(r.result.leaseId),/LEASE_EXPIRED/);
});
test('source and epoch fenced',async()=>{
 const {a}=await fixture();const l=(await acquire(a)).result.leaseId;
 assert.equal((await a.submit(target(l,[1,0,0,0],1,'hand'))).code,'SOURCE_MISMATCH');
 assert.equal((await a.submit(target(l,[1,0,0,0],1,'touch',2))).code,'LEASE_MISMATCH');
});
test('revision and target sequence fenced',async()=>{
 const {a}=await fixture();const l=(await acquire(a)).result.leaseId;const c=target(l,[1,0,0,0]);
 assert.equal((await a.submit({...c,expectedRevision:4})).code,'STALE_REVISION');
 await a.submit(c);assert.equal((await a.submit(target(l,[2,0,0,0]))).code,'STALE_TARGET');
});
test('different dimension/chart refused; no timestamp invention',async()=>{
 const {a}=await fixture();const l=(await acquire(a)).result.leaseId;
 assert.equal((await a.submit(target(l,[1,2,3]))).code,'FRAME_MISMATCH');
 const c=target(l,[1,2,3,4]);c.payload.chart='other';assert.equal((await a.submit(c)).code,'FRAME_MISMATCH');
 c.payload.sampleAgeMs=151;await assert.rejects(a.submit(c),/Stale target/);
});
test('idempotent command result, changed-body reuse rejected',async()=>{
 const {a}=await fixture();const c=cmd('grab.begin',{entityId:'relic',source:'touch',inputEpoch:1});
 const r=await a.submit(c);assert.deepEqual(await a.submit(c),r);assert.equal(a.getSnapshot().acceptedSequence,1);
 c.payload.inputEpoch=2;assert.equal((await a.submit(c)).code,'COMMAND_ID_REUSE');
});
test('after release a late target cannot move or reacquire',async()=>{
 const {world,a,b}=await fixture();const l=(await acquire(a)).result.leaseId;await a.submit(end(l));
 await acquire(b);assert.equal((await a.submit(target(l,[1,1,1,1]))).code,'LEASE_MISMATCH');assert.equal(world.constraints().length,0);
});
test('expired lease rejected and swept explicitly',async()=>{
 let now=1000;const {world,a,b}=await fixture({now:()=>now,leaseMs:100});const l=(await acquire(a)).result.leaseId;
 now+=101;assert.equal((await a.submit(target(l,[1,1,1,1]))).code,'LEASE_EXPIRED');await world.sweepExpired();
 assert.equal(a.inspectLease('root','relic'),null);assert.equal((await acquire(b)).status,'accepted');
});
test('renewal uses admitted session and keeps static grip alive',async()=>{
 let now=1000;const {a}=await fixture({now:()=>now,leaseMs:100});const l=(await acquire(a)).result.leaseId;
 now+=90;await a.renewLease(l);now+=90;assert.equal((await a.submit(target(l,[1,1,1,1]))).status,'accepted');
});
test('explicit close clears own lease, not another source/client',async()=>{
 const {a,b}=await fixture();await acquire(a);await acquire(b,'hand',1,'other');await a.close();
 assert.equal(b.inspectLease('root','other').source,'hand');assert.equal((await acquire(b)).status,'accepted');
 await assert.rejects(a.submit(end('anything')),/SESSION_CLOSED/);
});
test('matching reconciliation releases only original lease, never newer one',async()=>{
 const {a,b}=await fixture();const l=(await acquire(a)).result.leaseId;await a.submit(end(l));const n=(await acquire(b)).result.leaseId;
 const result=await a.reconcileLease({worldId:'world',authorityId:'local0',spaceId:'root',entityId:'relic',leaseId:l,inputEpoch:1});
 assert.equal(result.released,true);assert.equal(b.inspectLease('root','relic').id,n);
});
test('another session cannot reconcile holder lease',async()=>{
 const {a,b}=await fixture();const l=(await acquire(a)).result.leaseId;
 await assert.rejects(b.reconcileLease({worldId:'world',authorityId:'local0',spaceId:'root',entityId:'relic',leaseId:l,inputEpoch:1}),/RECONCILE_OWNER/);
});
test('failed atomic store write cannot be falsely accepted',async()=>{
 const memory=new MemoryAuthorityStore();let fail=false;const store={load:()=>memory.load(),compareAndSwap:(a,b)=>{if(fail)throw Error('disk full');return memory.compareAndSwap(a,b);}};
 const {a}=await fixture({store});fail=true;await assert.rejects(acquire(a),/disk full/);
 assert.equal(a.getSnapshot().acceptedSequence,0);assert.equal(a.inspectLease('root','relic'),null);
});
test('snapshot listener cannot mutate accepted state or veto commit',async()=>{
 const {a}=await fixture();a.subscribe(s=>{s.spaces.root.entities.relic.q[0]=50;throw Error('renderer failed');});await acquire(a);
 const copy=a.getSnapshot();copy.spaces.root.entities.relic.q[0]=90;assert.equal(entity(a).q[0],0);
});
test('restore verifies checkpoint; drops old capabilities, keeps object identity and journal',async()=>{
 const store=new MemoryAuthorityStore();const {world,a}=await fixture({store});await acquire(a);await a.submit(target(a.inspectLease('root','relic').id,[0,0,0,9]));
 const restored=await LocalLeaseWorld.create({store});assert.equal(restored.snapshot().spaces.root.entities.relic.id,'relic');
 assert.equal(restored.constraints().length,0);assert.equal(restored.checkpoint().state.events.at(-1).kind,'restart-release');
 assert.equal(world.checkpoint().state.events.length,2);
});
test('tampered checkpoint rejected',async()=>{
 const {world}=await fixture();const bad=world.checkpoint();bad.state.snapshot.simulationTime=20;
 await assert.rejects(LocalLeaseWorld.create({store:{load:async()=>bad}}),/CHECKPOINT_HASH/);
});
test('nested entry requires a registered Eye; world forks remain explicitly unsupported',async()=>{
 const {a}=await fixture();assert.equal((await a.submit(cmd('space.enter',{portalEntityId:'relic',eyeId:'eye'}))).code,'NO_EYE');
 assert.equal((await a.submit(cmd('world.fork',{checkpointHash:'0'.repeat(64),newWorldId:'branch'}))).code,'NOT_IMPLEMENTED');
});
test('journal is bounded; no silent receipt eviction',async()=>{
 const {a}=await fixture({maxEvents:8});const l=(await acquire(a)).result.leaseId;
 for(let i=0;i<7;i++)await a.renewLease(l);await assert.rejects(a.renewLease(l),/JOURNAL_FULL/);
 assert.equal(a.getSnapshot().acceptedSequence,8);
});
test('stale independent store writer fails compare-and-swap',async()=>{
 const store=new MemoryAuthorityStore();const first=await LocalLeaseWorld.create({snapshot:seed(),store});const second=await LocalLeaseWorld.create({store});
 const a=first.attach();const b=second.attach();await a.open();await b.open();await acquire(a);
 await assert.rejects(acquire(b),/STORE_CONFLICT/);assert.equal(b.getSnapshot().acceptedSequence,0);
});

// These run the exact PR #75 controller bytes, not a stand-in input state machine.
test('host acquires lease, previews newest target, ends with canonical final barrier',async()=>{
 const {a,world}=await fixture();let pending;const previews=[];
 const port={...a,submit:c=>{const r=a.submit(c);if(c.kind==='grab.target'&&!pending)return new Promise((resolve,reject)=>{pending=()=>r.then(resolve,reject);});return r;}};
 const host=await GripHost.open(port,{now:()=>10,onPreview:(key,v)=>previews.push([key,v])});
 await host.begin('pointer:1',{entity:entity(a),source:'touch',inputEpoch:1});
 host.offer('pointer:1',{...entity(a),q:[1,0,0,0]},10);await waitFor(()=>pending);
 host.offer('pointer:1',{...entity(a),q:[2,0,0,0]},10);
 const done=host.end('pointer:1','pointerup',{frame:{...entity(a),q:[3,0,0,4]},observedAt:10});pending();await done;
 const targets=world.checkpoint().state.events.filter(e=>e.kind==='grab.target');
 assert.equal(targets.length,2);assert.deepEqual(targets.at(-1).payload.payload.q,[3,0,0,4]);
 assert.equal(previews.filter(([,v])=>v).length,3);assert.equal(world.constraints().length,0);assert.equal(host.state('pointer:1').phase,'closed');
 await host.close();
});
test('hand loss clears only hand preview, preserving touch grip',async()=>{
 const {a}=await fixture();const cleared=[];const host=await GripHost.open(a,{onPreview:(k,v)=>{if(v===null)cleared.push(k);}});
 await host.begin('pointer:1',{entity:entity(a),source:'touch',inputEpoch:1});
 await host.begin('hand:left',{entity:a.getSnapshot().spaces.root.entities.other,source:'hand',inputEpoch:1});
 await host.cancelSource('hand','tracking-lost');assert.equal(host.state('pointer:1').phase,'active');
 assert.ok(cleared.includes('hand:left'));assert.ok(!cleared.includes('pointer:1'));await host.close();
});
test('late acquisition after cancel is cleaned without starting a controller',async()=>{
 const {a}=await fixture();let release;const port={...a,submit:c=>new Promise((res,rej)=>{release=()=>a.submit(c).then(res,rej);})};
 const host=await GripHost.open(port);const p=host.begin('pointer:1',{entity:entity(a),source:'touch',inputEpoch:1});
 const cancelled=host.cancel('pointer:1','pointercancel');release();
 await assert.rejects(p,/ACQUIRE_CANCELLED/);await cancelled;
 assert.equal(a.inspectLease('root','relic'),null);assert.equal(host.state('pointer:1').controller,null);await host.close();
});
test('uncertain target is reconciled; intent never silently replayed',async()=>{
 const {a,world}=await fixture();const port={...a,submit:async c=>{const r=await a.submit(c);if(c.kind==='grab.target')throw Error('lost reply');return r;}};
 const host=await GripHost.open(port);await host.begin('pointer:1',{entity:entity(a),source:'touch',inputEpoch:1});
 host.offer('pointer:1',{...entity(a),q:[1,0,0,1]},performance.now());await waitFor(()=>host.state('pointer:1').phase==='reconciled');
 assert.equal(a.inspectLease('root','relic'),null);assert.equal(world.checkpoint().state.events.filter(e=>e.kind==='grab.target').length,1);
 assert.equal(host.offer('pointer:1',entity(a),performance.now()),false);await host.close();
});
test('host renewal timer holds a motionless lease and close stops it',async()=>{
 const {a}=await fixture({leaseMs:120});const host=await GripHost.open(a);await host.begin('p',{entity:entity(a),source:'touch',inputEpoch:1});
 await sleep(180);assert.ok(a.inspectLease('root','relic'));await host.close();const seq=a.getSnapshot().acceptedSequence;
 await sleep(150);assert.equal(a.getSnapshot().acceptedSequence,seq);assert.equal(a.inspectLease('root','relic'),null);
});
test('stale final capture is not timestamp-refreshed; safe release still happens',async()=>{
 const {a}=await fixture();const host=await GripHost.open(a,{now:()=>1000});await host.begin('p',{entity:entity(a),source:'touch',inputEpoch:1});
 await assert.rejects(host.end('p','up',{frame:entity(a),observedAt:0}),/FINAL_SAMPLE_REJECTED/);
 assert.equal(a.inspectLease('root','relic'),null);await host.close();
});
test('renewal failure triggers real reconciliation, not guessed release',async()=>{
 const {a}=await fixture({leaseMs:100});const host=await GripHost.open({...a,renewLease:async()=>{throw Error('renew refused');}});
 await host.begin('p',{entity:entity(a),source:'touch',inputEpoch:1});await waitFor(()=>host.state('p').phase==='reconciled');
 assert.equal(a.inspectLease('root','relic'),null);await host.close();
});


test('rejected acquire is settled and may be attempted after holder releases',async()=>{
 const {a,b}=await fixture();const l=(await acquire(b)).result.leaseId;const h=await GripHost.open(a);
 await assert.rejects(h.begin('p',{entity:entity(a),source:'touch',inputEpoch:1}),/LEASE_HELD/);
 assert.equal(h.state('p').phase,'closed');await b.submit(end(l));
 await h.begin('p',{entity:entity(a),source:'touch',inputEpoch:1});await h.close();
});
test('invalid acquisition does not poison the source slot',async()=>{
 const {a}=await fixture();const h=await GripHost.open(a);
 await assert.rejects(h.begin('p',{entity:entity(a),source:'unknown',inputEpoch:1}));
 assert.equal(h.state('p'),null);await h.begin('p',{entity:entity(a),source:'touch',inputEpoch:1});await h.close();
});
