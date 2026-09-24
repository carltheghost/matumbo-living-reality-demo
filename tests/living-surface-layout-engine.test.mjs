import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceLayout,focusDistance,solveLivingLayout,wheelIntent}
  from '../src/domains/living-surface-layout-engine.js';
import {REALITY_TAB_FORMS} from '../src/domains/reality-tab-layout.js';

test('every form has a bounded exterior reading surface in local coordinates',()=>{
  for(const [shape,form] of Object.entries(REALITY_TAB_FORMS)){
    const layout=surfaceLayout({id:`object-${shape}`,shape,size:1.5,position:[30,50,-80]});
    assert.deepEqual(layout.bodyBounds,{width:form.width,height:form.height,depth:form.depth});
    assert.equal(layout.objectId,`object-${shape}`);
    assert.equal(layout.primarySurface.id,'front');
    assert.ok(layout.primarySurface.width<form.width);
    assert.ok(layout.primarySurface.height<form.height);
    assert.deepEqual(layout.primarySurface.normal,[0,0,1]);
    assert.deepEqual(layout.primarySurface.up,[0,1,0]);
    assert.deepEqual(layout.readableBounds,{
      width:layout.primarySurface.width,height:layout.primarySurface.height});
    assert.ok(layout.primarySurface.position[2]>0);
    assert.ok(layout.primarySurface.position[2]<form.depth+.1);
    assert.ok(layout.radius>0);
    assert.deepEqual(layout.diagnostics.anchorPosition,[30,50,-80]);
    assert.ok(layout.secondarySurfaces.length>=3);
    assert.ok(layout.secondarySurfaces.every(face=>['back','left','right','top','bottom'].includes(face.id)));
    for(const face of [layout.primarySurface,...layout.secondarySurfaces])
      assert.ok(Math.abs(face.normal.reduce((sum,value,index)=>sum+value*face.up[index],0))<1e-5,
        `${shape}/${face.id} up direction must lie in the reading plane`);
  }
});

test('flat extrusions expose their front beyond the bevel; cube stays centered',()=>{
  for(const shape of ['phone','square','rectangle','wave']){
    const layout=surfaceLayout({id:shape,shape});
    assert.ok(layout.primarySurface.position[2]>=layout.bodyBounds.depth+.035);
    const left=layout.secondarySurfaces.find(face=>face.id==='left');
    assert.ok(left.position[0]<-layout.bodyBounds.width/2-.035);
  }
  const cube=surfaceLayout({id:'cube',shape:'cube'});
  assert.ok(cube.primarySurface.position[2]>cube.bodyBounds.depth/2);
  assert.ok(cube.primarySurface.position[2]<cube.bodyBounds.depth/2+.05);
});

test('cylinder keeps its chosen silhouette and small outward curved patches',()=>{
  const cylinder=surfaceLayout({id:'contract',shape:'cylinder',contentDensity:30});
  assert.equal(cylinder.bodyBounds.width,1.36);
  assert.equal(cylinder.bodyBounds.height,1.64);
  assert.ok(cylinder.bodyBounds.height/cylinder.bodyBounds.width>1.2);
  assert.ok(cylinder.primarySurface.width<1.1);
  assert.ok(cylinder.primarySurface.height<1.3);
  assert.ok(cylinder.primarySurface.position[2]>.68);
  assert.equal(cylinder.primarySurface.arcDegrees,98);
  assert.ok(cylinder.secondarySurfaces.reduce((sum,face)=>sum+face.arcDegrees,0)<=140);
  for(const face of cylinder.secondarySurfaces){
    assert.ok(Math.hypot(face.position[0],face.position[2])>.68);
    assert.ok(Math.abs(Math.hypot(face.normal[0],face.normal[2])-1)<1e-6);
  }
  assert.equal(cylinder.diagnostics.requiresScroll,true);
});

test('sphere reading face stays inside the front hemisphere band',()=>{
  const sphere=surfaceLayout({id:'person',shape:'sphere'});
  assert.ok(sphere.primarySurface.width<.9);
  assert.ok(sphere.primarySurface.height<.9);
  assert.ok(sphere.primarySurface.position[2]>.725);
  assert.equal(sphere.primarySurface.arcDegrees,80);
  assert.ok(sphere.secondarySurfaces.every(face=>Math.hypot(...face.position)>.725));
  assert.ok(sphere.secondarySurfaces.every(face=>face.position[2]>0&&face.normal[2]>0),
    'supporting sphere copy stays on the visible front hemisphere');
});

test('copy density never changes body or surface geometry and size only changes radius',()=>{
  const options={id:'same',shape:'cylinder',position:[9,8,7]};
  const low=surfaceLayout({...options,size:1,contentDensity:0});
  const high=surfaceLayout({...options,size:3,contentDensity:100});
  assert.deepEqual(high.bodyBounds,low.bodyBounds);
  assert.deepEqual(high.readableBounds,low.readableBounds);
  assert.deepEqual(high.primarySurface,low.primarySurface);
  assert.deepEqual(high.secondarySurfaces,low.secondarySurfaces);
  assert.equal(high.radius,low.radius*3);
  assert.equal(high.diagnostics.requiresScroll,true);
});

