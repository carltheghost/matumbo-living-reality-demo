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

// A complete export is a collection of existing recovery capsules, not a
// server clone. Its manifest covers ordered part boundaries and all digests.
export const MEMORY_BACKUP_SET_MAX_BYTES=5*1024*1024;
const BACKUP_SET_SCHEMA='vivo.memory-backup-set/1';
const BACKUP_MANIFEST_SCHEMA='vivo.memory-backup-manifest/1';
const backupCheck=condition=>{if(!condition)throw Error('MEMORY_BACKUP_SET_INVALID');};
const backupCount=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const backupBytes=text=>new TextEncoder().encode(text);
const backupHash=async(text,cryptoApi=globalThis.crypto)=>{
  backupCheck(Boolean(cryptoApi?.subtle));
  return Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',backupBytes(text))),b=>b.toString(16).padStart(2,'0')).join('');
};
async function validateBackupCapsule(capsule,expectedCount,cryptoApi){
  backupCheck(reasoningKeys(capsule,['schema','journalJson','journalSha256'])&&capsule.schema==='matumbo.neural-memory-capsule/1'&&
    typeof capsule.journalJson==='string'&&capsule.journalJson.length<=524288&&reasoningDigest(capsule.journalSha256));
  const bytes=backupBytes(capsule.journalJson);
  backupCheck(bytes.length<=524288&&await backupHash(capsule.journalJson,cryptoApi)===capsule.journalSha256);
  let envelopes;try{envelopes=JSON.parse(capsule.journalJson);}catch{backupCheck(false);}
  backupCheck(Array.isArray(envelopes)&&envelopes.length===expectedCount&&JSON.stringify(envelopes)===capsule.journalJson);
  const ids=[],seen=new Set();
  for(const envelope of envelopes){
    backupCheck(reasoningKeys(envelope,['schema','reportJson','reportSha256'])&&envelope.schema==='matumbo.provider-council-export/1'&&
      typeof envelope.reportJson==='string'&&envelope.reportJson.length<=32000&&reasoningDigest(envelope.reportSha256)&&
      await backupHash(envelope.reportJson,cryptoApi)===envelope.reportSha256);
    let report;try{report=JSON.parse(envelope.reportJson);}catch{backupCheck(false);}
    backupCheck(['matumbo.provider-council/1','matumbo.provider-council/2'].includes(report?.schema)&&
      ['fixture','live'].includes(report.mode)&&typeof report.runId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(report.runId)&&
      !seen.has(report.runId)&&report.worldActionExecuted===false&&report.postedChargesUsd===null&&JSON.stringify(report)===envelope.reportJson);
    seen.add(report.runId);ids.push(report.runId);
  }
  return {ids,bytes:bytes.length};
}

/** Offline integrity/coverage verification. The digest is not a signature;
 * an internally consistent manufactured history is not provider-authenticated. */
