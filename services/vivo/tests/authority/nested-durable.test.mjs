import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,rmdir,readFile,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {LocalLeaseWorld,MemoryAuthorityStore} from '../../web/authority/lease-authority.mjs';
import {FileAuthorityStore} from '../../server/authority/file-store.mjs';
import {GripController} from '../../web/input/controller.mjs';
const run=promisify(execFile);
let serial=0;
const view=(spaceId='root',d=4)=>({spaceId,dimension:d,chart:'flat',q:Array(d).fill(0),
  basis:Array.from({length:d},(_,i)=>Array.from({length:d},(_,j)=>+(i===j))),slice:{['x'+d]:0}});
const entity=(id,sid,d,inner=null)=>({id,spaceId:sid,dimension:d,chart:'flat',q:Array(d).fill(0),v:Array(d).fill(0),revision:7,
  materialProfile:'elastic',fieldMembership:['field.'+sid],innerSpaceId:inner,lineage:[]});
function seed(){
 const space=(id,d,entities)=>({id,dimension:d,intrinsicDimension:d,atlasId:'flat',metricId:'euclidean',topologyId:'open',
  law:{id:'pending-material',version:'0'},modelHashes:[],field:{codec:'pending',handle:'field.'+id,hash:'0'.repeat(64)},entities,entryView:view(id,d)});
 return {schema:'vivo.snapshot/1',worldId:'nested.world',authorityId:'nested.authority',acceptedSequence:0,simulationTime:12,
  rootSpaceId:'root',stateHash:'0'.repeat(64),spaces:{root:space('root',4,{portal:entity('portal','root',4,'inner')}),
  inner:space('inner',11,{work:entity('work','inner',11),portal2:entity('portal2','inner',11,'deep')}),
  deep:space('deep',2,{mark:entity('mark','deep',2)})}};
}
const command=(kind,spaceId,payload,expectedRevision=7,id='cmd.'+(++serial))=>({schema:'vivo.command/1',id,worldId:'nested.world',spaceId,kind,expectedRevision,payload});
async function setup(options={}){const w=await LocalLeaseWorld.create({snapshot:seed(),...options});
 const a=w.attach({actorId:'A'}),b=w.attach({actorId:'B'});await a.open();await b.open();
 await a.registerEye('eye',view());await b.registerEye('eye',view());return{w,a,b};}
const enter=(a,spaceId='root',portalEntityId='portal',eyeId='eye')=>a.submit(command('space.enter',spaceId,{portalEntityId,eyeId}));
const exit=(a,r)=>a.submit(command('space.exit',r.result.eye.spaceId,{eyeId:'eye',returnFrameId:r.result.returnFrameId},r.result.eye.revision));
const checkNoMaterialChange=(before,after)=>{assert.deepEqual(after.spaces,before.spaces);assert.equal(after.simulationTime,before.simulationTime);};

test('nested 4D -> 11D -> 2D -> return restores full frame, orientation, slices and shared identities',async()=>{
 const {w,a,b}=await setup();const before=a.getSnapshot(),bv=b.getEye('eye'),v=view();
 v.q=[1,2,3,4];v.slice.x4=4;v.basis=[[0,0,0,1],[0,1,0,0],[0,0,1,0],[-1,0,0,0]];
 await a.moveEye('eye',v,0);const saved=a.getEye('eye');
 const r=await enter(a);assert.equal(r.status,'accepted');assert.equal(r.result.eye.dimension,11);
 const inner=a.getEye('eye');inner.q[10]=9;inner.slice.x11=9;await a.moveEye('eye',inner,inner.revision);
 const r2=await enter(a,'inner','portal2');assert.equal(r2.result.eye.dimension,2);
 const back=await exit(a,r2);assert.equal(back.status,'accepted');assert.equal(back.result.eye.q[10],9);
 const backRoot=await exit(a,{result:{eye:back.result.eye,returnFrameId:r.result.returnFrameId}});
 assert.equal(backRoot.status,'accepted');const restored=a.getEye('eye');
 for(const k of ['q','basis','slice','dimension','chart','spaceId'])assert.deepEqual(restored[k],saved[k]);
 assert.equal(restored.stack.length,0);assert.deepEqual(b.getEye('eye'),bv);
 checkNoMaterialChange(before,a.getSnapshot());assert.deepEqual(a.getSnapshot(),b.getSnapshot());
 assert.ok(w.checkpoint().state.events.some(e=>e.kind==='space.enter'));
});

