/** Canonical remote Vivo transport over one authenticated WebSocket.
 * The server-owned runtime token is never exposed to this client.
 */
import {offlineForkCommand} from './offline-branch.mjs';
import {createRemoteConversationProvider} from './conversation-transport.mjs';

// Independently verify the versioned mission certificate. The Python host
// enumerates combinations; the browser uses a bitmask, and pins the mission
// itself rather than trusting the jobs or scores supplied by a receipt.
// This is mathematical/structural verification, not provider authentication.
const REASONING_JOBS=Object.freeze([
  Object.freeze({id:'A',cost:3,value:5}),
  Object.freeze({id:'B',cost:4,value:7}),
  Object.freeze({id:'C',cost:5,value:9}),
  Object.freeze({id:'D',cost:2,value:4}),
]);
const REASONING_PROVIDERS=new Set(['openai','anthropic','google','deepseek','kimi','nvidia','xai']);
const OBSERVATION_STATUSES=new Set(['response-observed','no-usable-answer','not-configured','skipped-limit',
  'transport-uncertain','http-error','invalid-response']);
const REASONING_VERDICTS=['optimal','feasible-suboptimal','over-budget','invalid-proposal','unknown'];
const reasoningRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const reasoningKeys=(value,keys)=>reasoningRecord(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const reasoningCheck=(condition,code='MEMORY_REASONING_INVALID')=>{if(!condition)throw Error(code);};
const reasoningDigest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const exactPlan=(actual,expected)=>reasoningKeys(actual,['candidate','cost','value','feasible'])&&
  actual.candidate===expected.candidate&&actual.cost===expected.cost&&actual.value===expected.value&&actual.feasible===expected.feasible;

export async function verifyAgentReasoningReceipt(packet,selection,{cryptoApi=globalThis.crypto}={}){
  reasoningCheck(reasoningRecord(selection)&&Object.keys(selection).every(k=>['task','mode','providers','limit'].includes(k)));
  const {task,mode}=selection,limit=selection.limit??4,providers=selection.providers??[];
  reasoningCheck(task==='route-constraint-v1'&&['fixture','live'].includes(mode)&&
    Number.isInteger(limit)&&limit>=1&&limit<=8&&Array.isArray(providers)&&providers.length<=7&&
    providers.every(p=>REASONING_PROVIDERS.has(p))&&new Set(providers).size===providers.length);
  reasoningCheck(reasoningKeys(packet,['schema','selection','proposal','proof','evidence','authority',
    'providerAuthenticated','providerCallsInitiated','postedChargesUsd','worldActionExecuted','decisionSha256'])&&
    packet.schema==='vivo.agent-reasoning/1'&&packet.authority==='evidence-only'&&packet.providerAuthenticated===false&&
    packet.providerCallsInitiated===0&&packet.postedChargesUsd===null&&packet.worldActionExecuted===false&&reasoningDigest(packet.decisionSha256));
  const scope=packet.selection;
  reasoningCheck(reasoningKeys(scope,['task','mode','providers','limit'])&&scope.task===task&&scope.mode===mode&&scope.limit===limit&&
    Array.isArray(scope.providers)&&JSON.stringify(scope.providers)===JSON.stringify([...providers].sort()));
  const {decisionSha256,...core}=packet;
  reasoningCheck(Boolean(cryptoApi?.subtle),'MEMORY_REASONING_CRYPTO_UNAVAILABLE');
  const digest=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(core)));
  const actual=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  reasoningCheck(actual===decisionSha256,'MEMORY_REASONING_DIGEST_MISMATCH');

  const proof=packet.proof;
  reasoningCheck(reasoningKeys(proof,['method','budget','jobs','subsetsChecked','feasibleSubsets','runnerUp','optimalityGap','enumerated'])&&
    proof.method==='exhaustive-subset-enumeration'&&proof.budget===7&&Array.isArray(proof.jobs)&&proof.jobs.length===4&&
    REASONING_JOBS.every((job,i)=>reasoningKeys(proof.jobs[i],['id','cost','value'])&&
      Object.keys(job).every(key=>proof.jobs[i][key]===job[key])), 'MEMORY_REASONING_PROOF_INVALID');
  const all=[];
  for(let mask=1;mask<(1<<REASONING_JOBS.length);mask++){
    const jobs=REASONING_JOBS.filter((_,index)=>mask&(1<<index));
    const cost=jobs.reduce((sum,job)=>sum+job.cost,0);
    all.push({candidate:jobs.map(job=>job.id).join(','),cost,
      value:jobs.reduce((sum,job)=>sum+job.value,0),feasible:cost<=7});
  }
  const plans=new Map(all.map(plan=>[plan.candidate,plan]));
  const feasible=all.filter(plan=>plan.feasible).sort((a,b)=>b.value-a.value||a.cost-b.cost||a.candidate.localeCompare(b.candidate));
  const [best,runnerUp]=feasible;
  reasoningCheck(proof.subsetsChecked===all.length&&proof.feasibleSubsets===feasible.length&&
    exactPlan(packet.proposal,best)&&exactPlan(proof.runnerUp,runnerUp)&&proof.optimalityGap===best.value-runnerUp.value&&
    Array.isArray(proof.enumerated)&&proof.enumerated.length===all.length, 'MEMORY_REASONING_PROOF_INVALID');
  const seenPlans=new Set();
  for(const plan of proof.enumerated){
    const expected=plans.get(plan?.candidate);
    reasoningCheck(Boolean(expected)&&!seenPlans.has(plan.candidate)&&exactPlan(plan,expected),'MEMORY_REASONING_PROOF_INVALID');
    seenPlans.add(plan.candidate);
  }

  const evidence=packet.evidence;
  reasoningCheck(reasoningKeys(evidence,['status','recordsUsed','truncated','observationCounts','countUnit','citations'])&&
    evidence.countUnit==='report-provider-observations-not-independent-votes'&&
    Array.isArray(evidence.citations)&&evidence.citations.length<=limit&&evidence.recordsUsed===evidence.citations.length&&
    typeof evidence.truncated==='boolean'&&(!evidence.truncated||evidence.citations.length===limit)&&
    reasoningKeys(evidence.observationCounts,REASONING_VERDICTS),'MEMORY_REASONING_EVIDENCE_INVALID');
  const counts=Object.fromEntries(REASONING_VERDICTS.map(verdict=>[verdict,0])),seenDigests=new Set(),seenRuns=new Set();
  for(const citation of evidence.citations){
    reasoningCheck(reasoningKeys(citation,['memoryId','evidenceDigest','runId','provenance','observations'])&&
      reasoningDigest(citation.evidenceDigest)&&citation.memoryId==='council:'+citation.evidenceDigest&&
      typeof citation.runId==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(citation.runId)&&
      !seenDigests.has(citation.evidenceDigest)&&!seenRuns.has(citation.runId)&&
      citation.provenance===(mode==='fixture'?'synthetic-fixture':'host-reported-unverified')&&
      Array.isArray(citation.observations)&&citation.observations.length>=1&&citation.observations.length<=7,'MEMORY_REASONING_EVIDENCE_INVALID');
    seenDigests.add(citation.evidenceDigest);seenRuns.add(citation.runId);
    const seenProviders=new Set();
    for(const row of citation.observations){
      reasoningCheck(reasoningKeys(row,['provider','candidate','verdict','status'])&&REASONING_PROVIDERS.has(row.provider)&&
        !seenProviders.has(row.provider)&&OBSERVATION_STATUSES.has(row.status),'MEMORY_REASONING_EVIDENCE_INVALID');
      seenProviders.add(row.provider);
      let verdict='unknown';
      if(row.status==='response-observed'){
        const candidate=row.candidate===null?null:plans.get(row.candidate);
        reasoningCheck(row.candidate===null||Boolean(candidate),'MEMORY_REASONING_EVIDENCE_INVALID');
        verdict=!candidate?'invalid-proposal':!candidate.feasible?'over-budget':candidate.candidate===best.candidate?'optimal':'feasible-suboptimal';
      }else reasoningCheck(row.candidate===null,'MEMORY_REASONING_EVIDENCE_INVALID');
      reasoningCheck(row.verdict===verdict,'MEMORY_REASONING_EVIDENCE_INVALID');counts[verdict]++;
    }
    reasoningCheck(providers.every(provider=>seenProviders.has(provider)),'MEMORY_REASONING_EVIDENCE_INVALID');
  }
  reasoningCheck(REASONING_VERDICTS.every(verdict=>evidence.observationCounts[verdict]===counts[verdict]),'MEMORY_REASONING_EVIDENCE_INVALID');
  const status=evidence.citations.length===0?'no-matching-evidence':counts.optimal?'matching-optimum-observed':
    counts['feasible-suboptimal']||counts['over-budget']||counts['invalid-proposal']?'dissent-or-invalid-only':'no-usable-proposal';
  reasoningCheck(evidence.status===status,'MEMORY_REASONING_EVIDENCE_INVALID');
  return packet;
}