export async function verifyMemoryBackupSet(bundle,{cryptoApi=globalThis.crypto}={}){
  backupCheck(reasoningKeys(bundle,['schema','manifestJson','manifestSha256','capsules'])&&bundle.schema===BACKUP_SET_SCHEMA&&
    typeof bundle.manifestJson==='string'&&bundle.manifestJson.length<=32768&&reasoningDigest(bundle.manifestSha256)&&
    Array.isArray(bundle.capsules)&&bundle.capsules.length>=1&&bundle.capsules.length<=128);
  // Snapshot only bounded expected fields before the first await.
  for(const capsule of bundle.capsules)backupCheck(reasoningKeys(capsule,['schema','journalJson','journalSha256'])&&
    capsule.schema==='matumbo.neural-memory-capsule/1'&&typeof capsule.journalJson==='string'&&
    capsule.journalJson.length<=524288&&reasoningDigest(capsule.journalSha256));
  const innerChars=bundle.capsules.reduce((sum,c)=>sum+c.journalJson.length,0);
  backupCheck(innerChars<=2*1024*1024+384);
  const copy=structuredClone(bundle);
  backupCheck(backupBytes(JSON.stringify(copy)).length<=MEMORY_BACKUP_SET_MAX_BYTES);
  const raw=copy.manifestJson;
  backupCheck(await backupHash(raw,cryptoApi)===copy.manifestSha256);
  let manifest;try{manifest=JSON.parse(raw);}catch{backupCheck(false);}
  backupCheck(reasoningKeys(manifest,['schema','revision','total','parts','includesGrants','includesRestoreReceipts'])&&
    manifest.schema===BACKUP_MANIFEST_SCHEMA&&reasoningDigest(manifest.revision)&&backupCount(manifest.total,0,128)&&
    manifest.includesGrants===false&&manifest.includesRestoreReceipts===false&&Array.isArray(manifest.parts)&&
    manifest.parts.length===copy.capsules.length&&JSON.stringify(manifest)===raw);
  let offset=0,journalBytes=0;
  const seen=new Set(),parts=[];
  for(let i=0;i<manifest.parts.length;i++){
    const part=manifest.parts[i],capsule=copy.capsules[i];
    backupCheck(reasoningKeys(part,['offset','count','journalSha256'])&&part.offset===offset&&
      backupCount(part.count,0,64)&&part.offset+part.count<=manifest.total&&
      (part.count>0||(manifest.total===0&&manifest.parts.length===1))&&part.journalSha256===capsule.journalSha256);
    const checked=await validateBackupCapsule(capsule,part.count,cryptoApi);
    for(const id of checked.ids){backupCheck(!seen.has(id));seen.add(id);}
    journalBytes+=checked.bytes;offset+=part.count;
    parts.push(Object.freeze({...part,capsule:Object.freeze(capsule)}));
  }
  backupCheck(offset===manifest.total&&journalBytes<=2*1024*1024+384);
  return Object.freeze({revision:manifest.revision,total:manifest.total,manifestSha256:copy.manifestSha256,
    parts:Object.freeze(parts),includesGrants:false,includesRestoreReceipts:false});
}

