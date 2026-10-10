import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalLeaseWorld} from '../../web/authority/lease-authority.mjs';
import {GripController} from '../../web/input/controller.mjs';
import {validateReceipt} from '../../contracts/validate.mjs';

// Real authority and exact pinned worker controller; no authority receipt stub.
async function fixture(d=4, nullRelease=false) {
  const e={id:'relic',spaceId:'root',chart:'cartesian',dimension:d,q:Array(d).fill(0),
    v:Array(d).fill(0),revision:7,materialProfile:'elastic',fieldMembership:['field0'],
    innerSpaceId:null,lineage:[]};
  const world=await LocalLeaseWorld.create({snapshot:{schema:'vivo.snapshot/1',worldId:'release.world',
    authorityId:'release.authority',acceptedSequence:0,simulationTime:9,rootSpaceId:'root',
    stateHash:'0'.repeat(64),spaces:{root:{id:'root',dimension:d,intrinsicDimension:d,
      atlasId:'flat',metricId:'euclidean',topologyId:'open',law:{id:'pending',version:'0'},
      modelHashes:[],field:{codec:'pending',handle:'field0',hash:'0'.repeat(64)},entities:{relic:e}}}}});
  const a=world.attach({actorId:'A'}),session=await a.open();
  const begin=await a.submit({schema:'vivo.command/1',id:'release.begin',worldId:session.worldId,
    spaceId:'root',kind:'grab.begin',expectedRevision:e.revision,
    payload:{entityId:e.id,source:'touch',inputEpoch:1}});
  assert.equal(begin.status,'accepted');
  const sent=[],receipts=[],reconciles=[];
  const c=new GripController({session,acceptedSequence:begin.acceptedSequence,
    now:()=>100,idPrefix:'release.input',onReconcile:r=>reconciles.push(r),
    submit:async command=>{
      sent.push(command);const actual=await a.submit(command);receipts.push(actual);
      // Negative fixture is deliberately corrupted AFTER the real authority commits.
      return nullRelease && command.kind==='grab.end'?{...actual,entityRevision:null}:actual;
    }});
  c.begin({entity:begin.result.entity,leaseId:begin.result.leaseId,source:'touch',inputEpoch:1});
  return {world,a,c,e,sent,receipts,reconciles,begin};
}

for(const [d,move] of [[4,false],[4,true],[11,true]]) {
  test(`accepted grab.end retains numeric entity revision: ${d}D, target=${move}`,async()=>{
    const f=await fixture(d);
    try {
      if(move){const q=Array(d).fill(0);q[d-1]=3;assert.equal(f.c.offer({...f.e,q},100),true);}
      await f.c.end('pointerup');
      assert.equal(f.c.state.phase,'closed');assert.equal(f.reconciles.length,0);
      const r=f.receipts.at(-1),command=f.sent.at(-1),snapshot=f.a.getSnapshot();
      validateReceipt(r);assert.equal(command.kind,'grab.end');assert.equal(r.status,'accepted');
      assert.equal(r.result.released,true);assert.equal(r.result.leaseId,f.begin.result.leaseId);
      assert.equal(Number.isSafeInteger(r.entityRevision),true);
      assert.equal(r.entityRevision,snapshot.spaces.root.entities.relic.revision);
      assert.equal(r.entityRevision,7);assert.equal(f.c.state.entityRevision,7);
      assert.equal(r.acceptedSequence,snapshot.acceptedSequence);
      assert.ok(r.acceptedSequence>f.begin.acceptedSequence);
      assert.equal(f.c.state.acceptedSequence,r.acceptedSequence);
      assert.equal(r.stateHash,snapshot.stateHash);
      assert.equal(f.a.inspectLease('root','relic'),null);assert.equal(f.world.constraints().length,0);
      assert.deepEqual(snapshot.spaces.root.entities.relic,f.e);
      assert.equal(snapshot.simulationTime,9); // A constraint is not a material step.
      assert.deepEqual(f.sent.map(c=>c.kind),move?['grab.target','grab.end']:['grab.end']);
      if(move)assert.equal(f.sent[0].payload.q[d-1],3);
      // Repeated command returns the recorded receipt without advancing history.
      assert.deepEqual(await f.a.submit(command),r);
      assert.equal(f.a.getSnapshot().acceptedSequence,r.acceptedSequence);
    } finally {await f.a.close();}
  });
}

test('null accepted release is schema-valid but not our grip convention; reconcile, never fake close',async()=>{
  const f=await fixture(4,true);
  try {
    await assert.rejects(f.c.end('pointerup'),e=>e.code==='STALE_RECEIPT');
    const real=f.receipts.at(-1);assert.equal(real.entityRevision,7);
    validateReceipt({...real,entityRevision:null});
    assert.equal(f.c.state.phase,'blocked');assert.equal(f.reconciles.length,1);
    assert.equal(f.reconciles[0].reason,'STALE_RECEIPT');assert.equal(f.sent.length,1);
    assert.equal(f.a.inspectLease('root','relic'),null); // Actual authority already released.
    const recovered=await f.a.reconcileLease(f.reconciles[0]);
    assert.equal(recovered.released,true);assert.equal(recovered.snapshot.spaces.root.entities.relic.revision,7);
    assert.equal(f.c.state.phase,'blocked'); // Reconciliation is not automatic reactivation.
  } finally {await f.a.close();}
});
