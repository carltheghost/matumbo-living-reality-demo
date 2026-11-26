import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeExperimentSpec,parseExperimentHypotheses,captureExperimentForecast,registerMissionExperiment,validateExperimentHistory,evaluateMissionExperiment,summarizeExperiments} from '../mission-experiment.mjs';
import {forecastMissionEvidence} from '../mission-forecast.mjs';
const obj=(entityId,spaceId='root')=>({spaceId,entityId});
const spec=(captureForecast=false)=>({cue:obj('cue'),hypotheses:[obj('next'),obj('alternative')],captureForecast});
const step=(operationId,entityId,extra={})=>({operationId,entityId,spaceId:'root',state:'confirmed',sourceId:'muse',revision:1,changed:false,sha256:'a'.repeat(64),...extra});
const task=(id='t',extra={})=>({id,sourceId:'muse',epoch:1,closed:false,steps:[],...extra});
const completed=(t,steps)=>({...t,closed:true,completed:true,steps});
const registered=(input=spec(),forecast=null,id='t')=>{const t=task(id);registerMissionExperiment(t,input,forecast);return t;};
const scope={worldId:'world',projectId:'main'};
const historic=Array.from({length:3},(_,i)=>completed(task('h'+i),[step(i+':cue','cue'),step(i+':next','next')]));
const capture=()=>captureExperimentForecast(forecastMissionEvidence({scope,tasks:historic,args:obj('cue')}),obj('cue'));

