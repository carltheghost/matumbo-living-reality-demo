import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LocalLeaseWorld,MemoryAuthorityStore} from '../../web/authority/lease-authority.mjs';
import {materialDigest} from '../../../vivo_material/codec.mjs';
import {checkMaterialLeases,validateProposal,invariantFingerprint} from '../../web/authority/material-authority.mjs';
const ROOT=fileURLToPath(new URL('../../../../',import.meta.url));
const clone=structuredClone, spaceId='space.phase', eid='entity.0',protocol='vivo.lease-material/1';
function python(input) {const r=spawnSync('python',['services/vivo/tests/material-authority/fixture.py'],{cwd:ROOT,env:{...process.env,PYTHONPATH:ROOT},input:JSON.stringify(input),encoding:'utf8',maxBuffer:24*1024*1024});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
const seedCache=new Map();
function seed(count=1) {if(!seedCache.has(count))seedCache.set(count,python({op:'seed',count}));return clone(seedCache.get(count));}
async function fixture(options={}) {const {snapshot,checkpoint}=seed(options.count),clock={now:1000},store=options.store??new MemoryAuthorityStore();const world=await LocalLeaseWorld.create({snapshot,store,now:()=>clock.now,materialProtocol:protocol,materialInitial:{spaceId,checkpoint}});const a=world.attach({actorId:'A'});await a.open();return {world,a,clock,store};}
let serial=0;
const command=(kind,payload,revision=0)=>({schema:'vivo.command/1',id:'cmd.'+(++serial),worldId:'world.1',spaceId,kind,expectedRevision:revision,payload});
const begin=(revision=0,entityId=eid,inputEpoch=1)=>command('grab.begin',{entityId,source:'touch',inputEpoch},revision);
const target=(leaseId,seq=1,revision=0,entityId=eid,inputEpoch=1)=>command('grab.target',{entityId,leaseId,source:'touch',inputEpoch,targetSeq:seq,dimension:4,chart:'chart.periodic',q:[0,0,0,1],sampleAgeMs:1},revision);
const end=(leaseId,revision=0,inputEpoch=1)=>command('grab.end',{entityId:eid,leaseId,inputEpoch,reason:'released'},revision);
const propose=async world=>python({op:'propose',capture:await world.captureMaterial(spaceId)});
const step=async world=>world.applyMaterialProposal(await propose(world));
const code=value=>e=>e?.code===value;
function rehash(cp) {delete cp.digest;cp.digest=materialDigest(cp);}

 test('opt-in is explicit and restore cannot migrate or silently drop phase state',async()=>{
 const f=await fixture();await assert.rejects(LocalLeaseWorld.create({store:f.store}),code('MATERIAL_PROTOCOL_MISMATCH'));
 await assert.rejects(LocalLeaseWorld.create({store:f.store,materialProtocol:'other'}),code('MATERIAL_PROTOCOL'));
 await assert.rejects(LocalLeaseWorld.create({store:f.store,materialProtocol:protocol,materialInitial:{spaceId,checkpoint:seed().checkpoint}}),code('MATERIAL_INITIAL_ON_RESTORE'));
 const legacyStore=new MemoryAuthorityStore();await LocalLeaseWorld.create({snapshot:seed().snapshot,store:legacyStore});
 await assert.rejects(LocalLeaseWorld.create({store:legacyStore,materialProtocol:protocol}),code('MATERIAL_PROTOCOL_MISMATCH'));
 await assert.rejects(LocalLeaseWorld.create({snapshot:seed().snapshot,materialProtocol:protocol}),code('MATERIAL_INITIAL_REQUIRED'));
 const noGuard={load:()=>null,compareAndSwap:()=>{}};await assert.rejects(LocalLeaseWorld.create({snapshot:seed().snapshot,store:noGuard,materialProtocol:protocol}),code('MATERIAL_STORE_GUARD_REQUIRED'));
 });
 test('generic authority stays strict; material methods are unavailable on client ports',async()=>{
 const {snapshot}=seed();const w=await LocalLeaseWorld.create({snapshot});const a=w.attach();await a.open();
 assert.equal(a.captureMaterial,undefined);assert.equal(a.applyMaterialProposal,undefined);
 assert.equal((await a.submit(begin(1))).code,'STALE_REVISION');
 await assert.rejects(w.captureMaterial(spaceId),code('MATERIAL_DISABLED'));
 await assert.rejects(w.applyMaterialProposal({}),code('MATERIAL_DISABLED'));
 });
 test('coherent host capture is detached and retains the actual authority clock and private session provenance',async()=>{
 const f=await fixture(),l=(await f.a.submit(begin())).result.leaseId;await f.a.submit(target(l));f.clock.now=1123;
 const c=await f.world.captureMaterial(spaceId);assert.equal(c.authorityTimeMs,1123);assert.ok(c.constraints[0].session);assert.equal(c.checkpoint.digest,c.snapshot.spaces[spaceId].field.hash);
 c.constraints[0].target.q[3]=3;c.checkpoint.fields[eid].q[3]=3;assert.equal(f.world.constraints()[0].target.q[3],1);assert.equal((await f.world.captureMaterial(spaceId)).checkpoint.fields[eid].q[3],0);
 });
 test('multiple material steps between target receipts preserve fresh inputs, duplicate original receipts, release, reacquisition',async()=>{
 const f=await fixture(),l=(await f.a.submit(begin())).result.leaseId,first=target(l),r1=await f.a.submit(first);
 await step(f.world);await step(f.world);await step(f.world);
 const lease=f.a.inspectLease(spaceId,eid);assert.equal(lease.inputReceiptRevision,0);assert.equal(lease.materialCoverageRevision,3);
 assert.deepEqual(await f.a.submit(first),r1);assert.equal(f.a.inspectLease(spaceId,eid).inputReceiptRevision,0);
 const late=target(l,2,0),r2=await f.a.submit(late);assert.equal(r2.status,'accepted');assert.equal(r2.entityRevision,3);assert.equal(f.a.inspectLease(spaceId,eid).inputReceiptRevision,3);
 assert.deepEqual(await f.a.submit(first),r1);assert.equal(f.a.inspectLease(spaceId,eid).inputReceiptRevision,3);
 assert.equal((await f.a.submit(target(l,3,0))).code,'STALE_REVISION');
 await step(f.world);assert.equal((await f.a.submit(end(l,3))).status,'accepted');
 assert.deepEqual(await f.a.submit(first),r1);
 assert.equal((await f.a.submit(begin(3,eid,2))).code,'STALE_REVISION');
 const next=(await f.a.submit(begin(4,eid,2))).result.leaseId;assert.notEqual(next,l);
 const current=f.a.inspectLease(spaceId,eid);assert.equal(current.inputReceiptRevision,4);assert.equal(current.materialCoverageRevision,4);
 assert.deepEqual(await f.a.submit(first),r1);assert.deepEqual(f.a.inspectLease(spaceId,eid),current);
 assert.equal((await f.a.submit(target(l,4,4))).code,'LEASE_MISMATCH');
 });
 test('same-session competing controller stays held; separate entities have independent cursors',async()=>{
 const f=await fixture({count:2}),l=(await f.a.submit(begin())).result.leaseId;
 assert.equal((await f.a.submit(begin(0,eid,2))).code,'LEASE_HELD');
 const l2=(await f.a.submit(begin(0,'entity.1'))).result.leaseId;await f.a.submit(target(l));await f.a.submit(target(l2,1,0,'entity.1'));
 await step(f.world);await f.a.submit(target(l,2,0));
 assert.equal(f.a.inspectLease(spaceId,eid).inputReceiptRevision,1);assert.equal(f.a.inspectLease(spaceId,'entity.1').inputReceiptRevision,0);
 assert.equal((await f.a.submit(target(l2,2,0,'entity.1'))).status,'accepted');
 });
 test('input age/source/epoch/frame/order fences remain active across material ticks',async()=>{
 const f=await fixture(),l=(await f.a.submit(begin())).result.leaseId;await f.a.submit(target(l));await step(f.world);
 const stale=target(l,2);stale.payload.sampleAgeMs=151;await assert.rejects(f.a.submit(stale),/Stale target/);
 const source=target(l,2);source.payload.source='hand';assert.equal((await f.a.submit(source)).code,'SOURCE_MISMATCH');
 const epoch=target(l,2);epoch.payload.inputEpoch=2;assert.equal((await f.a.submit(epoch)).code,'LEASE_MISMATCH');
 const frame=target(l,2);frame.payload.chart='other';assert.equal((await f.a.submit(frame)).code,'FRAME_MISMATCH');
 assert.equal((await f.a.submit(target(l))).code,'STALE_TARGET');
 });
 test('old proposal cannot commit after target, release, or another material step',async()=>{
 const f=await fixture(),l=(await f.a.submit(begin())).result.leaseId;await f.a.submit(target(l));
 const p=await propose(f.world);await f.a.submit(target(l,2));await assert.rejects(f.world.applyMaterialProposal(p),code('MATERIAL_STALE_AUTHORITY'));
 const p2=await propose(f.world);await f.a.submit(end(l));await assert.rejects(f.world.applyMaterialProposal(p2),code('MATERIAL_STALE_AUTHORITY'));
 const p3=await propose(f.world);await f.world.applyMaterialProposal(p3);await assert.rejects(f.world.applyMaterialProposal(p3),code('MATERIAL_STALE_AUTHORITY'));
 });
 test('expiry during compute or during persistence rejects without partial acceptance',async()=>{
 class DelayedStore extends MemoryAuthorityStore {advance=null;async compareAndSwap(e,r,o){if(this.advance){await Promise.resolve();this.advance();}return super.compareAndSwap(e,r,o);}}
 const store=new DelayedStore(),f=await fixture({store}),l=(await f.a.submit(begin())).result.leaseId;await f.a.submit(target(l));
 let p=await propose(f.world),before=f.world.checkpoint();f.clock.now=4000;
 await assert.rejects(f.world.applyMaterialProposal(p),code('MATERIAL_STALE_CONSTRAINTS'));assert.deepEqual(f.world.checkpoint(),before);
 f.clock.now=1000;p=await propose(f.world);store.advance=()=>{f.clock.now=4000;};
 await assert.rejects(f.world.applyMaterialProposal(p),code('MATERIAL_STALE_CONSTRAINTS'));assert.deepEqual(f.world.checkpoint(),before);assert.deepEqual(await store.load(),before);
 });
 test('failed CAS leaves checkpoint, q/v, event, snapshot, cursors and observer publication unchanged',async()=>{
 class FailingStore extends MemoryAuthorityStore {fail=false;async compareAndSwap(e,r,o){if(this.fail)throw Object.assign(Error('STORE_CONFLICT'),{code:'STORE_CONFLICT'});return super.compareAndSwap(e,r,o);}}
 const store=new FailingStore(),f=await fixture({store}),l=(await f.a.submit(begin())).result.leaseId;await f.a.submit(target(l));
 const p=await propose(f.world),before=f.world.checkpoint();let published=0;f.a.subscribe(()=>published++);store.fail=true;
 await assert.rejects(f.world.applyMaterialProposal(p),code('STORE_CONFLICT'));assert.deepEqual(f.world.checkpoint(),before);assert.deepEqual(await store.load(),before);assert.equal(published,0);
 store.fail=false;await f.world.applyMaterialProposal(p);assert.equal(published,1);
 });
 test('accepted fields and Eyes survive restart; process leases revoke and history never embeds fields',async()=>{
 const f=await fixture(),view={spaceId,chart:'chart.periodic',dimension:4,q:[0,0,0,0],basis:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],slice:{x4:0}};
 const eye=await f.a.registerEye('eye',view),l=(await f.a.submit(begin())).result.leaseId;await f.a.submit(target(l));await step(f.world);
 const before=f.world.checkpoint(),cp=before.state.material.checkpoint;assert.ok(JSON.stringify(cp).length>65536);
 const events=before.state.events.filter(e=>e.kind==='material-step');assert.equal(events.length,1);assert.ok(JSON.stringify(events).length<8192);assert.equal(JSON.stringify(events).includes('"psi"'),false);
 const resumed=await LocalLeaseWorld.create({store:f.store,now:()=>f.clock.now,materialProtocol:protocol});assert.deepEqual((await resumed.captureMaterial(spaceId)).checkpoint,cp);assert.equal(resumed.constraints().length,0);
 const a=resumed.attach({actorId:'A'});await a.open();assert.deepEqual(a.getEye('eye'),eye);await step(resumed);assert.equal((await resumed.captureMaterial(spaceId)).checkpoint.tick,2);
 });
 test('structural changes and revision gaps cannot be repaired by a later material step',async()=>{
 const f=await fixture(),l=(await f.a.submit(begin())).result.leaseId;await f.a.submit(target(l));const p=await propose(f.world),s=f.world.checkpoint().state;
 for(const mutate of [s=>s.snapshot.spaces[spaceId].entities[eid].revision++,s=>s.snapshot.spaces[spaceId].entities[eid].lineage.push('changed'),s=>s.snapshot.spaces[spaceId].field.handle='new',s=>s.snapshot.spaces[spaceId].law.version='2']) {
   const changed=clone(s);mutate(changed);assert.throws(()=>checkMaterialLeases(changed),code('MATERIAL_LEASE_INVALIDATED'));assert.throws(()=>validateProposal(changed,p,1000),code('MATERIAL_LEASE_INVALIDATED'));
 }
 const changed=clone(s);changed.snapshot.spaces[spaceId].field.hash='f'.repeat(64);assert.equal(invariantFingerprint(changed.snapshot,spaceId,eid),invariantFingerprint(s.snapshot,spaceId,eid));
 });
 test('identity/schema/hash/domain/profile/member/revision/qv/diagnostics forgeries reject atomically',async()=>{
 const f=await fixture(),p=await propose(f.world),before=f.world.checkpoint();
 const mutations=[p=>p.worldId='other',p=>p.authorityId='other',p=>p.spaceId='other',p=>p.schema='remote',p=>p.injected=true,p=>p.baseStateHash='f'.repeat(64),p=>p.baseFieldDigest='f'.repeat(64),p=>p.baseEntityRevisions[eid]++,p=>p.tick++,p=>p.capturedAtMs=1001,p=>p.acceptedLeaseProofs.push({id:'fake'}),p=>p.constraintDigest='f'.repeat(64),p=>p.entityUpdates[0].id='forged',p=>p.entityUpdates[0].q[3]=2,p=>p.diagnostics.mass=NaN,p=>p.fieldDiagnostics[0].mass=42,p=>p.fieldDiagnostics[0].forceBoundPerUnitMass=4,p=>{p.fieldState.fields[eid].revision+=2;rehash(p.fieldState);},p=>{p.fieldState.fields[eid].membership=['wrong'];rehash(p.fieldState);},p=>{p.fieldState.lengths=[9,8,8,8];rehash(p.fieldState);},p=>{p.fieldState.modelHashes=['learned'];rehash(p.fieldState);},p=>{p.fieldState.fields[eid].psi='AAAA';rehash(p.fieldState);},p=>p.fieldState.digest='f'.repeat(64)];
 for(const mutate of mutations) {const bad=clone(p);mutate(bad);await assert.rejects(f.world.applyMaterialProposal(bad));assert.deepEqual(f.world.checkpoint(),before);}
 const badSeed=seed();badSeed.snapshot.spaces[spaceId].entities[eid].materialProfile='elastic';await assert.rejects(LocalLeaseWorld.create({snapshot:badSeed.snapshot,materialProtocol:protocol,materialInitial:{spaceId,checkpoint:badSeed.checkpoint}}),code('MATERIAL_PROFILE'));
 });
 test('phase target domain is half-open, rejected targets preserve lease and cleanup remains possible',async()=>{
 const f=await fixture(),l=(await f.a.submit(begin())).result.leaseId;
 for(const q of [[0,0,0,4],[0,0,0,-4.01],[999,0,0,0]]) {const c=target(l);c.payload.q=q;assert.equal((await f.a.submit(c)).code,'MATERIAL_DOMAIN');assert.equal(f.a.inspectLease(spaceId,eid).target,null);}
 const boundary=target(l);boundary.payload.q=[0,0,0,-4];assert.equal((await f.a.submit(boundary)).status,'accepted');
 assert.equal((await f.a.submit(end(l))).status,'accepted');
 });
 test('privileged structural corruption cannot restore coverage through strict-current target or material step',async()=>{
 // A deliberately aliasing host store injects an external revision, unlike supported stores.
 class CorruptibleStore {supportsCommitGuard=true;record=null;async load(){return this.record;}async compareAndSwap(expected,record,{beforeCommit}={}){assert.equal(this.record?.digest??null,expected);beforeCommit?.();this.record=record;}}
 const store=new CorruptibleStore(),f=await fixture({store}),l=(await f.a.submit(begin())).result.leaseId;await f.a.submit(target(l));
 const p=await propose(f.world),e=store.record.state.snapshot.spaces[spaceId].entities[eid];e.revision++;e.lineage.push('external-change');
 assert.equal((await f.a.submit(target(l,2,1))).code,'LEASE_INVALIDATED');assert.equal(f.a.inspectLease(spaceId,eid).materialCoverageRevision,0);
 await assert.rejects(f.world.applyMaterialProposal(p),code('MATERIAL_LEASE_INVALIDATED'));assert.equal(f.a.inspectLease(spaceId,eid).materialCoverageRevision,0);
 assert.equal((await f.a.submit(end(l,0))).code,'STALE_REVISION');assert.equal((await f.a.submit(end(l,1))).status,'accepted');
 });
 test('replay of the same accepted target/release trajectory reproduces field digests',async()=>{
 async function trajectory(){const f=await fixture(),l=(await f.a.submit(begin())).result.leaseId;await f.a.submit(target(l));const hashes=[];for(let i=0;i<2;i++){await step(f.world);hashes.push((await f.world.captureMaterial(spaceId)).checkpoint.digest);}await f.a.submit(end(l,0));await step(f.world);hashes.push((await f.world.captureMaterial(spaceId)).checkpoint.digest);return hashes;}
 assert.deepEqual(await trajectory(),await trajectory());
 });
 test('material diagnostics are detached latest accepted observations and guard promises fail closed',async()=>{
 const f=await fixture();let c=await f.world.captureMaterial(spaceId);assert.equal(c.diagnostics,null);assert.deepEqual(c.fieldDiagnostics,[]);
 await step(f.world);c=await f.world.captureMaterial(spaceId);assert.ok(c.diagnostics.mass>0);assert.equal(c.fieldDiagnostics[0].entityId,eid);c.diagnostics.mass=0;
 assert.ok((await f.world.captureMaterial(spaceId)).diagnostics.mass>0);
 const store=new MemoryAuthorityStore();await assert.rejects(store.compareAndSwap(null,{digest:'a'},{beforeCommit:()=>Promise.resolve()}),code('STORE_COMMIT_GUARD_ASYNC'));assert.equal(await store.load(),null);
 });
 test('host capture waits behind accepted command persistence and captures one coherent state',async()=>{
 class GatedStore extends MemoryAuthorityStore {gate=null;entered=null;async compareAndSwap(e,r,o){if(this.gate){this.entered();await this.gate;}return super.compareAndSwap(e,r,o);}}
 const store=new GatedStore(),f=await fixture({store}),l=(await f.a.submit(begin())).result.leaseId;
 let release,entered;store.gate=new Promise(resolve=>release=resolve);const wait=new Promise(resolve=>entered=resolve);store.entered=entered;
 const accepted=f.a.submit(target(l));await wait;let captured=false;const pending=f.world.captureMaterial(spaceId).then(c=>{captured=true;return c;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(captured,false);f.clock.now=1234;release();
 const [receipt,capture]=await Promise.all([accepted,pending]);assert.equal(capture.snapshot.acceptedSequence,receipt.acceptedSequence);assert.equal(capture.snapshot.stateHash,receipt.stateHash);assert.equal(capture.constraints[0].id,l);assert.equal(capture.authorityTimeMs,1234);
 });
