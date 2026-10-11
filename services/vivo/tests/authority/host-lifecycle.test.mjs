import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalLeaseWorld} from '../../web/authority/lease-authority.mjs';
import {GripHost} from '../../web/authority/grip-host.mjs';

// Real authority + frozen PR75 controller, with manually delivered transport
// outcomes and a deterministic timer queue. No wall-clock sleeps or fake ACKs.
const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});
  return {promise,resolve,reject};
};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check) {
  for(let i=0;i<10000;i++){if(check())return;await turn();}
  assert.fail('Expected deterministic event did not arrive');
}
class Clock {
  time=1000; serial=0; timers=new Map();
  set=(fn,ms)=>{const id=++this.serial;this.timers.set(id,{fn,at:this.time+ms});return id;};
  clear=id=>this.timers.delete(id);
  run(ms=0) {
    this.time+=ms;
    for(const [id,t] of [...this.timers])if(t.at<=this.time){this.timers.delete(id);t.fn();}
  }
}
function seed() {
  const entity=id=>({id,spaceId:'root',chart:'flat',dimension:4,q:[0,0,0,0],v:[0,0,0,0],
    revision:7,materialProfile:'elastic',fieldMembership:['f'],innerSpaceId:null,lineage:[]});
  return {schema:'vivo.snapshot/1',worldId:'lifecycle.world',authorityId:'lifecycle.authority',
    acceptedSequence:0,simulationTime:8,rootSpaceId:'root',stateHash:'0'.repeat(64),spaces:{root:{id:'root',
      dimension:4,intrinsicDimension:4,atlasId:'flat',metricId:'euclidean',topologyId:'open',
      law:{id:'pending',version:'0'},modelHashes:[],field:{codec:'pending',handle:'f',hash:'0'.repeat(64)},
      entities:{relic:entity('relic'),other:entity('other')}}}};
}
async function fixture(t,wrap=p=>p,options={}) {
  const clock=new Clock(),world=await LocalLeaseWorld.create({snapshot:seed(),now:()=>clock.time,leaseMs:3000});
  const a=world.attach({actorId:'A'}),sent=[],outcomes=[],reconciles=[],receipts=[],snapshots=[],statuses=[];
  const port=wrap({...a,
    submit:async c=>{sent.push(c);const r=await a.submit(c);outcomes.push({command:c,receipt:r});return r;},
    reconcileLease:async e=>{reconciles.push(e);return a.reconcileLease(e);}
  });
  const host=await GripHost.open(port,{now:()=>clock.time,setTimer:clock.set,clearTimer:clock.clear,
    requestTimeoutMs:100,acquisitionTimeoutMs:100,cleanupTimeoutMs:100,...options,
    onReceipt:(key,event)=>{receipts.push({key,...structuredClone(event)});return options.onReceipt?.(key,event);},
    onSnapshot:s=>snapshots.push(s),
    onStatus:(key,s)=>statuses.push({key,...s})});
  t.after(()=>{clock.timers.clear();});
  const entity=id=>a.getSnapshot().spaces.root.entities[id];
  const begin=(key='hand',id='relic',source='hand',inputEpoch=1)=>host.begin(key,{entity:entity(id),source,inputEpoch});
  const offer=(key='hand',id='relic',x=1)=>host.offer(key,{...entity(id),q:[0,0,0,x]},clock.time);
  const finish=async promise=>{
    let done=false;const checked=promise.finally(()=>{done=true;});checked.catch(()=>{});
    await until(()=>{clock.run();return done;});return checked;
  };
  return {clock,world,a,host,sent,outcomes,reconciles,receipts,snapshots,statuses,begin,offer,entity,finish};
}
function holdAfter(kind,entityId='relic') {
  const held=deferred(),ready=deferred();let receipt;
  return {held,ready,get receipt(){return receipt;},wrap:p=>({...p,submit:async c=>{
    const r=await p.submit(c);
    if(c.kind===kind&&c.payload.entityId===entityId){receipt=r;ready.resolve(r);return held.promise;}
    return r;
  }})};
}

