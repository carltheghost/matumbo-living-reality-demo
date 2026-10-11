import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {MountedRuntime} from '../../server/application/runtime.mjs';
import {workshopSeed,entryView} from '../../server/application/seed.mjs';

let serial=0;
const command=(kind,payload,spaceId='root',expectedRevision=0,id='test.'+(++serial))=>({
  schema:'vivo.command/1',id,worldId:'vivo.local.workshop',spaceId,kind,expectedRevision,payload});
const submit=(runtime,session,c,extras={})=>runtime.dispatch({op:'submit',token:session.token,args:{command:c},...extras});
const begin=(runtime,session,entityId='relic',source='touch',inputEpoch=1,spaceId='root')=>
  submit(runtime,session,command('grab.begin',{entityId,source,inputEpoch},spaceId));
const target=(lease,q=[1,2,3,4],extra={})=>command('grab.target',{
  entityId:lease.entityId??'relic',leaseId:lease.id??lease.leaseId,source:'touch',inputEpoch:1,
  targetSeq:1,dimension:q.length,chart:'flat',q,sampleAgeMs:0,...extra},lease.spaceId??'root');
const reconcile=(runtime,session,lease,spaceId='root',entityId='relic',inputEpoch=1)=>runtime.dispatch({
  op:'reconcileLease',token:session.token,args:{event:{worldId:'vivo.local.workshop',authorityId:'vivo.local.authority',
    spaceId,entityId,leaseId:lease,inputEpoch}}});
