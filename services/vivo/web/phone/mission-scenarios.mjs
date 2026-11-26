/** Read-only counterfactual assignment comparison; no execution authority. */
export function validateScenario(input){
  const valid=x=>typeof x==="string"&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f]/.test(x);
  const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
  need(input&&typeof input==="object"&&!Array.isArray(input)&&Object.keys(input).every(k=>["taskIds","unavailableSourceIds"].includes(k))&&Array.isArray(input.taskIds)&&input.taskIds.length>0&&input.taskIds.length<=16,"SCENARIO_TASKS_INVALID");
  const taskIds=Array.from(input.taskIds),unavailableSourceIds=input.unavailableSourceIds===undefined?[]:Array.isArray(input.unavailableSourceIds)?Array.from(input.unavailableSourceIds):null;
  need(taskIds.every(valid)&&new Set(taskIds).size===taskIds.length,"SCENARIO_TASKS_INVALID");
  need(unavailableSourceIds&&unavailableSourceIds.length<=16&&unavailableSourceIds.every(valid)&&new Set(unavailableSourceIds).size===unavailableSourceIds.length,"SCENARIO_SOURCES_INVALID");
  return {taskIds,unavailableSourceIds};
}
export function compareMissionScenarios({tasks,rankings,unavailableSourceIds=[]}){
  // Only actual eligible edges from the existing orchestrator. The hypothetical
  // case removes sources; it never creates capabilities or releases a lease.
  const cmp=(a,b)=>a<b?-1:a>b?1:0;
  const selected=[...tasks].sort((a,b)=>cmp(a.id,b.id));
  const outage=new Set(unavailableSourceIds);
  const summarize=excluded=>{
    const rows=selected.map(t=>{
      const r=rankings.get(t.id);
      const edges=(r?.candidates||[]).filter(a=>a.eligible&&!excluded.has(a.sourceId));
      // Deduplicate by source, not session: conservatively one task per source.
      const seen=new Set(),candidates=edges.filter(a=>{if(seen.has(a.sourceId))return false;seen.add(a.sourceId);return true;});
      return {taskId:t.id,title:t.title,reason:r?.reason||null,candidates};
    });
    // Augmenting-path bipartite matching gives maximum cardinality even where
    // a flexible task must yield its preferred worker to a constrained task.
    const sourceToTask=new Map(),taskToCandidate=new Map(),byId=new Map(rows.map(r=>[r.taskId,r]));
    function assign(taskId,visited){
      const row=byId.get(taskId);
      for(const candidate of row.candidates){
        const source=candidate.sourceId;if(visited.has(source))continue;visited.add(source);
        const previous=sourceToTask.get(source);
        if(previous===undefined||assign(previous,visited)){
          sourceToTask.set(source,taskId);taskToCandidate.set(taskId,candidate);return true;
        }
      }
      return false;
    }
    // Constrained rows first; stable tie-break. This maximizes count, not
    // aggregate preference score or completion probability.
    const ordered=[...rows].sort((a,b)=>a.candidates.length-b.candidates.length||cmp(a.taskId,b.taskId));
    for(const row of ordered)assign(row.taskId,new Set());
    return {assignable:taskToCandidate.size,selected:rows.length,rows:rows.map(row=>{
      const match=taskToCandidate.get(row.taskId);
      return {taskId:row.taskId,title:row.title,status:match?"proposed":row.candidates.length?"capacity-contention":row.reason&&row.reason!=="NO_ELIGIBLE_AGENT"?row.reason:"NO_ELIGIBLE_AGENT",
        candidateCount:row.candidates.length,assignment:match?{sourceId:match.sourceId,sessionId:match.sessionId,generation:match.generation,continuity:match.continuity===true,relatedCompletedTasks:match.relatedCompletedTasks||0}:null};
    })};
  };
  const baseline=summarize(new Set()),alternative=summarize(outage);
  return {schema:"vivo.mission-scenario/1",baseline,alternative,unavailableSourceIds:[...outage].sort(cmp),lostCapacity:baseline.assignable-alternative.assignable,method:"maximum-cardinality matching of currently eligible detached tasks to distinct agent sources",readOnly:true,authorizesAction:false,predictsCompletion:false,assumesFutureAvailability:false};
}