test('accepted cancelled in-flight target keeps one ordinary accepted release path and touch alive',async t=>{
  const h=holdAfter('grab.target'),f=await fixture(t,h.wrap);
  await f.begin();await f.begin('touch','other','touch');f.offer();await h.ready.promise;
  f.offer('hand','relic',2);
  const cancelled=f.host.cancel('hand','tracking-lost');
  assert.equal(f.host.state('hand').controller.pendingTargetSeq,null);
  h.held.resolve(h.receipt);await f.finish(cancelled);
  assert.equal(f.reconciles.length,0);
  assert.deepEqual(f.sent.filter(c=>c.payload.entityId==='relic').map(c=>c.kind),['grab.begin','grab.target','grab.end']);
  const release=f.outcomes.find(o=>o.command.kind==='grab.end');assert.equal(release.receipt.status,'accepted');
  assert.equal(f.host.state('hand').phase,'closed');assert.equal(f.host.state('hand').cleanupConfirmed,true);
  assert.equal(f.receipts.find(r=>r.command.kind==='grab.target').cancelled,true);
  assert.equal(f.a.inspectLease('root','relic'),null);assert.ok(f.a.inspectLease('root','other'));
  assert.equal(f.host.state('touch').phase,'active');await f.finish(f.host.close());
});

test('a rejected release remains rejected; cleanup is explicitly reconciled',async t=>{
  const f=await fixture(t,p=>({...p,submit:c=>{
    if(c.kind==='grab.end') f.clock.time+=3001;
    return p.submit(c);
  }}));
  await f.begin();await f.finish(f.host.cancel('hand','cancel'));
  const releases=f.receipts.filter(r=>r.command.kind==='grab.end');
  assert.equal(releases.length,1);assert.equal(releases[0].receipt.status,'rejected');
  assert.equal(releases[0].receipt.code,'LEASE_EXPIRED');assert.equal(f.reconciles.length,1);
  assert.equal(f.host.state('hand').phase,'reconciled');assert.equal(f.host.state('hand').controller.phase,'blocked');
  assert.equal(f.host.state('hand').cleanupConfirmed,true);await f.host.close();
});

for(const outcome of ['before timeout','after timeout','rejection']) test(`explicit reconcile fences pending target and release: ACK ${outcome}`,async t=>{
  const h=holdAfter('grab.target'),f=await fixture(t,h.wrap);
  await f.begin();await f.begin('touch','other','touch');f.offer();await h.ready.promise;f.offer('hand','relic',2);
  assert.equal(f.host.state('hand').controller.pendingTargetSeq,2);
  const recovery=f.host.reconcile('hand');
  assert.equal(f.host.state('hand').fenced,true);assert.equal(f.host.state('hand').controller.pendingTargetSeq,null);
  await recovery;const commands=f.sent.length;
  assert.equal(f.host.state('hand').phase,'reconciled');assert.ok(f.a.inspectLease('root','other'));
  if(outcome==='after timeout'){f.clock.run(101);await turn();}
  if(outcome==='rejection')h.held.reject(null);else h.held.resolve(h.receipt);
  await until(()=>!f.host.state('hand').controller.inFlight);await turn();f.clock.run();await turn();
  assert.equal(f.sent.length,commands);assert.equal(f.reconciles.length,1);
  assert.equal(f.host.state('hand').phase,'reconciled');assert.equal(f.host.offer('hand',f.entity('relic'),f.clock.time),false);
  if(outcome!=='rejection'){
    const receipt=f.receipts.find(r=>r.command.kind==='grab.target');assert.ok(receipt);
    assert.equal(receipt.receipt.status,'accepted');assert.equal(receipt.late,outcome==='after timeout');
  }
  assert.equal(f.offer('touch','other',9),true);await f.finish(f.host.end('touch','pointerup'));
  assert.equal(f.a.inspectLease('root','other'),null);await f.host.close();
});

test('failed explicit reconciliation still fences late ACK and can be retried without replay',async t=>{
  let failing=true;const h=holdAfter('grab.target');
  const f=await fixture(t,p=>h.wrap({...p,reconcileLease:e=>failing?Promise.reject(Error('offline')):p.reconcileLease(e)}));
  await f.begin();f.offer();await h.ready.promise;f.offer('hand','relic',2);
  await assert.rejects(f.host.reconcile('hand'),/offline/);
  h.held.resolve(h.receipt);await until(()=>!f.host.state('hand').controller.inFlight);
  f.clock.run();await turn();assert.equal(f.sent.filter(c=>c.kind==='grab.target').length,1);
  assert.equal(f.sent.some(c=>c.kind==='grab.end'),false);assert.equal(f.host.state('hand').cleanupConfirmed,false);
  failing=false;await f.host.reconcile('hand');assert.equal(f.a.inspectLease('root','relic'),null);
  await f.host.close();
});

