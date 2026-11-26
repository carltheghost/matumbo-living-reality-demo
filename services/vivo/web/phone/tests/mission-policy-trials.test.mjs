import test from 'node:test';
import assert from 'node:assert/strict';
import {registerPolicyTrial,validatePolicyHistory,evaluatePolicyTrial,summarizePolicyTrials} from '../mission-policy-trials.mjs';
import {forecastMissionEvidence} from '../mission-forecast.mjs';
import {registerMissionExperiment,captureExperimentForecast} from '../mission-experiment.mjs';
const obj=(entityId,spaceId='root')=>({spaceId,entityId});
const scope={worldId:'world',projectId:'main'};
const step=(operationId,entityId,extra={})=>({operationId,entityId,spaceId:'root',state:'confirmed',sourceId:'muse',revision:1,changed:false,sha256:'a'.repeat(64),...extra});
const source=(id,objects)=>({id,sourceId:'muse',epoch:1,closed:true,completed:true,steps:objects.map((o,i)=>step(id+':'+i,o))});
const history=(support,total)=>Array.from({length:total},(_,i)=>source('history'+i,i<support?['cue','next']:['cue','alternative']));
const report=(support,total)=>forecastMissionEvidence({scope,tasks:history(support,total),args:obj('cue')});
const spec={cue:obj('cue'),hypotheses:[obj('next'),obj('alternative')],captureForecast:true};
const trial=(id,support,total,outcome=null)=>{
 const t={id,sourceId:'muse',epoch:1,closed:false,steps:[]},r=report(support,total);
 registerMissionExperiment(t,spec,captureExperimentForecast(r,spec.cue));registerPolicyTrial(t,r);
 if(outcome!==null){t.closed=true;t.completed=true;t.steps=outcome==='terminal'?[step(id+':cue','cue')]:outcome==='missing'?[step(id+':other','other')]:[step(id+':cue','cue'),step(id+':next',outcome)];}
 return t;
};
test('all three policy versions use one shared historical aggregate and current rule matches baseline',()=>{
 const t=trial('a',3,3);assert.deepEqual(t.policyTrial.decisions.map(r=>[r.policyId,r.suggestion?.entityId??null]),[['baseline/1','next'],['exploratory/1','next'],['selective/1',null]]);
 assert(!JSON.stringify(t.policyTrial).includes('history0'));assert.equal(t.policyTrial.matchingTasks,3);
 assert.equal(t.experiment.forecast.suggestion.entityId,'next');
});
test('exploratory threshold permits two agreeing tasks while ties and no evidence abstain',()=>{
 const a=trial('a',2,2),b=trial('b',2,4),c=trial('c',0,0);
 assert.deepEqual(a.policyTrial.decisions.map(r=>!!r.suggestion),[false,true,false]);
 for(const t of [b,c])assert(t.policyTrial.decisions.every(r=>r.suggestion===null));
});
test('selective rule requires four supports and at least two thirds of all matching tasks',()=>{
 assert.deepEqual(trial('a',4,6).policyTrial.decisions.map(r=>!!r.suggestion),[true,true,true]);
 assert.deepEqual(trial('b',4,7).policyTrial.decisions.map(r=>!!r.suggestion),[true,true,false]);
});
test('registration rejects missing baseline, late operations and duplicate trial',()=>{
 const a=trial('a',3,3);
 assert.throws(()=>registerPolicyTrial(a,report(3,3)),{code:'POLICY_TRIAL_REGISTRATION_INVALID'});
 const late={...a,policyTrial:undefined,steps:[step('late','cue')]};
 assert.throws(()=>registerPolicyTrial(late,report(3,3)),{code:'POLICY_TRIAL_REGISTRATION_INVALID'});
 assert.throws(()=>registerPolicyTrial({id:'b',steps:[]},report(3,3)),{code:'POLICY_TRIAL_REGISTRATION_INVALID'});
});
test('forecast or policy metadata tampering rejects mismatched decisions and arbitrary fields',()=>{
 const a=trial('a',3,3);
 assert.throws(()=>registerPolicyTrial({...a,policyTrial:undefined},report(2,2)),{code:'POLICY_TRIAL_FORECAST_MISMATCH'});
 for(const change of [p=>p.decisions.reverse(),p=>p.decisions[2].suggestion=p.top,p=>p.top.supportingTasks=4,p=>p.sourceTaskIds=['private'],p=>p.policySet='future/2']){
  const t=trial('a',3,3);change(t.policyTrial);assert.throws(()=>validatePolicyHistory({tasks:[t]}),{code:'POLICY_TRIAL_STORAGE_INVALID'});
 }
});
test('prospective contradiction preserves baseline and challenger decisions',()=>{
 const t=trial('a',3,3,'alternative'),r=evaluatePolicyTrial(t);
 assert.deepEqual(r.results.map(x=>x.outcome),['incorrect','incorrect','abstained']);assert.equal(t.policyTrial.decisions[0].suggestion.entityId,'next');
 assert.equal(r.authorizesAction,false);
});
test('pending, missing-cue and archived trials are not counted in evaluated denominators',()=>{
 const a=trial('a',3,3),b=trial('b',3,3,'missing'),c=trial('c',3,3);c.closed=true;
 const r=summarizePolicyTrials([a,b,c,trial('d',3,3,'terminal')]);
 assert.deepEqual(r.counts,{registered:4,evaluated:1,pending:1,inconclusive:1,archivedIncomplete:1});
 assert.equal(r.policies[0].incorrect,1);assert.equal(r.policies[2].abstained,1);assert.equal(r.reviewCandidate,null);
});
test('paired review flags selective challenger only after sufficient observations and utility gain',()=>{
 const tasks=[...Array.from({length:4},(_,i)=>trial('correct'+i,4,4,'next')),...Array.from({length:4},(_,i)=>trial('wrong'+i,3,3,'alternative'))];
 const r=summarizePolicyTrials(tasks);
 assert.equal(r.reviewCandidate,'selective/1');assert.equal(r.activePolicyId,'baseline/1');assert.equal(r.automaticPromotion,false);
 assert.deepEqual(r.policies.map(p=>[p.correct,p.incorrect,p.abstained,p.utility]),[[4,4,0,-4],[4,4,0,-4],[4,0,4,4]]);
 assert.equal(r.policies[2].paired.avoidedIncorrect,4);assert.equal(r.policies[2].coverage,0.5);
 assert.equal(summarizePolicyTrials(tasks.slice(0,7)).reviewCandidate,null);
});
test('exploratory challenger can improve useful coverage without more wrong predictions',()=>{
 const tasks=Array.from({length:8},(_,i)=>trial('t'+i,2,2,'next'));
 const r=summarizePolicyTrials(tasks);
 assert.equal(r.reviewCandidate,'exploratory/1');assert.equal(r.policies[1].paired.extraCorrect,8);assert.equal(r.policies[0].accuracyOnPredictions,null);
});
test('extra wrong suggestions prevent review even when utility rises',()=>{
 const tasks=Array.from({length:8},(_,i)=>trial('t'+i,2,2,i===7?'alternative':'next'));
 const r=summarizePolicyTrials(tasks);assert.equal(r.reviewCandidate,null);assert(r.challengers[0].reasons.includes('MORE_INCORRECT_SUGGESTIONS'));assert.equal(r.policies[1].utility,5);
});
test('no trials or all abstentions do not manufacture accuracy or promote a rule',()=>{
 const a=summarizePolicyTrials([]);assert.equal(a.policies[0].accuracyOnPredictions,null);assert.equal(a.policies[0].coverage,null);
 const r=summarizePolicyTrials(Array.from({length:8},(_,i)=>trial('t'+i,1,1,'next')));
 assert.equal(r.reviewStatus,'retain-baseline');assert.equal(r.reviewCandidate,null);assert(r.policies.every(p=>p.predictions===0&&p.accuracyOnPredictions===null));
});
test('policy reports are derived deterministically without rewriting the original registration',()=>{
 const tasks=[trial('a',4,6,'next'),trial('b',3,3,'alternative')],before=JSON.stringify(tasks);
 const r=summarizePolicyTrials(tasks);assert.deepEqual(summarizePolicyTrials(tasks),r);assert.equal(JSON.stringify(tasks),before);assert.equal(r.calibratedProbability,false);
});
