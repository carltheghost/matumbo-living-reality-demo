/** Native GitHub connector: explicit, session-bound, revocable read-only grants.
 * Same-page local trust boundary, not an external agent sandbox. */
const API='/api/vivo/accounts/github';
const REVIEW='github.pull.read',FILE='github.file.read',PROPOSE='github.change.propose';
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
  const grants=new Map(),proposals=new WeakMap(),pendingProposals=new WeakSet(),branchDrafts=new WeakMap();
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
  async function call(endpoint,body,expectedSchema=null){
    need(typeof request==='function','GITHUB_HOST_UNAVAILABLE');
    const result=await request(API+endpoint,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/json','X-Vivo-Action':'user'},body:JSON.stringify(body)});
    let value;try{value=JSON.parse(await result.text());}catch{throw fail('GITHUB_HOST_UNAVAILABLE');}
    if(!result.ok)throw fail(typeof value?.error==='string'&&/^GITHUB_[A-Z0-9_]+$/.test(value.error)?value.error:'GITHUB_HOST_UNAVAILABLE');
    need(value&&value.authorizesAction===false&&(expectedSchema?value.schema===expectedSchema:value.readOnly===true),'GITHUB_RESPONSE_INVALID');return value;
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
      ...(g.reviewed.filePath?[{name:FILE,description:'Read only the owner-selected UTF-8 file at the reviewed PR head. No arguments; read-only.'},{name:PROPOSE,description:'Stage one local replacement proposal for the approved source file. Arguments: summary, testPlan (nonempty text), replacement (up to 8000 characters). No remote write, execution or branch permission.'}]:[])];
  }
  const bounded=(x,n)=>typeof x==='string'&&x.trim().length>0&&x.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x);
  async function propose(session,g,args){
    need(g.reviewed.filePath,'GITHUB_FILE_NOT_GRANTED');
    need(args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).length===3&&Object.keys(args).every(k=>['summary','testPlan','replacement'].includes(k))&&bounded(args.summary,240)&&bounded(args.testPlan,1200)&&typeof args.replacement==='string'&&args.replacement.length<=8000&&!args.replacement.includes('\0'),'GITHUB_PROPOSAL_INVALID');
    need(!proposals.has(g)&&!pendingProposals.has(g),'GITHUB_PROPOSAL_EXISTS');
    const proposed={summary:args.summary.trim(),testPlan:args.testPlan.trim(),replacement:args.replacement};
    pendingProposals.add(g);
    try{
      const original=await invokeFor(session,FILE,{});
      need(grantFor(session)===g,'GITHUB_GRANT_STALE');
      need(proposed.replacement!==original.content,'GITHUB_PROPOSAL_UNCHANGED');
      const value=Object.freeze({schema:'vivo.github-change-proposal/1',...g.reviewed,sourceId:g.agent.sourceId,
        baseBlobSha:original.blobSha,original:original.content,...proposed,readOnly:true,authorizesAction:false,testsExecuted:false});
      proposals.set(g,value);return clone(value);
    }finally{pendingProposals.delete(g);}
  }
  function proposal(session){const g=grantFor(session);need(g,'GITHUB_AGENT_NOT_GRANTED');return proposals.has(g)?clone(proposals.get(g)):null;}
  function discardProposal(session){
    const g=grantFor(session);need(g,'GITHUB_AGENT_NOT_GRANTED');need(!pendingProposals.has(g),'GITHUB_PROPOSAL_PENDING');
    proposals.delete(g);branchDrafts.delete(g);
  }
  function checkBranch(value,g,slug=null){
    const r=g.reviewed;
    need(value.repository===r.repository&&value.pullNumber===r.pullNumber&&value.headSha===r.headSha&&
      typeof value.reviewId==='string'&&value.reviewId.length>0&&value.reviewId.length<=128&&
      typeof value.ref==='string'&&/^refs\/heads\/vivo\/agent\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?-[a-f0-9]{16}$/.test(value.ref)&&
      (slug===null||value.ref.slice('refs/heads/vivo/agent/'.length,-17)===slug)&&value.codeApplied===false,'GITHUB_BRANCH_RESPONSE_IDENTITY_MISMATCH');
    return value;
  }
  async function previewBranch(session,slug){
    const g=grantFor(session);need(g,'GITHUB_AGENT_NOT_GRANTED');
    const p=proposals.get(g);need(p,'GITHUB_PROPOSAL_REQUIRED');
    need(typeof slug==='string'&&/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug),'GITHUB_BRANCH_SLUG_INVALID');
    const pending={};branchDrafts.set(g,pending);
    const r=g.reviewed,value=checkBranch(await call('/branch/preview',{repository:r.repository,pullNumber:r.pullNumber,expectedHeadSha:r.headSha,slug},'vivo.github-branch-preview/1'),g,slug);
    need(grantFor(session)===g&&proposals.get(g)===p&&branchDrafts.get(g)===pending,'GITHUB_BRANCH_REVIEW_STALE');
    need(value.state==='reviewed'&&value.requiresExactRefConfirmation===true&&value.mayTriggerWorkflows===true,'GITHUB_BRANCH_RESPONSE_INVALID');
    branchDrafts.set(g,{p,reviewId:value.reviewId,ref:value.ref});return clone(value);
  }
  async function createBranch(session,reviewId,confirmation){
    const g=grantFor(session);need(g,'GITHUB_AGENT_NOT_GRANTED');
    const d=branchDrafts.get(g);
    need(d&&d.p===proposals.get(g)&&d.reviewId===reviewId&&typeof reviewId==='string','GITHUB_BRANCH_REVIEW_STALE');
    need(confirmation===d.ref,'GITHUB_BRANCH_CONFIRMATION_MISMATCH');
    branchDrafts.delete(g);
    // Dispatch once. A lost browser response is not a reason to replay; the
    // owner can inspect the host's receipt journal independently of this grant.
    let value;
    try{value=checkBranch(await call('/branch/execute',{reviewId,confirmation},'vivo.github-branch-receipt/1'),g);
      need(value.reviewId===reviewId&&value.ref===d.ref&&['created','not-dispatched','uncertain'].includes(value.state),'GITHUB_BRANCH_RESPONSE_IDENTITY_MISMATCH');
    }catch{throw fail('GITHUB_BRANCH_RESULT_UNCONFIRMED_CHECK_HOST_RECEIPTS');}
    // Do not misrepresent a dispatched mutation as cancelled after revocation.
    return clone(value);
  }
  async function invokeFor(session,name,args={}){
    if(name!==REVIEW&&name!==FILE&&name!==PROPOSE)return downstream.invokeFor(session,name,args);
    const g=grantFor(session);need(g,'GITHUB_AGENT_NOT_GRANTED');
    if(name===PROPOSE)return propose(session,g,args);
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
  return Object.freeze({syncScope,tools:Object.freeze({listFor,invokeFor}),admin:Object.freeze({preview,discard,grant,revoke,clear,status,proposal,discardProposal,previewBranch,createBranch})});
}
