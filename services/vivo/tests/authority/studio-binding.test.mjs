import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalLeaseWorld,MemoryAuthorityStore} from '../../web/authority/lease-authority.mjs';
import {offlineForkCommand} from '../../web/application/offline-branch.mjs';
import {studioCommitCommand,studioTransformCommand} from '../../contracts/studio-binding.mjs';
import {workshopSeed,entryView} from '../../server/application/seed.mjs';

test('accepted Studio binding replicates, persists, and preserves independent Eyes',async()=>{
  const store=new MemoryAuthorityStore(),seed=workshopSeed(),world=await LocalLeaseWorld.create({snapshot:seed,store});
  const one=world.attach({actorId:'local.one'}),two=world.attach({actorId:'local.two'});await one.open();await two.open();
  await one.registerEye('main',entryView());await two.registerEye('main',entryView());
  const beforeEntity=one.getSnapshot().spaces.root.entities.relic;
  await two.moveEye('main',{...entryView(),q:[.2,.3,.4,.5],slice:{x4:.5}},0);
  assert.deepEqual(one.getEye('main').q,[0,0,0,0]);assert.deepEqual(two.getEye('main').q,[.2,.3,.4,.5]);
  const current=one.getSnapshot(),command=studioTransformCommand(current,[2.2,-1.4,.8,.1],{commandId:'studio.accept.1'});
  const receipt=await one.submit(command);assert.equal(receipt.status,'accepted');assert.equal(receipt.code,'OK');
  const accepted=two.getSnapshot(),binding=accepted.studioBindings['studio.node.echo'];
  assert.deepEqual(binding.q,[2.2,-1.4,.8,.1]);assert.equal(binding.bindingRevision,1);assert.equal(binding.acceptedSequence,accepted.acceptedSequence);
  assert.deepEqual(accepted.spaces.root.entities.relic,beforeEntity,'projection updates do not fabricate material/entity motion');
  assert.deepEqual(two.getEye('main').q,[.2,.3,.4,.5]);assert.deepEqual(one.getEye('main').q,[0,0,0,0]);
  const stale=await one.submit(studioTransformCommand(accepted,[3,3,3,3],{commandId:'studio.stale',expectedRevision:0}));
  assert.equal(stale.status,'rejected');assert.equal(stale.code,'STALE_WORLD');
  const restored=await LocalLeaseWorld.create({snapshot:workshopSeed(),store});
  assert.deepEqual(restored.snapshot().studioBindings['studio.node.echo'].q,[2.2,-1.4,.8,.1]);
  const fork=await one.submit(offlineForkCommand(restored.snapshot(),{newWorldId:'offline:studio:test',commandId:'fork.studio.test'}));
  assert.equal(fork.status,'accepted');assert.deepEqual(fork.result.snapshot.studioBindings['studio.node.echo'].q,[2.2,-1.4,.8,.1]);
  assert.equal(fork.result.snapshot.studioBindings['studio.node.echo'].bindingRevision,0);
  assert.equal(fork.result.snapshot.branch.parentWorldId,'vivo.local.workshop');
  await one.close();await two.close();
});