test('native extra-axis Eye motion is independent from entity state and another Eye',async()=>{
 const {a,b}=await setup();await a.registerEye('second',view());const second=a.getEye('second'),before=a.getSnapshot();
 const moved=view();moved.q[3]=5;await a.moveEye('eye',moved,0);
 assert.equal(a.getEye('eye').q[3],5);assert.equal(b.getEye('eye').q[3],0);assert.deepEqual(a.getEye('second'),second);
 checkNoMaterialChange(before,a.getSnapshot());
});

test('readbacks are detached; material snapshots do not expose another observer state',async()=>{
 const {a}=await setup();let e=a.getEye('eye');e.q[3]=999;e.stack.push({});
 assert.equal(a.getEye('eye').q[3],0);assert.equal(a.getEye('eye').stack.length,0);
 assert.equal(Object.hasOwn(a.getSnapshot(),'eyes'),false);
});

test('stale Eye revision and implicit chart/space changes cannot replace accepted observer state',async()=>{
 const {a}=await setup();await a.moveEye('eye',view(),0);const before=a.getEye('eye');
 await assert.rejects(a.moveEye('eye',view(),0),/STALE_EYE/);
 await assert.rejects(a.moveEye('eye',view('inner',11),1),/EYE_FRAME_MISMATCH/);
 await assert.rejects(a.moveEye('eye',{...view(),chart:'elsewhere'},1),/EYE_FRAME_MISMATCH/);
 assert.deepEqual(a.getEye('eye'),before);
});

test('invalid bases, sparse coordinates, nonspatial slices and direct inner registration rejected',async()=>{
 const {a}=await setup();for(const v of [ {...view(),q:new Array(4)}, {...view(),basis:Array(4).fill([1,0,0,0])},
  {...view(),slice:{time:5}}, {...view(),slice:{x5:1}} ])await assert.rejects(a.moveEye('eye',v,0));
 await assert.rejects(a.registerEye('new',view('inner',11)),/EYE_START_ROOT/);
});

test('an unregistered Eye cannot be borrowed from another admitted actor',async()=>{
 const {w,a}=await setup();const c=w.attach({actorId:'C'});await c.open();
 assert.equal(c.getEye('eye'),null);assert.equal((await enter(c)).code,'NO_EYE');
 assert.equal(a.getEye('eye').spaceId,'root');
});

test('viewer can traverse their own Eye without being allowed to grab',async()=>{
 const {w}=await setup();const a=w.attach({actorId:'V',role:'viewer'});await a.open();await a.registerEye('eye',view());
 assert.equal((await enter(a)).status,'accepted');
 assert.equal((await a.submit(command('grab.begin','inner',{entityId:'work',source:'touch',inputEpoch:1}))).code,'VIEWER');
});

test('portal revision and known explicit entry view are required',async()=>{
 const {a}=await setup();assert.equal((await a.submit(command('space.enter','root',{portalEntityId:'portal',eyeId:'eye'},0))).code,'STALE_REVISION');
 const s=seed();delete s.spaces.inner.entryView;const {a:x}=await setup({snapshot:s});
 assert.equal((await enter(x)).code,'NO_ENTRY_VIEW');assert.equal(x.getEye('eye').spaceId,'root');
});

test('return frame is LIFO and revision-fenced; a foreign or old frame cannot navigate',async()=>{
 const {a,b}=await setup();const a1=await enter(a),b1=await enter(b);
 assert.equal((await a.submit(command('space.exit','inner',{eyeId:'eye',returnFrameId:b1.result.returnFrameId},a1.result.eye.revision))).code,'RETURN_MISMATCH');
 const a2=await enter(a,'inner','portal2');assert.equal((await exit(a,a1)).code,'EYE_SPACE_MISMATCH');
 const bad={result:{eye:{...a2.result.eye,revision:0},returnFrameId:a2.result.returnFrameId}};
 assert.equal((await exit(a,bad)).code,'STALE_EYE');
 assert.equal((await exit(a,a2)).status,'accepted');
});

test('duplicate enter receipt does not duplicate the return stack',async()=>{
 const {a}=await setup();const c=command('space.enter','root',{portalEntityId:'portal',eyeId:'eye'});
 const r=await a.submit(c),seq=a.getSnapshot().acceptedSequence;assert.deepEqual(await a.submit(c),r);
 assert.equal(a.getEye('eye').stack.length,1);assert.equal(a.getSnapshot().acceptedSequence,seq);
 assert.equal((await a.submit({...c,payload:{...c.payload,portalEntityId:'other'}})).code,'COMMAND_ID_REUSE');
});

test('active own grip blocks entry; another participant grip does not move or block this Eye',async()=>{
 const {a,b}=await setup();const r=await a.submit(command('grab.begin','root',{entityId:'portal',source:'touch',inputEpoch:1}));
 assert.equal((await enter(a)).code,'GRIP_ACTIVE');assert.equal((await enter(b)).status,'accepted');
 await a.submit(command('grab.end','root',{entityId:'portal',leaseId:r.result.leaseId,inputEpoch:1,reason:'up'}));
 assert.equal((await enter(a)).status,'accepted');
});

