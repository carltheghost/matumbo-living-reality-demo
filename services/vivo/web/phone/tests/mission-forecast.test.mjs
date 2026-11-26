import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastMissionEvidence,normalizeMissionForecast} from '../mission-forecast.mjs';
const scope={worldId:'world',projectId:'branch'},args={spaceId:'root',entityId:'cue'};
const step=(operationId,entityId,extra={})=>({operationId,entityId,spaceId:'root',state:'confirmed',sourceId:'muse',revision:1,changed:true,sha256:'a'.repeat(64),...extra});
const task=(id,objects,extra={})=>({id,sourceId:'owner',completed:true,closed:true,steps:objects.map((o,i)=>typeof o==='string'?step(id+':'+i,o):step(id+':'+i,o.entityId,o)),...extra});
const run=(tasks,q=args)=>forecastMissionEvidence({scope,tasks,args:q});
const pair=(id,to='next')=>task(id,['cue',to]);
test('three consistent distinct task rows meet conservative suggestion policy',()=>{
 const r=run([pair('a'),pair('b'),pair('c')]);assert.equal(r.status,'suggested');assert.deepEqual(r.suggestion,{spaceId:'root',entityId:'next',supportingTasks:3,kind:'inspect-next-object'});assert.equal(r.counts.matchingTasks,3);assert.equal(r.candidates[0].historicalShare,1);assert.equal(r.authorizesAction,false);assert.equal(r.calibratedProbability,false);assert.equal(r.causalityProven,false);
});
test('repeated cue observations in one task never become multiple votes',()=>{
 const r=run([task('a',['cue','next','cue','next','cue','next'])]);assert.equal(r.counts.objectVotes,1);assert.equal(r.candidates[0].supportingTasks,1);assert.equal(r.reason,'INSUFFICIENT_DISTINCT_TASKS');assert.equal(r.suggestion,null);
});
test('multiple inconsistent next observations within one task are ambiguous',()=>{
 const r=run([task('a',['cue','next','cue','other']),task('b',['cue','next','cue']),pair('c')]);assert.equal(r.counts.ambiguous,2);assert.equal(r.counts.objectVotes,1);assert.deepEqual(r.candidates[0].possibleShareIfUncertainResolved,[1/3,1]);assert.equal(r.status,'abstain');
});
test('terminal and unknown are separate and no gaps are bridged',()=>{
 const r=run([task('a',['cue']),task('b',['cue',{entityId:'hidden',state:'not-dispatched'},'next']),task('c',['cue',{entityId:'next',spaceId:undefined}]),pair('d')]);assert.deepEqual(r.counts,{matchingTasks:4,objectVotes:1,terminal:1,unknown:2,ambiguous:0});assert.equal(r.candidates.length,1);assert.equal(r.status,'abstain');
});
test('competing equal patterns abstain; majority includes terminal and uncertain tasks',()=>{
 const rows=[pair('a'),pair('b'),pair('c'),pair('d','other'),pair('e','other'),task('f',['cue'])];const r=run(rows);assert.equal(r.reason,'NO_STRICT_MAJORITY');assert.deepEqual(r.candidates.map(c=>c.supportingTasks),[3,2]);assert.equal(run(rows.slice(0,5)).status,'suggested');
});
test('exact spaces distinguish cue and next object; source attribution remains original',()=>{
 const rows=[task('a',['cue',{entityId:'next',spaceId:'inner',sourceId:'dot'}]),task('b',[{entityId:'cue',spaceId:'inner'},'other'])];const r=run(rows);assert.equal(r.counts.matchingTasks,1);assert.equal(r.candidates[0].spaceId,'inner');assert.equal(r.candidates[0].witnesses[0].to.sourceId,'dot');assert.equal(run(rows,{spaceId:'inner',entityId:'cue'}).candidates[0].entityId,'other');
});
test('no cue and only terminal evidence abstain without invented outcomes',()=>{
 assert.equal(run([task('a',['other'])]).reason,'NO_MATCHING_TASKS');const r=run(['a','b','c'].map(id=>task(id,['cue'])));assert.equal(r.reason,'NO_OBSERVED_NEXT_OBJECT');assert.equal(r.retrospective.evaluated,0);assert.equal(r.retrospective.observedAccuracy,null);
});
test('retrospective holdout excludes the entire task and reports coverage as well as accuracy',()=>{
 const r=run([pair('a'),pair('b'),pair('c'),pair('d'),pair('e','other')]);assert.deepEqual([r.retrospective.eligible,r.retrospective.evaluated,r.retrospective.correct,r.retrospective.abstained,r.retrospective.observedAccuracy],[5,5,4,0,0.8]);const sparse=run([pair('a'),pair('b'),pair('c')]);assert.equal(sparse.retrospective.evaluated,0);assert.equal(sparse.retrospective.observedAccuracy,null);
});
test('forecast validates complete source tasks and unique receipt IDs; unknown input keys reject',()=>{
 for(const tasks of [[task('a',['cue'],{completed:false})],[task('a',['cue',{entityId:'next',state:'pending'}])],[pair('a'),pair('a')],[task('a',['cue',{entityId:'next',sha256:'bad'}])]])assert.throws(()=>run(tasks),{code:'MISSION_FORECAST_EVIDENCE_INVALID'});
 for(const q of [{...args,worldId:'other'},{...args,sourceTaskIds:['a']},{spaceId:'root',entityId:''},null])assert.throws(()=>normalizeMissionForecast(q),{code:'MISSION_FORECAST_ARGUMENTS_INVALID'});
});
test('maximum grant is bounded, deterministic and does not mutate evidence',()=>{
 const rows=Array.from({length:15},(_,i)=>task('t'+i,Array.from({length:64},(_,j)=>j%2?'next':'cue'))),before=structuredClone(rows);const r=run(rows);assert.equal(r.counts.matchingTasks,15);assert.equal(r.candidates[0].supportingTasks,15);assert.equal(r.candidates[0].witnesses.length,15);assert.deepEqual(run([...rows].reverse()),r);r.candidates[0].witnesses[0].to.revision=999;assert.deepEqual(rows,before);assert.equal(r.retrospective.correct,15);
});
