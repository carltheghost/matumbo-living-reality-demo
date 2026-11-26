import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteTransport,verifyAgentReasoningReceipt} from '../../web/application/remote-transport.mjs';

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
