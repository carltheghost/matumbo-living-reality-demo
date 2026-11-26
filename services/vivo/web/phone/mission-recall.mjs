/** Exact mission evidence recall through the existing four-bank numeric circuit. */
import {ConstructiveMemory} from './constructive-memory.mjs';
const PAGE=256, MAX_RECEIPTS=1024, MAX_RESULTS=32;
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const id=x=>typeof x==='string'&&x.length>0&&x.length<=256&&!/[\u0000-\u001f\u007f]/.test(x);
const address=(spaceId,entityId)=>JSON.stringify([spaceId,entityId]);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
export function selectMissionEvidence(tasks,targetId,sourceIds){
  need(Array.isArray(sourceIds)&&sourceIds.length>0&&sourceIds.length<=15&&Array.from(sourceIds).every(id)&&new Set(sourceIds).size===sourceIds.length,'MISSION_RECALL_SOURCES_INVALID');
  const map=new Map(tasks.map(t=>[t.id,t]));
  return [...sourceIds].sort(cmp).map(taskId=>{
    const task=map.get(taskId);
    need(taskId!==targetId&&task?.closed&&task.completed===true&&task.steps.some(s=>s.state==='confirmed')&&!task.steps.some(s=>s.state==='pending'||s.state==='conflict'),'MISSION_RECALL_SOURCE_UNAVAILABLE');
    return task;
  });
}
export function normalizeMissionRecall(args){
  need(args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).every(k=>['spaceId','entityId','offset','limit'].includes(k))&&Object.hasOwn(args,'spaceId')&&Object.hasOwn(args,'entityId')&&id(args.spaceId)&&id(args.entityId),'MISSION_RECALL_ARGUMENTS_INVALID');
  const offset=args.offset===undefined?0:args.offset,limit=args.limit===undefined?8:args.limit;
  need(Number.isSafeInteger(offset)&&offset>=0&&offset<=MAX_RECEIPTS&&Number.isSafeInteger(limit)&&limit>=1&&limit<=MAX_RESULTS,'MISSION_RECALL_ARGUMENTS_INVALID');
  return {spaceId:args.spaceId,entityId:args.entityId,offset,limit};
}
function compilePage(scope,rows,page){
  let next=1;const records=[],objects=new Map(),sources=new Map(),receipts=new Map();
  const intern=(map,key)=>{if(!map.has(key))map.set(key,next++);return map.get(key);};
  const edge=(bank,from,to)=>records.push({id:'p'+page+':b'+bank+':'+from,bank,from,to,revision:1});
  for(const row of rows){
    const key=address(row.spaceId,row.entityId),source=intern(sources,row.sourceId),occurrence=next++,receipt=next++;
    receipts.set(receipt,row);
    let object=objects.get(key);if(!object){object={cue:next++,entries:[]};objects.set(key,object);}
    object.entries.push(occurrence);edge(2,occurrence,source);edge(3,occurrence,receipt);
  }
  for(const o of objects.values()){
    edge(0,o.cue,o.entries[0]);o.entries.forEach((entry,i)=>edge(1,entry,o.entries[i+1]||0));
  }
  const sourceByAddress=new Map([...sources].map(([s,n])=>[n,s]));
  const memory=new ConstructiveMemory({scope,records,revision:1});
  return {memory,objects,sourceByAddress,receipts};
}
/** The caller supplies only explicitly approved, currently completed tasks from a validated journal.
 * Each page has <=256 occurrences and <=256 distinct object cues; every bank stays bounded.
 * Addresses are internal to the derived page, never stable IDs or write permissions.
 */
export function recallMissionEvidence({scope,tasks,args}){
  const query=normalizeMissionRecall(args),rows=[],seen=new Set();let omittedUnknownSpace=0;
  need(Array.isArray(tasks)&&tasks.length<=15,'MISSION_RECALL_SOURCES_INVALID');
  for(const t of [...tasks].sort((a,b)=>cmp(a.id,b.id))){
    need(t.closed&&t.completed===true&&!t.steps.some(s=>s.state==='pending'||s.state==='conflict'),'MISSION_RECALL_SOURCE_UNAVAILABLE');
    for(const s of t.steps){
      if(s.state!=='confirmed')continue;
      need(id(t.id)&&id(s.operationId)&&id(s.entityId)&&id(s.sourceId||t.sourceId)&&typeof s.changed==='boolean'&&Number.isSafeInteger(s.revision)&&s.revision>=0&&/^[a-f0-9]{64}$/.test(s.sha256)&&!seen.has(s.operationId),'MISSION_RECALL_EVIDENCE_INVALID');
      seen.add(s.operationId);if(!id(s.spaceId)){omittedUnknownSpace++;continue;}
      rows.push({taskId:t.id,operationId:s.operationId,spaceId:s.spaceId,entityId:s.entityId,sourceId:s.sourceId||t.sourceId,sha256:s.sha256,revision:s.revision,changed:s.changed});
    }
  }
  need(rows.length+omittedUnknownSpace<=MAX_RECEIPTS,'MISSION_RECALL_CAPACITY');
  const matches=[],key=address(query.spaceId,query.entityId);let total=0;
  const pages=Math.ceil(rows.length/PAGE);
  for(let p=0;p<pages;p++){
    const {memory,objects,sourceByAddress,receipts}=compilePage(scope,rows.slice(p*PAGE,(p+1)*PAGE),p);
    const object=objects.get(key);if(!object)continue;
    const read=(start,bank)=>{const r=memory.query({scope,start,path:[bank]});need(r.status==='matched','MISSION_RECALL_CIRCUIT_INVALID');return r;};
    const head=read(object.cue,0);let entry=head.value,steps=0;
    while(entry!==0){
      need(++steps<=object.entries.length,'MISSION_RECALL_CIRCUIT_INVALID');
      const source=read(entry,2),receipt=read(entry,3),row=receipts.get(receipt.value);
      need(row&&row.sourceId===sourceByAddress.get(source.value)&&address(row.spaceId,row.entityId)===key,'MISSION_RECALL_CIRCUIT_INVALID');
      if(total>=query.offset&&matches.length<query.limit)matches.push({...row,circuit:{page:p,entryAddress:entry,head:head.trace[0].recordId,source:source.trace[0].recordId,receipt:receipt.trace[0].recordId}});
      total++;entry=read(entry,1).value;
    }
    need(steps===object.entries.length,'MISSION_RECALL_CIRCUIT_INVALID');
  }
  const nextOffset=query.offset+matches.length<total?query.offset+matches.length:null;
  return {schema:'vivo.mission-neural-recall/1',scope:{...scope},status:matches.length?'matched':'abstain',reason:matches.length?null:total?'OFFSET_OUT_OF_RANGE':'NO_CONFIRMED_EVIDENCE',query,total,nextOffset,matches,omittedUnknownSpace,pages,method:'explicit-weight associative circuit',learned:false,readOnly:true,authorizesAction:false};
}
