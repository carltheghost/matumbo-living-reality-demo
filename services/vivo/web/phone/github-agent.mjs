/** Native GitHub connector: explicit, session-bound, revocable read-only grants.
 * Same-page local trust boundary, not an external agent sandbox. */
const API='/api/vivo/accounts/github';
const REVIEW='github.pull.read',FILE='github.file.read';
const fail=code=>Object.assign(new Error(code),{code});
const need=(ok,code)=>{if(!ok)throw fail(code);};
const repo=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(x)&&!['.','..'].includes(x.split('/')[1]);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const path=x=>typeof x==='string'&&x.length>0&&x.length<=512&&!/[\u0000-\u001f\u007f\\]/.test(x)&&x.split('/').every(p=>p&&!['.','..'].includes(p));
const scopeKey=s=>s&&typeof s.worldId==='string'&&s.worldId&&typeof s.projectId==='string'&&s.projectId?JSON.stringify([s.worldId,s.projectId]):null;
const identity=a=>Object.freeze({sourceId:a.sourceId,sessionId:a.sessionId,generation:a.generation});
const same=(a,b)=>!!a&&!!b&&a.sourceId===b.sourceId&&a.sessionId===b.sessionId&&a.generation===b.generation;
const clone=x=>JSON.parse(JSON.stringify(x));
export function normalizeGitHubReview(spec){
  need(spec&&typeof spec==='object'&&!Array.isArray(spec)&&Object.keys(spec).every(k=>['repository','pullNumber','filePath'].includes(k))&&repo(spec.repository)&&Number.isSafeInteger(spec.pullNumber)&&spec.pullNumber>0&&spec.pullNumber<=2147483647,'GITHUB_REVIEW_INVALID');
  const filePath=spec.filePath??null;need(filePath===null||path(filePath),'GITHUB_PATH_INVALID');
  return {repository:spec.repository.toLowerCase(),pullNumber:spec.pullNumber,filePath};
}
export function createGitHubAgentBridge({registry,downstream,getScope,request=globalThis.fetch?.bind(globalThis)}){
  let key=null,epoch=0,draft=null;
  const grants=new Map();
  const active=ref=>identity(registry.agentController.assertActive(ref));
  function syncScope(){
    let next=null;try{next=scopeKey(getScope());}catch{}
    if(next!==key){key=next;epoch++;draft=null;grants.clear();}
    return key;
  }
  function revoke(session){grants.delete(typeof session==='string'?session:session?.sessionId);}
  function clear(){epoch++;draft=null;grants.clear();}
  function grantFor(session){
    syncScope();try{const a=active(session),g=grants.get(a.sessionId);
      if(g&&same(g.agent,a)&&g.key===key&&g.epoch===epoch)return g;
    }catch{}return null;
  }
  async function call(endpoint,body){
    need(typeof request==='function','GITHUB_HOST_UNAVAILABLE');
    const result=await request(API+endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/json','X-Vivo-Action':'user'},body:JSON.stringify(body)});
    let value;try{value=JSON.parse(await result.text());}catch{throw fail('GITHUB_HOST_UNAVAILABLE');}
    if(!result.ok)throw fail(typeof value?.error==='string'&&/^GITHUB_[A-Z0-9_]+$/.test(value.error)?value.error:'GITHUB_HOST_UNAVAILABLE');
    need(value&&value.readOnly===true&&value.authorizesAction===false,'GITHUB_RESPONSE_INVALID');return value;
  }
  function checkReview(value,spec,pinned=null){
    need(value.schema==='vivo.github-pull-review/1'&&value.repository===spec.repository&&value.pullNumber===spec.pullNumber&&sha(value.headSha)&&
      (pinned===null||value.headSha===pinned)&&Array.isArray(value.workflows)&&value.workflows.length<=30,'GITHUB_RESPONSE_IDENTITY_MISMATCH');
    return value;
  }
  async function preview(input){
    const spec=normalizeGitHubReview(input),current=syncScope(),generation=epoch;
    need(current,'GITHUB_WORLD_REQUIRED');const pending={};draft=pending;
    const value=checkReview(await call('/inspect',{repository:spec.repository,pullNumber:spec.pullNumber}),spec);
    need(syncScope()===current&&epoch===generation&&draft===pending,'GITHUB_REVIEW_STALE');
    if(spec.filePath!==null)need(value.sameRepositoryHead===true,'GITHUB_FORK_FILE_UNAVAILABLE');
    const reviewed=Object.freeze({...spec,headSha:value.headSha});
    draft={key:current,epoch:generation,reviewed,token:globalThis.crypto?.randomUUID?.()||String(Math.random())};
    return {token:draft.token,reviewed:{...reviewed},snapshot:clone(value)};
  }
  function discard(token){if(draft?.token===token)draft=null;}
  function grant(session,token){
    const current=syncScope(),d=draft;
    need(d&&d.token===token&&d.key===current&&d.epoch===epoch,'GITHUB_REVIEW_STALE');
    const a=active(session),g=Object.freeze({key:current,epoch,agent:a,reviewed:d.reviewed});
    grants.set(a.sessionId,g);draft=null;
    return {sourceId:a.sourceId,sessionId:a.sessionId,generation:a.generation,...g.reviewed,readOnly:true,authorizesAction:false};
  }
  function listFor(session){
    const tools=downstream.listFor(session),g=grantFor(session);
    if(!g)return tools;
    return [...tools,{name:REVIEW,description:'Read the approved GitHub PR and commit-specific workflow statuses. No arguments; read-only.'},
      ...(g.reviewed.filePath?[{name:FILE,description:'Read only the owner-selected UTF-8 file at the reviewed PR head. No arguments; read-only.'}]:[])];
  }
  async function invokeFor(session,name,args={}){
    if(name!==REVIEW&&name!==FILE)return downstream.invokeFor(session,name,args);
    const g=grantFor(session);need(g,'GITHUB_AGENT_NOT_GRANTED');
    need(args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).length===0,'GITHUB_ARGUMENTS_INVALID');
    const r=g.reviewed,body={repository:r.repository,pullNumber:r.pullNumber,expectedHeadSha:r.headSha};
    if(name===FILE){need(r.filePath,'GITHUB_FILE_NOT_GRANTED');body.path=r.filePath;}
    const result=await call(name===REVIEW?'/inspect':'/file',body);
    need(grantFor(session)===g,'GITHUB_GRANT_STALE');
    if(name===REVIEW)return checkReview(result,r,r.headSha);
    need(result.schema==='vivo.github-file/1'&&result.repository===r.repository&&result.pullNumber===r.pullNumber&&result.headSha===r.headSha&&result.path===r.filePath&&typeof result.content==='string'&&Number.isInteger(result.size)&&result.size>=0&&result.size<=32768&&result.content.length<=32768&&sha(result.blobSha),'GITHUB_RESPONSE_IDENTITY_MISMATCH');
    return result;
  }
  function status(){syncScope();return [...grants.values()].filter(g=>grantFor(g.agent)===g).map(g=>({...g.agent,...g.reviewed}));}
  return Object.freeze({syncScope,tools:Object.freeze({listFor,invokeFor}),admin:Object.freeze({preview,discard,grant,revoke,clear,status})});
}
