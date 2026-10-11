/** Linux synthetic SQLite integration, not native Windows acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readdir,mkdir,chmod,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {MountedRuntime} from '../../server/application/runtime.mjs';
import {SQLiteAuthorityStore} from '../../server/authority/sqlite-store.mjs';
import {LocalLeaseWorld} from '../../web/authority/lease-authority.mjs';
import {studioCommitCommand} from '../../contracts/studio-binding.mjs';
import {workshopSeed,entryView} from '../../server/application/seed.mjs';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const runtimeURL=new URL('../../server/application/runtime.mjs',import.meta.url).href;
const error=code=>e=>e.code===code;
const command=(kind,payload,id='sqlite.command')=>({schema:'vivo.command/1',id,worldId:'vivo.local.workshop',spaceId:'root',kind,expectedRevision:0,payload});
async function fixture(t,options={}){
 const dir=await mkdtemp(join(tmpdir(),'vivo-sqlite-mount-')),path=join(dir,options.phase?'canonical-phase.sqlite':'canonical-world.sqlite');
 let runtime; t.after(async()=>{try{await runtime?.dispatch({op:'shutdown'});}catch(e){if(e.code!=='RUNTIME_CLOSED')throw e;}finally{await rm(dir,{recursive:true,force:true});}});
 runtime=await MountedRuntime.open({path,store:'sqlite',...options});return{dir,path,runtime};
}
function python(input){
 const source=`import json,sys\nfrom services.vivo.server.application.material_host import initialize_phase\nfrom services.vivo_material import AcceptedMaterialAdapter\nr=json.load(sys.stdin)\nif r['op']=='seed': out=initialize_phase(r['snapshot'])\nelse:\n c=r['capture'];s=c['snapshot'];a=AcceptedMaterialAdapter(lambda:c,world_id=s['worldId'],authority_id=s['authorityId'],space_id='root');out=a.propose(c['checkpoint'],expected_sequence=s['acceptedSequence'],expected_state_hash=s['stateHash'],dt=.02,tick=c['checkpoint']['tick']+1)\nprint(json.dumps(out))`;
 const p=spawnSync('python',['-c',source],{cwd:root,input:JSON.stringify(input),encoding:'utf8',maxBuffer:4*1024*1024});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);
}
function captureInternals(t){
 let world,store;const create=LocalLeaseWorld.create,open=SQLiteAuthorityStore.open;
 t.mock.method(LocalLeaseWorld,'create',async function(options){world=await create.call(this,options);return world;});
 t.mock.method(SQLiteAuthorityStore,'open',async function(options){store=await open.call(this,options);return store;});
 return{get world(){return world;},get store(){return store;}};
}

test('explicit SQLite selection, capacity metadata, separate files and session cleanup precede ownership release',async t=>{
 const internals=captureInternals(t),{runtime,path,dir}=await fixture(t);
 const one=await runtime.dispatch({op:'open',args:{seat:'one'}});
 assert.equal(one.state.capabilities.persistence,'SQLite WAL/FULL exclusive checkpoint');
 assert.equal(one.state.journal.maxCheckpointBytes,64*1024*1024);
 await runtime.dispatch({op:'submit',token:one.token,args:{command:command('grab.begin',{entityId:'relic',source:'touch',inputEpoch:1})}});
 await runtime.dispatch({op:'shutdown'});assert.equal(internals.store.closed,true);
 const store=await SQLiteAuthorityStore.open({path});try{
  const record=await store.load();assert.deepEqual(record.state.leases,{});assert.equal(record.state.events.at(-1).kind,'session-close');
 }finally{await store.close();}
 assert.deepEqual(await readdir(dir),['canonical-world.sqlite']);
});

test('second mounted process fails lifetime ownership before loading or restart-releasing live leases',async t=>{
 const internals=captureInternals(t),{runtime,path}=await fixture(t);
 const one=await runtime.dispatch({op:'open',args:{seat:'one'}});
 await runtime.dispatch({op:'submit',token:one.token,args:{command:command('grab.begin',{entityId:'relic',source:'touch',inputEpoch:1})}});
 const before=internals.world.checkpoint();
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {MountedRuntime} from ${JSON.stringify(runtimeURL)};try{const r=await MountedRuntime.open({path:process.argv[1],store:'sqlite'});await r.dispatch({op:'shutdown'});console.log('UNEXPECTED');}catch(e){console.log(e.code);}`,path],{encoding:'utf8',timeout:10000});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),'STORE_BUSY');
 assert.deepEqual(internals.world.checkpoint(),before);assert.deepEqual(await internals.store.load(),before);
});

test('startup validation failure closes the acquired owner without checkpoint repair',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'vivo-sqlite-invalid-')),path=join(dir,'canonical-world.sqlite');
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=await SQLiteAuthorityStore.open({path});const world=await LocalLeaseWorld.create({snapshot:workshopSeed(),store});
 const record=world.checkpoint();record.state.snapshot.worldId='wrong.workshop';
 await store.compareAndSwap(world.checkpoint().digest,record);await store.close();
 await assert.rejects(MountedRuntime.open({path,store:'sqlite'}),error('WORKSHOP_CHECKPOINT_MISMATCH'));
 const reopened=await SQLiteAuthorityStore.open({path});assert.deepEqual(await reopened.load(),record);await reopened.close();
});

test('fresh SQLite refuses a legacy JSON world and invalid/private/symlink paths without writes',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'vivo-sqlite-path-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'canonical-world.json'),'existing legacy checkpoint',{mode:0o600});
 await assert.rejects(MountedRuntime.open({path:join(dir,'canonical-world.sqlite'),store:'sqlite'}),error('STORE_LEGACY_CHECKPOINT_PRESENT'));
 assert.deepEqual(await readdir(dir),['canonical-world.json']);
 const publicDir=join(dir,'public');await mkdir(publicDir,{mode:0o755});await chmod(publicDir,0o755);
 await assert.rejects(MountedRuntime.open({path:join(publicDir,'canonical-world.sqlite'),store:'sqlite'}),error('STORE_PRIVATE_PATH'));assert.deepEqual(await readdir(publicDir),[]);
 const link=join(dir,'alias');await symlink(publicDir,link);
 await assert.rejects(MountedRuntime.open({path:join(link,'canonical-world.sqlite'),store:'sqlite'}),error('STORE_PRIVATE_PATH'));assert.deepEqual(await readdir(publicDir),[]);
 await assert.rejects(MountedRuntime.open({path:join(dir,'absent','world.sqlite'),store:'sqlite'}));
 await assert.rejects(MountedRuntime.open({path:join(dir,'unsupported'),store:'fallback'}),error('INVALID_RUNTIME_OPTIONS'));
});

test('mounted material guard runs after actual SQLite DML: expiry rolls back fields, history, receipt cursors and observer publication',async t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);const internals=captureInternals(t);
 const {runtime}=await fixture(t,{phase:true,initializeMaterial:snapshot=>python({op:'seed',snapshot})});
 const one=await runtime.dispatch({op:'open',args:{seat:'one'}});
 const observer=internals.world.attach({actorId:'observer.test',role:'viewer'});await observer.open();let observed=0;observer.subscribe(()=>observed++);
 const begun=await runtime.dispatch({op:'submit',token:one.token,args:{command:command('grab.begin',{entityId:'relic',source:'touch',inputEpoch:1},'guard.begin')}});
 const q=one.state.snapshot.spaces.root.entities.relic.q.slice();q[3]=1;
 await runtime.dispatch({op:'submit',token:one.token,args:{command:command('grab.target',{entityId:'relic',leaseId:begun.value.result.leaseId,source:'touch',inputEpoch:1,targetSeq:1,dimension:4,chart:'flat',q,sampleAgeMs:0},'guard.target')}});
 await runtime.dispatch({op:'materialRun',token:one.token,args:{running:true}});
 const capture=await runtime.dispatchMaterial({op:'materialCapture',args:{spaceId:'root'}}),proposal=python({op:'propose',capture});
 const before=internals.world.checkpoint(),bytes=JSON.stringify(before),events=[];observed=0;
 const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
 const p=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){const statement=prepare.call(this,sql);if(sql.startsWith('UPDATE authority_checkpoint')){
  const run=statement.run;statement.run=function(...args){const result=run.apply(this,args);events.push('actual DML');now=4001;return result;};}return statement;});
 const e=t.mock.method(DatabaseSync.prototype,'exec',function(sql){events.push(sql);return exec.call(this,sql);});
 await assert.rejects(runtime.dispatchMaterial({op:'materialApply',args:{proposal}}),error('MATERIAL_STALE_CONSTRAINTS'));
 p.mock.restore();e.mock.restore();
 assert.deepEqual(events,['BEGIN IMMEDIATE','actual DML','ROLLBACK']);
 assert.equal(JSON.stringify(internals.world.checkpoint()),bytes);assert.deepEqual(await internals.store.load(),before);assert.equal(observed,0);
 assert.equal(internals.store.fault,null);assert.equal(runtime.capabilities.journal.fault,null);
 // All accepted fields/q/v, Eyes, receipts, epochs and material lease cursors are
 // covered by the exact full-checkpoint comparison, not only the snapshot.
 await observer.close();
});

test('material-bound Studio commit rejects before canonical mutation',async t=>{
 const internals=captureInternals(t),{runtime}=await fixture(t,{phase:true,initializeMaterial:snapshot=>python({op:'seed',snapshot})});
 await runtime.dispatch({op:'open',args:{seat:'one'}});
 const client=internals.world.attach({actorId:'studio.material-boundary'});await client.open();
 const snapshot=client.getSnapshot(),binding=snapshot.studioBindings['studio.node.echo'],entity=snapshot.spaces.root.entities.relic,before=internals.world.checkpoint();
 const receipt=await client.submit(studioCommitCommand(snapshot,[0,0,0,0],{bindingId:binding.bindingId,metadata:binding.metadata,
   commandId:'studio.material.boundary',expectedBindingRevision:binding.bindingRevision,expectedEntityRevision:entity.revision}));
 assert.equal(receipt.status,'rejected');assert.equal(receipt.code,'STUDIO_MATERIAL_BOUNDARY');
 assert.deepEqual(internals.world.checkpoint(),before);
 await client.close();
});

test('canonical Studio commit survives mounted SQLite shutdown and reopen without changing entity-owned fields',async t=>{
 const internals=captureInternals(t),{runtime,path}=await fixture(t);
 const one=await runtime.dispatch({op:'open',args:{seat:'one'}}),before=one.state.snapshot;
 const binding=before.studioBindings['studio.node.echo'],entity=before.spaces.root.entities.relic;
 const q=[-.8,.2,.4,.1],immutable=value=>({...structuredClone(value),q:null,revision:null});
 const accepted=await runtime.dispatch({op:'submit',token:one.token,args:{command:studioCommitCommand(before,q,{bindingId:binding.bindingId,
   metadata:binding.metadata,commandId:'runtime.sqlite.studio-commit',expectedBindingRevision:binding.bindingRevision,
   expectedEntityRevision:entity.revision})}});
 assert.equal(accepted.value.status,'accepted');
 assert.deepEqual(accepted.state.snapshot.spaces.root.entities.relic.q,q);
 assert.equal(accepted.state.snapshot.spaces.root.entities.relic.revision,entity.revision+1);
 assert.deepEqual(immutable(accepted.state.snapshot.spaces.root.entities.relic),immutable(entity));
 await runtime.dispatch({op:'shutdown'});
 const reopened=await MountedRuntime.open({path,store:'sqlite'});
 try {
  const restored=await reopened.dispatch({op:'open',args:{seat:'one'}}),restoredEntity=restored.state.snapshot.spaces.root.entities.relic;
  assert.deepEqual(restoredEntity.q,q);
  assert.equal(restoredEntity.revision,entity.revision+1);
  assert.deepEqual(immutable(restoredEntity),immutable(entity));
  assert.equal(restored.state.snapshot.studioBindings['studio.node.echo'].bindingRevision,
   binding.bindingRevision+1);
  assert.deepEqual(restored.state.snapshot.studioBindings['studio.node.echo'].q,q);
 } finally { await reopened.dispatch({op:'shutdown'}); }
});

for(const afterCommit of [false,true])test(`mounted COMMIT ${afterCommit?'after':'before'} ambiguity stays unavailable through ready and timer sweeps; restart recovers exact durable outcome`,async t=>{
 const internals=captureInternals(t),{runtime,path}=await fixture(t);
 const one=await runtime.dispatch({op:'open',args:{seat:'one'}}),before=internals.world.checkpoint();
 const exec=DatabaseSync.prototype.exec;let armed=true;
 const mocked=t.mock.method(DatabaseSync.prototype,'exec',function(sql){
  if(armed&&sql==='COMMIT'){armed=false;if(afterCommit)exec.call(this,sql);throw Object.assign(Error('injected uncertain disk outcome'),{errcode:10});}
  return exec.call(this,sql);
 });
 const view=entryView();view.q[3]=.75;
 await assert.rejects(runtime.dispatch({op:'moveEye',token:one.token,args:{view,expectedRevision:0}}),error('STORE_IO_UNCERTAIN'));mocked.mock.restore();
 assert.deepEqual(internals.world.checkpoint(),before);
 for(let i=0;i<3;i++){
  await new Promise(resolve=>setTimeout(resolve,270));const ready=await runtime.dispatch({op:'ready'});
  assert.equal(ready.ok,false);assert.equal(ready.journal.readOnly,true);assert.equal(ready.journal.fault,'STORE_IO_UNCERTAIN');
  await assert.rejects(runtime.dispatch({op:'moveEye',token:one.token,args:{view,expectedRevision:0}}),error('STORE_FAILED_CLOSED'));
  await assert.rejects(runtime.dispatch({op:'open',args:{seat:'two'}}),error('STORE_FAILED_CLOSED'));
 }
 await runtime.dispatch({op:'shutdown'});
 const restarted=await MountedRuntime.open({path,store:'sqlite'});try{
  const restored=await restarted.dispatch({op:'open',args:{seat:'one'}});
  assert.equal(restored.state.eye.q[3],afterCommit?.75:0);assert.equal((await restarted.dispatch({op:'ready'})).ok,true);
 }finally{await restarted.dispatch({op:'shutdown'});}
});


test('CLI exits on FIRST store close failure; a later idempotent close is never treated as ownership release',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'vivo-sqlite-close-')),path=join(dir,'canonical-world.sqlite'),preload=join(dir,'close-fault.mjs');
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(preload,"import {DatabaseSync} from 'node:sqlite'; DatabaseSync.prototype.close=function(){throw Error('injected close failure');};");
 const result=spawnSync(process.execPath,['--import',preload,fileURLToPath(new URL('../../server/application/runtime.mjs',import.meta.url)),path,'--store','sqlite'],
  {input:'{"id":1,"op":"shutdown"}\n',encoding:'utf8',timeout:10000});
 assert.equal(result.status,1,result.stderr);const frames=result.stdout.trim().split('\n').map(JSON.parse);
 assert.equal(frames[0].ready,true);assert.equal(frames[1].ok,false);assert.equal(frames[1].error.code,'STORE_CLOSE_FAILED');
 const reopened=await SQLiteAuthorityStore.open({path});assert.ok(await reopened.load());await reopened.close();
});


test('abrupt mounted owner exit reopens exact saved Eye and appends one restart-release without reseeding history',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'vivo-sqlite-crash-mount-')),path=join(dir,'canonical-world.sqlite');
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const script=`import {MountedRuntime} from ${JSON.stringify(runtimeURL)};
 const runtime=await MountedRuntime.open({path:process.argv[1],store:'sqlite'});
 const one=await runtime.dispatch({op:'open',args:{seat:'one'}});const view=one.state.eye;view.q[3]=.42;
 await runtime.dispatch({op:'moveEye',token:one.token,args:{view,expectedRevision:0}});
 await runtime.dispatch({op:'submit',token:one.token,args:{command:${JSON.stringify(command('grab.begin',{entityId:'relic',source:'touch',inputEpoch:1},'crash.begin'))}}});
 const before=await runtime.dispatch({op:'export',token:one.token});process.stdout.write(JSON.stringify(before.value),()=>process.exit(0));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,path],{encoding:'utf8',timeout:10000});
 assert.equal(child.status,0,child.stderr);const before=JSON.parse(child.stdout),runtime=await MountedRuntime.open({path,store:'sqlite'});
 try{
  const one=await runtime.dispatch({op:'open',args:{seat:'one'}}),after=(await runtime.dispatch({op:'export',token:one.token})).value;
  assert.equal(one.state.eye.q[3],.42);assert.deepEqual(one.state.constraints,[]);
  assert.deepEqual(after.history.events.slice(0,-1),before.history.events);assert.equal(after.history.events.at(-1).kind,'restart-release');
  assert.equal(after.history.retainedEvents,before.history.retainedEvents+1);assert.deepEqual(after.snapshot.spaces,before.snapshot.spaces);
 }finally{await runtime.dispatch({op:'shutdown'});}
});
