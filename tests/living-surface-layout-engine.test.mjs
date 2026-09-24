import test from 'node:test';
import assert from 'node:assert/strict';
import {REALITY_TAB_FORMS,REALITY_TAB_GAP,realityTabRadius,resolveRealityTabPosition} from '../src/domains/reality-tab-layout.js';
import {
  createLivingSurfaceMap,
  projectLivingSurface,
  fitLivingSurface,
  focusDistanceForLivingObject,
  relaxLivingRealityLayout,
} from '../src/domains/living-surface-layout-engine.js';

test('each Reality Lens form owns bounded outward-facing living surfaces',()=>{
  for(const shape of Object.keys(REALITY_TAB_FORMS)){
    const map=createLivingSurfaceMap(shape);
    assert.equal(map.shape,shape);
    assert.deepEqual(map.faces.map(face=>face.id),['front','back','left','right','top','bottom']);
    for(const face of map.faces){
      assert.ok(face.width>0&&face.height>0,`${shape}/${face.id} has bounded readable dimensions`);
      assert.ok([...face.position,...face.rotation].every(Number.isFinite),`${shape}/${face.id} stays finite`);
    }
    assert.ok(map.primary.position[2]>0,`${shape} primary surface sits outside its body`);
  }
});

test('curved forms keep a compact readable skin instead of filling their whole body',()=>{
  const cylinder=createLivingSurfaceMap('cylinder'),sphere=createLivingSurfaceMap('sphere');
  assert.ok(cylinder.primary.width<REALITY_TAB_FORMS.cylinder.width);
  assert.ok(cylinder.primary.height<REALITY_TAB_FORMS.cylinder.height);
  assert.equal(cylinder.primary.kind,'arc');
  assert.ok(cylinder.primary.position[2]>=REALITY_TAB_FORMS.cylinder.radius);
  assert.equal(sphere.primary.kind,'hemisphere');
  assert.ok(sphere.primary.width<REALITY_TAB_FORMS.sphere.width);
  assert.ok(sphere.primary.position[2]>=REALITY_TAB_FORMS.sphere.radius);
});

test('content is clamped to a readable viewport surface instead of stretching the object body',()=>{
  const fit=fitLivingSurface({shape:'cylinder',size:16,approachScale:2.6,distance:22,viewportWidth:1440,viewportHeight:900,safeWidth:96,safeHeight:180});
  assert.ok(fit.width<=((1440-96)*.64)+.001);
  assert.ok(fit.height<=((900-180)*.64)+.001);
  assert.equal(fit.scrollable,true);
  assert.equal(fit.overflowed,true);
});

test('focus camera distance grows with a deliberately enlarged body instead of making a giant close-up',()=>{
  const normal=focusDistanceForLivingObject({shape:'cylinder',size:1,approachScale:2.6,viewportWidth:1440,viewportHeight:900});
  const large=focusDistanceForLivingObject({shape:'cylinder',size:12,approachScale:2.6,viewportWidth:1440,viewportHeight:900});
  assert.ok(large.distance>normal.distance*6);
  assert.equal(normal.occupancy,.54);
  assert.ok(large.distance<=190);
});

test('the deterministic layout solver adds breathing room without moving a locked object',()=>{
  const objects=[
    {id:'anchor',shape:'sphere',size:1,position:[0,0,0],locked:true},
    {id:'cylinder',shape:'cylinder',size:1,position:[0,0,0]},
    {id:'phone',shape:'phone',size:1,position:[.1,0,.1]},
    {id:'wave',shape:'wave',size:1,position:[.15,0,.15]},
  ];
  const options={gap:1.28,maxIterations:32,axis:[54,36,164]};
  const first=relaxLivingRealityLayout(objects,options),second=relaxLivingRealityLayout(objects,options);
  assert.deepEqual(first,second,'the Lens field must not jitter between frames');
  assert.deepEqual(first.objects.find(object=>object.id==='anchor').position,[0,0,0]);
  for(let i=0;i<first.objects.length;i++)for(let j=i+1;j<first.objects.length;j++){
    const a=first.objects[i],b=first.objects[j];
    const distance=Math.hypot(...a.position.map((value,index)=>value-b.position[index]));
    const required=realityTabRadius(a)+realityTabRadius(b)+options.gap;
    assert.ok(distance>=required-.01,`${a.id} and ${b.id} have breathing room`);
  }
  assert.equal(first.diagnostics.collisionCount,0);
});

