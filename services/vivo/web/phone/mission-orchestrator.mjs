/** Advisory ranking only. The native registry remains the action authority. */
const unresolved=s=>s.state==='pending'||s.state==='conflict';
import {relatedMissionExperience} from './mission-experience.mjs';
const compareText=(a,b)=>a<b?-1:a>b?1:0;
const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const validAgent=a=>a&&typeof a.sourceId==='string'&&a.sourceId&&typeof a.sessionId==='string'&&a.sessionId&&Number.isSafeInteger(a.generation)&&a.generation>0;

export function rankMissionAgents({tasks,task,agents,attachments,mission}){
  const result={state:'unavailable',reason:null,candidates:[],recommended:null,authorizesAction:false};
  if(task.closed){result.reason='TASK_CLOSED';return result;}
  if(!mission.readyForJournaledEdits){result.reason='TASK_PREREQUISITES_INCOMPLETE';return result;}
  if(task.steps.some(unresolved)){result.reason='TASK_RECONCILIATION_REQUIRED';return result;}
  if(attachments.some(a=>a.taskId===task.id)){result.reason='TASK_ALREADY_ATTACHED';return result;}
  const {relatedObjectCount,history}=relatedMissionExperience(tasks,task,mission);
  result.relatedObjectCount=relatedObjectCount;
  const busy=new Set(attachments.map(a=>a.sessionId));
  for(const a of agents){
    if(!validAgent(a))continue;
    const reasons=[],operations=count(a.activeOperations),contacts=count(a.activeContacts),tools=Array.isArray(a.tools)?a.tools:[];
    if(a.status!=='active')reasons.push('SESSION_INACTIVE');
    if(!tools.includes('vivo.world.read')||!tools.includes('vivo.world.edit'))reasons.push('WORLD_CAPABILITIES_MISSING');
    if(operations===null||contacts===null)reasons.push('WORKLOAD_UNKNOWN');
    else if(operations>0||contacts>0)reasons.push('NATIVE_WORK_IN_PROGRESS');
    if(busy.has(a.sessionId)||a.attachmentPending===true)reasons.push('TASK_ATTACHMENT_BUSY');
    if(a.sourceId!==task.sourceId&&(task.handoffs?.length||0)>=16)reasons.push('TASK_HANDOFF_CAPACITY');
    result.candidates.push({sourceId:a.sourceId,sessionId:a.sessionId,generation:a.generation,label:typeof a.label==='string'?a.label:a.sourceId,
      eligible:!reasons.length,reasons,continuity:a.sourceId===task.sourceId,relatedChangedReceipts:history.get(a.sourceId)?.relatedChangedReceipts||0,
      relatedChangedTasks:history.get(a.sourceId)?.relatedChangedTasks||0,relatedCompletedTasks:history.get(a.sourceId)?.relatedCompletedTasks||0,
      memoryAvailable:tools.includes('neural.predict'),activeOperations:operations,activeContacts:contacts});
  }
  result.candidates.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||Number(b.continuity)-Number(a.continuity)||
    b.relatedCompletedTasks-a.relatedCompletedTasks||b.relatedChangedTasks-a.relatedChangedTasks||Number(b.memoryAvailable)-Number(a.memoryAvailable)||compareText(a.sourceId,b.sourceId)||compareText(a.sessionId,b.sessionId));
  const top=result.candidates.find(a=>a.eligible);
  if(top){result.state='recommended';result.recommended={sourceId:top.sourceId,sessionId:top.sessionId,generation:top.generation};}
  else result.reason='NO_ELIGIBLE_AGENT';
  return result;
}
