/** Adaptive diagnosis for the existing journal. Recovery changes task state, not native authority. */
export const MAX_RECOVERIES=16;
const fail=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fail(code);};
const reasonText=x=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=160&&!/[\u0000-\u001f\u007f]/.test(x.trim())?x.trim():null;
const unresolved=s=>s.state==='pending'||s.state==='conflict';
const counts=t=>({confirmed:t.steps.filter(s=>s.state==='confirmed').length,pending:t.steps.filter(s=>s.state==='pending').length,conflict:t.steps.filter(s=>s.state==='conflict').length,notDispatched:t.steps.filter(s=>s.state==='not-dispatched').length});
const recoverable=t=>t.closed&&t.completed!==true&&!t.steps.some(unresolved)&&(t.recoveries?.length||0)<MAX_RECOVERIES&&t.epoch<Number.MAX_SAFE_INTEGER;
const deps=t=>t.dependsOn||[];

// Called after the existing journal and graph validators. Older clients preserve
// this optional metadata; prerequisites and receipt validity remain unchanged.
export function validateRecoveryHistory(journal){
  for(const t of journal.tasks){
    if(t.recoveries===undefined)continue;
    const history=t.recoveries;
    need(Array.isArray(history)&&history.length>0&&history.length<=MAX_RECOVERIES,'RECOVERY_STORAGE_INVALID');
    let epoch=1,steps=0;
    for(const r of history){
      need(r&&Number.isSafeInteger(r.epoch)&&r.epoch>epoch&&r.epoch<=t.epoch&&
        Number.isSafeInteger(r.steps)&&r.steps>=steps&&r.steps<=t.steps.length&&
        Number.isSafeInteger(r.confirmed)&&r.confirmed>=0&&typeof r.reason==='string'&&reasonText(r.reason)===r.reason,'RECOVERY_STORAGE_INVALID');
      const handoffs=t.handoffs||[];
      let owner=handoffs[0]?.from||t.sourceId;
      for(const h of handoffs){if(h.epoch<r.epoch)owner=h.to;need(h.epoch!==r.epoch,'RECOVERY_STORAGE_INVALID');}
      need(r.sourceId===owner,'RECOVERY_STORAGE_INVALID');
      const prior=t.steps.slice(0,r.steps);
      need(!prior.some(unresolved)&&prior.filter(s=>s.state==='confirmed').length===r.confirmed,'RECOVERY_STORAGE_INVALID');
      epoch=r.epoch;steps=r.steps;
    }
  }
  return journal;
}

export function recoverySnapshot(task){return JSON.stringify(task);}

export function reopenReviewedTask(task,reason){
  const text=reasonText(reason);need(text,'RECOVERY_REASON_REQUIRED');
  need(task.closed&&task.completed!==true,'RECOVERY_NOT_ARCHIVED_INCOMPLETE');
  need(!task.steps.some(unresolved),'TASK_RECONCILIATION_REQUIRED');
  need((task.recoveries?.length||0)<MAX_RECOVERIES,'RECOVERY_CAPACITY');
  need(task.epoch<Number.MAX_SAFE_INTEGER,'TASK_EPOCH_EXHAUSTED');
  const record={epoch:task.epoch+1,sourceId:task.sourceId,reason:text,steps:task.steps.length,confirmed:counts(task).confirmed};
  (task.recoveries??=[]).push(record);task.epoch++;task.closed=false;
  return record;
}

function classify(task,waiting){
  if(task.completed===true)return 'completed';
  if(task.steps.some(s=>s.state==='conflict'))return 'receipt-conflict';
  if(task.steps.some(s=>s.state==='pending'))return 'receipt-pending';
  if(task.closed)return recoverable(task)?'closed-incomplete':'recovery-unavailable';
  if(waiting.length)return 'waiting-prerequisites';
  if(task.steps.some(s=>s.state==='confirmed'))return 'review-completion';
  return 'ready-for-work';
}

const actions={
  completed:'No recovery required.',
  'receipt-conflict':'Inspect the conflicting receipt; never replay or override it automatically.',
  'receipt-pending':'Reconcile native receipts. Missing evidence is not permission to retry.',
  'closed-incomplete':'Owner may review and reopen this exact task without erasing its receipts.',
  'recovery-unavailable':'Recovery history or epoch limit reached; keep the archive for review.',
  'waiting-prerequisites':'Resolve the listed prerequisite tasks before continuing.',
  'review-completion':'Review the confirmed native evidence before explicit completion or further work.',
  'ready-for-work':'Review an available agent recommendation or continue an existing attachment.',
};

// Owner-side diagnostic. Traverse only this task and its prerequisite closure;
// deduplicate shared blockers in diamonds. Not an agent-wide memory read tool.
export function diagnoseMissionTask(journal,taskId){
  const map=new Map(journal.tasks.map(t=>[t.id,t]));
  need(map.has(taskId),'TASK_NOT_FOUND');
  const describe=t=>{
    const waiting=deps(t).filter(d=>map.get(d)?.completed!==true),state=classify(t,waiting);
    return {taskId:t.id,title:t.title,sourceId:t.sourceId,epoch:t.epoch,state,waiting,counts:counts(t),canReopen:recoverable(t),next:actions[state]};
  };
  const roots=[],seen=new Set(),stack=new Set();
  function visit(id){
    need(!stack.has(id)&&map.has(id),'RECOVERY_GRAPH_INVALID');
    if(seen.has(id))return;
    stack.add(id);const t=map.get(id),row=describe(t);
    if(row.state!=='completed'){
      if(row.state!=='waiting-prerequisites')roots.push(row);
      for(const d of row.waiting)visit(d);
    }
    stack.delete(id);seen.add(id);
  }
  visit(taskId);
  return {target:describe(map.get(taskId)),roots,authorizesAction:false};
}
