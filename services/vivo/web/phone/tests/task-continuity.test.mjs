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

test('archived root diagnosis finds a replacement and reviewed recovery preserves its exact evidence',async()=>{
  const f=fixture(),a=await attach(f);eligible(f,'a');eligible(f,'b');await run(f,'before-archive');
  const before=(await progress(f)).task;await f.bridge.admin.finish('a');
  const b=await f.bridge.admin.create('b','Dependent',[a.taskId]);
  f.sessions.set('c',{sourceId:'dot',sessionId:'c',generation:1,allowRead:true});
  f.sessions.set('a',{...f.sessions.get('a'),status:'stopped'});
  const blocked=await f.bridge.admin.diagnose(b.taskId);
  assert.equal(blocked.target.state,'waiting-prerequisites');assert.equal(blocked.reviewToken,null);
  assert.equal(blocked.roots[0].taskId,a.taskId);assert.equal(blocked.roots[0].state,'closed-incomplete');
  assert.equal(blocked.roots[0].assignment.sourceId,'dot');assert.equal(blocked.roots[0].assignment.afterReopen,true);
  const review=await f.bridge.admin.diagnose(a.taskId);assert(review.reviewToken);
  const reopened=await f.bridge.admin.commitRecovery(review.reviewToken,'Replace stopped agent');
  assert.equal(reopened.epoch,before.epoch+1);assert.equal(reopened.authorizesAction,false);assert.equal(f.calls(),1);
  const state=await f.bridge.admin.inspect();const task=state.tasks.find(t=>t.id===a.taskId);
  assert.deepEqual(task.steps,before.steps);assert.equal(task.closed,false);assert.equal(task.recoveries[0].reason,'Replace stopped agent');
  assert(!state.attachments.some(x=>x.taskId===a.taskId));
  assert.equal((await progress(f,'b')).mission.state,'blocked');
  const plan=await f.bridge.admin.recommend(a.taskId);assert.equal(plan.recommended.sourceId,'dot');
  await f.bridge.admin.approveRecommendation(plan);await run(f,'after-recovery','c');await complete(f,'c',(await progress(f,'c')).task);
  const p=await progress(f,'b');assert.equal(p.mission.state,'ready');
  assert.deepEqual(p.mission.dependencies[0].receipts.map(r=>[r.operationId,r.sourceId]),[['before-archive','muse'],['after-recovery','dot']]);assert.equal(f.calls(),2);
});
test('archived uncertain receipts block recovery until native reconciliation; conflicting evidence never grants a preview',async()=>{
  const f=fixture(),a=await attach(f);f.mode('missing');await run(f);await f.bridge.admin.finish('a');
  let report=await f.bridge.admin.diagnose(a.taskId);assert.equal(report.target.state,'receipt-pending');assert.equal(report.reviewToken,null);
  await assert.rejects(f.bridge.admin.commitRecovery(null,'retry'),{code:'RECOVERY_PREVIEW_STALE'});
  f.receipt(edit());await f.bridge.admin.reconcile();report=await f.bridge.admin.diagnose(a.taskId);
  assert(report.reviewToken);await f.bridge.admin.commitRecovery(report.reviewToken,'Receipt reconciled');assert.equal(f.calls(),1);
  const g=fixture(),b=await attach(g);g.mode('missing');await run(g);g.receipt(edit(),'wrong');await g.bridge.admin.reconcile();await g.bridge.admin.finish('a');
  const conflict=await g.bridge.admin.diagnose(b.taskId);assert.equal(conflict.target.state,'receipt-conflict');assert.equal(conflict.reviewToken,null);assert.equal(g.calls(),1);
});
test('review tokens are single-use, host-held and invalidated by new diagnosis, discard or world changes',async()=>{
  const f=fixture(),a=await attach(f);await f.bridge.admin.finish('a');
  const first=await f.bridge.admin.diagnose(a.taskId),second=await f.bridge.admin.diagnose(a.taskId);
  await assert.rejects(f.bridge.admin.commitRecovery(first.reviewToken,'old'),{code:'RECOVERY_PREVIEW_STALE'});
  f.bridge.admin.discardRecovery(second.reviewToken);await assert.rejects(f.bridge.admin.commitRecovery(second.reviewToken,'discarded'),{code:'RECOVERY_PREVIEW_STALE'});
  const third=await f.bridge.admin.diagnose(a.taskId);f.branch('fork');f.bridge.syncScope();f.branch('main');f.bridge.syncScope();
  await assert.rejects(f.bridge.admin.commitRecovery(third.reviewToken,'wrong scope'),{code:'RECOVERY_PREVIEW_STALE'});
  assert.equal((await inspect(f))[0].closed,true);assert.equal(f.calls(),0);
});
test('reviewed recovery rejects a task whose epoch changed in another tab and cannot reopen it twice',async()=>{
  const f=fixture(),a=await attach(f);await f.bridge.admin.finish('a');
  const first=await f.bridge.admin.diagnose(a.taskId),other=f.build(),second=await other.admin.diagnose(a.taskId);
  await other.admin.commitRecovery(second.reviewToken,'first recovery');
  await other.admin.resume('a',a.taskId);await other.admin.finish('a');
  await assert.rejects(f.bridge.admin.commitRecovery(first.reviewToken,'stale'),{code:'RECOVERY_PREVIEW_STALE'});
  assert.equal((await inspect(f))[0].recoveries.length,1);assert.equal((await inspect(f))[0].closed,true);
});
test('concurrent recovery admits only one transaction and storage failure preserves the archive',async()=>{
  const f=fixture(),a=await attach(f);await f.bridge.admin.finish('a');
  const p=await f.bridge.admin.diagnose(a.taskId);f.store.fail();
  await assert.rejects(f.bridge.admin.commitRecovery(p.reviewToken,'review'),/storage failed/);
  assert.equal((await inspect(f))[0].closed,true);assert.equal((await inspect(f))[0].recoveries,undefined);
  const q=await f.bridge.admin.diagnose(a.taskId),results=await Promise.allSettled([f.bridge.admin.commitRecovery(q.reviewToken,'one'),f.bridge.admin.commitRecovery(q.reviewToken,'two')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await inspect(f))[0].recoveries.length,1);assert.equal(f.calls(),0);
});
test('recovered histories persist after reload but do not restore a task attachment or an unsaved review',async()=>{
  const f=fixture(),a=await attach(f);await run(f);await f.bridge.admin.finish('a');const review=await f.bridge.admin.diagnose(a.taskId);
  await f.bridge.admin.commitRecovery(review.reviewToken,'restore');const before=await f.bridge.admin.inspect();
  f.bridge=f.build();const after=await f.bridge.admin.inspect();assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.attachments,[]);
  await assert.rejects(progress(f),{code:'TASK_NOT_ATTACHED'});await assert.rejects(f.bridge.admin.commitRecovery(review.reviewToken,'again'),{code:'RECOVERY_PREVIEW_STALE'});
  assert(!f.bridge.tools.listFor('a').some(t=>/diagnose|recovery/i.test(t.name)));assert.equal(f.calls(),1);
});

