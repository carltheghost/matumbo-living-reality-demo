import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteTransport,verifyAgentMissionPlan,normalizeAgentMission,verifyMemoryBackupSet,verifyAgentReasoningReceipt} from '../../web/application/remote-transport.mjs';

class FakeSocket {
  static instances=[];
  constructor(url){this.url=url;this.readyState=0;this.sent=[];FakeSocket.instances.push(this);}
  send(raw){this.sent.push(JSON.parse(raw));}
  open(){this.readyState=1;this.onopen?.();}
  emit(message){this.onmessage?.({data:JSON.stringify(message)});}
  close(){this.readyState=3;this.onclose?.();}
}

async function admitted(onError=()=>{}){
  FakeSocket.instances.length=0;
  const transport=new RemoteTransport({url:'ws://vivo.test/ws',token:'x'.repeat(24),WebSocket:FakeSocket,onError,timeoutMs:1000});
  const joining=transport.admit();
  const socket=FakeSocket.instances[0];
  socket.open();
  socket.emit({type:'joined',role:'owner',actorId:'remote.owner',session:{id:'s'},state:{snapshot:{acceptedSequence:0}}});
  await joining;
  return {transport,socket};
}
async function shutdown(transport,socket){
  const closing=transport.close();
  const id=socket.sent.at(-1).id;
  socket.emit({type:'reply',id,value:{closed:true}});
  await closing;
}

test('top-level authority errors reject pending calls and reach the UI hook',async()=>{
  const errors=[];
  const {transport,socket}=await admitted(error=>errors.push(error));
  const pending=transport.refresh();
  assert.equal(socket.sent.at(-1).op,'state');
  socket.emit({type:'error',code:'AUTHORITY_UNAVAILABLE'});
  await assert.rejects(pending,error=>error.code==='AUTHORITY_UNAVAILABLE');
  assert.equal(errors.at(-1).code,'AUTHORITY_UNAVAILABLE');
  await shutdown(transport,socket);
});

test('a rate-limit error cannot leave a request hanging',async()=>{
  const {transport,socket}=await admitted();
  const pending=transport.call('submit',{command:{}});
  socket.emit({type:'error',code:'RATE_LIMIT'});
  await assert.rejects(pending,error=>error.code==='RATE_LIMIT');
  await shutdown(transport,socket);
});

test('identified reply errors still reject only their request',async()=>{
  const {transport,socket}=await admitted();
  const first=transport.call('state');
  const second=transport.call('export');
  const ids=socket.sent.slice(-2).map(message=>message.id);
  socket.emit({type:'reply',id:ids[0],error:'STALE_STATE'});
  await assert.rejects(first,error=>error.code==='STALE_STATE');
  socket.emit({type:'reply',id:ids[1],value:{ok:true}});
  assert.deepEqual(await second,{ok:true});
  await shutdown(transport,socket);
});

test('conversation provider is an explicit admitted-session handoff and closes with transport',async()=>{
  const before=new RemoteTransport({url:'ws://vivo.test/ws',token:'x'.repeat(24),WebSocket:FakeSocket});
  assert.throws(()=>before.conversationProvider({fetch:async()=>{}}),error=>error.code==='REMOTE_ADMISSION_REQUIRED');

  const calls=[];
  const {transport,socket}=await admitted();
  const provider=await transport.connectConversationProvider({
    location:{origin:'http://vivo.test'},
    fetch:async(url,init)=>{
      calls.push({url:String(url),init,body:init.body?JSON.parse(init.body):null});
      if(init.method==='GET')return {ok:true,status:200,json:async()=>({schema:'vivo.conversation/2',status:'ready',available:true})};
      return {ok:true,status:200,json:async()=>({schema:'vivo.conversation/2',status:'complete',requestId:calls.at(-1).body.requestId,generation:calls.at(-1).body.generation,conversationId:'fixture',text:'remote fixture',reaction:null})};
    },
    sessionId:'remote-phone-tab',
  });
  assert.equal(provider.available,true);
  const result=await provider.respond({
    message:'hello',
    companion:{id:'relic',name:'Relic',role:'Keeper'},
    world:{worldId:'world-1',branchId:'branch-1',eyeId:'eye-1',spaceId:'root',dimension:4,entity:{id:'relic',name:'Relic',q:[0,0,0,0],revision:0}},
  });
  assert.equal(result.text,'remote fixture');
  assert.equal(calls.length,2);
  assert.equal(calls[1].init.headers.Authorization,'Bearer '+'x'.repeat(24));
  assert.equal(calls[1].url.includes('x'.repeat(24)),false);
  assert.equal(JSON.stringify(calls[1].body).includes('x'.repeat(24)),false);

  let rejectedFetches=0;
  assert.throws(()=>transport.conversationProvider({
    respondPath:'/api/conversation/../leak',
    fetch:async()=>{rejectedFetches+=1;},
  }),error=>error.code==='CONVERSATION_RESPOND_PATH_INVALID');
  assert.equal(rejectedFetches,0);

  const closing=transport.close();
  const id=socket.sent.at(-1).id;
  socket.emit({type:'reply',id,value:{closed:true}});
  await closing;
  assert.equal(provider.available,false);
});

