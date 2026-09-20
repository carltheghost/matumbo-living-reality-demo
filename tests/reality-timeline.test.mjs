import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealityTimeline} from '../src/domains/reality-timeline.js';
const objects=[{id:'contracts',position:[0,0,0]},{id:'person',position:[4,2,0]}];
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