test('collective experience learns from actual completed operations and remains scoped across handoff and reload',async()=>{
  const f=fixture(),root=await attach(f);eligible(f,'a');eligible(f,'b');
  await run(f,'first-change');
  await f.bridge.admin.create('b','Dependent',[root.taskId]);
  await complete(f,'a',(await progress(f)).task);
  const independent=await f.bridge.admin.create('a','Unrelated secret');await run(f,'private-change');await complete(f,'a',(await progress(f)).task);
  const own=await progress(f,'b');
  assert.equal(own.experience.scope,'attached-task-and-completed-direct-prerequisites');
  assert.equal(own.experience.authorizesAction,false);assert.equal(own.experience.profiles[0].completedContributions,1);
  assert.equal(own.experience.profiles[0].confirmedChanged,1);assert(!JSON.stringify(own.experience).includes(independent.taskId));
  const state=await f.bridge.admin.inspect();assert.equal(state.experience.find(p=>p.sourceId==='muse').completedContributions,2);
  f.bridge=f.build();const restored=await f.bridge.admin.inspect();assert.deepEqual(restored.experience,state.experience);
  await assert.rejects(progress(f,'b'),{code:'TASK_NOT_ATTACHED'});assert.equal(f.calls(),2);
});
test('uncertain receipts are observed but never counted as completed expertise',async()=>{
  const f=fixture();await attach(f);f.mode('missing');await run(f,'uncertain');
  let profile=(await f.bridge.admin.inspect()).experience[0];assert.equal(profile.pending,1);assert.equal(profile.confirmedChanged,0);assert.equal(profile.completedContributions,0);
  f.receipt(edit('uncertain'));await f.bridge.admin.reconcile();
  profile=(await f.bridge.admin.inspect()).experience[0];assert.equal(profile.pending,0);assert.equal(profile.confirmedChanged,1);assert.equal(profile.completedContributions,0);
  await complete(f,'a',(await progress(f)).task);
  profile=(await f.bridge.admin.inspect()).experience[0];assert.equal(profile.completedContributions,1);assert.equal(profile.objects[0].completedChangedTasks,1);assert.equal(f.calls(),1);
});
test('owner experience remains branch-local and no source receives credit merely for assignment',async()=>{
  const f=fixture();await attach(f);
  assert.deepEqual((await f.bridge.admin.inspect()).experience,[]);
  await run(f);await complete(f,'a',(await progress(f)).task);
  const main=(await f.bridge.admin.inspect()).experience;assert.equal(main.length,1);
  f.branch('fork');f.bridge.syncScope();assert.deepEqual((await f.bridge.admin.inspect()).experience,[]);
  f.branch('main');f.bridge.syncScope();assert.deepEqual((await f.bridge.admin.inspect()).experience,main);
});

