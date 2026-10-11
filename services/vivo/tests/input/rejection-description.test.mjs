import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {GripController} from '../../web/input/controller.mjs';
import {validateCommand} from '../../contracts/validate.mjs';

const run = promisify(execFile);
const fallback = 'Transport rejected with a non-text reason';
class Clock {
  time=100; serial=0; timers=new Map();
  now=()=>this.time;
  setTimer=(fn,ms)=>{const id=++this.serial;this.timers.set(id,{fn,at:this.time+ms});return id;};
  clearTimer=id=>this.timers.delete(id);
  advance(ms=0) {
    this.time+=ms;
    for (;;) {
      const next=[...this.timers].filter(([,v])=>v.at<=this.time).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if (!next) return;
      this.timers.delete(next[0]); next[1].fn();
    }
  }
}
const flush=async clock=>{for(let i=0;i<4;i++){await new Promise(setImmediate);clock.advance();}};
function hostile(name, hooks) {
  if (name==='null-prototype') return Object.create(null);
  if (name==='message-getter') return Object.defineProperty({},'message',{
    get(){hooks.message++;throw Error('Untrusted message getter was invoked');}
  });
  if (name==='toString') return {toString(){hooks.coercion++;throw Error('Untrusted coercion was invoked');}};
  throw Error('Unknown probe reason');
}
function track(promise) {
  const result={status:'pending',settlements:0,code:null,message:null};
  promise.then(()=>{result.status='fulfilled';result.settlements++;},error=>{
    result.status='rejected';result.settlements++;result.code=error.code;result.message=error.message;
  });
  return result;
}
async function probe(name, timing, kind, outcome) {
  const clock=new Clock(),hooks={message:0,coercion:0},reason=hostile(name,hooks);
  const sent=[],reconciles=[],receipts=[],previews=[];
  let unhandled=0;
  const onUnhandled=()=>{unhandled++;};
  process.on('unhandledRejection',onUnhandled);
  try {
    const entity={id:'relic',revision:7,spaceId:'root',chart:'flat',dimension:4,q:[0,0,0,0],
      v:[0,0,0,0],materialProfile:'elastic',fieldMembership:[],innerSpaceId:null,lineage:[]};
    const c=new GripController({session:{mode:'remote',worldId:'world',authorityId:'authority'},
      idPrefix:'description',now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer,
      requestTimeoutMs:40,onReconcile:e=>reconciles.push(e),onReceipt:e=>receipts.push(e),onPreview:p=>previews.push(p),
      submit:command=>{
        validateCommand(command);sent.push(command);
        if(outcome==='fulfilled') return timing==='async'?Promise.resolve(reason):reason;
        if(timing==='sync') throw reason;
        return Promise.reject(reason);
      }});
    c.begin({entity,leaseId:'lease',source:'hand',inputEpoch:1});
    let ending;
    if(kind==='grab.target') {
      c.offer({...entity,q:[1,0,0,0]},clock.time);
      // Enter submit, but cancel before the failure's continuation. This checks
      // both public barriers without adding a second post-fault cleanup request.
      await Promise.resolve();
      assert.equal(sent.length,1);
      c.offer({...entity,q:[2,0,0,0]},clock.time);
      ending=track(c.end('pointerup'));
    } else {
      ending=track(c.end('pointerup'));
      clock.advance(); // Dispatch the release task, before its Promise settles.
    }
    const cancelling=track(c.cancel('tracking-lost'));
    await flush(clock);
    const before={ending:{...ending},cancelling:{...cancelling},state:c.state,
      reconciles:reconciles.length,timers:clock.timers.size};
    clock.advance(2000);await flush(clock); // No timeout retry or duplicate settlement.
    return {before,ending,cancelling,state:c.state,sent:sent.map(c=>c.kind),hooks,unhandled,
      reconciles:reconciles.map(e=>({reason:e.reason,message:e.message,receipt:e.receipt,cancelled:e.cancelled})),
      receipts:receipts.length,clearedPreview:previews.at(-1)===null,timers:clock.timers.size,
      acceptsMore:c.offer({...entity,q:[3,0,0,0]},clock.time)};
  } finally {process.removeListener('unhandledRejection',onUnhandled);}
}

// A plain child process isolates the old bug's unhandled rejection. The parent
// test observes it explicitly instead of masking it with a test-runner listener.
if(process.argv[2]==='--probe') {
  const [name,timing,kind]=process.argv.slice(3);
  const rejected=await probe(name,timing,kind,'rejected');
  const fulfilled=await probe(name,timing,kind,'fulfilled');
  process.stdout.write(JSON.stringify({rejected,fulfilled})+'\n');
} else {
  for(const name of ['null-prototype','message-getter','toString'])
    for(const timing of ['async','sync']) for(const kind of ['grab.target','grab.end'])
      test(`untrusted rejection description: ${name}, ${timing}, ${kind}`,async()=>{
        const {stdout,stderr}=await run(process.execPath,[fileURLToPath(import.meta.url),'--probe',name,timing,kind],
          {timeout:5000,maxBuffer:65536});
        assert.equal(stderr,'');
        const {rejected,fulfilled}=JSON.parse(stdout);
        for(const [result,code] of [[rejected,'TRANSPORT_UNCERTAIN'],[fulfilled,'INPUT_FAILURE']]) {
          assert.equal(result.before.ending.status,'rejected','end must settle before its deadline');
          assert.equal(result.before.cancelling.status,'rejected','cancel must settle before its deadline');
          for(const barrier of [result.ending,result.cancelling]) {
            assert.equal(barrier.status,'rejected');assert.equal(barrier.code,code);assert.equal(barrier.settlements,1);
          }
          assert.equal(result.before.state.phase,'blocked');assert.equal(result.state.phase,'blocked');
          assert.equal(result.state.error,code);assert.equal(result.state.entityRevision,7);
          assert.equal(result.state.acceptedSequence,0);assert.equal(result.state.pendingTargetSeq,null);
          assert.equal(result.state.inFlight,false);assert.equal(result.state.cancelled,true);
          assert.equal(result.before.reconciles,1);assert.equal(result.reconciles.length,1);
          assert.equal(result.reconciles[0].reason,code);assert.equal(result.reconciles[0].receipt,null);
          assert.equal(result.reconciles[0].cancelled,true);assert.equal(result.receipts,0);
          assert.equal(result.unhandled,0);assert.deepEqual(result.hooks,{message:0,coercion:0});
          assert.deepEqual(result.sent,[kind]);assert.equal(result.acceptsMore,false);
          assert.equal(result.clearedPreview,true);assert.equal(result.before.timers,0);assert.equal(result.timers,0);
        }
        assert.equal(rejected.ending.message,fallback);
        assert.equal(rejected.cancelling.message,fallback);
        assert.equal(rejected.reconciles[0].message,fallback);
      });
}
