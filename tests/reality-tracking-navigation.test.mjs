import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {createRealityTimeline} from '../src/domains/reality-timeline.js';
import {createRealityTrackingInput,createTrackingNavigationTargets,trackingPointIsObstructed} from '../src/render/reality-tracking-input.js';

function button({id,left=400,onclick=()=>{}}={}){
  return {tagName:'BUTTON',id,textContent:id,disabled:false,hidden:false,ancestorHidden:false,isConnected:true,rects:true,
    attributes:{'data-home':''},clicks:0,getAttribute(name){return this.attributes[name]??null;},
    closest(selector){if(selector==='button')return this;if(selector==='[hidden],[inert]'&&(this.hidden||this.ancestorHidden))return this;return null;},
    getClientRects(){return this.rects?[this.getBoundingClientRect()]:[];},getBoundingClientRect(){return {left,top:200,width:100,height:100};},
    click(){if(!this.disabled){this.clicks++;onclick();}},
  };
}
function fixture(){
  const actions=[],home=button({id:'Home',onclick:()=>actions.push('home')}),view=button({id:'View',left:600,onclick:()=>actions.push('view')}),send=button({id:'Provider send',left:800,onclick:()=>actions.push('provider-send')});
  let frontOverride=null,active=true,arrange=true;
  const doc={elementFromPoint(x,y){if(frontOverride)return frontOverride;if(y<200||y>300)return null;return x>=400&&x<=500?home:x>=600&&x<=700?view:x>=800&&x<=900?send:null;}};
  const registry=createTrackingNavigationTargets({documentRoot:doc,entries:[{element:home,id:'nav-home',label:'Home',dwellAllowed:true},{element:view,id:'nav-view',label:'View',dwellAllowed:false}]});
  const owner=createRealityTimeline({objects:[{id:'agent',position:[0,0,0],shape:'cube',size:1}]});
  const canvas={getBoundingClientRect:()=>({left:0,top:0,width:1000,height:500})};
  const adapter=createRealityTrackingInput({THREE,canvas,camera:new THREE.PerspectiveCamera(),isActive:()=>active,
    getOwner:()=>owner,getArrange:()=>arrange,pick:point=>registry.pick(point),activateNavigation:target=>registry.activate(target),onHover:()=>{}});
  return {adapter,owner,registry,doc,home,view,send,actions,setFront:value=>{frontOverride=value;},setActive:value=>{active=value;},setArrange:value=>{arrange=value;}};
}

test('tracked navigation trusts exact original buttons, including child hits, and ignores matching attributes on other owners',()=>{
  const f=fixture(),point={clientX:450,clientY:250};
  const target=f.registry.pick(point);assert.equal(target.id,'nav-home');assert.equal(target.kind,'navigation');
  f.setFront({closest:selector=>selector==='button'?f.home:null});assert.equal(f.registry.pick(point).element,f.home,'an icon/text hit resolves the original button');
  const impostor=button({id:'Fake Home'});f.setFront(impostor);
  assert.equal(f.registry.pick(point),null,'another owner cannot acquire navigation powers with data-home');
  assert.equal(f.registry.activate({...target,element:impostor}),false);assert.equal(impostor.clicks,0);
  f.setFront(f.send);assert.equal(f.registry.pick({clientX:850,clientY:250}),null);assert.equal(f.send.clicks,0);
  assert.equal(trackingPointIsObstructed({elementFromPoint:()=>({closest:()=>({})})},null,point),true,'unregistered foreground controls retain the occlusion guard');
});

test('hidden, inert, detached, CSS-hidden and disabled navigation controls cannot be targeted or activated',()=>{
  const f=fixture(),point={clientX:450,clientY:250},target=f.registry.pick(point);
  for(const [key,value] of [['hidden',true],['ancestorHidden',true],['isConnected',false],['rects',false],['disabled',true]]){
    const previous=f.home[key];f.home[key]=value;assert.equal(f.registry.pick(point),null,key);assert.equal(f.registry.activate(target),false,key);f.home[key]=previous;
  }
  f.home.attributes['aria-disabled']='true';assert.equal(f.registry.pick(point),null);assert.equal(f.home.clicks,0);
});