const recallTool='neural.missionRecall',recallQuery={spaceId:'room',entityId:'object'};
async function recallFixture(){
  const f=fixture(),first=await attach(f);await run(f,'shared-op');await complete(f,'a',(await progress(f)).task);
  const hidden=await f.bridge.admin.create('a','Unshared history');await run(f,'private-op');await complete(f,'a',(await progress(f)).task);
  const target=await f.bridge.admin.create('b','Independent future mission');
  return {f,first,hidden,target,grant:()=>f.bridge.admin.grantMissionRecall('b',{taskId:target.taskId,epoch:target.epoch,sourceTaskIds:[first.taskId]})};
}
test('explicit mission recall grant shares only selected completed history with the exact attachment',async()=>{
  const {f,first,target,grant}=await recallFixture();assert.equal((await progress(f,'b')).mission.dependencies.length,0);
  assert(!f.bridge.tools.listFor('b').some(t=>t.name===recallTool));await assert.rejects(f.bridge.tools.invokeFor('b',recallTool,recallQuery),{code:'MISSION_RECALL_NOT_GRANTED'});
  await grant();assert(f.bridge.tools.listFor('b').some(t=>t.name===recallTool));
  const r=await f.bridge.tools.invokeFor('b',recallTool,recallQuery);assert.equal(r.total,1);assert.equal(r.matches[0].taskId,first.taskId);assert.equal(r.matches[0].operationId,'shared-op');assert.equal(r.matches[0].sourceId,'muse');assert.equal(r.authorizesAction,false);
  assert(!JSON.stringify(r).includes('private-op'));assert.equal(f.calls(),2);
  assert.deepEqual((await f.bridge.admin.inspect()).missionRecallGrants,[{taskId:target.taskId,sessionId:'b',sourceTaskIds:[first.taskId]}]);
  await assert.rejects(f.bridge.tools.invokeFor('a',recallTool,recallQuery),{code:'TASK_NOT_ATTACHED'});
  await assert.rejects(f.bridge.tools.invokeFor('b',recallTool,{...recallQuery,taskId:'unshared'}),{code:'MISSION_RECALL_ARGUMENTS_INVALID'});
});
test('revocation during an in-flight lookup fences the result',async()=>{
  const {f,grant}=await recallFixture();await grant();
  const release=f.store.hold(),pending=f.bridge.tools.invokeFor('b',recallTool,recallQuery);await release.entered;
  f.bridge.admin.revokeMissionRecall('b');release();
  await assert.rejects(pending,{code:'MISSION_RECALL_GRANT_STALE'});assert(!f.bridge.tools.listFor('b').some(t=>t.name===recallTool));assert.equal(f.calls(),2);
});
test('revocation while a grant is pending cannot restore access',async()=>{
  const {f,grant}=await recallFixture();const release=f.store.hold(),pending=grant();await release.entered;
  f.bridge.admin.revokeMissionRecall('b');release();await assert.rejects(pending,{code:'MISSION_RECALL_GRANT_STALE'});
  assert.deepEqual((await f.bridge.admin.inspect()).missionRecallGrants,[]);
});
test('replacement attachment and reload require fresh explicit evidence sharing',async()=>{
  const {f,first,target,grant}=await recallFixture();await grant();
  await f.bridge.admin.create('b','New task');assert(!f.bridge.tools.listFor('b').some(t=>t.name===recallTool));
  f.bridge=f.build();const resumed=await f.bridge.admin.resume('b',target.taskId);
  assert(!f.bridge.tools.listFor('b').some(t=>t.name===recallTool));
  await f.bridge.admin.grantMissionRecall('b',{taskId:target.taskId,epoch:resumed.epoch,sourceTaskIds:[first.taskId]});
  assert.equal((await f.bridge.tools.invokeFor('b',recallTool,recallQuery)).total,1);
  f.branch('fork');f.bridge.syncScope();f.branch('main');f.bridge.syncScope();
  assert.deepEqual((await f.bridge.admin.inspect()).missionRecallGrants,[]);assert.equal(f.calls(),2);
});
test('old task epoch and incomplete evidence fail closed',async()=>{
  const {f,first,target}=await recallFixture();const source=await f.bridge.admin.create('a','Incomplete evidence');
  await assert.rejects(f.bridge.admin.grantMissionRecall('b',{taskId:target.taskId,epoch:target.epoch+1,sourceTaskIds:[first.taskId]}),{code:'MISSION_RECALL_TARGET_STALE'});
  await assert.rejects(f.bridge.admin.grantMissionRecall('b',{taskId:target.taskId,epoch:target.epoch,sourceTaskIds:[source.taskId]}),{code:'MISSION_RECALL_SOURCE_UNAVAILABLE'});
  assert.deepEqual((await f.bridge.admin.inspect()).missionRecallGrants,[]);
});
test('another tab changing the task epoch fences the old recall grant',async()=>{
  const {f,target,grant}=await recallFixture();await grant();await f.build().admin.resume('b',target.taskId);
  await assert.rejects(f.bridge.tools.invokeFor('b',recallTool,recallQuery),{code:'TASK_ATTACHMENT_STALE'});
  assert.deepEqual((await f.bridge.admin.inspect()).missionRecallGrants,[]);assert.equal(f.calls(),2);
});

