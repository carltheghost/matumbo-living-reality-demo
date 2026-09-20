import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonStudioOwner,PERSON_STUDIO_STORAGE_KEY} from '../src/domains/person-studio.js';
const memory=()=>{const records=new Map();return {getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v)};};
test('approval, wardrobe, save and reload retain one identity without invented account data',async()=>{
  const storage=memory();const owner=createPersonStudioOwner({storage});await owner.ready;
  assert.equal(owner.getSnapshot().approved,false);assert.equal(storage.getItem(PERSON_STUDIO_STORAGE_KEY),null);
  await assert.rejects(()=>owner.approve('Local test'),/Confirm/);
  await owner.approve('Local test',true);const id=owner.getSnapshot().avatar.identity;
  owner.chooseOutfit('ivory');owner.chooseRoom('ocean');owner.chooseCompanion('bird');owner.moveRig(.5,.7);
  assert.strictEqual(owner.getSnapshot().avatar.identity,id);assert.equal(owner.getSnapshot().avatar.appearance.version,2);
  const projected=owner.projectInto('contracts');assert.equal(projected,id.avatarId);
  owner.save();assert.equal(owner.getSnapshot().dirty,false);
  const restored=createPersonStudioOwner({storage});await restored.ready;
  assert.deepEqual(restored.getSnapshot().avatar.identity,id);
  assert.equal(restored.getSnapshot().outfitId,'ivory');assert.equal(restored.getSnapshot().roomId,'ocean');
  assert.equal(restored.getSnapshot().companionId,owner.getSnapshot().companionId);assert.equal(restored.getPose().tracking,'idle');
  assert.equal(restored.getSnapshot().aiConnected,false);
});
test('updated geometry cannot silently impersonate a previously approved model',async()=>{
  const storage=memory(),first=createPersonStudioOwner({storage,modelFingerprint:'a'.repeat(64)});await first.ready;await first.approve('Local',true);first.save();const saved=storage.getItem(PERSON_STUDIO_STORAGE_KEY);
  const next=createPersonStudioOwner({storage,modelFingerprint:'b'.repeat(64)});await next.ready;
  assert.equal(next.getSnapshot().approved,false);assert.match(next.getSnapshot().error,/geometry has changed/);assert.equal(storage.getItem(PERSON_STUDIO_STORAGE_KEY),saved);
});
test('invalid storage is not overwritten, rejected choices do not mutate state, failed saves stay unsaved',async()=>{
  const storage=memory();storage.setItem(PERSON_STUDIO_STORAGE_KEY,'{bad');const owner=createPersonStudioOwner({storage});await owner.ready;
  assert.match(owner.getSnapshot().error,/not loaded/);assert.equal(storage.getItem(PERSON_STUDIO_STORAGE_KEY),'{bad');
  assert.throws(()=>owner.chooseOutfit('invented'),/Unknown/);assert.equal(owner.getSnapshot().outfitId,'obsidian');
  const failing=createPersonStudioOwner({storage:{getItem:()=>null,setItem:()=>{throw Error('full');}}});await failing.ready;await failing.approve('Local',true);
  assert.throws(()=>failing.save(),/Save failed/);assert.equal(failing.getSnapshot().dirty,true);
});
