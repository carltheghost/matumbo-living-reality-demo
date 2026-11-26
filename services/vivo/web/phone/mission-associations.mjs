/** Bounded association search over explicitly shared completed mission evidence. */
import {ConstructiveMemory} from './constructive-memory.mjs';
const MAX_HOPS=8,MAX_TASKS=15,MAX_STEPS=64;
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const id=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f]/.test(x);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k));
const endpoint=x=>{need(exact(x,['spaceId','entityId'])&&Object.hasOwn(x,'spaceId')&&Object.hasOwn(x,'entityId')&&id(x.spaceId)&&id(x.entityId),'MISSION_TRACE_ARGUMENTS_INVALID');return {spaceId:x.spaceId,entityId:x.entityId};};
const objectKey=x=>JSON.stringify(['object',x.spaceId,x.entityId]);
const taskKey=x=>JSON.stringify(['task',x]);
const BANKS={'observed-in':0,'observed-object':1,'prerequisite-of':2,'depends-on':3};
export function normalizeMissionTrace(args){
  need(exact(args,['from','to','maxHops'])&&Object.hasOwn(args,'from')&&Object.hasOwn(args,'to'),'MISSION_TRACE_ARGUMENTS_INVALID');
  const from=endpoint(args.from),to=endpoint(args.to),maxHops=args.maxHops===undefined?6:args.maxHops;
  need(Number.isInteger(maxHops)&&maxHops>=1&&maxHops<=MAX_HOPS,'MISSION_TRACE_ARGUMENTS_INVALID');return {from,to,maxHops};
}
function buildGraph(tasks){
  need(Array.isArray(tasks)&&tasks.length<=MAX_TASKS&&Array.from(tasks).every(t=>t&&id(t.id)&&id(t.sourceId)&&t.closed&&t.completed===true&&Array.isArray(t.steps)&&t.steps.length<=MAX_STEPS&&t.steps.some(s=>s?.state==='confirmed')&&!t.steps.some(s=>!s||!['confirmed','not-dispatched'].includes(s.state))),'MISSION_TRACE_EVIDENCE_INVALID');
  const ids=new Set(tasks.map(t=>t.id));need(ids.size===tasks.length,'MISSION_TRACE_EVIDENCE_INVALID');
  const nodes=new Map(),edges=new Map(),operations=new Set();
  const addNode=(key,node)=>{if(!nodes.has(key)){nodes.set(key,node);edges.set(key,[]);}return key;};
  const addEdge=(from,to,relation,evidence)=>edges.get(from).push({from,to,relation,evidence});
  for(const t of [...tasks].sort((a,b)=>cmp(a.id,b.id))){
    const tk=addNode(taskKey(t.id),{kind:'task',taskId:t.id});const observed=new Set();
    for(const s of t.steps.filter(s=>s.state==='confirmed').sort((a,b)=>cmp(a.operationId,b.operationId))){
      need(id(s.operationId)&&!operations.has(s.operationId)&&id(s.entityId)&&id(s.sourceId||t.sourceId)&&Number.isSafeInteger(s.revision)&&s.revision>=0&&typeof s.changed==='boolean'&&typeof s.sha256==='string'&&/^[a-f0-9]{64}$/.test(s.sha256),'MISSION_TRACE_EVIDENCE_INVALID');operations.add(s.operationId);
      if(!id(s.spaceId))continue; // never guess the space of legacy receipts
      const ok=addNode(objectKey(s),{kind:'object',spaceId:s.spaceId,entityId:s.entityId});if(observed.has(ok))continue;observed.add(ok);
      const receipt={kind:'confirmed-receipt',taskId:t.id,operationId:s.operationId,spaceId:s.spaceId,entityId:s.entityId,sourceId:s.sourceId||t.sourceId,sha256:s.sha256,revision:s.revision,changed:s.changed};
      addEdge(ok,tk,'observed-in',receipt);addEdge(tk,ok,'observed-object',receipt);
    }
  }
  for(const t of tasks){
    const deps=t.dependsOn===undefined?[]:t.dependsOn;
    need(Array.isArray(deps)&&deps.length<16&&Array.from(deps).every(id)&&new Set(deps).size===deps.length&&!deps.includes(t.id),'MISSION_TRACE_EVIDENCE_INVALID');
    for(const d of deps){
      if(!ids.has(d))continue; // no transit through unshared history
      const proof={kind:'declared-prerequisite',prerequisiteTaskId:d,dependentTaskId:t.id};
      addEdge(taskKey(d),taskKey(t.id),'prerequisite-of',proof);addEdge(taskKey(t.id),taskKey(d),'depends-on',proof);
    }
  }
  for(const list of edges.values())list.sort((a,b)=>cmp(a.to,b.to)||cmp(a.relation,b.relation));
  return {nodes,edges};
}
/** BFS discovers one deterministic shortest evidence path. The existing numeric
 * circuit then replays that exact simple path through its four relation banks.
 * This checks encoding/readout, not causal truth or authority to repeat an edit.
 */
export function traceMissionEvidence({scope,tasks,args}){
  const query=normalizeMissionTrace(args);new ConstructiveMemory({scope});
  const {nodes,edges}=buildGraph(tasks),start=objectKey(query.from),end=objectKey(query.to);
  const base={schema:'vivo.mission-association/1',scope:{worldId:scope.worldId,projectId:scope.projectId},query,readOnly:true,authorizesAction:false,causalityProven:false,learned:false};
  const abstain=reason=>({...base,status:'abstain',reason,hops:[],circuitTrace:[]});
  if(!nodes.has(start)||!nodes.has(end))return abstain('OBJECT_NOT_IN_SHARED_EVIDENCE');
  if(start===end)return abstain('SAME_OBJECT_USE_RECALL');
  const queue=[{key:start,depth:0}],parent=new Map([[start,null]]);
  for(let i=0;i<queue.length&&!parent.has(end);i++){
    const {key,depth}=queue[i];if(depth>=query.maxHops)continue;
    for(const edge of edges.get(key)){if(parent.has(edge.to))continue;parent.set(edge.to,edge);queue.push({key:edge.to,depth:depth+1});if(edge.to===end)break;}
  }
  if(!parent.has(end))return abstain('NO_SHARED_PATH_WITHIN_BOUND');
  const path=[];for(let at=end;at!==start;){const edge=parent.get(at);path.push(edge);at=edge.from;}path.reverse();
  const records=path.map((e,i)=>({id:'hop:'+i,bank:BANKS[e.relation],from:i+1,to:i+2,revision:1}));
  const memory=new ConstructiveMemory({scope,records,revision:1}),read=memory.query({scope,start:1,path:records.map(r=>r.bank)});
  need(read.status==='matched'&&read.value===path.length+1&&read.trace.length===path.length&&read.trace.every((r,i)=>r.recordId===records[i].id&&r.bank===records[i].bank&&r.from===records[i].from&&r.to===records[i].to),'MISSION_TRACE_CIRCUIT_INVALID');
  return {...base,status:'matched',reason:null,hopCount:path.length,hops:path.map(e=>({from:{...nodes.get(e.from)},to:{...nodes.get(e.to)},relation:e.relation,evidence:{...e.evidence}})),circuitTrace:read.trace,method:'bounded shortest-path search and exact associative circuit replay'};
}