const associationTool='neural.missionTrace';
const associationQuery={from:{spaceId:'room',entityId:'object'},to:{spaceId:'room',entityId:'other'}};
async function associationFixture(){
  const {f,first,hidden,target}=await recallFixture();
  const second=await f.bridge.admin.create('a','Dependent evidence',[first.taskId]);
  await f.bridge.tools.invokeFor('a','vivo.world.edit',{...edit('linked-op'),entityId:'other'});
  await complete(f,'a',(await progress(f)).task);
  const grant=ids=>f.bridge.admin.grantMissionRecall('b',{taskId:target.taskId,epoch:target.epoch,sourceTaskIds:ids});
  return {f,first,hidden,target,second,grant};
}
test('association tool requires the existing explicit grant and never reveals unshared prerequisites',async()=>{
  const {f,first,second,target,grant}=await associationFixture();
  assert(!f.bridge.tools.listFor('b').some(t=>t.name===associationTool));
  await assert.rejects(f.bridge.tools.invokeFor('b',associationTool,associationQuery),{code:'MISSION_RECALL_NOT_GRANTED'});
  await grant([second.taskId]);assert(f.bridge.tools.listFor('b').some(t=>t.name===associationTool));
  const hidden=await f.bridge.tools.invokeFor('b',associationTool,associationQuery);
  assert.equal(hidden.reason,'OBJECT_NOT_IN_SHARED_EVIDENCE');assert(!JSON.stringify(hidden).includes(first.taskId));
  await grant([first.taskId,second.taskId]);
  const r=await f.bridge.tools.invokeFor('b',associationTool,associationQuery);
  assert.equal(r.status,'matched');assert.equal(r.targetTaskId,target.taskId);assert.equal(r.attachmentEpoch,target.epoch);
  assert.deepEqual(r.hops.map(h=>h.relation),['observed-in','prerequisite-of','observed-object']);
  assert.deepEqual(r.hops.filter(h=>h.evidence.kind==='confirmed-receipt').map(h=>h.evidence.operationId),['shared-op','linked-op']);
  assert(!JSON.stringify(r).includes('private-op'));assert.equal(r.authorizesAction,false);assert.equal(r.causalityProven,false);assert.equal(f.calls(),3);
});
test('association trace returns no path outside the hop limit and rejects foreign scope arguments',async()=>{
  const {f,first,second,grant}=await associationFixture();await grant([first.taskId,second.taskId]);
  const r=await f.bridge.tools.invokeFor('b',associationTool,{...associationQuery,maxHops:2});assert.equal(r.reason,'NO_SHARED_PATH_WITHIN_BOUND');assert.deepEqual(r.hops,[]);
  await assert.rejects(f.bridge.tools.invokeFor('b',associationTool,{...associationQuery,sourceTaskIds:[first.taskId]}),{code:'MISSION_TRACE_ARGUMENTS_INVALID'});
  assert.equal(f.calls(),3);
});
test('revoked in-flight association read is fenced and does not execute any native action',async()=>{
  const {f,first,second,grant}=await associationFixture();await grant([first.taskId,second.taskId]);
  const release=f.store.hold(),pending=f.bridge.tools.invokeFor('b',associationTool,associationQuery);await release.entered;
  f.bridge.admin.revokeMissionRecall('b');release();await assert.rejects(pending,{code:'MISSION_RECALL_GRANT_STALE'});
  assert(!f.bridge.tools.listFor('b').some(t=>t.name===associationTool));assert.equal(f.calls(),3);
});
test('world switch and stale attachment epoch invalidate association access',async()=>{
  const {f,first,second,target,grant}=await associationFixture();await grant([first.taskId,second.taskId]);
  await f.build().admin.resume('b',target.taskId);
  await assert.rejects(f.bridge.tools.invokeFor('b',associationTool,associationQuery),{code:'TASK_ATTACHMENT_STALE'});
  f.branch('fork');f.bridge.syncScope();f.branch('main');f.bridge.syncScope();
  await assert.rejects(f.bridge.tools.invokeFor('b',associationTool,associationQuery),{code:'TASK_NOT_ATTACHED'});assert.equal(f.calls(),3);
});

