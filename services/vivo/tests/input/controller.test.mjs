import test from 'node:test';
import assert from 'node:assert/strict';
import {GripController,InputSources} from '../../web/input/controller.mjs';
import {validateCommand} from '../../contracts/validate.mjs';

class Clock {
  time=100; serial=0; timers=new Map();
  now=()=>this.time;
  setTimer=(fn,ms)=>{const id=++this.serial;this.timers.set(id,{fn,at:this.time+ms});return id;};
  clearTimer=id=>this.timers.delete(id);
  advance(ms=0) {
    this.time+=ms;
    for (;;) {
      const next=[...this.timers].filter(([,v])=>v.at<=this.time).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if (!next) break; this.timers.delete(next[0]); next[1].fn();
    }
  }
}
const entity=(dimension=4)=>({id:'relic:1',revision:10,spaceId:'space:1',chart:'flat',dimension,
  q:Array(dimension).fill(0),v:Array(dimension).fill(0),materialProfile:'elastic',fieldMembership:['field:1'],innerSpaceId:'inner:1',lineage:[]});
function fixture({source='touch',dimension=4,mode='remote',...options}={}) {
  const f={clock:new Clock(),sent:[],pending:[],previews:[],receipts:[],reconciles:[],statuses:[],concurrent:0,maximum:0};
  f.options={session:{mode,actorId:'actor:1',worldId:'world:1',authorityId:'authority:1',capabilities:[]},
    idPrefix:'test.'+source,now:f.clock.now,setTimer:f.clock.setTimer,clearTimer:f.clock.clearTimer,
    requestTimeoutMs:1000,
    submit:command=>{
      validateCommand(command);f.sent.push(command);f.concurrent++;f.maximum=Math.max(f.maximum,f.concurrent);
      return new Promise((resolve,reject)=>f.pending.push({
        resolve:r=>{f.concurrent--;resolve(r);},reject:e=>{f.concurrent--;reject(e);}
      }));
    },
    onPreview:p=>f.previews.push(p),onReceipt:r=>f.receipts.push(r),onReconcile:r=>f.reconciles.push(r),onStatus:s=>f.statuses.push(s),...options};
  f.c=new GripController(f.options);f.entity=entity(dimension);
  f.context={entity:f.entity,leaseId:'lease:1',source,inputEpoch:1};f.c.begin(f.context);
  f.offer=(x,observedAt=f.clock.time)=>f.c.offer({...f.entity,q:Array.from({length:dimension},(_,i)=>i===dimension-1?x:0)},observedAt);
  return f;
}
async function flush(...fixtures) {
  // A host task runs after the entire Promise microtask queue, not after one job.
  // Match that ordering before advancing injected task/deadline timers.
  for(let i=0;i<4;i++){await new Promise(setImmediate);for(const f of fixtures)f.clock.advance();}
}
function receipt(f,index,overrides={}) {
  return {schema:'vivo.receipt/1',id:f.sent[index].id,status:'accepted',authorityId:'authority:1',
    acceptedSequence:index+1,entityRevision:f.sent[index].expectedRevision+1,code:'OK',stateHash:'a'.repeat(64),result:null,...overrides};
}
function reply(f,index,overrides={}) {f.pending[index].resolve(receipt(f,index,overrides));}
async function finish(f) {
  const done=f.c.end('pointerup');await flush(f);const index=f.sent.length-1;
  assert.equal(f.sent[index].kind,'grab.end');reply(f,index);await flush(f);await done;
}
const errorCode=code=>e=>e.code===code;

