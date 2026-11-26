import test from 'node:test';
import assert from 'node:assert/strict';
import {rankMissionAgents} from '../mission-orchestrator.mjs';
const agent=(sourceId,extra={})=>({sourceId,sessionId:'session-'+sourceId,generation:1,status:'active',activeOperations:0,activeContacts:0,tools:['vivo.world.read','vivo.world.edit'],...extra});
const task={id:'target',sourceId:'muse',closed:false,steps:[]};
const ready={readyForJournaledEdits:true,dependencies:[]};
const rank=extra=>rankMissionAgents({tasks:[task],task,agents:[agent('muse'),agent('codex')],attachments:[],mission:ready,...extra});
const receipt=(sourceId,entityId,changed=true,spaceId='room')=>({sourceId,entityId,spaceId,changed,state:'confirmed'});
test('recommendation retains eligible current owner and grants no authority',()=>{const r=rank();assert.equal(r.recommended.sourceId,'muse');assert.equal(r.authorizesAction,false);});
test('blocked, closed, pending, conflicting and attached tasks are not offered',()=>{
 for(const [extra,reason] of [[{mission:{...ready,readyForJournaledEdits:false}},'TASK_PREREQUISITES_INCOMPLETE'],[{task:{...task,closed:true}},'TASK_CLOSED'],[{task:{...task,steps:[{state:'pending'}]}},'TASK_RECONCILIATION_REQUIRED'],[{task:{...task,steps:[{state:'conflict'}]}},'TASK_RECONCILIATION_REQUIRED'],[{attachments:[{taskId:'target',sessionId:'session-muse'}]},'TASK_ALREADY_ATTACHED']]){const r=rank(extra);assert.equal(r.reason,reason);assert.equal(r.recommended,null);}
});
test('inactive, ungranted, busy and unknown workload agents are excluded',()=>{const r=rank({agents:[agent('muse',{status:'stopped'}),agent('read',{tools:['vivo.world.read']}),agent('busy',{activeContacts:1}),agent('unknown',{activeOperations:undefined}),agent('codex')]});assert.equal(r.recommended.sourceId,'codex');assert.equal(r.candidates.filter(x=>x.eligible).length,1);});
test('local attachments and pending assignments reserve candidate agents',()=>{const r=rank({attachments:[{taskId:'other',sessionId:'session-muse'}],agents:[agent('muse'),agent('codex',{attachmentPending:true})]});assert.equal(r.reason,'NO_ELIGIBLE_AGENT');assert.equal(r.recommended,null);});
test('same-space changed receipts rank ahead of unrelated or unchanged receipts',()=>{const dependency={receipts:[receipt('planner','relic')]};const tasks=[task,{sourceId:'codex',steps:[receipt('codex','relic')]},{sourceId:'dot',steps:[receipt('dot','relic',false),receipt('dot','relic',true,'other'),receipt('dot','unrelated')]}];const r=rank({tasks,agents:[agent('codex'),agent('dot',{tools:['vivo.world.read','vivo.world.edit','neural.predict']})],mission:{...ready,dependencies:[dependency]}});assert.equal(r.recommended.sourceId,'codex');assert.equal(r.candidates[0].relatedChangedReceipts,1);assert.equal(r.candidates[1].relatedChangedReceipts,0);});
test('numeric memory availability is a tie-breaker, never a native grant',()=>{const r=rank({agents:[agent('a'),agent('b',{tools:['vivo.world.read','vivo.world.edit','neural.predict']}),agent('c',{tools:['neural.predict']})]});assert.equal(r.recommended.sourceId,'b');assert.equal(r.candidates.find(x=>x.sourceId==='c').eligible,false);});
test('rank is deterministic independent of registry iteration and does not mutate inputs',()=>{const agents=[agent('z'),agent('a')],input=structuredClone(agents);assert.equal(rank({agents}).recommended.sourceId,'a');assert.equal(rank({agents:agents.slice().reverse()}).recommended.sourceId,'a');assert.deepEqual(agents,input);});
test('missing valid session identity or exhausted transfer capacity does not yield a new owner',()=>{const r=rank({task:{...task,handoffs:Array(16).fill({})},agents:[agent('bad',{generation:0}),agent('codex')]});assert.equal(r.recommended,null);assert.equal(r.candidates.length,1);assert.deepEqual(r.candidates[0].reasons,['TASK_HANDOFF_CAPACITY']);});

test('completed relevant tasks outweigh repeated changes on an unfinished task',()=>{
  const many={sourceId:'dot',steps:Array.from({length:20},()=>receipt('dot','relic'))};
  const complete={sourceId:'codex',closed:true,completed:true,steps:[receipt('codex','relic')]};
  const r=rank({tasks:[task,many,complete],agents:[agent('dot'),agent('codex')],mission:{...ready,dependencies:[{status:'completed',receipts:[receipt('planner','relic')]}]}});
  assert.equal(r.recommended.sourceId,'codex');assert.equal(r.relatedObjectCount,1);
  assert.equal(r.candidates[0].relatedCompletedTasks,1);assert.equal(r.candidates[1].relatedChangedReceipts,20);assert.equal(r.candidates[1].relatedChangedTasks,1);
});
test('receipt volume does not break a tie in distinct task experience',()=>{
  const r=rank({tasks:[task,{sourceId:'z',steps:Array.from({length:20},()=>receipt('z','relic'))},{sourceId:'a',steps:[receipt('a','relic')]}],
    agents:[agent('z'),agent('a')],mission:{...ready,dependencies:[{status:'completed',receipts:[receipt('planner','relic')]}]}});
  assert.equal(r.recommended.sourceId,'a');
});
test('verified experience never overrides continuity or current permissions',()=>{
  const expert={sourceId:'codex',completed:true,closed:true,steps:[receipt('codex','relic')]},m={...ready,dependencies:[{status:'completed',receipts:[receipt('planner','relic')]}]};
  assert.equal(rank({tasks:[task,expert],mission:m}).recommended.sourceId,'muse');
  const r=rank({tasks:[task,expert],mission:m,agents:[agent('codex',{tools:['vivo.world.read']}),agent('dot')]});
  assert.equal(r.recommended.sourceId,'dot');assert.equal(r.candidates.find(c=>c.sourceId==='codex').eligible,false);
});