test('unexpected remote socket closure fences an admitted conversation provider',async()=>{
  const {transport,socket}=await admitted();
  const provider=await transport.connectConversationProvider({
    location:{origin:'http://vivo.test'},
    fetch:async(_url,init)=>({ok:true,status:200,json:async()=>init.method==='GET'
      ? {schema:'vivo.conversation/2',status:'ready',available:true}
      : {schema:'vivo.conversation/2',status:'complete',requestId:'x',generation:1,text:'x',reaction:null}}),
  });
  assert.equal(provider.available,true);
  socket.close();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(provider.available,false);
  assert.equal(transport.closed,true);
});

test('agent memory context is explicit same-origin scoped recall and never a provider request',async()=>{
  const {transport,socket}=await admitted();
  const selection={task:'route-constraint-v1',mode:'fixture',providers:['kimi'],limit:4};
  const basePacket={schema:'vivo.agent-evidence-context/1',selection,status:'no-matching-evidence',
    records:[],truncated:false,authority:'evidence-only',providerAuthenticated:false,worldActionExecuted:false,postedChargesUsd:null};
  const calls=[];
  const fetchImpl=async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({schema:'vivo.neural-memory/1',result:basePacket})};};
  assert.deepEqual(await transport.prepareAgentContext(selection,fetchImpl),basePacket);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'http://vivo.test/api/neural-memory');
  assert.deepEqual(JSON.parse(calls[0].init.body),{op:'context',args:selection});
  assert.equal(calls[0].init.redirect,'error');
  assert.equal(calls[0].init.headers.Authorization,'Bearer '+'x'.repeat(24));
  await assert.rejects(transport.prepareAgentContext(selection,async()=>({ok:true,json:async()=>({schema:'vivo.neural-memory/1',
    result:{...basePacket,authority:'execute'}})})),/MEMORY_CONTEXT_INVALID/);
  let release;
  const pending=transport.prepareAgentContext(selection,()=>new Promise(resolve=>{release=resolve;}));
  socket.close();
  release({ok:true,json:async()=>({schema:'vivo.neural-memory/1',result:basePacket})});
  await assert.rejects(pending,/REMOTE_CLOSED/);
});

