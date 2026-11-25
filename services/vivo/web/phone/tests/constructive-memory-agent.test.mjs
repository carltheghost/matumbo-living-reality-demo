import test from 'node:test';
import assert from 'node:assert/strict';
import {ConstructiveMemory,exampleMemory} from '../constructive-memory.mjs';
import {createConstructiveMemoryAgentBridge} from '../constructive-memory-agent.mjs';

// Actual memory circuit and convergence adapter; controlled native registry/controller boundary.
const scope={worldId:'world',projectId:'main'};
function fixture(){
  let selected={...scope};
  const a={sourceId:'muse',sessionId:'a',generation:1},b={sourceId:'codex',sessionId:'b',generation:1};
  const sessions=new Map([[a.sessionId,a],[b.sessionId,b]]);
  const assertActive=ref=>{
    const record=sessions.get(typeof ref==='string'?ref:ref?.sessionId);
    if(!record||(typeof ref==='object'&&ref.generation!==record.generation))throw Error('STALE_NATIVE_SESSION');
    return {...record};
  };
  const registry={agentController:{assertActive},listFor:ref=>{assertActive(ref);return [{name:'vivo.world.read'}];},invokeFor:async(ref,name,args)=>({source:assertActive(ref).sourceId,name,args}),stopAgent:async()=>{throw Error('Memory revocation must never stop the native agent');}};
  const bridge=createConstructiveMemoryAgentBridge({registry,getScope:()=>selected});
  const memory=exampleMemory(scope);
  return {a:{...a},b:{...b},sessions,bridge,memory,select:value=>{selected=value;}};
}
const args={start:17,path:[0,1,2,3]};
const names=(f,agent)=>f.bridge.tools.listFor(agent).map(x=>x.name);
const recall=(f,agent,request=args)=>f.bridge.tools.invokeFor(agent,'neural.predict',request);
const denied=p=>assert.rejects(p,{code:'TOOL_NOT_GRANTED'});

test('publishing does not auto-grant and unmounted memory cannot be granted',async()=>{
  const f=fixture();assert.throws(()=>f.bridge.admin.grant(f.a),{code:'MEMORY_NOT_MOUNTED'});
  f.bridge.admin.publish(f.memory);assert.deepEqual(names(f,f.a),['vivo.world.read']);await denied(recall(f,f.a));
});
test('explicit session grant connects actual four-bank recall to native agent tools without changing weights',async()=>{
  const f=fixture(),before=f.memory.checkpoint();f.bridge.admin.publish(f.memory);f.bridge.admin.grant(f.a);
  assert.deepEqual(names(f,f.a),['vivo.world.read','neural.predict']);assert.deepEqual(names(f,f.b),['vivo.world.read']);
  const r=await recall(f,f.a);assert.equal(r.value,7);assert.deepEqual(r.trace.map(x=>x.recordId),['cue','tool','constraint','result']);
  assert.deepEqual(r.scope,scope);assert.equal(r.revision,0);assert.equal(r.readOnly,true);assert.equal(r.authorizesAction,false);
  assert.deepEqual(f.memory.checkpoint(),before);await denied(recall(f,f.b));
});
test('missing address returns abstention with no invented value',async()=>{
  const f=fixture();f.bridge.admin.publish(f.memory);f.bridge.admin.grant(f.a);
  const r=await recall(f,f.a,{start:999,path:[0]});assert.equal(r.status,'abstain');assert.equal(r.reason,'NO_MATCH');assert.ok(!Object.hasOwn(r,'value'));assert.equal(r.authorizesAction,false);
});
test('model arguments cannot supply scope, checkpoint, identity or permissions',async()=>{
  const f=fixture();f.bridge.admin.publish(f.memory);f.bridge.admin.grant(f.a);
  for(const extra of [{scope:{worldId:'other',projectId:'main'}},{agent:f.b},{checkpoint:f.memory.checkpoint()},{grant:true}])await assert.rejects(recall(f,f.a,{...args,...extra}),{code:'INVALID_ARGUMENTS'});
  for(const bad of [{start:-1,path:[0]},{start:17,path:[4]},{start:17,path:Array(33).fill(0)}])await assert.rejects(recall(f,f.a,bad));
});
test('scope change invalidates mounted memory and grants, even after returning to the original world',async()=>{
  const f=fixture();f.bridge.admin.publish(f.memory);f.bridge.admin.grant(f.a);
  f.select({...scope,projectId:'different'});assert.equal(f.bridge.syncScope(),false);f.select(scope);
  assert.equal(f.bridge.admin.status().mounted,false);await denied(recall(f,f.a));
  assert.throws(()=>f.bridge.admin.publish(exampleMemory({worldId:'other',projectId:'main'})),{code:'SCOPE_MISMATCH'});
});
test('restoring a checkpoint requires a new grant, and exact record/weight checks remain active',async()=>{
  const f=fixture();f.bridge.admin.publish(f.memory);f.bridge.admin.grant(f.a);
  const p=f.memory.checkpoint();p.banks[0].values[0][0]*=-1;assert.throws(()=>ConstructiveMemory.restore(p),/WEIGHT_RECORD_MISMATCH/);
  const restored=ConstructiveMemory.restore(f.memory.checkpoint());f.bridge.admin.publish(restored);await denied(recall(f,f.a));
  f.bridge.admin.grant(f.a);assert.equal((await recall(f,f.a)).value,7);
});
test('one-agent revocation cancels only that attachment and preserves native and other agent tools',async()=>{
  const f=fixture();f.bridge.admin.publish(f.memory);f.bridge.admin.grant(f.a);f.bridge.admin.grant(f.b);
  const pending=recall(f,f.a);f.bridge.admin.revoke(f.a);await assert.rejects(pending);await denied(recall(f,f.a));
  assert.equal((await recall(f,f.b)).value,7);assert.equal((await f.bridge.tools.invokeFor(f.a,'vivo.world.read')).source,'muse');
  f.bridge.admin.revokeAll();await denied(recall(f,f.b));assert.equal(f.bridge.admin.status().mounted,true);
});
test('new native session generation never inherits a prior grant',async()=>{
  const f=fixture();f.bridge.admin.publish(f.memory);f.bridge.admin.grant(f.a);
  f.sessions.set('a',{...f.a,generation:2});const next={...f.a,generation:2};
  assert.deepEqual(names(f,next),['vivo.world.read']);await denied(recall(f,next));assert.equal(f.bridge.admin.status().granted.length,0);
  f.bridge.admin.grant(next);assert.equal((await recall(f,next)).value,7);
});
test('disposing the host or losing world scope fences pending recall and clears grants',async()=>{
  const f=fixture();f.bridge.admin.publish(f.memory);f.bridge.admin.grant(f.a);
  const pending=recall(f,f.a);f.select(null);f.bridge.syncScope();await assert.rejects(pending);assert.equal(f.bridge.admin.status().mounted,false);
  f.select(scope);f.bridge.admin.publish(f.memory);f.bridge.admin.grant(f.a);f.bridge.admin.clear();await denied(recall(f,f.a));
});
test('native operations still use the original registry, not memory results as authority',async()=>{
  const f=fixture();f.bridge.admin.publish(f.memory);f.bridge.admin.grant(f.a);
  assert.deepEqual(await f.bridge.tools.invokeFor(f.a,'vivo.world.read',{example:true}),{source:'muse',name:'vivo.world.read',args:{example:true}});
  assert.ok(!names(f,f.a).includes('memory.search'));assert.ok(!names(f,f.a).includes('memory.read'));
});