for(const operation of ['cancel','end','close']) test(`${operation} during acquisition awaits actual cleanup, never just the cancellation flag`,async t=>{
  const gate=deferred();let send;
  const f=await fixture(t,p=>({...p,submit:c=>{send=()=>p.submit(c).then(gate.resolve,gate.reject);return gate.promise;}}));
  const begun=f.begin();const checked=assert.rejects(begun,e=>e.code==='ACQUIRE_CANCELLED');let settled=false;
  const stopped=(operation==='close'?f.host.close():f.host[operation]('hand','cancel')).then(()=>{settled=true;});
  await turn();assert.equal(settled,false);send();await checked;await stopped;
  assert.equal(f.host.state('hand').controller,null);assert.equal(f.host.state('hand').cleanupConfirmed,true);
  assert.equal(f.a.inspectLease('root','relic'),null);assert.equal(f.reconciles.length,1);
});

for(const failure of ['hung ACK','lost ACK']) test(`bounded acquisition with ${failure} inspects and cleans the accepted lease`,async t=>{
  const h=holdAfter('grab.begin'),f=await fixture(t,h.wrap);
  const begun=f.begin(),checked=assert.rejects(begun,e=>e.code==='ACQUIRE_UNCERTAIN');await h.ready.promise;
  const closed=f.host.close();assert.ok(f.a.inspectLease('root','relic'));
  if(failure==='hung ACK')f.clock.run(100);else h.held.reject(undefined);
  await checked;await closed;
  assert.equal(f.a.inspectLease('root','relic'),null);assert.equal(f.reconciles.length,1);
  assert.equal(f.host.state('hand').controller,null);assert.equal(f.host.state('hand').phase,'reconciled');
  assert.equal(f.host.state('hand').cleanupConfirmed,true);
  if(failure==='hung ACK'){
    h.held.resolve(h.receipt);await until(()=>f.receipts.some(r=>r.late));
    assert.equal(f.reconciles.length,1);assert.equal(f.host.state('hand').controller,null);
  }
});

test('close reports unknown acquisition; late accepted reply cleans it without resurrecting input',async t=>{
  const gate=deferred();let send;
  const f=await fixture(t,p=>({...p,inspectLease:undefined,submit:c=>{send=()=>p.submit(c).then(gate.resolve,gate.reject);return gate.promise;}}));
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');
  const closed=assert.rejects(f.host.close(),e=>e.code==='CLOSE_REQUIRES_RECONCILIATION');
  f.clock.run(100);await begun;await closed;
  assert.equal(f.host.state('hand').phase,'blocked');assert.equal(f.host.state('hand').cleanupConfirmed,false);
  assert.equal(f.host.state('hand').acquisitionPending,true);
  send();await until(()=>f.host.state('hand').cleanupConfirmed);
  assert.equal(f.a.inspectLease('root','relic'),null);assert.equal(f.host.state('hand').controller,null);
  assert.equal(f.host.state('hand').phase,'reconciled');assert.equal(f.receipts[0].late,true);
  assert.deepEqual(f.sent.map(c=>c.kind),['grab.begin']);await f.host.close();
});

test('null lease inspection cannot falsely confirm a transport-delayed acquisition',async t=>{
  const gate=deferred();let send;
  const f=await fixture(t,p=>({...p,submit:c=>{send=()=>p.submit(c).then(gate.resolve,gate.reject);return gate.promise;}}));
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');
  const cancelled=assert.rejects(f.host.cancel('hand'),e=>e.code==='ACQUIRE_CLEANUP_UNCONFIRMED');
  f.clock.run(100);await begun;await cancelled;assert.equal(f.host.state('hand').cleanupConfirmed,false);
  send();await until(()=>f.host.state('hand').cleanupConfirmed);assert.equal(f.a.inspectLease('root','relic'),null);
});

test('timed-out acquisition is isolated from the other source and its late receipt cannot clear a replacement',async t=>{
  const h=holdAfter('grab.begin'),f=await fixture(t,h.wrap);
  await f.begin('touch','other','touch');
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');await h.ready.promise;
  const stopped=f.host.cancel('hand');f.clock.run(100);await begun;await stopped;
  assert.equal(f.host.state('touch').phase,'active');assert.ok(f.a.inspectLease('root','other'));
  const b=f.world.attach({actorId:'B'});await b.open();
  const replacement=await b.submit({schema:'vivo.command/1',id:'replacement',worldId:'lifecycle.world',spaceId:'root',
    kind:'grab.begin',expectedRevision:7,payload:{entityId:'relic',source:'touch',inputEpoch:1}});
  h.held.resolve(h.receipt);await until(()=>f.receipts.some(r=>r.late));
  assert.equal(b.inspectLease('root','relic').id,replacement.result.leaseId);assert.equal(f.reconciles.length,1);
  await f.finish(f.host.end('touch','pointerup'));await f.host.close();await b.close();
});