const forecastTool='neural.missionForecast';
async function forecastFixture(){
  const {f,first,hidden,target}=await recallFixture(),sources=[];
  for(let i=0;i<3;i++){
    const t=await f.bridge.admin.create('a','Historical sequence '+i);
    await run(f,'forecast-cue-'+i);
    await f.bridge.tools.invokeFor('a','vivo.world.edit',{...edit('forecast-next-'+i),entityId:'other'});
    await complete(f,'a',(await progress(f)).task);sources.push(t.taskId);
  }
  const grant=ids=>f.bridge.admin.grantMissionRecall('b',{taskId:target.taskId,epoch:target.epoch,sourceTaskIds:ids});
  return {f,first,hidden,target,sources,grant};
}
test('forecast is explicit, task-scoped, and abstains before sufficient distinct evidence',async()=>{
  const {f,first,hidden,target,sources,grant}=await forecastFixture();
  assert(!f.bridge.tools.listFor('b').some(t=>t.name===forecastTool));
  await assert.rejects(f.bridge.tools.invokeFor('b',forecastTool,recallQuery),{code:'MISSION_RECALL_NOT_GRANTED'});
  await grant([sources[0]]);assert(f.bridge.tools.listFor('b').some(t=>t.name===forecastTool));
  const sparse=await f.bridge.tools.invokeFor('b',forecastTool,recallQuery);
  assert.equal(sparse.status,'abstain');assert.equal(sparse.reason,'INSUFFICIENT_DISTINCT_TASKS');
  await grant(sources);
  const r=await f.bridge.tools.invokeFor('b',forecastTool,recallQuery);
  assert.equal(r.status,'suggested');assert.equal(r.suggestion.entityId,'other');assert.equal(r.suggestion.supportingTasks,3);
  assert.equal(r.targetTaskId,target.taskId);assert.equal(r.attachmentEpoch,target.epoch);
  assert.equal(r.retrospective.evaluated,0);assert.equal(r.retrospective.observedAccuracy,null);
  assert.deepEqual(r.candidates[0].witnesses.map(w=>w.taskId).sort(),sources.slice().sort());
  assert(!JSON.stringify(r).includes(first.taskId));assert(!JSON.stringify(r).includes(hidden.taskId));assert(!JSON.stringify(r).includes('private-op'));
  assert.equal(r.authorizesAction,false);assert.equal(r.calibratedProbability,false);assert.equal(f.calls(),8);
});
test('grant replacement limits forecast evidence and exact arguments cannot select private tasks',async()=>{
  const {f,first,sources,grant}=await forecastFixture();await grant(sources);
  await grant([first.taskId]);const r=await f.bridge.tools.invokeFor('b',forecastTool,recallQuery);
  assert.equal(r.counts.matchingTasks,1);assert.equal(r.counts.terminal,1);assert.equal(r.suggestion,null);
  await assert.rejects(f.bridge.tools.invokeFor('b',forecastTool,{...recallQuery,sourceTaskIds:sources}),{code:'MISSION_FORECAST_ARGUMENTS_INVALID'});
  assert.equal(f.calls(),8);
});
test('revocation during forecast fences pending result and no native action runs',async()=>{
  const {f,sources,grant}=await forecastFixture();await grant(sources);
  const release=f.store.hold(),pending=f.bridge.tools.invokeFor('b',forecastTool,recallQuery);await release.entered;
  f.bridge.admin.revokeMissionRecall('b');release();await assert.rejects(pending,{code:'MISSION_RECALL_GRANT_STALE'});
  assert(!f.bridge.tools.listFor('b').some(t=>t.name===forecastTool));assert.equal(f.calls(),8);
});
test('stale attachment and reload do not restore forecast grants',async()=>{
  const {f,target,sources,grant}=await forecastFixture();await grant(sources);
  await f.build().admin.resume('b',target.taskId);
  await assert.rejects(f.bridge.tools.invokeFor('b',forecastTool,recallQuery),{code:'TASK_ATTACHMENT_STALE'});
  f.bridge=f.build();await f.bridge.admin.resume('b',target.taskId);
  await assert.rejects(f.bridge.tools.invokeFor('b',forecastTool,recallQuery),{code:'MISSION_RECALL_NOT_GRANTED'});
  assert.equal(f.calls(),8);
});

