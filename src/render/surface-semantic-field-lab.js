import * as THREE from '../../vendor/three-r179.1/build/three.module.js';
import { OrbitControls } from '../../vendor/three-r179.1/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from '../../vendor/three-r179.1/examples/jsm/utils/BufferGeometryUtils.js';
import { createSurfaceInteractionSystem, surfaceContact } from './surface-semantic-field-three.js';
import { TopologySurfaceObject } from './topology-surface-object.js';
import { breedTraits } from '../domains/surface-semantic-field.js';

const CYAN='#55e8ff', GOLD='#d9ae60';

function contentFor(id,label){
  return [
    {id:'identity',label:'IDENTITY',value:label,priority:1,action:'focus'},
    {id:'state',label:'STATE',value:'surface-native · ready',priority:.92,action:'inspect'},
    {id:'signal',label:'SIGNAL',value:`${id} / semantic field`,priority:.78,action:'activate'},
    {id:'matter',label:'MATTER',value:'color · emission · roughness · relief',priority:.72,action:'touch'},
    {id:'lineage',label:'LINEAGE',value:'maTumbo SSF v1',priority:.64,action:'mix'},
  ];
}

function stars(scene,count=1700){
  const positions=new Float32Array(count*3);
  let seed=0x51f15e;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0xffffffff;};
  for(let i=0;i<count;i++){
    const r=38+rand()*80,theta=rand()*Math.PI*2,phi=Math.acos(rand()*2-1);
    positions[i*3]=Math.sin(phi)*Math.cos(theta)*r;
    positions[i*3+1]=Math.cos(phi)*r;
    positions[i*3+2]=Math.sin(phi)*Math.sin(theta)*r;
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));
  scene.add(new THREE.Points(g,new THREE.PointsMaterial({color:0x7cdff2,size:.045,transparent:true,opacity:.55,depthWrite:false})));
}

function warpOpenGeometry(){
  const g=new THREE.PlaneGeometry(3.7,2.7,48,32),p=g.getAttribute('position');
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i);
    p.setZ(i,Math.sin(x*1.4)*.25+Math.cos(y*1.8)*.15);
  }
  p.needsUpdate=true;g.computeVertexNormals();return g;
}

function disconnectedGeometry(){
  const a=new THREE.SphereGeometry(.95,32,18);a.translate(-1.08,0,0);
  const b=new THREE.SphereGeometry(.72,28,16);b.translate(1.08,.25,.08);
  const merged=mergeGeometries([a,b],false);a.dispose();b.dispose();return merged;
}

function irregularNoUv(){
  const g=new THREE.IcosahedronGeometry(1.65,2);
  g.deleteAttribute('uv');
  const p=g.getAttribute('position');
  for(let i=0;i<p.count;i++){
    const v=new THREE.Vector3().fromBufferAttribute(p,i);
    const scale=1+Math.sin(v.x*2.8+v.y*1.9+v.z*2.1)*.11;
    p.setXYZ(i,v.x*scale,v.y*(1+.08*Math.cos(v.x*3)),v.z*scale);
  }
  p.needsUpdate=true;g.computeVertexNormals();return g;
}

export function resolveLabAtlasSize(width=1280,dpr=1){
  const w=Number.isFinite(Number(width))?Number(width):1280;
  const pixelRatio=Number.isFinite(Number(dpr))?Number(dpr):1;
  if(w<700)return 384;
  if(w<1100||pixelRatio>1.5)return 512;
  return 768;
}

function adaptiveAtlasSize(){
  const width=typeof innerWidth==='number'?innerWidth:1280;
  const dpr=typeof devicePixelRatio==='number'?devicePixelRatio:1;
  return resolveLabAtlasSize(width,dpr);
}

function makeObject(scene,{id,label,shape,geometry,position,rotation=[0,0,0],palette}){
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x08202b}));
  mesh.name=id;mesh.position.fromArray(position);mesh.rotation.set(...rotation);scene.add(mesh);
  const ssf=new TopologySurfaceObject({id,mesh,shape,content:contentFor(id,label),palette,atlasSize:adaptiveAtlasSize(),enableDisplacement:true,topologyOptions:{seamAngle:Math.PI/7,curvatureThreshold:.02}});
  return ssf;
}

