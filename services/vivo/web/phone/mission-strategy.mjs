/** Read-only dependency-wave comparison. No action or task-completion authority. */
export function compareMissionStrategies({tasks,taskIds,rankings,unavailableSourceIds=[]},compare){
  const fail=code=>Object.assign(new Error(code),{code});
  const need=(ok,code)=>{if(!ok)throw fail(code);};
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  need(Array.isArray(tasks)&&tasks.length<=16&&Array.isArray(taskIds)&&taskIds.length>0&&taskIds.length<=16&&new Set(taskIds).size===taskIds.length&&typeof compare==="function","STRATEGY_INPUT_INVALID");
  const byId=new Map(tasks.map(t=>[t.id,t])),selected=[...taskIds].sort(cmp).map(id=>byId.get(id));
  need(byId.size===tasks.length&&selected.every(Boolean),"STRATEGY_INPUT_INVALID");
  const unfinished=selected.filter(t=>t.completed!==true),remainingIds=new Set(unfinished.map(t=>t.id));
  const deps=t=>t.dependsOn||[];
  const memo=new Map(),visiting=new Set();
  function longest(t){
    if(memo.has(t.id))return memo.get(t.id);
    need(!visiting.has(t.id),"STRATEGY_CYCLE");
    visiting.add(t.id);
    let best=[];
    for(const id of deps(t).filter(id=>remainingIds.has(id)).sort(cmp)){
      const chain=longest(byId.get(id));if(chain.length>best.length)best=chain;
    }
    const chain=[...best,t.id];visiting.delete(t.id);memo.set(t.id,chain);return chain;
  }
  let criticalPath=[];
  for(const t of unfinished){const chain=longest(t);if(chain.length>criticalPath.length)criticalPath=chain;}
  function simulate(excluded){
    const done=new Set(tasks.filter(t=>t.completed===true).map(t=>t.id)),pending=new Map(unfinished.map(t=>[t.id,t])),waves=[];
    // Hypothetical successful completion only advances dependencies inside this copy.
    // Live grants, workload, existing reservations and receipt states remain fixed.
    for(let i=0;i<unfinished.length&&pending.size;i++){
      const ready=[...pending.values()].filter(t=>deps(t).every(id=>done.has(id)));
      if(!ready.length)break;
      const r=compare({tasks:ready,rankings,unavailableSourceIds:excluded}).alternative;
      const assignments=r.rows.filter(row=>row.assignment).map(row=>({taskId:row.taskId,title:row.title,sourceId:row.assignment.sourceId,relatedCompletedTasks:row.assignment.relatedCompletedTasks}));
      if(!assignments.length)break;
      waves.push({round:i+1,assignments,assumesSuccessfulCompletion:true});
      for(const a of assignments){pending.delete(a.taskId);done.add(a.taskId);}
    }
    const excludedSet=new Set(excluded);
    const unscheduled=[...pending.values()].map(t=>{
      const unmet=deps(t).filter(id=>!done.has(id)).sort(cmp),rank=rankings.get(t.id);
      const eligible=(rank?.candidates||[]).filter(a=>a.eligible&&!excludedSet.has(a.sourceId));
      const reason=rank?.reason&&rank.reason!=="NO_ELIGIBLE_AGENT"?rank.reason:unmet.length?"UNMET_PREREQUISITES":eligible.length?"CAPACITY_CONTENTION":"NO_ELIGIBLE_AGENT";
      return {taskId:t.id,title:t.title,reason,unmetPrerequisiteIds:unmet,externalPrerequisiteIds:unmet.filter(id=>!remainingIds.has(id))};
    });
    return {waves,simulatedScheduled:unfinished.length-pending.size,unscheduled,allRemainingScheduled:pending.size===0,roundCount:waves.length};
  }
  const baseline=simulate([]),alternative=simulate(unavailableSourceIds);
  return {schema:"vivo.mission-strategy/1",selectedTasks:selected.length,alreadyCompleted:selected.length-unfinished.length,remainingTasks:unfinished.length,structuralDependencyDepth:criticalPath.length,criticalPath:criticalPath.map(id=>({taskId:id,title:byId.get(id).title})),baseline,alternative,unavailableSourceIds:[...unavailableSourceIds].sort(cmp),additionalUnscheduled:alternative.unscheduled.length-baseline.unscheduled.length,roundDifference:baseline.allRemainingScheduled&&alternative.allRemainingScheduled?alternative.roundCount-baseline.roundCount:null,method:"deterministic maximum-cardinality assignment per hypothetical dependency wave",assumptions:["Every proposed task completes successfully before the next round.","Current eligible grants and workload remain fixed; simulated assignments release their slots between rounds.","No actual task completion, permission, receipt or attachment changes."],readOnly:true,authorizesAction:false,predictsCompletion:false,optimalScheduleProven:false};
}