test('scenario compares maximum simultaneous local assignments without altering tasks or grants',async()=>{
  const f=fixture();eligible(f,'a');eligible(f,'b');
  const p=await f.bridge.admin.previewPlan(planSpec()),saved=await f.bridge.admin.commitPlan(p.token),ids=saved.created.map(x=>x.taskId);
  const before=await f.bridge.admin.inspect(),result=await f.bridge.admin.compareScenario({taskIds:ids,unavailableSourceIds:['muse']});
  assert.equal(result.baseline.assignable,2);assert.equal(result.alternative.assignable,1);assert.equal(result.lostCapacity,1);
  assert.equal(result.alternative.rows.find(r=>r.taskId===ids[2]).status,'TASK_PREREQUISITES_INCOMPLETE');
  assert.equal(result.authorizesAction,false);assert.deepEqual(await f.bridge.admin.inspect(),before);assert.equal(f.calls(),0);
  assert(!f.bridge.tools.listFor('a').some(t=>/scenario/i.test(t.name)));
});
test('scenario keeps actual attachments and unresolved operations unavailable',async()=>{
  const f=fixture();eligible(f,'a');eligible(f,'b');
  const first=await attach(f);f.mode('missing');await run(f);
  const second=await f.bridge.admin.create('b','Other attached task'),third=await f.bridge.admin.create('b','Detached after pause');f.bridge.admin.pause('b');
  const before=await f.bridge.admin.inspect(),r=await f.bridge.admin.compareScenario({taskIds:[first.taskId,second.taskId,third.taskId],unavailableSourceIds:['codex']});
  assert.equal(r.baseline.rows.find(t=>t.taskId===first.taskId).status,'TASK_RECONCILIATION_REQUIRED');
  assert.equal(r.baseline.assignable,1);assert.equal(r.alternative.assignable,0);
  assert.deepEqual(await f.bridge.admin.inspect(),before);assert.equal(f.calls(),1);
});
test('scenario validates exact task selection and fences world changes during storage',async()=>{
  const f=fixture(),a=await attach(f);await assert.rejects(f.bridge.admin.compareScenario({taskIds:['unknown']}),{code:'TASK_NOT_FOUND'});
  await assert.rejects(f.bridge.admin.compareScenario({taskIds:[a.taskId,a.taskId]}),{code:'SCENARIO_TASKS_INVALID'});
  const release=f.store.hold(),pending=f.bridge.admin.compareScenario({taskIds:[a.taskId]});await release.entered;
  f.branch('fork');f.bridge.syncScope();f.branch('main');f.bridge.syncScope();release();
  await assert.rejects(pending,{code:'SCENARIO_SCOPE_STALE'});assert.equal(f.calls(),0);
});

