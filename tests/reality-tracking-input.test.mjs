import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {createRealityTimeline} from '../src/domains/reality-timeline.js';
import {createRealityTrackingInput,trackingCanvasPoint,trackingPointIsObstructed,createHomeTransformStore,REALITY_HOME_LAYOUT_KEY} from '../src/render/reality-tracking-input.js';

function storage(){const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
function fixture({kind='feature',locked=false,shape='cube'}={}){
  const camera=new THREE.PerspectiveCamera(60,2,.01,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const canvas={getBoundingClientRect:()=>({left:20,top:30,width:1000,height:500})};
  const owner=createRealityTimeline({objects:[{id:'chess',position:[0,0,0],shape:'cube',size:1,locked}],clock:()=>1700000000000});
  const mesh=new THREE.Mesh(shape==='torus'?new THREE.TorusGeometry(2,.4,12,48):new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial());mesh.updateMatrixWorld();
  const ray=new THREE.Raycaster(),calls=[],saved=storage(),home=createHomeTransformStore({ids:['agents'],storage:saved});
  let active=true,arrange=false,busy=false,homePosition=[0,0,0];
  const getRay=point=>{ray.setFromCamera(new THREE.Vector2((point.clientX-20)/500-1,1-(point.clientY-30)/250),camera);return ray.ray;};
  const pick=point=>{getRay(point);const hit=ray.intersectObject(mesh,false)[0];return hit?{kind,id:kind==='space'?'agents':'chess',label:'Original object',controlActionability:kind==='control',dwellAllowed:['space','feature'].includes(kind),actionId:kind==='control'?'delete-message':null}:null;};
  const surface={handleTrackingInput:input=>{calls.push(['surface',input.type]);return true;}};
  const adapter=createRealityTrackingInput({THREE,canvas,camera,isActive:()=>active,getOwner:()=>owner,getArrange:()=>arrange,pick,getRay,getDisplayedPosition:()=>mesh.position.toArray(),
    select:id=>{if(id==='chess')owner.select(id);},
    previewFeature:(id,patch)=>{mesh.position.fromArray(patch.position);mesh.scale.setScalar(patch.size);mesh.rotation.set(...patch.rotation);calls.push(['preview',id,patch]);},
    commitFeature:(id,patch)=>{owner.transform(id,{position:patch.position,size:patch.size,rotation:patch.rotation});calls.push(['commit',id]);},
    restore:()=>{const current=owner.getSnapshot().objects[0];mesh.position.fromArray(current.position);mesh.scale.setScalar(current.size);mesh.rotation.set(...current.rotation);calls.push(['restore']);},
    activateFeature:id=>calls.push(['open-feature',id]),activateSpace:id=>calls.push(['open-space',id]),getSurface:()=>surface,
    getHome:id=>({...home.get(id),position:homePosition}),
    previewHome:(id,patch)=>{home.preview(id,{...patch,offset:patch.position});mesh.position.fromArray(patch.position);return patch;},
    commitHome:(id,patch)=>{home.commit(id,{...patch,offset:patch.position});homePosition=[...patch.position];calls.push(['home-commit']);},
    cancelHome:id=>home.cancel(id),setBusy:value=>{busy=value;},
  });
  return {adapter,owner,mesh,calls,home,saved,setActive:value=>{active=value;},setArrange:value=>{arrange=value;},get busy(){return busy;},dispose(){mesh.geometry.dispose();mesh.material.dispose();}};
}

test('tracked coordinates account for the original canvas rectangle and reject out-of-view samples',()=>{
  const canvas={getBoundingClientRect:()=>({left:20,top:30,width:1000,height:500})};
  assert.deepEqual(trackingCanvasPoint({x:.25,y:.8},canvas),{clientX:270,clientY:430,x:.25,y:.8});
  for(const input of [{x:-.1,y:.5},{x:.5,y:1.1},{x:NaN,y:.5}])assert.equal(trackingCanvasPoint(input,canvas),null);
});

test('foreground controls, native media and Text view prevent targeting an object behind their DOM',()=>{
  const canvas={},point={clientX:500,clientY:200};
  assert.equal(trackingPointIsObstructed({elementFromPoint:()=>canvas},canvas,point),false);
  for(const selector of ['button','iframe','.reality-lens-feature-panel','#hands-eyes-panel']){
    const front={closest:query=>query.split(',').includes(selector)?front:null};
    assert.equal(trackingPointIsObstructed({elementFromPoint:()=>front},canvas,point),true,selector);
  }
  assert.equal(trackingPointIsObstructed({elementFromPoint:()=>({dataset:{nativeTarget:'true'}})},canvas,point),false,'mesh-owned silhouette labels do not replace the raycaster');
});

test('Home torus navigation uses actual triangles and never the empty central hole',()=>{
  const f=fixture({kind:'space',shape:'torus'});
  try{
    const empty=f.adapter.handle({type:'hover',x:.5,y:.5});assert.equal(empty.target,null);
    f.adapter.handle({type:'down',x:.5,y:.5});f.adapter.handle({type:'up',x:.5,y:.5});assert.equal(f.calls.length,0);
    // At this camera distance, x=.587 hits the torus's right-hand tube.
    const hover=f.adapter.handle({type:'hover',x:.587,y:.5});assert.equal(hover.target.kind,'space');assert.equal(hover.target.dwellAllowed,true);
    f.adapter.handle({type:'down',x:.587,y:.5});f.adapter.handle({type:'up',x:.587,y:.5});assert.deepEqual(f.calls,[['open-space','agents']]);
  }finally{f.dispose();}
});

test('gaze requires armed navigation and can never activate a mounted control',()=>{
  const navigation=fixture(),control=fixture({kind:'control'});
  try{
    navigation.adapter.handle({type:'activate',source:'gaze',x:.5,y:.5});assert.equal(navigation.calls.length,0);
    navigation.adapter.handle({type:'activate',source:'gaze',dwellArmed:true,x:.5,y:.5});assert.deepEqual(navigation.calls,[['open-feature','chess']]);
    const result=control.adapter.handle({type:'activate',source:'gaze',dwellArmed:true,x:.5,y:.5});
    assert.equal(result.target.controlActionability,true);assert.equal(result.target.dwellAllowed,false);assert.equal(control.calls.length,0);
    control.adapter.handle({type:'down',x:.5,y:.5});control.adapter.handle({type:'up',x:.5,y:.5});
    assert.deepEqual(control.calls,[['surface','down'],['surface','up']]);
  }finally{navigation.dispose();control.dispose();}
});

test('Arrange previews do not change the timeline and release commits its collision-checked original owner',()=>{
  const f=fixture();f.setArrange(true);
  try{
    const original=f.owner.getSnapshot();f.adapter.handle({type:'down',x:.5,y:.5});assert.equal(f.busy,true);
    f.adapter.handle({type:'move',x:.6,y:.5});assert.deepEqual(f.owner.getSnapshot(),original);
    assert.ok(f.mesh.position.x>1);f.adapter.handle({type:'up',x:.6,y:.5});
    assert.ok(f.owner.getSnapshot().objects[0].position[0]>1);assert.equal(f.owner.getSnapshot().frames.length,2);assert.equal(f.busy,false);
    assert.equal(f.calls.filter(call=>call[0]==='open-feature').length,0);
  }finally{f.dispose();}
});

test('loss, source changes and inactive routing cancel held previews without mutating history',()=>{
  for(const ending of [{type:'cancel'}, {type:'hover',source:'gaze',x:.5,y:.5}, {type:'hover',x:.5,y:.5,inactive:true}]){
    const f=fixture();f.setArrange(true);
    try{
      const original=f.owner.getSnapshot();f.adapter.handle({type:'down',x:.5,y:.5});f.adapter.handle({type:'move',x:.6,y:.5});
      if(ending.inactive)f.setActive(false);const result=f.adapter.handle(ending);
      assert.deepEqual(f.owner.getSnapshot(),original);assert.deepEqual(f.mesh.position.toArray(),[0,0,0]);assert.equal(f.adapter.snapshot().held,null);assert.equal(f.busy,false);
      if(ending.inactive)assert.equal(result.handled,false);
    }finally{f.dispose();}
  }
});

test('locked objects, recorded history and changes from another owner action block editing',()=>{
  const locked=fixture({locked:true}),past=fixture(),changed=fixture();
  try{
    for(const f of [locked,past,changed])f.setArrange(true);
    assert.equal(locked.adapter.handle({type:'down',x:.5,y:.5}).reason,'object-locked');
    past.owner.goTo(0);assert.equal(past.adapter.handle({type:'down',x:.5,y:.5}).reason,'recorded-history-read-only');
    changed.adapter.handle({type:'down',x:.5,y:.5});changed.owner.setLocked('chess',true);
    assert.equal(changed.adapter.handle({type:'move',x:.6,y:.5}).reason,'owner-changed-or-read-only');
    assert.equal(changed.owner.getSnapshot().objects[0].locked,true);assert.deepEqual(changed.owner.getSnapshot().objects[0].position,[0,0,0]);
  }finally{locked.dispose();past.dispose();changed.dispose();}
});

test('two-hand size previews stay bounded, and Home transform cancellation leaves saved layout untouched',()=>{
  const feature=fixture(),home=fixture({kind:'space'});
  try{
    feature.setArrange(true);feature.adapter.handle({type:'down',x:.5,y:.5});
    for(let index=0;index<30;index++)feature.adapter.handle({type:'scale',factor:10,x:.5,y:.5});
    assert.equal(feature.owner.getSnapshot().objects[0].size,1);feature.adapter.handle({type:'up',x:.5,y:.5});assert.equal(feature.owner.getSnapshot().objects[0].size,24);
    home.setArrange(true);home.adapter.handle({type:'down',x:.5,y:.5});home.adapter.handle({type:'scale',factor:1.2,x:.5,y:.5});home.adapter.handle({type:'rotate',radians:.3,x:.5,y:.5});
    assert.equal(home.home.get('agents').size,1.2);assert.equal(home.home.get('agents').rotation[2],.3);assert.equal(home.saved.getItem(REALITY_HOME_LAYOUT_KEY),null);
    home.adapter.handle({type:'cancel'});assert.equal(home.home.get('agents').size,1);assert.equal(home.saved.getItem(REALITY_HOME_LAYOUT_KEY),null);
    home.adapter.handle({type:'down',x:.5,y:.5});home.adapter.handle({type:'scale',factor:1.2,x:.5,y:.5});home.adapter.handle({type:'up',x:.5,y:.5});
    assert.equal(createHomeTransformStore({ids:['agents'],storage:home.saved}).get('agents').size,1.2);
  }finally{feature.dispose();home.dispose();}
});

test('two-hand feature roll previews original geometry, cancels cleanly and commits bounded timeline radians',()=>{
  const f=fixture();f.setArrange(true);
  try{
    const original=f.owner.getSnapshot();f.adapter.handle({type:'down',x:.5,y:.5});
    assert.equal(f.adapter.handle({type:'rotate',radians:.3,x:.5,y:.5}).reason,null);
    assert.equal(f.mesh.rotation.z,.3);assert.deepEqual(f.owner.getSnapshot(),original);
    f.adapter.handle({type:'cancel'});assert.equal(f.mesh.rotation.z,0);assert.deepEqual(f.owner.getSnapshot(),original);
    f.adapter.handle({type:'down',x:.5,y:.5});
    for(let index=0;index<16;index++)f.adapter.handle({type:'rotate',radians:10,x:.5,y:.5});
    assert.equal(f.mesh.rotation.z,Math.PI);f.adapter.handle({type:'up',x:.5,y:.5});
    assert.deepEqual(f.owner.getSnapshot().objects[0].rotation,[0,0,Math.PI]);assert.equal(f.owner.getSnapshot().frames.length,2);
    f.owner.goTo(0);assert.deepEqual(f.owner.getSnapshot().objects[0].rotation,[0,0,0]);
  }finally{f.dispose();}
});

test('Home persistence rejects forged IDs, holds corruption, refuses stale tabs and resets explicitly',()=>{
  const saved=storage(),first=createHomeTransformStore({ids:['agents'],storage:saved}),stale=createHomeTransformStore({ids:['agents'],storage:saved});
  assert.throws(()=>first.commit('unknown',{offset:[0,0,0],size:1,rotation:[0,0,0]}),/bounded/);
  first.commit('agents',{offset:[1,2,3],size:1.2,rotation:[0,0,.3]});
  assert.throws(()=>stale.commit('agents',{offset:[0,0,0],size:1,rotation:[0,0,0]}),/Another tab/);
  assert.equal(first.get('agents').size,1.2);first.reset();assert.equal(first.get('agents').size,1);
  saved.setItem(REALITY_HOME_LAYOUT_KEY,'{bad');const corrupt=createHomeTransformStore({ids:['agents'],storage:saved});
  assert.equal(corrupt.snapshot().held,true);assert.throws(()=>corrupt.preview('agents',{offset:[0,0,0],size:1,rotation:[0,0,0]}),/held/);
  assert.equal(saved.getItem(REALITY_HOME_LAYOUT_KEY),'{bad');corrupt.reset();assert.equal(corrupt.snapshot().held,false);
});
