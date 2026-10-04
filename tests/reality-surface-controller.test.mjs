import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {REALITY_TAB_FORM_IDS} from '../src/domains/reality-tab-layout.js';
import {createRealitySurfaceGeometry} from '../src/render/reality-surface-geometry.js';
import {createRealitySurfaceController} from '../src/render/reality-surface-controller.js';

// Geometry, projection, atlas layout and semantic dispatch are real. Only the
// browser canvas painter and the original DOM button have minimal test hosts.
function fixture(shape='cube',{pointerSurface=false}={}) {
  const oldDocument=globalThis.document;
  const context=()=>({font:'',fillText(){},clearRect(){},fillRect(){},drawImage(){},
    measureText(value){return {width:String(value).length*Number(this.font.match(/([\d.]+)px/)?.[1]??25)*.55};},
    createLinearGradient(){return {addColorStop(){}};}});
  const doc={createElement:()=>({width:0,height:0,getContext:()=>context()}),
    defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'}),
      PointerEvent:class {constructor(type,options){Object.assign(this,{type},options);}}}};
  class Element {
    constructor(tag,text='') {this.nodeType=1;this.tagName=tag.toUpperCase();this.textContent=text;this.childNodes=[];this.parentNode=null;this.ownerDocument=doc;this.attributes=new Map();this.listeners=new Map();this.clicks=0;this.disabled=false;}
    append(child){child.parentNode=this;this.childNodes.push(child);}
    contains(other){for(let node=other;node;node=node.parentNode)if(node===this)return true;return false;}
    getAttribute(key){return this.attributes.get(key)??null;}
    setAttribute(key,value){this.attributes.set(key,String(value));}
    removeAttribute(key){this.attributes.delete(key);}
    addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
    removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
    querySelector(){return null;}
    matches(selector){return selector===':disabled'&&this.disabled;}
    getBoundingClientRect(){return {left:-12000,top:0,width:640,height:480};}
    dispatchEvent(event){event.target=this;for(let node=this;node;node=node.parentNode)for(const fn of node.listeners.get(event.type)??[])fn(event);return true;}
    click(){this.clicks++;for(let node=this;node;node=node.parentNode)for(const fn of node.listeners.get('click')??[])fn({type:'click',target:this});}
  }
  const owner=new Element('section'),button=new Element(pointerSurface?'canvas':'button','Original action');owner.append(button);
  if(pointerSurface)Object.assign(button,{width:640,height:480,toDataURL:()=> 'data:image/png;base64,fixture'});
  const canvas=new Element('canvas'),capture=new Set();
  Object.assign(canvas,{getBoundingClientRect:()=>({left:37,top:29,width:800,height:600}),focus(){},
    setPointerCapture:id=>capture.add(id),hasPointerCapture:id=>capture.has(id),releasePointerCapture:id=>capture.delete(id)});
  const body=createRealitySurfaceGeometry(THREE,shape),original=body.charts.map(()=>new THREE.MeshBasicMaterial());
  const mesh=new THREE.Mesh(body.geometry,original),root=new THREE.Group();root.add(mesh);
  const node={root,tabMesh:mesh,surfaceCharts:body.charts},camera=new THREE.PerspectiveCamera(45,4/3,.01,100);
  camera.position.set(0,0,4);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const controls={enabled:true};globalThis.document=doc;
  const controller=createRealitySurfaceController({THREE,node,element:owner,feature:{id:'original',label:'Original feature'},renderer:{domElement:canvas},camera,controls});
  function dispose(){controller.dispose();body.geometry.dispose();original.forEach(material=>material.dispose());globalThis.document=oldDocument;}
  return {controller,node,camera,controls,canvas,button,owner,original,capture,dispose};
}
const uvOf=region=>({x:region.x+region.width/2,y:1-region.y-region.height/2});
const eventAt=(point,type='pointerdown')=>({type,button:0,pointerId:13,clientX:point.x,clientY:point.y,preventDefault(){},stopImmediatePropagation(){}});
function aimAt(f,chart,uv) {
  const first=f.controller.surfacePoint(chart,uv);assert.ok(first,'UV belongs to a real triangle');
  const outward=first.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(f.node.tabMesh.matrixWorld)).normalize();
  f.camera.position.copy(first.world).addScaledVector(outward,3);
  f.camera.up.set(0,1,0);if(Math.abs(outward.y)>.95)f.camera.up.set(0,0,1);
  f.camera.lookAt(first.world);f.camera.updateMatrixWorld();
  return f.controller.surfacePoint(chart,uv);
}