test('multiple selected bindings persist independently across nested navigation and offline provenance',async()=>{
  const store=new MemoryAuthorityStore(),seed=workshopSeed(),world=await LocalLeaseWorld.create({snapshot:seed,store});
  const one=world.attach({actorId:'local.one'}),two=world.attach({actorId:'local.two'});await one.open();await two.open();
  await one.registerEye('main',entryView());await two.registerEye('main',entryView());
  let snapshot=one.getSnapshot();
  for(const [bindingId,q] of [['studio.node.workpiece',[2,.7,.25,0]],['studio.node.portal',[1.8,-.15,.25,0]]]) {
    const binding=snapshot.studioBindings[bindingId];
    const receipt=await one.submit(studioTransformCommand(snapshot,q,{bindingId,metadata:binding.metadata,commandId:'studio.multi.'+bindingId,expectedRevision:snapshot.acceptedSequence}));
    assert.equal(receipt.status,'accepted');snapshot=one.getSnapshot();
  }
  assert.deepEqual(snapshot.studioBindings['studio.node.workpiece'].q,[2,.7,.25,0]);
  assert.deepEqual(snapshot.studioBindings['studio.node.portal'].q,[1.8,-.15,.25,0]);
  assert.deepEqual(snapshot.spaces.root.entities.workpiece.q,[.15,.75,.25,0]);
  assert.deepEqual(snapshot.spaces.root.entities.portal.q,[1.35,-.15,.25,0]);
  assert.deepEqual(two.getSnapshot().studioBindings,snapshot.studioBindings);
  const enter=await one.submit({schema:'vivo.command/1',id:'space.multi.enter',worldId:snapshot.worldId,spaceId:'root',kind:'space.enter',expectedRevision:snapshot.spaces.root.entities.portal.revision,
    payload:{portalEntityId:'portal',eyeId:'main'}});
  assert.equal(enter.status,'accepted');assert.equal(enter.result.eye.spaceId,'inner');assert.equal(two.getEye('main').spaceId,'root');snapshot=one.getSnapshot();
  await one.close();await two.close();
  const restored=await LocalLeaseWorld.create({snapshot:workshopSeed(),store});
  const resumed=restored.attach({actorId:'local.one'}),other=restored.attach({actorId:'local.two'});await resumed.open();await other.open();
  assert.equal(resumed.getEye('main').spaceId,'inner');assert.equal(other.getEye('main').spaceId,'root');
  assert.deepEqual(resumed.getSnapshot().studioBindings['studio.node.workpiece'].q,[2,.7,.25,0]);
  assert.deepEqual(resumed.getSnapshot().studioBindings['studio.node.portal'].q,[1.8,-.15,.25,0]);
  const parentBeforeFork=resumed.getSnapshot().acceptedSequence;
  const fork=await resumed.submit(offlineForkCommand(resumed.getSnapshot(),{newWorldId:'offline:studio:multi',commandId:'fork.multi'}));
  assert.equal(fork.status,'accepted');const branch=fork.result;
  assert.deepEqual(Object.keys(branch.snapshot.studioBindings),['studio.node.echo','studio.node.workpiece','studio.node.portal']);
  for(const binding of Object.values(branch.snapshot.studioBindings)) {assert.equal(binding.bindingRevision,0);assert.equal(binding.acceptedSequence,0);}
  assert.equal(branch.snapshot.branch.parentWorldId,'vivo.local.workshop');assert.equal(branch.snapshot.branch.parentAcceptedSequence,parentBeforeFork);
  assert.equal(branch.eye.spaceId,'inner');assert.equal(branch.snapshot.spaces.root.entities.portal.innerSpaceId,'inner');
  await resumed.close();await other.close();
});

test('presence advancement cannot turn a cached Studio publish into an overwrite',async()=>{
  const store=new MemoryAuthorityStore(),world=await LocalLeaseWorld.create({snapshot:workshopSeed(),store});
  const one=world.attach({actorId:'local.one'});await one.open();await one.registerEye('main',entryView());
  const cached=one.getSnapshot(),cachedSequence=cached.acceptedSequence;
  const two=world.attach({actorId:'local.two'});await two.open();await two.registerEye('main',entryView());
  assert.equal(two.getSnapshot().acceptedSequence,cachedSequence+1,'the second observer registration advances the world sequence');

  const current=two.getSnapshot();
  const accepted=await two.submit(studioTransformCommand(current,[4.5,-.4,.6,.2],{commandId:'studio.concurrent.accept',expectedRevision:current.acceptedSequence}));
  assert.equal(accepted.status,'accepted');

  const stale=await one.submit(studioTransformCommand(cached,[9.9,9.9,9.9,9.9],{commandId:'studio.cached.stale',expectedRevision:cachedSequence}));
  assert.equal(stale.status,'rejected');assert.equal(stale.code,'STALE_WORLD');
  const latest=one.getSnapshot();
  assert.deepEqual(latest.studioBindings['studio.node.echo'].q,[4.5,-.4,.6,.2]);
  assert.deepEqual(latest.spaces.root.entities.relic.q,[-1.2,-.15,.25,0],'a stale Studio projection cannot mutate the accepted entity');
  await one.close();await two.close();
});

