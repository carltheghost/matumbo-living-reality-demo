/** Derived local experience. The validated journal is the only source; no learned weights or new store. */
const compareText=(a,b)=>a<b?-1:a>b?1:0;
const address=s=>typeof s.spaceId==='string'&&s.spaceId&&typeof s.entityId==='string'&&s.entityId?JSON.stringify([s.spaceId,s.entityId]):null;
const changed=s=>s.state==='confirmed'&&s.changed===true;
const confirmed=s=>s.state==='confirmed';
const freshCounts=()=>({confirmedChanged:0,confirmedUnchanged:0,pending:0,conflict:0,notDispatched:0});
function addStep(c,s){
  if(confirmed(s))c[s.changed===true?'confirmedChanged':'confirmedUnchanged']++;
  else if(s.state==='pending')c.pending++;
  else if(s.state==='conflict')c.conflict++;
  else if(s.state==='not-dispatched')c.notDispatched++;
}
const sourceOf=(task,step)=>step.sourceId||task.sourceId;

// Count distinct contributed tasks rather than claiming a model's accuracy or success rate.
// Receipt authors remain the original source even after a handoff/recovery.
export function collectMissionExperience(tasks){
  const profiles=new Map();
  for(const task of tasks){
    const participants=new Map();
    for(const step of task.steps){
      const sourceId=sourceOf(task,step);
      if(!profiles.has(sourceId))profiles.set(sourceId,{sourceId,...freshCounts(),contributedTasks:0,completedContributions:0,closedIncompleteContributions:0,unknownSpaceOperations:0,objects:new Map()});
      const p=profiles.get(sourceId),key=address(step);
      if(!participants.has(sourceId))participants.set(sourceId,{confirmed:false,objects:new Map()});
      const contribution=participants.get(sourceId);
      addStep(p,step);contribution.confirmed||=confirmed(step);
      if(!key){p.unknownSpaceOperations++;continue;}
      if(!p.objects.has(key))p.objects.set(key,{spaceId:step.spaceId,entityId:step.entityId,...freshCounts(),changedTasks:0,completedChangedTasks:0});
      addStep(p.objects.get(key),step);
      contribution.objects.set(key,Boolean(contribution.objects.get(key)||changed(step)));
    }
    for(const [sourceId,c] of participants){
      const p=profiles.get(sourceId);p.contributedTasks++;
      if(task.completed===true&&c.confirmed)p.completedContributions++;
      else if(task.closed&&task.completed!==true)p.closedIncompleteContributions++;
      for(const [key,didChange] of c.objects){
        if(!didChange)continue;
        const o=p.objects.get(key);o.changedTasks++;if(task.completed===true)o.completedChangedTasks++;
      }
    }
  }
  return [...profiles.values()].sort((a,b)=>compareText(a.sourceId,b.sourceId)).map(p=>({...p,objects:[...p.objects.values()].sort((a,b)=>b.completedChangedTasks-a.completedChangedTasks||b.changedTasks-a.changedTasks||compareText(a.spaceId,b.spaceId)||compareText(a.entityId,b.entityId))}));
}

// A recommendation only uses exact known object/space addresses evidenced by
// this task or its explicitly completed direct prerequisites. No title-based guesses.
export function relatedMissionExperience(tasks,task,mission){
  const relevant=new Set([...task.steps.filter(confirmed),...mission.dependencies.flatMap(d=>d.receipts)].map(address).filter(Boolean));
  const history=new Map();
  for(const t of tasks){
    const contributors=new Set();
    for(const s of t.steps){
      if(!changed(s)||!relevant.has(address(s)))continue;
      const sourceId=sourceOf(t,s),stats=history.get(sourceId)||{relatedChangedReceipts:0,relatedChangedTasks:0,relatedCompletedTasks:0};
      stats.relatedChangedReceipts++;history.set(sourceId,stats);contributors.add(sourceId);
    }
    for(const sourceId of contributors){const stats=history.get(sourceId);stats.relatedChangedTasks++;if(t.completed===true)stats.relatedCompletedTasks++;}
  }
  return {relatedObjectCount:relevant.size,history};
}

// The agent-facing view may summarize its own task and explicitly shared
// direct completed prerequisites only, never unrelated journal histories.
export function taskMissionExperience(task,mission){
  const visible=[task,...mission.dependencies.filter(d=>d.status==='completed').map(d=>({id:d.taskId,sourceId:d.sourceId,closed:true,completed:true,
    steps:d.receipts.map(r=>({...r,state:'confirmed'}))}))];
  return {schema:'vivo.mission-experience/1',scope:'attached-task-and-completed-direct-prerequisites',profiles:collectMissionExperience(visible),authorizesAction:false};
}