export class RemoteTransport {
  constructor({url,token,WebSocket:Socket=globalThis.WebSocket,onState=()=>{},onError=()=>{},onClose=()=>{},timeoutMs=7000}={}) {
    if(typeof url!=='string'||!url.length||typeof token!=='string'||token.length<20||typeof Socket!=='function')
      throw new TypeError('Remote transport configuration required');
    this.url=url;this.invitationToken=token;this.Socket=Socket;this.onState=onState;this.onError=onError;this.onClose=onClose;this.timeoutMs=timeoutMs;
    this.socket=null;this.session=null;this.actorId=null;this.role=null;this.current=null;
    this.pending=new Map();this.listeners=new Set();this.conversationProviders=new Set();this.serial=0;this.closed=true;
  }
  receive(state) {
    if(!state)return;
    if(this.current&&state.snapshot.acceptedSequence<this.current.snapshot.acceptedSequence)return;
    this.current=structuredClone(state);this.onState(structuredClone(state));
    for(const listener of this.listeners)listener(this.getSnapshot());
  }
  async admit() {
    if(this.socket&&!this.closed)throw Error('REMOTE_ALREADY_OPEN');
    const ws=new this.Socket(this.url);this.socket=ws;this.closed=false;
    return new Promise((resolve,reject)=>{
      let timer=setTimeout(()=>{try{ws.close();}catch{};reject(Object.assign(new Error('Remote join timeout'),{code:'REMOTE_TIMEOUT'}));},this.timeoutMs);
      const fail=error=>{clearTimeout(timer);this.closed=true;reject(error instanceof Error?error:new Error(String(error)));};
      ws.onerror=()=>fail(Object.assign(new Error('Remote socket failed'),{code:'REMOTE_SOCKET'}));
      ws.onclose=()=>{if(this.socket!==ws)return;this.closed=true;this._rejectPending('REMOTE_CLOSED','Remote socket closed');void this._closeConversationProviders();try{this.onClose();}catch{}};
      ws.onopen=()=>ws.send(JSON.stringify({type:'join',token:this.invitationToken}));
      ws.onmessage=event=>{
        let msg;try{msg=JSON.parse(event.data);}catch{return;}
        if(msg.type==='joined'){
          clearTimeout(timer);this.role=msg.role;this.actorId=msg.actorId;this.session=msg.session;this.receive(msg.state);
          resolve({role:this.role,actorId:this.actorId,session:structuredClone(this.session),state:structuredClone(this.current)});return;
        }
        if(msg.type==='error'){
          const code=msg.code||'REMOTE_PROTOCOL_ERROR';
          const error=Object.assign(new Error(code),{code});
          try{this.onError(error);}catch{}
          if(!this.session){fail(error);return;}
          this._rejectPending(code,code,msg.id);return;
        }
        this._message(msg);
      };
    });
  }
  _rejectPending(code,message=code,onlyId=null) {
    const error=Object.assign(new Error(message),{code});
    if(onlyId!==null){
      const pending=this.pending.get(onlyId);if(!pending)return;
      this.pending.delete(onlyId);clearTimeout(pending.timer);pending.reject(error);return;
    }
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}
    this.pending.clear();
  }
  _message(msg) {
    if(msg.type==='state'){this.receive(msg.state);return;}
    if(msg.type==='reply'&&typeof msg.id==='string'){
      const pending=this.pending.get(msg.id);if(!pending)return;this.pending.delete(msg.id);clearTimeout(pending.timer);
      if(msg.state)this.receive(msg.state);
      if(msg.error)pending.reject(Object.assign(new Error(msg.error),{code:msg.error}));
      else pending.resolve(msg.value);
    }
  }
  call(op,args={}) {
    if(this.closed||!this.socket||this.socket.readyState!==1)return Promise.reject(Object.assign(new Error('REMOTE_CLOSED'),{code:'REMOTE_CLOSED'}));
    const id='remote.'+(++this.serial);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Object.assign(new Error('Remote request timed out; reconcile accepted state'),{code:'REMOTE_TIMEOUT'}));},this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket.send(JSON.stringify({id,op,args}));}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  async open(){if(!this.session)throw Error('REMOTE_ADMISSION_REQUIRED');return this.session;}
  getSnapshot(){if(!this.current)throw Error('NO_SNAPSHOT');return structuredClone(this.current.snapshot);}
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  submit(command){return this.call('submit',{command});}
  forkOffline(options={}){return this.submit(offlineForkCommand(this.current?.snapshot,options));}
  inspectLease(spaceId,entityId,criteria={}){return this.call('inspectLease',{spaceId,entityId,...(Object.keys(criteria).length?{criteria}:{})});}
  renewLease(leaseId){return this.call('renewLease',{leaseId});}
  reconcileLease(event){return this.call('reconcileLease',{event});}
  moveEye(view,expectedRevision){return this.call('moveEye',{view,expectedRevision});}
  refresh(){return this.call('state');}
  nextEpoch(){return this.call('nextEpoch');}
  export(){return this.call('export');}
  materialRun(running){return this.call('materialRun',{running});}
  conversationProvider(options={}){
    if(this.closed||!this.session)throw Object.assign(new Error('REMOTE_ADMISSION_REQUIRED'),{code:'REMOTE_ADMISSION_REQUIRED'});
    const remoteOrigin=new URL(this.url).origin.replace(/^ws/,'http');
    const provider=createRemoteConversationProvider({
      ...options,
      token:this.invitationToken,
      origin:options.origin||remoteOrigin,
    });
    this.conversationProviders.add(provider);
    return provider;
  }
  async connectConversationProvider(options={}){
    const provider=this.conversationProvider(options);
    try{await provider.connect();return provider;}catch(error){this.conversationProviders.delete(provider);await provider.close().catch(()=>{});throw error;}
  }
  async _closeConversationProviders(){
    const providers=[...this.conversationProviders];
    this.conversationProviders.clear();
    await Promise.all(providers.map(provider=>provider.close().catch(()=>{})));
  }
  async memoryRequest(op,args={},fetchImpl=globalThis.fetch){
    return this._memoryRequest('/api/neural-memory',op,args,fetchImpl);
  }
  async _memoryRequest(path,op,args,fetchImpl){
    if(!['/api/neural-memory','/api/neural-memory/capsule'].includes(path))throw Error('MEMORY_PATH_INVALID');
    if(this.closed||!this.session)throw Object.assign(new Error('REMOTE_ADMISSION_REQUIRED'),{code:'REMOTE_ADMISSION_REQUIRED'});
    const origin=new URL(this.url).origin.replace(/^ws/,'http');
    if(globalThis.location?.origin&&globalThis.location.origin!==origin)throw Error('MEMORY_ORIGIN_INVALID');
    const socket=this.socket,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{
      const response=await fetchImpl(origin+path,{method:'POST',redirect:'error',cache:'no-store',
        credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json',
          Authorization:'Bearer '+this.invitationToken},body:JSON.stringify({op,args})});
      const body=await response.json();
      if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
      if(body?.schema!=='vivo.neural-memory/1')throw Error('MEMORY_PROTOCOL_INVALID');
      if(!response.ok)throw Object.assign(new Error(/^[A-Z][A-Z0-9_]{1,63}$/.test(body.error)?body.error:'MEMORY_REQUEST_FAILED'),{code:body.error});
      return body.result;
    }finally{clearTimeout(timer);}
  }
  async prepareMemoryBackupPart(cursor={after:null,revision:null},fetchImpl=globalThis.fetch){
    if(this.role!=='owner')throw Error('MEMORY_OWNER_REQUIRED');
    const key=structuredClone(cursor),socket=this.socket;
    const fail=()=>{throw Error('MEMORY_BACKUP_PART_INVALID');};
    const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
    if(!reasoningKeys(key,['after','revision'])||
      !((key.after===null&&key.revision===null)||(integer(key.after,1,Number.MAX_SAFE_INTEGER)&&reasoningDigest(key.revision))))fail();
    const result=await this._memoryRequest('/api/neural-memory/capsule','backup',key,fetchImpl);
    if(!reasoningKeys(result,['schema','revision','after','offset','count','total','nextAfter','complete','capsule','includesGrants','includesRestoreReceipts'])||
      result.schema!=='vivo.memory-backup-part/1'||!reasoningDigest(result.revision)||result.after!==key.after||
      (key.revision!==null&&result.revision!==key.revision)||result.includesGrants!==false||result.includesRestoreReceipts!==false||
      !integer(result.total,0,128)||!integer(result.offset,0,result.total)||!integer(result.count,0,64)||
      result.offset+result.count>result.total||(key.after===null&&result.offset!==0)||
      (result.count===0&&result.total!==0)||result.complete!==(result.offset+result.count===result.total)||
      (result.complete?result.nextAfter!==null:!integer(result.nextAfter,(key.after??0)+1,Number.MAX_SAFE_INTEGER)))fail();
    const capsule=result.capsule;
    if(!reasoningKeys(capsule,['schema','journalJson','journalSha256'])||capsule.schema!=='matumbo.neural-memory-capsule/1'||
      typeof capsule.journalJson!=='string'||capsule.journalJson.length>524288||!reasoningDigest(capsule.journalSha256))fail();
    const bytes=new TextEncoder().encode(capsule.journalJson);
    if(bytes.length>524288)fail();
    const sha=async data=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
    if(await sha(bytes)!==capsule.journalSha256)fail();
    let envelopes;try{envelopes=JSON.parse(capsule.journalJson);}catch{fail();}
    if(!Array.isArray(envelopes)||envelopes.length!==result.count||JSON.stringify(envelopes)!==capsule.journalJson)fail();
    const seen=new Set();
    for(const envelope of envelopes){
      if(!reasoningKeys(envelope,['schema','reportJson','reportSha256'])||envelope.schema!=='matumbo.provider-council-export/1'||
        typeof envelope.reportJson!=='string'||envelope.reportJson.length>32000||!reasoningDigest(envelope.reportSha256)||
        await sha(new TextEncoder().encode(envelope.reportJson))!==envelope.reportSha256)fail();
      let report;try{report=JSON.parse(envelope.reportJson);}catch{fail();}
      if(!['matumbo.provider-council/1','matumbo.provider-council/2'].includes(report?.schema)||
        !['fixture','live'].includes(report.mode)||typeof report.runId!=='string'||seen.has(report.runId)||
        report.worldActionExecuted!==false||report.postedChargesUsd!==null||JSON.stringify(report)!==envelope.reportJson)fail();
      seen.add(report.runId);
    }
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    return Object.freeze({revision:result.revision,offset:result.offset,count:result.count,total:result.total,
      complete:result.complete,nextAfter:result.nextAfter,
      filename:'neural-memory-'+result.revision.slice(0,12)+'-'+(result.offset+1)+'-'+(result.offset+result.count)+'.json',
      text:JSON.stringify(capsule,null,2)+'\n',digest:capsule.journalSha256});
  }
  async _verifyRestoreReceipt(receipt){
    const keys=['schema','capsuleDigest','baseRevision','committedAt','addedMemoryIds','added','duplicates',
      'totalAtCommit','newReportsPrivateAtCommit','receiptSha256'];
    const count=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
    if(!reasoningKeys(receipt,keys)||receipt.schema!=='vivo.memory-capsule-commit/1'||
      !reasoningDigest(receipt.capsuleDigest)||!reasoningDigest(receipt.baseRevision)||!reasoningDigest(receipt.receiptSha256)||
      !count(receipt.committedAt,0,Number.MAX_SAFE_INTEGER)||receipt.newReportsPrivateAtCommit!==true||
      !count(receipt.added,1,64)||!count(receipt.duplicates,0,64)||receipt.added+receipt.duplicates>64||
      !count(receipt.totalAtCommit,receipt.added+receipt.duplicates,128)||
      !Array.isArray(receipt.addedMemoryIds)||receipt.addedMemoryIds.length!==receipt.added||
      new Set(receipt.addedMemoryIds).size!==receipt.added||
      !receipt.addedMemoryIds.every(id=>typeof id==='string'&&/^council:[0-9a-f]{64}$/.test(id)))
      throw Error('MEMORY_RESTORE_RECEIPT_INVALID');
    const {receiptSha256,...core}=receipt;
    const hash=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(core)));
    if(Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')!==receiptSha256)
      throw Error('MEMORY_RESTORE_RECEIPT_INVALID');
    return receipt;
  }
  async reconcileMemoryRestore(review,fetchImpl=globalThis.fetch){
    if(this.role!=='owner')throw Error('MEMORY_OWNER_REQUIRED');
    const key={capsuleDigest:review?.capsuleDigest,baseRevision:review?.baseRevision},socket=this.socket;
    if(!reasoningDigest(key.capsuleDigest)||!reasoningDigest(key.baseRevision))throw Error('MEMORY_CAPSULE_REVIEW_REQUIRED');
    const result=await this._memoryRequest('/api/neural-memory/capsule','receipt',key,fetchImpl);
    if(result?.schema!=='vivo.memory-capsule-commit-status/1'||result.capsuleDigest!==key.capsuleDigest||
      result.baseRevision!==key.baseRevision||!['committed','not-observed'].includes(result.status))
      throw Error('MEMORY_RESTORE_RECEIPT_INVALID');
    if(result.status==='committed'){
      const receipt=await this._verifyRestoreReceipt(result.receipt);
      if(receipt.capsuleDigest!==key.capsuleDigest||receipt.baseRevision!==key.baseRevision)
        throw Error('MEMORY_RESTORE_RECEIPT_INVALID');
    }else if(result.receipt!==null)throw Error('MEMORY_RESTORE_RECEIPT_INVALID');
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    return result;
  }
  async recentMemoryRestores(fetchImpl=globalThis.fetch){
    if(this.role!=='owner')throw Error('MEMORY_OWNER_REQUIRED');
    const socket=this.socket;
    const result=await this._memoryRequest('/api/neural-memory/capsule','recent',{limit:16},fetchImpl);
    if(result?.schema!=='vivo.memory-capsule-commit-history/1'||!Array.isArray(result.receipts)||result.receipts.length>16)
      throw Error('MEMORY_RESTORE_RECEIPT_INVALID');
    for(const receipt of result.receipts)await this._verifyRestoreReceipt(receipt);
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    return result.receipts;
  }
  async reviewMemoryCapsule(capsule,fetchImpl=globalThis.fetch){
    if(this.role!=='owner')throw Error('MEMORY_OWNER_REQUIRED');
    const snapshot=structuredClone(capsule);
    const result=await this._memoryRequest('/api/neural-memory/capsule','preview',{capsule:snapshot},fetchImpl);
    const count=n=>Number.isInteger(n)&&n>=0&&n<=128;
    if(result?.schema!=='vivo.memory-capsule-review/1'||result.capsuleDigest!==snapshot.journalSha256||
      !reasoningDigest(result.baseRevision)||!reasoningDigest(result.capsuleDigest)||result.newReportsPrivate!==true||
      !['current','incoming','added','duplicates','resulting','fixture','liveClaims'].every(k=>count(result[k]))||
      result.added+result.duplicates!==result.incoming||result.current+result.added!==result.resulting||
      result.fixture+result.liveClaims!==result.incoming)throw Error('MEMORY_CAPSULE_REVIEW_INVALID');
    return result;
  }
  async restoreMemoryCapsule(capsule,review,fetchImpl=globalThis.fetch){
    if(this.role!=='owner')throw Error('MEMORY_OWNER_REQUIRED');
    const snapshot=structuredClone(capsule);
    if(review?.capsuleDigest!==snapshot.journalSha256||!reasoningDigest(review?.baseRevision))throw Error('MEMORY_CAPSULE_REVIEW_REQUIRED');
    const expected=structuredClone(review);
    const result=await this._memoryRequest('/api/neural-memory/capsule','restore',
      {capsule:snapshot,review:{capsuleDigest:expected.capsuleDigest,baseRevision:expected.baseRevision}},fetchImpl);
    if(result?.schema!=='vivo.memory-capsule-restore/1'||result.capsuleDigest!==expected.capsuleDigest||
      result.newReportsPrivate!==true||result.added!==expected.added||result.duplicates!==expected.duplicates||
      result.total!==expected.resulting||result.status!==(expected.added?'restored':'unchanged'))
      throw Error('MEMORY_CAPSULE_RECEIPT_INVALID');
    return result;
  }
  async prepareAgentContext(selection,fetchImpl=globalThis.fetch){
    const packet=await this.memoryRequest('context',selection,fetchImpl);
    if(packet?.schema!=='vivo.agent-evidence-context/1'||packet.authority!=='evidence-only'||
      packet.providerAuthenticated!==false||packet.worldActionExecuted!==false||packet.postedChargesUsd!==null||
      packet.selection?.task!==selection.task||packet.selection?.mode!==selection.mode||
      !Array.isArray(packet.records)||packet.records.length>8||
      packet.records.some(r=>r.task!==selection.task||r.mode!==selection.mode||r.authority!=='evidence-only'||
        r.providerAuthenticated!==false||r.worldActionExecuted!==false||r.postedChargesUsd!==null)||
      !['evidence-found','no-matching-evidence'].includes(packet.status)||
      (packet.status==='evidence-found')!==(packet.records.length>0))throw Error('MEMORY_CONTEXT_INVALID');
    return packet;
  }
  async prepareCouncilEvidenceDownload(memoryId,fetchImpl=globalThis.fetch){
    if(typeof memoryId!=='string'||!/^council:[0-9a-f]{64}$/.test(memoryId))throw Error('MEMORY_EVIDENCE_ID_INVALID');
    const socket=this.socket,digest=memoryId.slice(8);
    // Fresh server-side get rechecks the caller and grant; do not reuse a
    // previously recalled record as authority for a new download.
    const result=await this.memoryRequest('get',{memoryId},fetchImpl);
    const envelope=result?.envelope,record=result?.record;
    if(!reasoningKeys(envelope,['schema','reportJson','reportSha256'])||
      envelope.schema!=='matumbo.provider-council-export/1'||envelope.reportSha256!==digest||
      typeof envelope.reportJson!=='string'||envelope.reportJson.length>32000||
      record?.memoryId!==memoryId||record?.evidenceDigest!==digest||record?.authority!=='evidence-only'||
      record?.providerAuthenticated!==false||record?.worldActionExecuted!==false||record?.postedChargesUsd!==null)
      throw Error('MEMORY_EVIDENCE_EXPORT_INVALID');
    const actual=Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(envelope.reportJson))),byte=>byte.toString(16).padStart(2,'0')).join('');
    let report;try{report=JSON.parse(envelope.reportJson);}catch{throw Error('MEMORY_EVIDENCE_EXPORT_INVALID');}
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    if(actual!==digest||JSON.stringify(report)!==envelope.reportJson||
      !['matumbo.provider-council/1','matumbo.provider-council/2'].includes(report?.schema)||
      !['fixture','live'].includes(report.mode)||report.mode!==record.mode||report.runId!==record.runId||
      report.worldActionExecuted!==false||report.postedChargesUsd!==null)
      throw Error('MEMORY_EVIDENCE_EXPORT_INVALID');
    return Object.freeze({filename:'council-'+report.mode+'-'+digest.slice(0,12)+'.json',
      text:JSON.stringify(envelope,null,2)+'\n',digest});
  }
  async reasonAgentMission(selection,fetchImpl=globalThis.fetch){
    const scope=structuredClone(selection),socket=this.socket;
    const packet=await this.memoryRequest('reason',scope,fetchImpl);
    await verifyAgentReasoningReceipt(packet,scope);
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    return packet;
  }
  createInvite(ttlSeconds=3600){return this.call('invite.create',{ttlSeconds});}
  revokeInvite(id){return this.call('invite.revoke',{id});}
  listInvites(){return this.call('invite.list',{});}
  async close(){
    if(this.closed)return;
    try{if(this.session)await this.call('close',{});}finally{
      await this._closeConversationProviders();
      this.closed=true;this.listeners.clear();try{this.socket?.close();}catch{}
    }
  }
}
