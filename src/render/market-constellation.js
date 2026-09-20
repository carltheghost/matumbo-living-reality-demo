import * as THREE from 'three';
import {isCompactViewport,resolvePixelRatioCap} from './render-perf.js';

/** Geometry is a view, never the authority for contract records. */
export function mountMarketConstellation({host,onSelect}) {
  // Mobile perf: compact viewports get no MSAA and a pixelRatio of 1 (desktop
  // keeps antialias + the 1.5 cap). Rendering is already on-demand; draw()
  // also skips background tabs.
  const viewWidth=host.ownerDocument?.defaultView?.innerWidth??globalThis.innerWidth??0;
  const renderer=new THREE.WebGLRenderer({antialias:!isCompactViewport(viewWidth),alpha:true});
  renderer.setPixelRatio(resolvePixelRatioCap(typeof devicePixelRatio==='number'?devicePixelRatio:1,viewWidth));host.append(renderer.domElement);
  renderer.domElement.style.cssText='width:100%;height:100%;touch-action:none';
  renderer.domElement.setAttribute('aria-label','Contract cubes. Drag to orbit, wheel to zoom. Normal-view buttons provide keyboard selection.');
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,300),group=new THREE.Group();scene.add(group);
  scene.add(new THREE.HemisphereLight(0x9bceff,0x17202c,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(4,8,5);scene.add(light);
  let meshes=[],yaw=.5,pitch=.5,distance=12,visible=true,pointer=null;
  const raycaster=new THREE.Raycaster();
  function dispose(){group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});group.clear();}
  function update(records,selected){dispose();meshes=[];const positions=new Map();let row=0;
    function place(record,depth){positions.set(record.id,new THREE.Vector3(depth*2.2,0,row++*2));for(const child of records.filter(r=>r.parentId===record.id))place(child,depth+1);}
    records.filter(r=>!r.parentId).forEach(r=>place(r,0));
    const center=new THREE.Vector3();for(const p of positions.values())center.add(p);if(positions.size)center.divideScalar(positions.size);for(const p of positions.values())p.sub(center);
    for(const record of records){const color=record.id===selected?0xefbc73:record.state==='closed'?0x596a7a:record.kind==='pool'?0x986bd8:0x3abce8;
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(1.2,1.2,1.2),new THREE.MeshStandardMaterial({color,metalness:.15,roughness:.15,transparent:true,opacity:.62,emissive:color,emissiveIntensity:.28,depthWrite:false}));mesh.position.copy(positions.get(record.id));mesh.userData.id=record.id;group.add(mesh);meshes.push(mesh);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:0xdff3ff,transparent:true,opacity:.9})));
      // Selection opens six face panels like petals around the immutable core.
      if(record.id===selected)for(const [x,y,z] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
        const face=new THREE.Mesh(new THREE.BoxGeometry(x?.08:.95,y?.08:.95,z?.08:.95),new THREE.MeshStandardMaterial({color:0x8abfe8,metalness:.15,roughness:.15,transparent:true,opacity:.5,depthWrite:false}));face.position.set(x*1.05,y*1.05,z*1.05);mesh.add(face);
      }
      const beacon=new THREE.Mesh(new THREE.BoxGeometry(.1,.22,.1),new THREE.MeshStandardMaterial({color:0xcd3553,emissive:0xa91c37,emissiveIntensity:2}));beacon.position.y=1.4;mesh.add(beacon);
      if(record.parentId)group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([positions.get(record.parentId),mesh.position]),new THREE.LineBasicMaterial({color:0x69baff})));
    }
    host.dataset.objectIds=JSON.stringify(records.map(r=>r.id));host.dataset.selectedId=selected||'';draw();
  }
  function draw(){if(!visible||host.hidden||host.ownerDocument?.hidden)return;const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.position.set(distance*Math.sin(yaw)*Math.cos(pitch),distance*Math.sin(pitch),distance*Math.cos(yaw)*Math.cos(pitch));camera.lookAt(0,0,0);camera.updateProjectionMatrix();renderer.render(scene,camera);}
  renderer.domElement.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY};renderer.domElement.setPointerCapture(e.pointerId);});
  renderer.domElement.addEventListener('pointermove',e=>{if(!pointer)return;yaw-=(e.clientX-pointer.lastX)*.008;pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.clientY-pointer.lastY)*.008));pointer.lastX=e.clientX;pointer.lastY=e.clientY;draw();});
  renderer.domElement.addEventListener('pointerup',e=>{if(!pointer)return;const moved=Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y);pointer=null;if(moved>5)return;const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);const hit=raycaster.intersectObjects(meshes,false)[0];if(hit)onSelect(hit.object.userData.id);});
  renderer.domElement.addEventListener('pointercancel',()=>{pointer=null;});
  renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();distance=Math.max(3,Math.min(200,distance+e.deltaY*.01));draw();},{passive:false});
  const observer=new ResizeObserver(draw);observer.observe(host);draw();
  addEventListener('pagehide',()=>{observer.disconnect();dispose();renderer.dispose();},{once:true});
  return {update,setVisible(value){visible=value;draw();},getSnapshot(){const bounds=renderer.domElement.getBoundingClientRect();return {ids:meshes.map(m=>m.userData.id),targets:meshes.map(mesh=>{const point=mesh.position.clone().project(camera);return {id:mesh.userData.id,x:bounds.left+(point.x+1)*bounds.width/2,y:bounds.top+(1-point.y)*bounds.height/2};})};}};
}
