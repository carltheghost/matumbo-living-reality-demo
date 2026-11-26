/** Descriptive next-observation forecasts from owner-shared completed task sequences. */
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const id=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f]/.test(x);
const address=s=>id(s?.spaceId)&&id(s?.entityId)?JSON.stringify([s.spaceId,s.entityId]):null;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const witness=(task,s)=>({operationId:s.operationId,spaceId:s.spaceId,entityId:s.entityId,sourceId:s.sourceId||task.sourceId,sha256:s.sha256,revision:s.revision,changed:s.changed});
export function normalizeMissionForecast(args){
  need(args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).length===2&&Object.hasOwn(args,'spaceId')&&Object.hasOwn(args,'entityId')&&address(args),'MISSION_FORECAST_ARGUMENTS_INVALID');
  return {spaceId:args.spaceId,entityId:args.entityId};
}
function observe(tasks,cue){
  need(Array.isArray(tasks)&&tasks.length<=15,'MISSION_FORECAST_EVIDENCE_INVALID');
  const seenTasks=new Set(),seenOps=new Set(),rows=[];
  for(const t of Array.from(tasks).sort((a,b)=>cmp(a?.id,b?.id))){
    need(t&&id(t.id)&&id(t.sourceId)&&t.closed===true&&t.completed===true&&Array.isArray(t.steps)&&t.steps.length<=64&&t.steps.some(s=>s?.state==='confirmed')&&!seenTasks.has(t.id),'MISSION_FORECAST_EVIDENCE_INVALID');seenTasks.add(t.id);
    for(const s of t.steps){
      need(s&&['confirmed','not-dispatched'].includes(s.state)&&id(s.operationId)&&!seenOps.has(s.operationId),'MISSION_FORECAST_EVIDENCE_INVALID');seenOps.add(s.operationId);
      if(s.state==='confirmed')need(id(s.entityId)&&id(s.sourceId||t.sourceId)&&typeof s.changed==='boolean'&&Number.isSafeInteger(s.revision)&&s.revision>=0&&typeof s.sha256==='string'&&/^[a-f0-9]{64}$/.test(s.sha256),'MISSION_FORECAST_EVIDENCE_INVALID');
    }
    const outcomes=new Map();
    for(let i=0;i<t.steps.length;i++){
      const from=t.steps[i];if(from.state!=='confirmed'||address(from)!==cue)continue;
      const to=t.steps[i+1],next=to?.state==='confirmed'?address(to):null;
      const key=next?'object:'+next:to?'unknown':'terminal';
      if(!outcomes.has(key))outcomes.set(key,next?{kind:'object',key:next,spaceId:to.spaceId,entityId:to.entityId,from:witness(t,from),to:witness(t,to)}:{kind:key,from:witness(t,from)});
    }
    if(outcomes.size===1)rows.push({taskId:t.id,...outcomes.values().next().value});
    else if(outcomes.size>1)rows.push({taskId:t.id,kind:'ambiguous'});
  }
  return rows;
}
/** Shared exact observation rule for forecasts and preregistered experiments. */
export function observeMissionSequence(tasks,args){return observe(tasks,address(normalizeMissionForecast(args)));}
function summarize(rows){
  const counts={matchingTasks:rows.length,objectVotes:0,terminal:0,unknown:0,ambiguous:0},byObject=new Map();
  for(const r of rows){
    if(r.kind!=='object'){counts[r.kind]++;continue;}
    counts.objectVotes++;
    const c=byObject.get(r.key)||{key:r.key,spaceId:r.spaceId,entityId:r.entityId,supportingTasks:0,witnesses:[]};
    c.supportingTasks++;c.witnesses.push({taskId:r.taskId,from:r.from,to:r.to});byObject.set(r.key,c);
  }
  const candidates=[...byObject.values()].sort((a,b)=>b.supportingTasks-a.supportingTasks||cmp(a.key,b.key));
  const top=candidates[0],n=counts.matchingTasks;
  // A fixed conservative policy, not a calibrated model probability.
  const suggested=top&&top.supportingTasks>=3&&top.supportingTasks*2>n?top:null;
  const reason=suggested?null:n===0?'NO_MATCHING_TASKS':n<3?'INSUFFICIENT_DISTINCT_TASKS':!top?'NO_OBSERVED_NEXT_OBJECT':top.supportingTasks<3?'INSUFFICIENT_SUPPORT':'NO_STRICT_MAJORITY';
  return {counts,candidates,suggested,reason};
}
export function forecastMissionEvidence({scope,tasks,args}){
  const query=normalizeMissionForecast(args);
  need(scope&&id(scope.worldId)&&id(scope.projectId),'MISSION_FORECAST_SCOPE_INVALID');
  const rows=observe(tasks,address(query)),{counts,candidates,suggested,reason}=summarize(rows),n=counts.matchingTasks;
  let eligible=0,evaluated=0,correct=0;
  for(const held of rows){
    if(!['object','terminal'].includes(held.kind))continue;eligible++;
    const pred=summarize(rows.filter(r=>r.taskId!==held.taskId)).suggested;
    if(pred){evaluated++;if(held.kind==='object'&&held.key===pred.key)correct++;}
  }
  return {schema:'vivo.mission-forecast/1',scope:{worldId:scope.worldId,projectId:scope.projectId},query,status:suggested?'suggested':'abstain',reason,counts,
    candidates:candidates.map(({key,...c})=>({...c,historicalShare:c.supportingTasks/n,possibleShareIfUncertainResolved:[c.supportingTasks/n,(c.supportingTasks+counts.unknown+counts.ambiguous)/n]})),
    suggestion:suggested?{spaceId:suggested.spaceId,entityId:suggested.entityId,supportingTasks:suggested.supportingTasks,kind:'inspect-next-object'}:null,
    retrospective:{method:'leave-one-task-out (descriptive, not independent prospective validation)',eligible,evaluated,correct,abstained:eligible-evaluated,observedAccuracy:evaluated?correct/evaluated:null},
    policy:{minimumSupportingTasks:3,strictMajorityOfMatchingTasks:true},method:'one vote per completed task with a consistent immediately following confirmed object',calibratedProbability:false,causalityProven:false,learned:false,readOnly:true,authorizesAction:false};
}