export function mountSurfaceSemanticFieldLab({host=document.body}={}){
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x02070e);scene.fog=new THREE.FogExp2(0x02070e,.014);
  const camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.05,220);camera.position.set(0,4.2,18.5);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.xr.enabled=true;host.append(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.055;controls.minDistance=6;controls.maxDistance=48;controls.target.set(0,.25,0);
  scene.add(new THREE.HemisphereLight(0x9eeaff,0x03070d,1.18));
  const key=new THREE.DirectionalLight(0xffd38a,2.5);key.position.set(8,10,12);scene.add(key);
  const rim=new THREE.PointLight(0x31e6ff,34,38,1.6);rim.position.set(-8,4,8);scene.add(rim);
  stars(scene);

  const objects=[];
  objects.push(makeObject(scene,{id:'gold-sphere',label:'GOLD SPHERE',shape:'sphere',geometry:new THREE.SphereGeometry(1.75,64,40),position:[-3.15,2.25,0],palette:{cyan:GOLD,gold:'#fff0bd',base:'#191306',base2:'#2a2109',grid:'rgba(255,216,133,.13)'}}));
  objects.push(makeObject(scene,{id:'cyan-cylinder',label:'CYAN CYLINDER',shape:'cylinder',geometry:new THREE.CylinderGeometry(1.45,1.45,3.7,64,22,false),position:[3.2,2.15,.1],rotation:[0,.12,0]}));
  objects.push(makeObject(scene,{id:'torus',label:'TORUS FIELD',shape:'torus',geometry:new THREE.TorusGeometry(1.55,.56,32,104),position:[-6,-2.1,-1.8],rotation:[.38,.3,0]}));
  objects.push(makeObject(scene,{id:'cube',label:'SIX WALL OBJECT',shape:'cube',geometry:new THREE.BoxGeometry(3,3,3,18,18,18),position:[0,-2.35,-.3],rotation:[.12,.44,.06]}));
  objects.push(makeObject(scene,{id:'irregular',label:'HOSTILE MESH',shape:'irregular',geometry:irregularNoUv(),position:[6,-2.05,-1.6],rotation:[.08,-.35,.1],palette:{cyan:'#6cf7cf',gold:GOLD,base:'#041914',base2:'#09241d'}}));
  objects.push(makeObject(scene,{id:'open',label:'OPEN SURFACE',shape:'open',geometry:warpOpenGeometry(),position:[-4.0,-5.85,-4.2],rotation:[-.12,.2,.02]}));
  objects.push(makeObject(scene,{id:'disconnected',label:'DISCONNECTED BODY',shape:'disconnected',geometry:disconnectedGeometry(),position:[4.15,-5.7,-4.1],rotation:[.1,-.2,.06]}));

  const mixed=breedTraits({family:'gold',roughness:.24,verbs:['store','prove']},{family:'cyan',roughness:.58,verbs:['signal','route']},{seed:'matumbo-ssf-lab'});
  objects[0].updateContent('lineage',{value:`mix ${mixed.traits.family} · r ${mixed.traits.roughness.toFixed(2)}`});
  objects[1].updateContent('lineage',{value:`mix ${mixed.traits.family} · ${mixed.traits.verbs.join('+')}`});

  let activation=0;
  const interaction=createSurfaceInteractionSystem({camera,domElement:renderer.domElement,surfaceObjects:objects,onAction:({object,region,source})=>{
    activation++;
    object.updateContent(region.id,{value:`${String(region.value).split(' · ')[0]} · active ${activation}`,state:'active'});
    const status=document.getElementById('ssf-status');if(status)status.textContent=`${object.id} / ${region.label} / ${source}`;
  }});

  const clock=new THREE.Clock();let raf=0;
  const animate=()=>{
    raf=requestAnimationFrame(animate);const t=clock.getElapsedTime(),ms=t*1000;
    // Two living bodies approach and recede. Their own materials carry the
    // contact reaction: emission, clearcoat, bump and displacement change.
    objects[0].mesh.position.x=-3.0+Math.sin(t*.38)*.48;
    objects[1].mesh.position.x= 3.0-Math.sin(t*.38)*.48;
    for(const object of objects){object.mesh.updateMatrixWorld();object.updateLod({camera,viewportHeight:innerHeight,focused:Boolean(object.focusedRegionId),budget:innerWidth<700?.68:1});object.update(ms);}
    surfaceContact(objects[0],objects[1],2.1);
    controls.update();renderer.render(scene,camera);
  };animate();

  const resize=()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));};
  addEventListener('resize',resize);
  return {scene,camera,renderer,controls,objects,interaction,dispose(){cancelAnimationFrame(raf);removeEventListener('resize',resize);interaction.dispose();objects.forEach(o=>o.dispose());controls.dispose();renderer.dispose();renderer.domElement.remove();}};
}