import {surfaceLayout,createLivingSurfaceComposer,focusDistance,solveLivingLayout,wheelIntent}
  from '../src/domains/living-surface-layout-engine.js';

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
    assert.deepEqual(layout.readableBounds,layout.wrapper.contentBounds);
    assert.equal(layout.wrapper.shape,shape);
    assert.deepEqual(layout.wrapper.frameBounds,{width:form.width,height:form.height});
    assert.deepEqual(layout.wrapper.contentBounds,layout.readableBounds);
    assert.equal(layout.wrapper.frontDepth,layout.primarySurface.position[2]);
    assert.equal(layout.wrapper.depth,form.depth);
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

test('cylinder keeps its portrait silhouette with a near-full outward reading face',()=>{
  const cylinder=surfaceLayout({id:'contract',shape:'cylinder',contentDensity:30});
  assert.equal(cylinder.bodyBounds.width,1.36);
  assert.equal(cylinder.bodyBounds.height,1.64);
  assert.ok(cylinder.bodyBounds.height/cylinder.bodyBounds.width>1.2);
  assert.ok(cylinder.primarySurface.width>=cylinder.bodyBounds.width*.86);
  assert.ok(cylinder.primarySurface.height>=cylinder.bodyBounds.height*.86);
  assert.ok(cylinder.primarySurface.width<cylinder.bodyBounds.width);
  assert.ok(cylinder.primarySurface.height<cylinder.bodyBounds.height);
  assert.equal(cylinder.wrapper.contour,'cylinder');
  assert.ok(Math.abs(cylinder.primarySurface.width/cylinder.primarySurface.height-
    cylinder.bodyBounds.width/cylinder.bodyBounds.height)<1e-5);
  assert.ok(cylinder.primarySurface.position[2]>.68);
  assert.ok(cylinder.primarySurface.arcDegrees>=120&&cylinder.primarySurface.arcDegrees<=140);
  assert.ok(cylinder.secondarySurfaces.reduce((sum,face)=>sum+face.arcDegrees,0)<=140);
  for(const face of cylinder.secondarySurfaces){
    assert.ok(Math.hypot(face.position[0],face.position[2])>.68);
    assert.ok(Math.abs(Math.hypot(face.normal[0],face.normal[2])-1)<1e-6);
  }
  assert.equal(cylinder.diagnostics.requiresScroll,true);
});

test('sphere reading face uses a circular near-full front hemisphere',()=>{
  const sphere=surfaceLayout({id:'person',shape:'sphere'});
  assert.equal(sphere.wrapper.contour,'circle');
  assert.equal(sphere.primarySurface.width,sphere.primarySurface.height);
  assert.ok(sphere.primarySurface.width>=sphere.bodyBounds.width*.86);
  assert.ok(sphere.primarySurface.width<sphere.bodyBounds.width);
  assert.ok(Math.hypot(sphere.readableBounds.width,sphere.readableBounds.height)<=sphere.bodyBounds.width*.97,
    'the rectangular controls fit inside the circular skin');
  assert.ok(sphere.primarySurface.position[2]>.725);
  assert.ok(sphere.primarySurface.arcDegrees>=120&&sphere.primarySurface.arcDegrees<=140);
  assert.ok(sphere.secondarySurfaces.every(face=>Math.hypot(...face.position)>.725));
  assert.ok(sphere.secondarySurfaces.every(face=>face.position[2]>0&&face.normal[2]>0),
    'supporting sphere copy stays on the visible front hemisphere');
});

