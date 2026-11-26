import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskContinuity,IndexedDbTaskStore} from '../task-continuity.mjs';
const SCHEMA='vivo.agent-task-journal/1';
const clone=structuredClone;
function makeStore(){const values=new Map();let tail=Promise.resolve(),failNext=false,gate=null;return {values,fail(){failNext=true;},hold(){let release,enter;const wait=new Promise(r=>release=r);release.entered=new Promise(r=>enter=r);gate={wait,enter};return release;},transact(key,update){const pending=gate;gate=null;pending?.enter();const wait=pending?.wait;const result=tail.then(async()=>{await wait;if(failNext){failNext=false;throw Error('storage failed');}const value=clone(values.get(key)||{schema:SCHEMA,key,tasks:[]});const out=update(value);values.set(key,value);return clone(out);});tail=result.catch(()=>{});return result;}};}
function fixture(){let serial=0,env={branchId:'main',snapshot:{worldId:'world',localOperationResults:[]}},calls=0,mode='accept',hold=null;const store=makeStore(),sessions=new Map([['a',{sourceId:'muse',sessionId:'a',generation:1}],['b',{sourceId:'codex',sessionId:'b',generation:1}]]);
const active=s=>{const a=sessions.get(typeof s==='string'?s:s?.sessionId);if(!a||(typeof s==='object'&&s.generation!==a.generation))throw Error('STALE_NATIVE_SESSION');return clone(a);};
const fp=x=>JSON.stringify({worldId:x.worldId,branchId:x.branchId,eyeId:x.eyeId,spaceId:x.spaceId,entityId:x.entityId,baseRevision:x.baseRevision,delta:x.delta,geometry:x.geometry??null});
const receipt=(a,fingerprint=fp(a))=>({operationId:a.operationId,fingerprint,result:{revision:1,changed:true}});
const registry={agentController:{assertActive:active},agents:()=>[...sessions.values()].map(a=>({status:'active',activeOperations:0,activeContacts:0,...clone(a)}))};
const downstream={listFor:s=>{active(s);return [{name:'vivo.world.edit'},{name:'neural.predict'},...(s?.sessionId&&sessions.get(s.sessionId)?.allowRead===true?[{name:'vivo.world.read'}]:[])];},invokeFor:async(s,name,a)=>{active(s);calls++;if(name!=='vivo.world.edit')return {name};if(mode==='throw')throw Error('response lost');if(mode==='hold'){await hold;}if(mode!=='missing')env.snapshot.localOperationResults.push(receipt(a));return {status:'accepted'};}};
const validateEdit=(a,e)=>{if(a.worldId!==e.snapshot.worldId||a.branchId!==e.branchId)throw Error('scope mismatch');return {...a,prior:e.snapshot.localOperationResults.find(r=>r.operationId===a.operationId)||null};};
const build=()=>createTaskContinuity({registry,downstream,validateEdit,getEnvelope:()=>env,store,newId:()=>'task-'+(++serial)});
const f={store,sessions,build,bridge:build(),calls:()=>calls,mode:x=>{mode=x;},branch:x=>{env={branchId:x,snapshot:{worldId:'world',localOperationResults:[]}};},receipt:(a,x)=>env.snapshot.localOperationResults.push(receipt(a,x)),hold(){let resolve;hold=new Promise(r=>resolve=r);mode='hold';return resolve;}};return f;}
const edit=(op='op1',branchId='main')=>({worldId:'world',branchId,eyeId:'eye',spaceId:'room',entityId:'object',baseRevision:0,operationId:op,delta:[1,0,0],geometry:null});
const run=(f,op='op1',who='a')=>f.bridge.tools.invokeFor(who,'vivo.world.edit',edit(op));
const progress=(f,who='a')=>f.bridge.tools.invokeFor(who,'task.progress');
const attach=f=>f.bridge.admin.create('a','Move an object');
const inspect=async f=>(await f.bridge.admin.inspect()).tasks;
const tick=()=>new Promise(setImmediate);