test('exact PR75 controller operates inside the same persistent child space',async()=>{
 const {a,b,w}=await setup();await enter(a);await enter(b);const snapshot=a.getSnapshot(),e=snapshot.spaces.inner.entities.work;
 const acquired=await a.submit(command('grab.begin','inner',{entityId:'work',source:'hand',inputEpoch:1}));
 const c=new GripController({session:await a.open(),acceptedSequence:acquired.acceptedSequence,now:()=>100,idPrefix:'nested.input',submit:x=>a.submit(x),onReconcile:()=>assert.fail('unexpected reconcile')});
 c.begin({entity:e,leaseId:acquired.result.leaseId,source:'hand',inputEpoch:1});const q=[...e.q];q[10]=5;
 c.offer({...e,q},100);await c.end('pinch-open');assert.equal(c.state.phase,'closed');
 assert.equal(w.constraints().length,0);assert.equal(b.getSnapshot().spaces.inner.entities.work.id,e.id);
 assert.equal(w.checkpoint().state.events.find(e=>e.kind==='grab.target').payload.payload.q[10],5);
 checkNoMaterialChange(snapshot,a.getSnapshot());
});

test('failed store write cannot move an Eye or append an accepted navigation event',async()=>{
 class Store extends MemoryAuthorityStore{bad=false;async compareAndSwap(...args){if(this.bad)throw Error('DISK_FULL');return super.compareAndSwap(...args);}}
 const store=new Store();const {w,a}=await setup({store});const before=w.checkpoint();store.bad=true;
 await assert.rejects(enter(a),/DISK_FULL/);assert.deepEqual(w.checkpoint(),before);assert.equal(a.getEye('eye').spaceId,'root');
});