test('registration is copied, one-shot, and only before any recorded operation',()=>{
 const input=spec(),t=registered(input);input.hypotheses[0].entityId='tampered';assert.equal(t.experiment.hypotheses[0].entityId,'next');
 assert.throws(()=>registerMissionExperiment(t,spec()),{code:'EXPERIMENT_ALREADY_REGISTERED'});
 for(const target of [task('x',{closed:true}),task('x',{steps:[step('op','cue',{state:'not-dispatched'})]})])assert.throws(()=>registerMissionExperiment(target,spec()),{code:'EXPERIMENT_TOO_LATE'});
});
test('exact unique hypotheses and bounded line parser reject malformed input',()=>{
 assert.deepEqual(parseExperimentHypotheses('root | next\n inner | alternative'),[obj('next'),obj('alternative','inner')]);
 assert.throws(()=>parseExperimentHypotheses('a|b|c'),{code:'EXPERIMENT_SPEC_INVALID'});
 for(const input of [{cue:obj('cue'),hypotheses:[obj('next'),obj('next')]},{...spec(),scope:'other'},{...spec(),captureForecast:null},{...spec(),hypotheses:[obj('x')]},{...spec(),hypotheses:[obj('x'),{...obj('y'),taskId:'other'}]}])assert.throws(()=>normalizeExperimentSpec(input),{code:'EXPERIMENT_SPEC_INVALID'});
});
test('primary and competing hypothesis evaluated against completed receipt sequence',()=>{
 const t=registered(),r=evaluateMissionExperiment(completed(t,[step('a','cue'),step('b','alternative',{sourceId:'dot'})]));
 assert.equal(r.status,'evaluated');assert.equal(r.primaryOutcome,'incorrect');assert.deepEqual(r.hypotheses.map(h=>h.result),['contradicted','supported']);
 assert.equal(r.observation.to.operationId,'b');assert.equal(r.observation.to.sourceId,'dot');assert.equal(r.authorizesAction,false);assert.equal(r.causalityProven,false);
});
test('terminal observation contradicts object hypotheses only after completion',()=>{
 const t=registered();t.steps=[step('a','cue')];assert.equal(evaluateMissionExperiment(t).status,'pending');
 const r=evaluateMissionExperiment(completed(t,t.steps));assert.equal(r.primaryOutcome,'incorrect');assert.equal(r.observation.kind,'terminal');assert.equal(r.observation.from.operationId,'a');
});
test('missing, ambiguous and unknown next entry remain inconclusive',()=>{
 for(const [steps,reason] of [[[step('a','different')],'NO_CONFIRMED_CUE'],[[step('a','cue'),step('b','next'),step('c','cue'),step('d','alternative')],'AMBIGUOUS_SEQUENCE'],[[step('a','cue'),step('b','next',{state:'not-dispatched'}),step('c','next')],'UNKNOWN_NEXT_ENTRY'],[[step('a','cue'),step('b','next',{spaceId:undefined})],'UNKNOWN_NEXT_ENTRY']]){
  const r=evaluateMissionExperiment(completed(registered(),steps));assert.equal(r.status,'inconclusive');assert.equal(r.reason,reason);assert(r.hypotheses.every(h=>h.result==='undetermined'));
 }
});
test('archived incomplete is separate and unresolved receipts never score as predictions',()=>{
 const t=registered();t.steps=[step('a','cue',{state:'pending'})];assert.equal(evaluateMissionExperiment(t).reason,'UNRESOLVED_RECEIPTS');t.closed=true;assert.equal(evaluateMissionExperiment(t).status,'archived-incomplete');
});
test('captured forecast contains only approved aggregate counts and compares with future observation',()=>{
 const f=capture();assert.deepEqual(f,{status:'suggested',matchingTasks:3,reason:null,suggestion:{spaceId:'root',entityId:'next',supportingTasks:3}});
 const t=registered(spec(true),f),r=evaluateMissionExperiment(completed(t,[step('a','cue'),step('b','next')]));
 assert.equal(r.primaryOutcome,'correct');assert.equal(r.forecastOutcome,'correct');assert.equal(JSON.stringify(t.experiment).includes('h0'),false);
 f.suggestion.entityId='modified';assert.equal(t.experiment.forecast.suggestion.entityId,'next');
});
test('abstained historical forecast never counts as an incorrect prediction',()=>{
 const f=captureExperimentForecast(forecastMissionEvidence({scope,tasks:historic.slice(0,1),args:obj('cue')}),obj('cue'));
 const r=evaluateMissionExperiment(completed(registered(spec(true),f),[step('a','cue'),step('b','next')]));
 assert.equal(r.forecastOutcome,'abstained');assert.equal(r.primaryOutcome,'correct');
});
test('history validation pins original registration source across handoff',()=>{
 const t=registered();t.epoch=2;t.sourceId='dot';t.handoffs=[{from:'muse',to:'dot',epoch:2}];assert.equal(validateExperimentHistory({tasks:[t]}).tasks[0],t);
 t.experiment.registeredSourceId='dot';assert.throws(()=>validateExperimentHistory({tasks:[t]}),{code:'EXPERIMENT_STORAGE_INVALID'});
});
test('invalid storage cannot inject extra fields, false support or future registration epoch',()=>{
 for(const modify of [e=>{e.registeredEpoch=2;},e=>{e.forecast.suggestion.supportingTasks=4;},e=>{e.forecast.sourceTaskIds=['private'];},e=>{e.hypotheses[1]=e.hypotheses[0];},e=>{e.rule='skip-gaps';}]){
  const t=registered(spec(true),capture());modify(t.experiment);assert.throws(()=>validateExperimentHistory({tasks:[t]}),{code:'EXPERIMENT_STORAGE_INVALID'});
 }
});
test('summary counts each task once and keeps pending, abstained and inconclusive apart',()=>{
 const a=completed(registered(spec(true),capture(),'a'),[step('a1','cue'),step('a2','next')]),b=completed(registered(spec(),null,'b'),[step('b1','cue'),step('b2','alternative')]),c=registered(spec(),null,'c'),d=completed(registered(spec(),null,'d'),[step('d1','other')]),e=registered(spec(),null,'e');e.closed=true;
 const r=summarizeExperiments([a,b,c,d,e,task('unregistered')]);assert.deepEqual(r.counts,{registered:5,pending:1,archivedIncomplete:1,inconclusive:1,evaluated:2,primaryCorrect:1,primaryIncorrect:1,forecastCaptured:1,forecastAbstained:0,forecastEvaluated:1,forecastCorrect:1,forecastIncorrect:0});assert.equal(r.calibratedProbability,false);
});
test('forecast and outcome use exact space identity and repeated consistent cue votes only once',()=>{
 const t=registered(),r=evaluateMissionExperiment(completed(t,[step('a','cue',{spaceId:'other'}),step('b','alternative'),step('c','cue'),step('d','next'),step('e','cue'),step('f','next')]));
 assert.equal(r.primaryOutcome,'correct');assert.equal(r.observation.from.operationId,'c');
});
