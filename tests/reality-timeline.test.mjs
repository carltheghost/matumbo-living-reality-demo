import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealityTimeline} from '../src/domains/reality-timeline.js';
const objects=[{id:'contracts',position:[0,0,0]},{id:'person',position:[45,45,45]}];
test('bounded orientation belongs to the original timeline and old objects default to zero radians',()=>{
  const owner=createRealityTimeline({objects}),before=owner.getSnapshot();
  assert.deepEqual(before.objects[0].rotation,[0,0,0]);
  for(const rotation of [[0,0,NaN],[0,0,Math.PI+.01],[0,0],['0',0,0]]){
    assert.throws(()=>owner.configure('contracts',{rotation}),/finite radians/);
    assert.deepEqual(owner.getSnapshot(),before,'invalid transforms do not change history');
  }
  const rotated=owner.configure('contracts',{rotation:[.2,-.4,Math.PI]});
  assert.deepEqual(rotated.objects[0].rotation,[.2,-.4,Math.PI]);assert.deepEqual(rotated.objects[0].position,[0,0,0]);
  assert.equal(rotated.frames.length,2);assert.equal(rotated.persistent,false);
  assert.deepEqual(JSON.parse(owner.exportHistory()).frames[1].objects[0].rotation,[.2,-.4,Math.PI]);
  assert.throws(()=>rotated.objects[0].rotation.push(0),TypeError);
  owner.setLocked('contracts',true);assert.throws(()=>owner.configure('contracts',{rotation:[0,0,0]}),/immutable/);
  assert.throws(()=>createRealityTimeline({objects:[{...objects[0],rotation:[0,0,Infinity]}]}),/finite radians/);
});
test('orientation replays historical frames and proposed branches without replacing present',()=>{
  const owner=createRealityTimeline({objects});owner.configure('contracts',{rotation:[0,0,.6]});
  const present=owner.getSnapshot().present,history=JSON.parse(owner.exportHistory()).frames;
  owner.goTo(0);assert.deepEqual(owner.getSnapshot().objects[0].rotation,[0,0,0]);
  assert.throws(()=>owner.configure('contracts',{rotation:[0,0,.3]}),/read-only/);
  owner.propose('Rotated proposal');owner.configure('contracts',{rotation:[0,0,-.4]});
  assert.deepEqual(owner.getSnapshot().objects[0].rotation,[0,0,-.4]);assert.deepEqual(owner.getSnapshot().present,present);
  assert.deepEqual(JSON.parse(owner.exportHistory()).frames,history);
  const restored=createRealityTimeline({objects:owner.getSnapshot().objects});
  assert.deepEqual(restored.getSnapshot().objects[0].rotation,[0,0,-.4],'workspace travel retains canonical orientation');
  owner.goTo('present');assert.deepEqual(owner.getSnapshot().objects[0].rotation,[0,0,.6]);
});
test('a complete transform resolves its candidate before one history commit and rejects blocked placement atomically',()=>{
  const owner=createRealityTimeline({objects}),before=owner.getSnapshot();
  const transformed=owner.transform('contracts',{position:[3,2,1],size:1.2,rotation:[.1,.2,.3]});
  assert.equal(transformed.revision,before.revision+1);assert.equal(transformed.frames.length,before.frames.length+1);
  assert.deepEqual(transformed.objects[0].position,[3,2,1]);assert.equal(transformed.objects[0].size,1.2);assert.deepEqual(transformed.objects[0].rotation,[.1,.2,.3]);
  const neighbors=[-60,0,60].flatMap(x=>[-60,0,60].flatMap(y=>[-60,0,60].map(z=>({
    id:`neighbor-${[x,y,z].map(n=>n+60).join('-')}`,position:[x,y,z],shape:'cube',size:24,locked:true,
  }))));
  const crowded=createRealityTimeline({objects:[{id:'agent',position:[0,0,0],shape:'cube',size:1},...neighbors]}),untouched=crowded.getSnapshot();
  assert.throws(()=>crowded.transform('agent',{position:[0,0,0],size:24,rotation:[0,0,.3]}),/No collision-free/);
  assert.deepEqual(crowded.getSnapshot(),untouched,'rejection preserves position, size, rotation and all history');
  owner.goTo(0);assert.throws(()=>owner.transform('contracts',{position:[5,2,1],rotation:[0,0,.5]}),/read-only/);
  owner.propose('Transform draft');owner.transform('contracts',{position:[5,2,1],size:1.3,rotation:[0,0,.5]});
  assert.deepEqual(owner.getSnapshot().present,transformed.present,'proposed transforms cannot change the present');
});
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
