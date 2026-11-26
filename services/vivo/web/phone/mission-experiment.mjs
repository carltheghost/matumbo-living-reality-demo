/** Owner-preregistered, prospective local journal observations. Not a causal experiment. */
import {observeMissionSequence} from './mission-forecast.mjs';
const SCHEMA='vivo.mission-experiment/1',RULE='consistent-immediate-next-object';
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const id=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f]/.test(x);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const endpoint=x=>exact(x,['spaceId','entityId'])&&id(x.spaceId)&&id(x.entityId);
const address=x=>JSON.stringify([x.spaceId,x.entityId]);
const copy=x=>({spaceId:x.spaceId,entityId:x.entityId});
const states=['suggested','abstain'];
export function normalizeExperimentSpec(input){
  need(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['cue','hypotheses','captureForecast'].includes(k))&&Object.hasOwn(input,'cue')&&Object.hasOwn(input,'hypotheses')&&endpoint(input.cue)&&Array.isArray(input.hypotheses)&&input.hypotheses.length>=2&&input.hypotheses.length<=4&&Array.from(input.hypotheses).every(endpoint),'EXPERIMENT_SPEC_INVALID');
  const hypotheses=input.hypotheses.map(copy);need(new Set(hypotheses.map(address)).size===hypotheses.length,'EXPERIMENT_SPEC_INVALID');
  need(input.captureForecast===undefined||typeof input.captureForecast==='boolean','EXPERIMENT_SPEC_INVALID');
  return {cue:copy(input.cue),hypotheses,captureForecast:input.captureForecast===true};
}
export function parseExperimentHypotheses(text){
  need(typeof text==='string'&&text.length<=2200,'EXPERIMENT_SPEC_INVALID');
  return text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
    const pair=line.split('|').map(x=>x.trim());need(pair.length===2,'EXPERIMENT_SPEC_INVALID');
    return {spaceId:pair[0],entityId:pair[1]};
  });
}
// Persist only aggregates explicitly approved by the owner, never source task
// IDs, receipt witnesses, sessions, or unshared history from the recall grant.
export function captureExperimentForecast(report,cue){
  need(report&&report.schema==='vivo.mission-forecast/1'&&states.includes(report.status)&&endpoint(report.query)&&address(report.query)===address(cue)&&Number.isSafeInteger(report.counts?.matchingTasks)&&report.counts.matchingTasks>=0&&report.counts.matchingTasks<=15,'EXPERIMENT_FORECAST_INVALID');
  const summary={status:report.status,matchingTasks:report.counts.matchingTasks,reason:report.reason,suggestion:null};
  if(report.status==='suggested'){
    const s=report.suggestion;
    need(s&&id(s.spaceId)&&id(s.entityId)&&Number.isSafeInteger(s.supportingTasks)&&s.supportingTasks>=3&&s.supportingTasks<=summary.matchingTasks&&s.supportingTasks*2>summary.matchingTasks&&report.reason===null,'EXPERIMENT_FORECAST_INVALID');
    summary.suggestion={spaceId:s.spaceId,entityId:s.entityId,supportingTasks:s.supportingTasks};
  }else need(report.suggestion===null&&id(report.reason),'EXPERIMENT_FORECAST_INVALID');
  return summary;
}
function validSummary(f){
  if(f===null)return true;
  if(!exact(f,['status','matchingTasks','reason','suggestion'])||!states.includes(f.status)||!Number.isSafeInteger(f.matchingTasks)||f.matchingTasks<0||f.matchingTasks>15)return false;
  if(f.status==='abstain')return f.suggestion===null&&id(f.reason);
  const s=f.suggestion;return f.reason===null&&exact(s,['spaceId','entityId','supportingTasks'])&&id(s.spaceId)&&id(s.entityId)&&Number.isSafeInteger(s.supportingTasks)&&s.supportingTasks>=3&&s.supportingTasks<=f.matchingTasks&&s.supportingTasks*2>f.matchingTasks;
}
export function registerMissionExperiment(task,input,forecast=null){
  const spec=normalizeExperimentSpec(input);
  need(task.experiment===undefined,'EXPERIMENT_ALREADY_REGISTERED');
  need(!task.closed&&task.completed!==true&&task.steps.length===0,'EXPERIMENT_TOO_LATE');
  need(spec.captureForecast===(forecast!==null)&&validSummary(forecast),'EXPERIMENT_FORECAST_INVALID');
  // Immutable through the trusted journal API, not signed or externally
  // timestamped proof. Outcomes are derived, never overwritten.
  task.experiment={schema:SCHEMA,rule:RULE,cue:spec.cue,hypotheses:spec.hypotheses,registeredEpoch:task.epoch,registeredSourceId:task.sourceId,
    forecast:forecast===null?null:{...forecast,suggestion:forecast.suggestion?{...forecast.suggestion}:null}};
  return task.experiment;
}
export function validateExperimentHistory(journal){
  for(const task of journal.tasks){
    if(task.experiment===undefined)continue;
    const e=task.experiment;
    need(exact(e,['schema','rule','cue','hypotheses','registeredEpoch','registeredSourceId','forecast'])&&e.schema===SCHEMA&&e.rule===RULE&&Number.isSafeInteger(e.registeredEpoch)&&e.registeredEpoch>=1&&e.registeredEpoch<=task.epoch&&id(e.registeredSourceId)&&validSummary(e.forecast),'EXPERIMENT_STORAGE_INVALID');
    try{normalizeExperimentSpec({cue:e.cue,hypotheses:e.hypotheses});}catch{throw Object.assign(new Error('EXPERIMENT_STORAGE_INVALID'),{code:'EXPERIMENT_STORAGE_INVALID'});}
    const handoffs=task.handoffs||[];let owner=handoffs[0]?.from||task.sourceId;
    for(const h of handoffs)if(h.epoch<=e.registeredEpoch)owner=h.to;
    need(owner===e.registeredSourceId,'EXPERIMENT_STORAGE_INVALID');
  }
  return journal;
}
export function evaluateMissionExperiment(task){
  const e=task.experiment;if(!e)return null;
  const report={taskId:task.id,schema:SCHEMA,rule:RULE,registration:e,status:'pending',reason:'AWAITING_EXPLICIT_COMPLETION',observation:null,
    hypotheses:e.hypotheses.map((h,i)=>({object:copy(h),primary:i===0,result:'undetermined'})),primaryOutcome:'pending',
    forecastOutcome:e.forecast===null?'not-captured':e.forecast.status==='abstain'?'abstained':'pending',readOnly:true,authorizesAction:false,causalityProven:false};
  const setUnknown=(status,reason)=>{
    report.status=status;report.reason=reason;report.primaryOutcome=status==='pending'?'pending':'inconclusive';
    if(report.forecastOutcome==='pending'&&status!=='pending')report.forecastOutcome='inconclusive';
    return report;
  };
  if(task.completed!==true)return task.closed?setUnknown('archived-incomplete','TASK_ARCHIVED_INCOMPLETE'):setUnknown('pending',task.steps.some(s=>s.state==='pending'||s.state==='conflict')?'UNRESOLVED_RECEIPTS':'AWAITING_EXPLICIT_COMPLETION');
  // Share the forecast's per-task rule: no cherry-picking, skipping gaps,
  // or treating repeated operations as independent evidence.
  const [observed]=observeMissionSequence([task],e.cue);
  if(!observed)return setUnknown('inconclusive','NO_CONFIRMED_CUE');
  if(observed.kind==='ambiguous'||observed.kind==='unknown')return setUnknown('inconclusive',observed.kind==='ambiguous'?'AMBIGUOUS_SEQUENCE':'UNKNOWN_NEXT_ENTRY');
  report.status='evaluated';report.reason=null;
  const actual=observed.kind==='object'?{spaceId:observed.spaceId,entityId:observed.entityId}:null;
  report.observation={kind:observed.kind,object:actual,from:observed.from,to:observed.to||null};
  const matches=h=>actual!==null&&address(h)===address(actual);
  report.hypotheses=report.hypotheses.map(h=>({...h,result:matches(h.object)?'supported':'contradicted'}));
  report.primaryOutcome=matches(e.hypotheses[0])?'correct':'incorrect';
  if(e.forecast?.status==='suggested')report.forecastOutcome=matches(e.forecast.suggestion)?'correct':'incorrect';
  return report;
}
export function summarizeExperiments(tasks){
  const reports=tasks.map(evaluateMissionExperiment).filter(Boolean);
  const counts={registered:reports.length,pending:0,archivedIncomplete:0,inconclusive:0,evaluated:0,primaryCorrect:0,primaryIncorrect:0,
    forecastCaptured:0,forecastAbstained:0,forecastEvaluated:0,forecastCorrect:0,forecastIncorrect:0};
  for(const r of reports){
    if(r.status==='pending')counts.pending++;
    else if(r.status==='archived-incomplete')counts.archivedIncomplete++;
    else if(r.status==='inconclusive')counts.inconclusive++;
    else if(r.status==='evaluated'){counts.evaluated++;counts[r.primaryOutcome==='correct'?'primaryCorrect':'primaryIncorrect']++;}
    if(r.forecastOutcome!=='not-captured')counts.forecastCaptured++;
    if(r.forecastOutcome==='abstained')counts.forecastAbstained++;
    if(r.forecastOutcome==='correct'||r.forecastOutcome==='incorrect'){counts.forecastEvaluated++;counts[r.forecastOutcome==='correct'?'forecastCorrect':'forecastIncorrect']++;}
  }
  return {schema:'vivo.mission-experiment-summary/1',counts,reports,method:'prospective local task-level agreement, not independent or causal validation',readOnly:true,authorizesAction:false,calibratedProbability:false};
}
