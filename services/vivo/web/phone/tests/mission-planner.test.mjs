import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMissionPlanLines,compileMissionPlan,buildPlannedTasks,validatePlanMetadata,summarizeMissionPlans} from '../mission-planner.mjs';
const agent=(sourceId,extra={})=>({sourceId,sessionId:'session-'+sourceId,generation:1,status:'active',...extra});
const agents=[agent('muse'),agent('codex'),agent('dot')];
const step=(key,dependsOn=[],sourceId=null)=>({key,title:'Work '+key,sourceId,dependsOn});
const compile=(steps,extra={},pool=agents)=>compileMissionPlan({objective:'Shared object mission',steps,defaultSourceId:'muse',...extra},pool);
const diamond=[step('finish',['left','right'],'dot'),step('left',[],'muse'),step('right',[],'codex')];
const saved=()=>buildPlannedTasks({tasks:[]},compile(diamond),'plan-1');
const code=x=>({code:x});

test('line parser accepts exact four-column syntax, blank defaults and forward references',()=>{
 const rows=parseMissionPlanLines('finish | Assemble | dot | left, right\n left | Prepare | | \nright | Inspect | codex |');
 assert.deepEqual(rows[0],{key:'finish',title:'Assemble',sourceId:'dot',dependsOn:['left','right']});assert.equal(rows[1].sourceId,null);
 for(const text of ['','key | title','x | y | z | q | r',Array(17).fill('a | b | |').join('\n')])assert.throws(()=>parseMissionPlanLines(text));
});
test('stable topological stages expose parallel prerequisites and preserve explicit source pins',()=>{
 const p=compile(diamond);assert.deepEqual(p.steps.map(s=>[s.key,s.stage,s.sourceId]),[['left',1,'muse'],['right',1,'codex'],['finish',2,'dot']]);
 assert.equal(p.stageCount,2);assert.equal(p.authorizesAction,false);assert.equal(p.steps[2].agent.sessionId,'session-dot');
});
test('unknown, duplicate, self and cyclic dependencies reject the entire plan',()=>{
 for(const steps of [[step('a',['b'])],[step('a',['a'])],[step('a',['b','b']),step('b')],[step('a',['b']),step('b',['a'])],[step('a'),step('a')],[step('bad key')]])assert.throws(()=>compile(steps));
});
test('missing, stopped and malformed agent sessions cannot be selected',()=>{
 assert.throws(()=>compile([step('a',[],'unknown')]),code('PLAN_AGENT_UNAVAILABLE'));
 assert.throws(()=>compile([step('a')],{},[agent('muse',{status:'stopped'})]),code('PLAN_AGENT_UNAVAILABLE'));
 assert.throws(()=>compile([step('a')],{},[agent('muse',{generation:0})]),code('PLAN_AGENT_UNAVAILABLE'));
 assert.throws(()=>compile([step('a')],{},[agent('muse'),agent('muse',{sessionId:'other'})]),code('PLAN_AGENT_AMBIGUOUS'));
});
test('bounded title and step input rejects sparse arrays, over-capacity plans and empty objectives',()=>{
 for(const s of [[],Array(2),Array.from({length:17},(_,i)=>step('a'+i)),[step('a',Array(2))],[{...step('a'),title:'x'.repeat(101)}]])assert.throws(()=>compile(s));
 for(const objective of ['', ' ', 'x'.repeat(161),'bad\nobjective'])assert.throws(()=>compile([step('a')],{objective}),code('PLAN_OBJECTIVE_INVALID'));
});
test('compiled input and pinned session identities are detached from mutable caller values',()=>{
 const rows=structuredClone(diamond),pool=structuredClone(agents),p=compile(rows,{},pool);rows[0].dependsOn.push('missing');pool[0].sessionId='retargeted';
 assert.deepEqual(p.steps[2].dependsOn,['left','right']);assert.equal(p.steps[0].agent.sessionId,'session-muse');
});
test('materialization creates detached ordinary tasks and maps aliases to canonical IDs',()=>{
 const rows=saved();assert.equal(rows.length,3);assert.deepEqual(rows[2].dependsOn,['plan-1:left','plan-1:right']);
 assert(rows.every(t=>t.epoch===1&&!t.closed&&t.steps.length===0&&!('agent' in t)&&!('sessionId' in t)));assert.equal(rows[0].plan.stepCount,3);
 assert.equal(validatePlanMetadata({tasks:rows}).tasks.length,3);
});
test('capacity and identity conflict cannot partially modify existing journal',()=>{
 const existing={tasks:[{id:'plan-1:left'}]},old=structuredClone(existing);assert.throws(()=>buildPlannedTasks(existing,compile(diamond),'plan-1'),code('PLAN_TASK_ID_CONFLICT'));assert.deepEqual(existing,old);
 assert.throws(()=>buildPlannedTasks(existing,compile(diamond),'plan-2',3),code('TASK_CAPACITY'));assert.deepEqual(existing,old);
});
test('saved plan cannot be inserted twice even after a response is lost',()=>{
 const j={tasks:saved()};assert.throws(()=>buildPlannedTasks(j,compile(diamond),'plan-1'),code('PLAN_ALREADY_SAVED'));assert.equal(j.tasks.length,3);
});
test('corrupt plan metadata, partial groups and out-of-group dependency fail closed',()=>{
 for(const mutate of [r=>r.pop(),r=>{r[1].plan.objective='other';},r=>{for(const t of r)t.plan.objective=null;},r=>{r[1].plan.stepCount=2;},r=>{r[1].plan.stepKey='left';},r=>{r[2].dependsOn=['outside'];r.push({id:'outside'});}]){
  const r=saved();mutate(r);assert.throws(()=>validatePlanMetadata({tasks:r}),code('PLAN_STORAGE_INVALID'));
 }
});
test('mission summary tracks parallel readiness, confirmation, blocking and review separately',()=>{
 const rows=saved(),summary=()=>summarizeMissionPlans(rows)[0];assert.deepEqual(summary(),{planId:'plan-1',objective:'Shared object mission',total:3,completed:0,ready:2,blocked:1,needsReview:0,closedIncomplete:0});
 rows[0].completed=true;rows[0].closed=true;rows[1].steps.push({state:'pending'});assert.equal(summary().needsReview,1);assert.equal(summary().blocked,1);
 rows[1].steps[0].state='confirmed';rows[1].completed=true;rows[1].closed=true;assert.equal(summary().ready,1);assert.equal(summary().completed,2);
 rows[2].closed=true;assert.equal(summary().closedIncomplete,1);assert.equal(summary().completed,2);
});
test('two plans and standalone tasks remain distinct; no private session details are persisted',()=>{
 const tasks=[...saved(),...buildPlannedTasks({tasks:saved()},compile([step('a')]),'plan-2'),{id:'standalone',steps:[]}];
 assert.deepEqual(summarizeMissionPlans(tasks).map(p=>[p.planId,p.total]),[['plan-1',3],['plan-2',1]]);assert(!JSON.stringify(tasks).includes('session-muse'));
});