test('all supported whole-body geometries route a painted action through actual triangle UVs to the original control',()=>{
  for(const shape of REALITY_TAB_FORM_IDS){
    const f=fixture(shape);
    try {
      const chart=f.controller.atlas.snapshot().charts.find(item=>item.regions.some(region=>region.actionId?.startsWith('original:')));
      assert.ok(chart,`${shape} exposes the original action`);
      const region=chart.regions.find(item=>item.actionId?.startsWith('original:')),uv=uvOf(region),point=aimAt(f,chart.index,uv);
      const hit=f.controller.hit(eventAt(point));
      assert.ok(hit,`${shape} is hit on its actual body`);
      assert.equal(hit.chart,chart.index,`${shape} preserves face.materialIndex`);
      assert.ok(hit.uv.distanceTo(new THREE.Vector2(uv.x,uv.y))<1e-5,`${shape} preserves local UV at the painted action`);
      assert.equal(hit.region.actionId,region.actionId);
      assert.equal(f.controller.document.getElement(region.actionId),f.button);
      assert.equal(f.controller.down(eventAt(point)),true);assert.equal(f.controls.enabled,false);
      assert.equal(f.controller.up(eventAt(point,'pointerup')),true);
      assert.equal(f.button.clicks,1,`${shape} executes the existing control exactly once`);
      assert.equal(f.controls.enabled,true);assert.equal(f.capture.size,0);
      assert.equal(f.owner.childNodes.length,1,'no cloned owner or control');
      assert.equal(f.node.root.children.length,1,'the existing body is the only mesh');
    } finally {f.dispose();}
  }
});

test('surfacePoint and picking agree after ancestor rotation, translation and nonuniform body scale',()=>{
  const f=fixture('sphere');
  try {
    const parent=new THREE.Group();parent.position.set(1,-.3,.2);parent.rotation.set(.25,-.6,.3);parent.add(f.node.root);
    f.node.root.position.set(.2,.1,-.3);f.node.root.rotation.set(.4,.25,-.1);f.node.root.scale.set(1.3,.8,1.1);parent.updateMatrixWorld(true);
    for(const chart of f.node.surfaceCharts){
      const uv={x:.43,y:.58},point=aimAt(f,chart.index,uv),hit=f.controller.hit(eventAt(point));
      assert.ok(hit);assert.equal(hit.chart,chart.index);
      assert.ok(hit.intersection.point.distanceTo(point.world)<1e-5);
      assert.ok(hit.uv.distanceTo(new THREE.Vector2(uv.x,uv.y))<1e-5);
    }
  } finally {f.dispose();}
});

test('surfacePoint rejects triangle-cap empty UVs and torus picking leaves the real central hole empty',()=>{
  const prism=fixture('triangular-prism');
  try {
    assert.equal(prism.controller.surfacePoint(0,{x:.03,y:.95}),null);
    assert.ok(prism.controller.surfacePoint(0,{x:.5,y:.5}));
  } finally {prism.dispose();}
  const torus=fixture('torus');
  try {
    assert.equal(torus.controller.hit({clientX:437,clientY:329}),null);
    assert.equal(torus.controller.down(eventAt({x:437,y:329})),false);
    assert.equal(torus.controls.enabled,true);assert.equal(torus.button.clicks,0);
  } finally {torus.dispose();}
});

test('bringing a chart into view preserves its reading-up direction at an oblique camera angle',()=>{
  for(const shape of ['cube','triangular-prism','cylinder']){
    const f=fixture(shape);
    try{
      f.camera.position.set(2,3,5);f.camera.lookAt(0,0,0);f.camera.updateMatrixWorld();
      for(const chart of f.node.surfaceCharts){
        const uv={x:chart.contentBounds.x+chart.contentBounds.width/2,y:1-chart.contentBounds.y-chart.contentBounds.height/2};
        assert.equal(f.controller.orientChart(chart.index,uv),true);
        const point=f.controller.surfacePoint(chart.index,uv);
        const actualUp=point.chartUp.clone().applyQuaternion(f.node.root.quaternion).normalize();
        const cameraUp=new THREE.Vector3(0,1,0).applyQuaternion(f.camera.quaternion);
        assert.ok(actualUp.dot(cameraUp)>.96,`${shape}/${chart.id} text must face upright`);
      }
    }finally{f.dispose();}
  }
});