test('older checkpoint without Studio binding is migrated without losing accepted state',async()=>{
  const old=workshopSeed();delete old.studioBindings;const store=new MemoryAuthorityStore();
  await LocalLeaseWorld.create({snapshot:old,store});
  const migrated=await LocalLeaseWorld.create({snapshot:workshopSeed(),store});
  assert.deepEqual(migrated.snapshot().studioBindings['studio.node.echo'].q,[-1.2,-.15,.25,0]);
  const record=migrated.checkpoint();assert.equal(record.state.snapshot.worldId,'vivo.local.workshop');
  assert.match(record.digest,/^[a-f0-9]{64}$/);assert.match(record.state.snapshot.stateHash,/^[a-f0-9]{64}$/);
});

test('older partial Studio registry gains new bindings without overwriting the accepted Echo projection',async()=>{
  const old=workshopSeed();old.studioBindings={['studio.node.echo']:old.studioBindings['studio.node.echo']};const store=new MemoryAuthorityStore();
  const initial=await LocalLeaseWorld.create({snapshot:old,store}),actor=initial.attach({actorId:'local.one'});await actor.open();
  const changed=await actor.submit(studioTransformCommand(actor.getSnapshot(),[7,-2,.8,.1],{commandId:'studio.partial.echo'}));assert.equal(changed.status,'accepted');await actor.close();
  const migrated=await LocalLeaseWorld.create({snapshot:workshopSeed(),store}),bindings=migrated.snapshot().studioBindings;
  assert.deepEqual(bindings['studio.node.echo'].q,[7,-2,.8,.1]);
  assert.deepEqual(bindings['studio.node.workpiece'].q,[.15,.75,.25,0]);assert.deepEqual(bindings['studio.node.portal'].q,[1.35,-.15,.25,0]);
  assert.equal(Object.keys(bindings).length,3);
});

