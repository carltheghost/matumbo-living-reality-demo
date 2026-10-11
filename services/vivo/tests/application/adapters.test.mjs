import test from 'node:test';
import assert from 'node:assert/strict';
import {eventTime,frameOf,screenTarget,viewBasis,viewAngles,projectAccepted,timestampedCameraClass} from '../../web/application/adapters.mjs';
import {LocalTransport} from '../../web/application/transport.mjs';

test('capture timestamps retain monotonic age, normalize old epoch DOM events, and reject future values',()=>{
  assert.equal(eventTime({timeStamp:110},130,1700000000000),110);
  assert.equal(eventTime({timeStamp:1700000000110},130,1700000000000),110);
  assert.ok(Number.isNaN(eventTime({timeStamp:500},130,1700000000000)));
  assert.ok(Number.isNaN(eventTime({timeStamp:undefined},130,1700000000000)));
});
test('screen targets preserve all eleven spatial components and never modify entity coordinates',()=>{
  const entity={spaceId:'inner',chart:'flat',dimension:11,q:[0,0,1,2,3,4,5,6,7,8,9]};
  const original=structuredClone(entity),renderer={project:p=>({x:p[0]*100,y:p[2]*100})};
  const target=screenTarget(renderer,entity,[10,20],[30,50]);
  assert.equal(target.q[0],.2);assert.equal(target.q[1],.3);assert.deepEqual(target.q.slice(2),entity.q.slice(2));
  assert.deepEqual(entity,original);assert.equal(frameOf(entity).dimension,11);
});
test('singular view mapping refuses to manufacture coordinates',()=>{
  assert.throws(()=>screenTarget({project:()=>({x:1,y:2})},{spaceId:'root',chart:'flat',dimension:4,q:[0,0,0,0]},[0,0],[3,4]),/edge-on/);
});
test('saved orbit basis stays orthonormal and round trips in full dimension',()=>{
  for(const d of[4,11])for(const[yaw,pitch]of[[.55,.68],[-2,-1],[1,1.2]]){
    const b=viewBasis(d,yaw,pitch);for(let i=0;i<d;i++)for(let j=0;j<d;j++)assert.ok(Math.abs(b[i].reduce((n,x,k)=>n+x*b[j][k],0)-+(i===j))<1e-10);
    const angles=viewAngles(b);assert.ok(Math.abs(angles.yaw-yaw)<1e-10);assert.ok(Math.abs(angles.pitch-pitch)<1e-10);
  }
});
test('renderer adapter detaches accepted coordinates from constraints and own Eye',()=>{
  const state={snapshot:{spaces:{root:{dimension:4,entities:{r:{id:'r',q:[1,2,3,4]}}}}},eye:{spaceId:'root'},constraints:[{target:{q:[9,9,9,9]}}]};
  const projected=projectAccepted(state,{coords:[[],[]]});assert.deepEqual(projected.entities.r.q,[1,2,3,4]);
  projected.entities.r.q[0]=999;assert.equal(state.snapshot.spaces.root.entities.r.q[0],1);assert.deepEqual(projected.guide.activity,[0,0]);
});
test('camera adapter preserves capture time across inference and attaches actual final point',()=>{
  class FakeCamera{constructor(_v,_s,gesture){this.gesture=gesture;this.epoch=7;}consume(m){this.gesture({type:'aim',point:[2,3]});this.gesture({type:'release',reason:'Open hand'});}lost(){this.gesture({type:'release'});this.gesture({type:'lost'});}}
  const out=[],Timed=timestampedCameraClass(FakeCamera),c=new Timed(null,()=>{},e=>out.push(e),()=>{});
  c.consume({time:123});assert.equal(out[1].observedAt,123);assert.deepEqual(out[1].point,[2,3]);assert.equal(out[1].epoch,7);
  c.lost('stale');assert.deepEqual(out.slice(2).map(x=>x.type),['lost']);assert.ok(Number.isNaN(c.capturedAt));
});
test('transport rejects error responses and never rewinds accepted state on out-of-order HTTP',async()=>{
  const states=[],transport=new LocalTransport({onState:s=>states.push(s),fetch:async()=>({ok:false,text:async()=>'Local server down'})});
  transport.receive({snapshot:{acceptedSequence:5},eye:{revision:2}});transport.receive({snapshot:{acceptedSequence:4},eye:{revision:1}});
  assert.equal(transport.current.snapshot.acceptedSequence,5);assert.equal(states.length,1);
  await assert.rejects(transport.request('/x',{},false),/Local server down/);
});
test('transport emits only explicit admission and RPC fields, never a client actor claim',async()=>{
  const sent=[],transport=new LocalTransport({fetch:async(url,request)=>{sent.push({url,...request});return{ok:true,text:async()=>JSON.stringify(url.endsWith('/open')?{token:'local-token',session:{actorId:'local.one'},state:{snapshot:{acceptedSequence:0}}}:{value:12,state:{snapshot:{acceptedSequence:1}}})};}});
  await transport.admit('one','previous');assert.deepEqual(JSON.parse(sent[0].body),{seat:'one',resumeToken:'previous'});
  assert.equal(await transport.nextEpoch(),12);assert.equal(sent[1].headers.Authorization,'Bearer local-token');assert.deepEqual(JSON.parse(sent[1].body),{op:'nextEpoch',args:{}});
});