// Independent expected table, not generated by the production verifier.
const reasonPlans=[
  ['A',3,5],['B',4,7],['C',5,9],['D',2,4],['A,B',7,12],['A,C',8,14],
  ['A,D',5,9],['B,C',9,16],['B,D',6,11],['C,D',7,13],
  ['A,B,C',12,21],['A,B,D',9,16],['A,C,D',10,18],['B,C,D',11,20],['A,B,C,D',14,25],
].map(([candidate,cost,value])=>({candidate,cost,value,feasible:cost<=7}));
const reasonScope={task:'route-constraint-v1',mode:'fixture',providers:['kimi'],limit:4};
const emptyCounts=()=>({optimal:0,'feasible-suboptimal':0,'over-budget':0,'invalid-proposal':0,unknown:0});
function reasonCore(withEvidence=false){
  const observationCounts=emptyCounts(),citations=[];
  if(withEvidence){
    observationCounts.optimal=1;observationCounts['over-budget']=1;observationCounts.unknown=1;
    citations.push({memoryId:'council:'+'a'.repeat(64),evidenceDigest:'a'.repeat(64),runId:'fixture-mixed',
      provenance:'synthetic-fixture',observations:[
        {provider:'openai',candidate:'C,D',verdict:'optimal',status:'response-observed'},
        {provider:'kimi',candidate:'A,C',verdict:'over-budget',status:'response-observed'},
        {provider:'xai',candidate:null,verdict:'unknown',status:'transport-uncertain'},
      ]});
  }
  return structuredClone({schema:'vivo.agent-reasoning/1',selection:reasonScope,
    proposal:reasonPlans.find(p=>p.candidate==='C,D'),
    proof:{method:'exhaustive-subset-enumeration',budget:7,jobs:[
      {id:'A',cost:3,value:5},{id:'B',cost:4,value:7},{id:'C',cost:5,value:9},{id:'D',cost:2,value:4}],
      subsetsChecked:15,feasibleSubsets:8,runnerUp:reasonPlans.find(p=>p.candidate==='A,B'),optimalityGap:1,enumerated:reasonPlans},
    evidence:{status:withEvidence?'matching-optimum-observed':'no-matching-evidence',recordsUsed:citations.length,truncated:false,
      observationCounts,countUnit:'report-provider-observations-not-independent-votes',citations},
    authority:'evidence-only',providerAuthenticated:false,providerCallsInitiated:0,postedChargesUsd:null,worldActionExecuted:false});
}
async function signReason(core){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(core)));
  return {...core,decisionSha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
}
test('agent reasoning verifies exact receipt bytes, selected scope and no execution authority',async()=>{
  const {transport,socket}=await admitted(),selection=reasonScope,packet=await signReason(reasonCore());
  let sent=0;
  const response=value=>async(url,init)=>{
    assert.equal(url,'http://vivo.test/api/neural-memory');
    assert.deepEqual(JSON.parse(init.body),{op:'reason',args:selection});
    sent++;
    return {ok:true,json:async()=>({schema:'vivo.neural-memory/1',result:value})};
  };
  assert.deepEqual(await transport.reasonAgentMission(selection,response(packet)),packet);
  assert.equal(sent,1);
  await assert.rejects(transport.reasonAgentMission(selection,response({...packet,proposal:{...packet.proposal,value:999}})),/DIGEST_MISMATCH/);
  await assert.rejects(transport.reasonAgentMission(selection,response({...packet,providerCallsInitiated:1})),/MEMORY_REASONING_INVALID/);
  await assert.rejects(transport.reasonAgentMission(selection,response({...packet,selection:{...selection,mode:'live'}})),/MEMORY_REASONING_INVALID/);
  await shutdown(transport,socket);
});
test('independent verifier accepts a complete certificate regardless of enumeration order',async()=>{
  const core=reasonCore(true);core.proof.enumerated.reverse();
  const packet=await signReason(core);
  assert.deepEqual(await verifyAgentReasoningReceipt(packet,reasonScope),packet);
});
test('even correctly rehashed false mathematical proofs fail verification',async()=>{
  const mutations=[
    core=>{core.proposal={candidate:'A,B',cost:7,value:12,feasible:true};},
    core=>{core.proof.jobs[0].cost=1;},
    core=>{core.proof.budget=8;},
    core=>{core.proof.enumerated[1]=core.proof.enumerated[0];},
    core=>{core.proof.enumerated.pop();},
    core=>{core.proof.enumerated.find(p=>p.candidate==='A,C').feasible=true;},
    core=>{core.proof.enumerated.find(p=>p.candidate==='A,C').value=13;},
    core=>{core.proof.feasibleSubsets=9;},
    core=>{core.proof.runnerUp=core.proposal;},
    core=>{core.proof.optimalityGap=0;},
  ];
  for(const mutate of mutations){const core=reasonCore();mutate(core);
    await assert.rejects(verifyAgentReasoningReceipt(await signReason(core),reasonScope),/MEMORY_REASONING_PROOF_INVALID/);}
});
test('rehashed inconsistent provenance, duplicate observations and invented corroboration fail closed',async()=>{
  const mutations=[
    core=>{core.evidence.status='no-usable-proposal';},
    core=>{core.evidence.observationCounts.optimal=2;},
    core=>{core.evidence.citations[0].provenance='host-reported-unverified';},
    core=>{core.evidence.citations[0].observations[1].verdict='optimal';},
    core=>{core.evidence.citations[0].observations[2].candidate='C,D';},
    core=>{core.evidence.citations[0].observations.push(core.evidence.citations[0].observations[1]);},
    core=>{core.evidence.citations[0].observations=core.evidence.citations[0].observations.filter(r=>r.provider!=='kimi');},
    core=>{core.evidence.citations.push(core.evidence.citations[0]);core.evidence.recordsUsed++;},
    core=>{core.evidence.citations[0].memoryId='council:'+'b'.repeat(64);},
    core=>{core.evidence.truncated=true;},
  ];
  for(const mutate of mutations){const core=reasonCore(true);mutate(core);
    await assert.rejects(verifyAgentReasoningReceipt(await signReason(core),reasonScope),/MEMORY_REASONING_EVIDENCE_INVALID/);}
});

