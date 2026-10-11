/** Regression coverage for accepted density freshness and lifecycle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../web/application/bootstrap.mjs',import.meta.url),'utf8');
const receiveSource=source.slice(source.indexOf('function receive(next){'),source.indexOf('function configureAxes(){'));
const densityFunctions=source.slice(source.indexOf('function densityKey(){'),source.indexOf('async function connect(){'));
const observation=(overrides={})=>({entityId:'relic',axes:[0,1],shape:[8,8],density:Array.from({length:8},()=>Array(8).fill(1)),fixed:{2:4,3:4},spaceId:'root',worldDimension:4,acceptedFieldDigest:'field',materialDigest:'field',acceptedSequence:0,acceptedStateHash:'state-0',...overrides});
function harness(){
  const timers=[],drawn=[],panels=[],calls=[];
  const client={closed:false,observeMaterial:async(id,axes)=>{calls.push([id,axes]);return observation();}};
  const context=vm.createContext({
    state:{capabilities:{material:{profile:'phase'}},eye:{spaceId:'root',dimension:4,q:[0,0,0,0],basis:[],chart:'flat',eyeId:'main',actorId:'local.one',slice:{}},snapshot:{acceptedSequence:0,stateHash:'state-0',spaces:{root:{field:{hash:'field'},entities:{relic:{id:'relic'}}}}}},
    selected:'relic',connectionGeneration:1,transport:client,densityCache:new Map(),densityRequest:0,densityPoll:null,
    densityOverlay:{observation:null,clear(){this.observation=null;},setObservation(value){this.observation=value;drawn.push(value);return true;}},
    updateDensityPanel:value=>panels.push(value),setTimeout:callback=>{timers.push(callback);return timers.length;},
    grids:new Map([[4,{}]]),gridFor:async()=>({}),renderer:{},projectAccepted:()=>({geometry:{}}),embed:()=>[0,0,0],viewAngles:()=>({yaw:0,pitch:0}),orbit:true,configureAxes:()=>{},updateUI:()=>{},say:()=>{},sessionOnly:false,readOnlySeen:false,cancelAll:async()=>{},
  });
  vm.runInContext(receiveSource,context);
  vm.runInContext(densityFunctions,context);
  return {context,timers,drawn,panels,calls,client};
}

test('density freshness key includes resolved hidden Eye indices and accepted snapshot identity',()=>{
  const {context}=harness();
  const initial=context.densityKey();
  context.state.eye.q[2]=1;
  const moved=context.densityKey();
  assert.notEqual(initial,moved);
  context.state.snapshot.acceptedSequence=1;context.state.snapshot.stateHash='state-1';
  assert.notEqual(moved,context.densityKey());
});

test('periodic hidden coordinates use the shared ties-to-even index rule',()=>{
  const {context}=harness();
  for(const [value,expected] of [[.5,4],[2.5,6],[-5,7],[-.5,4],[-1.5,2],[-2.5,2],[-3.5,0],[-4.5,0],[-3.4999999999999996,1],[-2.5000000000000004,1]])
    assert.equal(context.phaseSliceIndex(value),expected,`x=${value}`);
});

test('density polling continues through nested space and resumes on root return',async()=>{
  const {context,timers,calls}=harness();
  await context.refreshDensity(1,context.transport);
  assert.equal(timers.length,1);
  context.state.eye.spaceId='inner';context.state.eye.dimension=11;
  await timers.shift()();
  assert.equal(timers.length,1);
  context.state.eye.spaceId='root';context.state.eye.dimension=4;
  await timers.shift()();
  assert.equal(timers.length,1);
  assert.equal(calls.length,1);
});

test('a density response from an older accepted Eye is discarded',async()=>{
  const {context,drawn,client}=harness();
  let resolve;
  client.observeMaterial=()=>new Promise(done=>{resolve=done;});
  const pending=context.refreshDensity(1,client);
  context.state.eye.q[2]=1;context.state.snapshot.acceptedSequence=1;context.state.snapshot.stateHash='state-1';
  resolve(observation());
  await pending;
  assert.equal(drawn.length,0);
});

test('a hidden-coordinate change clears the old density until a matching slice arrives',async()=>{
  const {context,drawn,panels}=harness();
  await context.refreshDensity(1,context.transport);
  assert.equal(drawn.length,1);
  context.state.eye.q[2]=1;
  await context.refreshDensity(1,context.transport);
  assert.equal(context.densityOverlay.observation,null);
  assert.equal(panels.at(-1),null);
  assert.equal(drawn.length,1);
});

test('receive(next) clears stale density at the accepted state boundary',()=>{
  const {context,panels}=harness();
  context.densityOverlay.observation=observation();
  const next=structuredClone(context.state);
  next.eye.q[2]=1;
  context.receive(next);
  assert.equal(context.densityOverlay.observation,null);
  assert.equal(panels.at(-1),null);
});
