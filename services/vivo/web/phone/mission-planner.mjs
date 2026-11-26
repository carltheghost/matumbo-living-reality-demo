/** Compile owner-reviewed plans into the existing mission journal. No execution or grants. */
export const MAX_PLAN_STEPS=16;
const fail=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fail(code);};
const id=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f]/.test(x);
const stepKey=x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(x);
const clean=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max&&id(v.trim())?v.trim():null;
const objectiveText=v=>clean(v,160);
const unresolved=s=>s.state==='pending'||s.state==='conflict';
const taskId=(planId,key)=>planId+':'+key;

// One line: key | task title | initial source (blank = selected agent) | prerequisite keys.
export function parseMissionPlanLines(text){
  need(typeof text==='string'&&text.length<=8192,'PLAN_LINES_INVALID');
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  need(lines.length>0&&lines.length<=MAX_PLAN_STEPS,'PLAN_STEP_COUNT');
  return lines.map(line=>{
    const columns=line.split('|').map(v=>v.trim());
    need(columns.length===4,'PLAN_LINE_FORMAT');
    const [key,title,sourceId,deps]=columns;
    return {key,title,sourceId:sourceId||null,dependsOn:deps?deps.split(',').map(v=>v.trim()):[]};
  });
}

export function compileMissionPlan({objective,steps,defaultSourceId=null},agents){
  const title=objectiveText(objective);need(title,'PLAN_OBJECTIVE_INVALID');
  need(Array.isArray(steps)&&steps.length>0&&steps.length<=MAX_PLAN_STEPS,'PLAN_STEP_COUNT');
  need(Array.isArray(agents),'PLAN_AGENTS_INVALID');
  const owners=new Map(),seen=new Set();
  for(const a of agents){
    if(a?.status!=='active'||!id(a.sourceId)||!id(a.sessionId)||!Number.isSafeInteger(a.generation)||a.generation<1)continue;
    need(!owners.has(a.sourceId),'PLAN_AGENT_AMBIGUOUS');
    owners.set(a.sourceId,{sourceId:a.sourceId,sessionId:a.sessionId,generation:a.generation});
  }
  const rows=Array.from(steps,s=>{
    need(s&&stepKey(s.key)&&!seen.has(s.key),'PLAN_STEP_KEY_INVALID');seen.add(s.key);
    const label=clean(s.title,100);need(label,'PLAN_TASK_TITLE_INVALID');
    const source=s.sourceId??defaultSourceId;need(id(source)&&owners.has(source),'PLAN_AGENT_UNAVAILABLE');
    const deps=s.dependsOn??[];need(Array.isArray(deps)&&deps.length<MAX_PLAN_STEPS,'PLAN_DEPENDENCIES_INVALID');
    const dependsOn=Array.from(deps);need(dependsOn.every(stepKey)&&new Set(dependsOn).size===dependsOn.length,'PLAN_DEPENDENCIES_INVALID');
    return {key:s.key,title:label,sourceId:source,agent:{...owners.get(source)},dependsOn};
  });
  const byKey=new Map(rows.map(r=>[r.key,r]));
  for(const row of rows)need(row.dependsOn.every(d=>d!==row.key&&byKey.has(d)),'PLAN_DEPENDENCIES_INVALID');
  // Kahn-style stable layers. Forward references are allowed; cycles are not.
  const remaining=new Map(byKey),stages=new Map(),ordered=[];
  while(remaining.size){
    const ready=[...remaining.values()].filter(r=>r.dependsOn.every(d=>stages.has(d)));
    need(ready.length,'PLAN_DEPENDENCY_CYCLE');
    for(const row of ready){
      const stage=1+Math.max(0,...row.dependsOn.map(d=>stages.get(d)));
      stages.set(row.key,stage);remaining.delete(row.key);ordered.push({...row,stage});
    }
  }
  return {objective:title,steps:ordered,stageCount:Math.max(...stages.values()),authorizesAction:false};
}

// Build every row before touching storage. The caller appends the batch in one transaction.
export function buildPlannedTasks(journal,plan,planId,limit=MAX_PLAN_STEPS){
  need(id(planId)&&planId.length<=200,'PLAN_ID_INVALID');
  need(journal.tasks.length+plan.steps.length<=limit,'TASK_CAPACITY');
  need(!journal.tasks.some(t=>t.plan?.id===planId),'PLAN_ALREADY_SAVED');
  const existing=new Set(journal.tasks.map(t=>t.id));
  const rows=plan.steps.map(s=>({id:taskId(planId,s.key),sourceId:s.sourceId,title:s.title,epoch:1,closed:false,steps:[],
    dependsOn:s.dependsOn.map(d=>taskId(planId,d)),plan:{id:planId,objective:plan.objective,stepKey:s.key,stepCount:plan.steps.length}}));
  need(rows.every(r=>id(r.id)&&!existing.has(r.id))&&new Set(rows.map(r=>r.id)).size===rows.length,'PLAN_TASK_ID_CONFLICT');
  // Use the existing graph's validation in the enclosing transaction as well.
  validatePlanMetadata({tasks:[...journal.tasks,...rows]});
  return rows;
}

// Plan metadata is advisory grouping. Existing v2 dependency and receipt rules remain authoritative.
export function validatePlanMetadata(journal){
  const groups=new Map(),byId=new Map(journal.tasks.map(t=>[t.id,t]));
  for(const t of journal.tasks){
    if(t.plan===undefined)continue;
    const p=t.plan;
    need(p&&id(p.id)&&p.id.length<=200&&typeof p.objective==='string'&&objectiveText(p.objective)===p.objective&&stepKey(p.stepKey)&&
      Number.isSafeInteger(p.stepCount)&&p.stepCount>=1&&p.stepCount<=MAX_PLAN_STEPS&&t.id===taskId(p.id,p.stepKey),'PLAN_STORAGE_INVALID');
    const group=groups.get(p.id)||{objective:p.objective,count:p.stepCount,keys:new Set()};
    need(group.objective===p.objective&&group.count===p.stepCount&&!group.keys.has(p.stepKey),'PLAN_STORAGE_INVALID');
    group.keys.add(p.stepKey);groups.set(p.id,group);
    need((t.dependsOn||[]).every(d=>byId.get(d)?.plan?.id===p.id),'PLAN_STORAGE_INVALID');
  }
  for(const g of groups.values())need(g.keys.size===g.count,'PLAN_STORAGE_INVALID');
  return journal;
}

export function summarizeMissionPlans(tasks){
  const byId=new Map(tasks.map(t=>[t.id,t])),groups=new Map();
  for(const task of tasks){
    if(!task.plan)continue;
    const p=task.plan,row=groups.get(p.id)||{planId:p.id,objective:p.objective,total:0,completed:0,ready:0,blocked:0,needsReview:0,closedIncomplete:0};
    row.total++;
    if(task.completed===true)row.completed++;
    else if(task.closed)row.closedIncomplete++;
    else if(task.steps.some(unresolved))row.needsReview++;
    else if((task.dependsOn||[]).every(d=>byId.get(d)?.completed===true))row.ready++;
    else row.blocked++;
    groups.set(p.id,row);
  }
  return [...groups.values()];
}
