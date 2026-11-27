import test from 'node:test';
import assert from 'node:assert/strict';
import {VivoConvergenceAdapter} from '../convergence-adapter.mjs';
import {LocalAgentController} from '../agent-control.mjs';
import {AgentToolRegistry} from '../agent-tools.mjs';
import {LocalVivoEngine} from '../engine.mjs';
import {createSimulatedEconomy} from '../vendor/economy/src/domains/simulated-economy.js';

// Native economy is one canonical owner per process, not a throwaway owner per fixture.
let economyOwner;
async function fixture({transport=null,timeoutMs=200}={}) {
  const engine=new LocalVivoEngine();await engine.open('convergence-test');
  const controller=new LocalAgentController({snapshot:()=>engine.snapshot()});
  const registry=new AgentToolRegistry({agentController:controller,bridge:{invokeLocal:(n,a,c)=>controller.invokeTool(c.session,n,a)}});
  await registry.setLocalCapabilities(['world.read']);
  const native=registry.registerAgent({sourceId:'reviewer',capabilities:['world.read']});
  const economy=economyOwner ??= createSimulatedEconomy({storage:null});
  const adapter=new VivoConvergenceAdapter({registry,economy,transport,timeoutMs});
  return {engine,controller,registry,native,economy,adapter};
}

test('existing native registry and world are reused, not copied into a second authority',async()=>{
  const f=await fixture();const ref=f.adapter.attach(f.native);
  assert.deepEqual(f.adapter.list(ref),['vivo.world.read']);
  const result=await f.adapter.invoke(ref,'vivo.world.read');assert.equal(result.snapshot.worldId,f.engine.world.worldId);
});
test('contract inspection uses existing owner and verifies its real receipt chain',async()=>{
  const f=await fixture();f.economy.createContract({title:'Integration test',amountFluff:0,idempotencyKey:crypto.randomUUID()});
  const before=f.economy.snapshot(),ref=f.adapter.attach(f.native,['contracts.read']);
  const result=await f.adapter.invoke(ref,'contracts.inspect');
  assert.equal(result.verification.ok,true);assert.equal(result.simulation,true);assert.equal(result.readOnly,true);
  assert.deepEqual(result.contracts,f.economy.contracts());assert.deepEqual(f.economy.snapshot(),before);
});
test('contract mutations and unknown capabilities are never advertised',async()=>{
  const f=await fixture();assert.throws(()=>f.adapter.attach(f.native,['contracts.execute']));
  const ref=f.adapter.attach(f.native,['contracts.read']);await assert.rejects(f.adapter.invoke(ref,'contracts.complete'));
});
test('disconnected neural and memory providers stay unavailable',async()=>{
  const f=await fixture();const ref=f.adapter.attach(f.native,['memory.read','neural.lab']);
  assert.deepEqual(f.adapter.list(ref),['vivo.world.read']);await assert.rejects(f.adapter.invoke(ref,'neural.predict',{}));
});
test('host-granted transport tool is called once and native grants stay unchanged',async()=>{
  let calls=0;const f=await fixture({transport:{invoke:async(name,args)=>{calls++;return {name,args};}}});
  const ref=f.adapter.attach(f.native,['memory.read']);const result=await f.adapter.invoke(ref,'memory.search',{query:'contract'});
  assert.equal(result.name,'memory.search');assert.equal(calls,1);assert.deepEqual(f.controller.sessionCapabilities(f.native),['world.read']);
});
test('stopping a session fences a delayed provider response without retry',async()=>{
  let resolve,calls=0;const f=await fixture({transport:{invoke:()=>{calls++;return new Promise(r=>resolve=r);}}});
  const ref=f.adapter.attach(f.native,['memory.read']);const pending=f.adapter.invoke(ref,'memory.search',{query:'x'});
  await new Promise(setImmediate);const rejected=assert.rejects(pending);await f.adapter.stop(ref);await rejected;
  resolve({text:'late'});await new Promise(setImmediate);assert.equal(calls,1);assert.throws(()=>f.adapter.list(ref));
});
test('one stopped source does not stop the other native agent',async()=>{
  const f=await fixture();const native2=f.registry.registerAgent({sourceId:'other',capabilities:['world.read']});
  const a=f.adapter.attach(f.native),b=f.adapter.attach(native2);await f.adapter.stop(a);
  assert.equal((await f.adapter.invoke(b,'vivo.world.read')).snapshot.worldId,'convergence-test');
});
test('provider deadline settles once; no automatic retry',async()=>{
  let calls=0;const f=await fixture({timeoutMs:10,transport:{invoke:()=>{calls++;return new Promise(()=>{});}}});
  const ref=f.adapter.attach(f.native,['memory.read']);await assert.rejects(f.adapter.invoke(ref,'memory.search',{query:'x'}),/CANCELLED_OR_DEADLINE/);
  assert.equal(calls,1);
});
test('native grant revocation cannot be bypassed by the composed adapter',async()=>{
  const f=await fixture();const ref=f.adapter.attach(f.native,['contracts.read']);await f.registry.revokeAll();
  await assert.rejects(f.adapter.invoke(ref,'contracts.inspect'));
});
test('malformed contract arguments are rejected before owner inspection',async()=>{
  const f=await fixture();const ref=f.adapter.attach(f.native,['contracts.read']);const before=f.economy.snapshot();
  await assert.rejects(f.adapter.invoke(ref,'contracts.inspect',{execute:true}));assert.deepEqual(f.economy.snapshot(),before);
});