test('hung acquisition cleanup is bounded; a later verified cleanup changes uncertainty to reconciled',async t=>{
  const h=holdAfter('grab.begin'),cleanup=deferred(),requested=deferred();let finish;
  const f=await fixture(t,p=>h.wrap({...p,reconcileLease:e=>{finish=()=>p.reconcileLease(e).then(cleanup.resolve,cleanup.reject);requested.resolve();return cleanup.promise;}}));
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');await h.ready.promise;
  const closed=assert.rejects(f.host.close(),e=>e.code==='CLOSE_REQUIRES_RECONCILIATION');
  f.clock.run(100);await requested.promise;f.clock.run(100);await begun;await closed;
  assert.equal(f.host.state('hand').phase,'blocked');assert.equal(f.host.state('hand').cleanupConfirmed,false);
  assert.ok(f.a.inspectLease('root','relic'));finish();await until(()=>f.host.state('hand').cleanupConfirmed);
  assert.equal(f.a.inspectLease('root','relic'),null);await f.host.close();
});

test('late authoritative acquisition rejection resolves uncertainty without touching another owner',async t=>{
  const h=holdAfter('grab.begin'),f=await fixture(t,p=>h.wrap({...p,inspectLease:undefined}));
  const b=f.world.attach({actorId:'B'});await b.open();
  const held=await b.submit({schema:'vivo.command/1',id:'held',worldId:'lifecycle.world',spaceId:'root',kind:'grab.begin',
    expectedRevision:7,payload:{entityId:'relic',source:'touch',inputEpoch:1}});
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');await h.ready.promise;
  f.clock.run(100);await begun;await assert.rejects(f.host.close(),e=>e.code==='CLOSE_REQUIRES_RECONCILIATION');
  h.held.resolve(h.receipt);await until(()=>f.host.state('hand').cleanupConfirmed);
  assert.equal(f.receipts[0].receipt.status,'rejected');assert.equal(f.reconciles.length,0);
  assert.equal(b.inspectLease('root','relic').id,held.result.leaseId);await f.host.close();await b.close();
});

for(const option of ['requestTimeoutMs','acquisitionTimeoutMs','cleanupTimeoutMs']) test(`host rejects an unbounded ${option}`,async()=>{
  const w=await LocalLeaseWorld.create({snapshot:seed()});
  await assert.rejects(GripHost.open(w.attach(),{[option]:Infinity}),e=>e.code==='INVALID_TIMING_BUDGET');
});

test('repeated close/cancel share normal cancellation and drain all controller timers',async t=>{
  const h=holdAfter('grab.target'),f=await fixture(t,h.wrap);
  await f.begin();f.offer();await h.ready.promise;f.offer('hand','relic',2);
  const operations=Promise.all([f.host.cancel('hand'),f.host.close(),f.host.close(),f.host.cancel('hand')]);
  h.held.resolve(h.receipt);await f.finish(operations);await turn();f.clock.run();await turn();
  assert.equal(f.sent.filter(c=>c.kind==='grab.end').length,1);assert.equal(f.reconciles.length,0);
  assert.equal(f.clock.timers.size,0);const count=f.sent.length;
  await f.host.close();await f.host.cancel('hand');assert.equal(f.sent.length,count);
});

test('hung explicit reconciliation never becomes success, fences late input and allows verified retry',async t=>{
  const h=holdAfter('grab.target'),started=deferred();let hung=true;
  const f=await fixture(t,p=>h.wrap({...p,reconcileLease:e=>{
    if(hung){started.resolve();return new Promise(()=>{});}return p.reconcileLease(e);
  }}));
  await f.begin();f.offer();await h.ready.promise;f.offer('hand','relic',2);
  const recovery=assert.rejects(f.host.reconcile('hand'),e=>e.code==='RECONCILIATION_UNCONFIRMED');
  await started.promise;f.clock.run(100);await recovery;
  assert.equal(f.host.state('hand').cleanupConfirmed,false);assert.equal(f.host.state('hand').phase,'blocked');
  h.held.resolve(h.receipt);await turn();f.clock.run();await turn();
  assert.equal(f.sent.filter(c=>c.kind==='grab.target').length,1);assert.equal(f.sent.some(c=>c.kind==='grab.end'),false);
  // A late outcome may start a bounded cleanup attempt; close joins it rather than guessing success.
  const closed=assert.rejects(f.host.close(),e=>e.code==='CLOSE_REQUIRES_RECONCILIATION');
  await turn();f.clock.run(100);await closed;assert.ok(f.a.inspectLease('root','relic'));
  hung=false;await f.host.reconcile('hand');await f.host.close();await turn();f.clock.run();await turn();
  assert.equal(f.a.inspectLease('root','relic'),null);assert.equal(f.clock.timers.size,0);
});