test('latest target and provisional preview survive a delayed acknowledgement',async()=>{
  const f=fixture();f.offer(1);await flush(f);
  for(let n=2;n<=30;n++)f.offer(n);
  assert.equal(f.sent.length,1);assert.equal(f.previews.length,30);
  assert.equal(f.previews.at(-1).frame.q[3],30);assert.equal(f.previews.at(-1).provisional,true);
  assert.equal(f.c.state.pendingTargetSeq,30);
  reply(f,0);await flush(f);assert.equal(f.sent.length,2);
  assert.deepEqual(f.sent[1].payload.q,[0,0,0,30]);assert.equal(f.sent[1].payload.targetSeq,30);
  assert.equal(f.sent[1].expectedRevision,11);assert.equal(f.maximum,1);
  reply(f,1);await flush(f);await finish(f);
});
test('reversing direction replaces pending target rather than queueing a trajectory',async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(100);f.offer(-2);reply(f,0);await flush(f);
  assert.equal(f.sent[1].payload.q[3],-2);assert.equal(f.sent.length,2);
});
test('mailbox completion counter never invents an authority material revision',async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(2);reply(f,0,{entityRevision:10});await flush(f);
  assert.equal(f.c.state.entityRevision,10);assert.equal(f.sent[1].expectedRevision,10);
});
for(const dimension of [2,3,4,5,6,7,8,9,10,11]) test(`wire and preview preserve exactly ${dimension} spatial coordinates`,async()=>{
  const f=fixture({dimension});f.offer(.5);await flush(f);
  assert.equal(f.sent[0].payload.dimension,dimension);assert.equal(f.sent[0].payload.q.length,dimension);
  assert.equal(f.sent[0].payload.q.at(-1),.5);assert.equal(f.previews[0].frame.q.length,dimension);
});
test('capture and preview do not mutate Entity, velocities, or caller coordinates',async()=>{
  const f=fixture();const original=structuredClone(f.entity),q=[1,2,3,4];
  f.c.offer({...f.entity,q},100);q[3]=90;await flush(f);
  assert.deepEqual(f.entity,original);assert.deepEqual(f.sent[0].payload.q,[1,2,3,4]);
  assert.throws(()=>{f.previews[0].frame.q[0]=99;});assert.throws(()=>{f.sent[0].payload.leaseId='stolen';});
});
test('begin detaches lease, entity identity, chart and revision from caller changes',async()=>{
  const f=fixture();f.context.leaseId='other';f.entity.id='other';f.entity.revision=500;f.entity.chart='changed';
  f.c.offer({spaceId:'space:1',chart:'flat',dimension:4,q:[1,2,3,4]},100);await flush(f);
  assert.equal(f.sent[0].payload.entityId,'relic:1');assert.equal(f.sent[0].payload.leaseId,'lease:1');assert.equal(f.sent[0].expectedRevision,10);
});
test('invalid coordinates including sparse arrays are rejected before preview',()=>{
  const f=fixture();for(const q of [[1,2,3],[NaN,0,0,0],[Infinity,0,0,0],['1',0,0,0],[1001,0,0,0],new Array(4)])
    assert.throws(()=>f.c.offer({...f.entity,q},100));
  assert.equal(f.previews.length,0);assert.equal(f.sent.length,0);
});
test('chart, space and dimension changes require an explicit external transform',()=>{
  const f=fixture();for(const change of [{spaceId:'elsewhere'},{chart:'other'},{dimension:3,q:[0,0,0]}])
    assert.throws(()=>f.c.offer({...f.entity,...change},100),errorCode('FRAME_MISMATCH'));
});
test('time labels and unsupported dimensions never become target axes',()=>{
  const f=fixture();for(const dimension of [1,12,'3+time'])assert.throws(()=>f.c.offer({...f.entity,dimension},100));
});
test('sample age is computed at actual send rather than at offer',async()=>{
  const f=fixture();f.offer(1);f.clock.advance(40);await flush(f);assert.equal(f.sent[0].payload.sampleAgeMs,40);
});
test('future and stale observations are rejected without cancelling the grip',()=>{
  const f=fixture();assert.equal(f.offer(1,-100),false);assert.equal(f.offer(1,106),false);assert.equal(f.offer(1,NaN),false);
  assert.equal(f.c.state.phase,'active');assert.equal(f.previews.length,0);
});
test('reference five-ms future tolerance clamps wire sample age to zero',async()=>{
  const f=fixture();assert.equal(f.offer(1,105),true);await flush(f);assert.equal(f.sent[0].payload.sampleAgeMs,0);
});
test('age boundary of 150 ms is accepted without increasing the frozen budget',async()=>{
  const f=fixture();f.offer(1,-50);await flush(f);assert.equal(f.sent[0].payload.sampleAgeMs,150);
});
test('pending targets that age out during an acknowledgement are explicitly discarded',async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(2);f.clock.advance(151);reply(f,0);await flush(f);
  assert.equal(f.sent.length,1);assert.equal(f.c.state.pendingTargetSeq,null);
  assert(f.statuses.some(s=>s.message==='target-expired'));assert.equal(f.previews.at(-1),null);
});
test('target aging out before the send microtask never reaches authority',async()=>{
  const f=fixture();f.offer(1);f.clock.advance(151);await flush(f);assert.equal(f.sent.length,0);
  assert(f.statuses.some(s=>s.message==='target-expired'));
});
test('end retains the final valid target and sends release only after its acceptance',async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(7);
  let ended=false;const done=f.c.end('pointerup').then(()=>{ended=true;});
  assert.equal(f.offer(99),false);await flush(f);assert.equal(f.sent.length,1);
  reply(f,0);await flush(f);assert.equal(f.sent[1].kind,'grab.target');assert.equal(f.sent[1].payload.q[3],7);
  assert.equal(ended,false);reply(f,1);await flush(f);
  assert.equal(f.sent[2].kind,'grab.end');assert.equal(f.sent[2].expectedRevision,12);assert.equal(ended,false);
  reply(f,2);await flush(f);await done;assert.equal(f.c.state.phase,'closed');assert.equal(f.maximum,1);
});
test('stale final target reports failed finish even when lease release succeeds',async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(7);const done=f.c.end('pointerup');
  f.clock.advance(151);reply(f,0);await flush(f);assert.equal(f.sent[1].kind,'grab.end');reply(f,1);await flush(f);
  await assert.rejects(done,errorCode('FINAL_TARGET_STALE'));assert.equal(f.c.state.phase,'closed');
});
test('a fresh target replaces an expired final intent without retaining the failure',async()=>{
  const f=fixture();f.offer(1);f.clock.advance(151);await flush(f);f.offer(2);await flush(f);reply(f,0);await flush(f);await finish(f);
});
test('end without motion releases an already supplied lease, never acquires one',async()=>{
  const f=fixture();await finish(f);assert.deepEqual(f.sent.map(c=>c.kind),['grab.end']);
});
test('cancel discards pending motion, reconciles accepted flight, then releases its revision',async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(9);const done=f.c.cancel('tracking-lost');
  assert.equal(f.c.state.pendingTargetSeq,null);assert.equal(f.previews.at(-1),null);assert.equal(f.offer(10),false);
  await flush(f);assert.equal(f.sent.length,1);reply(f,0);await flush(f);
  assert.equal(f.receipts[0].cancelled,true);assert.equal(f.sent[1].kind,'grab.end');assert.equal(f.sent[1].expectedRevision,11);
  reply(f,1);await flush(f);await done;assert.equal(f.c.state.phase,'closed');assert.equal(f.sent.length,2);
});
test('cancel before send microtask suppresses the target instead of sending after release',async()=>{
  const f=fixture();f.offer(1);const done=f.c.cancel('pointercancel');await flush(f);
  assert.deepEqual(f.sent.map(c=>c.kind),['grab.end']);reply(f,0);await flush(f);await done;
});
test('cancel supersedes end without falsely reporting final-target delivery',async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(2);const ending=f.c.end('pointerup');const cancelling=f.c.cancel('lost');
  reply(f,0);await flush(f);assert.equal(f.sent[1].kind,'grab.end');reply(f,1);await flush(f);
  await cancelling;await assert.rejects(ending,errorCode('END_CANCELLED'));
});
test('repeated end/cancel calls share one release barrier',async()=>{
  const f=fixture();const a=f.c.end('up'),b=f.c.end('again');assert.equal(a,b);await flush(f);
  const c=f.c.cancel('lost'),d=f.c.cancel('lost');assert.equal(c,d);assert.equal(f.sent.length,1);
  reply(f,0);await flush(f);await c;await assert.rejects(a,errorCode('END_CANCELLED'));assert.equal(f.sent.length,1);
});
for(const code of ['LEASE_LOST','REVISION_CONFLICT','INVALID_TARGET']) test(`${code} rejection blocks automatic retry and requests explicit reconciliation`,async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(2);reply(f,0,{status:'rejected',code,stateHash:null,entityRevision:null});await flush(f);
  assert.equal(f.c.state.phase,'blocked');assert.equal(f.offer(3),false);assert.equal(f.sent.length,1);
  assert.equal(f.reconciles[0].latest.frame.q[3],2);await assert.rejects(f.c.cancel('cleanup'),errorCode('AUTHORITY_REJECTED'));
  assert.throws(()=>f.c.begin({...f.context,inputEpoch:2}),errorCode('GRIP_NOT_SETTLED'));
});
for(const [name,changes,code] of [
  ['wrong command',{id:'other'},'RECEIPT_MISMATCH'],['wrong authority',{authorityId:'elsewhere'},'RECEIPT_MISMATCH'],
  ['old revision',{entityRevision:9},'STALE_RECEIPT'],['nonadvancing sequence',{acceptedSequence:0},'STALE_RECEIPT'],
  ['missing entity revision',{entityRevision:null},'STALE_RECEIPT'],['missing state hash',{stateHash:null},'INPUT_FAILURE']
]) test(`${name} reply cannot authorize more movement`,async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(2);reply(f,0,changes);await flush(f);
  assert.equal(f.c.state.phase,'blocked');assert.equal(f.c.state.entityRevision,10);assert.equal(f.sent.length,1);
  await assert.rejects(f.c.end('cleanup'),errorCode(code));
});
test('reordered duplicate of an old receipt cannot settle a newer command',async()=>{
  const f=fixture();f.offer(1);await flush(f);const old=receipt(f,0);reply(f,0);await flush(f);f.offer(2);await flush(f);
  f.offer(3);f.pending[1].resolve(old);await flush(f);assert.equal(f.c.state.phase,'blocked');assert.equal(f.c.state.entityRevision,11);assert.equal(f.sent.length,2);
});
test('accepted sequence may not regress even in a rejection receipt',async()=>{
  const f=fixture({acceptedSequence:10});f.offer(1);await flush(f);reply(f,0,{status:'rejected',acceptedSequence:9,stateHash:null});await flush(f);
  assert.equal(f.c.state.error,'STALE_RECEIPT');
});
test('transport rejection is an unknown outcome and never causes a blind retry',async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(2);f.pending[0].reject(Error('offline'));await flush(f);
  assert.equal(f.c.state.error,'TRANSPORT_UNCERTAIN');assert.equal(f.sent.length,1);assert.equal(f.reconciles.length,1);
});
test('hung target has bounded cleanup; late acceptance is evidence only, not reactivation',async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(2);const done=f.c.cancel('disconnect');
  f.clock.advance(1000);await flush(f);await assert.rejects(done,errorCode('TRANSPORT_UNCERTAIN'));
  assert.equal(f.c.state.phase,'blocked');reply(f,0);await flush(f);
  assert.equal(f.sent.length,1);assert.equal(f.c.state.entityRevision,10);assert.equal(f.c.state.phase,'blocked');
  assert.equal(f.receipts.at(-1).late,true);assert.equal(f.reconciles.at(-1).reason,'LATE_OUTCOME');
});
test('release timeout and late reply do not falsely mark remote lease closed',async()=>{
  const f=fixture();const done=f.c.end('up');await flush(f);f.clock.advance(1000);await flush(f);
  await assert.rejects(done,errorCode('TRANSPORT_UNCERTAIN'));reply(f,0);await flush(f);
  assert.equal(f.c.state.phase,'blocked');assert.equal(f.sent.length,1);assert.equal(f.receipts.at(-1).late,true);
});
test('release rejection requests cleanup instead of reporting success',async()=>{
  const f=fixture();const done=f.c.end('up');await flush(f);reply(f,0,{status:'rejected',code:'LEASE_EXPIRED',stateHash:null});await flush(f);
  await assert.rejects(done,errorCode('AUTHORITY_REJECTED'));assert.equal(f.c.state.phase,'blocked');
});
test('closed controller requires a fresh epoch and cannot reuse old mailbox callbacks',async()=>{
  const f=fixture();await finish(f);assert.throws(()=>f.c.begin(f.context),errorCode('EPOCH_NOT_NEW'));
  f.c.begin({...f.context,entity:{...f.entity,revision:11},leaseId:'lease:2',inputEpoch:2});
  f.offer(5);await flush(f);assert.equal(f.sent[1].payload.leaseId,'lease:2');assert.equal(f.sent[1].payload.inputEpoch,2);
});
test('dispose closes local input immediately and returns the remote release barrier',async()=>{
  const f=fixture();const done=f.c.dispose();assert.equal(f.c.state.phase,'disposed');assert.equal(f.offer(2),false);
  assert.throws(()=>f.c.begin({...f.context,inputEpoch:2}),errorCode('DISPOSED'));await flush(f);reply(f,0);await flush(f);await done;
});
test('hand loss by track key leaves other hand and touch independent',async()=>{
  const touch=fixture(),left=fixture({source:'hand',idPrefix:'left'}),right=fixture({source:'hand',idPrefix:'right'});
  const s=new InputSources();s.add('pointer:1',touch.c);s.add('hand:left',left.c);s.add('hand:right',right.c);
  for(const f of [touch,left,right])f.offer(1);await flush(touch,left,right);
  const done=s.cancelSource('hand','tracking-lost','hand:left');assert.equal(left.c.state.cancelled,true);
  assert.equal(right.c.state.phase,'active');assert.equal(touch.offer(9),true);
  reply(left,0);await flush(touch,left,right);reply(left,1);await flush(touch,left,right);await done;
  assert.equal(touch.sent.length,1);assert.equal(right.sent.length,1);
});
test('camera shutdown releases all hands but not a held touch',async()=>{
  const touch=fixture(),hand=fixture({source:'hand'}),s=new InputSources();s.add('touch:1',touch.c);s.add('hand:1',hand.c);
  const done=s.cancelSource('hand','camera-stopped');await flush(touch,hand);assert.equal(hand.sent[0].kind,'grab.end');
  assert.equal(touch.sent.length,0);assert.equal(touch.c.state.phase,'active');reply(hand,0);await flush(touch,hand);await done;
});
test('pointer cancellation does not cancel a hand grip',async()=>{
  const touch=fixture(),hand=fixture({source:'hand'}),s=new InputSources();s.add('touch:1',touch.c);s.add('hand:1',hand.c);
  const done=s.cancelSource('touch','pointercancel','touch:1');await flush(touch,hand);assert.equal(hand.c.state.phase,'active');
  reply(touch,0);await flush(touch,hand);await done;
});
test('reordered replies across source streams do not share revisions or mailboxes',async()=>{
  const a=fixture(),b=fixture({source:'hand'});a.offer(1);b.offer(2);await flush(a,b);
  reply(b,0,{entityRevision:20,acceptedSequence:100});await flush(a,b);assert.equal(a.c.state.entityRevision,10);
  reply(a,0,{entityRevision:11,acceptedSequence:5});await flush(a,b);
  a.offer(3);b.offer(4);await flush(a,b);assert.equal(a.sent[1].expectedRevision,11);assert.equal(b.sent[1].expectedRevision,20);
});
test('disconnect stops only remote controllers, leaving local operation available',async()=>{
  const remote=fixture(),local=fixture({mode:'local',idPrefix:'local'}),s=new InputSources();s.add('remote',remote.c);s.add('local',local.c);
  const done=s.disconnect();await flush(remote,local);assert.equal(local.c.state.phase,'active');assert.equal(local.offer(1),true);
  reply(remote,0);await flush(remote,local);await done;
});
test('group cancellation attempts all relevant grips even when one is blocked',async()=>{
  const a=fixture(),b=fixture({source:'hand'}),s=new InputSources();s.add('a',a.c);s.add('b',b.c);
  a.offer(1);await flush(a,b);a.pending[0].reject(Error('down'));await flush(a,b);const done=s.cancelAll('stop');done.catch(()=>{});
  await flush(a,b);assert.equal(b.sent[0].kind,'grab.end');reply(b,0);await flush(a,b);await assert.rejects(done,AggregateError);
});
test('observer exceptions cannot interrupt target scheduling or receipt handling',async()=>{
  const f=fixture({onPreview:()=>{throw Error('view');},onReceipt:()=>{throw Error('observer');}});
  assert.equal(f.offer(1),true);await flush(f);reply(f,0);await flush(f);assert.equal(f.c.state.phase,'active');assert.equal(f.c.state.observerErrors,2);
  await finish(f);
});
test('invalid configuration, ownership, or concurrent begin is rejected',()=>{
  const f=fixture();assert.throws(()=>new GripController({...f.options,maxAgeMs:151}));assert.throws(()=>new GripController({...f.options,requestTimeoutMs:0}));
  assert.throws(()=>new GripController({...f.options,onReconcile:undefined}));assert.throws(()=>f.c.begin({...f.context,inputEpoch:2}),errorCode('GRIP_NOT_SETTLED'));
  const c=new GripController(f.options);assert.throws(()=>c.begin({...f.context,leaseId:''}));assert.throws(()=>c.begin({...f.context,source:'camera'}));
});
test('source registry rejects duplicate controllers and cannot detach an active grip',()=>{
  const f=fixture(),s=new InputSources();s.add('one',f.c);assert.throws(()=>s.add('two',f.c));assert.throws(()=>s.remove('one'),errorCode('GRIP_NOT_SETTLED'));
});
test('end and cancel reject invalid reasons without mutating active state',()=>{
  const f=fixture();for(const reason of ['',null,'x'.repeat(121)]){assert.throws(()=>f.c.end(reason));assert.throws(()=>f.c.cancel(reason));}
  assert.equal(f.c.state.phase,'active');
});