test('no task tool or journal is created by default, native tools remain unchanged',async()=>{const f=fixture();assert.deepEqual(f.bridge.tools.listFor('a').map(x=>x.name),['vivo.world.edit','neural.predict']);await assert.rejects(progress(f),{code:'TASK_NOT_ATTACHED'});await run(f);assert.equal(f.calls(),1);assert.equal((await inspect(f)).length,0);});
test('owner attachment grants read-only task progress to the exact active session',async()=>{const f=fixture();await attach(f);assert.equal((await progress(f)).authorizesAction,false);await assert.rejects(progress(f,'b'),{code:'TASK_NOT_ATTACHED'});await assert.rejects(f.bridge.tools.invokeFor('a','task.progress',{sourceId:'b'}),{code:'TASK_ARGUMENTS_INVALID'});});
test('write-ahead fingerprint, native receipt and duplicate protection',async()=>{const f=fixture();await attach(f);assert.deepEqual(await run(f),{status:'accepted'});const step=(await progress(f)).task.steps[0];assert.equal(step.state,'confirmed');assert.equal(step.revision,1);assert.match(step.sha256,/^[a-f0-9]{64}$/);assert.ok(!('delta' in step));await assert.rejects(run(f),{code:'TASK_OPERATION_ALREADY_RECORDED'});assert.equal(f.calls(),1);});
test('reload restores evidence only; owner must resume a fresh generation',async()=>{const f=fixture(),a=await attach(f);await run(f);f.bridge=f.build();await assert.rejects(progress(f),{code:'TASK_NOT_ATTACHED'});f.sessions.set('a',{sourceId:'muse',sessionId:'a',generation:2});await assert.rejects(f.bridge.admin.resume('b',a.taskId),{code:'TASK_SOURCE_MISMATCH'});await f.bridge.admin.resume('a',a.taskId);assert.equal((await progress(f)).task.steps[0].state,'confirmed');assert.equal(f.calls(),1);});
test('missing receipt after native failure remains unresolved; no automatic replay',async()=>{const f=fixture();await attach(f);f.mode('throw');await assert.rejects(run(f),/response lost/);assert.equal((await progress(f)).task.steps[0].state,'pending');await assert.rejects(run(f,'new-op'),{code:'TASK_RECONCILIATION_REQUIRED'});await f.bridge.admin.reconcile();assert.equal(f.calls(),1);f.receipt(edit());await f.bridge.admin.reconcile();assert.equal((await progress(f)).task.steps[0].state,'confirmed');});
test('receipt with a conflicting fingerprint never confirms a task step',async()=>{const f=fixture();await attach(f);f.mode('missing');await run(f);f.receipt(edit(),'different');await f.bridge.admin.reconcile();assert.equal((await progress(f)).task.steps[0].state,'conflict');await assert.rejects(run(f,'new-op'),{code:'TASK_RECONCILIATION_REQUIRED'});});
test('preexisting native receipt cannot be claimed as a new task step',async()=>{const f=fixture();await run(f);await attach(f);await assert.rejects(run(f),{code:'TASK_OPERATION_ALREADY_RECORDED'});assert.equal((await progress(f)).task.steps.length,0);});
test('storage failure before dispatch blocks the journaled edit',async()=>{const f=fixture();await attach(f);f.store.fail();await assert.rejects(run(f),/storage failed/);assert.equal(f.calls(),0);});
test('storage failure after dispatch does not disguise the native response as a failure',async()=>{const f=fixture();await attach(f);const release=f.hold(),pending=run(f);while(!f.calls())await tick();f.store.fail();release();assert.deepEqual(await pending,{status:'accepted'});assert.match((await f.bridge.admin.inspect()).warning,/could not be refreshed/);await f.bridge.admin.reconcile();assert.equal((await progress(f)).task.steps[0].state,'confirmed');});
test('scope switch revokes attachments and isolates persisted branches',async()=>{const f=fixture();await attach(f);await run(f);f.branch('fork');f.bridge.syncScope();assert.equal((await inspect(f)).length,0);await assert.rejects(progress(f));f.branch('main');f.bridge.syncScope();assert.equal((await inspect(f)).length,1);await assert.rejects(progress(f));});
test('another tab attachment fences old journal claims without affecting native authority',async()=>{const f=fixture(),a=await attach(f);const other=f.build();await other.admin.resume('a',a.taskId);await assert.rejects(progress(f),{code:'TASK_ATTACHMENT_STALE'});await assert.rejects(run(f),{code:'TASK_ATTACHMENT_STALE'});assert.equal(f.calls(),0);assert.equal((await other.tools.invokeFor('a','task.progress')).task.epoch,2);});
test('pause during pending attach cannot silently activate a session',async()=>{const f=fixture();const release=f.store.hold();const pending=attach(f);f.bridge.admin.pause('a');release();await assert.rejects(pending,{code:'TASK_ATTACHMENT_STALE'});await assert.rejects(progress(f),{code:'TASK_NOT_ATTACHED'});assert.equal((await inspect(f)).length,1);});
test('pause after reservation prevents dispatch and records a known non-dispatch',async()=>{const f=fixture();await attach(f);const release=f.store.hold();const pending=run(f);await release.entered;f.bridge.admin.pause('a');release();await assert.rejects(pending);assert.equal(f.calls(),0);const step=(await inspect(f))[0].steps[0];assert.equal(step?.state,'not-dispatched');});
test('finishing retains unresolved evidence and cannot be reopened',async()=>{const f=fixture(),a=await attach(f);f.mode('missing');await run(f);await f.bridge.admin.finish('a');assert.equal((await inspect(f))[0].closed,true);assert.equal((await inspect(f))[0].steps[0].state,'pending');await assert.rejects(f.bridge.admin.resume('a',a.taskId));});
test('corrupted storage and unavailable IndexedDB fail closed',async()=>{const f=fixture();f.store.values.set(JSON.stringify(['world','main']),{schema:'unknown',tasks:[]});await assert.rejects(attach(f),{code:'TASK_STORAGE_INVALID'});await assert.rejects(new IndexedDbTaskStore(null).transact('x',()=>{}),{code:'TASK_STORAGE_UNAVAILABLE'});});