test('portable remote evidence uses a fresh authorized get and checks original bytes',async()=>{
  const {transport,socket}=await admitted();
  const report={schema:'matumbo.provider-council/2',mode:'fixture',runId:'fixture-portable',
    worldActionExecuted:false,postedChargesUsd:null};
  const reportJson=JSON.stringify(report),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(reportJson))),b=>b.toString(16).padStart(2,'0')).join('');
  const memoryId='council:'+digest,envelope={schema:'matumbo.provider-council-export/1',reportJson,reportSha256:digest};
  const record={memoryId,evidenceDigest:digest,mode:'fixture',runId:report.runId,authority:'evidence-only',
    providerAuthenticated:false,worldActionExecuted:false,postedChargesUsd:null};
  let calls=0;
  const respond=result=>async(url,init)=>{
    calls++;assert.equal(url,'http://vivo.test/api/neural-memory');
    assert.deepEqual(JSON.parse(init.body),{op:'get',args:{memoryId}});
    return {ok:true,json:async()=>({schema:'vivo.neural-memory/1',result})};
  };
  const download=await transport.prepareCouncilEvidenceDownload(memoryId,respond({record,envelope}));
  assert.deepEqual(JSON.parse(download.text),envelope);assert.equal(download.digest,digest);
  await assert.rejects(transport.prepareCouncilEvidenceDownload(memoryId,respond({record,envelope:{...envelope,reportJson:reportJson+' '}})),/MEMORY_EVIDENCE_EXPORT_INVALID/);
  await assert.rejects(transport.prepareCouncilEvidenceDownload(memoryId,async()=>({ok:false,json:async()=>({schema:'vivo.neural-memory/1',error:'NOT_FOUND'})})),/NOT_FOUND/);
  assert.equal(calls,2);
  await shutdown(transport,socket);
});