test('strategy compares multiple dependency waves without completing, assigning or editing tasks',async()=>{
  const f=fixture();eligible(f,'a');eligible(f,'b');
  const p=await f.bridge.admin.previewPlan(planSpec()),saved=await f.bridge.admin.commitPlan(p.token),ids=saved.created.map(x=>x.taskId);
  const before=await f.bridge.admin.inspect(),r=await f.bridge.admin.compareStrategy({taskIds:ids,unavailableSourceIds:['muse']});
  assert.equal(r.structuralDependencyDepth,2);assert.equal(r.baseline.roundCount,2);assert.equal(r.alternative.roundCount,3);assert.equal(r.roundDifference,1);
  assert.equal(r.baseline.simulatedScheduled,3);assert.equal(r.alternative.simulatedScheduled,3);
  assert.equal(r.authorizesAction,false);assert.equal(r.predictsCompletion,false);assert.equal(r.optimalScheduleProven,false);
  assert.equal((await f.bridge.admin.recommend(ids[2])).reason,'TASK_PREREQUISITES_INCOMPLETE');
  assert.deepEqual(await f.bridge.admin.inspect(),before);assert.equal(f.calls(),0);
  assert(!f.bridge.tools.listFor('a').some(t=>/strategy/i.test(t.name)));
});
test('strategy cannot assume an unselected prerequisite or uncertain attached work has finished',async()=>{
  const f=fixture();eligible(f,'a');eligible(f,'b');
  const root=await attach(f);f.mode('missing');await run(f);
  const child=await f.bridge.admin.create('b','Child',[root.taskId]);f.bridge.admin.pause('b');
  const only=await f.bridge.admin.compareStrategy({taskIds:[child.taskId]});
  assert.deepEqual(only.baseline.unscheduled[0].externalPrerequisiteIds,[root.taskId]);assert.equal(only.baseline.simulatedScheduled,0);
  const both=await f.bridge.admin.compareStrategy({taskIds:[root.taskId,child.taskId]});
  assert.equal(both.baseline.simulatedScheduled,0);
  assert.equal(both.baseline.unscheduled.find(t=>t.taskId===root.taskId).reason,'TASK_RECONCILIATION_REQUIRED');
  assert.deepEqual(both.baseline.unscheduled.find(t=>t.taskId===child.taskId).unmetPrerequisiteIds,[root.taskId]);assert.equal(f.calls(),1);
});
test('strategy uses current native eligibility even for future waves and rejects stale scope',async()=>{
  const f=fixture();eligible(f,'a');eligible(f,'b');
  const p=await f.bridge.admin.previewPlan(planSpec()),saved=await f.bridge.admin.commitPlan(p.token),ids=saved.created.map(x=>x.taskId);
  const none=await f.bridge.admin.compareStrategy({taskIds:ids,unavailableSourceIds:['muse','codex']});
  assert.equal(none.alternative.simulatedScheduled,0);assert.equal(none.alternative.allRemainingScheduled,false);assert.equal(none.roundDifference,null);
  const release=f.store.hold(),pending=f.bridge.admin.compareStrategy({taskIds:ids});await release.entered;
  f.branch('fork');f.bridge.syncScope();f.branch('main');f.bridge.syncScope();release();
  await assert.rejects(pending,{code:'STRATEGY_SCOPE_STALE'});assert.equal(f.calls(),0);
});

