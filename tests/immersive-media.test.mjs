import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {createImmersiveSession} from '../src/render/immersive-session.js';
import {createMediaPreview} from '../src/render/media-preview.js';
function documentStub(){const element=()=>({style:{},children:[],append(...items){this.children.push(...items);},addEventListener(){},removeEventListener(){},setAttribute(){},remove(){}});return {body:element(),createElement:element};}
test('VR and AR share the scene, hit targets and restore desktop state',async()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(0,1,5);
  const controllers=[new THREE.Group(),new THREE.Group()];controllers[0].position.set(0,1,5);controllers[0].updateMatrixWorld(true);let alpha=1,requested,selected=null;
  const renderer={xr:{getController:i=>controllers[i],setReferenceSpaceType(){},async setSession(s){this.session=s;}},getClearAlpha:()=>alpha,setClearAlpha:v=>{alpha=v;}};
  const sessions=[];const xr={async requestSession(mode){requested=mode;const s=new EventTarget();s.end=async()=>s.dispatchEvent(new Event('end'));sessions.push(s);return s;}};
  const cube=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());cube.position.set(0,1,0);scene.add(cube);scene.updateMatrixWorld(true);
  const controls={enabled:true};const owner=createImmersiveSession({THREE,renderer,scene,camera,controls,targets:[cube],onSelect:object=>{selected=object;},documentRoot:documentStub(),navigatorRoot:{xr}});
  assert.equal(await owner.start('immersive-vr'),true);assert.equal(requested,'immersive-vr');assert.equal(controls.enabled,false);
  controllers[0].dispatchEvent({type:'select'});assert.equal(selected,cube);
  await sessions[0].end();assert.equal(controls.enabled,true);assert.deepEqual(camera.position.toArray(),[0,1,5]);
  assert.equal(await owner.start('immersive-ar'),true);assert.equal(alpha,0);assert.equal(scene.children.includes(cube),true);
  await sessions[1].end();assert.equal(alpha,1);assert.equal(owner.active,false);await owner.destroy();
});
test('media captures only after explicit start, honors stop during permission wait',async()=>{
  let requests=0,resolve,stops=0;
  const mediaDevices={getUserMedia:()=>{requests++;return new Promise(r=>{resolve=r;});}};
  const owner=createMediaPreview({documentRoot:documentStub(),mediaDevices});assert.equal(requests,0);
  const pending=owner.start(false);assert.equal(requests,1);owner.stop();resolve({getTracks:()=>[{stop:()=>stops++}]});await pending;
  assert.equal(stops,1);assert.equal(owner.getSnapshot().active,false);owner.destroy();
});
test('failed XR permission does not create a session or mutate the camera',async()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(1,2,3);
  let alpha=1;const renderer={xr:{getController:()=>new THREE.Group()},getClearAlpha:()=>alpha,setClearAlpha:value=>{alpha=value;}};
  const owner=createImmersiveSession({THREE,renderer,scene,camera,controls:{enabled:true},targets:[],onSelect(){},documentRoot:documentStub(),navigatorRoot:{xr:{requestSession:async()=>{throw new DOMException('No permission','NotAllowedError');}}}});
  assert.equal(await owner.start('immersive-vr'),false);assert.deepEqual(camera.position.toArray(),[1,2,3]);assert.equal(owner.active,false);await owner.destroy();
});