test('remote capsule review and restore use the dedicated owner-only path and exact reviewed revision',async()=>{
  const {transport,socket}=await admitted();
  const capsule={schema:'matumbo.neural-memory-capsule/1',journalJson:'[]',journalSha256:'a'.repeat(64)};
  const review={schema:'vivo.memory-capsule-review/1',capsuleDigest:capsule.journalSha256,baseRevision:'b'.repeat(64),
    current:0,incoming:2,added:2,duplicates:0,resulting:2,fixture:2,liveClaims:0,newReportsPrivate:true};
  const result={schema:'vivo.memory-capsule-restore/1',capsuleDigest:capsule.journalSha256,status:'restored',
    added:2,duplicates:0,total:2,newReportsPrivate:true};
  const calls=[];
  const response=async(url,init)=>{
    const body=JSON.parse(init.body);calls.push(body);
    assert.equal(url,'http://vivo.test/api/neural-memory/capsule');
    assert.equal(init.redirect,'error');
    return {ok:true,json:async()=>({schema:'vivo.neural-memory/1',result:body.op==='preview'?review:result})};
  };
  assert.deepEqual(await transport.reviewMemoryCapsule(capsule,response),review);
  assert.deepEqual(await transport.restoreMemoryCapsule(capsule,review,response),result);
  assert.deepEqual(calls,[{op:'preview',args:{capsule}},{op:'restore',args:{capsule,review:{capsuleDigest:review.capsuleDigest,baseRevision:review.baseRevision}}}]);
  await assert.rejects(transport.restoreMemoryCapsule(capsule,{...review,capsuleDigest:'c'.repeat(64)},response),/MEMORY_CAPSULE_REVIEW_REQUIRED/);
  await assert.rejects(transport.reviewMemoryCapsule(capsule,async()=>({ok:true,json:async()=>({schema:'vivo.neural-memory/1',result:{...review,newReportsPrivate:false}})})),/MEMORY_CAPSULE_REVIEW_INVALID/);
  transport.role='editor';
  await assert.rejects(transport.reviewMemoryCapsule(capsule,response),/MEMORY_OWNER_REQUIRED/);
  await assert.rejects(transport.restoreMemoryCapsule(capsule,review,response),/MEMORY_OWNER_REQUIRED/);
  assert.equal(calls.length,2);
  await shutdown(transport,socket);
});


test('restore reconciliation is read-only, receipt-bound, and owner-only',async()=>{
  const {transport,socket}=await admitted();
  const key={capsuleDigest:'a'.repeat(64),baseRevision:'b'.repeat(64)};
  const core={schema:'vivo.memory-capsule-commit/1',...key,committedAt:123,addedMemoryIds:['council:'+'c'.repeat(64)],
    added:1,duplicates:1,totalAtCommit:2,newReportsPrivateAtCommit:true};
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(core)));
  const receipt={...core,receiptSha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')};
  const result={schema:'vivo.memory-capsule-commit-status/1',...key,status:'committed',receipt};
  const calls=[];
  const respond=value=>async(url,init)=>{
    assert.equal(url,'http://vivo.test/api/neural-memory/capsule');calls.push(JSON.parse(init.body));
    return {ok:true,json:async()=>({schema:'vivo.neural-memory/1',result:value})};
  };
  assert.deepEqual(await transport.reconcileMemoryRestore(key,respond(result)),result);
  assert.deepEqual(await transport.recentMemoryRestores(respond({schema:'vivo.memory-capsule-commit-history/1',receipts:[receipt]})),[receipt]);
  await assert.rejects(transport.reconcileMemoryRestore(key,respond({...result,receipt:{...receipt,totalAtCommit:99}})),/MEMORY_RESTORE_RECEIPT_INVALID/);
  assert.equal((await transport.reconcileMemoryRestore(key,respond({...result,status:'not-observed',receipt:null}))).status,'not-observed');
  assert.deepEqual(calls.map(x=>x.op),['receipt','recent','receipt','receipt']);
  transport.role='editor';
  await assert.rejects(transport.reconcileMemoryRestore(key,respond(result)),/MEMORY_OWNER_REQUIRED/);
  await assert.rejects(transport.recentMemoryRestores(respond(result)),/MEMORY_OWNER_REQUIRED/);
  assert.equal(calls.length,4);
  await shutdown(transport,socket);
});


