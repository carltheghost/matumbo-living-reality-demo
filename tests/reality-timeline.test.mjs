import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealityTimeline} from '../src/domains/reality-timeline.js';
const objects=[{id:'contracts',position:[0,0,0]},{id:'person',position:[45,45,45]}];
test('observed time navigation retains object identities and cannot mutate present from history',()=>{
  let now=1000;const owner=createRealityTimeline({objects,clock:()=>now++});
  owner.move('contracts',[1,0,0]);owner.setOpen('contracts',true);
  const current=owner.getSnapshot();assert.equal(current.frames.length,3);
  owner.goTo(0);assert.deepEqual(owner.getSnapshot().objects[0].position,[0,0,0]);
  assert.throws(()=>owner.move('contracts',[5,0,0]),/read-only/);
  assert.deepEqual(owner.getSnapshot().present,current.present);
  owner.goTo('present');assert.equal(owner.getSnapshot().objects[0].open,true);
  assert.equal(owner.getSnapshot().prediction,false);
});
test('proposed branch forks the inspected frame, keeps IDs and does not mutate present or recorded frames',()=>{
  const owner=createRealityTimeline({objects});owner.move('contracts',[2,0,0]);owner.goTo(0);
  const before=owner.exportHistory();owner.propose('Ocean layout');owner.move('contracts',[-4,3,1]);
  assert.equal(owner.getSnapshot().mode,'proposed');assert.deepEqual(owner.getSnapshot().present[0].position,[2,0,0]);
  assert.deepEqual(JSON.parse(owner.exportHistory()).frames,JSON.parse(before).frames);
  owner.goTo('present');owner.viewBranch('proposal-1');assert.deepEqual(owner.getSnapshot().objects[0].position,[-4,3,1]);
  assert.equal(owner.getSnapshot().objects[0].id,'contracts');
});
test('bounded history, deep immutability, invalid input rejection and no redundant frames',()=>{
  const owner=createRealityTimeline({objects});
  assert.throws(()=>owner.move('contracts',[NaN,0,0]),/coordinates/);assert.throws(()=>owner.select('missing'),/Unknown/);
  assert.throws(()=>owner.getSnapshot().objects[0].position.push(1),TypeError);
  owner.move('contracts',[0,0,0]);assert.equal(owner.getSnapshot().frames.length,1);
  for(let i=0;i<120;i++)owner.move('contracts',[i%50,0,0]);
  assert.equal(owner.getSnapshot().frames.length,100);assert.throws(()=>owner.goTo(0),/unavailable/);
  assert.throws(()=>createRealityTimeline({objects:[...objects,objects[0]]}),/unique/);
});

test('every feature identity is a movable tab; locking makes it immutable',()=>{
  const owner=createRealityTimeline({objects:[
    {id:'block-world',position:[0,0,0],shape:'cube',size:1.6},
    {id:'contracts',position:[12,0,0],shape:'phone',size:1},
  ]});
  owner.move('block-world',[4,0,0]);
  owner.setLocked('block-world',true);
  assert.throws(()=>owner.move('block-world',[8,0,0]),/immutable/);
  owner.setLocked('block-world',false);
  assert.throws(()=>owner.configure('contracts',{shape:'pyramid'}),/supported tab forms/);
  assert.throws(()=>owner.configure('contracts',{size:25}),/between/);
  assert.equal(owner.configure('contracts',{size:12}).objects.find(object=>object.id==='contracts').size,12);
  owner.configure('contracts',{shape:'sphere',size:1.25});
  let tab=owner.getSnapshot().objects.find(object=>object.id==='contracts');
  assert.equal(tab.shape,'sphere');assert.equal(tab.size,1.25);
  owner.setLocked('contracts',true);
  assert.throws(()=>owner.move('contracts',[20,0,0]),/immutable/);
  assert.throws(()=>owner.configure('contracts',{shape:'wave'}),/immutable/);
  owner.setLocked('contracts',false);owner.move('contracts',[20,0,0]);
  tab=owner.getSnapshot().objects.find(object=>object.id==='contracts');
  assert.deepEqual(tab.position,[20,0,0]);assert.equal(tab.locked,false);
});

test('drag destinations avoid collisions while size and shape changes stay in place',()=>{
  const owner=createRealityTimeline({objects:[
    {id:'block-world',position:[0,0,0]},
    {id:'contracts',position:[12,0,0]},
    {id:'person',position:[28,0,0]},
  ]});
  owner.move('contracts',[.1,0,0]);
  let state=owner.getSnapshot();
  const tab=state.objects.find(object=>object.id==='contracts'),anchor=state.objects.find(object=>object.id==='block-world');
  const distance=Math.hypot(...tab.position.map((value,index)=>value-anchor.position[index]));
  assert.ok(distance>2,'movable tabs remain separated when explicitly dragged together');
  const beforeResize=tab.position;
  owner.configure('contracts',{size:12});
  state=owner.getSnapshot();
  const expanded=state.objects.find(object=>object.id==='contracts');
  assert.equal(expanded.size,12);assert.deepEqual(expanded.position,beforeResize);
  owner.configure('contracts',{shape:'cube'});
  state=owner.getSnapshot();
  const resized=state.objects.find(object=>object.id==='contracts');
  assert.equal(resized.size,12);assert.equal(resized.shape,'cube');
  assert.deepEqual(resized.position,beforeResize,'changing the visible form must never teleport the object');
});
