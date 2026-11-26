/** Dependency rules for the existing native task journal; no new store or execution authority. */
export const TASK_JOURNAL_SCHEMA='vivo.agent-task-journal/2';
export const LEGACY_TASK_JOURNAL_SCHEMA='vivo.agent-task-journal/1';
const MAX_DEPENDENCIES=15;
const fail=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fail(code);};
const id=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f]/.test(x);
const dependencies=t=>t.dependsOn===undefined?[]:t.dependsOn;
const unresolved=s=>s.state==='pending'||s.state==='conflict';
const hasEvidence=t=>t.steps.some(s=>s.state==='confirmed')&&!t.steps.some(unresolved);
const completed=t=>t?.completed===true;
const byId=j=>new Map(j.tasks.map(t=>[t.id,t]));

export function normalizePrerequisites(value=[]){
  need(Array.isArray(value)&&value.length<=MAX_DEPENDENCIES,'TASK_DEPENDENCIES_INVALID');
  const ids=Array.from(value);
  need(ids.every(id)&&new Set(ids).size===ids.length,'TASK_DEPENDENCIES_INVALID');
  return ids;
}

// Called only after the existing journal validator has checked task/receipt structure.
// Migrate atomically so a still-open v1 client rejects the upgraded journal instead
// of silently bypassing prerequisites. Unknown schemas or forged legacy fields fail closed.
export function validateMissionGraph(journal){
  const legacy=journal.schema===LEGACY_TASK_JOURNAL_SCHEMA;
  need(legacy||journal.schema===TASK_JOURNAL_SCHEMA,'TASK_STORAGE_INVALID');
  const map=byId(journal);
  for(const task of journal.tasks){
    if(legacy)need(task.dependsOn===undefined&&task.completed===undefined,'TASK_STORAGE_INVALID');
    let deps;
    try{deps=normalizePrerequisites(dependencies(task));}catch{throw fail('TASK_STORAGE_INVALID');}
    need(deps.every(d=>d!==task.id&&map.has(d)),'TASK_STORAGE_INVALID');
    need(task.completed===undefined||task.completed===true,'TASK_STORAGE_INVALID');
    if(completed(task))need(task.closed&&hasEvidence(task)&&deps.every(d=>completed(map.get(d))),'TASK_STORAGE_INVALID');
  }
  const visiting=new Set(),visited=new Set();
  function visit(task){
    need(!visiting.has(task.id),'TASK_STORAGE_INVALID');
    if(visited.has(task.id))return;
    visiting.add(task.id);for(const d of dependencies(task))visit(map.get(d));
    visiting.delete(task.id);visited.add(task.id);
  }
  for(const task of journal.tasks)visit(task);
  journal.schema=TASK_JOURNAL_SCHEMA;
  return journal;
}

export function addPrerequisites(journal,task,requested){
  const deps=normalizePrerequisites(requested),map=byId(journal);
  need(deps.every(d=>d!==task.id&&map.has(d)),'TASK_DEPENDENCIES_INVALID');
  // New tasks may refer to existing tasks only, so no cycle can be introduced here.
  task.dependsOn=deps;
}

export function assertMissionReady(journal,task){
  const map=byId(journal);
  need(dependencies(task).every(d=>completed(map.get(d))),'TASK_PREREQUISITES_INCOMPLETE');
}

export function completeMissionTask(journal,task){
  need(!task.closed,'TASK_ALREADY_CLOSED');
  assertMissionReady(journal,task);
  need(!task.steps.some(unresolved),'TASK_RECONCILIATION_REQUIRED');
  need(hasEvidence(task),'TASK_EVIDENCE_REQUIRED');
  task.completed=true;task.closed=true;
  return task;
}

// Direct, owner-selected dependencies only. A completed receipt is historical
// local evidence, not provider authentication or authority for a new action.
export function missionView(journal,task){
  const map=byId(journal),rows=dependencies(task).map(taskId=>{
    const prior=map.get(taskId),done=completed(prior);
    return {taskId,title:prior.title,sourceId:prior.sourceId,status:done?'completed':prior.closed?'closed-incomplete':'waiting',
      receipts:done?prior.steps.filter(s=>s.state==='confirmed').map(s=>({operationId:s.operationId,entityId:s.entityId,
        ...(s.spaceId===undefined?{}:{spaceId:s.spaceId}),sourceId:s.sourceId||prior.sourceId,sha256:s.sha256,revision:s.revision,changed:s.changed})):[]};
  });
  return {state:completed(task)?'completed':task.closed?'closed-incomplete':rows.every(d=>d.status==='completed')?'ready':'blocked',
    readyForJournaledEdits:!task.closed&&rows.every(d=>d.status==='completed'),dependencies:rows,authorizesAction:false};
}