test('focus distance includes physical size, growth and both viewport axes',()=>{
  const basic={shape:'cylinder',viewportWidth:1280,viewportHeight:720,fov:60,occupancy:.4};
  const initial=focusDistance(basic);
  const scaled=focusDistance({...basic,size:1.5,baseScale:1.2,approachScale:1.8});
  const narrow=focusDistance({...basic,viewportWidth:375});
  assert.ok(initial.distance>initial.radius+.1);
  assert.ok(initial.occupancyEstimate<=.4);
  assert.ok(scaled.distance>initial.distance*2);
  assert.ok(scaled.occupancyEstimate<=.4);
  assert.ok(narrow.distance>initial.distance);
  assert.ok(narrow.widthOccupancy<=.4);
  assert.ok(focusDistance({...basic,shape:'cube'}).distance>0);
});

test('clear locations and original input are preserved',()=>{
  const items=[{id:'a',shape:'sphere',position:[0,0,0]},
    {id:'b',shape:'cylinder',position:[9,0,0]},
    {id:'c',shape:'phone',position:[-7,3,-2]}];
  const before=structuredClone(items),result=solveLivingLayout(items,{gap:.75});
  assert.deepEqual(items,before);
  assert.deepEqual(result.objects.map(object=>object.position),items.map(object=>object.position));
  assert.deepEqual(result.diagnostics.moved,[]);
  assert.equal(result.diagnostics.unresolvedCollisions,0);
});

test('20 mixed shapes separate deterministically while pinned coordinates remain fixed',()=>{
  const shapes=Object.keys(REALITY_TAB_FORMS);
  const items=Array.from({length:20},(_,index)=>({
    id:`object-${index}`,shape:shapes[index%shapes.length],size:1+(index%4)*.2,
    position:[0,0,0],locked:index===0,pinned:index===1,
  }));
  items[1].position=[5,0,0];
  const snapshot=structuredClone(items);
  const a=solveLivingLayout(items,{gap:.35});
  const b=solveLivingLayout(items,{gap:.35});
  assert.deepEqual(a,b);
  assert.deepEqual(items,snapshot);
  assert.deepEqual(a.objects[0].position,[0,0,0]);
  assert.deepEqual(a.objects[1].position,[5,0,0]);
  assert.equal(a.diagnostics.unresolvedCollisions,0);
  assert.equal(a.diagnostics.collisionCount,0);
  assert.equal(a.diagnostics.movedObjectCount,a.diagnostics.moved.length);
  assert.ok(a.diagnostics.minimumGap>=.35-1e-6);
  assert.ok(a.diagnostics.moved.length>=18);
  for(let i=0;i<a.objects.length;i++)for(let j=0;j<i;j++){
    const first=a.objects[i],second=a.objects[j];
    const distance=Math.hypot(...first.position.map((value,axis)=>value-second.position[axis]));
    assert.ok(distance>=first.radius+second.radius+.35-1e-6,
      `${first.id} and ${second.id} intersect by ${first.radius+second.radius+.35-distance}`);
  }
});

test('unresolvable locked pair is reported and never moved',()=>{
  const items=[{id:'fixed-a',shape:'cube',position:[0,0,0],locked:true},
    {id:'fixed-b',shape:'sphere',position:[0,0,0],pinned:true},
    {id:'moving',shape:'phone',position:[0,0,0]}];
  const result=solveLivingLayout(items);
  assert.deepEqual(result.objects[0].position,[0,0,0]);
  assert.deepEqual(result.objects[1].position,[0,0,0]);
  assert.equal(result.diagnostics.unresolvedCollisions,1);
  assert.deepEqual(result.diagnostics.collisions[0],{ids:['fixed-a','fixed-b'],fixed:true});
  assert.ok(!result.diagnostics.collisions.some(item=>item.ids.includes('moving')));
});

test('the wheel gives content, mutable object and travel their own priority',()=>{
  assert.equal(wheelIntent({overContent:true,overObject:true,mutable:true}),'scroll');
  assert.equal(wheelIntent({overObject:true,mutable:true}),'resize');
  assert.equal(wheelIntent({overObject:true,mutable:false}),'travel');
  assert.equal(wheelIntent({}),'travel');
});

test('reject invalid geometry and duplicate identities',()=>{
  assert.throws(()=>surfaceLayout({shape:'cube'}),/object id/);
  assert.throws(()=>surfaceLayout({id:'x',size:0}),/size/);
  assert.throws(()=>focusDistance({viewportWidth:0,viewportHeight:720}),/viewportWidth/);
  assert.throws(()=>solveLivingLayout([{id:'x'},{id:'x'}]),/duplicate/);
});
