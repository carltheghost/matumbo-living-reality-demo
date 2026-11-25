import test from 'node:test';
import assert from 'node:assert/strict';
import {VivoConvergenceAdapter} from '../convergence-adapter.mjs';

// Minimal controller/registry doubles: test only the adapter boundary, not a live world.
function fixture(transport) {
  const a = {sourceId:'agent-a', sessionId:'session-a', generation:1};
  const b = {sourceId:'agent-b', sessionId:'session-b', generation:1};
  const active = new Map([[a.sessionId,a],[b.sessionId,b]]);
  const stopped = [];
  const assertActive = ref => {
    const record = active.get(typeof ref === 'string' ? ref : ref.sessionId);
    if (!record || (typeof ref === 'object' && ref.generation !== record.generation)) throw Error('STALE_NATIVE_SESSION');
    return {...record};
  };
  const registry = {
    agentController:{assertActive},
    listFor:ref=>{assertActive(ref);return [{name:'vivo.world.read'}];},
    invokeFor:async ref=>assertActive(ref),
    stopAgent:async ref=>{const record=assertActive(ref);stopped.push(record.sourceId);active.delete(record.sessionId);},
  };
  return {a:{...a},b:{...b},adapter:new VivoConvergenceAdapter({registry,transport,timeoutMs:500}),active,stopped};
}
const extras=['memory.read','neural.lab'];
const settle=()=>new Promise(setImmediate);

test('missing or broken host availability declarations advertise no extra tools',async()=>{
  for(const transport of [{}, {invoke(){}}, {supports:()=>true}, {invoke(){},supports(){throw Error('offline');}}, {invoke(){},supports:()=>1}]){
    const {a,adapter}=fixture(transport),ref=adapter.attach(a,extras);
    assert.deepEqual(adapter.list(ref),['vivo.world.read']);
    await assert.rejects(adapter.invoke(ref,'memory.search',{}),{code:'TOOL_NOT_GRANTED'});
  }
});
test('a partially connected host exposes only the explicitly supported, granted tool',async()=>{
  const {a,adapter}=fixture({supports:name=>name==='memory.search',invoke:async()=>({matches:[]})});
  const ref=adapter.attach(a,extras),noGrant=adapter.attach(a,[]);
  assert.deepEqual(adapter.list(ref),['vivo.world.read','memory.search']);
  assert.deepEqual(adapter.list(noGrant),['vivo.world.read']);
  await assert.rejects(adapter.invoke(ref,'memory.read',{}),{code:'TOOL_NOT_GRANTED'});
  assert.deepEqual(await adapter.invoke(ref,'memory.search',{query:'test'}),{matches:[]});
});
test('transport receives the controller-issued identity, not model-supplied identity',async()=>{
  let seen;const {a,b,adapter}=fixture({supports:(name,agent)=>name==='memory.search'&&agent.sourceId==='agent-a',invoke:async(_name,args,{agent})=>{seen=agent;return {input:args};}});
  const first=adapter.attach(a,extras),second=adapter.attach(b,extras);
  assert.deepEqual(adapter.list(second),['vivo.world.read']);
  await adapter.invoke(first,'memory.search',{sourceId:'agent-b',sessionId:'session-b'});
  assert.deepEqual(seen,{sourceId:'agent-a',sessionId:'session-a',generation:1});assert.ok(Object.isFrozen(seen));
});
test('caller mutation cannot retarget a previously attached native session or stop another agent',async()=>{
  const {a,b,adapter,stopped}=fixture(null),ref=adapter.attach(a),other=adapter.attach(b);
  Object.assign(a,b);
  assert.equal((await adapter.invoke(ref,'vivo.world.read')).sourceId,'agent-a');
  await adapter.stop(ref);assert.deepEqual(stopped,['agent-a']);
  assert.equal((await adapter.invoke(other,'vivo.world.read')).sourceId,'agent-b');
});
test('host access revoked before dispatch prevents a transport call',async()=>{
  let allowed=true,calls=0;
  const {a,adapter}=fixture({supports:()=>allowed,invoke:async()=>{calls++;return {};}}),ref=adapter.attach(a,extras);
  const pending=adapter.invoke(ref,'memory.search',{});allowed=false;
  await assert.rejects(pending,{code:'TOOL_NOT_GRANTED'});assert.equal(calls,0);
});
test('host access revoked during flight fences the result without replay',async()=>{
  let allowed=true,calls=0,finish;
  const {a,adapter}=fixture({supports:()=>allowed,invoke:()=>{calls++;return new Promise(resolve=>finish=resolve);}}),ref=adapter.attach(a,extras);
  const pending=adapter.invoke(ref,'memory.search',{});await settle();allowed=false;finish({matches:['late']});
  await assert.rejects(pending,{code:'TOOL_NOT_GRANTED'});assert.equal(calls,1);
});
test('native session invalidation before dispatch prevents any transport invocation',async()=>{
  let calls=0;const {a,adapter,active}=fixture({supports:()=>true,invoke:async()=>{calls++;return {};}}),ref=adapter.attach(a,extras);
  const pending=adapter.invoke(ref,'memory.search',{});active.delete(a.sessionId);
  await assert.rejects(pending,/STALE_NATIVE_SESSION/);assert.equal(calls,0);
});
test('a stopped or regenerated native session does not receive a late result',async()=>{
  let finish;const {a,adapter,active}=fixture({supports:()=>true,invoke:()=>new Promise(resolve=>finish=resolve)}),ref=adapter.attach(a,extras);
  const pending=adapter.invoke(ref,'memory.search',{});await settle();active.set(a.sessionId,{...a,generation:2});finish({matches:['old']});
  await assert.rejects(pending,/STALE_NATIVE_SESSION/);
});