const transfer=(f,task,to='b')=>f.bridge.admin.handoff(to,task.id,{sourceId:task.sourceId,epoch:task.epoch});
test('explicit handoff preserves the mission and attributes each native receipt to its actual source',async()=>{
  const f=fixture();await attach(f);await run(f);const old=(await progress(f)).task;
  assert.equal(f.bridge.tools.listFor('b').some(t=>t.name==='task.progress'),false);
  await transfer(f,old);await assert.rejects(progress(f),{code:'TASK_ATTACHMENT_STALE'});
  await assert.rejects(run(f,'old-source-new-edit'),{code:'TASK_ATTACHMENT_STALE'});assert.equal(f.calls(),1);
  const next=(await progress(f,'b')).task;assert.equal(next.id,old.id);assert.equal(next.epoch,old.epoch+1);
  assert.deepEqual(next.handoffs,[{from:'muse',to:'codex',epoch:next.epoch}]);assert.equal(next.steps[0].sourceId,'muse');
  await assert.rejects(run(f,'op1','b'),{code:'TASK_OPERATION_ALREADY_RECORDED'});await run(f,'op2','b');
  assert.deepEqual((await progress(f,'b')).task.steps.map(s=>[s.sourceId,s.state]),[['muse','confirmed'],['codex','confirmed']]);assert.equal(f.calls(),2);
});
test('handoff requires a reviewed source and epoch; stale or competing transfers cannot win',async()=>{
  const f=fixture();await attach(f);const task=(await progress(f)).task;const other=f.build();
  await assert.rejects(f.bridge.admin.handoff('b',task.id,{}),{code:'TASK_HANDOFF_EXPECTATION_REQUIRED'});
  await assert.rejects(transfer(f,task,'a'),{code:'TASK_HANDOFF_SAME_SOURCE'});
  const results=await Promise.allSettled([transfer(f,task),other.admin.handoff('b',task.id,{sourceId:task.sourceId,epoch:task.epoch})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'TASK_HANDOFF_STALE');
  assert.equal((await inspect(f))[0].handoffs.length,1);
});
test('pending or conflicting receipts block handoff; matching native evidence unlocks only pending work',async()=>{
  const f=fixture();await attach(f);f.mode('missing');await run(f);let task=(await progress(f)).task;
  await assert.rejects(transfer(f,task),{code:'TASK_RECONCILIATION_REQUIRED'});f.receipt(edit());await f.bridge.admin.reconcile();
  task=(await progress(f)).task;await transfer(f,task);assert.equal((await progress(f,'b')).task.sourceId,'codex');
  await run(f,'op2','b');f.receipt(edit('op2'),'wrong');await f.bridge.admin.reconcile();
  await assert.rejects(transfer(f,(await progress(f,'b')).task,'a'),{code:'TASK_RECONCILIATION_REQUIRED'});
});
test('the same pending object is reserved across tasks and tabs, but a different object remains available',async()=>{
  const f=fixture();await attach(f);const other=f.build();await other.admin.create('b','Independent task');
  const release=f.hold(),pending=run(f);while(!f.calls())await tick();
  try{
    await assert.rejects(other.tools.invokeFor('b','vivo.world.edit',edit('op2')),{code:'TASK_OBJECT_RESERVED'});assert.equal(f.calls(),1);
    const separate=other.tools.invokeFor('b','vivo.world.edit',{...edit('op3'),entityId:'other'});while(f.calls()<2)await tick();release();await Promise.all([pending,separate]);
    await other.tools.invokeFor('b','vivo.world.edit',edit('op4'));assert.equal(f.calls(),3);
  }finally{release();await pending.catch(()=>{});}
});
test('unresolved evidence remains reserved even when its task is closed',async()=>{
  const f=fixture();await attach(f);f.mode('missing');await run(f);await f.bridge.admin.finish('a');await f.bridge.admin.create('b','Other task');
  await assert.rejects(run(f,'op2','b'),{code:'TASK_OBJECT_RESERVED'});assert.equal(f.calls(),1);
});
test('legacy v1 history is attributed before transfer without rewriting operation digests',async()=>{
  const f=fixture();await attach(f);await run(f);const key=JSON.stringify(['world','main']),legacy=f.store.values.get(key).tasks[0];
  const oldDigest=legacy.steps[0].sha256;delete legacy.steps[0].sourceId;delete legacy.steps[0].spaceId;
  await transfer(f,legacy);const task=(await progress(f,'b')).task;assert.equal(task.steps[0].sourceId,'muse');assert.equal(task.steps[0].sha256,oldDigest);
});
test('handoff survives reload without restoring authority or allowing a previous source to resume',async()=>{
  const f=fixture();await attach(f);await run(f);const task=(await progress(f)).task;await transfer(f,task);
  f.bridge=f.build();await assert.rejects(progress(f,'b'),{code:'TASK_NOT_ATTACHED'});
  await assert.rejects(f.bridge.admin.resume('a',task.id),{code:'TASK_SOURCE_MISMATCH'});
  await f.bridge.admin.resume('b',task.id);const restored=(await progress(f,'b')).task;assert.equal(restored.handoffs.length,1);assert.equal(restored.steps[0].sourceId,'muse');assert.equal(f.calls(),1);
});
test('handoff never appears in model tools and corrupted source history fails closed',async()=>{
  const f=fixture();await attach(f);await transfer(f,(await progress(f)).task);assert.ok(!f.bridge.tools.listFor('b').some(t=>t.name.includes('handoff')));
  const key=JSON.stringify(['world','main']);f.store.values.get(key).tasks[0].handoffs[0].to='invented';
  await assert.rejects(progress(f,'b'),{code:'TASK_STORAGE_INVALID'});
});
test('a rejected handoff preserves the recipient’s existing task attachment',async()=>{
  const f=fixture();await attach(f);const original=(await progress(f)).task;
  const recipient=await f.bridge.admin.create('b','Recipient task');f.mode('missing');await run(f);
  await assert.rejects(transfer(f,original),{code:'TASK_RECONCILIATION_REQUIRED'});
  assert.equal((await progress(f,'b')).task.id,recipient.taskId);
});

const complete=(f,agent,task)=>f.bridge.admin.complete(agent,{taskId:task.id,epoch:task.epoch});
test('dependent task cannot dispatch until the owner completes its prerequisite with receipts',async()=>{
  const f=fixture(),a=await attach(f);await f.bridge.admin.create('b','Next step',[a.taskId]);
  let p=await progress(f,'b');assert.equal(p.mission.state,'blocked');assert.equal(p.mission.dependencies[0].status,'waiting');
  await assert.rejects(run(f,'op2','b'),{code:'TASK_PREREQUISITES_INCOMPLETE'});assert.equal(f.calls(),0);assert.equal((await progress(f,'b')).task.steps.length,0);
  await run(f);await assert.rejects(run(f,'op2','b'),{code:'TASK_PREREQUISITES_INCOMPLETE'});
  await complete(f,'a',(await progress(f)).task);p=await progress(f,'b');assert.equal(p.mission.state,'ready');
  assert.deepEqual(p.mission.dependencies[0].receipts.map(s=>[s.sourceId,s.operationId]),[['muse','op1']]);
  assert.equal(p.mission.authorizesAction,false);assert.equal(f.calls(),1);await run(f,'op2','b');
  const result=await complete(f,'b',(await progress(f,'b')).task);assert.equal(result.completed,true);assert.equal(result.closed,true);assert.equal(f.calls(),2);
});
test('archiving a prerequisite with confirmed receipts does not unlock its dependents',async()=>{
  const f=fixture(),a=await attach(f);await f.bridge.admin.create('b','Next step',[a.taskId]);await run(f);await f.bridge.admin.finish('a');
  const p=await progress(f,'b');assert.equal(p.mission.dependencies[0].status,'closed-incomplete');assert.equal(p.mission.dependencies[0].receipts.length,0);
  await assert.rejects(run(f,'op2','b'),{code:'TASK_PREREQUISITES_INCOMPLETE'});
});
test('completion requires the reviewed task and epoch plus confirmed, reconciled work',async()=>{
  const f=fixture();await attach(f);let t=(await progress(f)).task;
  await assert.rejects(f.bridge.admin.complete('a',{taskId:'wrong',epoch:t.epoch}),{code:'TASK_COMPLETION_EXPECTATION_REQUIRED'});
  await assert.rejects(complete(f,'a',t),{code:'TASK_EVIDENCE_REQUIRED'});
  f.mode('missing');await run(f);t=(await progress(f)).task;await assert.rejects(complete(f,'a',t),{code:'TASK_RECONCILIATION_REQUIRED'});
  f.receipt(edit());await f.bridge.admin.reconcile();await complete(f,'a',t);
  await assert.rejects(f.bridge.admin.resume('a',t.id),{code:'TASK_SOURCE_MISMATCH'});
});
test('handoff and reconnect cannot bypass prerequisites or recreate a completed grant',async()=>{
  const f=fixture(),a=await attach(f);f.sessions.set('c',{sourceId:'dot',sessionId:'c',generation:1});
  await f.bridge.admin.create('b','Blocked task',[a.taskId]);const old=(await progress(f,'b')).task;
  await transfer(f,old,'c');await assert.rejects(run(f,'op2','c'),{code:'TASK_PREREQUISITES_INCOMPLETE'});
  await run(f);await complete(f,'a',(await progress(f)).task);
  f.bridge=f.build();await assert.rejects(progress(f,'c'),{code:'TASK_NOT_ATTACHED'});await f.bridge.admin.resume('c',old.id);
  assert.equal((await progress(f,'c')).mission.readyForJournaledEdits,true);await run(f,'op2','c');assert.equal(f.calls(),2);
});
test('legacy journal migration preserves old receipts but never assumes owner completion',async()=>{
  const f=fixture(),key=JSON.stringify(['world','main']);
  const old={id:'old',sourceId:'muse',title:'Old archived task',epoch:2,closed:true,steps:[{operationId:'old-op',entityId:'object',sha256:'a'.repeat(64),state:'confirmed',revision:3,changed:true}]};
  f.store.values.set(key,{schema:SCHEMA,key,tasks:[clone(old)]});const rows=await inspect(f);
  assert.deepEqual(rows,[old]);assert.equal(f.store.values.get(key).schema,'vivo.agent-task-journal/2');
  await f.bridge.admin.create('b','Depends on old',['old']);assert.equal((await progress(f,'b')).mission.state,'blocked');
});
test('concurrent completion is exclusive and cannot grant a new session',async()=>{
  const f=fixture();await attach(f);await run(f);const t=(await progress(f)).task;
  const result=await Promise.allSettled([complete(f,'a',t),complete(f,'a',t)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await inspect(f))[0].completed,true);assert.equal(f.calls(),1);await assert.rejects(progress(f),{code:'TASK_NOT_ATTACHED'});
});
test('task prerequisite inputs are copied before storage and must refer to existing local tasks',async()=>{
  const f=fixture(),a=await attach(f);const deps=[a.taskId],release=f.store.hold(),work=f.bridge.admin.create('b','Copied',deps);deps.push('missing');release();await work;
  assert.deepEqual((await progress(f,'b')).task.dependsOn,[a.taskId]);
  await assert.rejects(f.bridge.admin.create('b','Invalid',['missing']),{code:'TASK_DEPENDENCIES_INVALID'});
  await assert.rejects(f.bridge.admin.create('b','Invalid',[a.taskId,a.taskId]),{code:'TASK_DEPENDENCIES_INVALID'});
});
test('an attached agent sees only the explicit direct prerequisite evidence, not unrelated task records',async()=>{
  const f=fixture(),a=await attach(f);await run(f);await complete(f,'a',(await progress(f)).task);
  await f.bridge.admin.create('a','Private unrelated task');await run(f,'private-op');await complete(f,'a',(await progress(f)).task);
  await f.bridge.admin.create('b','Dependent',[a.taskId]);const p=await progress(f,'b');assert.equal(p.mission.dependencies.length,1);
  assert.equal(p.mission.dependencies[0].receipts[0].operationId,'op1');assert(!JSON.stringify(p).includes('private-op'));assert(!f.bridge.tools.listFor('b').some(t=>t.name.includes('complete')));
});

const eligible=(f,sid)=>{const a=f.sessions.get(sid);f.sessions.set(sid,{...a,allowRead:true});};
test('orchestrator recommends without attaching or executing and approval reuses the existing task',async()=>{
  const f=fixture(),a=await attach(f);eligible(f,'a');eligible(f,'b');f.bridge.admin.pause('a');
  const plan=await f.bridge.admin.recommend(a.taskId);assert.equal(plan.state,'recommended');assert.equal(plan.recommended.sourceId,'muse');assert.equal(plan.authorizesAction,false);
  await assert.rejects(progress(f),{code:'TASK_NOT_ATTACHED'});assert.equal(f.calls(),0);
  const approved=await f.bridge.admin.approveRecommendation(plan);assert.equal(approved.taskId,a.taskId);assert.equal(approved.epoch,a.epoch+1);
  assert.equal((await progress(f)).task.id,a.taskId);assert.equal(f.calls(),0);
});
test('recommendation for a detached task fails closed if the chosen session becomes busy',async()=>{
  const f=fixture(),a=await attach(f);eligible(f,'a');eligible(f,'b');f.bridge.admin.pause('a');const plan=await f.bridge.admin.recommend(a.taskId);
  const other=await f.bridge.admin.create('a','Other task');
  await assert.rejects(f.bridge.admin.approveRecommendation(plan),{code:'TASK_ASSIGNMENT_STALE'});
  assert.equal((await progress(f)).task.id,other.taskId);assert.equal(f.calls(),0);
});
test('approval rejects stale world scope, session generation and a competing task epoch',async()=>{
  const f=fixture(),a=await attach(f);eligible(f,'a');f.bridge.admin.pause('a');
  const first=await f.bridge.admin.recommend(a.taskId);f.branch('fork');f.bridge.syncScope();f.branch('main');f.bridge.syncScope();
  await assert.rejects(f.bridge.admin.approveRecommendation(first),{code:'TASK_ASSIGNMENT_STALE'});
  const second=await f.bridge.admin.recommend(a.taskId);f.sessions.set('a',{...f.sessions.get('a'),generation:2});await assert.rejects(f.bridge.admin.approveRecommendation(second));
  const third=await f.bridge.admin.recommend(a.taskId);await f.build().admin.resume('a',a.taskId);
  await assert.rejects(f.bridge.admin.approveRecommendation(third),{code:'TASK_ASSIGNMENT_STALE'});assert.equal(f.calls(),0);
});
test('approved recommendation transfers ownership and preserves prior receipts, without an edit',async()=>{
  const f=fixture(),a=await attach(f);await run(f);f.bridge.admin.pause('a');eligible(f,'b');
  const plan=await f.bridge.admin.recommend(a.taskId);assert.equal(plan.recommended.sourceId,'codex');
  await f.bridge.admin.approveRecommendation(plan);const p=await progress(f,'b');
  assert.equal(p.task.sourceId,'codex');assert.equal(p.task.steps[0].sourceId,'muse');assert.equal(p.task.steps[0].state,'confirmed');assert.equal(f.calls(),1);
  assert.equal(p.task.handoffs[0].to,'codex');
});
test('unready or already attached task never has an approved recommendation',async()=>{
  const f=fixture(),a=await attach(f);eligible(f,'a');eligible(f,'b');
  assert.equal((await f.bridge.admin.recommend(a.taskId)).reason,'TASK_ALREADY_ATTACHED');
  const b=await f.bridge.admin.create('b','Dependent',[a.taskId]);f.bridge.admin.pause('b');
  const plan=await f.bridge.admin.recommend(b.taskId);assert.equal(plan.reason,'TASK_PREREQUISITES_INCOMPLETE');
  await assert.rejects(f.bridge.admin.approveRecommendation(plan),{code:'TASK_ASSIGNMENT_STALE'});assert.equal(f.calls(),0);
});
test('concurrent approval for the same task admits only one assignment',async()=>{
  const f=fixture(),a=await attach(f);eligible(f,'a');f.bridge.admin.pause('a');const plan=await f.bridge.admin.recommend(a.taskId);
  const results=await Promise.allSettled([f.bridge.admin.approveRecommendation(plan),f.bridge.admin.approveRecommendation(plan)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await progress(f)).task.epoch,2);assert.equal(f.calls(),0);
});

const planSpec=()=>({objective:'Prepare two objects and assemble',steps:[
  {key:'a',title:'Prepare first object',sourceId:'muse',dependsOn:[]},
  {key:'b',title:'Prepare second object',sourceId:'codex',dependsOn:[]},
  {key:'finish',title:'Assemble',sourceId:'muse',dependsOn:['a','b']},
]});
test('reviewed plan creates all ordinary detached tasks atomically and never runs work',async()=>{
  const f=fixture();const preview=await f.bridge.admin.previewPlan(planSpec());
  assert.equal(preview.stageCount,2);assert.deepEqual(preview.steps.map(s=>s.stage),[1,1,2]);assert.equal((await inspect(f)).length,0);
  preview.steps[0].title='Modified response';preview.steps[2].dependsOn=[];
  const result=await f.bridge.admin.commitPlan(preview.token),state=await f.bridge.admin.inspect();
  assert.equal(result.created.length,3);assert.equal(state.tasks[0].title,'Prepare first object');
  assert.deepEqual(state.tasks[2].dependsOn,state.tasks.slice(0,2).map(t=>t.id));
  assert.deepEqual(state.attachments,[]);assert.equal(state.plans[0].ready,2);assert.equal(state.plans[0].blocked,1);assert.equal(f.calls(),0);
  assert(!JSON.stringify(state.tasks).includes('sessionId'));await assert.rejects(progress(f),{code:'TASK_NOT_ATTACHED'});
  await assert.rejects(f.bridge.admin.commitPlan(preview.token),{code:'PLAN_PREVIEW_STALE'});
});
test('plan preview defaults use a registered session and reject unknown owners and cycles',async()=>{
  const f=fixture(),preview=await f.bridge.admin.previewPlan({objective:'One task',steps:[{key:'one',title:'Prepare'}]},'a');
  assert.equal(preview.steps[0].sourceId,'muse');
  await assert.rejects(f.bridge.admin.previewPlan({objective:'Invalid',steps:[{key:'a',title:'A',sourceId:'other'}]}),{code:'PLAN_AGENT_UNAVAILABLE'});
  await assert.rejects(f.bridge.admin.previewPlan({objective:'Invalid',steps:[{key:'a',title:'A',sourceId:'muse',dependsOn:['b']},{key:'b',title:'B',sourceId:'codex',dependsOn:['a']}]}),{code:'PLAN_DEPENDENCY_CYCLE'});
  await assert.rejects(f.bridge.admin.commitPlan(preview.token),{code:'PLAN_PREVIEW_STALE'});assert.equal((await inspect(f)).length,0);
});
test('plan save rechecks candidate session generation, and world round trip invalidates review',async()=>{
  const f=fixture(),first=await f.bridge.admin.previewPlan(planSpec());
  f.sessions.set('b',{...f.sessions.get('b'),generation:2});
  await assert.rejects(f.bridge.admin.commitPlan(first.token),{code:'PLAN_AGENT_STALE'});
  const second=await f.bridge.admin.previewPlan(planSpec());f.branch('fork');f.bridge.syncScope();f.branch('main');f.bridge.syncScope();
  await assert.rejects(f.bridge.admin.commitPlan(second.token),{code:'PLAN_PREVIEW_STALE'});assert.equal((await inspect(f)).length,0);
});
test('new preview and explicit discard both invalidate a previously reviewed batch',async()=>{
  const f=fixture(),first=await f.bridge.admin.previewPlan(planSpec()),second=await f.bridge.admin.previewPlan(planSpec());
  await assert.rejects(f.bridge.admin.commitPlan(first.token),{code:'PLAN_PREVIEW_STALE'});f.bridge.admin.discardPlan(second.token);
  await assert.rejects(f.bridge.admin.commitPlan(second.token),{code:'PLAN_PREVIEW_STALE'});assert.equal((await inspect(f)).length,0);
});
test('concurrent save cannot duplicate an approved plan, and no attachment is created',async()=>{
  const f=fixture(),preview=await f.bridge.admin.previewPlan(planSpec());
  const results=await Promise.allSettled([f.bridge.admin.commitPlan(preview.token),f.bridge.admin.commitPlan(preview.token)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const state=await f.bridge.admin.inspect();
  assert.equal(state.tasks.length,3);assert.equal(state.plans.length,1);assert.deepEqual(state.attachments,[]);assert.equal(f.calls(),0);
});
test('capacity changes after preview and storage failure both fail without partial tasks',async()=>{
  const f=fixture(),p=await f.bridge.admin.previewPlan(planSpec());for(let i=0;i<14;i++)await f.bridge.admin.create('a','Existing '+i);
  await assert.rejects(f.bridge.admin.commitPlan(p.token),{code:'TASK_CAPACITY'});assert.equal((await inspect(f)).length,14);
  const g=fixture(),q=await g.bridge.admin.previewPlan(planSpec());g.store.fail();
  await assert.rejects(g.bridge.admin.commitPlan(q.token),/storage failed/);assert.equal((await inspect(g)).length,0);
  await assert.rejects(g.bridge.admin.commitPlan(q.token),{code:'PLAN_PREVIEW_STALE'});
});
test('saved plan uses existing agent ranking, receipt completion, and direct dependency evidence',async()=>{
  const f=fixture();eligible(f,'a');eligible(f,'b');const p=await f.bridge.admin.previewPlan(planSpec()),saved=await f.bridge.admin.commitPlan(p.token);
  const [a,b,finish]=saved.created.map(x=>x.taskId);
  assert.equal((await f.bridge.admin.recommend(finish)).reason,'TASK_PREREQUISITES_INCOMPLETE');
  await f.bridge.admin.approveRecommendation(await f.bridge.admin.recommend(a));await run(f,'prepare-a');await complete(f,'a',(await progress(f)).task);
  assert.equal((await f.bridge.admin.recommend(finish)).reason,'TASK_PREREQUISITES_INCOMPLETE');
  await f.bridge.admin.approveRecommendation(await f.bridge.admin.recommend(b));await run(f,'prepare-b','b');await complete(f,'b',(await progress(f,'b')).task);
  await f.bridge.admin.approveRecommendation(await f.bridge.admin.recommend(finish));const state=await progress(f);
  assert.equal(state.mission.state,'ready');assert.deepEqual(state.mission.dependencies.flatMap(d=>d.receipts.map(r=>r.operationId)),['prepare-a','prepare-b']);
  await run(f,'assemble');await complete(f,'a',(await progress(f)).task);
  assert.equal((await f.bridge.admin.inspect()).plans[0].completed,3);assert.equal(f.calls(),3);
});
test('reload preserves completed plan membership and discards unsaved previews',async()=>{
  const f=fixture(),p=await f.bridge.admin.previewPlan(planSpec()),saved=await f.bridge.admin.commitPlan(p.token);
  const pending=await f.bridge.admin.previewPlan(planSpec());f.bridge=f.build();
  const state=await f.bridge.admin.inspect();assert.equal(state.plans[0].planId,saved.planId);assert.equal(state.tasks.length,3);assert.deepEqual(state.attachments,[]);
  await assert.rejects(f.bridge.admin.commitPlan(pending.token),{code:'PLAN_PREVIEW_STALE'});
});
