import test from 'node:test';
import assert from 'node:assert/strict';
import {TASK_JOURNAL_SCHEMA,LEGACY_TASK_JOURNAL_SCHEMA,normalizePrerequisites,validateMissionGraph,addPrerequisites,assertMissionReady,completeMissionTask,missionView} from '../mission-graph.mjs';
const step=(operationId='op',state='confirmed')=>({operationId,entityId:'relic',sourceId:'muse',state,sha256:'a'.repeat(64),revision:1,changed:true});
const task=(id,steps=[])=>({id,title:id,sourceId:'muse',closed:false,steps});
const graph=(...tasks)=>({schema:TASK_JOURNAL_SCHEMA,tasks});
const code=x=>({code:x});

test('legacy journal migrates without discarding evidence or marking closed tasks complete',()=>{
 const a={...task('a',[step()]),closed:true},j={schema:LEGACY_TASK_JOURNAL_SCHEMA,tasks:[a]};const old=structuredClone(a);
 assert.equal(validateMissionGraph(j).schema,TASK_JOURNAL_SCHEMA);assert.deepEqual(a,old);assert.equal(missionView(j,a).state,'closed-incomplete');
});
test('legacy storage cannot inject dependency or completion fields',()=>{
 for(const extra of [{dependsOn:[]},{completed:true}])assert.throws(()=>validateMissionGraph({schema:LEGACY_TASK_JOURNAL_SCHEMA,tasks:[{...task('a'),...extra}]}),code('TASK_STORAGE_INVALID'));
});
test('prerequisites are bounded, unique, dense and detached from caller arrays',()=>{
 const ids=['a','b'],copy=normalizePrerequisites(ids);ids.push('c');assert.deepEqual(copy,['a','b']);
 for(const invalid of [null,'a',['a','a'],Array(2),Array.from({length:16},(_,i)=>String(i)),['']])assert.throws(()=>normalizePrerequisites(invalid),code('TASK_DEPENDENCIES_INVALID'));
});
test('new tasks link only existing prerequisite IDs, never self or a missing task',()=>{
 const a=task('a'),b=task('b'),j=graph(a);
 assert.throws(()=>addPrerequisites(j,b,['b']),code('TASK_DEPENDENCIES_INVALID'));assert.throws(()=>addPrerequisites(j,b,['missing']),code('TASK_DEPENDENCIES_INVALID'));
 addPrerequisites(j,b,['a']);j.tasks.push(b);assert.equal(validateMissionGraph(j),j);assert.equal(missionView(j,b).state,'blocked');
});
test('stored cycles, dangling edges and self references fail closed',()=>{
 for(const tasks of [[{...task('a'),dependsOn:['a']}],[{...task('a'),dependsOn:['missing']}],[{...task('a'),dependsOn:['b']},{...task('b'),dependsOn:['a']}]])assert.throws(()=>validateMissionGraph(graph(...tasks)),code('TASK_STORAGE_INVALID'));
});
test('parallel prerequisites must all be explicitly completed before downstream work',()=>{
 const a=task('a',[step('1')]),b=task('b',[step('2')]),c={...task('c'),dependsOn:['a','b']},j=graph(a,b,c);
 assert.throws(()=>assertMissionReady(j,c),code('TASK_PREREQUISITES_INCOMPLETE'));completeMissionTask(j,a);
 assert.equal(missionView(j,c).readyForJournaledEdits,false);completeMissionTask(j,b);assert.equal(missionView(j,c).readyForJournaledEdits,true);assertMissionReady(j,c);
});
test('archiving a prerequisite is not completion even if it has receipts',()=>{
 const a={...task('a',[step()]),closed:true},b={...task('b'),dependsOn:['a']},j=graph(a,b);
 assert.equal(missionView(j,b).dependencies[0].status,'closed-incomplete');assert.deepEqual(missionView(j,b).dependencies[0].receipts,[]);assert.throws(()=>assertMissionReady(j,b),code('TASK_PREREQUISITES_INCOMPLETE'));
});
test('completion needs at least one confirmed receipt, no unresolved work and all dependencies',()=>{
 const a=task('a'),j=graph(a);assert.throws(()=>completeMissionTask(j,a),code('TASK_EVIDENCE_REQUIRED'));
 a.steps.push(step('1','pending'));assert.throws(()=>completeMissionTask(j,a),code('TASK_RECONCILIATION_REQUIRED'));a.steps[0].state='conflict';assert.throws(()=>completeMissionTask(j,a),code('TASK_RECONCILIATION_REQUIRED'));
 a.steps[0].state='confirmed';completeMissionTask(j,a);assert.equal(a.closed,true);assert.equal(a.completed,true);assert.throws(()=>completeMissionTask(j,a),code('TASK_ALREADY_CLOSED'));
});
test('forged completion without matching evidence or completed dependencies is invalid',()=>{
 const a=task('a'),b={...task('b',[step()]),closed:true,completed:true,dependsOn:['a']};
 assert.throws(()=>validateMissionGraph(graph(a,b)),code('TASK_STORAGE_INVALID'));assert.throws(()=>validateMissionGraph(graph({...a,closed:true,completed:true})),code('TASK_STORAGE_INVALID'));
});
test('only direct completed dependency receipt metadata is shared and detached',()=>{
 const a=task('a',[step('a')]),b={...task('b',[{...step('b'),sourceId:'codex'}]),dependsOn:['a']},c={...task('c'),dependsOn:['b']},privateTask=task('private',[step('private')]),j=graph(a,b,c,privateTask);
 completeMissionTask(j,a);completeMissionTask(j,b);completeMissionTask(j,privateTask);
 const view=missionView(j,c);assert.equal(view.authorizesAction,false);assert.equal(view.dependencies.length,1);assert.equal(view.dependencies[0].taskId,'b');assert.equal(view.dependencies[0].receipts[0].sourceId,'codex');assert.equal(view.dependencies[0].receipts[0].operationId,'b');assert(!JSON.stringify(view).includes('private'));view.dependencies[0].receipts[0].revision=9;assert.equal(b.steps[0].revision,1);
});