test('repeated unknown acquisition cleanup remains uncertain until late authoritative evidence',async t=>{
  const gate=deferred(),f=await fixture(t,p=>({...p,inspectLease:undefined,submit:()=>gate.promise}));
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');f.clock.run(100);await begun;
  for(let i=0;i<2;i++) {
    await assert.rejects(f.host.close(),e=>e.code==='CLOSE_REQUIRES_RECONCILIATION');
    await assert.rejects(f.host.cancel('hand'),e=>e.code==='ACQUIRE_CLEANUP_UNCONFIRMED');
  }
  assert.equal(f.clock.timers.size,0);assert.equal(f.host.state('hand').cleanupConfirmed,false);
  gate.reject(false);await until(()=>!f.host.state('hand').acquisitionPending);
  await assert.rejects(f.host.close(),e=>e.code==='CLOSE_REQUIRES_RECONCILIATION');
});

test('async owner-scoped inspection is supported for an accepted acquisition with lost ACK',async t=>{
  const h=holdAfter('grab.begin'),f=await fixture(t,p=>h.wrap({...p,inspectLease:async(...args)=>p.inspectLease(...args)}));
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');await h.ready.promise;
  const stopped=f.host.cancel('hand');h.held.reject('lost ACK');await begun;await stopped;
  assert.equal(f.host.state('hand').cleanupConfirmed,true);assert.equal(f.a.inspectLease('root','relic'),null);
});

test('hung owner inspection is bounded and cannot declare acquisition cleanup',async t=>{
  const h=holdAfter('grab.begin'),inspection=deferred();
  const f=await fixture(t,p=>h.wrap({...p,inspectLease:()=>{inspection.resolve();return new Promise(()=>{});}}));
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');await h.ready.promise;
  const stopped=assert.rejects(f.host.close(),e=>e.code==='CLOSE_REQUIRES_RECONCILIATION');
  f.clock.run(100);await inspection.promise;f.clock.run(100);await begun;await stopped;
  assert.equal(f.host.state('hand').cleanupConfirmed,false);assert.ok(f.a.inspectLease('root','relic'));
  h.held.resolve(h.receipt);await until(()=>f.host.state('hand').cleanupConfirmed);
  assert.equal(f.a.inspectLease('root','relic'),null);await f.host.close();
});

test('cancelled acquisition runs one bounded cleanup attempt when accepted ACK arrives',async t=>{
  const h=holdAfter('grab.begin'),requested=deferred();let attempts=0;
  const f=await fixture(t,p=>h.wrap({...p,reconcileLease:()=>{attempts++;requested.resolve();return new Promise(()=>{});}}));
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_CLEANUP_UNCONFIRMED');await h.ready.promise;
  const stopped=assert.rejects(f.host.cancel('hand'),e=>e.code==='ACQUIRE_CLEANUP_UNCONFIRMED');
  h.held.resolve(h.receipt);await requested.promise;f.clock.run(100);await begun;await stopped;
  assert.equal(attempts,1);assert.equal(f.host.state('hand').cleanupConfirmed,false);
});

for(const released of [false,1,'true']) test(`unconfirmed reconciliation flag ${JSON.stringify(released)} cannot close a held lease`,async t=>{
  const f=await fixture(t,p=>({...p,reconcileLease:async()=>({released,snapshot:p.getSnapshot()})}));
  await f.begin();await assert.rejects(f.host.reconcile('hand'),e=>e.code==='RECONCILIATION_UNCONFIRMED');
  assert.equal(f.host.state('hand').cleanupConfirmed,false);assert.ok(f.a.inspectLease('root','relic'));
});

