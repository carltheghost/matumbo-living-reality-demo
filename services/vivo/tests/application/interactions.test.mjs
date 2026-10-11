import test from 'node:test';
import assert from 'node:assert/strict';
import {ApplicationInputs} from '../../web/application/interactions.mjs';
import {LocalLeaseWorld,MemoryAuthorityStore} from '../../web/authority/lease-authority.mjs';
import {GripHost} from '../../web/authority/grip-host.mjs';
import {workshopSeed} from '../../server/application/seed.mjs';
import {requestJSON} from '../../web/application/transport.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
async function setup(){const world=await LocalLeaseWorld.create({snapshot:workshopSeed(),store:new MemoryAuthorityStore(),leaseMs:150});
 const authority=world.attach({actorId:'local.one'});await authority.open();const host=await GripHost.open(authority,{requestTimeoutMs:30,cleanupTimeoutMs:40});let epoch=0;
 const inputs=new ApplicationInputs({host,nextEpoch:async()=>++epoch,project:(e,a,p)=>({...e,q:[p[0],p[1],...e.q.slice(2)]})});
 const begin=()=>inputs.begin('pointer.1',{entity:authority.getSnapshot().spaces.root.entities.relic,source:'touch',point:[0,0],observedAt:performance.now()});
 return{world,authority,host,inputs,begin};}

test('mounted final conversion throw always cancels renewing lease and retains original error',async()=>{
 const{authority,host,inputs,begin}=await setup();try{await begin();inputs.project=()=>{throw Error('edge-on');};await assert.rejects(inputs.end('pointer.1',{point:[2,3],observedAt:performance.now()}),/edge-on/);
 assert.equal(authority.inspectLease('root','relic'),null);assert.equal(host.state('pointer.1').pendingRenewal,false);assert.equal(host.state('pointer.1').cleanupConfirmed,true);assert.deepEqual(inputs.uncertainKeys(),[]);
 }finally{await inputs.close();await authority.close();}
});
test('uncertain pointer key remains reconcilable after both release and cleanup fail',async()=>{
 const{authority,host,inputs,begin}=await setup();const submit=authority.submit;
 // A real host wraps the authority, so use a separately opened fixture with faultable ports.
 await inputs.close();await authority.close();
 const world=await LocalLeaseWorld.create({snapshot:workshopSeed()}),base=world.attach({actorId:'local.one'});await base.open();let drop=true,epoch=0;
 const port={...base,submit:command=>command.kind==='grab.end'&&drop?Promise.reject(Error('release lost')):base.submit(command),reconcileLease:event=>drop?Promise.reject(Error('reconcile lost')):base.reconcileLease(event)};
 const h=await GripHost.open(port,{requestTimeoutMs:30,cleanupTimeoutMs:40}),i=new ApplicationInputs({host:h,nextEpoch:async()=>++epoch,project:e=>e});
 try{await i.begin('pointer.77',{entity:base.getSnapshot().spaces.root.entities.relic,source:'touch',point:[0,0],observedAt:performance.now()});
 await assert.rejects(i.cancel('pointer.77','lost-capture'));assert.deepEqual(i.keys(),[]);assert.deepEqual(i.uncertainKeys(),['pointer.77']);
 await assert.rejects(i.reconcileAll(),/UNCONFIRMED/);assert.deepEqual(i.uncertainKeys(),['pointer.77']);drop=false;await i.reconcileAll();assert.equal(base.inspectLease('root','relic'),null);assert.deepEqual(i.uncertainKeys(),[]);
 }finally{drop=false;await i.close();await base.close();}
});
test('cancel before delayed epoch resolves is immediate and cannot acquire later',async()=>{
 const gate=deferred(),calls=[];const host={state:()=>null,begin:async()=>calls.push('begin'),close:async()=>{},cancel:async()=>{}};
 const inputs=new ApplicationInputs({host,nextEpoch:()=>gate.promise,project:e=>e});
 const pending=inputs.begin('pointer.1',{entity:workshopSeed().spaces.root.entities.relic,source:'touch',point:[0,0],observedAt:10});
 await inputs.cancel('pointer.1','pointerup');assert.equal(inputs.get('pointer.1'),undefined);gate.resolve(1);await pending;assert.deepEqual(calls,[]);
});
test('final timestamp remains captured across acquisition delay and final frame offered only once',async()=>{
 const acquisition=deferred(),calls=[];let confirmed=false;
 const host={state:()=>({cleanupConfirmed:confirmed}),begin:()=>acquisition.promise,offer:(...args)=>calls.push(['offer',...args]),end:async(...args)=>{calls.push(['end',...args]);confirmed=true;},cancel:async()=>{confirmed=true;},close:async()=>{}};
 const inputs=new ApplicationInputs({host,nextEpoch:async()=>1,project:e=>({...e,q:[1,2,3,4]})});
 const pending=inputs.begin('pointer.1',{entity:workshopSeed().spaces.root.entities.relic,source:'touch',point:[0,0],observedAt:11});await Promise.resolve();
 const ending=inputs.end('pointer.1',{point:[1,2],observedAt:17});acquisition.resolve();await pending;await ending;
 assert.equal(calls.length,1);assert.equal(calls[0][0],'end');assert.equal(calls[0][3].observedAt,17);
});
test('connection-bound input cannot offer old gesture into replacement host',async()=>{
 const gate=deferred(),old=[],fresh=[];const oldHost={state:()=>null,begin:async()=>old.push('begin'),close:async()=>{},cancel:async()=>{}};
 const before=new ApplicationInputs({host:oldHost,nextEpoch:()=>gate.promise,project:e=>e});const pending=before.begin('hand',{entity:workshopSeed().spaces.root.entities.relic,source:'hand',point:[0,0],observedAt:1});await before.close();
 const after=new ApplicationInputs({host:{begin:async()=>fresh.push('begin'),state:()=>null},nextEpoch:async()=>1,project:e=>e});gate.resolve(1);await pending;assert.deepEqual(old,[]);assert.deepEqual(fresh,[]);assert.equal(after.get('hand'),undefined);
});
test('stalled fetch and stalled body both time out without a silent replay',async()=>{
 for(const fetcher of[()=>new Promise(()=>{}),async()=>({ok:true,text:()=>new Promise(()=>{})})]){
  await assert.rejects(requestJSON('/x',{}, {fetch:fetcher,timeoutMs:10}),{code:'LOCAL_TIMEOUT'});
 }
});