test('every wrapper and its readable face have the same silhouette and aspect ratio',()=>{
  const expected={phone:'rounded-rectangle',square:'rounded-rectangle',rectangle:'rounded-rectangle',
    sphere:'circle',cylinder:'cylinder',cube:'rounded-rectangle',wave:'wave'};
  for(const [shape,form] of Object.entries(REALITY_TAB_FORMS)){
    const {wrapper,primarySurface}=surfaceLayout({id:shape,shape});
    assert.equal(wrapper.contour,expected[shape]);
    assert.ok(wrapper.coverage>=.86&&wrapper.coverage<=.92);
    if(shape==='sphere'){
      assert.ok(wrapper.contentBounds.width<primarySurface.width);
      assert.ok(wrapper.contentBounds.height<primarySurface.height);
    }else{
      assert.equal(primarySurface.width,wrapper.contentBounds.width);
      assert.equal(primarySurface.height,wrapper.contentBounds.height);
    }
    assert.ok(Math.abs(primarySurface.width/primarySurface.height-form.width/form.height)<1e-5);
    assert.ok(primarySurface.width>=wrapper.width*.86&&primarySurface.width<=wrapper.width*.92);
    assert.ok(primarySurface.height>=wrapper.height*.86&&primarySurface.height<=wrapper.height*.92);
  }
});

test('legacy map, projector and fitter read the same wrapper geometry',()=>{
  for(const shape of Object.keys(REALITY_TAB_FORMS)){
    const layout=surfaceLayout({id:shape,shape}),map=createLivingSurfaceMap(shape);
    assert.equal(map.primary.width,layout.primarySurface.width);
    assert.equal(map.primary.height,layout.primarySurface.height);
    assert.deepEqual(map.primary.position,layout.primarySurface.position);
    const projected=projectLivingSurface({shape,distance:9,viewportHeight:900});
    const fitted=fitLivingSurface({shape,distance:9,viewportWidth:1440,viewportHeight:900});
    assert.equal(projected.primary.width,layout.primarySurface.width);
    assert.equal(projected.primary.height,layout.primarySurface.height);
    assert.equal(fitted.primary.width,layout.primarySurface.width);
    assert.equal(fitted.primary.height,layout.primarySurface.height);
    assert.ok(projected.width>0&&fitted.width>0);
  }
});

test('legacy map options still offset view faces without resizing the physical object',()=>{
  const base=createLivingSurfaceMap('phone');
  const adjusted=createLivingSurfaceMap('phone',{clearance:.08,depthRatio:.7});
  assert.deepEqual(adjusted.body,base.body);
  assert.ok(adjusted.primary.position[2]>base.primary.position[2]);
  assert.ok(adjusted.faces.find(face=>face.id==='left').width>base.faces.find(face=>face.id==='left').width);
  assert.ok(adjusted.faces.find(face=>face.id==='top').position[1]>base.faces.find(face=>face.id==='top').position[1]);
});

test('custom object profiles compose a new shape without a shape-specific branch',()=>{
  const profile={body:{width:2,height:1.5,depth:.2},contour:'rounded-rectangle',coverage:.88,
    cornerRadius:.22,frontDepth:.26};
  const composer=createLivingSurfaceComposer({profiles:{'hex-diary':profile}});
  const registered=composer.surfaceLayout({id:'diary',shape:'hex-diary',size:3,contentDensity:10});
  const direct=surfaceLayout({id:'diary',shape:'hex-diary',size:3,contentDensity:10,profile});
  assert.deepEqual(registered,direct);
  assert.equal(registered.wrapper.shape,'hex-diary');
  assert.deepEqual(registered.bodyBounds,{width:2,height:1.5,depth:.2});
  assert.deepEqual(registered.wrapper.contentBounds,{width:1.76,height:1.32});
  assert.equal(registered.wrapper.frontDepth,.26);
  assert.equal(registered.primarySurface.position[2],.26);
  assert.equal(registered.wrapper.cornerRadius,.22);
  assert.equal(registered.wrapper.inset,.06);
  assert.equal(registered.diagnostics.requiresScroll,true);
  assert.deepEqual(composer.profileFor('hex-diary').body,profile.body);
  const map=createLivingSurfaceMap('hex-diary',{profile});
  assert.equal(map.primary.width,registered.primarySurface.width);
  assert.equal(projectLivingSurface({shape:'hex-diary',profile}).primary.height,registered.primarySurface.height);
  assert.throws(()=>surfaceLayout({id:'bad',shape:'hex-diary',profile:{...profile,coverage:1}}),/coverage/);
  assert.throws(()=>surfaceLayout({id:'buried',shape:'hex-diary',profile:{...profile,frontDepth:.1}}),/frontDepth/);
  assert.throws(()=>createLivingSurfaceComposer({profiles:{bad:{...profile,contour:'unknown'}}}),/contour/);
});