const observerMutations=[
  ['status',event=>{event.receipt.status='rejected';event.receipt.code='UI_NORMALIZED';}],
  ['nested result',event=>{
    event.receipt.result.leaseId='observer.fake';event.receipt.result.leaseMs=0;
    event.receipt.result.entity.id='other';event.receipt.result.entity.q[0]=99;
    event.receipt.result.entity.dimension=11;
  }],
  ['command identity',event=>{event.command.id='observer.command';event.command.payload.entityId='other';}],
];
for(const [name,mutate] of observerMutations) {
  test(`acquisition observer ${name} mutation cannot change acceptance or release ownership`,async t=>{
    const f=await fixture(t,p=>p,{onReceipt:(_key,event)=>{if(event.command.kind==='grab.begin')mutate(event);}});
    await f.begin();const lease=f.a.inspectLease('root','relic');assert.ok(lease);
    assert.equal(f.host.state('hand').phase,'active');assert.equal(f.host.state('hand').leaseId,lease.id);
    assert.equal(f.host.state('hand').cleanupConfirmed,false);
    assert.equal(f.offer(),true);await f.finish(f.host.close());
    assert.equal(f.a.inspectLease('root','relic'),null);assert.equal(f.host.state('hand').cleanupConfirmed,true);
    assert.equal(f.outcomes[0].receipt.status,'accepted');assert.equal(f.outcomes[0].receipt.result.entity.q[0],0);
    assert.equal(f.reconciles.length,0);assert.equal(f.receipts[0].receipt.status,'accepted');
  });
  test(`late acquisition observer ${name} mutation cannot falsify cleanup`,async t=>{
    const h=holdAfter('grab.begin'),f=await fixture(t,p=>h.wrap({...p,inspectLease:undefined}),
      {onReceipt:(_key,event)=>{if(event.command.kind==='grab.begin')mutate(event);}});
    const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');await h.ready.promise;
    const closed=assert.rejects(f.host.close(),e=>e.code==='CLOSE_REQUIRES_RECONCILIATION');
    f.clock.run(100);await begun;await closed;assert.ok(f.a.inspectLease('root','relic'));
    h.held.resolve(h.receipt);await until(()=>f.host.state('hand').cleanupConfirmed);
    assert.equal(f.a.inspectLease('root','relic'),null);assert.equal(f.host.state('hand').controller,null);
    assert.equal(f.host.state('hand').phase,'reconciled');assert.equal(f.reconciles.length,1);
    assert.equal(f.reconciles[0].leaseId,h.receipt.result.leaseId);
    assert.equal(f.receipts[0].receipt.status,'accepted');assert.equal(f.receipts[0].late,true);await f.host.close();
  });
}

test('observer cannot turn an authoritative rejected acquisition into a controller or release another owner',async t=>{
  let observerCalls=0;
  const f=await fixture(t,p=>p,{onReceipt:(_key,event)=>{
    observerCalls++;event.receipt.status='accepted';event.receipt.code='OK';
    event.receipt.result={leaseId:'observer.fake',leaseMs:3000,entity:f.entity('relic')};
  }});
  const b=f.world.attach({actorId:'B'});await b.open();
  const held=await b.submit({schema:'vivo.command/1',id:'owner',worldId:'lifecycle.world',spaceId:'root',kind:'grab.begin',
    expectedRevision:7,payload:{entityId:'relic',source:'touch',inputEpoch:1}});
  await assert.rejects(f.begin(),e=>e.code==='LEASE_HELD');await f.host.close();
  assert.equal(observerCalls,1);assert.equal(f.host.state('hand').controller,null);assert.equal(f.reconciles.length,0);
  assert.equal(f.receipts[0].receipt.status,'rejected');assert.equal(b.inspectLease('root','relic').id,held.result.leaseId);
  await b.close();
});

test('asynchronous observer mutation and rejection cannot alter accepted acquisition evidence',async t=>{
  const observer=deferred();
  const f=await fixture(t,p=>p,{onReceipt:async(_key,event)=>{
    if(event.command.kind!=='grab.begin')return;
    await observer.promise;event.receipt.result.entity.q.fill(99);event.receipt.status='rejected';throw null;
  }});
  await f.begin();observer.resolve();await turn();
  assert.equal(f.host.state('hand').phase,'active');assert.equal(f.receipts[0].receipt.status,'accepted');
  assert.equal(f.offer(),true);await f.finish(f.host.close());assert.equal(f.a.inspectLease('root','relic'),null);
});

for(const settlement of ['null','rejected lookup','lookup timeout']) test(`late acquisition rejection wins over older ${settlement} inspection`,async t=>{
  const h=holdAfter('grab.begin'),inspecting=deferred(),inspection=deferred();
  const f=await fixture(t,p=>{
    const held=h.wrap(p);
    return {...held,submit:c=>c.payload.inputEpoch===1?held.submit(c):p.submit(c),
      inspectLease:()=>{inspecting.resolve();return inspection.promise;}};
  });
  const b=f.world.attach({actorId:'B'});await b.open();
  await b.submit({schema:'vivo.command/1',id:'holder',worldId:'lifecycle.world',spaceId:'root',kind:'grab.begin',
    expectedRevision:7,payload:{entityId:'relic',source:'touch',inputEpoch:1}});
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');await h.ready.promise;
  assert.equal(h.receipt.status,'rejected');f.clock.run(100);await inspecting.promise;
  h.held.resolve(h.receipt);await until(()=>f.host.state('hand').cleanupConfirmed);
  assert.equal(f.host.state('hand').phase,'closed');
  if(settlement==='null')inspection.resolve(null);
  else if(settlement==='rejected lookup')inspection.reject(Error('old lookup failure'));
  else f.clock.run(100);
  await begun;assert.equal(f.host.state('hand').phase,'closed');
  await b.close();await f.begin('hand','relic','hand',2);
  assert.equal(f.host.state('hand').phase,'active');await f.finish(f.host.close());
  assert.equal(f.a.inspectLease('root','relic'),null);
});

