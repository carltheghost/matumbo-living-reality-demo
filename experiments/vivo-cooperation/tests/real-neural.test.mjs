import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PythonProvider,createFixture,connectLab,makeTask,verifyReload} from '../local-host.mjs';
let provider,state;
before(async()=>{
  assert.ok(process.env.VIVO_RECOVERED_BUNDLE,'VIVO_RECOVERED_BUNDLE is required; missing real model is a failure, not a skip.');
  state=await mkdtemp(join(tmpdir(),'vivo-coop-neural-'));
  provider=new PythonProvider({bundle:process.env.VIVO_RECOVERED_BUNDLE,state:join(state,'provider')});
});
after(async()=>{if(provider){const exit=await provider.close();assert.equal(exit.code,0,provider.stderr);}});
test('instrumented intact path exactly matches original loader logits across all four cue/query pairs',async()=>{
  for(const cue of [0,1])for(const query of [0,1]) {
    const p=await provider.invoke('lab.parity',{cue,query,delay_steps:2,distractor:.4});assert.equal(p.equal,true);
  }
});
test('native exact-memory database returns distinct persisted fixture documents',async()=>{
  const zero=await provider.invoke('memory.read',{note_id:'lab:cue:0'}),one=await provider.invoke('memory.read',{note_id:'lab:cue:1'});
  assert.equal(JSON.parse(zero.document.text).code,0);assert.equal(JSON.parse(one.document.text).code,1);
  assert.notEqual(zero.sha256,one.sha256);assert.equal(zero.document.revision,1);
});
test('real checkpoint decisions change under either input intervention',async()=>{
  const predict=(cue,query)=>provider.invoke('lab.predict',{input:{cue,query,delay_steps:5,distractor:-.4},mode:'intact'});
  const a=await predict(0,0),b=await predict(1,0),c=await predict(0,1);
  assert.equal(a.prediction.predicted_index,1);assert.equal(b.prediction.predicted_index,0);assert.equal(c.prediction.predicted_index,0);
  assert.equal(a.can_authorize_action,false);assert.equal(a.checkpoint_gate,'rejected');
});
test('ablations keep the same parameter identity and transition budget',async()=>{
  const input={cue:0,query:1,delay_steps:2,distractor:.4};let baseline;
  for(const mode of ['intact','no_lateral','no_memory','no_branch0','no_branch1','no_branch2','no_branch3','silence_decision']){
    const r=await provider.invoke('lab.predict',{input,mode});baseline??=r;
    assert.equal(r.parameter_digest,baseline.parameter_digest);assert.equal(r.scalar_parameters,3678);
    assert.equal(r.steps,4);assert.equal(r.training_performed,false);
    if(mode==='no_lateral')assert.equal(r.communication_edge_0_to_1,0);
    if(mode==='silence_decision')assert.equal(r.prediction.predicted_index,null);
  }
});
for(const dimension of [4,11])test(`real neural decision reaches native ${dimension}D receipt and disk reload`,async()=>{
  const f=await createFixture({state:join(state,'worlds'),dimension,query:1});
  const h=await connectLab({...f,provider,labWriteEnabled:true,timeoutMs:10000});
  try{const proposal=await h.loop.plan(makeTask(f,{cue:1,delaySteps:5,distractor:.4}));
    assert.equal(proposal.choice,1);const outcome=await h.loop.execute(proposal);
    assert.equal(outcome.accepted,true);assert.equal(outcome.neural.scalar_parameters,3678);
    assert(Object.values(await verifyReload(f,outcome)).every(Boolean));
  }finally{await h.loop.stop();}
});
test('label-bearing and unknown neural commands are rejected without fallback',async()=>{
  await assert.rejects(provider.invoke('lab.predict',{input:{cue:0,query:0,delay_steps:2,distractor:0,target:1},mode:'intact'}));
  await assert.rejects(provider.invoke('neural.train',{}));
  await assert.rejects(provider.invoke('lab.predict',{input:{cue:0,query:0,delay_steps:2,distractor:0},mode:'invented'}));
});
test('inactive branches are reported as inactive, not evidence of five-way cooperation',async()=>{
  const input={cue:1,query:0,delay_steps:2,distractor:0};
  const normal=await provider.invoke('lab.predict',{input,mode:'intact'});
  for(const mode of ['no_branch2','no_branch3']){
    const cut=await provider.invoke('lab.predict',{input,mode});assert.deepEqual(cut.prediction.logits,normal.prediction.logits);
  }
});