async function pathFor(t) {
  const dir=await mkdtemp(join(tmpdir(),'vivo-mounted-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'private','state.json');
}
async function fixture(t,options={}) {
  let runtime;
  t.after(async()=>{if(runtime)try {await runtime.dispatch({op:'shutdown'});}catch(error){if(error.code!=='RUNTIME_CLOSED')throw error;}});
  const path=await pathFor(t);runtime=await MountedRuntime.open({path,...options});
  const one=await runtime.dispatch({op:'open',args:{seat:'one'}});
  const two=await runtime.dispatch({op:'open',args:{seat:'two'}});
  return {runtime,path,one,two};
}
const state=(r,s)=>r.dispatch({op:'state',token:s.token});

async function pipe(t,path) {
  const child=spawn(process.execPath,[fileURLToPath(new URL('../../server/application/runtime.mjs',import.meta.url)),path],
    {stdio:['pipe','pipe','pipe']});
  let stderr='',closed=false,serial=0;const lines=[],waiters=[];
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const reader=createInterface({input:child.stdout});
  reader.on('line',line=>{const data=JSON.parse(line);const waiting=waiters.shift();waiting?waiting(data):lines.push(data);});
  const next=()=>lines.length?Promise.resolve(lines.shift()):new Promise(resolve=>waiters.push(resolve));
  const exit=once(child,'exit');
  t.after(async()=>{if(!closed){child.kill('SIGKILL');await exit;closed=true;}reader.close();});
  const ready=await next();assert.equal(ready.ready,true);
  return {child,ready,next,stderr:()=>stderr,
    request:async(op,args,token,extra={})=>{const id=++serial;child.stdin.write(JSON.stringify({id,op,...(args?{args}:{}),...(token?{token}:{}),...extra})+'\n');
      const result=await next();assert.equal(result.id,id);return result;},
    stop:async()=>{const id=++serial;child.stdin.write(JSON.stringify({id,op:'shutdown'})+'\n');const response=await next();
      assert.equal(response.id,id);assert.equal(response.ok,true);await exit;closed=true;return response;},
    kill:async()=>{child.kill('SIGKILL');await exit;closed=true;}
  };
}

test('fixed seed is native 4D/11D, stationary and explicitly pending material',()=>{
  const seed=workshopSeed();assert.equal(seed.simulationTime,0);assert.equal(seed.spaces.inner.dimension,11);
  assert.deepEqual(seed.spaces.root.entities.relic.q,[-1.2,-.15,.25,0]);
  assert.deepEqual(Object.keys(seed.spaces.inner.entryView.slice),['x4','x5','x6','x7','x8','x9','x10','x11']);
  for(const space of Object.values(seed.spaces))for(const entity of Object.values(space.entities)) {
    assert.equal(entity.revision,0);assert.ok(entity.v.every(x=>x===0));assert.equal(entity.materialProfile,'unbound');
    assert.deepEqual(entity.fieldMembership,[]);assert.deepEqual(entity.lineage,[]);
  }
});

test('two stable seats contend on one canonical lease without moving material',async t=>{
  const {runtime,one,two,path}=await fixture(t);const snapshot=one.state.snapshot;
  assert.equal(one.session.actorId,'local.one');assert.equal(two.session.actorId,'local.two');
  assert.match(one.token,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(one.token,two.token);
  const results=await Promise.all([begin(runtime,one),begin(runtime,two)]);
  assert.deepEqual(results.map(r=>r.value.status),['accepted','rejected']);
  assert.equal(results[1].value.code,'LEASE_HELD');
  const accepted=await submit(runtime,one,target(results[0].value.result));
  assert.equal(accepted.value.status,'accepted');assert.deepEqual(accepted.state.constraints,[{
    actorId:'local.one',entityId:'relic',spaceId:'root',source:'touch',
    target:{spaceId:'root',chart:'flat',dimension:4,q:[1,2,3,4]}}]);
  assert.deepEqual(accepted.state.snapshot.spaces,snapshot.spaces);assert.equal(accepted.state.snapshot.simulationTime,0);
  assert.deepEqual((await state(runtime,two)).state.snapshot,accepted.state.snapshot);
  assert.equal((await stat(path)).mode&0o777,0o600);
  await assert.rejects(runtime.dispatch({op:'open',args:{seat:'one'}}),/SEAT_BUSY/);
});

test('lease ports bind session, epoch and source and never expose private authority token',async t=>{
  const {runtime,one,two,path}=await fixture(t);const lease=(await begin(runtime,one)).value.result.leaseId;
  const inspected=await runtime.dispatch({op:'inspectLease',token:one.token,args:{spaceId:'root',entityId:'relic'}});
  assert.equal(inspected.value.id,lease);assert.equal(Object.hasOwn(inspected.value,'session'),false);
  assert.equal((await runtime.dispatch({op:'inspectLease',token:two.token,args:{spaceId:'root',entityId:'relic'}})).value,null);
  assert.equal((await submit(runtime,two,target({leaseId:lease}))).value.code,'LEASE_MISMATCH');
  assert.equal((await submit(runtime,one,target({leaseId:lease},[1,2,3,4],{source:'hand'}))).value.code,'SOURCE_MISMATCH');
  assert.equal((await submit(runtime,one,target({leaseId:lease},[1,2,3,4],{inputEpoch:2}))).value.code,'LEASE_MISMATCH');
  await assert.rejects(runtime.dispatch({op:'renewLease',token:two.token,args:{leaseId:lease}}),/LEASE_EXPIRED/);
  await assert.rejects(reconcile(runtime,two,lease),/RECONCILE_OWNER/);
  assert.equal((await runtime.dispatch({op:'renewLease',token:one.token,args:{leaseId:lease}})).value.id,lease);
  const checkpoint=JSON.parse(await readFile(path,'utf8'));
  const privateToken=Object.values(checkpoint.state.leases)[0].session;
  const exported=await runtime.dispatch({op:'export',token:one.token});
  assert.ok(!JSON.stringify(exported).includes(privateToken));
  assert.ok(!Object.hasOwn(exported.value,'receipts'));assert.ok(!Object.hasOwn(exported.value,'epochs'));
  assert.equal((await reconcile(runtime,one,lease)).value.released,true);
  assert.equal((await state(runtime,one)).state.constraints.length,0);
});

test('independent Eyes enter 11D, change x11 and return to saved complete 4D frame',async t=>{
  const {runtime,one,two}=await fixture(t);const original=one.state.snapshot;
  const view=entryView();view.q[3]=5;view.slice.x4=5;
  await runtime.dispatch({op:'moveEye',token:one.token,args:{view,expectedRevision:0}});
  const entered=await submit(runtime,one,command('space.enter',{portalEntityId:'portal',eyeId:'main'}));
  assert.equal(entered.value.status,'accepted');assert.equal(entered.state.eye.dimension,11);
  const inner=entered.state.eye;inner.q[10]=9;inner.slice.x11=9;
  const moved=await runtime.dispatch({op:'moveEye',token:one.token,args:{view:inner,expectedRevision:inner.revision}});
  assert.equal(moved.state.eye.q[10],9);assert.deepEqual((await state(runtime,two)).state.eye,two.state.eye);
  const outsideExport=await runtime.dispatch({op:'export',token:two.token});
  const foreignEyes=outsideExport.value.history.events.filter(e=>e.actorId==='local.one'&&['eye-register','eye-move','space.enter'].includes(e.kind));
  assert.ok(foreignEyes.every(e=>e.payload.redacted==='Private participant Eye'));
  const returned=await submit(runtime,one,command('space.exit',{eyeId:'main',returnFrameId:entered.value.result.returnFrameId},'inner',moved.state.eye.revision));
  assert.equal(returned.value.status,'accepted');assert.deepEqual(returned.state.eye.q,[0,0,0,5]);
  assert.deepEqual(returned.state.eye.slice,{x4:5});assert.equal(returned.state.eye.stack.length,0);
  assert.deepEqual(returned.state.snapshot.spaces,original.spaces);assert.equal(returned.state.snapshot.simulationTime,0);
});

test('resume rotates token and canonical session, releases only own grips, and fences copied tabs',async t=>{
  const {runtime,one,two}=await fixture(t);
  const own=(await begin(runtime,one)).value.result.leaseId;
  const other=(await begin(runtime,two,'workpiece','hand',2)).value.result.leaseId;
  assert.equal((await runtime.dispatch({op:'nextEpoch',token:one.token})).value,1);
  assert.equal((await runtime.dispatch({op:'nextEpoch',token:one.token})).value,2);
  const view=entryView();view.q[3]=4;await runtime.dispatch({op:'moveEye',token:one.token,args:{view,expectedRevision:0}});
  await assert.rejects(runtime.dispatch({op:'open',args:{seat:'two',resumeToken:one.token}}),/SESSION_EXPIRED/);
  const resumed=await runtime.dispatch({op:'open',args:{seat:'one',resumeToken:one.token}});
  assert.notEqual(resumed.token,one.token);assert.equal(resumed.state.eye.q[3],4);
  await assert.rejects(state(runtime,one),/SESSION_EXPIRED/);
  await assert.rejects(runtime.dispatch({op:'open',args:{seat:'one',resumeToken:one.token}}),/SESSION_EXPIRED/);
  assert.equal((await runtime.dispatch({op:'inspectLease',token:resumed.token,args:{spaceId:'root',entityId:'relic'}})).value,null);
  assert.equal((await runtime.dispatch({op:'inspectLease',token:two.token,args:{spaceId:'root',entityId:'workpiece'}})).value.id,other);
  assert.equal((await runtime.dispatch({op:'nextEpoch',token:resumed.token})).value,1);
  assert.equal((await submit(runtime,resumed,target({leaseId:own}))).value.code,'LEASE_EXPIRED');
});

test('malformed operations and arguments reject without accepting actor or changing history',async t=>{
  const {runtime,one}=await fixture(t);const before=(await state(runtime,one)).state.journal.retainedEvents;
  for(const request of [null,[],{op:'state',args:null,token:one.token},{op:'__proto__',token:one.token},
    {op:'inspectLease',token:one.token,args:{spaceId:'root',entityId:'relic',actorId:'local.two'}},
    {op:'open',args:{seat:'three'}},{op:'open',args:{seat:['one']}},{op:'open',args:{seat:{}}},
    {op:'open',args:{seat:'one',resumeToken:'wrong'}},
    {op:'renewLease',token:one.token,args:{leaseId:null}},
    {op:'submit',token:one.token,args:{command:{...command('grab.begin',{entityId:'relic',source:'touch',inputEpoch:1}),actorId:'local.two'}}},
    {op:'moveEye',token:one.token,args:{view:entryView(),expectedRevision:-1}},
    {op:'ready',queueAgeMs:-1},{op:'ready',queueAgeMs:Infinity},
    {op:'state',token:one.token,args:{text:'x'.repeat(70_000)}}]) {
    await assert.rejects(runtime.dispatch(request));
  }
  assert.equal((await state(runtime,one)).state.journal.retainedEvents,before);
  await runtime.dispatch({op:'close',token:one.token});
  await assert.rejects(state(runtime,one),/SESSION_EXPIRED/);
  await assert.rejects(runtime.dispatch({op:'close',token:one.token}),/SESSION_EXPIRED/);
});

test('queue-age freshness rejects old targets without mutating canonical retry bodies',async t=>{
  const {runtime,one}=await fixture(t),lease=(await begin(runtime,one)).value.result;
  const c=target(lease);const before=(await state(runtime,one)).state.journal.retainedEvents;
  await assert.rejects(submit(runtime,one,c,{queueAgeMs:151}),/TARGET_STALE/);
  assert.equal((await state(runtime,one)).state.journal.retainedEvents,before);
  const fresh=await submit(runtime,one,c,{queueAgeMs:0});assert.equal(fresh.value.status,'accepted');
  const retry=await submit(runtime,one,c,{queueAgeMs:1});assert.deepEqual(retry.value,fresh.value);
  const second=target(lease,[0,0,0,5],{targetSeq:2});
  await assert.rejects(runtime.dispatch({op:'submit',token:one.token,args:{command:second}},performance.now()-151),/TARGET_STALE/);
});

test('30-second inactive sessions close and release their leases; active reads renew activity',async t=>{
  t.mock.timers.enable({apis:['Date','setInterval'],now:Date.now()});
  const {runtime,one,two,path}=await fixture(t);await begin(runtime,one);
  t.mock.timers.tick(29_000);await state(runtime,two);
  t.mock.timers.tick(1_001);await assert.rejects(state(runtime,one),/SESSION_EXPIRED/);
  assert.equal((await state(runtime,two)).state.participants.find(p=>p.seat==='one').online,false);
  const saved=JSON.parse(await readFile(path,'utf8'));assert.deepEqual(saved.state.leases,{});
  assert.ok(saved.state.events.some(e=>e.kind==='session-close'&&e.actorId==='local.one'));
  const reopened=await runtime.dispatch({op:'open',args:{seat:'one'}});assert.notEqual(reopened.token,one.token);
});

test('event backpressure is serialized; cleanup remains possible and history is never truncated',async t=>{
  const {runtime,one,two,path}=await fixture(t,{maxEvents:24});const leases=[];
  for(const [s,spaceId,entityId] of [[one,'root','relic'],[one,'root','portal'],[two,'root','workpiece'],[two,'inner','relic']]) {
    const value=(await begin(runtime,s,entityId,'touch',1,spaceId)).value;assert.equal(value.status,'accepted');
    leases.push({s,spaceId,entityId,id:value.result.leaseId});
  }
  let current=await state(runtime,one);
  while(current.state.journal.remainingEvents>1) {
    current=await runtime.dispatch({op:'renewLease',token:one.token,args:{leaseId:leases[0].id}});
  }
  const racing=await Promise.allSettled(Array.from({length:8},()=>runtime.dispatch({op:'renewLease',token:one.token,args:{leaseId:leases[0].id}})));
  assert.equal(racing.filter(x=>x.status==='fulfilled').length,1);
  assert.ok(racing.filter(x=>x.status==='rejected').every(x=>x.reason.code==='JOURNAL_BACKPRESSURE'));
  const boundary=(await state(runtime,one)).state.journal;
  assert.equal(boundary.retainedEvents,14);assert.equal(boundary.reserve,10);assert.equal(boundary.backpressure,true);
  await assert.rejects(runtime.dispatch({op:'moveEye',token:one.token,args:{view:entryView(),expectedRevision:0}}),/JOURNAL_BACKPRESSURE/);
  await assert.rejects(runtime.dispatch({op:'open',args:{seat:'one',resumeToken:one.token}}),/JOURNAL_BACKPRESSURE/);
  await assert.rejects(submit(runtime,one,target(leases[0])),/JOURNAL_BACKPRESSURE/);
  const prefix=(await runtime.dispatch({op:'export',token:one.token})).value.history.events;
  await submit(runtime,one,command('grab.end',{entityId:'relic',leaseId:leases[0].id,inputEpoch:1,reason:'up'}));
  for(const l of leases.slice(1))assert.equal((await reconcile(runtime,l.s,l.id,l.spaceId,l.entityId)).value.released,true);
  await runtime.dispatch({op:'close',token:one.token});await runtime.dispatch({op:'close',token:two.token});
  await runtime.dispatch({op:'shutdown'});
  const record=JSON.parse(await readFile(path,'utf8'));assert.equal(record.state.events.length,20);assert.deepEqual(record.state.leases,{});
  const restarted=await MountedRuntime.open({path,maxEvents:24});
  try {
    assert.equal((await restarted.dispatch({op:'ready'})).journal.retainedEvents,20);
    await assert.rejects(restarted.dispatch({op:'open',args:{seat:'one'}}),/JOURNAL_BACKPRESSURE/);
    for(let i=0;i<3;i++) {
      const ro=await restarted.dispatch({op:'open',args:{seat:'one',readOnly:true}});assert.equal(ro.session.readOnly,true);
      const exported=await restarted.dispatch({op:'export',token:ro.token});
      assert.deepEqual(exported.value.history.events.slice(0,prefix.length),prefix);
      assert.equal(exported.value.history.retainedEvents,20);
      await assert.rejects(begin(restarted,ro),/READ_ONLY_SESSION/);
      await restarted.dispatch({op:'close',token:ro.token});
    }
    assert.equal((await restarted.dispatch({op:'ready'})).journal.retainedEvents,20);
  } finally {await restarted.dispatch({op:'shutdown'});}
});

test('real subprocess protocol persists Eyes, rejects old tokens, and crash-releases leases',async t=>{
  const path=await pathFor(t),a=await pipe(t,path);assert.equal(a.ready.capabilities.persistence,'POSIX atomic checkpoint');
  const opened=await a.request('open',{seat:'one'});assert.equal(opened.ok,true);const token=opened.result.token;
  const entered=await a.request('submit',{command:command('space.enter',{portalEntityId:'portal',eyeId:'main'})},token);
  const view=entered.result.state.eye;view.q[10]=7;view.slice.x11=7;
  assert.equal((await a.request('moveEye',{view,expectedRevision:view.revision},token)).ok,true);
  assert.equal((await a.request('submit',{command:command('grab.begin',{entityId:'relic',source:'hand',inputEpoch:1},'inner')},token)).result.value.status,'accepted');
  const before=JSON.parse(await readFile(path,'utf8'));await a.kill();
  const b=await pipe(t,path);assert.equal((await b.request('state',{},token)).error.code,'SESSION_EXPIRED');
  assert.equal((await b.request('open',{seat:'one',resumeToken:token})).error.code,'SESSION_EXPIRED');
  const resumed=(await b.request('open',{seat:'one'})).result;assert.equal(resumed.state.eye.q[10],7);
  assert.equal(resumed.state.eye.spaceId,'inner');assert.deepEqual(resumed.state.constraints,[]);
  const persisted=(await b.request('export',{},resumed.token)).result.value.history;
  assert.equal(persisted.events.at(-1).kind,'restart-release');
  assert.equal(persisted.retainedEvents,before.state.events.length+1);
  assert.deepEqual(persisted.events.slice(0,-1),before.state.events.map(e=>({sequence:e.sequence,kind:e.kind,actorId:e.actorId,stateHash:e.stateHash,payload:e.payload})));
  const back=await b.request('submit',{command:command('space.exit',{eyeId:'main',returnFrameId:entered.result.value.result.returnFrameId},'inner',resumed.state.eye.revision)},resumed.token);
  assert.equal(back.result.value.status,'accepted');assert.equal(back.result.state.eye.spaceId,'root');
  await b.stop();assert.equal(a.stderr(),'');assert.equal(b.stderr(),'');
});

test('CLI rejects malformed and oversized lines, recovers on next frame, and shuts down after response',async t=>{
  const p=await pipe(t,await pathFor(t));
  p.child.stdin.write('{not json}\n');assert.equal((await p.next()).ok,false);
  p.child.stdin.write('x'.repeat(70_000)+'\n');assert.equal((await p.next()).error.code,'REQUEST_TOO_LARGE');
  assert.equal((await p.request('unknown')).error.code,'UNKNOWN_OPERATION');
  assert.equal((await p.request('ready')).result.ok,true);
  assert.equal((await p.request('ready',{},undefined,{queueAgeMs:-1})).error.code,'INVALID_ARGUMENT');
  const one=(await p.request('open',{seat:'one'})).result;await p.stop();
  assert.equal(p.stderr(),'');
});


test('abrupt exit at the exact write threshold leaves reserved restart-release capacity',async t=>{
  const path=await pathFor(t);
  const moduleURL=new URL('../../server/application/runtime.mjs',import.meta.url).href;
  const code=`import {MountedRuntime} from ${JSON.stringify(moduleURL)};
    const runtime=await MountedRuntime.open({path:process.argv[1],maxEvents:18});
    const one=await runtime.dispatch({op:'open',args:{seat:'one'}});
    const two=await runtime.dispatch({op:'open',args:{seat:'two'}});
    let id=0,lease;
    for(const [token,spaceId,entityId] of [[one.token,'root','relic'],[one.token,'root','portal'],[two.token,'root','workpiece'],[two.token,'inner','relic']]) {
      const result=await runtime.dispatch({op:'submit',token,args:{command:{schema:'vivo.command/1',id:'crash.'+(++id),
        worldId:'vivo.local.workshop',spaceId,kind:'grab.begin',expectedRevision:0,payload:{entityId,source:'touch',inputEpoch:1}}}});
      if(entityId==='relic'&&spaceId==='root')lease=result.value.result.leaseId;
    }
    await runtime.dispatch({op:'renewLease',token:one.token,args:{leaseId:lease}});
    await runtime.dispatch({op:'renewLease',token:one.token,args:{leaseId:lease}});
    const before=await runtime.dispatch({op:'export',token:one.token});
    process.stdout.write(JSON.stringify(before.value.history),()=>process.exit(0));`;
  const executed=await promisify(execFile)(process.execPath,['--input-type=module','-e',code,path]);
  const before=JSON.parse(executed.stdout);assert.equal(before.retainedEvents,8);assert.equal(before.backpressure,true);
  const recordBefore=JSON.parse(await readFile(path,'utf8'));assert.equal(Object.keys(recordBefore.state.leases).length,4);
  const runtime=await MountedRuntime.open({path,maxEvents:18});
  try {
    const ready=await runtime.dispatch({op:'ready'});assert.equal(ready.journal.retainedEvents,9);
    assert.equal(ready.journal.backpressure,true);
    const readOnly=await runtime.dispatch({op:'open',args:{seat:'one',readOnly:true}});
    const exported=(await runtime.dispatch({op:'export',token:readOnly.token})).value;
    assert.deepEqual(exported.history.events.slice(0,-1),before.events);
    assert.equal(exported.history.events.at(-1).kind,'restart-release');
    assert.equal(Object.keys(JSON.parse(await readFile(path,'utf8')).state.leases).length,0);
    await runtime.dispatch({op:'close',token:readOnly.token});
    assert.equal((await runtime.dispatch({op:'ready'})).journal.retainedEvents,9);
  } finally {await runtime.dispatch({op:'shutdown'});}
});

test('failed checkpoint commit is rejected without changing accepted state and can safely retry',async t=>{
  const {runtime,one,path}=await fixture(t);
  const before=await readFile(path,'utf8');const c=command('grab.begin',{entityId:'relic',source:'touch',inputEpoch:1});
  await mkdir(path+'.lock');
  try {
    await assert.rejects(submit(runtime,one,c),/STORE_BUSY/);
    assert.equal(await readFile(path,'utf8'),before);
    assert.equal((await runtime.dispatch({op:'inspectLease',token:one.token,args:{spaceId:'root',entityId:'relic'}})).value,null);
  } finally {await rm(path+'.lock',{recursive:true});}
  assert.equal((await submit(runtime,one,c)).value.status,'accepted');
});