test('critic improves a real journal strategy without modifying task completion or agent grants',async()=>{
  const f=fixture();eligible(f,'a');eligible(f,'b');
  const spec={objective:'Critical chain review',steps:[
    {key:'a',title:'Independent A',sourceId:'muse',dependsOn:[]},
    {key:'b',title:'Independent B',sourceId:'muse',dependsOn:[]},
    {key:'c',title:'Critical start',sourceId:'muse',dependsOn:[]},
    {key:'d',title:'Critical middle',sourceId:'muse',dependsOn:['c']},
    {key:'e',title:'Critical finish',sourceId:'muse',dependsOn:['d']}]};
  const p=await f.bridge.admin.previewPlan(spec),saved=await f.bridge.admin.commitPlan(p.token),ids=saved.created.map(t=>t.taskId);
  const before=await f.bridge.admin.inspect(),r=await f.bridge.admin.reviewStrategy({taskIds:ids,unavailableSourceIds:['muse']});
  assert.equal(r.baseline.originalRounds,4);assert.equal(r.baseline.preferredRounds,3);assert.equal(r.baseline.proofStatus,'exact-search-proven');
  assert.equal(r.baseline.improvementRounds,1);assert.equal(r.alternative.preferredRounds,5);assert.equal(r.conditionalRoundDifference,2);
  assert.equal(r.singleSourceStress.tested,2);assert.equal(r.authorizesAction,false);assert.equal(r.predictsCompletion,false);
  const end=before.tasks.find(t=>t.title==='Critical finish');
  assert.equal((await f.bridge.admin.recommend(end.id)).reason,'TASK_PREREQUISITES_INCOMPLETE');
  assert.deepEqual(await f.bridge.admin.inspect(),before);assert.equal(f.calls(),0);
  assert(!f.bridge.tools.listFor('a').some(t=>/critic|reviewStrategy/i.test(t.name)));
});
test('critic exposes missing external prerequisites and uncertain task evidence without inventing completions',async()=>{
  const f=fixture();eligible(f,'a');eligible(f,'b');
  const root=await attach(f);f.mode('missing');await run(f);
  const child=await f.bridge.admin.create('b','Blocked child',[root.taskId]);f.bridge.admin.pause('b');
  const before=await f.bridge.admin.inspect();
  const both=await f.bridge.admin.reviewStrategy({taskIds:[root.taskId,child.taskId]});
  assert.equal(both.baseline.proofStatus,'blocked-under-fixed-snapshot');assert.equal(both.baseline.audit.unscheduled,2);
  assert.equal(both.baseline.audit.conditionalLowerBound,null);assert.equal(both.conditionalRoundDifference,null);
  const single=await f.bridge.admin.reviewStrategy({taskIds:[child.taskId]});
  assert.deepEqual(single.baseline.unscheduled[0].externalPrerequisiteIds,[root.taskId]);
  assert.deepEqual(await f.bridge.admin.inspect(),before);assert.equal(f.calls(),1);
});
test('critic rechecks world/branch epoch before returning a report',async()=>{
  const f=fixture();eligible(f,'a');const a=await attach(f);f.bridge.admin.pause('a');
  await assert.rejects(f.bridge.admin.reviewStrategy({taskIds:[a.taskId,a.taskId]}),{code:'SCENARIO_TASKS_INVALID'});
  const release=f.store.hold(),pending=f.bridge.admin.reviewStrategy({taskIds:[a.taskId]});await release.entered;
  f.branch('fork');f.bridge.syncScope();f.branch('main');f.bridge.syncScope();release();
  await assert.rejects(pending,{code:'CRITIC_SCOPE_STALE'});assert.equal(f.calls(),0);
});