test('owner backup validates each original digest and rejects wrong cursor, flags and truncated parts',async()=>{
  const {transport,socket}=await admitted();
  const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  const reportJson=JSON.stringify({schema:'matumbo.provider-council/1',mode:'fixture',runId:'backup-fixture',worldActionExecuted:false,postedChargesUsd:null});
  const envelope={schema:'matumbo.provider-council-export/1',reportJson,reportSha256:await hash(reportJson)};
  const journalJson=JSON.stringify([envelope]),capsule={schema:'matumbo.neural-memory-capsule/1',journalJson,journalSha256:await hash(journalJson)};
  const part={schema:'vivo.memory-backup-part/1',revision:'a'.repeat(64),after:null,offset:0,count:1,total:2,nextAfter:1,complete:false,
    capsule,includesGrants:false,includesRestoreReceipts:false};
  const calls=[];
  const respond=value=>async(url,init)=>{assert.equal(url,'http://vivo.test/api/neural-memory/capsule');calls.push(JSON.parse(init.body));return {ok:true,json:async()=>({schema:'vivo.neural-memory/1',result:value})};};
  const first=await transport.prepareMemoryBackupPart(undefined,respond(part));
  assert.deepEqual(JSON.parse(first.text),capsule);assert.equal(first.nextAfter,1);
  const next={...part,after:1,offset:1,nextAfter:null,complete:true};
  assert.equal((await transport.prepareMemoryBackupPart({after:1,revision:part.revision},respond(next))).complete,true);
  for(const bad of [{...part,includesGrants:true},{...part,count:2},{...part,complete:true},{...part,capsule:{...capsule,journalSha256:'0'.repeat(64)}},
    {...part,capsule:{...capsule,journalJson:journalJson+' ',journalSha256:await hash(journalJson+' ')}}])
    await assert.rejects(transport.prepareMemoryBackupPart(undefined,respond(bad)),/MEMORY_BACKUP_PART_INVALID/);
  await assert.rejects(transport.prepareMemoryBackupPart({after:1,revision:part.revision},respond({...next,revision:'b'.repeat(64)})),/MEMORY_BACKUP_PART_INVALID/);
  assert.ok(calls.every(call=>call.op==='backup'));
  const count=calls.length;transport.role='editor';
  await assert.rejects(transport.prepareMemoryBackupPart(undefined,respond(part)),/MEMORY_OWNER_REQUIRED/);
  assert.equal(calls.length,count);
  await shutdown(transport,socket);
});


test('complete backup set validates exact coverage, rejects missing and mixed parts, and verifies locally',async()=>{
  const {transport,socket}=await admitted();
  const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  const capsuleFor=async runId=>{
    const reportJson=JSON.stringify({schema:'matumbo.provider-council/1',mode:'fixture',runId,worldActionExecuted:false,postedChargesUsd:null});
    const journalJson=JSON.stringify([{schema:'matumbo.provider-council-export/1',reportJson,reportSha256:await hash(reportJson)}]);
    return {schema:'matumbo.neural-memory-capsule/1',journalJson,journalSha256:await hash(journalJson)};
  };
  const a=await capsuleFor('first'),b=await capsuleFor('second'),revision='a'.repeat(64);
  const first={schema:'vivo.memory-backup-part/1',revision,after:null,offset:0,count:1,total:2,nextAfter:1,complete:false,
    capsule:a,includesGrants:false,includesRestoreReceipts:false};
  const second={...first,after:1,offset:1,nextAfter:null,complete:true,capsule:b};
  const calls=[];
  const serve=parts=>async(url,init)=>{
    assert.equal(url,'http://vivo.test/api/neural-memory/capsule');
    const body=JSON.parse(init.body);calls.push(body);
    const part=parts[body.args.after===null?0:1];
    return {ok:true,json:async()=>({schema:'vivo.neural-memory/1',result:part})};
  };
  const complete=await transport.prepareCompleteMemoryBackup(serve([first,second]));
  assert.equal(complete.total,2);assert.equal(complete.parts,2);
  assert.deepEqual(calls,[{op:'backup',args:{after:null,revision:null}},{op:'backup',args:{after:1,revision}}]);
  const file=JSON.parse(complete.text),verified=await verifyMemoryBackupSet(file);
  assert.equal(verified.total,2);assert.equal(verified.revision,revision);
  assert.deepEqual(verified.parts.map(part=>part.capsule),[a,b]);
  const resign=async(manifest,capsules)=>{
    const manifestJson=JSON.stringify(manifest);
    return {...file,manifestJson,manifestSha256:await hash(manifestJson),capsules};
  };
  const manifest=JSON.parse(file.manifestJson);
  for(const wrong of [
    {...file,capsules:[a]},
    {...file,capsules:[b,a]},
    {...file,manifestSha256:'0'.repeat(64)},
    await resign({...manifest,total:3},[a,b]),
    await resign({...manifest,includesGrants:true},[a,b]),
    await resign({...manifest,parts:[manifest.parts[0],{...manifest.parts[1],offset:0}]},[a,b]),
    await resign({...manifest,parts:[manifest.parts[0],{...manifest.parts[1],journalSha256:a.journalSha256}]},[a,a]),
  ])await assert.rejects(verifyMemoryBackupSet(wrong),/MEMORY_BACKUP_SET_INVALID/);
  await assert.rejects(transport.prepareCompleteMemoryBackup(serve([first,{...second,revision:'b'.repeat(64)}])),/MEMORY_BACKUP_PART_INVALID/);
  await assert.rejects(transport.prepareCompleteMemoryBackup(serve([first,{...second,capsule:a}])),/MEMORY_BACKUP_SET_INVALID/);
  const before=calls.length;transport.role='editor';
  await assert.rejects(transport.prepareCompleteMemoryBackup(serve([first,second])),/MEMORY_OWNER_REQUIRED/);
  assert.equal(calls.length,before);
  await shutdown(transport,socket);
});


