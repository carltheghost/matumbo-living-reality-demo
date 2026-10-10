import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalLeaseWorld} from '../../web/authority/lease-authority.mjs';
import {GripHost} from '../../web/authority/grip-host.mjs';

const frame=()=>({spaceId:'root',chart:'flat',dimension:4,q:[0,0,0,0]});
function seed() {
  const entity=id=>({...frame(),id,v:[0,0,0,0],revision:7,materialProfile:'elastic',
    fieldMembership:['field0'],innerSpaceId:null,lineage:[]});
  return {schema:'vivo.snapshot/1',worldId:'final.world',authorityId:'final.authority',acceptedSequence:0,
    simulationTime:8,rootSpaceId:'root',stateHash:'0'.repeat(64),spaces:{root:{id:'root',dimension:4,
    intrinsicDimension:4,atlasId:'flat',metricId:'euclidean',topologyId:'open',law:{id:'pending',version:'0'},
    modelHashes:[],field:{codec:'pending',handle:'field0',hash:'0'.repeat(64)},
    entities:{relic:entity('relic'),other:entity('other')}}}};
}
async function fixture(t, override=x=>x) {
  const w=await LocalLeaseWorld.create({snapshot:seed(),leaseMs:3000});
  const a=w.attach({actorId:'A'}),sent=[],previews=[],timers=new Set();
  const ports=override({...a,submit:async c=>{sent.push(c);return a.submit(c);}});
  const host=await GripHost.open(ports,{now:()=>200,
    setTimer:(fn,ms)=>{let id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;},
    clearTimer:id=>{timers.delete(id);clearTimeout(id);},onPreview:(key,value)=>previews.push({key,value})});
  t.after(async()=>{await host.close().catch(()=>{});for(const id of timers)clearTimeout(id);});
  const e=a.getSnapshot().spaces.root.entities.relic;
  await host.begin('hand:left',{entity:e,source:'hand',inputEpoch:1});
  return {w,a,host,e,sent,previews,timers};
}
// Release schedules one final bookkeeping task; let that task finish before
// checking timer cleanup. This is not a frame-age refresh.
const drained=()=>new Promise(resolve=>setTimeout(resolve,5));
const invalid=[
  ['missing frame',()=>({observedAt:200})],
  ['NaN coordinate',()=>({frame:{...frame(),q:[0,0,NaN,0]},observedAt:200})],
  ['sparse coordinate array',()=>({frame:{...frame(),q:new Array(4)},observedAt:200})],
  ['wrong coordinate count',()=>({frame:{...frame(),q:[0,0,0]},observedAt:200})],
  ['wrong space',()=>({frame:{...frame(),spaceId:'elsewhere'},observedAt:200})],
  ['wrong chart',()=>({frame:{...frame(),chart:'elsewhere'},observedAt:200})],
  ['wrong dimension',()=>({frame:{...frame(),dimension:3,q:[0,0,0]},observedAt:200})],
  ['expired original capture',()=>({frame:frame(),observedAt:0})],
  ['missing capture timestamp',()=>({frame:frame()})],
  ['throwing frame getter',()=>Object.defineProperty({},'frame',{get(){throw null;}})],
  ['throwing timestamp getter',()=>Object.defineProperty({frame:frame()},'observedAt',{get(){throw Object.create(null);}})],
  ['false final sample',()=>false],
];
for(const [name,make] of invalid) test(`host final sample cleanup: ${name}`,async t=>{
  const f=await fixture(t);
  await assert.rejects(f.host.end('hand:left','pointerup',make()),e=>e?.code==='FINAL_SAMPLE_REJECTED');
  await drained();
  assert.ok(['closed','reconciled'].includes(f.host.state('hand:left').phase));
  assert.equal(f.host.state('hand:left').pendingRenewal,false);assert.equal(f.timers.size,0);
  assert.equal(f.a.inspectLease('root','relic'),null);assert.equal(f.w.constraints().length,0);
  assert.equal(f.host.offer('hand:left',frame(),200),false);
  assert.equal(f.previews.at(-1).key,'hand:left');assert.equal(f.previews.at(-1).value,null);
  assert.deepEqual(f.sent.map(c=>c.kind),['grab.begin','grab.end']);
  assert.deepEqual(f.a.getSnapshot().spaces.root.entities.relic,f.e);
  assert.equal(f.a.getSnapshot().simulationTime,8);
});

test('host final cleanup is source-specific; touch stays held after malformed hand sample',async t=>{
  const f=await fixture(t),other=f.a.getSnapshot().spaces.root.entities.other;
  await f.host.begin('pointer:4',{entity:other,source:'touch',inputEpoch:1});
  await assert.rejects(f.host.end('hand:left','pinch-open',{}),e=>e?.code==='FINAL_SAMPLE_REJECTED');
  assert.equal(f.a.inspectLease('root','relic'),null);assert.ok(f.a.inspectLease('root','other'));
  assert.equal(f.host.state('pointer:4').phase,'active');
  assert.equal(f.previews.some(p=>p.key==='pointer:4'&&p.value===null),false);
  await f.host.end('pointer:4','pointerup');await drained();assert.equal(f.timers.size,0);
});

test('valid final sample retains capture time and reaches authority before grab.end',async t=>{
  const f=await fixture(t),final={frame:{...frame(),q:[0,0,0,9]},observedAt:195};
  await f.host.end('hand:left','pinch-open',final);await drained();
  assert.deepEqual(f.sent.map(c=>c.kind),['grab.begin','grab.target','grab.end']);
  assert.equal(f.sent[1].payload.sampleAgeMs,5);assert.equal(final.observedAt,195);
  assert.deepEqual(f.sent[1].payload.q,[0,0,0,9]);assert.equal(f.timers.size,0);
  assert.equal(f.a.inspectLease('root','relic'),null);
});

test('malformed final sample cannot claim cleanup if transport and reconciliation both fail',async t=>{
  let failing=true;
  const f=await fixture(t,p=>({...p,
    submit:c=>c.kind==='grab.end'&&failing?Promise.reject(Error('lost release')):p.submit(c),
    reconcileLease:e=>failing?Promise.reject(Error('snapshot unavailable')):p.reconcileLease(e)}));
  await assert.rejects(f.host.end('hand:left','pinch-open',{}),e=>e?.code==='FINAL_SAMPLE_CLEANUP_UNCONFIRMED');
  await drained();
  assert.equal(f.host.state('hand:left').phase,'blocked');assert.equal(f.host.state('hand:left').pendingRenewal,false);
  assert.ok(f.a.inspectLease('root','relic'));assert.equal(f.host.offer('hand:left',frame(),200),false);
  assert.equal(f.timers.size,0);failing=false;
  await f.host.reconcile('hand:left');assert.equal(f.a.inspectLease('root','relic'),null);
});

test('end without a final sample retains the ordinary release path',async t=>{
  const f=await fixture(t);await f.host.end('hand:left','pinch-open');await drained();
  assert.deepEqual(f.sent.map(c=>c.kind),['grab.begin','grab.end']);
  assert.equal(f.host.state('hand:left').phase,'closed');assert.equal(f.timers.size,0);
});