test('explicit Studio commit advances only the selected unbound entity and survives nested restart/CAS conflicts',async()=>{
  const store=new MemoryAuthorityStore(),world=await LocalLeaseWorld.create({snapshot:workshopSeed(),store});
  const one=world.attach({actorId:'local.one'}),two=world.attach({actorId:'local.two'});await one.open();await two.open();
  await one.registerEye('main',entryView());await two.registerEye('main',entryView());

  const initial=one.getSnapshot(),echoBefore=structuredClone(initial.spaces.root.entities.relic);
  const projection=await one.submit(studioTransformCommand(initial,[2.2,-1.4,.8,.1],{commandId:'studio.commit.separation'}));
  assert.equal(projection.status,'accepted');
  assert.deepEqual(one.getSnapshot().spaces.root.entities.relic,echoBefore,'transform remains projection-only');

  let current=one.getSnapshot(),echoBinding=current.studioBindings['studio.node.echo'],echoEntity=current.spaces.root.entities.relic;
  const echoQ=[2.4,-1.1,.7,.2];
  const committed=await one.submit(studioCommitCommand(current,echoQ,{bindingId:'studio.node.echo',metadata:echoBinding.metadata,
    commandId:'studio.commit.echo',expectedBindingRevision:echoBinding.bindingRevision,expectedEntityRevision:echoEntity.revision}));
  assert.equal(committed.status,'accepted');assert.equal(committed.entityRevision,echoEntity.revision+1);
  current=one.getSnapshot();echoBinding=current.studioBindings['studio.node.echo'];echoEntity=current.spaces.root.entities.relic;
  assert.deepEqual(echoBinding.q,echoQ);assert.equal(echoBinding.bindingRevision,2);assert.equal(echoBinding.acceptedSequence,current.acceptedSequence);
  assert.deepEqual(echoEntity.q,echoQ);assert.equal(echoEntity.revision,1);
  assert.deepEqual(echoEntity.v,echoBefore.v);assert.equal(echoEntity.materialProfile,echoBefore.materialProfile);
  assert.deepEqual(echoEntity.fieldMembership,echoBefore.fieldMembership);assert.deepEqual(echoEntity.lineage,echoBefore.lineage);
  assert.equal(echoEntity.id,echoBefore.id);assert.equal(echoEntity.spaceId,echoBefore.spaceId);assert.equal(echoEntity.innerSpaceId,echoBefore.innerSpaceId);
  assert.deepEqual(current.spaces.root.field,initial.spaces.root.field);assert.deepEqual(current.spaces.root.law,initial.spaces.root.law);
  assert.deepEqual(one.getEye('main').q,[0,0,0,0]);assert.deepEqual(two.getEye('main').q,[0,0,0,0]);

  const enter=await one.submit({schema:'vivo.command/1',id:'studio.commit.enter',worldId:current.worldId,spaceId:'root',kind:'space.enter',
    expectedRevision:current.spaces.root.entities.portal.revision,payload:{portalEntityId:'portal',eyeId:'main'}});
  assert.equal(enter.status,'accepted');assert.equal(one.getEye('main').spaceId,'inner');assert.equal(two.getEye('main').spaceId,'root');

  current=one.getSnapshot();const workpieceBinding=current.studioBindings['studio.node.workpiece'];
  const workpieceBefore=structuredClone(current.spaces.root.entities.workpiece),workpieceQ=[1.75,.55,.25,0];
  const workpieceCommit=await one.submit(studioCommitCommand(current,workpieceQ,{bindingId:'studio.node.workpiece',metadata:workpieceBinding.metadata,
    commandId:'studio.commit.workpiece',expectedBindingRevision:workpieceBinding.bindingRevision,
    expectedEntityRevision:workpieceBefore.revision}));
  assert.equal(workpieceCommit.status,'accepted');
  current=one.getSnapshot();const workpiece=current.spaces.root.entities.workpiece;
  assert.deepEqual(workpiece.q,workpieceQ);assert.equal(workpiece.revision,workpieceBefore.revision+1);
  assert.deepEqual(workpiece.v,workpieceBefore.v);assert.deepEqual(workpiece.lineage,workpieceBefore.lineage);
  assert.equal(one.getEye('main').spaceId,'inner');assert.equal(two.getEye('main').spaceId,'root');

  await one.close();await two.close();
  const restored=await LocalLeaseWorld.create({snapshot:workshopSeed(),store}),resumed=restored.attach({actorId:'local.one'}),other=restored.attach({actorId:'local.two'});
  await resumed.open();await other.open();
  current=resumed.getSnapshot();
  assert.deepEqual(current.studioBindings['studio.node.echo'].q,echoQ);assert.equal(current.studioBindings['studio.node.echo'].bindingRevision,2);
  assert.deepEqual(current.spaces.root.entities.relic.q,echoQ);assert.equal(current.spaces.root.entities.relic.revision,1);
  assert.deepEqual(current.studioBindings['studio.node.workpiece'].q,workpieceQ);assert.equal(current.spaces.root.entities.workpiece.revision,1);
  assert.equal(resumed.getEye('main').spaceId,'inner');assert.equal(other.getEye('main').spaceId,'root');

  const beforeReject=restored.checkpoint(),latest=resumed.getSnapshot(),latestEcho=latest.studioBindings['studio.node.echo'];
  const staleGlobal=await resumed.submit(studioCommitCommand(latest,[9,9,9,9],{commandId:'studio.commit.stale.global',
    expectedRevision:latest.acceptedSequence-1,expectedBindingRevision:latestEcho.bindingRevision,expectedEntityRevision:latest.spaces.root.entities.relic.revision}));
  assert.equal(staleGlobal.status,'rejected');assert.equal(staleGlobal.code,'STALE_WORLD');assert.deepEqual(restored.checkpoint(),beforeReject);
  const staleBinding=await resumed.submit(studioCommitCommand(latest,[8,8,8,8],{commandId:'studio.commit.stale.binding',
    expectedBindingRevision:latestEcho.bindingRevision-1,expectedEntityRevision:latest.spaces.root.entities.relic.revision}));
  assert.equal(staleBinding.status,'rejected');assert.equal(staleBinding.code,'STALE_STUDIO_BINDING');assert.deepEqual(restored.checkpoint(),beforeReject);
  const staleEntity=await resumed.submit(studioCommitCommand(latest,[7,7,7,7],{commandId:'studio.commit.stale.entity',
    expectedBindingRevision:latestEcho.bindingRevision,expectedEntityRevision:latest.spaces.root.entities.relic.revision-1}));
  assert.equal(staleEntity.status,'rejected');assert.equal(staleEntity.code,'STALE_ENTITY');assert.deepEqual(restored.checkpoint(),beforeReject);
  await resumed.close();await other.close();
});
