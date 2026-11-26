/** Local, owner-attached task evidence. Never executes or restores an action on load. */
const SCHEMA='vivo.agent-task-journal/1',TOOL='task.progress',LIMIT=16,STEPS=64;
const fail=code=>Object.assign(new Error(code),{code});
const need=(condition,code)=>{if(!condition)throw fail(code);};
const id=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f]/.test(x);
const scopeOf=e=>id(e?.snapshot?.worldId)&&id(e?.branchId)?{worldId:e.snapshot.worldId,branchId:e.branchId}:null;
const keyOf=s=>JSON.stringify([s.worldId,s.branchId]);
const fingerprint=x=>JSON.stringify({worldId:x.worldId,branchId:x.branchId,eyeId:x.eyeId,spaceId:x.spaceId,entityId:x.entityId,baseRevision:x.baseRevision,delta:x.delta,geometry:x.geometry??null});
const digest=async text=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
const empty=key=>({schema:SCHEMA,key,tasks:[]});
const dependencies=t=>Object.hasOwn(t,'dependsOn')?t.dependsOn:[];
const unresolved=s=>s.state==='pending'||s.state==='conflict';
// Derived from the same journal transaction, never a second mission database.
function collaboration(j){
  const results=new Map();
  for(const t of j.tasks){
    const blockers=dependencies(t).filter(d=>results.get(d)?.state!=='receipt-backed-closed');
    const confirmed=t.steps.filter(s=>s.state==='confirmed');
    const state=t.steps.some(unresolved)?'review-required':t.closed
      ?(!blockers.length&&confirmed.length?'receipt-backed-closed':'closed-unverified')
      :(blockers.length?'blocked':'ready');
    results.set(t.id,{taskId:t.id,state,blockers,confirmedCount:confirmed.length});
  }
  return results;
}
function handoff(j,t){
  const states=collaboration(j),own=states.get(t.id);
  return {...own,dependencies:dependencies(t).map(taskId=>{
    const previous=j.tasks.find(x=>x.id===taskId),state=states.get(taskId);
    // Owner-selected direct predecessors only. No full journal or memory sharing.
    return {taskId,state:state.state,confirmedCount:state.confirmedCount,evidence:state.state==='receipt-backed-closed'
      ?previous.steps.filter(s=>s.state==='confirmed').map(({operationId,entityId,sha256,revision,changed})=>({operationId,entityId,sha256,revision,changed})):[]};
  })};
}
function assertReady(j,t){need(!collaboration(j).get(t.id).blockers.length,'TASK_DEPENDENCIES_UNRESOLVED');}
const valid=(journal,key)=>{
  need(journal?.schema===SCHEMA&&journal.key===key&&Array.isArray(journal.tasks)&&journal.tasks.length<=LIMIT,'TASK_STORAGE_INVALID');
  const tasks=new Set(),operations=new Set();
  for(const t of journal.tasks){
    need(id(t.id)&&id(t.sourceId)&&typeof t.title==='string'&&t.title.length>0&&t.title.length<=100&&Number.isSafeInteger(t.epoch)&&t.epoch>=1&&typeof t.closed==='boolean'&&Array.isArray(t.steps)&&t.steps.length<=STEPS&&!tasks.has(t.id),'TASK_STORAGE_INVALID');
    const deps=dependencies(t);
    // Dependencies can reference only earlier tasks. This also rejects cycles,
    // missing IDs and malformed legacy/migrated storage without guessing.
    need(Array.isArray(deps)&&deps.length<=4&&Array.from(deps).every(d=>id(d)&&tasks.has(d))&&new Set(deps).size===deps.length,'TASK_STORAGE_INVALID');
    tasks.add(t.id);
    for(const s of t.steps){need(id(s.operationId)&&id(s.entityId)&&(!Object.hasOwn(s,'spaceId')||id(s.spaceId))&&/^[a-f0-9]{64}$/.test(s.sha256)&&['pending','confirmed','conflict','not-dispatched'].includes(s.state)&&!operations.has(s.operationId),'TASK_STORAGE_INVALID');operations.add(s.operationId);if(s.state==='confirmed')need(Number.isSafeInteger(s.revision)&&s.revision>=0&&typeof s.changed==='boolean','TASK_STORAGE_INVALID');}
  }
  return journal;
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
  const bindings=new Map(),attaching=new Map();let currentKey=null,lastWarning=null;
  const active=session=>{const a=registry.agentController.assertActive(session);return {sourceId:a.sourceId,sessionId:a.sessionId,generation:a.generation};};
  const sameAgent=(a,b)=>a?.sessionId===b?.sessionId&&a?.generation===b?.generation&&a?.sourceId===b?.sourceId;
  function syncScope(){const scope=scopeOf(getEnvelope());const key=scope?keyOf(scope):null;if(key!==currentKey){clear();currentKey=key;}return key;}
  function scopeKey(){const key=syncScope();need(key,'TASK_WORLD_NOT_OPEN');return key;}
  const tx=(key,fn)=>store.transact(key,j=>fn(valid(j,key)));
  const find=(j,taskId)=>{const task=j.tasks.find(t=>t.id===taskId);need(task,'TASK_NOT_FOUND');return task;};
  const owns=(j,b)=>{const t=find(j,b.taskId);need(!t.closed&&t.sourceId===b.agent.sourceId&&t.epoch===b.epoch,'TASK_ATTACHMENT_STALE');return t;};
  function binding(session){syncScope();const agent=active(session),b=bindings.get(agent.sessionId);if(b&&!sameAgent(b.agent,agent)){bindings.delete(agent.sessionId);return null;}return b||null;}
  function checkBinding(b){need(syncScope()===b.key&&bindings.get(b.agent.sessionId)===b&&sameAgent(active(b.agent),b.agent),'TASK_ATTACHMENT_STALE');}
  function pause(session){const sessionId=typeof session==='string'?session:session?.sessionId;bindings.delete(sessionId);attaching.delete(sessionId);}
  function clear(){bindings.clear();attaching.clear();}
  async function attach(session,taskId,title,dependsOn=[]){
    const key=scopeKey(),agent=active(session),request={};dependsOn=structuredClone(dependsOn);
    // Explicit reattachment replaces any earlier volatile grant, including pending ones.
    pause(agent);attaching.set(agent.sessionId,request);
    try{const chosen=await tx(key,j=>{
      let t;
      if(taskId===null){need(typeof title==='string'&&title.trim().length>0&&title.trim().length<=100,'TASK_TITLE_INVALID');need(j.tasks.length<LIMIT,'TASK_CAPACITY');need(Array.isArray(dependsOn)&&dependsOn.length<=4&&Array.from(dependsOn).every(d=>id(d)&&j.tasks.some(t=>t.id===d))&&new Set(dependsOn).size===dependsOn.length,'TASK_DEPENDENCIES_INVALID');t={id:newId(),sourceId:agent.sourceId,title:title.trim(),epoch:1,closed:false,steps:[],...(dependsOn.length?{dependsOn:[...dependsOn]}:{})};j.tasks.push(t);}
      else{t=find(j,taskId);need(!t.closed&&t.sourceId===agent.sourceId,'TASK_SOURCE_MISMATCH');need(t.epoch<Number.MAX_SAFE_INTEGER,'TASK_EPOCH_EXHAUSTED');t.epoch++;}
      return {taskId:t.id,epoch:t.epoch};
    });
    need(syncScope()===key&&attaching.get(agent.sessionId)===request&&sameAgent(active(agent),agent),'TASK_ATTACHMENT_STALE');
    const b={...chosen,key,agent};bindings.set(agent.sessionId,b);return {...chosen,sourceId:agent.sourceId};
    }finally{if(attaching.get(agent.sessionId)===request)attaching.delete(agent.sessionId);}
  }
  async function finish(session){const b=binding(session);need(b,'TASK_NOT_ATTACHED');checkBinding(b);pause(b.agent);await tx(b.key,j=>{const t=owns(j,b);t.closed=true;});}
  async function inspect(){const key=scopeKey();const {tasks,collaboration:states}=await tx(key,j=>({tasks:j.tasks,collaboration:[...collaboration(j).values()]}));need(syncScope()===key,'TASK_ATTACHMENT_STALE');for(const [sid,b] of bindings){try{checkBinding(b);const t=tasks.find(t=>t.id===b.taskId);if(t&&!t.closed&&t.epoch===b.epoch)continue;}catch{}bindings.delete(sid);}return {tasks,collaboration:states,attachments:[...bindings.values()].map(b=>({taskId:b.taskId,sourceId:b.agent.sourceId,sessionId:b.agent.sessionId})),warning:lastWarning};}
  async function reconcile(){
    const envelope=getEnvelope(),key=scopeKey();need(scopeOf(envelope)&&keyOf(scopeOf(envelope))===key,'TASK_SCOPE_CHANGED');
    const receipts=Array.isArray(envelope.snapshot.localOperationResults)?envelope.snapshot.localOperationResults:[];
    const byId=new Map();for(const r of receipts)if(id(r?.operationId)&&typeof r.fingerprint==='string'&&r.fingerprint.length<=20000){byId.set(r.operationId,{sha256:await digest(r.fingerprint),revision:r.result?.revision,changed:r.result?.changed});}
    need(syncScope()===key,'TASK_SCOPE_CHANGED');
    const result=await tx(key,j=>{for(const t of j.tasks)for(const s of t.steps){if(s.state!=='pending')continue;const r=byId.get(s.operationId);if(!r)continue;if(r.sha256!==s.sha256){s.state='conflict';continue;}if(Number.isSafeInteger(r.revision)&&r.revision>=0&&typeof r.changed==='boolean'){s.state='confirmed';s.revision=r.revision;s.changed=r.changed;}}return j.tasks;});
    need(syncScope()===key,'TASK_SCOPE_CHANGED');lastWarning=null;return result;
  }
  function listFor(session){const tools=downstream.listFor(session);try{if(binding(session))return [...tools,{name:TOOL,description:'Read the attached local task journal. This grants no action authority.'}];}catch{}return tools;}
  async function invokeFor(session,name,args={}){
    if(name!==TOOL&&name!=='vivo.world.edit')return downstream.invokeFor(session,name,args);
    const b=binding(session);
    if(name===TOOL){need(b,'TASK_NOT_ATTACHED');need(args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).length===0,'TASK_ARGUMENTS_INVALID');const result=await tx(b.key,j=>{const task=owns(j,b);return {task,collaboration:handoff(j,task)};});checkBinding(b);return {schema:SCHEMA,...result,readOnly:true,authorizesAction:false};}
    if(!b)return downstream.invokeFor(session,name,args);
    checkBinding(b);const safe=structuredClone(args);const v=validateEdit(safe,getEnvelope());need(!v.prior,'TASK_OPERATION_ALREADY_RECORDED');const sha256=await digest(fingerprint(v));checkBinding(b);
    const step={operationId:v.operationId,entityId:v.entityId,spaceId:v.spaceId,sha256,state:'pending'};
    await tx(b.key,j=>{const t=owns(j,b);need(!j.tasks.some(x=>x.steps.some(s=>s.operationId===step.operationId)),'TASK_OPERATION_ALREADY_RECORDED');assertReady(j,t);need(!t.steps.some(unresolved),'TASK_RECONCILIATION_REQUIRED');need(!j.tasks.some(other=>other.id!==t.id&&other.steps.some(s=>unresolved(s)&&s.entityId===step.entityId&&(!s.spaceId||s.spaceId===step.spaceId))),'TASK_OBJECT_RESERVED');need(t.steps.length<STEPS,'TASK_STEP_CAPACITY');t.steps.push(step);});
    try{checkBinding(b);await tx(b.key,j=>assertReady(j,owns(j,b)));checkBinding(b);}catch(error){await tx(b.key,j=>{const s=find(j,b.taskId).steps.find(x=>x.operationId===step.operationId);if(s?.state==='pending')s.state='not-dispatched';}).catch(()=>{});throw error;}
    try{return await downstream.invokeFor(b.agent,name,safe);}finally{
      // Unknown or expired receipt never means safe to retry. Preserve the
      // native result/error even when journal storage is temporarily unavailable.
      try{if(syncScope()===b.key)await reconcile();}catch{lastWarning='Task evidence could not be refreshed. Review the existing operation before retrying.';}
    }
  }
  return Object.freeze({syncScope,tools:Object.freeze({listFor,invokeFor}),admin:Object.freeze({create:(session,title)=>attach(session,null,title),delegate:(session,title,dependsOn)=>{need(Array.isArray(dependsOn)&&dependsOn.length>0,'TASK_DEPENDENCIES_INVALID');return attach(session,null,title,dependsOn);},resume:(session,taskId)=>attach(session,taskId),pause,clear,finish,inspect,reconcile})});
}