test('complete restore reviews exact manifest, writes once and reconciles the historical receipt without retry',async()=>{
  const {transport,socket}=await admitted();
  const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  const reportJson=JSON.stringify({schema:'matumbo.provider-council/1',mode:'fixture',runId:'restore-set-fixture',worldActionExecuted:false,postedChargesUsd:null});
  const reportSha256=await hash(reportJson),journalJson=JSON.stringify([{schema:'matumbo.provider-council-export/1',reportJson,reportSha256}]);
  const capsule={schema:'matumbo.neural-memory-capsule/1',journalJson,journalSha256:await hash(journalJson)};
  const revision='a'.repeat(64),baseRevision='b'.repeat(64);
  const manifestJson=JSON.stringify({schema:'vivo.memory-backup-manifest/1',revision,total:1,parts:[{offset:0,count:1,journalSha256:capsule.journalSha256}],includesGrants:false,includesRestoreReceipts:false});
  const manifestDigest=await hash(manifestJson),bundle={schema:'vivo.memory-backup-set/1',manifestJson,manifestSha256:manifestDigest,capsules:[capsule]};
  const review={schema:'vivo.memory-backup-review/1',manifestDigest,sourceRevision:revision,baseRevision,parts:1,current:0,incoming:1,added:1,duplicates:0,resulting:1,fixture:1,liveClaims:0,newReportsPrivate:true};
  const restored={schema:'vivo.memory-backup-restore/1',manifestDigest,status:'restored',added:1,duplicates:0,total:1,newReportsPrivate:true};
  const core={schema:'vivo.memory-backup-commit/1',manifestDigest,baseRevision,committedAt:123,addedMemoryIds:['council:'+reportSha256],added:1,duplicates:0,totalAtCommit:1,newReportsPrivateAtCommit:true};
  const receipt={...core,receiptSha256:await hash(JSON.stringify(core))};
  const committed={schema:'vivo.memory-backup-commit-status/1',manifestDigest,baseRevision,status:'committed',receipt};
  const calls=[];
  const serve=result=>async(url,init)=>{assert.equal(url,'http://vivo.test/api/neural-memory/backup-set');calls.push(JSON.parse(init.body));return {ok:true,json:async()=>({schema:'vivo.neural-memory/1',result})};};
  assert.deepEqual(await transport.reviewCompleteMemoryBackup(bundle,serve(review)),review);
  assert.deepEqual(await transport.restoreCompleteMemoryBackup(bundle,review,serve(restored)),restored);
  assert.deepEqual(await transport.reconcileCompleteMemoryRestore(review,serve(committed)),committed);
  assert.deepEqual(await transport.recentCompleteMemoryRestores(serve({schema:'vivo.memory-backup-commit-history/1',receipts:[receipt]})),[receipt]);
  assert.deepEqual(calls.map(c=>c.op),['preview','restore','receipt','recent']);
  assert.deepEqual(calls[1].args,{bundle,review:{manifestDigest,baseRevision}});
  await assert.rejects(transport.restoreCompleteMemoryBackup(bundle,{...review,manifestDigest:'c'.repeat(64)},serve(restored)),/MEMORY_BACKUP_REVIEW_REQUIRED/);
  await assert.rejects(transport.reviewCompleteMemoryBackup({...bundle,capsules:[]},serve(review)),/MEMORY_BACKUP_SET_INVALID/);
  assert.equal(calls.length,4);
  transport.role='editor';
  await assert.rejects(transport.reviewCompleteMemoryBackup(bundle,serve(review)),/MEMORY_OWNER_REQUIRED/);
  await assert.rejects(transport.restoreCompleteMemoryBackup(bundle,review,serve(restored)),/MEMORY_OWNER_REQUIRED/);
  assert.equal(calls.length,4);
  await shutdown(transport,socket);
});


