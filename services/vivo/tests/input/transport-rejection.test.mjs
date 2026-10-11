import test from 'node:test';
import assert from 'node:assert/strict';
import {GripController} from '../../web/input/controller.mjs';
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
const errorCode=code=>e=>e.code===code;

// Rejection is a Promise outcome, not the truthiness of its reason. Keep the
// fulfilled/malformed and late-outcome paths distinct from transport failures.
for(const [name,value] of [['undefined',undefined],['null',null],['false',false],['0',0],["''",'']]) {
  test(`falsy target rejection ${name} blocks with TRANSPORT_UNCERTAIN and never retries`,async()=>{
    const f=fixture();f.offer(1);await flush(f);f.offer(2);f.pending[0].reject(value);await flush(f);
    assert.equal(f.c.state.error,'TRANSPORT_UNCERTAIN');assert.equal(f.c.state.phase,'blocked');
    assert.equal(f.c.state.entityRevision,10);assert.equal(f.c.state.acceptedSequence,0);
    assert.equal(f.c.state.pendingTargetSeq,null);assert.equal(f.previews.at(-1),null);
    assert.equal(f.receipts.length,0);assert.equal(f.reconciles.length,1);
    assert.equal(f.reconciles[0].reason,'TRANSPORT_UNCERTAIN');assert.equal(f.reconciles[0].receipt,null);
    assert.equal(f.reconciles[0].command.id,f.sent[0].id);assert.equal(f.reconciles[0].latest.frame.q[3],2);
    assert.equal(f.offer(3),false);await assert.rejects(f.c.end('up'),errorCode('TRANSPORT_UNCERTAIN'));
    await assert.rejects(f.c.cancel('cleanup'),errorCode('TRANSPORT_UNCERTAIN'));
    assert.throws(()=>f.c.begin({...f.context,inputEpoch:2}),errorCode('GRIP_NOT_SETTLED'));
    f.clock.advance(2000);await flush(f);assert.equal(f.sent.length,1);assert.equal(f.clock.timers.size,0);
  });
  test(`falsy release transport rejection ${name} cannot report a closed lease`,async()=>{
    const f=fixture();const done=f.c.end('up');await flush(f);
    assert.equal(f.sent[0].kind,'grab.end');f.pending[0].reject(value);await flush(f);
    await assert.rejects(done,errorCode('TRANSPORT_UNCERTAIN'));
    assert.equal(f.c.state.error,'TRANSPORT_UNCERTAIN');assert.equal(f.c.state.phase,'blocked');
    assert.equal(f.c.state.entityRevision,10);assert.equal(f.c.state.acceptedSequence,0);
    assert.equal(f.reconciles.length,1);assert.equal(f.reconciles[0].reason,'TRANSPORT_UNCERTAIN');
    assert.equal(f.reconciles[0].command.kind,'grab.end');assert.equal(f.reconciles[0].receipt,null);
    assert.equal(f.receipts.length,0);assert.equal(f.offer(1),false);
    await assert.rejects(f.c.end('again'),errorCode('TRANSPORT_UNCERTAIN'));
    await assert.rejects(f.c.cancel('cleanup'),errorCode('TRANSPORT_UNCERTAIN'));
    f.clock.advance(2000);await flush(f);assert.equal(f.sent.length,1);assert.equal(f.clock.timers.size,0);
  });
  test(`falsy synchronous submit throw ${name} uses the transport rejection path`,async()=>{
    const calls=[];
    const f=fixture({submit:command=>{validateCommand(command);calls.push(command);throw value;}});
    f.offer(1);await flush(f);
    assert.equal(f.c.state.error,'TRANSPORT_UNCERTAIN');assert.equal(f.c.state.phase,'blocked');
    assert.equal(f.reconciles.length,1);assert.equal(f.reconciles[0].reason,'TRANSPORT_UNCERTAIN');
    assert.equal(f.reconciles[0].command.id,calls[0].id);assert.equal(f.receipts.length,0);
    await assert.rejects(f.c.end('up'),errorCode('TRANSPORT_UNCERTAIN'));assert.equal(f.offer(2),false);
    f.clock.advance(2000);await flush(f);assert.equal(calls.length,1);assert.equal(f.clock.timers.size,0);
  });
  test(`falsy fulfilled receipt ${name} remains INPUT_FAILURE, not transport rejection`,async()=>{
    const f=fixture();f.offer(1);await flush(f);f.offer(2);f.pending[0].resolve(value);await flush(f);
    assert.equal(f.c.state.error,'INPUT_FAILURE');assert.equal(f.c.state.phase,'blocked');
    assert.equal(f.reconciles.length,1);assert.equal(f.reconciles[0].reason,'INPUT_FAILURE');
    assert.equal(f.receipts.length,0);assert.equal(f.c.state.entityRevision,10);
    await assert.rejects(f.c.end('up'),errorCode('INPUT_FAILURE'));assert.equal(f.offer(3),false);
    f.clock.advance(2000);await flush(f);assert.equal(f.sent.length,1);
  });
  test(`falsy late rejection ${name} preserves uncertainty without receipt or reactivation`,async()=>{
    const f=fixture();f.offer(1);await flush(f);f.offer(2);const done=f.c.cancel('disconnect');
    f.clock.advance(1000);await flush(f);await assert.rejects(done,errorCode('TRANSPORT_UNCERTAIN'));
    assert.equal(f.reconciles[0].reason,'TRANSPORT_UNCERTAIN');
    f.pending[0].reject(value);await flush(f);
    assert.equal(f.c.state.error,'TRANSPORT_UNCERTAIN');assert.equal(f.c.state.phase,'blocked');
    assert.equal(f.c.state.entityRevision,10);assert.equal(f.c.state.acceptedSequence,0);
    assert.equal(f.reconciles.length,2);assert.equal(f.reconciles[1].reason,'LATE_OUTCOME');
    assert.equal(f.reconciles[1].receipt,null);assert.equal(f.receipts.length,0);assert.equal(f.offer(3),false);
    f.clock.advance(2000);await flush(f);assert.equal(f.sent.length,1);assert.equal(f.clock.timers.size,0);
  });
}
