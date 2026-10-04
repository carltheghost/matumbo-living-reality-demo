import test from 'node:test';
import assert from 'node:assert/strict';
import {REALITY_TAB_FORM_IDS} from '../src/domains/reality-tab-layout.js';
import {normalizeDesignDescriptor,parseCreatorDesignRequest,createDesignSession} from '../src/domains/creator-economy.js';
import {createRealityTimeline} from '../src/domains/reality-timeline.js';
import {createRealityWorkspace} from '../src/domains/reality-workspace.js';

test('old and new shape descriptors survive serialized design sessions unchanged',()=>{
  for(const shape of REALITY_TAB_FORM_IDS){
    const descriptor=normalizeDesignDescriptor({surface:{scope:'all',shape},objects:[{id:'agent',kind:'surface',label:'Agent',shape}]});
    assert.equal(descriptor.surface.shape,shape);assert.equal(descriptor.objects[0].shape,shape);
    assert.deepEqual(normalizeDesignDescriptor(JSON.parse(JSON.stringify(descriptor))),descriptor);
    const session=createDesignSession({descriptor});
    const restored=createDesignSession({descriptor});restored.restore(session.serialize());
    assert.deepEqual(restored.snapshot(),session.snapshot());
  }
});

test('creator shape commands support both prism spellings, torus and octahedron while rejecting unknown forms',()=>{
  for(const [request,shape] of [['all objects triangular prism','triangular-prism'],['all objects triangular-prism','triangular-prism'],['selected surface torus','torus'],['selected surface octahedron','octahedron']]){
    const parsed=parseCreatorDesignRequest(request);assert.equal(parsed.descriptor.surface.shape,shape);assert.deepEqual(parsed.unsupported,[]);
  }
  assert.deepEqual(parseCreatorDesignRequest('shape nonexistent').supported,[]);
  assert.throws(()=>normalizeDesignDescriptor({surface:{shape:'nonexistent'}}),/surface shape/);
});

test('legacy and new shape identity survives timeline changes, side-reality forks and parent return',()=>{
  const objects=REALITY_TAB_FORM_IDS.map((shape,i)=>({id:`object-${i}`,shape,position:[i*5,0,0]}));
  const timeline=createRealityTimeline({objects});
  assert.deepEqual(timeline.getSnapshot().objects.map(row=>row.shape),REALITY_TAB_FORM_IDS);
  const workspace=createRealityWorkspace({objects});
  const child=workspace.fork({label:'Shape fork'});workspace.timeline.configure('object-0',{shape:'torus'});
  assert.equal(workspace.timeline.getSnapshot().objects[0].shape,'torus');
  workspace.returnToParent();assert.equal(workspace.timeline.getSnapshot().objects[0].shape,'phone');
  workspace.travel(child.id);assert.equal(workspace.timeline.getSnapshot().objects[0].shape,'torus');
});
