import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleMemory} from '../constructive-memory.mjs';
import {normalizeMissionTrace,traceMissionEvidence} from '../mission-associations.mjs';
const scope={worldId:'world',projectId:'branch'};
const step=(operationId,entityId,extra={})=>({operationId,spaceId:'root',entityId,sourceId:'muse',sha256:'a'.repeat(64),revision:2,changed:true,state:'confirmed',...extra});
const task=(id,steps,dependsOn=[])=>({id,sourceId:'codex',closed:true,completed:true,steps,dependsOn});
const obj=(entityId,spaceId='root')=>({spaceId,entityId});
const trace=(tasks,from='a',to='b',maxHops=6)=>traceMissionEvidence({scope,tasks,args:{from:typeof from==='string'?obj(from):from,to:typeof to==='string'?obj(to):to,maxHops}});
const pair=[task('one',[step('a1','a')]),task('two',[step('b1','b',{sourceId:'dot'})],['one'])];
test('co-observation produces two receipt-backed hops, without claiming causality',()=>{
 const r=trace([task('one',[step('a1','a'),step('b1','b')])]);assert.equal(r.status,'matched');assert.equal(r.hopCount,2);assert.deepEqual(r.hops.map(h=>h.relation),['observed-in','observed-object']);assert.deepEqual(r.hops.map(h=>h.evidence.operationId),['a1','b1']);assert.equal(r.causalityProven,false);assert.equal(r.authorizesAction,false);assert.equal(r.learned,false);assert.deepEqual(r.circuitTrace.map(t=>t.bank),[0,1]);
});
test('declared dependency yields a directed prerequisite hop and exact reverse relation',()=>{
 const a=trace(pair),b=trace(pair,'b','a');assert.deepEqual(a.hops.map(h=>h.relation),['observed-in','prerequisite-of','observed-object']);assert.deepEqual(a.hops[1].evidence,{kind:'declared-prerequisite',prerequisiteTaskId:'one',dependentTaskId:'two'});assert.equal(a.hops[2].evidence.sourceId,'dot');assert.deepEqual(a.circuitTrace.map(t=>t.bank),[0,2,1]);assert.deepEqual(b.circuitTrace.map(t=>t.bank),[0,3,1]);
});
test('multiple completed prerequisites form a multi-hop path within an explicit bound',()=>{
 const rows=[task('one',[step('a1','a')]),task('middle',[step('c1','c')],['one']),task('two',[step('b1','b')],['middle'])];assert.equal(trace(rows,'a','b',3).reason,'NO_SHARED_PATH_WITHIN_BOUND');const r=trace(rows,'a','b',4);assert.equal(r.hopCount,4);assert.equal(r.circuitTrace.at(-1).to,5);
});
test('unapproved prerequisite or bridging task cannot be used or exposed',()=>{
 const rows=[task('one',[step('a1','a')]),task('two',[step('b1','b')],['private-task'])];const r=trace(rows);assert.equal(r.reason,'NO_SHARED_PATH_WITHIN_BOUND');assert(!JSON.stringify(r).includes('private-task'));assert.equal(trace(rows,'a','hidden').reason,'OBJECT_NOT_IN_SHARED_EVIDENCE');
});
test('equal entity names in different spaces are not identical object keys',()=>{
 const rows=[task('one',[step('a1','a')]),task('two',[step('a2','a',{spaceId:'inner'})])];assert.equal(trace(rows,obj('a'),obj('a','inner')).reason,'NO_SHARED_PATH_WITHIN_BOUND');assert.equal(trace(rows,obj('a'),obj('a')).reason,'SAME_OBJECT_USE_RECALL');
});
test('legacy unknown spaces and non-dispatched operations cannot create connections',()=>{
 const rows=[task('one',[step('a1','a'),step('b1','b',{spaceId:undefined}),step('b2','b',{state:'not-dispatched'})])];assert.equal(trace(rows).reason,'OBJECT_NOT_IN_SHARED_EVIDENCE');
});
test('shortest path and receipt witness selection are deterministic even if input order changes',()=>{
 const rows=[...pair,task('three',[step('z','a'),step('x','a'),step('b2','b')])];const r=trace(rows);assert.equal(r.hopCount,2);assert.equal(r.hops[0].evidence.operationId,'x');const reversed=rows.map(t=>({...t,steps:[...t.steps].reverse()})).reverse();assert.deepEqual(trace(reversed),r);
});
test('invalid or duplicate completed evidence rejects the entire query',()=>{
 for(const rows of [[task('one',[step('x','a')]),task('one',[step('y','b')])],[task('one',[step('x','a'),step('x','b')])],[task('one',[step('x','a'),step('y','b',{sha256:'invalid'})])],[{...pair[0],completed:false}],[task('one',[step('x','a'),step('y','b',{state:'pending'})])]])assert.throws(()=>trace(rows),{code:'MISSION_TRACE_EVIDENCE_INVALID'});
});
test('exact argument contract prevents foreign scopes, task IDs, malformed endpoints and oversized search',()=>{
 for(const args of [{from:obj('a'),to:obj('b'),worldId:'other'},{from:{...obj('a'),taskId:'one'},to:obj('b')},{from:obj('a'),to:obj('b'),maxHops:9},{from:obj('a'),to:obj('b'),maxHops:0},{from:obj(''),to:obj('b')},null])assert.throws(()=>normalizeMissionTrace(args),{code:'MISSION_TRACE_ARGUMENTS_INVALID'});
});
test('maximum 960 approved receipt entries are searchable with bounded circuit replay',()=>{
 const rows=Array.from({length:15},(_,i)=>task('task'+i,Array.from({length:64},(_,j)=>step(i+':'+j,'obj'+(i*64+j))),i?['task'+(i-1)]:[]));
 const r=trace(rows,'obj0','obj127',3);assert.equal(r.hopCount,3);assert.equal(r.hops[2].evidence.operationId,'1:63');assert.equal(trace(rows,'obj0','obj959',8).reason,'NO_SHARED_PATH_WITHIN_BOUND');
});
test('no mutation or replacement of owner numeric memory, and abstention reveals no proof path',()=>{
 const rows=structuredClone(pair),before=structuredClone(rows),lab=exampleMemory(scope),checkpoint=lab.checkpoint();const r=trace(rows);r.hops[0].evidence.revision=999;assert.deepEqual(rows,before);assert.deepEqual(lab.checkpoint(),checkpoint);assert.equal(lab.query({scope,start:17,path:[0,1,2,3]}).value,7);assert.deepEqual(trace(rows,'a','b',2).hops,[]);
});