test('initial native focus stays front-facing through the camera approach without overriding later rotation',()=>{
  const f=fixture('cube');
  try{
    // The mounted object starts far from the camera's current target. Focus
    // enters its real control before the assembly camera approaches the body.
    f.node.root.position.set(20,4,2);f.node.root.updateMatrixWorld(true);
    f.button.dispatchEvent({type:'focusin'});
    const focusedRotation=f.node.root.quaternion.clone();
    const chart=f.controller.atlas.snapshot().charts.find(item=>item.regions.some(region=>region.actionId?.startsWith('original:')));
    const region=chart.regions.find(item=>item.actionId?.startsWith('original:')),uv=uvOf(region);
    const target=new THREE.Vector3(),destination=f.node.root.position.clone(),cameraDestination=destination.clone().add(new THREE.Vector3(0,0,4));
    for(let frame=0;frame<80;frame++){
      target.lerp(destination,.2);f.camera.position.lerp(cameraDestination,.2);
      f.camera.lookAt(target);f.camera.updateMatrixWorld();f.controller.sync();
    }
    const point=f.controller.surfacePoint(chart.index,uv);
    const worldNormal=point.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(f.node.tabMesh.matrixWorld)).normalize();
    const viewNormal=f.camera.getWorldDirection(new THREE.Vector3()).negate();
    assert.ok(worldNormal.dot(viewNormal)>.999,'the originally focused chart faces the settled camera');
    assert.ok(focusedRotation.angleTo(f.node.root.quaternion)<1e-7,'alignment is one focus action, not recurring camera tracking');

    // Pointer/key rotation remains the user's choice after opening.
    f.controller.key({target:f.canvas,key:'ArrowRight',preventDefault(){},stopImmediatePropagation(){}});
    const deliberateRotation=f.node.root.quaternion.clone();f.controller.sync();
    assert.ok(focusedRotation.angleTo(deliberateRotation)>.2);
    assert.ok(deliberateRotation.angleTo(f.node.root.quaternion)<1e-7);

    // A subsequent native focus still brings its chart into the new view.
    f.camera.position.copy(destination).add(new THREE.Vector3(3,2,5));f.camera.lookAt(destination);f.camera.updateMatrixWorld();
    f.button.dispatchEvent({type:'focusin'});
    const refocused=f.controller.surfacePoint(chart.index,uv);
    const refocusedNormal=refocused.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(f.node.tabMesh.matrixWorld)).normalize();
    assert.ok(refocusedNormal.dot(f.camera.getWorldDirection(new THREE.Vector3()).negate())>.999);
  }finally{f.dispose();}
});

test('drag rotation does not activate controls and disposal restores original body materials',()=>{
  const f=fixture();
  try {
    const chart=f.controller.atlas.snapshot().charts[4],region=chart.regions.find(item=>item.actionId?.startsWith('original:'));
    const point=aimAt(f,4,uvOf(region)),materials=[...f.node.tabMesh.material],disposed=new Map();
    for(const material of materials){disposed.set(material,0);material.addEventListener('dispose',()=>disposed.set(material,disposed.get(material)+1));}
    const rotation=f.node.root.quaternion.clone();f.controller.down(eventAt(point));
    f.controller.move(eventAt({x:point.x+35,y:point.y+16},'pointermove'));
    f.controller.up(eventAt({x:point.x+35,y:point.y+16},'pointerup'));
    assert.ok(rotation.angleTo(f.node.root.quaternion)>.1);assert.equal(f.button.clicks,0);
    f.controller.dispose();assert.equal(f.node.tabMesh.material,f.original);
    assert.ok([...disposed.values()].every(value=>value===1));
    assert.equal(f.canvas.getAttribute('aria-label'),null);
    assert.equal(f.node.surface360,false);assert.equal(f.controls.enabled,true);
  } finally {f.dispose();}
});

test('disposing during an original canvas gesture cancels once, releases capture and restores orbit controls',()=>{
  const f=fixture('cube',{pointerSurface:true}),events=[];
  try {
    for(const type of ['pointerdown','pointercancel','pointerup','click'])f.button.addEventListener(type,event=>events.push({type:event.type,pointerId:event.pointerId,buttons:event.buttons}));
    const chart=f.controller.atlas.snapshot().charts.find(item=>item.regions.some(region=>region.kind==='canvas'));
    const region=chart.regions.find(item=>item.kind==='canvas'),point=aimAt(f,chart.index,uvOf(region));
    assert.equal(f.controller.down(eventAt(point)),true);
    assert.deepEqual(events,[{type:'pointerdown',pointerId:13,buttons:1}]);
    assert.equal(f.controls.enabled,false);assert.equal(f.capture.has(13),true);
    f.controller.dispose();
    assert.deepEqual(events,[{type:'pointerdown',pointerId:13,buttons:1},{type:'pointercancel',pointerId:13,buttons:0}]);
    assert.equal(f.controls.enabled,true);assert.equal(f.capture.size,0);
    f.controller.dispose();
    assert.equal(events.filter(event=>event.type==='pointercancel').length,1,'repeated disposal does not dispatch a second cancellation');
    assert.equal(f.button.clicks,0);assert.equal(f.node.tabMesh.material,f.original);
  } finally {f.dispose();}
});