test('custom profile drives focus framing and deterministic spacing at its physical size',()=>{
  const composer=createLivingSurfaceComposer({profiles:{'long-diary':{
    body:{width:7,height:1.5,depth:.3},contour:'rounded-rectangle',coverage:.88,frontDepth:.34,
  }}});
  const lens={shape:'long-diary',size:2,viewportWidth:960,viewportHeight:720,occupancy:.5};
  const customFocus=composer.focusDistance(lens);
  assert.ok(customFocus.distance>focusDistance({...lens,shape:'rectangle'}).distance*2);
  assert.ok(customFocus.widthOccupancy<=.5);
  const input=[{id:'fixed',shape:'long-diary',size:2,position:[0,0,0],locked:true},
    {id:'moving',shape:'long-diary',size:2,position:[0,0,0]}];
  const packed=composer.solveLivingLayout(input,{gap:.5});
  assert.equal(packed.diagnostics.collisionCount,0);
  assert.deepEqual(input[0].position,[0,0,0]);
  assert.deepEqual(packed.objects[0].position,[0,0,0]);
  assert.ok(packed.objects[0].radius>7);
  assert.ok(Math.hypot(...packed.objects[1].position)>=packed.objects[0].radius*2+.5-.01);
  assert.throws(()=>surfaceLayout({id:'bad-sphere',shape:'spherical',profile:{
    body:{width:2,height:2,depth:.2},contour:'circle',radius:1,
  }}),/circular sphere profile/);
  assert.throws(()=>surfaceLayout({id:'bad-cylinder',shape:'cylindrical',profile:{
    body:{width:2,height:3,depth:1},contour:'cylinder',radius:1,
  }}),/cylinder profile/);
});

test('a new convex polygon uses one profile for its frame, safe controls, focus, and spacing',()=>{
  const outline=[[-.5,0],[-.25,.5],[.25,.5],[.5,0],[.25,-.5],[-.25,-.5]];
  const profile={body:{width:2,height:1.6,depth:.25},contour:'polygon',outline,coverage:.9};
  const composer=createLivingSurfaceComposer({profiles:{'hex-archive':profile}});
  const {wrapper,primarySurface}=composer.surfaceLayout({id:'archive',shape:'hex-archive'});
  assert.deepEqual(wrapper.outline,outline);
  assert.equal(wrapper.shape,'hex-archive');
  assert.equal(wrapper.contour,'polygon');
  assert.equal(primarySurface.width,1.8);
  assert.ok(wrapper.contentBounds.width<primarySurface.width);
  assert.ok(wrapper.contentBounds.height<primarySurface.height);
  const frame=composer.focusDistance({shape:'hex-archive',viewportWidth:390,viewportHeight:844,occupancy:.55});
  assert.ok(frame.widthOccupancy<=.55&&frame.heightOccupancy<=.55);
  const packed=composer.solveLivingLayout([{id:'archive',shape:'hex-archive',position:[0,0,0],pinned:true},
    {id:'archive-2',shape:'hex-archive',position:[0,0,0]}],{gap:1});
  assert.equal(packed.diagnostics.collisionCount,0);
  assert.throws(()=>surfaceLayout({id:'bad',shape:'hex-archive',profile:{...profile,
    outline:[[-.5,0],[.5,0],[0,.5],[0,-.5]]}}),/convex/);
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

test('a packed location remains valid for the manual move guard at the same gap',()=>{
  for(const size of [1,24]){
    const input=[
      {id:'fixed',shape:'sphere',size,position:[0,0,0],locked:true},
      {id:'moved',shape:'sphere',size,position:[0,0,0]},
    ];
    const layout=solveLivingLayout(input,{gap:REALITY_TAB_GAP});
    assert.equal(layout.diagnostics.collisionCount,0);
    const packed=layout.objects.find(object=>object.id==='moved').position;
    const manual=resolveRealityTabPosition('moved',packed,layout.objects);
    assert.ok(Math.hypot(...manual.map((coordinate,index)=>coordinate-packed[index]))<.002,
      `manual movement should accept a packed sphere of size ${size}`);
    assert.ok(Math.hypot(...packed)<size*1.6+REALITY_TAB_GAP+.1,
      'a large sphere should use its physical radius rather than its bounding cube');
  }
});