test('late accepted acquisition cleanup wins over an older negative inspection',async t=>{
  const h=holdAfter('grab.begin'),inspecting=deferred(),inspection=deferred();
  const f=await fixture(t,p=>h.wrap({...p,inspectLease:()=>{inspecting.resolve();return inspection.promise;}}));
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');await h.ready.promise;
  const closed=f.host.close();f.clock.run(100);await inspecting.promise;
  h.held.resolve(h.receipt);await until(()=>f.host.state('hand').cleanupConfirmed);
  inspection.resolve(null);await begun;await closed;
  assert.equal(f.host.state('hand').phase,'reconciled');assert.equal(f.reconciles.length,1);
  assert.equal(f.a.inspectLease('root','relic'),null);
});

test('older positive inspection cannot replace the lease identified by a late accepted receipt',async t=>{
  const h=holdAfter('grab.begin'),inspecting=deferred(),inspection=deferred(),cleanup=deferred(),cleaning=deferred();let release;
  const f=await fixture(t,p=>h.wrap({...p,inspectLease:()=>{inspecting.resolve();return inspection.promise;},
    reconcileLease:e=>{release=()=>p.reconcileLease(e).then(cleanup.resolve,cleanup.reject);cleaning.resolve();return cleanup.promise;}}));
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');await h.ready.promise;
  f.clock.run(100);await inspecting.promise;h.held.resolve(h.receipt);await cleaning.promise;
  inspection.resolve({id:'older.lookup',source:'hand',inputEpoch:1,spaceId:'root',entityId:'relic'});await turn();
  assert.equal(f.host.state('hand').leaseId,h.receipt.result.leaseId);
  release();await begun;assert.equal(f.reconciles.length,1);assert.equal(f.a.inspectLease('root','relic'),null);
  assert.equal(f.host.state('hand').leaseId,h.receipt.result.leaseId);await f.host.close();
});

for(const sharedHosts of [false,true]) test(`timed-out competing grab cannot release same-source/epoch owner across ${sharedHosts?'two hosts':'two keys'}`,async t=>{
  const held=deferred(),ready=deferred();let rejection,hold=false;
  const f=await fixture(t,p=>({...p,submit:async c=>{
    const r=await p.submit(c);
    if(hold&&c.kind==='grab.begin'){rejection=r;ready.resolve();return held.promise;}return r;
  }}));
  const left=sharedHosts?await GripHost.open(f.a,{now:()=>f.clock.time,setTimer:f.clock.set,clearTimer:f.clock.clear}):f.host;
  await left.begin('hand:left',{entity:f.entity('relic'),source:'hand',inputEpoch:1});
  const owner=f.a.inspectLease('root','relic');assert.ok(owner.acquireCommandId);hold=true;
  const begun=assert.rejects(f.begin('hand:right'),e=>e.code==='ACQUIRE_UNCERTAIN');await ready.promise;
  assert.equal(rejection.code,'LEASE_HELD');f.clock.run(100);await begun;
  assert.equal(f.reconciles.length,0);assert.equal(f.a.inspectLease('root','relic').id,owner.id);
  assert.equal(f.host.state('hand:right').cleanupConfirmed,false);assert.equal(f.host.state('hand:right').phase,'blocked');
  assert.equal(left.state('hand:left').phase,'active');
  held.resolve(rejection);await until(()=>f.host.state('hand:right').cleanupConfirmed);
  assert.equal(f.host.state('hand:right').phase,'closed');assert.equal(f.a.inspectLease('root','relic').id,owner.id);
  await f.finish(left.close());await f.host.close();assert.equal(f.a.inspectLease('root','relic'),null);
});

