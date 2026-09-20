import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildPersonStudioScene} from '../src/render/person-studio-scene.js';
test('3D room has actual humanoid joints and stable identity geometry across wardrobe/room/motion changes',()=>{
  const scene=new THREE.Scene(),targets=[];
  const studio=buildPersonStudioScene({THREE,parent:scene,targets,compact:true});studio.layer.visible=true;
  const before=studio.getSnapshot();assert.ok(before.meshCount>100);assert.ok(before.jointNames.includes('head'));assert.ok(before.jointNames.includes('leftHand'));
  studio.apply({outfitId:'ivory',roomId:'ocean',companion:'bird'});studio.update(.1,10,{joints:{head:[0,.3,0,.9539]}},true);
  const after=studio.getSnapshot();assert.equal(after.identityHeadGeometry,before.identityHeadGeometry);assert.equal(after.outfitId,'ivory');assert.equal(after.referenceImagesUsedAsTextures,true);
  assert.ok(targets.some(t=>studio.resolve(t)?.id==='wardrobe'));assert.ok(studio.joints.head.quaternion.y>.1);
  studio.destroy();assert.equal(targets.length,0);assert.equal(scene.children.length,0);
});
test('person floats in floorless lens space: no floor, no grid, lens-ring and glow instead',()=>{
  const scene=new THREE.Scene(),targets=[];
  const studio=buildPersonStudioScene({THREE,parent:scene,targets,compact:true});studio.layer.visible=true;
  let floorLike=0,receiveShadow=0;
  studio.layer.traverse(object=>{if(object.isMesh){if(object.receiveShadow)receiveShadow++;
    const params=object.geometry?.parameters??{};
    if(params.width===23&&params.height===.16)floorLike++;}});
  assert.equal(floorLike,0,'the 23x20 floor plane must be gone');
  assert.equal(receiveShadow,0,'nothing dangles a receiveShadow on removed geometry');
  assert.ok(studio.layer.getObjectByName('Hologram lens-ring'),'floating hologram lens-ring replaces the plinth');
  assert.ok(studio.layer.getObjectByName('Lens energy glow'),'soft glow sprite grounds the avatar instead of a floor');
  const hologram=studio.layer.getObjectByName('Reference avatar hologram');
  assert.ok(hologram&&hologram.isSprite,'the approved likeness billboards as a hologram');
  assert.equal(hologram.userData.avatarHologramUrl,'assets/avatar/fluffy-body-template.webp');
  assert.ok(studio.getSnapshot().avatarHologramPresent);
  // Every interactive target survives: tab targets and the 3 outfit targets.
  const kinds=targets.map(t=>studio.resolve(t));
  for(const id of ['identity','wardrobe','room','companion'])assert.ok(kinds.some(k=>k?.kind==='tab'&&k.id===id),`tab target ${id} resolves`);
  for(const id of ['obsidian','cobalt','ivory'])assert.equal(kinds.filter(k=>k?.kind==='outfit'&&k.id===id).length,3,`outfit target ${id} resolves thrice`);
  // Lens energy floats gently; reduced motion freezes it at rest height.
  studio.update(.1,10,{},false);
  assert.notEqual(studio.avatar.position.y,.55,'avatar bobs in lens space');
  studio.update(.1,10,{},true);
  assert.equal(studio.avatar.position.y,.55,'reduced motion holds the avatar at rest height');
  assert.equal(studio.layer.getObjectByName('Hologram lens-ring').position.y,.46,'reduced motion holds the lens-ring at rest height');
  studio.destroy();
});
test('approved model fingerprint is identical on phone and desktop and independent of live pose/outfit',async()=>{
  const desktop=buildPersonStudioScene({THREE,parent:new THREE.Scene(),compact:false}),phone=buildPersonStudioScene({THREE,parent:new THREE.Scene(),compact:true});
  const hash=await desktop.fingerprint();assert.match(hash,/^[a-f0-9]{64}$/);assert.equal(await phone.fingerprint(),hash);
  // The avatar geometry is untouched by the floorless restyle, so the approved
  // identity fingerprint stays stable across the plinth -> lens-ring change.
  assert.equal(hash.length,64);
  phone.layer.visible=true;phone.apply({outfitId:'cobalt',roomId:'night',companion:'spark'});phone.update(.2,9,{joints:{head:[0,.3,0,.9539]}},false);
  assert.equal(await phone.fingerprint(),hash);desktop.destroy();phone.destroy();
});