// Mission planning is a read-only bounded solver. Unlike the fixed legacy
// certificate, it accepts an explicit resource-allocation definition.
const MISSION_MAX_JOBS=12, MISSION_MAX_UNIT=1000000;
const missionCheck=condition=>{if(!condition)throw Error('MEMORY_MISSION_INVALID');};
const missionInteger=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const asciiCompare=(a,b)=>a<b?-1:a>b?1:0;
export function normalizeAgentMission(mission){
  missionCheck(reasoningKeys(mission,['budget','jobs','required','conflicts'])&&
    missionInteger(mission.budget,0,MISSION_MAX_JOBS*MISSION_MAX_UNIT)&&Array.isArray(mission.jobs)&&
    mission.jobs.length>=1&&mission.jobs.length<=MISSION_MAX_JOBS);
  const ids=new Set(),jobs=[];
  for(const job of mission.jobs){
    missionCheck(reasoningKeys(job,['id','cost','value'])&&typeof job.id==='string'&&/^[A-Z][A-Z0-9]{0,7}$/.test(job.id)&&
      !ids.has(job.id)&&missionInteger(job.cost,0,MISSION_MAX_UNIT)&&missionInteger(job.value,0,MISSION_MAX_UNIT));
    ids.add(job.id);jobs.push({id:job.id,cost:job.cost,value:job.value});
  }
  const required=mission.required,conflicts=mission.conflicts;
  missionCheck(Array.isArray(required)&&required.length<=ids.size&&required.every(id=>ids.has(id))&&
    new Set(required).size===required.length&&Array.isArray(conflicts)&&conflicts.length<=ids.size*(ids.size-1)/2);
  const pairs=new Set();
  for(const pair of conflicts){
    missionCheck(Array.isArray(pair)&&pair.length===2&&pair.every(id=>ids.has(id))&&pair[0]!==pair[1]);
    const key=[...pair].sort(asciiCompare).join(',');
    missionCheck(!pairs.has(key));pairs.add(key);
  }
  return {budget:mission.budget,jobs:jobs.sort((a,b)=>asciiCompare(a.id,b.id)),
    required:[...required].sort(asciiCompare),conflicts:[...pairs].sort(asciiCompare).map(key=>key.split(','))};
}
function normalizeMissionSelection(scope){
  missionCheck(reasoningKeys(scope,['mode','providers','limit'])&&['fixture','live'].includes(scope.mode)&&
    Array.isArray(scope.providers)&&scope.providers.length<=7&&scope.providers.every(p=>REASONING_PROVIDERS.has(p))&&
    new Set(scope.providers).size===scope.providers.length&&missionInteger(scope.limit,1,8));
  return {mode:scope.mode,providers:[...scope.providers].sort(asciiCompare),limit:scope.limit};
}
const missionHash=async(text,cryptoApi)=>{
  missionCheck(Boolean(cryptoApi?.subtle));
  const bytes=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
};
async function recomputeMission(mission,cryptoApi){
  // Independent bitmask enumeration, including the empty subset.
  const rows=[];
  for(let mask=0;mask<(1<<mission.jobs.length);mask++){
    const jobs=mission.jobs.filter((_,i)=>mask&(1<<i)),ids=new Set(jobs.map(j=>j.id));
    const cost=jobs.reduce((sum,j)=>sum+j.cost,0),value=jobs.reduce((sum,j)=>sum+j.value,0);
    const feasible=cost<=mission.budget&&mission.required.every(id=>ids.has(id))&&
      mission.conflicts.every(([a,b])=>!ids.has(a)||!ids.has(b));
    rows.push([jobs.map(j=>j.id).join(','),cost,value,feasible]);
  }
  rows.sort((a,b)=>asciiCompare(a[0],b[0]));
  const feasible=rows.filter(row=>row[3]).sort((a,b)=>b[2]-a[2]||a[1]-b[1]||asciiCompare(a[0],b[0]));
  const [best,second]=feasible;
  const projected=row=>row?{candidate:row[0],cost:row[1],value:row[2],feasible:true}:null;
  return {proposal:projected(best),proof:{method:'exhaustive-bounded-subsets/1',
    subsetsChecked:rows.length,feasibleSubsets:feasible.length,
    equallyValuableOptima:best?feasible.filter(row=>row[2]===best[2]).length:0,
    runnerUp:projected(second),optimalityGap:second?best[2]-second[2]:null,
    enumerationSha256:await missionHash(JSON.stringify(rows),cryptoApi),
    ranking:'value-desc-cost-asc-id-asc',includesEmptyChoice:true}};
}
export async function verifyAgentMissionPlan(packet,request,{cryptoApi=globalThis.crypto}={}){
  missionCheck(reasoningKeys(request,['mission','selection']));
  const mission=normalizeAgentMission(request.mission),scope=normalizeMissionSelection(request.selection);
  missionCheck(reasoningKeys(packet,['schema','mission','missionSha256','selection','proposal','status','proof','evidence',
    'authority','providerAuthenticated','providerCallsInitiated','postedChargesUsd','worldActionExecuted','decisionSha256'])&&
    packet.schema==='vivo.agent-mission-plan/1'&&packet.authority==='evidence-only'&&packet.providerAuthenticated===false&&
    packet.providerCallsInitiated===0&&packet.postedChargesUsd===null&&packet.worldActionExecuted===false&&
    reasoningDigest(packet.decisionSha256)&&JSON.stringify(packet.mission)===JSON.stringify(mission)&&
    JSON.stringify(packet.selection)===JSON.stringify(scope)&&
    packet.missionSha256===await missionHash(JSON.stringify(mission),cryptoApi));
  const {decisionSha256,...core}=packet;
  missionCheck(await missionHash(JSON.stringify(core),cryptoApi)===decisionSha256);
  const expected=await recomputeMission(mission,cryptoApi);
  // Compare the server's independently computed entire certificate to ours.
  missionCheck(JSON.stringify(packet.proposal)===JSON.stringify(expected.proposal)&&
    JSON.stringify(packet.proof)===JSON.stringify(expected.proof)&&
    packet.status===(expected.proposal?'optimal':'infeasible')&&reasoningKeys(packet.evidence,['status','receipt']));
  const known={budget:7,jobs:REASONING_JOBS,required:[],conflicts:[]};
  if(JSON.stringify(mission)===JSON.stringify(known)){
    missionCheck(packet.evidence.status==='exact-task-recall');
    await verifyAgentReasoningReceipt(packet.evidence.receipt,{task:'route-constraint-v1',...scope},{cryptoApi});
    missionCheck(exactPlan(packet.evidence.receipt.proposal,expected.proposal));
  }else missionCheck(packet.evidence.status==='mission-not-in-memory-contract'&&packet.evidence.receipt===null);
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
    if(!['/api/neural-memory','/api/neural-memory/capsule','/api/neural-memory/backup-set'].includes(path))throw Error('MEMORY_PATH_INVALID');
    if(this.closed||!this.session)throw Object.assign(new Error('REMOTE_ADMISSION_REQUIRED'),{code:'REMOTE_ADMISSION_REQUIRED'});
    const origin=new URL(this.url).origin.replace(/^ws/,'http');
    if(globalThis.location?.origin&&globalThis.location.origin!==origin)throw Error('MEMORY_ORIGIN_INVALID');
    const socket=this.socket,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),
      path==='/api/neural-memory/backup-set'?Math.max(this.timeoutMs,20000):this.timeoutMs);
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
    try{await validateBackupCapsule(capsule,result.count,globalThis.crypto);}catch{fail();}
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    return Object.freeze({revision:result.revision,offset:result.offset,count:result.count,total:result.total,
      complete:result.complete,nextAfter:result.nextAfter,
      filename:'neural-memory-'+result.revision.slice(0,12)+'-'+(result.offset+1)+'-'+(result.offset+result.count)+'.json',
      text:JSON.stringify(capsule,null,2)+'\n',digest:capsule.journalSha256});
  }
  async prepareCompleteMemoryBackup(fetchImpl=globalThis.fetch){
    if(this.role!=='owner')throw Error('MEMORY_OWNER_REQUIRED');
    const socket=this.socket,parts=[],capsules=[];
    let revision=null,total=null,after=null,offset=0,complete=false;
    // Each nonempty part advances by at least one report. The bounded vault
    // has at most 128 records; never loop indefinitely or mix revisions.
    for(let i=0;i<128;i++){
      const part=await this.prepareMemoryBackupPart({after,revision},fetchImpl);
      if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
      if(i===0){revision=part.revision;total=part.total;}
      backupCheck(part.revision===revision&&part.total===total&&part.offset===offset);
      parts.push({offset,count:part.count,journalSha256:part.digest});
      capsules.push(JSON.parse(part.text));
      offset+=part.count;complete=part.complete;
      if(complete)break;
      after=part.nextAfter;
    }
    backupCheck(complete&&offset===total);
    const manifestJson=JSON.stringify({schema:BACKUP_MANIFEST_SCHEMA,revision,total,parts,
      includesGrants:false,includesRestoreReceipts:false});
    const bundle={schema:BACKUP_SET_SCHEMA,manifestJson,manifestSha256:await backupHash(manifestJson),capsules};
    const verified=await verifyMemoryBackupSet(bundle);
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    const text=JSON.stringify(bundle,null,2)+'\n';
    backupCheck(backupBytes(text).length<=MEMORY_BACKUP_SET_MAX_BYTES);
    return Object.freeze({filename:'neural-memory-backup-'+revision.slice(0,12)+'-'+total+'.json',
      text,total,parts:verified.parts.length,manifestSha256:verified.manifestSha256});
  }
  async _verifyRestoreReceipt(receipt,backupSet=false){
    const field=backupSet?'manifestDigest':'capsuleDigest',kind=backupSet?'backup':'capsule',maximum=backupSet?128:64;
    const keys=['schema',field,'baseRevision','committedAt','addedMemoryIds','added','duplicates',
      'totalAtCommit','newReportsPrivateAtCommit','receiptSha256'];
    const count=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
    if(!reasoningKeys(receipt,keys)||receipt.schema!=='vivo.memory-'+kind+'-commit/1'||
      !reasoningDigest(receipt[field])||!reasoningDigest(receipt.baseRevision)||!reasoningDigest(receipt.receiptSha256)||
      !count(receipt.committedAt,0,Number.MAX_SAFE_INTEGER)||receipt.newReportsPrivateAtCommit!==true||
      !count(receipt.added,1,maximum)||!count(receipt.duplicates,0,maximum)||receipt.added+receipt.duplicates>maximum||
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
  async reviewCompleteMemoryBackup(bundle,fetchImpl=globalThis.fetch){
    if(this.role!=='owner')throw Error('MEMORY_OWNER_REQUIRED');
    const socket=this.socket,snapshot=structuredClone(bundle);
    const verified=await verifyMemoryBackupSet(snapshot);
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    const result=await this._memoryRequest('/api/neural-memory/backup-set','preview',{bundle:snapshot},fetchImpl);
    const count=n=>backupCount(n,0,128);
    if(result?.schema!=='vivo.memory-backup-review/1'||result.manifestDigest!==verified.manifestSha256||
      result.sourceRevision!==verified.revision||result.incoming!==verified.total||result.parts!==verified.parts.length||
      !reasoningDigest(result.baseRevision)||result.newReportsPrivate!==true||
      !['current','incoming','added','duplicates','resulting','fixture','liveClaims'].every(k=>count(result[k]))||
      result.added+result.duplicates!==result.incoming||result.current+result.added!==result.resulting||
      result.fixture+result.liveClaims!==result.incoming)throw Error('MEMORY_BACKUP_REVIEW_INVALID');
    return Object.freeze(result);
  }
  async restoreCompleteMemoryBackup(bundle,review,fetchImpl=globalThis.fetch){
    if(this.role!=='owner')throw Error('MEMORY_OWNER_REQUIRED');
    const socket=this.socket,snapshot=structuredClone(bundle),expected=structuredClone(review);
    const verified=await verifyMemoryBackupSet(snapshot);
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    if(expected?.manifestDigest!==verified.manifestSha256||!reasoningDigest(expected?.baseRevision)||
      expected.incoming!==verified.total||expected.parts!==verified.parts.length||expected.sourceRevision!==verified.revision)
      throw Error('MEMORY_BACKUP_REVIEW_REQUIRED');
    const result=await this._memoryRequest('/api/neural-memory/backup-set','restore',
      {bundle:snapshot,review:{manifestDigest:expected.manifestDigest,baseRevision:expected.baseRevision}},fetchImpl);
    if(result?.schema!=='vivo.memory-backup-restore/1'||result.manifestDigest!==expected.manifestDigest||
      result.newReportsPrivate!==true||result.added!==expected.added||result.duplicates!==expected.duplicates||
      result.total!==expected.resulting||result.status!==(expected.added?'restored':'unchanged'))
      throw Error('MEMORY_BACKUP_RECEIPT_INVALID');
    return result;
  }
  async reconcileCompleteMemoryRestore(review,fetchImpl=globalThis.fetch){
    if(this.role!=='owner')throw Error('MEMORY_OWNER_REQUIRED');
    const key={manifestDigest:review?.manifestDigest,baseRevision:review?.baseRevision},socket=this.socket;
    if(!reasoningDigest(key.manifestDigest)||!reasoningDigest(key.baseRevision))throw Error('MEMORY_BACKUP_REVIEW_REQUIRED');
    const result=await this._memoryRequest('/api/neural-memory/backup-set','receipt',key,fetchImpl);
    if(result?.schema!=='vivo.memory-backup-commit-status/1'||result.manifestDigest!==key.manifestDigest||
      result.baseRevision!==key.baseRevision||!['committed','not-observed'].includes(result.status))
      throw Error('MEMORY_RESTORE_RECEIPT_INVALID');
    if(result.status==='committed'){
      const receipt=await this._verifyRestoreReceipt(result.receipt,true);
      if(receipt.manifestDigest!==key.manifestDigest||receipt.baseRevision!==key.baseRevision)
        throw Error('MEMORY_RESTORE_RECEIPT_INVALID');
    }else if(result.receipt!==null)throw Error('MEMORY_RESTORE_RECEIPT_INVALID');
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    return result;
  }
  async recentCompleteMemoryRestores(fetchImpl=globalThis.fetch){
    if(this.role!=='owner')throw Error('MEMORY_OWNER_REQUIRED');
    const socket=this.socket;
    const result=await this._memoryRequest('/api/neural-memory/backup-set','recent',{limit:16},fetchImpl);
    if(result?.schema!=='vivo.memory-backup-commit-history/1'||!Array.isArray(result.receipts)||result.receipts.length>16)
      throw Error('MEMORY_RESTORE_RECEIPT_INVALID');
    for(const receipt of result.receipts)await this._verifyRestoreReceipt(receipt,true);
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
  async planAgentMission(request,fetchImpl=globalThis.fetch){
    missionCheck(reasoningKeys(request,['mission','selection']));
    const scope={mission:normalizeAgentMission(request.mission),selection:normalizeMissionSelection(request.selection)},socket=this.socket;
    const packet=await this.memoryRequest('plan',scope,fetchImpl);
    await verifyAgentMissionPlan(packet,scope);
    if(this.closed||this.socket!==socket)throw Error('REMOTE_CLOSED');
    return packet;
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