test('custom mission proof checks ties, constraint coverage, and independent hashes before accepting',async()=>{
  const {transport,socket}=await admitted();
  const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  const mission={budget:2,jobs:[{id:'A',cost:2,value:3},{id:'B',cost:1,value:3}],required:[],conflicts:[]};
  const selection={mode:'fixture',providers:[],limit:4},request={mission,selection};
  const proposal={candidate:'B',cost:1,value:3,feasible:true};
  const proof={method:'exhaustive-bounded-subsets/1',subsetsChecked:4,feasibleSubsets:3,equallyValuableOptima:2,
    runnerUp:{candidate:'A',cost:2,value:3,feasible:true},optimalityGap:0,
    enumerationSha256:await hash(JSON.stringify([['',0,0,true],['A',2,3,true],['A,B',3,6,false],['B',1,3,true]])),
    ranking:'value-desc-cost-asc-id-asc',includesEmptyChoice:true};
  const core={schema:'vivo.agent-mission-plan/1',mission,missionSha256:await hash(JSON.stringify(mission)),selection,
    proposal,status:'optimal',proof,evidence:{status:'mission-not-in-memory-contract',receipt:null},
    authority:'evidence-only',providerAuthenticated:false,providerCallsInitiated:0,postedChargesUsd:null,worldActionExecuted:false};
  const sign=async value=>({...value,decisionSha256:await hash(JSON.stringify(value))});
  const packet=await sign(core);
  const calls=[];
  const fetchImpl=async(url,init)=>{
    assert.equal(url,'http://vivo.test/api/neural-memory');calls.push(JSON.parse(init.body));
    return {ok:true,json:async()=>({schema:'vivo.neural-memory/1',result:packet})};
  };
  assert.deepEqual(await transport.planAgentMission({mission:{...mission,jobs:[...mission.jobs].reverse()},selection},fetchImpl),packet);
  assert.deepEqual(calls,[{op:'plan',args:request}]);
  for(const invalid of [
    {...core,proposal:{candidate:'A',cost:2,value:3,feasible:true}},
    {...core,proof:{...proof,feasibleSubsets:4}},
    {...core,proof:{...proof,equallyValuableOptima:1}},
    {...core,proof:{...proof,enumerationSha256:'0'.repeat(64)}},
    {...core,evidence:{status:'exact-task-recall',receipt:{}}},
    {...core,providerCallsInitiated:1},
    {...core,worldActionExecuted:true},
    {...core,mission:{...mission,budget:3}},
  ])await assert.rejects(verifyAgentMissionPlan(await sign(invalid),request),/MEMORY_MISSION_INVALID/);
  assert.throws(()=>normalizeAgentMission({...mission,conflicts:[['A','B'],['B','A']]}),/MEMORY_MISSION_INVALID/);
  assert.throws(()=>normalizeAgentMission({...mission,jobs:[...mission.jobs,mission.jobs[0]]}),/MEMORY_MISSION_INVALID/);
  await shutdown(transport,socket);
});
