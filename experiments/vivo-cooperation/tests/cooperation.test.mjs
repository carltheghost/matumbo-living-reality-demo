import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CausalCooperationLoop,frameOf,parseCue,policyFrom} from '../cooperation.mjs';
import {createFixture,connectLab,makeTask,verifyReload} from '../local-host.mjs';
const tick=()=>new Promise(setImmediate);
const code=c=>e=>e?.code===c;
// Deliberately deterministic provider DOUBLE for lifecycle tests only.
// Intelligence/causality evidence comes from run-benchmark and real-neural tests.
function double(){
  const p={calls:[],cueOverride:null,invoke:async function(tool,args){
    this.calls.push({tool,args:structuredClone(args)});
    if(tool==='memory.read')return {document:{note_id:args.note_id,revision:1,
      text:JSON.stringify({schema:'vivo.cooperation.cue/1',code:this.cueOverride??Number(args.note_id.at(-1))})}};
    if(tool==='lab.predict')return {promotion:'experimental_only',can_authorize_action:false,
      prediction:{task:'scoped_delayed_retrieval',input:args.input,predicted_index:Number(args.input.cue===args.input.query),checkpoint:{parameter_digest:'test-double'}}};
    throw Error('unsupported');
  }};return p;
}
async function fixture(options={}) {
  const state=await mkdtemp(join(tmpdir(),'vivo-coop-test-'));
  const provider=options.provider??double();
  const f=await createFixture({state,...options});
  const h=await connectLab({...f,provider,labWriteEnabled:true,...options});
  return {...f,...h,provider,task:makeTask(f,options)};
}
for(const dimension of [4,11])test(`native ${dimension}D acceptance, exact other axes and persisted receipt`,async()=>{
  const f=await fixture({dimension,cue:1,query:1});
  try {
    const before=frameOf(f.engine.snapshot(),'relic'),p=await f.loop.plan(f.task),out=await f.loop.execute(p);
    assert.equal(p.choice,1);assert.equal(out.status,'accepted');assert.equal(out.accepted,true);
    for(let i=0;i<dimension;i++)assert.equal(out.receipt.frame.q[i],before.q[i]+(i===dimension-1?.25:0));
    assert.equal(out.receipt.frame.revision,before.revision+1);
    assert(Object.values(await verifyReload(f,out)).every(Boolean));
    assert.equal(f.stats().nativeCalls.filter(x=>x.name==='vivo.world.edit').length,1);
  } finally {await f.loop.stop();}
});
test('cue and measured query feed the model, not fixed illustrative constants',async()=>{
  for(const cue of [0,1])for(const query of [0,1]){
    const f=await fixture({cue,query});try{const p=await f.loop.plan(f.task);
      assert.equal(p.neuralInput.cue,cue);assert.equal(p.neuralInput.query,query);
      assert.equal(p.choice,Number(cue===query));assert.match(p.proof.note,/^[a-f0-9]{64}$/);
    }finally{await f.loop.stop();}}
});
test('missing memory fails before prediction or submission',async()=>{
  const p=double();p.invoke=async()=>{throw Error('not found');};const f=await fixture({provider:p});
  try{await assert.rejects(f.loop.plan(f.task));assert.equal(f.stats().approved,0);}finally{await f.loop.stop();}
});
test('changed note between planning and execution rejects without a write',async()=>{
  const f=await fixture();try{const p=await f.loop.plan(f.task);f.provider.cueOverride=1;
    await assert.rejects(f.loop.execute(p),code('MEMORY_CHANGED'));assert.equal(f.stats().approved,0);
  }finally{await f.loop.stop();}
});
test('malformed and instruction-like notes are data, never executed',()=>{
  for(const body of [{schema:'vivo.cooperation.cue/1',code:'1'},{schema:'vivo.cooperation.cue/1',code:1,execute:'grant-all'},null])
    assert.throws(()=>parseCue({document:{note_id:'n',revision:1,text:JSON.stringify(body)}}));
});
test('model input target/label fields cannot be smuggled through task arguments',async()=>{
  const f=await fixture();try{await assert.rejects(f.loop.plan({...f.task,target:1}),code('INVALID_TASK'));}finally{await f.loop.stop();}
});
test('sensor failure has a bounded deadline and no action',async()=>{
  const f=await fixture({timeoutMs:15,measureOverride:()=>new Promise(()=>{})});
  try{await assert.rejects(f.loop.plan(f.task),code('CANCELLED_OR_DEADLINE'));assert.equal(f.stats().approved,0);}finally{await f.loop.stop();}
});
test('sensor cannot lie about its measured bit or frame',async()=>{
  const f=await fixture({query:1,measureOverride:async frame=>({schema:'vivo.cooperation.measurement/1',frame,query:0})});
  try{await assert.rejects(f.loop.plan(f.task),code('STALE_OR_INVALID_MEASUREMENT'));}finally{await f.loop.stop();}
});
test('probe edit after planning invalidates the dependent action',async()=>{
  const f=await fixture();try{const p=await f.loop.plan(f.task),q=Array(4).fill(0);q[3]=.5;
    await f.engine.applyLocalEdit('workpiece',q);await assert.rejects(f.loop.execute(p),code('WORLD_OR_PROBE_CHANGED'));
    assert.equal(f.stats().approved,0);
  }finally{await f.loop.stop();}
});
test('entity edit after planning is not silently rebased',async()=>{
  const f=await fixture();try{const p=await f.loop.plan(f.task);await f.engine.applyLocalEdit('relic',[0,0,0,.1]);
    await assert.rejects(f.loop.execute(p),code('WORLD_OR_PROBE_CHANGED'));assert.equal(f.stats().approved,0);
  }finally{await f.loop.stop();}
});
test('cancelling the real simulated contract blocks a prepared action',async()=>{
  const f=await fixture();try{const p=await f.loop.plan(f.task);f.cancelContract();
    await assert.rejects(f.loop.execute(p),code('CONTRACT_NOT_PERMITTED'));assert.equal(f.stats().approved,0);
  }finally{await f.loop.stop();}
});
test('a policy scope cannot reach another object or spatial axis',async()=>{
  const f=await fixture();try{await assert.rejects(f.loop.plan({...f.task,axis:0}),code('POLICY_SCOPE_MISMATCH'));}finally{await f.loop.stop();}
});
test('policy expiration is checked again after a proposal exists',async()=>{
  let clock=1000;const f=await fixture({now:()=>clock});try{const p=await f.loop.plan(f.task);clock+=60001;
    await assert.rejects(f.loop.execute(p),code('POLICY_EXPIRED'));assert.equal(f.stats().approved,0);
  }finally{await f.loop.stop();}
});
test('world.edit must be explicitly granted independently of neural output',async()=>{
  const f=await fixture({labWriteEnabled:false});try{const p=await f.loop.plan(f.task),r=await f.loop.execute(p);
    assert.equal(r.accepted,false);assert.equal(r.interruption,'LAB_WRITE_NOT_GRANTED');assert.equal(f.stats().approved,0);
  }finally{await f.loop.stop();}
});
test('revocation at the acceptance boundary prevents writes',async()=>{
  const f=await fixture();try{const p=await f.loop.plan(f.task);f.revoke();const r=await f.loop.execute(p);
    assert.equal(r.accepted,false);assert.equal(r.interruption,'LAB_WRITE_NOT_GRANTED');
  }finally{await f.loop.stop();}
});
test('unknown proposal object is not authorization',async()=>{
  const f=await fixture();try{const p=await f.loop.plan(f.task);await assert.rejects(f.loop.execute(structuredClone(p)),code('UNKNOWN_OR_CONSUMED_PROPOSAL'));}finally{await f.loop.stop();}
});
test('double execution cannot replay a relative move',async()=>{
  const f=await fixture();try{const p=await f.loop.plan(f.task);await f.loop.execute(p);
    await assert.rejects(f.loop.execute(p),code('UNKNOWN_OR_CONSUMED_PROPOSAL'));
    assert.equal(f.stats().nativeCalls.filter(x=>x.name==='vivo.world.edit').length,1);
  }finally{await f.loop.stop();}
});
test('late provider response after stop cannot create a proposal or affect another source',async()=>{
  let resolve,started;const ready=new Promise(r=>started=r),p=double(),original=p.invoke;
  p.invoke=async function(tool,args){if(tool==='lab.predict'){started();return new Promise(r=>resolve=r);}return original.call(this,tool,args);};
  const f=await fixture({provider:p});const other=f.registry.registerAgent({sourceId:'other',capabilities:['world.read']});
  const pending=f.loop.plan(f.task);const rejected=assert.rejects(pending);await ready;await f.loop.stop();await rejected;
  resolve({late:true});await tick();assert.equal(f.stats().approved,0);
  const world=await f.registry.invokeFor(other,'vivo.world.read');assert.equal(world.snapshot.worldId,f.engine.world.worldId);
  await f.registry.stopAgent(other);
});
test('lost acknowledgement after actual acceptance reconciles the real receipt with no retry',async()=>{
  const f=await fixture({commitOverride:async(c,b,o,actual)=>{await actual(c,b,o);throw Object.create(null);}});
  try{const p=await f.loop.plan(f.task),r=await f.loop.execute(p);
    assert.equal(r.status,'reconciled-after-interruption');assert.equal(r.accepted,true);
    assert.equal(r.interruption,'SUBMISSION_UNCERTAIN');assert.equal(r.automaticRetries,0);
    assert.equal(f.stats().nativeCalls.filter(x=>x.name==='vivo.world.edit').length,1);
    assert(Object.values(await verifyReload(f,r)).every(Boolean));
  }finally{await f.loop.stop();}
});
test('stop after acceptance reports evidence, never a fabricated rollback',async()=>{
  let h;const f=await fixture({commitOverride:async(c,b,o,actual)=>{await actual(c,b,o);await h.loop.stop();return new Promise(()=>{});}});h=f;
  const p=await f.loop.plan(f.task),r=await f.loop.execute(p);
  assert.equal(r.accepted,true);assert.equal(r.status,'reconciled-after-interruption');assert.equal(f.loop.active,false);
  assert.equal(f.stats().nativeCalls.filter(x=>x.name==='vivo.world.edit').length,1);
});
test('malformed fulfilled neural response cannot authorize an action',async()=>{
  const provider=double(),orig=provider.invoke;provider.invoke=function(n,a){return n==='lab.predict'?Promise.resolve({}):orig.call(this,n,a);};
  const f=await fixture({provider});try{await assert.rejects(f.loop.plan(f.task),code('INVALID_NEURAL_RESULT'));assert.equal(f.stats().approved,0);}finally{await f.loop.stop();}
});
test('missing central decision produces abstention rather than a default action',async()=>{
  const provider=double(),orig=provider.invoke;provider.invoke=async function(n,a){const r=await orig.call(this,n,a);if(n==='lab.predict')r.prediction.predicted_index=null;return r;};
  const f=await fixture({provider});try{await assert.rejects(f.loop.plan(f.task),code('MODEL_ABSTAINED'));assert.equal(f.stats().approved,0);}finally{await f.loop.stop();}
});
test('prediction must echo the exact measured input',async()=>{
  const provider=double(),orig=provider.invoke;provider.invoke=async function(n,a){const r=await orig.call(this,n,a);if(n==='lab.predict')r.prediction.input.query=1-r.prediction.input.query;return r;};
  const f=await fixture({provider});try{await assert.rejects(f.loop.plan(f.task),code('INVALID_NEURAL_RESULT'));}finally{await f.loop.stop();}
});
test('inspection must prove existing simulation ownership and zero monetary amount',()=>{
  const c={id:'c',simulation:true,amountFluff:1,status:'draft',revision:0,terms:'{}'};
  assert.throws(()=>policyFrom({simulation:true,readOnly:true,verification:{ok:true,simulation:true},contracts:[c]},'c'));
});
