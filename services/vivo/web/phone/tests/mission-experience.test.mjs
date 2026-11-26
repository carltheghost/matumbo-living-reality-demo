import test from 'node:test';
import assert from 'node:assert/strict';
import {collectMissionExperience,relatedMissionExperience,taskMissionExperience} from '../mission-experience.mjs';
const step=(sourceId,state='confirmed',extra={})=>({sourceId,state,changed:true,spaceId:'root',entityId:'relic',...extra});
const task=(id,steps=[],extra={})=>({id,sourceId:'muse',closed:false,steps,...extra});
const done={closed:true,completed:true};
const one=(tasks,source='muse')=>collectMissionExperience(tasks).find(p=>p.sourceId===source);
const mission=(receipts=[])=>({dependencies:[{status:'completed',sourceId:'codex',taskId:'prep',receipts}],readyForJournaledEdits:true});

test('operation states remain distinct; missing evidence is not a failure rate',()=>{
  const t=task('a',[step('muse'),step('muse','confirmed',{changed:false}),step('muse','pending'),step('muse','conflict'),step('muse','not-dispatched')]);
  const p=one([t]);assert.deepEqual([p.confirmedChanged,p.confirmedUnchanged,p.pending,p.conflict,p.notDispatched],[1,1,1,1,1]);assert.equal(p.completedContributions,0);assert(!('successRate' in p));
});
test('historical operation author is credited after task handoff, not the final owner',()=>{
  const t=task('a',[step('muse'),step('codex')],{...done,sourceId:'dot'});const rows=collectMissionExperience([t]);
  assert.deepEqual(rows.map(p=>[p.sourceId,p.completedContributions]),[['codex',1],['muse',1]]);assert(!rows.some(p=>p.sourceId==='dot'));
});
test('distinct completed contributions do not grow with repeated operations',()=>{
  const p=one([task('a',Array.from({length:8},()=>step('muse')),done),task('b',[step('muse')],done)]);
  assert.equal(p.confirmedChanged,9);assert.equal(p.completedContributions,2);assert.equal(p.objects[0].completedChangedTasks,2);assert.equal(p.objects[0].changedTasks,2);
});
test('ordinary closed-incomplete work remains separate from owner-completed contributions',()=>{
  const p=one([task('a',[step('muse')],{closed:true}),task('b',[step('muse','not-dispatched')]),task('c',[step('muse')],done)]);
  assert.equal(p.contributedTasks,3);assert.equal(p.closedIncompleteContributions,1);assert.equal(p.completedContributions,1);
});
test('legacy missing source falls back to recorded task source, missing space never becomes a specialty',()=>{
  const p=one([task('a',[step(undefined,'confirmed',{spaceId:undefined})],done)]);assert.equal(p.confirmedChanged,1);assert.equal(p.unknownSpaceOperations,1);assert.deepEqual(p.objects,[]);
});
test('exact object identity separates equal entity names in different spaces',()=>{
  const p=one([task('a',[step('muse'),step('muse','confirmed',{spaceId:'inner'})],done)]);assert.equal(p.objects.length,2);assert.deepEqual(p.objects.map(o=>[o.spaceId,o.completedChangedTasks]),[['inner',1],['root',1]]);
});
test('related ranking distinguishes distinct completed tasks and raw receipt volume',()=>{
  const target=task('target'),m=mission([step('planner')]);
  const r=relatedMissionExperience([target,task('a',Array.from({length:9},()=>step('muse'))),task('b',[step('codex')],done)],target,m);
  assert.equal(r.relatedObjectCount,1);assert.deepEqual(r.history.get('muse'),{relatedChangedReceipts:9,relatedChangedTasks:1,relatedCompletedTasks:0});assert.deepEqual(r.history.get('codex'),{relatedChangedReceipts:1,relatedChangedTasks:1,relatedCompletedTasks:1});
});
test('unrelated, unknown-space, unchanged and uncertain evidence cannot influence related ranking',()=>{
  const target=task('target',[step('muse','pending')]);const rows=[task('a',[step('muse','confirmed',{spaceId:undefined}),step('muse','confirmed',{spaceId:'inner'}),step('muse','confirmed',{changed:false}),step('muse','pending'),step('muse','conflict')])];
  assert.equal(relatedMissionExperience(rows,target,mission([step('planner')])).history.size,0);assert.equal(relatedMissionExperience(rows,target,mission()).relatedObjectCount,0);
});
test('no history means zero related objects and no invented candidate evidence',()=>{
  const r=relatedMissionExperience([task('a',[step('muse')],done)],task('b'),mission());assert.equal(r.relatedObjectCount,0);assert.equal(r.history.size,0);
});
test('agent summaries use only own task and completed direct receipt evidence, including actual source',()=>{
  const own=task('b',[step('dot','pending')]);const result=taskMissionExperience(own,{dependencies:[{taskId:'a',sourceId:'codex',status:'completed',receipts:[{...step('muse'),operationId:'first'}]},{taskId:'private',sourceId:'hidden',status:'waiting',receipts:[step('hidden')]}]});
  assert.equal(result.authorizesAction,false);assert.equal(result.scope,'attached-task-and-completed-direct-prerequisites');assert.deepEqual(result.profiles.map(p=>p.sourceId),['dot','muse']);assert.equal(result.profiles[1].completedContributions,1);assert(!JSON.stringify(result).includes('private'));
});
test('derived experience is detached, deterministic, and changes only as journal evidence changes',()=>{
  const rows=[task('a',[step('muse')]),task('b',[step('codex')],done)],copy=structuredClone(rows);const p=collectMissionExperience(rows);p[0].objects[0].confirmedChanged=99;assert.deepEqual(rows,copy);
  assert.deepEqual(collectMissionExperience(rows),collectMissionExperience(rows.slice().reverse()));rows[0].completed=true;rows[0].closed=true;assert.equal(one(rows).completedContributions,1);
});
