/** Fixed, versioned shadow policies evaluated against preregistered future observations. */
import {captureExperimentForecast,evaluateMissionExperiment} from './mission-experiment.mjs';
const SCHEMA='vivo.forecast-policy-trial/1',SET='next-object-thresholds/1';
const RULES=Object.freeze([
  Object.freeze({id:'baseline/1',minimumSupport:3,numerator:1,denominator:2,strict:true}),
  Object.freeze({id:'exploratory/1',minimumSupport:2,numerator:1,denominator:2,strict:true}),
  Object.freeze({id:'selective/1',minimumSupport:4,numerator:2,denominator:3,strict:false}),
]);
const REVIEW=Object.freeze({minimumEvaluated:8,minimumPredictions:4,minimumUtilityGain:2,correctUtility:1,incorrectUtility:-2,abstainUtility:0});
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const id=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f]/.test(x);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=15;
const validTop=(top,n)=>top===null||exact(top,['spaceId','entityId','supportingTasks'])&&id(top.spaceId)&&id(top.entityId)&&count(top.supportingTasks)&&top.supportingTasks>=1&&top.supportingTasks<=n;
const sameTop=(a,b)=>a===null?b===null:b!==null&&a.spaceId===b.spaceId&&a.entityId===b.entityId&&a.supportingTasks===b.supportingTasks;
const sameObject=(a,b)=>a!==null&&b!==null&&a.spaceId===b.spaceId&&a.entityId===b.entityId;
function decisions(n,top){
  return RULES.map(rule=>{
    const enough=top&&top.supportingTasks>=rule.minimumSupport;
    const left=top?top.supportingTasks*rule.denominator:0,right=n*rule.numerator;
    const passes=enough&&(rule.strict?left>right:left>=right);
    return {policyId:rule.id,suggestion:passes?{...top}:null};
  });
}
// Called only inside the host's existing experiment transaction. Persist one
// explicitly consented aggregate (top candidate and count), not source IDs,
// session identities, raw receipts, or arbitrary caller-supplied predictions.
export function registerPolicyTrial(task,report){
  need(task.experiment?.forecast&&task.policyTrial===undefined&&!task.closed&&task.completed!==true&&task.steps.length===0,'POLICY_TRIAL_REGISTRATION_INVALID');
  const summary=captureExperimentForecast(report,task.experiment.cue),stored=task.experiment.forecast;
  need(summary.status===stored.status&&summary.matchingTasks===stored.matchingTasks&&summary.reason===stored.reason&&sameTop(summary.suggestion,stored.suggestion)&&Array.isArray(report.candidates),'POLICY_TRIAL_FORECAST_MISMATCH');
  const n=summary.matchingTasks,first=report.candidates[0];
  const top=first?{spaceId:first.spaceId,entityId:first.entityId,supportingTasks:first.supportingTasks}:null;
  need(validTop(top,n),'POLICY_TRIAL_FORECAST_MISMATCH');
  const rows=decisions(n,top);
  need(sameTop(rows[0].suggestion,stored.suggestion),'POLICY_TRIAL_FORECAST_MISMATCH');
  task.policyTrial={schema:SCHEMA,policySet:SET,matchingTasks:n,top,decisions:rows};
  return task.policyTrial;
}
export function validatePolicyHistory(journal){
  for(const t of journal.tasks){
    if(t.policyTrial===undefined)continue;
    const p=t.policyTrial,f=t.experiment?.forecast;
    need(f&&exact(p,['schema','policySet','matchingTasks','top','decisions'])&&p.schema===SCHEMA&&p.policySet===SET&&count(p.matchingTasks)&&p.matchingTasks===f.matchingTasks&&validTop(p.top,p.matchingTasks)&&Array.isArray(p.decisions)&&p.decisions.length===RULES.length,'POLICY_TRIAL_STORAGE_INVALID');
    const expected=decisions(p.matchingTasks,p.top);
    need(sameTop(expected[0].suggestion,f.suggestion)&&Array.from(p.decisions).every((row,i)=>exact(row,['policyId','suggestion'])&&row.policyId===expected[i].policyId&&validTop(row.suggestion,p.matchingTasks)&&sameTop(expected[i].suggestion,row.suggestion)),'POLICY_TRIAL_STORAGE_INVALID');
  }
  return journal;
}
export function evaluatePolicyTrial(task){
  if(task.policyTrial===undefined)return null;
  const experiment=evaluateMissionExperiment(task),trial=task.policyTrial;
  const results=trial.decisions.map(row=>({policyId:row.policyId,suggestion:row.suggestion,
    outcome:experiment.status!=='evaluated'?(experiment.status==='pending'?'pending':'inconclusive'):row.suggestion===null?'abstained':sameObject(row.suggestion,experiment.observation.object)?'correct':'incorrect'}));
  return {taskId:task.id,policySet:SET,status:experiment.status,reason:experiment.reason,results,readOnly:true,authorizesAction:false};
}
export function summarizePolicyTrials(tasks){
  validatePolicyHistory({tasks});
  const reports=tasks.map(evaluatePolicyTrial).filter(Boolean);
  const counts={registered:reports.length,evaluated:0,pending:0,inconclusive:0,archivedIncomplete:0};
  const policies=RULES.map(rule=>({...rule,predictions:0,correct:0,incorrect:0,abstained:0,utility:0,coverage:null,accuracyOnPredictions:null,
    paired:{extraCorrect:0,extraIncorrect:0,avoidedIncorrect:0,lostCorrect:0}}));
  for(const report of reports){
    if(report.status!=='evaluated'){counts[report.status==='archived-incomplete'?'archivedIncomplete':report.status]++;continue;}
    counts.evaluated++;
    const baseline=report.results[0].outcome;
    report.results.forEach((row,i)=>{
      const p=policies[i],outcome=row.outcome;
      p[outcome]++;
      if(outcome==='abstained'){
        if(baseline==='incorrect')p.paired.avoidedIncorrect++;
        if(baseline==='correct')p.paired.lostCorrect++;
      }else{
        p.predictions++;
        p.utility+=outcome==='correct'?REVIEW.correctUtility:REVIEW.incorrectUtility;
        if(baseline==='abstained')p.paired[outcome==='correct'?'extraCorrect':'extraIncorrect']++;
      }
    });
  }
  for(const p of policies){
    p.coverage=counts.evaluated?p.predictions/counts.evaluated:null;
    p.accuracyOnPredictions=p.predictions?p.correct/p.predictions:null;
  }
  const baseline=policies[0];
  const challengers=policies.slice(1).map(p=>{
    const reasons=[];
    if(counts.evaluated<REVIEW.minimumEvaluated)reasons.push('INSUFFICIENT_EVALUATED_TRIALS');
    if(p.predictions<REVIEW.minimumPredictions)reasons.push('INSUFFICIENT_PREDICTIONS');
    if(p.incorrect>baseline.incorrect)reasons.push('MORE_INCORRECT_SUGGESTIONS');
    const utilityGain=p.utility-baseline.utility;
    if(utilityGain<REVIEW.minimumUtilityGain)reasons.push('UTILITY_GAIN_BELOW_GATE');
    return {policyId:p.id,utilityGain,eligibleForReview:reasons.length===0,reasons};
  });
  const eligible=challengers.filter(p=>p.eligibleForReview).sort((a,b)=>b.utilityGain-a.utilityGain);
  const tie=eligible.length>1&&eligible[0].utilityGain===eligible[1].utilityGain;
  const reviewCandidate=eligible.length&&!tie?eligible[0].policyId:null;
  return {schema:'vivo.forecast-policy-review/1',policySet:SET,activePolicyId:RULES[0].id,counts,policies,challengers,reviewCandidate,
    reviewStatus:counts.evaluated<REVIEW.minimumEvaluated?'insufficient-evaluated-trials':tie?'tied-challengers':reviewCandidate?'candidate-for-owner-review':'retain-baseline',
    gate:{...REVIEW},reports,method:'paired prospective task-level selective forecast comparison',automaticPromotion:false,calibratedProbability:false,authorizesAction:false,readOnly:true};
}
