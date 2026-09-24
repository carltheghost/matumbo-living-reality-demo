import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealityWorkspace} from '../src/domains/reality-workspace.js';

const objects=[
  {id:'block-world',position:[0,2,0],shape:'cube',size:1.6,anchor:true,locked:true},
  {id:'contracts',position:[12,0,0],shape:'phone',size:1},
  {id:'person',position:[24,0,0],shape:'sphere',size:1},
];

test('side realities keep independent layouts and restore their parent exactly',()=>{
  const workspace=createRealityWorkspace({objects,selectedId:'contracts'});
  const rootId=workspace.activeId,rootTimeline=workspace.timeline;
  rootTimeline.move('contracts',[14,0,0]);
  rootTimeline.setOpen('contracts',true);
  const rootBefore=structuredClone(rootTimeline.getSnapshot());

  const side=workspace.fork({label:'Contracts · Side Reality',metadata:{featureId:'contracts'}});
  const sideId=side.id,sideTimeline=workspace.timeline;
  assert.notEqual(sideId,rootId);
  assert.equal(side.parentId,rootId);
  assert.notEqual(sideTimeline,rootTimeline);
  assert.deepEqual(sideTimeline.getSnapshot().objects.find(item=>item.id==='contracts'),rootBefore.objects.find(item=>item.id==='contracts'));

  sideTimeline.move('contracts',[18,0,0]);
  sideTimeline.configure('contracts',{shape:'wave',size:1.2});
  sideTimeline.select('person');
  assert.deepEqual(rootTimeline.getSnapshot(),rootBefore,'editing the side must not mutate its parent timeline');

  assert.equal(workspace.returnToParent(),true);
  assert.equal(workspace.activeId,rootId);
  assert.equal(workspace.timeline,rootTimeline);
  assert.deepEqual(workspace.timeline.getSnapshot(),rootBefore);

  workspace.travel(sideId);
  assert.equal(workspace.timeline,sideTimeline,'travel restores the same independent side timeline');
  assert.deepEqual(workspace.timeline.getSnapshot().objects.find(item=>item.id==='contracts').position,[18,0,0]);
  assert.equal(workspace.timeline.getSnapshot().objects.find(item=>item.id==='contracts').shape,'wave');
  assert.equal(workspace.timeline.getSnapshot().selectedId,'person');
});

test('reality graph snapshots stay synchronized without merging branch history',()=>{
  const workspace=createRealityWorkspace({objects,selectedId:'contracts'});
  workspace.timeline.move('contracts',[13,0,0]);
  const rootFrameCount=workspace.timeline.getSnapshot().frames.length;
  const root=workspace.getCurrentNode();
  const side=workspace.fork({label:'Independent draft',metadata:{featureId:'contracts'}});
  workspace.timeline.move('contracts',[17,0,0]);
  const graph=workspace.getSnapshot();
  assert.equal(graph.activeId,side.id);
  assert.deepEqual(graph.nodes.find(node=>node.id===side.id).state.objects.find(item=>item.id==='contracts').position,[17,0,0]);
  assert.deepEqual(graph.nodes.find(node=>node.id===root.id).state.objects.find(item=>item.id==='contracts').position,[13,0,0]);
  assert.equal(workspace.timeline.getSnapshot().frames.length,2,'side history starts locally and excludes the parent history');
  workspace.returnToParent();
  assert.equal(workspace.timeline.getSnapshot().frames.length,rootFrameCount);
});

test('initial selection and open state are retained when a new reality is forked',()=>{
  const initiallyOpen=objects.map(item=>item.id==='contracts'?{...item,open:true}:item);
  const workspace=createRealityWorkspace({objects:initiallyOpen,selectedId:'person'});
  assert.equal(workspace.timeline.getSnapshot().selectedId,'person');
  const side=workspace.fork({label:'Open tab fork',metadata:{featureId:'person'}});
  assert.equal(workspace.timeline.getSnapshot().selectedId,'person');
  assert.equal(workspace.timeline.getSnapshot().objects.find(item=>item.id==='contracts').open,true);
  assert.equal(side.state.featureId,'person');
  assert.throws(()=>createRealityWorkspace({objects,selectedId:'missing'}),/Unknown selected object/);
});

test('selection made in the parent before entering a side remains selected there',()=>{
  const workspace=createRealityWorkspace({objects,selectedId:'block-world'});
  workspace.timeline.select('contracts');
  const side=workspace.fork({label:'Contracts · Side Reality',metadata:{featureId:'contracts'}});
  assert.equal(side.state.selectedId,'contracts');
  assert.equal(workspace.timeline.getSnapshot().selectedId,'contracts');
});

test('a side can focus its own feature without changing the parent selection',()=>{
  const workspace=createRealityWorkspace({objects,selectedId:'contracts'});
  const parentTimeline=workspace.timeline;
  const side=workspace.fork({label:'Person · Side Reality',metadata:{featureId:'person'},selectedId:'person'});
  assert.equal(side.state.selectedId,'person');
  assert.equal(workspace.timeline.getSnapshot().selectedId,'person');
  workspace.returnToParent();
  assert.equal(workspace.timeline,parentTimeline);
  assert.equal(workspace.timeline.getSnapshot().selectedId,'contracts');
  assert.throws(()=>workspace.fork({label:'Invalid focus',selectedId:'missing'}),/Unknown selected object/);
});
