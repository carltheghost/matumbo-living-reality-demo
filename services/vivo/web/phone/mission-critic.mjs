/** Independently audit and, for small missions, improve hypothetical schedules. */
export function auditStrategyCase({tasks,taskIds,rankings,unavailableSourceIds=[]},schedule){
  const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  need(Array.isArray(tasks)&&tasks.length<=16&&Array.isArray(taskIds)&&taskIds.length>0&&taskIds.length<=16&&new Set(taskIds).size===taskIds.length,"CRITIC_INPUT_INVALID");
  const byId=new Map(tasks.map(t=>[t.id,t])),excluded=new Set(unavailableSourceIds);
  need(byId.size===tasks.length&&taskIds.every(id=>byId.has(id)),"CRITIC_INPUT_INVALID");
  const remaining=taskIds.slice().sort(cmp).map(id=>byId.get(id)).filter(t=>t.completed!==true);
  const pending=new Set(remaining.map(t=>t.id)),done=new Set(tasks.filter(t=>t.completed===true).map(t=>t.id));
  const choices=new Map(),sources=new Set(),sole=new Map();
  for(const t of remaining){
    const rank=rankings.get(t.id);
    need(rank&&Array.isArray(rank.candidates),"CRITIC_RANKING_MISSING");
    const blocked=t.closed===true||(t.steps||[]).some(s=>s.state==="pending"||s.state==="conflict");
    const candidates=blocked?[]:rank.candidates.filter(a=>a.eligible===true&&!excluded.has(a.sourceId));
    choices.set(t.id,candidates);
    const ids=[...new Set(candidates.map(a=>a.sourceId))].sort(cmp);
    for(const id of ids)sources.add(id);
    if(ids.length===1){const list=sole.get(ids[0])||[];list.push(t.id);sole.set(ids[0],list);}
  }
  const memo=new Map(),visiting=new Set(),selected=new Set(pending);
  function depth(id){
    if(memo.has(id))return memo.get(id);
    need(!visiting.has(id),"CRITIC_DEPENDENCY_CYCLE");visiting.add(id);
    const value=1+Math.max(0,...(byId.get(id).dependsOn||[]).filter(d=>selected.has(d)).map(depth));
    visiting.delete(id);memo.set(id,value);return value;
  }
  const dependencyDepth=Math.max(0,...remaining.map(t=>depth(t.id)));
  need(schedule&&Array.isArray(schedule.waves)&&schedule.waves.length<=remaining.length&&Array.isArray(schedule.unscheduled),"CRITIC_SCHEDULE_INVALID");
  let weak=0;
  for(const [i,wave] of schedule.waves.entries()){
    need(wave&&wave.round===i+1&&wave.assumesSuccessfulCompletion===true&&Array.isArray(wave.assignments)&&wave.assignments.length>0,"CRITIC_WAVE_INVALID");
    const usedSources=new Set(),usedTasks=new Set();
    for(const a of wave.assignments){
      need(a&&pending.has(a.taskId)&&!usedTasks.has(a.taskId)&&!usedSources.has(a.sourceId),"CRITIC_DUPLICATE_ASSIGNMENT");
      const t=byId.get(a.taskId);
      need((t.dependsOn||[]).every(d=>done.has(d)),"CRITIC_PREREQUISITE_UNMET");
      const candidate=choices.get(a.taskId).find(c=>c.sourceId===a.sourceId&&(c.relatedCompletedTasks||0)===(a.relatedCompletedTasks||0));
      need(candidate,"CRITIC_INELIGIBLE_ASSIGNMENT");
      if(!(candidate.relatedCompletedTasks>0))weak++;
      usedTasks.add(a.taskId);usedSources.add(a.sourceId);
    }
    for(const id of usedTasks){pending.delete(id);done.add(id);}
  }
  const left=schedule.unscheduled.map(t=>t?.taskId);
  need(left.length===pending.size&&new Set(left).size===left.length&&left.every(id=>pending.has(id)),"CRITIC_PARTITION_INVALID");
  for(const id of pending){
    const unmet=(byId.get(id).dependsOn||[]).filter(d=>!done.has(d)).sort(cmp);
    const row=schedule.unscheduled.find(t=>t.taskId===id);
    need(JSON.stringify(row.unmetPrerequisiteIds)===JSON.stringify(unmet),"CRITIC_BLOCKERS_INVALID");
    need(unmet.length||!choices.get(id).length,"CRITIC_PREMATURE_STOP");
  }
  const scheduled=remaining.length-pending.size,complete=pending.size===0;
  need(schedule.roundCount===schedule.waves.length&&schedule.simulatedScheduled===scheduled&&schedule.allRemainingScheduled===complete,"CRITIC_COUNTS_INVALID");
  const mandatoryLoad=Math.max(0,...[...sole.values()].map(ids=>ids.length));
  const lowerBound=complete?Math.max(dependencyDepth,remaining.length?Math.ceil(remaining.length/sources.size):0,mandatoryLoad):null;
  if(complete)need(schedule.roundCount>=lowerBound,"CRITIC_IMPOSSIBLE_ROUND_COUNT");
  return {valid:true,scheduled,unscheduled:pending.size,dependencyDepth,eligibleSources:[...sources].sort(cmp),conditionalLowerBound:lowerBound,
    soleSourceTasks:[...sole.entries()].sort((a,b)=>cmp(a[0],b[0])).map(([sourceId,taskIds])=>({sourceId,taskIds:[...taskIds]})),
    assignmentsWithoutRelatedCompletedEvidence:weak};
}
export function reviewMissionStrategies(input,compareStrategy,compare){
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  const original=compareStrategy(input,compare),byId=new Map(input.tasks.map(t=>[t.id,t]));
  const remaining=input.taskIds.slice().sort(cmp).map(id=>byId.get(id)).filter(t=>t.completed!==true);
  // Exact breadth-first search on completed-task masks is bounded to ten
  // unfinished tasks. Matchability depends only on the fixed eligible edges.
  function exact(excluded){
    const n=remaining.length,full=(1<<n)-1,index=new Map(remaining.map((t,i)=>[t.id,i]));
    const deps=remaining.map(t=>(t.dependsOn||[]).reduce((mask,d)=>index.has(d)?mask|(1<<index.get(d)):mask,0));
    const externalDone=remaining.map(t=>(t.dependsOn||[]).every(d=>index.has(d)||byId.get(d)?.completed===true));
    const queue=[0],parent=new Map([[0,null]]),matches=new Map();let transitions=0;
    const matching=mask=>{
      if(matches.has(mask))return matches.get(mask);
      const tasks=remaining.filter((t,i)=>mask&(1<<i));
      const r=compare({tasks,rankings:input.rankings,unavailableSourceIds:excluded}).alternative;
      const assignments=r.rows.filter(row=>row.assignment).map(row=>({taskId:row.taskId,title:row.title,sourceId:row.assignment.sourceId,relatedCompletedTasks:row.assignment.relatedCompletedTasks}));
      const value=assignments.length===tasks.length?assignments:null;matches.set(mask,value);return value;
    };
    for(let i=0;i<queue.length&&!parent.has(full);i++){
      const state=queue[i];let ready=0;
      for(let j=0;j<n;j++)if(!(state&(1<<j))&&externalDone[j]&&(deps[j]&state)===deps[j])ready|=1<<j;
      for(let subset=ready;subset;subset=(subset-1)&ready){
        transitions++;const next=state|subset;if(parent.has(next)||!matching(subset))continue;
        parent.set(next,{state,subset});queue.push(next);if(next===full)break;
      }
    }
    if(!parent.has(full))throw Object.assign(new Error("CRITIC_EXACT_PATH_MISSING"),{code:"CRITIC_EXACT_PATH_MISSING"});
    const masks=[];for(let at=full;at;){const edge=parent.get(at);masks.push(edge.subset);at=edge.state;}masks.reverse();
    const waves=masks.map((mask,i)=>({round:i+1,assignments:matching(mask),assumesSuccessfulCompletion:true}));
    return {schedule:{waves,simulatedScheduled:n,unscheduled:[],allRemainingScheduled:true,roundCount:waves.length},statesExplored:parent.size,subsetsExamined:transitions};
  }
  function inspect(schedule,excluded){
    const scenario={...input,unavailableSourceIds:excluded};
    const initialAudit=auditStrategyCase(scenario,schedule);
    let preferred=schedule,proofStatus="blocked-under-fixed-snapshot",search=null;
    if(schedule.allRemainingScheduled){
      if(schedule.roundCount===initialAudit.conditionalLowerBound)proofStatus="lower-bound-proven";
      else if(remaining.length<=10){
        const result=exact(excluded);preferred=result.schedule;
        if(preferred.roundCount>schedule.roundCount)throw Object.assign(new Error("CRITIC_EXACT_REGRESSION"),{code:"CRITIC_EXACT_REGRESSION"});
        proofStatus="exact-search-proven";search={statesExplored:result.statesExplored,subsetsExamined:result.subsetsExamined};
      }else proofStatus="optimality-unproven-size-limit";
    }
    const audit=auditStrategyCase(scenario,preferred);
    return {proofStatus,originalRounds:schedule.roundCount,preferredRounds:preferred.roundCount,
      improvementRounds:schedule.roundCount-preferred.roundCount,preferredWaves:preferred.waves,
      allRemainingScheduled:preferred.allRemainingScheduled,unscheduled:preferred.unscheduled,
      originalAudit:initialAudit,audit,search};
  }
  const excluded=input.unavailableSourceIds||[];
  const baseline=inspect(original.baseline,[]),alternative=inspect(original.alternative,excluded);
  // Stress test one-source outages from the baseline. This intentionally uses
  // the existing greedy waves, not another exponential optimization for every source.
  const sources=baseline.audit.eligibleSources,stress=[];
  for(const sourceId of sources.slice(0,16)){
    const caseInput={...input,unavailableSourceIds:[sourceId]};
    const plan=compareStrategy(caseInput,compare).alternative,audit=auditStrategyCase(caseInput,plan);
    stress.push({sourceId,additionalUnscheduled:audit.unscheduled-baseline.originalAudit.unscheduled,
      heuristicExtraRounds:plan.allRemainingScheduled&&original.baseline.allRemainingScheduled?plan.roundCount-original.baseline.roundCount:null});
  }
  stress.sort((a,b)=>b.additionalUnscheduled-a.additionalUnscheduled||(b.heuristicExtraRounds??0)-(a.heuristicExtraRounds??0)||cmp(a.sourceId,b.sourceId));
  return {schema:"vivo.mission-critic/1",baseline,alternative,remainingTasks:remaining.length,unavailableSourceIds:[...excluded].sort(cmp),
    singleSourceStress:{cases:stress,tested:sources.slice(0,16).length,totalEligibleSources:sources.length,complete:sources.length<=16},
    conditionalRoundDifference:baseline.allRemainingScheduled&&alternative.allRemainingScheduled?alternative.preferredRounds-baseline.preferredRounds:null,
    limitations:["Fixed current native eligibility; no prediction of future availability or duration.","Assumes successful unit-round completion and reusable source slots; no object-conflict or execution safety simulation.","Related completed receipts are historical evidence, not skill or success probabilities.","Exact proof is conditional on this abstract schedule model; stress-test rounds are heuristic."],
    readOnly:true,authorizesAction:false,predictsCompletion:false};
}
