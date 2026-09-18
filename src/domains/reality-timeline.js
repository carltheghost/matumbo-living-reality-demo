/** Bounded observation history of one spatial layout. Domain values are references,
 * not copied mutable balances or a second transaction engine. Future branches are
 * explicitly user-authored proposals; replay can never write back to the present. */
const copy=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const MAX_FRAMES=100,MAX_BRANCHES=12;
function position(value){
  if(!Array.isArray(value)||value.length!==3||value.some(n=>!Number.isFinite(n)||Math.abs(n)>60))throw Error('Position must contain three finite coordinates within the workspace');
  return value.map(n=>Math.round(n*1000)/1000);
}
export function createRealityTimeline({objects,clock=()=>Date.now()}={}){
  if(!Array.isArray(objects)||!objects.length||objects.length>80)throw Error('A bounded object registry is required');
  const ids=new Set();
  const initial=objects.map(object=>{
    if(typeof object.id!=='string'||!/^[a-z][a-z0-9-]{0,79}$/.test(object.id)||ids.has(object.id))throw Error('Object IDs must be unique existing feature references');
    ids.add(object.id);return {id:object.id,position:position(object.position),open:false};
  });
  let present=initial,revision=0,lastTime=0,selectedId=initial[0].id,frameCursor=null,branchId=null;
  const frames=[],branches=[];
  const timestamp=()=>{const now=clock();if(!Number.isFinite(now)||now<0)throw Error('Observation clock is invalid');lastTime=Math.max(lastTime,now);return new Date(lastTime).toISOString();};
  const append=action=>{frames.push(freeze({revision:revision++,observedAt:timestamp(),kind:'observed-local-view',action,objects:copy(present)}));if(frames.length>MAX_FRAMES)frames.shift();};
  append('Opened assembly');
  const activeBranch=()=>branches.find(b=>b.id===branchId)??null;
  const viewed=()=>activeBranch()?.objects??(frameCursor!==null?frames.find(f=>f.revision===frameCursor)?.objects:present)??present;
  const getSnapshot=()=>freeze({source:'reality-view-timeline',schemaVersion:1,selectedId,mode:branchId?'proposed':frameCursor!==null?'past':'present',frameCursor,branchId,revision:revision-1,
    objects:copy(viewed()),present:copy(present),frames:frames.map(f=>({revision:f.revision,observedAt:f.observedAt,action:f.action,kind:f.kind})),branches:branches.map(b=>({id:b.id,label:b.label,baseRevision:b.baseRevision,createdAt:b.createdAt,kind:b.kind})),
    historyScope:'Observed local layout and open-state only; not market history or global events',persistent:false,shared:false,prediction:false,executable:false});
  function select(id){if(!ids.has(id))throw Error('Unknown object');selectedId=id;return getSnapshot();}
  function mutate(id,patch,action){
    if(!ids.has(id))throw Error('Unknown object');
    if(frameCursor!==null&&!branchId)throw Error('Recorded history is read-only. Return to present or create a proposed branch.');
    const branch=activeBranch(),source=branch?.objects??present;
    const next=source.map(o=>o.id===id?{...o,...patch}:o);
    if(JSON.stringify(source)===JSON.stringify(next))return getSnapshot();
    if(branch)branch.objects=next;else{present=next;append(action);}
    return getSnapshot();
  }
  function move(id,next){return mutate(id,{position:position(next)},`Moved ${id}`);}
  function setOpen(id,open){if(typeof open!=='boolean')throw Error('Open state must be boolean');return mutate(id,{open},`${open?'Opened':'Closed'} ${id}`);}
  function goTo(rev){
    if(rev===null||rev==='present'){frameCursor=null;branchId=null;return getSnapshot();}
    if(!Number.isInteger(rev)||!frames.some(f=>f.revision===rev))throw Error('Recorded frame is unavailable');
    frameCursor=rev;branchId=null;return getSnapshot();
  }
  function propose(label){
    if(typeof label!=='string'||!label.trim()||label.trim().length>60)throw Error('Enter a proposed branch name of 1–60 characters');
    if(branches.length>=MAX_BRANCHES)throw Error('Branch limit reached; export this workspace before continuing');
    const objects=copy(viewed()),baseRevision=frameCursor??revision-1;
    const branch={id:`proposal-${branches.length+1}`,label:label.trim(),baseRevision,createdAt:timestamp(),kind:'user-proposed-view',objects};
    branches.push(branch);branchId=branch.id;frameCursor=null;return getSnapshot();
  }
  function viewBranch(id){if(!branches.some(b=>b.id===id))throw Error('Unknown branch');branchId=id;frameCursor=null;return getSnapshot();}
  function exportHistory(){return JSON.stringify({schemaVersion:1,scope:'Local layout history, not authoritative domain state',frames,branches},null,2);}
  return Object.freeze({getSnapshot,select,move,setOpen,goTo,propose,viewBranch,exportHistory});
}
