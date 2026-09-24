import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealityLensEngine,realityLensEngine,resolveRealityLensGroup} from '../src/domains/reality-lens-engine.js';

test('the reusable funnel widens as depth increases along its configured axis',()=>{
  const near=realityLensEngine.placeInFunnel({id:'world-a',groupId:'worlds',depth:10});
  const far=realityLensEngine.placeInFunnel({id:'value-a',groupId:'value',depth:60});
  const axis=[54,36,164],length=Math.hypot(...axis),unit=axis.map(value=>value/length),origin=[0,2,0];
  const radial=point=>{
    const delta=point.position.map((value,index)=>value-origin[index]);
    const axial=delta.reduce((sum,value,index)=>sum+value*unit[index],0);
    return Math.hypot(...delta.map((value,index)=>value-unit[index]*axial));
  };
  assert.ok(far.radius>near.radius);
  assert.ok(radial(far)>radial(near));
  assert.ok(far.depth>near.depth);
});

test('funnel layouts are deterministic while distinct objects get distinct slots',()=>{
  const first=realityLensEngine.placeInFunnel({id:'contracts',index:1,count:5,groupId:'value'});
  const same=realityLensEngine.placeInFunnel({id:'contracts',index:1,count:5,groupId:'value'});
  const other=realityLensEngine.placeInFunnel({id:'ledger',index:2,count:5,groupId:'value'});
  assert.deepEqual(first,same);
  assert.notDeepEqual(first.position,other.position);
});

test('the reusable funnel surface defines open rings that widen toward the lens mouth',()=>{
  const near=realityLensEngine.surfacePoint({depth:10,angle:0});
  const far=realityLensEngine.surfacePoint({depth:70,angle:0});
  assert.ok(far.radius>near.radius);
  assert.ok(far.depth>near.depth);
  assert.ok(near.position.every(Number.isFinite)&&far.position.every(Number.isFinite));
});

test('overview reveal is monotonic and settles at the declared far and full distances',()=>{
  const samples=[200,160,140,110,90,64,30].map(distance=>realityLensEngine.overviewProgress(distance));
  assert.deepEqual(samples.slice(0,2),[0,0]);
  assert.equal(samples.at(-2),1);
  assert.equal(samples.at(-1),1);
  assert.ok(samples.every((value,index)=>index===0||value>=samples[index-1]));
});

test('object stages reveal cumulatively as distance decreases',()=>{
  const distances=[24,18,12,7,5,3.4,1];
  const stages=distances.map(distance=>realityLensEngine.stageAt(distance).stage);
  assert.deepEqual(stages,[0,1,1,2,2,3,3]);
  assert.ok(stages.every((value,index)=>index===0||value>=stages[index-1]));
});

test('selected objects grow into a readable surface while context recedes',()=>{
  const near=realityLensEngine.objectResponse({id:'person',selectedId:'person',distance:3.5,baseScale:1.1,size:1.2});
  const far=realityLensEngine.objectResponse({id:'person',selectedId:'person',distance:20,baseScale:1.1,size:1.2});
  const context=realityLensEngine.objectResponse({id:'rooms',selectedId:'person',distance:3.5,baseScale:1.1,size:1.2});
  assert.ok(near.scale>far.scale);
  assert.equal(near.scale,1.1*1.2*2.2);
  assert.ok(near.scale>far.scale*2);
  assert.equal(context.scale,1.1*1.2);
  assert.ok(context.contextOpacity<1);
  assert.ok(context.contextOpacity<=.2,'unrelated tabs stay quiet while remaining visibly alive');
  assert.ok(context.contextOpacity>=realityLensEngine.profile.focus.minContextOpacity);
});

test('custom object profiles reuse the same funnel, focus and stage rules',()=>{
  const engine=createRealityLensEngine({origin:[0,0,0],axis:[0,0,1],funnel:{farDepth:50,farRadius:18},stages:[12,5,2]});
  const placed=engine.placeInFunnel({id:'custom-panel',groupId:'network'});
  assert.ok(placed.position.every(Number.isFinite));
  assert.ok(placed.radius>0);
  assert.equal(engine.stageAt(1).stage,3);
  assert.equal(engine.objectResponse({id:'custom-panel',selectedId:'custom-panel',distance:1}).isSelected,true);
});

test('unmapped features still receive a stable parent domain',()=>{
  assert.equal(resolveRealityLensGroup('unknown-world-fragment'),'worlds');
  assert.equal(resolveRealityLensGroup('unknown-lab-tool'),'experiences');
});