test('pinching the existing Home button uses its original click handler even in Arrange or recorded history',()=>{
  const f=fixture(),input={x:.45,y:.5},before=f.owner.getSnapshot();
  f.home.click();assert.deepEqual(f.actions,['home'],'ordinary click reaches the same callback');
  const hover=f.adapter.handle({type:'hover',...input});assert.equal(hover.target.kind,'navigation');assert.equal(hover.target.controlActionability,true);assert.equal(hover.target.dwellAllowed,true);
  assert.equal('element' in hover.target,false,'DOM references never enter public target snapshots');
  f.adapter.handle({type:'down',...input});assert.equal(f.adapter.snapshot().held.kind,'navigation');assert.equal(f.adapter.snapshot().held.arrange,false);
  f.adapter.handle({type:'up',...input});assert.deepEqual(f.actions,['home','home']);assert.deepEqual(f.owner.getSnapshot(),before,'navigation cannot edit the layout owner');
  f.owner.goTo(0);f.adapter.handle({type:'down',...input});f.adapter.handle({type:'up',...input});
  assert.deepEqual(f.actions,['home','home','home'],'navigation remains available to leave recorded history');
});

test('gaze navigation requires explicit arming and settings/provider commands never acquire dwell authority',()=>{
  const f=fixture();
  f.adapter.handle({type:'activate',source:'gaze',x:.45,y:.5});assert.equal(f.home.clicks,0);
  f.adapter.handle({type:'activate',source:'gaze',dwellArmed:true,x:.45,y:.5});assert.equal(f.home.clicks,1);
  assert.equal(f.adapter.handle({type:'activate',source:'gaze',dwellArmed:true,x:.65,y:.5}).reason,'dwell-not-navigation');
  f.adapter.handle({type:'activate',source:'gaze',dwellArmed:true,x:.85,y:.5});assert.equal(f.send.clicks,0);assert.equal(f.view.clicks,0);
  f.adapter.handle({type:'down',source:'hand',x:.65,y:.5});f.adapter.handle({type:'up',source:'hand',x:.65,y:.5});assert.equal(f.view.clicks,1,'deliberate pinch can use the original View button');
});

test('loss, source switches, hiding, different release controls and movement cancel navigation without clicking',()=>{
  for(const ending of ['loss','source','hidden','different','move','inactive']){
    const f=fixture(),input={x:.45,y:.5};f.adapter.handle({type:'down',...input});
    if(ending==='loss')f.adapter.handle({type:'cancel',reason:'hand-lost'});
    if(ending==='source')f.adapter.handle({type:'hover',source:'gaze',...input});
    if(ending==='hidden')f.home.hidden=true;
    if(ending==='move')f.adapter.handle({type:'move',x:.48,y:.5});
    if(ending==='inactive')f.setActive(false);
    f.adapter.handle({type:'up',...(ending==='different'?{x:.65,y:.5}:input)});
    assert.equal(f.home.clicks,0,ending);assert.equal(f.view.clicks,0,ending);assert.equal(f.adapter.snapshot().held,null,ending);
  }
});

test('a dynamically closing navigation toggle can withdraw dwell permission without replacing its original handler',()=>{
  let opened=false;const original=button({id:'Spaces',onclick:()=>{opened=!opened;}}),doc={elementFromPoint:()=>original};
  const registry=createTrackingNavigationTargets({documentRoot:doc,entries:[{element:original,id:'nav-spaces',dwellAllowed:()=>!opened}]});
  let target=registry.pick({clientX:450,clientY:250});assert.equal(target.dwellAllowed,true);assert.equal(registry.activate(target),true);
  target=registry.pick({clientX:450,clientY:250});assert.equal(target.dwellAllowed,false);assert.equal(original.clicks,1);
});