test('two same-source/epoch acquisition ACKs withheld still require exact command ownership',async t=>{
  const gates=[deferred(),deferred()],ready=[deferred(),deferred()],replies=[];let count=0;
  const f=await fixture(t,p=>({...p,submit:async c=>{
    if(c.kind!=='grab.begin')return p.submit(c);
    const index=count++,r=await p.submit(c);replies[index]=r;ready[index].resolve();return gates[index].promise;
  }}));
  const left=assert.rejects(f.begin('hand:left'),e=>e.code==='ACQUIRE_UNCERTAIN');await ready[0].promise;
  const right=assert.rejects(f.begin('hand:right'),e=>e.code==='ACQUIRE_UNCERTAIN');await ready[1].promise;
  assert.equal(replies[0].status,'accepted');assert.equal(replies[1].code,'LEASE_HELD');
  const owner=f.a.inspectLease('root','relic');
  // Timeout only the second acquisition first. Timer IDs reflect insertion order,
  // but advancing the first deadline too would hide the wrong-owner deletion.
  const secondTimer=[...f.clock.timers].at(-1);f.clock.timers.delete(secondTimer[0]);secondTimer[1].fn();await right;
  assert.equal(f.reconciles.length,0);assert.equal(f.a.inspectLease('root','relic').id,owner.id);
  assert.equal(f.host.state('hand:right').cleanupConfirmed,false);
  f.clock.run(100);await left;assert.equal(f.reconciles.length,1);
  assert.equal(f.reconciles[0].leaseId,owner.id);assert.equal(f.a.inspectLease('root','relic'),null);
  gates[0].resolve(replies[0]);gates[1].resolve(replies[1]);await until(()=>f.host.state('hand:right').cleanupConfirmed);
  await f.host.close();assert.equal(f.reconciles.length,1);
});

for(const correlation of ['missing','different']) test(`${correlation} inspection command correlation stays uncertain until a valid receipt`,async t=>{
  const h=holdAfter('grab.begin');
  const f=await fixture(t,p=>h.wrap({...p,inspectLease:(...args)=>{
    const lease=p.inspectLease(...args);
    if(correlation==='missing')delete lease.acquireCommandId;else lease.acquireCommandId='different.command';
    return lease;
  }}));
  const begun=assert.rejects(f.begin(),e=>e.code==='ACQUIRE_UNCERTAIN');await h.ready.promise;
  const closed=assert.rejects(f.host.close(),e=>e.code==='CLOSE_REQUIRES_RECONCILIATION');
  f.clock.run(100);await begun;await closed;
  assert.equal(f.reconciles.length,0);assert.ok(f.a.inspectLease('root','relic'));assert.equal(f.host.state('hand').cleanupConfirmed,false);
  h.held.resolve(h.receipt);await until(()=>f.host.state('hand').cleanupConfirmed);
  assert.equal(f.a.inspectLease('root','relic'),null);assert.equal(f.reconciles.length,1);await f.host.close();
});

test('inspection correlation is detached from authority storage and cannot rewrite live ownership',async t=>{
  const f=await fixture(t);await f.begin();
  const original=f.a.inspectLease('root','relic'),inspection=f.a.inspectLease('root','relic');
  inspection.acquireCommandId='changed.command';inspection.actorId='other';inspection.id='changed.lease';
  inspection.source='touch';inspection.inputEpoch=999;
  assert.deepEqual(f.a.inspectLease('root','relic'),original);
  assert.equal(original.acquireCommandId,f.sent[0].id);assert.equal(original.actorId,'A');
  const other=f.world.attach({actorId:'A'});await other.open();assert.equal(other.inspectLease('root','relic'),null);
  await f.finish(f.host.close());await other.close();
});

test('restart accepts a legacy checkpoint without acquisition correlation and still drops old capabilities',async t=>{
  const f=await fixture(t);await f.begin();
  const record=f.world.checkpoint();
  for(const lease of Object.values(record.state.leases))delete lease.acquireCommandId;
  // Reproduce the existing private persisted codec, with the pre-extension lease shape.
  const hash=async value=>{
    const canonical=JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
      ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
    return Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical))).toString('hex');
  };
  record.state.snapshot.stateHash=await hash({snapshot:{...record.state.snapshot,stateHash:null},leases:record.state.leases,eyes:record.state.eyes});
  record.digest=await hash(record.state);
  let saved=structuredClone(record);
  const restored=await LocalLeaseWorld.create({now:()=>f.clock.time,store:{load:async()=>structuredClone(saved),
    compareAndSwap:async(expected,next)=>{assert.equal(expected,saved.digest);saved=structuredClone(next);}}});
  assert.equal(restored.constraints().length,0);assert.equal(Object.keys(restored.checkpoint().state.leases).length,0);
  assert.equal(restored.checkpoint().state.events.at(-1).kind,'restart-release');
  assert.deepEqual(restored.snapshot().spaces.root.entities,f.a.getSnapshot().spaces.root.entities);
  const a=restored.attach({actorId:'restored'});await a.open();
  const command={schema:'vivo.command/1',id:'new.after.restart',worldId:'lifecycle.world',spaceId:'root',kind:'grab.begin',
    expectedRevision:7,payload:{entityId:'relic',source:'hand',inputEpoch:1}};
  const r=await a.submit(command);assert.equal(r.status,'accepted');assert.equal(a.inspectLease('root','relic').acquireCommandId,command.id);
  await a.close();await f.finish(f.host.close());
});