test('expired reserved target cannot clear a newer fresh preview or fail its finish',async()=>{
  const f=fixture();f.offer(1);f.clock.advance(151);f.offer(2);
  const done=f.c.end('pointerup');await flush(f);
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].payload.targetSeq,2);
  assert.equal(f.previews.at(-1).frame.q[3],2);reply(f,0);await flush(f);
  assert.equal(f.sent[1].kind,'grab.end');reply(f,1);await flush(f);await done;
});
test('accepted cancelled flight supplies reconciliation evidence before lease cleanup',async()=>{
  const f=fixture();f.offer(1);await flush(f);const done=f.c.cancel('hand-lost');reply(f,0);await flush(f);
  const event=f.reconciles.find(r=>r.reason==='CANCELLED_IN_FLIGHT');
  assert.equal(event.cancelled,true);assert.equal(event.command.id,f.sent[0].id);
  assert.equal(event.receipt.entityRevision,11);assert.equal(f.sent[1].expectedRevision,11);
  reply(f,1);await flush(f);await done;
});
test('real host event loop releases only after mailbox finalizers finish',async()=>{
  const sent=[];let seq=0;
  const c=new GripController({session:{mode:'local',worldId:'w',authorityId:'a'},idPrefix:'real',
    onReconcile:()=>assert.fail('unexpected reconciliation'),
    submit:async command=>{sent.push(command);return {schema:'vivo.receipt/1',id:command.id,
      status:'accepted',authorityId:'a',acceptedSequence:++seq,entityRevision:command.expectedRevision,
      code:'OK',stateHash:'b'.repeat(64),result:null};}});
  c.begin({entity:entity(),leaseId:'lease:1',source:'touch',inputEpoch:1});
  c.offer({...entity(),q:[1,2,3,4]},performance.now());
  c.offer({...entity(),q:[4,3,2,1]},performance.now());await c.end('up');
  assert.deepEqual(sent.map(x=>x.kind),['grab.target','grab.target','grab.end']);
  assert.deepEqual(sent[1].payload.q,[4,3,2,1]);assert.equal(c.state.phase,'closed');
});
test('synchronous submit failure becomes explicit uncertainty with no blind retry',async()=>{
  const f=fixture({submit:()=>{throw Error('synchronous transport failure');}});f.offer(1);await flush(f);
  assert.equal(f.c.state.error,'TRANSPORT_UNCERTAIN');assert.equal(f.c.state.phase,'blocked');
  assert.equal(f.reconciles.length,1);assert.equal(f.offer(2),false);
});
test('async observer rejection is isolated from successful authority receipt processing',async()=>{
  const f=fixture({onPreview:async()=>{throw Error('async preview failure');}});
  f.offer(1);await flush(f);reply(f,0);await flush(f);
  assert.equal(f.c.state.observerErrors,1);assert.equal(f.c.state.entityRevision,11);await finish(f);
});
test('cancelling a blocked stream marks retained intent cancelled for external reconciliation',async()=>{
  const f=fixture();f.offer(1);await flush(f);f.offer(9);f.pending[0].reject(Error('offline'));await flush(f);
  await assert.rejects(f.c.cancel('tracking-lost'),errorCode('TRANSPORT_UNCERTAIN'));
  assert.equal(f.c.state.cancelled,true);assert.equal(f.reconciles.at(-1).cancelled,true);
  assert.equal(f.reconciles.at(-1).reason,'CANCEL_REQUIRES_RECONCILIATION');assert.equal(f.sent.length,1);
});