async function disk(t){const dir=await mkdtemp(join(tmpdir(),'vivo-durable-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'private','state.json');}

test('durable accepted nested views and history survive a distinct Node process',async t=>{
 const path=await disk(t),{w,a,b}=await setup({store:new FileAuthorityStore({path})});
 const entry=await enter(a);const v=a.getEye('eye');v.q[10]=8;await a.moveEye('eye',v,v.revision);
 await a.close();await b.close();const before=w.checkpoint();
 const modules={world:pathToFileURL(resolve('services/vivo/web/authority/lease-authority.mjs')).href,
  store:pathToFileURL(resolve('services/vivo/server/authority/file-store.mjs')).href};
 const code=`import {LocalLeaseWorld} from ${JSON.stringify(modules.world)};import {FileAuthorityStore} from ${JSON.stringify(modules.store)};
  const w=await LocalLeaseWorld.create({store:new FileAuthorityStore({path:process.argv[1]})});
  const a=w.attach({actorId:'A'}),b=w.attach({actorId:'B'});await a.open();await b.open();
  console.log(JSON.stringify({snapshot:a.getSnapshot(),a:a.getEye('eye'),b:b.getEye('eye'),record:w.checkpoint()}));`;
 const result=JSON.parse((await run(process.execPath,['--input-type=module','-e',code,path])).stdout);
 assert.equal(result.a.q[10],8);assert.equal(result.a.dimension,11);assert.equal(result.b.spaceId,'root');
 assert.equal(result.a.stack[0].id,entry.result.returnFrameId);assert.deepEqual(result.record,before);
 assert.equal((await stat(path)).mode&0o777,0o600);assert.equal(result.snapshot.simulationTime,12);
 const restored=await LocalLeaseWorld.create({store:new FileAuthorityStore({path})});const resumed=restored.attach({actorId:'A'});await resumed.open();
 const out=await exit(resumed,{result:{eye:resumed.getEye('eye'),returnFrameId:entry.result.returnFrameId}});
 assert.equal(out.status,'accepted');assert.equal(out.result.eye.spaceId,'root');
});

test('restart invalidates live session leases but preserves object identity and nested Eye',async t=>{
 const path=await disk(t),{a}=await setup({store:new FileAuthorityStore({path})});await enter(a);
 await a.submit(command('grab.begin','inner',{entityId:'work',source:'touch',inputEpoch:1}));
 const before=a.getSnapshot(),w2=await LocalLeaseWorld.create({store:new FileAuthorityStore({path})});const resumed=w2.attach({actorId:'A'});await resumed.open();
 assert.equal(w2.constraints().length,0);assert.equal(resumed.inspectLease('inner','work'),null);
 assert.equal(resumed.getEye('eye').spaceId,'inner');checkNoMaterialChange(before,resumed.getSnapshot());
 assert.equal(w2.checkpoint().state.events.at(-1).kind,'restart-release');
});

test('two durable writers cannot acknowledge conflicting revisions',async t=>{
 const path=await disk(t),{a}=await setup({store:new FileAuthorityStore({path})});
 const w2=await LocalLeaseWorld.create({store:new FileAuthorityStore({path})});const other=w2.attach({actorId:'B'});await other.open();
 await a.moveEye('eye',view(),0);await assert.rejects(other.moveEye('eye',view(),0),/STORE_CONFLICT/);
 assert.equal(other.getEye('eye').revision,0);
});

test('a lock held by another process is not stolen or silently considered committed',async t=>{
 const path=await disk(t),store=new FileAuthorityStore({path});const {w,a}=await setup({store});const before=w.checkpoint();
 await mkdir(path+'.lock');await assert.rejects(enter(a),/STORE_BUSY/);assert.deepEqual(w.checkpoint(),before);
 await rmdir(path+'.lock');assert.equal((await enter(a)).status,'accepted');
});

test('durable corruption and symlinked data rejected without overwriting target',async t=>{
 const path=await disk(t),store=new FileAuthorityStore({path});await setup({store});
 const data=JSON.parse(await readFile(path,'utf8'));data.state.snapshot.simulationTime=900;
 await writeFile(path,JSON.stringify(data));await assert.rejects(LocalLeaseWorld.create({store}),/CHECKPOINT_HASH/);
 const link=join(resolve(path,'..'),'link.json');await symlink(path,link);
 await assert.rejects(new FileAuthorityStore({path:link}).load());
 assert.equal(JSON.parse(await readFile(path,'utf8')).state.snapshot.simulationTime,900);
});

test('journal files cannot be stored under the public web tree',()=>{
 assert.throws(()=>new FileAuthorityStore({path:resolve('services/vivo/web/leaked.json')}),/STORE_IN_WEB_ROOT/);
});

test('bounded file budget refuses an oversized checkpoint without altering earlier state',async t=>{
 const path=await disk(t),normal=new FileAuthorityStore({path});const {w}=await setup({store:normal});
 const before=await readFile(path);const tiny=new FileAuthorityStore({path,maxBytes:1024});
 await assert.rejects(tiny.compareAndSwap(w.checkpoint().digest,w.checkpoint()),/STORE_SIZE_OR_TYPE/);
 assert.deepEqual(await readFile(path),before);
});


test('cyclic nested connections are bounded and require LIFO return, not recursive world copies',async()=>{
 const s=seed();s.spaces.deep.entities.loop=entity('loop','deep',2,'root');
 const {a}=await setup({snapshot:s});
 for(let i=0;i<32;i++) {
   const e=a.getEye('eye');const portal={root:'portal',inner:'portal2',deep:'loop'}[e.spaceId];
   assert.equal((await enter(a,e.spaceId,portal)).status,'accepted');
 }
 const before=a.getEye('eye');
 assert.equal((await enter(a,before.spaceId,{root:'portal',inner:'portal2',deep:'loop'}[before.spaceId])).code,'RETURN_DEPTH');
 assert.deepEqual(a.getEye('eye'),before);assert.equal(Object.keys(a.getSnapshot().spaces).length,3);
});

test('complete simulation/observer frames cannot accept time as a fourth coordinate alias',async()=>{
 const {a}=await setup();const before=a.getSnapshot();
 await assert.rejects(a.moveEye('eye',{...view(),q:[0,0,0,'future']},0));
 await assert.rejects(a.moveEye('eye',{...view(),dimension:3},0));
 assert.deepEqual(a.getSnapshot(),before);
});

test('restoring a pre-Eye checkpoint is an explicit recorded migration',async()=>{
 const {w}=await setup();const r=w.checkpoint();delete r.state.eyes;
 const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
 r.digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(r.state)))),b=>b.toString(16).padStart(2,'0')).join('');
 const store=new MemoryAuthorityStore();await store.compareAndSwap(null,r);
 const restored=await LocalLeaseWorld.create({store});assert.equal(restored.checkpoint().state.events.at(-1).kind,'observer-state-initialized');
 assert.deepEqual(restored.checkpoint().state.eyes,{});checkNoMaterialChange(r.state.snapshot,restored.snapshot());
});

test('unsafe/symlinked parent is not a persistent storage target',async t=>{
 const path=await disk(t);const parent=resolve(path,'..');await mkdir(parent,{recursive:true});
 const link=join(resolve(parent,'..'),'redirect');await symlink(parent,link);
 await assert.rejects(new FileAuthorityStore({path:join(link,'state.json')}).load(),/STORE_PARENT_UNSAFE/);
});
