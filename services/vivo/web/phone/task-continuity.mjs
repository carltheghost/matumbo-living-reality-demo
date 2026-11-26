/** Local, owner-attached task evidence. Never executes or restores an action on load. */
import {TASK_JOURNAL_SCHEMA as SCHEMA,LEGACY_TASK_JOURNAL_SCHEMA,normalizePrerequisites,validateMissionGraph,addPrerequisites,assertMissionReady,completeMissionTask,missionView} from './mission-graph.mjs';
import {rankMissionAgents} from './mission-orchestrator.mjs';
import {compileMissionPlan,buildPlannedTasks,validatePlanMetadata,summarizeMissionPlans} from './mission-planner.mjs';
import {diagnoseMissionTask,recoverySnapshot,reopenReviewedTask,validateRecoveryHistory} from './mission-recovery.mjs';
import {collectMissionExperience,taskMissionExperience} from './mission-experience.mjs';
import {selectMissionEvidence,normalizeMissionRecall,recallMissionEvidence} from './mission-recall.mjs';
import {normalizeMissionTrace,traceMissionEvidence} from './mission-associations.mjs';
import {normalizeMissionForecast,forecastMissionEvidence} from './mission-forecast.mjs';
import {validateScenario,compareMissionScenarios} from './mission-scenarios.mjs';
import {compareMissionStrategies} from './mission-strategy.mjs';
import {reviewMissionStrategies} from './mission-critic.mjs';
const TOOL='task.progress',RECALL='neural.missionRecall',TRACE='neural.missionTrace',FORECAST='neural.missionForecast',LIMIT=16,STEPS=64,HANDOFFS=16;
const fail=code=>Object.assign(new Error(code),{code});
const need=(condition,code)=>{if(!condition)throw fail(code);};
const id=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f]/.test(x);
const scopeOf=e=>id(e?.snapshot?.worldId)&&id(e?.branchId)?{worldId:e.snapshot.worldId,branchId:e.branchId}:null;
const keyOf=s=>JSON.stringify([s.worldId,s.branchId]);
const unresolved=s=>s.state==='pending'||s.state==='conflict';
const fingerprint=x=>JSON.stringify({worldId:x.worldId,branchId:x.branchId,eyeId:x.eyeId,spaceId:x.spaceId,entityId:x.entityId,baseRevision:x.baseRevision,delta:x.delta,geometry:x.geometry??null});
const digest=async text=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
const empty=key=>({schema:SCHEMA,key,tasks:[]});
const valid=(journal,key)=>{
  need((journal?.schema===SCHEMA||journal?.schema===LEGACY_TASK_JOURNAL_SCHEMA)&&journal.key===key&&Array.isArray(journal.tasks)&&journal.tasks.length<=LIMIT,'TASK_STORAGE_INVALID');
  const tasks=new Set(),operations=new Set();
  for(const t of journal.tasks){
    need(id(t.id)&&id(t.sourceId)&&typeof t.title==='string'&&t.title.length>0&&t.title.length<=100&&Number.isSafeInteger(t.epoch)&&t.epoch>=1&&typeof t.closed==='boolean'&&Array.isArray(t.steps)&&t.steps.length<=STEPS&&!tasks.has(t.id),'TASK_STORAGE_INVALID');tasks.add(t.id);
    const history=t.handoffs===undefined?[]:t.handoffs;
    need(Array.isArray(history)&&history.length<=HANDOFFS,'TASK_STORAGE_INVALID');
    let owner=history.length?history[0]?.from:t.sourceId,epoch=0;const owners=new Set([owner]);
    for(const h of history){need(h&&id(h.from)&&id(h.to)&&h.from===owner&&h.to!==h.from&&Number.isSafeInteger(h.epoch)&&h.epoch>epoch&&h.epoch<=t.epoch,'TASK_STORAGE_INVALID');owner=h.to;epoch=h.epoch;owners.add(owner);}
    need(owner===t.sourceId,'TASK_STORAGE_INVALID');
    for(const s of t.steps){need(s&&(s.sourceId===undefined?history.length===0:owners.has(s.sourceId))&&(s.spaceId===undefined||id(s.spaceId)),'TASK_STORAGE_INVALID');need(id(s.operationId)&&id(s.entityId)&&/^[a-f0-9]{64}$/.test(s.sha256)&&['pending','confirmed','conflict','not-dispatched'].includes(s.state)&&!operations.has(s.operationId),'TASK_STORAGE_INVALID');operations.add(s.operationId);if(s.state==='confirmed')need(Number.isSafeInteger(s.revision)&&s.revision>=0&&typeof s.changed==='boolean','TASK_STORAGE_INVALID');}
  }
  return validateRecoveryHistory(validatePlanMetadata(validateMissionGraph(journal)));
};
/** Atomic same-origin IndexedDB updates; deliberately no volatile fallback. */
export class IndexedDbTaskStore {
  constructor(factory=globalThis.indexedDB){this.factory=factory;}
  async transact(key,update){
    need(this.factory,'TASK_STORAGE_UNAVAILABLE');
    const db=await new Promise((resolve,reject)=>{const r=this.factory.open('vivo-agent-task-journal',1);r.onupgradeneeded=()=>r.result.createObjectStore('scopes');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(fail('TASK_STORAGE_BLOCKED'));});
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction('scopes','readwrite'),store=tx.objectStore('scopes'),read=store.get(key);let result,error;
      read.onsuccess=()=>{try{const journal=valid(read.result??empty(key),key);result=update(journal);valid(journal,key);store.put(journal,key);}catch(e){error=e;tx.abort();}};
      tx.oncomplete=()=>resolve(structuredClone(result));tx.onabort=()=>reject(error||tx.error||fail('TASK_STORAGE_ABORTED'));tx.onerror=()=>reject(error||tx.error||fail('TASK_STORAGE_FAILED'));
    });}finally{db.close();}
  }
}
/** Host is trusted; its native registry remains the only world-action authority. */
export function createTaskContinuity({registry,downstream,validateEdit,getEnvelope,store=new IndexedDbTaskStore(),newId=()=>crypto.randomUUID()}){
  const bindings=new Map(),attaching=new Map(),recallGrants=new Map();let currentKey=null,lastWarning=null,scopeEpoch=0,planDraft=null,recoveryDraft=null;
  const active=session=>{const a=registry.agentController.assertActive(session);return {sourceId:a.sourceId,sessionId:a.sessionId,generation:a.generation};};
  const sameAgent=(a,b)=>a?.sessionId===b?.sessionId&&a?.generation===b?.generation&&a?.sourceId===b?.sourceId;
  function syncScope(){const scope=scopeOf(getEnvelope());const key=scope?keyOf(scope):null;if(key!==currentKey){clear();currentKey=key;}return key;}
  function scopeKey(){const key=syncScope();need(key,'TASK_WORLD_NOT_OPEN');return key;}
  const tx=(key,fn)=>store.transact(key,j=>fn(valid(j,key)));
  const find=(j,taskId)=>{const task=j.tasks.find(t=>t.id===taskId);need(task,'TASK_NOT_FOUND');return task;};
  const owns=(j,b)=>{const t=find(j,b.taskId);need(!t.closed&&t.sourceId===b.agent.sourceId&&t.epoch===b.epoch,'TASK_ATTACHMENT_STALE');return t;};
  function binding(session){syncScope();const agent=active(session),b=bindings.get(agent.sessionId);if(b&&!sameAgent(b.agent,agent)){bindings.delete(agent.sessionId);return null;}return b||null;}
  function checkBinding(b){need(syncScope()===b.key&&bindings.get(b.agent.sessionId)===b&&sameAgent(active(b.agent),b.agent),'TASK_ATTACHMENT_STALE');}
  function pause(session){const sessionId=typeof session==='string'?session:session?.sessionId;bindings.delete(sessionId);attaching.delete(sessionId);recallGrants.delete(sessionId);}
  function clear(){bindings.clear();attaching.clear();recallGrants.clear();planDraft=null;recoveryDraft=null;scopeEpoch++;}
  // Owner-side review only. The preview is kept in this host, not entrusted to
  // a mutable client response. Saving never attaches or dispatches a task.
  function assertPlanCurrent(draft){
    need(syncScope()===draft.key&&scopeEpoch===draft.epoch&&planDraft===draft,'PLAN_PREVIEW_STALE');
  }
  function assertPlanAgents(draft){
    for(const step of draft.compiled.steps){
      try{need(sameAgent(active(step.agent),step.agent),'PLAN_AGENT_STALE');}catch{throw fail('PLAN_AGENT_STALE');}
    }
  }
  async function previewPlan(spec,defaultSession=null){
    const key=scopeKey(),epoch=scopeEpoch;
    need(!planDraft?.committing,'PLAN_COMMIT_IN_PROGRESS');
    planDraft=null;
    const defaultSourceId=defaultSession===null?null:active(defaultSession).sourceId;
    const agents=[];
    for(const candidate of registry.agents?.()||[]){
      try{const a=active(candidate);if(sameAgent(a,candidate))agents.push({...a,status:'active'});}catch{}
    }
    const compiled=compileMissionPlan({objective:spec?.objective,steps:spec?.steps,defaultSourceId},agents);
    const draft={token:newId(),key,epoch,compiled,ready:false,committing:false};
    planDraft=draft;
    try{
      const remaining=await tx(key,j=>{
        assertPlanCurrent(draft);assertPlanAgents(draft);
        const rows=buildPlannedTasks(j,compiled,draft.token,LIMIT);
        return LIMIT-j.tasks.length-rows.length;
      });
      assertPlanCurrent(draft);assertPlanAgents(draft);draft.ready=true;
      return structuredClone({token:draft.token,...compiled,remainingAfterSave:remaining});
    }catch(error){if(planDraft===draft)planDraft=null;throw error;}
  }
  function discardPlan(token){if(planDraft&&planDraft.token===token&&!planDraft.committing)planDraft=null;}
  async function commitPlan(token){
    const key=scopeKey(),draft=planDraft;
    need(draft&&draft.token===token&&draft.key===key&&draft.ready&&!draft.committing,'PLAN_PREVIEW_STALE');
    assertPlanCurrent(draft);draft.committing=true;
    try{
      return await tx(key,j=>{
        assertPlanCurrent(draft);assertPlanAgents(draft);
        const rows=buildPlannedTasks(j,draft.compiled,draft.token,LIMIT);
        j.tasks.push(...rows);
        return {planId:draft.token,objective:draft.compiled.objective,scopeKey:key,
          created:rows.map(t=>({taskId:t.id,sourceId:t.sourceId,stepKey:t.plan.stepKey})),authorizesAction:false};
      });
    }finally{if(planDraft===draft)planDraft=null;}
  }
  function recommendationFor(j,task,ignorePending=null,simulateReadiness=false){
    const attachments=[];
    for(const b of bindings.values()){
      const t=j.tasks.find(t=>t.id===b.taskId);
      if(b.key!==currentKey||!t||t.closed||t.epoch!==b.epoch||t.sourceId!==b.agent.sourceId)continue;
      try{if(sameAgent(active(b.agent),b.agent))attachments.push({taskId:t.id,sessionId:b.agent.sessionId});}catch{}
    }
    const agents=(registry.agents?.()||[]).map(a=>{
      let tools=[],status=a.status;
      try{if(sameAgent(active(a),a))tools=downstream.listFor(a).map(t=>t.name);else status='inactive';}catch{status='inactive';}
      return {...a,status,tools,attachmentPending:a.sessionId!==ignorePending&&attaching.has(a.sessionId)};
    });
    const mission=missionView(j,task);
    // Only the read-only strategy analyzer may request a hypothetical readiness
    // view. Historical prerequisite evidence and all other eligibility gates stay real.
    return rankMissionAgents({tasks:j.tasks,task,agents,attachments,mission:simulateReadiness?{...mission,readyForJournaledEdits:true}:mission});
  }
  function assertRecoveryCurrent(draft){
    need(syncScope()===draft.key&&scopeEpoch===draft.epoch&&recoveryDraft===draft,'RECOVERY_PREVIEW_STALE');
  }
  async function diagnose(taskId){
    const key=scopeKey(),epoch=scopeEpoch;
    need(!recoveryDraft?.committing,'RECOVERY_COMMIT_IN_PROGRESS');
    const draft={token:newId(),key,epoch,taskId,snapshot:null,committing:false};
    recoveryDraft=draft;
    try{
      const result=await tx(key,j=>{
        assertRecoveryCurrent(draft);
        const task=find(j,taskId),report=diagnoseMissionTask(j,taskId);
        const roots=report.roots.map(row=>{
          // Show a possible replacement using existing live capabilities and
          // related changed receipts. Hypothetical reopening never modifies the journal.
          if(row.waiting.length||!['closed-incomplete','review-completion','ready-for-work'].includes(row.state))return row;
          const original=find(j,row.taskId);
          const candidate=recommendationFor(j,row.canReopen?{...original,closed:false}:original);
          const top=candidate.candidates.find(a=>a.sessionId===candidate.recommended?.sessionId);
          return {...row,assignment:{sourceId:top?.sourceId||null,reason:candidate.reason,
            relatedChangedReceipts:top?.relatedChangedReceipts??null,memoryAvailable:top?.memoryAvailable??false,
            afterReopen:row.canReopen,authorizesAction:false}};
        });
        return {report:{...report,roots},snapshot:report.target.canReopen?recoverySnapshot(task):null};
      });
      assertRecoveryCurrent(draft);
      draft.snapshot=result.snapshot;
      if(!draft.snapshot)recoveryDraft=null;
      return {...result.report,reviewToken:draft.snapshot?draft.token:null};
    }catch(error){if(recoveryDraft===draft)recoveryDraft=null;throw error;}
  }
  function discardRecovery(token){if(recoveryDraft&&recoveryDraft.token===token&&!recoveryDraft.committing)recoveryDraft=null;}
  async function commitRecovery(token,reason){
    const key=scopeKey(),draft=recoveryDraft;
    need(draft&&draft.token===token&&draft.key===key&&draft.snapshot&&!draft.committing,'RECOVERY_PREVIEW_STALE');
    assertRecoveryCurrent(draft);draft.committing=true;
    try{
      return await tx(key,j=>{
        assertRecoveryCurrent(draft);
        const task=find(j,draft.taskId);
        need(recoverySnapshot(task)===draft.snapshot,'RECOVERY_PREVIEW_STALE');
        const record=reopenReviewedTask(task,reason);
        return {taskId:task.id,epoch:task.epoch,sourceId:task.sourceId,record,authorizesAction:false};
      });
    }finally{if(recoveryDraft===draft)recoveryDraft=null;}
  }
  async function reviewStrategy(input){
    const query=validateScenario(input),key=scopeKey(),epoch=scopeEpoch;
    const assertCurrent=()=>need(syncScope()===key&&scopeEpoch===epoch,'CRITIC_SCOPE_STALE');
    const result=await tx(key,j=>{
      assertCurrent();
      const tasks=query.taskIds.map(taskId=>find(j,taskId));
      const rankings=new Map(tasks.filter(t=>t.completed!==true).map(t=>[t.id,recommendationFor(j,t,null,true)]));
      return {...reviewMissionStrategies({tasks:j.tasks,taskIds:query.taskIds,rankings,unavailableSourceIds:query.unavailableSourceIds},compareMissionStrategies,compareMissionScenarios),scopeKey:key,scopeEpoch:epoch};
    });
    assertCurrent();return result;
  }
  async function compareStrategy(input){
    const query=validateScenario(input),key=scopeKey(),epoch=scopeEpoch;
    const assertCurrent=()=>need(syncScope()===key&&scopeEpoch===epoch,'STRATEGY_SCOPE_STALE');
    const result=await tx(key,j=>{
      assertCurrent();
      const tasks=query.taskIds.map(taskId=>find(j,taskId));
      const rankings=new Map(tasks.filter(t=>t.completed!==true).map(t=>[t.id,recommendationFor(j,t,null,true)]));
      return {...compareMissionStrategies({tasks:j.tasks,taskIds:query.taskIds,rankings,unavailableSourceIds:query.unavailableSourceIds},compareMissionScenarios),scopeKey:key,scopeEpoch:epoch};
    });
    assertCurrent();return result;
  }
  async function compareScenario(input){
    const query=validateScenario(input),key=scopeKey(),epoch=scopeEpoch;
    const assertCurrent=()=>need(syncScope()===key&&scopeEpoch===epoch,'SCENARIO_SCOPE_STALE');
    const result=await tx(key,j=>{
      assertCurrent();
      const tasks=query.taskIds.map(taskId=>find(j,taskId));
      const rankings=new Map(tasks.map(t=>[t.id,recommendationFor(j,t)]));
      return {...compareMissionScenarios({tasks,rankings,unavailableSourceIds:query.unavailableSourceIds}),scopeKey:key,scopeEpoch:epoch};
    });
    assertCurrent();return result;
  }
  async function recommend(taskId){
    const key=scopeKey(),epoch=scopeEpoch;
    const result=await tx(key,j=>{const t=find(j,taskId);return {...recommendationFor(j,t),taskId:t.id,sourceId:t.sourceId,epoch:t.epoch,scopeKey:key,scopeEpoch:epoch};});
    need(syncScope()===key&&scopeEpoch===epoch,'TASK_ASSIGNMENT_STALE');return result;
  }
  async function approveRecommendation(plan){
    const key=scopeKey();
    need(plan&&plan.state==='recommended'&&id(plan.taskId)&&id(plan.sourceId)&&Number.isSafeInteger(plan.epoch)&&plan.epoch>=1&&plan.scopeKey===key&&plan.scopeEpoch===scopeEpoch,'TASK_ASSIGNMENT_STALE');
    const choice=plan.recommended;
    need(choice&&id(choice.sourceId)&&id(choice.sessionId)&&Number.isSafeInteger(choice.generation)&&choice.generation>=1,'TASK_ASSIGNMENT_STALE');
    const selected={sourceId:choice.sourceId,sessionId:choice.sessionId,generation:choice.generation};
    const expected={taskId:plan.taskId,sourceId:plan.sourceId,epoch:plan.epoch,scopeKey:key,scopeEpoch:scopeEpoch,recommended:selected};
    need(sameAgent(active(selected),selected)&&!attaching.has(selected.sessionId),'TASK_ASSIGNMENT_STALE');
    const transfer=selected.sourceId!==expected.sourceId?{sourceId:expected.sourceId,epoch:expected.epoch}:null;
    return attach(selected,expected.taskId,null,transfer,[],expected);
  }
  async function attach(session,taskId,title,transfer=null,dependsOn=[],approved=null){
    const prerequisites=normalizePrerequisites(dependsOn);
    const key=scopeKey(),agent=active(session),request={};
    // A rejected handoff must not detach the recipient's unrelated task.
    // A successful attachment replaces its earlier volatile binding.
    if(!transfer&&!approved)pause(agent);attaching.set(agent.sessionId,request);
    try{const chosen=await tx(key,j=>{
      let t;
      if(approved){
        need(syncScope()===key&&approved.scopeKey===key&&approved.scopeEpoch===scopeEpoch&&attaching.get(agent.sessionId)===request&&sameAgent(active(agent),agent),'TASK_ASSIGNMENT_STALE');
        const target=find(j,taskId);
        need(target.sourceId===approved.sourceId&&target.epoch===approved.epoch&&sameAgent(recommendationFor(j,target,agent.sessionId).recommended,agent),'TASK_ASSIGNMENT_STALE');
      }
      if(taskId===null){need(typeof title==='string'&&title.trim().length>0&&title.trim().length<=100,'TASK_TITLE_INVALID');need(j.tasks.length<LIMIT,'TASK_CAPACITY');t={id:newId(),sourceId:agent.sourceId,title:title.trim(),epoch:1,closed:false,steps:[]};addPrerequisites(j,t,prerequisites);j.tasks.push(t);}
      else{
        t=find(j,taskId);
        if(transfer){
          need(!t.closed&&t.sourceId===transfer.sourceId&&t.epoch===transfer.epoch,'TASK_HANDOFF_STALE');
          need(t.sourceId!==agent.sourceId,'TASK_HANDOFF_SAME_SOURCE');
          need(!t.steps.some(unresolved),'TASK_RECONCILIATION_REQUIRED');
          need((t.handoffs?.length||0)<HANDOFFS,'TASK_HANDOFF_CAPACITY');
          need(t.epoch<Number.MAX_SAFE_INTEGER,'TASK_EPOCH_EXHAUSTED');
          // Backfill pre-handoff v1 steps while their original source is still known.
          for(const step of t.steps)if(step.sourceId===undefined)step.sourceId=t.sourceId;
          (t.handoffs??=[]).push({from:t.sourceId,to:agent.sourceId,epoch:t.epoch+1});
          t.sourceId=agent.sourceId;t.epoch++;
        }else{need(!t.closed&&t.sourceId===agent.sourceId,'TASK_SOURCE_MISMATCH');need(t.epoch<Number.MAX_SAFE_INTEGER,'TASK_EPOCH_EXHAUSTED');t.epoch++;}
      }
      return {taskId:t.id,epoch:t.epoch};
    });
    need(syncScope()===key&&attaching.get(agent.sessionId)===request&&sameAgent(active(agent),agent),'TASK_ATTACHMENT_STALE');
    const b={...chosen,key,agent};recallGrants.delete(agent.sessionId);bindings.set(agent.sessionId,b);return {...chosen,sourceId:agent.sourceId};
    }finally{if(attaching.get(agent.sessionId)===request)attaching.delete(agent.sessionId);}
  }
  async function handoff(session,taskId,expected){
    need(id(taskId)&&id(expected?.sourceId)&&Number.isSafeInteger(expected?.epoch)&&expected.epoch>=1,'TASK_HANDOFF_EXPECTATION_REQUIRED');
    return attach(session,taskId,null,{sourceId:expected.sourceId,epoch:expected.epoch});
  }
  async function finish(session){const b=binding(session);need(b,'TASK_NOT_ATTACHED');checkBinding(b);pause(b.agent);await tx(b.key,j=>{const t=owns(j,b);t.closed=true;});}
  async function complete(session,expected){
    const b=binding(session);need(b,'TASK_NOT_ATTACHED');checkBinding(b);
    need(expected?.taskId===b.taskId&&expected?.epoch===b.epoch,'TASK_COMPLETION_EXPECTATION_REQUIRED');
    const result=await tx(b.key,j=>{checkBinding(b);const t=owns(j,b);return completeMissionTask(j,t);});
    if(bindings.get(b.agent.sessionId)===b)pause(b.agent);
    return result;
  }
  async function inspect(){const key=scopeKey(),epoch=scopeEpoch;const tasks=await tx(key,j=>j.tasks);need(syncScope()===key&&scopeEpoch===epoch,'TASK_ATTACHMENT_STALE');for(const [sid,b] of bindings){try{checkBinding(b);const t=tasks.find(t=>t.id===b.taskId);if(t&&!t.closed&&t.epoch===b.epoch)continue;}catch{}bindings.delete(sid);recallGrants.delete(sid);}return {tasks,missionRecallGrants:[...bindings.values()].flatMap(b=>{const grant=recallGrantFor(b);return grant?[{taskId:b.taskId,sessionId:b.agent.sessionId,sourceTaskIds:[...grant.sourceTaskIds]}]:[];}),plans:summarizeMissionPlans(tasks),experience:collectMissionExperience(tasks),attachments:[...bindings.values()].map(b=>({taskId:b.taskId,sourceId:b.agent.sourceId,sessionId:b.agent.sessionId})),warning:lastWarning};}
  async function reconcile(){
    const envelope=getEnvelope(),key=scopeKey();need(scopeOf(envelope)&&keyOf(scopeOf(envelope))===key,'TASK_SCOPE_CHANGED');
    const receipts=Array.isArray(envelope.snapshot.localOperationResults)?envelope.snapshot.localOperationResults:[];
    const byId=new Map();for(const r of receipts)if(id(r?.operationId)&&typeof r.fingerprint==='string'&&r.fingerprint.length<=20000){byId.set(r.operationId,{sha256:await digest(r.fingerprint),revision:r.result?.revision,changed:r.result?.changed});}
    need(syncScope()===key,'TASK_SCOPE_CHANGED');
    const result=await tx(key,j=>{for(const t of j.tasks)for(const s of t.steps){if(s.state!=='pending')continue;const r=byId.get(s.operationId);if(!r)continue;if(r.sha256!==s.sha256){s.state='conflict';continue;}if(Number.isSafeInteger(r.revision)&&r.revision>=0&&typeof r.changed==='boolean'){s.state='confirmed';s.revision=r.revision;s.changed=r.changed;}}return j.tasks;});
    need(syncScope()===key,'TASK_SCOPE_CHANGED');lastWarning=null;return result;
  }
  function recallGrantFor(b){
    const g=b&&recallGrants.get(b.agent.sessionId);
    return g?.ready&&g.binding===b?g:null;
  }
  function assertRecallGrant(b,g){
    checkBinding(b);need(recallGrants.get(b.agent.sessionId)===g&&g.binding===b,'MISSION_RECALL_GRANT_STALE');
  }
  function revokeMissionRecall(session){const sid=typeof session==='string'?session:session?.sessionId;recallGrants.delete(sid);}
  async function grantMissionRecall(session,expected){
    const b=binding(session);need(b,'TASK_NOT_ATTACHED');checkBinding(b);
    need(expected?.taskId===b.taskId&&expected?.epoch===b.epoch,'MISSION_RECALL_TARGET_STALE');
    const sourceTaskIds=normalizePrerequisites(expected?.sourceTaskIds);
    const g={binding:b,sourceTaskIds,ready:false};
    recallGrants.set(b.agent.sessionId,g);
    try{
      await tx(b.key,j=>{assertRecallGrant(b,g);owns(j,b);selectMissionEvidence(j.tasks,b.taskId,sourceTaskIds);});
      assertRecallGrant(b,g);g.ready=true;
      return {taskId:b.taskId,sourceTaskIds:[...sourceTaskIds],readOnly:true,authorizesAction:false};
    }catch(e){if(recallGrants.get(b.agent.sessionId)===g)recallGrants.delete(b.agent.sessionId);throw e;}
  }
  async function recallFor(b,args,name){
    need(b,'TASK_NOT_ATTACHED');const g=recallGrantFor(b);need(g,'MISSION_RECALL_NOT_GRANTED');
    const normalize=name===TRACE?normalizeMissionTrace:name===FORECAST?normalizeMissionForecast:normalizeMissionRecall;
    const query=normalize(args);assertRecallGrant(b,g);
    const result=await tx(b.key,j=>{
      assertRecallGrant(b,g);owns(j,b);
      const [worldId,projectId]=JSON.parse(b.key);
      const tasks=selectMissionEvidence(j.tasks,b.taskId,g.sourceTaskIds);
      const read=name===TRACE?traceMissionEvidence:name===FORECAST?forecastMissionEvidence:recallMissionEvidence;
      return {...read({scope:{worldId,projectId},tasks,args:query}),targetTaskId:b.taskId,attachmentEpoch:b.epoch};
    });
    assertRecallGrant(b,g);return result;
  }
  function listFor(session){
    const tools=downstream.listFor(session);
    try{const b=binding(session);if(b)return [...tools,{name:TOOL,description:'Read the attached local task journal. This grants no action authority.'},
      ...(recallGrantFor(b)?[{name:RECALL,description:'Read owner-selected completed mission evidence for this attachment. Exact spaceId and entityId, optional offset and limit (1–32). No action authority.'},{name:TRACE,description:'Trace an exact evidence association between two objects using only owner-shared completed tasks. Arguments: from and to (spaceId, entityId), optional maxHops (1–8). Associations are not causal proof or action authority.'},{name:FORECAST,description:'Suggest a next object to inspect from distinct owner-shared completed task sequences. Exact spaceId and entityId. Returns historical counts, competing evidence, abstention and retrospective evaluation; never a calibrated probability or action authority.'}]:[])];}catch{}
    return tools;
  }
  async function invokeFor(session,name,args={}){
    if(name!==TOOL&&name!==RECALL&&name!==TRACE&&name!==FORECAST&&name!=='vivo.world.edit')return downstream.invokeFor(session,name,args);
    const b=binding(session);
    if(name===RECALL||name===TRACE||name===FORECAST)return recallFor(b,args,name);
    if(name===TOOL){need(b,'TASK_NOT_ATTACHED');need(args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).length===0,'TASK_ARGUMENTS_INVALID');const result=await tx(b.key,j=>{const task=owns(j,b);const mission=missionView(j,task);return {task,mission,experience:taskMissionExperience(task,mission)};});checkBinding(b);return {schema:SCHEMA,...result,readOnly:true,authorizesAction:false};}
    if(!b)return downstream.invokeFor(session,name,args);
    checkBinding(b);const safe=structuredClone(args);const v=validateEdit(safe,getEnvelope());need(!v.prior,'TASK_OPERATION_ALREADY_RECORDED');const sha256=await digest(fingerprint(v));checkBinding(b);
    const step={operationId:v.operationId,entityId:v.entityId,spaceId:v.spaceId,sourceId:b.agent.sourceId,sha256,state:'pending'};
    await tx(b.key,j=>{const t=owns(j,b);assertMissionReady(j,t);need(!j.tasks.some(x=>x.steps.some(s=>s.operationId===step.operationId)),'TASK_OPERATION_ALREADY_RECORDED');need(!t.steps.some(unresolved),'TASK_RECONCILIATION_REQUIRED');need(!j.tasks.some(x=>x!==t&&x.steps.some(s=>unresolved(s)&&s.entityId===step.entityId&&(s.spaceId===undefined||s.spaceId===step.spaceId))),'TASK_OBJECT_RESERVED');need(t.steps.length<STEPS,'TASK_STEP_CAPACITY');t.steps.push(step);});
    try{checkBinding(b);await tx(b.key,j=>owns(j,b));checkBinding(b);}catch(error){await tx(b.key,j=>{const s=find(j,b.taskId).steps.find(x=>x.operationId===step.operationId);if(s?.state==='pending')s.state='not-dispatched';}).catch(()=>{});throw error;}
    try{return await downstream.invokeFor(b.agent,name,safe);}finally{
      // Unknown or expired receipt never means safe to retry. Preserve the
      // native result/error even when journal storage is temporarily unavailable.
      try{if(syncScope()===b.key)await reconcile();}catch{lastWarning='Task evidence could not be refreshed. Review the existing operation before retrying.';}
    }
  }
  return Object.freeze({syncScope,tools:Object.freeze({listFor,invokeFor}),admin:Object.freeze({create:(session,title,dependsOn=[])=>attach(session,null,title,null,dependsOn),complete,recommend,compareScenario,compareStrategy,reviewStrategy,approveRecommendation,previewPlan,commitPlan,discardPlan,diagnose,commitRecovery,discardRecovery,grantMissionRecall,revokeMissionRecall,resume:(session,taskId)=>attach(session,taskId),handoff,pause,clear,finish,inspect,reconcile})});
}
